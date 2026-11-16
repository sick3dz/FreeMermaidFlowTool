import {
  CallflowDirectionFilter,
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
 * Splits a Mermaid line on `;` outside of quotes so multi-statement lines are parsed cleanly.
 */
function splitStatementsOutsideQuotes(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inDouble = false;
  let inSingle = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === ';' && !inDouble && !inSingle) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Cleans HTML tags like `<br/>` and outer quotes from an extracted Mermaid label.
 */
function cleanMermaidLabel(raw: string): string {
  return raw
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts node ID and optional label from a Mermaid node token, supporting complex labels
 * with spaces, parentheses, brackets, quotes, `<br/>`, and Mermaid v11 `@{ ... }` shapes.
 */
function parseNodeToken(rawToken: string): { id: string; label?: string } | null {
  let token = rawToken.trim();
  if (!token) return null;

  // Strip trailing :::className shorthand
  token = token.replace(/:::[A-Za-z0-9_-]+$/, '').trim();

  // Handle state diagram [*] token
  if (token === '[*]') {
    return { id: 'START_END', label: '[*]' };
  }

  // Handle v11 @{ shape: ..., label: "..." } syntax
  const v11Match = token.match(/^([A-Za-z0-9_.-]+)\s*@\s*\{([\s\S]*)\}$/);
  if (v11Match) {
    const id = v11Match[1];
    if (RESERVED_KEYWORDS.has(id.toLowerCase()) || RESERVED_KEYWORDS.has(id)) return null;
    const body = v11Match[2];
    const labelMatch = body.match(/label\s*:\s*["']([^"']+)["']/i);
    return { id, label: labelMatch ? cleanMermaidLabel(labelMatch[1]) : id };
  }

  // Match ID followed by bracket/brace/paren delimiter shapes
  const idPrefixMatch = token.match(/^([A-Za-z0-9_.-]+)\s*([\[(\{>].*)$/);
  if (idPrefixMatch) {
    const id = idPrefixMatch[1];
    if (RESERVED_KEYWORDS.has(id.toLowerCase()) || RESERVED_KEYWORDS.has(id)) return null;
    const shapePart = idPrefixMatch[2].trim();

    const orderedDelimiters: Array<[string, string]> = [
      ['([', '])'],
      ['[(', ')]'],
      ['[[', ']]'],
      ['((', '))'],
      ['{{', '}}'],
      ['[/', '/]'],
      ['[\\', '\\]'],
      ['[', ']'],
      ['(', ')'],
      ['{', '}'],
      ['>', ']'],
    ];

    for (const [open, close] of orderedDelimiters) {
      if (shapePart.startsWith(open) && shapePart.endsWith(close)) {
        const inner = shapePart.slice(open.length, shapePart.length - close.length);
        const cleaned = cleanMermaidLabel(inner);
        return { id, label: cleaned || id };
      }
    }
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
 * Supports Flowchart (`-->`, `-.->`, `==>`, `<-->`), Sequence (`->>`, `-->>`), State (`-->`), etc.
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

  // Remove %%{init:...}%% blocks and YAML frontmatter
  const cleanedCode = code
    .replace(/%%\{[\s\S]*?\}%%/g, '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/m, '');

  const rawLines = cleanedCode.split('\n');
  const statements: string[] = [];

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('%%')) continue;
    // Strip trailing %% comment outside quotes
    const withoutComment = line.replace(/\s+%%[^"']*$/, '').trim();
    if (!withoutComment) continue;
    statements.push(...splitStatementsOutsideQuotes(withoutComment));
  }

  for (const line of statements) {
    // Skip styling / directive lines
    if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/i.test(line)) {
      continue;
    }

    // Check Sequence participant/actor alias: `participant A as Auth_Script.py`
    const seqActorMatch = line.match(
      /^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$/i
    );
    if (seqActorMatch) {
      registerNode(
        seqActorMatch[1],
        seqActorMatch[2] ? cleanMermaidLabel(seqActorMatch[2]) : seqActorMatch[1]
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

    // Check Flowchart / State chained or single connections
    const arrowRegex =
      /\s*(<-->|<-\.->|<==>|-->|-\.->|==>|---|-\.-|==|--\s+[^-|\n]+\s+-->|-\.\s+[^.|\n]+\s+\.->|==\s+[^=|\n]+\s+==>)\s*(?:\|([^|]*)\|)?\s*/g;

    if (arrowRegex.test(line)) {
      arrowRegex.lastIndex = 0;
      const segments: string[] = [];
      const arrows: Array<{
        rawArrow: string;
        label: string;
        isAsync: boolean;
        bidirectional: boolean;
      }> = [];

      let lastIdx = 0;
      let match: RegExpExecArray | null;
      while ((match = arrowRegex.exec(line)) !== null) {
        segments.push(line.slice(lastIdx, match.index).trim());
        const rawArrow = match[1].trim();
        let edgeLabel = (match[2] || '').trim();

        const inlineMatch = rawArrow.match(
          /^--\s+(.+?)\s+-->$|^-\.\s+(.+?)\s+\.->$|^==\s+(.+?)\s+==>$/
        );
        if (inlineMatch) {
          edgeLabel = (inlineMatch[1] || inlineMatch[2] || inlineMatch[3] || '').trim();
        }

        const isAsync = rawArrow.includes('-.');
        const bidirectional = rawArrow.startsWith('<');
        arrows.push({
          rawArrow: isAsync ? '-.->' : rawArrow.includes('==') ? '==>' : '-->',
          label: cleanMermaidLabel(edgeLabel),
          isAsync,
          bidirectional,
        });
        lastIdx = arrowRegex.lastIndex;
      }
      segments.push(line.slice(lastIdx).trim());

      for (let i = 0; i < arrows.length; i++) {
        const leftRaw = segments[i];
        const rightRaw = segments[i + 1];
        if (!leftRaw || !rightRaw) continue;

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
              if (arrows[i].bidirectional) {
                edges.push({
                  from: rightNode.id,
                  to: leftNode.id,
                  label: arrows[i].label,
                  rawArrow: arrows[i].rawArrow,
                  isAsync: arrows[i].isAsync,
                });
              }
            }
          }
        }
      }
      continue;
    }

    // Standalone node declaration line
    if (!line.startsWith('subgraph') && !line.startsWith('end')) {
      const singleNode = parseNodeToken(line);
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

  // 4. Separate upstream edges, downstream edges, and union
  const upstreamEdges = graph.edges.filter(
    (edge) =>
      (upstreamNodeIds.has(edge.from) || edge.from === targetNodeId) &&
      (upstreamNodeIds.has(edge.to) || edge.to === targetNodeId) &&
      // Do not classify edges going OUT of targetNodeId back into an upstream cycle as upstream unless target->upstream
      edge.from !== targetNodeId
  );

  const downstreamEdges = graph.edges.filter(
    (edge) =>
      (downstreamNodeIds.has(edge.from) || edge.from === targetNodeId) &&
      (downstreamNodeIds.has(edge.to) || edge.to === targetNodeId) &&
      edge.to !== targetNodeId
  );

  const activeEdges = Array.from(new Set([...upstreamEdges, ...downstreamEdges]));

  // 5. Identify root entry points (`inDegree === 0`) and terminal sinks (`outDegree === 0`)
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
    upstreamEdges,
    downstreamEdges,
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
  const textLabel = (nodeGroup.textContent || '').replace(/\s+/g, ' ').trim();

  // 1. Check `data-id` exact match
  if (dataId && graph.nodes.has(dataId)) {
    return dataId;
  }

  // 2. Check Mermaid's `flowchart-<NodeId>-<index>` DOM id convention (longest ID first to avoid prefix collision)
  const sortedIds = Array.from(graph.nodes.keys()).sort((a, b) => b.length - a.length);
  for (const nodeId of sortedIds) {
    const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[-_])${escaped}(?:[-_]\\d+|$)`, 'i');
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
 * Checks whether an SVG edge element belongs to any edge in `allowedEdges` (works for Dagre & ELK).
 */
function matchesSvgEdge(edgeEl: Element, allowedEdges: CallflowEdge[]): boolean {
  const edgeMeta = `${edgeEl.getAttribute('id') || ''} ${edgeEl.getAttribute('data-id') || ''} ${
    edgeEl.getAttribute('class') || ''
  }`;

  for (const activeEdge of allowedEdges) {
    const fromEsc = activeEdge.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const toEsc = activeEdge.to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `(?:^|[-_L])${fromEsc}[-_]${toEsc}(?:[-_\\s\\d]|$)|L[-_]${fromEsc}[-_]${toEsc}`,
      'i'
    );
    if (
      pattern.test(edgeMeta) ||
      edgeMeta.includes(`-${activeEdge.from}-${activeEdge.to}-`) ||
      edgeMeta.includes(`_${activeEdge.from}_${activeEdge.to}_`) ||
      edgeMeta.includes(`L_${activeEdge.from}_${activeEdge.to}`) ||
      edgeMeta.includes(`L-${activeEdge.from}-${activeEdge.to}`)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Highlights the traced callflow path inside the SVG (Upstream = Cyan, Selected = Amber/Gold,
 * Downstream = Emerald, Terminal = Rose) and dims unrelated nodes, edges, and edge labels
 * while keeping their exact position inside the full diagram.
 */
export function applyCallflowSpotlightToSvg(
  svgString: string,
  trace: CallflowTraceResult | null,
  canvasSurface: 'dark' | 'light',
  graph: CallflowGraph,
  directionFilter: CallflowDirectionFilter = 'both'
): string {
  if (!trace) return svgString;

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return svgString;

  const isDark = canvasSurface === 'dark';

  // Determine which nodes & edges are active under the chosen direction filter
  const visibleNodeIds = new Set<string>([trace.selectedNode.id]);
  if (directionFilter === 'both' || directionFilter === 'upstream') {
    trace.upstreamNodeIds.forEach((id) => visibleNodeIds.add(id));
  }
  if (directionFilter === 'both' || directionFilter === 'downstream') {
    trace.downstreamNodeIds.forEach((id) => visibleNodeIds.add(id));
  }

  const visibleEdges =
    directionFilter === 'upstream'
      ? trace.upstreamEdges
      : directionFilter === 'downstream'
      ? trace.downstreamEdges
      : trace.activeEdges;

  // Style all node groups
  const nodeGroups = Array.from(
    svgEl.querySelectorAll('g.node, g.actor, g.statediagram-state, g.classGroup')
  );

  nodeGroups.forEach((nodeGroup) => {
    const matchedId = resolveClickedNodeIdFromSvgElement(nodeGroup, graph);
    (nodeGroup as SVGElement).style.cursor = 'pointer';
    (nodeGroup as SVGElement).style.transition = 'opacity 150ms ease';

    if (!matchedId || !visibleNodeIds.has(matchedId)) {
      // Strongly dim unrelated nodes while keeping exact layout positions
      (nodeGroup as SVGElement).style.opacity = '0.12';
      return;
    }

    (nodeGroup as SVGElement).style.opacity = '1';

    let fill = isDark ? '#1e1b4b' : '#e0e7ff';
    let border = isDark ? '#818cf8' : '#4f46e5';
    let text = isDark ? '#ffffff' : '#0f172a';
    let strokeWidth = '2.5px';

    if (matchedId === trace.selectedNode.id) {
      fill = isDark ? '#78350f' : '#fef3c7';
      border = isDark ? '#fbbf24' : '#d97706';
      text = isDark ? '#fffbeb' : '#78350f';
      strokeWidth = '3.5px';
    } else if (trace.upstreamNodeIds.has(matchedId)) {
      fill = isDark ? '#0c4a6e' : '#e0f2fe';
      border = isDark ? '#38bdf8' : '#0284c7';
      text = isDark ? '#f0f9ff' : '#0c4a6e';
    } else if (trace.terminalPoints.some((t) => t.id === matchedId)) {
      fill = isDark ? '#881337' : '#ffe4e6';
      border = isDark ? '#fb7185' : '#e11d48';
      text = isDark ? '#fff1f2' : '#881337';
    } else if (trace.downstreamNodeIds.has(matchedId)) {
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

  // Dim or highlight edges AND corresponding edgeLabels
  const edgeElements = Array.from(
    svgEl.querySelectorAll('g.edgePaths > *, g.edgePath, path.flowchart-link')
  );
  const edgeLabelElements = Array.from(
    svgEl.querySelectorAll('g.edgeLabels > *, g.edgeLabel')
  );

  const activeEdgeIndices = new Set<number>();

  edgeElements.forEach((edgeEl, idx) => {
    const isEdgeOnActivePath = matchesSvgEdge(edgeEl, visibleEdges);

    if (isEdgeOnActivePath) {
      activeEdgeIndices.add(idx);
      (edgeEl as SVGElement).style.opacity = '1';
      const pathNodes =
        edgeEl.tagName.toLowerCase() === 'path'
          ? [edgeEl]
          : Array.from(edgeEl.querySelectorAll('path'));
      const activeStroke =
        directionFilter === 'downstream'
          ? isDark
            ? '#34d399'
            : '#059669'
          : isDark
          ? '#38bdf8'
          : '#0284c7';
      pathNodes.forEach((p) => {
        (p as SVGElement).style.stroke = activeStroke;
        (p as SVGElement).style.strokeWidth = '3px';
      });
    } else {
      (edgeEl as SVGElement).style.opacity = '0.12';
    }
  });

  // Match edgeLabels to their corresponding edges by id or index
  edgeLabelElements.forEach((labelEl, idx) => {
    const labelMatchedById = matchesSvgEdge(labelEl, visibleEdges);
    const labelMatchedByIndex =
      edgeLabelElements.length === edgeElements.length && activeEdgeIndices.has(idx);
    (labelEl as SVGElement).style.opacity =
      labelMatchedById || labelMatchedByIndex ? '1' : '0.12';
  });

  // Dim clusters slightly so highlighted paths pop out
  const clusters = svgEl.querySelectorAll('g.cluster');
  clusters.forEach((cl) => {
    (cl as SVGElement).style.opacity = '0.35';
  });

  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgEl);
}

/**
 * Generates clean, isolated Mermaid code containing ONLY the traced callflow path
 * for a selected node, preserving human-readable labels and respecting directionFilter.
 */
export function buildIsolatedPathMermaidCode(
  trace: CallflowTraceResult,
  graph: CallflowGraph,
  direction: string = 'LR',
  directionFilter: CallflowDirectionFilter = 'both'
): string {
  const lines: string[] = [`flowchart ${direction}`];
  const sanitizeLabel = (lbl: string) => lbl.replace(/"/g, "'");

  const nodeIdsToEmit = new Set<string>([trace.selectedNode.id]);
  if (directionFilter === 'both' || directionFilter === 'upstream') {
    trace.upstreamNodeIds.forEach((id) => nodeIdsToEmit.add(id));
  }
  if (directionFilter === 'both' || directionFilter === 'downstream') {
    trace.downstreamNodeIds.forEach((id) => nodeIdsToEmit.add(id));
  }

  for (const nodeId of nodeIdsToEmit) {
    const nodeObj = graph.nodes.get(nodeId);
    const labelText = nodeObj?.label || nodeId;
    if (nodeId === trace.selectedNode.id) {
      lines.push(`    ${nodeId}[["★ ${sanitizeLabel(labelText)}"]]`);
    } else if (trace.entryPoints.some((e) => e.id === nodeId)) {
      lines.push(`    ${nodeId}(["▶ ${sanitizeLabel(labelText)}"])`);
    } else if (trace.terminalPoints.some((t) => t.id === nodeId)) {
      lines.push(`    ${nodeId}[("■ ${sanitizeLabel(labelText)}")]`);
    } else {
      lines.push(`    ${nodeId}["${sanitizeLabel(labelText)}"]`);
    }
  }

  const edgesToEmit =
    directionFilter === 'upstream'
      ? trace.upstreamEdges
      : directionFilter === 'downstream'
      ? trace.downstreamEdges
      : trace.activeEdges;

  for (const edge of edgesToEmit) {
    const labelPart = edge.label ? `|${edge.label.replace(/\|/g, '/')}|` : '';
    lines.push(`    ${edge.from} ${edge.rawArrow}${labelPart} ${edge.to}`);
  }

  return lines.join('\n');
}

/**
 * Automatically structures a flat script callflow into 3 topological subgraphs:
 * 1. Einstiegs-Skripte (Entry Points)
 * 2. Verteiler & Verarbeitung (Hubs)
 * 3. Endpunkte & Ziele (Terminals)
 */
export function autoGroupCallflowByTopology(
  code: string,
  graph: CallflowGraph
): string {
  if (graph.nodes.size < 3) return code;

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
 * - True 1:1 SVG dimensions with Zoom up to 2000%, Zoom-to-Cursor & Auto-Focus on Node
 * - Full Callflow filters: Direction Filter (`Ganzer Pfad` / `Nur Woher` / `Nur Wohin`),
 *   Live Search, Role Quick-Filter (`Alle`, `Startpunkte`, `Verteiler`, `Endpunkte`),
 *   and strong dimming (keeping position in overall diagram) across nodes, edges, and edge labels.
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
      min-height: 56px;
      padding: 8px 16px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .brand { font-weight: 700; font-size: 14px; color: #f8fafc; white-space: nowrap; }
    .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .seg-group {
      display: inline-flex;
      background: #020617;
      border: 1px solid #334155;
      border-radius: 7px;
      padding: 2px;
      gap: 2px;
    }
    .seg-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      padding: 5px 10px;
      border-radius: 5px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .seg-btn.active {
      background: #4f46e5;
      color: #ffffff;
      font-weight: 600;
    }
    input[type="text"], select, button {
      background: #1e293b;
      color: #f1f5f9;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
    }
    button { cursor: pointer; }
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
    #svg-stage {
      flex-shrink: 0;
      transform-origin: center center;
      transition: transform 45ms ease-out;
      padding: 32px;
    }
    #svg-stage svg {
      max-width: none !important;
      display: block;
    }
    aside {
      width: 360px;
      background: #0f172a;
      border-left: 1px solid #1e293b;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 14px;
      gap: 12px;
    }
    .card {
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 11px;
    }
    .card h3 { font-size: 11px; color: #94a3b8; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.04em; }
    .filter-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .chip {
      padding: 4px 8px;
      font-size: 11px;
      border-radius: 5px;
      background: #0f172a;
      border: 1px solid #334155;
      color: #cbd5e1;
      cursor: pointer;
    }
    .chip.active { background: #4f46e5; border-color: #6366f1; color: #fff; font-weight: 600; }
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
      color: #f1f5f9;
      cursor: pointer;
    }
    .node-chip:hover { border-color: #6366f1; }
    .badge { font-size: 11px; color: #38bdf8; flex-shrink: 0; margin-left: 8px; }
    .row-between { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    @media (max-width: 900px) {
      main { flex-direction: column; }
      aside { width: 100%; height: 44vh; border-left: none; border-top: 1px solid #1e293b; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">${diagramTitle} · Interaktiver Callflow</div>
    <div class="controls">
      <div class="seg-group" id="dir-group" title="Richtungs-Filter für den Callflow">
        <button class="seg-btn active" data-dir="both">Ganzer Pfad</button>
        <button class="seg-btn" data-dir="upstream">Nur Woher</button>
        <button class="seg-btn" data-dir="downstream">Nur Wohin</button>
      </div>
      <select id="dim-select" title="Darstellung nicht beteiligter Knoten">
        <option value="0.12" selected>Nebenpfade: Stark abdunkeln (12%)</option>
        <option value="0.30">Nebenpfade: Dezent (30%)</option>
        <option value="0">Nebenpfade: Ausblenden (0%)</option>
      </select>
      <button id="btn-fit" title="Gesamtes Diagramm in das Fenster einpassen">Fit</button>
      <button id="btn-100" class="primary" title="Echte 1:1 Originalgröße (100 % lesbar)">1:1 (100%)</button>
      <button id="btn-reset">Filter zurücksetzen</button>
    </div>
  </header>
  <main>
    <div id="canvas-wrap">
      <div id="svg-stage">${svgString}</div>
    </div>
    <aside>
      <div class="card">
        <h3>Filter &amp; Skript-Auswahl</h3>
        <input type="text" id="node-search" placeholder="Skript oder Knoten suchen..." style="width:100%;margin-bottom:8px;" />
        <select id="node-select" style="width:100%;font-family:monospace;">
          <option value="">Alle Pfade anzeigen (Kein Filter)...</option>
        </select>
        <div class="filter-chips" id="role-chips">
          <button class="chip active" data-role="all">Alle</button>
          <button class="chip" data-role="entry">▶ Startpunkte</button>
          <button class="chip" data-role="hub">◆ Verteiler</button>
          <button class="chip" data-role="terminal">■ Endpunkte</button>
        </div>
        <div class="row-between" style="margin-top:10px;font-size:11px;color:#94a3b8;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="chk-autofocus" checked />
            <span>Bei Auswahl automatisch 1:1 fokussieren</span>
          </label>
        </div>
      </div>

      <div class="card">
        <h3>Aktiver Callflow-Pfad</h3>
        <div id="selected-info" style="font-size: 13px; color: #cbd5e1;">
          Tippen oder klicken Sie im Diagramm auf einen Knoten, um zu sehen, <strong>woher der Aufruf kommt</strong> und <strong>wo er endet</strong>.
        </div>
      </div>
      <div class="card" id="card-entries">
        <h3 style="color:#38bdf8;">1. Startpunkte (Ursprung)</h3>
        <div id="list-entries" style="font-size:12px;color:#64748b;">–</div>
      </div>
      <div class="card" id="card-callers">
        <h3 style="color:#60a5fa;">2. Direkte Aufrufer (Woher?)</h3>
        <div id="list-callers" style="font-size:12px;color:#64748b;">–</div>
      </div>
      <div class="card" id="card-callees">
        <h3 style="color:#34d399;">3. Direkte Folgeschritte (Wohin?)</h3>
        <div id="list-callees" style="font-size:12px;color:#64748b;">–</div>
      </div>
      <div class="card" id="card-terminals">
        <h3 style="color:#fb7185;">4. Endpunkte (Terminierung)</h3>
        <div id="list-terminals" style="font-size:12px;color:#64748b;">–</div>
      </div>
    </aside>
  </main>
  <script>
    const GRAPH = ${graphJson};
    const nodeMap = new Map(GRAPH.nodes.map(n => [n.id, n]));
    const selectEl = document.getElementById('node-select');
    const searchEl = document.getElementById('node-search');
    const dimSelectEl = document.getElementById('dim-select');
    const autoFocusEl = document.getElementById('chk-autofocus');

    let activeNodeId = '';
    let directionFilter = 'both'; // 'both' | 'upstream' | 'downstream'
    let roleFilter = 'all'; // 'all' | 'entry' | 'hub' | 'terminal'
    let dimOpacity = '0.12';

    let zoom = 1, panX = 0, panY = 0, isDragging = false, startX = 0, startY = 0;
    const stage = document.getElementById('svg-stage');
    const wrap = document.getElementById('canvas-wrap');
    const svgEl = stage.querySelector('svg');
    if (svgEl) {
      const vb = (svgEl.getAttribute('viewBox') || '').trim().split(/[\\s,]+/).map(Number);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        svgEl.setAttribute('width', Math.ceil(vb[2]) + 'px');
        svgEl.setAttribute('height', Math.ceil(vb[3]) + 'px');
        svgEl.style.width = Math.ceil(vb[2]) + 'px';
        svgEl.style.height = Math.ceil(vb[3]) + 'px';
        svgEl.style.maxWidth = 'none';
      }
    }

    function populateSelect() {
      const q = (searchEl.value || '').trim().toLowerCase();
      const prevVal = activeNodeId;
      selectEl.innerHTML = '<option value="">Alle Pfade anzeigen (' + GRAPH.nodes.length + ' Knoten)...</option>';
      GRAPH.nodes
        .filter(n => {
          if (roleFilter !== 'all' && n.role !== roleFilter) return false;
          if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) return false;
          return true;
        })
        .forEach(n => {
          const opt = document.createElement('option');
          opt.value = n.id;
          const prefix = n.role === 'entry' ? '▶ ' : n.role === 'terminal' ? '■ ' : n.role === 'hub' ? '◆ ' : '• ';
          opt.textContent = prefix + n.label + ' (' + n.inDegree + ' ein / ' + n.outDegree + ' aus)';
          selectEl.appendChild(opt);
        });
      selectEl.value = prevVal;
    }

    function updateTransform() {
      stage.style.transform = 'translate3d(' + panX + 'px,' + panY + 'px,0) scale(' + zoom + ')';
      document.getElementById('btn-100').textContent = '1:1 (' + Math.round(zoom * 100) + '%)';
    }

    function fitToWindow() {
      if (!svgEl) return;
      const rect = wrap.getBoundingClientRect();
      const w = parseFloat(svgEl.getAttribute('width') || '1200');
      const h = parseFloat(svgEl.getAttribute('height') || '800');
      const scaleX = Math.max(100, rect.width - 64) / Math.max(1, w);
      const scaleY = Math.max(100, rect.height - 64) / Math.max(1, h);
      zoom = Math.min(2.5, Math.max(0.05, Math.min(scaleX, scaleY)));
      panX = 0;
      panY = 0;
      updateTransform();
    }

    function focusNodeCamera(targetId) {
      if (!targetId) return;
      const allSvgNodes = Array.from(document.querySelectorAll('g.node, g.actor, g.statediagram-state'));
      const targetEl = allSvgNodes.find(g => resolveNodeId(g) === targetId);
      if (!targetEl) return;
      const vpRect = wrap.getBoundingClientRect();
      const vpCenterX = vpRect.left + vpRect.width / 2;
      const vpCenterY = vpRect.top + vpRect.height / 2;
      const nodeRect = targetEl.getBoundingClientRect();
      const nodeCenterX = nodeRect.left + nodeRect.width / 2;
      const nodeCenterY = nodeRect.top + nodeRect.height / 2;
      const unscaledX = (nodeCenterX - (vpCenterX + panX)) / Math.max(0.05, zoom);
      const unscaledY = (nodeCenterY - (vpCenterY + panY)) / Math.max(0.05, zoom);
      const nextZoom = Math.min(20, Math.max(1.15, zoom < 0.9 ? 1.2 : zoom));
      zoom = nextZoom;
      panX = Math.round(-unscaledX * nextZoom);
      panY = Math.round(-unscaledY * nextZoom);
      updateTransform();
    }

    wrap.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const cursorOffsetX = e.clientX - (rect.left + rect.width / 2);
      const cursorOffsetY = e.clientY - (rect.top + rect.height / 2);
      const factor = e.deltaY < 0 ? 1.16 : 0.86;
      const nextZoom = Math.min(20, Math.max(0.05, zoom * factor));
      const ratio = nextZoom / zoom;
      panX = cursorOffsetX - (cursorOffsetX - panX) * ratio;
      panY = cursorOffsetY - (cursorOffsetY - panY) * ratio;
      zoom = nextZoom;
      updateTransform();
    }, { passive: false });

    wrap.addEventListener('mousedown', e => { isDragging = true; startX = e.clientX - panX; startY = e.clientY - panY; });
    window.addEventListener('mousemove', e => { if (!isDragging) return; panX = e.clientX - startX; panY = e.clientY - startY; updateTransform(); });
    window.addEventListener('mouseup', () => { isDragging = false; });

    document.getElementById('btn-fit').addEventListener('click', fitToWindow);
    document.getElementById('btn-100').addEventListener('click', () => { zoom = 1; panX = 0; panY = 0; updateTransform(); });

    function resolveNodeId(el) {
      const g = el.closest('g.node, g.actor, g.statediagram-state');
      if (!g) return null;
      const domId = g.getAttribute('id') || '';
      const dataId = g.getAttribute('data-id') || '';
      if (dataId && nodeMap.has(dataId)) return dataId;
      const text = (g.textContent || '').replace(/\\s+/g, ' ').trim();
      const sorted = [...GRAPH.nodes].sort((a, b) => b.id.length - a.id.length);
      for (const n of sorted) {
        const rx = new RegExp('(?:^|[-_])' + n.id.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '(?:[-_]\\\\d+|$)', 'i');
        if (rx.test(domId)) return n.id;
      }
      for (const n of GRAPH.nodes) {
        if (n.label === text || n.id === text) return n.id;
      }
      return null;
    }

    function matchesEdge(el, edgeList) {
      const meta = (el.getAttribute('id') || '') + ' ' + (el.getAttribute('data-id') || '') + ' ' + (el.getAttribute('class') || '');
      for (const e of edgeList) {
        if (meta.includes('-' + e.from + '-' + e.to + '-') || meta.includes('_' + e.from + '_' + e.to + '_') || meta.includes('L_' + e.from + '_' + e.to) || meta.includes('L-' + e.from + '-' + e.to)) {
          return true;
        }
      }
      return false;
    }

    function renderList(containerId, items) {
      const el = document.getElementById(containerId);
      el.innerHTML = '';
      if (!items.length) { el.textContent = 'Keine'; return; }
      items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'node-chip';
        btn.innerHTML = '<span>' + item.label + '</span><span class="badge">Fokus →</span>';
        btn.onclick = () => {
          selectNode(item.id, true);
        };
        el.appendChild(btn);
      });
    }

    function selectNode(targetId, shouldFocusCamera = false) {
      activeNodeId = targetId || '';
      selectEl.value = activeNodeId;
      const allSvgNodes = Array.from(document.querySelectorAll('g.node, g.actor, g.statediagram-state'));
      const allSvgEdges = Array.from(document.querySelectorAll('g.edgePaths > *, g.edgePath, path.flowchart-link'));
      const allSvgLabels = Array.from(document.querySelectorAll('g.edgeLabels > *, g.edgeLabel'));

      if (!activeNodeId || !nodeMap.has(activeNodeId)) {
        const q = (searchEl.value || '').trim().toLowerCase();
        allSvgNodes.forEach(g => {
          const nid = resolveNodeId(g);
          const nObj = nid ? nodeMap.get(nid) : null;
          const matchRole = roleFilter === 'all' || (nObj && nObj.role === roleFilter);
          const matchSearch = !q || (nObj && (nObj.label.toLowerCase().includes(q) || nObj.id.toLowerCase().includes(q)));
          g.style.opacity = (matchRole && matchSearch) ? '1' : dimOpacity;
        });
        allSvgEdges.forEach(e => e.style.opacity = (roleFilter === 'all' && !q) ? '1' : dimOpacity);
        allSvgLabels.forEach(l => l.style.opacity = (roleFilter === 'all' && !q) ? '1' : dimOpacity);

        document.getElementById('selected-info').innerHTML = 'Alle <strong>' + GRAPH.nodes.length + ' Knoten</strong> und <strong>' + GRAPH.edges.length + ' Verbindungen</strong> sichtbar.';
        const filterFn = n => {
          if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) return false;
          return true;
        };
        renderList('list-entries', GRAPH.nodes.filter(n => n.inDegree === 0 && filterFn(n)));
        renderList('list-callers', []);
        renderList('list-callees', []);
        renderList('list-terminals', GRAPH.nodes.filter(n => n.outDegree === 0 && filterFn(n)));
        return;
      }

      const up = new Set(), down = new Set();
      const qUp = [activeNodeId];
      while (qUp.length) {
        const c = qUp.shift();
        GRAPH.edges.forEach(e => { if (e.to === c && !up.has(e.from) && e.from !== activeNodeId) { up.add(e.from); qUp.push(e.from); } });
      }
      const qDown = [activeNodeId];
      while (qDown.length) {
        const c = qDown.shift();
        GRAPH.edges.forEach(e => { if (e.from === c && !down.has(e.to) && e.to !== activeNodeId) { down.add(e.to); qDown.push(e.to); } });
      }

      const visibleNodes = new Set([activeNodeId]);
      if (directionFilter === 'both' || directionFilter === 'upstream') up.forEach(id => visibleNodes.add(id));
      if (directionFilter === 'both' || directionFilter === 'downstream') down.forEach(id => visibleNodes.add(id));

      const upEdges = GRAPH.edges.filter(e => (up.has(e.from) || e.from === activeNodeId) && (up.has(e.to) || e.to === activeNodeId) && e.from !== activeNodeId);
      const downEdges = GRAPH.edges.filter(e => (down.has(e.from) || e.from === activeNodeId) && (down.has(e.to) || e.to === activeNodeId) && e.to !== activeNodeId);
      const visibleEdges = directionFilter === 'upstream' ? upEdges : directionFilter === 'downstream' ? downEdges : [...upEdges, ...downEdges];

      allSvgNodes.forEach(g => {
        const nid = resolveNodeId(g);
        g.style.opacity = (nid && visibleNodes.has(nid)) ? '1' : dimOpacity;
      });

      const activeIdx = new Set();
      allSvgEdges.forEach((edgeEl, idx) => {
        const ok = matchesEdge(edgeEl, visibleEdges);
        if (ok) activeIdx.add(idx);
        edgeEl.style.opacity = ok ? '1' : dimOpacity;
      });
      allSvgLabels.forEach((lblEl, idx) => {
        const ok = matchesEdge(lblEl, visibleEdges) || (allSvgLabels.length === allSvgEdges.length && activeIdx.has(idx));
        lblEl.style.opacity = ok ? '1' : dimOpacity;
      });

      const nodeObj = nodeMap.get(activeNodeId);
      const dirText = directionFilter === 'upstream' ? 'Nur Woher (Aufrufer)' : directionFilter === 'downstream' ? 'Nur Wohin (Folgeschritte)' : 'Ganzer Pfad';
      document.getElementById('selected-info').innerHTML = 'Fokus: <strong style="color:#fbbf24">' + nodeObj.label + '</strong><br/><span style="font-size:11px;color:#94a3b8;">Filter: ' + dirText + ' · ' + visibleNodes.size + ' Knoten sichtbar</span>';

      renderList('list-entries', directionFilter === 'downstream' ? [] : Array.from(up).map(id => nodeMap.get(id)).filter(n => n && n.inDegree === 0));
      renderList('list-callers', directionFilter === 'downstream' ? [] : GRAPH.edges.filter(e => e.to === activeNodeId).map(e => nodeMap.get(e.from)).filter(Boolean));
      renderList('list-callees', directionFilter === 'upstream' ? [] : GRAPH.edges.filter(e => e.from === activeNodeId).map(e => nodeMap.get(e.to)).filter(Boolean));
      renderList('list-terminals', directionFilter === 'upstream' ? [] : Array.from(down).map(id => nodeMap.get(id)).filter(n => n && n.outDegree === 0));

      if (shouldFocusCamera && autoFocusEl.checked) {
        focusNodeCamera(activeNodeId);
      }
    }

    document.querySelectorAll('#dir-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#dir-group .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        directionFilter = btn.getAttribute('data-dir');
        selectNode(activeNodeId, false);
      });
    });

    document.querySelectorAll('#role-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#role-chips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        roleFilter = chip.getAttribute('data-role');
        populateSelect();
        selectNode(activeNodeId, false);
      });
    });

    searchEl.addEventListener('input', () => {
      populateSelect();
      if (!activeNodeId) selectNode('', false);
    });

    dimSelectEl.addEventListener('change', e => {
      dimOpacity = e.target.value;
      selectNode(activeNodeId, false);
    });

    document.querySelectorAll('g.node, g.actor, g.statediagram-state').forEach(g => {
      g.style.cursor = 'pointer';
      g.addEventListener('click', e => {
        e.stopPropagation();
        const nid = resolveNodeId(g);
        if (nid) selectNode(nid, false);
      });
    });

    selectEl.addEventListener('change', e => selectNode(e.target.value, true));
    document.getElementById('btn-reset').addEventListener('click', () => {
      searchEl.value = '';
      roleFilter = 'all';
      directionFilter = 'both';
      dimOpacity = '0.12';
      dimSelectEl.value = '0.12';
      document.querySelectorAll('#dir-group .seg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
      document.querySelectorAll('#role-chips .chip').forEach((c, i) => c.classList.toggle('active', i === 0));
      populateSelect();
      selectNode('', false);
    });

    populateSelect();
    selectNode('', false);
  </script>
</body>
</html>`;
}
