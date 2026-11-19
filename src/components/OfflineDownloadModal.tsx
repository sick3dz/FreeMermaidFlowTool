import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileCheck2,
  HardDriveDownload,
  Loader2,
  ShieldCheck,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react';
import {
  SavedDiagram,
  ScriptWorkspace,
  SmartColorMode,
  SmartColorNodeType,
  ThemeConfiguration,
} from '../types/mermaidStudio';
import {
  buildAndDownloadOfflineApp,
  isRunningAsOfflineSingleFile,
} from '../utils/offlineAppExporter';

interface OfflineDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  diagramTitle: string;
  code: string;
  themeConfig: ThemeConfiguration;
  smartColorMode: SmartColorMode;
  hiddenSmartNodeTypes?: SmartColorNodeType[];
  canvasSurface: 'dark' | 'light';
  workspaceMode: 'guided' | 'free';
  scriptWorkspace: ScriptWorkspace;
  savedDiagrams: SavedDiagram[];
}

export const OfflineDownloadModal: React.FC<OfflineDownloadModalProps> = ({
  isOpen,
  onClose,
  diagramTitle,
  code,
  themeConfig,
  smartColorMode,
  hiddenSmartNodeTypes = [],
  canvasSurface,
  workspaceMode,
  scriptWorkspace,
  savedDiagrams,
}) => {
  const hasWorkspaceContent =
    code.trim().length > 0 ||
    scriptWorkspace.modules.length > 0 ||
    savedDiagrams.length > 0;

  const [includeSeed, setIncludeSeed] = useState<boolean>(hasWorkspaceContent);
  const [isDownloading, setIsDownloading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIncludeSeed(hasWorkspaceContent);
      setStatusMessage(null);
      setErrorMessage(null);
    }
  }, [isOpen, hasWorkspaceContent]);

  if (!isOpen) return null;

  const alreadyOffline = isRunningAsOfflineSingleFile();
  const safeBaseName =
    diagramTitle
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9äöüß_-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'callflow';

  const suggestedFilename =
    includeSeed && hasWorkspaceContent
      ? `MermaidFree2UseOpen_${safeBaseName}_Offline.html`
      : 'MermaidFree2UseOpen_Offline.html';

  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const shouldIncludeProject = includeSeed && hasWorkspaceContent;
      const result = await buildAndDownloadOfflineApp({
        includeWorkspaceSeed: true,
        seed: shouldIncludeProject
          ? {
              initialShellView: 'studio',
              diagramTitle,
              code,
              themeConfig,
              smartColorMode,
              hiddenSmartNodeTypes,
              canvasSurface,
              workspaceMode,
              scriptWorkspace,
              savedDiagrams,
            }
          : {
              initialShellView: 'studio',
              diagramTitle: 'Neuer Callflow',
              code: '',
              themeConfig,
              smartColorMode,
              hiddenSmartNodeTypes,
              canvasSurface,
              workspaceMode,
              scriptWorkspace: { modules: [], missingTargets: [], updatedAt: Date.now() },
              savedDiagrams: [],
            },
        filename: suggestedFilename,
      });

      const sizeMb = (result.byteSize / (1024 * 1024)).toFixed(2);
      setStatusMessage(
        `Offline-App gespeichert: ${result.filename} (${sizeMb} MB). Einfach per Doppelklick lokal im Browser öffnen.`,
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Offline-Paket konnte nicht erstellt werden.',
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-6">
      <div className="w-full max-w-2xl max-h-[90vh] bg-slate-900 border-t sm:border border-slate-800 rounded-t-2xl sm:rounded-xl flex flex-col overflow-hidden shadow-2xl">
        {/* Mobile Grab Handle */}
        <div className="sm:hidden w-10 h-1.5 bg-slate-700 rounded-full mx-auto mt-2.5 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center shrink-0">
              <HardDriveDownload className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
                Lokale Offline-App &amp; Projekt-Kopie speichern
              </h2>
              <p className="text-xs text-slate-400 truncate mt-0.5">
                Reiner Offline-Betrieb (file://) · 0 Byte Netzwerk · Keine Installation
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Offline-Dialog schließen"
            className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 p-1.5 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto">
          {/* Privacy & Offline Guarantees */}
          <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Vollständig isolierter Einzeldatei-Betrieb für sensible Produktiv-Callflows</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-slate-300 pt-1">
              <div className="flex items-start gap-2">
                <WifiOff className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>Null Internet- oder Schriftarten-Abrufe nach außen</span>
              </div>
              <div className="flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                <span>
                  Inkl. Mermaid v11, ELK, Parser für Avaya-.s-Skripte, Live-Anruf-Simulator,
                  Öffnungszeiten &amp; Exporte
                </span>
              </div>
              <div className="flex items-start gap-2">
                <FileCheck2 className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                <span>Direkt lauffähig in Chrome, Edge &amp; Firefox per Doppelklick</span>
              </div>
            </div>
          </div>

          {alreadyOffline && (
            <div className="px-3.5 py-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Reiner Offline-Modus aktiv (file://): Erstellt direkt aus dieser lokalen
                Datei ohne Server eine Projekt-Momentaufnahme oder eine saubere Offline-App.
              </span>
            </div>
          )}

          {/* Mode Selection */}
          <div className="space-y-2.5">
            <div className="text-xs font-medium text-slate-300">
              Was soll in die heruntergeladene Offline-HTML verpackt werden?
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              <button
                type="button"
                disabled={!hasWorkspaceContent}
                onClick={() => setIncludeSeed(true)}
                className={`p-3.5 rounded-xl border text-left transition-colors flex items-start justify-between gap-3 ${
                  includeSeed && hasWorkspaceContent
                    ? 'bg-emerald-950/30 border-emerald-500/70 text-slate-100'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                } disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      Inkl. aktuellem Callflow &amp; Main-Einstiegsskript
                    </span>
                    {hasWorkspaceContent && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-medium text-emerald-300">
                        Empfohlen
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {hasWorkspaceContent
                      ? `Bettet „${diagramTitle}“ (${scriptWorkspace.modules.length} Module, Checkliste, manuelle Positionen & Speicherstände) lokal in die HTML-Datei ein.`
                      : 'Aktuell ist noch kein Callflow oder Startskript (Main) geladen.'}
                  </p>
                </div>
                <span
                  className={`w-4 h-4 rounded-full border mt-0.5 shrink-0 flex items-center justify-center ${
                    includeSeed && hasWorkspaceContent
                      ? 'border-emerald-400 bg-emerald-500/20'
                      : 'border-slate-600'
                  }`}
                >
                  {includeSeed && hasWorkspaceContent && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  )}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIncludeSeed(false)}
                className={`p-3.5 rounded-xl border text-left transition-colors flex items-start justify-between gap-3 cursor-pointer ${
                  !includeSeed || !hasWorkspaceContent
                    ? 'bg-indigo-950/35 border-indigo-500/70 text-slate-100'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="text-sm font-semibold">
                    Saubere Offline-App (Leerer Start)
                  </div>
                  <p className="text-xs text-slate-400">
                    Erzeugt eine frische Offline-Einzeldatei ohne vorbefüllte Projekt-Daten –
                    ideal als wiederverwendbares Werkzeug für neue Callflows.
                  </p>
                </div>
                <span
                  className={`w-4 h-4 rounded-full border mt-0.5 shrink-0 flex items-center justify-center ${
                    !includeSeed || !hasWorkspaceContent
                      ? 'border-indigo-400 bg-indigo-500/20'
                      : 'border-slate-600'
                  }`}
                >
                  {(!includeSeed || !hasWorkspaceContent) && (
                    <span className="w-2 h-2 rounded-full bg-indigo-400" />
                  )}
                </span>
              </button>
            </div>
          </div>

          {/* Feedback */}
          {errorMessage && (
            <div className="px-3.5 py-2.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200">
              {errorMessage}
            </div>
          )}

          {statusMessage && (
            <div className="px-3.5 py-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3.5 border-t border-slate-800 bg-slate-950/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] font-mono text-slate-400 truncate">
            Datei: {suggestedFilename}
          </span>
          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              Schließen
            </button>
            <button
              type="button"
              disabled={isDownloading}
              onClick={handleDownload}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Erstelle Offline-HTML...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Offline-Kopie (.html) speichern</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
