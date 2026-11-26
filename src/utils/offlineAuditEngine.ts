import { triggerLocalDownload } from './mermaidEngine';

export type AuditComplianceStandardId = 'dsgvo' | 'iso27001' | 'nis2' | 'bsi';

export interface AuditControlRow {
  reference: string;
  auditQuestion: string;
  technicalProof: string;
  verdict: string;
}

export interface AuditComplianceStandardSpec {
  id: AuditComplianceStandardId;
  indexLabel: string;
  label: string;
  subtitle: string;
  statusLabel: string;
  deepDiveTitle: string;
  summary: string;
  accentClass: string;
  activeBorderClass: string;
  auditFacts: Array<{ label: string; value: string }>;
  controlMatrix: AuditControlRow[];
  excludedRisks: string[];
  operatorResponsibilities: string[];
  verificationTitle: string;
  verificationHint: string;
  verificationSteps: string;
  approvalCopyText: string;
  legalClassification: string;
}

export interface EnterpriseHighlightTile {
  id: string;
  label: string;
  value: string;
  sublabel: string;
  accentClass: string;
}

export interface EnterpriseStakeholderFact {
  id: string;
  stakeholder:
    | 'IT-Security / ISMS'
    | 'Datenschutz (DSB)'
    | 'Betriebsrat'
    | 'IT-Betrieb / Paketierung';
  factTitle: string;
  evidence: string;
  reference: string;
}

export interface CodeInspectAuditItem {
  id: string;
  numberLabel: string;
  title: string;
  category: string;
  relevanceForCompany: string;
  technicalExplanation: string;
  excludedRisk: string;
  moduleHint: string;
  codeTitle: string;
  codeExcerpt: string;
  auditFacts: Array<{ label: string; value: string }>;
}

export type SbomScope = 'runtime-offline' | 'build-only' | 'excluded-from-bundle';

export interface SbomPackageItem {
  name: string;
  versionSpec: string;
  license: string;
  scope: SbomScope;
  scopeLabel: string;
  purpose: string;
  networkBehavior: string;
  corporateNote: string;
}

export const AUDIT_APP_VERSION = '1.4.5';

export const ENTERPRISE_HIGHLIGHT_TILES: EnterpriseHighlightTile[] = [
  {
    id: 'network',
    label: 'Netzwerkverkehr',
    value: '0 Byte Traffic',
    sublabel: 'Kein CDN · kein API-Call · Air-Gap',
    accentClass: 'text-emerald-300',
  },
  {
    id: 'install',
    label: 'Installation',
    value: 'Zero-Install',
    sublabel: 'Direkt via file:// · ohne Admin-Recht',
    accentClass: 'text-sky-300',
  },
  {
    id: 'ram',
    label: 'Skript-Verarbeitung',
    value: 'Reiner Browser-RAM',
    sublabel: 'HTML5 ArrayBuffer · kein Upload',
    accentClass: 'text-indigo-300',
  },
  {
    id: 'dsgvo',
    label: 'Datenschutz (DSGVO)',
    value: 'Kein AVV nötig',
    sublabel: '0 Cookies · 0 Tracking · lokal',
    accentClass: 'text-emerald-300',
  },
  {
    id: 'betrvg',
    label: 'Betriebsrat (§ 87)',
    value: 'Keine Überwachung',
    sublabel: 'Kein Login · keine Telemetrie',
    accentClass: 'text-sky-300',
  },
  {
    id: 'sandbox',
    label: 'Sicherheit',
    value: 'Strict & Single-IIFE',
    sublabel: 'XSS-Escaping · SHA-256 hashbar',
    accentClass: 'text-amber-300',
  },
];

export const AUDIT_COMPLIANCE_STANDARDS: AuditComplianceStandardSpec[] = [
  {
    id: 'dsgvo',
    indexLabel: '01',
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
          'Nur explizit ausgewählte Skripte werden lokal per FileReader im RAM geparst; keine Vorbefüllung mit fremden Unternehmensdaten, Durchwahlen oder Namen.',
        verdict: 'Erfüllt',
      },
      {
        reference: 'Art. 25 Abs. 1 & 2',
        auditQuestion: 'Sind Privacy by Design & Default technisch umgesetzt?',
        technicalProof:
          'Vollständiges Inline-Bundling (Single-IIFE-Build ohne externe Chunks) eliminiert CDNs, Webfonts, Cloud-APIs und externe Skript-Aufrufe ab Werk.',
        verdict: 'Erfüllt',
      },
      {
        reference: 'Art. 28 & Art. 44–49',
        auditQuestion: 'Ist ein AV-Vertrag oder eine TIA (Drittland-Prüfung) nötig?',
        technicalProof:
          'Nein. Es werden keine Daten an einen Anbieter, Hoster oder Subprozessor übermittelt; sämtliche Verarbeitung verbleibt beim Verantwortlichen.',
        verdict: 'Kein AVV nötig',
      },
      {
        reference: 'Art. 32 (TOMs)',
        auditQuestion: 'Wie sind Vertraulichkeit und Integrität im Betrieb abgesichert?',
        technicalProof:
          'Ausführung in der bestehenden Browser-Sandbox auf verwalteten Firmen-Endpoints; Exporte (HTML, SVG, CSV, PNG, MD) erfolgen nur per manuellem Download.',
        verdict: 'Unterstützt',
      },
    ],
    excludedRisks: [
      'Kein Upload von Durchwahlen, Agenten-Skillsets oder Routing-Skripten an externe Server.',
      'Keine Benutzer-Registrierung, keine Session-Cookies und kein Browser-Fingerprinting.',
      'Kein impliziter Datenabfluss über CDN-Logs (kein Google Fonts, unpkg oder jsDelivr).',
    ],
    operatorResponsibilities: [
      'Exportierte HTML-/CSV-Dokumentationen auf berechtigten internen Netzlaufwerken ablegen.',
      'Lokalen Browser-Cache bei gemeinsam genutzten Endgeräten über „Von vorne / Löschen“ leeren.',
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
    approvalCopyText: `Datenschutz-Kurzstellungnahme (DSGVO) – Offline-HTML Callflow-Tool (Version ${AUDIT_APP_VERSION}):
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
    indexLabel: '02',
    label: 'ISO/IEC 27001:2022',
    subtitle: 'Annex A.5.14 · A.5.19 · A.5.21 · A.8.8 · A.8.9 · A.8.12 · A.8.20 · A.8.25',
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
          'Keine ausgehenden HTTP/HTTPS/WebSocket-Verbindungen; sensible Netz-, DNIS- und Callflow-Topologien verlassen das interne Segment nicht.',
        verdict: 'Erfüllt',
      },
      {
        reference: 'A.5.19 & A.5.21',
        auditQuestion: 'Sind Drittanbieter-Laufzeitabhängigkeiten kontrollierbar?',
        technicalProof:
          'Alle Laufzeit-Bibliotheken (React, Mermaid, ELK, JSZip, Lucide, Motion) sind zur Build-Zeit eingebettet – keine fremden Skript-Nachladungen.',
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
          'Mermaid nutzt securityLevel: "strict", HTML-/Seed-Exporte maskieren Script-Tags XSS-sicher und die Einzeldatei ist statisch auditierbar.',
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
    approvalCopyText: `IT-Security / ISMS-Kurzstellungnahme (ISO/IEC 27001:2022) – Offline-HTML Callflow-Tool (Version ${AUDIT_APP_VERSION}):
• Architektur: Statische Single-File-HTML ohne lokale Installation, ohne Server-Port und ohne Admin-Rechte.
• Annex A.8.12 / A.8.20 (DLP & Netzwerksicherheit): 0 Byte ausgehender Traffic, 100 % Air-Gap-fähig auf isolierten VMs/Sprungservern.
• Annex A.5.21 (IKT-Lieferkette): Keine externen Runtime-CDNs oder dynamischen Skript-Nachladungen; statisch im Artefakt eingefroren.
• Annex A.8.25 (Sichere Entwicklung): Mermaid securityLevel="strict", XSS-sichere Serialisierung, vollständig per SHA-256 hash- und prüfbar.`,
    legalClassification:
      'Einordnung: Eine einzelne HTML-Datei trägt keine eigene ISO-27001-Organisationszertifizierung. Die Architektur ist gezielt darauf ausgelegt, die technischen Annex-A-Kontrollen eines bestehenden ISMS ohne Zusatzrisiken zu erfüllen.',
  },
  {
    id: 'nis2',
    indexLabel: '03',
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
          'Ja. Callflow-Analysen, Öffnungszeiten-Prüfungen, Logik-Checks und interaktive HTML-Exporte funktionieren ohne Internet, Proxy oder Lizenzserver.',
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
    approvalCopyText: `NIS2-Kurzstellungnahme (EU 2022/2555 Art. 21) – Offline-HTML Callflow-Tool (Version ${AUDIT_APP_VERSION}):
• Risikomanagement (Art. 21 Abs. 2a): Statisches Offline-Werkzeug ohne Cloud-Backend, ohne offene Ports und ohne Admin-Rechte.
• Betriebskontinuität / BCM (Art. 21 Abs. 2c): 100 % offline- und air-gap-fähig – auch bei vollständigem Außennetzausfall nutzbar.
• Lieferketten-Sicherheit (Art. 21 Abs. 2d): Keine dynamischen Drittanbieter-CDNs oder Fern-Updates zur Laufzeit; eingefrorene Einzeldatei.
• Asset-Kontrolle (Art. 21 Abs. 2i): Zentral versionierbar und per SHA-256 verifizierbar auf internen Netzlaufwerken.`,
    legalClassification:
      'Einordnung: NIS2 verpflichtet die regulierte Einrichtung als Ganzes. Durch den autarken Offline-Betrieb entstehen keine zusätzlichen Cloud-, Melde- oder Lieferketten-Risiken im Sinne von Art. 21.',
  },
  {
    id: 'bsi',
    indexLabel: '04',
    label: 'BSI IT-Grundschutz',
    subtitle: 'BSI-Standard 200-2 · APP.1.1 · APP.1.2 · CON.1 · OPS.1.1.3',
    statusLabel: 'Technisch geeignet · Zero-Install Client',
    deepDiveTitle:
      'BSI IT-Grundschutz-Prüfmatrix: Gehärtete Browser-Sandbox, keine Privilegien & volle Revisierbarkeit',
    summary:
      'Entspricht den technischen Anforderungen des BSI IT-Grundschutz-Kompendiums für lokale Browser-Werkzeuge (APP.1.1 / APP.1.2): Keine Elevation of Privilege, keine Persistenz auf OS-Ebene, nachvollziehbare Integrität über SHA-256 und restriktive Skript-Ausführung.',
    accentClass: 'text-amber-300',
    activeBorderClass: 'border-amber-500/70 bg-slate-900 text-slate-100',
    auditFacts: [
      { label: 'APP.1.1 (Client-Software)', value: 'Läuft rein in Standard-Browser-Sandbox' },
      { label: 'CON.1 (Kryptokonzept)', value: 'Kein externer Transport · SHA-256 prüfbar' },
      { label: 'OPS.1.1.3 (Patch & Change)', value: 'Versionierte Einzeldatei ohne Auto-Updater' },
      { label: 'Privilegien', value: 'Kein Admin-Konto · kein Installer · keine Registry' },
    ],
    controlMatrix: [
      {
        reference: 'APP.1.1.A1 & A2',
        auditQuestion: 'Benötigt das Werkzeug erweiterte Benutzerrechte oder System-Registry-Zugriffe?',
        technicalProof:
          'Nein. Ausführung erfolgt ausschließlich als reguläre HTML-Datei im eingeschränkten Benutzerkontext des gehärteten Standard-Browsers.',
        verdict: 'Erfüllt',
      },
      {
        reference: 'APP.1.2 (Web-Browser)',
        auditQuestion: 'Werden unsichere Plug-ins, aktive Inhalte von Drittservern oder Cross-Origin-Calls genutzt?',
        technicalProof:
          'Keine Browser-Plugins, kein Flash/Java, keine Cross-Origin-Requests, keine externen Nachladungen und Mermaid im strikten Sicherheitsmodus.',
        verdict: 'Erfüllt',
      },
      {
        reference: 'CON.1 & OPS.1.2',
        auditQuestion: 'Wie werden Integrität und Vertraulichkeit bei Verteilung im internen Netz gesichert?',
        technicalProof:
          'Durch unveränderlichen Single-File-Build mit eindeutigem SHA-256-Prüfwert; Datenhaltung bei Nutzung rein flüchtig im RAM bzw. lokalem Profil.',
        verdict: 'Erfüllt',
      },
      {
        reference: 'OPS.1.1.3 & DER.1',
        auditQuestion: 'Wie erfolgt die Nachvollziehbarkeit von Versionsständen und Sicherheitsupdates?',
        technicalProof:
          `Keine stillen Hintergrund-Updates. Neue Stände (aktuell Version ${AUDIT_APP_VERSION}) werden explizit als benannte Einzeldatei über interne Freigabeprozesse ersetzt.`,
        verdict: 'Unterstützt',
      },
    ],
    excludedRisks: [
      'Keine ausführbaren Binärdateien (.exe, .msi, .ps1, .bat) und kein Makro-Code (kein VBA).',
      'Kein Eingriff in lokale Firewall-Regeln, Dienste oder Systempfade.',
      'Keine unkontrollierte Speicherung sensibler Skripte auf fremden Netzfreigaben ohne Nutzeraktion.',
    ],
    operatorResponsibilities: [
      'Unternehmens-Browser gemäß BSI APP.1.2 aktuell halten und Härtungsrichtlinien (GPO/Intune) beibehalten.',
      'Freigegebene Datei auf schreibgeschütztem Sharepoint-/Netzlaufwerk mit dokumentiertem SHA-256-Wert bereitstellen.',
      'Sensible exportierte Callflow-Dossiers gemäß interner Schutzbedarfsklassifizierung (Vertraulich/Intern) ablegen.',
    ],
    verificationTitle: 'BSI-GRUNDSCHUTZ-PRÜFCHECK (ENDPOINT)',
    verificationHint: 'Windows Endpoint / AppLocker',
    verificationSteps: `# 1. Prüfen, dass keinerlei .exe/.dll/.msi oder Windows-Dienste installiert werden
# 2. Hash für AppLocker / Software-Freigabe-Whitelist dokumentieren:
Get-FileHash .\\MermaidFree2UseOpen_Offline.html -Algorithm SHA256

# 3. Verifizieren, dass keine externen URIs in Skript-Tags enthalten sind:
Select-String -Path .\\MermaidFree2UseOpen_Offline.html -Pattern "<script[^>]+src=https?://"`,
    approvalCopyText: `BSI IT-Grundschutz-Kurzstellungnahme (APP.1.1 / APP.1.2 / CON.1 / OPS.1.1.3) – Version ${AUDIT_APP_VERSION}:
• Ausführungskontext (APP.1.1): Reine Browser-HTML-Anwendung ohne Installer, ohne .exe/.msi, ohne Admin-Rechte und ohne OS-Registry-Änderungen.
• Browser-Sicherheit (APP.1.2): Keine Drittserver-Skripte, keine Webfonts, keine Plug-ins; Mermaid läuft im Modus securityLevel="strict".
• Kryptografie & Integrität (CON.1): Kein Netzwerktransport (0 Byte); Einzeldatei über SHA-256-Prüfsumme revisionssicher freigebbar.
• Änderungsmanagement (OPS.1.1.3): Keine automatischen Hintergrund-Updates; explizite Ablösung über freigegebene Versionsdateien.`,
    legalClassification:
      'Einordnung: Diese technische Zuordnung unterstützt das hausinterne BSI-Grundschutz-Modellierungsverfahren als Baustein-Nachweis für ein lokal betriebenes Browser-Werkzeug.',
  },
];

export const ENTERPRISE_STAKEHOLDER_FACTS: EnterpriseStakeholderFact[] = [
  {
    id: 'sec-dlp',
    stakeholder: 'IT-Security / ISMS',
    factTitle: '0 Byte Datenabfluss (DLP)',
    evidence: 'Routing-Skripte, Rufnummern und Skillsets verlassen niemals das Endgerät; sämtliche FileReader- und Parser-Logik läuft im lokalen Browser-RAM.',
    reference: 'ISO 27001 A.8.12 / NIS2 Art. 21',
  },
  {
    id: 'sec-ports',
    stakeholder: 'IT-Security / ISMS',
    factTitle: 'Keine Ports & keine Nachladungen',
    evidence: 'Statische HTML-Einzeldatei ohne lokalen Webserver, ohne TCP-Port, ohne Hintergrunddienste und ohne externe CDN-/Script-Tags.',
    reference: 'ISO 27001 A.5.21 & A.8.20',
  },
  {
    id: 'dsb-avv',
    stakeholder: 'Datenschutz (DSB)',
    factTitle: 'Kein AVV & kein Drittlandtransfer',
    evidence: 'Kein Hersteller-Backend, kein SaaS-Host, keine Cookies und kein Tracking – sämtliche Verarbeitung bleibt zu 100 % beim Verantwortlichen.',
    reference: 'DSGVO Art. 28 & Art. 44 ff.',
  },
  {
    id: 'dsb-min',
    stakeholder: 'Datenschutz (DSB)',
    factTitle: 'Keine Vorbefüllung & löschbarer Cache',
    evidence: 'Keine vorbefüllten Kundendaten oder Rufnummern; lokaler Browser-Speicher ist jederzeit über einen Klick vollständig leerbar.',
    reference: 'DSGVO Art. 5 & Art. 25',
  },
  {
    id: 'br-telemetry',
    stakeholder: 'Betriebsrat',
    factTitle: 'Keine Verhaltens- oder Leistungskontrolle',
    evidence: 'Kein Login, keine User-ID, keine Telemetrie und keinerlei Nutzungs- oder Aktivitätsprotokolle an Server oder Vorgesetzte.',
    reference: '§ 87 Abs. 1 Nr. 6 BetrVG',
  },
  {
    id: 'br-offline',
    stakeholder: 'Betriebsrat',
    factTitle: 'Deterministischer Offline-Arbeitsplatz',
    evidence: 'Vollständiger Funktionsumfang unter file:// inkl. Sprungserver-Betrieb, klarer Textbeschriftung und lokaler Reset-Funktion.',
    reference: 'Ergonomie & Transparenz',
  },
  {
    id: 'ops-install',
    stakeholder: 'IT-Betrieb / Paketierung',
    factTitle: 'Zero-Install ohne Admin-Rechte',
    evidence: 'Kein .msi/.exe-Installer, keine Registry-Eingriffe und keine Browser-Erweiterungen; Start direkt per Doppelklick im Standard-Browser.',
    reference: 'BSI APP.1.1 / OPS.1.1.3',
  },
  {
    id: 'ops-hash',
    stakeholder: 'IT-Betrieb / Paketierung',
    factTitle: 'Eindeutiger SHA-256-Fingerprint',
    evidence: 'Die geschlossene Einzeldatei-Architektur ermöglicht unmittelbare Hash-Inventarisierung für AppLocker und Software-Freigaben.',
    reference: 'ISO 27001 A.8.9 / AppLocker',
  },
];

export const CODE_INSPECT_AUDIT_PROOFS: CodeInspectAuditItem[] = [
  {
    id: 'file-ram-ingress',
    numberLabel: '01',
    title: 'Lokale Dateieinlesung & Zeichenkodierung rein im Browser-RAM',
    category: 'Ingress · Kein Upload · Kein Shell-Zugriff',
    relevanceForCompany:
      'Kundenskripte (.s), DNIS-Listen und Öffnungszeiten dürfen den Firmenrechner nicht verlassen und keine lokalen Systemkommandos ausführen.',
    technicalExplanation:
      'Jede vom Benutzer manuell ausgewählte Datei wird direkt über Browser-eigene File.arrayBuffer()-Schnittstellen in einen flüchtigen Uint8Array-Puffer im RAM geladen. Die Erkennung von UTF-16, UTF-8 und Windows-1252 erfolgt komplett lokal ohne Server-POST, ohne Form-Upload und ohne OS-Prozesse.',
    excludedRisk:
      'Kein Netzwerk-Upload von Rufnummern/Skillsets, keine temporären Dateien im Windows-Temp-Ordner, kein Pfad-Zugriff auf fremde Festplattenbereiche.',
    moduleHint: 'src/utils/callflowFileImporter.ts · readScriptFileText()',
    codeTitle: 'CODE INSPECT: IN-MEMORY ARRAYBUFFER DECODER (0 NETZWERK)',
    auditFacts: [
      { label: 'Transport', value: '0 HTTP/Fetch Requests' },
      { label: 'Speicherort', value: 'Flüchtiges Uint8Array im RAM' },
      { label: 'Kodierungen', value: 'UTF-16 · UTF-8 · Windows-1252' },
    ],
    codeExcerpt: `export async function readScriptFileText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return '';

  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}`,
  },
  {
    id: 'visio-bfs-folder',
    numberLabel: '02',
    title: 'Visio (.vsdx) In-Memory Entpackung & selektiver Ordner-Resolver',
    category: 'Parser · Keine Verzeichnis-Spionage · Least Data',
    relevanceForCompany:
      'In Unternehmen liegen oft Hunderte Alt-Skripte im selben Ordner. Ein Tool darf keine fremden Dokumente indizieren oder nach außen senden.',
    technicalExplanation:
      'Visio-Archive (.vsdx) werden im RAM durch JSZip direkt aus dem ArrayBuffer geöffnet, um XML-Shapes/Connects auszulesen. Bei Ordner-Importen arbeitet der Breitensuche-Resolver (BFS) ausschließlich ausgehend vom Main-Skript entlang realer CALL-/EXECUTE-Verweise — nicht referenzierte Altdateien bleiben unberührt.',
    excludedRisk:
      'Kein stiller Vollscan fremder Firmenverzeichnisse außerhalb expliziter Freigabe; alle nicht verknüpften Dateien werden ignoriert und im Importbericht ausgewiesen.',
    moduleHint: 'src/utils/callflowFileImporter.ts · autoResolveConnectedScriptsFromFolder()',
    codeTitle: 'CODE INSPECT: SELEKTIVER BFS-RESOLVER ENTLANG AKTIVER SPRÜNGE',
    auditFacts: [
      { label: 'Visio-Engine', value: 'JSZip In-Memory XML DOMParser' },
      { label: 'Ordner-Strategie', value: 'Nur aktiv verlinkte Folgeskripte' },
      { label: 'Datensparsamkeit', value: 'Altlasten bleiben ausgeklammert' },
    ],
    codeExcerpt: `// Lädt ausgehend vom Main-Skript nur aktiv referenzierte Ziele:
while (queue.length > 0) {
  const targetRef = queue.shift()!;
  const entry = folderPool.byCanonicalKey.get(canonicalScriptMatchKey(targetRef));
  if (entry && !loadedKeys.has(entry.canonicalKey)) {
    loadedKeys.add(entry.canonicalKey);
    const parsed = await importCallflowFile(entry.file);
    mergedModules.push(...parsed.modules);
  }
}`,
  },
  {
    id: 'gpo-storage-cascade',
    numberLabel: '03',
    title: 'GPO-resiliente Speicher-Kaskade & Schutz vor Cache-Überschreibung',
    category: 'Persistenz · Endpoint-GPO-kompatibel · Keine Cloud',
    relevanceForCompany:
      'In gehärteten Konzern-Browsern ist localStorage unter file:// teilweise per Gruppenrichtlinie gesperrt. Außerdem darf eine neue Vorlage keinen lokalen Arbeitsstand löschen.',
    technicalExplanation:
      'Jeder Speicherzugriff ist in einen sicheren try/catch-Adapter gekapselt. Blockiert eine Windows-GPO den Browser-Speicher unter file://, schaltet die Anwendung nahtlos auf einen flüchtigen RAM-Speicher (Map) um. Beim Laden eingebetteter Seeds verhindert eine Seed-ID- und Inhaltsprüfung, dass leere Starter-Dateien lokale Projekte überschreiben.',
    excludedRisk:
      'Kein Absturz bei strikten Konzern-Browser-GPOs, keine Cloud-Synchronisation, kein ungewollter Datenverlust beim Öffnen einer leeren Offline-Kopie.',
    moduleHint: 'src/utils/offlineAppExporter.ts · readStudioStorage() & hydrateOfflineWorkspaceSeed()',
    codeTitle: 'CODE INSPECT: GPO-FALLBACK & SEED-ÜBERSCHREIBUNGSSCHUTZ',
    auditFacts: [
      { label: 'GPO-Verhalten', value: 'Automatischer In-Memory-Adapter' },
      { label: 'Cloud-Sync', value: 'Deaktiviert (0 Byte Transfer)' },
      { label: 'Seed-Schutz', value: 'Leere Seeds überschreiben nichts' },
    ],
    codeExcerpt: `export function readStudioStorage(key: string): string | null {
  try {
    const val = window.localStorage.getItem(key);
    if (val !== null) return val;
  } catch { /* Fallback bei GPO-Sperre unter file:// */ }
  return memoryStorageFallback.get(key) ?? null;
}

// Leere Vorlagen überschreiben keinen vorhandenen Arbeitsstand:
if (incomingHasData || !existingCache.hasProjectData) {
  writeStudioStorage(STUDIO_STORAGE_KEYS.SCRIPT_WORKSPACE, JSON.stringify(seed.scriptWorkspace));
}`,
  },
  {
    id: 'mermaid-strict-sandbox',
    numberLabel: '04',
    title: 'Mermaid Strict Sandbox & automatischer Großgraphen-Vektormodus',
    category: 'XSS-Schutz · Rendering-Sicherheit · Performance',
    relevanceForCompany:
      'Eingelesene Kundenskripte können beliebige Ansagetexte oder Kommentare enthalten. Es darf niemals vorkommen, dass Textinhalte als HTML/JavaScript im Browser ausgeführt werden.',
    technicalExplanation:
      'Die Diagramm-Engine wird strikt mit securityLevel: "strict" initialisiert, wodurch Klick-Skripte und aktive HTML-Elemente auf Parser-Ebene neutralisiert werden. Überschreitet ein Callflow 25 Knoten oder 40 Kanten, schaltet shouldUseNativeSvgLabels() automatisch von HTML-foreignObject auf reine SVG-<text>-Vektorknoten um.',
    excludedRisk:
      'Keine Script-Ausführung über manipulierte Knoten-Bezeichner in .s-Dateien, kein HTML-Injection-Risiko bei Fremdskripten, kein Browser-Freeze bei Großprojekten.',
    moduleHint: 'src/utils/mermaidEngine.ts · shouldUseNativeSvgLabels() & initialize()',
    codeTitle: 'CODE INSPECT: STRICT SANDBOX & NATIVER SVG-SCHWELLWERT',
    auditFacts: [
      { label: 'Sandbox-Modus', value: 'securityLevel: "strict"' },
      { label: 'SVG-Vektorswitch', value: 'Ab >= 25 Knoten / 40 Kanten' },
      { label: 'DOM-Hygiene', value: 'Keine aktiven foreignObject-Skripte' },
    ],
    codeExcerpt: `mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  maxTextSize: 500000,
  flowchart: {
    htmlLabels: !useNativeSvgLabels,
    curve: 'basis',
  },
});`,
  },
  {
    id: 'xss-seed-dom-quine',
    numberLabel: '05',
    title: 'XSS-sichere Seed-Maskierung & serverloser Offline-Export (DOM-Quine)',
    category: 'Egress · Script-Breakout-Schutz · Reproduzierbarkeit',
    relevanceForCompany:
      'Beim Export als Projekt-Kopie oder Read-Only Callflow.html werden Skriptdaten direkt in eine neue HTML-Datei eingebettet — hier müssen Script-Tag-Ausbrüche technisch unmöglich sein.',
    technicalExplanation:
      'Die Serialisierungsfunktion escaped sämtliche spitzen Klammern (<, >), Kaufmanns-Und (&) sowie Unicode-Zeilentrenner (U+2028, U+2029) als Unicode-Sequenzen. Selbst wenn ein Avaya-Skript die Zeichenfolge "</script>" im Text enthält, bleibt das generierte HTML syntaktisch sicher. Im file://-Betrieb liest reconstructHtmlFromActiveOfflineDocument() CSS & JS lokal aus dem DOM aus.',
    excludedRisk:
      'Kein HTML-/Script-Breakout im exportierten Viewer, kein Server-Fetch nötig beim Speichern neuer Projekt-Snapshots aus der Offline-App heraus.',
    moduleHint: 'src/utils/offlineAppExporter.ts · escapeJsonForInlineScript()',
    codeTitle: 'CODE INSPECT: UNICODE-ESCAPING & OFFLINE-DOM-REKONSTRUKTION',
    auditFacts: [
      { label: 'Script-Schutz', value: '<, >, &, U+2028/U+2029 escaped' },
      { label: 'Export-Weg', value: 'Reiner lokaler Blob-Download' },
      { label: 'Server-Bedarf', value: '0 Server-Calls (DOM-Quine)' },
    ],
    codeExcerpt: `function escapeJsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\\\u003C')
    .replace(/>/g, '\\\\u003E')
    .replace(/&/g, '\\\\u0026')
    .replace(/\\u2028/g, '\\\\u2028')
    .replace(/\\u2029/g, '\\\\u2029');
}`,
  },
  {
    id: 'single-iife-bundling',
    numberLabel: '06',
    title: 'Geschlossenes Single-IIFE-Bundling & verifizierte 0-Byte-Autarkie',
    category: 'Supply-Chain · Build-Integrität · Air-Gap',
    relevanceForCompany:
      'Für IT-Security und KRITIS-Umgebungen ist entscheidend, dass nach Freigabe der HTML-Datei keinerlei fremde Bibliotheken oder Fonts nachgeladen werden.',
    technicalExplanation:
      'Beim Erstellen des Offline-Artefakts unterbindet die Build-Pipeline dynamisches Code-Splitting (codeSplitting: false, cssCodeSplit: false) und fasst alles im geschlossenen IIFE-Format in einen einzigen Inline-<script>-Block zusammen. Alle externen Module- und Stylesheet-Links werden aus dem HTML-Grundgerüst entfernt.',
    excludedRisk:
      'Kein Laufzeit-Zugriff auf unpkg, jsDelivr, Google Fonts oder KI-/Cloud-APIs; Hash-Wert der Einzeldatei bleibt im Betrieb unveränderlich.',
    moduleHint: 'scripts/buildOfflineApp.mjs · generateSingleFileOfflineHtml()',
    codeTitle: 'CODE INSPECT: SINGLE-FILE IIFE BUILD OHNE EXTERNE CHUNKS',
    auditFacts: [
      { label: 'Output-Format', value: '1 geschlossenes IIFE-Skript' },
      { label: 'Externe Links', value: 'Vollständig gestrippt im HTML' },
      { label: 'Integrität', value: 'Statisch per SHA-256 hashbar' },
    ],
    codeExcerpt: `build: {
  cssCodeSplit: false,
  assetsInlineLimit: 100_000_000,
  rollupOptions: {
    output: { format: 'iife', codeSplitting: false }
  }
}
// Entfernt alle externen <link>/<script type="module">-Referenzen im Build-Output`,
  },
  {
    id: 'in-memory-callflow-graph-audit',
    numberLabel: '07',
    title: '100 % In-Memory Callflow-Graph-Audit ohne Disk-I/O & ohne Roh-Skript-Dump',
    category: 'Datensparsamkeit · Zero-FS · Struktur-Audit',
    relevanceForCompany:
      'Für Audits produktiver Avaya-Bestände (~350 Skripte inkl. FlixCheck & Oracle) dürfen weder Dateisystem-Schreibzugriffe noch rohe Skript-Inhalte, Durchwahlen oder Kundenkommentare im exportierten JSON-Bericht landen.',
    technicalExplanation:
      'Das Modul src/utils/auditCallflows.ts arbeitet vollständig seiteneffektfrei im Arbeitsspeicher (ohne node:fs, ohne node:path, ohne Netzwerk-Calls). Es prüft Broken Links, verwaiste Skripte, Sackgassen (inkl. Skillset-Queue-Hinweis), DFS-Schleifen sowie das FlixCheck-/Oracle-Inventar und exportiert JSON-Bericht und Mermaid-Architekturübersicht ausschließlich als lokale RAM-Blobs mit reinen Struktur-Metadaten.',
    excludedRisk:
      'Kein unkontrolliertes Schreiben auf Netzlaufwerke, kein Abfluss von Kundendaten oder Skript-Kommentaren in Audit-Reports, volle Kompatibilität mit der 0-Byte-Offline-HTML-Datei.',
    moduleHint: 'src/utils/auditCallflows.ts · runCallflowAudit() & generateArchitectureMermaid()',
    codeTitle: 'CODE INSPECT: REIN METADATEN-BASIERTER IN-MEMORY-AUDIT-REPORT',
    auditFacts: [
      { label: 'Dateisystem (fs)', value: '0 Importe · 0 Schreibzugriffe' },
      { label: 'Export-Inhalt', value: 'Nur Dateinamen, Befehle & Zeilen' },
      { label: 'PII / Roh-Skripte', value: 'Technisch ausgeschlossen' },
    ],
    codeExcerpt: `export function runCallflowAudit(input: ScriptWorkspace | ScriptModule[]): AuditReport {
  // Reine RAM-Auswertung ohne fs/fetch; speichert niemals rawText oder rawLine:
  return {
    schemaVersion: '1.4.5',
    privacyMode: '100%-in-memory-metadata-only',
    summary, nodes, brokenLinks, orphanScripts, deadEndScripts, circularLoops, externalIntegrations,
  };
}`,
  },
];

export const SBOM_PACKAGES: SbomPackageItem[] = [
  {
    name: 'react',
    versionSpec: '^19.0.1',
    license: 'MIT',
    scope: 'runtime-offline',
    scopeLabel: 'Laufzeit (Offline-Bundle)',
    purpose: 'Komponenten-UI & Zustandsverwaltung des Callflow-Studios und Builders',
    networkBehavior: '0 Requests (komplett geinlined)',
    corporateNote: 'Freizügige MIT-Lizenz ohne Copyleft-Verpflichtung.',
  },
  {
    name: 'react-dom',
    versionSpec: '^19.0.1',
    license: 'MIT',
    scope: 'runtime-offline',
    scopeLabel: 'Laufzeit (Offline-Bundle)',
    purpose: 'Lokales DOM-Rendering aller Studio-, Callflow- und Audit-Ansichten',
    networkBehavior: '0 Requests (komplett geinlined)',
    corporateNote: 'Standard-Web-Renderer unter MIT-Lizenz.',
  },
  {
    name: 'mermaid',
    versionSpec: '^12.3.0',
    license: 'MIT',
    scope: 'runtime-offline',
    scopeLabel: 'Laufzeit (Offline-Bundle)',
    purpose: 'Flowchart-Parser & lokales Vektor-SVG-Rendering mit securityLevel="strict"',
    networkBehavior: '0 Requests (komplett geinlined)',
    corporateNote: 'Vollständig ohne mermaid.live-Server lokal eingebettet.',
  },
  {
    name: '@mermaid-js/layout-elk',
    versionSpec: '^1.0.2',
    license: 'MIT',
    scope: 'runtime-offline',
    scopeLabel: 'Laufzeit (Offline-Bundle)',
    purpose: 'Mermaid-Adapter für den Eclipse Layout Kernel (ELK) bei komplexen Callflows',
    networkBehavior: '0 Requests (komplett geinlined)',
    corporateNote: 'Freizügige MIT-Lizenz, vollständig im Offline-Bundle enthalten.',
  },
  {
    name: 'elkjs',
    versionSpec: '^0.12.1',
    license: 'EPL-2.0',
    scope: 'runtime-offline',
    scopeLabel: 'Laufzeit (Offline-Bundle)',
    purpose: 'Deterministische orthogonale Graph-Layout-Engine für kreuzungsarme Groß-Callflows',
    networkBehavior: '0 Requests (reine RAM-Berechnung im Browser)',
    corporateNote: 'Unverändert unter Eclipse Public License 2.0 eingebunden; interne Firmennutzung unkritisch.',
  },
  {
    name: 'jszip',
    versionSpec: '^3.10.2',
    license: 'MIT / GPLv3 (MIT genutzt)',
    scope: 'runtime-offline',
    scopeLabel: 'Laufzeit (Offline-Bundle)',
    purpose: 'In-Memory-Entpackung von Microsoft Visio (.vsdx) XML-Archiven im RAM',
    networkBehavior: '0 Requests (rein ArrayBuffer-basiert)',
    corporateNote: 'Dual-lizenziert (MIT oder GPLv3) – Nutzung erfolgt unter MIT.',
  },
  {
    name: 'lucide-react',
    versionSpec: '^0.546.0',
    license: 'ISC',
    scope: 'runtime-offline',
    scopeLabel: 'Laufzeit (Offline-Bundle)',
    purpose: 'Statische Inline-SVG-Funktionsicons ohne externe Icon-Fonts',
    networkBehavior: '0 Requests (SVG-Pfade im Bundle)',
    corporateNote: 'Freizügige ISC-Lizenz (äquivalent zu MIT/BSD).',
  },
  {
    name: 'motion',
    versionSpec: '^12.23.24',
    license: 'MIT',
    scope: 'runtime-offline',
    scopeLabel: 'Laufzeit (Offline-Bundle)',
    purpose: 'UI-Übergänge ohne externe Animations-Assets',
    networkBehavior: '0 Requests (komplett geinlined)',
    corporateNote: 'MIT-Lizenz, keine externen Assets.',
  },
  {
    name: 'vite',
    versionSpec: '^8.3.0',
    license: 'MIT',
    scope: 'build-only',
    scopeLabel: 'Nur Build-Zeit',
    purpose: 'Bundler zur Erzeugung der geschlossenen Single-File-HTML (nicht zur Laufzeit nötig)',
    networkBehavior: 'Nicht im Endartefakt als Tool aktiv',
    corporateNote: 'Reines Compile-Werkzeug; wird nicht in die Offline-HTML ausgeliefert.',
  },
  {
    name: '@tailwindcss/vite & tailwindcss',
    versionSpec: '^4.3.3',
    license: 'MIT',
    scope: 'build-only',
    scopeLabel: 'Nur Build-Zeit',
    purpose: 'Statische CSS-Kompilierung; Ergebnis wird direkt als <style> in HTML eingebettet',
    networkBehavior: '0 Runtime-CSS-Fetches',
    corporateNote: 'Keine Laufzeit-CDN-Stylesheets.',
  },
  {
    name: '@vitejs/plugin-react',
    versionSpec: '^6.1.1',
    license: 'MIT',
    scope: 'build-only',
    scopeLabel: 'Nur Build-Zeit',
    purpose: 'JSX/TSX-Transpilierung während des Builds',
    networkBehavior: 'Nur Build-Zeit',
    corporateNote: 'Nicht im ausgelieferten HTML-Endartefakt.',
  },
  {
    name: 'typescript',
    versionSpec: '^7.0.2',
    license: 'Apache-2.0',
    scope: 'build-only',
    scopeLabel: 'Nur Build-Zeit',
    purpose: 'Statische Typprüfung aller Parser- und Export-Module',
    networkBehavior: 'Nur Build-Zeit',
    corporateNote: 'Reiner Build-Time-Typechecker unter Apache-2.0.',
  },
  {
    name: 'rolldown / oxc (Vite 8)',
    versionSpec: 'integriert in vite ^8.3.0',
    license: 'MIT',
    scope: 'build-only',
    scopeLabel: 'Nur Build-Zeit',
    purpose: 'Minimierung & IIFE-Bundling für das portierbare Offline-Paket',
    networkBehavior: 'Nur Build-Zeit',
    corporateNote: 'Reines Compile-Werkzeug unter MIT.',
  },
  {
    name: 'vitest',
    versionSpec: '^5.1.2',
    license: 'MIT',
    scope: 'build-only',
    scopeLabel: 'Nur Build- / Test-Zeit',
    purpose: 'Automatisierte Unit-Tests für Avaya-OCL-/Visio-Parser und In-Memory-Graph-Audit',
    networkBehavior: '0 Bytes im Offline-HTML-Bundle (nur lokale QS)',
    corporateNote: 'Reines Test-Werkzeug (devDependency) unter MIT-Lizenz; nicht im Endartefakt.',
  },
  {
    name: 'tsx',
    versionSpec: '^4.21.0',
    license: 'MIT',
    scope: 'build-only',
    scopeLabel: 'Nur Build- / Test-Zeit',
    purpose: 'Lokale Ausführung der synthetischen Regressions- und Rauchtest-Suite',
    networkBehavior: '0 Bytes im Offline-HTML-Bundle (nur lokale QS)',
    corporateNote: 'Reines Entwickler-Testwerkzeug (devDependency) unter MIT; nicht im Endartefakt.',
  },
  {
    name: 'express / dotenv / @google/genai',
    versionSpec: 'Umgebungs-Template',
    license: 'MIT / BSD-2-Clause / Apache-2.0',
    scope: 'excluded-from-bundle',
    scopeLabel: 'Nicht im Offline-Bundle',
    purpose: 'Ausgeschlossene Template-Pakete – im Offline-Studio 0 Byte Code und 0 API-Calls',
    networkBehavior: 'Nicht im Offline-Bundle enthalten',
    corporateNote: 'Tree-Shaking entfernt ungenutzte Template-Pakete vollständig aus der Einzeldatei.',
  },
];

export interface LegalNoticeCardItem {
  id: string;
  title: string;
  body: string;
  detail: string;
}

export const LEGAL_AVAYA_CARDS: LegalNoticeCardItem[] = [
  {
    id: 'trademark-independence',
    title: '1. Markenrecht & Hersteller-Unabhängigkeit (Avaya / Microsoft Visio)',
    body: 'MermaidFree2UseOpen ist ein unabhängiges internes Projektwerkzeug. Es besteht keinerlei Verbindung, Partnerschaft, Sponsoring, Zertifizierung oder offizielle Unterstützung durch Avaya Inc., Microsoft Corporation oder sonstige Telekommunikations- oder Software-Rechteinhaber.',
    detail:
      'Sämtliche Produkt- und Dateiformat-Nennungen wie „Avaya“, „Avaya Aura Contact Center (AACC)“ oder „Microsoft Visio“ (.s / .vsdx) erfolgen ausschließlich rein deskriptiv zur technischen Beschreibung der unterstützten Dateikompatibilität (§ 23 MarkenG). Alle Marken verbleiben Eigentum ihrer jeweiligen Inhaber.',
  },
  {
    id: 'zero-proprietary-code',
    title: '2. Keine Hersteller-Quelltexte & keine vorbefüllten Kundendaten',
    body: 'Die ausgelieferte Anwendung enthält keinerlei proprietäre Programmteile, geschützte Konfigurationsbibliotheken oder Muster-Skripte von Avaya, Microsoft oder anderen Herstellern sowie keine vorbefüllten Kundendaten, Rufnummern oder Namen.',
    detail:
      'Eingelesene kundenspezifische .s-Skripte, DNIS-/Rufnummernpläne und Öffnungszeiten verbleiben im flüchtigen Browser-RAM bzw. lokal auf dem Endgerät des Betreibers und unterliegen den jeweiligen Projekt-NDAs und internen Ablagerichtlinien.',
  },
  {
    id: 'oss-and-audit-scope',
    title: '3. Open-Source-Basis & rechtliche Einordnung',
    body: 'Alle eingebundenen Bibliotheken (u. a. React, Mermaid, Eclipse ELK, JSZip, Lucide, Motion) stehen unter ihren jeweiligen Open-Source-Lizenzen (MIT / EPL-2.0 / ISC) und arbeiten vollständig lokal mit 0 Byte Netzwerkverkehr.',
    detail:
      'Hinweis: Die bereitgestellten Compliance-, Marken- und Audit-Hinweise dienen der internen technischen Freigabe-Dokumentation (IT-Security, Datenschutz, Betriebsrat, Einkauf) und ersetzen keine individuelle Rechtsberatung im Einzelfall.',
  },
];

export const LEGAL_AVAYA_COPY_TEXT = [
  `Marken-, Unabhängigkeits- & Nutzungshinweis (MermaidFree2UseOpen Version ${AUDIT_APP_VERSION}):`,
  '• Unabhängiges Werkzeug: Eigenständiges internes Projektwerkzeug für reine Offline-Nutzung (file://). Keine Verbindung, Partnerschaft, Zertifizierung oder Unterstützung durch Avaya Inc., Microsoft Corporation oder sonstige Rechteinhaber.',
  '• Deskriptive Markennennung (§ 23 MarkenG): Nennungen wie „Avaya“, „Avaya Aura Contact Center (AACC)“ oder „Microsoft Visio“ dienen ausschließlich der technischen Beschreibung der Dateikompatibilität (.s-Skripte und .vsdx-Dateien).',
  '• Keine Fremddaten / Kein Hersteller-Code: Enthält keinerlei proprietäre Hersteller-Quelltexte und keine vorbefüllten Kundendaten; Kundenskripte werden ausschließlich lokal im RAM verarbeitet (0 Byte Traffic).',
  '• Open-Source-Basis: Eingebundene Pakete stehen unter ihren jeweiligen Open-Source-Lizenzen (MIT / EPL-2.0 / ISC / Apache-2.0).',
].join('\n');

export function buildFullAuditMarkdownReport(): string {
  const lines: string[] = [];

  lines.push(
    `# IT-Audit & Konzern-Freigabedossier – MermaidFree2UseOpen (Version ${AUDIT_APP_VERSION})`
  );
  lines.push('');
  lines.push(`- **Erstellungszeitpunkt:** ${new Date().toLocaleString('de-DE')}`);
  lines.push(
    `- **Betriebsart:** Lokale Offline-Einzeldatei (\`file://\`), reine Browser-RAM-Verarbeitung`
  );
  lines.push(
    `- **Netzwerkmodell:** 0 Byte externer Traffic im Produktivbetrieb (Air-Gap-fähig)`
  );
  lines.push('');

  lines.push('## 1. Unternehmens-Eckdaten');
  ENTERPRISE_HIGHLIGHT_TILES.forEach((tile) => {
    lines.push(`- **${tile.label}:** ${tile.value} (${tile.sublabel})`);
  });
  lines.push('');

  lines.push('## 2. Vollständige Compliance-Prüfmatrizen (Alle 4 Normen)');
  lines.push('');
  AUDIT_COMPLIANCE_STANDARDS.forEach((std) => {
    lines.push(`### ${std.indexLabel}. ${std.label} – ${std.statusLabel}`);
    lines.push(`**Referenzen:** ${std.subtitle}`);
    lines.push('');
    lines.push(std.summary);
    lines.push('');
    std.controlMatrix.forEach((row) => {
      lines.push(
        `- **${row.reference} (${row.verdict})** – *${row.auditQuestion}*: ${row.technicalProof}`
      );
    });
    lines.push('');
    lines.push('**Technisch ausgeschlossene Risiken:**');
    std.excludedRisks.forEach((r) => lines.push(`- ${r}`));
    lines.push('');
    lines.push('**Organisatorische Betreiberpflichten:**');
    std.operatorResponsibilities.forEach((o) => lines.push(`- ${o}`));
    lines.push('');
    lines.push(`> ${std.legalClassification}`);
    lines.push('');
  });

  lines.push('## 3. Technische Fakten nach Fachbereichen');
  lines.push('');
  ENTERPRISE_STAKEHOLDER_FACTS.forEach((item) => {
    lines.push(
      `- **${item.stakeholder} — ${item.factTitle}** (${item.reference}): ${item.evidence}`
    );
  });
  lines.push('');

  lines.push('## 4. Technische Detail-Nachweise mit Code-Inspect');
  lines.push('');
  CODE_INSPECT_AUDIT_PROOFS.forEach((item) => {
    lines.push(`### ${item.numberLabel}. ${item.title}`);
    lines.push(`- **Bereich:** ${item.category} (${item.moduleHint})`);
    lines.push(`- **Firmen-Relevanz:** ${item.relevanceForCompany}`);
    lines.push(`- **Technische Umsetzung:** ${item.technicalExplanation}`);
    lines.push(`- **Ausgeschlossenes Risiko:** ${item.excludedRisk}`);
    lines.push('');
    lines.push('```ts');
    lines.push(item.codeExcerpt);
    lines.push('```');
    lines.push('');
  });

  lines.push('## 5. Vollständige Open-Source-Stückliste (SBOM)');
  lines.push('');
  lines.push('| Paket | Version | Lizenz (SPDX) | Umfang | Einsatzzweck | Netzwerkverhalten |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  SBOM_PACKAGES.forEach((pkg) => {
    lines.push(
      `| ${pkg.name} | ${pkg.versionSpec} | ${pkg.license} | ${pkg.scopeLabel} | ${pkg.purpose} | ${pkg.networkBehavior} |`
    );
  });
  lines.push('');

  lines.push('## 6. Marken-, Hersteller-Unabhängigkeits- & Datenschutz-Erklärung (Avaya / Visio)');
  lines.push('');
  LEGAL_AVAYA_CARDS.forEach((card) => {
    lines.push(`### ${card.title}`);
    lines.push(card.body);
    lines.push(card.detail);
    lines.push('');
  });

  lines.push('---');
  lines.push(
    'Erstellt lokal im Browser ohne Server-Übertragung · MermaidFree2UseOpen Offline-Audit.'
  );

  return lines.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildStandaloneAuditHtmlDossier(): string {
  const generatedAt = new Date().toLocaleString('de-DE');

  const highlightsHtml = ENTERPRISE_HIGHLIGHT_TILES.map(
    (t) => `
      <div class="kpi">
        <div class="kpi-label">${escapeHtml(t.label)}</div>
        <div class="kpi-val">${escapeHtml(t.value)}</div>
        <div class="kpi-sub">${escapeHtml(t.sublabel)}</div>
      </div>`
  ).join('');

  const normsHtml = AUDIT_COMPLIANCE_STANDARDS.map((std) => {
    const matrixRows = std.controlMatrix
      .map(
        (row) => `
        <tr>
          <td class="mono">${escapeHtml(row.reference)}</td>
          <td>${escapeHtml(row.auditQuestion)}</td>
          <td>${escapeHtml(row.technicalProof)}</td>
          <td class="verdict">${escapeHtml(row.verdict)}</td>
        </tr>`
      )
      .join('');
    const risks = std.excludedRisks.map((r) => `<li>${escapeHtml(r)}</li>`).join('');
    const duties = std.operatorResponsibilities.map((d) => `<li>${escapeHtml(d)}</li>`).join('');

    return `
      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="kicker">${escapeHtml(std.indexLabel)} · ${escapeHtml(std.subtitle)}</div>
            <h3>${escapeHtml(std.label)} — ${escapeHtml(std.deepDiveTitle)}</h3>
          </div>
          <span class="status-tag">${escapeHtml(std.statusLabel)}</span>
        </div>
        <p>${escapeHtml(std.summary)}</p>
        <table>
          <thead>
            <tr><th>Referenz</th><th>Prüffrage</th><th>Technischer Nachweis</th><th>Bewertung</th></tr>
          </thead>
          <tbody>${matrixRows}</tbody>
        </table>
        <div class="two-col">
          <div>
            <h4>Technisch ausgeschlossene Risiken</h4>
            <ul>${risks}</ul>
          </div>
          <div>
            <h4>Organisatorische Betreiberpflichten</h4>
            <ul>${duties}</ul>
          </div>
        </div>
        <p class="legal-note">${escapeHtml(std.legalClassification)}</p>
      </section>`;
  }).join('');

  const stakeholderFactsHtml = ENTERPRISE_STAKEHOLDER_FACTS.map(
    (item) => `
      <tr>
        <td><strong>${escapeHtml(item.stakeholder)}</strong></td>
        <td><strong>${escapeHtml(item.factTitle)}</strong></td>
        <td>${escapeHtml(item.evidence)}</td>
        <td class="mono">${escapeHtml(item.reference)}</td>
      </tr>`
  ).join('');

  const codeInspectHtml = CODE_INSPECT_AUDIT_PROOFS.map(
    (item) => `
      <section class="panel">
        <div class="panel-head">
          <div>
            <div class="kicker">${escapeHtml(item.numberLabel)} · ${escapeHtml(item.category)} · ${escapeHtml(item.moduleHint)}</div>
            <h3>${escapeHtml(item.title)}</h3>
          </div>
        </div>
        <div class="two-col">
          <div>
            <p><strong>Relevanz für Unternehmen:</strong> ${escapeHtml(item.relevanceForCompany)}</p>
            <p>${escapeHtml(item.technicalExplanation)}</p>
            <p><strong>Ausgeschlossenes Risiko:</strong> ${escapeHtml(item.excludedRisk)}</p>
          </div>
          <div>
            <pre>${escapeHtml(item.codeExcerpt)}</pre>
          </div>
        </div>
      </section>`
  ).join('');

  const sbomHtml = SBOM_PACKAGES.map(
    (pkg) => `
      <tr>
        <td class="mono">${escapeHtml(pkg.name)}</td>
        <td class="mono">${escapeHtml(pkg.versionSpec)}</td>
        <td class="mono">${escapeHtml(pkg.license)}</td>
        <td>${escapeHtml(pkg.scopeLabel)}</td>
        <td>${escapeHtml(pkg.purpose)}</td>
        <td>${escapeHtml(pkg.networkBehavior)}</td>
      </tr>`
  ).join('');

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>IT-Audit-Dossier — MermaidFree2UseOpen v${AUDIT_APP_VERSION}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #f8fafc; margin: 0; padding: 32px 20px; line-height: 1.5; font-size: 13px; }
    .container { max-width: 1120px; margin: 0 auto; }
    header { background: #0f172a; color: #f8fafc; padding: 24px 28px; border-radius: 10px; margin-bottom: 24px; }
    header h1 { margin: 0 0 6px; font-size: 20px; }
    header .meta { font-size: 12px; color: #94a3b8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .panel { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 20px 24px; margin-bottom: 20px; page-break-inside: avoid; }
    .panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 14px; }
    .kicker { font-size: 11px; font-family: ui-monospace, Menlo, monospace; color: #475569; margin-bottom: 4px; }
    h2 { font-size: 16px; margin: 24px 0 10px; color: #0f172a; }
    h3 { font-size: 14px; margin: 0; color: #0f172a; }
    h4 { font-size: 12px; margin: 12px 0 6px; color: #1e293b; }
    .status-tag { font-size: 11px; font-family: ui-monospace, Menlo, monospace; color: #047857; white-space: nowrap; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .kpi { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; background: #ffffff; }
    .kpi-label { font-size: 11px; color: #64748b; }
    .kpi-val { font-size: 13px; font-weight: 700; font-family: ui-monospace, Menlo, monospace; margin-top: 3px; color: #0f172a; }
    .kpi-sub { font-size: 11px; color: #475569; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 600; color: #334155; }
    .mono { font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
    .verdict { font-family: ui-monospace, Menlo, monospace; font-weight: 600; color: #047857; white-space: nowrap; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 10px; }
    pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 11px; margin: 0; font-family: ui-monospace, Menlo, monospace; }
    ul { margin: 6px 0 0; padding-left: 18px; }
    li { margin-bottom: 4px; }
    .legal-note { font-size: 11px; color: #475569; border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 12px; }
    @media print { body { background: #fff; padding: 0; } .panel { break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>IT-Audit &amp; Konzern-Freigabedossier — MermaidFree2UseOpen</h1>
      <div class="meta">Version ${AUDIT_APP_VERSION} · Erstellt am ${escapeHtml(generatedAt)} · 0 Byte Server-Übertragung</div>
    </header>

    <div class="kpi-grid">${highlightsHtml}</div>

    <h2>1. Vollständige Compliance-Prüfmatrizen (Alle 4 Normen)</h2>
    ${normsHtml}

    <section class="panel">
      <div class="panel-head">
        <div>
          <div class="kicker">Fachbereiche</div>
          <h3>2. Technische Fakten nach Gremien</h3>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>Fachbereich</th><th>Fakt</th><th>Technischer Nachweis</th><th>Referenz</th></tr>
        </thead>
        <tbody>${stakeholderFactsHtml}</tbody>
      </table>
    </section>

    <h2>3. Architektur- &amp; Sicherheitsnachweise mit Code-Inspect</h2>
    ${codeInspectHtml}

    <section class="panel">
      <div class="panel-head">
        <div>
          <div class="kicker">Software Bill of Materials</div>
          <h3>4. Vollständige Open-Source-Stückliste (SBOM)</h3>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>Paket</th><th>Version</th><th>Lizenz</th><th>Umfang</th><th>Einsatzzweck</th><th>Netzwerk</th></tr>
        </thead>
        <tbody>${sbomHtml}</tbody>
      </table>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <div class="kicker">Rechtliche Einordnung &amp; § 23 MarkenG</div>
          <h3>5. Marken-, Hersteller-Unabhängigkeits- &amp; Datenerklärung (Avaya / Visio)</h3>
        </div>
      </div>
      ${LEGAL_AVAYA_CARDS.map(
        (card) => `
        <div style="margin-bottom: 14px;">
          <h4>${escapeHtml(card.title)}</h4>
          <p style="margin: 4px 0;">${escapeHtml(card.body)}</p>
          <p class="legal-note" style="border-top: none; margin-top: 2px; padding-top: 0;">${escapeHtml(card.detail)}</p>
        </div>`
      ).join('')}
    </section>
  </div>
</body>
</html>`;
}

export function triggerAuditReportDownload(
  content: string,
  format: 'md' | 'html'
): void {
  const mime =
    format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8';
  const filename =
    format === 'html'
      ? `MermaidFree2UseOpen_IT_Audit_Dossier_${AUDIT_APP_VERSION}.html`
      : `MermaidFree2UseOpen_IT_Audit_${AUDIT_APP_VERSION}.md`;
  triggerLocalDownload(new Blob([content], { type: mime }), filename);
}
