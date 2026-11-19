import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  HardDriveDownload,
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
type TopTechSpecId = 'graph-engine' | 'layout-solver' | 'air-gapped' | 'runtime-protocol';
type ComplianceStandardId = 'dsgvo' | 'iso27001' | 'nis2';

interface ComplianceControlRow {
  reference: string;
  auditQuestion: string;
  technicalProof: string;
  verdict: string;
}

interface ComplianceStandardSpec {
  id: ComplianceStandardId;
  standardCode: string;
  normSubtitle: string;
  statusLabel: string;
  shortStatement: string;
  accentTextClass: string;
  activeBorderClass: string;
  deepDiveTitle: string;
  summary: string;
  auditFacts: Array<{ label: string; value: string }>;
  controlMatrix: ComplianceControlRow[];
  excludedRisks: string[];
  operatorResponsibilities: string[];
  verificationBlock: {
    title: string;
    methodHint: string;
    steps: string;
  };
  approvalCopyText: string;
  legalNote: string;
}

interface TopTechSpecBox {
  id: TopTechSpecId;
  label: string;
  primaryValue: string;
  subValue: string;
  valueColorClass: string;
  activeBorderClass: string;
  deepDiveTitle: string;
  summary: string;
  shortFacts: Array<{ label: string; value: string }>;
  technicalBullets: string[];
  codeSnippet: {
    title: string;
    fileHint: string;
    code: string;
  };
}

interface EmbeddedToolSpec {
  id: string;
  category: Exclude<ToolCategory, 'all'>;
  categoryLabel: string;
  title: string;
  versionOrTag: string;
  techStackLine: string;
  description: string;
  capabilities: string[];
  technicalFacts: Array<{ label: string; value: string }>;
  deepDiveNotes: string[];
  codeSnippet: {
    title: string;
    code: string;
  };
}

interface WorkflowStepSpec {
  id: string;
  stepBadge: string;
  title: string;
  summary: string;
  technicalFacts: Array<{ label: string; value: string }>;
  deepDiveBullets: string[];
  codeSnippet: {
    title: string;
    code: string;
  };
}

const TOP_TECH_SPECS: TopTechSpecBox[] = [
  {
    id: 'graph-engine',
    label: 'Graph-Engine',
    primaryValue: 'Mermaid v11.12',
    subValue: 'ESM Inline-Bundle',
    valueColorClass: 'text-emerald-300',
    activeBorderClass: 'border-emerald-500/70 bg-slate-900',
    deepDiveTitle: 'Mermaid.js v11.12 ESM Graph-Engine & Dual-Layer SVG/Canvas2D Renderer',
    summary:
      'Vollständig lokal eingebettete Mermaid-v11-Laufzeit. Kompiliert deklarative Flowchart-Grammatik über einen Jison/Langium-Parser in einen abstrakten Syntaxbaum (AST) und erzeugt standardkonformes Vektor-SVG mit automatischer Hardware-Beschleunigung.',
    shortFacts: [
      { label: 'Parser-Grammatik', value: 'Jison / Langium AST (flowchart LR & TD)' },
      { label: 'Max. Textgröße', value: '500.000 Zeichen pro Diagramm' },
      { label: 'Max. Kanten (Edges)', value: '4.000 Verbindungen pro Graph' },
      { label: 'Großgraphen-Schutz', value: 'Auto-Switch ab > 80 Knoten auf native <text>' },
    ],
    technicalBullets: [
      'Verhindert Browser-Reflow-Lags bei großen Callflows durch automatisches Umschalten von HTML-<foreignObject> auf native SVG-<text>-Elemente.',
      'Erzeugt im Hintergrund einen GPU-beschleunigten Canvas2D-Bitmap-Proxy (createImageBitmap), der beim Panning und Zoomen mit 60 FPS übernimmt.',
      'Injiziert nach dem SVG-Rendering magnetische 4-Seiten-Verbindungsports sowie klickbare Drilldown-Handler für Zielskripte (JUMP_*).',
    ],
    codeSnippet: {
      title: 'MERMAID V11 KONFIGURATION & AUTO-SCALING',
      fileHint: 'src/utils/mermaidEngine.ts',
      code: `const isLargeDiagram = nodeEstimate > 80 || lineCount > 140;
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  maxTextSize: 500000,
  maxEdges: 4000,
  flowchart: {
    htmlLabels: !isLargeDiagram, // Native SVG <text> ab 80 Knoten
    nodeSpacing: isLargeDiagram ? 32 : 46,
    rankSpacing: isLargeDiagram ? 44 : 62,
    curve: 'basis',
  },
});
const { svg } = await mermaid.render(renderId, effectiveCode);`,
    },
  },
  {
    id: 'layout-solver',
    label: 'Layout-Solver',
    primaryValue: 'Dagre & ELK.js',
    subValue: 'Sugiyama Layered',
    valueColorClass: 'text-indigo-300',
    activeBorderClass: 'border-indigo-500/70 bg-slate-900',
    deepDiveTitle: 'Mathematische Graph-Layout-Solver: Dagre & Eclipse Layout Kernel (ELK.js)',
    summary:
      'Zwei komplementäre Layout-Algorithmen berechnen die kreuzungsminimierte X/Y-Positionierung aller Callflow-Knoten, Subgraphen und Entscheidungsbäume direkt im Browser-Arbeitsspeicher.',
    shortFacts: [
      { label: 'Primär-Solver', value: 'Dagre (Sugiyama Layered Graph Drawing)' },
      { label: 'Enterprise-Solver', value: '@mermaid-js/layout-elk (Eclipse ELK 0.9+)' },
      { label: 'Rang-Zuweisung', value: 'Network-Simplex & Longest-Path Ranking' },
      { label: 'Koordinaten-Solver', value: 'Brandes-Köpf (O(V + E) Vertikal-Ausrichtung)' },
    ],
    technicalBullets: [
      'Phase 1 (Cycle Removal): Erkennt Rücksprünge und Schleifen über Depth-First-Search (DFS) und kehrt rückwärtsgerichtete Kanten temporär um.',
      'Phase 2 & 3 (Layering & Crossing Minimization): Weist Knoten hierarchischen Ebenen zu und minimiert Kantenkreuzungen über die Barycenter-Heuristik.',
      'ELK-Support: Über %%{init: {"flowchart": {"defaultRenderer": "elk"}}}%% kann jederzeit auf orthogonales Eclipse-ELK-Routing für tief verschachtelte Subgraphen gewechselt werden.',
    ],
    codeSnippet: {
      title: 'SUGIYAMA / ELK.JS LAYOUT-PIPELINE',
      fileHint: 'mermaid.registerLayoutLoaders(elkLayouts)',
      code: `// 1. Eclipse ELK Layout-Loader lokal registrieren
mermaid.registerLayoutLoaders(elkLayouts);

// 2. Vierstufige Sugiyama-Berechnung (Dagre / ELK Layered):
// [A] Greedy Cycle Removal   -> Azyklischer Graph (DAG)
// [B] Network-Simplex Rank   -> Hierarchische Spalten (LR / TD)
// [C] Barycenter Ordering    -> Minimierung von Linienkreuzungen
// [D] Brandes-Köpf Placement -> Exakte X/Y-Knoten- & Bezier-Splines`,
    },
  },
  {
    id: 'air-gapped',
    label: 'Externe Requests',
    primaryValue: '0 Byte (Air-Gapped)',
    subValue: 'Kein CDN / Kein Fetch',
    valueColorClass: 'text-emerald-300',
    activeBorderClass: 'border-emerald-500/70 bg-slate-900',
    deepDiveTitle: '100 % Air-Gapped Architektur: 0 Byte Netzwerkverkehr & Zero-CDN Garantie',
    summary:
      'Die generierte Offline-HTML-Datei führt zur Laufzeit keinerlei HTTP/HTTPS-Requests, WebSocket-Verbindungen oder dynamische Chunk-Nachladevorgänge aus. Alle Bibliotheken sind statisch im Dokument verankert.',
    shortFacts: [
      { label: 'Ausgehender Traffic', value: '0 Byte (keine Fetch-/XHR-/Beacon-Calls)' },
      { label: 'Externe Skripte/CDNs', value: 'Keine (kein unpkg, jsDelivr, Google Fonts)' },
      { label: 'Dynamische Imports', value: 'Beim Build vollständig inline aufgelöst' },
      { label: 'Datenschutz / Compliance', value: 'Rufnummern & .s-Skripte bleiben 100 % lokal' },
    ],
    technicalBullets: [
      'Keine externen <script src="...">, <link rel="stylesheet" href="..."> oder Font-Requests – funktioniert auf komplett vom Internet getrennten Sprungservern und Terminalservern.',
      'Alle 60+ sonst asynchron nachgeladenen Mermaid-Diagramm-Chunks werden beim Packaging per Inline-Dynamic-Imports zu einem einzigen synchronen Bundle verschmolzen.',
      'Keinerlei Telemetrie, kein Cloud-Speicher und keine Hinterlegung von Gesellschaftsnamen oder Vorwahlen im Programmcode.',
    ],
    codeSnippet: {
      title: 'BUILD-TIME SINGLE-BUNDLE INLINING (ZERO CHUNKS)',
      fileHint: 'scripts/buildOfflineApp.mjs',
      code: `// Vite / Rollup Build-Konfiguration für 100 % Air-Gapped HTML:
build: {
  cssCodeSplit: false,
  assetsInlineLimit: 100_000_000,
  rollupOptions: {
    output: {
      inlineDynamicImports: true, // Eliminiert sämtliche externen Chunk-Reloads
      manualChunks: undefined,
    },
  },
}`,
    },
  },
  {
    id: 'runtime-protocol',
    label: 'Laufzeit-Protokoll',
    primaryValue: 'file:// & RAM',
    subValue: 'LocalStorage + Fallback',
    valueColorClass: 'text-sky-300',
    activeBorderClass: 'border-sky-500/70 bg-slate-900',
    deepDiveTitle: 'Lokales file:// Laufzeit-Protokoll, Browser-RAM & Resiliente Persistenz',
    summary:
      'Entwickelt für den direkten Doppelklick-Start über das lokale Dateisystem (file://). Kombiniert Browser-LocalStorage, einen In-Memory-Fallback für restriktive Gruppenrichtlinien und eingebettete HTML-Seeds.',
    shortFacts: [
      { label: 'Start-Protokolle', value: 'file:// (Doppelklick) · http(s):// Intranet' },
      { label: 'Datei-Einlesung', value: 'HTML5 FileReader (ArrayBuffer & Text im RAM)' },
      { label: 'Zeichenkodierung', value: 'Auto-Detect UTF-8 / Windows-1252 / ISO-8859-1' },
      { label: 'Persistenz-Kaskade', value: 'HTML-Seed → LocalStorage → In-Memory Map' },
    ],
    technicalBullets: [
      'Erkennt beim Start automatisch window.__IS_OFFLINE_SINGLEFILE__ sowie window.location.protocol === "file:" und bootet ohne Umwege direkt in das Callflow-Studio.',
      'Falls strikte Enterprise-Browser-Policies localStorage unter file:// blockieren, fängt ein transparenter In-Memory-Adapter alle Lese-/Schreibzugriffe absturzfrei ab.',
      'Über den Self-Replicating HTML-Export kann der gesamte Arbeitsstand direkt in eine neue .html-Datei serialisiert und auf Netzlaufwerken archiviert werden.',
    ],
    codeSnippet: {
      title: 'FILE:// DETEKTION & RESILIENTE STORAGE-KASKADE',
      fileHint: 'src/utils/offlineBundleDetector.ts',
      code: `export function isRunningAsOfflineSingleFile(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.__IS_OFFLINE_SINGLEFILE__ === true ||
    window.location.protocol === 'file:' ||
    Boolean(document.getElementById('mermaid-offline-app-script'))
  );
}

// Persistenz-Fallback bei blockiertem file:// LocalStorage:
function safeStorageSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); }
  catch { memoryStorageFallback.set(key, value); }
}`,
    },
  },
];

const COMPLIANCE_SPECS: ComplianceStandardSpec[] = [
  {
    id: 'dsgvo',
    standardCode: 'DSGVO (EU 2016/679)',
    normSubtitle: 'Art. 5 · Art. 25 · Art. 28 · Art. 32 · Art. 44 ff.',
    statusLabel: 'Technisch geeignet · 0-Byte Offline',
    shortStatement:
      'Privacy by Design: Rufnummern, Skillsets und Skripte verlassen niemals den lokalen Arbeitsplatz.',
    accentTextClass: 'text-emerald-300',
    activeBorderClass: 'border-emerald-500/60 bg-slate-900',
    deepDiveTitle:
      'Datenschutz-Prüfmatrix: Reine RAM-Verarbeitung ohne Auftragsverarbeiter oder Drittlandtransfer',
    summary:
      'Die generierte Einzeldatei verarbeitet eingelesene Avaya-.s-Skripte, Visio-Dateien und Rufnummernpläne ausschließlich im flüchtigen Browser-Arbeitsspeicher (RAM) über die lokale HTML5-FileReader-API. Es existiert kein Backend, kein Benutzerkonto und kein ausgehender Netzwerkverkehr.',
    auditFacts: [
      { label: 'AV-Vertrag (Art. 28)', value: 'Nicht erforderlich (kein externer Verarbeiter)' },
      { label: 'Drittlandtransfer (Art. 44 ff.)', value: 'Ausgeschlossen (0 Byte Traffic)' },
      { label: 'Tracking / Cookies', value: '0 Cookies · 0 Analytics · 0 Telemetrie' },
      { label: 'Speicherort', value: 'Lokales Dateisystem & lokaler Browser-Speicher' },
    ],
    controlMatrix: [
      {
        reference: 'Art. 5 Abs. 1 lit. c & f',
        auditQuestion: 'Werden Daten minimiert und vor unbefugtem Zugriff geschützt?',
        technicalProof:
          'Nur explizit ausgewählte Skripte werden lokal per FileReader im RAM geparst; keine Vorbefüllung mit fremden Unternehmensdaten oder Vorwahlen.',
        verdict: 'Erfüllt',
      },
      {
        reference: 'Art. 25 Abs. 1 & 2',
        auditQuestion: 'Sind Privacy by Design & Default technisch umgesetzt?',
        technicalProof:
          'Vollständiges Inline-Bundling (inlineDynamicImports: true) eliminiert CDNs, Webfonts, Cloud-APIs und externe Skript-Aufrufe ab Werk.',
        verdict: 'Erfüllt',
      },
      {
        reference: 'Art. 28 & Art. 44–49',
        auditQuestion: 'Ist ein AV-Vertrag oder eine TIA (Drittland-Prüfung) nötig?',
        technicalProof:
          'Nein. Es werden keine Daten an einen Anbieter, Hoster oder Subprozessor übermittelt; sämtliche Verarbeitung bleibt beim Verantwortlichen.',
        verdict: 'Kein AVV nötig',
      },
      {
        reference: 'Art. 32 (TOMs)',
        auditQuestion: 'Wie sind Vertraulichkeit und Integrität im Betrieb abgesichert?',
        technicalProof:
          'Ausführung in der bestehenden Browser-Sandbox auf verwalteten Firmen-Endpoints; Exporte (HTML, SVG, CSV, PNG) erfolgen nur per manuellem Download.',
        verdict: 'Unterstützt',
      },
    ],
    excludedRisks: [
      'Kein Upload von Durchwahlen, Agenten-Skillsets oder Routing-Skripten an externe Server.',
      'Keine Benutzer-Registrierung, keine Session-Cookies und kein Fingerprinting.',
      'Kein impliziter Datenabfluss über CDN-Logs (kein Google Fonts, unpkg oder jsDelivr).',
    ],
    operatorResponsibilities: [
      'Exportierte HTML-/CSV-Dokumentationen auf berechtigten internen Netzlaufwerken ablegen.',
      'Lokalen Browser-Cache bei gemeinsam genutzten Endgeräten über „Projekt zurücksetzen“ leeren.',
      'Bei personenbezogenen Namen in Skripten den Einsatz im internen Verarbeitungsverzeichnis dokumentieren.',
    ],
    verificationBlock: {
      title: '60-SEKUNDEN-PRÜFNACHWEIS (DATENSCHUTZ)',
      methodHint: 'Browser DevTools · Network',
      steps: `# 1. Offline-HTML lokal per Doppelklick (file://) öffnen
# 2. DevTools öffnen (F12) -> Tab "Netzwerk" (Network)
# 3. Skript-Ordner laden, Diagramm filtern & HTML/CSV exportieren
#
# Erwartetes Prüfergebnis:
#   Requests: 0  |  Transferred: 0 B  |  External Hosts: keine
#   Cookies:  0  |  Third-Party-Calls: keine`,
    },
    approvalCopyText: `Datenschutz-Kurzstellungnahme (DSGVO) – Offline-HTML Callflow-Tool:
• Betriebsart: Statische lokale Single-File-HTML (file://), Ausführung vollständig im Browser-RAM.
• Netzwerkverkehr: 0 Byte (keine Cloud-API, keine CDNs, keine Webfonts, keine Telemetrie, keine Cookies).
• AV-Vertrag (Art. 28 DSGVO) & Drittlandtransfer (Art. 44 ff.): Nicht einschlägig, da kein externer Auftragsverarbeiter eingebunden ist.
• TOMs & Privacy by Design (Art. 25 / 32 DSGVO): Daten verbleiben auf dem verwalteten Unternehmens-Endgerät; Exporte werden lokal gespeichert.
• Eigenprüfung: Nachweisbar über Browser-DevTools (Network-Tab = 0 Requests).`,
    legalNote:
      'Einordnung: Die 0-Byte-Offline-Architektur erfüllt die technischen Voraussetzungen für datenschutzkonformen lokalen Betrieb. Organisatorische Pflichten (Endgeräte-Zugriff, Ablage exportierter Dateien) liegen beim betreibenden Unternehmen.',
  },
  {
    id: 'iso27001',
    standardCode: 'ISO/IEC 27001:2022',
    normSubtitle: 'Annex A.5.14 · A.5.21 · A.8.12 · A.8.20 · A.8.25',
    statusLabel: 'Technisch geeignet · Air-Gapped',
    shortStatement:
      'Unterstützt ISMS-Kontrollen für Datenabfluss-Schutz, Netzwerktrennung und Integritätsprüfung.',
    accentTextClass: 'text-indigo-300',
    activeBorderClass: 'border-indigo-500/60 bg-slate-900',
    deepDiveTitle:
      'ISMS-Prüfmatrix (Annex A): Keine Ports, kein DLP-Risiko und SHA-256-hashbares Einzelartefakt',
    summary:
      'Das Werkzeug benötigt weder lokale Server-Prozesse noch administrative Installationsrechte oder Firewall-Ausnahmen. Die gesamte Laufzeit liegt statisch in einer einzigen auditierbaren HTML-Datei vor und lässt sich wie ein statisches Dokument freigeben und hashen.',
    auditFacts: [
      { label: 'Datenabfluss (A.8.12)', value: 'Kein Upload, kein Fetch/XHR, kein Beacon' },
      { label: 'Netzwerk (A.8.20)', value: 'Kein offener Port · 100 % Air-Gap-fähig' },
      { label: 'Lieferkette (A.5.21)', value: 'Keine Runtime-CDNs oder dynamischen Chunks' },
      { label: 'Integrität', value: 'Einzeldatei direkt per SHA-256 prüf- & archivierbar' },
    ],
    controlMatrix: [
      {
        reference: 'A.5.14 & A.8.12',
        auditQuestion: 'Besteht ein Risiko für ungewollten Datenabfluss (DLP)?',
        technicalProof:
          'Keine ausgehenden HTTP/HTTPS/WebSocket-Verbindungen; sensible Netz- und Callflow-Topologien verlassen das interne Segment nicht.',
        verdict: 'Erfüllt',
      },
      {
        reference: 'A.5.19 & A.5.21',
        auditQuestion: 'Sind Drittanbieter-Laufzeitabhängigkeiten kontrollierbar?',
        technicalProof:
          'Alle Bibliotheken (React, Mermaid v11, ELK, JSZip) sind fest zur Build-Zeit eingebettet – keine fremden Skript-Nachladungen zur Laufzeit.',
        verdict: 'Erfüllt',
      },
      {
        reference: 'A.8.9 & A.8.20',
        auditQuestion: 'Sind Installationsrechte, Daemons oder Firewall-Regeln nötig?',
        technicalProof:
          'Zero-Install-Betrieb direkt im Standard-Browser; kein Node.js-Dienst, kein lokaler Port und keine Proxy-Freischaltung erforderlich.',
        verdict: 'Erfüllt',
      },
      {
        reference: 'A.8.25 & A.8.28',
        auditQuestion: 'Wie wird sicheres Rendering gegen Skript-Injektionen gewährleistet?',
        technicalProof:
          'Mermaid nutzt securityLevel: "strict", HTML-Export maskiert JSON-Payloads XSS-sicher und der gesamte Quellcode ist statisch auditierbar.',
        verdict: 'Unterstützt',
      },
    ],
    excludedRisks: [
      'Keine lokalen Hintergrunddienste, offenen TCP-Ports oder OS-Registry-Änderungen.',
      'Keine unkontrollierten Auto-Updates durch Drittanbieter während des Betriebs.',
      'Kein Zugriff auf das Dateisystem außerhalb explizit vom Nutzer gewählter Dateien.',
    ],
    operatorResponsibilities: [
      'Freigegebene HTML-Datei per SHA-256-Hash dokumentieren und schreibgeschützt verteilen.',
      'Unternehmens-Browser aktuell halten (reguläres Patch-Management gemäß A.8.8).',
      'Schutzbedarfs-Klassifizierung der erzeugten Callflow-Exporte gemäß interner Richtlinie einhalten.',
    ],
    verificationBlock: {
      title: 'PRÜFNACHWEIS FÜR IT-SECURITY / ISMS',
      methodHint: 'PowerShell / SHA-256 Audit',
      steps: `# 1. SHA-256 Freigabe-Hash erzeugen (Windows PowerShell):
Get-FileHash .\\MermaidFree2UseOpen_Offline.html -Algorithm SHA256

# 2. Statische Prüfung auf externe Skript-/CDN-Aufrufe (0 Treffer):
Select-String -Path .\\MermaidFree2UseOpen_Offline.html -Pattern "<script[^>]+src=https?://|unpkg\\.com|jsdelivr\\.net|fonts\\.googleapis"

# Linux / macOS:
sha256sum MermaidFree2UseOpen_Offline.html`,
    },
    approvalCopyText: `IT-Security / ISMS-Kurzstellungnahme (ISO/IEC 27001:2022) – Offline-HTML Callflow-Tool:
• Architektur: Statische Single-File-HTML ohne lokale Installation, ohne Server-Port und ohne Admin-Rechte.
• Annex A.8.12 / A.8.20 (DLP & Netzwerksicherheit): 0 Byte ausgehender Traffic, 100 % Air-Gap-fähig auf isolierten VMs/Sprungservern.
• Annex A.5.21 (IKT-Lieferkette): Keine externen Runtime-CDNs oder dynamischen Skript-Nachladungen; statisch im Artefakt eingefroren.
• Annex A.8.25 (Sichere Entwicklung): Mermaid securityLevel="strict", XSS-sichere Serialisierung, vollständig per SHA-256 hash- und prüfbar.`,
    legalNote:
      'Einordnung: Eine einzelne HTML-Datei trägt keine eigene ISO-27001-Organisationszertifizierung. Die Architektur ist gezielt darauf ausgelegt, die technischen Annex-A-Kontrollen eines bestehenden ISMS ohne Zusatzrisiken zu erfüllen.',
  },
  {
    id: 'nis2',
    standardCode: 'NIS2 (EU 2022/2555)',
    normSubtitle: 'Art. 21 Abs. 2 lit. a, c, d, i (Risiko · Kontinuität · Lieferkette)',
    statusLabel: 'Technisch geeignet · Zero-Cloud',
    shortStatement:
      'Minimale Angriffsfläche ohne Cloud-Abhängigkeit – voll einsatzfähig auch im Krisen- und Offline-Fall.',
    accentTextClass: 'text-sky-300',
    activeBorderClass: 'border-sky-500/60 bg-slate-900',
    deepDiveTitle:
      'NIS2-Prüfmatrix (Art. 21): Resiliente Offline-Verfügbarkeit & geschlossene Laufzeit-Lieferkette',
    summary:
      'Für NIS2-regulierte Einrichtungen und KRITIS-nahe Telekommunikations-Teams eliminiert der autarke Offline-Betrieb klassische Cloud-, API- und Lieferketten-Risiken und sichert die jederzeitige Nutzbarkeit von Notfall- und Callflow-Plänen.',
    auditFacts: [
      { label: 'Risikomanagement (Art. 21 2a)', value: 'Keine Server-, API- oder Cloud-Angriffsfläche' },
      { label: 'Kontinuität (Art. 21 2c)', value: '100 % lauffähig bei Internet- / Netzausfall' },
      { label: 'Lieferkette (Art. 21 2d)', value: 'Keine dynamischen Drittanbieter-Skripte' },
      { label: 'Least Privilege', value: 'Kein Admin-Recht · keine OS-Installation' },
    ],
    controlMatrix: [
      {
        reference: 'Art. 21 Abs. 2 lit. a',
        auditQuestion: 'Entstehen neue Angriffsflächen für Risikoanalyse & Systemsicherheit?',
        technicalProof:
          'Nein. Kein exponierter Dienst, keine API-Keys, keine Cloud-Schnittstelle und keine privilegierte Systeminstallation erforderlich.',
        verdict: 'Minimales Risiko',
      },
      {
        reference: 'Art. 21 Abs. 2 lit. c',
        auditQuestion: 'Bleibt das Werkzeug im Krisen- oder Offline-Fall nutzbar (BCM)?',
        technicalProof:
          'Ja. Callflow-Analysen, Öffnungszeiten-Prüfungen und interaktive HTML-Exporte funktionieren ohne Internet, Proxy oder Lizenzserver.',
        verdict: 'Voll resilient',
      },
      {
        reference: 'Art. 21 Abs. 2 lit. d',
        auditQuestion: 'Besteht ein Laufzeit-Supply-Chain-Risiko über Drittanbieter?',
        technicalProof:
          'Ausgeschlossen. Kein Nachladen von Fremdskripten, keine externen CDNs und keine automatischen Fern-Updates nach der internen Freigabe.',
        verdict: 'Geschlossen',
      },
      {
        reference: 'Art. 21 Abs. 2 lit. i',
        auditQuestion: 'Lässt sich das Artefakt sauber in Zugriffskontrolle & Asset-Management einbinden?',
        technicalProof:
          'Zentrale Ablage einer einzigen versionierten und gehashten HTML-Datei auf internen Netzlaufwerken mit bestehenden NTFS/RBAC-Rechten.',
        verdict: 'Unterstützt',
      },
    ],
    excludedRisks: [
      'Kein Ausfallrisiko durch externe SaaS-Störungen, abgelaufene Cloud-Lizenzen oder Proxy-Blockaden.',
      'Kein Supply-Chain-Kompromittierungsrisiko über manipulierte CDN-Skripte zur Laufzeit.',
      'Keine zusätzlichen Meldepflichten durch Cloud-Anbieter-Sicherheitsvorfälle.',
    ],
    operatorResponsibilities: [
      'Freigegebene Datei zentral versioniert ablegen und bei Bedarf im Notfall-Handbuch/BCM verlinken.',
      'Interne Freigabe und Versionsaktualisierungen kontrolliert über das Change-Management steuern.',
      'Ausführung ausschließlich auf verwalteten, gepatchten Endgeräten im berechtigten Benutzerkontext.',
    ],
    verificationBlock: {
      title: 'AIR-GAP- & RESILIENZ-TEST (NIS2)',
      methodHint: 'Offline-VM / Flugmodus-Test',
      steps: `# 1. Netzwerkadapter trennen (Flugmodus / isolierte Offline-VM)
# 2. Freigegebene .html-Datei direkt im Unternehmens-Browser öffnen
# 3. Skript-Ordner einlesen, Logik prüfen & HTML/CSV exportieren
#
# Erwartetes Prüfergebnis:
#   100 % Funktionsumfang ohne Internet, Proxy oder Server.
#   Keine Installationsspuren oder offenen Ports im OS.`,
    },
    approvalCopyText: `NIS2-Kurzstellungnahme (EU 2022/2555 Art. 21) – Offline-HTML Callflow-Tool:
• Risikomanagement (Art. 21 Abs. 2a): Statisches Offline-Werkzeug ohne Cloud-Backend, ohne offene Ports und ohne Admin-Rechte.
• Betriebskontinuität / BCM (Art. 21 Abs. 2c): 100 % offline- und air-gap-fähig – auch bei vollständigem Außennetzausfall nutzbar.
• Lieferketten-Sicherheit (Art. 21 Abs. 2d): Keine dynamischen Drittanbieter-CDNs oder Fern-Updates zur Laufzeit; eingefrorene Einzeldatei.
• Asset-Kontrolle (Art. 21 Abs. 2i): Zentral versionierbar und per SHA-256 verifizierbar auf internen Netzlaufwerken.`,
    legalNote:
      'Einordnung: NIS2 verpflichtet die regulierte Einrichtung als Ganzes. Durch den autarken Offline-Betrieb entstehen keine zusätzlichen Cloud-, Melde- oder Lieferketten-Risiken im Sinne von Art. 21.',
  },
];

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
    technicalFacts: [
      { label: 'Knoten-Formen', value: 'Stadium ([...]), Hexagon {{...}}, Zylinder [(...)]' },
      { label: 'Farbmodi', value: 'Semantic Roles · Subgraph Clusters · High-Contrast · Standard' },
      { label: 'Interaktive Layer', value: 'Live Drag-Offsets · 4-Seiten Connect-Ports · Minimap' },
    ],
    deepDiveNotes: [
      'Jeder gerenderte SVG-Knoten wird nach dem Layout-Lauf im DOM inspiziert und erhält semantische CSS-Klassen sowie Event-Listener für Pfad-Highlighting (Upstream/Downstream).',
      'Manuelle Knotenverschiebungen (Drag & Drop auf der Zeichenfläche) werden als Transformations-Matrix im Workspace gespeichert und überleben Code-Updates.',
    ],
    codeSnippet: {
      title: 'SMART-COLOR AST KLASSIFIZIERUNG & SVG POST-PROCESSING',
      code: `// Semantische Knoten-Klassifizierung im generierten Mermaid-Code:
classDef roleEntry fill:#065f46,stroke:#10b981,color:#ecfdf5,stroke-width:2px;
classDef roleStep fill:#1e1b4b,stroke:#6366f1,color:#e0e7ff,stroke-width:1.5px;
classDef roleQueue fill:#312e81,stroke:#818cf8,color:#eef2ff,stroke-width:2px;
classDef roleSchedule fill:#451a03,stroke:#f59e0b,color:#fef3c7,stroke-width:1.5px;
class SELF_Main roleEntry;
class QUEUE_Service roleQueue;`,
    },
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
      'Trennt beim Import strikt zwischen übergeordneten Gesellschaften (Mandanten/Vorwahlen) und Fach-Teams/Skillsets',
    ],
    technicalFacts: [
      { label: 'Kommentar-Filter', value: 'Entfernt /* ... */ Block- & // Zeilenkommentare vorab' },
      { label: 'Ebenen-Architektur', value: 'Ebene 1: Master-Netzwerk · Ebene 2: Skript-Regelgraph' },
      { label: 'Mandanten-Schutz', value: 'isLikelyTeamOrDepartmentName() verhindert Team-Fehlzuordnung' },
    ],
    deepDiveNotes: [
      'Erkennt übergeordnete Gesellschaften dynamisch aus IF DNIS_Range_<Name>, assign <Präfix>xxxx to src_route_number und assign <Name> to Sys_brand – und fragt diese beim Import interaktiv ab.',
      'Vererbt bestätigte Gesellschaften über VALUE-Rufnummern-Präfixe automatisch an die aufgerufenen Folgeskripte, ohne Teams (Service, Vertrieb, Schaden) mit Gesellschaften zu verwechseln.',
    ],
    codeSnippet: {
      title: 'AVAYA AACC (.S) → MERMAID TRANSPILER-REGELN',
      code: `// Eingabe (Avaya AACC .s Syntax):
IF DNIS_Range_MandantA THEN
  assign 100xxxx to src_route_number
  assign Mandant_A to Sys_brand
END IF
VALUE 1001234 : execute Script Service_Menu

// Transpilierte Mermaid-Struktur (Ebene 1 & Ebene 2):
S_Main(["★ [Main] Einstiegsskript"]) -->|"[Mandant_A] Rufnr. 1001234"| S_Service_Menu`,
    },
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
    technicalFacts: [
      { label: 'Visio-Container', value: 'ZIP-Inflate von visio/pages/page1..N.xml & rels' },
      { label: 'Ordner-Indexierung', value: '600+ .s-Dateien in < 150ms per Map<canonicalKey, File>' },
      { label: 'Rekursiver Resolver', value: 'Breadth-First-Search (BFS) entlang aktiver Sprungziele' },
    ],
    deepDiveNotes: [
      'Beim Zuweisen eines kompletten Skript-Ordners werden nicht blind alle 600+ Altlast-Dateien geladen, sondern ausgehend vom Startskript (Main) nur diejenigen .s-Dateien rekursiv nachgeladen, die tatsächlich in der aktiven Telefonschaltung aufgerufen werden.',
      'Übersprungene Altlast-Dateien im Ordner werden im Import-Bericht transparent ausgewiesen.',
    ],
    codeSnippet: {
      title: 'REKURSIVER BFS-ORDNER-RESOLVER & VSDX XML-EXTRACTOR',
      code: `// Rekursive BFS-Auflösung verknüpfter .s-Folgeskripte aus Ordner-Pool:
while (queue.length > 0) {
  const targetRef = queue.shift()!;
  const entry = folderPool.byCanonicalKey.get(canonicalScriptMatchKey(targetRef));
  if (entry && !loadedKeys.has(entry.canonicalKey)) {
    const parsed = await importCallflowFile(entry.file);
    mergedModules.push(...parsed.modules);
    enqueueNewJumpTargets(parsed.modules, queue, loadedKeys);
  }
}`,
    },
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
    technicalFacts: [
      { label: 'Zeit-Normalisierung', value: '9:00..16:59 / 0800-1700 → 09:00–16:59 Uhr' },
      { label: 'Cross-Script Lookup', value: 'Löst SondZeit_* Variablen über Master/Sub-Skripte auf' },
      { label: 'Vollständigkeits-Check', value: 'Meldet unaufgelöste SondZeit-Variablen zur Nachfrage' },
    ],
    deepDiveNotes: [
      'Wenn ein Unter-Skript auf eine Zeitvariable wie SondZeit_Team_A prüft, die erst im übergeordneten Master- oder Zeit-Skript definiert wurde, verknüpft der Solver die Zeitfenster automatisch skriptübergreifend.',
      'Fehlt das definierende Zeitskript noch im Workspace, erzeugt die Logikprüfung einen präzisen Rückfrage-Hinweis.',
    ],
    codeSnippet: {
      title: 'ZEITFENSTER- & FEIERTAGS-SUBKNOTEN IM MERMAID-GRAPH',
      code: `// Generierte Mermaid-Unterknoten für Zeitpläne & Feiertage:
SCHED_1040_1(["🕒 Mo-Fr 08:00–17:59 Uhr (SondZeit_Service)"])
HOLIDAY_1040_1(["📅 Feiertagsprüfung: Bundesweit / 24.12. / 31.12."])

STEP_1040_1 -->|Zeitfenster offen| SCHED_1040_1
SCHED_1040_1 -->|Innerhalb Öffnungszeit| QUEUE_S_Service[("🎧 Queue: S_Service")]
STEP_1040_1 -->|Feiertag aktiv| HOLIDAY_1040_1
HOLIDAY_1040_1 -->|Ansage & Ende| JUMP_Ansage_Feiertag`,
    },
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
    technicalFacts: [
      { label: 'Zyklus-Erkennung', value: 'DFS Recursion-Stack Pfad-Analyse (A → B → A)' },
      { label: 'False-Positive-Schutz', value: 'Erkennt Queue, Ansage, ASSIGN & deaktiviert=0 als valide' },
      { label: 'Register-Ansichten', value: 'Skillsets · Ansagen/RAN · Systemvariablen · Caller/Callee' },
    ],
    deepDiveNotes: [
      'Prüft beim Einlesen automatisch, ob alle referenzierten Zielskripte, Skillsets und SondZeit-Definitionen vollständig vorliegen oder ob gezielte Nachfragen (offene Ziel-Skripte in der Checkliste) bestehen.',
      'Jeder Befund enthält einen 1-Klick-Deep-Link, der direkt in das betroffene Skript und die exakte Regel springt.',
    ],
    codeSnippet: {
      title: 'STATISCHE ROUTING- & VOLLSTÄNDIGKEITS-VALIDIERUNG',
      code: `const hasExplicitValidOutcome = (rule: ScriptRule): boolean =>
  Boolean(
    rule.targetScriptNumber ||
    rule.queueTarget ||
    rule.overflowQueueTarget ||
    (rule.assignedVariables && rule.assignedVariables.length > 0) ||
    (rule.menuChoices && rule.menuChoices.length > 0) ||
    /deaktiviert\\s*=\\s*0|disconnect|give\\s+ran|give\\s+music/i.test(rule.actionText)
  );`,
    },
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
    technicalFacts: [
      { label: 'DOM-Quine Prinzip', value: 'Klont eigenen JS/CSS-Code aus dem laufenden DOM' },
      { label: 'XSS-Schutz im Seed', value: 'Maskiert </script>, <!-- und Unicode-Line-Terminatoren' },
      { label: 'Export-Formate', value: '.html (Studio & Viewer) · .svg · .png · .csv · .md · .json' },
    ],
    deepDiveNotes: [
      'Selbst wenn Sie bereits offline in einer heruntergeladenen .html-Datei arbeiten, kann diese Datei ohne Server erneut eine frische .html-Datei mit Ihrem aktuellen Callflow-Stand generieren (DOM-Quine).',
      'Der Read-Only HTML-Viewer rendert vor dem Speichern alle Skript-SVGs im Hintergrund vor, sodass Empfänger im Fachbereich sofort durch alle Ebenen klicken können.',
    ],
    codeSnippet: {
      title: 'DOM-QUINE SELF-REPLICATION & XSS-SAFE SEED INJECTION',
      code: `// Liest das laufende Inline-Bundle aus dem DOM & bettet den aktuellen Workspace ein:
const inlineScript = document.getElementById('mermaid-offline-app-script')?.textContent;
const safeSeedJson = JSON.stringify(seedPayload)
  .replace(/</g, '\\\\u003c')
  .replace(/>/g, '\\\\u003e');

const seedTag = \`<script id="mermaid-offline-seed">
  window.__MERMAID_OFFLINE_SEED__ = \${safeSeedJson};
</script>\`;`,
    },
  },
];

const WORKFLOW_STEPS: WorkflowStepSpec[] = [
  {
    id: 'step-01-bundle',
    stepBadge: '01 · Bündelung',
    title: 'Alle Engines inline im HTML',
    summary:
      'Der Builder verpackt React 19, Tailwind-Styles, Mermaid.js v11, ELK-Graph-Layout und JSZip direkt in <script>- und <style>-Blöcke einer einzigen Datei.',
    technicalFacts: [
      { label: 'Bundle-Mechanismus', value: 'Synchrones Single-File HTML5 Dokument' },
      { label: 'Enthaltene Laufzeiten', value: 'React 19 + Mermaid v11.12 + ELK.js + Dagre + JSZip' },
    ],
    deepDiveBullets: [
      'Kompiliert den gesamten TypeScript-Quellcode inklusive aller Icons (Lucide SVG) und CSS-Regeln in ein einziges, portables HTML-Artefakt.',
      'Setzt optionale Start-Voreinstellungen (Arbeitsmodus, dunkle/helle Zeichenfläche, Smart-Color-Logik) direkt als initialen Seed.',
    ],
    codeSnippet: {
      title: 'INLINE DOM-STRUKTUR DER GENERIERTEN HTML',
      code: `<style id="mermaid-offline-app-style">/* Tailwind v4 + Studio CSS */</style>
<script id="mermaid-offline-flag">window.__IS_OFFLINE_SINGLEFILE__ = true;</script>
<script id="mermaid-offline-app-script">/* React 19 + Mermaid v11 + ELK + Parser */</script>`,
    },
  },
  {
    id: 'step-02-execution',
    stepBadge: '02 · Ausführung',
    title: 'Direktstart über file://',
    summary:
      'Beim Öffnen der heruntergeladenen HTML-Datei erkennt die Anwendung das Flag __IS_OFFLINE_SINGLEFILE__ bzw. file:// und startet sofort das volle Callflow-Studio.',
    technicalFacts: [
      { label: 'Boot-Weiche', value: 'isRunningAsOfflineSingleFile() in src/App.tsx' },
      { label: 'Installationsbedarf', value: '0 Abhängigkeiten (kein Node.js / kein Webserver)' },
    ],
    deepDiveBullets: [
      'Während die Online-Webseite ausschließlich diesen HTML-Builder anzeigt, schaltet derselbe Code in der heruntergeladenen HTML-Datei beim Öffnen automatisch in die volle Studio-Oberfläche (OfflineStudioApp) um.',
      'Läuft auf jedem Standard-Browser (Chrome, Edge, Firefox) unter Windows, macOS und Linux direkt aus dem Download-Ordner oder von einem USB-/Netzlaufwerk.',
    ],
    codeSnippet: {
      title: 'AUTOMATISCHE BOOT-WEICHE (BUILDER VS. OFFLINE-STUDIO)',
      code: `export function App() {
  const isOfflineSingleFile = useMemo(() => isRunningAsOfflineSingleFile(), []);
  // Online -> Nur Local HTML Builder | Heruntergeladene HTML -> Volles Studio
  if (!isOfflineSingleFile) return <LocalHtmlBuilderLanding />;
  return <OfflineStudioApp />;
}`,
    },
  },
  {
    id: 'step-03-memory',
    stepBadge: '03 · Dateiverarbeitung',
    title: 'Lokaler Browser-Speicher (RAM)',
    summary:
      'Avaya-Skripte (.s), ganze Skript-Ordner und Visio-Dateien (.vsdx) werden rein lokal im Arbeitsspeicher analysiert und zu Mermaid-Graphen gerendert.',
    technicalFacts: [
      { label: 'I/O-Schnittstelle', value: 'FileReader API & webkitdirectory Ordner-Zugriff' },
      { label: 'Mandanten-Abfrage', value: 'Lokale Bestätigung von Gesellschaften & Vorwahlen' },
    ],
    deepDiveBullets: [
      'Liest Einzeldateien oder komplette Ordnerstrukturen über lokale File-Handles in den Browser-Heap ein, ohne dass ein einziges Byte den Rechner verlässt.',
      'Fragt beim Import erkannte übergeordnete Gesellschaften (3 oder mehr Mandanten + Vorwahl-Präfixe) interaktiv ab und trennt diese sauber von darunterliegenden Fach-Teams.',
    ],
    codeSnippet: {
      title: 'IN-MEMORY FILE & FOLDER DECODING IM BROWSER',
      code: `const buffer = await file.arrayBuffer();
const text = decodeCallflowBufferWithFallback(buffer); // UTF-8 & Windows-1252
const modules = parseCallflowTextWithFallback(text, { isMasterHint: true });
const discoveredOrgas = extractDiscoveredOrganizationsFromModules(modules);`,
    },
  },
  {
    id: 'step-04-persistence',
    stepBadge: '04 · Persistenz & Weitergabe',
    title: 'Snapshot-Speicherung in HTML',
    summary:
      'Aus der lokalen Offline-App heraus können Sie jederzeit wieder eine neue Offline-HTML inkl. eingebettetem Callflow-Projektstand oder einen Read-Only HTML-Viewer für Kollegen exportieren.',
    technicalFacts: [
      { label: 'Projekt-Speicherung', value: 'Self-Contained HTML-Snapshot oder JSON-Workspace' },
      { label: 'Fachbereichs-Export', value: 'Interaktiver Read-Only HTML-Viewer mit Pre-Baked SVGs' },
    ],
    deepDiveBullets: [
      'Ermöglicht versionierbare Einzeldateien pro Kundenprojekt oder Release-Stand (z. B. Callflow_Stand_Q4.html), die bei Doppelklick exakt den gespeicherten Callflow öffnen.',
      'Ergänzt durch strukturierte Exporte für Excel-Routing-Matrizen (.csv), Öffnungszeiten-Tabellen (.csv), Migrations-Dokumentation (.md) sowie Vektor-SVG und High-DPI PNG.',
    ],
    codeSnippet: {
      title: 'WORKSPACE-SEED WIEDERHERSTELLUNG BEIM ÖFFNEN',
      code: `const embeddedSeed = getEmbeddedOfflineSeed();
if (embeddedSeed?.scriptWorkspace) {
  hydrateStudioFromEmbeddedSeed(embeddedSeed);
} else {
  hydrateStudioFromLocalStorageOrMemoryFallback();
}`,
    },
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

  // Expandable state for the 4 top technical boxes (e.g., Graph-Engine, Layout-Solver, etc.)
  const [activeTopSpecId, setActiveTopSpecId] = useState<TopTechSpecId | null>(null);

  // Expandable state for the 3 compliance & IT-security boxes (DSGVO, ISO/IEC 27001, NIS2)
  const [expandedComplianceIds, setExpandedComplianceIds] = useState<
    Record<ComplianceStandardId, boolean>
  >({
    dsgvo: false,
    iso27001: false,
    nis2: false,
  });
  const [copiedComplianceId, setCopiedComplianceId] = useState<ComplianceStandardId | null>(null);

  // Expandable state for the 6 embedded tool cards
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({});

  // Expandable state for the 4 workflow step boxes
  const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});

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

  const activeTopSpec = TOP_TECH_SPECS.find((item) => item.id === activeTopSpecId) || null;

  const areAllComplianceExpanded = COMPLIANCE_SPECS.every((item) =>
    Boolean(expandedComplianceIds[item.id])
  );

  const toggleAllCompliance = () => {
    const nextState = !areAllComplianceExpanded;
    setExpandedComplianceIds({
      dsgvo: nextState,
      iso27001: nextState,
      nis2: nextState,
    });
  };

  const handleCopyComplianceApproval = async (item: ComplianceStandardSpec) => {
    try {
      await navigator.clipboard.writeText(item.approvalCopyText);
      setCopiedComplianceId(item.id);
      window.setTimeout(() => {
        setCopiedComplianceId((prev) => (prev === item.id ? null : prev));
      }, 2200);
    } catch {
      // Fallback for restricted file:// clipboards
      const textarea = document.createElement('textarea');
      textarea.value = item.approvalCopyText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopiedComplianceId(item.id);
        window.setTimeout(() => {
          setCopiedComplianceId((prev) => (prev === item.id ? null : prev));
        }, 2200);
      } finally {
        document.body.removeChild(textarea);
      }
    }
  };

  const handleJumpToCompliance = () => {
    setExpandedComplianceIds((prev) =>
      prev.dsgvo || prev.iso27001 || prev.nis2 ? prev : { ...prev, dsgvo: true }
    );
    const el = document.getElementById('compliance-freigabe');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const areAllFilteredToolsExpanded =
    filteredTools.length > 0 && filteredTools.every((t) => Boolean(expandedToolIds[t.id]));

  const toggleAllFilteredTools = () => {
    const nextState = !areAllFilteredToolsExpanded;
    setExpandedToolIds((prev) => {
      const next = { ...prev };
      filteredTools.forEach((t) => {
        next[t.id] = nextState;
      });
      return next;
    });
  };

  const areAllWorkflowStepsExpanded = WORKFLOW_STEPS.every((s) =>
    Boolean(expandedStepIds[s.id])
  );

  const toggleAllWorkflowSteps = () => {
    const nextState = !areAllWorkflowStepsExpanded;
    const next: Record<string, boolean> = {};
    WORKFLOW_STEPS.forEach((s) => {
      next[s.id] = nextState;
    });
    setExpandedStepIds(next);
  };

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

        <nav className="hidden lg:flex items-center gap-5 text-sm font-medium text-slate-400">
          <a
            href="#compliance-freigabe"
            className="text-emerald-300 hover:text-emerald-200 transition-colors whitespace-nowrap shrink-0"
          >
            DSGVO · ISO · NIS2
          </a>
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
          <a href="#compliance-freigabe" className="py-1 text-emerald-300 hover:text-emerald-200">
            DSGVO · ISO · NIS2
          </a>
          <span aria-hidden="true" className="text-slate-600">·</span>
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-10 py-5 sm:py-8 lg:py-10 space-y-10 sm:space-y-14">
        {/* Top Compliance & IT-Security-Freigabe Strip (Directly Above the Fold: 3 Expandable Inline-Detail Cards for DSGVO, ISO/IEC 27001 & NIS2) */}
        <section
          id="compliance-freigabe"
          aria-labelledby="compliance-freigabe-heading"
          className="scroll-mt-20 space-y-4 pb-6 sm:pb-8 border-b border-slate-800/90"
        >
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="space-y-1 max-w-3xl">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-emerald-400">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Compliance &amp; IT-Security-Freigabe</span>
                <span aria-hidden="true">·</span>
                <span className="text-slate-400">0-Byte-Offline-Nachweis</span>
              </div>
              <h2
                id="compliance-freigabe-heading"
                className="text-base sm:text-lg font-bold text-slate-100"
              >
                Technisch geeignet für DSGVO-, ISO/IEC-27001- und NIS2-Umgebungen
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Klappen Sie eine oder alle drei Boxen direkt auf, um die vollständige
                Artikel-/Control-Prüfmatrix, Risiko-Abgrenzung, Prüfbefehle und eine fertige
                Freigabe-Kurzstellungnahme für Datenschutz &amp; IT-Security einzusehen.
              </p>
            </div>

            <button
              type="button"
              onClick={toggleAllCompliance}
              className="self-start sm:self-end min-h-[38px] px-3 py-1.5 text-xs font-mono text-emerald-300 hover:text-emerald-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {areAllComplianceExpanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                  <span>Alle 3 Nachweise einklappen</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  <span>Alle 3 Nachweise ausklappen</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            {COMPLIANCE_SPECS.map((item) => {
              const isExpanded = Boolean(expandedComplianceIds[item.id]);
              const isCopied = copiedComplianceId === item.id;
              return (
                <div
                  key={item.id}
                  className={`rounded-xl p-4 sm:p-5 border transition-colors flex flex-col justify-between space-y-3.5 ${
                    isExpanded
                      ? item.activeBorderClass
                      : 'bg-slate-900/60 border-slate-800/90 hover:border-slate-700'
                  }`}
                >
                  {/* Card Header & Summary */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <div className={`text-sm sm:text-base font-semibold ${item.accentTextClass}`}>
                          {item.standardCode}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                          {item.normSubtitle}
                        </div>
                      </div>
                      <span className="text-[10.5px] font-mono text-slate-300 text-right shrink-0">
                        {item.statusLabel.split(' · ')[0]}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">
                      {item.shortStatement}
                    </p>
                  </div>

                  {/* Direct Inline Expand / Collapse Button */}
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() =>
                      setExpandedComplianceIds((prev) => ({
                        ...prev,
                        [item.id]: !prev[item.id],
                      }))
                    }
                    className="w-full min-h-[38px] px-3 py-2 rounded-lg bg-slate-950 hover:bg-slate-950/80 border border-slate-800 hover:border-emerald-500/40 text-xs font-mono text-emerald-300 flex items-center justify-between gap-2 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  >
                    <span className="truncate">
                      {isExpanded
                        ? 'Prüfmatrix & Nachweis einklappen'
                        : 'Prüfmatrix, Risiken & Nachweis ausklappen'}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 shrink-0" />
                    )}
                  </button>

                  {/* Deep Inline Expansion Directly Inside the Card */}
                  {isExpanded && (
                    <div className="pt-3 border-t border-slate-800 space-y-4">
                      <div className="space-y-1.5">
                        <h3 className="text-xs sm:text-sm font-semibold text-slate-100 leading-snug">
                          {item.deepDiveTitle}
                        </h3>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {item.summary}
                        </p>
                      </div>

                      {/* 4 Structured Audit Facts */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono tabular-nums">
                        {item.auditFacts.map((fact, fIdx) => (
                          <div
                            key={fIdx}
                            className="bg-slate-950/90 border border-slate-800/90 rounded-lg p-2.5 space-y-0.5"
                          >
                            <div className="text-[10px] text-slate-400">{fact.label}</div>
                            <div className="text-[11px] font-semibold text-slate-100 break-words">
                              {fact.value}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Concrete Article / Control Matrix */}
                      <div className="space-y-2">
                        <div className="text-[11px] font-mono text-slate-400">
                          Norm- &amp; Kontroll-Nachweis (Artikel / Annex)
                        </div>
                        <div className="space-y-2">
                          {item.controlMatrix.map((row, rIdx) => (
                            <div
                              key={rIdx}
                              className="bg-slate-950/90 border border-slate-800/90 rounded-lg p-2.5 space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                                <span className={`font-semibold ${item.accentTextClass}`}>
                                  {row.reference}
                                </span>
                                <span className="text-emerald-400 shrink-0">✓ {row.verdict}</span>
                              </div>
                              <div className="text-[11px] font-medium text-slate-200 leading-snug">
                                {row.auditQuestion}
                              </div>
                              <p className="text-[11px] text-slate-400 leading-relaxed">
                                {row.technicalProof}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Clear Separation: Excluded by Architecture vs. Operator Duties */}
                      <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-mono text-emerald-400">
                            Technisch ausgeschlossen (Architektur)
                          </div>
                          <ul className="space-y-1 text-[11px] text-slate-300 leading-relaxed">
                            {item.excludedRisks.map((risk, idx) => (
                              <li key={idx} className="flex items-start gap-1.5">
                                <span className="text-emerald-400 font-mono shrink-0">✓</span>
                                <span>{risk}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="space-y-1.5">
                          <div className="text-[11px] font-mono text-amber-300">
                            Organisatorische Verantwortung (Betreiber)
                          </div>
                          <ul className="space-y-1 text-[11px] text-slate-400 leading-relaxed">
                            {item.operatorResponsibilities.map((duty, idx) => (
                              <li key={idx} className="flex items-start gap-1.5">
                                <span className="text-amber-300 font-mono shrink-0">•</span>
                                <span>{duty}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {/* Executable 60-Second Verification Block */}
                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2 font-mono text-xs">
                        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400 border-b border-slate-800 pb-1.5">
                          <span>{item.verificationBlock.title}</span>
                          <span className={item.accentTextClass}>
                            {item.verificationBlock.methodHint}
                          </span>
                        </div>
                        <pre className="text-[10.5px] leading-relaxed text-slate-200 overflow-x-auto whitespace-pre">
                          {item.verificationBlock.steps}
                        </pre>
                      </div>

                      {/* 1-Click Copy Approval Statement for Internal IT-Security / DSB Ticket */}
                      <div className="flex flex-col gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => void handleCopyComplianceApproval(item)}
                          className="w-full min-h-[38px] px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-100 flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span className="text-emerald-300">
                                Freigabetext in Zwischenablage kopiert
                              </span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                              <span>Freigabetext für IT-Security / DSB kopieren</span>
                            </>
                          )}
                        </button>

                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {item.legalNote}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Hero & Interactive Local HTML Builder Split */}
        <section
          id="builder"
          className="scroll-mt-20 grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-10 items-stretch"
        >
          {/* Left Column: Explanation & Technical Local Guarantee */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
            <div className="space-y-3 sm:space-y-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] sm:text-xs font-mono text-emerald-400">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>100 % LOKALE SINGLE-FILE HTML</span>
                <span aria-hidden="true">·</span>
                <span>MERMAID V11 + ELK INLINE</span>
                <span aria-hidden="true">·</span>
                <span>ZERO CDN / ZERO SERVER</span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={handleJumpToCompliance}
                  className="text-sky-300 hover:text-sky-200 underline decoration-sky-500/40 underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60 rounded"
                >
                  DSGVO · ISO 27001 · NIS2 Nachweis
                </button>
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

            {/* Expandable Technical Specs Bar (4 bordered boxes + connected deep-dive panel) */}
            <div className="pt-3 border-t border-slate-800/90 space-y-3">
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span>
                  Klicken Sie auf eine der 4 Technik-Boxen für Architektur-Parameter &amp; Code:
                </span>
                {activeTopSpecId && (
                  <button
                    type="button"
                    onClick={() => setActiveTopSpecId(null)}
                    className="text-xs font-mono text-emerald-400 hover:text-emerald-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Details schließen ▴
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 font-mono tabular-nums">
                {TOP_TECH_SPECS.map((spec) => {
                  const isExpanded = activeTopSpecId === spec.id;
                  return (
                    <button
                      key={spec.id}
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setActiveTopSpecId((prev) => (prev === spec.id ? null : spec.id))
                      }
                      className={`text-left rounded-lg p-3 border transition-colors flex flex-col justify-between gap-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                        isExpanded
                          ? spec.activeBorderClass
                          : 'bg-slate-900/60 border-slate-800/90 hover:border-slate-700 hover:bg-slate-900/90'
                      }`}
                    >
                      <div className="space-y-0.5 w-full">
                        <div className="flex items-center justify-between gap-1 text-[11px] text-slate-400">
                          <span className="truncate">{spec.label}</span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          )}
                        </div>
                        <div className={`text-xs sm:text-sm font-semibold ${spec.valueColorClass}`}>
                          {spec.primaryValue}
                        </div>
                        <div className="text-[10px] text-slate-400">{spec.subValue}</div>
                      </div>

                      <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 w-full">
                        <span>{isExpanded ? 'Details aktiv' : 'Mehr Infos'}</span>
                        <span className="text-emerald-400">{isExpanded ? '▴' : '▾'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Connected Expandable Deep-Dive Drawer for the selected top box */}
              {activeTopSpec && (
                <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                    <div className="space-y-1">
                      <div className="text-[11px] font-mono text-emerald-400">
                        TECHNISCHE SPEZIFIKATION · {activeTopSpec.label.toUpperCase()}
                      </div>
                      <h3 className="text-sm sm:text-base font-semibold text-slate-100">
                        {activeTopSpec.deepDiveTitle}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTopSpecId(null)}
                      className="px-2.5 py-1 text-xs font-mono text-slate-400 hover:text-slate-100 bg-slate-950 border border-slate-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Einklappen ▴
                    </button>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {activeTopSpec.summary}
                  </p>

                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
                    {/* Left: Short Facts & Architecture Bullets */}
                    <div className="xl:col-span-6 space-y-3 flex flex-col justify-between">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono tabular-nums">
                        {activeTopSpec.shortFacts.map((fact, idx) => (
                          <div
                            key={idx}
                            className="bg-slate-950/90 border border-slate-800/90 rounded-lg p-2.5 space-y-0.5"
                          >
                            <div className="text-[10px] text-slate-400">{fact.label}</div>
                            <div className="text-[11px] font-semibold text-slate-100 break-words">
                              {fact.value}
                            </div>
                          </div>
                        ))}
                      </div>

                      <ul className="space-y-1.5 text-xs text-slate-300">
                        {activeTopSpec.technicalBullets.map((bullet, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-emerald-400 font-mono shrink-0">✓</span>
                            <span className="leading-relaxed">{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Right: Code / Config Block */}
                    <div className="xl:col-span-6 bg-slate-950 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between space-y-2.5 font-mono text-xs">
                      <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400 border-b border-slate-800 pb-2">
                        <span>{activeTopSpec.codeSnippet.title}</span>
                        <span className="text-emerald-400">{activeTopSpec.codeSnippet.fileHint}</span>
                      </div>
                      <pre className="text-[11px] leading-relaxed text-slate-200 overflow-x-auto whitespace-pre">
                        {activeTopSpec.codeSnippet.code}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
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

        {/* Section 3: Overview of all embedded Tools & Parsers (6 expandable cards) */}
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
                HTML-Datei aktiv. Jede Box lässt sich für tiefere technische Parameter &amp;
                Code-Beispiele aufklappen.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-start">
              {/* Interactive Category Filter Tabs */}
              <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto max-w-full">
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

              <button
                type="button"
                onClick={toggleAllFilteredTools}
                className="min-h-[38px] px-3 py-1.5 text-xs font-mono text-emerald-300 hover:text-emerald-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {areAllFilteredToolsExpanded ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" />
                    <span>Alle Details einklappen</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>Alle Details ausklappen</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 items-start">
            {filteredTools.map((tool) => {
              const isExpanded = Boolean(expandedToolIds[tool.id]);
              return (
                <div
                  key={tool.id}
                  className={`border rounded-xl p-4 sm:p-6 flex flex-col justify-between space-y-4 sm:space-y-5 transition-colors ${
                    isExpanded
                      ? 'bg-slate-900 border-emerald-500/50'
                      : 'bg-slate-900/75 border-slate-800 hover:border-slate-700'
                  }`}
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

                  {/* Expandable Toggle Button */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpandedToolIds((prev) => ({
                          ...prev,
                          [tool.id]: !prev[tool.id],
                        }))
                      }
                      className="w-full min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-950/80 border border-slate-800 hover:border-emerald-500/40 text-xs font-mono text-emerald-300 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                    >
                      <span>
                        {isExpanded
                          ? 'Technische Details & Code einklappen'
                          : 'Technische Details & Code ausklappen'}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 shrink-0" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-slate-800 space-y-3">
                        {/* Combined Short-Facts Grid */}
                        <div className="space-y-1.5 font-mono tabular-nums">
                          {tool.technicalFacts.map((fact, fIdx) => (
                            <div
                              key={fIdx}
                              className="px-2.5 py-1.5 rounded bg-slate-950/90 border border-slate-800/90 flex flex-col gap-0.5"
                            >
                              <span className="text-[10px] text-slate-400">{fact.label}</span>
                              <span className="text-[11px] text-slate-100 font-semibold break-words">
                                {fact.value}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Deep-Dive Architectural Notes */}
                        <ul className="space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
                          {tool.deepDiveNotes.map((note, nIdx) => (
                            <li key={nIdx} className="flex items-start gap-1.5">
                              <span className="text-indigo-400 font-mono shrink-0">→</span>
                              <span>{note}</span>
                            </li>
                          ))}
                        </ul>

                        {/* Code / Config Snippet */}
                        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2 font-mono">
                          <div className="text-[10px] text-emerald-400 border-b border-slate-800 pb-1.5">
                            {tool.codeSnippet.title}
                          </div>
                          <pre className="text-[10px] leading-relaxed text-slate-200 overflow-x-auto whitespace-pre">
                            {tool.codeSnippet.code}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 4: Explanation how 100% local execution works (4 expandable workflow boxes) */}
        <section
          id="lokal-architektur"
          className="border-t border-slate-800/90 pt-10 sm:pt-12 space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="max-w-3xl space-y-2">
              <h2 className="text-xl sm:text-2xl font-bold text-slate-100">
                Ablauf: Vom HTML-Builder zum lokalen Offline-Arbeitsplatz
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                So greifen Bundle-Generierung, lokaler Doppelklick-Start und In-Memory-Analyse
                ineinander (klicken Sie auf einen Schritt für technische Details &amp; Code):
              </p>
            </div>

            <button
              type="button"
              onClick={toggleAllWorkflowSteps}
              className="self-start min-h-[38px] px-3 py-1.5 text-xs font-mono text-emerald-300 hover:text-emerald-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {areAllWorkflowStepsExpanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span>Alle 4 Schritte einklappen</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>Alle 4 Schritte ausklappen</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 items-start">
            {WORKFLOW_STEPS.map((stepItem) => {
              const isExpanded = Boolean(expandedStepIds[stepItem.id]);
              return (
                <div
                  key={stepItem.id}
                  className={`border rounded-xl p-4 sm:p-5 flex flex-col justify-between space-y-3 transition-colors ${
                    isExpanded
                      ? 'bg-slate-900 border-emerald-500/50'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs font-mono text-emerald-400 tabular-nums">
                      <span>{stepItem.stepBadge}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedStepIds((prev) => ({
                            ...prev,
                            [stepItem.id]: !prev[stepItem.id],
                          }))
                        }
                        className="text-[11px] text-slate-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                      >
                        <span>{isExpanded ? 'Weniger' : 'Details'}</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    <h3 className="text-sm font-semibold text-slate-100">
                      {stepItem.title}
                    </h3>

                    <p className="text-xs text-slate-400 leading-relaxed">
                      {stepItem.summary}
                    </p>
                  </div>

                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() =>
                      setExpandedStepIds((prev) => ({
                        ...prev,
                        [stepItem.id]: !prev[stepItem.id],
                      }))
                    }
                    className="w-full min-h-[36px] px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-emerald-500/40 text-[11px] font-mono text-emerald-300 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <span>{isExpanded ? 'Technik & Code ausblenden' : 'Technik & Code anzeigen'}</span>
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="pt-2.5 border-t border-slate-800 space-y-2.5">
                      <div className="space-y-1.5 font-mono tabular-nums">
                        {stepItem.technicalFacts.map((fact, idx) => (
                          <div
                            key={idx}
                            className="px-2 py-1.5 rounded bg-slate-950 border border-slate-800/90"
                          >
                            <div className="text-[10px] text-slate-400">{fact.label}</div>
                            <div className="text-[11px] font-semibold text-slate-100 break-words">
                              {fact.value}
                            </div>
                          </div>
                        ))}
                      </div>

                      <ul className="space-y-1 text-[11px] text-slate-300 leading-relaxed">
                        {stepItem.deepDiveBullets.map((b, idx) => (
                          <li key={idx} className="flex items-start gap-1.5">
                            <span className="text-emerald-400 font-mono shrink-0">✓</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>

                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1.5 font-mono">
                        <div className="text-[10px] text-emerald-400 border-b border-slate-800 pb-1">
                          {stepItem.codeSnippet.title}
                        </div>
                        <pre className="text-[10px] leading-relaxed text-slate-200 overflow-x-auto whitespace-pre">
                          {stepItem.codeSnippet.code}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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
