import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import {
  GlobalSearchCategory,
  GlobalSearchEntry,
} from '../utils/globalSearchEngine';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: GlobalSearchEntry[];
  onSelectEntry: (entry: GlobalSearchEntry) => void;
}

const CATEGORY_TABS: Array<{ id: 'all' | GlobalSearchCategory; label: string }> = [
  { id: 'all', label: 'Alle' },
  { id: 'script', label: 'Skripte' },
  { id: 'dnis', label: 'DNIS' },
  { id: 'queue', label: 'Queues' },
  { id: 'announcement', label: 'Ansagen' },
  { id: 'schedule', label: 'Zeiten' },
  { id: 'cdn', label: 'CDN' },
];

const CATEGORY_LABELS: Record<GlobalSearchCategory, string> = {
  script: 'Skript',
  dnis: 'DNIS',
  queue: 'Queue',
  announcement: 'Ansage',
  cdn: 'CDN',
  schedule: 'Zeitregel',
  node: 'Element',
};

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  entries,
  onSelectEntry,
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | GlobalSearchCategory>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    } else {
      setQuery('');
      setCategory('all');
    }
  }, [isOpen]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length };
    entries.forEach((e) => {
      counts[e.category] = (counts[e.category] || 0) + 1;
    });
    return counts;
  }, [entries]);

  const filtered = useMemo(() => {
    const tokens = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const list = entries.filter((e) => {
      if (category !== 'all' && e.category !== category) return false;
      if (tokens.length === 0) return true;
      return tokens.every((t) => e.searchText.includes(t));
    });

    // Prioritize title startsWith / exact match
    if (tokens.length > 0) {
      const q = tokens.join(' ');
      list.sort((a, b) => {
        const at = a.title.toLowerCase();
        const bt = b.title.toLowerCase();
        const aExact = at === q ? 0 : at.startsWith(q) ? 1 : at.includes(q) ? 2 : 3;
        const bExact = bt === q ? 0 : bt.startsWith(q) ? 1 : bt.includes(q) ? 2 : 3;
        if (aExact !== bExact) return aExact - bExact;
        return at.localeCompare(bt, 'de', { numeric: true });
      });
    }

    return list.slice(0, 120);
  }, [entries, query, category]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, category]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(Math.max(0, filtered.length - 1), prev + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'Enter' && filtered[activeIndex]) {
        e.preventDefault();
        onSelectEntry(filtered[activeIndex]);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, filtered, activeIndex, onSelectEntry, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-start justify-center pt-[10vh] px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[76vh] bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden shadow-2xl">
        {/* Search Input Row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Skript, DNIS/Rufnummer, Queue, Ansage, CDN oder Uhrzeit suchen..."
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <span className="hidden sm:inline text-[11px] font-mono text-slate-500 tabular-nums whitespace-nowrap shrink-0">
            {filtered.length} Treffer
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Globale Suche schließen"
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-slate-800 bg-slate-950/40 overflow-x-auto shrink-0">
          {CATEGORY_TABS.filter((t) => t.id === 'all' || (categoryCounts[t.id] || 0) > 0).map(
            (tab) => {
              const active = category === tab.id;
              const cnt = categoryCounts[tab.id] || 0;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategory(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {tab.label}{' '}
                  <span className="font-mono tabular-nums opacity-80">{cnt}</span>
                </button>
              );
            }
          )}
        </div>

        {/* Results List */}
        <div className="overflow-y-auto divide-y divide-slate-800/70 flex-1">
          {filtered.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-400">
              Keine Einträge für „{query || 'Auswahl'}“ gefunden.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === activeIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    onSelectEntry(item);
                    onClose();
                  }}
                  className={`w-full px-4 py-2.5 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                    isSelected ? 'bg-indigo-600/15' : 'hover:bg-slate-800/60'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-medium text-indigo-300 whitespace-nowrap">
                        {CATEGORY_LABELS[item.category]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate font-mono text-slate-100 text-[13px] font-semibold">
                        {item.title}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 truncate mt-0.5 tabular-nums">
                      {item.subtitle}
                      {item.meta ? ` · ${item.meta}` : ''}
                    </div>
                  </div>
                  <ArrowRight
                    className={`w-4 h-4 shrink-0 transition-opacity ${
                      isSelected ? 'text-indigo-300 opacity-100' : 'text-slate-500 opacity-50'
                    }`}
                  />
                </button>
              );
            })
          )}
        </div>

        {/* Quiet Keyboard Footer */}
        <div className="px-4 py-2 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <span>↑ ↓ Navigieren · Enter Öffnen · Esc Schließen</span>
          <span className="font-mono tabular-nums">Strg+K</span>
        </div>
      </div>
    </div>
  );
};
