import {
  OfflineWorkspaceSeed,
  SavedDiagram,
  ScriptWorkspace,
  SmartColorMode,
  SmartColorNodeType,
  ThemeConfiguration,
} from '../types/mermaidStudio';
import { DEFAULT_THEME_CONFIG } from '../data/mermaidTemplates';
import { buildScriptWorkspace } from './scriptCallflowParser';
import { triggerLocalDownload } from './mermaidEngine';

export const STUDIO_STORAGE_KEYS = {
  ACTIVE_CODE: 'mermaid_studio_local_active_code_v3',
  ACTIVE_TITLE: 'mermaid_studio_local_active_title_v3',
  ACTIVE_THEME: 'mermaid_studio_local_active_theme_v2',
  SMART_COLOR_MODE: 'mermaid_studio_local_smart_color_mode_v2',
  PATH_COLOR_MODE: 'mermaid_studio_local_path_color_mode_v1',
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

export interface CachedStudioProjectSummary {
  hasProjectData: boolean;
  diagramTitle: string;
  moduleCount: number;
  savedDiagramCount: number;
  activeCodeLength: number;
  updatedAt: number | null;
  seedPayload: Omit<OfflineWorkspaceSeed, 'seedId' | 'exportedAt' | 'initialShellView'>;
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function seedHasProjectContent(
  seed: Pick<OfflineWorkspaceSeed, 'code' | 'scriptWorkspace' | 'savedDiagrams'> | null | undefined
): boolean {
  if (!seed) return false;
  const hasModules = Boolean(seed.scriptWorkspace?.modules && seed.scriptWorkspace.modules.length > 0);
  const hasCode = Boolean(seed.code && seed.code.trim().length > 0);
  const hasSaved = Boolean(seed.savedDiagrams && seed.savedDiagrams.length > 0);
  return hasModules || hasCode || hasSaved;
}

export function inspectCachedStudioProject(): CachedStudioProjectSummary {
  if (typeof window === 'undefined') {
    return {
      hasProjectData: false,
      diagramTitle: 'Neuer Callflow',
      moduleCount: 0,
      savedDiagramCount: 0,
      activeCodeLength: 0,
      updatedAt: null,
      seedPayload: {
        diagramTitle: 'Neuer Callflow',
        code: '',
        themeConfig: DEFAULT_THEME_CONFIG,
        smartColorMode: 'semantic',
        hiddenSmartNodeTypes: [],
        canvasSurface: 'dark',
        workspaceMode: 'guided',
        scriptWorkspace: buildScriptWorkspace([]),
        savedDiagrams: [],
      },
    };
  }

  const parsedWorkspace = safeParseJson<Partial<ScriptWorkspace>>(
    readStudioStorage(STUDIO_STORAGE_KEYS.SCRIPT_WORKSPACE)
  );
  const scriptWorkspace =
    parsedWorkspace && Array.isArray(parsedWorkspace.modules)
      ? buildScriptWorkspace(parsedWorkspace.modules, parsedWorkspace)
      : buildScriptWorkspace([]);

  const activeCode = readStudioStorage(STUDIO_STORAGE_KEYS.ACTIVE_CODE) ?? '';
  const diagramTitle = readStudioStorage(STUDIO_STORAGE_KEYS.ACTIVE_TITLE) || 'Neuer Callflow';

  const parsedTheme = safeParseJson<ThemeConfiguration>(
    readStudioStorage(STUDIO_STORAGE_KEYS.ACTIVE_THEME)
  );
  const themeConfig = parsedTheme
    ? { ...DEFAULT_THEME_CONFIG, ...parsedTheme }
    : DEFAULT_THEME_CONFIG;

  const smartColorRaw = readStudioStorage(STUDIO_STORAGE_KEYS.SMART_COLOR_MODE);
  const smartColorMode: SmartColorMode =
    smartColorRaw === 'clusters' ? 'clusters' : 'semantic';

  const hiddenTypesRaw = safeParseJson<SmartColorNodeType[]>(
    readStudioStorage(STUDIO_STORAGE_KEYS.HIDDEN_SMART_NODE_TYPES)
  );
  const hiddenSmartNodeTypes = Array.isArray(hiddenTypesRaw) ? hiddenTypesRaw : [];

  const canvasSurface: 'dark' | 'light' =
    readStudioStorage(STUDIO_STORAGE_KEYS.CANVAS_SURFACE) === 'light' ? 'light' : 'dark';

  const workspaceMode: 'guided' | 'free' =
    readStudioStorage(STUDIO_STORAGE_KEYS.WORKSPACE_MODE) === 'free' ? 'free' : 'guided';

  const parsedSaved = safeParseJson<SavedDiagram[]>(
    readStudioStorage(STUDIO_STORAGE_KEYS.SAVED_LIST)
  );
  const savedDiagrams = Array.isArray(parsedSaved) ? parsedSaved : [];

  const moduleCount = scriptWorkspace.modules.length;
  const savedDiagramCount = savedDiagrams.length;
  const activeCodeLength = activeCode.trim().length;
  const hasProjectData = moduleCount > 0 || savedDiagramCount > 0 || activeCodeLength > 0;
  const updatedAt =
    typeof scriptWorkspace.updatedAt === 'number' && scriptWorkspace.updatedAt > 0
      ? scriptWorkspace.updatedAt
      : savedDiagrams[0]?.updatedAt ?? null;

  return {
    hasProjectData,
    diagramTitle,
    moduleCount,
    savedDiagramCount,
    activeCodeLength,
    updatedAt,
    seedPayload: {
      diagramTitle,
      code: activeCode,
      themeConfig,
      smartColorMode,
      hiddenSmartNodeTypes,
      canvasSurface,
      workspaceMode,
      scriptWorkspace,
      savedDiagrams,
    },
  };
}

/**
 * Runs before React mounts so any embedded offline workspace seed populates
 * storage synchronously before initial useState initializers read from it.
 * Empty seeds never overwrite an already cached project in browser storage.
 */
export function hydrateOfflineWorkspaceSeed(): void {
  if (typeof window === 'undefined') return;
  const seed = window.__MERMAID_OFFLINE_SEED__;
  if (!seed || typeof seed !== 'object' || !seed.seedId) return;

  const appliedSeedId = readStudioStorage(STUDIO_STORAGE_KEYS.APPLIED_OFFLINE_SEED_ID);
  if (appliedSeedId === seed.seedId) {
    return;
  }

  const existingCache = inspectCachedStudioProject();
  const incomingHasData = seedHasProjectContent(seed);

  // Protect existing local browser cache from accidental wipe by an empty starter seed
  if (incomingHasData || !existingCache.hasProjectData) {
    writeStudioStorage(STUDIO_STORAGE_KEYS.ACTIVE_TITLE, seed.diagramTitle || 'Neuer Callflow');
    writeStudioStorage(STUDIO_STORAGE_KEYS.ACTIVE_CODE, seed.code ?? '');
    writeStudioStorage(
      STUDIO_STORAGE_KEYS.SCRIPT_WORKSPACE,
      JSON.stringify(seed.scriptWorkspace),
    );
    if (Array.isArray(seed.savedDiagrams)) {
      writeStudioStorage(STUDIO_STORAGE_KEYS.SAVED_LIST, JSON.stringify(seed.savedDiagrams));
    }
  }

  if (seed.themeConfig && (incomingHasData || !readStudioStorage(STUDIO_STORAGE_KEYS.ACTIVE_THEME))) {
    writeStudioStorage(STUDIO_STORAGE_KEYS.ACTIVE_THEME, JSON.stringify(seed.themeConfig));
  }
  if (incomingHasData || !readStudioStorage(STUDIO_STORAGE_KEYS.SMART_COLOR_MODE)) {
    writeStudioStorage(STUDIO_STORAGE_KEYS.SMART_COLOR_MODE, seed.smartColorMode || 'semantic');
  }
  if (
    Array.isArray(seed.hiddenSmartNodeTypes) &&
    (incomingHasData || !readStudioStorage(STUDIO_STORAGE_KEYS.HIDDEN_SMART_NODE_TYPES))
  ) {
    writeStudioStorage(
      STUDIO_STORAGE_KEYS.HIDDEN_SMART_NODE_TYPES,
      JSON.stringify(seed.hiddenSmartNodeTypes)
    );
  }
  if (incomingHasData || !readStudioStorage(STUDIO_STORAGE_KEYS.CANVAS_SURFACE)) {
    writeStudioStorage(STUDIO_STORAGE_KEYS.CANVAS_SURFACE, seed.canvasSurface || 'dark');
  }
  if (incomingHasData || !readStudioStorage(STUDIO_STORAGE_KEYS.WORKSPACE_MODE)) {
    writeStudioStorage(STUDIO_STORAGE_KEYS.WORKSPACE_MODE, seed.workspaceMode || 'guided');
  }

  writeStudioStorage(STUDIO_STORAGE_KEYS.APPLIED_OFFLINE_SEED_ID, seed.seedId);
}

export function isRunningAsOfflineSingleFile(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.__IS_OFFLINE_SINGLEFILE__) || window.location.protocol === 'file:';
}

export function getInitialOfflineShellView(): 'builder' | 'studio' {
  if (typeof window !== 'undefined' && window.__MERMAID_OFFLINE_SEED__?.initialShellView === 'studio') {
    return 'studio';
  }
  return 'builder';
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
    '  <body class="bg-slate-950 text-slate-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">',
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
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId =
      controller && typeof window !== 'undefined'
        ? window.setTimeout(() => controller.abort(), 45000)
        : null;
    let response: Response;
    try {
      response = await fetch('./offline-app.html', {
        cache: 'no-store',
        signal: controller?.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(
          'Zeitüberschreitung beim Zusammenstellen von offline-app.html (über 45 Sek.). Bitte erneut versuchen.'
        );
      }
      throw err;
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }
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
