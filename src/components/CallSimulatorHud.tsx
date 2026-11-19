import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Pause,
  PhoneCall,
  Play,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  CallflowSimulationModel,
  CallSimulationStep,
  getDefaultWeekdayAndTime,
  simulateCallflow,
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

type PlaybackSpeed = 0.5 | 1 | 1.5 | 2;
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
  const [dtmfChoices, setDtmfChoices] = useState<Record<string, string>>({});
  const [dynamicOverrides, setDynamicOverrides] = useState<Record<string, boolean>>({});
  const [showSkipped, setShowSkipped] = useState<boolean>(false);

  const [setupOpen, setSetupOpen] = useState<boolean>(true);
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
    setSetupOpen(true);
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
  ]);

  const visibleSteps = useMemo(() => {
    return showSkipped
      ? simulation.steps
      : simulation.steps.filter((s) => s.kind !== 'rule-skipped');
  }, [simulation.steps, showSkipped]);

  // Clamp stepIndex when steps change
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

  // Auto-play timer (pauses automatically at the end or when waiting on DTMF digit)
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
    // If at end, restart from step 0 and play
    if (safeStepIndex >= visibleSteps.length - 1) {
      setStepIndex(0);
    }
    setSetupOpen(false);
    setIsPlaying(true);
  }, [isPlaying, safeStepIndex, visibleSteps.length]);

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

  // Keyboard navigation while Simulator HUD is open (Space = Play/Pause, Left/Right = Step, Esc = Close)
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, handleTogglePlay, handleStepBack, handleStepForward]);

  if (!isOpen) return null;

  const isAtEnd = safeStepIndex >= visibleSteps.length - 1;
  const stepTone = (() => {
    if (!activeStep) {
      return isDarkSurface
        ? 'text-slate-300 border-slate-700 bg-slate-800/70'
        : 'text-slate-700 border-slate-300 bg-slate-100';
    }
    if (activeStep.kind === 'outcome') {
      if (simulation.outcomeType === 'disconnect') {
        return isDarkSurface
          ? 'text-rose-200 border-rose-500/40 bg-rose-500/15'
          : 'text-rose-800 border-rose-300 bg-rose-50';
      }
      return isDarkSurface
        ? 'text-emerald-200 border-emerald-500/40 bg-emerald-500/15'
        : 'text-emerald-800 border-emerald-300 bg-emerald-50';
    }
    if (activeStep.kind === 'jump') {
      return isDarkSurface
        ? 'text-indigo-200 border-indigo-500/40 bg-indigo-500/15'
        : 'text-indigo-800 border-indigo-300 bg-indigo-50';
    }
    if (activeStep.kind === 'dtmf-prompt') {
      return isDarkSurface
        ? 'text-amber-200 border-amber-500/40 bg-amber-500/15'
        : 'text-amber-800 border-amber-300 bg-amber-50';
    }
    if (activeStep.kind === 'rule-skipped') {
      return isDarkSurface
        ? 'text-slate-300 border-slate-700 bg-slate-800/80'
        : 'text-slate-700 border-slate-300 bg-slate-100';
    }
    return isDarkSurface
      ? 'text-sky-200 border-sky-500/40 bg-sky-500/15'
      : 'text-sky-800 border-sky-300 bg-sky-50';
  })();

  const shellClass = isDarkSurface
    ? 'bg-slate-950/95 border-slate-700/90 text-slate-100'
    : 'bg-white/95 border-slate-300 text-slate-900';

  const dividerClass = isDarkSurface ? 'border-slate-800' : 'border-slate-200';
  const mutedTextClass = isDarkSurface ? 'text-slate-400' : 'text-slate-600';
  const controlBtnClass = isDarkSurface
    ? 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200 disabled:opacity-40'
    : 'bg-slate-50 hover:bg-slate-100 border-slate-300 text-slate-800 disabled:opacity-40';
  const inputClass = isDarkSurface
    ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500'
    : 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400';

  return (
    <div
      data-canvas-ui="true"
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className={`pointer-events-auto w-full max-w-[780px] rounded-xl border shadow-2xl backdrop-blur-md transition-opacity ${shellClass}`}
    >
      {/* Top Row: Live Header + Playback Controls */}
      <div className={`px-3 py-2 border-b ${dividerClass} flex flex-wrap items-center justify-between gap-2`}>
        <div className="flex items-center gap-2 min-w-0">
          <PhoneCall className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold whitespace-nowrap">Anruf-Simulator</span>
          <span className={`text-[11px] font-mono tabular-nums whitespace-nowrap ${mutedTextClass}`}>
            {visibleSteps.length > 0
              ? `Schritt ${safeStepIndex + 1} / ${visibleSteps.length}`
              : '0 Schritte'}
          </span>
          <button
            type="button"
            onClick={() => setSetupOpen((prev) => !prev)}
            className={`px-2 py-1 text-[11px] font-medium rounded-md border flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${controlBtnClass}`}
            title="Szenario-Auswahl (Skript, DNIS, Tag, Uhrzeit, Feiertag) ein-/ausklappen"
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>Szenario</span>
            {setupOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
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

          {/* Speed Segmented Selector */}
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

      {/* Collapsible Compact Scenario Selector Strip */}
      {setupOpen && (
        <div className={`px-3 py-2 border-b ${dividerClass} space-y-2`}>
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
              className={`flex-1 min-w-[180px] text-[11px] font-medium rounded-md border px-2 py-1 focus:outline-none focus:border-indigo-500 ${inputClass}`}
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
                <span>SondZeit</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showSkipped}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setShowSkipped(next);
                    setStepIndex(0);
                    setIsPlaying(false);
                  }}
                  className="accent-indigo-500"
                />
                <span>Alle Prüfungen</span>
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
        </div>
      )}

      {/* Live Step Explanation Area ("Was passiert gerade?") */}
      <div className="px-3 py-2.5 space-y-2">
        {activeStep ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`px-1.5 py-0.5 rounded border font-semibold whitespace-nowrap ${stepTone}`}>
                    {activeStep.statusLabel}
                  </span>
                  <span className={`font-mono font-semibold tabular-nums ${mutedTextClass}`}>
                    Skript {activeStep.scriptNumber}
                  </span>
                  <span className={`truncate ${mutedTextClass}`}>· {activeStep.scriptName}</span>
                </div>
                <div className="text-xs font-semibold mt-1 leading-snug">{activeStep.title}</div>
                <div className={`text-[11px] mt-0.5 leading-snug ${mutedTextClass}`}>
                  {activeStep.detail}
                  {activeStep.reason ? ` — ${activeStep.reason}` : ''}
                </div>
              </div>

              {isAtEnd && simulation.outcomeTitle && (
                <div className="shrink-0 text-right hidden sm:block">
                  <div className={`text-[10px] ${mutedTextClass}`}>Endergebnis</div>
                  <div className="text-[11px] font-semibold font-mono">
                    {simulation.outcomeTitle}
                  </div>
                </div>
              )}
            </div>

            {/* Inline DTMF Digit Choice when paused at a menu */}
            {activeStep.kind === 'dtmf-prompt' && simulation.pendingDtmf && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-semibold text-amber-400 whitespace-nowrap">
                  Taste wählen:
                </span>
                {simulation.pendingDtmf.choices.map((opt) => (
                  <button
                    key={`${simulation.pendingDtmf!.key}-${opt.choice}`}
                    type="button"
                    onClick={() => {
                      const dtmfKey = simulation.pendingDtmf!.key;
                      const nextIdx = safeStepIndex;
                      setDtmfChoices((prev) => ({ ...prev, [dtmfKey]: opt.choice }));
                      lastFocusedKeyRef.current = '';
                      setStepIndex(nextIdx);
                      setIsPlaying(true);
                    }}
                    className="px-2 py-1 text-[11px] font-medium rounded-md border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <span className="font-mono font-bold mr-1">[{opt.choice}]</span>
                    {opt.label || opt.targetNumber}
                  </button>
                ))}
              </div>
            )}

            {/* Inline Toggleable Dynamic Runtime Conditions (if any encountered) */}
            {simulation.dynamicPrompts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className={`text-[10.5px] whitespace-nowrap ${mutedTextClass}`}>
                  Laufzeit:
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
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-medium'
                        : controlBtnClass
                    }`}
                  >
                    {dp.active ? 'Aktiv: ' : 'Inaktiv: '}
                    {dp.label}
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
                  title={`Schritt ${idx + 1}: ${st.title} (${st.reason})`}
                  className={`px-2 py-1 rounded text-[10.5px] font-mono tabular-nums border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    isCurrent
                      ? 'bg-indigo-600 border-indigo-500 text-white font-semibold'
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
