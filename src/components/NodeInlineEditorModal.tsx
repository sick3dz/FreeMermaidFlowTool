import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Clock,
  Edit3,
  ExternalLink,
  GitBranch,
  Hash,
  Info,
  Layers,
  ListChecks,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Sliders,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { CallflowBuildingBlockType } from '../types/mermaidStudio';
import {
  EditableCallflowNodeSnapshot,
  EditableNodeConnectionItem,
  canonicalScriptMatchKey,
} from '../utils/scriptCallflowParser';

interface NodeInlineEditorModalProps {
  isOpen: boolean;
  snapshot: EditableCallflowNodeSnapshot | null;
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
  onOpenOpeningHours?: (initialSearch?: string) => void;
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

type ModalTab = 'overview' | 'edit' | 'schedule';

export const NodeInlineEditorModal: React.FC<NodeInlineEditorModalProps> = ({
  isOpen,
  snapshot,
  availableTargetRefs,
  hasCustomPositionOffset,
  onClose,
  onSave,
  onResetPositionOffset,
  onDeleteNode,
  onJumpToScript,
  onOpenOpeningHours,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('overview');
  const [scriptNumber, setScriptNumber] = useState('');
  const [title, setTitle] = useState('');
  const [blockType, setBlockType] = useState<CallflowBuildingBlockType>('script');
  const [announcement, setAnnouncement] = useState('');
  const [queueTarget, setQueueTarget] = useState('');
  const [schedule, setSchedule] = useState('');
  const [condition, setCondition] = useState('');
  const [outgoingConnections, setOutgoingConnections] = useState<EditableNodeConnectionItem[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!snapshot) return;
    setActiveTab(snapshot.mode === 'raw-mermaid' ? 'edit' : 'overview');
    setScriptNumber(snapshot.scriptNumber);
    setTitle(snapshot.title);
    setBlockType(snapshot.blockType);
    setAnnouncement(snapshot.announcement);
    setQueueTarget(snapshot.queueTarget);
    setSchedule(snapshot.schedule);
    setCondition(snapshot.condition);
    setOutgoingConnections(snapshot.outgoingConnections.map((c) => ({ ...c })));
    setConfirmDelete(false);
  }, [snapshot]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !snapshot) return null;

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
  const hasScheduleTab = !isRawMermaid && (rulesPreview.length > 0 || Boolean(snapshot.resolvedScheduleDisplay));

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="node-info-modal-title"
      data-canvas-ui="true"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
      >
        {/* Header: Title, unboxed metadata trail, and primary script jump */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0 space-y-1">
            <h3
              id="node-info-modal-title"
              className="text-base font-semibold text-slate-100 truncate"
            >
              {snapshot.title || snapshot.scriptNumber}
            </h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
              <span className="font-mono text-indigo-300 tabular-nums">
                [{snapshot.scriptNumber}]
              </span>
              <span aria-hidden="true">·</span>
              <span>{blockTypeLabel}</span>
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
              {snapshot.cdnAlias && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">CDN {snapshot.cdnAlias}</span>
                </>
              )}
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
                  <span>Skript öffnen</span>
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

        {/* Segmented Navigation Tabs */}
        {!isRawMermaid && (
          <div className="px-5 py-2.5 border-b border-slate-800 bg-slate-900 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'overview'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Info className="w-3.5 h-3.5" />
                <span>Übersicht</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('edit')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'edit'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Bearbeiten</span>
              </button>
              {hasScheduleTab && (
                <button
                  type="button"
                  onClick={() => setActiveTab('schedule')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === 'schedule'
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  <span>Zeiten &amp; Regeln</span>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    ({rulesPreview.length})
                  </span>
                </button>
              )}
            </div>

            {onOpenOpeningHours && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenOpeningHours(snapshot.scriptNumber);
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-amber-300 font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Öffnungszeiten-Fenster</span>
                <span className="sm:hidden">Zeiten</span>
              </button>
            )}
          </div>
        )}

        {/* TAB 1: STRUCTURED OVERVIEW */}
        {activeTab === 'overview' && !isRawMermaid && (
          <div className="p-5 space-y-5 overflow-y-auto flex-1">
            {/* Key Facts Grid (single-elevation clean hairline table) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pb-4 border-b border-slate-800 text-xs">
              <div className="space-y-0.5">
                <div className="text-slate-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span>Öffnungszeiten / SondZeit</span>
                </div>
                <div className="font-mono text-slate-100 tabular-nums">
                  {snapshot.resolvedScheduleDisplay || 'Keine Zeitbegrenzung (24/7)'}
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
                    : 'Kein direkter DNIS-Einstieg hinterlegt'}
                </div>
                {snapshot.organizationName && (
                  <div className="text-[11px] text-slate-400">{snapshot.organizationName}</div>
                )}
              </div>

              <div className="space-y-0.5">
                <div className="text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Warteschlange / Skillset</span>
                </div>
                <div className="font-mono text-slate-100">
                  {snapshot.queueTarget || '—'}
                </div>
              </div>

              <div className="space-y-0.5">
                <div className="text-slate-400 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Ansage / Treatment / Wartezeit</span>
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

              {snapshot.condition && (
                <div className="sm:col-span-2 space-y-0.5">
                  <div className="text-slate-400 flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>Bedingung / Entscheider</span>
                  </div>
                  <div className="text-slate-100">{snapshot.condition}</div>
                </div>
              )}
            </div>

            {/* Incoming & Outgoing Connections Side-by-Side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pb-4 border-b border-slate-800">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <ArrowDownLeft className="w-3.5 h-3.5 text-sky-400" />
                    <span>Eingehend (Woher)</span>
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {incomingList.length}
                  </span>
                </div>
                {incomingList.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Einstiegspunkt oder keine eingehenden Verweise erkannt.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg bg-slate-950/60 max-h-40 overflow-y-auto">
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
                              <div className="text-[11px] text-slate-400 truncate">
                                {inc.edgeLabel}
                              </div>
                            )}
                          </div>
                          {canJumpInc && (
                            <button
                              type="button"
                              onClick={() => handleJump(inc.fromScriptNumber)}
                              className="text-[11px] text-indigo-300 hover:text-indigo-200 font-medium whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Öffnen
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
                    <span>Ausgehend (Wohin)</span>
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {snapshot.outgoingConnections.length}
                  </span>
                </div>
                {snapshot.outgoingConnections.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Endpunkt (Queue / Ansage / Abschluss) ohne weiteren Skript-Sprung.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg bg-slate-950/60 max-h-40 overflow-y-auto">
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
                              <div className="text-[11px] text-slate-400 truncate">
                                {conn.label}
                              </div>
                            )}
                          </div>
                          {canJumpTarget && (
                            <button
                              type="button"
                              onClick={() => handleJump(conn.toTargetNumber)}
                              className="text-[11px] text-indigo-300 hover:text-indigo-200 font-medium whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Öffnen
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Related Logic Findings (if any) */}
            {findings.length > 0 && (
              <div className="space-y-2 pb-4 border-b border-slate-800">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span>Prüfhinweise für dieses Element ({findings.length})</span>
                </div>
                <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg bg-slate-950/60">
                  {findings.map((f, idx) => (
                    <div key={idx} className="px-3 py-2 text-xs space-y-0.5">
                      <div
                        className={`font-medium ${
                          f.severity === 'error'
                            ? 'text-rose-300'
                            : f.severity === 'warning'
                            ? 'text-amber-300'
                            : 'text-sky-300'
                        }`}
                      >
                        {f.title}
                      </div>
                      <div className="text-[11px] text-slate-400">{f.recommendation}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Extracted Avaya Special Parameters */}
            {specialParams.length > 0 && (
              <div className="space-y-2 pb-4 border-b border-slate-800">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Erkannte Avaya-Parameter ({specialParams.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  {specialParams.slice(0, 8).map((param) => (
                    <div
                      key={param.key}
                      className="flex items-baseline justify-between gap-2 py-1 border-b border-slate-800/60"
                    >
                      <span className="text-slate-400 truncate">{param.label}</span>
                      <span className="font-mono text-slate-100 tabular-nums truncate text-right">
                        {param.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clean Raw Source Excerpt */}
            {snapshot.rawLineSnippet && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-400">Skript-Auszug</div>
                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-36">
                  {snapshot.rawLineSnippet}
                </pre>
              </div>
            )}

            {/* Overview Footer Actions */}
            <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
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
                  onClick={() => setActiveTab('edit')}
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

        {/* TAB 2: INLINE EDITOR FORM */}
        {(activeTab === 'edit' || isRawMermaid) && (
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

        {/* TAB 3: SCHEDULE & MODULE RULES */}
        {activeTab === 'schedule' && hasScheduleTab && (
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-slate-100">
                  Zeitpläne &amp; Regelabfolge in [{snapshot.scriptNumber}]
                </div>
                <div className="text-xs text-slate-400 font-mono tabular-nums">
                  {snapshot.resolvedScheduleDisplay || 'Kein fester Zeitplan (24/7)'}
                </div>
              </div>
              {onOpenOpeningHours && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenOpeningHours('');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Alle Öffnungszeiten öffnen</span>
                </button>
              )}
            </div>

            {rulesPreview.length === 0 ? (
              <p className="text-xs text-slate-400">
                Für dieses Element sind keine einzelnen Prioritäts-Regeln hinterlegt.
              </p>
            ) : (
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-slate-400 font-medium">
                      <th className="py-2.5 px-3 whitespace-nowrap">Prio</th>
                      <th className="py-2.5 px-3">Schritt</th>
                      <th className="py-2.5 px-3">Zeit / Bedingung</th>
                      <th className="py-2.5 px-3">Aktion / Ziel</th>
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
                          <td className="py-2.5 px-3 font-mono text-slate-300 tabular-nums whitespace-nowrap align-top">
                            P{rule.prio}
                          </td>
                          <td className="py-2.5 px-3 text-slate-100 font-medium align-top">
                            {rule.stepName}
                          </td>
                          <td className="py-2.5 px-3 text-slate-300 align-top">
                            {rule.schedule && (
                              <div className="font-mono text-sky-300 tabular-nums">
                                {rule.schedule}
                              </div>
                            )}
                            {rule.holiday && (
                              <div className="text-amber-300">{rule.holiday}</div>
                            )}
                            {rule.condition && (
                              <div className="text-slate-400">{rule.condition}</div>
                            )}
                            {!rule.schedule && !rule.holiday && !rule.condition && (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-200 align-top">
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
            )}

            <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2">
              {snapshot.canJumpToDetailScript &&
                snapshot.detailTargetScriptNumber &&
                onJumpToScript && (
                  <button
                    type="button"
                    onClick={() => handleJump(snapshot.detailTargetScriptNumber!)}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>Im Detail-Diagramm ansehen</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
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
      </div>
    </div>
  );
};
