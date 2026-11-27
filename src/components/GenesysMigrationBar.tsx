import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  FileCode2,
  GitBranch,
  Layers,
  Pencil,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react';
import {
  ArchyYamlValidationIssue,
  FlowIRFindingCategory,
  GenesysReadinessLevel,
  GenesysScriptTranslation,
  GenesysWorkspaceTranslation,
  classifyFlowIRFinding,
  exportAllArchyYamlsZipBlob,
  validateArchyYaml,
} from '../utils/genesysMigrationAnalyzer';

interface GenesysMigrationBarProps {
  translation: GenesysWorkspaceTranslation;
  activeScript?: GenesysScriptTranslation | null;
  isMasterView: boolean;
  onSelectDetailScript?: (scriptNumber: string) => void;
  compatibilityStubMode?: boolean;
  onToggleCompatibilityStubMode?: () => void;
}

interface ScopedValidationIssue extends ArchyYamlValidationIssue {
  fileName: string;
  scriptNumber: string;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const FINDING_CATEGORY_ORDER: FlowIRFindingCategory[] = [
  'provenance',
  'expression_review',
  'holiday_logic',
  'terminality',
  'subflow',
  'reference',
  'scope',
  'reachability',
];

const FINDING_CATEGORY_LABELS: Record<FlowIRFindingCategory, string> = {
  provenance: 'Provenance',
  expression_review: 'Ausdrucksprüfung',
  holiday_logic: 'Feiertagslogik',
  terminality: 'Terminalität',
  subflow: 'Subflows',
  reference: 'Referenzen',
  scope: 'Scope',
  reachability: 'Reachability',
};

function getReadinessBadgeClasses(level: GenesysReadinessLevel): string {
  switch (level) {
    case 'HIGH':
      return 'bg-rose-500/20 text-rose-200 border-rose-500/50';
    case 'MEDIUM':
      return 'bg-amber-500/20 text-amber-200 border-amber-500/50';
    case 'LOW':
    default:
      return 'bg-emerald-500/20 text-emerald-200 border-emerald-500/50';
  }
}

export const GenesysMigrationBar: React.FC<GenesysMigrationBarProps> = ({
  translation,
  activeScript,
  isMasterView,
  onSelectDetailScript,
  compatibilityStubMode = false,
  onToggleCompatibilityStubMode,
}) => {
  const [showYamlPreview, setShowYamlPreview] = useState(false);
  const [previewMode, setPreviewMode] = useState<'genesys' | 'avaya'>('genesys');
  const [showWarnings, setShowWarnings] = useState(false);
  const [showValidationPanel, setShowValidationPanel] = useState(false);
  const [isEditingYaml, setIsEditingYaml] = useState(false);
  const [customYamlText, setCustomYamlText] = useState('');
  const [copiedYaml, setCopiedYaml] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);

  const effectiveScript: GenesysScriptTranslation | null = useMemo(() => {
    if (activeScript) return activeScript;
    return (
      translation.scripts.find((s) => s.isEntryPoint) ||
      translation.scripts[0] ||
      null
    );
  }, [activeScript, translation.scripts]);

  useEffect(() => {
    setCustomYamlText(effectiveScript?.archyYaml || '');
    setIsEditingYaml(false);
  }, [effectiveScript?.scriptKey, effectiveScript?.archyYaml]);

  const liveEditorValidation = useMemo(() => {
    if (!isEditingYaml || !effectiveScript) return null;
    return validateArchyYaml(customYamlText);
  }, [isEditingYaml, customYamlText, effectiveScript]);

  const displayedReadiness: GenesysReadinessLevel = isMasterView
    ? translation.overallReadiness
    : effectiveScript?.readiness || translation.overallReadiness;

  const displayedWarnings = useMemo(() => {
    if (!isMasterView && effectiveScript) {
      return effectiveScript.warnings.map((w) => ({
        ...w,
        fileName: effectiveScript.fileName,
        scriptNumber: effectiveScript.scriptNumber,
      }));
    }
    return translation.scripts.flatMap((s) =>
      s.warnings.map((w) => ({
        ...w,
        fileName: s.fileName,
        scriptNumber: s.scriptNumber,
      }))
    );
  }, [isMasterView, effectiveScript, translation.scripts]);

  const displayedIrFindings = useMemo(() => {
    const raw =
      !isMasterView && effectiveScript
        ? (effectiveScript.flowIR?.findings || []).map((f) => ({
            ...f,
            fileName: effectiveScript.fileName,
            scriptNumber: effectiveScript.scriptNumber,
          }))
        : translation.scripts.flatMap((s) =>
            (s.flowIR?.findings || []).map((f) => ({
              ...f,
              fileName: s.fileName,
              scriptNumber: s.scriptNumber,
            }))
          );
    return raw.map((f) => {
      const fallbackMeta = classifyFlowIRFinding(f.code);
      return {
        ...f,
        category: f.category || fallbackMeta.category,
        requiresBusinessReview: f.requiresBusinessReview ?? fallbackMeta.requiresBusinessReview,
      };
    });
  }, [isMasterView, effectiveScript, translation.scripts]);

  const openReviewCount = useMemo(
    () => displayedIrFindings.filter((f) => f.requiresBusinessReview).length,
    [displayedIrFindings]
  );

  const groupedIrFindings = useMemo(() => {
    const map = new Map<FlowIRFindingCategory, typeof displayedIrFindings>();
    for (const f of displayedIrFindings) {
      const cat = f.category;
      const list = map.get(cat) || [];
      list.push(f);
      map.set(cat, list);
    }
    return FINDING_CATEGORY_ORDER.filter((cat) => (map.get(cat)?.length || 0) > 0).map((cat) => ({
      category: cat,
      label: FINDING_CATEGORY_LABELS[cat],
      items: map.get(cat)!,
    }));
  }, [displayedIrFindings]);

  const displayedValidation = useMemo(() => {
    if (isEditingYaml && effectiveScript && liveEditorValidation) {
      const errors: ScopedValidationIssue[] = liveEditorValidation.errors.map((e) => ({
        ...e,
        fileName: effectiveScript.archyFilename,
        scriptNumber: effectiveScript.scriptNumber,
      }));
      const warnings: ScopedValidationIssue[] = liveEditorValidation.warnings.map((w) => ({
        ...w,
        fileName: effectiveScript.archyFilename,
        scriptNumber: effectiveScript.scriptNumber,
      }));
      return {
        isValid: liveEditorValidation.isValid,
        errorCount: errors.length,
        warningCount: warnings.length,
        validScriptCount: liveEditorValidation.isValid ? 1 : 0,
        totalScriptCount: 1,
        stats: liveEditorValidation.stats,
        errors,
        warnings,
        isCustomEdited: true,
      };
    }

    if (!isMasterView && effectiveScript) {
      const v = effectiveScript.yamlValidation;
      return {
        isValid: v.isValid,
        errorCount: v.errors.length,
        warningCount: v.warnings.length,
        validScriptCount: v.isValid ? 1 : 0,
        totalScriptCount: 1,
        stats: v.stats,
        errors: v.errors.map((e) => ({
          ...e,
          fileName: effectiveScript.archyFilename,
          scriptNumber: effectiveScript.scriptNumber,
        })),
        warnings: v.warnings.map((w) => ({
          ...w,
          fileName: effectiveScript.archyFilename,
          scriptNumber: effectiveScript.scriptNumber,
        })),
        isCustomEdited: false,
      };
    }

    const errors: ScopedValidationIssue[] = translation.scripts.flatMap((s) =>
      s.yamlValidation.errors.map((e) => ({
        ...e,
        fileName: s.archyFilename,
        scriptNumber: s.scriptNumber,
      }))
    );
    const warnings: ScopedValidationIssue[] = translation.scripts.flatMap((s) =>
      s.yamlValidation.warnings.map((w) => ({
        ...w,
        fileName: s.archyFilename,
        scriptNumber: s.scriptNumber,
      }))
    );
    return {
      isValid: errors.length === 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      validScriptCount: translation.summary.yamlValidScriptCount,
      totalScriptCount: translation.summary.totalScripts,
      stats: null,
      errors,
      warnings,
      isCustomEdited: false,
    };
  }, [isEditingYaml, liveEditorValidation, isMasterView, effectiveScript, translation]);

  const activeYamlContent =
    isEditingYaml && effectiveScript ? customYamlText : effectiveScript?.archyYaml || '';

  const activeModeReport = useMemo(() => {
    if (!effectiveScript) return null;
    return previewMode === 'avaya' ? effectiveScript.avayaView : effectiveScript.genesysView;
  }, [effectiveScript, previewMode]);

  const activePreviewCode = useMemo(() => {
    if (!effectiveScript) return '';
    if (previewMode === 'avaya') {
      return effectiveScript.avayaView?.ergebnisText || '';
    }
    return activeYamlContent;
  }, [effectiveScript, previewMode, activeYamlContent]);

  const handleDownloadSingleYaml = () => {
    if (!effectiveScript) return;
    const blob = new Blob([activeYamlContent], {
      type: 'application/x-yaml;charset=utf-8',
    });
    downloadBlob(blob, effectiveScript.archyFilename);
  };

  const handleDownloadMigrationGraphJson = () => {
    if (!effectiveScript?.flowIR) return;
    const blob = new Blob([JSON.stringify({ flowIR: effectiveScript.flowIR }, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    downloadBlob(blob, `${effectiveScript.cleanName}.graph.json`);
  };

  const handleDownloadZipAll = async () => {
    if (translation.scripts.length === 0 || isExportingZip) return;
    setIsExportingZip(true);
    try {
      const zipBlob = await exportAllArchyYamlsZipBlob(translation);
      downloadBlob(zipBlob, 'genesys-archy-flows.zip');
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleCopyYaml = async () => {
    if (!effectiveScript) return;
    try {
      await navigator.clipboard.writeText(activePreviewCode);
      setCopiedYaml(true);
      setTimeout(() => setCopiedYaml(false), 2000);
    } catch {
      // Ignore if clipboard blocked
    }
  };

  const handleResetCustomYaml = () => {
    if (!effectiveScript) return;
    setCustomYamlText(effectiveScript.archyYaml);
  };

  if (translation.scripts.length === 0) {
    return (
      <div className="px-3 py-2 border-b border-orange-500/30 bg-orange-950/25 text-xs text-orange-200 flex items-center justify-between gap-2 shrink-0">
        <span className="font-medium">
          Genesys Cloud Architect Vorschau aktiv — lade zuerst Avaya-.s-Skripte oder ein Visio-Flow, um Archy YAML &amp; Ziel-Diagramm zu erzeugen.
        </span>
      </div>
    );
  }

  const validationBadgeLabel = displayedValidation.isValid
    ? isMasterView && !displayedValidation.isCustomEdited
      ? `YAML valide (${displayedValidation.validScriptCount}/${displayedValidation.totalScriptCount})`
      : displayedValidation.warningCount > 0
      ? `YAML valide · ${displayedValidation.warningCount} ${
          displayedValidation.warningCount === 1 ? 'Hinweis' : 'Hinweise'
        }`
      : 'YAML valide'
    : `${displayedValidation.errorCount} YAML-Fehler`;

  return (
    <div className="border-b border-orange-500/35 bg-slate-950/95 shrink-0">
      {/* Compact Primary Bar */}
      <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        {/* Left: Active Mode + Readiness Badge + Live YAML Validation Badge + Warnings */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="px-2 py-0.5 rounded bg-orange-600/25 border border-orange-500/50 text-orange-200 text-[11px] font-semibold whitespace-nowrap flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span>
              {isMasterView
                ? 'Genesys Ziel-Architektur (Master)'
                : `Genesys Flow: ${effectiveScript?.cleanName || ''}`}
            </span>
          </span>

          <span
            className={`px-2 py-0.5 rounded border text-[11px] font-mono font-semibold tabular-nums whitespace-nowrap ${getReadinessBadgeClasses(
              displayedReadiness
            )}`}
            title={
              !isMasterView && effectiveScript
                ? effectiveScript.readinessReasons.join(' · ')
                : `LOW: ${translation.summary.lowCount} · MEDIUM: ${translation.summary.mediumCount} · HIGH: ${translation.summary.highCount}`
            }
          >
            Readiness: {displayedReadiness}
          </span>

          <button
            type="button"
            onClick={() => setShowValidationPanel((v) => !v)}
            title={
              displayedValidation.isValid
                ? 'Archy-YAML & flowIR v1.1 Vollprüfung — klicken für Details & offene Migrationsfragen'
                : `${displayedValidation.errorCount} Archy-YAML Schema-Fehler gefunden — klicken für Fehlerdetails (Export bleibt möglich)`
            }
            className={`px-2 py-0.5 rounded border text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
              displayedValidation.isValid
                ? showValidationPanel
                  ? 'bg-emerald-500/30 border-emerald-400 text-emerald-100'
                  : 'bg-emerald-500/15 border-emerald-500/45 text-emerald-200 hover:bg-emerald-500/25'
                : showValidationPanel
                ? 'bg-rose-500/35 border-rose-400 text-rose-100'
                : 'bg-rose-500/20 border-rose-500/55 text-rose-200 hover:bg-rose-500/30'
            }`}
          >
            {displayedValidation.isValid ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
            )}
            <span>
              {validationBadgeLabel}
              {displayedIrFindings.length > 0 ? ` · ${displayedIrFindings.length} IR` : ''}
            </span>
          </button>

          {isMasterView ? (
            <span className="text-[11px] font-mono text-slate-400 tabular-nums hidden xl:inline">
              LOW {translation.summary.lowCount} · MED {translation.summary.mediumCount} · HIGH{' '}
              {translation.summary.highCount} · Common Modules:{' '}
              {translation.summary.commonModuleCount}
            </span>
          ) : effectiveScript ? (
            <span className="text-[11px] text-slate-400 truncate max-w-[260px] hidden xl:inline">
              {effectiveScript.readinessReasons.join(' · ')}
            </span>
          ) : null}

          {displayedWarnings.length > 0 && (
            <button
              type="button"
              onClick={() => setShowWarnings((v) => !v)}
              className={`px-2 py-0.5 rounded border text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                showWarnings
                  ? 'bg-amber-500/30 border-amber-400 text-amber-100'
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25'
              }`}
            >
              <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
              <span className="tabular-nums">
                {displayedWarnings.length}{' '}
                {displayedWarnings.length === 1 ? 'Warnung' : 'Warnungen'}
              </span>
            </button>
          )}

          {onToggleCompatibilityStubMode && (
            <button
              type="button"
              onClick={onToggleCompatibilityStubMode}
              title={
                compatibilityStubMode
                  ? 'Kompatibilitäts-/Stub-Modus aktiv: Unbelegte Variablen werden testweise per getParticipantData/Lookup ergänzt. Klicken für strikte ehrliche Migration.'
                  : 'Ehrliche Migration (Standard): Keine erfundenen getParticipantData- oder Lookup-Annahmen; fehlende Quellen werden als offene Migrationsfrage markiert. Klicken für optionalen Stub-Modus.'
              }
              className={`px-2 py-0.5 rounded border text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                compatibilityStubMode
                  ? 'bg-amber-500/25 border-amber-400/70 text-amber-100 hover:bg-amber-500/35'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100'
              }`}
            >
              <span>{compatibilityStubMode ? 'Stub-Modus (Opt-In)' : 'Ehrliche Migration'}</span>
            </button>
          )}
        </div>

        {/* Right: Archy YAML / flowIR Preview & Downloads (Export remains always enabled) */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowYamlPreview((v) => !v)}
            className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              showYamlPreview
                ? 'bg-orange-600/30 border-orange-400/60 text-orange-100'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span>{showYamlPreview ? 'YAML / IR schließen' : 'Archy YAML / IR'}</span>
          </button>

          {effectiveScript && (
            <>
              <button
                type="button"
                onClick={handleDownloadSingleYaml}
                title={
                  displayedValidation.isValid
                    ? `Einzelnes Genesys Archy YAML (${effectiveScript.archyFilename}) aus dem RAM herunterladen`
                    : `Hinweis: Enthält ${displayedValidation.errorCount} Schema-Fehler — Export bleibt trotzdem möglich`
                }
                className="px-2.5 py-1 rounded-md bg-orange-600 hover:bg-orange-500 text-white text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>{effectiveScript.archyFilename}</span>
                {!displayedValidation.isValid && (
                  <AlertTriangle className="w-3 h-3 text-amber-200 shrink-0" />
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadMigrationGraphJson}
                title={`Kanonische flowIR v1.1 Zwischenrepräsentation (${effectiveScript.cleanName}.graph.json) als JSON herunterladen`}
                className="px-2 py-1 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
              >
                <GitBranch className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>flowIR (.json)</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleDownloadZipAll}
            disabled={isExportingZip}
            title={
              translation.summary.yamlErrorCount === 0
                ? 'Alle generierten Archy-YAML-Dateien + flowIR v1.1 + Readiness-Übersicht als ZIP aus dem RAM herunterladen'
                : `Hinweis: ${translation.summary.yamlErrorCount} Schema-Fehler im Workspace — ZIP-Export bleibt trotzdem möglich`
            }
            className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <Archive className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>
              {isExportingZip
                ? 'ZIP wird erstellt…'
                : `Alle YAML (.zip · ${translation.scripts.length})`}
            </span>
          </button>
        </div>
      </div>

      {/* Expandable Archy YAML + flowIR v1.1 Validation Panel */}
      {showValidationPanel && (
        <div className="px-3 py-2 border-t border-slate-800 bg-slate-900/95 max-h-60 overflow-y-auto space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] font-semibold uppercase tracking-wide pb-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={displayedValidation.isValid ? 'text-emerald-300' : 'text-rose-300'}>
                Archy-YAML &amp; flowIR v1.1 Prüfung ({displayedValidation.errorCount} Fehler ·{' '}
                {displayedValidation.warningCount} YAML-Hinweise · {displayedIrFindings.length} IR-Findings
                {openReviewCount > 0 ? ` · ${openReviewCount} fachl. offen` : ''})
              </span>
              {displayedValidation.stats && (
                <span className="font-mono text-slate-400 normal-case font-normal">
                  {displayedValidation.stats.lineCount} Zeilen · {displayedValidation.stats.taskCount}{' '}
                  Tasks · {displayedValidation.stats.actionCount} Actions ·{' '}
                  {displayedValidation.stats.variableCount} Variablen
                  {!isMasterView && effectiveScript?.migrationGraph && (
                    <>
                      {' '}· {effectiveScript.migrationGraph.diagnostics.branchNodeCount} Branches
                      {effectiveScript.migrationGraph.diagnostics.inlinedSectionCount > 0
                        ? ` · ${effectiveScript.migrationGraph.diagnostics.inlinedSectionCount} Sections geinlined`
                        : ''}
                      {effectiveScript.metrics.prunedDeadPathCount > 0
                        ? ` · ${effectiveScript.metrics.prunedDeadPathCount} Dead Paths bereinigt`
                        : ''}
                      {(effectiveScript.migrationGraph.diagnostics.prunedUnreachableTasks?.length || 0) > 0
                        ? ` · ${effectiveScript.migrationGraph.diagnostics.prunedUnreachableTasks!.length} unerreichbare Tasks bereinigt`
                        : ''}
                    </>
                  )}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowValidationPanel(false)}
              className="text-slate-400 hover:text-slate-200 cursor-pointer"
              aria-label="Validierungsdetails schließen"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {displayedValidation.errors.length === 0 &&
            displayedValidation.warnings.length === 0 &&
            displayedIrFindings.length === 0 && (
              <div className="flex items-center gap-2 text-[11px] bg-emerald-950/40 border border-emerald-500/35 rounded px-2.5 py-1.5 text-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>
                  Alle Schema-Keys, 2-Space-Einrückungen, RefIds, Variablen-Scopes und flowIR-v1.1-Regeln wurden ohne Befund bestanden.
                </span>
              </div>
            )}

          {displayedValidation.errors.map((err, idx) => (
            <div
              key={`err-${err.fileName}-${err.code}-${err.lineNumber}-${idx}`}
              className="flex items-start justify-between gap-2 text-[11px] bg-rose-950/35 border border-rose-500/35 rounded px-2.5 py-1.5"
            >
              <div className="min-w-0 space-y-0.5">
                <div>
                  <span className="font-mono text-rose-300 font-semibold mr-1.5">
                    {err.fileName} · Zeile {err.lineNumber} [{err.code}]
                  </span>
                  <span className="text-slate-100">{err.message}</span>
                </div>
                {err.suggestion && (
                  <div className="text-[10.5px] text-rose-200/80">
                    Empfehlung: {err.suggestion}
                  </div>
                )}
              </div>
              {isMasterView && !displayedValidation.isCustomEdited && onSelectDetailScript && (
                <button
                  type="button"
                  onClick={() => onSelectDetailScript(err.scriptNumber)}
                  className="text-[10.5px] font-semibold text-cyan-300 hover:text-cyan-200 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Flow öffnen →
                </button>
              )}
            </div>
          ))}

          {displayedValidation.warnings.map((warn, idx) => (
            <div
              key={`warn-${warn.fileName}-${warn.code}-${warn.lineNumber}-${idx}`}
              className="flex items-start justify-between gap-2 text-[11px] bg-amber-950/30 border border-amber-500/30 rounded px-2.5 py-1.5"
            >
              <div className="min-w-0 space-y-0.5">
                <div>
                  <span className="font-mono text-amber-300 font-semibold mr-1.5">
                    {warn.fileName} · Zeile {warn.lineNumber} [{warn.code}]
                  </span>
                  <span className="text-slate-200">{warn.message}</span>
                </div>
                {warn.suggestion && (
                  <div className="text-[10.5px] text-amber-200/80">
                    Hinweis: {warn.suggestion}
                  </div>
                )}
              </div>
              {isMasterView && !displayedValidation.isCustomEdited && onSelectDetailScript && (
                <button
                  type="button"
                  onClick={() => onSelectDetailScript(warn.scriptNumber)}
                  className="text-[10.5px] font-semibold text-cyan-300 hover:text-cyan-200 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Flow öffnen →
                </button>
              )}
            </div>
          ))}

          {displayedIrFindings.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
                flowIR v1.1 Migrations-Findings &amp; offene Fragen ({displayedIrFindings.length}
                {openReviewCount > 0 ? ` · ${openReviewCount} mit Fachprüfung` : ''})
              </div>
              {groupedIrFindings.map((group) => (
                <div key={group.category} className="space-y-1">
                  <div className="text-[10px] font-semibold text-slate-300 flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono text-[9.5px]">
                      {group.label}
                    </span>
                    <span className="text-slate-500 font-mono">({group.items.length})</span>
                  </div>
                  {group.items.map((finding, idx) => {
                    const traceLabel = finding.sourceTrace
                      ? `${finding.sourceTrace.script}${
                          finding.sourceTrace.section ? ` · ${finding.sourceTrace.section}` : ''
                        } · Z.${finding.sourceTrace.lineStart}`
                      : finding.fileName;
                    const badgeClass =
                      finding.severity === 'ERROR'
                        ? 'text-rose-300 border-rose-500/35 bg-rose-950/30'
                        : finding.severity === 'WARN'
                        ? 'text-amber-300 border-amber-500/30 bg-amber-950/25'
                        : 'text-cyan-300 border-cyan-500/30 bg-cyan-950/25';
                    return (
                      <div
                        key={`ir-${group.category}-${finding.fileName}-${finding.code}-${finding.nodeId || idx}-${idx}`}
                        className={`flex items-start justify-between gap-2 text-[11px] border rounded px-2.5 py-1.5 ${badgeClass}`}
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-semibold">
                              [{finding.code}] {traceLabel}
                            </span>
                            {finding.requiresBusinessReview && (
                              <span className="px-1 py-0.2 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 text-[9.5px] font-semibold">
                                Fachprüfung
                              </span>
                            )}
                          </div>
                          <div className="text-slate-100">{finding.message}</div>
                          {finding.variableName && (
                            <div className="text-[10.5px] text-slate-300/85">
                              Variable: <span className="font-mono">{finding.variableName}</span>
                            </div>
                          )}
                        </div>
                        {isMasterView && onSelectDetailScript && (
                          <button
                            type="button"
                            onClick={() => onSelectDetailScript(finding.scriptNumber)}
                            className="text-[10.5px] font-semibold text-cyan-300 hover:text-cyan-200 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Flow öffnen →
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expandable Warnings Drawer */}
      {showWarnings && displayedWarnings.length > 0 && (
        <div className="px-3 py-2 border-t border-slate-800 bg-slate-900/90 max-h-40 overflow-y-auto space-y-1">
          <div className="flex items-center justify-between text-[10.5px] font-semibold text-amber-300 uppercase tracking-wide pb-0.5">
            <span>Genesys Migrations-Warnungen ({displayedWarnings.length})</span>
            <button
              type="button"
              onClick={() => setShowWarnings(false)}
              className="text-slate-400 hover:text-slate-200 cursor-pointer"
              aria-label="Warnungen schließen"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {displayedWarnings.map((w, idx) => (
            <div
              key={`${w.fileName}-${w.code}-${w.lineNumber || idx}-${idx}`}
              className="flex items-start justify-between gap-2 text-[11px] bg-slate-950/70 border border-amber-500/25 rounded px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <span className="font-mono text-amber-300 mr-1.5">{w.fileName}:</span>
                <span className="text-slate-200">{w.message}</span>
              </div>
              {isMasterView && onSelectDetailScript && (
                <button
                  type="button"
                  onClick={() => onSelectDetailScript(w.scriptNumber)}
                  className="text-[10.5px] font-semibold text-cyan-300 hover:text-cyan-200 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Flow öffnen →
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Expandable Dual-Mode Archy YAML / Avaya Mapping (flowIR v1.1) Drawer */}
      {showYamlPreview && effectiveScript && (
        <div className="px-3 py-2.5 border-t border-slate-800 bg-slate-950 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-300">
              <FileCode2 className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span>
                {previewMode === 'genesys'
                  ? effectiveScript.archyFilename
                  : `${effectiveScript.cleanName}.flowIR.yaml`}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">
                Quelle: {effectiveScript.fileName} ({effectiveScript.metrics.actionCount} Actions)
              </span>
              {/* Dual-Mode Toggle: modus=genesys vs modus=avaya */}
              <div className="inline-flex rounded border border-slate-700 bg-slate-900 p-0.5 font-sans">
                <button
                  type="button"
                  onClick={() => setPreviewMode('genesys')}
                  className={`px-2 py-0.5 rounded text-[10.5px] font-semibold cursor-pointer transition-colors ${
                    previewMode === 'genesys'
                      ? 'bg-orange-600/35 text-orange-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Genesys (Archy YAML)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewMode('avaya');
                    setIsEditingYaml(false);
                  }}
                  className={`px-2 py-0.5 rounded text-[10.5px] font-semibold cursor-pointer transition-colors ${
                    previewMode === 'avaya'
                      ? 'bg-cyan-600/35 text-cyan-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Avaya Mapping (flowIR v1.1)
                </button>
              </div>
              {isEditingYaml && previewMode === 'genesys' && (
                <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-[10px] font-sans font-semibold">
                  Live-Prüfmodus aktiv
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {previewMode === 'genesys' && (
                <button
                  type="button"
                  onClick={() => setIsEditingYaml((v) => !v)}
                  className={`px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                    isEditingYaml
                      ? 'bg-cyan-600/25 border-cyan-400/60 text-cyan-100'
                      : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                  }`}
                >
                  <Pencil className="w-3 h-3" />
                  <span>{isEditingYaml ? 'Vorschau-Modus' : 'Live-Prüfen / Bearbeiten'}</span>
                </button>
              )}
              {previewMode === 'genesys' &&
                isEditingYaml &&
                customYamlText !== effectiveScript.archyYaml && (
                  <button
                    type="button"
                    onClick={handleResetCustomYaml}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Zurücksetzen</span>
                  </button>
                )}
              <button
                type="button"
                onClick={handleCopyYaml}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
              >
                {copiedYaml ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>
                  {copiedYaml
                    ? 'Kopiert!'
                    : previewMode === 'avaya'
                    ? 'flowIR kopieren'
                    : 'YAML kopieren'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowYamlPreview(false)}
                className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer"
                aria-label="YAML Vorschau schließen"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Mode Caution Banner: Strict Honest Default vs. Opt-In Compatibility Stub Mode */}
          <div
            className={`rounded border px-2.5 py-1.5 text-[11px] flex items-center justify-between gap-2 ${
              compatibilityStubMode
                ? 'border-amber-500/45 bg-amber-950/35 text-amber-100'
                : 'border-emerald-500/35 bg-emerald-950/25 text-emerald-100'
            }`}
          >
            <span>
              {compatibilityStubMode
                ? 'Kompatibilitäts-/Stub-Modus (Opt-In) aktiv — synthetische getParticipantData-/Lookup-Stubs sind mit # KOMPATIBILITAETS-STUB (OPT-IN) markiert und dienen nur als optionale Review-Hilfe.'
                : 'Ehrliche Migration (Strict Default) — keine erfundenen Datenquellen, Lookups oder Disconnects; offene Punkte sind mit # OFFENE MIGRATIONSFRAGE markiert.'}
            </span>
          </div>

          {/* Structured 4-Part Migration Summary Strip (Kurzfazit, Offene Punkte, Migrationshinweise) */}
          {activeModeReport && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 text-[11px]">
              <div className="rounded border border-slate-800 bg-slate-900/75 px-2.5 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
                  1. Kurzfazit ({previewMode === 'genesys' ? 'modus=genesys' : 'modus=avaya'})
                </div>
                <p className="text-slate-200 leading-snug">{activeModeReport.kurzfazit}</p>
              </div>
              <div className="rounded border border-slate-800 bg-slate-900/75 px-2.5 py-1.5 max-h-24 overflow-y-auto">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-300/90 mb-0.5">
                  2. Annahmen / offene Punkte ({activeModeReport.annahmenUndOffenePunkte.length})
                </div>
                <ul className="space-y-0.5 text-slate-300 leading-snug">
                  {activeModeReport.annahmenUndOffenePunkte.slice(0, 4).map((q, idx) => (
                    <li key={`oq-${idx}`}>• {q}</li>
                  ))}
                  {activeModeReport.annahmenUndOffenePunkte.length > 4 && (
                    <li className="text-slate-400">
                      + {activeModeReport.annahmenUndOffenePunkte.length - 4} weitere (siehe Prüfpanel)
                    </li>
                  )}
                </ul>
              </div>
              <div className="rounded border border-slate-800 bg-slate-900/75 px-2.5 py-1.5 max-h-24 overflow-y-auto">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300/90 mb-0.5">
                  4. Wichtigste Migrationshinweise
                </div>
                <ul className="space-y-0.5 text-slate-300 leading-snug">
                  {activeModeReport.migrationshinweise.slice(0, 4).map((note, idx) => (
                    <li key={`mn-${idx}`}>• {note}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {previewMode === 'genesys' && isEditingYaml ? (
            <div className="space-y-2">
              <textarea
                value={customYamlText}
                onChange={(e) => setCustomYamlText(e.target.value)}
                spellCheck={false}
                aria-label="Archy YAML Live-Editor"
                className="w-full h-56 text-[11px] font-mono text-slate-100 bg-slate-900 border border-cyan-500/40 focus:border-cyan-400 focus:outline-none rounded-lg p-3 leading-relaxed resize-y"
              />
              {liveEditorValidation && (
                <div
                  className={`rounded-lg border p-2.5 text-[11px] space-y-1.5 ${
                    liveEditorValidation.isValid
                      ? 'bg-emerald-950/30 border-emerald-500/35 text-emerald-200'
                      : 'bg-rose-950/35 border-rose-500/40 text-rose-100'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                    <span className="flex items-center gap-1.5">
                      {liveEditorValidation.isValid ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      )}
                      <span>
                        {liveEditorValidation.isValid
                          ? `Live-Validierung bestanden (${liveEditorValidation.stats.taskCount} Tasks · ${liveEditorValidation.stats.actionCount} Actions · ${liveEditorValidation.stats.variableCount} Variablen)`
                          : `${liveEditorValidation.errors.length} Schema-Fehler erkannt (Export bleibt möglich)`}
                      </span>
                    </span>
                    {liveEditorValidation.warnings.length > 0 && (
                      <span className="text-amber-300 font-mono text-[10.5px]">
                        {liveEditorValidation.warnings.length}{' '}
                        {liveEditorValidation.warnings.length === 1 ? 'Hinweis' : 'Hinweise'}
                      </span>
                    )}
                  </div>
                  {liveEditorValidation.errors.length > 0 && (
                    <div className="space-y-1 max-h-32 overflow-y-auto pt-1">
                      {liveEditorValidation.errors.map((err, idx) => (
                        <div
                          key={`live-err-${err.code}-${err.lineNumber}-${idx}`}
                          className="bg-slate-950/60 border border-rose-500/25 rounded px-2 py-1"
                        >
                          <span className="font-mono text-rose-300 font-semibold mr-1.5">
                            Zeile {err.lineNumber} [{err.code}]:
                          </span>
                          <span className="text-slate-100">{err.message}</span>
                          {err.suggestion && (
                            <span className="block text-[10.5px] text-rose-200/80 mt-0.5">
                              Empfehlung: {err.suggestion}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {liveEditorValidation.warnings.length > 0 && (
                    <div className="space-y-1 max-h-24 overflow-y-auto pt-0.5">
                      {liveEditorValidation.warnings.map((warn, idx) => (
                        <div
                          key={`live-warn-${warn.code}-${warn.lineNumber}-${idx}`}
                          className="bg-slate-950/60 border border-amber-500/25 rounded px-2 py-1 text-amber-100"
                        >
                          <span className="font-mono text-amber-300 font-semibold mr-1.5">
                            Zeile {warn.lineNumber} [{warn.code}]:
                          </span>
                          <span>{warn.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <pre className="text-[11px] font-mono text-slate-200 bg-slate-900/90 border border-slate-800 rounded-lg p-3 max-h-60 overflow-auto whitespace-pre leading-relaxed select-text">
              {activePreviewCode}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};
