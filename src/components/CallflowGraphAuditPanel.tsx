import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  GitBranch,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Unlink,
} from 'lucide-react';
import { ScriptWorkspace } from '../types/mermaidStudio';
import {
  AuditReport,
  createAuditExportPayloads,
  printAuditSummaryToConsole,
  runCallflowAudit,
} from '../utils/auditCallflows';

type AuditSubTab = 'broken' | 'orphans' | 'deadends' | 'loops' | 'external';

interface CallflowGraphAuditPanelProps {
  workspace: ScriptWorkspace;
  onFocusScript?: (scriptNumber: string) => void;
}

function triggerRamBlobDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const CallflowGraphAuditPanel: React.FC<CallflowGraphAuditPanelProps> = ({
  workspace,
  onFocusScript,
}) => {
  const [activeTab, setActiveTab] = useState<AuditSubTab>('broken');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMermaidPreview, setShowMermaidPreview] = useState(false);
  const [copiedMermaid, setCopiedMermaid] = useState(false);
  const [consoleFeedback, setConsoleFeedback] = useState(false);

  const report: AuditReport = useMemo(() => runCallflowAudit(workspace), [workspace]);

  const exportPayloads = useMemo(
    () => createAuditExportPayloads(report, { maxHubScripts: 20 }),
    [report]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredBrokenLinks = useMemo(() => {
    if (!normalizedQuery) return report.brokenLinks;
    return report.brokenLinks.filter(
      (b) =>
        b.sourceFileName.toLowerCase().includes(normalizedQuery) ||
        b.targetRaw.toLowerCase().includes(normalizedQuery) ||
        b.command.toLowerCase().includes(normalizedQuery)
    );
  }, [report.brokenLinks, normalizedQuery]);

  const filteredOrphans = useMemo(() => {
    if (!normalizedQuery) return report.orphanScripts;
    return report.orphanScripts.filter(
      (o) =>
        o.fileName.toLowerCase().includes(normalizedQuery) ||
        o.scriptName.toLowerCase().includes(normalizedQuery)
    );
  }, [report.orphanScripts, normalizedQuery]);

  const filteredDeadEnds = useMemo(() => {
    if (!normalizedQuery) return report.deadEndScripts;
    return report.deadEndScripts.filter(
      (d) =>
        d.fileName.toLowerCase().includes(normalizedQuery) ||
        d.scriptName.toLowerCase().includes(normalizedQuery) ||
        d.skillsetQueues.some((q) => q.toLowerCase().includes(normalizedQuery))
    );
  }, [report.deadEndScripts, normalizedQuery]);

  const filteredLoops = useMemo(() => {
    if (!normalizedQuery) return report.circularLoops;
    return report.circularLoops.filter((c) =>
      c.cycleFileNames.some((f) => f.toLowerCase().includes(normalizedQuery))
    );
  }, [report.circularLoops, normalizedQuery]);

  const filteredExternal = useMemo(() => {
    if (!normalizedQuery) return report.externalIntegrations;
    return report.externalIntegrations.filter(
      (e) =>
        e.system.toLowerCase().includes(normalizedQuery) ||
        e.sourceFileName.toLowerCase().includes(normalizedQuery) ||
        e.targetRaw.toLowerCase().includes(normalizedQuery) ||
        e.command.toLowerCase().includes(normalizedQuery) ||
        e.category.toLowerCase().includes(normalizedQuery)
    );
  }, [report.externalIntegrations, normalizedQuery]);

  const handleDownloadJson = () => {
    triggerRamBlobDownload(
      exportPayloads.jsonContent,
      exportPayloads.jsonFilename,
      'application/json;charset=utf-8'
    );
  };

  const handleDownloadMermaid = () => {
    triggerRamBlobDownload(
      exportPayloads.mermaidContent,
      exportPayloads.mermaidFilename,
      'text/plain;charset=utf-8'
    );
  };

  const handleCopyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(exportPayloads.mermaidContent);
      setCopiedMermaid(true);
      setTimeout(() => setCopiedMermaid(false), 2000);
    } catch {
      // Ignore if clipboard API blocked in sandboxed iframe
    }
  };

  const handlePrintConsole = () => {
    printAuditSummaryToConsole(report);
    setConsoleFeedback(true);
    setTimeout(() => setConsoleFeedback(false), 2000);
  };

  const scriptNumberByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of report.nodes) {
      map.set(n.scriptKey, n.scriptNumber);
    }
    return map;
  }, [report.nodes]);

  const handleJump = (scriptKey: string) => {
    if (!onFocusScript) return;
    const num = scriptNumberByKey.get(scriptKey);
    if (num) onFocusScript(num);
  };

  const s = report.summary;

  return (
    <section className="space-y-3 bg-slate-950/85 border border-slate-800 rounded-xl p-3.5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-100 truncate">
            Graph-Audit (100 % In-Memory)
          </span>
        </div>
        <span className="text-[10.5px] font-mono text-slate-400 tabular-nums shrink-0">
          {s.totalScripts} Skripte · {s.entryPointCount} Einstieg · {s.totalEdges} Kanten
        </span>
      </div>

      {workspace.modules.length === 0 ? (
        <div className="text-[11px] text-slate-400 py-2 leading-relaxed">
          Laden Sie Avaya-.s-Skripte oder Visio-Flows, um das automatisierte 5-Punkte-Graph-Audit (Broken Links, Verwaiste Skripte, Sackgassen, Schleifen, FlixCheck-/Oracle-Inventar) direkt im Arbeitsspeicher auszuführen.
        </div>
      ) : (
        <>
          {/* RAM Export & Console Actions */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleDownloadJson}
              title="Datenschutzbereinigten Struktur-Report (ohne Roh-Skripte) als RAM-Blob herunterladen"
              className="flex-1 min-w-[130px] py-1.5 px-2.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-200 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Audit JSON</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadMermaid}
              title="Kompaktes High-Level-Architektur-Diagramm (Top-20 Hubs, Einstiege, Fehler, FlixCheck & Oracle) herunterladen"
              className="flex-1 min-w-[130px] py-1.5 px-2.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Architektur .mmd</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyMermaid}
              className="flex-1 py-1 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[10.5px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
            >
              {copiedMermaid ? (
                <Check className="w-3 h-3 text-emerald-400 shrink-0" />
              ) : (
                <Copy className="w-3 h-3 shrink-0" />
              )}
              <span>{copiedMermaid ? 'MMD kopiert' : 'MMD kopieren'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowMermaidPreview((v) => !v)}
              className={`flex-1 py-1 px-2 rounded-lg border text-[10.5px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                showMermaidPreview
                  ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-200'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
              }`}
            >
              <Code2 className="w-3 h-3 shrink-0" />
              <span>{showMermaidPreview ? 'Code ausblenden' : 'MMD Vorschau'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrintConsole}
              title="Zusammenfassung als console.table in der Browser-Entwicklerkonsole ausgeben"
              className="py-1 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[10.5px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
            >
              <Terminal className="w-3 h-3 shrink-0" />
              <span>{consoleFeedback ? 'In Konsole!' : 'console.table'}</span>
            </button>
          </div>

          {showMermaidPreview && (
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>architecture-overview.mmd (flowchart LR · Top-20 Hubs)</span>
                <span>{exportPayloads.mermaidContent.split('\n').length} Zeilen</span>
              </div>
              <pre className="text-[10px] font-mono text-slate-300 max-h-48 overflow-auto whitespace-pre leading-relaxed">
                {exportPayloads.mermaidContent}
              </pre>
            </div>
          )}

          {/* 5 Category Switcher KPI Tiles */}
          <div className="grid grid-cols-5 gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('broken')}
              className={`py-1.5 px-1 rounded-lg border text-center transition-colors cursor-pointer ${
                activeTab === 'broken'
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-200'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`text-xs font-mono font-semibold tabular-nums ${
                  s.brokenLinkCount > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {s.brokenLinkCount}
              </div>
              <div className="text-[9.5px] truncate">Broken</div>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('orphans')}
              className={`py-1.5 px-1 rounded-lg border text-center transition-colors cursor-pointer ${
                activeTab === 'orphans'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`text-xs font-mono font-semibold tabular-nums ${
                  s.orphanScriptCount > 0 ? 'text-amber-300' : 'text-emerald-400'
                }`}
              >
                {s.orphanScriptCount}
              </div>
              <div className="text-[9.5px] truncate">Verwaist</div>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('deadends')}
              className={`py-1.5 px-1 rounded-lg border text-center transition-colors cursor-pointer ${
                activeTab === 'deadends'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`text-xs font-mono font-semibold tabular-nums ${
                  s.deadEndScriptCount > 0 ? 'text-amber-300' : 'text-emerald-400'
                }`}
              >
                {s.deadEndScriptCount}
              </div>
              <div className="text-[9.5px] truncate">Sackg.</div>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('loops')}
              className={`py-1.5 px-1 rounded-lg border text-center transition-colors cursor-pointer ${
                activeTab === 'loops'
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-200'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`text-xs font-mono font-semibold tabular-nums ${
                  s.circularLoopCount > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {s.circularLoopCount}
              </div>
              <div className="text-[9.5px] truncate">Schleifen</div>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('external')}
              className={`py-1.5 px-1 rounded-lg border text-center transition-colors cursor-pointer ${
                activeTab === 'external'
                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="text-xs font-mono font-semibold tabular-nums text-sky-300">
                {s.externalIntegrationCount}
              </div>
              <div className="text-[9.5px] truncate">APIs</div>
            </button>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Audit-Befunde nach Skript, Befehl oder Ziel filtern…"
              className="w-full pl-8 pr-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60"
            />
          </div>

          {/* Active Category Results */}
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-0.5">
            {activeTab === 'broken' &&
              (filteredBrokenLinks.length === 0 ? (
                <div className="px-3 py-2.5 rounded-lg bg-emerald-950/25 border border-emerald-500/30 text-[11px] text-emerald-300">
                  Keine Broken Links im geladenen Skript-Pool gefunden.
                </div>
              ) : (
                filteredBrokenLinks.map((item, idx) => (
                  <button
                    key={`${item.sourceScriptKey}-${item.targetKey}-${item.lineNumber}-${idx}`}
                    type="button"
                    onClick={() => handleJump(item.sourceScriptKey)}
                    className="w-full text-left p-2.5 rounded-lg bg-slate-900/90 hover:bg-slate-900 border border-rose-500/30 space-y-1 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono font-semibold text-rose-300 truncate flex items-center gap-1">
                        <Unlink className="w-3 h-3 shrink-0" />
                        {item.sourceFileName}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0 tabular-nums">
                        Z. {item.lineNumber}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-200 flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300">
                        {item.command}
                      </span>
                      <span className="font-mono text-rose-200 truncate">{item.targetRaw}</span>
                    </div>
                  </button>
                ))
              ))}

            {activeTab === 'orphans' &&
              (filteredOrphans.length === 0 ? (
                <div className="px-3 py-2.5 rounded-lg bg-emerald-950/25 border border-emerald-500/30 text-[11px] text-emerald-300">
                  Keine verwaisten Skripte (alle Skripte sind Einstiegspunkte oder werden aufgerufen).
                </div>
              ) : (
                filteredOrphans.map((item) => (
                  <button
                    key={item.scriptKey}
                    type="button"
                    onClick={() => handleJump(item.scriptKey)}
                    className="w-full text-left p-2.5 rounded-lg bg-slate-900/90 hover:bg-slate-900 border border-amber-500/30 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono font-semibold text-amber-200 truncate">
                        {item.fileName}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        0 eingehende Aufrufe · kein Visio-/Master-/CDN-Einstieg
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0 tabular-nums">
                      {item.outgoingEdgeCount} out
                    </span>
                  </button>
                ))
              ))}

            {activeTab === 'deadends' &&
              (filteredDeadEnds.length === 0 ? (
                <div className="px-3 py-2.5 rounded-lg bg-emerald-950/25 border border-emerald-500/30 text-[11px] text-emerald-300">
                  Keine Sackgassen gefunden (alle Skripte terminieren oder leiten weiter).
                </div>
              ) : (
                filteredDeadEnds.map((item) => (
                  <button
                    key={item.scriptKey}
                    type="button"
                    onClick={() => handleJump(item.scriptKey)}
                    className="w-full text-left p-2.5 rounded-lg bg-slate-900/90 hover:bg-slate-900 border border-amber-500/30 space-y-1 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono font-semibold text-amber-200 truncate flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 shrink-0 text-amber-400" />
                        {item.fileName}
                      </span>
                      {item.hasSkillsetQueue ? (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-200 text-[9.5px] font-mono shrink-0">
                          Queue-Hinweis
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-200 text-[9.5px] font-mono shrink-0">
                          Kein Ende
                        </span>
                      )}
                    </div>
                    <div className="text-[10.5px] text-slate-400 leading-snug">{item.note}</div>
                  </button>
                ))
              ))}

            {activeTab === 'loops' &&
              (filteredLoops.length === 0 ? (
                <div className="px-3 py-2.5 rounded-lg bg-emerald-950/25 border border-emerald-500/30 text-[11px] text-emerald-300">
                  Keine zirkulären Skript-Schleifen (A → B → A) erkannt.
                </div>
              ) : (
                filteredLoops.map((loop) => (
                  <button
                    key={loop.signature}
                    type="button"
                    onClick={() => handleJump(loop.cycleKeys[0])}
                    className="w-full text-left p-2.5 rounded-lg bg-slate-900/90 hover:bg-slate-900 border border-rose-500/30 space-y-1 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10.5px] font-semibold text-rose-300 flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 shrink-0" />
                        {loop.length === 1 ? 'Selbst-Schleife' : `${loop.length}-Schritt-Zyklus`}
                      </span>
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    </div>
                    <div className="text-[10.5px] font-mono text-slate-200 break-all">
                      {loop.cycleFileNames.join(' → ')}
                    </div>
                  </button>
                ))
              ))}

            {activeTab === 'external' &&
              (filteredExternal.length === 0 ? (
                <div className="px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                  Keine FlixCheck- oder Oracle-Schnittstellen in den geladenen Skripten erkannt.
                </div>
              ) : (
                filteredExternal.map((ext, idx) => (
                  <button
                    key={`${ext.system}-${ext.sourceScriptKey}-${ext.targetKey}-${ext.lineNumber}-${idx}`}
                    type="button"
                    onClick={() => handleJump(ext.sourceScriptKey)}
                    className="w-full text-left p-2.5 rounded-lg bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 space-y-1 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9.5px] font-semibold uppercase tracking-wide shrink-0 ${
                            ext.system === 'FlixCheck'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-purple-500/20 text-purple-200 border border-purple-500/40'
                          }`}
                        >
                          {ext.system}
                        </span>
                        <span className="text-[11px] font-mono text-slate-200 truncate">
                          {ext.sourceFileName}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0 tabular-nums">
                        Z. {ext.lineNumber}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10.5px] text-slate-300 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-[10px] text-slate-300">
                        {ext.command}
                      </span>
                      <GitBranch className="w-3 h-3 text-slate-500 shrink-0" />
                      <span className="font-mono text-sky-200 truncate">{ext.targetRaw}</span>
                      <ExternalLink className="w-3 h-3 text-slate-500 ml-auto shrink-0" />
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">{ext.category}</div>
                  </button>
                ))
              ))}
          </div>

          <div className="text-[10px] text-slate-500 leading-relaxed border-t border-slate-800/80 pt-2">
            100 % In-Memory · 0 Byte Netzwerk · Exporte enthalten nur Dateinamen, Befehlstypen, Zeilennummern und Struktur-Metriken (keine Roh-Skripte oder Kundendaten).
          </div>
        </>
      )}
    </section>
  );
};
