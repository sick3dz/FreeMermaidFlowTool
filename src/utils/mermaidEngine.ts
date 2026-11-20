import mermaid from 'mermaid';
import {
  DiagramDirection,
  PathColorMode,
  SmartColorMode,
  SmartColorNodeType,
  ThemeConfiguration,
  ValidationState,
} from '../types/mermaidStudio';
import { applySmartLogicColoring } from './smartColorEngine';

let renderCounter = 0;
let elkRegistered = false;
let elkRegisterPromise: Promise<void> | null = null;
let lastEngineConfigSignature: string | null = null;
let mermaidRenderMutex: Promise<void> = Promise.resolve();

function getOrCreateMermaidOffscreenSandbox(): HTMLDivElement | undefined {
  if (typeof document === 'undefined' || !document.body) return undefined;
  let sandbox = document.getElementById('mermaid-offscreen-sandbox') as HTMLDivElement | null;
  if (!sandbox) {
    sandbox = document.createElement('div');
    sandbox.id = 'mermaid-offscreen-sandbox';
    sandbox.setAttribute('aria-hidden', 'true');
    sandbox.style.position = 'fixed';
    sandbox.style.left = '-100000px';
    sandbox.style.top = '0px';
    sandbox.style.width = '2400px';
    sandbox.style.height = '1600px';
    sandbox.style.overflow = 'hidden';
    sandbox.style.opacity = '0';
    sandbox.style.visibility = 'hidden';
    sandbox.style.contain = 'style';
    sandbox.style.pointerEvents = 'none';
    sandbox.style.zIndex = '-1';
    document.body.appendChild(sandbox);
  }
  return sandbox;
}

function enqueueMermaidRender<T>(task: () => Promise<T>): Promise<T> {
  const next = mermaidRenderMutex.then(task, task);
  mermaidRenderMutex = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * Resets the internal Mermaid render queue and clears any stuck offscreen DOM remnants.
 * Used as a safety valve before batch exports or after a stalled/timed-out render so
 * subsequent diagrams never block behind a hung Promise.
 */
export function resetMermaidRenderQueue(): void {
  mermaidRenderMutex = Promise.resolve();
  lastEngineConfigSignature = null;
  if (typeof document !== 'undefined') {
    const sandbox = document.getElementById('mermaid-offscreen-sandbox');
    if (sandbox) sandbox.innerHTML = '';
    document
      .querySelectorAll('[id^="dmermaid-local-svg-"], body > [id^="mermaid-local-svg-"]')
      .forEach((node) => node.remove());
  }
}

const MAX_SVG_RENDER_CACHE = 320;
const svgRenderCache = new Map<
  string,
  { svg: string; diagramType: string }
>();

export function computeFastCacheHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(36)}_${input.length}`;
}

function buildEngineConfigSignature(
  themeConfig: ThemeConfiguration,
  forceNativeSvgLabels: boolean
): string {
  const nodeSpacing = Number.isFinite(themeConfig.nodeSpacing) ? themeConfig.nodeSpacing : 55;
  const rankSpacing = Number.isFinite(themeConfig.rankSpacing) ? themeConfig.rankSpacing : 70;
  return JSON.stringify([
    themeConfig.layoutEngine || 'dagre',
    themeConfig.look,
    themeConfig.theme,
    themeConfig.useCustomColors,
    themeConfig.curve,
    themeConfig.fontFamily,
    themeConfig.fontSize,
    nodeSpacing,
    rankSpacing,
    forceNativeSvgLabels,
    themeConfig.useCustomColors
      ? [
          themeConfig.primaryColor,
          themeConfig.primaryTextColor,
          themeConfig.primaryBorderColor,
          themeConfig.lineColor,
          themeConfig.secondaryColor,
          themeConfig.tertiaryColor,
          themeConfig.background,
          themeConfig.mainBkg,
          themeConfig.nodeBorder,
          themeConfig.clusterBkg,
          themeConfig.clusterBorder,
          themeConfig.titleColor,
          themeConfig.edgeLabelBackground,
        ]
      : null,
  ]);
}

function getCachedSvgRender(key: string): { svg: string; diagramType: string } | undefined {
  const hit = svgRenderCache.get(key);
  if (!hit) return undefined;
  svgRenderCache.delete(key);
  svgRenderCache.set(key, hit);
  return hit;
}

function setCachedSvgRender(
  key: string,
  value: { svg: string; diagramType: string }
): void {
  if (svgRenderCache.has(key)) {
    svgRenderCache.delete(key);
  }
  svgRenderCache.set(key, value);
  if (svgRenderCache.size > MAX_SVG_RENDER_CACHE) {
    const oldestKey = svgRenderCache.keys().next().value;
    if (oldestKey !== undefined) {
      svgRenderCache.delete(oldestKey);
    }
  }
}

export function buildMermaidRenderCacheKey(
  code: string,
  themeConfig: ThemeConfiguration,
  forceNativeSvgLabels = false
): string {
  const sig = buildEngineConfigSignature(themeConfig, forceNativeSvgLabels);
  return `${computeFastCacheHash(code.trim())}::${computeFastCacheHash(sig)}`;
}

export function hasCachedMermaidDiagram(
  code: string,
  themeConfig: ThemeConfiguration,
  forceNativeSvgLabels = false
): boolean {
  const key = buildMermaidRenderCacheKey(code, themeConfig, forceNativeSvgLabels);
  return svgRenderCache.has(key);
}

/**
 * Estimates whether a Mermaid diagram crosses the Blink/Skia <foreignObject> threshold
 * where native SVG <text>/<tspan> vector labels noticeably improve pan/zoom frame rate.
 */
export function shouldUseNativeSvgLabels(
  code: string,
  thresholds: { maxHtmlNodes?: number; maxHtmlEdges?: number } = {}
): boolean {
  const maxHtmlNodes = thresholds.maxHtmlNodes ?? 25;
  const maxHtmlEdges = thresholds.maxHtmlEdges ?? 40;
  const trimmed = code.trim();
  if (!trimmed) return false;

  const withoutDirectives = trimmed
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .replace(/%%\{[\s\S]*?\}%%/g, '');

  const lines = withoutDirectives.split('\n');
  let headerToken = '';
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('%%')) continue;
    headerToken = t.split(/[\s({]/)[0]?.toLowerCase() || '';
    break;
  }

  if (headerToken !== 'flowchart' && headerToken !== 'graph') {
    return false;
  }

  let edgeCount = 0;
  const nodeIds = new Set<string>();
  const edgeArrowRegex = /--?>|-\.-?>|==?>|<-->|<-\.->|---/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      !line ||
      line.startsWith('%%') ||
      /^(?:flowchart|graph|subgraph|end|direction|classDef|class|style|linkStyle|click)\b/i.test(
        line
      )
    ) {
      continue;
    }

    const arrows = line.match(edgeArrowRegex);
    if (arrows && arrows.length > 0) {
      edgeCount += arrows.length;
      if (edgeCount >= maxHtmlEdges) return true;
    }

    const idMatches = line.match(/\b([A-Za-z_][A-Za-z0-9_.-]*)\s*(?=\[|\(|\{|-->|-\.->|==>|---)/g);
    if (idMatches) {
      for (let j = 0; j < idMatches.length; j++) {
        nodeIds.add(idMatches[j].trim());
        if (nodeIds.size >= maxHtmlNodes) return true;
      }
    }
  }

  return nodeIds.size >= maxHtmlNodes || edgeCount >= maxHtmlEdges;
}

async function ensureElkLayoutRegistered(): Promise<void> {
  if (elkRegistered) return;
  if (!elkRegisterPromise) {
    elkRegisterPromise = import('@mermaid-js/layout-elk')
      .then((mod) => {
        const elkLayouts = mod.default;
        if (elkLayouts) {
          mermaid.registerLayoutLoaders(elkLayouts);
        }
        elkRegistered = true;
      })
      .catch(() => {
        // ignore if already registered or failed
      })
      .finally(() => {
        elkRegisterPromise = null;
      });
  }
  await elkRegisterPromise;
}

/**
 * Checks whether a CSS hex/rgb color is perceptually dark (relative luminance < 0.35).
 */
export function isColorDark(color: string | null | undefined): boolean {
  if (!color) return false;
  const trimmed = color.trim().toLowerCase();
  if (trimmed === 'black') return true;
  if (trimmed === 'white') return false;

  let r = -1;
  let g = -1;
  let b = -1;

  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  } else {
    const rgbMatch = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbMatch) {
      r = Number(rgbMatch[1]);
      g = Number(rgbMatch[2]);
      b = Number(rgbMatch[3]);
    }
  }

  if (r < 0 || g < 0 || b < 0 || Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return false;
  }

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.42;
}

/**
 * Builds complete Mermaid themeVariables including darkMode, background, arrowheadColor,
 * defaultLinkColor, transitionColor, and signalColor so no edge or marker defaults to black.
 */
function buildCustomThemeVariables(themeConfig: ThemeConfiguration): Record<string, unknown> {
  const darkMode =
    isColorDark(themeConfig.background) || isColorDark(themeConfig.primaryColor);

  return {
    darkMode,
    background: themeConfig.background,
    fontFamily: themeConfig.fontFamily,
    fontSize: `${themeConfig.fontSize}px`,
    primaryColor: themeConfig.primaryColor,
    primaryTextColor: themeConfig.primaryTextColor,
    primaryBorderColor: themeConfig.primaryBorderColor,
    lineColor: themeConfig.lineColor,
    arrowheadColor: themeConfig.lineColor,
    defaultLinkColor: themeConfig.lineColor,
    textColor: themeConfig.primaryTextColor,
    secondaryColor: themeConfig.secondaryColor,
    tertiaryColor: themeConfig.tertiaryColor,
    mainBkg: themeConfig.mainBkg,
    nodeBorder: themeConfig.nodeBorder,
    clusterBkg: themeConfig.clusterBkg,
    clusterBorder: themeConfig.clusterBorder,
    titleColor: themeConfig.titleColor,
    edgeLabelBackground: themeConfig.edgeLabelBackground,
    actorBkg: themeConfig.primaryColor,
    actorBorder: themeConfig.primaryBorderColor,
    actorTextColor: themeConfig.primaryTextColor,
    actorLineColor: themeConfig.lineColor,
    signalColor: themeConfig.lineColor,
    signalTextColor: themeConfig.primaryTextColor,
    labelBoxBkgColor: themeConfig.secondaryColor,
    labelBoxBorderColor: themeConfig.primaryBorderColor,
    labelTextColor: themeConfig.primaryTextColor,
    loopTextColor: themeConfig.primaryTextColor,
    noteBkgColor: themeConfig.tertiaryColor,
    noteTextColor: themeConfig.primaryTextColor,
    noteBorderColor: themeConfig.primaryBorderColor,
    transitionColor: themeConfig.lineColor,
    transitionLabelColor: themeConfig.primaryTextColor,
    stateBkg: themeConfig.primaryColor,
    stateLabelColor: themeConfig.primaryTextColor,
    classText: themeConfig.primaryTextColor,
    edgeColor: themeConfig.lineColor,
    archEdgeColor: themeConfig.lineColor,
    relationColor: themeConfig.lineColor,
  };
}

/**
 * Configures the local Mermaid v11 engine with the active ThemeConfiguration,
 * including ELK vs Dagre layout engine and anti-overlap nodeSpacing / rankSpacing.
 */
export function configureMermaidEngine(
  themeConfig: ThemeConfiguration,
  forceNativeSvgLabels = false,
  forceReset = false
): void {
  const nextSignature = buildEngineConfigSignature(themeConfig, forceNativeSvgLabels);
  if (!forceReset && lastEngineConfigSignature === nextSignature) {
    return;
  }

  const nodeSpacing = Number.isFinite(themeConfig.nodeSpacing) ? themeConfig.nodeSpacing : 55;
  const rankSpacing = Number.isFinite(themeConfig.rankSpacing) ? themeConfig.rankSpacing : 70;
  const isElk = themeConfig.layoutEngine === 'elk';

  // Reset cached Mermaid config scope before re-initializing so slider changes always apply
  try {
    const api = (mermaid as unknown as { mermaidAPI?: { reset?: () => void } }).mermaidAPI;
    api?.reset?.();
  } catch {
    // ignore if reset is unavailable
  }

  const baseConfig: Record<string, unknown> = {
    startOnLoad: false,
    securityLevel: 'strict',
    maxTextSize: 2000000,
    maxEdges: 25000,
    look: themeConfig.look,
    layout: isElk ? 'elk' : 'dagre',
    theme: themeConfig.useCustomColors ? 'base' : themeConfig.theme,
    fontFamily: themeConfig.fontFamily,
    altFontFamily: themeConfig.fontFamily,
    elk: {
      mergeEdges: false,
      nodePlacementStrategy: 'BRANDES_KOEPF',
    },
    flowchart: {
      curve: themeConfig.curve,
      htmlLabels: !forceNativeSvgLabels,
      useMaxWidth: false,
      nodeSpacing,
      rankSpacing,
      padding: Math.max(12, Math.min(48, Math.round(nodeSpacing * 0.25))),
      diagramPadding: 18,
    },
    sequence: {
      useMaxWidth: false,
      mirrorActors: true,
      messageMargin: Math.max(30, Math.round(rankSpacing * 0.65)),
      actorMargin: Math.max(35, nodeSpacing),
      boxMargin: 14,
    },
    state: {
      useMaxWidth: false,
      nodeSpacing,
      rankSpacing,
    },
    class: {
      useMaxWidth: false,
      nodeSpacing,
      rankSpacing,
    },
    er: {
      useMaxWidth: false,
      layoutDirection: 'TB',
      entityPadding: Math.max(12, Math.round(nodeSpacing * 0.3)),
    },
    gantt: {
      useMaxWidth: false,
    },
  };

  if (themeConfig.useCustomColors) {
    baseConfig.themeVariables = buildCustomThemeVariables(themeConfig);
  }

  mermaid.initialize(baseConfig as Parameters<typeof mermaid.initialize>[0]);
  lastEngineConfigSignature = nextSignature;
}

/**
 * Extracts a human-readable line number from a Mermaid parser error message if available.
 */
export function extractErrorLine(errorMessage: string): number | null {
  const lineMatch =
    errorMessage.match(/line\s+(\d+)/i) ||
    errorMessage.match(/Parse error on line\s+(\d+)/i) ||
    errorMessage.match(/Lexical error on line\s+(\d+)/i);
  if (lineMatch && lineMatch[1]) {
    const parsed = parseInt(lineMatch[1], 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Detects the diagram type from the code or via Mermaid's detector.
 */
export function detectDiagramTypeLabel(code: string): string {
  const cleaned = code
    .replace(/%%\{[\s\S]*?\}%%/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('%%'))[0] || '';

  const token = cleaned.split(/[\s({]/)[0]?.toLowerCase() || '';
  const typeMap: Record<string, string> = {
    flowchart: 'Flowchart / Callflow v11',
    graph: 'Flowchart / Callflow',
    sequencediagram: 'Sequenzdiagramm',
    classdiagram: 'Klassendiagramm',
    'statediagram-v2': 'Zustandsdiagramm v2',
    statediagram: 'Zustandsdiagramm',
    erdiagram: 'ER-Datenmodell',
    gantt: 'Gantt-Zeitplan',
    mindmap: 'Mindmap',
    timeline: 'Timeline',
    gitgraph: 'GitGraph',
    quadrantchart: 'Quadrant-Matrix',
    'xychart-beta': 'XY-Diagramm (v11)',
    xychart: 'XY-Diagramm (v11)',
    'sankey-beta': 'Sankey-Fluss (v11)',
    'architecture-beta': 'Architektur-Topologie (v11)',
    kanban: 'Kanban-Board (v11)',
    'packet-beta': 'Netzwerk-Packet (v11)',
    'block-beta': 'Blockdiagramm (v11)',
    c4context: 'C4-Architektur',
    journey: 'User Journey',
    pie: 'Kreisdiagramm',
  };

  return typeMap[token] || (token ? `Mermaid (${token})` : 'Leer');
}

/**
 * Merges active UI layout/spacing settings over any %%{init:...}%% block in the code
 * solely for rendering, so sliders in the Callflow Inspector always take effect immediately
 * while preserving optional YAML frontmatter (`--- ... ---`).
 */
function prepareCodeWithRuntimeLayout(
  code: string,
  themeConfig: ThemeConfiguration,
  forceNativeSvgLabels = false
): string {
  const strippedInit = code.replace(/^\s*%%\{init:[\s\S]*?\}%%\s*\n?/gm, '').trimStart();
  const runtimeInit = buildInitDirectiveBlock(themeConfig, forceNativeSvgLabels);
  const frontmatterMatch = strippedInit.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (frontmatterMatch) {
    const fm = frontmatterMatch[0];
    const body = strippedInit.slice(fm.length);
    return `${fm}${runtimeInit}\n${body}`;
  }
  return `${runtimeInit}\n${strippedInit}`;
}

/**
 * Validates and renders the Mermaid diagram completely locally in the browser.
 * Includes an automatic fallback to Dagre layout if ELK layout fails for a specific diagram type.
 */
export async function renderLocalMermaidDiagram(
  code: string,
  themeConfig: ThemeConfiguration,
  forceNativeSvgLabels = false,
  options?: {
    timeoutMs?: number;
    skipParseDiagnostics?: boolean;
    signal?: AbortSignal;
  }
): Promise<{
  svg: string | null;
  validation: ValidationState;
  fromCache?: boolean;
  timedOut?: boolean;
}> {
  const trimmed = code.trim();
  const diagramType = detectDiagramTypeLabel(trimmed);
  const timeoutMs =
    options?.timeoutMs === undefined
      ? 25000
      : options.timeoutMs > 0
      ? options.timeoutMs
      : 0;
  const skipParseDiagnostics = Boolean(options?.skipParseDiagnostics);
  const abortSignal = options?.signal;

  if (abortSignal?.aborted) {
    return {
      svg: null,
      validation: {
        isValid: false,
        diagramType,
        errorMessage: 'Render abgebrochen.',
        errorLine: null,
        lastRenderMs: 0,
      },
      fromCache: false,
    };
  }

  if (!trimmed) {
    return {
      svg: null,
      validation: {
        isValid: true,
        diagramType: 'Leer',
        errorMessage: null,
        errorLine: null,
        lastRenderMs: 0,
      },
      fromCache: false,
    };
  }

  const cacheKey = buildMermaidRenderCacheKey(trimmed, themeConfig, forceNativeSvgLabels);
  const cached = getCachedSvgRender(cacheKey);
  if (cached) {
    return {
      svg: cached.svg,
      validation: {
        isValid: true,
        diagramType: cached.diagramType,
        errorMessage: null,
        errorLine: null,
        lastRenderMs: 1,
      },
      fromCache: true,
    };
  }

  const runRenderPromise = enqueueMermaidRender(async () => {
    if (abortSignal?.aborted) {
      return {
        svg: null,
        validation: {
          isValid: false,
          diagramType,
          errorMessage: 'Render abgebrochen.',
          errorLine: null,
          lastRenderMs: 0,
        },
        fromCache: false,
      };
    }

    const cacheHitInsideLock = getCachedSvgRender(cacheKey);
    if (cacheHitInsideLock) {
      return {
        svg: cacheHitInsideLock.svg,
        validation: {
          isValid: true,
          diagramType: cacheHitInsideLock.diagramType,
          errorMessage: null,
          errorLine: null,
          lastRenderMs: 1,
        },
        fromCache: true,
      };
    }

    const startTime = performance.now();
    const sandbox = getOrCreateMermaidOffscreenSandbox();
    const createIsolatedRenderSlot = (slotKey: string): HTMLDivElement | undefined => {
      if (!sandbox || typeof document === 'undefined') return undefined;
      const slot = document.createElement('div');
      slot.id = `mermaid-slot-${slotKey}`;
      sandbox.appendChild(slot);
      return slot;
    };
    const cleanupRenderSlot = (slot: HTMLDivElement | undefined, renderId?: string) => {
      if (slot && slot.parentNode) {
        slot.parentNode.removeChild(slot);
      }
      if (renderId && typeof document !== 'undefined') {
        document.getElementById(`d${renderId}`)?.remove();
      }
    };

    const runWithOptionalTimeout = async <T,>(
      work: Promise<T>,
      customTimeoutMs?: number
    ): Promise<T> => {
      const limit = customTimeoutMs !== undefined ? customTimeoutMs : timeoutMs;
      if (!limit) return work;
      let timerId: number | undefined;
      try {
        return await Promise.race([
          work,
          new Promise<T>((_resolve, reject) => {
            timerId = window.setTimeout(() => {
              reject(new Error(`RENDER_TIMEOUT_${limit}`));
            }, limit);
          }),
        ]);
      } finally {
        if (timerId !== undefined) {
          window.clearTimeout(timerId);
        }
      }
    };

    let activeSlot: HTMLDivElement | undefined;
    let activeRenderId: string | undefined;

    try {
      if (themeConfig.layoutEngine === 'elk') {
        await runWithOptionalTimeout(ensureElkLayoutRegistered());
      }
      configureMermaidEngine(themeConfig, forceNativeSvgLabels);

      // Apply live UI layout/spacing directive on top of code so sliders never get ignored by stale init blocks
      const renderCode = prepareCodeWithRuntimeLayout(trimmed, themeConfig, forceNativeSvgLabels);

      // Single-pass render inside an isolated child slot of the hidden offscreen sandbox
      renderCounter += 1;
      const uniqueRenderId = `mermaid-local-svg-${Date.now()}-${renderCounter}`;
      activeRenderId = uniqueRenderId;
      activeSlot = createIsolatedRenderSlot(String(renderCounter));
      let svgResult: string;
      try {
        const rendered = await runWithOptionalTimeout(
          mermaid.render(uniqueRenderId, renderCode, activeSlot || sandbox)
        );
        svgResult = rendered.svg;
      } catch (renderErr) {
        cleanupRenderSlot(activeSlot, uniqueRenderId);
        activeSlot = undefined;
        const isTimeoutErr =
          renderErr instanceof Error && renderErr.message.startsWith('RENDER_TIMEOUT_');
        if (
          !isTimeoutErr &&
          (themeConfig.layoutEngine === 'elk' || themeConfig.look === 'handDrawn')
        ) {
          const fallbackConfig: ThemeConfiguration = {
            ...themeConfig,
            layoutEngine: 'dagre',
            look: 'classic',
          };
          configureMermaidEngine(fallbackConfig, forceNativeSvgLabels, true);
          const fallbackRenderCode = prepareCodeWithRuntimeLayout(
            trimmed,
            fallbackConfig,
            forceNativeSvgLabels
          );
          renderCounter += 1;
          const fallbackId = `mermaid-local-svg-${Date.now()}-${renderCounter}`;
          activeRenderId = fallbackId;
          activeSlot = createIsolatedRenderSlot(String(renderCounter));
          const fallbackRendered = await runWithOptionalTimeout(
            mermaid.render(fallbackId, fallbackRenderCode, activeSlot || sandbox)
          );
          svgResult = fallbackRendered.svg;
          // Restore active engine signature on next call since fallback mutated Mermaid config
          lastEngineConfigSignature = null;
        } else {
          throw renderErr;
        }
      } finally {
        cleanupRenderSlot(activeSlot, activeRenderId);
        activeSlot = undefined;
      }

      const elapsed = Math.max(1, Math.round(performance.now() - startTime));
      const normalizedSvg = normalizeSvgIntrinsicDimensions(svgResult);
      setCachedSvgRender(cacheKey, { svg: normalizedSvg, diagramType });

      return {
        svg: normalizedSvg,
        validation: {
          isValid: true,
          diagramType,
          errorMessage: null,
          errorLine: null,
          lastRenderMs: elapsed,
        },
        fromCache: false,
      };
    } catch (err: unknown) {
      cleanupRenderSlot(activeSlot, activeRenderId);
      activeSlot = undefined;
      lastEngineConfigSignature = null;
      const elapsed = Math.max(1, Math.round(performance.now() - startTime));
      const isTimeoutErr = err instanceof Error && err.message.startsWith('RENDER_TIMEOUT_');

      if (!isTimeoutErr && typeof document !== 'undefined') {
        const strayErrorNodes = document.querySelectorAll(
          '[id^="dmermaid-local-svg-"], body > [id^="mermaid-local-svg-"]'
        );
        strayErrorNodes.forEach((node) => node.remove());
      }

      if (isTimeoutErr) {
        return {
          svg: null,
          validation: {
            isValid: false,
            diagramType,
            errorMessage: `Diagramm-Rendering hat das Zeitlimit (${Math.round(
              timeoutMs / 1000
            )}s) überschritten.`,
            errorLine: null,
            lastRenderMs: elapsed,
          },
          fromCache: false,
          timedOut: true,
        };
      }

      let exactParseErr: unknown = null;
      if (!skipParseDiagnostics) {
        try {
          await runWithOptionalTimeout(
            Promise.resolve(mermaid.parse(trimmed, { suppressErrors: false })),
            Math.min(2000, timeoutMs || 2000)
          );
        } catch (parseErr) {
          exactParseErr = parseErr;
        }
      }

      const errorSource = exactParseErr ?? err;
      const rawMsg =
        errorSource instanceof Error
          ? errorSource.message
          : typeof errorSource === 'object' && errorSource !== null && 'str' in errorSource
          ? String((errorSource as { str: unknown }).str)
          : String(errorSource);

      return {
        svg: null,
        validation: {
          isValid: false,
          diagramType,
          errorMessage: rawMsg.trim(),
          errorLine: extractErrorLine(rawMsg),
          lastRenderMs: elapsed,
        },
        fromCache: false,
      };
    }
  });

  if (!timeoutMs) {
    return runRenderPromise;
  }

  // Outer race ensures caller unblocks AND resets a wedged mutex if an upstream queued task stalled
  let outerTimer: number | undefined;
  try {
    return await Promise.race([
      runRenderPromise,
      new Promise<{
        svg: null;
        validation: ValidationState;
        fromCache: false;
        timedOut: true;
      }>((resolve) => {
        outerTimer = window.setTimeout(() => {
          resetMermaidRenderQueue();
          resolve({
            svg: null,
            validation: {
              isValid: false,
              diagramType,
              errorMessage: `Render-Warteschlange hat das Zeitlimit (${Math.round(
                timeoutMs / 1000
              )}s) überschritten.`,
              errorLine: null,
              lastRenderMs: timeoutMs,
            },
            fromCache: false,
            timedOut: true,
          });
        }, timeoutMs + 1200);
      }),
    ]);
  } finally {
    if (outerTimer !== undefined) {
      window.clearTimeout(outerTimer);
    }
  }
}

/**
 * Detects whether the current diagram code supports direction switching (TB, LR, RL, BT)
 * and extracts the currently active direction if present.
 */
export function getDiagramDirection(code: string): DiagramDirection | null {
  const match =
    code.match(/^\s*(?:flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/m) ||
    code.match(/^\s*direction\s+(TB|TD|BT|RL|LR)\b/m);
  if (match && match[1]) {
    return (match[1] === 'TD' ? 'TB' : match[1]) as DiagramDirection;
  }
  return null;
}

/**
 * Updates or injects the layout direction (TB, LR, RL, BT) inside Flowchart, State, or Class diagrams.
 */
export function updateDiagramDirection(code: string, newDirection: DiagramDirection): string {
  if (/^\s*(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/m.test(code)) {
    return code.replace(
      /^(\s*(?:flowchart|graph)\s+)(TB|TD|BT|RL|LR)\b/m,
      `$1${newDirection}`
    );
  }
  if (/^\s*(flowchart|graph)\s*$/m.test(code)) {
    return code.replace(/^(\s*(?:flowchart|graph))\s*$/m, `$1 ${newDirection}`);
  }
  if (/^\s*direction\s+(TB|TD|BT|RL|LR)\b/m.test(code)) {
    return code.replace(/^(\s*direction\s+)(TB|TD|BT|RL|LR)\b/m, `$1${newDirection}`);
  }
  if (/^\s*(stateDiagram-v2|stateDiagram|classDiagram)\b/m.test(code)) {
    return code.replace(
      /^(\s*(?:stateDiagram-v2|stateDiagram|classDiagram)\b[^\n]*)/m,
      `$1\n    direction ${newDirection}`
    );
  }
  return code;
}

/**
 * Generates a standard Mermaid %%{init: ...}%% directive block from the visual theme configuration
 * and injects or updates it at the top of the user's code.
 */
export function buildInitDirectiveBlock(
  themeConfig: ThemeConfiguration,
  forceNativeSvgLabels = false
): string {
  const nodeSpacing = Number.isFinite(themeConfig.nodeSpacing) ? themeConfig.nodeSpacing : 55;
  const rankSpacing = Number.isFinite(themeConfig.rankSpacing) ? themeConfig.rankSpacing : 70;
  const initPayload: Record<string, unknown> = {
    theme: themeConfig.useCustomColors ? 'base' : themeConfig.theme,
    look: themeConfig.look,
    layout: themeConfig.layoutEngine || 'dagre',
    flowchart: {
      curve: themeConfig.curve,
      ...(forceNativeSvgLabels ? { htmlLabels: false } : {}),
      nodeSpacing,
      rankSpacing,
      padding: Math.max(12, Math.min(48, Math.round(nodeSpacing * 0.25))),
    },
    state: {
      nodeSpacing,
      rankSpacing,
    },
    class: {
      nodeSpacing,
      rankSpacing,
    },
    sequence: {
      actorMargin: Math.max(35, nodeSpacing),
      messageMargin: Math.max(30, Math.round(rankSpacing * 0.65)),
    },
    er: {
      entityPadding: Math.max(12, Math.round(nodeSpacing * 0.3)),
    },
  };

  if (themeConfig.useCustomColors) {
    initPayload.themeVariables = buildCustomThemeVariables(themeConfig);
  }

  return `%%{init: ${JSON.stringify(initPayload)}}%%`;
}

export function injectInitDirectiveIntoCode(code: string, themeConfig: ThemeConfiguration): string {
  const directive = buildInitDirectiveBlock(themeConfig);
  const withoutExisting = code.replace(/^\s*%%\{init:[\s\S]*?\}%%\s*\n?/, '');
  return `${directive}\n${withoutExisting}`;
}

/**
 * Converts Mermaid's default `width="100%"` / `style="max-width: ..."` into explicit
 * 1:1 pixel dimensions (`width="<vbW>px" height="<vbH>px" style="max-width: none; ..."`)
 * based on the SVG's `viewBox`. This prevents CSS Flexbox from squishing large diagrams
 * into the viewport width and guarantees that 100% zoom equals true 1:1 readable size.
 */
/**
 * Ensures HTML void tags (<br>, <hr>) and entities (&nbsp;) emitted inside Mermaid <foreignObject>
 * labels are valid XML before passing to DOMParser('image/svg+xml'), preventing XML parser truncation.
 */
export function sanitizeSvgForXmlParser(svgString: string): string {
  return svgString
    .replace(/<br\s*>/gi, '<br/>')
    .replace(/<hr\s*>/gi, '<hr/>')
    .replace(/&nbsp;/gi, '&#160;');
}

function extractSvgViewBoxDimensionsFast(
  svgString: string
): { width: number; height: number } | null {
  const svgTagMatch = svgString.match(/<svg\b([^>]*)>/i);
  if (!svgTagMatch) return null;
  const attrs = svgTagMatch[1];
  const vbMatch = attrs.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return {
        width: Math.ceil(parts[2]),
        height: Math.ceil(parts[3]),
      };
    }
  }
  return null;
}

export function normalizeSvgIntrinsicDimensions(svgString: string): string {
  const safeXml = sanitizeSvgForXmlParser(svgString);
  const fastDims = extractSvgViewBoxDimensionsFast(safeXml);
  if (fastDims) {
    const { width: intrinsicWidth, height: intrinsicHeight } = fastDims;
    return safeXml.replace(/<svg\b([^>]*)>/i, (_full, rawAttrs: string) => {
      let attrs = rawAttrs
        .replace(/\s*\bwidth\s*=\s*["'][^"']*["']/gi, '')
        .replace(/\s*\bheight\s*=\s*["'][^"']*["']/gi, '');
      const styleMatch = attrs.match(/\bstyle\s*=\s*["']([^"']*)["']/i);
      const enforcedStyle = `max-width: none; width: ${intrinsicWidth}px; height: ${intrinsicHeight}px; display: block;`;
      if (styleMatch) {
        const cleanedStyle = styleMatch[1]
          .replace(/(?:max-width|width|height|display)\s*:[^;]+;?/gi, '')
          .trim();
        const combined = cleanedStyle
          ? `${cleanedStyle.replace(/;?$/, ';')} ${enforcedStyle}`
          : enforcedStyle;
        attrs = attrs.replace(styleMatch[0], `style="${combined}"`);
      } else {
        attrs += ` style="${enforcedStyle}"`;
      }
      return `<svg${attrs} width="${intrinsicWidth}px" height="${intrinsicHeight}px">`;
    });
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(safeXml, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    return safeXml;
  }
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return safeXml;

  let intrinsicWidth = 0;
  let intrinsicHeight = 0;

  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      intrinsicWidth = Math.ceil(parts[2]);
      intrinsicHeight = Math.ceil(parts[3]);
    }
  }

  if (intrinsicWidth <= 0 || intrinsicHeight <= 0) {
    const wAttr = parseFloat(svgEl.getAttribute('width') || '0');
    const hAttr = parseFloat(svgEl.getAttribute('height') || '0');
    if (wAttr > 100 && hAttr > 50) {
      intrinsicWidth = Math.ceil(wAttr);
      intrinsicHeight = Math.ceil(hAttr);
    }
  }

  if (intrinsicWidth > 0 && intrinsicHeight > 0) {
    svgEl.setAttribute('width', `${intrinsicWidth}px`);
    svgEl.setAttribute('height', `${intrinsicHeight}px`);
    svgEl.style.maxWidth = 'none';
    svgEl.style.width = `${intrinsicWidth}px`;
    svgEl.style.height = `${intrinsicHeight}px`;
    svgEl.style.display = 'block';
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgEl);
}

/**
 * Extracts intrinsic SVG dimensions (width & height) from viewBox or width/height attributes.
 */
export function getSvgDimensions(svgString: string): { width: number; height: number } {
  const fastDims = extractSvgViewBoxDimensionsFast(svgString);
  if (fastDims) {
    return fastDims;
  }

  const svgTagMatch = svgString.match(/<svg\b([^>]*)>/i);
  if (svgTagMatch) {
    const wMatch = svgTagMatch[1].match(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i);
    const hMatch = svgTagMatch[1].match(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i);
    if (wMatch && hMatch) {
      const w = parseFloat(wMatch[1]);
      const h = parseFloat(hMatch[1]);
      if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
        return { width: Math.ceil(w), height: Math.ceil(h) };
      }
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitizeSvgForXmlParser(svgString), 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) {
    return { width: 1200, height: 800 };
  }

  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return {
        width: Math.ceil(parts[2]),
        height: Math.ceil(parts[3]),
      };
    }
  }

  const widthAttr = parseFloat(svgEl.getAttribute('width') || '1200');
  const heightAttr = parseFloat(svgEl.getAttribute('height') || '800');
  return {
    width: Number.isFinite(widthAttr) && widthAttr > 0 ? Math.ceil(widthAttr) : 1200,
    height: Number.isFinite(heightAttr) && heightAttr > 0 ? Math.ceil(heightAttr) : 800,
  };
}

/**
 * Prepares a standalone, self-contained SVG string with explicit width/height and optional background rect.
 */
export function prepareStandaloneSvg(
  svgString: string,
  backgroundMode: 'transparent' | 'dark' | 'light',
  padding = 32
): { serializedSvg: string; width: number; height: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(sanitizeSvgForXmlParser(svgString), 'image/svg+xml');
  const svgEl = doc.querySelector('svg');

  if (!svgEl) {
    return { serializedSvg: svgString, width: 1200, height: 800 };
  }

  // Strip external @import rules inside <style> tags so canvas export is never tainted
  const styleNodes = svgEl.querySelectorAll('style');
  styleNodes.forEach((styleNode) => {
    if (styleNode.textContent) {
      styleNode.textContent = styleNode.textContent.replace(/@import\s+url\([^)]+\)\s*;?/gi, '');
    }
  });

  let vbX = 0;
  let vbY = 0;
  let vbW = 1200;
  let vbH = 800;

  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      [vbX, vbY, vbW, vbH] = parts;
    }
  } else {
    const w = parseFloat(svgEl.getAttribute('width') || '1200');
    const h = parseFloat(svgEl.getAttribute('height') || '800');
    vbW = Number.isFinite(w) && w > 0 ? w : 1200;
    vbH = Number.isFinite(h) && h > 0 ? h : 800;
  }

  const paddedX = vbX - padding;
  const paddedY = vbY - padding;
  const paddedW = Math.ceil(vbW + padding * 2);
  const paddedH = Math.ceil(vbH + padding * 2);

  svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgEl.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svgEl.setAttribute('viewBox', `${paddedX} ${paddedY} ${paddedW} ${paddedH}`);
  svgEl.setAttribute('width', `${paddedW}`);
  svgEl.setAttribute('height', `${paddedH}`);
  svgEl.style.maxWidth = 'none';

  if (backgroundMode !== 'transparent') {
    const bgRect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', `${paddedX}`);
    bgRect.setAttribute('y', `${paddedY}`);
    bgRect.setAttribute('width', `${paddedW}`);
    bgRect.setAttribute('height', `${paddedH}`);
    bgRect.setAttribute('fill', backgroundMode === 'dark' ? '#0b0f19' : '#ffffff');
    svgEl.insertBefore(bgRect, svgEl.firstChild);
  }

  const serializer = new XMLSerializer();
  return {
    serializedSvg: serializer.serializeToString(svgEl),
    width: paddedW,
    height: paddedH,
  };
}

/**
 * Helper that draws a prepared SVG string onto an HTML5 Canvas and extracts a PNG Blob.
 */
function rasterizeSvgStringToPng(
  svgString: string,
  scale: 1 | 2 | 4,
  backgroundMode: 'transparent' | 'dark' | 'light'
): Promise<{ blob: Blob; width: number; height: number }> {
  const { serializedSvg, width, height } = prepareStandaloneSvg(svgString, backgroundMode, 36);
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const utf8Bytes = new TextEncoder().encode(serializedSvg);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    const base64Svg = `data:image/svg+xml;base64,${window.btoa(binary)}`;

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Lokaler 2D-Canvas-Kontext konnte nicht initialisiert werden.'));
          return;
        }

        if (backgroundMode !== 'transparent') {
          ctx.fillStyle = backgroundMode === 'dark' ? '#0b0f19' : '#ffffff';
          ctx.fillRect(0, 0, targetWidth, targetHeight);
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('PNG-Rasterisierung fehlgeschlagen.'));
              return;
            }
            resolve({ blob, width: targetWidth, height: targetHeight });
          },
          'image/png',
          1.0
        );
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      reject(new Error('SVG-Grafik konnte nicht für den PNG-Export geladen werden.'));
    };

    img.src = base64Svg;
  });
}

/**
 * Rasterizes the standalone SVG to a high-resolution PNG Blob completely locally via HTML5 Canvas.
 * Includes an automatic fallback to native SVG `<text>` rendering (`htmlLabels: false`) if the
 * browser blocks `<foreignObject>` canvas export.
 */
export async function exportSvgToPngBlob(
  svgString: string,
  scale: 1 | 2 | 4,
  backgroundMode: 'transparent' | 'dark' | 'light',
  fallbackOptions?: {
    code: string;
    themeConfig: ThemeConfiguration;
    smartColorMode: SmartColorMode;
    hiddenNodeTypes?: SmartColorNodeType[];
    canvasSurface: 'dark' | 'light';
    pathColorMode?: PathColorMode;
  }
): Promise<{ blob: Blob; width: number; height: number }> {
  try {
    return await rasterizeSvgStringToPng(svgString, scale, backgroundMode);
  } catch (firstErr) {
    if (fallbackOptions?.code) {
      const nativeRender = await renderLocalMermaidDiagram(
        fallbackOptions.code,
        fallbackOptions.themeConfig,
        true
      );
      if (nativeRender.svg) {
        const colored = applySmartLogicColoring(
          nativeRender.svg,
          fallbackOptions.code,
          fallbackOptions.smartColorMode,
          fallbackOptions.canvasSurface,
          fallbackOptions.themeConfig.lineColor,
          fallbackOptions.hiddenNodeTypes,
          fallbackOptions.pathColorMode || 'semantic'
        );
        return await rasterizeSvgStringToPng(colored.svg, scale, backgroundMode);
      }
    }
    throw firstErr;
  }
}

export interface SvgGpuProxyResult {
  objectUrl: string;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
}

function rasterizeSingleSvgProxy(
  svgString: string,
  signal?: AbortSignal
): Promise<SvgGpuProxyResult> {
  const { serializedSvg, width, height } = prepareStandaloneSvg(svgString, 'transparent', 0);
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const desiredScale = Math.max(1.25, dpr);
  const maxDim = 4096;
  const scale = Math.max(
    0.25,
    Math.min(desiredScale, maxDim / Math.max(1, width), maxDim / Math.max(1, height))
  );
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const utf8Bytes = new TextEncoder().encode(serializedSvg);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    const base64Svg = `data:image/svg+xml;base64,${window.btoa(binary)}`;

    img.onload = () => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('2D-Canvas-Kontext nicht verfügbar.'));
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        const finishBlob = (blob: Blob | null) => {
          if (!blob) {
            reject(new Error('GPU-Proxy-Rasterisierung fehlgeschlagen.'));
            return;
          }
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          const objectUrl = URL.createObjectURL(blob);
          const preDecode = new Image();
          preDecode.src = objectUrl;
          const done = () => {
            if (signal?.aborted) {
              URL.revokeObjectURL(objectUrl);
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }
            resolve({
              objectUrl,
              width,
              height,
              pixelWidth: targetWidth,
              pixelHeight: targetHeight,
            });
          };
          if (typeof preDecode.decode === 'function') {
            preDecode.decode().then(done).catch(done);
          } else {
            done();
          }
        };

        canvas.toBlob(
          (webpBlob) => {
            if (webpBlob) {
              finishBlob(webpBlob);
            } else {
              canvas.toBlob(finishBlob, 'image/png', 0.92);
            }
          },
          'image/webp',
          0.92
        );
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      reject(new Error('SVG-Grafik konnte nicht als GPU-Proxy geladen werden.'));
    };

    img.src = base64Svg;
  });
}

/**
 * Rasterizes an already-colored SVG (zero padding) into a pre-decoded WebP/PNG ObjectURL
 * sized safely within GPU texture bounds (<= 4096px) for 60fps zoom/pan compositing.
 */
export async function rasterizeSvgToGpuProxy(
  svgString: string,
  fallbackOptions?: {
    code: string;
    themeConfig: ThemeConfiguration;
    smartColorMode: SmartColorMode;
    hiddenNodeTypes?: SmartColorNodeType[];
    canvasSurface: 'dark' | 'light';
    pathColorMode?: PathColorMode;
  },
  signal?: AbortSignal
): Promise<SvgGpuProxyResult | null> {
  try {
    return await rasterizeSingleSvgProxy(svgString, signal);
  } catch (firstErr) {
    if (signal?.aborted) return null;
    if (fallbackOptions?.code) {
      try {
        const nativeRender = await renderLocalMermaidDiagram(
          fallbackOptions.code,
          fallbackOptions.themeConfig,
          true
        );
        if (signal?.aborted || !nativeRender.svg) return null;
        const colored = applySmartLogicColoring(
          nativeRender.svg,
          fallbackOptions.code,
          fallbackOptions.smartColorMode,
          fallbackOptions.canvasSurface,
          fallbackOptions.themeConfig.lineColor,
          fallbackOptions.hiddenNodeTypes,
          fallbackOptions.pathColorMode || 'semantic'
        );
        return await rasterizeSingleSvgProxy(colored.svg, signal);
      } catch {
        return null;
      }
    }
    void firstErr;
    return null;
  }
}

/**
 * Triggers a local browser file download for a Blob or text payload.
 */
export function triggerLocalDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
