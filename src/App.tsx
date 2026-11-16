import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  Eye,
  FileImage,
  Filter,
  GitBranch,
  Globe,
  Grid,
  Layers,
  Maximize2,
  Minimize2,
  Moon,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Scan,
  Sun,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CallflowDirectionFilter,
  DiagramDirection,
  DiagramTemplate,
  LogicAnalysisSummary,
  SavedDiagram,
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
  autoGroupCallflowByTopology,
  buildIsolatedPathMermaidCode,
  generateInteractiveCallflowHtml,
  parseCallflowGraph,
  resolveClickedNodeIdFromSvgElement,
  traceCallflowForNode,
} from './utils/callflowEngine';
import { ThemeConfigurator } from './components/ThemeConfigurator';
import { CallflowInspector } from './components/CallflowInspector';
import { TemplateGalleryModal } from './components/TemplateGalleryModal';
import { ExportModal } from './components/ExportModal';

const STORAGE_KEYS = {
  ACTIVE_CODE: 'mermaid_studio_local_active_code_v2',
  ACTIVE_TITLE: 'mermaid_studio_local_active_title_v2',
  ACTIVE_THEME: 'mermaid_studio_local_active_theme_v2',
  SMART_COLOR_MODE: 'mermaid_studio_local_smart_color_mode_v2',
  CANVAS_SURFACE: 'mermaid_studio_local_canvas_surface_v2',
  SAVED_LIST: 'mermaid_studio_local_saved_diagrams_v1',
};

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
  // Initial state loaded from localStorage or first template (Callflow template)
  const [diagramTitle, setDiagramTitle] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_TITLE) || MERMAID_TEMPLATES[0].name;
  });

  const [code, setCode] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_CODE) || MERMAID_TEMPLATES[0].code;
  });

  const [themeConfig, setThemeConfig] = useState<ThemeConfiguration>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_THEME);
      if (raw) {
        return { ...DEFAULT_THEME_CONFIG, ...JSON.parse(raw) };
      }
    } catch {
      // ignore corrupted local storage
    }
    return DEFAULT_THEME_CONFIG;
  });

  const [smartColorMode, setSmartColorMode] = useState<SmartColorMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SMART_COLOR_MODE);
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
    const saved = localStorage.getItem(STORAGE_KEYS.CANVAS_SURFACE);
    return saved === 'light' ? 'light' : 'dark';
  });

  const [savedDiagrams, setSavedDiagrams] = useState<SavedDiagram[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SAVED_LIST);
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
  const [isolateSubgraphMode, setIsolateSubgraphMode] = useState<boolean>(false);

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

  // Quick feedback states
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [quickDownloadFeedback, setQuickDownloadFeedback] = useState<
    'svg' | 'png' | 'html' | null
  >(null);
  const [isDownloadingPng, setIsDownloadingPng] = useState<boolean>(false);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  // Persist active work to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_CODE, code);
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TITLE, diagramTitle);
      localStorage.setItem(STORAGE_KEYS.ACTIVE_THEME, JSON.stringify(themeConfig));
      localStorage.setItem(STORAGE_KEYS.SMART_COLOR_MODE, smartColorMode);
      localStorage.setItem(STORAGE_KEYS.CANVAS_SURFACE, canvasSurface);
    } catch {
      // ignore storage quota errors
    }
  }, [code, diagramTitle, themeConfig, smartColorMode, canvasSurface]);

  // Parse local Callflow Graph from code
  const callflowGraph = useMemo(() => parseCallflowGraph(code), [code]);

  // Compute Upstream/Downstream Trace Result for the selected node
  const callflowTrace = useMemo(() => {
    if (!selectedCallflowNodeId) return null;
    if (!callflowGraph.nodes.has(selectedCallflowNodeId)) return null;
    return traceCallflowForNode(callflowGraph, selectedCallflowNodeId);
  }, [callflowGraph, selectedCallflowNodeId]);

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
        callflowDirectionFilter
      );
    }
    return code;
  }, [code, isolateSubgraphMode, callflowTrace, callflowGraph, currentDirection, callflowDirectionFilter]);

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

  // Apply Smart Logic Coloring AND Callflow Path Spotlight
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
      canvasSurface
    );

    // If a Callflow node is selected and we are in full diagram view, apply Spotlight dimming/highlighting
    const finalSvg =
      callflowTrace && !isolateSubgraphMode
        ? applyCallflowSpotlightToSvg(
            processed.svg,
            callflowTrace,
            canvasSurface,
            callflowGraph,
            callflowDirectionFilter
          )
        : processed.svg;

    return {
      coloredSvg: finalSvg,
      unfilteredColoredSvg: processed.svg,
      logicSummary: processed.summary,
    };
  }, [
    baseRenderedSvg,
    effectiveMermaidCode,
    smartColorMode,
    canvasSurface,
    callflowTrace,
    isolateSubgraphMode,
    callflowGraph,
    callflowDirectionFilter,
  ]);

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

  // Canvas Mouse Drag Pan + Click-to-Trace Node Detection
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    dragDistanceRef.current = 0;
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning) return;
    const nextX = e.clientX - panStartRef.current.x;
    const nextY = e.clientY - panStartRef.current.y;
    dragDistanceRef.current += Math.hypot(nextX - pan.x, nextY - pan.y);
    setPan({ x: nextX, y: nextY });
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    const wasClick = isPanning && dragDistanceRef.current < 6;
    setIsPanning(false);

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

  const handleAutoGroupTopology = () => {
    setCode((prev) => autoGroupCallflowByTopology(prev, callflowGraph));
  };

  // Local Storage Saved Diagrams management
  const handleSaveCurrentDiagram = (title: string) => {
    const newEntry: SavedDiagram = {
      id: `local-${Date.now()}`,
      title,
      code,
      updatedAt: Date.now(),
      themeConfig,
    };
    const updated = [newEntry, ...savedDiagrams];
    setSavedDiagrams(updated);
    setDiagramTitle(title);
    try {
      localStorage.setItem(STORAGE_KEYS.SAVED_LIST, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const handleLoadSavedDiagram = (saved: SavedDiagram) => {
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
    try {
      localStorage.setItem(STORAGE_KEYS.SAVED_LIST, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const handleImportFileContent = (title: string, importedCode: string) => {
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

  const handleQuickDownloadInteractiveHtml = () => {
    const exportSvg = unfilteredColoredSvg || coloredSvg;
    if (!exportSvg) return;
    const htmlContent = generateInteractiveCallflowHtml(
      diagramTitle,
      exportSvg,
      callflowGraph,
      canvasSurface
    );
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const safeName =
      diagramTitle.toLowerCase().replace(/[^a-z0-9äöüß_-]+/gi, '-') || 'mermaid-diagramm';
    triggerLocalDownload(blob, `${safeName}-interaktiv-callflow.html`);
    setQuickDownloadFeedback('html');
    setTimeout(() => setQuickDownloadFeedback(null), 2200);
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
  const showDesktopEditor = !isFullscreenPreview && !isDesktopEditorCollapsed;

  return (
    <div className="h-dvh w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Top Bar Contract: strictly 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-4 lg:gap-8 px-4 lg:px-6 h-12 lg:h-14 border-b border-slate-800 bg-slate-950 shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#studio"
          onClick={(e) => {
            e.preventDefault();
            handleFitToViewport();
          }}
          className="text-sm sm:text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          MermaidFree2UseOpen
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
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

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
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
      <main ref={workspaceRef} className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Pane 1: Live Mermaid Code Editor */}
        <section
          style={{
            width: showDesktopEditor ? `${splitRatio}%` : undefined,
          }}
          className={`${
            mobileActivePane === 'editor' ? 'flex w-full' : 'hidden'
          } ${
            showDesktopEditor ? 'lg:flex' : 'lg:hidden'
          } h-full flex-col bg-slate-950 lg:border-r border-slate-800 lg:min-w-[290px]`}
        >
          {/* Editor Top Toolbar */}
          <div className="px-3 sm:px-4 py-2 border-b border-slate-800 bg-slate-900/80 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <input
                type="text"
                value={diagramTitle}
                onChange={(e) => setDiagramTitle(e.target.value)}
                aria-label="Diagramm-Titel"
                className="bg-slate-950/90 border border-slate-800 focus:border-indigo-500 rounded-md px-2.5 py-1.5 lg:py-1 text-xs font-medium text-slate-100 truncate min-w-[110px] flex-1 max-w-[200px] focus:outline-none"
              />

              <select
                aria-label="Schnellvorlage wechseln"
                value=""
                onChange={(e) => {
                  const found = MERMAID_TEMPLATES.find((t) => t.id === e.target.value);
                  if (found) handleSelectTemplate(found);
                }}
                className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-md px-2 py-1.5 lg:py-1 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 max-w-[155px] truncate cursor-pointer"
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

            <div className="flex items-center gap-1.5 shrink-0">
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
            <button
              type="button"
              onClick={handleAutoGroupTopology}
              title="Gruppiert Startpunkte, Verteiler und Endpunkte automatisch in Subgraphs gegen Überlappungen"
              className="ml-auto px-2.5 py-1 bg-indigo-950/50 hover:bg-indigo-900/60 border border-indigo-500/40 rounded text-xs text-indigo-200 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
            >
              <Layers className="w-3 h-3 text-indigo-400" />
              <span>Start/Ende gruppieren</span>
            </button>
          </div>

          {/* Code Editor Body with Synchronized Line Numbers */}
          <div className="flex-1 flex min-h-0 relative font-mono text-[13px] leading-[22px] bg-[#090d16]">
            <div
              ref={gutterRef}
              aria-hidden="true"
              className="w-11 sm:w-12 py-4 bg-slate-950/90 border-r border-slate-800/80 text-right pr-2.5 sm:pr-3 text-slate-600 select-none overflow-hidden tabular-nums shrink-0"
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
              onChange={(e) => setCode(e.target.value)}
              onScroll={handleEditorScroll}
              onKeyDown={handleEditorKeyDown}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              placeholder="Mermaid v11 Callflow- oder Diagramm-Syntax hier eingeben oder einfügen..."
              className="flex-1 h-full p-3 sm:p-4 bg-transparent text-slate-100 font-mono text-[13px] leading-[22px] resize-none focus:outline-none overflow-y-auto selection:bg-indigo-500/30 select-text"
            />
          </div>

          {/* Editor Status & Syntax Diagnostic Footer */}
          <div className="border-t border-slate-800 bg-slate-900/95 px-3 sm:px-4 py-2.5 shrink-0">
            {validation.isValid ? (
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
            {/* Left: Editor Expand + Smart Logic Coloring + ELK Anti-Overlap Toggle */}
            <div className="flex items-center gap-2 shrink-0">
              {!isFullscreenPreview && (
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

              {/* Live Clarity / Smart Coloring Mode Switcher */}
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
                  onClick={() => setCanvasSurface('dark')}
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
                  onClick={() => setCanvasSurface('light')}
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

            {/* Right: Prominent 1-Click PNG Download + Interactive HTML Download + Right Panel Switch */}
            <div className="flex items-center gap-1.5 shrink-0">
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
                disabled={!coloredSvg}
                onClick={handleQuickDownloadInteractiveHtml}
                title="Als interaktive Einzel-HTML-Datei mit klickbarer Callflow-Filterung speichern"
                className="px-2.5 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/50 text-emerald-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  {quickDownloadFeedback === 'html' ? 'HTML geladen!' : 'Interaktive HTML'}
                </span>
              </button>

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

              <button
                type="button"
                onClick={() => setIsFullscreenPreview((prev) => !prev)}
                title={
                  isFullscreenPreview
                    ? 'Split-Editor wieder einblenden'
                    : 'Vorschau maximieren (Vollbild)'
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

          {/* Interactive Pan, Pinch-to-Zoom & Click-to-Trace Viewport */}
          <div
            ref={canvasViewportRef}
            onWheel={handleCanvasWheel}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={() => setIsPanning(false)}
            onTouchStart={handleCanvasTouchStart}
            onTouchMove={handleCanvasTouchMove}
            onTouchEnd={handleCanvasTouchEnd}
            onTouchCancel={() => setIsPanning(false)}
            onDoubleClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className={`flex-1 relative overflow-hidden flex items-center justify-center touch-none ${
              isPanning ? 'cursor-grabbing' : 'cursor-grab'
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
            {/* Active Callflow Trace Floating Pill on Canvas */}
            {callflowTrace && (
              <div className="absolute top-3 left-3 right-3 sm:right-auto z-20 px-3.5 py-2 rounded-xl bg-slate-900/95 border border-amber-500/60 text-xs flex flex-wrap items-center gap-3 shadow-xl">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 shrink-0" />
                  <span className="text-slate-300">Callflow-Pfad:</span>
                  <strong className="font-mono text-amber-300">
                    {callflowTrace.selectedNode.label}
                  </strong>
                  <span className="text-slate-400 tabular-nums">
                    ({callflowTrace.entryPoints.length} Start →{' '}
                    {callflowTrace.terminalPoints.length} Ende)
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

                  <button
                    type="button"
                    onClick={() => handleFocusNodeOnCanvas(callflowTrace.selectedNode.id, 1.35)}
                    title="Kamera direkt auf diesen Knoten zentrieren und lesbar heranzoomen"
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Auf Knoten zoomen
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
                      {isolateSubgraphMode ? 'Alle einblenden' : 'Nur diesen Pfad isolieren'}
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

            {/* Non-destructive warning overlay if user has a syntax error */}
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
                className="absolute top-14 left-3 right-3 sm:right-auto z-20 px-3 py-2 rounded-lg bg-rose-950/95 border border-rose-700/70 text-rose-200 text-xs flex items-center gap-2 shadow-lg text-left"
              >
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="truncate">
                  Syntaxfehler im Editor
                  {validation.errorLine ? ` (Zeile ${validation.errorLine})` : ''} — Tippen zum
                  Korrigieren
                </span>
              </button>
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
            ) : (
              <div className="max-w-md mx-4 text-center p-6 sm:p-8 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-300 space-y-3">
                <p className="text-sm font-semibold text-slate-100">
                  Kein Diagramm zur Anzeige vorhanden
                </p>
                <p className="text-xs text-slate-400">
                  Geben Sie im Editor gültigen Mermaid v11 Code ein oder wählen Sie eine fertige
                  Vorlage aus dem Katalog.
                </p>
                <button
                  type="button"
                  onClick={() => setLibraryModal({ isOpen: true, tab: 'templates' })}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Vorlagen-Bibliothek öffnen
                </button>
              </div>
            )}

            {/* Floating Bottom-Right Viewport Reset Button */}
            {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="absolute bottom-12 right-3 px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5 shadow-lg transition-colors whitespace-nowrap shrink-0 z-20"
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
          <div className="flex lg:hidden w-full h-full overflow-hidden">
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
              isolateSubgraphMode={isolateSubgraphMode}
              onToggleIsolateSubgraphMode={setIsolateSubgraphMode}
              themeConfig={themeConfig}
              onChangeThemeConfig={setThemeConfig}
              onAutoGroupTopology={handleAutoGroupTopology}
              onExportInteractiveHtml={handleQuickDownloadInteractiveHtml}
              onClose={() => setMobileActivePane('preview')}
              isMobileView={true}
            />
          </div>
        )}

        {mobileActivePane === 'theme' && (
          <div className="flex lg:hidden w-full h-full overflow-hidden">
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
              onChangeCanvasSurface={setCanvasSurface}
              onClose={() => setMobileActivePane('preview')}
              isMobileView={true}
            />
          </div>
        )}

        {/* Pane 3 (Desktop Right Sidebar with Switchable Tabs: Callflow-Inspektor vs. Logik-Farben & Theme) */}
        {isRightPanelOpen && (
          <div className="hidden lg:flex flex-col h-full shrink-0 border-l border-slate-800 bg-slate-900/95">
            {/* Desktop Right Sidebar Mode Switcher */}
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

            <div className="flex-1 min-h-0 flex overflow-hidden">
              {rightSidebarTab === 'callflow' ? (
                <CallflowInspector
                  graph={callflowGraph}
                  selectedNodeId={selectedCallflowNodeId}
                  onSelectNodeId={setSelectedCallflowNodeId}
                  onFocusNodeOnCanvas={(id) => handleFocusNodeOnCanvas(id, 1.25)}
                  traceResult={callflowTrace}
                  directionFilter={callflowDirectionFilter}
                  onChangeDirectionFilter={setCallflowDirectionFilter}
                  isolateSubgraphMode={isolateSubgraphMode}
                  onToggleIsolateSubgraphMode={setIsolateSubgraphMode}
                  themeConfig={themeConfig}
                  onChangeThemeConfig={setThemeConfig}
                  onAutoGroupTopology={handleAutoGroupTopology}
                  onExportInteractiveHtml={handleQuickDownloadInteractiveHtml}
                  onClose={() => setIsRightPanelOpen(false)}
                  isMobileView={false}
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
                  onChangeCanvasSurface={setCanvasSurface}
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
        className="lg:hidden h-14 border-t border-slate-800 bg-slate-950/95 backdrop-blur-md grid grid-cols-5 items-center px-1.5 shrink-0 z-30"
      >
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
            Vorschau
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
            Callflow
          </span>
        </button>

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
      />
    </div>
  );
}
