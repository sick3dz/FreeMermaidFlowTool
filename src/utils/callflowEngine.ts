import {
  CallflowCycleEdge,
  CallflowDirectionFilter,
  CallflowEdge,
  CallflowGraph,
  CallflowHealthFinding,
  CallflowHopDepth,
  CallflowNode,
  CallflowNodeRole,
  CallflowOpenIssue,
  CallflowResourceRegistry,
  CallflowRoutingMatrixRow,
  CallflowScheduleSummaryRow,
  CallflowScriptParameterItem,
  CallflowTraceResult,
  NodePositionOffset,
  PathColorMode,
  SmartColorNodeType,
} from '../types/mermaidStudio';
import { toMermaidNodeSuffix } from './scriptCallflowParser';
import { sanitizeSvgForXmlParser } from './mermaidEngine';
import {
  applyColorToEdgePathAndMarkers,
  SEMANTIC_PALETTES,
  SMART_COLOR_NODE_TYPE_OPTIONS,
} from './smartColorEngine';

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

const MAX_GRAPH_CACHE_ENTRIES = 120;
const parsedCallflowGraphCache = new Map<string, CallflowGraph>();

function computeGraphCacheHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(36)}_${input.length}`;
}

/**
 * Parses Mermaid code locally into a directed CallflowGraph (nodes, edges, degrees, roles).
 * Supports Flowchart (`-->`, `-.->`, `==>`, `<-->`), Sequence (`->>`, `-->>`), State (`-->`), etc.
 */
export function parseCallflowGraph(code: string): CallflowGraph {
  const cacheKey = computeGraphCacheHash(code);
  const cachedGraph = parsedCallflowGraphCache.get(cacheKey);
  if (cachedGraph) {
    parsedCallflowGraphCache.delete(cacheKey);
    parsedCallflowGraphCache.set(cacheKey, cachedGraph);
    return cachedGraph;
  }

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

  const result: CallflowGraph = {
    nodes,
    edges,
    entryNodes,
    hubNodes,
    terminalNodes,
  };

  parsedCallflowGraphCache.set(cacheKey, result);
  if (parsedCallflowGraphCache.size > MAX_GRAPH_CACHE_ENTRIES) {
    const oldestKey = parsedCallflowGraphCache.keys().next().value;
    if (oldestKey !== undefined) {
      parsedCallflowGraphCache.delete(oldestKey);
    }
  }

  return result;
}

/**
 * Traces the complete upstream (Entry -> Caller) and downstream (Callee -> Terminal) call chain
 * for a selected node ID using Breadth-First Search (BFS), recording hop depths and cycle back-edges.
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

  const cycleEdges: CallflowCycleEdge[] = [];
  const cycleKeySet = new Set<string>();
  const registerCycle = (edge: CallflowEdge, direction: 'upstream' | 'downstream') => {
    const key = `${direction}:${edge.from}->${edge.to}:${edge.label}`;
    if (cycleKeySet.has(key)) return;
    cycleKeySet.add(key);
    cycleEdges.push({
      from: edge.from,
      to: edge.to,
      fromLabel: graph.nodes.get(edge.from)?.label || edge.from,
      toLabel: graph.nodes.get(edge.to)?.label || edge.to,
      label: edge.label,
      direction,
    });
  };

  // 2. Upstream BFS (hop distances + reachable subgraph edges)
  const upstreamNodeIds = new Set<string>();
  const upstreamDepthByNodeId = new Map<string, number>([[targetNodeId, 0]]);
  const queueUp: Array<{ id: string; depth: number }> = [{ id: targetNodeId, depth: 0 }];
  const upstreamEdges: CallflowEdge[] = [];

  while (queueUp.length > 0) {
    const { id: curr, depth } = queueUp.shift()!;
    for (const edge of graph.edges) {
      if (edge.to !== curr) continue;
      upstreamEdges.push(edge);
      if (!upstreamDepthByNodeId.has(edge.from)) {
        const nextDepth = depth + 1;
        upstreamDepthByNodeId.set(edge.from, nextDepth);
        upstreamNodeIds.add(edge.from);
        queueUp.push({ id: edge.from, depth: nextDepth });
      }
    }
  }

  // 2b. True 3-color DFS back-edge detection on upstream subgraph (0=unvisited, 1=onStack, 2=done)
  // Prevents normal converging DAG branches from being falsely marked as red cycles
  const upState = new Map<string, 0 | 1 | 2>();
  const dfsUp = (u: string) => {
    upState.set(u, 1);
    for (const edge of graph.edges) {
      if (edge.to !== u) continue;
      const v = edge.from;
      const st = upState.get(v) || 0;
      if (st === 1) {
        registerCycle(edge, 'upstream');
      } else if (st === 0) {
        dfsUp(v);
      }
    }
    upState.set(u, 2);
  };
  dfsUp(targetNodeId);

  // 3. Downstream BFS (hop distances + reachable subgraph edges)
  const downstreamNodeIds = new Set<string>();
  const downstreamDepthByNodeId = new Map<string, number>([[targetNodeId, 0]]);
  const queueDown: Array<{ id: string; depth: number }> = [{ id: targetNodeId, depth: 0 }];
  const downstreamEdges: CallflowEdge[] = [];

  while (queueDown.length > 0) {
    const { id: curr, depth } = queueDown.shift()!;
    for (const edge of graph.edges) {
      if (edge.from !== curr) continue;
      downstreamEdges.push(edge);
      if (!downstreamDepthByNodeId.has(edge.to)) {
        const nextDepth = depth + 1;
        downstreamDepthByNodeId.set(edge.to, nextDepth);
        downstreamNodeIds.add(edge.to);
        queueDown.push({ id: edge.to, depth: nextDepth });
      }
    }
  }

  // 3b. True 3-color DFS back-edge detection on downstream subgraph
  const downState = new Map<string, 0 | 1 | 2>();
  const dfsDown = (u: string) => {
    downState.set(u, 1);
    for (const edge of graph.edges) {
      if (edge.from !== u) continue;
      const v = edge.to;
      const st = downState.get(v) || 0;
      if (st === 1) {
        registerCycle(edge, 'downstream');
      } else if (st === 0) {
        dfsDown(v);
      }
    }
    downState.set(u, 2);
  };
  dfsDown(targetNodeId);

  const activeNodeIds = new Set<string>([
    targetNodeId,
    ...upstreamNodeIds,
    ...downstreamNodeIds,
  ]);

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
    upstreamDepthByNodeId,
    downstreamDepthByNodeId,
    upstreamEdges,
    downstreamEdges,
    activeEdges,
    cycleEdges,
  };
}

/**
 * Computes active node IDs & edges filtered by direction and maximum hop depth.
 */
export function getFilteredTraceSubset(
  trace: CallflowTraceResult,
  directionFilter: CallflowDirectionFilter,
  hopDepth: CallflowHopDepth
): {
  visibleNodeIds: Set<string>;
  visibleEdges: CallflowEdge[];
  cycleEdgeKeys: Set<string>;
} {
  const maxHops = hopDepth === 'all' ? Number.POSITIVE_INFINITY : hopDepth;
  const visibleNodeIds = new Set<string>([trace.selectedNode.id]);

  if (directionFilter === 'both' || directionFilter === 'upstream') {
    trace.upstreamDepthByNodeId.forEach((d, id) => {
      if (d <= maxHops) visibleNodeIds.add(id);
    });
  }

  if (directionFilter === 'both' || directionFilter === 'downstream') {
    trace.downstreamDepthByNodeId.forEach((d, id) => {
      if (d <= maxHops) visibleNodeIds.add(id);
    });
  }

  const baseEdges =
    directionFilter === 'upstream'
      ? trace.upstreamEdges
      : directionFilter === 'downstream'
      ? trace.downstreamEdges
      : trace.activeEdges;

  const visibleEdges = baseEdges.filter((edge) => {
    if (!visibleNodeIds.has(edge.from) || !visibleNodeIds.has(edge.to)) return false;
    if (maxHops === Number.POSITIVE_INFINITY) return true;
    const upFrom = trace.upstreamDepthByNodeId.get(edge.from);
    const upTo = trace.upstreamDepthByNodeId.get(edge.to);
    const downFrom = trace.downstreamDepthByNodeId.get(edge.from);
    const downTo = trace.downstreamDepthByNodeId.get(edge.to);

    const validUp =
      (directionFilter === 'both' || directionFilter === 'upstream') &&
      upFrom !== undefined &&
      upTo !== undefined &&
      Math.max(upFrom, upTo) <= maxHops;
    const validDown =
      (directionFilter === 'both' || directionFilter === 'downstream') &&
      downFrom !== undefined &&
      downTo !== undefined &&
      Math.max(downFrom, downTo) <= maxHops;

    return validUp || validDown;
  });

  const cycleEdgeKeys = new Set(
    trace.cycleEdges.map((c) => `${c.from}->${c.to}`)
  );

  return { visibleNodeIds, visibleEdges, cycleEdgeKeys };
}

interface CompiledNodeIdMatcher {
  nodeId: string;
  regex: RegExp;
}

const nodeIdMatcherCache = new WeakMap<CallflowGraph, CompiledNodeIdMatcher[]>();

function getCompiledNodeIdMatchers(graph: CallflowGraph): CompiledNodeIdMatcher[] {
  const cached = nodeIdMatcherCache.get(graph);
  if (cached) return cached;
  const compiled = Array.from(graph.nodes.keys())
    .sort((a, b) => b.length - a.length)
    .map((nodeId) => {
      const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return {
        nodeId,
        regex: new RegExp(`(?:^|[-_])${escaped}(?:[-_]\\d+|$)`, 'i'),
      };
    });
  nodeIdMatcherCache.set(graph, compiled);
  return compiled;
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

  const fastNodeId = nodeGroup.getAttribute('data-callflow-node-id');
  if (fastNodeId && graph.nodes.has(fastNodeId)) {
    return fastNodeId;
  }

  const dataId = nodeGroup.getAttribute('data-id') || '';
  if (dataId && graph.nodes.has(dataId)) {
    return dataId;
  }

  // Check Mermaid's `flowchart-<NodeId>-<index>` DOM id convention using precompiled matchers
  const domId = nodeGroup.getAttribute('id') || '';
  if (domId) {
    const matchers = getCompiledNodeIdMatchers(graph);
    for (const item of matchers) {
      if (item.regex.test(domId)) {
        return item.nodeId;
      }
    }
  }

  // Fallback: match by exact node label text
  const textLabel = (nodeGroup.textContent || '').replace(/\s+/g, ' ').trim();
  if (textLabel) {
    for (const [nodeId, nodeObj] of graph.nodes.entries()) {
      if (nodeObj.label === textLabel || nodeId === textLabel) {
        return nodeId;
      }
    }
  }

  return null;
}

function getSvgEdgeElementMeta(el: Element): string {
  const nestedDataId =
    el.getAttribute('data-id') ||
    el.querySelector('[data-id]')?.getAttribute('data-id') ||
    '';
  return `${el.getAttribute('id') || ''} ${nestedDataId} ${el.getAttribute('class') || ''}`;
}

function createEdgeMetaMatcher(edge: CallflowEdge) {
  const fromEsc = edge.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const toEsc = edge.to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Mermaid 12 puts `LS_<from> LE_<to>` in class and `L_<from>_<to>_<counter>` in id/data-id
  const exactLsLeRegex = new RegExp(`(?:^|\\s)LS_${fromEsc}\\s+LE_${toEsc}(?:\\s|$)`);
  const exactLRegex = new RegExp(
    `(?:^|[-\\s])L[-_]${fromEsc}[-_]${toEsc}(?:[-_]\\d+(?:[-_]\\d+)?)?(?=$|\\s)`,
    'i'
  );
  const genericPattern = new RegExp(
    `(?:^|[-_L\\s])${fromEsc}[-_]${toEsc}(?:[-_]\\d+|\\s|$)`,
    'i'
  );
  return {
    edge,
    score: edge.from.length + edge.to.length,
    matches(meta: string): boolean {
      return (
        exactLsLeRegex.test(meta) ||
        exactLRegex.test(meta) ||
        genericPattern.test(meta) ||
        meta.includes(`-${edge.from}-${edge.to}-`) ||
        meta.includes(`_${edge.from}_${edge.to}_`)
      );
    },
  };
}

/**
 * Checks whether an SVG edge element belongs to any edge in `allowedEdges` (works for Dagre & ELK).
 */
function matchesSvgEdge(edgeEl: Element, allowedEdges: CallflowEdge[]): boolean {
  const edgeMeta = getSvgEdgeElementMeta(edgeEl);
  for (const activeEdge of allowedEdges) {
    if (createEdgeMetaMatcher(activeEdge).matches(edgeMeta)) {
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
  directionFilter: CallflowDirectionFilter = 'both',
  hopDepth: CallflowHopDepth = 'all'
): string {
  if (!trace) return svgString;

  const parser = new DOMParser();
  const safeSvg = sanitizeSvgForXmlParser(svgString);
  const doc = parser.parseFromString(safeSvg, 'image/svg+xml');
  const svgEl = doc.querySelector('parsererror') ? null : doc.querySelector('svg');
  if (!svgEl) return safeSvg;

  const isDark = canvasSurface === 'dark';

  const { visibleNodeIds, visibleEdges, cycleEdgeKeys } = getFilteredTraceSubset(
    trace,
    directionFilter,
    hopDepth
  );

  const cycleOnlyEdges = visibleEdges.filter((e) =>
    cycleEdgeKeys.has(`${e.from}->${e.to}`)
  );
  const downstreamEdgeKeySet = new Set(
    trace.downstreamEdges.map((e) => `${e.from}->${e.to}`)
  );
  const downstreamVisibleEdges = visibleEdges.filter(
    (e) => !cycleEdgeKeys.has(`${e.from}->${e.to}`) && downstreamEdgeKeySet.has(`${e.from}->${e.to}`)
  );

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
    const isCycleEdge =
      isEdgeOnActivePath &&
      cycleOnlyEdges.length > 0 &&
      matchesSvgEdge(edgeEl, cycleOnlyEdges);
    const isDownstreamEdge =
      isEdgeOnActivePath &&
      !isCycleEdge &&
      (directionFilter === 'downstream' ||
        (directionFilter === 'both' &&
          downstreamVisibleEdges.length > 0 &&
          matchesSvgEdge(edgeEl, downstreamVisibleEdges)));

    if (isEdgeOnActivePath) {
      activeEdgeIndices.add(idx);
      (edgeEl as SVGElement).style.opacity = '1';
      const pathNodes =
        edgeEl.tagName.toLowerCase() === 'path'
          ? [edgeEl]
          : Array.from(edgeEl.querySelectorAll('path'));
      const activeStroke = isCycleEdge
        ? isDark
          ? '#fb7185'
          : '#e11d48'
        : isDownstreamEdge
        ? isDark
          ? '#34d399'
          : '#059669'
        : isDark
        ? '#38bdf8'
        : '#0284c7';
      pathNodes.forEach((p) => {
        applyColorToEdgePathAndMarkers(svgEl, p as SVGElement, activeStroke);
        (p as SVGElement).style.strokeWidth = isCycleEdge ? '2.6px' : '3px';
        if (isCycleEdge) {
          (p as SVGElement).style.strokeDasharray = '6 4';
        }
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

function parseTranslateFromTransform(transformAttr: string | null): { x: number; y: number; rest: string } {
  if (!transformAttr) return { x: 0, y: 0, rest: '' };
  const match = transformAttr.match(/translate\(\s*([+-]?\d+(?:\.\d+)?)(?:[\s,]+([+-]?\d+(?:\.\d+)?))?\s*\)/i);
  if (!match) {
    return { x: 0, y: 0, rest: transformAttr.trim() };
  }
  const x = parseFloat(match[1] || '0');
  const y = parseFloat(match[2] || '0');
  const rest = transformAttr.replace(match[0], '').trim();
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    rest,
  };
}

interface NormalizedSvgPath {
  parts: string[];
  pairs: Array<{
    xIdx: number;
    yIdx: number;
    xPrefix: string;
    yPrefix: string;
    origX: number;
    origY: number;
    t: number;
  }>;
  startPt: { x: number; y: number };
  endPt: { x: number; y: number };
  prevPt: { x: number; y: number };
  prevPairIdx: number;
}

/**
 * Normalizes any SVG path (`M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t, A/a, Z/z`) into explicit
 * absolute `(x, y)` coordinates so orthogonal Mermaid edge segments stay cleanly docked during drag & export.
 */
function normalizeSvgPathToAbsolute(origD: string): NormalizedSvgPath {
  const tokenRegex = /([A-Za-z])|([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi;
  const rawTokens: Array<{ type: 'cmd' | 'num'; raw: string; val?: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(origD)) !== null) {
    if (m[1]) {
      rawTokens.push({ type: 'cmd', raw: m[1] });
    } else if (m[2]) {
      rawTokens.push({ type: 'num', raw: m[2], val: parseFloat(m[2]) });
    }
  }

  const outTokens: Array<{ type: 'cmd' | 'num'; raw: string; val?: number; isPairX?: boolean; isPairY?: boolean }> = [];
  let curX = 0;
  let curY = 0;
  let subStartX = 0;
  let subStartY = 0;
  let currentCmd = 'M';
  let idx = 0;

  const pushNum = (n: number, isPairX = false, isPairY = false) => {
    const rounded = Number(n.toFixed(2));
    outTokens.push({ type: 'num', raw: rounded.toString(), val: rounded, isPairX, isPairY });
  };

  while (idx < rawTokens.length) {
    const tk = rawTokens[idx];
    if (tk.type === 'cmd') {
      currentCmd = tk.raw;
      idx++;
      if (currentCmd.toUpperCase() === 'Z') {
        outTokens.push({ type: 'cmd', raw: 'Z' });
        curX = subStartX;
        curY = subStartY;
      }
      continue;
    }

    const upper = currentCmd.toUpperCase();
    const isRel = currentCmd !== upper;
    const baseX = isRel ? curX : 0;
    const baseY = isRel ? curY : 0;

    if (upper === 'M' && idx + 1 < rawTokens.length && rawTokens[idx + 1].type === 'num') {
      const nx = baseX + (rawTokens[idx].val ?? 0);
      const ny = baseY + (rawTokens[idx + 1].val ?? 0);
      outTokens.push({ type: 'cmd', raw: 'M' });
      pushNum(nx, true, false);
      pushNum(ny, false, true);
      curX = nx;
      curY = ny;
      subStartX = nx;
      subStartY = ny;
      // Subsequent pairs after M act as implicit L
      currentCmd = isRel ? 'l' : 'L';
      idx += 2;
    } else if ((upper === 'L' || upper === 'T') && idx + 1 < rawTokens.length && rawTokens[idx + 1].type === 'num') {
      const nx = baseX + (rawTokens[idx].val ?? 0);
      const ny = baseY + (rawTokens[idx + 1].val ?? 0);
      outTokens.push({ type: 'cmd', raw: upper });
      pushNum(nx, true, false);
      pushNum(ny, false, true);
      curX = nx;
      curY = ny;
      idx += 2;
    } else if (upper === 'H') {
      const nx = baseX + (rawTokens[idx].val ?? 0);
      outTokens.push({ type: 'cmd', raw: 'L' });
      pushNum(nx, true, false);
      pushNum(curY, false, true);
      curX = nx;
      idx += 1;
    } else if (upper === 'V') {
      const ny = baseY + (rawTokens[idx].val ?? 0);
      outTokens.push({ type: 'cmd', raw: 'L' });
      pushNum(curX, true, false);
      pushNum(ny, false, true);
      curY = ny;
      idx += 1;
    } else if (upper === 'C' && idx + 5 < rawTokens.length) {
      const x1 = baseX + (rawTokens[idx].val ?? 0);
      const y1 = baseY + (rawTokens[idx + 1].val ?? 0);
      const x2 = baseX + (rawTokens[idx + 2].val ?? 0);
      const y2 = baseY + (rawTokens[idx + 3].val ?? 0);
      const nx = baseX + (rawTokens[idx + 4].val ?? 0);
      const ny = baseY + (rawTokens[idx + 5].val ?? 0);
      outTokens.push({ type: 'cmd', raw: 'C' });
      pushNum(x1, true, false);
      pushNum(y1, false, true);
      pushNum(x2, true, false);
      pushNum(y2, false, true);
      pushNum(nx, true, false);
      pushNum(ny, false, true);
      curX = nx;
      curY = ny;
      idx += 6;
    } else if ((upper === 'S' || upper === 'Q') && idx + 3 < rawTokens.length) {
      const x1 = baseX + (rawTokens[idx].val ?? 0);
      const y1 = baseY + (rawTokens[idx + 1].val ?? 0);
      const nx = baseX + (rawTokens[idx + 2].val ?? 0);
      const ny = baseY + (rawTokens[idx + 3].val ?? 0);
      outTokens.push({ type: 'cmd', raw: upper });
      pushNum(x1, true, false);
      pushNum(y1, false, true);
      pushNum(nx, true, false);
      pushNum(ny, false, true);
      curX = nx;
      curY = ny;
      idx += 4;
    } else if (upper === 'A' && idx + 6 < rawTokens.length) {
      const rx = rawTokens[idx].val ?? 0;
      const ry = rawTokens[idx + 1].val ?? 0;
      const rot = rawTokens[idx + 2].val ?? 0;
      const laf = rawTokens[idx + 3].val ?? 0;
      const sf = rawTokens[idx + 4].val ?? 0;
      const nx = baseX + (rawTokens[idx + 5].val ?? 0);
      const ny = baseY + (rawTokens[idx + 6].val ?? 0);
      outTokens.push({ type: 'cmd', raw: 'A' });
      pushNum(rx);
      pushNum(ry);
      pushNum(rot);
      pushNum(laf);
      pushNum(sf);
      pushNum(nx, true, false);
      pushNum(ny, false, true);
      curX = nx;
      curY = ny;
      idx += 7;
    } else {
      idx++;
    }
  }

  const parts: string[] = [];
  const prefixes: string[] = [];
  for (let k = 0; k < outTokens.length; k++) {
    const tk = outTokens[k];
    const prev = k > 0 ? outTokens[k - 1] : null;
    const prefix =
      k === 0 ? '' : tk.type === 'cmd' ? ' ' : prev && prev.type === 'cmd' ? '' : ',';
    prefixes.push(prefix);
    parts.push(prefix + tk.raw);
  }

  const rawPairs: Array<{ xIdx: number; yIdx: number; origX: number; origY: number }> = [];
  for (let k = 0; k + 1 < outTokens.length; k++) {
    if (outTokens[k].isPairX && outTokens[k + 1].isPairY) {
      rawPairs.push({
        xIdx: k,
        yIdx: k + 1,
        origX: outTokens[k].val ?? 0,
        origY: outTokens[k + 1].val ?? 0,
      });
    }
  }

  const totalPairs = rawPairs.length;
  const pairs = rawPairs.map((p, pIdx) => ({
    xIdx: p.xIdx,
    yIdx: p.yIdx,
    xPrefix: prefixes[p.xIdx],
    yPrefix: prefixes[p.yIdx],
    origX: p.origX,
    origY: p.origY,
    t: totalPairs <= 1 ? 0 : pIdx / (totalPairs - 1),
  }));

  const startPt =
    pairs.length > 0 ? { x: pairs[0].origX, y: pairs[0].origY } : { x: 0, y: 0 };
  const endPt =
    pairs.length > 0
      ? { x: pairs[pairs.length - 1].origX, y: pairs[pairs.length - 1].origY }
      : { x: 0, y: 0 };

  // Find a previous anchor distinctly away from endPt so endpoint vector direction is accurate
  let prevPairIdx = Math.max(0, pairs.length - 2);
  let prevPt = startPt;
  for (let pIdx = pairs.length - 2; pIdx >= 0; pIdx--) {
    const candidate = { x: pairs[pIdx].origX, y: pairs[pIdx].origY };
    if (Math.hypot(endPt.x - candidate.x, endPt.y - candidate.y) > 4) {
      prevPt = candidate;
      prevPairIdx = pIdx;
      break;
    }
  }

  return { parts, pairs, startPt, endPt, prevPt, prevPairIdx };
}

function shiftAbsoluteSvgPathD(
  d: string,
  dxFrom: number,
  dyFrom: number,
  dxTo: number,
  dyTo: number
): string {
  const norm = normalizeSvgPathToAbsolute(d);
  if (norm.pairs.length === 0) return d;

  for (const pair of norm.pairs) {
    const shiftX = dxFrom * (1 - pair.t) + dxTo * pair.t;
    const shiftY = dyFrom * (1 - pair.t) + dyTo * pair.t;
    norm.parts[pair.xIdx] = `${pair.xPrefix}${Number((pair.origX + shiftX).toFixed(2))}`;
    norm.parts[pair.yIdx] = `${pair.yPrefix}${Number((pair.origY + shiftY).toFixed(2))}`;
  }
  return norm.parts.join('');
}

/**
 * Applies user-defined Drag & Drop node position offsets (`{ dx, dy }`) directly to the rendered
 * Mermaid SVG so manual node arrangements persist across re-renders, PNG exports, SVG exports,
 * and Interactive HTML exports. Also injects interactive connection ports when `isVisualEditMode` is active.
 */
export function applyNodeOffsetsToSvg(
  svgString: string,
  nodeOffsets: Record<string, NodePositionOffset> | undefined,
  graph: CallflowGraph,
  isVisualEditMode: boolean = false
): string {
  const hasOffsets =
    nodeOffsets &&
    Object.values(nodeOffsets).some(
      (off) => off && (Math.abs(off.dx) > 0.5 || Math.abs(off.dy) > 0.5)
    );

  if (!hasOffsets && !isVisualEditMode) {
    return svgString;
  }

  const parser = new DOMParser();
  const safeSvg = sanitizeSvgForXmlParser(svgString);
  const doc = parser.parseFromString(safeSvg, 'image/svg+xml');
  const svgEl = doc.querySelector('parsererror') ? null : doc.querySelector('svg');
  if (!svgEl) return safeSvg;

  const activeOffsets = nodeOffsets || {};
  const nodeGroups = Array.from(
    svgEl.querySelectorAll('g.node, g.actor, g.statediagram-state, g.classGroup')
  );

  let minDeltaX = 0;
  let maxDeltaX = 0;
  let minDeltaY = 0;
  let maxDeltaY = 0;

  nodeGroups.forEach((nodeGroup) => {
    const matchedId = resolveClickedNodeIdFromSvgElement(nodeGroup, graph);
    if (!matchedId) return;

    nodeGroup.setAttribute('data-callflow-node-id', matchedId);
    const off = activeOffsets[matchedId];
    if (off && (Math.abs(off.dx) > 0.5 || Math.abs(off.dy) > 0.5)) {
      const { x, y, rest } = parseTranslateFromTransform(nodeGroup.getAttribute('transform'));
      const nextX = Number((x + off.dx).toFixed(2));
      const nextY = Number((y + off.dy).toFixed(2));
      nodeGroup.setAttribute(
        'transform',
        `translate(${nextX}, ${nextY})${rest ? ` ${rest}` : ''}`
      );
      nodeGroup.setAttribute('data-offset-dx', String(off.dx));
      nodeGroup.setAttribute('data-offset-dy', String(off.dy));
      if (off.dx < minDeltaX) minDeltaX = off.dx;
      if (off.dx > maxDeltaX) maxDeltaX = off.dx;
      if (off.dy < minDeltaY) minDeltaY = off.dy;
      if (off.dy > maxDeltaY) maxDeltaY = off.dy;
    }

    if (isVisualEditMode) {
      (nodeGroup as SVGElement).style.cursor = 'move';
      // Determine approximate right-hand side for the connection port handle across rect/polygon/path nodes
      const rectEl = nodeGroup.querySelector('rect');
      const polyEl = !rectEl ? nodeGroup.querySelector('polygon') : null;
      let portX = 72;
      let portY = 0;
      if (rectEl) {
        const rx = parseFloat(rectEl.getAttribute('x') || '0');
        const rw = parseFloat(rectEl.getAttribute('width') || '120');
        const ry = parseFloat(rectEl.getAttribute('y') || '0');
        const rh = parseFloat(rectEl.getAttribute('height') || '44');
        if (Number.isFinite(rx) && Number.isFinite(rw)) {
          portX = rx + rw / 2;
        }
        if (Number.isFinite(ry) && Number.isFinite(rh)) {
          portY = ry + rh / 2;
        }
      } else if (polyEl) {
        const ptsAttr = polyEl.getAttribute('points') || '';
        const nums = ptsAttr
          .trim()
          .split(/[\s,]+/)
          .map((n) => parseFloat(n))
          .filter((n) => Number.isFinite(n));
        if (nums.length >= 4) {
          let minX = Infinity;
          let maxX = -Infinity;
          let minY = Infinity;
          let maxY = -Infinity;
          for (let i = 0; i + 1 < nums.length; i += 2) {
            minX = Math.min(minX, nums[i]);
            maxX = Math.max(maxX, nums[i]);
            minY = Math.min(minY, nums[i + 1]);
            maxY = Math.max(maxY, nums[i + 1]);
          }
          if (Number.isFinite(minX) && Number.isFinite(maxX)) {
            portX = minX < 0 ? maxX : (maxX - minX) / 2;
            portY = minY < 0 && maxY > 0 ? (minY + maxY) / 2 : 0;
          }
        }
      }
      if (!nodeGroup.querySelector('.callflow-connect-port')) {
        const portGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        portGroup.setAttribute('class', 'callflow-connect-port');
        portGroup.setAttribute('data-port-node-id', matchedId);
        portGroup.setAttribute('transform', `translate(${Number(portX.toFixed(1))}, ${Number(portY.toFixed(1))})`);
        portGroup.setAttribute('style', 'cursor: crosshair;');

        const portTitle = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
        portTitle.textContent = 'Ziehen, um neue Verbindung zu einem Ziel-Knoten zu knüpfen (Doppelklick auf Knoten = Text bearbeiten)';
        portGroup.appendChild(portTitle);

        const outerCircle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
        outerCircle.setAttribute('r', '7');
        outerCircle.setAttribute('fill', '#4f46e5');
        outerCircle.setAttribute('stroke', '#e0e7ff');
        outerCircle.setAttribute('stroke-width', '2');
        outerCircle.setAttribute('data-port-node-id', matchedId);
        portGroup.appendChild(outerCircle);

        const innerDot = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
        innerDot.setAttribute('r', '2.5');
        innerDot.setAttribute('fill', '#ffffff');
        innerDot.setAttribute('data-port-node-id', matchedId);
        portGroup.appendChild(innerDot);

        nodeGroup.appendChild(portGroup);
      }
    }
  });

  if (hasOffsets) {
    // Shift connected edges and edge labels
    const edgeElements = Array.from(
      svgEl.querySelectorAll('g.edgePaths > *, g.edgePath, path.flowchart-link')
    ).filter(
      (el) =>
        !el.classList.contains('callflow-edge-hit') &&
        !(el.tagName.toLowerCase() === 'path' && el.parentElement?.classList.contains('edgePath'))
    );
    const edgeLabelElements = Array.from(
      svgEl.querySelectorAll('g.edgeLabels > *, g.edgeLabel')
    );

    const exportMatchers = graph.edges
      .map((e) => createEdgeMetaMatcher(e))
      .sort((a, b) => b.score - a.score);

    edgeElements.forEach((edgeEl, idx) => {
      const meta = getSvgEdgeElementMeta(edgeEl);
      const matchedEdge = exportMatchers.find((m) => m.matches(meta))?.edge;
      if (!matchedEdge) return;
      const fromOff = activeOffsets[matchedEdge.from] || { dx: 0, dy: 0 };
      const toOff = activeOffsets[matchedEdge.to] || { dx: 0, dy: 0 };
      if (
        Math.abs(fromOff.dx) <= 0.5 &&
        Math.abs(fromOff.dy) <= 0.5 &&
        Math.abs(toOff.dx) <= 0.5 &&
        Math.abs(toOff.dy) <= 0.5
      ) {
        return;
      }

      const paths =
        edgeEl.tagName.toLowerCase() === 'path'
          ? [edgeEl]
          : Array.from(edgeEl.querySelectorAll('path'));
      paths.forEach((p) => {
        const origD = p.getAttribute('d');
        if (!origD) return;
        p.setAttribute(
          'd',
          shiftAbsoluteSvgPathD(origD, fromOff.dx, fromOff.dy, toOff.dx, toOff.dy)
        );
      });

      // Shift corresponding edgeLabel by midpoint offset
      const midDx = (fromOff.dx + toOff.dx) / 2;
      const midDy = (fromOff.dy + toOff.dy) / 2;
      const labelEl =
        edgeLabelElements.find((l) => matchesSvgEdge(l, [matchedEdge])) ||
        (edgeLabelElements.length === edgeElements.length ? edgeLabelElements[idx] : null);
      if (labelEl && (Math.abs(midDx) > 0.5 || Math.abs(midDy) > 0.5)) {
        const { x, y, rest } = parseTranslateFromTransform(labelEl.getAttribute('transform'));
        labelEl.setAttribute(
          'transform',
          `translate(${Number((x + midDx).toFixed(2))}, ${Number((y + midDy).toFixed(2))})${
            rest ? ` ${rest}` : ''
          }`
        );
      }
    });

    // Expand SVG viewBox if nodes were dragged outside original bounds
    const vbAttr = svgEl.getAttribute('viewBox');
    if (vbAttr) {
      const parts = vbAttr
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        const padLeft = minDeltaX < 0 ? Math.abs(minDeltaX) + 40 : 0;
        const padTop = minDeltaY < 0 ? Math.abs(minDeltaY) + 40 : 0;
        const padRight = maxDeltaX > 0 ? maxDeltaX + 40 : 0;
        const padBottom = maxDeltaY > 0 ? maxDeltaY + 40 : 0;
        if (padLeft > 0 || padTop > 0 || padRight > 0 || padBottom > 0) {
          const nextMinX = Math.floor(parts[0] - padLeft);
          const nextMinY = Math.floor(parts[1] - padTop);
          const nextW = Math.ceil(parts[2] + padLeft + padRight);
          const nextH = Math.ceil(parts[3] + padTop + padBottom);
          svgEl.setAttribute('viewBox', `${nextMinX} ${nextMinY} ${nextW} ${nextH}`);
        }
      }
    }
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(svgEl);
}

// ============================================================================
// High-Performance Live SVG DOM Index (zero DOMParser / XMLSerializer on Pan/Select/Drag)
// ============================================================================

export type PortSide = 'top' | 'right' | 'bottom' | 'left';

export interface SelectedCallflowEdge {
  from: string;
  to: string;
  label: string;
}

interface ParsedLivePathData {
  pathEl: SVGPathElement;
  origD: string;
  origStrokeAttr: string | null;
  origDasharrayAttr: string | null;
  origMarkerEndAttr: string | null;
  origMarkerStartAttr: string | null;
  origStyleStroke: string;
  origStyleStrokeWidth: string;
  origStyleDasharray: string;
  origStyleMarkerEnd: string;
  origStyleMarkerStart: string;
  parts: string[];
  pairs: Array<{
    xIdx: number;
    yIdx: number;
    xPrefix: string;
    yPrefix: string;
    origX: number;
    origY: number;
    t: number;
  }>;
  startPt: { x: number; y: number };
  endPt: { x: number; y: number };
  prevPt: { x: number; y: number };
  prevPairIdx: number;
}

export interface LiveSvgPortHandle {
  side: PortSide;
  localX: number;
  localY: number;
  el: SVGGElement | null;
}

export interface NodeLocalBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
}

export interface LiveSvgNodeHandle {
  nodeId: string;
  groupEl: SVGGElement;
  baseTx: number;
  baseTy: number;
  currentDx: number;
  currentDy: number;
  restTransform: string;
  box: NodeLocalBox;
  occupiedPortCounts: Record<PortSide, number>;
  shapeEls: SVGElement[];
  origShapeStyles: Array<{
    fillAttr: string | null;
    strokeAttr: string | null;
    styleFill: string;
    styleStroke: string;
    styleStrokeWidth: string;
  }>;
  textEls: SVGElement[];
  origTextStyles: Array<{
    fillAttr: string | null;
    styleFill: string;
  }>;
  htmlEls: HTMLElement[];
  origHtmlStyles: Array<{
    color: string;
    fontWeight: string;
  }>;
  portsMaterialized: boolean;
  ports: Record<PortSide, LiveSvgPortHandle>;
}

export interface LiveSvgEdgeHandle {
  from: string;
  to: string;
  labelText: string;
  edgeEl: SVGElement;
  edgeTx: number;
  edgeTy: number;
  origOpacity: string;
  paths: ParsedLivePathData[];
  hitPaths: ParsedLivePathData[];
  labelEl: SVGElement | null;
  origLabelOpacity: string;
  labelBaseTx: number;
  labelBaseTy: number;
  labelRestTransform: string;
  hasLockGeometry: boolean;
  lockPos: { x: number; y: number };
  lockEl: SVGGElement | null;
  origEndPt: { x: number; y: number };
  origPrevPt: { x: number; y: number };
  prevT: number;
}

export interface LiveSvgDomIndex {
  svgEl: SVGSVGElement;
  origViewBox: string | null;
  origVbParts: [number, number, number, number] | null;
  nodes: Map<string, LiveSvgNodeHandle>;
  allEdges: LiveSvgEdgeHandle[];
  edgesByNode: Map<string, LiveSvgEdgeHandle[]>;
  clusters: SVGElement[];
  locksLayerEl: SVGGElement | null;
  isVisualEditMode: boolean;
}

function parseLivePathTokens(pathEl: SVGPathElement): ParsedLivePathData {
  const origD = pathEl.getAttribute('d') || '';
  const origStrokeAttr = pathEl.getAttribute('stroke');
  const origDasharrayAttr = pathEl.getAttribute('stroke-dasharray');
  const origMarkerEndAttr = pathEl.getAttribute('marker-end');
  const origMarkerStartAttr = pathEl.getAttribute('marker-start');
  const origStyleStroke = pathEl.style.stroke || '';
  const origStyleStrokeWidth = pathEl.style.strokeWidth || '';
  const origStyleDasharray = pathEl.style.strokeDasharray || '';
  const origStyleMarkerEnd = pathEl.style.markerEnd || '';
  const origStyleMarkerStart = pathEl.style.markerStart || '';

  const norm = normalizeSvgPathToAbsolute(origD);

  return {
    pathEl,
    origD,
    origStrokeAttr,
    origDasharrayAttr,
    origMarkerEndAttr,
    origMarkerStartAttr,
    origStyleStroke,
    origStyleStrokeWidth,
    origStyleDasharray,
    origStyleMarkerEnd,
    origStyleMarkerStart,
    parts: norm.parts,
    pairs: norm.pairs,
    startPt: norm.startPt,
    endPt: norm.endPt,
    prevPt: norm.prevPt,
    prevPairIdx: norm.prevPairIdx,
  };
}

function getNodeLocalBox(
  nodeGroup: SVGGElement,
  shapeEls: SVGElement[]
): NodeLocalBox {
  for (const s of shapeEls) {
    try {
      const box = (s as SVGGraphicsElement).getBBox?.();
      if (box && Number.isFinite(box.width) && Number.isFinite(box.height) && box.width > 4 && box.height > 4) {
        const minX = box.x;
        const maxX = box.x + box.width;
        const minY = box.y;
        const maxY = box.y + box.height;
        return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
      }
    } catch {
      // ignore unmounted / hidden SVG getBBox edge cases
    }
  }

  const rectEl = nodeGroup.querySelector('rect');
  if (rectEl) {
    const rx = parseFloat(rectEl.getAttribute('x') || '-60');
    const rw = parseFloat(rectEl.getAttribute('width') || '120');
    const ry = parseFloat(rectEl.getAttribute('y') || '-22');
    const rh = parseFloat(rectEl.getAttribute('height') || '44');
    if (Number.isFinite(rx) && Number.isFinite(rw) && Number.isFinite(ry) && Number.isFinite(rh)) {
      return { minX: rx, maxX: rx + rw, minY: ry, maxY: ry + rh, cx: rx + rw / 2, cy: ry + rh / 2 };
    }
  }

  const polyEl = nodeGroup.querySelector('polygon');
  if (polyEl) {
    const nums = (polyEl.getAttribute('points') || '')
      .trim()
      .split(/[\s,]+/)
      .map((n) => parseFloat(n))
      .filter((n) => Number.isFinite(n));
    if (nums.length >= 4) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        minX = Math.min(minX, nums[i]);
        maxX = Math.max(maxX, nums[i]);
        minY = Math.min(minY, nums[i + 1]);
        maxY = Math.max(maxY, nums[i + 1]);
      }
      if (Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minY) && Number.isFinite(maxY)) {
        return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
      }
    }
  }

  return { minX: -68, maxX: 68, minY: -24, maxY: 24, cx: 0, cy: 0 };
}

function createPortMetadataFromBox(box: NodeLocalBox): Record<PortSide, LiveSvgPortHandle> {
  // Place ports slightly outside the node border (+6px) so they never sit directly on top of arrowheads
  const rimPad = 6;
  return {
    top: { side: 'top', localX: box.cx, localY: box.minY - rimPad, el: null },
    right: { side: 'right', localX: box.maxX + rimPad, localY: box.cy, el: null },
    bottom: { side: 'bottom', localX: box.cx, localY: box.maxY + rimPad, el: null },
    left: { side: 'left', localX: box.minX - rimPad, localY: box.cy, el: null },
  };
}

function buildSinglePortElement(
  doc: Document,
  svgNs: string,
  nodeId: string,
  port: LiveSvgPortHandle,
  occupiedCount: number,
  isVisualEditMode: boolean
): SVGGElement {
  const portGroup = doc.createElementNS(svgNs, 'g') as SVGGElement;
  portGroup.setAttribute('class', 'callflow-connect-port');
  portGroup.setAttribute('data-port-node-id', nodeId);
  portGroup.setAttribute('data-port-side', port.side);
  portGroup.setAttribute('data-port-occupied', occupiedCount > 0 ? 'true' : 'false');
  portGroup.setAttribute(
    'transform',
    `translate(${Number(port.localX.toFixed(1))}, ${Number(port.localY.toFixed(1))})`
  );
  portGroup.setAttribute('style', 'cursor: crosshair;');
  portGroup.style.display = isVisualEditMode ? '' : 'none';

  const portTitle = doc.createElementNS(svgNs, 'title');
  portTitle.textContent =
    occupiedCount > 0
      ? `Seite belegt (${occupiedCount} Pfeil${occupiedCount > 1 ? 'e' : ''}) — beim Andocken wird automatisch eine freie Seite gewählt oder versetzt`
      : 'Freier Andockpunkt — hierher ziehen für überschneidungsfreies Andocken';
  portGroup.appendChild(portTitle);

  const hitCircle = doc.createElementNS(svgNs, 'circle');
  hitCircle.setAttribute('r', '12');
  hitCircle.setAttribute('fill', 'transparent');
  hitCircle.setAttribute('data-port-node-id', nodeId);
  hitCircle.setAttribute('data-port-side', port.side);
  portGroup.appendChild(hitCircle);

  const bodyGroup = doc.createElementNS(svgNs, 'g');
  bodyGroup.setAttribute('class', 'callflow-port-body');
  bodyGroup.setAttribute('data-port-node-id', nodeId);
  bodyGroup.setAttribute('data-port-side', port.side);

  const haloCircle = doc.createElementNS(svgNs, 'circle');
  haloCircle.setAttribute('class', 'callflow-port-halo');
  haloCircle.setAttribute('r', '10.5');
  haloCircle.setAttribute('fill', 'rgba(16, 185, 129, 0.18)');
  haloCircle.setAttribute('stroke', '#10b981');
  haloCircle.setAttribute('stroke-width', '2');
  haloCircle.setAttribute('data-port-node-id', nodeId);
  haloCircle.setAttribute('data-port-side', port.side);
  bodyGroup.appendChild(haloCircle);

  const outerCircle = doc.createElementNS(svgNs, 'circle');
  outerCircle.setAttribute('class', 'callflow-port-outer');
  outerCircle.setAttribute('r', '6');
  outerCircle.setAttribute('fill', '#4f46e5');
  outerCircle.setAttribute('stroke', '#e0e7ff');
  outerCircle.setAttribute('stroke-width', '2');
  outerCircle.setAttribute('data-port-node-id', nodeId);
  outerCircle.setAttribute('data-port-side', port.side);
  bodyGroup.appendChild(outerCircle);

  const innerDot = doc.createElementNS(svgNs, 'circle');
  innerDot.setAttribute('r', '2.1');
  innerDot.setAttribute('fill', '#ffffff');
  innerDot.setAttribute('data-port-node-id', nodeId);
  innerDot.setAttribute('data-port-side', port.side);
  bodyGroup.appendChild(innerDot);

  portGroup.appendChild(bodyGroup);
  return portGroup as SVGGElement;
}

/**
 * Lazily materializes the 4 connection ports on a single active/hovered SVG node group
 * so large diagrams mount without thousands of redundant SVG port elements.
 */
export function ensureNodePortsMaterialized(
  node: LiveSvgNodeHandle,
  isVisualEditMode: boolean
): void {
  const portDisplay = isVisualEditMode ? '' : 'none';
  if (node.portsMaterialized) {
    (['top', 'right', 'bottom', 'left'] as PortSide[]).forEach((side) => {
      const el = node.ports[side].el;
      if (el && el.style.display !== portDisplay) {
        el.style.display = portDisplay;
      }
    });
    return;
  }

  const svgNs = 'http://www.w3.org/2000/svg';
  const doc = node.groupEl.ownerDocument;
  (['top', 'right', 'bottom', 'left'] as PortSide[]).forEach((side) => {
    const port = node.ports[side];
    if (!port.el) {
      const el = buildSinglePortElement(
        doc,
        svgNs,
        node.nodeId,
        port,
        node.occupiedPortCounts[side],
        isVisualEditMode
      );
      node.groupEl.appendChild(el);
      port.el = el;
    } else {
      port.el.style.display = portDisplay;
    }
  });
  node.portsMaterialized = true;
}

export function materializeActiveNodePortsInDom(
  index: LiveSvgDomIndex,
  nodeId: string | null | undefined,
  isVisualEditMode: boolean
): void {
  if (!nodeId || !isVisualEditMode) return;
  const node = index.nodes.get(nodeId);
  if (node) {
    ensureNodePortsMaterialized(node, isVisualEditMode);
  }
}

/**
 * Resolves a clicked SVG edge hit-path or edge label back to `{ from, to, label }` in O(1).
 */
export function resolveClickedEdgeFromSvgElement(
  targetEl: Element | null
): SelectedCallflowEdge | null {
  if (!targetEl) return null;
  const edgeHolder = targetEl.closest('[data-callflow-edge-from][data-callflow-edge-to]');
  if (!edgeHolder) return null;
  const from = edgeHolder.getAttribute('data-callflow-edge-from') || '';
  const to = edgeHolder.getAttribute('data-callflow-edge-to') || '';
  if (!from || !to) return null;
  const label = edgeHolder.getAttribute('data-callflow-edge-label') || '';
  return { from, to, label };
}

/**
 * Resolves a clicked padlock badge (`[data-lock-from][data-lock-to]`) in O(1).
 */
export function resolveClickedLockFromSvgElement(
  targetEl: Element | null
): SelectedCallflowEdge | null {
  if (!targetEl) return null;
  const lockHolder = targetEl.closest('[data-lock-from][data-lock-to]');
  if (!lockHolder) return null;
  const from = lockHolder.getAttribute('data-lock-from') || '';
  const to = lockHolder.getAttribute('data-lock-to') || '';
  if (!from || !to) return null;
  const label = lockHolder.getAttribute('data-lock-label') || '';
  return { from, to, label };
}

export interface MagneticSnapResult {
  nodeId: string;
  side: PortSide;
  clientX: number;
  clientY: number;
  dist: number;
  isFreeSide: boolean;
}

function detectClosestNodePortSide(
  node: LiveSvgNodeHandle,
  svgPointX: number,
  svgPointY: number
): PortSide {
  const lx = svgPointX - node.baseTx;
  const ly = svgPointY - node.baseTy;
  const anchors: Record<PortSide, { x: number; y: number }> = {
    top: { x: node.box.cx, y: node.box.minY },
    right: { x: node.box.maxX, y: node.box.cy },
    bottom: { x: node.box.cx, y: node.box.maxY },
    left: { x: node.box.minX, y: node.box.cy },
  };
  let bestSide: PortSide = 'top';
  let bestDist = Infinity;
  (['top', 'right', 'bottom', 'left'] as PortSide[]).forEach((side) => {
    const a = anchors[side];
    const d = Math.hypot(lx - a.x, ly - a.y);
    if (d < bestDist) {
      bestDist = d;
      bestSide = side;
    }
  });
  return bestSide;
}

function computeLockPositionOnSegment(
  endPt: { x: number; y: number },
  prevPt: { x: number; y: number },
  edgeTx: number,
  edgeTy: number
): { x: number; y: number } {
  const ex = edgeTx + endPt.x;
  const ey = edgeTy + endPt.y;
  const px = edgeTx + prevPt.x;
  const py = edgeTy + prevPt.y;
  const vx = px - ex;
  const vy = py - ey;
  const len = Math.hypot(vx, vy);
  if (len > 2) {
    const step = Math.min(18, Math.max(11, len * 0.36));
    return {
      x: Number((ex + (vx / len) * step).toFixed(2)),
      y: Number((ey + (vy / len) * step).toFixed(2)),
    };
  }
  return {
    x: Number(ex.toFixed(2)),
    y: Number((ey - 11).toFixed(2)),
  };
}

function createEdgeLockBadge(
  doc: Document,
  svgNs: string,
  from: string,
  to: string,
  labelText: string,
  pos: { x: number; y: number }
): SVGGElement {
  const g = doc.createElementNS(svgNs, 'g');
  g.setAttribute('class', 'callflow-edge-lock');
  g.setAttribute('data-lock-from', from);
  g.setAttribute('data-lock-to', to);
  g.setAttribute('data-lock-label', labelText);
  g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);

  const titleEl = doc.createElementNS(svgNs, 'title');
  titleEl.textContent = labelText
    ? `Schloss: Verbindung "${labelText}" (${from} → ${to}) per Klick lösen`
    : `Schloss: Verbindung (${from} → ${to}) per Klick lösen`;
  g.appendChild(titleEl);

  const hitCircle = doc.createElementNS(svgNs, 'circle');
  hitCircle.setAttribute('r', '14');
  hitCircle.setAttribute('fill', 'transparent');
  hitCircle.setAttribute('data-lock-from', from);
  hitCircle.setAttribute('data-lock-to', to);
  hitCircle.setAttribute('data-lock-label', labelText);
  g.appendChild(hitCircle);

  const badge = doc.createElementNS(svgNs, 'g');
  badge.setAttribute('class', 'callflow-lock-badge');
  badge.setAttribute('data-lock-from', from);
  badge.setAttribute('data-lock-to', to);
  badge.setAttribute('data-lock-label', labelText);

  const bgCircle = doc.createElementNS(svgNs, 'circle');
  bgCircle.setAttribute('class', 'callflow-lock-bg');
  bgCircle.setAttribute('r', '9.5');
  bgCircle.setAttribute('fill', '#0f172a');
  bgCircle.setAttribute('stroke', '#fbbf24');
  bgCircle.setAttribute('stroke-width', '1.8');
  bgCircle.setAttribute('data-lock-from', from);
  bgCircle.setAttribute('data-lock-to', to);
  bgCircle.setAttribute('data-lock-label', labelText);
  badge.appendChild(bgCircle);

  // Closed padlock icon (default state)
  const closedGroup = doc.createElementNS(svgNs, 'g');
  closedGroup.setAttribute('class', 'callflow-lock-closed');
  closedGroup.setAttribute('transform', 'translate(-5.5, -5.5) scale(0.46)');
  closedGroup.setAttribute('data-lock-from', from);
  closedGroup.setAttribute('data-lock-to', to);

  const closedRect = doc.createElementNS(svgNs, 'rect');
  closedRect.setAttribute('x', '4');
  closedRect.setAttribute('y', '11');
  closedRect.setAttribute('width', '16');
  closedRect.setAttribute('height', '10');
  closedRect.setAttribute('rx', '2.5');
  closedRect.setAttribute('fill', '#fbbf24');
  closedRect.setAttribute('stroke', '#fef3c7');
  closedRect.setAttribute('stroke-width', '1.5');
  closedGroup.appendChild(closedRect);

  const closedShackle = doc.createElementNS(svgNs, 'path');
  closedShackle.setAttribute('d', 'M7 11V7a5 5 0 0 1 10 0v4');
  closedShackle.setAttribute('fill', 'none');
  closedShackle.setAttribute('stroke', '#fef3c7');
  closedShackle.setAttribute('stroke-width', '2.4');
  closedShackle.setAttribute('stroke-linecap', 'round');
  closedGroup.appendChild(closedShackle);
  badge.appendChild(closedGroup);

  // Open padlock icon (hover/unlock state)
  const openGroup = doc.createElementNS(svgNs, 'g');
  openGroup.setAttribute('class', 'callflow-lock-open');
  openGroup.setAttribute('transform', 'translate(-5.5, -5.5) scale(0.46)');
  openGroup.setAttribute('data-lock-from', from);
  openGroup.setAttribute('data-lock-to', to);

  const openRect = doc.createElementNS(svgNs, 'rect');
  openRect.setAttribute('x', '4');
  openRect.setAttribute('y', '11');
  openRect.setAttribute('width', '16');
  openRect.setAttribute('height', '10');
  openRect.setAttribute('rx', '2.5');
  openRect.setAttribute('fill', '#ffe4e6');
  openRect.setAttribute('stroke', '#ffffff');
  openRect.setAttribute('stroke-width', '1.5');
  openGroup.appendChild(openRect);

  const openShackle = doc.createElementNS(svgNs, 'path');
  openShackle.setAttribute('d', 'M7 11V7a5 5 0 0 1 9.5-2.2');
  openShackle.setAttribute('fill', 'none');
  openShackle.setAttribute('stroke', '#ffffff');
  openShackle.setAttribute('stroke-width', '2.4');
  openShackle.setAttribute('stroke-linecap', 'round');
  openGroup.appendChild(openShackle);
  badge.appendChild(openGroup);

  g.appendChild(badge);
  return g as SVGGElement;
}

/**
 * Builds a reusable in-memory DOM index ONCE whenever a new base SVG mounts,
 * eliminating DOMParser/XMLSerializer overhead during Pan, Zoom, Selection, and Dragging.
 */
export function buildLiveSvgDomIndex(
  svgEl: SVGSVGElement,
  graph: CallflowGraph
): LiveSvgDomIndex {
  const origViewBox = svgEl.getAttribute('viewBox');
  let origVbParts: [number, number, number, number] | null = null;
  if (origViewBox) {
    const parts = origViewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      origVbParts = [parts[0], parts[1], parts[2], parts[3]];
    }
  }

  // Clean up any stale hit-paths, lazy port groups, or padlock overlays from an earlier index pass
  svgEl
    .querySelectorAll('.callflow-connect-port, .callflow-edge-hit, .callflow-edge-locks-layer')
    .forEach((el) => el.remove());

  const nodes = new Map<string, LiveSvgNodeHandle>();
  const nodeGroups = Array.from(
    svgEl.querySelectorAll('g.node, g.actor, g.statediagram-state, g.classGroup')
  ) as SVGGElement[];

  nodeGroups.forEach((groupEl) => {
    const matchedId = resolveClickedNodeIdFromSvgElement(groupEl, graph);
    if (!matchedId) return;
    groupEl.setAttribute('data-callflow-node-id', matchedId);

    const { x, y, rest } = parseTranslateFromTransform(groupEl.getAttribute('transform'));
    const rawShapes = groupEl.querySelectorAll(
      'rect, polygon, circle, ellipse, path.label-container, path.basic, g.label-container > path'
    );
    const shapeEls = (
      rawShapes.length > 0
        ? Array.from(rawShapes)
        : Array.from(groupEl.children).filter((el) =>
            ['rect', 'polygon', 'circle', 'ellipse', 'path'].includes(el.tagName.toLowerCase())
          )
    ) as SVGElement[];

    const origShapeStyles = shapeEls.map((s) => ({
      fillAttr: s.getAttribute('fill'),
      strokeAttr: s.getAttribute('stroke'),
      styleFill: s.style.fill || '',
      styleStroke: s.style.stroke || '',
      styleStrokeWidth: s.style.strokeWidth || '',
    }));

    const textEls = Array.from(groupEl.querySelectorAll('text, tspan')) as SVGElement[];
    const origTextStyles = textEls.map((t) => ({
      fillAttr: t.getAttribute('fill'),
      styleFill: t.style.fill || '',
    }));

    const htmlEls = Array.from(
      groupEl.querySelectorAll('foreignObject div, foreignObject span, foreignObject p')
    ) as HTMLElement[];
    const origHtmlStyles = htmlEls.map((h) => ({
      color: h.style.color || '',
      fontWeight: h.style.fontWeight || '',
    }));

    const box = getNodeLocalBox(groupEl, shapeEls);
    const ports = createPortMetadataFromBox(box);

    nodes.set(matchedId, {
      nodeId: matchedId,
      groupEl,
      baseTx: x,
      baseTy: y,
      currentDx: 0,
      currentDy: 0,
      restTransform: rest,
      box,
      occupiedPortCounts: { top: 0, right: 0, bottom: 0, left: 0 },
      shapeEls,
      origShapeStyles,
      textEls,
      origTextStyles,
      htmlEls,
      origHtmlStyles,
      portsMaterialized: false,
      ports,
    });
  });

  // Pre-compile edge matchers once (longest node IDs first to prevent prefix collisions)
  const compiledEdges = graph.edges
    .map((edge) => createEdgeMetaMatcher(edge))
    .sort((a, b) => b.score - a.score);

  const matchEdgeMeta = (el: Element): CallflowEdge | null => {
    const meta = getSvgEdgeElementMeta(el);
    for (const item of compiledEdges) {
      if (item.matches(meta)) {
        return item.edge;
      }
    }
    return null;
  };

  const edgeElements = Array.from(
    svgEl.querySelectorAll('g.edgePaths > *, g.edgePath, path.flowchart-link')
  ).filter(
    (el) =>
      !el.classList.contains('callflow-edge-hit') &&
      !(el.tagName.toLowerCase() === 'path' && el.parentElement?.classList.contains('edgePath'))
  ) as SVGElement[];
  const edgeLabelElements = Array.from(
    svgEl.querySelectorAll('g.edgeLabels > *, g.edgeLabel')
  ) as SVGElement[];

  const allEdges: LiveSvgEdgeHandle[] = [];
  const edgesByNode = new Map<string, LiveSvgEdgeHandle[]>();
  const svgNs = 'http://www.w3.org/2000/svg';
  const doc = svgEl.ownerDocument;
  const usedLabelEls = new Set<SVGElement>();

  edgeElements.forEach((edgeEl, idx) => {
    const matched = matchEdgeMeta(edgeEl);
    if (!matched) return;
    const pathNodes = (
      edgeEl.tagName.toLowerCase() === 'path'
        ? [edgeEl]
        : Array.from(edgeEl.querySelectorAll('path:not(.callflow-edge-hit)'))
    ) as SVGPathElement[];

    const edgeTr = parseTranslateFromTransform(edgeEl.getAttribute('transform'));
    const edgeTx = edgeTr.x;
    const edgeTy = edgeTr.y;

    const edgeOwnDataId =
      edgeEl.getAttribute('data-id') ||
      edgeEl.getAttribute('id')?.replace(/^.*-(L[-_].+)$/i, '$1') ||
      '';

    const matchedLabel =
      (edgeOwnDataId
        ? edgeLabelElements.find((l) => {
            if (usedLabelEls.has(l)) return false;
            const lid =
              l.getAttribute('data-id') ||
              l.querySelector('[data-id]')?.getAttribute('data-id') ||
              '';
            return lid === edgeOwnDataId;
          })
        : null) ||
      edgeLabelElements.find((l) => {
        if (usedLabelEls.has(l)) return false;
        const m = matchEdgeMeta(l);
        return m && m.from === matched.from && m.to === matched.to;
      }) ||
      (edgeLabelElements.length === edgeElements.length && !usedLabelEls.has(edgeLabelElements[idx])
        ? edgeLabelElements[idx]
        : null);

    if (matchedLabel) {
      usedLabelEls.add(matchedLabel);
    }

    const labelText =
      matched.label ||
      (matchedLabel?.textContent || '').replace(/\s+/g, ' ').trim();

    if (matchedLabel) {
      matchedLabel.setAttribute('data-callflow-edge-from', matched.from);
      matchedLabel.setAttribute('data-callflow-edge-to', matched.to);
      matchedLabel.setAttribute('data-callflow-edge-label', labelText);
    }

    const parsedPaths = pathNodes.map((p) => parseLivePathTokens(p));
    const hitPathEls: SVGPathElement[] = [];
    pathNodes.forEach((p) => {
      const dAttr = p.getAttribute('d');
      if (!dAttr || !p.parentNode) return;
      const hitEl = doc.createElementNS(svgNs, 'path');
      hitEl.setAttribute('class', 'callflow-edge-hit');
      hitEl.setAttribute('d', dAttr);
      hitEl.setAttribute('data-callflow-edge-from', matched.from);
      hitEl.setAttribute('data-callflow-edge-to', matched.to);
      hitEl.setAttribute('data-callflow-edge-label', labelText);
      const hitTitle = doc.createElementNS(svgNs, 'title');
      hitTitle.textContent = labelText
        ? `Verbindung "${labelText}" anklicken zum Bearbeiten oder per Schloss am Knoten lösen`
        : `Verbindung ${matched.from} → ${matched.to} anklicken zum Bearbeiten oder per Schloss am Knoten lösen`;
      hitEl.appendChild(hitTitle);
      p.parentNode.insertBefore(hitEl, p.nextSibling);
      hitPathEls.push(hitEl);
    });

    const mainPath = parsedPaths[0];
    const origStartPt = mainPath ? mainPath.startPt : { x: 0, y: 0 };
    const origEndPt = mainPath ? mainPath.endPt : { x: 0, y: 0 };
    const origPrevPt = mainPath ? mainPath.prevPt : origStartPt;
    const prevT =
      mainPath && mainPath.prevPairIdx >= 0 && mainPath.pairs[mainPath.prevPairIdx]
        ? mainPath.pairs[mainPath.prevPairIdx].t
        : 0.7;

    // Record occupied port sides on both source & target nodes so new wires auto-pick free sides
    const fromNode = nodes.get(matched.from);
    if (fromNode && mainPath) {
      const side = detectClosestNodePortSide(
        fromNode,
        edgeTx + origStartPt.x,
        edgeTy + origStartPt.y
      );
      fromNode.occupiedPortCounts[side] += 1;
    }
    const toNode = nodes.get(matched.to);
    if (toNode && mainPath) {
      const side = detectClosestNodePortSide(
        toNode,
        edgeTx + origEndPt.x,
        edgeTy + origEndPt.y
      );
      toNode.occupiedPortCounts[side] += 1;
    }

    const hasLockGeometry = Boolean(mainPath);
    const lockPos = hasLockGeometry
      ? computeLockPositionOnSegment(origEndPt, origPrevPt, edgeTx, edgeTy)
      : { x: 0, y: 0 };

    const labelTransform = matchedLabel
      ? parseTranslateFromTransform(matchedLabel.getAttribute('transform'))
      : { x: 0, y: 0, rest: '' };

    const handle: LiveSvgEdgeHandle = {
      from: matched.from,
      to: matched.to,
      labelText,
      edgeEl,
      edgeTx,
      edgeTy,
      origOpacity: edgeEl.style.opacity || '',
      paths: parsedPaths,
      hitPaths: hitPathEls.map((hp) => parseLivePathTokens(hp)),
      labelEl: matchedLabel,
      origLabelOpacity: matchedLabel ? matchedLabel.style.opacity || '' : '',
      labelBaseTx: labelTransform.x,
      labelBaseTy: labelTransform.y,
      labelRestTransform: labelTransform.rest,
      hasLockGeometry,
      lockPos,
      lockEl: null,
      origEndPt,
      origPrevPt,
      prevT,
    };

    allEdges.push(handle);
    const fromArr = edgesByNode.get(matched.from) || [];
    fromArr.push(handle);
    edgesByNode.set(matched.from, fromArr);
    if (matched.to !== matched.from) {
      const toArr = edgesByNode.get(matched.to) || [];
      toArr.push(handle);
      edgesByNode.set(matched.to, toArr);
    }
  });

  const clusters = Array.from(svgEl.querySelectorAll('g.cluster')) as SVGElement[];

  return {
    svgEl,
    origViewBox,
    origVbParts,
    nodes,
    allEdges,
    edgesByNode,
    clusters,
    locksLayerEl: null,
    isVisualEditMode: false,
  };
}

function applyTangentialScreenOffset(
  side: PortSide,
  px: number,
  py: number,
  occupiedCount: number
): { x: number; y: number } {
  if (occupiedCount <= 0) return { x: px, y: py };
  // Alternate ±15px, ±27px tangentially along the node rim so new wires never land on top of existing arrowheads
  const tier = Math.ceil(occupiedCount / 2);
  const sign = occupiedCount % 2 === 1 ? 1 : -1;
  const shift = sign * (15 + (tier - 1) * 12);
  if (side === 'top' || side === 'bottom') {
    return { x: px + shift, y: py };
  }
  return { x: px, y: py + shift };
}

/**
 * Zero-reflow magnetic snap search across 4-side node ports within `snapRadiusPx` screen pixels.
 * Projects cached local port coordinates via a single cached parent `getScreenCTM()` matrix
 * instead of calling `getBoundingClientRect()` on thousands of SVG nodes, then lazily materializes
 * port handles ONLY for the active hovered/snapped node.
 */
export function findNearestMagneticPort(
  index: LiveSvgDomIndex,
  clientX: number,
  clientY: number,
  excludeNodeId: string,
  snapRadiusPx: number = 30,
  hoveredNodeId: string | null = null
): MagneticSnapResult | null {
  const sides: PortSide[] = ['top', 'right', 'bottom', 'left'];
  const ctmByParent = new Map<Element, DOMMatrix | null>();
  let svgRootCtm: DOMMatrix | null | undefined;

  const getPortClientCoords = (
    node: LiveSvgNodeHandle,
    side: PortSide
  ): { x: number; y: number } | null => {
    const port = node.ports[side];
    const parentEl = node.groupEl.parentElement;
    let ctm: DOMMatrix | null = null;

    if (parentEl) {
      if (ctmByParent.has(parentEl)) {
        ctm = ctmByParent.get(parentEl) ?? null;
      } else {
        ctm =
          (parentEl as unknown as SVGGraphicsElement).getScreenCTM?.() ??
          index.svgEl.getScreenCTM?.() ??
          null;
        ctmByParent.set(parentEl, ctm);
      }
    } else {
      if (svgRootCtm === undefined) {
        svgRootCtm = index.svgEl.getScreenCTM?.() ?? null;
      }
      ctm = svgRootCtm;
    }

    if (ctm) {
      const ux = node.baseTx + node.currentDx + port.localX;
      const uy = node.baseTy + node.currentDy + port.localY;
      return {
        x: ctm.a * ux + ctm.c * uy + ctm.e,
        y: ctm.b * ux + ctm.d * uy + ctm.f,
      };
    }

    if (port.el) {
      const rect = port.el.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  };

  let bestFree: MagneticSnapResult | null = null;
  let bestOccupied: MagneticSnapResult | null = null;

  index.nodes.forEach((node) => {
    if (node.nodeId === excludeNodeId) return;
    for (const side of sides) {
      const coords = getPortClientCoords(node, side);
      if (!coords) continue;
      const baseX = coords.x;
      const baseY = coords.y;
      const dist = Math.hypot(baseX - clientX, baseY - clientY);
      if (dist > snapRadiusPx) continue;
      const occupiedCount = node.occupiedPortCounts[side];
      if (occupiedCount === 0) {
        if (!bestFree || dist < bestFree.dist) {
          bestFree = {
            nodeId: node.nodeId,
            side,
            clientX: baseX,
            clientY: baseY,
            dist,
            isFreeSide: true,
          };
        }
      } else {
        const shifted = applyTangentialScreenOffset(side, baseX, baseY, occupiedCount);
        if (!bestOccupied || dist < bestOccupied.dist) {
          bestOccupied = {
            nodeId: node.nodeId,
            side,
            clientX: shifted.x,
            clientY: shifted.y,
            dist,
            isFreeSide: false,
          };
        }
      }
    }
  });

  if (bestFree) {
    const matchedNode = index.nodes.get((bestFree as MagneticSnapResult).nodeId);
    if (matchedNode) ensureNodePortsMaterialized(matchedNode, true);
    return bestFree;
  }

  // If cursor is inside a target node box, automatically select a FREE port side on that node
  // (or tangential offset if all 4 sides are already occupied) rather than snapping onto an existing arrowhead.
  if (hoveredNodeId && hoveredNodeId !== excludeNodeId) {
    const hoveredNode = index.nodes.get(hoveredNodeId);
    if (hoveredNode) {
      ensureNodePortsMaterialized(hoveredNode, true);
      let hoveredFree: MagneticSnapResult | null = null;
      let hoveredOcc: MagneticSnapResult | null = null;
      for (const side of sides) {
        const coords = getPortClientCoords(hoveredNode, side);
        if (!coords) continue;
        const baseX = coords.x;
        const baseY = coords.y;
        const dist = Math.hypot(baseX - clientX, baseY - clientY);
        const occupiedCount = hoveredNode.occupiedPortCounts[side];
        if (occupiedCount === 0) {
          if (!hoveredFree || dist < hoveredFree.dist) {
            hoveredFree = {
              nodeId: hoveredNodeId,
              side,
              clientX: baseX,
              clientY: baseY,
              dist,
              isFreeSide: true,
            };
          }
        } else {
          const shifted = applyTangentialScreenOffset(side, baseX, baseY, occupiedCount);
          if (!hoveredOcc || dist < hoveredOcc.dist) {
            hoveredOcc = {
              nodeId: hoveredNodeId,
              side,
              clientX: shifted.x,
              clientY: shifted.y,
              dist,
              isFreeSide: false,
            };
          }
        }
      }
      if (hoveredFree) return hoveredFree;
      if (hoveredOcc) return hoveredOcc;
    }
  }

  if (bestOccupied) {
    const matchedNode = index.nodes.get((bestOccupied as MagneticSnapResult).nodeId);
    if (matchedNode) ensureNodePortsMaterialized(matchedNode, true);
  }

  return bestOccupied;
}

/**
 * Highlights the active magnetic snap port on the SVG without touching React state,
 * lazily creating port DOM handles on the target node if needed.
 */
export function setMagneticSnapTargetInDom(
  index: LiveSvgDomIndex,
  target: { nodeId: string; side: PortSide } | null,
  isConnecting: boolean
): void {
  index.svgEl.classList.toggle('is-wire-connecting', isConnecting);
  index.svgEl
    .querySelectorAll('.callflow-connect-port.is-snap-target')
    .forEach((el) => el.classList.remove('is-snap-target'));

  if (target) {
    const node = index.nodes.get(target.nodeId);
    if (node) {
      ensureNodePortsMaterialized(node, true);
      const portEl = node.ports[target.side]?.el;
      if (portEl) {
        portEl.classList.add('is-snap-target');
      }
    }
  }
}

function ensureEdgeLockMaterialized(
  index: LiveSvgDomIndex,
  edge: LiveSvgEdgeHandle
): SVGGElement | null {
  if (!edge.hasLockGeometry) return null;
  if (edge.lockEl) {
    edge.lockEl.setAttribute('transform', `translate(${edge.lockPos.x}, ${edge.lockPos.y})`);
    return edge.lockEl;
  }

  const svgNs = 'http://www.w3.org/2000/svg';
  const doc = index.svgEl.ownerDocument;
  if (!index.locksLayerEl) {
    const layer = doc.createElementNS(svgNs, 'g');
    layer.setAttribute('class', 'callflow-edge-locks-layer');
    index.svgEl.appendChild(layer);
    index.locksLayerEl = layer as SVGGElement;
  }

  const lockEl = createEdgeLockBadge(
    doc,
    svgNs,
    edge.from,
    edge.to,
    edge.labelText,
    edge.lockPos
  );
  index.locksLayerEl.appendChild(lockEl);
  edge.lockEl = lockEl;
  return lockEl;
}

/**
 * Lazily reveals padlock badges ONLY when hovering a line, hovering a docked node, or selecting an edge.
 */
export function setHoveredLockTargetsInDom(
  index: LiveSvgDomIndex,
  hoveredEdge: SelectedCallflowEdge | null,
  hoveredNodeId: string | null,
  selectedEdge: SelectedCallflowEdge | null
): void {
  if (hoveredNodeId && index.isVisualEditMode) {
    materializeActiveNodePortsInDom(index, hoveredNodeId, true);
  }

  for (let i = 0; i < index.allEdges.length; i++) {
    const edge = index.allEdges[i];
    if (!edge.hasLockGeometry) continue;
    const isVisible =
      (selectedEdge !== null && edge.from === selectedEdge.from && edge.to === selectedEdge.to) ||
      (hoveredEdge !== null && edge.from === hoveredEdge.from && edge.to === hoveredEdge.to) ||
      (hoveredNodeId !== null && (edge.to === hoveredNodeId || edge.from === hoveredNodeId));

    if (isVisible) {
      const lockEl = ensureEdgeLockMaterialized(index, edge);
      lockEl?.classList.add('is-visible');
    } else if (edge.lockEl) {
      edge.lockEl.classList.remove('is-visible');
    }
  }
}

function shiftParsedPaths(
  pathList: ParsedLivePathData[],
  hasShift: boolean,
  dxFrom: number,
  dyFrom: number,
  dxTo: number,
  dyTo: number
): void {
  for (let pIdx = 0; pIdx < pathList.length; pIdx++) {
    const p = pathList[pIdx];
    if (!hasShift) {
      if (p.pathEl.getAttribute('d') !== p.origD) {
        p.pathEl.setAttribute('d', p.origD);
      }
      continue;
    }
    if (p.pairs.length === 0) continue;
    for (let i = 0; i < p.pairs.length; i++) {
      const pair = p.pairs[i];
      const shiftX = dxFrom * (1 - pair.t) + dxTo * pair.t;
      const shiftY = dyFrom * (1 - pair.t) + dyTo * pair.t;
      p.parts[pair.xIdx] = `${pair.xPrefix}${Number((pair.origX + shiftX).toFixed(2))}`;
      p.parts[pair.yIdx] = `${pair.yPrefix}${Number((pair.origY + shiftY).toFixed(2))}`;
    }
    p.pathEl.setAttribute('d', p.parts.join(''));
  }
}

function updateLiveEdgeGeometry(
  edge: LiveSvgEdgeHandle,
  dxFrom: number,
  dyFrom: number,
  dxTo: number,
  dyTo: number
): void {
  const hasShift =
    Math.abs(dxFrom) > 0.5 ||
    Math.abs(dyFrom) > 0.5 ||
    Math.abs(dxTo) > 0.5 ||
    Math.abs(dyTo) > 0.5;

  shiftParsedPaths(edge.paths, hasShift, dxFrom, dyFrom, dxTo, dyTo);
  shiftParsedPaths(edge.hitPaths, hasShift, dxFrom, dyFrom, dxTo, dyTo);

  if (edge.labelEl) {
    const midDx = (dxFrom + dxTo) / 2;
    const midDy = (dyFrom + dyTo) / 2;
    const nextLx = Number((edge.labelBaseTx + midDx).toFixed(2));
    const nextLy = Number((edge.labelBaseTy + midDy).toFixed(2));
    edge.labelEl.setAttribute(
      'transform',
      `translate(${nextLx}, ${nextLy})${edge.labelRestTransform ? ` ${edge.labelRestTransform}` : ''}`
    );
  }

  if (edge.hasLockGeometry) {
    const curEnd = {
      x: edge.origEndPt.x + (hasShift ? dxTo : 0),
      y: edge.origEndPt.y + (hasShift ? dyTo : 0),
    };
    const curPrev = {
      x: edge.origPrevPt.x + (hasShift ? dxFrom * (1 - edge.prevT) + dxTo * edge.prevT : 0),
      y: edge.origPrevPt.y + (hasShift ? dyFrom * (1 - edge.prevT) + dyTo * edge.prevT : 0),
    };
    const nextLockPos = computeLockPositionOnSegment(curEnd, curPrev, edge.edgeTx, edge.edgeTy);
    edge.lockPos = nextLockPos;
    if (edge.lockEl) {
      edge.lockEl.setAttribute('transform', `translate(${nextLockPos.x}, ${nextLockPos.y})`);
    }
  }
}

/**
 * Updates node transforms, materialized hover port availability, and edge geometry directly in the live SVG DOM.
 */
export function applyLiveNodeOffsetsToDom(
  index: LiveSvgDomIndex,
  nodeOffsets: Record<string, NodePositionOffset>,
  isVisualEditMode: boolean
): void {
  let minDeltaX = 0;
  let maxDeltaX = 0;
  let minDeltaY = 0;
  let maxDeltaY = 0;

  index.isVisualEditMode = isVisualEditMode;
  index.svgEl.classList.toggle('is-visual-edit', isVisualEditMode);

  index.nodes.forEach((node) => {
    const off = nodeOffsets[node.nodeId];
    const dx = off && Math.abs(off.dx) > 0.5 ? off.dx : 0;
    const dy = off && Math.abs(off.dy) > 0.5 ? off.dy : 0;
    node.currentDx = dx;
    node.currentDy = dy;
    const nextX = Number((node.baseTx + dx).toFixed(2));
    const nextY = Number((node.baseTy + dy).toFixed(2));
    node.groupEl.setAttribute(
      'transform',
      `translate(${nextX}, ${nextY})${node.restTransform ? ` ${node.restTransform}` : ''}`
    );
    node.groupEl.style.cursor = isVisualEditMode ? 'move' : 'pointer';

    if (node.portsMaterialized) {
      const portDisplay = isVisualEditMode ? '' : 'none';
      if (node.ports.top.el) node.ports.top.el.style.display = portDisplay;
      if (node.ports.right.el) node.ports.right.el.style.display = portDisplay;
      if (node.ports.bottom.el) node.ports.bottom.el.style.display = portDisplay;
      if (node.ports.left.el) node.ports.left.el.style.display = portDisplay;
    }

    if (dx < minDeltaX) minDeltaX = dx;
    if (dx > maxDeltaX) maxDeltaX = dx;
    if (dy < minDeltaY) minDeltaY = dy;
    if (dy > maxDeltaY) maxDeltaY = dy;
  });

  index.allEdges.forEach((edge) => {
    const fromOff = nodeOffsets[edge.from] || { dx: 0, dy: 0 };
    const toOff = nodeOffsets[edge.to] || { dx: 0, dy: 0 };
    updateLiveEdgeGeometry(edge, fromOff.dx, fromOff.dy, toOff.dx, toOff.dy);
  });

  if (index.origVbParts) {
    const [vx, vy, vw, vh] = index.origVbParts;
    const padLeft = minDeltaX < 0 ? Math.abs(minDeltaX) + 40 : 0;
    const padTop = minDeltaY < 0 ? Math.abs(minDeltaY) + 40 : 0;
    const padRight = maxDeltaX > 0 ? maxDeltaX + 40 : 0;
    const padBottom = maxDeltaY > 0 ? maxDeltaY + 40 : 0;
    index.svgEl.setAttribute(
      'viewBox',
      `${Math.floor(vx - padLeft)} ${Math.floor(vy - padTop)} ${Math.ceil(vw + padLeft + padRight)} ${Math.ceil(vh + padTop + padBottom)}`
    );
  }
}

/**
 * 60fps Drag Fast-Path: updates ONLY the edges connected to `draggedNodeId` during mousemove.
 */
export function shiftLiveConnectedEdgesForDrag(
  index: LiveSvgDomIndex,
  draggedNodeId: string,
  draggedOffset: NodePositionOffset,
  allOffsets: Record<string, NodePositionOffset>
): void {
  const connected = index.edgesByNode.get(draggedNodeId);
  if (!connected || connected.length === 0) return;

  for (let i = 0; i < connected.length; i++) {
    const edge = connected[i];
    const fromOff =
      edge.from === draggedNodeId
        ? draggedOffset
        : allOffsets[edge.from] || { dx: 0, dy: 0 };
    const toOff =
      edge.to === draggedNodeId
        ? draggedOffset
        : allOffsets[edge.to] || { dx: 0, dy: 0 };
    updateLiveEdgeGeometry(edge, fromOff.dx, fromOff.dy, toOff.dx, toOff.dy);
  }
}

function restoreNodeOriginalStyles(node: LiveSvgNodeHandle): void {
  node.shapeEls.forEach((s, i) => {
    const orig = node.origShapeStyles[i];
    if (!orig) return;
    s.style.fill = orig.styleFill;
    s.style.stroke = orig.styleStroke;
    s.style.strokeWidth = orig.styleStrokeWidth;
    if (orig.fillAttr !== null) s.setAttribute('fill', orig.fillAttr);
    else s.removeAttribute('fill');
    if (orig.strokeAttr !== null) s.setAttribute('stroke', orig.strokeAttr);
    else s.removeAttribute('stroke');
  });
  node.textEls.forEach((t, i) => {
    const orig = node.origTextStyles[i];
    if (!orig) return;
    t.style.fill = orig.styleFill;
    if (orig.fillAttr !== null) t.setAttribute('fill', orig.fillAttr);
    else t.removeAttribute('fill');
  });
  node.htmlEls.forEach((h, i) => {
    const orig = node.origHtmlStyles[i];
    if (!orig) return;
    h.style.color = orig.color;
    h.style.fontWeight = orig.fontWeight;
  });
}

function restoreParsedPathStyles(p: ParsedLivePathData): void {
  p.pathEl.style.stroke = p.origStyleStroke;
  p.pathEl.style.strokeWidth = p.origStyleStrokeWidth;
  p.pathEl.style.strokeDasharray = p.origStyleDasharray;
  p.pathEl.style.markerEnd = p.origStyleMarkerEnd;
  p.pathEl.style.markerStart = p.origStyleMarkerStart;
  if (p.origStrokeAttr !== null) p.pathEl.setAttribute('stroke', p.origStrokeAttr);
  else p.pathEl.removeAttribute('stroke');
  if (p.origDasharrayAttr !== null) p.pathEl.setAttribute('stroke-dasharray', p.origDasharrayAttr);
  else p.pathEl.removeAttribute('stroke-dasharray');
  if (p.origMarkerEndAttr !== null) p.pathEl.setAttribute('marker-end', p.origMarkerEndAttr);
  else p.pathEl.removeAttribute('marker-end');
  if (p.origMarkerStartAttr !== null) p.pathEl.setAttribute('marker-start', p.origMarkerStartAttr);
  else p.pathEl.removeAttribute('marker-start');
}

/**
 * Applies or cleanly clears Callflow path spotlighting and/or clicked-edge highlighting directly
 * on the mounted SVG DOM in <1-2ms with zero XML parsing or DOM replacement.
 */
export function applyLiveSpotlightToDom(
  index: LiveSvgDomIndex,
  trace: CallflowTraceResult | null,
  canvasSurface: 'dark' | 'light',
  directionFilter: CallflowDirectionFilter = 'both',
  hopDepth: CallflowHopDepth = 'all',
  selectedEdge: SelectedCallflowEdge | null = null
): void {
  const isDark = canvasSurface === 'dark';

  if (!trace) {
    if (selectedEdge) {
      // Highlight the clicked edge and its two connected endpoint nodes cleanly
      const selColor = isDark ? '#fbbf24' : '#d97706';
      index.nodes.forEach((node) => {
        restoreNodeOriginalStyles(node);
        const isEndpoint = node.nodeId === selectedEdge.from || node.nodeId === selectedEdge.to;
        node.groupEl.style.opacity = isEndpoint ? '1' : '0.35';
      });

      index.allEdges.forEach((edge) => {
        const isMatch = edge.from === selectedEdge.from && edge.to === selectedEdge.to;
        if (isMatch) {
          edge.edgeEl.style.opacity = '1';
          if (edge.labelEl) edge.labelEl.style.opacity = '1';
          edge.paths.forEach((p) => {
            applyColorToEdgePathAndMarkers(index.svgEl, p.pathEl, selColor);
            p.pathEl.style.strokeWidth = '4px';
            p.pathEl.style.strokeDasharray = p.origStyleDasharray;
          });
        } else {
          edge.edgeEl.style.opacity = '0.22';
          if (edge.labelEl) edge.labelEl.style.opacity = '0.22';
          edge.paths.forEach(restoreParsedPathStyles);
        }
      });

      index.clusters.forEach((cl) => {
        cl.style.opacity = '0.45';
      });
      return;
    }

    // Restore original Smart Logic & Path colors & full opacity cleanly
    index.nodes.forEach((node) => {
      node.groupEl.style.opacity = '';
      restoreNodeOriginalStyles(node);
    });

    index.allEdges.forEach((edge) => {
      edge.edgeEl.style.opacity = edge.origOpacity;
      if (edge.labelEl) {
        edge.labelEl.style.opacity = edge.origLabelOpacity;
      }
      edge.paths.forEach(restoreParsedPathStyles);
    });

    index.clusters.forEach((cl) => {
      cl.style.opacity = '';
    });
    return;
  }

  const { visibleNodeIds, visibleEdges, cycleEdgeKeys } = getFilteredTraceSubset(
    trace,
    directionFilter,
    hopDepth
  );

  const visibleEdgeKeySet = new Set(visibleEdges.map((e) => `${e.from}->${e.to}`));
  const downstreamEdgeKeySet = new Set(
    trace.downstreamEdges.map((e) => `${e.from}->${e.to}`)
  );
  const terminalIdSet = new Set(trace.terminalPoints.map((t) => t.id));

  index.nodes.forEach((node) => {
    const matchedId = node.nodeId;
    if (!visibleNodeIds.has(matchedId)) {
      node.groupEl.style.opacity = '0.12';
      restoreNodeOriginalStyles(node);
      return;
    }

    node.groupEl.style.opacity = '1';

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
    } else if (terminalIdSet.has(matchedId)) {
      fill = isDark ? '#881337' : '#ffe4e6';
      border = isDark ? '#fb7185' : '#e11d48';
      text = isDark ? '#fff1f2' : '#881337';
    } else if (trace.downstreamNodeIds.has(matchedId)) {
      fill = isDark ? '#064e3b' : '#d1fae5';
      border = isDark ? '#34d399' : '#059669';
      text = isDark ? '#ecfdf5' : '#064e3b';
    }

    node.shapeEls.forEach((shape) => {
      shape.style.fill = fill;
      shape.style.stroke = border;
      shape.style.strokeWidth = strokeWidth;
      shape.setAttribute('fill', fill);
      shape.setAttribute('stroke', border);
    });
    node.textEls.forEach((el) => {
      el.style.fill = text;
      el.setAttribute('fill', text);
    });
    node.htmlEls.forEach((el) => {
      el.style.color = text;
      el.style.fontWeight = '700';
    });
  });

  index.allEdges.forEach((edge) => {
    const edgeKey = `${edge.from}->${edge.to}`;
    const isEdgeOnActivePath = visibleEdgeKeySet.has(edgeKey);
    const isCycleEdge = isEdgeOnActivePath && cycleEdgeKeys.has(edgeKey);
    const isDownstreamEdge =
      isEdgeOnActivePath &&
      !isCycleEdge &&
      (directionFilter === 'downstream' ||
        (directionFilter === 'both' && downstreamEdgeKeySet.has(edgeKey)));

    if (isEdgeOnActivePath) {
      edge.edgeEl.style.opacity = '1';
      if (edge.labelEl) edge.labelEl.style.opacity = '1';
      const activeStroke = isCycleEdge
        ? isDark
          ? '#fb7185'
          : '#e11d48'
        : isDownstreamEdge
        ? isDark
          ? '#34d399'
          : '#059669'
        : isDark
        ? '#38bdf8'
        : '#0284c7';
      edge.paths.forEach((p) => {
        applyColorToEdgePathAndMarkers(index.svgEl, p.pathEl, activeStroke);
        p.pathEl.style.strokeWidth = isCycleEdge ? '2.6px' : '3px';
        p.pathEl.style.strokeDasharray = isCycleEdge ? '6 4' : p.origStyleDasharray;
      });
    } else {
      edge.edgeEl.style.opacity = '0.12';
      if (edge.labelEl) edge.labelEl.style.opacity = '0.12';
      edge.paths.forEach(restoreParsedPathStyles);
    }
  });

  index.clusters.forEach((cl) => {
    cl.style.opacity = '0.35';
  });
}

/**
 * Removes an edge (`fromId -> toId`) directly from raw Mermaid code (Free Mode).
 */
export function disconnectEdgeInMermaidCode(
  code: string,
  fromId: string,
  toId: string
): string {
  const fromEsc = fromId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const toEsc = toId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const edgeLineRegex = new RegExp(
    `^\\s*(?:${fromEsc})(?:\\s*(?:\\[[^\\]]*\\]|\\([^)]*\\)|\\{[^}]*\\}))?\\s*(?:-->|-.->|==>|---|--\\s+[^\\n]*?\\s+-->|-\\.-\\s+[^\\n]*?\\s+-.->|<-->)(?:\\|[^\\|]*\\|)?\\s*(?:${toEsc})(?:\\s*(?:\\[[^\\]]*\\]|\\([^)]*\\)|\\{[^}]*\\}))?\\s*(?:;.*)?$`,
    'i'
  );

  const lines = code.split('\n');
  let removed = false;
  const kept = lines.filter((line) => {
    if (!removed && edgeLineRegex.test(line)) {
      removed = true;
      return false;
    }
    return true;
  });

  if (removed) {
    return kept.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  // Fallback for chained statements like `A --> B --> C` or `A -->|lbl| B` inline
  const inlineRegex = new RegExp(
    `(\\b${fromEsc}\\b(?:\\s*(?:\\[[^\\]]*\\]|\\([^)]*\\)|\\{[^}]*\\}))?)\\s*(?:-->|-.->|==>|---)(?:\\|[^\\|]*\\|)?\\s*(\\b${toEsc}\\b)`,
    'gi'
  );
  return code
    .replace(inlineRegex, '$1\n    $2')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Updates or adds a label on an edge (`fromId -> toId`) directly inside raw Mermaid code (Free Mode).
 */
export function updateEdgeLabelInMermaidCode(
  code: string,
  fromId: string,
  toId: string,
  newLabel: string
): string {
  const cleanLabel = newLabel.trim().replace(/\|/g, '/').replace(/"/g, "'");
  const fromEsc = fromId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const toEsc = toId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchRegex = new RegExp(
    `^(\\s*${fromEsc}(?:\\s*(?:\\[[^\\]]*\\]|\\([^)]*\\)|\\{[^}]*\\}))?\\s*)(-->|-.->|==>|---)(?:\\|[^\\|]*\\|)?(\\s*${toEsc}(?:\\s*(?:\\[[^\\]]*\\]|\\([^)]*\\)|\\{[^}]*\\}))?.*)$`,
    'im'
  );
  if (matchRegex.test(code)) {
    const labelPart = cleanLabel ? `|${cleanLabel}|` : '';
    return code.replace(matchRegex, `$1$2${labelPart}$3`);
  }
  return code;
}

/**
 * Generates clean, isolated Mermaid code containing ONLY the traced callflow path
 * for a selected node, preserving human-readable labels and respecting directionFilter and hopDepth.
 */
export function buildIsolatedPathMermaidCode(
  trace: CallflowTraceResult,
  graph: CallflowGraph,
  direction: string = 'LR',
  directionFilter: CallflowDirectionFilter = 'both',
  hopDepth: CallflowHopDepth = 'all'
): string {
  const lines: string[] = [`flowchart ${direction}`];
  const sanitizeLabel = (lbl: string) => lbl.replace(/"/g, "'");

  const { visibleNodeIds, visibleEdges } = getFilteredTraceSubset(
    trace,
    directionFilter,
    hopDepth
  );

  for (const nodeId of visibleNodeIds) {
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

  for (const edge of visibleEdges) {
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

export interface InteractiveCallflowHtmlView {
  key: string;
  label: string;
  svg: string;
  graph: CallflowGraph;
  scriptNumber?: string;
}

export interface InteractiveCallflowHtmlAnalysisPayload {
  openIssues: CallflowOpenIssue[];
  healthFindings: CallflowHealthFinding[];
  scheduleRows: CallflowScheduleSummaryRow[];
  registry: CallflowResourceRegistry;
  routingMatrixRows: CallflowRoutingMatrixRow[];
  masterScriptNumber?: string;
  parametersByScript?: Record<string, CallflowScriptParameterItem[]>;
}

function escapeHtmlText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a 100% standalone, offline-capable interactive HTML file containing:
 * - True 1:1 SVG dimensions with Zoom +/-, Fit, 1:1, Zoom-to-Cursor & Auto-Focus
 * - Dark/Light surface toggle with automatic SVG node/edge/cluster contrast adaptation
 * - Full Callflow filters: Direction, Hop-Depth, Node-Type Filter, Subgraph Isolation (display:none),
 *   Edge-Click Details (Von -> Nach & Bedingung), Cycle detection, Live Search & Two-Level Master/Script views
 * - Complete Read-Only Analysis Suite (Offene Punkte & Logik-Prüfung, Öffnungszeiten & Zeitpläne,
 *   durchsuchbares Inventar & Routing-Matrix) inkl. Excel-kompatiblem CSV-Export
 */
export function generateInteractiveCallflowHtml(
  diagramTitle: string,
  svgString: string,
  graph: CallflowGraph,
  canvasSurface: 'dark' | 'light',
  options?: {
    views?: InteractiveCallflowHtmlView[];
    activeViewKey?: string;
    initialPathColorMode?: PathColorMode;
    initialHiddenNodeTypes?: SmartColorNodeType[];
    initialIsolateSubgraph?: boolean;
    analysis?: InteractiveCallflowHtmlAnalysisPayload | null;
  }
): string {
  const effectiveViews: InteractiveCallflowHtmlView[] =
    options?.views && options.views.length > 0
      ? options.views
      : [
          {
            key: 'current',
            label: diagramTitle || 'Diagramm',
            svg: svgString,
            graph,
          },
        ];

  const initialViewKey =
    options?.activeViewKey && effectiveViews.some((v) => v.key === options.activeViewKey)
      ? options.activeViewKey
      : effectiveViews[0].key;

  const initialPathColorMode: PathColorMode = options?.initialPathColorMode || 'semantic';
  const initialHiddenNodeTypes: SmartColorNodeType[] = options?.initialHiddenNodeTypes || [];
  const initialIsolateSubgraph = Boolean(options?.initialIsolateSubgraph);

  const serializedViews = effectiveViews.map((v) => ({
    key: v.key,
    label: v.label,
    scriptNumber: v.scriptNumber || null,
    svg: v.svg,
    graph: {
      nodes: Array.from(v.graph.nodes.values()),
      edges: v.graph.edges,
    },
  }));

  const drillTargetsByNodeId: Record<string, { viewKey: string; scriptRef: string }> = {};
  const viewKeyByScriptNumber: Record<string, string> = {};
  effectiveViews.forEach((v) => {
    if (!v.scriptNumber) return;
    viewKeyByScriptNumber[v.scriptNumber] = v.key;
    viewKeyByScriptNumber[v.scriptNumber.toLowerCase()] = v.key;
    const suffix = toMermaidNodeSuffix(v.scriptNumber);
    const entry = { viewKey: v.key, scriptRef: v.scriptNumber };
    drillTargetsByNodeId[`S_${suffix}`] = entry;
    drillTargetsByNodeId[`JUMP_${suffix}`] = entry;
    drillTargetsByNodeId[`INC_${suffix}`] = entry;
    drillTargetsByNodeId[`SELF_${suffix}`] = entry;
  });

  const safePayloadJson = JSON.stringify({
    views: serializedViews,
    initialViewKey,
    initialPathColorMode,
    initialSurface: canvasSurface,
    initialHiddenNodeTypes,
    initialIsolateSubgraph,
    drillTargetsByNodeId,
    viewKeyByScriptNumber,
    nodeTypeOptions: SMART_COLOR_NODE_TYPE_OPTIONS,
    semanticPalettes: SEMANTIC_PALETTES,
    analysis: options?.analysis || null,
  }).replace(/<\/script>/gi, '<\\/script>');

  const initialSvg =
    effectiveViews.find((v) => v.key === initialViewKey)?.svg || svgString;
  const hasMultiViews = effectiveViews.length > 1;
  const safeTitle = escapeHtmlText(diagramTitle);
  const isDarkSurface = canvasSurface === 'dark';

  return `<!doctype html>
<html lang="de" class="${isDarkSurface ? 'dark' : 'light'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} — Interaktiver Callflow Explorer</title>
  <style>
    :root {
      --bg-app: #090d16;
      --bg-header: #0f172a;
      --bg-aside: #0f172a;
      --bg-card: #0b1120;
      --bg-input: #1e293b;
      --bg-seg: #020617;
      --bg-hover: #334155;
      --bg-canvas: #0b0f19;
      --border: #1e293b;
      --border-strong: #334155;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --accent: #4f46e5;
      --accent-hover: #4338ca;
      --accent-border: #6366f1;
      --accent-text: #a5b4fc;
      --amber-bg: rgba(245, 158, 11, 0.16);
      --amber-border: rgba(245, 158, 11, 0.45);
      --amber-text: #fde68a;
      --err-bg: rgba(244, 63, 94, 0.14);
      --err-border: rgba(244, 63, 94, 0.42);
      --err-text: #fda4af;
      --warn-bg: rgba(245, 158, 11, 0.14);
      --warn-border: rgba(245, 158, 11, 0.42);
      --warn-text: #fcd34d;
      --ok-bg: rgba(16, 185, 129, 0.14);
      --ok-border: rgba(16, 185, 129, 0.42);
      --ok-text: #6ee7b7;
      --table-stripe: rgba(30, 41, 59, 0.42);
    }
    html.light {
      --bg-app: #f1f5f9;
      --bg-header: #ffffff;
      --bg-aside: #ffffff;
      --bg-card: #f8fafc;
      --bg-input: #ffffff;
      --bg-seg: #e2e8f0;
      --bg-hover: #e2e8f0;
      --bg-canvas: #f8fafc;
      --border: #cbd5e1;
      --border-strong: #94a3b8;
      --text-main: #0f172a;
      --text-muted: #475569;
      --text-dim: #64748b;
      --accent: #4f46e5;
      --accent-hover: #4338ca;
      --accent-border: #4f46e5;
      --accent-text: #4338ca;
      --amber-bg: rgba(245, 158, 11, 0.14);
      --amber-border: rgba(217, 119, 6, 0.5);
      --amber-text: #92400e;
      --err-bg: rgba(225, 29, 72, 0.1);
      --err-border: rgba(225, 29, 72, 0.35);
      --err-text: #9f1239;
      --warn-bg: rgba(217, 119, 6, 0.12);
      --warn-border: rgba(217, 119, 6, 0.35);
      --warn-text: #92400e;
      --ok-bg: rgba(5, 150, 105, 0.12);
      --ok-border: rgba(5, 150, 105, 0.35);
      --ok-text: #065f46;
      --table-stripe: rgba(226, 232, 240, 0.55);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg-app);
      color: var(--text-main);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      min-height: 52px;
      padding: 8px 14px;
      background: var(--bg-header);
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      z-index: 10;
    }
    .brand {
      font-weight: 700;
      font-size: 13.5px;
      color: var(--text-main);
      white-space: nowrap;
      letter-spacing: -0.01em;
    }
    .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .seg-group {
      display: inline-flex;
      background: var(--bg-seg);
      border: 1px solid var(--border-strong);
      border-radius: 7px;
      padding: 2px;
      gap: 2px;
      flex-shrink: 0;
    }
    .seg-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 4px 8px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .seg-btn:hover { color: var(--text-main); background: var(--bg-hover); }
    .seg-btn.active {
      background: var(--accent);
      color: #ffffff;
      font-weight: 600;
    }
    input[type="text"], select, button {
      background: var(--bg-input);
      color: var(--text-main);
      border: 1px solid var(--border-strong);
      border-radius: 6px;
      padding: 5px 9px;
      font-size: 12px;
      font-family: inherit;
    }
    input[type="text"]:focus, select:focus {
      outline: none;
      border-color: var(--accent-border);
    }
    button {
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    button:hover { background: var(--bg-hover); }
    button.primary {
      background: var(--accent);
      border-color: var(--accent-border);
      color: #ffffff;
      font-weight: 600;
    }
    button.primary:hover { background: var(--accent-hover); }
    button.btn-active {
      background: var(--amber-bg);
      border-color: var(--amber-border);
      color: var(--amber-text);
      font-weight: 600;
    }
    button.amber {
      background: var(--amber-bg);
      border-color: var(--amber-border);
      color: var(--amber-text);
      font-weight: 600;
    }
    button.amber:hover { opacity: 0.9; }
    .zoom-readout {
      padding: 0 7px;
      font-size: 11px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--text-main);
      display: inline-flex;
      align-items: center;
      min-width: 44px;
      justify-content: center;
    }
    main { flex: 1; display: flex; min-height: 0; overflow: hidden; }
    .canvas-col { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    #canvas-wrap {
      flex: 1;
      background: var(--bg-canvas);
      position: relative;
      overflow: hidden;
      contain: strict;
      isolation: isolate;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
    }
    #canvas-wrap:active { cursor: grabbing; }
    #canvas-wrap[data-transforming="true"] #svg-stage svg,
    #canvas-wrap[data-transforming="true"] #svg-stage svg * {
      pointer-events: none !important;
      transition: none !important;
    }
    #canvas-wrap[data-transforming="true"]:not([data-has-proxy="true"]) #svg-stage svg {
      shape-rendering: optimizeSpeed;
    }
    #svg-stage {
      flex-shrink: 0;
      transform-origin: center center;
      contain: layout style;
      will-change: transform;
      backface-visibility: hidden;
      padding: 32px;
    }
    #svg-stage-frame {
      position: relative;
      display: inline-block;
    }
    #svg-layer {
      visibility: visible;
    }
    #gpu-proxy-img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      object-fit: fill;
      pointer-events: none;
      visibility: hidden;
      will-change: opacity;
      backface-visibility: hidden;
      user-select: none;
      -webkit-user-drag: none;
    }
    #canvas-wrap[data-transforming="true"][data-has-proxy="true"] #svg-layer {
      visibility: hidden;
      pointer-events: none !important;
    }
    #canvas-wrap[data-transforming="true"][data-has-proxy="true"] #gpu-proxy-img {
      visibility: visible;
    }
    #svg-stage svg {
      max-width: none !important;
      display: block;
      background: transparent !important;
    }
    .preload-overlay {
      position: absolute;
      inset: 0;
      z-index: 40;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(9, 13, 22, 0.78);
      backdrop-filter: blur(5px);
    }
    html.light .preload-overlay {
      background: rgba(241, 245, 249, 0.82);
    }
    .preload-card {
      width: 100%;
      max-width: 440px;
      background: var(--bg-aside);
      border: 1px solid var(--border-strong);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .preload-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .preload-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-main);
    }
    .preload-sub {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
      line-height: 1.4;
    }
    .preload-count {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--accent-text);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .preload-track {
      width: 100%;
      height: 8px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--bg-seg);
      border: 1px solid var(--border);
    }
    .preload-fill {
      height: 100%;
      width: 0%;
      background: var(--accent);
      transition: width 120ms ease-out;
    }
    .preload-label {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .preload-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 2px;
    }
    .preload-bg-strip {
      position: absolute;
      bottom: 12px;
      left: 12px;
      z-index: 25;
      display: none;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 8px;
      background: var(--bg-aside);
      border: 1px solid var(--border-strong);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
      font-size: 11px;
      color: var(--text-main);
      max-width: 300px;
    }
    .preload-spinner {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid var(--accent-border);
      border-top-color: transparent;
      animation: preloadSpin 0.8s linear infinite;
      flex-shrink: 0;
    }
    @keyframes preloadSpin {
      to { transform: rotate(360deg); }
    }
    #svg-stage svg g.edgePaths path,
    #svg-stage svg g.edgePath path,
    #svg-stage svg path.flowchart-link {
      pointer-events: visibleStroke;
      cursor: pointer;
    }
    #svg-stage svg g.edgeLabel,
    #svg-stage svg g.edgeLabels > g {
      cursor: pointer;
    }
    aside {
      width: 392px;
      background: var(--bg-aside);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex-shrink: 0;
    }
    .aside-tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      padding: 10px 12px 8px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-header);
      flex-shrink: 0;
    }
    .aside-tab {
      background: var(--bg-seg);
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 7px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    .aside-tab:hover { color: var(--text-main); background: var(--bg-hover); }
    .aside-tab.active {
      background: var(--accent);
      border-color: var(--accent-border);
      color: #ffffff;
    }
    .tab-count {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.16);
      font-variant-numeric: tabular-nums;
    }
    .aside-tab:not(.active) .tab-count {
      background: var(--bg-hover);
      color: var(--text-main);
    }
    .tab-pane {
      display: none;
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
    }
    .tab-pane.active { display: flex; }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 11px;
    }
    .card h3 {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .filter-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .chip {
      padding: 4px 8px;
      font-size: 11px;
      border-radius: 5px;
      background: var(--bg-input);
      border: 1px solid var(--border-strong);
      color: var(--text-muted);
      cursor: pointer;
      white-space: nowrap;
    }
    .chip:hover { color: var(--text-main); }
    .chip.active {
      background: var(--accent);
      border-color: var(--accent-border);
      color: #ffffff;
      font-weight: 600;
    }
    .node-chip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      text-align: left;
      margin-top: 6px;
      padding: 7px 9px;
      border-radius: 6px;
      background: var(--bg-input);
      border: 1px solid var(--border-strong);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      color: var(--text-main);
      cursor: pointer;
      gap: 8px;
    }
    .node-chip:hover { border-color: var(--accent-border); background: var(--bg-hover); }
    .badge { font-size: 11px; color: #0284c7; flex-shrink: 0; white-space: nowrap; font-variant-numeric: tabular-nums; }
    html.dark .badge { color: #38bdf8; }
    .badge-cycle { font-size: 11px; color: #e11d48; flex-shrink: 0; white-space: nowrap; }
    html.dark .badge-cycle { color: #fb7185; }
    .row-between { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .muted-note { font-size: 11px; color: var(--text-muted); line-height: 1.45; }
    #legend-bar {
      padding: 7px 14px;
      background: var(--bg-header);
      border-top: 1px solid var(--border);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      font-size: 11px;
      color: var(--text-main);
      flex-shrink: 0;
    }
    .leg-item { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .leg-line { width: 18px; height: 0; border-top-width: 2.5px; display: inline-block; }
    .leg-count { color: var(--text-dim); font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; }
    .view-bar {
      display: ${hasMultiViews ? 'flex' : 'none'};
      align-items: center;
      gap: 6px;
      padding-right: 6px;
      border-right: 1px solid var(--border-strong);
    }
    .edge-detail-box {
      border-color: var(--amber-border);
      background: var(--bg-card);
    }
    .edge-endpoint-row {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-top: 6px;
    }
    .edge-cond-box {
      margin-top: 8px;
      padding: 7px 9px;
      border-radius: 6px;
      background: var(--bg-seg);
      border: 1px solid var(--border);
      font-size: 11.5px;
      color: var(--text-main);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      word-break: break-word;
    }
    .an-subtabs {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
    }
    .an-subtab {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 6px 4px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
    }
    .an-subtab.active {
      background: var(--accent);
      border-color: var(--accent-border);
      color: #ffffff;
    }
    .an-item {
      padding: 9px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-input);
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .an-item.sev-error { border-color: var(--err-border); background: var(--err-bg); }
    .an-item.sev-warning { border-color: var(--warn-border); background: var(--warn-bg); }
    .an-item-title { font-size: 12px; font-weight: 600; color: var(--text-main); line-height: 1.35; }
    .an-item-desc { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
    .an-tag {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      border: 1px solid var(--border-strong);
      background: var(--bg-card);
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .an-tag.err { border-color: var(--err-border); color: var(--err-text); background: var(--err-bg); }
    .an-tag.warn { border-color: var(--warn-border); color: var(--warn-text); background: var(--warn-bg); }
    .an-tag.ok { border-color: var(--ok-border); color: var(--ok-text); background: var(--ok-bg); }
    .an-table-wrap {
      overflow: auto;
      max-height: 460px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-card);
    }
    table.an-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      text-align: left;
    }
    table.an-table th {
      position: sticky;
      top: 0;
      background: var(--bg-header);
      color: var(--text-muted);
      padding: 6px 7px;
      border-bottom: 1px solid var(--border-strong);
      font-weight: 600;
      white-space: nowrap;
      z-index: 2;
    }
    table.an-table td {
      padding: 6px 7px;
      border-bottom: 1px solid var(--border);
      color: var(--text-main);
      vertical-align: top;
      font-variant-numeric: tabular-nums;
    }
    table.an-table tbody tr:nth-child(even) { background: var(--table-stripe); }
    table.an-table tbody tr.clickable { cursor: pointer; }
    table.an-table tbody tr.clickable:hover { background: var(--bg-hover); }
    .nodetype-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 9px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-input);
      cursor: pointer;
    }
    .nodetype-row:hover { border-color: var(--accent-border); }
    .nodetype-row.is-hidden { opacity: 0.55; }
    .swatch-dot {
      width: 11px;
      height: 11px;
      border-radius: 3px;
      flex-shrink: 0;
      border: 1px solid rgba(255,255,255,0.25);
    }
    @media (max-width: 960px) {
      main { flex-direction: column; }
      aside { width: 100%; height: 46vh; border-left: none; border-top: 1px solid var(--border); }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">${safeTitle} · Interaktiver Callflow</div>
    <div class="controls">
      <div class="view-bar" id="view-bar">
        <select id="view-select" title="Zwischen Ebene 1 (Master-Gesamtkarte) und Ebene 2 (Einzel-Skripte inkl. Main) wechseln"></select>
        <button id="btn-master-back" style="display:none;" title="Zurück zur Master-Gesamtkarte (Ebene 1)">← Master-Karte</button>
      </div>
      <div class="seg-group" id="pathmode-group" title="Pfad-Färbung umschalten: Modus A (Semantik) vs. Modus B (Verzweigungen)">
        <button class="seg-btn${initialPathColorMode === 'semantic' ? ' active' : ''}" data-pathmode="semantic">A: Semantik</button>
        <button class="seg-btn${initialPathColorMode === 'branches' ? ' active' : ''}" data-pathmode="branches">B: Verzweigung</button>
      </div>
      <div class="seg-group" id="dir-group" title="Richtungs-Filter">
        <button class="seg-btn active" data-dir="both">Ganzer Pfad</button>
        <button class="seg-btn" data-dir="upstream">Nur Woher</button>
        <button class="seg-btn" data-dir="downstream">Nur Wohin</button>
      </div>
      <div class="seg-group" id="hop-group" title="Ebenen-Tiefe ab Fokus-Knoten">
        <button class="seg-btn active" data-hop="all">Alle Ebenen</button>
        <button class="seg-btn" data-hop="1">1 Schritt</button>
        <button class="seg-btn" data-hop="2">2 Ebenen</button>
      </div>
      <button id="btn-isolate" class="${initialIsolateSubgraph ? 'btn-active' : ''}" title="Ausgeblendete Knoten &amp; Verbindungen komplett ausblenden (Teilgraph isolieren)">Teilgraph isoliert</button>
      <div class="seg-group" title="Zoom-Steuerung">
        <button class="seg-btn" id="btn-zoom-out" title="Verkleinern (−)">−</button>
        <span class="zoom-readout" id="zoom-readout">100%</span>
        <button class="seg-btn" id="btn-zoom-in" title="Vergrößern (+)">+</button>
      </div>
      <button id="btn-fit" title="Gesamtes Diagramm einpassen">Fit</button>
      <button id="btn-100" class="primary" title="Echte 1:1 Originalgröße">1:1</button>
      <button id="btn-theme" title="Hell/Dunkel-Darstellung umschalten">${isDarkSurface ? '☀ Hell' : '☾ Dunkel'}</button>
      <button id="btn-reset" title="Alle Filter, Auswahl &amp; Zoom zurücksetzen">Reset</button>
    </div>
  </header>
  <main>
    <div class="canvas-col">
      <div id="canvas-wrap">
        <div id="svg-stage">
          <div id="svg-stage-frame">
            <div id="svg-layer">${initialSvg}</div>
            <img id="gpu-proxy-img" alt="" decoding="sync" />
          </div>
        </div>
        <div id="preload-overlay" class="preload-overlay" style="display:none;">
          <div class="preload-card">
            <div class="preload-head">
              <div>
                <div class="preload-title">Callflow wird vorbereitet</div>
                <div class="preload-sub" id="preload-sub">Alle Ansichten &amp; GPU-Zoom-Cache werden vollständig geladen …</div>
              </div>
              <span class="preload-count" id="preload-count">0 / 0</span>
            </div>
            <div class="preload-track"><div class="preload-fill" id="preload-fill"></div></div>
            <div class="preload-label" id="preload-label">Initialisiere …</div>
            <div class="preload-actions">
              <button id="btn-preload-skip" title="Vorrendern abbrechen und sofort arbeiten">Überspringen</button>
              <button id="btn-preload-bg" class="primary" title="Ladescreen schließen und übrige Ansichten im Hintergrund vorbereiten">Im Hintergrund fortsetzen</button>
            </div>
          </div>
        </div>
        <div id="preload-bg-strip" class="preload-bg-strip">
          <span class="preload-spinner"></span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">GPU-Cache wird geladen…</span>
          <span class="preload-count" id="preload-bg-count">0/0</span>
          <button id="btn-preload-bg-cancel" style="padding:1px 6px;font-size:11px;border:none;background:transparent;" title="Abbrechen">×</button>
        </div>
      </div>
      <div id="legend-bar"></div>
    </div>
    <aside>
      <div class="aside-tabs" id="aside-tabs">
        <button class="aside-tab active" data-tab="path">Pfad</button>
        <button class="aside-tab" data-tab="analysis">Analyse <span class="tab-count" id="badge-analysis-count">0</span></button>
        <button class="aside-tab" data-tab="filter">Filter <span class="tab-count" id="badge-filter-count" style="display:none;">0</span></button>
      </div>

      <!-- TAB 1: PFAD & KNOTEN / KANTEN -->
      <div class="tab-pane active" id="tab-path">
        <div class="card">
          <h3>Skript- &amp; Knoten-Suche</h3>
          <input type="text" id="node-search" placeholder="Skript, Nummer oder Knoten suchen..." style="width:100%;margin-bottom:8px;" />
          <select id="node-select" style="width:100%;font-family:monospace;">
            <option value="">Alle Pfade anzeigen...</option>
          </select>
          <div class="filter-chips" id="role-chips">
            <button class="chip active" data-role="all">Alle</button>
            <button class="chip" data-role="entry">▶ Startpunkte</button>
            <button class="chip" data-role="hub">◆ Verteiler</button>
            <button class="chip" data-role="terminal">■ Endpunkte</button>
          </div>
          <div class="row-between" style="margin-top:10px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:var(--text-muted);">
              <input type="checkbox" id="chk-autofocus" checked />
              <span>Bei Auswahl automatisch 1:1 fokussieren</span>
            </label>
          </div>
        </div>

        <div class="card edge-detail-box" id="card-edge-detail" style="display:none;">
          <h3>
            <span style="color:var(--amber-text);">Ausgewählte Verbindung</span>
            <button id="btn-clear-edge" style="padding:2px 7px;font-size:10px;">Schließen</button>
          </h3>
          <div id="edge-detail-body"></div>
        </div>

        <div class="card">
          <h3>Aktiver Callflow-Pfad</h3>
          <div id="selected-info" class="muted-note" style="font-size:12.5px;color:var(--text-main);">
            Klicken Sie auf einen Knoten oder eine Verbindung, um Pfad, Ebenen-Tiefe und Bedingungen zu prüfen.
          </div>
          <div id="drilldown-slot" style="margin-top:8px;"></div>
        </div>

        <div class="card" id="card-entries">
          <h3 style="color:#0ea5e9;">1. Startpunkte (Ursprung)</h3>
          <div id="list-entries" class="muted-note">–</div>
        </div>
        <div class="card" id="card-callers">
          <h3 style="color:#3b82f6;">2. Direkte Aufrufer (Woher?)</h3>
          <div id="list-callers" class="muted-note">–</div>
        </div>
        <div class="card" id="card-callees">
          <h3 style="color:#10b981;">3. Direkte Folgeschritte (Wohin?)</h3>
          <div id="list-callees" class="muted-note">–</div>
        </div>
        <div class="card" id="card-terminals">
          <h3 style="color:#f43f5e;">4. Endpunkte (Terminierung)</h3>
          <div id="list-terminals" class="muted-note">–</div>
        </div>
        <div class="card" id="card-cycles" style="display:none;border-color:var(--err-border);">
          <h3 style="color:#f43f5e;">5. ↻ Erkannte Rücksprünge / Zyklen</h3>
          <div id="list-cycles" class="muted-note">–</div>
        </div>
      </div>

      <!-- TAB 2: STUDIO ANALYSE (READ-ONLY) -->
      <div class="tab-pane" id="tab-analysis">
        <div class="an-subtabs" id="an-subtabs">
          <button class="an-subtab active" data-subtab="issues">Logik</button>
          <button class="an-subtab" data-subtab="schedules">Zeiten</button>
          <button class="an-subtab" data-subtab="inventory">Inventar</button>
          <button class="an-subtab" data-subtab="matrix">Matrix</button>
        </div>
        <div id="an-body" style="display:flex;flex-direction:column;gap:9px;"></div>
      </div>

      <!-- TAB 3: KNOTEN-TYP-FILTER & ISOLATION -->
      <div class="tab-pane" id="tab-filter">
        <div class="card">
          <h3>Teilgraph &amp; Nebenpfade</h3>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text-main);margin-bottom:9px;">
            <input type="checkbox" id="chk-isolate" ${initialIsolateSubgraph ? 'checked' : ''} />
            <span>Ausgeblendete komplett wegnehmen (Teilgraph isolieren)</span>
          </label>
          <div class="row-between" style="gap:6px;">
            <select id="dim-select" style="flex:1;" title="Deckkraft nicht beteiligter Pfade (wenn nicht isoliert)">
              <option value="0.12" selected>Nebenpfade: 12%</option>
              <option value="0.30">Nebenpfade: 30%</option>
              <option value="0">Nebenpfade: Aus (0%)</option>
            </select>
            <button id="btn-show-all-types">Alle einblenden</button>
          </div>
        </div>
        <div class="card">
          <h3>Knoten-Typen ein-/ausblenden <span id="nodetype-summary" style="font-variant-numeric:tabular-nums;"></span></h3>
          <div id="nodetype-filters" style="display:flex;flex-direction:column;gap:6px;"></div>
        </div>
      </div>
    </aside>
  </main>
  <script>
    const PAYLOAD = ${safePayloadJson};
    const viewsByKey = new Map(PAYLOAD.views.map(v => [v.key, v]));
    let isDarkSurface = PAYLOAD.initialSurface !== 'light';
    let activeViewKey = PAYLOAD.initialViewKey;
    let GRAPH = viewsByKey.get(activeViewKey).graph;
    let nodeMap = new Map(GRAPH.nodes.map(n => [n.id, n]));

    const viewSelectEl = document.getElementById('view-select');
    const masterBackBtn = document.getElementById('btn-master-back');
    const selectEl = document.getElementById('node-select');
    const searchEl = document.getElementById('node-search');
    const dimSelectEl = document.getElementById('dim-select');
    const autoFocusEl = document.getElementById('chk-autofocus');
    const isolateBtn = document.getElementById('btn-isolate');
    const isolateChk = document.getElementById('chk-isolate');
    const themeBtn = document.getElementById('btn-theme');
    const zoomReadoutEl = document.getElementById('zoom-readout');
    const stage = document.getElementById('svg-stage');
    const svgLayer = document.getElementById('svg-layer');
    const gpuProxyImg = document.getElementById('gpu-proxy-img');
    const wrap = document.getElementById('canvas-wrap');
    const preloadOverlayEl = document.getElementById('preload-overlay');
    const preloadSubEl = document.getElementById('preload-sub');
    const preloadCountEl = document.getElementById('preload-count');
    const preloadFillEl = document.getElementById('preload-fill');
    const preloadLabelEl = document.getElementById('preload-label');
    const preloadBgStripEl = document.getElementById('preload-bg-strip');
    const preloadBgCountEl = document.getElementById('preload-bg-count');

    let activeAsideTab = 'path';
    let activeAnalysisSubtab = 'issues';
    let anIssueFilter = 'all';
    let anIssueSearch = '';
    let anSchedFilter = 'all';
    let anSchedSearch = '';
    let anInvCategory = 'skillsets';
    let anInvSearch = '';
    let anMatrixSearch = '';

    let activeNodeId = '';
    let activeEdge = null; // { from, to, label }
    let pathColorMode = PAYLOAD.initialPathColorMode || 'semantic';
    let directionFilter = 'both';
    let hopDepth = 'all';
    let roleFilter = 'all';
    let dimOpacity = '0.12';
    let isolateSubgraph = Boolean(PAYLOAD.initialIsolateSubgraph);
    let hiddenNodeTypes = new Set(PAYLOAD.initialHiddenNodeTypes || []);
    let currentEdgeLegend = [];

    let zoom = 1, panX = 0, panY = 0, isDragging = false, startX = 0, startY = 0, downClientX = 0, downClientY = 0, didDrag = false;
    let initialClusterStyles = new WeakMap();

    const MAX_CLEAN_PROXIES = 60;
    const normalizedSvgCache = new Map(); // viewKey -> SVGElement
    const viewThemeSigCache = new Map(); // viewKey -> string ("dark|semantic")
    const cleanProxyCache = new Map(); // viewKey -> { sig: string, url: string, lastUsedAt: number }
    let dynamicProxy = { sig: '', url: '' };
    let activeGpuProxyUrl = '';
    let proxyRefreshTimer = null;
    let proxyGenerationId = 0;
    let preloadAborted = false;
    let preloadRunning = false;

    function esc(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function escapeCsvCell(val) {
      const str = String(val == null ? '' : val).replace(/\\r?\\n/g, ' ');
      if (/[;"\\t]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }

    function downloadUtf8Csv(filename, headers, rows) {
      const lines = [headers.map(escapeCsvCell).join(';')];
      rows.forEach(r => lines.push(r.map(escapeCsvCell).join(';')));
      const bomCsv = '\\uFEFF' + lines.join('\\r\\n');
      const blob = new Blob([bomCsv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function switchAsideTab(tabId) {
      activeAsideTab = tabId;
      document.querySelectorAll('#aside-tabs .aside-tab').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
      });
      document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === 'tab-' + tabId);
      });
    }

    function syncFilterBadge() {
      const badge = document.getElementById('badge-filter-count');
      if (!badge) return;
      const cnt = hiddenNodeTypes.size + (isolateSubgraph ? 1 : 0);
      badge.style.display = cnt > 0 ? 'inline-block' : 'none';
      badge.textContent = String(cnt);
    }

    function syncIsolateUi() {
      if (isolateBtn) isolateBtn.classList.toggle('btn-active', isolateSubgraph);
      if (isolateChk) isolateChk.checked = isolateSubgraph;
      syncFilterBadge();
    }

    function inferNodeTypeFallback(g, nodeObj) {
      const existing = g.getAttribute('data-node-type');
      if (existing) return existing;
      const text = ((nodeObj ? nodeObj.label : '') + ' ' + (g.textContent || '')).toLowerCase();
      if (/missing|fehlend|out of service|fehler|error|abbruch|timeout/.test(text)) return 'error-alert';
      if (/ansage|audio|ran|musik|treatment|broadcast/.test(text)) return 'announcement';
      if (/skillset|queue|warteschlange|event/.test(text)) return 'queue';
      if (/db|datenbank|readvar|hdx|cti|route|extern/.test(text)) return 'storage';
      if (/main|start|einstieg|client|actor/.test(text) || (nodeObj && nodeObj.role === 'entry') || g.querySelector('circle, ellipse')) return 'start-actor';
      if (g.querySelector('polygon') || /\\?|bedingung|zeitplan|feiertag|dtmf|menu|gate|check|if/.test(text)) return 'decision';
      return 'core-service';
    }

    function applyExportMarkerColor(svgEl, pathEl, color) {
      pathEl.style.stroke = color;
      pathEl.setAttribute('stroke', color);
      if (!svgEl) return;
      ['marker-end', 'marker-start'].forEach(attr => {
        const sp = attr === 'marker-end' ? 'markerEnd' : 'markerStart';
        const raw = pathEl.style[sp] || pathEl.getAttribute(attr) || '';
        const m = raw.match(/#([^'")\\s]+)/);
        if (!m) return;
        const baseId = m[1].replace(/__c_[a-z0-9]+$/i, '');
        const hex = color.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'c';
        const targetId = baseId + '__c_' + hex;
        if (!Array.from(svgEl.querySelectorAll('defs marker, marker')).some(el => el.getAttribute('id') === targetId)) {
          const orig = Array.from(svgEl.querySelectorAll('defs marker, marker')).find(el => el.getAttribute('id') === baseId);
          if (orig) {
            const cl = orig.cloneNode(true);
            cl.setAttribute('id', targetId);
            cl.setAttribute('data-colored-marker', 'true');
            cl.querySelectorAll('path, polygon, circle, rect, polyline').forEach(ch => {
              const f = ch.style.fill || ch.getAttribute('fill') || '';
              if (f !== 'none') { ch.style.fill = color; ch.setAttribute('fill', color); }
              ch.style.stroke = color; ch.setAttribute('stroke', color);
            });
            (orig.parentNode || svgEl.querySelector('defs') || svgEl).appendChild(cl);
          }
        }
        const nextUrl = 'url(#' + targetId + ')';
        pathEl.setAttribute(attr, nextUrl);
        pathEl.style[sp] = nextUrl;
      });
    }

    function detectExportCycleKeys(graphRef) {
      const g = graphRef || GRAPH;
      const cycleSet = new Set();
      const adj = new Map();
      g.edges.forEach((e, i) => {
        if (!adj.has(e.from)) adj.set(e.from, []);
        adj.get(e.from).push({ e, i });
      });
      const st = new Map();
      const dfs = u => {
        st.set(u, 1);
        (adj.get(u) || []).forEach(({ e }) => {
          const s = st.get(e.to) || 0;
          if (s === 1) cycleSet.add(e.from + '->' + e.to);
          else if (s === 0) dfs(e.to);
        });
        st.set(u, 2);
      };
      g.nodes.forEach(n => { if ((st.get(n.id) || 0) === 0) dfs(n.id); });
      return cycleSet;
    }

    function computeExportBranches(cycleSet, graphRef) {
      const g = graphRef || GRAPH;
      const pal = [
        { label: 'Zweig 1 (Blau)', c: isDarkSurface ? '#38bdf8' : '#0284c7' },
        { label: 'Zweig 2 (Smaragd)', c: isDarkSurface ? '#34d399' : '#059669' },
        { label: 'Zweig 3 (Bernstein)', c: isDarkSurface ? '#fbbf24' : '#d97706' },
        { label: 'Zweig 4 (Violett)', c: isDarkSurface ? '#a78bfa' : '#7c3aed' },
        { label: 'Zweig 5 (Türkis)', c: isDarkSurface ? '#2dd4bf' : '#0d9488' },
        { label: 'Zweig 6 (Orange)', c: isDarkSurface ? '#fb923c' : '#ea580c' },
        { label: 'Zweig 7 (Pink)', c: isDarkSurface ? '#f472b6' : '#db2777' },
        { label: 'Zweig 8 (Indigo)', c: isDarkSurface ? '#818cf8' : '#4f46e5' },
      ];
      const outMap = new Map();
      const inDeg = new Map();
      g.nodes.forEach(n => inDeg.set(n.id, 0));
      g.edges.forEach((e, i) => {
        if (cycleSet.has(e.from + '->' + e.to)) return;
        if (!outMap.has(e.from)) outMap.set(e.from, []);
        outMap.get(e.from).push({ e, i });
        inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
      });
      const nodeBr = new Map();
      const edgeBr = new Map();
      const vis = new Set();
      let nextBr = 0;
      const roots = Array.from(inDeg.entries()).filter(([, d]) => d === 0).map(([id]) => id);
      const order = roots.length ? roots : Array.from(inDeg.keys());
      order.forEach(startId => {
        if (vis.has(startId)) return;
        if (!nodeBr.has(startId)) { nodeBr.set(startId, nextBr % pal.length); nextBr++; }
        const q = [startId];
        while (q.length) {
          const u = q.shift();
          if (vis.has(u)) continue;
          vis.add(u);
          const pb = nodeBr.get(u) || 0;
          const out = outMap.get(u) || [];
          out.forEach(({ e, i }, si) => {
            const b = si === 0 ? pb : (pb + si) % pal.length;
            edgeBr.set(i, b);
            if (!nodeBr.has(e.to)) nodeBr.set(e.to, b);
            if (!vis.has(e.to)) q.push(e.to);
          });
        }
      });
      return { pal, edgeBr };
    }

    function resolveGraphEdgeForElement(edgeEl, idxFallback, allEdgesRef, graphRef) {
      const g = graphRef || GRAPH;
      const df = edgeEl.getAttribute('data-edge-from') || '';
      const dt = edgeEl.getAttribute('data-edge-to') || '';
      const dl = edgeEl.getAttribute('data-edge-label') || '';
      if (df && dt) {
        const matched = g.edges.find(e => e.from === df && e.to === dt && (!dl || !e.label || e.label === dl));
        return matched || { from: df, to: dt, label: dl };
      }
      const meta = (edgeEl.getAttribute('id') || '') + ' ' + (edgeEl.getAttribute('data-id') || '') + ' ' + (edgeEl.getAttribute('class') || '');
      let codeIdx = g.edges.findIndex(e =>
        meta.includes('-' + e.from + '-' + e.to + '-') ||
        meta.includes('_' + e.from + '_' + e.to + '_') ||
        meta.includes('L_' + e.from + '_' + e.to) ||
        meta.includes('L-' + e.from + '-' + e.to)
      );
      if (codeIdx < 0 && typeof idxFallback === 'number' && idxFallback >= 0 && idxFallback < g.edges.length && (!allEdgesRef || allEdgesRef.length === g.edges.length)) {
        codeIdx = idxFallback;
      }
      return codeIdx >= 0 ? g.edges[codeIdx] : null;
    }

    function recolorExportEdges(targetSvg, targetGraph, updateLegend = true) {
      const svgEl = targetSvg || svgLayer.querySelector('svg');
      if (!svgEl) return;
      const g = targetGraph || GRAPH;
      const cycleSet = detectExportCycleKeys(g);
      const { pal, edgeBr } = computeExportBranches(cycleSet, g);
      const svgEdges = Array.from(svgEl.querySelectorAll('g.edgePaths > *, g.edgePath, path.flowchart-link'));
      const legendMap = new Map();

      svgEdges.forEach((edgeEl, idx) => {
        const ge = resolveGraphEdgeForElement(edgeEl, idx, svgEdges, g);
        const codeIdx = ge ? g.edges.indexOf(ge) : -1;
        const lbl = (ge && ge.label) || '';
        const isCyc = (ge && cycleSet.has(ge.from + '->' + ge.to)) || lbl.includes('↻') || /zyklus|cycle|schleife|loop/i.test(lbl);
        const paths = edgeEl.tagName.toLowerCase() === 'path' ? [edgeEl] : Array.from(edgeEl.querySelectorAll('path'));
        if (!paths.length) return;
        const p0 = paths[0];
        const isOrigDashed = Boolean(ge && ge.isAsync) || p0.classList.contains('edge-pattern-dotted') || p0.classList.contains('edge-pattern-dashed');

        let lid = '', llabel = '', col = '', dashed = isOrigDashed, width = '2.2px';
        if (pathColorMode === 'branches') {
          if (isCyc) {
            lid = 'branch-cycle'; llabel = 'Zyklus / Rücksprung';
            col = isDarkSurface ? '#fb7185' : '#e11d48'; dashed = true; width = '2.5px';
          } else {
            const bi = codeIdx >= 0 && edgeBr.has(codeIdx) ? edgeBr.get(codeIdx) : (idx % pal.length);
            lid = 'b-' + bi; llabel = pal[bi].label; col = pal[bi].c; width = '2.3px';
          }
        } else {
          const low = lbl.toLowerCase();
          if (isCyc) {
            lid = 's-cyc'; llabel = 'Zyklus / Rücksprung'; col = isDarkSurface ? '#fb7185' : '#e11d48'; dashed = true; width = '2.5px';
          } else if (/\\b(fehler|error|fail|out of service|oos|abort|abbruch|timeout|ungültig|invalid)\\b/i.test(low)) {
            lid = 's-err'; llabel = 'Fehler / Timeout / Abbruch'; col = isDarkSurface ? '#f43f5e' : '#dc2626'; dashed = true; width = '2.4px';
          } else if (/\\b(fallback|default|weiter|nein|no|false|sonst|else)\\b/i.test(low) || isOrigDashed) {
            lid = 's-fb'; llabel = 'Fallback / Nein / Weiter'; col = isDarkSurface ? '#fbbf24' : '#d97706'; dashed = true; width = '2.2px';
          } else if (/\\b(queue|network-queue|skillset|async|event|bus|wait|warte|musik)\\b/i.test(low)) {
            lid = 's-q'; llabel = 'Queue / Skillset / Async'; col = isDarkSurface ? '#a78bfa' : '#7c3aed'; width = '2.3px';
          } else if (/\\b(ja|yes|true|ok|match|treffer|bedingung|condition|zeitplan|feiertag|taste|dtmf|wahl|auswahl)\\b/i.test(low)) {
            lid = 's-dec'; llabel = 'Bedingung / Auswahl / Taste'; col = isDarkSurface ? '#38bdf8' : '#0284c7'; width = '2.2px';
          } else if (/\\b(route|sprung|jump|sub|include|verknüpft|wohin|transfer|cti|db|api)\\b/i.test(low)) {
            lid = 's-ext'; llabel = 'Sprung / Route / Verknüpfung'; col = isDarkSurface ? '#2dd4bf' : '#0d9488'; width = '2.3px';
          } else {
            lid = 's-flow'; llabel = 'Standard-Fluss'; col = isDarkSurface ? '#818cf8' : '#4f46e5'; width = '2px';
          }
        }

        paths.forEach(p => {
          applyExportMarkerColor(svgEl, p, col);
          p.style.strokeWidth = width;
          p.style.strokeDasharray = dashed ? '6 4' : '';
          p.dataset.origStored = '1';
          p.dataset.origStroke = col;
          p.dataset.origWidth = width;
          p.dataset.origDash = dashed ? '6 4' : '';
          p.dataset.origMarkerEnd = p.getAttribute('marker-end') || '';
          p.dataset.origMarkerStart = p.getAttribute('marker-start') || '';
        });

        const cur = legendMap.get(lid);
        if (cur) cur.count++;
        else legendMap.set(lid, { label: llabel, color: col, dashed, count: 1 });
      });

      if (updateLegend) {
        currentEdgeLegend = Array.from(legendMap.values());
        renderLegendBar(null);
      }
    }

    function applySvgSurfaceTheme(targetSvg, targetGraph, updateLegend = true) {
      const svgEl = targetSvg || svgLayer.querySelector('svg');
      if (!svgEl) return;
      const modeKey = isDarkSurface ? 'dark' : 'light';
      const palettes = PAYLOAD.semanticPalettes || {};

      svgEl.querySelectorAll('g.node, g.actor, g.statediagram-state').forEach(node => {
        const role = node.getAttribute('data-semantic-role') || 'core-service';
        const pal = palettes[role];
        if (!pal) return;
        const colors = pal[modeKey];
        const shapes = node.querySelectorAll('rect, polygon, circle, ellipse, path.label-container, path.basic, g.label-container > path');
        const targets = shapes.length ? Array.from(shapes) : Array.from(node.children).filter(el => ['rect','polygon','circle','ellipse','path'].includes(el.tagName.toLowerCase()));
        targets.forEach(s => {
          s.style.fill = colors.fill;
          s.style.stroke = colors.border;
        });
        node.querySelectorAll('text, tspan, span, p, div').forEach(t => {
          t.style.color = colors.text;
          t.style.fill = colors.text;
        });
      });

      svgEl.querySelectorAll('g.cluster').forEach(cluster => {
        if (!initialClusterStyles.has(cluster)) {
          const r = cluster.querySelector('rect');
          const lbl = cluster.querySelector('text, span, p, div');
          initialClusterStyles.set(cluster, {
            surface: PAYLOAD.initialSurface,
            fill: r ? (r.style.fill || r.getAttribute('fill') || '') : '',
            stroke: r ? (r.style.stroke || r.getAttribute('stroke') || '') : '',
            textCol: lbl ? (lbl.style.color || lbl.style.fill || '') : '',
          });
        }
        const orig = initialClusterStyles.get(cluster);
        const r = cluster.querySelector('rect');
        if (orig && orig.surface === modeKey && orig.fill) {
          if (r) { r.style.fill = orig.fill; r.style.stroke = orig.stroke; }
          cluster.querySelectorAll('text, tspan, span, p, div').forEach(t => {
            if (orig.textCol) { t.style.color = orig.textCol; t.style.fill = orig.textCol; }
          });
        } else {
          if (r) {
            r.style.fill = isDarkSurface ? 'rgba(30, 41, 59, 0.36)' : 'rgba(226, 232, 240, 0.65)';
            r.style.stroke = isDarkSurface ? '#475569' : '#64748b';
          }
          cluster.querySelectorAll('text, tspan, span, p, div').forEach(t => {
            t.style.color = isDarkSurface ? '#e2e8f0' : '#0f172a';
            t.style.fill = isDarkSurface ? '#e2e8f0' : '#0f172a';
          });
        }
      });

      svgEl.querySelectorAll('g.edgeLabel rect, g.edgeLabels rect, .labelBkg').forEach(bg => {
        bg.style.fill = isDarkSurface ? '#0f172a' : '#f8fafc';
        bg.style.backgroundColor = isDarkSurface ? '#0f172a' : '#f8fafc';
      });
      svgEl.querySelectorAll('g.edgeLabel text, g.edgeLabel span, g.edgeLabel div, g.edgeLabel p').forEach(t => {
        t.style.color = isDarkSurface ? '#e2e8f0' : '#0f172a';
        t.style.fill = isDarkSurface ? '#e2e8f0' : '#0f172a';
      });

      recolorExportEdges(svgEl, targetGraph || GRAPH, updateLegend);
    }

    function applySurfaceTheme(nextDark) {
      isDarkSurface = Boolean(nextDark);
      document.documentElement.classList.toggle('light', !isDarkSurface);
      document.documentElement.classList.toggle('dark', isDarkSurface);
      if (themeBtn) themeBtn.textContent = isDarkSurface ? '☀ Hell' : '☾ Dunkel';
      const activeSvg = svgLayer.querySelector('svg');
      applySvgSurfaceTheme(activeSvg, GRAPH, true);
      viewThemeSigCache.set(activeViewKey, (isDarkSurface ? 'dark' : 'light') + '|' + pathColorMode);
      applyCombinedCanvasState(false);
    }

    function renderLegendBar(spotlightItems) {
      const bar = document.getElementById('legend-bar');
      if (!bar) return;
      const items = spotlightItems || currentEdgeLegend;
      const prefix = spotlightItems
        ? '<strong style="color:var(--amber-text);">Aktiver Pfad:</strong>'
        : '<strong style="color:var(--accent-text);">Pfade (' + (pathColorMode === 'branches' ? 'Modus B: Verzweigung' : 'Modus A: Semantik') + '):</strong>';
      bar.innerHTML = prefix + items.map(it =>
        '<span class="leg-item"><span class="leg-line" style="border-top-color:' + it.color + ';border-top-style:' + (it.dashed ? 'dashed' : 'solid') + ';"></span><span>' + esc(it.label) + '</span>' + (it.count !== undefined ? '<span class="leg-count">(' + it.count + ')</span>' : '') + '</span>'
      ).join('');
    }

    function populateViewSelect() {
      if (!viewSelectEl) return;
      viewSelectEl.innerHTML = '';
      PAYLOAD.views.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.key;
        opt.textContent = v.label;
        viewSelectEl.appendChild(opt);
      });
      viewSelectEl.value = activeViewKey;
      if (masterBackBtn) {
        masterBackBtn.style.display = (PAYLOAD.views.length > 1 && activeViewKey !== 'master') ? 'inline-block' : 'none';
      }
    }

    function resolveNodeId(el, graphRef) {
      const gObj = graphRef || GRAPH;
      const g = el.closest('g.node, g.actor, g.statediagram-state');
      if (!g) return null;
      const cnf = g.getAttribute('data-callflow-node-id') || '';
      if (cnf && gObj.nodes.some(n => n.id === cnf)) return cnf;
      const dataId = g.getAttribute('data-id') || '';
      if (dataId && gObj.nodes.some(n => n.id === dataId)) return dataId;
      const domId = g.getAttribute('id') || '';
      const text = (g.textContent || '').replace(/\\s+/g, ' ').trim();
      const sorted = [...gObj.nodes].sort((a, b) => b.id.length - a.id.length);
      for (const n of sorted) {
        const rx = new RegExp('(?:^|[-_])' + n.id.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '(?:[-_]\\\\d+|$)', 'i');
        if (rx.test(domId)) return n.id;
      }
      for (const n of gObj.nodes) {
        if (n.label === text || n.id === text) return n.id;
      }
      return null;
    }

    function stampMissingNodeMetadata(targetSvg, targetGraph) {
      const svgEl = targetSvg || svgLayer.querySelector('svg');
      const gObj = targetGraph || GRAPH;
      if (!svgEl) return;
      const localMap = new Map(gObj.nodes.map(n => [n.id, n]));
      svgEl.querySelectorAll('g.node, g.actor, g.statediagram-state').forEach(g => {
        const nid = resolveNodeId(g, gObj);
        if (nid && !g.getAttribute('data-callflow-node-id')) {
          g.setAttribute('data-callflow-node-id', nid);
        }
        const nObj = nid ? localMap.get(nid) : null;
        if (!g.getAttribute('data-node-type')) {
          g.setAttribute('data-node-type', inferNodeTypeFallback(g, nObj));
        }
      });
    }

    function renderNodeTypeFilters() {
      const container = document.getElementById('nodetype-filters');
      const summaryEl = document.getElementById('nodetype-summary');
      if (!container) return;
      const counts = {};
      stage.querySelectorAll('g.node, g.actor, g.statediagram-state').forEach(g => {
        const nt = g.getAttribute('data-node-type') || 'core-service';
        counts[nt] = (counts[nt] || 0) + 1;
      });
      const options = PAYLOAD.nodeTypeOptions || [];
      const activeCnt = options.filter(o => !hiddenNodeTypes.has(o.id)).length;
      if (summaryEl) summaryEl.textContent = activeCnt + '/' + options.length;

      container.innerHTML = '';
      options.forEach(opt => {
        const isHidden = hiddenNodeTypes.has(opt.id);
        const cnt = counts[opt.id] || 0;
        const row = document.createElement('label');
        row.className = 'nodetype-row' + (isHidden ? ' is-hidden' : '');
        row.innerHTML =
          '<div style="display:flex;align-items:flex-start;gap:8px;min-width:0;flex:1;">' +
            '<input type="checkbox" ' + (isHidden ? '' : 'checked') + ' style="margin-top:2px;flex-shrink:0;" />' +
            '<span class="swatch-dot" style="background:' + esc(opt.swatchColor) + ';margin-top:3px;"></span>' +
            '<div style="min-width:0;">' +
              '<div style="font-size:12px;font-weight:600;color:var(--text-main);">' + esc(opt.label) + '</div>' +
              '<div style="font-size:10.5px;color:var(--text-muted);line-height:1.3;">' + esc(opt.description) + '</div>' +
            '</div>' +
          '</div>' +
          '<span class="an-tag">' + cnt + '</span>';
        row.querySelector('input').addEventListener('change', ev => {
          if (ev.target.checked) hiddenNodeTypes.delete(opt.id);
          else hiddenNodeTypes.add(opt.id);
          syncFilterBadge();
          renderNodeTypeFilters();
          applyCombinedCanvasState(false);
        });
        container.appendChild(row);
      });
    }

    function normalizeSvgElement(targetSvg, targetView, syncUi = true) {
      const viewObj = targetView || viewsByKey.get(activeViewKey);
      const svgEl = targetSvg || svgLayer.querySelector('svg');
      if (!svgEl || !viewObj) return null;
      const gObj = viewObj.graph;
      const vb = (svgEl.getAttribute('viewBox') || '').trim().split(/[\\s,]+/).map(Number);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        svgEl.setAttribute('width', Math.ceil(vb[2]) + 'px');
        svgEl.setAttribute('height', Math.ceil(vb[3]) + 'px');
        svgEl.style.width = Math.ceil(vb[2]) + 'px';
        svgEl.style.height = Math.ceil(vb[3]) + 'px';
        svgEl.style.maxWidth = 'none';
      }
      stampMissingNodeMetadata(svgEl, gObj);
      const targetThemeSig = (isDarkSurface ? 'dark' : 'light') + '|' + pathColorMode;
      if (isDarkSurface !== (PAYLOAD.initialSurface !== 'light')) {
        applySvgSurfaceTheme(svgEl, gObj, syncUi);
      } else {
        recolorExportEdges(svgEl, gObj, syncUi);
      }
      viewThemeSigCache.set(viewObj.key, targetThemeSig);

      if (!svgEl.dataset.listenersBound) {
        svgEl.dataset.listenersBound = '1';
        svgEl.querySelectorAll('g.node, g.actor, g.statediagram-state').forEach(g => {
          g.style.cursor = 'pointer';
          g.addEventListener('click', e => {
            if (didDrag) return;
            e.stopPropagation();
            const nid = resolveNodeId(g);
            if (nid) selectNode(nid, false);
          });
        });

        const svgEdges = Array.from(svgEl.querySelectorAll('g.edgePaths > *, g.edgePath, path.flowchart-link'));
        svgEdges.forEach((edgeEl, idx) => {
          edgeEl.style.cursor = 'pointer';
          edgeEl.addEventListener('click', e => {
            if (didDrag) return;
            e.stopPropagation();
            const ge = resolveGraphEdgeForElement(edgeEl, idx, svgEdges);
            if (ge) selectEdge(ge);
          });
        });

        const svgLabels = Array.from(svgEl.querySelectorAll('g.edgeLabels > *, g.edgeLabel'));
        svgLabels.forEach((lblEl, idx) => {
          lblEl.style.cursor = 'pointer';
          lblEl.addEventListener('click', e => {
            if (didDrag) return;
            e.stopPropagation();
            let ge = resolveGraphEdgeForElement(lblEl, idx, svgLabels);
            if (!ge && svgLabels.length === svgEdges.length && idx < svgEdges.length) {
              ge = resolveGraphEdgeForElement(svgEdges[idx], idx, svgEdges);
            }
            if (ge) selectEdge(ge);
          });
        });
      }

      normalizedSvgCache.set(viewObj.key, svgEl);
      if (syncUi) renderNodeTypeFilters();
      return svgEl;
    }

    function setActiveGpuProxy(url) {
      activeGpuProxyUrl = url || '';
      if (url && gpuProxyImg) {
        if (gpuProxyImg.src !== url) gpuProxyImg.src = url;
        wrap.dataset.hasProxy = 'true';
      } else {
        if (gpuProxyImg) gpuProxyImg.removeAttribute('src');
        delete wrap.dataset.hasProxy;
      }
    }

    function isViewInCleanOverviewState() {
      return !activeNodeId && !activeEdge && hiddenNodeTypes.size === 0 && !isolateSubgraph && roleFilter === 'all' && !(searchEl.value || '').trim();
    }

    function buildCurrentStateProxySig() {
      const edgeStr = activeEdge ? (activeEdge.from + '->' + activeEdge.to) : '';
      const hiddenStr = hiddenNodeTypes.size ? Array.from(hiddenNodeTypes).sort().join(',') : '';
      return [
        activeViewKey,
        isDarkSurface ? 'dark' : 'light',
        pathColorMode,
        activeNodeId,
        edgeStr,
        hiddenStr,
        isolateSubgraph ? '1' : '0',
        directionFilter,
        hopDepth,
        dimOpacity,
        roleFilter,
        (searchEl.value || '').trim(),
      ].join('|');
    }

    function isProxyUrlReferencedInCleanCache(url) {
      for (const entry of cleanProxyCache.values()) {
        if (entry.url === url) return true;
      }
      return false;
    }

    function enforceCleanProxyCacheCap() {
      if (cleanProxyCache.size <= MAX_CLEAN_PROXIES) return;
      const entries = Array.from(cleanProxyCache.entries()).sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
      for (const [k, entry] of entries) {
        if (cleanProxyCache.size <= MAX_CLEAN_PROXIES) break;
        if (k === activeViewKey || k === 'master') continue;
        cleanProxyCache.delete(k);
        if (entry.url && entry.url !== activeGpuProxyUrl && dynamicProxy.url !== entry.url) {
          URL.revokeObjectURL(entry.url);
        }
      }
    }

    function rasterizeSvgElToGpuProxy(svgEl) {
      if (!svgEl) return Promise.resolve(null);
      try {
        const clone = svgEl.cloneNode(true);
        if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const vb = (clone.getAttribute('viewBox') || '').trim().split(/[\\s,]+/).map(Number);
        let width = parseFloat(clone.getAttribute('width') || '0');
        let height = parseFloat(clone.getAttribute('height') || '0');
        if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
          width = Math.ceil(vb[2]);
          height = Math.ceil(vb[3]);
          clone.setAttribute('viewBox', vb[0] + ' ' + vb[1] + ' ' + width + ' ' + height);
        } else {
          width = Math.max(1, Math.ceil(width || 1200));
          height = Math.max(1, Math.ceil(height || 800));
        }
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));
        clone.style.width = width + 'px';
        clone.style.height = height + 'px';
        clone.style.maxWidth = 'none';

        const serialized = new XMLSerializer().serializeToString(clone);
        const utf8 = new TextEncoder().encode(serialized);
        let bin = '';
        for (let i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i]);
        const dataUrl = 'data:image/svg+xml;base64,' + window.btoa(bin);

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const desired = Math.max(1.25, dpr);
        const maxDim = 4096;
        const scale = Math.max(0.25, Math.min(desired, maxDim / Math.max(1, width), maxDim / Math.max(1, height)));
        const tw = Math.max(1, Math.round(width * scale));
        const th = Math.max(1, Math.round(height * scale));

        return new Promise(resolve => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = tw;
              canvas.height = th;
              const ctx = canvas.getContext('2d');
              if (!ctx) { resolve(null); return; }
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(img, 0, 0, tw, th);
              const handleBlob = blob => {
                if (!blob) { resolve(null); return; }
                const objectUrl = URL.createObjectURL(blob);
                const pre = new Image();
                pre.src = objectUrl;
                const finish = () => resolve(objectUrl);
                if (typeof pre.decode === 'function') pre.decode().then(finish).catch(finish);
                else finish();
              };
              canvas.toBlob(wb => {
                if (wb) handleBlob(wb);
                else canvas.toBlob(handleBlob, 'image/png', 0.92);
              }, 'image/webp', 0.92);
            } catch {
              resolve(null);
            }
          };
          img.onerror = () => resolve(null);
          img.src = dataUrl;
        });
      } catch {
        return Promise.resolve(null);
      }
    }

    function scheduleActiveProxySync(delayMs) {
      if (proxyRefreshTimer !== null) {
        clearTimeout(proxyRefreshTimer);
        proxyRefreshTimer = null;
      }
      const themeSig = (isDarkSurface ? 'dark' : 'light') + '|' + pathColorMode;
      if (isViewInCleanOverviewState()) {
        const hit = cleanProxyCache.get(activeViewKey);
        if (hit && hit.sig === themeSig && hit.url) {
          hit.lastUsedAt = Date.now();
          setActiveGpuProxy(hit.url);
          return;
        }
      }
      const fullSig = buildCurrentStateProxySig();
      if (dynamicProxy.sig === fullSig && dynamicProxy.url) {
        setActiveGpuProxy(dynamicProxy.url);
        return;
      }

      setActiveGpuProxy(null);
      const reqId = ++proxyGenerationId;
      proxyRefreshTimer = setTimeout(async () => {
        proxyRefreshTimer = null;
        const svgEl = svgLayer.querySelector('svg');
        if (!svgEl) return;
        const url = await rasterizeSvgElToGpuProxy(svgEl);
        if (!url) return;
        if (reqId !== proxyGenerationId || buildCurrentStateProxySig() !== fullSig) {
          if (!isProxyUrlReferencedInCleanCache(url)) URL.revokeObjectURL(url);
          return;
        }
        const prevDynUrl = dynamicProxy.url;
        dynamicProxy = { sig: fullSig, url };
        if (isViewInCleanOverviewState()) {
          const prevClean = cleanProxyCache.get(activeViewKey);
          cleanProxyCache.set(activeViewKey, { sig: themeSig, url, lastUsedAt: Date.now() });
          if (prevClean && prevClean.url && prevClean.url !== url && dynamicProxy.url !== prevClean.url) {
            URL.revokeObjectURL(prevClean.url);
          }
          enforceCleanProxyCacheCap();
        }
        setActiveGpuProxy(url);
        if (prevDynUrl && prevDynUrl !== url && !isProxyUrlReferencedInCleanCache(prevDynUrl)) {
          URL.revokeObjectURL(prevDynUrl);
        }
      }, typeof delayMs === 'number' ? delayMs : 90);
    }

    function switchView(nextKey) {
      const nextView = viewsByKey.get(nextKey);
      if (!nextView) return;
      activeViewKey = nextKey;
      GRAPH = nextView.graph;
      nodeMap = new Map(GRAPH.nodes.map(n => [n.id, n]));
      activeNodeId = '';
      activeEdge = null;

      let cachedSvg = normalizedSvgCache.get(nextKey);
      if (cachedSvg) {
        svgLayer.replaceChildren(cachedSvg);
        const curThemeSig = (isDarkSurface ? 'dark' : 'light') + '|' + pathColorMode;
        if (viewThemeSigCache.get(nextKey) !== curThemeSig) {
          applySvgSurfaceTheme(cachedSvg, GRAPH, true);
          viewThemeSigCache.set(nextKey, curThemeSig);
        } else {
          recolorExportEdges(cachedSvg, GRAPH, true);
        }
        renderNodeTypeFilters();
      } else {
        svgLayer.innerHTML = nextView.svg;
        normalizeSvgElement(svgLayer.querySelector('svg'), nextView, true);
      }

      populateViewSelect();
      populateSelect();
      applyCombinedCanvasState(false);
      fitToWindow();
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

    let transformRafId = null;
    let zoomLabelTimer = null;
    let transformIdleTimer = null;

    function updateZoomReadouts() {
      const pct = Math.round(zoom * 100) + '%';
      if (zoomReadoutEl) zoomReadoutEl.textContent = pct;
      const b100 = document.getElementById('btn-100');
      if (b100) b100.textContent = '1:1';
    }

    function applyTransformImmediate() {
      stage.style.transform = 'translate3d(' + panX + 'px,' + panY + 'px,0) scale(' + zoom + ')';
    }

    function updateTransform(activeGesture) {
      if (activeGesture) {
        wrap.dataset.transforming = 'true';
        if (transformIdleTimer !== null) clearTimeout(transformIdleTimer);
        transformIdleTimer = setTimeout(() => {
          transformIdleTimer = null;
          delete wrap.dataset.transforming;
        }, 120);
        if (transformRafId === null) {
          transformRafId = requestAnimationFrame(() => {
            transformRafId = null;
            applyTransformImmediate();
          });
        }
        if (zoomLabelTimer !== null) clearTimeout(zoomLabelTimer);
        zoomLabelTimer = setTimeout(() => {
          zoomLabelTimer = null;
          updateZoomReadouts();
        }, 80);
        return;
      }
      if (transformIdleTimer !== null) {
        clearTimeout(transformIdleTimer);
        transformIdleTimer = null;
      }
      delete wrap.dataset.transforming;
      applyTransformImmediate();
      updateZoomReadouts();
    }

    function zoomBy(factor) {
      const nextZoom = Math.min(20, Math.max(0.05, zoom * factor));
      const ratio = nextZoom / Math.max(0.05, zoom);
      panX = panX * ratio;
      panY = panY * ratio;
      zoom = nextZoom;
      updateTransform(false);
    }

    function fitToWindow() {
      const svgEl = stage.querySelector('svg');
      if (!svgEl) return;
      const rect = wrap.getBoundingClientRect();
      const w = parseFloat(svgEl.getAttribute('width') || '1200');
      const h = parseFloat(svgEl.getAttribute('height') || '800');
      const scaleX = Math.max(100, rect.width - 64) / Math.max(1, w);
      const scaleY = Math.max(100, rect.height - 64) / Math.max(1, h);
      zoom = Math.min(2.0, Math.max(0.05, Math.min(scaleX, scaleY)));
      panX = 0;
      panY = 0;
      updateTransform(false);
    }

    function focusNodeCamera(targetId) {
      if (!targetId) return;
      const allSvgNodes = Array.from(stage.querySelectorAll('g.node, g.actor, g.statediagram-state'));
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
      updateTransform(false);
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
      updateTransform(true);
    }, { passive: false });

    wrap.addEventListener('mousedown', e => {
      isDragging = true;
      didDrag = false;
      downClientX = e.clientX;
      downClientY = e.clientY;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
    });
    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const dist = Math.hypot(e.clientX - downClientX, e.clientY - downClientY);
      if (dist > 4) didDrag = true;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      updateTransform(dist > 2 || didDrag);
    });
    window.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      updateTransform(false);
      setTimeout(() => { didDrag = false; }, 0);
    });
    wrap.addEventListener('click', e => {
      if (didDrag) return;
      if (!e.target.closest('g.node, g.actor, g.statediagram-state, g.edgePaths > *, g.edgePath, path.flowchart-link, g.edgeLabels > *, g.edgeLabel')) {
        if (activeNodeId || activeEdge) {
          activeNodeId = '';
          activeEdge = null;
          selectEl.value = '';
          applyCombinedCanvasState(false);
        }
      }
    });

    document.getElementById('btn-zoom-in').addEventListener('click', () => zoomBy(1.25));
    document.getElementById('btn-zoom-out').addEventListener('click', () => zoomBy(0.8));
    document.getElementById('btn-fit').addEventListener('click', fitToWindow);
    document.getElementById('btn-100').addEventListener('click', () => { zoom = 1; panX = 0; panY = 0; updateTransform(false); });
    themeBtn.addEventListener('click', () => applySurfaceTheme(!isDarkSurface));

    function matchesEdge(el, edgeList) {
      const df = el.getAttribute('data-edge-from') || '';
      const dt = el.getAttribute('data-edge-to') || '';
      const dl = el.getAttribute('data-edge-label') || '';
      if (df && dt) {
        return edgeList.some(e => e.from === df && e.to === dt && (!e.label || !dl || e.label === dl));
      }
      const meta = (el.getAttribute('id') || '') + ' ' + (el.getAttribute('data-id') || '') + ' ' + (el.getAttribute('class') || '');
      for (const e of edgeList) {
        if (meta.includes('-' + e.from + '-' + e.to + '-') || meta.includes('_' + e.from + '_' + e.to + '_') || meta.includes('L_' + e.from + '_' + e.to) || meta.includes('L-' + e.from + '-' + e.to)) {
          return true;
        }
      }
      return false;
    }

    function restoreEdgeDefaults(edgeEl) {
      const paths = edgeEl.tagName.toLowerCase() === 'path' ? [edgeEl] : Array.from(edgeEl.querySelectorAll('path'));
      paths.forEach(p => {
        if (p.dataset.origStroke !== undefined) {
          p.style.stroke = p.dataset.origStroke;
          p.setAttribute('stroke', p.dataset.origStroke);
        }
        if (p.dataset.origWidth !== undefined) p.style.strokeWidth = p.dataset.origWidth;
        if (p.dataset.origDash !== undefined) p.style.strokeDasharray = p.dataset.origDash;
        if (p.dataset.origMarkerEnd !== undefined) {
          if (p.dataset.origMarkerEnd) { p.setAttribute('marker-end', p.dataset.origMarkerEnd); p.style.markerEnd = p.dataset.origMarkerEnd; }
          else { p.removeAttribute('marker-end'); p.style.markerEnd = ''; }
        }
        if (p.dataset.origMarkerStart !== undefined) {
          if (p.dataset.origMarkerStart) { p.setAttribute('marker-start', p.dataset.origMarkerStart); p.style.markerStart = p.dataset.origMarkerStart; }
          else { p.removeAttribute('marker-start'); p.style.markerStart = ''; }
        }
      });
    }

    function renderList(containerId, items) {
      const el = document.getElementById(containerId);
      el.innerHTML = '';
      if (!items.length) { el.textContent = 'Keine'; return; }
      items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'node-chip';
        btn.innerHTML = '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(item.label) + '</span><span class="badge">' + esc(item.badge || 'Fokus →') + '</span>';
        btn.onclick = () => { selectNode(item.id, true); };
        el.appendChild(btn);
      });
    }

    function renderEdgeDetailCard() {
      const card = document.getElementById('card-edge-detail');
      const body = document.getElementById('edge-detail-body');
      if (!card || !body) return;
      if (!activeEdge) {
        card.style.display = 'none';
        body.innerHTML = '';
        return;
      }
      const fromN = nodeMap.get(activeEdge.from);
      const toN = nodeMap.get(activeEdge.to);
      card.style.display = 'block';

      // Find relevant Sonderparameter for this transition
      const dt = PAYLOAD.drillTargetsByNodeId ? PAYLOAD.drillTargetsByNodeId[activeEdge.from] : null;
      const activeView = viewsByKey.get(activeViewKey);
      const scriptNum = dt
        ? dt.scriptRef
        : (activeView && activeView.scriptNumber
          ? activeView.scriptNumber
          : activeEdge.from.replace(/^(?:S|JUMP|INC|SELF|STEP)_/, '').split('_')[0]);

      const an = PAYLOAD.analysis;
      const paramsMap = an ? (an.parametersByScript || (an.registry ? an.registry.parametersByScript : null)) : null;
      const fromParams = paramsMap ? (paramsMap[scriptNum] || paramsMap[String(scriptNum).toLowerCase()] || []) : [];

      const edgeRelevantParams = [];
      const toClean = (toN ? toN.label : activeEdge.to).toLowerCase();
      const lblClean = (activeEdge.label || '').toLowerCase();

      fromParams.forEach(p => {
        const valClean = (p.rawValue || p.value).toLowerCase();
        if (p.category === 'overflow' && (lblClean.includes('überlauf') || lblClean.includes('overflow') || toClean.includes(valClean))) {
          edgeRelevantParams.push(p);
        } else if (p.key === 'Sys_Retour_Zentrale' && (lblClean.includes('retour') || lblClean.includes('zentrale') || toClean.includes(valClean))) {
          edgeRelevantParams.push(p);
        } else if ((p.key === 'Sys_SondStat' || p.key === 'Sys_SondZeit' || p.key === 'Sys_SondRouting') && (lblClean.includes('🕒') || lblClean.includes('📅') || lblClean.includes('zeit') || lblClean.includes('feiertag') || lblClean.includes('sond'))) {
          edgeRelevantParams.push(p);
        } else if (lblClean.includes(p.key.toLowerCase())) {
          edgeRelevantParams.push(p);
        }
      });

      const paramsBlock = edgeRelevantParams.length > 0
        ? '<div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border);">' +
            '<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin-bottom:4px;">Gekoppelte Sonderparameter</div>' +
            '<div style="display:flex;flex-direction:column;gap:3px;">' +
            edgeRelevantParams.map(p =>
              '<div style="display:flex;justify-content:space-between;padding:3px 6px;border-radius:4px;background:var(--chip-bg);font-size:11px;">' +
                '<span><strong style="color:var(--text);">' + esc(p.label) + '</strong> <span style="font-size:10px;color:var(--text-muted);font-family:monospace;">(' + esc(p.key) + ')</span></span>' +
                '<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;color:var(--accent,#38bdf8);">' + esc(p.value) + '</span>' +
              '</div>'
            ).join('') +
            '</div>' +
          '</div>'
        : '';

      body.innerHTML =
        '<div class="edge-endpoint-row">' +
          '<button class="node-chip" id="btn-edge-from"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Von: ' + esc(fromN ? fromN.label : activeEdge.from) + '</span><span class="badge">Fokus →</span></button>' +
          '<button class="node-chip" id="btn-edge-to"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Nach: ' + esc(toN ? toN.label : activeEdge.to) + '</span><span class="badge">Fokus →</span></button>' +
        '</div>' +
        '<div class="edge-cond-box">' +
          '<div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;margin-bottom:3px;">Bedingung / Übergangslabel</div>' +
          esc(activeEdge.label || 'Standardübergang (ohne Bedingung)') +
        '</div>' +
        paramsBlock;
      document.getElementById('btn-edge-from').onclick = () => selectNode(activeEdge.from, true);
      document.getElementById('btn-edge-to').onclick = () => selectNode(activeEdge.to, true);
    }

    function renderNodeSpecialParameters(targetNodeId) {
      const drillSlot = document.getElementById('drilldown-slot');
      if (!drillSlot) return;
      const nObj = nodeMap.get(targetNodeId);
      if (!nObj) { drillSlot.innerHTML = ''; return; }

      // Resolve script number for targetNodeId
      const dt = PAYLOAD.drillTargetsByNodeId ? PAYLOAD.drillTargetsByNodeId[targetNodeId] : null;
      const activeView = viewsByKey.get(activeViewKey);
      const scriptNum = dt
        ? dt.scriptRef
        : (activeView && activeView.scriptNumber
          ? activeView.scriptNumber
          : targetNodeId.replace(/^(?:S|JUMP|INC|SELF|STEP)_/, '').split('_')[0]);

      const an = PAYLOAD.analysis;
      const paramsMap = an ? (an.parametersByScript || (an.registry ? an.registry.parametersByScript : null)) : null;
      const paramsList = paramsMap ? (paramsMap[scriptNum] || paramsMap[String(scriptNum).toLowerCase()] || []) : [];

      if (!paramsList || paramsList.length === 0) {
        drillSlot.innerHTML = '';
        return;
      }

      const categories = [
        { key: 'overflow', title: 'Überlauf & Schwellenwerte', icon: '⏱️' },
        { key: 'routing', title: 'Routing & Zentralen', icon: '📞' },
        { key: 'schedule', title: 'Öffnungszeiten & Status', icon: '🕒' },
        { key: 'media', title: 'Audio, Musik & Gründe', icon: '🎵' },
        { key: 'custom', title: 'Skript-Variablen', icon: '⚙️' },
      ];

      let html = '<div class="card param-card" style="margin-top:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--card-bg);">';
      html += '<div class="row-between" style="margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border);">';
      html += '<div style="font-size:12px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:6px;">';
      html += '<span>⚙️ Sonderparameter</span>';
      html += '<span style="font-size:11px;font-weight:400;color:var(--text-muted);font-family:monospace;">[' + esc(scriptNum) + ']</span>';
      html += '</div>';
      html += '<span style="font-size:10px;color:var(--text-muted);">' + paramsList.length + ' Parameter</span>';
      html += '</div>';

      categories.forEach(cat => {
        const inCat = paramsList.filter(p => p.category === cat.key);
        if (!inCat.length) return;
        html += '<div style="margin-top:7px;margin-bottom:3px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);">' + cat.icon + ' ' + esc(cat.title) + '</div>';
        html += '<div style="display:flex;flex-direction:column;gap:4px;">';
        inCat.forEach(p => {
          html += '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 6px;border-radius:4px;background:var(--chip-bg);font-size:11px;gap:8px;">';
          html += '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;">';
          html += '<span style="font-weight:500;color:var(--text);">' + esc(p.label) + '</span>';
          html += ' <span style="font-size:10px;color:var(--text-muted);font-family:monospace;">(' + esc(p.key) + ')</span>';
          html += '</div>';
          html += '<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;color:var(--accent,#38bdf8);white-space:nowrap;text-align:right;">';
          html += esc(p.value);
          html += '</div>';
          html += '</div>';
        });
        html += '</div>';
      });

      html += '</div>';
      drillSlot.innerHTML = html;
    }

    function updateClusterVisibility(visibleSvgNodes) {
      const clusters = Array.from(stage.querySelectorAll('g.cluster'));
      if (!clusters.length) return;
      const shouldPrune = hiddenNodeTypes.size > 0 || (isolateSubgraph && (Boolean(activeNodeId) || Boolean(activeEdge) || roleFilter !== 'all' || Boolean((searchEl.value || '').trim())));
      if (!shouldPrune) {
        clusters.forEach(c => { c.style.display = ''; });
        return;
      }
      const visCenters = visibleSvgNodes.map(n => {
        try {
          const b = n.getBBox();
          const ctm = n.getCTM();
          if (ctm) {
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            return { x: cx, y: cy, el: n };
          }
          return { x: b.x + b.width / 2, y: b.y + b.height / 2, el: n };
        } catch {
          return null;
        }
      }).filter(Boolean);

      clusters.forEach(c => {
        const innerMatch = Array.from(c.querySelectorAll('g.node, g.actor, g.statediagram-state')).some(n => n.style.display !== 'none');
        if (innerMatch) { c.style.display = ''; return; }
        try {
          const cb = c.getBBox();
          const hasAnyVis = visCenters.some(p => p.x >= cb.x && p.x <= cb.x + cb.width && p.y >= cb.y && p.y <= cb.y + cb.height);
          c.style.display = hasAnyVis ? '' : 'none';
        } catch {
          c.style.display = '';
        }
      });
    }

    function selectEdge(edgeObj) {
      activeEdge = edgeObj;
      activeNodeId = '';
      selectEl.value = '';
      switchAsideTab('path');
      applyCombinedCanvasState(false);
    }

    function selectNode(targetId, shouldFocusCamera = false) {
      activeEdge = null;
      activeNodeId = targetId || '';
      selectEl.value = activeNodeId;
      applyCombinedCanvasState(shouldFocusCamera);
    }

    function applyCombinedCanvasState(shouldFocusCamera = false) {
      applyCombinedCanvasStateInner(shouldFocusCamera);
      scheduleActiveProxySync(isViewInCleanOverviewState() ? 35 : 95);
    }

    function applyCombinedCanvasStateInner(shouldFocusCamera = false) {
      const allSvgNodes = Array.from(stage.querySelectorAll('g.node, g.actor, g.statediagram-state'));
      const allSvgEdges = Array.from(stage.querySelectorAll('g.edgePaths > *, g.edgePath, path.flowchart-link'));
      const allSvgLabels = Array.from(stage.querySelectorAll('g.edgeLabels > *, g.edgeLabel'));
      const drillSlot = document.getElementById('drilldown-slot');
      const cycleCard = document.getElementById('card-cycles');
      const cycleList = document.getElementById('list-cycles');
      const svgElRef = stage.querySelector('svg');

      allSvgEdges.forEach(restoreEdgeDefaults);
      renderEdgeDetailCard();

      // Determine node IDs blocked by node-type filter
      const allowedByType = new Set();
      allSvgNodes.forEach(g => {
        const nid = resolveNodeId(g);
        const nt = g.getAttribute('data-node-type') || 'core-service';
        const isAllowed = !hiddenNodeTypes.has(nt);
        if (isAllowed && nid) allowedByType.add(nid);
      });

      const isEdgeAllowedByType = edgeEl => {
        if (hiddenNodeTypes.size === 0) return true;
        const ge = resolveGraphEdgeForElement(edgeEl, -1, allSvgEdges);
        if (!ge) return true;
        return allowedByType.has(ge.from) && allowedByType.has(ge.to);
      };

      // Case 1: Edge Click Detail Mode (no active node spotlight)
      if (!activeNodeId && activeEdge) {
        const endSet = new Set([activeEdge.from, activeEdge.to]);
        const visibleSvgNodes = [];
        allSvgNodes.forEach(g => {
          const nid = resolveNodeId(g);
          const nt = g.getAttribute('data-node-type') || 'core-service';
          if (hiddenNodeTypes.has(nt)) { g.style.display = 'none'; return; }
          const hit = nid && endSet.has(nid);
          if (hit) {
            g.style.display = '';
            g.style.opacity = '1';
            visibleSvgNodes.push(g);
          } else {
            g.style.display = isolateSubgraph ? 'none' : '';
            g.style.opacity = dimOpacity;
          }
        });

        const activeIdx = new Set();
        allSvgEdges.forEach((edgeEl, idx) => {
          if (!isEdgeAllowedByType(edgeEl)) { edgeEl.style.display = 'none'; return; }
          const hit = matchesEdge(edgeEl, [activeEdge]);
          if (hit) {
            activeIdx.add(idx);
            edgeEl.style.display = '';
            edgeEl.style.opacity = '1';
            const amberCol = isDarkSurface ? '#fbbf24' : '#d97706';
            const paths = edgeEl.tagName.toLowerCase() === 'path' ? [edgeEl] : Array.from(edgeEl.querySelectorAll('path'));
            paths.forEach(p => {
              applyExportMarkerColor(svgElRef, p, amberCol);
              p.style.strokeWidth = '3.5px';
            });
          } else {
            edgeEl.style.display = isolateSubgraph ? 'none' : '';
            edgeEl.style.opacity = dimOpacity;
          }
        });

        allSvgLabels.forEach((lblEl, idx) => {
          const hit = matchesEdge(lblEl, [activeEdge]) || (allSvgLabels.length === allSvgEdges.length && activeIdx.has(idx));
          if (!isEdgeAllowedByType(lblEl)) { lblEl.style.display = 'none'; return; }
          lblEl.style.display = (!hit && isolateSubgraph) ? 'none' : '';
          lblEl.style.opacity = hit ? '1' : dimOpacity;
        });

        updateClusterVisibility(visibleSvgNodes);
        renderLegendBar([{ label: 'Ausgewählte Verbindung', color: isDarkSurface ? '#fbbf24' : '#d97706', dashed: false, count: 1 }]);
        const fromN = nodeMap.get(activeEdge.from);
        const toN = nodeMap.get(activeEdge.to);
        document.getElementById('selected-info').innerHTML =
          'Verbindung: <strong style="color:var(--amber-text)">' + esc(fromN ? fromN.label : activeEdge.from) + ' → ' + esc(toN ? toN.label : activeEdge.to) + '</strong>';
        drillSlot.innerHTML = '';
        cycleCard.style.display = 'none';
        return;
      }

      // Case 2: No active node & no active edge (Overview / Search / Role / Type Filter)
      if (!activeNodeId || !nodeMap.has(activeNodeId)) {
        const q = (searchEl.value || '').trim().toLowerCase();
        const hasSearchOrRole = roleFilter !== 'all' || Boolean(q);
        const visibleSvgNodes = [];
        allSvgNodes.forEach(g => {
          const nt = g.getAttribute('data-node-type') || 'core-service';
          if (hiddenNodeTypes.has(nt)) {
            g.style.display = 'none';
            return;
          }
          const nid = resolveNodeId(g);
          const nObj = nid ? nodeMap.get(nid) : null;
          const matchRole = roleFilter === 'all' || (nObj && nObj.role === roleFilter);
          const matchSearch = !q || (nObj && (nObj.label.toLowerCase().includes(q) || nObj.id.toLowerCase().includes(q)));
          const ok = matchRole && matchSearch;
          if (!ok && isolateSubgraph && hasSearchOrRole) {
            g.style.display = 'none';
          } else {
            g.style.display = '';
            g.style.opacity = ok ? '1' : dimOpacity;
            if (ok) visibleSvgNodes.push(g);
          }
        });

        const hiddenEdgeIdx = new Set();
        allSvgEdges.forEach((edgeEl, idx) => {
          if (!isEdgeAllowedByType(edgeEl)) {
            hiddenEdgeIdx.add(idx);
            edgeEl.style.display = 'none';
            return;
          }
          if (hasSearchOrRole && isolateSubgraph) {
            const ge = resolveGraphEdgeForElement(edgeEl, idx, allSvgEdges);
            const matchSrcDest = ge && visibleSvgNodes.some(vn => resolveNodeId(vn) === ge.from) && visibleSvgNodes.some(vn => resolveNodeId(vn) === ge.to);
            if (!matchSrcDest) { edgeEl.style.display = 'none'; hiddenEdgeIdx.add(idx); return; }
          }
          edgeEl.style.display = '';
          edgeEl.style.opacity = !hasSearchOrRole ? '1' : dimOpacity;
        });

        allSvgLabels.forEach((lblEl, idx) => {
          if (hiddenEdgeIdx.has(idx) && allSvgLabels.length === allSvgEdges.length) {
            lblEl.style.display = 'none';
            return;
          }
          if (!isEdgeAllowedByType(lblEl)) { lblEl.style.display = 'none'; return; }
          lblEl.style.display = '';
          lblEl.style.opacity = !hasSearchOrRole ? '1' : dimOpacity;
        });

        updateClusterVisibility(visibleSvgNodes);
        renderLegendBar(null);

        document.getElementById('selected-info').innerHTML =
          '<strong>' + visibleSvgNodes.length + ' von ' + GRAPH.nodes.length + ' Knoten</strong> und <strong>' + GRAPH.edges.length + ' Verbindungen</strong> im Diagramm.';
        drillSlot.innerHTML = '';
        cycleCard.style.display = 'none';
        const filterFn = n => (!q || n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) && allowedByType.has(n.id);
        renderList('list-entries', GRAPH.nodes.filter(n => n.inDegree === 0 && filterFn(n)).map(n => ({ ...n, badge: n.outDegree + ' Ausgänge' })));
        renderList('list-callers', []);
        renderList('list-callees', []);
        renderList('list-terminals', GRAPH.nodes.filter(n => n.outDegree === 0 && filterFn(n)).map(n => ({ ...n, badge: n.inDegree + ' Eingänge' })));
        return;
      }

      // Case 3: Active Node Spotlight (BFS + 3-Color Cycle Detection + Isolation + Node-Type filter)
      const upDepth = new Map([[activeNodeId, 0]]);
      const qUp = [{ id: activeNodeId, depth: 0 }];
      const upEdgesAll = [];
      const cycles = [];
      const cycleKeys = new Set();

      while (qUp.length) {
        const { id: c, depth } = qUp.shift();
        GRAPH.edges.forEach(e => {
          if (e.to !== c) return;
          upEdgesAll.push(e);
          if (!upDepth.has(e.from)) {
            upDepth.set(e.from, depth + 1);
            qUp.push({ id: e.from, depth: depth + 1 });
          }
        });
      }

      const upState = new Map();
      const dfsUp = u => {
        upState.set(u, 1);
        GRAPH.edges.forEach(e => {
          if (e.to !== u) return;
          const st = upState.get(e.from) || 0;
          if (st === 1) {
            const k = 'up:' + e.from + '->' + e.to;
            if (!cycleKeys.has(k)) { cycleKeys.add(k); cycles.push(e); }
          } else if (st === 0) dfsUp(e.from);
        });
        upState.set(u, 2);
      };
      dfsUp(activeNodeId);

      const downDepth = new Map([[activeNodeId, 0]]);
      const qDown = [{ id: activeNodeId, depth: 0 }];
      const downEdgesAll = [];

      while (qDown.length) {
        const { id: c, depth } = qDown.shift();
        GRAPH.edges.forEach(e => {
          if (e.from !== c) return;
          downEdgesAll.push(e);
          if (!downDepth.has(e.to)) {
            downDepth.set(e.to, depth + 1);
            qDown.push({ id: e.to, depth: depth + 1 });
          }
        });
      }

      const downState = new Map();
      const dfsDown = u => {
        downState.set(u, 1);
        GRAPH.edges.forEach(e => {
          if (e.from !== u) return;
          const st = downState.get(e.to) || 0;
          if (st === 1) {
            const k = 'down:' + e.from + '->' + e.to;
            if (!cycleKeys.has(k)) { cycleKeys.add(k); cycles.push(e); }
          } else if (st === 0) dfsDown(e.to);
        });
        downState.set(u, 2);
      };
      dfsDown(activeNodeId);

      const maxHops = hopDepth === 'all' ? Infinity : Number(hopDepth);
      const visibleNodes = new Set([activeNodeId]);
      if (directionFilter === 'both' || directionFilter === 'upstream') {
        upDepth.forEach((d, id) => { if (d <= maxHops) visibleNodes.add(id); });
      }
      if (directionFilter === 'both' || directionFilter === 'downstream') {
        downDepth.forEach((d, id) => { if (d <= maxHops) visibleNodes.add(id); });
      }

      const baseEdges = directionFilter === 'upstream'
        ? upEdgesAll
        : directionFilter === 'downstream'
        ? downEdgesAll
        : [...upEdgesAll, ...downEdgesAll];

      const visibleEdges = baseEdges.filter(e => {
        if (!visibleNodes.has(e.from) || !visibleNodes.has(e.to)) return false;
        if (hiddenNodeTypes.size > 0 && (!allowedByType.has(e.from) || !allowedByType.has(e.to))) return false;
        if (maxHops === Infinity) return true;
        const okUp = (directionFilter === 'both' || directionFilter === 'upstream') && upDepth.has(e.from) && upDepth.has(e.to) && upDepth.get(e.from) <= maxHops && upDepth.get(e.to) <= maxHops;
        const okDown = (directionFilter === 'both' || directionFilter === 'downstream') && downDepth.has(e.from) && downDepth.has(e.to) && downDepth.get(e.from) <= maxHops && downDepth.get(e.to) <= maxHops;
        return okUp || okDown;
      });

      const cycleOnlyEdges = cycles.filter(ce => visibleEdges.some(ve => ve.from === ce.from && ve.to === ce.to));
      const downEdgeKeySet = new Set(downEdgesAll.map(e => e.from + '->' + e.to));
      const downVisibleEdges = visibleEdges.filter(e => !cycleOnlyEdges.some(ce => ce.from === e.from && ce.to === e.to) && downEdgeKeySet.has(e.from + '->' + e.to));

      const visibleSvgNodes = [];
      allSvgNodes.forEach(g => {
        const nt = g.getAttribute('data-node-type') || 'core-service';
        if (hiddenNodeTypes.has(nt)) {
          g.style.display = 'none';
          return;
        }
        const nid = resolveNodeId(g);
        const inSpot = nid && visibleNodes.has(nid);
        if (!inSpot && isolateSubgraph) {
          g.style.display = 'none';
        } else {
          g.style.display = '';
          g.style.opacity = inSpot ? '1' : dimOpacity;
          if (inSpot) visibleSvgNodes.push(g);
        }
      });

      const activeIdx = new Set();
      const hiddenEdgeIdx = new Set();
      let upCount = 0, downCount = 0, cycCount = 0;
      allSvgEdges.forEach((edgeEl, idx) => {
        if (!isEdgeAllowedByType(edgeEl)) {
          hiddenEdgeIdx.add(idx);
          edgeEl.style.display = 'none';
          return;
        }
        const ok = matchesEdge(edgeEl, visibleEdges);
        if (ok) {
          activeIdx.add(idx);
          edgeEl.style.display = '';
          edgeEl.style.opacity = '1';
          const isCyc = cycleOnlyEdges.length > 0 && matchesEdge(edgeEl, cycleOnlyEdges);
          const isDown = !isCyc && (directionFilter === 'downstream' || (directionFilter === 'both' && downVisibleEdges.length > 0 && matchesEdge(edgeEl, downVisibleEdges)));
          if (isCyc) cycCount++;
          else if (isDown) downCount++;
          else upCount++;
          const strokeCol = isCyc
            ? (isDarkSurface ? '#fb7185' : '#e11d48')
            : isDown
            ? (isDarkSurface ? '#34d399' : '#059669')
            : (isDarkSurface ? '#38bdf8' : '#0284c7');
          const paths = edgeEl.tagName.toLowerCase() === 'path' ? [edgeEl] : Array.from(edgeEl.querySelectorAll('path'));
          paths.forEach(p => {
            applyExportMarkerColor(svgElRef, p, strokeCol);
            p.style.strokeWidth = isCyc ? '2.6px' : '3px';
            if (isCyc) p.style.strokeDasharray = '6 4';
          });
        } else if (isolateSubgraph) {
          hiddenEdgeIdx.add(idx);
          edgeEl.style.display = 'none';
        } else {
          edgeEl.style.display = '';
          edgeEl.style.opacity = dimOpacity;
        }
      });

      allSvgLabels.forEach((lblEl, idx) => {
        if (hiddenEdgeIdx.has(idx) && allSvgLabels.length === allSvgEdges.length) {
          lblEl.style.display = 'none';
          return;
        }
        if (!isEdgeAllowedByType(lblEl)) { lblEl.style.display = 'none'; return; }
        const ok = matchesEdge(lblEl, visibleEdges) || (allSvgLabels.length === allSvgEdges.length && activeIdx.has(idx));
        if (!ok && isolateSubgraph) {
          lblEl.style.display = 'none';
        } else {
          lblEl.style.display = '';
          lblEl.style.opacity = ok ? '1' : dimOpacity;
        }
      });

      updateClusterVisibility(visibleSvgNodes);

      const spotLeg = [];
      if (upCount > 0) spotLeg.push({ label: 'Woher (Eingehend)', color: isDarkSurface ? '#38bdf8' : '#0284c7', dashed: false, count: upCount });
      if (downCount > 0) spotLeg.push({ label: 'Wohin (Ausgehend)', color: isDarkSurface ? '#34d399' : '#059669', dashed: false, count: downCount });
      if (cycCount > 0) spotLeg.push({ label: 'Zyklus / Rücksprung', color: isDarkSurface ? '#fb7185' : '#e11d48', dashed: true, count: cycCount });
      renderLegendBar(spotLeg.length ? spotLeg : null);

      const nodeObj = nodeMap.get(activeNodeId);
      const dirText = directionFilter === 'upstream' ? 'Nur Woher' : directionFilter === 'downstream' ? 'Nur Wohin' : 'Ganzer Pfad';
      const hopText = hopDepth === 'all' ? 'Alle Ebenen' : (hopDepth === '1' ? '1 Schritt' : '2 Ebenen');
      document.getElementById('selected-info').innerHTML =
        'Fokus: <strong style="color:var(--amber-text)">' + esc(nodeObj.label) + '</strong><br/>' +
        '<span style="font-size:11px;color:var(--text-muted);">' + dirText + ' · ' + hopText + ' · ' + visibleSvgNodes.length + ' Knoten sichtbar</span>';

      drillSlot.innerHTML = '';
      const drillTarget = PAYLOAD.drillTargetsByNodeId && PAYLOAD.drillTargetsByNodeId[activeNodeId];
      if (drillTarget && viewsByKey.has(drillTarget.viewKey) && drillTarget.viewKey !== activeViewKey) {
        const drillBtn = document.createElement('button');
        drillBtn.className = 'amber';
        drillBtn.style.width = '100%';
        drillBtn.textContent = '→ In Detail-Skript [' + drillTarget.scriptRef + '] hineinzoomen';
        drillBtn.onclick = () => switchView(drillTarget.viewKey);
        drillSlot.appendChild(drillBtn);
      }

      const upNodesList = Array.from(upDepth.entries())
        .filter(([id, d]) => id !== activeNodeId && d <= maxHops)
        .map(([id, d]) => ({ node: nodeMap.get(id), depth: d }))
        .filter(x => x.node);
      const downNodesList = Array.from(downDepth.entries())
        .filter(([id, d]) => id !== activeNodeId && d <= maxHops)
        .map(([id, d]) => ({ node: nodeMap.get(id), depth: d }))
        .filter(x => x.node);

      renderList(
        'list-entries',
        directionFilter === 'downstream' ? [] : upNodesList.filter(x => x.node.inDegree === 0).map(x => ({ ...x.node, badge: '-' + x.depth + ' Ebene(n)' }))
      );
      renderList(
        'list-callers',
        directionFilter === 'downstream' ? [] : GRAPH.edges.filter(e => e.to === activeNodeId).map(e => {
          const n = nodeMap.get(e.from);
          return n ? { ...n, badge: e.label || '← -1' } : null;
        }).filter(Boolean)
      );
      renderList(
        'list-callees',
        directionFilter === 'upstream' ? [] : GRAPH.edges.filter(e => e.from === activeNodeId).map(e => {
          const n = nodeMap.get(e.to);
          return n ? { ...n, badge: e.label || '+1 →' } : null;
        }).filter(Boolean)
      );
      renderList(
        'list-terminals',
        directionFilter === 'upstream' ? [] : downNodesList.filter(x => x.node.outDegree === 0).map(x => ({ ...x.node, badge: '+' + x.depth + ' Ebene(n)' }))
      );

      if (cycles.length > 0) {
        cycleCard.style.display = 'block';
        cycleList.innerHTML = '';
        cycles.forEach(ce => {
          const fromN = nodeMap.get(ce.from);
          const toN = nodeMap.get(ce.to);
          const btn = document.createElement('button');
          btn.className = 'node-chip';
          btn.style.borderColor = 'var(--err-border)';
          btn.innerHTML =
            '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">↻ ' +
            esc((fromN ? fromN.label : ce.from) + ' → ' + (toN ? toN.label : ce.to)) +
            '</span><span class="badge-cycle">' + esc(ce.label || 'Zyklus') + '</span>';
          btn.onclick = () => selectNode(ce.to, true);
          cycleList.appendChild(btn);
        });
      } else {
        cycleCard.style.display = 'none';
      }

      renderNodeSpecialParameters(activeNodeId);

      if (shouldFocusCamera && autoFocusEl.checked) {
        focusNodeCamera(activeNodeId);
      }
    }

    function jumpToScriptOrNode(scriptRef, preferredNodeTextOrId) {
      let targetViewKey = activeViewKey;
      if (scriptRef && PAYLOAD.viewKeyByScriptNumber) {
        const vk = PAYLOAD.viewKeyByScriptNumber[scriptRef] || PAYLOAD.viewKeyByScriptNumber[String(scriptRef).toLowerCase()];
        if (vk && viewsByKey.has(vk)) targetViewKey = vk;
      }
      if (targetViewKey !== activeViewKey) {
        switchView(targetViewKey);
      }
      // Try finding exact or matching node in current GRAPH
      let hitNode = null;
      if (preferredNodeTextOrId) {
        if (nodeMap.has(preferredNodeTextOrId)) hitNode = nodeMap.get(preferredNodeTextOrId);
        if (!hitNode) {
          const q = String(preferredNodeTextOrId).toLowerCase();
          hitNode = GRAPH.nodes.find(n => n.id.toLowerCase() === q || n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q));
        }
      }
      if (!hitNode && scriptRef) {
        const sq = String(scriptRef).toLowerCase();
        hitNode = GRAPH.nodes.find(n => n.id.toLowerCase().includes(sq) || n.label.toLowerCase().includes(sq));
      }
      switchAsideTab('path');
      if (hitNode) {
        // Ensure node type isn't blocking our jump target
        const svgNode = Array.from(stage.querySelectorAll('g.node, g.actor, g.statediagram-state')).find(g => resolveNodeId(g) === hitNode.id);
        if (svgNode) {
          const nt = svgNode.getAttribute('data-node-type');
          if (nt && hiddenNodeTypes.has(nt)) {
            hiddenNodeTypes.delete(nt);
            syncFilterBadge();
            renderNodeTypeFilters();
          }
        }
        selectNode(hitNode.id, true);
      }
    }

    function computeFallbackDiagnostics() {
      const cyc = detectExportCycleKeys();
      const entries = GRAPH.nodes.filter(n => n.inDegree === 0).length;
      const deadEnds = GRAPH.nodes.filter(n => n.outDegree === 0);
      const items = [];
      cyc.forEach(k => {
        const [from, to] = k.split('->');
        items.push({ severity: 'error', title: 'Zyklus erkannt: ' + from + ' → ' + to, desc: 'Rücksprung im Graph erkannt.', targetId: from, tag: 'Zyklus' });
      });
      deadEnds.slice(0, 12).forEach(n => {
        items.push({ severity: 'info', title: 'Endpunkt / Senke: ' + n.label, desc: n.inDegree + ' eingehende Verbindung(en), 0 ausgehende.', targetId: n.id, tag: 'Endpunkt' });
      });
      if (entries === 0 && GRAPH.nodes.length > 0) {
        items.push({ severity: 'warning', title: 'Kein expliziter Einstiegsknoten (inDegree = 0)', desc: 'Alle Knoten besitzen mindestens eine eingehende Kante.', targetId: GRAPH.nodes[0].id, tag: 'Topologie' });
      }
      return items;
    }

    function renderAnalysisTab() {
      const badge = document.getElementById('badge-analysis-count');
      const body = document.getElementById('an-body');
      if (!body) return;
      const an = PAYLOAD.analysis;
      const openList = an ? (an.openIssues || []).filter(i => i.status === 'open') : [];
      const healthList = an ? (an.healthFindings || []) : [];
      const fallbackDiag = !an ? computeFallbackDiagnostics() : [];
      if (badge) badge.textContent = String(an ? (openList.length + healthList.length) : fallbackDiag.length);

      body.innerHTML = '';

      if (activeAnalysisSubtab === 'issues') {
        const ctrl = document.createElement('div');
        ctrl.className = 'card';
        ctrl.innerHTML =
          '<input type="text" id="an-issues-search" placeholder="Fehler, Skript oder Hinweis suchen..." value="' + esc(anIssueSearch) + '" style="width:100%;margin-bottom:7px;" />' +
          '<div class="filter-chips" id="an-issues-chips">' +
            '<button class="chip' + (anIssueFilter === 'all' ? ' active' : '') + '" data-f="all">Alle</button>' +
            '<button class="chip' + (anIssueFilter === 'err' ? ' active' : '') + '" data-f="err">Offen &amp; Fehler</button>' +
            '<button class="chip' + (anIssueFilter === 'warn' ? ' active' : '') + '" data-f="warn">Warnungen / Info</button>' +
          '</div>';
        body.appendChild(ctrl);
        ctrl.querySelector('#an-issues-search').addEventListener('input', e => { anIssueSearch = e.target.value; renderAnalysisTab(); });
        ctrl.querySelectorAll('#an-issues-chips .chip').forEach(c => c.addEventListener('click', () => { anIssueFilter = c.getAttribute('data-f'); renderAnalysisTab(); }));

        const q = anIssueSearch.trim().toLowerCase();
        const combined = [];
        if (an) {
          openList.forEach(iss => {
            combined.push({
              severity: 'error',
              tag: 'Offener Punkt',
              scriptRef: iss.sourceScriptNumber,
              targetHint: iss.targetNumber || iss.sourceScriptNumber,
              title: iss.title,
              desc: iss.question + (iss.targetNumber ? ' (Ziel: ' + iss.targetNumber + ')' : ''),
            });
          });
          healthList.forEach(hf => {
            combined.push({
              severity: hf.severity,
              tag: hf.severity === 'error' ? 'Kritisch' : hf.severity === 'warning' ? 'Warnung' : 'Hinweis',
              scriptRef: hf.scriptNumber,
              targetHint: hf.ruleId || hf.scriptNumber,
              title: hf.scriptNumber + ' · ' + hf.title,
              desc: hf.description + (hf.recommendation ? ' — Empfehlung: ' + hf.recommendation : ''),
            });
          });
        } else {
          fallbackDiag.forEach(fd => {
            combined.push({
              severity: fd.severity,
              tag: fd.tag,
              scriptRef: '',
              targetHint: fd.targetId,
              title: fd.title,
              desc: fd.desc,
            });
          });
        }

        const filtered = combined.filter(it => {
          if (anIssueFilter === 'err' && it.severity !== 'error') return false;
          if (anIssueFilter === 'warn' && it.severity === 'error') return false;
          if (q && !(it.title + ' ' + it.desc + ' ' + it.scriptRef).toLowerCase().includes(q)) return false;
          return true;
        });

        if (!filtered.length) {
          const empty = document.createElement('div');
          empty.className = 'card muted-note';
          empty.textContent = 'Keine passenden Offenen Punkte oder Logik-Hinweise gefunden.';
          body.appendChild(empty);
          return;
        }
        filtered.slice(0, 120).forEach(it => {
          const item = document.createElement('div');
          item.className = 'an-item ' + (it.severity === 'error' ? 'sev-error' : it.severity === 'warning' ? 'sev-warning' : '');
          item.innerHTML =
            '<div class="row-between"><span class="an-tag ' + (it.severity === 'error' ? 'err' : it.severity === 'warning' ? 'warn' : '') + '">' + esc(it.tag) + '</span>' +
            (it.scriptRef ? '<span class="an-tag">' + esc(it.scriptRef) + '</span>' : '') + '</div>' +
            '<div class="an-item-title">' + esc(it.title) + '</div>' +
            '<div class="an-item-desc">' + esc(it.desc) + '</div>' +
            '<button class="node-chip" style="margin-top:3px;"><span>Im Diagramm zeigen</span><span class="badge">Fokus →</span></button>';
          item.querySelector('button').onclick = () => jumpToScriptOrNode(it.scriptRef, it.targetHint);
          body.appendChild(item);
        });
        return;
      }

      if (activeAnalysisSubtab === 'schedules') {
        const rows = an ? (an.scheduleRows || []) : [];
        const ctrl = document.createElement('div');
        ctrl.className = 'card';
        ctrl.innerHTML =
          '<div class="row-between" style="margin-bottom:7px;">' +
            '<input type="text" id="an-sched-search" placeholder="Skript, Zeit oder Feiertag suchen..." value="' + esc(anSchedSearch) + '" style="flex:1;" />' +
            '<button id="btn-csv-schedules">CSV laden</button>' +
          '</div>' +
          '<div class="filter-chips" id="an-sched-chips">' +
            '<button class="chip' + (anSchedFilter === 'all' ? ' active' : '') + '" data-f="all">Alle (' + rows.length + ')</button>' +
            '<button class="chip' + (anSchedFilter === 'sched' ? ' active' : '') + '" data-f="sched">Mit Zeitplan</button>' +
            '<button class="chip' + (anSchedFilter === 'hol' ? ' active' : '') + '" data-f="hol">Feiertage</button>' +
            '<button class="chip' + (anSchedFilter === 'none' ? ' active' : '') + '" data-f="none">24/7</button>' +
          '</div>';
        body.appendChild(ctrl);
        ctrl.querySelector('#an-sched-search').addEventListener('input', e => { anSchedSearch = e.target.value; renderAnalysisTab(); });
        ctrl.querySelectorAll('#an-sched-chips .chip').forEach(c => c.addEventListener('click', () => { anSchedFilter = c.getAttribute('data-f'); renderAnalysisTab(); }));
        ctrl.querySelector('#btn-csv-schedules').addEventListener('click', () => {
          downloadUtf8Csv(
            'callflow-oeffnungszeiten.csv',
            ['Skript-Nr.', 'Skript-Name', 'Prio', 'Schritt / Regel', 'Öffnungszeiten', 'Feiertag / Sonderzeit', 'Aktion / Überlauf / Ziel', 'Status'],
            rows.map(r => [
              r.scriptNumber, r.scriptName, r.prio ?? '—', r.stepName, r.openingHours, r.holidayAndSpecial, r.closedOrOverflowAction,
              r.hasSchedule && r.hasHoliday ? 'Öffnungszeiten + Feiertag' : r.hasSchedule ? 'Öffnungszeiten hinterlegt' : r.hasHoliday ? 'Feiertag / Sonderzeit' : 'Ohne Zeitangabe (24/7)'
            ])
          );
        });

        if (!an || !rows.length) {
          const empty = document.createElement('div');
          empty.className = 'card muted-note';
          empty.textContent = an ? 'Keine Öffnungszeiten- oder Zeitplan-Einträge erkannt.' : 'Zeitplan-Analyse ist für Multi-Skript Callflows verfügbar.';
          body.appendChild(empty);
          return;
        }

        const q = anSchedSearch.trim().toLowerCase();
        const filtered = rows.filter(r => {
          if (anSchedFilter === 'sched' && !r.hasSchedule) return false;
          if (anSchedFilter === 'hol' && !r.hasHoliday) return false;
          if (anSchedFilter === 'none' && (r.hasSchedule || r.hasHoliday)) return false;
          if (q && !(r.scriptNumber + ' ' + r.scriptName + ' ' + r.stepName + ' ' + r.openingHours + ' ' + r.holidayAndSpecial).toLowerCase().includes(q)) return false;
          return true;
        });

        const tw = document.createElement('div');
        const formatHoursCell = (val) => {
          const m = val ? String(val).match(/^(.*?)\s*(\([A-Za-z0-9_.-]+\))$/) : null;
          return m
            ? '<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;color:var(--accent,#38bdf8);">' +
                esc(m[1]) +
                '</span> <span style="font-size:11px;opacity:0.75;">' +
                esc(m[2]) +
                '</span>'
            : '<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">' +
                esc(val || '—') +
                '</span>';
        };

        tw.className = 'an-table-wrap';
        tw.innerHTML =
          '<table class="an-table"><thead><tr><th>Skript</th><th>Schritt</th><th>Zeiten</th><th>Feiertag</th><th>Überlauf</th></tr></thead><tbody>' +
          filtered.slice(0, 150).map((r, i) =>
            '<tr class="clickable" data-ridx="' + i + '"><td><strong>' + esc(r.scriptNumber) + '</strong></td><td>' + esc(r.stepName) + '</td><td>' + formatHoursCell(r.openingHours) + '</td><td>' + esc(r.holidayAndSpecial || '—') + '</td><td>' + esc(r.closedOrOverflowAction || '—') + '</td></tr>'
          ).join('') +
          '</tbody></table>';
        body.appendChild(tw);
        tw.querySelectorAll('tbody tr.clickable').forEach((tr, i) => {
          tr.addEventListener('click', () => {
            const row = filtered[i];
            if (row) jumpToScriptOrNode(row.scriptNumber, row.ruleId || row.scriptNumber);
          });
        });
        return;
      }

      if (activeAnalysisSubtab === 'inventory') {
        const reg = an ? an.registry : null;
        const ctrl = document.createElement('div');
        ctrl.className = 'card';
        ctrl.innerHTML =
          '<input type="text" id="an-inv-search" placeholder="Skillset, Ansage, Variable oder Skript suchen..." value="' + esc(anInvSearch) + '" style="width:100%;margin-bottom:7px;" />' +
          (reg
            ? '<div class="filter-chips" id="an-inv-chips">' +
                '<button class="chip' + (anInvCategory === 'skillsets' ? ' active' : '') + '" data-c="skillsets">Skillsets (' + reg.skillsets.length + ')</button>' +
                '<button class="chip' + (anInvCategory === 'announcements' ? ' active' : '') + '" data-c="announcements">Ansagen (' + reg.announcements.length + ')</button>' +
                '<button class="chip' + (anInvCategory === 'special' ? ' active' : '') + '" data-c="special">Sonderparameter (' + ((reg.specialParameters && reg.specialParameters.length) || 0) + ')</button>' +
                '<button class="chip' + (anInvCategory === 'variables' ? ' active' : '') + '" data-c="variables">Alle Variablen (' + reg.variables.length + ')</button>' +
                '<button class="chip' + (anInvCategory === 'crossRefs' ? ' active' : '') + '" data-c="crossRefs">Kreuzref. (' + reg.crossRefs.length + ')</button>' +
              '</div>'
            : '<div class="muted-note">Knoten-Inventar im aktuellen Diagramm (' + GRAPH.nodes.length + ' Knoten)</div>');
        body.appendChild(ctrl);
        ctrl.querySelector('#an-inv-search').addEventListener('input', e => { anInvSearch = e.target.value; renderAnalysisTab(); });
        ctrl.querySelectorAll('#an-inv-chips .chip').forEach(c => c.addEventListener('click', () => { anInvCategory = c.getAttribute('data-c'); renderAnalysisTab(); }));

        const q = anInvSearch.trim().toLowerCase();
        if (!reg) {
          GRAPH.nodes.filter(n => !q || (n.label + ' ' + n.id).toLowerCase().includes(q)).slice(0, 100).forEach(n => {
            const btn = document.createElement('button');
            btn.className = 'node-chip';
            btn.innerHTML = '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(n.label) + '</span><span class="badge">' + n.inDegree + ' / ' + n.outDegree + '</span>';
            btn.onclick = () => selectNode(n.id, true);
            body.appendChild(btn);
          });
          return;
        }

        if (anInvCategory === 'skillsets') {
          const items = reg.skillsets.filter(s => !q || s.name.toLowerCase().includes(q) || s.usages.some(u => (u.scriptNumber + ' ' + u.scriptName).toLowerCase().includes(q)));
          items.slice(0, 100).forEach(s => {
            const el = document.createElement('div');
            el.className = 'an-item';
            el.innerHTML = '<div class="row-between"><span class="an-item-title">' + esc(s.name) + '</span><span class="an-tag">' + esc(s.role) + ' · ' + s.usages.length + 'x</span></div>';
            s.usages.slice(0, 4).forEach(u => {
              const btn = document.createElement('button');
              btn.className = 'node-chip';
              btn.innerHTML = '<span>' + esc(u.scriptNumber + ' · ' + (u.stepName || u.scriptName)) + '</span><span class="badge">Zeigen →</span>';
              btn.onclick = () => jumpToScriptOrNode(u.scriptNumber, s.name);
              el.appendChild(btn);
            });
            body.appendChild(el);
          });
        } else if (anInvCategory === 'announcements') {
          const items = reg.announcements.filter(a => !q || a.idOrName.toLowerCase().includes(q) || a.usages.some(u => (u.scriptNumber + ' ' + u.scriptName).toLowerCase().includes(q)));
          items.slice(0, 100).forEach(a => {
            const el = document.createElement('div');
            el.className = 'an-item';
            el.innerHTML = '<div class="row-between"><span class="an-item-title">' + esc(a.idOrName) + '</span><span class="an-tag">' + a.usages.length + 'x</span></div>';
            a.usages.slice(0, 4).forEach(u => {
              const btn = document.createElement('button');
              btn.className = 'node-chip';
              btn.innerHTML = '<span>' + esc(u.scriptNumber + ' · ' + (u.stepName || u.scriptName)) + '</span><span class="badge">Zeigen →</span>';
              btn.onclick = () => jumpToScriptOrNode(u.scriptNumber, a.idOrName);
              el.appendChild(btn);
            });
            body.appendChild(el);
          });
        } else if (anInvCategory === 'special') {
          const specParams = reg.specialParameters || [];
          const items = specParams.filter(p => !q || (p.label + ' ' + p.key + ' ' + p.value + ' ' + (p.note || '')).toLowerCase().includes(q));
          if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'card muted-note';
            empty.textContent = 'Keine Sonderparameter für die aktuelle Suche gefunden.';
            body.appendChild(empty);
          } else {
            items.slice(0, 100).forEach(p => {
              const el = document.createElement('div');
              el.className = 'an-item';
              el.innerHTML =
                '<div class="row-between"><span class="an-item-title">' + esc(p.label) + ' <small style="font-family:monospace;font-weight:normal;opacity:0.8;">(' + esc(p.key) + ')</small></span><span class="an-tag" style="font-family:monospace;font-weight:600;color:var(--accent,#38bdf8);">' + esc(p.value) + '</span></div>' +
                (p.note ? '<div class="an-item-desc">' + esc(p.note) + '</div>' : '');
              body.appendChild(el);
            });
          }
        } else if (anInvCategory === 'variables') {
          const items = reg.variables.filter(v => !q || v.variableName.toLowerCase().includes(q) || v.valuesByScript.some(vs => (vs.scriptNumber + ' ' + vs.value).toLowerCase().includes(q)));
          items.slice(0, 100).forEach(v => {
            const el = document.createElement('div');
            el.className = 'an-item';
            el.innerHTML = '<div class="row-between"><span class="an-item-title">' + esc(v.variableName) + '</span><span class="an-tag">' + v.valuesByScript.length + ' Skripte</span></div>';
            v.valuesByScript.slice(0, 4).forEach(vs => {
              const btn = document.createElement('button');
              btn.className = 'node-chip';
              btn.innerHTML = '<span>' + esc(vs.scriptNumber + ' = ' + vs.value) + '</span><span class="badge">Zeigen →</span>';
              btn.onclick = () => jumpToScriptOrNode(vs.scriptNumber, v.variableName);
              el.appendChild(btn);
            });
            body.appendChild(el);
          });
        } else {
          const items = reg.crossRefs.filter(cr => !q || (cr.refKey + ' ' + cr.displayName).toLowerCase().includes(q));
          items.slice(0, 100).forEach(cr => {
            const el = document.createElement('div');
            el.className = 'an-item';
            const stCls = cr.status === 'missing' ? 'err' : cr.status === 'present' || cr.status === 'master' ? 'ok' : '';
            el.innerHTML =
              '<div class="row-between"><span class="an-item-title">' + esc(cr.displayName) + '</span><span class="an-tag ' + stCls + '">' + esc(cr.status) + '</span></div>' +
              '<div class="an-item-desc">Aufrufer: ' + esc(cr.callers.join(', ') || '—') + ' | Ziele: ' + esc(cr.callees.join(', ') || '—') + '</div>' +
              '<button class="node-chip"><span>Skript / Ziel im Graph öffnen</span><span class="badge">Fokus →</span></button>';
            el.querySelector('button').onclick = () => jumpToScriptOrNode(cr.refKey, cr.refKey);
            body.appendChild(el);
          });
        }
        return;
      }

      if (activeAnalysisSubtab === 'matrix') {
        const rows = an ? (an.routingMatrixRows || []) : [];
        const ctrl = document.createElement('div');
        ctrl.className = 'card';
        ctrl.innerHTML =
          '<div class="row-between" style="gap:6px;">' +
            '<input type="text" id="an-matrix-search" placeholder="Routing-Matrix durchsuchen..." value="' + esc(anMatrixSearch) + '" style="flex:1;" />' +
            '<button id="btn-csv-matrix">Matrix-CSV</button>' +
          '</div>';
        body.appendChild(ctrl);
        ctrl.querySelector('#an-matrix-search').addEventListener('input', e => { anMatrixSearch = e.target.value; renderAnalysisTab(); });
        ctrl.querySelector('#btn-csv-matrix').addEventListener('click', () => {
          downloadUtf8Csv(
            'callflow-routing-matrix.csv',
            ['Skript-ID', 'Skript-Bezeichnung', 'Rolle', 'Prio', 'Regelschritt', 'Bedingung / Zeitplan / Feiertag', 'Ansage / RAN / Musik', 'Warteschlange / Skillset', 'Ziel-Skripte & DTMF-Auswahl', 'Referenz-Status'],
            rows.map(r => [
              r.scriptNumber, r.scriptName, r.isMaster ? 'Master (Main)' : 'Teil-Skript', r.prio, r.stepName,
              r.conditionAndSchedule, r.announcement, r.queueTarget, r.targetsAndChoices, r.targetStatus
            ])
          );
        });

        if (!an || !rows.length) {
          const empty = document.createElement('div');
          empty.className = 'card muted-note';
          empty.textContent = an ? 'Keine Routing-Regeln vorhanden.' : 'Routing-Matrix ist für Multi-Skript Callflows verfügbar.';
          body.appendChild(empty);
          return;
        }

        const q = anMatrixSearch.trim().toLowerCase();
        const filtered = rows.filter(r => !q || (r.scriptNumber + ' ' + r.scriptName + ' ' + r.stepName + ' ' + r.conditionAndSchedule + ' ' + r.queueTarget + ' ' + r.targetsAndChoices).toLowerCase().includes(q));
        const tw = document.createElement('div');
        tw.className = 'an-table-wrap';
        tw.innerHTML =
          '<table class="an-table"><thead><tr><th>Skript</th><th>Prio</th><th>Schritt / Bedingung</th><th>Ansage / Queue</th><th>Ziele</th></tr></thead><tbody>' +
          filtered.slice(0, 180).map((r, i) =>
            '<tr class="clickable" data-midx="' + i + '"><td><strong>' + esc(r.scriptNumber) + '</strong></td><td>' + esc(r.prio) + '</td><td>' + esc(r.stepName + (r.conditionAndSchedule ? ' · ' + r.conditionAndSchedule : '')) + '</td><td>' + esc([r.announcement, r.queueTarget].filter(Boolean).join(' / ') || '—') + '</td><td>' + esc(r.targetsAndChoices || '—') + '</td></tr>'
          ).join('') +
          '</tbody></table>';
        body.appendChild(tw);
        tw.querySelectorAll('tbody tr.clickable').forEach((tr, i) => {
          tr.addEventListener('click', () => {
            const row = filtered[i];
            if (row) jumpToScriptOrNode(row.scriptNumber, row.stepName || row.scriptNumber);
          });
        });
      }
    }

    document.querySelectorAll('#aside-tabs .aside-tab').forEach(btn => {
      btn.addEventListener('click', () => switchAsideTab(btn.getAttribute('data-tab')));
    });

    document.querySelectorAll('#an-subtabs .an-subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeAnalysisSubtab = btn.getAttribute('data-subtab');
        document.querySelectorAll('#an-subtabs .an-subtab').forEach(b => b.classList.toggle('active', b === btn));
        renderAnalysisTab();
      });
    });

    document.getElementById('btn-clear-edge').addEventListener('click', () => {
      activeEdge = null;
      applyCombinedCanvasState(false);
    });

    if (isolateBtn) {
      isolateBtn.addEventListener('click', () => {
        isolateSubgraph = !isolateSubgraph;
        syncIsolateUi();
        applyCombinedCanvasState(false);
      });
    }
    if (isolateChk) {
      isolateChk.addEventListener('change', e => {
        isolateSubgraph = Boolean(e.target.checked);
        syncIsolateUi();
        applyCombinedCanvasState(false);
      });
    }

    document.getElementById('btn-show-all-types').addEventListener('click', () => {
      hiddenNodeTypes.clear();
      syncFilterBadge();
      renderNodeTypeFilters();
      applyCombinedCanvasState(false);
    });

    if (viewSelectEl) {
      viewSelectEl.addEventListener('change', e => switchView(e.target.value));
    }
    if (masterBackBtn) {
      masterBackBtn.addEventListener('click', () => switchView('master'));
    }

    document.querySelectorAll('#pathmode-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#pathmode-group .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        pathColorMode = btn.getAttribute('data-pathmode') || 'semantic';
        recolorExportEdges(svgLayer.querySelector('svg'), GRAPH, true);
        viewThemeSigCache.set(activeViewKey, (isDarkSurface ? 'dark' : 'light') + '|' + pathColorMode);
        if (activeNodeId || activeEdge) {
          applyCombinedCanvasState(false);
        } else {
          scheduleActiveProxySync(35);
        }
      });
    });

    document.querySelectorAll('#dir-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#dir-group .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        directionFilter = btn.getAttribute('data-dir');
        applyCombinedCanvasState(false);
      });
    });

    document.querySelectorAll('#hop-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#hop-group .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        hopDepth = btn.getAttribute('data-hop');
        applyCombinedCanvasState(false);
      });
    });

    document.querySelectorAll('#role-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#role-chips .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        roleFilter = chip.getAttribute('data-role');
        populateSelect();
        applyCombinedCanvasState(false);
      });
    });

    searchEl.addEventListener('input', () => {
      populateSelect();
      if (!activeNodeId && !activeEdge) applyCombinedCanvasState(false);
    });

    dimSelectEl.addEventListener('change', e => {
      dimOpacity = e.target.value;
      applyCombinedCanvasState(false);
    });

    selectEl.addEventListener('change', e => selectNode(e.target.value, true));
    document.getElementById('btn-reset').addEventListener('click', () => {
      searchEl.value = '';
      roleFilter = 'all';
      directionFilter = 'both';
      hopDepth = 'all';
      dimOpacity = '0.12';
      dimSelectEl.value = '0.12';
      isolateSubgraph = false;
      hiddenNodeTypes.clear();
      activeNodeId = '';
      activeEdge = null;
      selectEl.value = '';
      document.querySelectorAll('#dir-group .seg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
      document.querySelectorAll('#hop-group .seg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
      document.querySelectorAll('#role-chips .chip').forEach((c, i) => c.classList.toggle('active', i === 0));
      syncIsolateUi();
      renderNodeTypeFilters();
      populateSelect();
      applyCombinedCanvasState(false);
      fitToWindow();
    });

    function closePreloadUi(hideCompletely) {
      if (preloadOverlayEl) preloadOverlayEl.style.display = 'none';
      if (hideCompletely && preloadBgStripEl) preloadBgStripEl.style.display = 'none';
      else if (!hideCompletely && preloadRunning && preloadBgStripEl) preloadBgStripEl.style.display = 'flex';
    }

    function cancelPreloadPipeline() {
      preloadAborted = true;
      preloadRunning = false;
      closePreloadUi(true);
    }

    document.getElementById('btn-preload-skip').addEventListener('click', cancelPreloadPipeline);
    document.getElementById('btn-preload-bg-cancel').addEventListener('click', cancelPreloadPipeline);
    document.getElementById('btn-preload-bg').addEventListener('click', () => closePreloadUi(false));

    window.addEventListener('beforeunload', () => {
      for (const entry of cleanProxyCache.values()) {
        if (entry.url) URL.revokeObjectURL(entry.url);
      }
      cleanProxyCache.clear();
      if (dynamicProxy.url) URL.revokeObjectURL(dynamicProxy.url);
    });

    function nextPreloadFrame() {
      return new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 0);
      });
    }

    async function runInitialPreloadAndBoot() {
      normalizeSvgElement(svgLayer.querySelector('svg'), viewsByKey.get(activeViewKey), true);
      populateViewSelect();
      populateSelect();
      syncIsolateUi();
      renderAnalysisTab();
      applyCombinedCanvasStateInner(false);
      fitToWindow();

      const orderedViews = [...PAYLOAD.views].sort((a, b) => {
        if (a.key === activeViewKey) return -1;
        if (b.key === activeViewKey) return 1;
        if (a.key === 'master') return -1;
        if (b.key === 'master') return 1;
        return 0;
      });

      if (!orderedViews.length) return;
      preloadRunning = true;
      preloadAborted = false;
      if (preloadSubEl) {
        preloadSubEl.textContent = orderedViews.length > 1
          ? ('Alle ' + orderedViews.length + ' Ansichten & GPU-Zoom-Cache werden vollständig vorbereitet …')
          : 'GPU-Zoom-Cache & Vektor-Bühne werden vorbereitet …';
      }
      if (preloadOverlayEl) preloadOverlayEl.style.display = 'flex';
      if (preloadCountEl) preloadCountEl.textContent = '0 / ' + orderedViews.length;
      if (preloadBgCountEl) preloadBgCountEl.textContent = '0/' + orderedViews.length;
      if (preloadFillEl) preloadFillEl.style.width = '0%';

      await nextPreloadFrame();

      const tmpParserHost = document.createElement('div');
      const curThemeSig = (isDarkSurface ? 'dark' : 'light') + '|' + pathColorMode;

      for (let i = 0; i < orderedViews.length; i++) {
        if (preloadAborted) return;
        const view = orderedViews[i];
        if (preloadCountEl) preloadCountEl.textContent = i + ' / ' + orderedViews.length;
        if (preloadBgCountEl) preloadBgCountEl.textContent = i + '/' + orderedViews.length;
        if (preloadLabelEl) preloadLabelEl.textContent = view.label || view.key;
        if (preloadFillEl) preloadFillEl.style.width = Math.round((i / orderedViews.length) * 100) + '%';

        let svgEl = normalizedSvgCache.get(view.key);
        if (!svgEl) {
          tmpParserHost.innerHTML = view.svg;
          svgEl = tmpParserHost.querySelector('svg');
          if (svgEl) {
            normalizeSvgElement(svgEl, view, false);
          }
          tmpParserHost.innerHTML = '';
        }

        if (svgEl && i < MAX_CLEAN_PROXIES) {
          const isCleanTarget = view.key !== activeViewKey || isViewInCleanOverviewState();
          const existingProxy = isCleanTarget ? cleanProxyCache.get(view.key) : null;
          if (!existingProxy || existingProxy.sig !== curThemeSig) {
            const url = await rasterizeSvgElToGpuProxy(svgEl);
            if (preloadAborted) {
              if (url) URL.revokeObjectURL(url);
              return;
            }
            if (url) {
              if (isCleanTarget) {
                const oldUrl = existingProxy ? existingProxy.url : '';
                cleanProxyCache.set(view.key, { sig: curThemeSig, url, lastUsedAt: Date.now() });
                if (oldUrl && oldUrl !== url && dynamicProxy.url !== oldUrl) {
                  URL.revokeObjectURL(oldUrl);
                }
                enforceCleanProxyCacheCap();
                if (view.key === activeViewKey) {
                  setActiveGpuProxy(url);
                }
              } else {
                const oldDynUrl = dynamicProxy.url;
                dynamicProxy = { sig: buildCurrentStateProxySig(), url };
                setActiveGpuProxy(url);
                if (oldDynUrl && oldDynUrl !== url && !isProxyUrlReferencedInCleanCache(oldDynUrl)) {
                  URL.revokeObjectURL(oldDynUrl);
                }
              }
            }
          }
        }

        const doneCount = i + 1;
        if (preloadCountEl) preloadCountEl.textContent = doneCount + ' / ' + orderedViews.length;
        if (preloadBgCountEl) preloadBgCountEl.textContent = doneCount + '/' + orderedViews.length;
        if (preloadFillEl) preloadFillEl.style.width = Math.round((doneCount / orderedViews.length) * 100) + '%';
        await nextPreloadFrame();
      }

      preloadRunning = false;
      closePreloadUi(true);
    }

    runInitialPreloadAndBoot();
  </script>
</body>
</html>`;
}


