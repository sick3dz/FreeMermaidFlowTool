import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  Code2,
  Copy,
  Download,
  FileCode2,
  Layers,
  X,
} from 'lucide-react';
import {
  GenesysReadinessLevel,
  GenesysScriptTranslation,
  GenesysWorkspaceTranslation,
  exportAllArchyYamlsZipBlob,
} from '../utils/genesysMigrationAnalyzer';

interface GenesysMigrationBarProps {
  translation: GenesysWorkspaceTranslation;
  activeScript?: GenesysScriptTranslation | null;
  isMasterView: boolean;
  onSelectDetailScript?: (scriptNumber: string) => void;
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
}) => {
  const [showYamlPreview, setShowYamlPreview] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
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

  const handleDownloadSingleYaml = () => {
    if (!effectiveScript) return;
    const blob = new Blob([effectiveScript.archyYaml], {
      type: 'application/x-yaml;charset=utf-8',
    });
    downloadBlob(blob, effectiveScript.archyFilename);
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
      await navigator.clipboard.writeText(effectiveScript.archyYaml);
      setCopiedYaml(true);
      setTimeout(() => setCopiedYaml(false), 2000);
    } catch {
      // Ignore if clipboard blocked
    }
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

  return (
    <div className="border-b border-orange-500/35 bg-slate-950/95 shrink-0">
      {/* Compact Primary Bar */}
      <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        {/* Left: Active Mode + Readiness Badge + Summary */}
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

          {isMasterView ? (
            <span className="text-[11px] font-mono text-slate-400 tabular-nums hidden md:inline">
              LOW {translation.summary.lowCount} · MED {translation.summary.mediumCount} · HIGH{' '}
              {translation.summary.highCount} · Common Modules:{' '}
              {translation.summary.commonModuleCount}
            </span>
          ) : effectiveScript ? (
            <span className="text-[11px] text-slate-400 truncate max-w-[320px] hidden lg:inline">
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
        </div>

        {/* Right: Archy YAML Preview & Downloads */}
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
            <span>{showYamlPreview ? 'Archy YAML schließen' : 'Archy YAML'}</span>
          </button>

          {effectiveScript && (
            <button
              type="button"
              onClick={handleDownloadSingleYaml}
              title={`Einzelnes Genesys Archy YAML (${effectiveScript.archyFilename}) aus dem RAM herunterladen`}
              className="px-2.5 py-1 rounded-md bg-orange-600 hover:bg-orange-500 text-white text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>{effectiveScript.archyFilename}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleDownloadZipAll}
            disabled={isExportingZip}
            title="Alle generierten Archy-YAML-Dateien + Readiness-Übersicht als ZIP aus dem RAM herunterladen"
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

      {/* Expandable Archy YAML Drawer */}
      {showYamlPreview && effectiveScript && (
        <div className="px-3 py-2.5 border-t border-slate-800 bg-slate-950 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-300">
              <FileCode2 className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span>{effectiveScript.archyFilename}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">
                Quelle: {effectiveScript.fileName} ({effectiveScript.metrics.actionCount} Actions)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
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
                <span>{copiedYaml ? 'Kopiert!' : 'YAML kopieren'}</span>
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
          <pre className="text-[11px] font-mono text-slate-200 bg-slate-900/90 border border-slate-800 rounded-lg p-3 max-h-60 overflow-auto whitespace-pre leading-relaxed select-text">
            {effectiveScript.archyYaml}
          </pre>
        </div>
      )}
    </div>
  );
};
