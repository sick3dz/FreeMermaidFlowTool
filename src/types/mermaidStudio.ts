export type MermaidBaseTheme = 'default' | 'neutral' | 'dark' | 'forest' | 'base';
export type MermaidLook = 'classic' | 'handDrawn';
export type MermaidLayoutEngine = 'dagre' | 'elk';
export type FlowchartCurve = 'basis' | 'bumpX' | 'bumpY' | 'cardinal' | 'catmullRom' | 'linear' | 'monotoneX' | 'monotoneY' | 'natural' | 'step' | 'stepAfter' | 'stepBefore';
export type DiagramDirection = 'TB' | 'TD' | 'RL' | 'LR' | 'BT';
export type SmartColorMode = 'standard' | 'semantic' | 'clusters' | 'high-contrast';

export interface LegendItem {
  id: string;
  label: string;
  fillColor: string;
  borderColor: string;
  textColor: string;
  count: number;
}

export interface LogicAnalysisSummary {
  activeMode: SmartColorMode;
  recommendedMode: SmartColorMode;
  recommendationReason: string;
  legend: LegendItem[];
  nodeCount: number;
  clusterCount: number;
  asyncEdgeCount: number;
}

export type CallflowNodeRole = 'entry' | 'hub' | 'step' | 'terminal';
export type CallflowDirectionFilter = 'both' | 'upstream' | 'downstream';
export type CallflowHopDepth = 1 | 2 | 'all';

export interface CallflowNode {
  id: string;
  label: string;
  inDegree: number;
  outDegree: number;
  role: CallflowNodeRole;
}

export interface CallflowEdge {
  from: string;
  to: string;
  label: string;
  rawArrow: string;
  isAsync: boolean;
}

export interface CallflowGraph {
  nodes: Map<string, CallflowNode>;
  edges: CallflowEdge[];
  entryNodes: CallflowNode[];
  hubNodes: CallflowNode[];
  terminalNodes: CallflowNode[];
}

export interface CallflowCycleEdge {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  label: string;
  direction: 'upstream' | 'downstream';
}

export interface CallflowTraceResult {
  selectedNode: CallflowNode;
  entryPoints: CallflowNode[];
  directCallers: Array<{ node: CallflowNode; edgeLabel: string }>;
  directCallees: Array<{ node: CallflowNode; edgeLabel: string }>;
  terminalPoints: CallflowNode[];
  upstreamNodeIds: Set<string>;
  downstreamNodeIds: Set<string>;
  activeNodeIds: Set<string>;
  upstreamDepthByNodeId: Map<string, number>;
  downstreamDepthByNodeId: Map<string, number>;
  upstreamEdges: CallflowEdge[];
  downstreamEdges: CallflowEdge[];
  activeEdges: CallflowEdge[];
  cycleEdges: CallflowCycleEdge[];
}

export type ScriptOrigin = 'legacy-text' | 'visio-new';

export interface ScriptChoiceOption {
  choice: string;
  targetNumber: string;
  label?: string;
}

export interface ScriptRule {
  id: string;
  prio: number;
  stepName: string;
  sourceNumber: string;
  targetNumber?: string;
  choices: ScriptChoiceOption[];
  condition?: string;
  schedule?: string;
  holiday?: string;
  announcement?: string;
  queueTarget?: string;
  rawLine: string;
}

export interface ScriptModule {
  scriptNumber: string;
  scriptName: string;
  isMaster: boolean;
  origin?: ScriptOrigin;
  visioPageName?: string;
  sourceFilename?: string;
  rawText: string;
  rules: ScriptRule[];
  outgoingNumbers: string[];
}

export interface ScriptManualLink {
  id: string;
  fromScriptNumber: string;
  fromRuleId?: string;
  toTargetNumber: string;
  label?: string;
  note?: string;
}

export type CallflowIssueType =
  | 'missing-script'
  | 'unclear-transition'
  | 'manual-question';

export type CallflowIssueStatus = 'open' | 'resolved';

export type CallflowIssueResolution =
  | 'external-endpoint'
  | 'linked-target'
  | 'answered';

export interface CallflowOpenIssue {
  id: string;
  type: CallflowIssueType;
  status: CallflowIssueStatus;
  sourceScriptNumber: string;
  targetNumber?: string;
  ruleId?: string;
  title: string;
  question: string;
  resolution?: CallflowIssueResolution;
  resolutionNote?: string;
  linkedTargetNumber?: string;
  isManual?: boolean;
  createdAt: number;
  resolvedAt?: number;
}

export interface ResolvedIssueRecord {
  resolution: CallflowIssueResolution;
  note?: string;
  linkedTargetNumber?: string;
  resolvedAt: number;
}

export type MasterChecklistItemStatus = 'present' | 'missing' | 'external';

export interface MasterScriptChecklistItem {
  id: string;
  orderIndex: number;
  refKey: string;
  displayName: string;
  callerScriptNumber: string;
  parentScriptNumber?: string;
  depth?: number;
  ruleId?: string;
  prio?: number;
  contextLabel: string;
  status: MasterChecklistItemStatus;
  matchedModuleNumber?: string;
}

export interface ScriptWorkspace {
  modules: ScriptModule[];
  missingTargets: string[];
  externalEndpoints?: string[];
  ignoredChecklistTargets?: string[];
  resolvedIssues?: Record<string, ResolvedIssueRecord>;
  manualQuestions?: CallflowOpenIssue[];
  manualLinks?: ScriptManualLink[];
  issues?: CallflowOpenIssue[];
  openIssueCount?: number;
  masterScriptNumber?: string;
  masterChecklist?: MasterScriptChecklistItem[];
  updatedAt: number;
}

export type CallflowViewLevel =
  | { level: 'master' }
  | { level: 'detail'; scriptNumber: string };

export interface ThemeConfiguration {
  theme: MermaidBaseTheme;
  look: MermaidLook;
  layoutEngine: MermaidLayoutEngine;
  nodeSpacing: number;
  rankSpacing: number;
  curve: FlowchartCurve;
  fontFamily: string;
  fontSize: number;
  useCustomColors: boolean;
  primaryColor: string;
  primaryTextColor: string;
  primaryBorderColor: string;
  lineColor: string;
  secondaryColor: string;
  tertiaryColor: string;
  background: string;
  mainBkg: string;
  nodeBorder: string;
  clusterBkg: string;
  clusterBorder: string;
  titleColor: string;
  edgeLabelBackground: string;
}

export interface DiagramTemplate {
  id: string;
  name: string;
  category: 'Architektur & System' | 'Software & Daten' | 'Ablauf & Prozess' | 'Projekt & Planung' | 'Analyse & Struktur';
  badge: string;
  description: string;
  supportsDirection: boolean;
  code: string;
}

export interface CodeSnippet {
  id: string;
  label: string;
  category: 'Knoten & Formen' | 'Verbindungen' | 'Struktur & Subgraphs' | 'Sequenz & Klassen' | 'Styling';
  description: string;
  snippet: string;
}

export interface SavedDiagram {
  id: string;
  title: string;
  code: string;
  updatedAt: number;
  themeConfig: ThemeConfiguration;
  scriptWorkspace?: ScriptWorkspace;
}

export interface ValidationState {
  isValid: boolean;
  diagramType: string;
  errorMessage: string | null;
  errorLine: number | null;
  lastRenderMs: number;
}
