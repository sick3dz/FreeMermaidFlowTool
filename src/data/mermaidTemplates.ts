import { CodeSnippet, DiagramTemplate, ThemeConfiguration } from '../types/mermaidStudio';

export const DEFAULT_THEME_CONFIG: ThemeConfiguration = {
  theme: 'dark',
  look: 'classic',
  layoutEngine: 'dagre',
  nodeSpacing: 60,
  rankSpacing: 75,
  curve: 'basis',
  fontFamily: 'Plus Jakarta Sans, sans-serif',
  fontSize: 14,
  useCustomColors: true,
  primaryColor: '#1e293b',
  primaryTextColor: '#f8fafc',
  primaryBorderColor: '#6366f1',
  lineColor: '#818cf8',
  secondaryColor: '#0f172a',
  tertiaryColor: '#1e1b4b',
  background: '#0b0f19',
  mainBkg: '#1e293b',
  nodeBorder: '#6366f1',
  clusterBkg: '#0f172a',
  clusterBorder: '#334155',
  titleColor: '#f8fafc',
  edgeLabelBackground: '#0f172a',
};

export const THEME_PRESETS: Array<{
  id: string;
  name: string;
  description: string;
  recommendedCanvas: 'dark' | 'light';
  config: Partial<ThemeConfiguration>;
}> = [
  {
    id: 'indigo-studio-dark',
    name: 'Studio Indigo (Dark)',
    description: 'Präzises dunkles Architektur-Theme mit Indigo-Konturen',
    recommendedCanvas: 'dark',
    config: {
      theme: 'base',
      useCustomColors: true,
      background: '#0b0f19',
      primaryColor: '#1e293b',
      primaryTextColor: '#f8fafc',
      primaryBorderColor: '#6366f1',
      lineColor: '#818cf8',
      secondaryColor: '#0f172a',
      tertiaryColor: '#1e1b4b',
      mainBkg: '#1e293b',
      nodeBorder: '#6366f1',
      clusterBkg: '#0f172a',
      clusterBorder: '#334155',
      titleColor: '#f8fafc',
      edgeLabelBackground: '#0f172a',
    },
  },
  {
    id: 'emerald-blueprint-dark',
    name: 'Smaragd-Technik (Dark)',
    description: 'Kontrastreiches System-Theme für Infrastruktur- und Netzwerkpläne',
    recommendedCanvas: 'dark',
    config: {
      theme: 'base',
      useCustomColors: true,
      background: '#0b0f19',
      primaryColor: '#064e3b',
      primaryTextColor: '#ecfdf5',
      primaryBorderColor: '#10b981',
      lineColor: '#34d399',
      secondaryColor: '#0f172a',
      tertiaryColor: '#022c22',
      mainBkg: '#064e3b',
      nodeBorder: '#10b981',
      clusterBkg: '#0b1320',
      clusterBorder: '#059669',
      titleColor: '#ecfdf5',
      edgeLabelBackground: '#0f172a',
    },
  },
  {
    id: 'clean-documentation-light',
    name: 'Dokumentation Klar (Light)',
    description: 'Optimiert für helle Berichte, PDF-Exporte und technische Spezifikationen',
    recommendedCanvas: 'light',
    config: {
      theme: 'base',
      useCustomColors: true,
      background: '#ffffff',
      primaryColor: '#eef2ff',
      primaryTextColor: '#0f172a',
      primaryBorderColor: '#4f46e5',
      lineColor: '#475569',
      secondaryColor: '#f8fafc',
      tertiaryColor: '#f1f5f9',
      mainBkg: '#eef2ff',
      nodeBorder: '#4f46e5',
      clusterBkg: '#f8fafc',
      clusterBorder: '#cbd5e1',
      titleColor: '#0f172a',
      edgeLabelBackground: '#ffffff',
    },
  },
  {
    id: 'monochrome-editorial-light',
    name: 'Monochrom Editorial (Light)',
    description: 'Minimalistisches Schwarz-Weiß-Layout für wissenschaftliche Publikationen',
    recommendedCanvas: 'light',
    config: {
      theme: 'neutral',
      useCustomColors: false,
    },
  },
  {
    id: 'mermaid-native-forest',
    name: 'Mermaid Forest',
    description: 'Klassisches grünes Mermaid-Standard-Farbschema',
    recommendedCanvas: 'light',
    config: {
      theme: 'forest',
      useCustomColors: false,
    },
  },
];

export const MERMAID_TEMPLATES: DiagramTemplate[] = [
  {
    id: 'callflow-multi-script',
    name: 'Skript-Callflow & Prozesskette (Interaktiv)',
    category: 'Ablauf & Prozess',
    badge: 'Callflow-Analyse',
    description: 'Mehrstufiger Skript-Callflow mit Einstiegspunkten, Verteilern, Datenbanken und Endpunkten — ideal zum Antippen einzelner Knoten.',
    supportsDirection: true,
    code: `flowchart LR
    %% Einstiegs-Skripte (Entry Points)
    CronTrigger(["cron_scheduler.sh"])
    WebhookAPI(["webhook_receiver.py"])
    CLIStart(["manual_sync_cli.py"])

    %% Validierung & Routing
    AuthCheck{"auth_guard.py"}
    Dispatcher["job_dispatcher.py"]
    PayloadValidator{"schema_validator.py"}

    %% Kern-Verarbeitungsskripte
    OrderProcessor["process_orders.py"]
    StockSync["sync_inventory.py"]
    InvoiceWorker[["generate_invoice_worker.py"]]
    RetryHandler[["retry_queue_handler.py"]]

    %% Zielsysteme & Endpunkte (Terminals)
    PostgresDB[("erp_orders_db")]
    AuditLog[("audit_archive_s3")]
    MailGateway(["send_confirmation_mail.py"])
    ErrorAlert["error_notifier_slack.py"]

    CronTrigger -->|Batch 02:00| Dispatcher
    WebhookAPI -->|POST /event| AuthCheck
    CLIStart -->|Force Run| Dispatcher

    AuthCheck -->|Token OK| PayloadValidator
    AuthCheck -.->|401 Invalid| ErrorAlert

    PayloadValidator -->|Valide| Dispatcher
    PayloadValidator -.->|Schema Fehler| ErrorAlert

    Dispatcher -->|Order Job| OrderProcessor
    Dispatcher -->|Stock Job| StockSync
    Dispatcher -.->|Async Event| InvoiceWorker

    OrderProcessor -->|Write TX| PostgresDB
    OrderProcessor -->|Trigger| InvoiceWorker
    OrderProcessor -.->|Timeout| RetryHandler

    StockSync -->|Update| PostgresDB
    StockSync -->|Write Audit| AuditLog

    InvoiceWorker -->|PDF versenden| MailGateway
    InvoiceWorker -->|Archivieren| AuditLog

    RetryHandler -->|Re-Queue| OrderProcessor
    RetryHandler -.->|Max Retries| ErrorAlert`,
  },
  {
    id: 'flowchart-v11-cloud',
    name: 'Cloud-Systemarchitektur (Flowchart v11)',
    category: 'Architektur & System',
    badge: 'Flowchart v11',
    description: 'Moderne verteilte Service-Architektur mit Subgraphs, typisierten Knoten und gestrichelten Event-Streams.',
    supportsDirection: true,
    code: `flowchart LR
    subgraph Client["Endgeräte & Edge"]
        Web["Web-Applikation (SPA)"]
        Mobile["Mobile App (iOS / Android)"]
        CDN[["Global Edge CDN"]]
    end

    subgraph Gateway["API & Security Layer"]
        WAF{{"Web Application Firewall"}}
        APIGW["API Gateway (GraphQL / REST)"]
        Auth(["OAuth 2.1 / OIDC Service"])
    end

    subgraph Core["Domänen-Microservices"]
        OrderSvc["Bestell-Service"]
        InventorySvc["Lagerbestand-Engine"]
        BillingSvc["Abrechnungs-Worker"]
    end

    subgraph Storage["Persistenz & Event-Streaming"]
        PG[("Cluster-Datenbank (PostgreSQL)")]
        Redis[("In-Memory Cache (Redis)")]
        Kafka[["Event-Bus (Apache Kafka)"]]
    end

    Web --> CDN --> WAF
    Mobile --> WAF
    WAF --> APIGW
    APIGW <-->|Token-Prüfung| Auth
    APIGW --> OrderSvc
    APIGW --> InventorySvc

    OrderSvc --> PG
    InventorySvc --> Redis
    OrderSvc -.->|OrderCreated Event| Kafka
    Kafka -.-> BillingSvc
    Kafka -.-> InventorySvc`,
  },
  {
    id: 'architecture-beta-v11',
    name: 'Infrastruktur-Topologie (Architecture v11)',
    category: 'Architektur & System',
    badge: 'Neu in v11',
    description: 'Offizielle Mermaid v11 architecture-beta Syntax für Cloud-Gruppen, Server, Datenbanken und Gateways.',
    supportsDirection: false,
    code: `architecture-beta
    group edge(cloud)[Public Edge Zone]
    group vpc(cloud)[Private Production VPC]
    group data(database)[Persistent Data Tier]

    service dns(internet)[Edge Router] in edge
    service lb(server)[Ingress Load Balancer] in edge

    service api(server)[Core API Cluster] in vpc
    service worker(server)[Async Job Worker] in vpc
    service queue(disk)[Message Queue] in vpc

    service primarydb(database)[Primary Relational DB] in data
    service archive(disk)[Object Storage Archive] in data

    dns:R --> L:lb
    lb:R --> L:api
    api:B --> T:queue
    queue:R --> L:worker
    api:R --> L:primarydb
    worker:R --> L:archive`,
  },
  {
    id: 'sequence-auth-flow',
    name: 'Zero-Trust Authentifizierungs-Sequenz',
    category: 'Software & Daten',
    badge: 'Sequenzdiagramm',
    description: 'Detaillierter Sequenzablauf mit Aktivierungsbalken, Alt/Else-Verzweigungen, Schleifen und Notizen.',
    supportsDirection: false,
    code: `sequenceDiagram
    autonumber
    actor User as Nutzer (Browser)
    participant App as Web-Client (PKCE)
    participant IdP as Identity Provider
    participant API as Resource Server
    participant DB as Audit-Speicher

    User->>App: Klickt auf "Sitzung starten"
    activate App
    App->>App: Generiert code_verifier & code_challenge (SHA-256)
    App->>IdP: GET /authorize (code_challenge)
    activate IdP
    IdP-->>User: Authentifizierungs-Dialog (MFA)
    User->>IdP: Bestätigt Hardware-Security-Key
    IdP-->>App: Redirect mit Authorization Code
    deactivate IdP

    App->>IdP: POST /token (code + code_verifier)
    activate IdP
    alt Verifier gültig
        IdP-->>App: 200 OK (JWT Access Token + Refresh Token)
    else Verifier ungültig oder abgelaufen
        IdP-->>App: 401 Unauthorized
        App-->>User: Fehlermeldung anzeigen
    end
    deactivate IdP

    App->>API: GET /api/v1/workspaces (Bearer JWT)
    activate API
    API->>DB: Protokolliere Zugriff (Audit-Log)
    API-->>App: 200 OK (Verschlüsselte Nutzdaten)
    deactivate API
    App-->>User: Rendert Dashboard-Ansicht
    deactivate App`,
  },
  {
    id: 'mindmap-product-strategy',
    name: 'Produkt- & System-Mindmap (v11)',
    category: 'Analyse & Struktur',
    badge: 'Mindmap',
    description: 'Hierarchische Wissens- und Architekturstrukturierung mit verschiedenen Knotenformen.',
    supportsDirection: false,
    code: `mindmap
  root((MermaidFree2Use))
    Lokale Engine
      Mermaid v11 ESM
      ELK Anti-Overlap
      Kein Cloud-Upload
      Offline-fähig
    Callflow-Inspektor
      Startpunkte finden
      Aufrufer & Ziele
      Pfad-Spotlight
      Einzel-HTML-Export
    Diagramm-Katalog
      Architektur & C4
      Sequenz & Klassen
      Mindmap & Kanban
      Gantt & Timeline
    Export-Pipeline
      Reines Vektor-SVG
      Ultra-HD 4x PNG
      Interaktive HTML`,
  },
  {
    id: 'er-diagram-commerce',
    name: 'Datenbank-Schema (Entity-Relationship)',
    category: 'Software & Daten',
    badge: 'ER-Diagramm',
    description: 'Relationales Datenmodell mit Primär-/Fremdschlüsseln, Datentypen und Krähenfuß-Kardinalitäten.',
    supportsDirection: false,
    code: `erDiagram
    MANDANT ||--o{ PROJEKT : "verwaltet"
    MANDANT ||--|{ MITARBEITER : "beschaeftigt"
    PROJEKT ||--o{ DIAGRAMM_DOKUMENT : "enthaelt"
    MITARBEITER ||--o{ DIAGRAMM_REVISION : "erstellt"
    DIAGRAMM_DOKUMENT ||--|{ DIAGRAMM_REVISION : "historisiert"

    MANDANT {
        uuid mandant_id PK
        string firmenname
        string tarif_stufe
        timestamp erstellt_am
    }
    PROJEKT {
        uuid projekt_id PK
        uuid mandant_id FK
        string bezeichnung
        boolean ist_archiviert
    }
    DIAGRAMM_DOKUMENT {
        uuid dokument_id PK
        uuid projekt_id FK
        string titel
        string diagramm_typ
        string aktives_theme
    }
    DIAGRAMM_REVISION {
        uuid revision_id PK
        uuid dokument_id FK
        uuid autor_id FK
        text mermaid_quellcode
        string pruefsumme_sha256
        timestamp gespeichert_am
    }`,
  },
  {
    id: 'class-diagram-domain',
    name: 'Domänenmodell (Klassendiagramm)',
    category: 'Software & Daten',
    badge: 'Klassendiagramm',
    description: 'Objektorientiertes Klassendiagramm mit Interfaces, Vererbung, Komposition und Methodensignaturen.',
    supportsDirection: true,
    code: `classDiagram
    direction TB

    class DiagramRenderer {
        <<interface>>
        +validateSyntax(code: string) ValidationResult
        +renderSVG(id: string, code: string) Promise~string~
        +exportRaster(scale: number) Promise~Blob~
    }

    class LocalMermaidEngine {
        -ThemeConfiguration activeTheme
        -Map~string, string~ svgCache
        +initialize(config: ThemeConfiguration) void
        +validateSyntax(code: string) ValidationResult
        +renderSVG(id: string, code: string) Promise~string~
        +injectInitDirective(code: string) string
    }

    class ThemeConfiguration {
        +MermaidBaseTheme theme
        +FlowchartCurve curve
        +string primaryColor
        +string lineColor
        +toDirectiveJSON() string
    }

    class ExportPipeline {
        +downloadSVG(svgContent: string, filename: string) void
        +rasterizeToPNG(svgContent: string, scale: number) Promise~Blob~
        +copyMarkdownBlock(code: string) Promise~void~
    }

    DiagramRenderer <|.. LocalMermaidEngine : implementiert
    LocalMermaidEngine *-- ThemeConfiguration : besitzt
    LocalMermaidEngine ..> ExportPipeline : übergibt SVG`,
  },
  {
    id: 'state-diagram-pipeline',
    name: 'Deployment-Zustandsautomat (State v2)',
    category: 'Ablauf & Prozess',
    badge: 'State v2',
    description: 'Komplexer Zustandsautomat mit verschachtelten Zuständen, Parallelverarbeitung und Fehler-Rollback.',
    supportsDirection: true,
    code: `stateDiagram-v2
    direction LR
    [*] --> Entwurf

    state Entwurf {
        [*] --> CodeBearbeitung
        CodeBearbeitung --> SyntaxPruefung : Eingabe (150ms Debounce)
        SyntaxPruefung --> Valide : Parser OK
        SyntaxPruefung --> SyntaxFehler : Parser-Ausnahme
        SyntaxFehler --> CodeBearbeitung : Korrektur
    }

    Entwurf --> Rendering : Valider AST
    state Rendering {
        [*] --> LayoutBerechnung
        LayoutBerechnung --> SVGGenerierung : Dagre / ELK
        SVGGenerierung --> CanvasUpdate
    }

    Rendering --> BereitZumExport : SVG im DOM
    BereitZumExport --> Entwurf : Weitere Änderung
    BereitZumExport --> [*] : Export abgeschlossen`,
  },
  {
    id: 'kanban-v11-board',
    name: 'Engineering Sprint-Board (Kanban v11)',
    category: 'Projekt & Planung',
    badge: 'Neu in v11',
    description: 'Natives Mermaid v11 Kanban-Board mit Ticket-IDs, Prioritätsstufen und Zuständigkeiten.',
    supportsDirection: false,
    code: `kanban
  Backlog
    [ Architektur-Spezifikation für v11 finalisieren ]@{ ticket: "ARCH-101", assigned: "K. Weber", priority: "High" }
    [ Farb-Kontrastprüfung nach WCAG AA ]@{ ticket: "UI-104", assigned: "M. Lindner", priority: "Normal" }
  In Arbeit
    [ Lokale SVG-zu-PNG 4x Canvas-Pipeline ]@{ ticket: "EXP-201", assigned: "S. Brandt", priority: "Very High" }
    [ Live-Parser mit Zeilen-Fehlerextraktion ]@{ ticket: "CORE-205", assigned: "A. Hofer", priority: "High" }
  Review & QA
    [ Interaktiver Pan-und-Zoom-Viewport ]@{ ticket: "UX-198", assigned: "M. Lindner", priority: "High" }
  Abgeschlossen
    [ Lokale Persistenz im Browser-Speicher ]@{ ticket: "CORE-150", assigned: "S. Brandt", priority: "Normal" }`,
  },
  {
    id: 'gantt-roadmap',
    name: 'Release- & Meilenstein-Planung (Gantt)',
    category: 'Projekt & Planung',
    badge: 'Gantt-Diagramm',
    description: 'Zeitliche Projektplanung mit Phasen, Abhängigkeiten, kritischem Pfad und Meilensteinen.',
    supportsDirection: false,
    code: `gantt
    title Release-Roadmap — Plattform-Migration Q4
    dateFormat YYYY-MM-DD
    axisFormat %d.%m.

    section Phase 1: Fundament
    Kern-Architektur & Parser-Isolation :done, p1, 2026-10-01, 10d
    Lokales Sicherheits-Audit           :done, p2, after p1, 5d
    Meilenstein Alpha-Freeze            :milestone, m1, after p2, 0d

    section Phase 2: Studio-UI
    Split-Editor & Fehler-Diagnose      :active, u1, 2026-10-16, 8d
    Visueller Theme-Konfigurator        :u2, after u1, 7d
    4x Ultra-HD Export-Engine           :crit, u3, after u1, 9d

    section Phase 3: Rollout
    Performance- & Stresstests          :r1, after u3, 5d
    Produktions-Release v2.0            :milestone, m2, after r1, 0d`,
  },
  {
    id: 'packet-beta-v11',
    name: 'Netzwerk-Protokollheader (Packet v11)',
    category: 'Architektur & System',
    badge: 'Neu in v11',
    description: 'Bit-genaue Darstellung von Netzwerk- und Binärprotokoll-Headern mit Mermaid v11 packet-beta.',
    supportsDirection: false,
    code: `packet-beta
  0-15: "Quell-Port (16 Bit)"
  16-31: "Ziel-Port (16 Bit)"
  32-63: "Sequenznummer (32 Bit)"
  64-95: "Bestätigungsnummer / ACK (32 Bit)"
  96-99: "Data Offset"
  100-105: "Reserviert"
  106: "URG"
  107: "ACK"
  108: "PSH"
  109: "RST"
  110: "SYN"
  111: "FIN"
  112-127: "Fenstergröße / Window (16 Bit)"
  128-143: "Prüfsumme / Checksum (16 Bit)"
  144-159: "Urgent Pointer (16 Bit)"
  160-191: "Optionen & Padding (Variabel)"`,
  },
  {
    id: 'xychart-telemetry',
    name: 'Latenz- & Durchsatz-Analyse (XY-Chart v11)',
    category: 'Analyse & Struktur',
    badge: 'XY-Chart',
    description: 'Kombinierte Balken- und Liniengrafik für Metriken, Durchsatz und Antwortzeiten.',
    supportsDirection: false,
    code: `xychart-beta
    title "Lokale Render-Performance nach Knotenanzahl (Durchsatz vs. Renderzeit)"
    x-axis ["10 Knoten", "25 Knoten", "50 Knoten", "100 Knoten", "200 Knoten", "400 Knoten"]
    y-axis "Renderzeit in Millisekunden (ms)" 0 --> 120
    bar [8, 14, 24, 42, 68, 105]
    line [6, 12, 21, 38, 62, 96]`,
  },
  {
    id: 'quadrant-prioritization',
    name: 'Architektur-Entscheidungsmatrix (Quadrant)',
    category: 'Analyse & Struktur',
    badge: 'Quadrant',
    description: 'Vier-Quadranten-Bewertung zur Priorisierung technischer Maßnahmen nach Aufwand und Wirkung.',
    supportsDirection: false,
    code: `quadrantChart
    title Technische Priorisierungs-Matrix (Nutzwert vs. Umsetzungsaufwand)
    x-axis "Geringer Aufwand" --> "Hoher Aufwand"
    y-axis "Geringer Nutzwert" --> "Hoher Nutzwert"
    quadrant-1 "Strategische Kernprojekte"
    quadrant-2 "Sofort-Gewinne (Quick Wins)"
    quadrant-3 "Niedrige Priorität"
    quadrant-4 "Komplexität hinterfragen"
    "Lokaler 4x PNG-Export": [0.28, 0.88]
    "Live-Syntax-Validierung": [0.22, 0.92]
    "Theme-Direktiven-Injektor": [0.35, 0.78]
    "Multi-Node Cluster-Layout": [0.72, 0.84]
    "Protokoll-Paket-Ansicht": [0.45, 0.62]
    "Legacy XML-Konverter": [0.78, 0.25]`,
  },
  {
    id: 'timeline-evolution',
    name: 'System-Evolutions-Chronik (Timeline)',
    category: 'Projekt & Planung',
    badge: 'Timeline',
    description: 'Chronologische Darstellung von Architektur-Generationen und Meilensteinen.',
    supportsDirection: false,
    code: `timeline
    title Evolution der Diagramm-Verarbeitungs-Architektur
    2023 : Statische CLI-Skripte
         : Manuelle SVG-Kompilierung in CI/CD
    2024 : Browser-basierter Split-Editor
         : Lokale Persistenz über Web Storage
    2025 : Mermaid v11 Engine-Upgrade
         : Native Unterstützung für Architecture & Packet
    2026 : Vollständiges Local-First Studio
         : Visueller Theme-Generator & 4x Retina-Rasterisierung`,
  },
  {
    id: 'gitgraph-release',
    name: 'Git-Branching & Release-Topologie',
    category: 'Software & Daten',
    badge: 'GitGraph',
    description: 'Visualisierung von Feature-Branches, Hotfixes, Merges und Release-Tags.',
    supportsDirection: false,
    code: `gitGraph
    commit id: "init-core" tag: "v1.0.0"
    branch feature/v11-parser
    checkout feature/v11-parser
    commit id: "add-mermaid-v11"
    commit id: "line-error-locator"
    checkout main
    branch feature/theme-studio
    checkout feature/theme-studio
    commit id: "custom-theme-vars"
    commit id: "init-directive-export"
    checkout main
    merge feature/v11-parser id: "merge-parser" tag: "v1.1.0"
    merge feature/theme-studio id: "merge-theme" tag: "v2.0.0-rc1"
    commit id: "production-hardening" tag: "v2.0.0"`,
  },
  {
    id: 'sankey-energy-flow',
    name: 'Ressourcen- & Datenfluss (Sankey v11)',
    category: 'Analyse & Struktur',
    badge: 'Sankey',
    description: 'Proportionale Flussvisualisierung für Datenströme, Budgets oder Systemlastverteilung.',
    supportsDirection: false,
    code: `sankey-beta

Ingress-Traffic,API-Gateway,1200
Ingress-Traffic,Statisches-CDN,850
API-Gateway,Auth-Service,320
API-Gateway,Core-Query-Engine,680
API-Gateway,Schreib-Pipeline,200
Core-Query-Engine,Redis-Cache-Hit,540
Core-Query-Engine,PostgreSQL-Read,140
Schreib-Pipeline,PostgreSQL-Primary,200`,
  },
];

export const CODE_SNIPPETS: CodeSnippet[] = [
  {
    id: 'node-db',
    label: 'Datenbank-Zylinder',
    category: 'Knoten & Formen',
    description: 'Zylindrischer Knoten für Datenbanken oder Speicher',
    snippet: `\n    DB[("Datenbank-Cluster")]`,
  },
  {
    id: 'node-decision',
    label: 'Entscheidungs-Raute',
    category: 'Knoten & Formen',
    description: 'Verzweigungs- oder Gateway-Knoten',
    snippet: `\n    Gate{{"Prüfung erfolgreich?"}}`,
  },
  {
    id: 'node-subroutine',
    label: 'Subprozess / Queue',
    category: 'Knoten & Formen',
    description: 'Doppelt gerahmter Knoten für Event-Bus oder Subsystem',
    snippet: `\n    Queue[["Event-Queue / Worker"]]`,
  },
  {
    id: 'node-v11-shape',
    label: 'v11 Erweiterte Form (@shape)',
    category: 'Knoten & Formen',
    description: 'Neue Mermaid v11 Shape-Syntax (z.B. hex, cyl, doc, delay)',
    snippet: `\n    Service@{ shape: hex, label: "Microservice Gateway" }`,
  },
  {
    id: 'edge-labeled',
    label: 'Beschriftete Verbindung',
    category: 'Verbindungen',
    description: 'Gerichteter Pfeil mit Protokoll- oder Aktionslabel',
    snippet: `\n    KnotenA -->|HTTPS / JSON| KnotenB`,
  },
  {
    id: 'edge-dotted',
    label: 'Asynchroner Event-Pfeil',
    category: 'Verbindungen',
    description: 'Gestrichelter Pfeil für Events oder lose Kopplung',
    snippet: `\n    Producer -.->|Async Event| Consumer`,
  },
  {
    id: 'edge-bidirectional',
    label: 'Bidirektionale Synchronisation',
    category: 'Verbindungen',
    description: 'Beidseitiger Pfeil für Replikation oder Handshakes',
    snippet: `\n    Primary <-->|Sync Replication| Replica`,
  },
  {
    id: 'subgraph-block',
    label: 'Subgraph-Container',
    category: 'Struktur & Subgraphs',
    description: 'Gruppierter Systembereich mit eigenem Titel',
    snippet: `\n    subgraph Zone["Sicherheitszone / Cluster"]\n        direction TB\n        SvcA["Service Alpha"] --> SvcB["Service Beta"]\n    end`,
  },
  {
    id: 'seq-alt-else',
    label: 'Sequenz Alt / Else Block',
    category: 'Sequenz & Klassen',
    description: 'Bedingte Verzweigung innerhalb eines Sequenzdiagramms',
    snippet: `\n    alt Bedingung erfüllt\n        Server-->>Client: 200 OK\n    else Fehlerfall\n        Server-->>Client: 422 Unprocessable Entity\n    end`,
  },
  {
    id: 'style-classdef',
    label: 'Custom ClassDef Styling',
    category: 'Styling',
    description: 'Definiert eine wiederverwendbare Farb- und Rahmenklasse im Diagramm',
    snippet: `\n    classDef highlight fill:#312e81,stroke:#818cf8,stroke-width:2px,color:#ffffff;\n    class KnotenA highlight;`,
  },
];
