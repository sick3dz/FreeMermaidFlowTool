import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  FolderSearch,
  FolderUp,
  ListChecks,
  Plus,
  Search,
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
  isAnnouncementOrEndpointTargetName,
  normalizeScriptRef,
  parseCallflowTextWithFallback,
  promoteEntryModuleToMain,
} from '../utils/scriptCallflowParser';
import {
  CALLFLOW_CHECKLIST_ACCEPT,
  FolderAutoResolveSummary,
  FolderScriptFileEntry,
  FolderScriptPool,
  autoResolveConnectedScriptsFromFolder,
  extractFilesFromDataTransfer,
  importCallflowFile,
  indexScriptFolderFiles,
} from '../utils/callflowFileImporter';

export type MasterTargetDecision = 'request' | 'external' | 'ignore' | 'present';

interface DraftConfirmedTarget {
  refKey: string;
  displayName: string;
  contextLabel: string;
  triggeredNumbers?: string[];
  decision: MasterTargetDecision;
  isAlreadyPresent?: boolean;
  isManualAdd?: boolean;
}

interface NewCallflowModalProps {
  isOpen: boolean;
  hasExistingWorkspace: boolean;
  onClose: () => void;
  onStartNewCallflow: (payload: {
    title: string;
    workspace: ScriptWorkspace;
    folderPool?: FolderScriptPool | null;
    folderSummary?: FolderAutoResolveSummary | null;
  }) => void;
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

  // Assigned Folder Pool (.s directory with 600+ files)
  const [folderPool, setFolderPool] = useState<FolderScriptPool | null>(null);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [folderResolveSummary, setFolderResolveSummary] =
    useState<FolderAutoResolveSummary | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputStep1Ref = useRef<HTMLInputElement | null>(null);
  const folderInputStep2Ref = useRef<HTMLInputElement | null>(null);

  const filteredFolderEntries = useMemo(() => {
    if (!folderPool) return [];
    const q = folderSearchQuery.trim().toLowerCase();
    const list = q
      ? folderPool.entries.filter(
          (e) =>
            e.baseName.toLowerCase().includes(q) ||
            e.filename.toLowerCase().includes(q) ||
            e.relativePath.toLowerCase().includes(q)
        )
      : folderPool.entries;
    return list.slice(0, 120);
  }, [folderPool, folderSearchQuery]);

  if (!isOpen) return null;

  const resetAllAndClose = () => {
    setStep(1);
    setRawMasterText('');
    setErrorMsg(null);
    setParsedModules([]);
    setActiveMasterNumber('Main');
    setDraftTargets([]);
    setManualTargetInput('');
    setFolderPool(null);
    setFolderSearchQuery('');
    setFolderResolveSummary(null);
    onClose();
  };

  const prepareStep2FromModules = async (
    modules: ScriptModule[],
    activePool?: FolderScriptPool | null
  ) => {
    const mainIdx = modules.findIndex(
      (m) => canonicalScriptMatchKey(m.scriptNumber) === 'main' || m.isMaster
    );
    const primaryIdx = mainIdx >= 0 ? mainIdx : 0;
    const rawPrimaryNumber = modules[primaryIdx]?.scriptNumber || 'Main';
    let normalizedModules = promoteEntryModuleToMain(modules, rawPrimaryNumber);
    const primaryScriptNumber = 'Main';

    const effectivePool = activePool !== undefined ? activePool : folderPool;
    let resolveSummary: FolderAutoResolveSummary | null = null;

    if (effectivePool && effectivePool.entries.length > 0) {
      resolveSummary = await autoResolveConnectedScriptsFromFolder(
        normalizedModules,
        effectivePool,
        {
          masterScriptNumber: primaryScriptNumber,
        }
      );
      normalizedModules = resolveSummary.modules;
      setFolderResolveSummary(resolveSummary);
    }

    const previewChecklist = detectMasterScriptChecklist(
      normalizedModules,
      [],
      [],
      primaryScriptNumber,
      []
    );

    const isFullExportOrFolderResolved =
      Boolean(effectivePool && effectivePool.entries.length > 0) ||
      normalizedModules.length >= 2;

    const targets: DraftConfirmedTarget[] = previewChecklist.masterChecklist.map((item) => {
      const isPresent = item.status === 'present';
      const autoEndpoint =
        !isPresent &&
        (isFullExportOrFolderResolved ||
          isAnnouncementOrEndpointTargetName(item.refKey) ||
          isAnnouncementOrEndpointTargetName(item.displayName));
      return {
        refKey: item.refKey,
        displayName: item.displayName,
        contextLabel: item.contextLabel,
        triggeredNumbers: item.triggeredNumbers,
        decision: isPresent ? 'present' : autoEndpoint ? 'external' : 'request',
        isAlreadyPresent: isPresent,
      };
    });

    setParsedModules(normalizedModules);
    setActiveMasterNumber(primaryScriptNumber);
    setDraftTargets(targets);
    setErrorMsg(null);
    setStep(2);
  };

  const handleAnalyzeMasterText = async () => {
    const trimmed = rawMasterText.trim();
    if (!trimmed) {
      setErrorMsg(
        'Bitte zuerst den Skript-Text einfügen oder eine Export-Datei (.s, .txt, .vsdx) bzw. einen Skript-Ordner wählen.'
      );
      return;
    }

    setIsParsingFile(true);
    try {
      const modules = parseCallflowTextWithFallback(trimmed, {
        origin: 'legacy-text',
        isMasterHint: true,
      });

      if (modules.length === 0) {
        setErrorMsg('Im eingefügten Text konnten keine verwertbaren Zeilen erkannt werden.');
        return;
      }

      await prepareStep2FromModules(modules, folderPool);
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleImportVisioOrTextFile = async (
    file: File,
    overridePool?: FolderScriptPool | null
  ) => {
    setErrorMsg(null);
    setIsParsingFile(true);
    try {
      const result = await importCallflowFile(file, {
        isMasterHint: true,
      });
      if (result.decodedText !== undefined) {
        setRawMasterText(result.decodedText);
      }
      if (result.modules.length === 0) {
        setErrorMsg(
          result.sourceKind === 'visio'
            ? `In „${file.name}“ wurden keine grafischen Elemente erkannt.`
            : `In „${file.name}“ konnten keine Avaya-OCL-Befehle oder Routing-Regeln erkannt werden.`
        );
        return;
      }
      await prepareStep2FromModules(
        result.modules,
        overridePool !== undefined ? overridePool : folderPool
      );
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

  const handleAssignFolderInStep1 = async (files: FileList | File[]) => {
    setErrorMsg(null);
    const pool = indexScriptFolderFiles(files);
    if (pool.entries.length === 0) {
      setErrorMsg(
        'Im gewählten Ordner wurden keine unterstützten Skriptdateien (.s, .txt, .aacc, .vsdx) gefunden.'
      );
      return;
    }
    setFolderPool(pool);
    setFolderResolveSummary(null);

    // If rawMasterText is already filled in, automatically analyze it and resolve all linked .s files from the folder!
    if (rawMasterText.trim()) {
      setIsParsingFile(true);
      try {
        const modules = parseCallflowTextWithFallback(rawMasterText.trim(), {
          origin: 'legacy-text',
          isMasterHint: true,
        });
        if (modules.length > 0) {
          await prepareStep2FromModules(modules, pool);
        }
      } finally {
        setIsParsingFile(false);
      }
    }
  };

  const handleSelectStartEntryFromFolder = async (entry: FolderScriptFileEntry) => {
    if (!folderPool) return;
    await handleImportVisioOrTextFile(entry.file, folderPool);
  };

  const handleAssignFolderAndAutoResolveInStep2 = async (files: FileList | File[]) => {
    setErrorMsg(null);
    const pool = indexScriptFolderFiles(files);
    if (pool.entries.length === 0) {
      setErrorMsg(
        'Im gewählten Ordner wurden keine unterstützten Skriptdateien (.s, .txt, .aacc, .vsdx) gefunden.'
      );
      return;
    }
    setFolderPool(pool);
    setIsParsingFile(true);
    try {
      await prepareStep2FromModules(parsedModules, pool);
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleAddManualTarget = async () => {
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
      masterScriptNumber: activeMasterNumber,
      treatUnresolvedAsEndpoint: Boolean(folderPool) || parsedModules.length >= 2,
    });

    const primaryMod =
      parsedModules.find(
        (m) => canonicalScriptMatchKey(m.scriptNumber) === canonicalScriptMatchKey(activeMasterNumber)
      ) || parsedModules[0];

    onStartNewCallflow({
      title: 'Main (Einstiegsskript)',
      workspace,
      folderPool,
      folderSummary: folderResolveSummary,
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
                01. Start-Skript oder Skript-Ordner wählen
              </span>
              <span aria-hidden="true">·</span>
              <span className={step === 2 ? 'text-indigo-400 font-semibold' : 'text-slate-500'}>
                02. Automatisch abgeglichene Kette bestätigen
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
                    Beim Start eines neuen Callflows wird der aktuelle Arbeitsbereich durch das neu
                    importierte Start-Skript ersetzt. Alle Skripte behalten ihre echte Nummer /
                    Bezeichnung und verbinden sich logisch anhand ihrer Sprungbefehle.
                  </span>
                </div>
              )}

              {/* Automatic File / Folder Upload Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingFile(true);
                }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={async (e) => {
                  e.preventDefault();
                  setIsDraggingFile(false);
                  const extracted = await extractFilesFromDataTransfer(e.dataTransfer);
                  if (extracted.hasDirectory || extracted.files.length > 1) {
                    await handleAssignFolderInStep1(extracted.files);
                  } else if (extracted.files.length === 1) {
                    await handleImportVisioOrTextFile(extracted.files[0]);
                  }
                }}
                className={`p-3.5 rounded-xl border transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isDraggingFile
                    ? 'bg-indigo-950/40 border-indigo-500'
                    : 'bg-slate-950 border-slate-800'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-100">
                    Einstiegsskript „Main“ (`.s` / Visio) laden oder Skript-Ordner zuweisen
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Ihr zuerst geladenes Startskript wird unabhängig vom Dateinamen fest als <strong className="text-slate-200">Main</strong> geführt (Ebene 1 zeigt die <strong className="text-slate-200">Master-Gesamtkarte</strong> aller Skripte). Bei zugewiesenem Skript-Ordner lädt das Tool automatisch <strong className="text-slate-200">nur die verknüpften Folgeskripte rekursiv</strong> nach.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={CALLFLOW_CHECKLIST_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void handleImportVisioOrTextFile(file);
                    }}
                  />
                  <input
                    ref={(el) => {
                      folderInputStep1Ref.current = el;
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
                        void handleAssignFolderInStep1(Array.from(files));
                      }
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    disabled={isParsingFile}
                    onClick={() => folderInputStep1Ref.current?.click()}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderSearch className="w-3.5 h-3.5" />
                    <span>Skript-Ordner zuweisen (.s Auto-Suche)</span>
                  </button>
                  <button
                    type="button"
                    disabled={isParsingFile}
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{isParsingFile ? 'Lese...' : 'Einzelne Start-Datei'}</span>
                  </button>
                </div>
              </div>

              {/* Assigned Folder Pool Start-Script Picker */}
              {folderPool && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-indigo-500/50 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold text-indigo-200 flex items-center gap-1.5">
                        <FolderSearch className="w-4 h-4 text-indigo-400 shrink-0" />
                        <span>
                          Skript-Ordner „{folderPool.folderName}“ verbunden ({folderPool.totalFilesScanned}{' '}
                          Skript-Dateien erkannt)
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Klicken Sie unten auf Ihr <strong className="text-slate-200">Einstiegsskript</strong> (wird fest als <span className="font-mono text-indigo-300">Main</span> übernommen). Das Tool sucht anschließend alle verknüpften <code className="font-mono text-slate-300">Scriptname.s</code> Dateien automatisch rekursiv aus diesem Ordner.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFolderPool(null);
                        setFolderSearchQuery('');
                      }}
                      className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-md cursor-pointer"
                    >
                      Ordner trennen
                    </button>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={folderSearchQuery}
                      onChange={(e) => setFolderSearchQuery(e.target.value)}
                      placeholder={`Aus ${folderPool.totalFilesScanned} Dateien im Ordner nach Einstiegsskript suchen (z. B. Main, 4910)...`}
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {filteredFolderEntries.map((entry) => (
                      <button
                        key={entry.relativePath}
                        type="button"
                        disabled={isParsingFile}
                        onClick={() => void handleSelectStartEntryFromFolder(entry)}
                        className="px-2.5 py-2 rounded-lg bg-slate-900 hover:bg-indigo-950/60 border border-slate-800 hover:border-indigo-500/50 text-left transition-colors flex items-center justify-between gap-2 cursor-pointer group"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-semibold text-slate-100 group-hover:text-indigo-200 truncate">
                            {entry.baseName}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 truncate">
                            {entry.filename}
                          </div>
                        </div>
                        <span className="text-[10px] font-semibold text-indigo-400 group-hover:text-indigo-200 whitespace-nowrap shrink-0">
                          Als Start →
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw Text Input */}
              <div className="space-y-2">
                <span className="text-xs font-medium text-slate-200 block">
                  Oder Text-Skript direkt einfügen (bei verbundenem Ordner werden die Folgeskripte automatisch nachgeladen)
                </span>

                <textarea
                  rows={folderPool ? 5 : 8}
                  value={rawMasterText}
                  onChange={(e) => {
                    setRawMasterText(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder={`Text für Ihr Einstiegsskript (Main) hier einfügen...\nHinweis: /* ... */ Altlast-Kommentare werden automatisch ignoriert.\n\nBeispiel:\nIF DNIS_Range_Nord THEN assign 100xxxx to src_route_number assign Mandant_Nord to Sys_brand END IF\nVALUE 101 : execute Script Vertrieb_Service\nVALUE 4501 : execute Script Fax_Eingang`}
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
              {/* Step 2: Confirm Extracted Targets & Folder Auto-Match Banner */}
              <div className="px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ListChecks className="w-4 h-4 text-indigo-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-100 truncate">
                      Einstiegsskript: <span className="font-mono text-indigo-300">Main</span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                      {parsedModules.length} Skripte geladen ·{' '}
                      {parsedModules.reduce((acc, m) => acc + m.rules.length, 0)} Regeln ·{' '}
                      {presentCount} automatisch verknüpft · {requestedCount} offen · {externalCount}{' '}
                      extern
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    ref={(el) => {
                      folderInputStep2Ref.current = el;
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
                        void handleAssignFolderAndAutoResolveInStep2(Array.from(files));
                      }
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    disabled={isParsingFile}
                    onClick={() => folderInputStep2Ref.current?.click()}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderSearch className="w-3.5 h-3.5" />
                    <span>
                      {isParsingFile
                        ? 'Gleiche Ordner ab...'
                        : folderPool
                        ? 'Anderen Skript-Ordner abgleichen'
                        : 'Skript-Ordner zuweisen & .s automatisch nachladen'}
                    </span>
                  </button>

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
              </div>

              {folderResolveSummary && (
                <div className="px-3.5 py-2.5 rounded-xl bg-emerald-950/25 border border-emerald-500/40 text-xs space-y-1">
                  <div className="font-semibold text-emerald-300 flex items-center justify-between gap-2">
                    <span>
                      ✓ Automatischer Ordner-Abgleich („{folderResolveSummary.folderName}“) abgeschlossen
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-emerald-400">
                      {folderResolveSummary.totalPoolFiles} Dateien im Ordner geprüft
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-300 font-mono tabular-nums">
                    <strong className="text-emerald-300">
                      {folderResolveSummary.loadedScriptNumbers.length} verknüpfte Folgeskripte (.s)
                    </strong>{' '}
                    rekursiv entlang der Telefonschaltung geladen ·{' '}
                    <span className="text-slate-400">
                      {folderResolveSummary.skippedLegacyFilesCount} nicht aufgerufene Altlast-Dateien
                      automatisch übersprungen
                    </span>
                  </div>
                </div>
              )}

              {errorMsg && (
                <div className="px-3 py-2 rounded-lg bg-rose-950/50 border border-rose-800/70 text-xs text-rose-300">
                  {errorMsg}
                </div>
              )}

              <p className="text-xs text-slate-400 leading-relaxed">
                Prüfen Sie die erkannten Ziel-Skripte entlang der Callflow-Kette (bereits aus dem
                zugewiesenen Ordner gefundene <code className="font-mono text-slate-300">Scriptname.s</code>{' '}
                Dateien sind grün als <strong className="text-emerald-300">Bereits geladen ✓</strong>{' '}
                markiert):
              </p>

              {draftTargets.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 space-y-2">
                  <p>
                    Im Start-Skript wurden automatisch keine weiteren Ziel-Skripte erkannt. Sie
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
                            {item.triggeredNumbers && item.triggeredNumbers.length > 0 && (
                              <div className="text-[10px] font-mono tabular-nums text-indigo-300 truncate mt-0.5">
                                Rufnummern: {item.triggeredNumbers.join(', ')}
                              </div>
                            )}
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
                      void handleAddManualTarget();
                    }
                  }}
                  placeholder="Fehlendes Ziel ergänzen (z. B. Schaltung1 oder 3757)..."
                  className="flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleAddManualTarget()}
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
                onClick={() => void handleAnalyzeMasterText()}
                disabled={!rawMasterText.trim() || isParsingFile}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>
                  {folderPool
                    ? 'Start-Skript analysieren & Ordner abgleichen'
                    : 'Start-Skript analysieren'}
                </span>
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
                  {presentCount > 0
                    ? `Live-Karte mit ${parsedModules.length} Skripten starten`
                    : requestedCount > 0
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

