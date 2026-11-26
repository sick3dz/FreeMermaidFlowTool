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

export interface FlowIRNode {
  id: string;
  kind: FlowIRNodeKind;
  actionType?: string;
  name: string;
  /** Explizites v1.1-Flag: Validator und Renderer müssen Terminalität nicht erraten. */
  terminal: boolean;
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
  | 'MISSING_SUBFLOW_SOURCE';

export interface FlowIRFinding {
  severity: FlowIRFindingSeverity;
  code: FlowIRFindingCode;
  message: string;
  nodeId?: string;
  variableName?: string;
  sourceTrace?: FlowIRSourceTrace;
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
  return expr.replace(/\b(?:Flow|Task)\.([A-Za-z_][A-Za-z0-9_]*)\b/g, '$1');
}

/**
 * Extrahiert alle nicht-systemischen Variablenbezeichner aus einem scope-freien IR-Ausdruck.
 */
export function extractReferencedVarNamesFromExpr(expr: string): string[] {
  if (!expr) return [];
  // Strip quoted string literals first
  const withoutStrings = expr.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ');
  // Remove system Call.* dotted chains
  const withoutSystem = withoutStrings.replace(/\bCall\.[A-Za-z0-9_.]+\b/g, ' ');
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

// ============================================================================
// BUILDER: MigrationFlowGraph (Level 1) -> Kanonisches FlowIR v1.1
// ============================================================================

export function buildFlowIRFromMigrationGraph(
  graph: MigrationFlowGraph,
  options?: { missingSubflows?: string[] }
): FlowIR {
  const scriptName = graph.fileName || `${graph.cleanName}.s`;
  const variables: FlowIRVariable[] = [];
  const varByLower = new Map<string, FlowIRVariable>();

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
      return existing;
    }
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

      // Surface any provenance gaps recorded during Level-1 graph building
      if (step.provenanceFinding) {
        preFindings.push({
          severity: step.provenanceFinding.severity,
          code: step.provenanceFinding.code,
          message: step.provenanceFinding.message,
          variableName: step.provenanceFinding.variableName,
          sourceTrace: trace,
        });
      }

      // Handle jumpToReusableTask -> link directly to target task's entry node
      if (step.kind === 'jumpToReusableTask' && step.targetTaskRefId) {
        const targetRef = step.targetTaskRefId;
        const targetNodeId = taskEntryIdMap.get(targetRef);
        if (targetNodeId) {
          linkFromPending(targetNodeId);
          // Jump is terminal for the current sequential chain
          return { firstId, openExits: [] };
        }
        // Fallback if target task wasn't built yet: record as invokeSubflow
        const id = nextNodeId('sub', targetRef);
        subflowsSet.add(targetRef);
        nodes.push({
          id,
          kind: 'invokeSubflow',
          name: targetRef,
          terminal: true,
          parameters: { target: targetRef, mode: 'jump' },
          sourceTrace: trace,
          ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
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

          nodes.push({
            id,
            kind: 'decision',
            name: step.label || `Check ${step.conditionLabel || 'Condition'}`,
            terminal: false,
            parameters: {
              ...(step.isEmergencyCheck ? { isEmergencyCheck: true } : {}),
              ...(step.isFallbackFlag ? { isFallbackFlag: true } : {}),
            },
            sourceTrace: trace,
            condition: {
              expr: unscopedExpr,
              ...(step.rawCondition ? { sourceExpr: step.rawCondition } : {}),
            },
            ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
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
            ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
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
          nodes.push({
            id,
            kind: 'scheduleCheck',
            name: step.label || `Schedule ${step.targetSlug || 'Default'}`,
            terminal: false,
            parameters: {
              scheduleGroup: step.targetSlug || step.target || 'Default_ScheduleGroup',
            },
            sourceTrace: trace,
            ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
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
            ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
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
            return {
              name: om.field,
              targetVariable: cleanTarget,
            };
          });

          const integrationType: FlowIRIntegrationSpec['type'] =
            isTable || step.dataActionCategory === 'Oracle_Integration'
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
            ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
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
          nodes.push({
            id,
            kind: 'invokeSubflow',
            name: targetName,
            terminal: false,
            parameters: {
              target: targetName,
              originalTarget: step.target || targetName,
            },
            sourceTrace: trace,
            ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
          });
          linkFromPending(id);
          pendingExits = [{ nodeId: id, type: 'unconditional' }];
          break;
        }

        case 'callCommonModule': {
          const modName = step.targetSlug || step.target || 'CommonModule';
          commonModulesSet.add(modName);
          const id = nextNodeId('cm', modName);
          nodes.push({
            id,
            kind: 'invokeCommonModule',
            name: modName,
            terminal: false,
            parameters: {
              moduleName: modName,
              originalTarget: step.target || modName,
            },
            sourceTrace: trace,
            ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
          });
          linkFromPending(id);
          pendingExits = [{ nodeId: id, type: 'unconditional' }];
          break;
        }

        case 'transferToAcd':
        case 'transferToNumber':
        case 'transferToVoicemail': {
          const id = nextNodeId('xfer', step.targetSlug || step.target);
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
            ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
          });
          linkFromPending(id);
          connectToTerminalEnd(id);
          return { firstId, openExits: [] };
        }

        case 'disconnect': {
          const id = nextNodeId('disc', step.target || 'disconnect');
          nodes.push({
            id,
            kind: 'disconnect',
            actionType: 'disconnect',
            name: step.label || 'Disconnect Call',
            terminal: true,
            parameters: {
              reason: step.target || (step.avayaCommand === 'GIVE BUSY' ? 'busy' : 'normal'),
            },
            sourceTrace: trace,
            ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
          });
          linkFromPending(id);
          connectToTerminalEnd(id);
          return { firstId, openExits: [] };
        }

        case 'loop': {
          const id = nextNodeId('loop', step.targetSlug || step.target);
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
            ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
          });
          linkFromPending(id);
          pendingExits = [{ nodeId: id, type: 'unconditional' }];
          break;
        }

        default: {
          // playAudio, updateData, setParticipantData, getParticipantData, playHoldMusic, delay, setPriority, setLanguage, setUuiData, createCallback, menu
          const id = nextNodeId('act', step.targetSlug || step.variableName || step.kind);
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

          nodes.push({
            id,
            kind: 'action',
            actionType,
            name: step.label || step.kind,
            terminal: Boolean(step.isTerminal),
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
            ...(step.yamlComment ? { migrationNote: step.yamlComment } : {}),
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

  for (const t of graph.tasks) {
    if (!entryTask || t.refId === entryTask.refId) continue;
    // Skip subscript tasks in main flow graph transitions (they are represented via invokeSubflow dependencies)
    if (t.kind === 'subscript') continue;
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

  const ir: FlowIR = {
    meta: {
      flowId: graph.cleanName,
      sourceSystem: 'Avaya',
      targetSystem: 'Genesys',
      sourceScript: scriptName,
      entryNodeId,
      language: 'de-de',
      version: '1.1',
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
  const combined: FlowIRFinding[] = [];
  for (const f of [...preFindings, ...validation.findings]) {
    const key = `${f.code}:${f.nodeId || ''}:${f.variableName || ''}:${f.message}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    combined.push(f);
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

  for (const v of ir.variables || []) {
    varMap.set(v.name.toLowerCase(), v);
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

  const errorCount = findings.filter((f) => f.severity === 'ERROR').length;
  const warningCount = findings.filter((f) => f.severity === 'WARN').length;
  const infoCount = findings.filter((f) => f.severity === 'INFO').length;

  return {
    isValid: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    findings,
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

  const kurzfazit = `Normalisiertes Avaya-Mapping für "${ir.meta.sourceScript}" (${ir.nodes.length} IR-Knoten, ${ir.transitions.length} Transitionen, ${ir.variables.length} scope-freie Variablen, ${allFindings.length} Finding(s)).`;

  const annahmenUndOffenePunkte: string[] =
    allFindings.length > 0
      ? allFindings.map((f) => {
          const traceStr = f.sourceTrace
            ? ` [${f.sourceTrace.script}${f.sourceTrace.section ? ` · ${f.sourceTrace.section}` : ''} · Z.${f.sourceTrace.lineStart}]`
            : '';
          return `[${f.severity} · ${f.code}] ${f.message}${traceStr}`;
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

    if (node.migrationNote) {
      lines.push(`${li}# ${node.migrationNote.replace(/\r?\n/g, ' ')}`);
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
          lines.push(`${li}- updateData:`);
          lines.push(`${p}name: "${uniqName(node.name)}"`);
          lines.push(`${p}statements:`);
          lines.push(`${p}  - string:`);
          lines.push(`${p}      variable: ${scopedVar}`);
          lines.push(`${p}      value:`);
          if (typeof node.parameters?.expr === 'string') {
            lines.push(
              `${p}        exp: "${escYaml(applyGenesysScopesToExpr(node.parameters.expr, ir.variables))}"`
            );
          } else {
            lines.push(`${p}        lit: "${escYaml(String(node.parameters?.literalValue ?? ''))}"`);
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
    lines.push(`          # OFFENE MIGRATIONSFRAGE: Subflow "${subTask}" ist separat zu pruefen oder als Common Module einzubinden.`);
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

  const kurzfazit = `Genesys Cloud Architect Zielstruktur für "${ir.meta.flowId}" (${validation.stats.decisionCount} Decisions, ${validation.stats.switchCount} Switches, ${validation.stats.integrationCount} Integrationen, ${validation.errorCount} IR-Fehler, ${allFindings.filter((f) => f.severity === 'WARN').length} offene Migrationspunkte).`;

  const annahmenUndOffenePunkte: string[] =
    allFindings.length > 0
      ? allFindings.map((f) => {
          const traceStr = f.sourceTrace
            ? ` [${f.sourceTrace.script}${f.sourceTrace.section ? ` · ${f.sourceTrace.section}` : ''} · Z.${f.sourceTrace.lineStart}]`
            : '';
          return `[${f.severity} · ${f.code}] ${f.message}${traceStr}`;
        })
      : ['Alle IR-Regeln erfüllt — keine offenen Migrationsfragen oder ungefüllten Variablen erkannt.'];

  const migrationshinweise: string[] = [
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
