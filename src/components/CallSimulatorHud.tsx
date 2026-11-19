import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Headphones,
  Pause,
  PhoneCall,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Table2,
  X,
} from 'lucide-react';
import {
  CallflowSimulationModel,
  CallSimulationStep,
  formatSecondsMMSS,
  getDefaultWeekdayAndTime,
  QUEUE_MODE_OPTIONS,
  ScenarioMatrixRow,
  simulateCallflow,
  simulateScenarioMatrix,
  SimulationQueueMode,
  SimulationWeekday,
} from '../utils/callflowSimulator';

interface CallSimulatorHudProps {
  isOpen: boolean;
  onClose: () => void;
  model: CallflowSimulationModel;
  activeScriptNumber?: string | null;
  isDarkSurface: boolean;
  onFocusStep: (step: CallSimulationStep) => void;
}

type ProPanelTab = 'scenario' | 'caller' | 'matrix';
type PlaybackSpeed = 0.5 | 1 | 1.5 | 2;

const WEEKDAYS: Array<{ id: SimulationWeekday; label: string }> = [
  { id: 'mo', label: 'Mo' },
  { id: 'di', label: 'Di' },
  { id: 'mi', label: 'Mi' },
  { id: 'do', label: 'Do' },
  { id: 'fr', label: 'Fr' },
  { id: 'sa', label: 'Sa' },
  { id: 'so', label: 'So' },
];

const QUICK_PRESETS: Array<{
  label: string;
  weekday: SimulationWeekday;
  timeHHMM: string;
  isHoliday: boolean;
  isSondZeit: boolean;
}> = [
  { label: 'Werktag 10:00', weekday: 'mo', timeHHMM: '10:00', isHoliday: false, isSondZeit: false },
  { label: 'Abend 20:00', weekday: 'di', timeHHMM: '20:00', isHoliday: false, isSondZeit: false },
  { label: 'Sa 11:00', weekday: 'sa', timeHHMM: '11:00', isHoliday: false, isSondZeit: false },
  { label: 'Feiertag', weekday: 'mo', timeHHMM: '10:00', isHoliday: true, isSondZeit: false },
];

const WAIT_THRESHOLD_OPTIONS = [15, 30, 60, 120] as const;
const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const;
const SPEED_OPTIONS: PlaybackSpeed[] = [0.5, 1, 1.5, 2];
const SPEED_DELAY_MS: Record<PlaybackSpeed, number> = {
  0.5: 2800,
  1: 1500,
  1.5: 1000,
  2: 680,
};

export const CallSimulatorHud: React.FC<CallSimulatorHudProps> = ({
  isOpen,
  onClose,
  model,
  activeScriptNumber,
  isDarkSurface,
  onFocusStep,
}) => {
  const defaultClock = useMemo(() => getDefaultWeekdayAndTime(), []);
  const defaultStartScript = useMemo(() => {
    if (activeScriptNumber && model.scripts.some((s) => s.scriptNumber === activeScriptNumber)) {
      return activeScriptNumber;
    }
    const master = model.scripts.find((s) => s.isMaster);
    return master?.scriptNumber || model.scripts[0]?.scriptNumber || '';
  }, [activeScriptNumber, model.scripts]);

  const [startScriptNumber, setStartScriptNumber] = useState<string>(defaultStartScript);
  const [dialedDnis, setDialedDnis] = useState<string>('');
  const [weekday, setWeekday] = useState<SimulationWeekday>(defaultClock.weekday);
  const [timeHHMM, setTimeHHMM] = useState<string>(defaultClock.timeHHMM);
  const [isHoliday, setIsHoliday] = useState<boolean>(false);
  const [isSondZeit, setIsSondZeit] = useState<boolean>(false);
  const [queueMode, setQueueMode] = useState<SimulationQueueMode>('normal');
  const [maxWaitOverrideSeconds, setMaxWaitOverrideSeconds] = useState<number>(30);
  const [dtmfChoices, setDtmfChoices] = useState<Record<string, string>>({});
  const [dynamicOverrides, setDynamicOverrides] = useState<Record<string, boolean>>({});
  const [showSkipped, setShowSkipped] = useState<boolean>(false);

  const [proPanelOpen, setProPanelOpen] = useState<boolean>(true);
  const [proTab, setProTab] = useState<ProPanelTab>('scenario');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [stepIndex, setStepIndex] = useState<number>(0);

  const lastFocusedKeyRef = useRef<string>('');

  // Sync default start script when opening HUD
  useEffect(() => {
    if (!isOpen) {
      setIsPlaying(false);
      lastFocusedKeyRef.current = '';
      return;
    }
    if (activeScriptNumber && model.scripts.some((s) => s.scriptNumber === activeScriptNumber)) {
      setStartScriptNumber(activeScriptNumber);
    } else if (
      !startScriptNumber ||
      !model.scripts.some((s) => s.scriptNumber === startScriptNumber)
    ) {
      setStartScriptNumber(defaultStartScript);
    }
    setStepIndex(0);
    setIsPlaying(false);
    setProPanelOpen(true);
  }, [isOpen, activeScriptNumber, defaultStartScript, model.scripts]);

  const simulation = useMemo(() => {
    return simulateCallflow(model, {
      startScriptNumber: startScriptNumber || defaultStartScript,
      dialedDnis,
      weekday,
      timeHHMM,
      isHoliday,
      isSondZeit,
      dtmfChoices,
      dynamicOverrides,
      queueMode,
      maxWaitOverrideSeconds,
    });
  }, [
    model,
    startScriptNumber,
    defaultStartScript,
    dialedDnis,
    weekday,
    timeHHMM,
    isHoliday,
    isSondZeit,
    dtmfChoices,
    dynamicOverrides,
    queueMode,
    maxWaitOverrideSeconds,
  ]);

  const scenarioMatrix = useMemo<ScenarioMatrixRow[]>(() => {
    if (!proPanelOpen || proTab !== 'matrix') return [];
    return simulateScenarioMatrix(model, {
      startScriptNumber: startScriptNumber || defaultStartScript,
      dialedDnis,
      dtmfChoices,
      dynamicOverrides,
      queueMode,
      maxWaitOverrideSeconds,
    });
  }, [
    proPanelOpen,
    proTab,
    model,
    startScriptNumber,
    defaultStartScript,
    dialedDnis,
    dtmfChoices,
    dynamicOverrides,
    queueMode,
    maxWaitOverrideSeconds,
  ]);

  const visibleSteps = useMemo(() => {
    return showSkipped
      ? simulation.steps
      : simulation.steps.filter((s) => s.kind !== 'rule-skipped');
  }, [simulation.steps, showSkipped]);

  const safeStepIndex = Math.max(0, Math.min(stepIndex, Math.max(0, visibleSteps.length - 1)));
  const activeStep: CallSimulationStep | undefined = visibleSteps[safeStepIndex];

  useEffect(() => {
    if (safeStepIndex !== stepIndex) {
      setStepIndex(safeStepIndex);
    }
  }, [safeStepIndex, stepIndex]);

  // Auto-focus active step on Callflow canvas whenever the active step changes
  useEffect(() => {
    if (!isOpen || !activeStep) return;
    const key = `${activeStep.scriptNumber}|${activeStep.index}|${activeStep.targetNodeId || ''}|${activeStep.title}`;
    if (lastFocusedKeyRef.current === key) return;
    lastFocusedKeyRef.current = key;
    onFocusStep(activeStep);
  }, [isOpen, activeStep, onFocusStep]);

  // Auto-play timer (pauses at end or DTMF menu)
  useEffect(() => {
    if (!isOpen || !isPlaying) return;
    if (visibleSteps.length === 0) {
      setIsPlaying(false);
      return;
    }
    const cur = visibleSteps[safeStepIndex];
    if (cur?.kind === 'dtmf-prompt' || safeStepIndex >= visibleSteps.length - 1) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setStepIndex((prev) => {
        const next = Math.min(prev + 1, visibleSteps.length - 1);
        if (next >= visibleSteps.length - 1 || visibleSteps[next]?.kind === 'dtmf-prompt') {
          setIsPlaying(false);
        }
        return next;
      });
    }, SPEED_DELAY_MS[speed]);
    return () => window.clearTimeout(timer);
  }, [isOpen, isPlaying, safeStepIndex, visibleSteps, speed]);

  const handleTogglePlay = useCallback(() => {
    if (visibleSteps.length === 0) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (safeStepIndex >= visibleSteps.length - 1) {
      setStepIndex(0);
    }
    if (proTab !== 'caller') {
      setProPanelOpen(false);
    }
    setIsPlaying(true);
  }, [isPlaying, safeStepIndex, visibleSteps.length, proTab]);

  const handleStepBack = useCallback(() => {
    setIsPlaying(false);
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleStepForward = useCallback(() => {
    setIsPlaying(false);
    setStepIndex((prev) => Math.min(Math.max(0, visibleSteps.length - 1), prev + 1));
  }, [visibleSteps.length]);

  const handleRestart = useCallback(() => {
    setIsPlaying(false);
    lastFocusedKeyRef.current = '';
    setStepIndex(0);
  }, []);

  const handleScenarioChange = useCallback((fn: () => void) => {
    setIsPlaying(false);
    lastFocusedKeyRef.current = '';
    setStepIndex(0);
    fn();
  }, []);

  const handleDialDtmfDigit = useCallback(
    (digit: string) => {
      const pending = simulation.pendingDtmf;
      if (!pending) return;
      const opt = pending.choices.find((c) => c.choice === digit);
      if (!opt) return;
      const dtmfKey = pending.key;
      const nextIdx = safeStepIndex;
      setDtmfChoices((prev) => ({ ...prev, [dtmfKey]: digit }));
      lastFocusedKeyRef.current = '';
      setStepIndex(nextIdx);
      setIsPlaying(true);
    },
    [simulation.pendingDtmf, safeStepIndex]
  );

  const handleLoadMatrixScenario = useCallback(
    (row: ScenarioMatrixRow) => {
      handleScenarioChange(() => {
        setWeekday(row.preset.weekday);
        setTimeHHMM(row.preset.timeHHMM);
        setIsHoliday(row.preset.isHoliday);
        setIsSondZeit(row.preset.isSondZeit);
      });
      setProTab('caller');
    },
    [handleScenarioChange]
  );

  // Keyboard navigation while Simulator HUD is open (Space = Play/Pause, Left/Right = Step, 0-9/*/# = DTMF, Esc = Close)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        if (e.key === 'Escape') {
          (target as HTMLElement).blur();
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === ' ') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleStepBack();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleStepForward();
      } else if (
        simulation.pendingDtmf &&
        /^[0-9*#]$/.test(e.key) &&
        simulation.pendingDtmf.choices.some((c) => c.choice === e.key)
      ) {
        e.preventDefault();
        handleDialDtmfDigit(e.key);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isOpen,
    onClose,
    handleTogglePlay,
    handleStepBack,
    handleStepForward,
    simulation.pendingDtmf,
    handleDialDtmfDigit,
  ]);

  // Caller experience feed entries derived from visibleSteps (keeps 1:1 index mapping for jumping)
  const callerFeedItems = useMemo(() => {
    return visibleSteps
      .map((step, visibleIdx) => ({ step, visibleIdx }))
      .filter(({ step }) => Boolean(step.callerEvent));
  }, [visibleSteps]);

  const activeDtmfChoiceMap = useMemo(() => {
    const map = new Map<string, { label: string; targetNumber: string }>();
    const choices = simulation.pendingDtmf?.choices || activeStep?.choices || [];
    choices.forEach((c) => {
      map.set(c.choice, { label: c.label || c.targetNumber, targetNumber: c.targetNumber });
    });
    return map;
  }, [simulation.pendingDtmf, activeStep]);

  if (!isOpen) return null;

  const isAtEnd = visibleSteps.length > 0 && safeStepIndex >= visibleSteps.length - 1;

  const statusTextClass = (() => {
    if (!activeStep) return isDarkSurface ? 'text-slate-400' : 'text-slate-600';
    if (activeStep.kind === 'outcome') {
      if (simulation.outcomeType === 'disconnect') {
        return isDarkSurface ? 'text-rose-400' : 'text-rose-700';
      }
      if (simulation.missingOverflowTarget) {
        return isDarkSurface ? 'text-amber-400' : 'text-amber-700';
      }
      return isDarkSurface ? 'text-emerald-400' : 'text-emerald-700';
    }
    if (activeStep.kind === 'overflow' || activeStep.kind === 'dtmf-prompt') {
      return isDarkSurface ? 'text-amber-400' : 'text-amber-700';
    }
    if (activeStep.kind === 'cycle-guard') {
      return isDarkSurface ? 'text-rose-400' : 'text-rose-700';
    }
    if (activeStep.kind === 'jump') {
      return isDarkSurface ? 'text-indigo-400' : 'text-indigo-700';
    }
    if (activeStep.kind === 'rule-skipped') {
      return isDarkSurface ? 'text-slate-400' : 'text-slate-500';
    }
    return isDarkSurface ? 'text-sky-400' : 'text-sky-700';
  })();

  const matrixStatusTone = (row: ScenarioMatrixRow): string => {
    if (row.missingOverflowTarget || row.needsDtmf || row.overflowTriggered) {
      return isDarkSurface ? 'text-amber-400' : 'text-amber-700';
    }
    if (row.outcomeType === 'disconnect' || row.outcomeType === 'cycle') {
      return isDarkSurface ? 'text-rose-400' : 'text-rose-700';
    }
    if (row.outcomeType === 'queue' || row.outcomeType === 'external') {
      return isDarkSurface ? 'text-emerald-400' : 'text-emerald-700';
    }
    return isDarkSurface ? 'text-slate-300' : 'text-slate-700';
  };

  const shellClass = isDarkSurface
    ? 'bg-slate-950/95 border-slate-700/90 text-slate-100'
    : 'bg-white/95 border-slate-300 text-slate-900';

  const panelSubSurface = isDarkSurface ? 'bg-slate-900/60' : 'bg-slate-50/90';
  const dividerClass = isDarkSurface ? 'border-slate-800' : 'border-slate-200';
  const mutedTextClass = isDarkSurface ? 'text-slate-400' : 'text-slate-600';
  const controlBtnClass = isDarkSurface
    ? 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200 disabled:opacity-40'
    : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-800 disabled:opacity-40';
  const inputClass = isDarkSurface
    ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500'
    : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400';

  const activeQueueMeta = QUEUE_MODE_OPTIONS.find((q) => q.id === queueMode);
  const dtmfChosenCount = Object.keys(dtmfChoices).length;

  return (
    <div
      data-canvas-ui="true"
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className={`pointer-events-auto w-full max-w-[860px] rounded-xl border shadow-2xl backdrop-blur-md transition-opacity ${shellClass}`}
    >
      {/* Top Row: Compact Live Header + Pro-Panel Toggle + Transport Controls */}
      <div
        className={`px-3 py-2 border-b ${dividerClass} flex flex-wrap items-center justify-between gap-2`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <PhoneCall className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="text-xs font-semibold whitespace-nowrap">Anruf-Simulator</span>
          <span className={`text-[11px] font-mono tabular-nums whitespace-nowrap ${mutedTextClass}`}>
            {visibleSteps.length > 0
              ? `Schritt ${safeStepIndex + 1} / ${visibleSteps.length}`
              : '0 Schritte'}
            {' · '}
            {formatSecondsMMSS(activeStep?.elapsedSeconds ?? 0)}
          </span>
          {queueMode !== 'normal' && activeQueueMeta && (
            <span
              className={`text-[11px] font-semibold whitespace-nowrap ${
                isDarkSurface ? 'text-amber-400' : 'text-amber-700'
              }`}
            >
              · Überlauf: {activeQueueMeta.shortLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => setProPanelOpen((prev) => !prev)}
            className={`px-2 py-1 text-[11px] font-medium rounded-md border flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              proPanelOpen
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : controlBtnClass
            }`}
            title="Profi-Panel (Szenario & Überlauf, Anrufer-Sicht & DTMF, Szenario-Matrix) ein-/ausklappen"
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>Profi-Panel</span>
            {proPanelOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* Transport Controls: Restart | Back | Play/Pause | Forward | Speed | Close */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleRestart}
            disabled={visibleSteps.length === 0}
            title="Simulation von vorn beginnen"
            className={`p-1.5 rounded-md border transition-colors cursor-pointer ${controlBtnClass}`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleStepBack}
            disabled={safeStepIndex <= 0}
            title="Einen Schritt zurück (←)"
            className={`px-2 py-1 rounded-md border text-[11px] font-medium flex items-center gap-0.5 whitespace-nowrap cursor-pointer transition-colors ${controlBtnClass}`}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Zurück</span>
          </button>

          <button
            type="button"
            onClick={handleTogglePlay}
            disabled={visibleSteps.length === 0}
            title={isPlaying ? 'Pause (Leertaste)' : 'Abspielen (Leertaste)'}
            className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors ${
              isPlaying
                ? 'bg-amber-600 hover:bg-amber-500 border-amber-500 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-500 text-white'
            } disabled:opacity-40`}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? 'Pause' : isAtEnd ? 'Nochmal' : 'Abspielen'}</span>
          </button>

          <button
            type="button"
            onClick={handleStepForward}
            disabled={safeStepIndex >= visibleSteps.length - 1}
            title="Einen Schritt vor (→)"
            className={`px-2 py-1 rounded-md border text-[11px] font-medium flex items-center gap-0.5 whitespace-nowrap cursor-pointer transition-colors ${controlBtnClass}`}
          >
            <span>Vor</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <div
            className={`hidden sm:flex items-center rounded-md border p-0.5 ${
              isDarkSurface ? 'bg-slate-900 border-slate-700' : 'bg-slate-100 border-slate-300'
            }`}
            title="Abspiel-Geschwindigkeit"
          >
            {SPEED_OPTIONS.map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => setSpeed(sp)}
                className={`px-1.5 py-0.5 text-[10px] font-mono tabular-nums rounded cursor-pointer transition-colors whitespace-nowrap ${
                  speed === sp
                    ? 'bg-indigo-600 text-white font-semibold'
                    : isDarkSurface
                      ? 'text-slate-400 hover:text-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sp}x
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Anruf-Simulator schließen (Esc)"
            className={`p-1.5 rounded-md border transition-colors cursor-pointer ${controlBtnClass}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Collapsible 3-Tab Pro Panel */}
      {proPanelOpen && (
        <div className={`border-b ${dividerClass} ${panelSubSurface}`}>
          {/* Segmented Pro-Panel Navigation */}
          <div
            className={`px-3 py-1.5 border-b ${dividerClass} flex flex-wrap items-center justify-between gap-2`}
          >
            <div
              className={`inline-flex items-center rounded-lg border p-0.5 ${
                isDarkSurface ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-200'
              }`}
              role="tablist"
              aria-label="Simulator-Ansichten"
            >
              <button
                type="button"
                role="tab"
                aria-selected={proTab === 'scenario'}
                onClick={() => setProTab('scenario')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                  proTab === 'scenario'
                    ? 'bg-indigo-600 text-white'
                    : isDarkSurface
                      ? 'text-slate-300 hover:text-white'
                      : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>Szenario &amp; Überlauf</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={proTab === 'caller'}
                onClick={() => setProTab('caller')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                  proTab === 'caller'
                    ? 'bg-indigo-600 text-white'
                    : isDarkSurface
                      ? 'text-slate-300 hover:text-white'
                      : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                <Headphones className="w-3 h-3" />
                <span>
                  Anrufer-Sicht &amp; DTMF
                  {simulation.pendingDtmf ? ' · Wahl offen' : ''}
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={proTab === 'matrix'}
                onClick={() => setProTab('matrix')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                  proTab === 'matrix'
                    ? 'bg-indigo-600 text-white'
                    : isDarkSurface
                      ? 'text-slate-300 hover:text-white'
                      : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                <Table2 className="w-3 h-3" />
                <span>Szenario-Matrix (6 Fälle)</span>
              </button>
            </div>

            <div className={`text-[11px] font-mono tabular-nums whitespace-nowrap ${mutedTextClass}`}>
              {startScriptNumber || defaultStartScript}
              {dialedDnis ? ` · DNIS ${dialedDnis}` : ''}
              {' · '}
              {WEEKDAYS.find((w) => w.id === weekday)?.label} {timeHHMM}
              {isHoliday ? ' · Feiertag' : ''}
              {isSondZeit ? ' · SondZeit' : ''}
            </div>
          </div>

          {/* TAB 1: SCENARIO & QUEUE / OVERFLOW */}
          {proTab === 'scenario' && (
            <div className="px-3 py-2.5 space-y-2.5">
              {/* Row 1: Script, DNIS, Weekday, Time */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={startScriptNumber}
                  onChange={(e) => {
                    const next = e.target.value;
                    handleScenarioChange(() => {
                      setStartScriptNumber(next);
                      setDtmfChoices({});
                    });
                  }}
                  title="Start-Skript für die Simulation auswählen"
                  className={`flex-1 min-w-[190px] text-[11px] font-medium rounded-md border px-2 py-1 focus:outline-none focus:border-indigo-500 ${inputClass}`}
                >
                  {model.scripts.map((s) => (
                    <option key={s.scriptNumber} value={s.scriptNumber}>
                      {s.scriptNumber} · {s.scriptName}
                      {s.isMaster ? ' [Master]' : ''}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  list="sim-hud-dnis-list"
                  value={dialedDnis}
                  onChange={(e) => {
                    const val = e.target.value;
                    handleScenarioChange(() => {
                      setDialedDnis(val);
                      const hit = model.dnisEntries.find((d) => d.dnis === val.trim());
                      if (hit) setStartScriptNumber(hit.scriptNumber);
                    });
                  }}
                  placeholder="DNIS (optional)..."
                  className={`w-[135px] text-[11px] font-mono rounded-md border px-2 py-1 focus:outline-none focus:border-indigo-500 ${inputClass}`}
                />
                <datalist id="sim-hud-dnis-list">
                  {model.dnisEntries.slice(0, 100).map((d) => (
                    <option key={`${d.dnis}-${d.scriptNumber}`} value={d.dnis}>
                      {d.scriptNumber} · {d.scriptName}
                    </option>
                  ))}
                </datalist>

                <div className="flex items-center gap-0.5">
                  {WEEKDAYS.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => handleScenarioChange(() => setWeekday(d.id))}
                      className={`px-1.5 py-1 text-[10.5px] font-semibold rounded border cursor-pointer transition-colors whitespace-nowrap ${
                        weekday === d.id
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : controlBtnClass
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>

                <input
                  type="time"
                  value={timeHHMM}
                  onChange={(e) => handleScenarioChange(() => setTimeHHMM(e.target.value || '10:00'))}
                  className={`text-[11px] font-mono tabular-nums rounded-md border px-1.5 py-0.5 focus:outline-none focus:border-indigo-500 ${inputClass}`}
                />
              </div>

              {/* Row 2: Flags & Quick Presets */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={isHoliday}
                      onChange={(e) => handleScenarioChange(() => setIsHoliday(e.target.checked))}
                      className="accent-indigo-500"
                    />
                    <span>Feiertag</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={isSondZeit}
                      onChange={(e) => handleScenarioChange(() => setIsSondZeit(e.target.checked))}
                      className="accent-indigo-500"
                    />
                    <span>SondZeit / Notfall</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={showSkipped}
                      onChange={(e) => {
                        setShowSkipped(e.target.checked);
                        setStepIndex(0);
                        setIsPlaying(false);
                      }}
                      className="accent-indigo-500"
                    />
                    <span>Alle Prüfungen zeigen</span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {QUICK_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() =>
                        handleScenarioChange(() => {
                          setWeekday(p.weekday);
                          setTimeHHMM(p.timeHHMM);
                          setIsHoliday(p.isHoliday);
                          setIsSondZeit(p.isSondZeit);
                        })
                      }
                      className={`px-2 py-0.5 text-[10.5px] rounded border cursor-pointer transition-colors whitespace-nowrap ${controlBtnClass}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 3: Queue & Overflow Test Controls */}
              <div className={`pt-2 border-t ${dividerClass} flex flex-wrap items-center justify-between gap-2`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`text-[11px] font-medium whitespace-nowrap ${mutedTextClass}`}>
                    Queue- &amp; Überlauf-Test:
                  </span>
                  {QUEUE_MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleScenarioChange(() => setQueueMode(opt.id))}
                      title={opt.description}
                      className={`px-2 py-1 text-[10.5px] font-medium rounded-md border cursor-pointer transition-colors whitespace-nowrap ${
                        queueMode === opt.id
                          ? opt.id === 'normal'
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : 'bg-amber-600 border-amber-500 text-white'
                          : controlBtnClass
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {queueMode === 'wait-timeout' && (
                  <div className="flex items-center gap-1 text-[10.5px]">
                    <span className={`whitespace-nowrap ${mutedTextClass}`}>Wartezeit:</span>
                    {WAIT_THRESHOLD_OPTIONS.map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => handleScenarioChange(() => setMaxWaitOverrideSeconds(sec))}
                        className={`px-1.5 py-0.5 font-mono tabular-nums rounded border cursor-pointer whitespace-nowrap ${
                          maxWaitOverrideSeconds === sec
                            ? 'bg-indigo-600 border-indigo-500 text-white'
                            : controlBtnClass
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Dynamic Runtime Condition Overrides (if encountered in path) */}
              {simulation.dynamicPrompts.length > 0 && (
                <div className={`pt-2 border-t ${dividerClass} flex flex-wrap items-center gap-1.5`}>
                  <span className={`text-[10.5px] whitespace-nowrap ${mutedTextClass}`}>
                    Erkannte Laufzeit-Regeln:
                  </span>
                  {simulation.dynamicPrompts.map((dp) => (
                    <button
                      key={dp.key}
                      type="button"
                      onClick={() =>
                        handleScenarioChange(() =>
                          setDynamicOverrides((prev) => ({ ...prev, [dp.key]: !dp.active }))
                        )
                      }
                      className={`px-2 py-0.5 text-[10.5px] rounded border cursor-pointer transition-colors whitespace-nowrap ${
                        dp.active
                          ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-400 font-medium'
                          : controlBtnClass
                      }`}
                    >
                      {dp.active ? 'Aktiv: ' : 'Inaktiv: '}
                      {dp.label}
                      {dp.autoActivatedByQueueMode ? ' (Auto)' : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CALLER EXPERIENCE VIEW + DTMF KEYPAD */}
          {proTab === 'caller' && (
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_216px]">
              {/* Left Column: Chronological Caller Hearing & Wait Feed */}
              <div className="px-3 py-2.5 flex flex-col min-w-0">
                <div className="flex items-center justify-between gap-2 pb-1.5">
                  <div className="text-[11px] font-semibold">
                    Anrufer-Perspektive — Was der Anrufer hört &amp; erlebt
                  </div>
                  <div className={`text-[11px] font-mono tabular-nums whitespace-nowrap ${mutedTextClass}`}>
                    Dauer {formatSecondsMMSS(activeStep?.elapsedSeconds ?? 0)}
                    {simulation.totalWaitSeconds > 0
                      ? ` · Wartezeit ${simulation.totalWaitSeconds} s`
                      : ''}
                  </div>
                </div>

                <div className="max-h-[172px] overflow-y-auto divide-y divide-slate-800/40 pr-1">
                  {callerFeedItems.length > 0 ? (
                    callerFeedItems.map(({ step, visibleIdx }) => {
                      const ev = step.callerEvent!;
                      const isCurrent = visibleIdx === safeStepIndex;
                      const isFuture = visibleIdx > safeStepIndex;
                      const evTone =
                        ev.kind === 'overflow' || ev.kind === 'dtmf-prompt'
                          ? isDarkSurface
                            ? 'text-amber-400'
                            : 'text-amber-700'
                          : ev.kind === 'disconnect'
                            ? isDarkSurface
                              ? 'text-rose-400'
                              : 'text-rose-700'
                            : ev.kind === 'queue-enter' || ev.kind === 'dtmf-press'
                              ? isDarkSurface
                                ? 'text-emerald-400'
                                : 'text-emerald-700'
                              : isDarkSurface
                                ? 'text-sky-400'
                                : 'text-sky-700';

                      return (
                        <button
                          key={`${step.scriptNumber}-${step.index}-${visibleIdx}`}
                          type="button"
                          onClick={() => {
                            setIsPlaying(false);
                            setStepIndex(visibleIdx);
                          }}
                          className={`w-full text-left py-1.5 px-2 rounded transition-colors cursor-pointer flex items-baseline gap-2.5 ${
                            isCurrent
                              ? isDarkSurface
                                ? 'bg-indigo-500/15'
                                : 'bg-indigo-50'
                              : isFuture
                                ? 'opacity-45 hover:opacity-80'
                                : isDarkSurface
                                  ? 'hover:bg-slate-800/50'
                                  : 'hover:bg-slate-100'
                          }`}
                        >
                          <span
                            className={`text-[10.5px] font-mono tabular-nums shrink-0 ${mutedTextClass}`}
                          >
                            {formatSecondsMMSS(ev.elapsedSeconds)}
                          </span>
                          <span className={`text-[10.5px] font-semibold shrink-0 whitespace-nowrap ${evTone}`}>
                            {ev.label}
                          </span>
                          <span className="text-[11.5px] leading-snug min-w-0 flex-1">
                            {ev.text}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className={`text-[11px] py-3 ${mutedTextClass}`}>
                      Keine Ansagen oder Hörerlebnisse im aktuellen Pfad — nutzen Sie die Schritt-Leiste unten.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Interactive DTMF Keypad (1-9, *, 0, #) */}
              <div
                className={`px-3 py-2.5 border-t sm:border-t-0 sm:border-l ${dividerClass} flex flex-col justify-between gap-2`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold whitespace-nowrap">DTMF-Tastenfeld</span>
                  {dtmfChosenCount > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        handleScenarioChange(() => {
                          setDtmfChoices({});
                        })
                      }
                      className={`text-[10px] underline cursor-pointer whitespace-nowrap ${mutedTextClass}`}
                    >
                      Leeren
                    </button>
                  )}
                </div>

                {simulation.dtmfHistory.length > 0 && (
                  <div className={`text-[10.5px] font-mono tabular-nums truncate ${mutedTextClass}`}>
                    Gewählt: {simulation.dtmfHistory.map((h) => `[${h.choice}]`).join(' → ')}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-1">
                  {KEYPAD_DIGITS.map((digit) => {
                    const option = activeDtmfChoiceMap.get(digit);
                    const isSelectable = Boolean(simulation.pendingDtmf && option);
                    return (
                      <button
                        key={digit}
                        type="button"
                        disabled={!isSelectable}
                        onClick={() => handleDialDtmfDigit(digit)}
                        title={
                          option
                            ? `Taste ${digit}: ${option.label} (Ziel ${option.targetNumber})`
                            : `Taste ${digit} im aktuellen Schritt nicht belegt`
                        }
                        className={`px-1 py-1.5 rounded-md border text-center transition-colors flex flex-col items-center justify-center min-h-[34px] ${
                          isSelectable
                            ? 'bg-amber-500/20 hover:bg-amber-500/35 border-amber-500/60 text-amber-300 cursor-pointer font-semibold'
                            : isDarkSurface
                              ? 'bg-slate-900/70 border-slate-800 text-slate-600 cursor-default'
                              : 'bg-white border-slate-200 text-slate-400 cursor-default'
                        }`}
                      >
                        <span className="text-xs font-mono tabular-nums leading-none">{digit}</span>
                        {option && (
                          <span className="text-[9px] truncate max-w-[54px] mt-0.5 leading-none opacity-85">
                            {option.label}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className={`text-[10px] leading-tight ${mutedTextClass}`}>
                  {simulation.pendingDtmf
                    ? 'Aktive Tasten per Klick oder Tastatur wählen.'
                    : 'Wird aktiv, sobald ein IVR-Auswahlmenü erreicht wird.'}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SCENARIO COMPARISON MATRIX (6 STANDARD CASES) */}
          {proTab === 'matrix' && (
            <div className="px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                <div className="text-[11px] font-semibold">
                  Szenario-Matrix — 6 Standardfälle für {startScriptNumber || defaultStartScript}
                  {dialedDnis ? ` · DNIS ${dialedDnis}` : ''}
                </div>
                <div className="flex items-center gap-1">
                  {QUEUE_MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleScenarioChange(() => setQueueMode(opt.id))}
                      className={`px-2 py-0.5 text-[10px] font-medium rounded border cursor-pointer whitespace-nowrap ${
                        queueMode === opt.id
                          ? opt.id === 'normal'
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : 'bg-amber-600 border-amber-500 text-white'
                          : controlBtnClass
                      }`}
                    >
                      {opt.shortLabel}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto max-h-[205px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className={`border-b ${dividerClass} ${mutedTextClass}`}>
                      <th className="py-1.5 pr-2 font-medium whitespace-nowrap">Szenario</th>
                      <th className="py-1.5 px-2 font-medium whitespace-nowrap">Status</th>
                      <th className="py-1.5 px-2 font-medium">Endziel</th>
                      <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">Wartezeit</th>
                      <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">Skripte</th>
                      <th className="py-1.5 pl-2 font-medium text-right whitespace-nowrap">Aktion</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDarkSurface ? 'divide-slate-800/70' : 'divide-slate-200'}`}>
                    {scenarioMatrix.map((row) => {
                      const isCurrentPreset =
                        row.preset.weekday === weekday &&
                        row.preset.timeHHMM === timeHHMM &&
                        row.preset.isHoliday === isHoliday &&
                        row.preset.isSondZeit === isSondZeit;
                      return (
                        <tr
                          key={row.preset.id}
                          className={
                            isCurrentPreset
                              ? isDarkSurface
                                ? 'bg-indigo-500/10'
                                : 'bg-indigo-50/70'
                              : isDarkSurface
                                ? 'hover:bg-slate-800/40'
                                : 'hover:bg-slate-100/80'
                          }
                        >
                          <td className="py-1.5 pr-2 whitespace-nowrap">
                            <span className="font-semibold">{row.preset.label}</span>
                            <span className={`ml-1.5 font-mono tabular-nums text-[10px] ${mutedTextClass}`}>
                              {row.preset.shortTime}
                            </span>
                          </td>
                          <td className={`py-1.5 px-2 font-semibold whitespace-nowrap ${matrixStatusTone(row)}`}>
                            {row.statusLabel}
                          </td>
                          <td className="py-1.5 px-2 max-w-[240px] truncate" title={row.outcomeTitle}>
                            {row.outcomeTitle}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                            {row.totalWaitSeconds > 0 ? `${row.totalWaitSeconds} s` : '0 s'}
                          </td>
                          <td
                            className={`py-1.5 px-2 text-right font-mono tabular-nums whitespace-nowrap ${mutedTextClass}`}
                            title={row.visitedScripts.join(' → ')}
                          >
                            {row.visitedScripts.length}
                          </td>
                          <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => handleLoadMatrixScenario(row)}
                              className={`px-2 py-0.5 text-[10.5px] font-medium rounded border cursor-pointer transition-colors whitespace-nowrap ${controlBtnClass}`}
                            >
                              Live prüfen
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Compact Live Step Explanation Area ("Was passiert gerade?") */}
      <div className="px-3 py-2.5 space-y-2">
        {activeStep ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {/* Clean unboxed metadata row (zero static pills) */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className={`font-semibold whitespace-nowrap ${statusTextClass}`}>
                    {activeStep.statusLabel}
                  </span>
                  <span className={mutedTextClass} aria-hidden="true">·</span>
                  <span className={`font-mono font-semibold tabular-nums ${mutedTextClass}`}>
                    Skript {activeStep.scriptNumber}
                  </span>
                  <span className={`truncate ${mutedTextClass}`}>· {activeStep.scriptName}</span>
                  {simulation.visitedScripts.length > 1 && (
                    <>
                      <span className={mutedTextClass} aria-hidden="true">·</span>
                      <span
                        className={`font-mono text-[10.5px] truncate max-w-[220px] ${mutedTextClass}`}
                        title={`Skript-Pfad: ${simulation.visitedScripts.join(' → ')}`}
                      >
                        {simulation.visitedScripts.join(' → ')}
                      </span>
                    </>
                  )}
                </div>

                <div className="text-xs font-semibold mt-0.5 leading-snug">{activeStep.title}</div>
                <div className={`text-[11px] mt-0.5 leading-snug ${mutedTextClass}`}>
                  {activeStep.detail}
                  {activeStep.reason ? ` — ${activeStep.reason}` : ''}
                </div>
              </div>

              {isAtEnd && simulation.outcomeTitle && (
                <div className="shrink-0 text-right hidden sm:block max-w-[220px]">
                  <div className={`text-[10px] ${mutedTextClass}`}>
                    {simulation.missingOverflowTarget ? 'Überlauf-Hinweis' : 'Endergebnis'}
                  </div>
                  <div
                    className={`text-[11px] font-semibold font-mono truncate ${
                      simulation.missingOverflowTarget
                        ? isDarkSurface
                          ? 'text-amber-400'
                          : 'text-amber-700'
                        : ''
                    }`}
                    title={simulation.outcomeTitle}
                  >
                    {simulation.outcomeTitle}
                  </div>
                </div>
              )}
            </div>

            {/* Inline DTMF Choice Strip when paused at a menu (also works when Pro Panel is collapsed) */}
            {activeStep.kind === 'dtmf-prompt' && simulation.pendingDtmf && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span
                  className={`text-[11px] font-semibold whitespace-nowrap ${
                    isDarkSurface ? 'text-amber-400' : 'text-amber-700'
                  }`}
                >
                  Taste wählen:
                </span>
                {simulation.pendingDtmf.choices.map((opt) => (
                  <button
                    key={`${simulation.pendingDtmf!.key}-${opt.choice}`}
                    type="button"
                    onClick={() => handleDialDtmfDigit(opt.choice)}
                    className={`px-2 py-1 text-[11px] font-medium rounded-md border cursor-pointer whitespace-nowrap transition-colors ${
                      isDarkSurface
                        ? 'border-amber-500/45 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200'
                        : 'border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-900'
                    }`}
                  >
                    <span className="font-mono font-bold mr-1">[{opt.choice}]</span>
                    {opt.label || opt.targetNumber}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className={`text-xs ${mutedTextClass}`}>
            Kein ausführbarer Callflow für die aktuelle Auswahl gefunden.
          </div>
        )}

        {/* Clickable Step Timeline (Schritt-Leiste) */}
        {visibleSteps.length > 0 && (
          <div
            className={`pt-2 border-t ${dividerClass} flex items-center gap-1 overflow-x-auto`}
            role="tablist"
            aria-label="Simulationsschritte"
          >
            {visibleSteps.map((st, idx) => {
              const isCurrent = idx === safeStepIndex;
              const isPast = idx < safeStepIndex;
              const shortText =
                st.kind === 'entry'
                  ? `Skript ${st.scriptNumber}`
                  : st.kind === 'jump'
                    ? `→ ${st.targetScriptNumber || st.scriptNumber}`
                    : st.kind === 'overflow'
                      ? 'Überlauf'
                      : st.kind === 'dtmf-prompt'
                        ? 'DTMF'
                        : st.kind === 'outcome'
                          ? st.queueTarget || st.statusLabel
                          : st.prio !== undefined
                            ? `P${st.prio}`
                            : `#${idx + 1}`;
              return (
                <button
                  key={`${st.scriptNumber}-${st.index}-${idx}`}
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setStepIndex(idx);
                  }}
                  title={`Schritt ${idx + 1} (${formatSecondsMMSS(st.elapsedSeconds)}): ${st.title} (${st.reason})`}
                  className={`px-2 py-1 rounded text-[10.5px] font-mono tabular-nums border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    isCurrent
                      ? 'bg-indigo-600 border-indigo-500 text-white font-semibold'
                      : st.kind === 'overflow'
                        ? isDarkSurface
                          ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                          : 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                        : isPast
                          ? isDarkSurface
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/20'
                            : 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                          : controlBtnClass
                  }`}
                >
                  {idx + 1}. {shortText}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
