import {
  CallflowGraph,
  ScriptModule,
  ScriptRule,
  ScriptWorkspace,
} from '../types/mermaidStudio';
import {
  canonicalScriptMatchKey,
  getModuleOpeningHoursSummary,
  toMermaidNodeSuffix,
} from './scriptCallflowParser';

export type GlobalSearchCategory =
  | 'script'
  | 'dnis'
  | 'queue'
  | 'announcement'
  | 'cdn'
  | 'schedule'
  | 'node';

export interface GlobalSearchEntry {
  id: string;
  category: GlobalSearchCategory;
  title: string;
  subtitle: string;
  meta?: string;
  searchText: string;
  viewKey: string;
  scriptNumber?: string;
  nodeId?: string;
}

export type SimulationWeekday = 'mo' | 'di' | 'mi' | 'do' | 'fr' | 'sa' | 'so';

export type SimulationQueueMode =
  | 'normal'
  | 'no-agents'
  | 'queue-full'
  | 'wait-timeout';

export type SimDynamicCategory = 'no-agents' | 'queue-full' | 'wait-timeout' | 'other';

export interface SimTimeRange {
  startMin: number;
  endMin: number;
  raw: string;
}

export interface SimChoiceOption {
  choice: string;
  targetNumber: string;
  label?: string;
  choiceNodeId?: string;
}

export interface SimManualTarget {
  toTargetNumber: string;
  fromRuleId?: string;
  label?: string;
}

export interface SimRule {
  id: string;
  ruleIndex: number;
  stepNodeId: string;
  prio: number;
  stepName: string;
  scheduleRaw?: string;
  weekdays?: SimulationWeekday[];
  timeRanges?: SimTimeRange[];
  isAlwaysOpen?: boolean;
  isHolidayRule?: boolean;
  isSondZeitRule?: boolean;
  conditionRaw?: string;
  isDynamicCondition?: boolean;
  dynamicCategory?: SimDynamicCategory;
  isOverflowRule?: boolean;
  dnisMatchValues?: string[];
  targetNumber?: string;
  queueTarget?: string;
  announcement?: string;
  treatmentInfo?: string;
  waitSeconds?: number;
  isDisconnect?: boolean;
  isExternalRoute?: boolean;
  organizationName?: string;
  choices?: SimChoiceOption[];
}

export interface SimScript {
  scriptNumber: string;
  scriptName: string;
  entryNodeId: string;
  cdnAlias?: string;
  isMaster: boolean;
  entryDnisNumbers: string[];
  organizationName?: string;
  rules: SimRule[];
  manualTargets?: SimManualTarget[];
}

export interface SimDnisEntry {
  dnis: string;
  scriptNumber: string;
  scriptName: string;
  organizationName?: string;
}

export interface CallflowSimulationModel {
  scripts: SimScript[];
  dnisEntries: SimDnisEntry[];
}

export interface CallSimulationInput {
  startScriptNumber: string;
  dialedDnis?: string;
  weekday: SimulationWeekday;
  timeHHMM: string;
  isHoliday: boolean;
  isSondZeit: boolean;
  dtmfChoices: Record<string, string>;
  dynamicOverrides: Record<string, boolean>;
  queueMode?: SimulationQueueMode;
  maxWaitOverrideSeconds?: number;
}

export type CallerEventKind =
  | 'ring'
  | 'announcement'
  | 'music'
  | 'wait'
  | 'dtmf-prompt'
  | 'dtmf-press'
  | 'queue-enter'
  | 'overflow'
  | 'transfer'
  | 'disconnect';

export interface CallerExperienceEvent {
  kind: CallerEventKind;
  label: string;
  text: string;
  elapsedSeconds: number;
  waitAddedSeconds?: number;
  digit?: string;
}

export interface CallSimulationStep {
  index: number;
  scriptNumber: string;
  scriptName: string;
  ruleId?: string;
  prio?: number;
  kind:
    | 'entry'
    | 'rule-matched'
    | 'rule-skipped'
    | 'jump'
    | 'dtmf-prompt'
    | 'dynamic-branch'
    | 'overflow'
    | 'outcome'
    | 'cycle-guard';
  title: string;
  detail: string;
  reason: string;
  statusLabel: string;
  elapsedSeconds: number;
  isOverflowStep?: boolean;
  callerEvent?: CallerExperienceEvent;
  queueTarget?: string;
  announcement?: string;
  treatmentInfo?: string;
  targetScriptNumber?: string;
  targetNodeId?: string;
  fallbackNodeId?: string;
  choices?: SimChoiceOption[];
  dynamicKey?: string;
}

export interface CallSimulationDtmfHistoryItem {
  key: string;
  scriptNumber: string;
  choice: string;
  label?: string;
  targetNumber: string;
}

export interface CallSimulationResult {
  outcomeType:
    | 'queue'
    | 'announcement'
    | 'external'
    | 'disconnect'
    | 'script-end'
    | 'dtmf-wait'
    | 'cycle';
  outcomeTitle: string;
  outcomeDetail: string;
  finalScriptNumber: string;
  finalScriptName: string;
  visitedScripts: string[];
  totalWaitSeconds: number;
  overflowTriggered: boolean;
  missingOverflowTarget?: boolean;
  steps: CallSimulationStep[];
  dtmfHistory: CallSimulationDtmfHistoryItem[];
  pendingDtmf?: {
    key: string;
    scriptNumber: string;
    scriptName: string;
    choices: SimChoiceOption[];
  };
  dynamicPrompts: Array<{
    key: string;
    scriptNumber: string;
    scriptName: string;
    prio: number;
    label: string;
    active: boolean;
    autoActivatedByQueueMode?: boolean;
  }>;
}

export interface ScenarioMatrixPreset {
  id: string;
  label: string;
  shortTime: string;
  weekday: SimulationWeekday;
  timeHHMM: string;
  isHoliday: boolean;
  isSondZeit: boolean;
}

export interface ScenarioMatrixRow {
  preset: ScenarioMatrixPreset;
  outcomeType: CallSimulationResult['outcomeType'];
  statusLabel: string;
  outcomeTitle: string;
  totalWaitSeconds: number;
  visitedScripts: string[];
  stepCount: number;
  overflowTriggered: boolean;
  missingOverflowTarget: boolean;
  needsDtmf: boolean;
}

export const SCENARIO_MATRIX_PRESETS: ScenarioMatrixPreset[] = [
  { id: 'workday', label: 'Werktag', shortTime: 'Mo 10:00', weekday: 'mo', timeHHMM: '10:00', isHoliday: false, isSondZeit: false },
  { id: 'evening', label: 'Abend', shortTime: 'Di 20:00', weekday: 'di', timeHHMM: '20:00', isHoliday: false, isSondZeit: false },
  { id: 'saturday', label: 'Samstag', shortTime: 'Sa 11:00', weekday: 'sa', timeHHMM: '11:00', isHoliday: false, isSondZeit: false },
  { id: 'sunday', label: 'Sonntag', shortTime: 'So 12:00', weekday: 'so', timeHHMM: '12:00', isHoliday: false, isSondZeit: false },
  { id: 'holiday', label: 'Feiertag', shortTime: 'Mo 10:00 · FT', weekday: 'mo', timeHHMM: '10:00', isHoliday: true, isSondZeit: false },
  { id: 'sondzeit', label: 'SondZeit / Notfall', shortTime: 'Mo 10:00 · SZ', weekday: 'mo', timeHHMM: '10:00', isHoliday: false, isSondZeit: true },
];

export const QUEUE_MODE_OPTIONS: Array<{
  id: SimulationQueueMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'normal',
    label: 'Normal (Agent frei)',
    shortLabel: 'Normal',
    description: 'Anruf wird bei Erreichen der ersten passenden Warteschlange zugestellt.',
  },
  {
    id: 'no-agents',
    label: 'Keine Agenten',
    shortLabel: 'Unbesetzt',
    description: 'Simuliert unbesetztes Skillset (NOT LOGGED / Not Staffed) und prüft Überlauf-Ziele.',
  },
  {
    id: 'queue-full',
    label: 'Queue voll / Besetzt',
    shortLabel: 'Besetzt',
    description: 'Simuliert volle Warteschlange (BUSY / FULL) und prüft nachgelagerte Ausweichziele.',
  },
  {
    id: 'wait-timeout',
    label: 'Wartezeit-Überlauf',
    shortLabel: 'Timeout',
    description: 'Simuliert Wartezeit-Ablauf (EWT / Wait Timeout) und verfolgt den Überlauf-Pfad.',
  },
];

export function formatSecondsMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const WEEKDAY_ORDER: SimulationWeekday[] = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];

const DAY_TOKEN_MAP: Record<string, SimulationWeekday> = {
  mo: 'mo',
  mon: 'mo',
  montag: 'mo',
  monday: 'mo',
  di: 'di',
  die: 'di',
  tue: 'di',
  dienstag: 'di',
  tuesday: 'di',
  mi: 'mi',
  mit: 'mi',
  wed: 'mi',
  mittwoch: 'mi',
  wednesday: 'mi',
  do: 'do',
  don: 'do',
  thu: 'do',
  donnerstag: 'do',
  thursday: 'do',
  fr: 'fr',
  fre: 'fr',
  fri: 'fr',
  freitag: 'fr',
  friday: 'fr',
  sa: 'sa',
  sam: 'sa',
  sat: 'sa',
  samstag: 'sa',
  saturday: 'sa',
  so: 'so',
  son: 'so',
  sun: 'so',
  sonntag: 'so',
  sunday: 'so',
};

export function getDefaultWeekdayAndTime(): {
  weekday: SimulationWeekday;
  timeHHMM: string;
} {
  const now = new Date();
  const jsDay = now.getDay(); // 0=Sun..6=Sat
  const map: SimulationWeekday[] = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'];
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return {
    weekday: map[jsDay] || 'mo',
    timeHHMM: `${hh}:${mm}`,
  };
}

export function parseClockToMinutes(raw: string): number | null {
  const clean = String(raw || '').trim();
  const m = clean.match(/^(\d{1,2})[:.](\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h <= 24 && min >= 0 && min < 60) {
      return Math.min(24 * 60, h * 60 + min);
    }
  }
  const mCompact = clean.match(/^(\d{2})(\d{2})$/);
  if (mCompact) {
    const h = Number(mCompact[1]);
    const min = Number(mCompact[2]);
    if (h >= 0 && h <= 24 && min >= 0 && min < 60) {
      return Math.min(24 * 60, h * 60 + min);
    }
  }
  const mHourOnly = clean.match(/^(\d{1,2})\s*(?:uhr|h)?$/i);
  if (mHourOnly) {
    const h = Number(mHourOnly[1]);
    if (h >= 0 && h <= 24) return h * 60;
  }
  return null;
}

export function extractWeekdaysFromText(text: string): SimulationWeekday[] {
  const src = String(text || '').toLowerCase();
  const found = new Set<SimulationWeekday>();

  if (/\b(24\/7|immer|täglich|taeglich|daily|mo\s*[-–]\s*so)\b/i.test(src)) {
    return [...WEEKDAY_ORDER];
  }
  if (/\b(werktag|werktags|wochentag|wochentags|weekdays?)\b/i.test(src)) {
    ['mo', 'di', 'mi', 'do', 'fr'].forEach((d) => found.add(d as SimulationWeekday));
  }
  if (/\b(wochenende|weekend)\b/i.test(src)) {
    found.add('sa');
    found.add('so');
  }

  // Day ranges like Mo-Fr, Mon-Thu, Sa-So
  const rangeRegex =
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|mo|di|mi|do|fr|sa|so)\s*(?:-|–|bis|to|\.\.)\s*(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|mo|di|mi|do|fr|sa|so)\b/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rangeRegex.exec(src)) !== null) {
    const startDay = DAY_TOKEN_MAP[rm[1].toLowerCase()];
    const endDay = DAY_TOKEN_MAP[rm[2].toLowerCase()];
    if (startDay && endDay) {
      const si = WEEKDAY_ORDER.indexOf(startDay);
      const ei = WEEKDAY_ORDER.indexOf(endDay);
      if (si <= ei) {
        for (let i = si; i <= ei; i++) found.add(WEEKDAY_ORDER[i]);
      } else {
        for (let i = si; i < WEEKDAY_ORDER.length; i++) found.add(WEEKDAY_ORDER[i]);
        for (let i = 0; i <= ei; i++) found.add(WEEKDAY_ORDER[i]);
      }
    }
  }

  // Standalone day tokens
  const singleRegex =
    /\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|mo|di|mi|do|fr|sa|so)\b/gi;
  let sm: RegExpExecArray | null;
  while ((sm = singleRegex.exec(src)) !== null) {
    const day = DAY_TOKEN_MAP[sm[1].toLowerCase()];
    if (day) found.add(day);
  }

  return WEEKDAY_ORDER.filter((d) => found.has(d));
}

export function extractTimeRangesFromText(text: string): SimTimeRange[] {
  const src = String(text || '');
  const ranges: SimTimeRange[] = [];
  const seen = new Set<string>();

  // Explicit ranges: 08:00-17:00, 08:00 bis 17:30, 8:00..16:00, 08.00 - 17.00
  const rangeRegex =
    /(\d{1,2}[:.]\d{2})\s*(?:-|–|—|bis|to|\.\.)\s*(\d{1,2}[:.]\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = rangeRegex.exec(src)) !== null) {
    const s = parseClockToMinutes(m[1]);
    const e = parseClockToMinutes(m[2]);
    if (s !== null && e !== null) {
      const key = `${s}-${e}`;
      if (!seen.has(key)) {
        seen.add(key);
        ranges.push({ startMin: s, endMin: e, raw: `${m[1]}-${m[2]}` });
      }
    }
  }

  // Hour-only ranges with "Uhr" e.g. 8-17 Uhr
  const hourRangeRegex = /\b(\d{1,2})\s*(?:-|–|bis)\s*(\d{1,2})\s*uhr\b/gi;
  while ((m = hourRangeRegex.exec(src)) !== null) {
    const sh = Number(m[1]);
    const eh = Number(m[2]);
    if (sh >= 0 && sh <= 24 && eh >= 0 && eh <= 24) {
      const s = sh * 60;
      const e = eh * 60;
      const key = `${s}-${e}`;
      if (!seen.has(key)) {
        seen.add(key);
        ranges.push({
          startMin: s,
          endMin: e,
          raw: `${String(sh).padStart(2, '0')}:00-${String(eh).padStart(2, '0')}:00`,
        });
      }
    }
  }

  // Open-ended comparisons: >= 18:00, ab 18:00, nach 18:00, < 08:00, vor 08:00
  if (ranges.length === 0) {
    const gteMatch = src.match(/(?:>=|>|\bab\b|\bnach\b|\bafter\b)\s*(\d{1,2}[:.]\d{2})/i);
    if (gteMatch) {
      const s = parseClockToMinutes(gteMatch[1]);
      if (s !== null) {
        ranges.push({ startMin: s, endMin: 24 * 60, raw: `>= ${gteMatch[1]}` });
      }
    }
    const lteMatch = src.match(/(?:<=|<|\bvor\b|\bbefore\b|\bbis\b)\s*(\d{1,2}[:.]\d{2})/i);
    if (lteMatch) {
      const e = parseClockToMinutes(lteMatch[1]);
      if (e !== null) {
        ranges.push({ startMin: 0, endMin: e, raw: `<= ${lteMatch[1]}` });
      }
    }
  }

  return ranges;
}

function isDynamicRuntimeConditionText(cond?: string): boolean {
  if (!cond) return false;
  return /\b(NOT\s+LOGGED|LOGGED|STAFFED|AVAILABLE|AGENT|WAIT|EWT|EXPECTED|QUEUE\s+COUNT|CALLS\s+WAITING|OUT\s+OF\s+SERVICE|OVERFLOW|BUSY|FULL|CLOSED_QUEUE|SKILLSET\s+STATE|NOT\s+IN\s+SERVICE|KEINE\s+AGENTEN|UNBESETZT|BESETZT|ÜBERLAUF|UEBERLAUF)\b/i.test(
    cond
  );
}

function classifyDynamicCategory(text?: string): SimDynamicCategory {
  if (!text) return 'other';
  if (/\b(NOT\s+LOGGED|LOGGED|STAFFED|AVAILABLE|AGENT|OUT\s+OF\s+SERVICE|NOT\s+IN\s+SERVICE|CLOSED_QUEUE|KEINE\s+AGENTEN|UNBESETZT)\b/i.test(text)) {
    return 'no-agents';
  }
  if (/\b(BUSY|FULL|QUEUE\s+COUNT|CALLS\s+WAITING|BESETZT|VOLL)\b/i.test(text)) {
    return 'queue-full';
  }
  if (/\b(WAIT|EWT|EXPECTED|TIMEOUT|OVERFLOW|ÜBERLAUF|UEBERLAUF)\b/i.test(text)) {
    return 'wait-timeout';
  }
  return 'other';
}

function isOverflowRuleText(rule: ScriptRule): boolean {
  const combined = `${rule.stepName || ''} ${rule.condition || ''} ${rule.rawLine || ''} ${rule.queueTarget || ''}`;
  return /\b(überlauf|ueberlauf|overflow|fallback|ausweich|notziel|sys_retour_zentrale|retour|besetzt|busy|full|ewt|timeout|not\s+logged|keine\s+agenten)\b/i.test(
    combined
  );
}

function isHolidayRuleText(rule: ScriptRule): boolean {
  const combined = `${rule.holiday || ''} ${rule.schedule || ''} ${rule.condition || ''} ${rule.stepName || ''}`;
  return /\b(feiertag|feiertage|holiday|holidays|ft_|feiertagsregel)\b/i.test(combined);
}

function isSondZeitRuleText(rule: ScriptRule): boolean {
  const combined = `${rule.schedule || ''} ${rule.condition || ''} ${rule.stepName || ''} ${rule.rawLine || ''}`;
  return /\b(sondzeit|sonderzeit|notfall|emergency|störung|stoerung|special_time|sonderöffnung)\b/i.test(
    combined
  );
}

function isTimeConditionText(text: string): boolean {
  return /\b(time|uhr|mo|di|mi|do|fr|sa|so|werktag|wochenende|24\/7|öffnet|geöffnet|geschlossen)\b|\d{1,2}[:.]\d{2}/i.test(
    text
  );
}

export function buildCallflowSimulationModel(
  workspace: ScriptWorkspace | null
): CallflowSimulationModel {
  if (!workspace || !workspace.modules || workspace.modules.length === 0) {
    return { scripts: [], dnisEntries: [] };
  }

  const dnisEntries: SimDnisEntry[] = [];
  const dnisSeen = new Set<string>();
  const manualLinks = workspace.manualLinks || [];

  const scripts: SimScript[] = workspace.modules.map((mod: ScriptModule) => {
    const entryDnis = Array.from(
      new Set(
        (mod.entryDnisNumbers || [])
          .map((d) => String(d || '').trim())
          .filter(Boolean)
      )
    );

    entryDnis.forEach((dnis) => {
      const key = `${dnis}|${mod.scriptNumber}`;
      if (!dnisSeen.has(key)) {
        dnisSeen.add(key);
        dnisEntries.push({
          dnis,
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName || mod.scriptNumber,
          organizationName: mod.entryOrganizationName,
        });
      }
    });

    const modSuffix = toMermaidNodeSuffix(mod.scriptNumber);
    const entryNodeId = `SELF_${modSuffix}`;
    const sortedRules = [...(mod.rules || [])].sort((a, b) => a.prio - b.prio);

    // Collect manual links originating from this module (matching number, alias, suffix, or name)
    const modAliasSet = new Set<string>([
      canonicalScriptMatchKey(mod.scriptNumber),
      canonicalScriptMatchKey(modSuffix),
    ]);
    if (mod.cdnAlias) modAliasSet.add(canonicalScriptMatchKey(mod.cdnAlias));
    if (mod.scriptName && mod.scriptName.trim().length >= 3) {
      modAliasSet.add(canonicalScriptMatchKey(mod.scriptName));
      modAliasSet.add(canonicalScriptMatchKey(mod.scriptName.trim().replace(/\s+/g, '_')));
    }

    const modManualTargets: SimManualTarget[] = manualLinks
      .filter((lnk) => modAliasSet.has(canonicalScriptMatchKey(lnk.fromScriptNumber)))
      .map((lnk) => ({
        toTargetNumber: lnk.toTargetNumber,
        fromRuleId: lnk.fromRuleId || undefined,
        label: lnk.label || lnk.note || undefined,
      }));

    const simRules: SimRule[] = sortedRules.map((rule, ruleIdx) => {
      const schedCombined = [rule.schedule, rule.holiday, rule.condition]
        .filter(Boolean)
        .join(' · ');
      const weekdays = extractWeekdaysFromText(schedCombined);
      const timeRanges = extractTimeRangesFromText(schedCombined);
      const isAlwaysOpen = /\b(24\/7|immer\s+geöffnet|rund\s+um\s+die\s+uhr)\b/i.test(
        schedCombined
      );
      const isHolidayRule = isHolidayRuleText(rule);
      const isSondZeitRule = isSondZeitRuleText(rule);
      const dynSource = `${rule.condition || ''} ${rule.rawLine || ''}`;
      const isDynamic =
        !isHolidayRule &&
        !isSondZeitRule &&
        timeRanges.length === 0 &&
        weekdays.length === 0 &&
        isDynamicRuntimeConditionText(dynSource);
      const dynamicCategory = isDynamic ? classifyDynamicCategory(dynSource) : undefined;
      const isOverflowRule = isOverflowRuleText(rule);

      const dnisValues = (rule.valueNumbers || [])
        .map((v) => String(v || '').trim())
        .filter(Boolean);

      dnisValues.forEach((dnis) => {
        const targetScript = rule.targetNumber || mod.scriptNumber;
        const key = `${dnis}|${targetScript}`;
        if (!dnisSeen.has(key)) {
          dnisSeen.add(key);
          dnisEntries.push({
            dnis,
            scriptNumber: mod.scriptNumber,
            scriptName: mod.scriptName || mod.scriptNumber,
            organizationName: rule.organizationName || mod.entryOrganizationName,
          });
        }
      });

      const stepNodeId = `STEP_${modSuffix}_${ruleIdx + 1}`;

      return {
        id: rule.id,
        ruleIndex: ruleIdx + 1,
        stepNodeId,
        prio: rule.prio,
        stepName: rule.stepName || `Prio ${rule.prio}`,
        scheduleRaw: rule.schedule || undefined,
        weekdays: weekdays.length > 0 ? weekdays : undefined,
        timeRanges: timeRanges.length > 0 ? timeRanges : undefined,
        isAlwaysOpen: isAlwaysOpen || undefined,
        isHolidayRule: isHolidayRule || undefined,
        isSondZeitRule: isSondZeitRule || undefined,
        conditionRaw: rule.condition || undefined,
        isDynamicCondition: isDynamic || undefined,
        dynamicCategory,
        isOverflowRule: isOverflowRule || undefined,
        dnisMatchValues: dnisValues.length > 0 ? dnisValues : undefined,
        targetNumber: rule.targetNumber || undefined,
        queueTarget: rule.queueTarget || undefined,
        announcement: rule.announcement || undefined,
        treatmentInfo: rule.treatmentInfo || undefined,
        waitSeconds: typeof rule.waitSeconds === 'number' ? rule.waitSeconds : undefined,
        isDisconnect: rule.isDisconnect || undefined,
        isExternalRoute: rule.isExternalRouteCall || undefined,
        organizationName: rule.organizationName || undefined,
        choices:
          rule.choices && rule.choices.length > 0
            ? rule.choices.map((c, cIdx) => ({
                choice: c.choice,
                targetNumber: c.targetNumber,
                label: c.label,
                choiceNodeId: `CHOICE_${modSuffix}_${ruleIdx}_${cIdx}`,
              }))
            : undefined,
      };
    });

    return {
      scriptNumber: mod.scriptNumber,
      scriptName: mod.scriptName || mod.scriptNumber,
      entryNodeId,
      cdnAlias: mod.cdnAlias || undefined,
      isMaster: Boolean(mod.isMaster),
      entryDnisNumbers: entryDnis,
      organizationName: mod.entryOrganizationName || undefined,
      rules: simRules,
      manualTargets: modManualTargets.length > 0 ? modManualTargets : undefined,
    };
  });

  dnisEntries.sort((a, b) => a.dnis.localeCompare(b.dnis, 'de', { numeric: true }));

  return { scripts, dnisEntries };
}

function timeMatchesRange(timeMin: number, range: SimTimeRange): boolean {
  if (range.startMin <= range.endMin) {
    return timeMin >= range.startMin && timeMin < range.endMin;
  }
  // Overnight window e.g. 22:00 - 06:00
  return timeMin >= range.startMin || timeMin < range.endMin;
}

function normalizeDnisDigits(raw: string): string {
  return String(raw || '').replace(/[^0-9+*#]/g, '');
}

function dnisMatchesPattern(dialed: string, pattern: string): boolean {
  const d = normalizeDnisDigits(dialed);
  const p = normalizeDnisDigits(pattern);
  if (!d || !p) return false;
  if (d === p) return true;
  if (p.endsWith('*') || pattern.toLowerCase().includes('x')) {
    const prefix = p.replace(/\*+$/, '');
    if (prefix && d.startsWith(prefix)) return true;
  }
  if (d.endsWith(p) || p.endsWith(d)) return true;
  return false;
}

function describeQueueModeReason(mode: SimulationQueueMode, waitSec: number): string {
  if (mode === 'no-agents') return 'Keine Agenten eingeloggt (Not Staffed) — Überlauf ausgelöst';
  if (mode === 'queue-full') return 'Warteschlange voll / besetzt — Überlauf ausgelöst';
  if (mode === 'wait-timeout') return `Wartezeit-Überlauf nach ${waitSec} s (EWT/Timeout)`;
  return 'Standard-Zustellung';
}

export function simulateCallflow(
  model: CallflowSimulationModel,
  input: CallSimulationInput
): CallSimulationResult {
  const byKey = new Map<string, SimScript>();
  const registerScriptAlias = (key: string | undefined, script: SimScript) => {
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, script);
    const canon = canonicalScriptMatchKey(key);
    if (canon && !byKey.has(canon)) byKey.set(canon, script);
  };

  model.scripts.forEach((s) => {
    byKey.set(s.scriptNumber, s);
    byKey.set(canonicalScriptMatchKey(s.scriptNumber), s);
    registerScriptAlias(toMermaidNodeSuffix(s.scriptNumber), s);
    registerScriptAlias(s.cdnAlias, s);
    const trimmedName = (s.scriptName || '').trim();
    if (trimmedName.length >= 3 && !/^(?:main|start)$/i.test(trimmedName)) {
      registerScriptAlias(trimmedName, s);
      registerScriptAlias(trimmedName.replace(/\s+/g, '_'), s);
    }
  });

  const resolveScript = (ref: string | undefined): SimScript | undefined => {
    if (!ref) return undefined;
    return byKey.get(ref) || byKey.get(canonicalScriptMatchKey(ref));
  };

  const startScript =
    resolveScript(input.startScriptNumber) ||
    model.scripts.find((s) => s.isMaster) ||
    model.scripts[0];

  if (!startScript) {
    return {
      outcomeType: 'script-end',
      outcomeTitle: 'Kein Skript verfügbar',
      outcomeDetail: 'Es sind keine auswertbaren Callflow-Skripte im aktuellen Workspace geladen.',
      finalScriptNumber: '',
      finalScriptName: '',
      visitedScripts: [],
      totalWaitSeconds: 0,
      overflowTriggered: false,
      steps: [],
      dtmfHistory: [],
      dynamicPrompts: [],
    };
  }

  const queueMode: SimulationQueueMode = input.queueMode || 'normal';
  const defaultOverflowWaitSec = Math.max(5, input.maxWaitOverrideSeconds ?? 30);
  const timeMin = parseClockToMinutes(input.timeHHMM) ?? 10 * 60;
  const steps: CallSimulationStep[] = [];
  const visitedScripts: string[] = [];
  const dynamicPrompts: CallSimulationResult['dynamicPrompts'] = [];
  const dtmfHistory: CallSimulationDtmfHistoryItem[] = [];
  let totalWaitSeconds = 0;
  let elapsedSeconds = 0;
  let overflowTriggered = false;
  let overflowQueueName: string | undefined;
  let current: SimScript | undefined = startScript;
  let hopCount = 0;
  const maxHops = 24;
  let lastAnnouncement: string | undefined;

  const weekdayLabelMap: Record<SimulationWeekday, string> = {
    mo: 'Mo',
    di: 'Di',
    mi: 'Mi',
    do: 'Do',
    fr: 'Fr',
    sa: 'Sa',
    so: 'So',
  };

  const queueModeShort = QUEUE_MODE_OPTIONS.find((q) => q.id === queueMode)?.shortLabel;

  steps.push({
    index: 1,
    scriptNumber: startScript.scriptNumber,
    scriptName: startScript.scriptName,
    kind: 'entry',
    title: `Anruf-Eingang: ${startScript.scriptNumber} · ${startScript.scriptName}`,
    detail: [
      input.dialedDnis ? `DNIS ${input.dialedDnis}` : null,
      `${weekdayLabelMap[input.weekday]} ${input.timeHHMM}`,
      input.isHoliday ? 'Feiertag aktiv' : null,
      input.isSondZeit ? 'SondZeit aktiv' : null,
      queueMode !== 'normal' && queueModeShort ? `Queue-Test: ${queueModeShort}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    reason: 'Startpunkt der Simulation',
    statusLabel: 'Start',
    elapsedSeconds: 0,
    callerEvent: {
      kind: 'ring',
      label: 'Anrufaufbau',
      text: input.dialedDnis
        ? `Anrufer wählt ${input.dialedDnis} (${startScript.scriptName})`
        : `Eingehender Anruf auf ${startScript.scriptName} (${startScript.scriptNumber})`,
      elapsedSeconds: 0,
    },
    targetNodeId: startScript.entryNodeId,
    fallbackNodeId: `S_${toMermaidNodeSuffix(startScript.scriptNumber)}`,
  });

  while (current && hopCount < maxHops) {
    hopCount++;
    if (visitedScripts.includes(current.scriptNumber)) {
      steps.push({
        index: steps.length + 1,
        scriptNumber: current.scriptNumber,
        scriptName: current.scriptName,
        kind: 'cycle-guard',
        title: `Rücksprung / Zyklus erkannt (${current.scriptNumber})`,
        detail: `Skript ${current.scriptNumber} wurde bereits durchlaufen. Simulation gestoppt.`,
        reason: 'Zyklus-Schutz verhindert Endlosschleife',
        statusLabel: 'Zyklus',
        elapsedSeconds,
        callerEvent: {
          kind: 'overflow',
          label: 'Rücksprung',
          text: `Rücksprung zu Skript ${current.scriptNumber} (${current.scriptName}) erkannt`,
          elapsedSeconds,
        },
        targetNodeId: current.entryNodeId,
        fallbackNodeId: `S_${toMermaidNodeSuffix(current.scriptNumber)}`,
      });
      return {
        outcomeType: 'cycle',
        outcomeTitle: `Zyklus bei Skript ${current.scriptNumber}`,
        outcomeDetail: `Das Routing springt zurück zu ${current.scriptNumber} (${current.scriptName}).`,
        finalScriptNumber: current.scriptNumber,
        finalScriptName: current.scriptName,
        visitedScripts,
        totalWaitSeconds,
        overflowTriggered,
        steps,
        dtmfHistory,
        dynamicPrompts,
      };
    }

    if (visitedScripts.length > 0) {
      steps.push({
        index: steps.length + 1,
        scriptNumber: current.scriptNumber,
        scriptName: current.scriptName,
        kind: 'entry',
        title: `Eintritt in Zielskript ${current.scriptNumber} · ${current.scriptName}`,
        detail: `${current.rules.length} Routing-Regeln werden nach Priorität geprüft.`,
        reason: 'Automatischer Wechsel in das aufgerufene Zielskript',
        statusLabel: 'Skript-Wechsel',
        elapsedSeconds,
        targetNodeId: current.entryNodeId,
        fallbackNodeId: `S_${toMermaidNodeSuffix(current.scriptNumber)}`,
      });
    }

    visitedScripts.push(current.scriptNumber);
    let jumpedToNext: SimScript | undefined;
    let terminated = false;
    let localOverflowPending = false;
    let skippedQueueTargetsInThisScript = 0;

    for (let rIdx = 0; rIdx < current.rules.length; rIdx++) {
      const rule = current.rules[rIdx];
      let matched = true;
      let reason = 'Standard-Regel (bedingungslos)';

      // 1. DNIS / Value match (especially on Master Dispatcher scripts)
      if (rule.dnisMatchValues && rule.dnisMatchValues.length > 0) {
        if (input.dialedDnis && input.dialedDnis.trim()) {
          const hit = rule.dnisMatchValues.some((val) =>
            dnisMatchesPattern(input.dialedDnis || '', val)
          );
          if (!hit) {
            matched = false;
            reason = `DNIS ${input.dialedDnis} passt nicht zu ${rule.dnisMatchValues.slice(0, 3).join(', ')}`;
          } else {
            reason = `DNIS ${input.dialedDnis} trifft Regel (${rule.dnisMatchValues.slice(0, 2).join(', ')})`;
          }
        } else if (current.isMaster) {
          matched = false;
          reason = `Wartet auf passende DNIS (${rule.dnisMatchValues.slice(0, 2).join(', ')})`;
        }
      }

      // 2. Holiday rule check
      if (matched && rule.isHolidayRule) {
        if (input.isHoliday) {
          reason = 'Feiertag ist aktiv — Feiertagsregel greift';
        } else {
          matched = false;
          reason = 'Kein Feiertag aktiv — Feiertagsregel übersprungen';
        }
      }

      // 3. SondZeit rule check
      if (matched && rule.isSondZeitRule) {
        if (input.isSondZeit) {
          reason = 'SondZeit ist aktiv — Sonderregel greift';
        } else {
          matched = false;
          reason = 'SondZeit inaktiv — Sonderregel übersprungen';
        }
      }

      // 4. Weekday & Time window checks
      if (matched && !rule.isAlwaysOpen) {
        const hasDays = Boolean(rule.weekdays && rule.weekdays.length > 0);
        const hasTimes = Boolean(rule.timeRanges && rule.timeRanges.length > 0);
        if (hasDays || hasTimes) {
          const dayOk = !hasDays || (rule.weekdays || []).includes(input.weekday);
          const timeOk =
            !hasTimes || (rule.timeRanges || []).some((r) => timeMatchesRange(timeMin, r));
          const isNegated =
            /\b(nicht|not|außerhalb|ausserhalb|closed|geschlossen|else|sonst)\b/i.test(
              `${rule.conditionRaw || ''} ${rule.stepName || ''}`
            );

          const windowHit = dayOk && timeOk;
          const finalHit = isNegated ? !windowHit : windowHit;

          const winDesc = [
            hasDays ? (rule.weekdays || []).map((d) => weekdayLabelMap[d]).join(',') : null,
            hasTimes ? (rule.timeRanges || []).map((r) => r.raw).join(' / ') : null,
          ]
            .filter(Boolean)
            .join(' ');

          if (!finalHit) {
            matched = false;
            reason = isNegated
              ? `Innerhalb ${winDesc} — Ausschlussregel nicht erfüllt`
              : `Außerhalb Zeitfenster (${winDesc})`;
          } else {
            reason = isNegated
              ? `Außerhalb ${winDesc} — Ausschlussregel erfüllt`
              : `Zeitfenster erfüllt (${winDesc})`;
          }
        }
      } else if (matched && rule.isAlwaysOpen) {
        reason = '24/7 Regel (immer aktiv)';
      }

      // 5. Dynamic runtime condition (Agents logged in / EWT / Queue overflow)
      if (matched && rule.isDynamicCondition) {
        const dynKey = `${current.scriptNumber}:${rule.id}`;
        const hasExplicitOverride = Object.prototype.hasOwnProperty.call(
          input.dynamicOverrides,
          dynKey
        );
        const autoMatchedByQueueMode =
          queueMode !== 'normal' &&
          (rule.dynamicCategory === queueMode ||
            (queueMode === 'wait-timeout' && Boolean(rule.isOverflowRule)));
        const isActive = hasExplicitOverride
          ? input.dynamicOverrides[dynKey] === true
          : autoMatchedByQueueMode;

        dynamicPrompts.push({
          key: dynKey,
          scriptNumber: current.scriptNumber,
          scriptName: current.scriptName,
          prio: rule.prio,
          label: rule.conditionRaw || rule.stepName,
          active: isActive,
          autoActivatedByQueueMode: !hasExplicitOverride && autoMatchedByQueueMode,
        });

        if (!isActive) {
          matched = false;
          reason = `Laufzeit-Bedingung inaktiv (umschaltbar): ${rule.conditionRaw || rule.stepName}`;
        } else if (!hasExplicitOverride && autoMatchedByQueueMode) {
          overflowTriggered = true;
          reason = `Aktiviert durch Queue-Test (${queueModeShort}): ${rule.conditionRaw || rule.stepName}`;
        } else {
          reason = `Laufzeit-Bedingung manuell aktiviert: ${rule.conditionRaw || rule.stepName}`;
        }
      }

      if (!matched) {
        steps.push({
          index: steps.length + 1,
          scriptNumber: current.scriptNumber,
          scriptName: current.scriptName,
          ruleId: rule.id,
          prio: rule.prio,
          kind: 'rule-skipped',
          title: `Prio ${rule.prio} · ${rule.stepName}`,
          detail: rule.conditionRaw || rule.scheduleRaw || 'Bedingung nicht erfüllt',
          reason,
          statusLabel: 'Übersprungen',
          elapsedSeconds,
          targetNodeId: rule.stepNodeId,
          fallbackNodeId: current.entryNodeId,
          dynamicKey: rule.isDynamicCondition ? `${current.scriptNumber}:${rule.id}` : undefined,
        });
        continue;
      }

      // Rule matched! Track wait time & announcement
      const ruleWait = typeof rule.waitSeconds === 'number' && rule.waitSeconds > 0 ? rule.waitSeconds : 0;
      if (ruleWait > 0) {
        totalWaitSeconds += ruleWait;
        elapsedSeconds += ruleWait;
      } else if (rule.announcement) {
        elapsedSeconds += 5; // Typical short announcement duration for caller timeline
      }
      if (rule.announcement) {
        lastAnnouncement = rule.announcement;
      }

      // DTMF Menu?
      if (rule.choices && rule.choices.length > 0) {
        const dtmfKey = `${current.scriptNumber}:${rule.id}`;
        const chosenDigit = input.dtmfChoices[dtmfKey];
        const chosenOpt = chosenDigit
          ? rule.choices.find((c) => c.choice === chosenDigit)
          : undefined;

        if (!chosenOpt) {
          steps.push({
            index: steps.length + 1,
            scriptNumber: current.scriptNumber,
            scriptName: current.scriptName,
            ruleId: rule.id,
            prio: rule.prio,
            kind: 'dtmf-prompt',
            title: `Prio ${rule.prio} · Auswahlmenü (DTMF)`,
            detail: rule.announcement
              ? `Ansage „${rule.announcement}“ · ${rule.choices.length} Ziffern verfügbar`
              : `${rule.choices.length} Ziffern verfügbar — Taste über Tastenfeld wählen.`,
            reason,
            statusLabel: 'Wahl nötig',
            elapsedSeconds,
            announcement: rule.announcement,
            callerEvent: {
              kind: 'dtmf-prompt',
              label: 'Sprachmenü (DTMF)',
              text: rule.announcement
                ? `Hört „${rule.announcement}“ — wartet auf Eingabe (${rule.choices.map((c) => c.choice).join(', ')})`
                : `Auswahlmenü aktiv — verfügbare Tasten: ${rule.choices.map((c) => `${c.choice}${c.label ? ` (${c.label})` : ''}`).join(', ')}`,
              elapsedSeconds,
            },
            targetNodeId: rule.stepNodeId,
            fallbackNodeId: current.entryNodeId,
            choices: rule.choices,
          });
          return {
            outcomeType: 'dtmf-wait',
            outcomeTitle: `DTMF-Menü in ${current.scriptNumber} (${current.scriptName})`,
            outcomeDetail: 'Wählen Sie eine Zifferntaste aus, um den weiteren Callflow zu prüfen.',
            finalScriptNumber: current.scriptNumber,
            finalScriptName: current.scriptName,
            visitedScripts,
            totalWaitSeconds,
            overflowTriggered,
            steps,
            dtmfHistory,
            pendingDtmf: {
              key: dtmfKey,
              scriptNumber: current.scriptNumber,
              scriptName: current.scriptName,
              choices: rule.choices,
            },
            dynamicPrompts,
          };
        }

        dtmfHistory.push({
          key: dtmfKey,
          scriptNumber: current.scriptNumber,
          choice: chosenOpt.choice,
          label: chosenOpt.label,
          targetNumber: chosenOpt.targetNumber,
        });

        steps.push({
          index: steps.length + 1,
          scriptNumber: current.scriptNumber,
          scriptName: current.scriptName,
          ruleId: rule.id,
          prio: rule.prio,
          kind: 'jump',
          title: `Prio ${rule.prio} · Taste ${chosenOpt.choice} gewählt`,
          detail: `Weiterleitung zu ${chosenOpt.targetNumber}${chosenOpt.label ? ` (${chosenOpt.label})` : ''}`,
          reason: `DTMF-Auswahl Taste ${chosenOpt.choice}`,
          statusLabel: 'Erfüllt',
          elapsedSeconds,
          callerEvent: {
            kind: 'dtmf-press',
            label: `Taste [${chosenOpt.choice}]`,
            text: `Anrufer drückt [${chosenOpt.choice}]${chosenOpt.label ? ` — ${chosenOpt.label}` : ''} → Ziel ${chosenOpt.targetNumber}`,
            elapsedSeconds,
            digit: chosenOpt.choice,
          },
          targetScriptNumber: chosenOpt.targetNumber,
          targetNodeId: chosenOpt.choiceNodeId || rule.stepNodeId,
          fallbackNodeId: rule.stepNodeId,
        });

        const nextScript = resolveScript(chosenOpt.targetNumber);
        if (nextScript) {
          jumpedToNext = nextScript;
          break;
        }
        return {
          outcomeType: 'external',
          outcomeTitle: `Weiterleitung an Ziel ${chosenOpt.targetNumber}`,
          outcomeDetail: `Taste ${chosenOpt.choice} routet an ${chosenOpt.targetNumber}${chosenOpt.label ? ` (${chosenOpt.label})` : ''}.`,
          finalScriptNumber: current.scriptNumber,
          finalScriptName: current.scriptName,
          visitedScripts,
          totalWaitSeconds,
          overflowTriggered,
          steps,
          dtmfHistory,
          dynamicPrompts,
        };
      }

      // Queue routing — respect Queue & Overflow test modes!
      if (rule.queueTarget) {
        const shouldTriggerOverflow =
          queueMode !== 'normal' &&
          skippedQueueTargetsInThisScript === 0 &&
          !localOverflowPending;

        if (shouldTriggerOverflow) {
          const addedWait =
            queueMode === 'wait-timeout'
              ? ruleWait > 0
                ? 0
                : defaultOverflowWaitSec
              : 0;
          if (addedWait > 0) {
            totalWaitSeconds += addedWait;
            elapsedSeconds += addedWait;
          }
          overflowTriggered = true;
          localOverflowPending = true;
          skippedQueueTargetsInThisScript += 1;
          overflowQueueName = rule.queueTarget;
          const overflowReason = describeQueueModeReason(
            queueMode,
            ruleWait > 0 ? ruleWait : defaultOverflowWaitSec
          );

          // Check whether any subsequent rule or manual link exists for overflow
          const remainingRules = current.rules.slice(rIdx + 1);
          const ruleManualLink = (current.manualTargets || []).find(
            (m) => m.fromRuleId === rule.id
          );
          const scriptManualLink = (current.manualTargets || []).find((m) => !m.fromRuleId);
          const hasPossibleOverflowPath =
            remainingRules.length > 0 ||
            Boolean(rule.targetNumber) ||
            Boolean(ruleManualLink) ||
            Boolean(scriptManualLink);

          steps.push({
            index: steps.length + 1,
            scriptNumber: current.scriptNumber,
            scriptName: current.scriptName,
            ruleId: rule.id,
            prio: rule.prio,
            kind: 'overflow',
            title: `Prio ${rule.prio} · Überlauf aus Queue ${rule.queueTarget}`,
            detail: [
              rule.announcement ? `Ansage: ${rule.announcement}` : null,
              rule.treatmentInfo ? `Treatment: ${rule.treatmentInfo}` : null,
              addedWait > 0 || ruleWait > 0
                ? `Wartezeit: ${addedWait > 0 ? addedWait : ruleWait} s`
                : null,
            ]
              .filter(Boolean)
              .join(' · ') || `Queue ${rule.queueTarget} nicht zustellbar`,
            reason: overflowReason,
            statusLabel: 'Überlauf',
            elapsedSeconds,
            isOverflowStep: true,
            queueTarget: rule.queueTarget,
            announcement: rule.announcement,
            treatmentInfo: rule.treatmentInfo,
            callerEvent: {
              kind: 'overflow',
              label: 'Queue-Überlauf',
              text:
                queueMode === 'wait-timeout'
                  ? `Wartet ${addedWait > 0 ? addedWait : ruleWait} s in ${rule.queueTarget}${rule.treatmentInfo ? ` (${rule.treatmentInfo})` : ''} — Überlauf startet`
                  : `${rule.queueTarget}: ${overflowReason}`,
              elapsedSeconds,
              waitAddedSeconds: addedWait > 0 ? addedWait : ruleWait || undefined,
            },
            targetNodeId: rule.stepNodeId,
            fallbackNodeId: current.entryNodeId,
          });

          // If this rule itself carries a fallback targetNumber or manual link, follow it
          if (rule.targetNumber) {
            const nextScript = resolveScript(rule.targetNumber);
            if (nextScript && !rule.isExternalRoute) {
              steps.push({
                index: steps.length + 1,
                scriptNumber: current.scriptNumber,
                scriptName: current.scriptName,
                ruleId: rule.id,
                prio: rule.prio,
                kind: 'jump',
                title: `Überlauf-Sprung → ${nextScript.scriptNumber} (${nextScript.scriptName})`,
                detail: `Übergabe nach Queue-Überlauf aus ${rule.queueTarget}`,
                reason: overflowReason,
                statusLabel: 'Überlauf',
                elapsedSeconds,
                isOverflowStep: true,
                targetScriptNumber: nextScript.scriptNumber,
                callerEvent: {
                  kind: 'transfer',
                  label: 'Überlauf-Ziel',
                  text: `Weiterleitung an Überlauf-Skript ${nextScript.scriptNumber} (${nextScript.scriptName})`,
                  elapsedSeconds,
                },
                targetNodeId: rule.stepNodeId,
                fallbackNodeId: `JUMP_${toMermaidNodeSuffix(nextScript.scriptNumber)}`,
              });
              jumpedToNext = nextScript;
              break;
            }
          } else if (ruleManualLink) {
            const nextScript = resolveScript(ruleManualLink.toTargetNumber);
            if (nextScript) {
              steps.push({
                index: steps.length + 1,
                scriptNumber: current.scriptNumber,
                scriptName: current.scriptName,
                ruleId: rule.id,
                prio: rule.prio,
                kind: 'jump',
                title: `Überlauf (Link) → ${nextScript.scriptNumber} (${nextScript.scriptName})`,
                detail: ruleManualLink.label || `Verknüpftes Überlauf-Skript ${nextScript.scriptNumber}`,
                reason: overflowReason,
                statusLabel: 'Überlauf',
                elapsedSeconds,
                isOverflowStep: true,
                targetScriptNumber: nextScript.scriptNumber,
                callerEvent: {
                  kind: 'transfer',
                  label: 'Überlauf-Ziel',
                  text: `Weiterleitung an ${nextScript.scriptNumber} (${nextScript.scriptName})`,
                  elapsedSeconds,
                },
                targetNodeId: rule.stepNodeId,
                fallbackNodeId: `JUMP_${toMermaidNodeSuffix(nextScript.scriptNumber)}`,
              });
              jumpedToNext = nextScript;
              break;
            }
          }

          if (hasPossibleOverflowPath) {
            continue;
          }

          // No overflow target configured after this queue!
          return {
            outcomeType: 'queue',
            outcomeTitle: `Kein Überlauf nach Queue: ${rule.queueTarget}`,
            outcomeDetail: `${overflowReason} — im Skript ${current.scriptNumber} (${current.scriptName}) folgt jedoch kein Überlauf- oder Fallback-Ziel.`,
            finalScriptNumber: current.scriptNumber,
            finalScriptName: current.scriptName,
            visitedScripts,
            totalWaitSeconds,
            overflowTriggered: true,
            missingOverflowTarget: true,
            steps,
            dtmfHistory,
            dynamicPrompts,
          };
        }

        // Normal queue delivery (or secondary overflow queue reached!)
        const isOverflowDestination = overflowTriggered;
        steps.push({
          index: steps.length + 1,
          scriptNumber: current.scriptNumber,
          scriptName: current.scriptName,
          ruleId: rule.id,
          prio: rule.prio,
          kind: 'outcome',
          title: isOverflowDestination
            ? `Prio ${rule.prio} · Überlauf-Queue ${rule.queueTarget}`
            : `Prio ${rule.prio} · Warteschlange ${rule.queueTarget}`,
          detail: [
            rule.announcement ? `Ansage: ${rule.announcement}` : null,
            rule.treatmentInfo ? `Wartemusik / Treatment: ${rule.treatmentInfo}` : null,
            ruleWait ? `Wartezeit: ${ruleWait} s` : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Anruf wird in Queue zugestellt',
          reason: isOverflowDestination
            ? `Überlauf-Zustellung nach ${overflowQueueName || 'Erst-Queue'} (${reason})`
            : reason,
          statusLabel: isOverflowDestination ? 'Überlauf-Ziel' : 'Ziel erreicht',
          elapsedSeconds,
          isOverflowStep: isOverflowDestination,
          queueTarget: rule.queueTarget,
          announcement: rule.announcement,
          treatmentInfo: rule.treatmentInfo,
          callerEvent: {
            kind: 'queue-enter',
            label: isOverflowDestination ? 'Überlauf-Queue' : 'Warteschlange',
            text: [
              `Zustellung in ${rule.queueTarget}`,
              rule.announcement ? `Ansage: „${rule.announcement}“` : null,
              rule.treatmentInfo ? `Musik/Treatment: ${rule.treatmentInfo}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            elapsedSeconds,
            waitAddedSeconds: ruleWait || undefined,
          },
          targetNodeId: rule.stepNodeId,
          fallbackNodeId: current.entryNodeId,
        });
        return {
          outcomeType: 'queue',
          outcomeTitle: isOverflowDestination
            ? `Überlauf-Queue: ${rule.queueTarget}`
            : `Queue: ${rule.queueTarget}`,
          outcomeDetail: `Zugestellt in Skript ${current.scriptNumber} (${current.scriptName}) über Prio ${rule.prio}.`,
          finalScriptNumber: current.scriptNumber,
          finalScriptName: current.scriptName,
          visitedScripts,
          totalWaitSeconds,
          overflowTriggered,
          steps,
          dtmfHistory,
          dynamicPrompts,
        };
      }

      // Disconnect?
      if (rule.isDisconnect) {
        steps.push({
          index: steps.length + 1,
          scriptNumber: current.scriptNumber,
          scriptName: current.scriptName,
          ruleId: rule.id,
          prio: rule.prio,
          kind: 'outcome',
          title: `Prio ${rule.prio} · Verbindung trennen (Disconnect)`,
          detail: rule.announcement
            ? `Nach Ansage: ${rule.announcement}`
            : 'Anruf wird beendet',
          reason,
          statusLabel: 'Beendet',
          elapsedSeconds,
          announcement: rule.announcement,
          callerEvent: {
            kind: 'disconnect',
            label: 'Aufgelegt',
            text: rule.announcement
              ? `Hört „${rule.announcement}“, danach wird die Verbindung getrennt`
              : 'Verbindung wird systemseitig getrennt (Disconnect)',
            elapsedSeconds,
          },
          targetNodeId: rule.stepNodeId,
          fallbackNodeId: current.entryNodeId,
        });
        return {
          outcomeType: 'disconnect',
          outcomeTitle: 'Verbindung getrennt (Disconnect)',
          outcomeDetail: rule.announcement
            ? `Nach Ansage „${rule.announcement}“ in Skript ${current.scriptNumber} beendet.`
            : `In Skript ${current.scriptNumber} (${current.scriptName}) per Prio ${rule.prio} beendet.`,
          finalScriptNumber: current.scriptNumber,
          finalScriptName: current.scriptName,
          visitedScripts,
          totalWaitSeconds,
          overflowTriggered,
          steps,
          dtmfHistory,
          dynamicPrompts,
        };
      }

      // Jump to target script or external route?
      const ruleManualFallback =
        !rule.targetNumber
          ? (current.manualTargets || []).find((m) => m.fromRuleId === rule.id)
          : undefined;
      const resolvedTargetRef = rule.targetNumber || ruleManualFallback?.toTargetNumber;

      if (resolvedTargetRef) {
        const nextScript = resolveScript(resolvedTargetRef);
        if (nextScript && !rule.isExternalRoute) {
          steps.push({
            index: steps.length + 1,
            scriptNumber: current.scriptNumber,
            scriptName: current.scriptName,
            ruleId: rule.id,
            prio: rule.prio,
            kind: 'jump',
            title: `Prio ${rule.prio} · Sprung zu ${nextScript.scriptNumber} (${nextScript.scriptName})`,
            detail: rule.announcement
              ? `Mit Ansage: ${rule.announcement}`
              : ruleManualFallback?.label
                ? `Verknüpfung (${ruleManualFallback.label}) → ${nextScript.scriptNumber}`
                : `Übergabe an Zielskript ${nextScript.scriptNumber}`,
            reason,
            statusLabel: overflowTriggered ? 'Überlauf' : 'Sprung',
            elapsedSeconds,
            isOverflowStep: overflowTriggered,
            targetScriptNumber: nextScript.scriptNumber,
            announcement: rule.announcement,
            callerEvent: rule.announcement
              ? {
                  kind: 'announcement',
                  label: 'Ansage & Übergabe',
                  text: `Hört „${rule.announcement}“, Weiterleitung an ${nextScript.scriptName}`,
                  elapsedSeconds,
                }
              : {
                  kind: 'transfer',
                  label: 'Weiterleitung',
                  text: `Interne Übergabe an ${nextScript.scriptName} (${nextScript.scriptNumber})`,
                  elapsedSeconds,
                },
            targetNodeId: rule.stepNodeId,
            fallbackNodeId: `JUMP_${toMermaidNodeSuffix(nextScript.scriptNumber)}`,
          });
          jumpedToNext = nextScript;
          break;
        }

        steps.push({
          index: steps.length + 1,
          scriptNumber: current.scriptNumber,
          scriptName: current.scriptName,
          ruleId: rule.id,
          prio: rule.prio,
          kind: 'outcome',
          title: `Prio ${rule.prio} · Externe Weiterleitung ${resolvedTargetRef}`,
          detail: rule.organizationName
            ? `Organisation: ${rule.organizationName}`
            : 'Externes Ziel / Direktruf',
          reason,
          statusLabel: 'Weitergeleitet',
          elapsedSeconds,
          isOverflowStep: overflowTriggered,
          targetScriptNumber: resolvedTargetRef,
          callerEvent: {
            kind: 'transfer',
            label: 'Externes Ziel',
            text: `Anruf wird extern an ${resolvedTargetRef}${rule.organizationName ? ` (${rule.organizationName})` : ''} übergeben`,
            elapsedSeconds,
          },
          targetNodeId: rule.stepNodeId,
          fallbackNodeId: current.entryNodeId,
        });
        return {
          outcomeType: 'external',
          outcomeTitle: `Weiterleitung: ${resolvedTargetRef}`,
          outcomeDetail: `Externes Routing aus Skript ${current.scriptNumber} (${current.scriptName}) über Prio ${rule.prio}.`,
          finalScriptNumber: current.scriptNumber,
          finalScriptName: current.scriptName,
          visitedScripts,
          totalWaitSeconds,
          overflowTriggered,
          steps,
          dtmfHistory,
          dynamicPrompts,
        };
      }

      // Announcement / treatment / wait / intermediate step without terminal exit
      const callerEvent: CallerExperienceEvent | undefined = rule.announcement
        ? {
            kind: 'announcement',
            label: 'Ansage',
            text: `Hört Ansage „${rule.announcement}“${ruleWait ? ` (${ruleWait} s)` : ''}`,
            elapsedSeconds,
            waitAddedSeconds: ruleWait || undefined,
          }
        : rule.treatmentInfo
          ? {
              kind: 'music',
              label: 'Wartemusik',
              text: `${rule.treatmentInfo}${ruleWait ? ` (${ruleWait} s)` : ''}`,
              elapsedSeconds,
              waitAddedSeconds: ruleWait || undefined,
            }
          : ruleWait > 0
            ? {
                kind: 'wait',
                label: 'Wartezeit',
                text: `Anrufer wartet ${ruleWait} s (${rule.stepName})`,
                elapsedSeconds,
                waitAddedSeconds: ruleWait,
              }
            : undefined;

      steps.push({
        index: steps.length + 1,
        scriptNumber: current.scriptNumber,
        scriptName: current.scriptName,
        ruleId: rule.id,
        prio: rule.prio,
        kind: 'rule-matched',
        title: `Prio ${rule.prio} · ${rule.stepName}`,
        detail: [
          rule.announcement ? `Ansage: ${rule.announcement}` : null,
          rule.treatmentInfo ? `Treatment: ${rule.treatmentInfo}` : null,
          ruleWait ? `Warten: ${ruleWait} s` : null,
          rule.conditionRaw && isTimeConditionText(rule.conditionRaw)
            ? rule.conditionRaw
            : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Schritt ausgeführt',
        reason,
        statusLabel: 'Erfüllt',
        elapsedSeconds,
        announcement: rule.announcement,
        treatmentInfo: rule.treatmentInfo,
        callerEvent,
        targetNodeId: rule.stepNodeId,
        fallbackNodeId: current.entryNodeId,
      });
    }

    // If no rule jumped, check script-level manualLinks before terminating!
    if (!jumpedToNext && current.manualTargets && current.manualTargets.length > 0) {
      const scriptLink =
        current.manualTargets.find((m) => !m.fromRuleId) || current.manualTargets[0];
      if (scriptLink) {
        const nextScript = resolveScript(scriptLink.toTargetNumber);
        if (nextScript) {
          steps.push({
            index: steps.length + 1,
            scriptNumber: current.scriptNumber,
            scriptName: current.scriptName,
            kind: 'jump',
            title: `Verknüpftes Skript → ${nextScript.scriptNumber} (${nextScript.scriptName})`,
            detail: scriptLink.label
              ? `Manuelle Verknüpfung (${scriptLink.label})`
              : `Übergabe an verknüpftes Zielskript ${nextScript.scriptNumber}`,
            reason: localOverflowPending
              ? 'Überlauf über verknüpftes Folge-Skript'
              : 'Verknüpftes Folge-Skript im Callflow',
            statusLabel: localOverflowPending ? 'Überlauf' : 'Sprung',
            elapsedSeconds,
            isOverflowStep: localOverflowPending,
            targetScriptNumber: nextScript.scriptNumber,
            callerEvent: {
              kind: 'transfer',
              label: localOverflowPending ? 'Überlauf-Ziel' : 'Weiterleitung',
              text: `Übergabe an ${nextScript.scriptName} (${nextScript.scriptNumber})`,
              elapsedSeconds,
            },
            targetNodeId: current.entryNodeId,
            fallbackNodeId: `JUMP_${toMermaidNodeSuffix(nextScript.scriptNumber)}`,
          });
          jumpedToNext = nextScript;
        } else {
          steps.push({
            index: steps.length + 1,
            scriptNumber: current.scriptNumber,
            scriptName: current.scriptName,
            kind: 'outcome',
            title: `Verknüpftes Ziel: ${scriptLink.toTargetNumber}`,
            detail: scriptLink.label || 'Externes Ziel über manuelle Verknüpfung',
            reason: 'Manuelle Verknüpfung im Callflow',
            statusLabel: 'Weitergeleitet',
            elapsedSeconds,
            targetScriptNumber: scriptLink.toTargetNumber,
            callerEvent: {
              kind: 'transfer',
              label: 'Externes Ziel',
              text: `Weiterleitung an ${scriptLink.toTargetNumber}${scriptLink.label ? ` (${scriptLink.label})` : ''}`,
              elapsedSeconds,
            },
            targetNodeId: current.entryNodeId,
            fallbackNodeId: `S_${toMermaidNodeSuffix(current.scriptNumber)}`,
          });
          return {
            outcomeType: 'external',
            outcomeTitle: `Weiterleitung: ${scriptLink.toTargetNumber}`,
            outcomeDetail: `Manuelle Verknüpfung aus Skript ${current.scriptNumber} (${current.scriptName}).`,
            finalScriptNumber: current.scriptNumber,
            finalScriptName: current.scriptName,
            visitedScripts,
            totalWaitSeconds,
            overflowTriggered,
            steps,
            dtmfHistory,
            dynamicPrompts,
          };
        }
      }
    }

    if (jumpedToNext) {
      current = jumpedToNext;
      continue;
    }

    if (!terminated) {
      const missingOverflow = localOverflowPending && Boolean(overflowQueueName);
      return {
        outcomeType: missingOverflow
          ? 'queue'
          : lastAnnouncement
            ? 'announcement'
            : 'script-end',
        outcomeTitle: missingOverflow
          ? `Kein Überlauf nach Queue: ${overflowQueueName}`
          : lastAnnouncement
            ? `Ansage-Ende: ${lastAnnouncement}`
            : `Skript-Ende: ${current.scriptNumber}`,
        outcomeDetail: missingOverflow
          ? `Nach Überlauf aus ${overflowQueueName} griff in ${current.scriptNumber} (${current.scriptName}) keine weitere Ausweichregel.`
          : lastAnnouncement
            ? `Letzte abgespielte Ansage in ${current.scriptNumber} (${current.scriptName}) ohne weiteres Sprungziel.`
            : `Alle Regeln in ${current.scriptNumber} (${current.scriptName}) wurden ohne weiteres Ziel durchlaufen.`,
        finalScriptNumber: current.scriptNumber,
        finalScriptName: current.scriptName,
        visitedScripts,
        totalWaitSeconds,
        overflowTriggered,
        missingOverflowTarget: missingOverflow || undefined,
        steps,
        dtmfHistory,
        dynamicPrompts,
      };
    }
  }

  return {
    outcomeType: 'cycle',
    outcomeTitle: 'Maximale Sprungtiefe erreicht',
    outcomeDetail: `Nach ${maxHops} Skriptsprüngen zur Sicherheit beendet.`,
    finalScriptNumber: visitedScripts[visitedScripts.length - 1] || startScript.scriptNumber,
    finalScriptName: startScript.scriptName,
    visitedScripts,
    totalWaitSeconds,
    overflowTriggered,
    steps,
    dtmfHistory,
    dynamicPrompts,
  };
}

export function simulateScenarioMatrix(
  model: CallflowSimulationModel,
  baseInput: Pick<
    CallSimulationInput,
    | 'startScriptNumber'
    | 'dialedDnis'
    | 'dtmfChoices'
    | 'dynamicOverrides'
    | 'queueMode'
    | 'maxWaitOverrideSeconds'
  >
): ScenarioMatrixRow[] {
  const statusMap: Record<CallSimulationResult['outcomeType'], string> = {
    queue: 'Warteschlange',
    announcement: 'Ansage',
    external: 'Weiterleitung',
    disconnect: 'Getrennt',
    'script-end': 'Skript-Ende',
    'dtmf-wait': 'DTMF-Menü',
    cycle: 'Zyklus',
  };

  return SCENARIO_MATRIX_PRESETS.map((preset) => {
    const res = simulateCallflow(model, {
      ...baseInput,
      weekday: preset.weekday,
      timeHHMM: preset.timeHHMM,
      isHoliday: preset.isHoliday,
      isSondZeit: preset.isSondZeit,
    });
    return {
      preset,
      outcomeType: res.outcomeType,
      statusLabel: res.missingOverflowTarget
        ? 'Überlauf fehlt'
        : res.overflowTriggered && res.outcomeType === 'queue'
          ? 'Überlauf-Queue'
          : statusMap[res.outcomeType] || res.outcomeType,
      outcomeTitle: res.outcomeTitle,
      totalWaitSeconds: res.totalWaitSeconds,
      visitedScripts: res.visitedScripts,
      stepCount: res.steps.filter((s) => s.kind !== 'rule-skipped').length,
      overflowTriggered: res.overflowTriggered,
      missingOverflowTarget: Boolean(res.missingOverflowTarget),
      needsDtmf: res.outcomeType === 'dtmf-wait',
    };
  });
}

export function buildWorkspaceGlobalSearchIndex(
  workspace: ScriptWorkspace | null,
  fallbackGraph?: CallflowGraph | null,
  activeViewKey = 'master'
): GlobalSearchEntry[] {
  const entries: GlobalSearchEntry[] = [];
  const seen = new Set<string>();

  const pushUnique = (entry: GlobalSearchEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    entries.push(entry);
  };

  if (workspace && workspace.modules && workspace.modules.length > 0) {
    workspace.modules.forEach((mod) => {
      const scriptViewKey = `script:${mod.scriptNumber}`;
      const suffix = toMermaidNodeSuffix(mod.scriptNumber);
      const scriptTitle = `${mod.scriptNumber} · ${mod.scriptName || mod.scriptNumber}`;
      const ohSummary = getModuleOpeningHoursSummary(mod);

      // 1. Script module itself
      pushUnique({
        id: `script:${mod.scriptNumber}`,
        category: 'script',
        title: scriptTitle,
        subtitle: [
          mod.isMaster ? 'Master-Skript' : 'Detail-Skript',
          mod.entryOrganizationName || null,
          `${mod.rules.length} Regeln`,
        ]
          .filter(Boolean)
          .join(' · '),
        meta: ohSummary.combinedBadge || ohSummary.scheduleText || undefined,
        searchText: [
          mod.scriptNumber,
          mod.scriptName,
          mod.cdnAlias,
          mod.entryOrganizationName,
          ...(mod.entryDnisNumbers || []),
          ohSummary.scheduleText,
          ohSummary.holidayText,
          ohSummary.combinedBadge,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        viewKey: scriptViewKey,
        scriptNumber: mod.scriptNumber,
        nodeId: `S_${suffix}`,
      });

      // 2. CDN Alias
      if (mod.cdnAlias) {
        pushUnique({
          id: `cdn:${mod.scriptNumber}:${mod.cdnAlias}`,
          category: 'cdn',
          title: `CDN ${mod.cdnAlias}`,
          subtitle: scriptTitle,
          meta: mod.entryOrganizationName || undefined,
          searchText: `cdn ${mod.cdnAlias} ${mod.scriptNumber} ${mod.scriptName} ${mod.entryOrganizationName || ''}`.toLowerCase(),
          viewKey: scriptViewKey,
          scriptNumber: mod.scriptNumber,
          nodeId: `S_${suffix}`,
        });
      }

      // 3. Entry DNIS numbers
      (mod.entryDnisNumbers || []).forEach((dnis) => {
        const cleanDnis = String(dnis || '').trim();
        if (!cleanDnis) return;
        pushUnique({
          id: `dnis:${cleanDnis}:${mod.scriptNumber}`,
          category: 'dnis',
          title: cleanDnis,
          subtitle: `Direktruf / DNIS → ${scriptTitle}`,
          meta: mod.entryOrganizationName || undefined,
          searchText: `dnis direktruf nummer ${cleanDnis} ${mod.scriptNumber} ${mod.scriptName} ${mod.entryOrganizationName || ''}`.toLowerCase(),
          viewKey: scriptViewKey,
          scriptNumber: mod.scriptNumber,
          nodeId: `S_${suffix}`,
        });
      });

      // 4. Rules: Queues, Announcements, DNIS values, Schedules
      mod.rules.forEach((rule) => {
        if (rule.queueTarget) {
          pushUnique({
            id: `queue:${rule.queueTarget}:${mod.scriptNumber}`,
            category: 'queue',
            title: rule.queueTarget,
            subtitle: `Queue in ${scriptTitle}`,
            meta: `Prio ${rule.prio}${rule.schedule ? ` · ${rule.schedule}` : ''}`,
            searchText: `queue warteschlange skillset ${rule.queueTarget} ${mod.scriptNumber} ${mod.scriptName} ${rule.stepName}`.toLowerCase(),
            viewKey: scriptViewKey,
            scriptNumber: mod.scriptNumber,
          });
        }

        if (rule.announcement) {
          pushUnique({
            id: `ann:${rule.announcement}:${mod.scriptNumber}`,
            category: 'announcement',
            title: rule.announcement,
            subtitle: `Ansage in ${scriptTitle}`,
            meta: `Prio ${rule.prio}`,
            searchText: `ansage announcement audio ${rule.announcement} ${mod.scriptNumber} ${mod.scriptName} ${rule.stepName}`.toLowerCase(),
            viewKey: scriptViewKey,
            scriptNumber: mod.scriptNumber,
          });
        }

        (rule.valueNumbers || []).forEach((val) => {
          const cleanVal = String(val || '').trim();
          if (!cleanVal) return;
          pushUnique({
            id: `dnis-rule:${cleanVal}:${mod.scriptNumber}:${rule.targetNumber || ''}`,
            category: 'dnis',
            title: cleanVal,
            subtitle: rule.targetNumber
              ? `DNIS in ${mod.scriptNumber} → Ziel ${rule.targetNumber}`
              : `DNIS in ${scriptTitle}`,
            meta: rule.organizationName || `Prio ${rule.prio}`,
            searchText: `dnis nummer ${cleanVal} ${mod.scriptNumber} ${mod.scriptName} ${rule.targetNumber || ''} ${rule.organizationName || ''}`.toLowerCase(),
            viewKey: scriptViewKey,
            scriptNumber: mod.scriptNumber,
          });
        });

        if (rule.schedule || rule.holiday) {
          const schedLabel = [rule.schedule, rule.holiday].filter(Boolean).join(' · ');
          pushUnique({
            id: `sched:${mod.scriptNumber}:${schedLabel}`,
            category: 'schedule',
            title: schedLabel,
            subtitle: `Zeitregel in ${scriptTitle}`,
            meta: `Prio ${rule.prio}${rule.queueTarget ? ` → ${rule.queueTarget}` : rule.targetNumber ? ` → ${rule.targetNumber}` : ''}`,
            searchText: `zeit öffnungszeiten feiertag sondzeit ${schedLabel} ${mod.scriptNumber} ${mod.scriptName} ${rule.stepName}`.toLowerCase(),
            viewKey: scriptViewKey,
            scriptNumber: mod.scriptNumber,
          });
        }
      });
    });
  } else if (fallbackGraph && fallbackGraph.nodes.size > 0) {
    fallbackGraph.nodes.forEach((node) => {
      pushUnique({
        id: `node:${activeViewKey}:${node.id}`,
        category: 'node',
        title: node.label,
        subtitle: `Knoten ${node.id} · ${node.inDegree} ein / ${node.outDegree} aus`,
        searchText: `${node.label} ${node.id} ${node.role}`.toLowerCase(),
        viewKey: activeViewKey,
        nodeId: node.id,
      });
    });
  }

  return entries;
}
