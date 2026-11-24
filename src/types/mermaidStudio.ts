export type MermaidBaseTheme = 'default' | 'neutral' | 'dark' | 'forest' | 'base';
export type MermaidLook = 'classic' | 'handDrawn';
export type MermaidLayoutEngine = 'dagre' | 'elk';
export type FlowchartCurve = 'basis' | 'bumpX' | 'bumpY' | 'cardinal' | 'catmullRom' | 'linear' | 'monotoneX' | 'monotoneY' | 'natural' | 'step' | 'stepAfter' | 'stepBefore';
export type DiagramDirection = 'TB' | 'TD' | 'RL' | 'LR' | 'BT';
export type SmartColorMode = 'standard' | 'semantic' | 'clusters' | 'high-contrast';
export type PathColorMode = 'semantic' | 'branches';

export type SmartColorNodeType =
  | 'announcement'
  | 'queue'
  | 'decision'
  | 'storage'
  | 'start-actor'
  | 'core-service'
  | 'error-alert';

export interface LegendItem {
  id: string;
  label: string;
  fillColor: string;
  borderColor: string;
  textColor: string;
  count: number;
  kind?: 'node' | 'edge';
  dashed?: boolean;
}

export interface LogicAnalysisSummary {
  activeMode: SmartColorMode;
  recommendedMode: SmartColorMode;
  recommendationReason: string;
  legend: LegendItem[];
  nodeCount: number;
  hiddenNodeCount?: number;
  detectedTypeCounts?: Partial<Record<SmartColorNodeType, number>>;
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

export type ExternalApiCommandKind =
  | 'send-request'
  | 'get-response'
  | 'send-info'
  | 'readvar'
  | 'host-call';

export type FlixcheckActionKind =
  | 'create-check'
  | 'get-check'
  | 'update-custom-values'
  | 'download-file'
  | 'webhook'
  | 'generic';

export type FlixcheckChannelKind = 'sms' | 'whatsapp' | 'email' | 'unknown';

export type FlixcheckApiVersionStatus = 'v7' | 'v1-legacy' | 'via-provider';

export interface ExternalApiIntegrationMeta {
  provider: 'flixcheck' | 'hdx';
  providerId?: string;
  isFlixcheck: boolean;
  commandKind: ExternalApiCommandKind;
  action: FlixcheckActionKind;
  actionLabel: string;
  channel: FlixcheckChannelKind;
  channelLabel?: string;
  templateId?: string;
  recipientRef?: string;
  endpointPath?: string;
  apiVersion: FlixcheckApiVersionStatus;
  customValueVars?: string[];
  responseVars?: string[];
  hasResponseHandler?: boolean;
  hasErrorFallback?: boolean;
  hasHardcodedSecret?: boolean;
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
  sectionName?: string;
  eventName?: string;
  waitSeconds?: number;
  skillsetPriority?: number;
  isDisconnect?: boolean;
  rawLine: string;
  organizationName?: string;
  orgaCode?: string;
  brandName?: string;
  srcRouteNumber?: string;
  valueNumbers?: string[];
  isFaxRoute?: boolean;
  queueKind?: 'skillset' | 'network-skillset' | 'agent' | 'cdn';
  isExternalRouteCall?: boolean;
  intrinsicMetrics?: string[];
  hdxAction?: string;
  treatmentInfo?: string;
  loopSectionTarget?: string;
  externalIntegration?: ExternalApiIntegrationMeta;
}

export interface ScriptModule {
  scriptNumber: string;
  scriptName: string;
  cdnAlias?: string;
  entryDnisNumbers?: string[];
  entryOrganizationName?: string;
  isAnnouncementEndpoint?: boolean;
  isMaster: boolean;
  origin?: ScriptOrigin;
  visioPageName?: string;
  sourceFilename?: string;
  rawText: string;
  commentScheduleHint?: string;
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

export type MasterChecklistItemStatus = 'present' | 'missing' | 'external' | 'waypoint';

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
  matchedSourceFilename?: string;
  waypointReason?: string;
  isManualWaypoint?: boolean;
  triggeredNumbers?: string[];
  organizationNames?: string[];
  brandNames?: string[];
  isFaxRoute?: boolean;
}

export interface NodePositionOffset {
  dx: number;
  dy: number;
}

export type CallflowBuildingBlockType =
  | 'script'
  | 'announcement'
  | 'queue'
  | 'condition'
  | 'dtmf'
  | 'external';

export interface ScriptWorkspace {
  modules: ScriptModule[];
  missingTargets: string[];
  externalEndpoints?: string[];
  avayaWaypoints?: string[];
  ignoredChecklistTargets?: string[];
  resolvedIssues?: Record<string, ResolvedIssueRecord>;
  manualQuestions?: CallflowOpenIssue[];
  manualLinks?: ScriptManualLink[];
  issues?: CallflowOpenIssue[];
  openIssueCount?: number;
  masterScriptNumber?: string;
  masterChecklist?: MasterScriptChecklistItem[];
  nodeOffsets?: Record<string, NodePositionOffset>;
  treatUnresolvedAsEndpoint?: boolean;
  updatedAt: number;
}

export type CallflowViewLevel =
  | { level: 'welcome' }
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

export type CallflowHealthSeverity = 'error' | 'warning' | 'info';

export type CallflowHealthCategory =
  | 'cycle'
  | 'missing-script'
  | 'dead-end-rule'
  | 'dead-end-module'
  | 'orphan-module'
  | 'inactive-overflow'
  | 'missing-schedule-guard'
  | 'duplicate-prio'
  | 'external-api';

export interface CallflowHealthFinding {
  id: string;
  severity: CallflowHealthSeverity;
  category: CallflowHealthCategory;
  scriptNumber: string;
  scriptName: string;
  ruleId?: string;
  prio?: number;
  title: string;
  description: string;
  recommendation: string;
  cyclePath?: string[];
}

export interface CallflowResourceUsageRef {
  scriptNumber: string;
  scriptName: string;
  prio?: number;
  stepName?: string;
  context?: string;
}

export interface CallflowSkillsetRegistryItem {
  name: string;
  role: 'primary' | 'overflow' | 'rule';
  usages: CallflowResourceUsageRef[];
}

export interface CallflowAnnouncementRegistryItem {
  idOrName: string;
  usages: CallflowResourceUsageRef[];
}

export interface CallflowVariableRegistryItem {
  variableName: string;
  valuesByScript: Array<{
    scriptNumber: string;
    scriptName: string;
    value: string;
  }>;
}

export type CallflowParameterCategory =
  | 'overflow'
  | 'routing'
  | 'media'
  | 'schedule'
  | 'custom';

export interface CallflowScriptParameterItem {
  key: string;
  label: string;
  category: CallflowParameterCategory;
  value: string;
  rawValue: string;
  unit?: string;
  isDefaultOrDisabled?: boolean;
  note?: string;
}

export interface CallflowCrossRefRegistryItem {
  refKey: string;
  displayName: string;
  status: 'present' | 'missing' | 'external' | 'waypoint' | 'master';
  callers: string[];
  callees: string[];
  ruleCount: number;
}

export interface CallflowExternalApiRegistryItem {
  id: string;
  provider: 'flixcheck' | 'hdx';
  providerLabel: string;
  providerId?: string;
  isFlixcheck: boolean;
  action: FlixcheckActionKind;
  actionLabel: string;
  channel: FlixcheckChannelKind;
  channelLabel?: string;
  templateId?: string;
  endpointPath?: string;
  apiVersion: FlixcheckApiVersionStatus;
  hasWarning: boolean;
  warningSummary?: string;
  usages: CallflowResourceUsageRef[];
}

export interface CallflowResourceRegistry {
  skillsets: CallflowSkillsetRegistryItem[];
  announcements: CallflowAnnouncementRegistryItem[];
  variables: CallflowVariableRegistryItem[];
  crossRefs: CallflowCrossRefRegistryItem[];
  externalApis?: CallflowExternalApiRegistryItem[];
  specialParameters?: CallflowScriptParameterItem[];
  parametersByScript?: Record<string, CallflowScriptParameterItem[]>;
}

export interface CallflowRoutingMatrixRow {
  scriptNumber: string;
  scriptName: string;
  isMaster: boolean;
  prio: number;
  stepName: string;
  conditionAndSchedule: string;
  announcement: string;
  queueTarget: string;
  targetsAndChoices: string;
  targetStatus: string;
}

export interface CallflowScheduleSummaryRow {
  id: string;
  scriptNumber: string;
  scriptName: string;
  isMaster: boolean;
  prio?: number;
  ruleId?: string;
  stepName: string;
  openingHours: string;
  weekdays?: string;
  clockTimes?: string;
  scheduleSource?: string;
  holidayAndSpecial: string;
  closedOrOverflowAction: string;
  targetNumbers: string[];
  hasSchedule: boolean;
  hasHoliday: boolean;
}

export interface OfflineWorkspaceSeed {
  seedId: string;
  exportedAt: string;
  initialShellView?: 'builder' | 'studio';
  diagramTitle: string;
  code: string;
  themeConfig: ThemeConfiguration;
  smartColorMode: SmartColorMode;
  hiddenSmartNodeTypes?: SmartColorNodeType[];
  canvasSurface: 'dark' | 'light';
  workspaceMode: 'guided' | 'free';
  scriptWorkspace: ScriptWorkspace;
  savedDiagrams: SavedDiagram[];
}

export interface HtmlExportProgress {
  active: boolean;
  phase: 'preparing' | 'rendering' | 'packaging' | 'error';
  current: number;
  total: number;
  currentLabel: string;
  cacheHits: number;
  fallbackCount?: number;
  lastWarning?: string | null;
  errorMessage?: string | null;
  timeoutSecondsPerView?: number;
}


