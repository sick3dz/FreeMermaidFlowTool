import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  ChevronDown,
  Check,
  X,
  Layers,
  FileCode2,
  ArrowLeft,
  Clock,
  Sparkles,
} from 'lucide-react';
import { CallflowViewLevel, ScriptModule } from '../types/mermaidStudio';
import { canonicalScriptMatchKey, formatScriptDisplayLabel } from '../utils/scriptCallflowParser';

export interface SearchableScriptDropdownProps {
  viewLevel: CallflowViewLevel;
  modules: ScriptModule[];
  onSwitchViewLevel: (next: CallflowViewLevel) => void;
  /**
   * 'compact': For canvas top status ribbon / header (max width, single-line)
   * 'full': For inspector sidebar (full width container)
   */
  variant?: 'compact' | 'full';
  align?: 'left' | 'right';
  className?: string;
  placeholder?: string;
}

export const SearchableScriptDropdown: React.FC<SearchableScriptDropdownProps> = ({
  viewLevel,
  modules = [],
  onSwitchViewLevel,
  variant = 'compact',
  align = 'right',
  className = '',
  placeholder = 'Skript suchen (Nr., Name, SondZeit)...',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Identify currently active module (if in detail mode)
  const activeModule = useMemo(() => {
    if (viewLevel.level !== 'detail' || !viewLevel.scriptNumber) return null;
    const key = canonicalScriptMatchKey(viewLevel.scriptNumber);
    return modules.find(
      (m) =>
        canonicalScriptMatchKey(m.scriptNumber) === key ||
        (m.cdnAlias && canonicalScriptMatchKey(m.cdnAlias) === key)
    );
  }, [viewLevel, modules]);

  // Formatted label for current selection
  const currentSelectionLabel = useMemo(() => {
    if (viewLevel.level === 'welcome') {
      return variant === 'compact'
        ? 'Startseite · Ansicht wählen'
        : `Startseite · ${modules.length} Skripte bereit`;
    }
    if (viewLevel.level === 'master') {
      return variant === 'compact'
        ? 'Ebene 1: Master-Karte'
        : `Ebene 1: Master-Gesamtkarte (${modules.length} Skripte)`;
    }
    if (!activeModule) {
      return `Ebene 2: [${viewLevel.scriptNumber}]`;
    }
    const isMainMod =
      canonicalScriptMatchKey(activeModule.scriptNumber) === 'main' ||
      (activeModule.isMaster &&
        /^(?:main|start|master(?:script)?)$/i.test(activeModule.scriptNumber));
    if (isMainMod) {
      return 'Ebene 2: Main (Einstiegsskript)';
    }
    return `Ebene 2: ${formatScriptDisplayLabel(activeModule)}`;
  }, [viewLevel, activeModule, modules.length, variant]);

  // Filter modules based on query
  const filteredModules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return modules;

    return modules.filter((mod) => {
      const num = (mod.scriptNumber || '').toLowerCase();
      const name = (mod.scriptName || '').toLowerCase();
      const alias = (mod.cdnAlias || '').toLowerCase();
      const org = (mod.entryOrganizationName || '').toLowerCase();
      const visio = (mod.visioPageName || '').toLowerCase();
      const dnis = (mod.entryDnisNumbers || []).join(' ').toLowerCase();

      // Check for keywords like "sondzeit", "zeit", "notdienst", "überlauf"
      const isSondZeit =
        name.includes('sondzeit') ||
        num.includes('sondzeit') ||
        name.includes('zeit') ||
        name.includes('notdienst');

      if (q === 'sondzeit' || q === 'zeit' || q === 'öffnungszeit' || q === 'notdienst') {
        if (isSondZeit) return true;
      }

      if (num.includes(q)) return true;
      if (name.includes(q)) return true;
      if (alias.includes(q)) return true;
      if (org.includes(q)) return true;
      if (visio.includes(q)) return true;
      if (dnis.includes(q)) return true;

      // Also check canonical representation
      if (canonicalScriptMatchKey(mod.scriptNumber).includes(q)) return true;

      return false;
    });
  }, [modules, searchQuery]);

  // Check if Master entry matches search
  const showMasterOption = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      'master'.includes(q) ||
      'gesamt'.includes(q) ||
      'karte'.includes(q) ||
      'ebene 1'.includes(q) ||
      'einstieg'.includes(q) ||
      'alle'.includes(q)
    );
  }, [searchQuery]);

  // Total selectable items count: (1 if master shown) + filteredModules.length
  const totalItemCount = (showMasterOption ? 1 : 0) + filteredModules.length;

  // Auto-focus search input when opened
  useEffect(() => {
    if (isOpen) {
      setHighlightedIndex(0);
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('touchstart', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('touchstart', handleClickOutside, true);
    };
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % Math.max(1, totalItemCount));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + totalItemCount) % Math.max(1, totalItemCount));
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (showMasterOption && highlightedIndex === 0) {
          onSwitchViewLevel({ level: 'master' });
          setIsOpen(false);
          return;
        }

        const moduleIndex = showMasterOption ? highlightedIndex - 1 : highlightedIndex;
        const targetMod = filteredModules[moduleIndex];
        if (targetMod) {
          onSwitchViewLevel({ level: 'detail', scriptNumber: targetMod.scriptNumber });
          setIsOpen(false);
        }
      }
    },
    [isOpen, highlightedIndex, totalItemCount, showMasterOption, filteredModules, onSwitchViewLevel]
  );

  // Auto-scroll highlighted option into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const highlightedEl = listRef.current.querySelector<HTMLElement>(
      `[data-option-index="${highlightedIndex}"]`
    );
    if (highlightedEl) {
      highlightedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, isOpen]);

  return (
    <div
      ref={containerRef}
      className={`relative inline-block text-left ${
        variant === 'full' ? 'w-full' : 'max-w-[280px] sm:max-w-[320px]'
      } ${className}`}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger Button */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Skript oder Ebene wählen (mit Suche)"
        className={`flex items-center justify-between gap-1.5 transition-colors cursor-pointer select-none font-mono ${
          variant === 'full'
            ? 'w-full px-2.5 py-1.5 text-xs bg-slate-900 hover:bg-slate-850 border border-slate-700 hover:border-slate-600 rounded-lg text-slate-100 shadow-sm'
            : 'w-full px-2 py-1 text-[11px] bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-md text-slate-200 shadow-xs'
        } ${isOpen ? 'border-indigo-500 ring-1 ring-indigo-500/50' : ''}`}
      >
        <div className="flex items-center gap-1.5 min-w-0 truncate">
          {viewLevel.level === 'welcome' ? (
            <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : viewLevel.level === 'master' ? (
            <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          ) : (
            <FileCode2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          )}
          <span className="truncate font-medium">{currentSelectionLabel}</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-indigo-400' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu Popover */}
      {isOpen && (
        <div
          role="listbox"
          className={`absolute mt-1.5 z-50 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl backdrop-blur-md overflow-hidden flex flex-col ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${
            variant === 'full'
              ? 'w-full min-w-[280px]'
              : 'w-80 sm:w-96 min-w-[280px] max-w-[calc(100vw-32px)]'
          }`}
          style={{ maxHeight: '420px' }}
        >
          {/* Search Header */}
          <div className="p-2 border-b border-slate-800 bg-slate-950/70">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setHighlightedIndex(0);
                }}
                placeholder={placeholder}
                aria-label="Skripte durchsuchen"
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none font-mono"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  title="Suche leeren"
                  className="absolute right-2 p-0.5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] text-slate-400 font-mono">
              <span>
                {filteredModules.length} von {modules.length} Skripte
              </span>
              <span className="text-slate-500">↑↓ Navigieren · ↵ Auswählen</span>
            </div>
          </div>

          {/* List Options */}
          <div ref={listRef} className="overflow-y-auto max-h-[300px] p-1.5 space-y-1">
            {/* Option: Master Gesamtkarte (Ebene 1) */}
            {showMasterOption && (
              <div
                role="option"
                aria-selected={viewLevel.level === 'master'}
                data-option-index={0}
                onClick={() => {
                  onSwitchViewLevel({ level: 'master' });
                  setIsOpen(false);
                }}
                onMouseEnter={() => setHighlightedIndex(0)}
                className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-xs font-mono select-none ${
                  viewLevel.level === 'master'
                    ? 'bg-indigo-950/70 text-indigo-100 border border-indigo-500/40'
                    : highlightedIndex === 0
                    ? 'bg-slate-800 text-slate-100 border border-transparent'
                    : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`p-1 rounded-md ${
                      viewLevel.level === 'master'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-indigo-400'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                      <span>Ebene 1: Master-Gesamtkarte</span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        Übersicht
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      Vollständige Karte aller {modules.length} Skripte mit Querverbindungen
                    </div>
                  </div>
                </div>
                {viewLevel.level === 'master' && (
                  <Check className="w-4 h-4 text-indigo-400 shrink-0 ml-2" />
                )}
              </div>
            )}

            {/* Separator / Section Header */}
            {filteredModules.length > 0 && (
              <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wider text-slate-500 uppercase font-mono flex items-center justify-between">
                <span>Ebene 2: Teilskripte ({filteredModules.length})</span>
                {searchQuery && <span className="text-amber-400/80">Gefiltert</span>}
              </div>
            )}

            {/* Filtered Module Items */}
            {filteredModules.map((mod, idx) => {
              const optionIndex = showMasterOption ? idx + 1 : idx;
              const isSelected =
                viewLevel.level === 'detail' &&
                canonicalScriptMatchKey(viewLevel.scriptNumber) ===
                  canonicalScriptMatchKey(mod.scriptNumber);
              const isHighlighted = highlightedIndex === optionIndex;

              const isMainMod =
                canonicalScriptMatchKey(mod.scriptNumber) === 'main' ||
                (mod.isMaster &&
                  /^(?:main|start|master(?:script)?)$/i.test(mod.scriptNumber));

              const isSondZeit =
                /sondzeit|zeit|notdienst/i.test(mod.scriptName || '') ||
                /sondzeit|zeit|notdienst/i.test(mod.scriptNumber || '');

              const cleanName = (mod.scriptName || '').trim();
              const hasDistinctName =
                cleanName &&
                canonicalScriptMatchKey(cleanName) !==
                  canonicalScriptMatchKey(mod.scriptNumber) &&
                cleanName !== `Skript ${mod.scriptNumber}` &&
                cleanName !== 'Main (Masterscript)';

              return (
                <div
                  key={mod.scriptNumber}
                  role="option"
                  aria-selected={isSelected}
                  data-option-index={optionIndex}
                  onClick={() => {
                    onSwitchViewLevel({ level: 'detail', scriptNumber: mod.scriptNumber });
                    setIsOpen(false);
                  }}
                  onMouseEnter={() => setHighlightedIndex(optionIndex)}
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-xs font-mono select-none ${
                    isSelected
                      ? 'bg-amber-950/60 text-amber-100 border border-amber-500/40'
                      : isHighlighted
                      ? 'bg-slate-800 text-slate-100 border border-transparent'
                      : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className={`p-1 rounded-md shrink-0 ${
                        isSelected
                          ? 'bg-amber-600 text-white'
                          : isMainMod
                          ? 'bg-indigo-900/60 text-indigo-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <FileCode2 className="w-3.5 h-3.5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate">
                        <span
                          className={`font-semibold shrink-0 px-1 py-0.5 rounded text-[10px] ${
                            isMainMod
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              : 'bg-slate-800 text-slate-200 border border-slate-700'
                          }`}
                        >
                          [{mod.scriptNumber}]
                        </span>
                        <span className="font-medium text-slate-200 truncate">
                          {isMainMod
                            ? 'Main (Einstiegsskript)'
                            : hasDistinctName
                            ? cleanName
                            : `Skript ${mod.scriptNumber}`}
                        </span>

                        {isSondZeit && (
                          <span
                            title="Öffnungszeiten / SondZeit Skript"
                            className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0"
                          >
                            <Clock className="w-2.5 h-2.5" />
                            <span>Zeit</span>
                          </span>
                        )}

                        {mod.cdnAlias && (
                          <span
                            title={`CDN Alias: ${mod.cdnAlias}`}
                            className="text-[9px] text-slate-400 font-normal truncate"
                          >
                            ({mod.cdnAlias})
                          </span>
                        )}
                      </div>

                      <div className="text-[10px] text-slate-400 truncate flex items-center gap-2 mt-0.5">
                        <span>{mod.rules?.length || 0} Regeln</span>
                        {mod.outgoingNumbers?.length > 0 && (
                          <>
                            <span className="text-slate-600">·</span>
                            <span>{mod.outgoingNumbers.length} Absprünge</span>
                          </>
                        )}
                        {mod.entryOrganizationName && (
                          <>
                            <span className="text-slate-600">·</span>
                            <span className="text-slate-300 truncate">
                              {mod.entryOrganizationName}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {isSelected && <Check className="w-4 h-4 text-amber-400 shrink-0 ml-2" />}
                </div>
              );
            })}

            {/* Empty Search Result */}
            {filteredModules.length === 0 && !showMasterOption && (
              <div className="py-6 px-3 text-center text-slate-400 text-xs font-mono space-y-2">
                <p>Kein Skript gefunden für „{searchQuery}“</p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] cursor-pointer"
                  >
                    Suche zurücksetzen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSwitchViewLevel({ level: 'master' });
                      setIsOpen(false);
                    }}
                    className="px-2.5 py-1 bg-indigo-950 hover:bg-indigo-900 border border-indigo-700 text-indigo-200 rounded text-[11px] cursor-pointer"
                  >
                    Zur Master-Karte
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quick Back to Master footer if currently in detail mode */}
          {viewLevel.level === 'detail' && (
            <div className="p-2 border-t border-slate-800 bg-slate-950/60">
              <button
                type="button"
                onClick={() => {
                  onSwitchViewLevel({ level: 'master' });
                  setIsOpen(false);
                }}
                className="w-full py-1.5 px-3 bg-indigo-950/60 hover:bg-indigo-900/60 border border-indigo-500/40 text-indigo-200 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer font-mono"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Zurück zur Master-Gesamtkarte (Ebene 1)</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
