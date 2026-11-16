import {
  CallflowEdge,
  CallflowGraph,
  CallflowNode,
  CallflowNodeRole,
  CallflowTraceResult,
} from '../types/mermaidStudio';

const RESERVED_KEYWORDS = new Set([
  'flowchart',
  'graph',
  'sequencediagram',
  'statediagram',
  'statediagram-v2',
  'classdiagram',
  'erdiagram',
  'subgraph',
  'end',
  'direction',
  'style',
  'classdef',
  'class',
  'click',
  'linkstyle',
  'participant',
  'actor',
  'note',
  'loop',
  'alt',
  'else',
  'opt',
  'par',
  'activate',
  'deactivate',
  'autonumber',
  'TB',
  'TD',
  'BT',
  'RL',
  'LR',
]);

/**
 * Extracts node ID and optional label from a Mermaid node token like:
 * - `ScriptA["init_session.py"]`
 * - `AuthGate{"Token gültig?"}`
 * - `DB[("PostgreSQL")]`
 * - `Worker`
 */
function parseNodeToken(rawToken: string): { id: string; label?: string } | null {
  const token = rawToken.trim();
  if (!token) return null;

  // Handle state diagram [*] token
  if (token === '[*]') {
    return { id: 'START_END', label: '[*]' };
  }

  // Handle v11 @{ shape: ..., label: "..." } syntax
  const v11Match = token.match(/^([A-Za-z0-9_.-]+)@\s*\{([\s\S]*?)\}$/);
  if (v11Match) {
    const id = v11Match[1];
    const body = v11Match[2];
    const labelMatch = body.match(/label\s*:\s*["']([^"']+)["']/i);
    return { id, label: labelMatch ? labelMatch[1].trim() : id };
  }

  // Match ID followed by bracketed/parenthesized label
  const bracketMatch = token.match(
    /^([A-Za-z0-9_.-]+)\s*(?:\[\("?([^"\)]+)"?\)\]|\(\["?([^"\]]+)"?\]\)|\[\["?([^"\]]+)"?\]\]|\(\("?([^"\)]+)"?\)\)|\{\{"?([^"\}]+)"?\}\}|\["?([^"\]]+)"?\]|\("?([^"\)]+)"?\)|\{"?([^"\}]+)"?\})$/
  );
  if (bracketMatch) {
    const id = bracketMatch[1];
    if (RESERVED_KEYWORDS.has(id.toLowerCase()) || RESERVED_KEYWORDS.has(id)) return null;
    const label =
      bracketMatch[2] ||
      bracketMatch[3] ||
      bracketMatch[4] ||
      bracketMatch[5] ||
      bracketMatch[6] ||
      bracketMatch[7] ||
      bracketMatch[8] ||
      bracketMatch[9];
    return { id, label: label ? label.trim() : id };
  }

  // Match plain identifier
  const plainMatch = token.match(/^([A-Za-z0-9_.-]+)$/);
  if (plainMatch) {
    const id = plainMatch[1];
    if (RESERVED_KEYWORDS.has(id.toLowerCase()) || RESERVED_KEYWORDS.has(id)) return null;
    return { id };
  }

  return null;
}

/**
 * Parses Mermaid code locally into a directed CallflowGraph (nodes, edges, degrees, roles).
 * Supports Flowchart (`-->`, `-.->`, `==>`, `<-->`), Sequence (`->>`, `-->>`), State (`-->`), and Architecture edges.
 */
export function parseCallflowGraph(code: string): CallflowGraph {
  const labelMap = new Map<string, string>();
  const edges: CallflowEdge[] = [];
  const nodeIds = new Set<string>();

  const registerNode = (id: string, label?: string) => {
    if (!id || RESERVED_KEYWORDS.has(id.toLowerCase()) || RESERVED_KEYWORDS.has(id)) return;
    nodeIds.add(id);
    if (label && label !== id) {
      labelMap.set(id, label);
    } else if (!labelMap.has(id)) {
      labelMap.set(id, id);
    }
  };

  const cleanedCode = code.replace(/%%\{[\s\S]*?\}%%/g, '');
  const lines = cleanedCode.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('%%')) continue;

    // Skip styling / directive lines
    if (/^(classDef|class|style|linkStyle|click|direction)\b/i.test(line)) {
      continue;
    }

    // Check Sequence participant/actor alias: `participant A as Auth_Script.py`
    const seqActorMatch = line.match(/^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i);
    if (seqActorMatch) {
      registerNode(
        seqActorMatch[1],
        seqActorMatch[2] ? seqActorMatch[2].replace(/^["']|["']$/g, '').trim() : seqActorMatch[1]
      );
      continue;
    }

    // Check Sequence message line: `User->>App: Login starten`
    const seqEdgeMatch = line.match(
      /^([A-Za-z0-9_.-]+)\s*(->>|-->>|->|-->|-x|--x|-\)|--\))\+?-?\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/
    );
    if (seqEdgeMatch) {
      const fromId = seqEdgeMatch[1];
      const arrow = seqEdgeMatch[2];
      const toId = seqEdgeMatch[3];
      const msgLabel = seqEdgeMatch[4].trim();
      registerNode(fromId);
      registerNode(toId);
      edges.push({
        from: fromId,
        to: toId,
        label: msgLabel,
        rawArrow: arrow,
        isAsync: arrow.includes('--'),
      });
      continue;
    }

    // Check Flowchart / State chained or single connections:
    // e.g. `A["main.py"] -->|init| B["worker.py"] -.-> C["db_sync.py"]`
    const arrowRegex =
      /\s*(<-->|<-\.->|-->|-\.->|==>|---|-\.-|--\s+[^-|\n]+\s+-->|-\.\s+[^.|\n]+\s+\.->)\s*(?:\|([^|]*)\|)?\s*/g;

    if (arrowRegex.test(line)) {
      arrowRegex.lastIndex = 0;
      const segments: string[] = [];
      const arrows: Array<{ rawArrow: string; label: string; isAsync: boolean }> = [];

      let lastIdx = 0;
      let match: RegExpExecArray | null;
      while ((match = arrowRegex.exec(line)) !== null) {
        segments.push(line.slice(lastIdx, match.index).trim());
        const rawArrow = match[1].trim();
        let edgeLabel = (match[2] || '').trim();

        // Check inline label syntax `-- Ja -->`
        const inlineMatch = rawArrow.match(/^--\s+(.+?)\s+-->$|^-\.\s+(.+?)\s+\.->$/);
        if (inlineMatch) {
          edgeLabel = (inlineMatch[1] || inlineMatch[2] || '').trim();
        }

        arrows.push({
          rawArrow: rawArrow.includes('-.') ? '-.->' : '-->',
          label: edgeLabel,
          isAsync: rawArrow.includes('-.'),
        });
        lastIdx = arrowRegex.lastIndex;
      }
      segments.push(line.slice(lastIdx).trim());

      for (let i = 0; i < arrows.length; i++) {
        const leftRaw = segments[i];
        const rightRaw = segments[i + 1];
        if (!leftRaw || !rightRaw) continue;

        // Support `&` multi-node syntax `A & B --> C`
        const leftParts = leftRaw.split('&').map((s) => s.trim());
        const rightParts = rightRaw.split('&').map((s) => s.trim());

        for (const lPart of leftParts) {
          for (const rPart of rightParts) {
            const leftNode = parseNodeToken(lPart);
            const rightNode = parseNodeToken(rPart);
            if (leftNode && rightNode) {
              registerNode(leftNode.id, leftNode.label);
              registerNode(rightNode.id, rightNode.label);
              edges.push({
                from: leftNode.id,
                to: rightNode.id,
                label: arrows[i].label,
                rawArrow: arrows[i].rawArrow,
                isAsync: arrows[i].isAsync,
              });
            }
          }
        }
      }
      continue;
    }

    // Standalone node declaration line (e.g. `AuthSvc["auth_service.py"]`)
    if (!line.startsWith('subgraph') && !line.startsWith('end')) {
      const singleNode = parseNodeToken(line.replace(/;$/, ''));
      if (singleNode && singleNode.label) {
        registerNode(singleNode.id, singleNode.label);
      }
    }
  }

  // Compute inDegree & outDegree for each node
  const inCount = new Map<string, number>();
  const outCount = new Map<string, number>();

  for (const id of nodeIds) {
    inCount.set(id, 0);
    outCount.set(id, 0);
  }

  for (const edge of edges) {
    outCount.set(edge.from, (outCount.get(edge.from) || 0) + 1);
    inCount.set(edge.to, (inCount.get(edge.to) || 0) + 1);
  }

  const nodes = new Map<string, CallflowNode>();
  const entryNodes: CallflowNode[] = [];
  const hubNodes: CallflowNode[] = [];
  const terminalNodes: CallflowNode[] = [];

  for (const id of nodeIds) {
    const inDeg = inCount.get(id) || 0;
    const outDeg = outCount.get(id) || 0;

    let role: CallflowNodeRole = 'step';
    if (inDeg === 0 && outDeg > 0) {
      role = 'entry';
    } else if (outDeg === 0 && inDeg > 0) {
      role = 'terminal';
    } else if (inDeg + outDeg >= 3 || outDeg >= 2) {
      role = 'hub';
    }

    const nodeObj: CallflowNode = {
      id,
      label: labelMap.get(id) || id,
      inDegree: inDeg,
      outDegree: outDeg,
      role,
    };

    nodes.set(id, nodeObj);
    if (role === 'entry') entryNodes.push(nodeObj);
    else if (role === 'hub') hubNodes.push(nodeObj);
    else if (role === 'terminal') terminalNodes.push(nodeObj);
  }

  return {
    nodes,
    edges,
    entryNodes,
    hubNodes,
    terminalNodes,
  };
}

/**
 * Traces the complete upstream (Entry -> Caller) and downstream (Callee -> Terminal) call chain
 * for a selected node ID using Breadth-First Search (BFS).
 */
export function traceCallflowForNode(
  graph: CallflowGraph,
  targetNodeId: string
): CallflowTraceResult | null {
  const selectedNode = graph.nodes.get(targetNodeId);
  if (!selectedNode) return null;

  // 1. Direct callers & callees
  const directCallers: Array<{ node: CallflowNode; edgeLabel: string }> = [];
  const directCallees: Array<{ node: CallflowNode; edgeLabel: string }> = [];

  for (const edge of graph.edges) {
    if (edge.to === targetNodeId) {
      const caller = graph.nodes.get(edge.from);
      if (caller && !directCallers.some((c) => c.node.id === caller.id)) {
        directCallers.push({ node: caller, edgeLabel: edge.label });
      }
    }
    if (edge.from === targetNodeId) {
      const callee = graph.nodes.get(edge.to);
      if (callee && !directCallees.some((c) => c.node.id === callee.id)) {
        directCallees.push({ node: callee, edgeLabel: edge.label });
      }
    }
  }

  // 2. Upstream BFS (Who calls this node directly or indirectly?)
  const upstreamNodeIds = new Set<string>();
  const queueUp: string[] = [targetNodeId];
  const visitedUp = new Set<string>([targetNodeId]);

  while (queueUp.length > 0) {
    const curr = queueUp.shift()!;
    for (const edge of graph.edges) {
      if (edge.to === curr && !visitedUp.has(edge.from)) {
        visitedUp.add(edge.from);
        upstreamNodeIds.add(edge.from);
        queueUp.push(edge.from);
      }
    }
  }

  // 3. Downstream BFS (Where does this call go until it terminates?)
  const downstreamNodeIds = new Set<string>();
  const queueDown: string[] = [targetNodeId];
  const visitedDown = new Set<string>([targetNodeId]);

  while (queueDown.length > 0) {
    const curr = queueDown.shift()!;
    for (const edge of graph.edges) {
      if (edge.from === curr && !visitedDown.has(edge.to)) {
        visitedDown.add(edge.to);
        downstreamNodeIds.add(edge.to);
        queueDown.push(edge.to);
      }
    }
  }

  const activeNodeIds = new Set<string>([
    targetNodeId,
    ...upstreamNodeIds,
    ...downstreamNodeIds,
  ]);

  // 4. Active edges along the upstream -> target -> downstream path
  const activeEdges = graph.edges.filter((edge) => {
    const isUpstreamEdge =
      (upstreamNodeIds.has(edge.from) || edge.from === targetNodeId) &&
      (upstreamNodeIds.has(edge.to) || edge.to === targetNodeId);
    const isDownstreamEdge =
      (downstreamNodeIds.has(edge.from) || edge.from === targetNodeId) &&
      (downstreamNodeIds.has(edge.to) || edge.to === targetNodeId);
    return isUpstreamEdge || isDownstreamEdge;
  });

  // 5. Identify root entry points (`inDegree === 0`) and terminal sinks (`outDegree === 0`) on this path
  const entryPoints: CallflowNode[] = [];
  for (const id of upstreamNodeIds) {
    const n = graph.nodes.get(id);
    if (n && n.inDegree === 0) {
      entryPoints.push(n);
    }
  }
  if (selectedNode.inDegree === 0) {
    entryPoints.unshift(selectedNode);
  }

  const terminalPoints: CallflowNode[] = [];
  for (const id of downstreamNodeIds) {
    const n = graph.nodes.get(id);
    if (n && n.outDegree === 0) {
      terminalPoints.push(n);
    }
  }
  if (selectedNode.outDegree === 0) {
    terminalPoints.unshift(selectedNode);
  }

  return {
    selectedNode,
    entryPoints,
    directCallers,
    directCallees,
    terminalPoints,
    upstreamNodeIds,
    downstreamNodeIds,
    activeNodeIds,
    activeEdges,
  };
}

/**
 * Matches a clicked DOM SVG element (`g.node`, `g.actor`, etc.) back to a CallflowNode ID.
 */
export function resolveClickedNodeIdFromSvgElement(
  targetEl: Element | null,
  graph: CallflowGraph
): string | null {
  if (!targetEl || graph.nodes.size === 0) return null;

  const nodeGroup = targetEl.closest('g.node, g.actor, g.statediagram-state, g.classGroup');
  if (!nodeGroup) return null;

  const domId = nodeGroup.getAttribute('id') || '';
  const dataId = nodeGroup.getAttribute('data-id') || '';
  const textLabel = (nodeGroup.textContent || '').trim();

  // 1. Check `data-id` exact match
  if (dataId && graph.nodes.has(dataId)) {
    return dataId;
  }

  // 2. Check Mermaid's `flowchart-<NodeId>-<index>` DOM id convention
  for (const nodeId of graph.nodes.keys()) {
    const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|-)${escaped}(?:-\\d+|$)`, 'i');
    if (regex.test(domId)) {
      return nodeId;
    }
  }

  // 3. Fallback: match by exact node label text
  for (const [nodeId, nodeObj] of graph.nodes.entries()) {
    if (nodeObj.label === textLabel || nodeId === textLabel) {
      return nodeId;
    }
  }

  return null;
}

/**
 * Highlights the traced callflow path inside the SVG (Upstream = Cyan, Selected = Amber/Gold,
 * Downstream = Emerald, Terminal = Rose) and dims unrelated nodes/edges so overlapping lines disappear visually.
 */
export function applyCallflowSpotlightToSvg(
  svgString: string,
  trace: CallflowTraceResult | null,
  canvasSurface: 'dark' | 'light',
  graph: CallflowGraph
): string {
  if (!trace) return svgString;

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return svgString;

  const isDark = canvasSurface === 'dark';

  // Style all node groups
  const nodeGroups = Array.from(
    svgEl.querySelectorAll('g.node, g.actor, g.statediagram-state, g.classGroup')
  );

  nodeGroups.forEach((nodeGroup) => {
    const matchedId = resolveClickedNodeIdFromSvgElement(nodeGroup, graph);
    (nodeGroup as SVGElement).style.cursor = 'pointer';
    (nodeGroup as SVGElement).style.transition = 'opacity 150ms ease';

    if (!matchedId || !trace.activeNodeIds.has(matchedId)) {
      // Dim unrelated nodes
      (nodeGroup as SVGElement).style.opacity = '0.18';
      return;
    }

    (nodeGroup as SVGElement).style.opacity = '1';

    let fill = isDark ? '#1e1b4b' : '#e0e7ff';
    let border = isDark ? '#818cf8' : '#4f46e5';
    let text = isDark ? '#ffffff' : '#0f172a';
    let strokeWidth = '2.5px';

    if (matchedId === trace.selectedNode.id) {
      // Selected focus node: high-contrast Gold/Amber ring
      fill = isDark ? '#78350f' : '#fef3c7';
      border = isDark ? '#fbbf24' : '#d97706';
      text = isDark ? '#fffbeb' : '#78350f';
      strokeWidth = '3.5px';
    } else if (trace.upstreamNodeIds.has(matchedId)) {
      // Upstream caller / entry point: Cyan/Sky
      fill = isDark ? '#0c4a6e' : '#e0f2fe';
      border = isDark ? '#38bdf8' : '#0284c7';
      text = isDark ? '#f0f9ff' : '#0c4a6e';
    } else if (trace.terminalPoints.some((t) => t.id === matchedId)) {
      // Terminal sink: Rose/Coral
      fill = isDark ? '#881337' : '#ffe4e6';
      border = isDark ? '#fb7185' : '#e11d48';
      text = isDark ? '#fff1f2' : '#881337';
    } else if (trace.downstreamNodeIds.has(matchedId)) {
      // Downstream callee: Emerald
      fill = isDark ? '#064e3b' : '#d1fae5';
      border = isDark ? '#34d399' : '#059669';
      text = isDark ? '#ecfdf5' : '#064e3b';
    }

    const shapes = nodeGroup.querySelectorAll(
      'rect, polygon, circle, ellipse, path.label-container, path.basic, g.label-container > path'
    );
    const targetShapes =
      shapes.length > 0
        ? Array.from(shapes)
        : Array.from(nodeGroup.children).filter((el) =>
            ['rect', 'polygon', 'circle', 'ellipse', 'path'].includes(
              el.tagName.toLowerCase()
            )
          );

    targetShapes.forEach((shape) => {
      (shape as SVGElement).style.fill = fill;
      (shape as SVGElement).style.stroke = border;
      (shape as SVGElement).style.strokeWidth = strokeWidth;
      shape.setAttribute('fill', fill);
      shape.setAttribute('stroke', border);
    });

    const textEls = nodeGroup.querySelectorAll('text, tspan');
    textEls.forEach((el) => {
      (el as SVGElement).style.fill = text;
      el.setAttribute('fill', text);
    });
    const htmlEls = nodeGroup.querySelectorAll(
      'foreignObject div, foreignObject span, foreignObject p'
    );
    htmlEls.forEach((el) => {
      (el as HTMLElement).style.color = text;
      (el as HTMLElement).style.fontWeight = '700';
    });
  });

  // Dim or highlight edges based on whether their IDs connect active nodes
  const edgeElements = Array.from(
    svgEl.querySelectorAll('g.edgePath, g.edgePaths > g, path.flowchart-link')
  );

  edgeElements.forEach((edgeEl) => {
    const edgeId = `${edgeEl.getAttribute('id') || ''} ${edgeEl.getAttribute('class') || ''}`;
    let isEdgeOnActivePath = false;

    for (const activeEdge of trace.activeEdges) {
      if (
        edgeId.includes(`-${activeEdge.from}-${activeEdge.to}-`) ||
        edgeId.includes(`_${activeEdge.from}_${activeEdge.to}_`) ||
        edgeId.includes(`L-${activeEdge.from}-${activeEdge.to}`) ||
        edgeId.includes(`L_${activeEdge.from}_${activeEdge.to}`)
      ) {
        isEdgeOnActivePath = true;
        break;
      }
    }

    if (isEdgeOnActivePath) {
      (edgeEl as SVGElement).style.opacity = '1';
      const pathNodes =
        edgeEl.tagName.toLowerCase() === 'path'
          ? [edgeEl]
          : Array.from(edgeEl.querySelectorAll('path'));
      pathNodes.forEach((p) => {
        (p as SVGElement).style.stroke = isDark ? '#38bdf8' : '#0284c7';
        (p as SVGElement).style.strokeWidth = '3px';
      });
    } else {
      (edgeEl as SVGElement).style.opacity = '0.14';
    }
  });

  // Dim clusters slightly so highlighted nodes pop out
  const clusters = svgEl.querySelectorAll('g.cluster');
  clusters.forEach((cl) => {
    (cl as SVGElement).style.opacity = '0.45';
  });

  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgEl);
}

/**
 * Generates clean, isolated Mermaid code containing ONLY the traced callflow path
 * for a selected node (Upstream -> Selected -> Downstream), removing all other overlapping nodes!
 */
export function buildIsolatedPathMermaidCode(
  trace: CallflowTraceResult,
  direction: string = 'LR'
): string {
  const lines: string[] = [`flowchart ${direction}`];

  const sanitizeLabel = (lbl: string) => lbl.replace(/"/g, "'");

  // Emit node declarations with semantic shapes
  for (const nodeId of trace.activeNodeIds) {
    let nodeObj: CallflowNode | undefined;
    if (nodeId === trace.selectedNode.id) nodeObj = trace.selectedNode;
    else {
      const foundEdge = trace.activeEdges.find(
        (e) => e.from === nodeId || e.to === nodeId
      );
      if (foundEdge) {
        // Fallback label lookup
      }
    }
    const labelText = nodeObj?.label || nodeId;
    if (nodeId === trace.selectedNode.id) {
      lines.push(`    ${nodeId}[["★ ${sanitizeLabel(labelText)}"]]`);
    } else if (trace.entryPoints.some((e) => e.id === nodeId)) {
      lines.push(`    ${nodeId}(["▶ ${sanitizeLabel(labelText)}"])`);
    } else if (trace.terminalPoints.some((t) => t.id === nodeId)) {
      lines.push(`    ${nodeId}[("■ ${sanitizeLabel(labelText)}")]`);
    }
  }

  // Emit active edges
  for (const edge of trace.activeEdges) {
    const labelPart = edge.label ? `|${edge.label.replace(/\|/g, '/')}|` : '';
    lines.push(`    ${edge.from} ${edge.rawArrow}${labelPart} ${edge.to}`);
  }

  return lines.join('\n');
}

/**
 * Automatically structures a flat script callflow into 3 topological subgraphs:
 * 1. Einstiegs-Skripte (Entry Points, inDegree === 0)
 * 2. Verteiler & Verarbeitung (Hubs & Steps, inDegree > 0 && outDegree > 0)
 * 3. Endpunkte & Ziele (Terminals, outDegree === 0)
 * This dramatically helps Mermaid/ELK untangle overlapping callflows!
 */
export function autoGroupCallflowByTopology(
  code: string,
  graph: CallflowGraph
): string {
  if (graph.nodes.size < 3) return code;

  // Strip previous auto-topology blocks if present
  const cleaned = code.replace(
    /\n*%% --- AUTO-TOPOLOGIE START ---[\s\S]*?%% --- AUTO-TOPOLOGIE ENDE ---\n*/g,
    '\n'
  );

  const lines: string[] = [
    '',
    '    %% --- AUTO-TOPOLOGIE START ---',
  ];

  if (graph.entryNodes.length > 0) {
    lines.push('    subgraph Topo_Entry["1. Einstiegs-Skripte (Startpunkte)"]');
    for (const n of graph.entryNodes) {
      lines.push(`        ${n.id}["${n.label.replace(/"/g, "'")}"]`);
    }
    lines.push('    end');
  }

  if (graph.hubNodes.length > 0) {
    lines.push('    subgraph Topo_Hubs["2. Zentrale Verteiler & Controller"]');
    for (const n of graph.hubNodes) {
      lines.push(`        ${n.id}["${n.label.replace(/"/g, "'")}"]`);
    }
    lines.push('    end');
  }

  if (graph.terminalNodes.length > 0) {
    lines.push('    subgraph Topo_Terminals["3. Endpunkte & Zielsysteme"]');
    for (const n of graph.terminalNodes) {
      lines.push(`        ${n.id}["${n.label.replace(/"/g, "'")}"]`);
    }
    lines.push('    end');
  }

  lines.push('    %% --- AUTO-TOPOLOGIE ENDE ---');
  return `${cleaned.trimEnd()}\n${lines.join('\n')}\n`;
}

/**
 * Generates a 100% standalone, offline-capable interactive HTML file containing:
 * - The rendered SVG diagram (with pan & zoom)
 * - The embedded CallflowGraph JSON
 * - Interactive click/tap path filtering, script search, and Upstream/Downstream inspector sidebar!
 */
export function generateInteractiveCallflowHtml(
  diagramTitle: string,
  svgString: string,
  graph: CallflowGraph,
  canvasSurface: 'dark' | 'light'
): string {
  const serializedNodes = Array.from(graph.nodes.values());
  const serializedEdges = graph.edges;
  const graphJson = JSON.stringify({
    nodes: serializedNodes,
    edges: serializedEdges,
  });

  const bgHex = canvasSurface === 'dark' ? '#0b0f19' : '#f8fafc';

  return `<!doctype html>
<html lang="de" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${diagramTitle} — Interaktiver Callflow Explorer (MermaidFree2UseOpen)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #090d16;
      color: #f1f5f9;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      height: 54px;
      padding: 0 20px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .brand { font-weight: 700; font-size: 15px; color: #f8fafc; white-space: nowrap; }
    .controls { display: flex; align-items: center; gap: 8px; }
    input, select, button {
      background: #1e293b;
      color: #f1f5f9;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
    }
    button:hover { background: #334155; }
    button.primary { background: #4f46e5; border-color: #6366f1; font-weight: 600; }
    button.primary:hover { background: #4338ca; }
    main { flex: 1; display: flex; min-height: 0; overflow: hidden; }
    #canvas-wrap {
      flex: 1;
      background: ${bgHex};
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
    }
    #canvas-wrap:active { cursor: grabbing; }
    #svg-stage { transform-origin: center center; transition: transform 60ms ease-out; padding: 32px; }
    aside {
      width: 340px;
      background: #0f172a;
      border-left: 1px solid #1e293b;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 16px;
      gap: 16px;
    }
    .card {
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 12px;
    }
    .card h3 { font-size: 12px; color: #94a3b8; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.04em; }
    .node-chip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      text-align: left;
      margin-top: 6px;
      padding: 7px 10px;
      border-radius: 6px;
      background: #1e293b;
      border: 1px solid #334155;
      font-family: monospace;
      font-size: 12px;
    }
    .node-chip:hover { border-color: #6366f1; }
    .badge { font-size: 11px; color: #38bdf8; }
    @media (max-width: 860px) {
      main { flex-direction: column; }
      aside { width: 100%; height: 42vh; border-left: none; border-top: 1px solid #1e293b; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">${diagramTitle} · Interaktiver Callflow</div>
    <div class="controls">
      <select id="node-select">
        <option value="">Alle Pfade anzeigen (Kein Filter)...</option>
      </select>
      <button id="btn-reset">Filter &amp; Zoom zurücksetzen</button>
    </div>
  </header>
  <main>
    <div id="canvas-wrap">
      <div id="svg-stage">${svgString}</div>
    </div>
    <aside>
      <div class="card">
        <h3>Aktiver Callflow-Pfad</h3>
        <div id="selected-info" style="font-size: 13px; color: #cbd5e1;">
          Tippen oder klicken Sie im Diagramm auf einen Knoten, um zu sehen, <strong>woher der Aufruf kommt</strong> und <strong>wo er endet</strong>.
        </div>
      </div>
      <div class="card">
        <h3 style="color:#38bdf8;">1. Startpunkte (Ursprung)</h3>
        <div id="list-entries" style="font-size:12px;color:#64748b;">–</div>
      </div>
      <div class="card">
        <h3 style="color:#60a5fa;">2. Direkte Aufrufer (Woher?)</h3>
        <div id="list-callers" style="font-size:12px;color:#64748b;">–</div>
      </div>
      <div class="card">
        <h3 style="color:#34d399;">3. Direkte Folgeschritte (Wohin?)</h3>
        <div id="list-callees" style="font-size:12px;color:#64748b;">–</div>
      </div>
      <div class="card">
        <h3 style="color:#fb7185;">4. Endpunkte (Terminierung)</h3>
        <div id="list-terminals" style="font-size:12px;color:#64748b;">–</div>
      </div>
    </aside>
  </main>
  <script>
    const GRAPH = ${graphJson};
    const nodeMap = new Map(GRAPH.nodes.map(n => [n.id, n]));
    const selectEl = document.getElementById('node-select');
    GRAPH.nodes.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = n.label + ' (' + n.inDegree + ' ein / ' + n.outDegree + ' aus)';
      selectEl.appendChild(opt);
    });

    let zoom = 1, panX = 0, panY = 0, isDragging = false, startX = 0, startY = 0;
    const stage = document.getElementById('svg-stage');
    const wrap = document.getElementById('canvas-wrap');
    function updateTransform() {
      stage.style.transform = 'translate3d(' + panX + 'px,' + panY + 'px,0) scale(' + zoom + ')';
    }
    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      zoom = Math.min(4, Math.max(0.2, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      updateTransform();
    });
    wrap.addEventListener('mousedown', e => { isDragging = true; startX = e.clientX - panX; startY = e.clientY - panY; });
    window.addEventListener('mousemove', e => { if (!isDragging) return; panX = e.clientX - startX; panY = e.clientY - startY; updateTransform(); });
    window.addEventListener('mouseup', () => { isDragging = false; });

    function resolveNodeId(el) {
      const g = el.closest('g.node, g.actor, g.statediagram-state');
      if (!g) return null;
      const domId = g.getAttribute('id') || '';
      const text = (g.textContent || '').trim();
      for (const n of GRAPH.nodes) {
        const rx = new RegExp('(?:^|-)' + n.id.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '(?:-\\\\d+|$)', 'i');
        if (rx.test(domId)) return n.id;
      }
      for (const n of GRAPH.nodes) {
        if (n.label === text || n.id === text) return n.id;
      }
      return null;
    }

    function renderList(containerId, items) {
      const el = document.getElementById(containerId);
      el.innerHTML = '';
      if (!items.length) { el.textContent = 'Keine'; return; }
      items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'node-chip';
        btn.innerHTML = '<span>' + item.label + '</span><span class="badge">Fokus →</span>';
        btn.onclick = () => selectNode(item.id);
        el.appendChild(btn);
      });
    }

    function selectNode(targetId) {
      selectEl.value = targetId || '';
      const allSvgNodes = document.querySelectorAll('g.node, g.actor, g.statediagram-state');
      const allSvgEdges = document.querySelectorAll('g.edgePath, g.edgePaths > g, path.flowchart-link');
      if (!targetId || !nodeMap.has(targetId)) {
        allSvgNodes.forEach(n => n.style.opacity = '1');
        allSvgEdges.forEach(e => e.style.opacity = '1');
        document.getElementById('selected-info').innerHTML = 'Alle <strong>' + GRAPH.nodes.length + ' Knoten</strong> und <strong>' + GRAPH.edges.length + ' Verbindungen</strong> sichtbar.';
        renderList('list-entries', GRAPH.nodes.filter(n => n.inDegree === 0));
        renderList('list-callers', []);
        renderList('list-callees', []);
        renderList('list-terminals', GRAPH.nodes.filter(n => n.outDegree === 0));
        return;
      }

      const up = new Set(), down = new Set();
      const qUp = [targetId];
      while (qUp.length) {
        const c = qUp.shift();
        GRAPH.edges.forEach(e => { if (e.to === c && !up.has(e.from) && e.from !== targetId) { up.add(e.from); qUp.push(e.from); } });
      }
      const qDown = [targetId];
      while (qDown.length) {
        const c = qDown.shift();
        GRAPH.edges.forEach(e => { if (e.from === c && !down.has(e.to) && e.to !== targetId) { down.add(e.to); qDown.push(e.to); } });
      }
      const active = new Set([targetId, ...up, ...down]);

      allSvgNodes.forEach(g => {
        const nid = resolveNodeId(g);
        g.style.opacity = (nid && active.has(nid)) ? '1' : '0.16';
      });
      allSvgEdges.forEach(edgeEl => {
        const eid = (edgeEl.getAttribute('id') || '') + ' ' + (edgeEl.getAttribute('class') || '');
        let match = false;
        GRAPH.edges.forEach(e => {
          if (active.has(e.from) && active.has(e.to)) {
            if (eid.includes('-' + e.from + '-' + e.to + '-') || eid.includes('L-' + e.from + '-' + e.to) || eid.includes('L_' + e.from + '_' + e.to)) match = true;
          }
        });
        edgeEl.style.opacity = match ? '1' : '0.12';
      });

      const nodeObj = nodeMap.get(targetId);
      document.getElementById('selected-info').innerHTML = 'Fokus: <strong style="color:#fbbf24">' + nodeObj.label + '</strong> (' + active.size + ' beteiligte Knoten im Pfad)';
      renderList('list-entries', Array.from(up).map(id => nodeMap.get(id)).filter(n => n && n.inDegree === 0));
      renderList('list-callers', GRAPH.edges.filter(e => e.to === targetId).map(e => nodeMap.get(e.from)).filter(Boolean));
      renderList('list-callees', GRAPH.edges.filter(e => e.from === targetId).map(e => nodeMap.get(e.to)).filter(Boolean));
      renderList('list-terminals', Array.from(down).map(id => nodeMap.get(id)).filter(n => n && n.outDegree === 0));
    }

    document.querySelectorAll('g.node, g.actor, g.statediagram-state').forEach(g => {
      g.style.cursor = 'pointer';
      g.addEventListener('click', e => {
        e.stopPropagation();
        const nid = resolveNodeId(g);
        if (nid) selectNode(nid);
      });
    });
    selectEl.addEventListener('change', e => selectNode(e.target.value));
    document.getElementById('btn-reset').addEventListener('click', () => { zoom = 1; panX = 0; panY = 0; updateTransform(); selectNode(''); });
    selectNode('');
  </script>
</body>
</html>`;
}
