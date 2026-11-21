import { useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  FileCode2,
  HardDriveDownload,
  Layers,
  Loader2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { DEFAULT_THEME_CONFIG } from '../data/mermaidTemplates';
import { buildScriptWorkspace } from '../utils/scriptCallflowParser';
import { triggerLocalDownload } from '../utils/mermaidEngine';
import {
  buildAndDownloadOfflineApp,
  inspectCachedStudioProject,
  scanAllBrowserCacheEntries,
} from '../utils/offlineAppExporter';
import { AUDIT_APP_VERSION } from '../utils/offlineAuditEngine';
import { OfflineAuditSection } from './OfflineAuditSection';

const PROJECT_OFFLINE_FILENAME = 'MermaidFree2UseOpen_Projekt_Offline.html';

async function copyTextWithFallback(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

const WORKFLOW_STAGES = [
  {
    step: '01.',
    title: 'Online nur Projekt laden',
    body: 'Diese Webseite liefert ausschließlich die selbstenthaltene Einzeldatei MermaidFree2UseOpen_Projekt_Offline.html aus. Es werden online weder Konfiguratoren noch Callflow-Skripte verarbeitet.',
  },
  {
    step: '02.',
    title: 'Lokal öffnen & Studio bauen',
    body: 'Beim lokalen Öffnen per Doppelklick (file://) erscheint die vollständige Hauptseite inklusive IT-Sicherheitsnachweisen und dem aktiven Offline-HTML-Builder.',
  },
  {
    step: '03.',
    title: 'Callflow-Studio & Callflow.html nutzen',
    body: 'Der lokale Builder konfiguriert und erzeugt Ihre eigenständige Studio-HTML für .s-/Visio-Skripte, Öffnungszeiten, Logik-Prüfung und Callflow.html-Exporte.',
  },
];

const PACKAGE_CONTENTS = [
  {
    title: 'Vollständige Hauptseite & Dokumentation',
    detail: 'Technische Eckdaten, Systemarchitektur, eingebundene Module und Markenhinweise.',
  },
  {
    title: 'Aktiver Offline-HTML-Builder',
    detail: 'Konfiguriert Start-Arbeitsmodus, Zeichenfläche und Farblogik für Ihre Studio-Einzeldatei.',
  },
  {
    title: 'Vollständiger IT-Audit & Konzern-Dossier',
    detail: 'Ausgearbeitete Nachweise für DSGVO, ISO/IEC 27001, NIS2, BSI IT-Grundschutz & SBOM.',
  },
  {
    title: 'Eigenständige Studio-Erzeugung (ohne Server)',
    detail: 'Erstellt lokal aus file:// heraus die lauffähige Callflow-Studio-HTML.',
  },
];

export default function OnlineProjectLanding() {
  const cachedProject = useMemo(() => inspectCachedStudioProject(), []);
  const cacheDiag = useMemo(() => scanAllBrowserCacheEntries(), []);
  const [showCacheDiag, setShowCacheDiag] = useState<boolean>(false);
  const [includeCachedProject, setIncludeCachedProject] = useState<boolean>(
    () => cachedProject.hasProjectData
  );
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadResult, setDownloadResult] = useState<{
    filename: string;
    sizeMb: string;
    timestamp: string;
    includedCache: boolean;
  } | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'overview' | 'audit'>('overview');

  const navigateToOnlineSection = (view: 'overview' | 'audit', anchorId?: string) => {
    setActiveView(view);
    if (anchorId) {
      window.setTimeout(() => {
        document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth' });
      }, 40);
    } else if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleDownloadCacheBackupJson = () => {
    if (!cachedProject.hasProjectData) return;
    const safeSlug = (cachedProject.diagramTitle || 'callflow-cache')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'callflow-cache';
    const filename = `${safeSlug}_Cache_Sicherung.json`;
    const payload = {
      exportedAt: new Date().toISOString(),
      source: 'browser-cache-rescue',
      ...cachedProject.seedPayload,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    triggerLocalDownload(blob, filename);
    setBackupNotice(`${filename} wurde als Sofort-Sicherung heruntergeladen.`);
  };

  const handleDownloadRawCacheDump = () => {
    if (cacheDiag.totalKeys === 0) return;
    const filename = 'Browser_Raw_Cache_Sicherung.json';
    const blob = new Blob([JSON.stringify(cacheDiag.rawDump, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    triggerLocalDownload(blob, filename);
    setBackupNotice(`${filename} (${cacheDiag.totalKeys} Schlüssel) heruntergeladen.`);
  };

  const handleDownloadProjectOffline = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadError(null);

    try {
      const useCacheSeed = cachedProject.hasProjectData && includeCachedProject;
      const seedPayload = useCacheSeed
        ? cachedProject.seedPayload
        : {
            diagramTitle: 'Neuer Callflow',
            code: '',
            themeConfig: DEFAULT_THEME_CONFIG,
            smartColorMode: 'semantic' as const,
            hiddenSmartNodeTypes: [],
            canvasSurface: 'dark' as const,
            workspaceMode: 'guided' as const,
            scriptWorkspace: buildScriptWorkspace([]),
            savedDiagrams: [],
          };

      const result = await buildAndDownloadOfflineApp({
        includeWorkspaceSeed: true,
        seed: {
          initialShellView: 'builder',
          ...seedPayload,
        },
        filename: PROJECT_OFFLINE_FILENAME,
      });

      const sizeMb = (result.byteSize / (1024 * 1024)).toFixed(2);
      const timestamp = new Date().toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      setDownloadResult({
        filename: result.filename,
        sizeMb,
        timestamp,
        includedCache: useCacheSeed,
      });
    } catch (err) {
      setDownloadError(
        err instanceof Error
          ? err.message
          : 'Das lokale Projekt-Paket konnte nicht heruntergeladen werden.'
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Zone 1: Clean Wordmark */}
          <button
            type="button"
            onClick={() => navigateToOnlineSection('overview')}
            className="text-sm sm:text-base font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0 cursor-pointer hover:text-white transition-colors"
          >
            MermaidFree2UseOpen
          </button>

          {/* Zone 2: Minimal Navigation + Vollständiger IT-Audit Tab */}
          <nav
            aria-label="Hauptnavigation"
            className="hidden md:flex items-center gap-5"
          >
            <button
              type="button"
              onClick={() => navigateToOnlineSection('overview')}
              className={`py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === 'overview'
                  ? 'border-indigo-400 text-slate-50'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              Übersicht &amp; Download
            </button>
            <button
              type="button"
              onClick={() => navigateToOnlineSection('overview', 'ablauf')}
              className="py-1.5 text-xs font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              3-Stufen-Ablauf
            </button>
            <button
              type="button"
              onClick={() => navigateToOnlineSection('overview', 'sicherheit')}
              className="py-1.5 text-xs font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Offline-Garantie
            </button>
            <button
              type="button"
              onClick={() => navigateToOnlineSection('audit')}
              className={`py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === 'audit'
                  ? 'border-emerald-400 text-slate-50'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              Vollständiger IT-Audit
            </button>
          </nav>

          {/* Zone 3: Version & Direct Project Offline Download */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px] font-mono text-slate-400 tabular-nums whitespace-nowrap">
              Version {AUDIT_APP_VERSION}
            </span>
            <button
              type="button"
              disabled={isDownloading}
              onClick={handleDownloadProjectOffline}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isDownloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <HardDriveDownload className="w-3.5 h-3.5" />
              )}
              <span>Projekt offline laden</span>
            </button>
          </div>
        </div>

        {/* Compact Mobile Navigation Strip */}
        <nav
          aria-label="Mobile Navigation"
          className="md:hidden border-t border-slate-800/80 px-4 py-1.5 flex items-center gap-4 overflow-x-auto"
        >
          <button
            type="button"
            onClick={() => navigateToOnlineSection('overview')}
            className={`py-1 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'overview'
                ? 'border-indigo-400 text-slate-50'
                : 'border-transparent text-slate-400'
            }`}
          >
            Übersicht &amp; Download
          </button>
          <button
            type="button"
            onClick={() => navigateToOnlineSection('audit')}
            className={`py-1 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'audit'
                ? 'border-emerald-400 text-slate-50'
                : 'border-transparent text-slate-400'
            }`}
          >
            Vollständiger IT-Audit
          </button>
        </nav>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-12">
        {activeView === 'audit' ? (
          <OfflineAuditSection onCopyText={copyTextWithFallback} />
        ) : (
          <>
        {/* Hero & Primary Conversion Grid */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Proposition & Primary Action */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-mono uppercase tracking-wider text-emerald-400 tabular-nums">
                Version {AUDIT_APP_VERSION} · Offline-First Bereitstellung · Lokale Einzeldatei
              </p>
              <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-semibold tracking-tight text-slate-50 leading-[1.12]">
                Projekt offline laden und lokal mit dem Builder starten
              </h1>
              <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
                Diese Online-Seite stellt ausschließlich das vollständige
                Offline-Projektpaket zum Herunterladen bereit. Öffnen Sie die
                heruntergeladene HTML-Datei lokal per Doppelklick im Browser — erst dort
                stehen die Hauptseite inklusive Offline-HTML-Builder bereit, mit dem Sie
                Ihr eigenes Callflow-Studio erzeugen.
              </p>
            </div>

            {/* Browser Cache Rescue Panel (shown automatically if prior Studio data exists in localStorage) */}
            {cachedProject.hasProjectData ? (
              <div className="rounded-xl border border-emerald-500/45 bg-emerald-950/25 p-5 space-y-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Database className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="space-y-1 min-w-0">
                      <h2 className="text-sm font-semibold text-emerald-100">
                        Vorhandenes Projekt im Browser-Cache gesichert
                      </h2>
                      <p className="text-xs text-emerald-200/85 leading-relaxed">
                        Ihr bisheriger Stand (<span className="font-semibold text-white">{cachedProject.diagramTitle}</span>
                        {cachedProject.moduleCount > 0 && ` · ${cachedProject.moduleCount} Skripte`}
                        {cachedProject.savedDiagramCount > 0 && ` · ${cachedProject.savedDiagramCount} Entwürfe`}
                        {cachedProject.activeCodeLength > 0 && cachedProject.moduleCount === 0 && ` · ${cachedProject.activeCodeLength} Zeichen Code`}
                        ) liegt unverändert im lokalen Browser-Speicher vor und kann direkt in Ihre Offline-HTML übernommen werden.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <label className="inline-flex items-center gap-2 text-xs text-emerald-100 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeCachedProject}
                      onChange={(e) => setIncludeCachedProject(e.target.checked)}
                      className="rounded border-emerald-500/60 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
                    />
                    <span>Cache-Projekt direkt in Projekt-HTML übernehmen</span>
                  </label>

                  <button
                    type="button"
                    onClick={handleDownloadCacheBackupJson}
                    className="px-3 py-1.5 text-xs font-medium text-emerald-100 bg-emerald-900/60 hover:bg-emerald-800/70 border border-emerald-500/40 rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Cache-Sicherung laden (.json)</span>
                  </button>
                </div>

                {backupNotice && (
                  <p className="text-[11px] font-mono text-emerald-300">
                    {backupNotice}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 space-y-2.5">
                <button
                  type="button"
                  onClick={() => setShowCacheDiag((prev) => !prev)}
                  className="w-full flex items-center justify-between gap-3 text-left text-xs text-slate-300 hover:text-slate-100 cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    <Database className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>
                      Browser-Cache-Status (dieser Online-Origin):{' '}
                      <span className="font-mono text-slate-200 tabular-nums">
                        {cacheDiag.available
                          ? `${cacheDiag.totalKeys} Einträge (${(cacheDiag.totalBytes / 1024).toFixed(1)} KB)`
                          : 'Speicherzugriff gesperrt'}
                      </span>
                    </span>
                  </span>
                  {showCacheDiag ? (
                    <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                </button>

                {showCacheDiag && (
                  <div className="pt-2 border-t border-slate-800/80 space-y-2.5 text-xs text-slate-400">
                    <p className="leading-relaxed">
                      Im <span className="font-mono text-slate-300">localStorage</span> dieser URL (
                      <span className="font-mono text-slate-300 break-all">{cacheDiag.originLabel}</span>) sind
                      aktuell keine gespeicherten Callflow-Skripte hinterlegt. Falls Sie Ihr Projekt zuvor in einer
                      heruntergeladenen Offline-HTML (<span className="font-mono text-slate-300">file://</span>)
                      geöffnet hatten, besitzt jede lokale Datei bzw. <span className="font-mono text-slate-300">file://</span>-Umgebung
                      einen eigenen, von dieser Webseite getrennten Browserspeicher — oder ältere leere Offline-Downloads
                      können beim Doppelklick einen vorhandenen lokalen Speicher überschrieben haben (ab der neuen Version geschützt).
                    </p>
                    <p className="leading-relaxed text-slate-300">
                      Tipp: Falls Sie noch eine ältere heruntergeladene <span className="font-mono">Offline.html</span> oder
                      eine <span className="font-mono">.json</span>-Sicherung besitzen, können Sie deren Projektstand
                      im lokalen Offline-HTML-Builder wieder einlesen und in eine neue Studio-HTML übernehmen.
                    </p>
                    {cacheDiag.entries.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-300">Gefundene Schlüssel:</span>
                          <button
                            type="button"
                            onClick={handleDownloadRawCacheDump}
                            className="px-2.5 py-1 text-[11px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 cursor-pointer"
                          >
                            Roh-Cache sichern (.json)
                          </button>
                        </div>
                        <ul className="max-h-28 overflow-y-auto space-y-1 font-mono text-[11px] text-slate-400">
                          {cacheDiag.entries.map((entry) => (
                            <li key={entry.key} className="flex justify-between gap-2">
                              <span className="truncate">{entry.key}</span>
                              <span className="tabular-nums shrink-0">{entry.bytes} B</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {backupNotice && (
                      <p className="text-[11px] font-mono text-emerald-300">{backupNotice}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Single Primary CTA Block */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="text-xs font-medium text-slate-400">
                    Bereitzustellendes Offline-Projektpaket
                  </div>
                  <div className="text-sm font-mono text-slate-100 truncate">
                    {PROJECT_OFFLINE_FILENAME}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={handleDownloadProjectOffline}
                  className="px-5 py-3 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Projekt-Paket wird gebündelt (ca. 5 Sek.)…</span>
                    </>
                  ) : (
                    <>
                      <HardDriveDownload className="w-4 h-4" />
                      <span>
                        {cachedProject.hasProjectData && includeCachedProject
                          ? 'Projekt inkl. Cache offline laden (.html)'
                          : 'Projekt offline laden (.html)'}
                      </span>
                    </>
                  )}
                </button>
              </div>

              {downloadResult && (
                <div className="px-3.5 py-3 rounded-lg bg-emerald-950/50 border border-emerald-500/40 text-xs text-emerald-200 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-medium truncate">
                      {downloadResult.filename} erfolgreich gespeichert
                      {downloadResult.includedCache ? ' (inkl. Cache-Projekt)' : ''}
                    </div>
                    <div className="text-[11px] text-emerald-300/90 font-mono tabular-nums">
                      {downloadResult.sizeMb} MB · geladen um {downloadResult.timestamp}
                    </div>
                    <p className="text-xs text-emerald-200/90 pt-0.5">
                      Öffnen Sie die Datei jetzt lokal per Doppelklick (<span className="font-mono">file://</span>).
                      Dort öffnen sich die Hauptseite und der aktive Offline-HTML-Builder.
                    </p>
                  </div>
                </div>
              )}

              {downloadError && (
                <div className="px-3.5 py-2.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200">
                  {downloadError}
                </div>
              )}

              <div className="pt-2 border-t border-slate-800/90 flex items-start gap-2 text-xs text-slate-400">
                <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <span>
                  Online sind weder der Offline-HTML-Builder noch das Callflow-Studio
                  aktiv. Alle Skripte und Exporte verbleiben zu 100 % auf Ihrem lokalen
                  System.
                </span>
              </div>
            </div>
          </div>

          {/* Right: Concrete Package Inventory */}
          <aside className="lg:col-span-5 rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <h2 className="text-sm font-semibold text-slate-100">
                  Inhalt der Offline-Projekt-HTML
                </h2>
              </div>
              <span className="text-[11px] font-mono text-emerald-300">
                file:// bereit
              </span>
            </div>

            <ul className="space-y-3">
              {PACKAGE_CONTENTS.map((item) => (
                <li
                  key={item.title}
                  className="p-3 rounded-lg bg-slate-950/70 border border-slate-800/80 space-y-1"
                >
                  <div className="text-xs font-semibold text-slate-100">
                    {item.title}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {item.detail}
                  </p>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        {/* 3-Step Architecture Overview */}
        <section id="ablauf" className="scroll-mt-20 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-slate-100">
              So arbeitet die dreistufige Offline-Verteilung
            </h2>
            <p className="text-xs text-slate-400">
              Klare Trennung zwischen öffentlichem Paket-Abruf, lokaler Builder-Steuerung
              und produktiver Callflow-Analyse.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {WORKFLOW_STAGES.map((stage) => (
              <div
                key={stage.step}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-2.5"
              >
                <div className="text-xs font-mono font-semibold text-indigo-400 tabular-nums">
                  {stage.step}
                </div>
                <h3 className="text-sm font-semibold text-slate-100">
                  {stage.title}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {stage.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Technical Guarantee Strip */}
        <section
          id="sicherheit"
          className="scroll-mt-20 rounded-xl border border-slate-800 bg-slate-900/50 p-5 sm:p-6"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Netzwerk im Lokalbetrieb</span>
              </div>
              <div className="text-xl font-semibold font-mono text-emerald-300 tabular-nums">
                0 Byte Traffic
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Keine CDNs, keine externen Webfonts und keine Cloud-APIs nach dem
                Download der Einzeldatei.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <HardDriveDownload className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>Laufzeit-Umgebung</span>
              </div>
              <div className="text-xl font-semibold font-mono text-slate-100">
                file:// Einzeldatei
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Startet ohne Webserver, ohne Installation und ohne Admin-Rechte in
                Chrome, Edge oder Firefox.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Layers className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Produktionskette</span>
              </div>
              <div className="text-xl font-semibold font-mono text-slate-100">
                Projekt → Builder → Studio
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Die lokale Hauptseite baut bei Bedarf beliebig viele konfigurierte
                Callflow-Studio-Dateien.
              </p>
            </div>
          </div>
        </section>
          </>
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-800/90 bg-slate-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col gap-2 text-xs text-slate-500">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <span className="font-medium text-slate-400">MermaidFree2UseOpen</span>
            <span>
              Offline-First Einzeldatei-Verteiler · Builder und Callflow-Studio laufen
              ausschließlich lokal unter file://
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Unabhängiges internes Projektwerkzeug ohne Verbindung, Partnerschaft oder
            Zertifizierung durch Avaya Inc. oder Microsoft Corporation. Markennamen dienen
            ausschließlich der technischen Beschreibung der Dateikompatibilität (§ 23 MarkenG).
          </p>
        </div>
      </footer>
    </div>
  );
}
