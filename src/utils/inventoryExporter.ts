/**
 * 100 % Offline & In-Memory Callflow Asset Inventory & Multi-Format Exporter
 *
 * Extracts a deterministic, secret-redacted workspace inventory across all loaded
 * Avaya AACC (OCL) scripts and Visio callflows:
 *   - Prompts & WAV/Audio files
 *   - Skillsets, Queues, Overflow targets & Agents
 *   - Phone numbers, Inbound DNIS, Script CDNs & Outbound Transfers
 *   - Declared, Assigned & System Variables (Read/Write & Unused/Unproven)
 *   - External DB, History (Hist), SQL/ODBC, HDX, FlixCheck, Oracle & API calls
 *   - Subflows & Common Modules (Resolved, External, Missing)
 *   - Schedules, SondZeit profiles & Holiday rules
 *   - Anomalies (Unused, Deactivated / Commented-out, Missing / Deprecated)
 *
 * Zero network I/O, zero filesystem I/O, and automatic API secret redaction.
 */
import JSZip from 'jszip';
import { ScriptModule, ScriptWorkspace } from '../types/mermaidStudio';
import {
  buildWorkspaceScheduleOverview,
  canonicalScriptMatchKey,
  classifyAvayaWaypointTarget,
  extractOclDeclaredVariables,
  extractWorkspaceResourceRegistry,
  isDeactivatedSentinelTarget,
  splitOclStatementsOutsideQuotes,
} from './scriptCallflowParser';
import { runCallflowAudit } from './auditCallflows';
import {
  isHardcodedApiSecretAssignment,
  redactPotentialSecrets,
} from './flixcheckSpec';
import {
  XL_STYLE_INDEX as S,
  XlsxRowSpec,
  XlsxSheetSpec,
  assembleXlsxPackageFiles,
  excelColLetter,
  exportXlsxSheetsBlob,
  exportXlsxSheetsUint8Array,
  makeXlsxBannerRows,
} from './openingHoursExporter';

export const INVENTORY_SCHEMA_VERSION = '1.6.8';

export type InventoryCategory =
  | 'prompts_wavs'
  | 'skillsets_queues'
  | 'numbers_dnis_cdn'
  | 'variables'
  | 'external_db_hist_api'
  | 'subflows_modules'
  | 'schedules_holidays'
  | 'anomalies_references';

export type InventoryStatus =
  | 'active'
  | 'unused'
  | 'deactivated'
  | 'missing'
  | 'deprecated';

export type InventorySubType =
  | 'wav-file'
  | 'prompt-ran'
  | 'music-treatment'
  | 'skillset'
  | 'overflow-skillset'
  | 'agent-target'
  | 'dnis'
  | 'cdn'
  | 'transfer-number'
  | 'global-var'
  | 'local-var'
  | 'system-var'
  | 'db-hist-call'
  | 'flixcheck-api'
  | 'oracle-api'
  | 'http-api'
  | 'subflow-internal'
  | 'common-module'
  | 'missing-subflow'
  | 'schedule-window'
  | 'sondzeit-profile'
  | 'holiday-rule'
  | 'unused-variable'
  | 'unused-script'
  | 'deactivated-target'
  | 'missing-reference';

export interface InventoryOccurrence {
  id: string;
  category: InventoryCategory;
  categoryLabel: string;
  subType: InventorySubType;
  subTypeLabel: string;
  itemId: string;
  itemName: string;
  status: InventoryStatus;
  statusLabel: string;
  scriptNumber: string;
  scriptName: string;
  fileName: string;
  sectionName: string;
  lineNumber: number;
  command: string;
  contextSnippet: string;
}

export interface InventoryItem {
  id: string;
  category: InventoryCategory;
  categoryLabel: string;
  subType: InventorySubType;
  subTypeLabel: string;
  name: string;
  normalizedKey: string;
  status: InventoryStatus;
  statusLabel: string;
  details: string;
  occurrenceCount: number;
  scriptCount: number;
  scriptNumbers: string[];
  scriptsSummary: string;
  occurrences: InventoryOccurrence[];
  readCount?: number;
  writeCount?: number;
  priority?: number;
  endpointPath?: string;
  apiVersion?: string;
  scheduleSummary?: string;
}

export interface InventoryCategorySummary {
  category: InventoryCategory;
  label: string;
  itemCount: number;
  occurrenceCount: number;
  issueCount: number;
}

export interface WorkspaceInventoryBundle {
  schemaVersion: string;
  generatedAt: string;
  diagramTitle?: string;
  scriptCount: number;
  stats: {
    totalItems: number;
    totalOccurrences: number;
    issuesCount: number;
    byCategory: Record<InventoryCategory, number>;
  };
  categorySummaries: InventoryCategorySummary[];
  items: InventoryItem[];
  occurrences: InventoryOccurrence[];
}

export const INVENTORY_CATEGORY_ORDER: readonly InventoryCategory[] = [
  'prompts_wavs',
  'skillsets_queues',
  'numbers_dnis_cdn',
  'variables',
  'external_db_hist_api',
  'subflows_modules',
  'schedules_holidays',
  'anomalies_references',
] as const;

export const INVENTORY_CATEGORY_LABELS: Record<InventoryCategory, string> = {
  prompts_wavs: 'Prompts & WAVs',
  skillsets_queues: 'Skillsets, Queues & Agents',
  numbers_dnis_cdn: 'Rufnummern, DNIS & CDNs',
  variables: 'Variablen',
  external_db_hist_api: 'Externe DB, Hist & APIs',
  subflows_modules: 'Subflows & Module',
  schedules_holidays: 'Zeitpläne & Feiertage',
  anomalies_references: 'Auffälligkeiten & Sonderfälle',
};

export const INVENTORY_SUBTYPE_LABELS: Record<InventorySubType, string> = {
  'wav-file': 'WAV / Audio-Datei',
  'prompt-ran': 'Prompt / RAN / Ansage',
  'music-treatment': 'Wartemusik / Treatment',
  skillset: 'Skillset / Queue',
  'overflow-skillset': 'Überlauf-Skillset',
  'agent-target': 'Agent-Ziel',
  dnis: 'Inbound DNIS',
  cdn: 'Skript-CDN / Kurznummer',
  'transfer-number': 'Transfer- / PSTN-Nummer',
  'global-var': 'Globale / System-Variable',
  'local-var': 'Lokale / Skript-Variable',
  'system-var': 'Avaya System-Kontext',
  'db-hist-call': 'DB / Hist / HDX / Host',
  'flixcheck-api': 'FlixCheck API',
  'oracle-api': 'Oracle / DB-Connector',
  'http-api': 'REST / HTTP / Webhook',
  'subflow-internal': 'Interner Subflow',
  'common-module': 'Externes / Common Module',
  'missing-subflow': 'Fehlender Subflow',
  'schedule-window': 'Zeitplan / Dienstzeit',
  'sondzeit-profile': 'SondZeit-Profil',
  'holiday-rule': 'Feiertags- / Sonderregel',
  'unused-variable': 'Unbenutzte Variable',
  'unused-script': 'Verwaistes / Unaufgerufenes Skript',
  'deactivated-target': 'Deaktiviert / Auskommentiert',
  'missing-reference': 'Fehlende / Abgekündigte Referenz',
};

export const INVENTORY_STATUS_LABELS: Record<InventoryStatus, string> = {
  active: 'Aktiv',
  unused: 'Unbenutzt',
  deactivated: 'Deaktiviert',
  missing: 'Fehlend',
  deprecated: 'Review / Veraltet',
};

const OCL_KEYWORDS_NON_VAR = new Set([
  'if',
  'then',
  'else',
  'elsif',
  'elseif',
  'end',
  'endif',
  'section',
  'event',
  'where',
  'select',
  'case',
  'value',
  'default',
  'otherwise',
  'var',
  'const',
  'global',
  'local',
  'string',
  'integer',
  'number',
  'boolean',
  'float',
  'char',
  'date',
  'time',
  'and',
  'or',
  'not',
  'equals',
  'equal',
  'to',
  'from',
  'with',
  'priority',
  'into',
  'set',
  'assign',
  'give',
  'ran',
  'music',
  'announcement',
  'play',
  'prompt',
  'voice',
  'segment',
  'ivr',
  'queue',
  'skillset',
  'network',
  'agent',
  'cdn',
  'vdn',
  'transfer',
  'route',
  'call',
  'execute',
  'subscript',
  'goto',
  'wait',
  'disconnect',
  'drop',
  'collect',
  'digits',
  'send',
  'request',
  'info',
  'get',
  'response',
  'readvar',
  'dayofweek',
  'day',
  'of',
  'week',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'montag',
  'dienstag',
  'mittwoch',
  'donnerstag',
  'freitag',
  'samstag',
  'sonntag',
  'true',
  'false',
  'null',
  'empty',
  'in',
  'is',
  'on',
  'off',
  'for',
  'next',
  'return',
  'exit',
  'stop',
  'break',
  'continue',
  'script',
  'faxrouting',
  'fax',
  'ringback',
  'open',
  'closed',
  'holiday',
]);

const SYSTEM_INTRINSIC_PATTERNS: Array<{ pattern: RegExp; canonical: string; label: string }> = [
  { pattern: /\b(?:current_date|date)\b/i, canonical: 'date', label: 'date / current_date (Systemdatum)' },
  { pattern: /\b(?:current_time|time\s+of\s+day|time)\b/i, canonical: 'time', label: 'time / TIME OF DAY (Systemzeit)' },
  { pattern: /\bdayofweek|day\s+of\s+week\b/i, canonical: 'dayofweek', label: 'dayofweek / DAY OF WEEK' },
  { pattern: /\b(?:clid|ani|calling[\s_]*number|call\.ani)\b/i, canonical: 'CLID / ANI', label: 'CLID / ANI (Anrufernummer)' },
  { pattern: /\b(?:dnis|dialed[\s_]*number|call\.dnis)\b/i, canonical: 'DNIS', label: 'DNIS (Gewählte Rufnummer)' },
  { pattern: /\b(?:expected\s+wait\s+time|ewt)\b/i, canonical: 'EWT', label: 'EWT (Expected Wait Time)' },
  {
    pattern: /\b(?:logged\s+agents|available\s+agents|staffed\s+agents|agents\s+total|queue\s+agents)\b/i,
    canonical: 'Queue / Agent Intrinsics',
    label: 'Logged / Available Agents',
  },
];

function cleanToken(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/[;,\s]+$/g, '')
    .trim();
}

function redactInventorySnippet(
  raw: string,
  secretVarName?: string,
  secretRawExpr?: string
): string {
  let out = redactPotentialSecrets(String(raw || ''));
  out = out.replace(
    /\b(?:sk|pk|flx|fc|api)[_-]?live[_-]?[A-Za-z0-9_-]{8,}\b/gi,
    '***redacted***'
  );
  if (secretVarName && secretRawExpr && isHardcodedApiSecretAssignment(secretVarName, secretRawExpr)) {
    const bare = cleanToken(secretRawExpr);
    if (bare) {
      out = out.split(bare).join('***redacted***');
    }
  }
  return out;
}

function escapeCsvCell(val: string | number): string {
  const str = String(val ?? '').replace(/\r?\n/g, ' ');
  if (/[;,"\t]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function statusPriority(status: InventoryStatus): number {
  switch (status) {
    case 'missing':
      return 4;
    case 'deprecated':
      return 3;
    case 'unused':
      return 2;
    case 'deactivated':
      return 1;
    default:
      return 0;
  }
}

interface ParsedSourceLine {
  lineNumber: number;
  rawText: string;
  codeText: string;
  commentText: string;
  sectionName: string;
}

function splitModuleSourceLines(rawText: string | undefined): ParsedSourceLine[] {
  if (!rawText) return [];
  const rawLines = rawText.split(/\r?\n/);
  const result: ParsedSourceLine[] = [];
  let inBlockComment = false;
  let currentSection = 'Init / Hauptebene';

  for (let idx = 0; idx < rawLines.length; idx++) {
    const raw = rawLines[idx] ?? '';
    let codeChars = '';
    let commentChars = '';
    let inSingle = false;
    let inDouble = false;

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      const next = raw[i + 1] ?? '';

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          commentChars += '*/';
          inBlockComment = false;
          i++;
        } else {
          commentChars += ch;
        }
        continue;
      }

      if (!inSingle && !inDouble) {
        if (ch === '/' && next === '*') {
          inBlockComment = true;
          commentChars += '/*';
          i++;
          continue;
        }
        if (ch === '/' && next === '/') {
          commentChars += raw.slice(i);
          break;
        }
        if (ch === '!' && (i === 0 || /\s/.test(raw[i - 1]))) {
          commentChars += raw.slice(i);
          break;
        }
      }

      if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "'" && !inDouble) inSingle = !inSingle;

      codeChars += ch;
    }

    const codeTrimmed = codeChars.trim();
    const secMatch = codeTrimmed.match(
      /^(?:SECTION|EVENT)\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+))/i
    );
    if (secMatch) {
      currentSection = (secMatch[1] || secMatch[2] || secMatch[3] || currentSection).trim();
    } else if (/^WHERE\s+(.+)/i.test(codeTrimmed)) {
      const wMatch = codeTrimmed.match(/^WHERE\s+(.+)/i);
      if (wMatch) currentSection = `WHERE ${wMatch[1].trim().slice(0, 48)}`;
    }

    result.push({
      lineNumber: idx + 1,
      rawText: raw.trim(),
      codeText: codeTrimmed,
      commentText: commentChars.trim(),
      sectionName: currentSection,
    });
  }

  return result;
}

function isLikelyPhoneOrDnisNumber(token: string): boolean {
  const clean = cleanToken(token);
  if (!clean) return false;
  if (/^\+\d{5,18}$/.test(clean)) return true;
  if (/^0\d{3,16}$/.test(clean)) return true;
  if (/^\d{4,16}$/.test(clean)) return true;
  return false;
}

function inferDbHistType(stmt: string): { command: string; target: string; subType: InventorySubType } | null {
  const clean = stmt.trim();
  if (!clean) return null;

  // 1. Explicit FlixCheck / API / HTTP / REST / Webhook
  if (/\b(?:flixcheck|flix[\s_-]*check)\b/i.test(clean)) {
    return { command: 'FlixCheck API', target: 'FlixCheck', subType: 'flixcheck-api' };
  }
  if (/\boracle\b/i.test(clean)) {
    return { command: 'Oracle Integration', target: 'Oracle', subType: 'oracle-api' };
  }

  // 2. Host Data Exchange (HDX) / SEND REQUEST / GET RESPONSE / HOST CALL
  const sendReq = clean.match(
    /\b(?:SEND\s+REQUEST|CALL\s+HOST|HOST_CALL|HDX(?:_CALL)?)\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))?/i
  );
  if (sendReq) {
    const t = cleanToken(sendReq[1] || sendReq[2] || sendReq[3] || '');
    return {
      command: 'SEND REQUEST / HDX',
      target: t && !/^with$/i.test(t) ? t : 'HDX Host Request',
      subType: 'db-hist-call',
    };
  }

  if (/\bGET\s+RESPONSE\b/i.test(clean)) {
    const m = clean.match(/\bGET\s+RESPONSE(?:\s+(?:FROM|INTO)\s+([A-Za-z0-9_.-]+))?/i);
    return {
      command: 'GET RESPONSE (HDX)',
      target: cleanToken(m?.[1] || 'HDX Response'),
      subType: 'db-hist-call',
    };
  }

  if (/\bREADVAR\b/i.test(clean)) {
    const m = clean.match(/\bREADVAR\s+([A-Za-z0-9_.-]+)/i);
    return {
      command: 'READVAR (HDX)',
      target: cleanToken(m?.[1] || 'HDX Variable Read'),
      subType: 'db-hist-call',
    };
  }

  // 3. Explicit DB / HIST / SQL / ODBC calls
  const dbHistMatch = clean.match(
    /\b(DB(?:_[A-Za-z0-9]+)?|DATABASE|HIST(?:ORY)?(?:_[A-Za-z0-9]+)?|CALL_HIST|LOG_HIST|GET\s+HISTORY|WRITE\s+HISTORY|LOG\s+HISTORY|SQL|ODBC|EXEC\s+SQL|DB_QUERY|DB_LOOKUP|DB_READ|DB_WRITE|CALLPROC|STORED[\s_]*PROC)\b(?:\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_./:-]+)))?/i
  );
  if (dbHistMatch) {
    const cmd = dbHistMatch[1].toUpperCase();
    const arg = cleanToken(dbHistMatch[2] || dbHistMatch[3] || dbHistMatch[4] || '');
    const label = arg && !/^(?:to|from|into|with|where)$/i.test(arg) ? `${cmd}: ${arg}` : cmd;
    return {
      command: cmd,
      target: label,
      subType: 'db-hist-call',
    };
  }

  // 4. SEND INFO / HTTP / REST / WEBHOOK
  const sendInfo = clean.match(/\bSEND\s+INFO\b\s*(.*)/i);
  if (sendInfo) {
    const rawArg = redactPotentialSecrets(cleanToken(sendInfo[1] || 'SEND INFO'));
    return {
      command: 'SEND INFO',
      target: rawArg ? `SEND INFO (${rawArg.slice(0, 60)})` : 'SEND INFO',
      subType: 'http-api',
    };
  }

  const httpMatch = clean.match(
    /(https?:\/\/[A-Za-z0-9.-]+(?:\/[A-Za-z0-9_./{}-]*)?|\b(?:HTTP_POST|HTTP_GET|HTTP_PUT|HTTP_REQUEST|REST_API|WEBHOOK)\b)/i
  );
  if (httpMatch) {
    const target = redactPotentialSecrets(cleanToken(httpMatch[1]));
    return {
      command: 'HTTP / REST API',
      target,
      subType: 'http-api',
    };
  }

  return null;
}

/**
 * Builds the full, deduplicated, secret-redacted Asset & Dependency Inventory
 * across all modules, rules, schedules, variables, and audit findings in the workspace.
 */
export function buildWorkspaceInventory(
  workspace: ScriptWorkspace | null | undefined,
  options?: { diagramTitle?: string }
): WorkspaceInventoryBundle {
  const safeWorkspace: ScriptWorkspace = workspace || {
    modules: [],
    missingTargets: [],
    manualLinks: [],
    externalEndpoints: [],
    avayaWaypoints: [],
    ignoredChecklistTargets: [],
    issues: [],
    resolvedIssues: {},
    updatedAt: 0,
  };
  const modules = safeWorkspace.modules || [];
  const registry = extractWorkspaceResourceRegistry(safeWorkspace);
  const scheduleRows = buildWorkspaceScheduleOverview(safeWorkspace);
  const auditReport = modules.length > 0 ? runCallflowAudit(safeWorkspace) : null;

  const moduleByKey = new Map<string, ScriptModule>();
  modules.forEach((m) => {
    moduleByKey.set(canonicalScriptMatchKey(m.scriptNumber), m);
  });

  const externalKeys = new Set(
    (safeWorkspace.externalEndpoints || []).map(canonicalScriptMatchKey)
  );
  const waypointKeys = new Set(
    (safeWorkspace.avayaWaypoints || []).map(canonicalScriptMatchKey)
  );

  interface MutableItem {
    id: string;
    category: InventoryCategory;
    subType: InventorySubType;
    name: string;
    normalizedKey: string;
    status: InventoryStatus;
    detailsParts: Set<string>;
    scriptNumbers: Set<string>;
    scriptLabels: Map<string, string>;
    occurrences: InventoryOccurrence[];
    seenOccurrenceKeys: Set<string>;
    readCount?: number;
    writeCount?: number;
    priority?: number;
    endpointPath?: string;
    apiVersion?: string;
    scheduleSummary?: string;
  }

  const itemMap = new Map<string, MutableItem>();

  const registerAsset = (params: {
    category: InventoryCategory;
    subType: InventorySubType;
    name: string;
    normalizedKey?: string;
    status?: InventoryStatus;
    detail?: string;
    priority?: number;
    endpointPath?: string;
    apiVersion?: string;
    scheduleSummary?: string;
    occurrence?: {
      scriptNumber: string;
      scriptName: string;
      fileName?: string;
      sectionName?: string;
      lineNumber?: number;
      command: string;
      contextSnippet: string;
    };
  }): MutableItem | null => {
    const cleanName = redactInventorySnippet(cleanToken(params.name));
    if (!cleanName || cleanName === '-1' || cleanName === '0') return null;

    const normKey = (params.normalizedKey || cleanName).toLowerCase().trim();
    const mapKey = `${params.category}::${params.subType}::${normKey}`;
    const desiredStatus: InventoryStatus = params.status || 'active';

    let item = itemMap.get(mapKey);
    if (!item) {
      item = {
        id: mapKey,
        category: params.category,
        subType: params.subType,
        name: cleanName,
        normalizedKey: normKey,
        status: desiredStatus,
        detailsParts: new Set(),
        scriptNumbers: new Set(),
        scriptLabels: new Map(),
        occurrences: [],
        seenOccurrenceKeys: new Set(),
        priority: params.priority,
        endpointPath: params.endpointPath
          ? redactInventorySnippet(params.endpointPath)
          : undefined,
        apiVersion: params.apiVersion,
        scheduleSummary: params.scheduleSummary,
      };
      itemMap.set(mapKey, item);
    } else {
      if (statusPriority(desiredStatus) > statusPriority(item.status)) {
        item.status = desiredStatus;
      }
      if (params.priority !== undefined && item.priority === undefined) {
        item.priority = params.priority;
      }
      if (params.endpointPath && !item.endpointPath) {
        item.endpointPath = redactInventorySnippet(params.endpointPath);
      }
      if (params.apiVersion && !item.apiVersion) {
        item.apiVersion = params.apiVersion;
      }
      if (params.scheduleSummary && !item.scheduleSummary) {
        item.scheduleSummary = params.scheduleSummary;
      }
    }

    if (params.detail) {
      item.detailsParts.add(redactInventorySnippet(params.detail));
    }

    if (params.occurrence) {
      const occ = params.occurrence;
      const lineNum = Math.max(1, occ.lineNumber || 1);
      const section = (occ.sectionName || 'Init / Hauptebene').trim();
      const fileName = occ.fileName || `${occ.scriptNumber}.s`;
      const snippet = redactInventorySnippet(occ.contextSnippet || '').trim();
      const occKey = `${occ.scriptNumber}::${section}::${lineNum}::${occ.command}::${snippet.slice(0, 80)}`;

      item.scriptNumbers.add(occ.scriptNumber);
      item.scriptLabels.set(
        occ.scriptNumber,
        occ.scriptName && occ.scriptName !== occ.scriptNumber
          ? `${occ.scriptNumber} (${occ.scriptName})`
          : occ.scriptNumber
      );

      if (!item.seenOccurrenceKeys.has(occKey)) {
        item.seenOccurrenceKeys.add(occKey);
        item.occurrences.push({
          id: `${mapKey}::${occKey}`,
          category: item.category,
          categoryLabel: INVENTORY_CATEGORY_LABELS[item.category],
          subType: item.subType,
          subTypeLabel: INVENTORY_SUBTYPE_LABELS[item.subType],
          itemId: item.id,
          itemName: item.name,
          status: item.status,
          statusLabel: INVENTORY_STATUS_LABELS[item.status],
          scriptNumber: occ.scriptNumber,
          scriptName: occ.scriptName || occ.scriptNumber,
          fileName,
          sectionName: section,
          lineNumber: lineNum,
          command: occ.command,
          contextSnippet: snippet,
        });
      }
    }

    return item;
  };

  // Track variable reads/writes/declarations globally & per-script for unused detection
  interface VarTracker {
    name: string;
    subType: InventorySubType;
    declared: boolean;
    writeCount: number;
    readCount: number;
    initialValues: Set<string>;
    lastWriteOcc?: {
      scriptNumber: string;
      scriptName: string;
      fileName: string;
      sectionName: string;
      lineNumber: number;
      command: string;
      contextSnippet: string;
    };
  }
  const varTrackers = new Map<string, VarTracker>();

  const ensureVarTracker = (varName: string, subTypeHint?: InventorySubType): VarTracker | null => {
    const clean = cleanToken(varName);
    if (!clean || /^\d+$/.test(clean)) return null;
    const low = clean.toLowerCase();
    if (OCL_KEYWORDS_NON_VAR.has(low)) return null;
    const inferredSubType: InventorySubType =
      subTypeHint ||
      (/^(?:gv_|sys_)/i.test(clean) ? 'global-var' : 'local-var');

    let t = varTrackers.get(low);
    if (!t) {
      t = {
        name: clean,
        subType: inferredSubType,
        declared: false,
        writeCount: 0,
        readCount: 0,
        initialValues: new Set(),
      };
      varTrackers.set(low, t);
    } else if (inferredSubType === 'global-var' && t.subType === 'local-var') {
      t.subType = 'global-var';
    }
    return t;
  };

  // Scan each module's raw lines AND parsed rules
  for (const mod of modules) {
    const fileName = mod.sourceFilename || `${mod.scriptNumber}.s`;
    const sourceLines = splitModuleSourceLines(mod.rawText);

    // Script-level CDN & Entry DNIS
    if (mod.cdnAlias) {
      registerAsset({
        category: 'numbers_dnis_cdn',
        subType: 'cdn',
        name: mod.cdnAlias,
        detail: `Skript-CDN Alias für ${mod.scriptNumber} (${mod.scriptName})`,
        occurrence: {
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName,
          fileName,
          sectionName: 'Header / Init',
          lineNumber: 1,
          command: 'CDN Header',
          contextSnippet: `CDN ${mod.cdnAlias} (${mod.scriptName})`,
        },
      });
    }

    (mod.entryDnisNumbers || []).forEach((dnis) => {
      const cleanDnis = cleanToken(dnis);
      if (!cleanDnis) return;
      registerAsset({
        category: 'numbers_dnis_cdn',
        subType: 'dnis',
        name: cleanDnis,
        detail: mod.entryOrganizationName
          ? `Eingehende DNIS · Orga: ${mod.entryOrganizationName}`
          : 'Eingehende DNIS / Routing-Nummer',
        occurrence: {
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName,
          fileName,
          sectionName: 'Einstieg / DNIS',
          lineNumber: 1,
          command: 'DNIS Entry',
          contextSnippet: `DNIS ${cleanDnis} -> ${mod.scriptNumber}`,
        },
      });
    });

    // OCL declarations helper
    const rawDecl = mod.rawText ? extractOclDeclaredVariables(mod.rawText.split(/\r?\n/)) : null;
    if (rawDecl) {
      rawDecl.declaredVars.forEach((vKey) => {
        const t = ensureVarTracker(vKey);
        if (t) {
          t.declared = true;
          const lit = rawDecl.staticStringLiterals.get(vKey);
          if (lit) t.initialValues.add(lit);
        }
      });
    }

    // Line-by-line deterministic OCL inspection
    let inVarDeclBlock = false;
    for (const srcLine of sourceLines) {
      const { lineNumber, codeText, commentText, sectionName } = srcLine;

      // Check commented-out active commands -> Deactivated / Commented anomalies
      if (!codeText && commentText) {
        const deactivatedCmd = commentText.match(
          /\b(EXECUTE|SUBSCRIPT|CALL\s+SCRIPT|GIVE\s+RAN|PLAY\s+PROMPT|QUEUE\s+TO\s+(?:SKILLSET|AGENT)|TRANSFER\s+TO|SEND\s+REQUEST)\s+([^\r\n*!/]+)/i
        );
        if (deactivatedCmd) {
          const targetName = cleanToken(deactivatedCmd[2]).slice(0, 64);
          registerAsset({
            category: 'anomalies_references',
            subType: 'deactivated-target',
            name: `${deactivatedCmd[1].toUpperCase()} ${targetName}`.trim(),
            status: 'deactivated',
            detail: 'Auskommentierte / deaktivierte Anweisung im Quelltext',
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName,
              lineNumber,
              command: 'Auskommentiert',
              contextSnippet: commentText,
            },
          });
        }
        // Check commented .wav mentions too
        const commentWavs = commentText.match(/[A-Za-z0-9ÄÖÜäöüß_.-]+\.(?:wav|vox|ulaw|mp3)\b/gi);
        if (commentWavs) {
          for (const wav of commentWavs) {
            registerAsset({
              category: 'prompts_wavs',
              subType: 'wav-file',
              name: wav,
              status: 'deactivated',
              detail: 'Audio-Datei im Kommentar referenziert',
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: 'Kommentar (Audio)',
                contextSnippet: commentText,
              },
            });
          }
        }
        continue;
      }

      if (!codeText) continue;

      // Track VAR / CONST / GLOBAL declaration blocks
      if (/^end\s+(?:const|var|global)\b/i.test(codeText)) {
        inVarDeclBlock = false;
        continue;
      }
      if (/^(?:const|var|global)(?:\s+(?:var|const))?(?:\s+.*)?$/i.test(codeText) && !/\b(?:execute|queue|route)\b/i.test(codeText)) {
        const rest = codeText
          .replace(/^(?:const|var|global)(?:\s+(?:var|const))?\s*/i, '')
          .replace(/\bend\s+(?:const|var|global)\b/gi, '')
          .trim();
        if (!rest) {
          inVarDeclBlock = true;
          continue;
        }
        const declVars = rest.split(/\s*,\s*/).map((part) => part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1]).filter(Boolean) as string[];
        for (const dv of declVars) {
          const tracker = ensureVarTracker(dv, /^global\b/i.test(codeText) ? 'global-var' : 'local-var');
          if (tracker) {
            tracker.declared = true;
            const eqLit = rest.match(/=\s*(?:"([^"]+)"|'([^']+)')/);
            if (eqLit) tracker.initialValues.add(eqLit[1] || eqLit[2] || '');
            registerAsset({
              category: 'variables',
              subType: tracker.subType,
              name: dv,
              normalizedKey: dv.toLowerCase(),
              detail: /^global\b/i.test(codeText) ? 'GLOBAL Deklaration' : 'VAR / CONST Deklaration',
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: codeText.split(/\s+/)[0].toUpperCase(),
                contextSnippet: codeText,
              },
            });
          }
        }
        continue;
      }
      if (inVarDeclBlock) {
        const dvMatch = codeText.match(/^([A-Za-z_][A-Za-z0-9_]*)\b/);
        if (dvMatch) {
          const dv = dvMatch[1];
          const tracker = ensureVarTracker(dv);
          if (tracker) {
            tracker.declared = true;
            registerAsset({
              category: 'variables',
              subType: tracker.subType,
              name: dv,
              normalizedKey: dv.toLowerCase(),
              detail: 'Deklarationsblock',
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: 'VAR',
                contextSnippet: codeText,
              },
            });
          }
        }
        continue;
      }

      // Split inline semicolon-separated statements cleanly
      const statements = splitOclStatementsOutsideQuotes(codeText);
      for (const stmt of statements) {
        const sTrim = stmt.trim();
        if (!sTrim) continue;

        // A. GIVE RAN / PLAY PROMPT / GIVE ANNOUNCEMENT / PLAY VOICE SEGMENT / GIVE IVR
        const ranMatch = sTrim.match(
          /\b(GIVE\s+(?:RAN|ANNOUNCEMENT|IVR)|PLAY\s+(?:PROMPT|AUDIO|ANNOUNCEMENT)(?:\s+VOICE\s+SEGMENT)?)\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+))/i
        );
        const ranTarget = ranMatch
          ? cleanToken(ranMatch[2] || ranMatch[3] || ranMatch[4] || '')
          : '';
        if (ranMatch && ranTarget) {
          const cmd = ranMatch[1].toUpperCase().replace(/\s+/g, ' ');
          const isWav = /\.(?:wav|vox|ulaw|mp3)$/i.test(ranTarget);
          registerAsset({
            category: 'prompts_wavs',
            subType: isWav ? 'wav-file' : 'prompt-ran',
            name: ranTarget,
            detail: isWav ? `Audio über ${cmd}` : `Ansage / RAN via ${cmd}`,
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName,
              lineNumber,
              command: cmd,
              contextSnippet: sTrim,
            },
          });
        }

        // B. Direct .wav / .vox / .ulaw / .mp3 filenames anywhere else in active statement
        const wavMatches = sTrim.match(/[A-Za-z0-9ÄÖÜäöüß_.-]+\.(?:wav|vox|ulaw|mp3)\b/gi);
        if (wavMatches) {
          for (const wav of wavMatches) {
            if (ranTarget && wav.toLowerCase() === ranTarget.toLowerCase()) continue;
            registerAsset({
              category: 'prompts_wavs',
              subType: 'wav-file',
              name: wav,
              detail: 'Audio-Dateiname im Callflow',
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: sTrim.split(/\s+/)[0].toUpperCase(),
                contextSnippet: sTrim,
              },
            });
          }
        }

        // C. GIVE MUSIC / GIVE RINGBACK
        const musicMatch = sTrim.match(
          /\b(GIVE\s+MUSIC|GIVE\s+RINGBACK)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+))?/i
        );
        if (musicMatch) {
          const cmd = musicMatch[1].toUpperCase();
          const target = cleanToken(musicMatch[2] || musicMatch[3] || musicMatch[4] || cmd);
          registerAsset({
            category: 'prompts_wavs',
            subType: 'music-treatment',
            name: target || cmd,
            detail: 'Wartemusik / Ringback-Treatment',
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName,
              lineNumber,
              command: cmd,
              contextSnippet: sTrim,
            },
          });
        }

        // D. QUEUE TO SKILLSET / NETWORK SKILLSET / AGENT
        const queueMatch = sTrim.match(
          /\bQUEUE\s+TO\s+(?:(NETWORK)\s+)?(SKILLSET|AGENT)\s+(.+?)(?:\s+(?:WITH\s+)?PRIORITY\s+(\d{1,5}))?$/i
        );
        if (queueMatch) {
          const isNet = Boolean(queueMatch[1]);
          const kind = queueMatch[2].toUpperCase();
          const rawTargets = queueMatch[3].trim();
          const prioNum = queueMatch[4] ? Number(queueMatch[4]) : undefined;
          const parts = rawTargets
            .split(/\s*,\s*/)
            .map((p) => cleanToken(p))
            .filter(Boolean);

          for (const part of parts) {
            const isOverflow = /[uü]berlauf|overflow/i.test(sectionName) || /[uü]berlauf|overflow/i.test(part);
            const subType: InventorySubType =
              kind === 'AGENT'
                ? 'agent-target'
                : isOverflow
                ? 'overflow-skillset'
                : 'skillset';
            registerAsset({
              category: 'skillsets_queues',
              subType,
              name: part,
              priority: prioNum,
              detail: [
                isNet ? 'Network Skillset' : kind === 'AGENT' ? 'Direct Agent Queue' : 'Skillset Queue',
                prioNum !== undefined ? `Priorität ${prioNum}` : null,
                isOverflow ? 'Überlauf-Kontext' : null,
              ]
                .filter(Boolean)
                .join(' · '),
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: isNet ? `QUEUE TO NETWORK ${kind}` : `QUEUE TO ${kind}`,
                contextSnippet: sTrim,
              },
            });
          }
        }

        // E. GIVE CDN / TRANSFER TO / ROUTE CALL / FAXROUTING / DNIS
        const transferMatch = sTrim.match(
          /\b(GIVE\s+CDN|TRANSFER\s+TO|ROUTE\s+CALL(?:\s+TO)?|FAXROUTING)\s+(?:CDN\s+|VDN\s+|SCRIPT\s+)?(?:"([^"]+)"|'([^']+)'|(\+?\d{2,18}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]*))/i
        );
        if (transferMatch) {
          const cmd = transferMatch[1].toUpperCase().replace(/\s+/g, ' ');
          const target = cleanToken(transferMatch[2] || transferMatch[3] || transferMatch[4] || '');
          if (target) {
            if (isDeactivatedSentinelTarget(target)) {
              registerAsset({
                category: 'anomalies_references',
                subType: 'deactivated-target',
                name: target,
                status: 'deactivated',
                detail: `Deaktivierter Sentinel-Zielwert bei ${cmd}`,
                occurrence: {
                  scriptNumber: mod.scriptNumber,
                  scriptName: mod.scriptName,
                  fileName,
                  sectionName,
                  lineNumber,
                  command: cmd,
                  contextSnippet: sTrim,
                },
              });
            } else {
              const isCdn = /CDN/i.test(cmd);
              registerAsset({
                category: 'numbers_dnis_cdn',
                subType: isCdn ? 'cdn' : 'transfer-number',
                name: target,
                detail: isCdn ? `Routing auf CDN via ${cmd}` : `Weiterleitung / Zielrufnummer via ${cmd}`,
                occurrence: {
                  scriptNumber: mod.scriptNumber,
                  scriptName: mod.scriptName,
                  fileName,
                  sectionName,
                  lineNumber,
                  command: cmd,
                  contextSnippet: sTrim,
                },
              });
            }
          }
        }

        // VALUE <number> : ... (DNIS_Range / Dispatcher lines)
        const valueNumMatch = sTrim.match(/^\s*VALUE\s+([+\d]{3,18})\s*:/i);
        if (valueNumMatch && isLikelyPhoneOrDnisNumber(valueNumMatch[1])) {
          registerAsset({
            category: 'numbers_dnis_cdn',
            subType: 'dnis',
            name: valueNumMatch[1],
            detail: 'Eingehende DNIS / VALUE-Zuordnung',
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName,
              lineNumber,
              command: 'VALUE (DNIS)',
              contextSnippet: sTrim,
            },
          });
        }

        // Explicit DNIS = "...", DNIS: <num>, DNIS <num>, or CDN <id>
        const dnisCompMatch = sTrim.match(
          /(?:\bDNIS\s*={1,2}\s*|^\s*DNIS(?:\s*[:=]\s*|\s+))(?:"([+\d-]+)"|'([+\d-]+)'|([+\d]{3,18}))/i
        );
        if (dnisCompMatch) {
          const num = cleanToken(dnisCompMatch[1] || dnisCompMatch[2] || dnisCompMatch[3] || '');
          if (num) {
            registerAsset({
              category: 'numbers_dnis_cdn',
              subType: 'dnis',
              name: num,
              detail: /^\s*DNIS\b/i.test(sTrim) ? 'Eingehende DNIS-Deklaration' : 'DNIS-Abfrage im Callflow',
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: /^\s*DNIS\b/i.test(sTrim) ? 'DNIS' : 'IF DNIS',
                contextSnippet: sTrim,
              },
            });
          }
        }

        const cdnDeclMatch = sTrim.match(
          /^\s*CDN(?:\s*[:=]\s*|\s+)(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))/i
        );
        if (cdnDeclMatch) {
          const cdnVal = cleanToken(cdnDeclMatch[1] || cdnDeclMatch[2] || cdnDeclMatch[3] || '');
          if (cdnVal) {
            registerAsset({
              category: 'numbers_dnis_cdn',
              subType: 'cdn',
              name: cdnVal,
              detail: 'Skript-CDN Deklaration',
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: 'CDN',
                contextSnippet: sTrim,
              },
            });
          }
        }

        // F. Variable Assignments: ASSIGN <val> TO <var> | ASSIGN <var> = <val> | SET <var> = <val> | INPUT / COLLECT DIGITS INTO <var>
        const assignToM = sTrim.match(
          /\bASSIGN\s+([\s\S]+?)\s+TO\s+([A-Za-z_][A-Za-z0-9_]*)\b/i
        );
        const assignEqM = !assignToM
          ? sTrim.match(/\b(?:ASSIGN|SET)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|:=)\s*([^\r\n]+)/i)
          : null;
        const collectIntoM = sTrim.match(
          /\b(?:COLLECT\s+DIGITS(?:\s+\d+)?(?:\s+INTO)?|INPUT(?:\s+INTO)?|GET\s+RESPONSE(?:\s+INTO)?|READVAR)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i
        );

        let writeVarName: string | null = null;
        let rawWriteExpr = '';
        let writeCmd = 'ASSIGN';

        if (assignToM) {
          rawWriteExpr = assignToM[1].trim();
          writeVarName = assignToM[2].trim();
          writeCmd = 'ASSIGN TO';
        } else if (assignEqM) {
          writeVarName = assignEqM[1].trim();
          rawWriteExpr = assignEqM[2].trim();
          writeCmd = /^set\b/i.test(sTrim) ? 'SET' : 'ASSIGN =';
        } else if (collectIntoM) {
          writeVarName = collectIntoM[1].trim();
          rawWriteExpr = '(Runtime Input / Response)';
          writeCmd = sTrim.split(/\s+/).slice(0, 2).join(' ').toUpperCase();
        }

        if (writeVarName) {
          const isSecret = isHardcodedApiSecretAssignment(writeVarName, rawWriteExpr);
          const redactedVal = isSecret
            ? '***redacted***'
            : redactInventorySnippet(cleanToken(rawWriteExpr));
          const safeSnippet = redactInventorySnippet(sTrim, writeVarName, rawWriteExpr);
          const tracker = ensureVarTracker(writeVarName);
          if (tracker) {
            tracker.writeCount++;
            if (redactedVal) tracker.initialValues.add(redactedVal);
            tracker.lastWriteOcc = {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName,
              lineNumber,
              command: writeCmd,
              contextSnippet: safeSnippet,
            };

            registerAsset({
              category: 'variables',
              subType: tracker.subType,
              name: tracker.name,
              normalizedKey: tracker.name.toLowerCase(),
              detail: redactedVal ? `Zuweisung: ${redactedVal}` : 'Zuweisung',
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: writeCmd,
                contextSnippet: safeSnippet,
              },
            });
          }

          // Cross-register special Sys_* semantic resources
          if (/^Sys_Team_Skillset$/i.test(writeVarName) && redactedVal) {
            registerAsset({
              category: 'skillsets_queues',
              subType: 'skillset',
              name: redactedVal,
              detail: 'Primäres Team-Skillset via Sys_Team_Skillset',
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: 'Sys_Team_Skillset',
                contextSnippet: sTrim,
              },
            });
          } else if (/^Sys_Ueberlauf_Skillset$/i.test(writeVarName) && redactedVal) {
            registerAsset({
              category: 'skillsets_queues',
              subType: 'overflow-skillset',
              name: redactedVal,
              detail: 'Überlauf-Skillset via Sys_Ueberlauf_Skillset',
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: 'Sys_Ueberlauf_Skillset',
                contextSnippet: sTrim,
              },
            });
          } else if (/^Sys_Musik$/i.test(writeVarName) && redactedVal) {
            registerAsset({
              category: 'prompts_wavs',
              subType: 'music-treatment',
              name: `Musik-ID ${redactedVal}`,
              detail: 'Wartemusik-ID via Sys_Musik',
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: 'Sys_Musik',
                contextSnippet: sTrim,
              },
            });
          } else if (/^Sys_Ansage/i.test(writeVarName) && redactedVal) {
            registerAsset({
              category: 'prompts_wavs',
              subType: /\.(?:wav|vox|ulaw|mp3)$/i.test(redactedVal) ? 'wav-file' : 'prompt-ran',
              name: redactedVal,
              detail: `Ansage-Parameter via ${writeVarName}`,
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: writeVarName,
                contextSnippet: sTrim,
              },
            });
          }

          // RHS phone number literal assigned to routing variable
          if (isLikelyPhoneOrDnisNumber(redactedVal) && /route|ziel|number|rufnummer|cdn|dnis|transfer/i.test(writeVarName)) {
            registerAsset({
              category: 'numbers_dnis_cdn',
              subType: 'transfer-number',
              name: redactedVal,
              detail: `Rufnummer zugewiesen an ${writeVarName}`,
              occurrence: {
                scriptNumber: mod.scriptNumber,
                scriptName: mod.scriptName,
                fileName,
                sectionName,
                lineNumber,
                command: writeCmd,
                contextSnippet: sTrim,
              },
            });
          }
        }

        // G. Variable Reads & System Intrinsics in IF / WHERE / SELECT / Expressions
        const condMatch = sTrim.match(/^(?:IF|ELSE\s*IF|ELSIF|WHERE|SELECT)\s+(.+?)(?:\s+THEN\b|$)/i);
        if (condMatch) {
          const condExpr = condMatch[1];
          // Check System Intrinsics first
          for (const sys of SYSTEM_INTRINSIC_PATTERNS) {
            if (sys.pattern.test(condExpr)) {
              registerAsset({
                category: 'variables',
                subType: 'system-var',
                name: sys.canonical,
                normalizedKey: `sys::${sys.canonical.toLowerCase()}`,
                detail: sys.label,
                occurrence: {
                  scriptNumber: mod.scriptNumber,
                  scriptName: mod.scriptName,
                  fileName,
                  sectionName,
                  lineNumber,
                  command: 'System-Kontext',
                  contextSnippet: sTrim,
                },
              });
            }
          }

          // Extract identifier tokens outside quotes as variable reads
          const exprWithoutQuotes = condExpr.replace(/"[^"]*"|'[^']*'/g, ' ');
          const tokens = exprWithoutQuotes.match(/\b[A-Za-z_][A-Za-z0-9_]{1,}\b/g) || [];
          for (const tok of tokens) {
            const low = tok.toLowerCase();
            if (
              OCL_KEYWORDS_NON_VAR.has(low) ||
              /^(?:clid|ani|dnis|ewt|date|time|dayofweek|current_date|current_time)$/i.test(low)
            ) {
              continue;
            }
            const tracker = ensureVarTracker(tok);
            if (tracker) {
              tracker.readCount++;
              registerAsset({
                category: 'variables',
                subType: tracker.subType,
                name: tracker.name,
                normalizedKey: tracker.name.toLowerCase(),
                detail: 'Gelesen in Bedingung / Verzweigung',
                occurrence: {
                  scriptNumber: mod.scriptNumber,
                  scriptName: mod.scriptName,
                  fileName,
                  sectionName,
                  lineNumber,
                  command: 'IF / Bedingung',
                  contextSnippet: sTrim,
                },
              });
            }
          }
        }

        // H. External DB, Hist, SQL, ODBC, HDX, FlixCheck, Oracle, HTTP Calls
        const dbHist = inferDbHistType(sTrim);
        if (dbHist) {
          registerAsset({
            category: 'external_db_hist_api',
            subType: dbHist.subType,
            name: dbHist.target,
            detail: `Befehl: ${dbHist.command}`,
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName,
              lineNumber,
              command: dbHist.command,
              contextSnippet: sTrim,
            },
          });
        }

        // I. Subflows: EXECUTE / SUBSCRIPT / CALL SCRIPT / GOTO SCRIPT
        const execMatch = sTrim.match(
          /\b(EXECUTE|SUBSCRIPT|CALL\s+SCRIPT|GOTO\s+SCRIPT)\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+))/i
        );
        if (execMatch) {
          const cmd = execMatch[1].toUpperCase().replace(/\s+/g, ' ');
          const target = cleanToken(execMatch[2] || execMatch[3] || execMatch[4] || '');
          if (target) {
            if (isDeactivatedSentinelTarget(target)) {
              registerAsset({
                category: 'anomalies_references',
                subType: 'deactivated-target',
                name: target,
                status: 'deactivated',
                detail: `Deaktiviertes Sentinel-Ziel bei ${cmd}`,
                occurrence: {
                  scriptNumber: mod.scriptNumber,
                  scriptName: mod.scriptName,
                  fileName,
                  sectionName,
                  lineNumber,
                  command: cmd,
                  contextSnippet: sTrim,
                },
              });
            } else {
              const targetKey = canonicalScriptMatchKey(target);
              const matchedMod = moduleByKey.get(targetKey);
              const isWaypoint = waypointKeys.has(targetKey) || Boolean(classifyAvayaWaypointTarget(target));
              const isExternal = externalKeys.has(targetKey);
              const subType: InventorySubType = matchedMod
                ? 'subflow-internal'
                : isWaypoint || isExternal
                ? 'common-module'
                : 'missing-subflow';
              const status: InventoryStatus = matchedMod
                ? 'active'
                : isWaypoint || isExternal
                ? 'active'
                : 'missing';

              registerAsset({
                category: 'subflows_modules',
                subType,
                name: matchedMod ? matchedMod.scriptNumber : target,
                normalizedKey: targetKey || target.toLowerCase(),
                status,
                detail: matchedMod
                  ? `Geladenes Skript (${matchedMod.scriptName})`
                  : isWaypoint || isExternal
                  ? 'Externer / Avaya Common Module Endpunkt'
                  : 'Keine geladene Quelldatei im Workspace',
                occurrence: {
                  scriptNumber: mod.scriptNumber,
                  scriptName: mod.scriptName,
                  fileName,
                  sectionName,
                  lineNumber,
                  command: cmd,
                  contextSnippet: sTrim,
                },
              });
            }
          }
        }

        // J. Schedules, SondZeit & Holiday rules (line-level provenance)
        const todMatch = sTrim.match(
          /\bTIME\s+OF\s+DAY\s+([0-2]?\d:[0-5]\d\s*(?:\.\.|-|bis|to)\s*[0-2]?\d:[0-5]\d)/i
        );
        if (todMatch) {
          const windowText = todMatch[1].replace(/\s+/g, '');
          registerAsset({
            category: 'schedules_holidays',
            subType: 'schedule-window',
            name: `TIME OF DAY ${windowText}`,
            scheduleSummary: windowText,
            detail: 'Zeitfenster-Bedingung im Skript',
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName,
              lineNumber,
              command: 'TIME OF DAY',
              contextSnippet: sTrim,
            },
          });
        }

        const dowMatch = sTrim.match(
          /\bDAY\s+OF\s+WEEK\s+([A-Za-zÄÖÜäöüß]+(?:\s*(?:\.\.|-|,)\s*[A-Za-zÄÖÜäöüß]+)*)/i
        );
        if (dowMatch) {
          const daysText = dowMatch[1].trim();
          registerAsset({
            category: 'schedules_holidays',
            subType: 'schedule-window',
            name: `DAY OF WEEK ${daysText}`,
            scheduleSummary: daysText,
            detail: 'Wochentags-Bedingung im Skript',
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName,
              lineNumber,
              command: 'DAY OF WEEK',
              contextSnippet: sTrim,
            },
          });
        }

        const sondZeitMatch = sTrim.match(/\b([A-Za-z0-9_]*SondZeit[A-Za-z0-9_]*)\b/i);
        if (sondZeitMatch) {
          registerAsset({
            category: 'schedules_holidays',
            subType: 'sondzeit-profile',
            name: sondZeitMatch[1],
            detail: 'SondZeit-Profil / Sonderöffnungszeit',
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName,
              lineNumber,
              command: 'SondZeit',
              contextSnippet: sTrim,
            },
          });
        }

        if (/\b(?:Sys_?Holiday[A-Za-z0-9_]*|Feiertag[A-Za-z0-9_]*|Holiday[A-Za-z0-9_]*)\b/i.test(sTrim)) {
          const holMatch = sTrim.match(
            /\b(Sys_?Holiday[A-Za-z0-9_]*|Feiertag[A-Za-z0-9_]*|Holiday[A-Za-z0-9_]*)\b/i
          );
          const holName = holMatch ? holMatch[1] : 'Feiertagsprüfung';
          registerAsset({
            category: 'schedules_holidays',
            subType: 'holiday-rule',
            name: holName,
            detail: 'Feiertags- / Sonderstatusprüfung im Callflow',
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName,
              lineNumber,
              command: 'Feiertagsprüfung',
              contextSnippet: sTrim,
            },
          });
        }
      }
    }

    // Also inspect parsed ScriptRule objects (captures Visio & synthetic structures!)
    for (const rule of mod.rules) {
      const section = rule.sectionName || rule.eventName || `Prio ${rule.prio}`;
      const lineNumber = Math.max(1, rule.prio || 1);

      if (rule.announcement) {
        const cleanAnn = cleanToken(rule.announcement.replace(/^(?:RAN|Musik:)\s+/i, ''));
        const isWav = /\.(?:wav|vox|ulaw|mp3)$/i.test(cleanAnn);
        const isMusic = /^Musik:/i.test(rule.announcement);
        registerAsset({
          category: 'prompts_wavs',
          subType: isWav ? 'wav-file' : isMusic ? 'music-treatment' : 'prompt-ran',
          name: cleanAnn || rule.announcement,
          detail: rule.treatmentInfo ? `Treatment: ${rule.treatmentInfo}` : 'Regel-Ansage / RAN',
          occurrence: {
            scriptNumber: mod.scriptNumber,
            scriptName: mod.scriptName,
            fileName,
            sectionName: section,
            lineNumber,
            command: 'Rule Announcement',
            contextSnippet: rule.rawLine || rule.stepName,
          },
        });
      }

      if (rule.queueTarget) {
        const isOverflow = /[uü]berlauf|overflow/i.test(rule.stepName) || /[uü]berlauf|overflow/i.test(section);
        const subType: InventorySubType =
          rule.queueKind === 'agent'
            ? 'agent-target'
            : isOverflow
            ? 'overflow-skillset'
            : 'skillset';
        if (rule.queueKind === 'cdn') {
          registerAsset({
            category: 'numbers_dnis_cdn',
            subType: 'cdn',
            name: rule.queueTarget,
            detail: 'CDN-Ziel aus Callflow-Regel',
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName: section,
              lineNumber,
              command: 'CDN Target',
              contextSnippet: rule.rawLine || rule.stepName,
            },
          });
        } else {
          registerAsset({
            category: 'skillsets_queues',
            subType,
            name: rule.queueTarget,
            priority: rule.skillsetPriority,
            detail: rule.skillsetPriority !== undefined ? `Priorität ${rule.skillsetPriority}` : 'Regel-Queue / Skillset',
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName: section,
              lineNumber,
              command: rule.queueKind === 'agent' ? 'Queue Agent' : 'Queue Skillset',
              contextSnippet: rule.rawLine || rule.stepName,
            },
          });
        }
      }

      if (rule.srcRouteNumber) {
        registerAsset({
          category: 'numbers_dnis_cdn',
          subType: 'dnis',
          name: rule.srcRouteNumber,
          detail: rule.organizationName ? `Orga: ${rule.organizationName}` : 'Route / DNIS Nummer',
          occurrence: {
            scriptNumber: mod.scriptNumber,
            scriptName: mod.scriptName,
            fileName,
            sectionName: section,
            lineNumber,
            command: 'Route Number',
            contextSnippet: rule.rawLine || rule.stepName,
          },
        });
      }

      if (rule.externalIntegration) {
        const ext = rule.externalIntegration;
        const apiName = ext.isFlixcheck
          ? `FlixCheck (${ext.actionLabel}${ext.templateId ? ` · ${ext.templateId}` : ''})`
          : `${ext.providerId || 'HDX'} (${ext.actionLabel})`;
        const isDeprecated = ext.isFlixcheck && ext.apiVersion === 'v1-legacy';
        const missingFallback =
          (ext.commandKind === 'send-request' || ext.commandKind === 'host-call') &&
          (ext.hasResponseHandler === false || ext.hasErrorFallback === false);

        registerAsset({
          category: 'external_db_hist_api',
          subType: ext.isFlixcheck ? 'flixcheck-api' : 'db-hist-call',
          name: apiName,
          status: isDeprecated || ext.hasHardcodedSecret ? 'deprecated' : 'active',
          endpointPath: ext.endpointPath,
          apiVersion: ext.apiVersion,
          detail: [
            ext.channelLabel ? `Kanal: ${ext.channelLabel}` : null,
            ext.endpointPath ? `Endpunkt: ${redactPotentialSecrets(ext.endpointPath)}` : null,
            `API: ${ext.apiVersion}`,
            isDeprecated ? 'v1 abgekündigt' : null,
            missingFallback ? 'Kein Error-/Timeout-Fallback' : null,
            ext.hasHardcodedSecret ? 'Klartext-Secret erkannt (maskiert)' : null,
          ]
            .filter(Boolean)
            .join(' · '),
          occurrence: {
            scriptNumber: mod.scriptNumber,
            scriptName: mod.scriptName,
            fileName,
            sectionName: section,
            lineNumber,
            command: ext.commandKind.toUpperCase(),
            contextSnippet: rule.rawLine || rule.stepName,
          },
        });

        if (isDeprecated || ext.hasHardcodedSecret || missingFallback) {
          registerAsset({
            category: 'anomalies_references',
            subType: 'missing-reference',
            name: `${apiName} [${mod.scriptNumber}]`,
            status: 'deprecated',
            detail: [
              isDeprecated ? 'FlixCheck API v1 veraltet' : null,
              missingFallback ? 'Fehlender GET RESPONSE / Fehler-Fallback' : null,
              ext.hasHardcodedSecret ? 'Möglicher API-Key maskiert' : null,
            ]
              .filter(Boolean)
              .join(' · '),
            occurrence: {
              scriptNumber: mod.scriptNumber,
              scriptName: mod.scriptName,
              fileName,
              sectionName: section,
              lineNumber,
              command: 'API Review',
              contextSnippet: rule.rawLine || rule.stepName,
            },
          });
        }
      }
    }
  }

  // Merge Registry variables (ensures any ASSIGN variables caught by stripScriptCommentsAndNoise are included)
  for (const regVar of registry.variables) {
    const tracker = ensureVarTracker(regVar.variableName);
    for (const vEntry of regVar.valuesByScript) {
      const isSecretReg = isHardcodedApiSecretAssignment(regVar.variableName, vEntry.value);
      const safeVal = isSecretReg
        ? '***redacted***'
        : redactInventorySnippet(cleanToken(vEntry.value), regVar.variableName, vEntry.value);
      if (tracker) {
        tracker.writeCount = Math.max(1, tracker.writeCount);
        if (safeVal) tracker.initialValues.add(safeVal);
      }
      registerAsset({
        category: 'variables',
        subType: tracker ? tracker.subType : 'local-var',
        name: regVar.variableName,
        normalizedKey: regVar.variableName.toLowerCase(),
        detail: `Initialwert: ${safeVal}`,
        occurrence: {
          scriptNumber: vEntry.scriptNumber,
          scriptName: vEntry.scriptName,
          fileName: `${vEntry.scriptNumber}.s`,
          sectionName: 'Variablen / ASSIGN',
          lineNumber: 1,
          command: 'ASSIGN',
          contextSnippet: `${regVar.variableName} = ${safeVal}`,
        },
      });
    }
  }

  // Enrich Variables with Read/Write counts & flag unused non-system variables
  for (const [lowKey, tracker] of varTrackers.entries()) {
    const itemKey = `variables::${tracker.subType}::${lowKey}`;
    const item = itemMap.get(itemKey);
    if (item) {
      item.readCount = tracker.readCount;
      item.writeCount = tracker.writeCount;
      const isSysOut = /^sys_/i.test(tracker.name);
      const isUnused = !isSysOut && (tracker.declared || tracker.writeCount > 0) && tracker.readCount === 0;
      const isUnproven = tracker.readCount > 0 && tracker.writeCount === 0 && !tracker.declared;

      if (isUnused) {
        item.status = 'unused';
        item.detailsParts.add('Deklariert/gesetzt, aber im Workspace nie gelesen');
        if (tracker.lastWriteOcc) {
          registerAsset({
            category: 'anomalies_references',
            subType: 'unused-variable',
            name: tracker.name,
            normalizedKey: `unused-var::${lowKey}`,
            status: 'unused',
            detail: `Variable deklariert/gesetzt (${tracker.writeCount}x), aber 0x gelesen`,
            occurrence: tracker.lastWriteOcc,
          });
        }
      } else if (isUnproven) {
        item.status = 'deprecated';
        item.detailsParts.add('Im Callflow gelesen ohne lokale Quelle (Provenance prüfen)');
      }

      if (tracker.initialValues.size > 0) {
        const vals = Array.from(tracker.initialValues).slice(0, 3).join(', ');
        item.detailsParts.add(`Werte: ${vals}`);
      }
      item.detailsParts.add(`Schreibzugriffe: ${tracker.writeCount} · Lesezugriffe: ${tracker.readCount}`);
    }
  }

  // Schedules, SondZeit Profiles & Holiday Rules
  for (const sRow of scheduleRows) {
    if (sRow.openingHours && !/24\/7|ohne zeitbeschränkung|ganztägig/i.test(sRow.openingHours)) {
      const isSondZeit = /sondzeit/i.test(sRow.scheduleSource || sRow.openingHours);
      registerAsset({
        category: 'schedules_holidays',
        subType: isSondZeit ? 'sondzeit-profile' : 'schedule-window',
        name: isSondZeit && sRow.scheduleSource ? sRow.scheduleSource : sRow.openingHours,
        scheduleSummary: sRow.openingHours,
        detail: [
          isSondZeit ? 'SondZeit-Profil' : 'Reguläre Öffnungszeit',
          sRow.closedOrOverflowAction && sRow.closedOrOverflowAction !== '—'
            ? `Überlauf: ${sRow.closedOrOverflowAction}`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
        occurrence: {
          scriptNumber: sRow.scriptNumber,
          scriptName: sRow.scriptName,
          fileName: `${sRow.scriptNumber}.s`,
          sectionName: sRow.stepName || 'Zeitplan',
          lineNumber: Math.max(1, sRow.prio || 1),
          command: isSondZeit ? 'SondZeit' : 'TIME / DAY',
          contextSnippet: `${sRow.openingHours}${sRow.scheduleSource ? ` (${sRow.scheduleSource})` : ''}`,
        },
      });
    }

    if (sRow.hasHoliday && sRow.holidayAndSpecial) {
      registerAsset({
        category: 'schedules_holidays',
        subType: 'holiday-rule',
        name: sRow.holidayAndSpecial,
        scheduleSummary: sRow.openingHours,
        detail: sRow.closedOrOverflowAction && sRow.closedOrOverflowAction !== '—'
          ? `Aktion: ${sRow.closedOrOverflowAction}`
          : 'Feiertags- / Sonderstatusprüfung',
        occurrence: {
          scriptNumber: sRow.scriptNumber,
          scriptName: sRow.scriptName,
          fileName: `${sRow.scriptNumber}.s`,
          sectionName: sRow.stepName || 'Feiertag',
          lineNumber: Math.max(1, sRow.prio || 1),
          command: 'Feiertagsprüfung',
          contextSnippet: sRow.holidayAndSpecial,
        },
      });
    }
  }

  // Merge Audit Findings: External Integrations (Oracle/FlixCheck), Broken Links & Orphan Scripts
  if (auditReport) {
    for (const ext of auditReport.externalIntegrations) {
      registerAsset({
        category: 'external_db_hist_api',
        subType: ext.system === 'Oracle' ? 'oracle-api' : 'flixcheck-api',
        name: `${ext.system}: ${ext.targetRaw}`,
        detail: `Kategorie: ${ext.category}`,
        occurrence: {
          scriptNumber: ext.sourceScriptKey,
          scriptName: ext.sourceFileName,
          fileName: ext.sourceFileName,
          sectionName: 'Integration',
          lineNumber: ext.lineNumber,
          command: ext.command,
          contextSnippet: `${ext.command} ${ext.targetRaw}`,
        },
      });
    }

    for (const brk of auditReport.brokenLinks) {
      registerAsset({
        category: 'anomalies_references',
        subType: 'missing-reference',
        name: brk.targetRaw,
        normalizedKey: `missing::${canonicalScriptMatchKey(brk.targetRaw)}`,
        status: 'missing',
        detail: brk.reason || `Fehlende Ziel-Referenz (${brk.command})`,
        occurrence: {
          scriptNumber: brk.sourceScriptKey,
          scriptName: brk.sourceFileName,
          fileName: brk.sourceFileName,
          sectionName: 'Referenzprüfung',
          lineNumber: brk.lineNumber,
          command: brk.command,
          contextSnippet: `Fehlendes Ziel: ${brk.targetRaw}`,
        },
      });
    }

    for (const orphan of auditReport.orphanScripts) {
      registerAsset({
        category: 'anomalies_references',
        subType: 'unused-script',
        name: `${orphan.scriptNumber} (${orphan.scriptName})`,
        normalizedKey: `orphan::${orphan.scriptKey}`,
        status: 'unused',
        detail: `Nicht aufgerufenes Skript (${orphan.outgoingEdgeCount} ausgehende Kanten)`,
        occurrence: {
          scriptNumber: orphan.scriptNumber,
          scriptName: orphan.scriptName,
          fileName: orphan.fileName,
          sectionName: 'Skript-Graph',
          lineNumber: 1,
          command: 'Orphan Script',
          contextSnippet: `${orphan.fileName} hat keine eingehenden Referenzen`,
        },
      });
    }
  }

  // Finalize InventoryItem & Occurrence sorting
  const finalItems: InventoryItem[] = Array.from(itemMap.values()).map((it) => {
    const sortedScripts = Array.from(it.scriptNumbers).sort((a, b) =>
      a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' })
    );
    const sortedOccs = it.occurrences
      .map((o) => ({
        ...o,
        status: it.status,
        statusLabel: INVENTORY_STATUS_LABELS[it.status],
      }))
      .sort((a, b) => {
        const sCmp = a.scriptNumber.localeCompare(b.scriptNumber, 'de', {
          numeric: true,
          sensitivity: 'base',
        });
        if (sCmp !== 0) return sCmp;
        return a.lineNumber - b.lineNumber;
      });

    const scriptsSummary =
      sortedScripts.length > 0
        ? sortedScripts.slice(0, 5).join(', ') +
          (sortedScripts.length > 5 ? ` (+${sortedScripts.length - 5})` : '')
        : '—';

    return {
      id: it.id,
      category: it.category,
      categoryLabel: INVENTORY_CATEGORY_LABELS[it.category],
      subType: it.subType,
      subTypeLabel: INVENTORY_SUBTYPE_LABELS[it.subType],
      name: it.name,
      normalizedKey: it.normalizedKey,
      status: it.status,
      statusLabel: INVENTORY_STATUS_LABELS[it.status],
      details:
        redactInventorySnippet(Array.from(it.detailsParts).join(' · ')) ||
        INVENTORY_SUBTYPE_LABELS[it.subType],
      occurrenceCount: sortedOccs.length,
      scriptCount: sortedScripts.length,
      scriptNumbers: sortedScripts,
      scriptsSummary,
      occurrences: sortedOccs,
      readCount: it.readCount,
      writeCount: it.writeCount,
      priority: it.priority,
      endpointPath: it.endpointPath,
      apiVersion: it.apiVersion,
      scheduleSummary: it.scheduleSummary,
    };
  });

  finalItems.sort((a, b) => {
    const catIdxA = INVENTORY_CATEGORY_ORDER.indexOf(a.category);
    const catIdxB = INVENTORY_CATEGORY_ORDER.indexOf(b.category);
    if (catIdxA !== catIdxB) return catIdxA - catIdxB;
    const stCmp = statusPriority(b.status) - statusPriority(a.status);
    if (stCmp !== 0) return stCmp;
    return a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });
  });

  return rebuildBundleMetrics(finalItems, {
    diagramTitle: options?.diagramTitle,
    scriptCount: modules.length,
  });
}

function rebuildBundleMetrics(
  items: InventoryItem[],
  meta: { diagramTitle?: string; scriptCount: number }
): WorkspaceInventoryBundle {
  const byCategory: Record<InventoryCategory, number> = {
    prompts_wavs: 0,
    skillsets_queues: 0,
    numbers_dnis_cdn: 0,
    variables: 0,
    external_db_hist_api: 0,
    subflows_modules: 0,
    schedules_holidays: 0,
    anomalies_references: 0,
  };
  const occByCategory: Record<InventoryCategory, number> = { ...byCategory };
  const issuesByCategory: Record<InventoryCategory, number> = { ...byCategory };

  const allOccurrences: InventoryOccurrence[] = [];
  let issuesCount = 0;

  for (const item of items) {
    byCategory[item.category]++;
    occByCategory[item.category] += item.occurrenceCount;
    if (item.status !== 'active') {
      issuesByCategory[item.category]++;
      issuesCount++;
    }
    allOccurrences.push(...item.occurrences);
  }

  const categorySummaries: InventoryCategorySummary[] = INVENTORY_CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: INVENTORY_CATEGORY_LABELS[cat],
    itemCount: byCategory[cat],
    occurrenceCount: occByCategory[cat],
    issueCount: issuesByCategory[cat],
  }));

  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    diagramTitle: meta.diagramTitle,
    scriptCount: meta.scriptCount,
    stats: {
      totalItems: items.length,
      totalOccurrences: allOccurrences.length,
      issuesCount,
      byCategory,
    },
    categorySummaries,
    items,
    occurrences: allOccurrences,
  };
}

/**
 * Creates a filtered WorkspaceInventoryBundle from a subset of InventoryItems
 * so users can export either the full workspace inventory or only currently filtered items.
 */
export function filterWorkspaceInventoryBundle(
  bundle: WorkspaceInventoryBundle,
  filteredItems: InventoryItem[]
): WorkspaceInventoryBundle {
  return rebuildBundleMetrics(filteredItems, {
    diagramTitle: bundle.diagramTitle,
    scriptCount: bundle.scriptCount,
  });
}

// ============================================================================
// EXPORTERS: CSV, JSON & MULTI-SHEET OOXML EXCEL (.xlsx)
// ============================================================================

export function exportInventoryCsv(
  bundle: WorkspaceInventoryBundle,
  options?: { mode?: 'summary' | 'occurrences' }
): string {
  const mode = options?.mode || 'occurrences';

  if (mode === 'summary') {
    const header = [
      'Kategorie',
      'Typ',
      'Element / Name',
      'Status',
      'Fundstellen',
      'Skripte',
      'Skript-Liste',
      'Details / Kontext',
    ];
    const lines = [
      header.map(escapeCsvCell).join(';'),
      ...bundle.items.map((it) =>
        [
          it.categoryLabel,
          it.subTypeLabel,
          it.name,
          it.statusLabel,
          it.occurrenceCount,
          it.scriptCount,
          it.scriptsSummary,
          it.details,
        ]
          .map(escapeCsvCell)
          .join(';')
      ),
    ];
    return `\uFEFF${lines.join('\r\n')}`;
  }

  const header = [
    'Kategorie',
    'Typ',
    'Element / Name',
    'Status',
    'Skript-Nr.',
    'Skript-Name',
    'Quelldatei',
    'Section / Bereich',
    'Zeile',
    'Befehl',
    'Quelltext-Auszug (bereinigt)',
  ];
  const lines = [
    header.map(escapeCsvCell).join(';'),
    ...bundle.occurrences.map((occ) =>
      [
        occ.categoryLabel,
        occ.subTypeLabel,
        occ.itemName,
        occ.statusLabel,
        occ.scriptNumber,
        occ.scriptName,
        occ.fileName,
        occ.sectionName,
        occ.lineNumber,
        occ.command,
        occ.contextSnippet,
      ]
        .map(escapeCsvCell)
        .join(';')
    ),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

export function exportInventoryJson(bundle: WorkspaceInventoryBundle): string {
  return JSON.stringify(
    {
      schemaVersion: bundle.schemaVersion,
      generatedAt: bundle.generatedAt,
      diagramTitle: bundle.diagramTitle || null,
      scriptCount: bundle.scriptCount,
      stats: bundle.stats,
      categorySummaries: bundle.categorySummaries,
      items: bundle.items.map((item) => ({
        id: item.id,
        category: item.category,
        categoryLabel: item.categoryLabel,
        subType: item.subType,
        subTypeLabel: item.subTypeLabel,
        name: item.name,
        status: item.status,
        statusLabel: item.statusLabel,
        details: item.details,
        occurrenceCount: item.occurrenceCount,
        scriptCount: item.scriptCount,
        scriptNumbers: item.scriptNumbers,
        readCount: item.readCount,
        writeCount: item.writeCount,
        priority: item.priority,
        endpointPath: item.endpointPath,
        apiVersion: item.apiVersion,
        occurrences: item.occurrences.map((occ) => ({
          scriptNumber: occ.scriptNumber,
          scriptName: occ.scriptName,
          fileName: occ.fileName,
          sectionName: occ.sectionName,
          lineNumber: occ.lineNumber,
          command: occ.command,
          contextSnippet: occ.contextSnippet,
        })),
      })),
    },
    null,
    2
  );
}

function statusToExcelStyle(status: InventoryStatus): number {
  switch (status) {
    case 'missing':
      return S.CAT_HOLIDAY;
    case 'deprecated':
    case 'unused':
      return S.CAT_SONDZEIT;
    case 'deactivated':
      return S.DAY_CLOSED;
    default:
      return S.CAT_247;
  }
}

function buildDomainInventorySheet(params: {
  sheetName: string;
  tabColorHex: string;
  title: string;
  subtitle: string;
  items: InventoryItem[];
  emptyMessage: string;
}): XlsxSheetSpec {
  const colWidths = [22, 34, 16, 12, 11, 32, 48];
  const banner = makeXlsxBannerRows(colWidths.length, params.title, params.subtitle);
  const rows: XlsxRowSpec[] = [...banner.rows];
  rows.push({
    height: 24,
    cells: [
      'Typ',
      'Element / Name',
      'Status',
      'Fundstellen',
      'Skripte',
      'Verwendet in Skripten',
      'Details & Hinweise',
    ].map((h) => ({ value: h, style: S.TABLE_HEADER })),
  });

  if (params.items.length === 0) {
    rows.push({
      height: 24,
      cells: Array.from({ length: colWidths.length }, (_, i) => ({
        value: i === 0 ? params.emptyMessage : '',
        style: S.BODY_EVEN,
      })),
    });
  } else {
    params.items.forEach((item, idx) => {
      const isOdd = idx % 2 === 1;
      const bodyStyle = isOdd ? S.BODY_ODD : S.BODY_EVEN;
      const maxLen = Math.max(item.name.length, item.scriptsSummary.length, item.details.length);
      const estHeight = Math.min(72, Math.max(21, Math.ceil(maxLen / 42) * 15 + 6));
      rows.push({
        height: estHeight,
        cells: [
          { value: item.subTypeLabel, style: bodyStyle },
          { value: item.name, style: isOdd ? S.SCRIPT_ODD : S.SCRIPT_EVEN },
          { value: item.statusLabel, style: statusToExcelStyle(item.status) },
          { value: item.occurrenceCount, style: isOdd ? S.NUM_ODD : S.NUM_EVEN, type: 'num' },
          { value: item.scriptCount, style: isOdd ? S.NUM_ODD : S.NUM_EVEN, type: 'num' },
          { value: item.scriptsSummary, style: bodyStyle },
          { value: item.details, style: bodyStyle },
        ],
      });
    });
  }

  const lastRowNum = Math.max(4, rows.length);
  return {
    name: params.sheetName,
    tabColorHex: params.tabColorHex,
    colWidths,
    rows,
    merges: banner.merges,
    freezeRows: 4,
    autoFilterRef: `A4:${excelColLetter(colWidths.length - 1)}${lastRowNum}`,
  };
}

export function buildInventoryXlsxFileMap(
  bundle: WorkspaceInventoryBundle
): Record<string, string> {
  const titleSuffix = bundle.diagramTitle ? ` — ${bundle.diagramTitle}` : '';
  const kpiLine = `Export: ${bundle.generatedAt}  |  Version: ${bundle.schemaVersion}  |  Skripte: ${bundle.scriptCount}  |  Elemente: ${bundle.stats.totalItems}  |  Fundstellen: ${bundle.stats.totalOccurrences}  |  Auffälligkeiten: ${bundle.stats.issuesCount}`;

  const sheets: XlsxSheetSpec[] = [];

  // 1. Übersicht
  {
    const colWidths = [32, 18, 18, 18, 48];
    const banner = makeXlsxBannerRows(
      colWidths.length,
      `Callflow Asset-Inventar Übersicht${titleSuffix}`,
      kpiLine
    );
    const rows: XlsxRowSpec[] = [...banner.rows];
    rows.push({
      height: 24,
      cells: [
        'Inventar-Kategorie',
        'Eindeutige Elemente',
        'Fundstellen gesamt',
        'Auffälligkeiten',
        'Abgedeckte Inhalte',
      ].map((h) => ({ value: h, style: S.TABLE_HEADER })),
    });

    const descriptions: Record<InventoryCategory, string> = {
      prompts_wavs: 'Prompts, RAN-IDs, .wav/.vox/.mp3 Audiodateien & Wartemusik',
      skillsets_queues: 'Skillsets, Network Skillsets, Überlauf-Queues & Agent-Ziele',
      numbers_dnis_cdn: 'Eingehende DNIS, Skript-CDNs, PSTN & Transfer-Rufnummern',
      variables: 'Globale, lokale & System-Variablen inkl. Lese-/Schreibzugriffen',
      external_db_hist_api: 'HDX Host-Calls, DB/SQL/ODBC/Hist-Abfragen, FlixCheck & Oracle APIs',
      subflows_modules: 'Interne EXECUTE/SUBSCRIPT-Aufrufe, Common Modules & fehlende Ziele',
      schedules_holidays: 'Dienstzeiten, SondZeit-Profile & Feiertagsregeln',
      anomalies_references: 'Unbenutzte Variablen/Skripte, deaktivierte Ziele & fehlende Links',
    };

    bundle.categorySummaries.forEach((summary, idx) => {
      const isOdd = idx % 2 === 1;
      const bodyStyle = isOdd ? S.BODY_ODD : S.BODY_EVEN;
      rows.push({
        height: 22,
        cells: [
          { value: summary.label, style: isOdd ? S.SCRIPT_ODD : S.SCRIPT_EVEN },
          { value: summary.itemCount, style: isOdd ? S.NUM_ODD : S.NUM_EVEN, type: 'num' },
          { value: summary.occurrenceCount, style: isOdd ? S.NUM_ODD : S.NUM_EVEN, type: 'num' },
          {
            value: summary.issueCount,
            style: summary.issueCount > 0 ? S.CAT_SONDZEIT : isOdd ? S.NUM_ODD : S.NUM_EVEN,
            type: 'num',
          },
          { value: descriptions[summary.category], style: bodyStyle },
        ],
      });
    });

    sheets.push({
      name: 'Übersicht',
      tabColorHex: '0F172A',
      colWidths,
      rows,
      merges: banner.merges,
      freezeRows: 4,
      autoFilterRef: `A4:${excelColLetter(colWidths.length - 1)}${Math.max(4, rows.length)}`,
    });
  }

  const byCat = (cat: InventoryCategory) => bundle.items.filter((i) => i.category === cat);

  // 2. Prompts & WAVs
  sheets.push(
    buildDomainInventorySheet({
      sheetName: 'Prompts & WAVs',
      tabColorHex: '0284C7',
      title: `Prompts, RAN-IDs & Audio-Dateien (.wav)${titleSuffix}`,
      subtitle: kpiLine,
      items: byCat('prompts_wavs'),
      emptyMessage: 'Keine Prompts, RAN-IDs oder Audio-Dateien erkannt.',
    })
  );

  // 3. Skillsets & Agents
  sheets.push(
    buildDomainInventorySheet({
      sheetName: 'Skillsets & Agents',
      tabColorHex: '059669',
      title: `Skillsets, Warteschlangen, Überläufe & Agents${titleSuffix}`,
      subtitle: kpiLine,
      items: byCat('skillsets_queues'),
      emptyMessage: 'Keine Skillsets, Queues oder Agent-Ziele erkannt.',
    })
  );

  // 4. Rufnummern & CDNs
  sheets.push(
    buildDomainInventorySheet({
      sheetName: 'Rufnummern & CDNs',
      tabColorHex: '4F46E5',
      title: `Rufnummern, DNIS, CDNs & Transfer-Ziele${titleSuffix}`,
      subtitle: kpiLine,
      items: byCat('numbers_dnis_cdn'),
      emptyMessage: 'Keine Rufnummern, DNIS oder CDNs erkannt.',
    })
  );

  // 5. Variablen
  {
    const vars = byCat('variables');
    const colWidths = [22, 28, 16, 11, 11, 11, 30, 44];
    const banner = makeXlsxBannerRows(
      colWidths.length,
      `Variablen & System-Kontext (Lese-/Schreibzugriffe)${titleSuffix}`,
      kpiLine
    );
    const rows: XlsxRowSpec[] = [...banner.rows];
    rows.push({
      height: 24,
      cells: [
        'Typ',
        'Variablenname',
        'Status',
        'Schreiben',
        'Lesen',
        'Skripte',
        'Verwendet in Skripten',
        'Initialwerte & Hinweise',
      ].map((h) => ({ value: h, style: S.TABLE_HEADER })),
    });
    if (vars.length === 0) {
      rows.push({
        height: 24,
        cells: Array.from({ length: colWidths.length }, (_, i) => ({
          value: i === 0 ? 'Keine Variablen oder System-Kontextwerte erkannt.' : '',
          style: S.BODY_EVEN,
        })),
      });
    } else {
      vars.forEach((v, idx) => {
        const isOdd = idx % 2 === 1;
        const bodyStyle = isOdd ? S.BODY_ODD : S.BODY_EVEN;
        rows.push({
          height: 22,
          cells: [
            { value: v.subTypeLabel, style: bodyStyle },
            { value: v.name, style: isOdd ? S.SCRIPT_ODD : S.SCRIPT_EVEN },
            { value: v.statusLabel, style: statusToExcelStyle(v.status) },
            { value: v.writeCount ?? 0, style: isOdd ? S.NUM_ODD : S.NUM_EVEN, type: 'num' },
            { value: v.readCount ?? 0, style: isOdd ? S.NUM_ODD : S.NUM_EVEN, type: 'num' },
            { value: v.scriptCount, style: isOdd ? S.NUM_ODD : S.NUM_EVEN, type: 'num' },
            { value: v.scriptsSummary, style: bodyStyle },
            { value: v.details, style: bodyStyle },
          ],
        });
      });
    }
    sheets.push({
      name: 'Variablen',
      tabColorHex: '7C3AED',
      colWidths,
      rows,
      merges: banner.merges,
      freezeRows: 4,
      autoFilterRef: `A4:${excelColLetter(colWidths.length - 1)}${Math.max(4, rows.length)}`,
    });
  }

  // 6. Externe DB, Hist & APIs
  sheets.push(
    buildDomainInventorySheet({
      sheetName: 'Externe DB & APIs',
      tabColorHex: 'D97706',
      title: `Externe DB-, History-, HDX- & API-Aufrufe${titleSuffix}`,
      subtitle: kpiLine,
      items: byCat('external_db_hist_api'),
      emptyMessage: 'Keine externen DB-, Hist-, HDX- oder API-Aufrufe erkannt.',
    })
  );

  // 7. Subflows & Zeitpläne
  sheets.push(
    buildDomainInventorySheet({
      sheetName: 'Subflows & Zeitpläne',
      tabColorHex: '0D9488',
      title: `Subflows, Common Modules, Zeitpläne & Feiertage${titleSuffix}`,
      subtitle: kpiLine,
      items: [...byCat('subflows_modules'), ...byCat('schedules_holidays')],
      emptyMessage: 'Keine Subflows, Module, Zeitpläne oder Feiertagsregeln erkannt.',
    })
  );

  // 8. Auffälligkeiten
  sheets.push(
    buildDomainInventorySheet({
      sheetName: 'Auffälligkeiten',
      tabColorHex: 'DC2626',
      title: `Unbenutzte, deaktivierte & fehlende Referenzen${titleSuffix}`,
      subtitle: kpiLine,
      items: byCat('anomalies_references'),
      emptyMessage: 'Keine unbenutzten, deaktivierten oder fehlenden Referenzen erkannt.',
    })
  );

  // 9. Fundstellen-Details (alle Einzelfunde mit Skript, Section & Zeile)
  {
    const colWidths = [22, 22, 28, 14, 15, 24, 22, 9, 18, 46];
    const banner = makeXlsxBannerRows(
      colWidths.length,
      `Fundstellen-Details (Skript · Section · Zeilennummer)${titleSuffix}`,
      `${bundle.occurrences.length} exakte Vorkommen über ${bundle.scriptCount} geladene Skripte`
    );
    const rows: XlsxRowSpec[] = [...banner.rows];
    rows.push({
      height: 24,
      cells: [
        'Kategorie',
        'Typ',
        'Element / Name',
        'Status',
        'Skript-Nr.',
        'Skript-Name',
        'Section / Bereich',
        'Zeile',
        'Befehl',
        'Quelltext-Auszug (bereinigt)',
      ].map((h) => ({ value: h, style: S.TABLE_HEADER })),
    });

    if (bundle.occurrences.length === 0) {
      rows.push({
        height: 24,
        cells: Array.from({ length: colWidths.length }, (_, i) => ({
          value: i === 0 ? 'Keine Fundstellen im aktuellen Workspace vorhanden.' : '',
          style: S.BODY_EVEN,
        })),
      });
    } else {
      bundle.occurrences.forEach((occ, idx) => {
        const isOdd = idx % 2 === 1;
        const bodyStyle = isOdd ? S.BODY_ODD : S.BODY_EVEN;
        rows.push({
          height: 21,
          cells: [
            { value: occ.categoryLabel, style: bodyStyle },
            { value: occ.subTypeLabel, style: bodyStyle },
            { value: occ.itemName, style: isOdd ? S.SCRIPT_ODD : S.SCRIPT_EVEN },
            { value: occ.statusLabel, style: statusToExcelStyle(occ.status) },
            { value: occ.scriptNumber, style: isOdd ? S.SCRIPT_ODD : S.SCRIPT_EVEN },
            { value: occ.scriptName, style: bodyStyle },
            { value: occ.sectionName, style: bodyStyle },
            { value: occ.lineNumber, style: isOdd ? S.NUM_ODD : S.NUM_EVEN, type: 'num' },
            { value: occ.command, style: bodyStyle },
            { value: occ.contextSnippet, style: bodyStyle },
          ],
        });
      });
    }

    sheets.push({
      name: 'Fundstellen-Details',
      tabColorHex: '334155',
      colWidths,
      rows,
      merges: banner.merges,
      freezeRows: 4,
      autoFilterRef: `A4:${excelColLetter(colWidths.length - 1)}${Math.max(4, rows.length)}`,
    });
  }

  return assembleXlsxPackageFiles(sheets);
}

export async function exportInventoryXlsxUint8Array(
  bundle: WorkspaceInventoryBundle
): Promise<Uint8Array> {
  const fileMap = buildInventoryXlsxFileMap(bundle);
  const zip = new JSZip();
  for (const [zipPath, content] of Object.entries(fileMap)) {
    zip.file(zipPath, content);
  }
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function exportInventoryXlsxBlob(
  bundle: WorkspaceInventoryBundle
): Promise<Blob> {
  const bytes = await exportInventoryXlsxUint8Array(bundle);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// Re-export sheet blob helper if callers build custom sheets
export { exportXlsxSheetsBlob, exportXlsxSheetsUint8Array };
