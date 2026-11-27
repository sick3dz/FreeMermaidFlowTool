/**
 * KANONISCHES FLOW-IR v1.1 (Single Source of Truth: Avaya -> IR -> Avaya / Genesys)
 *
 * 100 % Offline & In-Memory. Verändert keinerlei Avaya-Parser oder Avaya-Audit-Dateien.
 *
 * Architektur:
 *  1. Avaya-Skripte (Read-Only) -> Neutrale FlowIR v1.1 (meta, variables, nodes, transitions, dependencies, findings, renderingHints)
 *  2. validateIR(ir) -> Harte Graph-Integrität + alle 10 verbindlichen Findings-Codes
 *  3. Dual-Renderer auf Basis derselben IR:
 *       - renderAvayaView(ir)   (modus = "avaya")
 *       - renderGenesysView(ir) (modus = "genesys")
 */
import type {
  MigrationFlowGraph,
  MigrationStep,
  MigrationTaskGraph,
  MigrationVariableDataType,
} from './genesysMigrationGraph';

// ============================================================================
// FLOW-IR v1.1 SCHEMA-TYPEN
// ============================================================================

export interface FlowIRSourceTrace {
  script: string;
  section?: string;
  lineStart: number;
  lineEnd: number;
}

export type FlowIRVariableScope = 'flow' | 'task';
export type FlowIRVariableCategory = 'flow' | 'task' | 'participant' | 'metadata';
export type FlowIRVariableType = 'string' | 'integer' | 'boolean';

export type FlowIRVariableProvenance =
  | 'avaya_assigned'
  | 'avaya_literal'
  | 'system_context'
  | 'resolved_external_lookup'
  | 'unproven'
  | 'stub_synthesized';

export interface FlowIRVariable {
  id: string;
  /** Strikt scope-freier Rohname (ohne "Flow." / "Task."). */
  name: string;
  scope: FlowIRVariableScope;
  category: FlowIRVariableCategory;
  owner?: string;
  type: FlowIRVariableType;
  initialValue: string | number | boolean;
  source: {
    origin: 'avaya' | 'derived' | 'system';
    originalName: string;
  };
  /** v1.1-Herkunftsklassifizierung fuer ehrliche Migration ohne erfundene Quellen. */
  provenance?: FlowIRVariableProvenance;
  /** Optionaler Hinweis, wenn ein Task-Name zugunsten einer vorhandenen Flow-Variable vereinheitlicht wurde. */
  compatibilityScopeAlias?: string;
  sourceTrace: FlowIRSourceTrace;
  derivedFrom?: string;
  usedByNodes: string[];
}

export type FlowIRNodeKind =
  | 'entry'
  | 'action'
  | 'decision'
  | 'switch'
  | 'collectInput'
  | 'transfer'
  | 'disconnect'
  | 'invokeSubflow'
  | 'invokeCommonModule'
  | 'dataAction'
  | 'scheduleCheck'
  | 'terminal';

export type FlowIRTransferTargetType =
  | 'queue'
  | 'user'
  | 'externalNumber'
  | 'extension'
  | 'flow'
  | 'unresolved';

export interface FlowIRIntegrationSpec {
  type: 'dbLookup' | 'webservice' | 'api';
  sourceSystem: 'avaya';
  targetAction: string;
  category?: string;
}

export interface FlowIRInputBinding {
  name: string;
  /** Scope-freier Ausdruck in der IR (z. B. "callerId" oder "Call.Ani"). */
  expr: string;
}

export interface FlowIROutputBinding {
  name: string;
  /** Scope-freier Zielvariablenname in der IR (z. B. "customerStatus"). */
  targetVariable: string;
}

export interface FlowIRErrorHandling {
  onError?: string;
  onTimeout?: string;
}

export type FlowIRTerminalityEvidence =
  | 'proven_source'
  | 'explicit_command'
  | 'resolved_business_policy'
  | 'unproven_external'
  | 'non_terminal';

export interface FlowIRMigrationAnnotation {
  findingCode: FlowIRFindingCode;
  prefix:
    | 'OFFENE MIGRATIONSFRAGE'
    | 'KOMPATIBILITAETS-STUB (OPT-IN)'
    | 'RESOLVED TARGET (v1.6.5)'
    | 'CONSOLIDATION REVIEW';
  lines: string[];
  mode: 'strict' | 'stub' | 'resolved';
}

export interface FlowIRExpressionReview {
  kind: 'datetime_vs_string_or_list';
  preservedExpression: string;
  reason: string;
}

export interface FlowIRNode {
  id: string;
  kind: FlowIRNodeKind;
  actionType?: string;
  name: string;
  /** Explizites v1.1-Flag: Validator und Renderer müssen Terminalität nicht erraten. */
  terminal: boolean;
  /** Evidenzquelle fuer Terminalitaet (kein erratener Disconnect). */
  terminalityEvidence?: FlowIRTerminalityEvidence;
  parameters: Record<string, unknown>;
  /** v1.1-Herkunftsnachweis je Node (Skript, Abschnitt, Zeilenbereich). */
  sourceTrace: FlowIRSourceTrace;
  condition?: {
    /** Scope-freier Ausdruck in der IR (z. B. `blacklistFlag == "1"`). */
    expr: string;
    sourceExpr?: string;
  };
  expression?: {
    /** Scope-freier Ausdruck in der IR (z. B. `responseCode`). */
    expr: string;
    sourceExpr?: string;
  };
  integration?: FlowIRIntegrationSpec;
  inputs?: FlowIRInputBinding[];
  outputs?: FlowIROutputBinding[];
  errorHandling?: FlowIRErrorHandling;
  /** v1.1-Zieltypisierung für Transfers (queue | user | externalNumber | extension | flow | unresolved). */
  resolvedTargetType?: FlowIRTransferTargetType;
  /** Optionaler Hinweis für offene Migrationsfragen. */
  migrationNote?: string;
  /** Mehrzeilige # OFFENE MIGRATIONSFRAGE Kommentare synchron zu findings. */
  migrationComments?: string[];
  /** Strukturierte 1:1 Kommentar-Annotationen verknuepft mit Finding-Codes. */
  migrationAnnotations?: FlowIRMigrationAnnotation[];
  /** Hinweis auf absichtlich unveraendert belassene Ausdruecke mit Semantik-Pruefbedarf. */
  expressionReview?: FlowIRExpressionReview;
}

export type FlowIRTransitionType =
  | 'unconditional'
  | 'whenTrue'
  | 'whenFalse'
  | 'case'
  | 'default'
  | 'success'
  | 'failure'
  | 'timeout'
  | 'noMatch'
  | 'open'
  | 'closed'
  | 'holiday'
  | 'terminal';

export interface FlowIRTransition {
  from: string;
  to: string;
  type: FlowIRTransitionType;
  matchValue?: string;
}

export type FlowIRFindingSeverity = 'INFO' | 'WARN' | 'ERROR';

export type FlowIRWarningClass =
  | 'actionable_migration'
  | 'semantic_review'
  | 'source_hint'
  | 'source_only_hint'
  | 'informational_cleanup';

export function normalizeWarningClass(cls?: FlowIRWarningClass): FlowIRWarningClass {
  if (cls === 'source_only_hint') return 'source_hint';
  return cls || 'actionable_migration';
}

export type FlowIRFindingCategory =
  | 'provenance'
  | 'terminality'
  | 'holiday_logic'
  | 'expression_review'
  | 'wait_hint'
  | 'cleanup'
  | 'reachability'
  | 'scope'
  | 'reference'
  | 'subflow';

export type FlowIRFindingCode =
  | 'VAR_USED_BEFORE_SET'
  | 'TERMINAL_PATH_CONTINUES'
  | 'EMPTY_BRANCH'
  | 'DUMMY_CONDITION'
  | 'MISSING_CONDITION_SOURCE'
  | 'SWITCH_WITHOUT_SOURCE'
  | 'UNRESOLVED_TRANSFER_TARGET'
  | 'UNRESOLVED_INTEGRATION_OUTPUT'
  | 'SECTION_RENDERED_BLINDLY'
  | 'MISSING_ERROR_PATH'
  | 'MISSING_TIMEOUT_PATH'
  | 'INVALID_ENTRY_NODE'
  | 'BROKEN_TRANSITION_REF'
  | 'TERMINAL_HAS_OUTGOING'
  | 'UNREACHABLE_NODE'
  | 'VARIABLE_UNDECLARED'
  | 'MISSING_SUBFLOW_SOURCE'
  | 'POTENTIAL_BRANCH_FALLTHROUGH'
  | 'DUPLICATE_HOLIDAY_LOGIC'
  | 'HOLIDAY_LOOKUP_RESOLVED'
  | 'DATE_COMPARISON_SEMANTIC_REVIEW'
  | 'WAIT_UNMAPPED_ACTIVE_PATH'
  | 'WAIT_SOURCE_ONLY_HINT'
  | 'UNRESOLVED_TASK_REF'
  | 'DUPLICATE_VARIABLE_SCOPE'
  | 'UNREACHABLE_TASK_PRUNED';

export interface FlowIRFinding {
  severity: FlowIRFindingSeverity;
  code: FlowIRFindingCode;
  message: string;
  warningClass?: FlowIRWarningClass;
  category?: FlowIRFindingCategory;
  requiresBusinessReview?: boolean;
  nodeId?: string;
  variableName?: string;
  sourceTrace?: FlowIRSourceTrace;
}

export interface FlowIRPrunedTaskInfo {
  refId: string;
  originalTarget: string;
  reason: string;
}

export interface FlowIR {
  meta: {
    flowId: string;
    sourceSystem: 'Avaya';
    targetSystem: 'Genesys';
    sourceScript: string;
    entryNodeId: string;
    language: string;
    version: '1.1';
    compatibilityStubMode?: boolean;
    resolvedTargetMode?: boolean;
    holidayLookupTarget?: 'dataAction' | 'dataTable';
    prunedUnreachableTasks?: FlowIRPrunedTaskInfo[];
  };
  variables: FlowIRVariable[];
  nodes: FlowIRNode[];
  transitions: FlowIRTransition[];
  dependencies: {
    subflows: string[];
    commonModules: string[];
    dataActions: string[];
  };
  findings: FlowIRFinding[];
  renderingHints: {
    genesys: {
      preferReusableTasks: boolean;
      preferDecisionNodes: boolean;
      avoidGotoStyleSections: boolean;
    };
  };
}

export interface FlowIRDocument {
  flowIR: FlowIR;
}

export interface FlowIRValidationResult {
  isValid: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  commentParityOk?: boolean;
  findings: FlowIRFinding[];
  stats: {
    nodeCount: number;
    transitionCount: number;
    variableCount: number;
    terminalNodeCount: number;
    decisionCount: number;
    switchCount: number;
    integrationCount: number;
  };
}

export interface RenderedModeReport {
  mode: 'avaya' | 'genesys';
  kurzfazit: string;
  annahmenUndOffenePunkte: string[];
  ergebnisText: string;
  migrationshinweise: string[];
  markdownReport: string;
}

// ============================================================================
// SCOPE-HILFSFUNKTIONEN (IR = strikt scope-frei; Genesys = Flow.* / Task.*)
// ============================================================================

const SYSTEM_IDENTIFIERS = new Set<string>([
  'Call',
  'Call.Ani',
  'Call.Dnis',
  'Call.EstimatedWaitTime',
  'Call.UserToUserInformation',
  'Call.CalledAddressOriginal',
  'Call.Language',
  'Flow.StartDateTimeUtc',
  'StartDateTimeUtc',
  'GetCurrentDateTimeUtc',
  'DayOfWeek',
  'Hour',
  'Minute',
  'Day',
  'Month',
  'Year',
  'DateTime',
  'MakeDateTime',
  'ToString',
  'true',
  'false',
  'and',
  'or',
  'not',
  'Length',
  'Contains',
  'IsNotSetOrEmpty',
  'MakeDuration',
  'ToInt',
  'Append',
]);

/**
 * Entfernt "Flow." und "Task." aus Ausdrücken, damit die IR vollständig scope-frei bleibt.
 * Systemreferenzen wie Call.Dnis / Call.Ani bleiben unangetastet.
 */
export function stripScopesFromExpr(expr: string): string {
  if (!expr) return '';
  return expr.replace(/\b(?:Flow|Task)\.(?!StartDateTimeUtc\b)([A-Za-z_][A-Za-z0-9_]*)\b/g, '$1');
}

/**
 * Extrahiert alle nicht-systemischen Variablenbezeichner aus einem scope-freien IR-Ausdruck.
 */
export function extractReferencedVarNamesFromExpr(expr: string): string[] {
  if (!expr) return [];
  // Strip quoted string literals first
  const withoutStrings = expr.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ');
  // Remove system Call.* and Flow.StartDateTimeUtc dotted chains
  const withoutSystem = withoutStrings
    .replace(/\bCall\.[A-Za-z0-9_.]+\b/g, ' ')
    .replace(/\bFlow\.StartDateTimeUtc\b/g, ' ');
  // Remove function call names (Identifier followed by "(")
  const withoutFn = withoutSystem.replace(/\b[A-Za-z_][A-Za-z0-9_]*\s*(?=\()/g, ' ');
  const found = new Set<string>();
  const matches = withoutFn.matchAll(/\b(?:Flow\.|Task\.)?([A-Za-z_][A-Za-z0-9_]*)\b/g);
  for (const m of matches) {
    const token = m[1];
    if (!token || SYSTEM_IDENTIFIERS.has(token)) continue;
    if (/^(?:true|false|and|or|not|null|undefined)$/i.test(token)) continue;
    found.add(token);
  }
  return Array.from(found);
}

/**
 * Wendet beim Rendern nach Genesys die Scopes "Flow." / "Task." anhand der IR-Variablen-Definition an.
 */
export function applyGenesysScopesToExpr(
  rawExpr: string,
  variables: FlowIRVariable[]
): string {
  if (!rawExpr) return '';
  const scopeByLower = new Map<string, FlowIRVariable>();
  for (const v of variables) {
    scopeByLower.set(v.name.toLowerCase(), v);
  }

  // Split by string literals to avoid mutating quoted text
  const segments = rawExpr.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g);
  return segments
    .map((seg, idx) => {
      if (idx % 2 === 1) return seg; // Quoted literal
      return seg.replace(
        /(?<![.\w])([A-Za-z_][A-Za-z0-9_]*)(?!\s*\()/g,
        (full, ident: string, offset: number, whole: string) => {
          // Do not rewrite if already preceded by Call. / Flow. / Task.
          const prevChar = offset > 0 ? whole[offset - 1] : '';
          if (prevChar === '.') return full;
          if (SYSTEM_IDENTIFIERS.has(ident)) return full;
          const decl = scopeByLower.get(ident.toLowerCase());
          if (!decl) return full;
          return decl.scope === 'task' ? `Task.${decl.name}` : `Flow.${decl.name}`;
        }
      );
    })
    .join('');
}

function cleanSlug(raw: string, fallback = 'Item'): string {
  const s = String(raw || '')
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
  if (!s) return fallback;
  return /^[0-9]/.test(s) ? `S_${s}` : s;
}

function escYaml(raw: string): string {
  return String(raw || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
    .trim();
}

const ANNOTATION_ORDER: Partial<Record<FlowIRFindingCode, number>> = {
  VAR_USED_BEFORE_SET: 1,
  SWITCH_WITHOUT_SOURCE: 2,
  DUPLICATE_HOLIDAY_LOGIC: 3,
  DATE_COMPARISON_SEMANTIC_REVIEW: 4,
  POTENTIAL_BRANCH_FALLTHROUGH: 5,
  WAIT_UNMAPPED_ACTIVE_PATH: 6,
  HOLIDAY_LOOKUP_RESOLVED: 7,
};

export function classifyFlowIRFinding(code: FlowIRFindingCode): {
  category: FlowIRFindingCategory;
  warningClass: FlowIRWarningClass;
  requiresBusinessReview: boolean;
} {
  switch (code) {
    case 'VAR_USED_BEFORE_SET':
    case 'SWITCH_WITHOUT_SOURCE':
    case 'MISSING_CONDITION_SOURCE':
    case 'VARIABLE_UNDECLARED':
      return {
        category: 'provenance',
        warningClass: 'actionable_migration',
        requiresBusinessReview: true,
      };
    case 'POTENTIAL_BRANCH_FALLTHROUGH':
    case 'TERMINAL_PATH_CONTINUES':
    case 'TERMINAL_HAS_OUTGOING':
      return {
        category: 'terminality',
        warningClass: 'actionable_migration',
        requiresBusinessReview: true,
      };
    case 'DUPLICATE_HOLIDAY_LOGIC':
      return {
        category: 'holiday_logic',
        warningClass: 'semantic_review',
        requiresBusinessReview: true,
      };
    case 'HOLIDAY_LOOKUP_RESOLVED':
      return {
        category: 'holiday_logic',
        warningClass: 'informational_cleanup',
        requiresBusinessReview: false,
      };
    case 'DATE_COMPARISON_SEMANTIC_REVIEW':
      return {
        category: 'expression_review',
        warningClass: 'semantic_review',
        requiresBusinessReview: true,
      };
    case 'WAIT_UNMAPPED_ACTIVE_PATH':
      return {
        category: 'wait_hint',
        warningClass: 'actionable_migration',
        requiresBusinessReview: true,
      };
    case 'WAIT_SOURCE_ONLY_HINT':
      return {
        category: 'wait_hint',
        warningClass: 'source_hint',
        requiresBusinessReview: false,
      };
    case 'UNREACHABLE_TASK_PRUNED':
    case 'UNREACHABLE_NODE':
      return {
        category: 'reachability',
        warningClass: 'informational_cleanup',
        requiresBusinessReview: false,
      };
    case 'DUPLICATE_VARIABLE_SCOPE':
      return {
        category: 'scope',
        warningClass: 'informational_cleanup',
        requiresBusinessReview: false,
      };
    case 'UNRESOLVED_INTEGRATION_OUTPUT':
      return {
        category: 'cleanup',
        warningClass: 'informational_cleanup',
        requiresBusinessReview: false,
      };
    case 'UNRESOLVED_TASK_REF':
    case 'BROKEN_TRANSITION_REF':
    case 'INVALID_ENTRY_NODE':
    case 'UNRESOLVED_TRANSFER_TARGET':
      return {
        category: 'reference',
        warningClass: 'actionable_migration',
        requiresBusinessReview: true,
      };
    case 'MISSING_SUBFLOW_SOURCE':
    case 'SECTION_RENDERED_BLINDLY':
    case 'MISSING_ERROR_PATH':
    case 'MISSING_TIMEOUT_PATH':
    case 'EMPTY_BRANCH':
    case 'DUMMY_CONDITION':
    default:
      return {
        category: 'subflow',
        warningClass: 'actionable_migration',
        requiresBusinessReview: true,
      };
  }
}

/**
 * Shared comment-block synthesizer used by BOTH the primary Archy YAML renderer
 * and renderArchyYamlFromFlowIR so multi-line # OFFENE MIGRATIONSFRAGE blocks
 * follow deterministic ordering and stay 1:1 synchronized with FlowIR findings.
 */
export function formatOrderedMigrationAnnotations(
  annotations?: FlowIRMigrationAnnotation[],
  fallbackNote?: string,
  fallbackComments?: string[]
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const pushLine = (line: string) => {
    const clean = line.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    result.push(clean);
  };

  if (annotations && annotations.length > 0) {
    const sorted = [...annotations].sort((a, b) => {
      const pa = ANNOTATION_ORDER[a.findingCode] ?? 99;
      const pb = ANNOTATION_ORDER[b.findingCode] ?? 99;
      return pa - pb;
    });
    for (const ann of sorted) {
      ann.lines.forEach((rawLine, idx) => {
        const t = rawLine.trim();
        if (!t) return;
        if (
          idx === 0 &&
          !/^(?:OFFENE MIGRATIONSFRAGE|KOMPATIBILITAETS-STUB \(OPT-IN\)|RESOLVED TARGET \(v1\.6\.5\)|CONSOLIDATION REVIEW|HINWEIS)\s*:/i.test(t)
        ) {
          pushLine(`${ann.prefix}: ${t}`);
        } else {
          pushLine(t);
        }
      });
    }
    return result;
  }

  const rawList =
    fallbackComments && fallbackComments.length > 0
      ? fallbackComments
      : fallbackNote
      ? fallbackNote
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  for (const line of rawList) {
    pushLine(line);
  }
  return result;
}

const NODE_COMMENT_PARITY_CODES = new Set<FlowIRFindingCode>([
  'VAR_USED_BEFORE_SET',
  'POTENTIAL_BRANCH_FALLTHROUGH',
  'DUPLICATE_HOLIDAY_LOGIC',
  'DATE_COMPARISON_SEMANTIC_REVIEW',
  'WAIT_UNMAPPED_ACTIVE_PATH',
]);

export function verifyFlowIRCommentParity(ir: FlowIR): {
  isSynchronized: boolean;
  missingNodeFindings: Array<{ nodeId: string; code: FlowIRFindingCode }>;
} {
  const nodeMap = new Map<string, FlowIRNode>((ir.nodes || []).map((n) => [n.id, n]));
  const missingNodeFindings: Array<{ nodeId: string; code: FlowIRFindingCode }> = [];
  for (const f of ir.findings || []) {
    if (!f.nodeId || (f.severity !== 'WARN' && f.severity !== 'ERROR')) continue;
    if (!NODE_COMMENT_PARITY_CODES.has(f.code)) continue;
    const node = nodeMap.get(f.nodeId);
    if (!node) continue;
    const hasAnn = (node.migrationAnnotations || []).some((a) => a.findingCode === f.code);
    const hasLegacyComment =
      Boolean(node.migrationComments && node.migrationComments.length > 0) ||
      Boolean(
        node.migrationNote &&
          /OFFENE MIGRATIONSFRAGE|KOMPATIBILITAETS-STUB|CONSOLIDATION REVIEW|RESOLVED TARGET/i.test(
            node.migrationNote
          )
      );
    if (!hasAnn && !hasLegacyComment) {
      missingNodeFindings.push({ nodeId: f.nodeId, code: f.code });
    }
  }
  return {
    isSynchronized: missingNodeFindings.length === 0,
    missingNodeFindings,
  };
}

// ============================================================================
// BUILDER: MigrationFlowGraph (Level 1) -> Kanonisches FlowIR v1.1
// ============================================================================

export function buildFlowIRFromMigrationGraph(
  graph: MigrationFlowGraph,
  options?: {
    missingSubflows?: string[];
    compatibilityStubMode?: boolean;
    resolvedTargetMode?: boolean;
    holidayLookupTarget?: 'dataAction' | 'dataTable';
    prunedUnreachableTasks?: FlowIRPrunedTaskInfo[];
  }
): FlowIR {
  const scriptName = graph.fileName || `${graph.cleanName}.s`;
  const variables: FlowIRVariable[] = [];
  const varByLower = new Map<string, FlowIRVariable>();
  const compatibilityStubMode =
    options?.compatibilityStubMode ?? Boolean(graph.diagnostics.compatibilityStubMode);
  const resolvedTargetMode =
    options?.resolvedTargetMode ?? Boolean(graph.diagnostics.resolvedTargetMode);
  const holidayLookupTarget =
    options?.holidayLookupTarget ?? graph.diagnostics.holidayLookupTarget;
  const prunedUnreachableTasks: FlowIRPrunedTaskInfo[] =
    options?.prunedUnreachableTasks || graph.diagnostics.prunedUnreachableTasks || [];
  const missingSubflowsSet = new Set(
    (options?.missingSubflows || []).map((s) => s.toLowerCase())
  );

  const splitStepComments = (raw?: string): string[] | undefined => {
    if (!raw) return undefined;
    const arr = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length > 0 ? arr : undefined;
  };

  const registerVar = (
    name: string,
    originalName: string,
    scope: FlowIRVariableScope,
    category: FlowIRVariableCategory,
    type: FlowIRVariableType,
    initialValue: string | number | boolean,
    owner: string | undefined,
    line: number,
    section?: string,
    origin: 'avaya' | 'derived' | 'system' = 'avaya',
    derivedFrom?: string
  ): FlowIRVariable => {
    const cleanName = name.replace(/^(?:Flow|Task)\./i, '');
    const key = cleanName.toLowerCase();
    const existing = varByLower.get(key);
    if (existing) {
      if (derivedFrom && !existing.derivedFrom) existing.derivedFrom = derivedFrom;
      if (scope === 'task' && existing.scope === 'flow' && !existing.compatibilityScopeAlias) {
        existing.compatibilityScopeAlias = `Task.${cleanName}`;
      }
      return existing;
    }
    const defaultProvenance: FlowIRVariableProvenance =
      origin === 'system' || category === 'metadata'
        ? 'system_context'
        : type === 'string' && typeof initialValue === 'string' && initialValue.trim().length > 0
        ? 'avaya_literal'
        : 'unproven';
    const v: FlowIRVariable = {
      id: `v_${cleanSlug(cleanName, 'var').toLowerCase()}`,
      name: cleanName,
      scope,
      category,
      ...(owner ? { owner } : {}),
      type,
      initialValue,
      source: {
        origin,
        originalName: originalName || cleanName,
      },
      provenance: defaultProvenance,
      sourceTrace: {
        script: scriptName,
        ...(section ? { section } : {}),
        lineStart: Math.max(1, line || 1),
        lineEnd: Math.max(1, line || 1),
      },
      ...(derivedFrom ? { derivedFrom } : {}),
      usedByNodes: [],
    };
    varByLower.set(key, v);
    variables.push(v);
    return v;
  };

  // Register Flow-level variables (strictly unscoped names)
  for (const fv of graph.flowVariables) {
    if (fv.name === 'avayaOriginScript') {
      registerVar(
        fv.name,
        fv.originalName,
        'flow',
        'metadata',
        fv.dataType,
        fv.initialValue,
        undefined,
        1,
        'Header',
        'derived',
        'scriptMetadata'
      );
      continue;
    }
    const isParticipant =
      fv.isParticipantData || /^CV_/i.test(fv.originalName) || /_cv$/i.test(fv.originalName);
    registerVar(
      fv.name,
      fv.originalName,
      'flow',
      isParticipant ? 'participant' : 'flow',
      fv.dataType,
      fv.initialValue,
      undefined,
      1,
      undefined,
      'avaya'
    );
  }

  // Register Task-level variables (strictly unscoped names)
  for (const task of graph.tasks) {
    for (const tv of task.taskVariables) {
      registerVar(
        tv.name,
        tv.originalName,
        'task',
        'task',
        tv.dataType,
        tv.initialValue,
        task.refId,
        1,
        task.originalTarget || task.refId,
        'avaya'
      );
    }
  }

  const nodes: FlowIRNode[] = [];
  const transitions: FlowIRTransition[] = [];
  const subflowsSet = new Set<string>();
  const commonModulesSet = new Set<string>();
  const dataActionsSet = new Set<string>();
  const preFindings: FlowIRFinding[] = [];

  const markVarUsed = (varName: string, nodeId: string) => {
    const clean = varName.replace(/^(?:Flow|Task)\./i, '').toLowerCase();
    const v = varByLower.get(clean);
    if (v && !v.usedByNodes.includes(nodeId)) {
      v.usedByNodes.push(nodeId);
    }
  };

  let seq = 0;
  const nextNodeId = (prefix: string, hint?: string): string => {
    seq += 1;
    const slug = hint ? `_${cleanSlug(hint, '').toLowerCase().slice(0, 24)}` : '';
    return `n_${prefix}${slug}_${seq}`;
  };

  // Canonical Entry & Terminal Nodes
  const entryNodeId = 'n_start';
  const endNodeId = 'n_end';

  nodes.push({
    id: entryNodeId,
    kind: 'entry',
    name: 'Start',
    terminal: false,
    parameters: { flowId: graph.cleanName, entryTask: graph.entryTaskRefId },
    sourceTrace: {
      script: scriptName,
      section: graph.tasks[0]?.originalTarget || 'Main_Task',
      lineStart: 1,
      lineEnd: 1,
    },
  });

  // Pre-create entry node IDs for secondary tasks (reusable sections / fallback) so jumpToReusableTask resolves cleanly
  const taskEntryIdMap = new Map<string, string>();
  const taskMap = new Map<string, MigrationTaskGraph>();
  for (const t of graph.tasks) {
    taskMap.set(t.refId, t);
  }

  // Helper to ensure every terminal node connects cleanly to n_end
  let endNodeUsed = false;
  const connectToTerminalEnd = (fromId: string) => {
    endNodeUsed = true;
    transitions.push({ from: fromId, to: endNodeId, type: 'terminal' });
  };

  // Recursive converter for a list of MigrationSteps -> returns { firstId, openExitIds }
  const convertStepList = (
    steps: MigrationStep[],
    sectionName: string,
    ownerTaskRefId: string
  ): { firstId: string | null; openExits: Array<{ nodeId: string; type: FlowIRTransitionType; matchValue?: string }> } => {
    let firstId: string | null = null;
    let pendingExits: Array<{ nodeId: string; type: FlowIRTransitionType; matchValue?: string }> = [];

    const linkFromPending = (targetId: string) => {
      if (!firstId) firstId = targetId;
      for (const ex of pendingExits) {
        transitions.push({
          from: ex.nodeId,
          to: targetId,
          type: ex.type,
          ...(ex.matchValue !== undefined ? { matchValue: ex.matchValue } : {}),
        });
      }
      pendingExits = [];
    };

    for (const step of steps) {
      const trace: FlowIRSourceTrace = {
        script: scriptName,
        section: step.sectionHint || sectionName,
        lineStart: Math.max(1, step.lineNumber || 1),
        lineEnd: Math.max(1, step.lineNumber || 1),
      };

      const pushStepFindings = (nodeId?: string) => {
        const stepFindings = [
          ...(step.provenanceFinding ? [step.provenanceFinding] : []),
          ...(step.additionalFindings || []),
        ];
        for (const sf of stepFindings) {
          const meta = classifyFlowIRFinding(sf.code);
          preFindings.push({
            severity: sf.severity,
            code: sf.code,
            message: sf.message,
            category: meta.category,
            requiresBusinessReview: meta.requiresBusinessReview,
            ...(nodeId ? { nodeId } : {}),
            variableName: sf.variableName,
            sourceTrace: trace,
          });
        }
      };

      const buildCommentFields = () => {
        const formatted = formatOrderedMigrationAnnotations(
          step.migrationAnnotations,
          step.yamlComment
        );
        return {
          ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
          ...(formatted.length > 0 ? { migrationComments: formatted } : {}),
          ...(step.migrationAnnotations && step.migrationAnnotations.length > 0
            ? {
                migrationAnnotations: step.migrationAnnotations.map((a) => ({
                  ...a,
                  lines: [...a.lines],
                })),
              }
            : {}),
          ...(step.expressionReview ? { expressionReview: { ...step.expressionReview } } : {}),
        };
      };

      // Handle jumpToReusableTask -> link directly to target task's entry node
      if (step.kind === 'jumpToReusableTask' && step.targetTaskRefId) {
        const targetRef = step.targetTaskRefId;
        const targetNodeId = taskEntryIdMap.get(targetRef);
        if (targetNodeId) {
          pushStepFindings(targetNodeId);
          linkFromPending(targetNodeId);
          // Jump is terminal for the current sequential chain
          return { firstId, openExits: [] };
        }
        // Fallback if target task wasn't built yet: record as invokeSubflow
        const id = nextNodeId('sub', targetRef);
        subflowsSet.add(targetRef);
        pushStepFindings(id);
        nodes.push({
          id,
          kind: 'invokeSubflow',
          name: targetRef,
          terminal: true,
          parameters: { target: targetRef, mode: 'jump' },
          sourceTrace: trace,
          ...buildCommentFields(),
        });
        linkFromPending(id);
        connectToTerminalEnd(id);
        return { firstId, openExits: [] };
      }

      switch (step.kind) {
        case 'decision': {
          const id = nextNodeId('dec', step.conditionLabel || step.target);
          const unscopedExpr = stripScopesFromExpr(step.expression || '');
          const referencedVars = extractReferencedVarNamesFromExpr(unscopedExpr);
          referencedVars.forEach((vn) => markVarUsed(vn, id));
          pushStepFindings(id);

          nodes.push({
            id,
            kind: 'decision',
            name: step.label || `Check ${step.conditionLabel || 'Condition'}`,
            terminal: false,
            terminalityEvidence: 'non_terminal',
            parameters: {
              ...(step.isEmergencyCheck ? { isEmergencyCheck: true } : {}),
              ...(step.isFallbackFlag ? { isFallbackFlag: true } : {}),
              ...(step.resolvedHolidayMetadata
                ? { resolvedHolidayMetadata: { ...step.resolvedHolidayMetadata } }
                : {}),
            },
            sourceTrace: trace,
            condition: {
              expr: unscopedExpr,
              ...(step.rawCondition ? { sourceExpr: step.rawCondition } : {}),
            },
            ...buildCommentFields(),
          });
          linkFromPending(id);

          const yesRes = convertStepList(step.yesSteps || [], trace.section || sectionName, ownerTaskRefId);
          const noRes = convertStepList(step.noSteps || [], trace.section || sectionName, ownerTaskRefId);

          const nextExits: Array<{ nodeId: string; type: FlowIRTransitionType; matchValue?: string }> = [];
          if (yesRes.firstId) {
            transitions.push({ from: id, to: yesRes.firstId, type: 'whenTrue' });
            nextExits.push(...yesRes.openExits);
          } else {
            nextExits.push({ nodeId: id, type: 'whenTrue' });
          }
          if (noRes.firstId) {
            transitions.push({ from: id, to: noRes.firstId, type: 'whenFalse' });
            nextExits.push(...noRes.openExits);
          } else {
            nextExits.push({ nodeId: id, type: 'whenFalse' });
          }
          pendingExits = nextExits;
          break;
        }

        case 'switch': {
          const id = nextNodeId('sw', step.variableName || 'switch');
          const unscopedExpr = stripScopesFromExpr(step.variableRef || step.expression || '');
          extractReferencedVarNamesFromExpr(unscopedExpr).forEach((vn) => markVarUsed(vn, id));
          pushStepFindings(id);

          nodes.push({
            id,
            kind: 'switch',
            name: step.label || `Switch ${unscopedExpr}`,
            terminal: false,
            parameters: {
              variable: unscopedExpr,
              caseCount: (step.cases || []).length,
            },
            sourceTrace: trace,
            expression: {
              expr: unscopedExpr,
              sourceExpr: step.variableName || unscopedExpr,
            },
            ...buildCommentFields(),
          });
          linkFromPending(id);

          const nextExits: Array<{ nodeId: string; type: FlowIRTransitionType; matchValue?: string }> = [];
          for (const c of step.cases || []) {
            const cRes = convertStepList(c.steps, trace.section || sectionName, ownerTaskRefId);
            if (cRes.firstId) {
              transitions.push({ from: id, to: cRes.firstId, type: 'case', matchValue: c.value });
              nextExits.push(...cRes.openExits);
            } else {
              nextExits.push({ nodeId: id, type: 'case', matchValue: c.value });
            }
          }
          const defRes = convertStepList(step.defaultSteps || [], trace.section || sectionName, ownerTaskRefId);
          if (defRes.firstId) {
            transitions.push({ from: id, to: defRes.firstId, type: 'default' });
            nextExits.push(...defRes.openExits);
          } else {
            nextExits.push({ nodeId: id, type: 'default' });
          }
          pendingExits = nextExits;
          break;
        }

        case 'evaluateScheduleGroup': {
          const id = nextNodeId('sched', step.targetSlug || step.target);
          pushStepFindings(id);
          nodes.push({
            id,
            kind: 'scheduleCheck',
            name: step.label || `Schedule ${step.targetSlug || 'Default'}`,
            terminal: false,
            parameters: {
              scheduleGroup: step.targetSlug || step.target || 'Default_ScheduleGroup',
            },
            sourceTrace: trace,
            ...buildCommentFields(),
          });
          linkFromPending(id);

          const openRes = convertStepList(step.openSteps || [], trace.section || sectionName, ownerTaskRefId);
          const closedRes = convertStepList(step.closedSteps || [], trace.section || sectionName, ownerTaskRefId);
          const holRes = convertStepList(step.holidaySteps || [], trace.section || sectionName, ownerTaskRefId);

          const nextExits: Array<{ nodeId: string; type: FlowIRTransitionType; matchValue?: string }> = [];
          if (openRes.firstId) {
            transitions.push({ from: id, to: openRes.firstId, type: 'open' });
            nextExits.push(...openRes.openExits);
          } else {
            nextExits.push({ nodeId: id, type: 'open' });
          }
          if (closedRes.firstId) {
            transitions.push({ from: id, to: closedRes.firstId, type: 'closed' });
            nextExits.push(...closedRes.openExits);
          } else {
            nextExits.push({ nodeId: id, type: 'closed' });
          }
          if (holRes.firstId) {
            transitions.push({ from: id, to: holRes.firstId, type: 'holiday' });
            nextExits.push(...holRes.openExits);
          } else {
            nextExits.push({ nodeId: id, type: 'holiday' });
          }
          pendingExits = nextExits;
          break;
        }

        case 'collectInput': {
          const id = nextNodeId('input', step.inputVarName || step.target);
          const targetVar = (step.inputVarName || 'collectedDigits').replace(/^(?:Flow|Task)\./i, '');
          markVarUsed(targetVar, id);
          pushStepFindings(id);

          const retryVarName = `retryCount_${cleanSlug(targetVar, 'input')}`;
          registerVar(
            retryVarName,
            retryVarName,
            'task',
            'task',
            'integer',
            0,
            ownerTaskRefId,
            step.lineNumber || 1,
            trace.section,
            'derived',
            'collectInputRetryLimit'
          );

          nodes.push({
            id,
            kind: 'collectInput',
            name: step.label || `Collect Input ${targetVar}`,
            terminal: false,
            parameters: {
              prompt: step.targetSlug || step.target || 'DTMF_Input',
              ttsText: step.ttsText,
              targetVariable: targetVar,
              digitSpec: step.digitSpec || { mode: 'exact', exact: 1 },
              noEntryTimeoutSec: step.noEntryTimeoutSec ?? 5,
              interDigitTimeoutSec: step.interDigitTimeoutSec ?? 3,
              terminatingCharacter: step.terminatingCharacter,
              retryCounterVariable: retryVarName,
              maxRetries: 3,
            },
            outputs: [{ name: 'collectedDigits', targetVariable: targetVar }],
            sourceTrace: trace,
            ...buildCommentFields(),
          });
          linkFromPending(id);

          const succRes = convertStepList(step.successSteps || [], trace.section || sectionName, ownerTaskRefId);
          const failRes = convertStepList(step.failureSteps || [], trace.section || sectionName, ownerTaskRefId);

          const nextExits: Array<{ nodeId: string; type: FlowIRTransitionType; matchValue?: string }> = [];
          if (succRes.firstId) {
            transitions.push({ from: id, to: succRes.firstId, type: 'success' });
            nextExits.push(...succRes.openExits);
          } else {
            nextExits.push({ nodeId: id, type: 'success' });
          }
          if (failRes.firstId) {
            transitions.push({ from: id, to: failRes.firstId, type: 'timeout' });
            transitions.push({ from: id, to: failRes.firstId, type: 'noMatch' });
            const curNode = nodes[nodes.length - 1];
            if (curNode && curNode.id === id) {
              curNode.errorHandling = { onError: failRes.firstId, onTimeout: failRes.firstId };
            }
            nextExits.push(...failRes.openExits);
          }
          pendingExits = nextExits;
          break;
        }

        case 'callDataAction':
        case 'callDataTableLookup': {
          const isTable = step.kind === 'callDataTableLookup';
          const actionSlug = step.targetSlug || cleanSlug(step.target || 'DataAction', 'DataAction');
          dataActionsSet.add(actionSlug);
          const id = nextNodeId('da', actionSlug);
          pushStepFindings(id);

          const inputs: FlowIRInputBinding[] = isTable
            ? [{ name: 'lookupKey', expr: stripScopesFromExpr(step.dataTableKey || 'Call.Dnis') }]
            : (step.dataActionInputs || [{ name: 'callerAni', expr: 'Call.Ani' }]).map((inp) => ({
                name: inp.name,
                expr: stripScopesFromExpr(inp.expr),
              }));

          inputs.forEach((inp) =>
            extractReferencedVarNamesFromExpr(inp.expr).forEach((vn) => markVarUsed(vn, id))
          );

          const outputs: FlowIROutputBinding[] = (step.dataActionOutputs || []).map((om) => {
            const cleanTarget = om.targetVarName.replace(/^(?:Flow|Task)\./i, '');
            markVarUsed(cleanTarget, id);
            if (step.avayaCommand === 'RESOLVED_HOLIDAY_DB_LOOKUP') {
              const tv = varByLower.get(cleanTarget.toLowerCase());
              if (tv && tv.provenance !== 'system_context') {
                tv.provenance = 'resolved_external_lookup';
              }
            }
            return {
              name: om.field,
              targetVariable: cleanTarget,
            };
          });

          const integrationType: FlowIRIntegrationSpec['type'] =
            isTable ||
            step.dataActionCategory === 'Oracle_Integration' ||
            step.dataActionCategory === 'Holiday_Service' ||
            step.dataActionCategory === 'External_Holiday_Integration'
              ? 'dbLookup'
              : step.dataActionCategory === 'FlixCheck_API'
              ? 'webservice'
              : 'api';

          const daNode: FlowIRNode = {
            id,
            kind: 'dataAction',
            name: step.label || actionSlug,
            terminal: false,
            parameters: {
              isDataTable: isTable,
              ...(step.dataTableKey ? { lookupKey: stripScopesFromExpr(step.dataTableKey) } : {}),
            },
            sourceTrace: trace,
            integration: {
              type: integrationType,
              sourceSystem: 'avaya',
              targetAction: actionSlug,
              category: isTable ? 'Genesys_Data_Tables' : step.dataActionCategory || 'Oracle_Integration',
            },
            inputs,
            outputs,
            errorHandling: {},
            ...buildCommentFields(),
          };
          nodes.push(daNode);
          linkFromPending(id);

          const okSteps = isTable ? step.foundSteps || [] : step.successSteps || [];
          const errSteps = isTable ? step.notFoundSteps || [] : step.failureSteps || [];
          const toSteps = isTable ? [] : step.timeoutSteps || [];

          const okRes = convertStepList(okSteps, trace.section || sectionName, ownerTaskRefId);
          const errRes = convertStepList(errSteps, trace.section || sectionName, ownerTaskRefId);
          const toRes = convertStepList(toSteps, trace.section || sectionName, ownerTaskRefId);

          const nextExits: Array<{ nodeId: string; type: FlowIRTransitionType; matchValue?: string }> = [];
          if (okRes.firstId) {
            transitions.push({ from: id, to: okRes.firstId, type: 'success' });
            nextExits.push(...okRes.openExits);
          } else {
            nextExits.push({ nodeId: id, type: 'success' });
          }
          if (errRes.firstId) {
            transitions.push({ from: id, to: errRes.firstId, type: 'failure' });
            daNode.errorHandling!.onError = errRes.firstId;
            if (isTable) {
              // DataTable lookup has no separate timeout output in Architect; notFound handles miss cleanly
              daNode.errorHandling!.onTimeout = errRes.firstId;
            }
            nextExits.push(...errRes.openExits);
          } else if (isTable) {
            nextExits.push({ nodeId: id, type: 'failure' });
          }
          if (toRes.firstId) {
            transitions.push({ from: id, to: toRes.firstId, type: 'timeout' });
            daNode.errorHandling!.onTimeout = toRes.firstId;
            nextExits.push(...toRes.openExits);
          } else if (!isTable && errRes.firstId) {
            transitions.push({ from: id, to: errRes.firstId, type: 'timeout' });
            daNode.errorHandling!.onTimeout = errRes.firstId;
          }
          pendingExits = nextExits;
          break;
        }

        case 'callTask': {
          const targetName = step.targetTaskRefId || step.targetSlug || step.target || 'SubTask';
          subflowsSet.add(targetName);
          const id = nextNodeId('sub', targetName);
          pushStepFindings(id);
          const isUnloaded =
            missingSubflowsSet.has(targetName.toLowerCase()) ||
            missingSubflowsSet.has((step.target || '').toLowerCase());
          const targetTaskObj = taskMap.get(targetName);
          const hasDeclaredTarget = Boolean(targetTaskObj);
          const isProvablyTerm = Boolean(
            targetTaskObj &&
              !isUnloaded &&
              targetTaskObj.steps.length > 0 &&
              targetTaskObj.steps[targetTaskObj.steps.length - 1]?.isTerminal
          );
          nodes.push({
            id,
            kind: 'invokeSubflow',
            name: targetName,
            terminal: false,
            terminalityEvidence: isUnloaded
              ? 'unproven_external'
              : isProvablyTerm
              ? 'proven_source'
              : 'non_terminal',
            parameters: {
              target: targetName,
              originalTarget: step.target || targetName,
              ...(step.targetTaskRefId && !hasDeclaredTarget ? { unresolvedTaskRef: true } : {}),
            },
            sourceTrace: trace,
            ...buildCommentFields(),
          });
          linkFromPending(id);
          pendingExits = [{ nodeId: id, type: 'unconditional' }];
          break;
        }

        case 'callCommonModule': {
          const modName = step.targetSlug || step.target || 'CommonModule';
          commonModulesSet.add(modName);
          const id = nextNodeId('cm', modName);
          pushStepFindings(id);
          nodes.push({
            id,
            kind: 'invokeCommonModule',
            name: modName,
            terminal: false,
            terminalityEvidence: 'unproven_external',
            parameters: {
              moduleName: modName,
              originalTarget: step.target || modName,
            },
            sourceTrace: trace,
            ...buildCommentFields(),
          });
          linkFromPending(id);
          pendingExits = [{ nodeId: id, type: 'unconditional' }];
          break;
        }

        case 'transferToAcd':
        case 'transferToNumber':
        case 'transferToVoicemail': {
          const id = nextNodeId('xfer', step.targetSlug || step.target);
          pushStepFindings(id);
          const resolvedType: FlowIRTransferTargetType =
            step.resolvedTargetType ||
            (step.kind === 'transferToNumber'
              ? step.normalizedE164
                ? 'externalNumber'
                : 'unresolved'
              : 'queue');

          nodes.push({
            id,
            kind: 'transfer',
            actionType: step.kind,
            name: step.label || `Transfer ${step.target || ''}`,
            terminal: true,
            resolvedTargetType: resolvedType,
            parameters: {
              target: step.normalizedE164 || step.targetSlug || step.target || '',
              ...(step.originalTransferTarget ? { originalTarget: step.originalTransferTarget } : {}),
              ...(step.skills && step.skills.length > 0 ? { skills: step.skills } : {}),
              ...(step.isMultiSkillset ? { isMultiSkillset: true } : {}),
              ...(step.normalizationNote ? { normalizationNote: step.normalizationNote } : {}),
            },
            sourceTrace: trace,
            ...buildCommentFields(),
          });
          linkFromPending(id);
          connectToTerminalEnd(id);
          return { firstId, openExits: [] };
        }

        case 'disconnect': {
          const id = nextNodeId('disc', step.target || 'disconnect');
          pushStepFindings(id);
          nodes.push({
            id,
            kind: 'disconnect',
            actionType: 'disconnect',
            name: step.label || 'Disconnect Call',
            terminal: true,
            terminalityEvidence: step.terminalityEvidence || 'explicit_command',
            parameters: {
              reason: step.target || (step.avayaCommand === 'GIVE BUSY' ? 'busy' : 'normal'),
            },
            sourceTrace: trace,
            ...buildCommentFields(),
          });
          linkFromPending(id);
          connectToTerminalEnd(id);
          return { firstId, openExits: [] };
        }

        case 'loop': {
          const id = nextNodeId('loop', step.targetSlug || step.target);
          pushStepFindings(id);
          if (step.currentIndexVarName) markVarUsed(step.currentIndexVarName, id);
          nodes.push({
            id,
            kind: 'action',
            actionType: 'loop',
            name: step.label || `Loop ${step.target || ''}`,
            terminal: false,
            parameters: {
              maxLoopCount: step.maxLoopCount ?? 5,
              currentIndexVariable: step.currentIndexVarName,
              isBackwardGoto: Boolean(step.isBackwardGoto),
            },
            sourceTrace: trace,
            ...buildCommentFields(),
          });
          linkFromPending(id);
          pendingExits = [{ nodeId: id, type: 'unconditional' }];
          break;
        }

        default: {
          // playAudio, updateData, setParticipantData, getParticipantData, playHoldMusic, delay, setPriority, setLanguage, setUuiData, createCallback, menu
          const id = nextNodeId('act', step.targetSlug || step.variableName || step.kind);
          pushStepFindings(id);
          const unscopedVar = step.variableName?.replace(/^(?:Flow|Task)\./i, '');
          const unscopedExpr = step.expressionValue ? stripScopesFromExpr(step.expressionValue) : undefined;
          if (unscopedVar) markVarUsed(unscopedVar, id);
          if (unscopedExpr) {
            extractReferencedVarNamesFromExpr(unscopedExpr).forEach((vn) => markVarUsed(vn, id));
          }

          const actionType =
            step.kind === 'updateData'
              ? 'assignment'
              : step.kind === 'playAudio'
              ? 'playAudio'
              : step.kind;

          if (step.kind === 'updateData' && unscopedVar) {
            const tv = varByLower.get(unscopedVar.toLowerCase());
            if (tv && tv.provenance !== 'system_context') {
              if (
                step.avayaCommand === 'SET_HOLIDAY_FLAG_TRUE' ||
                step.avayaCommand === 'SET_HOLIDAY_FLAG_FALSE' ||
                step.avayaCommand === 'HOLIDAY_LOOKUP_FAIL_OPEN' ||
                step.avayaCommand === 'HOLIDAY_LOOKUP_TIMEOUT_OPEN'
              ) {
                tv.provenance = 'resolved_external_lookup';
              } else if (tv.provenance !== 'resolved_external_lookup') {
                tv.provenance =
                  step.avayaCommand === 'SET_LOOKUP_MATCH' || step.avayaCommand === 'SET_LOOKUP_NOMATCH'
                    ? 'stub_synthesized'
                    : 'avaya_assigned';
              }
            }
          } else if (step.kind === 'getParticipantData' && unscopedVar) {
            const tv = varByLower.get(unscopedVar.toLowerCase());
            if (tv && tv.provenance === 'unproven') {
              tv.provenance =
                step.avayaCommand === 'DATA_PROVENANCE_READ' ? 'stub_synthesized' : 'avaya_assigned';
            }
          }

          nodes.push({
            id,
            kind: 'action',
            actionType,
            name: step.label || step.kind,
            terminal: Boolean(step.isTerminal),
            terminalityEvidence: step.isTerminal ? 'explicit_command' : 'non_terminal',
            parameters: {
              ...(unscopedVar ? { targetVariable: unscopedVar } : {}),
              ...(unscopedExpr !== undefined ? { expr: unscopedExpr } : {}),
              ...(step.literalValue !== undefined ? { literalValue: step.literalValue } : {}),
              ...(step.ttsText ? { ttsText: step.ttsText } : {}),
              ...(step.targetSlug ? { target: step.targetSlug } : step.target ? { target: step.target } : {}),
              ...(step.priorityValue !== undefined ? { priority: step.priorityValue } : {}),
              ...(step.delaySeconds !== undefined ? { delaySeconds: step.delaySeconds } : {}),
              ...(step.languageCode ? { language: step.languageCode } : {}),
            },
            ...(step.kind === 'updateData' || step.kind === 'getParticipantData'
              ? {
                  outputs: unscopedVar
                    ? [{ name: step.kind === 'getParticipantData' ? unscopedVar : 'value', targetVariable: unscopedVar }]
                    : undefined,
                }
              : {}),
            sourceTrace: trace,
            ...buildCommentFields(),
          });
          linkFromPending(id);
          if (step.isTerminal) {
            connectToTerminalEnd(id);
            return { firstId, openExits: [] };
          }
          pendingExits = [{ nodeId: id, type: 'unconditional' }];
          break;
        }
      }
    }

    return { firstId, openExits: pendingExits };
  };

  // Build secondary/reusable tasks first so jumpToReusableTask can target their entry nodes
  const entryTask =
    graph.tasks.find((t) => t.refId === graph.entryTaskRefId) || graph.tasks[0];

  const collectSubscriptProvenanceFindings = (list: MigrationStep[], sectionLabel: string) => {
    for (const st of list) {
      const subFindings = [
        ...(st.provenanceFinding ? [st.provenanceFinding] : []),
        ...(st.additionalFindings || []),
      ];
      for (const sf of subFindings) {
        preFindings.push({
          severity: sf.severity,
          code: sf.code,
          message: sf.message,
          variableName: sf.variableName,
          sourceTrace: {
            script: scriptName,
            section: st.sectionHint || sectionLabel,
            lineStart: Math.max(1, st.lineNumber || 1),
            lineEnd: Math.max(1, st.lineNumber || 1),
          },
        });
      }
      if (st.yesSteps) collectSubscriptProvenanceFindings(st.yesSteps, sectionLabel);
      if (st.noSteps) collectSubscriptProvenanceFindings(st.noSteps, sectionLabel);
      if (st.openSteps) collectSubscriptProvenanceFindings(st.openSteps, sectionLabel);
      if (st.closedSteps) collectSubscriptProvenanceFindings(st.closedSteps, sectionLabel);
      if (st.holidaySteps) collectSubscriptProvenanceFindings(st.holidaySteps, sectionLabel);
      if (st.successSteps) collectSubscriptProvenanceFindings(st.successSteps, sectionLabel);
      if (st.failureSteps) collectSubscriptProvenanceFindings(st.failureSteps, sectionLabel);
      if (st.timeoutSteps) collectSubscriptProvenanceFindings(st.timeoutSteps, sectionLabel);
      if (st.foundSteps) collectSubscriptProvenanceFindings(st.foundSteps, sectionLabel);
      if (st.notFoundSteps) collectSubscriptProvenanceFindings(st.notFoundSteps, sectionLabel);
      if (st.bodySteps) collectSubscriptProvenanceFindings(st.bodySteps, sectionLabel);
      if (st.defaultSteps) collectSubscriptProvenanceFindings(st.defaultSteps, sectionLabel);
      if (st.cases) st.cases.forEach((c) => collectSubscriptProvenanceFindings(c.steps, sectionLabel));
    }
  };

  for (const t of graph.tasks) {
    if (!entryTask || t.refId === entryTask.refId) continue;
    // Skip subscript tasks in main flow graph transitions (they are represented via invokeSubflow dependencies),
    // but still surface any provenance findings (e.g. SWITCH_WITHOUT_SOURCE in CHECK_RESPONSE) into flowIR.findings!
    if (t.kind === 'subscript') {
      collectSubscriptProvenanceFindings(t.steps, t.originalTarget || t.refId);
      continue;
    }
    const subRes = convertStepList(t.steps, t.originalTarget || t.refId, t.refId);
    if (subRes.firstId) {
      taskEntryIdMap.set(t.refId, subRes.firstId);
      for (const ex of subRes.openExits) {
        endNodeUsed = true;
        transitions.push({
          from: ex.nodeId,
          to: endNodeId,
          type: ex.type === 'unconditional' ? 'terminal' : ex.type,
          ...(ex.matchValue !== undefined ? { matchValue: ex.matchValue } : {}),
        });
      }
    }
  }

  // Build Entry Task
  if (entryTask) {
    const mainRes = convertStepList(
      entryTask.steps,
      entryTask.originalTarget || entryTask.refId,
      entryTask.refId
    );
    if (mainRes.firstId) {
      transitions.push({ from: entryNodeId, to: mainRes.firstId, type: 'unconditional' });
    } else {
      endNodeUsed = true;
      transitions.push({ from: entryNodeId, to: endNodeId, type: 'terminal' });
    }
    for (const ex of mainRes.openExits) {
      endNodeUsed = true;
      transitions.push({
        from: ex.nodeId,
        to: endNodeId,
        type: ex.type === 'unconditional' ? 'terminal' : ex.type,
        ...(ex.matchValue !== undefined ? { matchValue: ex.matchValue } : {}),
      });
    }
  } else {
    endNodeUsed = true;
    transitions.push({ from: entryNodeId, to: endNodeId, type: 'terminal' });
  }

  if (endNodeUsed) {
    nodes.push({
      id: endNodeId,
      kind: 'terminal',
      name: 'End',
      terminal: true,
      parameters: {},
      sourceTrace: {
        script: scriptName,
        section: entryTask?.originalTarget || 'Main_Task',
        lineStart: 1,
        lineEnd: 1,
      },
    });
  }

  // Missing subflow source findings (transparently flag unloaded Avaya sub-blocks)
  for (const missingSub of options?.missingSubflows || []) {
    preFindings.push({
      severity: 'WARN',
      code: 'MISSING_SUBFLOW_SOURCE',
      message: `Aufgerufener Baustein "${missingSub}" hat keine geladene .s-Quelldatei im Workspace — als offene Migrationsfrage markiert statt Logik zu erfinden.`,
      sourceTrace: { script: scriptName, lineStart: 1, lineEnd: 1 },
    });
  }

  // Pruned unreachable task audit trail (removed from productive Genesys YAML, documented in report/IR)
  for (const pruned of prunedUnreachableTasks) {
    preFindings.push({
      severity: 'INFO',
      code: 'UNREACHABLE_TASK_PRUNED',
      message: `Unerreichbarer Task "${pruned.refId}" (Quelle: "${pruned.originalTarget}") wurde durch Reachability-GC aus dem produktiven Genesys-YAML entfernt.`,
      sourceTrace: { script: scriptName, section: pruned.originalTarget, lineStart: 1, lineEnd: 1 },
    });
  }

  // Pass-2 WAIT classification diagnostics: source_hint WAITs & any standalone unmapped active WAIT findings
  for (const wh of graph.diagnostics.waitSourceOnlyHints || []) {
    preFindings.push({
      severity: 'INFO',
      code: 'WAIT_SOURCE_ONLY_HINT',
      warningClass: 'source_hint',
      category: 'wait_hint',
      requiresBusinessReview: false,
      message: wh.message,
      sourceTrace: {
        script: scriptName,
        section: wh.section,
        lineStart: Math.max(1, wh.lineNumber || 1),
        lineEnd: Math.max(1, wh.lineNumber || 1),
      },
    });
  }
  for (const aw of graph.diagnostics.activeWaitFindings || []) {
    preFindings.push({
      severity: 'WARN',
      code: 'WAIT_UNMAPPED_ACTIVE_PATH',
      warningClass: 'actionable_migration',
      category: 'wait_hint',
      requiresBusinessReview: true,
      message: aw.message,
      sourceTrace: {
        script: scriptName,
        section: aw.section,
        lineStart: Math.max(1, aw.lineNumber || 1),
        lineEnd: Math.max(1, aw.lineNumber || 1),
      },
    });
  }

  const ir: FlowIR = {
    meta: {
      flowId: graph.cleanName,
      sourceSystem: 'Avaya',
      targetSystem: 'Genesys',
      sourceScript: scriptName,
      entryNodeId,
      language: 'de-de',
      version: '1.1',
      compatibilityStubMode,
      ...(resolvedTargetMode ? { resolvedTargetMode: true } : {}),
      ...(resolvedTargetMode && holidayLookupTarget ? { holidayLookupTarget } : {}),
      ...(prunedUnreachableTasks.length > 0 ? { prunedUnreachableTasks } : {}),
    },
    variables,
    nodes,
    transitions,
    dependencies: {
      subflows: Array.from(subflowsSet).sort(),
      commonModules: Array.from(commonModulesSet).sort(),
      dataActions: Array.from(dataActionsSet).sort(),
    },
    findings: [],
    renderingHints: {
      genesys: {
        preferReusableTasks: true,
        preferDecisionNodes: true,
        avoidGotoStyleSections: true,
      },
    },
  };

  // Run hard validateIR(ir) and merge preFindings cleanly (deduplicated)
  const validation = validateIR(ir);
  const seenKey = new Set<string>();
  const seenVarBeforeSet = new Set<string>();
  const seenDupHoliday = new Set<string>();
  const seenDateReview = new Set<string>();
  const combined: FlowIRFinding[] = [];
  for (const f of [...preFindings, ...validation.findings]) {
    if (f.code === 'VAR_USED_BEFORE_SET' && f.variableName) {
      const varKey = `${f.variableName.toLowerCase()}:${f.sourceTrace?.lineStart || 0}`;
      if (seenVarBeforeSet.has(varKey)) continue;
      seenVarBeforeSet.add(varKey);
    }
    if (f.code === 'DUPLICATE_HOLIDAY_LOGIC') {
      const holKey = `${f.sourceTrace?.lineStart || 0}`;
      if (seenDupHoliday.has(holKey)) continue;
      seenDupHoliday.add(holKey);
    }
    if (f.code === 'DATE_COMPARISON_SEMANTIC_REVIEW') {
      const dateKey = `${f.variableName?.toLowerCase() || ''}:${f.sourceTrace?.lineStart || 0}`;
      if (seenDateReview.has(dateKey)) continue;
      seenDateReview.add(dateKey);
    }
    const key = `${f.code}:${f.nodeId || ''}:${f.variableName || ''}:${f.message}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    const meta = classifyFlowIRFinding(f.code);
    combined.push({
      ...f,
      warningClass: normalizeWarningClass(f.warningClass || meta.warningClass),
      category: f.category || meta.category,
      requiresBusinessReview: f.requiresBusinessReview ?? meta.requiresBusinessReview,
    });
  }
  ir.findings = combined;
  return ir;
}

// ============================================================================
// HARTER IR-VALIDATOR: validateIR(ir) — alle 10 verbindlichen Findings-Codes
// ============================================================================

const DUMMY_EXPR_RE =
  /\b(?:Flow\.avayaCondition|avayaCondition|checkResult|cond_check)\s*==\s*(?:true|"true"|'true')/i;

export function validateIR(ir: FlowIR): FlowIRValidationResult {
  const findings: FlowIRFinding[] = [];
  const nodeMap = new Map<string, FlowIRNode>();
  const varMap = new Map<string, FlowIRVariable>();

  const flowVarNames = new Set<string>();
  const taskVarNames = new Set<string>();
  for (const v of ir.variables || []) {
    const lower = v.name.toLowerCase();
    varMap.set(lower, v);
    if (v.scope === 'flow') {
      flowVarNames.add(lower);
    } else if (v.scope === 'task') {
      taskVarNames.add(lower);
    }
  }

  // Scope uniqueness invariant: detect shadow declarations across Flow and Task scopes
  for (const tVarName of taskVarNames) {
    if (flowVarNames.has(tVarName)) {
      const vObj = varMap.get(tVarName);
      findings.push({
        severity: 'WARN',
        code: 'DUPLICATE_VARIABLE_SCOPE',
        variableName: vObj?.name || tVarName,
        message: `Variable "${vObj?.name || tVarName}" ist sowohl im Flow- als auch im Task-Scope modelliert — direkte Flow.*-Wiederverwendung ohne Task-Kopie bevorzugen.`,
        sourceTrace: vObj?.sourceTrace,
      });
    }
  }

  // 1. Entry Node Check (exact 1 entry node)
  const entryNodes: FlowIRNode[] = [];
  for (const n of ir.nodes || []) {
    nodeMap.set(n.id, n);
    if (n.kind === 'entry') entryNodes.push(n);
  }

  if (entryNodes.length !== 1 || !nodeMap.has(ir.meta?.entryNodeId)) {
    findings.push({
      severity: 'ERROR',
      code: 'INVALID_ENTRY_NODE',
      message: `FlowIR benötigt exakt einen Entry-Knoten (gefunden: ${entryNodes.length}, meta.entryNodeId="${ir.meta?.entryNodeId || ''}").`,
    });
  }

  // Build adjacency lists & check broken transition refs
  const outgoing = new Map<string, FlowIRTransition[]>();
  const incoming = new Map<string, FlowIRTransition[]>();
  for (const n of ir.nodes || []) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }

  for (const tr of ir.transitions || []) {
    const fromNode = nodeMap.get(tr.from);
    const toNode = nodeMap.get(tr.to);
    if (!fromNode || !toNode) {
      findings.push({
        severity: 'ERROR',
        code: 'BROKEN_TRANSITION_REF',
        message: `Transition referenziert unbekannten Knoten (from="${tr.from}", to="${tr.to}").`,
        nodeId: fromNode ? tr.from : undefined,
        sourceTrace: fromNode?.sourceTrace,
      });
      continue;
    }
    outgoing.get(tr.from)!.push(tr);
    incoming.get(tr.to)!.push(tr);
  }

  // 2. Reachability & Path-Sensitive Variable-Write Analysis from Entry
  const reachable = new Set<string>();
  // Track variables guaranteed to be written before reaching node (via BFS union of writes on paths)
  const writtenBeforeNode = new Map<string, Set<string>>();

  const getWritesOfNode = (n: FlowIRNode): string[] => {
    const writes: string[] = [];
    if (n.outputs) {
      for (const o of n.outputs) {
        if (o.targetVariable) writes.push(o.targetVariable.replace(/^(?:Flow|Task)\./i, '').toLowerCase());
      }
    }
    const paramTarget = n.parameters?.targetVariable;
    if (
      typeof paramTarget === 'string' &&
      (n.kind === 'collectInput' ||
        n.actionType === 'assignment' ||
        n.actionType === 'getParticipantData' ||
        n.actionType === 'updateData')
    ) {
      writes.push(paramTarget.replace(/^(?:Flow|Task)\./i, '').toLowerCase());
    }
    return writes;
  };

  if (ir.meta?.entryNodeId && nodeMap.has(ir.meta.entryNodeId)) {
    const initialWritten = new Set<string>();
    // Pre-seeded metadata/system variables or variables with explicit non-empty Avaya initial values
    for (const v of ir.variables || []) {
      if (v.source?.origin === 'system' || v.category === 'metadata') {
        initialWritten.add(v.name.toLowerCase());
      } else if (
        v.type === 'string' &&
        typeof v.initialValue === 'string' &&
        v.initialValue.trim().length > 0
      ) {
        initialWritten.add(v.name.toLowerCase());
      }
    }

    const queue: Array<{ nodeId: string; written: Set<string> }> = [
      { nodeId: ir.meta.entryNodeId, written: initialWritten },
    ];
    let guardSteps = 0;

    while (queue.length > 0 && guardSteps < 5000) {
      guardSteps += 1;
      const { nodeId, written } = queue.shift()!;
      reachable.add(nodeId);

      const prevSet = writtenBeforeNode.get(nodeId);
      if (!prevSet) {
        writtenBeforeNode.set(nodeId, new Set(written));
      } else {
        // Check if any new written vars arrived
        let changed = false;
        for (const w of written) {
          if (!prevSet.has(w)) {
            prevSet.add(w);
            changed = true;
          }
        }
        if (!changed) continue;
      }

      const node = nodeMap.get(nodeId)!;
      const afterNode = new Set(written);
      for (const w of getWritesOfNode(node)) {
        afterNode.add(w);
      }

      for (const tr of outgoing.get(nodeId) || []) {
        queue.push({ nodeId: tr.to, written: afterNode });
      }
    }
  }

  // Track which variables are actually read downstream (for UNRESOLVED_INTEGRATION_OUTPUT)
  const allReadVars = new Set<string>();
  for (const n of ir.nodes || []) {
    if (n.condition?.expr) {
      extractReferencedVarNamesFromExpr(n.condition.expr).forEach((v) =>
        allReadVars.add(v.toLowerCase())
      );
    }
    if (n.expression?.expr) {
      extractReferencedVarNamesFromExpr(n.expression.expr).forEach((v) =>
        allReadVars.add(v.toLowerCase())
      );
    }
    if (n.inputs) {
      for (const inp of n.inputs) {
        extractReferencedVarNamesFromExpr(inp.expr).forEach((v) =>
          allReadVars.add(v.toLowerCase())
        );
      }
    }
    if (typeof n.parameters?.expr === 'string') {
      extractReferencedVarNamesFromExpr(n.parameters.expr).forEach((v) =>
        allReadVars.add(v.toLowerCase())
      );
    }
  }

  // 3. Per-Node Validation Rules (all 10 binding Findings-Codes + structural invariants)
  let terminalNodeCount = 0;
  let decisionCount = 0;
  let switchCount = 0;
  let integrationCount = 0;

  for (const node of ir.nodes || []) {
    const outs = outgoing.get(node.id) || [];
    const writtenSet = writtenBeforeNode.get(node.id) || new Set<string>();

    if (node.terminal || node.kind === 'terminal') {
      terminalNodeCount += 1;
    }

    // Reachability check
    if (reachable.size > 0 && !reachable.has(node.id)) {
      findings.push({
        severity: 'WARN',
        code: 'UNREACHABLE_NODE',
        message: `Knoten "${node.name}" (${node.id}) ist ab "${ir.meta.entryNodeId}" nicht erreichbar.`,
        nodeId: node.id,
        sourceTrace: node.sourceTrace,
      });
    }

    // Rule: SECTION_RENDERED_BLINDLY (Avaya Section_* blindly kept as invokeSubflow/action target)
    if (
      (node.kind === 'invokeSubflow' || node.kind === 'action') &&
      /^Section_/i.test(String(node.parameters?.target || node.name || ''))
    ) {
      findings.push({
        severity: 'WARN',
        code: 'SECTION_RENDERED_BLINDLY',
        message: `Avaya-Abschnitt "${node.parameters?.target || node.name}" wurde 1:1 als Zielsprung übernommen statt graphbasiert aufgelöst.`,
        nodeId: node.id,
        sourceTrace: node.sourceTrace,
      });
    }

    // Rule: terminal node must have 0 outgoing transitions
    if (node.kind === 'terminal' && outs.length > 0) {
      findings.push({
        severity: 'ERROR',
        code: 'TERMINAL_HAS_OUTGOING',
        message: `Terminal-Knoten "${node.name}" (${node.id}) besitzt ${outs.length} ausgehende Kante(n).`,
        nodeId: node.id,
        sourceTrace: node.sourceTrace,
      });
    }

    // Rule: TERMINAL_PATH_CONTINUES (disconnect / terminal transfer must not continue into non-terminal business nodes)
    if (node.terminal && node.kind !== 'terminal') {
      const invalidContinuations = outs.filter((tr) => {
        const target = nodeMap.get(tr.to);
        return tr.type !== 'terminal' || (target && target.kind !== 'terminal');
      });
      if (invalidContinuations.length > 0) {
        findings.push({
          severity: 'ERROR',
          code: 'TERMINAL_PATH_CONTINUES',
          message: `Nach terminalem Knoten "${node.name}" (${node.kind}) folgt ein weiterer fachlicher Pfad (${invalidContinuations.map((c) => c.to).join(', ')}).`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      }
    }

    // Rule: Decision checks
    if (node.kind === 'decision') {
      decisionCount += 1;
      const expr = (node.condition?.expr || '').trim();
      const hasTrue = outs.some((tr) => tr.type === 'whenTrue');
      const hasFalse = outs.some((tr) => tr.type === 'whenFalse');

      if (!hasTrue && !hasFalse) {
        findings.push({
          severity: 'ERROR',
          code: 'EMPTY_BRANCH',
          message: `Decision "${node.name}" besitzt weder whenTrue- noch whenFalse-Transition.`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      } else if (!hasTrue || !hasFalse) {
        findings.push({
          severity: 'WARN',
          code: 'EMPTY_BRANCH',
          message: `Decision "${node.name}" hat einen leeren Branch (${!hasTrue ? 'whenTrue' : 'whenFalse'} fehlt).`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      }

      if (!expr || DUMMY_EXPR_RE.test(expr) || node.parameters?.isFallbackFlag === true) {
        findings.push({
          severity: 'WARN',
          code: 'DUMMY_CONDITION',
          message: `Decision "${node.name}" nutzt eine Platzhalterbedingung ("${expr || 'leer'}") ohne belastbare Quelle.`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
        findings.push({
          severity: 'WARN',
          code: 'MISSING_CONDITION_SOURCE',
          message: `Fehlende fachliche Bedingungsquelle in Decision "${node.name}".`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      } else {
        const vars = extractReferencedVarNamesFromExpr(expr);
        for (const vName of vars) {
          const lower = vName.toLowerCase();
          if (!varMap.has(lower)) {
            findings.push({
              severity: 'WARN',
              code: 'VARIABLE_UNDECLARED',
              message: `Variable "${vName}" wird in Decision "${node.name}" geprüft, ist aber nicht in flowIR.variables definiert.`,
              nodeId: node.id,
              variableName: vName,
              sourceTrace: node.sourceTrace,
            });
          } else if (!writtenSet.has(lower)) {
            findings.push({
              severity: 'WARN',
              code: 'VAR_USED_BEFORE_SET',
              message: `Variable "${vName}" wird in Decision "${node.name}" geprüft, aber vorher im Pfad nicht gesetzt.`,
              nodeId: node.id,
              variableName: vName,
              sourceTrace: node.sourceTrace,
            });
          }
        }

        // Semantic DateTime vs. String/List review check (preserved verbatim, flagged for review)
        if (
          /\b(?:GetCurrentDateTimeUtc|DayOfWeek)\s*\(/.test(expr) &&
          /(?:==|!=)/.test(expr)
        ) {
          for (const vName of vars) {
            const vDecl = varMap.get(vName.toLowerCase());
            const isStringOrList =
              vDecl?.type === 'string' ||
              /(?:list|liste|table|tabelle|holiday|feiertag)/i.test(vName);
            if (isStringOrList) {
              findings.push({
                severity: 'WARN',
                code: 'DATE_COMPARISON_SEMANTIC_REVIEW',
                category: 'expression_review',
                requiresBusinessReview: true,
                variableName: vName,
                nodeId: node.id,
                sourceTrace: node.sourceTrace,
                message: `Semantische Datumsprüfung erforderlich (Zeile ${node.sourceTrace?.lineStart || 1}): Decision "${node.name}" vergleicht Zeit-/Datumswert mit "${vName}" ("${expr}"). Für Auditierbarkeit unverändert übernommen; erfordert vor produktivem Architect-Import manuelle Normalisierung.`,
              });
            }
          }
        }
      }
    }

    // Rule: Switch checks
    if (node.kind === 'switch') {
      switchCount += 1;
      const expr = (node.expression?.expr || '').trim();
      const hasCase = outs.some((tr) => tr.type === 'case');
      const hasDefault = outs.some((tr) => tr.type === 'default');

      if (!hasCase && !hasDefault) {
        findings.push({
          severity: 'ERROR',
          code: 'EMPTY_BRANCH',
          message: `Switch "${node.name}" besitzt weder Case- noch Default-Transition.`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      }

      if (!expr) {
        findings.push({
          severity: 'ERROR',
          code: 'SWITCH_WITHOUT_SOURCE',
          message: `Switch "${node.name}" besitzt keine Eingangsvariable.`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      } else {
        const vars = extractReferencedVarNamesFromExpr(expr);
        for (const vName of vars) {
          const lower = vName.toLowerCase();
          if (!varMap.has(lower)) {
            findings.push({
              severity: 'WARN',
              code: 'SWITCH_WITHOUT_SOURCE',
              message: `Switch "${node.name}" wertet undeklarierte Variable "${vName}" ohne Herkunft aus.`,
              nodeId: node.id,
              variableName: vName,
              sourceTrace: node.sourceTrace,
            });
          } else if (!writtenSet.has(lower)) {
            findings.push({
              severity: 'WARN',
              code: 'SWITCH_WITHOUT_SOURCE',
              message: `Switch "${node.name}" wertet Variable "${vName}" aus, deren Quelle vorher im Pfad nicht gesetzt wurde.`,
              nodeId: node.id,
              variableName: vName,
              sourceTrace: node.sourceTrace,
            });
            findings.push({
              severity: 'WARN',
              code: 'VAR_USED_BEFORE_SET',
              message: `Variable "${vName}" wird im Switch "${node.name}" verwendet, bevor sie befüllt wurde.`,
              nodeId: node.id,
              variableName: vName,
              sourceTrace: node.sourceTrace,
            });
          }
        }
      }
    }

    // Rule: DataAction / Integration checks
    if (node.kind === 'dataAction') {
      integrationCount += 1;
      const isDataTable = node.parameters?.isDataTable === true;
      const hasFailure =
        Boolean(node.errorHandling?.onError) || outs.some((tr) => tr.type === 'failure');
      const hasTimeout =
        Boolean(node.errorHandling?.onTimeout) || outs.some((tr) => tr.type === 'timeout');

      if (!hasFailure) {
        findings.push({
          severity: 'WARN',
          code: 'MISSING_ERROR_PATH',
          message: `Integrationsknoten "${node.name}" besitzt keinen Fehlerpfad (onError / failure-Transition).`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      }

      if (!isDataTable && !hasTimeout) {
        findings.push({
          severity: 'WARN',
          code: 'MISSING_TIMEOUT_PATH',
          message: `Integrationsknoten "${node.name}" besitzt keinen Timeout-/Fallback-Pfad (onTimeout / timeout-Transition).`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      }

      if (!node.outputs || node.outputs.length === 0) {
        findings.push({
          severity: 'WARN',
          code: 'UNRESOLVED_INTEGRATION_OUTPUT',
          message: `Integrationsknoten "${node.name}" mappt keinen Rückgabewert (outputs leer).`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      } else {
        const anyUsed = node.outputs.some((o) =>
          allReadVars.has(o.targetVariable.replace(/^(?:Flow|Task)\./i, '').toLowerCase())
        );
        if (!anyUsed) {
          findings.push({
            severity: 'INFO',
            code: 'UNRESOLVED_INTEGRATION_OUTPUT',
            message: `Output(s) von "${node.name}" (${node.outputs.map((o) => o.targetVariable).join(', ')}) werden im Flow nicht weiter ausgewertet.`,
            nodeId: node.id,
            sourceTrace: node.sourceTrace,
          });
        }
      }
    }

    // Rule: CollectInput checks
    if (node.kind === 'collectInput') {
      const hasTimeoutOrFail =
        Boolean(node.errorHandling?.onTimeout) ||
        outs.some((tr) => tr.type === 'timeout' || tr.type === 'failure');
      if (!hasTimeoutOrFail) {
        findings.push({
          severity: 'WARN',
          code: 'MISSING_TIMEOUT_PATH',
          message: `CollectInput "${node.name}" besitzt keinen Timeout-/Fallback-Pfad.`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      }
    }

    // Rule: ScheduleCheck empty branch check
    if (node.kind === 'scheduleCheck') {
      const hasOpen = outs.some((tr) => tr.type === 'open');
      const hasClosed = outs.some((tr) => tr.type === 'closed');
      if (!hasOpen || !hasClosed) {
        findings.push({
          severity: 'WARN',
          code: 'EMPTY_BRANCH',
          message: `ScheduleCheck "${node.name}" fehlt ein expliziter ${!hasOpen ? 'open' : 'closed'}-Pfad.`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      }
    }

    // Rule: invokeSubflow unresolved task reference check
    if (node.kind === 'invokeSubflow' && node.parameters?.unresolvedTaskRef === true) {
      findings.push({
        severity: 'ERROR',
        code: 'UNRESOLVED_TASK_REF',
        message: `Subflow-Aufruf "${node.name}" verweist auf eine fehlende Task-refId.`,
        nodeId: node.id,
        sourceTrace: node.sourceTrace,
      });
    }

    // Rule: VAR_USED_BEFORE_SET in action expressions & dataAction inputs
    if (node.kind === 'action' && typeof node.parameters?.expr === 'string') {
      for (const vName of extractReferencedVarNamesFromExpr(node.parameters.expr)) {
        const lower = vName.toLowerCase();
        if (varMap.has(lower) && !writtenSet.has(lower)) {
          findings.push({
            severity: 'WARN',
            code: 'VAR_USED_BEFORE_SET',
            message: `Variable "${vName}" wird in Aktion "${node.name}" gelesen, aber vorher im Pfad nicht gesetzt.`,
            nodeId: node.id,
            variableName: vName,
            sourceTrace: node.sourceTrace,
          });
        }
      }
    }

    // Rule: Transfer resolvedTargetType check
    if (node.kind === 'transfer') {
      if (!node.resolvedTargetType || node.resolvedTargetType === 'unresolved') {
        findings.push({
          severity: 'WARN',
          code: 'UNRESOLVED_TRANSFER_TARGET',
          message: `Transfer "${node.name}" hat keinen eindeutig auflösbaren Zieltyp (resolvedTargetType="${node.resolvedTargetType || 'unresolved'}").`,
          nodeId: node.id,
          sourceTrace: node.sourceTrace,
        });
      }
    }
  }

  // Rule: Parallel Holiday Logic check at FlowIR v1.1 level
  const HOLIDAY_SIGNAL_RE = /(?:feiertag|holiday|sonderfeiertag|feiertags?liste)/i;
  const hasScheduleHoliday = (ir.nodes || []).some(
    (n) =>
      n.kind === 'scheduleCheck' &&
      (outgoing.get(n.id) || []).some(
        (tr) => tr.type === 'holiday' && nodeMap.get(tr.to)?.kind !== 'terminal'
      )
  );
  if (hasScheduleHoliday) {
    for (const n of ir.nodes || []) {
      if (n.kind !== 'decision') continue;
      const condText = `${n.condition?.expr || ''} ${n.condition?.sourceExpr || ''} ${n.name}`;
      if (HOLIDAY_SIGNAL_RE.test(condText)) {
        const resolvedMeta = n.parameters?.resolvedHolidayMetadata as
          | {
              originalVariable?: string;
              booleanVarName?: string;
              lookupTarget?: 'dataAction' | 'dataTable';
              targetName?: string;
            }
          | undefined;
        const msg = resolvedMeta
          ? `Parallele Feiertagsquellen (Zeile ${n.sourceTrace?.lineStart || 1}): Neben evaluateScheduleGroup.holiday (Basis-Feiertage der Schedule Group) prüft Decision "${n.name}" die externe Feiertags-DB via ${
              resolvedMeta.lookupTarget === 'dataTable' ? 'Data Table' : 'Data Action'
            } "${resolvedMeta.targetName || 'CheckHolidayByDate'}" -> Flow.${
              resolvedMeta.booleanVarName || 'IsExternalHolidayToday'
            } (Quelle: ${resolvedMeta.originalVariable || 'HolidayDB'}). Sofern beide dieselbe fachliche Feiertags-Bedeutung haben, ist eine Konsolidierung auf eine Single Source of Truth das bevorzugte Zielbild; parallele Beibehaltung nur bei bewusst getrennten Feiertagsarten.`
          : `Mögliche doppelte Feiertagslogik (Zeile ${n.sourceTrace?.lineStart || 1}): Neben evaluateScheduleGroup.holiday existiert Decision "${n.name}" (${n.condition?.expr || ''}). Sofern identisch gemeint, Konsolidierung auf eine Single Source of Truth bevorzugt; sonst beide Pfade fachlich differenziert beibehalten.`;
        findings.push({
          severity: 'WARN',
          code: 'DUPLICATE_HOLIDAY_LOGIC',
          message: msg,
          nodeId: n.id,
          sourceTrace: n.sourceTrace,
        });
      }
    }
  }

  const enrichedFindings: FlowIRFinding[] = findings.map((f) => {
    const meta = classifyFlowIRFinding(f.code);
    return {
      ...f,
      warningClass: normalizeWarningClass(f.warningClass || meta.warningClass),
      category: f.category || meta.category,
      requiresBusinessReview: f.requiresBusinessReview ?? meta.requiresBusinessReview,
    };
  });

  const parity = verifyFlowIRCommentParity({ ...ir, findings: enrichedFindings });
  const errorCount = enrichedFindings.filter((f) => f.severity === 'ERROR').length;
  const warningCount = enrichedFindings.filter((f) => f.severity === 'WARN').length;
  const infoCount = enrichedFindings.filter((f) => f.severity === 'INFO').length;

  return {
    isValid: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    commentParityOk: parity.isSynchronized,
    findings: enrichedFindings,
    stats: {
      nodeCount: (ir.nodes || []).length,
      transitionCount: (ir.transitions || []).length,
      variableCount: (ir.variables || []).length,
      terminalNodeCount,
      decisionCount,
      switchCount,
      integrationCount,
    },
  };
}

// ============================================================================
// RENDERER 1: renderAvayaView(ir) [modus = "avaya"]
// ============================================================================

export function renderAvayaView(ir: FlowIR): RenderedModeReport {
  const validation = validateIR(ir);
  const allFindings = ir.findings.length > 0 ? ir.findings : validation.findings;
  const modeLabel = ir.meta.compatibilityStubMode
    ? 'Kompatibilitäts-/Stub-Modus (Opt-In)'
    : ir.meta.resolvedTargetMode
    ? `Resolved Target (Holiday DB · ${
        ir.meta.holidayLookupTarget === 'dataTable' ? 'Data Table' : 'Data Action'
      })`
    : 'Ehrliche Migration (Strict Default)';

  const avayaOpenReviewItems = allFindings.filter((f) => {
    const cls = normalizeWarningClass(f.warningClass || classifyFlowIRFinding(f.code).warningClass);
    return cls === 'actionable_migration' || cls === 'semantic_review';
  });
  const avayaHintCleanupItems = allFindings.filter((f) => {
    const cls = normalizeWarningClass(f.warningClass || classifyFlowIRFinding(f.code).warningClass);
    return cls === 'source_hint' || cls === 'informational_cleanup';
  });

  const kurzfazit = `Normalisiertes Avaya-Mapping (${modeLabel}) für "${ir.meta.sourceScript}" (${ir.nodes.length} IR-Knoten, ${ir.transitions.length} Transitionen, ${ir.variables.length} scope-freie Variablen, ${avayaOpenReviewItems.length} Open Review Signals, ${avayaHintCleanupItems.length} Hints/Cleanup).`;

  const annahmenUndOffenePunkte: string[] =
    allFindings.length > 0
      ? allFindings.map((f) => {
          const cls = normalizeWarningClass(
            f.warningClass || classifyFlowIRFinding(f.code).warningClass
          );
          const traceStr = f.sourceTrace
            ? ` [${f.sourceTrace.script}${f.sourceTrace.section ? ` · ${f.sourceTrace.section}` : ''} · Z.${f.sourceTrace.lineStart}]`
            : '';
          return `[${f.severity} · ${f.code} · ${cls}] ${f.message}${traceStr}`;
        })
      : ['Keine offenen Migrationsfragen oder Struktur-Findings im Avaya-IR erkannt.'];

  const lines: string[] = [];
  lines.push('flowIR:');
  lines.push('  meta:');
  lines.push(`    flowId: "${escYaml(ir.meta.flowId)}"`);
  lines.push(`    sourceSystem: "${ir.meta.sourceSystem}"`);
  lines.push(`    targetSystem: "${ir.meta.targetSystem}"`);
  lines.push(`    sourceScript: "${escYaml(ir.meta.sourceScript)}"`);
  lines.push(`    entryNodeId: "${escYaml(ir.meta.entryNodeId)}"`);
  lines.push(`    language: "${escYaml(ir.meta.language)}"`);
  lines.push(`    version: "${ir.meta.version}"`);
  lines.push(`    compatibilityStubMode: ${ir.meta.compatibilityStubMode ? 'true' : 'false'}`);
  if (ir.meta.resolvedTargetMode) {
    lines.push('    resolvedTargetMode: true');
    if (ir.meta.holidayLookupTarget) {
      lines.push(`    holidayLookupTarget: "${ir.meta.holidayLookupTarget}"`);
    }
  }
  if (ir.meta.prunedUnreachableTasks && ir.meta.prunedUnreachableTasks.length > 0) {
    lines.push('    prunedUnreachableTasks:');
    for (const pt of ir.meta.prunedUnreachableTasks) {
      lines.push(`      - refId: "${escYaml(pt.refId)}"`);
      lines.push(`        originalTarget: "${escYaml(pt.originalTarget)}"`);
      lines.push(`        reason: "${escYaml(pt.reason)}"`);
    }
  }
  lines.push('');

  lines.push('  variables:');
  if (ir.variables.length === 0) {
    lines.push('    []');
  } else {
    for (const v of ir.variables) {
      lines.push(`    - id: "${escYaml(v.id)}"`);
      lines.push(`      name: "${escYaml(v.name)}"`);
      lines.push(`      scope: "${v.scope}"`);
      lines.push(`      category: "${v.category}"`);
      if (v.owner) lines.push(`      owner: "${escYaml(v.owner)}"`);
      lines.push(`      type: "${v.type}"`);
      lines.push(
        `      initialValue: ${
          typeof v.initialValue === 'string' ? `"${escYaml(v.initialValue)}"` : String(v.initialValue)
        }`
      );
      lines.push('      source:');
      lines.push(`        origin: "${v.source.origin}"`);
      lines.push(`        originalName: "${escYaml(v.source.originalName)}"`);
      lines.push('      sourceTrace:');
      lines.push(`        script: "${escYaml(v.sourceTrace.script)}"`);
      if (v.sourceTrace.section) lines.push(`        section: "${escYaml(v.sourceTrace.section)}"`);
      lines.push(`        lineStart: ${v.sourceTrace.lineStart}`);
      lines.push(`        lineEnd: ${v.sourceTrace.lineEnd}`);
    }
  }
  lines.push('');

  lines.push('  nodes:');
  for (const n of ir.nodes) {
    lines.push(`    - id: "${escYaml(n.id)}"`);
    lines.push(`      kind: "${n.kind}"`);
    if (n.actionType) lines.push(`      actionType: "${escYaml(n.actionType)}"`);
    lines.push(`      name: "${escYaml(n.name)}"`);
    lines.push(`      terminal: ${n.terminal ? 'true' : 'false'}`);
    if (n.resolvedTargetType) {
      lines.push(`      resolvedTargetType: "${n.resolvedTargetType}"`);
    }
    if (n.condition) {
      lines.push('      condition:');
      lines.push(`        expr: "${escYaml(n.condition.expr)}"`);
      if (n.condition.sourceExpr) {
        lines.push(`        sourceExpr: "${escYaml(n.condition.sourceExpr)}"`);
      }
    }
    if (n.expression) {
      lines.push('      expression:');
      lines.push(`        expr: "${escYaml(n.expression.expr)}"`);
      if (n.expression.sourceExpr) {
        lines.push(`        sourceExpr: "${escYaml(n.expression.sourceExpr)}"`);
      }
    }
    if (n.integration) {
      lines.push('      integration:');
      lines.push(`        type: "${n.integration.type}"`);
      lines.push(`        sourceSystem: "${n.integration.sourceSystem}"`);
      lines.push(`        targetAction: "${escYaml(n.integration.targetAction)}"`);
    }
    if (n.inputs && n.inputs.length > 0) {
      lines.push('      inputs:');
      for (const inp of n.inputs) {
        lines.push(`        - name: "${escYaml(inp.name)}"`);
        lines.push(`          expr: "${escYaml(inp.expr)}"`);
      }
    }
    if (n.outputs && n.outputs.length > 0) {
      lines.push('      outputs:');
      for (const out of n.outputs) {
        lines.push(`        - name: "${escYaml(out.name)}"`);
        lines.push(`          targetVariable: "${escYaml(out.targetVariable)}"`);
      }
    }
    if (n.errorHandling && (n.errorHandling.onError || n.errorHandling.onTimeout)) {
      lines.push('      errorHandling:');
      if (n.errorHandling.onError) lines.push(`        onError: "${escYaml(n.errorHandling.onError)}"`);
      if (n.errorHandling.onTimeout) lines.push(`        onTimeout: "${escYaml(n.errorHandling.onTimeout)}"`);
    }
    lines.push('      sourceTrace:');
    lines.push(`        script: "${escYaml(n.sourceTrace.script)}"`);
    if (n.sourceTrace.section) lines.push(`        section: "${escYaml(n.sourceTrace.section)}"`);
    lines.push(`        lineStart: ${n.sourceTrace.lineStart}`);
    lines.push(`        lineEnd: ${n.sourceTrace.lineEnd}`);
  }
  lines.push('');

  lines.push('  transitions:');
  for (const tr of ir.transitions) {
    lines.push(`    - from: "${escYaml(tr.from)}"`);
    lines.push(`      to: "${escYaml(tr.to)}"`);
    lines.push(`      type: "${tr.type}"`);
    if (tr.matchValue !== undefined) {
      lines.push(`      matchValue: "${escYaml(tr.matchValue)}"`);
    }
  }
  lines.push('');

  lines.push('  dependencies:');
  lines.push(`    subflows: [${ir.dependencies.subflows.map((s) => `"${escYaml(s)}"`).join(', ')}]`);
  lines.push(`    commonModules: [${ir.dependencies.commonModules.map((s) => `"${escYaml(s)}"`).join(', ')}]`);
  lines.push(`    dataActions: [${ir.dependencies.dataActions.map((s) => `"${escYaml(s)}"`).join(', ')}]`);

  const ergebnisText = lines.join('\n');

  const migrationshinweise: string[] = [];
  if (ir.dependencies.subflows.length > 0) {
    migrationshinweise.push(
      `Aufgerufene Subflows (${ir.dependencies.subflows.join(', ')}): Prüfen, ob als Reusable Task oder Common Module bereitgestellt.`
    );
  }
  if (ir.dependencies.commonModules.length > 0) {
    migrationshinweise.push(
      `Common Modules (${ir.dependencies.commonModules.join(', ')}): In Genesys Cloud Architect vorab anlegen und Input-/Output-Vertrag abstimmen.`
    );
  }
  if (ir.dependencies.dataActions.length > 0) {
    migrationshinweise.push(
      `Externe Integrationen / Data Tables (${ir.dependencies.dataActions.join(', ')}): Input-/Output-Contracts sowie Fehler- und Timeout-Pfade testen.`
    );
  }
  if (migrationshinweise.length === 0) {
    migrationshinweise.push(
      'Keine externen Subflow- oder API-Abhängigkeiten — direkt als kompakter Inbound Call Flow migrierbar.'
    );
  }

  const markdownReport = [
    '## 1. Kurzfazit',
    kurzfazit,
    '',
    '## 2. Annahmen / offene Punkte',
    ...annahmenUndOffenePunkte.map((x) => `- ${x}`),
    '',
    '## 3. Ergebnis (modus=avaya · kanonisches flowIR v1.1)',
    '```yaml',
    ergebnisText,
    '```',
    '',
    '## 4. Wichtigste Migrationshinweise',
    ...migrationshinweise.map((x) => `- ${x}`),
  ].join('\n');

  return {
    mode: 'avaya',
    kurzfazit,
    annahmenUndOffenePunkte,
    ergebnisText,
    migrationshinweise,
    markdownReport,
  };
}

// ============================================================================
// RENDERER 2: renderGenesysView(ir) [modus = "genesys"]
// ============================================================================

/**
 * Rendert direkt aus einem beliebigen (auch manuell erzeugten) FlowIR v1.1 ein
 * strikt regelkonformes Genesys Cloud Architect Archy YAML.
 * Wendet Flow./Task.-Scopes erst beim Rendern an und erzwingt alle 6 harten Render-Regeln.
 */
export function renderArchyYamlFromFlowIR(ir: FlowIR): string {
  const nodeMap = new Map<string, FlowIRNode>();
  const outgoing = new Map<string, FlowIRTransition[]>();
  for (const n of ir.nodes) {
    nodeMap.set(n.id, n);
    outgoing.set(n.id, []);
  }
  for (const tr of ir.transitions) {
    if (outgoing.has(tr.from)) {
      outgoing.get(tr.from)!.push(tr);
    }
  }

  const nameCounts = new Map<string, number>();
  const uniqName = (base: string): string => {
    const clean = escYaml(base || 'Action').slice(0, 80) || 'Action';
    const key = clean.toLowerCase();
    const prev = nameCounts.get(key) || 0;
    nameCounts.set(key, prev + 1);
    return prev === 0 ? clean : `${clean} (${prev + 1})`;
  };

  const flowVars = ir.variables.filter((v) => v.scope === 'flow');
  const taskVars = ir.variables.filter((v) => v.scope === 'task');
  const lines: string[] = [];

  lines.push('inboundCall:');
  lines.push(`  name: ${cleanSlug(ir.meta.flowId, 'Genesys_Flow')}`);
  lines.push(`  description: "Generiert aus flowIR v${ir.meta.version} (${escYaml(ir.meta.sourceScript)})"`);
  lines.push(`  defaultLanguage: ${ir.meta.language || 'de-de'}`);
  lines.push('  startUpRef: "/inboundCall/tasks/task[Main_Task]"');

  const emitVars = (vars: FlowIRVariable[], indent: number) => {
    if (vars.length === 0) return;
    const sp = ' '.repeat(indent);
    lines.push(`${sp}variables:`);
    for (const v of vars) {
      const typeKey =
        v.type === 'integer'
          ? 'integerVariable'
          : v.type === 'boolean'
          ? 'booleanVariable'
          : 'stringVariable';
      const litVal =
        v.type === 'integer'
          ? String(Number(v.initialValue) || 0)
          : v.type === 'boolean'
          ? v.initialValue === true
            ? 'true'
            : 'false'
          : `"${escYaml(String(v.initialValue ?? ''))}"`;
      lines.push(`${sp}  - ${typeKey}:`);
      lines.push(`${sp}      name: ${cleanSlug(v.name, 'varItem')}`);
      lines.push(`${sp}      initialValue:`);
      lines.push(`${sp}        lit: ${litVal}`);
    }
  };

  emitVars(flowVars, 2);

  const subflowTasksToEmit = new Set<string>();

  const emitPathFrom = (nodeId: string, indent: number, visited: Set<string>): void => {
    if (!nodeId || visited.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node || node.kind === 'terminal') return;

    const nextVisited = new Set(visited);
    nextVisited.add(nodeId);

    const li = ' '.repeat(indent);
    const p = ' '.repeat(indent + 4);
    const outs = outgoing.get(nodeId) || [];

    if (node.kind === 'entry') {
      const firstNext = outs[0]?.to;
      if (firstNext) emitPathFrom(firstNext, indent, nextVisited);
      return;
    }

    const commentList = formatOrderedMigrationAnnotations(
      node.migrationAnnotations,
      node.migrationNote,
      node.migrationComments
    );
    for (const cl of commentList) {
      lines.push(`${li}# ${cl}`);
    }

    switch (node.kind) {
      case 'decision': {
        const scopedExpr = applyGenesysScopesToExpr(node.condition?.expr || '', ir.variables);
        const trueEdge = outs.find((tr) => tr.type === 'whenTrue');
        const falseEdge = outs.find((tr) => tr.type === 'whenFalse');
        lines.push(`${li}- decision:`);
        lines.push(`${p}name: "${uniqName(node.name)}"`);
        lines.push(`${p}condition:`);
        lines.push(`${p}  exp: "${escYaml(scopedExpr || 'Flow.conditionMissing == true')}"`);
        lines.push(`${p}outputs:`);
        lines.push(`${p}  yes:`);
        if (trueEdge && nodeMap.get(trueEdge.to)?.kind !== 'terminal') {
          lines.push(`${p}    actions:`);
          emitPathFrom(trueEdge.to, indent + 10, nextVisited);
        } else {
          lines.push(`${p}    actions: []`);
        }
        lines.push(`${p}  no:`);
        if (falseEdge && nodeMap.get(falseEdge.to)?.kind !== 'terminal') {
          lines.push(`${p}    actions:`);
          emitPathFrom(falseEdge.to, indent + 10, nextVisited);
        } else {
          lines.push(`${p}    actions: []`);
        }
        return; // Branches own continuation
      }

      case 'switch': {
        const scopedExpr = applyGenesysScopesToExpr(node.expression?.expr || '', ir.variables);
        const caseEdges = outs.filter((tr) => tr.type === 'case');
        const defEdge = outs.find((tr) => tr.type === 'default');
        lines.push(`${li}- switch:`);
        lines.push(`${p}name: "${uniqName(node.name)}"`);
        lines.push(`${p}evaluate:`);
        lines.push(`${p}  firstTrue: true`);
        if (caseEdges.length > 0) {
          lines.push(`${p}cases:`);
          for (const ce of caseEdges) {
            lines.push(`${p}  - case:`);
            lines.push(`${p}      value:`);
            lines.push(`${p}        exp: "${escYaml(scopedExpr)} == \\"${escYaml(ce.matchValue || '')}\\""`);
            if (nodeMap.get(ce.to)?.kind !== 'terminal') {
              lines.push(`${p}      actions:`);
              emitPathFrom(ce.to, indent + 12, nextVisited);
            } else {
              lines.push(`${p}      actions: []`);
            }
          }
        }
        lines.push(`${p}default:`);
        if (defEdge && nodeMap.get(defEdge.to)?.kind !== 'terminal') {
          lines.push(`${p}  actions:`);
          emitPathFrom(defEdge.to, indent + 8, nextVisited);
        } else {
          lines.push(`${p}  actions: []`);
        }
        return;
      }

      case 'scheduleCheck': {
        const sgName = String(node.parameters?.scheduleGroup || 'Default_ScheduleGroup');
        const openEdge = outs.find((tr) => tr.type === 'open');
        const closedEdge = outs.find((tr) => tr.type === 'closed');
        const holEdge = outs.find((tr) => tr.type === 'holiday');
        lines.push(`${li}- evaluateScheduleGroup:`);
        lines.push(`${p}name: "${uniqName(node.name)}"`);
        lines.push(`${p}scheduleGroup:`);
        lines.push(`${p}  lit:`);
        lines.push(`${p}    name: "${escYaml(sgName)}"`);
        lines.push(`${p}outputs:`);
        for (const [branchKey, edge] of [
          ['open', openEdge],
          ['closed', closedEdge],
          ['holiday', holEdge],
        ] as const) {
          lines.push(`${p}  ${branchKey}:`);
          if (edge && nodeMap.get(edge.to)?.kind !== 'terminal') {
            lines.push(`${p}    actions:`);
            emitPathFrom(edge.to, indent + 10, nextVisited);
          } else {
            lines.push(`${p}    actions: []`);
          }
        }
        return;
      }

      case 'dataAction': {
        const isTable = node.parameters?.isDataTable === true;
        const targetAction = node.integration?.targetAction || cleanSlug(node.name, 'DataAction');
        if (isTable) {
          const foundEdge = outs.find((tr) => tr.type === 'success');
          const notFoundEdge = outs.find((tr) => tr.type === 'failure');
          const keyExpr = applyGenesysScopesToExpr(
            String(node.inputs?.[0]?.expr || 'Call.Dnis'),
            ir.variables
          );
          lines.push(`${li}- callDataTableLookup:`);
          lines.push(`${p}name: "${uniqName(node.name)}"`);
          lines.push(`${p}dataTable:`);
          lines.push(`${p}  lit:`);
          lines.push(`${p}    name: "${escYaml(targetAction)}"`);
          lines.push(`${p}lookupKey:`);
          lines.push(`${p}  exp: "${escYaml(keyExpr)}"`);
          lines.push(`${p}outputs:`);
          lines.push(`${p}  found:`);
          if (foundEdge && nodeMap.get(foundEdge.to)?.kind !== 'terminal') {
            lines.push(`${p}    actions:`);
            emitPathFrom(foundEdge.to, indent + 10, nextVisited);
          } else {
            lines.push(`${p}    actions: []`);
          }
          lines.push(`${p}  notFound:`);
          if (notFoundEdge && nodeMap.get(notFoundEdge.to)?.kind !== 'terminal') {
            lines.push(`${p}    actions:`);
            emitPathFrom(notFoundEdge.to, indent + 10, nextVisited);
          } else {
            lines.push(`${p}    actions: []`);
          }
          return;
        }

        const succEdge = outs.find((tr) => tr.type === 'success');
        const failEdge = outs.find((tr) => tr.type === 'failure');
        const toEdge = outs.find((tr) => tr.type === 'timeout');
        lines.push(`${li}- callDataAction:`);
        lines.push(`${p}name: "${uniqName(node.name)}"`);
        lines.push(`${p}dataAction:`);
        lines.push(`${p}  category: "${escYaml(node.integration?.category || 'Oracle_Integration')}"`);
        lines.push(`${p}  dataAction: "${escYaml(targetAction)}"`);
        if (node.inputs && node.inputs.length > 0) {
          lines.push(`${p}inputs:`);
          for (const inp of node.inputs) {
            lines.push(`${p}  - input:`);
            lines.push(`${p}      name: "${escYaml(inp.name)}"`);
            lines.push(`${p}      value:`);
            lines.push(`${p}        exp: "${escYaml(applyGenesysScopesToExpr(inp.expr, ir.variables))}"`);
          }
        }
        if (node.outputs && node.outputs.length > 0) {
          lines.push(`${p}successOutputs:`);
          for (const out of node.outputs) {
            lines.push(`${p}  - output:`);
            lines.push(`${p}      name: "${escYaml(out.name)}"`);
            lines.push(`${p}      variable: ${applyGenesysScopesToExpr(out.targetVariable, ir.variables)}`);
          }
        }
        lines.push(`${p}outputs:`);
        for (const [branchKey, edge] of [
          ['success', succEdge],
          ['failure', failEdge],
          ['timeout', toEdge],
        ] as const) {
          lines.push(`${p}  ${branchKey}:`);
          if (edge && nodeMap.get(edge.to)?.kind !== 'terminal') {
            lines.push(`${p}    actions:`);
            emitPathFrom(edge.to, indent + 10, nextVisited);
          } else {
            lines.push(`${p}    actions: []`);
          }
        }
        return;
      }

      case 'collectInput': {
        const targetVar = applyGenesysScopesToExpr(
          String(node.parameters?.targetVariable || 'collectedDigits'),
          ir.variables
        );
        const succEdge = outs.find((tr) => tr.type === 'success');
        const failEdge = outs.find((tr) => tr.type === 'timeout' || tr.type === 'failure');
        lines.push(`${li}- collectInput:`);
        lines.push(`${p}name: "${uniqName(node.name)}"`);
        lines.push(`${p}inputAudio:`);
        lines.push(`${p}  tts: "${escYaml(String(node.parameters?.ttsText || 'Bitte Eingabe vornehmen.'))}"`);
        lines.push(`${p}inputData:`);
        lines.push(`${p}  var: ${targetVar}`);
        lines.push(`${p}outputs:`);
        lines.push(`${p}  success:`);
        if (succEdge && nodeMap.get(succEdge.to)?.kind !== 'terminal') {
          lines.push(`${p}    actions:`);
          emitPathFrom(succEdge.to, indent + 10, nextVisited);
        } else {
          lines.push(`${p}    actions: []`);
        }
        lines.push(`${p}  failure:`);
        if (failEdge && nodeMap.get(failEdge.to)?.kind !== 'terminal') {
          lines.push(`${p}    actions:`);
          emitPathFrom(failEdge.to, indent + 10, nextVisited);
        } else {
          lines.push(`${p}    actions: []`);
        }
        return;
      }

      case 'invokeSubflow': {
        const taskSlug = cleanSlug(String(node.parameters?.target || node.name), 'SubTask');
        subflowTasksToEmit.add(taskSlug);
        lines.push(`${li}- callTask:`);
        lines.push(`${p}name: "${uniqName(`Call Task ${taskSlug}`)}"`);
        lines.push(`${p}targetTaskRef: "/inboundCall/tasks/task[${taskSlug}]"`);
        break;
      }

      case 'invokeCommonModule': {
        const modSlug = cleanSlug(String(node.parameters?.moduleName || node.name), 'CommonModule');
        lines.push(`${li}- callCommonModule:`);
        lines.push(`${p}name: "${uniqName(`Call CommonModule ${modSlug}`)}"`);
        lines.push(`${p}commonModule:`);
        lines.push(`${p}  name: "${escYaml(modSlug)}"`);
        break;
      }

      case 'transfer': {
        const target = String(node.parameters?.target || 'Default_Queue');
        if (node.resolvedTargetType === 'externalNumber') {
          lines.push(`${li}- transferToNumber:`);
          lines.push(`${p}name: "${uniqName(node.name)}"`);
          lines.push(`${p}targetNumber:`);
          lines.push(`${p}  lit: "${escYaml(target)}"`);
        } else {
          lines.push(`${li}- transferToAcd:`);
          lines.push(`${p}name: "${uniqName(node.name)}"`);
          lines.push(`${p}targetQueue:`);
          lines.push(`${p}  lit:`);
          lines.push(`${p}    name: "${escYaml(cleanSlug(target, 'Default_Queue'))}"`);
        }
        return; // Hard rule 4.1: terminal stops sequential path
      }

      case 'disconnect': {
        lines.push(`${li}- disconnect:`);
        lines.push(`${p}name: "${uniqName(node.name)}"`);
        return; // Hard rule 4.1: terminal stops sequential path
      }

      case 'action':
      default: {
        if (node.actionType === 'playAudio') {
          lines.push(`${li}- playAudio:`);
          lines.push(`${p}name: "${uniqName(node.name)}"`);
          lines.push(`${p}audio:`);
          lines.push(`${p}  tts: "${escYaml(String(node.parameters?.ttsText || node.name))}"`);
        } else if (node.actionType === 'getParticipantData') {
          const vName = String(node.parameters?.targetVariable || 'Attribute');
          lines.push(`${li}- getParticipantData:`);
          lines.push(`${p}name: "${uniqName(node.name)}"`);
          lines.push(`${p}attributes:`);
          lines.push(`${p}  - attribute:`);
          lines.push(`${p}      name: "${escYaml(vName)}"`);
          lines.push(`${p}      variable: ${applyGenesysScopesToExpr(vName, ir.variables)}`);
        } else {
          const vName = String(node.parameters?.targetVariable || 'avayaOriginScript');
          const scopedVar = applyGenesysScopesToExpr(vName, ir.variables);
          const cleanVName = vName.replace(/^(?:Flow|Task)\./i, '').toLowerCase();
          const varDecl = ir.variables.find((v) => v.name.toLowerCase() === cleanVName);
          const litVal = node.parameters?.literalValue;
          const stmtType: 'boolean' | 'integer' | 'string' =
            varDecl?.type === 'boolean' || typeof litVal === 'boolean'
              ? 'boolean'
              : varDecl?.type === 'integer' || typeof litVal === 'number'
              ? 'integer'
              : 'string';
          lines.push(`${li}- updateData:`);
          lines.push(`${p}name: "${uniqName(node.name)}"`);
          lines.push(`${p}statements:`);
          lines.push(`${p}  - ${stmtType}:`);
          lines.push(`${p}      variable: ${scopedVar}`);
          lines.push(`${p}      value:`);
          if (typeof node.parameters?.expr === 'string') {
            lines.push(
              `${p}        exp: "${escYaml(applyGenesysScopesToExpr(node.parameters.expr, ir.variables))}"`
            );
          } else if (stmtType === 'boolean') {
            const boolLit =
              typeof litVal === 'boolean'
                ? litVal
                : String(litVal ?? 'false').toLowerCase() === 'true';
            lines.push(`${p}        lit: ${boolLit ? 'true' : 'false'}`);
          } else if (stmtType === 'integer') {
            const numLit = Number(litVal ?? 0);
            lines.push(`${p}        lit: ${Number.isFinite(numLit) ? numLit : 0}`);
          } else {
            lines.push(`${p}        lit: "${escYaml(String(litVal ?? ''))}"`);
          }
        }
        break;
      }
    }

    // Continue along unconditional transition if non-terminal
    if (!node.terminal) {
      const nextEdge = outs.find((tr) => tr.type === 'unconditional');
      if (nextEdge && nodeMap.get(nextEdge.to)?.kind !== 'terminal') {
        emitPathFrom(nextEdge.to, indent, nextVisited);
      }
    }
  };

  lines.push('  tasks:');
  lines.push('    - task:');
  lines.push('        name: Main_Task');
  lines.push('        refId: Main_Task');
  emitVars(taskVars, 8);
  lines.push('        actions:');
  const beforeLen = lines.length;
  emitPathFrom(ir.meta.entryNodeId, 10, new Set<string>());
  if (lines.length === beforeLen) {
    lines.push('          - disconnect:');
    lines.push(`              name: "${uniqName('Disconnect Call')}"`);
  }

  // Emit referenced Reusable Subflow Tasks cleanly
  for (const subTask of subflowTasksToEmit) {
    lines.push('    - task:');
    lines.push(`        name: ${subTask}`);
    lines.push(`        refId: ${subTask}`);
    lines.push('        actions:');
    lines.push(`          # OFFENE MIGRATIONSFRAGE: Legacy source for this module is not loaded.`);
    lines.push('          - callCommonModule:');
    lines.push(`              name: "${uniqName(`Invoke ${subTask}`)}"`);
    lines.push('              commonModule:');
    lines.push(`                name: "${subTask}"`);
  }

  return lines.join('\n');
}

export function renderGenesysView(ir: FlowIR, preRenderedArchyYaml?: string): RenderedModeReport {
  const validation = validateIR(ir);
  const allFindings = ir.findings.length > 0 ? ir.findings : validation.findings;
  const yaml = preRenderedArchyYaml || renderArchyYamlFromFlowIR(ir);
  const modeLabel = ir.meta.compatibilityStubMode
    ? 'Kompatibilitäts-/Stub-Modus (Opt-In)'
    : ir.meta.resolvedTargetMode
    ? `Resolved Target (Holiday DB · ${
        ir.meta.holidayLookupTarget === 'dataTable' ? 'Data Table' : 'Data Action'
      })`
    : 'Ehrliche Migration (Strict Default)';

  const openReviewItems = allFindings.filter((f) => {
    const cls = normalizeWarningClass(f.warningClass || classifyFlowIRFinding(f.code).warningClass);
    return cls === 'actionable_migration' || cls === 'semantic_review';
  });
  const sourceAndCleanupItems = allFindings.filter((f) => {
    const cls = normalizeWarningClass(f.warningClass || classifyFlowIRFinding(f.code).warningClass);
    return cls === 'source_hint' || cls === 'informational_cleanup';
  });
  const kurzfazit = `Genesys Cloud Architect Zielstruktur (${modeLabel}) für "${ir.meta.flowId}" (${validation.stats.decisionCount} Decisions, ${validation.stats.switchCount} Switches, ${validation.stats.integrationCount} Integrationen, ${validation.errorCount} IR-Fehler, ${openReviewItems.length} Open Review Signals, ${sourceAndCleanupItems.length} Hints/Cleanup).`;

  const annahmenUndOffenePunkte: string[] =
    allFindings.length > 0
      ? allFindings.map((f) => {
          const cls = normalizeWarningClass(
            f.warningClass || classifyFlowIRFinding(f.code).warningClass
          );
          const traceStr = f.sourceTrace
            ? ` [${f.sourceTrace.script}${f.sourceTrace.section ? ` · ${f.sourceTrace.section}` : ''} · Z.${f.sourceTrace.lineStart}]`
            : '';
          return `[${f.severity} · ${f.code} · ${cls}] ${f.message}${traceStr}`;
        })
      : ['Alle IR-Regeln erfüllt — keine offenen Migrationsfragen oder ungefüllten Variablen erkannt.'];

  const migrationshinweise: string[] = [
    `Migrationsmodus: ${modeLabel}.`,
    `Review-Triage: ${openReviewItems.length} Open Review Signal(s) (actionable_migration / semantic_review) getrennt von ${sourceAndCleanupItems.length} Hint-/Cleanup-Meldung(en) (source_hint / informational_cleanup).`,
    'Variablen-Scopes: Alle Variablen sind in der IR scope-frei gehalten und erst im Genesys-YAML als Flow.* bzw. Task.* gerendert.',
    'Kontrollfluss: Avaya-Sections und GOTO-Sprünge wurden graphbasiert in echte Architect-Verzweigungen aufgelöst; geschützte Besetzt-/Fehler-Pfade sind nur bedingt erreichbar.',
  ];
  if (ir.dependencies.commonModules.length > 0) {
    migrationshinweise.push(
      `Common Modules (${ir.dependencies.commonModules.join(', ')}): In Ziel-Org vor dem Flow-Import anlegen.`
    );
  }
  if (ir.dependencies.dataActions.length > 0) {
    migrationshinweise.push(
      `Data Actions / Data Tables (${ir.dependencies.dataActions.join(', ')}): Input-/Output-Mappings sowie Failure-/Timeout-Pfade in Genesys Cloud abnehmen.`
    );
  }

  const markdownReport = [
    '## 1. Kurzfazit',
    kurzfazit,
    '',
    '## 2. Annahmen / offene Punkte',
    ...annahmenUndOffenePunkte.map((x) => `- ${x}`),
    '',
    '## 3. Ergebnis (modus=genesys · Archy YAML)',
    '```yaml',
    yaml,
    '```',
    '',
    '## 4. Wichtigste Migrationshinweise',
    ...migrationshinweise.map((x) => `- ${x}`),
  ].join('\n');

  return {
    mode: 'genesys',
    kurzfazit,
    annahmenUndOffenePunkte,
    ergebnisText: yaml,
    migrationshinweise,
    markdownReport,
  };
}
