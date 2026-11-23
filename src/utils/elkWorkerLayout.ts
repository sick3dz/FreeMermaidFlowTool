import type {
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
  layoutOptions?: Record<string, string>;
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
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
        // Hard-kill the worker thread immediately so a heavy layout never keeps burning CPU
        terminateActiveElkWorker('ELK_ABORTED');
        reject(new Error('ELK_ABORTED'));
      };

      const timer = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        // True OS-thread termination on timeout — cannot freeze the browser main thread
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

  // Serialize jobs through the shared worker queue without leaking rejections
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

// ---------- SVG Rendering & Geometry Helpers ----------

function escXml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapNodeLabelLines(raw: string, maxCharsPerLine = 32, maxLines = 4): string[] {
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
  const longest = lines.reduce((max, ln) => Math.max(max, ln.length), 6);
  const width = Math.round(Math.max(156, Math.min(280, longest * 7.25 + 34)));
  const height = Math.round(Math.max(54, lines.length * 16.5 + 24));
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
 * Builds a clean rounded orthogonal SVG path (`M ... L ... Q ...`) from ELK bend points
 * so corners have soft Builder-grade arcs while segments strictly avoid overlapping nodes.
 */
function buildRoundedOrthogonalPath(points: ElkPoint[], cornerRadius = 7): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  // Filter out consecutive duplicate/near-duplicate points
  const pts: ElkPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = pts[pts.length - 1];
    const cur = points[i];
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 0.5) {
      pts.push(cur);
    }
  }
  if (pts.length === 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  }

  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const v1x = prev.x - cur.x;
    const v1y = prev.y - cur.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 1 || len2 < 1) {
      d += ` L ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}`;
      continue;
    }
    const r = Math.min(cornerRadius, len1 * 0.45, len2 * 0.45);
    const p1x = cur.x + (v1x / len1) * r;
    const p1y = cur.y + (v1y / len1) * r;
    const p2x = cur.x + (v2x / len2) * r;
    const p2y = cur.y + (v2y / len2) * r;
    d += ` L ${p1x.toFixed(1)} ${p1y.toFixed(1)} Q ${cur.x.toFixed(1)} ${cur.y.toFixed(1)} ${p2x.toFixed(1)} ${p2y.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

function buildSvgFromElkLayout(
  laidOut: ElkNode,
  graph: CallflowGraph,
  linesByNodeId: Map<string, string[]>,
  edgeMetaById: Map<
    string,
    {
      from: string;
      to: string;
      domId: string;
      label: string;
      shortLabel: string;
      isDotted: boolean;
      isThick: boolean;
    }
  >,
  surface: 'dark' | 'light',
  direction: DiagramDirection,
  engineTag: 'elk-worker' | 'elk-bundled'
): string {
  const isDark = surface === 'dark';
  const bg = isDark ? '#0f172a' : '#f8fafc';
  const textMain = isDark ? '#f1f5f9' : '#0f172a';
  const textMuted = isDark ? '#94a3b8' : '#475569';
  const edgeStroke = isDark ? '#64748b' : '#64748b';
  const edgeLabelBg = isDark ? '#1e293b' : '#ffffff';
  const edgeLabelBorder = isDark ? '#334155' : '#cbd5e1';

  const pad = 32;
  const layoutW = Math.max(640, Math.ceil((laidOut.width || 640) + pad * 2));
  const layoutH = Math.max(320, Math.ceil((laidOut.height || 320) + pad * 2));

  const posById = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const child of laidOut.children || []) {
    posById.set(child.id, {
      x: (child.x || 0) + pad,
      y: (child.y || 0) + pad,
      w: child.width || 180,
      h: child.height || 58,
    });
  }

  const edgePathParts: string[] = [];
  const edgeLabelParts: string[] = [];

  for (const elkEdge of laidOut.edges || []) {
    const meta = edgeMetaById.get(elkEdge.id);
    if (!meta) continue;
    const escFrom = escXml(meta.from);
    const escTo = escXml(meta.to);
    const strokeDash = meta.isDotted ? ' stroke-dasharray="5,4"' : '';
    const strokeWidth = meta.isThick ? '2.4' : '1.5';

    let d = '';
    let fallbackMidX = 0;
    let fallbackMidY = 0;

    if (elkEdge.sections && elkEdge.sections.length > 0) {
      const sec = elkEdge.sections[0];
      const pts: ElkPoint[] = [
        { x: sec.startPoint.x + pad, y: sec.startPoint.y + pad },
        ...(sec.bendPoints || []).map((bp) => ({ x: bp.x + pad, y: bp.y + pad })),
        { x: sec.endPoint.x + pad, y: sec.endPoint.y + pad },
      ];
      d = buildRoundedOrthogonalPath(pts, 7);
      const midPt = pts[Math.floor(pts.length / 2)] || pts[0];
      const prevPt = pts[Math.max(0, Math.floor(pts.length / 2) - 1)] || midPt;
      fallbackMidX = (midPt.x + prevPt.x) / 2;
      fallbackMidY = (midPt.y + prevPt.y) / 2;
    } else {
      const pFrom = posById.get(meta.from);
      const pTo = posById.get(meta.to);
      if (!pFrom || !pTo) continue;
      if (meta.from === meta.to) {
        const lx = pFrom.x + pFrom.w / 2;
        const ly = pFrom.y;
        d = `M ${lx - 18} ${ly} C ${lx - 30} ${ly - 36}, ${lx + 30} ${ly - 36}, ${lx + 18} ${ly}`;
        fallbackMidX = lx;
        fallbackMidY = ly - 24;
      } else {
        const x1 = pFrom.x + pFrom.w / 2;
        const y1 = pFrom.y + pFrom.h / 2;
        const x2 = pTo.x + pTo.w / 2;
        const y2 = pTo.y + pTo.h / 2;
        d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        fallbackMidX = (x1 + x2) / 2;
        fallbackMidY = (y1 + y2) / 2;
      }
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
        ? Math.max(36, elkLbl!.width!)
        : Math.max(36, Math.min(184, meta.shortLabel.length * 6.3 + 14));
      const pillH = hasElkCoords ? Math.max(18, elkLbl!.height!) : 19;
      const cx = hasElkCoords ? elkLbl!.x! + pad + pillW / 2 : fallbackMidX;
      const cy = hasElkCoords ? elkLbl!.y! + pad + pillH / 2 : fallbackMidY - 4;
      edgeLabelParts.push(
        `<g class="edgeLabel" data-id="${escXml(meta.domId)}" data-edge-from="${escFrom}" data-edge-to="${escTo}" transform="translate(${cx.toFixed(1)}, ${cy.toFixed(1)})"><rect x="${(-pillW / 2).toFixed(1)}" y="${(-pillH / 2).toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="5" fill="${edgeLabelBg}" stroke="${edgeLabelBorder}" stroke-width="0.9"/><text x="0" y="3.5" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10.5" fill="${textMuted}">${escXml(meta.shortLabel)}</text></g>`
      );
    }
  }

  const nodeParts: string[] = [];
  for (const child of laidOut.children || []) {
    const node = graph.nodes.get(child.id);
    const pos = posById.get(child.id);
    if (!node || !pos) continue;
    const colors = getBuilderNodeColors(node, isDark);
    const lines = linesByNodeId.get(node.id) || ['Knoten'];
    const lineHeight = 16;
    const startY = (pos.h - (lines.length - 1) * lineHeight) / 2 + 4;
    const tspans = lines
      .map(
        (ln, li) =>
          `<tspan x="${(pos.w / 2).toFixed(1)}" y="${(startY + li * lineHeight).toFixed(1)}"${li === 0 ? ' font-weight="600"' : ` fill="${textMuted}" font-size="11"`}>${escXml(ln)}</tspan>`
      )
      .join('');
    const nodeDomId = `flowchart-${node.id}-0`;
    nodeParts.push(
      `<g class="node default" id="${escXml(nodeDomId)}" data-id="${escXml(node.id)}" transform="translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})"><rect class="basic label-container" x="0" y="0" width="${pos.w.toFixed(1)}" height="${pos.h.toFixed(1)}" rx="10" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.6"/><text font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" fill="${textMain}" text-anchor="middle">${tspans}</text></g>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" class="flowchart" data-layout-engine="${engineTag}" data-direction="${direction}" viewBox="0 0 ${layoutW} ${layoutH}" width="${layoutW}" height="${layoutH}" style="background:${bg}"><defs><marker id="elk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="${edgeStroke}"/></marker></defs><g class="edgePaths">${edgePathParts.join('')}</g><g class="edgeLabels">${edgeLabelParts.join('')}</g><g class="nodes">${nodeParts.join('')}</g></svg>`;
}

/**
 * Renders a CallflowGraph using Eclipse Layout Kernel (ELK) Sugiyama `layered` orthogonal layout.
 * - In browsers: runs inside an isolated Blob Web Worker (zero UI freeze, hard abort/timeout via `terminate()`).
 * - In Node.js / non-Worker environments: runs via `elk.bundled.js`.
 * - On timeout or unexpected worker failure: degrades cleanly to the upgraded collision-free deterministic layout.
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

  const cacheKey = `${computeFastCacheHash(mermaidCode.trim())}::${direction}::${surface}`;
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

  const linesByNodeId = new Map<string, string[]>();
  const elkChildren: ElkNode[] = [];

  for (const node of graph.nodes.values()) {
    const lines = wrapNodeLabelLines(node.label || node.id);
    linesByNodeId.set(node.id, lines);
    const { width, height } = measureNodeBox(lines);
    elkChildren.push({
      id: node.id,
      width,
      height,
    });
  }

  const elkEdges: ElkEdge[] = [];
  const edgeMetaById = new Map<
    string,
    {
      from: string;
      to: string;
      domId: string;
      label: string;
      shortLabel: string;
      isDotted: boolean;
      isThick: boolean;
    }
  >();
  const edgeCounterByPair = new Map<string, number>();
  const includeLabels = graph.edges.length <= 900;

  let edgeSeq = 0;
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.from) || !graph.nodes.has(edge.to)) continue;
    const pairKey = `${edge.from}->${edge.to}`;
    const occ = edgeCounterByPair.get(pairKey) || 0;
    edgeCounterByPair.set(pairKey, occ + 1);
    const domId = `L_${edge.from}_${edge.to}_${occ}`;
    const elkEdgeId = `e_${edgeSeq++}`;
    const cleanLbl = (edge.label || '').trim();
    const shortLabel =
      includeLabels && cleanLbl
        ? cleanLbl.length > 26
          ? `${cleanLbl.slice(0, 25)}…`
          : cleanLbl
        : '';

    edgeMetaById.set(elkEdgeId, {
      from: edge.from,
      to: edge.to,
      domId,
      label: cleanLbl,
      shortLabel,
      isDotted: edge.isAsync || edge.rawArrow.includes('.'),
      isThick: edge.rawArrow.includes('='),
    });

    const elkEdge: ElkEdge = {
      id: elkEdgeId,
      sources: [edge.from],
      targets: [edge.to],
    };

    if (shortLabel) {
      const lblW = Math.max(36, Math.min(184, Math.round(shortLabel.length * 6.3 + 14)));
      elkEdge.labels = [
        {
          id: `${elkEdgeId}_lbl`,
          text: shortLabel,
          width: lblW,
          height: 19,
        },
      ];
    }

    elkEdges.push(elkEdge);
  }

  const elkDir = mapDirectionToElk(direction);
  const isHorizontal = elkDir === 'RIGHT' || elkDir === 'LEFT';
  const isUltraLarge = elkEdges.length > 700 || elkChildren.length > 500;

  const layoutOptions: Record<string, string> = {
    'elk.algorithm': 'layered',
    'elk.direction': elkDir,
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.cycleBreaking.strategy': 'GREEDY',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.mergeEdges': 'true',
    'elk.layered.thoroughness': isUltraLarge ? '3' : '5',
    'elk.spacing.nodeNode': isHorizontal ? '28' : '34',
    'elk.layered.spacing.nodeNodeBetweenLayers': isHorizontal ? '76' : '64',
    'elk.spacing.edgeNode': '20',
    'elk.spacing.edgeEdge': '12',
    'elk.layered.spacing.edgeNodeBetweenLayers': '22',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
    'elk.padding': '[top=28,left=28,bottom=28,right=28]',
    'elk.edgeLabels.placement': 'CENTER',
    'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'MEDIAN_LAYER',
  };

  const elkRoot: ElkNode = {
    id: 'root',
    children: elkChildren,
    edges: elkEdges,
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
      linesByNodeId,
      edgeMetaById,
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
