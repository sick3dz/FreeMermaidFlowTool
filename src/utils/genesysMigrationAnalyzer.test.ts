import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildMasterOverviewMermaid,
  buildScriptDetailMermaid,
  buildScriptWorkspace,
  parseCallflowTextWithFallback,
} from './scriptCallflowParser';
import { ScriptModule } from '../types/mermaidStudio';
import {
  FlowIR,
  exportAllArchyYamlsZipBlob,
  renderArchyYamlFromFlowIR,
  renderAvayaView,
  renderGenesysView,
  toArchySlug,
  translateAvayaWorkspaceToGenesys,
  validateArchyYaml,
  validateIR,
} from './genesysMigrationAnalyzer';
import {
  generateInteractiveCallflowHtml,
  parseCallflowGraph,
} from './callflowEngine';

function makeModule(scriptNumber: string, rawText: string, fileName?: string): ScriptModule {
  const parsed = parseCallflowTextWithFallback(`=== ${scriptNumber} ===\n${rawText}`);
  const base = parsed[0] || {
    scriptNumber,
    scriptName: scriptNumber,
    isMaster: false,
    rawText,
    rules: [],
    outgoingNumbers: [],
  };
  return {
    ...base,
    scriptNumber,
    scriptName: base.scriptName || scriptNumber,
    sourceFilename: fileName || `${scriptNumber}.s`,
    rawText,
  };
}

describe('genesysMigrationAnalyzer — Avaya AACC (OCL) -> Genesys Cloud Architect', () => {
  it('maps linear LOW-readiness flow with GIVE RAN, single QUEUE TO SKILLSET and DISCONNECT to valid Archy YAML & flowchart TD', () => {
    const mainMod = makeModule(
      'Main_Welcome',
      `
SECTION Start
  GIVE RAN 1001
  QUEUE TO SKILLSET Sales_DE
  DISCONNECT
`
    );

    const ws = buildScriptWorkspace([mainMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);

    expect(res.scripts).toHaveLength(1);
    const script = res.scripts[0];
    expect(script.readiness).toBe('LOW');
    expect(script.warnings).toHaveLength(0);
    expect(script.yamlValidation.isValid).toBe(true);
    expect(script.yamlValidation.errors).toHaveLength(0);

    // Archy YAML strict schema check (clean unscoped declaration name, terminal pruning after transferToAcd)
    expect(script.archyYaml).toContain('inboundCall:');
    expect(script.archyYaml).toContain('defaultLanguage: de-de');
    expect(script.archyYaml).toContain('startUpRef: "/inboundCall/tasks/task[Main_Task]"');
    expect(script.archyYaml).toContain('name: avayaOriginScript');
    expect(script.archyYaml).not.toContain('name: Flow.avayaOriginScript');
    expect(script.archyYaml).toContain('playAudio:');
    expect(script.archyYaml).toContain('Prompt.S_1001');
    expect(script.archyYaml).toContain('transferToAcd:');
    expect(script.archyYaml).toContain('targetQueue:');
    expect(script.archyYaml).toContain('Sales_DE');
    // Unreachable DISCONNECT after terminal transferToAcd is cleanly pruned
    expect(script.metrics.prunedDeadPathCount).toBe(1);
    expect(script.archyYaml).not.toContain('- disconnect:');

    // Genesys Mermaid flowchart TD check
    expect(script.genesysMermaid).toMatch(/^flowchart TD/);
    expect(script.genesysMermaid).toContain('Play Audio');
    expect(script.genesysMermaid).toContain('ACD Queue: Sales_DE');
    expect(script.genesysMermaid).toContain('classDef ');
  });

  it('distinguishes EXECUTE (< 3 callers -> callTask) vs EXECUTE (>= 3 callers -> callCommonModule)', () => {
    const helperRare = makeModule('Helper_Rare', `SECTION S1\nGIVE RAN 2001\nROUTE END\n`);
    const helperCommon = makeModule('Feiertag_Check', `SECTION S1\nGIVE RAN 2002\nROUTE END\n`);

    const caller1 = makeModule(
      'Entry_A',
      `SECTION Start\nEXECUTE Helper_Rare\nEXECUTE Feiertag_Check\nDISCONNECT\n`
    );
    const caller2 = makeModule(
      'Entry_B',
      `SECTION Start\nEXECUTE Feiertag_Check\nDISCONNECT\n`
    );
    const caller3 = makeModule(
      'Entry_C',
      `SECTION Start\nEXECUTE Feiertag_Check\nDISCONNECT\n`
    );

    const ws = buildScriptWorkspace([caller1, caller2, caller3, helperRare, helperCommon]);
    const res = translateAvayaWorkspaceToGenesys(ws);

    const entryA = res.scriptsByKey['entry_a'];
    const commonMod = res.scriptsByKey['feiertag_check'];
    const rareMod = res.scriptsByKey['helper_rare'];

    expect(commonMod.incomingCallCount).toBeGreaterThanOrEqual(3);
    expect(commonMod.isCommonModuleTarget).toBe(true);
    expect(rareMod.incomingCallCount).toBeLessThan(3);
    expect(rareMod.isCommonModuleTarget).toBe(false);

    // Entry_A should emit callTask for Helper_Rare and callCommonModule for Feiertag_Check
    expect(entryA.actions.some((a) => a.kind === 'callTask')).toBe(true);
    expect(entryA.actions.some((a) => a.kind === 'callCommonModule')).toBe(true);
    expect(entryA.archyYaml).toContain('callTask:');
    expect(entryA.archyYaml).toContain('targetTaskRef:');
    expect(entryA.archyYaml).toContain('callCommonModule:');
    expect(entryA.genesysMermaid).toContain('Common Module');
    expect(entryA.yamlValidation.isValid).toBe(true);
    expect(res.summary.yamlErrorCount).toBe(0);
  });

  it('detects backward GOTO loops -> Loop action + explicit warning + HIGH readiness', () => {
    const loopMod = makeModule(
      'Retry_Menu',
      `
SECTION Menu_Start
  GIVE RAN 3001
  COLLECT 1 DIGITS
  IF DIGITS = 9 THEN GOTO Menu_Start
  DISCONNECT
`
    );

    const ws = buildScriptWorkspace([loopMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const script = res.scripts[0];

    expect(script.readiness).toBe('HIGH');
    expect(script.metrics.backwardGotoCount).toBeGreaterThanOrEqual(1);
    expect(script.actions.some((a) => a.kind === 'loop')).toBe(true);
    expect(script.actions.some((a) => a.kind === 'collectInput')).toBe(true);
    expect(
      script.warnings.some(
        (w) =>
          w.code === 'BACKWARD_GOTO_LOOP' &&
          w.message.includes('Unstrukturiertes Rückwärts-GOTO in Loop umbauen')
      )
    ).toBe(true);
    expect(script.archyYaml).toContain('loop:');
    expect(script.archyYaml).toContain('maxLoopCount:');
    expect(script.archyYaml).toContain('collectInput:');
    expect(script.archyYaml).toContain('Task.collectedDigits');
    expect(script.yamlValidation.isValid).toBe(true);
  });

  it('detects multi-skillset QUEUE TO SKILLSET A, B, C -> Transfer to ACD + Bullseye skills + warning + HIGH readiness', () => {
    const multiQueueMod = makeModule(
      'Multi_Queue_Script',
      `
SECTION Start
  QUEUE TO SKILLSET Sales_DE, Support_DE, VIP_DE
  DISCONNECT
`
    );

    const ws = buildScriptWorkspace([multiQueueMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const script = res.scripts[0];

    expect(script.readiness).toBe('HIGH');
    expect(script.metrics.hasMultiSkillset).toBe(true);
    expect(script.warnings.some((w) => w.code === 'MULTI_SKILLSET_BULLSEYE')).toBe(true);
    expect(script.archyYaml).toContain('transferToAcd:');
    expect(script.archyYaml).toContain('skills:');
    expect(script.archyYaml).toContain('Sales_DE');
    expect(script.archyYaml).toContain('Support_DE');
    expect(script.archyYaml).toContain('VIP_DE');
    expect(script.yamlValidation.isValid).toBe(true);
  });

  it('maps Oracle HOST/SEND REQUEST, FlixCheck, CV_* Participant Data, GV_*/LV_* updateData, and GIVE CDN transferToNumber', () => {
    const apiMod = makeModule(
      'Api_Router',
      `
GLOBAL GV_Region
VAR LV_Retry
SET CV_Kundennummer = "12345"
SET GV_Region = "Nord"
SET LV_Retry = "1"
SECTION Check_Api
  SEND REQUEST Oracle_Check_Customer
  EXECUTE FlixCheck_Deflection
  GIVE CDN 4711
`
    );

    const ws = buildScriptWorkspace([apiMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const script = res.scripts[0];

    expect(script.readiness).toBe('MEDIUM');
    expect(script.metrics.oracleApiCount).toBeGreaterThanOrEqual(1);
    expect(script.metrics.flixcheckApiCount).toBeGreaterThanOrEqual(1);
    expect(script.metrics.callVariableCount).toBeGreaterThanOrEqual(1);

    expect(script.archyYaml).toContain('callDataAction:');
    expect(script.archyYaml).toContain('category: "Oracle_Integration"');
    expect(script.archyYaml).toContain('category: "FlixCheck_API"');
    expect(script.archyYaml).toContain('setParticipantData:');
    expect(script.archyYaml).toContain('updateData:');
    expect(script.archyYaml).toContain('Flow.GV_Region');
    expect(script.archyYaml).toContain('Task.LV_Retry');
    // Short internal Avaya CDN 4711 is normalized to ACD Queue target CDN_4711 (not raw PSTN transferToNumber)
    expect(script.archyYaml).toContain('transferToAcd:');
    expect(script.archyYaml).toContain('CDN_4711');

    expect(script.genesysMermaid).toContain('Data Action: Oracle');
    expect(script.genesysMermaid).toContain('Data Action: FlixCheck');
    expect(script.yamlValidation.isValid).toBe(true);
  });

  it('translates all 6 extended Avaya telephony blocks into strict valid Archy YAML & Genesys Mermaid', () => {
    const telephonyMod = makeModule(
      'Telephony_Full_Suite',
      `
SECTION Opening_Check
  IF DAY OF WEEK = MONDAY AND TIME OF DAY 08:00..18:00 THEN
    GIVE MUSIC 501
    WAIT 15
  END IF
  IF HOLIDAY THEN
    GIVE BUSY
  END IF
SECTION Routing_And_Control
  IF EMERGENCY THEN
    DISCONNECT
  END IF
  LOOKUP Routing_Table_DE
  SET LANGUAGE en-us
  ASSIGN 5 TO PRIORITY
  IF EXPECTED WAIT TIME > 120 THEN
    OFFER CALLBACK Sales_Queue
  END IF
  IF LOGGED AGENTS Sales_Queue = 0 THEN
    VOICEMAIL Support_Box
  END IF
  SET GV_Caller = CLID
  SET GV_Called = DNIS
  SET UUI = "CUST-9988"
  QUEUE TO SKILLSET Sales_Queue WITH PRIORITY 3
`
    );

    const ws = buildScriptWorkspace([telephonyMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const script = res.scripts[0];

    // Block 1: Schedule Group
    expect(script.actions.some((a) => a.kind === 'evaluateScheduleGroup')).toBe(true);
    expect(script.archyYaml).toContain('evaluateScheduleGroup:');
    expect(script.archyYaml).toContain('scheduleGroup:');
    expect(script.archyYaml).toContain('holiday:');

    // Block 2: Hold Music, Delay & Busy
    expect(script.actions.some((a) => a.kind === 'playHoldMusic')).toBe(true);
    expect(script.actions.some((a) => a.kind === 'delay')).toBe(true);
    expect(script.archyYaml).toContain('playHoldMusic:');
    expect(script.archyYaml).toContain('delay:');
    expect(script.warnings.some((w) => w.code === 'IN_QUEUE_FLOW_REQUIRED')).toBe(true);

    // Block 3: Priority, EWT & Logged Agents
    expect(script.actions.some((a) => a.kind === 'setPriority')).toBe(true);
    expect(script.archyYaml).toContain('setPriority:');
    expect(script.archyYaml).toContain('Call.EstimatedWaitTime');
    expect(script.archyYaml).toContain('category: "Genesys_Cloud_Data_Actions"');
    expect(script.archyYaml).toContain('dataAction: "Get_Queue_Observations"');
    expect(script.warnings.some((w) => w.code === 'QUEUE_OBSERVATIONS_API')).toBe(true);

    // Block 4: Callback, Voicemail & Language
    expect(script.actions.some((a) => a.kind === 'createCallback')).toBe(true);
    expect(script.actions.some((a) => a.kind === 'transferToVoicemail')).toBe(true);
    expect(script.actions.some((a) => a.kind === 'setLanguage')).toBe(true);
    expect(script.archyYaml).toContain('createCallback:');
    expect(script.archyYaml).toContain('transferToVoicemail:');
    expect(script.archyYaml).toContain('setLanguage:');
    expect(script.archyYaml).toContain('lit: "en-us"');

    // Block 5: Emergency & Data Table Lookup
    expect(script.actions.some((a) => a.isEmergencyCheck)).toBe(true);
    expect(script.actions.some((a) => a.kind === 'callDataTableLookup')).toBe(true);
    expect(script.archyYaml).toContain('Flow.emergencyOverride == true');
    expect(script.archyYaml).toContain('callDataTableLookup:');
    expect(script.warnings.some((w) => w.code === 'EMERGENCY_GROUP_REQUIRED')).toBe(true);

    // Block 6: System variables CLID / DNIS / UUI
    expect(script.archyYaml).toContain('Call.Ani');
    expect(script.archyYaml).toContain('Call.Dnis');
    expect(script.actions.some((a) => a.kind === 'setUuiData')).toBe(true);
    expect(script.archyYaml).toContain('setUuiData:');
    expect(script.archyYaml).toContain('Call.UserToUserInformation');

    // Mermaid classes present
    expect(script.genesysMermaid).toContain('classDef gcSchedule');
    expect(script.genesysMermaid).toContain('classDef gcCallback');
    expect(script.genesysMermaid).toContain('classDef gcDataTable');

    // Generated Archy YAML must pass full schema validation with 0 errors
    const validation = validateArchyYaml(script.archyYaml);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(script.yamlValidation.isValid).toBe(true);
  });

  it('produces YAML-safe Archy slugs and builds an in-memory ZIP bundle of all Archy YAMLs', async () => {
    expect(toArchySlug('Öffnungszeiten / Prüfung 01.s')).toBe('Oeffnungszeiten_Pruefung_01');
    expect(toArchySlug('4711_Main.s')).toBe('S_4711_Main');

    const modA = makeModule('Main_Entry', `SECTION S1\nGIVE RAN 100\nQUEUE TO SKILLSET Team_A\nDISCONNECT\n`);
    const modB = makeModule('Sub_Info', `SECTION S1\nGIVE RAN 200\nROUTE END\n`);
    const ws = buildScriptWorkspace([modA, modB]);
    const res = translateAvayaWorkspaceToGenesys(ws);

    expect(res.summary.yamlValidScriptCount).toBe(2);
    expect(res.summary.yamlErrorCount).toBe(0);

    const zipBlob = await exportAllArchyYamlsZipBlob(res);
    expect(zipBlob.size).toBeGreaterThan(100);

    const arrayBuf = await zipBlob.arrayBuffer();
    const loadedZip = await JSZip.loadAsync(arrayBuf);
    const fileNames = Object.keys(loadedZip.files);
    expect(fileNames.some((n) => n.endsWith('.yaml'))).toBe(true);
    expect(fileNames.some((n) => n.startsWith('migration-graphs/') && n.endsWith('.graph.json'))).toBe(true);
    expect(fileNames).toContain('genesys-overview.mmd');
    expect(fileNames).toContain('README.md');
  });

  it('embeds Avaya <-> Genesys toggle & YAML validation payload cleanly in exported Callflow.html with valid executable JS', () => {
    const avayaGraph = parseCallflowGraph('flowchart LR\n  A["Avaya Start"] --> B["Queue"]\n');
    const genesysGraph = parseCallflowGraph('flowchart TD\n  G1(["Inbound Call Flow"]) --> G2[("ACD Queue: Sales")]\n');

    const html = generateInteractiveCallflowHtml(
      'Test Callflow',
      '<svg viewBox="0 0 200 100"><g class="node" id="flowchart-A-0"><rect width="80" height="40"/></g></svg>',
      avayaGraph,
      'dark',
      {
        views: [
          {
            key: 'master',
            label: 'Ebene 1: Master',
            svg: '<svg viewBox="0 0 200 100"><g class="node" id="flowchart-A-0"><rect width="80" height="40"/></g></svg>',
            graph: avayaGraph,
            genesysSvg:
              '<svg viewBox="0 0 200 100"><g class="node" id="flowchart-G1-0"><rect width="80" height="40"/></g></svg>',
            genesysGraph,
            genesysReadiness: 'MEDIUM',
            genesysReadinessReasons: ['Oracle Data Action'],
            genesysWarnings: [
              {
                code: 'BACKWARD_GOTO_LOOP',
                severity: 'warning',
                message: 'Unstrukturiertes Rückwärts-GOTO in Loop umbauen',
              },
            ],
            genesysArchyYaml: 'inboundCall:\n  name: Test_Flow\n  defaultLanguage: de-de\n',
            genesysArchyFilename: 'Test_Flow.yaml',
            genesysYamlValidation: {
              isValid: true,
              errorCount: 0,
              warningCount: 0,
              validScriptCount: 1,
              totalScriptCount: 1,
              errors: [],
              warnings: [],
            },
          },
        ],
        activeViewKey: 'master',
      }
    );

    expect(html).toContain('id="platform-mode-group"');
    expect(html).toContain('data-platform="genesys"');
    expect(html).toContain('id="genesys-subbar"');
    expect(html).toContain('id="btn-genesys-yaml-status"');
    expect(html).toContain('id="genesys-validation-drawer"');
    expect(html).toContain('Test_Flow.yaml');

    // Verify embedded JS parses without any syntax error
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();
    expect(() => new Function(scriptMatch![1])).not.toThrow();
  });
});

describe('validateArchyYaml — Strict Archy YAML Schema Validator', () => {
  it('rejects empty YAML content', () => {
    const res = validateArchyYaml('   \n# nur kommentar\n');
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.code === 'EMPTY_YAML')).toBe(true);
  });

  it('detects TAB indentation, odd indentation, and unclosed quotes', () => {
    const badYaml = [
      'inboundCall:',
      '\tname: Bad_Tab_Flow',
      '   description: "Unclosed quote',
      '  defaultLanguage: de-de',
      '  startUpRef: "/inboundCall/tasks/task[Main_Task]"',
      '  tasks:',
      '    - task:',
      '        name: Main_Task',
      '        refId: Main_Task',
      '        actions:',
      '          - disconnect:',
      '              name: "End"',
    ].join('\n');

    const res = validateArchyYaml(badYaml);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.code === 'TAB_INDENTATION')).toBe(true);
    expect(res.errors.some((e) => e.code === 'ODD_INDENTATION')).toBe(true);
    expect(res.errors.some((e) => e.code === 'UNCLOSED_QUOTE')).toBe(true);
  });

  it('detects missing inboundCall root, unknown top-level keys, and invalid language/name', () => {
    const missingRoot = validateArchyYaml('outboundCall:\n  name: Foo\n');
    expect(missingRoot.isValid).toBe(false);
    expect(missingRoot.errors.some((e) => e.code === 'UNKNOWN_ROOT_KEY')).toBe(true);
    expect(missingRoot.errors.some((e) => e.code === 'MISSING_ROOT_INBOUND_CALL')).toBe(true);

    const badTopLevel = [
      'inboundCall:',
      '  name: 123 Bad Flow!',
      '  defaultLanguage: deutsch',
      '  startUpRef: "Main_Task"',
      '  inventedKey: true',
      '  tasks:',
      '    - task:',
      '        name: Main_Task',
      '        refId: Main_Task',
      '        actions:',
      '          - disconnect:',
      '              name: "End"',
    ].join('\n');

    const res = validateArchyYaml(badTopLevel);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.code === 'INVALID_FLOW_NAME')).toBe(true);
    expect(res.errors.some((e) => e.code === 'INVALID_LANGUAGE_CODE')).toBe(true);
    expect(res.errors.some((e) => e.code === 'INVALID_REF_SYNTAX')).toBe(true);
    expect(res.errors.some((e) => e.code === 'UNKNOWN_TOP_LEVEL_KEY')).toBe(true);
  });

  it('rejects invented action types, unknown action properties, missing required properties, and invalid maxLoopCount', () => {
    const invalidActionsYaml = [
      'inboundCall:',
      '  name: Invalid_Actions_Flow',
      '  description: "Test"',
      '  defaultLanguage: de-de',
      '  startUpRef: "/inboundCall/tasks/task[Main_Task]"',
      '  tasks:',
      '    - task:',
      '        name: Main_Task',
      '        refId: Main_Task',
      '        actions:',
      '          - customAvayaMagicAction:',
      '              name: "Invented"',
      '          - transferToAcd:',
      '              name: "Queue without targetQueue"',
      '              unknownProp: "nope"',
      '          - loop:',
      '              name: "Bad Loop"',
      '              maxLoopCount:',
      '                lit: 0',
      '              outputs:',
      '                loop:',
      '                  actions: []',
    ].join('\n');

    const res = validateArchyYaml(invalidActionsYaml);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.code === 'UNKNOWN_ACTION_TYPE')).toBe(true);
    expect(res.errors.some((e) => e.code === 'UNKNOWN_ACTION_PROPERTY')).toBe(true);
    expect(res.errors.some((e) => e.code === 'MISSING_ACTION_PROPERTY')).toBe(true);
    expect(res.errors.some((e) => e.code === 'INVALID_ACTION_VALUE')).toBe(true);
  });

  it('catches unresolved startUpRef, unresolved callTask.targetTaskRef, duplicate refIds, and invalid variable scopes', () => {
    const brokenRefsYaml = [
      'inboundCall:',
      '  name: Broken_Refs_Flow',
      '  description: "Test"',
      '  defaultLanguage: de-de',
      '  startUpRef: "/inboundCall/tasks/task[Missing_Main]"',
      '  variables:',
      '    - stringVariable:',
      '        name: Global.notAllowedScope',
      '        initialValue:',
      '          lit: "x"',
      '    - stringVariable:',
      '        name: Flow.dupVar',
      '        initialValue:',
      '          lit: "a"',
      '    - stringVariable:',
      '        name: Flow.dupVar',
      '        initialValue:',
      '          lit: "b"',
      '  tasks:',
      '    - task:',
      '        name: Task_A',
      '        refId: Task_A',
      '        actions:',
      '          - callTask:',
      '              name: "Call Ghost Task"',
      '              targetTaskRef: "/inboundCall/tasks/task[Ghost_Task]"',
      '    - task:',
      '        name: Task_A_Copy',
      '        refId: Task_A',
      '        actions:',
      '          - disconnect:',
      '              name: "End"',
    ].join('\n');

    const res = validateArchyYaml(brokenRefsYaml);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.code === 'UNRESOLVED_STARTUP_REF')).toBe(true);
    expect(res.errors.some((e) => e.code === 'UNRESOLVED_TASK_REF')).toBe(true);
    expect(res.errors.some((e) => e.code === 'DUPLICATE_TASK_REF_ID')).toBe(true);
    expect(res.errors.some((e) => e.code === 'INVALID_VARIABLE_SCOPE')).toBe(true);
    expect(res.errors.some((e) => e.code === 'DUPLICATE_VARIABLE')).toBe(true);
  });

  it('keeps Avaya AACC core parsing (Skillsets/CDN, Zeitplaene, EXECUTE/SECTION/GOTO, Ansagen/Menues/Variablen/Oracle/FlixCheck) 100% intact and unmutated by Genesys translation', () => {
    const mainRaw = `
/* Einstiegsskript 514200 — Hauptrouting */
ASSIGN "Kunde" TO CV_Segment
ASSIGN "Aktiv" TO GV_HotlineStatus
ASSIGN "0" TO LV_RetryCount

IF DAY OF WEEK = MONDAY..FRIDAY AND TIME OF DAY = 08:00..18:00 THEN
  EXECUTE Sys_SondZeit
  GIVE RAN 1001
  OPEN VOICE SESSION
    PLAY PROMPT VOICE SEGMENT 2001
    COLLECT 1 DIGITS INTO LV_MenuChoice
  END VOICE SESSION
  WHERE LV_MenuChoice EQUALS
    VALUE "1":
      EXECUTE Sub_OracleCheck
    VALUE "2":
      QUEUE TO SKILLSET Sales_DE
    DEFAULT:
      ROUTE CALL 520100
  END WHERE
ELSE
  GIVE RAN 1099
  DISCONNECT
END IF

SECTION Fallback_Sec
  GIVE MUSIC 501
  WAIT 10
  GOTO Fallback_Sec
`;
    const subRaw = `
/* Sub_OracleCheck — Oracle + FlixCheck + Skillset */
ASSIGN "https://oracle.local/v1/customer" TO CV_OracleUrl
EXECUTE FlixCheck_Webhook
QUEUE TO SKILLSET Support_VIP
`;

    const mainMods = parseCallflowTextWithFallback(mainRaw, {
      defaultScriptNumber: '514200',
      defaultScriptName: 'Main_Hotline',
      origin: 'legacy-text',
      isMasterHint: true,
    });
    const subMods = parseCallflowTextWithFallback(subRaw, {
      defaultScriptNumber: 'Sub_OracleCheck',
      defaultScriptName: 'Sub_OracleCheck',
      origin: 'legacy-text',
    });

    expect(mainMods.length).toBeGreaterThan(0);
    expect(subMods.length).toBeGreaterThan(0);

    const ws = buildScriptWorkspace([...mainMods, ...subMods]);
    const wsSnapshotBefore = JSON.stringify(ws);

    // Avaya Master + Detail diagrams must cleanly recognize all core Avaya elements
    const masterMermaid = buildMasterOverviewMermaid(ws, 'LR');
    const detailMermaid = buildScriptDetailMermaid(ws, '514200', 'LR');
    expect(masterMermaid).toContain('flowchart LR');
    expect(masterMermaid).toContain('514200');
    expect(detailMermaid).toContain('flowchart LR');
    expect(detailMermaid).toMatch(/Sales_DE|1001|520100|Sub_OracleCheck/);

    // Genesys translation must be 100% read-only and never mutate the Avaya ScriptWorkspace
    const genesys = translateAvayaWorkspaceToGenesys(ws);
    expect(JSON.stringify(ws)).toBe(wsSnapshotBefore);
    expect(genesys.scripts.length).toBe(ws.modules.length);
    expect(genesys.summary.yamlErrorCount).toBe(0);
  });

  it('ignores keywords inside comments (/* */, //, --, leading #) without breaking inline DTMF #', () => {
    const commentedMod = makeModule(
      'Comment_Isolation',
      `
/* HOLIDAY EMERGENCY WAIT 30 ORACLE CLID DNIS CALLBACK VOICEMAIL QUEUE TO SKILLSET Fake1 */
// QUEUE TO SKILLSET Fake2
-- TRANSFER TO VOICEMAIL Fake3
# SCHEDULE GROUP Fake4
SECTION Start
  GIVE RAN 1005
  IF LV_Digit = # THEN
    QUEUE TO SKILLSET Real_Queue_DE
  END IF
  DISCONNECT
`
    );

    const ws = buildScriptWorkspace([commentedMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const script = res.scripts[0];

    expect(script.yamlValidation.isValid).toBe(true);
    expect(script.archyYaml).toContain('Real_Queue_DE');
    expect(script.archyYaml).not.toContain('Fake1');
    expect(script.archyYaml).not.toContain('Fake2');
    expect(script.archyYaml).not.toContain('Fake3');
    expect(script.archyYaml).not.toContain('Fake4');
    expect(script.metrics.oracleApiCount).toBe(0);
    expect(script.metrics.externalApiCount).toBe(0);
    expect(script.warnings).toHaveLength(0);
    expect(
      script.actions.some((a) =>
        [
          'evaluateScheduleGroup',
          'dataTableLookup',
          'createCallback',
          'transferToVoicemail',
          'callDataAction',
          'holdMusic',
          'wait',
        ].includes(a.kind)
      )
    ).toBe(false);
  });

  it('v2 Level-1 Graph -> Level-2 Renderer: real branching expressions, terminal dead-path pruning, clean Flow/Task variable scoping, E.164 vs CDN normalization, populated schedule/input/dataAction branches, hydrated subtasks, and unique action names', () => {
    const mainMod = makeModule(
      'Schaden_Service_RHLD',
      `
SECTION Start
  IF DAY OF WEEK = MONDAY..FRIDAY AND TIME OF DAY = 08:00..18:00 THEN
    IF CDN = 7401 THEN
      EXECUTE Menu
      IF NOT FLIXCHECK_KFZ_Schaden_RHLD THEN
        TRANSFER TO 002218277279035
        TRANSFER TO 2510
        EXECUTE MobilNummerEingeben
      ELSE
        EXECUTE MobilNummerEingeben
        SEND REQUEST FlixCheck_Schaden
        QUEUE TO SKILLSET Schaden_KFZ
      END IF
    ELSE
      GIVE CDN 2510
    END IF
  ELSE
    GIVE RAN 9001
    DISCONNECT
    DISCONNECT
    IF COUNTER >= 3 THEN
      GIVE RAN 9999
    END IF
  END IF
`
    );

    const menuMod = makeModule(
      'Menu',
      `
SECTION Menu_Main
  GIVE RAN 3010
  COLLECT 1 DIGITS INTO LV_Choice
  WHERE LV_Choice EQUALS
    VALUE "1":
      QUEUE TO SKILLSET KFZ_Team
    VALUE "2":
      QUEUE TO SKILLSET Sach_Team
    DEFAULT:
      DISCONNECT
  END WHERE
`
    );

    const mobileMod = makeModule(
      'MobilNummerEingeben',
      `
SECTION Mobile_Entry
  GIVE RAN 3020
  COLLECT DIGITS INTO LV_MobileNr
  IF LV_MobileNr <> "" THEN
    SET CV_Mobilnummer = "OK"
  ELSE
    DISCONNECT
  END IF
`
    );

    const ws = buildScriptWorkspace([mainMod, menuMod, mobileMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const main = res.scriptsByKey['schaden_service_rhld'];

    expect(main).toBeDefined();
    expect(main.yamlValidation.isValid).toBe(true);
    expect(main.yamlValidation.errors).toHaveLength(0);

    // 1. ZERO dummy Flow.avayaCondition == "true" placeholders!
    expect(main.archyYaml).not.toContain('Flow.avayaCondition');
    // Real Architect expressions compiled from Avaya OCL
    expect(main.archyYaml).toContain('Call.Dnis == \\"7401\\"');
    expect(main.archyYaml).toContain('!Flow.FLIXCHECK_KFZ_Schaden_RHLD');

    // 2. Schedule Group has populated open, closed, holiday branches (never empty actions: [])
    expect(main.archyYaml).toContain('evaluateScheduleGroup:');
    expect(main.archyYaml).not.toMatch(/open:\s*\n\s*actions: \[\]/);
    expect(main.archyYaml).not.toMatch(/closed:\s*\n\s*actions: \[\]/);
    expect(main.archyYaml).not.toMatch(/holiday:\s*\n\s*actions: \[\]/);

    // 3. Terminal cutoff & dead-path pruning:
    //    - After TRANSFER TO 002218277279035 -> trailing TRANSFER TO 2510 & EXECUTE MobilNummerEingeben pruned
    //    - After first DISCONNECT in ELSE -> second DISCONNECT & trailing IF COUNTER >= 3 pruned
    expect(main.metrics.prunedDeadPathCount).toBeGreaterThanOrEqual(3);
    expect(main.archyYaml).not.toContain('Prompt.S_9999');

    // 4. Target normalization:
    //    - 002218277279035 -> canonical E.164 "+2218277279035" in transferToNumber
    //    - 2510 -> internal ACD Queue "CDN_2510" in transferToAcd (NOT raw PSTN transferToNumber)
    expect(main.archyYaml).toContain('lit: "+2218277279035"');
    expect(main.archyYaml).not.toContain('lit: "002218277279035"');
    expect(main.archyYaml).toContain('name: "CDN_2510"');
    expect(main.archyYaml).not.toContain('lit: "2510"');

    // 5. Clean Variable Scoping (Flow vs Task separated; NO Flow./Task. in declaration names)
    expect(main.archyYaml).toContain('name: avayaOriginScript');
    expect(main.archyYaml).toContain('name: FLIXCHECK_KFZ_Schaden_RHLD');
    expect(main.archyYaml).not.toMatch(/^\s+name:\s+(?:Flow|Task)\./m);
    // Task variables (LV_Choice, LV_MobileNr) live inside their respective tasks, NOT in inboundCall.variables
    const inboundVarsSection = main.archyYaml.split('  tasks:')[0];
    expect(inboundVarsSection).not.toContain('LV_Choice');
    expect(inboundVarsSection).not.toContain('LV_MobileNr');
    expect(inboundVarsSection).not.toContain('collectedDigits');

    // 6. Data Action has full inputs, successOutputs, and success/failure/timeout branches
    expect(main.archyYaml).toContain('category: "FlixCheck_API"');
    expect(main.archyYaml).toContain('inputs:');
    expect(main.archyYaml).toContain('successOutputs:');
    expect(main.archyYaml).toContain('timeout:');

    // 7. Hydrated Reusable Tasks (Menu & MobilNummerEingeben contain REAL translated logic, not dummy stubs!)
    expect(main.archyYaml).not.toContain('Subtask Placeholder');
    expect(main.archyYaml).toContain('refId: Menu');
    expect(main.archyYaml).toContain('refId: MobilNummerEingeben');
    expect(main.archyYaml).toContain('numberOfDigits:');
    expect(main.archyYaml).toContain('noEntryTimeout:');
    expect(main.archyYaml).toContain('terminatingCharacter:');
    expect(main.archyYaml).toContain('KFZ_Team');
    expect(main.archyYaml).toContain('Sach_Team');

    // 8. Unique action names (0 DUPLICATE_ACTION_NAME warnings!)
    expect(main.yamlValidation.warnings.some((w) => w.code === 'DUPLICATE_ACTION_NAME')).toBe(false);
    expect(main.yamlValidation.warnings.some((w) => w.code === 'PLACEHOLDER_CONDITION')).toBe(false);
    expect(main.yamlValidation.warnings.some((w) => w.code === 'EMPTY_DECISION_BRANCHES')).toBe(false);

    // 9. Graph-based Genesys Mermaid has real branch labels
    expect(main.genesysMermaid).toContain('|"Offen"|');
    expect(main.genesysMermaid).toContain('|"Geschlossen"|');
    expect(main.genesysMermaid).toContain('|"Feiertag"|');
    expect(main.genesysMermaid).toContain('|"Ja"|');
    expect(main.genesysMermaid).toContain('|"Nein"|');
  });

  it('recursive validator catches unreachable actions after terminal, scope prefixes in declarations, duplicate action names, and placeholder conditions inside nested branches', () => {
    const badNestedYaml = [
      'inboundCall:',
      '  name: Bad_Nested_Flow',
      '  defaultLanguage: de-de',
      '  startUpRef: "/inboundCall/tasks/task[Main_Task]"',
      '  variables:',
      '    - stringVariable:',
      '        name: Task.wrongScopeInFlow',
      '        initialValue:',
      '          lit: ""',
      '  tasks:',
      '    - task:',
      '        name: Main_Task',
      '        refId: Main_Task',
      '        actions:',
      '          - decision:',
      '              name: "Dummy Check"',
      '              condition:',
      '                exp: "Flow.avayaCondition == \\"true\\""',
      '              outputs:',
      '                yes:',
      '                  actions:',
      '                    - disconnect:',
      '                        name: "Disconnect Call"',
      '                    - disconnect:',
      '                        name: "Disconnect Call"',
      '                no:',
      '                  actions: []',
    ].join('\n');

    const res = validateArchyYaml(badNestedYaml);
    expect(res.isValid).toBe(false);
    expect(res.errors.some((e) => e.code === 'INVALID_VARIABLE_SCOPE')).toBe(true);
    expect(res.errors.some((e) => e.code === 'UNREACHABLE_AFTER_TERMINAL')).toBe(true);
    expect(res.warnings.some((w) => w.code === 'DUPLICATE_ACTION_NAME')).toBe(true);
    expect(res.warnings.some((w) => w.code === 'PLACEHOLDER_CONDITION')).toBe(true);
  });

  it('KPV_ADAC pattern: populates MCF_Blacklist_flag_cv & HDX_Resp_cv, blocks blind Section_BESETZT fall-through, inlines single-use sections, and produces scope-free flowIR v1.1', () => {
    const kpvMod = makeModule(
      'KPV_ADAC',
      `
SECTION Start
  IF MCF_Blacklist_flag_cv = "1" THEN
    GOTO BESETZT
  ELSE
    GOSUB GET_SCHALTER
    GOTO CHECK_RESPONSE
  END IF

SECTION BESETZT
  GIVE RAN 9001
  DISCONNECT

SECTION CHECK_RESPONSE
  WHERE HDX_Resp_cv EQUALS
    VALUE "OK":
      QUEUE TO SKILLSET ADAC_Service_DE
    VALUE "VIP":
      QUEUE TO SKILLSET ADAC_VIP_DE
    DEFAULT:
      TRANSFER TO 00498976760
  END WHERE
`
    );

    const ws = buildScriptWorkspace([kpvMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const script = res.scripts[0];

    expect(script).toBeDefined();
    expect(script.yamlValidation.isValid).toBe(true);
    expect(script.yamlValidation.errors).toHaveLength(0);

    // 1. No dummy checkResult or placeholder conditions anywhere
    expect(script.archyYaml).not.toContain('checkResult');
    expect(script.archyYaml).not.toContain('Flow.avayaCondition');

    // 2. MCF_Blacklist_flag_cv & HDX_Resp_cv recognized as Flow variables (suffix *_cv)
    expect(script.archyYaml).toContain('name: MCF_Blacklist_flag_cv');
    expect(script.archyYaml).toContain('name: HDX_Resp_cv');
    expect(script.archyYaml).not.toMatch(/^\s+name:\s+(?:Flow|Task)\./m);

    // 3. Variable provenance (strict honest default): NO invented callDataTableLookup/getParticipantData,
    //    transparent OFFENE MIGRATIONSFRAGE comment + VAR_USED_BEFORE_SET finding; lookup only in opt-in stub mode!
    expect(script.archyYaml).not.toContain('callDataTableLookup:');
    expect(script.archyYaml).not.toContain('getParticipantData:');
    expect(script.archyYaml).toContain('OFFENE MIGRATIONSFRAGE:');
    expect(script.archyYaml).toContain('Flow.MCF_Blacklist_flag_cv == \\"1\\"');
    expect(
      script.flowIR.findings.some(
        (f) => f.code === 'VAR_USED_BEFORE_SET' && f.variableName === 'MCF_Blacklist_flag_cv'
      )
    ).toBe(true);
    const stubKpv = translateAvayaWorkspaceToGenesys(ws, { compatibilityStubMode: true }).scripts[0];
    expect(stubKpv.archyYaml).toContain('callDataTableLookup:');

    // 4. Single-use sections BESETZT and CHECK_RESPONSE are inlined directly (no goto-style Section_BESETZT task)
    expect(script.migrationGraph.diagnostics.inlinedSectionCount).toBeGreaterThanOrEqual(2);
    expect(script.archyYaml).not.toContain('refId: Section_BESETZT');
    expect(script.archyYaml).not.toContain('refId: Section_CHECK_RESPONSE');
    // Positive blacklist path disconnects cleanly (no accidental fallthrough from normal path into BESETZT)
    expect(script.archyYaml).toContain('Prompt.S_9001');
    expect(script.archyYaml).toContain('ADAC_Service_DE');
    expect(script.archyYaml).toContain('lit: "+498976760"');

    // 5. Canonical flowIR v1.1 checks: scope-free expressions, sourceTrace & explicit terminal on every node
    expect(script.flowIR.meta.version).toBe('1.1');
    expect(script.flowIR.meta.sourceSystem).toBe('Avaya');
    expect(script.flowIR.meta.targetSystem).toBe('Genesys');
    for (const v of script.flowIR.variables) {
      expect(v.name).not.toMatch(/^(?:Flow|Task)\./);
      expect(v.sourceTrace).toBeDefined();
      expect(v.sourceTrace.script).toBe('KPV_ADAC.s');
    }
    for (const n of script.flowIR.nodes) {
      expect(typeof n.terminal).toBe('boolean');
      expect(n.sourceTrace).toBeDefined();
      expect(n.sourceTrace.script).toBe('KPV_ADAC.s');
      if (n.condition?.expr) {
        expect(n.condition.expr).not.toMatch(/\b(?:Flow|Task)\./);
      }
      if (n.kind === 'transfer') {
        expect(n.resolvedTargetType).toBeDefined();
      }
    }
    // Missing subflow GET_SCHALTER reported cleanly in flowIR findings
    expect(
      script.flowIR.findings.some((f) => f.code === 'MISSING_SUBFLOW_SOURCE')
    ).toBe(true);
  });

  it('unloaded domain subtasks (blacklist_vip, Check_Response, Custom_Helper) emit zero checkResult/DataTable stubs in strict default mode and gate stubs behind compatibilityStubMode', () => {
    const callerMod = makeModule(
      'Main_Subflow_Caller',
      `
SECTION Entry
  EXECUTE blacklist_vip
  EXECUTE Check_Response
  EXECUTE Custom_Helper
  QUEUE TO SKILLSET Support_DE
`
    );

    const ws = buildScriptWorkspace([callerMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const script = res.scripts[0];

    expect(script.yamlValidation.isValid).toBe(true);
    expect(script.yamlValidation.errors).toHaveLength(0);
    expect(script.archyYaml).not.toContain('checkResult');
    expect(script.archyYaml).not.toContain('callDataTableLookup:');
    expect(script.archyYaml).not.toContain('disconnect:');
    expect(script.archyYaml).toContain('callCommonModule:');
    expect(script.archyYaml).toContain('OFFENE MIGRATIONSFRAGE:');
    expect(
      script.yamlValidation.warnings.some((w) => w.code === 'DIAGNOSIS_ONLY_BRANCH')
    ).toBe(false);
    expect(
      script.yamlValidation.warnings.some((w) => w.code === 'PLACEHOLDER_CONDITION')
    ).toBe(false);
    expect(
      script.flowIR.findings.filter((f) => f.code === 'MISSING_SUBFLOW_SOURCE').length
    ).toBeGreaterThanOrEqual(3);

    const stubRes = translateAvayaWorkspaceToGenesys(ws, { compatibilityStubMode: true });
    const stubScript = stubRes.scripts[0];
    expect(stubScript.yamlValidation.isValid).toBe(true);
    expect(stubScript.archyYaml).toContain('callDataTableLookup:');
    expect(stubScript.archyYaml).toContain('KOMPATIBILITAETS-STUB (OPT-IN)');
  });

  it('keeps reused sections (>= 2 callers) as Reusable Tasks while inlining single-use sections', () => {
    const mod = makeModule(
      'Section_Reuse_Test',
      `
SECTION Entry
  IF DNIS = "1000" THEN
    GOTO Shared_Busy
  ELSE
    IF DNIS = "2000" THEN
      GOTO Shared_Busy
    ELSE
      GOTO Single_Only
    END IF
  END IF

SECTION Shared_Busy
  GIVE RAN 5001
  DISCONNECT

SECTION Single_Only
  GIVE RAN 5002
  QUEUE TO SKILLSET Sales_DE
`
    );

    const ws = buildScriptWorkspace([mod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const script = res.scripts[0];

    expect(script.yamlValidation.isValid).toBe(true);
    // Shared_Busy has 2 callers -> remains a Reusable Task
    expect(script.archyYaml).toContain('refId: Section_Shared_Busy');
    // Single_Only has 1 caller -> inlined directly into caller branch
    expect(script.archyYaml).not.toContain('refId: Section_Single_Only');
    expect(script.archyYaml).toContain('Prompt.S_5002');
    expect(script.archyYaml).toContain('Sales_DE');
    expect(script.migrationGraph.diagnostics.inlinedSectionCount).toBe(1);
  });

  it('validateIR catches all 10 binding v1.1 Findings-Codes plus structural graph errors', () => {
    const brokenIR: FlowIR = {
      meta: {
        flowId: 'Broken_IR_Test',
        sourceSystem: 'Avaya',
        targetSystem: 'Genesys',
        sourceScript: 'Broken_IR_Test.s',
        entryNodeId: 'n_start',
        language: 'de-de',
        version: '1.1',
      },
      variables: [
        {
          id: 'v_flag',
          name: 'uninitializedFlag',
          scope: 'flow',
          category: 'flow',
          type: 'string',
          initialValue: '',
          source: { origin: 'avaya', originalName: 'uninitializedFlag' },
          sourceTrace: { script: 'Broken_IR_Test.s', lineStart: 1, lineEnd: 1 },
          usedByNodes: ['n_dec_uninit'],
        },
        {
          id: 'v_switch',
          name: 'respCode',
          scope: 'flow',
          category: 'flow',
          type: 'string',
          initialValue: '',
          source: { origin: 'avaya', originalName: 'respCode' },
          sourceTrace: { script: 'Broken_IR_Test.s', lineStart: 2, lineEnd: 2 },
          usedByNodes: ['n_switch_nosrc'],
        },
      ],
      nodes: [
        {
          id: 'n_start',
          kind: 'entry',
          name: 'Start',
          terminal: false,
          parameters: {},
          sourceTrace: { script: 'Broken_IR_Test.s', lineStart: 1, lineEnd: 1 },
        },
        {
          id: 'n_dec_dummy',
          kind: 'decision',
          name: 'Dummy Decision',
          terminal: false,
          parameters: {},
          condition: { expr: 'avayaCondition == "true"' },
          sourceTrace: { script: 'Broken_IR_Test.s', lineStart: 5, lineEnd: 5 },
        },
        {
          id: 'n_dec_uninit',
          kind: 'decision',
          name: 'Uninit Check',
          terminal: false,
          parameters: {},
          condition: { expr: 'uninitializedFlag == "1"' },
          sourceTrace: { script: 'Broken_IR_Test.s', lineStart: 8, lineEnd: 8 },
        },
        {
          id: 'n_switch_nosrc',
          kind: 'switch',
          name: 'Switch Without Source',
          terminal: false,
          parameters: {},
          expression: { expr: 'respCode' },
          sourceTrace: { script: 'Broken_IR_Test.s', lineStart: 12, lineEnd: 12 },
        },
        {
          id: 'n_data_incomplete',
          kind: 'dataAction',
          name: 'Incomplete Data Action',
          terminal: false,
          parameters: {},
          integration: {
            type: 'webservice',
            sourceSystem: 'avaya',
            targetAction: 'CheckCustomer',
          },
          inputs: [{ name: 'ani', expr: 'Call.Ani' }],
          outputs: [],
          sourceTrace: { script: 'Broken_IR_Test.s', lineStart: 15, lineEnd: 15 },
        },
        {
          id: 'n_transfer_unresolved',
          kind: 'transfer',
          name: 'Unresolved Transfer',
          terminal: true,
          parameters: { target: '99999' },
          resolvedTargetType: 'unresolved',
          sourceTrace: { script: 'Broken_IR_Test.s', lineStart: 20, lineEnd: 20 },
        },
        {
          id: 'n_blind_section',
          kind: 'invokeSubflow',
          name: 'Jump Section_BESETZT',
          terminal: false,
          parameters: { target: 'Section_BESETZT' },
          sourceTrace: { script: 'Broken_IR_Test.s', lineStart: 25, lineEnd: 25 },
        },
        {
          id: 'n_end',
          kind: 'terminal',
          name: 'End',
          terminal: true,
          parameters: {},
          sourceTrace: { script: 'Broken_IR_Test.s', lineStart: 30, lineEnd: 30 },
        },
      ],
      transitions: [
        { from: 'n_start', to: 'n_dec_dummy', type: 'unconditional' },
        { from: 'n_dec_dummy', to: 'n_dec_uninit', type: 'whenTrue' },
        // Missing 'whenFalse' transition on n_dec_dummy -> EMPTY_BRANCH
        { from: 'n_dec_uninit', to: 'n_switch_nosrc', type: 'whenTrue' },
        { from: 'n_dec_uninit', to: 'n_data_incomplete', type: 'whenFalse' },
        { from: 'n_switch_nosrc', to: 'n_transfer_unresolved', type: 'default' },
        { from: 'n_data_incomplete', to: 'n_blind_section', type: 'success' },
        // Terminal transfer continues into non-terminal node -> TERMINAL_PATH_CONTINUES
        { from: 'n_transfer_unresolved', to: 'n_blind_section', type: 'unconditional' },
        { from: 'n_blind_section', to: 'n_end', type: 'unconditional' },
        // Terminal node has outgoing transition -> TERMINAL_HAS_OUTGOING
        { from: 'n_end', to: 'n_blind_section', type: 'unconditional' },
        // Broken target ref -> BROKEN_TRANSITION_REF
        { from: 'n_blind_section', to: 'n_does_not_exist', type: 'failure' },
      ],
      dependencies: {
        subflows: ['Section_BESETZT'],
        commonModules: [],
        dataActions: ['CheckCustomer'],
      },
      findings: [],
      renderingHints: {
        genesys: {
          preferReusableTasks: true,
          preferDecisionNodes: true,
          avoidGotoStyleSections: true,
        },
      },
    };

    const result = validateIR(brokenIR);
    const codes = new Set(result.findings.map((f) => f.code));

    expect(result.isValid).toBe(false);
    expect(codes.has('DUMMY_CONDITION')).toBe(true);
    expect(codes.has('MISSING_CONDITION_SOURCE')).toBe(true);
    expect(codes.has('EMPTY_BRANCH')).toBe(true);
    expect(codes.has('VAR_USED_BEFORE_SET')).toBe(true);
    expect(codes.has('SWITCH_WITHOUT_SOURCE')).toBe(true);
    expect(codes.has('UNRESOLVED_INTEGRATION_OUTPUT')).toBe(true);
    expect(codes.has('MISSING_ERROR_PATH')).toBe(true);
    expect(codes.has('MISSING_TIMEOUT_PATH')).toBe(true);
    expect(codes.has('UNRESOLVED_TRANSFER_TARGET')).toBe(true);
    expect(codes.has('TERMINAL_PATH_CONTINUES')).toBe(true);
    expect(codes.has('TERMINAL_HAS_OUTGOING')).toBe(true);
    expect(codes.has('SECTION_RENDERED_BLINDLY')).toBe(true);
    expect(codes.has('BROKEN_TRANSITION_REF')).toBe(true);
  });

  it('dual-mode renderAvayaView & renderGenesysView render a scope-free flowIR v1.1 with 4 structured report sections and scoped Genesys Archy YAML', () => {
    const cleanIR: FlowIR = {
      meta: {
        flowId: 'Customer_Lookup_Flow',
        sourceSystem: 'Avaya',
        targetSystem: 'Genesys',
        sourceScript: 'Customer_Lookup_Flow.s',
        entryNodeId: 'n_start',
        language: 'de-de',
        version: '1.1',
      },
      variables: [
        {
          id: 'v_caller',
          name: 'callerId',
          scope: 'flow',
          category: 'flow',
          type: 'string',
          initialValue: '',
          source: { origin: 'avaya', originalName: 'callerId' },
          sourceTrace: { script: 'Customer_Lookup_Flow.s', lineStart: 1, lineEnd: 1 },
          usedByNodes: ['n_lookup'],
        },
        {
          id: 'v_status',
          name: 'customerStatus',
          scope: 'task',
          category: 'task',
          owner: 'Main_Task',
          type: 'string',
          initialValue: '',
          source: { origin: 'avaya', originalName: 'customerStatus' },
          sourceTrace: { script: 'Customer_Lookup_Flow.s', lineStart: 2, lineEnd: 2 },
          usedByNodes: ['n_lookup', 'n_check'],
        },
      ],
      nodes: [
        {
          id: 'n_start',
          kind: 'entry',
          name: 'Start',
          terminal: false,
          parameters: {},
          sourceTrace: { script: 'Customer_Lookup_Flow.s', lineStart: 1, lineEnd: 1 },
        },
        {
          id: 'n_lookup',
          kind: 'dataAction',
          name: 'Customer Lookup',
          terminal: false,
          parameters: {},
          integration: {
            type: 'dbLookup',
            sourceSystem: 'avaya',
            targetAction: 'CustomerLookup',
            category: 'CRM_Integration',
          },
          inputs: [{ name: 'callerId', expr: 'callerId' }],
          outputs: [{ name: 'customerStatus', targetVariable: 'customerStatus' }],
          errorHandling: {
            onError: 'n_error_disc',
            onTimeout: 'n_timeout_disc',
          },
          sourceTrace: { script: 'Customer_Lookup_Flow.s', lineStart: 5, lineEnd: 8 },
        },
        {
          id: 'n_check',
          kind: 'decision',
          name: 'Check VIP Status',
          terminal: false,
          parameters: {},
          condition: { expr: 'customerStatus == "VIP"' },
          sourceTrace: { script: 'Customer_Lookup_Flow.s', lineStart: 10, lineEnd: 10 },
        },
        {
          id: 'n_vip_queue',
          kind: 'transfer',
          name: 'Transfer VIP Queue',
          terminal: true,
          parameters: { target: 'VIP_Queue_DE' },
          resolvedTargetType: 'queue',
          sourceTrace: { script: 'Customer_Lookup_Flow.s', lineStart: 11, lineEnd: 11 },
        },
        {
          id: 'n_std_ext',
          kind: 'transfer',
          name: 'Transfer Standard PSTN',
          terminal: true,
          parameters: { target: '+4989123456' },
          resolvedTargetType: 'externalNumber',
          sourceTrace: { script: 'Customer_Lookup_Flow.s', lineStart: 13, lineEnd: 13 },
        },
        {
          id: 'n_error_disc',
          kind: 'disconnect',
          name: 'Lookup Error Disconnect',
          terminal: true,
          parameters: {},
          sourceTrace: { script: 'Customer_Lookup_Flow.s', lineStart: 15, lineEnd: 15 },
        },
        {
          id: 'n_timeout_disc',
          kind: 'disconnect',
          name: 'Lookup Timeout Disconnect',
          terminal: true,
          parameters: {},
          sourceTrace: { script: 'Customer_Lookup_Flow.s', lineStart: 16, lineEnd: 16 },
        },
      ],
      transitions: [
        { from: 'n_start', to: 'n_lookup', type: 'unconditional' },
        { from: 'n_lookup', to: 'n_check', type: 'success' },
        { from: 'n_lookup', to: 'n_error_disc', type: 'failure' },
        { from: 'n_lookup', to: 'n_timeout_disc', type: 'timeout' },
        { from: 'n_check', to: 'n_vip_queue', type: 'whenTrue' },
        { from: 'n_check', to: 'n_std_ext', type: 'whenFalse' },
      ],
      dependencies: {
        subflows: [],
        commonModules: [],
        dataActions: ['CustomerLookup'],
      },
      findings: [],
      renderingHints: {
        genesys: {
          preferReusableTasks: true,
          preferDecisionNodes: true,
          avoidGotoStyleSections: true,
        },
      },
    };

    // 1. modus=avaya view
    const avayaView = renderAvayaView(cleanIR);
    expect(avayaView.mode).toBe('avaya');
    expect(avayaView.kurzfazit.length).toBeGreaterThan(10);
    expect(avayaView.annahmenUndOffenePunkte.length).toBeGreaterThan(0);
    expect(avayaView.migrationshinweise.length).toBeGreaterThan(0);
    expect(avayaView.markdownReport).toContain('## 1. Kurzfazit');
    expect(avayaView.ergebnisText).toContain('flowIR:');
    expect(avayaView.ergebnisText).toContain('version: "1.1"');
    expect(avayaView.ergebnisText).toContain('sourceTrace:');
    // Scope-free in Avaya IR view
    expect(avayaView.ergebnisText).toContain('expr: "customerStatus == \\"VIP\\""');

    // 2. modus=genesys direct IR rendering -> scopes applied ONLY during Genesys render
    const archyYaml = renderArchyYamlFromFlowIR(cleanIR);
    const genesysView = renderGenesysView(cleanIR, archyYaml);
    expect(genesysView.mode).toBe('genesys');
    expect(genesysView.markdownReport).toContain('## 1. Kurzfazit');
    expect(genesysView.ergebnisText).toContain('inboundCall:');
    expect(genesysView.ergebnisText).toContain('exp: "Flow.callerId"');
    expect(genesysView.ergebnisText).toContain('variable: Task.customerStatus');
    expect(genesysView.ergebnisText).toContain('exp: "Task.customerStatus == \\"VIP\\""');
    expect(genesysView.ergebnisText).toContain('transferToAcd:');
    expect(genesysView.ergebnisText).toContain('name: "VIP_Queue_DE"');
    expect(genesysView.ergebnisText).toContain('transferToNumber:');
    expect(genesysView.ergebnisText).toContain('lit: "+4989123456"');

    const yamlVal = validateArchyYaml(archyYaml);
    expect(yamlVal.isValid).toBe(true);
    expect(yamlVal.errors).toHaveLength(0);
  });

  it('ZIP export writes canonical flowIR v1.1 JSON into migration-graphs/*.graph.json', async () => {
    const mod = makeModule(
      'Zip_IR_Test',
      `
SECTION Start
  GIVE RAN 4001
  QUEUE TO SKILLSET Sales_DE
`
    );
    const ws = buildScriptWorkspace([mod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const blob = await exportAllArchyYamlsZipBlob(res);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    const graphFile = zip.file('migration-graphs/Zip_IR_Test.graph.json');
    expect(graphFile).toBeTruthy();
    const parsed = JSON.parse(await graphFile!.async('string'));
    expect(parsed.flowIR).toBeDefined();
    expect(parsed.flowIR.meta.version).toBe('1.1');
    expect(Array.isArray(parsed.flowIR.nodes)).toBe(true);
    expect(Array.isArray(parsed.flowIR.transitions)).toBe(true);
    expect(Array.isArray(parsed.flowIR.findings)).toBe(true);
  });

  it('L_CL_TOD pattern: transitively inlines chained sections with 0 UNRESOLVED_TASK_REF, uses Flow.HDX_Resp_cv directly without Task/getParticipantData, omits fabricated DataTable in strict default, and documents pruned uncalled BESETZT/GET_SCHALTER tasks', () => {
    const lClTodMod = makeModule(
      'L_CL_TOD',
      `
SECTION Start
  EXECUTE BLACKLIST_VIP
  GOTO STEP_QUERY

SECTION STEP_QUERY
  ASSIGN "25" TO HDX_QueryNum_cv
  GOTO STEP_CHECK

SECTION STEP_CHECK
  EXECUTE CHECK_RESPONSE

SECTION BESETZT
  EXECUTE BESETZT
  DISCONNECT

SECTION UNUSED_SCHALTER
  EXECUTE GET_SCHALTER
  DISCONNECT
`
    );

    const ws = buildScriptWorkspace([lClTodMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const script = res.scripts[0];

    expect(script).toBeDefined();
    // 1. 0 schema errors and 0 UNRESOLVED_TASK_REF (chained sections STEP_QUERY -> STEP_CHECK cleanly inlined!)
    expect(script.yamlValidation.isValid).toBe(true);
    expect(script.yamlValidation.errors).toHaveLength(0);
    expect(script.yamlValidation.errors.some((e) => e.code === 'UNRESOLVED_TASK_REF')).toBe(false);
    expect(script.archyYaml).not.toContain('Section_STEP_QUERY');
    expect(script.archyYaml).not.toContain('Section_STEP_CHECK');
    expect(script.archyYaml).not.toContain('Section_CHECK_RESPONSE');

    // 2. Uncalled subtasks BESETZT & GET_SCHALTER removed from productive YAML & documented in FlowIR
    expect(script.archyYaml).not.toContain('refId: BESETZT');
    expect(script.archyYaml).not.toContain('refId: GET_SCHALTER');
    expect(script.localReusableTasks.map((t) => t.refId)).toEqual(['BLACKLIST_VIP', 'CHECK_RESPONSE']);
    expect((script.flowIR.meta.prunedUnreachableTasks || []).length).toBeGreaterThanOrEqual(2);
    expect(script.flowIR.findings.some((f) => f.code === 'UNREACHABLE_TASK_PRUNED')).toBe(true);

    // 3. CHECK_RESPONSE directly evaluates Flow.HDX_Resp_cv (NO Task.HDX_Resp_cv, NO getParticipantData, NO invented callDataAction!)
    expect(script.archyYaml).toContain('refId: CHECK_RESPONSE');
    expect(script.archyYaml).toContain('Flow.HDX_Resp_cv == \\"SUCCESS\\"');
    expect(script.archyYaml).not.toContain('Task.HDX_Resp_cv');
    expect(script.archyYaml).not.toContain('getParticipantData:');
    expect(script.archyYaml).not.toContain('callDataAction:');
    expect(script.archyYaml).toContain(
      'OFFENE MIGRATIONSFRAGE: Flow.HDX_Resp_cv muss aus vorgeschaltetem Modul, Lookup oder externer Integration befuellt werden.'
    );

    // 4. Strict honest default delegates unloaded BLACKLIST_VIP cleanly without fabricating BLACKLIST_VIP_Table
    expect(script.archyYaml).toContain('refId: BLACKLIST_VIP');
    expect(script.archyYaml).not.toContain('BLACKLIST_VIP_Table');
    expect(script.archyYaml).not.toContain('Flow.MCF_Blacklist_flag_cv');

    // 5. Opt-in compatibilityStubMode enables Blacklist Data Table Lookup stub explicitly
    const stubRes = translateAvayaWorkspaceToGenesys(ws, { compatibilityStubMode: true });
    const stubScript = stubRes.scripts[0];
    expect(stubScript.archyYaml).toContain('BLACKLIST_VIP_Table');
    expect(stubScript.archyYaml).toContain('variable: Flow.MCF_Blacklist_flag_cv');
    expect(stubScript.archyYaml).toContain('KOMPATIBILITAETS-STUB (OPT-IN)');

    // 6. flowIR records transparent SWITCH_WITHOUT_SOURCE finding
    expect(script.flowIR.findings.some((f) => f.code === 'SWITCH_WITHOUT_SOURCE')).toBe(true);
  });

  it('Honest Migration default: maps Avaya date natively to GetCurrentDateTimeUtc(), omits getParticipantData for unproven Sys_Feiertagliste_NRW, flags POTENTIAL_BRANCH_FALLTHROUGH without inventing disconnect, and warns on parallel holiday logic', () => {
    const mainMod = makeModule(
      'Main_Holiday_Flow',
      `
SECTION Start
  IF TIME OF DAY 08:00..18:00 THEN
    GIVE RAN Begruessung
  ELSE
    GIVE RAN Geschlossen
    DISCONNECT
  END IF
  IF date = Sys_Feiertagliste_NRW THEN
    EXECUTE Feiertag
  END IF
  EXECUTE Callflow_1
  EXECUTE Nacht
  QUEUE TO SKILLSET Support_DE
`
    );

    const ws = buildScriptWorkspace([mainMod]);
    const strictRes = translateAvayaWorkspaceToGenesys(ws);
    const script = strictRes.scripts[0];

    expect(strictRes.compatibilityStubMode).toBe(false);
    expect(script).toBeDefined();
    expect(script.yamlValidation.isValid).toBe(true);
    expect(script.yamlValidation.errors).toHaveLength(0);

    // 1. Differentiated provenance: `date` -> native GetCurrentDateTimeUtc(), NO Flow.date, NO getParticipantData!
    expect(script.archyYaml).toContain('GetCurrentDateTimeUtc() == Flow.Sys_Feiertagliste_NRW');
    expect(script.archyYaml).not.toContain('Flow.date');
    expect(script.archyYaml).not.toContain('getParticipantData:');
    expect(script.archyYaml).toContain('OFFENE MIGRATIONSFRAGE: Quelle fuer "Flow.Sys_Feiertagliste_NRW"');
    expect(
      script.flowIR.findings.some(
        (f) => f.code === 'VAR_USED_BEFORE_SET' && f.variableName === 'Sys_Feiertagliste_NRW'
      )
    ).toBe(true);
    expect(
      script.flowIR.findings.some(
        (f) => f.code === 'VAR_USED_BEFORE_SET' && f.variableName?.toLowerCase() === 'date'
      )
    ).toBe(false);

    // 2. Evidence-based terminality: Feiertag is unloaded -> NO invented disconnect in Feiertag task or yes branch,
    //    fallthrough stays intact and emits POTENTIAL_BRANCH_FALLTHROUGH!
    const feiertagTask = script.migrationGraph.tasks.find((t) => t.refId === 'Feiertag');
    expect(feiertagTask).toBeDefined();
    expect(feiertagTask!.steps.some((s) => s.kind === 'disconnect')).toBe(false);
    expect(script.flowIR.findings.some((f) => f.code === 'POTENTIAL_BRANCH_FALLTHROUGH')).toBe(true);
    expect(script.warnings.some((w) => w.code === 'POTENTIAL_BRANCH_FALLTHROUGH')).toBe(true);
    expect(script.archyYaml).toContain('Kein disconnect erfunden');

    // 3. Parallel holiday logic: BOTH evaluateScheduleGroup.holiday AND explicit holiday decision preserved + DUPLICATE_HOLIDAY_LOGIC warning
    expect(script.archyYaml).toContain('evaluateScheduleGroup:');
    expect(script.archyYaml).toContain('holiday:');
    expect(script.archyYaml).toContain('Sys_Feiertagliste_NRW');
    expect(script.flowIR.findings.some((f) => f.code === 'DUPLICATE_HOLIDAY_LOGIC')).toBe(true);
    expect(script.warnings.some((w) => w.code === 'DUPLICATE_HOLIDAY_LOGIC')).toBe(true);
    expect(script.archyYaml).toContain('Moegliche doppelte Feiertagslogik');

    // 4. Opt-in Compatibility / Stub Mode synthesizes getParticipantData ONLY for unproven external var (still NOT for native date!)
    const stubRes = translateAvayaWorkspaceToGenesys(ws, { compatibilityStubMode: true });
    const stubScript = stubRes.scripts[0];
    expect(stubRes.compatibilityStubMode).toBe(true);
    expect(stubScript.yamlValidation.isValid).toBe(true);
    expect(stubScript.archyYaml).toContain('getParticipantData:');
    expect(stubScript.archyYaml).toContain('Get Participant Data Sys_Feiertagliste_NRW');
    expect(stubScript.archyYaml).not.toContain('Get Participant Data date');
    expect(stubScript.archyYaml).toContain('KOMPATIBILITAETS-STUB (OPT-IN)');
  });

  it('Evidence-based terminality: loaded Feiertag.s ending in DISCONNECT is recognized as provably terminal without false POTENTIAL_BRANCH_FALLTHROUGH', () => {
    const mainMod = makeModule(
      'Main_With_Terminal_Feiertag',
      `
SECTION Start
  IF date = Sys_Feiertagliste_NRW THEN
    EXECUTE Feiertag
  END IF
  QUEUE TO SKILLSET Support_DE
`
    );
    const feiertagMod = makeModule(
      'Feiertag',
      `
SECTION Start
  GIVE RAN Feiertag_Ansage
  DISCONNECT
`
    );

    const ws = buildScriptWorkspace([mainMod, feiertagMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const mainScript = res.scripts.find((s) => s.cleanName === 'Main_With_Terminal_Feiertag')!;

    expect(mainScript).toBeDefined();
    expect(mainScript.yamlValidation.isValid).toBe(true);
    // Hydrated Feiertag task contains the real proven DISCONNECT from Feiertag.s
    const feiertagTask = mainScript.migrationGraph.tasks.find((t) => t.refId === 'Feiertag');
    expect(feiertagTask).toBeDefined();
    expect(feiertagTask!.steps.some((s) => s.kind === 'disconnect')).toBe(true);
    // Because terminality is proven from loaded Avaya source, NO false fallthrough finding!
    expect(
      mainScript.flowIR.findings.some((f) => f.code === 'POTENTIAL_BRANCH_FALLTHROUGH')
    ).toBe(false);
    expect(mainScript.warnings.some((w) => w.code === 'POTENTIAL_BRANCH_FALLTHROUGH')).toBe(false);
  });

  it('Evidence-based terminality: loaded non-terminal Feiertag.s (audio only, no DISCONNECT) keeps fallthrough and emits POTENTIAL_BRANCH_FALLTHROUGH', () => {
    const mainMod = makeModule(
      'Main_With_NonTerminal_Feiertag',
      `
SECTION Start
  IF date = Sys_Feiertagliste_NRW THEN
    EXECUTE Feiertag
  END IF
  QUEUE TO SKILLSET Support_DE
`
    );
    const feiertagMod = makeModule(
      'Feiertag',
      `
SECTION Start
  GIVE RAN Feiertag_Ansage
`
    );

    const ws = buildScriptWorkspace([mainMod, feiertagMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const mainScript = res.scripts.find((s) => s.cleanName === 'Main_With_NonTerminal_Feiertag')!;

    expect(mainScript).toBeDefined();
    expect(mainScript.yamlValidation.isValid).toBe(true);
    const feiertagTask = mainScript.migrationGraph.tasks.find((t) => t.refId === 'Feiertag');
    expect(feiertagTask).toBeDefined();
    expect(feiertagTask!.steps.some((s) => s.kind === 'disconnect')).toBe(false);
    expect(
      mainScript.flowIR.findings.some((f) => f.code === 'POTENTIAL_BRANCH_FALLTHROUGH')
    ).toBe(true);
    expect(mainScript.warnings.some((w) => w.code === 'POTENTIAL_BRANCH_FALLTHROUGH')).toBe(true);
    expect(mainScript.archyYaml).toContain('OFFENE MIGRATIONSFRAGE:');
    expect(mainScript.archyYaml).toContain('Kein disconnect erfunden');
  });

  it('sample_holiday_flow pattern: keeps schedule holiday + Sys_HolidayList_Region decision separate, omits getParticipantData, syncs multi-line comments between generateArchyYaml and renderArchyYamlFromFlowIR', () => {
    const sampleHolidayMod = makeModule(
      'sample_holiday_flow',
      `
SECTION Start
  IF TIME OF DAY 08:00..18:00 THEN
    GIVE RAN Begruessung
  ELSE
    GIVE RAN Geschlossen
    DISCONNECT
  END IF
  IF date = Sys_HolidayList_Region THEN
    EXECUTE Holiday_Subflow
  END IF
  EXECUTE Night_Check
  QUEUE TO SKILLSET Support_DE
`
    );

    const ws = buildScriptWorkspace([sampleHolidayMod]);
    const res = translateAvayaWorkspaceToGenesys(ws);
    const script = res.scripts[0];

    expect(script.yamlValidation.isValid).toBe(true);
    expect(script.archyYaml).toContain('GetCurrentDateTimeUtc() == Flow.Sys_HolidayList_Region');
    expect(script.archyYaml).not.toContain('getParticipantData:');
    expect(script.archyYaml).toContain('evaluateScheduleGroup:');
    expect(script.archyYaml).toContain('holiday:');
    expect(script.flowIR.findings.some((f) => f.code === 'VAR_USED_BEFORE_SET')).toBe(true);
    expect(script.flowIR.findings.some((f) => f.code === 'POTENTIAL_BRANCH_FALLTHROUGH')).toBe(true);
    expect(script.flowIR.findings.some((f) => f.code === 'DUPLICATE_HOLIDAY_LOGIC')).toBe(true);

    // Direct FlowIR Archy renderer parity: keeps multi-line # OFFENE MIGRATIONSFRAGE comments and passes validateArchyYaml
    const directIrYaml = renderArchyYamlFromFlowIR(script.flowIR);
    expect(directIrYaml).toContain('# OFFENE MIGRATIONSFRAGE:');
    expect(directIrYaml).toContain('GetCurrentDateTimeUtc() == Flow.Sys_HolidayList_Region');
    expect(directIrYaml).not.toContain('getParticipantData:');
    const directVal = validateArchyYaml(directIrYaml);
    expect(directVal.isValid).toBe(true);
    expect(directVal.errors).toHaveLength(0);
  });

  it('validateIR and validateArchyYaml detect DUPLICATE_VARIABLE_SCOPE, UNRESOLVED_TASK_REF, and DUPLICATE_HOLIDAY_LOGIC', () => {
    const irWithHardenedErrors: FlowIR = {
      meta: {
        flowId: 'Hardened_Check_Flow',
        sourceSystem: 'Avaya',
        targetSystem: 'Genesys',
        sourceScript: 'Hardened_Check_Flow.s',
        entryNodeId: 'n_start',
        language: 'de-de',
        version: '1.1',
      },
      variables: [
        {
          id: 'v_flow_hdx',
          name: 'HDX_Resp_cv',
          scope: 'flow',
          category: 'flow',
          type: 'string',
          initialValue: '',
          source: { origin: 'avaya', originalName: 'HDX_Resp_cv' },
          sourceTrace: { script: 'Hardened_Check_Flow.s', lineStart: 1, lineEnd: 1 },
          usedByNodes: [],
        },
        {
          id: 'v_task_hdx',
          name: 'HDX_Resp_cv',
          scope: 'task',
          category: 'task',
          owner: 'CHECK_RESPONSE',
          type: 'string',
          initialValue: '',
          source: { origin: 'avaya', originalName: 'HDX_Resp_cv' },
          sourceTrace: { script: 'Hardened_Check_Flow.s', lineStart: 2, lineEnd: 2 },
          usedByNodes: [],
        },
      ],
      nodes: [
        {
          id: 'n_start',
          kind: 'entry',
          name: 'Start',
          terminal: false,
          parameters: {},
          sourceTrace: { script: 'Hardened_Check_Flow.s', lineStart: 1, lineEnd: 1 },
        },
        {
          id: 'n_sched',
          kind: 'scheduleCheck',
          name: 'Schedule Check',
          terminal: false,
          parameters: { target: 'Main_Schedule_Group' },
          sourceTrace: { script: 'Hardened_Check_Flow.s', lineStart: 3, lineEnd: 3 },
        },
        {
          id: 'n_dec_hol',
          kind: 'decision',
          name: 'Holiday List Check',
          terminal: false,
          parameters: {},
          condition: { expr: 'GetCurrentDateTimeUtc() == Sys_Feiertagliste_NRW' },
          sourceTrace: { script: 'Hardened_Check_Flow.s', lineStart: 5, lineEnd: 5 },
        },
        {
          id: 'n_broken_call',
          kind: 'invokeSubflow',
          name: 'Call Missing Task',
          terminal: false,
          parameters: { target: 'Missing_Task', targetTaskRefId: 'Missing_Task', unresolvedTaskRef: true },
          sourceTrace: { script: 'Hardened_Check_Flow.s', lineStart: 6, lineEnd: 6 },
        },
      ],
      transitions: [
        { from: 'n_start', to: 'n_sched', type: 'unconditional' },
        { from: 'n_sched', to: 'n_dec_hol', type: 'holiday' },
        { from: 'n_dec_hol', to: 'n_broken_call', type: 'whenTrue' },
        { from: 'n_dec_hol', to: 'n_broken_call', type: 'whenFalse' },
      ],
      dependencies: { subflows: [], commonModules: [], dataActions: [] },
      findings: [],
      renderingHints: {
        genesys: { preferReusableTasks: true, preferDecisionNodes: true, avoidGotoStyleSections: true },
      },
    };

    const irRes = validateIR(irWithHardenedErrors);
    const irCodes = new Set(irRes.findings.map((f) => f.code));
    expect(irCodes.has('DUPLICATE_VARIABLE_SCOPE')).toBe(true);
    expect(irCodes.has('UNRESOLVED_TASK_REF')).toBe(true);
    expect(irCodes.has('DUPLICATE_HOLIDAY_LOGIC')).toBe(true);

    const dupScopeYaml = [
      'inboundCall:',
      '  name: Dup_Scope_Flow',
      '  defaultLanguage: de-de',
      '  startUpRef: "/inboundCall/tasks/task[Main_Task]"',
      '  variables:',
      '    - stringVariable:',
      '        name: HDX_Resp_cv',
      '        initialValue:',
      '          lit: ""',
      '  tasks:',
      '    - task:',
      '        name: Main_Task',
      '        refId: Main_Task',
      '        variables:',
      '          - stringVariable:',
      '              name: HDX_Resp_cv',
      '              initialValue:',
      '                lit: ""',
      '        actions:',
      '          - disconnect:',
      '              name: "End Call"',
    ].join('\n');

    const yamlRes = validateArchyYaml(dupScopeYaml);
    expect(yamlRes.isValid).toBe(true);
    expect(yamlRes.warnings.some((w) => w.code === 'DUPLICATE_VARIABLE_SCOPE')).toBe(true);
  });
});






