import { ScriptModule } from '../types/mermaidStudio';
import {
  canonicalScriptMatchKey,
  isValidScriptRef,
  normalizeScriptRef,
  parseCallflowTextWithFallback,
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
    ? filename.replace(/\.[^.]+$/, '').trim()
    : '';
  const numFromFilename = cleanBasename.match(/(?:^|[\s_-])(\d{3,6})(?:$|[\s_-])/)?.[1];
  const looksMasterFile = /\b(?:main|master(?:script)?)\b/i.test(cleanBasename);

  let derivedRef: string | undefined = cdnFromComment || numFromFilename;
  if (!derivedRef && looksMasterFile) {
    derivedRef = 'Main';
  } else if (!derivedRef && nameFromComment && isValidScriptRef(nameFromComment)) {
    derivedRef = normalizeScriptRef(nameFromComment);
  } else if (!derivedRef && cleanBasename) {
    const tokenCandidate = cleanBasename.replace(/\s+/g, '_');
    if (isValidScriptRef(tokenCandidate)) {
      derivedRef = normalizeScriptRef(tokenCandidate);
    }
  }

  const cleanFilenameLabel = cleanBasename.replace(/[_-]+/g, ' ').trim();
  const derivedName =
    nameFromComment ||
    cleanFilenameLabel ||
    (derivedRef && canonicalScriptMatchKey(derivedRef) === 'main' ? 'Main' : undefined);

  return {
    scriptNumber: derivedRef,
    scriptName: derivedName,
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
    const modules = await parseVisioFileToModules(file, {
      overridePrimaryScriptNumber: options?.overridePrimaryScriptNumber,
    });
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
  });

  return {
    modules,
    sourceKind: isDotS ? 'aacc-s' : 'text',
    decodedText,
  };
}
