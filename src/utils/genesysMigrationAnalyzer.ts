/**
 * 100 % Offline & In-Memory Avaya AACC (OCL) -> Genesys Cloud Architect (Archy YAML)
 * Deterministischer Übersetzer für Mermaid (`flowchart TD`), Archy YAML & Readiness-Analyse.
 *
 * Strikte Datenschutz- & Runtime-Vorgabe:
 * - KEIN Dateisystem-I/O (`fs`, `path`) und KEINE Netzwerk-Aufrufe (`fetch`, `XMLHttpRequest`).
 * - Reine, seiteneffektfreie In-Memory-Verarbeitung auf Basis der bestehenden Parser- & Audit-Typen.
 * - Verbindliche 15-Regeln Mapping-Matrix & exakt valides Genesys Archy YAML-Schema.
 */
import JSZip from 'jszip';
import { ScriptModule, ScriptWorkspace } from '../types/mermaidStudio';
import {
  buildScriptWorkspace,
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
import {
  AuditReport,
  ParsedScriptNode,
  runCallflowAudit,
} from './auditCallflows';
import { detectExternalApiIntegration } from './flixcheckSpec';

export type GenesysReadinessLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type GenesysActionKind =
  | 'playAudio'
  | 'collectInput'
  | 'menu'
  | 'callDataAction'
  | 'callCommonModule'
  | 'callTask'
  | 'decision'
  | 'switch'
  | 'loop'
  | 'setParticipantData'
  | 'getParticipantData'
  | 'updateData'
  | 'transferToAcd'
  | 'transferToNumber'
  | 'disconnect';

export interface GenesysVariableDecl {
  originalName: string;
  archyName: string; // Flow.<name> or Task.<name>
  scope: 'participantData' | 'flow' | 'task';
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
  dataActionCategory?: 'Oracle_Integration' | 'FlixCheck_API';
  skills?: string[];
  isMultiSkillset?: boolean;
  isBackwardGoto?: boolean;
  maxLoopCount?: number;
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
    | 'HIGH_EXTERNAL_API_COUNT';
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
  };
  variables: GenesysVariableDecl[];
  actions: GenesysMappedAction[];
  localReusableTasks: Array<{ name: string; refId: string; originalTarget: string }>;
  warnings: GenesysScriptWarning[];
  archyYaml: string;
  genesysMermaid: string;
}

export interface GenesysWorkspaceTranslation {
  schemaVersion: string;
  generatedAt: string;
  privacyMode: '100%-in-memory-metadata-only';
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
  };
  scripts: GenesysScriptTranslation[];
  scriptsByKey: Record<string, GenesysScriptTranslation>;
  masterGenesysMermaid: string;
  auditReport: AuditReport;
}

const FLIXCHECK_RE =
  /flix[\s_.-]*check|(?:^|[_.\-\s/"'])(?:flix|call[\s_-]*deflection|deflection)(?:$|[_.\-\s\d/"'])/i;
const ORACLE_RE = /(?:^|[_.\-\s/"'])oracle(?:$|[_.\-\s\d/"'])|oracle/i;

function isScriptWorkspace(input: ScriptWorkspace | ScriptModule[]): input is ScriptWorkspace {
  return !Array.isArray(input) && Array.isArray(input.modules);
}

/**
 * Formats any script/variable/prompt identifier into a strict YAML-safe Archy slug.
 */
export function toArchySlug(raw: string, fallback = 'Unnamed'): string {
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

function resolveVariablePrefixInfo(varName: string): {
  scope: 'participantData' | 'flow' | 'task';
  archyName: string;
} | null {
  const clean = varName.trim();
  if (/^CV_/i.test(clean)) {
    return { scope: 'participantData', archyName: `Flow.${toArchySlug(clean)}` };
  }
  if (/^GV_/i.test(clean)) {
    return { scope: 'flow', archyName: `Flow.${toArchySlug(clean)}` };
  }
  if (/^LV_/i.test(clean)) {
    return { scope: 'task', archyName: `Task.${toArchySlug(clean)}` };
  }
  return null;
}

function extractScopedVariables(lines: string[]): GenesysVariableDecl[] {
  const byLower = new Map<string, GenesysVariableDecl>();
  const oclVars = extractOclDeclaredVariables(lines);

  const register = (rawName: string) => {
    const info = resolveVariablePrefixInfo(rawName);
    if (!info) return;
    const lower = rawName.toLowerCase();
    if (byLower.has(lower)) return;
    const staticVal = oclVars.staticStringLiterals.get(lower) || '';
    byLower.set(lower, {
      originalName: rawName,
      archyName: info.archyName,
      scope: info.scope,
      initialValue: staticVal,
    });
  };

  for (const line of lines) {
    const varMatches = line.matchAll(/\b((?:CV|GV|LV)_[A-Za-z0-9_]+)\b/gi);
    for (const m of varMatches) {
      if (m[1]) register(m[1]);
    }
  }

  return Array.from(byLower.values()).sort((a, b) =>
    a.originalName.localeCompare(b.originalName)
  );
}

/**
 * Generates strict, schema-compliant Genesys Cloud Archy YAML for a translated Avaya script.
 * Uses ONLY valid official Archy YAML keys (zero invented keys).
 */
export function generateArchyYaml(script: GenesysScriptTranslation): string {
  const lines: string[] = [];
  const cleanFlowName = toArchySlug(script.cleanName, 'Avaya_Migrated_Flow');

  lines.push('inboundCall:');
  lines.push(`  name: ${cleanFlowName}`);
  lines.push(
    `  description: "Auto-generiert aus Avaya AACC Skript ${escapeYamlString(script.fileName)}"`
  );
  lines.push('  defaultLanguage: de-de');
  lines.push('  startUpRef: "/inboundCall/tasks/task[Main_Task]"');

  // variables
  lines.push('  variables:');
  lines.push('    - stringVariable:');
  lines.push('        name: Flow.avayaOriginScript');
  lines.push('        initialValue:');
  lines.push(`          lit: "${escapeYamlString(script.fileName)}"`);

  const hasCollectInput = script.actions.some(
    (a) => a.kind === 'collectInput' || a.kind === 'menu'
  );
  const hasDecision = script.actions.some((a) => a.kind === 'decision' || a.kind === 'switch');

  if (hasCollectInput) {
    lines.push('    - stringVariable:');
    lines.push('        name: Task.collectedDigits');
    lines.push('        initialValue:');
    lines.push('          lit: ""');
  }

  if (hasDecision) {
    lines.push('    - stringVariable:');
    lines.push('        name: Flow.avayaCondition');
    lines.push('        initialValue:');
    lines.push('          lit: "true"');
  }

  const emittedVarNames = new Set<string>([
    'Flow.avayaOriginScript',
    'Task.collectedDigits',
    'Flow.avayaCondition',
  ]);

  for (const v of script.variables) {
    if (emittedVarNames.has(v.archyName)) continue;
    emittedVarNames.add(v.archyName);
    lines.push('    - stringVariable:');
    lines.push(`        name: ${v.archyName}`);
    lines.push('        initialValue:');
    lines.push(`          lit: "${escapeYamlString(v.initialValue)}"`);
  }

  // tasks
  lines.push('  tasks:');
  lines.push('    - task:');
  lines.push('        name: Main_Task');
  lines.push('        refId: Main_Task');
  lines.push('        actions:');

  if (script.actions.length === 0) {
    lines.push('          - disconnect:');
    lines.push('              name: "Disconnect Call"');
  } else {
    for (const action of script.actions) {
      switch (action.kind) {
        case 'playAudio': {
          const promptSlug = toArchySlug(action.target || 'Prompt', 'Prompt');
          lines.push('          - playAudio:');
          lines.push(`              name: "Play Prompt.${escapeYamlString(promptSlug)}"`);
          lines.push('              audio:');
          lines.push(
            `                tts: "Platzhalter Prompt ${escapeYamlString(promptSlug)}"`
          );
          break;
        }
        case 'collectInput': {
          const promptSlug = toArchySlug(action.target || 'DTMF_Input', 'DTMF_Input');
          lines.push('          - collectInput:');
          lines.push(`              name: "Collect Input ${escapeYamlString(promptSlug)}"`);
          lines.push('              inputAudio:');
          lines.push(
            `                tts: "Platzhalter Eingabe-Prompt ${escapeYamlString(promptSlug)}"`
          );
          lines.push('              inputData:');
          lines.push('                var: Task.collectedDigits');
          lines.push('              outputs:');
          lines.push('                success:');
          lines.push('                  actions: []');
          lines.push('                failure:');
          lines.push('                  actions: []');
          break;
        }
        case 'menu': {
          const menuSlug = toArchySlug(action.target || 'IVR_Menu', 'IVR_Menu');
          lines.push('          - menu:');
          lines.push(`              name: "Menu ${escapeYamlString(menuSlug)}"`);
          lines.push('              audio:');
          lines.push(
            `                tts: "Platzhalter Menue ${escapeYamlString(menuSlug)}"`
          );
          break;
        }
        case 'callDataAction': {
          const category = action.dataActionCategory || 'Oracle_Integration';
          const targetSlug = toArchySlug(action.target || category, 'ExternalAction');
          const prefixLabel =
            category === 'FlixCheck_API' ? 'FlixCheck' : 'Oracle';
          lines.push('          - callDataAction:');
          lines.push(
            `              name: "${prefixLabel} ${escapeYamlString(targetSlug)}"`
          );
          lines.push('              dataAction:');
          lines.push(`                category: "${category}"`);
          lines.push(`                dataAction: "${escapeYamlString(targetSlug)}"`);
          break;
        }
        case 'callCommonModule': {
          const modSlug = toArchySlug(action.target || 'CommonModule', 'CommonModule');
          lines.push('          - callCommonModule:');
          lines.push(`              name: "Call ${escapeYamlString(modSlug)}"`);
          lines.push('              commonModule:');
          lines.push(`                name: "${escapeYamlString(modSlug)}"`);
          break;
        }
        case 'callTask': {
          const taskRef = action.targetSlug || toArchySlug(action.target || 'SubTask', 'SubTask');
          lines.push('          - callTask:');
          lines.push(`              name: "Call Task ${escapeYamlString(taskRef)}"`);
          lines.push(
            `              targetTaskRef: "/inboundCall/tasks/task[${escapeYamlString(taskRef)}]"`
          );
          break;
        }
        case 'decision': {
          const condName = escapeYamlString(
            action.conditionLabel || action.target || 'Branch'
          );
          lines.push('          - decision:');
          lines.push(`              name: "Check ${condName}"`);
          lines.push('              condition:');
          lines.push('                exp: "Flow.avayaCondition == \\"true\\""');
          lines.push('              outputs:');
          lines.push('                yes:');
          lines.push('                  actions: []');
          lines.push('                no:');
          lines.push('                  actions: []');
          break;
        }
        case 'switch': {
          const switchName = escapeYamlString(action.target || 'Switch_Branch');
          lines.push('          - switch:');
          lines.push(`              name: "Switch ${switchName}"`);
          lines.push('              default:');
          lines.push('                actions: []');
          break;
        }
        case 'loop': {
          const loopSlug = toArchySlug(action.target || 'SectionLoop', 'SectionLoop');
          lines.push('          - loop:');
          lines.push(
            `              name: "Loop ${escapeYamlString(loopSlug)}"`
          );
          lines.push(`              maxLoopCount: ${action.maxLoopCount ?? 5}`);
          lines.push('              actions: []');
          break;
        }
        case 'setParticipantData': {
          const cvName = toArchySlug(action.variableName || 'CV_Data', 'CV_Data');
          const flowVar = action.archyVariableName || `Flow.${cvName}`;
          lines.push('          - setParticipantData:');
          lines.push(`              name: "Set Participant Data ${escapeYamlString(cvName)}"`);
          lines.push('              attributes:');
          lines.push('                - attribute:');
          lines.push(`                    name: "${escapeYamlString(cvName)}"`);
          lines.push('                    value:');
          lines.push(`                      exp: "${escapeYamlString(flowVar)}"`);
          break;
        }
        case 'getParticipantData': {
          const cvName = toArchySlug(action.variableName || 'CV_Data', 'CV_Data');
          const flowVar = action.archyVariableName || `Flow.${cvName}`;
          lines.push('          - getParticipantData:');
          lines.push(`              name: "Get Participant Data ${escapeYamlString(cvName)}"`);
          lines.push('              attributes:');
          lines.push('                - attribute:');
          lines.push(`                    name: "${escapeYamlString(cvName)}"`);
          lines.push(`                    variable: "${escapeYamlString(flowVar)}"`);
          break;
        }
        case 'updateData': {
          const varName = action.archyVariableName || 'Flow.avayaCondition';
          lines.push('          - updateData:');
          lines.push(
            `              name: "Update ${escapeYamlString(action.variableName || varName)}"`
          );
          lines.push('              statements:');
          lines.push('                - string:');
          lines.push(`                    variable: ${escapeYamlString(varName)}`);
          lines.push('                    value:');
          lines.push('                      lit: ""');
          break;
        }
        case 'transferToAcd': {
          const queueName = toArchySlug(action.target || 'Default_Queue', 'Default_Queue');
          lines.push('          - transferToAcd:');
          lines.push(
            `              name: "${action.isMultiSkillset ? 'Queue + Bullseye' : 'Queue'} ${escapeYamlString(queueName)}"`
          );
          lines.push('              targetQueue:');
          lines.push('                lit:');
          lines.push(`                  name: "${escapeYamlString(queueName)}"`);
          if (action.isMultiSkillset && action.skills && action.skills.length > 0) {
            lines.push('              skills:');
            for (const skill of action.skills) {
              const skillSlug = toArchySlug(skill, 'Skill');
              lines.push('                - lit:');
              lines.push(`                    name: "${escapeYamlString(skillSlug)}"`);
            }
          }
          break;
        }
        case 'transferToNumber': {
          const numTarget = escapeYamlString(action.target || '0000');
          lines.push('          - transferToNumber:');
          lines.push(`              name: "Transfer to ${numTarget}"`);
          lines.push('              targetNumber:');
          lines.push(`                lit: "${numTarget}"`);
          break;
        }
        case 'disconnect': {
          lines.push('          - disconnect:');
          lines.push('              name: "Disconnect Call"');
          break;
        }
      }
    }
  }

  // Emit local reusable tasks referenced by callTask so targetTaskRef is always valid
  for (const localTask of script.localReusableTasks) {
    lines.push('    - task:');
    lines.push(`        name: ${localTask.name}`);
    lines.push(`        refId: ${localTask.refId}`);
    lines.push('        actions:');
    lines.push('          - playAudio:');
    lines.push(
      `              name: "Subtask Placeholder ${escapeYamlString(localTask.name)}"`
    );
    lines.push('              audio:');
    lines.push(
      `                tts: "Platzhalter Task aus Avaya Subscript ${escapeYamlString(localTask.originalTarget)}"`
    );
  }

  return lines.join('\n');
}

/**
 * Generates Genesys Cloud Architect Mermaid (`flowchart TD`) with unmistakable Genesys labels
 * and dedicated `classDef` styling, for either a single script or the whole workspace overview.
 */
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
  const lines: string[] = [];
  lines.push('flowchart TD');
  lines.push(
    `  %% Genesys Cloud Architect Ziel-Flow (${script.fileName} | Readiness: ${script.readiness})`
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
  };

  let prevNodeId = startId;

  if (script.actions.length === 0) {
    lines.push('  GC_END(["Disconnect"])');
    lines.push(`  ${startId} --> GC_END`);
    classBuckets.gcDisconnect.push('GC_END');
  } else {
    script.actions.forEach((action, idx) => {
      const nodeId = toSafeMermaidId('GC_ACT', `${action.kind}_${idx + 1}`);
      const targetClean = escapeMermaidLabel(action.target || action.variableName || '');
      const lineHint = action.lineNumber > 0 ? ` · Z.${action.lineNumber}` : '';

      switch (action.kind) {
        case 'playAudio':
          lines.push(`  ${nodeId}["Play Audio: Prompt.${targetClean}${lineHint}"]`);
          classBuckets.gcAudio.push(nodeId);
          break;
        case 'collectInput':
          lines.push(`  ${nodeId}{"Collect Input: Task.collectedDigits (${targetClean})"}`);
          classBuckets.gcDecision.push(nodeId);
          break;
        case 'menu':
          lines.push(`  ${nodeId}{"Menu: ${targetClean}${lineHint}"}`);
          classBuckets.gcDecision.push(nodeId);
          break;
        case 'callDataAction':
          if (action.dataActionCategory === 'FlixCheck_API') {
            lines.push(`  ${nodeId}["Data Action: FlixCheck (${targetClean})"]`);
            classBuckets.gcFlixcheck.push(nodeId);
          } else {
            lines.push(`  ${nodeId}["Data Action: Oracle (${targetClean})"]`);
            classBuckets.gcOracle.push(nodeId);
          }
          break;
        case 'callCommonModule':
          lines.push(`  ${nodeId}[["Common Module: ${targetClean}"]]`);
          if (action.isBrokenTarget) classBuckets.gcBroken.push(nodeId);
          else classBuckets.gcCommon.push(nodeId);
          break;
        case 'callTask':
          lines.push(`  ${nodeId}["Call Task: ${targetClean}"]`);
          if (action.isBrokenTarget) classBuckets.gcBroken.push(nodeId);
          else classBuckets.gcTask.push(nodeId);
          break;
        case 'decision':
        case 'switch':
          lines.push(
            `  ${nodeId}{"${action.kind === 'switch' ? 'Switch' : 'Decision'}: ${escapeMermaidLabel(action.conditionLabel || targetClean || 'Bedingung')}"}`
          );
          classBuckets.gcDecision.push(nodeId);
          break;
        case 'loop':
          lines.push(
            `  ${nodeId}{{"Loop (max ${action.maxLoopCount ?? 5}): ${targetClean} [Warnung: Rueckwaerts-GOTO]"}}`
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
          lines.push(
            `  ${nodeId}["Update Data: ${escapeMermaidLabel(action.archyVariableName || targetClean)}"]`
          );
          classBuckets.gcData.push(nodeId);
          break;
        case 'transferToAcd':
          if (action.isMultiSkillset) {
            const skillList = escapeMermaidLabel((action.skills || []).join(', '));
            lines.push(
              `  ${nodeId}[("ACD Queue + Bullseye: ${targetClean} | Skills: ${skillList}")]`
            );
            classBuckets.gcBullseye.push(nodeId);
          } else {
            lines.push(`  ${nodeId}[("ACD Queue: ${targetClean}")]`);
            classBuckets.gcQueue.push(nodeId);
          }
          break;
        case 'transferToNumber':
          lines.push(`  ${nodeId}["Transfer to Number: ${targetClean}"]`);
          classBuckets.gcTransfer.push(nodeId);
          break;
        case 'disconnect':
          lines.push(`  ${nodeId}(["Disconnect"])`);
          classBuckets.gcDisconnect.push(nodeId);
          break;
      }

      if (action.kind === 'loop') {
        lines.push(`  ${prevNodeId} -.->|"Rueckwaerts-GOTO -> Loop"| ${nodeId}`);
      } else if (action.isBrokenTarget) {
        lines.push(`  ${prevNodeId} -.->|"Broken Target"| ${nodeId}`);
      } else {
        lines.push(`  ${prevNodeId} --> ${nodeId}`);
      }

      prevNodeId = nodeId;
    });
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

  // Select entry points + common modules + top connected/high-readiness scripts (keep readable at 350 scripts)
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

  for (const [cls, ids] of Object.entries(buckets)) {
    const uniq = Array.from(new Set(ids));
    if (uniq.length > 0) {
      lines.push(`  class ${uniq.join(',')} ${cls};`);
    }
  }
}

function translateSingleModule(
  node: ParsedScriptNode,
  mod: ScriptModule | undefined,
  ctx: {
    knownKeyLookup: Map<string, string>;
    incomingCallCountByKey: Map<string, number>;
    brokenTargetKeysForScript: Set<string>;
  }
): GenesysScriptTranslation {
  const rawText = mod?.rawText || '';
  const strippedLines = rawText ? stripCommentsPreservingLines(rawText) : [];
  const oclVars = extractOclDeclaredVariables(strippedLines);
  const scopedVariables = extractScopedVariables(strippedLines);

  // Pre-scan SECTION <Name> definitions with exact 1-based line numbers
  const sectionLineByName = new Map<string, number>();
  for (let i = 0; i < strippedLines.length; i += 1) {
    const m = strippedLines[i].match(
      /^\s*SECTION\s+([A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_.-]*)/i
    );
    if (m) {
      const secKey = m[1].trim().toLowerCase();
      if (!sectionLineByName.has(secKey)) {
        sectionLineByName.set(secKey, i + 1);
      }
    }
  }

  const actions: GenesysMappedAction[] = [];
  const warnings: GenesysScriptWarning[] = [];
  const localReusableTasksMap = new Map<
    string,
    { name: string; refId: string; originalTarget: string }
  >();
  const actionDedup = new Set<string>();

  const pushAction = (action: Omit<GenesysMappedAction, 'id'>) => {
    const key = `${action.kind}::${action.target || action.variableName || ''}::${action.lineNumber}`;
    if (actionDedup.has(key)) return;
    actionDedup.add(key);
    actions.push({
      ...action,
      id: `ga-${actions.length + 1}`,
    });
  };

  let backwardGotoCount = 0;
  let hasMultiSkillset = false;
  let oracleApiCount = 0;
  let flixcheckApiCount = 0;
  let commonModuleCallCount = 0;
  let callTaskCount = 0;
  const uniqueSkillsets = new Set<string>();

  const resolveStaticVar = (tok: string): string => {
    const clean = tok.trim().replace(/^["']|["']$/g, '');
    return oclVars.staticStringLiterals.get(clean.toLowerCase()) || clean;
  };

  const handleSubscriptOrExternalCall = (
    rawToken: string,
    cmdLabel: string,
    lineNumber: number
  ) => {
    const resolved = resolveStaticVar(rawToken);
    const clean = normalizeScriptRef(stripKnownScriptExtension(resolved));
    if (
      !clean ||
      isDeactivatedSentinelTarget(clean) ||
      isDynamicAvayaVariableTarget(clean, oclVars.declaredVars)
    ) {
      return;
    }

    const matchKey = canonicalScriptMatchKey(clean);
    const knownPrimaryKey = ctx.knownKeyLookup.get(matchKey);

    // Check FlixCheck / Oracle first if not a regular local script (or explicitly FlixCheck/Oracle)
    const waypointReason = classifyAvayaWaypointTarget(clean, {
      knownScriptKeys: ctx.knownKeyLookup,
      declaredVars: oclVars.declaredVars,
    });

    if (!knownPrimaryKey && (FLIXCHECK_RE.test(clean) || /flixcheck/i.test(waypointReason || ''))) {
      flixcheckApiCount += 1;
      pushAction({
        kind: 'callDataAction',
        avayaCommand: cmdLabel,
        genesysLabel: `Data Action: FlixCheck (${clean})`,
        lineNumber,
        target: clean,
        targetSlug: toArchySlug(clean),
        dataActionCategory: 'FlixCheck_API',
      });
      return;
    }

    if (!knownPrimaryKey && (ORACLE_RE.test(clean) || /oracle/i.test(waypointReason || ''))) {
      oracleApiCount += 1;
      pushAction({
        kind: 'callDataAction',
        avayaCommand: cmdLabel,
        genesysLabel: `Data Action: Oracle (${clean})`,
        lineNumber,
        target: clean,
        targetSlug: toArchySlug(clean),
        dataActionCategory: 'Oracle_Integration',
      });
      return;
    }

    // Pure numeric CDN not in known scripts -> Transfer to Number
    if (!knownPrimaryKey && /^\+?\d{2,16}$/.test(clean)) {
      pushAction({
        kind: 'transferToNumber',
        avayaCommand: cmdLabel,
        genesysLabel: `Transfer to Number: ${clean}`,
        lineNumber,
        target: clean,
      });
      return;
    }

    const targetPoolKey = knownPrimaryKey || matchKey;
    const incomingCalls = ctx.incomingCallCountByKey.get(targetPoolKey) || 0;
    const isBroken = !knownPrimaryKey && ctx.brokenTargetKeysForScript.has(matchKey);

    // Binding Rule: Aufrufe >= 3 -> Call Common Module, Aufrufe < 3 -> Call Task
    if (incomingCalls >= 3) {
      commonModuleCallCount += 1;
      pushAction({
        kind: 'callCommonModule',
        avayaCommand: cmdLabel,
        genesysLabel: `Common Module: ${clean}`,
        lineNumber,
        target: clean,
        targetSlug: toArchySlug(clean),
        isBrokenTarget: isBroken,
      });
    } else {
      callTaskCount += 1;
      const taskSlug = toArchySlug(clean, 'SubTask');
      if (!localReusableTasksMap.has(taskSlug)) {
        localReusableTasksMap.set(taskSlug, {
          name: taskSlug,
          refId: taskSlug,
          originalTarget: clean,
        });
      }
      pushAction({
        kind: 'callTask',
        avayaCommand: cmdLabel,
        genesysLabel: `Call Task: ${clean}`,
        lineNumber,
        target: clean,
        targetSlug: taskSlug,
        isBrokenTarget: isBroken,
      });
    }
  };

  // Line-accurate deterministic OCL scan
  for (let i = 0; i < strippedLines.length; i += 1) {
    const lineNumber = i + 1;
    const line = strippedLines[i].trim();
    if (!line) continue;

    // Detect CV_ / GV_ / LV_ variable reads or assignments
    const assignMatch =
      line.match(/\bSET\s+((?:CV|GV|LV)_[A-Za-z0-9_]+)\s*(?:=|:=)/i) ||
      line.match(/\bASSIGN\s+.+?\s+TO\s+((?:CV|GV|LV)_[A-Za-z0-9_]+)\b/i) ||
      line.match(/\bASSIGN\s+((?:CV|GV|LV)_[A-Za-z0-9_]+)\s*=/i);
    if (assignMatch && assignMatch[1]) {
      const vName = assignMatch[1];
      const info = resolveVariablePrefixInfo(vName);
      if (info) {
        if (info.scope === 'participantData') {
          pushAction({
            kind: 'setParticipantData',
            avayaCommand: 'SET/ASSIGN CV_*',
            genesysLabel: `Set Participant Data: ${vName}`,
            lineNumber,
            variableName: vName,
            archyVariableName: info.archyName,
          });
        } else {
          pushAction({
            kind: 'updateData',
            avayaCommand: `SET/ASSIGN ${info.scope === 'flow' ? 'GV_*' : 'LV_*'}`,
            genesysLabel: `Update Data: ${info.archyName}`,
            lineNumber,
            variableName: vName,
            archyVariableName: info.archyName,
          });
        }
      }
    } else if (/\b(?:IF|WHERE|READVAR|GET)\b/i.test(line)) {
      const cvRead = line.match(/\b(CV_[A-Za-z0-9_]+)\b/i);
      if (cvRead && cvRead[1]) {
        const info = resolveVariablePrefixInfo(cvRead[1])!;
        pushAction({
          kind: 'getParticipantData',
          avayaCommand: 'READ CV_*',
          genesysLabel: `Get Participant Data: ${cvRead[1]}`,
          lineNumber,
          variableName: cvRead[1],
          archyVariableName: info.archyName,
        });
      }
    }

    const clauses = splitInlineIfThenElseClauses(line);
    const statements: string[] = [];
    for (const clause of clauses) {
      if (clause.kind === 'if-then' || clause.kind === 'else-if-then') {
        if (clause.condition && !/\bGOTO\b/i.test(clause.action || '')) {
          pushAction({
            kind: 'decision',
            avayaCommand: 'IF ... THEN',
            genesysLabel: `Decision: ${clause.condition.slice(0, 48)}`,
            lineNumber,
            conditionLabel: clause.condition.slice(0, 48),
          });
        }
      }
      if (!clause.action) continue;
      for (const stmt of splitOclStatementsOutsideQuotes(clause.action)) {
        const trimmed = stmt.trim();
        if (trimmed) statements.push(trimmed);
      }
    }

    for (const stmt of statements) {
      // 1. Oracle / FlixCheck API commands (SEND REQUEST, HOST, SEND INFO, GET RESPONSE)
      const apiMatch = stmt.match(
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
          rawLine: stmt,
          activeVars: oclVars.staticStringLiterals,
          moduleContextText: mod?.scriptName || node.scriptNumber,
        });

        if (flixMeta?.isFlixcheck || FLIXCHECK_RE.test(stmt)) {
          flixcheckApiCount += 1;
          const target = flixMeta?.providerId || firstArg || 'FlixCheck_Action';
          pushAction({
            kind: 'callDataAction',
            avayaCommand: cmdLabel,
            genesysLabel: `Data Action: FlixCheck (${target})`,
            lineNumber,
            target,
            targetSlug: toArchySlug(target),
            dataActionCategory: 'FlixCheck_API',
          });
        } else if (ORACLE_RE.test(stmt) || cmdLabel.startsWith('HOST')) {
          oracleApiCount += 1;
          const target = firstArg || 'Oracle_Host_Action';
          pushAction({
            kind: 'callDataAction',
            avayaCommand: cmdLabel,
            genesysLabel: `Data Action: Oracle (${target})`,
            lineNumber,
            target,
            targetSlug: toArchySlug(target),
            dataActionCategory: 'Oracle_Integration',
          });
        }
        continue;
      }

      // 2. GIVE RAN / PLAY PROMPT -> Play Audio
      const promptMatch = stmt.match(
        /\b(?:GIVE\s+(?:RAN|ANNOUNCEMENT|MUSIC)|PLAY\s+(?:PROMPT|AUDIO|ANNOUNCEMENT))\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+))/i
      );
      if (promptMatch) {
        const promptName = (promptMatch[1] || promptMatch[2] || promptMatch[3] || '').trim();
        if (promptName) {
          pushAction({
            kind: 'playAudio',
            avayaCommand: 'GIVE RAN / PLAY PROMPT',
            genesysLabel: `Play Audio: Prompt.${toArchySlug(promptName)}`,
            lineNumber,
            target: promptName,
            targetSlug: toArchySlug(promptName),
          });
        }
        continue;
      }

      // 3. COLLECT DIGITS / GIVE IVR -> Collect Input / Menu
      const collectMatch = stmt.match(
        /\b(COLLECT\s+\d*\s*DIGITS|COLLECT\s+DIGITS|GIVE\s+IVR)\b(.*)$/i
      );
      if (collectMatch) {
        const rest = (collectMatch[2] || '').trim();
        const promptTok =
          rest.match(/["']([^"']+)["']/)?.[1] || rest.split(/\s+/)[0] || 'DTMF_Input';
        pushAction({
          kind: 'collectInput',
          avayaCommand: collectMatch[1].replace(/\s+/g, ' ').toUpperCase(),
          genesysLabel: `Collect Input: Task.collectedDigits`,
          lineNumber,
          target: promptTok,
          targetSlug: toArchySlug(promptTok, 'DTMF_Input'),
        });
        continue;
      }

      // 4. QUEUE TO SKILLSET (1 vs Multi-Skillset Bullseye)
      const queueMatch = stmt.match(
        /\bQUEUE\s+TO\s+(?:NETWORK\s+)?(?:SKILLSET|AGENT)\s+(.+?)(?:\s+WITH\s+PRIORITY\b|\s+PRIORITY\b|$)/i
      );
      if (queueMatch) {
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
          pushAction({
            kind: 'transferToAcd',
            avayaCommand: isMulti ? 'QUEUE TO SKILLSET (Multi)' : 'QUEUE TO SKILLSET',
            genesysLabel: isMulti
              ? `ACD Queue + Bullseye: ${items[0]} (${items.join(', ')})`
              : `ACD Queue: ${items[0]}`,
            lineNumber,
            target: items[0],
            targetSlug: toArchySlug(items[0]),
            skills: isMulti ? items : undefined,
            isMultiSkillset: isMulti,
            warning: isMulti
              ? 'Multi-Skillset in eine Ziel-Queue + ACD Skills & Bullseye-Ringe umbauen'
              : undefined,
          });
        }
        continue;
      }

      // 5. GOTO <Target> (Forward vs Backward Loop!)
      const gotoMatch = stmt.match(
        /\bGOTO\s+(?:"([^"]+)"|'([^']+)'|([A-Za-zÄÖÜäöüß0-9_.-]+))/i
      );
      if (gotoMatch) {
        const rawTarget = (gotoMatch[1] || gotoMatch[2] || gotoMatch[3] || '').trim();
        if (rawTarget) {
          const secLine = sectionLineByName.get(rawTarget.toLowerCase());
          if (secLine !== undefined) {
            if (secLine <= lineNumber) {
              // Rückwärts-GOTO -> Loop + verbindliche Warnung
              backwardGotoCount += 1;
              const msg = `Unstrukturiertes Rückwärts-GOTO in Loop umbauen (GOTO ${rawTarget} in Zeile ${lineNumber} -> SECTION ${rawTarget} in Zeile ${secLine}).`;
              warnings.push({
                code: 'BACKWARD_GOTO_LOOP',
                severity: 'warning',
                message: msg,
                lineNumber,
              });
              pushAction({
                kind: 'loop',
                avayaCommand: 'GOTO (rückwärts)',
                genesysLabel: `Loop: ${rawTarget}`,
                lineNumber,
                target: rawTarget,
                targetSlug: toArchySlug(rawTarget),
                isBackwardGoto: true,
                maxLoopCount: 5,
                warning: msg,
              });
            } else {
              // Vorwärts-GOTO -> Decision / Task Branch
              pushAction({
                kind: 'decision',
                avayaCommand: 'GOTO (vorwärts)',
                genesysLabel: `Decision -> ${rawTarget}`,
                lineNumber,
                target: rawTarget,
                conditionLabel: `Jump_${rawTarget}`,
              });
            }
          } else {
            // External fallback GOTO
            const targetKey = canonicalScriptMatchKey(stripKnownScriptExtension(rawTarget));
            if (ctx.knownKeyLookup.has(targetKey)) {
              handleSubscriptOrExternalCall(rawTarget, 'GOTO', lineNumber);
            }
          }
        }
        continue;
      }

      // 6. GIVE CDN / TRANSFER TO / ROUTE CALL -> Transfer to Number
      const transferMatch = stmt.match(
        /\b(GIVE\s+CDN|TRANSFER\s+TO|ROUTE\s+CALL(?:\s+TO)?)\s+(?:CDN\s+|VDN\s+|SCRIPT\s+)?(?:"([^"]+)"|'([^']+)'|(\+?\d{2,16}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]*))/i
      );
      if (transferMatch) {
        const cmd = transferMatch[1].replace(/\s+/g, ' ').trim().toUpperCase();
        const target = (transferMatch[2] || transferMatch[3] || transferMatch[4] || '').trim();
        if (target) {
          pushAction({
            kind: 'transferToNumber',
            avayaCommand: cmd,
            genesysLabel: `Transfer to Number: ${target}`,
            lineNumber,
            target,
          });
        }
        continue;
      }

      // 7. DISCONNECT / ROUTE END / DROP CALL -> Disconnect
      if (/\b(?:DISCONNECT|ROUTE\s+END|DROP\s+CALL)\b/i.test(stmt)) {
        pushAction({
          kind: 'disconnect',
          avayaCommand: /\bROUTE\s+END\b/i.test(stmt)
            ? 'ROUTE END'
            : /\bDROP\s+CALL\b/i.test(stmt)
            ? 'DROP CALL'
            : 'DISCONNECT',
          genesysLabel: 'Disconnect',
          lineNumber,
        });
        continue;
      }

      // 8. EXECUTE / CALL SCRIPT / SUBSCRIPT -> Call Task (<3) or Call Common Module (>=3)
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
          handleSubscriptOrExternalCall(token, cmd, lineNumber);
        }
      }
    }
  }

  // Supplement from AuditNode edges & ScriptRules (for Visio flows / shorthand scripts without raw OCL commands)
  if (actions.length === 0) {
    for (const rule of mod?.rules || []) {
      if (rule.announcement) {
        pushAction({
          kind: 'playAudio',
          avayaCommand: 'Ansage',
          genesysLabel: `Play Audio: Prompt.${toArchySlug(rule.announcement)}`,
          lineNumber: rule.prio || 0,
          target: rule.announcement,
          targetSlug: toArchySlug(rule.announcement),
        });
      }
      if (rule.choices && rule.choices.length > 0) {
        pushAction({
          kind: 'menu',
          avayaCommand: 'DTMF / Auswahl',
          genesysLabel: `Menu: ${rule.stepName || 'Auswahl'}`,
          lineNumber: rule.prio || 0,
          target: rule.stepName || 'Auswahl',
          choices: rule.choices.map((c) => ({ digit: c.choice, target: c.targetNumber })),
        });
      }
    }

    for (const edge of node.edges) {
      if (edge.targetType === 'SKILLSET_QUEUE') {
        uniqueSkillsets.add(edge.rawTarget);
        pushAction({
          kind: 'transferToAcd',
          avayaCommand: edge.command,
          genesysLabel: `ACD Queue: ${edge.rawTarget}`,
          lineNumber: edge.lineNumber,
          target: edge.rawTarget,
          targetSlug: toArchySlug(edge.rawTarget),
        });
      } else if (edge.targetType === 'FLIXCHECK') {
        flixcheckApiCount += 1;
        pushAction({
          kind: 'callDataAction',
          avayaCommand: edge.command,
          genesysLabel: `Data Action: FlixCheck (${edge.rawTarget})`,
          lineNumber: edge.lineNumber,
          target: edge.rawTarget,
          targetSlug: toArchySlug(edge.rawTarget),
          dataActionCategory: 'FlixCheck_API',
        });
      } else if (edge.targetType === 'ORACLE') {
        oracleApiCount += 1;
        pushAction({
          kind: 'callDataAction',
          avayaCommand: edge.command,
          genesysLabel: `Data Action: Oracle (${edge.rawTarget})`,
          lineNumber: edge.lineNumber,
          target: edge.rawTarget,
          targetSlug: toArchySlug(edge.rawTarget),
          dataActionCategory: 'Oracle_Integration',
        });
      } else if (edge.targetType === 'CDN_NUMBER') {
        pushAction({
          kind: 'transferToNumber',
          avayaCommand: edge.command,
          genesysLabel: `Transfer to Number: ${edge.rawTarget}`,
          lineNumber: edge.lineNumber,
          target: edge.rawTarget,
        });
      } else if (edge.targetType === 'LOCAL_SCRIPT' || edge.targetType === 'MISSING_OR_BROKEN') {
        handleSubscriptOrExternalCall(edge.rawTarget, edge.command, edge.lineNumber);
      }
    }

    if (node.hasTermination && !actions.some((a) => a.kind === 'disconnect')) {
      pushAction({
        kind: 'disconnect',
        avayaCommand: node.terminationCommands[0] || 'DISCONNECT',
        genesysLabel: 'Disconnect',
        lineNumber: 0,
      });
    }
  }

  // Record Broken Link warnings from AuditReport
  const brokenLinkCount = ctx.brokenTargetKeysForScript.size;
  if (brokenLinkCount > 0) {
    warnings.push({
      code: 'BROKEN_LINK',
      severity: 'blocker',
      message: `${brokenLinkCount} fehlende Skript-Referenz(en) (Broken Links) vor Migration in Genesys Cloud klären.`,
    });
  }

  const externalApiCount = oracleApiCount + flixcheckApiCount;
  if (externalApiCount > 2) {
    warnings.push({
      code: 'HIGH_EXTERNAL_API_COUNT',
      severity: 'warning',
      message: `${externalApiCount} externe API-/Host-Aufrufe (Oracle/FlixCheck) erfordern abgestimmte Genesys Web Services Data Actions.`,
    });
  }

  const callVariableCount = scopedVariables.filter((v) => v.scope === 'participantData').length;
  const subscriptCallCount = commonModuleCallCount + callTaskCount;

  // Binding Readiness Classification (LOW | MEDIUM | HIGH)
  const readinessReasons: string[] = [];
  let readiness: GenesysReadinessLevel = 'LOW';

  if (hasMultiSkillset) readinessReasons.push('Multi-Skillset-Queueing (Bullseye erforderlich)');
  if (backwardGotoCount > 0) {
    readinessReasons.push(`${backwardGotoCount} Rückwärts-GOTO-Schleife(n)`);
  }
  if (externalApiCount > 2) readinessReasons.push(`${externalApiCount} externe APIs (> 2)`);
  if (brokenLinkCount > 0) readinessReasons.push(`${brokenLinkCount} Broken Link(s)`);

  if (
    hasMultiSkillset ||
    backwardGotoCount > 0 ||
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
    if (oracleApiCount > 0) readinessReasons.push(`${oracleApiCount} Oracle Data Action(s)`);
    if (flixcheckApiCount > 0) {
      readinessReasons.push(`${flixcheckApiCount} FlixCheck Data Action(s)`);
    }

    if (
      subscriptCallCount >= 2 ||
      callVariableCount > 0 ||
      oracleApiCount > 0 ||
      flixcheckApiCount > 0
    ) {
      readiness = 'MEDIUM';
    } else {
      readiness = 'LOW';
      readinessReasons.push('Linearer Flow (max. 1 Skillset, keine Rückwärts-GOTOs, keine Blocker)');
    }
  }

  const cleanName = toArchySlug(node.scriptNumber || node.fileName, 'Avaya_Flow');
  const incomingCallCount = ctx.incomingCallCountByKey.get(node.scriptKey) || 0;

  const partial: GenesysScriptTranslation = {
    scriptKey: node.scriptKey,
    scriptNumber: node.scriptNumber,
    fileName: node.fileName,
    cleanName,
    archyFilename: `${cleanName}.yaml`,
    isEntryPoint: node.isEntryPoint,
    incomingCallCount,
    isCommonModuleTarget: incomingCallCount >= 3,
    readiness,
    readinessReasons,
    metrics: {
      actionCount: actions.length,
      subscriptCallCount,
      commonModuleCallCount,
      callTaskCount,
      skillsetCount: uniqueSkillsets.size,
      hasMultiSkillset,
      backwardGotoCount,
      externalApiCount,
      oracleApiCount,
      flixcheckApiCount,
      callVariableCount,
      brokenLinkCount,
    },
    variables: scopedVariables,
    actions,
    localReusableTasks: Array.from(localReusableTasksMap.values()),
    warnings,
    archyYaml: '',
    genesysMermaid: '',
  };

  partial.archyYaml = generateArchyYaml(partial);
  partial.genesysMermaid = generateSingleScriptGenesysMermaid(partial);
  return partial;
}

/**
 * Deterministically translates an entire Avaya AACC workspace (or ScriptModule[])
 * into Genesys Cloud Architect structures (Mermaid `flowchart TD`, Archy YAML, Readiness).
 */
export function translateAvayaWorkspaceToGenesys(
  input: ScriptWorkspace | ScriptModule[],
  options?: { precomputedAuditReport?: AuditReport; generatedAt?: string }
): GenesysWorkspaceTranslation {
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

  // Count incoming calls across workspace so >= 3 triggers Call Common Module
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

  const scripts: GenesysScriptTranslation[] = [];
  const scriptsByKey: Record<string, GenesysScriptTranslation> = {};

  for (const node of auditReport.nodes) {
    const translated = translateSingleModule(node, moduleByKey.get(node.scriptKey), {
      knownKeyLookup,
      incomingCallCountByKey,
      brokenTargetKeysForScript: brokenByScriptKey.get(node.scriptKey) || new Set<string>(),
    });
    scripts.push(translated);
    scriptsByKey[translated.scriptKey] = translated;
  }

  const lowCount = scripts.filter((s) => s.readiness === 'LOW').length;
  const mediumCount = scripts.filter((s) => s.readiness === 'MEDIUM').length;
  const highCount = scripts.filter((s) => s.readiness === 'HIGH').length;
  const overallReadiness: GenesysReadinessLevel =
    highCount > 0 ? 'HIGH' : mediumCount > 0 ? 'MEDIUM' : 'LOW';

  const result: GenesysWorkspaceTranslation = {
    schemaVersion: '1.4.0',
    generatedAt: options?.generatedAt || auditReport.generatedAt,
    privacyMode: '100%-in-memory-metadata-only',
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
 * Packages all generated Genesys Archy YAML files plus a Readiness README.md into a
 * 100% in-memory ZIP Blob (`genesys-archy-flows.zip`) using JSZip.
 */
export async function exportAllArchyYamlsZipBlob(
  translation: GenesysWorkspaceTranslation
): Promise<Blob> {
  const zip = new JSZip();
  const flowsFolder = zip.folder('archy-flows') || zip;
  const usedNames = new Set<string>();

  for (const script of translation.scripts) {
    let fname = script.archyFilename;
    let counter = 2;
    while (usedNames.has(fname.toLowerCase())) {
      fname = `${script.cleanName}_${counter}.yaml`;
      counter += 1;
    }
    usedNames.add(fname.toLowerCase());
    flowsFolder.file(fname, script.archyYaml);
  }

  const readmeLines: string[] = [
    '# Genesys Cloud Architect (Archy YAML) Migrations-Paket',
    '',
    `- **Erzeugt am:** ${translation.generatedAt}`,
    `- **Gesamt-Komplexität (Readiness):** ${translation.overallReadiness}`,
    `- **Skripte gesamt:** ${translation.summary.totalScripts} (LOW: ${translation.summary.lowCount} · MEDIUM: ${translation.summary.mediumCount} · HIGH: ${translation.summary.highCount})`,
    `- **Common Module Kandidaten (>= 3 Aufrufe):** ${translation.summary.commonModuleCount}`,
    `- **Warnungen:** ${translation.summary.totalWarnings} (Rückwärts-GOTO: ${translation.summary.backwardGotoScripts} · Multi-Skillset: ${translation.summary.multiSkillsetScripts} · Broken Links: ${translation.summary.brokenLinks})`,
    '',
    '| Avaya Datei | Archy YAML | Readiness | Warnungen | Gründe |',
    '| --- | --- | --- | ---: | --- |',
  ];

  for (const s of translation.scripts) {
    readmeLines.push(
      `| \`${s.fileName}\` | \`archy-flows/${s.archyFilename}\` | **${s.readiness}** | ${s.warnings.length} | ${s.readinessReasons.join('; ')} |`
    );
  }

  zip.file('README.md', readmeLines.join('\n'));
  zip.file('genesys-overview.mmd', translation.masterGenesysMermaid);

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
