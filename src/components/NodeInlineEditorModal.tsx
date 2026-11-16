import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Clock,
  GitBranch,
  Hash,
  Layers,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { CallflowBuildingBlockType } from '../types/mermaidStudio';
import {
  EditableCallflowNodeSnapshot,
  EditableNodeConnectionItem,
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

export const NodeInlineEditorModal: React.FC<NodeInlineEditorModalProps> = ({
  isOpen,
  snapshot,
  availableTargetRefs,
  hasCustomPositionOffset,
  onClose,
  onSave,
  onResetPositionOffset,
  onDeleteNode,
}) => {
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
    setScriptNumber(snapshot.scriptNumber);
    setTitle(snapshot.title);
    setBlockType(snapshot.blockType);
    setAnnouncement(snapshot.announcement);
    setQueueTarget(snapshot.queueTarget);
    setSchedule(snapshot.schedule);
    setCondition(snapshot.condition);
    setOutgoingConnections(
      snapshot.outgoingConnections.map((c) => ({ ...c }))
    );
    setConfirmDelete(false);
  }, [snapshot]);

  if (!isOpen || !snapshot) return null;

  const isStepMode = snapshot.mode === 'workspace-step';
  const isRawMermaid = snapshot.mode === 'raw-mermaid';

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

  return (
    <div
      data-canvas-ui="true"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-100 truncate">
                {isStepMode
                  ? `Regelschritt Prio ${snapshot.prio ?? 1} in [${snapshot.scriptNumber}] bearbeiten`
                  : `Knoten [${snapshot.scriptNumber}] direkt bearbeiten`}
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                Änderungen wirken sofort auf Diagramm, Datenmodell und alle Exporte (.csv, .md, .png, .html)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Primary Row: ID/Script Number + Display Name */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                {isStepMode ? 'Skript-Zugehörigkeit' : 'Nummer / Skript-ID'}
              </label>
              <div className="relative">
                <Hash className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={scriptNumber}
                  disabled={isStepMode}
                  onChange={(e) => setScriptNumber(e.target.value)}
                  placeholder="z.B. 48210 oder Main"
                  className="w-full pl-8 pr-2.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                {isStepMode ? 'Schritt-Bezeichnung (Knoten-Text)' : 'Bezeichnung / Knoten-Text'}
              </label>
              <input
                type="text"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="z.B. Begrüßung & Sprachwahl oder VIP-Routing"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Building Block Type Selector */}
          {!isRawMermaid && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
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
                          : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-semibold truncate">{opt.label}</div>
                      <div className="text-[10px] text-slate-400 truncate">{opt.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Callflow Routing Attributes (Announcement, Skillset/Queue, Schedule, Condition) */}
          {!isRawMermaid && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/90">
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300 mb-1">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Ansage / RAN / Musik-ID</span>
                </label>
                <input
                  type="text"
                  value={announcement}
                  onChange={(e) => setAnnouncement(e.target.value)}
                  placeholder="z.B. willkommen.wav oder RAN 301"
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300 mb-1">
                  <Layers className="w-3.5 h-3.5" />
                  <span>Warteschlange / Skillset (Queue)</span>
                </label>
                <input
                  type="text"
                  value={queueTarget}
                  onChange={(e) => setQueueTarget(e.target.value)}
                  placeholder="z.B. Vertrieb_VIP oder Service_DE"
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-300 mb-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Zeitplan / Öffnungszeiten</span>
                </label>
                <input
                  type="text"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder="z.B. Mo-Fr 08:00-18:00"
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-300 mb-1">
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>Bedingung (IF / Status / Überlauf)</span>
                </label>
                <input
                  type="text"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  placeholder="z.B. Feiertag aktiv oder Wartezeit > 30s"
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>
          )}

          {/* Outgoing Connections Editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-semibold text-slate-200">
                Ausgehende Verbindungen &amp; Sprungziele ({outgoingConnections.length})
              </label>
              <button
                type="button"
                onClick={handleAddConnection}
                className="px-2.5 py-1 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-[11px] font-semibold text-indigo-200 flex items-center gap-1 transition-colors cursor-pointer"
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
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400">
                Keine ausgehenden Sprungziele hinterlegt. Sie können Ziele hier eintragen oder direkt im Diagramm vom rechten Verbindungspunkt dieses Knotens einen Pfeil zu einem anderen Knoten ziehen.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {outgoingConnections.map((conn, idx) => (
                  <div
                    key={conn.id}
                    className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/90 border border-slate-800"
                  >
                    <input
                      type="text"
                      value={conn.label}
                      onChange={(e) =>
                        handleUpdateConnection(idx, { label: e.target.value })
                      }
                      placeholder="Beschriftung (z.B. Taste 1, P1)"
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
                      placeholder="Ziel-Skript / Nummer (z.B. 48210)"
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
                  className="px-2.5 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/40 text-rose-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
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
                  className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
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
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
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
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Änderungen übernehmen</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
