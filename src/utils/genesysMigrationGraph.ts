/**
 * EBENE 1: Plattformneutraler Migrations-Graph (Control-Flow IR)
 *
 * Reine, 100 % offline & in-memory Übersetzungsschicht für den isolierten Genesys-Konverter.
 * Liest ausschließlich fertig geparste Avaya-Workspace-Daten (Read-Only) und erzeugt einen
 * echten gerichteten Ablaufgraphen mit:
 *  - Blockgenauen Verzweigungen (IF / ELSE IF / ELSE / END IF, WHERE / VALUE / DEFAULT, SECTION)
 *  - Echten Architect-kompatiblen Expressions (kein Flow.avayaCondition == "true" Dummy)
 *  - Strikter Terminal-Pfad-Beendigung & Dead-Path-Elimination
 *  - Sauberer Trennung von Variablen-Deklarationsname (ohne Scope) und Referenz-Scope (Flow. / Task.)
 *  - E.164- & interner CDN-/Queue-Ziel-Normalisierung
 *  - Vollständigen Parametern für Collect Input, Schedule Group & Data Actions
 *
 * WICHTIG: Verändert keinerlei Avaya-Parser- oder Audit-Dateien.
 */
import { ScriptModule } from '../types/mermaidStudio';
import {
  canonicalScriptMatchKey,
  classifyAvayaWaypointTarget,
  extractOclDeclaredVariables,
  isDeactivatedSentinelTarget,
  isDynamicAvayaVariableTarget,
  normalizeScriptRef,
  splitInlineIfThenElseClauses,
  splitOclStatementsOutsideQuotes,
  stripKnownScriptExtension,
} from './scriptCallflowParser';
import { ParsedScriptNode } from './auditCallflows';
import { detectExternalApiIntegration } from './flixcheckSpec';

export type MigrationVariableDataType = 'string' | 'integer' | 'boolean';
export type MigrationVariableScope = 'flow' | 'task';

export interface MigrationVariableDecl {
  /** Clean unscoped declaration name (e.g. "avayaOriginScript", "collectedDigits", "GV_Region"). */
  name: string;
  /** Scoped Architect reference expression (e.g. "Flow.avayaOriginScript", "Task.collectedDigits"). */
  refName: string;
  /** Original Avaya identifier if derived from OCL. */
  originalName: string;
  scope: MigrationVariableScope;
  isParticipantData: boolean;
  dataType: MigrationVariableDataType;
  initialValue: string | number | boolean;
}

export interface NormalizedTransferTarget {
  kind: 'external-e164' | 'internal-queue' | 'internal-script';
  originalTarget: string;
  normalizedTarget: string;
  lineNumber: number;
  note: string;
}

export interface MigrationDataActionInput {
  name: string;
  expr: string;
}

export interface MigrationDataActionOutput {
  field: string;
  targetVarName: string;
  targetVarRef: string;
  dataType: MigrationVariableDataType;
}

export interface MigrationCollectDigitSpec {
  mode: 'exact' | 'range';
  exact?: number;
  min?: number;
  max?: number;
}

export type MigrationStepKind =
  | 'playAudio'
  | 'collectInput'
  | 'menu'
  | 'callDataAction'
  | 'callCommonModule'
  | 'callTask'
  | 'jumpToReusableTask'
  | 'decision'
  | 'switch'
  | 'loop'
  | 'setParticipantData'
  | 'getParticipantData'
  | 'updateData'
  | 'transferToAcd'
  | 'transferToNumber'
  | 'disconnect'
  | 'evaluateScheduleGroup'
  | 'playHoldMusic'
  | 'delay'
  | 'setPriority'
  | 'createCallback'
  | 'transferToVoicemail'
  | 'setLanguage'
  | 'callDataTableLookup'
  | 'setUuiData';

export interface MigrationStep {
  id: string;
  kind: MigrationStepKind;
  lineNumber: number;
  avayaCommand: string;
  label: string;
  isTerminal: boolean;

  // Target / identifiers
  target?: string;
  targetSlug?: string;
  targetTaskRefId?: string;
  isBrokenTarget?: boolean;

  // Audio / Hold Music
  ttsText?: string;

  // Collect Input
  inputVarName?: string;
  inputVarRef?: string;
  digitSpec?: MigrationCollectDigitSpec;
  noEntryTimeoutSec?: number;
  interDigitTimeoutSec?: number;
  terminatingCharacter?: string;
  noEntryTts?: string;
  noMatchTts?: string;

  // Decision / Switch
  conditionLabel?: string;
  rawCondition?: string;
  expression?: string;
  isEmergencyCheck?: boolean;
  isFallbackFlag?: boolean;
  yesSteps?: MigrationStep[];
  noSteps?: MigrationStep[];
  cases?: Array<{ value: string; label: string; steps: MigrationStep[] }>;
  defaultSteps?: MigrationStep[];

  // Schedule Group
  openSteps?: MigrationStep[];
  closedSteps?: MigrationStep[];
  holidaySteps?: MigrationStep[];

  // Data Action / Callback / Collect / DataTable outputs
  dataActionCategory?:
    | 'Oracle_Integration'
    | 'FlixCheck_API'
    | 'Genesys_Cloud_Data_Actions';
  dataActionInputs?: MigrationDataActionInput[];
  dataActionOutputs?: MigrationDataActionOutput[];
  successSteps?: MigrationStep[];
  failureSteps?: MigrationStep[];
  timeoutSteps?: MigrationStep[];
  foundSteps?: MigrationStep[];
  notFoundSteps?: MigrationStep[];

  // Loop
  isBackwardGoto?: boolean;
  maxLoopCount?: number;
  currentIndexVarName?: string;
  bodySteps?: MigrationStep[];

  // Variables / Update / Participant Data
  variableName?: string;
  variableRef?: string;
  variableDataType?: MigrationVariableDataType;
  expressionValue?: string;
  literalValue?: string | number | boolean;

  // Transfer / Queue / Priority / Delay / Language / DataTable
  skills?: string[];
  isMultiSkillset?: boolean;
  originalTransferTarget?: string;
  normalizedE164?: string;
  normalizationNote?: string;
  priorityValue?: number;
  delaySeconds?: number;
  languageCode?: string;
  dataTableKey?: string;
  choices?: Array<{ digit: string; target: string }>;
  warning?: string;
  /** Optionaler Archy-YAML-Kommentar (z. B. # OFFENE MIGRATIONSFRAGE: ...). */
  yamlComment?: string;
  /** Ursprüngliche Avaya-Section als reiner Herkunftshinweis (für sourceTrace). */
  sectionHint?: string;
  /** v1.1-Zieltypisierung für Transfers. */
  resolvedTargetType?: 'queue' | 'user' | 'externalNumber' | 'extension' | 'flow' | 'unresolved';
  /** Strukturiertes Provenance-Finding, das ins FlowIR v1.1 übernommen wird. */
  provenanceFinding?: StepProvenanceFinding;
  /** Zusätzliche strukturierte Findings (z. B. Fallthrough oder Doppel-Feiertagslogik) auf demselben Schritt. */
  additionalFindings?: StepProvenanceFinding[];
  /** Strukturierte YAML-Kommentar-Annotationen (1:1 verknüpft mit Finding-Codes). */
  migrationAnnotations?: StepMigrationAnnotation[];
  /** Hinweis auf absichtlich unverändert beibehaltene Ausdrücke mit Klärungsbedarf (z. B. DateTime == String). */
  expressionReview?: StepExpressionReview;
}

export interface StepMigrationAnnotation {
  findingCode: StepProvenanceFinding['code'];
  prefix: 'OFFENE MIGRATIONSFRAGE' | 'KOMPATIBILITAETS-STUB (OPT-IN)';
  lines: string[];
  mode: 'strict' | 'stub';
}

export interface StepExpressionReview {
  kind: 'datetime_vs_string_or_list';
  preservedExpression: string;
  reason: string;
}

export interface StepProvenanceFinding {
  severity: 'INFO' | 'WARN' | 'ERROR';
  code:
    | 'VAR_USED_BEFORE_SET'
    | 'SWITCH_WITHOUT_SOURCE'
    | 'DUMMY_CONDITION'
    | 'MISSING_CONDITION_SOURCE'
    | 'POTENTIAL_BRANCH_FALLTHROUGH'
    | 'DUPLICATE_HOLIDAY_LOGIC'
    | 'DATE_COMPARISON_SEMANTIC_REVIEW'
    | 'UNRESOLVED_TASK_REF'
    | 'UNREACHABLE_TASK_PRUNED';
  message: string;
  variableName?: string;
}

export interface MigrationTaskGraph {
  refId: string;
  name: string;
  kind: 'entry' | 'section' | 'subscript' | 'fallback';
  originalTarget?: string;
  isProtectedHandler?: boolean;
  yamlComment?: string;
  taskVariables: MigrationVariableDecl[];
  steps: MigrationStep[];
}

export interface MigrationGraphWarning {
  code:
    | 'BACKWARD_GOTO_LOOP'
    | 'MULTI_SKILLSET_BULLSEYE'
    | 'BROKEN_LINK'
    | 'HIGH_EXTERNAL_API_COUNT'
    | 'IN_QUEUE_FLOW_REQUIRED'
    | 'QUEUE_OBSERVATIONS_API'
    | 'EMERGENCY_GROUP_REQUIRED'
    | 'INTERNAL_CDN_NORMALIZED'
    | 'UNREACHABLE_CODE_PRUNED'
    | 'UNPROVEN_VARIABLE_SOURCE'
    | 'POTENTIAL_BRANCH_FALLTHROUGH'
    | 'DUPLICATE_HOLIDAY_LOGIC'
    | 'DATE_COMPARISON_SEMANTIC_REVIEW';
  severity: 'warning' | 'blocker';
  message: string;
  lineNumber?: number;
}

export interface PrunedUnreachableTaskRecord {
  refId: string;
  originalTarget: string;
  reason: string;
}

export interface MigrationGraphDiagnostics {
  prunedUnreachableCount: number;
  normalizedTargetCount: number;
  realExpressionCount: number;
  fallbackExpressionCount: number;
  terminalNodeCount: number;
  branchNodeCount: number;
  inlinedSectionCount: number;
  synthesizedSourceCount: number;
  normalizedTargets: NormalizedTransferTarget[];
  compatibilityStubMode?: boolean;
  prunedUnreachableTasks?: PrunedUnreachableTaskRecord[];
}

export interface MigrationFlowGraph {
  schemaVersion: string;
  scriptKey: string;
  scriptNumber: string;
  fileName: string;
  cleanName: string;
  entryTaskRefId: string;
  flowVariables: MigrationVariableDecl[];
  tasks: MigrationTaskGraph[];
  diagnostics: MigrationGraphDiagnostics;
}

export interface BuildMigrationGraphContext {
  knownKeyLookup: Map<string, string>;
  incomingCallCountByKey: Map<string, number>;
  brokenTargetKeysForScript: Set<string>;
  /**
   * Optionaler Kompatibilitäts-/Stub-Modus (Opt-In, Standard = false).
   * Nur wenn true, werden unbelegte Variablen automatisch per getParticipantData / Lookup-Stub ergänzt.
   * Im Standardmodus (false = Ehrliche Migration) werden fehlende Quellen nicht erfunden,
   * sondern transparent als offene Migrationsfrage mit Kommentar & Finding markiert.
   */
  compatibilityStubMode?: boolean;
}

export interface BuildMigrationGraphResult {
  graph: MigrationFlowGraph;
  warnings: MigrationGraphWarning[];
  localSubscriptRefs: Array<{ name: string; refId: string; originalTarget: string; targetKey: string }>;
  metrics: {
    backwardGotoCount: number;
    hasMultiSkillset: boolean;
    oracleApiCount: number;
    flixcheckApiCount: number;
    commonModuleCallCount: number;
    callTaskCount: number;
    uniqueSkillsets: string[];
  };
}

const FLIXCHECK_RE =
  /flix[\s_.-]*check|(?:^|[_.\-\s/"'])(?:flix|call[\s_-]*deflection|deflection)(?:$|[_.\-\s\d/"'])/i;
const ORACLE_RE = /(?:^|[_.\-\s/"'])oracle(?:$|[_.\-\s\d/"'])|oracle/i;

const SCHEDULE_COND_RE =
  /\b(?:DAY\s+OF\s+WEEK|TIME\s+OF\s+DAY|DATE\s+OF\s+YEAR|SONDZEIT|HOLIDAY|FEIERTAG|OEFFNUNGSZEIT|OPEN[\s_]*HOURS)\b/i;
const HOLIDAY_ONLY_COND_RE = /\b(?:HOLIDAY|FEIERTAG|SONDZEIT)\b/i;
const EMERGENCY_COND_RE =
  /\b(?:EMERGENCY|NIGHT\s+SERVICE|OUT\s+OF\s+SERVICE|NOTFALL|STOERUNG)\b/i;

function isCallVarIdentifier(name: string): boolean {
  return /^CV_/i.test(name) || /_cv$/i.test(name);
}

function isLocalVarIdentifier(name: string): boolean {
  return /^LV_/i.test(name) || /_lv$/i.test(name);
}

function isGlobalVarIdentifier(name: string): boolean {
  return /^GV_/i.test(name) || /_gv$/i.test(name);
}

function isProtectedHandlerSectionName(rawName: string): boolean {
  const clean = (rawName || '').trim();
  return (
    /^(?:BESETZT|BUSY|FEHLER|ERROR|ABORT|ABBRUCH|DROP|TIMEOUT|ENDE|EXIT|NOTFALL|CLOSED|HANGUP|DISCONNECT|REJECT|BLOCKED|BLACKLIST_END|FAIL)/i.test(
      clean
    ) || /(?:^|_)(?:BESETZT|BUSY|FEHLER|ERROR|NOTFALL|ABBRUCH)(?:$|_)/i.test(clean)
  );
}

function isGuardOrBlacklistCondition(cond: string): boolean {
  return /(?:blacklist|sperr|block|busy|besetzt|notfall|emergency|reject|ungueltig|invalid)/i.test(
    cond || ''
  );
}

export function toCleanGraphSlug(raw: string, fallback = 'Unnamed'): string {
  const base = stripKnownScriptExtension(normalizeScriptRef(raw || ''))
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) return fallback;
  return /^[0-9]/.test(base) ? `S_${base}` : base;
}

export function stripOclCommentsPreservingLines(rawText: string): string[] {
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
        if (ch === inQuote) inQuote = null;
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

      if (
        (ch === '/' && next === '/') ||
        (ch === '-' && next === '-') ||
        (ch === '#' && out.trim().length === 0)
      ) {
        break;
      }

      out += ch;
      i += 1;
    }

    result.push(out);
  }

  return result;
}

/**
 * Normalizes Avaya transfer numbers / CDNs to Genesys Cloud target conventions:
 *  - International `00...` (>= 7 digits) -> E.164 `+<digits>` (`transferToNumber`)
 *  - Already E.164 `+<digits>` (>= 7 digits) -> E.164 `+<digits>` (`transferToNumber`)
 *  - National German `0[1-9]...` (>= 7 digits) -> E.164 `+49...` (`transferToNumber`)
 *  - Loaded script / CDN alias in workspace -> `internal-script`
 *  - Short Avaya CDN / internal extension (2–6 digits, e.g. `2510`, `4711`) -> `internal-queue` (`CDN_<digits>`)
 */
export function normalizeTransferTarget(
  rawTarget: string,
  lineNumber: number,
  knownKeyLookup: Map<string, string>,
  selfScriptKey?: string
): NormalizedTransferTarget {
  const trimmed = rawTarget.trim().replace(/^["']|["']$/g, '');
  const compact = trimmed.replace(/[\s\-()/]+/g, '');
  const matchKey = canonicalScriptMatchKey(stripKnownScriptExtension(trimmed));
  const resolvedKey = matchKey ? knownKeyLookup.get(matchKey) : undefined;

  if (resolvedKey && resolvedKey !== selfScriptKey) {
    const slug = toCleanGraphSlug(trimmed, 'Target_Task');
    return {
      kind: 'internal-script',
      originalTarget: trimmed,
      normalizedTarget: slug,
      lineNumber,
      note: `Avaya-Ziel "${trimmed}" entspricht geladenem Skript -> Task/Common-Module-Aufruf.`,
    };
  }

  // Already canonical E.164 (+...)
  if (/^\+\d{7,18}$/.test(compact)) {
    return {
      kind: 'external-e164',
      originalTarget: trimmed,
      normalizedTarget: compact,
      lineNumber,
      note: `Externe E.164-Rufnummer ${compact}.`,
    };
  }

  // International 00-prefixed number (e.g. 002218277279035 -> +2218277279035, 0049... -> +49...)
  if (/^00\d{7,18}$/.test(compact)) {
    const e164 = `+${compact.slice(2)}`;
    return {
      kind: 'external-e164',
      originalTarget: trimmed,
      normalizedTarget: e164,
      lineNumber,
      note: `Externe Nummer "${trimmed}" nach E.164 normalisiert ("${e164}").`,
    };
  }

  // National German PSTN number (e.g. 02218277279035 -> +492218277279035)
  if (/^0[1-9]\d{6,16}$/.test(compact)) {
    const e164 = `+49${compact.slice(1)}`;
    return {
      kind: 'external-e164',
      originalTarget: trimmed,
      normalizedTarget: e164,
      lineNumber,
      note: `Nationale Nummer "${trimmed}" nach E.164 normalisiert ("${e164}").`,
    };
  }

  // Short numeric Avaya CDN / VDN / extension (e.g. 2510, 4711, 7401) -> ACD Queue target
  if (/^\d{2,6}$/.test(compact)) {
    const queueSlug = `CDN_${compact}`;
    return {
      kind: 'internal-queue',
      originalTarget: trimmed,
      normalizedTarget: queueSlug,
      lineNumber,
      note: `Interne Avaya-Kurzwahl/CDN "${trimmed}" als ACD-Queue-Ziel "${queueSlug}" normalisiert (statt rohem PSTN-transferToNumber).`,
    };
  }

  // Named internal target -> ACD Queue
  const queueSlug = toCleanGraphSlug(trimmed, 'Internal_Queue');
  return {
    kind: 'internal-queue',
    originalTarget: trimmed,
    normalizedTarget: queueSlug,
    lineNumber,
    note: `Internes Ziel "${trimmed}" als ACD-Queue "${queueSlug}" abgebildet.`,
  };
}

interface VariableRegistry {
  flowVars: Map<string, MigrationVariableDecl>;
  ensureFlowVar: (
    rawName: string,
    dataType: MigrationVariableDataType,
    initialValue?: string | number | boolean,
    isParticipantData?: boolean
  ) => MigrationVariableDecl;
  ensureTaskVar: (
    taskVars: Map<string, MigrationVariableDecl>,
    rawName: string,
    dataType: MigrationVariableDataType,
    initialValue?: string | number | boolean
  ) => MigrationVariableDecl;
}

function createVariableRegistry(): VariableRegistry {
  const flowVars = new Map<string, MigrationVariableDecl>();

  const defaultInitForType = (t: MigrationVariableDataType): string | number | boolean => {
    if (t === 'integer') return 0;
    if (t === 'boolean') return false;
    return '';
  };

  const ensureFlowVar = (
    rawName: string,
    dataType: MigrationVariableDataType,
    initialValue?: string | number | boolean,
    isParticipantData = false
  ): MigrationVariableDecl => {
    const clean = toCleanGraphSlug(rawName.replace(/^(?:Flow|Task)\./i, ''), 'varFlag');
    const key = clean.toLowerCase();
    const existing = flowVars.get(key);
    if (existing) {
      if (isParticipantData) existing.isParticipantData = true;
      if (existing.dataType === 'string' && dataType !== 'string' && existing.initialValue === '') {
        existing.dataType = dataType;
        existing.initialValue = initialValue !== undefined ? initialValue : defaultInitForType(dataType);
      }
      return existing;
    }
    const decl: MigrationVariableDecl = {
      name: clean,
      refName: `Flow.${clean}`,
      originalName: rawName,
      scope: 'flow',
      isParticipantData,
      dataType,
      initialValue: initialValue !== undefined ? initialValue : defaultInitForType(dataType),
    };
    flowVars.set(key, decl);
    return decl;
  };

  const ensureTaskVar = (
    taskVars: Map<string, MigrationVariableDecl>,
    rawName: string,
    dataType: MigrationVariableDataType,
    initialValue?: string | number | boolean
  ): MigrationVariableDecl => {
    const clean = toCleanGraphSlug(rawName.replace(/^(?:Flow|Task)\./i, ''), 'taskVar');
    const key = clean.toLowerCase();
    // Scope uniqueness: if a Flow variable already owns this name (e.g. Flow.HDX_Resp_cv),
    // reuse it directly unless this is strictly an isolated task-local loop/input counter.
    const isIsolatedLocalCounter =
      key === 'collecteddigits' || key.startsWith('loopidx_') || key.startsWith('retrycount_');
    if (!isIsolatedLocalCounter) {
      const existingFlow = flowVars.get(key);
      if (existingFlow) {
        if (existingFlow.dataType === 'string' && dataType !== 'string' && existingFlow.initialValue === '') {
          existingFlow.dataType = dataType;
          existingFlow.initialValue =
            initialValue !== undefined ? initialValue : defaultInitForType(dataType);
        }
        return existingFlow;
      }
    }
    const existing = taskVars.get(key);
    if (existing) {
      if (existing.dataType === 'string' && dataType !== 'string' && existing.initialValue === '') {
        existing.dataType = dataType;
        existing.initialValue = initialValue !== undefined ? initialValue : defaultInitForType(dataType);
      }
      return existing;
    }
    const decl: MigrationVariableDecl = {
      name: clean,
      refName: `Task.${clean}`,
      originalName: rawName,
      scope: 'task',
      isParticipantData: false,
      dataType,
      initialValue: initialValue !== undefined ? initialValue : defaultInitForType(dataType),
    };
    taskVars.set(key, decl);
    return decl;
  };

  return { flowVars, ensureFlowVar, ensureTaskVar };
}

/**
 * Deterministic OCL-to-Genesys Architect expression compiler.
 * Replaces dummy `Flow.avayaCondition == "true"` with real Architect expressions
 * covering DNIS/CDN, ANI/CLID, EWT, Logged Agents, DTMF Digits, Counters, Flags, NOT/AND/OR.
 */
export function compileOclConditionToArchitectExpr(
  rawCondition: string,
  registry: VariableRegistry,
  taskVars: Map<string, MigrationVariableDecl>,
  activeDigitsVarName = 'collectedDigits'
): { expression: string; isFallbackFlag: boolean } {
  const trimmed = (rawCondition || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    const flag = registry.ensureFlowVar('conditionCheck', 'boolean', false);
    return { expression: `${flag.refName} == true`, isFallbackFlag: true };
  }

  // Split top-level OR / AND outside quotes & parentheses
  const splitLogical = (expr: string, op: 'OR' | 'AND'): string[] => {
    const parts: string[] = [];
    let current = '';
    let depth = 0;
    let quote: '"' | "'" | null = null;
    const upper = expr.toUpperCase();
    const tokenLen = op.length;

    for (let i = 0; i < expr.length; i += 1) {
      const ch = expr[i];
      if (quote) {
        current += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        current += ch;
        continue;
      }
      if (ch === '(') {
        depth += 1;
        current += ch;
        continue;
      }
      if (ch === ')' && depth > 0) {
        depth -= 1;
        current += ch;
        continue;
      }
      if (
        depth === 0 &&
        upper.slice(i, i + tokenLen) === op &&
        (i === 0 || /[\s)]/.test(expr[i - 1])) &&
        (i + tokenLen >= expr.length || /[\s(]/.test(expr[i + tokenLen]))
      ) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        i += tokenLen - 1;
        continue;
      }
      current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  };

  const orParts = splitLogical(trimmed, 'OR');
  if (orParts.length > 1) {
    const compiled = orParts.map((p) =>
      compileOclConditionToArchitectExpr(p, registry, taskVars, activeDigitsVarName)
    );
    return {
      expression: compiled.map((c) => c.expression).join(' or '),
      isFallbackFlag: compiled.every((c) => c.isFallbackFlag),
    };
  }

  const andParts = splitLogical(trimmed, 'AND');
  if (andParts.length > 1) {
    const compiled = andParts.map((p) =>
      compileOclConditionToArchitectExpr(p, registry, taskVars, activeDigitsVarName)
    );
    return {
      expression: compiled.map((c) => c.expression).join(' and '),
      isFallbackFlag: compiled.every((c) => c.isFallbackFlag),
    };
  }

  // Strip balanced outer parentheses
  let atom = trimmed;
  if (atom.startsWith('(') && atom.endsWith(')')) {
    let depth = 0;
    let wrapsWhole = true;
    for (let i = 0; i < atom.length; i += 1) {
      if (atom[i] === '(') depth += 1;
      else if (atom[i] === ')') {
        depth -= 1;
        if (depth === 0 && i < atom.length - 1) {
          wrapsWhole = false;
          break;
        }
      }
    }
    if (wrapsWhole) {
      const inner = compileOclConditionToArchitectExpr(
        atom.slice(1, -1),
        registry,
        taskVars,
        activeDigitsVarName
      );
      return { expression: `(${inner.expression})`, isFallbackFlag: inner.isFallbackFlag };
    }
  }

  // Leading NOT <expr>
  const notMatch = atom.match(/^NOT\s+(.+)$/i);
  if (notMatch) {
    const innerRaw = notMatch[1].trim();
    if (
      /^[A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_.-]*$/.test(innerRaw) &&
      !/^(?:TRUE|FALSE)$/i.test(innerRaw)
    ) {
      const isTask = isLocalVarIdentifier(innerRaw);
      const flagVar = isTask
        ? registry.ensureTaskVar(taskVars, innerRaw, 'boolean', false)
        : registry.ensureFlowVar(innerRaw, 'boolean', false, isCallVarIdentifier(innerRaw));
      return { expression: `!${flagVar.refName}`, isFallbackFlag: false };
    }
    const inner = compileOclConditionToArchitectExpr(
      innerRaw,
      registry,
      taskVars,
      activeDigitsVarName
    );
    const target = /\s(?:and|or|==|!=|<|>)\s/.test(inner.expression)
      ? `!(${inner.expression})`
      : `!${inner.expression}`;
    return { expression: target, isFallbackFlag: inner.isFallbackFlag };
  }

  // Emergency / Night Service
  if (EMERGENCY_COND_RE.test(atom) && !/[=<>!]/.test(atom)) {
    const emVar = registry.ensureFlowVar('emergencyOverride', 'boolean', false);
    return { expression: `${emVar.refName} == true`, isFallbackFlag: false };
  }

  // Helper to resolve an OCL operand into an Architect expression
  const resolveOperand = (
    rawOp: string,
    preferType: MigrationVariableDataType
  ): { expr: string; isNumeric: boolean; isString: boolean; isBoolean: boolean } => {
    const op = rawOp.trim();

    // Quoted string literal
    const strLit = op.match(/^["'](.*)["']$/);
    if (strLit) {
      const escaped = strLit[1].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return { expr: `"${escaped}"`, isNumeric: false, isString: true, isBoolean: false };
    }

    // DTMF # or * literal
    if (op === '#' || op === '*') {
      return { expr: `"${op}"`, isNumeric: false, isString: true, isBoolean: false };
    }

    // Boolean literal
    if (/^(?:TRUE|FALSE)$/i.test(op)) {
      return {
        expr: op.toLowerCase(),
        isNumeric: false,
        isString: false,
        isBoolean: true,
      };
    }

    // Pure numeric literal
    if (/^-?\d+(?:\.\d+)?$/.test(op)) {
      if (preferType === 'string') {
        return { expr: `"${op}"`, isNumeric: false, isString: true, isBoolean: false };
      }
      return { expr: op, isNumeric: true, isString: false, isBoolean: false };
    }

    // System telephony & date/time identifiers -> native Genesys Cloud Architect system context
    if (/^(?:CDN|DNIS|DIALED[\s_]*NUMBER|CALL\.DNIS)$/i.test(op)) {
      return { expr: 'Call.Dnis', isNumeric: false, isString: true, isBoolean: false };
    }
    if (/^(?:CLID|ANI|CALLING[\s_]*NUMBER|CALL\.ANI)$/i.test(op)) {
      return { expr: 'Call.Ani', isNumeric: false, isString: true, isBoolean: false };
    }
    if (/^(?:LANGUAGE|CALL\.LANGUAGE)$/i.test(op)) {
      return { expr: 'Call.Language', isNumeric: false, isString: true, isBoolean: false };
    }
    if (/^(?:UUI|CALL\.USERTOUSERINFORMATION)$/i.test(op)) {
      return { expr: 'Call.UserToUserInformation', isNumeric: false, isString: true, isBoolean: false };
    }
    if (
      /^(?:DATE(?:\(\))?|CURRENT[\s_]*DATE(?:\(\))?|TODAY(?:\(\))?|SYS[\s_]*DATE|SYSTEM[\s_]*DATE|DATE\s+OF\s+YEAR)$/i.test(op) &&
      !registry.flowVars.has(op.replace(/\(\)$/, '').toLowerCase()) &&
      !taskVars.has(op.replace(/\(\)$/, '').toLowerCase())
    ) {
      return { expr: 'GetCurrentDateTimeUtc()', isNumeric: false, isString: true, isBoolean: false };
    }
    if (
      /^(?:TIME(?:\(\))?|CURRENT[\s_]*TIME(?:\(\))?|SYS[\s_]*TIME|SYSTEM[\s_]*TIME|TIME\s+OF\s+DAY)$/i.test(op) &&
      !registry.flowVars.has(op.replace(/\(\)$/, '').toLowerCase()) &&
      !taskVars.has(op.replace(/\(\)$/, '').toLowerCase())
    ) {
      return { expr: 'GetCurrentDateTimeUtc()', isNumeric: false, isString: true, isBoolean: false };
    }
    if (
      /^(?:DAY\s+OF\s+WEEK|DAY[\s_]*OF[\s_]*WEEK|DAYOFWEEK(?:\(\))?|WEEKDAY)$/i.test(op) &&
      !registry.flowVars.has(op.replace(/\(\)$/, '').toLowerCase()) &&
      !taskVars.has(op.replace(/\(\)$/, '').toLowerCase())
    ) {
      return { expr: 'DayOfWeek(GetCurrentDateTimeUtc())', isNumeric: true, isString: false, isBoolean: false };
    }
    if (
      /^(?:CURRENT[\s_]*YEAR|SYS[\s_]*YEAR)$/i.test(op) &&
      !registry.flowVars.has(op.toLowerCase()) &&
      !taskVars.has(op.toLowerCase())
    ) {
      return { expr: 'Year(GetCurrentDateTimeUtc())', isNumeric: true, isString: false, isBoolean: false };
    }
    if (
      /^(?:CURRENT[\s_]*MONTH|SYS[\s_]*MONTH)$/i.test(op) &&
      !registry.flowVars.has(op.toLowerCase()) &&
      !taskVars.has(op.toLowerCase())
    ) {
      return { expr: 'Month(GetCurrentDateTimeUtc())', isNumeric: true, isString: false, isBoolean: false };
    }
    if (
      /^(?:CURRENT[\s_]*DAY|SYS[\s_]*DAY)$/i.test(op) &&
      !registry.flowVars.has(op.toLowerCase()) &&
      !taskVars.has(op.toLowerCase())
    ) {
      return { expr: 'Day(GetCurrentDateTimeUtc())', isNumeric: true, isString: false, isBoolean: false };
    }
    if (/^(?:EXPECTED\s+WAIT\s+TIME|EWT)$/i.test(op)) {
      const ewtVar = registry.ensureFlowVar('estimatedWaitTime', 'integer', 0);
      return { expr: ewtVar.refName, isNumeric: true, isString: false, isBoolean: false };
    }
    if (/^(?:LOGGED\s+AGENTS|AVAILABLE\s+AGENTS|STAFFED\s+AGENTS|AGENTS\s+TOTAL|QUEUE\s+AGENTS)\b/i.test(op)) {
      const agVar = registry.ensureTaskVar(taskVars, 'queueAgentsOnline', 'integer', 0);
      return { expr: agVar.refName, isNumeric: true, isString: false, isBoolean: false };
    }
    if (/^(?:DIGITS|COLLECTED[\s_]*DIGITS|INPUT|DTMF)$/i.test(op)) {
      const dVar = registry.ensureTaskVar(taskVars, activeDigitsVarName, 'string', '');
      return { expr: dVar.refName, isNumeric: false, isString: true, isBoolean: false };
    }
    if (/^(?:OUT\s+OF\s+RANGE|INVALID\s+INPUT)$/i.test(op)) {
      const dVar = registry.ensureTaskVar(taskVars, activeDigitsVarName, 'string', '');
      return { expr: `IsNotSetOrEmpty(${dVar.refName})`, isNumeric: false, isString: false, isBoolean: true };
    }

    // Explicit Flow.* / Task.* reference
    if (/^Flow\.[A-Za-z_][A-Za-z0-9_]*$/i.test(op)) {
      const v = registry.ensureFlowVar(op.slice(5), preferType);
      return {
        expr: v.refName,
        isNumeric: v.dataType === 'integer',
        isString: v.dataType === 'string',
        isBoolean: v.dataType === 'boolean',
      };
    }
    if (/^Task\.[A-Za-z_][A-Za-z0-9_]*$/i.test(op)) {
      const v = registry.ensureTaskVar(taskVars, op.slice(5), preferType);
      return {
        expr: v.refName,
        isNumeric: v.dataType === 'integer',
        isString: v.dataType === 'string',
        isBoolean: v.dataType === 'boolean',
      };
    }

    // LV_* / *_lv -> Task-scoped variable
    if (isLocalVarIdentifier(op) && /^[A-Za-z0-9_]+$/i.test(op)) {
      const v = registry.ensureTaskVar(taskVars, op, preferType);
      return {
        expr: v.refName,
        isNumeric: v.dataType === 'integer',
        isString: v.dataType === 'string',
        isBoolean: v.dataType === 'boolean',
      };
    }

    // CV_* / *_cv / GV_* / *_gv -> Flow-scoped variable
    if ((isCallVarIdentifier(op) || isGlobalVarIdentifier(op)) && /^[A-Za-z0-9_]+$/i.test(op)) {
      const v = registry.ensureFlowVar(op, preferType, undefined, isCallVarIdentifier(op));
      return {
        expr: v.refName,
        isNumeric: v.dataType === 'integer',
        isString: v.dataType === 'string',
        isBoolean: v.dataType === 'boolean',
      };
    }

    // Check if already declared as a Task variable
    const slug = toCleanGraphSlug(op, 'var');
    if (taskVars.has(slug.toLowerCase())) {
      const v = taskVars.get(slug.toLowerCase())!;
      return {
        expr: v.refName,
        isNumeric: v.dataType === 'integer',
        isString: v.dataType === 'string',
        isBoolean: v.dataType === 'boolean',
      };
    }

    // Generic identifier (e.g., COUNTER, FLIXCHECK_KFZ_Schaden_RHLD, Gesellschaft, RoutingFlag)
    if (/^[A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_.-]*$/.test(op)) {
      const looksCounter = /count|retry|zaehler|versuch|attempt|index/i.test(op);
      const inferredType = looksCounter ? 'integer' : preferType;
      const v = looksCounter
        ? registry.ensureTaskVar(taskVars, op, inferredType)
        : registry.ensureFlowVar(op, inferredType);
      return {
        expr: v.refName,
        isNumeric: v.dataType === 'integer',
        isString: v.dataType === 'string',
        isBoolean: v.dataType === 'boolean',
      };
    }

    // Fallback string literal
    return {
      expr: `"${op.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
      isNumeric: false,
      isString: true,
      isBoolean: false,
    };
  };

  // Comparison operators: <=, >=, <>, !=, ==, =, <, >, EQUALS, IN
  const cmpMatch = atom.match(
    /^(.+?)\s*(<=|>=|<>|!=|==|=|<|>|\bEQUALS\b|\bNOT\s+EQUALS\b|\bCONTAINS\b)\s*(.+)$/i
  );
  if (cmpMatch) {
    const rawLhs = cmpMatch[1].trim();
    const rawOp = cmpMatch[2].trim().toUpperCase();
    const rawRhs = cmpMatch[3].trim();

    const isOrdering = rawOp === '<' || rawOp === '>' || rawOp === '<=' || rawOp === '>=';
    const rhsIsPureNum = /^-?\d+(?:\.\d+)?$/.test(rawRhs);
    const lhsIsStringSystem =
      /^(?:CDN|DNIS|DIALED[\s_]*NUMBER|CALL\.DNIS|CLID|ANI|CALLING[\s_]*NUMBER|CALL\.ANI|DIGITS|COLLECTED[\s_]*DIGITS)$/i.test(
        rawLhs
      );
    const lhsIsNumericSystem =
      /^(?:EXPECTED\s+WAIT\s+TIME|EWT|LOGGED\s+AGENTS|AVAILABLE\s+AGENTS|STAFFED\s+AGENTS|AGENTS\s+TOTAL|QUEUE\s+AGENTS)\b/i.test(
        rawLhs
      );

    const lhsPreferType: MigrationVariableDataType =
      lhsIsNumericSystem || isOrdering
        ? 'integer'
        : lhsIsStringSystem
        ? 'string'
        : /^(?:TRUE|FALSE)$/i.test(rawRhs)
        ? 'boolean'
        : rhsIsPureNum && /count|retry|zaehler|versuch|prio|wait|agent/i.test(rawLhs)
        ? 'integer'
        : 'string';

    const lhs = resolveOperand(rawLhs, lhsPreferType);
    const rhsPreferType: MigrationVariableDataType = lhs.isNumeric
      ? 'integer'
      : lhs.isBoolean
      ? 'boolean'
      : 'string';
    const rhs = resolveOperand(rawRhs, rhsPreferType);

    if (rawOp === 'CONTAINS') {
      return { expression: `Contains(${lhs.expr}, ${rhs.expr})`, isFallbackFlag: false };
    }

    const mappedOp =
      rawOp === '=' || rawOp === '==' || rawOp === 'EQUALS'
        ? '=='
        : rawOp === '<>' || rawOp === '!=' || rawOp === 'NOT EQUALS'
        ? '!='
        : rawOp;

    // Special Architect duration formatting when comparing Call.EstimatedWaitTime directly
    if (/^(?:EXPECTED\s+WAIT\s+TIME|EWT)$/i.test(rawLhs) && rhsIsPureNum) {
      const secs = Math.max(0, Math.round(Number(rawRhs)));
      const mins = Math.floor(secs / 60);
      const rem = secs % 60;
      return {
        expression: `Call.EstimatedWaitTime ${mappedOp} MakeDuration(0, 0, ${mins}, ${rem})`,
        isFallbackFlag: false,
      };
    }

    return {
      expression: `${lhs.expr} ${mappedOp} ${rhs.expr}`,
      isFallbackFlag: false,
    };
  }

  // Bare boolean flag identifier (e.g. `FLIXCHECK_KFZ_Schaden_RHLD`, `GV_IsVip`, `OUT OF RANGE`)
  if (/^OUT\s+OF\s+RANGE$/i.test(atom)) {
    const dVar = registry.ensureTaskVar(taskVars, activeDigitsVarName, 'string', '');
    return { expression: `IsNotSetOrEmpty(${dVar.refName})`, isFallbackFlag: false };
  }

  if (/^[A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_.-]*$/.test(atom)) {
    const isTask = isLocalVarIdentifier(atom);
    const flagVar = isTask
      ? registry.ensureTaskVar(taskVars, atom, 'boolean', false)
      : registry.ensureFlowVar(atom, 'boolean', false, isCallVarIdentifier(atom));
    return { expression: `${flagVar.refName} == true`, isFallbackFlag: false };
  }

  // Last resort: derive a meaningful named boolean variable from the condition text (never generic Flow.avayaCondition)
  const derivedName = `cond_${toCleanGraphSlug(atom.slice(0, 36), 'check')}`;
  const flagVar = registry.ensureFlowVar(derivedName, 'boolean', false);
  return { expression: `${flagVar.refName} == true`, isFallbackFlag: true };
}

/**
 * Checks whether a step list is guaranteed to terminate the active call/task path.
 */
export function isStepListTerminal(steps: MigrationStep[]): boolean {
  if (steps.length === 0) return false;
  const last = steps[steps.length - 1];
  if (last.isTerminal) return true;
  if (last.kind === 'decision') {
    return isStepListTerminal(last.yesSteps || []) && isStepListTerminal(last.noSteps || []);
  }
  if (last.kind === 'evaluateScheduleGroup') {
    return (
      isStepListTerminal(last.openSteps || []) &&
      isStepListTerminal(last.closedSteps || []) &&
      isStepListTerminal(last.holidaySteps || [])
    );
  }
  if (last.kind === 'collectInput') {
    return (
      isStepListTerminal(last.successSteps || []) &&
      isStepListTerminal(last.failureSteps || [])
    );
  }
  if (last.kind === 'callDataAction') {
    return (
      isStepListTerminal(last.successSteps || []) &&
      isStepListTerminal(last.failureSteps || []) &&
      isStepListTerminal(last.timeoutSteps || [])
    );
  }
  if (last.kind === 'switch') {
    const allCasesTerm = (last.cases || []).every((c) => isStepListTerminal(c.steps));
    return (last.cases || []).length > 0 && allCasesTerm && isStepListTerminal(last.defaultSteps || []);
  }
  return false;
}

/**
 * Prunes any unreachable steps that appear after a terminal action in the same sequential path.
 */
export function pruneDeadPaths(
  steps: MigrationStep[],
  counter: { pruned: number }
): MigrationStep[] {
  const out: MigrationStep[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = { ...steps[i] };

    if (step.yesSteps) step.yesSteps = pruneDeadPaths(step.yesSteps, counter);
    if (step.noSteps) step.noSteps = pruneDeadPaths(step.noSteps, counter);
    if (step.openSteps) step.openSteps = pruneDeadPaths(step.openSteps, counter);
    if (step.closedSteps) step.closedSteps = pruneDeadPaths(step.closedSteps, counter);
    if (step.holidaySteps) step.holidaySteps = pruneDeadPaths(step.holidaySteps, counter);
    if (step.successSteps) step.successSteps = pruneDeadPaths(step.successSteps, counter);
    if (step.failureSteps) step.failureSteps = pruneDeadPaths(step.failureSteps, counter);
    if (step.timeoutSteps) step.timeoutSteps = pruneDeadPaths(step.timeoutSteps, counter);
    if (step.foundSteps) step.foundSteps = pruneDeadPaths(step.foundSteps, counter);
    if (step.notFoundSteps) step.notFoundSteps = pruneDeadPaths(step.notFoundSteps, counter);
    if (step.bodySteps) step.bodySteps = pruneDeadPaths(step.bodySteps, counter);
    if (step.defaultSteps) step.defaultSteps = pruneDeadPaths(step.defaultSteps, counter);
    if (step.cases) {
      step.cases = step.cases.map((c) => ({
        ...c,
        steps: pruneDeadPaths(c.steps, counter),
      }));
    }

    out.push(step);

    const stepEndsPath =
      step.isTerminal ||
      (step.kind === 'decision' &&
        isStepListTerminal(step.yesSteps || []) &&
        isStepListTerminal(step.noSteps || [])) ||
      (step.kind === 'evaluateScheduleGroup' &&
        isStepListTerminal(step.openSteps || []) &&
        isStepListTerminal(step.closedSteps || []) &&
        isStepListTerminal(step.holidaySteps || [])) ||
      (step.kind === 'collectInput' &&
        isStepListTerminal(step.successSteps || []) &&
        isStepListTerminal(step.failureSteps || [])) ||
      (step.kind === 'callDataAction' &&
        isStepListTerminal(step.successSteps || []) &&
        isStepListTerminal(step.failureSteps || []) &&
        isStepListTerminal(step.timeoutSteps || []));

    if (stepEndsPath && i < steps.length - 1) {
      counter.pruned += steps.length - 1 - i;
      break;
    }
  }
  return out;
}

interface SourceLine {
  lineNumber: number;
  text: string;
}

interface SectionBlock {
  rawName: string;
  refId: string;
  startLine: number;
  isEntry: boolean;
  lines: SourceLine[];
}

function isMultiLineIfHeader(trimmed: string): string | null {
  if (!/^IF\b/i.test(trimmed)) return null;
  // Multi-line IF ends with THEN (nothing after THEN) or has no THEN on the same line
  const m = trimmed.match(/^IF\s+(.+?)\s+THEN\s*$/i);
  if (m) return m[1].trim();
  return null;
}

function isMultiLineElseIfHeader(trimmed: string): string | null {
  const m = trimmed.match(/^ELSE\s*IF\s+(.+?)\s+THEN\s*$/i);
  return m ? m[1].trim() : null;
}

function isElseLine(trimmed: string): boolean {
  return /^ELSE\s*$/i.test(trimmed);
}

function isEndIfLine(trimmed: string): boolean {
  return /^END\s*IF\s*;?$/i.test(trimmed);
}

function isWhereHeader(trimmed: string): string | null {
  const m = trimmed.match(/^WHERE\s+(.+?)\s+EQUALS\s*$/i);
  return m ? m[1].trim() : null;
}

function isEndWhereLine(trimmed: string): boolean {
  return /^END\s*WHERE\s*;?$/i.test(trimmed);
}

/**
 * Builds the Level-1 Neutral Migration Control-Flow Graph for a single Avaya script.
 */
export function buildMigrationFlowGraph(
  node: ParsedScriptNode,
  mod: ScriptModule | undefined,
  ctx: BuildMigrationGraphContext,
  schemaVersion = '1.5.6'
): BuildMigrationGraphResult {
  const rawText = mod?.rawText || '';
  const strippedLines = rawText ? stripOclCommentsPreservingLines(rawText) : [];
  const oclVars = extractOclDeclaredVariables(strippedLines);
  const registry = createVariableRegistry();

  // Always declare flow origin metadata cleanly (unscoped name, Flow. reference)
  registry.ensureFlowVar('avayaOriginScript', 'string', node.fileName || node.scriptNumber);

  // Pre-register explicit CV_* / GV_* AND *_cv / *_gv variables found in the script
  for (const line of strippedLines) {
    const varMatches = line.matchAll(
      /\b((?:CV|GV)_[A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9_]*_(?:cv|gv))\b/gi
    );
    for (const m of varMatches) {
      if (!m[1]) continue;
      const lower = m[1].toLowerCase();
      const staticVal = oclVars.staticStringLiterals.get(lower) || '';
      const isInt = /count|retry|zaehler|versuch|prio/i.test(m[1]) && /^\d+$/.test(staticVal);
      registry.ensureFlowVar(
        m[1],
        isInt ? 'integer' : 'string',
        isInt ? Number(staticVal) : staticVal,
        isCallVarIdentifier(m[1])
      );
    }
  }

  // Split script into SECTION blocks while keeping accurate 1-based line numbers
  const sectionLineByLower = new Map<string, number>();
  const sectionRefIdByLower = new Map<string, string>();
  const rawSections: SectionBlock[] = [];

  let currentSection: SectionBlock | null = null;
  let sawLeadingStatements = false;

  for (let i = 0; i < strippedLines.length; i += 1) {
    const lineNumber = i + 1;
    const text = strippedLines[i].trim();
    if (!text) continue;

    const secMatch = text.match(/^SECTION\s+([A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_.-]*)/i);
    if (secMatch) {
      const secRaw = secMatch[1].trim();
      const secLower = secRaw.toLowerCase();
      if (!sectionLineByLower.has(secLower)) {
        sectionLineByLower.set(secLower, lineNumber);
      }

      if (!currentSection && !sawLeadingStatements) {
        // First section with no preceding statements becomes Main_Task
        const refId = 'Main_Task';
        sectionRefIdByLower.set(secLower, refId);
        currentSection = {
          rawName: secRaw,
          refId,
          startLine: lineNumber,
          isEntry: true,
          lines: [],
        };
        rawSections.push(currentSection);
      } else {
        const refId = `Section_${toCleanGraphSlug(secRaw, `Sec_${rawSections.length + 1}`)}`;
        sectionRefIdByLower.set(secLower, refId);
        currentSection = {
          rawName: secRaw,
          refId,
          startLine: lineNumber,
          isEntry: false,
          lines: [],
        };
        rawSections.push(currentSection);
      }
      continue;
    }

    if (!currentSection) {
      sawLeadingStatements = true;
      currentSection = {
        rawName: 'Main_Task',
        refId: 'Main_Task',
        startLine: lineNumber,
        isEntry: true,
        lines: [],
      };
      rawSections.push(currentSection);
    }
    currentSection.lines.push({ lineNumber, text });
  }

  if (rawSections.length === 0) {
    rawSections.push({
      rawName: 'Main_Task',
      refId: 'Main_Task',
      startLine: 1,
      isEntry: true,
      lines: [],
    });
  }

  const warnings: MigrationGraphWarning[] = [];
  const normalizedTargets: NormalizedTransferTarget[] = [];
  const localSubscriptRefsMap = new Map<
    string,
    { name: string; refId: string; originalTarget: string; targetKey: string }
  >();

  let stepCounter = 0;
  const nextStepId = (prefix = 'st'): string => {
    stepCounter += 1;
    return `${prefix}_${stepCounter}`;
  };

  let backwardGotoCount = 0;
  let hasMultiSkillset = false;
  let oracleApiCount = 0;
  let flixcheckApiCount = 0;
  let commonModuleCallCount = 0;
  let callTaskCount = 0;
  let realExpressionCount = 0;
  let fallbackExpressionCount = 0;
  let needsFallbackErrorTask = false;
  const uniqueSkillsets = new Set<string>();

  const resolveStaticVar = (tok: string): string => {
    const clean = tok.trim().replace(/^["']|["']$/g, '');
    return oclVars.staticStringLiterals.get(clean.toLowerCase()) || clean;
  };

  const makeFallbackJumpStep = (lineNumber: number, reasonLabel: string): MigrationStep => {
    needsFallbackErrorTask = true;
    return {
      id: nextStepId('fb'),
      kind: 'jumpToReusableTask',
      lineNumber,
      avayaCommand: 'FALLBACK',
      label: `Fallback (${reasonLabel})`,
      target: 'Fallback_Error_Task',
      targetSlug: 'Fallback_Error_Task',
      targetTaskRefId: 'Fallback_Error_Task',
      isTerminal: true,
    };
  };

  const makeClosedDisconnectSteps = (lineNumber: number, reason: string): MigrationStep[] => [
    {
      id: nextStepId('aud'),
      kind: 'playAudio',
      lineNumber,
      avayaCommand: 'SCHEDULE_AUDIO',
      label: `Ansage (${reason})`,
      target: reason === 'Feiertag' ? 'Feiertagsansage' : 'Ausserhalb_Oeffnungszeiten',
      targetSlug: reason === 'Feiertag' ? 'Feiertagsansage' : 'Ausserhalb_Oeffnungszeiten',
      ttsText:
        reason === 'Feiertag'
          ? 'Heute ist ein gesetzlicher Feiertag. Bitte rufen Sie am naechsten Werktag wieder an.'
          : 'Sie rufen ausserhalb unserer Geschaeftszeiten an. Bitte versuchen Sie es spaeter erneut.',
      isTerminal: false,
    },
    {
      id: nextStepId('disc'),
      kind: 'disconnect',
      lineNumber,
      avayaCommand: 'DISCONNECT',
      label: `Disconnect (${reason})`,
      target: reason,
      isTerminal: true,
    },
  ];

  const translateSingleStatement = (
    stmt: string,
    lineNumber: number,
    taskVars: Map<string, MigrationVariableDecl>,
    activeDigitsVarRef: { name: string }
  ): MigrationStep[] => {
    const emitted: MigrationStep[] = [];
    const trimmed = stmt.trim();
    if (!trimmed) return emitted;
    if (/^(?:OPEN|END)\s+VOICE\s+SESSION\b/i.test(trimmed)) return emitted;
    if (/^(?:GLOBAL|VAR|STRING|INTEGER|BOOLEAN)\s+[A-Za-z_]/i.test(trimmed) && !/=/.test(trimmed)) {
      // Pure declaration line: register LV_* in taskVars
      const lvDecl = trimmed.match(/\b(LV_[A-Za-z0-9_]+)\b/i);
      if (lvDecl) {
        const isInt = /count|retry|zaehler|versuch|index/i.test(lvDecl[1]);
        registry.ensureTaskVar(taskVars, lvDecl[1], isInt ? 'integer' : 'string', isInt ? 0 : '');
      }
      return emitted;
    }

    // Detect SET / ASSIGN on CV_ / GV_ / LV_ (prefix or _cv / _gv / _lv suffix) variables
    const assignMatch =
      trimmed.match(
        /^\s*SET\s+((?:CV|GV|LV)_[A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9_]*_(?:cv|gv|lv))\s*(?:=|:=)\s*(.+)$/i
      ) ||
      trimmed.match(
        /^\s*ASSIGN\s+(.+?)\s+TO\s+((?:CV|GV|LV)_[A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9_]*_(?:cv|gv|lv))\b/i
      ) ||
      trimmed.match(
        /^\s*ASSIGN\s+((?:CV|GV|LV)_[A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9_]*_(?:cv|gv|lv))\s*=\s*(.+)$/i
      );
    if (assignMatch) {
      const isAssignValToVar = /^\s*ASSIGN\s+.+?\s+TO\s+/i.test(trimmed);
      const vName = (isAssignValToVar ? assignMatch[2] : assignMatch[1]).trim();
      const rawRhs = (isAssignValToVar ? assignMatch[1] : assignMatch[2]).trim();
      const isCv = isCallVarIdentifier(vName);
      const isLv = isLocalVarIdentifier(vName);

      const rhsClean = rawRhs.replace(/^["']|["']$/g, '');
      const isSystemAni = /\b(?:CLID|CALLING[\s_]*NUMBER|CALL\.ANI)\b/i.test(rawRhs);
      const isSystemDnis = /\b(?:DNIS|DIALED[\s_]*NUMBER|CALL\.DNIS)\b/i.test(rawRhs);
      const isSystemEwt = /\b(?:EXPECTED\s+WAIT\s+TIME|EWT)\b/i.test(rawRhs);
      const isIntVal = !isSystemAni && !isSystemDnis && /^\d+$/.test(rawRhs) && /count|retry|zaehler|versuch/i.test(vName);
      const dataType: MigrationVariableDataType = isIntVal ? 'integer' : 'string';

      const decl = isLv
        ? registry.ensureTaskVar(taskVars, vName, dataType, isIntVal ? Number(rawRhs) : '')
        : registry.ensureFlowVar(vName, dataType, isIntVal ? Number(rawRhs) : '', isCv);

      const exprVal = isSystemAni
        ? 'Call.Ani'
        : isSystemDnis
        ? 'Call.Dnis'
        : isSystemEwt
        ? 'Call.EstimatedWaitTime'
        : undefined;

      if (isCv) {
        // First set flow var if there is a literal/expr, then persist to Participant Data
        emitted.push({
          id: nextStepId('upd'),
          kind: 'updateData',
          lineNumber,
          avayaCommand: 'SET/ASSIGN CV_*',
          label: `Update ${decl.refName}`,
          variableName: decl.name,
          variableRef: decl.refName,
          variableDataType: dataType,
          expressionValue: exprVal,
          literalValue: exprVal ? undefined : isIntVal ? Number(rawRhs) : rhsClean,
          isTerminal: false,
        });
        emitted.push({
          id: nextStepId('spd'),
          kind: 'setParticipantData',
          lineNumber,
          avayaCommand: 'SET/ASSIGN CV_*',
          label: `Set Participant Data: ${vName}`,
          variableName: vName,
          variableRef: decl.refName,
          expressionValue: decl.refName,
          isTerminal: false,
        });
      } else {
        emitted.push({
          id: nextStepId('upd'),
          kind: 'updateData',
          lineNumber,
          avayaCommand: isLv ? 'SET/ASSIGN LV_*' : 'SET/ASSIGN GV_*',
          label: `Update ${decl.refName}`,
          variableName: decl.name,
          variableRef: decl.refName,
          variableDataType: dataType,
          expressionValue: exprVal,
          literalValue: exprVal ? undefined : isIntVal ? Number(rawRhs) : rhsClean,
          isTerminal: false,
        });
      }
      return emitted;
    }

    // Standalone UUI / SIP Header
    if (/\b(?:SET\s+UUI|SEND\s+UUI|UUI[\s_]*DATA|SIP[\s_]*HEADER|ATTACHED[\s_]*DATA)\b/i.test(trimmed)) {
      const litMatch = trimmed.match(/=\s*["']([^"']+)["']/);
      emitted.push({
        id: nextStepId('uui'),
        kind: 'setUuiData',
        lineNumber,
        avayaCommand: 'UUI / SIP HEADER',
        label: 'Set UUI Data',
        target: 'SIP_UUI',
        expressionValue: litMatch
          ? `Append(Call.UserToUserInformation, "${litMatch[1].replace(/"/g, '\\"')}")`
          : 'Call.UserToUserInformation',
        isTerminal: false,
      });
      return emitted;
    }

    // 1. Oracle / FlixCheck API commands
    const apiMatch = trimmed.match(
      /^(SEND\s+REQUEST|GET\s+RESPONSE|SEND\s+INFO|HOST(?:\s+CALL)?)\b(.*)$/i
    );
    if (apiMatch) {
      const cmdLabel = apiMatch[1].replace(/\s+/g, ' ').toUpperCase();
      const rest = (apiMatch[2] || '').trim();
      const firstArg =
        rest.match(/["']([^"']+)["']/)?.[1] || rest.split(/[\s,;]+/)[0] || '';
      const apiKind =
        cmdLabel === 'SEND REQUEST'
          ? 'send-request'
          : cmdLabel === 'GET RESPONSE'
          ? 'get-response'
          : cmdLabel === 'SEND INFO'
          ? 'send-info'
          : 'host-call';
      const flixMeta = detectExternalApiIntegration({
        commandKind: apiKind,
        providerId: firstArg || undefined,
        argsText: rest,
        rawLine: trimmed,
        activeVars: oclVars.staticStringLiterals,
        moduleContextText: mod?.scriptName || node.scriptNumber,
      });

      if (flixMeta?.isFlixcheck || FLIXCHECK_RE.test(trimmed)) {
        flixcheckApiCount += 1;
        const target = flixMeta?.providerId || firstArg || 'FlixCheck_Action';
        const statusVar = registry.ensureTaskVar(taskVars, 'flixcheckStatus', 'string', '');
        const msgVar = registry.ensureTaskVar(taskVars, 'flixcheckMessage', 'string', '');
        emitted.push({
          id: nextStepId('da'),
          kind: 'callDataAction',
          lineNumber,
          avayaCommand: cmdLabel,
          label: `Data Action: FlixCheck (${target})`,
          target,
          targetSlug: toCleanGraphSlug(target, 'FlixCheck_Action'),
          dataActionCategory: 'FlixCheck_API',
          dataActionInputs: [
            { name: 'callerAni', expr: 'Call.Ani' },
            { name: 'dialedDnis', expr: 'Call.Dnis' },
            ...(taskVars.has(activeDigitsVarRef.name.toLowerCase())
              ? [{ name: 'mobileNumber', expr: `Task.${activeDigitsVarRef.name}` }]
              : []),
          ],
          dataActionOutputs: [
            {
              field: 'status',
              targetVarName: statusVar.name,
              targetVarRef: statusVar.refName,
              dataType: 'string',
            },
            {
              field: 'message',
              targetVarName: msgVar.name,
              targetVarRef: msgVar.refName,
              dataType: 'string',
            },
          ],
          successSteps: [],
          failureSteps: [makeFallbackJumpStep(lineNumber, `FlixCheck Fehler ${target}`)],
          timeoutSteps: [makeFallbackJumpStep(lineNumber, `FlixCheck Timeout ${target}`)],
          isTerminal: false,
        });
      } else if (ORACLE_RE.test(trimmed) || cmdLabel.startsWith('HOST')) {
        oracleApiCount += 1;
        const target = firstArg || 'Oracle_Host_Action';
        const codeVar = registry.ensureTaskVar(taskVars, 'oracleStatusCode', 'string', '');
        const payloadVar = registry.ensureTaskVar(taskVars, 'oracleResponse', 'string', '');
        emitted.push({
          id: nextStepId('da'),
          kind: 'callDataAction',
          lineNumber,
          avayaCommand: cmdLabel,
          label: `Data Action: Oracle (${target})`,
          target,
          targetSlug: toCleanGraphSlug(target, 'Oracle_Host_Action'),
          dataActionCategory: 'Oracle_Integration',
          dataActionInputs: [
            { name: 'callerAni', expr: 'Call.Ani' },
            { name: 'dialedDnis', expr: 'Call.Dnis' },
          ],
          dataActionOutputs: [
            {
              field: 'statusCode',
              targetVarName: codeVar.name,
              targetVarRef: codeVar.refName,
              dataType: 'string',
            },
            {
              field: 'responsePayload',
              targetVarName: payloadVar.name,
              targetVarRef: payloadVar.refName,
              dataType: 'string',
            },
          ],
          successSteps: [],
          failureSteps: [makeFallbackJumpStep(lineNumber, `Oracle Fehler ${target}`)],
          timeoutSteps: [makeFallbackJumpStep(lineNumber, `Oracle Timeout ${target}`)],
          isTerminal: false,
        });
      }
      return emitted;
    }

    // Data Table Lookup
    const dataTableMatch = trimmed.match(
      /\b(?:LOOKUP|DATA\s+TABLE|READ\s+TABLE|ROUTING\s+TABLE)\s+(?:"([^"]+)"|'([^']+)'|([A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]*))/i
    );
    if (dataTableMatch) {
      const tableName = (dataTableMatch[1] || dataTableMatch[2] || dataTableMatch[3] || 'Routing_Table').trim();
      emitted.push({
        id: nextStepId('dt'),
        kind: 'callDataTableLookup',
        lineNumber,
        avayaCommand: 'DATA TABLE LOOKUP',
        label: `Data Table Lookup: ${tableName}`,
        target: tableName,
        targetSlug: toCleanGraphSlug(tableName, 'Routing_Table'),
        dataTableKey: 'Call.Dnis',
        foundSteps: [],
        notFoundSteps: [makeFallbackJumpStep(lineNumber, `DataTable ${tableName} NotFound`)],
        isTerminal: false,
      });
      return emitted;
    }

    // Standalone Priority
    const standalonePrioMatch =
      trimmed.match(/\bASSIGN\s+(\d{1,5})\s+TO\s+PRIORITY\b/i) ||
      trimmed.match(/\bSET\s+PRIORITY\s*(?:=|:=)\s*(\d{1,5})\b/i);
    if (standalonePrioMatch) {
      const prioVal = Number(standalonePrioMatch[1]);
      emitted.push({
        id: nextStepId('prio'),
        kind: 'setPriority',
        lineNumber,
        avayaCommand: 'ASSIGN/SET PRIORITY',
        label: `Set Priority: ${prioVal}`,
        target: String(prioVal),
        priorityValue: Number.isFinite(prioVal) ? prioVal : 50,
        isTerminal: false,
      });
      return emitted;
    }

    // Callback
    const callbackMatch = trimmed.match(
      /\b(?:OFFER\s+CALLBACK|CREATE\s+CALLBACK|CALLBACK|RUECKRUF)\b(?:\s+(?:TO\s+)?(?:"([^"]+)"|'([^']+)'|([A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]*)))?/i
    );
    if (callbackMatch && !/\b(?:EXECUTE|CALL\s+SCRIPT|SUBSCRIPT)\b/i.test(trimmed)) {
      const cbTarget = (
        callbackMatch[1] ||
        callbackMatch[2] ||
        callbackMatch[3] ||
        `${node.scriptNumber}_Callback`
      ).trim();
      emitted.push({
        id: nextStepId('cb'),
        kind: 'createCallback',
        lineNumber,
        avayaCommand: 'CALLBACK',
        label: `Create Callback: ${cbTarget}`,
        target: cbTarget,
        targetSlug: toCleanGraphSlug(cbTarget, 'Callback_Queue'),
        successSteps: [
          {
            id: nextStepId('disc'),
            kind: 'disconnect',
            lineNumber,
            avayaCommand: 'CALLBACK_DONE',
            label: 'Disconnect (Callback Created)',
            target: 'Callback_Created',
            isTerminal: true,
          },
        ],
        failureSteps: [makeFallbackJumpStep(lineNumber, `Callback Fehler ${cbTarget}`)],
        isTerminal: false,
      });
      return emitted;
    }

    // Voicemail (Terminal)
    const voicemailMatch = trimmed.match(
      /\b(?:TRANSFER\s+TO\s+VOICEMAIL|GIVE\s+VOICEMAIL|VOICEMAIL|ANRUFBEANTWORTER)\b(?:\s+(?:TO\s+)?(?:"([^"]+)"|'([^']+)'|([A-Za-zÄÖÜäöüß0-9_.-]+)))?/i
    );
    if (voicemailMatch && !/\b(?:EXECUTE|CALL\s+SCRIPT|SUBSCRIPT)\b/i.test(trimmed)) {
      const vmTarget = (
        voicemailMatch[1] ||
        voicemailMatch[2] ||
        voicemailMatch[3] ||
        `${node.scriptNumber}_Voicemail`
      ).trim();
      emitted.push({
        id: nextStepId('vm'),
        kind: 'transferToVoicemail',
        lineNumber,
        avayaCommand: 'VOICEMAIL',
        label: `Transfer to Voicemail: ${vmTarget}`,
        target: vmTarget,
        targetSlug: toCleanGraphSlug(vmTarget, 'Voicemail_Queue'),
        isTerminal: true,
      });
      return emitted;
    }

    // Set Language
    const langMatch = trimmed.match(
      /\b(?:SET\s+LANGUAGE|LANGUAGE\s*=)\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_-]{2,12}))/i
    );
    if (langMatch) {
      const rawLang = (langMatch[1] || langMatch[2] || langMatch[3] || 'de-de').trim().toLowerCase();
      const normalizedLang =
        rawLang === 'de' || rawLang === 'deutsch' || rawLang === 'german'
          ? 'de-de'
          : rawLang === 'en' || rawLang === 'english' || rawLang === 'englisch'
          ? 'en-us'
          : rawLang === 'fr' || rawLang === 'french'
          ? 'fr-fr'
          : /^[a-z]{2}-[a-z]{2}$/.test(rawLang)
          ? rawLang
          : 'de-de';
      emitted.push({
        id: nextStepId('lang'),
        kind: 'setLanguage',
        lineNumber,
        avayaCommand: 'SET LANGUAGE',
        label: `Set Language: ${normalizedLang}`,
        target: normalizedLang,
        languageCode: normalizedLang,
        isTerminal: false,
      });
      return emitted;
    }

    // GIVE MUSIC / GIVE RINGBACK
    const holdMusicMatch = trimmed.match(
      /\bGIVE\s+(MUSIC|RINGBACK)\b(?:\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+)))?/i
    );
    if (holdMusicMatch) {
      const kindWord = holdMusicMatch[1].toUpperCase();
      const musicName = (
        holdMusicMatch[2] ||
        holdMusicMatch[3] ||
        holdMusicMatch[4] ||
        (kindWord === 'RINGBACK' ? 'Ringback_Tone' : 'Default_Hold_Music')
      ).trim();
      warnings.push({
        code: 'IN_QUEUE_FLOW_REQUIRED',
        severity: 'warning',
        message: `Wartebehandlung (GIVE ${kindWord}) in Zeile ${lineNumber}: Wartemusik/Ringback in Genesys Cloud in einen eigenen In-Queue Call Flow auslagern.`,
        lineNumber,
      });
      emitted.push({
        id: nextStepId('hm'),
        kind: 'playHoldMusic',
        lineNumber,
        avayaCommand: `GIVE ${kindWord}`,
        label: `Hold Music (In-Queue): ${musicName}`,
        target: musicName,
        targetSlug: toCleanGraphSlug(musicName, 'Hold_Music'),
        isTerminal: false,
      });
      return emitted;
    }

    // GIVE BUSY (Terminal)
    if (/\bGIVE\s+BUSY\b/i.test(trimmed)) {
      emitted.push({
        id: nextStepId('disc'),
        kind: 'disconnect',
        lineNumber,
        avayaCommand: 'GIVE BUSY',
        label: 'Disconnect (Busy Tone)',
        target: 'Busy_Tone',
        isTerminal: true,
      });
      return emitted;
    }

    // WAIT n
    const waitMatch = trimmed.match(/^\s*WAIT\s+(\d{1,5})(?:\s*(?:SEC|SECONDS|S))?\b/i);
    if (waitMatch) {
      const secs = Math.max(1, Number(waitMatch[1]) || 10);
      warnings.push({
        code: 'IN_QUEUE_FLOW_REQUIRED',
        severity: 'warning',
        message: `WAIT ${secs}s in Zeile ${lineNumber}: Warte-Pausen in Warteschleifen in Genesys Cloud über In-Queue Call Flow / Delay abbilden.`,
        lineNumber,
      });
      emitted.push({
        id: nextStepId('wait'),
        kind: 'delay',
        lineNumber,
        avayaCommand: `WAIT ${secs}`,
        label: `Delay (In-Queue): ${secs}s`,
        target: `${secs}s`,
        delaySeconds: secs,
        isTerminal: false,
      });
      return emitted;
    }

    // GIVE RAN / PLAY PROMPT
    const promptMatch = trimmed.match(
      /\b(?:GIVE\s+(?:RAN|ANNOUNCEMENT)|PLAY\s+(?:PROMPT|AUDIO|ANNOUNCEMENT)(?:\s+VOICE\s+SEGMENT)?)\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+))/i
    );
    if (promptMatch) {
      const promptName = (promptMatch[1] || promptMatch[2] || promptMatch[3] || '').trim();
      if (promptName) {
        const slug = toCleanGraphSlug(promptName, 'Prompt');
        emitted.push({
          id: nextStepId('aud'),
          kind: 'playAudio',
          lineNumber,
          avayaCommand: 'GIVE RAN / PLAY PROMPT',
          label: `Play Audio: Prompt.${slug}`,
          target: promptName,
          targetSlug: slug,
          ttsText: `Ansage Prompt.${slug}`,
          isTerminal: false,
        });
      }
      return emitted;
    }

    // COLLECT DIGITS / GIVE IVR
    const collectMatch = trimmed.match(
      /\b(COLLECT\s+(\d{1,2})\s+DIGITS|COLLECT\s+DIGITS|GIVE\s+IVR)\b(.*)$/i
    );
    if (collectMatch) {
      const explicitDigits = collectMatch[2] ? Number(collectMatch[2]) : undefined;
      const rest = (collectMatch[3] || '').trim();
      const intoMatch = rest.match(/\bINTO\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
      const targetVarRaw = intoMatch ? intoMatch[1] : 'collectedDigits';
      const targetVarDecl = registry.ensureTaskVar(taskVars, targetVarRaw, 'string', '');
      activeDigitsVarRef.name = targetVarDecl.name;

      const promptTok =
        rest.match(/["']([^"']+)["']/)?.[1] ||
        (rest.replace(/\bINTO\s+[A-Za-z_][A-Za-z0-9_]*/i, '').trim().split(/\s+/)[0] ||
          'DTMF_Input');

      const digitSpec: MigrationCollectDigitSpec =
        explicitDigits && Number.isFinite(explicitDigits)
          ? { mode: 'exact', exact: explicitDigits }
          : { mode: 'range', min: 1, max: 16 };

      emitted.push({
        id: nextStepId('col'),
        kind: 'collectInput',
        lineNumber,
        avayaCommand: collectMatch[1].replace(/\s+/g, ' ').toUpperCase(),
        label: `Collect Input: ${targetVarDecl.refName}`,
        target: promptTok,
        targetSlug: toCleanGraphSlug(promptTok, 'DTMF_Input'),
        inputVarName: targetVarDecl.name,
        inputVarRef: targetVarDecl.refName,
        digitSpec,
        noEntryTimeoutSec: 5,
        interDigitTimeoutSec: 3,
        terminatingCharacter: digitSpec.mode === 'exact' && digitSpec.exact === 1 ? undefined : '#',
        noEntryTts: 'Es wurde keine Eingabe erkannt. Bitte versuchen Sie es erneut.',
        noMatchTts: 'Die Eingabe war ungueltig. Bitte wiederholen Sie Ihre Eingabe.',
        successSteps: [],
        failureSteps: [makeFallbackJumpStep(lineNumber, `CollectInput Failure ${promptTok}`)],
        isTerminal: false,
      });
      return emitted;
    }

    // QUEUE TO SKILLSET (Terminal!)
    const queueMatch = trimmed.match(
      /\bQUEUE\s+TO\s+(?:NETWORK\s+)?(?:SKILLSET|AGENT)\s+(.+?)(?:\s+WITH\s+PRIORITY\s+(\d{1,5})|\s+PRIORITY\s+(\d{1,5})|$)/i
    );
    if (queueMatch) {
      const inlinePrioRaw = queueMatch[2] || queueMatch[3];
      if (inlinePrioRaw) {
        const prioVal = Number(inlinePrioRaw);
        if (Number.isFinite(prioVal)) {
          emitted.push({
            id: nextStepId('prio'),
            kind: 'setPriority',
            lineNumber,
            avayaCommand: 'QUEUE WITH PRIORITY',
            label: `Set Priority: ${prioVal}`,
            target: String(prioVal),
            priorityValue: prioVal,
            isTerminal: false,
          });
        }
      }
      const items = queueMatch[1]
        .split(',')
        .map((item) => normalizeScriptRef(item.trim().replace(/^["']|["']$/g, '')))
        .filter((item) => Boolean(item) && !isDeactivatedSentinelTarget(item));

      if (items.length > 0) {
        items.forEach((s) => uniqueSkillsets.add(s));
        const isMulti = items.length > 1;
        if (isMulti) {
          hasMultiSkillset = true;
          warnings.push({
            code: 'MULTI_SKILLSET_BULLSEYE',
            severity: 'warning',
            message: `Multi-Skillset-Queueing (${items.join(', ')}) in Zeile ${lineNumber}: Genesys queuet nicht parallel in mehrere Queues – eine Ziel-Queue plus ACD Skills & Bullseye-Ringe nutzen.`,
            lineNumber,
          });
        }
        emitted.push({
          id: nextStepId('acd'),
          kind: 'transferToAcd',
          lineNumber,
          avayaCommand: isMulti ? 'QUEUE TO SKILLSET (Multi)' : 'QUEUE TO SKILLSET',
          label: isMulti
            ? `ACD Queue + Bullseye: ${items[0]} (${items.join(', ')})`
            : `ACD Queue: ${items[0]}`,
          target: items[0],
          targetSlug: toCleanGraphSlug(items[0], 'Default_Queue'),
          skills: isMulti ? items : undefined,
          isMultiSkillset: isMulti,
          warning: isMulti
            ? 'Multi-Skillset in eine Ziel-Queue + ACD Skills & Bullseye-Ringe umbauen'
            : undefined,
          resolvedTargetType: 'queue',
          isTerminal: true,
        });
      }
      return emitted;
    }

    // GOTO <Target>
    const gotoMatch = trimmed.match(
      /\bGOTO\s+(?:"([^"]+)"|'([^']+)'|([A-Za-zÄÖÜäöüß0-9_.-]+))/i
    );
    if (gotoMatch) {
      const rawTarget = (gotoMatch[1] || gotoMatch[2] || gotoMatch[3] || '').trim();
      if (rawTarget) {
        const lowerTarget = rawTarget.toLowerCase();
        const secLine = sectionLineByLower.get(lowerTarget);
        const secRefId = sectionRefIdByLower.get(lowerTarget);
        if (secLine !== undefined && secRefId) {
          if (secLine <= lineNumber) {
            backwardGotoCount += 1;
            const msg = `Unstrukturiertes Rückwärts-GOTO in Loop umbauen (GOTO ${rawTarget} in Zeile ${lineNumber} -> SECTION ${rawTarget} in Zeile ${secLine}).`;
            warnings.push({
              code: 'BACKWARD_GOTO_LOOP',
              severity: 'warning',
              message: msg,
              lineNumber,
            });
            const loopIdxVar = registry.ensureTaskVar(
              taskVars,
              `loopIndex_${toCleanGraphSlug(rawTarget, 'sec')}`,
              'integer',
              0
            );
            emitted.push({
              id: nextStepId('loop'),
              kind: 'loop',
              lineNumber,
              avayaCommand: 'GOTO (rückwärts)',
              label: `Loop: ${rawTarget}`,
              target: rawTarget,
              targetSlug: toCleanGraphSlug(rawTarget, 'SectionLoop'),
              isBackwardGoto: true,
              maxLoopCount: 5,
              currentIndexVarName: loopIdxVar.name,
              bodySteps: [
                {
                  id: nextStepId('aud'),
                  kind: 'playAudio',
                  lineNumber,
                  avayaCommand: 'LOOP_RETRY_STEP',
                  label: `Wiederholung Abschnitt ${rawTarget}`,
                  target: `Retry_${toCleanGraphSlug(rawTarget, 'Section')}`,
                  targetSlug: `Retry_${toCleanGraphSlug(rawTarget, 'Section')}`,
                  ttsText: `Wiederhole Abschnitt ${rawTarget} (max. 5 Durchlaeufe).`,
                  isTerminal: false,
                },
              ],
              warning: msg,
              isTerminal: false,
            });
          } else {
            // Forward GOTO -> real Architect jumpToReusableTask (Terminal!)
            emitted.push({
              id: nextStepId('jmp'),
              kind: 'jumpToReusableTask',
              lineNumber,
              avayaCommand: 'GOTO (vorwärts)',
              label: `Jump to Task: ${rawTarget}`,
              target: rawTarget,
              targetSlug: secRefId,
              targetTaskRefId: secRefId,
              isTerminal: true,
            });
          }
        } else {
          const targetKey = canonicalScriptMatchKey(stripKnownScriptExtension(rawTarget));
          if (ctx.knownKeyLookup.has(targetKey)) {
            emitted.push(...handleSubscriptOrExternalCall(rawTarget, 'GOTO', lineNumber, taskVars, activeDigitsVarRef));
          }
        }
      }
      return emitted;
    }

    // GIVE CDN / TRANSFER TO / ROUTE CALL -> Normalized Transfer Target (Terminal!)
    const transferMatch = trimmed.match(
      /\b(GIVE\s+CDN|TRANSFER\s+TO|ROUTE\s+CALL(?:\s+TO)?)\s+(?:CDN\s+|VDN\s+|SCRIPT\s+)?(?:"([^"]+)"|'([^']+)'|(\+?\d{2,18}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]*))/i
    );
    if (transferMatch) {
      const cmd = transferMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
      const rawTarget = resolveStaticVar(transferMatch[2] || transferMatch[3] || transferMatch[4] || '');
      if (rawTarget) {
        const norm = normalizeTransferTarget(rawTarget, lineNumber, ctx.knownKeyLookup, node.scriptKey);
        normalizedTargets.push(norm);
        if (norm.kind === 'internal-script') {
          emitted.push(...handleSubscriptOrExternalCall(rawTarget, cmd, lineNumber, taskVars, activeDigitsVarRef));
        } else if (norm.kind === 'external-e164') {
          emitted.push({
            id: nextStepId('trn'),
            kind: 'transferToNumber',
            lineNumber,
            avayaCommand: cmd,
            label: `Transfer to Number: ${norm.normalizedTarget}`,
            target: norm.normalizedTarget,
            originalTransferTarget: norm.originalTarget,
            normalizedE164: norm.normalizedTarget,
            normalizationNote: norm.note,
            resolvedTargetType: 'externalNumber',
            isTerminal: true,
          });
        } else {
          if (/^\d{2,6}$/.test(rawTarget)) {
            warnings.push({
              code: 'INTERNAL_CDN_NORMALIZED',
              severity: 'warning',
              message: `Kurzwahl/CDN "${rawTarget}" in Zeile ${lineNumber} als ACD-Queue "${norm.normalizedTarget}" normalisiert (in Ziel-Org auf passende Queue/Flow mappen).`,
              lineNumber,
            });
          }
          emitted.push({
            id: nextStepId('acd'),
            kind: 'transferToAcd',
            lineNumber,
            avayaCommand: cmd,
            label: `ACD Queue (CDN): ${norm.normalizedTarget}`,
            target: norm.normalizedTarget,
            targetSlug: norm.normalizedTarget,
            originalTransferTarget: norm.originalTarget,
            normalizationNote: norm.note,
            resolvedTargetType: 'queue',
            isTerminal: true,
          });
        }
      }
      return emitted;
    }

    // DISCONNECT / ROUTE END / DROP CALL (Terminal!)
    if (/\b(?:DISCONNECT|ROUTE\s+END|DROP\s+CALL)\b/i.test(trimmed)) {
      emitted.push({
        id: nextStepId('disc'),
        kind: 'disconnect',
        lineNumber,
        avayaCommand: /\bROUTE\s+END\b/i.test(trimmed)
          ? 'ROUTE END'
          : /\bDROP\s+CALL\b/i.test(trimmed)
          ? 'DROP CALL'
          : 'DISCONNECT',
        label: 'Disconnect Call',
        isTerminal: true,
      });
      return emitted;
    }

    // EXECUTE / GOSUB / CALL SCRIPT / SUBSCRIPT
    const execMatch =
      trimmed.match(
        /\b(EXECUTE(?:\s+SCRIPT)?|GOSUB|CALL\s+SCRIPT|SUBSCRIPT)\s+(?:"([^"]+)"|'([^']+)'|(\+?\d{2,18}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]*))/i
      ) ||
      trimmed.match(
        /^(CALL)\s+(?:"([^"]+)"|'([^']+)'|(\+?\d{2,18}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]*))/i
      );
    if (execMatch) {
      const cmd = execMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
      const token = (execMatch[2] || execMatch[3] || execMatch[4] || '').trim();
      if (token) {
        emitted.push(...handleSubscriptOrExternalCall(token, cmd, lineNumber, taskVars, activeDigitsVarRef));
      }
      return emitted;
    }

    return emitted;
  };

  const handleSubscriptOrExternalCall = (
    rawToken: string,
    cmdLabel: string,
    lineNumber: number,
    taskVars: Map<string, MigrationVariableDecl>,
    activeDigitsVarRef: { name: string }
  ): MigrationStep[] => {
    const resolved = resolveStaticVar(rawToken);
    const clean = normalizeScriptRef(stripKnownScriptExtension(resolved));
    if (
      !clean ||
      isDeactivatedSentinelTarget(clean) ||
      isDynamicAvayaVariableTarget(clean, oclVars.declaredVars)
    ) {
      return [];
    }

    const matchKey = canonicalScriptMatchKey(clean);
    const knownPrimaryKey = ctx.knownKeyLookup.get(matchKey);

    const waypointReason = classifyAvayaWaypointTarget(clean, {
      knownScriptKeys: ctx.knownKeyLookup,
      declaredVars: oclVars.declaredVars,
    });

    if (!knownPrimaryKey && (FLIXCHECK_RE.test(clean) || /flixcheck/i.test(waypointReason || ''))) {
      flixcheckApiCount += 1;
      const statusVar = registry.ensureTaskVar(taskVars, 'flixcheckStatus', 'string', '');
      return [
        {
          id: nextStepId('da'),
          kind: 'callDataAction',
          lineNumber,
          avayaCommand: cmdLabel,
          label: `Data Action: FlixCheck (${clean})`,
          target: clean,
          targetSlug: toCleanGraphSlug(clean, 'FlixCheck_Action'),
          dataActionCategory: 'FlixCheck_API',
          dataActionInputs: [
            { name: 'callerAni', expr: 'Call.Ani' },
            { name: 'dialedDnis', expr: 'Call.Dnis' },
            ...(taskVars.has(activeDigitsVarRef.name.toLowerCase())
              ? [{ name: 'mobileNumber', expr: `Task.${activeDigitsVarRef.name}` }]
              : []),
          ],
          dataActionOutputs: [
            {
              field: 'status',
              targetVarName: statusVar.name,
              targetVarRef: statusVar.refName,
              dataType: 'string',
            },
          ],
          successSteps: [],
          failureSteps: [makeFallbackJumpStep(lineNumber, `FlixCheck Fehler ${clean}`)],
          timeoutSteps: [makeFallbackJumpStep(lineNumber, `FlixCheck Timeout ${clean}`)],
          isTerminal: false,
        },
      ];
    }

    if (!knownPrimaryKey && (ORACLE_RE.test(clean) || /oracle/i.test(waypointReason || ''))) {
      oracleApiCount += 1;
      const codeVar = registry.ensureTaskVar(taskVars, 'oracleStatusCode', 'string', '');
      return [
        {
          id: nextStepId('da'),
          kind: 'callDataAction',
          lineNumber,
          avayaCommand: cmdLabel,
          label: `Data Action: Oracle (${clean})`,
          target: clean,
          targetSlug: toCleanGraphSlug(clean, 'Oracle_Action'),
          dataActionCategory: 'Oracle_Integration',
          dataActionInputs: [
            { name: 'callerAni', expr: 'Call.Ani' },
            { name: 'dialedDnis', expr: 'Call.Dnis' },
          ],
          dataActionOutputs: [
            {
              field: 'statusCode',
              targetVarName: codeVar.name,
              targetVarRef: codeVar.refName,
              dataType: 'string',
            },
          ],
          successSteps: [],
          failureSteps: [makeFallbackJumpStep(lineNumber, `Oracle Fehler ${clean}`)],
          timeoutSteps: [makeFallbackJumpStep(lineNumber, `Oracle Timeout ${clean}`)],
          isTerminal: false,
        },
      ];
    }

    // Pure numeric CDN not in known scripts -> normalized target
    if (!knownPrimaryKey && /^\+?\d{2,18}$/.test(clean)) {
      const norm = normalizeTransferTarget(clean, lineNumber, ctx.knownKeyLookup, node.scriptKey);
      normalizedTargets.push(norm);
      if (norm.kind === 'external-e164') {
        return [
          {
            id: nextStepId('trn'),
            kind: 'transferToNumber',
            lineNumber,
            avayaCommand: cmdLabel,
            label: `Transfer to Number: ${norm.normalizedTarget}`,
            target: norm.normalizedTarget,
            originalTransferTarget: norm.originalTarget,
            normalizedE164: norm.normalizedTarget,
            normalizationNote: norm.note,
            isTerminal: true,
          },
        ];
      }
      return [
        {
          id: nextStepId('acd'),
          kind: 'transferToAcd',
          lineNumber,
          avayaCommand: cmdLabel,
          label: `ACD Queue (CDN): ${norm.normalizedTarget}`,
          target: norm.normalizedTarget,
          targetSlug: norm.normalizedTarget,
          originalTransferTarget: norm.originalTarget,
          normalizationNote: norm.note,
          isTerminal: true,
        },
      ];
    }

    const targetPoolKey = knownPrimaryKey || matchKey;
    const incomingCalls = ctx.incomingCallCountByKey.get(targetPoolKey) || 0;
    const isBroken = !knownPrimaryKey && ctx.brokenTargetKeysForScript.has(matchKey);

    if (incomingCalls >= 3) {
      commonModuleCallCount += 1;
      return [
        {
          id: nextStepId('cm'),
          kind: 'callCommonModule',
          lineNumber,
          avayaCommand: cmdLabel,
          label: `Common Module: ${clean}`,
          target: clean,
          targetSlug: toCleanGraphSlug(clean, 'CommonModule'),
          isBrokenTarget: isBroken,
          isTerminal: false,
        },
      ];
    }

    callTaskCount += 1;
    let taskRefId = toCleanGraphSlug(clean, 'SubTask');
    if (taskRefId === 'Main_Task' || taskRefId === 'Fallback_Error_Task') {
      taskRefId = `Sub_${taskRefId}`;
    }
    if (!localSubscriptRefsMap.has(taskRefId)) {
      localSubscriptRefsMap.set(taskRefId, {
        name: taskRefId,
        refId: taskRefId,
        originalTarget: clean,
        targetKey: targetPoolKey,
      });
    }
    return [
      {
        id: nextStepId('ct'),
        kind: 'callTask',
        lineNumber,
        avayaCommand: cmdLabel,
        label: `Call Task: ${clean}`,
        target: clean,
        targetSlug: taskRefId,
        targetTaskRefId: taskRefId,
        isBrokenTarget: isBroken,
        isTerminal: false,
      },
    ];
  };

  /**
   * Emits prerequisite system/API prep steps (e.g. Get Queue Observations for LOGGED AGENTS,
   * EWT capture) before evaluating a condition.
   * Note: General CV_* / *_cv data provenance is handled path-sensitively in the dedicated
   * Variable-Provenance pass after section inlining so already-set variables are never re-read.
   */
  const emitConditionPrerequisites = (
    cond: string,
    lineNumber: number,
    taskVars: Map<string, MigrationVariableDecl>
  ): MigrationStep[] => {
    const prep: MigrationStep[] = [];

    if (/\b(?:EXPECTED\s+WAIT\s+TIME|EWT)\b/i.test(cond)) {
      warnings.push({
        code: 'IN_QUEUE_FLOW_REQUIRED',
        severity: 'warning',
        message: `Expected Wait Time (EWT) in Zeile ${lineNumber}: In Genesys Cloud über Call.EstimatedWaitTime (Ansage im In-Queue Flow) abbilden.`,
        lineNumber,
      });
      const ewtVar = registry.ensureFlowVar('estimatedWaitTime', 'integer', 0);
      prep.push({
        id: nextStepId('upd'),
        kind: 'updateData',
        lineNumber,
        avayaCommand: 'EXPECTED WAIT TIME',
        label: `Capture ${ewtVar.refName}`,
        variableName: ewtVar.name,
        variableRef: ewtVar.refName,
        variableDataType: 'integer',
        expressionValue: 'ToInt(Call.EstimatedWaitTime)',
        isTerminal: false,
      });
    }

    if (
      /\b(?:LOGGED\s+AGENTS|AGENTS\s+TOTAL|AVAILABLE\s+AGENTS|STAFFED\s+AGENTS|QUEUE\s+AGENTS)\b/i.test(
        cond
      )
    ) {
      warnings.push({
        code: 'QUEUE_OBSERVATIONS_API',
        severity: 'warning',
        message: `Agenten-Verfügbarkeitsprüfung (LOGGED AGENTS) in Zeile ${lineNumber}: In Genesys Cloud über Data Action (Get Queue Observations API) abbilden.`,
        lineNumber,
      });
      const agVar = registry.ensureTaskVar(taskVars, 'queueAgentsOnline', 'integer', 0);
      prep.push({
        id: nextStepId('da'),
        kind: 'callDataAction',
        lineNumber,
        avayaCommand: 'LOGGED AGENTS',
        label: 'Data Action: Queue Observations (Get_Queue_Observations)',
        target: 'Get_Queue_Observations',
        targetSlug: 'Get_Queue_Observations',
        dataActionCategory: 'Genesys_Cloud_Data_Actions',
        dataActionInputs: [{ name: 'queueName', expr: `"${toCleanGraphSlug(node.scriptNumber, 'Default_Queue')}"` }],
        dataActionOutputs: [
          {
            field: 'oOnQueueUsers',
            targetVarName: agVar.name,
            targetVarRef: agVar.refName,
            dataType: 'integer',
          },
        ],
        successSteps: [],
        failureSteps: [makeFallbackJumpStep(lineNumber, 'Queue Observations Failure')],
        timeoutSteps: [makeFallbackJumpStep(lineNumber, 'Queue Observations Timeout')],
        isTerminal: false,
      });
    }

    return prep;
  };

  /**
   * Parses a slice of OCL lines recursively into structured branching MigrationSteps.
   */
  const parseBlockLines = (
    blockLines: SourceLine[],
    taskVars: Map<string, MigrationVariableDecl>,
    activeDigitsVarRef: { name: string }
  ): MigrationStep[] => {
    const steps: MigrationStep[] = [];
    let idx = 0;

    while (idx < blockLines.length) {
      const { lineNumber, text } = blockLines[idx];

      // A. Multi-line IF ... THEN ... [ELSE IF ...] [ELSE ...] END IF
      const multiIfCond = isMultiLineIfHeader(text);
      if (multiIfCond !== null) {
        const branches: Array<{ condition: string; lineNumber: number; lines: SourceLine[] }> = [
          { condition: multiIfCond, lineNumber, lines: [] },
        ];
        let elseLines: SourceLine[] = [];
        let inElse = false;
        let depth = 1;
        let j = idx + 1;

        while (j < blockLines.length && depth > 0) {
          const cur = blockLines[j];
          if (isMultiLineIfHeader(cur.text) !== null) {
            depth += 1;
            if (inElse) elseLines.push(cur);
            else branches[branches.length - 1].lines.push(cur);
          } else if (isEndIfLine(cur.text)) {
            depth -= 1;
            if (depth > 0) {
              if (inElse) elseLines.push(cur);
              else branches[branches.length - 1].lines.push(cur);
            }
          } else if (depth === 1 && !inElse && isMultiLineElseIfHeader(cur.text) !== null) {
            branches.push({
              condition: isMultiLineElseIfHeader(cur.text)!,
              lineNumber: cur.lineNumber,
              lines: [],
            });
          } else if (depth === 1 && !inElse && isElseLine(cur.text)) {
            inElse = true;
          } else {
            if (inElse) elseLines.push(cur);
            else branches[branches.length - 1].lines.push(cur);
          }
          j += 1;
        }

        // Advance outer cursor past END IF
        idx = j;

        const firstBranch = branches[0];
        const prep = emitConditionPrerequisites(firstBranch.condition, firstBranch.lineNumber, taskVars);

        // Schedule / Holiday block -> real evaluateScheduleGroup with populated open/closed/holiday!
        if (SCHEDULE_COND_RE.test(firstBranch.condition)) {
          const sgName = `${toCleanGraphSlug(node.scriptNumber || 'Default')}_ScheduleGroup`;
          const thenSteps = parseBlockLines(firstBranch.lines, taskVars, activeDigitsVarRef);
          const rawElseSteps = parseBlockLines(elseLines, taskVars, activeDigitsVarRef);

          const isHolidayCheck =
            HOLIDAY_ONLY_COND_RE.test(firstBranch.condition) &&
            !/\b(?:DAY\s+OF\s+WEEK|TIME\s+OF\s+DAY)\b/i.test(firstBranch.condition);

          // Check if the immediately preceding step is already an evaluateScheduleGroup and this is a sibling IF HOLIDAY
          const prevStep = steps[steps.length - 1];
          if (isHolidayCheck && prevStep && prevStep.kind === 'evaluateScheduleGroup') {
            prevStep.holidaySteps =
              thenSteps.length > 0
                ? thenSteps
                : makeClosedDisconnectSteps(firstBranch.lineNumber, 'Feiertag');
            if (rawElseSteps.length > 0 && (prevStep.openSteps || []).length === 0) {
              prevStep.openSteps = rawElseSteps;
            }
            continue;
          }

          // Collect remaining continuation lines if the schedule branch did not have an explicit ELSE
          let continuationSteps: MigrationStep[] = [];
          if (idx < blockLines.length) {
            // Peek: if next statement is a sibling IF HOLIDAY, let it merge into holidaySteps before consuming continuation
            const nextIfCond = isMultiLineIfHeader(blockLines[idx].text);
            const isNextHoliday =
              nextIfCond !== null &&
              HOLIDAY_ONLY_COND_RE.test(nextIfCond) &&
              !/\b(?:DAY\s+OF\s+WEEK|TIME\s+OF\s+DAY)\b/i.test(nextIfCond);
            if (!isNextHoliday && (isHolidayCheck || rawElseSteps.length === 0)) {
              continuationSteps = parseBlockLines(blockLines.slice(idx), taskVars, activeDigitsVarRef);
              idx = blockLines.length;
            }
          }

          const openSteps = isHolidayCheck
            ? rawElseSteps.length > 0
              ? rawElseSteps
              : continuationSteps
            : thenSteps;

          const closedSteps = isHolidayCheck
            ? makeClosedDisconnectSteps(firstBranch.lineNumber, 'Geschlossen')
            : rawElseSteps.length > 0
            ? rawElseSteps
            : continuationSteps.length > 0
            ? continuationSteps
            : makeClosedDisconnectSteps(firstBranch.lineNumber, 'Geschlossen');

          const holidaySteps = isHolidayCheck
            ? thenSteps.length > 0
              ? thenSteps
              : makeClosedDisconnectSteps(firstBranch.lineNumber, 'Feiertag')
            : makeClosedDisconnectSteps(firstBranch.lineNumber, 'Feiertag');

          // Ensure openSteps is non-empty
          const safeOpenSteps =
            openSteps.length > 0
              ? openSteps
              : [
                  {
                    id: nextStepId('aud'),
                    kind: 'playAudio' as const,
                    lineNumber: firstBranch.lineNumber,
                    avayaCommand: 'SCHEDULE_OPEN',
                    label: 'Geoeffnet (Standard-Einstieg)',
                    target: 'Begruessung_Offen',
                    targetSlug: 'Begruessung_Offen',
                    ttsText: 'Willkommen innerhalb der Geschaeftszeiten.',
                    isTerminal: false,
                  },
                ];

          steps.push(...prep, {
            id: nextStepId('sg'),
            kind: 'evaluateScheduleGroup',
            lineNumber: firstBranch.lineNumber,
            avayaCommand: 'TIME / DAY OF WEEK / HOLIDAY',
            label: `Schedule Group: ${sgName}`,
            target: sgName,
            targetSlug: sgName,
            openSteps: safeOpenSteps,
            closedSteps,
            holidaySteps,
            isTerminal: false,
          });
          continue;
        }

        // Standard Decision (supports nested ELSE IF chains!)
        const buildNestedDecision = (
          branchIdx: number,
          finalNoSteps: MigrationStep[]
        ): MigrationStep => {
          const br = branches[branchIdx];
          const isEmerg = EMERGENCY_COND_RE.test(br.condition);
          if (isEmerg) {
            warnings.push({
              code: 'EMERGENCY_GROUP_REQUIRED',
              severity: 'warning',
              message: `Notfall-/Night-Service-Logik in Zeile ${br.lineNumber}: In Genesys Cloud über zentrale Emergency Group oder Data Table steuern.`,
              lineNumber: br.lineNumber,
            });
          }

          const compiled = compileOclConditionToArchitectExpr(
            br.condition,
            registry,
            taskVars,
            activeDigitsVarRef.name
          );
          if (compiled.isFallbackFlag) fallbackExpressionCount += 1;
          else realExpressionCount += 1;

          const yesSteps = parseBlockLines(br.lines, taskVars, activeDigitsVarRef);
          const noSteps =
            branchIdx + 1 < branches.length
              ? [buildNestedDecision(branchIdx + 1, finalNoSteps)]
              : finalNoSteps;

          return {
            id: nextStepId('dec'),
            kind: 'decision',
            lineNumber: br.lineNumber,
            avayaCommand: isEmerg ? 'EMERGENCY / NIGHT SERVICE' : 'IF ... THEN',
            label: isEmerg
              ? 'Emergency Group Check'
              : `Check ${br.condition.slice(0, 48)}`,
            conditionLabel: isEmerg ? 'Emergency_Override' : br.condition.slice(0, 48),
            rawCondition: br.condition,
            expression: compiled.expression,
            isEmergencyCheck: isEmerg,
            isFallbackFlag: compiled.isFallbackFlag,
            yesSteps,
            noSteps,
            isTerminal: false,
          };
        };

        let explicitNoSteps = parseBlockLines(elseLines, taskVars, activeDigitsVarRef);

        // Exclusive Guard / Blacklist / Terminal-YES Branching:
        // If YES terminates OR is a blacklist/busy/error guard without ELSE, terminate YES cleanly
        // and move ALL remaining continuation lines exclusively into the NO branch so YES never falls through!
        const provisionalDecision = buildNestedDecision(0, explicitNoSteps);
        const isGuardCond = isGuardOrBlacklistCondition(firstBranch.condition);
        if (
          isGuardCond &&
          (provisionalDecision.yesSteps || []).length > 0 &&
          !isStepListTerminal(provisionalDecision.yesSteps || [])
        ) {
          provisionalDecision.yesSteps!.push({
            id: nextStepId('disc'),
            kind: 'disconnect',
            lineNumber: firstBranch.lineNumber,
            avayaCommand: 'GUARD_TERMINAL_EXIT',
            label: 'Disconnect (Sperr-/Fehlerpfad)',
            target: 'Guard_Exit',
            yamlComment:
              'HINWEIS: Positiver Sperr-/Blacklist-Pfad eindeutig terminal abgeschlossen, damit der normale Hauptpfad nicht weiterlaeuft.',
            isTerminal: true,
          });
        }
        if (
          explicitNoSteps.length === 0 &&
          idx < blockLines.length &&
          (isStepListTerminal(provisionalDecision.yesSteps || []) || isGuardCond)
        ) {
          explicitNoSteps = parseBlockLines(blockLines.slice(idx), taskVars, activeDigitsVarRef);
          idx = blockLines.length;
          let cursor = provisionalDecision;
          while (
            cursor.noSteps &&
            cursor.noSteps.length === 1 &&
            cursor.noSteps[0].kind === 'decision' &&
            (cursor.noSteps[0].noSteps || []).length === 0
          ) {
            cursor = cursor.noSteps[0];
          }
          cursor.noSteps = explicitNoSteps;
        }

        // If prep ended with a callDataAction (e.g. Queue Observations), nest the decision inside its successSteps!
        if (prep.length > 0 && prep[prep.length - 1].kind === 'callDataAction') {
          const daStep = prep[prep.length - 1];
          daStep.successSteps = [provisionalDecision];
          steps.push(...prep);
        } else {
          steps.push(...prep, provisionalDecision);
        }
        continue;
      }

      // B. Multi-line WHERE <var> EQUALS ... VALUE "x": ... DEFAULT: ... END WHERE
      const whereExprRaw = isWhereHeader(text);
      if (whereExprRaw !== null) {
        const caseBlocks: Array<{ value: string; lines: SourceLine[] }> = [];
        let defaultLines: SourceLine[] = [];
        let activeCase: { value: string; lines: SourceLine[] } | null = null;
        let inDefault = false;
        let depth = 1;
        let j = idx + 1;

        while (j < blockLines.length && depth > 0) {
          const cur = blockLines[j];
          if (isWhereHeader(cur.text) !== null) {
            depth += 1;
            if (inDefault) defaultLines.push(cur);
            else if (activeCase) activeCase.lines.push(cur);
          } else if (isEndWhereLine(cur.text)) {
            depth -= 1;
            if (depth > 0) {
              if (inDefault) defaultLines.push(cur);
              else if (activeCase) activeCase.lines.push(cur);
            }
          } else if (depth === 1 && /^VALUE\s+(.+?)\s*:(.*)$/i.test(cur.text)) {
            const vm = cur.text.match(/^VALUE\s+(.+?)\s*:(.*)$/i)!;
            const rawVal = vm[1].trim().replace(/^["']|["']$/g, '');
            const inlineTail = (vm[2] || '').trim();
            inDefault = false;
            activeCase = { value: rawVal, lines: [] };
            if (inlineTail) activeCase.lines.push({ lineNumber: cur.lineNumber, text: inlineTail });
            caseBlocks.push(activeCase);
          } else if (depth === 1 && /^DEFAULT\s*:(.*)$/i.test(cur.text)) {
            const dm = cur.text.match(/^DEFAULT\s*:(.*)$/i)!;
            const inlineTail = (dm[1] || '').trim();
            inDefault = true;
            activeCase = null;
            if (inlineTail) defaultLines.push({ lineNumber: cur.lineNumber, text: inlineTail });
          } else {
            if (inDefault) defaultLines.push(cur);
            else if (activeCase) activeCase.lines.push(cur);
          }
          j += 1;
        }

        idx = j;

        const isLvWhere = isLocalVarIdentifier(whereExprRaw);
        const whereVarDecl =
          isLvWhere || taskVars.has(toCleanGraphSlug(whereExprRaw).toLowerCase())
            ? registry.ensureTaskVar(taskVars, whereExprRaw, 'string', '')
            : isCallVarIdentifier(whereExprRaw) || isGlobalVarIdentifier(whereExprRaw)
            ? registry.ensureFlowVar(whereExprRaw, 'string', '', isCallVarIdentifier(whereExprRaw))
            : registry.ensureTaskVar(taskVars, whereExprRaw, 'string', '');

        const cases = caseBlocks.map((cb) => ({
          value: cb.value,
          label: `Value_${toCleanGraphSlug(cb.value, 'Case')}`,
          steps: parseBlockLines(cb.lines, taskVars, activeDigitsVarRef),
        }));
        const defaultSteps = parseBlockLines(defaultLines, taskVars, activeDigitsVarRef);

        const switchStep: MigrationStep = {
          id: nextStepId('sw'),
          kind: 'switch',
          lineNumber,
          avayaCommand: 'WHERE ... EQUALS',
          label: `Switch ${whereVarDecl.refName}`,
          target: whereVarDecl.name,
          variableName: whereVarDecl.name,
          variableRef: whereVarDecl.refName,
          expression: whereVarDecl.refName,
          cases,
          defaultSteps:
            defaultSteps.length > 0
              ? defaultSteps
              : [makeFallbackJumpStep(lineNumber, `Switch Default ${whereVarDecl.name}`)],
          isTerminal: false,
        };

        // If the immediately preceding step is collectInput collecting this variable, wire Switch into collectInput.successSteps!
        const prevStep = steps[steps.length - 1];
        if (
          prevStep &&
          prevStep.kind === 'collectInput' &&
          (prevStep.successSteps || []).length === 0
        ) {
          prevStep.successSteps = [switchStep];
        } else {
          steps.push(switchStep);
        }
        continue;
      }

      // C. Single-line inline IF ... THEN ... [ELSE ...]
      const clauses = splitInlineIfThenElseClauses(text);
      const hasInlineIf = clauses.some(
        (c) => c.kind === 'if-then' || c.kind === 'else-if-then'
      );

      if (hasInlineIf) {
        idx += 1;
        const ifClause = clauses.find((c) => c.kind === 'if-then');
        const elseIfClauses = clauses.filter((c) => c.kind === 'else-if-then');
        const elseClause = clauses.find((c) => c.kind === 'else');

        const parseInlineActionList = (actionStr?: string): MigrationStep[] => {
          if (!actionStr) return [];
          const out: MigrationStep[] = [];
          for (const s of splitOclStatementsOutsideQuotes(actionStr)) {
            out.push(...translateSingleStatement(s, lineNumber, taskVars, activeDigitsVarRef));
          }
          return out;
        };

        if (ifClause) {
          const cond = (ifClause.condition || '').trim();
          const prep = emitConditionPrerequisites(cond, lineNumber, taskVars);
          const thenSteps = parseInlineActionList(ifClause.action);

          if (SCHEDULE_COND_RE.test(cond)) {
            const sgName = `${toCleanGraphSlug(node.scriptNumber || 'Default')}_ScheduleGroup`;
            const elseSteps = parseInlineActionList(elseClause?.action);
            const isHol =
              HOLIDAY_ONLY_COND_RE.test(cond) &&
              !/\b(?:DAY\s+OF\s+WEEK|TIME\s+OF\s+DAY)\b/i.test(cond);
            steps.push(...prep, {
              id: nextStepId('sg'),
              kind: 'evaluateScheduleGroup',
              lineNumber,
              avayaCommand: 'TIME / DAY OF WEEK / HOLIDAY',
              label: `Schedule Group: ${sgName}`,
              target: sgName,
              targetSlug: sgName,
              openSteps: isHol
                ? elseSteps.length > 0
                  ? elseSteps
                  : makeClosedDisconnectSteps(lineNumber, 'Offen')
                : thenSteps,
              closedSteps: isHol
                ? makeClosedDisconnectSteps(lineNumber, 'Geschlossen')
                : elseSteps.length > 0
                ? elseSteps
                : makeClosedDisconnectSteps(lineNumber, 'Geschlossen'),
              holidaySteps: isHol
                ? thenSteps
                : makeClosedDisconnectSteps(lineNumber, 'Feiertag'),
              isTerminal: false,
            });
            continue;
          }

          const isEmerg = EMERGENCY_COND_RE.test(cond);
          if (isEmerg) {
            warnings.push({
              code: 'EMERGENCY_GROUP_REQUIRED',
              severity: 'warning',
              message: `Notfall-/Night-Service-Logik in Zeile ${lineNumber}: In Genesys Cloud über zentrale Emergency Group oder Data Table steuern.`,
              lineNumber,
            });
          }

          const compiled = compileOclConditionToArchitectExpr(
            cond,
            registry,
            taskVars,
            activeDigitsVarRef.name
          );
          if (compiled.isFallbackFlag) fallbackExpressionCount += 1;
          else realExpressionCount += 1;

          let noSteps: MigrationStep[] = parseInlineActionList(elseClause?.action);
          for (let ei = elseIfClauses.length - 1; ei >= 0; ei -= 1) {
            const eic = elseIfClauses[ei];
            const eicCond = (eic.condition || '').trim();
            const eicCompiled = compileOclConditionToArchitectExpr(
              eicCond,
              registry,
              taskVars,
              activeDigitsVarRef.name
            );
            noSteps = [
              {
                id: nextStepId('dec'),
                kind: 'decision',
                lineNumber,
                avayaCommand: 'ELSE IF ... THEN',
                label: `Check ${eicCond.slice(0, 48)}`,
                conditionLabel: eicCond.slice(0, 48),
                rawCondition: eicCond,
                expression: eicCompiled.expression,
                isFallbackFlag: eicCompiled.isFallbackFlag,
                yesSteps: parseInlineActionList(eic.action),
                noSteps,
                isTerminal: false,
              },
            ];
          }

          // If there is no ELSE and remaining lines follow in this block, wire continuation into NO
          // when YES ends, is a guard/blacklist check, or follows collectInput
          const isGuardInline = isGuardOrBlacklistCondition(cond);
          if (isGuardInline && thenSteps.length > 0 && !isStepListTerminal(thenSteps)) {
            thenSteps.push({
              id: nextStepId('disc'),
              kind: 'disconnect',
              lineNumber,
              avayaCommand: 'GUARD_TERMINAL_EXIT',
              label: 'Disconnect (Sperr-/Fehlerpfad)',
              target: 'Guard_Exit',
              yamlComment:
                'HINWEIS: Positiver Sperr-/Blacklist-Pfad eindeutig terminal abgeschlossen.',
              isTerminal: true,
            });
          }
          if (noSteps.length === 0 && idx < blockLines.length) {
            const yesEnds = isStepListTerminal(thenSteps);
            const isDigitsBranch =
              steps.length > 0 &&
              steps[steps.length - 1].kind === 'collectInput' &&
              (steps[steps.length - 1].successSteps || []).length === 0;
            if (yesEnds || isDigitsBranch || isGuardInline) {
              noSteps = parseBlockLines(blockLines.slice(idx), taskVars, activeDigitsVarRef);
              idx = blockLines.length;
            }
          }

          const decisionStep: MigrationStep = {
            id: nextStepId('dec'),
            kind: 'decision',
            lineNumber,
            avayaCommand: isEmerg ? 'EMERGENCY / NIGHT SERVICE' : 'IF ... THEN',
            label: isEmerg ? 'Emergency Group Check' : `Check ${cond.slice(0, 48)}`,
            conditionLabel: isEmerg ? 'Emergency_Override' : cond.slice(0, 48),
            rawCondition: cond,
            expression: compiled.expression,
            isEmergencyCheck: isEmerg,
            isFallbackFlag: compiled.isFallbackFlag,
            yesSteps: thenSteps,
            noSteps,
            isTerminal: false,
          };

          // Attach to preceding collectInput or callDataAction successSteps if immediately following
          const prevStep = steps[steps.length - 1];
          if (
            prevStep &&
            (prevStep.kind === 'collectInput' || prevStep.kind === 'callDataAction') &&
            (prevStep.successSteps || []).length === 0 &&
            prep.length === 0
          ) {
            prevStep.successSteps = [decisionStep];
          } else if (prep.length > 0 && prep[prep.length - 1].kind === 'callDataAction') {
            prep[prep.length - 1].successSteps = [decisionStep];
            steps.push(...prep);
          } else {
            steps.push(...prep, decisionStep);
          }
          continue;
        }
      }

      // D. Plain statement(s) on this line
      idx += 1;
      for (const stmt of splitOclStatementsOutsideQuotes(text)) {
        const translated = translateSingleStatement(stmt, lineNumber, taskVars, activeDigitsVarRef);
        for (const step of translated) {
          // Wire immediate follow-up steps after callDataAction / collectInput into successSteps when appropriate
          const prevStep = steps[steps.length - 1];
          if (
            prevStep &&
            prevStep.kind === 'callDataAction' &&
            (prevStep.successSteps || []).length === 0 &&
            (step.kind === 'decision' ||
              step.kind === 'transferToAcd' ||
              step.kind === 'transferToNumber' ||
              step.kind === 'callTask' ||
              step.kind === 'playAudio' ||
              step.kind === 'disconnect')
          ) {
            prevStep.successSteps = [step];
            // If this step isn't terminal, consume the rest of the current block into successSteps!
            if (!step.isTerminal && idx < blockLines.length) {
              const rest = parseBlockLines(blockLines.slice(idx), taskVars, activeDigitsVarRef);
              prevStep.successSteps.push(...rest);
              idx = blockLines.length;
            }
          } else if (
            prevStep &&
            prevStep.kind === 'collectInput' &&
            (prevStep.successSteps || []).length === 0 &&
            step.kind !== 'collectInput'
          ) {
            prevStep.successSteps = [step];
            if (!step.isTerminal && idx < blockLines.length) {
              const rest = parseBlockLines(blockLines.slice(idx), taskVars, activeDigitsVarRef);
              prevStep.successSteps.push(...rest);
              idx = blockLines.length;
            }
          } else {
            steps.push(step);
          }
        }
      }
    }

    return steps;
  };

  // Build each SECTION into a real MigrationTaskGraph
  const tasks: MigrationTaskGraph[] = [];
  const deadPathCounter = { pruned: 0 };

  for (let sIdx = 0; sIdx < rawSections.length; sIdx += 1) {
    const sec = rawSections[sIdx];
    const taskVars = new Map<string, MigrationVariableDecl>();
    const activeDigitsVarRef = { name: 'collectedDigits' };

    let steps = parseBlockLines(sec.lines, taskVars, activeDigitsVarRef);

    // Supplement from AuditNode edges & ScriptRules for Visio / shorthand scripts with empty raw OCL
    if (sIdx === 0 && steps.length === 0 && rawSections.length === 1) {
      const hasScheduleRule = (mod?.rules || []).some((r) => Boolean(r.schedule || r.holiday));
      const fallbackBody: MigrationStep[] = [];

      for (const rule of mod?.rules || []) {
        if (rule.announcement) {
          const slug = toCleanGraphSlug(rule.announcement, 'Prompt');
          fallbackBody.push({
            id: nextStepId('aud'),
            kind: 'playAudio',
            lineNumber: rule.prio || 0,
            avayaCommand: 'Ansage',
            label: `Play Audio: Prompt.${slug}`,
            target: rule.announcement,
            targetSlug: slug,
            ttsText: `Ansage Prompt.${slug}`,
            isTerminal: false,
          });
        }
        if (rule.choices && rule.choices.length > 0) {
          const digitVar = registry.ensureTaskVar(taskVars, 'collectedDigits', 'string', '');
          fallbackBody.push({
            id: nextStepId('col'),
            kind: 'collectInput',
            lineNumber: rule.prio || 0,
            avayaCommand: 'DTMF / Auswahl',
            label: `Menu Input: ${rule.stepName || 'Auswahl'}`,
            target: rule.stepName || 'Auswahl',
            targetSlug: toCleanGraphSlug(rule.stepName || 'Auswahl', 'Auswahl'),
            inputVarName: digitVar.name,
            inputVarRef: digitVar.refName,
            digitSpec: { mode: 'exact', exact: 1 },
            noEntryTimeoutSec: 5,
            interDigitTimeoutSec: 3,
            noEntryTts: 'Keine Auswahl erkannt.',
            noMatchTts: 'Ungueltige Auswahl.',
            successSteps: [
              {
                id: nextStepId('sw'),
                kind: 'switch',
                lineNumber: rule.prio || 0,
                avayaCommand: 'DTMF Switch',
                label: `Switch ${digitVar.refName}`,
                variableName: digitVar.name,
                variableRef: digitVar.refName,
                expression: digitVar.refName,
                cases: rule.choices.map((c) => ({
                  value: c.choice,
                  label: `Choice_${toCleanGraphSlug(c.choice, 'Opt')}`,
                  steps: handleSubscriptOrExternalCall(
                    c.targetNumber,
                    'DTMF',
                    rule.prio || 0,
                    taskVars,
                    activeDigitsVarRef
                  ),
                })),
                defaultSteps: [makeFallbackJumpStep(rule.prio || 0, 'Menu Default')],
                isTerminal: false,
              },
            ],
            failureSteps: [makeFallbackJumpStep(rule.prio || 0, 'Menu Failure')],
            isTerminal: false,
          });
        }
      }

      for (const edge of node.edges) {
        if (edge.targetType === 'SKILLSET_QUEUE') {
          uniqueSkillsets.add(edge.rawTarget);
          fallbackBody.push({
            id: nextStepId('acd'),
            kind: 'transferToAcd',
            lineNumber: edge.lineNumber,
            avayaCommand: edge.command,
            label: `ACD Queue: ${edge.rawTarget}`,
            target: edge.rawTarget,
            targetSlug: toCleanGraphSlug(edge.rawTarget, 'Default_Queue'),
            isTerminal: true,
          });
        } else if (edge.targetType === 'FLIXCHECK') {
          flixcheckApiCount += 1;
          const statusVar = registry.ensureTaskVar(taskVars, 'flixcheckStatus', 'string', '');
          fallbackBody.push({
            id: nextStepId('da'),
            kind: 'callDataAction',
            lineNumber: edge.lineNumber,
            avayaCommand: edge.command,
            label: `Data Action: FlixCheck (${edge.rawTarget})`,
            target: edge.rawTarget,
            targetSlug: toCleanGraphSlug(edge.rawTarget, 'FlixCheck'),
            dataActionCategory: 'FlixCheck_API',
            dataActionInputs: [{ name: 'callerAni', expr: 'Call.Ani' }],
            dataActionOutputs: [
              {
                field: 'status',
                targetVarName: statusVar.name,
                targetVarRef: statusVar.refName,
                dataType: 'string',
              },
            ],
            successSteps: [],
            failureSteps: [makeFallbackJumpStep(edge.lineNumber, `FlixCheck ${edge.rawTarget}`)],
            timeoutSteps: [makeFallbackJumpStep(edge.lineNumber, `FlixCheck Timeout ${edge.rawTarget}`)],
            isTerminal: false,
          });
        } else if (edge.targetType === 'ORACLE') {
          oracleApiCount += 1;
          const codeVar = registry.ensureTaskVar(taskVars, 'oracleStatusCode', 'string', '');
          fallbackBody.push({
            id: nextStepId('da'),
            kind: 'callDataAction',
            lineNumber: edge.lineNumber,
            avayaCommand: edge.command,
            label: `Data Action: Oracle (${edge.rawTarget})`,
            target: edge.rawTarget,
            targetSlug: toCleanGraphSlug(edge.rawTarget, 'Oracle'),
            dataActionCategory: 'Oracle_Integration',
            dataActionInputs: [{ name: 'callerAni', expr: 'Call.Ani' }],
            dataActionOutputs: [
              {
                field: 'statusCode',
                targetVarName: codeVar.name,
                targetVarRef: codeVar.refName,
                dataType: 'string',
              },
            ],
            successSteps: [],
            failureSteps: [makeFallbackJumpStep(edge.lineNumber, `Oracle ${edge.rawTarget}`)],
            timeoutSteps: [makeFallbackJumpStep(edge.lineNumber, `Oracle Timeout ${edge.rawTarget}`)],
            isTerminal: false,
          });
        } else if (edge.targetType === 'CDN_NUMBER') {
          const norm = normalizeTransferTarget(edge.rawTarget, edge.lineNumber, ctx.knownKeyLookup, node.scriptKey);
          normalizedTargets.push(norm);
          if (norm.kind === 'external-e164') {
            fallbackBody.push({
              id: nextStepId('trn'),
              kind: 'transferToNumber',
              lineNumber: edge.lineNumber,
              avayaCommand: edge.command,
              label: `Transfer to Number: ${norm.normalizedTarget}`,
              target: norm.normalizedTarget,
              originalTransferTarget: norm.originalTarget,
              normalizedE164: norm.normalizedTarget,
              normalizationNote: norm.note,
              isTerminal: true,
            });
          } else {
            fallbackBody.push({
              id: nextStepId('acd'),
              kind: 'transferToAcd',
              lineNumber: edge.lineNumber,
              avayaCommand: edge.command,
              label: `ACD Queue (CDN): ${norm.normalizedTarget}`,
              target: norm.normalizedTarget,
              targetSlug: norm.normalizedTarget,
              originalTransferTarget: norm.originalTarget,
              normalizationNote: norm.note,
              isTerminal: true,
            });
          }
        } else if (edge.targetType === 'LOCAL_SCRIPT' || edge.targetType === 'MISSING_OR_BROKEN') {
          fallbackBody.push(
            ...handleSubscriptOrExternalCall(
              edge.rawTarget,
              edge.command,
              edge.lineNumber,
              taskVars,
              activeDigitsVarRef
            )
          );
        }
      }

      if (node.hasTermination && !isStepListTerminal(fallbackBody)) {
        fallbackBody.push({
          id: nextStepId('disc'),
          kind: 'disconnect',
          lineNumber: 0,
          avayaCommand: node.terminationCommands[0] || 'DISCONNECT',
          label: 'Disconnect Call',
          isTerminal: true,
        });
      }

      if (hasScheduleRule) {
        const sgName = `${toCleanGraphSlug(node.scriptNumber || 'Default')}_ScheduleGroup`;
        steps = [
          {
            id: nextStepId('sg'),
            kind: 'evaluateScheduleGroup',
            lineNumber: 0,
            avayaCommand: 'Zeitplan / Feiertag',
            label: `Schedule Group: ${sgName}`,
            target: sgName,
            targetSlug: sgName,
            openSteps:
              fallbackBody.length > 0
                ? fallbackBody
                : [
                    {
                      id: nextStepId('disc'),
                      kind: 'disconnect',
                      lineNumber: 0,
                      avayaCommand: 'DISCONNECT',
                      label: 'Disconnect (Open Default)',
                      isTerminal: true,
                    },
                  ],
            closedSteps: makeClosedDisconnectSteps(0, 'Geschlossen'),
            holidaySteps: makeClosedDisconnectSteps(0, 'Feiertag'),
            isTerminal: false,
          },
        ];
      } else {
        steps = fallbackBody;
      }
    }

    // Tag all steps in this section with sectionHint for v1.1 sourceTrace
    const tagSectionHint = (list: MigrationStep[], secHint: string) => {
      for (const st of list) {
        if (!st.sectionHint) st.sectionHint = secHint;
        if (st.yesSteps) tagSectionHint(st.yesSteps, secHint);
        if (st.noSteps) tagSectionHint(st.noSteps, secHint);
        if (st.openSteps) tagSectionHint(st.openSteps, secHint);
        if (st.closedSteps) tagSectionHint(st.closedSteps, secHint);
        if (st.holidaySteps) tagSectionHint(st.holidaySteps, secHint);
        if (st.successSteps) tagSectionHint(st.successSteps, secHint);
        if (st.failureSteps) tagSectionHint(st.failureSteps, secHint);
        if (st.timeoutSteps) tagSectionHint(st.timeoutSteps, secHint);
        if (st.foundSteps) tagSectionHint(st.foundSteps, secHint);
        if (st.notFoundSteps) tagSectionHint(st.notFoundSteps, secHint);
        if (st.bodySteps) tagSectionHint(st.bodySteps, secHint);
        if (st.defaultSteps) tagSectionHint(st.defaultSteps, secHint);
        if (st.cases) st.cases.forEach((c) => tagSectionHint(c.steps, secHint));
      }
    };
    tagSectionHint(steps, sec.rawName);

    // Prune dead paths after any terminal action in this section
    steps = pruneDeadPaths(steps, deadPathCounter);

    // Protected-Section Fall-Through Guard:
    // NEVER unconditionally fall through into a protected Busy/Error/Abort section (e.g. Section_BESETZT)!
    if (sIdx + 1 < rawSections.length && !isStepListTerminal(steps)) {
      const nextSec = rawSections[sIdx + 1];
      if (!isProtectedHandlerSectionName(nextSec.rawName)) {
        steps.push({
          id: nextStepId('jmp'),
          kind: 'jumpToReusableTask',
          lineNumber: nextSec.startLine,
          avayaCommand: 'SECTION_FALLTHROUGH',
          label: `Continue to ${nextSec.rawName}`,
          target: nextSec.rawName,
          targetSlug: nextSec.refId,
          targetTaskRefId: nextSec.refId,
          sectionHint: sec.rawName,
          isTerminal: true,
        });
      }
    }

    // Ensure every task has at least one valid step
    if (steps.length === 0) {
      steps.push({
        id: nextStepId('disc'),
        kind: 'disconnect',
        lineNumber: sec.startLine,
        avayaCommand: 'END_OF_TASK',
        label: `Disconnect (${sec.rawName})`,
        sectionHint: sec.rawName,
        isTerminal: true,
      });
    }

    tasks.push({
      refId: sec.refId,
      name: sec.refId,
      kind: sec.isEntry ? 'entry' : 'section',
      originalTarget: sec.rawName,
      isProtectedHandler: isProtectedHandlerSectionName(sec.rawName),
      taskVariables: Array.from(taskVars.values()).sort((a, b) => a.name.localeCompare(b.name)),
      steps,
    });
  }

  // Add Fallback_Error_Task if any error/failure/timeout branch jumps to it
  if (needsFallbackErrorTask) {
    tasks.push({
      refId: 'Fallback_Error_Task',
      name: 'Fallback_Error_Task',
      kind: 'fallback',
      originalTarget: 'System Fallback',
      isProtectedHandler: true,
      taskVariables: [],
      steps: [
        {
          id: nextStepId('aud'),
          kind: 'playAudio',
          lineNumber: 0,
          avayaCommand: 'FALLBACK_AUDIO',
          label: 'Fallback Hinweis-Ansage',
          target: 'Technischer_Hinweis',
          targetSlug: 'Technischer_Hinweis',
          ttsText: 'Entschuldigung, aktuell liegt eine technische Stoerung vor. Bitte versuchen Sie es spaeter erneut.',
          isTerminal: false,
        },
        {
          id: nextStepId('disc'),
          kind: 'disconnect',
          lineNumber: 0,
          avayaCommand: 'FALLBACK_DISCONNECT',
          label: 'Disconnect (Fallback Error)',
          target: 'Fallback_Error',
          isTerminal: true,
        },
      ],
    });
  }

  // ============================================================================
  // GRAPH-REDUKTIONS-PASS: Selektives Section-Inlining (1x genutzt -> inline Branch;
  // >= 2x genutzt -> Reusable Task; unreferenzierte tote Sections entfernen)
  // ============================================================================
  let inlinedSectionCount = 0;

  const countJumpRefs = (taskList: MigrationTaskGraph[]): Map<string, number> => {
    const counts = new Map<string, number>();
    const visit = (list: MigrationStep[]) => {
      for (const st of list) {
        if (st.kind === 'jumpToReusableTask' && st.targetTaskRefId) {
          counts.set(st.targetTaskRefId, (counts.get(st.targetTaskRefId) || 0) + 1);
        }
        if (st.yesSteps) visit(st.yesSteps);
        if (st.noSteps) visit(st.noSteps);
        if (st.openSteps) visit(st.openSteps);
        if (st.closedSteps) visit(st.closedSteps);
        if (st.holidaySteps) visit(st.holidaySteps);
        if (st.successSteps) visit(st.successSteps);
        if (st.failureSteps) visit(st.failureSteps);
        if (st.timeoutSteps) visit(st.timeoutSteps);
        if (st.foundSteps) visit(st.foundSteps);
        if (st.notFoundSteps) visit(st.notFoundSteps);
        if (st.bodySteps) visit(st.bodySteps);
        if (st.defaultSteps) visit(st.defaultSteps);
        if (st.cases) st.cases.forEach((c) => visit(c.steps));
      }
    };
    taskList.forEach((t) => visit(t.steps));
    return counts;
  };

  const hasCycleToSelf = (startRefId: string, byRef: Map<string, MigrationTaskGraph>): boolean => {
    const visited = new Set<string>();
    const dfs = (cur: string): boolean => {
      const t = byRef.get(cur);
      if (!t) return false;
      const targets: string[] = [];
      const collect = (list: MigrationStep[]) => {
        for (const st of list) {
          if (st.kind === 'jumpToReusableTask' && st.targetTaskRefId) targets.push(st.targetTaskRefId);
          if (st.yesSteps) collect(st.yesSteps);
          if (st.noSteps) collect(st.noSteps);
          if (st.openSteps) collect(st.openSteps);
          if (st.closedSteps) collect(st.closedSteps);
          if (st.holidaySteps) collect(st.holidaySteps);
          if (st.successSteps) collect(st.successSteps);
          if (st.failureSteps) collect(st.failureSteps);
          if (st.timeoutSteps) collect(st.timeoutSteps);
          if (st.foundSteps) collect(st.foundSteps);
          if (st.notFoundSteps) collect(st.notFoundSteps);
          if (st.bodySteps) collect(st.bodySteps);
          if (st.defaultSteps) collect(st.defaultSteps);
          if (st.cases) st.cases.forEach((c) => collect(c.steps));
        }
      };
      collect(t.steps);
      for (const nxt of targets) {
        if (nxt === startRefId) return true;
        if (!visited.has(nxt)) {
          visited.add(nxt);
          if (dfs(nxt)) return true;
        }
      }
      return false;
    };
    return dfs(startRefId);
  };

  const cloneInlinedSteps = (list: MigrationStep[], prefix: string): MigrationStep[] =>
    list.map((st) => ({
      ...st,
      id: `${prefix}_${st.id}`,
      yesSteps: st.yesSteps ? cloneInlinedSteps(st.yesSteps, prefix) : undefined,
      noSteps: st.noSteps ? cloneInlinedSteps(st.noSteps, prefix) : undefined,
      openSteps: st.openSteps ? cloneInlinedSteps(st.openSteps, prefix) : undefined,
      closedSteps: st.closedSteps ? cloneInlinedSteps(st.closedSteps, prefix) : undefined,
      holidaySteps: st.holidaySteps ? cloneInlinedSteps(st.holidaySteps, prefix) : undefined,
      successSteps: st.successSteps ? cloneInlinedSteps(st.successSteps, prefix) : undefined,
      failureSteps: st.failureSteps ? cloneInlinedSteps(st.failureSteps, prefix) : undefined,
      timeoutSteps: st.timeoutSteps ? cloneInlinedSteps(st.timeoutSteps, prefix) : undefined,
      foundSteps: st.foundSteps ? cloneInlinedSteps(st.foundSteps, prefix) : undefined,
      notFoundSteps: st.notFoundSteps ? cloneInlinedSteps(st.notFoundSteps, prefix) : undefined,
      bodySteps: st.bodySteps ? cloneInlinedSteps(st.bodySteps, prefix) : undefined,
      defaultSteps: st.defaultSteps ? cloneInlinedSteps(st.defaultSteps, prefix) : undefined,
      cases: st.cases
        ? st.cases.map((c) => ({ ...c, steps: cloneInlinedSteps(c.steps, prefix) }))
        : undefined,
    }));

  // Iteratively & transitively inline single-use non-cyclic Avaya SECTION tasks directly into caller branches
  for (let pass = 0; pass < 6; pass += 1) {
    const byRef = new Map<string, MigrationTaskGraph>(tasks.map((t) => [t.refId, t]));
    const refCounts = countJumpRefs(tasks);
    const inlineableRefs = new Set<string>();

    for (const t of tasks) {
      if (t.kind !== 'section') continue;
      const count = refCounts.get(t.refId) || 0;
      if (count === 1 && !hasCycleToSelf(t.refId, byRef)) {
        inlineableRefs.add(t.refId);
      }
    }

    if (inlineableRefs.size === 0) break;

    let didInline = false;
    const replaceJumps = (
      list: MigrationStep[],
      hostTask: MigrationTaskGraph,
      activeInlineChain: Set<string>
    ): MigrationStep[] => {
      const out: MigrationStep[] = [];
      for (const st of list) {
        if (
          st.kind === 'jumpToReusableTask' &&
          st.targetTaskRefId &&
          inlineableRefs.has(st.targetTaskRefId) &&
          !activeInlineChain.has(st.targetTaskRefId)
        ) {
          const targetTask = byRef.get(st.targetTaskRefId);
          if (targetTask) {
            // Merge task-local variables cleanly into host task
            const hostVarKeys = new Set(hostTask.taskVariables.map((v) => v.name.toLowerCase()));
            for (const tv of targetTask.taskVariables) {
              if (!hostVarKeys.has(tv.name.toLowerCase())) {
                hostVarKeys.add(tv.name.toLowerCase());
                hostTask.taskVariables.push({ ...tv });
              }
            }
            const nextChain = new Set<string>(activeInlineChain);
            nextChain.add(st.targetTaskRefId);
            // Recursively inline chained single-use sections inside the cloned body so no dangling jump survives
            const cloned = replaceJumps(
              cloneInlinedSteps(targetTask.steps, nextStepId('inl')),
              hostTask,
              nextChain
            );
            out.push(...cloned);
            inlinedSectionCount += 1;
            didInline = true;
            continue;
          }
        }
        const copy: MigrationStep = { ...st };
        if (copy.yesSteps) copy.yesSteps = replaceJumps(copy.yesSteps, hostTask, activeInlineChain);
        if (copy.noSteps) copy.noSteps = replaceJumps(copy.noSteps, hostTask, activeInlineChain);
        if (copy.openSteps) copy.openSteps = replaceJumps(copy.openSteps, hostTask, activeInlineChain);
        if (copy.closedSteps) copy.closedSteps = replaceJumps(copy.closedSteps, hostTask, activeInlineChain);
        if (copy.holidaySteps) copy.holidaySteps = replaceJumps(copy.holidaySteps, hostTask, activeInlineChain);
        if (copy.successSteps) copy.successSteps = replaceJumps(copy.successSteps, hostTask, activeInlineChain);
        if (copy.failureSteps) copy.failureSteps = replaceJumps(copy.failureSteps, hostTask, activeInlineChain);
        if (copy.timeoutSteps) copy.timeoutSteps = replaceJumps(copy.timeoutSteps, hostTask, activeInlineChain);
        if (copy.foundSteps) copy.foundSteps = replaceJumps(copy.foundSteps, hostTask, activeInlineChain);
        if (copy.notFoundSteps) copy.notFoundSteps = replaceJumps(copy.notFoundSteps, hostTask, activeInlineChain);
        if (copy.bodySteps) copy.bodySteps = replaceJumps(copy.bodySteps, hostTask, activeInlineChain);
        if (copy.defaultSteps) copy.defaultSteps = replaceJumps(copy.defaultSteps, hostTask, activeInlineChain);
        if (copy.cases) {
          copy.cases = copy.cases.map((c) => ({
            ...c,
            steps: replaceJumps(c.steps, hostTask, activeInlineChain),
          }));
        }
        out.push(copy);
      }
      return out;
    };

    for (const t of tasks) {
      if (inlineableRefs.has(t.refId)) continue;
      t.steps = pruneDeadPaths(replaceJumps(t.steps, t, new Set<string>([t.refId])), deadPathCounter);
      t.taskVariables.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (!didInline) break;

    // Reference-safe deletion: recount across surviving non-inlineable tasks and ONLY remove sections with 0 remaining refs
    const survivingTasks = tasks.filter((t) => !inlineableRefs.has(t.refId));
    const remainingRefs = countJumpRefs(survivingTasks);
    for (let i = tasks.length - 1; i >= 0; i -= 1) {
      const refId = tasks[i].refId;
      if (inlineableRefs.has(refId) && (remainingRefs.get(refId) || 0) === 0) {
        tasks.splice(i, 1);
      }
    }
  }

  // BFS reachability GC from entry task: drop unreachable orphan section tasks & mutually-referencing dead islands
  const rootEntryRefId = tasks.find((t) => t.kind === 'entry')?.refId || tasks[0]?.refId || 'Main_Task';
  const reachableSectionRefs = new Set<string>([rootEntryRefId]);
  const bfsQueue: string[] = [rootEntryRefId];
  const tasksByRefMap = new Map<string, MigrationTaskGraph>(tasks.map((t) => [t.refId, t]));
  const collectTaskRefs = (list: MigrationStep[], outRefs: Set<string>) => {
    for (const st of list) {
      if ((st.kind === 'jumpToReusableTask' || st.kind === 'callTask') && st.targetTaskRefId) {
        outRefs.add(st.targetTaskRefId);
      }
      if (st.yesSteps) collectTaskRefs(st.yesSteps, outRefs);
      if (st.noSteps) collectTaskRefs(st.noSteps, outRefs);
      if (st.openSteps) collectTaskRefs(st.openSteps, outRefs);
      if (st.closedSteps) collectTaskRefs(st.closedSteps, outRefs);
      if (st.holidaySteps) collectTaskRefs(st.holidaySteps, outRefs);
      if (st.successSteps) collectTaskRefs(st.successSteps, outRefs);
      if (st.failureSteps) collectTaskRefs(st.failureSteps, outRefs);
      if (st.timeoutSteps) collectTaskRefs(st.timeoutSteps, outRefs);
      if (st.foundSteps) collectTaskRefs(st.foundSteps, outRefs);
      if (st.notFoundSteps) collectTaskRefs(st.notFoundSteps, outRefs);
      if (st.bodySteps) collectTaskRefs(st.bodySteps, outRefs);
      if (st.defaultSteps) collectTaskRefs(st.defaultSteps, outRefs);
      if (st.cases) st.cases.forEach((c) => collectTaskRefs(c.steps, outRefs));
    }
  };
  while (bfsQueue.length > 0) {
    const curRef = bfsQueue.shift()!;
    const curTask = tasksByRefMap.get(curRef);
    if (!curTask) continue;
    const outs = new Set<string>();
    collectTaskRefs(curTask.steps, outs);
    for (const nxt of outs) {
      if (!reachableSectionRefs.has(nxt)) {
        reachableSectionRefs.add(nxt);
        bfsQueue.push(nxt);
      }
    }
  }
  const prunedUnreachableTasks: PrunedUnreachableTaskRecord[] = [];
  for (let i = tasks.length - 1; i >= 0; i -= 1) {
    const t = tasks[i];
    if ((t.kind === 'section' || t.kind === 'fallback') && !reachableSectionRefs.has(t.refId)) {
      prunedUnreachableTasks.push({
        refId: t.refId,
        originalTarget: t.originalTarget || t.name,
        reason: 'Nicht von Main_Task aus erreichbar nach Section-Inlining und Dead-Path-Bereinigung',
      });
      tasks.splice(i, 1);
    }
  }

  // ============================================================================
  // VARIABLE-PROVENANCE-PASS: Stellt sicher, dass jede geprüfte Variable vor
  // decision / switch eine nachvollziehbare Quelle hat (+ # OFFENE MIGRATIONSFRAGE)
  // ============================================================================
  let synthesizedSourceCount = 0;

  const extractScopedVarsFromExpr = (
    expr: string
  ): Array<{ scope: 'flow' | 'task'; name: string; refName: string }> => {
    const found: Array<{ scope: 'flow' | 'task'; name: string; refName: string }> = [];
    const seen = new Set<string>();
    const matches = (expr || '').matchAll(/\b(Flow|Task)\.([A-Za-z_][A-Za-z0-9_]*)\b/g);
    for (const m of matches) {
      const scope = m[1].toLowerCase() === 'task' ? 'task' : 'flow';
      const name = m[2];
      const key = `${scope}:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ scope, name, refName: `${scope === 'task' ? 'Task' : 'Flow'}.${name}` });
    }
    return found;
  };

  const compatibilityStubMode = Boolean(ctx.compatibilityStubMode);

  const appendComment = (target: MigrationStep, line: string) => {
    const clean = line.trim();
    if (!clean) return;
    const existing = (target.yamlComment || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!existing.includes(clean)) {
      existing.push(clean);
      target.yamlComment = existing.join('\n');
    }
  };

  const appendAnnotation = (
    target: MigrationStep,
    findingCode: StepProvenanceFinding['code'],
    prefix: StepMigrationAnnotation['prefix'],
    lines: string[],
    mode: 'strict' | 'stub'
  ) => {
    const cleaned = lines.map((l) => l.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    target.migrationAnnotations = target.migrationAnnotations || [];
    const dup = target.migrationAnnotations.some(
      (a) =>
        a.findingCode === findingCode &&
        a.prefix === prefix &&
        a.lines.join('\n') === cleaned.join('\n')
    );
    if (!dup) {
      target.migrationAnnotations.push({ findingCode, prefix, lines: cleaned, mode });
    }
  };

  const appendFinding = (target: MigrationStep, finding: StepProvenanceFinding) => {
    if (!target.provenanceFinding) {
      target.provenanceFinding = finding;
      return;
    }
    if (
      target.provenanceFinding.code === finding.code &&
      target.provenanceFinding.variableName === finding.variableName &&
      target.provenanceFinding.message === finding.message
    ) {
      return;
    }
    target.additionalFindings = target.additionalFindings || [];
    const exists = target.additionalFindings.some(
      (f) =>
        f.code === finding.code &&
        f.variableName === finding.variableName &&
        f.message === finding.message
    );
    if (!exists) {
      target.additionalFindings.push(finding);
    }
  };

  const ensureProvenanceOnList = (
    steps: MigrationStep[],
    inheritedWritten: Set<string>,
    hostTask: MigrationTaskGraph
  ): MigrationStep[] => {
    const written = new Set<string>(inheritedWritten);
    const out: MigrationStep[] = [];

    const markWritten = (name?: string) => {
      if (!name) return;
      written.add(name.replace(/^(?:Flow|Task)\./i, '').toLowerCase());
    };

    for (const st of steps) {
      const copy: MigrationStep = {
        ...st,
        additionalFindings: st.additionalFindings ? [...st.additionalFindings] : undefined,
        migrationAnnotations: st.migrationAnnotations
          ? st.migrationAnnotations.map((a) => ({ ...a, lines: [...a.lines] }))
          : undefined,
      };

      // Check unread variables in decision / switch BEFORE pushing the step
      if (copy.kind === 'decision' && copy.expression && !copy.isEmergencyCheck) {
        const refs = extractScopedVarsFromExpr(copy.expression);
        for (const r of refs) {
          const lower = r.name.toLowerCase();
          if (written.has(lower)) continue;
          if (
            lower === 'estimatedwaittime' ||
            lower === 'queueagentsonline' ||
            lower === 'emergencyoverride' ||
            lower === 'avayaoriginscript' ||
            lower === 'startdatetimeutc'
          ) {
            continue;
          }

          if (compatibilityStubMode) {
            // Optional opt-in Compatibility / Stub Mode: synthesize lookup or getParticipantData explicitly marked as stub
            if (/blacklist|vip/i.test(r.name)) {
              synthesizedSourceCount += 1;
              const tableName = `${toCleanGraphSlug(r.name.replace(/_flag|_cv/gi, ''), 'Blacklist')}_Table`;
              const isBool = registry.flowVars.get(lower)?.dataType === 'boolean';
              out.push({
                id: nextStepId('dt'),
                kind: 'callDataTableLookup',
                lineNumber: copy.lineNumber,
                avayaCommand: 'DATA_PROVENANCE_LOOKUP',
                label: `Data Table Lookup: ${tableName}`,
                target: tableName,
                targetSlug: tableName,
                dataTableKey: 'Call.Ani',
                sectionHint: copy.sectionHint,
                dataActionOutputs: [
                  {
                    field: 'isListed',
                    targetVarName: r.name,
                    targetVarRef: r.refName,
                    dataType: isBool ? 'boolean' : 'string',
                  },
                ],
                yamlComment: `KOMPATIBILITAETS-STUB (OPT-IN): Quelle fuer "${r.name}" im Avaya-Skript nicht eindeutig enthalten — Data Table Lookup (${tableName} ueber Call.Ani) als Annahme ergaenzt, bitte Tabellenname/Schluessel in Genesys pruefen.`,
                provenanceFinding: {
                  severity: 'WARN',
                  code: 'VAR_USED_BEFORE_SET',
                  variableName: r.name,
                  message: `Variable "${r.name}" wird in Zeile ${copy.lineNumber} geprüft, Quelle im Avaya-Skript nicht eindeutig gefunden (Kompatibilitäts-Stub: Data Table Lookup "${tableName}" als Zielannahme ergänzt).`,
                },
                foundSteps: [
                  {
                    id: nextStepId('upd'),
                    kind: 'updateData',
                    lineNumber: copy.lineNumber,
                    avayaCommand: 'SET_LOOKUP_MATCH',
                    label: `Set ${r.refName} (Match)`,
                    variableName: r.name,
                    variableRef: r.refName,
                    variableDataType: isBool ? 'boolean' : 'string',
                    literalValue: isBool ? true : '1',
                    sectionHint: copy.sectionHint,
                    isTerminal: false,
                  },
                ],
                notFoundSteps: [
                  {
                    id: nextStepId('upd'),
                    kind: 'updateData',
                    lineNumber: copy.lineNumber,
                    avayaCommand: 'SET_LOOKUP_NOMATCH',
                    label: `Set ${r.refName} (Not Found)`,
                    variableName: r.name,
                    variableRef: r.refName,
                    variableDataType: isBool ? 'boolean' : 'string',
                    literalValue: isBool ? false : '0',
                    sectionHint: copy.sectionHint,
                    isTerminal: false,
                  },
                ],
                isTerminal: false,
              });
              markWritten(r.name);
            } else {
              synthesizedSourceCount += 1;
              out.push({
                id: nextStepId('gpd'),
                kind: 'getParticipantData',
                lineNumber: copy.lineNumber,
                avayaCommand: 'DATA_PROVENANCE_READ',
                label: `Get Participant Data: ${r.name}`,
                variableName: r.name,
                variableRef: r.refName,
                sectionHint: copy.sectionHint,
                yamlComment: `KOMPATIBILITAETS-STUB (OPT-IN): "${r.name}" wird vor expliziter Zuweisung geprueft — Uebernahme aus Participant Data als bewusste Annahme ergaenzt.`,
                provenanceFinding: {
                  severity: 'WARN',
                  code: 'VAR_USED_BEFORE_SET',
                  variableName: r.name,
                  message: `Variable "${r.name}" wird in Zeile ${copy.lineNumber} geprüft, aber vorher im Skript nicht explizit gesetzt (Kompatibilitäts-Stub: Get Participant Data als Herkunftsannahme ergänzt).`,
                },
                isTerminal: false,
              });
              markWritten(r.name);
            }
          } else {
            // Strict Honest Migration (Default): NEVER invent getParticipantData or synthetic Data Table Lookups.
            // Mark transparently as open migration question via inline YAML comment + structured FlowIR finding.
            const varInfo = `Source for "${r.refName}" is not proven in the legacy script. No synthetic getParticipantData, data action, or lookup has been generated in strict mode.`;
            const varGuidance = `Please clarify whether this value comes from participant data, a data table, or an upstream module.`;
            appendComment(copy, `OFFENE MIGRATIONSFRAGE: Quelle fuer "${r.refName}" im Avaya-Skript nicht belegt — kein getParticipantData/Lookup erfunden; Herkunft (z. B. Participant Data, Data Table oder vorgeschaltetes Modul) bitte fachlich klaeren.`);
            appendAnnotation(
              copy,
              'VAR_USED_BEFORE_SET',
              'OFFENE MIGRATIONSFRAGE',
              [varInfo, varGuidance],
              'strict'
            );
            appendFinding(copy, {
              severity: 'WARN',
              code: 'VAR_USED_BEFORE_SET',
              variableName: r.name,
              message: `Variable "${r.name}" wird in Zeile ${copy.lineNumber} geprüft, hat aber keine belegte Quelle im Avaya-Skript (kein getParticipantData/Lookup erfunden — offene Migrationsfrage).`,
            });
          }
        }

        // Semantic Date/Time Comparison Review (applies in BOTH strict & stub mode without silent normalization)
        if (
          /\b(?:GetCurrentDateTimeUtc|DayOfWeek)\s*\(/.test(copy.expression) &&
          /(?:==|!=)/.test(copy.expression)
        ) {
          const flaggedVar = refs.find((r) => {
            const lower = r.name.toLowerCase();
            const fVar = registry.flowVars.get(lower);
            const tVar = hostTask.taskVariables.find((tv) => tv.name.toLowerCase() === lower);
            const dt = fVar?.dataType || tVar?.dataType;
            return (
              dt === 'string' ||
              /(?:list|liste|table|tabelle|holiday|feiertag)/i.test(r.name)
            );
          });
          if (flaggedVar) {
            const reviewReason =
              `Expression "${copy.expression}" compares DateTime against string/list variable "${flaggedVar.refName}"; preserved verbatim for auditability, but likely requires manual normalization before productive Architect import.`;
            copy.expressionReview = {
              kind: 'datetime_vs_string_or_list',
              preservedExpression: copy.expression,
              reason: reviewReason,
            };
            appendComment(
              copy,
              `OFFENE MIGRATIONSFRAGE: DateTime-vs-String/List-Vergleich (${copy.expression}) fuer Nachvollziehbarkeit unveraendert uebernommen — erfordert vor produktivem Architect-Import manuelle Format-/Typpruefung.`
            );
            appendAnnotation(
              copy,
              'DATE_COMPARISON_SEMANTIC_REVIEW',
              'OFFENE MIGRATIONSFRAGE',
              [
                `Expression "${copy.expression}" compares a temporal value against "${flaggedVar.refName}".`,
                `Preserved verbatim for auditability, but likely requires manual normalization (date format, timezone, or Data Table lookup) before productive Architect import.`,
              ],
              compatibilityStubMode ? 'stub' : 'strict'
            );
            appendFinding(copy, {
              severity: 'WARN',
              code: 'DATE_COMPARISON_SEMANTIC_REVIEW',
              variableName: flaggedVar.name,
              message: `Semantische Datumsprüfung erforderlich (Zeile ${copy.lineNumber}): "${copy.expression}" vergleicht einen Zeit-/Datumswert mit "${flaggedVar.refName}". Für Auditierbarkeit unverändert übernommen; erfordert vor produktivem Architect-Import manuelle Normalisierung.`,
            });
            warnings.push({
              code: 'DATE_COMPARISON_SEMANTIC_REVIEW',
              severity: 'warning',
              lineNumber: copy.lineNumber,
              message: `Zeile ${copy.lineNumber}: Ausdruck "${copy.expression}" vergleicht DateTime mit "${flaggedVar.refName}" — unverändert übernommen, bitte vor produktivem Architect-Import manuell normalisieren.`,
            });
          }
        }
      } else if (copy.kind === 'switch' && copy.variableRef) {
        const refs = extractScopedVarsFromExpr(copy.variableRef);
        for (const r of refs) {
          const lower = r.name.toLowerCase();
          if (written.has(lower)) continue;

          // If immediately preceded by a real callDataAction from Avaya, wire this response var straight into its outputs!
          const prevOut = out[out.length - 1];
          if (prevOut && prevOut.kind === 'callDataAction') {
            prevOut.dataActionOutputs = prevOut.dataActionOutputs || [];
            if (!prevOut.dataActionOutputs.some((o) => o.targetVarName.toLowerCase() === lower)) {
              prevOut.dataActionOutputs.push({
                field: 'responseCode',
                targetVarName: r.name,
                targetVarRef: r.refName,
                dataType: 'string',
              });
            }
            markWritten(r.name);
            continue;
          }

          // Honest migration modeling: do NOT invent a fictional Data Action or redundant getParticipantData chain
          // when the Avaya script doesn't show the upstream write — annotate transparently as OFFENE MIGRATIONSFRAGE!
          const prevWasSubflow =
            prevOut && (prevOut.kind === 'callTask' || prevOut.kind === 'callCommonModule');
          const switchMsg = prevWasSubflow
            ? `OFFENE MIGRATIONSFRAGE: ${r.refName} muss aus vorgeschaltetem Modul "${prevOut.target || 'Subflow'}", Lookup oder externer Integration befuellt werden.`
            : `OFFENE MIGRATIONSFRAGE: ${r.refName} muss aus vorgeschaltetem Modul, Lookup oder externer Integration befuellt werden.`;
          appendComment(copy, switchMsg);
          appendAnnotation(
            copy,
            'SWITCH_WITHOUT_SOURCE',
            'OFFENE MIGRATIONSFRAGE',
            [
              prevWasSubflow
                ? `${r.refName} must be populated by upstream module "${prevOut.target || 'Subflow'}", lookup, or external integration.`
                : `${r.refName} must be populated by an upstream module, lookup, or external integration.`,
            ],
            compatibilityStubMode ? 'stub' : 'strict'
          );
          appendFinding(copy, {
            severity: 'WARN',
            code: 'SWITCH_WITHOUT_SOURCE',
            variableName: r.name,
            message: `Switch auf "${r.refName}" in Zeile ${copy.lineNumber}: Quelle im Avaya-Skript nicht explizit belegt (offene Migrationsfrage markiert, keine fiktive Data Action erfunden).`,
          });
        }
      } else {
        // Also check expression reads inside updateData, setParticipantData, setUuiData, callDataAction inputs & callDataTableLookup key
        const readExprs: string[] = [];
        if (
          (copy.kind === 'updateData' ||
            copy.kind === 'setParticipantData' ||
            copy.kind === 'setUuiData') &&
          copy.expressionValue
        ) {
          readExprs.push(copy.expressionValue);
        }
        if (copy.kind === 'callDataTableLookup' && copy.dataTableKey) {
          readExprs.push(copy.dataTableKey);
        }
        if (copy.kind === 'callDataAction' && copy.dataActionInputs) {
          copy.dataActionInputs.forEach((inp) => {
            if (inp.expr) readExprs.push(inp.expr);
          });
        }
        for (const rexp of readExprs) {
          const refs = extractScopedVarsFromExpr(rexp);
          for (const r of refs) {
            const lower = r.name.toLowerCase();
            if (written.has(lower)) continue;
            if (
              lower === 'estimatedwaittime' ||
              lower === 'queueagentsonline' ||
              lower === 'emergencyoverride' ||
              lower === 'avayaoriginscript' ||
              lower === 'startdatetimeutc'
            ) {
              continue;
            }
            if (compatibilityStubMode) {
              synthesizedSourceCount += 1;
              out.push({
                id: nextStepId('gpd'),
                kind: 'getParticipantData',
                lineNumber: copy.lineNumber,
                avayaCommand: 'DATA_PROVENANCE_READ',
                label: `Get Participant Data: ${r.name}`,
                variableName: r.name,
                variableRef: r.refName,
                sectionHint: copy.sectionHint,
                yamlComment: `KOMPATIBILITAETS-STUB (OPT-IN): "${r.name}" wird in Ausdruck verwendet bevor er gesetzt wurde — Uebernahme aus Participant Data als bewusste Annahme ergaenzt.`,
                provenanceFinding: {
                  severity: 'WARN',
                  code: 'VAR_USED_BEFORE_SET',
                  variableName: r.name,
                  message: `Variable "${r.name}" wird in Zeile ${copy.lineNumber} gelesen, bevor sie gesetzt wurde (Kompatibilitäts-Stub: Get Participant Data ergänzt).`,
                },
                isTerminal: false,
              });
              markWritten(r.name);
            } else {
              appendComment(
                copy,
                `OFFENE MIGRATIONSFRAGE: Quelle fuer "${r.refName}" im Avaya-Skript nicht belegt — kein getParticipantData/Lookup erfunden; Herkunft bitte fachlich klaeren.`
              );
              appendAnnotation(
                copy,
                'VAR_USED_BEFORE_SET',
                'OFFENE MIGRATIONSFRAGE',
                [
                  `Source for "${r.refName}" is not proven in the legacy script. No synthetic getParticipantData or lookup has been generated in strict mode.`,
                ],
                'strict'
              );
              appendFinding(copy, {
                severity: 'WARN',
                code: 'VAR_USED_BEFORE_SET',
                variableName: r.name,
                message: `Variable "${r.name}" wird in Zeile ${copy.lineNumber} gelesen, hat aber keine belegte Quelle im Avaya-Skript (kein getParticipantData/Lookup erfunden — offene Migrationsfrage).`,
              });
            }
          }
        }
      }

      // Record writes performed by this step
      if (copy.kind === 'updateData' || copy.kind === 'getParticipantData') {
        markWritten(copy.variableName);
      } else if (copy.kind === 'collectInput') {
        markWritten(copy.inputVarName);
      } else if (copy.kind === 'callDataAction' || copy.kind === 'callDataTableLookup') {
        for (const om of copy.dataActionOutputs || []) {
          markWritten(om.targetVarName);
        }
      }

      // Recurse into child branches with isolated copy of current written set
      if (copy.yesSteps) copy.yesSteps = ensureProvenanceOnList(copy.yesSteps, written, hostTask);
      if (copy.noSteps) copy.noSteps = ensureProvenanceOnList(copy.noSteps, written, hostTask);
      if (copy.openSteps) copy.openSteps = ensureProvenanceOnList(copy.openSteps, written, hostTask);
      if (copy.closedSteps) copy.closedSteps = ensureProvenanceOnList(copy.closedSteps, written, hostTask);
      if (copy.holidaySteps) copy.holidaySteps = ensureProvenanceOnList(copy.holidaySteps, written, hostTask);
      if (copy.successSteps) copy.successSteps = ensureProvenanceOnList(copy.successSteps, written, hostTask);
      if (copy.failureSteps) copy.failureSteps = ensureProvenanceOnList(copy.failureSteps, written, hostTask);
      if (copy.timeoutSteps) copy.timeoutSteps = ensureProvenanceOnList(copy.timeoutSteps, written, hostTask);
      if (copy.foundSteps) copy.foundSteps = ensureProvenanceOnList(copy.foundSteps, written, hostTask);
      if (copy.notFoundSteps) copy.notFoundSteps = ensureProvenanceOnList(copy.notFoundSteps, written, hostTask);
      if (copy.bodySteps) copy.bodySteps = ensureProvenanceOnList(copy.bodySteps, written, hostTask);
      if (copy.defaultSteps) copy.defaultSteps = ensureProvenanceOnList(copy.defaultSteps, written, hostTask);
      if (copy.cases) {
        copy.cases = copy.cases.map((c) => ({
          ...c,
          steps: ensureProvenanceOnList(c.steps, written, hostTask),
        }));
      }

      out.push(copy);
    }

    return out;
  };

  // Variables initialized with explicit non-empty Avaya static literals are already written
  const preWrittenFlowVars = new Set<string>();
  for (const fv of registry.flowVars.values()) {
    if (fv.dataType === 'string' && typeof fv.initialValue === 'string' && fv.initialValue.trim().length > 0) {
      preWrittenFlowVars.add(fv.name.toLowerCase());
    }
  }

  for (const t of tasks) {
    if (t.kind === 'fallback') continue;
    t.steps = ensureProvenanceOnList(t.steps, preWrittenFlowVars, t);
  }

  // Ensure Fallback_Error_Task exists if provenance pass synthesized a Data Action referencing it
  if (needsFallbackErrorTask && !tasks.some((t) => t.refId === 'Fallback_Error_Task')) {
    tasks.push({
      refId: 'Fallback_Error_Task',
      name: 'Fallback_Error_Task',
      kind: 'fallback',
      originalTarget: 'System Fallback',
      isProtectedHandler: true,
      taskVariables: [],
      steps: [
        {
          id: nextStepId('aud'),
          kind: 'playAudio',
          lineNumber: 0,
          avayaCommand: 'FALLBACK_AUDIO',
          label: 'Fallback Hinweis-Ansage',
          target: 'Technischer_Hinweis',
          targetSlug: 'Technischer_Hinweis',
          ttsText: 'Entschuldigung, aktuell liegt eine technische Stoerung vor. Bitte versuchen Sie es spaeter erneut.',
          isTerminal: false,
        },
        {
          id: nextStepId('disc'),
          kind: 'disconnect',
          lineNumber: 0,
          avayaCommand: 'FALLBACK_DISCONNECT',
          label: 'Disconnect (Fallback Error)',
          target: 'Fallback_Error',
          isTerminal: true,
        },
      ],
    });
  }

  // Count terminal and branch nodes across the finalized graph
  let terminalNodeCount = 0;
  let branchNodeCount = 0;
  const walkStats = (list: MigrationStep[]) => {
    for (const st of list) {
      if (st.isTerminal) terminalNodeCount += 1;
      if (
        st.kind === 'decision' ||
        st.kind === 'switch' ||
        st.kind === 'evaluateScheduleGroup' ||
        st.kind === 'collectInput' ||
        st.kind === 'callDataAction' ||
        st.kind === 'callDataTableLookup'
      ) {
        branchNodeCount += 1;
      }
      if (st.yesSteps) walkStats(st.yesSteps);
      if (st.noSteps) walkStats(st.noSteps);
      if (st.openSteps) walkStats(st.openSteps);
      if (st.closedSteps) walkStats(st.closedSteps);
      if (st.holidaySteps) walkStats(st.holidaySteps);
      if (st.successSteps) walkStats(st.successSteps);
      if (st.failureSteps) walkStats(st.failureSteps);
      if (st.timeoutSteps) walkStats(st.timeoutSteps);
      if (st.foundSteps) walkStats(st.foundSteps);
      if (st.notFoundSteps) walkStats(st.notFoundSteps);
      if (st.bodySteps) walkStats(st.bodySteps);
      if (st.defaultSteps) walkStats(st.defaultSteps);
      if (st.cases) st.cases.forEach((c) => walkStats(c.steps));
    }
  };
  tasks.forEach((t) => walkStats(t.steps));

  const cleanName = toCleanGraphSlug(node.scriptNumber || node.fileName, 'Avaya_Flow');

  const graph: MigrationFlowGraph = {
    schemaVersion,
    scriptKey: node.scriptKey,
    scriptNumber: node.scriptNumber,
    fileName: node.fileName,
    cleanName,
    entryTaskRefId: 'Main_Task',
    flowVariables: Array.from(registry.flowVars.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
    tasks,
    diagnostics: {
      prunedUnreachableCount: deadPathCounter.pruned,
      normalizedTargetCount: normalizedTargets.length,
      realExpressionCount,
      fallbackExpressionCount,
      terminalNodeCount,
      branchNodeCount,
      inlinedSectionCount,
      synthesizedSourceCount,
      normalizedTargets,
      compatibilityStubMode,
      prunedUnreachableTasks,
    },
  };

  return {
    graph,
    warnings,
    localSubscriptRefs: Array.from(localSubscriptRefsMap.values()),
    metrics: {
      backwardGotoCount,
      hasMultiSkillset,
      oracleApiCount,
      flixcheckApiCount,
      commonModuleCallCount,
      callTaskCount,
      uniqueSkillsets: Array.from(uniqueSkillsets),
    },
  };
}

/**
 * Flattens all steps in a MigrationFlowGraph into an ordered list (for summary metrics & compatibility).
 */
export function flattenMigrationSteps(graph: MigrationFlowGraph): MigrationStep[] {
  const flat: MigrationStep[] = [];
  const visit = (list: MigrationStep[]) => {
    for (const st of list) {
      flat.push(st);
      if (st.yesSteps) visit(st.yesSteps);
      if (st.noSteps) visit(st.noSteps);
      if (st.openSteps) visit(st.openSteps);
      if (st.closedSteps) visit(st.closedSteps);
      if (st.holidaySteps) visit(st.holidaySteps);
      if (st.successSteps) visit(st.successSteps);
      if (st.failureSteps) visit(st.failureSteps);
      if (st.timeoutSteps) visit(st.timeoutSteps);
      if (st.foundSteps) visit(st.foundSteps);
      if (st.notFoundSteps) visit(st.notFoundSteps);
      if (st.bodySteps) visit(st.bodySteps);
      if (st.defaultSteps) visit(st.defaultSteps);
      if (st.cases) st.cases.forEach((c) => visit(c.steps));
    }
  };
  for (const t of graph.tasks) {
    if (t.kind === 'fallback') continue;
    visit(t.steps);
  }
  return flat;
}
