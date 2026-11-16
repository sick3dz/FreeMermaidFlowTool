import mermaid from 'mermaid';
import elkLayouts from '@mermaid-js/layout-elk';
import {
  DiagramDirection,
  SmartColorMode,
  ThemeConfiguration,
  ValidationState,
} from '../types/mermaidStudio';
import { applySmartLogicColoring } from './smartColorEngine';

let renderCounter = 0;
let elkRegistered = false;

function ensureElkLayoutRegistered(): void {
  if (elkRegistered) return;
  try {
    mermaid.registerLayoutLoaders(elkLayouts);
    elkRegistered = true;
  } catch {
    // ignore if already registered
  }
}

/**
 * Configures the local Mermaid v11 engine with the active ThemeConfiguration,
 * including ELK vs Dagre layout engine and anti-overlap nodeSpacing / rankSpacing.
 */
export function configureMermaidEngine(
  themeConfig: ThemeConfiguration,
  forceNativeSvgLabels = false
): void {
  ensureElkLayoutRegistered();

  const nodeSpacing = Number.isFinite(themeConfig.nodeSpacing) ? themeConfig.nodeSpacing : 55;
  const rankSpacing = Number.isFinite(themeConfig.rankSpacing) ? themeConfig.rankSpacing : 70;

  const baseConfig: Record<string, unknown> = {
    startOnLoad: false,
    securityLevel: 'strict',
    look: themeConfig.look,
    layout: themeConfig.layoutEngine || 'dagre',
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
      padding: 18,
      diagramPadding: 16,
    },
    sequence: {
      useMaxWidth: false,
      mirrorActors: true,
      messageMargin: 44,
      boxMargin: 14,
    },
    state: {
      useMaxWidth: false,
    },
    er: {
      useMaxWidth: false,
    },
    gantt: {
      useMaxWidth: false,
    },
  };

  if (themeConfig.useCustomColors) {
    baseConfig.themeVariables = {
      fontFamily: themeConfig.fontFamily,
      fontSize: `${themeConfig.fontSize}px`,
      primaryColor: themeConfig.primaryColor,
      primaryTextColor: themeConfig.primaryTextColor,
      primaryBorderColor: themeConfig.primaryBorderColor,
      lineColor: themeConfig.lineColor,
      secondaryColor: themeConfig.secondaryColor,
      tertiaryColor: themeConfig.tertiaryColor,
      background: themeConfig.background,
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
    };
  }

  mermaid.initialize(baseConfig as Parameters<typeof mermaid.initialize>[0]);
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
 * Validates and renders the Mermaid diagram completely locally in the browser.
 */
export async function renderLocalMermaidDiagram(
  code: string,
  themeConfig: ThemeConfiguration,
  forceNativeSvgLabels = false
): Promise<{
  svg: string | null;
  validation: ValidationState;
}> {
  const trimmed = code.trim();
  const diagramType = detectDiagramTypeLabel(trimmed);

  if (!trimmed) {
    return {
      svg: null,
      validation: {
        isValid: false,
        diagramType: 'Leer',
        errorMessage: 'Der Editor enthält noch keinen Mermaid-Code.',
        errorLine: null,
        lastRenderMs: 0,
      },
    };
  }

  const startTime = performance.now();

  try {
    configureMermaidEngine(themeConfig, forceNativeSvgLabels);

    // Step 1: Parse and validate syntax without mutating the main canvas on error
    await mermaid.parse(trimmed, { suppressErrors: false });

    // Step 2: Render clean SVG
    renderCounter += 1;
    const uniqueRenderId = `mermaid-local-svg-${Date.now()}-${renderCounter}`;
    const { svg } = await mermaid.render(uniqueRenderId, trimmed);
    const elapsed = Math.max(1, Math.round(performance.now() - startTime));

    return {
      svg,
      validation: {
        isValid: true,
        diagramType,
        errorMessage: null,
        errorLine: null,
        lastRenderMs: elapsed,
      },
    };
  } catch (err: unknown) {
    const elapsed = Math.max(1, Math.round(performance.now() - startTime));
    const rawMsg =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'str' in err
        ? String((err as { str: unknown }).str)
        : String(err);

    if (typeof document !== 'undefined') {
      const strayErrorNodes = document.querySelectorAll('[id^="dmermaid-local-svg-"]');
      strayErrorNodes.forEach((node) => node.remove());
    }

    return {
      svg: null,
      validation: {
        isValid: false,
        diagramType,
        errorMessage: rawMsg.trim(),
        errorLine: extractErrorLine(rawMsg),
        lastRenderMs: elapsed,
      },
    };
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
export function buildInitDirectiveBlock(themeConfig: ThemeConfiguration): string {
  const initPayload: Record<string, unknown> = {
    theme: themeConfig.useCustomColors ? 'base' : themeConfig.theme,
    look: themeConfig.look,
    layout: themeConfig.layoutEngine || 'dagre',
    flowchart: {
      curve: themeConfig.curve,
      nodeSpacing: themeConfig.nodeSpacing,
      rankSpacing: themeConfig.rankSpacing,
    },
  };

  if (themeConfig.useCustomColors) {
    initPayload.themeVariables = {
      primaryColor: themeConfig.primaryColor,
      primaryTextColor: themeConfig.primaryTextColor,
      primaryBorderColor: themeConfig.primaryBorderColor,
      lineColor: themeConfig.lineColor,
      secondaryColor: themeConfig.secondaryColor,
      tertiaryColor: themeConfig.tertiaryColor,
      mainBkg: themeConfig.mainBkg,
      nodeBorder: themeConfig.nodeBorder,
      clusterBkg: themeConfig.clusterBkg,
      clusterBorder: themeConfig.clusterBorder,
      titleColor: themeConfig.titleColor,
      edgeLabelBackground: themeConfig.edgeLabelBackground,
    };
  }

  return `%%{init: ${JSON.stringify(initPayload)}}%%`;
}

export function injectInitDirectiveIntoCode(code: string, themeConfig: ThemeConfiguration): string {
  const directive = buildInitDirectiveBlock(themeConfig);
  const withoutExisting = code.replace(/^\s*%%\{init:[\s\S]*?\}%%\s*\n?/, '');
  return `${directive}\n${withoutExisting}`;
}

/**
 * Extracts intrinsic SVG dimensions (width & height) from viewBox or width/height attributes.
 */
export function getSvgDimensions(svgString: string): { width: number; height: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
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
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
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
    canvasSurface: 'dark' | 'light';
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
          fallbackOptions.canvasSurface
        );
        return await rasterizeSvgStringToPng(colored.svg, scale, backgroundMode);
      }
    }
    throw firstErr;
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
