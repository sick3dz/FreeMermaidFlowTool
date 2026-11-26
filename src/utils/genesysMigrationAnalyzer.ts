/**
 * 100 % Offline & In-Memory Avaya AACC (OCL) -> Genesys Cloud Architect (Archy YAML)
 * Zweistufiger deterministischer Konverter:
 *   - EBENE 1 (genesysMigrationGraph.ts): Plattformneutraler Migrations-Graph (IR)
 *   - EBENE 2 (diese Datei): Genesys Archy YAML Renderer, Graph-Mermaid Renderer & Rekursiver Validator
 *
 * Strikte Datenschutz- & Isolations-Vorgabe:
 * - KEIN Dateisystem-I/O (`fs`, `path`) und KEINE Netzwerk-Aufrufe (`fetch`, `XMLHttpRequest`).
 * - Reine, seiteneffektfreie In-Memory-Verarbeitung (Read-Only auf Avaya ScriptWorkspace / AuditReport).
 * - Keinerlei Änderungen an Avaya-Parsern oder Avaya-Erkennungsregeln.
 */
import JSZip from 'jszip';
import { ScriptModule, ScriptWorkspace } from '../types/mermaidStudio';
import {
  buildScriptWorkspace,
  canonicalScriptMatchKey,
  stripKnownScriptExtension,
} from './scriptCallflowParser';
import {
  AuditReport,
  ParsedScriptNode,
  runCallflowAudit,
} from './auditCallflows';
import {
  BuildMigrationGraphResult,
  MigrationFlowGraph,
  MigrationGraphWarning,
  MigrationStep,
  MigrationTaskGraph,
  MigrationVariableDataType,
  MigrationVariableDecl,
  StepProvenanceFinding,
  buildMigrationFlowGraph,
  flattenMigrationSteps,
  isStepListTerminal,
  toCleanGraphSlug,
} from './genesysMigrationGraph';
import {
  FlowIR,
  FlowIRDocument,
  FlowIRFinding,
  FlowIRFindingCode,
  FlowIRValidationResult,
  RenderedModeReport,
  buildFlowIRFromMigrationGraph,
  renderArchyYamlFromFlowIR,
  renderAvayaView,
  renderGenesysView,
  validateIR,
} from './genesysFlowIR';

export type {
  MigrationFlowGraph,
  MigrationStep,
  MigrationTaskGraph,
  MigrationVariableDataType,
  MigrationVariableDecl,
  NormalizedTransferTarget,
} from './genesysMigrationGraph';
export type {
  FlowIR,
  FlowIRDocument,
  FlowIRFinding,
  FlowIRFindingCode,
  FlowIRNode,
  FlowIRNodeKind,
  FlowIRSourceTrace,
  FlowIRTransferTargetType,
  FlowIRTransition,
  FlowIRTransitionType,
  FlowIRValidationResult,
  FlowIRVariable,
  RenderedModeReport,
} from './genesysFlowIR';
export {
  buildFlowIRFromMigrationGraph,
  renderArchyYamlFromFlowIR,
  renderAvayaView,
  renderGenesysView,
  validateIR,
};

export type GenesysReadinessLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type GenesysActionKind =
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

export interface ArchyYamlValidationIssue {
  lineNumber: number;
  code: string;
  severity: 'error' | 'warning';
  field?: string;
  message: string;
  suggestion?: string;
}

export interface ArchyYamlValidationResult {
  isValid: boolean;
  errors: ArchyYamlValidationIssue[];
  warnings: ArchyYamlValidationIssue[];
  stats: {
    lineCount: number;
    taskCount: number;
    actionCount: number;
    variableCount: number;
  };
}

export interface GenesysVariableDecl {
  /** Clean unscoped variable declaration name (e.g. "avayaOriginScript", "GV_Region", "collectedDigits"). */
  name: string;
  originalName: string;
  /** Architect reference syntax (e.g. "Flow.avayaOriginScript", "Task.collectedDigits"). */
  archyName: string;
  scope: 'participantData' | 'flow' | 'task';
  dataType: MigrationVariableDataType;
  initialValue: string;
}

export interface GenesysMappedAction {
  id: string;
  kind: GenesysActionKind;
  avayaCommand: string;
  genesysLabel: string;
  lineNumber: number;
  target?: string;
  targetSlug?: string;
  dataActionCategory?:
    | 'Oracle_Integration'
    | 'FlixCheck_API'
    | 'Genesys_Cloud_Data_Actions';
  skills?: string[];
  isMultiSkillset?: boolean;
  isBackwardGoto?: boolean;
  maxLoopCount?: number;
  priorityValue?: number;
  delaySeconds?: number;
  languageCode?: string;
  expressionValue?: string;
  dataTableKey?: string;
  isEmergencyCheck?: boolean;
  variableName?: string;
  archyVariableName?: string;
  conditionLabel?: string;
  choices?: Array<{ digit: string; target: string }>;
  isBrokenTarget?: boolean;
  warning?: string;
}

export interface GenesysScriptWarning {
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
    | 'ARCHY_YAML_VALIDATION_ERROR';
  severity: 'warning' | 'blocker';
  message: string;
  lineNumber?: number;
}

export interface GenesysScriptTranslation {
  scriptKey: string;
  scriptNumber: string;
  fileName: string;
  cleanName: string;
  archyFilename: string;
  isEntryPoint: boolean;
  incomingCallCount: number;
  isCommonModuleTarget: boolean;
  readiness: GenesysReadinessLevel;
  readinessReasons: string[];
  metrics: {
    actionCount: number;
    subscriptCallCount: number;
    commonModuleCallCount: number;
    callTaskCount: number;
    skillsetCount: number;
    hasMultiSkillset: boolean;
    backwardGotoCount: number;
    externalApiCount: number;
    oracleApiCount: number;
    flixcheckApiCount: number;
    callVariableCount: number;
    brokenLinkCount: number;
    prunedDeadPathCount: number;
    realExpressionCount: number;
    normalizedTargetCount: number;
  };
  variables: GenesysVariableDecl[];
  actions: GenesysMappedAction[];
  localReusableTasks: Array<{ name: string; refId: string; originalTarget: string }>;
  /** Level 1 Neutral Control-Flow Migration Graph (IR) powering both Archy YAML and Mermaid. */
  migrationGraph: MigrationFlowGraph;
  /** Kanonisches FlowIR v1.1 (Single Source of Truth: Avaya -> IR -> Avaya / Genesys). */
  flowIR: FlowIR;
  /** Harte IR-Validierung (validateIR) inkl. aller 10 verbindlichen Findings-Codes. */
  irValidation: FlowIRValidationResult;
  /** modus=avaya: Normalisiertes Avaya-Mapping & 4-Teile-Bericht. */
  avayaView: RenderedModeReport;
  /** modus=genesys: Genesys Zielstruktur & 4-Teile-Bericht. */
  genesysView: RenderedModeReport;
  warnings: GenesysScriptWarning[];
  archyYaml: string;
  yamlValidation: ArchyYamlValidationResult;
  genesysMermaid: string;
}

export interface GenesysWorkspaceTranslation {
  schemaVersion: string;
  generatedAt: string;
  privacyMode: '100%-in-memory-metadata-only';
  /** false = Ehrliche Migration (Standard), true = Optionaler Kompatibilitäts-/Stub-Modus. */
  compatibilityStubMode: boolean;
  overallReadiness: GenesysReadinessLevel;
  summary: {
    totalScripts: number;
    lowCount: number;
    mediumCount: number;
    highCount: number;
    commonModuleCount: number;
    totalWarnings: number;
    backwardGotoScripts: number;
    multiSkillsetScripts: number;
    oracleCalls: number;
    flixcheckCalls: number;
    brokenLinks: number;
    yamlValidScriptCount: number;
    yamlErrorCount: number;
    totalPrunedDeadPaths: number;
    totalNormalizedTargets: number;
    totalInlinedSections: number;
    totalIrFindings: number;
  };
  scripts: GenesysScriptTranslation[];
  scriptsByKey: Record<string, GenesysScriptTranslation>;
  masterGenesysMermaid: string;
  auditReport: AuditReport;
}

function isScriptWorkspace(input: ScriptWorkspace | ScriptModule[]): input is ScriptWorkspace {
  return !Array.isArray(input) && Array.isArray(input.modules);
}

/**
 * Formats any script/variable/prompt identifier into a strict YAML-safe Archy slug.
 */
export function toArchySlug(raw: string, fallback = 'Unnamed'): string {
  return toCleanGraphSlug(raw, fallback);
}

function escapeYamlString(raw: string): string {
  return String(raw || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function escapeMermaidLabel(raw: string): string {
  return String(raw || '')
    .replace(/"/g, "'")
    .replace(/[<>]/g, '')
    .replace(/\|/g, '/')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function toSafeMermaidId(prefix: string, raw: string, index?: number): string {
  const slug = toArchySlug(raw, 'Node');
  return index !== undefined ? `${prefix}_${slug}_${index}` : `${prefix}_${slug}`;
}

function spaces(count: number): string {
  return ' '.repeat(count);
}

// ============================================================================
// EBENE 2A: GENESYS CLOUD ARCHITECT (ARCHY YAML) RENDERER
// ============================================================================

function variableTypeKey(dataType: MigrationVariableDataType): string {
  if (dataType === 'integer') return 'integerVariable';
  if (dataType === 'boolean') return 'booleanVariable';
  return 'stringVariable';
}

function formatVariableLiteral(decl: MigrationVariableDecl): string {
  if (decl.dataType === 'integer') {
    const num = Number(decl.initialValue);
    return Number.isFinite(num) ? String(Math.round(num)) : '0';
  }
  if (decl.dataType === 'boolean') {
    return decl.initialValue === true || decl.initialValue === 'true' ? 'true' : 'false';
  }
  return `"${escapeYamlString(String(decl.initialValue ?? ''))}"`;
}

function emitVariableBlock(
  lines: string[],
  vars: MigrationVariableDecl[],
  baseIndent: number
): void {
  if (vars.length === 0) return;
  const seen = new Set<string>();
  lines.push(`${spaces(baseIndent)}variables:`);
  for (const v of vars) {
    const cleanName = toArchySlug(v.name.replace(/^(?:Flow|Task)\./i, ''), 'varItem');
    const key = cleanName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    lines.push(`${spaces(baseIndent + 2)}- ${variableTypeKey(v.dataType)}:`);
    lines.push(`${spaces(baseIndent + 6)}name: ${cleanName}`);
    lines.push(`${spaces(baseIndent + 6)}initialValue:`);
    lines.push(`${spaces(baseIndent + 8)}lit: ${formatVariableLiteral(v)}`);
  }
}

function createUniqueNameFactory() {
  const counts = new Map<string, number>();
  return (rawBase: string): string => {
    const base = escapeYamlString(rawBase || 'Action').slice(0, 80) || 'Action';
    const key = base.toLowerCase();
    const prev = counts.get(key) || 0;
    counts.set(key, prev + 1);
    return prev === 0 ? base : `${base} (${prev + 1})`;
  };
}

function emitArchyStepList(
  lines: string[],
  steps: MigrationStep[],
  listIndent: number,
  uniqueName: (base: string) => string
): void {
  if (steps.length === 0) {
    return;
  }

  for (const step of steps) {
    const propIndent = listIndent + 4;
    const p = spaces(propIndent);
    const li = spaces(listIndent);

    if (step.yamlComment) {
      const commentLines = step.yamlComment
        .split(/\r?\n/)
        .map((c) => c.trim())
        .filter(Boolean);
      for (const cl of commentLines) {
        lines.push(`${li}# ${cl}`);
      }
    }

    switch (step.kind) {
      case 'playAudio': {
        const promptSlug = step.targetSlug || toArchySlug(step.target || 'Prompt', 'Prompt');
        const actName = uniqueName(`Play Prompt.${promptSlug}`);
        const tts = escapeYamlString(step.ttsText || `Ansage Prompt.${promptSlug}`);
        lines.push(`${li}- playAudio:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}audio:`);
        lines.push(`${p}  tts: "${tts}"`);
        break;
      }

      case 'collectInput': {
        const promptSlug = step.targetSlug || toArchySlug(step.target || 'DTMF_Input', 'DTMF_Input');
        const actName = uniqueName(`Collect Input ${promptSlug}`);
        const inputVarRef = step.inputVarRef || 'Task.collectedDigits';
        const spec = step.digitSpec || { mode: 'exact', exact: 1 };
        const noEntrySec = step.noEntryTimeoutSec ?? 5;
        const interDigitSec = step.interDigitTimeoutSec ?? 3;

        lines.push(`${li}- collectInput:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}inputAudio:`);
        lines.push(`${p}  tts: "${escapeYamlString(step.ttsText || `Bitte Eingabe fuer ${promptSlug} vornehmen.`)}"`);
        lines.push(`${p}inputData:`);
        lines.push(`${p}  var: ${inputVarRef}`);
        lines.push(`${p}numberOfDigits:`);
        if (spec.mode === 'exact' && spec.exact) {
          lines.push(`${p}  exact:`);
          lines.push(`${p}    lit: ${spec.exact}`);
        } else {
          lines.push(`${p}  min:`);
          lines.push(`${p}    lit: ${spec.min ?? 1}`);
          lines.push(`${p}  max:`);
          lines.push(`${p}    lit: ${spec.max ?? 16}`);
        }
        lines.push(`${p}noEntryTimeout:`);
        lines.push(`${p}  lit:`);
        lines.push(`${p}    seconds: ${noEntrySec}`);
        lines.push(`${p}interDigitTimeout:`);
        lines.push(`${p}  lit:`);
        lines.push(`${p}    seconds: ${interDigitSec}`);
        if (step.terminatingCharacter) {
          lines.push(`${p}terminatingCharacter:`);
          lines.push(`${p}  lit: "${escapeYamlString(step.terminatingCharacter)}"`);
        }
        lines.push(`${p}noEntryAudio:`);
        lines.push(`${p}  tts: "${escapeYamlString(step.noEntryTts || 'Es wurde keine Eingabe erkannt.')}"`);
        lines.push(`${p}noMatchAudio:`);
        lines.push(`${p}  tts: "${escapeYamlString(step.noMatchTts || 'Ungueltige Eingabe.')}"`);

        const successSteps = step.successSteps || [];
        const failureSteps =
          step.failureSteps && step.failureSteps.length > 0
            ? step.failureSteps
            : [
                {
                  id: `${step.id}_fail`,
                  kind: 'disconnect' as const,
                  lineNumber: step.lineNumber,
                  avayaCommand: 'COLLECT_FAILURE',
                  label: 'Disconnect (Input Timeout)',
                  target: 'Input_Timeout',
                  isTerminal: true,
                },
              ];

        lines.push(`${p}outputs:`);
        lines.push(`${p}  success:`);
        if (successSteps.length > 0) {
          lines.push(`${p}    actions:`);
          emitArchyStepList(lines, successSteps, propIndent + 6, uniqueName);
        } else {
          lines.push(`${p}    # HINWEIS: Eingabe steht in ${inputVarRef} fuer Folgeaktionen bereit.`);
          lines.push(`${p}    actions: []`);
        }
        lines.push(`${p}  failure:`);
        lines.push(`${p}    actions:`);
        emitArchyStepList(lines, failureSteps, propIndent + 6, uniqueName);
        break;
      }

      case 'menu': {
        const menuSlug = step.targetSlug || toArchySlug(step.target || 'IVR_Menu', 'IVR_Menu');
        const actName = uniqueName(`Menu ${menuSlug}`);
        lines.push(`${li}- menu:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}audio:`);
        lines.push(`${p}  tts: "${escapeYamlString(step.ttsText || `Auswahlmenue ${menuSlug}`)}"`);
        break;
      }

      case 'callDataAction': {
        const category = step.dataActionCategory || 'Oracle_Integration';
        const targetSlug = step.targetSlug || toArchySlug(step.target || category, 'ExternalAction');
        const prefixLabel =
          category === 'FlixCheck_API'
            ? 'FlixCheck'
            : category === 'Genesys_Cloud_Data_Actions'
            ? 'QueueObs'
            : 'Oracle';
        const actName = uniqueName(`${prefixLabel} ${targetSlug}`);

        lines.push(`${li}- callDataAction:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}dataAction:`);
        lines.push(`${p}  category: "${category}"`);
        lines.push(`${p}  dataAction: "${escapeYamlString(targetSlug)}"`);

        const inputs =
          step.dataActionInputs && step.dataActionInputs.length > 0
            ? step.dataActionInputs
            : [{ name: 'callerAni', expr: 'Call.Ani' }];
        lines.push(`${p}inputs:`);
        for (const inp of inputs) {
          lines.push(`${p}  - input:`);
          lines.push(`${p}      name: "${escapeYamlString(inp.name)}"`);
          lines.push(`${p}      value:`);
          lines.push(`${p}        exp: "${escapeYamlString(inp.expr)}"`);
        }

        const outMappings = step.dataActionOutputs || [];
        if (outMappings.length > 0) {
          lines.push(`${p}successOutputs:`);
          for (const om of outMappings) {
            lines.push(`${p}  - output:`);
            lines.push(`${p}      name: "${escapeYamlString(om.field)}"`);
            lines.push(`${p}      variable: ${om.targetVarRef}`);
          }
        }

        const successSteps = step.successSteps || [];
        const failureSteps =
          step.failureSteps && step.failureSteps.length > 0
            ? step.failureSteps
            : [
                {
                  id: `${step.id}_err`,
                  kind: 'disconnect' as const,
                  lineNumber: step.lineNumber,
                  avayaCommand: 'API_FAILURE',
                  label: `Disconnect (${prefixLabel} Failure)`,
                  target: `${prefixLabel}_Failure`,
                  isTerminal: true,
                },
              ];
        const timeoutSteps =
          step.timeoutSteps && step.timeoutSteps.length > 0
            ? step.timeoutSteps
            : [
                {
                  id: `${step.id}_to`,
                  kind: 'disconnect' as const,
                  lineNumber: step.lineNumber,
                  avayaCommand: 'API_TIMEOUT',
                  label: `Disconnect (${prefixLabel} Timeout)`,
                  target: `${prefixLabel}_Timeout`,
                  isTerminal: true,
                },
              ];

        lines.push(`${p}outputs:`);
        lines.push(`${p}  success:`);
        if (successSteps.length > 0) {
          lines.push(`${p}    actions:`);
          emitArchyStepList(lines, successSteps, propIndent + 6, uniqueName);
        } else {
          lines.push(`${p}    # HINWEIS: Rueckgabewerte stehen ueber successOutputs fuer nachfolgende Entscheidungen bereit.`);
          lines.push(`${p}    actions: []`);
        }
        lines.push(`${p}  failure:`);
        lines.push(`${p}    actions:`);
        emitArchyStepList(lines, failureSteps, propIndent + 6, uniqueName);
        lines.push(`${p}  timeout:`);
        lines.push(`${p}    actions:`);
        emitArchyStepList(lines, timeoutSteps, propIndent + 6, uniqueName);
        break;
      }

      case 'callCommonModule': {
        const modSlug = step.targetSlug || toArchySlug(step.target || 'CommonModule', 'CommonModule');
        const actName = uniqueName(`Call CommonModule ${modSlug}`);
        lines.push(`${li}- callCommonModule:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}commonModule:`);
        lines.push(`${p}  name: "${escapeYamlString(modSlug)}"`);
        break;
      }

      case 'callTask': {
        const taskRef = step.targetTaskRefId || step.targetSlug || toArchySlug(step.target || 'SubTask', 'SubTask');
        const actName = uniqueName(`Call Task ${taskRef}`);
        lines.push(`${li}- callTask:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}targetTaskRef: "/inboundCall/tasks/task[${escapeYamlString(taskRef)}]"`);
        break;
      }

      case 'jumpToReusableTask': {
        const taskRef = step.targetTaskRefId || step.targetSlug || toArchySlug(step.target || 'TargetTask', 'TargetTask');
        const actName = uniqueName(`Jump to ${taskRef}`);
        lines.push(`${li}- jumpToReusableTask:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}targetTaskRef: "/inboundCall/tasks/task[${escapeYamlString(taskRef)}]"`);
        break;
      }

      case 'decision': {
        const condName = escapeYamlString(step.conditionLabel || step.target || 'Branch');
        const actName = uniqueName(`Check ${condName}`);
        const condExp = escapeYamlString(
          step.expression || (step.isEmergencyCheck ? 'Flow.emergencyOverride == true' : 'Flow.cond_check == true')
        );
        const yesSteps = step.yesSteps || [];
        const noSteps = step.noSteps || [];

        lines.push(`${li}- decision:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}condition:`);
        lines.push(`${p}  exp: "${condExp}"`);
        lines.push(`${p}outputs:`);
        lines.push(`${p}  yes:`);
        if (yesSteps.length > 0) {
          lines.push(`${p}    actions:`);
          emitArchyStepList(lines, yesSteps, propIndent + 6, uniqueName);
        } else {
          lines.push(`${p}    actions: []`);
        }
        lines.push(`${p}  no:`);
        if (noSteps.length > 0) {
          lines.push(`${p}    actions:`);
          emitArchyStepList(lines, noSteps, propIndent + 6, uniqueName);
        } else {
          lines.push(`${p}    actions: []`);
        }
        break;
      }

      case 'switch': {
        const switchVarRef = step.variableRef || step.expression || 'Task.collectedDigits';
        const actName = uniqueName(`Switch ${step.variableName || 'Selection'}`);
        const cases = step.cases || [];
        const defaultSteps = step.defaultSteps || [];

        lines.push(`${li}- switch:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}evaluate:`);
        lines.push(`${p}  firstTrue: true`);
        if (cases.length > 0) {
          lines.push(`${p}cases:`);
          for (const c of cases) {
            const valEsc = escapeYamlString(c.value);
            lines.push(`${p}  - case:`);
            lines.push(`${p}      value:`);
            lines.push(`${p}        exp: "${escapeYamlString(switchVarRef)} == \\"${valEsc}\\""`);
            if (c.steps.length > 0) {
              lines.push(`${p}      actions:`);
              emitArchyStepList(lines, c.steps, propIndent + 8, uniqueName);
            } else {
              lines.push(`${p}      actions: []`);
            }
          }
        }
        lines.push(`${p}default:`);
        if (defaultSteps.length > 0) {
          lines.push(`${p}  actions:`);
          emitArchyStepList(lines, defaultSteps, propIndent + 4, uniqueName);
        } else {
          lines.push(`${p}  actions: []`);
        }
        break;
      }

      case 'loop': {
        const loopSlug = step.targetSlug || toArchySlug(step.target || 'SectionLoop', 'SectionLoop');
        const actName = uniqueName(`Loop ${loopSlug}`);
        const bodySteps = step.bodySteps || [];
        lines.push(`${li}- loop:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}maxLoopCount: ${step.maxLoopCount ?? 5}`);
        if (step.currentIndexVarName) {
          lines.push(`${p}currentIndexDataName: "Task.${escapeYamlString(step.currentIndexVarName)}"`);
        }
        if (bodySteps.length > 0) {
          lines.push(`${p}actions:`);
          emitArchyStepList(lines, bodySteps, propIndent + 2, uniqueName);
        } else {
          lines.push(`${p}actions: []`);
        }
        break;
      }

      case 'setParticipantData': {
        const cvName = toArchySlug(step.variableName || 'CV_Data', 'CV_Data');
        const valExpr = step.expressionValue || step.variableRef || `Flow.${cvName}`;
        const actName = uniqueName(`Set Participant Data ${cvName}`);
        lines.push(`${li}- setParticipantData:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}attributes:`);
        lines.push(`${p}  - attribute:`);
        lines.push(`${p}      name: "${escapeYamlString(cvName)}"`);
        lines.push(`${p}      value:`);
        lines.push(`${p}        exp: "${escapeYamlString(valExpr)}"`);
        break;
      }

      case 'getParticipantData': {
        const cvName = toArchySlug(step.variableName || 'CV_Data', 'CV_Data');
        const targetVar = step.variableRef || `Flow.${cvName}`;
        const actName = uniqueName(`Get Participant Data ${cvName}`);
        lines.push(`${li}- getParticipantData:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}attributes:`);
        lines.push(`${p}  - attribute:`);
        lines.push(`${p}      name: "${escapeYamlString(cvName)}"`);
        lines.push(`${p}      variable: ${escapeYamlString(targetVar)}`);
        break;
      }

      case 'updateData': {
        const varRef = step.variableRef || 'Flow.avayaOriginScript';
        const stmtType =
          step.variableDataType === 'integer'
            ? 'integer'
            : step.variableDataType === 'boolean'
            ? 'boolean'
            : 'string';
        const actName = uniqueName(`Update ${step.variableName || varRef}`);
        lines.push(`${li}- updateData:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}statements:`);
        lines.push(`${p}  - ${stmtType}:`);
        lines.push(`${p}      variable: ${escapeYamlString(varRef)}`);
        lines.push(`${p}      value:`);
        if (step.expressionValue) {
          lines.push(`${p}        exp: "${escapeYamlString(step.expressionValue)}"`);
        } else if (stmtType === 'integer') {
          lines.push(`${p}        lit: ${Number(step.literalValue) || 0}`);
        } else if (stmtType === 'boolean') {
          lines.push(`${p}        lit: ${step.literalValue === true ? 'true' : 'false'}`);
        } else {
          lines.push(`${p}        lit: "${escapeYamlString(String(step.literalValue ?? ''))}"`);
        }
        break;
      }

      case 'transferToAcd': {
        const queueName = step.targetSlug || toArchySlug(step.target || 'Default_Queue', 'Default_Queue');
        const actName = uniqueName(
          step.isMultiSkillset ? `Queue + Bullseye ${queueName}` : `Transfer to ACD ${queueName}`
        );
        lines.push(`${li}- transferToAcd:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}targetQueue:`);
        lines.push(`${p}  lit:`);
        lines.push(`${p}    name: "${escapeYamlString(queueName)}"`);
        if (step.isMultiSkillset && step.skills && step.skills.length > 0) {
          lines.push(`${p}skills:`);
          for (const skill of step.skills) {
            const skillSlug = toArchySlug(skill, 'Skill');
            lines.push(`${p}  - lit:`);
            lines.push(`${p}      name: "${escapeYamlString(skillSlug)}"`);
          }
        }
        lines.push(`${p}failureTransferAudio:`);
        lines.push(`${p}  tts: "Die Weiterleitung an die Warteschlange ${escapeYamlString(queueName)} ist fehlgeschlagen."`);
        break;
      }

      case 'transferToNumber': {
        const e164 = escapeYamlString(step.normalizedE164 || step.target || '+490000000');
        const actName = uniqueName(`Transfer to External ${e164}`);
        lines.push(`${li}- transferToNumber:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}targetNumber:`);
        lines.push(`${p}  lit: "${e164}"`);
        lines.push(`${p}failureTransferAudio:`);
        lines.push(`${p}  tts: "Die externe Weiterleitung konnte nicht aufgebaut werden."`);
        break;
      }

      case 'disconnect': {
        const label = step.target ? `Disconnect (${step.target})` : 'Disconnect Call';
        const actName = uniqueName(label);
        lines.push(`${li}- disconnect:`);
        lines.push(`${p}name: "${actName}"`);
        break;
      }

      case 'evaluateScheduleGroup': {
        const sgSlug = step.targetSlug || toArchySlug(step.target || 'Default_ScheduleGroup', 'Default_ScheduleGroup');
        const actName = uniqueName(`Evaluate ${sgSlug}`);
        const openSteps = step.openSteps || [];
        const closedSteps = step.closedSteps || [];
        const holidaySteps = step.holidaySteps || [];

        lines.push(`${li}- evaluateScheduleGroup:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}scheduleGroup:`);
        lines.push(`${p}  lit:`);
        lines.push(`${p}    name: "${escapeYamlString(sgSlug)}"`);
        lines.push(`${p}outputs:`);
        lines.push(`${p}  open:`);
        if (openSteps.length > 0) {
          lines.push(`${p}    actions:`);
          emitArchyStepList(lines, openSteps, propIndent + 6, uniqueName);
        } else {
          lines.push(`${p}    actions: []`);
        }
        lines.push(`${p}  closed:`);
        if (closedSteps.length > 0) {
          lines.push(`${p}    actions:`);
          emitArchyStepList(lines, closedSteps, propIndent + 6, uniqueName);
        } else {
          lines.push(`${p}    actions: []`);
        }
        lines.push(`${p}  holiday:`);
        if (holidaySteps.length > 0) {
          lines.push(`${p}    actions:`);
          emitArchyStepList(lines, holidaySteps, propIndent + 6, uniqueName);
        } else {
          lines.push(`${p}    actions: []`);
        }
        break;
      }

      case 'playHoldMusic': {
        const musicSlug = step.targetSlug || toArchySlug(step.target || 'Hold_Music', 'Hold_Music');
        const actName = uniqueName(`Play Hold Music ${musicSlug}`);
        lines.push(`${li}- playHoldMusic:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}audio:`);
        lines.push(`${p}  tts: "Wartemusik ${escapeYamlString(musicSlug)} (In-Queue Flow)"`);
        break;
      }

      case 'delay': {
        const secs = Math.max(1, Math.round(step.delaySeconds || 10));
        const actName = uniqueName(`Wait ${secs}s`);
        lines.push(`${li}- delay:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}seconds:`);
        lines.push(`${p}  lit: ${secs}`);
        break;
      }

      case 'setPriority': {
        const prio = Number.isFinite(step.priorityValue) ? Math.round(step.priorityValue!) : 50;
        const actName = uniqueName(`Set Priority ${prio}`);
        lines.push(`${li}- setPriority:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}priority:`);
        lines.push(`${p}  lit: ${prio}`);
        break;
      }

      case 'createCallback': {
        const cbQueue = step.targetSlug || toArchySlug(step.target || 'Callback_Queue', 'Callback_Queue');
        const actName = uniqueName(`Offer Callback ${cbQueue}`);
        lines.push(`${li}- createCallback:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}queue:`);
        lines.push(`${p}  lit:`);
        lines.push(`${p}    name: "${escapeYamlString(cbQueue)}"`);
        lines.push(`${p}callbackNumber:`);
        lines.push(`${p}  exp: "Call.Ani"`);
        lines.push(`${p}outputs:`);
        lines.push(`${p}  success:`);
        if (step.successSteps && step.successSteps.length > 0) {
          lines.push(`${p}    actions:`);
          emitArchyStepList(lines, step.successSteps, propIndent + 6, uniqueName);
        } else {
          lines.push(`${p}    actions: []`);
        }
        lines.push(`${p}  failure:`);
        if (step.failureSteps && step.failureSteps.length > 0) {
          lines.push(`${p}    actions:`);
          emitArchyStepList(lines, step.failureSteps, propIndent + 6, uniqueName);
        } else {
          lines.push(`${p}    actions: []`);
        }
        break;
      }

      case 'transferToVoicemail': {
        const vmQueue = step.targetSlug || toArchySlug(step.target || 'Voicemail_Queue', 'Voicemail_Queue');
        const actName = uniqueName(`Transfer to Voicemail ${vmQueue}`);
        lines.push(`${li}- transferToVoicemail:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}targetQueue:`);
        lines.push(`${p}  lit:`);
        lines.push(`${p}    name: "${escapeYamlString(vmQueue)}"`);
        break;
      }

      case 'setLanguage': {
        const langCode = escapeYamlString(step.languageCode || 'de-de');
        const actName = uniqueName(`Set Language ${langCode}`);
        lines.push(`${li}- setLanguage:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}language:`);
        lines.push(`${p}  lit: "${langCode}"`);
        break;
      }

      case 'callDataTableLookup': {
        const dtSlug = step.targetSlug || toArchySlug(step.target || 'Routing_DataTable', 'Routing_DataTable');
        const keyExp = escapeYamlString(step.dataTableKey || 'Call.Dnis');
        const actName = uniqueName(`Lookup ${dtSlug}`);
        const foundSteps = step.foundSteps || [];
        const notFoundSteps = step.notFoundSteps || [];
        lines.push(`${li}- callDataTableLookup:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}dataTable:`);
        lines.push(`${p}  lit:`);
        lines.push(`${p}    name: "${escapeYamlString(dtSlug)}"`);
        lines.push(`${p}lookupKey:`);
        lines.push(`${p}  exp: "${keyExp}"`);
        lines.push(`${p}outputs:`);
        lines.push(`${p}  found:`);
        if (foundSteps.length > 0) {
          lines.push(`${p}    actions:`);
          emitArchyStepList(lines, foundSteps, propIndent + 6, uniqueName);
        } else {
          lines.push(`${p}    actions: []`);
        }
        lines.push(`${p}  notFound:`);
        if (notFoundSteps.length > 0) {
          lines.push(`${p}    actions:`);
          emitArchyStepList(lines, notFoundSteps, propIndent + 6, uniqueName);
        } else {
          lines.push(`${p}    actions: []`);
        }
        break;
      }

      case 'setUuiData': {
        const uuiExp = escapeYamlString(step.expressionValue || 'Call.UserToUserInformation');
        const actName = uniqueName(`Set UUI ${step.target || 'SIP_UUI'}`);
        lines.push(`${li}- setUuiData:`);
        lines.push(`${p}name: "${actName}"`);
        lines.push(`${p}uuiData:`);
        lines.push(`${p}  exp: "${uuiExp}"`);
        break;
      }
    }
  }
}

/**
 * Generates strict, graph-structured Genesys Cloud Archy YAML directly from the Level-1 MigrationFlowGraph.
 */
export function generateArchyYaml(script: GenesysScriptTranslation): string {
  const graph = script.migrationGraph;
  const lines: string[] = [];
  const cleanFlowName = toArchySlug(graph.cleanName || script.cleanName, 'Avaya_Migrated_Flow');
  const uniqueName = createUniqueNameFactory();

  lines.push('inboundCall:');
  lines.push(`  name: ${cleanFlowName}`);
  lines.push(
    `  description: "Auto-generiert aus Avaya AACC Skript ${escapeYamlString(script.fileName)}"`
  );
  lines.push('  defaultLanguage: de-de');
  lines.push(`  startUpRef: "/inboundCall/tasks/task[${escapeYamlString(graph.entryTaskRefId)}]"`);

  // Flow-level variables ONLY (clean unscoped names; referenced via Flow.<name>)
  emitVariableBlock(lines, graph.flowVariables, 2);

  // Tasks (Main_Task + mehrfach genutzte SECTION tasks + hydratisierte Reusable Subscript tasks + Fallback_Error_Task)
  lines.push('  tasks:');
  for (const task of graph.tasks) {
    if (task.yamlComment) {
      lines.push(`    # ${task.yamlComment.replace(/\r?\n/g, ' ')}`);
    }
    lines.push('    - task:');
    lines.push(`        name: ${toArchySlug(task.name, 'Task')}`);
    lines.push(`        refId: ${toArchySlug(task.refId, 'Task')}`);
    if (task.taskVariables.length > 0) {
      // Task-local variables ONLY (clean unscoped names; referenced via Task.<name>)
      emitVariableBlock(lines, task.taskVariables, 8);
    }
    lines.push('        actions:');
    if (task.steps.length === 0) {
      lines.push('          - disconnect:');
      lines.push(`              name: "${uniqueName(`Disconnect (${task.refId})`)}"`);
    } else {
      emitArchyStepList(lines, task.steps, 10, uniqueName);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// STRICT RECURSIVE ARCHY YAML SCHEMA & FLOW-GRAPH VALIDATOR (100 % Offline)
// ============================================================================

const ARCHY_INBOUND_ALLOWED_KEYS = new Set<string>([
  'name',
  'description',
  'division',
  'defaultLanguage',
  'supportedLanguages',
  'startUpRef',
  'variables',
  'tasks',
]);

const ARCHY_VARIABLE_TYPES = new Set<string>([
  'stringVariable',
  'integerVariable',
  'booleanVariable',
]);

const ARCHY_TASK_ALLOWED_KEYS = new Set<string>(['name', 'refId', 'variables', 'actions']);

const TERMINAL_ACTION_TYPES = new Set<string>([
  'transferToAcd',
  'transferToNumber',
  'transferToVoicemail',
  'disconnect',
  'jumpToReusableTask',
]);

interface ArchyActionRule {
  required: string[];
  allowed: Set<string>;
}

const ARCHY_ACTION_SCHEMA: Record<string, ArchyActionRule> = {
  playAudio: {
    required: ['name', 'audio'],
    allowed: new Set(['name', 'audio', 'outputs']),
  },
  collectInput: {
    required: ['name', 'inputAudio', 'inputData'],
    allowed: new Set([
      'name',
      'inputAudio',
      'inputData',
      'numberOfDigits',
      'noEntryTimeout',
      'interDigitTimeout',
      'terminatingCharacter',
      'noEntryAudio',
      'noMatchAudio',
      'outputs',
    ]),
  },
  menu: {
    required: ['name', 'audio'],
    allowed: new Set(['name', 'audio', 'choices', 'outputs']),
  },
  callDataAction: {
    required: ['name', 'dataAction'],
    allowed: new Set(['name', 'dataAction', 'inputs', 'successOutputs', 'failureOutputs', 'outputs']),
  },
  callCommonModule: {
    required: ['name', 'commonModule'],
    allowed: new Set(['name', 'commonModule', 'inputs', 'outputs']),
  },
  callTask: {
    required: ['name', 'targetTaskRef'],
    allowed: new Set(['name', 'targetTaskRef']),
  },
  jumpToReusableTask: {
    required: ['name', 'targetTaskRef'],
    allowed: new Set(['name', 'targetTaskRef']),
  },
  decision: {
    required: ['name', 'condition', 'outputs'],
    allowed: new Set(['name', 'condition', 'outputs']),
  },
  switch: {
    required: ['name', 'default'],
    allowed: new Set(['name', 'evaluate', 'cases', 'default']),
  },
  loop: {
    required: ['name', 'maxLoopCount', 'actions'],
    allowed: new Set(['name', 'maxLoopCount', 'currentIndexDataName', 'actions']),
  },
  setParticipantData: {
    required: ['name', 'attributes'],
    allowed: new Set(['name', 'attributes']),
  },
  getParticipantData: {
    required: ['name', 'attributes'],
    allowed: new Set(['name', 'attributes']),
  },
  updateData: {
    required: ['name', 'statements'],
    allowed: new Set(['name', 'statements']),
  },
  transferToAcd: {
    required: ['name', 'targetQueue'],
    allowed: new Set([
      'name',
      'targetQueue',
      'priority',
      'skills',
      'languageSkill',
      'preTransferAudio',
      'failureTransferAudio',
      'outputs',
    ]),
  },
  transferToNumber: {
    required: ['name', 'targetNumber'],
    allowed: new Set([
      'name',
      'targetNumber',
      'preTransferAudio',
      'failureTransferAudio',
      'outputs',
    ]),
  },
  disconnect: {
    required: ['name'],
    allowed: new Set(['name']),
  },
  evaluateScheduleGroup: {
    required: ['name', 'scheduleGroup', 'outputs'],
    allowed: new Set(['name', 'scheduleGroup', 'outputs']),
  },
  playHoldMusic: {
    required: ['name', 'audio'],
    allowed: new Set(['name', 'audio']),
  },
  delay: {
    required: ['name', 'seconds'],
    allowed: new Set(['name', 'seconds']),
  },
  setPriority: {
    required: ['name', 'priority'],
    allowed: new Set(['name', 'priority']),
  },
  createCallback: {
    required: ['name', 'queue', 'callbackNumber'],
    allowed: new Set(['name', 'queue', 'callbackNumber', 'callbackName', 'outputs']),
  },
  transferToVoicemail: {
    required: ['name'],
    allowed: new Set(['name', 'targetQueue', 'targetUser', 'outputs']),
  },
  setLanguage: {
    required: ['name', 'language'],
    allowed: new Set(['name', 'language']),
  },
  callDataTableLookup: {
    required: ['name', 'dataTable', 'lookupKey'],
    allowed: new Set(['name', 'dataTable', 'lookupKey', 'outputs']),
  },
  setUuiData: {
    required: ['name', 'uuiData'],
    allowed: new Set(['name', 'uuiData']),
  },
};

interface ParsedYamlLine {
  lineNumber: number;
  indent: number;
  isListItem: boolean;
  key: string | null;
  rawValue: string;
  unquotedValue: string;
  rawLine: string;
}

function hasUnclosedQuote(str: string): boolean {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < str.length) {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(str[i - 1]))) {
      break;
    }
  }
  return quote !== null;
}

function stripInlineYamlComment(val: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < val.length; i += 1) {
    const ch = val[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < val.length) {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(val[i - 1]))) {
      return val.slice(0, i).trim();
    }
  }
  return val.trim();
}

function unquoteYamlScalar(raw: string): string {
  const cleaned = stripInlineYamlComment(raw);
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length >= 2)
  ) {
    return cleaned.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return cleaned;
}

function collectIndentedBlock(lines: ParsedYamlLine[], parentIndex: number): ParsedYamlLine[] {
  const parent = lines[parentIndex];
  const block: ParsedYamlLine[] = [];
  for (let i = parentIndex + 1; i < lines.length; i += 1) {
    if (lines[i].indent <= parent.indent) break;
    block.push(lines[i]);
  }
  return block;
}

/**
 * Full offline recursive schema, indentation, RefId, variable-scope, duplicate-name, and
 * unreachable-after-terminal validator for Genesys Cloud Archy YAML.
 */
export function validateArchyYaml(yamlContent: string): ArchyYamlValidationResult {
  const errors: ArchyYamlValidationIssue[] = [];
  const warnings: ArchyYamlValidationIssue[] = [];

  const rawText = typeof yamlContent === 'string' ? yamlContent : '';
  const rawLines = rawText.split(/\r?\n/);

  if (!rawText.trim()) {
    errors.push({
      lineNumber: 1,
      code: 'EMPTY_YAML',
      severity: 'error',
      message: 'Das Archy YAML ist leer.',
      suggestion: 'Erzeuge ein Flow-YAML mit Root-Block "inboundCall:".',
    });
    return {
      isValid: false,
      errors,
      warnings,
      stats: { lineCount: 0, taskCount: 0, actionCount: 0, variableCount: 0 },
    };
  }

  // Pass 1: Lexical, Indentation & Quote Checks
  const parsed: ParsedYamlLine[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const lineNumber = i + 1;
    const rawLine = rawLines[i];
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) continue;

    const leadingWsMatch = rawLine.match(/^([ \t]*)/);
    const leadingWs = leadingWsMatch ? leadingWsMatch[1] : '';
    if (leadingWs.includes('\t')) {
      errors.push({
        lineNumber,
        code: 'TAB_INDENTATION',
        severity: 'error',
        message: `Zeile ${lineNumber}: Tabulator-Einrückung ist in Archy YAML nicht erlaubt.`,
        suggestion: 'Ersetze Tabs durch exakt 2 Leerzeichen pro Ebene.',
      });
    }

    const indent = leadingWs.replace(/\t/g, '  ').length;
    if (indent % 2 !== 0) {
      errors.push({
        lineNumber,
        code: 'ODD_INDENTATION',
        severity: 'error',
        message: `Zeile ${lineNumber}: Ungerade Einrückung (${indent} Leerzeichen). Archy YAML erfordert 2-Space-Stufen.`,
        suggestion: 'Richte die Einrückung an einer geraden Anzahl Leerzeichen (2, 4, 6, …) aus.',
      });
    }

    const trimmed = rawLine.trim();
    if (hasUnclosedQuote(trimmed)) {
      errors.push({
        lineNumber,
        code: 'UNCLOSED_QUOTE',
        severity: 'error',
        message: `Zeile ${lineNumber}: Nicht geschlossenes Anführungszeichen erkannt.`,
        suggestion: 'Schließe den String mit passendem " oder \' ab.',
      });
    }

    const isListItem = trimmed.startsWith('- ') || trimmed === '-';
    const body = isListItem ? trimmed.slice(1).trim() : trimmed;
    const kvMatch = body.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*:(?:\s*(.*))?$/);

    if (!kvMatch) {
      if (!isListItem) {
        errors.push({
          lineNumber,
          code: 'INVALID_YAML_SYNTAX',
          severity: 'error',
          message: `Zeile ${lineNumber}: Ungültige YAML-Syntax ("${trimmed.slice(0, 48)}").`,
          suggestion: 'Verwende gültige "key: value"-Paare oder "- item"-Listen.',
        });
      }
      parsed.push({
        lineNumber,
        indent,
        isListItem,
        key: null,
        rawValue: body,
        unquotedValue: unquoteYamlScalar(body),
        rawLine,
      });
      continue;
    }

    const key = kvMatch[1];
    const rawValue = (kvMatch[2] || '').trim();
    parsed.push({
      lineNumber,
      indent,
      isListItem,
      key,
      rawValue,
      unquotedValue: unquoteYamlScalar(rawValue),
      rawLine,
    });
  }

  if (parsed.length === 0) {
    errors.push({
      lineNumber: 1,
      code: 'EMPTY_YAML',
      severity: 'error',
      message: 'Das Archy YAML enthält keine aktiven YAML-Einträge (nur Kommentare oder Leerzeilen).',
      suggestion: 'Erzeuge ein Flow-YAML mit Root-Block "inboundCall:".',
    });
    return {
      isValid: false,
      errors,
      warnings,
      stats: { lineCount: rawLines.length, taskCount: 0, actionCount: 0, variableCount: 0 },
    };
  }

  // Pass 2: Root Check (inboundCall)
  const rootEntries = parsed.filter((p) => p.indent === 0);
  const inboundRoot = rootEntries.find((p) => p.key === 'inboundCall');

  for (const r of rootEntries) {
    if (r.key && r.key !== 'inboundCall') {
      errors.push({
        lineNumber: r.lineNumber,
        code: 'UNKNOWN_ROOT_KEY',
        severity: 'error',
        field: r.key,
        message: `Zeile ${r.lineNumber}: Unbekannter Root-Key "${r.key}". Erwartet wird ausschließlich "inboundCall:".`,
        suggestion: 'Entferne nicht-konforme Root-Keys und nutze "inboundCall:".',
      });
    }
  }

  if (!inboundRoot) {
    errors.push({
      lineNumber: parsed[0]?.lineNumber || 1,
      code: 'MISSING_ROOT_INBOUND_CALL',
      severity: 'error',
      field: 'inboundCall',
      message: 'Pflicht-Root-Knoten "inboundCall:" fehlt.',
      suggestion: 'Beginne das Archy YAML mit "inboundCall:" auf Einrückungsebene 0.',
    });
    return {
      isValid: false,
      errors,
      warnings,
      stats: { lineCount: rawLines.length, taskCount: 0, actionCount: 0, variableCount: 0 },
    };
  }

  // Pass 3: Top-Level Keys under inboundCall (indent === 2)
  const inboundIdx = parsed.indexOf(inboundRoot);
  const inboundBlock = collectIndentedBlock(parsed, inboundIdx);
  const topLevelEntries = inboundBlock.filter((p) => p.indent === 2 && !p.isListItem);
  const seenTopKeys = new Map<string, number>();

  for (const entry of topLevelEntries) {
    if (!entry.key) continue;
    if (seenTopKeys.has(entry.key)) {
      errors.push({
        lineNumber: entry.lineNumber,
        code: 'DUPLICATE_KEY',
        severity: 'error',
        field: entry.key,
        message: `Zeile ${entry.lineNumber}: Doppelter Key "${entry.key}" unter inboundCall (bereits in Zeile ${seenTopKeys.get(entry.key)}).`,
        suggestion: 'Entferne das doppelte Feld.',
      });
    } else {
      seenTopKeys.set(entry.key, entry.lineNumber);
    }

    if (!ARCHY_INBOUND_ALLOWED_KEYS.has(entry.key)) {
      errors.push({
        lineNumber: entry.lineNumber,
        code: 'UNKNOWN_TOP_LEVEL_KEY',
        severity: 'error',
        field: entry.key,
        message: `Zeile ${entry.lineNumber}: Nicht erlaubter Archy-Key "${entry.key}" unter inboundCall.`,
        suggestion: `Erlaubte Keys: ${Array.from(ARCHY_INBOUND_ALLOWED_KEYS).join(', ')}.`,
      });
    }
  }

  const requiredTopFields = ['name', 'defaultLanguage', 'startUpRef', 'tasks'];
  for (const req of requiredTopFields) {
    if (!seenTopKeys.has(req)) {
      errors.push({
        lineNumber: inboundRoot.lineNumber,
        code: 'MISSING_REQUIRED_FIELD',
        severity: 'error',
        field: req,
        message: `Pflichtfeld "inboundCall.${req}" fehlt im Archy YAML.`,
        suggestion: `Ergänze "${req}:" direkt unter "inboundCall:".`,
      });
    }
  }

  const nameEntry = topLevelEntries.find((e) => e.key === 'name');
  if (nameEntry) {
    if (!nameEntry.unquotedValue || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(nameEntry.unquotedValue)) {
      errors.push({
        lineNumber: nameEntry.lineNumber,
        code: 'INVALID_FLOW_NAME',
        severity: 'error',
        field: 'inboundCall.name',
        message: `Zeile ${nameEntry.lineNumber}: Ungültiger Flow-Name "${nameEntry.unquotedValue}" (keine Leerzeichen/Umlaute erlaubt).`,
        suggestion: 'Verwende einen YAML-sicheren Slug wie "Main_Inbound_Flow".',
      });
    }
  }

  const langEntry = topLevelEntries.find((e) => e.key === 'defaultLanguage');
  if (langEntry) {
    if (!/^[a-z]{2}-[a-z]{2}$/i.test(langEntry.unquotedValue)) {
      errors.push({
        lineNumber: langEntry.lineNumber,
        code: 'INVALID_LANGUAGE_CODE',
        severity: 'error',
        field: 'inboundCall.defaultLanguage',
        message: `Zeile ${langEntry.lineNumber}: Ungültiger Sprachcode "${langEntry.unquotedValue}".`,
        suggestion: 'Nutze einen gültigen BCP-47-Code wie "de-de" oder "en-us".',
      });
    }
  }

  const startUpRefEntry = topLevelEntries.find((e) => e.key === 'startUpRef');
  let expectedStartupRefId: string | null = null;
  if (startUpRefEntry) {
    const refMatch = startUpRefEntry.unquotedValue.match(
      /^\/inboundCall\/tasks\/task\[([A-Za-z_][A-Za-z0-9_.-]*)\]$/
    );
    if (!refMatch) {
      errors.push({
        lineNumber: startUpRefEntry.lineNumber,
        code: 'INVALID_REF_SYNTAX',
        severity: 'error',
        field: 'inboundCall.startUpRef',
        message: `Zeile ${startUpRefEntry.lineNumber}: Ungültige startUpRef-Syntax "${startUpRefEntry.unquotedValue}".`,
        suggestion: 'Erwartetes Format: "/inboundCall/tasks/task[Main_Task]".',
      });
    } else {
      expectedStartupRefId = refMatch[1];
    }
  }

  // Helper to validate a `variables:` block (either at Flow level or Task level)
  let variableCount = 0;
  const validateVariablesBlock = (
    varEntry: ParsedYamlLine,
    scopeContext: 'flow' | 'task'
  ) => {
    const varSectionIdx = parsed.indexOf(varEntry);
    const varBlock = collectIndentedBlock(parsed, varSectionIdx);
    const itemIndent = varEntry.indent + 2;
    const propIndent = varEntry.indent + 6;
    const declaredInScope = new Set<string>();

    for (const item of varBlock) {
      if (item.indent !== itemIndent || !item.isListItem) continue;
      variableCount += 1;

      if (!item.key || !ARCHY_VARIABLE_TYPES.has(item.key)) {
        errors.push({
          lineNumber: item.lineNumber,
          code: 'UNKNOWN_VARIABLE_TYPE',
          severity: 'error',
          field: item.key || 'variable',
          message: `Zeile ${item.lineNumber}: Ungültiger Variablentyp "${item.key || item.rawValue}".`,
          suggestion: 'Erlaubt sind: stringVariable, integerVariable, booleanVariable.',
        });
        continue;
      }

      const itemChildren = collectIndentedBlock(parsed, parsed.indexOf(item));
      const directProps = itemChildren.filter((c) => c.indent === propIndent && !c.isListItem);
      const vNameProp = directProps.find((p) => p.key === 'name');
      const vInitProp = directProps.find((p) => p.key === 'initialValue');

      if (!vNameProp || !vNameProp.unquotedValue) {
        errors.push({
          lineNumber: item.lineNumber,
          code: 'MISSING_VARIABLE_NAME',
          severity: 'error',
          field: 'variables[].name',
          message: `Zeile ${item.lineNumber}: Variablen-Definition ohne "name:"-Feld.`,
          suggestion: 'Vergib einen sauberen Variablennamen ohne Scope-Präfix, z. B. "avayaOriginScript".',
        });
      } else {
        const rawDeclName = vNameProp.unquotedValue;
        const dupKey = rawDeclName.toLowerCase();

        // Check duplicate BEFORE returning on scope error so both issues are surfaced
        if (declaredInScope.has(dupKey)) {
          errors.push({
            lineNumber: vNameProp.lineNumber,
            code: 'DUPLICATE_VARIABLE',
            severity: 'error',
            field: rawDeclName,
            message: `Zeile ${vNameProp.lineNumber}: Variable "${rawDeclName}" wurde im ${scopeContext === 'flow' ? 'Flow' : 'Task'}-Block doppelt deklariert.`,
            suggestion: 'Entferne die doppelte Variablendeklaration.',
          });
        } else {
          declaredInScope.add(dupKey);
        }

        // Strict Scope vs Name separation: declaration name must NOT embed scope prefix (Flow./Task./Global.)
        if (rawDeclName.includes('.')) {
          const scopePrefix = rawDeclName.split('.')[0];
          const isTaskInFlow = scopeContext === 'flow' && /^Task$/i.test(scopePrefix);
          errors.push({
            lineNumber: vNameProp.lineNumber,
            code: 'INVALID_VARIABLE_SCOPE',
            severity: 'error',
            field: rawDeclName,
            message: isTaskInFlow
              ? `Zeile ${vNameProp.lineNumber}: Task-Variable "${rawDeclName}" darf nicht im globalen Flow-Variablenblock deklariert werden.`
              : `Zeile ${vNameProp.lineNumber}: Ungültiger Scope-Präfix in Variablen-Deklaration "${rawDeclName}". Scope gehört nur in Referenzen (Flow.* / Task.*), nicht in den Deklarationsnamen.`,
            suggestion: isTaskInFlow
              ? `Deklariere "${rawDeclName.split('.').slice(1).join('_')}" lokal unter "task.variables:".`
              : `Deklariere die Variable ohne Präfix als "${rawDeclName.split('.').slice(1).join('_')}".`,
          });
        } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rawDeclName)) {
          errors.push({
            lineNumber: vNameProp.lineNumber,
            code: 'INVALID_VARIABLE_NAME',
            severity: 'error',
            field: rawDeclName,
            message: `Zeile ${vNameProp.lineNumber}: Ungültiger Variablenname "${rawDeclName}" (nur Buchstaben, Ziffern und Unterstriche erlaubt).`,
            suggestion: 'Nutze einen gültigen Bezeichner wie "customerNumber".',
          });
        }
      }

      if (!vInitProp) {
        errors.push({
          lineNumber: item.lineNumber,
          code: 'MISSING_INITIAL_VALUE',
          severity: 'error',
          field: 'variables[].initialValue',
          message: `Zeile ${item.lineNumber}: Variable "${vNameProp?.unquotedValue || '?'}" fehlt "initialValue:".`,
          suggestion: 'Ergänze "initialValue:" mit "lit:" oder "noValue: true".',
        });
      } else {
        const initChildren = collectIndentedBlock(parsed, parsed.indexOf(vInitProp));
        const hasWrapper = initChildren.some(
          (c) => c.key === 'lit' || c.key === 'exp' || c.key === 'noValue'
        );
        if (!hasWrapper && !/^(?:lit|exp|noValue)\s*:/.test(vInitProp.rawValue)) {
          errors.push({
            lineNumber: vInitProp.lineNumber,
            code: 'INVALID_VALUE_WRAPPER',
            severity: 'error',
            field: 'initialValue',
            message: `Zeile ${vInitProp.lineNumber}: "initialValue" benötigt einen Archy-Wrapper ("lit:", "exp:" oder "noValue:").`,
            suggestion: 'Schreibe z. B. "lit: \\"\\"" unterhalb von "initialValue:".',
          });
        }
      }
    }
  };

  // Pass 4: Flow-level Variables Validation
  const variablesEntry = topLevelEntries.find((e) => e.key === 'variables');
  if (variablesEntry) {
    validateVariablesBlock(variablesEntry, 'flow');
  }

  // Pass 5: Recursive Action List Validator
  let taskCount = 0;
  let actionCount = 0;
  const declaredTaskRefIds = new Map<string, number>();
  const referencedTaskRefs: Array<{ refId: string; lineNumber: number; field: string }> = [];
  const seenActionNames = new Map<string, number>();

  const validateActionListBlock = (actionsKeyLine: ParsedYamlLine) => {
    if (actionsKeyLine.rawValue === '[]') return;
    const actionsIdx = parsed.indexOf(actionsKeyLine);
    const actionsBlock = collectIndentedBlock(parsed, actionsIdx);
    const actionItemIndent = actionsKeyLine.indent + 2;
    const actionItems = actionsBlock.filter(
      (a) => a.indent === actionItemIndent && a.isListItem
    );

    if (
      actionsKeyLine.indent > 8 &&
      actionItems.length > 0 &&
      actionItems.every((a) => a.key === 'setParticipantData')
    ) {
      warnings.push({
        lineNumber: actionsKeyLine.lineNumber,
        code: 'DIAGNOSIS_ONLY_BRANCH',
        severity: 'warning',
        field: 'actions',
        message: `Zeile ${actionsKeyLine.lineNumber}: Branch enthält ausschließlich Diagnose-Aktionen (setParticipantData) ohne fachliche Weiterleitung oder Endpunkt.`,
        suggestion:
          'Ersetze reine Trace-/Diagnose-Branches durch echte Zielaktionen (Task, Common Module, Transfer, Disconnect) oder bereinige sie.',
      });
    }

    let hitTerminalInSequence = false;
    let terminalActionName = '';

    for (const actItem of actionItems) {
      actionCount += 1;
      const actType = actItem.key || '';

      if (hitTerminalInSequence) {
        errors.push({
          lineNumber: actItem.lineNumber,
          code: 'UNREACHABLE_AFTER_TERMINAL',
          severity: 'error',
          field: actType || 'action',
          message: `Zeile ${actItem.lineNumber}: Unerreichbare Action "${actType}" nach terminaler Action "${terminalActionName}" im selben Pfad.`,
          suggestion:
            'Beende sequenzielle Pfade nach transferToNumber, transferToAcd, transferToVoicemail, disconnect oder jumpToReusableTask.',
        });
      }

      const schemaRule = ARCHY_ACTION_SCHEMA[actType];
      if (!schemaRule) {
        errors.push({
          lineNumber: actItem.lineNumber,
          code: 'UNKNOWN_ACTION_TYPE',
          severity: 'error',
          field: actType || actItem.rawValue,
          message: `Zeile ${actItem.lineNumber}: Unbekannter oder nicht erlaubter Archy-Action-Key "${actType || actItem.rawValue}".`,
          suggestion:
            'Verwende ausschließlich offizielle Archy-Actions (z. B. playAudio, transferToAcd, callDataAction, evaluateScheduleGroup, jumpToReusableTask, disconnect).',
        });
        continue;
      }

      const actGlobalIdx = parsed.indexOf(actItem);
      const actChildren = collectIndentedBlock(parsed, actGlobalIdx);
      const actPropIndent = actItem.indent + 4;
      const actProps = actChildren.filter((c) => c.indent === actPropIndent && !c.isListItem);
      const seenActProps = new Map<string, ParsedYamlLine>();

      for (const prop of actProps) {
        if (!prop.key) continue;
        if (seenActProps.has(prop.key)) {
          errors.push({
            lineNumber: prop.lineNumber,
            code: 'DUPLICATE_KEY',
            severity: 'error',
            field: `${actType}.${prop.key}`,
            message: `Zeile ${prop.lineNumber}: Doppeltes Feld "${prop.key}" in Action "${actType}".`,
          });
        } else {
          seenActProps.set(prop.key, prop);
        }

        if (!schemaRule.allowed.has(prop.key)) {
          errors.push({
            lineNumber: prop.lineNumber,
            code: 'UNKNOWN_ACTION_PROPERTY',
            severity: 'error',
            field: `${actType}.${prop.key}`,
            message: `Zeile ${prop.lineNumber}: Nicht erlaubtes Feld "${prop.key}" in Action "${actType}".`,
            suggestion: `Erlaubte Felder für ${actType}: ${Array.from(schemaRule.allowed).join(', ')}.`,
          });
        }
      }

      for (const reqProp of schemaRule.required) {
        if (!seenActProps.has(reqProp)) {
          errors.push({
            lineNumber: actItem.lineNumber,
            code: 'MISSING_ACTION_PROPERTY',
            severity: 'error',
            field: `${actType}.${reqProp}`,
            message: `Zeile ${actItem.lineNumber}: Action "${actType}" fehlt das Pflichtfeld "${reqProp}:".`,
            suggestion: `Ergänze "${reqProp}:" innerhalb von "${actType}".`,
          });
        }
      }

      // Duplicate action name check
      const actNameProp = seenActProps.get('name');
      if (actNameProp && actNameProp.unquotedValue) {
        const lowerName = actNameProp.unquotedValue.toLowerCase();
        if (seenActionNames.has(lowerName)) {
          warnings.push({
            lineNumber: actNameProp.lineNumber,
            code: 'DUPLICATE_ACTION_NAME',
            severity: 'warning',
            field: `${actType}.name`,
            message: `Zeile ${actNameProp.lineNumber}: Doppelter Action-Name "${actNameProp.unquotedValue}" (bereits in Zeile ${seenActionNames.get(lowerName)}).`,
            suggestion: 'Vergib eindeutige Action-Namen zur besseren Wartbarkeit in Architect.',
          });
        } else {
          seenActionNames.set(lowerName, actNameProp.lineNumber);
        }
      }

      // Action-specific semantic & recursive sub-branch checks
      if (actType === 'callTask' || actType === 'jumpToReusableTask') {
        const refProp = seenActProps.get('targetTaskRef');
        if (refProp) {
          const m = refProp.unquotedValue.match(
            /^\/inboundCall\/tasks\/task\[([A-Za-z_][A-Za-z0-9_.-]*)\]$/
          );
          if (!m) {
            errors.push({
              lineNumber: refProp.lineNumber,
              code: 'INVALID_REF_SYNTAX',
              severity: 'error',
              field: `${actType}.targetTaskRef`,
              message: `Zeile ${refProp.lineNumber}: Ungültige targetTaskRef-Syntax "${refProp.unquotedValue}".`,
              suggestion: 'Erwartetes Format: "/inboundCall/tasks/task[<RefId>]".',
            });
          } else {
            referencedTaskRefs.push({
              refId: m[1],
              lineNumber: refProp.lineNumber,
              field: `${actType}.targetTaskRef`,
            });
          }
        }
      } else if (actType === 'callDataAction') {
        const daProp = seenActProps.get('dataAction');
        if (daProp) {
          const daChildren = collectIndentedBlock(parsed, parsed.indexOf(daProp));
          const hasCat = daChildren.some((c) => c.key === 'category' && Boolean(c.unquotedValue));
          const hasName = daChildren.some(
            (c) => c.key === 'dataAction' && Boolean(c.unquotedValue)
          );
          if (!hasCat) {
            errors.push({
              lineNumber: daProp.lineNumber,
              code: 'MISSING_ACTION_PROPERTY',
              severity: 'error',
              field: 'callDataAction.dataAction.category',
              message: `Zeile ${daProp.lineNumber}: callDataAction fehlt "category:" (z. B. Oracle_Integration oder FlixCheck_API).`,
            });
          }
          if (!hasName) {
            errors.push({
              lineNumber: daProp.lineNumber,
              code: 'MISSING_ACTION_PROPERTY',
              severity: 'error',
              field: 'callDataAction.dataAction.dataAction',
              message: `Zeile ${daProp.lineNumber}: callDataAction fehlt der Name unter "dataAction:".`,
            });
          }
        }
      } else if (actType === 'decision') {
        const condProp = seenActProps.get('condition');
        if (condProp) {
          const condChildren = collectIndentedBlock(parsed, parsed.indexOf(condProp));
          const expLine = condChildren.find((c) => c.key === 'exp');
          if (
            expLine &&
            /(?:Flow\.avayaCondition\s*==\s*["']true["']|Task\.checkResult\s*==\s*true)/i.test(
              expLine.unquotedValue
            )
          ) {
            warnings.push({
              lineNumber: expLine.lineNumber,
              code: 'PLACEHOLDER_CONDITION',
              severity: 'warning',
              field: 'decision.condition.exp',
              message: `Zeile ${expLine.lineNumber}: Platzhalter-Bedingung ("${expLine.unquotedValue}") statt echter Fachlogik.`,
              suggestion: 'Ersetze den Platzhalter durch eine konkrete Architect-Expression mit belegter Datenquelle.',
            });
          }
        }
      } else if (actType === 'loop') {
        const maxProp = seenActProps.get('maxLoopCount');
        if (maxProp) {
          let numVal = Number(maxProp.unquotedValue);
          if (!maxProp.unquotedValue) {
            const maxChildren = collectIndentedBlock(parsed, parsed.indexOf(maxProp));
            const litChild = maxChildren.find((c) => c.key === 'lit');
            numVal = litChild ? Number(litChild.unquotedValue) : NaN;
          }
          if (!Number.isInteger(numVal) || numVal <= 0) {
            errors.push({
              lineNumber: maxProp.lineNumber,
              code: 'INVALID_ACTION_VALUE',
              severity: 'error',
              field: 'loop.maxLoopCount',
              message: `Zeile ${maxProp.lineNumber}: "maxLoopCount" muss eine positive Ganzzahl > 0 sein.`,
              suggestion: 'Setze z. B. "maxLoopCount: 5".',
            });
          }
        }
        const loopActsProp = seenActProps.get('actions');
        if (loopActsProp) {
          validateActionListBlock(loopActsProp);
        }
      } else if (actType === 'transferToVoicemail') {
        if (!seenActProps.has('targetQueue') && !seenActProps.has('targetUser')) {
          errors.push({
            lineNumber: actItem.lineNumber,
            code: 'MISSING_ACTION_PROPERTY',
            severity: 'error',
            field: 'transferToVoicemail.targetQueue',
            message: `Zeile ${actItem.lineNumber}: transferToVoicemail benötigt entweder "targetQueue:" oder "targetUser:".`,
          });
        }
      } else if (actType === 'delay') {
        const secProp = seenActProps.get('seconds');
        if (secProp) {
          const secChildren = collectIndentedBlock(parsed, parsed.indexOf(secProp));
          const litNode = secChildren.find((c) => c.key === 'lit');
          const expNode = secChildren.find((c) => c.key === 'exp');
          if (!litNode && !expNode) {
            errors.push({
              lineNumber: secProp.lineNumber,
              code: 'INVALID_VALUE_WRAPPER',
              severity: 'error',
              field: 'delay.seconds',
              message: `Zeile ${secProp.lineNumber}: "delay.seconds" benötigt "lit:" oder "exp:".`,
            });
          } else if (
            litNode &&
            (!Number.isFinite(Number(litNode.unquotedValue)) || Number(litNode.unquotedValue) <= 0)
          ) {
            errors.push({
              lineNumber: litNode.lineNumber,
              code: 'INVALID_ACTION_VALUE',
              severity: 'error',
              field: 'delay.seconds.lit',
              message: `Zeile ${litNode.lineNumber}: "delay.seconds.lit" muss eine positive Zahl > 0 sein.`,
            });
          }
        }
      } else if (actType === 'playHoldMusic') {
        warnings.push({
          lineNumber: actItem.lineNumber,
          code: 'IN_QUEUE_ACTION_HINT',
          severity: 'warning',
          field: 'playHoldMusic',
          message: `Zeile ${actItem.lineNumber}: playHoldMusic wird in Genesys Cloud üblicherweise in einem In-Queue Call Flow konfiguriert.`,
        });
      }

      // Recursively validate nested `outputs.*.actions`
      const outProp = seenActProps.get('outputs');
      if (outProp) {
        const outChildren = collectIndentedBlock(parsed, parsed.indexOf(outProp));
        const branchIndent = outProp.indent + 2;
        const branches = outChildren.filter((c) => c.indent === branchIndent && !c.isListItem);

        if (actType === 'evaluateScheduleGroup') {
          const hasBranch = branches.some(
            (c) => c.key === 'open' || c.key === 'closed' || c.key === 'holiday'
          );
          if (!hasBranch) {
            warnings.push({
              lineNumber: outProp.lineNumber,
              code: 'INCOMPLETE_SCHEDULE_OUTPUTS',
              severity: 'warning',
              field: 'evaluateScheduleGroup.outputs',
              message: `Zeile ${outProp.lineNumber}: evaluateScheduleGroup enthält keine Ausgänge (open/closed/holiday).`,
              suggestion: 'Definiere mindestens die Pfade "open:", "closed:" und "holiday:".',
            });
          }
        }

        let nonEmptyDecisionBranches = 0;
        for (const br of branches) {
          const brChildren = collectIndentedBlock(parsed, parsed.indexOf(br));
          const brActionsLine = brChildren.find(
            (c) => c.indent === br.indent + 2 && !c.isListItem && c.key === 'actions'
          );
          if (brActionsLine) {
            if (brActionsLine.rawValue !== '[]') nonEmptyDecisionBranches += 1;
            validateActionListBlock(brActionsLine);
          }
        }

        if (actType === 'decision' && branches.length > 0 && nonEmptyDecisionBranches === 0) {
          warnings.push({
            lineNumber: actItem.lineNumber,
            code: 'EMPTY_DECISION_BRANCHES',
            severity: 'warning',
            field: 'decision.outputs',
            message: `Zeile ${actItem.lineNumber}: Decision hat ausschließlich leere yes/no-Ausgänge.`,
            suggestion: 'Fülle mindestens einen Zweig mit konkreten Architect-Aktionen.',
          });
        }
      }

      // Recursively validate switch `cases[].case.actions` and `default.actions`
      if (actType === 'switch') {
        const casesProp = seenActProps.get('cases');
        if (casesProp) {
          const casesChildren = collectIndentedBlock(parsed, parsed.indexOf(casesProp));
          const caseItems = casesChildren.filter(
            (c) => c.indent === casesProp.indent + 2 && c.isListItem && c.key === 'case'
          );
          for (const ci of caseItems) {
            const ciChildren = collectIndentedBlock(parsed, parsed.indexOf(ci));
            const ciActions = ciChildren.find(
              (c) => c.indent === ci.indent + 4 && !c.isListItem && c.key === 'actions'
            );
            if (ciActions) validateActionListBlock(ciActions);
          }
        }
        const defProp = seenActProps.get('default');
        if (defProp) {
          const defChildren = collectIndentedBlock(parsed, parsed.indexOf(defProp));
          const defActions = defChildren.find(
            (c) => c.indent === defProp.indent + 2 && !c.isListItem && c.key === 'actions'
          );
          if (defActions) validateActionListBlock(defActions);
        }
      }

      if (TERMINAL_ACTION_TYPES.has(actType)) {
        hitTerminalInSequence = true;
        terminalActionName = actType;
      }
    }
  };

  // Validate Tasks
  const tasksEntry = topLevelEntries.find((e) => e.key === 'tasks');
  if (tasksEntry) {
    const tasksIdx = parsed.indexOf(tasksEntry);
    const tasksBlock = collectIndentedBlock(parsed, tasksIdx);
    const taskItems = tasksBlock.filter((p) => p.indent === 4 && p.isListItem);

    if (taskItems.length === 0) {
      errors.push({
        lineNumber: tasksEntry.lineNumber,
        code: 'EMPTY_TASKS',
        severity: 'error',
        field: 'inboundCall.tasks',
        message: `Zeile ${tasksEntry.lineNumber}: "tasks:" enthält keinen "- task:"-Block.`,
        suggestion: 'Füge mindestens einen Task (z. B. Main_Task) unter "tasks:" ein.',
      });
    }

    for (const taskItem of taskItems) {
      if (taskItem.key !== 'task') {
        errors.push({
          lineNumber: taskItem.lineNumber,
          code: 'UNKNOWN_TASK_ITEM',
          severity: 'error',
          field: taskItem.key || 'tasks[]',
          message: `Zeile ${taskItem.lineNumber}: Ungültiges Element "${taskItem.key || taskItem.rawValue}" unter "tasks:". Erwartet "- task:".`,
          suggestion: 'Verwende "- task:" für jeden Task-Eintrag.',
        });
        continue;
      }

      taskCount += 1;
      const taskGlobalIdx = parsed.indexOf(taskItem);
      const taskChildren = collectIndentedBlock(parsed, taskGlobalIdx);
      const taskProps = taskChildren.filter((c) => c.indent === 8 && !c.isListItem);

      const seenTaskKeys = new Set<string>();
      for (const prop of taskProps) {
        if (!prop.key) continue;
        if (seenTaskKeys.has(prop.key)) {
          errors.push({
            lineNumber: prop.lineNumber,
            code: 'DUPLICATE_KEY',
            severity: 'error',
            field: `task.${prop.key}`,
            message: `Zeile ${prop.lineNumber}: Doppelter Key "${prop.key}" im Task-Block.`,
          });
        }
        seenTaskKeys.add(prop.key);
        if (!ARCHY_TASK_ALLOWED_KEYS.has(prop.key)) {
          errors.push({
            lineNumber: prop.lineNumber,
            code: 'UNKNOWN_TASK_PROPERTY',
            severity: 'error',
            field: `task.${prop.key}`,
            message: `Zeile ${prop.lineNumber}: Unbekanntes Task-Feld "${prop.key}".`,
            suggestion: 'Erlaubte Task-Felder: name, refId, variables, actions.',
          });
        }
      }

      const taskNameProp = taskProps.find((p) => p.key === 'name');
      const taskRefIdProp = taskProps.find((p) => p.key === 'refId');
      const taskVarsProp = taskProps.find((p) => p.key === 'variables');
      const taskActionsProp = taskProps.find((p) => p.key === 'actions');

      if (!taskNameProp || !taskNameProp.unquotedValue) {
        errors.push({
          lineNumber: taskItem.lineNumber,
          code: 'MISSING_TASK_FIELD',
          severity: 'error',
          field: 'task.name',
          message: `Zeile ${taskItem.lineNumber}: Task fehlt das Pflichtfeld "name:".`,
        });
      }
      if (!taskRefIdProp || !taskRefIdProp.unquotedValue) {
        errors.push({
          lineNumber: taskItem.lineNumber,
          code: 'MISSING_TASK_FIELD',
          severity: 'error',
          field: 'task.refId',
          message: `Zeile ${taskItem.lineNumber}: Task fehlt das Pflichtfeld "refId:".`,
          suggestion: 'Ergänze eine eindeutige refId (z. B. "refId: Main_Task").',
        });
      } else {
        const refIdVal = taskRefIdProp.unquotedValue;
        if (declaredTaskRefIds.has(refIdVal)) {
          errors.push({
            lineNumber: taskRefIdProp.lineNumber,
            code: 'DUPLICATE_TASK_REF_ID',
            severity: 'error',
            field: refIdVal,
            message: `Zeile ${taskRefIdProp.lineNumber}: Doppelte Task-refId "${refIdVal}" (bereits in Zeile ${declaredTaskRefIds.get(refIdVal)}).`,
            suggestion: 'Jeder Task benötigt eine eindeutige refId.',
          });
        } else {
          declaredTaskRefIds.set(refIdVal, taskRefIdProp.lineNumber);
        }
      }

      if (taskVarsProp) {
        validateVariablesBlock(taskVarsProp, 'task');
      }

      if (!taskActionsProp) {
        errors.push({
          lineNumber: taskItem.lineNumber,
          code: 'MISSING_TASK_FIELD',
          severity: 'error',
          field: 'task.actions',
          message: `Zeile ${taskItem.lineNumber}: Task "${taskNameProp?.unquotedValue || '?'}" fehlt der Block "actions:".`,
        });
        continue;
      }

      validateActionListBlock(taskActionsProp);
    }
  }

  // Pass 6: Cross-Reference Integrity (startUpRef, callTask & jumpToReusableTask targetTaskRef)
  if (expectedStartupRefId && !declaredTaskRefIds.has(expectedStartupRefId)) {
    errors.push({
      lineNumber: startUpRefEntry?.lineNumber || 1,
      code: 'UNRESOLVED_STARTUP_REF',
      severity: 'error',
      field: 'inboundCall.startUpRef',
      message: `Zeile ${startUpRefEntry?.lineNumber || 1}: startUpRef verweist auf nicht existierende Task-refId "${expectedStartupRefId}".`,
      suggestion:
        declaredTaskRefIds.size > 0
          ? `Verfügbare Task-refIds: ${Array.from(declaredTaskRefIds.keys()).join(', ')}.`
          : 'Lege einen Task mit dieser refId unter "tasks:" an.',
    });
  }

  for (const ref of referencedTaskRefs) {
    if (!declaredTaskRefIds.has(ref.refId)) {
      errors.push({
        lineNumber: ref.lineNumber,
        code: 'UNRESOLVED_TASK_REF',
        severity: 'error',
        field: ref.field,
        message: `Zeile ${ref.lineNumber}: ${ref.field} verweist auf unbekannte lokale Task-refId "${ref.refId}".`,
        suggestion: `Definiere einen Task mit "refId: ${ref.refId}" unter "tasks:" oder nutze "callCommonModule:".`,
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stats: {
      lineCount: rawLines.length,
      taskCount,
      actionCount,
      variableCount,
    },
  };
}

// ============================================================================
// EBENE 2B: GRAPH-BASED GENESYS MERMAID RENDERER (True Branching & Terminals)
// ============================================================================

export function generateGenesysMermaid(
  input: GenesysScriptTranslation | GenesysWorkspaceTranslation,
  options?: { scriptNumber?: string }
): string {
  if ('scripts' in input) {
    if (options?.scriptNumber) {
      const key = canonicalScriptMatchKey(options.scriptNumber);
      const found = input.scriptsByKey[key];
      if (found) {
        return generateSingleScriptGenesysMermaid(found);
      }
    }
    return generateWorkspaceOverviewGenesysMermaid(input);
  }
  return generateSingleScriptGenesysMermaid(input);
}

function generateSingleScriptGenesysMermaid(script: GenesysScriptTranslation): string {
  const graph = script.migrationGraph;
  const lines: string[] = [];
  lines.push('flowchart TD');
  lines.push(
    `  %% Genesys Cloud Architect Ziel-Flow (${script.fileName} | Readiness: ${script.readiness} | Branches: ${graph.diagnostics.branchNodeCount} | Dead Paths Pruned: ${graph.diagnostics.prunedUnreachableCount})`
  );

  const startId = 'GC_START';
  const entryTag = script.isEntryPoint
    ? 'Inbound Call Flow'
    : script.isCommonModuleTarget
    ? 'Common Module Flow'
    : 'Architect Reusable Task';
  lines.push(
    `  ${startId}(["${escapeMermaidLabel(`${entryTag}: ${script.cleanName} [${script.readiness}]`)}"])`
  );

  const classBuckets: Record<string, string[]> = {
    gcStart: [startId],
    gcAudio: [],
    gcDecision: [],
    gcLoop: [],
    gcCommon: [],
    gcTask: [],
    gcQueue: [],
    gcBullseye: [],
    gcOracle: [],
    gcFlixcheck: [],
    gcData: [],
    gcTransfer: [],
    gcDisconnect: [],
    gcBroken: [],
    gcSchedule: [],
    gcInQueue: [],
    gcPriority: [],
    gcCallback: [],
    gcEmergency: [],
    gcDataTable: [],
    gcSysVar: [],
  };

  let nodeSeq = 0;
  const taskEntryNodeByRefId = new Map<string, string>();
  const deferredTaskEdges: Array<{ fromId: string; targetRefId: string; label: string; dashed: boolean }> = [];

  const emitNode = (step: MigrationStep): string => {
    nodeSeq += 1;
    const nodeId = toSafeMermaidId('GC_N', `${step.kind}_${nodeSeq}`);
    const targetClean = escapeMermaidLabel(step.target || step.variableName || '');
    const lineHint = step.lineNumber > 0 ? ` · Z.${step.lineNumber}` : '';

    switch (step.kind) {
      case 'playAudio':
        lines.push(`  ${nodeId}["Play Audio: Prompt.${escapeMermaidLabel(step.targetSlug || targetClean)}${lineHint}"]`);
        classBuckets.gcAudio.push(nodeId);
        break;
      case 'collectInput':
        lines.push(
          `  ${nodeId}{"Collect Input: ${escapeMermaidLabel(step.inputVarRef || 'Task.collectedDigits')} (${targetClean})"}`
        );
        classBuckets.gcDecision.push(nodeId);
        break;
      case 'menu':
        lines.push(`  ${nodeId}{"Menu: ${targetClean}${lineHint}"}`);
        classBuckets.gcDecision.push(nodeId);
        break;
      case 'callDataAction':
        if (step.dataActionCategory === 'FlixCheck_API') {
          lines.push(`  ${nodeId}["Data Action: FlixCheck (${targetClean})"]`);
          classBuckets.gcFlixcheck.push(nodeId);
        } else if (step.dataActionCategory === 'Genesys_Cloud_Data_Actions') {
          lines.push(`  ${nodeId}["Data Action: Queue Observations (${targetClean})"]`);
          classBuckets.gcPriority.push(nodeId);
        } else {
          lines.push(`  ${nodeId}["Data Action: Oracle (${targetClean})"]`);
          classBuckets.gcOracle.push(nodeId);
        }
        break;
      case 'callCommonModule':
        lines.push(`  ${nodeId}[["Common Module: ${targetClean}"]]`);
        if (step.isBrokenTarget) classBuckets.gcBroken.push(nodeId);
        else classBuckets.gcCommon.push(nodeId);
        break;
      case 'callTask':
        lines.push(`  ${nodeId}["Call Task: ${targetClean}"]`);
        if (step.isBrokenTarget) classBuckets.gcBroken.push(nodeId);
        else classBuckets.gcTask.push(nodeId);
        break;
      case 'jumpToReusableTask':
        lines.push(`  ${nodeId}["Jump to Task: ${escapeMermaidLabel(step.targetTaskRefId || targetClean)}"]`);
        classBuckets.gcTask.push(nodeId);
        break;
      case 'decision':
        if (step.isEmergencyCheck) {
          lines.push(`  ${nodeId}{"Emergency Check: ${escapeMermaidLabel(step.expression || 'Emergency')}"}`);
          classBuckets.gcEmergency.push(nodeId);
        } else {
          lines.push(`  ${nodeId}{"Decision: ${escapeMermaidLabel(step.expression || step.conditionLabel || 'Check')}"}`);
          classBuckets.gcDecision.push(nodeId);
        }
        break;
      case 'switch':
        lines.push(`  ${nodeId}{"Switch: ${escapeMermaidLabel(step.variableRef || targetClean || 'Auswahl')}"}`);
        classBuckets.gcDecision.push(nodeId);
        break;
      case 'loop':
        lines.push(
          `  ${nodeId}{{"Loop (max ${step.maxLoopCount ?? 5}): ${targetClean} [Warnung: Rueckwaerts-GOTO]"}}`
        );
        classBuckets.gcLoop.push(nodeId);
        break;
      case 'setParticipantData':
        lines.push(`  ${nodeId}[/"Set Participant Data: ${targetClean}"/]`);
        classBuckets.gcData.push(nodeId);
        break;
      case 'getParticipantData':
        lines.push(`  ${nodeId}[/"Get Participant Data: ${targetClean}"/]`);
        classBuckets.gcData.push(nodeId);
        break;
      case 'updateData':
        if (step.expressionValue && /^Call\./.test(step.expressionValue)) {
          lines.push(
            `  ${nodeId}[/"System-Variable: ${escapeMermaidLabel(step.variableRef || targetClean)} = ${escapeMermaidLabel(step.expressionValue)}"/]`
          );
          classBuckets.gcSysVar.push(nodeId);
        } else {
          lines.push(`  ${nodeId}["Update Data: ${escapeMermaidLabel(step.variableRef || targetClean)}"]`);
          classBuckets.gcData.push(nodeId);
        }
        break;
      case 'transferToAcd':
        if (step.isMultiSkillset) {
          const skillList = escapeMermaidLabel((step.skills || []).join(', '));
          lines.push(`  ${nodeId}[("ACD Queue + Bullseye: ${targetClean} | Skills: ${skillList}")]`);
          classBuckets.gcBullseye.push(nodeId);
        } else {
          lines.push(`  ${nodeId}[("ACD Queue: ${targetClean}")]`);
          classBuckets.gcQueue.push(nodeId);
        }
        break;
      case 'transferToNumber':
        lines.push(`  ${nodeId}["Transfer to Number: ${escapeMermaidLabel(step.normalizedE164 || targetClean)}"]`);
        classBuckets.gcTransfer.push(nodeId);
        break;
      case 'disconnect':
        lines.push(`  ${nodeId}(["Disconnect${targetClean ? `: ${targetClean}` : ''}"])`);
        classBuckets.gcDisconnect.push(nodeId);
        break;
      case 'evaluateScheduleGroup':
        lines.push(`  ${nodeId}{{"Schedule Group: ${targetClean}"}}`);
        classBuckets.gcSchedule.push(nodeId);
        break;
      case 'playHoldMusic':
        lines.push(`  ${nodeId}["Hold Music (In-Queue): ${targetClean}"]`);
        classBuckets.gcInQueue.push(nodeId);
        break;
      case 'delay':
        lines.push(`  ${nodeId}["Delay (In-Queue): ${step.delaySeconds ?? 10}s"]`);
        classBuckets.gcInQueue.push(nodeId);
        break;
      case 'setPriority':
        lines.push(`  ${nodeId}["Set Priority: ${step.priorityValue ?? 50}"]`);
        classBuckets.gcPriority.push(nodeId);
        break;
      case 'createCallback':
        lines.push(`  ${nodeId}["Create Callback: ${targetClean} (Call.Ani)"]`);
        classBuckets.gcCallback.push(nodeId);
        break;
      case 'transferToVoicemail':
        lines.push(`  ${nodeId}[("Transfer to Voicemail: ${targetClean}")]`);
        classBuckets.gcCallback.push(nodeId);
        break;
      case 'setLanguage':
        lines.push(`  ${nodeId}["Set Language: ${escapeMermaidLabel(step.languageCode || 'de-de')}"]`);
        classBuckets.gcCallback.push(nodeId);
        break;
      case 'callDataTableLookup':
        lines.push(`  ${nodeId}[("Data Table Lookup: ${targetClean}")]`);
        classBuckets.gcDataTable.push(nodeId);
        break;
      case 'setUuiData':
        lines.push(
          `  ${nodeId}[/"Set UUI Data: ${escapeMermaidLabel(step.expressionValue || 'Call.UserToUserInformation')}"/]`
        );
        classBuckets.gcSysVar.push(nodeId);
        break;
    }

    return nodeId;
  };

  const connectFromParents = (
    parents: Array<{ id: string; label?: string; dashed?: boolean }>,
    childId: string
  ) => {
    for (const p of parents) {
      if (p.dashed) {
        if (p.label) lines.push(`  ${p.id} -.->|"${escapeMermaidLabel(p.label)}"| ${childId}`);
        else lines.push(`  ${p.id} -.-> ${childId}`);
      } else if (p.label) {
        lines.push(`  ${p.id} -->|"${escapeMermaidLabel(p.label)}"| ${childId}`);
      } else {
        lines.push(`  ${p.id} --> ${childId}`);
      }
    }
  };

  /**
   * Renders a sequence of MigrationSteps and returns the list of non-terminal exit connectors.
   */
  const renderStepSequence = (
    steps: MigrationStep[],
    incoming: Array<{ id: string; label?: string; dashed?: boolean }>
  ): Array<{ id: string; label?: string; dashed?: boolean }> => {
    let currentExits = incoming;

    for (const step of steps) {
      if (currentExits.length === 0) break;
      const nodeId = emitNode(step);
      connectFromParents(
        currentExits.map((e) => ({
          ...e,
          dashed: e.dashed || step.kind === 'loop' || Boolean(step.isBrokenTarget),
          label:
            e.label ||
            (step.kind === 'loop'
              ? 'Rueckwaerts-GOTO -> Loop'
              : step.isBrokenTarget
              ? 'Broken Target'
              : undefined),
        })),
        nodeId
      );

      if (step.kind === 'jumpToReusableTask' && step.targetTaskRefId) {
        deferredTaskEdges.push({
          fromId: nodeId,
          targetRefId: step.targetTaskRefId,
          label: 'Jump',
          dashed: false,
        });
        currentExits = [];
        break;
      }

      if (step.kind === 'callTask' && step.targetTaskRefId) {
        deferredTaskEdges.push({
          fromId: nodeId,
          targetRefId: step.targetTaskRefId,
          label: 'Subtask',
          dashed: true,
        });
      }

      if (step.isTerminal) {
        currentExits = [];
        break;
      }

      if (step.kind === 'decision') {
        const yesExits =
          step.yesSteps && step.yesSteps.length > 0
            ? renderStepSequence(step.yesSteps, [{ id: nodeId, label: 'Ja' }])
            : [{ id: nodeId, label: 'Ja' }];
        const noExits =
          step.noSteps && step.noSteps.length > 0
            ? renderStepSequence(step.noSteps, [{ id: nodeId, label: 'Nein' }])
            : [{ id: nodeId, label: 'Nein' }];
        currentExits = [...yesExits, ...noExits];
      } else if (step.kind === 'evaluateScheduleGroup') {
        const openExits =
          step.openSteps && step.openSteps.length > 0
            ? renderStepSequence(step.openSteps, [{ id: nodeId, label: 'Offen' }])
            : [{ id: nodeId, label: 'Offen' }];
        const closedExits =
          step.closedSteps && step.closedSteps.length > 0
            ? renderStepSequence(step.closedSteps, [{ id: nodeId, label: 'Geschlossen' }])
            : [];
        const holidayExits =
          step.holidaySteps && step.holidaySteps.length > 0
            ? renderStepSequence(step.holidaySteps, [{ id: nodeId, label: 'Feiertag' }])
            : [];
        currentExits = [...openExits, ...closedExits, ...holidayExits];
      } else if (step.kind === 'collectInput') {
        const succExits =
          step.successSteps && step.successSteps.length > 0
            ? renderStepSequence(step.successSteps, [{ id: nodeId, label: 'Eingabe OK' }])
            : [{ id: nodeId, label: 'Eingabe OK' }];
        const failExits =
          step.failureSteps && step.failureSteps.length > 0
            ? renderStepSequence(step.failureSteps, [{ id: nodeId, label: 'Fehler/Timeout', dashed: true }])
            : [];
        currentExits = [...succExits, ...failExits];
      } else if (step.kind === 'callDataAction') {
        const succExits =
          step.successSteps && step.successSteps.length > 0
            ? renderStepSequence(step.successSteps, [{ id: nodeId, label: 'Erfolg' }])
            : [{ id: nodeId, label: 'Erfolg' }];
        const failExits =
          step.failureSteps && step.failureSteps.length > 0
            ? renderStepSequence(step.failureSteps, [{ id: nodeId, label: 'Fehler', dashed: true }])
            : [];
        const toExits =
          step.timeoutSteps && step.timeoutSteps.length > 0
            ? renderStepSequence(step.timeoutSteps, [{ id: nodeId, label: 'Timeout', dashed: true }])
            : [];
        currentExits = [...succExits, ...failExits, ...toExits];
      } else if (step.kind === 'switch') {
        const allExits: Array<{ id: string; label?: string; dashed?: boolean }> = [];
        for (const c of step.cases || []) {
          const ce =
            c.steps.length > 0
              ? renderStepSequence(c.steps, [{ id: nodeId, label: `Wert "${c.value}"` }])
              : [{ id: nodeId, label: `Wert "${c.value}"` }];
          allExits.push(...ce);
        }
        const de =
          step.defaultSteps && step.defaultSteps.length > 0
            ? renderStepSequence(step.defaultSteps, [{ id: nodeId, label: 'Default', dashed: true }])
            : [{ id: nodeId, label: 'Default', dashed: true }];
        currentExits = [...allExits, ...de];
      } else if (step.kind === 'callDataTableLookup') {
        const foundExits =
          step.foundSteps && step.foundSteps.length > 0
            ? renderStepSequence(step.foundSteps, [{ id: nodeId, label: 'Gefunden' }])
            : [{ id: nodeId, label: 'Gefunden' }];
        const notFoundExits =
          step.notFoundSteps && step.notFoundSteps.length > 0
            ? renderStepSequence(step.notFoundSteps, [{ id: nodeId, label: 'Nicht gefunden', dashed: true }])
            : [];
        currentExits = [...foundExits, ...notFoundExits];
      } else {
        currentExits = [{ id: nodeId }];
      }
    }

    return currentExits;
  };

  // Render entry task directly from GC_START
  const entryTask = graph.tasks.find((t) => t.refId === graph.entryTaskRefId) || graph.tasks[0];
  if (entryTask) {
    taskEntryNodeByRefId.set(entryTask.refId, startId);
    renderStepSequence(entryTask.steps, [{ id: startId }]);
  }

  // Render secondary Reusable Tasks (SECTIONs, hydrated subscripts, Fallback_Error_Task)
  for (const task of graph.tasks) {
    if (entryTask && task.refId === entryTask.refId) continue;
    const taskHeaderId = toSafeMermaidId('GC_TASK', task.refId);
    taskEntryNodeByRefId.set(task.refId, taskHeaderId);
    const kindLabel =
      task.kind === 'section'
        ? 'Section Task'
        : task.kind === 'fallback'
        ? 'Fallback Task'
        : 'Reusable Task';
    lines.push(`  ${taskHeaderId}[["${kindLabel}: ${escapeMermaidLabel(task.name)}"]]`);
    classBuckets.gcTask.push(taskHeaderId);
    renderStepSequence(task.steps, [{ id: taskHeaderId }]);
  }

  // Connect cross-task jumps & calls
  const emittedCross = new Set<string>();
  for (const edge of deferredTaskEdges) {
    const targetNodeId = taskEntryNodeByRefId.get(edge.targetRefId);
    if (!targetNodeId || targetNodeId === edge.fromId) continue;
    const key = `${edge.fromId}->${targetNodeId}`;
    if (emittedCross.has(key)) continue;
    emittedCross.add(key);
    if (edge.dashed) {
      lines.push(`  ${edge.fromId} -.->|"${escapeMermaidLabel(edge.label)}"| ${targetNodeId}`);
    } else {
      lines.push(`  ${edge.fromId} -->|"${escapeMermaidLabel(edge.label)}"| ${targetNodeId}`);
    }
  }

  appendGenesysClassDefs(lines, classBuckets);
  return lines.join('\n');
}

function generateWorkspaceOverviewGenesysMermaid(
  workspace: GenesysWorkspaceTranslation
): string {
  const lines: string[] = [];
  lines.push('flowchart TD');
  lines.push(
    `  %% Genesys Cloud CX Gesamt-Architektur (${workspace.summary.totalScripts} Skripte | Overall Readiness: ${workspace.overallReadiness})`
  );

  if (workspace.scripts.length === 0) {
    lines.push('  GC_EMPTY["Keine Avaya-Skripte geladen"]');
    return lines.join('\n');
  }

  const classBuckets: Record<string, string[]> = {
    gcStart: [],
    gcAudio: [],
    gcDecision: [],
    gcLoop: [],
    gcCommon: [],
    gcTask: [],
    gcQueue: [],
    gcBullseye: [],
    gcOracle: [],
    gcFlixcheck: [],
    gcData: [],
    gcTransfer: [],
    gcDisconnect: [],
    gcBroken: [],
  };

  const selectedScripts = new Map<string, GenesysScriptTranslation>();
  for (const s of workspace.scripts) {
    if (s.isEntryPoint || s.isCommonModuleTarget || s.readiness === 'HIGH') {
      selectedScripts.set(s.scriptKey, s);
    }
  }
  const rankedRest = [...workspace.scripts]
    .filter((s) => !selectedScripts.has(s.scriptKey))
    .sort((a, b) => b.metrics.actionCount - a.metrics.actionCount)
    .slice(0, Math.max(0, 28 - selectedScripts.size));
  for (const s of rankedRest) selectedScripts.set(s.scriptKey, s);

  const scriptNodeIdByKey = new Map<string, string>();
  const emittedNodes = new Set<string>();
  const emittedEdges = new Set<string>();

  for (const script of selectedScripts.values()) {
    const id = toSafeMermaidId('GC_FLOW', script.scriptKey);
    scriptNodeIdByKey.set(script.scriptKey, id);
    const label = escapeMermaidLabel(`${script.cleanName} [${script.readiness}]`);

    if (script.isEntryPoint) {
      lines.push(`  ${id}(["Inbound Call Flow: ${label}"])`);
      if (script.metrics.brokenLinkCount > 0) classBuckets.gcBroken.push(id);
      else classBuckets.gcStart.push(id);
    } else if (script.isCommonModuleTarget) {
      lines.push(`  ${id}[["Common Module: ${label}"]]`);
      if (script.metrics.brokenLinkCount > 0) classBuckets.gcBroken.push(id);
      else classBuckets.gcCommon.push(id);
    } else {
      lines.push(`  ${id}["Call Task: ${label}"]`);
      if (script.metrics.brokenLinkCount > 0) classBuckets.gcBroken.push(id);
      else if (script.metrics.backwardGotoCount > 0) classBuckets.gcLoop.push(id);
      else classBuckets.gcTask.push(id);
    }
  }

  let hasOracleGlobal = false;
  let hasFlixcheckGlobal = false;

  for (const script of selectedScripts.values()) {
    const fromId = scriptNodeIdByKey.get(script.scriptKey)!;

    for (const action of script.actions) {
      if (action.kind === 'callCommonModule' || action.kind === 'callTask') {
        const targetKey = canonicalScriptMatchKey(action.target || '');
        const targetId = scriptNodeIdByKey.get(targetKey);
        if (targetId && targetId !== fromId) {
          const edgeKey = `${fromId}->${targetId}`;
          if (!emittedEdges.has(edgeKey)) {
            emittedEdges.add(edgeKey);
            const lbl = action.kind === 'callCommonModule' ? 'Common Module' : 'Call Task';
            lines.push(`  ${fromId} -->|"${lbl}"| ${targetId}`);
          }
        }
      } else if (action.kind === 'transferToAcd' && action.target) {
        const qId = toSafeMermaidId('GC_Q', action.target);
        if (!emittedNodes.has(qId)) {
          emittedNodes.add(qId);
          const qLabel = escapeMermaidLabel(toArchySlug(action.target));
          lines.push(
            `  ${qId}[("${action.isMultiSkillset ? 'ACD Queue + Bullseye' : 'ACD Queue'}: ${qLabel}")]`
          );
          if (action.isMultiSkillset) classBuckets.gcBullseye.push(qId);
          else classBuckets.gcQueue.push(qId);
        }
        const edgeKey = `${fromId}->${qId}`;
        if (!emittedEdges.has(edgeKey)) {
          emittedEdges.add(edgeKey);
          lines.push(`  ${fromId} --> ${qId}`);
        }
      } else if (action.kind === 'callDataAction') {
        if (action.dataActionCategory === 'FlixCheck_API') {
          hasFlixcheckGlobal = true;
          const edgeKey = `${fromId}->GC_DA_FLIX`;
          if (!emittedEdges.has(edgeKey)) {
            emittedEdges.add(edgeKey);
            lines.push(`  ${fromId} -.->|"Data Action"| GC_DA_FLIX`);
          }
        } else {
          hasOracleGlobal = true;
          const edgeKey = `${fromId}->GC_DA_ORACLE`;
          if (!emittedEdges.has(edgeKey)) {
            emittedEdges.add(edgeKey);
            lines.push(`  ${fromId} -.->|"Data Action"| GC_DA_ORACLE`);
          }
        }
      }
    }
  }

  if (hasOracleGlobal) {
    lines.push('  GC_DA_ORACLE["Data Action: Oracle (Oracle_Integration)"]');
    classBuckets.gcOracle.push('GC_DA_ORACLE');
  }
  if (hasFlixcheckGlobal) {
    lines.push('  GC_DA_FLIX["Data Action: FlixCheck (FlixCheck_API)"]');
    classBuckets.gcFlixcheck.push('GC_DA_FLIX');
  }

  appendGenesysClassDefs(lines, classBuckets);
  return lines.join('\n');
}

function appendGenesysClassDefs(
  lines: string[],
  buckets: Record<string, string[]>
): void {
  lines.push('');
  lines.push('  classDef gcStart fill:#ff4f1f,stroke:#fdba74,stroke-width:2.5px,color:#ffffff;');
  lines.push('  classDef gcCommon fill:#4338ca,stroke:#a5b4fc,stroke-width:2px,color:#eef2ff;');
  lines.push('  classDef gcTask fill:#1e293b,stroke:#94a3b8,stroke-width:1.5px,color:#f8fafc;');
  lines.push('  classDef gcQueue fill:#0e7490,stroke:#67e8f9,stroke-width:2px,color:#ecfeff;');
  lines.push('  classDef gcBullseye fill:#9a3412,stroke:#fb923c,stroke-width:2.5px,color:#fff7ed;');
  lines.push('  classDef gcOracle fill:#581c87,stroke:#d8b4fe,stroke-width:2.5px,color:#faf5ff;');
  lines.push('  classDef gcFlixcheck fill:#065f46,stroke:#34d399,stroke-width:2.5px,color:#ecfdf5;');
  lines.push('  classDef gcAudio fill:#1d4ed8,stroke:#93c5fd,stroke-width:1.5px,color:#eff6ff;');
  lines.push('  classDef gcDecision fill:#334155,stroke:#cbd5e1,stroke-width:1.5px,color:#f8fafc;');
  lines.push('  classDef gcLoop fill:#78350f,stroke:#fbbf24,stroke-width:2.5px,color:#fffbeb;');
  lines.push('  classDef gcData fill:#0f766e,stroke:#5eead4,stroke-width:1.5px,color:#f0fdfa;');
  lines.push('  classDef gcTransfer fill:#374151,stroke:#9ca3af,stroke-width:1.5px,color:#f9fafb;');
  lines.push('  classDef gcDisconnect fill:#111827,stroke:#64748b,stroke-width:1.5px,color:#cbd5e1;');
  lines.push('  classDef gcBroken fill:#7f1d1d,stroke:#f87171,stroke-width:2.5px,color:#fef2f2;');
  lines.push('  classDef gcSchedule fill:#92400e,stroke:#fcd34d,stroke-width:2px,color:#fef3c7;');
  lines.push('  classDef gcInQueue fill:#155e75,stroke:#67e8f9,stroke-width:1.5px,color:#cffafe;');
  lines.push('  classDef gcPriority fill:#4c1d95,stroke:#c4b5fd,stroke-width:2px,color:#f5f3ff;');
  lines.push('  classDef gcCallback fill:#065f46,stroke:#6ee7b7,stroke-width:2px,color:#ecfdf5;');
  lines.push('  classDef gcEmergency fill:#991b1b,stroke:#fca5a5,stroke-width:2.5px,color:#fef2f2;');
  lines.push('  classDef gcDataTable fill:#1e3a8a,stroke:#93c5fd,stroke-width:2px,color:#eff6ff;');
  lines.push('  classDef gcSysVar fill:#1e293b,stroke:#38bdf8,stroke-width:1.5px,color:#e0f2fe;');

  for (const [cls, ids] of Object.entries(buckets)) {
    const uniq = Array.from(new Set(ids));
    if (uniq.length > 0) {
      lines.push(`  class ${uniq.join(',')} ${cls};`);
    }
  }
}

// ============================================================================
// SUBTASK HYDRATION (Real translated logic instead of empty placeholders)
// ============================================================================

function cloneStepsWithRefRemap(
  steps: MigrationStep[],
  remapRef: (refId: string) => string,
  idPrefix: string
): MigrationStep[] {
  return steps.map((s) => ({
    ...s,
    id: `${idPrefix}_${s.id}`,
    additionalFindings: s.additionalFindings ? s.additionalFindings.map((f) => ({ ...f })) : undefined,
    targetTaskRefId: s.targetTaskRefId ? remapRef(s.targetTaskRefId) : undefined,
    yesSteps: s.yesSteps ? cloneStepsWithRefRemap(s.yesSteps, remapRef, idPrefix) : undefined,
    noSteps: s.noSteps ? cloneStepsWithRefRemap(s.noSteps, remapRef, idPrefix) : undefined,
    openSteps: s.openSteps ? cloneStepsWithRefRemap(s.openSteps, remapRef, idPrefix) : undefined,
    closedSteps: s.closedSteps
      ? cloneStepsWithRefRemap(s.closedSteps, remapRef, idPrefix)
      : undefined,
    holidaySteps: s.holidaySteps
      ? cloneStepsWithRefRemap(s.holidaySteps, remapRef, idPrefix)
      : undefined,
    successSteps: s.successSteps
      ? cloneStepsWithRefRemap(s.successSteps, remapRef, idPrefix)
      : undefined,
    failureSteps: s.failureSteps
      ? cloneStepsWithRefRemap(s.failureSteps, remapRef, idPrefix)
      : undefined,
    timeoutSteps: s.timeoutSteps
      ? cloneStepsWithRefRemap(s.timeoutSteps, remapRef, idPrefix)
      : undefined,
    foundSteps: s.foundSteps ? cloneStepsWithRefRemap(s.foundSteps, remapRef, idPrefix) : undefined,
    notFoundSteps: s.notFoundSteps
      ? cloneStepsWithRefRemap(s.notFoundSteps, remapRef, idPrefix)
      : undefined,
    bodySteps: s.bodySteps ? cloneStepsWithRefRemap(s.bodySteps, remapRef, idPrefix) : undefined,
    defaultSteps: s.defaultSteps
      ? cloneStepsWithRefRemap(s.defaultSteps, remapRef, idPrefix)
      : undefined,
    cases: s.cases
      ? s.cases.map((c) => ({
          ...c,
          steps: cloneStepsWithRefRemap(c.steps, remapRef, idPrefix),
        }))
      : undefined,
  }));
}

/**
 * Generates domain-aware Reusable Task logic when a called Avaya sub-block (e.g. Menu,
 * MobilNummerEingeben, Check_Response) has no separate `.s` file loaded in the workspace.
 */
function buildDomainAwareFallbackSubtask(
  ref: { name: string; refId: string; originalTarget: string },
  hasFallbackTask: boolean,
  callerFlowVars: MigrationVariableDecl[] = []
): MigrationTaskGraph {
  const lower = ref.originalTarget.toLowerCase();

  // Phone / Mobile number input block (e.g. MobilNummerEingeben)
  if (/mobil|handy|nummer|phone|tel|eingab/i.test(lower)) {
    const mobileVar: MigrationVariableDecl = {
      name: 'mobileNumber',
      refName: 'Task.mobileNumber',
      originalName: 'mobileNumber',
      scope: 'task',
      isParticipantData: false,
      dataType: 'string',
      initialValue: '',
    };
    return {
      refId: ref.refId,
      name: ref.name,
      kind: 'subscript',
      originalTarget: ref.originalTarget,
      taskVariables: [mobileVar],
      steps: [
        {
          id: `sub_${ref.refId}_col`,
          kind: 'collectInput',
          lineNumber: 0,
          avayaCommand: 'SUBTASK_COLLECT_MOBILE',
          label: `Collect Mobile Number (${ref.originalTarget})`,
          target: ref.originalTarget,
          targetSlug: ref.refId,
          ttsText: 'Bitte geben Sie Ihre Mobilfunknummer ein und bestaetigen Sie mit der Raute-Taste.',
          inputVarName: mobileVar.name,
          inputVarRef: mobileVar.refName,
          digitSpec: { mode: 'range', min: 8, max: 16 },
          noEntryTimeoutSec: 6,
          interDigitTimeoutSec: 3,
          terminatingCharacter: '#',
          noEntryTts: 'Es wurde keine Mobilfunknummer eingegeben.',
          noMatchTts: 'Die eingegebene Nummer ist ungueltig.',
          successSteps: [
            {
              id: `sub_${ref.refId}_chk`,
              kind: 'decision',
              lineNumber: 0,
              avayaCommand: 'VALIDATE_MOBILE',
              label: 'Validate Mobile Number Length',
              conditionLabel: 'MobileNumber_Valid',
              expression: 'Length(Task.mobileNumber) >= 8',
              yesSteps: [
                {
                  id: `sub_${ref.refId}_spd`,
                  kind: 'setParticipantData',
                  lineNumber: 0,
                  avayaCommand: 'STORE_MOBILE',
                  label: 'Store Mobile Number',
                  variableName: 'MobileNumber',
                  variableRef: 'Task.mobileNumber',
                  expressionValue: 'Task.mobileNumber',
                  isTerminal: false,
                },
              ],
              noSteps: [
                {
                  id: `sub_${ref.refId}_inv`,
                  kind: 'playAudio',
                  lineNumber: 0,
                  avayaCommand: 'INVALID_MOBILE_AUDIO',
                  label: 'Play Invalid Number Notice',
                  target: 'Ungueltige_Mobilnummer',
                  targetSlug: 'Ungueltige_Mobilnummer',
                  ttsText: 'Die eingegebene Mobilfunknummer ist zu kurz.',
                  isTerminal: false,
                },
              ],
              isTerminal: false,
            },
          ],
          failureSteps: hasFallbackTask
            ? [
                {
                  id: `sub_${ref.refId}_fb`,
                  kind: 'jumpToReusableTask',
                  lineNumber: 0,
                  avayaCommand: 'FALLBACK',
                  label: 'Fallback on Mobile Input Failure',
                  target: 'Fallback_Error_Task',
                  targetTaskRefId: 'Fallback_Error_Task',
                  isTerminal: true,
                },
              ]
            : [
                {
                  id: `sub_${ref.refId}_disc`,
                  kind: 'disconnect',
                  lineNumber: 0,
                  avayaCommand: 'DISCONNECT',
                  label: `Disconnect (${ref.name} Input Failure)`,
                  target: `${ref.name}_Failure`,
                  isTerminal: true,
                },
              ],
          isTerminal: false,
        },
      ],
    };
  }

  // Menu / IVR selection block (e.g. Menu)
  if (/menu|menue|auswahl|ivr/i.test(lower)) {
    const selVar: MigrationVariableDecl = {
      name: 'menuSelection',
      refName: 'Task.menuSelection',
      originalName: 'menuSelection',
      scope: 'task',
      isParticipantData: false,
      dataType: 'string',
      initialValue: '',
    };
    return {
      refId: ref.refId,
      name: ref.name,
      kind: 'subscript',
      originalTarget: ref.originalTarget,
      taskVariables: [selVar],
      steps: [
        {
          id: `sub_${ref.refId}_col`,
          kind: 'collectInput',
          lineNumber: 0,
          avayaCommand: 'SUBTASK_MENU',
          label: `Menu Selection (${ref.originalTarget})`,
          target: ref.originalTarget,
          targetSlug: ref.refId,
          ttsText: `Bitte treffen Sie Ihre Auswahl fuer ${ref.originalTarget}.`,
          inputVarName: selVar.name,
          inputVarRef: selVar.refName,
          digitSpec: { mode: 'exact', exact: 1 },
          noEntryTimeoutSec: 5,
          interDigitTimeoutSec: 3,
          noEntryTts: 'Es wurde keine Auswahl getroffen.',
          noMatchTts: 'Diese Auswahl ist nicht verfuegbar.',
          successSteps: [
            {
              id: `sub_${ref.refId}_sw`,
              kind: 'switch',
              lineNumber: 0,
              avayaCommand: 'MENU_SWITCH',
              label: `Switch ${selVar.refName}`,
              variableName: selVar.name,
              variableRef: selVar.refName,
              expression: selVar.refName,
              cases: [
                {
                  value: '1',
                  label: 'Option_1',
                  steps: [
                    {
                      id: `sub_${ref.refId}_opt1`,
                      kind: 'setParticipantData',
                      lineNumber: 0,
                      avayaCommand: 'MENU_CHOICE_1',
                      label: 'Store Menu Choice 1',
                      variableName: 'MenuSelection',
                      variableRef: selVar.refName,
                      expressionValue: selVar.refName,
                      isTerminal: false,
                    },
                  ],
                },
              ],
              defaultSteps: [
                {
                  id: `sub_${ref.refId}_def`,
                  kind: 'playAudio',
                  lineNumber: 0,
                  avayaCommand: 'MENU_DEFAULT',
                  label: 'Play Menu Default Hint',
                  target: 'Menue_Hinweis',
                  targetSlug: 'Menue_Hinweis',
                  ttsText: 'Ihre Auswahl wird weiterverarbeitet.',
                  isTerminal: false,
                },
              ],
              isTerminal: false,
            },
          ],
          failureSteps: [
            {
              id: `sub_${ref.refId}_fail`,
              kind: 'disconnect',
              lineNumber: 0,
              avayaCommand: 'MENU_TIMEOUT',
              label: `Disconnect (${ref.name} Timeout)`,
              target: `${ref.name}_Timeout`,
              isTerminal: true,
            },
          ],
          isTerminal: false,
        },
      ],
    };
  }

  // Blacklist / VIP unloaded block (e.g. blacklist_vip) — real Data Table Lookup instead of dummy checkResult!
  if (/blacklist|vip/i.test(lower)) {
    const tableName = `${toArchySlug(ref.originalTarget, 'Blacklist')}_Table`;
    return {
      refId: ref.refId,
      name: ref.name,
      kind: 'subscript',
      originalTarget: ref.originalTarget,
      yamlComment: `OFFENE MIGRATIONSFRAGE: Baustein "${ref.originalTarget}" ohne .s-Quelldatei — als Data Table Lookup (${tableName}) mit klarem Sperr-/Ruecksprungpfad modelliert.`,
      taskVariables: [],
      steps: [
        {
          id: `sub_${ref.refId}_dt`,
          kind: 'callDataTableLookup',
          lineNumber: 0,
          avayaCommand: 'SUBTASK_BLACKLIST_LOOKUP',
          label: `Blacklist Lookup (${tableName})`,
          target: tableName,
          targetSlug: tableName,
          dataTableKey: 'Call.Ani',
          dataActionOutputs: [
            {
              field: 'isListed',
              targetVarName: 'MCF_Blacklist_flag_cv',
              targetVarRef: 'Flow.MCF_Blacklist_flag_cv',
              dataType: 'string',
            },
          ],
          yamlComment: `OFFENE MIGRATIONSFRAGE: Tabellenname "${tableName}" und Rueckgabespalte fuer "${ref.originalTarget}" in Genesys pruefen.`,
          foundSteps: [
            {
              id: `sub_${ref.refId}_flag1`,
              kind: 'updateData',
              lineNumber: 0,
              avayaCommand: 'BLACKLIST_HIT',
              label: 'Set Flow.MCF_Blacklist_flag_cv = "1"',
              variableName: 'MCF_Blacklist_flag_cv',
              variableRef: 'Flow.MCF_Blacklist_flag_cv',
              variableDataType: 'string',
              literalValue: '1',
              isTerminal: false,
            },
            {
              id: `sub_${ref.refId}_disc`,
              kind: 'disconnect',
              lineNumber: 0,
              avayaCommand: 'BLACKLIST_DISCONNECT',
              label: 'Disconnect (Blacklist Treffer)',
              target: 'Blacklist_Blocked',
              isTerminal: true,
            },
          ],
          notFoundSteps: [
            {
              id: `sub_${ref.refId}_flag0`,
              kind: 'updateData',
              lineNumber: 0,
              avayaCommand: 'BLACKLIST_MISS',
              label: 'Set Flow.MCF_Blacklist_flag_cv = "0"',
              variableName: 'MCF_Blacklist_flag_cv',
              variableRef: 'Flow.MCF_Blacklist_flag_cv',
              variableDataType: 'string',
              literalValue: '0',
              isTerminal: false,
            },
          ],
          isTerminal: false,
        },
      ],
    };
  }

  // Response / Validation unloaded block (e.g. CHECK_RESPONSE) — directly uses Flow variable (NO Task duplicate, NO getParticipantData!)
  if (/check|response|valid/i.test(lower)) {
    const existingRespFlowVar =
      callerFlowVars.find((v) => v.name.toLowerCase() === 'hdx_resp_cv') ||
      callerFlowVars.find((v) => /(?:^|_)resp(?:onse)?(?:_cv)?$/i.test(v.name));
    const respVarName = existingRespFlowVar?.name || 'HDX_Resp_cv';
    const respVarRef = `Flow.${respVarName}`;

    const errorFallbackStep: MigrationStep = hasFallbackTask
      ? {
          id: `sub_${ref.refId}_fb`,
          kind: 'jumpToReusableTask',
          lineNumber: 0,
          avayaCommand: 'RESPONSE_FALLBACK',
          label: 'Fallback bei Fehler-Response',
          target: 'Fallback_Error_Task',
          targetTaskRefId: 'Fallback_Error_Task',
          isTerminal: true,
        }
      : {
          id: `sub_${ref.refId}_disc`,
          kind: 'disconnect',
          lineNumber: 0,
          avayaCommand: 'RESPONSE_DISCONNECT',
          label: `Disconnect (${ref.name}_Error)`,
          target: `${ref.name}_Error`,
          isTerminal: true,
        };

    const defaultFallbackStep: MigrationStep = hasFallbackTask
      ? {
          ...errorFallbackStep,
          id: `sub_${ref.refId}_def_err`,
          label: `Fallback (${ref.name}_Default)`,
        }
      : {
          id: `sub_${ref.refId}_def_disc`,
          kind: 'disconnect',
          lineNumber: 0,
          avayaCommand: 'RESPONSE_DEFAULT_DISCONNECT',
          label: `Disconnect (${ref.name}_Default)`,
          target: `${ref.name}_Default`,
          isTerminal: true,
        };

    return {
      refId: ref.refId,
      name: ref.name,
      kind: 'subscript',
      originalTarget: ref.originalTarget,
      yamlComment: `OFFENE MIGRATIONSFRAGE: Baustein "${ref.originalTarget}" ohne .s-Quelldatei — wertet die globale Response-Variable direkt aus.`,
      taskVariables: [],
      steps: [
        {
          id: `sub_${ref.refId}_sw`,
          kind: 'switch',
          lineNumber: 0,
          avayaCommand: 'CHECK_RESPONSE_SWITCH',
          label: `Switch ${respVarName}`,
          target: respVarName,
          variableName: respVarName,
          variableRef: respVarRef,
          expression: respVarRef,
          yamlComment: `OFFENE MIGRATIONSFRAGE: ${respVarRef} muss aus vorgeschaltetem Modul, Lookup oder externer Integration befuellt werden.`,
          provenanceFinding: {
            severity: 'WARN',
            code: 'SWITCH_WITHOUT_SOURCE',
            variableName: respVarName,
            message: `Ungeklärt: ${respVarRef} wird in "${ref.originalTarget}" ausgewertet und muss vorab durch ein Modul, Lookup oder eine externe Integration befüllt werden.`,
          },
          cases: [
            {
              value: 'SUCCESS',
              label: 'Response_SUCCESS',
              steps: [
                {
                  id: `sub_${ref.refId}_ok`,
                  kind: 'callCommonModule',
                  lineNumber: 0,
                  avayaCommand: 'RESPONSE_OK_ROUTE',
                  label: `Call CommonModule ${ref.refId}_Success_Module`,
                  target: `${ref.refId}_Success_Module`,
                  targetSlug: `${ref.refId}_Success_Module`,
                  yamlComment: `OFFENE MIGRATIONSFRAGE: Ziel-Routing bei SUCCESS konkretisieren.`,
                  isTerminal: false,
                },
              ],
            },
            {
              value: 'FAILED',
              label: 'Response_FAILED',
              steps: [errorFallbackStep],
            },
          ],
          defaultSteps: [defaultFallbackStep],
          isTerminal: false,
        },
      ],
    };
  }

  // Generic unloaded internal Avaya building block — NEVER diagnosis-only setParticipantData!
  const modSlug = toArchySlug(ref.originalTarget, ref.refId);
  return {
    refId: ref.refId,
    name: ref.name,
    kind: 'subscript',
    originalTarget: ref.originalTarget,
    yamlComment: `OFFENE MIGRATIONSFRAGE: Baustein "${ref.originalTarget}" hat keine geladene .s-Quelldatei — delegiert sauber an Common Module "${modSlug}".`,
    taskVariables: [],
    steps: [
      {
        id: `sub_${ref.refId}_cm`,
        kind: 'callCommonModule',
        lineNumber: 0,
        avayaCommand: 'UNLOADED_SUBFLOW_MODULE',
        label: `Common Module: ${modSlug}`,
        target: ref.originalTarget,
        targetSlug: modSlug,
        yamlComment: `OFFENE MIGRATIONSFRAGE: Inhalt von "${ref.originalTarget}.s" im Workspace ergaenzen oder als Genesys Common Module "${modSlug}" implementieren.`,
        isTerminal: false,
      },
    ],
  };
}

/**
 * Hydrates local Reusable Tasks referenced by `callTask`:
 * - If the target `.s` script is loaded in the workspace, embeds its REAL translated graph logic!
 * - Otherwise, builds a structured, commented Reusable Task (never dummy checkResult or diagnosis-only trace).
 * Returns the list of unloaded subflow names so FlowIR records MISSING_SUBFLOW_SOURCE findings transparently.
 */
function hydrateLocalSubscriptTasks(
  callerGraph: MigrationFlowGraph,
  localSubscriptRefs: Array<{ name: string; refId: string; originalTarget: string; targetKey: string }>,
  allGraphsByKey: Map<string, MigrationFlowGraph>
): string[] {
  const missingSubflows: string[] = [];
  const existingTaskIds = new Set(callerGraph.tasks.map((t) => t.refId));
  const existingFlowVarKeys = new Set(callerGraph.flowVariables.map((v) => v.name.toLowerCase()));
  let ensureFallback = existingTaskIds.has('Fallback_Error_Task');

  const collectDirectTaskRefs = (list: MigrationStep[], out: Set<string>) => {
    for (const st of list) {
      if ((st.kind === 'callTask' || st.kind === 'jumpToReusableTask') && st.targetTaskRefId) {
        out.add(st.targetTaskRefId);
      }
      if (st.yesSteps) collectDirectTaskRefs(st.yesSteps, out);
      if (st.noSteps) collectDirectTaskRefs(st.noSteps, out);
      if (st.openSteps) collectDirectTaskRefs(st.openSteps, out);
      if (st.closedSteps) collectDirectTaskRefs(st.closedSteps, out);
      if (st.holidaySteps) collectDirectTaskRefs(st.holidaySteps, out);
      if (st.successSteps) collectDirectTaskRefs(st.successSteps, out);
      if (st.failureSteps) collectDirectTaskRefs(st.failureSteps, out);
      if (st.timeoutSteps) collectDirectTaskRefs(st.timeoutSteps, out);
      if (st.foundSteps) collectDirectTaskRefs(st.foundSteps, out);
      if (st.notFoundSteps) collectDirectTaskRefs(st.notFoundSteps, out);
      if (st.bodySteps) collectDirectTaskRefs(st.bodySteps, out);
      if (st.defaultSteps) collectDirectTaskRefs(st.defaultSteps, out);
      if (st.cases) st.cases.forEach((c) => collectDirectTaskRefs(c.steps, out));
    }
  };

  const computeReachableTaskRefs = (): Set<string> => {
    const reachable = new Set<string>([callerGraph.entryTaskRefId]);
    const queue: string[] = [callerGraph.entryTaskRefId];
    const byRef = new Map<string, MigrationTaskGraph>(callerGraph.tasks.map((t) => [t.refId, t]));
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const task = byRef.get(cur);
      if (!task) continue;
      const refs = new Set<string>();
      collectDirectTaskRefs(task.steps, refs);
      for (const r of refs) {
        if (!reachable.has(r)) {
          reachable.add(r);
          queue.push(r);
        }
      }
    }
    return reachable;
  };

  const refById = new Map(localSubscriptRefs.map((r) => [r.refId, r]));
  const processedSubRefs = new Set<string>();

  // Hydrate ONLY subtasks that are actually reachable from entryTaskRefId (iteratively for nested calls)
  for (let round = 0; round < 6; round += 1) {
    const reachableNow = computeReachableTaskRefs();
    let hydratedAny = false;

    for (const refId of reachableNow) {
      if (existingTaskIds.has(refId) || processedSubRefs.has(refId)) continue;
      const ref = refById.get(refId);
      if (!ref) continue;
      processedSubRefs.add(refId);
      hydratedAny = true;

      const loadedTarget = allGraphsByKey.get(ref.targetKey);

      if (loadedTarget && loadedTarget.scriptKey !== callerGraph.scriptKey) {
        // Merge any flow variables required by the embedded sub-script
        for (const fv of loadedTarget.flowVariables) {
          if (fv.name === 'avayaOriginScript') continue;
          if (!existingFlowVarKeys.has(fv.name.toLowerCase())) {
            existingFlowVarKeys.add(fv.name.toLowerCase());
            callerGraph.flowVariables.push({ ...fv });
          }
        }

        // Build remap table for any secondary section tasks inside the loaded sub-script
        const remapMap = new Map<string, string>();
        const secondaryTasksToAdd: MigrationTaskGraph[] = [];
        for (const subT of loadedTarget.tasks) {
          if (subT.refId === loadedTarget.entryTaskRefId) {
            remapMap.set(subT.refId, ref.refId);
          } else if (subT.refId === 'Fallback_Error_Task') {
            remapMap.set('Fallback_Error_Task', 'Fallback_Error_Task');
            ensureFallback = true;
          } else {
            const prefixedRef = toArchySlug(`${ref.refId}_${subT.refId}`, `${ref.refId}_Sec`);
            remapMap.set(subT.refId, prefixedRef);
            secondaryTasksToAdd.push(subT);
          }
        }

        const remapRef = (r: string) => remapMap.get(r) || r;
        const entrySub =
          loadedTarget.tasks.find((t) => t.refId === loadedTarget.entryTaskRefId) ||
          loadedTarget.tasks[0];

        if (entrySub) {
          const safeSteps = cloneStepsWithRefRemap(entrySub.steps, remapRef, `sub_${ref.refId}`);
          const sanitizeNestedCalls = (list: MigrationStep[]) => {
            for (const st of list) {
              if (st.kind === 'callTask' && st.targetTaskRefId) {
                const mapped = remapRef(st.targetTaskRefId);
                if (
                  !existingTaskIds.has(mapped) &&
                  mapped !== ref.refId &&
                  !Array.from(remapMap.values()).includes(mapped) &&
                  !refById.has(mapped)
                ) {
                  st.kind = 'callCommonModule';
                  st.targetSlug = toArchySlug(st.target || mapped, 'CommonModule');
                  st.targetTaskRefId = undefined;
                }
              }
              if (st.yesSteps) sanitizeNestedCalls(st.yesSteps);
              if (st.noSteps) sanitizeNestedCalls(st.noSteps);
              if (st.openSteps) sanitizeNestedCalls(st.openSteps);
              if (st.closedSteps) sanitizeNestedCalls(st.closedSteps);
              if (st.holidaySteps) sanitizeNestedCalls(st.holidaySteps);
              if (st.successSteps) sanitizeNestedCalls(st.successSteps);
              if (st.failureSteps) sanitizeNestedCalls(st.failureSteps);
              if (st.timeoutSteps) sanitizeNestedCalls(st.timeoutSteps);
              if (st.foundSteps) sanitizeNestedCalls(st.foundSteps);
              if (st.notFoundSteps) sanitizeNestedCalls(st.notFoundSteps);
              if (st.bodySteps) sanitizeNestedCalls(st.bodySteps);
              if (st.defaultSteps) sanitizeNestedCalls(st.defaultSteps);
              if (st.cases) st.cases.forEach((c) => sanitizeNestedCalls(c.steps));
            }
          };
          sanitizeNestedCalls(safeSteps);

          callerGraph.tasks.push({
            refId: ref.refId,
            name: ref.name,
            kind: 'subscript',
            originalTarget: ref.originalTarget,
            taskVariables: entrySub.taskVariables.map((v) => ({ ...v })),
            steps: safeSteps,
          });
          existingTaskIds.add(ref.refId);

          for (const secT of secondaryTasksToAdd) {
            const newRef = remapRef(secT.refId);
            if (existingTaskIds.has(newRef)) continue;
            const secSteps = cloneStepsWithRefRemap(secT.steps, remapRef, `sub_${newRef}`);
            sanitizeNestedCalls(secSteps);
            callerGraph.tasks.push({
              refId: newRef,
              name: newRef,
              kind: 'section',
              originalTarget: secT.originalTarget,
              taskVariables: secT.taskVariables.map((v) => ({ ...v })),
              steps: secSteps,
            });
            existingTaskIds.add(newRef);
          }
          continue;
        }
      }

      // Subscript not loaded in workspace -> domain-aware Reusable Task + transparent MISSING_SUBFLOW_SOURCE finding
      missingSubflows.push(ref.originalTarget);
      const fallbackSubtask = buildDomainAwareFallbackSubtask(
        ref,
        ensureFallback,
        callerGraph.flowVariables
      );
      // Ensure Flow.MCF_Blacklist_flag_cv is declared on flow if a Blacklist subtask writes it
      if (
        /blacklist|vip/i.test(ref.originalTarget) &&
        !existingFlowVarKeys.has('mcf_blacklist_flag_cv')
      ) {
        existingFlowVarKeys.add('mcf_blacklist_flag_cv');
        callerGraph.flowVariables.push({
          name: 'MCF_Blacklist_flag_cv',
          refName: 'Flow.MCF_Blacklist_flag_cv',
          originalName: 'MCF_Blacklist_flag_cv',
          scope: 'flow',
          isParticipantData: true,
          dataType: 'string',
          initialValue: '',
        });
      }
      // Ensure Flow.HDX_Resp_cv is declared on flow if a CHECK_RESPONSE subtask reads it directly
      if (/check|response|valid/i.test(ref.originalTarget)) {
        const respSwitch = fallbackSubtask.steps.find((s) => s.kind === 'switch');
        const respName = respSwitch?.variableName || 'HDX_Resp_cv';
        if (!existingFlowVarKeys.has(respName.toLowerCase())) {
          existingFlowVarKeys.add(respName.toLowerCase());
          callerGraph.flowVariables.push({
            name: respName,
            refName: `Flow.${respName}`,
            originalName: respName,
            scope: 'flow',
            isParticipantData: true,
            dataType: 'string',
            initialValue: '',
          });
        }
      }
      callerGraph.tasks.push(fallbackSubtask);
      existingTaskIds.add(ref.refId);
    }

    if (!hydratedAny) break;
  }

  if (ensureFallback && !existingTaskIds.has('Fallback_Error_Task')) {
    callerGraph.tasks.push({
      refId: 'Fallback_Error_Task',
      name: 'Fallback_Error_Task',
      kind: 'fallback',
      originalTarget: 'System Fallback',
      taskVariables: [],
      steps: [
        {
          id: 'fb_hydrated_aud',
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
          id: 'fb_hydrated_disc',
          kind: 'disconnect',
          lineNumber: 0,
          avayaCommand: 'FALLBACK_DISCONNECT',
          label: 'Disconnect (Fallback Error)',
          target: 'Fallback_Error',
          isTerminal: true,
        },
      ],
    });
    existingTaskIds.add('Fallback_Error_Task');
  }

  // Final Cross-Reference Safety Net: guarantee 0 UNRESOLVED_TASK_REF across every surviving task
  const sanitizeDanglingTaskRefs = (list: MigrationStep[]): MigrationStep[] => {
    const out: MigrationStep[] = [];
    for (const st of list) {
      if (
        (st.kind === 'jumpToReusableTask' || st.kind === 'callTask') &&
        st.targetTaskRefId &&
        !existingTaskIds.has(st.targetTaskRefId)
      ) {
        // Check if stripping Section_ prefix matches an existing task (e.g. Section_CHECK_RESPONSE -> CHECK_RESPONSE)
        const stripped = st.targetTaskRefId.replace(/^Section_/i, '');
        if (stripped && existingTaskIds.has(stripped)) {
          out.push({
            ...st,
            kind: 'callTask',
            targetTaskRefId: stripped,
            targetSlug: stripped,
            isTerminal: false,
          });
          continue;
        }
        // Unresolvable dangling ref: drop it cleanly if non-terminal, or omit if already preceded by a call/action
        if (out.length === 0) {
          out.push({
            id: `${st.id}_safe_disc`,
            kind: 'disconnect',
            lineNumber: st.lineNumber,
            avayaCommand: 'UNRESOLVED_REF_CLEANUP',
            label: `Disconnect (${st.target || 'Unresolved'})`,
            yamlComment: `OFFENE MIGRATIONSFRAGE: Urspruenglicher Sprung auf "${st.targetTaskRefId}" hatte kein gueltiges Ziel und wurde bereinigt.`,
            isTerminal: true,
          });
        }
        continue;
      }
      const copy: MigrationStep = { ...st };
      if (copy.yesSteps) copy.yesSteps = sanitizeDanglingTaskRefs(copy.yesSteps);
      if (copy.noSteps) copy.noSteps = sanitizeDanglingTaskRefs(copy.noSteps);
      if (copy.openSteps) copy.openSteps = sanitizeDanglingTaskRefs(copy.openSteps);
      if (copy.closedSteps) copy.closedSteps = sanitizeDanglingTaskRefs(copy.closedSteps);
      if (copy.holidaySteps) copy.holidaySteps = sanitizeDanglingTaskRefs(copy.holidaySteps);
      if (copy.successSteps) copy.successSteps = sanitizeDanglingTaskRefs(copy.successSteps);
      if (copy.failureSteps) copy.failureSteps = sanitizeDanglingTaskRefs(copy.failureSteps);
      if (copy.timeoutSteps) copy.timeoutSteps = sanitizeDanglingTaskRefs(copy.timeoutSteps);
      if (copy.foundSteps) copy.foundSteps = sanitizeDanglingTaskRefs(copy.foundSteps);
      if (copy.notFoundSteps) copy.notFoundSteps = sanitizeDanglingTaskRefs(copy.notFoundSteps);
      if (copy.bodySteps) copy.bodySteps = sanitizeDanglingTaskRefs(copy.bodySteps);
      if (copy.defaultSteps) copy.defaultSteps = sanitizeDanglingTaskRefs(copy.defaultSteps);
      if (copy.cases) {
        copy.cases = copy.cases.map((c) => ({ ...c, steps: sanitizeDanglingTaskRefs(c.steps) }));
      }
      out.push(copy);
    }
    return out;
  };

  for (const t of callerGraph.tasks) {
    t.steps = sanitizeDanglingTaskRefs(t.steps);
  }

  // Final Reachable-Task GC (BFS from entryTaskRefId): removes any uncalled BESETZT / GET_SCHALTER / orphan Section / unused Fallback_Error_Task
  const finalReachable = computeReachableTaskRefs();
  for (let i = callerGraph.tasks.length - 1; i >= 0; i -= 1) {
    const t = callerGraph.tasks[i];
    if (t.refId !== callerGraph.entryTaskRefId && !finalReachable.has(t.refId)) {
      callerGraph.tasks.splice(i, 1);
    }
  }

  callerGraph.flowVariables.sort((a, b) => a.name.localeCompare(b.name));
  return missingSubflows;
}

// ============================================================================
// PASS 2 SEMANTIC AUDITS: Evidence-Based Terminality & Parallel Holiday Logic
// ============================================================================

function appendStepYamlComment(step: MigrationStep, comment: string): void {
  const clean = comment.trim();
  if (!clean) return;
  const existing = (step.yamlComment || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!existing.includes(clean)) {
    existing.push(clean);
    step.yamlComment = existing.join('\n');
  }
}

function appendStepFinding(step: MigrationStep, finding: StepProvenanceFinding): void {
  if (!step.provenanceFinding) {
    step.provenanceFinding = finding;
    return;
  }
  if (
    step.provenanceFinding.code === finding.code &&
    step.provenanceFinding.variableName === finding.variableName &&
    step.provenanceFinding.message === finding.message
  ) {
    return;
  }
  step.additionalFindings = step.additionalFindings || [];
  const dup = step.additionalFindings.some(
    (f) =>
      f.code === finding.code &&
      f.variableName === finding.variableName &&
      f.message === finding.message
  );
  if (!dup) {
    step.additionalFindings.push(finding);
  }
}

function isStepListProvablyTerminal(
  steps: MigrationStep[],
  provenTerminalTaskRefs: Set<string>
): boolean {
  if (steps.length === 0) return false;
  const last = steps[steps.length - 1];
  if (last.isTerminal) return true;
  if (
    (last.kind === 'callTask' || last.kind === 'jumpToReusableTask') &&
    last.targetTaskRefId &&
    provenTerminalTaskRefs.has(last.targetTaskRefId)
  ) {
    return true;
  }
  if (last.kind === 'decision') {
    return (
      isStepListProvablyTerminal(last.yesSteps || [], provenTerminalTaskRefs) &&
      isStepListProvablyTerminal(last.noSteps || [], provenTerminalTaskRefs)
    );
  }
  if (last.kind === 'evaluateScheduleGroup') {
    return (
      isStepListProvablyTerminal(last.openSteps || [], provenTerminalTaskRefs) &&
      isStepListProvablyTerminal(last.closedSteps || [], provenTerminalTaskRefs) &&
      isStepListProvablyTerminal(last.holidaySteps || [], provenTerminalTaskRefs)
    );
  }
  if (last.kind === 'collectInput') {
    return (
      isStepListProvablyTerminal(last.successSteps || [], provenTerminalTaskRefs) &&
      isStepListProvablyTerminal(last.failureSteps || [], provenTerminalTaskRefs)
    );
  }
  if (last.kind === 'callDataAction') {
    return (
      isStepListProvablyTerminal(last.successSteps || [], provenTerminalTaskRefs) &&
      isStepListProvablyTerminal(last.failureSteps || [], provenTerminalTaskRefs) &&
      isStepListProvablyTerminal(last.timeoutSteps || [], provenTerminalTaskRefs)
    );
  }
  if (last.kind === 'switch') {
    const cases = last.cases || [];
    return (
      cases.length > 0 &&
      cases.every((c) => isStepListProvablyTerminal(c.steps, provenTerminalTaskRefs)) &&
      isStepListProvablyTerminal(last.defaultSteps || [], provenTerminalTaskRefs)
    );
  }
  return false;
}

/**
 * Evidence-based branch fallthrough check after Pass 2 hydration:
 * - Never invents a `disconnect` when a subtask / CommonModule branch is not provably terminal.
 * - Only treats a `callTask` as terminal if the target task is loaded from real Avaya source
 *   (not an unloaded fallback stub) and all of its paths terminate cleanly.
 * - Otherwise preserves the honest fallthrough and emits POTENTIAL_BRANCH_FALLTHROUGH + YAML comment.
 */
function auditBranchFallthroughsAndTerminality(
  graph: MigrationFlowGraph,
  missingSubflows: string[],
  warnings: MigrationGraphWarning[]
): void {
  const missingLower = new Set(missingSubflows.map((m) => m.toLowerCase()));

  const isUnloadedFallbackTask = (task: MigrationTaskGraph): boolean => {
    if (task.originalTarget && missingLower.has(task.originalTarget.toLowerCase())) {
      return true;
    }
    if (
      task.steps.length === 1 &&
      task.steps[0].avayaCommand === 'UNLOADED_SUBFLOW_MODULE'
    ) {
      return true;
    }
    return false;
  };

  // Fixed-point computation of tasks whose terminality is strictly proven by loaded Avaya source
  const provenTerminalTasks = new Set<string>();
  for (let iter = 0; iter < 6; iter += 1) {
    let changed = false;
    for (const task of graph.tasks) {
      if (provenTerminalTasks.has(task.refId)) continue;
      if (isUnloadedFallbackTask(task)) continue;
      if (
        isStepListTerminal(task.steps) ||
        isStepListProvablyTerminal(task.steps, provenTerminalTasks)
      ) {
        provenTerminalTasks.add(task.refId);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const summarizeNextMainPath = (followingSteps: MigrationStep[]): string => {
    const labels = followingSteps
      .slice(0, 3)
      .map((s) => s.target || s.targetTaskRefId || s.label || s.kind)
      .filter(Boolean);
    if (followingSteps.length > 3) {
      labels.push('...');
    }
    return labels.join(' -> ') || 'nachfolgender Hauptpfad';
  };

  const inspectBranchForFallthrough = (
    branchSteps: MigrationStep[] | undefined,
    branchLabel: string,
    parentStep: MigrationStep,
    followingSteps: MigrationStep[]
  ) => {
    if (!branchSteps || branchSteps.length === 0) return;
    const lastStep = branchSteps[branchSteps.length - 1];
    if (isStepListProvablyTerminal(branchSteps, provenTerminalTasks)) {
      return;
    }

    if (lastStep.kind === 'callTask' || lastStep.kind === 'callCommonModule') {
      const targetName =
        lastStep.targetTaskRefId || lastStep.targetSlug || lastStep.target || 'Subtask';
      const nextPreview = summarizeNextMainPath(followingSteps);
      const isTaskUnloaded =
        lastStep.kind === 'callTask' &&
        lastStep.targetTaskRefId &&
        graph.tasks.some(
          (t) => t.refId === lastStep.targetTaskRefId && isUnloadedFallbackTask(t)
        );
      const reasonDetail =
        lastStep.kind === 'callCommonModule'
          ? `Common Module "${targetName}" endet nicht automatisch terminal`
          : isTaskUnloaded
          ? `Ziel-Task "${targetName}" hat keine geladene Avaya-Quelldatei (Terminalitaet nicht belegt)`
          : `Ziel-Task "${targetName}" hat im Avaya-Bestand keinen durchgehend terminalen Abschluss`;

      const lineNum = lastStep.lineNumber || parentStep.lineNumber || 1;
      appendStepYamlComment(
        lastStep,
        `OFFENE MIGRATIONSFRAGE: Zweig (${branchLabel}) ruft "${targetName}" auf, aber ${reasonDetail} — Hauptpfad (${nextPreview}) laeuft danach weiter. Kein disconnect erfunden; bitte pruefen, ob dieser Zweig terminal enden soll.`
      );
      appendStepFinding(lastStep, {
        severity: 'WARN',
        code: 'POTENTIAL_BRANCH_FALLTHROUGH',
        message: `Möglicher Fallthrough nach "${targetName}" im Zweig "${branchLabel}" (Zeile ${lineNum}): ${reasonDetail}. Danach läuft der Hauptpfad (${nextPreview}) weiter — kein disconnect erfunden, bitte fachlich prüfen.`,
      });
      warnings.push({
        code: 'POTENTIAL_BRANCH_FALLTHROUGH',
        severity: 'warning',
        lineNumber: lineNum,
        message: `Zeile ${lineNum}: Möglicher Fallthrough nach "${targetName}" (${reasonDetail}) — Hauptpfad (${nextPreview}) läuft danach weiter. Kein disconnect erfunden.`,
      });
    }
  };

  const inspectStepList = (steps: MigrationStep[], inheritedFollowing: MigrationStep[]) => {
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const following = [...steps.slice(i + 1), ...inheritedFollowing];
      const hasMainContinuation = following.length > 0;

      if (step.kind === 'decision') {
        if (hasMainContinuation) {
          inspectBranchForFallthrough(step.yesSteps, 'yes', step, following);
          inspectBranchForFallthrough(step.noSteps, 'no', step, following);
        }
        if (step.yesSteps) inspectStepList(step.yesSteps, following);
        if (step.noSteps) inspectStepList(step.noSteps, following);
      } else if (step.kind === 'switch') {
        for (const c of step.cases || []) {
          if (hasMainContinuation) {
            inspectBranchForFallthrough(c.steps, `case ${c.value}`, step, following);
          }
          inspectStepList(c.steps, following);
        }
        if (step.defaultSteps) {
          if (hasMainContinuation) {
            inspectBranchForFallthrough(step.defaultSteps, 'default', step, following);
          }
          inspectStepList(step.defaultSteps, following);
        }
      } else if (step.kind === 'evaluateScheduleGroup') {
        if (step.openSteps) inspectStepList(step.openSteps, following);
        if (step.closedSteps) inspectStepList(step.closedSteps, following);
        if (step.holidaySteps) inspectStepList(step.holidaySteps, following);
      } else if (step.kind === 'collectInput' || step.kind === 'callDataAction') {
        if (step.successSteps) inspectStepList(step.successSteps, following);
        if (step.failureSteps) inspectStepList(step.failureSteps, following);
        if (step.timeoutSteps) inspectStepList(step.timeoutSteps, following);
      } else if (step.kind === 'callDataTableLookup') {
        if (step.foundSteps) inspectStepList(step.foundSteps, following);
        if (step.notFoundSteps) inspectStepList(step.notFoundSteps, following);
      } else if (step.kind === 'loop' && step.bodySteps) {
        inspectStepList(step.bodySteps, following);
      }
    }
  };

  for (const task of graph.tasks) {
    if (task.kind === 'fallback') continue;
    inspectStepList(task.steps, []);
  }
}

/**
 * Parallel Holiday Logic Transparency Audit:
 * Preserves both `evaluateScheduleGroup.holiday` and any separate explicit holiday `decision`
 * (e.g. `GetCurrentDateTimeUtc() == Flow.Sys_Feiertagliste_NRW`) without merging or emptying
 * either branch, and flags the overlap as DUPLICATE_HOLIDAY_LOGIC for business clarification.
 */
function auditParallelHolidayLogic(
  graph: MigrationFlowGraph,
  warnings: MigrationGraphWarning[]
): void {
  const HOLIDAY_SIGNAL_RE = /(?:feiertag|holiday|sonderfeiertag|feiertags?liste)/i;

  let scheduleHolidayStep: MigrationStep | null = null;
  const explicitHolidayDecisions: MigrationStep[] = [];

  const branchTargetsHoliday = (steps?: MigrationStep[]): boolean => {
    if (!steps || steps.length === 0) return false;
    return steps.some(
      (s) =>
        HOLIDAY_SIGNAL_RE.test(s.target || '') ||
        HOLIDAY_SIGNAL_RE.test(s.targetTaskRefId || '') ||
        HOLIDAY_SIGNAL_RE.test(s.targetSlug || '')
    );
  };

  const scanSteps = (steps: MigrationStep[]) => {
    for (const st of steps) {
      if (st.kind === 'evaluateScheduleGroup' && (st.holidaySteps || []).length > 0) {
        if (!scheduleHolidayStep) scheduleHolidayStep = st;
      }
      if (st.kind === 'decision') {
        const condText = `${st.expression || ''} ${st.rawCondition || ''} ${st.conditionLabel || ''}`;
        if (
          HOLIDAY_SIGNAL_RE.test(condText) ||
          branchTargetsHoliday(st.yesSteps) ||
          branchTargetsHoliday(st.noSteps)
        ) {
          explicitHolidayDecisions.push(st);
        }
      }
      if (st.yesSteps) scanSteps(st.yesSteps);
      if (st.noSteps) scanSteps(st.noSteps);
      if (st.openSteps) scanSteps(st.openSteps);
      if (st.closedSteps) scanSteps(st.closedSteps);
      if (st.holidaySteps) scanSteps(st.holidaySteps);
      if (st.successSteps) scanSteps(st.successSteps);
      if (st.failureSteps) scanSteps(st.failureSteps);
      if (st.timeoutSteps) scanSteps(st.timeoutSteps);
      if (st.foundSteps) scanSteps(st.foundSteps);
      if (st.notFoundSteps) scanSteps(st.notFoundSteps);
      if (st.bodySteps) scanSteps(st.bodySteps);
      if (st.defaultSteps) scanSteps(st.defaultSteps);
      if (st.cases) st.cases.forEach((c) => scanSteps(c.steps));
    }
  };

  for (const task of graph.tasks) {
    if (task.kind === 'fallback') continue;
    scanSteps(task.steps);
  }

  if (!scheduleHolidayStep || explicitHolidayDecisions.length === 0) {
    return;
  }

  const scheduleGroupName =
    (scheduleHolidayStep as MigrationStep).targetSlug ||
    (scheduleHolidayStep as MigrationStep).target ||
    'Schedule_Group';

  for (const dec of explicitHolidayDecisions) {
    const condSummary = dec.expression || dec.conditionLabel || dec.label;
    const lineNum = dec.lineNumber || 1;
    appendStepYamlComment(
      dec,
      `OFFENE MIGRATIONSFRAGE: Moegliche doppelte Feiertagslogik — neben evaluateScheduleGroup.holiday ("${scheduleGroupName}") existiert diese zusaetzliche explizite Feiertagspruefung (${condSummary}). Beide Pfade wurden unveraendert beibehalten; bitte fachlich klaeren, ob Standard-Feiertage (Schedule Group) und Sonder-Feiertagsliste bewusst getrennt sind oder zusammengefasst werden koennen.`
    );
    appendStepFinding(dec, {
      severity: 'WARN',
      code: 'DUPLICATE_HOLIDAY_LOGIC',
      message: `Mögliche doppelte Feiertagslogik (Zeile ${lineNum}): Neben evaluateScheduleGroup.holiday ("${scheduleGroupName}") existiert eine zusätzliche explizite Feiertagsprüfung (${condSummary}). Beide Pfade wurden getrennt beibehalten — offene fachliche Klärung.`,
    });
    warnings.push({
      code: 'DUPLICATE_HOLIDAY_LOGIC',
      severity: 'warning',
      lineNumber: lineNum,
      message: `Zeile ${lineNum}: Mögliche doppelte Feiertagslogik — evaluateScheduleGroup.holiday ("${scheduleGroupName}") und explizite Prüfung (${condSummary}) bestehen parallel. Beide wurden beibehalten; bitte fachlich klären.`,
    });
  }
}

function finalizeScriptTranslation(
  node: ParsedScriptNode,
  built: BuildMigrationGraphResult,
  incomingCallCount: number,
  brokenLinkCount: number,
  missingSubflows: string[]
): GenesysScriptTranslation {
  const { graph, localSubscriptRefs, metrics } = built;
  const warnings: GenesysScriptWarning[] = built.warnings.map((w) => ({ ...w }));

  if (brokenLinkCount > 0) {
    warnings.push({
      code: 'BROKEN_LINK',
      severity: 'blocker',
      message: `${brokenLinkCount} fehlende Skript-Referenz(en) (Broken Links) vor Migration in Genesys Cloud klären.`,
    });
  }

  const externalApiCount = metrics.oracleApiCount + metrics.flixcheckApiCount;
  if (externalApiCount > 2) {
    warnings.push({
      code: 'HIGH_EXTERNAL_API_COUNT',
      severity: 'warning',
      message: `${externalApiCount} externe API-/Host-Aufrufe (Oracle/FlixCheck) erfordern abgestimmte Genesys Web Services Data Actions.`,
    });
  }

  // Build flat compatibility views (`variables`, `actions`) from the finalized Level-1 graph
  const allVarDecls: GenesysVariableDecl[] = [];
  const seenFlatVar = new Set<string>();
  for (const fv of graph.flowVariables) {
    if (fv.name === 'avayaOriginScript') continue;
    const key = `flow:${fv.name.toLowerCase()}`;
    if (seenFlatVar.has(key)) continue;
    seenFlatVar.add(key);
    allVarDecls.push({
      name: fv.name,
      originalName: fv.originalName,
      archyName: fv.refName,
      scope: fv.isParticipantData ? 'participantData' : 'flow',
      dataType: fv.dataType,
      initialValue: String(fv.initialValue ?? ''),
    });
  }
  for (const t of graph.tasks) {
    if (t.kind === 'fallback') continue;
    for (const tv of t.taskVariables) {
      const key = `task:${tv.name.toLowerCase()}`;
      if (seenFlatVar.has(key)) continue;
      seenFlatVar.add(key);
      allVarDecls.push({
        name: tv.name,
        originalName: tv.originalName,
        archyName: tv.refName,
        scope: 'task',
        dataType: tv.dataType,
        initialValue: String(tv.initialValue ?? ''),
      });
    }
  }

  const flatSteps = flattenMigrationSteps(graph);
  const actions: GenesysMappedAction[] = flatSteps.map((s) => ({
    id: s.id,
    kind: s.kind,
    avayaCommand: s.avayaCommand,
    genesysLabel: s.label,
    lineNumber: s.lineNumber,
    target: s.target,
    targetSlug: s.targetSlug,
    dataActionCategory: s.dataActionCategory,
    skills: s.skills,
    isMultiSkillset: s.isMultiSkillset,
    isBackwardGoto: s.isBackwardGoto,
    maxLoopCount: s.maxLoopCount,
    priorityValue: s.priorityValue,
    delaySeconds: s.delaySeconds,
    languageCode: s.languageCode,
    expressionValue: s.expressionValue,
    dataTableKey: s.dataTableKey,
    isEmergencyCheck: s.isEmergencyCheck,
    variableName: s.variableName,
    archyVariableName: s.variableRef,
    conditionLabel: s.conditionLabel,
    choices: s.choices,
    isBrokenTarget: s.isBrokenTarget,
    warning: s.warning,
  }));

  const callVariableCount = allVarDecls.filter((v) => v.scope === 'participantData').length;
  const subscriptCallCount = metrics.commonModuleCallCount + metrics.callTaskCount;

  // Binding Readiness Classification (LOW | MEDIUM | HIGH)
  const readinessReasons: string[] = [];
  let readiness: GenesysReadinessLevel = 'LOW';

  if (metrics.hasMultiSkillset) {
    readinessReasons.push('Multi-Skillset-Queueing (Bullseye erforderlich)');
  }
  if (metrics.backwardGotoCount > 0) {
    readinessReasons.push(`${metrics.backwardGotoCount} Rückwärts-GOTO-Schleife(n)`);
  }
  if (externalApiCount > 2) readinessReasons.push(`${externalApiCount} externe APIs (> 2)`);
  if (brokenLinkCount > 0) readinessReasons.push(`${brokenLinkCount} Broken Link(s)`);

  if (
    metrics.hasMultiSkillset ||
    metrics.backwardGotoCount > 0 ||
    externalApiCount > 2 ||
    brokenLinkCount > 0
  ) {
    readiness = 'HIGH';
  } else {
    if (subscriptCallCount >= 2) {
      readinessReasons.push(`${subscriptCallCount} Subskript-Aufrufe`);
    }
    if (callVariableCount > 0) {
      readinessReasons.push(`${callVariableCount} Call-Variable(n) (CV_* -> Participant Data)`);
    }
    if (metrics.oracleApiCount > 0) {
      readinessReasons.push(`${metrics.oracleApiCount} Oracle Data Action(s)`);
    }
    if (metrics.flixcheckApiCount > 0) {
      readinessReasons.push(`${metrics.flixcheckApiCount} FlixCheck Data Action(s)`);
    }

    if (
      subscriptCallCount >= 2 ||
      callVariableCount > 0 ||
      metrics.oracleApiCount > 0 ||
      metrics.flixcheckApiCount > 0
    ) {
      readiness = 'MEDIUM';
    } else {
      readiness = 'LOW';
      readinessReasons.push(
        'Linearer Flow (max. 1 Skillset, keine Rückwärts-GOTOs, keine Blocker)'
      );
    }
  }

  // Build canonical FlowIR v1.1 (Single Source of Truth) + validateIR(ir)
  const flowIR = buildFlowIRFromMigrationGraph(graph, { missingSubflows });
  const irValidation = validateIR(flowIR);

  const partial: GenesysScriptTranslation = {
    scriptKey: node.scriptKey,
    scriptNumber: node.scriptNumber,
    fileName: node.fileName,
    cleanName: graph.cleanName,
    archyFilename: `${graph.cleanName}.yaml`,
    isEntryPoint: node.isEntryPoint,
    incomingCallCount,
    isCommonModuleTarget: incomingCallCount >= 3,
    readiness,
    readinessReasons,
    metrics: {
      actionCount: actions.length,
      subscriptCallCount,
      commonModuleCallCount: metrics.commonModuleCallCount,
      callTaskCount: metrics.callTaskCount,
      skillsetCount: metrics.uniqueSkillsets.length,
      hasMultiSkillset: metrics.hasMultiSkillset,
      backwardGotoCount: metrics.backwardGotoCount,
      externalApiCount,
      oracleApiCount: metrics.oracleApiCount,
      flixcheckApiCount: metrics.flixcheckApiCount,
      callVariableCount,
      brokenLinkCount,
      prunedDeadPathCount: graph.diagnostics.prunedUnreachableCount,
      realExpressionCount: graph.diagnostics.realExpressionCount,
      normalizedTargetCount: graph.diagnostics.normalizedTargetCount,
    },
    variables: allVarDecls,
    actions,
    localReusableTasks: localSubscriptRefs
      .filter((r) => graph.tasks.some((t) => t.refId === r.refId))
      .map(({ name, refId, originalTarget }) => ({
        name,
        refId,
        originalTarget,
      })),
    migrationGraph: graph,
    flowIR,
    irValidation,
    avayaView: renderAvayaView(flowIR),
    genesysView: {
      mode: 'genesys',
      kurzfazit: '',
      annahmenUndOffenePunkte: [],
      ergebnisText: '',
      migrationshinweise: [],
      markdownReport: '',
    },
    warnings,
    archyYaml: '',
    yamlValidation: {
      isValid: true,
      errors: [],
      warnings: [],
      stats: { lineCount: 0, taskCount: 0, actionCount: 0, variableCount: 0 },
    },
    genesysMermaid: '',
  };

  partial.archyYaml = generateArchyYaml(partial);
  partial.yamlValidation = validateArchyYaml(partial.archyYaml);
  partial.genesysView = renderGenesysView(flowIR, partial.archyYaml);
  partial.genesysMermaid = generateSingleScriptGenesysMermaid(partial);
  return partial;
}

/**
 * Deterministically translates an entire Avaya AACC workspace (or ScriptModule[])
 * via the 2-stage pipeline (Level 1 Neutral Migration Graph -> Level 2 Archy YAML & Mermaid).
 */
export function translateAvayaWorkspaceToGenesys(
  input: ScriptWorkspace | ScriptModule[],
  options?: {
    precomputedAuditReport?: AuditReport;
    generatedAt?: string;
    /** Optionaler Kompatibilitäts-/Stub-Modus (Opt-In, Standard = false = Ehrliche Migration). */
    compatibilityStubMode?: boolean;
  }
): GenesysWorkspaceTranslation {
  const compatibilityStubMode = Boolean(options?.compatibilityStubMode);
  const workspace: ScriptWorkspace = isScriptWorkspace(input)
    ? input
    : buildScriptWorkspace(input);

  const auditReport: AuditReport =
    options?.precomputedAuditReport ||
    runCallflowAudit(workspace, { generatedAt: options?.generatedAt });

  const moduleByKey = new Map<string, ScriptModule>();
  const knownKeyLookup = new Map<string, string>();
  for (const mod of workspace.modules || []) {
    const primaryKey = canonicalScriptMatchKey(
      mod.scriptNumber || stripKnownScriptExtension(mod.sourceFilename || mod.scriptName)
    );
    if (!primaryKey) continue;
    if (!moduleByKey.has(primaryKey)) moduleByKey.set(primaryKey, mod);
    knownKeyLookup.set(primaryKey, primaryKey);
    if (mod.cdnAlias) {
      knownKeyLookup.set(canonicalScriptMatchKey(mod.cdnAlias), primaryKey);
    }
    if (mod.sourceFilename) {
      knownKeyLookup.set(
        canonicalScriptMatchKey(stripKnownScriptExtension(mod.sourceFilename)),
        primaryKey
      );
    }
  }

  const incomingCallCountByKey = new Map<string, number>();
  for (const node of auditReport.nodes) {
    for (const edge of node.edges) {
      if (edge.targetType === 'LOCAL_SCRIPT' && edge.targetKey !== node.scriptKey) {
        incomingCallCountByKey.set(
          edge.targetKey,
          (incomingCallCountByKey.get(edge.targetKey) || 0) + 1
        );
      }
    }
  }

  const brokenByScriptKey = new Map<string, Set<string>>();
  for (const bl of auditReport.brokenLinks) {
    const set = brokenByScriptKey.get(bl.sourceScriptKey) || new Set<string>();
    set.add(bl.targetKey);
    brokenByScriptKey.set(bl.sourceScriptKey, set);
  }

  // Pass 1 (Ebene 1): Build Neutral Migration Graph for every script
  const builtByKey = new Map<string, { node: ParsedScriptNode; built: BuildMigrationGraphResult }>();
  const allGraphsByKey = new Map<string, MigrationFlowGraph>();

  for (const node of auditReport.nodes) {
    const built = buildMigrationFlowGraph(
      node,
      moduleByKey.get(node.scriptKey),
      {
        knownKeyLookup,
        incomingCallCountByKey,
        brokenTargetKeysForScript: brokenByScriptKey.get(node.scriptKey) || new Set<string>(),
        compatibilityStubMode,
      },
      '1.5.5'
    );
    builtByKey.set(node.scriptKey, { node, built });
    allGraphsByKey.set(node.scriptKey, built.graph);
  }

  // Pass 2 (Ebene 2): Hydrate real Reusable Subscript Task bodies, run evidence-based semantic audits,
  // and render Archy YAML + canonical FlowIR + Mermaid
  const scripts: GenesysScriptTranslation[] = [];
  const scriptsByKey: Record<string, GenesysScriptTranslation> = {};

  for (const { node, built } of builtByKey.values()) {
    const missingSubflows = hydrateLocalSubscriptTasks(
      built.graph,
      built.localSubscriptRefs,
      allGraphsByKey
    );
    auditBranchFallthroughsAndTerminality(built.graph, missingSubflows, built.warnings);
    auditParallelHolidayLogic(built.graph, built.warnings);

    const translated = finalizeScriptTranslation(
      node,
      built,
      incomingCallCountByKey.get(node.scriptKey) || 0,
      (brokenByScriptKey.get(node.scriptKey) || new Set<string>()).size,
      missingSubflows
    );
    scripts.push(translated);
    scriptsByKey[translated.scriptKey] = translated;
  }

  const lowCount = scripts.filter((s) => s.readiness === 'LOW').length;
  const mediumCount = scripts.filter((s) => s.readiness === 'MEDIUM').length;
  const highCount = scripts.filter((s) => s.readiness === 'HIGH').length;
  const overallReadiness: GenesysReadinessLevel =
    highCount > 0 ? 'HIGH' : mediumCount > 0 ? 'MEDIUM' : 'LOW';

  const result: GenesysWorkspaceTranslation = {
    schemaVersion: '1.5.5',
    generatedAt: options?.generatedAt || auditReport.generatedAt,
    privacyMode: '100%-in-memory-metadata-only',
    compatibilityStubMode,
    overallReadiness,
    summary: {
      totalScripts: scripts.length,
      lowCount,
      mediumCount,
      highCount,
      commonModuleCount: scripts.filter((s) => s.isCommonModuleTarget).length,
      totalWarnings: scripts.reduce((acc, s) => acc + s.warnings.length, 0),
      backwardGotoScripts: scripts.filter((s) => s.metrics.backwardGotoCount > 0).length,
      multiSkillsetScripts: scripts.filter((s) => s.metrics.hasMultiSkillset).length,
      oracleCalls: scripts.reduce((acc, s) => acc + s.metrics.oracleApiCount, 0),
      flixcheckCalls: scripts.reduce((acc, s) => acc + s.metrics.flixcheckApiCount, 0),
      brokenLinks: auditReport.summary.brokenLinkCount,
      yamlValidScriptCount: scripts.filter((s) => s.yamlValidation.isValid).length,
      yamlErrorCount: scripts.reduce((acc, s) => acc + s.yamlValidation.errors.length, 0),
      totalPrunedDeadPaths: scripts.reduce((acc, s) => acc + s.metrics.prunedDeadPathCount, 0),
      totalNormalizedTargets: scripts.reduce((acc, s) => acc + s.metrics.normalizedTargetCount, 0),
      totalInlinedSections: scripts.reduce(
        (acc, s) => acc + (s.migrationGraph.diagnostics.inlinedSectionCount || 0),
        0
      ),
      totalIrFindings: scripts.reduce((acc, s) => acc + s.flowIR.findings.length, 0),
    },
    scripts,
    scriptsByKey,
    masterGenesysMermaid: '',
    auditReport,
  };

  result.masterGenesysMermaid = generateWorkspaceOverviewGenesysMermaid(result);
  return result;
}

/**
 * Packages all generated Genesys Archy YAML files, canonical FlowIR v1.1 JSON files,
 * overview Mermaid diagram, and Readiness README.md into a 100% in-memory ZIP Blob.
 */
export async function exportAllArchyYamlsZipBlob(
  translation: GenesysWorkspaceTranslation
): Promise<Blob> {
  const zip = new JSZip();
  const flowsFolder = zip.folder('archy-flows') || zip;
  const graphsFolder = zip.folder('migration-graphs') || zip;
  const usedNames = new Set<string>();

  for (const script of translation.scripts) {
    let baseName = script.cleanName;
    let counter = 2;
    while (usedNames.has(baseName.toLowerCase())) {
      baseName = `${script.cleanName}_${counter}`;
      counter += 1;
    }
    usedNames.add(baseName.toLowerCase());
    flowsFolder.file(`${baseName}.yaml`, script.archyYaml);
    const irDoc: FlowIRDocument = { flowIR: script.flowIR };
    graphsFolder.file(`${baseName}.graph.json`, JSON.stringify(irDoc, null, 2));
  }

  const readmeLines: string[] = [
    '# Genesys Cloud Architect (Archy YAML) Migrations-Paket',
    '',
    `- **Erzeugt am:** ${translation.generatedAt}`,
    `- **Gesamt-Komplexität (Readiness):** ${translation.overallReadiness}`,
    `- **Skripte gesamt:** ${translation.summary.totalScripts} (LOW: ${translation.summary.lowCount} · MEDIUM: ${translation.summary.mediumCount} · HIGH: ${translation.summary.highCount})`,
    `- **Common Module Kandidaten (>= 3 Aufrufe):** ${translation.summary.commonModuleCount}`,
    `- **Bereinigte Dead Paths (nach terminalen Aktionen):** ${translation.summary.totalPrunedDeadPaths}`,
    `- **Normalisierte Rufnummern-/CDN-Ziele:** ${translation.summary.totalNormalizedTargets}`,
    `- **Warnungen:** ${translation.summary.totalWarnings} (Rückwärts-GOTO: ${translation.summary.backwardGotoScripts} · Multi-Skillset: ${translation.summary.multiSkillsetScripts} · Broken Links: ${translation.summary.brokenLinks})`,
    `- **Archy-YAML-Validierung:** ${translation.summary.yamlValidScriptCount}/${translation.summary.totalScripts} valide (${translation.summary.yamlErrorCount} Schema-Fehler)`,
    '',
    '| Avaya Datei | Archy YAML | Migrations-Graph (IR) | Readiness | YAML-Status | Branches | Dead Paths | Gründe |',
    '| --- | --- | --- | --- | --- | ---: | ---: | --- |',
  ];

  for (const s of translation.scripts) {
    const yamlBadge = s.yamlValidation.isValid
      ? 'Valide'
      : `${s.yamlValidation.errors.length} Fehler`;
    readmeLines.push(
      `| \`${s.fileName}\` | \`archy-flows/${s.archyFilename}\` | \`migration-graphs/${s.cleanName}.graph.json\` | **${s.readiness}** | ${yamlBadge} | ${s.migrationGraph.diagnostics.branchNodeCount} | ${s.metrics.prunedDeadPathCount} | ${s.readinessReasons.join('; ')} |`
    );
  }

  zip.file('README.md', readmeLines.join('\n'));
  zip.file('genesys-overview.mmd', translation.masterGenesysMermaid);

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
