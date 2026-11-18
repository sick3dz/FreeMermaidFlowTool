import React, { useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Cpu,
  Download,
  FolderSearch,
  GitBranch,
  HardDriveDownload,
  Layers,
  Loader2,
  Lock,
  ShieldCheck,
  Terminal,
  WifiOff,
} from 'lucide-react';
import { DEFAULT_THEME_CONFIG } from '../data/mermaidTemplates';
import { buildScriptWorkspace } from '../utils/scriptCallflowParser';
import { buildAndDownloadOfflineApp } from '../utils/offlineAppExporter';
import { SmartColorMode } from '../types/mermaidStudio';

type ToolCategory = 'all' | 'engine' | 'parsers' | 'analysis' | 'exports';
type TechStackTab = 'mermaid-pipeline' | 'aacc-compiler' | 'offline-sandbox';

interface EmbeddedToolSpec {
  id: string;
  category: Exclude<ToolCategory, 'all'>;
  categoryLabel: string;
  title: string;
  versionOrTag: string;
  techStackLine: string;
  description: string;
  capabilities: string[];
}

const EMBEDDED_TOOLS: EmbeddedToolSpec[] = [
  {
    id: 'mermaid-elk',
    category: 'engine',
    categoryLabel: 'Rendering & Layout',
    title: 'Mermaid.js v11 (ESM) & ELK / Dagre Layout-Solvers',
    versionOrTag: 'Mermaid 11.12 · @mermaid-js/layout-elk',
    techStackLine: 'Jison/Langium AST → Dagre / Eclipse ELK.js → Native SVG DOM & Canvas2D GPU-Proxy',
    description:
      'Vollständig im HTML-Quellcode eingebettete Vektor- und Graphen-Engine. Übersetzt deklarative Flowchart-Grammatik (`flowchart LR/TD`) lokal im Browser in geschichtete gerichtete Graphen (Layered Sugiyama-Algorithmus) ohne externe CDN-Aufrufe.',
    capabilities: [
      'Dagre (Network-Simplex / Brandes-Köpf) & Eclipse ELK Layered Solver mit konfigurierbarem nodeSpacing/rankSpacing',
      'Dual-Layer Hardware-Beschleunigung: Vektor-SVG im Ruhezustand + Canvas2D Bitmap-Proxy für 60fps Pan & Zoom',
      'Smart-Color AST/DOM-Injektion: Klassifiziert Knoten-IDs (`S_`, `QUEUE_`, `NQ_`, `CHOICE_`, `SCHED_`) in 4 semantische Farbmodi',
    ],
  },
  {
    id: 'avaya-aacc-parser',
    category: 'parsers',
    categoryLabel: 'Avaya & Visio Parser',
    title: 'Avaya AACC / Nortel Skript-Compiler (.s & .txt)',
    versionOrTag: 'Mehrstufiger Lexer & AST-Transpiler',
    techStackLine: 'RegEx Tokenizer → Rule/Section State Machine → 2-Level Mermaid Flowchart Generator',
    description:
      'Spezialisierter Callflow-Compiler für Avaya Aura Contact Center (AACC) und Nortel-Skripte. Analysiert Kontrollstrukturen, Systemvariablen und Sprungziele und transpiliert sie in Ebene-1 (Master-Topologie) und Ebene-2 (Skript-Detail-Flowchart).',
    capabilities: [
      'Parst ASSIGN-Direktiven (`Sys_Team_Skillset`, `Sys_Ueberlauf_Skillset`, `Sys_Musik`, `Sys_brand`) & IF/WHERE/VALUE-Blöcke',
      'Generiert für DTMF-Call-Menüs dedizierte Stadium-Subknoten (`CHOICE_<mod>_<idx>`) mit direkten Zielkanten (`JUMP_<target>`)',
      'Erkennt `QUEUE TO SKILLSET`, `NETWORK SKILLSET`, `GIVE RAN`, `GIVE MUSIC`, `ROUTE CALL` und `DISCONNECT`',
    ],
  },
  {
    id: 'visio-folder-importer',
    category: 'parsers',
    categoryLabel: 'Avaya & Visio Parser',
    title: 'OpenXML Visio-Parser (.vsdx / .vdx) & Ordner-Crawler',
    versionOrTag: 'JSZip 3.10 · DOMParser XML · FileReader API',
    techStackLine: 'ArrayBuffer → JSZip In-Memory Inflate → visio/pages/page*.xml Shape/Connect Graph',
    description:
      'Entpackt komprimierte OpenXML-Visio-Container (`.vsdx`) sowie komplette lokale Skript-Verzeichnisse (`webkitdirectory`) direkt im Browser-RAM über die HTML5 File-API – ohne Server-Upload.',
    capabilities: [
      'Rekonstruiert Visio-Topologien aus `<Shape>`-Textzellen und `<Connect FromSheet ToSheet>`-Kantenbeziehungen',
      'BFS-Auto-Resolver durchsucht zugewiesene lokale Ordner rekursiv nach fehlenden 4-stelligen Ziel-Skripten',
      'Nativ kompatibel mit `.s`, `.txt`, `.vsdx`, `.vdx`, `.csv`, `.tsv`, `.json` und `.mmd`',
    ],
  },
  {
    id: 'opening-hours-engine',
    category: 'analysis',
    categoryLabel: 'Analyse & Zeitpläne',
    title: 'Öffnungszeiten-, SondZeit- & Feiertags-Solver',
    versionOrTag: 'Zeitfenster-Normalisierer & Subnode-Linker',
    techStackLine: 'SondZeit-Cross-Script Lookup → HH:MM-Normalisierung → SCHED_ / HOLIDAY_ Mermaid Nodes',
    description:
      'Löst komplexe Wochentags-, Uhrzeit- und SondZeit-Bedingungen skriptübergreifend auf, korrigiert Minuten-Formatierungen (z. B. `09:00–16:59`) und bindet Zeit-/Feiertagsregeln als eigene Knoten ins Diagramm ein.',
    capabilities: [
      'Eigenständiges Öffnungszeiten-Modal mit Echtzeit-Volltextsuche, Status-Filtern und Deep-Link ins Zielskript',
      'Erzeugt im Detail-Diagramm dedizierte `SCHED_`- (🕒) und `HOLIDAY_`-Unterknoten (📅) mit direkten Zielverbindungen',
      'UTF-8 BOM Excel-CSV-Export (`callflow-oeffnungszeiten.csv`) sowie Markdown-Tabellen-Kopierfunktion',
    ],
  },
  {
    id: 'logic-health-registry',
    category: 'analysis',
    categoryLabel: 'Analyse & Zeitpläne',
    title: 'Statische Callflow-Logikprüfung & Ressourcen-Register',
    versionOrTag: 'Graph-Erreichbarkeits- & Zyklus-Analyse',
    techStackLine: 'Tarjan/DFS Cycle Detection · Dead-End & Explicit-Route Validator · Cross-Ref Indexer',
    description:
      'Führt eine statische Code- und Graphenanalyse über alle geladenen Module durch. Unterscheidet präzise zwischen echten Lücken und validen Avaya-Endpunkten.',
    capabilities: [
      'Erkennt `queueTarget`, `ASSIGN`-Regeln, deaktivierte Überläufe (`deaktiviert = 0`) und Call-Menü-Endungen als valide Routen',
      'Skillset- & Queue-Register listet für jedes Skillset alle aufrufenden Skripte, Regelschritte, Bedingungen und Prioritäten',
      'Bidirektionale Kreuzreferenz-Matrix (Caller / Callee), Ansagen-/RAN-Inventar und Systemvariablen-Tracking',
    ],
  },
  {
    id: 'standalone-exports',
    category: 'exports',
    categoryLabel: 'Exporte & Dokumentation',
    title: 'Self-Replicating HTML-Bundler & Dokumentations-Suite',
    versionOrTag: 'DOM-Quine Serializer · SVG/PNG · CSV · MD',
    techStackLine: 'In-Memory SVG Pre-Bake → Standalone HTML Viewer / Self-Contained Studio Snapshot',
    description:
      'Bietet sowohl einen schreibgeschützten interaktiven HTML-Viewer für Fachabteilungen als auch einen selbstreplizierenden Offline-App-Export inklusive eingebettetem Projekt-Seed.',
    capabilities: [
      'Interaktiver Read-Only HTML-Export mit vorberechneten SVG-Ansichten, Pfad-Tracing (Upstream/Downstream) & Zeitplan-Modal',
      'Self-Replicating Studio Export: Liest `#mermaid-offline-app-script` aus dem DOM und injiziert `window.__MERMAID_OFFLINE_SEED__`',
      'Abgeflachte Routing-Matrix (`.csv`), technisches Migrations-Konzept (`.md`), XML-bereinigtes `.svg` und High-DPI `.png`',
    ],
  },
];

export const LocalHtmlBuilderLanding: React.FC = () => {
  const [customFilename, setCustomFilename] = useState<string>(
    'MermaidFree2UseOpen_Offline.html'
  );
  const [defaultWorkspaceMode, setDefaultWorkspaceMode] = useState<'guided' | 'free'>(
    'guided'
  );
  const [defaultCanvasSurface, setDefaultCanvasSurface] = useState<'dark' | 'light'>(
    'dark'
  );
  const [defaultSmartColorMode, setDefaultSmartColorMode] =
    useState<SmartColorMode>('semantic');
  const [activeCategory, setActiveCategory] = useState<ToolCategory>('all');
  const [activeTechTab, setActiveTechTab] = useState<TechStackTab>('mermaid-pipeline');

  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  const [buildResult, setBuildResult] = useState<{
    filename: string;
    sizeMb: string;
    timestamp: string;
  } | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  const normalizedFilename = (() => {
    const trimmed = customFilename.trim();
    if (!trimmed) return 'MermaidFree2UseOpen_Offline.html';
    const safe = trimmed.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_');
    return safe.toLowerCase().endsWith('.html') ? safe : `${safe}.html`;
  })();

  const handleBuildAndDownload = async () => {
    if (isBuilding) return;
    setIsBuilding(true);
    setBuildError(null);

    try {
      const hasCustomDefaults =
        defaultWorkspaceMode !== 'guided' ||
        defaultCanvasSurface !== 'dark' ||
        defaultSmartColorMode !== 'semantic';

      const result = await buildAndDownloadOfflineApp({
        includeWorkspaceSeed: hasCustomDefaults,
        seed: hasCustomDefaults
          ? {
              diagramTitle: 'Neuer Callflow',
              code: '',
              themeConfig: DEFAULT_THEME_CONFIG,
              smartColorMode: defaultSmartColorMode,
              hiddenSmartNodeTypes: [],
              canvasSurface: defaultCanvasSurface,
              workspaceMode: defaultWorkspaceMode,
              scriptWorkspace: buildScriptWorkspace([]),
              savedDiagrams: [],
            }
          : undefined,
        filename: normalizedFilename,
      });

      const sizeMb = (result.byteSize / (1024 * 1024)).toFixed(2);
      const nowStr = new Date().toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      setBuildResult({
        filename: result.filename,
        sizeMb,
        timestamp: nowStr,
      });
    } catch (err) {
      setBuildError(
        err instanceof Error
          ? err.message
          : 'Das lokale HTML-Offline-Bundle konnte nicht generiert werden.'
      );
    } finally {
      setIsBuilding(false);
    }
  };

  const filteredTools =
    activeCategory === 'all'
      ? EMBEDDED_TOOLS
      : EMBEDDED_TOOLS.filter((tool) => tool.category === activeCategory);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col overflow-x-hidden selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Top Bar Contract: 3 Zones (Brand, Nav Links, 1 Primary Action) — compact on mobile (<15% viewport height) */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 sm:gap-8 px-4 sm:px-6 lg:px-10 py-3 sm:py-3.5 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur-md">
        <a
          href="#builder"
          className="text-sm sm:text-base lg:text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 flex items-center gap-2 min-w-0"
        >
          <HardDriveDownload className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 shrink-0" />
          <span className="truncate">Mermaid &amp; Callflow Local Builder</span>
        </a>

        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-400">
          <a
            href="#builder"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            HTML-Builder
          </a>
          <a
            href="#it-architektur"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Mermaid &amp; IT-Stack
          </a>
          <a
            href="#lokal-architektur"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            100 % Lokal-Prinzip
          </a>
          <a
            href="#eingebundene-tools"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Eingebundene Tools
          </a>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            disabled={isBuilding}
            onClick={handleBuildAndDownload}
            className="min-h-[40px] px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isBuilding ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>Generiere…</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 shrink-0" />
                <span>Offline-HTML laden</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Mobile Quick-Jump Sub-Bar (non-sticky so mobile sticky cap stays strictly < 15%) */}
      <div className="lg:hidden border-b border-slate-800/80 bg-slate-900/60 px-4 py-2 overflow-x-auto">
        <div className="flex items-center gap-4 text-xs font-medium text-slate-300 whitespace-nowrap">
          <a href="#builder" className="py-1 hover:text-emerald-300">
            1. HTML-Builder
          </a>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <a href="#it-architektur" className="py-1 hover:text-emerald-300">
            2. Mermaid &amp; IT-Architektur
          </a>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <a href="#eingebundene-tools" className="py-1 hover:text-emerald-300">
            3. Eingebundene Tools (6)
          </a>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <a href="#lokal-architektur" className="py-1 hover:text-emerald-300">
            4. Offline-Prinzip
          </a>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-10 py-6 sm:py-10 lg:py-14 space-y-12 sm:space-y-16">
        {/* Hero & Interactive Local HTML Builder Split */}
        <section
          id="builder"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-10 items-stretch"
        >
          {/* Left Column: Explanation & Technical Local Guarantee (second on mobile so builder CTA is immediate, or clear stacked) */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
            <div className="space-y-3 sm:space-y-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] sm:text-xs font-mono text-emerald-400">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>100 % LOKALE SINGLE-FILE HTML</span>
                <span aria-hidden="true">·</span>
                <span>MERMAID V11 + ELK INLINE</span>
                <span aria-hidden="true">·</span>
                <span>ZERO CDN / ZERO SERVER</span>
              </div>

              <h1
                className="text-2xl sm:text-3xl lg:text-[2.55rem] font-bold tracking-tight text-slate-50 leading-[1.18]"
                style={{ textWrap: 'balance' }}
              >
                Lokaler HTML-Offline-Builder für Avaya Callflows &amp; Mermaid-Architekturen
              </h1>

              <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
                Diese Startseite dient ausschließlich als{' '}
                <strong className="text-slate-100 font-semibold">
                  lokaler Single-File-Compiler
                </strong>
                . Sensible Telekommunikations- und Routing-Skripte werden nicht im
                Online-Browser editiert. Sie generieren hier eine vollständig autarke{' '}
                <code className="font-mono text-emerald-300">.html</code>-Datei, die den
                kompletten JavaScript-/TypeScript-Bundle-Baum (React 19, Mermaid.js v11 ESM,
                Eclipse ELK.js, Dagre, AACC-Compiler und JSZip) inline enthält und lokal über{' '}
                <code className="font-mono text-slate-200">file://</code> ohne Netzwerkzugriff
                läuft.
              </p>
            </div>

            {/* Technical Specs Bar (Tabular Numerals) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 pt-3 border-t border-slate-800/90 font-mono tabular-nums">
              <div className="bg-slate-900/60 border border-slate-800/90 rounded-lg p-3 space-y-0.5">
                <div className="text-[11px] text-slate-400">Graph-Engine</div>
                <div className="text-xs sm:text-sm font-semibold text-emerald-300">
                  Mermaid v11.12
                </div>
                <div className="text-[10px] text-slate-400">ESM Inline-Bundle</div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800/90 rounded-lg p-3 space-y-0.5">
                <div className="text-[11px] text-slate-400">Layout-Solver</div>
                <div className="text-xs sm:text-sm font-semibold text-indigo-300">
                  Dagre &amp; ELK.js
                </div>
                <div className="text-[10px] text-slate-400">Sugiyama Layered</div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800/90 rounded-lg p-3 space-y-0.5">
                <div className="text-[11px] text-slate-400">Externe Requests</div>
                <div className="text-xs sm:text-sm font-semibold text-emerald-300">
                  0 Byte (Air-Gapped)
                </div>
                <div className="text-[10px] text-slate-400">Kein CDN / Kein Fetch</div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800/90 rounded-lg p-3 space-y-0.5">
                <div className="text-[11px] text-slate-400">Laufzeit-Protokoll</div>
                <div className="text-xs sm:text-sm font-semibold text-sky-300">
                  file:// &amp; RAM
                </div>
                <div className="text-[10px] text-slate-400">LocalStorage + Fallback</div>
              </div>
            </div>

            {/* Key Local Architecture Facts */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-800/90">
              <div className="py-1 sm:py-2 space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <WifiOff className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Keine CDN-Abhängigkeit</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Kein unpkg, kein jsDelivr und keine Google-Webfonts zur Laufzeit. Ideal für
                  abgeschottete Enterprise-VMs.
                </p>
              </div>

              <div className="py-1 sm:py-2 space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>In-Memory Parsing</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Avaya <code className="font-mono text-slate-300">.s</code>-Skripte und{' '}
                  <code className="font-mono text-slate-300">.vsdx</code>-Dateien werden rein
                  lokal über <code className="font-mono text-slate-300">FileReader</code> im
                  Browser-Heap geparst.
                </p>
              </div>

              <div className="py-1 sm:py-2 space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <Terminal className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Zero-Install Ausführung</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Kein lokaler Node.js-Server, kein Docker und keine Admin-Rechte nötig. Startet
                  direkt per Doppelklick im Browser.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive HTML Builder Configurator Card */}
          <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-6 flex flex-col justify-between space-y-5 sm:space-y-6">
            <div className="space-y-4 sm:space-y-5">
              <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
                <div>
                  <h2 className="text-sm sm:text-base font-semibold text-slate-100">
                    Offline-HTML-Paket konfigurieren &amp; bauen
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Erzeugt die eigenständige Studio-Einzeldatei für Ihren lokalen Arbeitsplatz
                  </p>
                </div>
                <span className="text-[11px] font-mono text-emerald-400 tabular-nums shrink-0">
                  Single-File
                </span>
              </div>

              {/* Filename Input */}
              <div className="space-y-1.5">
                <label
                  htmlFor="offline-builder-filename"
                  className="block text-xs font-medium text-slate-300"
                >
                  Zieldateiname der lokalen HTML-Anwendung
                </label>
                <input
                  id="offline-builder-filename"
                  type="text"
                  value={customFilename}
                  onChange={(e) => setCustomFilename(e.target.value)}
                  placeholder="MermaidFree2UseOpen_Offline.html"
                  className="w-full min-h-[42px] px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-emerald-500/70"
                />
                <div className="text-[11px] text-slate-400 font-mono truncate">
                  Ausgabe: {normalizedFilename}
                </div>
              </div>

              {/* Default Start Mode */}
              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-slate-300">
                  Standard-Arbeitsmodus beim Öffnen der HTML
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setDefaultWorkspaceMode('guided')}
                    className={`min-h-[40px] px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      defaultWorkspaceMode === 'guided'
                        ? 'bg-emerald-600/25 text-emerald-200 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    Geführter 3-Schritt-Modus
                  </button>
                  <button
                    type="button"
                    onClick={() => setDefaultWorkspaceMode('free')}
                    className={`min-h-[40px] px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      defaultWorkspaceMode === 'free'
                        ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/40'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    Freier Experten-Modus
                  </button>
                </div>
              </div>

              {/* Default Canvas & Color Logic */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-slate-300">
                    Standard-Zeichenfläche
                  </span>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setDefaultCanvasSurface('dark')}
                      className={`min-h-[38px] px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        defaultCanvasSurface === 'dark'
                          ? 'bg-slate-800 text-slate-100'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Dunkel
                    </button>
                    <button
                      type="button"
                      onClick={() => setDefaultCanvasSurface('light')}
                      className={`min-h-[38px] px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        defaultCanvasSurface === 'light'
                          ? 'bg-slate-800 text-slate-100'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Hell
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="offline-builder-colormode"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Smart-Color-Logik
                  </label>
                  <select
                    id="offline-builder-colormode"
                    value={defaultSmartColorMode}
                    onChange={(e) =>
                      setDefaultSmartColorMode(e.target.value as SmartColorMode)
                    }
                    className="w-full min-h-[42px] px-2.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-emerald-500/70"
                  >
                    <option value="semantic">Rollen-Logik (Empfohlen)</option>
                    <option value="clusters">Ebenen-Fokus (Subgraphs)</option>
                    <option value="high-contrast">Kontrast &amp; Fluss</option>
                    <option value="standard">Standard</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Action & Build Status Feedback */}
            <div className="space-y-3 pt-2 border-t border-slate-800">
              {buildError && (
                <div className="px-3.5 py-2.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200">
                  {buildError}
                </div>
              )}

              {buildResult && (
                <div className="px-3.5 py-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-200 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-semibold break-all sm:truncate">
                      Erfolgreich generiert: {buildResult.filename} ({buildResult.sizeMb} MB)
                    </div>
                    <div className="text-emerald-300/90 text-[11px]">
                      Erstellt um {buildResult.timestamp} Uhr · Öffnen Sie die Datei jetzt per
                      Doppelklick lokal in Ihrem Browser.
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={isBuilding}
                onClick={handleBuildAndDownload}
                className="w-full min-h-[46px] py-3 px-4 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {isBuilding ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Bündele lokale Offline-HTML-App…</span>
                  </>
                ) : (
                  <>
                    <HardDriveDownload className="w-4 h-4 shrink-0" />
                    <span>Lokale Offline-App (.html) erstellen &amp; laden</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Section 2: Deep IT Technical Architecture & Mermaid Under-The-Hood Section */}
        <section
          id="it-architektur"
          className="border-t border-slate-800/90 pt-10 sm:pt-12 space-y-6"
        >
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div className="space-y-2 max-w-3xl">
              <div className="flex items-center gap-2 text-xs font-mono text-indigo-400">
                <Code2 className="w-4 h-4 shrink-0" />
                <span>IT-ARCHITEKTUR &amp; MERMAID.JS ENGINE-SPEZIFIKATION</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-100">
                Technische Funktionsweise: Was wird für Mermaid &amp; das Callflow-Rendering genutzt?
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Detaillierter Einblick in den eingebetteten Software-Stack, die mathematischen
                Graph-Layout-Algorithmen, den Avaya-AACC-Transpiler und die Browser-Sandbox.
              </p>
            </div>

            {/* Interactive Technical Deep-Dive Switcher (horizontally scrollable on mobile) */}
            <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto max-w-full self-start">
              <button
                type="button"
                onClick={() => setActiveTechTab('mermaid-pipeline')}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTechTab === 'mermaid-pipeline'
                    ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/40'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                1. Mermaid v11 &amp; Layout-Solver
              </button>
              <button
                type="button"
                onClick={() => setActiveTechTab('aacc-compiler')}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTechTab === 'aacc-compiler'
                    ? 'bg-emerald-600/25 text-emerald-200 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                2. Avaya-zu-Mermaid Transpiler
              </button>
              <button
                type="button"
                onClick={() => setActiveTechTab('offline-sandbox')}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTechTab === 'offline-sandbox'
                    ? 'bg-sky-600/25 text-sky-200 border border-sky-500/40'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                3. Single-File Bundle &amp; Security
              </button>
            </div>
          </div>

          {/* Tab 1: Mermaid v11 Pipeline & Graph Solvers */}
          {activeTechTab === 'mermaid-pipeline' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7 bg-slate-900/75 border border-slate-800 rounded-xl p-4 sm:p-6 space-y-4">
                <h3 className="text-sm sm:text-base font-semibold text-slate-100">
                  Mermaid.js v11 Rendering-Stack &amp; Graph-Layout-Mathematik
                </h3>
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    <strong className="text-indigo-300 font-mono">
                      1. Lexikalische Analyse &amp; AST (Jison / Langium):
                    </strong>{' '}
                    Mermaid v11 kompiliert den generierten Flowchart-Code (
                    <code className="font-mono text-slate-200">flowchart LR</code> oder{' '}
                    <code className="font-mono text-slate-200">flowchart TD</code>) zunächst über
                    einen integrierten Grammatik-Parser in einen abstrakten Syntaxbaum (AST).
                    Dabei werden Knotentypen wie Stadium-Terminals{' '}
                    <code className="font-mono text-emerald-300">([&quot;…&quot;])</code>,
                    Hexagon-Entscheidungen{' '}
                    <code className="font-mono text-amber-300">{'{{'}&quot;…&quot;{'}}'}</code>,
                    Datenbank-/Queue-Zylinder{' '}
                    <code className="font-mono text-indigo-300">[(&quot;…&quot;)]</code> sowie
                    Subgraphen (<code className="font-mono text-slate-200">subgraph … end</code>)
                    typisiert.
                  </p>
                  <p>
                    <strong className="text-indigo-300 font-mono">
                      2. Geschichtetes Graph-Layout (Dagre vs. Eclipse ELK.js):
                    </strong>{' '}
                    Für die Koordinatenberechnung sind zwei vollwertige Layout-Engines direkt in
                    die HTML-Datei einprogrammiert:
                  </p>
                  <ul className="space-y-1.5 pl-4 list-disc text-slate-300">
                    <li>
                      <strong className="text-slate-100">Dagre-Solver (Standard):</strong>{' '}
                      Implementiert den mehrstufigen Sugiyama-Algorithmus (Greedy-Cycle-Removal
                      → Network-Simplex Layer-Assignment → Barycenter Crossing-Minimization →
                      Brandes-Köpf X/Y-Koordinatenberechnung).
                    </li>
                    <li>
                      <strong className="text-slate-100">
                        Eclipse Layout Kernel (@mermaid-js/layout-elk):
                      </strong>{' '}
                      Deterministischer <code className="font-mono text-slate-200">elk.layered</code>
                      -Algorithmus für stark verzweigte Enterprise-Callflows mit tief
                      verschachtelten Subgraphen und orthogonaler Kantenführung.
                    </li>
                  </ul>
                  <p>
                    <strong className="text-indigo-300 font-mono">
                      3. Dual-Layer SVG &amp; Canvas2D GPU-Proxy:
                    </strong>{' '}
                    Mermaid erzeugt im Browser ein natives{' '}
                    <code className="font-mono text-slate-200">&lt;svg&gt;</code>-DOM. Für
                    große Callflows (&gt; 80 Knoten) schaltet die Engine automatisch von HTML-{' '}
                    <code className="font-mono text-slate-200">&lt;foreignObject&gt;</code> auf
                    native SVG-<code className="font-mono text-slate-200">&lt;text&gt;</code>-Knoten
                    um und rasterisiert im Hintergrund eine GPU-Textur (
                    <code className="font-mono text-slate-200">createImageBitmap</code>), damit
                    Pan &amp; Zoom selbst bei hunderten Regeln ruckelfrei mit 60 FPS laufen.
                  </p>
                </div>
              </div>

              <div className="lg:col-span-5 bg-slate-950 border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col justify-between space-y-4 font-mono text-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-2.5">
                  <span>MERMAID V11 INIT &amp; PIPELINE</span>
                  <span className="text-emerald-400">src/utils/mermaidEngine.ts</span>
                </div>
                <pre className="text-[11px] leading-relaxed text-slate-300 overflow-x-auto whitespace-pre">
{`// 1. Lokale Initialisierung (Zero-CDN)
mermaid.registerLayoutLoaders(elkLayouts);
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  maxTextSize: 500000,
  maxEdges: 4000,
  flowchart: {
    htmlLabels: !useNativeSvgLabels,
    nodeSpacing: 46,
    rankSpacing: 62,
    curve: 'basis'
  }
});

// 2. AST-Kompilierung & SVG-Synthese
const { svg } = await mermaid.render(id, code);

// 3. Post-Processing im SVG-DOM:
// - Smart-Color Rollen-Klassifizierung
// - Magnetische 4-Seiten Connect-Ports
// - Live Node-Offset Drag-Matrizen`}
                </pre>
                <div className="text-[11px] text-slate-400 border-t border-slate-800 pt-2.5">
                  Kompatibel mit Chromium (Blink/Skia), Firefox (Gecko/WebRender) und Edge.
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Avaya AACC to Mermaid Transpiler */}
          {activeTechTab === 'aacc-compiler' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7 bg-slate-900/75 border border-slate-800 rounded-xl p-4 sm:p-6 space-y-4">
                <h3 className="text-sm sm:text-base font-semibold text-slate-100">
                  Wie Avaya AACC-Skripte (.s) in Mermaid-Graphen übersetzt werden
                </h3>
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    Der integrierte Parser (<code className="font-mono text-emerald-300">scriptCallflowParser.ts</code>)
                    arbeitet als zweistufiger Transpiler, der proprietäre Avaya/Nortel-Skriptsyntax
                    und Tabellen-Exporte in standardisierte Mermaid-Flowcharts überführt:
                  </p>
                  <ul className="space-y-2 pl-4 list-disc text-slate-300">
                    <li>
                      <strong className="text-slate-100">
                        Variablen- &amp; Skillset-Auflösung:
                      </strong>{' '}
                      Extrahiert <code className="font-mono text-slate-200">ASSIGN &lt;wert&gt; TO &lt;var&gt;</code>{' '}
                      sowie <code className="font-mono text-slate-200">QUEUE TO SKILLSET</code>{' '}
                      und verknüpft <code className="font-mono text-emerald-300">Sys_Team_Skillset</code>{' '}
                      (Primär-Skillset) und{' '}
                      <code className="font-mono text-amber-300">Sys_Ueberlauf_Skillset</code>{' '}
                      (Überlauf) automatisch als Zylinder-Knoten{' '}
                      <code className="font-mono text-slate-200">QUEUE_&lt;name&gt;[(&quot;…&quot;)]</code>.
                    </li>
                    <li>
                      <strong className="text-slate-100">
                        Explizite Unterknoten für DTMF, Zeitpläne &amp; Feiertage:
                      </strong>{' '}
                      Anstatt Verzweigungen nur als Fließtext zu verstecken, generiert der
                      Transpiler eigene Mermaid-Subknoten für DTMF-Tastenwahlen (
                      <code className="font-mono text-slate-200">CHOICE_…</code>), Öffnungszeiten/SondZeit (
                      <code className="font-mono text-slate-200">SCHED_…</code>) und Feiertage (
                      <code className="font-mono text-slate-200">HOLIDAY_…</code>) inklusive
                      direkter Kanten zum Zielskript.
                    </li>
                    <li>
                      <strong className="text-slate-100">
                        Intelligente Fehlertoleranz (Health Engine):
                      </strong>{' '}
                      Regeln mit zugewiesenem Skillset, Ansage,{' '}
                      <code className="font-mono text-slate-200">ASSIGN</code>-Befehl,
                      deaktiviertem Überlauf (<code className="font-mono text-slate-200">deaktiviert = 0</code>)
                      oder Call-Menü-Abschluss werden als vollständig definierte Routen erkannt
                      und erzeugen keine Fehlalarme.
                    </li>
                  </ul>
                </div>
              </div>

              <div className="lg:col-span-5 bg-slate-950 border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col justify-between space-y-4 font-mono text-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-2.5">
                  <span>AVAYA .S → MERMAID TRANSPILATION</span>
                  <span className="text-emerald-400">Ebene 2 Detail-Graph</span>
                </div>
                <pre className="text-[11px] leading-relaxed text-slate-300 overflow-x-auto whitespace-pre">
{`flowchart LR
  SELF_1000(["★ [1000] Kundenservice"])
  STEP_1000_1{{"Prio 1: Zeitprüfung & Menü"}}

  %% Dedizierte Unterknoten + direkte Zielkanten
  SCHED_1000_0(["🕒 Öffnungszeiten: 09:00-16:59"])
  HOLIDAY_1000_0(["📅 Feiertag: Bundesweit"])
  CHOICE_1000_0_0(["DTMF 1: Vertrag"])
  QUEUE_S_Service[("🎧 Queue: S_Service_Team")]

  SELF_1000 --> STEP_1000_1
  STEP_1000_1 -->|Zeitbedingung| SCHED_1000_0
  SCHED_1000_0 -->|Ziel| JUMP_1010(["→ [1010] Nacht"])
  STEP_1000_1 -->|Wahl 1| CHOICE_1000_0_0
  CHOICE_1000_0_0 -->|Vertrag| JUMP_1020
  STEP_1000_1 -->|Queue| QUEUE_S_Service`}
                </pre>
                <div className="text-[11px] text-slate-400 border-t border-slate-800 pt-2.5">
                  Jeder Zielknoten (<code className="text-slate-300">JUMP_…</code>) unterstützt
                  1-Klick-Drilldown in das jeweilige Zielskript.
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Single-File Bundle & Browser Sandbox */}
          {activeTechTab === 'offline-sandbox' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7 bg-slate-900/75 border border-slate-800 rounded-xl p-4 sm:p-6 space-y-4">
                <h3 className="text-sm sm:text-base font-semibold text-slate-100">
                  Single-File HTML-Packaging, DOM-Quine &amp; Browser-Sandbox
                </h3>
                <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                  <p>
                    <strong className="text-sky-300 font-mono">
                      1. Vite + Esbuild IIFE/ESM Single-File-Kompilierung:
                    </strong>{' '}
                    Ein dedizierter Build-Prozess (<code className="font-mono text-slate-200">buildOfflineApp.mjs</code>)
                    löst sämtliche Modul-Imports (inklusive dynamischer Code-Splits von Mermaid
                    v11 und ELK) zu einem einzigen, minifizierten JavaScript-String auf und
                    bettet ihn zusammen mit dem Tailwind-CSS-Stylesheet direkt in das
                    HTML-Dokument ein.
                  </p>
                  <p>
                    <strong className="text-sky-300 font-mono">
                      2. Selbstreplizierende HTML-Architektur (DOM-Quine):
                    </strong>{' '}
                    Sobald Sie in der heruntergeladenen HTML-Datei lokal arbeiten, kann sich die
                    Datei selbst klonen: Sie liest ihren eigenen Programmcode aus{' '}
                    <code className="font-mono text-slate-200">#mermaid-offline-app-script</code>{' '}
                    und <code className="font-mono text-slate-200">#mermaid-offline-app-style</code>{' '}
                    aus und injiziert Ihren aktuellen Callflow-Arbeitsstand XSS-sicher maskiert in{' '}
                    <code className="font-mono text-emerald-300">window.__MERMAID_OFFLINE_SEED__</code>.
                  </p>
                  <p>
                    <strong className="text-sky-300 font-mono">
                      3. Resiliente Storage-Schicht unter file://:
                    </strong>{' '}
                    Da manche Browser unter dem <code className="font-mono text-slate-200">file://</code>
                    -Protokoll den Zugriff auf <code className="font-mono text-slate-200">window.localStorage</code>{' '}
                    einschränken, besitzt die Engine einen transparenten{' '}
                    <code className="font-mono text-slate-200">memoryStorageFallback</code>{' '}
                    kombiniert mit dem eingebetteten HTML-Seed.
                  </p>
                </div>
              </div>

              <div className="lg:col-span-5 bg-slate-950 border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col justify-between space-y-4 font-mono text-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-2.5">
                  <span>ANATOMIE DER OFFLINE-HTML-DATEI</span>
                  <span className="text-sky-400">100 % Self-Contained</span>
                </div>
                <pre className="text-[11px] leading-relaxed text-slate-300 overflow-x-auto whitespace-pre">
{`<!doctype html>
<html lang="de" class="dark">
<head>
  <meta charset="UTF-8" />
  <!-- Komplettes Tailwind v4 CSS inline -->
  <style id="mermaid-offline-app-style">...</style>
</head>
<body>
  <div id="root"></div>
  <!-- Schaltet beim Öffnen direkt ins Studio -->
  <script id="mermaid-offline-flag">
    window.__IS_OFFLINE_SINGLEFILE__ = true;
  </script>
  <!-- Optionaler Callflow-Snapshot Seed -->
  <script id="mermaid-offline-seed">
    window.__MERMAID_OFFLINE_SEED__ = { ... };
  </script>
  <!-- React 19 + Mermaid v11 + ELK + Parser -->
  <script id="mermaid-offline-app-script">...</script>
</body>
</html>`}
                </pre>
                <div className="text-[11px] text-slate-400 border-t border-slate-800 pt-2.5">
                  Keine externen <code className="text-slate-300">&lt;script src=&quot;https://…&quot;&gt;</code>{' '}
                  oder <code className="text-slate-300">&lt;link href=&quot;…&quot;&gt;</code>{' '}
                  Verweise.
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Section 3: Overview of all embedded Tools & Parsers */}
        <section
          id="eingebundene-tools"
          className="border-t border-slate-800/90 pt-10 sm:pt-12 space-y-6"
        >
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="space-y-2 max-w-2xl">
              <h2 className="text-xl sm:text-2xl font-bold text-slate-100">
                Eingebundene Tools, Parser &amp; Algorithmen im Detail
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Alle 6 Kernmodule sind ohne Zusatzinstallation direkt in der heruntergeladenen
                HTML-Datei aktiv.
              </p>
            </div>

            {/* Interactive Category Filter Tabs (scrolls smoothly on narrow mobile screens) */}
            <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto max-w-full self-start">
              {(
                [
                  { id: 'all', label: 'Alle Module (6)' },
                  { id: 'engine', label: 'Rendering & Layout' },
                  { id: 'parsers', label: 'Avaya & Visio Parser' },
                  { id: 'analysis', label: 'Analyse & Zeitpläne' },
                  { id: 'exports', label: 'Exporte & Doku' },
                ] as Array<{ id: ToolCategory; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveCategory(tab.id)}
                  className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeCategory === tab.id
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {filteredTools.map((tool) => (
              <div
                key={tool.id}
                className="bg-slate-900/75 border border-slate-800 rounded-xl p-4 sm:p-6 flex flex-col justify-between space-y-4 sm:space-y-5"
              >
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-400 font-mono">
                    <span>{tool.categoryLabel}</span>
                    <span className="text-emerald-400">{tool.versionOrTag}</span>
                  </div>

                  <h3 className="text-sm sm:text-base font-semibold text-slate-100 leading-snug">
                    {tool.title}
                  </h3>

                  <div className="text-[11px] font-mono text-indigo-300 bg-slate-950/90 border border-slate-800/90 rounded px-2.5 py-1.5 break-words">
                    {tool.techStackLine}
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {tool.description}
                  </p>
                </div>

                <ul className="space-y-2 pt-3.5 border-t border-slate-800/80 text-xs text-slate-300">
                  {tool.capabilities.map((cap, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-emerald-400 font-mono shrink-0">✓</span>
                      <span className="leading-relaxed">{cap}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Section 4: Explanation how 100% local execution works */}
        <section
          id="lokal-architektur"
          className="border-t border-slate-800/90 pt-10 sm:pt-12 space-y-6"
        >
          <div className="max-w-3xl space-y-2">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-100">
              Ablauf: Vom HTML-Builder zum lokalen Offline-Arbeitsplatz
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              So greifen Bundle-Generierung, lokaler Doppelklick-Start und In-Memory-Analyse
              ineinander:
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-2">
              <div className="text-xs font-mono text-emerald-400 tabular-nums">
                01 · Bündelung
              </div>
              <h3 className="text-sm font-semibold text-slate-100">
                Alle Engines inline im HTML
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Der Builder verpackt React 19, Tailwind-Styles, Mermaid.js v11, ELK-Graph-Layout
                und JSZip direkt in{' '}
                <code className="font-mono text-slate-300">&lt;script&gt;</code>- und{' '}
                <code className="font-mono text-slate-300">&lt;style&gt;</code>-Blöcke einer
                einzigen Datei.
              </p>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-2">
              <div className="text-xs font-mono text-emerald-400 tabular-nums">
                02 · Ausführung
              </div>
              <h3 className="text-sm font-semibold text-slate-100">
                Direktstart über file://
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Beim Öffnen der heruntergeladenen HTML-Datei erkennt die Anwendung das Flag{' '}
                <code className="font-mono text-slate-300">__IS_OFFLINE_SINGLEFILE__</code> bzw.{' '}
                <code className="font-mono text-slate-300">file://</code> und startet sofort das
                volle Callflow-Studio.
              </p>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-2">
              <div className="text-xs font-mono text-emerald-400 tabular-nums">
                03 · Dateiverarbeitung
              </div>
              <h3 className="text-sm font-semibold text-slate-100">
                Lokaler Browser-Speicher (RAM)
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Avaya-Skripte (<code className="font-mono text-slate-300">.s</code>), ganze
                Skript-Ordner und Visio-Dateien (<code className="font-mono text-slate-300">.vsdx</code>)
                werden rein lokal im Arbeitsspeicher analysiert und zu Mermaid-Graphen
                gerendert.
              </p>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-2">
              <div className="text-xs font-mono text-emerald-400 tabular-nums">
                04 · Persistenz &amp; Weitergabe
              </div>
              <h3 className="text-sm font-semibold text-slate-100">
                Snapshot-Speicherung in HTML
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Aus der lokalen Offline-App heraus können Sie jederzeit wieder eine neue
                Offline-HTML inkl. eingebettetem Callflow-Projektstand oder einen Read-Only
                HTML-Viewer für Kollegen exportieren.
              </p>
            </div>
          </div>

          {/* Bottom Call-To-Action Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-xl p-5 sm:p-6">
            <div className="space-y-1">
              <div className="text-xs font-mono text-emerald-400">
                BEREIT FÜR DEN LOKALEN EINSATZ
              </div>
              <div className="text-sm sm:text-base font-semibold text-slate-100">
                Erstellen Sie jetzt Ihre lokale{' '}
                <code className="font-mono text-emerald-300">{normalizedFilename}</code>{' '}
                Einzeldatei
              </div>
            </div>
            <button
              type="button"
              disabled={isBuilding}
              onClick={handleBuildAndDownload}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Offline-HTML jetzt herunterladen</span>
            </button>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-900 px-4 sm:px-6 lg:px-10 py-5 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
        <div>
          MermaidFree2UseOpen · Lokaler Single-File HTML-Builder (100 % Client-Side &amp;
          Air-Gapped)
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 font-mono text-[11px]">
          <span>Mermaid v11.12 ESM</span>
          <span aria-hidden="true">·</span>
          <span>Eclipse ELK &amp; Dagre</span>
          <span aria-hidden="true">·</span>
          <span>Avaya AACC Compiler</span>
          <span aria-hidden="true">·</span>
          <span>JSZip Visio Parser</span>
        </div>
      </footer>
    </div>
  );
};
