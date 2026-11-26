import { ScriptModule } from '../types/mermaidStudio';
import {
  buildScriptWorkspace,
  canonicalScriptMatchKey,
  classifyAvayaWaypointTarget,
  detectMasterScriptChecklist,
  isAnnouncementOrEndpointTargetName,
  isValidScriptRef,
  mergeScriptModulesRaw,
  normalizeScriptRef,
  parseCallflowTextWithFallback,
  promoteEntryModuleToMain,
  stripKnownScriptExtension,
} from './scriptCallflowParser';
import { isVisioFilename, parseVisioFileToModules } from './visioParser';

export const CALLFLOW_FILE_ACCEPT =
  '.s,.vsdx,.vdx,.svg,.xml,.txt,.aacc,.csv,.tsv,.md,.log,.cfg';

export const CALLFLOW_CHECKLIST_ACCEPT = '.s,.vsdx,.vdx,.svg,.xml,.txt,.aacc';

export function isAvayaDotSFilename(filename: string): boolean {
  return /\.s$/i.test(filename.trim());
}

export function isSupportedCallflowImportFilename(filename: string): boolean {
  if (isVisioFilename(filename)) return true;
  return /\.(?:s|txt|aacc|csv|tsv|md|log|cfg|xml)$/i.test(filename.trim());
}

/**
 * Decodes uploaded Avaya Orchestration Designer (.s) and text script files robustly.
 * Handles UTF-16 LE/BE BOM, UTF-8 (with or without BOM), and falls back to Windows-1252
 * so German umlauts exported from Windows tools remain intact.
 */
export async function readScriptFileText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return '';

  let decoded = '';

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    decoded = new TextDecoder('utf-16le').decode(bytes.subarray(2));
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    decoded = new TextDecoder('utf-16be').decode(bytes.subarray(2));
  } else if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    decoded = new TextDecoder('utf-8').decode(bytes.subarray(3));
  } else {
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      decoded = new TextDecoder('windows-1252').decode(bytes);
    }
  }

  return decoded.replace(/\u0000/g, '').replace(/\r\n?/g, '\n');
}

export interface DotSHeaderMetadata {
  scriptNumber?: string;
  scriptName?: string;
  cdnAlias?: string;
  description?: string;
  isMasterHint: boolean;
}

/**
 * Extracts header metadata from Avaya Orchestration Designer .s exports
 * (leading block comments, Script Name / Application / CDN hints, and filename patterns)
 * before comment stripping removes them.
 */
export function extractDotSHeaderMetadata(
  rawText: string,
  filename?: string
): DotSHeaderMetadata {
  const headerSlice = rawText.slice(0, 4000);
  const nameFromComment = headerSlice.match(
    /(?:script\s*name|scriptname|application(?:\s*name)?|modul(?:name)?|titel|title)\s*[:=]\s*["']?([^\r\n*/"']{2,80})["']?/i
  )?.[1]?.trim();
  const cdnFromComment = headerSlice.match(
    /(?:^|[\s*/;(])(?:CDN|DNIS|Master[\s_-]*CDN)\s*[:=]\s*["']?(\d{3,6})["']?/im
  )?.[1]?.trim();
  const descFromComment = headerSlice.match(
    /(?:description|beschreibung)\s*[:=]\s*["']?([^\r\n*/]{2,100})["']?/i
  )?.[1]?.trim();

  const cleanBasename = filename
    ? stripKnownScriptExtension(filename)
    : '';
  const numFromFilename = cleanBasename.match(/(?:^|[\s_-])(\d{3,6})(?:$|[\s_-])/)?.[1];
  const looksMasterFile = /\b(?:main|master(?:script)?)\b/i.test(cleanBasename);
  const isDotS = filename ? isAvayaDotSFilename(filename) : false;

  const basenameToken = cleanBasename.replace(/\s+/g, '_');
  const validBasenameRef =
    basenameToken && isValidScriptRef(basenameToken)
      ? normalizeScriptRef(basenameToken)
      : undefined;

  let derivedRef: string | undefined;
  if (looksMasterFile) {
    derivedRef = 'Main';
  } else if (isDotS && validBasenameRef) {
    // In Avaya .s exports, the filename (<Scriptname>.s) is the canonical script identifier
    derivedRef = validBasenameRef;
  } else if (nameFromComment && isValidScriptRef(nameFromComment)) {
    derivedRef = normalizeScriptRef(nameFromComment);
  } else if (validBasenameRef) {
    derivedRef = validBasenameRef;
  } else {
    derivedRef = cdnFromComment || numFromFilename;
  }

  const cdnAliasCandidate = cdnFromComment || numFromFilename;
  const cdnAlias =
    cdnAliasCandidate &&
    (!derivedRef || canonicalScriptMatchKey(cdnAliasCandidate) !== canonicalScriptMatchKey(derivedRef))
      ? cdnAliasCandidate
      : undefined;

  const cleanFilenameLabel = cleanBasename.replace(/[_-]+/g, ' ').trim();
  const derivedName =
    nameFromComment ||
    cleanFilenameLabel ||
    (derivedRef && canonicalScriptMatchKey(derivedRef) === 'main' ? 'Main' : undefined);

  return {
    scriptNumber: derivedRef,
    scriptName: derivedName,
    cdnAlias,
    description: descFromComment,
    isMasterHint:
      looksMasterFile ||
      Boolean(derivedRef && /^(?:main|master(?:script)?|0000)$/i.test(canonicalScriptMatchKey(derivedRef))),
  };
}

export interface ImportedCallflowFileResult {
  modules: ScriptModule[];
  sourceKind: 'visio' | 'aacc-s' | 'text';
  decodedText?: string;
}

export async function importCallflowFile(
  file: File,
  options?: {
    overridePrimaryScriptNumber?: string;
    overridePrimaryScriptName?: string;
    isMasterHint?: boolean;
  }
): Promise<ImportedCallflowFileResult> {
  if (isVisioFilename(file.name)) {
    const rawModules = await parseVisioFileToModules(file, {
      overridePrimaryScriptNumber: options?.overridePrimaryScriptNumber,
    });
    const modules =
      options?.isMasterHint && rawModules.length > 0
        ? promoteEntryModuleToMain(rawModules)
        : rawModules;
    return {
      modules,
      sourceKind: 'visio',
    };
  }

  const decodedText = await readScriptFileText(file);
  const dotSMeta = extractDotSHeaderMetadata(decodedText, file.name);
  const isDotS = isAvayaDotSFilename(file.name);

  const defaultScriptNumber =
    options?.overridePrimaryScriptNumber?.trim() ||
    dotSMeta.scriptNumber;

  const defaultScriptName =
    options?.overridePrimaryScriptName?.trim() ||
    dotSMeta.scriptName;

  let modules = parseCallflowTextWithFallback(decodedText, {
    defaultScriptNumber,
    defaultScriptName,
    sourceFilename: file.name,
    origin: 'legacy-text',
    isMasterHint: options?.isMasterHint ?? dotSMeta.isMasterHint,
  }).map((mod, idx, allMods) => {
    const withSource =
      (allMods.length === 1 || isDotS) && !mod.sourceFilename
        ? { ...mod, sourceFilename: file.name }
        : mod;
    if (idx === 0 && dotSMeta.cdnAlias && !withSource.cdnAlias) {
      return {
        ...withSource,
        cdnAlias: dotSMeta.cdnAlias,
      };
    }
    return withSource;
  });

  // Guarantee 1:1 registration for any existing Avaya .s file (even empty or comment-only files)
  if (modules.length === 0 && isDotS) {
    const fallbackRef =
      normalizeScriptRef(defaultScriptNumber || stripKnownScriptExtension(file.name)) ||
      stripKnownScriptExtension(file.name) ||
      file.name;
    const fallbackName = defaultScriptName || stripKnownScriptExtension(file.name) || fallbackRef;
    const isAnn =
      isAnnouncementOrEndpointTargetName(fallbackRef) ||
      isAnnouncementOrEndpointTargetName(fallbackName);
    modules = [
      {
        scriptNumber: options?.isMasterHint ? 'Main' : fallbackRef,
        scriptName: options?.isMasterHint ? 'Main' : fallbackName,
        cdnAlias:
          options?.isMasterHint && canonicalScriptMatchKey(fallbackRef) !== 'main'
            ? fallbackRef
            : dotSMeta.cdnAlias,
        isMaster: Boolean(options?.isMasterHint || dotSMeta.isMasterHint),
        isAnnouncementEndpoint: isAnn || undefined,
        origin: 'legacy-text',
        sourceFilename: file.name,
        rawText: decodedText,
        rules: [
          {
            id: `${fallbackRef}-empty-1`,
            prio: 1,
            stepName: isAnn
              ? `Sonderansage / Endpunkt (${fallbackName})`
              : `Skript (${fallbackName})`,
            sourceNumber: options?.isMasterHint ? 'Main' : fallbackRef,
            announcement: isAnn ? fallbackName : undefined,
            isDisconnect: true,
            choices: [],
            rawLine: decodedText.trim().split(/\r?\n/)[0]?.trim() || file.name,
          },
        ],
        outgoingNumbers: [],
      },
    ];
  }

  return {
    modules,
    sourceKind: isDotS ? 'aacc-s' : 'text',
    decodedText,
  };
}

export interface FolderScriptFileEntry {
  file: File;
  filename: string;
  baseName: string;
  canonicalKey: string;
  relativePath: string;
  isDotS: boolean;
}

export interface FolderScriptPool {
  folderName: string;
  totalFilesScanned: number;
  entries: FolderScriptFileEntry[];
  byCanonicalKey: Map<string, FolderScriptFileEntry>;
  byNormalizedAlias: Map<string, FolderScriptFileEntry>;
}

export interface FolderMatchedEntry {
  refKey: string;
  filename: string;
  scriptNumber: string;
  relativePath: string;
}

export interface FolderUnusedFileEntry {
  filename: string;
  baseName: string;
  relativePath: string;
}

export interface FolderAutoResolveSummary {
  mode?: 'all' | 'connected';
  modules: ScriptModule[];
  loadedScriptNumbers: string[];
  loadedFilenames: string[];
  matchedEntries: FolderMatchedEntry[];
  unmatchedTargetRefs: string[];
  unusedFolderFiles: FolderUnusedFileEntry[];
  standaloneScriptNumbers?: string[];
  connectedScriptCount?: number;
  unreadableFilenames?: string[];
  totalPoolFiles: number;
  skippedLegacyFilesCount: number;
  folderName: string;
}

/**
 * Indexes all supported script files (.s, .txt, .aacc, .vsdx) from an assigned folder
 * without eagerly parsing all 600+ files. Prioritizes .s files when basenames collide.
 */
export function indexScriptFolderFiles(files: FileList | File[]): FolderScriptPool {
  const rawArr = Array.from(files);
  let detectedFolderName = '';

  const supportedFiles = rawArr.filter((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    if (!detectedFolderName && rel.includes('/')) {
      detectedFolderName = rel.split('/')[0].trim();
    }
    return isSupportedCallflowImportFilename(file.name);
  });

  // Sort so .s files come first and shorter/exact basenames take precedence
  const sorted = [...supportedFiles].sort((a, b) => {
    const aDotS = isAvayaDotSFilename(a.name) ? 0 : 1;
    const bDotS = isAvayaDotSFilename(b.name) ? 0 : 1;
    if (aDotS !== bDotS) return aDotS - bDotS;
    return a.name.length - b.name.length;
  });

  const entries: FolderScriptFileEntry[] = [];
  const byCanonicalKey = new Map<string, FolderScriptFileEntry>();
  const byNormalizedAlias = new Map<string, FolderScriptFileEntry>();

  for (const file of sorted) {
    const filename = file.name.trim();
    const baseName = stripKnownScriptExtension(filename);
    if (!baseName) continue;
    const canonicalKey = canonicalScriptMatchKey(baseName);
    if (!canonicalKey) continue;

    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || filename;
    const entry: FolderScriptFileEntry = {
      file,
      filename,
      baseName,
      canonicalKey,
      relativePath: rel,
      isDotS: isAvayaDotSFilename(filename),
    };

    entries.push(entry);

    if (!byCanonicalKey.has(canonicalKey)) {
      byCanonicalKey.set(canonicalKey, entry);
      byNormalizedAlias.set(canonicalKey, entry);
    }
  }

  return {
    folderName: detectedFolderName || 'Skript-Ordner',
    totalFilesScanned: entries.length,
    entries,
    byCanonicalKey,
    byNormalizedAlias,
  };
}

/**
 * Looks up `<Scriptname>.s` strictly by canonical filename key (spaces normalized to `_`,
 * case-insensitive, only known file extensions stripped — never fuzzy `_alt`/`_v2` or bare digit collisions).
 */
export function findMatchingFileInFolderPool(
  pool: FolderScriptPool,
  targetRef: string
): FolderScriptFileEntry | null {
  const cleanRef = stripKnownScriptExtension(targetRef);
  if (!cleanRef) return null;

  const exactKey = canonicalScriptMatchKey(cleanRef);
  if (exactKey && pool.byCanonicalKey.has(exactKey)) {
    return pool.byCanonicalKey.get(exactKey)!;
  }

  return null;
}

/**
 * Locates an explicit Main / Master entry script in an assigned folder pool
 * (e.g. `Main.s`, `Master.s`, `Masterscript.s`) so empty-studio folder imports
 * can start recursive connected resolution without dumping unused legacy files.
 */
export function findEntryMainFileInFolderPool(
  pool: FolderScriptPool
): FolderScriptFileEntry | null {
  if (!pool || pool.entries.length === 0) return null;

  // Priority 1: exact canonical match for main / master / masterscript
  for (const exactKey of ['main', 'master', 'masterscript', 'master_routing']) {
    const hit = pool.byCanonicalKey.get(exactKey);
    if (hit) return hit;
  }

  // Priority 2: .s file whose basename contains explicit main/master token
  const explicitMatch = pool.entries.find((e) =>
    /(?:^|[_.\-\s])(?:main|master(?:script)?)(?:$|[_.\-\s])/i.test(e.baseName)
  );
  return explicitMatch || null;
}

/**
 * Recursively resolves and loads only those `<Scriptname>.s` files from the assigned
 * folder that are actually referenced along the callflow chain starting from `initialModules`.
 * Unreferenced legacy ("Altlast") files in the 600+ file folder are skipped automatically.
 */
export async function autoResolveConnectedScriptsFromFolder(
  initialModules: ScriptModule[],
  pool: FolderScriptPool,
  options?: {
    externalEndpoints?: string[];
    avayaWaypoints?: string[];
    ignoredChecklistTargets?: string[];
    masterScriptNumber?: string;
    treatUnresolvedAsEndpoint?: boolean;
    onProgress?: (loaded: number, total: number) => void;
  }
): Promise<FolderAutoResolveSummary> {
  let currentModules = [...initialModules];
  const externalSet = new Set(
    (options?.externalEndpoints || []).map((t) => canonicalScriptMatchKey(t))
  );
  const ignoredSet = new Set(
    (options?.ignoredChecklistTargets || []).map((t) => canonicalScriptMatchKey(t))
  );

  const attemptedRefKeys = new Set<string>();
  const loadedFilesSet = new Set<string>();
  const loadedCanonicalKeysSet = new Set<string>();
  const loadedScriptNumbers: string[] = [];
  const loadedFilenames: string[] = [];
  const matchedEntries: FolderMatchedEntry[] = [];
  const matchedEntryKeys = new Set<string>();
  const unmatchedTargetRefsMap = new Map<string, string>();

  // Mark already-loaded modules (including Master script) so they are not flagged as unused folder files
  for (const mod of currentModules) {
    if (mod.sourceFilename) {
      loadedFilesSet.add(mod.sourceFilename.toLowerCase());
      loadedCanonicalKeysSet.add(canonicalScriptMatchKey(stripKnownScriptExtension(mod.sourceFilename)));
    }
    loadedCanonicalKeysSet.add(canonicalScriptMatchKey(mod.scriptNumber));
    if (mod.cdnAlias) {
      loadedCanonicalKeysSet.add(canonicalScriptMatchKey(mod.cdnAlias));
    }
  }

  options?.onProgress?.(0, Math.max(1, pool.entries.length));

  let safetyRounds = 0;
  const MAX_ROUNDS = 450;

  while (safetyRounds < MAX_ROUNDS) {
    safetyRounds++;

    const presentKeys = new Set<string>();
    for (const m of currentModules) {
      presentKeys.add(canonicalScriptMatchKey(m.scriptNumber));
      if (m.sourceFilename) {
        presentKeys.add(canonicalScriptMatchKey(stripKnownScriptExtension(m.sourceFilename)));
      }
      if (m.cdnAlias) {
        presentKeys.add(canonicalScriptMatchKey(m.cdnAlias));
      }
    }

    const checklistState = detectMasterScriptChecklist(
      currentModules,
      options?.externalEndpoints || [],
      [],
      options?.masterScriptNumber,
      options?.ignoredChecklistTargets || [],
      options?.avayaWaypoints || []
    );

    const pendingTargets: string[] = [];
    const seenInRound = new Set<string>();

    const enqueueCandidate = (rawRef?: string) => {
      if (!rawRef) return;
      const clean = normalizeScriptRef(rawRef);
      if (!clean) return;
      const key = canonicalScriptMatchKey(clean);
      if (!key) return;
      if (presentKeys.has(key) || ignoredSet.has(key)) return;
      // Only skip externalSet if no matching .s file exists in the folder pool
      if (externalSet.has(key) && !findMatchingFileInFolderPool(pool, clean)) return;
      if (attemptedRefKeys.has(key) || seenInRound.has(key)) return;
      seenInRound.add(key);
      pendingTargets.push(clean);
    };

    // 1. All missing, waypoint, or external items from the recursive Masterscript checklist
    // (real .s files in the folder ALWAYS take precedence over waypoint/endpoint heuristics!)
    for (const item of checklistState.masterChecklist) {
      if (item.status === 'missing' || item.status === 'waypoint' || item.status === 'external') {
        enqueueCandidate(item.refKey);
      }
    }

    // 2. Any outgoing script references on loaded modules
    for (const mod of currentModules) {
      for (const outRef of mod.outgoingNumbers) {
        enqueueCandidate(outRef);
      }
      for (const rule of mod.rules) {
        if (rule.targetNumber) {
          enqueueCandidate(rule.targetNumber);
        }
        for (const ch of rule.choices) {
          if (ch.targetNumber) {
            enqueueCandidate(ch.targetNumber);
          }
        }
      }
    }

    if (pendingTargets.length === 0) {
      break;
    }

    let loadedAnyInThisRound = false;

    for (const targetRef of pendingTargets) {
      const targetKey = canonicalScriptMatchKey(targetRef);
      attemptedRefKeys.add(targetKey);

      const matchedEntry = findMatchingFileInFolderPool(pool, targetRef);
      if (!matchedEntry) {
        if (
          isValidScriptRef(targetRef) &&
          !isAnnouncementOrEndpointTargetName(targetRef) &&
          !classifyAvayaWaypointTarget(targetRef)
        ) {
          unmatchedTargetRefsMap.set(targetKey, targetRef);
        }
        continue;
      }

      try {
        const canonicalPrimaryNumber = normalizeScriptRef(matchedEntry.baseName) || targetRef;
        const imported = await importCallflowFile(matchedEntry.file, {
          overridePrimaryScriptNumber: canonicalPrimaryNumber,
          overridePrimaryScriptName: matchedEntry.baseName || targetRef,
          isMasterHint: false,
        });

        if (imported.modules.length > 0) {
          currentModules = mergeScriptModulesRaw(currentModules, imported.modules);
          loadedAnyInThisRound = true;
          unmatchedTargetRefsMap.delete(targetKey);

          for (const m of imported.modules) {
            if (!loadedScriptNumbers.includes(m.scriptNumber)) {
              loadedScriptNumbers.push(m.scriptNumber);
            }
          }
          const lowerFile = matchedEntry.filename.toLowerCase();
          if (!loadedFilesSet.has(lowerFile)) {
            loadedFilesSet.add(lowerFile);
            loadedFilenames.push(matchedEntry.filename);
          }
          loadedCanonicalKeysSet.add(matchedEntry.canonicalKey);
          if (!matchedEntryKeys.has(targetKey)) {
            matchedEntryKeys.add(targetKey);
            matchedEntries.push({
              refKey: targetRef,
              filename: matchedEntry.filename,
              scriptNumber: imported.modules[0].scriptNumber,
              relativePath: matchedEntry.relativePath,
            });
          }
          options?.onProgress?.(loadedFilenames.length, Math.max(loadedFilenames.length, pendingTargets.length));
        } else {
          unmatchedTargetRefsMap.set(targetKey, targetRef);
        }
      } catch {
        unmatchedTargetRefsMap.set(targetKey, targetRef);
      }
    }

    if (!loadedAnyInThisRound) {
      break;
    }
  }

  // Run a single O(N) normalization pass once all rounds complete
  const normalizedWorkspace = buildScriptWorkspace(currentModules, {
    externalEndpoints: options?.externalEndpoints,
    avayaWaypoints: options?.avayaWaypoints,
    ignoredChecklistTargets: options?.ignoredChecklistTargets,
    masterScriptNumber: options?.masterScriptNumber,
    treatUnresolvedAsEndpoint: options?.treatUnresolvedAsEndpoint ?? false,
  });
  currentModules = normalizedWorkspace.modules;

  const finalPresentKeys = new Set<string>();
  for (const m of currentModules) {
    finalPresentKeys.add(canonicalScriptMatchKey(m.scriptNumber));
    if (m.sourceFilename) {
      finalPresentKeys.add(canonicalScriptMatchKey(stripKnownScriptExtension(m.sourceFilename)));
    }
    if (m.cdnAlias) {
      finalPresentKeys.add(canonicalScriptMatchKey(m.cdnAlias));
    }
  }
  const unmatchedTargetRefs = Array.from(unmatchedTargetRefsMap.entries())
    .filter(([k]) => !finalPresentKeys.has(k))
    .map(([, ref]) => ref);

  const unusedFolderFiles: FolderUnusedFileEntry[] = pool.entries
    .filter(
      (entry) =>
        !loadedFilesSet.has(entry.filename.toLowerCase()) &&
        !loadedCanonicalKeysSet.has(entry.canonicalKey) &&
        !finalPresentKeys.has(entry.canonicalKey)
    )
    .map((entry) => ({
      filename: entry.filename,
      baseName: entry.baseName,
      relativePath: entry.relativePath,
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));

  const skippedLegacyFilesCount = unusedFolderFiles.length;

  return {
    mode: 'connected',
    modules: currentModules,
    loadedScriptNumbers,
    loadedFilenames,
    matchedEntries,
    unmatchedTargetRefs,
    unusedFolderFiles,
    connectedScriptCount: loadedScriptNumbers.length,
    standaloneScriptNumbers: [],
    totalPoolFiles: pool.totalFilesScanned,
    skippedLegacyFilesCount,
    folderName: pool.folderName,
  };
}

/**
 * Loads and parses ALL supported script files (.s prioritized) from an assigned folder in
 * non-blocking batches, binds every single .s file 1:1 under its canonical basename, merges in O(N),
 * and embeds all modules cleanly into the workspace and Master diagram.
 */
export async function loadAllScriptsFromFolder(
  initialModules: ScriptModule[],
  pool: FolderScriptPool,
  options?: {
    externalEndpoints?: string[];
    avayaWaypoints?: string[];
    ignoredChecklistTargets?: string[];
    masterScriptNumber?: string;
    onProgress?: (loaded: number, total: number) => void;
    batchSize?: number;
  }
): Promise<FolderAutoResolveSummary> {
  const existingKeys = new Set<string>();
  for (const m of initialModules) {
    existingKeys.add(canonicalScriptMatchKey(m.scriptNumber));
    if (m.sourceFilename) {
      existingKeys.add(canonicalScriptMatchKey(stripKnownScriptExtension(m.sourceFilename)));
    }
    if (m.cdnAlias) {
      existingKeys.add(canonicalScriptMatchKey(m.cdnAlias));
    }
  }

  // Deduplicate by canonicalKey so .s files take precedence over duplicate .txt/.aacc basenames
  const uniqueEntries: FolderScriptFileEntry[] = [];
  const seenEntryKeys = new Set<string>();
  for (const entry of pool.entries) {
    if (!entry.canonicalKey || seenEntryKeys.has(entry.canonicalKey)) continue;
    seenEntryKeys.add(entry.canonicalKey);
    uniqueEntries.push(entry);
  }

  const total = uniqueEntries.length;
  const batchSize = Math.max(5, options?.batchSize ?? 25);
  const parsedIncoming: ScriptModule[] = [];
  const loadedScriptNumbers: string[] = [];
  const loadedFilenames: string[] = [];
  const matchedEntries: FolderMatchedEntry[] = [];
  const unreadableFilenames: string[] = [];

  options?.onProgress?.(0, total);

  for (let i = 0; i < uniqueEntries.length; i += batchSize) {
    const batch = uniqueEntries.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        // Keep already-loaded Main / edited module intact if the same file is already in initialModules
        if (existingKeys.has(entry.canonicalKey)) {
          return { entry, skippedAlreadyPresent: true as const, modules: [] as ScriptModule[] };
        }
        try {
          const canonicalPrimaryNumber = normalizeScriptRef(entry.baseName) || entry.baseName;
          const imported = await importCallflowFile(entry.file, {
            overridePrimaryScriptNumber: canonicalPrimaryNumber,
            overridePrimaryScriptName: entry.baseName,
            isMasterHint: false,
          });
          return {
            entry,
            skippedAlreadyPresent: false as const,
            modules: imported.modules,
            failed: imported.modules.length === 0,
          };
        } catch {
          return {
            entry,
            skippedAlreadyPresent: false as const,
            modules: [] as ScriptModule[],
            failed: true,
          };
        }
      })
    );

    for (const res of batchResults) {
      if (res.skippedAlreadyPresent) continue;
      if (res.modules.length > 0) {
        parsedIncoming.push(...res.modules);
        loadedFilenames.push(res.entry.filename);
        for (const m of res.modules) {
          if (!loadedScriptNumbers.includes(m.scriptNumber)) {
            loadedScriptNumbers.push(m.scriptNumber);
          }
        }
        matchedEntries.push({
          refKey: res.entry.baseName,
          filename: res.entry.filename,
          scriptNumber: res.modules[0].scriptNumber,
          relativePath: res.entry.relativePath,
        });
      } else if (res.failed) {
        unreadableFilenames.push(res.entry.filename);
      }
    }

    const processed = Math.min(total, i + batch.length);
    options?.onProgress?.(processed, total);

    // Yield to browser event loop between batches so the UI stays fluid for 600+ files
    if (processed < total) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  let mergedRaw = mergeScriptModulesRaw(initialModules, parsedIncoming);

  // If the studio was empty and the folder contains a Main / Master script, promote it cleanly
  let effectiveMasterNumber = options?.masterScriptNumber;
  if (initialModules.length === 0 && mergedRaw.length > 0) {
    const explicitMain = mergedRaw.find(
      (m) =>
        /^(?:main|master(?:script)?)$/i.test(canonicalScriptMatchKey(m.scriptNumber)) ||
        (m.sourceFilename &&
          /\b(?:main|master(?:script)?)\b/i.test(stripKnownScriptExtension(m.sourceFilename))) ||
        m.isMaster
    );
    if (explicitMain) {
      mergedRaw = promoteEntryModuleToMain(mergedRaw, explicitMain.scriptNumber);
      effectiveMasterNumber = 'Main';
    }
  }

  const finalWorkspace = buildScriptWorkspace(mergedRaw, {
    externalEndpoints: options?.externalEndpoints,
    avayaWaypoints: options?.avayaWaypoints,
    ignoredChecklistTargets: options?.ignoredChecklistTargets,
    masterScriptNumber: effectiveMasterNumber,
    treatUnresolvedAsEndpoint: false,
  });

  // Compute which loaded modules are connected to Main/chain vs. standalone scripts in the folder
  const connectedKeys = new Set<string>();
  const masterKey = finalWorkspace.masterScriptNumber
    ? canonicalScriptMatchKey(finalWorkspace.masterScriptNumber)
    : '';
  if (masterKey) connectedKeys.add(masterKey);

  const checklist = finalWorkspace.masterChecklist || [];
  for (const item of checklist) {
    if (item.status === 'present') {
      connectedKeys.add(canonicalScriptMatchKey(item.refKey));
      if (item.matchedModuleNumber) {
        connectedKeys.add(canonicalScriptMatchKey(item.matchedModuleNumber));
      }
    }
  }
  // Also count modules with incoming or outgoing script links as connected
  const incomingCounts = new Map<string, number>();
  for (const m of finalWorkspace.modules) {
    for (const outRef of m.outgoingNumbers) {
      const k = canonicalScriptMatchKey(outRef);
      incomingCounts.set(k, (incomingCounts.get(k) || 0) + 1);
    }
  }

  const standaloneScriptNumbers: string[] = [];
  let connectedScriptCount = 0;

  for (const m of finalWorkspace.modules) {
    const k = canonicalScriptMatchKey(m.scriptNumber);
    if (k === masterKey) continue;
    const isConnected =
      connectedKeys.has(k) ||
      (incomingCounts.get(k) || 0) > 0 ||
      m.outgoingNumbers.length > 0;
    if (isConnected) {
      connectedScriptCount++;
    } else {
      standaloneScriptNumbers.push(m.scriptNumber);
    }
  }

  const unmatchedTargetRefs = finalWorkspace.missingTargets.filter(
    (ref) =>
      !isAnnouncementOrEndpointTargetName(ref) && !classifyAvayaWaypointTarget(ref)
  );

  return {
    mode: 'all',
    modules: finalWorkspace.modules,
    loadedScriptNumbers,
    loadedFilenames,
    matchedEntries,
    unmatchedTargetRefs,
    unusedFolderFiles: [],
    standaloneScriptNumbers,
    connectedScriptCount,
    unreadableFilenames: unreadableFilenames.length > 0 ? unreadableFilenames : undefined,
    totalPoolFiles: uniqueEntries.length,
    skippedLegacyFilesCount: 0,
    folderName: pool.folderName,
  };
}

/**
 * Extracts all files from a DragEvent DataTransfer, recursively traversing dropped folders
 * (via webkitGetAsEntry) when the user drags an entire script directory onto the app.
 */
export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<{ files: File[]; hasDirectory: boolean }> {
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  const webkitEntries = items
    .map((item) =>
      typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    )
    .filter((entry): entry is FileSystemEntry => Boolean(entry));

  const hasDirectory = webkitEntries.some((entry) => entry.isDirectory);
  if (!hasDirectory || webkitEntries.length === 0) {
    return {
      files: Array.from(dataTransfer.files || []),
      hasDirectory: false,
    };
  }

  const collected: File[] = [];

  const traverseEntry = async (entry: FileSystemEntry, pathPrefix = ''): Promise<void> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File | null>((resolve) => {
        fileEntry.file(
          (f) => {
            try {
              if (pathPrefix && !f.webkitRelativePath) {
                Object.defineProperty(f, 'webkitRelativePath', {
                  value: `${pathPrefix}${f.name}`,
                  configurable: true,
                });
              }
            } catch {
              // ignore readonly property
            }
            resolve(f);
          },
          () => resolve(null)
        );
      });
      if (file) collected.push(file);
      return;
    }

    if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const childEntries: FileSystemEntry[] = [];

      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) => {
          reader.readEntries(
            (entriesBatch) => resolve(entriesBatch || []),
            () => resolve([])
          );
        });
        if (batch.length === 0) break;
        childEntries.push(...batch);
      }

      const nextPrefix = `${pathPrefix}${dirEntry.name}/`;
      for (const child of childEntries) {
        await traverseEntry(child, nextPrefix);
      }
    }
  };

  for (const entry of webkitEntries) {
    await traverseEntry(entry, '');
  }

  return {
    files: collected.length > 0 ? collected : Array.from(dataTransfer.files || []),
    hasDirectory: true,
  };
}

