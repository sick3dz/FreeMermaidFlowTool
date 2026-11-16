import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  FolderUp,
  ListChecks,
  Plus,
  X,
} from 'lucide-react';
import {
  ScriptManualLink,
  ScriptModule,
  ScriptWorkspace,
} from '../types/mermaidStudio';
import {
  buildScriptWorkspace,
  canonicalScriptMatchKey,
  detectMasterScriptChecklist,
  normalizeScriptRef,
  parseCallflowTextWithFallback,
} from '../utils/scriptCallflowParser';
import { isVisioFilename, parseVisioFileToModules } from '../utils/visioParser';

export type MasterTargetDecision = 'request' | 'external' | 'ignore' | 'present';

interface DraftConfirmedTarget {
  refKey: string;
  displayName: string;
  contextLabel: string;
  decision: MasterTargetDecision;
  isAlreadyPresent?: boolean;
  isManualAdd?: boolean;
}

interface NewCallflowModalProps {
  isOpen: boolean;
  hasExistingWorkspace: boolean;
  onClose: () => void;
  onStartNewCallflow: (payload: { title: string; workspace: ScriptWorkspace }) => void;
}

export const NewCallflowModal: React.FC<NewCallflowModalProps> = ({
  isOpen,
  hasExistingWorkspace,
  onClose,
  onStartNewCallflow,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [rawMasterText, setRawMasterText] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [parsedModules, setParsedModules] = useState<ScriptModule[]>([]);
  const [activeMasterNumber, setActiveMasterNumber] = useState<string>('Main');
  const [draftTargets, setDraftTargets] = useState<DraftConfirmedTarget[]>([]);
  const [manualTargetInput, setManualTargetInput] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const resetAllAndClose = () => {
    setStep(1);
    setRawMasterText('');
    setErrorMsg(null);
    setParsedModules([]);
    setActiveMasterNumber('Main');
    setDraftTargets([]);
    setManualTargetInput('');
    onClose();
  };

  const prepareStep2FromModules = (modules: ScriptModule[]) => {
    const mainIdx = modules.findIndex(
      (m) => canonicalScriptMatchKey(m.scriptNumber) === 'main' || m.isMaster
    );
    const primaryIdx = mainIdx >= 0 ? mainIdx : 0;

    const normalizedModules = modules.map((m, idx) => {
      if (idx !== primaryIdx) return m;
      return {
        ...m,
        scriptNumber: 'Main',
        scriptName: 'Main',
        isMaster: true,
        rules: m.rules.map((r) => ({ ...r, sourceNumber: 'Main' })),
        outgoingNumbers: m.outgoingNumbers.filter(
          (t) => canonicalScriptMatchKey(t) !== 'main'
        ),
      };
    });

    const previewChecklist = detectMasterScriptChecklist(
      normalizedModules,
      [],
      [],
      'Main',
      []
    );

    const targets: DraftConfirmedTarget[] = previewChecklist.masterChecklist.map((item) => ({
      refKey: item.refKey,
      displayName: item.displayName,
      contextLabel: item.contextLabel,
      decision: item.status === 'present' ? 'present' : 'request',
      isAlreadyPresent: item.status === 'present',
    }));

    setParsedModules(normalizedModules);
    setActiveMasterNumber('Main');
    setDraftTargets(targets);
    setErrorMsg(null);
    setStep(2);
  };

  const handleAnalyzeMasterText = () => {
    const trimmed = rawMasterText.trim();
    if (!trimmed) {
      setErrorMsg(
        'Bitte zuerst den Text für „Main“ einfügen oder einen grafischen Export wählen.'
      );
      return;
    }

    const modules = parseCallflowTextWithFallback(trimmed, {
      defaultScriptNumber: 'Main',
      defaultScriptName: 'Main',
      origin: 'legacy-text',
      isMasterHint: true,
    });

    if (modules.length === 0) {
      setErrorMsg('Im eingefügten Text konnten keine verwertbaren Zeilen erkannt werden.');
      return;
    }

    prepareStep2FromModules(modules);
  };

  const handleImportVisioOrTextFile = async (file: File) => {
    setErrorMsg(null);
    setIsParsingFile(true);
    try {
      if (isVisioFilename(file.name)) {
        const mods = await parseVisioFileToModules(file, {
          overridePrimaryScriptNumber: 'Main',
        });
        if (mods.length === 0) {
          setErrorMsg(`In „${file.name}“ wurden keine grafischen Elemente erkannt.`);
          return;
        }
        prepareStep2FromModules(mods);
      } else {
        const text = await file.text();
        setRawMasterText(text);
        const mods = parseCallflowTextWithFallback(text, {
          defaultScriptNumber: 'Main',
          defaultScriptName: 'Main',
          sourceFilename: file.name,
          origin: 'legacy-text',
          isMasterHint: true,
        });
        if (mods.length === 0) {
          setErrorMsg(`In „${file.name}“ konnten keine Regeln erkannt werden.`);
          return;
        }
        prepareStep2FromModules(mods);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? `Fehler beim Einlesen: ${err.message}`
          : 'Datei konnte nicht gelesen werden.'
      );
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleAddManualTarget = () => {
    const clean = normalizeScriptRef(manualTargetInput);
    if (!clean) return;
    const key = canonicalScriptMatchKey(clean);
    if (key === canonicalScriptMatchKey(activeMasterNumber)) return;
    const existingDraft = draftTargets.find(
      (t) => canonicalScriptMatchKey(t.refKey) === key
    );
    if (existingDraft) {
      if (!existingDraft.isAlreadyPresent) {
        setDraftTargets((prev) =>
          prev.map((t) =>
            canonicalScriptMatchKey(t.refKey) === key ? { ...t, decision: 'request' } : t
          )
        );
      }
      setManualTargetInput('');
      return;
    }

    setDraftTargets((prev) => [
      ...prev,
      {
        refKey: clean,
        displayName: clean,
        contextLabel: 'Manuell bestätigt',
        decision: 'request',
        isManualAdd: true,
      },
    ]);
    setManualTargetInput('');
  };

  const handleConfirmAndStart = () => {
    const externalEndpoints = draftTargets
      .filter((t) => t.decision === 'external')
      .map((t) => t.refKey);
    const ignoredChecklistTargets = draftTargets
      .filter((t) => t.decision === 'ignore')
      .map((t) => t.refKey);
    const manualLinks: ScriptManualLink[] = draftTargets
      .filter((t) => t.isManualAdd && t.decision !== 'ignore')
      .map((t, idx) => ({
        id: `mstart-${Date.now()}-${idx}`,
        fromScriptNumber: activeMasterNumber,
        toTargetNumber: t.refKey,
        label: 'Im Start-Assistent ergänzt',
      }));

    const workspace = buildScriptWorkspace(parsedModules, {
      externalEndpoints,
      ignoredChecklistTargets,
      manualLinks,
      masterScriptNumber: 'Main',
    });

    onStartNewCallflow({
      title: 'Main',
      workspace,
    });
    resetAllAndClose();
  };

  const requestedCount = draftTargets.filter((t) => t.decision === 'request').length;
  const presentCount = draftTargets.filter((t) => t.decision === 'present').length;
  const externalCount = draftTargets.filter((t) => t.decision === 'external').length;
  const ignoredCount = draftTargets.filter((t) => t.decision === 'ignore').length;
  const hasRequestableTargets = draftTargets.some((t) => !t.isAlreadyPresent);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Neuer Callflow Assistent"
    >
      <div className="w-full max-w-3xl max-h-[92dvh] flex flex-col bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800 bg-slate-950 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
              Neuer Callflow
            </h2>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
              <span className={step === 1 ? 'text-indigo-400 font-semibold' : 'text-emerald-400'}>
                01. Main (Masterscript)
              </span>
              <span aria-hidden="true">·</span>
              <span className={step === 2 ? 'text-indigo-400 font-semibold' : 'text-slate-500'}>
                02. Ziele bestätigen
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={resetAllAndClose}
            title="Schließen"
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {step === 1 ? (
            <>
              {hasExistingWorkspace && (
                <div className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Beim Start eines neuen Callflows wird der aktuelle Arbeitsbereich durch das neue
                    Masterscript <span className="font-mono text-slate-100">Main</span> ersetzt.
                  </span>
                </div>
              )}

              {/* Automatic File / Visio Upload Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingFile(true);
                }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingFile(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleImportVisioOrTextFile(file);
                }}
                className={`p-3.5 rounded-xl border transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isDraggingFile
                    ? 'bg-indigo-950/40 border-indigo-500'
                    : 'bg-slate-950 border-slate-800'
                }`}
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-semibold text-slate-100">
                    Masterscript „Main“ als grafischen Avaya-Export oder Datei laden
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Grafische Exporte (`.vsdx`, `.vdx`, `.svg`) oder Textdateien (`.txt`, `.aacc`)
                    werden automatisch erkannt.
                  </p>
                </div>
                <div className="shrink-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".vsdx,.vdx,.svg,.xml,.txt,.aacc"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void handleImportVisioOrTextFile(file);
                    }}
                  />
                  <button
                    type="button"
                    disabled={isParsingFile}
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{isParsingFile ? 'Lese Datei...' : 'Export / Datei wählen'}</span>
                  </button>
                </div>
              </div>

              {/* Raw Text Input */}
              <div className="space-y-2">
                <span className="text-xs font-medium text-slate-200 block">
                  Oder Text-Skript für <span className="font-mono text-indigo-300">Main</span>{' '}
                  direkt einfügen
                </span>

                <textarea
                  rows={9}
                  value={rawMasterText}
                  onChange={(e) => {
                    setRawMasterText(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder={`Text für „Main“ hier einfügen...\nBeispiel:\nPrio 1 | Zeitplan Mo-Fr | Wohin: Schaltung1\nPrio 2 | Feiertag | Ziel: Feiertag_Ansage\nTaste 1 -> Vertrieb_VIP\nTaste 2 -> 3757`}
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none resize-y"
                />
              </div>

              {errorMsg && (
                <div className="px-3 py-2 rounded-lg bg-rose-950/50 border border-rose-800/70 text-xs text-rose-300">
                  {errorMsg}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Step 2: Confirm Extracted Targets */}
              <div className="px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ListChecks className="w-4 h-4 text-indigo-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-100 truncate">
                      Masterscript: <span className="font-mono">{activeMasterNumber}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                      {parsedModules.reduce((acc, m) => acc + m.rules.length, 0)} Regeln ·{' '}
                      {requestedCount} angefordert
                      {presentCount > 0 ? ` · ${presentCount} geladen` : ''} · {externalCount}{' '}
                      extern · {ignoredCount} ignoriert
                    </div>
                  </div>
                </div>

                {hasRequestableTargets && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraftTargets((prev) =>
                        prev.map((t) =>
                          t.isAlreadyPresent ? t : { ...t, decision: 'request' }
                        )
                      )
                    }
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Alle anfordern
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Prüfen und haken Sie einzeln ab, welche erkannten Ziel-Skripte das Tool anschließend
                Schritt für Schritt von oben nach unten abfragen soll:
              </p>

              {draftTargets.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 space-y-2">
                  <p>
                    Im Masterscript wurden automatisch keine weiteren Ziel-Skripte erkannt. Sie
                    können unten direkt Ziel-Skripte manuell ergänzen oder direkt mit der Karte
                    starten.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[42dvh] overflow-y-auto pr-0.5">
                  {draftTargets.map((item, idx) => {
                    const isPresent = item.decision === 'present';
                    const isRequested = item.decision === 'request';
                    const isExternal = item.decision === 'external';
                    const isIgnored = item.decision === 'ignore';

                    return (
                      <div
                        key={item.refKey}
                        className={`px-3 py-2.5 rounded-xl border transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                          isPresent
                            ? 'bg-emerald-950/20 border-emerald-800/50'
                            : isRequested
                            ? 'bg-slate-950 border-slate-800'
                            : isExternal
                            ? 'bg-slate-950/70 border-slate-800/80'
                            : 'bg-slate-950/40 border-slate-800/50 opacity-65'
                        }`}
                      >
                        <label
                          className={`flex items-start sm:items-center gap-2.5 min-w-0 flex-1 ${
                            isPresent ? '' : 'cursor-pointer'
                          }`}
                        >
                          {isPresent ? (
                            <CheckCircle2 className="mt-0.5 sm:mt-0 w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <input
                              type="checkbox"
                              checked={!isIgnored}
                              onChange={(e) => {
                                const nextDecision: MasterTargetDecision = e.target.checked
                                  ? 'request'
                                  : 'ignore';
                                setDraftTargets((prev) =>
                                  prev.map((t) =>
                                    canonicalScriptMatchKey(t.refKey) ===
                                    canonicalScriptMatchKey(item.refKey)
                                      ? { ...t, decision: nextDecision }
                                      : t
                                  )
                                );
                              }}
                              className="mt-0.5 sm:mt-0 w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 shrink-0 cursor-pointer"
                            />
                          )}
                          <span className="text-[11px] font-mono tabular-nums text-slate-500 w-6 shrink-0">
                            {String(idx + 1).padStart(2, '0')}.
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-mono font-semibold text-slate-100 truncate">
                              {item.refKey}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              {item.contextLabel}
                            </div>
                          </div>
                        </label>

                        {isPresent ? (
                          <span className="px-2.5 py-1 text-[11px] font-mono font-medium text-emerald-300 bg-emerald-950/50 border border-emerald-700/50 rounded-md whitespace-nowrap shrink-0">
                            Bereits geladen ✓
                          </span>
                        ) : (
                          <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-900 border border-slate-800 rounded-lg shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setDraftTargets((prev) =>
                                  prev.map((t) =>
                                    canonicalScriptMatchKey(t.refKey) ===
                                    canonicalScriptMatchKey(item.refKey)
                                      ? { ...t, decision: 'request' }
                                      : t
                                  )
                                )
                              }
                              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                isRequested
                                  ? 'bg-indigo-600 text-white'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              Anfordern
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDraftTargets((prev) =>
                                  prev.map((t) =>
                                    canonicalScriptMatchKey(t.refKey) ===
                                    canonicalScriptMatchKey(item.refKey)
                                      ? { ...t, decision: 'external' }
                                      : t
                                  )
                                )
                              }
                              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                isExternal
                                  ? 'bg-emerald-600 text-white'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              Extern
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDraftTargets((prev) =>
                                  prev.map((t) =>
                                    canonicalScriptMatchKey(t.refKey) ===
                                    canonicalScriptMatchKey(item.refKey)
                                      ? { ...t, decision: 'ignore' }
                                      : t
                                  )
                                )
                              }
                              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                isIgnored
                                  ? 'bg-slate-700 text-slate-100'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              Ignorieren
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add another target manually */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={manualTargetInput}
                  onChange={(e) => setManualTargetInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddManualTarget();
                    }
                  }}
                  placeholder="Fehlendes Ziel ergänzen (z. B. Schaltung1 oder 3757)..."
                  className="flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddManualTarget}
                  disabled={!manualTargetInput.trim()}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Ergänzen</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-2 shrink-0">
          {step === 1 ? (
            <>
              <button
                type="button"
                onClick={resetAllAndClose}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleAnalyzeMasterText}
                disabled={!rawMasterText.trim() || isParsingFile}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Masterscript analysieren</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Zurück</span>
              </button>

              <button
                type="button"
                onClick={handleConfirmAndStart}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {requestedCount > 0
                    ? `Bestätigen (${requestedCount}) & Live-Karte starten`
                    : 'Bestätigen & Live-Karte starten'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
