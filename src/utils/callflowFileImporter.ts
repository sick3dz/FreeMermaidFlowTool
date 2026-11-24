import { ScriptModule } from '../types/mermaidStudio';
import {
  canonicalScriptMatchKey,
  classifyAvayaWaypointTarget,
  detectMasterScriptChecklist,
  isAnnouncementOrEndpointTargetName,
  isValidScriptRef,
  mergeScriptModules,
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

  const modules = parseCallflowTextWithFallback(decodedText, {
    defaultScriptNumber,
    defaultScriptName,
    sourceFilename: file.name,
    origin: 'legacy-text',
    isMasterHint: options?.isMasterHint ?? dotSMeta.isMasterHint,
  }).map((mod, idx, allMods) => {
    const withSource =
      allMods.length === 1 && !mod.sourceFilename
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
  modules: ScriptModule[];
  loadedScriptNumbers: string[];
  loadedFilenames: string[];
  matchedEntries: FolderMatchedEntry[];
  unmatchedTargetRefs: string[];
  unusedFolderFiles: FolderUnusedFileEntry[];
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
 * Recursively resolves and loads only those `<Scriptname>.s` files from the assigned
 * folder that are actually referenced along the callflow chain starting from `initialModules`.
 * Unreferenced legacy ("Altlast") files in the 600+ file folder are skipped automatically.
 */
export async function autoResolveConnectedScriptsFromFolder(
  initialModules: ScriptModule[],
  pool: FolderScriptPool,
  options?: {
    externalEndpoints?: string[];
    ignoredChecklistTargets?: string[];
    masterScriptNumber?: string;
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
      [],
      [],
      options?.masterScriptNumber,
      options?.ignoredChecklistTargets || []
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

    // 1. All missing or waypoint-classified items from the recursive Masterscript checklist
    // (waypoint names like flow_2 or FlixCheck.V2 must still load if a real .s file exists in the folder!)
    for (const item of checklistState.masterChecklist) {
      if (item.status === 'missing' || item.status === 'waypoint') {
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
          currentModules = mergeScriptModules(currentModules, imported.modules);
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
    modules: currentModules,
    loadedScriptNumbers,
    loadedFilenames,
    matchedEntries,
    unmatchedTargetRefs,
    unusedFolderFiles,
    totalPoolFiles: pool.totalFilesScanned,
    skippedLegacyFilesCount,
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

