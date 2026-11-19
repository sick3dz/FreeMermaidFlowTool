import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  Download,
  Edit3,
  Eye,
  FileImage,
  Filter,
  FolderPlus,
  FolderUp,
  GitBranch,
  Globe,
  Grid,
  Layers,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Moon,
  Move,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PhoneCall,
  Plus,
  RotateCcw,
  Scan,
  Search,
  Sun,
  Trash2,
  Unlink,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CallflowBuildingBlockType,
  CallflowDirectionFilter,
  CallflowGraph,
  CallflowHopDepth,
  CallflowIssueResolution,
  CallflowOpenIssue,
  CallflowViewLevel,
  DiagramDirection,
  DiagramTemplate,
  HtmlExportProgress,
  LogicAnalysisSummary,
  NodePositionOffset,
  PathColorMode,
  SavedDiagram,
  ScriptOrigin,
  ScriptWorkspace,
  SmartColorMode,
  SmartColorNodeType,
  ThemeConfiguration,
  ValidationState,
} from './types/mermaidStudio';
import {
  DEFAULT_THEME_CONFIG,
  MERMAID_TEMPLATES,
} from './data/mermaidTemplates';
import {
  computeFastCacheHash,
  exportSvgToPngBlob,
  getDiagramDirection,
  getSvgDimensions,
  injectInitDirectiveIntoCode,
  isColorDark,
  prepareStandaloneSvg,
  rasterizeSvgToGpuProxy,
  renderLocalMermaidDiagram,
  shouldUseNativeSvgLabels,
  SvgGpuProxyResult,
  triggerLocalDownload,
  updateDiagramDirection,
} from './utils/mermaidEngine';
import {
  applySmartLogicColoring,
  injectSmartColorsIntoCode,
} from './utils/smartColorEngine';
import {
  applyCallflowSpotlightToSvg,
  applyLiveNodeOffsetsToDom,
  applyLiveSpotlightToDom,
  applyNodeOffsetsToSvg,
  buildIsolatedPathMermaidCode,
  buildLiveSvgDomIndex,
  disconnectEdgeInMermaidCode,
  findNearestMagneticPort,
  generateInteractiveCallflowHtml,
  hitTestLiveSvgNodeAtClientPoint,
  InteractiveCallflowHtmlAnalysisPayload,
  InteractiveCallflowHtmlNodeDetail,
  InteractiveCallflowHtmlView,
  LiveSvgDomIndex,
  materializeActiveNodePortsInDom,
  parseCallflowGraph,
  PortSide,
  resolveClickedEdgeFromSvgElement,
  resolveClickedLockFromSvgElement,
  resolveClickedNodeIdFromSvgElement,
  SelectedCallflowEdge,
  setHoveredLockTargetsInDom,
  setMagneticSnapTargetInDom,
  shiftLiveConnectedEdgesForDrag,
  traceCallflowForNode,
  updateEdgeLabelInMermaidCode,
} from './utils/callflowEngine';
import {
  addBuildingBlockToWorkspace,
  analyzeWorkspaceLogicHealth,
  applyIssueResolutionToWorkspace,
  buildMasterOverviewMermaid,
  buildSafeFallbackMasterMermaid,
  buildScriptDetailMermaid,
  buildScriptWorkspace,
  buildWorkspaceRoutingMatrix,
  buildWorkspaceScheduleOverview,
  canonicalScriptMatchKey,
  connectNodesInWorkspace,
  createWorkspaceInspectContext,
  deleteNodeFromWorkspace,
  disconnectEdgeInWorkspace,
  EditableCallflowNodeSnapshot,
  EditableNodeConnectionItem,
  exportMigrationDocumentationMarkdown,
  exportOpeningHoursCsv,
  exportRoutingMatrixCsv,
  extractScriptNumberFromNodeId,
  extractWorkspaceResourceRegistry,
  formatScriptDisplayLabel,
  inspectWorkspaceNodeForEdit,
  looksLikeRawCallflowScript,
  mergeScriptModules,
  normalizeScriptRef,
  parseCallflowTextWithFallback,
  promoteEntryModuleToMain,
  rehydrateAndUpgradeWorkspace,
  reopenIssueInWorkspace,
  toMermaidNodeSuffix,
  unignoreChecklistTargetInWorkspace,
  updateEdgeLabelInWorkspace,
  updateWorkspaceNodeFromEdit,
} from './utils/scriptCallflowParser';
import {
  buildCallflowSimulationModel,
  buildWorkspaceGlobalSearchIndex,
  CallSimulationStep,
  GlobalSearchEntry,
} from './utils/callflowSimulator';
import {
  FolderAutoResolveSummary,
  FolderScriptFileEntry,
  FolderScriptPool,
  autoResolveConnectedScriptsFromFolder,
  extractFilesFromDataTransfer,
  importCallflowFile,
  indexScriptFolderFiles,
  isSupportedCallflowImportFilename,
} from './utils/callflowFileImporter';
import { ThemeConfigurator } from './components/ThemeConfigurator';
import { CallflowInspector } from './components/CallflowInspector';
import { SearchableScriptDropdown } from './components/SearchableScriptDropdown';
import { TemplateGalleryModal } from './components/TemplateGalleryModal';
import { ExportModal, PreferredInitialHtmlView } from './components/ExportModal';
import { MultiScriptModal } from './components/MultiScriptModal';
import { NewCallflowModal } from './components/NewCallflowModal';
import { NodeInlineEditorModal } from './components/NodeInlineEditorModal';
import { OpeningHoursModal } from './components/OpeningHoursModal';
import { GlobalSearchModal } from './components/GlobalSearchModal';
import { CallSimulatorHud } from './components/CallSimulatorHud';
import { CanvasMinimap } from './components/CanvasMinimap';
import { LocalHtmlBuilderLanding } from './components/LocalHtmlBuilderLanding';
import OnlineProjectLanding from './components/OnlineProjectLanding';
import {
  getInitialOfflineShellView,
  isRunningAsOfflineSingleFile,
  readStudioStorage,
  STUDIO_STORAGE_KEYS,
  writeStudioStorage,
} from './utils/offlineAppExporter';

const STORAGE_KEYS = STUDIO_STORAGE_KEYS;

const QUICK_SYNTAX_TOKENS: Array<{ label: string; token: string; hint: string }> = [
  { label: '-->', token: ' --> ', hint: 'Gerichteter Pfeil' },
  { label: '-.->', token: ' -.-> ', hint: 'Gestrichelter Pfeil' },
  { label: '<-->', token: ' <--> ', hint: 'Bidirektionaler Pfeil' },
  { label: '["Text"]', token: '["Knoten"]', hint: 'Rechteck-Knoten' },
  { label: '{"Frage?"}', token: '{"Entscheidung?"}', hint: 'Raute / Gateway' },
  { label: '[("DB")]', token: '[("Datenbank")]', hint: 'Datenbank-Zylinder' },
  { label: '@shape', token: '@{ shape: hex, label: "Service" }', hint: 'v11 Shape-Syntax' },
  {
    label: 'subgraph',
    token: '\n    subgraph Cluster["Systembereich"]\n        A --> B\n    end',
    hint: 'Subgraph-Block einfügen',
  },
];

const CLARITY_MODE_OPTIONS: Array<{
  id: SmartColorMode;
  shortLabel: string;
  hint: string;
}> = [
  {
    id: 'semantic',
    shortLabel: 'Rollen-Logik',
    hint: 'Färbt Knoten nach Funktion (Start/Client, Entscheidung, DB, Queue, Service, Fehler)',
  },
  {
    id: 'clusters',
    shortLabel: 'Ebenen-Fokus',
    hint: 'Färbt Subgraphs, Architektur-Zonen und Stufen in getrennten Farbzonen ein',
  },
  {
    id: 'high-contrast',
    shortLabel: 'Kontrast & Fluss',
    hint: 'Hoher Kontrast mit farblich hervorgehobenen Haupt- und Event-Pfaden',
  },
  {
    id: 'standard',
    shortLabel: 'Standard',
    hint: 'Einheitliche Standard-Farbgebung ohne automatische Logik-Differenzierung',
  },
];

const DRAG_THRESHOLD_PX = 7;
const MAX_CACHED_RENDERED_VIEWS = 300;

interface PreloadedViewCacheEntry {
  viewKey: string;
  mermaidCode: string;
  codeHash: string;
  styleSignature: string;
  rawSvg: string;
  coloredSvg: string;
  logicSummary: LogicAnalysisSummary;
  lastUsedAt: number;
}

interface WorkspacePreloadProgress {
  active: boolean;
  completed: number;
  total: number;
  currentLabel: string;
}

const SvgHtmlLayer = React.memo(
  ({ svgHtml }: { svgHtml: string }) => (
    <div
      className="mermaid-svg-layer"
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  ),
  (prev, next) => prev.svgHtml === next.svgHtml
);
SvgHtmlLayer.displayName = 'SvgHtmlLayer';

const MemoizedSvgStage = React.memo(
  React.forwardRef<HTMLDivElement, { svgHtml: string; gpuProxy: SvgGpuProxyResult | null }>(
    ({ svgHtml, gpuProxy }, ref) => (
      <div
        ref={ref}
        style={{ transformOrigin: 'center center' }}
        className="mermaid-canvas-stage shrink-0 p-4 sm:p-8"
      >
        <div className="mermaid-stage-frame relative inline-block">
          <SvgHtmlLayer svgHtml={svgHtml} />
          {gpuProxy && (
            <img
              src={gpuProxy.objectUrl}
              width={gpuProxy.width}
              height={gpuProxy.height}
              alt=""
              draggable={false}
              className="mermaid-gpu-proxy-layer"
              style={{
                width: `${gpuProxy.width}px`,
                height: `${gpuProxy.height}px`,
              }}
            />
          )}
        </div>
      </div>
    )
  ),
  (prev, next) =>
    prev.svgHtml === next.svgHtml &&
    (prev.gpuProxy?.objectUrl || '') === (next.gpuProxy?.objectUrl || '')
);
MemoizedSvgStage.displayName = 'MemoizedSvgStage';

function loadInitialScriptWorkspace(): ScriptWorkspace {
  try {
    const raw = readStudioStorage(STORAGE_KEYS.SCRIPT_WORKSPACE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.modules)) {
        const validManualQuestions = Array.isArray(parsed.manualQuestions)
          ? parsed.manualQuestions.filter(
              (mq: unknown) =>
                mq &&
                typeof mq === 'object' &&
                typeof (mq as CallflowOpenIssue).id === 'string' &&
                typeof (mq as CallflowOpenIssue).question === 'string'
            )
          : [];
        const baseWs = buildScriptWorkspace(parsed.modules, {
          ...parsed,
          manualQuestions: validManualQuestions,
        });
        return rehydrateAndUpgradeWorkspace(baseWs);
      }
    }
  } catch {
    // ignore corrupted local storage
  }
  return buildScriptWorkspace([]);
}

export default function App() {
  const isOfflineSingleFile = useMemo(() => isRunningAsOfflineSingleFile(), []);
  const initialShell = useMemo<'builder' | 'studio'>(
    () => (isOfflineSingleFile ? getInitialOfflineShellView() : 'builder'),
    [isOfflineSingleFile]
  );

  if (!isOfflineSingleFile) {
    return <OnlineProjectLanding />;
  }

  if (initialShell === 'builder') {
    return <LocalHtmlBuilderLanding />;
  }

  return <OfflineStudioApp />;
}

function OfflineStudioApp() {
  // Initial state starts empty (or restores user's own workspace from localStorage / offline seed)
  const [diagramTitle, setDiagramTitle] = useState<string>(() => {
    return readStudioStorage(STORAGE_KEYS.ACTIVE_TITLE) || 'Neuer Callflow';
  });

  // Two-Level Multi-Script Callflow Workspace (loaded first so initial code/view level are in sync)
  const [scriptWorkspace, setScriptWorkspace] = useState<ScriptWorkspace>(() =>
    loadInitialScriptWorkspace()
  );

  // Saved standalone code (deferred until user leaves welcome screen to avoid heavy startup render)
  const [code, setCode] = useState<string>(() => {
    if (scriptWorkspace.modules.length > 0) {
      return '';
    }
    return readStudioStorage(STORAGE_KEYS.ACTIVE_CODE) ?? '';
  });

  const [themeConfig, setThemeConfig] = useState<ThemeConfiguration>(() => {
    try {
      const raw = readStudioStorage(STORAGE_KEYS.ACTIVE_THEME);
      if (raw) {
        return { ...DEFAULT_THEME_CONFIG, ...JSON.parse(raw) };
      }
    } catch {
      // ignore corrupted local storage
    }
    return DEFAULT_THEME_CONFIG;
  });

  const [smartColorMode, setSmartColorMode] = useState<SmartColorMode>(() => {
    const saved = readStudioStorage(STORAGE_KEYS.SMART_COLOR_MODE);
    if (
      saved === 'semantic' ||
      saved === 'clusters' ||
      saved === 'high-contrast' ||
      saved === 'standard'
    ) {
      return saved;
    }
    return 'semantic';
  });

  const [pathColorMode, setPathColorMode] = useState<PathColorMode>(() => {
    const saved = readStudioStorage(STORAGE_KEYS.PATH_COLOR_MODE);
    return saved === 'branches' ? 'branches' : 'semantic';
  });

  const [hiddenSmartNodeTypes, setHiddenSmartNodeTypes] = useState<SmartColorNodeType[]>(() => {
    try {
      const raw = readStudioStorage(STORAGE_KEYS.HIDDEN_SMART_NODE_TYPES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const valid = new Set<SmartColorNodeType>([
            'announcement',
            'queue',
            'decision',
            'storage',
            'start-actor',
            'core-service',
            'error-alert',
          ]);
          return parsed.filter((item): item is SmartColorNodeType => valid.has(item));
        }
      }
    } catch {
      // ignore invalid storage payload
    }
    return [];
  });

  const [canvasSurface, setCanvasSurface] = useState<'dark' | 'light'>(() => {
    const saved = readStudioStorage(STORAGE_KEYS.CANVAS_SURFACE);
    return saved === 'light' ? 'light' : 'dark';
  });

  const [savedDiagrams, setSavedDiagrams] = useState<SavedDiagram[]>(() => {
    try {
      const raw = readStudioStorage(STORAGE_KEYS.SAVED_LIST);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return [];
  });

  // Callflow Interactive Path Tracing State
  const [selectedCallflowNodeId, setSelectedCallflowNodeId] = useState<string | null>(null);
  const [callflowDirectionFilter, setCallflowDirectionFilter] =
    useState<CallflowDirectionFilter>('both');
  const [callflowHopDepth, setCallflowHopDepth] = useState<CallflowHopDepth>('all');
  const [isolateSubgraphMode, setIsolateSubgraphMode] = useState<boolean>(false);
  const [callflowViewLevel, setCallflowViewLevel] = useState<CallflowViewLevel>(() =>
    scriptWorkspace.modules.length > 0 || code.trim().length > 0
      ? { level: 'welcome' }
      : { level: 'master' }
  );
  const [masterDensityMode, setMasterDensityMode] = useState<'auto' | 'compact' | 'detailed'>(
    'auto'
  );
  const isMasterCompact =
    masterDensityMode === 'compact' ||
    (masterDensityMode === 'auto' && scriptWorkspace.modules.length >= 16);
  const [checklistFocusTrigger, setChecklistFocusTrigger] = useState<{
    refKey: string;
    nonce: number;
  } | null>(null);
  const [isNewCallflowModalOpen, setIsNewCallflowModalOpen] = useState<boolean>(false);
  const [isMultiScriptModalOpen, setIsMultiScriptModalOpen] = useState<boolean>(false);
  const [isOpeningHoursModalOpen, setIsOpeningHoursModalOpen] = useState<boolean>(false);
  const [openingHoursInitialSearch, setOpeningHoursInitialSearch] = useState<string>('');
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState<boolean>(false);
  const [isCallSimulatorOpen, setIsCallSimulatorOpen] = useState<boolean>(false);
  const [showMinimap, setShowMinimap] = useState<boolean>(false);
  const pendingNodeFocusHintRef = useRef<{
    nodeId?: string;
    fallbackNodeId?: string;
    labelHint?: string;
  } | null>(null);
  const [multiScriptPrefillNumber, setMultiScriptPrefillNumber] = useState<string | null>(null);
  const [isDraggingCanvasFile, setIsDraggingCanvasFile] = useState<boolean>(false);
  const [canvasFileDropNotice, setCanvasFileDropNotice] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const canvasFileDragDepthRef = useRef<number>(0);
  const canvasFileNoticeTimerRef = useRef<number | null>(null);
  const [rawScriptDraft, setRawScriptDraft] = useState<{
    rawText: string;
    moduleCount: number;
    ruleCount: number;
  } | null>(null);
  const skipAutoConvertRef = useRef<boolean>(false);
  const [assignedFolderPool, setAssignedFolderPool] = useState<FolderScriptPool | null>(null);
  const [lastFolderResolveSummary, setLastFolderResolveSummary] =
    useState<FolderAutoResolveSummary | null>(null);
  const [isAutoResolvingFolder, setIsAutoResolvingFolder] = useState<boolean>(false);
  const [isConfirmingClearWorkspace, setIsConfirmingClearWorkspace] = useState<boolean>(false);

  // Workspace Mode: 'guided' (default, clutter-free 3-step assistant starting with Main) vs 'free' (full Mermaid Studio)
  const [workspaceMode, setWorkspaceMode] = useState<'guided' | 'free'>(() => {
    const saved = readStudioStorage(STORAGE_KEYS.WORKSPACE_MODE);
    return saved === 'free' ? 'free' : 'guided';
  });
  const [guidedStep, setGuidedStep] = useState<1 | 2 | 3>(() =>
    scriptWorkspace.modules.length === 0 ? 1 : 2
  );

  // Right Inspector Panel Mode ('callflow' | 'theme')
  const [rightSidebarTab, setRightSidebarTab] = useState<'callflow' | 'theme'>('callflow');

  // Rendering & Validation states
  const [baseRenderedSvg, setBaseRenderedSvg] = useState<string | null>(null);
  const [masterRenderError, setMasterRenderError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationState>({
    isValid: true,
    diagramType: 'Flowchart / Callflow v11',
    errorMessage: null,
    errorLine: null,
    lastRenderMs: 0,
  });

  // Responsive & Desktop Workspace Layout states
  const [mobileActivePane, setMobileActivePane] = useState<
    'editor' | 'preview' | 'callflow' | 'theme'
  >('preview');
  const [splitRatio, setSplitRatio] = useState<number>(38);
  const [isResizingSplit, setIsResizingSplit] = useState<boolean>(false);
  const [isDesktopEditorCollapsed, setIsDesktopEditorCollapsed] = useState<boolean>(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const [isFullscreenPreview, setIsFullscreenPreview] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const lastTouchTimeRef = useRef<number>(0);

  // Pan & Zoom state (Mouse + Multi-Touch)
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragDistanceRef = useRef<number>(0);
  const touchGestureRef = useRef<{
    mode: 'none' | 'pan' | 'pinch';
    startX: number;
    startY: number;
    initialPinchDistance: number;
    initialZoom: number;
  }>({
    mode: 'none',
    startX: 0,
    startY: 0,
    initialPinchDistance: 0,
    initialZoom: 1,
  });

  // Modals state
  const [libraryModal, setLibraryModal] = useState<{
    isOpen: boolean;
    tab: 'templates' | 'snippets' | 'saved' | 'help';
  }>({ isOpen: false, tab: 'templates' });
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);

  // PC Visual Drag-and-Drop Callflow Editor State (enabled automatically when a Callflow workspace is loaded)
  const [isVisualEditMode, setIsVisualEditMode] = useState<boolean>(
    () => scriptWorkspace.modules.length > 0
  );
  const pendingAutoFitRef = useRef<boolean>(scriptWorkspace.modules.length > 0);
  const [visualEditTool, setVisualEditTool] = useState<'move' | 'connect'>('move');
  // Continuous dragging by default (stufenlos), optional 16px raster toggle in toolbar
  const [snapToGrid, setSnapToGrid] = useState<boolean>(false);
  const [standaloneNodeOffsets, setStandaloneNodeOffsets] = useState<
    Record<string, NodePositionOffset>
  >({});
  const [editingNodeSnapshot, setEditingNodeSnapshot] =
    useState<EditableCallflowNodeSnapshot | null>(null);
  const [activeWirePreview, setActiveWirePreview] = useState<{
    fromNodeId: string;
    fromLabel: string;
    startX: number;
    startY: number;
    curX: number;
    curY: number;
    hoverTargetNodeId: string | null;
    snappedPortSide?: PortSide | null;
  } | null>(null);
  const [recentConnectionBanner, setRecentConnectionBanner] = useState<{
    fromNodeId: string;
    toNodeId: string;
    fromLabel: string;
    toLabel: string;
    labelDraft: string;
  } | null>(null);
  const [selectedCallflowEdge, setSelectedCallflowEdge] = useState<
    (SelectedCallflowEdge & { labelDraft: string }) | null
  >(null);
  const snappedPortRef = useRef<{ nodeId: string; side: PortSide } | null>(null);
  const lastHoverLockKeyRef = useRef<string>('');
  const nodeDragRef = useRef<{
    active: boolean;
    mode: 'move-node' | 'connect-wire';
    nodeId: string;
    startClientX: number;
    startClientY: number;
    origDx: number;
    origDy: number;
    currentDx: number;
    currentDy: number;
    baseTransformX: number;
    baseTransformY: number;
    baseTransformRest: string;
    domNodeGroup: SVGGElement | null;
    movedPixels: number;
    wireStartX: number;
    wireStartY: number;
  }>({
    active: false,
    mode: 'move-node',
    nodeId: '',
    startClientX: 0,
    startClientY: 0,
    origDx: 0,
    origDy: 0,
    currentDx: 0,
    currentDy: 0,
    baseTransformX: 0,
    baseTransformY: 0,
    baseTransformRest: '',
    domNodeGroup: null,
    movedPixels: 0,
    wireStartX: 0,
    wireStartY: 0,
  });

  // Quick feedback states
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [quickDownloadFeedback, setQuickDownloadFeedback] = useState<
    'svg' | 'png' | 'html' | null
  >(null);
  const [isDownloadingPng, setIsDownloadingPng] = useState<boolean>(false);
  const [isDownloadingHtml, setIsDownloadingHtml] = useState<boolean>(false);
  const [htmlExportProgress, setHtmlExportProgress] = useState<HtmlExportProgress | null>(null);
  const [htmlExportNotice, setHtmlExportNotice] = useState<string | null>(null);
  const [preloadProgress, setPreloadProgress] = useState<WorkspacePreloadProgress | null>(null);
  const [gpuProxy, setGpuProxy] = useState<SvgGpuProxyResult | null>(null);

  // Refs
  const exportAbortControllerRef = useRef<AbortController | null>(null);
  const preloadAbortControllerRef = useRef<AbortController | null>(null);
  const preloadedViewsRef = useRef<Map<string, PreloadedViewCacheEntry>>(new Map());
  const activeViewKeyRef = useRef<string>('master');
  const gpuProxyRef = useRef<SvgGpuProxyResult | null>(null);
  const hasInteractiveOverlayStateRef = useRef<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const stageElRef = useRef<HTMLDivElement | null>(null);
  const liveSvgIndexRef = useRef<LiveSvgDomIndex | null>(null);
  const wireLineRef = useRef<SVGLineElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<{ zoom: number; panX: number; panY: number }>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const cameraRafRef = useRef<number | null>(null);
  const wheelSyncTimerRef = useRef<number | null>(null);
  const dragMoveRafRef = useRef<number | null>(null);
  const hoverRafRef = useRef<number | null>(null);
  const hoverPendingTargetRef = useRef<Element | null>(null);
  const isPanningRef = useRef<boolean>(false);
  const isTransformingRef = useRef<boolean>(false);
  const panMouseStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const activeNodeOffsetsRef = useRef<Record<string, NodePositionOffset>>({});

  // Debounced persistence for lightweight UI preferences (independent from heavy scriptWorkspace JSON)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeStudioStorage(STORAGE_KEYS.ACTIVE_CODE, code);
      writeStudioStorage(STORAGE_KEYS.ACTIVE_TITLE, diagramTitle);
      writeStudioStorage(STORAGE_KEYS.ACTIVE_THEME, JSON.stringify(themeConfig));
      writeStudioStorage(STORAGE_KEYS.SMART_COLOR_MODE, smartColorMode);
      writeStudioStorage(STORAGE_KEYS.PATH_COLOR_MODE, pathColorMode);
      writeStudioStorage(
        STORAGE_KEYS.HIDDEN_SMART_NODE_TYPES,
        JSON.stringify(hiddenSmartNodeTypes)
      );
      writeStudioStorage(STORAGE_KEYS.CANVAS_SURFACE, canvasSurface);
      writeStudioStorage(STORAGE_KEYS.WORKSPACE_MODE, workspaceMode);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    code,
    diagramTitle,
    themeConfig,
    smartColorMode,
    pathColorMode,
    hiddenSmartNodeTypes,
    canvasSurface,
    workspaceMode,
  ]);

  // Idle-scheduled persistence for full ScriptWorkspace so node dragging & UI toggles stay 60fps
  useEffect(() => {
    let idleHandle: number | null = null;
    let usedIdleCallback = false;
    const timer = window.setTimeout(() => {
      const persist = () => {
        writeStudioStorage(STORAGE_KEYS.SCRIPT_WORKSPACE, JSON.stringify(scriptWorkspace));
      };
      const win = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      };
      if (typeof win.requestIdleCallback === 'function') {
        usedIdleCallback = true;
        idleHandle = win.requestIdleCallback(persist, { timeout: 600 });
      } else {
        persist();
      }
    }, 600);
    return () => {
      window.clearTimeout(timer);
      if (idleHandle !== null && usedIdleCallback) {
        const win = window as Window & { cancelIdleCallback?: (id: number) => void };
        win.cancelIdleCallback?.(idleHandle);
      }
    };
  }, [scriptWorkspace]);

  const handleChangeWorkspaceMode = useCallback((nextMode: 'guided' | 'free') => {
    setWorkspaceMode(nextMode);
    if (nextMode === 'guided') {
      setIsRightPanelOpen(true);
      setRightSidebarTab('callflow');
      setMobileActivePane((prev) => (prev === 'editor' || prev === 'theme' ? 'callflow' : prev));
    } else {
      setIsDesktopEditorCollapsed(false);
    }
  }, []);

  // Parse local Callflow Graph from code
  const callflowGraph = useMemo(() => parseCallflowGraph(code), [code]);
  const isRawScriptInEditor = useMemo(() => looksLikeRawCallflowScript(code), [code]);

  // Compute Upstream/Downstream Trace Result for the selected node
  const callflowTrace = useMemo(() => {
    if (!selectedCallflowNodeId) return null;
    if (!callflowGraph.nodes.has(selectedCallflowNodeId)) return null;
    return traceCallflowForNode(callflowGraph, selectedCallflowNodeId);
  }, [callflowGraph, selectedCallflowNodeId]);

  const selectedNodeScriptTarget = useMemo(() => {
    if (!callflowTrace || scriptWorkspace.modules.length === 0) return null;
    const num = extractScriptNumberFromNodeId(
      callflowTrace.selectedNode.id,
      scriptWorkspace.modules
    );
    if (!num) return null;
    const targetKey = canonicalScriptMatchKey(num);
    const mod = scriptWorkspace.modules.find(
      (m) => canonicalScriptMatchKey(m.scriptNumber) === targetKey
    );
    if (!mod) return null;
    if (
      callflowViewLevel.level === 'detail' &&
      canonicalScriptMatchKey(callflowViewLevel.scriptNumber) === targetKey
    ) {
      return null;
    }
    return mod;
  }, [callflowTrace, scriptWorkspace.modules, callflowViewLevel]);

  // Reset selectedCallflowNodeId / selectedCallflowEdge if code changes and item no longer exists
  useEffect(() => {
    if (selectedCallflowNodeId && !callflowGraph.nodes.has(selectedCallflowNodeId)) {
      setSelectedCallflowNodeId(null);
      setIsolateSubgraphMode(false);
    }
    if (
      selectedCallflowEdge &&
      !callflowGraph.edges.some(
        (ed) => ed.from === selectedCallflowEdge.from && ed.to === selectedCallflowEdge.to
      )
    ) {
      setSelectedCallflowEdge(null);
    }
  }, [callflowGraph, selectedCallflowNodeId, selectedCallflowEdge]);

  // Determine effective Mermaid code to render (either full code or isolated sub-callflow)
  const currentDirection = useMemo(() => getDiagramDirection(code), [code]);

  const effectiveMermaidCode = useMemo(() => {
    if (callflowViewLevel.level === 'welcome') {
      return '';
    }
    if (isolateSubgraphMode && callflowTrace) {
      return buildIsolatedPathMermaidCode(
        callflowTrace,
        callflowGraph,
        currentDirection || 'LR',
        callflowDirectionFilter,
        callflowHopDepth
      );
    }
    return code;
  }, [
    callflowViewLevel.level,
    code,
    isolateSubgraphMode,
    callflowTrace,
    callflowGraph,
    currentDirection,
    callflowDirectionFilter,
    callflowHopDepth,
  ]);

  const hasBaseRenderedSvgRef = useRef<boolean>(false);
  const scriptWorkspaceFallbackRef = useRef<ScriptWorkspace>(scriptWorkspace);
  scriptWorkspaceFallbackRef.current = scriptWorkspace;

  const currentBaseStyleSignature = useMemo(
    () =>
      JSON.stringify({
        themeConfig,
        smartColorMode,
        pathColorMode,
        hiddenSmartNodeTypes,
        canvasSurface,
        direction: currentDirection || 'LR',
      }),
    [
      themeConfig,
      smartColorMode,
      pathColorMode,
      hiddenSmartNodeTypes,
      canvasSurface,
      currentDirection,
    ]
  );

  const currentStyleSignature = useMemo(
    () =>
      JSON.stringify({
        base: currentBaseStyleSignature,
        isolateSubgraphMode,
      }),
    [currentBaseStyleSignature, isolateSubgraphMode]
  );

  const workspaceModulesPreloadKey = useMemo(() => {
    if (scriptWorkspace.modules.length === 0) return '';
    const entry = scriptWorkspace.masterScriptNumber || '';
    const dir = currentDirection || 'LR';
    const moduleFingerprint = scriptWorkspace.modules
      .map(
        (m) =>
          `${m.scriptNumber}:${m.isMaster ? '1' : '0'}:${m.rules.length}:${computeFastCacheHash(
            m.rawText || ''
          )}:${m.scriptName || ''}`
      )
      .join('|');
    const linksSig = (scriptWorkspace.manualLinks || [])
      .map((l) => `${l.fromScriptNumber}->${l.toTargetNumber}:${l.label || ''}`)
      .join(',');
    const extSig = (scriptWorkspace.externalEndpoints || []).join(',');
    return `${dir}::${isMasterCompact ? 'compact' : 'full'}::${entry}::${computeFastCacheHash(
      `${moduleFingerprint}||${linksSig}||${extSig}`
    )}`;
  }, [
    scriptWorkspace.modules,
    scriptWorkspace.masterScriptNumber,
    scriptWorkspace.manualLinks,
    scriptWorkspace.externalEndpoints,
    currentDirection,
    isMasterCompact,
  ]);

  const activeWorkspaceViewKey = useMemo(() => {
    if (scriptWorkspace.modules.length === 0) return 'standalone';
    return callflowViewLevel.level === 'detail'
      ? `script:${callflowViewLevel.scriptNumber}`
      : 'master';
  }, [scriptWorkspace.modules.length, callflowViewLevel]);

  activeViewKeyRef.current = activeWorkspaceViewKey;

  // Clear on-demand view cache on unmount
  useEffect(() => {
    const viewsMap = preloadedViewsRef.current;
    return () => {
      viewsMap.clear();
    };
  }, []);

  // Debounced Local Mermaid v11 Parsing & Base SVG Rendering (0ms when hitting Preload Cache!)
  useEffect(() => {
    let isCancelled = false;
    const trimmed = effectiveMermaidCode.trim();
    if (!trimmed) {
      hasBaseRenderedSvgRef.current = false;
      setMasterRenderError(null);
      setBaseRenderedSvg(null);
      setValidation({
        isValid: true,
        diagramType: 'Leer',
        errorMessage: null,
        errorLine: null,
        lastRenderMs: 0,
      });
      return;
    }

    // While upfront pre-rendering is active, let the preloader populate the cache cleanly
    // without competing canvas repaints in the background.
    if (preloadProgress?.active) {
      return;
    }

    const cachedHit = preloadedViewsRef.current.get(activeWorkspaceViewKey);
    if (
      cachedHit &&
      cachedHit.mermaidCode.trim() === trimmed &&
      cachedHit.styleSignature === currentStyleSignature
    ) {
      cachedHit.lastUsedAt = Date.now();
      hasBaseRenderedSvgRef.current = true;
      setMasterRenderError(null);
      setValidation((prev) => ({
        ...prev,
        isValid: true,
        errorMessage: null,
        errorLine: null,
      }));
      setBaseRenderedSvg(cachedHit.rawSvg);
      return;
    }

    const delayMs = !hasBaseRenderedSvgRef.current ? 0 : 120;
    const timer = window.setTimeout(async () => {
      const useNativeSvgLabels = shouldUseNativeSvgLabels(effectiveMermaidCode);
      const result = await renderLocalMermaidDiagram(
        effectiveMermaidCode,
        themeConfig,
        useNativeSvgLabels
      );
      if (isCancelled) return;
      if (result.svg !== null) {
        hasBaseRenderedSvgRef.current = true;
        setValidation(result.validation);
        setMasterRenderError(null);
        setBaseRenderedSvg(result.svg);
      } else if (
        scriptWorkspaceFallbackRef.current.modules.length > 0 &&
        callflowViewLevel.level === 'master' &&
        !isolateSubgraphMode
      ) {
        // Fallback to guaranteed-valid simplified Master overview if production script syntax edge case occurs
        const fallbackCode = buildSafeFallbackMasterMermaid(
          scriptWorkspaceFallbackRef.current,
          currentDirection || 'LR'
        );
        const fallbackResult = await renderLocalMermaidDiagram(
          fallbackCode,
          themeConfig,
          shouldUseNativeSvgLabels(fallbackCode)
        );
        if (isCancelled) return;
        if (fallbackResult.svg !== null) {
          hasBaseRenderedSvgRef.current = true;
          setValidation(fallbackResult.validation);
          setMasterRenderError(null);
          setBaseRenderedSvg(fallbackResult.svg);
        } else {
          setValidation(result.validation);
          setMasterRenderError(
            result.validation.errorMessage || 'Das Master-Diagramm konnte nicht gerendert werden.'
          );
        }
      } else {
        setValidation(result.validation);
        setMasterRenderError(
          result.validation.errorMessage || 'Das Diagramm konnte nicht gerendert werden.'
        );
      }
    }, delayMs);

    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    effectiveMermaidCode,
    themeConfig,
    scriptWorkspace.modules.length,
    callflowViewLevel.level,
    isolateSubgraphMode,
    currentDirection,
    activeWorkspaceViewKey,
    currentStyleSignature,
    preloadProgress?.active,
  ]);

  const activeNodeOffsets = useMemo<Record<string, NodePositionOffset>>(
    () =>
      scriptWorkspace.modules.length > 0
        ? scriptWorkspace.nodeOffsets || {}
        : standaloneNodeOffsets,
    [scriptWorkspace.modules.length, scriptWorkspace.nodeOffsets, standaloneNodeOffsets]
  );

  const hasCustomNodeOffsets = useMemo(
    () =>
      Object.values(activeNodeOffsets).some(
        (off) => off && (Math.abs(off.dx) > 0.5 || Math.abs(off.dy) > 0.5)
      ),
    [activeNodeOffsets]
  );

  activeNodeOffsetsRef.current = activeNodeOffsets;

  // Base Smart Logic Coloring (uses 0ms Preload Cache when available!)
  const { baseColoredSvg, logicSummary } = useMemo<{
    baseColoredSvg: string | null;
    logicSummary: LogicAnalysisSummary;
  }>(() => {
    if (!baseRenderedSvg) {
      return {
        baseColoredSvg: null,
        logicSummary: {
          activeMode: smartColorMode,
          recommendedMode: 'semantic',
          recommendationReason:
            'Erkennt Knoten-Rollen (Services, Datenbanken, Entscheidungen, Clients)',
          legend: [],
          nodeCount: 0,
          clusterCount: 0,
          asyncEdgeCount: 0,
        },
      };
    }

    const cachedHit = preloadedViewsRef.current.get(activeWorkspaceViewKey);
    if (
      cachedHit &&
      cachedHit.rawSvg === baseRenderedSvg &&
      cachedHit.mermaidCode.trim() === effectiveMermaidCode.trim() &&
      cachedHit.styleSignature === currentStyleSignature
    ) {
      return {
        baseColoredSvg: cachedHit.coloredSvg,
        logicSummary: cachedHit.logicSummary,
      };
    }

    const processed = applySmartLogicColoring(
      baseRenderedSvg,
      effectiveMermaidCode,
      smartColorMode,
      canvasSurface,
      themeConfig.lineColor,
      hiddenSmartNodeTypes,
      pathColorMode
    );

    return {
      baseColoredSvg: processed.svg,
      logicSummary: processed.summary,
    };
  }, [
    baseRenderedSvg,
    effectiveMermaidCode,
    smartColorMode,
    pathColorMode,
    hiddenSmartNodeTypes,
    canvasSurface,
    themeConfig.lineColor,
    activeWorkspaceViewKey,
    currentStyleSignature,
  ]);

  // On-demand cache maintenance (prunes stale entries without upfront rendering of unopened views)
  useEffect(() => {
    const cache = preloadedViewsRef.current;
    preloadAbortControllerRef.current?.abort();
    preloadAbortControllerRef.current = null;
    setPreloadProgress(null);
    if (scriptWorkspace.modules.length === 0) {
      cache.clear();
      return;
    }

    const validKeys = new Set<string>([
      'master',
      'standalone',
      ...scriptWorkspace.modules.map((m) => `script:${m.scriptNumber}`),
    ]);
    for (const k of cache.keys()) {
      if (!validKeys.has(k)) {
        cache.delete(k);
      }
    }
    return;
  }, [
    workspaceModulesPreloadKey,
    currentBaseStyleSignature,
    scriptWorkspace.modules,
  ]);

  useEffect(() => {
    if (!baseRenderedSvg || !baseColoredSvg || isolateSubgraphMode) return;
    const trimmed = effectiveMermaidCode.trim();
    if (!trimmed) return;
    const cache = preloadedViewsRef.current;
    cache.set(activeWorkspaceViewKey, {
      viewKey: activeWorkspaceViewKey,
      mermaidCode: effectiveMermaidCode,
      codeHash: computeFastCacheHash(trimmed),
      styleSignature: currentStyleSignature,
      rawSvg: baseRenderedSvg,
      coloredSvg: baseColoredSvg,
      logicSummary,
      lastUsedAt: Date.now(),
    });
    const maxCapacity = Math.max(
      MAX_CACHED_RENDERED_VIEWS,
      scriptWorkspace.modules.length + 20
    );
    if (cache.size > maxCapacity) {
      const oldest = Array.from(cache.entries())
        .filter(([k]) => k !== activeWorkspaceViewKey && k !== 'master')
        .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
      while (cache.size > maxCapacity && oldest.length > 0) {
        const victim = oldest.shift();
        if (victim) cache.delete(victim[0]);
      }
    }
  }, [
    baseRenderedSvg,
    baseColoredSvg,
    logicSummary,
    effectiveMermaidCode,
    activeWorkspaceViewKey,
    currentStyleSignature,
    isolateSubgraphMode,
    scriptWorkspace.modules.length,
  ]);

  // Alias for canvas presence checks & intrinsic dimensions (without re-serializing on drag/select)
  const coloredSvg = baseColoredSvg;

  const isLargeCanvasDiagram = useMemo(() => {
    if (!coloredSvg) return false;
    if (callflowGraph.nodes.size >= 30 || callflowGraph.edges.length >= 50) return true;
    const dims = getSvgDimensions(coloredSvg);
    return Math.max(dims.width, dims.height) > 2200 || dims.width * dims.height > 2_200_000;
  }, [coloredSvg, callflowGraph.nodes.size, callflowGraph.edges.length]);

  const isLargeCanvasDiagramRef = useRef<boolean>(false);
  isLargeCanvasDiagramRef.current = isLargeCanvasDiagram;
  gpuProxyRef.current = gpuProxy;
  hasInteractiveOverlayStateRef.current = Boolean(
    callflowTrace || selectedCallflowNodeId || selectedCallflowEdge
  );

  // GPU-Safe Hybrid Proxy Rasterizer for large Master & multi-script diagrams (<= 4096px GPU texture) and Minimap thumbnail
  useEffect(() => {
    if (!coloredSvg || (!isLargeCanvasDiagram && !showMinimap) || preloadProgress?.active) {
      setGpuProxy((prev) => {
        if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        return null;
      });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const svgForProxy = hasCustomNodeOffsets
        ? applyNodeOffsetsToSvg(coloredSvg, activeNodeOffsets, callflowGraph, false)
        : coloredSvg;
      void rasterizeSvgToGpuProxy(
        svgForProxy,
        {
          code: effectiveMermaidCode,
          themeConfig,
          smartColorMode,
          hiddenNodeTypes: hiddenSmartNodeTypes,
          canvasSurface,
          pathColorMode,
        },
        controller.signal
      ).then((result) => {
        if (cancelled || controller.signal.aborted) {
          if (result?.objectUrl) URL.revokeObjectURL(result.objectUrl);
          return;
        }
        setGpuProxy((prev) => {
          if (prev?.objectUrl && prev.objectUrl !== result?.objectUrl) {
            URL.revokeObjectURL(prev.objectUrl);
          }
          return result;
        });
      });
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    coloredSvg,
    isLargeCanvasDiagram,
    showMinimap,
    preloadProgress?.active,
    hasCustomNodeOffsets,
    activeNodeOffsets,
    callflowGraph,
    effectiveMermaidCode,
    themeConfig,
    smartColorMode,
    hiddenSmartNodeTypes,
    canvasSurface,
    pathColorMode,
  ]);

  useEffect(() => {
    return () => {
      if (gpuProxyRef.current?.objectUrl) {
        URL.revokeObjectURL(gpuProxyRef.current.objectUrl);
      }
    };
  }, []);

  // Build full export SVG string only on-demand (Export buttons & Modal), keeping interactive PC frame rate at 60fps
  const buildExportSvgSnapshot = useCallback(
    (includeSpotlight: boolean): string | null => {
      if (!baseColoredSvg) return null;
      const withSpotlight =
        includeSpotlight && callflowTrace && !isolateSubgraphMode
          ? applyCallflowSpotlightToSvg(
              baseColoredSvg,
              callflowTrace,
              canvasSurface,
              callflowGraph,
              callflowDirectionFilter,
              callflowHopDepth
            )
          : baseColoredSvg;
      return applyNodeOffsetsToSvg(withSpotlight, activeNodeOffsets, callflowGraph, false);
    },
    [
      baseColoredSvg,
      callflowTrace,
      isolateSubgraphMode,
      canvasSurface,
      callflowGraph,
      callflowDirectionFilter,
      callflowHopDepth,
      activeNodeOffsets,
    ]
  );

  // Mount-once SVG DOM indexer: enables <2ms in-place Spotlight & 60fps Live Edge Dragging
  useLayoutEffect(() => {
    const stageEl = stageElRef.current;
    if (!baseColoredSvg || !stageEl || preloadProgress?.active) {
      liveSvgIndexRef.current = null;
      return;
    }
    const svgEl = stageEl.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) {
      liveSvgIndexRef.current = null;
      return;
    }
    const index = buildLiveSvgDomIndex(svgEl, callflowGraph);
    liveSvgIndexRef.current = index;
    stageEl.style.transform = `translate3d(${cameraRef.current.panX}px, ${cameraRef.current.panY}px, 0) scale(${cameraRef.current.zoom})`;

    // Apply active spotlight, selected padlock visibility & offsets immediately before paint
    applyLiveSpotlightToDom(
      index,
      callflowTrace && !isolateSubgraphMode ? callflowTrace : null,
      canvasSurface,
      callflowDirectionFilter,
      callflowHopDepth,
      selectedCallflowEdge
    );
    setHoveredLockTargetsInDom(index, null, null, selectedCallflowEdge);
    applyLiveNodeOffsetsToDom(index, activeNodeOffsets, isVisualEditMode);
    if (selectedCallflowNodeId && isVisualEditMode) {
      materializeActiveNodePortsInDom(index, selectedCallflowNodeId, true);
    }
  }, [baseColoredSvg, callflowGraph, preloadProgress?.active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fast-path: update Spotlight & selected edge padlock visibility in-place (zero SVG rebuild)
  useLayoutEffect(() => {
    const index = liveSvgIndexRef.current;
    if (!index) return;
    applyLiveSpotlightToDom(
      index,
      callflowTrace && !isolateSubgraphMode ? callflowTrace : null,
      canvasSurface,
      callflowDirectionFilter,
      callflowHopDepth,
      selectedCallflowEdge
    );
    setHoveredLockTargetsInDom(index, null, null, selectedCallflowEdge);
  }, [
    callflowTrace,
    isolateSubgraphMode,
    canvasSurface,
    callflowDirectionFilter,
    callflowHopDepth,
    selectedCallflowEdge,
  ]);

  // Fast-path: update Node Offsets & lazily materialize active selected node ports (zero SVG rebuild)
  useLayoutEffect(() => {
    const index = liveSvgIndexRef.current;
    if (!index) return;
    applyLiveNodeOffsetsToDom(index, activeNodeOffsets, isVisualEditMode);
    if (selectedCallflowNodeId && isVisualEditMode) {
      materializeActiveNodePortsInDom(index, selectedCallflowNodeId, true);
    }
  }, [activeNodeOffsets, isVisualEditMode, selectedCallflowNodeId]);

  // Global Escape & Delete/Backspace shortcut handler
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (nodeDragRef.current.active && nodeDragRef.current.mode === 'connect-wire') {
          nodeDragRef.current.active = false;
          snappedPortRef.current = null;
          if (liveSvgIndexRef.current) {
            setMagneticSnapTargetInDom(liveSvgIndexRef.current, null, false);
          }
          setActiveWirePreview(null);
          return;
        }
        if (editingNodeSnapshot) {
          setEditingNodeSnapshot(null);
          return;
        }
        if (selectedCallflowEdge) {
          setSelectedCallflowEdge(null);
          return;
        }
        if (selectedCallflowNodeId || isolateSubgraphMode) {
          setSelectedCallflowNodeId(null);
          setIsolateSubgraphMode(false);
        }
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCallflowEdge) {
        const activeEl = document.activeElement as HTMLElement | null;
        const tag = activeEl?.tagName?.toUpperCase() || '';
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          activeEl?.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        if (scriptWorkspace.modules.length > 0) {
          const nextWs = disconnectEdgeInWorkspace(
            scriptWorkspace,
            callflowViewLevel,
            selectedCallflowEdge.from,
            selectedCallflowEdge.to
          );
          setScriptWorkspace(nextWs);
          if (callflowViewLevel.level === 'detail') {
            setCode(
              buildScriptDetailMermaid(
                nextWs,
                callflowViewLevel.scriptNumber,
                currentDirection || 'LR'
              )
            );
          } else {
            setCode(
              buildMasterOverviewMermaid(nextWs, currentDirection || 'LR', {
                compact: isMasterCompact,
              })
            );
          }
        } else {
          skipAutoConvertRef.current = true;
          setCode((prev) =>
            disconnectEdgeInMermaidCode(
              prev,
              selectedCallflowEdge.from,
              selectedCallflowEdge.to
            )
          );
        }
        setSelectedCallflowEdge(null);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    editingNodeSnapshot,
    selectedCallflowNodeId,
    isolateSubgraphMode,
    selectedCallflowEdge,
    scriptWorkspace,
    callflowViewLevel,
    currentDirection,
    isMasterCompact,
  ]);

  // Keep diagram line/theme contrast synced when toggling Dark/Light canvas surface
  const handleChangeCanvasSurface = useCallback((nextSurface: 'dark' | 'light') => {
    setCanvasSurface(nextSurface);
    setThemeConfig((prev) => {
      if (nextSurface === 'dark') {
        if (!prev.useCustomColors) {
          return prev.theme === 'dark' ? prev : { ...prev, theme: 'dark' };
        }
        const needsLineFix = isColorDark(prev.lineColor);
        const needsBgFix = !isColorDark(prev.background) || !isColorDark(prev.primaryColor);
        if (!needsLineFix && !needsBgFix) return prev;
        return {
          ...prev,
          background: '#0b0f19',
          lineColor: needsLineFix ? '#818cf8' : prev.lineColor,
          primaryColor: !isColorDark(prev.primaryColor) ? '#1e293b' : prev.primaryColor,
          mainBkg: !isColorDark(prev.mainBkg) ? '#1e293b' : prev.mainBkg,
          primaryTextColor: isColorDark(prev.primaryTextColor) ? '#f8fafc' : prev.primaryTextColor,
          primaryBorderColor: isColorDark(prev.primaryBorderColor) ? '#6366f1' : prev.primaryBorderColor,
          nodeBorder: isColorDark(prev.nodeBorder) ? '#6366f1' : prev.nodeBorder,
          secondaryColor: '#0f172a',
          tertiaryColor: '#1e1b4b',
          clusterBkg: '#0f172a',
          clusterBorder: '#334155',
          titleColor: '#f8fafc',
          edgeLabelBackground: '#0f172a',
        };
      }

      if (!prev.useCustomColors) {
        return prev.theme === 'dark' ? { ...prev, theme: 'default' } : prev;
      }
      if (!isColorDark(prev.background) && !isColorDark(prev.primaryColor)) {
        return prev;
      }
      return {
        ...prev,
        background: '#ffffff',
        lineColor: !isColorDark(prev.lineColor) ? '#475569' : prev.lineColor,
        primaryColor: '#eef2ff',
        mainBkg: '#eef2ff',
        primaryTextColor: '#0f172a',
        primaryBorderColor: '#4f46e5',
        nodeBorder: '#4f46e5',
        secondaryColor: '#f8fafc',
        tertiaryColor: '#f1f5f9',
        clusterBkg: '#f8fafc',
        clusterBorder: '#cbd5e1',
        titleColor: '#0f172a',
        edgeLabelBackground: '#ffffff',
      };
    });
  }, []);

  // Resizable Split Pane Handler (Desktop)
  useEffect(() => {
    if (!isResizingSplit) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      const relativeX = e.clientX - rect.left;
      const newPercent = Math.min(68, Math.max(22, (relativeX / rect.width) * 100));
      setSplitRatio(newPercent);
    };

    const handleMouseUp = () => {
      setIsResizingSplit(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSplit]);

  // Synchronize line numbers scroll with textarea scroll
  const handleEditorScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Handle Tab key inside editor for clean 4-space indentation
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const nextCode = code.substring(0, start) + '    ' + code.substring(end);
      setCode(nextCode);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 4;
        }
      });
    }
  };

  // Jump to offending line on error click
  const handleJumpToErrorLine = (lineNum: number) => {
    setMobileActivePane('editor');
    setIsDesktopEditorCollapsed(false);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const lines = code.split('\n');
      const clampedLine = Math.max(1, Math.min(lines.length, lineNum));
      let charIndex = 0;
      for (let i = 0; i < clampedLine - 1; i++) {
        charIndex += lines[i].length + 1;
      }
      const lineLength = lines[clampedLine - 1]?.length || 0;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(charIndex, charIndex + lineLength);
      const lineHeight = 22;
      textareaRef.current.scrollTop = Math.max(0, (clampedLine - 4) * lineHeight);
    });
  };

  // Toggle GPU-safe raster proxy layer during pan/zoom gestures or zoomed-out overview so huge SVGs never overflow Chromium VRAM
  const syncGpuProxyDomAttr = useCallback((forceTransforming?: boolean) => {
    const vp = canvasViewportRef.current;
    if (!vp) return;
    const hasProxy = Boolean(gpuProxyRef.current) && isLargeCanvasDiagramRef.current;
    const isGesture = Boolean(forceTransforming || isTransformingRef.current);
    const isZoomedOutOverview =
      cameraRef.current.zoom < 0.85 && !hasInteractiveOverlayStateRef.current;
    const shouldUseProxy =
      hasProxy && !nodeDragRef.current.active && (isGesture || isZoomedOutOverview);
    if (shouldUseProxy) {
      vp.setAttribute('data-gpu-proxy', 'true');
    } else {
      vp.removeAttribute('data-gpu-proxy');
    }
  }, []);

  useEffect(() => {
    syncGpuProxyDomAttr(false);
  }, [
    gpuProxy,
    isLargeCanvasDiagram,
    zoom,
    callflowTrace,
    selectedCallflowNodeId,
    selectedCallflowEdge,
    syncGpuProxyDomAttr,
  ]);

  // Direct DOM gesture attribute toggling so panning/pinching/hover suppression cause 0 React re-renders
  const setCanvasGestureAttrs = useCallback(
    (panning: boolean, transforming: boolean) => {
      isTransformingRef.current = transforming;
      const vp = canvasViewportRef.current;
      if (!vp) return;
      if (panning) vp.setAttribute('data-panning', 'true');
      else vp.removeAttribute('data-panning');
      if (transforming) vp.setAttribute('data-transforming', 'true');
      else vp.removeAttribute('data-transforming');
      syncGpuProxyDomAttr(transforming);
    },
    [syncGpuProxyDomAttr]
  );

  useEffect(() => {
    return () => {
      if (hoverRafRef.current !== null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      if (cameraRafRef.current !== null) {
        cancelAnimationFrame(cameraRafRef.current);
        cameraRafRef.current = null;
      }
      if (wheelSyncTimerRef.current !== null) {
        window.clearTimeout(wheelSyncTimerRef.current);
        wheelSyncTimerRef.current = null;
      }
    };
  }, []);

  // Apply GPU-safe transform directly to canvas stage without promoting giant vector SVGs via permanent will-change
  const applyCameraToDom = useCallback(
    (panX: number, panY: number, z: number, activeGesture: boolean) => {
      cameraRef.current = { zoom: z, panX, panY };
      const stage = stageElRef.current;
      if (stage) {
        if (stage.style.willChange) {
          stage.style.willChange = '';
        }
        stage.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${z})`;
      }
      syncGpuProxyDomAttr(activeGesture);
    },
    [syncGpuProxyDomAttr]
  );

  // Sync React camera state when programmatic zoom/pan buttons or resets run
  useLayoutEffect(() => {
    if (isPanningRef.current || isTransformingRef.current) return;
    applyCameraToDom(pan.x, pan.y, zoom, false);
  }, [pan.x, pan.y, zoom, applyCameraToDom]);

  // Fit entire diagram into viewport (overview)
  const handleFitToViewport = useCallback(() => {
    if (!coloredSvg || !canvasViewportRef.current) {
      applyCameraToDom(0, 0, 1, false);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const rect = canvasViewportRef.current.getBoundingClientRect();
    const dims = getSvgDimensions(coloredSvg);
    const padding = rect.width < 640 ? 32 : 80;
    const scaleX = Math.max(100, rect.width - padding) / Math.max(1, dims.width);
    const scaleY = Math.max(100, rect.height - padding) / Math.max(1, dims.height);
    const optimalScale = Number(Math.min(2.5, Math.max(0.05, Math.min(scaleX, scaleY))).toFixed(2));
    applyCameraToDom(0, 0, optimalScale, false);
    setZoom(optimalScale);
    setPan({ x: 0, y: 0 });
  }, [coloredSvg, applyCameraToDom]);

  // Automatically center & fit the Master diagram as soon as its SVG renders after loading/switching
  useEffect(() => {
    if (!coloredSvg || preloadProgress?.active || !pendingAutoFitRef.current) return;
    const frameId = requestAnimationFrame(() => {
      handleFitToViewport();
      pendingAutoFitRef.current = false;
    });
    return () => cancelAnimationFrame(frameId);
  }, [coloredSvg, preloadProgress?.active, handleFitToViewport]);

  // Center and zoom camera directly onto a specific Callflow node in readable 1:1+ scale
  const handleFocusNodeOnCanvas = useCallback(
    (nodeId: string, desiredMinZoom = 1.2) => {
      if (!canvasViewportRef.current) return;
      requestAnimationFrame(() => {
        if (!canvasViewportRef.current) return;
        // Temporarily reveal vector layer if GPU proxy was hiding SVG nodes for measurement
        canvasViewportRef.current.removeAttribute('data-gpu-proxy');
        const vpRect = canvasViewportRef.current.getBoundingClientRect();
        const vpCenterX = vpRect.left + vpRect.width / 2;
        const vpCenterY = vpRect.top + vpRect.height / 2;

        const liveNodeEl = liveSvgIndexRef.current?.nodes.get(nodeId)?.groupEl || null;
        let targetEl: Element | null = liveNodeEl;
        if (!targetEl) {
          const candidates = canvasViewportRef.current.querySelectorAll(
            'g.node, g.actor, g.statediagram-state, g.classGroup'
          );
          for (const el of Array.from(candidates)) {
            const matched = resolveClickedNodeIdFromSvgElement(el, callflowGraph);
            if (matched === nodeId) {
              targetEl = el;
              break;
            }
          }
        }

        if (!targetEl) return;

        const nodeRect = targetEl.getBoundingClientRect();
        const nodeCenterX = nodeRect.left + nodeRect.width / 2;
        const nodeCenterY = nodeRect.top + nodeRect.height / 2;

        const curCam = cameraRef.current;
        const currentStageCenterX = vpCenterX + curCam.panX;
        const currentStageCenterY = vpCenterY + curCam.panY;
        const unscaledOffsetX = (nodeCenterX - currentStageCenterX) / Math.max(0.05, curCam.zoom);
        const unscaledOffsetY = (nodeCenterY - currentStageCenterY) / Math.max(0.05, curCam.zoom);

        const nextZoom = Number(
          Math.min(20.0, Math.max(desiredMinZoom, curCam.zoom < 0.95 ? 1.25 : curCam.zoom)).toFixed(2)
        );
        const nextPanX = Math.round(-unscaledOffsetX * nextZoom);
        const nextPanY = Math.round(-unscaledOffsetY * nextZoom);
        applyCameraToDom(nextPanX, nextPanY, nextZoom, false);
        setZoom(nextZoom);
        setPan({ x: nextPanX, y: nextPanY });
      });
    },
    [callflowGraph, applyCameraToDom]
  );

  const globalSearchEntries = useMemo(
    () =>
      buildWorkspaceGlobalSearchIndex(
        scriptWorkspace.modules.length > 0 ? scriptWorkspace : null,
        callflowGraph,
        callflowViewLevel.level === 'detail'
          ? `script:${callflowViewLevel.scriptNumber}`
          : 'master'
      ),
    [scriptWorkspace, callflowGraph, callflowViewLevel]
  );

  const callflowSimulationModel = useMemo(
    () =>
      buildCallflowSimulationModel(
        scriptWorkspace.modules.length > 0 ? scriptWorkspace : null
      ),
    [scriptWorkspace]
  );

  // Resolve deferred node focus after Global Search or Call Simulator switches script views
  useEffect(() => {
    const pending = pendingNodeFocusHintRef.current;
    if (!pending || !coloredSvg || callflowGraph.nodes.size === 0) return;
    pendingNodeFocusHintRef.current = null;
    let targetId: string | null =
      pending.nodeId && callflowGraph.nodes.has(pending.nodeId)
        ? pending.nodeId
        : pending.fallbackNodeId && callflowGraph.nodes.has(pending.fallbackNodeId)
          ? pending.fallbackNodeId
          : null;
    if (!targetId && pending.labelHint) {
      const needle = pending.labelHint
        .replace(/^(Queue|Ansage-Ende|Weiterleitung):\s*/i, '')
        .trim()
        .toLowerCase();
      if (needle) {
        for (const node of callflowGraph.nodes.values()) {
          if (node.label.toLowerCase().includes(needle)) {
            targetId = node.id;
            break;
          }
        }
      }
    }
    if (!targetId && callflowGraph.entryNodes.length > 0) {
      targetId = callflowGraph.entryNodes[0].id;
    }
    if (targetId) {
      setSelectedCallflowNodeId(targetId);
      setTimeout(() => handleFocusNodeOnCanvas(targetId!, 1.15), 90);
    }
  }, [coloredSvg, callflowGraph, handleFocusNodeOnCanvas]);

  // Global Studio Keyboard Shortcuts (Ctrl+K search, M minimap, B sidebar, F fullscreen)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsGlobalSearchOpen((prev) => !prev);
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'm') {
        e.preventDefault();
        setShowMinimap((prev) => !prev);
      } else if (key === 'b') {
        e.preventDefault();
        setIsRightPanelOpen((prev) => !prev);
      } else if (key === 'f') {
        e.preventDefault();
        setIsFullscreenPreview((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleGlobalSearchSelect = useCallback(
    (entry: GlobalSearchEntry) => {
      const targetIsDetail = Boolean(entry.scriptNumber);
      const alreadyOnTarget =
        callflowViewLevel.level !== 'welcome' &&
        ((targetIsDetail &&
          callflowViewLevel.level === 'detail' &&
          canonicalScriptMatchKey(callflowViewLevel.scriptNumber) ===
            canonicalScriptMatchKey(entry.scriptNumber!)) ||
          (!targetIsDetail && callflowViewLevel.level === 'master'));

      if (!alreadyOnTarget) {
        if (targetIsDetail && entry.scriptNumber) {
          pendingNodeFocusHintRef.current = {
            nodeId: entry.nodeId,
            labelHint: entry.title,
          };
          handleSwitchCallflowViewLevel({ level: 'detail', scriptNumber: entry.scriptNumber });
          return;
        }
        if (callflowViewLevel.level === 'welcome') {
          pendingNodeFocusHintRef.current = {
            nodeId: entry.nodeId,
            labelHint: entry.title,
          };
          handleSwitchCallflowViewLevel({ level: 'master' });
          return;
        }
      }

      let focusId: string | null =
        entry.nodeId && callflowGraph.nodes.has(entry.nodeId) ? entry.nodeId : null;
      if (!focusId && entry.title) {
        const needle = entry.title.toLowerCase();
        for (const node of callflowGraph.nodes.values()) {
          if (node.label.toLowerCase().includes(needle)) {
            focusId = node.id;
            break;
          }
        }
      }
      if (focusId) {
        setSelectedCallflowNodeId(focusId);
        handleFocusNodeOnCanvas(focusId, 1.15);
      }
    },
    [callflowViewLevel, callflowGraph, handleFocusNodeOnCanvas]
  );

  const handleSimulatorFocusStep = useCallback(
    (step: CallSimulationStep) => {
      const scriptNumber = step.scriptNumber;
      const labelHint = step.queueTarget || step.announcement || step.title;
      const alreadyOnTarget =
        callflowViewLevel.level === 'detail' &&
        canonicalScriptMatchKey(callflowViewLevel.scriptNumber) ===
          canonicalScriptMatchKey(scriptNumber);
      if (!alreadyOnTarget) {
        pendingNodeFocusHintRef.current = {
          nodeId: step.targetNodeId,
          fallbackNodeId: step.fallbackNodeId,
          labelHint,
        };
        handleSwitchCallflowViewLevel({ level: 'detail', scriptNumber });
        return;
      }
      let focusId: string | null =
        step.targetNodeId && callflowGraph.nodes.has(step.targetNodeId)
          ? step.targetNodeId
          : step.fallbackNodeId && callflowGraph.nodes.has(step.fallbackNodeId)
            ? step.fallbackNodeId
            : null;
      if (!focusId && labelHint) {
        const needle = labelHint
          .replace(/^(Queue|Ansage-Ende|Weiterleitung|Prio\s+\d+\s*·\s*):\s*/i, '')
          .trim()
          .toLowerCase();
        for (const node of callflowGraph.nodes.values()) {
          if (needle && node.label.toLowerCase().includes(needle)) {
            focusId = node.id;
            break;
          }
        }
      }
      if (!focusId && callflowGraph.entryNodes.length > 0) {
        focusId = callflowGraph.entryNodes[0].id;
      }
      if (focusId) {
        setSelectedCallflowNodeId(focusId);
        handleFocusNodeOnCanvas(focusId, 1.15);
      }
    },
    [callflowViewLevel, callflowGraph, handleFocusNodeOnCanvas]
  );

  const handleExportOpeningHoursCsv = useCallback(() => {
    if (scriptWorkspace.modules.length === 0) return;
    const csv = exportOpeningHoursCsv(scriptWorkspace);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    triggerLocalDownload(blob, 'Callflow-Oeffnungszeiten.csv');
  }, [scriptWorkspace]);

  const handleExportRoutingMatrixCsv = useCallback(() => {
    if (scriptWorkspace.modules.length === 0) return;
    const csv = exportRoutingMatrixCsv(scriptWorkspace);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    triggerLocalDownload(blob, 'Callflow-Routing-Matrix.csv');
  }, [scriptWorkspace]);

  const handleExportMarkdownDoc = useCallback(() => {
    if (scriptWorkspace.modules.length === 0) return;
    const md = exportMigrationDocumentationMarkdown(scriptWorkspace);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    triggerLocalDownload(blob, 'Callflow-Dokumentation.md');
  }, [scriptWorkspace]);

  // Cursor-centered Canvas Wheel Zoom (5% up to 2000%) — 60fps direct transform, debounced UI sync
  const handleCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!canvasViewportRef.current) return;

    const rect = canvasViewportRef.current.getBoundingClientRect();
    const cursorOffsetX = e.clientX - (rect.left + rect.width / 2);
    const cursorOffsetY = e.clientY - (rect.top + rect.height / 2);

    const curCam = cameraRef.current;
    const factor = e.deltaY < 0 ? 1.16 : 0.86;
    const nextZoom = Math.min(20.0, Math.max(0.05, Number((curCam.zoom * factor).toFixed(2))));
    const scaleRatio = nextZoom / Math.max(0.05, curCam.zoom);

    const nextPanX = Math.round(cursorOffsetX - (cursorOffsetX - curCam.panX) * scaleRatio);
    const nextPanY = Math.round(cursorOffsetY - (cursorOffsetY - curCam.panY) * scaleRatio);

    cameraRef.current = { zoom: nextZoom, panX: nextPanX, panY: nextPanY };
    setCanvasGestureAttrs(isPanningRef.current, true);
    if (cameraRafRef.current === null) {
      cameraRafRef.current = requestAnimationFrame(() => {
        cameraRafRef.current = null;
        const cam = cameraRef.current;
        applyCameraToDom(cam.panX, cam.panY, cam.zoom, true);
      });
    }

    if (wheelSyncTimerRef.current !== null) {
      window.clearTimeout(wheelSyncTimerRef.current);
    }
    wheelSyncTimerRef.current = window.setTimeout(() => {
      wheelSyncTimerRef.current = null;
      const cam = cameraRef.current;
      setCanvasGestureAttrs(isPanningRef.current, false);
      applyCameraToDom(cam.panX, cam.panY, cam.zoom, false);
      setZoom(cam.zoom);
      setPan({ x: cam.panX, y: cam.panY });
    }, 110);
  };

  // Adaptive step zoom in/out for toolbar buttons
  const handleStepZoom = (direction: 'in' | 'out') => {
    if (wheelSyncTimerRef.current !== null) {
      window.clearTimeout(wheelSyncTimerRef.current);
      wheelSyncTimerRef.current = null;
    }
    const cur = cameraRef.current;
    const step = cur.zoom < 0.5 ? 0.1 : cur.zoom < 2.0 ? 0.25 : cur.zoom < 5.0 ? 0.5 : 1.5;
    const next = direction === 'in' ? cur.zoom + step : cur.zoom - step;
    const clamped = Math.min(20.0, Math.max(0.05, Number(next.toFixed(2))));
    applyCameraToDom(cur.panX, cur.panY, clamped, false);
    setPan({ x: cur.panX, y: cur.panY });
    setZoom(clamped);
  };

  const isCanvasOverlayTarget = (target: EventTarget | null): boolean => {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    return Boolean(
      el.closest(
        '[data-canvas-ui="true"], button, a, input, select, textarea, label, [role="button"]'
      )
    );
  };

  const commitNodePositionOffset = useCallback(
    (nodeId: string, offset: NodePositionOffset | null) => {
      if (scriptWorkspace.modules.length > 0) {
        const nextOffsets = { ...(scriptWorkspace.nodeOffsets || {}) };
        if (!offset || (Math.abs(offset.dx) < 0.5 && Math.abs(offset.dy) < 0.5)) {
          delete nextOffsets[nodeId];
        } else {
          nextOffsets[nodeId] = {
            dx: Math.round(offset.dx),
            dy: Math.round(offset.dy),
          };
        }
        setScriptWorkspace((prev) => ({
          ...prev,
          nodeOffsets: nextOffsets,
          updatedAt: Date.now(),
        }));
      } else {
        setStandaloneNodeOffsets((prev) => {
          const next = { ...prev };
          if (!offset || (Math.abs(offset.dx) < 0.5 && Math.abs(offset.dy) < 0.5)) {
            delete next[nodeId];
          } else {
            next[nodeId] = {
              dx: Math.round(offset.dx),
              dy: Math.round(offset.dy),
            };
          }
          return next;
        });
      }
    },
    [scriptWorkspace.modules.length, scriptWorkspace.nodeOffsets]
  );

  const handleResetAllNodeOffsets = useCallback(() => {
    if (scriptWorkspace.modules.length > 0) {
      setScriptWorkspace((prev) => ({
        ...prev,
        nodeOffsets: {},
        updatedAt: Date.now(),
      }));
    } else {
      setStandaloneNodeOffsets({});
    }
  }, [scriptWorkspace.modules.length]);

  const [lastIndexRecomputedAt, setLastIndexRecomputedAt] = useState<number | null>(null);

  const handleRecomputeWorkspaceIndex = useCallback(() => {
    if (scriptWorkspace.modules.length === 0) return;
    const upgraded = rehydrateAndUpgradeWorkspace(scriptWorkspace);
    const stampedWorkspace: ScriptWorkspace = {
      ...upgraded,
      updatedAt: Date.now(),
    };
    setScriptWorkspace(stampedWorkspace);
    const activeDir = getDiagramDirection(code) || 'LR';
    if (callflowViewLevel.level === 'detail' && callflowViewLevel.scriptNumber) {
      setCode(
        buildScriptDetailMermaid(
          stampedWorkspace,
          callflowViewLevel.scriptNumber,
          activeDir
        )
      );
    } else {
      setCode(
        buildMasterOverviewMermaid(stampedWorkspace, activeDir, {
          compact: isMasterCompact,
        })
      );
    }
    setLastIndexRecomputedAt(Date.now());
  }, [scriptWorkspace, code, callflowViewLevel, isMasterCompact]);

  // Unified hit-test: checks live SVG target first, then falls back to O(1) coordinate lookup while GPU Proxy is active
  const resolveNodeIdAtClientPoint = useCallback(
    (targetEl: Element | null, clientX: number, clientY: number): string | null => {
      const direct = resolveClickedNodeIdFromSvgElement(targetEl, callflowGraph);
      if (direct) return direct;
      const index = liveSvgIndexRef.current;
      if (!index) return null;
      const frameEl =
        (stageElRef.current?.querySelector('.mermaid-stage-frame') as HTMLElement | null) || null;
      return hitTestLiveSvgNodeAtClientPoint(index, clientX, clientY, frameEl);
    },
    [callflowGraph]
  );

  const handleOpenNodeEditor = useCallback(
    (nodeId: string) => {
      if (!nodeId || !callflowGraph.nodes.has(nodeId)) return;
      const snap = inspectWorkspaceNodeForEdit(
        scriptWorkspace,
        callflowViewLevel,
        nodeId,
        callflowGraph
      );
      setEditingNodeSnapshot(snap);
    },
    [scriptWorkspace, callflowViewLevel, callflowGraph]
  );

  const toggleNodeSelectionClean = useCallback(
    (nodeId: string) => {
      setSelectedCallflowEdge(null);
      setSelectedCallflowNodeId((prev) => {
        const next = prev === nodeId ? null : nodeId;
        if (next) {
          setRightSidebarTab('callflow');
          setIsRightPanelOpen(true);
          if (workspaceMode === 'guided' && scriptWorkspace.modules.length > 0 && guidedStep === 1) {
            setGuidedStep(2);
          }
        } else {
          setIsolateSubgraphMode(false);
        }
        return next;
      });
    },
    [workspaceMode, scriptWorkspace.modules.length, guidedStep]
  );

  // rAF-throttled hover tracker: reveals docked padlock ("Schloss-Symbol") without blocking 60fps gestures
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isVisualEditMode) return;
    if (isPanningRef.current || nodeDragRef.current.active || isTransformingRef.current) return;

    hoverPendingTargetRef.current = e.target instanceof Element ? e.target : null;
    if (hoverRafRef.current !== null) return;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null;
      const index = liveSvgIndexRef.current;
      if (!index || isPanningRef.current || nodeDragRef.current.active || isTransformingRef.current) {
        return;
      }

      const target = hoverPendingTargetRef.current;
      const lockHit = resolveClickedLockFromSvgElement(target);
      const hoveredEdge = lockHit || resolveClickedEdgeFromSvgElement(target);
      const hoveredNodeId = !hoveredEdge
        ? resolveClickedNodeIdFromSvgElement(target, callflowGraph)
        : null;

      const nextKey = `${hoveredEdge?.from || ''}>${hoveredEdge?.to || ''}|${hoveredNodeId || ''}`;
      if (nextKey !== lastHoverLockKeyRef.current) {
        lastHoverLockKeyRef.current = nextKey;
        setHoveredLockTargetsInDom(index, hoveredEdge, hoveredNodeId, selectedCallflowEdge);
      }
    });
  };

  // Canvas Mouse Drag Pan + Visual Node Drag with Live Edges + Wire Connect + Padlock Unlock + Click/Deselect
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Ignore synthetic mouse events generated by mobile browsers right after touch events
    if (Date.now() - lastTouchTimeRef.current < 700) return;
    if (e.button !== 0) return;
    if (isCanvasOverlayTarget(e.target)) return;

    const targetEl = e.target as Element;
    const clickedLockHit = resolveClickedLockFromSvgElement(targetEl);
    const portEl = !clickedLockHit ? targetEl?.closest?.('[data-port-node-id]') : null;
    const clickedNodeId =
      !clickedLockHit && !portEl
        ? resolveNodeIdAtClientPoint(targetEl, e.clientX, e.clientY)
        : null;
    const clickedEdgeHit =
      !clickedLockHit && !portEl && !clickedNodeId
        ? resolveClickedEdgeFromSvgElement(targetEl)
        : null;

    // 1. Check if starting a Drag-to-Connect wire (either from a 4-side port dot or in 'connect' tool mode)
    const wireSourceNodeId =
      portEl?.getAttribute('data-port-node-id') ||
      (isVisualEditMode && visualEditTool === 'connect' ? clickedNodeId : null);

    let startedInteraction: 'none' | 'connect-wire' | 'move-node' | 'lock-click' | 'pan' = 'none';

    if (clickedLockHit) {
      // Do not pan canvas when clicking a docked padlock icon
      startedInteraction = 'lock-click';
    } else if (wireSourceNodeId && canvasViewportRef.current) {
      e.stopPropagation();
      const vpRect = canvasViewportRef.current.getBoundingClientRect();
      let startX = e.clientX - vpRect.left;
      let startY = e.clientY - vpRect.top;
      if (portEl) {
        const portRect = portEl.getBoundingClientRect();
        if (portRect.width > 0 || portRect.height > 0) {
          startX = (portRect.left + portRect.right) / 2 - vpRect.left;
          startY = (portRect.top + portRect.bottom) / 2 - vpRect.top;
        }
      }
      const fromLabel = callflowGraph.nodes.get(wireSourceNodeId)?.label || wireSourceNodeId;

      snappedPortRef.current = null;
      if (liveSvgIndexRef.current) {
        materializeActiveNodePortsInDom(liveSvgIndexRef.current, wireSourceNodeId, true);
        setMagneticSnapTargetInDom(liveSvgIndexRef.current, null, true);
      }

      nodeDragRef.current = {
        active: true,
        mode: 'connect-wire',
        nodeId: wireSourceNodeId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origDx: 0,
        origDy: 0,
        currentDx: 0,
        currentDy: 0,
        baseTransformX: 0,
        baseTransformY: 0,
        baseTransformRest: '',
        domNodeGroup: null,
        movedPixels: 0,
        wireStartX: startX,
        wireStartY: startY,
      };
      setActiveWirePreview({
        fromNodeId: wireSourceNodeId,
        fromLabel,
        startX,
        startY,
        curX: startX,
        curY: startY,
        hoverTargetNodeId: null,
        snappedPortSide: null,
      });
      startedInteraction = 'connect-wire';
    } else if (isVisualEditMode && visualEditTool === 'move' && clickedNodeId) {
      // 2. Prepare 60fps Node Move Drag (actual DOM movement waits until DRAG_THRESHOLD_PX)
      const liveNode = liveSvgIndexRef.current?.nodes.get(clickedNodeId);
      const domGroup =
        liveNode?.groupEl ||
        (targetEl.closest('g.node, g.actor, g.statediagram-state, g.classGroup') as SVGGElement | null);
      if (domGroup) {
        const currentOff = activeNodeOffsetsRef.current[clickedNodeId] || { dx: 0, dy: 0 };
        let baseX = liveNode?.baseTx ?? 0;
        let baseY = liveNode?.baseTy ?? 0;
        let restTransform = liveNode?.restTransform ?? '';
        if (!liveNode) {
          const rawTransform = domGroup.getAttribute('transform') || '';
          const trMatch = rawTransform.match(
            /translate\(\s*([+-]?\d+(?:\.\d+)?)(?:[\s,]+([+-]?\d+(?:\.\d+)?))?\s*\)/i
          );
          const curTx = trMatch ? parseFloat(trMatch[1] || '0') : 0;
          const curTy = trMatch ? parseFloat(trMatch[2] || '0') : 0;
          restTransform = trMatch ? rawTransform.replace(trMatch[0], '').trim() : rawTransform;
          baseX = curTx - currentOff.dx;
          baseY = curTy - currentOff.dy;
        }

        nodeDragRef.current = {
          active: true,
          mode: 'move-node',
          nodeId: clickedNodeId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          origDx: currentOff.dx,
          origDy: currentOff.dy,
          currentDx: currentOff.dx,
          currentDy: currentOff.dy,
          baseTransformX: baseX,
          baseTransformY: baseY,
          baseTransformRest: restTransform,
          domNodeGroup: domGroup,
          movedPixels: 0,
          wireStartX: 0,
          wireStartY: 0,
        };
        startedInteraction = 'move-node';
      }
    }

    if (startedInteraction === 'none') {
      isPanningRef.current = true;
      setCanvasGestureAttrs(true, false);
      dragDistanceRef.current = 0;
      panMouseStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = {
        x: e.clientX - cameraRef.current.panX,
        y: e.clientY - cameraRef.current.panY,
      };
      startedInteraction = 'pan';
    }

    // Attach global window listeners so fast cursor movement past viewport bounds never breaks dragging
    const handleWindowMouseMove = (ev: MouseEvent) => {
      if (nodeDragRef.current.active) {
        const st = nodeDragRef.current;
        const rawPixelDx = ev.clientX - st.startClientX;
        const rawPixelDy = ev.clientY - st.startClientY;
        st.movedPixels = Math.max(st.movedPixels, Math.hypot(rawPixelDx, rawPixelDy));

        if (st.mode === 'connect-wire' && canvasViewportRef.current) {
          const vpRect = canvasViewportRef.current.getBoundingClientRect();
          const elAtCursor = document.elementFromPoint(ev.clientX, ev.clientY);
          const hoveredId = resolveClickedNodeIdFromSvgElement(elAtCursor, callflowGraph);
          const magneticSnap = liveSvgIndexRef.current
            ? findNearestMagneticPort(
                liveSvgIndexRef.current,
                ev.clientX,
                ev.clientY,
                st.nodeId,
                28,
                hoveredId
              )
            : null;

          const curX = magneticSnap
            ? magneticSnap.clientX - vpRect.left
            : ev.clientX - vpRect.left;
          const curY = magneticSnap
            ? magneticSnap.clientY - vpRect.top
            : ev.clientY - vpRect.top;

          if (wireLineRef.current) {
            wireLineRef.current.setAttribute('x2', String(curX));
            wireLineRef.current.setAttribute('y2', String(curY));
          }

          const nextSnapTarget = magneticSnap
            ? { nodeId: magneticSnap.nodeId, side: magneticSnap.side }
            : null;
          const prevSnap = snappedPortRef.current;
          if (
            prevSnap?.nodeId !== nextSnapTarget?.nodeId ||
            prevSnap?.side !== nextSnapTarget?.side
          ) {
            snappedPortRef.current = nextSnapTarget;
            if (liveSvgIndexRef.current) {
              setMagneticSnapTargetInDom(liveSvgIndexRef.current, nextSnapTarget, true);
            }
          }

          const nextHover =
            magneticSnap?.nodeId ||
            (hoveredId && hoveredId !== st.nodeId ? hoveredId : null);
          const nextSide = magneticSnap?.side ?? null;

          setActiveWirePreview((prev) =>
            prev &&
            (prev.hoverTargetNodeId !== nextHover ||
              (prev.snappedPortSide ?? null) !== nextSide ||
              (nextSide !== null &&
                (Math.abs(prev.curX - curX) > 1 || Math.abs(prev.curY - curY) > 1)))
              ? {
                  ...prev,
                  curX,
                  curY,
                  hoverTargetNodeId: nextHover,
                  snappedPortSide: nextSide,
                }
              : prev
          );
          return;
        }

        if (st.mode === 'move-node' && st.domNodeGroup) {
          if (st.movedPixels < DRAG_THRESHOLD_PX) return;
          const curZoom = Math.max(0.05, cameraRef.current.zoom);
          const unscaledDx = rawPixelDx / curZoom;
          const unscaledDy = rawPixelDy / curZoom;
          let nextDx = st.origDx + unscaledDx;
          let nextDy = st.origDy + unscaledDy;
          if (snapToGrid) {
            nextDx = Math.round(nextDx / 16) * 16;
            nextDy = Math.round(nextDy / 16) * 16;
          }
          st.currentDx = nextDx;
          st.currentDy = nextDy;

          if (dragMoveRafRef.current === null) {
            dragMoveRafRef.current = requestAnimationFrame(() => {
              dragMoveRafRef.current = null;
              const activeSt = nodeDragRef.current;
              if (!activeSt.active || activeSt.mode !== 'move-node' || !activeSt.domNodeGroup) {
                return;
              }
              const nextTx = Number((activeSt.baseTransformX + activeSt.currentDx).toFixed(2));
              const nextTy = Number((activeSt.baseTransformY + activeSt.currentDy).toFixed(2));
              activeSt.domNodeGroup.setAttribute(
                'transform',
                `translate(${nextTx}, ${nextTy})${
                  activeSt.baseTransformRest ? ` ${activeSt.baseTransformRest}` : ''
                }`
              );
              if (liveSvgIndexRef.current) {
                shiftLiveConnectedEdgesForDrag(
                  liveSvgIndexRef.current,
                  activeSt.nodeId,
                  { dx: activeSt.currentDx, dy: activeSt.currentDy },
                  activeNodeOffsetsRef.current
                );
              }
            });
          }
          return;
        }
      }

      if (!isPanningRef.current) return;
      const nextX = Math.round(ev.clientX - panStartRef.current.x);
      const nextY = Math.round(ev.clientY - panStartRef.current.y);
      const moveDist = Math.hypot(
        ev.clientX - panMouseStartRef.current.x,
        ev.clientY - panMouseStartRef.current.y
      );
      dragDistanceRef.current = Math.max(dragDistanceRef.current, moveDist);
      if (moveDist > 1 && !isTransformingRef.current) {
        setCanvasGestureAttrs(true, true);
      }
      cameraRef.current = { ...cameraRef.current, panX: nextX, panY: nextY };
      if (cameraRafRef.current === null) {
        cameraRafRef.current = requestAnimationFrame(() => {
          cameraRafRef.current = null;
          const cam = cameraRef.current;
          applyCameraToDom(cam.panX, cam.panY, cam.zoom, true);
        });
      }
    };

    const cleanupListeners = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
      if (dragMoveRafRef.current !== null) {
        cancelAnimationFrame(dragMoveRafRef.current);
        dragMoveRafRef.current = null;
      }
      if (cameraRafRef.current !== null) {
        cancelAnimationFrame(cameraRafRef.current);
        cameraRafRef.current = null;
      }
    };

    const handleWindowBlur = () => {
      cleanupListeners();
      nodeDragRef.current.active = false;
      snappedPortRef.current = null;
      isPanningRef.current = false;
      setCanvasGestureAttrs(false, false);
      setActiveWirePreview(null);
      if (liveSvgIndexRef.current) {
        setMagneticSnapTargetInDom(liveSvgIndexRef.current, null, false);
        applyLiveNodeOffsetsToDom(liveSvgIndexRef.current, activeNodeOffsetsRef.current, isVisualEditMode);
      }
    };

    const handleWindowMouseUp = (ev: MouseEvent) => {
      cleanupListeners();

      if (nodeDragRef.current.active) {
        const st = nodeDragRef.current;
        nodeDragRef.current.active = false;

        if (st.mode === 'connect-wire') {
          const dropEl =
            document.elementFromPoint(ev.clientX, ev.clientY) || (ev.target as Element);
          const resolvedDropNodeId = resolveClickedNodeIdFromSvgElement(dropEl, callflowGraph);
          const targetNodeId = snappedPortRef.current?.nodeId || resolvedDropNodeId;
          snappedPortRef.current = null;
          if (liveSvgIndexRef.current) {
            setMagneticSnapTargetInDom(liveSvgIndexRef.current, null, false);
          }
          setActiveWirePreview(null);
          if (targetNodeId && targetNodeId !== st.nodeId) {
            const fromLabel = callflowGraph.nodes.get(st.nodeId)?.label || st.nodeId;
            const toLabel = callflowGraph.nodes.get(targetNodeId)?.label || targetNodeId;
            setSelectedCallflowEdge(null);
            if (scriptWorkspace.modules.length > 0) {
              const nextWs = connectNodesInWorkspace(
                scriptWorkspace,
                callflowViewLevel,
                st.nodeId,
                targetNodeId,
                ''
              );
              setScriptWorkspace(nextWs);
              refreshDiagramFromWorkspace(nextWs);
            } else {
              skipAutoConvertRef.current = true;
              setCode((prev) => `${prev.trimEnd()}\n    ${st.nodeId} --> ${targetNodeId}\n`);
            }
            setRecentConnectionBanner({
              fromNodeId: st.nodeId,
              toNodeId: targetNodeId,
              fromLabel,
              toLabel,
              labelDraft: '',
            });
          }
          return;
        }

        if (st.mode === 'move-node') {
          if (st.movedPixels >= DRAG_THRESHOLD_PX) {
            commitNodePositionOffset(st.nodeId, {
              dx: st.currentDx,
              dy: st.currentDy,
            });
          } else if (ev.detail < 2) {
            toggleNodeSelectionClean(st.nodeId);
          }
          return;
        }
      }

      if (clickedLockHit) {
        const lockDist = Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY);
        if (lockDist < DRAG_THRESHOLD_PX) {
          handleDisconnectEdgeEndpoints(clickedLockHit.from, clickedLockHit.to);
        }
        return;
      }

      const wasClick = isPanningRef.current && dragDistanceRef.current < DRAG_THRESHOLD_PX;
      isPanningRef.current = false;
      setCanvasGestureAttrs(false, false);
      const cam = cameraRef.current;
      applyCameraToDom(cam.panX, cam.panY, cam.zoom, false);
      setPan({ x: cam.panX, y: cam.panY });

      const targetAtUp = ev.target instanceof Element ? ev.target : null;
      if (targetAtUp && isCanvasOverlayTarget(targetAtUp)) return;

      if (wasClick) {
        const lockAtUp = resolveClickedLockFromSvgElement(targetAtUp);
        if (lockAtUp) {
          handleDisconnectEdgeEndpoints(lockAtUp.from, lockAtUp.to);
          return;
        }
        const clickedIdAtUp = resolveNodeIdAtClientPoint(targetAtUp, ev.clientX, ev.clientY);
        if (clickedIdAtUp) {
          if (ev.detail < 2) {
            toggleNodeSelectionClean(clickedIdAtUp);
          }
        } else {
          const edgeHit =
            resolveClickedEdgeFromSvgElement(targetAtUp) || clickedEdgeHit;
          if (edgeHit) {
            setSelectedCallflowNodeId(null);
            setIsolateSubgraphMode(false);
            setRecentConnectionBanner(null);
            setSelectedCallflowEdge({
              ...edgeHit,
              labelDraft: edgeHit.label,
            });
          } else {
            // Clicking empty canvas reliably clears node selection, isolated path filter & edge selection
            setSelectedCallflowNodeId(null);
            setIsolateSubgraphMode(false);
            setSelectedCallflowEdge(null);
          }
        }
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('blur', handleWindowBlur);
  };

  // Multi-Touch Gestures: 1-Finger Pan & 2-Finger Pinch-to-Zoom (up to 2000%)
  const getTouchDistance = (touches: React.TouchList): number => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };

  const handleCanvasTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    lastTouchTimeRef.current = Date.now();
    if (isCanvasOverlayTarget(e.target) || !coloredSvg) {
      touchGestureRef.current.mode = 'none';
      isPanningRef.current = false;
      setCanvasGestureAttrs(false, false);
      return;
    }
    if (e.touches.length === 1) {
      dragDistanceRef.current = 0;
      touchGestureRef.current = {
        mode: 'pan',
        startX: e.touches[0].clientX - cameraRef.current.panX,
        startY: e.touches[0].clientY - cameraRef.current.panY,
        initialPinchDistance: 0,
        initialZoom: cameraRef.current.zoom,
      };
      isPanningRef.current = true;
      setCanvasGestureAttrs(true, true);
    } else if (e.touches.length === 2) {
      const dist = getTouchDistance(e.touches);
      touchGestureRef.current = {
        mode: 'pinch',
        startX: cameraRef.current.panX,
        startY: cameraRef.current.panY,
        initialPinchDistance: Math.max(1, dist),
        initialZoom: cameraRef.current.zoom,
      };
      isPanningRef.current = false;
      setCanvasGestureAttrs(false, true);
    }
  };

  const handleCanvasTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    lastTouchTimeRef.current = Date.now();
    if (isCanvasOverlayTarget(e.target) || !coloredSvg) return;
    if (touchGestureRef.current.mode === 'pan' && e.touches.length === 1) {
      const nextX = Math.round(e.touches[0].clientX - touchGestureRef.current.startX);
      const nextY = Math.round(e.touches[0].clientY - touchGestureRef.current.startY);
      dragDistanceRef.current += Math.hypot(
        nextX - cameraRef.current.panX,
        nextY - cameraRef.current.panY
      );
      applyCameraToDom(nextX, nextY, cameraRef.current.zoom, true);
    } else if (touchGestureRef.current.mode === 'pinch' && e.touches.length === 2) {
      const currentDist = getTouchDistance(e.touches);
      const ratio = currentDist / touchGestureRef.current.initialPinchDistance;
      const nextZoom = Math.min(
        20.0,
        Math.max(0.05, Number((touchGestureRef.current.initialZoom * ratio).toFixed(2)))
      );
      applyCameraToDom(cameraRef.current.panX, cameraRef.current.panY, nextZoom, true);
    }
  };

  const handleCanvasTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    lastTouchTimeRef.current = Date.now();
    if (isCanvasOverlayTarget(e.target) || !coloredSvg) {
      touchGestureRef.current.mode = 'none';
      isPanningRef.current = false;
      setCanvasGestureAttrs(false, false);
      return;
    }
    const wasTap =
      touchGestureRef.current.mode === 'pan' && dragDistanceRef.current < 8;
    touchGestureRef.current.mode = 'none';
    isPanningRef.current = false;
    setCanvasGestureAttrs(false, false);
    const cam = cameraRef.current;
    applyCameraToDom(cam.panX, cam.panY, cam.zoom, false);
    setPan({ x: cam.panX, y: cam.panY });
    setZoom(cam.zoom);

    if (wasTap) {
      const tappedEl = e.target as Element;
      const tappedLock = resolveClickedLockFromSvgElement(tappedEl);
      if (tappedLock) {
        handleDisconnectEdgeEndpoints(tappedLock.from, tappedLock.to);
        return;
      }
      const touchPt = e.changedTouches?.[0];
      const tappedId = touchPt
        ? resolveNodeIdAtClientPoint(tappedEl, touchPt.clientX, touchPt.clientY)
        : resolveClickedNodeIdFromSvgElement(tappedEl, callflowGraph);
      if (tappedId) {
        toggleNodeSelectionClean(tappedId);
      } else {
        const tappedEdge = resolveClickedEdgeFromSvgElement(tappedEl);
        if (tappedEdge) {
          setSelectedCallflowNodeId(null);
          setIsolateSubgraphMode(false);
          setRecentConnectionBanner(null);
          setSelectedCallflowEdge({
            ...tappedEdge,
            labelDraft: tappedEdge.label,
          });
        } else {
          setSelectedCallflowNodeId(null);
          setIsolateSubgraphMode(false);
          setSelectedCallflowEdge(null);
        }
      }
    }
  };

  // Template & Snippet handlers
  const handleSelectTemplate = (template: DiagramTemplate) => {
    skipAutoConvertRef.current = false;
    setRawScriptDraft(null);
    setScriptWorkspace(buildScriptWorkspace([]));
    setCallflowViewLevel({ level: 'master' });
    setDiagramTitle(template.name);
    setCode(template.code);
    setSelectedCallflowNodeId(null);
    setIsolateSubgraphMode(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMobileActivePane('preview');
  };

  const handleInsertSnippet = (snippet: string) => {
    if (!textareaRef.current) {
      setCode((prev) => `${prev}${snippet}`);
      return;
    }
    const start = textareaRef.current.selectionStart ?? code.length;
    const end = textareaRef.current.selectionEnd ?? code.length;
    const nextCode = code.substring(0, start) + snippet + code.substring(end);
    setCode(nextCode);
    const nextCursorPos = start + snippet.length;
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextCursorPos, nextCursorPos);
      }
    });
  };

  const handleChangeDirection = useCallback((dir: DiagramDirection) => {
    setCode((prev) => updateDiagramDirection(prev, dir));
  }, []);

  const handleInjectInitDirective = useCallback(() => {
    setCode((prev) => injectInitDirectiveIntoCode(prev, themeConfig));
  }, [themeConfig]);

  const handleInjectSmartClassDefs = useCallback(() => {
    setCode((prev) =>
      injectSmartColorsIntoCode(prev, canvasSurface, hiddenSmartNodeTypes)
    );
  }, [canvasSurface, hiddenSmartNodeTypes]);

  const handleChangeMasterDensity = useCallback(
    (nextMode: 'compact' | 'detailed') => {
      setMasterDensityMode(nextMode);
      if (scriptWorkspace.modules.length === 0) return;
      if (callflowViewLevel.level === 'master') {
        const dir = currentDirection || 'LR';
        setCode(
          buildMasterOverviewMermaid(scriptWorkspace, dir, {
            compact: nextMode === 'compact',
          })
        );
        pendingAutoFitRef.current = true;
      }
    },
    [scriptWorkspace, callflowViewLevel.level, currentDirection]
  );

  const handleReturnToWelcomeScreen = useCallback(() => {
    setCallflowViewLevel({ level: 'welcome' });
    setSelectedCallflowNodeId(null);
    setSelectedCallflowEdge(null);
    setIsolateSubgraphMode(false);
    setBaseRenderedSvg(null);
    hasBaseRenderedSvgRef.current = false;
    setMasterRenderError(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleSwitchCallflowViewLevel = useCallback(
    (
      nextLevel: CallflowViewLevel,
      overrideWorkspace?: ScriptWorkspace,
      switchToMobilePreview = false
    ) => {
      if (nextLevel.level === 'welcome') {
        handleReturnToWelcomeScreen();
        return;
      }
      const ws = overrideWorkspace || scriptWorkspace;
      if (ws.modules.length === 0) {
        setCallflowViewLevel(nextLevel);
        return;
      }
      const dir = currentDirection || 'LR';
      const effectiveCompact =
        masterDensityMode === 'compact' ||
        (masterDensityMode === 'auto' && ws.modules.length >= 16);
      const nextCode =
        nextLevel.level === 'master'
          ? buildMasterOverviewMermaid(ws, dir, { compact: effectiveCompact })
          : buildScriptDetailMermaid(ws, nextLevel.scriptNumber, dir);

      setCallflowViewLevel(nextLevel);
      setCode(nextCode);
      if (nextLevel.level === 'master') {
        setDiagramTitle(`Master-Gesamtkarte (${ws.modules.length} Skripte)`);
      } else {
        const mod = ws.modules.find(
          (m) =>
            canonicalScriptMatchKey(m.scriptNumber) ===
            canonicalScriptMatchKey(nextLevel.scriptNumber)
        );
        const isMainMod =
          mod &&
          (canonicalScriptMatchKey(mod.scriptNumber) === 'main' ||
            (mod.isMaster && /^(?:main|start|master(?:script)?)$/i.test(mod.scriptNumber)));
        setDiagramTitle(
          isMainMod
            ? 'Main (Einstiegsskript)'
            : mod
            ? formatScriptDisplayLabel(mod)
            : `Skript ${nextLevel.scriptNumber}`
        );
      }
      setSelectedCallflowNodeId(null);
      setIsolateSubgraphMode(false);
      setIsVisualEditMode(true);
      pendingAutoFitRef.current = true;
      setZoom(1);
      setPan({ x: 0, y: 0 });
      if (switchToMobilePreview) {
        setMobileActivePane('preview');
      }
    },
    [scriptWorkspace, currentDirection, masterDensityMode, handleReturnToWelcomeScreen]
  );

  const refreshDiagramFromWorkspace = useCallback(
    (nextWs: ScriptWorkspace, levelOverride?: CallflowViewLevel) => {
      if (nextWs.modules.length === 0) return;
      const targetLevel = levelOverride || callflowViewLevel;
      if (targetLevel.level === 'welcome' && !levelOverride) {
        return;
      }
      const effectiveLevel: CallflowViewLevel =
        targetLevel.level === 'detail' &&
        !nextWs.modules.some(
          (m) =>
            canonicalScriptMatchKey(m.scriptNumber) ===
            canonicalScriptMatchKey(targetLevel.scriptNumber)
        )
          ? { level: 'master' }
          : targetLevel;
      const dir = currentDirection || 'LR';
      const effectiveCompact =
        masterDensityMode === 'compact' ||
        (masterDensityMode === 'auto' && nextWs.modules.length >= 16);
      const nextCode =
        effectiveLevel.level === 'detail'
          ? buildScriptDetailMermaid(nextWs, effectiveLevel.scriptNumber, dir)
          : buildMasterOverviewMermaid(nextWs, dir, { compact: effectiveCompact });

      if (effectiveLevel.level !== callflowViewLevel.level) {
        setCallflowViewLevel(effectiveLevel);
      }
      setCode(nextCode);
      if (effectiveLevel.level === 'master') {
        setDiagramTitle(`Master-Gesamtkarte (${nextWs.modules.length} Skripte)`);
      } else if (effectiveLevel.level === 'detail') {
        const mod = nextWs.modules.find(
          (m) =>
            canonicalScriptMatchKey(m.scriptNumber) ===
            canonicalScriptMatchKey(effectiveLevel.scriptNumber)
        );
        const isMainMod =
          mod &&
          (canonicalScriptMatchKey(mod.scriptNumber) === 'main' ||
            (mod.isMaster && /^(?:main|start|master(?:script)?)$/i.test(mod.scriptNumber)));
        setDiagramTitle(
          isMainMod
            ? 'Main (Einstiegsskript)'
            : mod
            ? formatScriptDisplayLabel(mod)
            : `Skript ${effectiveLevel.scriptNumber}`
        );
      }
    },
    [callflowViewLevel, currentDirection, masterDensityMode]
  );

  const openMultiScriptModalWithPrefill = useCallback((scriptNumber?: string) => {
    setMultiScriptPrefillNumber(scriptNumber || null);
    setIsMultiScriptModalOpen(true);
  }, []);

  const handleResolveCallflowIssue = useCallback(
    (
      issue: CallflowOpenIssue,
      action: {
        resolution: CallflowIssueResolution;
        linkedTargetNumber?: string;
        linkLabel?: string;
        note?: string;
      }
    ): ScriptWorkspace => {
      const nextWs = applyIssueResolutionToWorkspace(scriptWorkspace, issue, action);
      setScriptWorkspace(nextWs);
      refreshDiagramFromWorkspace(nextWs);
      return nextWs;
    },
    [scriptWorkspace, refreshDiagramFromWorkspace]
  );

  const handleReopenCallflowIssue = useCallback(
    (issue: CallflowOpenIssue) => {
      const nextWs = reopenIssueInWorkspace(scriptWorkspace, issue);
      setScriptWorkspace(nextWs);
      refreshDiagramFromWorkspace(nextWs);
    },
    [scriptWorkspace, refreshDiagramFromWorkspace]
  );

  const handleUnignoreChecklistTarget = useCallback(
    (targetRef: string) => {
      const nextWs = unignoreChecklistTargetInWorkspace(scriptWorkspace, targetRef);
      setScriptWorkspace(nextWs);
      refreshDiagramFromWorkspace(nextWs);
    },
    [scriptWorkspace, refreshDiagramFromWorkspace]
  );

  const handleAddManualCallflowQuestion = useCallback(
    (scriptNumber: string, question: string) => {
      const cleanQ = question.trim();
      if (!cleanQ) return;
      const cleanNum = scriptNumber.trim();
      const sourceNum =
        cleanNum ||
        scriptWorkspace.masterScriptNumber ||
        scriptWorkspace.modules[0]?.scriptNumber ||
        'Main';
      const newIssue: CallflowOpenIssue = {
        id: `manual:${sourceNum}:${Date.now()}`,
        type: 'manual-question',
        status: 'open',
        sourceScriptNumber: sourceNum,
        title: cleanNum ? `Rückfrage zu [${cleanNum}]` : 'Offene Callflow-Rückfrage',
        question: cleanQ,
        isManual: true,
        createdAt: Date.now(),
      };
      const nextWs = buildScriptWorkspace(scriptWorkspace.modules, {
        ...scriptWorkspace,
        manualQuestions: [...(scriptWorkspace.manualQuestions || []), newIssue],
      });
      setScriptWorkspace(nextWs);
      refreshDiagramFromWorkspace(nextWs);
    },
    [scriptWorkspace, refreshDiagramFromWorkspace]
  );

  const handleSelectMasterScript = useCallback(
    (scriptNumber: string) => {
      const nextWs = buildScriptWorkspace(scriptWorkspace.modules, {
        ...scriptWorkspace,
        masterScriptNumber: normalizeScriptRef(scriptNumber),
      });
      setScriptWorkspace(nextWs);
    },
    [scriptWorkspace]
  );

  const handleSubmitChecklistDetailScript = useCallback(
    (targetRef: string, rawText: string, origin: ScriptOrigin): ScriptWorkspace | null => {
      const trimmed = rawText.trim();
      if (!trimmed) return null;
      const isAutoStart = !targetRef || targetRef === '__auto__';
      const normalizedTarget = isAutoStart ? '' : normalizeScriptRef(targetRef);
      const wasEmpty = scriptWorkspace.modules.length === 0;
      const treatAsEntryMain =
        wasEmpty || isAutoStart || canonicalScriptMatchKey(normalizedTarget) === 'main';

      const incoming = parseCallflowTextWithFallback(trimmed, {
        defaultScriptNumber: normalizedTarget || undefined,
        defaultScriptName: normalizedTarget || undefined,
        origin,
        isMasterHint: treatAsEntryMain,
      });

      const hasRulesOrAnnouncement = incoming.some(
        (m) => m.rules.length > 0 || Boolean(m.isAnnouncementEndpoint)
      );
      if (incoming.length === 0 || !hasRulesOrAnnouncement) return null;

      const targetKey = canonicalScriptMatchKey(
        normalizedTarget || incoming[0].scriptNumber
      );
      const nextIgnored = (scriptWorkspace.ignoredChecklistTargets || []).filter(
        (t) => canonicalScriptMatchKey(t) !== targetKey
      );
      let merged = mergeScriptModules(scriptWorkspace.modules, incoming);
      if (wasEmpty) {
        merged = promoteEntryModuleToMain(merged, incoming[0].scriptNumber);
      }
      const nextWs = buildScriptWorkspace(merged, {
        ...scriptWorkspace,
        masterScriptNumber: wasEmpty ? 'Main' : scriptWorkspace.masterScriptNumber,
        ignoredChecklistTargets: nextIgnored,
      });
      if (wasEmpty) {
        pendingAutoFitRef.current = true;
        setIsVisualEditMode(true);
      }
      setScriptWorkspace(nextWs);
      refreshDiagramFromWorkspace(nextWs);

      // If a script folder pool is already assigned, automatically resolve connected .s scripts recursively!
      if (assignedFolderPool && assignedFolderPool.entries.length > 0) {
        setIsAutoResolvingFolder(true);
        void autoResolveConnectedScriptsFromFolder(merged, assignedFolderPool, {
          externalEndpoints: nextWs.externalEndpoints,
          ignoredChecklistTargets: nextWs.ignoredChecklistTargets,
          masterScriptNumber: nextWs.masterScriptNumber,
        })
          .then((summary) => {
            setLastFolderResolveSummary(summary);
            const combinedEndpoints = Array.from(
              new Set([...(nextWs.externalEndpoints || []), ...summary.unmatchedTargetRefs])
            );
            const autoWs = buildScriptWorkspace(summary.modules, {
              ...nextWs,
              externalEndpoints: combinedEndpoints,
              masterScriptNumber: nextWs.masterScriptNumber,
              treatUnresolvedAsEndpoint: true,
            });
            setScriptWorkspace(autoWs);
            refreshDiagramFromWorkspace(autoWs);
          })
          .finally(() => {
            setIsAutoResolvingFolder(false);
          });
      }

      return nextWs;
    },
    [scriptWorkspace, assignedFolderPool, refreshDiagramFromWorkspace]
  );

  const handleSubmitChecklistVisioFile = useCallback(
    async (targetRef: string, file: File): Promise<ScriptWorkspace | null> => {
      const isAutoStart = !targetRef || targetRef === '__auto__';
      const normalizedTarget = isAutoStart ? '' : normalizeScriptRef(targetRef);
      const wasEmpty = scriptWorkspace.modules.length === 0;
      const treatAsEntryMain =
        wasEmpty || isAutoStart || canonicalScriptMatchKey(normalizedTarget) === 'main';
      try {
        const result = await importCallflowFile(file, {
          overridePrimaryScriptNumber: normalizedTarget || undefined,
          overridePrimaryScriptName: normalizedTarget || undefined,
          isMasterHint: treatAsEntryMain,
        });
        if (result.modules.length === 0) return null;
        const targetKey = canonicalScriptMatchKey(
          normalizedTarget || result.modules[0].scriptNumber
        );
        const nextIgnored = (scriptWorkspace.ignoredChecklistTargets || []).filter(
          (t) => canonicalScriptMatchKey(t) !== targetKey
        );
        let merged = mergeScriptModules(scriptWorkspace.modules, result.modules);
        if (wasEmpty) {
          merged = promoteEntryModuleToMain(merged, result.modules[0].scriptNumber);
        }
        const effectiveMaster = wasEmpty ? 'Main' : scriptWorkspace.masterScriptNumber;

        let nextExternalEndpoints = [...(scriptWorkspace.externalEndpoints || [])];
        if (assignedFolderPool && assignedFolderPool.entries.length > 0) {
          setIsAutoResolvingFolder(true);
          try {
            const summary = await autoResolveConnectedScriptsFromFolder(
              merged,
              assignedFolderPool,
              {
                externalEndpoints: scriptWorkspace.externalEndpoints,
                ignoredChecklistTargets: nextIgnored,
                masterScriptNumber: effectiveMaster,
              }
            );
            merged = summary.modules;
            nextExternalEndpoints = Array.from(
              new Set([...nextExternalEndpoints, ...summary.unmatchedTargetRefs])
            );
            setLastFolderResolveSummary(summary);
          } finally {
            setIsAutoResolvingFolder(false);
          }
        }

        const nextWs = buildScriptWorkspace(merged, {
          ...scriptWorkspace,
          externalEndpoints: nextExternalEndpoints,
          masterScriptNumber: effectiveMaster,
          ignoredChecklistTargets: nextIgnored,
          treatUnresolvedAsEndpoint:
            Boolean(assignedFolderPool && assignedFolderPool.entries.length > 0) ||
            merged.length >= 2,
        });
        if (wasEmpty) {
          pendingAutoFitRef.current = true;
          setIsVisualEditMode(true);
        }
        setScriptWorkspace(nextWs);
        refreshDiagramFromWorkspace(nextWs);
        return nextWs;
      } catch {
        return null;
      }
    },
    [scriptWorkspace, assignedFolderPool, refreshDiagramFromWorkspace]
  );

  const showCanvasDropBanner = useCallback(
    (kind: 'success' | 'error', message: string) => {
      if (canvasFileNoticeTimerRef.current !== null) {
        window.clearTimeout(canvasFileNoticeTimerRef.current);
      }
      setCanvasFileDropNotice({ kind, message });
      canvasFileNoticeTimerRef.current = window.setTimeout(() => {
        setCanvasFileDropNotice(null);
        canvasFileNoticeTimerRef.current = null;
      }, 4500);
    },
    []
  );

  const handleAssignFolderAndAutoResolve = useCallback(
    async (files: FileList | File[]) => {
      const pool = indexScriptFolderFiles(files);
      if (pool.entries.length === 0) {
        showCanvasDropBanner(
          'error',
          'Im gewählten Ordner wurden keine unterstützten Skriptdateien (.s, .txt, .aacc, .vsdx) gefunden.'
        );
        return;
      }
      setAssignedFolderPool(pool);

      if (scriptWorkspace.modules.length === 0) {
        showCanvasDropBanner(
          'success',
          `Ordner „${pool.folderName}“ mit ${pool.totalFilesScanned} Skript-Dateien verbunden. Wählen Sie rechts Ihr Einstiegsskript (Main) aus.`
        );
        return;
      }

      setIsAutoResolvingFolder(true);
      try {
        const summary = await autoResolveConnectedScriptsFromFolder(
          scriptWorkspace.modules,
          pool,
          {
            externalEndpoints: scriptWorkspace.externalEndpoints,
            ignoredChecklistTargets: scriptWorkspace.ignoredChecklistTargets,
            masterScriptNumber: scriptWorkspace.masterScriptNumber,
          }
        );
        setLastFolderResolveSummary(summary);

        const combinedEndpoints = Array.from(
          new Set([...(scriptWorkspace.externalEndpoints || []), ...summary.unmatchedTargetRefs])
        );

        const nextWs = buildScriptWorkspace(summary.modules, {
          externalEndpoints: combinedEndpoints,
          ignoredChecklistTargets: scriptWorkspace.ignoredChecklistTargets,
          resolvedIssues: scriptWorkspace.resolvedIssues,
          manualQuestions: scriptWorkspace.manualQuestions,
          manualLinks: scriptWorkspace.manualLinks,
          masterScriptNumber: scriptWorkspace.masterScriptNumber,
          nodeOffsets: scriptWorkspace.nodeOffsets,
          treatUnresolvedAsEndpoint: true,
        });

        pendingAutoFitRef.current = true;
        setScriptWorkspace(nextWs);
        refreshDiagramFromWorkspace(nextWs);

        showCanvasDropBanner(
          'success',
          `Ordner „${pool.folderName}“ abgeglichen: ${summary.loadedScriptNumbers.length} aktive Folgeskripte (.s) automatisch entlang der Kette geladen · ${summary.skippedLegacyFilesCount} Altlast-Dateien übersprungen.`
        );
      } finally {
        setIsAutoResolvingFolder(false);
      }
    },
    [scriptWorkspace, refreshDiagramFromWorkspace, showCanvasDropBanner]
  );

  const handleSelectStartScriptFromAssignedFolder = useCallback(
    async (entry: FolderScriptFileEntry) => {
      if (!assignedFolderPool) return;
      setIsAutoResolvingFolder(true);
      try {
        const startRes = await importCallflowFile(entry.file, {
          isMasterHint: true,
        });
        if (startRes.modules.length === 0) {
          showCanvasDropBanner(
            'error',
            `In „${entry.filename}“ konnten keine Callflow-Regeln erkannt werden.`
          );
          return;
        }
        const normalizedModules = promoteEntryModuleToMain(
          startRes.modules,
          startRes.modules[0].scriptNumber
        );
        const primaryNumber = 'Main';
        const summary = await autoResolveConnectedScriptsFromFolder(
          normalizedModules,
          assignedFolderPool,
          {
            masterScriptNumber: primaryNumber,
          }
        );
        setLastFolderResolveSummary(summary);

        const nextWs = buildScriptWorkspace(summary.modules, {
          externalEndpoints: summary.unmatchedTargetRefs,
          masterScriptNumber: primaryNumber,
          treatUnresolvedAsEndpoint: true,
        });
        pendingAutoFitRef.current = true;
        setIsVisualEditMode(true);
        setScriptWorkspace(nextWs);
        refreshDiagramFromWorkspace(nextWs);
        showCanvasDropBanner(
          'success',
          `Einstiegsskript Main (aus „${entry.filename}“) + ${summary.loadedScriptNumbers.length} verknüpfte .s-Skripte automatisch geladen (${summary.skippedLegacyFilesCount} Altlasten ignoriert).`
        );
      } finally {
        setIsAutoResolvingFolder(false);
      }
    },
    [assignedFolderPool, refreshDiagramFromWorkspace, showCanvasDropBanner]
  );

  const handleClearAssignedFolder = useCallback(() => {
    setAssignedFolderPool(null);
    setLastFolderResolveSummary(null);
  }, []);

  const handleCanvasFilesDrop = useCallback(
    async (files: FileList | File[], isDirectoryDrop = false) => {
      const fileArr = Array.from(files);
      if (fileArr.length === 0) return;

      // If the user drops a folder (or a large batch of >12 .s files from a folder),
      // use intelligent folder matching so 600+ legacy files aren't dumped blindly onto the canvas!
      if (isDirectoryDrop || fileArr.length > 12) {
        await handleAssignFolderAndAutoResolve(fileArr);
        return;
      }

      const supportedFiles = fileArr.filter((f) => isSupportedCallflowImportFilename(f.name));
      const filesToRead = supportedFiles.length > 0 ? supportedFiles : fileArr;

      const wasEmpty = scriptWorkspace.modules.length === 0;
      let currentModules = [...scriptWorkspace.modules];
      let importedModuleCount = 0;
      let dotSCount = 0;
      let visioCount = 0;
      const failedNames: string[] = [];

      for (let i = 0; i < filesToRead.length; i++) {
        const file = filesToRead[i];
        try {
          const result = await importCallflowFile(file, {
            isMasterHint: wasEmpty && currentModules.length === 0 && i === 0,
          });
          if (result.modules.length > 0) {
            currentModules = mergeScriptModules(currentModules, result.modules);
            importedModuleCount += result.modules.length;
            if (result.sourceKind === 'aacc-s') dotSCount++;
            if (result.sourceKind === 'visio') visioCount++;
          } else {
            failedNames.push(file.name);
          }
        } catch {
          failedNames.push(file.name);
        }
      }

      if (importedModuleCount === 0) {
        showCanvasDropBanner(
          'error',
          `Keine Avaya .s-Befehle, Regeln oder Visio-Formen in ${
            failedNames.length > 0 ? failedNames.join(', ') : 'den abgelegten Dateien'
          } erkannt.`
        );
        return;
      }

      if (wasEmpty && currentModules.length > 0) {
        currentModules = promoteEntryModuleToMain(currentModules, currentModules[0].scriptNumber);
      }

      let autoLoadedFromFolderCount = 0;
      let nextExternalEndpoints = [...(scriptWorkspace.externalEndpoints || [])];
      if (assignedFolderPool && assignedFolderPool.entries.length > 0) {
        const summary = await autoResolveConnectedScriptsFromFolder(
          currentModules,
          assignedFolderPool,
          {
            externalEndpoints: scriptWorkspace.externalEndpoints,
            ignoredChecklistTargets: scriptWorkspace.ignoredChecklistTargets,
            masterScriptNumber: wasEmpty ? 'Main' : scriptWorkspace.masterScriptNumber,
          }
        );
        currentModules = summary.modules;
        autoLoadedFromFolderCount = summary.loadedScriptNumbers.length;
        nextExternalEndpoints = Array.from(
          new Set([...nextExternalEndpoints, ...summary.unmatchedTargetRefs])
        );
        setLastFolderResolveSummary(summary);
      }

      const nextWs = buildScriptWorkspace(currentModules, {
        externalEndpoints: nextExternalEndpoints,
        ignoredChecklistTargets: scriptWorkspace.ignoredChecklistTargets,
        resolvedIssues: scriptWorkspace.resolvedIssues,
        manualQuestions: scriptWorkspace.manualQuestions,
        manualLinks: scriptWorkspace.manualLinks,
        masterScriptNumber: wasEmpty ? 'Main' : scriptWorkspace.masterScriptNumber,
        nodeOffsets: scriptWorkspace.nodeOffsets,
        treatUnresolvedAsEndpoint:
          Boolean(assignedFolderPool && assignedFolderPool.entries.length > 0) ||
          currentModules.length >= 2,
      });

      if (wasEmpty) {
        pendingAutoFitRef.current = true;
        setIsVisualEditMode(true);
        if (workspaceMode === 'guided' && guidedStep === 1) {
          setGuidedStep(2);
        }
      }

      setScriptWorkspace(nextWs);
      refreshDiagramFromWorkspace(nextWs);

      const kindParts: string[] = [];
      if (dotSCount > 0) kindParts.push(`${dotSCount} .s-Skript`);
      if (visioCount > 0) kindParts.push(`${visioCount} Visio`);
      const kindSuffix = kindParts.length > 0 ? ` (${kindParts.join(', ')})` : '';
      const autoFolderSuffix =
        autoLoadedFromFolderCount > 0
          ? ` + ${autoLoadedFromFolderCount} verknüpfte .s automatisch aus Ordner geladen`
          : '';
      const failedSuffix =
        failedNames.length > 0 ? ` · ${failedNames.length} nicht lesbar` : '';
      showCanvasDropBanner(
        'success',
        `${filesToRead.length} Datei(en) mit ${importedModuleCount} Modul(en)${kindSuffix}${autoFolderSuffix} in den Callflow importiert${failedSuffix}.`
      );
    },
    [
      scriptWorkspace,
      assignedFolderPool,
      workspaceMode,
      guidedStep,
      handleAssignFolderAndAutoResolve,
      refreshDiagramFromWorkspace,
      showCanvasDropBanner,
    ]
  );

  const handleAddBuildingBlock = useCallback(
    (
      blockType: CallflowBuildingBlockType,
      connectFromNodeId?: string | null,
      initialOffset?: NodePositionOffset
    ) => {
      if (scriptWorkspace.modules.length === 0 && code.trim() && !looksLikeRawCallflowScript(code)) {
        // Free Mode raw Mermaid diagram: append a typed node to the Mermaid code
        skipAutoConvertRef.current = true;
        const idx = callflowGraph.nodes.size + 1;
        const newNodeId = `N_${blockType}_${idx}`;
        const shapeLine =
          blockType === 'condition'
            ? `    ${newNodeId}{{"Zeit- / IF-Weiche ${idx}"}}`
            : blockType === 'queue'
            ? `    ${newNodeId}[("Queue / Skillset ${idx}")]`
            : blockType === 'external'
            ? `    ${newNodeId}(["■ Externes Ziel ${idx}"])`
            : `    ${newNodeId}["${
                blockType === 'announcement'
                  ? `Ansage / RAN ${idx}`
                  : blockType === 'dtmf'
                  ? `DTMF-Menü ${idx}`
                  : `Teil-Skript ${idx}`
              }"]`;
        const edgeLine = connectFromNodeId
          ? `\n    ${connectFromNodeId} --> ${newNodeId}`
          : '';
        setCode((prev) => `${prev.trimEnd()}\n${shapeLine}${edgeLine}\n`);
        if (initialOffset) {
          setStandaloneNodeOffsets((prev) => ({
            ...prev,
            [newNodeId]: initialOffset,
          }));
        }
        setSelectedCallflowNodeId(newNodeId);
        return;
      }

      const effectiveConnectFrom =
        connectFromNodeId ?? selectedCallflowNodeId ?? null;
      const { workspace: nextWs, createdNodeId } = addBuildingBlockToWorkspace(
        scriptWorkspace,
        callflowViewLevel,
        {
          type: blockType,
          connectFromNodeId: effectiveConnectFrom,
          initialOffset,
        }
      );
      setScriptWorkspace(nextWs);
      refreshDiagramFromWorkspace(nextWs);
      setSelectedCallflowNodeId(createdNodeId);
    },
    [
      scriptWorkspace,
      code,
      callflowGraph.nodes.size,
      selectedCallflowNodeId,
      callflowViewLevel,
      refreshDiagramFromWorkspace,
    ]
  );

  const handleSaveNodeInlineEdits = useCallback(
    (
      snapshot: EditableCallflowNodeSnapshot,
      updates: {
        scriptNumber: string;
        title: string;
        blockType: CallflowBuildingBlockType;
        announcement: string;
        queueTarget: string;
        schedule: string;
        condition: string;
        outgoingConnections: EditableNodeConnectionItem[];
      }
    ) => {
      if (snapshot.mode === 'raw-mermaid') {
        skipAutoConvertRef.current = true;
        const safeLabel = updates.title.replace(/"/g, "'");
        setCode((prev) => {
          const idEsc = snapshot.nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const labelRegex = new RegExp(
            `(\\b${idEsc}\\s*(?:\\[\\"|\\(\\[\\"|\\{\\{\\"|\\[\\(\\"|\\[))([^"\\]\\)\\}]+)((?:\\"\\]|\\"\\]\\)|\\"\\}\\}|\\"\\)\\]|\\]))`
          );
          if (labelRegex.test(prev)) {
            return prev.replace(labelRegex, `$1${safeLabel}$3`);
          }
          return `${prev.trimEnd()}\n    ${snapshot.nodeId}["${safeLabel}"]\n`;
        });
        return;
      }

      const nextWs = updateWorkspaceNodeFromEdit(
        scriptWorkspace,
        callflowViewLevel,
        snapshot,
        updates
      );
      setScriptWorkspace(nextWs);
      refreshDiagramFromWorkspace(nextWs);
    },
    [scriptWorkspace, callflowViewLevel, refreshDiagramFromWorkspace]
  );

  const handleDeleteNodeFromCanvas = useCallback(
    (nodeId: string) => {
      if (scriptWorkspace.modules.length === 0) {
        skipAutoConvertRef.current = true;
        const idEsc = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const lineRegex = new RegExp(`^.*\\b${idEsc}\\b.*$`, 'gm');
        setCode((prev) =>
          prev
            .replace(lineRegex, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
        );
        setSelectedCallflowNodeId(null);
        return;
      }

      const nextWs = deleteNodeFromWorkspace(
        scriptWorkspace,
        callflowViewLevel,
        nodeId
      );
      setScriptWorkspace(nextWs);
      refreshDiagramFromWorkspace(nextWs);
      setSelectedCallflowNodeId(null);
    },
    [scriptWorkspace, callflowViewLevel, refreshDiagramFromWorkspace]
  );

  const handleApplyRecentConnectionLabel = useCallback(
    (customLabel: string) => {
      if (!recentConnectionBanner) return;
      const clean = customLabel.trim();
      if (!clean) {
        setRecentConnectionBanner(null);
        return;
      }
      if (scriptWorkspace.modules.length > 0) {
        const nextWs = updateEdgeLabelInWorkspace(
          scriptWorkspace,
          callflowViewLevel,
          recentConnectionBanner.fromNodeId,
          recentConnectionBanner.toNodeId,
          clean
        );
        setScriptWorkspace(nextWs);
        refreshDiagramFromWorkspace(nextWs);
      } else {
        skipAutoConvertRef.current = true;
        setCode((prev) =>
          updateEdgeLabelInMermaidCode(
            prev,
            recentConnectionBanner.fromNodeId,
            recentConnectionBanner.toNodeId,
            clean
          )
        );
      }
      setRecentConnectionBanner(null);
    },
    [recentConnectionBanner, scriptWorkspace, callflowViewLevel, refreshDiagramFromWorkspace]
  );

  const handleDisconnectEdgeEndpoints = useCallback(
    (fromNodeId: string, toNodeId: string) => {
      if (!fromNodeId || !toNodeId) return;
      if (scriptWorkspace.modules.length > 0) {
        const nextWs = disconnectEdgeInWorkspace(
          scriptWorkspace,
          callflowViewLevel,
          fromNodeId,
          toNodeId
        );
        setScriptWorkspace(nextWs);
        refreshDiagramFromWorkspace(nextWs);
      } else {
        skipAutoConvertRef.current = true;
        setCode((prev) =>
          disconnectEdgeInMermaidCode(prev, fromNodeId, toNodeId)
        );
      }
      setSelectedCallflowEdge((prev) =>
        prev && prev.from === fromNodeId && prev.to === toNodeId ? null : prev
      );
      lastHoverLockKeyRef.current = '';
    },
    [scriptWorkspace, callflowViewLevel, refreshDiagramFromWorkspace]
  );

  const handleDisconnectSelectedEdge = useCallback(() => {
    if (!selectedCallflowEdge) return;
    handleDisconnectEdgeEndpoints(selectedCallflowEdge.from, selectedCallflowEdge.to);
  }, [selectedCallflowEdge, handleDisconnectEdgeEndpoints]);

  const handleSaveSelectedEdgeLabel = useCallback(
    (overrideLabel?: string) => {
      if (!selectedCallflowEdge) return;
      const clean = (overrideLabel ?? selectedCallflowEdge.labelDraft).trim();
      if (!clean) return;
      if (scriptWorkspace.modules.length > 0) {
        const nextWs = updateEdgeLabelInWorkspace(
          scriptWorkspace,
          callflowViewLevel,
          selectedCallflowEdge.from,
          selectedCallflowEdge.to,
          clean
        );
        setScriptWorkspace(nextWs);
        refreshDiagramFromWorkspace(nextWs);
      } else {
        skipAutoConvertRef.current = true;
        setCode((prev) =>
          updateEdgeLabelInMermaidCode(
            prev,
            selectedCallflowEdge.from,
            selectedCallflowEdge.to,
            clean
          )
        );
      }
      setSelectedCallflowEdge((prev) =>
        prev ? { ...prev, label: clean, labelDraft: clean } : null
      );
    },
    [selectedCallflowEdge, scriptWorkspace, callflowViewLevel, refreshDiagramFromWorkspace]
  );

  const handleStartNewCallflow = useCallback(
    (payload: {
      title: string;
      workspace: ScriptWorkspace;
      folderPool?: FolderScriptPool | null;
      folderSummary?: FolderAutoResolveSummary | null;
    }) => {
      skipAutoConvertRef.current = false;
      setRawScriptDraft(null);
      setIsConfirmingClearWorkspace(false);
      if (payload.folderPool !== undefined) {
        setAssignedFolderPool(payload.folderPool);
      }
      if (payload.folderSummary !== undefined) {
        setLastFolderResolveSummary(payload.folderSummary);
      }
      setScriptWorkspace(payload.workspace);
      setGuidedStep(2);
      setIsVisualEditMode(true);
      pendingAutoFitRef.current = true;
      handleSwitchCallflowViewLevel({ level: 'master' }, payload.workspace, true);
      if (payload.title) {
        setDiagramTitle(payload.title);
      }
      setRightSidebarTab('callflow');
      setIsRightPanelOpen(true);
    },
    [handleSwitchCallflowViewLevel]
  );

  // Automatic local conversion of raw Callflow / AACC script text (no external AI needed)
  const convertRawScriptTextInEditor = useCallback(
    (rawText: string, mode: 'replace' | 'merge' = 'replace'): boolean => {
      const parsed = parseCallflowTextWithFallback(rawText, {
        origin: 'legacy-text',
      });
      if (parsed.length === 0) return false;

      const combinedModules =
        mode === 'merge' ? mergeScriptModules(scriptWorkspace.modules, parsed) : parsed;
      const nextWs = buildScriptWorkspace(
        combinedModules,
        mode === 'merge'
          ? {
              ...scriptWorkspace,
              treatUnresolvedAsEndpoint:
                scriptWorkspace.treatUnresolvedAsEndpoint || combinedModules.length >= 2,
            }
          : {
              treatUnresolvedAsEndpoint: combinedModules.length >= 2,
            }
      );
      skipAutoConvertRef.current = false;
      setRawScriptDraft({
        rawText,
        moduleCount: nextWs.modules.length,
        ruleCount: nextWs.modules.reduce((sum, m) => sum + m.rules.length, 0),
      });
      setScriptWorkspace(nextWs);
      setIsVisualEditMode(true);
      pendingAutoFitRef.current = true;
      handleSwitchCallflowViewLevel({ level: 'master' }, nextWs);
      return true;
    },
    [scriptWorkspace, handleSwitchCallflowViewLevel]
  );

  const handleEditorPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData?.getData('text');
    if (!pasted) return;
    const target = e.currentTarget;
    const start = target.selectionStart ?? code.length;
    const end = target.selectionEnd ?? code.length;
    const candidateFullText = code.substring(0, start) + pasted + code.substring(end);
    const isReplacingAll = start === 0 && end === code.length;
    const textToInspect = isReplacingAll || !code.trim() ? candidateFullText : pasted;

    if (looksLikeRawCallflowScript(textToInspect)) {
      e.preventDefault();
      skipAutoConvertRef.current = false;
      if (isReplacingAll || !code.trim() || looksLikeRawCallflowScript(candidateFullText)) {
        convertRawScriptTextInEditor(candidateFullText, 'replace');
      } else {
        convertRawScriptTextInEditor(pasted, 'merge');
      }
    }
  };

  useEffect(() => {
    if (skipAutoConvertRef.current) return;
    if (!looksLikeRawCallflowScript(code)) return;
    const timer = window.setTimeout(() => {
      if (skipAutoConvertRef.current) return;
      if (looksLikeRawCallflowScript(code)) {
        convertRawScriptTextInEditor(code, 'replace');
      }
    }, 550);
    return () => window.clearTimeout(timer);
  }, [code, convertRawScriptTextInEditor]);

  // Local Storage Saved Diagrams management
  const handleSaveCurrentDiagram = (title: string) => {
    const newEntry: SavedDiagram = {
      id: `local-${Date.now()}`,
      title,
      code,
      updatedAt: Date.now(),
      themeConfig,
      scriptWorkspace: scriptWorkspace.modules.length > 0 ? scriptWorkspace : undefined,
    };
    const updated = [newEntry, ...savedDiagrams];
    setSavedDiagrams(updated);
    setDiagramTitle(title);
    writeStudioStorage(STORAGE_KEYS.SAVED_LIST, JSON.stringify(updated));
  };

  const handleLoadSavedDiagram = (saved: SavedDiagram) => {
    skipAutoConvertRef.current = false;
    setRawScriptDraft(null);
    const hasModules =
      saved.scriptWorkspace &&
      Array.isArray(saved.scriptWorkspace.modules) &&
      saved.scriptWorkspace.modules.length > 0;
    if (hasModules && saved.scriptWorkspace) {
      setScriptWorkspace(
        buildScriptWorkspace(saved.scriptWorkspace.modules, saved.scriptWorkspace)
      );
      setCode('');
    } else {
      setScriptWorkspace(buildScriptWorkspace([]));
      setCode(saved.code);
    }
    setCallflowViewLevel(
      hasModules || saved.code.trim().length > 0 ? { level: 'welcome' } : { level: 'master' }
    );
    setBaseRenderedSvg(null);
    hasBaseRenderedSvgRef.current = false;
    setDiagramTitle(saved.title);
    if (saved.themeConfig) {
      setThemeConfig({ ...DEFAULT_THEME_CONFIG, ...saved.themeConfig });
    }
    setSelectedCallflowNodeId(null);
    setIsolateSubgraphMode(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMobileActivePane('preview');
  };

  const handleDeleteSavedDiagram = (id: string) => {
    const updated = savedDiagrams.filter((item) => item.id !== id);
    setSavedDiagrams(updated);
    writeStudioStorage(STORAGE_KEYS.SAVED_LIST, JSON.stringify(updated));
  };

  const handleImportFileContent = (title: string, importedCode: string) => {
    if (looksLikeRawCallflowScript(importedCode)) {
      if (convertRawScriptTextInEditor(importedCode, 'replace')) {
        return;
      }
    }
    skipAutoConvertRef.current = false;
    setRawScriptDraft(null);
    setScriptWorkspace(buildScriptWorkspace([]));
    setCallflowViewLevel({ level: 'master' });
    setDiagramTitle(title);
    setCode(importedCode);
    setSelectedCallflowNodeId(null);
    setIsolateSubgraphMode(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMobileActivePane('preview');
  };

  // Direct 1-Click SVG, PNG & Interactive HTML downloads (bake offsets/spotlight on demand)
  const handleQuickDownloadSvg = () => {
    const exportSvg = buildExportSvgSnapshot(true);
    if (!exportSvg) return;
    const { serializedSvg } = prepareStandaloneSvg(exportSvg, canvasSurface, 32);
    const blob = new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' });
    const safeName =
      diagramTitle.toLowerCase().replace(/[^a-z0-9äöüß_-]+/gi, '-') || 'mermaid-diagramm';
    triggerLocalDownload(blob, `${safeName}.svg`);
    setQuickDownloadFeedback('svg');
    setTimeout(() => setQuickDownloadFeedback(null), 2000);
  };

  const handleQuickDownloadPng = async () => {
    const exportSvg = buildExportSvgSnapshot(true);
    if (!exportSvg || isDownloadingPng) return;
    setIsDownloadingPng(true);
    try {
      const { blob } = await exportSvgToPngBlob(exportSvg, 2, canvasSurface, {
        code: effectiveMermaidCode,
        themeConfig,
        smartColorMode,
        hiddenNodeTypes: hiddenSmartNodeTypes,
        canvasSurface,
        pathColorMode,
      });
      const safeName =
        diagramTitle.toLowerCase().replace(/[^a-z0-9äöüß_-]+/gi, '-') || 'mermaid-diagramm';
      triggerLocalDownload(blob, `${safeName}-2x.png`);
      setQuickDownloadFeedback('png');
      setTimeout(() => setQuickDownloadFeedback(null), 2200);
    } catch {
      setIsExportModalOpen(true);
    } finally {
      setIsDownloadingPng(false);
    }
  };

  const cancelInteractiveHtmlExport = useCallback(() => {
    if (exportAbortControllerRef.current) {
      exportAbortControllerRef.current.abort();
    }
    setHtmlExportProgress(null);
    setIsDownloadingHtml(false);
    setHtmlExportNotice('Interaktiver HTML-Export abgebrochen.');
    window.setTimeout(() => {
      setHtmlExportNotice((prev) =>
        prev === 'Interaktiver HTML-Export abgebrochen.' ? null : prev
      );
    }, 2800);
  }, []);

  const buildInteractiveHtmlForSurface = useCallback(
    async (
      targetSurface: 'dark' | 'light',
      preferredInitialView?: PreferredInitialHtmlView
    ): Promise<{ html: string | null; aborted?: boolean; fallbackCount?: number; errorMessage?: string }> => {
      const exportThemeConfig: ThemeConfiguration =
        targetSurface === 'dark'
          ? {
              ...themeConfig,
              theme: themeConfig.useCustomColors ? themeConfig.theme : 'dark',
              background: '#0b0f19',
              lineColor: isColorDark(themeConfig.lineColor) ? '#818cf8' : themeConfig.lineColor,
            }
          : {
              ...themeConfig,
              theme: themeConfig.useCustomColors ? themeConfig.theme : 'default',
              background: '#ffffff',
              lineColor: !isColorDark(themeConfig.lineColor) ? '#475569' : themeConfig.lineColor,
            };

      // Single-diagram fallback mode (when no multi-script workspace is loaded)
      if (scriptWorkspace.modules.length === 0) {
        let currentExportSvg = buildExportSvgSnapshot(false);
        if (!currentExportSvg) {
          if (!code.trim()) return { html: null };
          const rendered = await renderLocalMermaidDiagram(
            code,
            themeConfig,
            shouldUseNativeSvgLabels(code),
            { timeoutMs: 10000 }
          );
          if (!rendered.svg) {
            return {
              html: null,
              errorMessage:
                rendered.validation.errorMessage ||
                'Das aktive Diagramm konnte nicht für den HTML-Export gerendert werden.',
            };
          }
          currentExportSvg = applySmartLogicColoring(
            rendered.svg,
            code,
            smartColorMode,
            targetSurface,
            themeConfig.lineColor,
            [],
            pathColorMode
          ).svg;
        }
        const rawUnfilteredSvg = baseRenderedSvg
          ? applyNodeOffsetsToSvg(
              applySmartLogicColoring(
                baseRenderedSvg,
                code,
                smartColorMode,
                targetSurface,
                exportThemeConfig.lineColor,
                [],
                pathColorMode
              ).svg,
              activeNodeOffsets,
              callflowGraph,
              false
            )
          : targetSurface !== canvasSurface
          ? applySmartLogicColoring(
              currentExportSvg,
              code,
              smartColorMode,
              targetSurface,
              exportThemeConfig.lineColor,
              [],
              pathColorMode
            ).svg
          : currentExportSvg;
        return {
          html: generateInteractiveCallflowHtml(
            diagramTitle || 'Callflow',
            rawUnfilteredSvg,
            callflowGraph,
            targetSurface,
            {
              initialPathColorMode: pathColorMode,
              initialHiddenNodeTypes: hiddenSmartNodeTypes,
              initialIsolateSubgraph: isolateSubgraphMode,
              analysis: null,
              globalSearchIndex: globalSearchEntries,
              simulationModel: null,
            }
          ),
        };
      }

      // Pause any background workspace preloader immediately so the render mutex is free
      if (preloadAbortControllerRef.current) {
        preloadAbortControllerRef.current.abort();
        preloadAbortControllerRef.current = null;
      }
      setPreloadProgress(null);

      const abortController = new AbortController();
      exportAbortControllerRef.current = abortController;
      const { signal } = abortController;
      let keepErrorModalOpen = false;

      const yieldFrame = () =>
        new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (!done) {
              done = true;
              resolve();
            }
          };
          const fallbackTimer = window.setTimeout(finish, 40);
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
              window.clearTimeout(fallbackTimer);
              finish();
            });
          }
        });
      const yieldMicroTick = () =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });

      const buildFallbackViewSvg = (label: string, reason: string): string => {
        const bg = targetSurface === 'dark' ? '#0f172a' : '#ffffff';
        const border = targetSurface === 'dark' ? '#334155' : '#cbd5e1';
        const titleFill = targetSurface === 'dark' ? '#f1f5f9' : '#0f172a';
        const subFill = targetSurface === 'dark' ? '#94a3b8' : '#475569';
        const badgeFill = targetSurface === 'dark' ? '#f59e0b' : '#b45309';
        const esc = (s: string) =>
          s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 220" width="760" height="220"><rect x="16" y="16" width="728" height="188" rx="14" fill="${bg}" stroke="${border}" stroke-width="1.5"/><text x="40" y="62" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" font-weight="600" fill="${badgeFill}">Fallback-Ansicht (Zeitlimit / Render-Schutz)</text><text x="40" y="96" font-family="ui-sans-serif, system-ui, sans-serif" font-size="18" font-weight="600" fill="${titleFill}">${esc(label.slice(0, 72))}</text><text x="40" y="132" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" fill="${subFill}">${esc(reason.slice(0, 96))}</text><text x="40" y="164" font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" fill="${subFill}">Alle Skriptdaten, Parameter und Verknüpfungen bleiben in der HTML-Analyse vollständig verfügbar.</text></svg>`;
      };

      const totalEstimatedViews = scriptWorkspace.modules.length + 2;
      const VIEW_TIMEOUT_MS = 10000;

      try {
        // 1. Open Status Popup immediately BEFORE any heavy workspace computation
        setHtmlExportNotice(null);
        setHtmlExportProgress({
          active: true,
          phase: 'preparing',
          current: 0,
          total: totalEstimatedViews,
          currentLabel: `Analyse-Index für ${scriptWorkspace.modules.length} Skripte wird erstellt…`,
          cacheHits: 0,
          fallbackCount: 0,
          lastWarning: null,
          errorMessage: null,
          timeoutSecondsPerView: Math.round(VIEW_TIMEOUT_MS / 1000),
        });
        await yieldFrame();
        if (signal.aborted) return { html: null, aborted: true };

        const registry = extractWorkspaceResourceRegistry(scriptWorkspace);
        await yieldMicroTick();
        if (signal.aborted) return { html: null, aborted: true };

        setHtmlExportProgress((prev) =>
          prev
            ? {
                ...prev,
                currentLabel: 'Logik-Prüfung, Öffnungszeiten & Routing-Matrix werden berechnet…',
              }
            : prev
        );
        await yieldFrame();
        if (signal.aborted) return { html: null, aborted: true };

        const healthFindings = analyzeWorkspaceLogicHealth(scriptWorkspace);
        const scheduleRows = buildWorkspaceScheduleOverview(scriptWorkspace);
        const routingMatrixRows = buildWorkspaceRoutingMatrix(scriptWorkspace);
        const inspectContext = createWorkspaceInspectContext(
          scriptWorkspace,
          healthFindings,
          registry.parametersByScript
        );
        const analysisPayload: InteractiveCallflowHtmlAnalysisPayload = {
          openIssues: scriptWorkspace.issues || [],
          healthFindings,
          scheduleRows,
          registry,
          routingMatrixRows,
          masterScriptNumber: scriptWorkspace.masterScriptNumber,
          parametersByScript: registry.parametersByScript,
        };
        await yieldMicroTick();
        if (signal.aborted) return { html: null, aborted: true };

        const dir = currentDirection || 'LR';
        setHtmlExportProgress((prev) =>
          prev
            ? {
                ...prev,
                currentLabel: 'Master-Gesamtkarten werden aufgebaut…',
              }
            : prev
        );
        await yieldFrame();
        if (signal.aborted) return { html: null, aborted: true };

        const viewSpecs: Array<{
          key: string;
          label: string;
          scriptNumber?: string;
          masterViewVariant?: 'compact' | 'detailed';
          viewLevel: CallflowViewLevel;
          mermaidCode: string;
        }> = [
          {
            key: 'master',
            label: `Ebene 1: Master-Gesamtkarte (${scriptWorkspace.modules.length} Skripte)`,
            masterViewVariant: 'compact',
            viewLevel: { level: 'master' },
            mermaidCode: buildMasterOverviewMermaid(scriptWorkspace, dir, {
              compact: true,
            }),
          },
          {
            key: 'master:detailed',
            label: `Ebene 1: Master-Gesamtkarte (${scriptWorkspace.modules.length} Skripte) (Voll-Detail)`,
            masterViewVariant: 'detailed',
            viewLevel: { level: 'master' },
            mermaidCode: buildMasterOverviewMermaid(scriptWorkspace, dir, {
              compact: false,
            }),
          },
        ];

        for (let mIdx = 0; mIdx < scriptWorkspace.modules.length; mIdx++) {
          if (signal.aborted) return { html: null, aborted: true };
          const mod = scriptWorkspace.modules[mIdx];
          const isMainMod =
            canonicalScriptMatchKey(mod.scriptNumber) === 'main' ||
            (mod.isMaster && /^(?:main|start|master(?:script)?)$/i.test(mod.scriptNumber));
          viewSpecs.push({
            key: `script:${mod.scriptNumber}`,
            label: `Ebene 2: ${isMainMod ? 'Main (Einstiegsskript)' : formatScriptDisplayLabel(mod)}`,
            scriptNumber: mod.scriptNumber,
            viewLevel: { level: 'detail', scriptNumber: mod.scriptNumber } as CallflowViewLevel,
            mermaidCode: buildScriptDetailMermaid(scriptWorkspace, mod.scriptNumber, dir),
          });
          if ((mIdx + 1) % 10 === 0) {
            await yieldMicroTick();
          }
        }

        const canReuseActiveCanvasSvg =
          Boolean(baseRenderedSvg) &&
          !isolateSubgraphMode &&
          exportThemeConfig.theme === themeConfig.theme &&
          exportThemeConfig.background === themeConfig.background &&
          exportThemeConfig.lineColor === themeConfig.lineColor;

        let cacheHits = 0;
        let fallbackCount = 0;
        let lastWarning: string | null = null;
        const dagreFallbackTheme: ThemeConfiguration = {
          ...exportThemeConfig,
          layoutEngine: 'dagre',
          look: 'classic',
        };

        const views: InteractiveCallflowHtmlView[] = [];
        for (let idx = 0; idx < viewSpecs.length; idx++) {
          if (signal.aborted) {
            return { html: null, aborted: true };
          }

          const spec = viewSpecs[idx];
          setHtmlExportProgress({
            active: true,
            phase: 'rendering',
            current: idx + 1,
            total: viewSpecs.length,
            currentLabel: spec.label,
            cacheHits,
            fallbackCount,
            lastWarning,
            errorMessage: null,
            timeoutSecondsPerView: Math.round(VIEW_TIMEOUT_MS / 1000),
          });

          let rawSvg: string | null = null;
          let wasCacheHit = false;
          let usedFallback = false;
          const trimmedSpecCode = spec.mermaidCode.trim();
          const preloadLookupKey = spec.key === 'master:detailed' ? 'master' : spec.key;
          const preloadedHit = canReuseActiveCanvasSvg
            ? preloadedViewsRef.current.get(preloadLookupKey)
            : undefined;

          if (
            canReuseActiveCanvasSvg &&
            baseRenderedSvg &&
            trimmedSpecCode === effectiveMermaidCode.trim()
          ) {
            rawSvg = baseRenderedSvg;
            wasCacheHit = true;
          } else if (
            preloadedHit &&
            preloadedHit.mermaidCode.trim() === trimmedSpecCode &&
            preloadedHit.rawSvg
          ) {
            rawSvg = preloadedHit.rawSvg;
            wasCacheHit = true;
          } else if (spec.key === 'master:detailed' && trimmedSpecCode.length > 45000) {
            const compactView = views.find((v) => v.key === 'master');
            if (compactView) {
              rawSvg = compactView.svg;
              usedFallback = true;
              lastWarning =
                'Voll-Detail-Karte bei Großprojekt durch Kompakt-Master ersetzt';
              await yieldFrame();
            }
          }

          if (!rawSvg) {
            // Yield a frame BEFORE starting heavy Mermaid rendering so the UI updates immediately
            await yieldFrame();
            if (signal.aborted) return { html: null, aborted: true };

            const res = await renderLocalMermaidDiagram(
              spec.mermaidCode,
              exportThemeConfig,
              shouldUseNativeSvgLabels(spec.mermaidCode),
              { timeoutMs: VIEW_TIMEOUT_MS }
            );
            rawSvg = res.svg;
            wasCacheHit = Boolean(res.fromCache);

            if (!rawSvg && !signal.aborted) {
              if (
                exportThemeConfig.layoutEngine !== 'dagre' ||
                exportThemeConfig.look !== 'classic'
              ) {
                setHtmlExportProgress((prev) =>
                  prev
                    ? {
                        ...prev,
                        lastWarning: `${spec.label}: Dagre-Fallback wird versucht…`,
                      }
                    : prev
                );
                await yieldFrame();
                const fallbackRes = await renderLocalMermaidDiagram(
                  spec.mermaidCode,
                  dagreFallbackTheme,
                  shouldUseNativeSvgLabels(spec.mermaidCode),
                  { timeoutMs: 6500 }
                );
                rawSvg = fallbackRes.svg;
                if (rawSvg) {
                  usedFallback = true;
                  lastWarning = `${spec.label} im Dagre-Fallback gerendert`;
                }
              }

              if (!rawSvg && spec.key === 'master:detailed') {
                const compactView = views.find((v) => v.key === 'master');
                if (compactView) {
                  rawSvg = compactView.svg;
                  usedFallback = true;
                  lastWarning = 'Voll-Detail-Karte übersprungen (Kompakt-Master übernommen)';
                }
              }

              if (!rawSvg) {
                rawSvg = buildFallbackViewSvg(
                  spec.label,
                  res.validation.errorMessage || 'Zeitlimit überschritten'
                );
                usedFallback = true;
                lastWarning = `${spec.label}: Platzhalter-Ansicht wegen Zeitlimit erzeugt`;
              }
            }
          }

          if (signal.aborted) {
            return { html: null, aborted: true };
          }

          if (wasCacheHit) {
            cacheHits += 1;
          }
          if (usedFallback) {
            fallbackCount += 1;
          }

          if (rawSvg) {
            let parsedGraph: CallflowGraph;
            try {
              parsedGraph = parseCallflowGraph(spec.mermaidCode);
            } catch {
              parsedGraph = {
                nodes: new Map(),
                edges: [],
                entryNodes: [],
                hubNodes: [],
                terminalNodes: [],
              };
            }

            let finalSvg = rawSvg;
            try {
              const colored = applySmartLogicColoring(
                rawSvg,
                spec.mermaidCode,
                smartColorMode,
                targetSurface,
                exportThemeConfig.lineColor,
                [],
                pathColorMode
              ).svg;
              finalSvg = applyNodeOffsetsToSvg(
                colored,
                scriptWorkspace.nodeOffsets,
                parsedGraph,
                false
              );
            } catch {
              fallbackCount += 1;
              lastWarning = `${spec.label}: SVG-Nachbearbeitung vereinfacht`;
            }

            // Precompute structured Element Info snapshots using O(1) WorkspaceInspectContext
            const nodeDetails: Record<string, InteractiveCallflowHtmlNodeDetail> = {};
            try {
              parsedGraph.nodes.forEach((node) => {
                const snap = inspectWorkspaceNodeForEdit(
                  scriptWorkspace,
                  spec.viewLevel,
                  node.id,
                  parsedGraph,
                  inspectContext
                );
                nodeDetails[node.id] = {
                  nodeId: snap.nodeId,
                  mode: snap.mode,
                  scriptNumber: snap.scriptNumber,
                  title: snap.title,
                  blockType: snap.blockType,
                  prio: snap.prio,
                  announcement: snap.announcement || undefined,
                  queueTarget: snap.queueTarget || undefined,
                  schedule: snap.schedule || undefined,
                  condition: snap.condition || undefined,
                  canJumpToDetailScript: snap.canJumpToDetailScript,
                  detailTargetScriptNumber: snap.detailTargetScriptNumber,
                  entryDnisNumbers: snap.entryDnisNumbers,
                  organizationName: snap.organizationName,
                  cdnAlias: snap.cdnAlias,
                  resolvedScheduleDisplay: snap.resolvedScheduleDisplay,
                  hasHolidayCheck: snap.hasHolidayCheck,
                  waitSeconds: snap.waitSeconds,
                  treatmentInfo: snap.treatmentInfo,
                  hdxAction: snap.hdxAction,
                  incomingConnections: snap.incomingConnections,
                  outgoingConnections: snap.outgoingConnections,
                  moduleRulesPreview: snap.moduleRulesPreview,
                  specialParameters: snap.specialParameters,
                  relatedFindings: snap.relatedFindings,
                  rawLineSnippet: snap.rawLineSnippet,
                };
              });
            } catch {
              // Keep rendered SVG even if optional node detail precomputation hits an unexpected edge case
            }

            views.push({
              key: spec.key,
              label: spec.label,
              scriptNumber: spec.scriptNumber,
              masterViewVariant: spec.masterViewVariant,
              svg: finalSvg,
              graph: parsedGraph,
              nodeDetails,
            });
          }

          if (wasCacheHit) {
            if (idx === 0 || (idx + 1) % 3 === 0) {
              await yieldFrame();
            } else {
              await yieldMicroTick();
            }
          }
        }

        if (signal.aborted) {
          return { html: null, aborted: true };
        }

        setHtmlExportProgress({
          active: true,
          phase: 'packaging',
          current: viewSpecs.length,
          total: viewSpecs.length,
          currentLabel: `${views.length} Ansichten werden in Callflow.html verpackt…`,
          cacheHits,
          fallbackCount,
          lastWarning,
          errorMessage: null,
          timeoutSecondsPerView: Math.round(VIEW_TIMEOUT_MS / 1000),
        });
        await yieldFrame();
        if (signal.aborted) {
          return { html: null, aborted: true };
        }

        if (views.length === 0) {
          const currentExportSvg = buildExportSvgSnapshot(false);
          if (!currentExportSvg) {
            throw new Error('Es konnten keine renderbaren Ansichten für Callflow.html erzeugt werden.');
          }
          return {
            html: generateInteractiveCallflowHtml(
              'Callflow',
              currentExportSvg,
              callflowGraph,
              targetSurface,
              {
                initialPathColorMode: pathColorMode,
                initialHiddenNodeTypes: hiddenSmartNodeTypes,
                initialIsolateSubgraph: isolateSubgraphMode,
                analysis: analysisPayload,
              }
            ),
            fallbackCount,
          };
        }

        const initialMasterDensity: 'compact' | 'detailed' =
          preferredInitialView === 'master-detailed'
            ? 'detailed'
            : preferredInitialView === 'master-compact'
            ? 'compact'
            : isMasterCompact
            ? 'compact'
            : 'detailed';
        const preferredMasterKey =
          initialMasterDensity === 'compact' ? 'master' : 'master:detailed';
        const activeKey =
          preferredInitialView === 'master-compact'
            ? views.some((v) => v.key === 'master')
              ? 'master'
              : views[0].key
            : preferredInitialView === 'master-detailed'
            ? views.some((v) => v.key === 'master:detailed')
              ? 'master:detailed'
              : views[0].key
            : callflowViewLevel.level === 'detail'
            ? `script:${callflowViewLevel.scriptNumber}`
            : views.some((v) => v.key === preferredMasterKey)
            ? preferredMasterKey
            : views[0].key;

        return {
          html: generateInteractiveCallflowHtml(
            'Callflow',
            views[0].svg,
            views[0].graph,
            targetSurface,
            {
              views,
              activeViewKey: activeKey,
              initialMasterDensity,
              initialPathColorMode: pathColorMode,
              initialHiddenNodeTypes: hiddenSmartNodeTypes,
              initialIsolateSubgraph: isolateSubgraphMode,
              analysis: analysisPayload,
              globalSearchIndex: globalSearchEntries,
              simulationModel: callflowSimulationModel,
            }
          ),
          fallbackCount,
        };
      } catch (err) {
        if (signal.aborted) {
          return { html: null, aborted: true };
        }
        const msg =
          err instanceof Error
            ? err.message
            : 'Unbekannter Fehler beim Erstellen der interaktiven Callflow-HTML.';
        keepErrorModalOpen = true;
        setHtmlExportProgress({
          active: true,
          phase: 'error',
          current: 0,
          total: totalEstimatedViews,
          currentLabel: 'Export angehalten',
          cacheHits: 0,
          fallbackCount: 0,
          lastWarning: null,
          errorMessage: msg,
          timeoutSecondsPerView: Math.round(VIEW_TIMEOUT_MS / 1000),
        });
        return { html: null, errorMessage: msg };
      } finally {
        if (exportAbortControllerRef.current === abortController) {
          exportAbortControllerRef.current = null;
        }
        if (!keepErrorModalOpen) {
          setHtmlExportProgress(null);
        }
      }
    },
    [
      buildExportSvgSnapshot,
      themeConfig,
      scriptWorkspace,
      canvasSurface,
      code,
      smartColorMode,
      pathColorMode,
      hiddenSmartNodeTypes,
      diagramTitle,
      callflowGraph,
      currentDirection,
      callflowViewLevel,
      baseRenderedSvg,
      effectiveMermaidCode,
      isolateSubgraphMode,
      activeNodeOffsets,
      isMasterCompact,
      globalSearchEntries,
      callflowSimulationModel,
    ]
  );

  const handleQuickDownloadInteractiveHtml = useCallback(async () => {
    if (
      (scriptWorkspace.modules.length === 0 && !code.trim()) ||
      isDownloadingHtml ||
      htmlExportProgress?.active
    ) {
      return;
    }
    setIsDownloadingHtml(true);
    try {
      const { html: htmlContent, aborted, fallbackCount, errorMessage } =
        await buildInteractiveHtmlForSurface(canvasSurface);
      if (aborted) return;
      if (!htmlContent) {
        if (errorMessage) {
          setHtmlExportNotice(errorMessage);
        }
        return;
      }
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      triggerLocalDownload(blob, 'Callflow.html');
      setQuickDownloadFeedback('html');
      if (fallbackCount && fallbackCount > 0) {
        setHtmlExportNotice(
          `Callflow.html gespeichert (${fallbackCount} Ansicht(en) per Zeitlimit-Fallback erstellt).`
        );
        window.setTimeout(() => setHtmlExportNotice(null), 4500);
      }
      setTimeout(() => setQuickDownloadFeedback(null), 2200);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Fehler beim Speichern der Callflow.html.';
      setHtmlExportProgress({
        active: true,
        phase: 'error',
        current: 0,
        total: Math.max(1, scriptWorkspace.modules.length),
        currentLabel: 'Download fehlgeschlagen',
        cacheHits: 0,
        errorMessage: msg,
      });
    } finally {
      setIsDownloadingHtml(false);
    }
  }, [
    scriptWorkspace.modules.length,
    code,
    isDownloadingHtml,
    htmlExportProgress?.active,
    buildInteractiveHtmlForSurface,
    canvasSurface,
  ]);

  const handleClearWorkspace = () => {
    skipAutoConvertRef.current = false;
    setIsConfirmingClearWorkspace(false);
    setRawScriptDraft(null);
    setLastFolderResolveSummary(null);
    setDiagramTitle('Neuer Callflow');
    setCode('');
    setScriptWorkspace(buildScriptWorkspace([]));
    setGuidedStep(1);
    setIsVisualEditMode(false);
    setMasterRenderError(null);
    pendingAutoFitRef.current = false;
    setCallflowViewLevel({ level: 'master' });
    setSelectedCallflowNodeId(null);
    setIsolateSubgraphMode(false);
    setBaseRenderedSvg(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // ignore
    }
  };

  const lineCount = useMemo(() => Math.max(1, code.split('\n').length), [code]);
  const lineNumberList = useMemo(
    () => Array.from({ length: lineCount }, (_, idx) => idx + 1),
    [lineCount]
  );
  const showDesktopEditor =
    workspaceMode === 'free' && !isFullscreenPreview && !isDesktopEditorCollapsed;

  const handleOpenNewCallflowModalCb = useCallback(() => setIsNewCallflowModalOpen(true), []);
  const handleExportHtmlFromInspectorCb = useCallback(() => {
    void handleQuickDownloadInteractiveHtml();
  }, [handleQuickDownloadInteractiveHtml]);
  const handleCloseMobileInspectorCb = useCallback(() => setMobileActivePane('preview'), []);
  const handleCloseDesktopRightPanelCb = useCallback(() => setIsRightPanelOpen(false), []);
  const handleFocusNodeDesktopCb = useCallback(
    (id: string) => handleFocusNodeOnCanvas(id, 1.25),
    [handleFocusNodeOnCanvas]
  );
  const handleFocusNodeMobileCb = useCallback(
    (id: string) => {
      setMobileActivePane('preview');
      setTimeout(() => handleFocusNodeOnCanvas(id, 1.25), 60);
    },
    [handleFocusNodeOnCanvas]
  );
  const handleAddBuildingBlockDefaultCb = useCallback(
    (type: CallflowBuildingBlockType) => handleAddBuildingBlock(type),
    [handleAddBuildingBlock]
  );
  const handleSwitchViewLevelCb = useCallback(
    (lvl: CallflowViewLevel) => handleSwitchCallflowViewLevel(lvl),
    [handleSwitchCallflowViewLevel]
  );

  return (
    <div className="h-dvh w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Top Bar: Brand + Mode Switcher (Geführter Modus vs. Freier Modus) + Primary Action */}
      <header className="flex items-center justify-between gap-2 sm:gap-4 lg:gap-6 px-2.5 sm:px-4 lg:px-6 h-12 lg:h-14 border-b border-slate-800 bg-slate-950 shrink-0 min-w-0 overflow-x-auto">
        {/* Zone 1: Brand + Mode Switcher */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <a
            href="#studio"
            onClick={(e) => {
              e.preventDefault();
              handleFitToViewport();
            }}
            className="text-xs sm:text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            MermaidFree2UseOpen
          </a>

          <div
            role="group"
            aria-label="Arbeitsmodus wählen"
            className="flex items-center gap-0.5 sm:gap-1 p-0.5 sm:p-1 bg-slate-900 border border-slate-800 rounded-lg shrink-0"
          >
            <button
              type="button"
              onClick={() => handleChangeWorkspaceMode('guided')}
              title="Aufgeräumter 3-Schritte-Assistent ohne Code-Editor (Start mit Einstiegsskript Main)"
              className={`px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                workspaceMode === 'guided'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="sm:hidden">Geführt</span>
              <span className="hidden sm:inline">Geführter Modus</span>
              <span className="hidden md:inline text-[10px] font-normal opacity-90">
                (Einstieg: Main)
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleChangeWorkspaceMode('free')}
              title="Freier Experten-Modus mit Mermaid-Code-Editor, Vorlagen und allen Analyse-Tabs"
              className={`px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                workspaceMode === 'free'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="sm:hidden">Frei</span>
              <span className="hidden sm:inline">Freier Modus</span>
              <span className="hidden md:inline text-[10px] font-normal opacity-90">
                (Editor &amp; Studio)
              </span>
            </button>
          </div>
        </div>

        {/* Zone 2: Studio navigation links (only shown in Free Mode so Guided Mode stays calm) */}
        {workspaceMode === 'free' ? (
          <nav className="hidden xl:flex items-center gap-5 text-xs font-medium text-slate-400">
            <button
              type="button"
              onClick={() => setLibraryModal({ isOpen: true, tab: 'templates' })}
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Vorlagen
            </button>
            <button
              type="button"
              onClick={() => {
                setRightSidebarTab('callflow');
                setIsRightPanelOpen(true);
                setMobileActivePane('callflow');
              }}
              className={`hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isRightPanelOpen && rightSidebarTab === 'callflow' ? 'text-indigo-400' : ''
              }`}
            >
              Callflow-Inspektor
            </button>
            <button
              type="button"
              onClick={() => {
                setRightSidebarTab('theme');
                setIsRightPanelOpen(true);
                setMobileActivePane('theme');
              }}
              className={`hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isRightPanelOpen && rightSidebarTab === 'theme' ? 'text-indigo-400' : ''
              }`}
            >
              Logik-Farben
            </button>
            <button
              type="button"
              onClick={() => setLibraryModal({ isOpen: true, tab: 'saved' })}
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Speicherstände
            </button>
            <button
              type="button"
              onClick={() => setLibraryModal({ isOpen: true, tab: 'help' })}
              className="hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Syntax-Hilfe
            </button>
          </nav>
        ) : (
          <div className="hidden xl:flex items-center gap-2 text-xs text-slate-400 truncate">
            <span className="px-2 py-0.5 rounded bg-indigo-950/70 border border-indigo-500/30 text-indigo-300 font-medium">
              Fokus-Ansicht aktiv
            </span>
            <span className="truncate">
              Mermaid-Editor ausgeblendet · Rechts in 3 Schritten von Main über die Master-Gesamtkarte bis zum Export
            </span>
          </div>
        )}

        {/* Zone 3: Primary actions */}
        <div className="flex items-center gap-2 shrink-0">
          {(code.trim().length > 0 || scriptWorkspace.modules.length > 0) && (
            isConfirmingClearWorkspace ? (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-rose-950/90 border border-rose-500 text-xs shrink-0 shadow-md">
                <span className="text-rose-200 font-semibold whitespace-nowrap">
                  Wirklich löschen?
                </span>
                <button
                  type="button"
                  onClick={handleClearWorkspace}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  Bestätigen
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingClearWorkspace(false)}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  Abbrechen
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsConfirmingClearWorkspace(true)}
                title="Aktuellen Callflow komplett löschen und von vorne anfangen"
                className="px-2.5 lg:px-3 py-1.5 lg:py-2 text-xs font-semibold text-rose-100 bg-rose-700/80 hover:bg-rose-600 border border-rose-500/70 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-200 shrink-0" />
                <span className="hidden sm:inline">Von vorne / Löschen</span>
              </button>
            )
          )}
        </div>
      </header>

      {/* Main Responsive Studio Workspace */}
      <main ref={workspaceRef} className="flex-1 flex min-w-0 min-h-0 overflow-hidden relative">
        {/* Pane 1: Live Mermaid Code Editor */}
        <section
          style={
            {
              '--editor-split-width': `${splitRatio}%`,
            } as React.CSSProperties
          }
          className={`${
            mobileActivePane === 'editor' ? 'flex w-full' : 'hidden'
          } ${
            showDesktopEditor ? 'lg:flex lg:w-[var(--editor-split-width)]' : 'lg:hidden'
          } h-full min-w-0 flex-col bg-slate-950 lg:border-r border-slate-800 lg:min-w-[290px]`}
        >
          {/* Editor Top Toolbar */}
          <div className="px-3 sm:px-4 py-2 border-b border-slate-800 bg-slate-900/80 flex flex-wrap items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto sm:flex-1">
              <input
                type="text"
                value={diagramTitle}
                onChange={(e) => setDiagramTitle(e.target.value)}
                placeholder="Diagramm-Titel..."
                aria-label="Diagramm-Titel"
                className="bg-slate-950/90 border border-slate-800 focus:border-indigo-500 rounded-md px-2.5 py-1.5 lg:py-1 text-xs font-medium text-slate-100 truncate min-w-0 flex-1 sm:max-w-[200px] focus:outline-none"
              />

              <select
                aria-label="Schnellvorlage wechseln"
                value=""
                onChange={(e) => {
                  const found = MERMAID_TEMPLATES.find((t) => t.id === e.target.value);
                  if (found) handleSelectTemplate(found);
                }}
                className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-md px-2 py-1.5 lg:py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 w-[132px] sm:w-auto sm:max-w-[155px] shrink-0 truncate cursor-pointer"
              >
                <option value="" disabled>
                  v11 Beispiel...
                </option>
                {MERMAID_TEMPLATES.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.badge}: {tpl.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-1.5 w-full sm:w-auto shrink-0">
              {currentDirection && (
                <div
                  className="flex items-center gap-0.5 p-0.5 bg-slate-950 border border-slate-800 rounded-md"
                  title="Flussrichtung direkt im Code umschalten"
                >
                  {(['LR', 'TB', 'RL', 'BT'] as DiagramDirection[]).map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => handleChangeDirection(dir)}
                      className={`px-1.5 py-0.5 text-[11px] font-mono rounded transition-colors whitespace-nowrap shrink-0 ${
                        currentDirection === dir
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {dir}
                    </button>
                  ))}
                </div>
              )}

              {(code.trim().length > 0 || scriptWorkspace.modules.length > 0) && (
                isConfirmingClearWorkspace ? (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-950 border border-rose-500 text-[11px] shrink-0">
                    <button
                      type="button"
                      onClick={handleClearWorkspace}
                      className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Bestätigen
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsConfirmingClearWorkspace(false)}
                      className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Abbrechen
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsConfirmingClearWorkspace(true)}
                    title="Editor & Callflow-Arbeitsbereich komplett löschen"
                    className="px-2 py-1.5 lg:py-1 bg-rose-700/80 hover:bg-rose-600 border border-rose-500/70 text-rose-100 text-xs font-semibold rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-200" />
                    <span>Löschen</span>
                  </button>
                )
              )}

              <button
                type="button"
                onClick={handleCopyCode}
                title="Mermaid-Quellcode kopieren"
                className="px-2.5 py-1.5 lg:py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {copiedCode ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Kopiert</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Code</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsDesktopEditorCollapsed(true)}
                title="Code-Editor einklappen"
                className="hidden lg:flex p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md transition-colors"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Syntax & Anti-Overlap Strip */}
          <div className="px-3 py-1.5 border-b border-slate-800/80 bg-slate-950/90 flex items-center gap-1.5 overflow-x-auto shrink-0">
            <span className="text-[11px] text-slate-500 whitespace-nowrap shrink-0 mr-1">
              Syntax:
            </span>
            {QUICK_SYNTAX_TOKENS.map((item) => (
              <button
                key={item.label}
                type="button"
                title={item.hint}
                onClick={() => handleInsertSnippet(item.token)}
                className="px-2 py-1 bg-slate-900 hover:bg-slate-800 active:bg-indigo-600/30 border border-slate-800 rounded text-xs font-mono text-indigo-300 transition-colors whitespace-nowrap shrink-0"
              >
                {item.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsNewCallflowModalOpen(true)}
                title="Neuen Callflow direkt mit Main starten und Folgeskripte abfragen"
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-xs font-medium text-white flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Neuer Callflow</span>
              </button>
              <button
                type="button"
                onClick={() => setIsMultiScriptModalOpen(true)}
                title="Text-Skripte (Main, freie Namen & Nummern) sowie Visio-Exporte als Master + Detail einlesen"
                className="px-2.5 py-1 bg-indigo-950/50 hover:bg-indigo-900/60 border border-indigo-500/40 rounded text-xs text-indigo-200 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FolderPlus className="w-3 h-3 text-indigo-400" />
                <span>Skripte einlesen</span>
              </button>
            </div>
          </div>

          {/* Non-destructive Auto-Convert Script Status Bar */}
          {(rawScriptDraft || isRawScriptInEditor) && (
            <div className="px-3 py-1.5 border-b border-slate-800 bg-slate-900/70 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
              {isRawScriptInEditor ? (
                <>
                  <span className="text-amber-300 truncate">
                    Rohtext erkannt · <span className="text-slate-400">Kommentare /* */ &amp; Historie werden ignoriert</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      skipAutoConvertRef.current = false;
                      convertRawScriptTextInEditor(code, 'replace');
                    }}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    In Callflow umwandeln
                  </button>
                </>
              ) : (
                rawScriptDraft && (
                  <>
                    <span className="text-emerald-300 truncate tabular-nums">
                      Auto-Konvertierung · {rawScriptDraft.moduleCount} Skripte ·{' '}
                      {rawScriptDraft.ruleCount} Regeln
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {scriptWorkspace.modules.length === 1 && callflowViewLevel.level === 'master' && (
                        <button
                          type="button"
                          onClick={() =>
                            handleSwitchCallflowViewLevel({
                              level: 'detail',
                              scriptNumber: scriptWorkspace.modules[0].scriptNumber,
                            })
                          }
                          className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 text-[11px] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Detail (Ebene 2)
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          skipAutoConvertRef.current = true;
                          setCode(rawScriptDraft.rawText);
                        }}
                        className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Rohtext anzeigen
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsMultiScriptModalOpen(true)}
                        className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-indigo-300 text-[11px] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        + Skripte
                      </button>
                    </div>
                  </>
                )
              )}
            </div>
          )}

          {/* Code Editor Body with Synchronized Line Numbers */}
          <div className="flex-1 flex min-h-0 relative font-mono text-[13px] leading-[22px] bg-[#090d16]">
            <div
              ref={gutterRef}
              aria-hidden="true"
              className="w-11 sm:w-12 py-3 sm:py-4 bg-slate-950/90 border-r border-slate-800/80 text-right pr-2.5 sm:pr-3 text-slate-600 select-none overflow-hidden tabular-nums shrink-0"
            >
              {lineNumberList.map((lineNumber) => {
                const isErrorLine =
                  !validation.isValid && validation.errorLine === lineNumber;
                return (
                  <div
                    key={lineNumber}
                    className={`leading-[22px] ${
                      isErrorLine
                        ? 'text-rose-400 font-bold bg-rose-950/60 -mr-3 pr-3'
                        : ''
                    }`}
                  >
                    {lineNumber}
                  </div>
                );
              })}
            </div>

            <textarea
              ref={textareaRef}
              value={code}
              onChange={(e) => {
                const nextVal = e.target.value;
                if (!nextVal.trim()) {
                  skipAutoConvertRef.current = false;
                  setRawScriptDraft(null);
                }
                setCode(nextVal);
              }}
              onPaste={handleEditorPaste}
              onScroll={handleEditorScroll}
              onKeyDown={handleEditorKeyDown}
              wrap="off"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              placeholder="Mermaid v11 Code oder Callflow-/AACC-Skripttext (CDN, section Init, Prio, Nummer, Wohin, Auswahl) hier direkt einfügen..."
              className="flex-1 min-w-0 h-full p-3 sm:p-4 bg-transparent text-slate-100 font-mono text-[13px] leading-[22px] resize-none focus:outline-none overflow-auto whitespace-pre selection:bg-indigo-500/30 select-text"
            />
          </div>

          {/* Editor Status & Syntax Diagnostic Footer */}
          <div className="border-t border-slate-800 bg-slate-900/95 px-3 sm:px-4 py-2.5 shrink-0">
            {!code.trim() ? (
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-slate-400 truncate">
                  <Code2 className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="truncate">
                    Bereit · Skripttext, Visio-Export oder Mermaid-Code einfügen
                  </span>
                </div>
              </div>
            ) : validation.isValid ? (
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-emerald-400 font-medium truncate">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Syntax valide</span>
                  <span className="text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-slate-300 font-normal truncate">
                    {callflowGraph.nodes.size} Skripte/Knoten · {callflowGraph.edges.length} Pfade
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setMobileActivePane('preview')}
                    className="lg:hidden px-3 py-1 bg-indigo-600 text-white text-xs font-medium rounded-md whitespace-nowrap shrink-0"
                  >
                    Vorschau öffnen
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-rose-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>
                      Syntaxfehler erkannt
                      {validation.errorLine ? ` (Zeile ${validation.errorLine})` : ''}
                    </span>
                  </div>
                  {validation.errorLine && (
                    <button
                      type="button"
                      onClick={() => handleJumpToErrorLine(validation.errorLine!)}
                      className="px-2.5 py-1 bg-rose-950/80 hover:bg-rose-900/80 border border-rose-700/60 text-rose-200 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      Zeile {validation.errorLine} markieren
                    </button>
                  )}
                </div>
                <pre className="p-2.5 rounded-lg bg-slate-950 border border-rose-900/60 text-xs font-mono text-rose-200/90 whitespace-pre-wrap max-h-24 overflow-y-auto select-text">
                  {validation.errorMessage}
                </pre>
              </div>
            )}
          </div>
        </section>

        {/* Draggable Split Resizer Handle (Desktop only) */}
        {showDesktopEditor && (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={() => setIsResizingSplit(true)}
            onDoubleClick={() => setSplitRatio(38)}
            className={`hidden lg:block w-1.5 cursor-col-resize bg-slate-900 hover:bg-indigo-500/70 transition-colors shrink-0 ${
              isResizingSplit ? 'bg-indigo-500' : ''
            }`}
            title="Ziehen zum Anpassen der Breite (Doppelklick für Standard 38%)"
          />
        )}

        {/* Pane 2: Interactive SVG Diagram Canvas */}
        <section
          className={`${
            mobileActivePane === 'preview' ? 'flex w-full' : 'hidden'
          } lg:flex flex-1 h-full flex-col min-w-0 bg-slate-950 relative overflow-hidden`}
        >
          {/* Canvas Toolbar: Smart Color Switcher + ELK Anti-Overlap Switch + Zoom + Direct PNG & HTML Export */}
          <div className="px-3 sm:px-4 py-2 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-2 overflow-x-auto z-10 shrink-0">
            {/* Left: Editor Expand (Free Mode only) + Smart Logic Coloring (Free Mode only) + ELK Anti-Overlap Toggle */}
            <div className="flex items-center gap-2 shrink-0">
              {workspaceMode === 'free' && !isFullscreenPreview && (
                <button
                  type="button"
                  onClick={() => setIsDesktopEditorCollapsed((prev) => !prev)}
                  title={
                    isDesktopEditorCollapsed
                      ? 'Code-Editor einblenden'
                      : 'Code-Editor einklappen'
                  }
                  className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    isDesktopEditorCollapsed
                      ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {isDesktopEditorCollapsed ? (
                    <>
                      <PanelLeftOpen className="w-3.5 h-3.5" />
                      <span>Editor</span>
                    </>
                  ) : (
                    <PanelLeftClose className="w-3.5 h-3.5" />
                  )}
                </button>
              )}

              {/* Live Clarity / Smart Coloring Mode Switcher (Free Mode only) */}
              {workspaceMode === 'free' && (
                <div
                  className="flex items-center gap-0.5 p-0.5 bg-slate-950 border border-slate-800 rounded-lg"
                  title="Automatische Farbdifferenzierung & Übersichtlichkeits-Modus umschalten"
                >
                  <div className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-400 whitespace-nowrap shrink-0">
                    <Wand2 className="w-3.5 h-3.5" />
                  </div>
                  {CLARITY_MODE_OPTIONS.map((opt) => {
                    const isActive = smartColorMode === opt.id;
                    const isRecommended =
                      logicSummary.recommendedMode === opt.id && smartColorMode !== opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        title={opt.hint}
                        onClick={() => setSmartColorMode(opt.id)}
                        className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 ${
                          isActive
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : isRecommended
                            ? 'text-emerald-300 hover:bg-slate-800/80'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                        }`}
                      >
                        <span>{opt.shortLabel}</span>
                        {isRecommended && (
                          <span className="text-[10px] text-emerald-400 font-semibold">
                            ★
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Segmented A / B Path Color Switcher: Modus A (Semantik) vs Modus B (Verzweigung) */}
              <div
                role="group"
                aria-label="Pfad-Färbungsmodus"
                className="flex items-center gap-0.5 p-0.5 bg-slate-950 border border-slate-800 rounded-lg shrink-0"
                title="Verbindungspfade einfärben: Modus A nach Semantik (Entscheidung, Fallback, Queue, Zyklus) oder Modus B nach Verzweigung/Zweig"
              >
                <button
                  type="button"
                  onClick={() => setPathColorMode('semantic')}
                  title="Modus A: Pfade nach Bedeutung/Typ färben (Entscheidung, Fallback, Queue, Fehler, Zyklus)"
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                    pathColorMode === 'semantic'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <span className="font-mono text-[10px] opacity-80">A</span>
                  <span>Semantik</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPathColorMode('branches')}
                  title="Modus B: Jede Verzweigung (Branch/Zweig) in eigener Farbe durchverfolgen"
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                    pathColorMode === 'branches'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <span className="font-mono text-[10px] opacity-80">B</span>
                  <span>Verzweigung</span>
                </button>
              </div>

              {/* 1-Click ELK Anti-Overlap Engine Switch */}
              <button
                type="button"
                onClick={() =>
                  setThemeConfig((prev) => ({
                    ...prev,
                    layoutEngine: prev.layoutEngine === 'elk' ? 'dagre' : 'elk',
                  }))
                }
                title="Zwischen Standard-Dagre und ELK Anti-Überlappungs-Engine umschalten"
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  themeConfig.layoutEngine === 'elk'
                    ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>{themeConfig.layoutEngine === 'elk' ? 'ELK aktiv' : 'ELK Layout'}</span>
              </button>

              {/* Surface Switch: Dark vs Light Canvas */}
              <div className="flex items-center gap-0.5 p-0.5 bg-slate-950 border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => handleChangeCanvasSurface('dark')}
                  title="Dunkler Canvas-Hintergrund"
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 ${
                    canvasSurface === 'dark'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5 text-indigo-400" />
                </button>
                <button
                  type="button"
                  onClick={() => handleChangeCanvasSurface('light')}
                  title="Heller Canvas-Hintergrund"
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 ${
                    canvasSurface === 'light'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                </button>
              </div>
            </div>

            {/* Center: High-Range Zoom (5% - 2000%), 1:1 Readable Scale & Fit Controls */}
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => handleStepZoom('out')}
                title="Verkleinern"
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              <select
                aria-label="Zoom-Stufe wählen"
                value={String(Math.round(zoom * 100))}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'fit') {
                    handleFitToViewport();
                  } else {
                    const num = Number(val) / 100;
                    if (Number.isFinite(num) && num > 0) {
                      setZoom(num);
                    }
                  }
                }}
                title="Zoom-Stufe direkt wählen (5 % bis 2000 %)"
                className="bg-transparent hover:bg-slate-800 text-xs font-mono text-slate-200 px-1.5 py-1 rounded-md tabular-nums focus:outline-none cursor-pointer"
              >
                <option value={String(Math.round(zoom * 100))} className="bg-slate-900 text-slate-100">
                  {Math.round(zoom * 100)}%
                </option>
                <option value="fit" className="bg-slate-900 text-indigo-300">
                  Einpassen (Fit)
                </option>
                {[10, 25, 50, 75, 100, 125, 150, 200, 300, 400, 600, 800, 1200, 1600, 2000].map(
                  (pct) => (
                    <option key={pct} value={String(pct)} className="bg-slate-900 text-slate-100">
                      {pct === 100 ? '100% (1:1 Lesbar)' : `${pct}%`}
                    </option>
                  )
                )}
              </select>

              <button
                type="button"
                onClick={() => handleStepZoom('in')}
                title="Vergrößern (bis 2000 %)"
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                title="Echte 1:1-Originalgröße (100 % gestochen scharfe Lesegröße)"
                className={`px-2 py-1 text-[11px] font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  Math.round(zoom * 100) === 100
                    ? 'bg-indigo-600/30 text-indigo-200 border border-indigo-500/40'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                1:1
              </button>

              <button
                type="button"
                onClick={handleFitToViewport}
                title="Gesamtes Diagramm als Übersicht in das Fenster einpassen"
                className="px-2 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Scan className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden xl:inline text-[11px]">Fit</span>
              </button>

              <button
                type="button"
                onClick={() => setShowGrid((prev) => !prev)}
                title="Hintergrund-Raster ein-/ausblenden"
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  showGrid
                    ? 'text-indigo-300 bg-slate-800'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Grid className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setShowMinimap((prev) => !prev)}
                title="Übersichts-Minimap ein-/ausblenden (M)"
                className={`hidden md:flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showMinimap
                    ? 'text-indigo-200 bg-indigo-600/25 border border-indigo-500/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span className="hidden xl:inline text-[11px]">Minimap</span>
              </button>
            </div>

            {/* Right: PC Drag & Drop Toggle + Prominent 1-Click PNG Download + Interactive HTML Download + Right Panel Switch */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsVisualEditMode((prev) => !prev)}
                title="Manueller Drag-and-Drop-Editor für PC: Knoten frei verschieben, Verbindungen ziehen, Doppelklick-Textbearbeitung und neue Bausteine ins Diagramm ziehen"
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  isVisualEditMode
                    ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                    : 'bg-slate-900 hover:bg-slate-800 border-indigo-500/50 text-indigo-200'
                }`}
              >
                <Move className="w-3.5 h-3.5" />
                <span>
                  {isVisualEditMode ? 'Drag & Drop aktiv' : 'Manuell bearbeiten'}
                </span>
              </button>

              <button
                type="button"
                disabled={!coloredSvg || isDownloadingPng}
                onClick={handleQuickDownloadPng}
                title="Direkt als hochauflösendes PNG (2x Retina) herunterladen"
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 shadow-xs cursor-pointer"
              >
                <FileImage className="w-3.5 h-3.5" />
                <span>
                  {isDownloadingPng
                    ? 'Rendere...'
                    : quickDownloadFeedback === 'png'
                    ? 'PNG geladen!'
                    : 'PNG Export'}
                </span>
              </button>

              <button
                type="button"
                disabled={!coloredSvg || isDownloadingHtml}
                onClick={() => void handleQuickDownloadInteractiveHtml()}
                title="Als interaktive Einzel-HTML-Datei mit Zwei-Ebenen & Pfad-Filterung speichern"
                className="px-2.5 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/50 text-emerald-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  {isDownloadingHtml
                    ? 'HTML...'
                    : quickDownloadFeedback === 'html'
                    ? 'HTML geladen!'
                    : 'Interaktive HTML'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsRightPanelOpen((prev) => !prev)}
                title="Rechtes Inspektor-Panel ein-/ausblenden (B)"
                className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isRightPanelOpen
                    ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {isRightPanelOpen ? (
                  <PanelRightClose className="w-3.5 h-3.5" />
                ) : (
                  <PanelRightOpen className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsFullscreenPreview((prev) => !prev)}
                title={
                  isFullscreenPreview
                    ? 'Assistent / Editor wieder einblenden (F)'
                    : 'Diagramm-Vorschau maximieren (Vollbild, F)'
                }
                className="hidden lg:flex p-1.5 bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                {isFullscreenPreview ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Two-Level Breadcrumb Bar when Multi-Script Workspace has modules or Welcome Screen is active */}
          {(scriptWorkspace.modules.length > 0 || callflowViewLevel.level === 'welcome') && (
            <div className="px-3 sm:px-4 py-1.5 border-b border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 z-20 relative">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={handleReturnToWelcomeScreen}
                  title="Zurück zur leeren Willkommensseite (spart Speicher & CPU)"
                  className={`flex items-center gap-1 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    callflowViewLevel.level === 'welcome'
                      ? 'text-emerald-300'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  <span>Startseite</span>
                </button>

                <span className="text-slate-600" aria-hidden="true">
                  /
                </span>

                <button
                  type="button"
                  onClick={() =>
                    scriptWorkspace.modules.length > 0
                      ? handleSwitchCallflowViewLevel({ level: 'master' })
                      : setCallflowViewLevel({ level: 'master' })
                  }
                  className={`flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    callflowViewLevel.level === 'master'
                      ? 'text-indigo-300'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {callflowViewLevel.level === 'detail' && <ArrowLeft className="w-3.5 h-3.5" />}
                  <span>
                    {scriptWorkspace.modules.length > 0
                      ? 'Ebene 1: Master-Gesamtkarte'
                      : 'Diagramm laden'}
                  </span>
                </button>

                {callflowViewLevel.level === 'detail' && (
                  <>
                    <span className="text-slate-600" aria-hidden="true">
                      /
                    </span>
                    <span className="font-mono font-semibold text-amber-300 truncate tabular-nums">
                      {(() => {
                        const activeMod = scriptWorkspace.modules.find(
                          (m) =>
                            canonicalScriptMatchKey(m.scriptNumber) ===
                            canonicalScriptMatchKey(callflowViewLevel.scriptNumber)
                        );
                        if (
                          canonicalScriptMatchKey(callflowViewLevel.scriptNumber) === 'main' ||
                          (activeMod?.isMaster &&
                            /^(?:main|start|master(?:script)?)$/i.test(activeMod.scriptNumber))
                        ) {
                          return 'Main (Einstiegsskript)';
                        }
                        return activeMod
                          ? formatScriptDisplayLabel(activeMod)
                          : callflowViewLevel.scriptNumber;
                      })()}
                    </span>
                  </>
                )}

                <span className="text-slate-700 hidden sm:inline" aria-hidden="true">
                  ·
                </span>
                <span className="text-[11px] text-slate-400 hidden sm:inline font-mono tabular-nums">
                  {scriptWorkspace.modules.length} Skripte
                </span>
                <span className="text-slate-700 hidden sm:inline" aria-hidden="true">
                  ·
                </span>
                {(scriptWorkspace.openIssueCount || 0) > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRightSidebarTab('callflow');
                      setIsRightPanelOpen(true);
                    }}
                    title="Offene Punkte & Rückfragen in der Checkliste klären"
                    className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-rose-400 hover:text-rose-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" aria-hidden="true" />
                    <span>{scriptWorkspace.openIssueCount} Offen</span>
                  </button>
                ) : (
                  <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-emerald-400 whitespace-nowrap shrink-0">
                    <span>✓ Vollständig</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-1.5 max-w-full">
                {callflowViewLevel.level === 'master' && (
                  <div
                    className="inline-flex items-center p-0.5 bg-slate-900 border border-slate-800 rounded-md shrink-0"
                    role="group"
                    aria-label="Master-Kartendichte"
                    title="Kompakt-Modus für flüssige Performance bei großen Callflows vs. Voll-Detail mit separaten Queue-/Endpunkt-Knoten"
                  >
                    <button
                      type="button"
                      onClick={() => handleChangeMasterDensity('compact')}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isMasterCompact
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Kompakt
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChangeMasterDensity('detailed')}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        !isMasterCompact
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Voll-Detail
                    </button>
                  </div>
                )}

                <SearchableScriptDropdown
                  viewLevel={callflowViewLevel}
                  modules={scriptWorkspace.modules}
                  onSwitchViewLevel={handleSwitchCallflowViewLevel}
                  variant="compact"
                  align="right"
                />

                <button
                  type="button"
                  onClick={() => {
                    setOpeningHoursInitialSearch('');
                    setIsOpeningHoursModalOpen(true);
                  }}
                  title="Extra Fenster: Übersicht aller Öffnungszeiten, Zeitprofile & SondZeit-Pläne öffnen"
                  className="px-2.5 py-1 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 hover:border-amber-500/60 text-amber-200 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Öffnungszeiten</span>
                  {(() => {
                    const count = (scriptWorkspace.modules || []).reduce((acc, m) => {
                      const hasHours =
                        m.rules.some((r) => Boolean(r.schedule)) || /sondzeit/i.test(m.scriptName);
                      return acc + (hasHours ? 1 : 0);
                    }, 0);
                    return count > 0 ? (
                      <span className="text-[11px] text-amber-300 font-mono font-semibold tabular-nums">
                        ({count})
                      </span>
                    ) : null;
                  })()}
                </button>

                <button
                  type="button"
                  onClick={() => setIsCallSimulatorOpen((prev) => !prev)}
                  title="Interaktiver Anruf-Simulator live auf dem Callflow (Play/Pause, Vor & Zurück)"
                  className={`px-2.5 py-1 border rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    isCallSimulatorOpen
                      ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white'
                      : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-200'
                  }`}
                >
                  <PhoneCall
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isCallSimulatorOpen ? 'text-white' : 'text-emerald-400'
                    }`}
                  />
                  <span>Anruf-Simulator</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsGlobalSearchOpen(true)}
                  title="Globale Suche über alle Skripte, DNIS, Queues, Ansagen & Zeiten (Strg+K)"
                  className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>Suche</span>
                  <span className="hidden xl:inline text-[10px] font-mono text-slate-400">Strg+K</span>
                </button>

                <button
                  type="button"
                  onClick={() => openMultiScriptModalWithPrefill()}
                  className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-md text-[11px] text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Skripte &amp; Visio
                </button>
              </div>
            </div>
          )}

          {/* Mobile Live-Map Prompt Banner for next missing script in Masterscript checklist */}
          {(() => {
            const checklist = scriptWorkspace.masterChecklist || [];
            const nextMissing = checklist.find((item) => item.status === 'missing');
            if (!nextMissing) return null;
            const doneCount = checklist.filter((item) => item.status !== 'missing').length;
            return (
              <div className="lg:hidden px-3 py-1.5 border-b border-slate-800 bg-slate-900/95 flex items-center justify-between gap-2 text-xs shrink-0 z-10">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" aria-hidden="true" />
                  <span className="text-slate-300 truncate">
                    Nächstes Skript:{' '}
                    <span className="font-mono font-semibold text-slate-100">
                      {nextMissing.refKey}
                    </span>{' '}
                    <span className="text-slate-400 font-mono tabular-nums">
                      ({doneCount}/{checklist.length})
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setChecklistFocusTrigger({
                      refKey: nextMissing.refKey,
                      nonce: Date.now(),
                    });
                    setMobileActivePane('callflow');
                  }}
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Einfügen</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            );
          })()}

          {/* PC Visual Drag-and-Drop Building Block Palette & Tool Bar */}
          {isVisualEditMode && (
            <div
              data-canvas-ui="true"
              className="px-3 sm:px-4 py-2 border-b border-indigo-500/40 bg-slate-900/95 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 z-20"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Tool Switch: Move Node vs Draw Connection Wire */}
                <div className="flex items-center gap-0.5 p-0.5 bg-slate-950 border border-slate-800 rounded-lg mr-1">
                  <button
                    type="button"
                    onClick={() => setVisualEditTool('move')}
                    title="Knoten im Diagramm frei per Drag & Drop verschieben"
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                      visualEditTool === 'move'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Move className="w-3 h-3" />
                    <span>Knoten verschieben</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisualEditTool('connect')}
                    title="Von einem Knoten zu einem Ziel-Knoten ziehen, um eine neue Verbindung zu knüpfen"
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                      visualEditTool === 'connect'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ArrowRight className="w-3 h-3" />
                    <span>Verbindung ziehen</span>
                  </button>
                </div>

                <span className="text-[11px] text-slate-400 hidden xl:inline mr-1">
                  Bausteine ins Diagramm ziehen (oder klicken):
                </span>

                {(
                  [
                    { id: 'script', label: '+ Unter-Skript' },
                    { id: 'announcement', label: '+ Ansage / RAN' },
                    { id: 'queue', label: '+ Skillset / Queue' },
                    { id: 'condition', label: '+ Zeit- / IF-Weiche' },
                    { id: 'dtmf', label: '+ DTMF-Menü' },
                    { id: 'external', label: '+ Externes Ziel' },
                  ] as Array<{ id: CallflowBuildingBlockType; label: string }>
                ).map((block) => (
                  <button
                    key={block.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-callflow-block', block.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => handleAddBuildingBlock(block.id)}
                    title="Per Drag & Drop auf das Diagramm (oder auf einen bestehenden Knoten) ziehen oder anklicken"
                    className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-indigo-950/80 border border-slate-700 hover:border-indigo-400 text-[11px] font-medium text-slate-100 transition-colors cursor-grab active:cursor-grabbing whitespace-nowrap"
                  >
                    {block.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {selectedCallflowNodeId && (
                  <button
                    type="button"
                    onClick={() => handleOpenNodeEditor(selectedCallflowNodeId)}
                    className="px-2.5 py-1 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/50 text-[11px] font-semibold text-indigo-200 flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Knoten bearbeiten</span>
                  </button>
                )}

                <label className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={snapToGrid}
                    onChange={(e) => setSnapToGrid(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-indigo-600"
                  />
                  <span>16px Raster</span>
                </label>

                {hasCustomNodeOffsets && (
                  <button
                    type="button"
                    onClick={handleResetAllNodeOffsets}
                    title="Alle manuellen Knoten-Verschiebungen zurücksetzen"
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Positionen Reset</span>
                  </button>
                )}

                <span className="hidden 2xl:inline text-[11px] text-amber-300/90 font-medium">
                  Doppelklick auf Knoten = Text &amp; Ziele editieren
                </span>
              </div>
            </div>
          )}

          {/* Interactive Pan, Pinch-to-Zoom, Drag-and-Drop & Click-to-Trace Viewport */}
          <div
            ref={canvasViewportRef}
            onWheel={handleCanvasWheel}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => {
              if (lastHoverLockKeyRef.current !== '') {
                lastHoverLockKeyRef.current = '';
                if (liveSvgIndexRef.current) {
                  setHoveredLockTargetsInDom(
                    liveSvgIndexRef.current,
                    null,
                    null,
                    selectedCallflowEdge
                  );
                }
              }
            }}
            onTouchStart={handleCanvasTouchStart}
            onTouchMove={handleCanvasTouchMove}
            onTouchEnd={handleCanvasTouchEnd}
            onTouchCancel={() => {
              isPanningRef.current = false;
              setCanvasGestureAttrs(false, false);
            }}
            onDragEnter={(e) => {
              const hasBlockDrag = e.dataTransfer.types.includes('application/x-callflow-block');
              const hasOsFiles = e.dataTransfer.types.includes('Files');
              if (!hasBlockDrag && hasOsFiles) {
                e.preventDefault();
                canvasFileDragDepthRef.current += 1;
                setIsDraggingCanvasFile(true);
              }
            }}
            onDragOver={(e) => {
              const hasBlockDrag = e.dataTransfer.types.includes('application/x-callflow-block');
              const hasOsFiles = e.dataTransfer.types.includes('Files');
              if (hasBlockDrag) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              } else if (hasOsFiles) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                if (!isDraggingCanvasFile) setIsDraggingCanvasFile(true);
              }
            }}
            onDragLeave={(e) => {
              if (e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('application/x-callflow-block')) {
                canvasFileDragDepthRef.current = Math.max(0, canvasFileDragDepthRef.current - 1);
                if (canvasFileDragDepthRef.current === 0) {
                  setIsDraggingCanvasFile(false);
                }
              }
            }}
            onDrop={(e) => {
              const rawBlock = e.dataTransfer.getData('application/x-callflow-block') as
                | CallflowBuildingBlockType
                | '';
              if (rawBlock) {
                e.preventDefault();
                const directDropNodeId = resolveClickedNodeIdFromSvgElement(
                  e.target as Element,
                  callflowGraph
                );
                const magneticDockNodeId =
                  !directDropNodeId && liveSvgIndexRef.current
                    ? findNearestMagneticPort(
                        liveSvgIndexRef.current,
                        e.clientX,
                        e.clientY,
                        '',
                        36
                      )?.nodeId || null
                    : null;
                handleAddBuildingBlock(rawBlock, directDropNodeId || magneticDockNodeId);
                return;
              }
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                canvasFileDragDepthRef.current = 0;
                setIsDraggingCanvasFile(false);
                void extractFilesFromDataTransfer(e.dataTransfer).then((extracted) => {
                  void handleCanvasFilesDrop(extracted.files, extracted.hasDirectory);
                });
              }
            }}
            onDoubleClick={(e) => {
              if (isCanvasOverlayTarget(e.target) || !coloredSvg) return;
              const doubleClickedNodeId = resolveNodeIdAtClientPoint(
                e.target as Element,
                e.clientX,
                e.clientY
              );
              if (doubleClickedNodeId) {
                e.stopPropagation();
                handleOpenNodeEditor(doubleClickedNodeId);
                return;
              }
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className={`flex-1 relative flex items-center justify-center ${
              coloredSvg
                ? `mermaid-canvas-viewport overflow-hidden touch-none ${
                    isVisualEditMode && visualEditTool === 'connect'
                      ? 'cursor-crosshair'
                      : 'cursor-grab'
                  }`
                : 'overflow-y-auto overscroll-contain touch-pan-y p-3 sm:p-6'
            } ${
              canvasSurface === 'dark'
                ? showGrid
                  ? 'canvas-grid-dark'
                  : 'bg-[#0b0f19]'
                : showGrid
                ? 'canvas-grid-light'
                : 'bg-white'
            }`}
          >
            {/* Focused OS File Drag-and-Drop Overlay for Avaya .s, Text & Visio Files */}
            {isDraggingCanvasFile && (
              <div
                data-canvas-ui="true"
                className="absolute inset-3 z-30 rounded-2xl border-2 border-dashed border-indigo-400 bg-slate-950/95 flex flex-col items-center justify-center gap-2.5 p-6 text-center pointer-events-none shadow-2xl"
              >
                <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/40 flex items-center justify-center">
                  <FolderUp className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="text-sm font-semibold text-slate-100">
                  Avaya `.s`-Skripte oder Visio-Exporte hier ablegen
                </div>
                <p className="text-xs text-slate-400 max-w-md">
                  Dateien (`.s`, `.txt`, `.vsdx`, `.vdx`, `.svg`) werden direkt dekodiert und in
                  den Callflow-Arbeitsbereich integriert.
                </p>
              </div>
            )}

            {/* Canvas Overlay Stack: File Drop Status + Active Trace Banner + Non-destructive Syntax Warning */}
            {(canvasFileDropNotice ||
              callflowTrace ||
              (!validation.isValid && effectiveMermaidCode.trim().length > 0)) && (
              <div
                data-canvas-ui="true"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                className="absolute top-3 left-3 right-3 sm:right-auto z-20 flex flex-col items-start gap-2 pointer-events-none"
              >
                {canvasFileDropNotice && (
                  <div
                    className={`pointer-events-auto px-3.5 py-2 rounded-xl border text-xs flex items-center gap-2.5 shadow-xl max-w-full ${
                      canvasFileDropNotice.kind === 'success'
                        ? 'bg-slate-900/95 border-emerald-500/50 text-emerald-200'
                        : 'bg-rose-950/95 border-rose-500/60 text-rose-200'
                    }`}
                  >
                    {canvasFileDropNotice.kind === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <span>{canvasFileDropNotice.message}</span>
                    <button
                      type="button"
                      onClick={() => setCanvasFileDropNotice(null)}
                      className="text-slate-400 hover:text-slate-100 ml-1 cursor-pointer"
                      aria-label="Hinweis schließen"
                    >
                      ×
                    </button>
                  </div>
                )}
                {callflowTrace && (
                  <div className="pointer-events-auto px-3.5 py-2 rounded-xl bg-slate-900/95 border border-amber-500/60 text-xs flex flex-wrap items-center gap-2.5 shadow-xl max-w-full">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 shrink-0" />
                      <span className="text-slate-300">Pfad:</span>
                      <strong className="font-mono text-amber-300">
                        {callflowTrace.selectedNode.label}
                      </strong>
                      <span className="text-slate-400 tabular-nums">
                        ({callflowTrace.entryPoints.length} Start →{' '}
                        {callflowTrace.terminalPoints.length} Ende
                        {callflowTrace.cycleEdges.length > 0
                          ? ` · ${callflowTrace.cycleEdges.length} ↻`
                          : ''}
                        )
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="flex items-center gap-0.5 p-0.5 bg-slate-950 border border-slate-800 rounded-md">
                        {[
                          { id: 'both' as const, label: 'Ganzer Pfad' },
                          { id: 'upstream' as const, label: 'Nur Woher' },
                          { id: 'downstream' as const, label: 'Nur Wohin' },
                        ].map((dirOpt) => (
                          <button
                            key={dirOpt.id}
                            type="button"
                            onClick={() => setCallflowDirectionFilter(dirOpt.id)}
                            className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              callflowDirectionFilter === dirOpt.id
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {dirOpt.label}
                          </button>
                        ))}
                      </div>

                      <div
                        className="flex items-center gap-0.5 p-0.5 bg-slate-950 border border-slate-800 rounded-md"
                        title="Pfad-Tiefe in Ebenen ab Fokus-Knoten"
                      >
                        {[
                          { id: 1 as const, label: '1 Schritt' },
                          { id: 2 as const, label: '2 Ebenen' },
                          { id: 'all' as const, label: 'Alle' },
                        ].map((hopOpt) => (
                          <button
                            key={String(hopOpt.id)}
                            type="button"
                            onClick={() => setCallflowHopDepth(hopOpt.id)}
                            className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              callflowHopDepth === hopOpt.id
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {hopOpt.label}
                          </button>
                        ))}
                      </div>

                      {selectedNodeScriptTarget && (
                        <button
                          type="button"
                          onClick={() =>
                            handleSwitchCallflowViewLevel({
                              level: 'detail',
                              scriptNumber: selectedNodeScriptTarget.scriptNumber,
                            })
                          }
                          className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <span>Skript [{selectedNodeScriptTarget.scriptNumber}] öffnen</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleFocusNodeOnCanvas(callflowTrace.selectedNode.id, 1.35)}
                        title="Kamera direkt auf diesen Knoten zentrieren und lesbar heranzoomen"
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Fokus 1:1
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsolateSubgraphMode((prev) => !prev)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                          isolateSubgraphMode
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                        }`}
                      >
                        <Filter className="w-3 h-3" />
                        <span>
                          {isolateSubgraphMode ? 'Alle einblenden' : 'Pfad isolieren'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCallflowNodeId(null);
                          setIsolateSubgraphMode(false);
                        }}
                        className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Filter ×
                      </button>
                    </div>
                  </div>
                )}

                {!validation.isValid && effectiveMermaidCode.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (validation.errorLine) {
                        handleJumpToErrorLine(validation.errorLine);
                      } else {
                        setMobileActivePane('editor');
                        setIsDesktopEditorCollapsed(false);
                      }
                    }}
                    className="pointer-events-auto px-3 py-2 rounded-lg bg-rose-950/95 border border-rose-700/70 text-rose-200 text-xs flex items-center gap-2 shadow-lg text-left max-w-full cursor-pointer"
                  >
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span className="truncate">
                      Syntaxfehler im Editor
                      {validation.errorLine ? ` (Zeile ${validation.errorLine})` : ''} — Tippen zum
                      Korrigieren
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* Floating Edge Action Bar: Click any connection line to edit label or detach cleanly */}
            {selectedCallflowEdge && (
              <div
                data-canvas-ui="true"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3.5 py-2.5 rounded-xl bg-slate-900/95 border border-amber-500/75 text-xs flex flex-wrap items-center gap-2.5 shadow-2xl max-w-[calc(100%-1.5rem)]"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 shrink-0" />
                  <span className="text-slate-400 shrink-0">Verbindung:</span>
                  <strong className="font-mono text-indigo-300 truncate max-w-[140px]">
                    {callflowGraph.nodes.get(selectedCallflowEdge.from)?.label ||
                      selectedCallflowEdge.from}
                  </strong>
                  <ArrowRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <strong className="font-mono text-emerald-300 truncate max-w-[140px]">
                    {callflowGraph.nodes.get(selectedCallflowEdge.to)?.label ||
                      selectedCallflowEdge.to}
                  </strong>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {['Taste 1', 'Überlauf', 'Feiertag', 'Sprung'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleSaveSelectedEdgeLabel(preset)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-600 text-[11px] text-slate-200 hover:text-white transition-colors cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                  <input
                    type="text"
                    value={selectedCallflowEdge.labelDraft}
                    onChange={(e) =>
                      setSelectedCallflowEdge((prev) =>
                        prev ? { ...prev, labelDraft: e.target.value } : null
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSaveSelectedEdgeLabel();
                      }
                    }}
                    placeholder="Beschriftung ändern..."
                    className="w-32 px-2 py-0.5 bg-slate-950 border border-slate-700 rounded text-[11px] text-slate-100 focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveSelectedEdgeLabel()}
                    className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold cursor-pointer"
                  >
                    Speichern
                  </button>
                </div>

                <div className="flex items-center gap-1.5 ml-auto">
                  <button
                    type="button"
                    onClick={handleDisconnectSelectedEdge}
                    title="Verbindung sauber lösen (Taste: Entf)"
                    className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                    <span>Verbindung lösen</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCallflowEdge(null)}
                    aria-label="Auswahl schließen"
                    className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              </div>
            )}

            {/* Quick Label Customization Banner after dragging a new Connection Wire */}
            {recentConnectionBanner && (
              <div
                data-canvas-ui="true"
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute top-3 right-3 z-30 px-3.5 py-2.5 rounded-xl bg-slate-900/95 border border-indigo-500/70 text-xs flex flex-wrap items-center gap-2 shadow-2xl max-w-lg"
              >
                <span className="text-slate-200 font-medium">
                  Verknüpft:{' '}
                  <strong className="font-mono text-indigo-300">
                    {recentConnectionBanner.fromLabel}
                  </strong>{' '}
                  →{' '}
                  <strong className="font-mono text-emerald-300">
                    {recentConnectionBanner.toLabel}
                  </strong>
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {['Taste 1', 'Taste 2', 'Überlauf', 'Feiertag'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleApplyRecentConnectionLabel(preset)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-600 text-[11px] text-slate-200 hover:text-white transition-colors cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                  <input
                    type="text"
                    value={recentConnectionBanner.labelDraft}
                    onChange={(e) =>
                      setRecentConnectionBanner((prev) =>
                        prev ? { ...prev, labelDraft: e.target.value } : null
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleApplyRecentConnectionLabel(recentConnectionBanner.labelDraft);
                      }
                    }}
                    placeholder="Eigene Beschriftung..."
                    className="w-32 px-2 py-0.5 bg-slate-950 border border-slate-700 rounded text-[11px] text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handleApplyRecentConnectionLabel(recentConnectionBanner.labelDraft)
                    }
                    className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold cursor-pointer"
                  >
                    OK
                  </button>
                </div>
              </div>
            )}

            {/* Live Rubberband SVG Connection Wire Overlay while dragging a new transition */}
            {activeWirePreview && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none z-30"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="callflow-wire-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path
                      d="M 0 0 L 10 5 L 0 10 z"
                      fill={activeWirePreview.hoverTargetNodeId ? '#10b981' : '#6366f1'}
                    />
                  </marker>
                </defs>
                <line
                  ref={wireLineRef}
                  x1={activeWirePreview.startX}
                  y1={activeWirePreview.startY}
                  x2={activeWirePreview.curX}
                  y2={activeWirePreview.curY}
                  stroke={activeWirePreview.hoverTargetNodeId ? '#10b981' : '#6366f1'}
                  strokeWidth="3"
                  strokeDasharray="6 4"
                  markerEnd="url(#callflow-wire-arrow)"
                />
                <circle
                  cx={activeWirePreview.startX}
                  cy={activeWirePreview.startY}
                  r="5"
                  fill="#6366f1"
                />
                {activeWirePreview.snappedPortSide && (
                  <circle
                    cx={activeWirePreview.curX}
                    cy={activeWirePreview.curY}
                    r="8"
                    fill="rgba(16, 185, 129, 0.25)"
                    stroke="#10b981"
                    strokeWidth="2.5"
                  />
                )}
              </svg>
            )}

            {coloredSvg && !preloadProgress?.active ? (
              <MemoizedSvgStage
                ref={stageElRef}
                svgHtml={coloredSvg}
                gpuProxy={gpuProxy}
              />
            ) : callflowViewLevel.level === 'welcome' &&
              (scriptWorkspace.modules.length > 0 || code.trim().length > 0) ? (
              (() => {
                const totalRulesCount = scriptWorkspace.modules.reduce(
                  (sum, m) => sum + (m.rules?.length || 0),
                  0
                );
                const mainMod =
                  scriptWorkspace.modules.find(
                    (m) =>
                      canonicalScriptMatchKey(m.scriptNumber) === 'main' ||
                      (m.isMaster && /^(?:main|start|master(?:script)?)$/i.test(m.scriptNumber))
                  ) || scriptWorkspace.modules.find((m) => m.isMaster);
                const isDarkCanvas = canvasSurface === 'dark';

                return (
                  <div
                    data-canvas-ui="true"
                    onMouseDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    className={`max-w-lg w-full mx-auto my-auto p-5 sm:p-6 rounded-xl border shadow-2xl space-y-4 ${
                      isDarkCanvas
                        ? 'bg-slate-900/95 border-slate-800 text-slate-100'
                        : 'bg-white/95 border-slate-200 text-slate-900'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-400">
                        Schnellstart · Leere Willkommensseite
                      </div>
                      <h2 className="text-base sm:text-lg font-semibold leading-snug">
                        {scriptWorkspace.modules.length > 0
                          ? diagramTitle || 'Callflow bereit'
                          : diagramTitle || 'Diagramm bereit'}
                      </h2>
                      <p
                        className={`text-xs leading-relaxed tabular-nums ${
                          isDarkCanvas ? 'text-slate-400' : 'text-slate-600'
                        }`}
                      >
                        {scriptWorkspace.modules.length > 0
                          ? `${scriptWorkspace.modules.length} Skripte · ${totalRulesCount} Regeln geladen. Das Hauptscript wird erst bei Klick gerendert.`
                          : `${code.split('\n').length} Mermaid-Zeilen geladen. Grafik wird erst bei Bedarf gerendert.`}
                      </p>
                    </div>

                    {scriptWorkspace.modules.length > 0 ? (
                      <div className="space-y-2.5">
                        <div className="flex flex-col sm:flex-row gap-2">
                          <button
                            type="button"
                            onClick={() => handleSwitchCallflowViewLevel({ level: 'master' })}
                            className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                          >
                            <Layers className="w-4 h-4 shrink-0" />
                            <span>Hauptscript (Master-Karte) laden</span>
                          </button>
                          {mainMod && (
                            <button
                              type="button"
                              onClick={() =>
                                handleSwitchCallflowViewLevel({
                                  level: 'detail',
                                  scriptNumber: mainMod.scriptNumber,
                                })
                              }
                              className={`py-2.5 px-3.5 text-xs font-semibold rounded-lg border transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                                isDarkCanvas
                                  ? 'bg-slate-950 hover:bg-slate-800 border-slate-700 text-slate-100'
                                  : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-900'
                              }`}
                            >
                              <GitBranch className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span>Main öffnen</span>
                            </button>
                          )}
                        </div>

                        <div className="space-y-1">
                          <span
                            className={`text-[11px] font-medium block ${
                              isDarkCanvas ? 'text-slate-400' : 'text-slate-600'
                            }`}
                          >
                            Oder direkt einzelnes Skript ohne Master-Render öffnen:
                          </span>
                          <SearchableScriptDropdown
                            viewLevel={callflowViewLevel}
                            modules={scriptWorkspace.modules}
                            onSwitchViewLevel={handleSwitchCallflowViewLevel}
                            variant="full"
                            align="left"
                            placeholder="Skript auswählen (Nr., Name, SondZeit)..."
                          />
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCallflowViewLevel({ level: 'master' })}
                        className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                      >
                        <Eye className="w-4 h-4 shrink-0" />
                        <span>Diagramm jetzt rendern</span>
                      </button>
                    )}

                    <div
                      className={`pt-3 border-t flex flex-wrap items-center justify-between gap-2 text-[11px] ${
                        isDarkCanvas ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setIsGlobalSearchOpen(true)}
                          className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
                            isDarkCanvas
                              ? 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-200'
                              : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                          }`}
                        >
                          Suche (Strg+K)
                        </button>
                        {scriptWorkspace.modules.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setIsCallSimulatorOpen(true)}
                              className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
                                isDarkCanvas
                                  ? 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-emerald-300'
                                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-emerald-700'
                              }`}
                            >
                              Anruf-Simulator
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpeningHoursInitialSearch('');
                                setIsOpeningHoursModalOpen(true);
                              }}
                              className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
                                isDarkCanvas
                                  ? 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-amber-300'
                                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-amber-700'
                              }`}
                            >
                              Öffnungszeiten
                            </button>
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsExportModalOpen(true)}
                        className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                      >
                        Callflow.html exportieren →
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : scriptWorkspace.modules.length > 0 || code.trim().length > 0 ? (
              preloadProgress?.active && !masterRenderError ? (
                <div className="w-full h-full" aria-hidden="true" />
              ) : (
                <div
                  data-canvas-ui="true"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  className="max-w-lg w-full mx-auto my-auto p-6 rounded-2xl bg-slate-900/95 border border-slate-800 text-slate-200 space-y-4 shadow-2xl text-center"
                >
                  {(validation.isValid || !effectiveMermaidCode.trim()) && !masterRenderError ? (
                    <>
                      <div className="w-8 h-8 mx-auto rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-slate-100">
                          Master-Gesamtkarte wird aufgebaut …
                        </p>
                        <p className="text-xs text-slate-400">
                          {scriptWorkspace.modules.length > 0
                            ? `${scriptWorkspace.modules.length} Skript-Modul(e) werden lokal gerendert und eingepasst.`
                            : 'Mermaid-Grafik wird lokal gerendert.'}
                        </p>
                      </div>
                    </>
                  ) : (
                  <>
                    <AlertTriangle className="w-8 h-8 mx-auto text-rose-400" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-rose-200">
                        Diagramm konnte nicht direkt gerendert werden
                      </p>
                      <p className="text-xs text-slate-400 break-words">
                        {masterRenderError ||
                          validation.errorMessage ||
                          'Syntaxfehler im generierten Mermaid-Code.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      {scriptWorkspace.modules.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const fallback = buildSafeFallbackMasterMermaid(
                              scriptWorkspace,
                              currentDirection || 'LR'
                            );
                            pendingAutoFitRef.current = true;
                            setMasterRenderError(null);
                            setCode(fallback);
                          }}
                          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                        >
                          Übersicht neu aufbauen
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleChangeWorkspaceMode('free')}
                        className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                      >
                        Zum Freien Modus (Editor)
                      </button>
                    </div>
                  </>
                )}
              </div>
              )
            ) : workspaceMode === 'guided' ? (
              <div
                data-canvas-ui="true"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                className="max-w-lg w-full mx-auto my-auto p-5 sm:p-7 rounded-2xl bg-slate-900/95 border border-slate-800 text-slate-200 space-y-4 sm:space-y-5 shadow-2xl"
              >
                <div className="space-y-1.5 text-center">
                  <span className="inline-block px-2.5 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-[11px] font-semibold text-indigo-300">
                    Geführter Modus · Ohne Mermaid-Ballast
                  </span>
                  <h2 className="text-base sm:text-lg font-bold text-slate-100">
                    Callflow in 3 klaren Schritten aufbauen
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Der Mermaid-Code-Editor ist bewusst ausgeblendet. Sie starten rechts mit dem Einstiegsskript <strong className="text-slate-200">Main</strong> und erhalten auf Ebene 1 die <strong className="text-slate-200">Master-Gesamtkarte</strong>:
                  </p>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-950/90 border border-indigo-500/40 flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-md bg-indigo-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                      1
                    </span>
                    <div>
                      <div className="font-semibold text-slate-100">Main (Einstiegsskript) laden</div>
                      <div className="text-[11px] text-slate-400">
                        Erstes Startskript (Avaya `.s`, AACC-Text oder Visio) auf den Canvas ziehen oder rechts einfügen – wird automatisch als <strong className="text-slate-200">Main</strong> geführt.
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-md bg-slate-800 text-slate-300 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                      2
                    </span>
                    <div>
                      <div className="font-semibold text-slate-200">Ausstehende Referenzen abarbeiten</div>
                      <div className="text-[11px] text-slate-400">
                        Erkannte Unter-Skripte (3- bis 6-stellig oder benannt) der Reihe nach ergänzen.
                      </div>
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-md bg-slate-800 text-slate-300 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                      3
                    </span>
                    <div>
                      <div className="font-semibold text-slate-200">Prüfen &amp; Exportieren</div>
                      <div className="text-[11px] text-slate-400">
                        Automatischer Logik-Check, Variablen-Register &amp; Excel-Routing-Matrix (.csv).
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setGuidedStep(1);
                      setIsRightPanelOpen(true);
                      setRightSidebarTab('callflow');
                      setMobileActivePane('callflow');
                    }}
                    className="lg:hidden px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Zu Schritt 1 (Main laden)</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsNewCallflowModalOpen(true)}
                    className="px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Main per Dialog starten</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChangeWorkspaceMode('free')}
                    className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                  >
                    Zum Freien Modus (Editor)
                  </button>
                </div>
              </div>
            ) : (
              <div
                data-canvas-ui="true"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                className="max-w-md w-full mx-auto my-auto text-center p-6 sm:p-8 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-300 space-y-4"
              >
                <p className="text-sm font-semibold text-slate-100">
                  Arbeitsbereich ist leer
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Starten Sie einen neuen Callflow mit <span className="font-mono text-slate-200">Main</span>{' '}
                  (Text oder grafischer Export), bestätigen Sie die erkannten Folgeskripte und
                  ergänzen Sie anschließend Schritt für Schritt jedes Detail-Skript.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsNewCallflowModalOpen(true)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Neuer Callflow</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsMultiScriptModalOpen(true)}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Mehrere importieren
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryModal({ isOpen: true, tab: 'templates' })}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Vorlagen
                  </button>
                </div>
              </div>
            )}

            {/* Floating Bottom-Right Minimap & Viewport Reset Controls */}
            <div className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2 pointer-events-none">
              {coloredSvg && (zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
                <button
                  type="button"
                  data-canvas-ui="true"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  className="pointer-events-auto px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5 shadow-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Ansicht zentrieren</span>
                </button>
              )}
              {coloredSvg && showMinimap && (
                <div className="pointer-events-auto" data-canvas-ui="true">
                  <CanvasMinimap
                    visible={showMinimap}
                    thumbnailUrl={gpuProxy?.objectUrl || null}
                    svgWidth={gpuProxy?.width || getSvgDimensions(coloredSvg).width}
                    svgHeight={gpuProxy?.height || getSvgDimensions(coloredSvg).height}
                    viewportWidth={canvasViewportRef.current?.clientWidth || 960}
                    viewportHeight={canvasViewportRef.current?.clientHeight || 640}
                    zoom={zoom}
                    panX={pan.x}
                    panY={pan.y}
                    isDarkSurface={canvasSurface === 'dark'}
                    onPanTo={(nextPanX, nextPanY) => {
                      applyCameraToDom(nextPanX, nextPanY, cameraRef.current.zoom, false);
                      setPan({ x: Math.round(nextPanX), y: Math.round(nextPanY) });
                    }}
                    onClose={() => setShowMinimap(false)}
                  />
                </div>
              )}
            </div>

            {/* Live Floating Call Simulator HUD (Play/Pause, Back/Forward, Speed, Step Timeline) */}
            {isCallSimulatorOpen && callflowSimulationModel.scripts.length > 0 && (
              <div className="absolute bottom-3 left-3 right-3 z-30 pointer-events-none flex justify-center">
                <CallSimulatorHud
                  isOpen={isCallSimulatorOpen}
                  onClose={() => setIsCallSimulatorOpen(false)}
                  model={callflowSimulationModel}
                  activeScriptNumber={
                    callflowViewLevel.level === 'detail' ? callflowViewLevel.scriptNumber : null
                  }
                  isDarkSurface={canvasSurface === 'dark'}
                  onFocusStep={handleSimulatorFocusStep}
                />
              </div>
            )}
          </div>

          {/* Interactive Logic Legend & Path Swatch Footer Bar */}
          {coloredSvg && (
            <div className="px-3 sm:px-4 py-2 border-t border-slate-800 bg-slate-900/95 flex items-center justify-between gap-4 overflow-x-auto text-xs shrink-0">
              <div className="flex items-center gap-3.5 overflow-x-auto">
                {callflowTrace && !isolateSubgraphMode ? (
                  <>
                    <span className="text-amber-300 font-semibold whitespace-nowrap shrink-0">
                      Aktiver Pfad:
                    </span>
                    <div className="flex items-center gap-3 overflow-x-auto">
                      {callflowDirectionFilter !== 'downstream' && (
                        <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
                          <span
                            className="w-4 h-0 border-t-[2.5px] border-solid shrink-0"
                            style={{ borderTopColor: canvasSurface === 'dark' ? '#38bdf8' : '#0284c7' }}
                          />
                          <span className="text-slate-200">Woher (Eingehend)</span>
                          <span className="text-slate-500 font-mono tabular-nums">
                            ({callflowTrace.upstreamEdges.length})
                          </span>
                        </div>
                      )}
                      {callflowDirectionFilter !== 'upstream' && (
                        <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
                          <span
                            className="w-4 h-0 border-t-[2.5px] border-solid shrink-0"
                            style={{ borderTopColor: canvasSurface === 'dark' ? '#34d399' : '#059669' }}
                          />
                          <span className="text-slate-200">Wohin (Ausgehend)</span>
                          <span className="text-slate-500 font-mono tabular-nums">
                            ({callflowTrace.downstreamEdges.length})
                          </span>
                        </div>
                      )}
                      {callflowTrace.cycleEdges.length > 0 && (
                        <div className="flex items-center gap-1.5 whitespace-nowrap shrink-0">
                          <span
                            className="w-4 h-0 border-t-[2.5px] border-dashed shrink-0"
                            style={{ borderTopColor: canvasSurface === 'dark' ? '#fb7185' : '#e11d48' }}
                          />
                          <span className="text-slate-200">Zyklus / Rücksprung</span>
                          <span className="text-slate-500 font-mono tabular-nums">
                            ({callflowTrace.cycleEdges.length})
                          </span>
                        </div>
                      )}
                    </div>
                    <span className="text-slate-700 shrink-0" aria-hidden="true">
                      |
                    </span>
                    <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0 text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-xs border border-amber-400 bg-amber-950/70" />
                        Fokus
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-xs border border-sky-400 bg-sky-950/70" />
                        Aufrufer
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-xs border border-emerald-400 bg-emerald-950/70" />
                        Folgeschritte
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-xs border border-rose-400 bg-rose-950/70" />
                        Endpunkt
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-indigo-300 font-medium whitespace-nowrap shrink-0">
                      {pathColorMode === 'branches'
                        ? 'Pfade (B: Verzweigung):'
                        : 'Pfade (A: Semantik):'}
                    </span>
                    {logicSummary.legend.filter((it) => it.kind === 'edge').length > 0 ? (
                      <div className="flex items-center gap-3 overflow-x-auto">
                        {logicSummary.legend
                          .filter((it) => it.kind === 'edge')
                          .map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                              <span
                                className={`w-4 h-0 border-t-[2.5px] shrink-0 ${
                                  item.dashed ? 'border-dashed' : 'border-solid'
                                }`}
                                style={{ borderTopColor: item.borderColor }}
                              />
                              <span className="text-slate-200">{item.label}</span>
                              <span className="text-slate-500 font-mono tabular-nums">
                                ({item.count})
                              </span>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <span className="text-slate-400 whitespace-nowrap shrink-0">
                        Knoten antippen für Callflow-Pfad
                      </span>
                    )}
                    {logicSummary.legend.filter((it) => it.kind !== 'edge').length > 0 && (
                      <>
                        <span className="text-slate-700 shrink-0" aria-hidden="true">
                          |
                        </span>
                        <span className="text-slate-400 font-medium whitespace-nowrap shrink-0">
                          Knoten:
                        </span>
                        <div className="flex items-center gap-3 overflow-x-auto">
                          {logicSummary.legend
                            .filter((it) => it.kind !== 'edge')
                            .map((item) => (
                              <div
                                key={item.id}
                                className="flex items-center gap-1.5 whitespace-nowrap shrink-0"
                              >
                                <span
                                  className="w-3 h-3 rounded-xs border shrink-0"
                                  style={{
                                    backgroundColor: item.fillColor,
                                    borderColor: item.borderColor,
                                  }}
                                />
                                <span className="text-slate-200">{item.label}</span>
                                <span className="text-slate-500 font-mono tabular-nums">
                                  ({item.count})
                                </span>
                              </div>
                            ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Pane 3 (Mobile Tabs): Callflow Inspector or Theme Studio */}
        {mobileActivePane === 'callflow' && (
          <div className="flex lg:hidden w-full min-w-0 h-full overflow-hidden">
            <CallflowInspector
              graph={callflowGraph}
              selectedNodeId={selectedCallflowNodeId}
              onSelectNodeId={setSelectedCallflowNodeId}
              onFocusNodeOnCanvas={handleFocusNodeMobileCb}
              traceResult={callflowTrace}
              directionFilter={callflowDirectionFilter}
              onChangeDirectionFilter={setCallflowDirectionFilter}
              hopDepth={callflowHopDepth}
              onChangeHopDepth={setCallflowHopDepth}
              isolateSubgraphMode={isolateSubgraphMode}
              onToggleIsolateSubgraphMode={setIsolateSubgraphMode}
              themeConfig={themeConfig}
              onChangeThemeConfig={setThemeConfig}
              scriptWorkspace={scriptWorkspace}
              viewLevel={callflowViewLevel}
              onOpenNewCallflowModal={handleOpenNewCallflowModalCb}
              onOpenMultiScriptModal={openMultiScriptModalWithPrefill}
              onSwitchViewLevel={handleSwitchViewLevelCb}
              onResolveIssue={handleResolveCallflowIssue}
              onReopenIssue={handleReopenCallflowIssue}
              onAddManualQuestion={handleAddManualCallflowQuestion}
              onSelectMasterScript={handleSelectMasterScript}
              onSubmitChecklistDetailScript={handleSubmitChecklistDetailScript}
              onSubmitChecklistVisioFile={handleSubmitChecklistVisioFile}
              onUnignoreChecklistTarget={handleUnignoreChecklistTarget}
              focusChecklistTrigger={checklistFocusTrigger}
              onExportInteractiveHtml={handleExportHtmlFromInspectorCb}
              isExportingHtml={isDownloadingHtml || Boolean(htmlExportProgress?.active)}
              onClose={handleCloseMobileInspectorCb}
              isMobileView={true}
              workspaceMode={workspaceMode}
              onChangeWorkspaceMode={handleChangeWorkspaceMode}
              guidedStep={guidedStep}
              onChangeGuidedStep={setGuidedStep}
              isVisualEditMode={isVisualEditMode}
              onToggleVisualEditMode={setIsVisualEditMode}
              onAddBuildingBlock={handleAddBuildingBlockDefaultCb}
              onOpenNodeEditor={handleOpenNodeEditor}
              onResetAllNodeOffsets={handleResetAllNodeOffsets}
              hasCustomNodeOffsets={hasCustomNodeOffsets}
              assignedFolderPool={assignedFolderPool}
              lastFolderResolveSummary={lastFolderResolveSummary}
              isAutoResolvingFolder={isAutoResolvingFolder}
              onAssignFolderAndAutoResolve={handleAssignFolderAndAutoResolve}
              onSelectStartScriptFromAssignedFolder={handleSelectStartScriptFromAssignedFolder}
              onClearAssignedFolder={handleClearAssignedFolder}
              onRecomputeWorkspaceIndex={handleRecomputeWorkspaceIndex}
              lastRecomputedAt={lastIndexRecomputedAt}
            />
          </div>
        )}

        {mobileActivePane === 'theme' && (
          <div className="flex lg:hidden w-full min-w-0 h-full overflow-hidden">
            <ThemeConfigurator
              themeConfig={themeConfig}
              onChangeTheme={setThemeConfig}
              smartColorMode={smartColorMode}
              onChangeSmartColorMode={setSmartColorMode}
              hiddenNodeTypes={hiddenSmartNodeTypes}
              onChangeHiddenNodeTypes={setHiddenSmartNodeTypes}
              logicSummary={logicSummary}
              onInjectSmartClassDefs={handleInjectSmartClassDefs}
              currentDirection={currentDirection}
              onChangeDirection={handleChangeDirection}
              onInjectInitDirective={handleInjectInitDirective}
              canvasSurface={canvasSurface}
              onChangeCanvasSurface={handleChangeCanvasSurface}
              onClose={handleCloseMobileInspectorCb}
              isMobileView={true}
            />
          </div>
        )}

        {/* Pane 3 (Desktop Right Sidebar: Guided 3-Step Assistant in Guided Mode, or Switchable Studio Tabs in Free Mode) */}
        {(isRightPanelOpen || workspaceMode === 'guided') && !isFullscreenPreview && (
          <div className="hidden lg:flex flex-col h-full shrink-0 border-l border-slate-800 bg-slate-900/95">
            {/* Desktop Right Sidebar Mode Switcher (only shown in Free Mode) */}
            {workspaceMode === 'free' && (
              <div className="grid grid-cols-2 gap-1 p-1.5 bg-slate-950 border-b border-slate-800 shrink-0">
                <button
                  type="button"
                  onClick={() => setRightSidebarTab('callflow')}
                  className={`py-1.5 px-2.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    rightSidebarTab === 'callflow'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>Callflow &amp; ELK</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRightSidebarTab('theme')}
                  className={`py-1.5 px-2.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    rightSidebarTab === 'theme'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Palette className="w-3.5 h-3.5" />
                  <span>Logik-Farben</span>
                </button>
              </div>
            )}

            <div className="flex-1 min-h-0 flex overflow-hidden">
              {workspaceMode === 'guided' || rightSidebarTab === 'callflow' ? (
                <CallflowInspector
                  graph={callflowGraph}
                  selectedNodeId={selectedCallflowNodeId}
                  onSelectNodeId={setSelectedCallflowNodeId}
                  onFocusNodeOnCanvas={handleFocusNodeDesktopCb}
                  traceResult={callflowTrace}
                  directionFilter={callflowDirectionFilter}
                  onChangeDirectionFilter={setCallflowDirectionFilter}
                  hopDepth={callflowHopDepth}
                  onChangeHopDepth={setCallflowHopDepth}
                  isolateSubgraphMode={isolateSubgraphMode}
                  onToggleIsolateSubgraphMode={setIsolateSubgraphMode}
                  themeConfig={themeConfig}
                  onChangeThemeConfig={setThemeConfig}
                  scriptWorkspace={scriptWorkspace}
                  viewLevel={callflowViewLevel}
                  onOpenNewCallflowModal={handleOpenNewCallflowModalCb}
                  onOpenMultiScriptModal={openMultiScriptModalWithPrefill}
                  onSwitchViewLevel={handleSwitchViewLevelCb}
                  onResolveIssue={handleResolveCallflowIssue}
                  onReopenIssue={handleReopenCallflowIssue}
                  onAddManualQuestion={handleAddManualCallflowQuestion}
                  onSelectMasterScript={handleSelectMasterScript}
                  onSubmitChecklistDetailScript={handleSubmitChecklistDetailScript}
                  onSubmitChecklistVisioFile={handleSubmitChecklistVisioFile}
                  onUnignoreChecklistTarget={handleUnignoreChecklistTarget}
                  focusChecklistTrigger={checklistFocusTrigger}
                  onExportInteractiveHtml={handleExportHtmlFromInspectorCb}
                  isExportingHtml={isDownloadingHtml || Boolean(htmlExportProgress?.active)}
                  onClose={handleCloseDesktopRightPanelCb}
                  isMobileView={false}
                  workspaceMode={workspaceMode}
                  onChangeWorkspaceMode={handleChangeWorkspaceMode}
                  guidedStep={guidedStep}
                  onChangeGuidedStep={setGuidedStep}
                  isVisualEditMode={isVisualEditMode}
                  onToggleVisualEditMode={setIsVisualEditMode}
                  onAddBuildingBlock={handleAddBuildingBlockDefaultCb}
                  onOpenNodeEditor={handleOpenNodeEditor}
                  onResetAllNodeOffsets={handleResetAllNodeOffsets}
                  hasCustomNodeOffsets={hasCustomNodeOffsets}
                  assignedFolderPool={assignedFolderPool}
                  lastFolderResolveSummary={lastFolderResolveSummary}
                  isAutoResolvingFolder={isAutoResolvingFolder}
                  onAssignFolderAndAutoResolve={handleAssignFolderAndAutoResolve}
                  onSelectStartScriptFromAssignedFolder={handleSelectStartScriptFromAssignedFolder}
                  onClearAssignedFolder={handleClearAssignedFolder}
                  onRecomputeWorkspaceIndex={handleRecomputeWorkspaceIndex}
                  lastRecomputedAt={lastIndexRecomputedAt}
                />
              ) : (
                <ThemeConfigurator
                  themeConfig={themeConfig}
                  onChangeTheme={setThemeConfig}
                  smartColorMode={smartColorMode}
                  onChangeSmartColorMode={setSmartColorMode}
                  hiddenNodeTypes={hiddenSmartNodeTypes}
                  onChangeHiddenNodeTypes={setHiddenSmartNodeTypes}
                  logicSummary={logicSummary}
                  onInjectSmartClassDefs={handleInjectSmartClassDefs}
                  currentDirection={currentDirection}
                  onChangeDirection={handleChangeDirection}
                  onInjectInitDirective={handleInjectInitDirective}
                  canvasSurface={canvasSurface}
                  onChangeCanvasSurface={handleChangeCanvasSurface}
                  onClose={handleCloseDesktopRightPanelCb}
                  isMobileView={false}
                />
              )}
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Arbeitsbereich-Navigation"
        className={`lg:hidden h-14 border-t border-slate-800 bg-slate-950 grid ${
          workspaceMode === 'guided' ? 'grid-cols-2' : 'grid-cols-5'
        } items-center px-1.5 shrink-0 z-30`}
      >
        {workspaceMode === 'free' && (
          <button
            type="button"
            onClick={() => setMobileActivePane('editor')}
            className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center rounded-lg transition-colors ${
              mobileActivePane === 'editor'
                ? 'text-indigo-400 bg-indigo-950/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">
              Editor
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setMobileActivePane('preview')}
          className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center rounded-lg transition-colors ${
            mobileActivePane === 'preview'
              ? 'text-indigo-400 bg-indigo-950/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-1">
            <Eye className="w-4 h-4" />
            {!validation.isValid && effectiveMermaidCode.trim().length > 0 && (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            )}
          </div>
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">
            {workspaceMode === 'guided' ? 'Callflow-Diagramm' : 'Vorschau'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMobileActivePane('callflow')}
          className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center rounded-lg transition-colors ${
            mobileActivePane === 'callflow'
              ? 'text-indigo-400 bg-indigo-950/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <GitBranch className="w-4 h-4" />
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">
            {workspaceMode === 'guided' ? '3-Schritte-Assistent' : 'Callflow'}
          </span>
        </button>

        {workspaceMode === 'free' && (
          <button
            type="button"
            onClick={() => setMobileActivePane('theme')}
            className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center rounded-lg transition-colors ${
              mobileActivePane === 'theme'
                ? 'text-indigo-400 bg-indigo-950/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Palette className="w-4 h-4" />
            <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">
              Farben
            </span>
          </button>
        )}

        {workspaceMode === 'free' && (
          <button
            type="button"
            onClick={() => setLibraryModal({ isOpen: true, tab: 'templates' })}
            className="min-h-[44px] min-w-[44px] flex flex-col items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Layers className="w-4 h-4" />
            <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">
              Katalog
            </span>
          </button>
        )}
      </nav>

      {/* Modals */}
      <TemplateGalleryModal
        isOpen={libraryModal.isOpen}
        initialTab={libraryModal.tab}
        onClose={() => setLibraryModal((prev) => ({ ...prev, isOpen: false }))}
        onSelectTemplate={handleSelectTemplate}
        onInsertSnippet={handleInsertSnippet}
        savedDiagrams={savedDiagrams}
        onSaveCurrentDiagram={handleSaveCurrentDiagram}
        onLoadSavedDiagram={handleLoadSavedDiagram}
        onDeleteSavedDiagram={handleDeleteSavedDiagram}
        onImportFileContent={handleImportFileContent}
        currentTitle={diagramTitle}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => {
          if (htmlExportProgress?.phase === 'error') {
            setHtmlExportProgress(null);
          }
          setIsExportModalOpen(false);
        }}
        svgContent={isExportModalOpen ? buildExportSvgSnapshot(true) : coloredSvg}
        unfilteredSvgContent={isExportModalOpen ? buildExportSvgSnapshot(false) : coloredSvg}
        code={code}
        diagramTitle={diagramTitle}
        defaultBackground={canvasSurface}
        themeConfig={themeConfig}
        smartColorMode={smartColorMode}
        pathColorMode={pathColorMode}
        hiddenNodeTypes={hiddenSmartNodeTypes}
        callflowGraph={callflowGraph}
        scriptCount={scriptWorkspace.modules.length}
        defaultMasterCompact={isMasterCompact}
        buildInteractiveHtml={buildInteractiveHtmlForSurface}
        htmlExportProgress={htmlExportProgress}
        onCancelInteractiveHtml={cancelInteractiveHtmlExport}
        onExportOpeningHoursCsv={
          scriptWorkspace.modules.length > 0 ? handleExportOpeningHoursCsv : undefined
        }
        onExportRoutingMatrixCsv={
          scriptWorkspace.modules.length > 0 ? handleExportRoutingMatrixCsv : undefined
        }
        onExportMarkdownDoc={
          scriptWorkspace.modules.length > 0 ? handleExportMarkdownDoc : undefined
        }
      />

      {/* Dedicated Full-Screen Opaque Pre-Render Cover: hides all background UI completely until ready */}
      {preloadProgress?.active && !htmlExportProgress?.active && !isExportModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          aria-label="Ansichten werden vorab geladen"
          className="fixed inset-0 z-[100] bg-slate-950 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center shrink-0 mt-0.5">
                <div className="w-4 h-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
              </div>
              <div className="min-w-0 space-y-1">
                <h2 className="text-sm sm:text-base font-semibold text-slate-100 leading-snug">
                  Ansichten werden vorab geladen
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Alle Callflow-Diagramme werden vollständig vorbereitet, bevor die Oberfläche angezeigt wird.
                </p>
              </div>
            </div>

            <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl px-3.5 py-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-400 shrink-0">Aktuelle Ansicht</span>
                <span className="font-mono text-slate-200 truncate text-right">
                  {preloadProgress.currentLabel}
                </span>
              </div>

              <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-[width] duration-150 ease-out"
                  style={{
                    width: `${
                      preloadProgress.total > 0
                        ? Math.min(
                            100,
                            Math.max(
                              3,
                              Math.round(
                                (preloadProgress.completed / preloadProgress.total) * 100
                              )
                            )
                          )
                        : 100
                    }%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
                <span>
                  {preloadProgress.completed} von {preloadProgress.total} Ansichten bereit
                </span>
                <span className="font-mono text-emerald-400 font-semibold">
                  {preloadProgress.total > 0
                    ? Math.round((preloadProgress.completed / preloadProgress.total) * 100)
                    : 0}
                  %
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  preloadAbortControllerRef.current?.abort();
                  const activeHit = preloadedViewsRef.current.get(activeViewKeyRef.current);
                  if (activeHit) {
                    hasBaseRenderedSvgRef.current = true;
                    pendingAutoFitRef.current = true;
                    setMasterRenderError(null);
                    setBaseRenderedSvg(activeHit.rawSvg);
                  }
                  setPreloadProgress(null);
                }}
                className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Abbrechen &amp; direkt öffnen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Centered Interactive HTML Export Status Popup Modal */}
      {htmlExportProgress?.active && !isExportModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          aria-labelledby="html-export-dialog-title"
          className="fixed inset-0 z-[105] bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-start gap-3.5">
              <div
                className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${
                  htmlExportProgress.phase === 'error'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                    : 'bg-indigo-500/10 border-indigo-500/25'
                }`}
              >
                {htmlExportProgress.phase === 'error' ? (
                  <AlertTriangle className="w-4 h-4" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <h2
                  id="html-export-dialog-title"
                  className="text-sm sm:text-base font-semibold text-slate-100 leading-snug"
                >
                  {htmlExportProgress.phase === 'error'
                    ? 'HTML-Export unterbrochen'
                    : htmlExportProgress.phase === 'packaging'
                    ? 'HTML-Einzeldatei wird verpackt'
                    : htmlExportProgress.phase === 'preparing'
                    ? 'Callflow-Export wird vorbereitet'
                    : 'Interaktive Callflow-HTML wird erstellt'}
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {htmlExportProgress.phase === 'error'
                    ? htmlExportProgress.errorMessage ||
                      'Beim Erstellen der HTML-Datei ist ein unerwarteter Fehler aufgetreten.'
                    : 'Alle Skript-Ebenen und Analyse-Daten werden schrittweise für die Offline-Einzeldatei gerendert.'}
                </p>
              </div>
            </div>

            {htmlExportProgress.phase !== 'error' && (
              <div className="bg-slate-950/90 border border-slate-800/90 rounded-xl px-3.5 py-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400 shrink-0">Aktiver Schritt</span>
                  <span className="font-mono text-slate-200 truncate text-right">
                    {htmlExportProgress.currentLabel}
                  </span>
                </div>

                <div className="h-2.5 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-[width] duration-150 ease-out"
                    style={{
                      width: `${
                        htmlExportProgress.total > 0
                          ? Math.min(
                              100,
                              Math.max(
                                4,
                                Math.round(
                                  (htmlExportProgress.current / htmlExportProgress.total) * 100
                                )
                              )
                            )
                          : 100
                      }%`,
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
                  <span>
                    {htmlExportProgress.current} von {htmlExportProgress.total} Ansichten
                  </span>
                  <span className="font-mono text-emerald-400 font-semibold">
                    {htmlExportProgress.total > 0
                      ? Math.round((htmlExportProgress.current / htmlExportProgress.total) * 100)
                      : 0}
                    %
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400 tabular-nums pt-0.5 border-t border-slate-800/70">
                  {htmlExportProgress.cacheHits > 0 && (
                    <>
                      <span>{htmlExportProgress.cacheHits} aus Cache</span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  {(htmlExportProgress.fallbackCount || 0) > 0 && (
                    <>
                      <span className="text-amber-300">
                        {htmlExportProgress.fallbackCount} per Fallback
                      </span>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <span>
                    Zeitlimit {htmlExportProgress.timeoutSecondsPerView || 10} s / Ansicht
                  </span>
                </div>

                {htmlExportProgress.lastWarning && (
                  <div className="text-[11px] text-amber-300/90 truncate">
                    Hinweis: {htmlExportProgress.lastWarning}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-1">
              {htmlExportProgress.phase === 'error' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setHtmlExportProgress(null);
                      setIsDownloadingHtml(false);
                    }}
                    className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Schließen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHtmlExportProgress(null);
                      window.setTimeout(() => {
                        void handleQuickDownloadInteractiveHtml();
                      }, 40);
                    }}
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Erneut versuchen</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={cancelInteractiveHtmlExport}
                  className="px-3.5 py-2 text-xs font-medium text-rose-200 bg-rose-950/70 hover:bg-rose-900/80 border border-rose-500/40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Abbrechen
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {htmlExportNotice && !htmlExportProgress?.active && !isExportModalOpen && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-slate-900/95 border border-slate-700 text-xs font-medium text-slate-200 shadow-xl"
        >
          {htmlExportNotice}
        </div>
      )}

      <MultiScriptModal
        isOpen={isMultiScriptModalOpen}
        onClose={() => {
          setIsMultiScriptModalOpen(false);
          setMultiScriptPrefillNumber(null);
        }}
        workspace={scriptWorkspace}
        onUpdateWorkspace={setScriptWorkspace}
        onApplyMasterView={(ws) => handleSwitchCallflowViewLevel({ level: 'master' }, ws)}
        onOpenScriptDetail={(scriptNumber, ws) =>
          handleSwitchCallflowViewLevel({ level: 'detail', scriptNumber }, ws)
        }
        prefillScriptNumber={multiScriptPrefillNumber}
      />

      <OpeningHoursModal
        isOpen={isOpeningHoursModalOpen}
        onClose={() => setIsOpeningHoursModalOpen(false)}
        workspace={scriptWorkspace}
        initialSearchQuery={openingHoursInitialSearch}
        onJumpToScript={(scriptNumber) => {
          handleSwitchCallflowViewLevel({ level: 'detail', scriptNumber });
        }}
      />

      <GlobalSearchModal
        isOpen={isGlobalSearchOpen}
        onClose={() => setIsGlobalSearchOpen(false)}
        entries={globalSearchEntries}
        onSelectEntry={handleGlobalSearchSelect}
      />

      <NewCallflowModal
        isOpen={isNewCallflowModalOpen}
        hasExistingWorkspace={scriptWorkspace.modules.length > 0 || code.trim().length > 0}
        onClose={() => setIsNewCallflowModalOpen(false)}
        onStartNewCallflow={handleStartNewCallflow}
      />

      <NodeInlineEditorModal
        isOpen={Boolean(editingNodeSnapshot)}
        snapshot={editingNodeSnapshot}
        availableTargetRefs={scriptWorkspace.modules.map((m) => ({
          scriptNumber: m.scriptNumber,
          scriptName: m.scriptName,
        }))}
        hasCustomPositionOffset={Boolean(
          editingNodeSnapshot &&
            activeNodeOffsets[editingNodeSnapshot.nodeId] &&
            (Math.abs(activeNodeOffsets[editingNodeSnapshot.nodeId].dx) > 0.5 ||
              Math.abs(activeNodeOffsets[editingNodeSnapshot.nodeId].dy) > 0.5)
        )}
        onClose={() => setEditingNodeSnapshot(null)}
        onSave={handleSaveNodeInlineEdits}
        onResetPositionOffset={(nodeId) => commitNodePositionOffset(nodeId, null)}
        onDeleteNode={handleDeleteNodeFromCanvas}
        onJumpToScript={(scriptNumber) => {
          setEditingNodeSnapshot(null);
          handleSwitchCallflowViewLevel({ level: 'detail', scriptNumber });
        }}
        onOpenOpeningHours={(initialSearch) => {
          setEditingNodeSnapshot(null);
          setOpeningHoursInitialSearch(initialSearch || '');
          setIsOpeningHoursModalOpen(true);
        }}
      />
    </div>
  );
}
