import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FilePlus2,
  FileText,
  FolderUp,
  Layers,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { ScriptModule, ScriptWorkspace } from '../types/mermaidStudio';
import {
  buildScriptWorkspace,
  mergeScriptModules,
  parseCallflowTextWithFallback,
  SAMPLE_MULTI_SCRIPT_TEXT,
} from '../utils/scriptCallflowParser';
import {
  CALLFLOW_FILE_ACCEPT,
  importCallflowFile,
} from '../utils/callflowFileImporter';

interface MultiScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: ScriptWorkspace;
  prefillScriptNumber?: string | null;
  onUpdateWorkspace: (next: ScriptWorkspace) => void;
  onApplyMasterView: (nextWorkspace?: ScriptWorkspace) => void;
  onOpenScriptDetail: (scriptNumber: string, nextWorkspace?: ScriptWorkspace) => void;
}

export const MultiScriptModal: React.FC<MultiScriptModalProps> = ({
  isOpen,
  onClose,
  workspace,
  prefillScriptNumber,
  onUpdateWorkspace,
  onApplyMasterView,
  onOpenScriptDetail,
}) => {
  const [rawText, setRawText] = useState('');
  const [defaultNumber, setDefaultNumber] = useState('');
  const [defaultName, setDefaultName] = useState('');
  const [selectedModuleNum, setSelectedModuleNum] = useState<string | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen && prefillScriptNumber) {
      setDefaultNumber(prefillScriptNumber);
    }
  }, [isOpen, prefillScriptNumber]);

  const totalRuleCount = useMemo(
    () => workspace.modules.reduce((acc, mod) => acc + mod.rules.length, 0),
    [workspace.modules]
  );

  const openIssueCountByScript = useMemo(() => {
    const map = new Map<string, number>();
    (workspace.issues || [])
      .filter((i) => i.status === 'open')
      .forEach((i) => {
        map.set(i.sourceScriptNumber, (map.get(i.sourceScriptNumber) || 0) + 1);
        if (i.targetNumber && i.targetNumber !== i.sourceScriptNumber) {
          map.set(i.targetNumber, (map.get(i.targetNumber) || 0) + 1);
        }
      });
    return map;
  }, [workspace.issues]);

  const inspectedModule: ScriptModule | null = useMemo(() => {
    if (workspace.modules.length === 0) return null;
    if (selectedModuleNum) {
      return workspace.modules.find((m) => m.scriptNumber === selectedModuleNum) || workspace.modules[0];
    }
    return workspace.modules[0];
  }, [workspace.modules, selectedModuleNum]);

  if (!isOpen) return null;

  const showNotice = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3500);
  };

  const rebuildPreservingResolutions = (modules: ScriptModule[]) =>
    buildScriptWorkspace(modules, {
      externalEndpoints: workspace.externalEndpoints,
      ignoredChecklistTargets: workspace.ignoredChecklistTargets,
      resolvedIssues: workspace.resolvedIssues,
      manualQuestions: workspace.manualQuestions,
      manualLinks: workspace.manualLinks,
      masterScriptNumber: workspace.masterScriptNumber,
    });

  const handleImportText = () => {
    if (!rawText.trim()) return;
    const parsed = parseCallflowTextWithFallback(rawText, {
      defaultScriptNumber: defaultNumber.trim() || undefined,
      defaultScriptName: defaultName.trim() || undefined,
      origin: 'legacy-text',
    });

    if (parsed.length === 0) {
      showNotice(
        'Keine gültigen Skript-Regeln erkannt. Skript-Name, Ziel oder Prio-Format prüfen.'
      );
      return;
    }

    const merged = mergeScriptModules(workspace.modules, parsed);
    const nextWs = rebuildPreservingResolutions(merged);
    onUpdateWorkspace(nextWs);
    setSelectedModuleNum(parsed[0].scriptNumber);
    setRawText('');
    setDefaultNumber('');
    setDefaultName('');
    showNotice(`${parsed.length} Skript-Modul(e) in die Gesamtkarte integriert.`);
  };

  const handleFilesProcess = async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    if (fileArr.length === 0) return;

    let currentModules = [...workspace.modules];
    let parsedCount = 0;
    let visioFilesCount = 0;
    let dotSFilesCount = 0;
    const failedFiles: string[] = [];

    for (const file of fileArr) {
      const singleTargetOverride =
        fileArr.length === 1 && defaultNumber.trim() ? defaultNumber.trim() : undefined;
      try {
        const result = await importCallflowFile(file, {
          overridePrimaryScriptNumber: singleTargetOverride,
          overridePrimaryScriptName:
            fileArr.length === 1 && defaultName.trim() ? defaultName.trim() : undefined,
        });
        if (result.modules.length > 0) {
          currentModules = mergeScriptModules(currentModules, result.modules);
          parsedCount += result.modules.length;
          if (result.sourceKind === 'visio') visioFilesCount++;
          if (result.sourceKind === 'aacc-s') dotSFilesCount++;
        } else {
          failedFiles.push(file.name);
        }
      } catch {
        failedFiles.push(file.name);
      }
    }

    if (parsedCount === 0) {
      showNotice(
        'In den gewählten Dateien wurden keine .s-Skriptbefehle, Shapes oder Routing-Regeln erkannt.'
      );
      return;
    }

    const nextWs = rebuildPreservingResolutions(currentModules);
    onUpdateWorkspace(nextWs);
    if (nextWs.modules.length > 0) {
      setSelectedModuleNum(nextWs.modules[0].scriptNumber);
    }
    const kindNotes: string[] = [];
    if (dotSFilesCount > 0) kindNotes.push(`${dotSFilesCount} .s-Skript`);
    if (visioFilesCount > 0) kindNotes.push(`${visioFilesCount} grafischer Export`);
    const failedNote =
      failedFiles.length > 0 ? ` · ${failedFiles.length} ohne verwertbare Regeln` : '';
    showNotice(
      `${fileArr.length} Datei(en) mit ${parsedCount} Modul(en)${
        kindNotes.length > 0 ? ` (${kindNotes.join(', ')})` : ''
      } zusammengeführt${failedNote}.`
    );
  };

  const handleLoadSample = () => {
    setRawText(SAMPLE_MULTI_SCRIPT_TEXT);
    const parsed = parseCallflowTextWithFallback(SAMPLE_MULTI_SCRIPT_TEXT);
    const nextWs = buildScriptWorkspace(parsed);
    onUpdateWorkspace(nextWs);
    setSelectedModuleNum(nextWs.modules[0]?.scriptNumber || null);
    showNotice(
      `Beispiel mit ${nextWs.modules.length} verknüpften Skripten geladen.`
    );
  };

  const handleRemoveModule = (scriptNumber: string) => {
    const remaining = workspace.modules.filter((m) => m.scriptNumber !== scriptNumber);
    const nextWs = rebuildPreservingResolutions(remaining);
    onUpdateWorkspace(nextWs);
    if (selectedModuleNum === scriptNumber) {
      setSelectedModuleNum(remaining[0]?.scriptNumber || null);
    }
  };

  const handleClearAll = () => {
    onUpdateWorkspace(buildScriptWorkspace([]));
    setSelectedModuleNum(null);
    showNotice('Skript-Liste geleert.');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-5">
      <div className="w-full max-w-6xl h-[92vh] sm:h-[86vh] bg-slate-900 border-t sm:border border-slate-800 rounded-t-2xl sm:rounded-xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
              <h2 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
                Skripte &amp; grafische Avaya-Exporte verwalten
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-0.5 tabular-nums">
              <span>Text-Skripte &amp; Visio-Exporte (.vsdx, .vdx, .svg) automatisch in einer Karte</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300 font-mono">
                {workspace.modules.length} Module · {totalRuleCount} Regeln
                {(workspace.openIssueCount || 0) > 0
                  ? ` · ● ${workspace.openIssueCount} Offen`
                  : ''}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dialog schließen"
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2-Column Workspace */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left Column: Import / Upload / Paste */}
          <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-slate-800 bg-slate-950/60 p-4 sm:p-5 flex flex-col gap-3.5 overflow-y-auto">
            {/* Multi-File Drag & Drop (Visio + Text) */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFiles(true);
              }}
              onDragLeave={() => setIsDraggingFiles(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingFiles(false);
                if (e.dataTransfer.files) {
                  void handleFilesProcess(e.dataTransfer.files);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                isDraggingFiles
                  ? 'border-indigo-400 bg-indigo-950/40'
                  : 'border-slate-700 hover:border-indigo-500/70 bg-slate-900/70'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={CALLFLOW_FILE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    void handleFilesProcess(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
              <FolderUp className="w-5 h-5 text-indigo-400 mx-auto mb-1.5" />
              <div className="text-xs font-medium text-slate-200">
                Avaya `.s`-Skripte, Textdateien oder Visio-Exporte hier ablegen
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Mehrere `.s` / `.txt` / `.vsdx` / `.svg`-Dateien werden automatisch dekodiert und verknüpft
              </div>
            </div>

            {/* Optional Default Header for Single Text Paste */}
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <label className="text-[11px] text-slate-400 block mb-1">
                  Skript-Name / Nr.
                </label>
                <input
                  type="text"
                  value={defaultNumber}
                  onChange={(e) => setDefaultNumber(e.target.value.trimStart())}
                  placeholder="z. B. Main oder Schaltung1"
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[11px] text-slate-400 block mb-1">
                  Skript-Name (optional)
                </label>
                <input
                  type="text"
                  value={defaultName}
                  onChange={(e) => setDefaultName(e.target.value)}
                  placeholder="z.B. Vertrieb & Neukunden"
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Raw Text Area */}
            <div className="flex-1 min-h-[170px] flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-medium text-slate-300">
                  Skript-Text / Teil-Skripte einfügen
                </label>
                <button
                  type="button"
                  onClick={handleLoadSample}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Beispiel laden (Master + 7 Skripte)</span>
                </button>
              </div>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                spellCheck={false}
                placeholder={`Freitext, AACC-Skripte (CDN / section Init / assign ... to Sys_*) oder Blöcke:\n\n=== Main ===\nPrio 1 | Zeitplan Mo-Fr | Wohin: Schaltung1\n\n=== Schaltung1 ===\nTaste 1 -> Vertrieb_VIP, Taste 2 -> 3757`}
                className="flex-1 min-h-[150px] w-full p-3 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 resize-none leading-relaxed select-text"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!rawText.trim()}
                onClick={handleImportText}
                className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>Text einlesen &amp; hinzufügen</span>
              </button>
              {workspace.modules.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="py-2 px-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                >
                  Liste leeren
                </button>
              )}
            </div>

            {statusMsg && (
              <div className="px-3 py-2 rounded-lg bg-slate-900 border border-indigo-500/40 text-xs text-indigo-200 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>{statusMsg}</span>
              </div>
            )}
          </div>

          {/* Right Column: Parsed Script Inventory & Rule Inspection */}
          <div className="lg:col-span-7 p-4 sm:p-5 flex flex-col gap-3.5 overflow-y-auto bg-slate-900/50">
            {workspace.missingTargets.length > 0 && (
              <div className="px-3.5 py-2.5 rounded-xl bg-amber-950/35 border border-amber-500/40 text-xs text-amber-200 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">
                    {workspace.missingTargets.length} referenzierte Zielnummer(n) noch nicht importiert:
                  </span>{' '}
                  <span className="font-mono text-amber-300 tabular-nums">
                    {workspace.missingTargets.map((n) => `[${n}]`).join(', ')}
                  </span>
                  <span className="block text-[11px] text-amber-200/80 mt-0.5">
                    Im Master-Callflow werden diese automatisch als fehlende Ziel-Knoten markiert.
                  </span>
                </div>
              </div>
            )}

            {workspace.modules.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-slate-800 rounded-xl bg-slate-950/50">
                <FileText className="w-8 h-8 text-slate-600 mb-2.5" />
                <div className="text-sm font-semibold text-slate-200">
                  Noch keine Teil-Skripte eingelesen
                </div>
                <p className="text-xs text-slate-400 max-w-md mt-1 leading-relaxed">
                  Laden Sie links Ihre einzelnen Text-Skripte oder grafischen Exporte (oder das
                  Beispiel mit <span className="font-mono text-slate-200">Main</span> +
                  Folgeskripten). Die App verknüpft alle freien Skriptnamen und Zielnummern
                  automatisch in eine übersichtliche <strong>Ebene 1 (Master)</strong> und{' '}
                  <strong>Ebene 2 (Skript-Detail)</strong>.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {workspace.modules.map((mod) => {
                    const isSelected = inspectedModule?.scriptNumber === mod.scriptNumber;
                    const openCount = openIssueCountByScript.get(mod.scriptNumber) || 0;
                    const originText =
                      mod.origin === 'visio-new' ? 'Grafischer Export' : 'Text-Skript';
                    return (
                      <div
                        key={mod.scriptNumber}
                        onClick={() => setSelectedModuleNum(mod.scriptNumber)}
                        className={`p-3 rounded-xl border transition-colors cursor-pointer flex flex-col justify-between gap-2 ${
                          isSelected
                            ? 'bg-indigo-950/35 border-indigo-500/70'
                            : openCount > 0
                            ? 'bg-slate-950/70 border-rose-500/50 hover:border-rose-400'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {openCount > 0 && (
                                <span
                                  className="w-2.5 h-2.5 rounded-full bg-rose-600 shrink-0"
                                  title={`${openCount} offene(r) Punkt(e)`}
                                />
                              )}
                              <span className="font-mono text-xs font-bold text-indigo-300 tabular-nums">
                                [{mod.scriptNumber}]
                              </span>
                              <span className="text-xs font-semibold text-slate-100 truncate">
                                {mod.scriptName}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 font-mono tabular-nums flex flex-wrap items-center gap-1.5">
                              <span
                                className={
                                  mod.origin === 'visio-new'
                                    ? 'text-emerald-400'
                                    : 'text-slate-400'
                                }
                              >
                                {originText}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {mod.rules.length} Regeln · {mod.outgoingNumbers.length} Ziele
                              </span>
                              {openCount > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-rose-400 font-semibold">
                                    {openCount} offen
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveModule(mod.scriptNumber);
                            }}
                            title="Skript entfernen"
                            className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                          <span className="text-[11px] font-mono text-slate-500 truncate tabular-nums">
                            {mod.outgoingNumbers.length > 0
                              ? `→ ${mod.outgoingNumbers.join(', ')}`
                              : 'Endpunkt (keine Sprünge)'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenScriptDetail(mod.scriptNumber, workspace);
                              onClose();
                            }}
                            className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <span>Ebene 2 öffnen</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Selected Module Rule Details */}
                {inspectedModule && (
                  <div className="border border-slate-800 rounded-xl bg-slate-950/80 overflow-hidden">
                    <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-200 font-mono tabular-nums">
                        [{inspectedModule.scriptNumber}] {inspectedModule.scriptName} — Prio-Regeln
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenScriptDetail(inspectedModule.scriptNumber, workspace);
                          onClose();
                        }}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px] font-medium rounded-md transition-colors cursor-pointer"
                      >
                        Als Detail-Diagramm anzeigen →
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-900/90 text-[11px] text-slate-400 border-b border-slate-800">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Prio</th>
                            <th className="px-3 py-1.5 font-medium">Schritt-Name</th>
                            <th className="px-3 py-1.5 font-medium">Wohin</th>
                            <th className="px-3 py-1.5 font-medium">Auswahl-Nummern</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {inspectedModule.rules.map((rule) => {
                            const contextDetails = [
                              rule.sectionName ? `Abschnitt: ${rule.sectionName}` : null,
                              rule.eventName ? `Event: ${rule.eventName}` : null,
                              rule.queueTarget
                                ? `Queue: ${rule.queueTarget}${
                                    rule.skillsetPriority !== undefined
                                      ? ` (Prio ${rule.skillsetPriority})`
                                      : ''
                                  }`
                                : null,
                              rule.schedule ? `Zeitplan: ${rule.schedule}` : null,
                              rule.holiday ? `Feiertag: ${rule.holiday}` : null,
                              rule.condition ? `Bedingung: ${rule.condition}` : null,
                              rule.announcement ? `Ansage: ${rule.announcement}` : null,
                              rule.waitSeconds !== undefined ? `Wartezeit: ${rule.waitSeconds}s` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ');

                            return (
                              <tr key={rule.id} className="hover:bg-slate-900/50 align-top">
                                <td className="px-3 py-1.5 font-mono text-indigo-300 tabular-nums">
                                  P{rule.prio}
                                </td>
                                <td className="px-3 py-1.5 text-slate-200">
                                  <div>{rule.stepName}</div>
                                  {contextDetails && (
                                    <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                                      {contextDetails}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-emerald-300 tabular-nums">
                                  {rule.targetNumber || '–'}
                                </td>
                                <td className="px-3 py-1.5 font-mono text-slate-400 tabular-nums">
                                  {rule.choices.length > 0
                                    ? rule.choices
                                        .map((c) => `${c.choice}→${c.targetNumber}`)
                                        .join(', ')
                                    : '–'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-800 bg-slate-950/90 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <span className="text-xs text-slate-400">
            Ebene 1 zeigt nur Skript-Verknüpfungen · Klick auf ein Skript öffnet Ebene 2 mit allen Prio- &amp; Auswahl-Regeln
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors cursor-pointer"
            >
              Schließen
            </button>
            <button
              type="button"
              disabled={workspace.modules.length === 0}
              onClick={() => {
                onApplyMasterView(workspace);
                onClose();
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Master-Callflow (Ebene 1) übernehmen</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
