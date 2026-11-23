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

import {
  SAMPLE_MULTI_SCRIPT_TEXT,
  parseCallflowTextWithFallback,
  buildScriptWorkspace,
  rehydrateAndUpgradeWorkspace,
  extractScheduleFromSondZeitName,
  resolveScheduleWithSondZeit,
  buildWorkspaceScheduleOverview,
  exportOpeningHoursCsv,
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
} from '../src/utils/scriptCallflowParser';
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
  assert.ok(firstLine.includes('Wochentage'), 'CSV header must include Wochentage');
  assert.ok(firstLine.includes('Uhrzeiten'), 'CSV header must include Uhrzeiten');
  assert.ok(firstLine.includes('Öffnungszeiten (Gesamt)'), 'CSV header must include Öffnungszeiten (Gesamt)');
  assert.ok(firstLine.includes('SondZeit / Zeitplan-Ref'), 'CSV header must include SondZeit / Zeitplan-Ref');
  assert.match(csv, /\d{1,2}:\d{2}[–-]\d{1,2}:\d{2}/, 'CSV body must contain formatted clock-time ranges');
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
  assert.equal(AUDIT_APP_VERSION, '1.2.2', 'Expected release version 1.2.2');
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
