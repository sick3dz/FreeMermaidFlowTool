import { describe, expect, it } from 'vitest';
import {
  adaptModulesToParsedScriptNodes,
  createAuditExportPayloads,
  formatAuditSummaryTableRows,
  generateArchitectureMermaid,
  runCallflowAudit,
  serializeAuditReportJson,
} from './auditCallflows';
import {
  buildScriptWorkspace,
  parseCallflowTextWithFallback,
} from './scriptCallflowParser';
import { ScriptModule } from '../types/mermaidStudio';

function makeRawScriptModule(
  scriptNumber: string,
  fileName: string,
  rawText: string,
  opts?: { isMaster?: boolean; origin?: 'legacy-text' | 'visio-new'; entryDnisNumbers?: string[] }
): ScriptModule {
  const parsed = parseCallflowTextWithFallback(`=== ${scriptNumber} ===\n${rawText}`, {
    isMasterHint: Boolean(opts?.isMaster),
  });
  const base = parsed[0] || {
    scriptNumber,
    scriptName: scriptNumber,
    isMaster: Boolean(opts?.isMaster),
    rawText,
    rules: [],
    outgoingNumbers: [],
  };
  return {
    ...base,
    scriptNumber,
    sourceFilename: fileName,
    rawText,
    isMaster: Boolean(opts?.isMaster),
    origin: opts?.origin || 'legacy-text',
    entryDnisNumbers: opts?.entryDnisNumbers,
  };
}

describe('auditCallflows — 100% In-Memory Avaya OCL & Visio Graph-Audit Engine', () => {
  it('1. detects Broken Links with exact source filename, command & line number while ignoring local GOTO SECTION and OCL variables', () => {
    const mainMod = makeRawScriptModule(
      'Main_Entry',
      'Main_Entry.s',
      [
        '/* Kundenkommentar GEHEIM_KUNDENNAME_12345 */',
        'VAR dyn_target',
        'SET resolved_script = "Sub_Ok"',
        'SECTION RetryLoop',
        'IF CALL HAS ABANDONED THEN DISCONNECT',
        'GOTO RetryLoop',
        'EXECUTE dyn_target',
        'EXECUTE resolved_script',
        'EXECUTE Missing_Subflow_99',
        'GIVE CDN 4910',
      ].join('\n'),
      { isMaster: true }
    );

    const subOkMod = makeRawScriptModule(
      'Sub_Ok',
      'Sub_Ok.s',
      ['GIVE RAN 101', 'DISCONNECT'].join('\n')
    );

    const report = runCallflowAudit([mainMod, subOkMod], {
      masterScriptNumber: 'Main_Entry',
      generatedAt: '2026-11-25T10:00:00.000Z',
    });

    // Exactly 1 broken link: Missing_Subflow_99 on line 9
    expect(report.brokenLinks).toHaveLength(1);
    expect(report.brokenLinks[0]).toMatchObject({
      sourceFileName: 'Main_Entry.s',
      targetRaw: 'Missing_Subflow_99',
      command: 'EXECUTE',
      lineNumber: 9,
      targetType: 'MISSING_OR_BROKEN',
    });

    // Resolved variable 'resolved_script' -> Sub_Ok must be a LOCAL_SCRIPT edge (not broken!)
    const mainNode = report.nodes.find((n) => n.fileName === 'Main_Entry.s')!;
    expect(
      mainNode.edges.some((e) => e.targetType === 'LOCAL_SCRIPT' && e.rawTarget === 'Sub_Ok')
    ).toBe(true);
    // Pure CDN 4910 must be CDN_NUMBER (not broken!)
    expect(
      mainNode.edges.some((e) => e.targetType === 'CDN_NUMBER' && e.rawTarget === '4910')
    ).toBe(true);
    // Local GOTO RetryLoop must NOT be emitted as an external broken link
    expect(mainNode.edges.some((e) => /retryloop/i.test(e.rawTarget))).toBe(false);
    // Unresolved OCL variable dyn_target must NOT be emitted
    expect(mainNode.edges.some((e) => /dyn_target/i.test(e.rawTarget))).toBe(false);
  });

  it('2. detects Orphan Scripts while protecting Visio Entry Points and Master Scripts', () => {
    const visioFlow: ScriptModule = {
      scriptNumber: 'Visio_Start_Flow',
      scriptName: 'Visio Start Flow',
      sourceFilename: 'Einstieg.vsdx',
      origin: 'visio-new',
      isMaster: false,
      rawText: 'Einstieg -> Visio_Target_Script',
      rules: [
        {
          id: 'v-1',
          prio: 1,
          stepName: 'Einstieg',
          sourceNumber: 'Visio_Start_Flow',
          targetNumber: 'Visio_Target_Script',
          choices: [],
          rawLine: 'Einstieg -> Visio_Target_Script',
        },
      ],
      outgoingNumbers: ['Visio_Target_Script'],
    };

    const visioTarget = makeRawScriptModule(
      'Visio_Target_Script',
      'Visio_Target_Script.s',
      ['GIVE RAN 200', 'EXECUTE Active_Child'].join('\n')
    );

    const activeChild = makeRawScriptModule(
      'Active_Child',
      'Active_Child.s',
      ['TRANSFER TO 5050'].join('\n')
    );

    const orphanLegacy = makeRawScriptModule(
      'Legacy_Altlast_2019',
      'Legacy_Altlast_2019.s',
      ['GIVE RAN 999', 'DISCONNECT'].join('\n')
    );

    const report = runCallflowAudit([visioTarget, activeChild, orphanLegacy], {
      visioModules: [visioFlow],
    });

    // Visio_Start_Flow and Visio_Target_Script are Entry Points; Active_Child is called by Visio_Target_Script
    const visioTargetNode = report.nodes.find((n) => n.fileName === 'Visio_Target_Script.s')!;
    expect(visioTargetNode.isEntryPoint).toBe(true);
    expect(visioTargetNode.entryPointReasons).toContain('Visio-Einstiegspunkt');

    // Only Legacy_Altlast_2019.s is orphaned
    expect(report.orphanScripts).toHaveLength(1);
    expect(report.orphanScripts[0].fileName).toBe('Legacy_Altlast_2019.s');
  });

  it('3. detects Dead-End Scripts strictly and attaches explicit Skillset-Queue hint when ending in QUEUE TO SKILLSET', () => {
    const entryMod = makeRawScriptModule(
      'Entry_Router',
      'Entry_Router.s',
      [
        'EXECUTE Clean_End',
        'EXECUTE Pure_Dead_End',
        'EXECUTE Queue_Only_End',
      ].join('\n'),
      { isMaster: true }
    );

    const cleanEnd = makeRawScriptModule(
      'Clean_End',
      'Clean_End.s',
      ['GIVE RAN 100', 'DROP CALL'].join('\n')
    );

    const pureDeadEnd = makeRawScriptModule(
      'Pure_Dead_End',
      'Pure_Dead_End.s',
      ['GIVE RAN 301', 'WAIT 5'].join('\n')
    );

    const queueOnlyEnd = makeRawScriptModule(
      'Queue_Only_End',
      'Queue_Only_End.s',
      ['QUEUE TO SKILLSET Sales_DE, VIP_DE WITH PRIORITY 10', 'WAIT 30'].join('\n')
    );

    const report = runCallflowAudit([entryMod, cleanEnd, pureDeadEnd, queueOnlyEnd], {
      masterScriptNumber: 'Entry_Router',
    });

    // Clean_End has DROP CALL -> hasTermination=true -> NOT a dead end
    expect(report.nodes.find((n) => n.fileName === 'Clean_End.s')?.hasTermination).toBe(true);

    // Both Pure_Dead_End and Queue_Only_End are flagged as dead ends (strict mode)
    expect(report.deadEndScripts.map((d) => d.fileName).sort()).toEqual([
      'Pure_Dead_End.s',
      'Queue_Only_End.s',
    ]);

    const pureFinding = report.deadEndScripts.find((d) => d.fileName === 'Pure_Dead_End.s')!;
    expect(pureFinding.hasSkillsetQueue).toBe(false);
    expect(pureFinding.skillsetQueues).toEqual([]);

    const queueFinding = report.deadEndScripts.find((d) => d.fileName === 'Queue_Only_End.s')!;
    expect(queueFinding.hasSkillsetQueue).toBe(true);
    expect(queueFinding.skillsetQueues).toEqual(['Sales_DE', 'VIP_DE']);
    expect(queueFinding.note).toMatch(/Skillset-Queue/i);
    expect(report.summary.deadEndWithQueueHintCount).toBe(1);
  });

  it('4. detects Circular Script Loops (A -> B -> A) via DFS and deduplicates canonical cycles', () => {
    const modA = makeRawScriptModule(
      'Script_A',
      'Script_A.s',
      ['EXECUTE Script_B'].join('\n'),
      { isMaster: true }
    );
    const modB = makeRawScriptModule(
      'Script_B',
      'Script_B.s',
      ['EXECUTE Script_A'].join('\n')
    );
    const modSelf = makeRawScriptModule(
      'Script_Self',
      'Script_Self.s',
      ['EXECUTE Script_Self'].join('\n')
    );

    const report = runCallflowAudit([modA, modB, modSelf], {
      masterScriptNumber: 'Script_A',
    });

    expect(report.circularLoops).toHaveLength(2);
    const pingPong = report.circularLoops.find((c) => c.length === 2);
    expect(pingPong).toBeDefined();
    expect(pingPong!.cycleFileNames).toEqual(['Script_A.s', 'Script_B.s', 'Script_A.s']);

    const selfLoop = report.circularLoops.find((c) => c.length === 1);
    expect(selfLoop).toBeDefined();
    expect(selfLoop!.cycleFileNames).toEqual(['Script_Self.s', 'Script_Self.s']);
  });

  it('5. builds complete FlixCheck & Oracle External Integrations inventory and generates compact Mermaid overview with red/yellow classDef', () => {
    const entryMod = makeRawScriptModule(
      'Hotline_Main',
      'Hotline_Main.s',
      [
        '/* Vertraulicher Kundentext: Max Mustermann Tel 030-99887766 */',
        'EXECUTE FlixCheck_Deflection',
        'SEND REQUEST flixcheck_provider_api',
        'EXECUTE Agent_Queuing_Oracle',
        'HOST Oracle_CRM_Lookup',
        'EXECUTE Broken_Target_XYZ',
        'EXECUTE Quiet_DeadEnd',
      ].join('\n'),
      { isMaster: true }
    );

    const deadEndMod = makeRawScriptModule(
      'Quiet_DeadEnd',
      'Quiet_DeadEnd.s',
      ['GIVE RAN 505'].join('\n')
    );

    const ws = buildScriptWorkspace([entryMod, deadEndMod]);
    const nodes = adaptModulesToParsedScriptNodes(ws.modules, {
      masterScriptNumber: ws.masterScriptNumber,
    });
    expect(nodes).toHaveLength(2);

    const report = runCallflowAudit(ws, { generatedAt: '2026-11-25T10:30:00.000Z' });

    // External integrations: 2 FlixCheck (FlixCheck_Deflection + SEND REQUEST) & 2 Oracle (Agent_Queuing_Oracle + HOST)
    expect(report.summary.flixcheckCallCount).toBeGreaterThanOrEqual(2);
    expect(report.summary.oracleCallCount).toBeGreaterThanOrEqual(2);
    expect(
      report.externalIntegrations.some(
        (i) => i.system === 'FlixCheck' && i.command === 'SEND REQUEST'
      )
    ).toBe(true);
    expect(
      report.externalIntegrations.some(
        (i) => i.system === 'Oracle' && i.command === 'HOST'
      )
    ).toBe(true);
    expect(
      report.externalIntegrations.some(
        (i) => i.system === 'Oracle' && /Agent_Queuing_Oracle/i.test(i.targetRaw)
      )
    ).toBe(true);

    // High-Level Architecture Mermaid Diagram
    const mermaid = generateArchitectureMermaid(report, { maxHubScripts: 20 });
    expect(mermaid.startsWith('flowchart LR')).toBe(true);
    expect(mermaid).toContain('EXT_FLIXCHECK');
    expect(mermaid).toContain('EXT_ORACLE');
    expect(mermaid).toContain('classDef brokenNode fill:#7f1d1d');
    expect(mermaid).toContain('classDef deadEndNode fill:#78350f');
    expect(mermaid).toContain('MISS_broken_target_xyz');

    // Privacy Check: JSON report MUST NOT contain raw script comments or customer PII
    const jsonText = serializeAuditReportJson(report);
    expect(jsonText).not.toContain('Max Mustermann');
    expect(jsonText).not.toContain('030-99887766');
    expect(jsonText).toContain('"privacyMode": "100%-in-memory-metadata-only"');

    // Table rows & export payload helpers
    const tableRows = formatAuditSummaryTableRows(report);
    expect(tableRows.length).toBeGreaterThanOrEqual(8);
    const payloads = createAuditExportPayloads(report);
    expect(payloads.jsonFilename).toBe('avaya-callflow-audit.json');
    expect(payloads.mermaidFilename).toBe('architecture-overview.mmd');
    expect(payloads.mermaidContent).toBe(mermaid);
  });
});
