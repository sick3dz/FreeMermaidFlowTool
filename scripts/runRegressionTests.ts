/**
 * Automated Regression Smoke-Test Suite for Avaya Callflow Studio (v1.1.6+)
 * Run with: npm run test:smoke
 *
 * Uses strictly synthetic fixtures (zero customer data, zero network requests).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import JSZip from 'jszip';

import {
  SAMPLE_MULTI_SCRIPT_TEXT,
  parseCallflowTextWithFallback,
  buildScriptWorkspace,
  rehydrateAndUpgradeWorkspace,
  extractScheduleFromSondZeitName,
  resolveScheduleWithSondZeit,
  buildWorkspaceScheduleOverview,
  buildWorkspaceOpeningHoursBundle,
  exportOpeningHoursCsv,
  exportOpeningHoursMarkdown,
  exportOpeningHoursXlsxBytes,
  buildMasterOverviewMermaid,
  buildScriptDetailMermaid,
  extractWorkspaceResourceRegistry,
  analyzeWorkspaceLogicHealth,
  buildWorkspaceRoutingMatrix,
  exportRoutingMatrixCsv,
  exportMigrationDocumentationMarkdown,
  createWorkspaceInspectContext,
  inspectWorkspaceNodeForEdit,
  updateWorkspaceNodeFromEdit,
  classifyAvayaWaypointTarget,
  markAvayaWaypointsInWorkspace,
  unmarkAvayaWaypointInWorkspace,
} from '../src/utils/scriptCallflowParser';
import {
  buildOpeningHoursXlsxFileMap,
  buildStoreZipUint8Array,
  parseScheduleToWeekdayMatrix,
} from '../src/utils/openingHoursExporter';
import {
  buildDeterministicFlowchartSvg,
  parseCallflowGraph,
  shouldUseFastDeterministicVectorLayout,
  traceCallflowForNode,
  generateInteractiveCallflowHtml,
} from '../src/utils/callflowEngine';
import {
  clearElkLayoutCache,
  renderElkWorkerFlowchartSvg,
} from '../src/utils/elkWorkerLayout';
import { buildWorkspaceGlobalSearchIndex } from '../src/utils/globalSearchEngine';
import {
  autoResolveConnectedScriptsFromFolder,
  indexScriptFolderFiles,
  loadAllScriptsFromFolder,
} from '../src/utils/callflowFileImporter';
import { AUDIT_APP_VERSION } from '../src/utils/offlineAuditEngine';

interface TestResult {
  name: string;
  durationMs: number;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function runTest(name: string, fn: () => void) {
  const t0 = performance.now();
  try {
    fn();
    results.push({ name, durationMs: performance.now() - t0, passed: true });
    console.log(`  PASS  ${name} (${(performance.now() - t0).toFixed(1)} ms)`);
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    results.push({ name, durationMs: performance.now() - t0, passed: false, error: message });
    console.error(`  FAIL  ${name}\n${message}`);
  }
}

async function runAsyncTest(name: string, fn: () => Promise<void>) {
  const t0 = performance.now();
  try {
    await fn();
    results.push({ name, durationMs: performance.now() - t0, passed: true });
    console.log(`  PASS  ${name} (${(performance.now() - t0).toFixed(1)} ms)`);
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    results.push({ name, durationMs: performance.now() - t0, passed: false, error: message });
    console.error(`  FAIL  ${name}\n${message}`);
  }
}

function extractNodeRectsFromSvg(svg: string): Array<{ id: string; x: number; y: number; w: number; h: number }> {
  const rects: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  const nodeRe = /<g class="node default"[^>]*data-id="([^"]+)"[^>]*transform="translate\(([-0-9.]+),\s*([-0-9.]+)\)"[^>]*><rect[^>]*width="([-0-9.]+)"[^>]*height="([-0-9.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = nodeRe.exec(svg)) !== null) {
    rects.push({
      id: m[1],
      x: parseFloat(m[2]),
      y: parseFloat(m[3]),
      w: parseFloat(m[4]),
      h: parseFloat(m[5]),
    });
  }
  return rects;
}

function countOverlappingRectPairs(rects: Array<{ id: string; x: number; y: number; w: number; h: number }>): number {
  let overlaps = 0;
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j];
      const sepX = a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5;
      const sepY = a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
      if (!sepX && !sepY) overlaps += 1;
    }
  }
  return overlaps;
}

function buildSyntheticMultiScriptFixture(): string {
  return [
    '=== Main ===',
    'WHERE CLID EQUALS',
    '  VALUE 4930100100: EXECUTE 10010',
    '  VALUE 4930100200: EXECUTE 10020',
    '  DEFAULT: EXECUTE 10010',
    'END WHERE',
    '',
    '=== 10010 ===',
    '/* Kundenservice Hotline */',
    'ASSIGN "SondZeit_Mo_Do_08_17_Fr_08_15" TO Sys_SondZeit',
    'EXECUTE 99000',
    'IF DAY OF WEEK EQUALS MONDAY..FRIDAY AND TIME OF DAY 08:00..17:00 THEN',
    '  GIVE RAN 101',
    '  QUEUE TO SKILLSET sk_kundenservice_de',
    'ELSE',
    '  GIVE RAN 102',
    '  DISCONNECT',
    'END IF',
    '',
    '=== 10020 ===',
    '/* Fachabteilung mit DTMF & Feiertag */',
    'IF Sys_Feiertag = 1 THEN',
    '  GIVE RAN 201',
    '  EXECUTE 10099',
    'END IF',
    'GIVE IVR 202',
    'WHERE IVR_Choice EQUALS',
    '  VALUE 1: EXECUTE 10010',
    '  VALUE 2: QUEUE TO SKILLSET sk_vip_support',
    '  DEFAULT: EXECUTE 10099',
    'END WHERE',
    '',
    '=== 10099 ===',
    '/* Ansage Ausserhalb */',
    'GIVE RAN 999',
    'DISCONNECT',
    '',
    '=== 99000 ===',
    '/* Zentraler SondZeit-Dispatcher */',
    'WHERE Sys_SondZeit EQUALS',
    '  VALUE "SondZeit_Mo_Do_08_17_Fr_08_15":',
    '    IF DAY OF WEEK EQUALS MONDAY..THURSDAY AND TIME OF DAY 08:00..17:00 THEN',
    '      ASSIGN 1 TO Sys_Offen',
    '    END IF',
    '    IF DAY OF WEEK EQUALS FRIDAY AND TIME OF DAY 08:00..15:00 THEN',
    '      ASSIGN 1 TO Sys_Offen',
    '    END IF',
    '  VALUE "SondZeit_Sa_09_13":',
    '    IF DAY OF WEEK EQUALS SATURDAY AND TIME OF DAY 09:00..13:00 THEN',
    '      ASSIGN 1 TO Sys_Offen',
    '    END IF',
    'END WHERE',
  ].join('\n');
}

console.log(`\nRunning Avaya Callflow Studio Regression Suite (v${AUDIT_APP_VERSION})...\n`);

// 1. Multi-script parsing & rehydration
runTest('1. AACC .s multi-script parsing & workspace rehydration', () => {
  const sampleModules = parseCallflowTextWithFallback(SAMPLE_MULTI_SCRIPT_TEXT, { isMasterHint: true });
  assert.ok(sampleModules.length >= 2, 'Expected multiple modules from SAMPLE_MULTI_SCRIPT_TEXT');
  const sampleWs = buildScriptWorkspace(sampleModules);
  assert.ok(sampleWs.modules.length >= 2, 'Workspace should preserve parsed modules');

  const rawModules = parseCallflowTextWithFallback(buildSyntheticMultiScriptFixture(), { isMasterHint: true });
  assert.ok(rawModules.length >= 5, `Expected >= 5 synthetic modules, got ${rawModules.length}`);
  const ws = buildScriptWorkspace(rawModules);
  const rehydrated = rehydrateAndUpgradeWorkspace(JSON.parse(JSON.stringify(ws)));
  assert.equal(rehydrated.modules.length, ws.modules.length, 'Rehydrated workspace must keep module count');
});

// 2. Opening hours, SondZeit resolution, ReDoS guard & CSV export
runTest('2. Opening hours, SondZeit parsing, ReDoS guard & CSV clock times', () => {
  const parsedSplit = extractScheduleFromSondZeitName('SondZeit_Mo_Do_08_17_Fr_08_15');
  assert.ok(parsedSplit, 'SondZeit_Mo_Do_08_17_Fr_08_15 must resolve');
  assert.match(parsedSplit!, /08:00/, 'Resolved SondZeit must contain 08:00');
  assert.match(parsedSplit!, /17:00/, 'Resolved SondZeit must contain 17:00');
  assert.match(parsedSplit!, /15:00/, 'Resolved SondZeit must contain Friday 15:00');
  assert.match(parsedSplit!, /Fr/i, 'Resolved SondZeit must include Friday segment');

  // ReDoS adversarial input guard (must stay linear < 20ms)
  const evilName = 'SondZeit_' + Array.from({ length: 45 }, (_, i) => `seg${i}`).join('_');
  const t0 = performance.now();
  extractScheduleFromSondZeitName(evilName);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 20, `ReDoS guard failed: extractScheduleFromSondZeitName took ${elapsed.toFixed(1)} ms`);

  const modules = parseCallflowTextWithFallback(buildSyntheticMultiScriptFixture(), { isMasterHint: true });
  const ws = buildScriptWorkspace(modules);

  const mod10010 = ws.modules.find((m) => m.scriptNumber === '10010');
  assert.ok(mod10010, 'Module 10010 must exist');
  const resolved = resolveScheduleWithSondZeit('SondZeit_Mo_Do_08_17_Fr_08_15', mod10010, ws);
  assert.equal(resolved.hasConcreteTimes, true, 'resolveScheduleWithSondZeit must flag concrete clock times');
  assert.match(resolved.displayText, /08:00/, 'Display text must contain concrete opening hour');

  const scheduleRows = buildWorkspaceScheduleOverview(ws);
  assert.ok(scheduleRows.length > 0, 'Schedule overview should find opening hours');
  assert.ok(
    scheduleRows.some(
      (r) => /\d{1,2}:\d{2}/.test(r.openingHours || '') || /\d{1,2}:\d{2}/.test(r.clockTimes || '')
    ),
    'At least one schedule row must contain concrete HH:MM clock times'
  );

  const csv = exportOpeningHoursCsv(ws);
  const firstLine = csv.replace(/^\uFEFF/, '').split(/\r?\n/)[0];
  assert.ok(firstLine.includes('Skript-Nr.'), 'CSV header must include Skript-Nr.');
  assert.ok(firstLine.includes('Kategorie'), 'CSV header must include Kategorie');
  assert.ok(firstLine.includes('Mo;Di;Mi;Do;Fr;Sa;So'), 'CSV header must include Mo–So weekday matrix columns');
  assert.ok(firstLine.includes('SondZeit / Quelle'), 'CSV header must include SondZeit / Quelle');
  assert.ok(firstLine.includes('Feiertag / Sonderstatus'), 'CSV header must include Feiertag / Sonderstatus');
  assert.ok(firstLine.includes('Überlauf / Ansage / Ziel'), 'CSV header must include Überlauf / Ansage / Ziel');
  assert.match(csv, /\d{2}:\d{2}[–-]\d{2}:\d{2}/, 'CSV body must contain formatted clock-time ranges');
});

// 3. Mermaid generation, branch label bugfix & manual link escaping
runTest('3. Mermaid generation, non-DTMF choice label & manual link escaping', () => {
  const modules = parseCallflowTextWithFallback(buildSyntheticMultiScriptFixture(), { isMasterHint: true });
  const mod10020 = modules.find((m) => m.scriptNumber === '10020');
  assert.ok(mod10020, 'Module 10020 must exist');

  // Inject a named non-DTMF choice ("Feiertag") to verify it does NOT become "DTMF Feiertag"
  mod10020.rules.push({
    id: 'rule-named-branch',
    prio: 99,
    stepName: 'Feiertagsweiche',
    sourceNumber: '10020',
    condition: 'Sys_Feiertag = 1',
    rawLine: 'IF Sys_Feiertag = 1 THEN EXECUTE 10099',
    choices: [
      { choice: 'Feiertag', targetNumber: '10099' },
      { choice: '1', targetNumber: '10010' },
    ],
  });

  const ws = buildScriptWorkspace(modules);
  ws.manualLinks = [
    ...(ws.manualLinks || []),
    {
      id: 'ml-test-1',
      fromScriptNumber: '10020',
      toTargetNumber: '10099',
      label: 'Sonderfall | Notfall (Test) "A"',
    },
  ];

  const masterCompact = buildMasterOverviewMermaid(ws, 'LR', { compact: true });
  const masterDetailed = buildMasterOverviewMermaid(ws, 'LR', { compact: false });
  const detail10020 = buildScriptDetailMermaid(ws, '10020');

  assert.ok(masterCompact.startsWith('flowchart '), 'Compact master must be valid flowchart');
  assert.ok(masterDetailed.startsWith('flowchart '), 'Detailed master must be valid flowchart');
  assert.ok(detail10020.startsWith('flowchart '), 'Detail Mermaid must be valid flowchart');

  assert.ok(
    !/(?:DTMF|Wahl)\s+Feiertag/i.test(detail10020),
    'Named non-DTMF branch "Feiertag" must NOT be prefixed with DTMF or Wahl'
  );
  assert.ok(
    !/-->\|[^|\n]*\|[^|\n]*\|/.test(detail10020),
    'Manual link with pipe characters must be sanitized and must not produce broken Mermaid edge syntax'
  );
  assert.ok(
    detail10020.includes('Sonderfall / Notfall'),
    'Manual link pipe character must be sanitized to slash inside edge label'
  );

  const masterGraph = parseCallflowGraph(masterCompact);
  assert.ok(masterGraph.nodes.size >= 3, 'Master graph must parse into nodes');
  const firstNodeId = [...masterGraph.nodes.keys()][0];
  const trace = traceCallflowForNode(masterGraph, firstNodeId);
  assert.ok(trace && trace.activeNodeIds.size >= 1, 'Trace must include at least the selected node');
});

// 4. Node edit & schedule cache invalidation
runTest('4. Node editing immediately invalidates schedule cache', () => {
  const modules = parseCallflowTextWithFallback(buildSyntheticMultiScriptFixture(), { isMasterHint: true });
  const ws1 = buildScriptWorkspace(modules);
  const mod10010Before = ws1.modules.find((m) => m.scriptNumber === '10010')!;
  const targetRule = mod10010Before.rules.find((r) => Boolean(r.schedule || r.condition));
  assert.ok(targetRule, 'Expected a rule with schedule/condition in module 10010');

  // Prime WeakMap cache before editing
  resolveScheduleWithSondZeit(targetRule.schedule || '', mod10010Before, ws1);

  const detailCode = buildScriptDetailMermaid(ws1, '10010');
  const detailGraph = parseCallflowGraph(detailCode);
  const stepNode = [...detailGraph.nodes.values()].find((n) => /^STEP_/i.test(n.id));
  assert.ok(stepNode, 'Expected a STEP_* node in detail graph');

  const detailView = { level: 'detail' as const, scriptNumber: '10010' };
  const snapshot = inspectWorkspaceNodeForEdit(ws1, detailView, stepNode.id, detailGraph);
  assert.ok(snapshot, 'inspectWorkspaceNodeForEdit must return a snapshot');

  const ws2 = updateWorkspaceNodeFromEdit(ws1, detailView, snapshot, {
    scriptNumber: snapshot.scriptNumber,
    title: snapshot.title,
    blockType: snapshot.blockType,
    announcement: snapshot.announcement,
    queueTarget: snapshot.queueTarget,
    schedule: 'Mo-Fr 09:30-16:30',
    condition: snapshot.condition,
    outgoingConnections: snapshot.outgoingConnections,
  });

  const mod10010After = ws2.modules.find((m) => m.scriptNumber === '10010')!;
  const updatedRule = mod10010After.rules.find((r) => r.id === snapshot.ruleId);
  assert.ok(updatedRule, 'Updated rule must exist after edit');
  const resolvedAfter = resolveScheduleWithSondZeit(updatedRule.schedule || '', mod10010After, ws2);
  assert.match(resolvedAfter.displayText, /09:30/, 'Schedule cache must invalidate immediately after rule edit');
  assert.match(resolvedAfter.displayText, /16:30/, 'Updated closing time 16:30 must appear immediately');
});

// 5. Global Search & Analysis Exports (no simulator coupling)
runTest('5. Global Search index, Registry, Health, Routing Matrix & Markdown', () => {
  const modules = parseCallflowTextWithFallback(buildSyntheticMultiScriptFixture(), { isMasterHint: true });
  const ws = buildScriptWorkspace(modules);

  const searchIndex = buildWorkspaceGlobalSearchIndex(ws);
  assert.ok(searchIndex.length >= 5, 'Global search index must contain entries');
  assert.ok(
    searchIndex.some((e) => e.category === 'script' && e.scriptNumber === '10010'),
    'Global search must index script 10010'
  );
  assert.ok(
    searchIndex.some((e) => e.category === 'queue' && /sk_kundenservice_de/i.test(e.title)),
    'Global search must index skillsets/queues'
  );

  const registry = extractWorkspaceResourceRegistry(ws);
  assert.ok(registry.skillsets.length >= 1, 'Registry must detect skillsets');

  const healthFindings = analyzeWorkspaceLogicHealth(ws);
  assert.ok(Array.isArray(healthFindings), 'Health analyzer must return findings array');

  const matrix = buildWorkspaceRoutingMatrix(ws);
  assert.ok(matrix.length >= 1, 'Routing matrix must produce rows');

  const matrixCsv = exportRoutingMatrixCsv(ws);
  assert.ok(matrixCsv.length > 50, 'Routing matrix CSV must be non-empty');

  const md = exportMigrationDocumentationMarkdown(ws);
  assert.ok(md.includes('10010'), 'Markdown export must include script 10010');
});

// 6. Interactive Callflow.html integrity & zero simulator leftovers
runTest('6. Interactive Callflow.html JS syntax validity & simulator removal', () => {
  const modules = parseCallflowTextWithFallback(buildSyntheticMultiScriptFixture(), { isMasterHint: true });
  const ws = buildScriptWorkspace(modules);
  const masterCode = buildMasterOverviewMermaid(ws, 'LR', { compact: true });
  const masterGraph = parseCallflowGraph(masterCode);
  const dummySvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g class="node"><rect width="80" height="40"/></g></svg>';

  const html = generateInteractiveCallflowHtml('Test Callflow', dummySvg, masterGraph, 'dark', {
    views: [
      {
        key: 'master',
        label: 'Master-Übersicht',
        masterViewVariant: 'compact',
        svg: dummySvg,
        graph: masterGraph,
      },
    ],
    activeViewKey: 'master',
    analysis: {
      openIssues: ws.issues || [],
      healthFindings: analyzeWorkspaceLogicHealth(ws),
      scheduleRows: buildWorkspaceScheduleOverview(ws),
      registry: extractWorkspaceResourceRegistry(ws),
      routingMatrixRows: buildWorkspaceRoutingMatrix(ws),
      masterScriptNumber: ws.masterScriptNumber,
    },
    globalSearchIndex: buildWorkspaceGlobalSearchIndex(ws),
  });

  // Extract inline script block and validate JS syntax with Function constructor
  const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scriptMatches.length >= 1, 'Callflow.html must contain an inline <script>');
  const inlineJs = scriptMatches[scriptMatches.length - 1][1];
  // Throws SyntaxError if any template literal or JS syntax is broken
  new Function(inlineJs);

  // Zero simulator leftovers in exported HTML
  for (const forbidden of [
    'btn-call-simulator',
    'call-sim-hud',
    'SIM_MODEL',
    'simState',
    'welcome-btn-sim',
    'runHtmlCallSimulation',
  ]) {
    assert.ok(!html.includes(forbidden), `Exported Callflow.html must not contain removed simulator artifact "${forbidden}"`);
  }

  // Core viewer features remain intact
  assert.ok(html.includes('global-search-modal-overlay'), 'Global search modal must exist in Callflow.html');
  assert.ok(html.includes('schedules-modal-overlay'), 'Opening hours modal must exist in Callflow.html');
  assert.ok(html.includes('Uhrzeiten'), 'Opening hours CSV with Uhrzeiten must be embedded in Callflow.html');
});

// 7. Export performance guard (120 scripts + 120-rule giant script) & version consistency
runTest('7. 120-script export performance guard (< 1500 ms) & version sync', () => {
  const blocks: string[] = [];
  blocks.push('=== Main ===');
  blocks.push('WHERE CLID EQUALS');
  for (let i = 1; i <= 119; i++) {
    blocks.push(`  VALUE 49300${String(i).padStart(4, '0')}: EXECUTE ${20000 + i}`);
  }
  blocks.push('END WHERE');

  // Giant script with 120 rules
  blocks.push('=== 20001 ===');
  for (let r = 1; r <= 120; r++) {
    const nextScript = 20000 + ((r % 118) + 2);
    blocks.push(`IF TIME OF DAY 08:00..17:00 THEN`);
    blocks.push(`  GIVE RAN ${1000 + r}`);
    blocks.push(`  EXECUTE ${nextScript}`);
    blocks.push('END IF');
  }

  for (let i = 2; i <= 119; i++) {
    const num = 20000 + i;
    blocks.push(`=== ${num} ===`);
    blocks.push('ASSIGN "SondZeit_Mo_Do_08_17_Fr_08_15" TO Sys_SondZeit');
    blocks.push('IF DAY OF WEEK EQUALS MONDAY..FRIDAY AND TIME OF DAY 08:00..17:00 THEN');
    blocks.push(`  QUEUE TO SKILLSET sk_team_${i}`);
    blocks.push('ELSE');
    blocks.push(`  GIVE RAN ${2000 + i}`);
    blocks.push('  DISCONNECT');
    blocks.push('END IF');
  }

  const t0 = performance.now();
  const parsed = parseCallflowTextWithFallback(blocks.join('\n'), { isMasterHint: true });
  const ws = buildScriptWorkspace(parsed);
  extractWorkspaceResourceRegistry(ws);
  analyzeWorkspaceLogicHealth(ws);
  buildWorkspaceScheduleOverview(ws);
  buildWorkspaceRoutingMatrix(ws);
  buildWorkspaceGlobalSearchIndex(ws);
  buildMasterOverviewMermaid(ws, 'LR', { compact: true });
  buildMasterOverviewMermaid(ws, 'LR', { compact: false });
  const inspectCtx = createWorkspaceInspectContext(ws);
  for (const mod of ws.modules) {
    const detailCode = buildScriptDetailMermaid(ws, mod.scriptNumber);
    const graph = parseCallflowGraph(detailCode);
    for (const node of [...graph.nodes.values()].slice(0, 6)) {
      inspectWorkspaceNodeForEdit(ws, { level: 'detail', scriptNumber: mod.scriptNumber }, node.id, graph, inspectCtx);
    }
  }
  const totalMs = performance.now() - t0;
  assert.ok(
    totalMs < 1500,
    `120-script export pipeline exceeded 1500 ms budget (took ${totalMs.toFixed(1)} ms)`
  );

  // Version consistency check
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.equal(
    pkg.version,
    AUDIT_APP_VERSION,
    `package.json version (${pkg.version}) must match AUDIT_APP_VERSION (${AUDIT_APP_VERSION})`
  );
  assert.equal(AUDIT_APP_VERSION, '1.4.1', 'Expected release version 1.4.1');
});

async function finalizeSuite() {
  // 8. Real ELK orthogonal layout (LR & TB), zero node overlaps on > 320-edge giant script & zero placeholders
  await runAsyncTest(
    '8. Real ELK layout (> 320 edges): zero node overlaps, LR/TB direction fidelity & cache hit',
    async () => {
      clearElkLayoutCache();

      // Normal script must stay on standard Mermaid path
      const normalMermaid = 'flowchart LR\n  A["Start"] --> B["Ende"]\n  B --> C["Queue"]';
      const normalGate = shouldUseFastDeterministicVectorLayout(normalMermaid);
      assert.equal(normalGate.useFastVector, false, 'Normal script must NOT trigger giant-script routing');

      const giantLines: string[] = ['=== 50001 ===', '/* Giant Stress Script */'];
      for (let r = 1; r <= 190; r++) {
        if (r === 1) giantLines.push('SECTION Eingangspruefung');
        if (r === 65) giantLines.push('SECTION Warteschleife');
        if (r === 130) giantLines.push('SECTION Eskalation');
        giantLines.push('IF DAY OF WEEK EQUALS MONDAY..FRIDAY AND TIME OF DAY 08:00..17:00 THEN');
        giantLines.push(`  GIVE RAN ${5000 + r}`);
        giantLines.push(`  EXECUTE ${60000 + r}`);
        giantLines.push('END IF');
      }
      const parsed = parseCallflowTextWithFallback(giantLines.join('\n'), { isMasterHint: true });
      const ws = buildScriptWorkspace(parsed);
      let detailMermaid = buildScriptDetailMermaid(ws, '50001');

      // Inject synthetic back-edges / cycle loops to verify outer perimeter cycle routing
      const baseGraph = parseCallflowGraph(detailMermaid);
      const stepIds = [...baseGraph.nodes.keys()].filter((id) => /^STEP_/i.test(id));
      if (stepIds.length >= 40) {
        const cycleLines = [
          `  ${stepIds[20]} -.->|"↻ Zyklus: Rücksprung A"| ${stepIds[2]}`,
          `  ${stepIds[35]} -.->|"↻ Zyklus: Rücksprung B"| ${stepIds[8]}`,
        ];
        detailMermaid = `${detailMermaid}\n${cycleLines.join('\n')}`;
      }

      const giantGate = shouldUseFastDeterministicVectorLayout(detailMermaid);
      assert.equal(
        giantGate.useFastVector,
        true,
        `Giant script (${giantGate.edgeCount} edges, ${giantGate.charLength} chars) must trigger ELK Worker routing`
      );

      const graph = parseCallflowGraph(detailMermaid);
      assert.ok(graph.edges.length > 320, `Expected > 320 edges for giant script, got ${graph.edges.length}`);

      // Test LR direction via real ELK engine
      const resLR = await renderElkWorkerFlowchartSvg({
        mermaidCode: detailMermaid,
        graph,
        surface: 'dark',
        direction: 'LR',
        title: '[50001] Giant Stress Script',
        timeoutMs: 18000,
      });
      assert.notEqual(
        resLR.engine,
        'deterministic-fallback',
        'Giant script should render cleanly through real ELK layout engine, not fallback'
      );
      assert.equal(resLR.direction, 'LR', 'ELK output must preserve LR direction');
      assert.ok(resLR.svg.startsWith('<svg '), 'ELK must output valid SVG root');
      assert.ok(resLR.svg.includes('data-edge-from="'), 'ELK edges must include O(1) data-edge-from');
      assert.ok(resLR.svg.includes('data-edge-to="'), 'ELK edges must include O(1) data-edge-to');
      assert.ok(resLR.svg.includes('class="node default"'), 'ELK must emit interactive Mermaid-compatible nodes');
      assert.ok(resLR.svg.includes('class="flowchart-link'), 'ELK must emit interactive flowchart links');
      assert.ok(resLR.svg.includes('class="cluster"'), 'ELK v1.2.0 must emit real subgraph/section container boxes');
      assert.ok(resLR.svg.includes('data-cycle-edge="true"'), 'ELK v1.2.0 must route cycle back-edges as outer arcs');
      assert.ok(
        resLR.svg.includes('data-resting-opacity="0.22"'),
        'Outer cycle arcs must carry resting transparency data-resting-opacity="0.22"'
      );
      assert.ok(
        /\sd="M[^"]*[QC]\s*[-0-9.]+/.test(resLR.svg),
        'ELK v1.2.0 must emit smooth Bézier curves (Q/C path commands)'
      );
      assert.ok(!resLR.svg.includes('Fallback-Ansicht'), 'Must never output static Fallback-Ansicht placeholder');
      assert.ok(!resLR.svg.includes('Platzhalter'), 'Must never output static Platzhalter text');

      const lrRects = extractNodeRectsFromSvg(resLR.svg);
      assert.equal(lrRects.length, graph.nodes.size, 'All graph nodes must be rendered in ELK SVG');
      assert.ok(
        lrRects.every((r) => r.h >= 66),
        'Every rendered node card must meet generous minimum height (>= 66 px) to prevent text overlap'
      );
      assert.equal(
        countOverlappingRectPairs(lrRects),
        0,
        'ELK LR layout must have ZERO overlapping node cards'
      );

      // Verify cache hit on repeat call
      const resLRCached = await renderElkWorkerFlowchartSvg({
        mermaidCode: detailMermaid,
        graph,
        surface: 'dark',
        direction: 'LR',
        title: '[50001] Giant Stress Script',
      });
      assert.equal(resLRCached.fromCache, true, 'Repeat ELK layout with same code/direction/surface must hit cache');

      // Test TB direction via real ELK engine (header switched to TB)
      const detailMermaidTB = detailMermaid.replace(/^flowchart\s+LR\b/i, 'flowchart TB');
      const resTB = await renderElkWorkerFlowchartSvg({
        mermaidCode: detailMermaidTB,
        graph,
        surface: 'light',
        direction: 'TB',
        title: '[50001] Giant Stress Script',
        timeoutMs: 18000,
      });
      assert.notEqual(
        resTB.engine,
        'deterministic-fallback',
        'Giant script TB must render cleanly through real ELK layout engine, not fallback'
      );
      assert.equal(resTB.direction, 'TB', 'ELK output must honor TB direction');
      assert.ok(resTB.svg.includes('class="cluster"'), 'ELK TB layout must also emit subgraph/section boxes');
      assert.ok(resTB.svg.includes('data-cycle-edge="true"'), 'ELK TB layout must route cycle back-edges outside');
      const tbRects = extractNodeRectsFromSvg(resTB.svg);
      assert.equal(tbRects.length, graph.nodes.size, 'All graph nodes must be rendered in ELK TB SVG');
      assert.equal(
        countOverlappingRectPairs(tbRects),
        0,
        'ELK TB layout must have ZERO overlapping node cards'
      );

      // Verify upgraded emergency fallback also has zero overlaps in both LR and TB
      const fbLR = buildDeterministicFlowchartSvg(graph, 'dark', '[50001]', 'LR');
      assert.equal(
        countOverlappingRectPairs(extractNodeRectsFromSvg(fbLR)),
        0,
        'Emergency fallback LR must have ZERO overlapping nodes'
      );
      const fbTB = buildDeterministicFlowchartSvg(graph, 'dark', '[50001]', 'TB');
      assert.equal(
        countOverlappingRectPairs(extractNodeRectsFromSvg(fbTB)),
        0,
        'Emergency fallback TB must have ZERO overlapping nodes'
      );

      // Verify App.tsx wires ELK Worker + cancel termination and has zero placeholder boxes
      const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
      assert.ok(
        appSrc.includes('renderElkWorkerFlowchartSvg'),
        'src/App.tsx must wire renderElkWorkerFlowchartSvg for giant scripts'
      );
      assert.ok(
        appSrc.includes('terminateActiveElkWorker'),
        'src/App.tsx must terminate ELK Worker on export cancellation'
      );
      assert.ok(!appSrc.includes('buildFallbackViewSvg'), 'src/App.tsx must not contain buildFallbackViewSvg');
      assert.ok(!appSrc.includes('Schutz-Platzhalter'), 'src/App.tsx must not contain Schutz-Platzhalter');
      assert.ok(!appSrc.includes('Platzhalter-Ansicht'), 'src/App.tsx must not contain Platzhalter-Ansicht');
    }
  );

  // 9. FlixCheck & AACC HDX offline logic processing (v7, Legacy v1 EOL, secret redaction, Registry, Search & Export)
  runTest(
    '9. FlixCheck & AACC HDX parsing, v1/v7 health checks, secret redaction, Registry & Callflow.html',
    () => {
      const syntheticSecret = 'fc_live_SyntheticDemoSecretKey987654321';
      const flixFixture = [
        '=== Main ===',
        'WHERE CLID EQUALS',
        '  VALUE 4930200100: EXECUTE FlixCheck_Schaden',
        '  VALUE 4930200200: EXECUTE FlixCheck_Legacy',
        '  VALUE 4930200300: EXECUTE Standard_HDX_Routing',
        '  DEFAULT: EXECUTE Standard_HDX_Routing',
        'END WHERE',
        '',
        '=== Standard_HDX_Routing ===',
        '/* Normales Avaya AACC Standard-Skript mit internem Host-DB/CTI HDX */',
        'ASSIGN "12345" TO fc_id',
        'ASSIGN "OK" TO fc_status',
        'SEND REQUEST HostDB, CLID, gv_kunde',
        'SEND INFO CTI_Server, gv_callid',
        'READVAR gv_segment FROM HostDB',
        'OPEN HOST Mainframe_01',
        'QUEUE TO SKILLSET sk_standard_hotline',
        '',
        '=== FlixCheck_Schaden ===',
        '/* Digitaler Schaden-Check via FlixCheck API v7 */',
        'ASSIGN "https://api.flixcheck.com/user/v7/checks" TO gv_fc_url',
        'ASSIGN "TPL_SCHADEN_2026" TO gv_fc_templateId',
        'ASSIGN "sms" TO gv_fc_sendType',
        'ASSIGN CLID TO gv_fc_recipient',
        'SEND REQUEST FlixCheck_HDX, gv_fc_url, gv_fc_templateId, gv_fc_sendType, gv_fc_recipient',
        'GET RESPONSE FlixCheck_HDX, gv_fc_status, gv_fc_checkId',
        'IF gv_fc_status = 200 THEN',
        '  GIVE RAN 7101',
        '  DISCONNECT',
        'ELSE',
        '  GIVE RAN 7199',
        '  QUEUE TO SKILLSET sk_schaden_fallback',
        'END IF',
        '',
        '=== FlixCheck_Legacy ===',
        '/* Veraltetes FlixCheck v1 Modul mit fehlendem Fallback & Klartext-Key */',
        `ASSIGN "${syntheticSecret}" TO gv_fc_apiKey`,
        'ASSIGN "https://api.flixcheck.com/api/v1/checks" TO gv_fc_url',
        'ASSIGN "whatsapp" TO gv_fc_sendType',
        'SEND REQUEST FlixCheck_V1, gv_fc_url, gv_fc_sendType',
        'GIVE RAN 7200',
        'DISCONNECT',
      ].join('\n');

      const parsed = parseCallflowTextWithFallback(flixFixture, { isMasterHint: true });
      const ws = buildScriptWorkspace(parsed);

      const modNormal = ws.modules.find((m) => m.scriptNumber === 'Standard_HDX_Routing');
      const modV7 = ws.modules.find((m) => m.scriptNumber === 'FlixCheck_Schaden');
      const modV1 = ws.modules.find((m) => m.scriptNumber === 'FlixCheck_Legacy');
      assert.ok(modNormal, 'Standard_HDX_Routing normal module must be parsed');
      assert.ok(modV7, 'FlixCheck_Schaden module must be parsed');
      assert.ok(modV1, 'FlixCheck_Legacy module must be parsed');

      // Normal AACC HDX script must keep hdxAction but NEVER be misclassified as FlixCheck or external HTTP API
      assert.ok(
        modNormal.rules.some((r) => Boolean(r.hdxAction && r.hdxAction.includes('HostDB'))),
        'Normal AACC HDX script must preserve internal hdxAction steps'
      );
      assert.equal(
        modNormal.rules.filter((r) => Boolean(r.externalIntegration)).length,
        0,
        'Normal AACC HDX script must NEVER attach externalIntegration or mix with FlixCheck'
      );

      const reqV7 = modV7.rules.find((r) => r.externalIntegration?.commandKind === 'send-request');
      assert.ok(reqV7?.externalIntegration, 'SEND REQUEST must attach externalIntegration metadata');
      assert.equal(reqV7.externalIntegration.isFlixcheck, true, 'Must classify as FlixCheck integration');
      assert.equal(reqV7.externalIntegration.apiVersion, 'v7', 'Must recognize /user/v7/checks as API v7');
      assert.equal(reqV7.externalIntegration.channel, 'sms', 'Must extract SMS channel from contextual ASSIGN');
      assert.equal(reqV7.externalIntegration.templateId, 'TPL_SCHADEN_2026', 'Must extract templateId from contextual ASSIGN');
      assert.equal(reqV7.externalIntegration.hasResponseHandler, true, 'Must correlate paired GET RESPONSE');
      assert.equal(reqV7.externalIntegration.hasErrorFallback, true, 'Must detect ELSE fallback queue');

      const reqV1 = modV1.rules.find((r) => r.externalIntegration?.commandKind === 'send-request');
      assert.ok(reqV1?.externalIntegration, 'Legacy FlixCheck SEND REQUEST must be parsed');
      assert.equal(reqV1.externalIntegration.apiVersion, 'v1-legacy', 'Must flag /api/v1/checks as v1-legacy');
      assert.equal(reqV1.externalIntegration.channel, 'whatsapp', 'Must extract WhatsApp channel');
      assert.equal(reqV1.externalIntegration.hasHardcodedSecret, true, 'Must detect hardcoded synthetic API key');
      assert.equal(reqV1.externalIntegration.hasResponseHandler, false, 'Must detect missing GET RESPONSE');

      // Health checks must surface v1 deprecation (EOL 31.12.2026), secret error, missing GET RESPONSE — and ZERO findings on Standard_HDX_Routing!
      const health = analyzeWorkspaceLogicHealth(ws);
      const apiHealth = health.filter((h) => h.category === 'external-api');
      assert.equal(
        apiHealth.filter((h) => h.scriptNumber === 'Standard_HDX_Routing').length,
        0,
        'Normal AACC HDX script must produce ZERO external-api / HTTP health findings'
      );
      assert.ok(
        apiHealth.some((h) => h.severity === 'error' && /klartext-api-key/i.test(h.title)),
        'Health check must flag hardcoded API key as error'
      );
      assert.ok(
        apiHealth.some((h) => h.severity === 'warning' && /v1/i.test(h.title) && h.title.includes('31.12.2026')),
        'Health check must flag deprecated FlixCheck API v1 with EOL 31.12.2026'
      );
      assert.ok(
        apiHealth.some((h) => h.severity === 'warning' && /ohne GET RESPONSE/i.test(h.title)),
        'Health check must warn about SEND REQUEST without GET RESPONSE'
      );

      // Resource Registry must populate externalApis ONLY for real FlixCheck/HTTP modules AND redact secret in variables
      const registry = extractWorkspaceResourceRegistry(ws);
      assert.ok((registry.externalApis || []).length >= 2, 'Resource Registry must list FlixCheck integrations');
      assert.equal(
        (registry.externalApis || []).some((a) =>
          a.usages.some((u) => u.scriptNumber === 'Standard_HDX_Routing')
        ),
        false,
        'Resource Registry externalApis must NOT mix in normal internal AACC HDX scripts'
      );
      assert.ok(
        (registry.externalApis || []).some((a) => a.templateId === 'TPL_SCHADEN_2026' && a.apiVersion === 'v7'),
        'Resource Registry must expose v7 FlixCheck template entry'
      );
      assert.ok(
        (registry.externalApis || []).some((a) => a.apiVersion === 'v1-legacy' && a.hasWarning),
        'Resource Registry must expose v1-legacy warning entry'
      );
      const serializedReg = JSON.stringify(registry);
      assert.ok(!serializedReg.includes(syntheticSecret), 'Registry must NEVER leak raw hardcoded API key');
      assert.ok(serializedReg.includes('***redacted***'), 'Registry must redact hardcoded API key');

      // Master & Detail Mermaid must show FlixCheck badges
      const masterMermaid = buildMasterOverviewMermaid(ws, 'LR', { compact: false });
      const detailV7 = buildScriptDetailMermaid(ws, 'FlixCheck_Schaden');
      assert.ok(masterMermaid.includes('FlixCheck'), 'Master diagram must highlight FlixCheck modules');
      assert.ok(detailV7.includes('TPL_SCHADEN_2026'), 'Detail diagram must display extracted template ID');
      assert.ok(detailV7.includes('API v7'), 'Detail diagram must display API v7 tag');

      // Global Search must index FlixCheck template & channel under category "api"
      const searchIndex = buildWorkspaceGlobalSearchIndex(ws);
      assert.ok(
        searchIndex.some((e) => e.category === 'api' && e.searchText.includes('tpl_schaden_2026')),
        'Global Search must index FlixCheck template under api category'
      );

      // Markdown documentation & Callflow.html export must include FlixCheck section without leaking secret
      const md = exportMigrationDocumentationMarkdown(ws);
      assert.ok(md.includes('Externe APIs & FlixCheck-Integrationen'), 'Markdown export must include FlixCheck section');
      assert.ok(!md.includes(syntheticSecret), 'Markdown export must NEVER leak hardcoded API key');

      const dummySvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g class="node"><rect width="80" height="40"/></g></svg>';
      const detailGraph = parseCallflowGraph(detailV7);
      const html = generateInteractiveCallflowHtml('FlixCheck Test', dummySvg, detailGraph, 'dark', {
        views: [{ key: 'script:FlixCheck_Schaden', label: 'FlixCheck_Schaden', svg: dummySvg, graph: detailGraph }],
        activeViewKey: 'script:FlixCheck_Schaden',
        analysis: {
          openIssues: ws.issues || [],
          healthFindings: health,
          scheduleRows: buildWorkspaceScheduleOverview(ws),
          registry,
          routingMatrixRows: buildWorkspaceRoutingMatrix(ws),
          masterScriptNumber: ws.masterScriptNumber,
        },
        globalSearchIndex: searchIndex,
      });
      const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      new Function(scriptMatches[scriptMatches.length - 1][1]);
      assert.ok(html.includes('FlixCheck / APIs'), 'Callflow.html must render FlixCheck / APIs registry tab');
      assert.ok(!html.includes(syntheticSecret), 'Callflow.html must NEVER leak hardcoded API key');
    }
  );

  // 10. Strict Master <-> Import reconciliation (Space->_, dot preservation, no _alt false matches, Sub-Dispatcher Main guard, missing in Checklist & Logic Health)
  await runAsyncTest(
    '10. Strict Master <-> Import matching (Space->_, no fuzzy _alt, Sub-Dispatcher guard, missing-script Health)',
    async () => {
      const makeVirtualFile = (name: string, content: string): File => {
        const f = new File([content], name, { type: 'text/plain' });
        Object.defineProperty(f, 'webkitRelativePath', {
          value: `AACC_Export/${name}`,
          configurable: true,
        });
        return f;
      };

      const mainText = [
        'WHERE CLID EQUALS',
        '  VALUE 49301001: EXECUTE "Kunden Service"',
        '  VALUE 49301002: EXECUTE FlixCheck.V2',
        '  VALUE 49301003: EXECUTE Sub_Dispatcher',
        '  VALUE 49301004: EXECUTE Support_Team',
        'END WHERE',
      ].join('\n');

      const kundenServiceText = [
        '/* Kunden Service */',
        'GIVE RAN 5101',
        'QUEUE TO SKILLSET sk_kunden_service',
      ].join('\n');

      const flixV2Text = [
        '/* FlixCheck V2 */',
        'GIVE RAN 5102',
        'DISCONNECT',
      ].join('\n');

      const subDispatcherText = [
        '/* Unter-Dispatcher mit eigenen VALUE-Regeln — darf NIE Main überschreiben! */',
        'WHERE CLID EQUALS',
        '  VALUE 49309901: EXECUTE "Kunden Service"',
        '  VALUE 49309902: EXECUTE FlixCheck.V2',
        'END WHERE',
      ].join('\n');

      const altFalseMatchText = [
        '/* Veraltete Kopie — darf NICHT für Support_Team geladen werden */',
        'QUEUE TO SKILLSET sk_alt_falsch',
      ].join('\n');

      const unusedLegacyText = [
        '/* Ungenutzte Altlast im Ordner */',
        'GIVE RAN 9999',
        'DISCONNECT',
      ].join('\n');

      const folderFiles = [
        makeVirtualFile('Main.s', mainText),
        makeVirtualFile('Kunden_Service.s', kundenServiceText),
        makeVirtualFile('FlixCheck.V2.s', flixV2Text),
        makeVirtualFile('Sub_Dispatcher.s', subDispatcherText),
        makeVirtualFile('Support_Team_alt.s', altFalseMatchText),
        makeVirtualFile('Legacy_4910_Test.s', unusedLegacyText),
      ];

      const pool = indexScriptFolderFiles(folderFiles);
      const initialMaster = parseCallflowTextWithFallback(mainText, {
        sourceFilename: 'Main.s',
        isMasterHint: true,
      });

      const summary = await autoResolveConnectedScriptsFromFolder(initialMaster, pool, {
        masterScriptNumber: 'Main',
      });

      const ws = buildScriptWorkspace(summary.modules, {
        masterScriptNumber: 'Main',
        treatUnresolvedAsEndpoint: false,
      });

      // Exact Space->_ and dot-preserving matches must be loaded
      assert.ok(
        ws.modules.some((m) => m.scriptNumber === 'Kunden_Service' && m.sourceFilename === 'Kunden_Service.s'),
        'Space in Master ("Kunden Service") must strictly match "Kunden_Service.s"'
      );
      assert.ok(
        ws.modules.some((m) => m.scriptNumber === 'FlixCheck.V2' && m.sourceFilename === 'FlixCheck.V2.s'),
        'Dots in script names ("FlixCheck.V2") must be preserved and matched against "FlixCheck.V2.s"'
      );

      // Sub-Dispatcher with VALUE...EXECUTE must keep its own scriptNumber and NOT merge into Main!
      assert.ok(
        ws.modules.some((m) => m.scriptNumber === 'Sub_Dispatcher' && !m.isMaster),
        'Sub_Dispatcher with VALUE...EXECUTE must stay a separate non-master module'
      );

      // Support_Team_alt.s must NEVER be falsely matched to Support_Team!
      assert.equal(
        ws.modules.some((m) => m.sourceFilename === 'Support_Team_alt.s'),
        false,
        'Strict matcher must NEVER load Support_Team_alt.s for Support_Team'
      );

      // Missing script must remain genuinely missing in missingTargets, masterChecklist, and Logic Health!
      assert.ok(
        ws.missingTargets.includes('Support_Team'),
        'Missing Support_Team must stay in ws.missingTargets (not hidden as external endpoint)'
      );
      const checklistSupport = (ws.masterChecklist || []).find((c) => c.refKey === 'Support_Team');
      assert.equal(
        checklistSupport?.status,
        'missing',
        'Support_Team must have status "missing" in masterChecklist'
      );
      const checklistKunden = (ws.masterChecklist || []).find((c) => c.refKey === 'Kunden_Service');
      assert.equal(checklistKunden?.status, 'present', 'Kunden_Service must be "present" in masterChecklist');
      assert.equal(
        checklistKunden?.matchedSourceFilename,
        'Kunden_Service.s',
        'masterChecklist must record matchedSourceFilename'
      );

      const health = analyzeWorkspaceLogicHealth(ws);
      assert.ok(
        health.some(
          (h) => h.category === 'missing-script' && h.title.includes('[Support_Team]')
        ),
        'Logic Health must report Support_Team under category "missing-script"'
      );

      // Unused folder files must list exactly Support_Team_alt.s and Legacy_4910_Test.s (never Main.s or loaded files)
      const unusedNames = summary.unusedFolderFiles.map((u) => u.filename).sort();
      assert.deepEqual(
        unusedNames,
        ['Legacy_4910_Test.s', 'Support_Team_alt.s'],
        'unusedFolderFiles must list exactly unreferenced folder scripts'
      );
    }
  );

  // 11. Avaya-only / FlixCheck / Menu / flow_1 / numeric / TRANSFER / GIVE CDN Waypoints & real .s precedence
  await runAsyncTest(
    '11. Avaya-only Wegweiser (Menu, FlixCheck, flow_1, Nummern, TRANSFER/CDN, spaced SECTION) & manuelle Markierung',
    async () => {
      // Unit assertions for classifyAvayaWaypointTarget
      assert.equal(classifyAvayaWaypointTarget('FlixCheck'), 'FlixCheck-Wegweiser');
      assert.equal(classifyAvayaWaypointTarget('Menu'), 'Menü / Flow (Avaya-only)');
      assert.equal(classifyAvayaWaypointTarget('Menü_Haupt'), 'Menü / Flow (Avaya-only)');
      assert.equal(classifyAvayaWaypointTarget('flow_1'), 'Menü / Flow (Avaya-only)');
      assert.equal(classifyAvayaWaypointTarget('4910'), 'Avaya-Nummer / CDN');
      assert.equal(classifyAvayaWaypointTarget('0800123456'), 'Avaya-Nummer / CDN');
      assert.equal(
        classifyAvayaWaypointTarget('Extern_Hotline_XYZ', { isAvayaRouteCmd: true }),
        'Avaya-Weiterleitung (Transfer/CDN)'
      );
      assert.equal(
        classifyAvayaWaypointTarget('Support_Team'),
        null,
        'Ordinary missing named script Support_Team must NOT be auto-classified as waypoint'
      );

      const makeVirtualFile = (name: string, content: string): File => {
        const f = new File([content], name, { type: 'text/plain' });
        Object.defineProperty(f, 'webkitRelativePath', {
          value: `Avaya_Prod/${name}`,
          configurable: true,
        });
        return f;
      };

      const mainText = [
        'WHERE CLID EQUALS',
        '  VALUE 49301001: EXECUTE Menu',
        '  VALUE 49301002: EXECUTE FlixCheck',
        '  VALUE 49301003: EXECUTE flow_1',
        '  VALUE 49301004: EXECUTE flow_2',
        '  VALUE 49301005: EXECUTE 4910',
        '  VALUE 49301006: TRANSFER TO Extern_Hotline_XYZ',
        '  VALUE 49301007: GIVE CDN 5500',
        '  VALUE 49301008: EXECUTE Support_Team',
        '  DEFAULT: GOTO "Menu Auswahl"',
        'END WHERE',
        '',
        'SECTION "Menu Auswahl"',
        '  GIVE RAN 3001',
        '  DISCONNECT',
      ].join('\n');

      // Real .s file exists for flow_2 -> MUST beat waypoint heuristic and load as present!
      const flow2Text = [
        '/* Echtes vorhandenes flow_2.s Skript */',
        'IF TIME OF DAY 08:00..17:00 THEN',
        '  GIVE RAN 3002',
        '  QUEUE TO SKILLSET sk_flow2_live',
        'ELSE',
        '  EXECUTE FlixCheck',
        'END IF',
      ].join('\n');

      const pool = indexScriptFolderFiles([
        makeVirtualFile('Main.s', mainText),
        makeVirtualFile('flow_2.s', flow2Text),
      ]);

      const initialMaster = parseCallflowTextWithFallback(mainText, {
        sourceFilename: 'Main.s',
        isMasterHint: true,
      });

      const summary = await autoResolveConnectedScriptsFromFolder(initialMaster, pool, {
        masterScriptNumber: 'Main',
      });

      const ws = buildScriptWorkspace(summary.modules, {
        masterScriptNumber: 'Main',
        treatUnresolvedAsEndpoint: false,
      });

      // Strict precedence: real flow_2.s MUST be loaded and marked as present (never waypoint)
      assert.ok(
        ws.modules.some((m) => m.scriptNumber === 'flow_2' && m.sourceFilename === 'flow_2.s'),
        'Real flow_2.s in folder must always be loaded even though flow_* matches waypoint heuristic'
      );
      const itemFlow2 = (ws.masterChecklist || []).find((c) => c.refKey === 'flow_2');
      assert.equal(itemFlow2?.status, 'present', 'Loaded flow_2.s must have status "present"');

      // Auto-detected Avaya-only waypoints MUST have status "waypoint" and NEVER appear in missingTargets
      for (const expectedWp of ['Menu', 'FlixCheck', 'flow_1', '4910', 'Extern_Hotline_XYZ', '5500']) {
        const entry = (ws.masterChecklist || []).find(
          (c) => c.refKey.toLowerCase() === expectedWp.toLowerCase()
        );
        assert.ok(entry, `Expected "${expectedWp}" in masterChecklist`);
        assert.equal(
          entry?.status,
          'waypoint',
          `Unresolved Avaya target "${expectedWp}" must be classified as "waypoint", got "${entry?.status}"`
        );
        assert.ok(entry?.waypointReason, `Waypoint "${expectedWp}" must include a descriptive waypointReason`);
        assert.equal(
          ws.missingTargets.some((t) => t.toLowerCase() === expectedWp.toLowerCase()),
          false,
          `Waypoint "${expectedWp}" must NOT be listed in ws.missingTargets`
        );
      }

      // Local SECTION "Menu Auswahl" must NOT be flagged as missing or in masterChecklist
      assert.equal(
        ws.missingTargets.some((t) => /menu.*auswahl/i.test(t)),
        false,
        'Local space-containing SECTION "Menu Auswahl" must not appear in missingTargets'
      );
      assert.equal(
        (ws.masterChecklist || []).some((c) => /menu.*auswahl/i.test(c.refKey)),
        false,
        'Local space-containing SECTION "Menu Auswahl" must not appear in masterChecklist'
      );

      // Genuine missing named script Support_Team MUST remain missing & flagged in Logic Health
      const itemSupport = (ws.masterChecklist || []).find((c) => c.refKey === 'Support_Team');
      assert.equal(itemSupport?.status, 'missing', 'Genuine missing Support_Team must stay "missing"');
      assert.ok(ws.missingTargets.includes('Support_Team'), 'Support_Team must be in ws.missingTargets');

      const healthBefore = analyzeWorkspaceLogicHealth(ws);
      const missingHealthBefore = healthBefore.filter((h) => h.category === 'missing-script');
      assert.equal(
        missingHealthBefore.length,
        1,
        `Only Support_Team should trigger missing-script in Logic Health, got: ${missingHealthBefore.map((h) => h.title).join(', ')}`
      );
      assert.ok(missingHealthBefore[0].title.includes('[Support_Team]'));

      // Master Overview Mermaid must render waypoints with avayaWaypoint styling (not missingScript)
      const masterMermaid = buildMasterOverviewMermaid(ws, 'LR', { compact: false });
      assert.ok(masterMermaid.includes(':::avayaWaypoint'), 'Master overview must emit :::avayaWaypoint nodes');
      assert.ok(masterMermaid.includes('classDef avayaWaypoint'), 'Master overview must define classDef avayaWaypoint');

      // Manual waypoint marking + rehydrate persistence + undo
      const wsMarked = markAvayaWaypointsInWorkspace(ws, ['Support_Team']);
      const supportAfterMark = (wsMarked.masterChecklist || []).find((c) => c.refKey === 'Support_Team');
      assert.equal(supportAfterMark?.status, 'waypoint', 'Manually marked Support_Team must become "waypoint"');
      assert.equal(supportAfterMark?.isManualWaypoint, true, 'Manual waypoint must set isManualWaypoint=true');
      assert.equal(wsMarked.missingTargets.length, 0, 'Manual waypoint must clear Support_Team from missingTargets');
      assert.equal(
        analyzeWorkspaceLogicHealth(wsMarked).filter((h) => h.category === 'missing-script').length,
        0,
        'Manual waypoint must clear missing-script from Logic Health'
      );

      // Rehydration persistence check
      const wsRehydrated = rehydrateAndUpgradeWorkspace(JSON.parse(JSON.stringify(wsMarked)));
      const supportRehydrated = (wsRehydrated.masterChecklist || []).find((c) => c.refKey === 'Support_Team');
      assert.equal(
        supportRehydrated?.status,
        'waypoint',
        'Manual waypoint must survive workspace serialization & rehydration'
      );
      assert.equal(supportRehydrated?.isManualWaypoint, true);

      // Undo manual waypoint
      const wsUndone = unmarkAvayaWaypointInWorkspace(wsRehydrated, 'Support_Team');
      const supportUndone = (wsUndone.masterChecklist || []).find((c) => c.refKey === 'Support_Team');
      assert.equal(supportUndone?.status, 'missing', 'Unmarking manual waypoint must restore status "missing"');
      assert.ok(wsUndone.missingTargets.includes('Support_Team'), 'Unmarked script must return to missingTargets');
    }
  );

  // 14. Full-folder .s loading, 1:1 divider-safe parsing, 5-level deep nesting, inline assign+execute, minimal .s & NFC/NFD Unicode matching
  await runAsyncTest(
    '14. Full-folder .s loader: 1:1 divider-safe identity, 5-level deep nesting, inline assign+execute, minimal .s, NFC/NFD & full Master diagram',
    async () => {
      const makeVirtualFile = (name: string, content: string): File =>
        ({
          name,
          webkitRelativePath: `FullFolder/${name}`,
          arrayBuffer: async () => new TextEncoder().encode(content).buffer,
        }) as unknown as File;

      const mainS = [
        'section Init',
        'WHERE DNIS EQUALS',
        '  VALUE 1001: EXECUTE Ebene1_Einstieg',
        '  VALUE 1002: assign 1 to gv_flag execute Ebene1_Inline',
        'END WHERE',
      ].join('\n');

      // Single .s file containing decorative === / --- dividers and standalone CDN lines (must NEVER split into 9000/9001!)
      const ebene1S = [
        '/* Header */',
        '=== Teil 1 Eingang ===',
        'CDN 4010',
        'section Init',
        '--- Weiterleitung ---',
        'IF DAY OF WEEK EQUALS MONDAY..FRIDAY THEN',
        '  EXECUTE Ebene2_Verteiler',
        'END IF',
      ].join('\n');

      const ebene1InlineS = [
        'section Init',
        'assign 42 to gv_test; execute Ebene2_Verteiler',
      ].join('\n');

      const ebene2S = [
        'section Init',
        'EXECUTE Ebene3_Tiefe',
      ].join('\n');

      // Calls an umlaut target in NFC while the file on disk uses macOS NFD decomposition (`U\u0308bersicht_Ebene4.s`)
      const ebene3S = [
        'section Init',
        'EXECUTE Übersicht_Ebene4',
      ].join('\n');

      const ebene4NfdName = 'U\u0308bersicht_Ebene4.s';
      const ebene4S = [
        'section Init',
        'EXECUTE Ebene5_Minimal',
      ].join('\n');

      // Minimal / comment-only .s file that still exists 1:1 in the folder
      const ebene5MinimalS = '/* Nur Platzhalter / Sonderlogik im Kommentar */\n';

      // Standalone .s scripts NOT referenced by Main (must STILL be loaded and embedded in the Master diagram!)
      const standaloneFiles: File[] = [];
      for (let i = 1; i <= 12; i++) {
        standaloneFiles.push(
          makeVirtualFile(
            `Standalone_Archiv_${i}.s`,
            `section Init\nGIVE RAN ${900 + i}\nDISCONNECT\n`
          )
        );
      }

      const pool = indexScriptFolderFiles([
        makeVirtualFile('Main.s', mainS),
        makeVirtualFile('Ebene1_Einstieg.s', ebene1S),
        makeVirtualFile('Ebene1_Inline.s', ebene1InlineS),
        makeVirtualFile('Ebene2_Verteiler.s', ebene2S),
        makeVirtualFile('Ebene3_Tiefe.s', ebene3S),
        makeVirtualFile(ebene4NfdName, ebene4S),
        makeVirtualFile('Ebene5_Minimal.s', ebene5MinimalS),
        ...standaloneFiles,
      ]);

      const initialMaster = parseCallflowTextWithFallback(mainS, {
        sourceFilename: 'Main.s',
        isMasterHint: true,
      });

      let progressCalls = 0;
      const summary = await loadAllScriptsFromFolder(initialMaster, pool, {
        masterScriptNumber: 'Main',
        batchSize: 5,
        onProgress: () => {
          progressCalls += 1;
        },
      });

      assert.equal(summary.mode, 'all', 'Full-folder loader must set mode="all"');
      assert.ok(progressCalls >= 2, 'Full-folder loader must report incremental progress');

      const ws = buildScriptWorkspace(summary.modules, {
        masterScriptNumber: 'Main',
        treatUnresolvedAsEndpoint: false,
      });

      // Zero false-positive missing targets across all 5 nesting levels!
      assert.deepEqual(
        ws.missingTargets,
        [],
        `Expected 0 missing targets for 1:1 folder files, got: ${ws.missingTargets.join(', ')}`
      );

      // Divider-heavy Ebene1_Einstieg.s must NOT have been split into 9000/9001
      assert.equal(
        ws.modules.some((m) => /^900\d$/.test(m.scriptNumber)),
        false,
        'Single .s file with === / --- dividers must NEVER produce anonymous 9000/9001 modules'
      );
      for (const expectedName of [
        'Main',
        'Ebene1_Einstieg',
        'Ebene1_Inline',
        'Ebene2_Verteiler',
        'Ebene3_Tiefe',
        'Übersicht_Ebene4',
        'Ebene5_Minimal',
      ]) {
        assert.ok(
          ws.modules.some((m) => m.scriptNumber.normalize('NFC') === expectedName.normalize('NFC')),
          `Expected loaded module "${expectedName}" in workspace`
        );
      }

      // Every single checklist item across depth 1..5 must be "present"
      const checklist = ws.masterChecklist || [];
      assert.ok(checklist.length >= 6, `Expected >= 6 checklist items across deep chain, got ${checklist.length}`);
      const notPresent = checklist.filter((c) => c.status !== 'present');
      assert.equal(
        notPresent.length,
        0,
        `Every 1:1 nested script must be present, found non-present: ${notPresent.map((c) => `${c.refKey}:${c.status}`).join(', ')}`
      );

      // All 12 standalone .s files must be loaded AND embedded in the Master Overview diagram
      assert.equal(
        summary.standaloneScriptNumbers?.length,
        12,
        `Expected 12 standalone scripts tracked, got ${summary.standaloneScriptNumbers?.length}`
      );
      const masterMermaid = buildMasterOverviewMermaid(ws, 'LR', { compact: true });
      for (let i = 1; i <= 12; i++) {
        assert.ok(
          masterMermaid.includes(`Standalone_Archiv_${i}`),
          `Standalone script Standalone_Archiv_${i} must be embedded in the Master diagram`
        );
      }
      assert.ok(
        masterMermaid.includes('Ebene5_Minimal'),
        'Deeply nested Ebene5_Minimal must be embedded in the Master diagram'
      );
    }
  );

  // 15. OCL 'has' false-positive prevention & Oracle / Agent_Queuing / Skillset_Queuing / Loop waypoint classification
  await runAsyncTest(
    '15. OCL "has" false-positive prevention & Oracle / Agent_Queuing / Skillset_Queuing / Loop waypoints (with .s precedence)',
    async () => {
      const makeVirtualFile = (name: string, content: string): File =>
        ({
          name,
          webkitRelativePath: `OracleCheck/${name}`,
          arrayBuffer: async () => new TextEncoder().encode(content).buffer,
        }) as unknown as File;

      const mainWithCallHasAndOracle = [
        'section Init',
        'EVENT CALL HAS ABANDONED',
        '  SEND INFO "The call has been abandoned while queued"',
        'END EVENT',
        'IF CALL HAS PRIORITY THEN',
        '  SEND INFO "call has priority and call was routed"',
        '  EXECUTE Agent_Queuing_Oracle',
        '  EXECUTE agent_queuing_oracle.s',
        '  EXECUTE agent_queing',
        '  EXECUTE agent_queing.s',
        'ELSE',
        '  EXECUTE Agent_Queuing',
        '  EXECUTE Skillset_Queuing',
        '  EXECUTE Skillset_Queing',
        '  EXECUTE Oracle_CRM',
        '  EXECUTE Wait_Loop',
        '  EXECUTE Custom_Queuing',
        '  EXECUTE Echtes_Fehlendes_Skript',
        'END IF',
      ].join('\n');

      const parsedNoLocal = parseCallflowTextWithFallback(mainWithCallHasAndOracle, {
        sourceFilename: 'Main.s',
        isMasterHint: true,
      });
      const wsNoLocal = buildScriptWorkspace(parsedNoLocal, {
        masterScriptNumber: 'Main',
        treatUnresolvedAsEndpoint: false,
      });

      // 1. "has" / "was" / "abandoned" must NEVER be extracted as targets
      const allChecklistKeys = (wsNoLocal.masterChecklist || []).map((c) => c.refKey.toLowerCase());
      for (const bogus of ['has', 'was', 'abandoned', 'priority', 'queued']) {
        assert.equal(
          allChecklistKeys.includes(bogus),
          false,
          `Bogus OCL word "${bogus}" must NEVER appear in masterChecklist`
        );
        assert.equal(
          wsNoLocal.missingTargets.some((t) => t.toLowerCase() === bogus),
          false,
          `Bogus OCL word "${bogus}" must NEVER appear in missingTargets`
        );
      }

      // 2. Oracle, Agent_Queuing, agent_queing, Skillset_Queuing, Skillset_Queing, Wait_Loop & Custom_Queuing -> automatic Wegweiser (0 offen)
      const expectedWaypoints: Array<{ ref: string; reasonPart: string }> = [
        { ref: 'Agent_Queuing_Oracle', reasonPart: 'Oracle Agent-Queuing' },
        { ref: 'agent_queing', reasonPart: 'Agent-/Skillset-Queuing' },
        { ref: 'Oracle_CRM', reasonPart: 'Oracle-Anbindung' },
        { ref: 'Agent_Queuing', reasonPart: 'Agent-/Skillset-Queuing' },
        { ref: 'Skillset_Queuing', reasonPart: 'Agent-/Skillset-Queuing' },
        { ref: 'Skillset_Queing', reasonPart: 'Agent-/Skillset-Queuing' },
        { ref: 'Wait_Loop', reasonPart: 'Queuing-/Loop-Routine' },
        { ref: 'Custom_Queuing', reasonPart: 'Queuing-/Loop-Routine' },
      ];
      for (const exp of expectedWaypoints) {
        const item = (wsNoLocal.masterChecklist || []).find(
          (c) => c.refKey.toLowerCase() === exp.ref.toLowerCase()
        );
        assert.ok(item, `Expected "${exp.ref}" in masterChecklist`);
        assert.equal(
          item?.status,
          'waypoint',
          `Expected "${exp.ref}" to be classified as "waypoint", got "${item?.status}"`
        );
        assert.ok(
          item?.waypointReason?.includes(exp.reasonPart),
          `Expected waypointReason for "${exp.ref}" to include "${exp.reasonPart}", got "${item?.waypointReason}"`
        );
        assert.equal(
          wsNoLocal.missingTargets.some((t) => t.toLowerCase() === exp.ref.toLowerCase()),
          false,
          `"${exp.ref}" must NOT appear in missingTargets`
        );
      }

      // Also verify direct classifier on .s variants & typo variants
      assert.equal(classifyAvayaWaypointTarget('agent_queing.s'), 'Agent-/Skillset-Queuing (Avaya)');
      assert.equal(
        classifyAvayaWaypointTarget('agent_queuing_oracle.s'),
        'Oracle Agent-Queuing (System)'
      );
      assert.equal(
        classifyAvayaWaypointTarget('agent_queing_oracle'),
        'Oracle Agent-Queuing (System)'
      );

      // Only Echtes_Fehlendes_Skript remains missing (and health audit must NOT flag agent_queing, agent_queuing_oracle, or has)
      assert.deepEqual(
        wsNoLocal.missingTargets,
        ['Echtes_Fehlendes_Skript'],
        `Only genuine missing script should remain in missingTargets, got: ${wsNoLocal.missingTargets.join(', ')}`
      );
      const healthNoLocal = analyzeWorkspaceLogicHealth(wsNoLocal);
      const missingHealthIds = healthNoLocal
        .filter((f) => f.category === 'missing-script')
        .map((f) => f.id);
      assert.deepEqual(
        missingHealthIds,
        ['health:missing-script:echtes_fehlendes_skript'],
        `Only genuine missing script should appear in health findings, got: ${missingHealthIds.join(', ')}`
      );

      const masterMermaid = buildMasterOverviewMermaid(wsNoLocal, 'LR', { compact: false });
      assert.ok(
        masterMermaid.includes('Agent_Queuing_Oracle') && masterMermaid.includes(':::avayaWaypoint'),
        'Master diagram must render Agent_Queuing_Oracle as :::avayaWaypoint'
      );
      assert.ok(
        masterMermaid.includes('agent_queing') && !masterMermaid.includes('● OFFEN · agent_queing'),
        'Master diagram must render agent_queing as waypoint, never as OFFEN missing script'
      );

      // 2b. Ebene 2 (detail diagram) MUST also render Agent_Queuing_Oracle & agent_queing as :::avayaWaypoint, never :::missingScript
      const detailMermaid = buildScriptDetailMermaid(wsNoLocal, 'Main', 'LR');
      assert.ok(
        detailMermaid.includes('JUMP_Agent_Queuing_Oracle(["↗ Agent_Queuing_Oracle') &&
          detailMermaid.includes(':::avayaWaypoint'),
        'Ebene 2 detail diagram must render Agent_Queuing_Oracle as :::avayaWaypoint'
      );
      assert.ok(
        detailMermaid.includes('JUMP_agent_queing(["↗ agent_queing') &&
          !detailMermaid.includes('● OFFEN · [agent_queing]'),
        'Ebene 2 detail diagram must render agent_queing as :::avayaWaypoint, never OFFEN'
      );
      assert.ok(
        detailMermaid.includes('● OFFEN · [Echtes_Fehlendes_Skript]'),
        'Ebene 2 detail diagram must still flag genuine missing script'
      );

      // 2c. Legacy/stale cached workspace without rawText containing bogus "has", "has.", "agent_queing", "agent_queuing_oracle.s"
      const staleLegacyWorkspace = buildScriptWorkspace([
        {
          scriptNumber: 'Legacy_Visio_Main',
          scriptName: 'Legacy_Visio_Main',
          isMaster: true,
          origin: 'visio-new',
          rawText: '',
          rules: [
            {
              id: 'r1',
              prio: 1,
              stepName: 'Legacy OCL call has',
              sourceNumber: 'Legacy_Visio_Main',
              targetNumber: 'has',
              choices: [
                { choice: '1', targetNumber: 'has.' },
                { choice: '2', targetNumber: 'agent_queing' },
                { choice: '3', targetNumber: 'agent_queuing_oracle.s' },
              ],
              rawLine: 'CALL HAS ABANDONED',
            },
          ],
          outgoingNumbers: ['has', 'has.', 'agent_queing', 'agent_queuing_oracle.s'],
        },
      ]);
      const upgradedStale = rehydrateAndUpgradeWorkspace(staleLegacyWorkspace);
      assert.deepEqual(
        upgradedStale.missingTargets,
        [],
        `Stale legacy workspace must yield 0 missingTargets after sanitization, got: ${upgradedStale.missingTargets.join(', ')}`
      );
      assert.equal(
        analyzeWorkspaceLogicHealth(upgradedStale).filter((f) => f.category === 'missing-script').length,
        0,
        'Stale legacy workspace must yield 0 missing-script health findings'
      );
      assert.equal(
        (upgradedStale.masterChecklist || []).some((c) => c.refKey.toLowerCase().startsWith('has')),
        false,
        'Stale legacy "has" must be completely stripped from masterChecklist'
      );

      // 3. Strict 1:1 .s precedence: if Agent_Queuing.s IS in the folder, it MUST load as "present" (never waypoint)
      const poolWithRealAgentQueuing = indexScriptFolderFiles([
        makeVirtualFile('Main.s', mainWithCallHasAndOracle),
        makeVirtualFile('Agent_Queuing.s', 'section Init\nQUEUE TO AGENT gv_agent\nWAIT 30\n'),
      ]);
      const fullSummary = await loadAllScriptsFromFolder(parsedNoLocal, poolWithRealAgentQueuing, {
        masterScriptNumber: 'Main',
      });
      const wsWithLocal = buildScriptWorkspace(fullSummary.modules, {
        masterScriptNumber: 'Main',
        treatUnresolvedAsEndpoint: false,
      });
      const agentItem = (wsWithLocal.masterChecklist || []).find(
        (c) => c.refKey === 'Agent_Queuing'
      );
      assert.equal(
        agentItem?.status,
        'present',
        'When Agent_Queuing.s exists locally in folder, it must have status "present" instead of "waypoint"'
      );
      const oracleItem = (wsWithLocal.masterChecklist || []).find(
        (c) => c.refKey === 'Agent_Queuing_Oracle'
      );
      assert.equal(
        oracleItem?.status,
        'waypoint',
        'Agent_Queuing_Oracle without local .s file must remain "waypoint"'
      );
    }
  );

  // 16. Structured Opening Hours Export: Mo–So Matrix, 24/7 Separation, 4-Sheet .xlsx Workbook & Callflow.html Parity
  await runAsyncTest(
    '16. Opening Hours Mo–So matrix, 24/7 separation, native 4-sheet .xlsx & Callflow.html parity',
    async () => {
      // A. Mo–So matrix parser edge cases
      const splitWeek = parseScheduleToWeekdayMatrix('Mo–Do 08:00–17:00, Fr 08:00–15:00', true);
      assert.equal(splitWeek.Mo, '08:00–17:00');
      assert.equal(splitWeek.Do, '08:00–17:00');
      assert.equal(splitWeek.Fr, '08:00–15:00');
      assert.equal(splitWeek.Sa, 'Geschlossen');
      assert.equal(splitWeek.So, 'Geschlossen');

      const lunchBreak = parseScheduleToWeekdayMatrix('Mo–Fr 08:00–12:00, 13:00–17:00', true);
      assert.equal(lunchBreak.Mo, '08:00–12:00, 13:00–17:00');
      assert.equal(lunchBreak.Sa, 'Geschlossen');

      const unresolvedSz = parseScheduleToWeekdayMatrix('SondZeit_Extern_CCMA_Unbekannt', true);
      assert.equal(unresolvedSz.Mo, '—', 'Unresolved CCMA SondZeit must conservatively stay "—"');
      assert.equal(unresolvedSz.Sa, '—', 'Unresolved CCMA SondZeit must not falsely claim Geschlossen');

      // B. Consolidated 1-row-per-script bundle + 24/7 separation + dedicated holiday entries
      const modules = parseCallflowTextWithFallback(buildSyntheticMultiScriptFixture(), { isMasterHint: true });
      const ws = buildScriptWorkspace(modules);
      const bundle = buildWorkspaceOpeningHoursBundle(ws, { diagramTitle: 'Test-Callflow' });

      assert.equal(
        bundle.allMatrixRows.length,
        ws.modules.length,
        'Matrix must consolidate strictly to 1 row per script module'
      );
      assert.ok(bundle.activeMatrixRows.length >= 1, 'Expected active scripts with opening hours/SondZeit');
      assert.ok(bundle.alwaysOpenRows.length >= 1, 'Expected separated 24/7 scripts');
      assert.equal(
        bundle.activeMatrixRows.some((r) => r.category === 'always-open'),
        false,
        'activeMatrixRows must never mix in 24/7 scripts'
      );

      const sampleWs = buildScriptWorkspace(
        parseCallflowTextWithFallback(SAMPLE_MULTI_SCRIPT_TEXT, { isMasterHint: true })
      );
      const sampleBundle = buildWorkspaceOpeningHoursBundle(sampleWs, { diagramTitle: 'Sample-Callflow' });
      assert.ok(
        sampleBundle.holidayEntries.length >= 1,
        'Expected dedicated holiday entries from SAMPLE_MULTI_SCRIPT_TEXT'
      );

      // C. CSV with & without 24/7
      const csvAll = exportOpeningHoursCsv(ws, { includeAlwaysOpen: true });
      const csvNo247 = exportOpeningHoursCsv(ws, { includeAlwaysOpen: false });
      const allLineCount = csvAll.replace(/^\uFEFF/, '').split(/\r?\n/).length;
      const no247LineCount = csvNo247.replace(/^\uFEFF/, '').split(/\r?\n/).length;
      assert.equal(allLineCount, 1 + bundle.allMatrixRows.length, 'Full CSV must have header + 1 row per script');
      assert.equal(no247LineCount, 1 + bundle.activeMatrixRows.length, 'Filtered CSV must exclude 24/7 scripts');
      assert.equal(csvNo247.includes('24/7 (Ohne Zeitplan)'), false, 'Filtered CSV must not contain 24/7 rows');

      // D. Compact Markdown
      const md = exportOpeningHoursMarkdown(ws, { includeAlwaysOpen: true });
      assert.ok(md.includes('## 1. Skripte mit Öffnungszeiten, SondZeit & Feiertagen'));
      assert.ok(md.includes('## 2. 24/7-Skripte (Ohne Zeitbeschränkung)'));

      // E. Native compressed .xlsx workbook (4 sheets with 24/7, 3 sheets without 24/7)
      const xlsxFullBytes = await exportOpeningHoursXlsxBytes(ws, {
        includeAlwaysOpen: true,
        diagramTitle: 'Test-Callflow',
      });
      const zipFull = await JSZip.loadAsync(xlsxFullBytes);
      const wbXmlFull = await zipFull.file('xl/workbook.xml')?.async('string');
      assert.ok(wbXmlFull, 'xlsx archive must contain xl/workbook.xml');
      assert.ok(wbXmlFull!.includes('Öffnungszeiten (Mo-So)'), 'Sheet 1 missing');
      assert.ok(wbXmlFull!.includes('Feiertage &amp; SondZeit'), 'Sheet 2 missing');
      assert.ok(wbXmlFull!.includes('24-7 &amp; Ohne Zeitplan'), 'Sheet 3 missing');
      assert.ok(wbXmlFull!.includes('Regel-Details'), 'Sheet 4 missing');
      const sheet1Xml = await zipFull.file('xl/worksheets/sheet1.xml')?.async('string');
      assert.ok(sheet1Xml?.includes('state="frozen"'), 'Sheet 1 must have frozen header rows');
      assert.ok(sheet1Xml?.includes('<autoFilter '), 'Sheet 1 must have AutoFilter');

      const xlsxNo247Bytes = await exportOpeningHoursXlsxBytes(ws, { includeAlwaysOpen: false });
      const zipNo247 = await JSZip.loadAsync(xlsxNo247Bytes);
      const wbXmlNo247 = await zipNo247.file('xl/workbook.xml')?.async('string');
      assert.equal(
        wbXmlNo247?.includes('24-7 &amp; Ohne Zeitplan'),
        false,
        'When includeAlwaysOpen=false, Sheet 3 must be omitted'
      );

      // F. Zero-dependency STORE-mode ZIP builder (used inside standalone Callflow.html)
      const fileMap = buildOpeningHoursXlsxFileMap(bundle, { includeAlwaysOpen: true });
      const storeZipBytes = buildStoreZipUint8Array(fileMap);
      const parsedStoreZip = await JSZip.loadAsync(storeZipBytes);
      const storeWbXml = await parsedStoreZip.file('xl/workbook.xml')?.async('string');
      assert.equal(storeWbXml, fileMap['xl/workbook.xml'], 'STORE-mode ZIP must decode identically via JSZip');

      // G. Standalone Callflow.html embeds openingHoursBundle + offline .xlsx runtime
      const masterMermaid = buildMasterOverviewMermaid(ws, 'LR', { compact: false });
      const graph = parseCallflowGraph(masterMermaid);
      const svg = buildDeterministicFlowchartSvg(graph, 'dark');
      const html = generateInteractiveCallflowHtml('Test-Callflow', svg, graph, 'dark', {
        analysis: {
          openIssues: [],
          healthFindings: [],
          scheduleRows: buildWorkspaceScheduleOverview(ws),
          registry: extractWorkspaceResourceRegistry(ws),
          routingMatrixRows: buildWorkspaceRoutingMatrix(ws),
        },
      });
      assert.ok(html.includes('"openingHoursBundle"'), 'Callflow.html must embed openingHoursBundle');
      assert.ok(html.includes('id="btn-modal-xlsx"'), 'Callflow.html modal must include Excel (.xlsx) button');
      assert.ok(html.includes('id="btn-modal-hide-247"'), 'Callflow.html modal must include 24/7 hide toggle');
      assert.ok(
        html.includes('downloadOpeningHoursXlsxFromBundle'),
        'Callflow.html must include offline XLSX generator runtime'
      );
    }
  );

  const failed = results.filter((r) => !r.passed);
  const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);
  console.log(
    `\nRegression Suite Summary: ${results.length - failed.length}/${results.length} passed in ${totalTime.toFixed(1)} ms.\n`
  );

  if (failed.length > 0) {
    process.exit(1);
  }
}

void finalizeSuite();
