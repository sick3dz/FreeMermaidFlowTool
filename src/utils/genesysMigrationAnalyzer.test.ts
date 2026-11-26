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
  });

  it('produces YAML-safe Archy slugs and builds an in-memory ZIP bundle of all Archy YAMLs', async () => {
    expect(toArchySlug('Öffnungszeiten / Prüfung 01.s')).toBe('Oeffnungszeiten_Pruefung_01');
    expect(toArchySlug('4711_Main.s')).toBe('S_4711_Main');

    const modA = makeModule('Main_Entry', `SECTION S1\nGIVE RAN 100\nQUEUE TO SKILLSET Team_A\nDISCONNECT\n`);
    const modB = makeModule('Sub_Info', `SECTION S1\nGIVE RAN 200\nROUTE END\n`);
    const ws = buildScriptWorkspace([modA, modB]);
    const res = translateAvayaWorkspaceToGenesys(ws);

    const zipBlob = await exportAllArchyYamlsZipBlob(res);
    expect(zipBlob.size).toBeGreaterThan(100);

    const arrayBuf = await zipBlob.arrayBuffer();
    const loadedZip = await JSZip.loadAsync(arrayBuf);
    const fileNames = Object.keys(loadedZip.files);
    expect(fileNames.some((n) => n.endsWith('.yaml'))).toBe(true);
    expect(fileNames).toContain('genesys-overview.mmd');
    expect(fileNames).toContain('README.md');
  });

  it('embeds Avaya <-> Genesys toggle cleanly in exported Callflow.html with valid executable JS', () => {
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
          },
        ],
        activeViewKey: 'master',
      }
    );

    expect(html).toContain('id="platform-mode-group"');
    expect(html).toContain('data-platform="genesys"');
    expect(html).toContain('id="genesys-subbar"');
    expect(html).toContain('Test_Flow.yaml');

    // Verify embedded JS parses without any syntax error
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();
    expect(() => new Function(scriptMatch![1])).not.toThrow();
  });
});
