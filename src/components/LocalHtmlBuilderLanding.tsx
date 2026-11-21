import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  FolderUp,
  Loader2,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { DEFAULT_THEME_CONFIG } from '../data/mermaidTemplates';
import { buildScriptWorkspace } from '../utils/scriptCallflowParser';
import {
  buildAndDownloadOfflineApp,
  extractSeedFromRecoveryFile,
  inspectCachedStudioProject,
} from '../utils/offlineAppExporter';
import { AUDIT_APP_VERSION } from '../utils/offlineAuditEngine';
import { OfflineWorkspaceSeed, SmartColorMode } from '../types/mermaidStudio';
import { OfflineAuditSection } from './OfflineAuditSection';

type OfflineLandingView = 'builder' | 'audit' | 'architecture' | 'modules';
type TopTechSpecId = 'runtime' | 'graph-engine' | 'analysis-sim' | 'air-gapped';
type ArchInspectorTab = 'mermaid-elk' | 'avaya-parser' | 'singlefile-export';
type ModuleCategory = 'all' | 'engine' | 'parsers' | 'analysis' | 'exports';

interface TopTechSpecItem {
  id: TopTechSpecId;
  label: string;
  value: string;
  sublabel: string;
  accentClass: string;
  title: string;
  summary: string;
  facts: Array<{ label: string; value: string }>;
  snippetTitle: string;
  snippetCode: string;
}

interface WorkflowStepSpec {
  id: string;
  stepNumber: string;
  shortTitle: string;
  subtitle: string;
  detailTitle: string;
  summary: string;
  facts: Array<{ label: string; value: string }>;
  codeTitle: string;
  code: string;
}

interface ArchInspectorSpec {
  id: ArchInspectorTab;
  label: string;
  title: string;
  summary: string;
  bullets: string[];
  fileHint: string;
  code: string;
}

interface EmbeddedModuleSpec {
  id: string;
  category: Exclude<ModuleCategory, 'all'>;
  categoryLabel: string;
  title: string;
  versionTag: string;
  pipelineLine: string;
  description: string;
  capabilities: string[];
  facts: Array<{ label: string; value: string }>;
  codeTitle: string;
  code: string;
}

const TOP_TECH_SPECS: TopTechSpecItem[] = [
  {
    id: 'runtime',
    label: 'Laufzeit',
    value: 'file:// & RAM',
    sublabel: 'Single-File HTML',
    accentClass: 'text-sky-300',
    title: 'Lokaler Einzeldatei-Betrieb über file:// ohne Installation',
    summary:
      'Die Anwendung existiert ausschließlich als eigenständige Offline-HTML-Datei. Nach dem Download startet ein Doppelklick direkt das vollständige Callflow-Studio im Unternehmens-Browser — ohne Webserver, ohne Admin-Rechte und ohne Internet.',
    facts: [
      { label: 'Start-Protokoll', value: 'Direkt via file:// (Chrome, Edge, Firefox)' },
      { label: 'Dateieinlesung', value: 'HTML5 FileReader im flüchtigen Browser-RAM' },
      { label: 'Persistenz', value: 'Embedded HTML-Seed → LocalStorage → In-Memory' },
      { label: 'Weitergabe', value: 'Self-Replicating Projekt-Snapshot direkt aus file://' },
    ],
    snippetTitle: 'OFFLINE-BOOT & RESILIENTE SPEICHERKASKADE',
    snippetCode: `export function isRunningAsOfflineSingleFile(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.__IS_OFFLINE_SINGLEFILE__) || window.location.protocol === 'file:';
}
// Falls Gruppenrichtlinien localStorage unter file:// sperren, greift der In-Memory-Adapter.`,
  },
  {
    id: 'graph-engine',
    label: 'Graph & Layout',
    value: 'Mermaid v11',
    sublabel: 'Dagre & ELK.js',
    accentClass: 'text-indigo-300',
    title: 'Mermaid.js v11.12 ESM mit Dagre & Eclipse ELK Layout-Solvern',
    summary:
      'Kompiliert Flowchart-Definitionen lokal im Browser in Vektor-SVGs mit hierarchischem Sugiyama-Layout. Bei großen Callflows übernimmt ein GPU-beschleunigter Canvas2D-Proxy flüssiges Panning und Zoomen mit 60 FPS.',
    facts: [
      { label: 'Layout-Algorithmen', value: 'Dagre (Sugiyama) & Eclipse ELK Layered' },
      { label: 'Kapazität', value: 'Bis 500.000 Zeichen & 4.000 Kanten lokal' },
      { label: 'Großgraphen-Schutz', value: 'Auto-Switch ab > 80 Knoten auf native <text>' },
      { label: 'Navigation', value: 'GPU-Minimap (M), Vollbild (F) & 4-Seiten-Ports' },
    ],
    snippetTitle: 'MERMAID V11 KONFIGURATION (STRIKT LOKAL)',
    snippetCode: `mermaid.registerLayoutLoaders(elkLayouts);
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  maxTextSize: 500000,
  maxEdges: 4000,
  flowchart: { htmlLabels: !isLargeDiagram, curve: 'basis' },
});`,
  },
  {
    id: 'analysis-sim',
    label: 'Analyse & Zeiten',
    value: 'Öffnungszeiten',
    sublabel: 'Suche & Logik-Check',
    accentClass: 'text-emerald-300',
    title: 'Öffnungszeiten-Solver, Globale Suche & Statische Logikprüfung',
    summary:
      'Löst Wochentage, Uhrzeiten, SondZeit-Referenzen und Feiertagsregeln skriptübergreifend auf und exportiert sie strukturiert als Excel-CSV. Ergänzt durch globale Suche (Strg+K), Ressourcen-Register und Zyklus-/Sackgassen-Prüfung.',
    facts: [
      { label: 'Öffnungszeiten', value: 'Skriptübergreifende SondZeit- & Feiertags-Auflösung' },
      { label: 'Excel-CSV Export', value: 'Getrennte Spalten für Wochentage, Uhrzeiten & Quelle' },
      { label: 'Globale Suche', value: 'Strg+K über Skripte, DNIS, Skillsets & Ansagen' },
      { label: 'Logikprüfung', value: 'Erkennt fehlende Zielskripte, Zyklen & Sackgassen' },
    ],
    snippetTitle: 'ZEITPLAN-AUFLÖSUNG & CSV-EXPORT',
    snippetCode: `// Skriptübergreifende Auflösung inkl. SondZeit-Switch & Namensmuster:
const rows = buildWorkspaceScheduleOverview(workspace);
const csv = exportOpeningHoursCsv(workspace);
// Identische Übersicht & CSV-Export sind auch in Callflow.html enthalten.`,
  },
  {
    id: 'air-gapped',
    label: 'Netzwerk',
    value: '0 Byte Traffic',
    sublabel: 'Air-Gap-fähig',
    accentClass: 'text-emerald-300',
    title: '100 % Air-Gapped: Kein CDN, kein Fetch, keine Telemetrie',
    summary:
      'Sämtliche JavaScript-Bibliotheken, Stylesheets und Icons sind beim Build synchron in die einzelne HTML-Datei eingebettet. Auf komplett vom Internet getrennten Arbeitsplätzen oder Sprungservern entstehen exakt 0 Byte Netzwerkverkehr.',
    facts: [
      { label: 'Ausgehende Requests', value: '0 Requests · 0 Byte Transfer (DevTools-prüfbar)' },
      { label: 'Externe Quellen', value: 'Keine CDNs, keine Webfonts, keine Cloud-APIs' },
      { label: 'Kundendaten', value: 'Keine Vorbefüllung mit fremden Nummern oder Namen' },
      { label: 'Integrität', value: 'Einzeldatei direkt per SHA-256 hash- & archivierbar' },
    ],
    snippetTitle: 'SINGLE-FILE BUILD-KONFIGURATION (ZERO CHUNKS)',
    snippetCode: `build: {
  cssCodeSplit: false,
  assetsInlineLimit: 100_000_000,
  rollupOptions: {
    output: { inlineDynamicImports: true, manualChunks: undefined },
  },
}`,
  },
];

const WORKFLOW_STEPS: WorkflowStepSpec[] = [
  {
    id: 'step-1',
    stepNumber: '01',
    shortTitle: 'Offline-HTML bauen',
    subtitle: 'Alle Engines inline',
    detailTitle: '01 · Einzeldatei-HTML mit Voreinstellungen erzeugen',
    summary:
      'Der Offline-Builder bündelt React 19, Tailwind-Styles, Mermaid.js v11, Eclipse ELK, JSZip sowie den Parser für Avaya-.s-Skripte synchron in eine einzige portable .html-Datei.',
    facts: [
      { label: 'Artefakt', value: '1 eigenständige HTML5-Datei (0 externe Chunks)' },
      { label: 'Optionale Vorgaben', value: 'Arbeitsmodus, helles/dunkles Theme & Farbmodus' },
    ],
    codeTitle: 'INLINE-AUFBAU DER OFFLINE-HTML',
    code: `<style id="mermaid-offline-app-style">/* Kompiliertes Studio-CSS */</style>
<script id="mermaid-offline-flag">window.__IS_OFFLINE_SINGLEFILE__ = true;</script>
<script id="mermaid-offline-app-script">/* Vollständiges Studio-Bundle */</script>`,
  },
  {
    id: 'step-2',
    stepNumber: '02',
    shortTitle: 'Lokal öffnen (file://)',
    subtitle: 'Direktstart per Doppelklick',
    detailTitle: '02 · Direktstart über das lokale Dateisystem (file://)',
    summary:
      'Beim Öffnen der heruntergeladenen Datei startet das System sofort das komplette Callflow-Studio — ohne Node.js, ohne Webserver und ohne Netzwerkverbindung. Funktioniert in Chrome, Edge und Firefox.',
    facts: [
      { label: 'Start-Erkennung', value: 'window.__IS_OFFLINE_SINGLEFILE__ || file://' },
      { label: 'Umgebung', value: 'Windows, macOS, Linux, Sprungserver & Offline-VMs' },
    ],
    codeTitle: 'OFFLINE-ENTRY-ERKENNUNG',
    code: `export function App() {
  const isOfflineSingleFile = useMemo(() => isRunningAsOfflineSingleFile(), []);
  const initialShell = useMemo(() => (isOfflineSingleFile ? getInitialOfflineShellView() : 'builder'), [isOfflineSingleFile]);
  if (!isOfflineSingleFile || initialShell === 'builder') return <LocalHtmlBuilderLanding />;
  return <OfflineStudioApp />;
}`,
  },
  {
    id: 'step-3',
    stepNumber: '03',
    shortTitle: 'Im RAM parsen & prüfen',
    subtitle: '.s, Visio & Öffnungszeiten',
    detailTitle: '03 · Skripte, Ordner & Visio lokal im Browser-RAM analysieren',
    summary:
      'Avaya-.s-Skripte, komplette Skript-Verzeichnisse und Visio-Dateien (.vsdx) werden per HTML5 FileReader im Arbeitsspeicher verarbeitet, als 2-Ebenen-Callflow visualisiert und auf Öffnungszeiten sowie Routing-Logik geprüft.',
    facts: [
      { label: 'Zeichenkodierung', value: 'Auto-Detect UTF-8, Windows-1252 & ISO-8859-1' },
      { label: 'Rekursion', value: 'BFS-Ordner-Resolver lädt nur aktive Zielskripte' },
    ],
    codeTitle: 'IN-MEMORY PARSING & LIVE-ANALYSE',
    code: `const buffer = await file.arrayBuffer();
const text = decodeCallflowBufferWithFallback(buffer);
const modules = parseCallflowTextWithFallback(text, { isMasterHint: true });
const workspace = buildScriptWorkspace(modules);`,
  },
  {
    id: 'step-4',
    stepNumber: '04',
    shortTitle: 'Offline exportieren',
    subtitle: 'Callflow.html, CSV & Kopie',
    detailTitle: '04 · Interaktive Callflow.html, Tabellen & Projekt-Kopien sichern',
    summary:
      'Aus der lokalen Offline-App heraus lassen sich jederzeit interaktive Read-Only Callflow.html-Viewer (inkl. Pfad-Tracing, Suche & Öffnungszeiten), Excel-CSVs, Markdown-Doku sowie neue Offline-App-Projekt-Snapshots (DOM-Quine) erzeugen.',
    facts: [
      { label: 'Fachbereichs-Viewer', value: 'Callflow.html mit vor-gerenderten SVGs, Suche & Zeiten' },
      { label: 'Projekt-Kopie', value: 'Rekonstruiert sich offline direkt aus dem DOM neu' },
    ],
    codeTitle: 'SELF-REPLICATING OFFLINE-EXPORT (DOM-QUINE)',
    code: `// Läuft komplett offline unter file:// ohne Server-Fetch:
const baseHtml = reconstructHtmlFromActiveOfflineDocument();
const finalHtml = injectWorkspaceSeedIntoOfflineHtml(baseHtml, fullSeed);
triggerLocalDownload(new Blob([finalHtml], { type: 'text/html' }), filename);`,
  },
];

const ARCH_INSPECTOR_TABS: ArchInspectorSpec[] = [
  {
    id: 'mermaid-elk',
    label: '1. Mermaid & ELK Layout',
    title: 'Dual-Layer SVG/Canvas2D Rendering & Sugiyama-Layout',
    summary:
      'Mermaid v11 kompiliert die erzeugte Flowchart-Struktur lokal in standardkonformes Vektor-SVG. Für komplexe Routing-Bäume stehen Dagre und Eclipse ELK.js lokal eingebettet bereit.',
    bullets: [
      'Schaltet ab > 80 Knoten automatisch von HTML-foreignObject auf native SVG-<text>-Knoten um und verhindert Browser-Lags.',
      'GPU-beschleunigter Canvas2D-Proxy sorgt bei großen Callflows für flüssiges Panning & Zoomen; im Ruhezustand bleibt gestochen scharfes Vektor-SVG aktiv.',
      'Semantische Farbmodi klassifizieren Einstiege, Queues, Zeitpläne, Feiertage und DTMF-Menüs konsistent auf dunkler und heller Oberfläche.',
    ],
    fileHint: 'src/utils/mermaidEngine.ts',
    code: `// Automatische Skalierung & strikter Sicherheitsmodus:
const isLargeDiagram = nodeEstimate > 80 || lineCount > 140;
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  flowchart: {
    htmlLabels: !isLargeDiagram,
    nodeSpacing: isLargeDiagram ? 32 : 46,
    rankSpacing: isLargeDiagram ? 44 : 62,
  },
});`,
  },
  {
    id: 'avaya-parser',
    label: '2. Parser für Avaya-.s-Skripte',
    title: 'Mehrstufiger Lexer & 2-Ebenen-Callflow-Transpiler',
    summary:
      'Ein spezialisierter Parser liest Avaya-.s- und .txt-Routing-Skripte lokal ein, erkennt Kontrollstrukturen, Zeitfenster, DTMF-Menüs sowie Zielsprünge und erstellt daraus Master- und Detail-Ansichten.',
    bullets: [
      'Parst ASSIGN-Direktiven (Skillsets, Überläufe, Musik, Mandanten), IF/WHERE/VALUE-Zweige und CALL-/EXECUTE-Sprünge.',
      'Trennt übergeordnete Gesellschaften (Mandanten/Vorwahlbereiche) sauber von darunterliegenden Fach-Teams und Skillsets.',
      'Verknüpft skriptübergreifende SondZeit-Variablen und Feiertagsprüfungen direkt als klickbare Knoten im Diagramm.',
    ],
    fileHint: 'src/utils/scriptCallflowParser.ts',
    code: `// Beispiel-Eingabe (.s-Routing-Skript):
IF DNIS_Range_MandantA THEN
  assign 100xxxx to src_route_number
  assign Mandant_A to Sys_brand
END IF
VALUE 1001234 : execute Script Service_Menu

// Erzeugte Mermaid-Kante (Ebene 1 & 2):
S_Main(["★ [Main] Einstieg"]) -->|"[Mandant_A] 1001234"| S_Service_Menu`,
  },
  {
    id: 'singlefile-export',
    label: '3. Single-File-Bundle & Offline-Export',
    title: 'Reiner Offline-Export & Self-Replicating Projekt-Snapshots',
    summary:
      'Sowohl der initiale Download hier als auch der spätere Projekt-Export direkt aus der offenen file://-Datei nutzen dieselbe schlüssige Single-File-Architektur ohne Server-Abhängigkeit.',
    bullets: [
      'In der laufenden Offline-App liest reconstructHtmlFromActiveOfflineDocument() das aktive Inline-Skript und Stylesheet direkt aus dem DOM aus.',
      'Optional wird der komplette Projektstand (Module, Layout-Offsets, Checkliste, Speicherstände) XSS-sicher als window.__MERMAID_OFFLINE_SEED__ eingebettet.',
      'Zusätzlich erzeugt der Callflow.html-Export einen eigenständigen Read-Only-Viewer für Fachabteilungen inkl. Pfad-Tracing, Globaler Suche und Öffnungszeiten.',
    ],
    fileHint: 'src/utils/offlineAppExporter.ts',
    code: `if (isRunningAsOfflineSingleFile()) {
  // 100 % offline: klont die aktive Datei direkt aus dem DOM
  baseHtml = reconstructHtmlFromActiveOfflineDocument();
}
if (options.includeWorkspaceSeed && options.seed) {
  finalHtml = injectWorkspaceSeedIntoOfflineHtml(baseHtml, fullSeed);
}`,
  },
];

const EMBEDDED_MODULES: EmbeddedModuleSpec[] = [
  {
    id: 'mermaid-elk',
    category: 'engine',
    categoryLabel: 'Layout & Rendering',
    title: 'Mermaid.js v11 & Dagre / ELK.js Layout',
    versionTag: 'Mermaid 11.12 · ELK 0.9+',
    pipelineLine: 'Flowchart AST → Dagre / Eclipse ELK → Vektor-SVG & Canvas2D GPU-Proxy',
    description:
      'Vollständig eingebettete Graphen-Engine für hierarchische Callflows und freie Mermaid-Diagramme. Berechnet kreuzungsarme Layouts rein lokal im Browser.',
    capabilities: [
      'Unterstützt Dagre (Sugiyama) und Eclipse ELK Layered mit anpassbaren Abständen und Kurvenstilen',
      'Dual-Layer Rendering: Gestochen scharfes SVG im Ruhezustand, 60-FPS Canvas2D-Proxy beim Pan/Zoom',
      '4 semantische Farbmodi (Rollen, Zweige/Mandanten, Hochkontrast, Standard) für dunkle & helle Flächen',
    ],
    facts: [
      { label: 'Sicherheitsstufe', value: 'securityLevel: "strict"' },
      { label: 'Großgraphen', value: 'Auto-Textmodus ab > 80 Knoten' },
      { label: 'Interaktion', value: 'Live Drag-Offsets & 4-Seiten-Ports' },
    ],
    codeTitle: 'SEMANTISCHE KNOTEN-KLASSEN',
    code: `classDef roleEntry fill:#065f46,stroke:#10b981,color:#ecfdf5;
classDef roleQueue fill:#312e81,stroke:#818cf8,color:#eef2ff;
classDef roleSchedule fill:#451a03,stroke:#f59e0b,color:#fef3c7;`,
  },
  {
    id: 'avaya-parser',
    category: 'parsers',
    categoryLabel: 'Skript- & Visio-Parser',
    title: 'Parser für Avaya-.s-Skripte (.s & .txt)',
    versionTag: 'Mehrstufiger Lexer & AST-Transpiler',
    pipelineLine: 'Kommentar-Filter → Regel-State-Machine → 2-Ebenen Mermaid-Callflow',
    description:
      'Spezialisierter lokaler Parser für klassische Contact-Center-.s- und .txt-Skripte. Wandelt Kontrollstrukturen, Skillset-Zuweisungen und Zielsprünge in Master- und Detail-Ansichten um.',
    capabilities: [
      'Extrahiert ASSIGN-Regeln, Skillsets, Überläufe, Wartemusik, Ansagen (RAN) und DTMF-Menüpunkte',
      'Trennt Mandanten/Gesellschaften zuverlässig von Fach-Teams und fragt erkannte Strukturen beim Import ab',
      'Erzeugt Ebene 1 (Master-Topologie) und Ebene 2 (Skript-Detailgraph mit Klick-Drilldown)',
    ],
    facts: [
      { label: 'Dateiformate', value: '.s, .txt, .mmd, .csv, .tsv, .json' },
      { label: 'Kodierungen', value: 'UTF-8, Windows-1252, ISO-8859-1' },
      { label: 'Ebenen', value: 'Master Kompakt · Master Detail · Skript-Detail' },
    ],
    codeTitle: 'TRANSPILIERUNG VON DTMF- & ZIELSPRÜNGEN',
    code: `CHOICE_1040_1(["1: Service-Anliegen"]) --> JUMP_2010
QUEUE_S_Service[("🎧 Queue: S_Service")]
S_1040 -->|"Taste 1"| CHOICE_1040_1`,
  },
  {
    id: 'visio-folder',
    category: 'parsers',
    categoryLabel: 'Skript- & Visio-Parser',
    title: 'OpenXML Visio-Parser (.vsdx / .vdx) & Ordner-Crawler',
    versionTag: 'JSZip 3.10 · DOMParser XML',
    pipelineLine: 'ArrayBuffer → In-Memory ZIP-Inflate → Shape/Connect-Graph & BFS-Resolver',
    description:
      'Liest komprimierte Visio-Dateien sowie komplette lokale Skript-Ordner direkt im Browser-RAM aus und löst verknüpfte Folgeskripte rekursiv auf.',
    capabilities: [
      'Rekonstruiert Visio-Seiten aus <Shape>-Textzellen und <Connect>-Kantenbeziehungen ohne Microsoft Visio',
      'BFS-Ordner-Resolver lädt ausgehend vom Main-Skript nur aktiv referenzierte Folgeskripte nach',
      'Weist nicht referenzierte Altlast-Dateien aus großen Ordnern transparent im Import-Bericht aus',
    ],
    facts: [
      { label: 'Visio-Struktur', value: 'visio/pages/page*.xml & rels' },
      { label: 'Ordner-Index', value: '600+ Dateien in < 150 ms im RAM' },
      { label: 'Auflösung', value: 'Breadth-First-Search (BFS) entlang aktiver Sprünge' },
    ],
    codeTitle: 'REKURSIVER BFS-ORDNER-RESOLVER',
    code: `while (queue.length > 0) {
  const targetRef = queue.shift()!;
  const entry = folderPool.byCanonicalKey.get(canonicalScriptMatchKey(targetRef));
  if (entry && !loadedKeys.has(entry.canonicalKey)) {
    const parsed = await importCallflowFile(entry.file);
    mergedModules.push(...parsed.modules);
  }
}`,
  },
  {
    id: 'opening-hours',
    category: 'analysis',
    categoryLabel: 'Analyse & Zeiten',
    title: 'Öffnungszeiten-, SondZeit- & Feiertags-Solver',
    versionTag: 'Cross-Script Lookup · Excel-CSV',
    pipelineLine: 'Zeit-Extraktor → SondZeit-Auflösung → SCHED_ / HOLIDAY_ Knoten & Modal',
    description:
      'Extrahiert Wochentags-, Uhrzeit-, Sonderzeit- und Feiertagsregeln skriptübergreifend, normalisiert Zeitangaben und stellt sie in einer durchsuchbaren Übersicht bereit.',
    capabilities: [
      'Eigenständiges Öffnungszeiten-Modal mit Suche, Status-Filtern und 1-Klick-Deep-Link ins Skript',
      'Normalisiert Minuten- und Bereichsangaben (z. B. 08:00–17:59 Uhr) und löst SondZeit-Referenzen über Master/Sub-Skripte auf',
      'Exportiert alle erkannten Zeiten als Excel-kompatible UTF-8-BOM CSV oder Markdown-Tabelle',
    ],
    facts: [
      { label: 'Diagramm-Knoten', value: 'Dedizierte SCHED_ & HOLIDAY_ Subknoten' },
      { label: 'Fehlende Definition', value: 'Meldet offene SondZeit-Variablen in der Prüfung' },
      { label: 'Export', value: 'Callflow-Oeffnungszeiten.csv (UTF-8 BOM)' },
    ],
    codeTitle: 'ZEIT- & FEIERTAGS-SUBKNOTEN',
    code: `SCHED_1040_1(["🕒 Mo–Fr 08:00–17:59 Uhr"])
HOLIDAY_1040_1(["📅 Feiertagsprüfung: Bundesweit"])
SCHED_1040_1 -->|Innerhalb Öffnungszeit| QUEUE_S_Service`,
  },
  {
    id: 'search-minimap-health',
    category: 'analysis',
    categoryLabel: 'Analyse & Zeiten',
    title: 'Globale Suche, GPU-Minimap & Logikprüfung',
    versionTag: 'Strg+K · Minimap (M) · DFS-Zyklustest',
    pipelineLine: 'Cross-Ref-Index → Sofortsuche / Minimap-Viewport / Erreichbarkeits-Prüfung',
    description:
      'Beschleunigt die Arbeit in großen Multi-Skript-Projekten durch globale Tastatur-Suche, interaktive Minimap, einklappbare Seitenleiste und statische Routing-Prüfung.',
    capabilities: [
      'Globale Suche (Strg+K) über alle Skripte, DNIS-Nummern, Skillsets, Ansagen, Variablen und Öffnungszeiten',
      'GPU-Minimap (M) mit ziehbarem Viewport-Rahmen sowie Vollbildmodus (F) und Sidebar-Toggle (B)',
      'Statische Logikprüfung erkennt fehlende Zielskripte, Zyklen (DFS), Sackgassen und pflegt ein Ressourcen-Register',
    ],
    facts: [
      { label: 'Tastenkürzel', value: 'Strg+K Suche · M Minimap · B Sidebar · F Vollbild' },
      { label: 'Zyklus-Check', value: 'DFS Recursion-Stack Pfad-Analyse (A → B → A)' },
      { label: 'Register', value: 'Skillsets · Ansagen/RAN · Variablen · Caller/Callee' },
    ],
    codeTitle: 'STATISCHE ENDPOINT-VALIDIERUNG',
    code: `const hasValidOutcome = Boolean(
  rule.targetScriptNumber ||
  rule.queueTarget ||
  rule.overflowQueueTarget ||
  rule.assignedVariables?.length ||
  rule.menuChoices?.length
);`,
  },
  {
    id: 'offline-exports',
    category: 'exports',
    categoryLabel: 'Offline-Exporte',
    title: 'Callflow.html-Viewer, CSV/MD & Self-Replicating Export',
    versionTag: 'DOM-Quine · SVG/PNG · CSV · Markdown',
    pipelineLine: 'Pre-Baked SVGs / Active DOM → Standalone Callflow.html oder Studio-Snapshot',
    description:
      'Erzeugt sämtliche Dokumentations- und Übergabeformate vollständig lokal im Browser — vom schreibgeschützten Fachbereichs-Viewer bis zur neuen Offline-App-Projektkopie.',
    capabilities: [
      'Interaktive Callflow.html (Read-Only): Vor-gerenderte 2-Ebenen-SVGs, Pfad-Tracing, Suche & Öffnungszeiten-CSV',
      'Offline-App Projekt-Kopie (.html): Speichert den aktuellen Arbeitsstand direkt aus file:// als neue Offline-App',
      'Vektor-SVG, High-DPI PNG (1x/2x/4x), Routing-Matrix (.csv), Öffnungszeiten (.csv) und Abnahme-Doku (.md)',
    ],
    facts: [
      { label: 'DOM-Quine', value: 'Erstellt neue Offline-App ohne Server-Zugriff' },
      { label: 'XSS-Schutz', value: 'Escape für </script>, <!-- & Unicode-Umbrüche' },
      { label: 'Formate', value: '.html · .svg · .png · .csv · .md · .mmd · .json' },
    ],
    codeTitle: 'XSS-SICHERE SEED-EINBETTUNG IM OFFLINE-EXPORT',
    code: `const safeSeedJson = JSON.stringify(seedPayload)
  .replace(/</g, '\\\\u003C')
  .replace(/>/g, '\\\\u003E')
  .replace(/&/g, '\\\\u0026');`,
  },
];

const LEGAL_TRADEMARK_COPY_TEXT = [
  'Marken-, Unabhängigkeits- & Nutzungshinweis (Internes Offline-Projektwerkzeug):',
  '• Unabhängiges Werkzeug: MermaidFree2UseOpen ist ein unabhängiges internes Projektwerkzeug für reine Offline-Nutzung (file://). Es besteht keine Verbindung, Partnerschaft, Zertifizierung oder Unterstützung durch Avaya Inc., Microsoft Corporation oder sonstige Rechteinhaber.',
  '• Deskriptive Markennennung (§ 23 MarkenG): Nennungen wie „Avaya“, „Avaya Aura Contact Center (AACC)“ oder „Microsoft Visio“ dienen ausschließlich der technischen Beschreibung der Dateikompatibilität (Parser für Avaya-.s-Skripte und .vsdx-Dateien). Alle Marken sind Eigentum ihrer jeweiligen Inhaber.',
  '• Reiner Offline-Betrieb & Vertraulichkeit: Das Werkzeug wird ausschließlich lokal ohne Server-Übertragung (0 Byte Netzwerkverkehr) betrieben. Kundenskripte und Exporte unterliegen den internen Vertraulichkeits- und Freigaberichtlinien des jeweiligen Projekts.',
  '• Open-Source-Basis: Eingebundene Bibliotheken (u. a. Mermaid.js, Eclipse ELK, JSZip, React) stehen unter ihren jeweiligen Open-Source-Lizenzen (MIT / EPL-2.0). Es sind keine geschützten fremden Programmteile oder Kundendaten enthalten.',
].join('\n');

async function copyTextWithOfflineFallback(text: string): Promise<boolean> {
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

export const LocalHtmlBuilderLanding: React.FC = () => {
  const cachedProject = useMemo(() => inspectCachedStudioProject(), []);
  const [importedRecoverySeed, setImportedRecoverySeed] = useState<Omit<
    OfflineWorkspaceSeed,
    'seedId' | 'exportedAt' | 'initialShellView'
  > | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const effectiveSeedSource = importedRecoverySeed ?? (cachedProject.hasProjectData ? cachedProject.seedPayload : null);
  const [embedCachedProject, setEmbedCachedProject] = useState<boolean>(
    () => cachedProject.hasProjectData
  );

  // Builder configuration state
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
  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  const [buildResult, setBuildResult] = useState<{
    filename: string;
    sizeMb: string;
    timestamp: string;
  } | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  // Interactive UI state (Top-Header-Only View Switcher)
  const [activeTopSpecId, setActiveTopSpecId] = useState<TopTechSpecId | null>(null);
  const [activeView, setActiveView] = useState<OfflineLandingView>('builder');

  // Architecture & Workflow state
  const [activeWorkflowStepId, setActiveWorkflowStepId] = useState<string>('step-1');
  const [activeArchTab, setActiveArchTab] = useState<ArchInspectorTab>('mermaid-elk');

  // Modules Master-Detail state
  const [activeModuleCategory, setActiveModuleCategory] = useState<ModuleCategory>('all');
  const [selectedModuleId, setSelectedModuleId] = useState<string>('mermaid-elk');

  // Legal copy state
  const [copiedLegalNotice, setCopiedLegalNotice] = useState<boolean>(false);

  const normalizedFilename = useMemo(() => {
    const trimmed = customFilename.trim();
    if (!trimmed) return 'MermaidFree2UseOpen_Offline.html';
    const safe = trimmed.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_');
    return safe.toLowerCase().endsWith('.html') ? safe : `${safe}.html`;
  }, [customFilename]);

  const activeTopSpec =
    TOP_TECH_SPECS.find((spec) => spec.id === activeTopSpecId) ?? null;

  const activeWorkflowStep =
    WORKFLOW_STEPS.find((step) => step.id === activeWorkflowStepId) ??
    WORKFLOW_STEPS[0];

  const activeArchSpec =
    ARCH_INSPECTOR_TABS.find((tab) => tab.id === activeArchTab) ??
    ARCH_INSPECTOR_TABS[0];

  const filteredModules = useMemo(
    () =>
      activeModuleCategory === 'all'
        ? EMBEDDED_MODULES
        : EMBEDDED_MODULES.filter((mod) => mod.category === activeModuleCategory),
    [activeModuleCategory]
  );

  const activeModule =
    filteredModules.find((mod) => mod.id === selectedModuleId) ??
    filteredModules[0] ??
    EMBEDDED_MODULES[0];

  const handleSelectModuleCategory = (category: ModuleCategory) => {
    setActiveModuleCategory(category);
    const nextList =
      category === 'all'
        ? EMBEDDED_MODULES
        : EMBEDDED_MODULES.filter((mod) => mod.category === category);
    if (nextList.length > 0 && !nextList.some((m) => m.id === selectedModuleId)) {
      setSelectedModuleId(nextList[0].id);
    }
  };

  const handleSwitchHeaderView = (target: OfflineLandingView) => {
    setActiveView(target);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleImportRecoveryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBuildError(null);
    setRecoveryNotice(null);
    try {
      const extracted = await extractSeedFromRecoveryFile(file);
      if (!extracted) {
        setBuildError(
          `In "${file.name}" wurden keine gespeicherten Projektdaten (__MERMAID_OFFLINE_SEED__ oder JSON-Backup) gefunden.`
        );
        return;
      }
      setImportedRecoverySeed(extracted);
      setEmbedCachedProject(true);
      const modCount = extracted.scriptWorkspace?.modules?.length ?? 0;
      setRecoveryNotice(
        `Stand "${extracted.diagramTitle}" (${modCount} Skripte) aus "${file.name}" geladen.`
      );
    } catch (err) {
      setBuildError(
        err instanceof Error
          ? err.message
          : 'Die Sicherungsdatei konnte nicht gelesen werden.'
      );
    }
  };

  const handleBuildAndDownload = async () => {
    if (isBuilding) return;
    setIsBuilding(true);
    setBuildError(null);

    try {
      const shouldEmbedProject = Boolean(effectiveSeedSource) && embedCachedProject;
      const baseStudioSeed = shouldEmbedProject && effectiveSeedSource
        ? {
            ...effectiveSeedSource,
            smartColorMode: defaultSmartColorMode,
            canvasSurface: defaultCanvasSurface,
            workspaceMode: defaultWorkspaceMode,
          }
        : {
            diagramTitle: 'Neuer Callflow',
            code: '',
            themeConfig: DEFAULT_THEME_CONFIG,
            smartColorMode: defaultSmartColorMode,
            hiddenSmartNodeTypes: [],
            canvasSurface: defaultCanvasSurface,
            workspaceMode: defaultWorkspaceMode,
            scriptWorkspace: buildScriptWorkspace([]),
            savedDiagrams: [],
          };

      const result = await buildAndDownloadOfflineApp({
        includeWorkspaceSeed: true,
        seed: {
          initialShellView: 'studio',
          ...baseStudioSeed,
        },
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

  const handleCopyLegalNotice = async () => {
    const ok = await copyTextWithOfflineFallback(LEGAL_TRADEMARK_COPY_TEXT);
    if (ok) {
      setCopiedLegalNotice(true);
      window.setTimeout(() => setCopiedLegalNotice(false), 2200);
    }
  };

  const headerViews: Array<{ id: OfflineLandingView; label: string }> = [
    { id: 'builder', label: 'Offline-Builder' },
    { id: 'audit', label: 'Vollständiger IT-Audit' },
    { id: 'architecture', label: 'Architektur & Datenfluss' },
    { id: 'modules', label: 'Module & Rechtliches' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* 3-Zone Top Bar (Single Header View Switcher) */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/95 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => handleSwitchHeaderView('builder')}
            className="text-sm sm:text-base font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0 cursor-pointer hover:text-white transition-colors"
          >
            MermaidFree2UseOpen
          </button>

          {/* Zone 2: Primary View Navigation (Header-Only Switching) */}
          <nav
            aria-label="Hauptnavigation"
            className="hidden md:flex items-center gap-5"
          >
            {headerViews.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSwitchHeaderView(item.id)}
                  className={`py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'border-emerald-400 text-slate-50'
                      : 'border-transparent text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Version */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px] font-mono text-slate-400 tabular-nums whitespace-nowrap">
              Version {AUDIT_APP_VERSION}
            </span>
          </div>
        </div>

        {/* Compact Mobile View Switcher within Header */}
        <nav
          aria-label="Mobile Hauptnavigation"
          className="md:hidden border-t border-slate-800/80 px-4 py-1.5 flex items-center gap-4 overflow-x-auto"
        >
          {headerViews.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSwitchHeaderView(item.id)}
                className={`py-1 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'border-emerald-400 text-slate-50'
                    : 'border-transparent text-slate-400'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        {activeView === 'builder' && (
          <>
        {/* ABOVE THE FOLD: Compact Intro + Offline-HTML-Builder */}
        <section
          id="builder"
          className="scroll-mt-20 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
        >
          {/* Left Column: Value Prop + 4 Interactive Spec Cards */}
          <div className="lg:col-span-7 space-y-5">
            <div className="space-y-2.5">
              <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 tabular-nums">
                Version {AUDIT_APP_VERSION} · Reine Offline-Anwendung · file:// Einzeldatei · 0 Byte Netzwerkverkehr
              </p>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-50 leading-tight">
                Offline-Callflow-Studio für Avaya-.s-Skripte, Visio &amp; Mermaid
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
                Dieses Werkzeug wird ausschließlich als lokale Offline-HTML-Datei
                ausgeführt. Laden Sie Ihr konfiguriertes Einzeldatei-Paket herunter und
                starten Sie Analyse, Öffnungszeiten-Auswertung, Logikprüfung und
                Callflow.html-Exporte per Doppelklick ohne Internet oder Installation.
              </p>
            </div>

            {/* 4 Interactive Technical Spec Cards */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Technische Eckdaten (für Details anklicken)</span>
                {activeTopSpec && (
                  <button
                    type="button"
                    onClick={() => setActiveTopSpecId(null)}
                    className="text-slate-400 hover:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Details schließen</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {TOP_TECH_SPECS.map((spec) => {
                  const isActive = activeTopSpecId === spec.id;
                  return (
                    <button
                      key={spec.id}
                      type="button"
                      onClick={() =>
                        setActiveTopSpecId((prev) =>
                          prev === spec.id ? null : spec.id
                        )
                      }
                      aria-expanded={isActive}
                      className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-slate-900 border-emerald-500/70'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="text-[11px] font-medium text-slate-400">
                        {spec.label}
                      </div>
                      <div
                        className={`text-sm font-semibold mt-1 font-mono tabular-nums ${spec.accentClass}`}
                      >
                        {spec.value}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                        {spec.sublabel}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Expandable Spec Detail Panel */}
              {activeTopSpec && (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold text-slate-100">
                        {activeTopSpec.title}
                      </h2>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {activeTopSpec.summary}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {activeTopSpec.facts.map((fact) => (
                      <div
                        key={fact.label}
                        className="px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800/80"
                      >
                        <div className="text-[11px] text-slate-400">{fact.label}</div>
                        <div className="text-xs font-medium text-slate-100 mt-0.5">
                          {fact.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-2 text-[11px] font-mono text-slate-400">
                      <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{activeTopSpec.snippetTitle}</span>
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                      {activeTopSpec.snippetCode}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Compact Offline-HTML-Builder Configurator */}
          <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Offline-HTML-Builder
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Start-Voreinstellungen für Ihre lokale Einzeldatei wählen
                </p>
              </div>
              <span className="text-[11px] font-mono text-emerald-300 whitespace-nowrap shrink-0">
                file:// ready
              </span>
            </div>

            {/* Filename Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="offline-filename-input"
                  className="font-medium text-slate-300"
                >
                  Dateiname (Studio &amp; Callflow.html-Builder)
                </label>
                <span className="text-[11px] font-mono text-slate-400 truncate max-w-[200px]">
                  {normalizedFilename}
                </span>
              </div>
              <input
                id="offline-filename-input"
                type="text"
                value={customFilename}
                onChange={(e) => setCustomFilename(e.target.value)}
                placeholder="MermaidFree2UseOpen_Offline.html"
                className="w-full px-3 py-2 text-xs font-mono text-slate-100 bg-slate-950 border border-slate-800 rounded-lg focus:outline-none focus:border-emerald-500/70"
              />
            </div>

            {/* Workspace Mode */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300 block">
                Standard-Arbeitsmodus im Studio
              </span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'guided' as const, label: 'Geführt (Callflow)' },
                  { id: 'free' as const, label: 'Freier Editor' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDefaultWorkspaceMode(opt.id)}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      defaultWorkspaceMode === opt.id
                        ? 'bg-emerald-500/15 border-emerald-500/70 text-emerald-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Surface & Smart Color Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-300 block">
                  Zeichenfläche
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { id: 'dark' as const, label: 'Dunkel' },
                    { id: 'light' as const, label: 'Hell' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDefaultCanvasSurface(opt.id)}
                      className={`py-1.5 px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        defaultCanvasSurface === opt.id
                          ? 'bg-indigo-500/15 border-indigo-500/70 text-indigo-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-300 block">
                  Farblogik
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { id: 'semantic' as const, label: 'Semantisch' },
                    { id: 'clusters' as const, label: 'Cluster' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDefaultSmartColorMode(opt.id)}
                      className={`py-1.5 px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        defaultSmartColorMode === opt.id
                          ? 'bg-indigo-500/15 border-indigo-500/70 text-indigo-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {effectiveSeedSource && (
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-950/35 border border-emerald-500/40 text-xs text-emerald-100 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={embedCachedProject}
                  onChange={(e) => setEmbedCachedProject(e.target.checked)}
                  className="mt-0.5 rounded border-emerald-500/60 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
                />
                <span className="leading-relaxed">
                  Vorhandenes Projekt einbetten (
                  <span className="font-semibold text-white">
                    {effectiveSeedSource.diagramTitle}
                  </span>
                  {(effectiveSeedSource.scriptWorkspace?.modules?.length ?? 0) > 0 &&
                    ` · ${effectiveSeedSource.scriptWorkspace.modules.length} Skripte`}
                  {(effectiveSeedSource.savedDiagrams?.length ?? 0) > 0 &&
                    ` · ${effectiveSeedSource.savedDiagrams.length} Entwürfe`}
                  )
                </span>
              </label>
            )}

            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-400">
                Optional: Sicherung (.json / ältere Offline.html) laden
              </span>
              <label className="px-2.5 py-1 rounded-md border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0">
                <FolderUp className="w-3.5 h-3.5 text-indigo-400" />
                <span>Stand laden</span>
                <input
                  type="file"
                  accept=".json,.html,.htm"
                  onChange={handleImportRecoveryFile}
                  className="hidden"
                />
              </label>
            </div>

            {recoveryNotice && (
              <p className="text-[11px] font-mono text-emerald-300">{recoveryNotice}</p>
            )}

            {/* Build Action: Pure Studio / Callflow.html Builder Offline HTML */}
            <button
              type="button"
              disabled={isBuilding}
              onClick={handleBuildAndDownload}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              {isBuilding ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Offline-HTML wird gebündelt...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Offline-HTML laden (Callflow-Studio)</span>
                </>
              )}
            </button>

            {buildResult && (
              <div className="px-3 py-2.5 rounded-lg bg-emerald-950/50 border border-emerald-500/40 text-xs text-emerald-200 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium truncate">{buildResult.filename}</div>
                  <div className="text-[11px] text-emerald-300/90 font-mono tabular-nums mt-0.5">
                    {buildResult.sizeMb} MB · erstellt um {buildResult.timestamp} · per
                    Doppelklick lokal öffnen
                  </div>
                </div>
              </div>
            )}

            {buildError && (
              <div className="px-3 py-2.5 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200">
                {buildError}
              </div>
            )}

            <p className="text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-slate-800">
              In der heruntergeladenen Datei bleibt die Export-Funktion vollständig
              erhalten: Sie können jederzeit Projekt-Momentaufnahmen (.html), saubere
              Offline-Kopien oder interaktive Callflow.html-Viewer direkt aus{' '}
              <span className="font-mono text-slate-300">file://</span> heraus speichern.
            </p>
          </div>
        </section>

        {/* Quick Access Strip to Full IT Audit without secondary sub-tabs */}
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Vollständiges IT-Audit- &amp; Konzern-Freigabe-Dossier</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
              Alle 4 Normen (DSGVO, ISO/IEC 27001:2022, NIS2, BSI IT-Grundschutz),
              reine Fakten nach Fachbereichen, Quellcode-Belege mit Code-Inspect,
              Open-Source-SBOM, Avaya-/Visio-Datenerklärung sowie Gesamtbericht-Export (.md / .html).
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleSwitchHeaderView('audit')}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start md:self-auto"
          >
            Vollständigen IT-Audit öffnen
          </button>
        </section>
          </>
        )}

        {/* VIEW 2: VOLLSTÄNDIGER IT-AUDIT */}
        {activeView === 'audit' && (
          <OfflineAuditSection onCopyText={copyTextWithOfflineFallback} />
        )}

        {/* VIEW 3: ARCHITEKTUR & OFFLINE-DATENFLUSS */}
        {activeView === 'architecture' && (
          <section className="space-y-6">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
                Architektur &amp; Offline-Datenfluss
              </h1>
              <p className="text-xs sm:text-sm text-slate-400">
                Wie das Einzeldatei-Paket ohne Webserver startet, Skripte im RAM verarbeitet und
                Ergebnisse lokal exportiert.
              </p>
            </div>
              {/* Interactive 4-Step Offline Lifecycle */}
              <div className="space-y-3">
                <div className="text-xs font-medium text-slate-300">
                  Offline-Datenfluss in 4 Schritten (Schritt für Details anklicken)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {WORKFLOW_STEPS.map((step) => {
                    const isSelected = step.id === activeWorkflowStep.id;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setActiveWorkflowStepId(step.id)}
                        className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-slate-900 border-indigo-500/70'
                            : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                        }`}
                      >
                        <div className="text-[11px] font-mono tabular-nums text-indigo-400">
                          Schritt {step.stepNumber}
                        </div>
                        <div className="text-sm font-semibold text-slate-100 mt-1">
                          {step.shortTitle}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {step.subtitle}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Selected Workflow Step Detail */}
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                  <div className="lg:col-span-6 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-100">
                      {activeWorkflowStep.detailTitle}
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {activeWorkflowStep.summary}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {activeWorkflowStep.facts.map((fact) => (
                        <div
                          key={fact.label}
                          className="p-2.5 rounded-lg bg-slate-950/75 border border-slate-800"
                        >
                          <div className="text-[11px] text-slate-400">{fact.label}</div>
                          <div className="text-xs font-medium text-slate-100 mt-0.5">
                            {fact.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="lg:col-span-6 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-slate-800 text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                      <Code2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span>{activeWorkflowStep.codeTitle}</span>
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                      {activeWorkflowStep.code}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Technical Pipeline Inspector */}
              <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
                <div className="px-4 pt-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-200 pb-2">
                    Technischer Pipeline-Inspektor
                  </div>
                  <div className="flex items-center gap-1 overflow-x-auto">
                    {ARCH_INSPECTOR_TABS.map((tab) => {
                      const isActive = tab.id === activeArchSpec.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveArchTab(tab.id)}
                          className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            isActive
                              ? 'border-indigo-400 text-indigo-200'
                              : 'border-transparent text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  <div className="lg:col-span-6 space-y-3">
                    <h4 className="text-sm font-semibold text-slate-100">
                      {activeArchSpec.title}
                    </h4>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {activeArchSpec.summary}
                    </p>
                    <ul className="space-y-1.5 text-xs text-slate-300">
                      {activeArchSpec.bullets.map((bullet) => (
                        <li key={bullet} className="flex items-start gap-2">
                          <span className="text-indigo-400 select-none">•</span>
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="lg:col-span-6 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <span>Auszug</span>
                      <span className="text-slate-500">{activeArchSpec.fileHint}</span>
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                      {activeArchSpec.code}
                    </pre>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* VIEW 4: EINGEBUNDENE MODULE & RECHTLICHES */}
          {activeView === 'modules' && (
            <div className="space-y-8">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
                  Eingebundene Module &amp; Rechtliche Hinweise
                </h1>
                <p className="text-xs sm:text-sm text-slate-400">
                  Übersicht aller im Einzeldatei-Paket aktiven Fachmodule sowie Marken- und
                  Nutzungshinweise für den internen Einsatz.
                </p>
              </div>
              <div className="space-y-4">
              {/* Category Filter */}
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { id: 'all' as const, label: `Alle (${EMBEDDED_MODULES.length})` },
                  { id: 'engine' as const, label: 'Layout & Rendering' },
                  { id: 'parsers' as const, label: 'Skript- & Visio-Parser' },
                  { id: 'analysis' as const, label: 'Analyse & Zeiten' },
                  { id: 'exports' as const, label: 'Offline-Exporte' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleSelectModuleCategory(cat.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      activeModuleCategory === cat.id
                        ? 'bg-slate-900 border-sky-500/70 text-sky-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Master-Detail Split */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* Master List */}
                <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800/90 overflow-hidden">
                  {filteredModules.map((mod) => {
                    const isSelected = mod.id === activeModule.id;
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        onClick={() => setSelectedModuleId(mod.id)}
                        className={`w-full px-4 py-3 text-left transition-colors flex items-start justify-between gap-3 cursor-pointer ${
                          isSelected
                            ? 'bg-slate-800/90 text-slate-50'
                            : 'hover:bg-slate-800/40 text-slate-300'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] text-slate-400">
                            {mod.categoryLabel}
                          </div>
                          <div className="text-xs font-semibold text-slate-100 mt-0.5 flex items-center gap-1.5">
                            <span className="truncate">{mod.title}</span>
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-mono shrink-0 mt-1 ${
                            isSelected ? 'text-emerald-300' : 'text-slate-500'
                          }`}
                        >
                          {isSelected ? 'Aktiv' : '→'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Focused Detail View */}
                <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
                  <div className="space-y-1 pb-3 border-b border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-sky-300">
                        {activeModule.categoryLabel}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {activeModule.versionTag}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-slate-100">
                      {activeModule.title}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-400">
                      {activeModule.pipelineLine}
                    </p>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {activeModule.description}
                  </p>

                  <ul className="space-y-1.5 text-xs text-slate-200">
                    {activeModule.capabilities.map((cap) => (
                      <li key={cap} className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{cap}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {activeModule.facts.map((fact) => (
                      <div
                        key={fact.label}
                        className="p-2.5 rounded-lg bg-slate-950/75 border border-slate-800"
                      >
                        <div className="text-[11px] text-slate-400">{fact.label}</div>
                        <div className="text-xs font-medium text-slate-100 mt-0.5">
                          {fact.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
                    <div className="px-3 py-1.5 border-b border-slate-800 text-[11px] font-mono text-slate-400">
                      {activeModule.codeTitle}
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                      {activeModule.code}
                    </pre>
                  </div>
                </div>
              </div>
            </div>

          {/* MARKEN-, URHEBER- & NUTZUNGSHINWEIS */}
            <div className="space-y-4 pt-6 border-t border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Rechtliche Hinweise für interne Kundenprojekte (Offline-Betrieb)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Klare Trennung zwischen unabhängigem Projektwerkzeug, deskriptiver
                    Dateikompatibilität und interner Projektverantwortung.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLegalNotice}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
                >
                  {copiedLegalNotice ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Vermerk kopiert</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-300" />
                      <span>Vermerk kopieren</span>
                    </>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-100">
                    1. Markenrecht &amp; Unabhängigkeit
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    MermaidFree2UseOpen ist ein unabhängiges internes Projektwerkzeug. Es
                    besteht keine Verbindung, Partnerschaft, Zertifizierung oder
                    Unterstützung durch Avaya Inc., Microsoft Corporation oder sonstige
                    Rechteinhaber.
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Nennungen wie „Avaya“ oder „Visio“ erfolgen rein deskriptiv zur
                    Bezeichnung der unterstützten Dateiformate (§ 23 MarkenG). Alle Marken
                    bleiben Eigentum ihrer jeweiligen Inhaber.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-100">
                    2. Reiner Offline-Betrieb &amp; Vertraulichkeit
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Das Tool ist ausschließlich für den lokalen Offline-Betrieb (file://)
                    konzipiert. Eingelesene Skripte, Rufnummernpläne und Exporte verlassen
                    niemals das jeweilige Arbeitsgerät.
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Im Rahmen von Kundenprojekten sind etwaige Geheimhaltungsvereinbarungen
                    (NDAs) und interne Ablagerichtlinien für exportierte Callflow.html-
                    und CSV-Dateien einzuhalten.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-100">
                    3. Urheberrecht &amp; Open-Source-Basis
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Die Anwendung enthält keinerlei proprietäre Quelltexte, Bibliotheken
                    oder Muster-Skripte von Telekommunikationsherstellern und keine
                    vorbefüllten Kundendaten.
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Eingebundene Open-Source-Pakete (u. a. Mermaid.js, Eclipse ELK, JSZip,
                    React, Lucide) unterliegen ihren jeweiligen Lizenzen (MIT / EPL-2.0).
                  </p>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Hinweis: Diese Übersicht dient der internen Dokumentation und
                Einordnung für Projekt- und IT-Freigaben und ersetzt keine individuelle
                Rechtsberatung im Einzelfall.
              </p>
            </div>
            </div>
          )}
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-800/90 bg-slate-950 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col gap-2 text-xs text-slate-400">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="font-medium text-slate-300">
              MermaidFree2UseOpen · Reine Offline-Einzeldatei-App (file://)
            </span>
            <span className="text-[11px] text-slate-500">
              Mermaid v11 · Eclipse ELK &amp; Dagre · Parser für Avaya-.s-Skripte · JSZip
              Visio Parser · Öffnungszeiten-Solver
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Unabhängiges internes Projektwerkzeug ohne Verbindung, Partnerschaft oder
            Zertifizierung durch Avaya Inc. oder Microsoft Corporation. Markennamen dienen
            ausschließlich der technischen Beschreibung der Dateikompatibilität.
          </p>
        </div>
      </footer>
    </div>
  );
};
