import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  FolderUp,
  HardDriveDownload,
  Layers,
  Loader2,
  PlayCircle,
  Scale,
  ShieldCheck,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import { DEFAULT_THEME_CONFIG } from '../data/mermaidTemplates';
import { buildScriptWorkspace } from '../utils/scriptCallflowParser';
import {
  buildAndDownloadOfflineApp,
  extractSeedFromRecoveryFile,
  inspectCachedStudioProject,
  isRunningAsOfflineSingleFile,
} from '../utils/offlineAppExporter';
import { OfflineWorkspaceSeed, SmartColorMode } from '../types/mermaidStudio';

type InfoWorkspaceTab = 'compliance' | 'architecture' | 'modules' | 'legal';
type TopTechSpecId = 'runtime' | 'graph-engine' | 'analysis-sim' | 'air-gapped';
type ComplianceStandardId = 'dsgvo' | 'iso27001' | 'nis2';
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

interface ComplianceControlRow {
  reference: string;
  auditQuestion: string;
  technicalProof: string;
  verdict: string;
}

interface ComplianceStandardSpec {
  id: ComplianceStandardId;
  label: string;
  subtitle: string;
  statusLabel: string;
  deepDiveTitle: string;
  summary: string;
  accentClass: string;
  activeBorderClass: string;
  auditFacts: Array<{ label: string; value: string }>;
  controlMatrix: ComplianceControlRow[];
  excludedRisks: string[];
  operatorResponsibilities: string[];
  verificationTitle: string;
  verificationHint: string;
  verificationSteps: string;
  approvalCopyText: string;
  legalClassification: string;
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
    label: 'Analyse & Sim',
    value: 'Live-Simulator',
    sublabel: 'Zeiten & Suche',
    accentClass: 'text-emerald-300',
    title: 'Interaktiver Live-Anruf-Simulator, Öffnungszeiten & Globale Suche',
    summary:
      'Simuliert Anrufe direkt live auf dem Callflow-Diagramm mit Play/Pause, Vor/Zurück, Tempo-Steuerung und automatischem Zielskript-Wechsel. Ergänzt durch Öffnungszeiten-Übersicht, globale Suche (Strg+K) und statische Logikprüfung.',
    facts: [
      { label: 'Anruf-Simulator', value: 'Play/Pause, Vor/Zurück, Tempo & Schritt-Leiste' },
      { label: 'Cross-Script-Sprung', value: 'Wechselt automatisch ins Zielskript & fokussiert Knoten' },
      { label: 'Öffnungszeiten', value: 'Skriptübergreifende SondZeit- & Feiertags-Auflösung' },
      { label: 'Globale Suche', value: 'Strg+K über Skripte, DNIS, Skillsets & Ansagen' },
    ],
    snippetTitle: 'LIVE-SIMULATION & PARITÄT IM CALLFLOW.HTML EXPORT',
    snippetCode: `// Schrittweise Pfadauswertung direkt auf dem aktiven Diagramm:
const trace = simulateCallflowPath(workspace, {
  entryScriptId, dnisInput, simulatedDay, simulatedTime, holidayActive, dtmfInputs
});
// Identischer Live-Simulator ist auch in der exportierten Callflow.html enthalten.`,
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

const COMPLIANCE_SPECS: ComplianceStandardSpec[] = [
  {
    id: 'dsgvo',
    label: 'DSGVO (EU 2016/679)',
    subtitle: 'Art. 5 · Art. 25 · Art. 28 · Art. 32 · Art. 44 ff.',
    statusLabel: 'Technisch geeignet · 0-Byte Offline',
    deepDiveTitle:
      'Datenschutz-Prüfmatrix: Reine RAM-Verarbeitung ohne Auftragsverarbeiter oder Drittlandtransfer',
    summary:
      'Die generierte Einzeldatei verarbeitet eingelesene Avaya-.s-Skripte, Visio-Dateien und Rufnummernpläne ausschließlich im flüchtigen Browser-Arbeitsspeicher (RAM) über die lokale HTML5-FileReader-API. Es existiert kein Backend, kein Benutzerkonto und kein ausgehender Netzwerkverkehr.',
    accentClass: 'text-emerald-300',
    activeBorderClass: 'border-emerald-500/70 bg-slate-900 text-slate-100',
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
    verificationTitle: '60-SEKUNDEN-PRÜFNACHWEIS (DATENSCHUTZ)',
    verificationHint: 'Browser DevTools · Network',
    verificationSteps: `# 1. Offline-HTML lokal per Doppelklick (file://) öffnen
# 2. DevTools öffnen (F12) -> Tab "Netzwerk" (Network)
# 3. Skript-Ordner laden, Diagramm filtern & HTML/CSV exportieren
#
# Erwartetes Prüfergebnis:
#   Requests: 0  |  Transferred: 0 B  |  External Hosts: keine
#   Cookies:  0  |  Third-Party-Calls: keine`,
    approvalCopyText: `Datenschutz-Kurzstellungnahme (DSGVO) – Offline-HTML Callflow-Tool:
• Betriebsart: Statische lokale Single-File-HTML (file://), Ausführung vollständig im Browser-RAM.
• Netzwerkverkehr: 0 Byte (keine Cloud-API, keine CDNs, keine Webfonts, keine Telemetrie, keine Cookies).
• AV-Vertrag (Art. 28 DSGVO) & Drittlandtransfer (Art. 44 ff.): Nicht einschlägig, da kein externer Auftragsverarbeiter eingebunden ist.
• TOMs & Privacy by Design (Art. 25 / 32 DSGVO): Daten verbleiben auf dem verwalteten Unternehmens-Endgerät; Exporte werden lokal gespeichert.
• Eigenprüfung: Nachweisbar über Browser-DevTools (Network-Tab = 0 Requests).`,
    legalClassification:
      'Einordnung: Die 0-Byte-Offline-Architektur erfüllt die technischen Voraussetzungen für datenschutzkonformen lokalen Betrieb. Organisatorische Pflichten (Endgeräte-Zugriff, Ablage exportierter Dateien) liegen beim betreibenden Unternehmen.',
  },
  {
    id: 'iso27001',
    label: 'ISO/IEC 27001:2022',
    subtitle: 'Annex A.5.14 · A.5.21 · A.8.12 · A.8.20 · A.8.25',
    statusLabel: 'Technisch geeignet · Air-Gapped',
    deepDiveTitle:
      'ISMS-Prüfmatrix (Annex A): Keine Ports, kein DLP-Risiko und SHA-256-hashbares Einzelartefakt',
    summary:
      'Das Werkzeug benötigt weder lokale Server-Prozesse noch administrative Installationsrechte oder Firewall-Ausnahmen. Die gesamte Laufzeit liegt statisch in einer einzigen auditierbaren HTML-Datei vor und lässt sich wie ein statisches Dokument freigeben und hashen.',
    accentClass: 'text-indigo-300',
    activeBorderClass: 'border-indigo-500/70 bg-slate-900 text-slate-100',
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
    verificationTitle: 'PRÜFNACHWEIS FÜR IT-SECURITY / ISMS',
    verificationHint: 'PowerShell / SHA-256 Audit',
    verificationSteps: `# 1. SHA-256 Freigabe-Hash erzeugen (Windows PowerShell):
Get-FileHash .\\MermaidFree2UseOpen_Offline.html -Algorithm SHA256

# 2. Statische Prüfung auf externe Skript-/CDN-Aufrufe (0 Treffer):
Select-String -Path .\\MermaidFree2UseOpen_Offline.html -Pattern "<script[^>]+src=https?://|unpkg\\.com|jsdelivr\\.net|fonts\\.googleapis"

# Linux / macOS:
sha256sum MermaidFree2UseOpen_Offline.html`,
    approvalCopyText: `IT-Security / ISMS-Kurzstellungnahme (ISO/IEC 27001:2022) – Offline-HTML Callflow-Tool:
• Architektur: Statische Single-File-HTML ohne lokale Installation, ohne Server-Port und ohne Admin-Rechte.
• Annex A.8.12 / A.8.20 (DLP & Netzwerksicherheit): 0 Byte ausgehender Traffic, 100 % Air-Gap-fähig auf isolierten VMs/Sprungservern.
• Annex A.5.21 (IKT-Lieferkette): Keine externen Runtime-CDNs oder dynamischen Skript-Nachladungen; statisch im Artefakt eingefroren.
• Annex A.8.25 (Sichere Entwicklung): Mermaid securityLevel="strict", XSS-sichere Serialisierung, vollständig per SHA-256 hash- und prüfbar.`,
    legalClassification:
      'Einordnung: Eine einzelne HTML-Datei trägt keine eigene ISO-27001-Organisationszertifizierung. Die Architektur ist gezielt darauf ausgelegt, die technischen Annex-A-Kontrollen eines bestehenden ISMS ohne Zusatzrisiken zu erfüllen.',
  },
  {
    id: 'nis2',
    label: 'NIS2 (EU 2022/2555)',
    subtitle: 'Art. 21 Abs. 2 lit. a, c, d, i (Risiko · Kontinuität · Lieferkette)',
    statusLabel: 'Technisch geeignet · Zero-Cloud',
    deepDiveTitle:
      'NIS2-Prüfmatrix (Art. 21): Resiliente Offline-Verfügbarkeit & geschlossene Laufzeit-Lieferkette',
    summary:
      'Für NIS2-regulierte Einrichtungen und KRITIS-nahe Telekommunikations-Teams eliminiert der autarke Offline-Betrieb klassische Cloud-, API- und Lieferketten-Risiken und sichert die jederzeitige Nutzbarkeit von Notfall- und Callflow-Plänen.',
    accentClass: 'text-sky-300',
    activeBorderClass: 'border-sky-500/70 bg-slate-900 text-slate-100',
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
          'Ja. Callflow-Analysen, Live-Anruf-Simulator, Öffnungszeiten-Prüfungen und interaktive HTML-Exporte funktionieren ohne Internet, Proxy oder Lizenzserver.',
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
    verificationTitle: 'AIR-GAP- & RESILIENZ-TEST (NIS2)',
    verificationHint: 'Offline-VM / Flugmodus-Test',
    verificationSteps: `# 1. Netzwerkadapter trennen (Flugmodus / isolierte Offline-VM)
# 2. Freigegebene .html-Datei direkt im Unternehmens-Browser öffnen
# 3. Skript-Ordner einlesen, Logik prüfen & HTML/CSV exportieren
#
# Erwartetes Prüfergebnis:
#   100 % Funktionsumfang ohne Internet, Proxy oder Server.
#   Keine Installationsspuren oder offenen Ports im OS.`,
    approvalCopyText: `NIS2-Kurzstellungnahme (EU 2022/2555 Art. 21) – Offline-HTML Callflow-Tool:
• Risikomanagement (Art. 21 Abs. 2a): Statisches Offline-Werkzeug ohne Cloud-Backend, ohne offene Ports und ohne Admin-Rechte.
• Betriebskontinuität / BCM (Art. 21 Abs. 2c): 100 % offline- und air-gap-fähig – auch bei vollständigem Außennetzausfall nutzbar.
• Lieferketten-Sicherheit (Art. 21 Abs. 2d): Keine dynamischen Drittanbieter-CDNs oder Fern-Updates zur Laufzeit; eingefrorene Einzeldatei.
• Asset-Kontrolle (Art. 21 Abs. 2i): Zentral versionierbar und per SHA-256 verifizierbar auf internen Netzlaufwerken.`,
    legalClassification:
      'Einordnung: NIS2 verpflichtet die regulierte Einrichtung als Ganzes. Durch den autarken Offline-Betrieb entstehen keine zusätzlichen Cloud-, Melde- oder Lieferketten-Risiken im Sinne von Art. 21.',
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
      'Der Offline-Builder bündelt React 19, Tailwind-Styles, Mermaid.js v11, Eclipse ELK, JSZip, den Parser für Avaya-.s-Skripte sowie den Live-Anruf-Simulator synchron in eine einzige portable .html-Datei.',
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
    shortTitle: 'Im RAM parsen & testen',
    subtitle: '.s, Visio & Live-Simulator',
    detailTitle: '03 · Skripte, Ordner & Visio lokal im Browser-RAM analysieren',
    summary:
      'Avaya-.s-Skripte, komplette Skript-Verzeichnisse und Visio-Dateien (.vsdx) werden per HTML5 FileReader im Arbeitsspeicher verarbeitet, als 2-Ebenen-Callflow visualisiert und direkt im Live-Anruf-Simulator durchlaufen.',
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
      'Aus der lokalen Offline-App heraus lassen sich jederzeit interaktive Read-Only Callflow.html-Viewer (inkl. Live-Simulator), Excel-CSVs, Markdown-Doku sowie neue Offline-App-Projekt-Snapshots (DOM-Quine) erzeugen.',
    facts: [
      { label: 'Fachbereichs-Viewer', value: 'Callflow.html mit vor-gerenderten SVGs & Simulator' },
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
      'Zusätzlich erzeugt der Callflow.html-Export einen eigenständigen Read-Only-Viewer für Fachabteilungen inkl. Live-Anruf-Simulator und Öffnungszeiten.',
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
    id: 'call-simulator',
    category: 'analysis',
    categoryLabel: 'Analyse & Simulation',
    title: 'Live-Anruf-Simulator (Play, Pause & Schritt-Steuerung)',
    versionTag: 'Live-Canvas-HUD · Cross-Script-Fokus',
    pipelineLine: 'Eingabeparameter (DNIS / Zeit / DTMF) → Trace-Engine → Live-Knotenfokus',
    description:
      'Simuliert konkrete Anrufszenarien Schritt für Schritt direkt auf dem Callflow-Diagramm — inklusive automatischem Wechsel ins Zielskript und sauberer Parität im Callflow.html-Export.',
    capabilities: [
      'Kompakte Steuerleiste direkt über dem Diagramm: Play/Pause, Schritt Zurück/Vor, Tempo (0.5x–2x) & klickbare Schritt-Leiste',
      'Testet DNIS/Rufnummer, Wochentag, Uhrzeit, Feiertags-Status und DTMF-Tastenwahl realitätsnah',
      'Wechselt bei Skript-Sprüngen automatisch in das Zielskript und fokussiert den aktiven Knoten per Smooth-Pan',
    ],
    facts: [
      { label: 'Steuerung', value: 'Play/Pause · Zurück · Vor · 0.5x / 1x / 2x' },
      { label: 'Darstellung', value: 'Live-Highlight direkt auf dem SVG-Callflow' },
      { label: 'Export-Parität', value: 'Vollständig lauffähig in exportierter Callflow.html' },
    ],
    codeTitle: 'LIVE-TRACE-SCHRITT & ZIELSKRIPT-WECHSEL',
    code: `// Bei jedem Simulationsschritt wird das Zielskript automatisch aktiviert:
if (step.scriptId && step.scriptId !== activeScriptId) {
  onSelectScript(step.scriptId);
}
focusCanvasNode(step.nodeId, { highlightPath: visitedNodeIds });`,
  },
  {
    id: 'opening-hours',
    category: 'analysis',
    categoryLabel: 'Analyse & Simulation',
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
    categoryLabel: 'Analyse & Simulation',
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
      'Interaktive Callflow.html (Read-Only): Vor-gerenderte 2-Ebenen-SVGs, Pfad-Tracing, Suche, Zeiten & Live-Anruf-Simulator',
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
  const isOfflineModeActive = useMemo(() => isRunningAsOfflineSingleFile(), []);
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
  const [isBuildingProject, setIsBuildingProject] = useState<boolean>(false);
  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  const [buildResult, setBuildResult] = useState<{
    filename: string;
    sizeMb: string;
    timestamp: string;
  } | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  // Interactive UI state
  const [activeTopSpecId, setActiveTopSpecId] = useState<TopTechSpecId | null>(null);
  const [activeInfoTab, setActiveInfoTab] = useState<InfoWorkspaceTab>('compliance');

  // Tab 1: IT-Sicherheit & Datenschutz state
  const [activeComplianceId, setActiveComplianceId] =
    useState<ComplianceStandardId>('dsgvo');
  const [copiedCompliance, setCopiedCompliance] = useState<boolean>(false);

  // Tab 2: Architecture & Workflow state
  const [activeWorkflowStepId, setActiveWorkflowStepId] = useState<string>('step-1');
  const [activeArchTab, setActiveArchTab] = useState<ArchInspectorTab>('mermaid-elk');

  // Tab 3: Modules Master-Detail state
  const [activeModuleCategory, setActiveModuleCategory] = useState<ModuleCategory>('all');
  const [selectedModuleId, setSelectedModuleId] = useState<string>('mermaid-elk');

  // Tab 4: Legal copy state
  const [copiedLegalNotice, setCopiedLegalNotice] = useState<boolean>(false);

  const normalizedFilename = useMemo(() => {
    const trimmed = customFilename.trim();
    if (!trimmed) return 'MermaidFree2UseOpen_Offline.html';
    const safe = trimmed.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_');
    return safe.toLowerCase().endsWith('.html') ? safe : `${safe}.html`;
  }, [customFilename]);

  const activeTopSpec =
    TOP_TECH_SPECS.find((spec) => spec.id === activeTopSpecId) ?? null;

  const activeComplianceSpec =
    COMPLIANCE_SPECS.find((spec) => spec.id === activeComplianceId) ??
    COMPLIANCE_SPECS[0];

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

  const navigateToSection = (target: 'builder' | InfoWorkspaceTab) => {
    if (target === 'builder') {
      document.getElementById('builder')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setActiveInfoTab(target);
    document.getElementById('info-workspace')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleDownloadProjectOffline = async () => {
    if (isBuildingProject) return;
    setIsBuildingProject(true);
    setBuildError(null);

    try {
      const shouldEmbedProject = Boolean(effectiveSeedSource) && embedCachedProject;
      const baseProjectSeed = shouldEmbedProject && effectiveSeedSource
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
          initialShellView: 'builder',
          ...baseProjectSeed,
        },
        filename: 'MermaidFree2UseOpen_Projekt_Offline.html',
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
          : 'Das lokale Projekt-Paket konnte nicht generiert werden.'
      );
    } finally {
      setIsBuildingProject(false);
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

  const handleCopyComplianceSummary = async () => {
    const ok = await copyTextWithOfflineFallback(activeComplianceSpec.approvalCopyText);
    if (ok) {
      setCopiedCompliance(true);
      window.setTimeout(() => setCopiedCompliance(false), 2200);
    }
  };

  const handleCopyLegalNotice = async () => {
    const ok = await copyTextWithOfflineFallback(LEGAL_TRADEMARK_COPY_TEXT);
    if (ok) {
      setCopiedLegalNotice(true);
      window.setTimeout(() => setCopiedLegalNotice(false), 2200);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Zone 1: Brand */}
          <div className="flex items-center gap-2.5 min-w-0 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center shrink-0">
              <HardDriveDownload className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight text-slate-100 whitespace-nowrap">
                MermaidFree2UseOpen
              </div>
              <div className="text-[11px] text-slate-400 whitespace-nowrap hidden sm:block">
                Offline-Callflow-Studio · Einzeldatei-Builder
              </div>
            </div>
          </div>

          {/* Zone 2: Section Nav */}
          <nav
            aria-label="Hauptnavigation"
            className="hidden md:flex items-center gap-1"
          >
            <button
              type="button"
              onClick={() => navigateToSection('builder')}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-900 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Offline-Builder
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('compliance')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeInfoTab === 'compliance'
                  ? 'text-emerald-300 bg-slate-900'
                  : 'text-slate-300 hover:text-slate-100 hover:bg-slate-900'
              }`}
            >
              IT &amp; Sicherheit
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('architecture')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeInfoTab === 'architecture'
                  ? 'text-indigo-300 bg-slate-900'
                  : 'text-slate-300 hover:text-slate-100 hover:bg-slate-900'
              }`}
            >
              Architektur
            </button>
            <button
              type="button"
              onClick={() => navigateToSection('modules')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeInfoTab === 'modules' || activeInfoTab === 'legal'
                  ? 'text-sky-300 bg-slate-900'
                  : 'text-slate-300 hover:text-slate-100 hover:bg-slate-900'
              }`}
            >
              Module &amp; Rechtliches
            </button>
          </nav>

          {/* Zone 3: Version & Project Offline Download (Main Page + Builder without Studio button) */}
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="text-[11px] font-mono text-slate-400 tabular-nums whitespace-nowrap">
              Version 1.0.2
            </span>
            {isOfflineModeActive && (
              <span className="hidden xl:inline text-[11px] font-mono text-emerald-400 whitespace-nowrap">
                · file://
              </span>
            )}
            <button
              type="button"
              disabled={isBuildingProject}
              onClick={handleDownloadProjectOffline}
              title="Hauptseite inklusive Offline-HTML-Builder für den lokalen Betrieb (file://) herunterladen"
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isBuildingProject ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <HardDriveDownload className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Projekt offline laden</span>
              <span className="sm:hidden">Projekt laden</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        {/* ABOVE THE FOLD: Compact Intro + Offline-HTML-Builder */}
        <section
          id="builder"
          className="scroll-mt-20 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
        >
          {/* Left Column: Value Prop + 4 Interactive Spec Cards */}
          <div className="lg:col-span-7 space-y-5">
            <div className="space-y-2.5">
              <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 tabular-nums">
                Version 1.0.2 · Reine Offline-Anwendung · file:// Einzeldatei · 0 Byte Netzwerkverkehr
              </p>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-50 leading-tight">
                Offline-Callflow-Studio für Avaya-.s-Skripte, Visio &amp; Mermaid
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
                Dieses Werkzeug wird ausschließlich als lokale Offline-HTML-Datei
                ausgeführt. Laden Sie Ihr konfiguriertes Einzeldatei-Paket herunter und
                starten Sie Analyse, Live-Anruf-Simulator, Öffnungszeiten und
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

        {/* INTERACTIVE 4-TAB INFO WORKSPACE */}
        <section id="info-workspace" className="scroll-mt-20 space-y-5">
          {/* Segmented Tab Bar */}
          <div className="border-b border-slate-800 flex items-center gap-1 overflow-x-auto pb-px">
            {[
              {
                id: 'compliance' as const,
                label: 'IT-Sicherheit & Datenschutz',
                icon: ShieldCheck,
                meta: '3 Normen',
              },
              {
                id: 'architecture' as const,
                label: 'Architektur & Datenfluss',
                icon: Layers,
                meta: '4 Schritte',
              },
              {
                id: 'modules' as const,
                label: 'Eingebundene Module',
                icon: Wrench,
                meta: `${EMBEDDED_MODULES.length}`,
              },
              {
                id: 'legal' as const,
                label: 'Marken- & Nutzungshinweis',
                icon: Scale,
                meta: null,
              },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeInfoTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveInfoTab(tab.id)}
                  className={`px-3.5 py-2.5 text-xs font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'border-emerald-400 text-slate-50 bg-slate-900/60'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
                  }`}
                >
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  />
                  <span>{tab.label}</span>
                  {tab.meta && (
                    <span className="text-[11px] font-mono tabular-nums text-slate-400">
                      {tab.meta}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* TAB 1: IT-SICHERHEIT & DATENSCHUTZ (REINE FAKTEN) */}
          {activeInfoTab === 'compliance' && (
            <div className="space-y-4">
              {/* Norm Switcher + Copy Action */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {COMPLIANCE_SPECS.map((spec) => {
                    const isSelected = spec.id === activeComplianceId;
                    return (
                      <button
                        key={spec.id}
                        type="button"
                        onClick={() => setActiveComplianceId(spec.id)}
                        className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isSelected
                            ? spec.activeBorderClass
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        {spec.label}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleCopyComplianceSummary}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer self-start md:self-auto"
                >
                  {copiedCompliance ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Freigabetext kopiert</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-300" />
                      <span>Freigabetext kopieren</span>
                    </>
                  )}
                </button>
              </div>

              {/* Compact 2-Column Pure Facts Layout */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* Left Column: Control Matrix + Excluded Risks & Operator Responsibilities */}
                <div className="lg:col-span-7 space-y-4">
                  {/* Control Matrix */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-800 space-y-0.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-100">
                          {activeComplianceSpec.deepDiveTitle}
                        </h3>
                      </div>
                      <p className="text-[11px] font-mono text-slate-400">
                        {activeComplianceSpec.subtitle}
                      </p>
                    </div>

                    <div className="divide-y divide-slate-800/90">
                      {activeComplianceSpec.controlMatrix.map((row) => (
                        <div key={row.reference} className="px-4 py-3 space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-100">
                              {row.auditQuestion}
                            </span>
                            <span
                              className={`text-[11px] font-mono whitespace-nowrap shrink-0 ${activeComplianceSpec.accentClass}`}
                            >
                              {row.reference} · {row.verdict}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed">
                            {row.technicalProof}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Excluded Risks & Operator Responsibilities Side-by-Side */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
                      <h4 className="text-xs font-semibold text-slate-100">
                        Technisch ausgeschlossene Risiken
                      </h4>
                      <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
                        {activeComplianceSpec.excludedRisks.map((risk) => (
                          <li key={risk} className="flex items-start gap-2">
                            <span className="text-emerald-400 select-none">•</span>
                            <span>{risk}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
                      <h4 className="text-xs font-semibold text-slate-100">
                        Organisatorische Betreiberpflichten
                      </h4>
                      <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
                        {activeComplianceSpec.operatorResponsibilities.map((duty) => (
                          <li key={duty} className="flex items-start gap-2">
                            <span className="text-slate-500 select-none">•</span>
                            <span>{duty}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Right Column: Summary + 4 Audit Facts + Verification Block + Classification */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                      <span className="text-xs font-semibold text-slate-100">
                        {activeComplianceSpec.label}
                      </span>
                      <span
                        className={`text-[11px] font-mono ${activeComplianceSpec.accentClass}`}
                      >
                        {activeComplianceSpec.statusLabel}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {activeComplianceSpec.summary}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {activeComplianceSpec.auditFacts.map((fact) => (
                        <div
                          key={fact.label}
                          className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800"
                        >
                          <div className="text-[11px] text-slate-400">{fact.label}</div>
                          <div
                            className={`text-xs font-medium mt-0.5 ${activeComplianceSpec.accentClass}`}
                          >
                            {fact.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
                    <div className="px-3.5 py-2 border-b border-slate-800 flex items-center justify-between gap-2 text-[11px] font-mono">
                      <span className="text-slate-300 flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{activeComplianceSpec.verificationTitle}</span>
                      </span>
                      <span className="text-slate-500">
                        {activeComplianceSpec.verificationHint}
                      </span>
                    </div>
                    <pre className="p-3.5 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                      {activeComplianceSpec.verificationSteps}
                    </pre>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {activeComplianceSpec.legalClassification}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ARCHITEKTUR & OFFLINE-DATENFLUSS */}
          {activeInfoTab === 'architecture' && (
            <div className="space-y-6">
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
            </div>
          )}

          {/* TAB 3: EINGEBUNDENE MODULE (MASTER-DETAIL) */}
          {activeInfoTab === 'modules' && (
            <div className="space-y-4">
              {/* Category Filter */}
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { id: 'all' as const, label: `Alle (${EMBEDDED_MODULES.length})` },
                  { id: 'engine' as const, label: 'Layout & Rendering' },
                  { id: 'parsers' as const, label: 'Skript- & Visio-Parser' },
                  { id: 'analysis' as const, label: 'Analyse & Simulation' },
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
                            {mod.id === 'call-simulator' && (
                              <PlayCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            )}
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
          )}

          {/* TAB 4: MARKEN-, URHEBER- & NUTZUNGSHINWEIS */}
          {activeInfoTab === 'legal' && (
            <div className="space-y-4">
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
          )}
        </section>
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
              Visio Parser · Live-Anruf-Simulator
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
