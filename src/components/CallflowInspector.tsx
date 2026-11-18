import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Edit3,
  FileText,
  Filter,
  FolderPlus,
  FolderSearch,
  GitBranch,
  Grid,
  Layers,
  ListChecks,
  MessageSquarePlus,
  Move,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sliders,
  Upload,
  X,
} from 'lucide-react';
import {
  CallflowBuildingBlockType,
  CallflowDirectionFilter,
  CallflowGraph,
  CallflowHopDepth,
  CallflowIssueResolution,
  CallflowNode,
  CallflowOpenIssue,
  CallflowTraceResult,
  CallflowViewLevel,
  MermaidLayoutEngine,
  ScriptOrigin,
  ScriptWorkspace,
  ThemeConfiguration,
} from '../types/mermaidStudio';
import {
  analyzeWorkspaceLogicHealth,
  buildWorkspaceRoutingMatrix,
  buildWorkspaceScheduleOverview,
  canonicalScriptMatchKey,
  exportMigrationDocumentationMarkdown,
  exportOpeningHoursCsv,
  exportRoutingMatrixCsv,
  extractScriptNumberFromNodeId,
  extractScriptSpecialParameters,
  extractWorkspaceResourceRegistry,
  formatScriptDisplayLabel,
  toMermaidNodeSuffix,
} from '../utils/scriptCallflowParser';
import {
  CALLFLOW_CHECKLIST_ACCEPT,
  FolderAutoResolveSummary,
  FolderScriptFileEntry,
  FolderScriptPool,
} from '../utils/callflowFileImporter';

interface CallflowInspectorProps {
  graph: CallflowGraph;
  selectedNodeId: string | null;
  onSelectNodeId: (id: string | null) => void;
  onFocusNodeOnCanvas?: (id: string) => void;
  traceResult: CallflowTraceResult | null;
  directionFilter: CallflowDirectionFilter;
  onChangeDirectionFilter: (dir: CallflowDirectionFilter) => void;
  hopDepth: CallflowHopDepth;
  onChangeHopDepth: (depth: CallflowHopDepth) => void;
  isolateSubgraphMode: boolean;
  onToggleIsolateSubgraphMode: (isolate: boolean) => void;
  themeConfig: ThemeConfiguration;
  onChangeThemeConfig: (next: ThemeConfiguration) => void;
  scriptWorkspace: ScriptWorkspace;
  viewLevel: CallflowViewLevel;
  onOpenNewCallflowModal?: () => void;
  onOpenMultiScriptModal: (prefillNumber?: string) => void;
  onResolveIssue?: (
    issue: CallflowOpenIssue,
    action: {
      resolution: CallflowIssueResolution;
      linkedTargetNumber?: string;
      linkLabel?: string;
      note?: string;
    }
  ) => ScriptWorkspace | void | null;
  onReopenIssue?: (issue: CallflowOpenIssue) => void;
  onAddManualQuestion?: (scriptNumber: string, question: string) => void;
  onSelectMasterScript?: (scriptNumber: string) => void;
  onSubmitChecklistDetailScript?: (
    targetRef: string,
    rawText: string,
    origin: ScriptOrigin
  ) => ScriptWorkspace | null;
  onSubmitChecklistVisioFile?: (targetRef: string, file: File) => Promise<ScriptWorkspace | null>;
  onUnignoreChecklistTarget?: (targetRef: string) => void;
  focusChecklistTrigger?: { refKey: string; nonce: number } | null;
  onSwitchViewLevel: (next: CallflowViewLevel) => void;
  onExportInteractiveHtml: () => void;
  isExportingHtml?: boolean;
  onClose: () => void;
  isMobileView?: boolean;
  workspaceMode?: 'guided' | 'free';
  onChangeWorkspaceMode?: (mode: 'guided' | 'free') => void;
  guidedStep?: 1 | 2 | 3;
  onChangeGuidedStep?: (step: 1 | 2 | 3) => void;
  isVisualEditMode?: boolean;
  onToggleVisualEditMode?: (active: boolean) => void;
  onAddBuildingBlock?: (type: CallflowBuildingBlockType) => void;
  onOpenNodeEditor?: (nodeId: string) => void;
  onResetAllNodeOffsets?: () => void;
  hasCustomNodeOffsets?: boolean;
  assignedFolderPool?: FolderScriptPool | null;
  lastFolderResolveSummary?: FolderAutoResolveSummary | null;
  isAutoResolvingFolder?: boolean;
  onAssignFolderAndAutoResolve?: (files: FileList | File[]) => Promise<void>;
  onSelectStartScriptFromAssignedFolder?: (entry: FolderScriptFileEntry) => Promise<void>;
  onClearAssignedFolder?: () => void;
}

const CallflowInspectorInner: React.FC<CallflowInspectorProps> = ({
  graph,
  selectedNodeId,
  onSelectNodeId,
  onFocusNodeOnCanvas,
  traceResult,
  directionFilter,
  onChangeDirectionFilter,
  hopDepth,
  onChangeHopDepth,
  isolateSubgraphMode,
  onToggleIsolateSubgraphMode,
  themeConfig,
  onChangeThemeConfig,
  scriptWorkspace,
  viewLevel,
  onOpenNewCallflowModal,
  onOpenMultiScriptModal,
  onResolveIssue,
  onReopenIssue,
  onAddManualQuestion,
  onSelectMasterScript,
  onSubmitChecklistDetailScript,
  onSubmitChecklistVisioFile,
  onUnignoreChecklistTarget,
  focusChecklistTrigger,
  onSwitchViewLevel,
  onExportInteractiveHtml,
  isExportingHtml = false,
  onClose,
  isMobileView = false,
  workspaceMode = 'guided',
  onChangeWorkspaceMode,
  guidedStep: controlledGuidedStep,
  onChangeGuidedStep,
  isVisualEditMode = false,
  onToggleVisualEditMode,
  onAddBuildingBlock,
  onOpenNodeEditor,
  onResetAllNodeOffsets,
  hasCustomNodeOffsets = false,
  assignedFolderPool = null,
  lastFolderResolveSummary = null,
  isAutoResolvingFolder = false,
  onAssignFolderAndAutoResolve,
  onSelectStartScriptFromAssignedFolder,
  onClearAssignedFolder,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [issueFilterTab, setIssueFilterTab] = useState<'open' | 'resolved'>('open');
  const [isAddingQuestion, setIsAddingQuestion] = useState(false);
  const [newQuestionScript, setNewQuestionScript] = useState('');
  const [newQuestionText, setNewQuestionText] = useState('');
  const [linkDraftByIssueId, setLinkDraftByIssueId] = useState<Record<string, string>>({});
  const [noteDraftByIssueId, setNoteDraftByIssueId] = useState<Record<string, string>>({});

  // Guided 3-Step Wizard State (1: Main laden, 2: Referenzen abarbeiten, 3: Prüfen & Exportieren)
  const [internalGuidedStep, setInternalGuidedStep] = useState<1 | 2 | 3>(() =>
    scriptWorkspace.modules.length === 0 ? 1 : 2
  );
  const guidedStep = controlledGuidedStep ?? internalGuidedStep;
  const setGuidedStep = (next: 1 | 2 | 3) => {
    setInternalGuidedStep(next);
    onChangeGuidedStep?.(next);
  };
  const [guidedMainDraft, setGuidedMainDraft] = useState('');
  const [guidedMainFeedback, setGuidedMainFeedback] = useState<string | null>(null);
  const [isImportingGuidedMainVisio, setIsImportingGuidedMainVisio] = useState(false);
  const guidedMainVisioInputRef = useRef<HTMLInputElement>(null);
  const folderAssignInputRef = useRef<HTMLInputElement | null>(null);
  const [folderStartSearch, setFolderStartSearch] = useState('');
  const prevModulesCountRef = useRef<number>(scriptWorkspace.modules.length);

  // Top-Down Masterscript Checklist Wizard & Sync Map state
  const [inspectorTab, setInspectorTab] = useState<
    'overview' | 'schedules' | 'health' | 'registry' | 'matrix'
  >('overview');
  const [scheduleFilter, setScheduleFilter] = useState<
    'all' | 'with-hours' | 'holiday' | 'without-hours'
  >('all');
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<'all' | 'error' | 'warning'>('all');
  const [registrySubTab, setRegistrySubTab] = useState<
    'skillsets' | 'announcements' | 'special' | 'variables' | 'crossrefs'
  >('skillsets');
  const [registrySearch, setRegistrySearch] = useState('');
  const [matrixSearch, setMatrixSearch] = useState('');
  const [copyReportFeedback, setCopyReportFeedback] = useState(false);

  const [activeChecklistRef, setActiveChecklistRef] = useState<string | null>(null);
  const [checklistFilter, setChecklistFilter] = useState<'all' | 'todo' | 'synced'>('all');
  const [checklistDraftText, setChecklistDraftText] = useState('');
  const [checklistFeedback, setChecklistFeedback] = useState<string | null>(null);
  const [isEditingCompletedItem, setIsEditingCompletedItem] = useState(false);
  const [isImportingChecklistVisio, setIsImportingChecklistVisio] = useState(false);
  const checklistVisioInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusChecklistTrigger?.refKey) {
      setInspectorTab('overview');
      setGuidedStep(2);
      setActiveChecklistRef(focusChecklistTrigger.refKey);
      setChecklistFilter('all');
      setChecklistFeedback(null);
      setIsEditingCompletedItem(false);
    }
  }, [focusChecklistTrigger]);

  useEffect(() => {
    const prevCount = prevModulesCountRef.current;
    const nextCount = scriptWorkspace.modules.length;
    prevModulesCountRef.current = nextCount;
    if (nextCount === 0) {
      setGuidedStep(1);
    } else if (prevCount === 0 && nextCount > 0) {
      setGuidedStep(2);
    }
  }, [scriptWorkspace.modules.length]);

  useEffect(() => {
    setChecklistFilter('all');
  }, [scriptWorkspace.masterScriptNumber]);

  // Decouple heavy workspace analyzers from nodeOffsets & updatedAt so node dragging never re-runs scans
  const moduleOnlyWorkspace = useMemo<ScriptWorkspace>(
    () => ({
      ...scriptWorkspace,
      nodeOffsets: undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      scriptWorkspace.modules,
      scriptWorkspace.masterScriptNumber,
      scriptWorkspace.externalEndpoints,
      scriptWorkspace.manualLinks,
      scriptWorkspace.treatUnresolvedAsEndpoint,
    ]
  );

  // Lazy tab warmup: active tab evaluates immediately; background Free-Mode tabs warm up sequentially when idle
  const [idleWarmPhase, setIdleWarmPhase] = useState<number>(0);

  useEffect(() => {
    setIdleWarmPhase(0);
    if (scriptWorkspace.modules.length === 0) return;

    let cancelled = false;
    let phase = 0;
    const maxPhase = workspaceMode === 'free' ? 4 : 1;
    let handleId: number | null = null;
    let usedIdleCallback = false;

    const scheduleNext = () => {
      if (cancelled || phase >= maxPhase) return;
      const runStep = () => {
        if (cancelled) return;
        phase += 1;
        setIdleWarmPhase(phase);
        scheduleNext();
      };
      const win = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      if (typeof win.requestIdleCallback === 'function') {
        usedIdleCallback = true;
        handleId = win.requestIdleCallback(runStep, { timeout: 140 });
      } else {
        usedIdleCallback = false;
        handleId = window.setTimeout(runStep, 45);
      }
    };

    scheduleNext();

    return () => {
      cancelled = true;
      if (handleId !== null) {
        const win = window as Window & { cancelIdleCallback?: (id: number) => void };
        if (usedIdleCallback && typeof win.cancelIdleCallback === 'function') {
          win.cancelIdleCallback(handleId);
        } else {
          window.clearTimeout(handleId);
        }
      }
    };
  }, [moduleOnlyWorkspace, workspaceMode, scriptWorkspace.modules.length]);

  const shouldComputeHealth =
    (workspaceMode === 'guided' && (guidedStep === 3 || idleWarmPhase >= 1)) ||
    (workspaceMode === 'free' && (inspectorTab === 'health' || idleWarmPhase >= 1));

  const shouldComputeSchedules =
    workspaceMode === 'free' && (inspectorTab === 'schedules' || idleWarmPhase >= 2);
  const shouldComputeRegistry =
    workspaceMode === 'free' && (inspectorTab === 'registry' || idleWarmPhase >= 3);
  const shouldComputeMatrix =
    workspaceMode === 'free' && (inspectorTab === 'matrix' || idleWarmPhase >= 4);

  const healthFindings = useMemo(
    () => (shouldComputeHealth ? analyzeWorkspaceLogicHealth(moduleOnlyWorkspace) : []),
    [shouldComputeHealth, moduleOnlyWorkspace]
  );
  const healthErrorCount = useMemo(
    () => healthFindings.filter((f) => f.severity === 'error').length,
    [healthFindings]
  );
  const healthWarningCount = useMemo(
    () => healthFindings.filter((f) => f.severity === 'warning').length,
    [healthFindings]
  );
  const filteredHealthFindings = useMemo(() => {
    if (healthFilter === 'error') {
      return healthFindings.filter((f) => f.severity === 'error');
    }
    if (healthFilter === 'warning') {
      return healthFindings.filter((f) => f.severity === 'warning');
    }
    return healthFindings;
  }, [healthFindings, healthFilter]);

  const resourceRegistry = useMemo(
    () =>
      shouldComputeRegistry
        ? extractWorkspaceResourceRegistry(moduleOnlyWorkspace)
        : { skillsets: [], announcements: [], variables: [], crossRefs: [] },
    [shouldComputeRegistry, moduleOnlyWorkspace]
  );
  const totalRegistryCount =
    resourceRegistry.skillsets.length +
    resourceRegistry.announcements.length +
    resourceRegistry.variables.length;

  const routingMatrixRows = useMemo(
    () => (shouldComputeMatrix ? buildWorkspaceRoutingMatrix(moduleOnlyWorkspace) : []),
    [shouldComputeMatrix, moduleOnlyWorkspace]
  );
  const filteredMatrixRows = useMemo(() => {
    const q = matrixSearch.trim().toLowerCase();
    if (!q) return routingMatrixRows;
    return routingMatrixRows.filter(
      (r) =>
        r.scriptNumber.toLowerCase().includes(q) ||
        r.scriptName.toLowerCase().includes(q) ||
        r.stepName.toLowerCase().includes(q) ||
        r.conditionAndSchedule.toLowerCase().includes(q) ||
        r.announcement.toLowerCase().includes(q) ||
        r.queueTarget.toLowerCase().includes(q) ||
        r.targetsAndChoices.toLowerCase().includes(q)
    );
  }, [routingMatrixRows, matrixSearch]);

  const jumpToScriptInInspector = (
    scriptNumber: string,
    openDetail = false,
    switchMobileToCanvas = false
  ) => {
    const nodeId = `S_${toMermaidNodeSuffix(scriptNumber)}`;
    if (graph.nodes.has(nodeId)) {
      onSelectNodeId(nodeId);
      if (!isMobileView || switchMobileToCanvas) {
        onFocusNodeOnCanvas?.(nodeId);
      }
    }
    if (openDetail) {
      const exists = scriptWorkspace.modules.some(
        (m) => canonicalScriptMatchKey(m.scriptNumber) === canonicalScriptMatchKey(scriptNumber)
      );
      if (exists) {
        onSwitchViewLevel({ level: 'detail', scriptNumber });
        if (isMobileView && switchMobileToCanvas) {
          onClose();
        }
      }
    }
  };

  const scheduleOverviewRows = useMemo(
    () => (shouldComputeSchedules ? buildWorkspaceScheduleOverview(moduleOnlyWorkspace) : []),
    [shouldComputeSchedules, moduleOnlyWorkspace]
  );
  const scheduleWithHoursCount = useMemo(
    () => scheduleOverviewRows.filter((r) => r.hasSchedule).length,
    [scheduleOverviewRows]
  );
  const scheduleHolidayCount = useMemo(
    () => scheduleOverviewRows.filter((r) => r.hasHoliday).length,
    [scheduleOverviewRows]
  );
  const scheduleWithoutHoursCount = useMemo(
    () => scheduleOverviewRows.filter((r) => !r.hasSchedule && !r.hasHoliday).length,
    [scheduleOverviewRows]
  );
  const filteredScheduleRows = useMemo(() => {
    const q = scheduleSearch.trim().toLowerCase();
    return scheduleOverviewRows.filter((r) => {
      if (scheduleFilter === 'with-hours' && !r.hasSchedule) return false;
      if (scheduleFilter === 'holiday' && !r.hasHoliday) return false;
      if (scheduleFilter === 'without-hours' && (r.hasSchedule || r.hasHoliday)) return false;
      if (!q) return true;
      return (
        r.scriptNumber.toLowerCase().includes(q) ||
        r.scriptName.toLowerCase().includes(q) ||
        r.stepName.toLowerCase().includes(q) ||
        r.openingHours.toLowerCase().includes(q) ||
        r.holidayAndSpecial.toLowerCase().includes(q) ||
        r.closedOrOverflowAction.toLowerCase().includes(q)
      );
    });
  }, [scheduleOverviewRows, scheduleFilter, scheduleSearch]);

  const handleDownloadOpeningHoursCsv = () => {
    const csv = exportOpeningHoursCsv(scriptWorkspace);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `callflow-oeffnungszeiten-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsvMatrix = () => {
    const csv = exportRoutingMatrixCsv(scriptWorkspace);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `callflow-routing-matrix-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadMarkdownDoc = () => {
    const md = exportMigrationDocumentationMarkdown(scriptWorkspace);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `callflow-migrations-konzept-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyMarkdownDoc = async () => {
    const md = exportMigrationDocumentationMarkdown(scriptWorkspace);
    try {
      await navigator.clipboard.writeText(md);
      setCopyReportFeedback(true);
      setTimeout(() => setCopyReportFeedback(false), 2200);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const masterChecklist = scriptWorkspace.masterChecklist || [];
  const ignoredTargets = scriptWorkspace.ignoredChecklistTargets || [];
  const mainModule = useMemo(() => {
    const preferredKey = scriptWorkspace.masterScriptNumber
      ? canonicalScriptMatchKey(scriptWorkspace.masterScriptNumber)
      : '';
    return (
      scriptWorkspace.modules.find(
        (m) => preferredKey && canonicalScriptMatchKey(m.scriptNumber) === preferredKey
      ) ||
      scriptWorkspace.modules.find((m) => m.isMaster) ||
      scriptWorkspace.modules[0]
    );
  }, [scriptWorkspace.modules, scriptWorkspace.masterScriptNumber]);
  const mainScriptLabel =
    mainModule &&
    (canonicalScriptMatchKey(mainModule.scriptNumber) === 'main' || mainModule.isMaster)
      ? 'Main'
      : mainModule
      ? formatScriptDisplayLabel(mainModule)
      : 'Main';

  const {
    checklistMissingCount,
    checklistPresentCount,
    checklistExternalCount,
    checklistDoneCount,
    directMainMissingCount,
    nestedMissingCount,
    syncPercent,
  } = useMemo(() => {
    const loadedModuleKeys = new Set(
      scriptWorkspace.modules.map((m) => canonicalScriptMatchKey(m.scriptNumber))
    );
    const externalKeys = new Set(
      (scriptWorkspace.externalEndpoints || []).map(canonicalScriptMatchKey)
    );
    const directMainTargetKeys = new Set<string>();
    if (mainModule) {
      mainModule.outgoingNumbers.forEach((t) =>
        directMainTargetKeys.add(canonicalScriptMatchKey(t))
      );
      mainModule.rules.forEach((r) => {
        if (r.targetNumber) directMainTargetKeys.add(canonicalScriptMatchKey(r.targetNumber));
        r.choices.forEach((c) => {
          if (c.targetNumber) directMainTargetKeys.add(canonicalScriptMatchKey(c.targetNumber));
        });
      });
    }

    let missing = 0;
    let present = 0;
    let external = 0;
    let directMainMissing = 0;

    masterChecklist.forEach((item) => {
      const refKeyCanon = canonicalScriptMatchKey(item.refKey);
      const isPresentInModules =
        item.status === 'present' || loadedModuleKeys.has(refKeyCanon);
      const isExternal =
        item.status === 'external' || (!isPresentInModules && externalKeys.has(refKeyCanon));

      if (!isPresentInModules && !isExternal) {
        missing += 1;
        if ((item.depth || 1) === 1 || directMainTargetKeys.has(refKeyCanon)) {
          directMainMissing += 1;
        }
      } else if (isPresentInModules) {
        present += 1;
      } else {
        external += 1;
      }
    });

    const total = masterChecklist.length;
    const done = present + external;
    const pct = total > 0 ? Math.round((done / total) * 100) : 100;

    return {
      checklistMissingCount: missing,
      checklistPresentCount: present,
      checklistExternalCount: external,
      checklistDoneCount: done,
      directMainMissingCount: directMainMissing,
      nestedMissingCount: missing - directMainMissing,
      syncPercent: pct,
    };
  }, [
    masterChecklist,
    mainModule,
    scriptWorkspace.modules,
    scriptWorkspace.externalEndpoints,
  ]);

  const diagramNodeChecklistScope = useMemo(() => {
    if (!selectedNodeId || viewLevel.level !== 'master') return null;

    const mainNodeSuffix = mainModule ? `S_${toMermaidNodeSuffix(mainModule.scriptNumber)}` : 'S_Main';
    if (
      canonicalScriptMatchKey(selectedNodeId) === canonicalScriptMatchKey(mainNodeSuffix) ||
      canonicalScriptMatchKey(selectedNodeId) === 's_main'
    ) {
      return null;
    }

    const nodeLabel =
      traceResult?.selectedNode.label || graph.nodes.get(selectedNodeId)?.label || selectedNodeId;
    const isFax = selectedNodeId === 'FAX_BUNDLE';
    const isOrga = selectedNodeId.startsWith('ORG_');

    // Collect downstream script node IDs reachable from this node in the diagram
    const downstreamIds = new Set<string>();
    if (traceResult) {
      traceResult.downstreamNodeIds.forEach((id) => downstreamIds.add(id));
      downstreamIds.add(traceResult.selectedNode.id);
    }

    const matchesItem = (item: (typeof masterChecklist)[number]): boolean => {
      const expectedNodeId = `S_${toMermaidNodeSuffix(item.refKey)}`;
      if (isFax) {
        return Boolean(item.isFaxRoute) || downstreamIds.has(expectedNodeId);
      }
      if (isOrga) {
        if (downstreamIds.has(expectedNodeId)) return true;
        const orgSlug = canonicalScriptMatchKey(selectedNodeId.replace(/^ORG_/, ''));
        return Boolean(
          item.organizationNames?.some(
            (org) =>
              canonicalScriptMatchKey(org) === orgSlug ||
              canonicalScriptMatchKey(nodeLabel).includes(canonicalScriptMatchKey(org))
          )
        );
      }
      if (selectedNodeId.startsWith('S_')) {
        if (expectedNodeId === selectedNodeId) return true;
        return downstreamIds.has(expectedNodeId);
      }
      return true;
    };

    return {
      nodeId: selectedNodeId,
      label: nodeLabel.replace(/\s+/g, ' ').trim(),
      isFax,
      isOrga,
      matchesItem,
    };
  }, [selectedNodeId, viewLevel.level, mainModule, traceResult, graph.nodes]);

  const diagramScopedChecklist = useMemo(() => {
    if (!diagramNodeChecklistScope) return masterChecklist;
    const matched = masterChecklist.filter(diagramNodeChecklistScope.matchesItem);
    return matched.length > 0 ? matched : masterChecklist;
  }, [masterChecklist, diagramNodeChecklistScope]);

  const filteredChecklistItems = useMemo(() => {
    if (checklistFilter === 'todo') {
      return diagramScopedChecklist
        .filter((item) => item.status === 'missing')
        .sort((a, b) => {
          const depthDiff = (a.depth || 1) - (b.depth || 1);
          return depthDiff !== 0 ? depthDiff : a.orderIndex - b.orderIndex;
        });
    }
    if (checklistFilter === 'synced') {
      return diagramScopedChecklist.filter((item) => item.status !== 'missing');
    }
    return diagramScopedChecklist;
  }, [diagramScopedChecklist, checklistFilter]);

  const activeChecklistItem = useMemo(() => {
    if (masterChecklist.length === 0) return null;
    if (activeChecklistRef) {
      const explicit = diagramScopedChecklist.find(
        (item) => canonicalScriptMatchKey(item.refKey) === canonicalScriptMatchKey(activeChecklistRef)
      );
      if (explicit) return explicit;
    }
    return (
      diagramScopedChecklist.find((item) => item.status === 'missing') ||
      diagramScopedChecklist[0] ||
      masterChecklist[0]
    );
  }, [masterChecklist, diagramScopedChecklist, activeChecklistRef]);

  const advanceToNextMissingChecklistItem = (currentRef: string, afterList = masterChecklist) => {
    const idx = afterList.findIndex(
      (it) => canonicalScriptMatchKey(it.refKey) === canonicalScriptMatchKey(currentRef)
    );
    const orderedCandidates =
      idx >= 0 ? [...afterList.slice(idx + 1), ...afterList.slice(0, idx)] : afterList;
    const nextOpen = orderedCandidates.find(
      (it) =>
        canonicalScriptMatchKey(it.refKey) !== canonicalScriptMatchKey(currentRef) &&
        it.status === 'missing'
    );
    setChecklistDraftText('');
    setChecklistFeedback(null);
    setIsEditingCompletedItem(false);
    if (nextOpen) {
      setActiveChecklistRef(nextOpen.refKey);
      const nextNodeId = `S_${toMermaidNodeSuffix(nextOpen.refKey)}`;
      if (graph.nodes.has(nextNodeId)) {
        onSelectNodeId(nextNodeId);
      }
    } else {
      setActiveChecklistRef(null);
    }
  };

  const allIssues = scriptWorkspace.issues || [];
  const openIssues = useMemo(
    () => allIssues.filter((i) => i.status === 'open'),
    [allIssues]
  );
  const resolvedIssues = useMemo(
    () => allIssues.filter((i) => i.status === 'resolved'),
    [allIssues]
  );

  const allNodesList = useMemo(() => {
    const arr = Array.from(graph.nodes.values());
    const q = searchQuery.trim().toLowerCase();
    if (!q) return arr;
    return arr.filter(
      (n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)
    );
  }, [graph.nodes, searchQuery]);

  const maxHops = hopDepth === 'all' ? Number.POSITIVE_INFINITY : hopDepth;

  const filteredEntryPoints = useMemo(() => {
    if (!traceResult || directionFilter === 'downstream') return [];
    return traceResult.entryPoints
      .filter((n) => {
        const d = traceResult.upstreamDepthByNodeId.get(n.id);
        return d !== undefined && d <= maxHops;
      })
      .map((n) => {
        const d = traceResult.upstreamDepthByNodeId.get(n.id) || 0;
        return {
          node: n,
          badge: d === 0 ? 'Dieser Knoten' : `-${d} ${d === 1 ? 'Ebene' : 'Ebenen'}`,
        };
      });
  }, [traceResult, directionFilter, maxHops]);

  const filteredTerminalPoints = useMemo(() => {
    if (!traceResult || directionFilter === 'upstream') return [];
    return traceResult.terminalPoints
      .filter((n) => {
        const d = traceResult.downstreamDepthByNodeId.get(n.id);
        return d !== undefined && d <= maxHops;
      })
      .map((n) => {
        const d = traceResult.downstreamDepthByNodeId.get(n.id) || 0;
        return {
          node: n,
          badge: d === 0 ? 'Dieser Knoten' : `+${d} ${d === 1 ? 'Ebene' : 'Ebenen'}`,
        };
      });
  }, [traceResult, directionFilter, maxHops]);

  const selectedNodeScriptTarget = useMemo(() => {
    if (!traceResult) return null;
    const num = extractScriptNumberFromNodeId(
      traceResult.selectedNode.id,
      scriptWorkspace.modules
    );
    if (!num) return null;
    const mod = scriptWorkspace.modules.find(
      (m) => canonicalScriptMatchKey(m.scriptNumber) === canonicalScriptMatchKey(num)
    );
    if (!mod) return null;
    if (
      viewLevel.level === 'detail' &&
      canonicalScriptMatchKey(viewLevel.scriptNumber) === canonicalScriptMatchKey(num)
    ) {
      return null;
    }
    return mod;
  }, [traceResult, scriptWorkspace.modules, viewLevel]);

  const handleLayoutEngineChange = (engine: MermaidLayoutEngine) => {
    onChangeThemeConfig({
      ...themeConfig,
      layoutEngine: engine,
    });
  };

  const handleApplyDensityPreset = (nodeSpacing: number, rankSpacing: number) => {
    onChangeThemeConfig({
      ...themeConfig,
      layoutEngine: 'dagre',
      nodeSpacing,
      rankSpacing,
    });
  };

  const handleSpacingChange = (key: 'nodeSpacing' | 'rankSpacing', val: number) => {
    onChangeThemeConfig({
      ...themeConfig,
      [key]: val,
    });
  };

  return (
    <aside
      className={`${
        isMobileView
          ? 'w-full min-w-0 flex-1 bg-slate-950'
          : 'w-84 xl:w-92 shrink-0 border-l border-slate-800 bg-slate-900/95'
      } flex flex-col h-full select-none overflow-hidden`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="w-4 h-4 text-indigo-400 shrink-0" />
          <h2 className="text-sm font-semibold text-slate-100 truncate">
            {workspaceMode === 'guided' ? 'Geführter Assistent' : 'Callflow-Inspektor'}
          </h2>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {selectedNodeId && (
            <button
              type="button"
              onClick={() => {
                onSelectNodeId(null);
                onToggleIsolateSubgraphMode(false);
              }}
              title="Pfad-Filter zurücksetzen"
              className="px-2 py-1 text-[11px] font-medium text-indigo-300 hover:text-white bg-indigo-950/60 border border-indigo-500/40 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Alle zeigen
            </button>
          )}
          {onChangeWorkspaceMode && (
            <button
              type="button"
              onClick={() =>
                onChangeWorkspaceMode(workspaceMode === 'guided' ? 'free' : 'guided')
              }
              title={
                workspaceMode === 'guided'
                  ? 'In den Freien Modus mit Mermaid-Editor und allen Experten-Tabs wechseln'
                  : 'Zurück in den aufgeräumten 3-Schritt-Assistenten wechseln'
              }
              className="px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {workspaceMode === 'guided' ? 'Freier Modus' : 'Geführt'}
            </button>
          )}
          {!isMobileView && workspaceMode === 'free' && (
            <button
              type="button"
              onClick={onClose}
              title="Inspektor schließen"
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Mode-Specific Top Navigation: 3-Step Stepper in Guided Mode vs 4 Tabs in Free Mode */}
      {workspaceMode === 'guided' ? (
        <div className="grid grid-cols-3 gap-1.5 px-3 py-2.5 border-b border-slate-800 bg-slate-950/90 shrink-0">
          <button
            type="button"
            onClick={() => setGuidedStep(1)}
            className={`px-2 py-2 rounded-lg text-[11px] font-medium transition-colors flex flex-col items-start gap-0.5 border cursor-pointer ${
              guidedStep === 1
                ? 'bg-indigo-600/25 text-indigo-100 border-indigo-500/50'
                : scriptWorkspace.modules.length > 0
                ? 'bg-emerald-950/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-950/35'
                : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between w-full gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider opacity-80">
                Schritt 1
              </span>
              {scriptWorkspace.modules.length > 0 && (
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
              )}
            </div>
            <span className="font-semibold truncate w-full text-left">Main laden</span>
          </button>

          <button
            type="button"
            onClick={() => setGuidedStep(2)}
            className={`px-2 py-2 rounded-lg text-[11px] font-medium transition-colors flex flex-col items-start gap-0.5 border cursor-pointer ${
              guidedStep === 2
                ? 'bg-indigo-600/25 text-indigo-100 border-indigo-500/50'
                : scriptWorkspace.modules.length > 0 && checklistMissingCount === 0
                ? 'bg-emerald-950/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-950/35'
                : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between w-full gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider opacity-80">
                Schritt 2
              </span>
              {scriptWorkspace.modules.length > 0 &&
                (checklistMissingCount > 0 ? (
                  <span className="text-[10px] font-mono text-amber-300 tabular-nums">
                    {checklistMissingCount} offen
                  </span>
                ) : (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                ))}
            </div>
            <span className="font-semibold truncate w-full text-left">Referenzen</span>
          </button>

          <button
            type="button"
            onClick={() => setGuidedStep(3)}
            className={`px-2 py-2 rounded-lg text-[11px] font-medium transition-colors flex flex-col items-start gap-0.5 border cursor-pointer ${
              guidedStep === 3
                ? 'bg-indigo-600/25 text-indigo-100 border-indigo-500/50'
                : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center justify-between w-full gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider opacity-80">
                Schritt 3
              </span>
              {scriptWorkspace.modules.length > 0 && (
                <span
                  className={`text-[10px] font-mono tabular-nums ${
                    healthErrorCount > 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {healthFindings.length}
                </span>
              )}
            </div>
            <span className="font-semibold truncate w-full text-left">Prüfen &amp; Export</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-1 px-2.5 py-2 border-b border-slate-800 bg-slate-950/90 shrink-0">
          <button
            type="button"
            onClick={() => setInspectorTab('overview')}
            className={`px-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              inspectorTab === 'overview'
                ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-1">
              <ListChecks className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Checkliste</span>
            </div>
            <span
              className={`text-[10px] font-mono tabular-nums ${
                checklistMissingCount > 0 ? 'text-amber-300' : 'text-emerald-400'
              }`}
            >
              {checklistMissingCount > 0 ? `${checklistMissingCount} offen` : 'Synchron'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setInspectorTab('schedules')}
            className={`px-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              inspectorTab === 'schedules'
                ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Zeiten</span>
            </div>
            <span
              className={`text-[10px] font-mono tabular-nums ${
                scheduleWithHoursCount + scheduleHolidayCount > 0
                  ? 'text-sky-300'
                  : 'text-slate-400'
              }`}
            >
              {!shouldComputeSchedules
                ? '…'
                : scheduleWithHoursCount + scheduleHolidayCount > 0
                ? `${scheduleWithHoursCount + scheduleHolidayCount} aktiv`
                : `${scheduleOverviewRows.length} Skripte`}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setInspectorTab('health')}
            className={`px-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              inspectorTab === 'health'
                ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Prüfung</span>
            </div>
            <span
              className={`text-[10px] font-mono tabular-nums ${
                healthErrorCount > 0
                  ? 'text-rose-400'
                  : healthWarningCount > 0
                  ? 'text-amber-300'
                  : 'text-emerald-400'
              }`}
            >
              {!shouldComputeHealth
                ? '…'
                : healthFindings.length > 0
                ? `${healthFindings.length} Befunde`
                : '0 Fehler'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setInspectorTab('registry')}
            className={`px-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              inspectorTab === 'registry'
                ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Register</span>
            </div>
            <span className="text-[10px] font-mono tabular-nums text-slate-400">
              {!shouldComputeRegistry ? '…' : `${totalRegistryCount} Einträge`}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setInspectorTab('matrix')}
            className={`px-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
              inspectorTab === 'matrix'
                ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <div className="flex items-center gap-1">
              <Grid className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Matrix</span>
            </div>
            <span className="text-[10px] font-mono tabular-nums text-slate-400">
              {!shouldComputeMatrix ? '…' : `${routingMatrixRows.length} Regeln`}
            </span>
          </button>
        </div>
      )}

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain touch-pan-y p-4 space-y-4">
        {/* Shared hidden directory input for assigning a script folder (.s auto-discovery) */}
        {onAssignFolderAndAutoResolve && (
          <input
            ref={(el) => {
              folderAssignInputRef.current = el;
              if (el) {
                el.setAttribute('webkitdirectory', '');
                el.setAttribute('directory', '');
              }
            }}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) {
                void onAssignFolderAndAutoResolve(Array.from(files));
              }
              e.target.value = '';
            }}
          />
        )}

        {/* Compact View-Level Switcher when modules exist */}
        {scriptWorkspace.modules.length > 0 &&
          (workspaceMode === 'free' || guidedStep === 1) && (
            <section className="space-y-2.5 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>Multi-Skript &amp; Ebenen</span>
            </div>
            <span
              className={`text-[11px] font-mono tabular-nums whitespace-nowrap shrink-0 ${
                scriptWorkspace.modules.length > 0 && checklistMissingCount > 0
                  ? 'text-amber-300'
                  : 'text-slate-400'
              }`}
            >
              {scriptWorkspace.modules.length > 0
                ? checklistMissingCount > 0
                  ? `${scriptWorkspace.modules.length} lokal · ${checklistMissingCount} ausstehend`
                  : `${scriptWorkspace.modules.length} Skripte vollständig`
                : 'Einzel-Diagramm'}
            </span>
          </div>

          {scriptWorkspace.modules.length > 0 && (
            <div className="space-y-2">
              <select
                aria-label="Ansichtsebene oder Teil-Skript wählen"
                value={
                  viewLevel.level === 'master'
                    ? 'master'
                    : `detail:${viewLevel.scriptNumber}`
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'master') {
                    onSwitchViewLevel({ level: 'master' });
                  } else if (val.startsWith('detail:')) {
                    onSwitchViewLevel({
                      level: 'detail',
                      scriptNumber: val.slice('detail:'.length),
                    });
                  }
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-100 font-mono focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="master">
                  Ebene 1: Master-Gesamtkarte ({scriptWorkspace.modules.length} Skripte)
                </option>
                {scriptWorkspace.modules.map((mod) => {
                  const isMainMod =
                    canonicalScriptMatchKey(mod.scriptNumber) === 'main' ||
                    (mod.isMaster && /^(?:main|start|master(?:script)?)$/i.test(mod.scriptNumber));
                  return (
                    <option key={mod.scriptNumber} value={`detail:${mod.scriptNumber}`}>
                      Ebene 2: {isMainMod ? 'Main (Einstiegsskript)' : formatScriptDisplayLabel(mod)}{' '}
                      ({mod.rules.length} Regeln)
                    </option>
                  );
                })}
              </select>

              {viewLevel.level === 'detail' && (
                <button
                  type="button"
                  onClick={() => onSwitchViewLevel({ level: 'master' })}
                  className="w-full py-1.5 px-3 bg-indigo-950/60 hover:bg-indigo-900/60 border border-indigo-500/50 text-indigo-200 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Zurück zur Master-Gesamtkarte (Ebene 1)</span>
                </button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {onOpenNewCallflowModal && (
              <button
                type="button"
                onClick={onOpenNewCallflowModal}
                className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Neuer Callflow (Main)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenMultiScriptModal()}
              className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5 text-indigo-400" />
              <span>
                {scriptWorkspace.modules.length > 0
                  ? 'Skripte & Exporte verwalten'
                  : 'Skripte & Visio einlesen'}
              </span>
            </button>
          </div>
        </section>
          )}

        {/* GUIDED STEP 1: Masterscript (Main) direkt laden */}
        {workspaceMode === 'guided' && guidedStep === 1 && (
          <section className="space-y-3 bg-slate-950/80 border border-indigo-500/35 rounded-xl p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                  1
                </span>
                <span className="text-xs font-semibold text-slate-100 truncate">
                  Main (Einstiegsskript) laden
                </span>
              </div>
              {scriptWorkspace.modules.length > 0 && (
                <span className="text-[11px] font-mono text-emerald-400 shrink-0">
                  ✓ {mainScriptLabel} aktiv
                </span>
              )}
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed">
              Laden Sie hier Ihr <strong className="text-slate-100">erstes Startskript</strong> (Avaya `.s`-Export, AACC-Skript oder Tabellenzeilen). Es wird unabhängig vom Dateinamen fest als <strong className="text-slate-100">Main</strong> geführt; Ebene 1 zeigt danach die <strong className="text-slate-100">Master-Gesamtkarte</strong> aller verknüpften Skripte.
            </p>

            {onSubmitChecklistDetailScript && (
              <div className="space-y-2">
                <textarea
                  rows={5}
                  value={guidedMainDraft}
                  onChange={(e) => {
                    setGuidedMainDraft(e.target.value);
                    if (guidedMainFeedback) setGuidedMainFeedback(null);
                  }}
                  placeholder={`Main (Einstiegsskript) hier einfügen...\nBeispiel:\nSECTION Init\n  GIVE RAN 301\n  EXECUTE "Schaltung1"\n  TRANSFER TO 48210`}
                  className="w-full px-2.5 py-2 bg-slate-900 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 resize-y"
                />

                {guidedMainFeedback && (
                  <p className="text-[11px] text-rose-400">{guidedMainFeedback}</p>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!guidedMainDraft.trim()}
                    onClick={() => {
                      const updatedWs = onSubmitChecklistDetailScript(
                        '__auto__',
                        guidedMainDraft,
                        'legacy-text'
                      );
                      if (!updatedWs) {
                        setGuidedMainFeedback(
                          'Bitte ein gültiges Skript mit mindestens einer Regel, Queue oder Zielnummer einfügen.'
                        );
                        return;
                      }
                      setGuidedMainDraft('');
                      setGuidedMainFeedback(null);
                      setGuidedStep(2);
                    }}
                    className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Start-Skript einlesen &amp; weiter zu Schritt 2</span>
                  </button>

                  {onSubmitChecklistVisioFile && (
                    <>
                      <input
                        ref={guidedMainVisioInputRef}
                        type="file"
                        accept={CALLFLOW_CHECKLIST_ACCEPT}
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          setIsImportingGuidedMainVisio(true);
                          setGuidedMainFeedback(null);
                          try {
                            const updatedWs = await onSubmitChecklistVisioFile(
                              '__auto__',
                              file
                            );
                            if (!updatedWs) {
                              setGuidedMainFeedback(
                                'In dieser Datei wurden keine Skript-Befehle oder Visio-Formen erkannt.'
                              );
                            } else {
                              setGuidedStep(2);
                            }
                          } finally {
                            setIsImportingGuidedMainVisio(false);
                          }
                        }}
                      />
                      <button
                        type="button"
                        disabled={isImportingGuidedMainVisio}
                        onClick={() => guidedMainVisioInputRef.current?.click()}
                        title="Avaya .s-Datei oder Visio-Export (.vsdx, .vdx, .svg) laden"
                        className="py-2 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{isImportingGuidedMainVisio ? 'Lade...' : 'Datei (.s / Visio)'}</span>
                      </button>
                    </>
                  )}
                </div>

                {onAssignFolderAndAutoResolve && (
                  <div className="pt-2 border-t border-slate-800/80 space-y-2">
                    <button
                      type="button"
                      disabled={isAutoResolvingFolder}
                      onClick={() => folderAssignInputRef.current?.click()}
                      className="w-full py-2 px-3 bg-indigo-950/70 hover:bg-indigo-900/70 border border-indigo-500/50 text-indigo-100 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <FolderSearch className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                      <span>
                        {isAutoResolvingFolder
                          ? 'Gleiche Skript-Ordner ab...'
                          : assignedFolderPool
                          ? `Ordner „${assignedFolderPool.folderName}“ (${assignedFolderPool.totalFilesScanned} .s) wechseln`
                          : 'Skript-Ordner zuweisen (600+ .s automatisch abgleichen)'}
                      </span>
                    </button>

                    {assignedFolderPool && scriptWorkspace.modules.length === 0 && (
                      <div className="p-2.5 rounded-lg bg-slate-900 border border-indigo-500/40 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-semibold text-indigo-200 truncate">
                            Start-Skript aus Ordner „{assignedFolderPool.folderName}“ (
                            {assignedFolderPool.totalFilesScanned} Dateien) wählen:
                          </span>
                          {onClearAssignedFolder && (
                            <button
                              type="button"
                              onClick={onClearAssignedFolder}
                              className="text-[10px] text-slate-400 hover:text-slate-200 underline cursor-pointer shrink-0"
                            >
                              Trennen
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          value={folderStartSearch}
                          onChange={(e) => setFolderStartSearch(e.target.value)}
                          placeholder="Einstiegsskript im Ordner suchen (z. B. Main, 4910)..."
                          className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded text-[11px] font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none"
                        />
                        <div className="max-h-36 overflow-y-auto space-y-1 pr-0.5">
                          {assignedFolderPool.entries
                            .filter((e) => {
                              const q = folderStartSearch.trim().toLowerCase();
                              if (!q) return true;
                              return (
                                e.baseName.toLowerCase().includes(q) ||
                                e.filename.toLowerCase().includes(q)
                              );
                            })
                            .slice(0, 60)
                            .map((entry) => (
                              <button
                                key={entry.relativePath}
                                type="button"
                                disabled={isAutoResolvingFolder}
                                onClick={async () => {
                                  if (onSelectStartScriptFromAssignedFolder) {
                                    await onSelectStartScriptFromAssignedFolder(entry);
                                    setGuidedStep(2);
                                  }
                                }}
                                className="w-full px-2 py-1.5 rounded bg-slate-950 hover:bg-indigo-950/60 border border-slate-800 hover:border-indigo-500/50 text-left flex items-center justify-between gap-2 text-[11px] transition-colors cursor-pointer"
                              >
                                <span className="font-mono font-semibold text-slate-100 truncate">
                                  {entry.filename}
                                </span>
                                <span className="text-[10px] text-indigo-300 font-semibold shrink-0">
                                  Start + Kette laden →
                                </span>
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {scriptWorkspace.modules.length > 0 && (
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400">
                  {masterChecklist.length} Referenzen in {mainScriptLabel} erkannt
                </span>
                <button
                  type="button"
                  onClick={() => setGuidedStep(2)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Weiter zu Schritt 2</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </section>
        )}

        {/* Finaler PC Drag-and-Drop Nachbearbeitungs-Modus in Schritt 3 (oder Freier Modus) */}
        {((workspaceMode === 'guided' && guidedStep === 3) ||
          (workspaceMode === 'free' && inspectorTab === 'matrix')) &&
          onToggleVisualEditMode && (
            <section
              className={`space-y-3 rounded-xl p-3.5 border transition-colors ${
                isVisualEditMode
                  ? 'bg-indigo-950/35 border-indigo-500/60'
                  : 'bg-slate-950/85 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Move className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="text-xs font-semibold text-slate-100 truncate">
                    Manuelles Editieren (Drag &amp; Drop am PC)
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                    isVisualEditMode
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}
                >
                  {isVisualEditMode ? 'Aktiv' : 'Bereit'}
                </span>
              </div>

              <p className="text-[11px] text-slate-300 leading-relaxed">
                Verschieben Sie Knoten frei per Maus, ziehen Sie neue Verbindungen vom rechten Knoten-Punkt, bearbeiten Sie Knoten-Texte per <strong className="text-slate-100">Doppelklick</strong> oder ziehen Sie neue Bausteine direkt ins Diagramm. Alle Änderungen werden in Datenmodell und Exporte übernommen.
              </p>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onToggleVisualEditMode(!isVisualEditMode)}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    isVisualEditMode
                      ? 'bg-amber-600 hover:bg-amber-500 text-white'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  <Move className="w-3.5 h-3.5" />
                  <span>
                    {isVisualEditMode
                      ? 'Drag-&-Drop-Modus beenden'
                      : 'Manuell bearbeiten (Drag & Drop starten)'}
                  </span>
                </button>

                {hasCustomNodeOffsets && onResetAllNodeOffsets && (
                  <button
                    type="button"
                    onClick={onResetAllNodeOffsets}
                    title="Alle manuell verschobenen Knoten-Positionen auf das automatische Layout zurücksetzen"
                    className="py-2 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Layout Reset</span>
                  </button>
                )}
              </div>

              {selectedNodeId && onOpenNodeEditor && (
                <button
                  type="button"
                  onClick={() => onOpenNodeEditor(selectedNodeId)}
                  className="w-full py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-indigo-500/40 text-indigo-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Ausgewählten Knoten jetzt bearbeiten (Text, Queue &amp; Ziele)</span>
                </button>
              )}

              {onAddBuildingBlock && (
                <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Baustein per Ziehen oder Klick ins Diagramm einfügen:
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        { id: 'script', label: '+ Unter-Skript' },
                        { id: 'announcement', label: '+ Ansage / RAN' },
                        { id: 'queue', label: '+ Skillset / Queue' },
                        { id: 'condition', label: '+ Zeit- / IF-Weiche' },
                        { id: 'dtmf', label: '+ DTMF-Menü' },
                        { id: 'external', label: '+ Externes Ziel' },
                      ] as Array<{ id: CallflowBuildingBlockType; label: string }>
                    ).map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-callflow-block', b.id);
                          e.dataTransfer.effectAllowed = 'copy';
                          if (!isVisualEditMode) {
                            onToggleVisualEditMode(true);
                          }
                        }}
                        onClick={() => {
                          if (!isVisualEditMode) {
                            onToggleVisualEditMode(true);
                          }
                          onAddBuildingBlock(b.id);
                        }}
                        className="py-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-indigo-950/60 border border-slate-800 hover:border-indigo-500/50 text-left text-[11px] font-medium text-slate-200 transition-colors cursor-grab active:cursor-grabbing truncate"
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

        {/* TAB 2 (Free Mode) or STEP 3 (Guided Mode): Automatische Logik- & Qualitätsprüfung */}
        {((workspaceMode === 'free' && inspectorTab === 'health') ||
          (workspaceMode === 'guided' && guidedStep === 3)) && (
          <section className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-100 truncate">
                  Automatische Logik-Prüfung
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                {healthFindings.length} {healthFindings.length === 1 ? 'Befund' : 'Befunde'}
              </span>
            </div>

            {scriptWorkspace.modules.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-2 leading-relaxed">
                Laden Sie zuerst ein Hauptskript (<span className="font-mono text-slate-200">Main</span>) oder mehrere Teil-Skripte, um die automatische Prüfung auf Schleifen, Sackgassen und verwaiste Skripte zu starten.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => setHealthFilter('all')}
                    className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium tabular-nums transition-colors cursor-pointer ${
                      healthFilter === 'all'
                        ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Alle ({healthFindings.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setHealthFilter('error')}
                    className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium tabular-nums transition-colors cursor-pointer ${
                      healthFilter === 'error'
                        ? 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Fehler ({healthErrorCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setHealthFilter('warning')}
                    className={`py-1.5 px-2 rounded-lg border text-[11px] font-medium tabular-nums transition-colors cursor-pointer ${
                      healthFilter === 'warning'
                        ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Warnungen ({healthWarningCount})
                  </button>
                </div>

                {filteredHealthFindings.length === 0 ? (
                  <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-500/30 flex items-center gap-2 text-xs text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>
                      Keine Endlosschleifen oder echten Sackgassen erkannt – Callflow-Logik ist konsistent.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-0.5">
                    {filteredHealthFindings.map((finding) => {
                      const isErr = finding.severity === 'error';
                      const isWarn = finding.severity === 'warning';
                      return (
                        <div
                          key={finding.id}
                          className={`p-3 rounded-lg border space-y-2 ${
                            isErr
                              ? 'bg-rose-950/20 border-rose-500/40'
                              : isWarn
                              ? 'bg-amber-950/20 border-amber-500/35'
                              : 'bg-slate-900/90 border-slate-800'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                                  isErr
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                    : isWarn
                                    ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                                    : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                }`}
                              >
                                {isErr ? 'Fehler' : isWarn ? 'Warnung' : 'Hinweis'}
                              </span>
                              <span className="text-xs font-semibold text-slate-100 leading-snug">
                                {finding.title}
                              </span>
                            </div>
                          </div>

                          <p className="text-[11px] text-slate-300 leading-relaxed">
                            {finding.description}
                          </p>

                          {finding.cyclePath && finding.cyclePath.length > 0 && (
                            <div className="px-2 py-1 rounded bg-slate-950/80 border border-slate-800 text-[11px] font-mono text-rose-300 overflow-x-auto">
                              Zyklus: {finding.cyclePath.join(' → ')}
                            </div>
                          )}

                          <div className="text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800/80 rounded px-2.5 py-1.5 leading-relaxed">
                            <span className="font-semibold text-slate-300">Empfehlung: </span>
                            {finding.recommendation}
                          </div>

                          <div className="flex items-center gap-1.5 pt-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                jumpToScriptInInspector(finding.scriptNumber, false, true)
                              }
                              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200 transition-colors cursor-pointer"
                            >
                              Im Canvas markieren
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                jumpToScriptInInspector(finding.scriptNumber, true, true)
                              }
                              className="px-2.5 py-1 rounded bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-[11px] font-medium text-indigo-200 transition-colors cursor-pointer"
                            >
                              Ebene 2 öffnen ([{finding.scriptNumber}])
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* TAB 3: Zentrales Ressourcen- & Variablen-Register (Free Mode or Guided Step 3) */}
        {((workspaceMode === 'free' && inspectorTab === 'registry') ||
          (workspaceMode === 'guided' && guidedStep === 3)) && (
          <section className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <BookOpen className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-100 truncate">
                  Ressourcen- &amp; Variablen-Register
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                {totalRegistryCount} Ressourcen
              </span>
            </div>

            {scriptWorkspace.modules.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-2 leading-relaxed">
                Noch keine Skripte geladen. Nach dem Import sehen Sie hier alle im Callflow verwendeten Skillsets, Ansagen (RAN/WAV), Systemvariablen (<span className="font-mono text-slate-200">Sys_*</span>) und Rufnummern-Verweise.
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={registrySearch}
                    onChange={(e) => setRegistrySearch(e.target.value)}
                    placeholder="Skillset, Ansage, Variable oder Nummer suchen..."
                    className="w-full pl-8 pr-7 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  {registrySearch && (
                    <button
                      type="button"
                      onClick={() => setRegistrySearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => setRegistrySubTab('skillsets')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                      registrySubTab === 'skillsets'
                        ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Skillsets ({resourceRegistry.skillsets.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegistrySubTab('announcements')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                      registrySubTab === 'announcements'
                        ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Ansagen / RAN ({resourceRegistry.announcements.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegistrySubTab('special')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                      registrySubTab === 'special'
                        ? 'bg-sky-600/20 border-sky-500/40 text-sky-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Sonderparameter ({(resourceRegistry.specialParameters || []).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegistrySubTab('variables')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                      registrySubTab === 'variables'
                        ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Variablen ({resourceRegistry.variables.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegistrySubTab('crossrefs')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                      registrySubTab === 'crossrefs'
                        ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Kreuzreferenz ({resourceRegistry.crossRefs.length})
                  </button>
                </div>

                {/* Sub-Tab 3a: Skillsets */}
                {registrySubTab === 'skillsets' && (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-0.5">
                    {resourceRegistry.skillsets
                      .filter(
                        (s) =>
                          !registrySearch.trim() ||
                          s.name.toLowerCase().includes(registrySearch.toLowerCase()) ||
                          s.usages.some((u) =>
                            u.scriptNumber.toLowerCase().includes(registrySearch.toLowerCase())
                          )
                      )
                      .map((sk) => (
                        <div
                          key={sk.name}
                          className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono font-semibold text-emerald-300 truncate">
                              {sk.name}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                                sk.role === 'primary'
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : sk.role === 'overflow'
                                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                  : 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                              }`}
                            >
                              {sk.role === 'primary'
                                ? 'Primär-Skillset'
                                : sk.role === 'overflow'
                                ? 'Überlauf'
                                : 'Queue-Regel'}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {sk.usages.map((u, idx) => (
                              <button
                                key={`${u.scriptNumber}-${idx}`}
                                type="button"
                                onClick={() => jumpToScriptInInspector(u.scriptNumber, true)}
                                className="px-2 py-0.5 rounded bg-slate-950 hover:bg-indigo-950/60 border border-slate-800 hover:border-indigo-500/40 text-[11px] font-mono text-slate-200 transition-colors cursor-pointer"
                              >
                                [{u.scriptNumber}]
                                {u.prio !== undefined ? ` Prio ${u.prio}` : ''}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    {resourceRegistry.skillsets.length === 0 && (
                      <div className="text-xs text-slate-500 py-2">
                        Keine Skillsets oder Warteschlangen erkannt.
                      </div>
                    )}
                  </div>
                )}

                {/* Sub-Tab 3b: Announcements / RAN */}
                {registrySubTab === 'announcements' && (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-0.5">
                    {resourceRegistry.announcements
                      .filter(
                        (a) =>
                          !registrySearch.trim() ||
                          a.idOrName.toLowerCase().includes(registrySearch.toLowerCase()) ||
                          a.usages.some((u) =>
                            u.scriptNumber.toLowerCase().includes(registrySearch.toLowerCase())
                          )
                      )
                      .map((ann) => (
                        <div
                          key={ann.idOrName}
                          className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono font-semibold text-amber-300 truncate">
                              {ann.idOrName}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">
                              {ann.usages.length}× genutzt
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {ann.usages.map((u, idx) => (
                              <button
                                key={`${u.scriptNumber}-${idx}`}
                                type="button"
                                onClick={() => jumpToScriptInInspector(u.scriptNumber, true)}
                                className="px-2 py-0.5 rounded bg-slate-950 hover:bg-indigo-950/60 border border-slate-800 hover:border-indigo-500/40 text-[11px] font-mono text-slate-200 transition-colors cursor-pointer"
                              >
                                [{u.scriptNumber}] {u.stepName || ''}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    {resourceRegistry.announcements.length === 0 && (
                      <div className="text-xs text-slate-500 py-2">
                        Keine Ansagen, RAN-Nummern oder Musik-IDs erkannt.
                      </div>
                    )}
                  </div>
                )}

                {/* Sub-Tab 3c: Sonderparameter (Sys_*) */}
                {registrySubTab === 'special' && (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-0.5">
                    {(resourceRegistry.specialParameters || [])
                      .filter(
                        (p) =>
                          !registrySearch.trim() ||
                          p.label.toLowerCase().includes(registrySearch.toLowerCase()) ||
                          p.key.toLowerCase().includes(registrySearch.toLowerCase()) ||
                          p.value.toLowerCase().includes(registrySearch.toLowerCase()) ||
                          (p.note && p.note.toLowerCase().includes(registrySearch.toLowerCase()))
                      )
                      .map((p) => (
                        <div
                          key={p.key}
                          className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-200">
                              {p.label}{' '}
                              <span className="font-mono text-[10px] text-slate-400 font-normal">
                                ({p.key})
                              </span>
                            </span>
                            <span className="font-mono text-xs font-semibold text-sky-300 tabular-nums">
                              {p.value}
                            </span>
                          </div>
                          {p.note && (
                            <p className="text-[11px] text-slate-400 leading-relaxed">
                              {p.note}
                            </p>
                          )}
                        </div>
                      ))}
                    {(!resourceRegistry.specialParameters || resourceRegistry.specialParameters.length === 0) && (
                      <div className="text-xs text-slate-500 py-2">
                        Keine konfigurierten Sonderparameter erkannt.
                      </div>
                    )}
                  </div>
                )}

                {/* Sub-Tab 3d: System Variables */}
                {registrySubTab === 'variables' && (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-0.5">
                    {resourceRegistry.variables
                      .filter(
                        (v) =>
                          !registrySearch.trim() ||
                          v.variableName.toLowerCase().includes(registrySearch.toLowerCase()) ||
                          v.valuesByScript.some(
                            (s) =>
                              s.value.toLowerCase().includes(registrySearch.toLowerCase()) ||
                              s.scriptNumber.toLowerCase().includes(registrySearch.toLowerCase())
                          )
                      )
                      .map((v) => (
                        <div
                          key={v.variableName}
                          className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5"
                        >
                          <div className="text-xs font-mono font-semibold text-indigo-300">
                            {v.variableName}
                          </div>
                          <div className="space-y-1">
                            {v.valuesByScript.map((entry, idx) => (
                              <div
                                key={`${entry.scriptNumber}-${idx}`}
                                className="flex items-center justify-between gap-2 text-[11px] bg-slate-950/80 px-2 py-1 rounded border border-slate-800/80"
                              >
                                <button
                                  type="button"
                                  onClick={() => jumpToScriptInInspector(entry.scriptNumber, true)}
                                  className="font-mono text-indigo-300 hover:underline shrink-0 cursor-pointer"
                                >
                                  [{entry.scriptNumber}]
                                </button>
                                <span className="font-mono text-slate-200 truncate">
                                  = {entry.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    {resourceRegistry.variables.length === 0 && (
                      <div className="text-xs text-slate-500 py-2">
                        Keine AACC ASSIGN-Variablen im Quelltext gefunden.
                      </div>
                    )}
                  </div>
                )}

                {/* Sub-Tab 3d: Cross-References (Wer ruft wen auf?) */}
                {registrySubTab === 'crossrefs' && (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-0.5">
                    {resourceRegistry.crossRefs
                      .filter(
                        (cr) =>
                          !registrySearch.trim() ||
                          cr.refKey.toLowerCase().includes(registrySearch.toLowerCase()) ||
                          cr.displayName.toLowerCase().includes(registrySearch.toLowerCase())
                      )
                      .map((cr) => (
                        <div
                          key={cr.refKey}
                          className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => jumpToScriptInInspector(cr.refKey, cr.status !== 'missing')}
                              className="text-left text-xs font-mono font-semibold text-slate-100 hover:text-indigo-300 truncate cursor-pointer"
                            >
                              [{cr.refKey}]{' '}
                              {canonicalScriptMatchKey(cr.displayName) !==
                              canonicalScriptMatchKey(cr.refKey)
                                ? cr.displayName
                                : ''}
                            </button>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                                cr.status === 'master'
                                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                  : cr.status === 'present'
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : cr.status === 'external'
                                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              }`}
                            >
                              {cr.status === 'master'
                                ? 'Einstieg (Main)'
                                : cr.status === 'present'
                                ? 'Geladen'
                                : cr.status === 'external'
                                ? 'Extern'
                                : 'Ausstehend'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 space-y-0.5">
                            <div>
                              <span className="text-slate-500">Aufgerufen von: </span>
                              {cr.callers.length > 0 ? (
                                <span className="font-mono text-slate-200">
                                  {cr.callers.join(', ')}
                                </span>
                              ) : (
                                <span className="text-slate-500">Eingang / Niemand</span>
                              )}
                            </div>
                            <div>
                              <span className="text-slate-500">Ruft auf: </span>
                              {cr.callees.length > 0 ? (
                                <span className="font-mono text-slate-200">
                                  {cr.callees.join(', ')}
                                </span>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* TAB 4: Exportierbare Routing-Matrix & Migrations-Dokumentation */}
        {((workspaceMode === 'free' && inspectorTab === 'matrix') ||
          (workspaceMode === 'guided' && guidedStep === 3)) && (
          <section className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Grid className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-100 truncate">
                  Routing-Matrix &amp; Migrations-Export
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                {routingMatrixRows.length} Regeln
              </span>
            </div>

            {scriptWorkspace.modules.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-2 leading-relaxed">
                Laden Sie zuerst Skripte in den Arbeitsbereich, um die Routing-Matrix als Excel-CSV oder vollständiges Migrations-Fachkonzept zu exportieren.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={handleDownloadCsvMatrix}
                    className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Routing-Matrix für Excel speichern (.csv)</span>
                  </button>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={handleDownloadMarkdownDoc}
                      className="py-1.5 px-2.5 bg-indigo-600/25 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-200 text-[11px] font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">Fachkonzept (.md)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyMarkdownDoc}
                      className="py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {copyReportFeedback ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate text-emerald-300">Kopiert!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">Bericht kopieren</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="relative pt-1">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={matrixSearch}
                    onChange={(e) => setMatrixSearch(e.target.value)}
                    placeholder="Matrix nach Skript, Queue, Ansage oder Ziel filtern..."
                    className="w-full pl-8 pr-7 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  {matrixSearch && (
                    <button
                      type="button"
                      onClick={() => setMatrixSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-0.5">
                  {filteredMatrixRows.map((row, idx) => (
                    <div
                      key={`${row.scriptNumber}-${row.prio}-${idx}`}
                      className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5 text-[11px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => jumpToScriptInInspector(row.scriptNumber, true)}
                          className="font-mono font-semibold text-indigo-300 hover:underline truncate cursor-pointer"
                        >
                          [{row.scriptNumber}] Prio {row.prio}: {row.stepName}
                        </button>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                            row.targetStatus === 'Ausstehende Referenz'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : row.targetStatus === 'Vollständig geladen'
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {row.targetStatus}
                        </span>
                      </div>

                      {row.conditionAndSchedule !== '—' && (
                        <div className="text-slate-300">
                          <span className="text-slate-500">Bedingung/Zeit: </span>
                          {row.conditionAndSchedule}
                        </div>
                      )}
                      {row.announcement !== '—' && (
                        <div className="text-amber-300 font-mono">
                          <span className="text-slate-500 font-sans">Ansage/RAN: </span>
                          {row.announcement}
                        </div>
                      )}
                      {row.queueTarget !== '—' && (
                        <div className="text-emerald-300 font-mono">
                          <span className="text-slate-500 font-sans">Queue/Skillset: </span>
                          {row.queueTarget}
                        </div>
                      )}
                      {row.targetsAndChoices !== '—' && (
                        <div className="text-indigo-200 font-mono">
                          <span className="text-slate-500 font-sans">Ziel/Auswahl: </span>
                          {row.targetsAndChoices}
                        </div>
                      )}
                    </div>
                  ))}
                  {filteredMatrixRows.length === 0 && (
                    <div className="text-xs text-slate-500 py-2">
                      Keine passenden Routing-Regeln gefunden.
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* TAB: Öffnungszeiten & Feiertags-Übersichtsliste (Free Mode Tab 'schedules' & Guided Step 3) */}
        {((workspaceMode === 'free' && inspectorTab === 'schedules') ||
          (workspaceMode === 'guided' && guidedStep === 3)) && (
          <section className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Clock className="w-4 h-4 text-sky-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-100 truncate">
                  Öffnungszeiten &amp; Feiertags-Übersicht
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                {scheduleWithHoursCount} mit Zeiten · {scheduleHolidayCount} Feiertag
              </span>
            </div>

            {scriptWorkspace.modules.length === 0 ? (
              <div className="text-[11px] text-slate-400 py-2 leading-relaxed">
                Laden Sie zuerst Skripte in den Arbeitsbereich. Alle im Skript erkannten oder
                manuell hinterlegten Öffnungszeiten (<span className="font-mono text-slate-200">Mo–Fr 08:00–17:00</span>)
                und Feiertags-Regeln erscheinen hier als zentrale Liste und können direkt bearbeitet werden.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadOpeningHoursCsv}
                    className="w-full py-2 px-3 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Öffnungszeiten-Liste für Excel speichern (.csv)</span>
                  </button>
                </div>

                {/* Filter-Leiste */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                  <button
                    type="button"
                    onClick={() => setScheduleFilter('all')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors tabular-nums whitespace-nowrap shrink-0 cursor-pointer ${
                      scheduleFilter === 'all'
                        ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Alle ({scheduleOverviewRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleFilter('with-hours')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors tabular-nums whitespace-nowrap shrink-0 cursor-pointer ${
                      scheduleFilter === 'with-hours'
                        ? 'bg-sky-600/20 border-sky-500/45 text-sky-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Mit Zeiten ({scheduleWithHoursCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleFilter('holiday')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors tabular-nums whitespace-nowrap shrink-0 cursor-pointer ${
                      scheduleFilter === 'holiday'
                        ? 'bg-amber-600/20 border-amber-500/45 text-amber-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Feiertag ({scheduleHolidayCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleFilter('without-hours')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-colors tabular-nums whitespace-nowrap shrink-0 cursor-pointer ${
                      scheduleFilter === 'without-hours'
                        ? 'bg-slate-800 border-slate-600 text-slate-100'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    24/7 ({scheduleWithoutHoursCount})
                  </button>
                </div>

                {/* Suche */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={scheduleSearch}
                    onChange={(e) => setScheduleSearch(e.target.value)}
                    placeholder="Skript, Öffnungszeiten (z.B. Mo-Fr) oder Feiertag suchen..."
                    className="w-full pl-8 pr-7 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  {scheduleSearch && (
                    <button
                      type="button"
                      onClick={() => setScheduleSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Liste der Skripte & Öffnungszeiten */}
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-0.5">
                  {filteredScheduleRows.map((row) => {
                    const nodeId = `S_${toMermaidNodeSuffix(row.scriptNumber)}`;
                    return (
                      <div
                        key={row.id}
                        className={`p-2.5 rounded-lg border space-y-1.5 text-[11px] ${
                          row.hasSchedule
                            ? 'bg-slate-900/95 border-sky-500/35'
                            : row.hasHoliday
                            ? 'bg-slate-900/95 border-amber-500/35'
                            : 'bg-slate-900/80 border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => jumpToScriptInInspector(row.scriptNumber, false, true)}
                            className="font-mono font-semibold text-slate-100 hover:text-sky-300 truncate cursor-pointer text-left"
                          >
                            [{row.scriptNumber}] {row.scriptName}
                          </button>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap shrink-0 ${
                              row.hasSchedule
                                ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40'
                                : row.hasHoliday
                                ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {row.hasSchedule
                              ? '🕒 Öffnungszeiten'
                              : row.hasHoliday
                              ? '📅 Feiertag'
                              : '24/7 / Keine Angabe'}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-slate-400">Öffnungszeiten:</span>
                          {(() => {
                            const match = row.openingHours.match(/^(.*?)\s*(\([A-Za-z0-9_.-]+\))$/);
                            if (match) {
                              return (
                                <span className="font-mono tabular-nums">
                                  <span className="text-sky-300 font-semibold">{match[1]}</span>
                                  <span className="text-slate-400 text-xs font-normal ml-1.5">{match[2]}</span>
                                </span>
                              );
                            }
                            return (
                              <span
                                className={`font-mono tabular-nums font-medium ${
                                  row.hasSchedule ? 'text-sky-300' : 'text-slate-400'
                                }`}
                              >
                                {row.openingHours}
                              </span>
                            );
                          })()}
                        </div>

                        {row.holidayAndSpecial !== '—' && (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-slate-400">Feiertag / Sonderzeit:</span>
                            <span className="font-mono text-amber-300">
                              {row.holidayAndSpecial}
                            </span>
                          </div>
                        )}

                        {row.closedOrOverflowAction !== '—' && (
                          <div className="text-slate-300 truncate">
                            <span className="text-slate-500">Aktion / Ziel: </span>
                            <span className="font-mono text-slate-200">
                              {row.closedOrOverflowAction}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-800/80">
                          <button
                            type="button"
                            onClick={() => jumpToScriptInInspector(row.scriptNumber, false, true)}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Im Diagramm zeigen
                          </button>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => jumpToScriptInInspector(row.scriptNumber, true, true)}
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[10px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Ebene 2
                            </button>
                            {onOpenNodeEditor && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (viewLevel.level !== 'master') {
                                    onSwitchViewLevel({ level: 'master' });
                                  }
                                  onOpenNodeEditor(nodeId);
                                }}
                                className="px-2.5 py-1 rounded bg-sky-600/25 hover:bg-sky-600/40 border border-sky-500/45 text-sky-200 text-[10px] font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>
                                  {row.hasSchedule ? 'Zeiten ändern' : 'Zeiten angeben'}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {filteredScheduleRows.length === 0 && (
                    <div className="text-xs text-slate-500 py-2">
                      Keine passenden Einträge in der Öffnungszeiten-Liste gefunden.
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {((workspaceMode === 'free' && inspectorTab === 'overview') ||
          (workspaceMode === 'guided' && guidedStep === 2)) && (
          <>
        {/* Section 1a: Main-Abgleich Top-Down Checkliste & Echtzeit-Sync-Karte */}
        <section className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <ListChecks className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-100 truncate">
                Main-Abgleich &amp; Checkliste
              </span>
            </div>
            {masterChecklist.length > 0 && (
              <span
                className={`text-[11px] font-mono font-semibold tabular-nums whitespace-nowrap shrink-0 ${
                  checklistMissingCount === 0 ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {checklistDoneCount} / {masterChecklist.length} abgeglichen
              </span>
            )}
          </div>

          {/* 1-Click Folder Assignment & Automatic Recursive .s Script Discovery */}
          {onAssignFolderAndAutoResolve && (
            <div className="p-2.5 rounded-lg bg-slate-900/90 border border-indigo-500/40 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-indigo-200 flex items-center gap-1.5">
                    <FolderSearch className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="truncate">
                      {assignedFolderPool
                        ? `Ordner „${assignedFolderPool.folderName}“ (${assignedFolderPool.totalFilesScanned} Dateien)`
                        : 'Automatische Ordnersuche (Scriptname.s)'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
                    Gleicht den Ordner automatisch mit allen in Main (Einstiegsskript) &amp; Folgeskripten
                    aufgerufenen Zielen ab und lädt nur aktive <code className="font-mono text-slate-300">.s</code>-Dateien rekursiv nach (Altlasten werden ignoriert).
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={isAutoResolvingFolder}
                  onClick={() => folderAssignInputRef.current?.click()}
                  className="flex-1 py-1.5 px-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FolderSearch className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isAutoResolvingFolder
                      ? 'Suche & lade verknüpfte .s-Skripte...'
                      : assignedFolderPool
                      ? 'Anderen Skript-Ordner wählen & abgleichen'
                      : 'Skript-Ordner zuweisen & .s automatisch laden'}
                  </span>
                </button>
              </div>

              {lastFolderResolveSummary && (
                <div className="px-2.5 py-1.5 rounded bg-emerald-950/35 border border-emerald-500/35 text-[10px] font-mono tabular-nums text-emerald-200 space-y-0.5">
                  <div>
                    ✓ <strong>{lastFolderResolveSummary.loadedScriptNumbers.length}</strong> aktive Folgeskripte (.s) automatisch entlang der Kette geladen
                  </div>
                  <div className="text-slate-400">
                    {lastFolderResolveSummary.skippedLegacyFilesCount} von{' '}
                    {lastFolderResolveSummary.totalPoolFiles} Dateien im Ordner als ungenutzte Altlast übersprungen
                  </div>
                </div>
              )}
            </div>
          )}

          {scriptWorkspace.modules.length === 0 ? (
            <div className="text-[11px] text-slate-400 leading-relaxed space-y-2.5">
              <p>
                Starten Sie über <span className="text-slate-200 font-medium">Neuer Callflow</span>{' '}
                mit <span className="font-mono text-slate-200">Main</span> (Text oder grafischer
                Export) – alle Folgeskripte wie{' '}
                <span className="font-mono text-slate-200">Schaltung1</span> oder Nummern werden
                dann einzeln angefordert.
              </p>
            </div>
          ) : (
            <>
              {scriptWorkspace.modules.length > 1 && onSelectMasterScript && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400 shrink-0">Einstieg:</span>
                  <select
                    aria-label="Aktives Einstiegsskript (Main) für Checkliste wählen"
                    value={scriptWorkspace.masterScriptNumber || ''}
                    onChange={(e) => {
                      setActiveChecklistRef(null);
                      setChecklistDraftText('');
                      setChecklistFeedback(null);
                      onSelectMasterScript(e.target.value);
                    }}
                    className="flex-1 min-w-0 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-[11px] font-mono text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    {scriptWorkspace.modules.map((m) => (
                      <option key={m.scriptNumber} value={m.scriptNumber}>
                        {canonicalScriptMatchKey(m.scriptNumber) === 'main'
                          ? 'Main (Einstiegsskript)'
                          : formatScriptDisplayLabel(m)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {masterChecklist.length === 0 ? (
                <div className="text-[11px] text-slate-400 py-1 leading-relaxed">
                  Im Hauptskript wurden noch keine Ziel-Skripte (z. B.{' '}
                  <span className="font-mono text-slate-200">Schaltung1</span> oder Zielnummern)
                  erkannt.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Echtzeit-Abgleichs-Statusleiste (Main-Referenzen vs. lokale Skript-Module) */}
                  <div
                    role="status"
                    aria-live="polite"
                    className={`rounded-lg border p-2.5 space-y-2 transition-colors ${
                      checklistMissingCount > 0
                        ? 'bg-rose-950/20 border-rose-500/35'
                        : 'bg-emerald-950/20 border-emerald-500/35'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {checklistMissingCount > 0 ? (
                          <RefreshCw className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                        <span
                          className={`text-[11px] font-semibold truncate ${
                            checklistMissingCount > 0 ? 'text-amber-200' : 'text-emerald-300'
                          }`}
                        >
                          {checklistMissingCount > 0
                            ? `${checklistMissingCount} ${
                                checklistMissingCount === 1
                                  ? 'Ausstehende Referenz'
                                  : 'Ausstehende Referenzen'
                              }`
                            : 'Alle Referenzen lokal geladen'}
                        </span>
                      </div>
                      <span
                        className={`text-[11px] font-mono font-semibold tabular-nums whitespace-nowrap shrink-0 ${
                          checklistMissingCount > 0 ? 'text-rose-300' : 'text-emerald-400'
                        }`}
                      >
                        {syncPercent}%
                      </span>
                    </div>

                    {/* Mehrteiliger Abgleichs-Fortschrittsbalken: Smaragd = Vorhanden, Grau = Extern, Rose = Ausstehend */}
                    <div
                      className="h-1.5 w-full rounded-sm bg-slate-800 overflow-hidden flex"
                      title={`${checklistPresentCount} lokal geladen, ${checklistExternalCount} extern bestätigt, ${checklistMissingCount} ausstehend`}
                    >
                      {checklistPresentCount > 0 && (
                        <div
                          className="h-full bg-emerald-500 transition-all duration-300"
                          style={{
                            width: `${(checklistPresentCount / masterChecklist.length) * 100}%`,
                          }}
                        />
                      )}
                      {checklistExternalCount > 0 && (
                        <div
                          className="h-full bg-slate-500 transition-all duration-300"
                          style={{
                            width: `${(checklistExternalCount / masterChecklist.length) * 100}%`,
                          }}
                        />
                      )}
                      {checklistMissingCount > 0 && (
                        <div
                          className="h-full bg-rose-500/75 transition-all duration-300"
                          style={{
                            width: `${(checklistMissingCount / masterChecklist.length) * 100}%`,
                          }}
                        />
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] font-mono tabular-nums">
                      <span className="text-emerald-400">
                        {checklistPresentCount} lokal geladen
                        {checklistExternalCount > 0 && (
                          <span className="text-slate-400"> · {checklistExternalCount} extern</span>
                        )}
                      </span>
                      {checklistMissingCount > 0 ? (
                        <span className="text-rose-300">
                          {directMainMissingCount > 0
                            ? `Direkt aus ${mainScriptLabel}: ${directMainMissingCount} ausstehend`
                            : ''}
                          {directMainMissingCount > 0 && nestedMissingCount > 0 ? ' · ' : ''}
                          {nestedMissingCount > 0
                            ? `Unter-Skripte: ${nestedMissingCount} ausstehend`
                            : ''}
                        </span>
                      ) : (
                        <span className="text-emerald-400/90">
                          Alle Referenzen aus {mainScriptLabel} vorhanden
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Guided Top-Down Active Step Card */}
                  {activeChecklistItem && (
                    <div
                      className={`p-2.5 rounded-lg border space-y-2.5 ${
                        activeChecklistItem.status === 'missing'
                          ? 'bg-slate-900 border-rose-500/40'
                          : 'bg-slate-900 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-mono tabular-nums text-slate-400 truncate">
                            Schritt {String(activeChecklistItem.orderIndex).padStart(2, '0')} von{' '}
                            {String(masterChecklist.length).padStart(2, '0')} ·{' '}
                            {activeChecklistItem.contextLabel}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {activeChecklistItem.status === 'missing' ? (
                              <AlertCircle
                                className="w-3.5 h-3.5 text-rose-400 shrink-0 motion-safe:animate-pulse"
                                aria-hidden="true"
                              />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            )}
                            <span className="text-xs font-mono font-semibold text-slate-100 truncate">
                              {activeChecklistItem.refKey}
                            </span>
                            {canonicalScriptMatchKey(activeChecklistItem.displayName) !==
                              canonicalScriptMatchKey(activeChecklistItem.refKey) && (
                              <span className="text-[11px] text-slate-400 truncate">
                                · {activeChecklistItem.displayName}
                              </span>
                            )}
                          </div>
                          {activeChecklistItem.triggeredNumbers &&
                            activeChecklistItem.triggeredNumbers.length > 0 && (
                              <div className="text-[10px] font-mono tabular-nums text-indigo-300 mt-1 break-words">
                                {activeChecklistItem.isFaxRoute ? 'Fax-CDN (4-stellig): ' : 'Rufnummern (VALUE): '}
                                {activeChecklistItem.triggeredNumbers.join(', ')}
                              </div>
                            )}
                          {activeChecklistItem.status === 'missing' && (
                            <div className="text-[10px] font-mono text-rose-300 mt-0.5 truncate">
                              Ausstehende Referenz ·{' '}
                              {(activeChecklistItem.depth || 1) === 1 ? 'Direkt aus ' : 'Aufgerufen in '}
                              {activeChecklistItem.parentScriptNumber || mainScriptLabel}, lokal
                              fehlend
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={activeChecklistItem.orderIndex <= 1}
                            onClick={() => {
                              const prev = masterChecklist[activeChecklistItem.orderIndex - 2];
                              if (prev) {
                                setActiveChecklistRef(prev.refKey);
                                setChecklistFeedback(null);
                                setIsEditingCompletedItem(false);
                              }
                            }}
                            title="Vorheriger Schritt"
                            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-30 rounded transition-colors cursor-pointer"
                          >
                            <ArrowLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={activeChecklistItem.orderIndex >= masterChecklist.length}
                            onClick={() => {
                              const next = masterChecklist[activeChecklistItem.orderIndex];
                              if (next) {
                                setActiveChecklistRef(next.refKey);
                                setChecklistFeedback(null);
                                setIsEditingCompletedItem(false);
                              }
                            }}
                            title="Nächster Schritt nach unten"
                            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-30 rounded transition-colors cursor-pointer"
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {(activeChecklistItem.status === 'missing' || isEditingCompletedItem) &&
                      onSubmitChecklistDetailScript ? (
                        <div className="space-y-2 pt-2 border-t border-slate-800">
                          <textarea
                            rows={4}
                            value={checklistDraftText}
                            onChange={(e) => {
                              setChecklistDraftText(e.target.value);
                              if (checklistFeedback) setChecklistFeedback(null);
                            }}
                            placeholder={`Text-Skript für „${activeChecklistItem.refKey}“ hier einfügen (oder unten grafischen Export wählen)...`}
                            className="w-full px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 resize-y"
                          />

                          {checklistFeedback && (
                            <p className="text-[11px] text-rose-400">{checklistFeedback}</p>
                          )}

                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              disabled={!checklistDraftText.trim()}
                              onClick={() => {
                                const updatedWs = onSubmitChecklistDetailScript(
                                  activeChecklistItem.refKey,
                                  checklistDraftText,
                                  'legacy-text'
                                );
                                if (!updatedWs) {
                                  setChecklistFeedback(
                                    'Bitte mindestens eine Regel, Queue, Ansage oder Zielnummer angeben.'
                                  );
                                  return;
                                }
                                advanceToNextMissingChecklistItem(
                                  activeChecklistItem.refKey,
                                  updatedWs.masterChecklist
                                );
                              }}
                              className="flex-1 py-1.5 px-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Übernehmen &amp; Nächstes</span>
                            </button>

                            {onSubmitChecklistVisioFile && (
                              <>
                                <input
                                  ref={checklistVisioInputRef}
                                  type="file"
                                  accept={CALLFLOW_CHECKLIST_ACCEPT}
                                  className="hidden"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = '';
                                    if (!file || !activeChecklistItem) return;
                                    setIsImportingChecklistVisio(true);
                                    setChecklistFeedback(null);
                                    try {
                                      const updatedWs = await onSubmitChecklistVisioFile(
                                        activeChecklistItem.refKey,
                                        file
                                      );
                                      if (!updatedWs) {
                                        setChecklistFeedback(
                                          'In dieser Datei wurden keine Skript-Befehle oder Visio-Formen erkannt.'
                                        );
                                      } else {
                                        advanceToNextMissingChecklistItem(
                                          activeChecklistItem.refKey,
                                          updatedWs.masterChecklist
                                        );
                                      }
                                    } finally {
                                      setIsImportingChecklistVisio(false);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={isImportingChecklistVisio}
                                  onClick={() => checklistVisioInputRef.current?.click()}
                                  title="Avaya .s-Datei, Textskript oder Visio-Export (.vsdx, .vdx, .svg) direkt diesem Skript zuordnen"
                                  className="py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-medium rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <Upload className="w-3 h-3 text-emerald-400" />
                                  <span>
                                    {isImportingChecklistVisio ? 'Lade...' : 'Datei (.s / Visio)'}
                                  </span>
                                </button>
                              </>
                            )}
                          </div>

                          {activeChecklistItem.status === 'missing' && onResolveIssue && (
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  const syntheticIssue: CallflowOpenIssue = {
                                    id: `missing:${canonicalScriptMatchKey(activeChecklistItem.refKey)}`,
                                    type: 'missing-script',
                                    status: 'open',
                                    sourceScriptNumber: activeChecklistItem.callerScriptNumber,
                                    targetNumber: activeChecklistItem.refKey,
                                    title: `Fehlendes Skript [${activeChecklistItem.refKey}]`,
                                    question: '',
                                    createdAt: Date.now(),
                                  };
                                  const updatedWs = onResolveIssue(syntheticIssue, {
                                    resolution: 'external-endpoint',
                                    note: 'Über Checkliste als Extern / Ende bestätigt',
                                  });
                                  advanceToNextMissingChecklistItem(
                                    activeChecklistItem.refKey,
                                    updatedWs ? updatedWs.masterChecklist : masterChecklist
                                  );
                                }}
                                className="text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2 cursor-pointer"
                              >
                                Als externes Ende abhaken
                              </button>
                              {isEditingCompletedItem && (
                                <button
                                  type="button"
                                  onClick={() => setIsEditingCompletedItem(false)}
                                  className="text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                                >
                                  Fertig
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-slate-800">
                          <span className="text-[11px] text-emerald-400">
                            {activeChecklistItem.status === 'external'
                              ? '■ Als externes Ende markiert'
                              : '✓ Detail-Skript ist eingefügt'}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {activeChecklistItem.matchedModuleNumber && (
                              <button
                                type="button"
                                onClick={() =>
                                  onSwitchViewLevel({
                                    level: 'detail',
                                    scriptNumber: activeChecklistItem.matchedModuleNumber!,
                                  })
                                }
                                className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Ebene 2 öffnen
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setIsEditingCompletedItem(true)}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Ergänzen
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Aktiver Diagramm-Filter-Hinweis beim Klick auf Orga, Fax oder Ziel-Script */}
                  {diagramNodeChecklistScope && (
                    <div className="px-2.5 py-2 rounded-lg bg-indigo-950/50 border border-indigo-500/45 flex items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-indigo-300 font-semibold">
                          Diagramm-Filter aktiv
                        </div>
                        <div className="text-slate-100 font-medium truncate">
                          {diagramNodeChecklistScope.label} ({diagramScopedChecklist.length} /{' '}
                          {masterChecklist.length})
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectNodeId(null)}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Alle zeigen
                      </button>
                    </div>
                  )}

                  {/* Interaktive Checklisten-Filterleiste (Alle / Ausstehend / Geladen) */}
                  <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setChecklistFilter('all')}
                      className={`py-1 px-1.5 text-[11px] font-medium rounded-md transition-colors tabular-nums whitespace-nowrap shrink-0 cursor-pointer ${
                        checklistFilter === 'all'
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Alle ({masterChecklist.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setChecklistFilter('todo');
                        const firstDirectMainMissing = masterChecklist.find(
                          (it) => it.status === 'missing' && (it.depth || 1) === 1
                        );
                        const firstMissing =
                          firstDirectMainMissing ||
                          masterChecklist.find((it) => it.status === 'missing');
                        if (
                          firstMissing &&
                          activeChecklistItem &&
                          activeChecklistItem.status !== 'missing'
                        ) {
                          setActiveChecklistRef(firstMissing.refKey);
                          setChecklistFeedback(null);
                          setIsEditingCompletedItem(false);
                        }
                      }}
                      className={`py-1 px-1.5 text-[11px] font-medium rounded-md transition-colors tabular-nums whitespace-nowrap shrink-0 cursor-pointer ${
                        checklistFilter === 'todo'
                          ? 'bg-rose-600 text-white'
                          : checklistMissingCount > 0
                          ? 'text-rose-300 hover:text-rose-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Ausstehend ({checklistMissingCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setChecklistFilter('synced')}
                      className={`py-1 px-1.5 text-[11px] font-medium rounded-md transition-colors tabular-nums whitespace-nowrap shrink-0 cursor-pointer ${
                        checklistFilter === 'synced'
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Geladen ({checklistDoneCount})
                    </button>
                  </div>

                  {/* Vollständige Abgleichs-Checkliste (Main-Referenzen zuerst) */}
                  <div className="space-y-1 max-h-60 overflow-y-auto pr-0.5">
                    {filteredChecklistItems.length === 0 ? (
                      <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/50 text-center space-y-1.5">
                        <p className="text-[11px] text-slate-300">
                          {checklistFilter === 'todo'
                            ? `Alle aus „${mainScriptLabel}“ referenzierten Skripte sind lokal geladen.`
                            : 'Noch keine geladenen Skripte in dieser Ansicht.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => setChecklistFilter('all')}
                          className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200 underline underline-offset-2 cursor-pointer"
                        >
                          Alle {masterChecklist.length} Einträge anzeigen
                        </button>
                      </div>
                    ) : (
                      filteredChecklistItems.map((item) => {
                        const isActive =
                          activeChecklistItem &&
                          canonicalScriptMatchKey(activeChecklistItem.refKey) ===
                            canonicalScriptMatchKey(item.refKey);
                        const depth = item.depth || 1;
                        const isMissingFromMain = item.status === 'missing' && depth === 1;
                        const isMissingNested = item.status === 'missing' && depth > 1;

                        const statusLabel =
                          item.status === 'missing'
                            ? 'Ausstehende Referenz'
                            : item.status === 'external'
                            ? 'Extern'
                            : 'Vorhanden';

                        const statusColor =
                          item.status === 'missing'
                            ? isMissingFromMain
                              ? 'text-rose-300'
                              : 'text-amber-300'
                            : item.status === 'external'
                            ? 'text-slate-400'
                            : 'text-emerald-400';

                        const rowTone = isActive
                          ? 'bg-indigo-950/60 border-indigo-400/80'
                          : isMissingFromMain
                          ? 'bg-rose-950/20 border-rose-500/45 hover:bg-rose-950/35 hover:border-rose-400/70'
                          : isMissingNested
                          ? 'bg-amber-950/15 border-amber-500/40 hover:bg-amber-950/30 hover:border-amber-400/60'
                          : 'bg-slate-900/70 border-slate-800 hover:bg-slate-900';

                        const indentPadding =
                          depth >= 3 ? 'pl-7' : depth === 2 ? 'pl-5' : 'px-2.5';

                        const originLine =
                          depth === 1
                            ? `Direkt aus ${item.parentScriptNumber || mainScriptLabel} · ${item.contextLabel}`
                            : `Unter-Skript ${item.parentScriptNumber || ''} · ${item.contextLabel.replace(
                                /^aus \[[^\]]+\]\s*·\s*/i,
                                ''
                              )}`;

                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setActiveChecklistRef(item.refKey);
                              setChecklistFeedback(null);
                              setIsEditingCompletedItem(false);
                              const nodeId = `S_${toMermaidNodeSuffix(item.refKey)}`;
                              if (graph.nodes.has(nodeId)) {
                                onSelectNodeId(nodeId);
                                if (!isMobileView) {
                                  onFocusNodeOnCanvas?.(nodeId);
                                }
                              }
                            }}
                            className={`w-full text-left pr-2.5 py-2 rounded-lg border transition-colors flex items-center justify-between gap-2 cursor-pointer ${indentPadding} ${rowTone}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[11px] font-mono tabular-nums text-slate-500 w-5 shrink-0">
                                {String(item.orderIndex).padStart(2, '0')}.
                              </span>
                              {item.status === 'missing' ? (
                                <AlertCircle
                                  className={`w-3.5 h-3.5 shrink-0 motion-safe:animate-pulse ${
                                    isMissingFromMain ? 'text-rose-400' : 'text-amber-300'
                                  }`}
                                  aria-hidden="true"
                                />
                              ) : (
                                <CheckCircle2
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    item.status === 'external'
                                      ? 'text-slate-500'
                                      : 'text-emerald-400'
                                  }`}
                                  aria-hidden="true"
                                />
                              )}
                              <div className="min-w-0">
                                <div className="text-xs font-mono text-slate-100 truncate">
                                  {item.refKey}
                                </div>
                                <div
                                  className={`text-[10px] truncate ${
                                    item.status === 'missing' ? 'text-slate-300' : 'text-slate-400'
                                  }`}
                                >
                                  {originLine}
                                </div>
                              </div>
                            </div>

                            <span
                              className={`text-[10px] font-mono font-medium whitespace-nowrap shrink-0 ${statusColor}`}
                            >
                              {statusLabel}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {ignoredTargets.length > 0 && onUnignoreChecklistTarget && (
                <div className="pt-2.5 border-t border-slate-800/80 space-y-1.5">
                  <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
                    <span>Ignorierte Ziele ({ignoredTargets.length})</span>
                    <span className="text-[10px] text-slate-500">Bei Bedarf wieder anfordern</span>
                  </div>
                  <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
                    {ignoredTargets.map((targetRef) => (
                      <div
                        key={targetRef}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-900/50 border border-slate-800/80 flex items-center justify-between gap-2"
                      >
                        <span className="text-[11px] font-mono text-slate-300 truncate">
                          {targetRef}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onUnignoreChecklistTarget(targetRef);
                            setActiveChecklistRef(targetRef);
                            setChecklistFeedback(null);
                            setIsEditingCompletedItem(false);
                          }}
                          className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          + Reaktivieren
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {workspaceMode === 'guided' && (
                <div className="pt-3 border-t border-slate-800/90 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setGuidedStep(1)}
                    className="py-1.5 px-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ← 1. Main anpassen
                  </button>
                  <button
                    type="button"
                    onClick={() => setGuidedStep(3)}
                    className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <span>Weiter zu Schritt 3: Prüfen &amp; Export</span>
                    <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Section 1b: Guided Checklist for Open Points & Questions ("Rote Kugel") */}
        {scriptWorkspace.modules.length > 0 && (
          <section className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {openIssues.length > 0 ? (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                )}
                <span className="text-xs font-semibold text-slate-100 truncate">
                  Offene Punkte &amp; Klärung
                </span>
              </div>
              <span
                className={`text-[11px] font-mono font-semibold tabular-nums whitespace-nowrap shrink-0 ${
                  openIssues.length > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {openIssues.length > 0
                  ? `${openIssues.length} Offen`
                  : 'Karte vollständig'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg flex-1">
                <button
                  type="button"
                  onClick={() => setIssueFilterTab('open')}
                  className={`py-1 px-2 text-[11px] font-medium rounded-md transition-colors tabular-nums whitespace-nowrap shrink-0 cursor-pointer ${
                    issueFilterTab === 'open'
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Offen ({openIssues.length})
                </button>
                <button
                  type="button"
                  onClick={() => setIssueFilterTab('resolved')}
                  className={`py-1 px-2 text-[11px] font-medium rounded-md transition-colors tabular-nums whitespace-nowrap shrink-0 cursor-pointer ${
                    issueFilterTab === 'resolved'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Geklärt ({resolvedIssues.length})
                </button>
              </div>

              {onAddManualQuestion && (
                <button
                  type="button"
                  onClick={() => {
                    const fallbackNum =
                      extractScriptNumberFromNodeId(selectedNodeId, scriptWorkspace.modules) ||
                      scriptWorkspace.masterScriptNumber ||
                      scriptWorkspace.modules[0]?.scriptNumber ||
                      'Main';
                    setNewQuestionScript(fallbackNum);
                    setIsAddingQuestion((prev) => !prev);
                  }}
                  title="Eigene offene Frage / rote Kugel hinzufügen"
                  className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-medium rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <MessageSquarePlus className="w-3 h-3 text-rose-400" />
                  <span>+ Frage</span>
                </button>
              )}
            </div>

            {isAddingQuestion && onAddManualQuestion && (
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={newQuestionScript}
                    onChange={(e) => setNewQuestionScript(e.target.value)}
                    className="px-2 py-1 bg-slate-950 border border-slate-800 rounded text-[11px] font-mono text-slate-200 focus:outline-none focus:border-indigo-500 max-w-[140px]"
                  >
                    {scriptWorkspace.modules.map((m) => (
                      <option key={m.scriptNumber} value={m.scriptNumber}>
                        {canonicalScriptMatchKey(m.scriptNumber) === 'main'
                          ? 'Main'
                          : formatScriptDisplayLabel(m)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newQuestionText}
                    onChange={(e) => setNewQuestionText(e.target.value)}
                    placeholder="Offene Frage eingeben..."
                    className="flex-1 min-w-0 px-2 py-1 bg-slate-950 border border-slate-800 rounded text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsAddingQuestion(false)}
                    className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    disabled={!newQuestionText.trim()}
                    onClick={() => {
                      onAddManualQuestion(
                        newQuestionScript ||
                          scriptWorkspace.masterScriptNumber ||
                          scriptWorkspace.modules[0]?.scriptNumber ||
                          'Main',
                        newQuestionText.trim()
                      );
                      setNewQuestionText('');
                      setIsAddingQuestion(false);
                      setIssueFilterTab('open');
                    }}
                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-[11px] font-medium rounded transition-colors cursor-pointer"
                  >
                    Als offen markieren
                  </button>
                </div>
              </div>
            )}

            {issueFilterTab === 'open' ? (
              openIssues.length === 0 ? (
                <div className="text-xs text-emerald-300/90 py-1.5 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Alle Skripte, Visio-Flows und Übergänge sind geklärt.</span>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                  {openIssues.map((issue) => {
                    const focusTargetId = issue.targetNumber
                      ? `S_${toMermaidNodeSuffix(issue.targetNumber)}`
                      : `S_${toMermaidNodeSuffix(issue.sourceScriptNumber)}`;
                    const linkDraft = linkDraftByIssueId[issue.id] || '';
                    const noteDraft = noteDraftByIssueId[issue.id] || '';
                    const typeTag =
                      issue.type === 'missing-script'
                        ? 'Fehlendes Skript'
                        : issue.type === 'unclear-transition'
                        ? 'Unklarer Übergang'
                        : 'Rückfrage';

                    return (
                      <div
                        key={issue.id}
                        className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const fallbackId = `S_${toMermaidNodeSuffix(issue.sourceScriptNumber)}`;
                            const nodeToSelect = graph.nodes.has(focusTargetId)
                              ? focusTargetId
                              : graph.nodes.has(fallbackId)
                              ? fallbackId
                              : null;
                            if (nodeToSelect) {
                              onSelectNodeId(nodeToSelect);
                              if (!isMobileView) {
                                onFocusNodeOnCanvas?.(nodeToSelect);
                              }
                            }
                          }}
                          className="w-full text-left flex items-start justify-between gap-2 cursor-pointer group"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                              <span className="text-xs font-semibold text-slate-100 group-hover:text-white truncate">
                                {issue.title}
                              </span>
                            </div>
                            <div className="text-[10px] font-mono text-rose-400 mt-0.5">
                              {typeTag} · Knoten [{issue.sourceScriptNumber}]
                            </div>
                          </div>
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                        </button>

                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          {issue.question}
                        </p>

                        {/* Direct Resolution Controls */}
                        {onResolveIssue && (
                          <div className="space-y-1.5 pt-1 border-t border-slate-800">
                            {issue.type === 'missing-script' && (
                              <>
                                <div className="flex flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (issue.targetNumber) {
                                        setActiveChecklistRef(issue.targetNumber);
                                      }
                                      onOpenMultiScriptModal(issue.targetNumber);
                                    }}
                                    className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded transition-colors cursor-pointer"
                                  >
                                    Skript / Visio nachreichen
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onResolveIssue(issue, {
                                        resolution: 'external-endpoint',
                                        note: 'Als externes Ende / Ziel bestätigt',
                                      })
                                    }
                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium rounded transition-colors cursor-pointer"
                                  >
                                    Externes Ende
                                  </button>
                                </div>
                                {scriptWorkspace.modules.length > 0 && (
                                  <div className="flex items-center gap-1.5">
                                    <select
                                      value={linkDraft}
                                      onChange={(e) =>
                                        setLinkDraftByIssueId((prev) => ({
                                          ...prev,
                                          [issue.id]: e.target.value,
                                        }))
                                      }
                                      className="flex-1 min-w-0 px-2 py-1 bg-slate-950 border border-slate-800 rounded text-[11px] font-mono text-slate-200"
                                    >
                                      <option value="">Mit Ziel verknüpfen...</option>
                                      {scriptWorkspace.modules.map((m) => (
                                        <option key={m.scriptNumber} value={m.scriptNumber}>
                                          [{m.scriptNumber}] {m.scriptName}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      disabled={!linkDraft}
                                      onClick={() =>
                                        onResolveIssue(issue, {
                                          resolution: 'linked-target',
                                          linkedTargetNumber: linkDraft,
                                          linkLabel: 'Verknüpft',
                                        })
                                      }
                                      className="px-2 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-[11px] font-medium rounded cursor-pointer"
                                    >
                                      Verknüpfen
                                    </button>
                                  </div>
                                )}
                              </>
                            )}

                            {issue.type === 'unclear-transition' && (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={linkDraft}
                                    onChange={(e) =>
                                      setLinkDraftByIssueId((prev) => ({
                                        ...prev,
                                        [issue.id]: e.target.value.trimStart(),
                                      }))
                                    }
                                    placeholder="Ziel-Nr. / Name"
                                    className="w-32 px-2 py-1 bg-slate-950 border border-slate-800 rounded text-[11px] font-mono text-slate-200"
                                  />
                                  <button
                                    type="button"
                                    disabled={linkDraft.trim().length < 3}
                                    onClick={() =>
                                      onResolveIssue(issue, {
                                        resolution: 'linked-target',
                                        linkedTargetNumber: linkDraft.trim(),
                                        linkLabel: 'Ziel geklärt',
                                      })
                                    }
                                    className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-medium rounded cursor-pointer"
                                  >
                                    Ziel setzen
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onResolveIssue(issue, {
                                        resolution: 'external-endpoint',
                                        note: 'Kein weiterer Übergang (Ende)',
                                      })
                                    }
                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium rounded cursor-pointer"
                                  >
                                    Ende
                                  </button>
                                </div>
                              </div>
                            )}

                            {issue.type === 'manual-question' && (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={noteDraft}
                                  onChange={(e) =>
                                    setNoteDraftByIssueId((prev) => ({
                                      ...prev,
                                      [issue.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Antwort / Lösung notieren..."
                                  className="flex-1 min-w-0 px-2 py-1 bg-slate-950 border border-slate-800 rounded text-[11px] text-slate-200"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    onResolveIssue(issue, {
                                      resolution: 'answered',
                                      note: noteDraft.trim() || 'Geklärt',
                                    })
                                  }
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium rounded cursor-pointer"
                                >
                                  Geklärt
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ) : resolvedIssues.length === 0 ? (
              <div className="text-xs text-slate-500 py-1">
                Noch keine geklärten Punkte vorhanden.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                {resolvedIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="p-2 rounded-lg bg-slate-900/70 border border-slate-800 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-emerald-300 truncate">
                        ✓ {issue.title}
                      </div>
                      {issue.resolutionNote && (
                        <div className="text-[11px] text-slate-400 truncate">
                          {issue.resolutionNote}
                        </div>
                      )}
                    </div>
                    {onReopenIssue && (
                      <button
                        type="button"
                        onClick={() => onReopenIssue(issue)}
                        className="text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Öffnen
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Section 2: Unified Layout-Profil (Dagre vs ELK cleanly separated) */}
        {workspaceMode === 'free' && (
          <>
        <section className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span>Layout-Profil &amp; Abstände</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono tabular-nums">
              {graph.nodes.size} Knoten · {graph.edges.length} Pfade
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => handleLayoutEngineChange('dagre')}
              className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                themeConfig.layoutEngine === 'dagre'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Manuell (Dagre)
            </button>
            <button
              type="button"
              onClick={() => handleLayoutEngineChange('elk')}
              className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                themeConfig.layoutEngine === 'elk'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Auto (ELK)
            </button>
          </div>

          {themeConfig.layoutEngine === 'dagre' ? (
            <div className="space-y-3">
              {/* Quick Density Presets */}
              <div className="grid grid-cols-3 gap-1">
                {[
                  { label: 'Kompakt', node: 40, rank: 50 },
                  { label: 'Standard', node: 60, rank: 75 },
                  { label: 'Weitläufig', node: 115, rank: 140 },
                ].map((preset) => {
                  const isActive =
                    Math.abs(themeConfig.nodeSpacing - preset.node) <= 5 &&
                    Math.abs(themeConfig.rankSpacing - preset.rank) <= 5;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => handleApplyDensityPreset(preset.node, preset.rank)}
                      className={`py-1 px-2 text-[11px] font-medium rounded-md border transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-indigo-950/70 border-indigo-500/60 text-indigo-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {/* Active Spacing Sliders (only rendered in Dagre mode) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Knoten-Abstand</span>
                    <span className="font-mono text-indigo-300 tabular-nums">
                      {themeConfig.nodeSpacing}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={260}
                    step={5}
                    value={themeConfig.nodeSpacing}
                    onChange={(e) => handleSpacingChange('nodeSpacing', Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Ebenen-Abstand</span>
                    <span className="font-mono text-indigo-300 tabular-nums">
                      {themeConfig.rankSpacing}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={320}
                    step={5}
                    value={themeConfig.rankSpacing}
                    onChange={(e) => handleSpacingChange('rankSpacing', Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-300 bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-2.5 space-y-2 leading-relaxed">
              <p>
                <strong>Auto-Entflechtung (ELK)</strong> optimiert Abstände und minimiert
                Linien-Kreuzungen automatisch (ideal für dichte Netze).
              </p>
              <button
                type="button"
                onClick={() => handleLayoutEngineChange('dagre')}
                className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 cursor-pointer"
              >
                Für manuelle Abstands-Regler zu Dagre wechseln
              </button>
            </div>
          )}
        </section>

        {/* Section 3: Interactive Node Picker & Search */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">
              Skript / Knoten im Callflow wählen
            </span>
            <span className="text-[11px] text-slate-400">oder im Diagramm antippen</span>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Skriptname, Nummer oder Knoten..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <select
            value={selectedNodeId || ''}
            onChange={(e) => {
              const val = e.target.value || null;
              onSelectNodeId(val);
              if (!val) {
                onToggleIsolateSubgraphMode(false);
              } else if (onFocusNodeOnCanvas) {
                onFocusNodeOnCanvas(val);
              }
            }}
            className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
          >
            <option value="">-- Alle Knoten anzeigen ({graph.nodes.size}) --</option>
            {allNodesList.map((n) => (
              <option key={n.id} value={n.id}>
                {n.role === 'entry'
                  ? '▶ [START] '
                  : n.role === 'terminal'
                  ? '■ [ENDE] '
                  : n.role === 'hub'
                  ? '◆ [VERTEILER] '
                  : '• '}
                {n.label} ({n.inDegree} ein / {n.outDegree} aus)
              </option>
            ))}
          </select>
        </section>
          </>
        )}

        {/* Section 4: Detailed Callflow Path Trace */}
        {traceResult ? (
          <section className="space-y-3 pt-2 border-t border-slate-800/80">
            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/50 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-amber-300">
                  Aktiver Fokus-Knoten
                </span>
                <span className="text-[11px] font-mono text-amber-200/80 tabular-nums">
                  {traceResult.activeNodeIds.size} Knoten im Gesamtpfad
                </span>
              </div>
              <div className="text-sm font-mono font-bold text-slate-100 break-all">
                {traceResult.selectedNode.label}
              </div>

              {/* Drilldown CTA when selected node points to a loaded 4-digit script */}
              {selectedNodeScriptTarget && (
                <button
                  type="button"
                  onClick={() =>
                    onSwitchViewLevel({
                      level: 'detail',
                      scriptNumber: selectedNodeScriptTarget.scriptNumber,
                    })
                  }
                  className="w-full py-1.5 px-3 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>
                    {canonicalScriptMatchKey(selectedNodeScriptTarget.scriptNumber) === 'main'
                      ? 'In Main (Einstiegsskript) hineinzoomen (Ebene 2)'
                      : `In Skript [${selectedNodeScriptTarget.scriptNumber}] hineinzoomen (Ebene 2)`}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Richtungs-Filter */}
              <div className="space-y-1">
                <span className="text-[11px] text-amber-200/80 block">Richtungs-Filter</span>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950/90 rounded-lg border border-slate-800">
                  {[
                    { id: 'both' as const, label: 'Ganzer Pfad' },
                    { id: 'upstream' as const, label: 'Nur Woher' },
                    { id: 'downstream' as const, label: 'Nur Wohin' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onChangeDirectionFilter(item.id)}
                      className={`py-1 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        directionFilter === item.id
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pfad-Tiefe (Hop-Depth Filter) */}
              <div className="space-y-1">
                <span className="text-[11px] text-amber-200/80 block">
                  Pfad-Tiefe ab Fokus-Knoten
                </span>
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950/90 rounded-lg border border-slate-800">
                  {[
                    { id: 1 as const, label: '1 Schritt' },
                    { id: 2 as const, label: '2 Ebenen' },
                    { id: 'all' as const, label: 'Alle Ebenen' },
                  ].map((item) => (
                    <button
                      key={String(item.id)}
                      type="button"
                      onClick={() => onChangeHopDepth(item.id)}
                      className={`py-1 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        hopDepth === item.id
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onToggleIsolateSubgraphMode(!isolateSubgraphMode)}
                  className={`flex-1 py-1.5 px-2.5 text-xs font-medium rounded-lg border transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    isolateSubgraphMode
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>
                    {isolateSubgraphMode ? 'Isoliert aktiv' : 'Pfad isolieren'}
                  </span>
                </button>

                {onFocusNodeOnCanvas && (
                  <button
                    type="button"
                    onClick={() => onFocusNodeOnCanvas(traceResult.selectedNode.id)}
                    title="Kamera im Diagramm direkt auf diesen Knoten zentrieren"
                    className="py-1.5 px-2.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Fokus 1:1
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onSelectNodeId(null);
                    onToggleIsolateSubgraphMode(false);
                  }}
                  title="Auswahl aufheben"
                  className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Sonderparameter des aktiven Knotens */}
              {(() => {
                const targetScriptNum =
                  selectedNodeScriptTarget?.scriptNumber ||
                  extractScriptNumberFromNodeId(traceResult.selectedNode.id, scriptWorkspace.modules) ||
                  (viewLevel.level === 'detail' ? viewLevel.scriptNumber : undefined);
                if (!targetScriptNum) return null;
                const targetMod = scriptWorkspace.modules.find(
                  (m) =>
                    canonicalScriptMatchKey(m.scriptNumber) ===
                    canonicalScriptMatchKey(targetScriptNum)
                );
                if (!targetMod) return null;
                const params = extractScriptSpecialParameters(targetMod, scriptWorkspace);
                if (!params.length) return null;

                return (
                  <div className="pt-2.5 border-t border-amber-500/30 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-amber-300">⚙️ Sonderparameter</span>
                      <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                        {params.length} aktiv
                      </span>
                    </div>
                    <div className="space-y-1 max-h-[190px] overflow-y-auto pr-0.5">
                      {params.map((p) => (
                        <div
                          key={p.key}
                          className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px]"
                        >
                          <div className="min-w-0 flex-1 truncate">
                            <span className="font-medium text-slate-200">{p.label}</span>
                            <span className="text-[10px] text-slate-400 font-mono ml-1">
                              ({p.key})
                            </span>
                          </div>
                          <span className="font-mono font-semibold text-sky-300 shrink-0 tabular-nums">
                            {p.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {directionFilter !== 'downstream' && (
              <TraceListBlock
                title="1. Ursprungs-Startpunkte (Entry)"
                subtitle={hopDepth === 'all' ? 'Kompletter Pfad' : `bis ${hopDepth} Ebenen`}
                accentColor="text-sky-400"
                borderColor="border-sky-500/40"
                items={filteredEntryPoints}
                onSelectNode={(id) => {
                  onSelectNodeId(id);
                  onFocusNodeOnCanvas?.(id);
                }}
                emptyText={
                  hopDepth === 'all'
                    ? 'Dieser Knoten ist selbst ein Startpunkt.'
                    : 'Kein Startpunkt innerhalb der gewählten Tiefen-Stufe.'
                }
              />
            )}

            {directionFilter !== 'downstream' && (
              <TraceListBlock
                title="2. Direkte Aufrufer (Woher?)"
                subtitle="-1 Schritt"
                accentColor="text-indigo-400"
                borderColor="border-indigo-500/40"
                items={traceResult.directCallers.map((c) => ({
                  node: c.node,
                  badge: c.edgeLabel || 'ruft auf →',
                }))}
                onSelectNode={(id) => {
                  onSelectNodeId(id);
                  onFocusNodeOnCanvas?.(id);
                }}
                emptyText="Keine eingehenden Aufrufe."
              />
            )}

            {directionFilter !== 'upstream' && (
              <TraceListBlock
                title="3. Direkte Folgeschritte (Wohin?)"
                subtitle="+1 Schritt"
                accentColor="text-emerald-400"
                borderColor="border-emerald-500/40"
                items={traceResult.directCallees.map((c) => ({
                  node: c.node,
                  badge: c.edgeLabel || '→ Folgeaufruf',
                }))}
                onSelectNode={(id) => {
                  onSelectNodeId(id);
                  onFocusNodeOnCanvas?.(id);
                }}
                emptyText="Keine ausgehenden Aufrufe."
              />
            )}

            {directionFilter !== 'upstream' && (
              <TraceListBlock
                title="4. Endpunkte (Wo endet es?)"
                subtitle={hopDepth === 'all' ? 'Kompletter Pfad' : `bis ${hopDepth} Ebenen`}
                accentColor="text-rose-400"
                borderColor="border-rose-500/40"
                items={filteredTerminalPoints}
                onSelectNode={(id) => {
                  onSelectNodeId(id);
                  onFocusNodeOnCanvas?.(id);
                }}
                emptyText={
                  hopDepth === 'all'
                    ? 'Keine Endpunkte ermittelt.'
                    : 'Kein Endpunkt innerhalb der gewählten Tiefen-Stufe.'
                }
              />
            )}

            {/* 5. Cycles / Loops */}
            {traceResult.cycleEdges.length > 0 && (
              <div className="p-3 rounded-xl bg-rose-950/25 border border-rose-500/45 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-rose-300 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>5. Erkannte Rücksprünge / Zyklen ({traceResult.cycleEdges.length})</span>
                  </span>
                </div>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
                  {traceResult.cycleEdges.map((cycle, idx) => (
                    <button
                      key={`${cycle.from}-${cycle.to}-${idx}`}
                      type="button"
                      onClick={() => {
                        onSelectNodeId(cycle.to);
                        onFocusNodeOnCanvas?.(cycle.to);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-rose-500/30 hover:border-rose-400 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="text-xs font-mono text-rose-200 truncate">
                        ↻ {cycle.fromLabel} → {cycle.toLabel}
                      </span>
                      <span className="text-[11px] font-mono text-rose-300 whitespace-nowrap shrink-0">
                        {cycle.label || 'Rücksprung'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : workspaceMode === 'free' ? (
          <section className="space-y-3 pt-2 border-t border-slate-800/80">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300 leading-relaxed">
              <strong className="text-slate-100 block mb-1">
                Interaktive Pfad-Verfolgung bereit:
              </strong>
              Klicken Sie im Diagramm auf ein Skript, um <strong>Ursprung</strong>,{' '}
              <strong>Ebenen-Tiefe</strong> und <strong>Rücksprünge/Zyklen</strong> sichtbar zu
              machen.
            </div>

            <TraceListBlock
              title={`Erkannte Startpunkte (${graph.entryNodes.length})`}
              subtitle="Ohne vorherigen Aufrufer"
              accentColor="text-sky-400"
              borderColor="border-slate-800"
              items={graph.entryNodes.map((n) => ({
                node: n,
                badge: `${n.outDegree} Ausgänge`,
              }))}
              onSelectNode={(id) => {
                onSelectNodeId(id);
                onFocusNodeOnCanvas?.(id);
              }}
              emptyText="Keine isolierten Startknoten erkannt."
            />

            <TraceListBlock
              title={`Zentrale Verteiler / Hubs (${graph.hubNodes.length})`}
              subtitle="Viele Verzweigungen"
              accentColor="text-amber-400"
              borderColor="border-slate-800"
              items={graph.hubNodes.map((n) => ({
                node: n,
                badge: `${n.inDegree} ein · ${n.outDegree} aus`,
              }))}
              onSelectNode={(id) => {
                onSelectNodeId(id);
                onFocusNodeOnCanvas?.(id);
              }}
              emptyText="Keine mehrfachen Verteilerknoten erkannt."
            />

            <TraceListBlock
              title={`Erkannte Endpunkte (${graph.terminalNodes.length})`}
              subtitle="Ende der Kette"
              accentColor="text-rose-400"
              borderColor="border-slate-800"
              items={graph.terminalNodes.map((n) => ({
                node: n,
                badge: `${n.inDegree} Eingänge`,
              }))}
              onSelectNode={(id) => {
                onSelectNodeId(id);
                onFocusNodeOnCanvas?.(id);
              }}
              emptyText="Keine isolierten Endpunkte erkannt."
            />
          </section>
        ) : null}
          </>
        )}
      </div>

      {/* Footer Action */}
      <div className="p-3.5 border-t border-slate-800 bg-slate-900/90 lg:bg-slate-950/60 shrink-0">
        <button
          type="button"
          disabled={isExportingHtml}
          onClick={onExportInteractiveHtml}
          className="w-full min-h-[40px] lg:min-h-0 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
        >
          <Download className="w-3.5 h-3.5" />
          <span>
            {isExportingHtml
              ? 'Interaktive HTML wird erstellt…'
              : 'Interaktive Callflow-HTML speichern (.html)'}
          </span>
        </button>
      </div>
    </aside>
  );
};

export const CallflowInspector = React.memo(CallflowInspectorInner);
CallflowInspector.displayName = 'CallflowInspector';

interface TraceListBlockProps {
  title: string;
  subtitle: string;
  accentColor: string;
  borderColor: string;
  items: Array<{ node: CallflowNode; badge: string }>;
  onSelectNode: (id: string) => void;
  emptyText: string;
}

const TraceListBlock: React.FC<TraceListBlockProps> = ({
  title,
  subtitle,
  accentColor,
  borderColor,
  items,
  onSelectNode,
  emptyText,
}) => {
  return (
    <div className={`p-3 rounded-xl bg-slate-950/80 border ${borderColor} space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold ${accentColor}`}>{title}</span>
        <span className="text-[11px] text-slate-500">{subtitle}</span>
      </div>

      {items.length === 0 ? (
        <div className="text-xs text-slate-500 py-1">{emptyText}</div>
      ) : (
        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
          {items.map(({ node, badge }) => (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node.id)}
              className="w-full text-left px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 transition-colors flex items-center justify-between gap-2 group cursor-pointer"
            >
              <span className="text-xs font-mono text-slate-200 group-hover:text-white truncate">
                {node.label}
              </span>
              <span className="text-[11px] text-slate-400 group-hover:text-indigo-300 flex items-center gap-1 whitespace-nowrap shrink-0 tabular-nums">
                <span>{badge}</span>
                <ArrowRight className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
