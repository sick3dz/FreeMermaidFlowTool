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
  FileSpreadsheet,
  LayoutGrid,
  Table2,
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
  initialSearchQuery?: string;
  onJumpToScript?: (scriptNumber: string) => void;
}

interface ScheduleProfileGroup {
  key: string;
  title: string;
  category: 'hours' | 'sondzeit' | 'holiday' | 'always-open';
  rows: CallflowScheduleSummaryRow[];
  uniqueScripts: Array<{ scriptNumber: string; scriptName: string; isMaster: boolean }>;
  overflowActions: string[];
}

export const OpeningHoursModal: React.FC<OpeningHoursModalProps> = ({
  isOpen,
  onClose,
  workspace,
  initialSearchQuery = '',
  onJumpToScript,
}) => {
  const [viewMode, setViewMode] = useState<'overview' | 'table'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'with-hours' | 'holiday' | 'without-hours'>('all');
  const [copied, setCopied] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery(initialSearchQuery || '');
    setFilter('all');
    setViewMode(initialSearchQuery ? 'table' : 'overview');
  }, [isOpen, initialSearchQuery]);

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

  const allRows = useMemo(() => {
    if (!workspace || !workspace.modules || workspace.modules.length === 0) {
      return [];
    }
    return buildWorkspaceScheduleOverview(workspace);
  }, [workspace]);

  const totalCount = allRows.length;
  const withHoursCount = useMemo(() => allRows.filter((r) => r.hasSchedule).length, [allRows]);
  const holidayCount = useMemo(() => allRows.filter((r) => r.hasHoliday).length, [allRows]);
  const withoutHoursCount = useMemo(
    () => allRows.filter((r) => !r.hasSchedule && !r.hasHoliday).length,
    [allRows]
  );

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

  // Group filtered schedule rows into clean time-profile buckets for the Overview tab
  const profileGroups = useMemo<ScheduleProfileGroup[]>(() => {
    const map = new Map<string, ScheduleProfileGroup>();

    for (const row of filteredRows) {
      const cleanHours = (row.openingHours || '').replace(/:\s+/g, ':').trim();
      const isSondZeit =
        /sondzeit/i.test(cleanHours) ||
        /sondzeit/i.test(row.scriptName) ||
        /sondzeit/i.test(row.scriptNumber);

      let category: ScheduleProfileGroup['category'] = 'always-open';
      let title = 'Ohne feste Zeitbegrenzung (24/7)';

      if (row.hasSchedule && cleanHours) {
        category = isSondZeit ? 'sondzeit' : 'hours';
        title = cleanHours;
      } else if (row.hasHoliday) {
        category = 'holiday';
        title = row.holidayAndSpecial || 'Feiertags- & Sonderstatusprüfung';
      }

      const key = `${category}::${title.toLowerCase()}`;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          title,
          category,
          rows: [],
          uniqueScripts: [],
          overflowActions: [],
        };
        map.set(key, group);
      }

      group.rows.push(row);
      const sKey = canonicalScriptMatchKey(row.scriptNumber);
      if (!group.uniqueScripts.some((s) => canonicalScriptMatchKey(s.scriptNumber) === sKey)) {
        group.uniqueScripts.push({
          scriptNumber: row.scriptNumber,
          scriptName: row.scriptName,
          isMaster: Boolean(row.isMaster),
        });
      }
      const actionText = (row.closedOrOverflowAction || '').trim();
      if (actionText && actionText !== '—' && !group.overflowActions.includes(actionText)) {
        group.overflowActions.push(actionText);
      }
    }

    const order: Record<ScheduleProfileGroup['category'], number> = {
      hours: 0,
      sondzeit: 1,
      holiday: 2,
      'always-open': 3,
    };

    return Array.from(map.values()).sort((a, b) => {
      if (order[a.category] !== order[b.category]) {
        return order[a.category] - order[b.category];
      }
      return b.uniqueScripts.length - a.uniqueScripts.length;
    });
  }, [filteredRows]);

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

  const handleCopyMarkdown = useCallback(() => {
    if (allRows.length === 0) return;
    const header =
      '| Skript | Name | Prio / Schritt | Öffnungszeiten (SondZeit) | Feiertag / Sonderstatus | Aktion / Überlauf |\n|---|---|---|---|---|---|';
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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-xs overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col w-full max-w-6xl max-h-[86vh] my-auto overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0 space-y-0.5">
            <h2
              id="opening-hours-modal-title"
              className="text-base font-semibold text-slate-100 truncate"
            >
              Öffnungszeiten-Übersicht &amp; Zeitpläne
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400 font-mono tabular-nums">
              <span>{workspace.modules.length} Skripte</span>
              <span aria-hidden="true">·</span>
              <span className="text-sky-300">{withHoursCount} mit Zeiten</span>
              <span aria-hidden="true">·</span>
              <span className="text-amber-300">{holidayCount} Feiertagsprüfungen</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-300">{withoutHoursCount} 24/7</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Segmented Mode Switch: Overview vs Detailed Table */}
            <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setViewMode('overview')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'overview'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Zeitprofile</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>Detail-Tabelle</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Fenster schließen"
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toolbar: Segmented Filter + Search + Export */}
        <div className="px-5 py-3 border-b border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shrink-0 bg-slate-900">
          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg overflow-x-auto">
            {(
              [
                { id: 'all', label: `Alle (${totalCount})` },
                { id: 'with-hours', label: `Mit Zeiten (${withHoursCount})` },
                { id: 'holiday', label: `Feiertag (${holidayCount})` },
                { id: 'without-hours', label: `24/7 (${withoutHoursCount})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                  filter === tab.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 md:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Skript, Uhrzeit (08:00), Mo-Fr, SondZeit..."
                aria-label="Öffnungszeiten und Skripte durchsuchen"
                className="w-full pl-9 pr-8 py-1.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none font-mono"
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
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Kopiert</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Markdown</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadCsv}
              title="Öffnungszeiten als Excel CSV exportieren"
              className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Excel (.csv)</span>
            </button>
          </div>
        </div>

        {/* Main Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {filteredRows.length === 0 ? (
            <div className="py-12 px-4 text-center border border-dashed border-slate-800 rounded-xl bg-slate-950/40 space-y-3">
              <Clock className="w-8 h-8 text-slate-600 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-300">
                  {searchQuery
                    ? `Keine Öffnungszeiten für „${searchQuery}“ gefunden`
                    : 'Keine Öffnungszeiten für den ausgewählten Filter'}
                </p>
                <p className="text-xs text-slate-500">
                  Passen Sie den Suchbegriff an oder setzen Sie den Filter zurück.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setFilter('all');
                }}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                Filter zurücksetzen
              </button>
            </div>
          ) : viewMode === 'overview' ? (
            /* VIEW 1: GROUPED TIME PROFILES OVERVIEW */
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {profileGroups.map((group) => {
                const categoryLabel =
                  group.category === 'sondzeit'
                    ? 'SondZeit / CCMA-Tabelle'
                    : group.category === 'hours'
                    ? 'Feste Dienstzeit'
                    : group.category === 'holiday'
                    ? 'Feiertags- / Sonderprüfung'
                    : 'Durchgehend aktiv';

                const accentClass =
                  group.category === 'hours'
                    ? 'text-sky-300'
                    : group.category === 'sondzeit' || group.category === 'holiday'
                    ? 'text-amber-300'
                    : 'text-emerald-300';

                return (
                  <section
                    key={group.key}
                    className="p-4 rounded-xl bg-slate-950/75 border border-slate-800 flex flex-col gap-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          {group.category === 'holiday' ? (
                            <Calendar className={`w-3.5 h-3.5 ${accentClass} shrink-0`} />
                          ) : (
                            <Clock className={`w-3.5 h-3.5 ${accentClass} shrink-0`} />
                          )}
                          <span>{categoryLabel}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {group.uniqueScripts.length}{' '}
                            {group.uniqueScripts.length === 1 ? 'Skript' : 'Skripte'}
                          </span>
                        </div>
                        <h3 className={`text-sm font-semibold font-mono tabular-nums ${accentClass} break-words`}>
                          {group.title}
                        </h3>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery(
                            group.category === 'always-open' ? '' : group.title.slice(0, 24)
                          );
                          if (group.category === 'always-open') setFilter('without-hours');
                          setViewMode('table');
                        }}
                        className="text-[11px] text-slate-400 hover:text-indigo-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Als Tabelle →
                      </button>
                    </div>

                    {group.overflowActions.length > 0 && (
                      <div className="text-xs text-slate-400 leading-relaxed">
                        <span className="text-slate-300 font-medium">Bei Schließung / Überlauf:</span>{' '}
                        {group.overflowActions.slice(0, 2).join(' · ')}
                        {group.overflowActions.length > 2
                          ? ` (+${group.overflowActions.length - 2} weitere)`
                          : ''}
                      </div>
                    )}

                    <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-1.5">
                      {group.uniqueScripts.slice(0, 18).map((sc) => {
                        const isMainMod =
                          canonicalScriptMatchKey(sc.scriptNumber) === 'main' ||
                          (sc.isMaster && /^(?:main|start|master(?:script)?)$/i.test(sc.scriptNumber));
                        return (
                          <button
                            key={sc.scriptNumber}
                            type="button"
                            onClick={() => {
                              if (onJumpToScript) {
                                onJumpToScript(sc.scriptNumber);
                                onClose();
                              }
                            }}
                            title={`Skript [${sc.scriptNumber}] ${sc.scriptName} im Diagramm öffnen`}
                            className="px-2 py-1 rounded-md bg-slate-900 hover:bg-indigo-600/25 border border-slate-800 hover:border-indigo-500/60 text-xs text-slate-200 hover:text-indigo-100 transition-colors flex items-center gap-1.5 max-w-full cursor-pointer"
                          >
                            <span className="font-mono text-indigo-300 tabular-nums shrink-0">
                              [{sc.scriptNumber}]
                            </span>
                            <span className="truncate max-w-[160px]">
                              {isMainMod ? 'Main' : sc.scriptName || sc.scriptNumber}
                            </span>
                          </button>
                        );
                      })}
                      {group.uniqueScripts.length > 18 && (
                        <button
                          type="button"
                          onClick={() => setViewMode('table')}
                          className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200 font-mono tabular-nums cursor-pointer"
                        >
                          +{group.uniqueScripts.length - 18} weitere
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            /* VIEW 2: FULL FILTERABLE DETAIL TABLE */
            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/70">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950 text-slate-400 font-medium select-none sticky top-0 z-10">
                    <th className="py-3 px-3.5 whitespace-nowrap">Skript</th>
                    <th className="py-3 px-3.5 whitespace-nowrap">Regel / Schritt</th>
                    <th className="py-3 px-3.5 min-w-[220px]">Öffnungszeiten (SondZeit)</th>
                    <th className="py-3 px-3.5 min-w-[140px]">Feiertag / Sonderstatus</th>
                    <th className="py-3 px-3.5 min-w-[200px]">Aktion bei Schließung / Überlauf</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap">Diagramm</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredRows.map((row) => {
                    const isMainMod =
                      canonicalScriptMatchKey(row.scriptNumber) === 'main' ||
                      (row.isMaster &&
                        /^(?:main|start|master(?:script)?)$/i.test(row.scriptNumber));
                    const hasTimes = row.hasSchedule;
                    const cleanHours = (row.openingHours || '').replace(/:\s+/g, ':');

                    return (
                      <tr key={row.id} className="hover:bg-slate-800/35 transition-colors">
                        <td className="py-2.5 px-3.5 align-top whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-indigo-300 tabular-nums">
                              [{row.scriptNumber}]
                            </span>
                            <span className="text-slate-200 font-medium">
                              {isMainMod
                                ? 'Main (Einstieg)'
                                : row.scriptName || `Skript ${row.scriptNumber}`}
                            </span>
                          </div>
                        </td>

                        <td className="py-2.5 px-3.5 align-top whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {row.prio !== undefined && (
                              <span className="font-mono text-slate-400 tabular-nums">
                                P{row.prio}
                              </span>
                            )}
                            <span className="text-slate-300 truncate max-w-[170px]">
                              {row.stepName}
                            </span>
                          </div>
                        </td>

                        <td className="py-2.5 px-3.5 align-top">
                          {hasTimes ? (
                            <span className="font-mono font-semibold text-sky-300 tabular-nums">
                              {cleanHours}
                            </span>
                          ) : (
                            <span className="text-slate-400">{cleanHours}</span>
                          )}
                        </td>

                        <td className="py-2.5 px-3.5 align-top">
                          {row.hasHoliday ? (
                            <span className="text-amber-300">{row.holidayAndSpecial}</span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>

                        <td className="py-2.5 px-3.5 align-top text-slate-300 leading-relaxed">
                          {row.closedOrOverflowAction || '—'}
                        </td>

                        <td className="py-2.5 px-3.5 align-top text-right whitespace-nowrap">
                          {onJumpToScript && (
                            <button
                              type="button"
                              onClick={() => {
                                onJumpToScript(row.scriptNumber);
                                onClose();
                              }}
                              title={`Skript [${row.scriptNumber}] im Callflow-Diagramm öffnen`}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 hover:border-indigo-500 rounded-md text-xs font-medium transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <span>Öffnen</span>
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
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 shrink-0">
          <div className="font-mono tabular-nums">
            {viewMode === 'overview'
              ? `${profileGroups.length} Zeitprofile · ${filteredRows.length} Regeln`
              : `${filteredRows.length} von ${totalCount} Zeitregeln`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
              <span>CSV exportieren</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Schließen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
