import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Code2,
  Compass,
  EyeOff,
  Filter,
  Layers,
  Palette,
  RotateCcw,
  Sliders,
  Wand2,
  X,
} from 'lucide-react';
import {
  DiagramDirection,
  FlowchartCurve,
  LogicAnalysisSummary,
  MermaidBaseTheme,
  MermaidLook,
  SmartColorMode,
  SmartColorNodeType,
  ThemeConfiguration,
} from '../types/mermaidStudio';
import { DEFAULT_THEME_CONFIG, THEME_PRESETS } from '../data/mermaidTemplates';
import { SMART_COLOR_NODE_TYPE_OPTIONS } from '../utils/smartColorEngine';

interface ThemeConfiguratorProps {
  themeConfig: ThemeConfiguration;
  onChangeTheme: (next: ThemeConfiguration) => void;
  smartColorMode: SmartColorMode;
  onChangeSmartColorMode: (mode: SmartColorMode) => void;
  hiddenNodeTypes: SmartColorNodeType[];
  onChangeHiddenNodeTypes: (next: SmartColorNodeType[]) => void;
  logicSummary: LogicAnalysisSummary;
  onInjectSmartClassDefs: () => void;
  currentDirection: DiagramDirection | null;
  onChangeDirection: (dir: DiagramDirection) => void;
  onInjectInitDirective: () => void;
  canvasSurface: 'dark' | 'light';
  onChangeCanvasSurface: (surface: 'dark' | 'light') => void;
  onClose: () => void;
  isMobileView?: boolean;
}

const SMART_COLOR_MODES: Array<{
  id: SmartColorMode;
  label: string;
  description: string;
}> = [
  {
    id: 'semantic',
    label: 'Semantische Rollen',
    description: 'Färbt Knoten automatisch nach Logik (Start/Client, Entscheidung, DB, Queue, Service, Fehler)',
  },
  {
    id: 'clusters',
    label: 'Ebenen- & Cluster-Fokus',
    description: 'Hebt Subgraphs, Architektur-Zonen und Hierarchie-Stufen in getrennten Farbzonen hervor',
  },
  {
    id: 'high-contrast',
    label: 'Hoher Kontrast & Datenfluss',
    description: 'Maximale Lesbarkeit mit farblich differenzierten Haupt- und Event-Pfaden',
  },
  {
    id: 'standard',
    label: 'Standard (Einheitlich)',
    description: 'Verwendet ausschließlich die Basis-Farben ohne automatische Logik-Differenzierung',
  },
];

const CURVE_OPTIONS: Array<{ value: FlowchartCurve; label: string }> = [
  { value: 'basis', label: 'Basis (Weiche Kurve)' },
  { value: 'linear', label: 'Linear (Direkt)' },
  { value: 'stepBefore', label: 'Orthogonal (Stufe)' },
  { value: 'monotoneX', label: 'Monotone X' },
  { value: 'bumpX', label: 'Bump S-Kurve' },
  { value: 'cardinal', label: 'Kardinal-Spline' },
];

const BASE_THEMES: Array<{ value: MermaidBaseTheme; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'default', label: 'Default' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'forest', label: 'Forest' },
  { value: 'base', label: 'Base' },
];

const DIRECTION_OPTIONS: Array<{ value: DiagramDirection; label: string; hint: string }> = [
  { value: 'LR', label: 'LR', hint: 'Links nach Rechts' },
  { value: 'TB', label: 'TB', hint: 'Oben nach Unten' },
  { value: 'RL', label: 'RL', hint: 'Rechts nach Links' },
  { value: 'BT', label: 'BT', hint: 'Unten nach Oben' },
];

const ThemeConfiguratorInner: React.FC<ThemeConfiguratorProps> = ({
  themeConfig,
  onChangeTheme,
  smartColorMode,
  onChangeSmartColorMode,
  hiddenNodeTypes,
  onChangeHiddenNodeTypes,
  logicSummary,
  onInjectSmartClassDefs,
  currentDirection,
  onChangeDirection,
  onInjectInitDirective,
  canvasSurface,
  onChangeCanvasSurface,
  onClose,
  isMobileView = false,
}) => {
  const [directiveInjected, setDirectiveInjected] = useState(false);
  const [classDefInjected, setClassDefInjected] = useState(false);
  const [isNodeFilterOpen, setIsNodeFilterOpen] = useState(false);
  const nodeFilterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isNodeFilterOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (nodeFilterRef.current && !nodeFilterRef.current.contains(event.target as Node)) {
        setIsNodeFilterOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNodeFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNodeFilterOpen]);

  const handleToggleNodeType = (typeId: SmartColorNodeType) => {
    if (hiddenNodeTypes.includes(typeId)) {
      onChangeHiddenNodeTypes(hiddenNodeTypes.filter((t) => t !== typeId));
    } else {
      onChangeHiddenNodeTypes([...hiddenNodeTypes, typeId]);
    }
  };

  const handleFieldChange = <K extends keyof ThemeConfiguration>(
    key: K,
    value: ThemeConfiguration[K]
  ) => {
    onChangeTheme({
      ...themeConfig,
      [key]: value,
    });
  };

  const handlePresetSelect = (preset: (typeof THEME_PRESETS)[number]) => {
    onChangeTheme({
      ...themeConfig,
      ...preset.config,
    });
    onChangeCanvasSurface(preset.recommendedCanvas);
  };

  const handleReset = () => {
    onChangeTheme(DEFAULT_THEME_CONFIG);
    onChangeSmartColorMode('semantic');
    onChangeHiddenNodeTypes([]);
    onChangeCanvasSurface('dark');
  };

  const handleEmbedClick = () => {
    onInjectInitDirective();
    setDirectiveInjected(true);
    setTimeout(() => setDirectiveInjected(false), 2000);
  };

  const handleClassDefClick = () => {
    onInjectSmartClassDefs();
    setClassDefInjected(true);
    setTimeout(() => setClassDefInjected(false), 2000);
  };

  return (
    <aside
      className={`${
        isMobileView
          ? 'w-full min-w-0 flex-1 bg-slate-950'
          : 'w-80 xl:w-84 shrink-0 border-l border-slate-800 bg-slate-900/95'
      } flex flex-col h-full select-none overflow-hidden`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90 shrink-0">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-indigo-400 shrink-0" />
          <h2 className="text-sm font-semibold text-slate-100 whitespace-nowrap">
            Logik-Farben & Theme-Studio
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleReset}
            title="Auf Studio-Standard zurücksetzen"
            className="min-h-[36px] min-w-[36px] lg:min-h-0 lg:min-w-0 p-1.5 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          {!isMobileView && (
            <button
              type="button"
              onClick={onClose}
              title="Konfigurator einklappen"
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Section 0: Smart Logic Coloring Switcher */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
              <Wand2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Logik-Farbdifferenzierung</span>
            </div>
            {logicSummary.recommendedMode !== smartColorMode && (
              <button
                type="button"
                onClick={() => onChangeSmartColorMode(logicSummary.recommendedMode)}
                className="text-[11px] text-emerald-400 hover:underline whitespace-nowrap shrink-0"
              >
                Empfehlung aktivieren
              </button>
            )}
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            {logicSummary.recommendationReason}
          </p>

          <div className="grid grid-cols-1 gap-1.5">
            {SMART_COLOR_MODES.map((m) => {
              const isSelected = smartColorMode === m.id;
              const isRecommended = logicSummary.recommendedMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onChangeSmartColorMode(m.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex flex-col gap-0.5 min-h-[44px] ${
                    isSelected
                      ? 'bg-indigo-950/60 border-indigo-500 text-slate-100'
                      : 'bg-slate-900/70 lg:bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-100">
                      {m.label}
                    </span>
                    {isRecommended && (
                      <span className="text-[10px] text-emerald-400 font-medium whitespace-nowrap">
                        Empfohlen für diesen Code
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 leading-snug">
                    {m.description}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Node-Type Filter Dropdown (excludes selected node types from smart coloring analysis without changing source code) */}
          <div ref={nodeFilterRef} className="pt-2 space-y-1.5 relative">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Knotentypen in Analyse</span>
              </span>
              {hiddenNodeTypes.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChangeHiddenNodeTypes([])}
                  className="text-[11px] text-indigo-300 hover:text-indigo-200 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Alle einblenden
                </button>
              )}
            </div>

            <button
              type="button"
              aria-expanded={isNodeFilterOpen}
              aria-haspopup="listbox"
              onClick={() => setIsNodeFilterOpen((prev) => !prev)}
              className={`w-full min-h-[40px] px-3 py-2 text-xs rounded-lg border transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                hiddenNodeTypes.length > 0
                  ? 'bg-indigo-950/50 border-indigo-500/70 text-slate-100'
                  : 'bg-slate-900 lg:bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-700'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                {hiddenNodeTypes.length > 0 ? (
                  <EyeOff className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                ) : (
                  <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                <span className="truncate font-medium">
                  {hiddenNodeTypes.length === 0
                    ? `Alle Knotentypen sichtbar (${SMART_COLOR_NODE_TYPE_OPTIONS.length}/${SMART_COLOR_NODE_TYPE_OPTIONS.length})`
                    : `${hiddenNodeTypes.length} ${
                        hiddenNodeTypes.length === 1 ? 'Typ' : 'Typen'
                      } ausgeblendet${
                        (logicSummary.hiddenNodeCount || 0) > 0
                          ? ` · ${logicSummary.hiddenNodeCount} Knoten`
                          : ''
                      }`}
                </span>
              </span>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-150 ${
                  isNodeFilterOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isNodeFilterOpen && (
              <div
                role="listbox"
                aria-multiselectable="true"
                aria-label="Knotentypen aus Smart-Coloring-Analyse filtern"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 shadow-lg overflow-hidden z-30"
              >
                <div className="divide-y divide-slate-800/80 max-h-64 overflow-y-auto">
                  {SMART_COLOR_NODE_TYPE_OPTIONS.map((opt) => {
                    const isHidden = hiddenNodeTypes.includes(opt.id);
                    const isChecked = !isHidden;
                    const typeCount = logicSummary.detectedTypeCounts?.[opt.id] ?? 0;

                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="option"
                        aria-selected={isChecked}
                        onClick={() => handleToggleNodeType(opt.id)}
                        className={`w-full text-left px-3 py-2.5 flex items-start justify-between gap-2.5 transition-colors cursor-pointer ${
                          isChecked
                            ? 'hover:bg-slate-900/90 text-slate-100'
                            : 'bg-slate-900/40 hover:bg-slate-900/80 text-slate-400'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <span
                            className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              isChecked
                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                : 'bg-slate-950 border-slate-600 text-transparent'
                            }`}
                          >
                            <Check className="w-3 h-3" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="w-2.5 h-2.5 rounded-xs shrink-0"
                                style={{ backgroundColor: opt.swatchColor }}
                              />
                              <span
                                className={`text-xs font-medium truncate ${
                                  isHidden ? 'line-through text-slate-500' : 'text-slate-100'
                                }`}
                              >
                                {opt.label}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                              {opt.description}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`text-[11px] font-mono tabular-nums shrink-0 mt-0.5 ${
                            typeCount > 0 ? 'text-slate-300' : 'text-slate-600'
                          }`}
                        >
                          {typeCount}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="px-3 py-2 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span>Code bleibt unverändert</span>
                  <button
                    type="button"
                    onClick={() => setIsNodeFilterOpen(false)}
                    className="text-indigo-300 hover:text-indigo-200 font-medium whitespace-nowrap cursor-pointer"
                  >
                    Fertig
                  </button>
                </div>
              </div>
            )}

            {hiddenNodeTypes.length > 0 && !isNodeFilterOpen && (
              <p className="text-[11px] text-slate-400 leading-snug">
                Ausgeblendet:{' '}
                <span className="text-slate-200">
                  {hiddenNodeTypes
                    .map(
                      (id) =>
                        SMART_COLOR_NODE_TYPE_OPTIONS.find((opt) => opt.id === id)?.label || id
                    )
                    .join(' · ')}
                </span>
              </p>
            )}
          </div>
        </section>

        {/* Section 1: Layout Direction & Look */}
        <section className="space-y-3 pt-4 border-t border-slate-800/80">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <Compass className="w-3.5 h-3.5 text-indigo-400" />
            <span>Flussrichtung & Geometrie</span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Diagramm-Ausrichtung</span>
              <span>{currentDirection ? `Aktiv: ${currentDirection}` : 'Typ-spezifisch'}</span>
            </div>
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-900 lg:bg-slate-950 rounded-lg border border-slate-800">
              {DIRECTION_OPTIONS.map((dir) => {
                const active = currentDirection === dir.value;
                return (
                  <button
                    key={dir.value}
                    type="button"
                    title={dir.hint}
                    onClick={() => onChangeDirection(dir.value)}
                    className={`min-h-[38px] lg:min-h-0 py-1.5 px-2 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                    }`}
                  >
                    {dir.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Look Mode: Classic vs HandDrawn */}
          <div className="space-y-1.5">
            <span className="text-xs text-slate-400 block">Zeichenstil (Mermaid v11 Look)</span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-900 lg:bg-slate-950 rounded-lg border border-slate-800">
              {(['classic', 'handDrawn'] as MermaidLook[]).map((lookMode) => (
                <button
                  key={lookMode}
                  type="button"
                  onClick={() => handleFieldChange('look', lookMode)}
                  className={`min-h-[38px] lg:min-h-0 py-1.5 px-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    themeConfig.look === lookMode
                      ? 'bg-slate-800 text-slate-100 border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {lookMode === 'classic' ? 'Präzise (Classic)' : 'Skizze (Hand-Drawn)'}
                </button>
              ))}
            </div>
          </div>

          {/* Curve Interpolation */}
          <div className="space-y-1.5">
            <label htmlFor="curve-select" className="text-xs text-slate-400 block">
              Kanten-Interpolation (Flowchart)
            </label>
            <select
              id="curve-select"
              value={themeConfig.curve}
              onChange={(e) => handleFieldChange('curve', e.target.value as FlowchartCurve)}
              className="w-full min-h-[40px] lg:min-h-0 px-3 py-2 lg:py-1.5 text-xs bg-slate-900 lg:bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              {CURVE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Section 2: Curated Base Profiles */}
        <section className="space-y-2.5 pt-4 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300">Kuratierte Grundprofile</span>
            <span className="text-xs text-slate-500">Basis-Theme</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
            {THEME_PRESETS.map((preset) => {
              const isSelected =
                preset.config.useCustomColors === themeConfig.useCustomColors &&
                (!preset.config.primaryBorderColor ||
                  preset.config.primaryBorderColor === themeConfig.primaryBorderColor) &&
                (!preset.config.theme || preset.config.theme === themeConfig.theme);

              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePresetSelect(preset)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors flex items-center justify-between gap-2 min-h-[42px] ${
                    isSelected
                      ? 'bg-indigo-950/50 border-indigo-500/60 text-slate-100'
                      : 'bg-slate-900/70 lg:bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-100 truncate">
                      {preset.name}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">
                      {preset.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {preset.config.primaryColor && (
                      <span
                        className="w-3.5 h-3.5 rounded-sm border border-white/20"
                        style={{ backgroundColor: preset.config.primaryColor }}
                      />
                    )}
                    {preset.config.primaryBorderColor && (
                      <span
                        className="w-3.5 h-3.5 rounded-sm border border-white/20"
                        style={{ backgroundColor: preset.config.primaryBorderColor }}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Section 3: Custom Color Variables vs Native Base Theme */}
        <section className="space-y-3 pt-4 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span>Grundfarben (themeVariables)</span>
            </div>
            <button
              type="button"
              onClick={() => {
                const nextUseCustom = !themeConfig.useCustomColors;
                onChangeTheme({
                  ...themeConfig,
                  useCustomColors: nextUseCustom,
                  theme:
                    !nextUseCustom &&
                    canvasSurface === 'dark' &&
                    (themeConfig.theme === 'default' || themeConfig.theme === 'base')
                      ? 'dark'
                      : themeConfig.theme,
                });
              }}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                themeConfig.useCustomColors
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              {themeConfig.useCustomColors ? 'Eigene Farben aktiv' : 'Standard-Theme'}
            </button>
          </div>

          {!themeConfig.useCustomColors ? (
            <div className="space-y-2">
              <span className="text-xs text-slate-400 block">Natives Mermaid Basis-Theme</span>
              <div className="grid grid-cols-3 gap-1.5">
                {BASE_THEMES.map((bt) => (
                  <button
                    key={bt.value}
                    type="button"
                    onClick={() => handleFieldChange('theme', bt.value)}
                    className={`min-h-[38px] lg:min-h-0 py-1.5 px-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                      themeConfig.theme === bt.value
                        ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                        : 'bg-slate-900 lg:bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {bt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2.5">
              <ColorField
                label="Knoten-Füllung"
                value={themeConfig.primaryColor}
                onChange={(val) => {
                  onChangeTheme({
                    ...themeConfig,
                    primaryColor: val,
                    mainBkg: val,
                  });
                }}
              />
              <ColorField
                label="Knoten-Rahmen"
                value={themeConfig.primaryBorderColor}
                onChange={(val) => {
                  onChangeTheme({
                    ...themeConfig,
                    primaryBorderColor: val,
                    nodeBorder: val,
                  });
                }}
              />
              <ColorField
                label="Knoten-Text"
                value={themeConfig.primaryTextColor}
                onChange={(val) => {
                  onChangeTheme({
                    ...themeConfig,
                    primaryTextColor: val,
                    titleColor: val,
                  });
                }}
              />
              <ColorField
                label="Linien & Pfeile"
                value={themeConfig.lineColor}
                onChange={(val) => handleFieldChange('lineColor', val)}
              />
              <ColorField
                label="Cluster-Fläche"
                value={themeConfig.clusterBkg}
                onChange={(val) => {
                  onChangeTheme({
                    ...themeConfig,
                    clusterBkg: val,
                    secondaryColor: val,
                  });
                }}
              />
              <ColorField
                label="Cluster-Rahmen"
                value={themeConfig.clusterBorder}
                onChange={(val) => handleFieldChange('clusterBorder', val)}
              />
            </div>
          )}
        </section>

        {/* Section 4: Canvas Surface Switch */}
        <section className="space-y-2 pt-4 border-t border-slate-800/80">
          <span className="text-xs font-medium text-slate-300 block">
            Vorschau-Bühne (Canvas-Hintergrund)
          </span>
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-900 lg:bg-slate-950 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => onChangeCanvasSurface('dark')}
              className={`min-h-[38px] lg:min-h-0 py-1.5 px-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                canvasSurface === 'dark'
                  ? 'bg-slate-800 text-slate-100 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Studio Dunkel
            </button>
            <button
              type="button"
              onClick={() => onChangeCanvasSurface('light')}
              className={`min-h-[38px] lg:min-h-0 py-1.5 px-2.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                canvasSurface === 'light'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Dokument Hell
            </button>
          </div>
        </section>
      </div>

      {/* Footer Actions: Inject Smart ClassDefs or %%{init}%% directive */}
      <div className="p-3.5 border-t border-slate-800 bg-slate-900/90 lg:bg-slate-950/60 space-y-2 shrink-0">
        <button
          type="button"
          onClick={handleClassDefClick}
          className="w-full min-h-[38px] lg:min-h-0 py-2 px-3 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-200 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          {classDefInjected ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Logik-Farben (classDef) in Code eingefügt</span>
            </>
          ) : (
            <>
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>Logik-Farben als classDef in Code schreiben</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleEmbedClick}
          className="w-full min-h-[38px] lg:min-h-0 py-2 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          {directiveInjected ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>%%&#123;init&#125;%% in Code eingebettet</span>
            </>
          ) : (
            <>
              <Code2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Als %%&#123;init&#125;%% Header einbetten</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};

export const ThemeConfigurator = React.memo(ThemeConfiguratorInner);
ThemeConfigurator.displayName = 'ThemeConfigurator';

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

const ColorField: React.FC<ColorFieldProps> = ({ label, value, onChange }) => {
  return (
    <div className="bg-slate-900/80 lg:bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex flex-col gap-1.5">
      <span className="text-[11px] text-slate-400 truncate">{label}</span>
      <div className="flex items-center gap-2">
        <label className="relative w-7 h-7 lg:w-6 lg:h-6 rounded border border-white/20 overflow-hidden cursor-pointer shrink-0">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="sr-only"
          />
          <span className="block w-full h-full" style={{ backgroundColor: value }} />
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-xs font-mono text-slate-200 focus:outline-none uppercase tabular-nums"
          maxLength={7}
        />
      </div>
    </div>
  );
};
