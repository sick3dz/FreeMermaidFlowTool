/**
 * 100 % In-Memory Avaya AACC / OCL & Visio Callflow Graph-Audit Engine
 *
 * Strikte Datenschutz- & Runtime-Vorgabe:
 * - KEIN Dateisystem-I/O (`fs`, `path`) und KEINE Netzwerk-Aufrufe (`fetch`, `XMLHttpRequest`).
 * - Reine, seiteneffektfreie In-Memory-Verarbeitung (Browser-RAM, Offline-HTML, Vitest).
 * - Exportierte Reports enthalten ausschliesslich Dateinamen, Skript-Keys, Befehlstypen,
 *   Zeilennummern und Struktur-Metriken – niemals Roh-Skript-Inhalte oder Kundendaten.
 */
import { ScriptModule, ScriptRule, ScriptWorkspace } from '../types/mermaidStudio';
import {
  canonicalScriptMatchKey,
  classifyAvayaWaypointTarget,
  classifyExtractedTarget,
  extractOclDeclaredVariables,
  isDeactivatedSentinelTarget,
  isDynamicAvayaVariableTarget,
  isValidScriptRef,
  normalizeScriptRef,
  splitInlineIfThenElseClauses,
  splitOclStatementsOutsideQuotes,
  stripKnownScriptExtension,
} from './scriptCallflowParser';
import { detectExternalApiIntegration } from './flixcheckSpec';
import { extractFirstScriptTargetRef } from './visioParser';

export type AuditEdgeTargetType =
  | 'LOCAL_SCRIPT'
  | 'FLIXCHECK'
  | 'ORACLE'
  | 'AVAYA_WAYPOINT'
  | 'CDN_NUMBER'
  | 'SKILLSET_QUEUE'
  | 'MISSING_OR_BROKEN';

export interface ParsedScriptEdge {
  targetType: AuditEdgeTargetType;
  rawTarget: string;
  targetKey: string;
  command: string;
  lineNumber: number;
  reason?: string;
  provider?: 'flixcheck' | 'oracle';
}

export interface ParsedScriptNode {
  scriptKey: string;
  scriptNumber: string;
  fileName: string;
  scriptName: string;
  origin: 'legacy-text' | 'visio-new';
  isEntryPoint: boolean;
  entryPointReasons: string[];
  hasTermination: boolean;
  terminationCommands: string[];
  edges: ParsedScriptEdge[];
}

export interface BrokenLinkFinding {
  sourceScriptKey: string;
  sourceFileName: string;
  targetRaw: string;
  targetKey: string;
  targetType: 'LOCAL_SCRIPT' | 'MISSING_OR_BROKEN';
  command: string;
  lineNumber: number;
  reason?: string;
}

export interface OrphanScriptFinding {
  scriptKey: string;
  scriptNumber: string;
  fileName: string;
  scriptName: string;
  outgoingEdgeCount: number;
}

export interface DeadEndScriptFinding {
  scriptKey: string;
  scriptNumber: string;
  fileName: string;
  scriptName: string;
  hasSkillsetQueue: boolean;
  skillsetQueues: string[];
  note: string;
}

export interface CircularLoopFinding {
  cycleKeys: string[];
  cycleFileNames: string[];
  length: number;
  signature: string;
}

export interface ExternalIntegrationFinding {
  system: 'FlixCheck' | 'Oracle';
  sourceScriptKey: string;
  sourceFileName: string;
  targetRaw: string;
  targetKey: string;
  command: string;
  lineNumber: number;
  category: string;
}

export interface AuditSummaryMetrics {
  totalScripts: number;
  entryPointCount: number;
  totalEdges: number;
  brokenLinkCount: number;
  orphanScriptCount: number;
  deadEndScriptCount: number;
  deadEndWithQueueHintCount: number;
  circularLoopCount: number;
  externalIntegrationCount: number;
  flixcheckCallCount: number;
  oracleCallCount: number;
}

export interface AuditReport {
  schemaVersion: string;
  generatedAt: string;
  privacyMode: '100%-in-memory-metadata-only';
  summary: AuditSummaryMetrics;
  nodes: ParsedScriptNode[];
  brokenLinks: BrokenLinkFinding[];
  orphanScripts: OrphanScriptFinding[];
  deadEndScripts: DeadEndScriptFinding[];
  circularLoops: CircularLoopFinding[];
  externalIntegrations: ExternalIntegrationFinding[];
}

export interface AdaptAuditNodesOptions {
  visioModules?: ScriptModule[];
  masterScriptNumber?: string;
  entryScriptKeys?: Iterable<string>;
  avayaWaypoints?: Iterable<string>;
  externalEndpoints?: Iterable<string>;
  manualLinks?: Array<{
    fromScriptNumber: string;
    toTargetNumber: string;
    label?: string;
  }>;
  treatUnresolvedAsEndpoint?: boolean;
}

export interface RunCallflowAuditOptions extends AdaptAuditNodesOptions {
  generatedAt?: string;
}

export interface ArchitectureMermaidOptions {
  maxHubScripts?: number;
}

export interface AuditSummaryTableRow {
  Kategorie: string;
  Anzahl: number;
  Status: string;
}

export interface AuditExportPayloads {
  jsonContent: string;
  mermaidContent: string;
  jsonFilename: 'avaya-callflow-audit.json';
  mermaidFilename: 'architecture-overview.mmd';
}

const FORWARDING_EDGE_TYPES = new Set<AuditEdgeTargetType>([
  'LOCAL_SCRIPT',
  'FLIXCHECK',
  'AVAYA_WAYPOINT',
  'CDN_NUMBER',
]);

const TERMINATION_PATTERNS: Array<{ command: string; regex: RegExp }> = [
  { command: 'DISCONNECT', regex: /\bDISCONNECT\b/i },
  { command: 'DROP CALL', regex: /\bDROP\s+CALL\b/i },
  { command: 'ROUTE END', regex: /\bROUTE\s+END\b/i },
  { command: 'GIVE CDN', regex: /\bGIVE\s+CDN\b/i },
  { command: 'TRANSFER TO', regex: /\bTRANSFER\s+TO\b/i },
  { command: 'ROUTE CALL', regex: /\bROUTE\s+CALL\b/i },
];

const FLIXCHECK_SIGNAL_RE =
  /flix[\s_.-]*check|(?:^|[_.\-\s/"'])(?:flix|call[\s_-]*deflection|deflection)(?:$|[_.\-\s\d/"'])/i;
const ORACLE_SIGNAL_RE = /(?:^|[_.\-\s/"'])oracle(?:$|[_.\-\s\d/"'])|oracle/i;

function isFlixcheckSignal(text: string): boolean {
  return FLIXCHECK_SIGNAL_RE.test(text);
}

function isOracleSignal(text: string): boolean {
  return ORACLE_SIGNAL_RE.test(text);
}

function isNonExecMessageStmt(stmt: string): boolean {
  return /^(?:send\s+(?:info|message|request|response)|give\s+(?:ran|music|ringback|busy|silence|ivr|announcement|treatment)|print|log|trace|write|set|assign|declare|var|global|const|get\s+response|readvar)\b/i.test(
    stmt.trim()
  );
}

/**
 * Strips inline and block comments from OCL lines while preserving 1-based line numbers.
 */
function stripCommentsPreservingLines(rawText: string): string[] {
  const lines = rawText.split(/\r?\n/);
  const result: string[] = [];
  let inBlockComment = false;

  for (const rawLine of lines) {
    let out = '';
    let i = 0;
    let inQuote: '"' | "'" | null = null;

    while (i < rawLine.length) {
      const ch = rawLine[i];
      const next = i + 1 < rawLine.length ? rawLine[i + 1] : '';

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i += 2;
          out += ' ';
        } else {
          i += 1;
        }
        continue;
      }

      if (inQuote) {
        out += ch;
        if (ch === '\\' && next) {
          out += next;
          i += 2;
          continue;
        }
        if (ch === inQuote) {
          inQuote = null;
        }
        i += 1;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inQuote = ch;
        out += ch;
        i += 1;
        continue;
      }

      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 2;
        out += ' ';
        continue;
      }

      if ((ch === '/' && next === '/') || (ch === '-' && next === '-') || ch === '#') {
        break;
      }

      out += ch;
      i += 1;
    }

    result.push(out);
  }

  return result;
}

function resolveFileName(mod: ScriptModule): string {
  if (mod.sourceFilename && mod.sourceFilename.trim()) {
    return mod.sourceFilename.trim();
  }
  const base = normalizeScriptRef(mod.scriptNumber || mod.scriptName || 'unknown');
  if (mod.origin === 'visio-new') {
    return base.endsWith('.vsdx') || base.endsWith('.vdx') ? base : `${base}.vsdx`;
  }
  return /\.[a-z0-9]{1,5}$/i.test(base) ? base : `${base}.s`;
}

function resolveScriptKeyForModule(mod: ScriptModule): string {
  return canonicalScriptMatchKey(mod.scriptNumber || stripKnownScriptExtension(mod.sourceFilename || mod.scriptName));
}

function buildKnownScriptKeyLookup(modules: ScriptModule[]): Map<string, string> {
  // Maps canonical match keys (scriptNumber, cdnAlias, filename stem) -> primary module scriptKey
  const map = new Map<string, string>();
  for (const mod of modules) {
    const primaryKey = resolveScriptKeyForModule(mod);
    if (!primaryKey) continue;
    map.set(primaryKey, primaryKey);

    if (mod.cdnAlias) {
      const aliasKey = canonicalScriptMatchKey(mod.cdnAlias);
      if (aliasKey && !map.has(aliasKey)) {
        map.set(aliasKey, primaryKey);
      }
    }

    if (mod.sourceFilename) {
      const stemKey = canonicalScriptMatchKey(stripKnownScriptExtension(mod.sourceFilename));
      if (stemKey && !map.has(stemKey)) {
        map.set(stemKey, primaryKey);
      }
    }
  }
  return map;
}

interface TargetClassificationContext {
  knownKeyLookup: Map<string, string>;
  declaredVars: Set<string>;
  constStringValues: Map<string, string>;
  manualWaypointKeys: Set<string>;
  externalEndpointKeys: Set<string>;
  treatUnresolvedAsEndpoint: boolean;
}

function resolveVariableOrRawToken(
  rawToken: string,
  constStringValues: Map<string, string>
): { effectiveToken: string; resolvedFromVar: boolean } {
  const clean = rawToken.trim().replace(/^["']|["']$/g, '');
  const lower = clean.toLowerCase();
  if (constStringValues.has(lower)) {
    return { effectiveToken: constStringValues.get(lower)!, resolvedFromVar: true };
  }
  return { effectiveToken: clean, resolvedFromVar: false };
}

function classifyAuditEdgeTarget(
  rawToken: string,
  command: string,
  lineNumber: number,
  ctx: TargetClassificationContext,
  options?: { isAvayaRouteCmd?: boolean; forceSystem?: 'flixcheck' | 'oracle' }
): ParsedScriptEdge | null {
  const { effectiveToken } = resolveVariableOrRawToken(rawToken, ctx.constStringValues);
  const clean = normalizeScriptRef(stripKnownScriptExtension(effectiveToken));
  if (!clean) return null;

  const canonicalKey = canonicalScriptMatchKey(clean);
  if (!canonicalKey) return null;

  // API/Host explicit FlixCheck or Oracle command
  if (options?.forceSystem === 'flixcheck') {
    return {
      targetType: 'FLIXCHECK',
      rawTarget: clean,
      targetKey: canonicalKey,
      command,
      lineNumber,
      reason: `FlixCheck API (${command})`,
      provider: 'flixcheck',
    };
  }
  if (options?.forceSystem === 'oracle') {
    return {
      targetType: 'ORACLE',
      rawTarget: clean,
      targetKey: canonicalKey,
      command,
      lineNumber,
      reason: `Oracle-Schnittstelle (${command})`,
      provider: 'oracle',
    };
  }

  // Exclude sentinels and unresolved declared OCL variables
  if (
    isDeactivatedSentinelTarget(clean) ||
    isDynamicAvayaVariableTarget(clean, ctx.declaredVars)
  ) {
    return null;
  }

  // Strict 5-step classification from scriptCallflowParser.ts
  const classification = classifyExtractedTarget(clean, {
    knownScriptKeys: ctx.knownKeyLookup,
    declaredVars: ctx.declaredVars,
    isAvayaRouteCmd: options?.isAvayaRouteCmd,
    manualWaypointKeys: ctx.manualWaypointKeys,
    externalEndpointKeys: ctx.externalEndpointKeys,
    treatUnresolvedAsEndpoint: ctx.treatUnresolvedAsEndpoint,
  });

  if (classification.category === 'ignored') {
    return null;
  }

  // Known local script ALWAYS resolves to LOCAL_SCRIPT (primary pool key)
  if (classification.category === 'known-script') {
    const resolvedKey = ctx.knownKeyLookup.get(classification.canonicalKey) || classification.canonicalKey;
    const provider: 'flixcheck' | 'oracle' | undefined = isFlixcheckSignal(clean)
      ? 'flixcheck'
      : isOracleSignal(clean)
      ? 'oracle'
      : undefined;
    return {
      targetType: 'LOCAL_SCRIPT',
      rawTarget: clean,
      targetKey: resolvedKey,
      command,
      lineNumber,
      reason: classification.reason,
      provider,
    };
  }

  // Classify waypoint sub-types into FLIXCHECK, ORACLE, CDN_NUMBER, or AVAYA_WAYPOINT
  if (classification.category === 'avaya-waypoint') {
    const waypointReason =
      classification.reason ||
      classifyAvayaWaypointTarget(clean, {
        isAvayaRouteCmd: options?.isAvayaRouteCmd,
        knownScriptKeys: ctx.knownKeyLookup,
        declaredVars: ctx.declaredVars,
      }) ||
      'Avaya-Wegweiser';

    if (/flixcheck/i.test(waypointReason) || isFlixcheckSignal(clean)) {
      return {
        targetType: 'FLIXCHECK',
        rawTarget: clean,
        targetKey: classification.canonicalKey,
        command,
        lineNumber,
        reason: waypointReason,
        provider: 'flixcheck',
      };
    }

    if (/oracle/i.test(waypointReason) || isOracleSignal(clean)) {
      return {
        targetType: 'ORACLE',
        rawTarget: clean,
        targetKey: classification.canonicalKey,
        command,
        lineNumber,
        reason: waypointReason,
        provider: 'oracle',
      };
    }

    if (/avaya-nummer\s*\/\s*cdn/i.test(waypointReason) || /^\+?\d{2,16}$/.test(clean)) {
      return {
        targetType: 'CDN_NUMBER',
        rawTarget: clean,
        targetKey: classification.canonicalKey,
        command,
        lineNumber,
        reason: waypointReason,
      };
    }

    return {
      targetType: 'AVAYA_WAYPOINT',
      rawTarget: clean,
      targetKey: classification.canonicalKey,
      command,
      lineNumber,
      reason: waypointReason,
    };
  }

  if (classification.category === 'external-endpoint') {
    // Announcement / explicitly marked external endpoints still check FlixCheck/Oracle signals
    if (isFlixcheckSignal(clean)) {
      return {
        targetType: 'FLIXCHECK',
        rawTarget: clean,
        targetKey: classification.canonicalKey,
        command,
        lineNumber,
        reason: classification.reason || 'FlixCheck-Endpunkt',
        provider: 'flixcheck',
      };
    }
    if (isOracleSignal(clean)) {
      return {
        targetType: 'ORACLE',
        rawTarget: clean,
        targetKey: classification.canonicalKey,
        command,
        lineNumber,
        reason: classification.reason || 'Oracle-Endpunkt',
        provider: 'oracle',
      };
    }
    return {
      targetType: 'AVAYA_WAYPOINT',
      rawTarget: clean,
      targetKey: classification.canonicalKey,
      command,
      lineNumber,
      reason: classification.reason || 'Externer Endpunkt',
    };
  }

  // Remaining unknown script reference -> MISSING_OR_BROKEN
  return {
    targetType: 'MISSING_OR_BROKEN',
    rawTarget: clean,
    targetKey: classification.canonicalKey,
    command,
    lineNumber,
    reason: classification.reason || 'Missing / External Script',
  };
}

function findLineNumberForRule(rule: ScriptRule, rawLines: string[]): number {
  const needle = (rule.rawLine || '').trim();
  if (needle && rawLines.length > 0) {
    const lowerNeedle = needle.toLowerCase();
    for (let i = 0; i < rawLines.length; i += 1) {
      if (rawLines[i].toLowerCase().includes(lowerNeedle)) {
        return i + 1;
      }
    }
  }
  return rule.prio > 0 ? rule.prio : 0;
}

function extractEdgesAndTerminationsFromModule(
  mod: ScriptModule,
  ctx: TargetClassificationContext
): {
  edges: ParsedScriptEdge[];
  hasTermination: boolean;
  terminationCommands: string[];
} {
  const edges: ParsedScriptEdge[] = [];
  const edgeDedup = new Set<string>();
  const terminationSet = new Set<string>();

  const pushEdge = (edge: ParsedScriptEdge | null) => {
    if (!edge) return;
    const dedupKey = `${edge.targetType}::${edge.targetKey}::${edge.command}::${edge.lineNumber}`;
    if (edgeDedup.has(dedupKey)) return;
    edgeDedup.add(dedupKey);
    edges.push(edge);
  };

  const rawText = mod.rawText || '';
  const strippedLines = rawText ? stripCommentsPreservingLines(rawText) : [];
  const rawLines = rawText ? rawText.split(/\r?\n/) : [];

  // Pre-scan local SECTION definitions & declared OCL variables for this script
  const localSections = new Set<string>();
  for (const line of strippedLines) {
    const secMatch = line.match(/^\s*SECTION\s+([A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_.-]*)/i);
    if (secMatch) {
      localSections.add(secMatch[1].trim().toLowerCase());
    }
  }

  const extractedVars = extractOclDeclaredVariables(strippedLines);
  const moduleCtx: TargetClassificationContext = {
    ...ctx,
    declaredVars: new Set([...ctx.declaredVars, ...extractedVars.declaredVars]),
    constStringValues: new Map([...ctx.constStringValues, ...extractedVars.staticStringLiterals]),
  };

  // Pass 1: Line-accurate scan of OCL rawText
  for (let i = 0; i < strippedLines.length; i += 1) {
    const lineNumber = i + 1;
    const line = strippedLines[i].trim();
    if (!line) continue;

    // 1a. Detect termination commands on this line
    for (const term of TERMINATION_PATTERNS) {
      if (term.regex.test(line)) {
        terminationSet.add(term.command);
      }
    }

    // 1b. Split inline IF ... THEN / ELSE and multi-statement segments
    const clauses = splitInlineIfThenElseClauses(line);
    const statements: string[] = [];
    for (const clause of clauses) {
      if (!clause.action) continue;
      for (const stmt of splitOclStatementsOutsideQuotes(clause.action)) {
        const trimmed = stmt.trim();
        if (trimmed) statements.push(trimmed);
      }
    }

    for (const stmt of statements) {
      // External API / Host commands (SEND REQUEST, GET RESPONSE, SEND INFO, HOST)
      const apiCmdMatch = stmt.match(
        /^(SEND\s+REQUEST|GET\s+RESPONSE|SEND\s+INFO|HOST(?:\s+CALL)?|READVAR)\b(.*)$/i
      );
      if (apiCmdMatch) {
        const cmdLabel = apiCmdMatch[1].replace(/\s+/g, ' ').toUpperCase();
        const rest = (apiCmdMatch[2] || '').trim();
        const apiCommandKind =
          cmdLabel === 'SEND REQUEST'
            ? 'send-request'
            : cmdLabel === 'GET RESPONSE'
            ? 'get-response'
            : cmdLabel === 'SEND INFO'
            ? 'send-info'
            : cmdLabel === 'READVAR'
            ? 'readvar'
            : 'host-call';
        const firstArgToken =
          rest.match(/["']([^"']+)["']/)?.[1] || rest.split(/[\s,;]+/)[0] || undefined;
        const flixMeta = detectExternalApiIntegration({
          commandKind: apiCommandKind,
          providerId: firstArgToken,
          argsText: rest,
          rawLine: stmt,
          activeVars: moduleCtx.constStringValues,
          moduleContextText: mod.scriptName || mod.scriptNumber || '',
        });
        if (flixMeta?.isFlixcheck || isFlixcheckSignal(stmt)) {
          const targetToken =
            flixMeta?.providerId ||
            flixMeta?.endpointPath ||
            firstArgToken ||
            'FlixCheck_API';
          pushEdge(
            classifyAuditEdgeTarget(targetToken, cmdLabel, lineNumber, moduleCtx, {
              forceSystem: 'flixcheck',
            })
          );
        } else if (isOracleSignal(stmt)) {
          const targetToken = firstArgToken || 'Oracle_Host';
          pushEdge(
            classifyAuditEdgeTarget(targetToken, cmdLabel, lineNumber, moduleCtx, {
              forceSystem: 'oracle',
            })
          );
        }
        continue;
      }

      // QUEUE TO [NETWORK] SKILLSET a, b, c [WITH PRIORITY n]
      const queueMatch = stmt.match(
        /\bQUEUE\s+TO\s+(?:NETWORK\s+)?(?:SKILLSET|AGENT)\s+(.+?)(?:\s+WITH\s+PRIORITY\b|\s+PRIORITY\b|$)/i
      );
      if (queueMatch) {
        const rawList = queueMatch[1].trim();
        const items = rawList
          .split(',')
          .map((item) => item.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
        for (const item of items) {
          const cleanQueue = normalizeScriptRef(item);
          if (!cleanQueue || isDeactivatedSentinelTarget(cleanQueue)) continue;
          const isOracleQueue = isOracleSignal(cleanQueue);
          pushEdge({
            targetType: isOracleQueue ? 'ORACLE' : 'SKILLSET_QUEUE',
            rawTarget: cleanQueue,
            targetKey: canonicalScriptMatchKey(cleanQueue),
            command: 'QUEUE TO',
            lineNumber,
            reason: isOracleQueue ? 'Oracle Skillset-Queuing' : 'Skillset-Warteschlange',
            provider: isOracleQueue ? 'oracle' : undefined,
          });
        }
        continue;
      }

      // GIVE CDN <target>
      const giveCdnMatch = stmt.match(
        /\bGIVE\s+CDN\s+(?:"([^"]+)"|'([^']+)'|(\+?\d{2,16}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]*))/i
      );
      if (giveCdnMatch) {
        const token = (giveCdnMatch[1] || giveCdnMatch[2] || giveCdnMatch[3] || '').trim();
        if (token) {
          pushEdge(
            classifyAuditEdgeTarget(token, 'GIVE CDN', lineNumber, moduleCtx, {
              isAvayaRouteCmd: true,
            })
          );
        }
        continue;
      }

      // TRANSFER TO / ROUTE CALL [TO] <target>
      const routeMatch = stmt.match(
        /\b(TRANSFER\s+TO|ROUTE\s+CALL(?:\s+TO)?)\s+(?:CDN\s+|VDN\s+|SCRIPT\s+)?(?:"([^"]+)"|'([^']+)'|(\+?\d{2,16}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]*))/i
      );
      if (routeMatch) {
        const cmd = routeMatch[1].replace(/\s+TO$/i, (m) =>
          routeMatch[1].toUpperCase().startsWith('TRANSFER') ? m : ''
        )
          .replace(/\s+/g, ' ')
          .trim()
          .toUpperCase();
        const token = (routeMatch[2] || routeMatch[3] || routeMatch[4] || '').trim();
        if (token) {
          pushEdge(
            classifyAuditEdgeTarget(token, cmd, lineNumber, moduleCtx, {
              isAvayaRouteCmd: true,
            })
          );
        }
        continue;
      }

      // GOTO <label> -> internal section check first, external fallback only if known script
      const gotoMatch = stmt.match(
        /\bGOTO\s+(?:"([^"]+)"|'([^']+)'|([A-Za-zÄÖÜäöüß0-9_.-]+))/i
      );
      if (gotoMatch) {
        const token = (gotoMatch[1] || gotoMatch[2] || gotoMatch[3] || '').trim();
        if (token && !localSections.has(token.toLowerCase())) {
          const { effectiveToken } = resolveVariableOrRawToken(token, moduleCtx.constStringValues);
          const candidateKey = canonicalScriptMatchKey(stripKnownScriptExtension(effectiveToken));
          if (candidateKey && moduleCtx.knownKeyLookup.has(candidateKey)) {
            pushEdge(classifyAuditEdgeTarget(effectiveToken, 'GOTO', lineNumber, moduleCtx));
          }
        }
        continue;
      }

      // External execution commands: EXECUTE [SCRIPT], CALL SCRIPT, SUBSCRIPT, standalone CALL <target>
      if (!isNonExecMessageStmt(stmt)) {
        const execMatch =
          stmt.match(
            /\b(EXECUTE(?:\s+SCRIPT)?|CALL\s+SCRIPT|SUBSCRIPT)\s+(?:"([^"]+)"|'([^']+)'|(\+?\d{2,16}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]*))/i
          ) ||
          stmt.match(
            /^(CALL)\s+(?:"([^"]+)"|'([^']+)'|(\+?\d{2,16}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]*))/i
          );
        if (execMatch) {
          const cmd = execMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
          const token = (execMatch[2] || execMatch[3] || execMatch[4] || '').trim();
          if (token) {
            pushEdge(classifyAuditEdgeTarget(token, cmd, lineNumber, moduleCtx));
          }
        }
      }
    }
  }

  // Pass 2: Supplement from structured ScriptRule objects (essential for Visio modules,
  // shorthand DSL scripts like "Wohin: X | Taste 1->Y", and synthetic mock modules)
  const seenTargetCommandPairs = new Set<string>(
    edges.map((e) => `${e.targetType}::${e.targetKey}`)
  );

  for (const rule of mod.rules || []) {
    const lineNumber = findLineNumberForRule(rule, rawLines);

    if (rule.isDisconnect) {
      terminationSet.add('DISCONNECT');
    }
    if (rule.isExternalRouteCall) {
      terminationSet.add('ROUTE CALL');
    }
    if (rule.queueKind === 'cdn') {
      terminationSet.add('GIVE CDN');
    }

    if (rule.externalIntegration?.isFlixcheck) {
      const targetToken =
        rule.externalIntegration.providerId ||
        rule.externalIntegration.endpointPath ||
        'FlixCheck_API';
      const key = `FLIXCHECK::${canonicalScriptMatchKey(targetToken)}`;
      if (!seenTargetCommandPairs.has(key)) {
        seenTargetCommandPairs.add(key);
        const cmd = rule.externalIntegration.commandKind.replace(/-/g, ' ').toUpperCase();
        pushEdge(
          classifyAuditEdgeTarget(targetToken, cmd, lineNumber, moduleCtx, {
            forceSystem: 'flixcheck',
          })
        );
      }
    }

    if (rule.queueTarget) {
      const queues = rule.queueTarget
        .split(',')
        .map((q) => q.trim())
        .filter(Boolean);
      for (const q of queues) {
        const cleanQueue = normalizeScriptRef(q);
        if (!cleanQueue || isDeactivatedSentinelTarget(cleanQueue)) continue;
        const isOracleQueue = isOracleSignal(cleanQueue);
        const targetType: AuditEdgeTargetType = isOracleQueue ? 'ORACLE' : 'SKILLSET_QUEUE';
        const qKey = canonicalScriptMatchKey(cleanQueue);
        const pairKey = `${targetType}::${qKey}`;
        if (!seenTargetCommandPairs.has(pairKey)) {
          seenTargetCommandPairs.add(pairKey);
          pushEdge({
            targetType,
            rawTarget: cleanQueue,
            targetKey: qKey,
            command: 'QUEUE TO',
            lineNumber,
            reason: isOracleQueue ? 'Oracle Skillset-Queuing' : 'Skillset-Warteschlange',
            provider: isOracleQueue ? 'oracle' : undefined,
          });
        }
      }
    }

    if (rule.targetNumber) {
      const cmd =
        mod.origin === 'visio-new'
          ? 'VISIO FLOW'
          : rule.isExternalRouteCall
          ? 'ROUTE CALL'
          : rule.queueKind === 'cdn'
          ? 'GIVE CDN'
          : rule.isGotoFallback
          ? 'GOTO'
          : 'EXECUTE';
      const classified = classifyAuditEdgeTarget(rule.targetNumber, cmd, lineNumber, moduleCtx, {
        isAvayaRouteCmd: Boolean(rule.isExternalRouteCall || rule.queueKind === 'cdn'),
      });
      if (classified) {
        const pairKey = `${classified.targetType}::${classified.targetKey}`;
        if (!seenTargetCommandPairs.has(pairKey)) {
          seenTargetCommandPairs.add(pairKey);
          pushEdge(classified);
        }
      }
    }

    for (const ch of rule.choices || []) {
      if (!ch.targetNumber) continue;
      const cmd = mod.origin === 'visio-new' ? 'VISIO BRANCH' : 'DTMF / BRANCH';
      const classified = classifyAuditEdgeTarget(ch.targetNumber, cmd, lineNumber, moduleCtx);
      if (classified) {
        const pairKey = `${classified.targetType}::${classified.targetKey}`;
        if (!seenTargetCommandPairs.has(pairKey)) {
          seenTargetCommandPairs.add(pairKey);
          pushEdge(classified);
        }
      }
    }
  }

  return {
    edges,
    hasTermination: terminationSet.size > 0,
    terminationCommands: Array.from(terminationSet),
  };
}

/**
 * Adapts parsed ScriptModule objects (from scriptCallflowParser.ts & visioParser.ts)
 * into the unified ParsedScriptNode graph model for automated auditing.
 */
export function adaptModulesToParsedScriptNodes(
  modules: ScriptModule[],
  options?: AdaptAuditNodesOptions
): ParsedScriptNode[] {
  const allModules: ScriptModule[] = [...modules];
  if (options?.visioModules?.length) {
    const existingKeys = new Set(allModules.map((m) => resolveScriptKeyForModule(m)));
    for (const vm of options.visioModules) {
      const key = resolveScriptKeyForModule(vm);
      if (key && !existingKeys.has(key)) {
        allModules.push(vm);
        existingKeys.add(key);
      }
    }
  }

  const knownKeyLookup = buildKnownScriptKeyLookup(allModules);
  const manualWaypointKeys = new Set<string>(
    Array.from(options?.avayaWaypoints || []).map((t) => canonicalScriptMatchKey(t)).filter(Boolean)
  );
  const externalEndpointKeys = new Set<string>(
    Array.from(options?.externalEndpoints || []).map((t) => canonicalScriptMatchKey(t)).filter(Boolean)
  );
  const explicitEntryKeys = new Set<string>(
    Array.from(options?.entryScriptKeys || []).map((t) => canonicalScriptMatchKey(t)).filter(Boolean)
  );
  const masterKey = options?.masterScriptNumber
    ? canonicalScriptMatchKey(options.masterScriptNumber)
    : '';

  // Collect all script keys referenced directly from Visio flows (entry points)
  const visioTargetKeys = new Set<string>();
  for (const mod of allModules) {
    if (mod.origin !== 'visio-new') continue;
    for (const outRef of mod.outgoingNumbers || []) {
      const k = canonicalScriptMatchKey(outRef);
      if (k) visioTargetKeys.add(knownKeyLookup.get(k) || k);
    }
    for (const rule of mod.rules || []) {
      if (rule.targetNumber) {
        const k = canonicalScriptMatchKey(rule.targetNumber);
        if (k) visioTargetKeys.add(knownKeyLookup.get(k) || k);
      }
      for (const ch of rule.choices || []) {
        if (ch.targetNumber) {
          const k = canonicalScriptMatchKey(ch.targetNumber);
          if (k) visioTargetKeys.add(knownKeyLookup.get(k) || k);
        }
      }
      if (rule.rawLine) {
        const extracted = extractFirstScriptTargetRef(rule.rawLine);
        if (extracted && isValidScriptRef(extracted)) {
          const k = canonicalScriptMatchKey(extracted);
          if (k) visioTargetKeys.add(knownKeyLookup.get(k) || k);
        }
      }
    }
  }

  const baseCtx: TargetClassificationContext = {
    knownKeyLookup,
    declaredVars: new Set<string>(),
    constStringValues: new Map<string, string>(),
    manualWaypointKeys,
    externalEndpointKeys,
    treatUnresolvedAsEndpoint: Boolean(options?.treatUnresolvedAsEndpoint),
  };

  const nodesByKey = new Map<string, ParsedScriptNode>();
  const orderedNodes: ParsedScriptNode[] = [];

  for (const mod of allModules) {
    const scriptKey = resolveScriptKeyForModule(mod);
    if (!scriptKey || nodesByKey.has(scriptKey)) continue;

    const entryPointReasons: string[] = [];
    if (mod.origin === 'visio-new') entryPointReasons.push('Visio-Flow');
    if (visioTargetKeys.has(scriptKey)) entryPointReasons.push('Visio-Einstiegspunkt');
    if (mod.isMaster || (masterKey && scriptKey === masterKey)) {
      entryPointReasons.push('Master-Skript');
    }
    if (mod.entryDnisNumbers && mod.entryDnisNumbers.length > 0) {
      entryPointReasons.push('Externe DNIS/CDN');
    }
    if (mod.cdnAlias) {
      entryPointReasons.push('CDN-Alias');
    }
    if (explicitEntryKeys.has(scriptKey)) {
      entryPointReasons.push('Externer Einstiegspunkt');
    }

    const { edges, hasTermination, terminationCommands } = extractEdgesAndTerminationsFromModule(
      mod,
      baseCtx
    );

    const node: ParsedScriptNode = {
      scriptKey,
      scriptNumber: mod.scriptNumber,
      fileName: resolveFileName(mod),
      scriptName: mod.scriptName || mod.scriptNumber,
      origin: mod.origin === 'visio-new' ? 'visio-new' : 'legacy-text',
      isEntryPoint: entryPointReasons.length > 0,
      entryPointReasons,
      hasTermination,
      terminationCommands,
      edges,
    };

    nodesByKey.set(scriptKey, node);
    orderedNodes.push(node);
  }

  // Merge optional workspace manualLinks
  for (const link of options?.manualLinks || []) {
    const fromKey =
      knownKeyLookup.get(canonicalScriptMatchKey(link.fromScriptNumber)) ||
      canonicalScriptMatchKey(link.fromScriptNumber);
    const fromNode = nodesByKey.get(fromKey);
    if (!fromNode) continue;

    const classified = classifyAuditEdgeTarget(link.toTargetNumber, 'MANUAL LINK', 0, baseCtx);
    if (classified) {
      const exists = fromNode.edges.some(
        (e) => e.targetType === classified.targetType && e.targetKey === classified.targetKey
      );
      if (!exists) {
        fromNode.edges.push(classified);
      }
    }
  }

  return orderedNodes;
}

/**
 * Adapts a full ScriptWorkspace into ParsedScriptNode[] for runCallflowAudit().
 */
export function adaptWorkspaceToParsedScriptNodes(
  workspace: ScriptWorkspace
): ParsedScriptNode[] {
  return adaptModulesToParsedScriptNodes(workspace.modules || [], {
    masterScriptNumber: workspace.masterScriptNumber,
    avayaWaypoints: workspace.avayaWaypoints,
    externalEndpoints: workspace.externalEndpoints,
    manualLinks: workspace.manualLinks,
    treatUnresolvedAsEndpoint: workspace.treatUnresolvedAsEndpoint,
  });
}

function isScriptWorkspace(input: unknown): input is ScriptWorkspace {
  return (
    Boolean(input) &&
    typeof input === 'object' &&
    Array.isArray((input as ScriptWorkspace).modules)
  );
}

function isParsedScriptNodeArray(input: unknown): input is ParsedScriptNode[] {
  if (!Array.isArray(input) || input.length === 0) return false;
  const first = input[0] as Partial<ParsedScriptNode>;
  return typeof first.scriptKey === 'string' && Array.isArray(first.edges);
}

function canonicalizeCycleKeys(cycleNodes: string[]): string[] {
  // cycleNodes has no repeated closing element; rotate so lexicographically smallest key is first
  if (cycleNodes.length <= 1) return [...cycleNodes, ...cycleNodes];
  let minIdx = 0;
  for (let i = 1; i < cycleNodes.length; i += 1) {
    if (cycleNodes[i] < cycleNodes[minIdx]) {
      minIdx = i;
    }
  }
  const rotated = [...cycleNodes.slice(minIdx), ...cycleNodes.slice(0, minIdx)];
  rotated.push(rotated[0]);
  return rotated;
}

/**
 * Runs all 5 automated graph checks strictly in-memory:
 * 1. Broken Links (`brokenLinks`)
 * 2. Orphan Scripts (`orphanScripts`)
 * 3. Dead-End Scripts (`deadEndScripts`, strictly flagged with optional Skillset-Queue hint)
 * 4. Circular Script Loops (`circularLoops`, DFS over LOCAL_SCRIPT edges)
 * 5. External Integrations Inventory (`externalIntegrations`, FlixCheck & Oracle)
 */
export function runCallflowAudit(
  input: ScriptWorkspace | ScriptModule[] | ParsedScriptNode[],
  options?: RunCallflowAuditOptions
): AuditReport {
  let nodes: ParsedScriptNode[];
  if (isScriptWorkspace(input)) {
    nodes = adaptWorkspaceToParsedScriptNodes(input);
  } else if (Array.isArray(input) && input.length === 0) {
    nodes = [];
  } else if (isParsedScriptNodeArray(input)) {
    nodes = input;
  } else {
    nodes = adaptModulesToParsedScriptNodes(input as ScriptModule[], options);
  }

  const nodeByKey = new Map<string, ParsedScriptNode>();
  for (const node of nodes) {
    nodeByKey.set(node.scriptKey, node);
  }

  // Track incoming LOCAL_SCRIPT references from OTHER scripts (excluding self-loops)
  const incomingCallerKeys = new Map<string, Set<string>>();
  for (const node of nodes) {
    incomingCallerKeys.set(node.scriptKey, new Set<string>());
  }

  const brokenLinks: BrokenLinkFinding[] = [];
  const externalIntegrations: ExternalIntegrationFinding[] = [];
  const localAdjacency = new Map<string, string[]>();

  let totalEdges = 0;

  for (const node of nodes) {
    const localTargets = new Set<string>();

    for (const edge of node.edges) {
      totalEdges += 1;

      // Check 1: Broken Links
      if (
        (edge.targetType === 'LOCAL_SCRIPT' || edge.targetType === 'MISSING_OR_BROKEN') &&
        !nodeByKey.has(edge.targetKey)
      ) {
        brokenLinks.push({
          sourceScriptKey: node.scriptKey,
          sourceFileName: node.fileName,
          targetRaw: edge.rawTarget,
          targetKey: edge.targetKey,
          targetType: edge.targetType,
          command: edge.command,
          lineNumber: edge.lineNumber,
          reason: edge.reason,
        });
      }

      // Build LOCAL_SCRIPT graph for Orphan & Cycle checks
      if (edge.targetType === 'LOCAL_SCRIPT' && nodeByKey.has(edge.targetKey)) {
        localTargets.add(edge.targetKey);
        if (edge.targetKey !== node.scriptKey) {
          incomingCallerKeys.get(edge.targetKey)?.add(node.scriptKey);
        }
      }

      // Check 5: External Integrations Inventory (FlixCheck & Oracle)
      if (edge.targetType === 'FLIXCHECK' || edge.provider === 'flixcheck') {
        externalIntegrations.push({
          system: 'FlixCheck',
          sourceScriptKey: node.scriptKey,
          sourceFileName: node.fileName,
          targetRaw: edge.rawTarget,
          targetKey: edge.targetKey,
          command: edge.command,
          lineNumber: edge.lineNumber,
          category: edge.reason || 'FlixCheck-Anbindung',
        });
      } else if (edge.targetType === 'ORACLE' || edge.provider === 'oracle') {
        externalIntegrations.push({
          system: 'Oracle',
          sourceScriptKey: node.scriptKey,
          sourceFileName: node.fileName,
          targetRaw: edge.rawTarget,
          targetKey: edge.targetKey,
          command: edge.command,
          lineNumber: edge.lineNumber,
          category: edge.reason || 'Oracle-Anbindung',
        });
      }
    }

    localAdjacency.set(
      node.scriptKey,
      Array.from(localTargets).sort((a, b) => a.localeCompare(b))
    );
  }

  // Check 2: Orphan Scripts (0 incoming calls from other scripts AND isEntryPoint === false)
  const orphanScripts: OrphanScriptFinding[] = [];
  for (const node of nodes) {
    const incomingCount = incomingCallerKeys.get(node.scriptKey)?.size || 0;
    if (incomingCount === 0 && !node.isEntryPoint) {
      orphanScripts.push({
        scriptKey: node.scriptKey,
        scriptNumber: node.scriptNumber,
        fileName: node.fileName,
        scriptName: node.scriptName,
        outgoingEdgeCount: node.edges.length,
      });
    }
  }

  // Check 3: Dead-End Scripts (strictly without hasTermination & without forwarding jump edge,
  // with explicit Skillset-Queue hint when ending in QUEUE TO SKILLSET)
  const deadEndScripts: DeadEndScriptFinding[] = [];
  for (const node of nodes) {
    const hasForwardingJump = node.edges.some((e) => FORWARDING_EDGE_TYPES.has(e.targetType));
    if (!node.hasTermination && !hasForwardingJump) {
      const skillsetQueues = Array.from(
        new Set(
          node.edges
            .filter((e) => e.targetType === 'SKILLSET_QUEUE')
            .map((e) => e.rawTarget)
        )
      );
      const hasSkillsetQueue = skillsetQueues.length > 0;
      deadEndScripts.push({
        scriptKey: node.scriptKey,
        scriptNumber: node.scriptNumber,
        fileName: node.fileName,
        scriptName: node.scriptName,
        hasSkillsetQueue,
        skillsetQueues,
        note: hasSkillsetQueue
          ? `Hinweis: Endet in Skillset-Queue (${skillsetQueues.join(', ')}) ohne expliziten Terminierungsbefehl oder Weiterleitung.`
          : 'Kein Terminierungsbefehl (DISCONNECT / DROP CALL / ROUTE END / GIVE CDN / TRANSFER TO / ROUTE CALL) und keine weiterführende Sprung-Kante.',
      });
    }
  }

  // Check 4: Circular Script Loops (DFS over all LOCAL_SCRIPT edges)
  const circularLoops: CircularLoopFinding[] = [];
  const seenLoopSignatures = new Set<string>();
  const globalVisited = new Set<string>();
  const onStack = new Set<string>();
  const pathStack: string[] = [];

  const dfs = (currentKey: string) => {
    globalVisited.add(currentKey);
    onStack.add(currentKey);
    pathStack.push(currentKey);

    const neighbors = localAdjacency.get(currentKey) || [];
    for (const nextKey of neighbors) {
      if (onStack.has(nextKey)) {
        const startIdx = pathStack.indexOf(nextKey);
        if (startIdx >= 0) {
          const rawCycle = pathStack.slice(startIdx);
          const canonicalKeys = canonicalizeCycleKeys(rawCycle);
          const signature = canonicalKeys.join(' -> ');
          if (!seenLoopSignatures.has(signature)) {
            seenLoopSignatures.add(signature);
            circularLoops.push({
              cycleKeys: canonicalKeys,
              cycleFileNames: canonicalKeys.map((k) => nodeByKey.get(k)?.fileName || k),
              length: rawCycle.length,
              signature,
            });
          }
        }
      } else if (!globalVisited.has(nextKey)) {
        dfs(nextKey);
      }
    }

    pathStack.pop();
    onStack.delete(currentKey);
  };

  const sortedKeys = Array.from(nodeByKey.keys()).sort((a, b) => a.localeCompare(b));
  for (const key of sortedKeys) {
    if (!globalVisited.has(key)) {
      dfs(key);
    }
  }

  circularLoops.sort((a, b) => a.length - b.length || a.signature.localeCompare(b.signature));

  const flixcheckCallCount = externalIntegrations.filter((i) => i.system === 'FlixCheck').length;
  const oracleCallCount = externalIntegrations.filter((i) => i.system === 'Oracle').length;

  return {
    schemaVersion: '1.5.1',
    generatedAt: options?.generatedAt || new Date().toISOString(),
    privacyMode: '100%-in-memory-metadata-only',
    summary: {
      totalScripts: nodes.length,
      entryPointCount: nodes.filter((n) => n.isEntryPoint).length,
      totalEdges,
      brokenLinkCount: brokenLinks.length,
      orphanScriptCount: orphanScripts.length,
      deadEndScriptCount: deadEndScripts.length,
      deadEndWithQueueHintCount: deadEndScripts.filter((d) => d.hasSkillsetQueue).length,
      circularLoopCount: circularLoops.length,
      externalIntegrationCount: externalIntegrations.length,
      flixcheckCallCount,
      oracleCallCount,
    },
    nodes,
    brokenLinks,
    orphanScripts,
    deadEndScripts,
    circularLoops,
    externalIntegrations,
  };
}

function toSafeMermaidId(prefix: string, raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return `${prefix}_${cleaned || 'NODE'}`;
}

function escapeMermaidLabel(label: string): string {
  return label
    .replace(/"/g, "'")
    .replace(/[<>]/g, '')
    .replace(/\|/g, '/')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/**
 * Generates a compact Mermaid `flowchart LR` (`architecture-overview.mmd`) from an AuditReport:
 * - Includes all Entry Points, Top-N Hub Scripts (default 20), all scripts with Broken Links
 *   or Dead Ends, plus aggregated FlixCheck and Oracle system nodes.
 * - Color-codes Broken Link scripts (red) and Dead End scripts (yellow/amber) via `classDef`.
 */
export function generateArchitectureMermaid(
  report: AuditReport,
  options?: ArchitectureMermaidOptions
): string {
  const maxHubScripts = Math.max(1, options?.maxHubScripts ?? 20);
  const nodeByKey = new Map<string, ParsedScriptNode>();
  for (const node of report.nodes) {
    nodeByKey.set(node.scriptKey, node);
  }

  // Calculate total degree (in + out) per script to rank Top-N Hub Scripts
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const node of report.nodes) {
    inDegree.set(node.scriptKey, 0);
    outDegree.set(node.scriptKey, node.edges.length);
  }
  for (const node of report.nodes) {
    for (const edge of node.edges) {
      if (edge.targetType === 'LOCAL_SCRIPT' && nodeByKey.has(edge.targetKey)) {
        inDegree.set(edge.targetKey, (inDegree.get(edge.targetKey) || 0) + 1);
      }
    }
  }

  const brokenSourceKeys = new Set<string>(report.brokenLinks.map((b) => b.sourceScriptKey));
  const deadEndKeys = new Set<string>(report.deadEndScripts.map((d) => d.scriptKey));
  const entryKeys = new Set<string>(
    report.nodes.filter((n) => n.isEntryPoint).map((n) => n.scriptKey)
  );

  // Select Top-N hubs by total connectivity
  const rankedHubKeys = [...report.nodes]
    .sort((a, b) => {
      const degA = (inDegree.get(a.scriptKey) || 0) + (outDegree.get(a.scriptKey) || 0);
      const degB = (inDegree.get(b.scriptKey) || 0) + (outDegree.get(b.scriptKey) || 0);
      return degB - degA || a.scriptKey.localeCompare(b.scriptKey);
    })
    .slice(0, maxHubScripts)
    .map((n) => n.scriptKey);

  const selectedKeys = new Set<string>([
    ...entryKeys,
    ...rankedHubKeys,
    ...brokenSourceKeys,
    ...deadEndKeys,
  ]);

  // Also include scripts directly calling FlixCheck or Oracle so external edges are always connected
  for (const ext of report.externalIntegrations) {
    if (nodeByKey.has(ext.sourceScriptKey)) {
      selectedKeys.add(ext.sourceScriptKey);
    }
  }

  const lines: string[] = [];
  lines.push('flowchart LR');
  lines.push(
    `  %% Avaya Callflow Architektur-Uebersicht (${report.summary.totalScripts} Skripte geprueft, ${selectedKeys.size} Kern-/Problemknoten)`
  );

  if (selectedKeys.size === 0) {
    lines.push('  EMPTY["Keine Skripte geladen"]');
    return lines.join('\n');
  }

  const mermaidIdByKey = new Map<string, string>();
  const sortedSelectedKeys = Array.from(selectedKeys).sort((a, b) => a.localeCompare(b));

  // Node declarations
  for (const key of sortedSelectedKeys) {
    const node = nodeByKey.get(key);
    if (!node) continue;
    const nodeId = toSafeMermaidId('SCR', key);
    mermaidIdByKey.set(key, nodeId);

    const degIn = inDegree.get(key) || 0;
    const degOut = outDegree.get(key) || 0;
    const badges: string[] = [];
    if (node.isEntryPoint) badges.push('Einstieg');
    if (brokenSourceKeys.has(key)) badges.push('Broken Link');
    if (deadEndKeys.has(key)) {
      const de = report.deadEndScripts.find((d) => d.scriptKey === key);
      badges.push(de?.hasSkillsetQueue ? 'Sackgasse / Queue' : 'Sackgasse');
    }

    const badgeSuffix = badges.length > 0 ? ` [${badges.join(' | ')}]` : '';
    const label = escapeMermaidLabel(`${node.fileName}${badgeSuffix} (${degIn} in / ${degOut} out)`);

    if (node.isEntryPoint) {
      lines.push(`  ${nodeId}(["${label}"])`);
    } else {
      lines.push(`  ${nodeId}["${label}"]`);
    }
  }

  // Central External System Nodes (FlixCheck & Oracle)
  const hasFlixcheck = report.summary.flixcheckCallCount > 0;
  const hasOracle = report.summary.oracleCallCount > 0;
  if (hasFlixcheck) {
    lines.push(
      `  EXT_FLIXCHECK[("FlixCheck API / Deflection (${report.summary.flixcheckCallCount} Aufrufe)")]`
    );
  }
  if (hasOracle) {
    lines.push(
      `  EXT_ORACLE[("Oracle Routing / Queuing (${report.summary.oracleCallCount} Aufrufe)")]`
    );
  }

  // Missing targets referenced by broken links
  const missingNodeIds = new Map<string, string>();
  for (const bl of report.brokenLinks) {
    if (!missingNodeIds.has(bl.targetKey)) {
      const mid = toSafeMermaidId('MISS', bl.targetKey);
      missingNodeIds.set(bl.targetKey, mid);
      lines.push(`  ${mid}["FEHLT: ${escapeMermaidLabel(bl.targetRaw)}"]`);
    }
  }

  // Edges between selected nodes
  const emittedEdgePairs = new Set<string>();
  for (const key of sortedSelectedKeys) {
    const node = nodeByKey.get(key);
    const fromId = mermaidIdByKey.get(key);
    if (!node || !fromId) continue;

    for (const edge of node.edges) {
      if (edge.targetType === 'LOCAL_SCRIPT' && mermaidIdByKey.has(edge.targetKey)) {
        const toId = mermaidIdByKey.get(edge.targetKey)!;
        const pairKey = `${fromId}-->${toId}`;
        if (!emittedEdgePairs.has(pairKey)) {
          emittedEdgePairs.add(pairKey);
          lines.push(`  ${fromId} --> ${toId}`);
        }
      } else if (
        (edge.targetType === 'FLIXCHECK' || edge.provider === 'flixcheck') &&
        hasFlixcheck
      ) {
        const pairKey = `${fromId}-->EXT_FLIXCHECK`;
        if (!emittedEdgePairs.has(pairKey)) {
          emittedEdgePairs.add(pairKey);
          lines.push(`  ${fromId} -.->|"${escapeMermaidLabel(edge.command)}"| EXT_FLIXCHECK`);
        }
      } else if (
        (edge.targetType === 'ORACLE' || edge.provider === 'oracle') &&
        hasOracle
      ) {
        const pairKey = `${fromId}-->EXT_ORACLE`;
        if (!emittedEdgePairs.has(pairKey)) {
          emittedEdgePairs.add(pairKey);
          lines.push(`  ${fromId} -.->|"${escapeMermaidLabel(edge.command)}"| EXT_ORACLE`);
        }
      }
    }
  }

  // Broken link edges
  for (const bl of report.brokenLinks) {
    const fromId = mermaidIdByKey.get(bl.sourceScriptKey);
    const missId = missingNodeIds.get(bl.targetKey);
    if (!fromId || !missId) continue;
    const pairKey = `${fromId}-.->${missId}`;
    if (!emittedEdgePairs.has(pairKey)) {
      emittedEdgePairs.add(pairKey);
      lines.push(
        `  ${fromId} -.->|"Broken: ${escapeMermaidLabel(bl.command)} Z.${bl.lineNumber}"| ${missId}`
      );
    }
  }

  // Styling via classDef
  lines.push('');
  lines.push('  classDef entryNode fill:#1e3a8a,stroke:#60a5fa,stroke-width:2px,color:#eff6ff;');
  lines.push('  classDef hubNode fill:#1e293b,stroke:#94a3b8,stroke-width:1.5px,color:#f8fafc;');
  lines.push('  classDef brokenNode fill:#7f1d1d,stroke:#f87171,stroke-width:2.5px,color:#fef2f2;');
  lines.push('  classDef deadEndNode fill:#78350f,stroke:#fbbf24,stroke-width:2.5px,color:#fffbeb;');
  lines.push(
    '  classDef missingTarget fill:#450a0a,stroke:#ef4444,stroke-width:2px,stroke-dasharray: 5 5,color:#fecaca;'
  );
  lines.push('  classDef flixcheckNode fill:#064e3b,stroke:#34d399,stroke-width:2.5px,color:#ecfdf5;');
  lines.push('  classDef oracleNode fill:#4c1d95,stroke:#c084fc,stroke-width:2.5px,color:#faf5ff;');

  const brokenClassIds: string[] = [];
  const deadEndClassIds: string[] = [];
  const entryClassIds: string[] = [];
  const hubClassIds: string[] = [];

  for (const key of sortedSelectedKeys) {
    const id = mermaidIdByKey.get(key);
    if (!id) continue;
    if (brokenSourceKeys.has(key)) {
      brokenClassIds.push(id);
    } else if (deadEndKeys.has(key)) {
      deadEndClassIds.push(id);
    } else if (entryKeys.has(key)) {
      entryClassIds.push(id);
    } else {
      hubClassIds.push(id);
    }
  }

  if (entryClassIds.length > 0) lines.push(`  class ${entryClassIds.join(',')} entryNode;`);
  if (hubClassIds.length > 0) lines.push(`  class ${hubClassIds.join(',')} hubNode;`);
  if (deadEndClassIds.length > 0) lines.push(`  class ${deadEndClassIds.join(',')} deadEndNode;`);
  if (brokenClassIds.length > 0) lines.push(`  class ${brokenClassIds.join(',')} brokenNode;`);
  if (missingNodeIds.size > 0) {
    lines.push(`  class ${Array.from(missingNodeIds.values()).join(',')} missingTarget;`);
  }
  if (hasFlixcheck) lines.push('  class EXT_FLIXCHECK flixcheckNode;');
  if (hasOracle) lines.push('  class EXT_ORACLE oracleNode;');

  return lines.join('\n');
}

/**
 * Serializes the AuditReport into a privacy-safe, metadata-only JSON string (0 raw script content).
 */
export function serializeAuditReportJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Builds structured rows suitable for `console.table(...)` without any filesystem or network I/O.
 */
export function formatAuditSummaryTableRows(report: AuditReport): AuditSummaryTableRow[] {
  const s = report.summary;
  return [
    { Kategorie: 'Geprüfte Skripte gesamt', Anzahl: s.totalScripts, Status: 'Info' },
    { Kategorie: 'Erkannte Einstiegspunkte (Visio/Master/CDN)', Anzahl: s.entryPointCount, Status: 'Info' },
    {
      Kategorie: 'Broken Links (fehlende Skript-Ziele)',
      Anzahl: s.brokenLinkCount,
      Status: s.brokenLinkCount > 0 ? 'KRITISCH' : 'OK',
    },
    {
      Kategorie: 'Verwaiste Skripte (Orphans / Dead Code)',
      Anzahl: s.orphanScriptCount,
      Status: s.orphanScriptCount > 0 ? 'WARNUNG' : 'OK',
    },
    {
      Kategorie: 'Sackgassen (davon mit Queue-Hinweis)',
      Anzahl: s.deadEndScriptCount,
      Status:
        s.deadEndScriptCount > 0
          ? `${s.deadEndWithQueueHintCount} mit Queue-Hinweis`
          : 'OK',
    },
    {
      Kategorie: 'Zirkuläre Skript-Schleifen (DFS)',
      Anzahl: s.circularLoopCount,
      Status: s.circularLoopCount > 0 ? 'KRITISCH' : 'OK',
    },
    {
      Kategorie: 'FlixCheck-Schnittstellen (Deflection / API)',
      Anzahl: s.flixcheckCallCount,
      Status: 'Inventar',
    },
    {
      Kategorie: 'Oracle-Schnittstellen (Routing / Queuing / Host)',
      Anzahl: s.oracleCallCount,
      Status: 'Inventar',
    },
  ];
}

/**
 * Prints the in-memory AuditReport summary to the browser / runtime console using `console.table`.
 * Zero filesystem I/O, zero network calls.
 */
export function printAuditSummaryToConsole(report: AuditReport): void {
  const rows = formatAuditSummaryTableRows(report);
  if (typeof console !== 'undefined') {
    if (typeof console.table === 'function') {
      console.table(rows);
    } else {
      console.log('Avaya Callflow Audit Summary:', rows);
    }
  }
}

/**
 * Creates pure in-memory export payloads (JSON + Mermaid) ready for browser RAM-Blob downloads.
 */
export function createAuditExportPayloads(
  report: AuditReport,
  options?: ArchitectureMermaidOptions
): AuditExportPayloads {
  return {
    jsonContent: serializeAuditReportJson(report),
    mermaidContent: generateArchitectureMermaid(report, options),
    jsonFilename: 'avaya-callflow-audit.json',
    mermaidFilename: 'architecture-overview.mmd',
  };
}
