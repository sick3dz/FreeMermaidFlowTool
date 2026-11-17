import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  Edit3,
  Eye,
  FileImage,
  Filter,
  FolderPlus,
  GitBranch,
  Globe,
  Grid,
  HardDriveDownload,
  Layers,
  Maximize2,
  Minimize2,
  Moon,
  Move,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Scan,
  Sun,
  Trash2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CallflowBuildingBlockType,
  CallflowDirectionFilter,
  CallflowHopDepth,
  CallflowIssueResolution,
  CallflowOpenIssue,
  CallflowViewLevel,
  DiagramDirection,
  DiagramTemplate,
  LogicAnalysisSummary,
  NodePositionOffset,
  SavedDiagram,
  ScriptOrigin,
  ScriptWorkspace,
  SmartColorMode,
  ThemeConfiguration,
  ValidationState,
} from './types/mermaidStudio';
import {
  DEFAULT_THEME_CONFIG,
  MERMAID_TEMPLATES,
} from './data/mermaidTemplates';
import {
  exportSvgToPngBlob,
  getDiagramDirection,
  getSvgDimensions,
  injectInitDirectiveIntoCode,
  isColorDark,
  prepareStandaloneSvg,
  renderLocalMermaidDiagram,
  triggerLocalDownload,
  updateDiagramDirection,
} from './utils/mermaidEngine';
import {
  applySmartLogicColoring,
  injectSmartColorsIntoCode,
} from './utils/smartColorEngine';
import {
  applyCallflowSpotlightToSvg,
  applyNodeOffsetsToSvg,
  buildIsolatedPathMermaidCode,
  generateInteractiveCallflowHtml,
  InteractiveCallflowHtmlView,
  parseCallflowGraph,
  resolveClickedNodeIdFromSvgElement,
  traceCallflowForNode,
} from './utils/callflowEngine';
import {
  addBuildingBlockToWorkspace,
  applyIssueResolutionToWorkspace,
  buildMasterOverviewMermaid,
  buildScriptDetailMermaid,
  buildScriptWorkspace,
  canonicalScriptMatchKey,
  connectNodesInWorkspace,
  deleteNodeFromWorkspace,
  EditableCallflowNodeSnapshot,
  EditableNodeConnectionItem,
  extractScriptNumberFromNodeId,
  inspectWorkspaceNodeForEdit,
  looksLikeRawCallflowScript,
  mergeScriptModules,
  normalizeScriptRef,
  parseCallflowTextWithFallback,
  reopenIssueInWorkspace,
  toMermaidNodeSuffix,
  unignoreChecklistTargetInWorkspace,
  updateWorkspaceNodeFromEdit,
} from './utils/scriptCallflowParser';
import { parseVisioFileToModules } from './utils/visioParser';
import { ThemeConfigurator } from './components/ThemeConfigurator';
import { CallflowInspector } from './components/CallflowInspector';
import { TemplateGalleryModal } from './components/TemplateGalleryModal';
import { ExportModal } from './components/ExportModal';
import { MultiScriptModal } from './components/MultiScriptModal';
import { NewCallflowModal } from './components/NewCallflowModal';
import { NodeInlineEditorModal } from './components/NodeInlineEditorModal';
import { OfflineDownloadModal } from './components/OfflineDownloadModal';
import {
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

export default function App() {
  // Initial state starts empty (or restores user's own workspace from localStorage / offline seed)
  const [diagramTitle, setDiagramTitle] = useState<string>(() => {
    return readStudioStorage(STORAGE_KEYS.ACTIVE_TITLE) || 'Neuer Callflow';
  });

  const [code, setCode] = useState<string>(() => {
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

  // Two-Level Multi-Script Callflow Workspace
  const [scriptWorkspace, setScriptWorkspace] = useState<ScriptWorkspace>(() => {
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
          return buildScriptWorkspace(parsed.modules, {
            ...parsed,
            manualQuestions: validManualQuestions,
          });
        }
      }
    } catch {
      // ignore corrupted local storage
    }
    return buildScriptWorkspace([]);
  });
  const [callflowViewLevel, setCallflowViewLevel] = useState<CallflowViewLevel>({
    level: 'master',
  });
  const [checklistFocusTrigger, setChecklistFocusTrigger] = useState<{
    refKey: string;
    nonce: number;
  } | null>(null);
  const [isNewCallflowModalOpen, setIsNewCallflowModalOpen] = useState<boolean>(false);
  const [isMultiScriptModalOpen, setIsMultiScriptModalOpen] = useState<boolean>(false);
  const [multiScriptPrefillNumber, setMultiScriptPrefillNumber] = useState<string | null>(null);
  const [rawScriptDraft, setRawScriptDraft] = useState<{
    rawText: string;
    moduleCount: number;
    ruleCount: number;
  } | null>(null);
  const skipAutoConvertRef = useRef<boolean>(false);

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
  const [isPanning, setIsPanning] = useState<boolean>(false);
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
  const [isOfflineModalOpen, setIsOfflineModalOpen] = useState<boolean>(false);

  // PC Visual Drag-and-Drop Callflow Editor State
  const [isVisualEditMode, setIsVisualEditMode] = useState<boolean>(false);
  const [visualEditTool, setVisualEditTool] = useState<'move' | 'connect'>('move');
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
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
  } | null>(null);
  const [recentConnectionBanner, setRecentConnectionBanner] = useState<{
    fromNodeId: string;
    toNodeId: string;
    fromLabel: string;
    toLabel: string;
    labelDraft: string;
  } | null>(null);
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

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  // Persist active work to localStorage (or memory fallback)
  useEffect(() => {
    writeStudioStorage(STORAGE_KEYS.ACTIVE_CODE, code);
    writeStudioStorage(STORAGE_KEYS.ACTIVE_TITLE, diagramTitle);
    writeStudioStorage(STORAGE_KEYS.ACTIVE_THEME, JSON.stringify(themeConfig));
    writeStudioStorage(STORAGE_KEYS.SMART_COLOR_MODE, smartColorMode);
    writeStudioStorage(STORAGE_KEYS.CANVAS_SURFACE, canvasSurface);
    writeStudioStorage(STORAGE_KEYS.SCRIPT_WORKSPACE, JSON.stringify(scriptWorkspace));
    writeStudioStorage(STORAGE_KEYS.WORKSPACE_MODE, workspaceMode);
  }, [code, diagramTitle, themeConfig, smartColorMode, canvasSurface, scriptWorkspace, workspaceMode]);

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

  // Reset selectedCallflowNodeId if code changes and node no longer exists
  useEffect(() => {
    if (selectedCallflowNodeId && !callflowGraph.nodes.has(selectedCallflowNodeId)) {
      setSelectedCallflowNodeId(null);
      setIsolateSubgraphMode(false);
    }
  }, [callflowGraph, selectedCallflowNodeId]);

  // Determine effective Mermaid code to render (either full code or isolated sub-callflow)
  const currentDirection = useMemo(() => getDiagramDirection(code), [code]);

  const effectiveMermaidCode = useMemo(() => {
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
    code,
    isolateSubgraphMode,
    callflowTrace,
    callflowGraph,
    currentDirection,
    callflowDirectionFilter,
    callflowHopDepth,
  ]);

  // Debounced Local Mermaid v11 Parsing & Base SVG Rendering
  useEffect(() => {
    let isCancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await renderLocalMermaidDiagram(effectiveMermaidCode, themeConfig);
      if (isCancelled) return;
      setValidation(result.validation);
      if (result.svg !== null) {
        setBaseRenderedSvg(result.svg);
      } else if (!effectiveMermaidCode.trim()) {
        setBaseRenderedSvg(null);
      }
    }, 120);

    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
    };
  }, [effectiveMermaidCode, themeConfig]);

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

  // Apply Smart Logic Coloring, Callflow Path Spotlight, AND PC Drag-and-Drop Node Offsets
  const { coloredSvg, unfilteredColoredSvg, logicSummary } = useMemo<{
    coloredSvg: string | null;
    unfilteredColoredSvg: string | null;
    logicSummary: LogicAnalysisSummary;
  }>(() => {
    if (!baseRenderedSvg) {
      return {
        coloredSvg: null,
        unfilteredColoredSvg: null,
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

    const processed = applySmartLogicColoring(
      baseRenderedSvg,
      effectiveMermaidCode,
      smartColorMode,
      canvasSurface,
      themeConfig.lineColor
    );

    // If a Callflow node is selected and we are in full diagram view, apply Spotlight dimming/highlighting
    const spotlightSvg =
      callflowTrace && !isolateSubgraphMode
        ? applyCallflowSpotlightToSvg(
            processed.svg,
            callflowTrace,
            canvasSurface,
            callflowGraph,
            callflowDirectionFilter,
            callflowHopDepth
          )
        : processed.svg;

    const finalCanvasSvg = applyNodeOffsetsToSvg(
      spotlightSvg,
      activeNodeOffsets,
      callflowGraph,
      isVisualEditMode
    );
    const finalExportSvg = applyNodeOffsetsToSvg(
      processed.svg,
      activeNodeOffsets,
      callflowGraph,
      false
    );

    return {
      coloredSvg: finalCanvasSvg,
      unfilteredColoredSvg: finalExportSvg,
      logicSummary: processed.summary,
    };
  }, [
    baseRenderedSvg,
    effectiveMermaidCode,
    smartColorMode,
    canvasSurface,
    themeConfig.lineColor,
    callflowTrace,
    isolateSubgraphMode,
    callflowGraph,
    callflowDirectionFilter,
    callflowHopDepth,
    activeNodeOffsets,
    isVisualEditMode,
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

  // Fit entire diagram into viewport (overview)
  const handleFitToViewport = useCallback(() => {
    if (!coloredSvg || !canvasViewportRef.current) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const rect = canvasViewportRef.current.getBoundingClientRect();
    const dims = getSvgDimensions(coloredSvg);
    const padding = rect.width < 640 ? 32 : 80;
    const scaleX = Math.max(100, rect.width - padding) / Math.max(1, dims.width);
    const scaleY = Math.max(100, rect.height - padding) / Math.max(1, dims.height);
    const optimalScale = Math.min(2.5, Math.max(0.05, Math.min(scaleX, scaleY)));
    setZoom(Number(optimalScale.toFixed(2)));
    setPan({ x: 0, y: 0 });
  }, [coloredSvg]);

  // Center and zoom camera directly onto a specific Callflow node in readable 1:1+ scale
  const handleFocusNodeOnCanvas = useCallback(
    (nodeId: string, desiredMinZoom = 1.2) => {
      if (!canvasViewportRef.current) return;
      requestAnimationFrame(() => {
        if (!canvasViewportRef.current) return;
        const vpRect = canvasViewportRef.current.getBoundingClientRect();
        const vpCenterX = vpRect.left + vpRect.width / 2;
        const vpCenterY = vpRect.top + vpRect.height / 2;

        const candidates = canvasViewportRef.current.querySelectorAll(
          'g.node, g.actor, g.statediagram-state, g.classGroup'
        );
        let targetEl: Element | null = null;
        for (const el of Array.from(candidates)) {
          const matched = resolveClickedNodeIdFromSvgElement(el, callflowGraph);
          if (matched === nodeId) {
            targetEl = el;
            break;
          }
        }

        if (!targetEl) return;

        const nodeRect = targetEl.getBoundingClientRect();
        const nodeCenterX = nodeRect.left + nodeRect.width / 2;
        const nodeCenterY = nodeRect.top + nodeRect.height / 2;

        // Calculate unscaled (1:1) offset of the node relative to the stage center
        const currentStageCenterX = vpCenterX + pan.x;
        const currentStageCenterY = vpCenterY + pan.y;
        const unscaledOffsetX = (nodeCenterX - currentStageCenterX) / Math.max(0.05, zoom);
        const unscaledOffsetY = (nodeCenterY - currentStageCenterY) / Math.max(0.05, zoom);

        const nextZoom = Number(
          Math.min(20.0, Math.max(desiredMinZoom, zoom < 0.95 ? 1.25 : zoom)).toFixed(2)
        );
        setZoom(nextZoom);
        setPan({
          x: Math.round(-unscaledOffsetX * nextZoom),
          y: Math.round(-unscaledOffsetY * nextZoom),
        });
      });
    },
    [callflowGraph, pan.x, pan.y, zoom]
  );

  // Cursor-centered Canvas Wheel Zoom (5% up to 2000%)
  const handleCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!canvasViewportRef.current) return;

    const rect = canvasViewportRef.current.getBoundingClientRect();
    const cursorOffsetX = e.clientX - (rect.left + rect.width / 2);
    const cursorOffsetY = e.clientY - (rect.top + rect.height / 2);

    const factor = e.deltaY < 0 ? 1.16 : 0.86;
    const nextZoom = Math.min(20.0, Math.max(0.05, Number((zoom * factor).toFixed(2))));
    const scaleRatio = nextZoom / Math.max(0.05, zoom);

    setPan((prevPan) => ({
      x: Math.round(cursorOffsetX - (cursorOffsetX - prevPan.x) * scaleRatio),
      y: Math.round(cursorOffsetY - (cursorOffsetY - prevPan.y) * scaleRatio),
    }));
    setZoom(nextZoom);
  };

  // Adaptive step zoom in/out for toolbar buttons
  const handleStepZoom = (direction: 'in' | 'out') => {
    setZoom((prev) => {
      const step = prev < 0.5 ? 0.1 : prev < 2.0 ? 0.25 : prev < 5.0 ? 0.5 : 1.5;
      const next = direction === 'in' ? prev + step : prev - step;
      return Math.min(20.0, Math.max(0.05, Number(next.toFixed(2))));
    });
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

  // Canvas Mouse Drag Pan + Visual Node Drag & Wire Connect + Click-to-Trace Node Detection
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Ignore synthetic mouse events generated by mobile browsers right after touch events
    if (Date.now() - lastTouchTimeRef.current < 700) return;
    if (e.button !== 0) return;
    if (isCanvasOverlayTarget(e.target)) return;

    const targetEl = e.target as Element;
    const portEl = targetEl?.closest?.('[data-port-node-id]');
    const clickedNodeId = resolveClickedNodeIdFromSvgElement(targetEl, callflowGraph);

    // 1. Check if starting a Drag-to-Connect wire (either from a connection port dot or in 'connect' tool mode)
    const wireSourceNodeId =
      portEl?.getAttribute('data-port-node-id') ||
      (isVisualEditMode && visualEditTool === 'connect' ? clickedNodeId : null);

    if (wireSourceNodeId && canvasViewportRef.current) {
      e.stopPropagation();
      const vpRect = canvasViewportRef.current.getBoundingClientRect();
      const startX = e.clientX - vpRect.left;
      const startY = e.clientY - vpRect.top;
      const fromLabel = callflowGraph.nodes.get(wireSourceNodeId)?.label || wireSourceNodeId;

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
      });
      return;
    }

    // 2. Check if starting a 60fps Node Move Drag on PC when isVisualEditMode is active
    if (isVisualEditMode && visualEditTool === 'move' && clickedNodeId) {
      const domGroup = targetEl.closest(
        'g.node, g.actor, g.statediagram-state, g.classGroup'
      ) as SVGGElement | null;
      if (domGroup) {
        const currentOff = activeNodeOffsets[clickedNodeId] || { dx: 0, dy: 0 };
        const rawTransform = domGroup.getAttribute('transform') || '';
        const trMatch = rawTransform.match(
          /translate\(\s*([+-]?\d+(?:\.\d+)?)(?:[\s,]+([+-]?\d+(?:\.\d+)?))?\s*\)/i
        );
        const curTx = trMatch ? parseFloat(trMatch[1] || '0') : 0;
        const curTy = trMatch ? parseFloat(trMatch[2] || '0') : 0;
        const restTransform = trMatch ? rawTransform.replace(trMatch[0], '').trim() : rawTransform;
        // Base SVG layout coordinate before offset
        const baseX = curTx - currentOff.dx;
        const baseY = curTy - currentOff.dy;

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
        return;
      }
    }

    setIsPanning(true);
    dragDistanceRef.current = 0;
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastTouchTimeRef.current < 700) return;

    if (nodeDragRef.current.active) {
      const st = nodeDragRef.current;
      const rawPixelDx = e.clientX - st.startClientX;
      const rawPixelDy = e.clientY - st.startClientY;
      st.movedPixels = Math.max(st.movedPixels, Math.hypot(rawPixelDx, rawPixelDy));

      if (st.mode === 'connect-wire' && canvasViewportRef.current) {
        const vpRect = canvasViewportRef.current.getBoundingClientRect();
        const curX = e.clientX - vpRect.left;
        const curY = e.clientY - vpRect.top;
        const hoveredId = resolveClickedNodeIdFromSvgElement(
          e.target as Element,
          callflowGraph
        );
        setActiveWirePreview((prev) =>
          prev
            ? {
                ...prev,
                curX,
                curY,
                hoverTargetNodeId:
                  hoveredId && hoveredId !== st.nodeId ? hoveredId : null,
              }
            : null
        );
        return;
      }

      if (st.mode === 'move-node' && st.domNodeGroup) {
        const unscaledDx = rawPixelDx / Math.max(0.05, zoom);
        const unscaledDy = rawPixelDy / Math.max(0.05, zoom);
        let nextDx = st.origDx + unscaledDx;
        let nextDy = st.origDy + unscaledDy;
        if (snapToGrid) {
          nextDx = Math.round(nextDx / 16) * 16;
          nextDy = Math.round(nextDy / 16) * 16;
        }
        st.currentDx = nextDx;
        st.currentDy = nextDy;
        const nextTx = Number((st.baseTransformX + nextDx).toFixed(2));
        const nextTy = Number((st.baseTransformY + nextDy).toFixed(2));
        st.domNodeGroup.setAttribute(
          'transform',
          `translate(${nextTx}, ${nextTy})${
            st.baseTransformRest ? ` ${st.baseTransformRest}` : ''
          }`
        );
        return;
      }
    }

    if (!isPanning) return;
    const nextX = e.clientX - panStartRef.current.x;
    const nextY = e.clientY - panStartRef.current.y;
    dragDistanceRef.current += Math.hypot(nextX - pan.x, nextY - pan.y);
    setPan({ x: nextX, y: nextY });
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastTouchTimeRef.current < 700) {
      setIsPanning(false);
      nodeDragRef.current.active = false;
      setActiveWirePreview(null);
      return;
    }

    if (nodeDragRef.current.active) {
      const st = nodeDragRef.current;
      nodeDragRef.current.active = false;

      if (st.mode === 'connect-wire') {
        const targetNodeId = resolveClickedNodeIdFromSvgElement(
          e.target as Element,
          callflowGraph
        );
        setActiveWirePreview(null);
        if (targetNodeId && targetNodeId !== st.nodeId) {
          const fromLabel = callflowGraph.nodes.get(st.nodeId)?.label || st.nodeId;
          const toLabel = callflowGraph.nodes.get(targetNodeId)?.label || targetNodeId;
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
            // Raw Mermaid diagram fallback: append edge line
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
        if (st.movedPixels >= 4) {
          commitNodePositionOffset(st.nodeId, {
            dx: st.currentDx,
            dy: st.currentDy,
          });
          setSelectedCallflowNodeId(st.nodeId);
        } else {
          // Treat as a regular click on the node
          setSelectedCallflowNodeId((prev) =>
            prev === st.nodeId ? null : st.nodeId
          );
          setRightSidebarTab('callflow');
          setIsRightPanelOpen(true);
        }
        return;
      }
    }

    const wasClick = isPanning && dragDistanceRef.current < 6;
    setIsPanning(false);
    if (isCanvasOverlayTarget(e.target)) return;

    if (wasClick) {
      const clickedId = resolveClickedNodeIdFromSvgElement(
        e.target as Element,
        callflowGraph
      );
      if (clickedId) {
        setSelectedCallflowNodeId((prev) => (prev === clickedId ? null : clickedId));
        setRightSidebarTab('callflow');
        setIsRightPanelOpen(true);
      }
    }
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
      setIsPanning(false);
      return;
    }
    if (e.touches.length === 1) {
      dragDistanceRef.current = 0;
      touchGestureRef.current = {
        mode: 'pan',
        startX: e.touches[0].clientX - pan.x,
        startY: e.touches[0].clientY - pan.y,
        initialPinchDistance: 0,
        initialZoom: zoom,
      };
      setIsPanning(true);
    } else if (e.touches.length === 2) {
      const dist = getTouchDistance(e.touches);
      touchGestureRef.current = {
        mode: 'pinch',
        startX: pan.x,
        startY: pan.y,
        initialPinchDistance: Math.max(1, dist),
        initialZoom: zoom,
      };
      setIsPanning(false);
    }
  };

  const handleCanvasTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    lastTouchTimeRef.current = Date.now();
    if (isCanvasOverlayTarget(e.target) || !coloredSvg) return;
    if (touchGestureRef.current.mode === 'pan' && e.touches.length === 1) {
      const nextX = e.touches[0].clientX - touchGestureRef.current.startX;
      const nextY = e.touches[0].clientY - touchGestureRef.current.startY;
      dragDistanceRef.current += Math.hypot(nextX - pan.x, nextY - pan.y);
      setPan({ x: nextX, y: nextY });
    } else if (touchGestureRef.current.mode === 'pinch' && e.touches.length === 2) {
      const currentDist = getTouchDistance(e.touches);
      const ratio = currentDist / touchGestureRef.current.initialPinchDistance;
      const nextZoom = Math.min(
        20.0,
        Math.max(0.05, Number((touchGestureRef.current.initialZoom * ratio).toFixed(2)))
      );
      setZoom(nextZoom);
    }
  };

  const handleCanvasTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    lastTouchTimeRef.current = Date.now();
    if (isCanvasOverlayTarget(e.target) || !coloredSvg) {
      touchGestureRef.current.mode = 'none';
      setIsPanning(false);
      return;
    }
    const wasTap =
      touchGestureRef.current.mode === 'pan' && dragDistanceRef.current < 8;
    touchGestureRef.current.mode = 'none';
    setIsPanning(false);

    if (wasTap) {
      const tappedId = resolveClickedNodeIdFromSvgElement(
        e.target as Element,
        callflowGraph
      );
      if (tappedId) {
        setSelectedCallflowNodeId((prev) => (prev === tappedId ? null : tappedId));
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

  const handleChangeDirection = (dir: DiagramDirection) => {
    setCode((prev) => updateDiagramDirection(prev, dir));
  };

  const handleInjectInitDirective = () => {
    setCode((prev) => injectInitDirectiveIntoCode(prev, themeConfig));
  };

  const handleInjectSmartClassDefs = () => {
    setCode((prev) => injectSmartColorsIntoCode(prev, canvasSurface));
  };

  const handleSwitchCallflowViewLevel = useCallback(
    (
      nextLevel: CallflowViewLevel,
      overrideWorkspace?: ScriptWorkspace,
      switchToMobilePreview = false
    ) => {
      const ws = overrideWorkspace || scriptWorkspace;
      if (ws.modules.length === 0) return;
      const dir = currentDirection || 'LR';
      const nextCode =
        nextLevel.level === 'master'
          ? buildMasterOverviewMermaid(ws, dir)
          : buildScriptDetailMermaid(ws, nextLevel.scriptNumber, dir);

      setCallflowViewLevel(nextLevel);
      setCode(nextCode);
      if (nextLevel.level === 'master') {
        setDiagramTitle(`Master-Callflow (${ws.modules.length} Skripte)`);
      } else {
        const mod = ws.modules.find(
          (m) =>
            canonicalScriptMatchKey(m.scriptNumber) ===
            canonicalScriptMatchKey(nextLevel.scriptNumber)
        );
        setDiagramTitle(
          mod ? `[${mod.scriptNumber}] ${mod.scriptName}` : `Skript ${nextLevel.scriptNumber}`
        );
      }
      setSelectedCallflowNodeId(null);
      setIsolateSubgraphMode(false);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      if (switchToMobilePreview) {
        setMobileActivePane('preview');
      }
    },
    [scriptWorkspace, currentDirection]
  );

  const refreshDiagramFromWorkspace = useCallback(
    (nextWs: ScriptWorkspace, levelOverride?: CallflowViewLevel) => {
      if (nextWs.modules.length === 0) return;
      const targetLevel = levelOverride || callflowViewLevel;
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
      const nextCode =
        effectiveLevel.level === 'master'
          ? buildMasterOverviewMermaid(nextWs, dir)
          : buildScriptDetailMermaid(nextWs, effectiveLevel.scriptNumber, dir);

      if (effectiveLevel.level !== callflowViewLevel.level) {
        setCallflowViewLevel(effectiveLevel);
      }
      setCode(nextCode);
      if (effectiveLevel.level === 'master') {
        setDiagramTitle(`Master-Callflow (${nextWs.modules.length} Skripte)`);
      } else {
        const mod = nextWs.modules.find(
          (m) =>
            canonicalScriptMatchKey(m.scriptNumber) ===
            canonicalScriptMatchKey(effectiveLevel.scriptNumber)
        );
        setDiagramTitle(
          mod ? `[${mod.scriptNumber}] ${mod.scriptName}` : `Skript ${effectiveLevel.scriptNumber}`
        );
      }
    },
    [callflowViewLevel, currentDirection]
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
      const normalizedTarget = normalizeScriptRef(targetRef);
      if (!trimmed || !normalizedTarget) return null;

      const incoming = parseCallflowTextWithFallback(trimmed, {
        defaultScriptNumber: normalizedTarget,
        defaultScriptName: normalizedTarget,
        origin,
        isMasterHint: canonicalScriptMatchKey(normalizedTarget) === 'main',
      });

      const hasRules = incoming.some((m) => m.rules.length > 0);
      if (incoming.length === 0 || !hasRules) return null;

      const targetKey = canonicalScriptMatchKey(normalizedTarget);
      const nextIgnored = (scriptWorkspace.ignoredChecklistTargets || []).filter(
        (t) => canonicalScriptMatchKey(t) !== targetKey
      );
      const merged = mergeScriptModules(scriptWorkspace.modules, incoming);
      const nextWs = buildScriptWorkspace(merged, {
        ...scriptWorkspace,
        ignoredChecklistTargets: nextIgnored,
      });
      setScriptWorkspace(nextWs);
      refreshDiagramFromWorkspace(nextWs);
      return nextWs;
    },
    [scriptWorkspace, refreshDiagramFromWorkspace]
  );

  const handleSubmitChecklistVisioFile = useCallback(
    async (targetRef: string, file: File): Promise<ScriptWorkspace | null> => {
      const normalizedTarget = normalizeScriptRef(targetRef);
      if (!normalizedTarget) return null;
      try {
        const mods = await parseVisioFileToModules(file, {
          overridePrimaryScriptNumber: normalizedTarget,
        });
        if (mods.length === 0) return null;
        const targetKey = canonicalScriptMatchKey(normalizedTarget);
        const nextIgnored = (scriptWorkspace.ignoredChecklistTargets || []).filter(
          (t) => canonicalScriptMatchKey(t) !== targetKey
        );
        const merged = mergeScriptModules(scriptWorkspace.modules, mods);
        const nextWs = buildScriptWorkspace(merged, {
          ...scriptWorkspace,
          ignoredChecklistTargets: nextIgnored,
        });
        setScriptWorkspace(nextWs);
        refreshDiagramFromWorkspace(nextWs);
        return nextWs;
      } catch {
        return null;
      }
    },
    [scriptWorkspace, refreshDiagramFromWorkspace]
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
        // Update the most recently added rule or manualLink between fromNodeId and toNodeId
        const fromRef =
          extractScriptNumberFromNodeId(
            recentConnectionBanner.fromNodeId,
            scriptWorkspace.modules
          ) || recentConnectionBanner.fromNodeId.replace(/^S_/, '');
        const toRef =
          extractScriptNumberFromNodeId(
            recentConnectionBanner.toNodeId,
            scriptWorkspace.modules
          ) || recentConnectionBanner.toNodeId.replace(/^(?:S|JUMP|INC|SELF)_/, '');
        const fromKey = canonicalScriptMatchKey(fromRef);
        const toKey = canonicalScriptMatchKey(toRef);
        const tasteMatch = clean.match(/^(?:taste\s*)?([0-9*#]+)$/i);

        const nextModules = scriptWorkspace.modules.map((mod) => {
          if (canonicalScriptMatchKey(mod.scriptNumber) !== fromKey) return mod;
          const idx = [...mod.rules]
            .reverse()
            .findIndex(
              (r) =>
                (r.targetNumber && canonicalScriptMatchKey(r.targetNumber) === toKey) ||
                r.choices.some((c) => canonicalScriptMatchKey(c.targetNumber) === toKey)
            );
          if (idx === -1) return mod;
          const realIdx = mod.rules.length - 1 - idx;
          const targetRule = mod.rules[realIdx];
          const updatedRule = tasteMatch
            ? {
                ...targetRule,
                stepName: `Taste ${tasteMatch[1]} → ${toRef}`,
                targetNumber: undefined,
                choices: [{ choice: tasteMatch[1], targetNumber: toRef, label: clean }],
              }
            : {
                ...targetRule,
                stepName: `${clean} → ${toRef}`,
              };
          return {
            ...mod,
            rules: mod.rules.map((r, i) => (i === realIdx ? updatedRule : r)),
          };
        });
        const nextWs = buildScriptWorkspace(nextModules, scriptWorkspace);
        setScriptWorkspace(nextWs);
        refreshDiagramFromWorkspace(nextWs);
      }
      setRecentConnectionBanner(null);
    },
    [recentConnectionBanner, scriptWorkspace, refreshDiagramFromWorkspace]
  );

  const handleStartNewCallflow = useCallback(
    (payload: { title: string; workspace: ScriptWorkspace }) => {
      skipAutoConvertRef.current = false;
      setRawScriptDraft(null);
      setScriptWorkspace(payload.workspace);
      setGuidedStep(2);
      handleSwitchCallflowViewLevel({ level: 'master' }, payload.workspace, false);
      if (payload.title) {
        setDiagramTitle(payload.title);
      }
      setRightSidebarTab('callflow');
      setIsRightPanelOpen(true);
      setMobileActivePane('callflow');
    },
    [handleSwitchCallflowViewLevel]
  );

  // Automatic local conversion of raw Callflow / AACC script text (no external AI needed)
  const convertRawScriptTextInEditor = useCallback(
    (rawText: string, mode: 'replace' | 'merge' = 'replace'): boolean => {
      const parsed = parseCallflowTextWithFallback(rawText, {
        defaultScriptNumber: 'Main',
        defaultScriptName: 'Main',
        origin: 'legacy-text',
      });
      if (parsed.length === 0) return false;
      const parsedRules = parsed.reduce((sum, m) => sum + m.rules.length, 0);
      if (parsedRules === 0) return false;

      const combinedModules =
        mode === 'merge' ? mergeScriptModules(scriptWorkspace.modules, parsed) : parsed;
      const nextWs = buildScriptWorkspace(
        combinedModules,
        mode === 'merge' ? scriptWorkspace : undefined
      );
      skipAutoConvertRef.current = false;
      setRawScriptDraft({
        rawText,
        moduleCount: nextWs.modules.length,
        ruleCount: nextWs.modules.reduce((sum, m) => sum + m.rules.length, 0),
      });
      setScriptWorkspace(nextWs);
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
    if (
      saved.scriptWorkspace &&
      Array.isArray(saved.scriptWorkspace.modules) &&
      saved.scriptWorkspace.modules.length > 0
    ) {
      setScriptWorkspace(
        buildScriptWorkspace(saved.scriptWorkspace.modules, saved.scriptWorkspace)
      );
    } else {
      setScriptWorkspace(buildScriptWorkspace([]));
    }
    setCallflowViewLevel({ level: 'master' });
    setDiagramTitle(saved.title);
    setCode(saved.code);
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

  // Direct 1-Click SVG, PNG & Interactive HTML downloads
  const handleQuickDownloadSvg = () => {
    if (!coloredSvg) return;
    const { serializedSvg } = prepareStandaloneSvg(coloredSvg, canvasSurface, 32);
    const blob = new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' });
    const safeName =
      diagramTitle.toLowerCase().replace(/[^a-z0-9äöüß_-]+/gi, '-') || 'mermaid-diagramm';
    triggerLocalDownload(blob, `${safeName}.svg`);
    setQuickDownloadFeedback('svg');
    setTimeout(() => setQuickDownloadFeedback(null), 2000);
  };

  const handleQuickDownloadPng = async () => {
    if (!coloredSvg || isDownloadingPng) return;
    setIsDownloadingPng(true);
    try {
      const { blob } = await exportSvgToPngBlob(coloredSvg, 2, canvasSurface, {
        code: effectiveMermaidCode,
        themeConfig,
        smartColorMode,
        canvasSurface,
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

  const buildInteractiveHtmlForSurface = useCallback(
    async (targetSurface: 'dark' | 'light'): Promise<string | null> => {
      const currentExportSvg = unfilteredColoredSvg || coloredSvg;
      if (!currentExportSvg) return null;

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

      if (scriptWorkspace.modules.length === 0) {
        const adjustedSvg =
          targetSurface !== canvasSurface
            ? applySmartLogicColoring(
                currentExportSvg,
                code,
                smartColorMode,
                targetSurface,
                exportThemeConfig.lineColor
              ).svg
            : currentExportSvg;
        return generateInteractiveCallflowHtml(
          diagramTitle,
          adjustedSvg,
          callflowGraph,
          targetSurface
        );
      }

      const dir = currentDirection || 'LR';
      const viewSpecs: Array<{
        key: string;
        label: string;
        scriptNumber?: string;
        mermaidCode: string;
      }> = [
        {
          key: 'master',
          label: `Ebene 1: Master-Übersicht (${scriptWorkspace.modules.length} Skripte)`,
          mermaidCode: buildMasterOverviewMermaid(scriptWorkspace, dir),
        },
        ...scriptWorkspace.modules.map((mod) => ({
          key: `script:${mod.scriptNumber}`,
          label: `Ebene 2: [${mod.scriptNumber}] ${mod.scriptName}`,
          scriptNumber: mod.scriptNumber,
          mermaidCode: buildScriptDetailMermaid(scriptWorkspace, mod.scriptNumber, dir),
        })),
      ];

      const views: InteractiveCallflowHtmlView[] = [];
      for (const spec of viewSpecs) {
        const res = await renderLocalMermaidDiagram(spec.mermaidCode, exportThemeConfig);
        if (!res.svg) continue;
        const parsedGraph = parseCallflowGraph(spec.mermaidCode);
        const colored = applySmartLogicColoring(
          res.svg,
          spec.mermaidCode,
          smartColorMode,
          targetSurface,
          exportThemeConfig.lineColor
        ).svg;
        const withOffsets = applyNodeOffsetsToSvg(
          colored,
          scriptWorkspace.nodeOffsets,
          parsedGraph,
          false
        );
        views.push({
          key: spec.key,
          label: spec.label,
          scriptNumber: spec.scriptNumber,
          svg: withOffsets,
          graph: parsedGraph,
        });
      }

      if (views.length === 0) {
        return generateInteractiveCallflowHtml(
          diagramTitle,
          currentExportSvg,
          callflowGraph,
          targetSurface
        );
      }

      const activeKey =
        callflowViewLevel.level === 'detail'
          ? `script:${callflowViewLevel.scriptNumber}`
          : 'master';

      return generateInteractiveCallflowHtml(
        diagramTitle,
        views[0].svg,
        views[0].graph,
        targetSurface,
        {
          views,
          activeViewKey: activeKey,
        }
      );
    },
    [
      unfilteredColoredSvg,
      coloredSvg,
      themeConfig,
      scriptWorkspace,
      canvasSurface,
      code,
      smartColorMode,
      diagramTitle,
      callflowGraph,
      currentDirection,
      callflowViewLevel,
    ]
  );

  const handleQuickDownloadInteractiveHtml = async () => {
    const exportSvg = unfilteredColoredSvg || coloredSvg;
    if (!exportSvg || isDownloadingHtml) return;
    setIsDownloadingHtml(true);
    try {
      const htmlContent = await buildInteractiveHtmlForSurface(canvasSurface);
      if (!htmlContent) return;
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const safeName =
        diagramTitle.toLowerCase().replace(/[^a-z0-9äöüß_-]+/gi, '-') || 'mermaid-diagramm';
      triggerLocalDownload(blob, `${safeName}-interaktiv-callflow.html`);
      setQuickDownloadFeedback('html');
      setTimeout(() => setQuickDownloadFeedback(null), 2200);
    } finally {
      setIsDownloadingHtml(false);
    }
  };

  const handleClearWorkspace = () => {
    skipAutoConvertRef.current = false;
    setRawScriptDraft(null);
    setDiagramTitle('Neuer Callflow');
    setCode('');
    setScriptWorkspace(buildScriptWorkspace([]));
    setGuidedStep(1);
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
  const showDesktopEditor =
    workspaceMode === 'free' && !isFullscreenPreview && !isDesktopEditorCollapsed;

  return (
    <div className="h-dvh w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Top Bar: Brand + Mode Switcher (Geführter Modus vs. Freier Modus) + Primary Action */}
      <header className="flex items-center justify-between gap-2 sm:gap-4 lg:gap-6 px-2.5 sm:px-4 lg:px-6 h-12 lg:h-14 border-b border-slate-800 bg-slate-950 shrink-0 min-w-0 overflow-x-auto">
        {/* Zone 1: Brand + Mode Switcher */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0 shrink-0">
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
              title="Aufgeräumter 3-Schritte-Assistent ohne Code-Editor (Start mit Masterscript Main)"
              className={`px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
                workspaceMode === 'guided'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="sm:hidden">Geführt</span>
              <span className="hidden sm:inline">Geführter Modus</span>
              <span className="hidden md:inline text-[10px] font-normal opacity-90">
                (Masterscript)
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
              Mermaid-Editor ausgeblendet · Rechts in 3 Schritten vom Masterscript bis zum Export
            </span>
          </div>
        )}

        {/* Zone 3: Primary actions */}
        <div className="flex items-center gap-2 shrink-0">
          {(code.trim().length > 0 || scriptWorkspace.modules.length > 0) &&
            workspaceMode === 'guided' && (
              <button
                type="button"
                onClick={handleClearWorkspace}
                title="Aktuellen Callflow zurücksetzen und neu starten"
                className="px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-rose-200 bg-slate-900 hover:bg-rose-950/60 border border-slate-800 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Neu starten</span>
              </button>
            )}
          <button
            type="button"
            onClick={() => setIsOfflineModalOpen(true)}
            title="Komplette App als einzelne HTML-Datei für 100 % lokalen Offline-Betrieb (ohne Internet) herunterladen"
            className="px-2.5 lg:px-3 py-1.5 lg:py-2 text-xs font-medium text-emerald-200 bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-500/40 hover:border-emerald-400/70 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <HardDriveDownload className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="hidden sm:inline">Offline-App</span>
          </button>
          <button
            type="button"
            onClick={() => setIsExportModalOpen(true)}
            className="px-3.5 lg:px-4 py-1.5 lg:py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            PNG &amp; HTML Export
          </button>
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
                <button
                  type="button"
                  onClick={handleClearWorkspace}
                  title="Editor & Callflow-Arbeitsbereich leeren"
                  className="px-2 py-1.5 lg:py-1 bg-slate-800 hover:bg-rose-950/70 hover:text-rose-200 text-slate-300 text-xs font-medium rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Leeren</span>
                </button>
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
              {Array.from({ length: lineCount }).map((_, idx) => {
                const lineNumber = idx + 1;
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

              {workspaceMode === 'free' && (
                <button
                  type="button"
                  onClick={() => setIsRightPanelOpen((prev) => !prev)}
                  title="Rechtes Inspektor-Panel ein-/ausblenden"
                  className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
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
              )}

              <button
                type="button"
                onClick={() => setIsFullscreenPreview((prev) => !prev)}
                title={
                  isFullscreenPreview
                    ? 'Assistent / Editor wieder einblenden'
                    : 'Diagramm-Vorschau maximieren (Vollbild)'
                }
                className="hidden lg:flex p-1.5 bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-100 rounded-lg transition-colors"
              >
                {isFullscreenPreview ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Two-Level Breadcrumb Bar when Multi-Script Workspace has modules */}
          {scriptWorkspace.modules.length > 0 && (
            <div className="px-3 sm:px-4 py-1.5 border-b border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 z-10">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => handleSwitchCallflowViewLevel({ level: 'master' })}
                  className={`flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    callflowViewLevel.level === 'master'
                      ? 'text-indigo-300'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {callflowViewLevel.level === 'detail' && <ArrowLeft className="w-3.5 h-3.5" />}
                  <span>Ebene 1: Master-Übersicht</span>
                </button>

                {callflowViewLevel.level === 'detail' && (
                  <>
                    <span className="text-slate-600" aria-hidden="true">
                      /
                    </span>
                    <span className="font-mono font-semibold text-amber-300 truncate tabular-nums">
                      [{callflowViewLevel.scriptNumber}]{' '}
                      {scriptWorkspace.modules.find(
                        (m) => m.scriptNumber === callflowViewLevel.scriptNumber
                      )?.scriptName || ''}
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

              <div className="flex items-center gap-2 shrink-0">
                <select
                  aria-label="Skript-Ansicht direkt umschalten"
                  value={
                    callflowViewLevel.level === 'master'
                      ? 'master'
                      : `detail:${callflowViewLevel.scriptNumber}`
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'master') {
                      handleSwitchCallflowViewLevel({ level: 'master' });
                    } else if (val.startsWith('detail:')) {
                      handleSwitchCallflowViewLevel({
                        level: 'detail',
                        scriptNumber: val.slice('detail:'.length),
                      });
                    }
                  }}
                  className="bg-slate-900 border border-slate-800 rounded-md px-2 py-1 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-indigo-500 max-w-[210px] cursor-pointer"
                >
                  <option value="master">Master-Übersicht (Ebene 1)</option>
                  {scriptWorkspace.modules.map((mod) => (
                    <option key={mod.scriptNumber} value={`detail:${mod.scriptNumber}`}>
                      [{mod.scriptNumber}] {mod.scriptName}
                    </option>
                  ))}
                </select>

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
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={() => {
              setIsPanning(false);
              nodeDragRef.current.active = false;
              setActiveWirePreview(null);
            }}
            onTouchStart={handleCanvasTouchStart}
            onTouchMove={handleCanvasTouchMove}
            onTouchEnd={handleCanvasTouchEnd}
            onTouchCancel={() => setIsPanning(false)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/x-callflow-block')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={(e) => {
              const rawBlock = e.dataTransfer.getData('application/x-callflow-block') as
                | CallflowBuildingBlockType
                | '';
              if (!rawBlock) return;
              e.preventDefault();
              const droppedOnNodeId = resolveClickedNodeIdFromSvgElement(
                e.target as Element,
                callflowGraph
              );
              handleAddBuildingBlock(rawBlock, droppedOnNodeId);
            }}
            onDoubleClick={(e) => {
              if (isCanvasOverlayTarget(e.target) || !coloredSvg) return;
              const doubleClickedNodeId = resolveClickedNodeIdFromSvgElement(
                e.target as Element,
                callflowGraph
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
                ? `overflow-hidden touch-none ${
                    isVisualEditMode && visualEditTool === 'connect'
                      ? 'cursor-crosshair'
                      : isPanning
                      ? 'cursor-grabbing'
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
            {/* Canvas Overlay Stack: Active Trace Banner + Non-destructive Syntax Warning */}
            {(callflowTrace || (!validation.isValid && coloredSvg)) && (
              <div
                data-canvas-ui="true"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                className="absolute top-3 left-3 right-3 sm:right-auto z-20 flex flex-col items-start gap-2 pointer-events-none"
              >
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

                {!validation.isValid && coloredSvg && (
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
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
                  </marker>
                </defs>
                <line
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
              </svg>
            )}

            {coloredSvg ? (
              <div
                style={{
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                  transformOrigin: 'center center',
                }}
                className="mermaid-canvas-stage shrink-0 transition-transform duration-75 ease-out p-4 sm:p-8"
                dangerouslySetInnerHTML={{ __html: coloredSvg }}
              />
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
                    Der Mermaid-Code-Editor ist bewusst ausgeblendet. Sie arbeiten im Schritt-Assistenten direkt mit Ihrem Masterscript:
                  </p>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-950/90 border border-indigo-500/40 flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-md bg-indigo-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                      1
                    </span>
                    <div>
                      <div className="font-semibold text-slate-100">Masterscript (Main) laden</div>
                      <div className="text-[11px] text-slate-400">
                        Im Schritt 1 Ihr Hauptskript (AACC, Tabelle oder Visio) direkt einfügen.
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

            {/* Floating Bottom-Right Viewport Reset Button */}
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
                className="absolute bottom-12 right-3 px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5 shadow-lg transition-colors whitespace-nowrap shrink-0 z-20 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                <span>Ansicht zentrieren</span>
              </button>
            )}
          </div>

          {/* Interactive Logic Legend & Callflow Hint Footer Bar */}
          {coloredSvg && (
            <div className="px-3 sm:px-4 py-2 border-t border-slate-800 bg-slate-900/95 flex items-center justify-between gap-4 overflow-x-auto text-xs shrink-0">
              <div className="flex items-center gap-4 overflow-x-auto">
                <span className="text-indigo-300 font-medium whitespace-nowrap shrink-0">
                  Tipp: Knoten antippen für Callflow-Pfad
                </span>
                <span className="text-slate-700" aria-hidden="true">
                  |
                </span>
                {logicSummary.legend.length > 0 && (
                  <div className="flex items-center gap-3 overflow-x-auto">
                    {logicSummary.legend.map((item) => (
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
              onSelectNodeId={(id) => {
                setSelectedCallflowNodeId(id);
              }}
              onFocusNodeOnCanvas={(id) => {
                setMobileActivePane('preview');
                setTimeout(() => handleFocusNodeOnCanvas(id, 1.25), 60);
              }}
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
              onOpenNewCallflowModal={() => setIsNewCallflowModalOpen(true)}
              onOpenMultiScriptModal={openMultiScriptModalWithPrefill}
              onSwitchViewLevel={(lvl) => handleSwitchCallflowViewLevel(lvl)}
              onResolveIssue={handleResolveCallflowIssue}
              onReopenIssue={handleReopenCallflowIssue}
              onAddManualQuestion={handleAddManualCallflowQuestion}
              onSelectMasterScript={handleSelectMasterScript}
              onSubmitChecklistDetailScript={handleSubmitChecklistDetailScript}
              onSubmitChecklistVisioFile={handleSubmitChecklistVisioFile}
              onUnignoreChecklistTarget={handleUnignoreChecklistTarget}
              focusChecklistTrigger={checklistFocusTrigger}
              onExportInteractiveHtml={() => void handleQuickDownloadInteractiveHtml()}
              onClose={() => setMobileActivePane('preview')}
              isMobileView={true}
              workspaceMode={workspaceMode}
              onChangeWorkspaceMode={handleChangeWorkspaceMode}
              guidedStep={guidedStep}
              onChangeGuidedStep={setGuidedStep}
              isVisualEditMode={isVisualEditMode}
              onToggleVisualEditMode={setIsVisualEditMode}
              onAddBuildingBlock={(type) => handleAddBuildingBlock(type)}
              onOpenNodeEditor={handleOpenNodeEditor}
              onResetAllNodeOffsets={handleResetAllNodeOffsets}
              hasCustomNodeOffsets={hasCustomNodeOffsets}
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
              logicSummary={logicSummary}
              onInjectSmartClassDefs={handleInjectSmartClassDefs}
              currentDirection={currentDirection}
              onChangeDirection={handleChangeDirection}
              onInjectInitDirective={handleInjectInitDirective}
              canvasSurface={canvasSurface}
              onChangeCanvasSurface={handleChangeCanvasSurface}
              onClose={() => setMobileActivePane('preview')}
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
                  onFocusNodeOnCanvas={(id) => handleFocusNodeOnCanvas(id, 1.25)}
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
                  onOpenNewCallflowModal={() => setIsNewCallflowModalOpen(true)}
                  onOpenMultiScriptModal={openMultiScriptModalWithPrefill}
                  onSwitchViewLevel={(lvl) => handleSwitchCallflowViewLevel(lvl)}
                  onResolveIssue={handleResolveCallflowIssue}
                  onReopenIssue={handleReopenCallflowIssue}
                  onAddManualQuestion={handleAddManualCallflowQuestion}
                  onSelectMasterScript={handleSelectMasterScript}
                  onSubmitChecklistDetailScript={handleSubmitChecklistDetailScript}
                  onSubmitChecklistVisioFile={handleSubmitChecklistVisioFile}
                  onUnignoreChecklistTarget={handleUnignoreChecklistTarget}
                  focusChecklistTrigger={checklistFocusTrigger}
                  onExportInteractiveHtml={() => void handleQuickDownloadInteractiveHtml()}
                  onClose={() => setIsRightPanelOpen(false)}
                  isMobileView={false}
                  workspaceMode={workspaceMode}
                  onChangeWorkspaceMode={handleChangeWorkspaceMode}
                  guidedStep={guidedStep}
                  onChangeGuidedStep={setGuidedStep}
                  isVisualEditMode={isVisualEditMode}
                  onToggleVisualEditMode={setIsVisualEditMode}
                  onAddBuildingBlock={(type) => handleAddBuildingBlock(type)}
                  onOpenNodeEditor={handleOpenNodeEditor}
                  onResetAllNodeOffsets={handleResetAllNodeOffsets}
                  hasCustomNodeOffsets={hasCustomNodeOffsets}
                />
              ) : (
                <ThemeConfigurator
                  themeConfig={themeConfig}
                  onChangeTheme={setThemeConfig}
                  smartColorMode={smartColorMode}
                  onChangeSmartColorMode={setSmartColorMode}
                  logicSummary={logicSummary}
                  onInjectSmartClassDefs={handleInjectSmartClassDefs}
                  currentDirection={currentDirection}
                  onChangeDirection={handleChangeDirection}
                  onInjectInitDirective={handleInjectInitDirective}
                  canvasSurface={canvasSurface}
                  onChangeCanvasSurface={handleChangeCanvasSurface}
                  onClose={() => setIsRightPanelOpen(false)}
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
        className={`lg:hidden h-14 border-t border-slate-800 bg-slate-950/95 backdrop-blur-md grid ${
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
            {!validation.isValid && (
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
        onClose={() => setIsExportModalOpen(false)}
        svgContent={coloredSvg}
        unfilteredSvgContent={unfilteredColoredSvg}
        code={code}
        diagramTitle={diagramTitle}
        defaultBackground={canvasSurface}
        themeConfig={themeConfig}
        smartColorMode={smartColorMode}
        callflowGraph={callflowGraph}
        scriptCount={scriptWorkspace.modules.length}
        buildInteractiveHtml={buildInteractiveHtmlForSurface}
      />

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

      <NewCallflowModal
        isOpen={isNewCallflowModalOpen}
        hasExistingWorkspace={scriptWorkspace.modules.length > 0 || code.trim().length > 0}
        onClose={() => setIsNewCallflowModalOpen(false)}
        onStartNewCallflow={handleStartNewCallflow}
      />

      <OfflineDownloadModal
        isOpen={isOfflineModalOpen}
        onClose={() => setIsOfflineModalOpen(false)}
        diagramTitle={diagramTitle}
        code={code}
        themeConfig={themeConfig}
        smartColorMode={smartColorMode}
        canvasSurface={canvasSurface}
        workspaceMode={workspaceMode}
        scriptWorkspace={scriptWorkspace}
        savedDiagrams={savedDiagrams}
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
      />
    </div>
  );
}
