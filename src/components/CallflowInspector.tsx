import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Filter,
  FolderPlus,
  GitBranch,
  Layers,
  ListChecks,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sliders,
  Upload,
  X,
} from 'lucide-react';
import {
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
  canonicalScriptMatchKey,
  extractScriptNumberFromNodeId,
  toMermaidNodeSuffix,
} from '../utils/scriptCallflowParser';

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
  onClose: () => void;
  isMobileView?: boolean;
}

export const CallflowInspector: React.FC<CallflowInspectorProps> = ({
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
  onClose,
  isMobileView = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [issueFilterTab, setIssueFilterTab] = useState<'open' | 'resolved'>('open');
  const [isAddingQuestion, setIsAddingQuestion] = useState(false);
  const [newQuestionScript, setNewQuestionScript] = useState('');
  const [newQuestionText, setNewQuestionText] = useState('');
  const [linkDraftByIssueId, setLinkDraftByIssueId] = useState<Record<string, string>>({});
  const [noteDraftByIssueId, setNoteDraftByIssueId] = useState<Record<string, string>>({});

  // Top-Down Masterscript Checklist Wizard & Sync Map state
  const [activeChecklistRef, setActiveChecklistRef] = useState<string | null>(null);
  const [checklistFilter, setChecklistFilter] = useState<'all' | 'todo' | 'synced'>('all');
  const [checklistDraftText, setChecklistDraftText] = useState('');
  const [checklistFeedback, setChecklistFeedback] = useState<string | null>(null);
  const [isEditingCompletedItem, setIsEditingCompletedItem] = useState(false);
  const [isImportingChecklistVisio, setIsImportingChecklistVisio] = useState(false);
  const checklistVisioInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusChecklistTrigger?.refKey) {
      setActiveChecklistRef(focusChecklistTrigger.refKey);
      setChecklistFilter('all');
      setChecklistFeedback(null);
      setIsEditingCompletedItem(false);
    }
  }, [focusChecklistTrigger]);

  useEffect(() => {
    setChecklistFilter('all');
  }, [scriptWorkspace.masterScriptNumber]);

  const masterChecklist = scriptWorkspace.masterChecklist || [];
  const ignoredTargets = scriptWorkspace.ignoredChecklistTargets || [];
  const mainScriptLabel =
    scriptWorkspace.masterScriptNumber ||
    scriptWorkspace.modules[0]?.scriptNumber ||
    'Main';

  const {
    checklistMissingCount,
    checklistPresentCount,
    checklistExternalCount,
    checklistDoneCount,
    directMainMissingCount,
    nestedMissingCount,
    syncPercent,
  } = useMemo(() => {
    let missing = 0;
    let present = 0;
    let external = 0;
    let directMainMissing = 0;

    masterChecklist.forEach((item) => {
      if (item.status === 'missing') {
        missing += 1;
        if ((item.depth || 1) === 1) {
          directMainMissing += 1;
        }
      } else if (item.status === 'present') {
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
  }, [masterChecklist]);

  const filteredChecklistItems = useMemo(() => {
    if (checklistFilter === 'todo') {
      return masterChecklist.filter((item) => item.status === 'missing');
    }
    if (checklistFilter === 'synced') {
      return masterChecklist.filter((item) => item.status !== 'missing');
    }
    return masterChecklist;
  }, [masterChecklist, checklistFilter]);

  const activeChecklistItem = useMemo(() => {
    if (masterChecklist.length === 0) return null;
    if (activeChecklistRef) {
      const explicit = masterChecklist.find(
        (item) => canonicalScriptMatchKey(item.refKey) === canonicalScriptMatchKey(activeChecklistRef)
      );
      if (explicit) return explicit;
    }
    return masterChecklist.find((item) => item.status === 'missing') || masterChecklist[0];
  }, [masterChecklist, activeChecklistRef]);

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
            Callflow-Inspektor
          </h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
          {!isMobileView && (
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

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Section 1: Zwei-Ebenen Master & Teil-Skripte */}
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
                  ? `${scriptWorkspace.modules.length} lokal · ${checklistMissingCount} offen`
                  : `${scriptWorkspace.modules.length} Skripte synchron`
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
                  Ebene 1: Master-Übersicht ({scriptWorkspace.modules.length} Skripte)
                </option>
                {scriptWorkspace.modules.map((mod) => (
                  <option key={mod.scriptNumber} value={`detail:${mod.scriptNumber}`}>
                    Ebene 2: [{mod.scriptNumber}] {mod.scriptName} ({mod.rules.length} Regeln)
                  </option>
                ))}
              </select>

              {viewLevel.level === 'detail' && (
                <button
                  type="button"
                  onClick={() => onSwitchViewLevel({ level: 'master' })}
                  className="w-full py-1.5 px-3 bg-indigo-950/60 hover:bg-indigo-900/60 border border-indigo-500/50 text-indigo-200 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Zurück zur Master-Übersicht (Ebene 1)</span>
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

        {/* Section 1a: Masterscript Top-Down Checkliste & Echtzeit-Sync-Karte */}
        <section className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <ListChecks className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-100 truncate">
                Masterscript-Checkliste
              </span>
            </div>
            {masterChecklist.length > 0 && (
              <span
                className={`text-[11px] font-mono font-semibold tabular-nums whitespace-nowrap shrink-0 ${
                  checklistMissingCount === 0 ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {checklistDoneCount} / {masterChecklist.length} synchron
              </span>
            )}
          </div>

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
                  <span className="text-[11px] text-slate-400 shrink-0">Master:</span>
                  <select
                    aria-label="Aktives Masterscript für Checkliste wählen"
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
                        [{m.scriptNumber}] {m.scriptName}
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
                  {/* Real-Time Workspace Sync Status Strip (Referenced in Main vs. Local Modules) */}
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
                                checklistMissingCount === 1 ? 'Skript fehlt lokal' : 'Skripte fehlen lokal'
                              }`
                            : 'Workspace vollständig synchron'}
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

                    {/* Multi-Segment Sync Progress Bar: Emerald = Loaded, Slate = External, Rose = Missing To-Do */}
                    <div
                      className="h-1.5 w-full rounded-sm bg-slate-800 overflow-hidden flex"
                      title={`${checklistPresentCount} lokal geladen, ${checklistExternalCount} extern bestätigt, ${checklistMissingCount} fehlen lokal`}
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
                        {checklistPresentCount} geladen
                        {checklistExternalCount > 0 && (
                          <span className="text-slate-400"> · {checklistExternalCount} extern</span>
                        )}
                      </span>
                      {checklistMissingCount > 0 ? (
                        <span className="text-rose-300">
                          {directMainMissingCount > 0
                            ? `Aus ${mainScriptLabel}: ${directMainMissingCount} To-Do`
                            : ''}
                          {directMainMissingCount > 0 && nestedMissingCount > 0 ? ' · ' : ''}
                          {nestedMissingCount > 0
                            ? `Unter-Skripte: ${nestedMissingCount} To-Do`
                            : ''}
                        </span>
                      ) : (
                        <span className="text-emerald-400/90">
                          Alle Referenzen aus {mainScriptLabel} erfasst
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
                                className="w-3.5 h-3.5 text-rose-400 shrink-0"
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
                          {activeChecklistItem.status === 'missing' && (
                            <div className="text-[10px] font-mono text-rose-300 mt-0.5 truncate">
                              To-Do · Referenziert in{' '}
                              {activeChecklistItem.parentScriptNumber || mainScriptLabel}, fehlt im
                              Workspace
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
                                  accept=".vsdx,.vdx,.svg,.xml"
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
                                          'Keine Formen in dieser Visio-Datei erkannt.'
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
                                  title="Visio-Export (.vsdx, .vdx, .svg) direkt diesem Skript zuordnen"
                                  className="py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-medium rounded-md transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  <Upload className="w-3 h-3 text-emerald-400" />
                                  <span>
                                    {isImportingChecklistVisio ? 'Lade...' : 'Visio-Datei'}
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

                  {/* Interactive To-Do Map Filter (Alle / To-Do / Geladen) */}
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
                        const firstMissing = masterChecklist.find((it) => it.status === 'missing');
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
                      To-Do ({checklistMissingCount})
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

                  {/* Complete Ordered Top-Down Checklist / Real-Time To-Do Map */}
                  <div className="space-y-1 max-h-60 overflow-y-auto pr-0.5">
                    {filteredChecklistItems.length === 0 ? (
                      <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/50 text-center space-y-1.5">
                        <p className="text-[11px] text-slate-300">
                          {checklistFilter === 'todo'
                            ? `Alle aus „${mainScriptLabel}“ referenzierten Skripte sind lokal synchronisiert.`
                            : 'Noch keine synchronisierten Skripte in dieser Liste.'}
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
                            ? isMissingFromMain
                              ? 'To-Do · Fehlt'
                              : 'To-Do · Unter'
                            : item.status === 'external'
                            ? 'Extern'
                            : 'Synchron';

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
                            ? `Aus ${item.parentScriptNumber || mainScriptLabel} · ${item.contextLabel}`
                            : item.contextLabel;

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
                                  className={`w-3.5 h-3.5 shrink-0 ${
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
                              className={`text-[11px] font-mono font-medium whitespace-nowrap shrink-0 ${statusColor}`}
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
                        [{m.scriptNumber}] {m.scriptName}
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
                              onFocusNodeOnCanvas?.(nodeToSelect);
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
                    In Skript [{selectedNodeScriptTarget.scriptNumber}] hineinzoomen (Ebene 2)
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
        ) : (
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
        )}
      </div>

      {/* Footer Action */}
      <div className="p-3.5 border-t border-slate-800 bg-slate-900/90 lg:bg-slate-950/60 shrink-0">
        <button
          type="button"
          onClick={onExportInteractiveHtml}
          className="w-full min-h-[40px] lg:min-h-0 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Interaktive Callflow-HTML speichern (.html)</span>
        </button>
      </div>
    </aside>
  );
};

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
