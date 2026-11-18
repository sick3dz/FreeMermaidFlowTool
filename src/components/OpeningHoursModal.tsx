import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Clock,
  Search,
  X,
  Download,
  Copy,
  Check,
  Calendar,
  ExternalLink,
  Layers,
  ShieldAlert,
  FileSpreadsheet,
} from 'lucide-react';
import { CallflowScheduleSummaryRow, ScriptWorkspace } from '../types/mermaidStudio';
import {
  buildWorkspaceScheduleOverview,
  exportOpeningHoursCsv,
  canonicalScriptMatchKey,
} from '../utils/scriptCallflowParser';

export interface OpeningHoursModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: ScriptWorkspace;
  onJumpToScript?: (scriptNumber: string) => void;
}

export const OpeningHoursModal: React.FC<OpeningHoursModalProps> = ({
  isOpen,
  onClose,
  workspace,
  onJumpToScript,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'with-hours' | 'holiday' | 'without-hours'>('all');
  const [copied, setCopied] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close on Escape key & auto-focus search input
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 60);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onClose]);

  // Compute schedule overview rows across all scripts
  const allRows = useMemo(() => {
    if (!workspace || !workspace.modules || workspace.modules.length === 0) {
      return [];
    }
    return buildWorkspaceScheduleOverview(workspace);
  }, [workspace]);

  // KPI counts
  const totalCount = allRows.length;
  const withHoursCount = useMemo(() => allRows.filter((r) => r.hasSchedule).length, [allRows]);
  const holidayCount = useMemo(() => allRows.filter((r) => r.hasHoliday).length, [allRows]);
  const withoutHoursCount = useMemo(
    () => allRows.filter((r) => !r.hasSchedule && !r.hasHoliday).length,
    [allRows]
  );

  // Filtered rows with robust search
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allRows.filter((r) => {
      if (filter === 'with-hours' && !r.hasSchedule) return false;
      if (filter === 'holiday' && !r.hasHoliday) return false;
      if (filter === 'without-hours' && (r.hasSchedule || r.hasHoliday)) return false;

      if (!q) return true;
      const cleanHours = (r.openingHours || '').toLowerCase().replace(/:\s+/g, ':');
      return (
        r.scriptNumber.toLowerCase().includes(q) ||
        r.scriptName.toLowerCase().includes(q) ||
        r.stepName.toLowerCase().includes(q) ||
        cleanHours.includes(q) ||
        r.holidayAndSpecial.toLowerCase().includes(q) ||
        r.closedOrOverflowAction.toLowerCase().includes(q)
      );
    });
  }, [allRows, filter, searchQuery]);

  // Download CSV
  const handleDownloadCsv = useCallback(() => {
    const csv = exportOpeningHoursCsv(workspace);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `callflow-oeffnungszeiten-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [workspace]);

  // Copy Markdown table
  const handleCopyMarkdown = useCallback(() => {
    if (allRows.length === 0) return;
    const header = '| Skript | Name | Prio / Schritt | Öffnungszeiten (SondZeit) | Feiertag / Sonderstatus | Aktion / Überlauf |\n|---|---|---|---|---|---|';
    const lines = allRows.map((r) => {
      const escCell = (s: string) => (s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      const cleanHours = (r.openingHours || '').replace(/:\s+/g, ':');
      return `| ${escCell(r.scriptNumber)} | ${escCell(r.scriptName)} | ${r.prio ? `Prio ${r.prio}: ` : ''}${escCell(r.stepName)} | ${escCell(cleanHours)} | ${escCell(r.holidayAndSpecial)} | ${escCell(r.closedOrOverflowAction)} |`;
    });
    const md = [header, ...lines].join('\n');
    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [allRows]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="opening-hours-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl max-h-[80vh] my-auto overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2
                  id="opening-hours-modal-title"
                  className="text-base font-bold text-slate-100 truncate"
                >
                  Öffnungszeiten &amp; Zeitpläne (SondZeit)
                </h2>
                <span className="px-2 py-0.5 rounded-md text-xs font-mono bg-amber-500/20 text-amber-200 border border-amber-500/40 tabular-nums">
                  {totalCount} Regeln in {workspace.modules.length} Skripten
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                Vollständige Übersicht aller Dienst-, Sonderzeit- und Feiertagsregelungen im Callflow
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick KPI Stat Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 px-5 py-3 bg-slate-950/50 border-b border-slate-800 shrink-0">
          <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              <Layers className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-slate-400 font-mono uppercase">Alle Skripte</div>
              <div className="text-sm font-bold text-slate-100 font-mono tabular-nums">
                {totalCount}
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-300 border border-sky-500/30">
              <Clock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-slate-400 font-mono uppercase">Mit Öffnungszeiten</div>
              <div className="text-sm font-bold text-sky-200 font-mono tabular-nums">
                {withHoursCount}
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <Calendar className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-slate-400 font-mono uppercase">Feiertagsprüfungen</div>
              <div className="text-sm font-bold text-amber-200 font-mono tabular-nums">
                {holidayCount}
              </div>
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-slate-400 font-mono uppercase">24/7 Ohne Begrenzung</div>
              <div className="text-sm font-bold text-emerald-200 font-mono tabular-nums">
                {withoutHoursCount}
              </div>
            </div>
          </div>
        </div>

        {/* Toolbar: Filter Chips + Search + Export */}
        <div className="px-5 py-3 border-b border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shrink-0 bg-slate-900">
          {/* Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
                filter === 'all'
                  ? 'bg-indigo-600/25 border-indigo-500 text-indigo-100 font-semibold shadow-xs'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Alle ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('with-hours')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 tabular-nums ${
                filter === 'with-hours'
                  ? 'bg-sky-600/25 border-sky-500 text-sky-100 font-semibold shadow-xs'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3 h-3 text-sky-400" />
              <span>Mit Zeiten ({withHoursCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('holiday')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 tabular-nums ${
                filter === 'holiday'
                  ? 'bg-amber-600/25 border-amber-500 text-amber-100 font-semibold shadow-xs'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Calendar className="w-3 h-3 text-amber-400" />
              <span>Feiertag ({holidayCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('without-hours')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
                filter === 'without-hours'
                  ? 'bg-slate-800 border-slate-600 text-slate-100 font-semibold shadow-xs'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              24/7 ({withoutHoursCount})
            </button>
          </div>

          {/* Search + Action Buttons */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 md:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Skript, Uhrzeit (08:00), Mo-Fr, Feiertag..."
                aria-label="Öffnungszeiten und Skripte durchsuchen"
                className="w-full pl-9 pr-8 py-2 bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none font-mono shadow-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  title="Suche leeren"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleCopyMarkdown}
              title="Tabelle als Markdown in Zwischenablage kopieren"
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-sm"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Kopiert</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Kopieren</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadCsv}
              title="Öffnungszeiten als Excel CSV exportieren"
              className="px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel (.csv)</span>
            </button>
          </div>
        </div>

        {/* Content Table Container (Scrollable with internal body) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {filteredRows.length > 0 ? (
            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/70 shadow-inner">
              <table className="w-full border-collapse text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/95 text-slate-400 text-[11px] font-semibold select-none sticky top-0 z-10">
                    <th className="py-3 px-3.5 whitespace-nowrap">Skript</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Regel / Schritt</th>
                    <th className="py-3 px-3.5 min-w-[240px]">Öffnungszeiten (SondZeit)</th>
                    <th className="py-3 px-3.5 min-w-[150px]">Feiertag / Sonderstatus</th>
                    <th className="py-3 px-3.5 min-w-[210px]">Aktion bei Schließung / Überlauf</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Aktion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {filteredRows.map((row) => {
                    const isMainMod =
                      canonicalScriptMatchKey(row.scriptNumber) === 'main' ||
                      (row.isMaster &&
                        /^(?:main|start|master(?:script)?)$/i.test(row.scriptNumber));

                    const hasTimes = row.hasSchedule;
                    const cleanHours = (row.openingHours || '').replace(/:\s+/g, ':');
                    const isSondZeit =
                      /sondzeit/i.test(cleanHours) ||
                      /sondzeit/i.test(row.scriptName) ||
                      /sondzeit/i.test(row.scriptNumber);

                    return (
                      <tr
                        key={row.id}
                        className={`hover:bg-slate-800/40 transition-colors ${
                          hasTimes ? 'bg-sky-950/15' : row.hasHoliday ? 'bg-amber-950/10' : ''
                        }`}
                      >
                        {/* Script column */}
                        <td className="py-3 px-3.5 align-top whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${
                                isMainMod
                                  ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/40'
                                  : 'bg-slate-800 text-slate-200 border border-slate-700'
                              }`}
                            >
                              [{row.scriptNumber}]
                            </span>
                            <span className="font-sans font-medium text-slate-200">
                              {isMainMod
                                ? 'Main (Einstieg)'
                                : row.scriptName || `Skript ${row.scriptNumber}`}
                            </span>
                          </div>
                        </td>

                        {/* Step / Prio column */}
                        <td className="py-3 px-3.5 align-top whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {row.prio !== undefined && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700 tabular-nums">
                                Prio {row.prio}
                              </span>
                            )}
                            <span className="text-slate-300 font-sans text-[11px] truncate max-w-[160px]">
                              {row.stepName}
                            </span>
                          </div>
                        </td>

                        {/* Opening hours column with prominent time display */}
                        <td className="py-3 px-3.5 align-top">
                          <div className="flex items-start gap-1.5">
                            {hasTimes ? (
                              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-100 border border-sky-500/40 font-bold text-xs shadow-xs">
                                <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                <span className="tabular-nums font-mono text-[13px] tracking-tight text-sky-200">
                                  {cleanHours}
                                </span>
                                {isSondZeit && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/25 text-amber-200 border border-amber-500/35 uppercase font-medium">
                                    SondZeit
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 italic font-sans text-[11px]">
                                {cleanHours}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Holiday / Special status column */}
                        <td className="py-3 px-3.5 align-top">
                          {row.hasHoliday ? (
                            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-200 border border-amber-500/35 text-[11px]">
                              <Calendar className="w-3 h-3 text-amber-400 shrink-0" />
                              <span>{row.holidayAndSpecial}</span>
                            </div>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>

                        {/* Overflow / action column */}
                        <td className="py-3 px-3.5 align-top">
                          <div className="text-slate-300 text-[11px] font-sans break-words leading-relaxed">
                            {row.closedOrOverflowAction || '—'}
                          </div>
                        </td>

                        {/* Action jump button */}
                        <td className="py-3 px-3.5 align-top text-right whitespace-nowrap">
                          {onJumpToScript && (
                            <button
                              type="button"
                              onClick={() => {
                                onJumpToScript(row.scriptNumber);
                                onClose();
                              }}
                              title={`Skript [${row.scriptNumber}] im Callflow-Diagramm öffnen`}
                              className="px-2.5 py-1.5 bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-300 border border-slate-700 hover:border-indigo-500 rounded-lg text-[11px] font-sans font-medium transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                            >
                              <span>Im Diagramm</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 px-4 text-center border border-dashed border-slate-800 rounded-xl bg-slate-950/40 space-y-3">
              <Clock className="w-8 h-8 text-slate-600 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-300">
                  {searchQuery
                    ? `Keine Öffnungszeiten für „${searchQuery}“ gefunden`
                    : 'Keine Öffnungszeiten für den ausgewählten Filter'}
                </p>
                <p className="text-xs text-slate-500">
                  Versuchen Sie eine andere Suche oder wählen Sie den Filter „Alle“.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setFilter('all');
                }}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition-colors cursor-pointer"
              >
                Filter zurücksetzen
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/90 flex items-center justify-between gap-3 text-xs text-slate-400 font-mono shrink-0">
          <div>
            Zeige <span className="text-slate-200 font-bold tabular-nums">{filteredRows.length}</span> von{' '}
            <span className="text-slate-200 font-bold tabular-nums">{totalCount}</span> Zeitregeln
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-sans font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
              <span>CSV Exportieren</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-sans font-semibold transition-colors cursor-pointer shadow-sm"
            >
              Schließen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
