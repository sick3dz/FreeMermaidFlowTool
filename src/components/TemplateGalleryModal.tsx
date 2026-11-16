import React, { useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Code,
  FolderOpen,
  Layers,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  CodeSnippet,
  DiagramTemplate,
  SavedDiagram,
} from '../types/mermaidStudio';
import { CODE_SNIPPETS, MERMAID_TEMPLATES } from '../data/mermaidTemplates';

interface TemplateGalleryModalProps {
  isOpen: boolean;
  initialTab: 'templates' | 'snippets' | 'saved' | 'help';
  onClose: () => void;
  onSelectTemplate: (template: DiagramTemplate) => void;
  onInsertSnippet: (snippet: string) => void;
  savedDiagrams: SavedDiagram[];
  onSaveCurrentDiagram: (title: string) => void;
  onLoadSavedDiagram: (saved: SavedDiagram) => void;
  onDeleteSavedDiagram: (id: string) => void;
  onImportFileContent: (title: string, content: string) => void;
  currentTitle: string;
}

const CATEGORIES = [
  'Alle',
  'Architektur & System',
  'Software & Daten',
  'Ablauf & Prozess',
  'Projekt & Planung',
  'Analyse & Struktur',
] as const;

export const TemplateGalleryModal: React.FC<TemplateGalleryModalProps> = ({
  isOpen,
  initialTab,
  onClose,
  onSelectTemplate,
  onInsertSnippet,
  savedDiagrams,
  onSaveCurrentDiagram,
  onLoadSavedDiagram,
  onDeleteSavedDiagram,
  onImportFileContent,
  currentTitle,
}) => {
  const [activeTab, setActiveTab] = useState<'templates' | 'snippets' | 'saved' | 'help'>(
    initialTab
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('Alle');
  const [searchQuery, setSearchQuery] = useState('');
  const [newSaveTitle, setNewSaveTitle] = useState(currentTitle || 'Mein Architektur-Diagramm');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, isOpen]);

  React.useEffect(() => {
    if (currentTitle) {
      setNewSaveTitle(currentTitle);
    }
  }, [currentTitle]);

  const filteredTemplates = useMemo(() => {
    return MERMAID_TEMPLATES.filter((tpl) => {
      const matchesCategory =
        selectedCategory === 'Alle' || tpl.category === selectedCategory;
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        tpl.name.toLowerCase().includes(q) ||
        tpl.description.toLowerCase().includes(q) ||
        tpl.badge.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [selectedCategory, searchQuery]);

  if (!isOpen) return null;

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || '');
      const mermaidMatch = content.match(/```mermaid\s*([\s\S]*?)```/i);
      const extracted = mermaidMatch ? mermaidMatch[1].trim() : content.trim();
      const cleanName = file.name.replace(/\.(mmd|mermaid|md|txt)$/i, '');
      onImportFileContent(cleanName, extracted);
      onClose();
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-6">
      <div className="w-full max-w-5xl h-[90vh] sm:h-[84vh] bg-slate-900 border-t sm:border border-slate-800 rounded-t-2xl sm:rounded-xl flex flex-col overflow-hidden shadow-2xl">
        {/* Mobile Grab Handle */}
        <div className="sm:hidden w-10 h-1.5 bg-slate-700 rounded-full mx-auto mt-2.5 shrink-0" />

        {/* Top Modal Header */}
        <div className="flex flex-col gap-3 px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-950/60 shrink-0">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
              MermaidFree2UseOpen — Bibliothek & Speicher
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Dialog schließen"
              className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 p-1.5 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Segmented Modal Navigation (horizontally scrollable on narrow screens) */}
          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('templates')}
              className={`min-h-[38px] sm:min-h-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'templates'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>v11 Vorlagen ({MERMAID_TEMPLATES.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('snippets')}
              className={`min-h-[38px] sm:min-h-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'snippets'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>Code-Bausteine</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('saved')}
              className={`min-h-[38px] sm:min-h-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'saved'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Speicherstände ({savedDiagrams.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('help')}
              className={`min-h-[38px] sm:min-h-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'help'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>v11 Syntax-Referenz</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Mermaid v11 Templates */}
        {activeTab === 'templates' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Filter & Search Bar */}
            <div className="px-4 sm:px-6 py-3 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 shrink-0">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`min-h-[36px] sm:min-h-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      selectedCategory === cat
                        ? 'bg-slate-800 text-slate-100 border border-slate-700'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-64 shrink-0">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Vorlagen durchsuchen..."
                  className="w-full min-h-[38px] sm:min-h-0 pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Template Grid */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 content-start">
              {filteredTemplates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="group bg-slate-950/70 border border-slate-800 hover:border-indigo-500/60 rounded-xl p-4 flex flex-col justify-between transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                      <span className="text-indigo-400 font-medium">{tpl.badge}</span>
                      <span aria-hidden="true">·</span>
                      <span>{tpl.category}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-100 group-hover:text-indigo-300 transition-colors">
                      {tpl.name}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      {tpl.description}
                    </p>
                    <pre className="mt-3 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80 text-[11px] font-mono text-slate-400 overflow-hidden max-h-24 leading-tight">
                      {tpl.code.split('\n').slice(0, 4).join('\n')}
                    </pre>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {tpl.code.split('\n').length} Zeilen
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTemplate(tpl);
                        onClose();
                      }}
                      className="min-h-[38px] sm:min-h-0 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      Vorlage laden
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 2: Code Snippets */}
        {activeTab === 'snippets' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-4 content-start">
            {CODE_SNIPPETS.map((item: CodeSnippet) => (
              <div
                key={item.id}
                className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
                    <span className="text-indigo-400 font-medium">{item.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>Direktbaustein</span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-100">{item.label}</h3>
                  <p className="text-xs text-slate-400 mt-1">{item.description}</p>
                  <pre className="mt-3 p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-indigo-200 overflow-x-auto">
                    {item.snippet.trim()}
                  </pre>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      onInsertSnippet(item.snippet);
                      onClose();
                    }}
                    className="min-h-[38px] sm:min-h-0 px-3.5 py-1.5 bg-slate-800 hover:bg-indigo-600 text-slate-100 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>In Editor einfügen</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab 3: Local Storage Saved Diagrams & Disk File Import */}
        {activeTab === 'saved' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-100">
                  Aktuelles Diagramm im Browser sichern
                </h3>
                <p className="text-xs text-slate-400">
                  Speichert Quellcode und Theme-Konfiguration dauerhaft im lokalen Browser-Speicher
                  (ohne Server-Upload).
                </p>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    value={newSaveTitle}
                    onChange={(e) => setNewSaveTitle(e.target.value)}
                    placeholder="Diagramm-Titel eingeben..."
                    className="flex-1 min-h-[40px] px-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newSaveTitle.trim()) {
                        onSaveCurrentDiagram(newSaveTitle.trim());
                      }
                    }}
                    className="min-h-[40px] px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Lokal speichern</span>
                  </button>
                </div>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Lokale Datei öffnen (.mmd / .md / .txt)
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Importiert lokale Diagrammdateien oder Markdown-Dokumente und extrahiert
                    eingebettete Mermaid-Blöcke automatisch.
                  </p>
                </div>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mmd,.mermaid,.txt,.md"
                    onChange={handleFileImport}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[40px] px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <Upload className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Datei auswählen</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-200">
                Gespeicherte Stände ({savedDiagrams.length})
              </h3>
              {savedDiagrams.length === 0 ? (
                <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-8 text-center">
                  <p className="text-sm text-slate-300 font-medium">
                    Noch keine lokalen Diagramme gespeichert
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Nutzen Sie das Formular oben, um Snapshots Ihrer aktuellen Arbeit im Browser
                    abzulegen.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {savedDiagrams.map((item) => (
                    <div
                      key={item.id}
                      className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-slate-100 truncate">
                          {item.title}
                        </h4>
                        <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 tabular-nums">
                          <span>{new Date(item.updatedAt).toLocaleString('de-DE')}</span>
                          <span aria-hidden="true">·</span>
                          <span>{item.code.split('\n').length} Zeilen</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onLoadSavedDiagram(item);
                            onClose();
                          }}
                          className="min-h-[38px] sm:min-h-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                        >
                          Laden
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteSavedDiagram(item.id)}
                          title="Eintrag löschen"
                          className="min-h-[38px] min-w-[38px] sm:min-h-0 sm:min-w-0 p-1.5 flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Mermaid v11 Reference Guide */}
        {activeTab === 'help' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-4 content-start">
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="text-xs text-indigo-400 font-medium">Mermaid v11 Neuerung</div>
              <h3 className="text-sm font-semibold text-slate-100">
                Erweiterte Knotenformen (@shape Syntax)
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                In Mermaid v11 lassen sich über 30 semantische Knotenformen über das{' '}
                <code className="text-indigo-300">@&#123; shape: ... &#125;</code> Attribut
                definieren:
              </p>
              <pre className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto">
{`flowchart LR
  A@{ shape: cyl, label: "Datenbank" }
  B@{ shape: hex, label: "Microservice" }
  C@{ shape: doc, label: "PDF-Bericht" }
  A --> B --> C`}
              </pre>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="text-xs text-indigo-400 font-medium">Mermaid v11 Neuerung</div>
              <h3 className="text-sm font-semibold text-slate-100">
                Architektur-Diagramme (architecture-beta)
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Modelliert Cloud-Gruppen, Services und gerichtete Port-Verbindungen (
                <code className="text-indigo-300">:L</code>,{' '}
                <code className="text-indigo-300">:R</code>,{' '}
                <code className="text-indigo-300">:T</code>,{' '}
                <code className="text-indigo-300">:B</code>):
              </p>
              <pre className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto">
{`architecture-beta
  group cloud(cloud)[VPC Cluster]
  service api(server)[API Server] in cloud
  service db(database)[Postgres] in cloud
  api:R --> L:db`}
              </pre>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="text-xs text-indigo-400 font-medium">Direktiven & Konfiguration</div>
              <h3 className="text-sm font-semibold text-slate-100">
                Inline-Theme-Steuerung (%%&#123;init&#125;%%)
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Jedes Diagramm kann seine eigene Theme-Konfiguration im Kopfbereich tragen, damit es
                auch in GitHub, GitLab oder Notion identisch aussieht:
              </p>
              <pre className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto">
{`%%{init: {"theme": "base", "look": "handDrawn"}}%%
flowchart TD
  Start --> Ziel`}
              </pre>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
              <div className="text-xs text-indigo-400 font-medium">Touch & Desktop-Bedienung</div>
              <h3 className="text-sm font-semibold text-slate-100">
                Gesten & Navigation in MermaidFree2UseOpen
              </h3>
              <ul className="text-xs text-slate-300 space-y-1.5 pt-1">
                <li>
                  <span className="font-mono text-indigo-300">Pinch-to-Zoom (2 Finger)</span>{' '}
                  skaliert die Vorschau auf Smartphones & Tablets stufenlos
                </li>
                <li>
                  <span className="font-mono text-indigo-300">Touch-Pan (1 Finger)</span>{' '}
                  verschiebt den Diagrammausschnitt auf dem Canvas
                </li>
                <li>
                  <span className="font-mono text-indigo-300">Schnell-Symbolleiste</span> über dem
                  Editor fügt Pfeile (<code className="text-indigo-300">--&gt;</code>) und Klammern
                  direkt ein
                </li>
                <li>
                  <span className="font-mono text-indigo-300">Desktop-Splitter</span> erlaubt
                  stufenloses Ziehen sowie schnelles Ein-/Ausklappen der Seitenleisten
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
