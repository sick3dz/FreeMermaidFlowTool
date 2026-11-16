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

export interface CallflowTraceResult {
  selectedNode: CallflowNode;
  entryPoints: CallflowNode[];
  directCallers: Array<{ node: CallflowNode; edgeLabel: string }>;
  directCallees: Array<{ node: CallflowNode; edgeLabel: string }>;
  terminalPoints: CallflowNode[];
  upstreamNodeIds: Set<string>;
  downstreamNodeIds: Set<string>;
  activeNodeIds: Set<string>;
  upstreamEdges: CallflowEdge[];
  downstreamEdges: CallflowEdge[];
  activeEdges: CallflowEdge[];
}

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
}

export interface ValidationState {
  isValid: boolean;
  diagramType: string;
  errorMessage: string | null;
  errorLine: number | null;
  lastRenderMs: number;
}
