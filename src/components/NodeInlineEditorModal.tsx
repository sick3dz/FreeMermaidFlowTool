import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Crosshair,
  Edit3,
  ExternalLink,
  FileCode,
  GitBranch,
  Hash,
  Layers,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sliders,
  Terminal,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { CallflowBuildingBlockType } from '../types/mermaidStudio';
import { CallflowGraph } from '../types/mermaidStudio';
import { buildDualAudienceNodeExplanation } from '../utils/nodeExplanationEngine';
import {
  EditableCallflowNodeSnapshot,
  EditableNodeConnectionItem,
  canonicalScriptMatchKey,
} from '../utils/scriptCallflowParser';

interface NodeInlineEditorModalProps {
  isOpen: boolean;
  snapshot: EditableCallflowNodeSnapshot | null;
  graph?: CallflowGraph;
  availableTargetRefs: Array<{ scriptNumber: string; scriptName: string }>;
  hasCustomPositionOffset: boolean;
  onClose: () => void;
  onSave: (
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
  ) => void;
  onResetPositionOffset: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onJumpToScript?: (scriptNumber: string) => void;
  onSelectGraphNode?: (nodeId: string) => void;
  onOpenOpeningHours?: (initialSearch?: string) => void;
  canGoBack?: boolean;
  previousNodeTitle?: string;
  onGoBack?: () => void;
  onNavigateNeighborInPopup?: (refOrId: string, label?: string) => boolean;
}

const BLOCK_TYPE_OPTIONS: Array<{
  id: CallflowBuildingBlockType;
  label: string;
  hint: string;
}> = [
  { id: 'script', label: 'Skript / Modul', hint: 'Unter-Skript oder Rufnummer' },
  { id: 'announcement', label: 'Ansage / RAN', hint: 'Audio-Ansage oder Wartemusik' },
  { id: 'queue', label: 'Skillset / Queue', hint: 'Vermittlung an Warteschlange' },
  { id: 'condition', label: 'Zeit- / IF-Weiche', hint: 'Öffnungszeiten oder Bedingung' },
  { id: 'dtmf', label: 'DTMF-Menü', hint: 'Tastenauswahl (Taste 1, 2, ...)' },
  { id: 'external', label: 'Externes Ziel', hint: 'Externe Rufnummer / Abwurf' },
];

type ModalViewMode = 'layperson' | 'pro' | 'script' | 'edit';

function renderHighlightedScriptLine(lineText: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return lineText || ' ';
  const lower = lineText.toLowerCase();
  const qLower = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchIdx = lower.indexOf(qLower, cursor);
  let keyIdx = 0;
  while (matchIdx !== -1) {
    if (matchIdx > cursor) {
      parts.push(lineText.slice(cursor, matchIdx));
    }
    parts.push(
      <mark
        key={`m-${keyIdx++}`}
        className="bg-amber-400/35 text-amber-100 rounded-xs px-0.5"
      >
        {lineText.slice(matchIdx, matchIdx + q.length)}
      </mark>
    );
    cursor = matchIdx + q.length;
    matchIdx = lower.indexOf(qLower, cursor);
  }
  if (cursor < lineText.length) {
    parts.push(lineText.slice(cursor));
  }
  return parts.length > 0 ? parts : ' ';
}

export const NodeInlineEditorModal: React.FC<NodeInlineEditorModalProps> = ({
  isOpen,
  snapshot,
  graph,
  availableTargetRefs,
  hasCustomPositionOffset,
  onClose,
  onSave,
  onResetPositionOffset,
  onDeleteNode,
  onJumpToScript,
  onSelectGraphNode,
  onOpenOpeningHours,
  canGoBack = false,
  previousNodeTitle,
  onGoBack,
  onNavigateNeighborInPopup,
}) => {
  const [viewMode, setViewMode] = useState<ModalViewMode>('layperson');
  const [scriptNumber, setScriptNumber] = useState('');
  const [title, setTitle] = useState('');
  const [blockType, setBlockType] = useState<CallflowBuildingBlockType>('script');
  const [announcement, setAnnouncement] = useState('');
  const [queueTarget, setQueueTarget] = useState('');
  const [schedule, setSchedule] = useState('');
  const [condition, setCondition] = useState('');
  const [outgoingConnections, setOutgoingConnections] = useState<EditableNodeConnectionItem[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copiedFullScript, setCopiedFullScript] = useState(false);
  const [scriptSearchQuery, setScriptSearchQuery] = useState('');
  const [activeSearchMatchIdx, setActiveSearchMatchIdx] = useState(0);
  const highlightLineRef = useRef<HTMLDivElement | null>(null);
  const activeMatchLineRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef<boolean>(false);
  const bodyScrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (!wasOpenRef.current) {
      // Fresh open from canvas: always start in Layperson view first
      setViewMode('layperson');
      wasOpenRef.current = true;
    } else {
      // Switching to a neighbor while popup stays open: preserve Laie / IT-Profi / Original-Skript,
      // but exit Edit mode so users do not accidentally edit a different node.
      setViewMode((prev) => (prev === 'edit' ? 'pro' : prev));
    }
  }, [isOpen, snapshot?.nodeId]);

  useEffect(() => {
    if (!snapshot) return;
    setScriptNumber(snapshot.scriptNumber);
    setTitle(snapshot.title);
    setBlockType(snapshot.blockType);
    setAnnouncement(snapshot.announcement);
    setQueueTarget(snapshot.queueTarget);
    setSchedule(snapshot.schedule);
    setCondition(snapshot.condition);
    setOutgoingConnections(snapshot.outgoingConnections.map((c) => ({ ...c })));
    setConfirmDelete(false);
    setCopiedFullScript(false);
    setScriptSearchQuery('');
    setActiveSearchMatchIdx(0);
    if (bodyScrollContainerRef.current) {
      bodyScrollContainerRef.current.scrollTop = 0;
    }
  }, [snapshot]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const scriptLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    availableTargetRefs.forEach((ref) => {
      if (!ref.scriptNumber || !ref.scriptName) return;
      map[ref.scriptNumber] = ref.scriptName;
      map[ref.scriptNumber.toLowerCase()] = ref.scriptName;
      map[canonicalScriptMatchKey(ref.scriptNumber)] = ref.scriptName;
    });
    return map;
  }, [availableTargetRefs]);

  const explanation = useMemo(() => {
    if (!snapshot) return null;
    return buildDualAudienceNodeExplanation(snapshot, graph, scriptLabelMap);
  }, [snapshot, graph, scriptLabelMap]);

  const effectiveScriptText = useMemo(() => {
    if (!snapshot) return '';
    if (snapshot.fullScriptText && snapshot.fullScriptText.trim()) {
      return snapshot.fullScriptText.replace(/\r\n?/g, '\n');
    }
    if (snapshot.rawLineSnippet && snapshot.rawLineSnippet.trim()) {
      return snapshot.rawLineSnippet.replace(/\r\n?/g, '\n');
    }
    return '';
  }, [snapshot]);

  const scriptLines = useMemo(() => {
    if (!effectiveScriptText) return [] as string[];
    return effectiveScriptText.split('\n');
  }, [effectiveScriptText]);

  const effectiveHighlightStart =
    snapshot?.fullScriptText && snapshot.highlightStartLine ? snapshot.highlightStartLine : undefined;
  const effectiveHighlightEnd =
    effectiveHighlightStart !== undefined
      ? Math.max(effectiveHighlightStart, snapshot?.highlightEndLine ?? effectiveHighlightStart)
      : undefined;

  const scriptSearchMatches = useMemo(() => {
    const q = scriptSearchQuery.trim().toLowerCase();
    if (!q || scriptLines.length === 0) return [] as number[];
    const hits: number[] = [];
    for (let i = 0; i < scriptLines.length; i++) {
      if (scriptLines[i].toLowerCase().includes(q)) {
        hits.push(i + 1);
      }
    }
    return hits;
  }, [scriptLines, scriptSearchQuery]);

  const activeSearchMatchLine =
    scriptSearchMatches.length > 0
      ? scriptSearchMatches[
          ((activeSearchMatchIdx % scriptSearchMatches.length) + scriptSearchMatches.length) %
            scriptSearchMatches.length
        ]
      : undefined;

  useEffect(() => {
    if (!isOpen || viewMode !== 'script') return;
    const raf = window.requestAnimationFrame(() => {
      if (highlightLineRef.current) {
        highlightLineRef.current.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isOpen, viewMode, snapshot?.nodeId]);

  useEffect(() => {
    if (!isOpen || viewMode !== 'script' || activeSearchMatchLine === undefined) return;
    const raf = window.requestAnimationFrame(() => {
      if (activeMatchLineRef.current) {
        activeMatchLineRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isOpen, viewMode, activeSearchMatchLine, activeSearchMatchIdx]);

  if (!isOpen || !snapshot || !explanation) return null;

  const isStepMode = snapshot.mode === 'workspace-step';
  const isRawMermaid = snapshot.mode === 'raw-mermaid';
  const knownTargetKeySet = new Set(
    availableTargetRefs.map((ref) => canonicalScriptMatchKey(ref.scriptNumber))
  );
  const blockTypeLabel =
    BLOCK_TYPE_OPTIONS.find((opt) => opt.id === snapshot.blockType)?.label || 'Element';
  const rulesPreview = snapshot.moduleRulesPreview || [];
  const incomingList = snapshot.incomingConnections || [];
  const specialParams = snapshot.specialParameters || [];
  const findings = snapshot.relatedFindings || [];
  const dnisList = snapshot.entryDnisNumbers || [];
  const graphNode = graph?.nodes.get(snapshot.nodeId);

  const handleAddConnection = () => {
    const nextIdx = outgoingConnections.length + 1;
    setOutgoingConnections((prev) => [
      ...prev,
      {
        id: `new-conn-${Date.now()}-${nextIdx}`,
        toTargetNumber: '',
        label: blockType === 'dtmf' ? `Taste ${nextIdx}` : 'Wohin',
        kind: blockType === 'dtmf' ? 'choice' : 'rule-target',
      },
    ]);
  };

  const handleUpdateConnection = (
    idx: number,
    patch: Partial<EditableNodeConnectionItem>
  ) => {
    setOutgoingConnections((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    );
  };

  const handleRemoveConnection = (idx: number) => {
    setOutgoingConnections((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(snapshot, {
      scriptNumber: scriptNumber.trim() || snapshot.scriptNumber,
      title: title.trim() || snapshot.title,
      blockType,
      announcement,
      queueTarget,
      schedule,
      condition,
      outgoingConnections,
    });
    onClose();
  };

  const handleJump = (targetScriptNumber: string) => {
    if (!onJumpToScript) return;
    onJumpToScript(targetScriptNumber);
    onClose();
  };

  const handleNavigateNeighbor = (refOrId: string, label?: string) => {
    const cleanRef = (refOrId || '').trim();
    const cleanLabel = (label || '').trim();
    if (!cleanRef && !cleanLabel) return;
    if (onNavigateNeighborInPopup) {
      const handled = onNavigateNeighborInPopup(cleanRef, cleanLabel);
      if (handled) return;
    }
    if (graph && onSelectGraphNode) {
      if (cleanRef && graph.nodes.has(cleanRef)) {
        onClose();
        onSelectGraphNode(cleanRef);
        return;
      }
      const refLower = cleanRef.toLowerCase();
      const lblLower = cleanLabel.toLowerCase();
      const match = Array.from(graph.nodes.values()).find(
        (n) =>
          (refLower && n.id.toLowerCase() === refLower) ||
          (refLower && n.label.toLowerCase().includes(refLower)) ||
          (lblLower && n.label.toLowerCase() === lblLower)
      );
      if (match) {
        onClose();
        onSelectGraphNode(match.id);
        return;
      }
    }
    if (cleanRef && onJumpToScript && knownTargetKeySet.has(canonicalScriptMatchKey(cleanRef))) {
      handleJump(cleanRef);
    }
  };

  const handleCopyFullScript = async () => {
    if (!effectiveScriptText) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(effectiveScriptText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = effectiveScriptText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedFullScript(true);
      window.setTimeout(() => setCopiedFullScript(false), 1800);
    } catch {
      // Ignore clipboard permission errors in restricted contexts
    }
  };

  const handleJumpToHighlightedLine = () => {
    if (highlightLineRef.current) {
      highlightLineRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  const handleStepSearchMatch = (delta: number) => {
    if (scriptSearchMatches.length === 0) return;
    setActiveSearchMatchIdx((prev) => {
      const len = scriptSearchMatches.length;
      return ((prev + delta) % len + len) % len;
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="node-info-modal-title"
      data-canvas-ui="true"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-950/60 lg:bg-slate-950/20 flex items-center justify-center lg:items-stretch lg:justify-end p-3 sm:p-5 lg:p-3.5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl lg:max-w-[560px] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] lg:max-h-none lg:h-full"
      >
        {/* Header: Optional Back history button, Title, unboxed metadata trail, and primary script jump */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            {canGoBack && onGoBack && (
              <button
                type="button"
                onClick={onGoBack}
                title={
                  previousNodeTitle
                    ? `Zurück zu: ${previousNodeTitle}`
                    : 'Zum vorherigen Knoten'
                }
                className="mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 hover:border-slate-600 text-slate-200 text-xs font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Zurück</span>
              </button>
            )}
            <div className="min-w-0 space-y-1 flex-1">
              <h3
                id="node-info-modal-title"
                className="text-base font-semibold text-slate-100 truncate"
              >
                {snapshot.title || snapshot.scriptNumber}
              </h3>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                <span className="text-slate-200 font-medium">{explanation.archetypeLabel}</span>
                {snapshot.scriptNumber && !isRawMermaid && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-indigo-300 tabular-nums">
                      Skript [{snapshot.scriptNumber}]
                    </span>
                  </>
                )}
                {isStepMode && snapshot.prio !== undefined && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">Prio {snapshot.prio}</span>
                  </>
                )}
                {rulesPreview.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {rulesPreview.length} {rulesPreview.length === 1 ? 'Regel' : 'Regeln'}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {snapshot.canJumpToDetailScript &&
              snapshot.detailTargetScriptNumber &&
              onJumpToScript && (
                <button
                  type="button"
                  onClick={() => handleJump(snapshot.detailTargetScriptNumber!)}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Detail-Skript öffnen</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Info-Box schließen"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Audience Mode Bar: Prominent Laie | IT-Profi Segmented Control + Studio Edit */}
        <div className="px-5 py-2.5 border-b border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div
              role="tablist"
              aria-label="Ansichtsmodus der Knoten-Info"
              className="inline-flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'layperson'}
                onClick={() => setViewMode('layperson')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'layperson'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Laie</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'pro'}
                onClick={() => setViewMode('pro')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'pro'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>IT-Profi</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'script'}
                onClick={() => setViewMode('script')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'script'
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>Original-Skript</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setViewMode('edit')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'edit'
                  ? 'bg-slate-800 border-slate-700 text-slate-100'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-100'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Bearbeiten</span>
            </button>
          </div>

          {onOpenOpeningHours && !isRawMermaid && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenOpeningHours(snapshot.scriptNumber);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-amber-300 font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Alle Öffnungszeiten</span>
            </button>
          )}
        </div>

        {/* VIEW 1: LAIE (DEFAULT — EASY TO UNDERSTAND FOR EVERYONE) */}
        {viewMode === 'layperson' && (
          <div ref={bodyScrollContainerRef} className="p-5 space-y-5 overflow-y-auto flex-1">
            {/* Block 1: What is this building block? */}
            <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-sm font-semibold text-slate-100">
                  Wofür ist dieses Bauteil?
                </h4>
                <span className="text-xs text-emerald-300 font-medium">
                  {explanation.shortTagline}
                </span>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed">
                {explanation.whatIsIt}
              </p>
            </section>

            {/* Block 2: What specifically happens to the caller here? */}
            <section className="space-y-2.5 pb-4 border-b border-slate-800">
              <h4 className="text-sm font-semibold text-slate-100">
                Was passiert hier mit dem Anrufer?
              </h4>
              <ol className="space-y-2">
                {explanation.whatHappensSteps.map((step, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-3 text-xs sm:text-sm text-slate-200 leading-relaxed"
                  >
                    <span className="w-5 h-5 rounded-md bg-slate-800 border border-slate-700 text-emerald-300 font-mono text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                      {idx + 1}
                    </span>
                    <span className="min-w-0">{step}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* Block 3: Plain-Language Key Facts */}
            {explanation.plainFacts.length > 0 && (
              <section className="space-y-2.5 pb-4 border-b border-slate-800">
                <h4 className="text-xs font-semibold text-slate-300">
                  Wichtige Eckdaten im Klartext
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {explanation.plainFacts.map((fact) => (
                    <div
                      key={fact.label}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 space-y-0.5"
                    >
                      <div className="text-[11px] text-slate-400">{fact.label}</div>
                      <div className="text-xs font-medium text-slate-100 leading-snug break-words">
                        {fact.value}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Block 4: Caller Journey (Where from -> Where to) */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <ArrowDownLeft className="w-3.5 h-3.5 text-sky-400" />
                    <span>Woher kommt der Anrufer?</span>
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {incomingList.length}
                  </span>
                </div>
                {incomingList.length === 0 ? (
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Hier beginnt dieser Ablauf (oder es gibt keinen vorgeschalteten Baustein in dieser Ansicht).
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg bg-slate-950/60 max-h-40 overflow-y-auto">
                    {incomingList.map((inc, idx) => (
                      <li key={`${inc.fromScriptNumber}-${idx}`}>
                        <button
                          type="button"
                          onClick={() =>
                            handleNavigateNeighbor(inc.fromScriptNumber, inc.fromLabel)
                          }
                          className="w-full px-3 py-2 flex items-center justify-between gap-2 text-xs text-left hover:bg-slate-800/60 transition-colors cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="text-slate-100 font-medium truncate">
                              {(inc.fromScriptNumber &&
                                explanation.friendlyTargetLabels?.[inc.fromScriptNumber.trim()]) ||
                                inc.fromLabel ||
                                inc.fromScriptNumber}
                            </div>
                            {inc.edgeLabel && (
                              <div className="text-[11px] text-slate-400 truncate">
                                Weg: {inc.edgeLabel}
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] text-sky-300 shrink-0">Zeigen</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Wohin geht es danach?</span>
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {snapshot.outgoingConnections.length}
                  </span>
                </div>
                {snapshot.outgoingConnections.length === 0 ? (
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Kein weiterer Folgeschritt in dieser Ansicht (z. B. Vermittlung an Team oder Gesprächsende).
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg bg-slate-950/60 max-h-40 overflow-y-auto">
                    {snapshot.outgoingConnections.map((conn) => (
                      <li key={conn.id}>
                        <button
                          type="button"
                          onClick={() =>
                            handleNavigateNeighbor(conn.toTargetNumber, conn.label)
                          }
                          className="w-full px-3 py-2 flex items-center justify-between gap-2 text-xs text-left hover:bg-slate-800/60 transition-colors cursor-pointer"
                        >
                          <div className="min-w-0">
                            <div className="text-emerald-300 font-medium truncate">
                              {(conn.toTargetNumber &&
                                explanation.friendlyTargetLabels?.[conn.toTargetNumber.trim()]) ||
                                conn.toTargetNumber}
                            </div>
                            {conn.label && (
                              <div className="text-[11px] text-slate-400 truncate">
                                Auslöser: {conn.label}
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] text-emerald-300 shrink-0">Zeigen</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setViewMode('pro')}
                className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-indigo-300 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Technische Details (IT-Profi) anzeigen</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Schließen
              </button>
            </div>
          </div>
        )}

        {/* VIEW 2: IT-PROFI (TECHNICAL SPECS, PARAMETERS, RULES, FINDINGS, RAW CODE) */}
        {viewMode === 'pro' && (
          <div ref={bodyScrollContainerRef} className="p-5 space-y-5 overflow-y-auto flex-1">
            {/* Technical Summary Line */}
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="font-mono text-slate-300 tabular-nums break-all">
                <span className="text-slate-500">Node-ID:</span>{' '}
                <span className="text-indigo-300">{snapshot.nodeId}</span>
                <span className="text-slate-600 mx-2">·</span>
                <span>{explanation.technicalSummary}</span>
              </div>
            </div>

            {/* Technical Configuration Grid */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pb-4 border-b border-slate-800 text-xs">
              <div className="space-y-0.5">
                <div className="text-slate-400 flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>Bauteil-Typ &amp; Kennung</span>
                </div>
                <div className="font-mono text-slate-100 tabular-nums">
                  {blockTypeLabel}
                  {snapshot.scriptNumber ? ` · [${snapshot.scriptNumber}]` : ''}
                  {snapshot.cdnAlias ? ` · CDN ${snapshot.cdnAlias}` : ''}
                </div>
                {graphNode && (
                  <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                    Rolle: {graphNode.role} · {graphNode.inDegree} ein / {graphNode.outDegree} aus
                  </div>
                )}
              </div>

              <div className="space-y-0.5">
                <div className="text-slate-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span>Öffnungszeiten / SondZeit</span>
                </div>
                <div className="font-mono text-slate-100 tabular-nums">
                  {snapshot.resolvedScheduleDisplay || snapshot.schedule || 'Kein Zeitprofil (24/7 oder geerbt)'}
                </div>
                {snapshot.hasHolidayCheck && (
                  <div className="text-[11px] text-amber-300 flex items-center gap-1 pt-0.5">
                    <Calendar className="w-3 h-3 shrink-0" />
                    <span>Feiertagsprüfung aktiv</span>
                  </div>
                )}
              </div>

              <div className="space-y-0.5">
                <div className="text-slate-400 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Direktruf / DNIS &amp; Organisation</span>
                </div>
                <div className="font-mono text-slate-100 tabular-nums break-words">
                  {dnisList.length > 0
                    ? dnisList.slice(0, 6).join(', ') +
                      (dnisList.length > 6 ? ` (+${dnisList.length - 6})` : '')
                    : '—'}
                </div>
                {snapshot.organizationName && (
                  <div className="text-[11px] text-slate-400">{snapshot.organizationName}</div>
                )}
              </div>

              <div className="space-y-0.5">
                <div className="text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Warteschlange / Skillset (Queue)</span>
                </div>
                <div className="font-mono text-slate-100">
                  {snapshot.queueTarget || '—'}
                </div>
              </div>

              <div className="space-y-0.5">
                <div className="text-slate-400 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Ansage / Treatment / Wait / HDX</span>
                </div>
                <div className="font-mono text-slate-100 tabular-nums">
                  {[
                    snapshot.announcement || snapshot.treatmentInfo,
                    snapshot.waitSeconds !== undefined ? `WAIT ${snapshot.waitSeconds}s` : '',
                    snapshot.hdxAction ? `HDX ${snapshot.hdxAction}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </div>
              </div>

              <div className="space-y-0.5">
                <div className="text-slate-400 flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>Bedingung / IF-Ausdruck</span>
                </div>
                <div className="font-mono text-slate-100 break-words">
                  {snapshot.condition || '—'}
                </div>
              </div>
            </section>

            {/* Incoming & Outgoing Technical References */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-5 pb-4 border-b border-slate-800">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <ArrowDownLeft className="w-3.5 h-3.5 text-sky-400" />
                    <span>Eingehende Referenzen</span>
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {incomingList.length}
                  </span>
                </div>
                {incomingList.length === 0 ? (
                  <p className="text-xs text-slate-500">Keine eingehenden Referenzen.</p>
                ) : (
                  <ul className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg bg-slate-950/60 max-h-36 overflow-y-auto">
                    {incomingList.map((inc, idx) => {
                      const canJumpInc =
                        Boolean(onJumpToScript) &&
                        knownTargetKeySet.has(canonicalScriptMatchKey(inc.fromScriptNumber));
                      return (
                        <li
                          key={`${inc.fromScriptNumber}-${idx}`}
                          className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-slate-200 truncate">
                              {inc.fromLabel}
                            </div>
                            {inc.edgeLabel && (
                              <div className="text-[11px] font-mono text-slate-400 truncate">
                                {inc.edgeLabel}
                              </div>
                            )}
                          </div>
                          {canJumpInc ? (
                            <button
                              type="button"
                              onClick={() => handleJump(inc.fromScriptNumber)}
                              className="text-[11px] text-indigo-300 hover:text-indigo-200 font-medium whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Skript öffnen
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                handleNavigateNeighbor(inc.fromScriptNumber, inc.fromLabel)
                              }
                              className="text-[11px] text-sky-300 hover:text-sky-200 font-medium whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Fokus
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Ausgehende Ziele</span>
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {snapshot.outgoingConnections.length}
                  </span>
                </div>
                {snapshot.outgoingConnections.length === 0 ? (
                  <p className="text-xs text-slate-500">Keine ausgehenden Sprünge.</p>
                ) : (
                  <ul className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg bg-slate-950/60 max-h-36 overflow-y-auto">
                    {snapshot.outgoingConnections.map((conn) => {
                      const canJumpTarget =
                        Boolean(onJumpToScript) &&
                        knownTargetKeySet.has(canonicalScriptMatchKey(conn.toTargetNumber));
                      return (
                        <li
                          key={conn.id}
                          className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-emerald-300 truncate">
                              {conn.toTargetNumber}
                            </div>
                            {conn.label && (
                              <div className="text-[11px] font-mono text-slate-400 truncate">
                                {conn.label}
                              </div>
                            )}
                          </div>
                          {canJumpTarget ? (
                            <button
                              type="button"
                              onClick={() => handleJump(conn.toTargetNumber)}
                              className="text-[11px] text-indigo-300 hover:text-indigo-200 font-medium whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Skript öffnen
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                handleNavigateNeighbor(conn.toTargetNumber, conn.label)
                              }
                              className="text-[11px] text-emerald-300 hover:text-emerald-200 font-medium whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Fokus
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>

            {/* Module Rules & Schedule Table */}
            {rulesPreview.length > 0 && (
              <section className="space-y-2 pb-4 border-b border-slate-800">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-200">
                  <span>Prioritäts-Regeln &amp; Zeitpläne ({rulesPreview.length})</span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Skript [{snapshot.scriptNumber}]
                  </span>
                </div>
                <div className="border border-slate-800 rounded-lg overflow-x-auto bg-slate-950/60 max-h-52 overflow-y-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950 text-slate-400 font-medium">
                        <th className="py-2 px-3 whitespace-nowrap">Prio</th>
                        <th className="py-2 px-3">Schritt</th>
                        <th className="py-2 px-3">Zeit / Bedingung</th>
                        <th className="py-2 px-3">Ziel / Aktion</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {rulesPreview.map((rule) => {
                        const isCurrentRule = Boolean(snapshot.ruleId && snapshot.ruleId === rule.id);
                        return (
                          <tr
                            key={rule.id}
                            className={isCurrentRule ? 'bg-indigo-950/35' : 'hover:bg-slate-800/30'}
                          >
                            <td className="py-2 px-3 font-mono text-slate-300 tabular-nums whitespace-nowrap align-top">
                              P{rule.prio}
                            </td>
                            <td className="py-2 px-3 text-slate-100 font-medium align-top">
                              {rule.stepName}
                            </td>
                            <td className="py-2 px-3 text-slate-300 align-top">
                              {rule.schedule && (
                                <div className="font-mono text-sky-300 tabular-nums">
                                  {rule.schedule}
                                </div>
                              )}
                              {rule.holiday && (
                                <div className="text-amber-300">{rule.holiday}</div>
                              )}
                              {rule.condition && (
                                <div className="font-mono text-slate-400">{rule.condition}</div>
                              )}
                              {!rule.schedule && !rule.holiday && !rule.condition && (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-200 align-top">
                              {[
                                rule.targetNumber ? `→ ${rule.targetNumber}` : '',
                                rule.queueTarget ? `Queue: ${rule.queueTarget}` : '',
                                rule.announcement ? `Ansage: ${rule.announcement}` : '',
                                rule.choicesCount > 0 ? `${rule.choicesCount} Auswahl-Ziele` : '',
                              ]
                                .filter(Boolean)
                                .join(' · ') || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Extracted Avaya Special Parameters */}
            {specialParams.length > 0 && (
              <section className="space-y-2 pb-4 border-b border-slate-800">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Avaya-Sonderparameter ({specialParams.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  {specialParams.slice(0, 10).map((param) => (
                    <div
                      key={param.key}
                      className="flex items-baseline justify-between gap-2 py-1 border-b border-slate-800/60"
                    >
                      <span className="text-slate-400 truncate">
                        {param.label}{' '}
                        <span className="font-mono text-[10px] text-slate-500">
                          ({param.key})
                        </span>
                      </span>
                      <span className="font-mono text-slate-100 tabular-nums truncate text-right">
                        {param.value}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Related Logic Findings */}
            {findings.length > 0 && (
              <section className="space-y-2 pb-4 border-b border-slate-800">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span>Prüfhinweise ({findings.length})</span>
                </div>
                <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg bg-slate-950/60">
                  {findings.map((f, idx) => {
                    const severityLabel =
                      f.severity === 'error'
                        ? 'Fehler'
                        : f.severity === 'warning'
                        ? 'Warnung'
                        : 'Hinweis';
                    return (
                      <div key={idx} className="px-3 py-2 text-xs space-y-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={`font-medium ${
                              f.severity === 'error'
                                ? 'text-rose-300'
                                : f.severity === 'warning'
                                ? 'text-amber-300'
                                : 'text-sky-300'
                            }`}
                          >
                            {f.title}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 shrink-0">
                            {severityLabel}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">{f.recommendation}</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* IT-Profi Footer Actions */}
            <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {effectiveScriptText && (
                  <button
                    type="button"
                    onClick={() => setViewMode('script')}
                    className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileCode className="w-3.5 h-3.5 text-amber-400" />
                    <span>Im Original-Skript prüfen</span>
                  </button>
                )}
                {hasCustomPositionOffset && (
                  <button
                    type="button"
                    onClick={() => {
                      onResetPositionOffset(snapshot.nodeId);
                      onClose();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Position zurücksetzen</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode('edit')}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Element bearbeiten</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Schließen
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: ORIGINAL-SKRIPT (FULL SOURCE WITH LINE NUMBERS, NODE HIGHLIGHT, SEARCH & COPY) */}
        {viewMode === 'script' && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {scriptLines.length === 0 ? (
              <div className="p-6 flex-1 flex flex-col items-center justify-center text-center space-y-2">
                <FileCode className="w-7 h-7 text-slate-600" />
                <div className="text-sm font-medium text-slate-200">
                  Kein Original-Skript hinterlegt
                </div>
                <p className="text-xs text-slate-400 max-w-md leading-relaxed">
                  Für dieses Element liegt kein eingelesener `.s`-Quelltext vor (z. B. externes Ziel, manuell angelegter Baustein oder reines Mermaid-Diagramm).
                </p>
              </div>
            ) : (
              <>
                {/* Script Toolbar: Metadata, Search, Jump to Node, Copy */}
                <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/80 flex flex-col gap-2 shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-400 font-mono tabular-nums">
                      <span className="text-slate-200 font-semibold">
                        {snapshot.scriptNumber ? `Skript ${snapshot.scriptNumber}` : 'Original-Quelltext'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{scriptLines.length} Zeilen</span>
                      {effectiveHighlightStart !== undefined && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-300">
                            Knoten-Stelle:{' '}
                            {effectiveHighlightEnd && effectiveHighlightEnd > effectiveHighlightStart
                              ? `Zeilen ${effectiveHighlightStart}–${effectiveHighlightEnd}`
                              : `Zeile ${effectiveHighlightStart}`}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {effectiveHighlightStart !== undefined && (
                        <button
                          type="button"
                          onClick={handleJumpToHighlightedLine}
                          className="px-2.5 py-1 rounded-md border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[11px] font-medium text-amber-300 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          title="Zur markierten Knoten-Zeile springen"
                        >
                          <Crosshair className="w-3 h-3" />
                          <span>Zur Knoten-Stelle</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleCopyFullScript}
                        className="px-2.5 py-1 rounded-md border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[11px] font-medium text-slate-200 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {copiedFullScript ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-300">Kopiert</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-slate-400" />
                            <span>Skript kopieren</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Live In-Script Search Bar */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={scriptSearchQuery}
                        onChange={(e) => {
                          setScriptSearchQuery(e.target.value);
                          setActiveSearchMatchIdx(0);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleStepSearchMatch(e.shiftKey ? -1 : 1);
                          }
                        }}
                        placeholder="Im Original-Skript suchen (z. B. GIVE RAN, QUEUE, IF, Rufnummer)…"
                        className="w-full pl-8 pr-7 py-1.5 bg-slate-900 border border-slate-800 rounded-md text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                      {scriptSearchQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setScriptSearchQuery('');
                            setActiveSearchMatchIdx(0);
                          }}
                          aria-label="Suche leeren"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {scriptSearchQuery.trim() && (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[11px] font-mono text-slate-400 tabular-nums px-1.5">
                          {scriptSearchMatches.length > 0
                            ? `${
                                (((activeSearchMatchIdx % scriptSearchMatches.length) +
                                  scriptSearchMatches.length) %
                                  scriptSearchMatches.length) +
                                1
                              } / ${scriptSearchMatches.length}`
                            : '0 Treffer'}
                        </span>
                        <button
                          type="button"
                          disabled={scriptSearchMatches.length === 0}
                          onClick={() => handleStepSearchMatch(-1)}
                          title="Vorheriger Treffer (Shift+Enter)"
                          className="p-1 rounded-md border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-40 cursor-pointer"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={scriptSearchMatches.length === 0}
                          onClick={() => handleStepSearchMatch(1)}
                          title="Nächster Treffer (Enter)"
                          className="p-1 rounded-md border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 disabled:opacity-40 cursor-pointer"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Numbered Monospace Script Viewport */}
                <div className="flex-1 overflow-auto bg-slate-950 py-2 font-mono text-[11.5px] leading-relaxed">
                  {scriptLines.map((lineText, idx) => {
                    const lineNo = idx + 1;
                    const isNodeLine =
                      effectiveHighlightStart !== undefined &&
                      effectiveHighlightEnd !== undefined &&
                      lineNo >= effectiveHighlightStart &&
                      lineNo <= effectiveHighlightEnd;
                    const isFirstNodeLine =
                      effectiveHighlightStart !== undefined && lineNo === effectiveHighlightStart;
                    const isSearchActive = activeSearchMatchLine === lineNo;
                    const isSearchHit =
                      !isSearchActive &&
                      scriptSearchQuery.trim().length > 0 &&
                      scriptSearchMatches.includes(lineNo);

                    const rowBg = isSearchActive
                      ? 'bg-indigo-500/25 text-slate-50'
                      : isNodeLine
                      ? 'bg-amber-500/12 text-amber-100'
                      : isSearchHit
                      ? 'bg-indigo-500/10 text-slate-100'
                      : 'text-slate-300 hover:bg-slate-900/80';

                    return (
                      <div
                        key={lineNo}
                        ref={(el) => {
                          if (isFirstNodeLine) highlightLineRef.current = el;
                          if (isSearchActive) activeMatchLineRef.current = el;
                        }}
                        className={`px-3 py-0.5 flex items-start gap-3 ${rowBg}`}
                      >
                        <span
                          className={`w-10 shrink-0 text-right select-none tabular-nums ${
                            isNodeLine
                              ? 'text-amber-300 font-semibold'
                              : isSearchActive
                              ? 'text-indigo-300 font-semibold'
                              : 'text-slate-600'
                          }`}
                        >
                          {lineNo}
                        </span>
                        <span className="whitespace-pre-wrap break-all flex-1 min-w-0">
                          {renderHighlightedScriptLine(lineText, scriptSearchQuery)}
                        </span>
                        {isFirstNodeLine && (
                          <span className="text-[10px] font-sans font-medium text-amber-300/90 shrink-0 select-none pl-2">
                            Knoten-Stelle
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('pro')}
                className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-indigo-300 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Zurück zu IT-Profi</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Schließen
              </button>
            </div>
          </div>
        )}

        {/* VIEW 3: INLINE EDITOR FORM (STUDIO ONLY) */}
        {viewMode === 'edit' && (
          <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
            {/* Primary Row: ID/Script Number + Display Name */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {isStepMode ? 'Skript-Zugehörigkeit' : 'Nummer / Skript-ID'}
                </label>
                <div className="relative">
                  <Hash className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={scriptNumber}
                    disabled={isStepMode}
                    onChange={(e) => setScriptNumber(e.target.value)}
                    placeholder="z. B. 48210 oder Main"
                    className="w-full pl-8 pr-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {isStepMode ? 'Schritt-Bezeichnung (Knoten-Text)' : 'Bezeichnung / Knoten-Text'}
                </label>
                <input
                  type="text"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="z. B. Begrüßung & Sprachwahl oder VIP-Routing"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Building Block Type Selector */}
            {!isRawMermaid && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Baustein-Typ im Callflow
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {BLOCK_TYPE_OPTIONS.map((opt) => {
                    const active = blockType === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setBlockType(opt.id)}
                        className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-100'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="text-xs font-semibold truncate">{opt.label}</div>
                        <div className="text-[11px] text-slate-400 truncate">{opt.hint}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Callflow Routing Attributes */}
            {!isRawMermaid && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-800">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-amber-300 mb-1">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Ansage / RAN / Musik-ID</span>
                  </label>
                  <input
                    type="text"
                    value={announcement}
                    onChange={(e) => setAnnouncement(e.target.value)}
                    placeholder="z. B. willkommen.wav oder RAN 301"
                    className="w-full px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-emerald-300 mb-1">
                    <Layers className="w-3.5 h-3.5" />
                    <span>Warteschlange / Skillset (Queue)</span>
                  </label>
                  <input
                    type="text"
                    value={queueTarget}
                    onChange={(e) => setQueueTarget(e.target.value)}
                    placeholder="z. B. Vertrieb_VIP oder Service_DE"
                    className="w-full px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="sm:col-span-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-sky-300">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Öffnungszeiten / Zeitplan</span>
                    </label>
                    {schedule && (
                      <button
                        type="button"
                        onClick={() => setSchedule('')}
                        className="text-[11px] text-slate-400 hover:text-rose-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Leeren
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    placeholder="z. B. Mo–Fr 08:00–17:00 oder Mo–Do 08–18, Fr 08–16"
                    className="w-full px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      'Mo–Fr 08:00–17:00',
                      'Mo–Fr 08:00–18:00',
                      'Mo–Do 08:00–17:00, Fr 08:00–15:00',
                      'Sa–So geschlossen',
                      'Feiertags-Prüfung aktiv',
                      '24/7 erreichbar',
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setSchedule(preset)}
                        className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          schedule === preset
                            ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                            : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-300'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-indigo-300 mb-1">
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>Bedingung / Feiertag / Sonderstatus (IF / Überlauf)</span>
                  </label>
                  <input
                    type="text"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                    placeholder="z. B. Feiertag aktiv, Sys_SondStat oder Wartezeit > 30s"
                    className="w-full px-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            )}

            {/* Outgoing Connections Editor */}
            <div className="space-y-2 pt-3 border-t border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-slate-200">
                  Ausgehende Verbindungen &amp; Sprungziele ({outgoingConnections.length})
                </label>
                <button
                  type="button"
                  onClick={handleAddConnection}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-xs font-medium text-indigo-200 flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Verbindung hinzufügen</span>
                </button>
              </div>

              <datalist id="callflow-known-targets-list">
                {availableTargetRefs.map((t) => (
                  <option key={t.scriptNumber} value={t.scriptNumber}>
                    {t.scriptName}
                  </option>
                ))}
              </datalist>

              {outgoingConnections.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Keine ausgehenden Sprungziele hinterlegt. Tragen Sie Ziele hier ein oder ziehen Sie im Diagramm eine Verbindung.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {outgoingConnections.map((conn, idx) => (
                    <div
                      key={conn.id}
                      className="flex items-center gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800"
                    >
                      <input
                        type="text"
                        value={conn.label}
                        onChange={(e) =>
                          handleUpdateConnection(idx, { label: e.target.value })
                        }
                        placeholder="Beschriftung (z. B. Taste 1, P1)"
                        className="w-36 sm:w-44 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <input
                        type="text"
                        list="callflow-known-targets-list"
                        value={conn.toTargetNumber}
                        onChange={(e) =>
                          handleUpdateConnection(idx, {
                            toTargetNumber: e.target.value,
                          })
                        }
                        placeholder="Ziel-Skript / Nummer"
                        className="flex-1 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveConnection(idx)}
                        title="Verbindung entfernen"
                        className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/40 text-rose-300 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Knoten löschen</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteNode(snapshot.nodeId);
                      onClose();
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Wirklich löschen?</span>
                  </button>
                )}

                {hasCustomPositionOffset && (
                  <button
                    type="button"
                    onClick={() => {
                      onResetPositionOffset(snapshot.nodeId);
                      onClose();
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Position zurücksetzen</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Änderungen übernehmen</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
