import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  Filter,
  GitBranch,
  Layers,
  Network,
  RotateCcw,
  Search,
  Sliders,
  X,
} from 'lucide-react';
import {
  CallflowGraph,
  CallflowNode,
  CallflowTraceResult,
  MermaidLayoutEngine,
  ThemeConfiguration,
} from '../types/mermaidStudio';

interface CallflowInspectorProps {
  graph: CallflowGraph;
  selectedNodeId: string | null;
  onSelectNodeId: (id: string | null) => void;
  traceResult: CallflowTraceResult | null;
  isolateSubgraphMode: boolean;
  onToggleIsolateSubgraphMode: (isolate: boolean) => void;
  themeConfig: ThemeConfiguration;
  onChangeThemeConfig: (next: ThemeConfiguration) => void;
  onAutoGroupTopology: () => void;
  onExportInteractiveHtml: () => void;
  onClose: () => void;
  isMobileView?: boolean;
}

export const CallflowInspector: React.FC<CallflowInspectorProps> = ({
  graph,
  selectedNodeId,
  onSelectNodeId,
  traceResult,
  isolateSubgraphMode,
  onToggleIsolateSubgraphMode,
  themeConfig,
  onChangeThemeConfig,
  onAutoGroupTopology,
  onExportInteractiveHtml,
  onClose,
  isMobileView = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [groupedSuccess, setGroupedSuccess] = useState(false);

  const allNodesList = useMemo(() => {
    const arr = Array.from(graph.nodes.values());
    const q = searchQuery.trim().toLowerCase();
    if (!q) return arr;
    return arr.filter(
      (n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)
    );
  }, [graph.nodes, searchQuery]);

  const handleLayoutEngineChange = (engine: MermaidLayoutEngine) => {
    onChangeThemeConfig({
      ...themeConfig,
      layoutEngine: engine,
    });
  };

  const handleSpacingChange = (key: 'nodeSpacing' | 'rankSpacing', val: number) => {
    onChangeThemeConfig({
      ...themeConfig,
      [key]: val,
    });
  };

  const handleAutoGroupClick = () => {
    onAutoGroupTopology();
    setGroupedSuccess(true);
    setTimeout(() => setGroupedSuccess(false), 2200);
  };

  return (
    <aside
      className={`${
        isMobileView
          ? 'w-full flex-1 bg-slate-950'
          : 'w-84 xl:w-92 shrink-0 border-l border-slate-800 bg-slate-900/95'
      } flex flex-col h-full select-none overflow-hidden`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90 shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-indigo-400 shrink-0" />
          <h2 className="text-sm font-semibold text-slate-100 whitespace-nowrap">
            Callflow-Inspektor &amp; Entflechtung
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {selectedNodeId && (
            <button
              type="button"
              onClick={() => {
                onSelectNodeId(null);
                onToggleIsolateSubgraphMode(false);
              }}
              title="Pfad-Filter zurücksetzen"
              className="px-2 py-1 text-[11px] font-medium text-indigo-300 hover:text-white bg-indigo-950/60 border border-indigo-500/40 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Alle zeigen
            </button>
          )}
          {!isMobileView && (
            <button
              type="button"
              onClick={onClose}
              title="Inspektor schließen"
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Section 1: Anti-Overlap Layout Controls (ELK + Spacing Sliders + Auto-Grouping) */}
        <section className="space-y-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span>Anti-Überlappungs-Engine</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono tabular-nums">
              {graph.nodes.size} Knoten · {graph.edges.length} Pfade
            </span>
          </div>

          {/* Layout Engine Switch: Dagre vs ELK */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-slate-400 block">
              Routing-Algorithmus (gegen Linien-Kreuzungen)
            </span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => handleLayoutEngineChange('dagre')}
                className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  themeConfig.layoutEngine === 'dagre'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Standard (Dagre)
              </button>
              <button
                type="button"
                onClick={() => handleLayoutEngineChange('elk')}
                className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  themeConfig.layoutEngine === 'elk'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ELK (Anti-Overlap)
              </button>
            </div>
          </div>

          {/* Spacing Sliders */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Knoten-Abstand</span>
                <span className="font-mono text-indigo-300 tabular-nums">
                  {themeConfig.nodeSpacing}px
                </span>
              </div>
              <input
                type="range"
                min={25}
                max={160}
                step={5}
                value={themeConfig.nodeSpacing}
                onChange={(e) => handleSpacingChange('nodeSpacing', Number(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Ebenen-Abstand</span>
                <span className="font-mono text-indigo-300 tabular-nums">
                  {themeConfig.rankSpacing}px
                </span>
              </div>
              <input
                type="range"
                min={35}
                max={220}
                step={5}
                value={themeConfig.rankSpacing}
                onChange={(e) => handleSpacingChange('rankSpacing', Number(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
            </div>
          </div>

          {/* 1-Click Auto Topology Grouping */}
          <button
            type="button"
            onClick={handleAutoGroupClick}
            disabled={graph.nodes.size < 3}
            className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {groupedSuccess ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Start / Verteiler / Ende gruppiert!</span>
              </>
            ) : (
              <>
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                <span>Start-, Verteiler- &amp; Endpunkte gruppieren</span>
              </>
            )}
          </button>
        </section>

        {/* Section 2: Interactive Node Picker & Search */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">
              Skript / Knoten im Callflow wählen
            </span>
            <span className="text-[11px] text-slate-400">
              oder im Diagramm antippen
            </span>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Skriptname oder Knoten suchen..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Quick Select Dropdown */}
          <select
            value={selectedNodeId || ''}
            onChange={(e) => {
              const val = e.target.value || null;
              onSelectNodeId(val);
              if (!val) onToggleIsolateSubgraphMode(false);
            }}
            className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
          >
            <option value="">-- Alle Knoten anzeigen ({graph.nodes.size}) --</option>
            {allNodesList.map((n) => (
              <option key={n.id} value={n.id}>
                {n.role === 'entry'
                  ? '▶ [START] '
                  : n.role === 'terminal'
                  ? '■ [ENDE] '
                  : n.role === 'hub'
                  ? '◆ [VERTEILER] '
                  : '• '}
                {n.label} ({n.inDegree} ein / {n.outDegree} aus)
              </option>
            ))}
          </select>
        </section>

        {/* Section 3: Detailed Callflow Path Trace (When a node is selected) */}
        {traceResult ? (
          <section className="space-y-3 pt-2 border-t border-slate-800/80">
            {/* Active Node Card + Isolate Toggle */}
            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/50 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-amber-300">
                  Aktiver Fokus-Knoten
                </span>
                <span className="text-[11px] font-mono text-amber-200/80 tabular-nums">
                  {traceResult.activeNodeIds.size} Knoten im Pfad
                </span>
              </div>
              <div className="text-sm font-mono font-bold text-slate-100 break-all">
                {traceResult.selectedNode.label}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onToggleIsolateSubgraphMode(!isolateSubgraphMode)}
                  className={`flex-1 py-1.5 px-2.5 text-xs font-medium rounded-lg border transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${
                    isolateSubgraphMode
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>
                    {isolateSubgraphMode
                      ? 'Isolierte Ansicht aktiv'
                      : 'Nur diesen Pfad isolieren'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectNodeId(null);
                    onToggleIsolateSubgraphMode(false);
                  }}
                  title="Auswahl aufheben"
                  className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-lg transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 1. Root Entry Points (Wo beginnt der Callflow?) */}
            <TraceListBlock
              title="1. Ursprungs-Startpunkte (Entry)"
              subtitle="Hier beginnt die Aufrufkette"
              accentColor="text-sky-400"
              borderColor="border-sky-500/40"
              items={traceResult.entryPoints.map((n) => ({
                node: n,
                badge: n.id === traceResult.selectedNode.id ? 'Dieser Knoten' : 'Startpunkt',
              }))}
              onSelectNode={onSelectNodeId}
              emptyText="Dieser Knoten ist selbst ein Startpunkt."
            />

            {/* 2. Direct Callers (Woher kommt der Aufruf unmittelbar?) */}
            <TraceListBlock
              title="2. Direkte Aufrufer (Woher?)"
              subtitle="Unmittelbar vorgeschaltete Skripte"
              accentColor="text-indigo-400"
              borderColor="border-indigo-500/40"
              items={traceResult.directCallers.map((c) => ({
                node: c.node,
                badge: c.edgeLabel || 'ruft auf →',
              }))}
              onSelectNode={onSelectNodeId}
              emptyText="Keine eingehenden Aufrufe (Einstiegspunkt)."
            />

            {/* 3. Direct Callees (Wohin verzweigt dieser Knoten?) */}
            <TraceListBlock
              title="3. Direkte Folgeschritte (Wohin?)"
              subtitle="Unmittelbar aufgerufene Ziele"
              accentColor="text-emerald-400"
              borderColor="border-emerald-500/40"
              items={traceResult.directCallees.map((c) => ({
                node: c.node,
                badge: c.edgeLabel || '→ Folgeaufruf',
              }))}
              onSelectNode={onSelectNodeId}
              emptyText="Keine ausgehenden Aufrufe (Endpunkt)."
            />

            {/* 4. Terminal Sinks (Wo endet der Callflow?) */}
            <TraceListBlock
              title="4. Endpunkte (Wo endet es?)"
              subtitle="Letzte Ziele dieser Aufrufkette"
              accentColor="text-rose-400"
              borderColor="border-rose-500/40"
              items={traceResult.terminalPoints.map((n) => ({
                node: n,
                badge: n.id === traceResult.selectedNode.id ? 'Dieser Knoten' : 'Endpunkt',
              }))}
              onSelectNode={onSelectNodeId}
              emptyText="Keine Endpunkte ermittelt."
            />
          </section>
        ) : (
          /* Overview of Entry Points, Hubs, and Terminal Sinks when no single node is selected */
          <section className="space-y-3 pt-2 border-t border-slate-800/80">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300 leading-relaxed">
              <strong className="text-slate-100 block mb-1">
                Interaktive Pfad-Verfolgung bereit:
              </strong>
              Klicken oder tippen Sie direkt im Diagramm auf ein beliebiges Skript (oder wählen Sie
              eines unten aus), um alle anderen sich kreuzenden Linien auszublenden und den exakten
              Weg von <strong>Start → Aufruf → Ende</strong> zu sehen.
            </div>

            <TraceListBlock
              title={`Erkannte Startpunkte (${graph.entryNodes.length})`}
              subtitle="Skripte ohne vorherigen Aufrufer"
              accentColor="text-sky-400"
              borderColor="border-slate-800"
              items={graph.entryNodes.map((n) => ({
                node: n,
                badge: `${n.outDegree} Ausgänge`,
              }))}
              onSelectNode={onSelectNodeId}
              emptyText="Keine isolierten Startknoten erkannt."
            />

            <TraceListBlock
              title={`Zentrale Verteiler / Hubs (${graph.hubNodes.length})`}
              subtitle="Knoten mit vielen Verzweigungen"
              accentColor="text-amber-400"
              borderColor="border-slate-800"
              items={graph.hubNodes.map((n) => ({
                node: n,
                badge: `${n.inDegree} ein · ${n.outDegree} aus`,
              }))}
              onSelectNode={onSelectNodeId}
              emptyText="Keine mehrfachen Verteilerknoten erkannt."
            />

            <TraceListBlock
              title={`Erkannte Endpunkte (${graph.terminalNodes.length})`}
              subtitle="Zielsysteme / Ende der Kette"
              accentColor="text-rose-400"
              borderColor="border-slate-800"
              items={graph.terminalNodes.map((n) => ({
                node: n,
                badge: `${n.inDegree} Eingänge`,
              }))}
              onSelectNode={onSelectNodeId}
              emptyText="Keine isolierten Endpunkte erkannt."
            />
          </section>
        )}
      </div>

      {/* Footer Action: Save as Standalone Interactive Callflow HTML */}
      <div className="p-3.5 border-t border-slate-800 bg-slate-900/90 lg:bg-slate-950/60 shrink-0">
        <button
          type="button"
          onClick={onExportInteractiveHtml}
          className="w-full min-h-[40px] lg:min-h-0 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Interaktive Callflow-HTML speichern (.html)</span>
        </button>
      </div>
    </aside>
  );
};

interface TraceListBlockProps {
  title: string;
  subtitle: string;
  accentColor: string;
  borderColor: string;
  items: Array<{ node: CallflowNode; badge: string }>;
  onSelectNode: (id: string) => void;
  emptyText: string;
}

const TraceListBlock: React.FC<TraceListBlockProps> = ({
  title,
  subtitle,
  accentColor,
  borderColor,
  items,
  onSelectNode,
  emptyText,
}) => {
  return (
    <div className={`p-3 rounded-xl bg-slate-950/80 border ${borderColor} space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold ${accentColor}`}>{title}</span>
        <span className="text-[11px] text-slate-500">{subtitle}</span>
      </div>

      {items.length === 0 ? (
        <div className="text-xs text-slate-500 py-1">{emptyText}</div>
      ) : (
        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
          {items.map(({ node, badge }) => (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node.id)}
              className="w-full text-left px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/50 transition-colors flex items-center justify-between gap-2 group"
            >
              <span className="text-xs font-mono text-slate-200 group-hover:text-white truncate">
                {node.label}
              </span>
              <span className="text-[11px] text-slate-400 group-hover:text-indigo-300 flex items-center gap-1 whitespace-nowrap shrink-0">
                <span>{badge}</span>
                <ArrowRight className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
