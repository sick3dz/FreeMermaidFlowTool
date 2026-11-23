import type {
  CallflowEdge,
  CallflowGraph,
  CallflowNode,
  DiagramDirection,
} from '../types/mermaidStudio';
import { buildDeterministicFlowchartSvg } from './callflowEngine';
import { computeFastCacheHash } from './mermaidEngine';

export interface ElkPoint {
  x: number;
  y: number;
}

export interface ElkEdgeSection {
  id: string;
  startPoint: ElkPoint;
  endPoint: ElkPoint;
  bendPoints?: ElkPoint[];
}

export interface ElkLabel {
  id?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  labels?: ElkLabel[];
  layoutOptions?: Record<string, string>;
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  container?: string;
  labels?: ElkLabel[];
  sections?: ElkEdgeSection[];
  layoutOptions?: Record<string, string>;
}

export interface RenderElkFlowchartOptions {
  mermaidCode: string;
  graph: CallflowGraph;
  surface: 'dark' | 'light';
  direction?: DiagramDirection;
  title?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RenderElkFlowchartResult {
  svg: string;
  engine: 'elk-worker' | 'elk-bundled' | 'deterministic-fallback';
  direction: DiagramDirection;
  fromCache: boolean;
  durationMs: number;
  timedOut?: boolean;
  aborted?: boolean;
}

const MAX_ELK_SVG_CACHE = 64;
const elkSvgCache = new Map<
  string,
  { svg: string; engine: 'elk-worker' | 'elk-bundled'; direction: DiagramDirection }
>();

function getCachedElkSvg(
  key: string
): { svg: string; engine: 'elk-worker' | 'elk-bundled'; direction: DiagramDirection } | undefined {
  const hit = elkSvgCache.get(key);
  if (!hit) return undefined;
  elkSvgCache.delete(key);
  elkSvgCache.set(key, hit);
  return hit;
}

function setCachedElkSvg(
  key: string,
  val: { svg: string; engine: 'elk-worker' | 'elk-bundled'; direction: DiagramDirection }
): void {
  if (elkSvgCache.has(key)) elkSvgCache.delete(key);
  elkSvgCache.set(key, val);
  if (elkSvgCache.size > MAX_ELK_SVG_CACHE) {
    const oldest = elkSvgCache.keys().next().value;
    if (oldest !== undefined) elkSvgCache.delete(oldest);
  }
}

export function clearElkLayoutCache(): void {
  elkSvgCache.clear();
}

export function extractFlowchartDirection(
  mermaidCode: string,
  fallback: DiagramDirection = 'LR'
): DiagramDirection {
  const trimmed = (mermaidCode || '').trim();
  const match = trimmed.match(/^(?:flowchart|graph)\s+(TB|TD|LR|RL|BT)\b/im);
  if (match && match[1]) {
    const raw = match[1].toUpperCase();
    if (raw === 'TD' || raw === 'TB') return 'TB';
    if (raw === 'LR') return 'LR';
    if (raw === 'RL') return 'RL';
    if (raw === 'BT') return 'BT';
  }
  return fallback;
}

function mapDirectionToElk(dir: DiagramDirection): 'RIGHT' | 'DOWN' | 'LEFT' | 'UP' {
  switch (dir) {
    case 'TB':
    case 'TD':
      return 'DOWN';
    case 'RL':
      return 'LEFT';
    case 'BT':
      return 'UP';
    case 'LR':
    default:
      return 'RIGHT';
  }
}

// ---------- Isolated Browser Blob Web Worker Manager ----------

let cachedWorkerBlobUrl: string | null = null;
let workerSourcePromise: Promise<string> | null = null;
let activeWorker: Worker | null = null;
let activeWorkerReady: Promise<void> | null = null;
let workerMsgSeq = 1;
let workerJobChain: Promise<void> = Promise.resolve();

interface PendingWorkerResolver {
  resolve: (data: unknown) => void;
  reject: (err: unknown) => void;
}
const pendingWorkerResolvers = new Map<number, PendingWorkerResolver>();

async function loadElkWorkerBlobUrl(): Promise<string> {
  if (cachedWorkerBlobUrl) return cachedWorkerBlobUrl;
  if (!workerSourcePromise) {
    workerSourcePromise = import('elkjs/lib/elk-worker.min.js?raw').then(
      (mod) => mod.default
    );
  }
  const source = await workerSourcePromise;
  const blob = new Blob([source], { type: 'application/javascript' });
  cachedWorkerBlobUrl = URL.createObjectURL(blob);
  return cachedWorkerBlobUrl;
}

export function terminateActiveElkWorker(reason = 'Worker terminated'): void {
  if (activeWorker) {
    try {
      activeWorker.terminate();
    } catch {
      // ignore termination errors
    }
    activeWorker = null;
    activeWorkerReady = null;
  }
  if (pendingWorkerResolvers.size > 0) {
    const err = new Error(reason);
    for (const [, pending] of pendingWorkerResolvers) {
      pending.reject(err);
    }
    pendingWorkerResolvers.clear();
  }
}

async function ensureElkWorker(): Promise<Worker> {
  if (activeWorker && activeWorkerReady) {
    await activeWorkerReady;
    if (activeWorker) return activeWorker;
  }
  const blobUrl = await loadElkWorkerBlobUrl();
  const worker = new Worker(blobUrl);
  activeWorker = worker;

  worker.onmessage = (event: MessageEvent) => {
    const payload = event.data as { id?: number; data?: unknown; error?: unknown } | null;
    if (!payload || typeof payload.id !== 'number') return;
    const pending = pendingWorkerResolvers.get(payload.id);
    if (!pending) return;
    pendingWorkerResolvers.delete(payload.id);
    if (payload.error) {
      pending.reject(payload.error);
    } else {
      pending.resolve(payload.data);
    }
  };

  worker.onerror = (errEvent: ErrorEvent) => {
    terminateActiveElkWorker(errEvent.message || 'ELK worker runtime error');
  };

  activeWorkerReady = new Promise<void>((resolve, reject) => {
    const regId = workerMsgSeq++;
    const regTimer = globalThis.setTimeout(() => {
      pendingWorkerResolvers.delete(regId);
      terminateActiveElkWorker('ELK worker initialization timeout');
      reject(new Error('ELK worker initialization timeout'));
    }, 8000);

    pendingWorkerResolvers.set(regId, {
      resolve: () => {
        globalThis.clearTimeout(regTimer);
        resolve();
      },
      reject: (err) => {
        globalThis.clearTimeout(regTimer);
        reject(err);
      },
    });

    worker.postMessage({
      id: regId,
      cmd: 'register',
      algorithms: ['layered'],
    });
  });

  await activeWorkerReady;
  return worker;
}

function runElkInBrowserWorker(
  elkGraph: ElkNode,
  layoutOptions: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ElkNode> {
  if (signal?.aborted) {
    return Promise.reject(new Error('ELK_ABORTED'));
  }

  const executeJob = async (): Promise<ElkNode> => {
    if (signal?.aborted) {
      throw new Error('ELK_ABORTED');
    }
    const worker = await ensureElkWorker();
    if (signal?.aborted) {
      throw new Error('ELK_ABORTED');
    }

    return new Promise<ElkNode>((resolve, reject) => {
      const jobId = workerMsgSeq++;
      let settled = false;

      const cleanup = () => {
        globalThis.clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        pendingWorkerResolvers.delete(jobId);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        terminateActiveElkWorker('ELK_ABORTED');
        reject(new Error('ELK_ABORTED'));
      };

      const timer = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        terminateActiveElkWorker('ELK_TIMEOUT');
        reject(new Error('ELK_TIMEOUT'));
      }, timeoutMs);

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      pendingWorkerResolvers.set(jobId, {
        resolve: (data) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(data as ElkNode);
        },
        reject: (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        },
      });

      worker.postMessage({
        id: jobId,
        cmd: 'layout',
        graph: elkGraph,
        layoutOptions,
        options: {
          logging: false,
          measureExecutionTime: false,
        },
      });
    });
  };

  const jobPromise = workerJobChain.then(executeJob, executeJob);
  workerJobChain = jobPromise.then(
    () => undefined,
    () => undefined
  );
  return jobPromise;
}

// ---------- Node.js / Non-Worker Runtime Fallback (used by smoke tests) ----------

interface BundledElkInstance {
  layout(
    graph: ElkNode,
    options?: { layoutOptions?: Record<string, string> }
  ): Promise<ElkNode>;
}

let nodeElkInstancePromise: Promise<BundledElkInstance> | null = null;

async function runElkInNodeBundled(
  elkGraph: ElkNode,
  layoutOptions: Record<string, string>
): Promise<ElkNode> {
  if (!nodeElkInstancePromise) {
    // Computed specifier prevents Vite/Rollup from bundling elk.bundled.js into the browser/offline IIFE build
    const bundledSpec = 'elkjs/lib/' + 'elk.bundled.js';
    nodeElkInstancePromise = import(/* @vite-ignore */ bundledSpec).then((mod) => {
      const ElkCtor = (mod.default || mod) as new (opts?: {
        algorithms?: string[];
      }) => BundledElkInstance;
      return new ElkCtor({ algorithms: ['layered'] });
    });
  }
  const elk = await nodeElkInstancePromise;
  return elk.layout(elkGraph, { layoutOptions });
}

// ---------- Subgraph & Abschnitt Hierarchy Extraction ----------

interface ExtractedClusterSpec {
  id: string;
  title: string;
  kind: 'subgraph' | 'section';
  parentId: string | null;
  nodeIds: string[];
}

function extractSectionNameFromLabel(label: string): string | null {
  const plain = String(label || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r/g, '');
  const m = plain.match(/Abschnitt:\s*([^\n]+)/i);
  if (!m || !m[1]) return null;
  let sec = m[1]
    .split(/(?:Bedingung:|Treatment:|Ansage:|Wartezeit:|Queue:|Skillset:|⏱|📢|📅|🔄|🗄️)/i)[0]
    .trim();
  sec = sec.replace(/[,;|•·]+$/, '').trim();
  if (!sec || sec.length < 2) return null;
  return sec.length > 36 ? sec.slice(0, 35) : sec;
}

function extractClustersForElk(
  mermaidCode: string,
  graph: CallflowGraph
): {
  clustersById: Map<string, ExtractedClusterSpec>;
  nodeClusterById: Map<string, string>;
} {
  const clustersById = new Map<string, ExtractedClusterSpec>();
  const nodeClusterById = new Map<string, string>();
  const stack: string[] = [];

  const lines = (mermaidCode || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('%%')) continue;

    const sgBracket = line.match(/^subgraph\s+([A-Za-z0-9_.-]+)\s*\["?([^"\]]+)"?\]/i);
    const sgPlain = !sgBracket ? line.match(/^subgraph\s+([A-Za-z0-9_.-]+)(?:\s+(.*))?$/i) : null;
    if (sgBracket || sgPlain) {
      const rawId = (sgBracket ? sgBracket[1] : sgPlain![1]).trim();
      const rawTitle = (
        sgBracket ? sgBracket[2] : (sgPlain![2] || rawId)
      )
        .replace(/^["']|["']$/g, '')
        .trim();
      const clusterId = `cluster_${rawId}`;
      const parentId = stack.length > 0 ? stack[stack.length - 1] : null;
      if (!clustersById.has(clusterId)) {
        clustersById.set(clusterId, {
          id: clusterId,
          title: rawTitle || rawId,
          kind: 'subgraph',
          parentId,
          nodeIds: [],
        });
      }
      stack.push(clusterId);
      continue;
    }

    if (/^end\b/i.test(line)) {
      if (stack.length > 0) stack.pop();
      continue;
    }

    if (
      stack.length === 0 ||
      /^(flowchart|graph|direction|classDef|class|style|linkStyle|click)\b/i.test(line)
    ) {
      continue;
    }

    // Only assign node declarations (not just edge mentions) to the active subgraph first
    const declMatch = line.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*(?:\[|\(|\{)/);
    if (declMatch && graph.nodes.has(declMatch[1])) {
      const nid = declMatch[1];
      if (!nodeClusterById.has(nid)) {
        const cid = stack[stack.length - 1];
        nodeClusterById.set(nid, cid);
        clustersById.get(cid)!.nodeIds.push(nid);
      }
    }
  }

  // Sub-group nodes inside ScriptBody (or root) by named "Abschnitt: <Name>" when >= 2 sections exist
  const sectionCandidates = new Map<string, { parentId: string | null; sectionName: string; nodeIds: string[] }>();
  for (const node of graph.nodes.values()) {
    const parentCid = nodeClusterById.get(node.id) || null;
    // Do not sub-group caller/target border subgraphs
    if (parentCid && /Aufrufer|Ziele/i.test(parentCid)) continue;
    const secName = extractSectionNameFromLabel(node.label || '');
    if (!secName) continue;
    const key = `${parentCid || 'root'}::${secName.toLowerCase()}`;
    if (!sectionCandidates.has(key)) {
      sectionCandidates.set(key, { parentId: parentCid, sectionName: secName, nodeIds: [] });
    }
    sectionCandidates.get(key)!.nodeIds.push(node.id);
  }

  const qualifyingSections = Array.from(sectionCandidates.values()).filter(
    (s) => s.nodeIds.length >= 2
  );
  if (qualifyingSections.length >= 2) {
    let secSeq = 1;
    const flattenedParentIds = new Set<string>();
    for (const sec of qualifyingSections) {
      const safeKey = sec.sectionName.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 28) || `S${secSeq}`;
      const secCid = `cluster_sec_${secSeq++}_${safeKey}`;
      // Flatten into 1-level peer clusters directly under root (prevents 2-level ELK compound blowup)
      if (sec.parentId) flattenedParentIds.add(sec.parentId);
      clustersById.set(secCid, {
        id: secCid,
        title: `Abschnitt: ${sec.sectionName}`,
        kind: 'section',
        parentId: null,
        nodeIds: [...sec.nodeIds],
      });
      for (const nid of sec.nodeIds) {
        if (sec.parentId && clustersById.has(sec.parentId)) {
          const parentList = clustersById.get(sec.parentId)!.nodeIds;
          const idx = parentList.indexOf(nid);
          if (idx >= 0) parentList.splice(idx, 1);
        }
        nodeClusterById.set(nid, secCid);
      }
    }
    // Any remaining direct nodes in a flattened parent stay in that parent as a peer cluster (still 1-level)
    for (const pid of flattenedParentIds) {
      const parentSpec = clustersById.get(pid);
      if (parentSpec) parentSpec.parentId = null;
    }
  }

  // Ensure strictly 1-level peer clusters (flatten any nested Mermaid subgraphs cleanly)
  for (const spec of clustersById.values()) {
    spec.parentId = null;
  }

  // Prune empty clusters that have no direct nodes
  for (const [cid, spec] of Array.from(clustersById.entries())) {
    if (spec.nodeIds.length === 0) {
      clustersById.delete(cid);
    }
  }

  return { clustersById, nodeClusterById };
}

// ---------- Forward vs. Cycle Edge Partitioning ----------

function isExplicitCycleLabel(label: string): boolean {
  const txt = (label || '').trim();
  if (!txt) return false;
  return txt.includes('↻') || /\b(zyklus|cycle|schleife|loop|rücksprung)\b/i.test(txt);
}

/**
 * Separates primary forward flow edges from cycle/back-edges using explicit cycle labels
 * plus 3-color DFS back-edge detection. Routing cycle edges around the outer perimeter
 * eliminates dense inter-row ribbon clutter and gives ELK a clean acyclic backbone.
 */
function partitionForwardAndCycleEdges(graph: CallflowGraph): {
  forwardEdges: Array<{ edge: CallflowEdge; index: number }>;
  cycleEdges: Array<{ edge: CallflowEdge; index: number }>;
} {
  const validEdges: Array<{ edge: CallflowEdge; index: number }> = [];
  const explicitCycleIndices = new Set<number>();

  graph.edges.forEach((edge, index) => {
    if (!graph.nodes.has(edge.from) || !graph.nodes.has(edge.to)) return;
    validEdges.push({ edge, index });
    if (edge.from === edge.to || isExplicitCycleLabel(edge.label)) {
      explicitCycleIndices.add(index);
    }
  });

  // Build adjacency of remaining edges and run 3-color DFS to detect topological back-edges
  const adj = new Map<string, Array<{ to: string; index: number }>>();
  for (const nid of graph.nodes.keys()) adj.set(nid, []);
  for (const item of validEdges) {
    if (explicitCycleIndices.has(item.index)) continue;
    adj.get(item.edge.from)!.push({ to: item.edge.to, index: item.index });
  }

  const color = new Map<string, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=done
  const backEdgeIndices = new Set<number>(explicitCycleIndices);

  const dfsOrder: string[] = [
    ...graph.entryNodes.map((n) => n.id),
    ...Array.from(graph.nodes.keys()),
  ];

  const visitedStart = new Set<string>();
  for (const startId of dfsOrder) {
    if (visitedStart.has(startId) || (color.get(startId) || 0) !== 0) continue;
    visitedStart.add(startId);

    // Iterative DFS to stay stack-safe even on 2000-node scripts
    const stack: Array<{ id: string; nextIdx: number }> = [{ id: startId, nextIdx: 0 }];
    color.set(startId, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = adj.get(frame.id) || [];
      if (frame.nextIdx >= neighbors.length) {
        color.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const next = neighbors[frame.nextIdx++];
      const st = color.get(next.to) || 0;
      if (st === 1) {
        backEdgeIndices.add(next.index);
      } else if (st === 0) {
        color.set(next.to, 1);
        stack.push({ id: next.to, nextIdx: 0 });
      }
    }
  }

  const forwardEdges: Array<{ edge: CallflowEdge; index: number }> = [];
  const cycleEdges: Array<{ edge: CallflowEdge; index: number }> = [];
  for (const item of validEdges) {
    if (backEdgeIndices.has(item.index)) {
      cycleEdges.push(item);
    } else {
      forwardEdges.push(item);
    }
  }
  return { forwardEdges, cycleEdges };
}

// ---------- SVG Rendering & Geometry Helpers ----------

function escXml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapNodeLabelLines(raw: string, maxCharsPerLine = 36, maxLines = 4): string[] {
  const normalized = String(raw || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r/g, '')
    .trim();
  const out: string[] = [];
  for (const seg of normalized.split('\n')) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (candidate.length > maxCharsPerLine && line) {
        out.push(line);
        line = w.length > maxCharsPerLine ? `${w.slice(0, maxCharsPerLine - 1)}…` : w;
      } else {
        line =
          candidate.length > maxCharsPerLine
            ? `${candidate.slice(0, maxCharsPerLine - 1)}…`
            : candidate;
      }
      if (out.length >= maxLines) break;
    }
    if (line && out.length < maxLines) out.push(line);
    if (out.length >= maxLines) break;
  }
  return out.length > 0 ? out.slice(0, maxLines) : ['Knoten'];
}

function measureNodeBox(lines: string[]): { width: number; height: number } {
  const longest = lines.reduce((max, ln) => Math.max(max, ln.length), 8);
  const width = Math.round(Math.max(182, Math.min(324, longest * 7.6 + 44)));
  const height = Math.round(Math.max(66, lines.length * 19.5 + 30));
  return { width, height };
}

function getBuilderNodeColors(
  node: CallflowNode,
  isDark: boolean
): { fill: string; stroke: string } {
  const lbl = (node.label || '').toLowerCase();
  const idLower = node.id.toLowerCase();
  if (node.role === 'entry' || /einstieg|start|main/.test(idLower)) {
    return isDark
      ? { fill: '#064e3b', stroke: '#10b981' }
      : { fill: '#ecfdf5', stroke: '#059669' };
  }
  if (/flixcheck|📲|🔌|send\s+request|get\s+response|hdx-connector/.test(lbl)) {
    return isDark
      ? { fill: '#083344', stroke: '#06b6d4' }
      : { fill: '#ecfeff', stroke: '#0891b2' };
  }
  if (
    /zeit|feiertag|sondzeit|bedingung|dtmf|wahl|menu|choice/.test(lbl) ||
    idLower.startsWith('choice_')
  ) {
    return isDark
      ? { fill: '#451a03', stroke: '#f59e0b' }
      : { fill: '#fffbeb', stroke: '#d97706' };
  }
  if (/queue|skillset|warteschlange|agent/.test(lbl) || idLower.startsWith('queue_')) {
    return isDark
      ? { fill: '#172554', stroke: '#3b82f6' }
      : { fill: '#eff6ff', stroke: '#2563eb' };
  }
  if (node.role === 'terminal' || /disconnect|trennen|abwurf|ende|ansage/.test(lbl)) {
    return isDark
      ? { fill: '#3b0764', stroke: '#a855f7' }
      : { fill: '#faf5ff', stroke: '#7e22ce' };
  }
  return isDark
    ? { fill: '#1e293b', stroke: '#475569' }
    : { fill: '#ffffff', stroke: '#94a3b8' };
}

/**
 * Builds a silky smooth curved path from ELK's obstacle-avoiding waypoints using
 * midpoint quadratic Bézier interpolation (C1 smooth, zero jagged orthogonal staircases).
 */
function buildSmoothCurvePath(points: ElkPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  const pts: ElkPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = pts[pts.length - 1];
    const cur = points[i];
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 0.75) {
      pts.push(cur);
    }
  }

  if (pts.length === 2) {
    const [a, b] = pts;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const c = Math.max(24, Math.min(96, Math.abs(dx) * 0.42));
      const sx = dx >= 0 ? c : -c;
      return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${(a.x + sx).toFixed(1)} ${a.y.toFixed(1)}, ${(b.x - sx).toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    const c = Math.max(24, Math.min(96, Math.abs(dy) * 0.42));
    const sy = dy >= 0 ? c : -c;
    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${a.x.toFixed(1)} ${(a.y + sy).toFixed(1)}, ${b.x.toFixed(1)} ${(b.y - sy).toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }

  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const cur = pts[i];
    const next = pts[i + 1];
    const midX = (cur.x + next.x) / 2;
    const midY = (cur.y + next.y) / 2;
    if (i === 1) {
      const firstMidX = (pts[0].x + cur.x) / 2;
      const firstMidY = (pts[0].y + cur.y) / 2;
      d += ` L ${firstMidX.toFixed(1)} ${firstMidY.toFixed(1)}`;
    }
    d += ` Q ${cur.x.toFixed(1)} ${cur.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

interface LaidOutClusterRect {
  id: string;
  title: string;
  kind: 'subgraph' | 'section';
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LaidOutForwardEdge {
  elkEdge: ElkEdge;
  containerOffsetX: number;
  containerOffsetY: number;
}

interface EdgeRenderMeta {
  from: string;
  to: string;
  domId: string;
  label: string;
  shortLabel: string;
  isDotted: boolean;
  isThick: boolean;
}

function buildSvgFromElkLayout(
  laidOut: ElkNode,
  graph: CallflowGraph,
  clustersById: Map<string, ExtractedClusterSpec>,
  linesByNodeId: Map<string, string[]>,
  forwardEdgeMetaById: Map<string, EdgeRenderMeta>,
  cycleEdgesWithMeta: Array<{ edge: CallflowEdge; meta: EdgeRenderMeta }>,
  surface: 'dark' | 'light',
  direction: DiagramDirection,
  engineTag: 'elk-worker' | 'elk-bundled'
): string {
  const isDark = surface === 'dark';
  const bg = isDark ? '#0f172a' : '#f8fafc';
  const textMain = isDark ? '#f1f5f9' : '#0f172a';
  const textMuted = isDark ? '#94a3b8' : '#475569';
  const edgeStroke = isDark ? '#64748b' : '#64748b';
  const cycleStroke = isDark ? '#fb7185' : '#e11d48';
  const edgeLabelBg = isDark ? '#1e293b' : '#ffffff';
  const edgeLabelBorder = isDark ? '#334155' : '#cbd5e1';

  const isHorizontal = direction === 'LR' || direction === 'RL';

  // Recursively collect absolute coordinates for all clusters, leaf nodes, and forward edges
  const posById = new Map<string, { x: number; y: number; w: number; h: number }>();
  const containerAbsById = new Map<string, { x: number; y: number }>();
  const clusterRects: LaidOutClusterRect[] = [];
  const rawCollectedEdges: Array<{ elkEdge: ElkEdge; fallbackOffsetX: number; fallbackOffsetY: number }> = [];

  const collectRecursive = (
    container: ElkNode,
    parentAbsX: number,
    parentAbsY: number,
    depth: number
  ) => {
    const absX = parentAbsX + (container.x || 0);
    const absY = parentAbsY + (container.y || 0);
    containerAbsById.set(container.id, { x: absX, y: absY });

    if (container.id !== 'root') {
      const clusterSpec = clustersById.get(container.id);
      if (clusterSpec) {
        clusterRects.push({
          id: clusterSpec.id,
          title: clusterSpec.title,
          kind: clusterSpec.kind,
          depth,
          x: absX,
          y: absY,
          w: container.width || 240,
          h: container.height || 140,
        });
      } else if (graph.nodes.has(container.id)) {
        posById.set(container.id, {
          x: absX,
          y: absY,
          w: container.width || 200,
          h: container.height || 66,
        });
      }
    }

    if (container.edges && container.edges.length > 0) {
      for (const e of container.edges) {
        rawCollectedEdges.push({
          elkEdge: e,
          fallbackOffsetX: absX,
          fallbackOffsetY: absY,
        });
      }
    }

    for (const child of container.children || []) {
      collectRecursive(child, absX, absY, depth + 1);
    }
  };

  collectRecursive(laidOut, 0, 0, 0);

  const laidOutForwardEdges: LaidOutForwardEdge[] = rawCollectedEdges.map(
    ({ elkEdge, fallbackOffsetX, fallbackOffsetY }) => {
      const containerPos =
        elkEdge.container && containerAbsById.has(elkEdge.container)
          ? containerAbsById.get(elkEdge.container)!
          : { x: fallbackOffsetX, y: fallbackOffsetY };
      return {
        elkEdge,
        containerOffsetX: containerPos.x,
        containerOffsetY: containerPos.y,
      };
    }
  );

  // Measure content bounding box to allocate clean outer perimeter channels for cycle arcs
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const expandBounds = (x: number, y: number, w: number, h: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  };
  for (const r of posById.values()) expandBounds(r.x, r.y, r.w, r.h);
  for (const c of clusterRects) expandBounds(c.x, c.y, c.w, c.h);
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = laidOut.width || 720;
    maxY = laidOut.height || 420;
  }

  const cycleCount = cycleEdgesWithMeta.length;
  const maxLanesPerSide = Math.min(14, Math.ceil(cycleCount / 2));
  const perimeterBand = cycleCount > 0 ? 52 + maxLanesPerSide * 13 : 0;

  const shiftX = Math.round(48 + (!isHorizontal ? perimeterBand : 0) - minX);
  const shiftY = Math.round(48 + (isHorizontal ? perimeterBand : 0) - minY);

  const contentLeft = minX + shiftX;
  const contentRight = maxX + shiftX;
  const contentTop = minY + shiftY;
  const contentBottom = maxY + shiftY;
  const contentMidX = (contentLeft + contentRight) / 2;
  const contentMidY = (contentTop + contentBottom) / 2;

  const totalW = Math.max(
    720,
    Math.ceil(contentRight + 48 + (!isHorizontal ? perimeterBand : 0))
  );
  const totalH = Math.max(
    360,
    Math.ceil(contentBottom + 48 + (isHorizontal ? perimeterBand : 0))
  );

  // 1. Render Cluster / Abschnitt Boxes (outer subgraphs first, nested sections on top)
  clusterRects.sort((a, b) => a.depth - b.depth);
  const clusterParts: string[] = [];
  for (const cl of clusterRects) {
    const cx = cl.x + shiftX;
    const cy = cl.y + shiftY;
    const isSection = cl.kind === 'section';
    const clFill = isSection
      ? isDark
        ? 'rgba(30, 41, 59, 0.42)'
        : 'rgba(241, 245, 249, 0.72)'
      : isDark
        ? 'rgba(15, 23, 42, 0.55)'
        : 'rgba(226, 232, 240, 0.40)';
    const clStroke = isSection
      ? isDark
        ? 'rgba(99, 102, 241, 0.42)'
        : 'rgba(99, 102, 241, 0.38)'
      : isDark
        ? 'rgba(71, 85, 105, 0.55)'
        : 'rgba(148, 163, 184, 0.55)';
    const titleFill = isSection
      ? isDark
        ? '#c7d2fe'
        : '#3730a3'
      : isDark
        ? '#cbd5e1'
        : '#334155';
    const badgeFill = isSection
      ? isDark
        ? 'rgba(49, 46, 129, 0.65)'
        : 'rgba(224, 231, 255, 0.9)'
      : isDark
        ? 'rgba(30, 41, 59, 0.85)'
        : 'rgba(255, 255, 255, 0.9)';
    const safeTitle = cl.title.length > 52 ? `${cl.title.slice(0, 51)}…` : cl.title;
    const badgeW = Math.min(cl.w - 24, Math.max(96, safeTitle.length * 6.8 + 20));
    const dashAttr = isSection ? '' : ' stroke-dasharray="6,4"';

    clusterParts.push(
      `<g class="cluster" id="${escXml(cl.id)}" data-cluster-kind="${cl.kind}">` +
        `<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" width="${cl.w.toFixed(1)}" height="${cl.h.toFixed(1)}" rx="14" fill="${clFill}" stroke="${clStroke}" stroke-width="1.4"${dashAttr}/>` +
        `<rect x="${(cx + 12).toFixed(1)}" y="${(cy + 10).toFixed(1)}" width="${badgeW.toFixed(1)}" height="22" rx="6" fill="${badgeFill}" stroke="${clStroke}" stroke-width="0.9"/>` +
        `<text x="${(cx + 22).toFixed(1)}" y="${(cy + 24.5).toFixed(1)}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11.5" font-weight="600" fill="${titleFill}">${escXml(safeTitle)}</text>` +
        `</g>`
    );
  }

  // 2. Render Forward / Primary Flow Edges (smooth curves, 100% visibility)
  const edgePathParts: string[] = [];
  const edgeLabelParts: string[] = [];

  for (const item of laidOutForwardEdges) {
    const { elkEdge, containerOffsetX, containerOffsetY } = item;
    const meta = forwardEdgeMetaById.get(elkEdge.id);
    if (!meta) continue;

    const ox = containerOffsetX + shiftX;
    const oy = containerOffsetY + shiftY;
    const escFrom = escXml(meta.from);
    const escTo = escXml(meta.to);
    const strokeDash = meta.isDotted ? ' stroke-dasharray="6,4"' : '';
    const strokeWidth = meta.isThick ? '2.4' : '1.6';

    let d = '';
    let fallbackMidX = 0;
    let fallbackMidY = 0;

    if (elkEdge.sections && elkEdge.sections.length > 0) {
      const sec = elkEdge.sections[0];
      const pts: ElkPoint[] = [
        { x: sec.startPoint.x + ox, y: sec.startPoint.y + oy },
        ...(sec.bendPoints || []).map((bp) => ({ x: bp.x + ox, y: bp.y + oy })),
        { x: sec.endPoint.x + ox, y: sec.endPoint.y + oy },
      ];
      d = buildSmoothCurvePath(pts);
      const midIdx = Math.floor(pts.length / 2);
      const midPt = pts[midIdx] || pts[0];
      const prevPt = pts[Math.max(0, midIdx - 1)] || midPt;
      fallbackMidX = (midPt.x + prevPt.x) / 2;
      fallbackMidY = (midPt.y + prevPt.y) / 2;
    } else {
      const pFrom = posById.get(meta.from);
      const pTo = posById.get(meta.to);
      if (!pFrom || !pTo) continue;
      const sx = pFrom.x + shiftX + (isHorizontal ? pFrom.w : pFrom.w / 2);
      const sy = pFrom.y + shiftY + (isHorizontal ? pFrom.h / 2 : pFrom.h);
      const tx = pTo.x + shiftX + (isHorizontal ? 0 : pTo.w / 2);
      const ty = pTo.y + shiftY + (isHorizontal ? pTo.h / 2 : 0);
      d = buildSmoothCurvePath([
        { x: sx, y: sy },
        { x: tx, y: ty },
      ]);
      fallbackMidX = (sx + tx) / 2;
      fallbackMidY = (sy + ty) / 2;
    }

    edgePathParts.push(
      `<path id="${escXml(meta.domId)}" data-id="${escXml(meta.domId)}" data-edge-from="${escFrom}" data-edge-to="${escTo}" class="flowchart-link edge-thickness-normal edge-pattern-solid" d="${d}" fill="none" stroke="${edgeStroke}" stroke-width="${strokeWidth}"${strokeDash} marker-end="url(#elk-arrow)"/>`
    );

    if (meta.shortLabel) {
      const elkLbl = elkEdge.labels && elkEdge.labels[0];
      const hasElkCoords =
        elkLbl &&
        typeof elkLbl.x === 'number' &&
        typeof elkLbl.y === 'number' &&
        typeof elkLbl.width === 'number' &&
        typeof elkLbl.height === 'number';
      const pillW = hasElkCoords
        ? Math.max(40, elkLbl!.width!)
        : Math.max(40, Math.min(196, meta.shortLabel.length * 6.5 + 16));
      const pillH = hasElkCoords ? Math.max(20, elkLbl!.height!) : 20;
      const cx = hasElkCoords ? elkLbl!.x! + ox + pillW / 2 : fallbackMidX;
      const cy = hasElkCoords ? elkLbl!.y! + oy + pillH / 2 : fallbackMidY - 4;
      edgeLabelParts.push(
        `<g class="edgeLabel" data-id="${escXml(meta.domId)}" data-edge-from="${escFrom}" data-edge-to="${escTo}" transform="translate(${cx.toFixed(1)}, ${cy.toFixed(1)})"><rect x="${(-pillW / 2).toFixed(1)}" y="${(-pillH / 2).toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="5" fill="${edgeLabelBg}" stroke="${edgeLabelBorder}" stroke-width="0.95"/><text x="0" y="3.8" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10.5" fill="${textMuted}">${escXml(meta.shortLabel)}</text></g>`
      );
    }
  }

  // 3. Render Separated Cycle / Back-Edges along Outer Perimeter Arcs (subtle at rest, 100% on click!)
  const restCycleEdgeOpacity = '0.22';
  const restCycleLabelOpacity = cycleCount > 10 ? '0' : '0.24';
  let topOrRightLane = 0;
  let bottomOrLeftLane = 0;

  for (const { edge, meta } of cycleEdgesWithMeta) {
    const pFrom = posById.get(meta.from);
    const pTo = posById.get(meta.to);
    if (!pFrom || !pTo) continue;

    const fx = pFrom.x + shiftX;
    const fy = pFrom.y + shiftY;
    const txBox = pTo.x + shiftX;
    const tyBox = pTo.y + shiftY;
    const escFrom = escXml(meta.from);
    const escTo = escXml(meta.to);

    let d: string;
    let labelX: number;
    let labelY: number;

    if (edge.from === edge.to) {
      const lx = fx + pFrom.w / 2;
      const ly = fy;
      d = `M ${(lx - 20).toFixed(1)} ${ly.toFixed(1)} C ${(lx - 34).toFixed(1)} ${(ly - 44).toFixed(1)}, ${(lx + 34).toFixed(1)} ${(ly - 44).toFixed(1)}, ${(lx + 20).toFixed(1)} ${ly.toFixed(1)}`;
      labelX = lx;
      labelY = ly - 36;
    } else if (isHorizontal) {
      const avgY = (fy + pFrom.h / 2 + tyBox + pTo.h / 2) / 2;
      const routeTop = avgY <= contentMidY;
      const laneIdx = routeTop ? topOrRightLane++ : bottomOrLeftLane++;
      const laneDist = 36 + (laneIdx % 14) * 13;
      const sx = fx + pFrom.w * 0.55;
      const ex = txBox + pTo.w * 0.45;
      const sy = routeTop ? fy : fy + pFrom.h;
      const ey = routeTop ? tyBox : tyBox + pTo.h;
      const busY = routeTop ? contentTop - laneDist : contentBottom + laneDist;
      const ctrlY = routeTop ? busY - 12 : busY + 12;

      d = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${sx.toFixed(1)} ${ctrlY.toFixed(1)}, ${ex.toFixed(1)} ${ctrlY.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      labelX = (sx + ex) / 2;
      labelY = routeTop ? busY - 2 : busY + 4;
    } else {
      const avgX = (fx + pFrom.w / 2 + txBox + pTo.w / 2) / 2;
      const routeRight = avgX >= contentMidX;
      const laneIdx = routeRight ? topOrRightLane++ : bottomOrLeftLane++;
      const laneDist = 36 + (laneIdx % 14) * 13;
      const sx = routeRight ? fx + pFrom.w : fx;
      const ex = routeRight ? txBox + pTo.w : txBox;
      const sy = fy + pFrom.h * 0.55;
      const ey = tyBox + pTo.h * 0.45;
      const busX = routeRight ? contentRight + laneDist : contentLeft - laneDist;
      const ctrlX = routeRight ? busX + 12 : busX - 12;

      d = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${ctrlX.toFixed(1)} ${sy.toFixed(1)}, ${ctrlX.toFixed(1)} ${ey.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      labelX = busX;
      labelY = (sy + ey) / 2;
    }

    edgePathParts.push(
      `<path id="${escXml(meta.domId)}" data-id="${escXml(meta.domId)}" data-edge-from="${escFrom}" data-edge-to="${escTo}" data-cycle-edge="true" data-resting-opacity="${restCycleEdgeOpacity}" class="flowchart-link edge-thickness-normal edge-pattern-dotted" d="${d}" fill="none" stroke="${cycleStroke}" stroke-width="1.45" stroke-dasharray="6,4" style="opacity:${restCycleEdgeOpacity};pointer-events:stroke;" marker-end="url(#elk-cycle-arrow)"/>`
    );

    if (meta.shortLabel) {
      const pillW = Math.max(44, Math.min(196, meta.shortLabel.length * 6.5 + 16));
      edgeLabelParts.push(
        `<g class="edgeLabel" data-id="${escXml(meta.domId)}" data-edge-from="${escFrom}" data-edge-to="${escTo}" data-cycle-edge="true" data-resting-opacity="${restCycleLabelOpacity}" style="opacity:${restCycleLabelOpacity};" transform="translate(${labelX.toFixed(1)}, ${labelY.toFixed(1)})"><rect x="${(-pillW / 2).toFixed(1)}" y="-10" width="${pillW.toFixed(1)}" height="20" rx="5" fill="${edgeLabelBg}" stroke="${cycleStroke}" stroke-width="0.9"/><text x="0" y="3.8" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10.5" fill="${cycleStroke}">${escXml(meta.shortLabel)}</text></g>`
      );
    }
  }

  // 4. Render Crisp, Spacious Node Cards (zero text overlap or clipping)
  const nodeParts: string[] = [];
  for (const node of graph.nodes.values()) {
    const pos = posById.get(node.id);
    if (!pos) continue;
    const nx = pos.x + shiftX;
    const ny = pos.y + shiftY;
    const colors = getBuilderNodeColors(node, isDark);
    const lines = linesByNodeId.get(node.id) || ['Knoten'];
    const lineHeight = 19.5;
    const blockHeight = (lines.length - 1) * lineHeight;
    const firstCenterY = pos.h / 2 - blockHeight / 2 + 4;
    const tspans = lines
      .map(
        (ln, li) =>
          `<tspan x="${(pos.w / 2).toFixed(1)}" y="${(firstCenterY + li * lineHeight).toFixed(1)}" font-size="${li === 0 ? '12.5' : '11.5'}"${li === 0 ? ' font-weight="600"' : ` fill="${textMuted}"`}>${escXml(ln)}</tspan>`
      )
      .join('');
    const nodeDomId = `flowchart-${node.id}-0`;
    nodeParts.push(
      `<g class="node default" id="${escXml(nodeDomId)}" data-id="${escXml(node.id)}" transform="translate(${nx.toFixed(1)}, ${ny.toFixed(1)})"><rect class="basic label-container" x="0" y="0" width="${pos.w.toFixed(1)}" height="${pos.h.toFixed(1)}" rx="10" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.7"/><text font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" fill="${textMain}" text-anchor="middle">${tspans}</text></g>`
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="flowchart" data-layout-engine="${engineTag}" data-direction="${direction}" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}" style="background:${bg}">` +
    `<defs>` +
    `<marker id="elk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="${edgeStroke}"/></marker>` +
    `<marker id="elk-cycle-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="${cycleStroke}"/></marker>` +
    `</defs>` +
    `<g class="clusters">${clusterParts.join('')}</g>` +
    `<g class="edgePaths">${edgePathParts.join('')}</g>` +
    `<g class="edgeLabels">${edgeLabelParts.join('')}</g>` +
    `<g class="nodes">${nodeParts.join('')}</g>` +
    `</svg>`
  );
}

/**
 * Renders a CallflowGraph using Eclipse Layout Kernel (ELK) Sugiyama `layered` layout
 * with compound Subgraph/Abschnitt boxes, generous Builder spacing, smooth curved edges,
 * and subtly transparent outer-perimeter cycle arcs that light up to 100% on click.
 */
export async function renderElkWorkerFlowchartSvg(
  options: RenderElkFlowchartOptions
): Promise<RenderElkFlowchartResult> {
  const t0 = performance.now();
  const {
    mermaidCode,
    graph,
    surface,
    title,
    timeoutMs = 18000,
    signal,
  } = options;
  const direction = extractFlowchartDirection(mermaidCode, options.direction || 'LR');

  if (graph.nodes.size === 0) {
    return {
      svg: buildDeterministicFlowchartSvg(graph, surface, title, direction),
      engine: 'deterministic-fallback',
      direction,
      fromCache: false,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
    };
  }

  const cacheKey = `v2::${computeFastCacheHash(mermaidCode.trim())}::${direction}::${surface}`;
  const cached = getCachedElkSvg(cacheKey);
  if (cached) {
    return {
      svg: cached.svg,
      engine: cached.engine,
      direction: cached.direction,
      fromCache: true,
      durationMs: 0,
    };
  }

  if (signal?.aborted) {
    return {
      svg: '',
      engine: 'elk-worker',
      direction,
      fromCache: false,
      durationMs: 0,
      aborted: true,
    };
  }

  // 1. Measure nodes & extract Mermaid subgraphs + named Abschnitt clusters
  const linesByNodeId = new Map<string, string[]>();
  const elkLeafById = new Map<string, ElkNode>();
  for (const node of graph.nodes.values()) {
    const lines = wrapNodeLabelLines(node.label || node.id);
    linesByNodeId.set(node.id, lines);
    const { width, height } = measureNodeBox(lines);
    elkLeafById.set(node.id, { id: node.id, width, height });
  }

  const { clustersById, nodeClusterById } = extractClustersForElk(mermaidCode, graph);
  const elkDir = mapDirectionToElk(direction);
  const isHorizontal = elkDir === 'RIGHT' || elkDir === 'LEFT';

  // Build 1-level peer ELK container tree (fast, rock-solid compound layout)
  const clusterElkNodeById = new Map<string, ElkNode>();
  for (const cl of clustersById.values()) {
    clusterElkNodeById.set(cl.id, {
      id: cl.id,
      children: [],
      edges: [],
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': elkDir,
        'elk.padding': '[top=46,left=26,bottom=26,right=26]',
        'elk.spacing.nodeNode': isHorizontal ? '56' : '64',
        'elk.layered.spacing.nodeNodeBetweenLayers': isHorizontal ? '164' : '128',
        'elk.spacing.edgeNode': '30',
        'elk.spacing.edgeEdge': '16',
      },
    });
  }

  const rootChildren: ElkNode[] = [];
  for (const cl of clustersById.values()) {
    rootChildren.push(clusterElkNodeById.get(cl.id)!);
  }

  for (const node of graph.nodes.values()) {
    const leaf = elkLeafById.get(node.id)!;
    const cid = nodeClusterById.get(node.id);
    if (cid && clusterElkNodeById.has(cid)) {
      clusterElkNodeById.get(cid)!.children!.push(leaf);
    } else {
      rootChildren.push(leaf);
    }
  }

  // 2. Partition forward flow edges vs. cycle/back-edges
  const { forwardEdges, cycleEdges } = partitionForwardAndCycleEdges(graph);
  const edgeCounterByPair = new Map<string, number>();
  const includeForwardLabels = forwardEdges.length <= 900;

  const rootForwardEdges: ElkEdge[] = [];
  const forwardEdgeMetaById = new Map<string, EdgeRenderMeta>();
  const cycleEdgesWithMeta: Array<{ edge: CallflowEdge; meta: EdgeRenderMeta }> = [];

  const makeMeta = (edge: CallflowEdge, allowLabel: boolean): EdgeRenderMeta => {
    const pairKey = `${edge.from}->${edge.to}`;
    const occ = edgeCounterByPair.get(pairKey) || 0;
    edgeCounterByPair.set(pairKey, occ + 1);
    const domId = `L_${edge.from}_${edge.to}_${occ}`;
    const cleanLbl = (edge.label || '').trim();
    const shortLabel =
      allowLabel && cleanLbl
        ? cleanLbl.length > 28
          ? `${cleanLbl.slice(0, 27)}…`
          : cleanLbl
        : '';
    return {
      from: edge.from,
      to: edge.to,
      domId,
      label: cleanLbl,
      shortLabel,
      isDotted: edge.isAsync || edge.rawArrow.includes('.'),
      isThick: edge.rawArrow.includes('='),
    };
  };

  let edgeSeq = 0;
  for (const { edge } of forwardEdges) {
    const meta = makeMeta(edge, includeForwardLabels);
    const elkEdgeId = `ef_${edgeSeq++}`;
    forwardEdgeMetaById.set(elkEdgeId, meta);
    const elkEdge: ElkEdge = {
      id: elkEdgeId,
      sources: [edge.from],
      targets: [edge.to],
    };
    if (meta.shortLabel) {
      const lblW = Math.max(40, Math.min(196, Math.round(meta.shortLabel.length * 6.5 + 18)));
      elkEdge.labels = [
        {
          id: `${elkEdgeId}_lbl`,
          text: meta.shortLabel,
          width: lblW,
          height: 22,
        },
      ];
    }
    // Attach intra-cluster edges directly to their lowest common ancestor (LCA) container
    const fromCluster = nodeClusterById.get(edge.from);
    const toCluster = nodeClusterById.get(edge.to);
    if (fromCluster && fromCluster === toCluster && clusterElkNodeById.has(fromCluster)) {
      clusterElkNodeById.get(fromCluster)!.edges!.push(elkEdge);
    } else {
      rootForwardEdges.push(elkEdge);
    }
  }

  for (const { edge } of cycleEdges) {
    const meta = makeMeta(edge, true);
    cycleEdgesWithMeta.push({ edge, meta });
  }

  const isUltraLarge = forwardEdges.length > 600 || graph.nodes.size > 480;
  const hasClusters = clustersById.size > 0;

  const layoutOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': elkDir,
    'elk.hierarchyHandling': hasClusters ? 'INCLUDE_CHILDREN' : 'SEPARATE_CHILDREN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.crossingMinimization.greedySwitchHierarchical.type': 'ONE_SIDED',
    'elk.layered.cycleBreaking.strategy': 'GREEDY',
    'elk.layered.considerModelOrder.strategy': 'NONE',
    'elk.layered.mergeEdges': 'false',
    'elk.layered.thoroughness': isUltraLarge ? '2' : '4',
    'elk.spacing.nodeNode': isHorizontal ? '64' : '72',
    'elk.spacing.componentComponent': '72',
    'elk.layered.spacing.nodeNodeBetweenLayers': isHorizontal ? '176' : '136',
    'elk.spacing.edgeNode': '32',
    'elk.spacing.edgeEdge': '18',
    'elk.layered.spacing.edgeNodeBetweenLayers': '34',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '18',
    'elk.padding': '[top=36,left=36,bottom=36,right=36]',
    'elk.edgeLabels.placement': 'CENTER',
    'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'MEDIAN_LAYER',
  };

  const elkRoot: ElkNode = {
    id: 'root',
    children: rootChildren,
    edges: rootForwardEdges,
  };

  const canUseBrowserWorker =
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function';

  try {
    const laidOut = canUseBrowserWorker
      ? await runElkInBrowserWorker(elkRoot, layoutOptions, timeoutMs, signal)
      : await runElkInNodeBundled(elkRoot, layoutOptions);

    const engineTag: 'elk-worker' | 'elk-bundled' = canUseBrowserWorker
      ? 'elk-worker'
      : 'elk-bundled';
    const svg = buildSvgFromElkLayout(
      laidOut,
      graph,
      clustersById,
      linesByNodeId,
      forwardEdgeMetaById,
      cycleEdgesWithMeta,
      surface,
      direction,
      engineTag
    );
    setCachedElkSvg(cacheKey, { svg, engine: engineTag, direction });
    return {
      svg,
      engine: engineTag,
      direction,
      fromCache: false,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err || '');
    if (msg === 'ELK_ABORTED' || signal?.aborted) {
      return {
        svg: '',
        engine: 'elk-worker',
        direction,
        fromCache: false,
        durationMs: Math.max(1, Math.round(performance.now() - t0)),
        aborted: true,
      };
    }
    const fallbackSvg = buildDeterministicFlowchartSvg(graph, surface, title, direction);
    return {
      svg: fallbackSvg,
      engine: 'deterministic-fallback',
      direction,
      fromCache: false,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
      timedOut: msg === 'ELK_TIMEOUT',
    };
  }
}
