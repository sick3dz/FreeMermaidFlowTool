import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FileSpreadsheet,
  Layers,
  Search,
  X,
} from 'lucide-react';
import { ScriptWorkspace } from '../types/mermaidStudio';
import {
  INVENTORY_CATEGORY_LABELS,
  INVENTORY_CATEGORY_ORDER,
  InventoryCategory,
  InventoryItem,
  InventoryOccurrence,
  InventoryStatus,
  buildWorkspaceInventory,
  exportInventoryCsv,
  exportInventoryJson,
  exportInventoryXlsxBlob,
  filterWorkspaceInventoryBundle,
} from '../utils/inventoryExporter';
import { triggerLocalDownload } from '../utils/mermaidEngine';

export interface InventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: ScriptWorkspace;
  diagramTitle?: string;
  onJumpToScript?: (scriptNumber: string) => void;
}

function statusTextColor(status: InventoryStatus): string {
  switch (status) {
    case 'missing':
      return 'text-rose-400';
    case 'deprecated':
    case 'unused':
      return 'text-amber-400';
    case 'deactivated':
      return 'text-slate-400';
    default:
      return 'text-emerald-400';
  }
}

export const InventoryModal: React.FC<InventoryModalProps> = ({
  isOpen,
  onClose,
  workspace,
  diagramTitle,
  onJumpToScript,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | InventoryCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'issues'>('all');
  const [viewMode, setViewMode] = useState<'summary' | 'occurrences'>('summary');
  const [exportFilteredOnly, setExportFilteredOnly] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);
  const [copiedCsv, setCopiedCsv] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setSelectedCategory('all');
    setStatusFilter('all');
    setViewMode('summary');
    setExportFilteredOnly(false);
    setExpandedItemId(null);
    setExportNotice(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 60);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(timer);
    };
  }, [isOpen, onClose]);

  const fullBundle = useMemo(() => {
    return buildWorkspaceInventory(workspace, {
      diagramTitle: diagramTitle || undefined,
    });
  }, [workspace, diagramTitle]);

  const matchesSearch = useCallback((item: InventoryItem, q: string): boolean => {
    if (!q) return true;
    if (
      item.name.toLowerCase().includes(q) ||
      item.categoryLabel.toLowerCase().includes(q) ||
      item.subTypeLabel.toLowerCase().includes(q) ||
      item.statusLabel.toLowerCase().includes(q) ||
      item.details.toLowerCase().includes(q) ||
      item.scriptsSummary.toLowerCase().includes(q)
    ) {
      return true;
    }
    return item.occurrences.some(
      (o) =>
        o.scriptNumber.toLowerCase().includes(q) ||
        o.scriptName.toLowerCase().includes(q) ||
        o.sectionName.toLowerCase().includes(q) ||
        o.command.toLowerCase().includes(q) ||
        o.contextSnippet.toLowerCase().includes(q) ||
        String(o.lineNumber) === q
    );
  }, []);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return fullBundle.items.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      if (statusFilter === 'issues' && item.status === 'active') return false;
      return matchesSearch(item, q);
    });
  }, [fullBundle.items, selectedCategory, statusFilter, searchQuery, matchesSearch]);

  const filteredOccurrences = useMemo<InventoryOccurrence[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const out: InventoryOccurrence[] = [];
    for (const item of filteredItems) {
      for (const occ of item.occurrences) {
        if (!q) {
          out.push(occ);
          continue;
        }
        const itemMatchedDirectly =
          item.name.toLowerCase().includes(q) ||
          item.subTypeLabel.toLowerCase().includes(q) ||
          item.details.toLowerCase().includes(q);
        const occMatches =
          occ.scriptNumber.toLowerCase().includes(q) ||
          occ.scriptName.toLowerCase().includes(q) ||
          occ.sectionName.toLowerCase().includes(q) ||
          occ.command.toLowerCase().includes(q) ||
          occ.contextSnippet.toLowerCase().includes(q) ||
          String(occ.lineNumber) === q;
        if (itemMatchedDirectly || occMatches) {
          out.push(occ);
        }
      }
    }
    return out;
  }, [filteredItems, searchQuery]);

  const isFilterActive =
    searchQuery.trim().length > 0 || selectedCategory !== 'all' || statusFilter !== 'all';

  const activeExportBundle = useMemo(() => {
    if (!exportFilteredOnly || !isFilterActive) return fullBundle;
    return filterWorkspaceInventoryBundle(fullBundle, filteredItems);
  }, [exportFilteredOnly, isFilterActive, fullBundle, filteredItems]);

  const showNotice = (msg: string) => {
    setExportNotice(msg);
    window.setTimeout(() => {
      setExportNotice((prev) => (prev === msg ? null : prev));
    }, 3400);
  };

  const handleExportXlsx = async () => {
    if (activeExportBundle.scriptCount === 0 && activeExportBundle.items.length === 0) return;
    setIsExportingXlsx(true);
    try {
      const blob = await exportInventoryXlsxBlob(activeExportBundle);
      triggerLocalDownload(
        blob,
        exportFilteredOnly && isFilterActive ? 'Callflow-Inventar-Filter.xlsx' : 'Callflow-Inventar.xlsx'
      );
      showNotice('Excel-Inventar (.xlsx · 9 Blätter) lokal erstellt und heruntergeladen.');
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Fehler beim Excel-Export.');
    } finally {
      setIsExportingXlsx(false);
    }
  };

  const handleExportCsv = () => {
    const csv = exportInventoryCsv(activeExportBundle, {
      mode: viewMode === 'summary' ? 'summary' : 'occurrences',
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    triggerLocalDownload(
      blob,
      exportFilteredOnly && isFilterActive ? 'Callflow-Inventar-Filter.csv' : 'Callflow-Inventar.csv'
    );
    showNotice(
      `CSV-Inventar (${viewMode === 'summary' ? 'Gruppiert' : 'Fundstellen'}) heruntergeladen.`
    );
  };

  const handleExportJson = () => {
    const json = exportInventoryJson(activeExportBundle);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    triggerLocalDownload(
      blob,
      exportFilteredOnly && isFilterActive ? 'Callflow-Inventar-Filter.json' : 'Callflow-Inventar.json'
    );
    showNotice('Strukturiertes JSON-Inventar heruntergeladen.');
  };

  const handleCopyCsv = async () => {
    try {
      const csv = exportInventoryCsv(activeExportBundle, {
        mode: viewMode === 'summary' ? 'summary' : 'occurrences',
      });
      await navigator.clipboard.writeText(csv);
      setCopiedCsv(true);
      window.setTimeout(() => setCopiedCsv(false), 2200);
      showNotice('Inventar als CSV in die Zwischenablage kopiert.');
    } catch {
      showNotice('Kopieren nicht möglich — bitte direkt herunterladen.');
    }
  };

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setStatusFilter('all');
    setExportFilteredOnly(false);
  };

  if (!isOpen) return null;

  const hasModules = (workspace?.modules?.length || 0) > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inventory-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-6xl h-[88vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2.5">
              <Layers className="w-4 h-4 text-indigo-400 shrink-0" />
              <h2
                id="inventory-modal-title"
                className="text-base font-semibold text-slate-100 truncate"
              >
                Callflow Asset-Inventar
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400 tabular-nums">
              <span>{fullBundle.scriptCount} Skripte</span>
              <span aria-hidden="true">·</span>
              <span>{fullBundle.stats.totalItems} Elemente</span>
              <span aria-hidden="true">·</span>
              <span>{fullBundle.stats.totalOccurrences} Fundstellen</span>
              <span aria-hidden="true">·</span>
              <span className={fullBundle.stats.issuesCount > 0 ? 'text-amber-300' : 'text-emerald-400'}>
                {fullBundle.stats.issuesCount} Auffälligkeiten
              </span>
              <span aria-hidden="true">·</span>
              <span>Schema v{fullBundle.schemaVersion}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExportXlsx}
              disabled={!hasModules || isExportingXlsx}
              className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 disabled:pointer-events-none text-white text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
              <span>{isExportingXlsx ? 'Erstelle .xlsx...' : 'Excel (.xlsx)'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!hasModules}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-45 disabled:pointer-events-none border border-slate-700 text-slate-100 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>CSV</span>
            </button>

            <button
              type="button"
              onClick={handleExportJson}
              disabled={!hasModules}
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-45 disabled:pointer-events-none border border-slate-700 text-slate-100 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>JSON</span>
            </button>

            <button
              type="button"
              onClick={handleCopyCsv}
              disabled={!hasModules}
              title="Aktuelle Ansicht als CSV in Zwischenablage kopieren"
              className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-45 disabled:pointer-events-none border border-slate-700 text-slate-300 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedCsv ? (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <Copy className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{copiedCsv ? 'Kopiert' : 'CSV kopieren'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Inventar schließen"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        {hasModules && (
          <div className="px-5 py-3 border-b border-slate-800 bg-slate-900 space-y-3 shrink-0">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              {/* Live Search */}
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Suche nach Prompt, .wav, Skillset, DNIS, Variable, DB/Hist-Call, Skript oder Zeile..."
                  className="w-full pl-9 pr-8 py-2 rounded-lg bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none text-xs text-slate-100 placeholder:text-slate-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Suchfeld leeren"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* View Mode + Status + Export Scope Controls */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <div className="flex items-center p-0.5 bg-slate-950 border border-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setViewMode('summary')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      viewMode === 'summary'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Übersicht ({filteredItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('occurrences')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      viewMode === 'occurrences'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Fundstellen ({filteredOccurrences.length})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setStatusFilter((prev) => (prev === 'all' ? 'issues' : 'all'))
                  }
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === 'issues'
                      ? 'bg-amber-500/15 border-amber-500/50 text-amber-200'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Nur Auffälligkeiten</span>
                </button>

                {isFilterActive && (
                  <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 cursor-pointer select-none whitespace-nowrap shrink-0">
                    <input
                      type="checkbox"
                      checked={exportFilteredOnly}
                      onChange={(e) => setExportFilteredOnly(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-indigo-500 focus:ring-indigo-500"
                    />
                    <span>Nur Filter exportieren</span>
                  </label>
                )}
              </div>
            </div>

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                  selectedCategory === 'all'
                    ? 'bg-slate-800 text-slate-100 border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                Alle ({fullBundle.stats.totalItems})
              </button>
              {INVENTORY_CATEGORY_ORDER.map((cat) => {
                const count = fullBundle.stats.byCategory[cat] || 0;
                const isActive = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                      isActive
                        ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/40'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    {INVENTORY_CATEGORY_LABELS[cat]} ({count})
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Export Notice Banner */}
        {exportNotice && (
          <div className="px-5 py-2 border-b border-emerald-500/30 bg-emerald-950/35 text-xs text-emerald-200 flex items-center justify-between gap-2 shrink-0">
            <span>{exportNotice}</span>
            <button
              type="button"
              onClick={() => setExportNotice(null)}
              className="text-emerald-300 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 min-h-0 overflow-auto bg-slate-950/50">
          {!hasModules ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-3">
              <Layers className="w-8 h-8 text-slate-600" />
              <div className="space-y-1 max-w-md">
                <h3 className="text-sm font-semibold text-slate-200">
                  Noch kein Callflow-Workspace geladen
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Laden Sie Avaya `.s`-Skripte oder eine Visio-Datei über den Import, um alle Prompts, WAV-Dateien, Skillsets, Rufnummern, Variablen und externen DB/API-Aufrufe inventarisieren und exportieren zu können.
                </p>
              </div>
            </div>
          ) : (viewMode === 'summary' ? filteredItems.length === 0 : filteredOccurrences.length === 0) ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-3">
              <Search className="w-7 h-7 text-slate-600" />
              <div className="space-y-1 max-w-md">
                <h3 className="text-sm font-semibold text-slate-200">
                  Keine passenden Inventar-Einträge gefunden
                </h3>
                <p className="text-xs text-slate-400">
                  Passen Sie Suchbegriff, Kategorie-Auswahl oder Statusfilter an.
                </p>
              </div>
              <button
                type="button"
                onClick={resetFilters}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 cursor-pointer"
              >
                Filter zurücksetzen
              </button>
            </div>
          ) : viewMode === 'summary' ? (
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 text-[11px] font-semibold text-slate-400">
                <tr>
                  <th className="py-2.5 pl-5 pr-3 w-8" />
                  <th className="py-2.5 px-3">Element / Name</th>
                  <th className="py-2.5 px-3">Kategorie &amp; Typ</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right tabular-nums">Funde</th>
                  <th className="py-2.5 px-3 text-right tabular-nums">Skripte</th>
                  <th className="py-2.5 pl-3 pr-5">Skript-Zuordnung &amp; Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {filteredItems.map((item) => {
                  const isExpanded = expandedItemId === item.id;
                  return (
                    <React.Fragment key={item.id}>
                      <tr
                        onClick={() =>
                          setExpandedItemId((prev) => (prev === item.id ? null : item.id))
                        }
                        className="hover:bg-slate-900/75 transition-colors cursor-pointer"
                      >
                        <td className="py-2.5 pl-5 pr-2 text-slate-500">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-100 max-w-xs truncate">
                          {item.name}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">
                          <span>{item.categoryLabel}</span>
                          <span className="text-slate-600 mx-1.5">·</span>
                          <span className="text-slate-400">{item.subTypeLabel}</span>
                        </td>
                        <td className={`py-2.5 px-3 font-medium whitespace-nowrap ${statusTextColor(item.status)}`}>
                          {item.statusLabel}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200">
                          {item.occurrenceCount}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                          {item.scriptCount}
                        </td>
                        <td className="py-2.5 pl-3 pr-5 text-slate-400 max-w-md truncate">
                          <span className="text-slate-300">{item.scriptsSummary}</span>
                          <span className="text-slate-600 mx-1.5">·</span>
                          <span>{item.details}</span>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-900/60">
                          <td colSpan={7} className="px-8 py-3 border-t border-slate-800/80">
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
                                <span>
                                  Einzelne Fundstellen für <span className="font-mono text-slate-200">{item.name}</span>
                                </span>
                                <span className="tabular-nums">{item.occurrences.length} Einträge</span>
                              </div>
                              <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-lg bg-slate-950/70 overflow-hidden">
                                {item.occurrences.map((occ) => (
                                  <div
                                    key={occ.id}
                                    className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs hover:bg-slate-900/60"
                                  >
                                    <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                      <span className="font-mono font-semibold text-indigo-300">
                                        {occ.scriptNumber}
                                      </span>
                                      <span className="text-slate-600">·</span>
                                      <span className="text-slate-300">{occ.sectionName}</span>
                                      <span className="text-slate-600">·</span>
                                      <span className="font-mono tabular-nums text-slate-400">
                                        Zeile {occ.lineNumber}
                                      </span>
                                      <span className="text-slate-600">·</span>
                                      <span className="text-slate-300">{occ.command}</span>
                                      {occ.contextSnippet && (
                                        <>
                                          <span className="text-slate-600">/</span>
                                          <span className="font-mono text-[11px] text-slate-400 truncate max-w-xl">
                                            {occ.contextSnippet}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                    {onJumpToScript && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onJumpToScript(occ.scriptNumber);
                                          onClose();
                                        }}
                                        className="px-2 py-1 rounded text-[11px] font-medium text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/15 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                                      >
                                        <span>Zum Skript</span>
                                        <ExternalLink className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 text-[11px] font-semibold text-slate-400">
                <tr>
                  <th className="py-2.5 pl-5 pr-3">Element / Name</th>
                  <th className="py-2.5 px-3">Kategorie</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Skript</th>
                  <th className="py-2.5 px-3">Section</th>
                  <th className="py-2.5 px-3 text-right tabular-nums">Zeile</th>
                  <th className="py-2.5 px-3">Befehl</th>
                  <th className="py-2.5 px-3">Quelltext-Auszug</th>
                  <th className="py-2.5 pl-3 pr-5 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {filteredOccurrences.map((occ) => (
                  <tr key={occ.id} className="hover:bg-slate-900/70 transition-colors">
                    <td className="py-2 pl-5 pr-3 font-mono font-medium text-slate-100 max-w-[200px] truncate">
                      {occ.itemName}
                    </td>
                    <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                      {occ.subTypeLabel}
                    </td>
                    <td className={`py-2 px-3 whitespace-nowrap font-medium ${statusTextColor(occ.status)}`}>
                      {occ.statusLabel}
                    </td>
                    <td className="py-2 px-3 font-mono text-indigo-300 whitespace-nowrap">
                      {occ.scriptNumber}
                    </td>
                    <td className="py-2 px-3 text-slate-300 max-w-[160px] truncate">
                      {occ.sectionName}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400">
                      {occ.lineNumber}
                    </td>
                    <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                      {occ.command}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-400 max-w-xs truncate">
                      {occ.contextSnippet}
                    </td>
                    <td className="py-2 pl-3 pr-5 text-right">
                      {onJumpToScript && (
                        <button
                          type="button"
                          onClick={() => {
                            onJumpToScript(occ.scriptNumber);
                            onClose();
                          }}
                          className="text-[11px] font-medium text-indigo-300 hover:text-indigo-200 whitespace-nowrap inline-flex items-center gap-1 cursor-pointer"
                        >
                          <span>Öffnen</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
