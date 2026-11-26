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
  exportAllArchyYamlsZipBlob,
  toArchySlug,
  translateAvayaWorkspaceToGenesys,
  validateArchyYaml,
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
});



