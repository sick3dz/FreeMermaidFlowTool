import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
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

    // Archy YAML strict schema check
    expect(script.archyYaml).toContain('inboundCall:');
    expect(script.archyYaml).toContain('defaultLanguage: de-de');
    expect(script.archyYaml).toContain('startUpRef: "/inboundCall/tasks/task[Main_Task]"');
    expect(script.archyYaml).toContain('name: Flow.avayaOriginScript');
    expect(script.archyYaml).toContain('playAudio:');
    expect(script.archyYaml).toContain('Prompt.S_1001');
    expect(script.archyYaml).toContain('transferToAcd:');
    expect(script.archyYaml).toContain('targetQueue:');
    expect(script.archyYaml).toContain('Sales_DE');
    expect(script.archyYaml).toContain('disconnect:');

    // Genesys Mermaid flowchart TD check
    expect(script.genesysMermaid).toMatch(/^flowchart TD/);
    expect(script.genesysMermaid).toContain('Play Audio');
    expect(script.genesysMermaid).toContain('ACD Queue: Sales_DE');
    expect(script.genesysMermaid).toContain('Disconnect');
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
    expect(script.archyYaml).toContain('transferToNumber:');
    expect(script.archyYaml).toContain('4711');

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
    expect(script.archyYaml).toContain('Flow.emergencyOverride == \\"true\\"');
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
});

