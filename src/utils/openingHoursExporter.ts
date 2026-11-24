import JSZip from 'jszip';
import {
  CallflowScheduleSummaryRow,
  ConsolidatedScriptScheduleRow,
  HolidayRuleSummary,
  OpeningHoursCategory,
  OpeningHoursExportBundle,
  OpeningHoursExportOptions,
  ScriptWorkspace,
  SondZeitProfileSummary,
  WeekdayKey,
  WeekdayScheduleMatrix,
} from '../types/mermaidStudio';

export const WEEKDAY_KEYS: readonly WeekdayKey[] = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

const DAY_INDEX_BY_TOKEN: Record<string, number> = {
  mo: 0,
  mon: 0,
  montag: 0,
  monday: 0,
  di: 1,
  die: 1,
  tue: 1,
  tues: 1,
  dienstag: 1,
  tuesday: 1,
  mi: 2,
  mit: 2,
  wed: 2,
  mittwoch: 2,
  wednesday: 2,
  do: 3,
  don: 3,
  thu: 3,
  thur: 3,
  thurs: 3,
  donnerstag: 3,
  thursday: 3,
  fr: 4,
  fre: 4,
  fri: 4,
  freitag: 4,
  friday: 4,
  sa: 5,
  sam: 5,
  sat: 5,
  samstag: 5,
  saturday: 5,
  so: 6,
  son: 6,
  sun: 6,
  sonntag: 6,
  sunday: 6,
};

const DAY_TOKEN_PATTERN =
  '(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Werktags|Wochenende|Täglich|Taeglich|Alle\\s+Tage|Daily|Mo|Di|Mi|Do|Fr|Sa|So|Mon|Tue|Wed|Thu|Fri|Sat|Sun)';

export const OPENING_HOURS_CATEGORY_LABELS: Record<OpeningHoursCategory, string> = {
  hours: 'Feste Dienstzeit',
  sondzeit: 'SondZeit-Plan',
  holiday: 'Feiertag / Sonderstatus',
  'always-open': '24/7 (Ohne Zeitplan)',
};

export const OPENING_HOURS_CSV_HEADERS: readonly string[] = [
  'Skript-Nr.',
  'Skript-Name',
  'Kategorie',
  'Mo',
  'Di',
  'Mi',
  'Do',
  'Fr',
  'Sa',
  'So',
  'SondZeit / Quelle',
  'Feiertag / Sonderstatus',
  'Überlauf / Ansage / Ziel',
] as const;

export function createEmptyWeekdayMatrix(fill = '—'): WeekdayScheduleMatrix {
  return {
    Mo: fill,
    Di: fill,
    Mi: fill,
    Do: fill,
    Fr: fill,
    Sa: fill,
    So: fill,
  };
}

function padTwoDigits(n: string): string {
  return n.length === 1 ? `0${n}` : n;
}

function normalizeClockText(raw: string): string {
  return (raw || '')
    .replace(/(\d{1,2})\s*:\s*(\d{2})(?::\d{2})?/g, (_, h: string, m: string) => `${padTwoDigits(h)}:${m}`)
    .replace(/\s*[–—-]\s*/g, (match) => (match.includes('–') || match.includes('-') ? '–' : match))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeScriptKey(scriptNumber: string): string {
  return String(scriptNumber || '').trim().toLowerCase();
}

function compareNaturalScriptNumbers(a: string, b: string): number {
  const aLow = a.toLowerCase();
  const bLow = b.toLowerCase();
  if (aLow === 'main' && bLow !== 'main') return -1;
  if (bLow === 'main' && aLow !== 'main') return 1;
  return a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
}

interface ParsedDaySlotsResult {
  slots: Record<WeekdayKey, string[]>;
  hasConcreteTimes: boolean;
  hasExplicitDays: boolean;
  is247: boolean;
}

function expandDayRange(startIdx: number, endIdx: number): number[] {
  const out: number[] = [];
  if (startIdx <= endIdx) {
    for (let i = startIdx; i <= endIdx; i++) out.push(i);
  } else {
    for (let i = startIdx; i < 7; i++) out.push(i);
    for (let i = 0; i <= endIdx; i++) out.push(i);
  }
  return out;
}

function extractDayIndicesFromSegment(segment: string): number[] {
  const found = new Set<number>();
  const s = segment || '';

  if (/\b(?:täglich|taeglich|alle\s+tage|daily)\b/i.test(s)) {
    for (let i = 0; i < 7; i++) found.add(i);
  }
  if (/\bwerktags\b/i.test(s)) {
    for (let i = 0; i <= 4; i++) found.add(i);
  }
  if (/\bwochenende\b/i.test(s)) {
    found.add(5);
    found.add(6);
  }

  // Range expressions like Mo–Do, Mo-Fr, Monday..Friday, Sa bis So
  const rangeRe = new RegExp(
    `\\b(${DAY_TOKEN_PATTERN})\\s*(?:–|-|\\.\\.|bis|to)\\s*(${DAY_TOKEN_PATTERN})\\b`,
    'gi'
  );
  let consumed = s;
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(s)) !== null) {
    const startIdx = DAY_INDEX_BY_TOKEN[m[1].toLowerCase()];
    const endIdx = DAY_INDEX_BY_TOKEN[m[2].toLowerCase()];
    if (startIdx !== undefined && endIdx !== undefined) {
      expandDayRange(startIdx, endIdx).forEach((idx) => found.add(idx));
      consumed = consumed.replace(m[0], ' ');
    }
  }

  // Standalone day tokens
  const singleRe = new RegExp(`\\b(${DAY_TOKEN_PATTERN})\\b`, 'gi');
  while ((m = singleRe.exec(consumed)) !== null) {
    const idx = DAY_INDEX_BY_TOKEN[m[1].toLowerCase()];
    if (idx !== undefined) {
      found.add(idx);
    }
  }

  return Array.from(found).sort((a, b) => a - b);
}

function extractTimeWindowsFromSegment(segment: string): string[] {
  const windows: string[] = [];
  const normalized = (segment || '')
    .replace(/(\d{1,2})\s*:\s*(\d{2})(?::\d{2})?/g, (_, h: string, m: string) => `${padTwoDigits(h)}:${m}`)
    .replace(/(\d{1,2}:\d{2})\s*(?:–|—|-|\.\.|bis|to)\s*(\d{1,2}:\d{2})/gi, '$1–$2');

  const rangeRe = /\b(\d{2}:\d{2}–\d{2}:\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(normalized)) !== null) {
    if (!windows.includes(m[1])) windows.push(m[1]);
  }

  if (windows.length === 0) {
    const cmpRe = /\b((?:vor|ab|bis|nach)\s+\d{2}:\d{2}(?:\s*Uhr)?)\b/gi;
    while ((m = cmpRe.exec(normalized)) !== null) {
      const cleaned = m[1].replace(/\s+/g, ' ').trim();
      if (!windows.includes(cleaned)) windows.push(cleaned);
    }
  }

  return windows;
}

/**
 * Parses a single schedule text into per-weekday time window arrays without yet filling
 * untouched days with "Geschlossen" (so multiple rules of one script can be merged first).
 */
export function parseScheduleTextToDaySlots(
  openingHoursText: string,
  hasSchedule: boolean,
  fallbackWeekdays?: string,
  fallbackClockTimes?: string
): ParsedDaySlotsResult {
  const slots: Record<WeekdayKey, string[]> = {
    Mo: [],
    Di: [],
    Mi: [],
    Do: [],
    Fr: [],
    Sa: [],
    So: [],
  };

  const cleanRaw = (openingHoursText || '').replace(/(\d{1,2})\s*:\s*(\d{2})(?::\d{2})?/g, '$1:$2').trim();

  if (!hasSchedule) {
    const is247 = /24\/7|keine\s+zeitbeschr/i.test(cleanRaw);
    if (is247) {
      WEEKDAY_KEYS.forEach((d) => slots[d].push('24/7'));
    }
    return {
      slots,
      hasConcreteTimes: is247,
      hasExplicitDays: false,
      is247,
    };
  }

  // Strip trailing parenthetical reference like "(SondZeit_Mo_Fr_08_17)" if concrete text precedes it
  let core = cleanRaw;
  const trailingParen = cleanRaw.match(/^(.*?)\s*\(([A-Za-z0-9_.-]+)\)$/);
  if (trailingParen && trailingParen[1].trim().length > 0) {
    core = trailingParen[1].trim();
  }

  // Explicitly 24/7 schedule
  if (/\b24\/7\b/i.test(core) && !/\b\d{1,2}:\d{2}\b/.test(core)) {
    WEEKDAY_KEYS.forEach((d) => slots[d].push('24/7'));
    return {
      slots,
      hasConcreteTimes: true,
      hasExplicitDays: false,
      is247: true,
    };
  }

  // Split only before a weekday token so "Mo-Fr 08:00-12:00, 13:00-17:00" stays one segment
  const segSplitRe = new RegExp(`\\s*(?:,|;|·|\\|)\\s*(?=${DAY_TOKEN_PATTERN}\\b)`, 'i');
  const segments = core
    .split(segSplitRe)
    .map((s) => s.trim())
    .filter(Boolean);

  let hasConcreteTimes = false;
  let hasExplicitDays = false;

  for (const seg of segments) {
    const dayIndices = extractDayIndicesFromSegment(seg);
    const windows = extractTimeWindowsFromSegment(seg);

    if (dayIndices.length > 0 && windows.length > 0) {
      hasConcreteTimes = true;
      if (dayIndices.length < 7) {
        hasExplicitDays = true;
      }
      for (const idx of dayIndices) {
        const key = WEEKDAY_KEYS[idx];
        for (const w of windows) {
          if (!slots[key].includes(w)) slots[key].push(w);
        }
      }
    } else if (windows.length > 0) {
      // Clock windows without explicit day restriction inside this segment
      const fallbackDays = fallbackWeekdays ? extractDayIndicesFromSegment(fallbackWeekdays) : [];
      const targetDays = fallbackDays.length > 0 ? fallbackDays : [0, 1, 2, 3, 4, 5, 6];
      hasConcreteTimes = true;
      if (fallbackDays.length > 0 && fallbackDays.length < 7) {
        hasExplicitDays = true;
      }
      for (const idx of targetDays) {
        const key = WEEKDAY_KEYS[idx];
        for (const w of windows) {
          if (!slots[key].includes(w)) slots[key].push(w);
        }
      }
    }
  }

  // Secondary fallback using explicit clockTimes/weekdays fields if core text was non-standard
  if (!hasConcreteTimes && fallbackClockTimes && /\d{1,2}:\d{2}/.test(fallbackClockTimes)) {
    const fallbackSegs = fallbackClockTimes
      .split(segSplitRe)
      .map((s) => s.trim())
      .filter(Boolean);
    const defaultDays = fallbackWeekdays ? extractDayIndicesFromSegment(fallbackWeekdays) : [];
    for (const seg of fallbackSegs) {
      const segDays = extractDayIndicesFromSegment(seg);
      const windows = extractTimeWindowsFromSegment(seg);
      const targetDays =
        segDays.length > 0 ? segDays : defaultDays.length > 0 ? defaultDays : [0, 1, 2, 3, 4, 5, 6];
      if (windows.length > 0) {
        hasConcreteTimes = true;
        if (targetDays.length < 7) hasExplicitDays = true;
        for (const idx of targetDays) {
          const key = WEEKDAY_KEYS[idx];
          for (const w of windows) {
            if (!slots[key].includes(w)) slots[key].push(w);
          }
        }
      }
    }
  }

  return {
    slots,
    hasConcreteTimes,
    hasExplicitDays,
    is247: false,
  };
}

/**
 * Finalizes merged day slots of a single script into the clean 7-column Mo–So matrix.
 * Conservative rule: untouched days become "Geschlossen" ONLY when explicit weekday-scoped
 * concrete clock times exist; unresolved SondZeit/holiday-only entries stay "—".
 */
export function finalizeWeekdayMatrix(
  mergedSlots: Record<WeekdayKey, string[]>,
  options: {
    hasConcreteTimes: boolean;
    hasExplicitDays: boolean;
    isAlwaysOpen: boolean;
  }
): WeekdayScheduleMatrix {
  if (options.isAlwaysOpen && !options.hasConcreteTimes) {
    return createEmptyWeekdayMatrix('24/7');
  }

  const matrix = createEmptyWeekdayMatrix('—');
  const anyDayFilled = WEEKDAY_KEYS.some((d) => mergedSlots[d].length > 0);

  if (!anyDayFilled) {
    return matrix;
  }

  for (const day of WEEKDAY_KEYS) {
    const vals = mergedSlots[day];
    if (vals.length > 0) {
      // Remove redundant '24/7' if concrete clock times also exist on that day
      const concrete = vals.filter((v) => v !== '24/7');
      matrix[day] = (concrete.length > 0 ? concrete : vals).join(', ');
    } else if (options.hasConcreteTimes && options.hasExplicitDays) {
      matrix[day] = 'Geschlossen';
    } else {
      matrix[day] = '—';
    }
  }

  return matrix;
}

/**
 * Convenience helper for single schedule string -> finalized Mo–So matrix.
 */
export function parseScheduleToWeekdayMatrix(
  openingHoursText: string,
  hasSchedule: boolean,
  fallbackWeekdays?: string,
  fallbackClockTimes?: string
): WeekdayScheduleMatrix {
  const parsed = parseScheduleTextToDaySlots(
    openingHoursText,
    hasSchedule,
    fallbackWeekdays,
    fallbackClockTimes
  );
  return finalizeWeekdayMatrix(parsed.slots, {
    hasConcreteTimes: parsed.hasConcreteTimes,
    hasExplicitDays: parsed.hasExplicitDays,
    isAlwaysOpen: parsed.is247 || (!hasSchedule && /24\/7|keine\s+zeitbeschr/i.test(openingHoursText)),
  });
}

/**
 * Formats a finalized Mo–So matrix into a concise human-readable summary string,
 * grouping consecutive days with identical hours (e.g. "Mo–Do 08:00–17:00 · Fr 08:00–15:00").
 */
export function buildCompactScheduleSummaryFromMatrix(
  days: WeekdayScheduleMatrix,
  fallbackText?: string
): string {
  const vals = WEEKDAY_KEYS.map((d) => days[d]);
  if (vals.every((v) => v === '24/7')) {
    return '24/7 (Mo–So durchgehend)';
  }
  const activeIndices = WEEKDAY_KEYS.map((d, i) => ({ d, i, v: days[d] })).filter(
    (x) => x.v && x.v !== '—' && x.v !== 'Geschlossen'
  );
  if (activeIndices.length === 0) {
    return fallbackText ? normalizeClockText(fallbackText) : '—';
  }
  if (activeIndices.length === 7 && activeIndices.every((x) => x.v === activeIndices[0].v)) {
    return `Mo–So ${activeIndices[0].v}`;
  }

  const runs: Array<{ start: number; end: number; value: string }> = [];
  for (const item of activeIndices) {
    const prev = runs[runs.length - 1];
    if (prev && prev.value === item.v && prev.end === item.i - 1) {
      prev.end = item.i;
    } else {
      runs.push({ start: item.i, end: item.i, value: item.v });
    }
  }

  return runs
    .map((r) => {
      const dayLabel =
        r.start === r.end
          ? WEEKDAY_KEYS[r.start]
          : r.end === r.start + 1
          ? `${WEEKDAY_KEYS[r.start]}, ${WEEKDAY_KEYS[r.end]}`
          : `${WEEKDAY_KEYS[r.start]}–${WEEKDAY_KEYS[r.end]}`;
      return `${dayLabel} ${r.value}`;
    })
    .join(' · ');
}

/**
 * Deduplicates and compacts overflow / announcement / queue / target strings across rules.
 */
export function bundleOverflowActions(rawActions: string[]): string {
  const queues: string[] = [];
  const announcements: string[] = [];
  const targets: string[] = [];
  const others: string[] = [];
  let hasDisconnect = false;

  const pushUnique = (list: string[], val: string) => {
    const cleaned = val.trim();
    if (!cleaned || cleaned === '—') return;
    if (!list.some((x) => x.toLowerCase() === cleaned.toLowerCase())) {
      list.push(cleaned);
    }
  };

  for (const raw of rawActions) {
    if (!raw || raw.trim() === '—') continue;
    const chunks = raw
      .split(/\s*·\s*/)
      .map((c) => c.trim())
      .filter(Boolean);

    for (const chunk of chunks) {
      if (/^standard-folgeschritt$/i.test(chunk) || chunk === '—') continue;
      if (/^anruf\s+trennen$/i.test(chunk)) {
        hasDisconnect = true;
        continue;
      }
      const qMatch = chunk.match(/^Queue:\s*(.+)$/i);
      if (qMatch) {
        qMatch[1].split(',').forEach((item) => pushUnique(queues, item));
        continue;
      }
      const aMatch = chunk.match(/^Ansage:\s*(.+)$/i);
      if (aMatch) {
        aMatch[1].split(',').forEach((item) => pushUnique(announcements, item));
        continue;
      }
      const tMatch = chunk.match(/^(?:Wohin|Ziele|Ziel):\s*(.+)$/i);
      if (tMatch) {
        tMatch[1].split(',').forEach((item) => pushUnique(targets, item));
        continue;
      }
      pushUnique(others, chunk);
    }
  }

  const parts: string[] = [];
  if (queues.length > 0) parts.push(`Queue: ${queues.join(', ')}`);
  if (announcements.length > 0) parts.push(`Ansage: ${announcements.join(', ')}`);
  if (targets.length > 0) parts.push(`Ziel: ${targets.join(', ')}`);
  if (hasDisconnect) parts.push('Anruf trennen');
  if (others.length > 0) parts.push(...others);

  return parts.length > 0 ? parts.join(' · ') : '—';
}

function isSondZeitRow(row: CallflowScheduleSummaryRow): boolean {
  return (
    /sondzeit/i.test(row.scheduleSource || '') ||
    /sondzeit/i.test(row.openingHours || '') ||
    /sondzeit/i.test(row.scriptName || '') ||
    /sondzeit/i.test(row.scriptNumber || '')
  );
}

/**
 * Consolidates raw CallflowScheduleSummaryRow items into a clean, deduplicated
 * 1-row-per-script OpeningHoursExportBundle with Mo–So weekday matrices,
 * dedicated SondZeit & Holiday summaries, 24/7 separation, and clean detail rows.
 */
export function buildOpeningHoursExportBundleFromRows(
  rawRows: CallflowScheduleSummaryRow[],
  options?: { diagramTitle?: string; generatedAt?: string }
): OpeningHoursExportBundle {
  const generatedAt = options?.generatedAt || new Date().toISOString().slice(0, 10);

  // 1. Deduplicate identical raw detail rows
  const seenDetailKeys = new Set<string>();
  const dedupedDetailRows: CallflowScheduleSummaryRow[] = [];
  for (const row of rawRows || []) {
    const key = [
      normalizeScriptKey(row.scriptNumber),
      row.prio ?? '',
      (row.stepName || '').trim().toLowerCase(),
      normalizeClockText(row.openingHours || '').toLowerCase(),
      (row.holidayAndSpecial || '').trim().toLowerCase(),
      (row.closedOrOverflowAction || '').trim().toLowerCase(),
    ].join('|');
    if (seenDetailKeys.has(key)) continue;
    seenDetailKeys.add(key);
    dedupedDetailRows.push(row);
  }

  // 2. Group all rules by scriptNumber (1 consolidated matrix row per script)
  const byScript = new Map<string, CallflowScheduleSummaryRow[]>();
  for (const row of dedupedDetailRows) {
    const key = normalizeScriptKey(row.scriptNumber);
    const list = byScript.get(key);
    if (list) {
      list.push(row);
    } else {
      byScript.set(key, [row]);
    }
  }

  const consolidatedAll: ConsolidatedScriptScheduleRow[] = [];

  for (const [, scriptRows] of byScript.entries()) {
    const primary = scriptRows[0];
    const mergedSlots: Record<WeekdayKey, string[]> = {
      Mo: [],
      Di: [],
      Mi: [],
      Do: [],
      Fr: [],
      Sa: [],
      So: [],
    };
    let hasConcreteTimes = false;
    let hasExplicitDays = false;
    let hasAnySchedule = false;
    let hasAnyHoliday = false;
    let hasAnySondZeit = false;
    let sawExplicit247 = false;

    const sondZeitSources: string[] = [];
    const holidayConditions: string[] = [];
    const rawScheduleFallbacks: string[] = [];
    const overflowInputs: string[] = [];

    const addUnique = (arr: string[], val: string) => {
      const cleaned = val.trim();
      if (!cleaned || cleaned === '—') return;
      if (!arr.some((x) => x.toLowerCase() === cleaned.toLowerCase())) {
        arr.push(cleaned);
      }
    };

    for (const r of scriptRows) {
      if (r.hasSchedule) hasAnySchedule = true;
      if (r.hasHoliday) hasAnyHoliday = true;
      if (isSondZeitRow(r)) hasAnySondZeit = true;

      if (r.scheduleSource && !/^24\/7/i.test(r.scheduleSource)) {
        addUnique(sondZeitSources, r.scheduleSource);
      } else if (r.openingHours) {
        const parenRef = r.openingHours.match(/\(([A-Za-z0-9_.-]+)\)\s*$/);
        if (parenRef && /sondzeit|zeit|plan/i.test(parenRef[1])) {
          addUnique(sondZeitSources, parenRef[1]);
        }
      }

      if (r.hasHoliday && r.holidayAndSpecial && r.holidayAndSpecial !== '—') {
        addUnique(holidayConditions, r.holidayAndSpecial);
      }

      if (r.hasSchedule && r.openingHours && !/^—/.test(r.openingHours.trim())) {
        addUnique(rawScheduleFallbacks, r.openingHours);
      }

      if (r.closedOrOverflowAction && r.closedOrOverflowAction !== '—') {
        overflowInputs.push(r.closedOrOverflowAction);
      }

      const parsed = parseScheduleTextToDaySlots(
        r.openingHours || '',
        r.hasSchedule,
        r.weekdays,
        r.clockTimes
      );

      if (parsed.is247) {
        sawExplicit247 = true;
      } else if (parsed.hasConcreteTimes) {
        hasConcreteTimes = true;
        if (parsed.hasExplicitDays) hasExplicitDays = true;
        for (const day of WEEKDAY_KEYS) {
          for (const w of parsed.slots[day]) {
            if (!mergedSlots[day].includes(w)) {
              mergedSlots[day].push(w);
            }
          }
        }
      }
    }

    const isAlwaysOpen = !hasAnySchedule && !hasAnyHoliday;
    const isExplicit247Schedule = hasAnySchedule && !hasConcreteTimes && sawExplicit247;

    let category: OpeningHoursCategory = 'always-open';
    if (hasAnySchedule && hasAnySondZeit) {
      category = 'sondzeit';
    } else if (hasAnySchedule) {
      category = 'hours';
    } else if (hasAnyHoliday) {
      category = 'holiday';
    }

    const days = finalizeWeekdayMatrix(mergedSlots, {
      hasConcreteTimes,
      hasExplicitDays,
      isAlwaysOpen: isAlwaysOpen || isExplicit247Schedule,
    });

    // Clean source list: prefer concrete SondZeit names over generic "Direkt im Skript"
    const concreteNamedSources = sondZeitSources.filter(
      (s) => !/^direkt im skript$/i.test(s) && !/^24\/7/i.test(s)
    );
    const sondZeitSource =
      concreteNamedSources.length > 0
        ? concreteNamedSources.join(', ')
        : hasAnySchedule
        ? 'Direkt im Skript'
        : isAlwaysOpen
        ? 'Ohne Zeitbegrenzung'
        : '—';

    const compactScheduleSummary = buildCompactScheduleSummaryFromMatrix(
      days,
      rawScheduleFallbacks[0] || (hasAnyHoliday ? 'Nur Feiertags-/Sonderprüfung' : '24/7 (Ohne Zeitplan)')
    );

    consolidatedAll.push({
      scriptNumber: primary.scriptNumber,
      scriptName: primary.scriptName || primary.scriptNumber,
      isMaster: Boolean(primary.isMaster),
      category,
      categoryLabel: OPENING_HOURS_CATEGORY_LABELS[category],
      days,
      compactScheduleSummary,
      sondZeitSource,
      holidaySummary: holidayConditions.length > 0 ? holidayConditions.join(' · ') : '—',
      overflowSummary: bundleOverflowActions(overflowInputs),
      hasSchedule: hasAnySchedule,
      hasHoliday: hasAnyHoliday,
      isSondZeit: hasAnySondZeit,
      ruleCount: scriptRows.length,
      detailRows: scriptRows,
    });
  }

  // 3. Separate active vs 24/7 scripts cleanly and sort deterministically
  const categoryRank: Record<OpeningHoursCategory, number> = {
    hours: 0,
    sondzeit: 1,
    holiday: 2,
    'always-open': 3,
  };

  const activeMatrixRows = consolidatedAll
    .filter((r) => r.category !== 'always-open')
    .sort(
      (a, b) =>
        categoryRank[a.category] - categoryRank[b.category] ||
        compareNaturalScriptNumbers(a.scriptNumber, b.scriptNumber)
    );

  const alwaysOpenRows = consolidatedAll
    .filter((r) => r.category === 'always-open')
    .sort((a, b) => compareNaturalScriptNumbers(a.scriptNumber, b.scriptNumber));

  const allMatrixRows = [...activeMatrixRows, ...alwaysOpenRows];

  // 4. Build dedicated SondZeit & Time Profile summaries (for Blatt 2 Section A)
  const profileMap = new Map<
    string,
    {
      profileName: string;
      sourceType: 'SondZeit-Plan' | 'Feste Dienstzeit';
      resolvedSchedule: string;
      days: WeekdayScheduleMatrix;
      scripts: Array<{ scriptNumber: string; scriptName: string }>;
      overflows: string[];
    }
  >();

  for (const row of activeMatrixRows) {
    if (!row.hasSchedule) continue;
    const isSz = row.category === 'sondzeit';
    const profileName =
      isSz && row.sondZeitSource !== 'Direkt im Skript' && row.sondZeitSource !== '—'
        ? row.sondZeitSource
        : row.compactScheduleSummary;
    const key = `${isSz ? 'sz' : 'hr'}::${profileName.toLowerCase()}::${row.compactScheduleSummary.toLowerCase()}`;
    let entry = profileMap.get(key);
    if (!entry) {
      entry = {
        profileName,
        sourceType: isSz ? 'SondZeit-Plan' : 'Feste Dienstzeit',
        resolvedSchedule: row.compactScheduleSummary,
        days: { ...row.days },
        scripts: [],
        overflows: [],
      };
      profileMap.set(key, entry);
    }
    entry.scripts.push({ scriptNumber: row.scriptNumber, scriptName: row.scriptName });
    if (row.overflowSummary && row.overflowSummary !== '—') {
      entry.overflows.push(row.overflowSummary);
    }
  }

  const sondZeitProfiles: SondZeitProfileSummary[] = Array.from(profileMap.values())
    .sort((a, b) => {
      if (a.sourceType !== b.sourceType) {
        return a.sourceType === 'SondZeit-Plan' ? -1 : 1;
      }
      return b.scripts.length - a.scripts.length || a.profileName.localeCompare(b.profileName, 'de');
    })
    .map((p) => ({
      profileName: p.profileName,
      sourceType: p.sourceType,
      resolvedSchedule: p.resolvedSchedule,
      days: p.days,
      scriptCount: p.scripts.length,
      scripts: p.scripts,
      scriptsList: p.scripts.map((s) => `[${s.scriptNumber}] ${s.scriptName}`).join(', '),
      overflowSummary: bundleOverflowActions(p.overflows),
    }));

  // 5. Build dedicated Holiday / Special Status entries (for Blatt 2 Section B)
  const holidayEntries: HolidayRuleSummary[] = activeMatrixRows
    .filter((r) => r.hasHoliday)
    .map((r) => {
      const holidayActionInputs = r.detailRows
        .filter((dr) => dr.hasHoliday && dr.closedOrOverflowAction && dr.closedOrOverflowAction !== '—')
        .map((dr) => dr.closedOrOverflowAction);
      return {
        scriptNumber: r.scriptNumber,
        scriptName: r.scriptName,
        holidayCondition: r.holidaySummary,
        actionSummary:
          holidayActionInputs.length > 0
            ? bundleOverflowActions(holidayActionInputs)
            : r.overflowSummary,
        linkedSchedule: r.hasSchedule ? r.compactScheduleSummary : 'Nur Feiertags-/Sonderprüfung',
      };
    });

  // 6. Sort detail rows cleanly (active scripts first, then 24/7, then prio)
  const activeScriptKeys = new Set(activeMatrixRows.map((r) => normalizeScriptKey(r.scriptNumber)));
  const sortedDetailRows = [...dedupedDetailRows].sort((a, b) => {
    const aActive = activeScriptKeys.has(normalizeScriptKey(a.scriptNumber)) ? 0 : 1;
    const bActive = activeScriptKeys.has(normalizeScriptKey(b.scriptNumber)) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const sc = compareNaturalScriptNumbers(a.scriptNumber, b.scriptNumber);
    if (sc !== 0) return sc;
    return (a.prio ?? 9999) - (b.prio ?? 9999);
  });

  const withHours = activeMatrixRows.filter((r) => r.category === 'hours').length;
  const withSondZeit = activeMatrixRows.filter((r) => r.category === 'sondzeit').length;
  const withHoliday = activeMatrixRows.filter((r) => r.hasHoliday).length;

  return {
    generatedAt,
    diagramTitle: options?.diagramTitle,
    totalScripts: allMatrixRows.length,
    activeMatrixRows,
    alwaysOpenRows,
    allMatrixRows,
    sondZeitProfiles,
    holidayEntries,
    detailRows: sortedDetailRows,
    stats: {
      totalScripts: allMatrixRows.length,
      withHours,
      withSondZeit,
      withHoliday,
      alwaysOpen: alwaysOpenRows.length,
      detailRuleCount: sortedDetailRows.length,
    },
  };
}

/**
 * Formats the consolidated Mo–So Opening Hours matrix as UTF-8 BOM semicolon-delimited CSV
 * (1 row per script, zero redundant time columns, cleanly sorted, optional 24/7 exclusion).
 */
export function formatOpeningHoursMatrixCsv(
  bundle: OpeningHoursExportBundle,
  options?: OpeningHoursExportOptions
): string {
  const includeAlwaysOpen = options?.includeAlwaysOpen !== false;
  const targetRows = includeAlwaysOpen ? bundle.allMatrixRows : bundle.activeMatrixRows;

  const escapeCsvCell = (val: string | number): string => {
    const str = String(val ?? '').replace(/\r?\n/g, ' ');
    if (/[;,"\t]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    OPENING_HOURS_CSV_HEADERS.map(escapeCsvCell).join(';'),
    ...targetRows.map((r) =>
      [
        r.scriptNumber,
        r.scriptName,
        r.categoryLabel,
        r.days.Mo,
        r.days.Di,
        r.days.Mi,
        r.days.Do,
        r.days.Fr,
        r.days.Sa,
        r.days.So,
        r.sondZeitSource,
        r.holidaySummary,
        r.overflowSummary,
      ]
        .map(escapeCsvCell)
        .join(';')
    ),
  ];

  return `\uFEFF${lines.join('\r\n')}`;
}

/**
 * Formats the consolidated Mo–So Opening Hours matrix as clean, structured Markdown
 * with 24/7 scripts separated into their own section.
 */
export function formatOpeningHoursMatrixMarkdown(
  bundle: OpeningHoursExportBundle,
  options?: OpeningHoursExportOptions
): string {
  const includeAlwaysOpen = options?.includeAlwaysOpen !== false;
  const escMd = (s: string) => String(s || '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

  const lines: string[] = [];
  const titleSuffix = options?.diagramTitle || bundle.diagramTitle ? ` — ${options?.diagramTitle || bundle.diagramTitle}` : '';
  lines.push(`# Öffnungszeiten-Übersicht (Wochenmatrix Mo–So)${titleSuffix}`);
  lines.push('');
  lines.push(
    `- **Stand:** ${bundle.generatedAt} · **Skripte gesamt:** ${bundle.stats.totalScripts} · **Feste Dienstzeiten:** ${bundle.stats.withHours} · **SondZeit-Pläne:** ${bundle.stats.withSondZeit} · **Feiertagsprüfungen:** ${bundle.stats.withHoliday} · **24/7:** ${bundle.stats.alwaysOpen}`
  );
  lines.push('');
  lines.push('## 1. Skripte mit Öffnungszeiten, SondZeit & Feiertagen');
  lines.push('');

  if (bundle.activeMatrixRows.length === 0) {
    lines.push('_Keine Skripte mit zeitlichen Einschränkungen oder Feiertagsregeln im aktuellen Umfang._');
  } else {
    lines.push(
      '| Skript | Name | Kategorie | Mo | Di | Mi | Do | Fr | Sa | So | SondZeit / Quelle | Feiertag | Überlauf / Ziel |'
    );
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of bundle.activeMatrixRows) {
      lines.push(
        `| ${escMd(r.scriptNumber)} | ${escMd(r.scriptName)} | ${escMd(r.categoryLabel)} | ${escMd(r.days.Mo)} | ${escMd(r.days.Di)} | ${escMd(r.days.Mi)} | ${escMd(r.days.Do)} | ${escMd(r.days.Fr)} | ${escMd(r.days.Sa)} | ${escMd(r.days.So)} | ${escMd(r.sondZeitSource)} | ${escMd(r.holidaySummary)} | ${escMd(r.overflowSummary)} |`
      );
    }
  }

  if (includeAlwaysOpen && bundle.alwaysOpenRows.length > 0) {
    lines.push('');
    lines.push('## 2. 24/7-Skripte (Ohne Zeitbeschränkung)');
    lines.push('');
    lines.push('| Skript | Name | Status | Überlauf / Ansage / Ziel |');
    lines.push('|---|---|---|---|');
    for (const r of bundle.alwaysOpenRows) {
      lines.push(
        `| ${escMd(r.scriptNumber)} | ${escMd(r.scriptName)} | 24/7 (Ohne Zeitplan) | ${escMd(r.overflowSummary)} |`
      );
    }
  }

  return lines.join('\n');
}

// ============================================================================
// NATIVE OOXML (.xlsx) MULTI-SHEET WORKBOOK GENERATOR (ZERO WARNINGS IN EXCEL)
// ============================================================================

function xmlEscape(raw: string | number): string {
  // Strip invalid XML 1.0 control chars except Tab (0x09), LF (0x0A), CR (0x0D)
  const sanitized = String(raw ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function excelColLetter(colIndexZeroBased: number): string {
  let n = colIndexZeroBased + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

interface XlsxCellSpec {
  value: string | number;
  style: number;
  type?: 'str' | 'num';
}

interface XlsxRowSpec {
  cells: XlsxCellSpec[];
  height?: number;
}

interface XlsxSheetSpec {
  name: string;
  tabColorHex: string;
  colWidths: number[];
  rows: XlsxRowSpec[];
  merges: string[];
  freezeRows?: number;
  autoFilterRef?: string;
}

// Style indices matching XL_STYLES_XML below
const S = {
  DEFAULT: 0,
  TITLE_BANNER: 1,
  KPI_STRIP: 2,
  TABLE_HEADER: 3,
  BODY_EVEN: 4,
  BODY_ODD: 5,
  SCRIPT_EVEN: 6,
  SCRIPT_ODD: 7,
  CAT_HOURS: 8,
  CAT_SONDZEIT: 9,
  CAT_HOLIDAY: 10,
  CAT_247: 11,
  DAY_OPEN: 12,
  DAY_CLOSED: 13,
  DAY_247: 14,
  DAY_UNKNOWN: 15,
  SECTION_BANNER: 16,
  HOLIDAY_HIGHLIGHT: 17,
  NUM_EVEN: 18,
  NUM_ODD: 19,
} as const;

const XL_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="10">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="9.5"/><color rgb="FF334155"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF0369A1"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFB45309"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF9A3412"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FF047857"/><name val="Calibri"/></font>
    <font><i/><sz val="9.5"/><color rgb="FF64748B"/><name val="Calibri"/></font>
  </fonts>
  <fills count="12">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE0F2FE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFEDD5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD1FAE5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF0F9FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF334155"/></left>
      <right style="thin"><color rgb="FF334155"/></right>
      <top style="thin"><color rgb="FF334155"/></top>
      <bottom style="medium"><color rgb="FF0F172A"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="20">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="8" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="10" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="9" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="8" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="9" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="11" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
    <xf numFmtId="1" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
  </cellXfs>
</styleSheet>`;

function categoryToStyle(cat: OpeningHoursCategory): number {
  switch (cat) {
    case 'hours':
      return S.CAT_HOURS;
    case 'sondzeit':
      return S.CAT_SONDZEIT;
    case 'holiday':
      return S.CAT_HOLIDAY;
    default:
      return S.CAT_247;
  }
}

function dayValueToStyle(val: string): number {
  if (!val || val === '—') return S.DAY_UNKNOWN;
  if (val === 'Geschlossen') return S.DAY_CLOSED;
  if (val === '24/7') return S.DAY_247;
  return S.DAY_OPEN;
}

function renderWorksheetXml(sheet: XlsxSheetSpec): string {
  const colsXml = sheet.colWidths
    .map(
      (w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
    )
    .join('');

  const rowsXml = sheet.rows
    .map((row, rowIdx) => {
      const rNum = rowIdx + 1;
      const htAttr = row.height ? ` ht="${row.height}" customHeight="1"` : '';
      const cellsXml = row.cells
        .map((cell, colIdx) => {
          const ref = `${excelColLetter(colIdx)}${rNum}`;
          if (cell.type === 'num' && typeof cell.value === 'number' && Number.isFinite(cell.value)) {
            return `<c r="${ref}" s="${cell.style}" t="n"><v>${cell.value}</v></c>`;
          }
          return `<c r="${ref}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell.value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rNum}"${htAttr}>${cellsXml}</row>`;
    })
    .join('');

  const paneXml =
    sheet.freezeRows && sheet.freezeRows > 0
      ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
      : '';

  const autoFilterXml = sheet.autoFilterRef
    ? `<autoFilter ref="${sheet.autoFilterRef}"/>`
    : '';

  const mergeXml =
    sheet.merges.length > 0
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges
          .map((m) => `<mergeCell ref="${m}"/>`)
          .join('')}</mergeCells>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><tabColor rgb="FF${sheet.tabColorHex}"/></sheetPr>
  <sheetViews><sheetView workbookViewId="0">${paneXml}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="19"/>
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml}</sheetData>
  ${autoFilterXml}
  ${mergeXml}
  <pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function makeBannerRows(
  colCount: number,
  title: string,
  subtitle: string
): { rows: XlsxRowSpec[]; merges: string[] } {
  const lastCol = excelColLetter(colCount - 1);
  const padBanner = (firstVal: string, style: number): XlsxCellSpec[] =>
    Array.from({ length: colCount }, (_, idx) => ({
      value: idx === 0 ? firstVal : '',
      style,
    }));

  return {
    rows: [
      { cells: padBanner(title, S.TITLE_BANNER), height: 28 },
      { cells: padBanner(subtitle, S.KPI_STRIP), height: 22 },
      { cells: Array.from({ length: colCount }, () => ({ value: '', style: S.DEFAULT })), height: 8 },
    ],
    merges: [`A1:${lastCol}1`, `A2:${lastCol}2`],
  };
}

/**
 * Builds the complete OOXML file map (`Record<zipPath, xmlString>`) for the formatted
 * Opening Hours multi-sheet Excel Workbook (.xlsx).
 */
export function buildOpeningHoursXlsxFileMap(
  bundle: OpeningHoursExportBundle,
  options?: OpeningHoursExportOptions
): Record<string, string> {
  const includeAlwaysOpen = options?.includeAlwaysOpen !== false;
  const titlePrefix = options?.diagramTitle || bundle.diagramTitle;
  const kpiLine = `Export: ${bundle.generatedAt}  |  Skripte gesamt: ${bundle.stats.totalScripts}  |  Feste Dienstzeiten: ${bundle.stats.withHours}  |  SondZeit-Pläne: ${bundle.stats.withSondZeit}  |  Feiertagsprüfungen: ${bundle.stats.withHoliday}  |  24/7-Skripte: ${bundle.stats.alwaysOpen}`;

  const sheets: XlsxSheetSpec[] = [];

  // ---------------------------------------------------------------------------
  // BLATT 1: Öffnungszeiten (Mo-So) — 1 Zeile pro Skript mit Zeiten/Feiertagen
  // ---------------------------------------------------------------------------
  {
    const colWidths = [15, 28, 22, 15, 15, 15, 15, 15, 15, 15, 26, 26, 38];
    const banner = makeBannerRows(
      colWidths.length,
      `Öffnungszeiten-Wochenmatrix (Mo–So)${titlePrefix ? ` — ${titlePrefix}` : ''}`,
      kpiLine
    );
    const rows: XlsxRowSpec[] = [...banner.rows];
    rows.push({
      height: 24,
      cells: OPENING_HOURS_CSV_HEADERS.map((h) => ({ value: h, style: S.TABLE_HEADER })),
    });

    if (bundle.activeMatrixRows.length === 0) {
      rows.push({
        height: 24,
        cells: Array.from({ length: colWidths.length }, (_, i) => ({
          value:
            i === 0
              ? 'Keine zeitlich begrenzten Skripte oder Feiertagsprüfungen erkannt (alle Skripte siehe Tab 24-7 & Ohne Zeitplan).'
              : '',
          style: S.BODY_EVEN,
        })),
      });
    } else {
      bundle.activeMatrixRows.forEach((r, idx) => {
        const isOdd = idx % 2 === 1;
        const bodyStyle = isOdd ? S.BODY_ODD : S.BODY_EVEN;
        const scriptStyle = isOdd ? S.SCRIPT_ODD : S.SCRIPT_EVEN;
        const holStyle = r.hasHoliday ? S.HOLIDAY_HIGHLIGHT : bodyStyle;
        const maxLen = Math.max(
          r.scriptName.length,
          r.sondZeitSource.length,
          r.holidaySummary.length,
          r.overflowSummary.length
        );
        const estHeight = Math.min(72, Math.max(21, Math.ceil(maxLen / 34) * 15 + 6));

        rows.push({
          height: estHeight,
          cells: [
            { value: r.scriptNumber, style: scriptStyle },
            { value: r.scriptName, style: bodyStyle },
            { value: r.categoryLabel, style: categoryToStyle(r.category) },
            { value: r.days.Mo, style: dayValueToStyle(r.days.Mo) },
            { value: r.days.Di, style: dayValueToStyle(r.days.Di) },
            { value: r.days.Mi, style: dayValueToStyle(r.days.Mi) },
            { value: r.days.Do, style: dayValueToStyle(r.days.Do) },
            { value: r.days.Fr, style: dayValueToStyle(r.days.Fr) },
            { value: r.days.Sa, style: dayValueToStyle(r.days.Sa) },
            { value: r.days.So, style: dayValueToStyle(r.days.So) },
            { value: r.sondZeitSource, style: bodyStyle },
            { value: r.holidaySummary, style: holStyle },
            { value: r.overflowSummary, style: bodyStyle },
          ],
        });
      });
    }

    const lastRowNum = Math.max(4, rows.length);
    sheets.push({
      name: 'Öffnungszeiten (Mo-So)',
      tabColorHex: '0284C7',
      colWidths,
      rows,
      merges: banner.merges,
      freezeRows: 4,
      autoFilterRef: `A4:${excelColLetter(colWidths.length - 1)}${lastRowNum}`,
    });
  }

  // ---------------------------------------------------------------------------
  // BLATT 2: Feiertage & SondZeit — Zwei klar abgegrenzte Bereiche
  // ---------------------------------------------------------------------------
  {
    const colWidths = [28, 18, 34, 12, 46, 38];
    const lastCol = excelColLetter(colWidths.length - 1);
    const banner = makeBannerRows(
      colWidths.length,
      `Feiertage, SondZeit-Pläne & Zeitprofile${titlePrefix ? ` — ${titlePrefix}` : ''}`,
      `${bundle.sondZeitProfiles.length} Zeitprofile / SondZeit-Pläne  |  ${bundle.holidayEntries.length} Skripte mit Feiertags- oder Sonderstatusprüfung`
    );
    const rows: XlsxRowSpec[] = [...banner.rows];
    const merges: string[] = [...banner.merges];

    // Section A: SondZeit-Pläne & Zeitprofile
    const secARow = rows.length + 1;
    rows.push({
      height: 22,
      cells: Array.from({ length: colWidths.length }, (_, i) => ({
        value: i === 0 ? 'A. SondZeit-Pläne & erkannte Zeitprofile' : '',
        style: S.SECTION_BANNER,
      })),
    });
    merges.push(`A${secARow}:${lastCol}${secARow}`);

    rows.push({
      height: 23,
      cells: [
        'SondZeit / Profilname',
        'Typ',
        'Aufgelöste Zeiten (Mo–So)',
        'Skripte',
        'Verwendet in Skripten',
        'Gebündelter Überlauf / Ansage / Ziel',
      ].map((h) => ({ value: h, style: S.TABLE_HEADER })),
    });

    if (bundle.sondZeitProfiles.length === 0) {
      rows.push({
        height: 22,
        cells: Array.from({ length: colWidths.length }, (_, i) => ({
          value: i === 0 ? 'Keine SondZeit-Pläne oder festen Zeitprofile erkannt.' : '',
          style: S.BODY_EVEN,
        })),
      });
    } else {
      bundle.sondZeitProfiles.forEach((p, idx) => {
        const isOdd = idx % 2 === 1;
        const bodyStyle = isOdd ? S.BODY_ODD : S.BODY_EVEN;
        const estHeight = Math.min(84, Math.max(22, Math.ceil(p.scriptsList.length / 42) * 15 + 6));
        rows.push({
          height: estHeight,
          cells: [
            { value: p.profileName, style: isOdd ? S.SCRIPT_ODD : S.SCRIPT_EVEN },
            {
              value: p.sourceType,
              style: p.sourceType === 'SondZeit-Plan' ? S.CAT_SONDZEIT : S.CAT_HOURS,
            },
            { value: p.resolvedSchedule, style: S.DAY_OPEN },
            { value: p.scriptCount, style: isOdd ? S.NUM_ODD : S.NUM_EVEN, type: 'num' },
            { value: p.scriptsList, style: bodyStyle },
            { value: p.overflowSummary, style: bodyStyle },
          ],
        });
      });
    }

    // Spacer row
    rows.push({
      height: 12,
      cells: Array.from({ length: colWidths.length }, () => ({ value: '', style: S.DEFAULT })),
    });

    // Section B: Feiertags- & Sonderstatus-Regeln
    const secBRow = rows.length + 1;
    rows.push({
      height: 22,
      cells: Array.from({ length: colWidths.length }, (_, i) => ({
        value: i === 0 ? 'B. Feiertags- & Sonderstatus-Regeln pro Skript' : '',
        style: S.SECTION_BANNER,
      })),
    });
    merges.push(`A${secBRow}:${lastCol}${secBRow}`);

    rows.push({
      height: 23,
      cells: [
        'Skript-Nr.',
        'Skript-Name',
        'Feiertags- / Sonderstatusprüfung',
        'Status',
        'Reguläre Öffnungszeiten',
        'Aktion bei Feiertag / Schließung',
      ].map((h) => ({ value: h, style: S.TABLE_HEADER })),
    });

    if (bundle.holidayEntries.length === 0) {
      rows.push({
        height: 22,
        cells: Array.from({ length: colWidths.length }, (_, i) => ({
          value: i === 0 ? 'Keine expliziten Feiertags- oder Sonderstatusprüfungen erkannt.' : '',
          style: S.BODY_EVEN,
        })),
      });
    } else {
      bundle.holidayEntries.forEach((h, idx) => {
        const isOdd = idx % 2 === 1;
        const bodyStyle = isOdd ? S.BODY_ODD : S.BODY_EVEN;
        const maxLen = Math.max(h.holidayCondition.length, h.actionSummary.length, h.linkedSchedule.length);
        const estHeight = Math.min(72, Math.max(22, Math.ceil(maxLen / 38) * 15 + 6));
        rows.push({
          height: estHeight,
          cells: [
            { value: h.scriptNumber, style: isOdd ? S.SCRIPT_ODD : S.SCRIPT_EVEN },
            { value: h.scriptName, style: bodyStyle },
            { value: h.holidayCondition, style: S.HOLIDAY_HIGHLIGHT },
            { value: 'Feiertag aktiv', style: S.CAT_HOLIDAY },
            { value: h.linkedSchedule, style: bodyStyle },
            { value: h.actionSummary, style: bodyStyle },
          ],
        });
      });
    }

    sheets.push({
      name: 'Feiertage & SondZeit',
      tabColorHex: 'D97706',
      colWidths,
      rows,
      merges,
      freezeRows: 3,
    });
  }

  // ---------------------------------------------------------------------------
  // BLATT 3: 24-7 & Ohne Zeitplan (sauber abgetrennt, optional ausblendbar)
  // ---------------------------------------------------------------------------
  if (includeAlwaysOpen) {
    const colWidths = [16, 30, 22, 18, 48];
    const banner = makeBannerRows(
      colWidths.length,
      `24/7-Skripte & Skripte ohne Zeitbeschränkung${titlePrefix ? ` — ${titlePrefix}` : ''}`,
      `${bundle.alwaysOpenRows.length} durchgehend aktive Skripte (sauber getrennt von der regulären Öffnungszeiten-Matrix)`
    );
    const rows: XlsxRowSpec[] = [...banner.rows];
    rows.push({
      height: 24,
      cells: ['Skript-Nr.', 'Skript-Name', 'Status', 'Verfügbarkeit', 'Queues, Ansagen & Ziele'].map(
        (h) => ({ value: h, style: S.TABLE_HEADER })
      ),
    });

    if (bundle.alwaysOpenRows.length === 0) {
      rows.push({
        height: 22,
        cells: Array.from({ length: colWidths.length }, (_, i) => ({
          value: i === 0 ? 'Keine 24/7-Skripte ohne Zeitbeschränkung vorhanden.' : '',
          style: S.BODY_EVEN,
        })),
      });
    } else {
      bundle.alwaysOpenRows.forEach((r, idx) => {
        const isOdd = idx % 2 === 1;
        const bodyStyle = isOdd ? S.BODY_ODD : S.BODY_EVEN;
        const estHeight = Math.min(64, Math.max(21, Math.ceil(r.overflowSummary.length / 44) * 15 + 6));
        rows.push({
          height: estHeight,
          cells: [
            { value: r.scriptNumber, style: isOdd ? S.SCRIPT_ODD : S.SCRIPT_EVEN },
            { value: r.scriptName, style: bodyStyle },
            { value: r.categoryLabel, style: S.CAT_247 },
            { value: 'Mo–So 24/7', style: S.DAY_247 },
            { value: r.overflowSummary, style: bodyStyle },
          ],
        });
      });
    }

    const lastRowNum = Math.max(4, rows.length);
    sheets.push({
      name: '24-7 & Ohne Zeitplan',
      tabColorHex: '059669',
      colWidths,
      rows,
      merges: banner.merges,
      freezeRows: 4,
      autoFilterRef: `A4:${excelColLetter(colWidths.length - 1)}${lastRowNum}`,
    });
  }

  // ---------------------------------------------------------------------------
  // BLATT 4: Regel-Details (deduplizierte technische Rückverfolgbarkeit)
  // ---------------------------------------------------------------------------
  {
    const detailRowsToWrite = includeAlwaysOpen
      ? bundle.detailRows
      : bundle.detailRows.filter((r) => r.hasSchedule || r.hasHoliday);

    const colWidths = [15, 26, 9, 26, 20, 24, 24, 24, 36, 22];
    const banner = makeBannerRows(
      colWidths.length,
      `Technische Regel-Details (Einzelregeln pro Skript)${titlePrefix ? ` — ${titlePrefix}` : ''}`,
      `${detailRowsToWrite.length} bereinigte Einzelregeln zur Rückverfolgung bis in die .s-Skripte`
    );
    const rows: XlsxRowSpec[] = [...banner.rows];
    rows.push({
      height: 24,
      cells: [
        'Skript-Nr.',
        'Skript-Name',
        'Prio',
        'Schritt / Regel',
        'Wochentage',
        'Uhrzeiten',
        'SondZeit / Quelle',
        'Feiertag / Sonderstatus',
        'Aktion / Überlauf / Ziel',
        'Status',
      ].map((h) => ({ value: h, style: S.TABLE_HEADER })),
    });

    detailRowsToWrite.forEach((r, idx) => {
      const isOdd = idx % 2 === 1;
      const bodyStyle = isOdd ? S.BODY_ODD : S.BODY_EVEN;
      const statusText =
        r.hasSchedule && r.hasHoliday
          ? 'Öffnungszeiten + Feiertag'
          : r.hasSchedule
          ? 'Öffnungszeiten hinterlegt'
          : r.hasHoliday
          ? 'Feiertag / Sonderzeit'
          : '24/7 (Ohne Zeitangabe)';
      const statusStyle =
        r.hasSchedule && isSondZeitRow(r)
          ? S.CAT_SONDZEIT
          : r.hasSchedule
          ? S.CAT_HOURS
          : r.hasHoliday
          ? S.CAT_HOLIDAY
          : S.CAT_247;

      rows.push({
        height: 21,
        cells: [
          { value: r.scriptNumber, style: isOdd ? S.SCRIPT_ODD : S.SCRIPT_EVEN },
          { value: r.scriptName, style: bodyStyle },
          typeof r.prio === 'number'
            ? { value: r.prio, style: isOdd ? S.NUM_ODD : S.NUM_EVEN, type: 'num' }
            : { value: '—', style: bodyStyle },
          { value: r.stepName || '—', style: bodyStyle },
          { value: r.weekdays || '—', style: bodyStyle },
          { value: r.clockTimes || normalizeClockText(r.openingHours || '—'), style: bodyStyle },
          { value: r.scheduleSource || '—', style: bodyStyle },
          { value: r.holidayAndSpecial || '—', style: r.hasHoliday ? S.HOLIDAY_HIGHLIGHT : bodyStyle },
          { value: r.closedOrOverflowAction || '—', style: bodyStyle },
          { value: statusText, style: statusStyle },
        ],
      });
    });

    const lastRowNum = Math.max(4, rows.length);
    sheets.push({
      name: 'Regel-Details',
      tabColorHex: '4F46E5',
      colWidths,
      rows,
      merges: banner.merges,
      freezeRows: 4,
      autoFilterRef: `A4:${excelColLetter(colWidths.length - 1)}${lastRowNum}`,
    });
  }

  // Assemble OOXML package files
  const files: Record<string, string> = {};

  const sheetOverrides = sheets
    .map(
      (_, i) =>
        `  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('\n');

  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheetOverrides}
</Types>`;

  files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const sheetsXml = sheets
    .map(
      (s, i) =>
        `    <sheet name="${xmlEscape(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join('\n');

  files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${sheetsXml}
  </sheets>
</workbook>`;

  const wbRels = sheets
    .map(
      (_, i) =>
        `  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join('\n');

  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${wbRels}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  files['xl/styles.xml'] = XL_STYLES_XML;

  sheets.forEach((sheet, idx) => {
    files[`xl/worksheets/sheet${idx + 1}.xml`] = renderWorksheetXml(sheet);
  });

  return files;
}

/**
 * Generates a native, compressed OOXML Excel Workbook (.xlsx) as Uint8Array.
 */
export async function exportOpeningHoursXlsxUint8Array(
  bundle: OpeningHoursExportBundle,
  options?: OpeningHoursExportOptions
): Promise<Uint8Array> {
  const fileMap = buildOpeningHoursXlsxFileMap(bundle, options);
  const zip = new JSZip();
  for (const [zipPath, content] of Object.entries(fileMap)) {
    zip.file(zipPath, content);
  }
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * Generates a native OOXML Excel Workbook (.xlsx) Blob ready for browser download.
 */
export async function exportOpeningHoursXlsxBlob(
  bundle: OpeningHoursExportBundle,
  options?: OpeningHoursExportOptions
): Promise<Blob> {
  const bytes = await exportOpeningHoursXlsxUint8Array(bundle, options);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * High-level workspace wrapper that accepts a callback for building schedule rows
 * (avoids circular imports between scriptCallflowParser.ts and openingHoursExporter.ts).
 */
export function buildOpeningHoursBundleFromWorkspace(
  workspace: ScriptWorkspace,
  buildRowsFn: (ws: ScriptWorkspace) => CallflowScheduleSummaryRow[],
  options?: OpeningHoursExportOptions
): OpeningHoursExportBundle {
  const rows = options?.rowsOverride ?? buildRowsFn(workspace);
  return buildOpeningHoursExportBundleFromRows(rows, {
    diagramTitle: options?.diagramTitle,
  });
}

// ============================================================================
// ZERO-DEPENDENCY STORE-MODE ZIP BUILDER (FOR STANDALONE OFFLINE Callflow.html)
// ============================================================================

const CRC32_TABLE: Uint32Array = (() => {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[i] = c >>> 0;
  }
  return tbl;
})();

function crc32Bytes(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Builds an uncompressed (STORE method 0) PKWARE-compliant ZIP archive as Uint8Array.
 * Used by standalone offline Callflow.html to generate native .xlsx workbooks with zero dependencies.
 */
export function buildStoreZipUint8Array(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const entries = Object.entries(files).map(([name, content]) => {
    const nameBytes = enc.encode(name);
    const dataBytes = enc.encode(content);
    const crc = crc32Bytes(dataBytes);
    return { nameBytes, dataBytes, crc, offset: 0 };
  });

  let localTotal = 0;
  let centralTotal = 0;
  for (const e of entries) {
    e.offset = localTotal;
    localTotal += 30 + e.nameBytes.length + e.dataBytes.length;
    centralTotal += 46 + e.nameBytes.length;
  }

  const out = new Uint8Array(localTotal + centralTotal + 22);
  const view = new DataView(out.buffer);
  let pos = 0;

  for (const e of entries) {
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true); // version needed
    view.setUint16(pos + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(pos + 8, 0, true); // method 0 (STORE)
    view.setUint16(pos + 10, 0, true); // mod time
    view.setUint16(pos + 12, 0x5421, true); // mod date
    view.setUint32(pos + 14, e.crc, true);
    view.setUint32(pos + 18, e.dataBytes.length, true);
    view.setUint32(pos + 22, e.dataBytes.length, true);
    view.setUint16(pos + 26, e.nameBytes.length, true);
    view.setUint16(pos + 28, 0, true);
    pos += 30;
    out.set(e.nameBytes, pos);
    pos += e.nameBytes.length;
    out.set(e.dataBytes, pos);
    pos += e.dataBytes.length;
  }

  const cdStart = pos;
  for (const e of entries) {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, 0, true);
    view.setUint16(pos + 14, 0x5421, true);
    view.setUint32(pos + 16, e.crc, true);
    view.setUint32(pos + 20, e.dataBytes.length, true);
    view.setUint32(pos + 24, e.dataBytes.length, true);
    view.setUint16(pos + 28, e.nameBytes.length, true);
    view.setUint16(pos + 30, 0, true);
    view.setUint16(pos + 32, 0, true);
    view.setUint16(pos + 34, 0, true);
    view.setUint16(pos + 36, 0, true);
    view.setUint32(pos + 38, 0, true);
    view.setUint32(pos + 42, e.offset, true);
    pos += 46;
    out.set(e.nameBytes, pos);
    pos += e.nameBytes.length;
  }

  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, centralTotal, true);
  view.setUint32(pos + 16, cdStart, true);
  view.setUint16(pos + 20, 0, true);

  return out;
}

/**
 * Returns self-contained browser JS runtime functions embedded into standalone Callflow.html
 * so the offline viewer exports the exact same formatted 4-sheet Excel (.xlsx) workbook,
 * cleaned Mo–So CSV, and structured Markdown as Avaya Callflow Studio.
 */
export function getEmbeddedOpeningHoursExportRuntimeJs(): string {
  const stylesJson = JSON.stringify(XL_STYLES_XML).replace(/<\/script>/gi, '<\\/script>');
  const headersJson = JSON.stringify(OPENING_HOURS_CSV_HEADERS);
  return `
    const OH_WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    const OH_CSV_HEADERS = ${headersJson};
    const OH_XL_STYLES_XML = ${stylesJson};
    const OH_S = {
      DEFAULT: 0, TITLE_BANNER: 1, KPI_STRIP: 2, TABLE_HEADER: 3,
      BODY_EVEN: 4, BODY_ODD: 5, SCRIPT_EVEN: 6, SCRIPT_ODD: 7,
      CAT_HOURS: 8, CAT_SONDZEIT: 9, CAT_HOLIDAY: 10, CAT_247: 11,
      DAY_OPEN: 12, DAY_CLOSED: 13, DAY_247: 14, DAY_UNKNOWN: 15,
      SECTION_BANNER: 16, HOLIDAY_HIGHLIGHT: 17, NUM_EVEN: 18, NUM_ODD: 19
    };

    const OH_CRC_TABLE = (function() {
      const tbl = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        tbl[i] = c >>> 0;
      }
      return tbl;
    })();

    function ohCrc32(bytes) {
      let c = 0xffffffff;
      for (let i = 0; i < bytes.length; i++) c = OH_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    }

    function ohBuildStoreZip(fileMap) {
      const enc = new TextEncoder();
      const entries = Object.entries(fileMap).map(function(pair) {
        const nb = enc.encode(pair[0]);
        const db = enc.encode(pair[1]);
        return { nb: nb, db: db, crc: ohCrc32(db), offset: 0 };
      });
      let localTotal = 0, centralTotal = 0;
      entries.forEach(function(e) {
        e.offset = localTotal;
        localTotal += 30 + e.nb.length + e.db.length;
        centralTotal += 46 + e.nb.length;
      });
      const out = new Uint8Array(localTotal + centralTotal + 22);
      const view = new DataView(out.buffer);
      let pos = 0;
      entries.forEach(function(e) {
        view.setUint32(pos, 0x04034b50, true);
        view.setUint16(pos + 4, 20, true);
        view.setUint16(pos + 6, 0x0800, true);
        view.setUint16(pos + 8, 0, true);
        view.setUint16(pos + 10, 0, true);
        view.setUint16(pos + 12, 0x5421, true);
        view.setUint32(pos + 14, e.crc, true);
        view.setUint32(pos + 18, e.db.length, true);
        view.setUint32(pos + 22, e.db.length, true);
        view.setUint16(pos + 26, e.nb.length, true);
        view.setUint16(pos + 28, 0, true);
        pos += 30;
        out.set(e.nb, pos); pos += e.nb.length;
        out.set(e.db, pos); pos += e.db.length;
      });
      const cdStart = pos;
      entries.forEach(function(e) {
        view.setUint32(pos, 0x02014b50, true);
        view.setUint16(pos + 4, 20, true);
        view.setUint16(pos + 6, 20, true);
        view.setUint16(pos + 8, 0x0800, true);
        view.setUint16(pos + 10, 0, true);
        view.setUint16(pos + 12, 0, true);
        view.setUint16(pos + 14, 0x5421, true);
        view.setUint32(pos + 16, e.crc, true);
        view.setUint32(pos + 20, e.db.length, true);
        view.setUint32(pos + 24, e.db.length, true);
        view.setUint16(pos + 28, e.nb.length, true);
        view.setUint16(pos + 30, 0, true);
        view.setUint16(pos + 32, 0, true);
        view.setUint16(pos + 34, 0, true);
        view.setUint16(pos + 36, 0, true);
        view.setUint32(pos + 38, 0, true);
        view.setUint32(pos + 42, e.offset, true);
        pos += 46;
        out.set(e.nb, pos); pos += e.nb.length;
      });
      view.setUint32(pos, 0x06054b50, true);
      view.setUint16(pos + 4, 0, true);
      view.setUint16(pos + 6, 0, true);
      view.setUint16(pos + 8, entries.length, true);
      view.setUint16(pos + 10, entries.length, true);
      view.setUint32(pos + 12, centralTotal, true);
      view.setUint32(pos + 16, cdStart, true);
      view.setUint16(pos + 20, 0, true);
      return out;
    }

    function ohXmlEsc(val) {
      return String(val == null ? '' : val)
        .replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]/g, '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    function ohColLetter(idx) {
      let n = idx + 1, out = '';
      while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
      }
      return out;
    }

    function ohCatStyle(cat) {
      if (cat === 'hours') return OH_S.CAT_HOURS;
      if (cat === 'sondzeit') return OH_S.CAT_SONDZEIT;
      if (cat === 'holiday') return OH_S.CAT_HOLIDAY;
      return OH_S.CAT_247;
    }

    function ohDayStyle(val) {
      if (!val || val === '—') return OH_S.DAY_UNKNOWN;
      if (val === 'Geschlossen') return OH_S.DAY_CLOSED;
      if (val === '24/7') return OH_S.DAY_247;
      return OH_S.DAY_OPEN;
    }

    function ohRenderSheetXml(sheet) {
      const colsXml = sheet.colWidths.map(function(w, i) {
        return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      }).join('');
      const rowsXml = sheet.rows.map(function(row, rIdx) {
        const rNum = rIdx + 1;
        const ht = row.height ? (' ht="' + row.height + '" customHeight="1"') : '';
        const cells = row.cells.map(function(c, cIdx) {
          const ref = ohColLetter(cIdx) + rNum;
          if (c.type === 'num' && typeof c.value === 'number' && isFinite(c.value)) {
            return '<c r="' + ref + '" s="' + c.style + '" t="n"><v>' + c.value + '</v></c>';
          }
          return '<c r="' + ref + '" s="' + c.style + '" t="inlineStr"><is><t xml:space="preserve">' + ohXmlEsc(c.value) + '</t></is></c>';
        }).join('');
        return '<row r="' + rNum + '"' + ht + '>' + cells + '</row>';
      }).join('');
      const paneXml = sheet.freezeRows ? ('<pane ySplit="' + sheet.freezeRows + '" topLeftCell="A' + (sheet.freezeRows + 1) + '" activePane="bottomLeft" state="frozen"/>') : '';
      const afXml = sheet.autoFilterRef ? ('<autoFilter ref="' + sheet.autoFilterRef + '"/>') : '';
      const mergeXml = sheet.merges.length ? ('<mergeCells count="' + sheet.merges.length + '">' + sheet.merges.map(function(m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>') : '';
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\\n' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetPr><tabColor rgb="FF' + sheet.tabColorHex + '"/></sheetPr>' +
        '<sheetViews><sheetView workbookViewId="0">' + paneXml + '</sheetView></sheetViews>' +
        '<sheetFormatPr defaultRowHeight="19"/>' +
        '<cols>' + colsXml + '</cols>' +
        '<sheetData>' + rowsXml + '</sheetData>' + afXml + mergeXml +
        '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>' +
        '</worksheet>';
    }

    function ohMakeBanner(colCount, title, subtitle) {
      const lastCol = ohColLetter(colCount - 1);
      const pad = function(txt, st) {
        const arr = [];
        for (let i = 0; i < colCount; i++) arr.push({ value: i === 0 ? txt : '', style: st });
        return arr;
      };
      const empty = [];
      for (let i = 0; i < colCount; i++) empty.push({ value: '', style: OH_S.DEFAULT });
      return {
        rows: [
          { cells: pad(title, OH_S.TITLE_BANNER), height: 28 },
          { cells: pad(subtitle, OH_S.KPI_STRIP), height: 22 },
          { cells: empty, height: 8 }
        ],
        merges: ['A1:' + lastCol + '1', 'A2:' + lastCol + '2']
      };
    }

    function downloadOpeningHoursXlsxFromBundle(bundle, includeAlwaysOpen, filename) {
      if (!bundle) return;
      const stats = bundle.stats || { totalScripts: 0, withHours: 0, withSondZeit: 0, withHoliday: 0, alwaysOpen: 0 };
      const titleSuffix = bundle.diagramTitle ? (' — ' + bundle.diagramTitle) : '';
      const kpi = 'Export: ' + (bundle.generatedAt || '') + '  |  Skripte gesamt: ' + stats.totalScripts +
        '  |  Feste Dienstzeiten: ' + stats.withHours + '  |  SondZeit-Pläne: ' + stats.withSondZeit +
        '  |  Feiertagsprüfungen: ' + stats.withHoliday + '  |  24/7-Skripte: ' + stats.alwaysOpen;
      const sheets = [];

      // Sheet 1: Öffnungszeiten (Mo-So)
      (function() {
        const w = [15, 28, 22, 15, 15, 15, 15, 15, 15, 15, 26, 26, 38];
        const b = ohMakeBanner(w.length, 'Öffnungszeiten-Wochenmatrix (Mo–So)' + titleSuffix, kpi);
        const rows = b.rows.slice();
        rows.push({ height: 24, cells: OH_CSV_HEADERS.map(function(h) { return { value: h, style: OH_S.TABLE_HEADER }; }) });
        const act = bundle.activeMatrixRows || [];
        if (!act.length) {
          rows.push({ height: 24, cells: w.map(function(_, i) { return { value: i === 0 ? 'Keine zeitlich begrenzten Skripte oder Feiertagsprüfungen erkannt.' : '', style: OH_S.BODY_EVEN }; }) });
        } else {
          act.forEach(function(r, idx) {
            const odd = idx % 2 === 1;
            const bs = odd ? OH_S.BODY_ODD : OH_S.BODY_EVEN;
            const ss = odd ? OH_S.SCRIPT_ODD : OH_S.SCRIPT_EVEN;
            const d = r.days || {};
            rows.push({
              height: 22,
              cells: [
                { value: r.scriptNumber, style: ss },
                { value: r.scriptName, style: bs },
                { value: r.categoryLabel, style: ohCatStyle(r.category) },
                { value: d.Mo || '—', style: ohDayStyle(d.Mo) },
                { value: d.Di || '—', style: ohDayStyle(d.Di) },
                { value: d.Mi || '—', style: ohDayStyle(d.Mi) },
                { value: d.Do || '—', style: ohDayStyle(d.Do) },
                { value: d.Fr || '—', style: ohDayStyle(d.Fr) },
                { value: d.Sa || '—', style: ohDayStyle(d.Sa) },
                { value: d.So || '—', style: ohDayStyle(d.So) },
                { value: r.sondZeitSource || '—', style: bs },
                { value: r.holidaySummary || '—', style: r.hasHoliday ? OH_S.HOLIDAY_HIGHLIGHT : bs },
                { value: r.overflowSummary || '—', style: bs }
              ]
            });
          });
        }
        sheets.push({
          name: 'Öffnungszeiten (Mo-So)', tabColorHex: '0284C7', colWidths: w, rows: rows, merges: b.merges,
          freezeRows: 4, autoFilterRef: 'A4:' + ohColLetter(w.length - 1) + Math.max(4, rows.length)
        });
      })();

      // Sheet 2: Feiertage & SondZeit
      (function() {
        const w = [28, 18, 34, 12, 46, 38];
        const lc = ohColLetter(w.length - 1);
        const sz = bundle.sondZeitProfiles || [];
        const hols = bundle.holidayEntries || [];
        const b = ohMakeBanner(w.length, 'Feiertage, SondZeit-Pläne & Zeitprofile' + titleSuffix,
          sz.length + ' Zeitprofile / SondZeit-Pläne  |  ' + hols.length + ' Skripte mit Feiertagsprüfung');
        const rows = b.rows.slice();
        const merges = b.merges.slice();
        const secA = rows.length + 1;
        rows.push({ height: 22, cells: w.map(function(_, i) { return { value: i === 0 ? 'A. SondZeit-Pläne & erkannte Zeitprofile' : '', style: OH_S.SECTION_BANNER }; }) });
        merges.push('A' + secA + ':' + lc + secA);
        rows.push({ height: 23, cells: ['SondZeit / Profilname', 'Typ', 'Aufgelöste Zeiten (Mo–So)', 'Skripte', 'Verwendet in Skripten', 'Gebündelter Überlauf / Ansage / Ziel'].map(function(h) { return { value: h, style: OH_S.TABLE_HEADER }; }) });
        if (!sz.length) {
          rows.push({ height: 22, cells: w.map(function(_, i) { return { value: i === 0 ? 'Keine SondZeit-Pläne oder festen Zeitprofile erkannt.' : '', style: OH_S.BODY_EVEN }; }) });
        } else {
          sz.forEach(function(p, idx) {
            const odd = idx % 2 === 1, bs = odd ? OH_S.BODY_ODD : OH_S.BODY_EVEN;
            rows.push({
              height: 22,
              cells: [
                { value: p.profileName, style: odd ? OH_S.SCRIPT_ODD : OH_S.SCRIPT_EVEN },
                { value: p.sourceType, style: p.sourceType === 'SondZeit-Plan' ? OH_S.CAT_SONDZEIT : OH_S.CAT_HOURS },
                { value: p.resolvedSchedule, style: OH_S.DAY_OPEN },
                { value: p.scriptCount, style: odd ? OH_S.NUM_ODD : OH_S.NUM_EVEN, type: 'num' },
                { value: p.scriptsList, style: bs },
                { value: p.overflowSummary || '—', style: bs }
              ]
            });
          });
        }
        rows.push({ height: 12, cells: w.map(function() { return { value: '', style: OH_S.DEFAULT }; }) });
        const secB = rows.length + 1;
        rows.push({ height: 22, cells: w.map(function(_, i) { return { value: i === 0 ? 'B. Feiertags- & Sonderstatus-Regeln pro Skript' : '', style: OH_S.SECTION_BANNER }; }) });
        merges.push('A' + secB + ':' + lc + secB);
        rows.push({ height: 23, cells: ['Skript-Nr.', 'Skript-Name', 'Feiertags- / Sonderstatusprüfung', 'Status', 'Reguläre Öffnungszeiten', 'Aktion bei Feiertag / Schließung'].map(function(h) { return { value: h, style: OH_S.TABLE_HEADER }; }) });
        if (!hols.length) {
          rows.push({ height: 22, cells: w.map(function(_, i) { return { value: i === 0 ? 'Keine expliziten Feiertagsprüfungen erkannt.' : '', style: OH_S.BODY_EVEN }; }) });
        } else {
          hols.forEach(function(h, idx) {
            const odd = idx % 2 === 1, bs = odd ? OH_S.BODY_ODD : OH_S.BODY_EVEN;
            rows.push({
              height: 22,
              cells: [
                { value: h.scriptNumber, style: odd ? OH_S.SCRIPT_ODD : OH_S.SCRIPT_EVEN },
                { value: h.scriptName, style: bs },
                { value: h.holidayCondition, style: OH_S.HOLIDAY_HIGHLIGHT },
                { value: 'Feiertag aktiv', style: OH_S.CAT_HOLIDAY },
                { value: h.linkedSchedule, style: bs },
                { value: h.actionSummary || '—', style: bs }
              ]
            });
          });
        }
        sheets.push({ name: 'Feiertage & SondZeit', tabColorHex: 'D97706', colWidths: w, rows: rows, merges: merges, freezeRows: 3 });
      })();

      // Sheet 3: 24-7 & Ohne Zeitplan
      if (includeAlwaysOpen) {
        const w = [16, 30, 22, 18, 48];
        const ao = bundle.alwaysOpenRows || [];
        const b = ohMakeBanner(w.length, '24/7-Skripte & Skripte ohne Zeitbeschränkung' + titleSuffix,
          ao.length + ' durchgehend aktive Skripte (sauber getrennt von der regulären Öffnungszeiten-Matrix)');
        const rows = b.rows.slice();
        rows.push({ height: 24, cells: ['Skript-Nr.', 'Skript-Name', 'Status', 'Verfügbarkeit', 'Queues, Ansagen & Ziele'].map(function(h) { return { value: h, style: OH_S.TABLE_HEADER }; }) });
        if (!ao.length) {
          rows.push({ height: 22, cells: w.map(function(_, i) { return { value: i === 0 ? 'Keine 24/7-Skripte ohne Zeitbeschränkung vorhanden.' : '', style: OH_S.BODY_EVEN }; }) });
        } else {
          ao.forEach(function(r, idx) {
            const odd = idx % 2 === 1, bs = odd ? OH_S.BODY_ODD : OH_S.BODY_EVEN;
            rows.push({
              height: 21,
              cells: [
                { value: r.scriptNumber, style: odd ? OH_S.SCRIPT_ODD : OH_S.SCRIPT_EVEN },
                { value: r.scriptName, style: bs },
                { value: r.categoryLabel, style: OH_S.CAT_247 },
                { value: 'Mo–So 24/7', style: OH_S.DAY_247 },
                { value: r.overflowSummary || '—', style: bs }
              ]
            });
          });
        }
        sheets.push({
          name: '24-7 & Ohne Zeitplan', tabColorHex: '059669', colWidths: w, rows: rows, merges: b.merges,
          freezeRows: 4, autoFilterRef: 'A4:' + ohColLetter(w.length - 1) + Math.max(4, rows.length)
        });
      }

      // Sheet 4: Regel-Details
      (function() {
        const w = [15, 26, 9, 26, 20, 24, 24, 24, 36, 22];
        const rawDet = bundle.detailRows || [];
        const det = includeAlwaysOpen ? rawDet : rawDet.filter(function(r) { return r.hasSchedule || r.hasHoliday; });
        const b = ohMakeBanner(w.length, 'Technische Regel-Details (Einzelregeln pro Skript)' + titleSuffix,
          det.length + ' bereinigte Einzelregeln zur Rückverfolgung bis in die .s-Skripte');
        const rows = b.rows.slice();
        rows.push({ height: 24, cells: ['Skript-Nr.', 'Skript-Name', 'Prio', 'Schritt / Regel', 'Wochentage', 'Uhrzeiten', 'SondZeit / Quelle', 'Feiertag / Sonderstatus', 'Aktion / Überlauf / Ziel', 'Status'].map(function(h) { return { value: h, style: OH_S.TABLE_HEADER }; }) });
        det.forEach(function(r, idx) {
          const odd = idx % 2 === 1, bs = odd ? OH_S.BODY_ODD : OH_S.BODY_EVEN;
          const stTxt = (r.hasSchedule && r.hasHoliday) ? 'Öffnungszeiten + Feiertag' : r.hasSchedule ? 'Öffnungszeiten hinterlegt' : r.hasHoliday ? 'Feiertag / Sonderzeit' : '24/7 (Ohne Zeitangabe)';
          const stStyle = r.hasSchedule ? (/sondzeit/i.test(String(r.scheduleSource || r.openingHours || '')) ? OH_S.CAT_SONDZEIT : OH_S.CAT_HOURS) : r.hasHoliday ? OH_S.CAT_HOLIDAY : OH_S.CAT_247;
          rows.push({
            height: 21,
            cells: [
              { value: r.scriptNumber, style: odd ? OH_S.SCRIPT_ODD : OH_S.SCRIPT_EVEN },
              { value: r.scriptName, style: bs },
              typeof r.prio === 'number' ? { value: r.prio, style: odd ? OH_S.NUM_ODD : OH_S.NUM_EVEN, type: 'num' } : { value: '—', style: bs },
              { value: r.stepName || '—', style: bs },
              { value: r.weekdays || '—', style: bs },
              { value: r.clockTimes || r.openingHours || '—', style: bs },
              { value: r.scheduleSource || '—', style: bs },
              { value: r.holidayAndSpecial || '—', style: r.hasHoliday ? OH_S.HOLIDAY_HIGHLIGHT : bs },
              { value: r.closedOrOverflowAction || '—', style: bs },
              { value: stTxt, style: stStyle }
            ]
          });
        });
        sheets.push({
          name: 'Regel-Details', tabColorHex: '4F46E5', colWidths: w, rows: rows, merges: b.merges,
          freezeRows: 4, autoFilterRef: 'A4:' + ohColLetter(w.length - 1) + Math.max(4, rows.length)
        });
      })();

      const files = {};
      files['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map(function(_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
        '</Types>';
      files['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
      files['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map(function(s, i) { return '<sheet name="' + ohXmlEsc(s.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') +
        '</sheets></workbook>';
      files['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function(_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
      files['xl/styles.xml'] = OH_XL_STYLES_XML;
      sheets.forEach(function(s, i) { files['xl/worksheets/sheet' + (i + 1) + '.xml'] = ohRenderSheetXml(s); });

      const zipBytes = ohBuildStoreZip(files);
      const blob = new Blob([zipBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'callflow-oeffnungszeiten.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }

    function buildOpeningHoursCsvRowsFromBundle(bundle, includeAlwaysOpen) {
      if (!bundle) return [];
      const list = includeAlwaysOpen ? (bundle.allMatrixRows || []) : (bundle.activeMatrixRows || []);
      return list.map(function(r) {
        const d = r.days || {};
        return [
          r.scriptNumber, r.scriptName, r.categoryLabel,
          d.Mo || '—', d.Di || '—', d.Mi || '—', d.Do || '—', d.Fr || '—', d.Sa || '—', d.So || '—',
          r.sondZeitSource || '—', r.holidaySummary || '—', r.overflowSummary || '—'
        ];
      });
    }

    function buildOpeningHoursMarkdownFromBundle(bundle, includeAlwaysOpen) {
      if (!bundle) return '';
      const escM = function(s) { return String(s || '—').replace(/\\|/g, '\\\\|').replace(/\\r?\\n/g, ' '); };
      const st = bundle.stats || { totalScripts: 0, withHours: 0, withSondZeit: 0, withHoliday: 0, alwaysOpen: 0 };
      const lines = [
        '# Öffnungszeiten-Übersicht (Wochenmatrix Mo–So)' + (bundle.diagramTitle ? (' — ' + bundle.diagramTitle) : ''),
        '',
        '- **Skripte gesamt:** ' + st.totalScripts + ' · **Dienstzeiten:** ' + st.withHours + ' · **SondZeit:** ' + st.withSondZeit + ' · **Feiertage:** ' + st.withHoliday + ' · **24/7:** ' + st.alwaysOpen,
        '',
        '## 1. Skripte mit Öffnungszeiten, SondZeit & Feiertagen',
        ''
      ];
      const act = bundle.activeMatrixRows || [];
      if (!act.length) {
        lines.push('_Keine zeitlich begrenzten Skripte oder Feiertagsprüfungen erkannt._');
      } else {
        lines.push('| Skript | Name | Kategorie | Mo | Di | Mi | Do | Fr | Sa | So | SondZeit / Quelle | Feiertag | Überlauf / Ziel |');
        lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
        act.forEach(function(r) {
          const d = r.days || {};
          lines.push('| ' + [r.scriptNumber, r.scriptName, r.categoryLabel, d.Mo, d.Di, d.Mi, d.Do, d.Fr, d.Sa, d.So, r.sondZeitSource, r.holidaySummary, r.overflowSummary].map(escM).join(' | ') + ' |');
        });
      }
      const ao = bundle.alwaysOpenRows || [];
      if (includeAlwaysOpen && ao.length) {
        lines.push('', '## 2. 24/7-Skripte (Ohne Zeitbeschränkung)', '', '| Skript | Name | Status | Überlauf / Ansage / Ziel |', '|---|---|---|---|');
        ao.forEach(function(r) {
          lines.push('| ' + [r.scriptNumber, r.scriptName, '24/7 (Ohne Zeitplan)', r.overflowSummary].map(escM).join(' | ') + ' |');
        });
      }
      return lines.join('\\n');
    }
  `;
}

