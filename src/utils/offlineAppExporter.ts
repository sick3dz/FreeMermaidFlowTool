import { OfflineWorkspaceSeed } from '../types/mermaidStudio';
import { triggerLocalDownload } from './mermaidEngine';

export const STUDIO_STORAGE_KEYS = {
  ACTIVE_CODE: 'mermaid_studio_local_active_code_v3',
  ACTIVE_TITLE: 'mermaid_studio_local_active_title_v3',
  ACTIVE_THEME: 'mermaid_studio_local_active_theme_v2',
  SMART_COLOR_MODE: 'mermaid_studio_local_smart_color_mode_v2',
  HIDDEN_SMART_NODE_TYPES: 'mermaid_studio_local_hidden_smart_node_types_v1',
  CANVAS_SURFACE: 'mermaid_studio_local_canvas_surface_v2',
  SAVED_LIST: 'mermaid_studio_local_saved_diagrams_v1',
  SCRIPT_WORKSPACE: 'mermaid_studio_local_script_workspace_v2',
  WORKSPACE_MODE: 'mermaid_studio_local_workspace_mode_v1',
  APPLIED_OFFLINE_SEED_ID: 'mermaid_studio_offline_applied_seed_id_v1',
} as const;

declare global {
  interface Window {
    __IS_OFFLINE_SINGLEFILE__?: boolean;
    __MERMAID_OFFLINE_SEED__?: OfflineWorkspaceSeed;
  }
}

const memoryStorageFallback = new Map<string, string>();

export function readStudioStorage(key: string): string | null {
  try {
    const val = window.localStorage.getItem(key);
    if (val !== null) return val;
  } catch {
    // Fallback when file:// or restricted browser profile blocks localStorage
  }
  return memoryStorageFallback.get(key) ?? null;
}

export function writeStudioStorage(key: string, value: string): void {
  memoryStorageFallback.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep memory fallback active when localStorage is unavailable or full
  }
}

/**
 * Runs before React mounts so any embedded offline workspace seed populates
 * storage synchronously before initial useState initializers read from it.
 */
export function hydrateOfflineWorkspaceSeed(): void {
  if (typeof window === 'undefined') return;
  const seed = window.__MERMAID_OFFLINE_SEED__;
  if (!seed || typeof seed !== 'object' || !seed.seedId) return;

  const appliedSeedId = readStudioStorage(STUDIO_STORAGE_KEYS.APPLIED_OFFLINE_SEED_ID);
  if (appliedSeedId === seed.seedId) {
    return;
  }

  writeStudioStorage(STUDIO_STORAGE_KEYS.ACTIVE_TITLE, seed.diagramTitle || 'Neuer Callflow');
  writeStudioStorage(STUDIO_STORAGE_KEYS.ACTIVE_CODE, seed.code ?? '');
  writeStudioStorage(STUDIO_STORAGE_KEYS.ACTIVE_THEME, JSON.stringify(seed.themeConfig));
  writeStudioStorage(STUDIO_STORAGE_KEYS.SMART_COLOR_MODE, seed.smartColorMode || 'semantic');
  if (Array.isArray(seed.hiddenSmartNodeTypes)) {
    writeStudioStorage(
      STUDIO_STORAGE_KEYS.HIDDEN_SMART_NODE_TYPES,
      JSON.stringify(seed.hiddenSmartNodeTypes)
    );
  }
  writeStudioStorage(STUDIO_STORAGE_KEYS.CANVAS_SURFACE, seed.canvasSurface || 'dark');
  writeStudioStorage(STUDIO_STORAGE_KEYS.WORKSPACE_MODE, seed.workspaceMode || 'guided');
  writeStudioStorage(
    STUDIO_STORAGE_KEYS.SCRIPT_WORKSPACE,
    JSON.stringify(seed.scriptWorkspace),
  );
  if (Array.isArray(seed.savedDiagrams)) {
    writeStudioStorage(STUDIO_STORAGE_KEYS.SAVED_LIST, JSON.stringify(seed.savedDiagrams));
  }
  writeStudioStorage(STUDIO_STORAGE_KEYS.APPLIED_OFFLINE_SEED_ID, seed.seedId);
}

export function isRunningAsOfflineSingleFile(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.__IS_OFFLINE_SINGLEFILE__) || window.location.protocol === 'file:';
}

function escapeJsonForInlineScript(value: unknown): string {
  // Escapes '<', '>', '&', U+2028, and U+2029 so arbitrary script content can never
  // break out of <script> tags or HTML comments.
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function reconstructHtmlFromActiveOfflineDocument(): string | null {
  if (typeof document === 'undefined') return null;
  const styleEl = document.getElementById('mermaid-offline-app-style');
  const scriptEl = document.getElementById('mermaid-offline-app-script');
  if (!styleEl || !scriptEl) return null;

  const cssText = (styleEl.textContent || '').replace(/<\/(style)/gi, '<\\/$1');
  const jsText = (scriptEl.textContent || '').replace(/<\/(script)/gi, '<\\/$1');
  if (!jsText.trim()) return null;

  const title = document.title || 'MermaidFree2UseOpen';
  const safeTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return [
    '<!doctype html>',
    '<html lang="de" class="dark">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${safeTitle}</title>`,
    `    <style id="mermaid-offline-app-style">\n${cssText}\n</style>`,
    '  </head>',
    '  <body class="bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200 overflow-hidden">',
    '    <div id="root"></div>',
    '    <script id="mermaid-offline-flag">window.__IS_OFFLINE_SINGLEFILE__ = true;</script>',
    '    <!--MERMAID_OFFLINE_SEED_SLOT-->',
    `    <script id="mermaid-offline-app-script">\n${jsText}\n</script>`,
    '  </body>',
    '</html>',
  ].join('\n');
}

function injectWorkspaceSeedIntoOfflineHtml(
  templateHtml: string,
  seed: OfflineWorkspaceSeed,
): string {
  const seedScriptTag = `<script id="mermaid-offline-seed">window.__MERMAID_OFFLINE_SEED__ = ${escapeJsonForInlineScript(
    seed,
  )};</script>`;

  const slotToken = '<!--MERMAID_OFFLINE_SEED_SLOT-->';
  if (templateHtml.includes(slotToken)) {
    return templateHtml.replace(slotToken, () => seedScriptTag);
  }
  const appScriptMarker = '<script id="mermaid-offline-app-script">';
  if (templateHtml.includes(appScriptMarker)) {
    return templateHtml.replace(appScriptMarker, () => `${seedScriptTag}\n    ${appScriptMarker}`);
  }
  return templateHtml.replace('</body>', () => `  ${seedScriptTag}\n  </body>`);
}

export async function buildAndDownloadOfflineApp(options: {
  includeWorkspaceSeed: boolean;
  seed?: Omit<OfflineWorkspaceSeed, 'seedId' | 'exportedAt'>;
  filename?: string;
}): Promise<{ byteSize: number; filename: string }> {
  let baseHtml: string | null = null;

  if (isRunningAsOfflineSingleFile()) {
    baseHtml = reconstructHtmlFromActiveOfflineDocument();
  }

  if (!baseHtml) {
    const response = await fetch('./offline-app.html', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(
        `Offline-Paket konnte nicht geladen werden (HTTP ${response.status}).`,
      );
    }
    const fetchedHtml = await response.text();
    if (!fetchedHtml.includes('mermaid-offline-app-script')) {
      throw new Error(
        'Die abgerufene Offline-Vorlage ist unvollständig. Bitte Build neu ausführen.',
      );
    }
    baseHtml = fetchedHtml;
  }

  let finalHtml = baseHtml;
  if (options.includeWorkspaceSeed && options.seed) {
    const fullSeed: OfflineWorkspaceSeed = {
      ...options.seed,
      seedId: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      exportedAt: new Date().toISOString(),
    };
    finalHtml = injectWorkspaceSeedIntoOfflineHtml(baseHtml, fullSeed);
  } else {
    finalHtml = baseHtml.replace('<!--MERMAID_OFFLINE_SEED_SLOT-->', () => '');
  }

  const filename = options.filename || 'MermaidFree2UseOpen_Offline.html';
  const blob = new Blob([finalHtml], { type: 'text/html;charset=utf-8' });
  triggerLocalDownload(blob, filename);

  return {
    byteSize: blob.size,
    filename,
  };
}
