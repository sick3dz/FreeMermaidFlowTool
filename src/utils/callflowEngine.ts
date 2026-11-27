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
  OpeningHoursExportBundle,
  PathColorMode,
  SmartColorNodeType,
} from '../types/mermaidStudio';
import { toMermaidNodeSuffix } from './scriptCallflowParser';
import { sanitizeSvgForXmlParser } from './mermaidEngine';
import { DualAudienceNodeExplanation } from './nodeExplanationEngine';
import {
  applyColorToEdgePathAndMarkers,
  SEMANTIC_PALETTES,
  SMART_COLOR_NODE_TYPE_OPTIONS,
} from './smartColorEngine';
import { GlobalSearchEntry } from './globalSearchEngine';
import {
  buildOpeningHoursExportBundleFromRows,
  getEmbeddedOpeningHoursExportRuntimeJs,
} from './openingHoursExporter';
import {
  getEmbeddedInventoryAndGenesysZipRuntimeJs,
  WorkspaceInventoryBundle,
} from './inventoryExporter';
import { AuditReport } from './auditCallflows';

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
  // Fast zero-reflow attribute extraction first (avoids 200+ synchronous getBBox() layout reflows)
  const rectEl = (shapeEls.find((s) => s.tagName.toLowerCase() === 'rect') ||
    nodeGroup.querySelector('rect')) as SVGRectElement | null;
  if (rectEl) {
    const rx = parseFloat(rectEl.getAttribute('x') || '');
    const rw = parseFloat(rectEl.getAttribute('width') || '');
    const ry = parseFloat(rectEl.getAttribute('y') || '');
    const rh = parseFloat(rectEl.getAttribute('height') || '');
    if (
      Number.isFinite(rx) &&
      Number.isFinite(rw) &&
      rw > 4 &&
      Number.isFinite(ry) &&
      Number.isFinite(rh) &&
      rh > 4
    ) {
      return { minX: rx, maxX: rx + rw, minY: ry, maxY: ry + rh, cx: rx + rw / 2, cy: ry + rh / 2 };
    }
  }

  const polyEl = (shapeEls.find((s) => s.tagName.toLowerCase() === 'polygon') ||
    nodeGroup.querySelector('polygon')) as SVGPolygonElement | null;
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
      if (
        Number.isFinite(minX) &&
        Number.isFinite(maxX) &&
        maxX - minX > 4 &&
        Number.isFinite(minY) &&
        Number.isFinite(maxY) &&
        maxY - minY > 4
      ) {
        return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
      }
    }
  }

  const circleEl = (shapeEls.find((s) => s.tagName.toLowerCase() === 'circle') ||
    nodeGroup.querySelector('circle')) as SVGCircleElement | null;
  if (circleEl) {
    const cx = parseFloat(circleEl.getAttribute('cx') || '0');
    const cy = parseFloat(circleEl.getAttribute('cy') || '0');
    const r = parseFloat(circleEl.getAttribute('r') || '');
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r) && r > 4) {
      return { minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r, cx, cy };
    }
  }

  const pathEl = shapeEls.find((s) => s.tagName.toLowerCase() === 'path') as SVGPathElement | undefined;
  if (pathEl) {
    const dAttr = pathEl.getAttribute('d') || '';
    const coords = dAttr.match(/[+-]?\d+(?:\.\d+)?/g);
    if (coords && coords.length >= 4 && !/[a-z]/.test(dAttr.replace(/[MLHVCSQTAZ]/g, ''))) {
      // Only use fast path bounds for absolute path commands; otherwise fall back to getBBox
      const parsed = normalizeSvgPathToAbsolute(dAttr);
      if (parsed.pairs.length >= 2) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of parsed.pairs) {
          minX = Math.min(minX, p.origX);
          maxX = Math.max(maxX, p.origX);
          minY = Math.min(minY, p.origY);
          maxY = Math.max(maxY, p.origY);
        }
        if (
          Number.isFinite(minX) &&
          Number.isFinite(maxX) &&
          maxX - minX > 12 &&
          Number.isFinite(minY) &&
          Number.isFinite(maxY) &&
          maxY - minY > 12
        ) {
          return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
        }
      }
    }
  }

  // Fallback to browser getBBox() only when static attributes could not determine bounds
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

  // Pre-compile edge matchers lazily + O(1) exact L_<from>_<to>_<occ> and pair lookup maps
  const edgeByPairKey = new Map<string, CallflowEdge>();
  const edgeByMermaidLId = new Map<string, CallflowEdge>();
  const pairOccCounter = new Map<string, number>();
  for (const edge of graph.edges) {
    const fLow = edge.from.toLowerCase();
    const tLow = edge.to.toLowerCase();
    const k = `${fLow}->${tLow}`;
    if (!edgeByPairKey.has(k)) {
      edgeByPairKey.set(k, edge);
    }
    const occ = pairOccCounter.get(k) || 0;
    pairOccCounter.set(k, occ + 1);
    edgeByMermaidLId.set(`l_${fLow}_${tLow}_${occ}`, edge);
    edgeByMermaidLId.set(`l-${fLow}-${tLow}-${occ}`, edge);
  }

  let compiledEdges: ReturnType<typeof createEdgeMetaMatcher>[] | null = null;
  const getCompiledEdges = () => {
    if (!compiledEdges) {
      compiledEdges = graph.edges
        .map((edge) => createEdgeMetaMatcher(edge))
        .sort((a, b) => b.score - a.score);
    }
    return compiledEdges;
  };

  const matchEdgeMeta = (el: Element): CallflowEdge | null => {
    const attrFrom = el.getAttribute('data-edge-from');
    const attrTo = el.getAttribute('data-edge-to');
    if (attrFrom && attrTo) {
      const directAttr = edgeByPairKey.get(`${attrFrom.toLowerCase()}->${attrTo.toLowerCase()}`);
      if (directAttr) return directAttr;
    }
    const rawId =
      el.getAttribute('data-id') ||
      el.getAttribute('id') ||
      '';
    if (rawId) {
      const lowerRaw = rawId.toLowerCase();
      const exactHit = edgeByMermaidLId.get(lowerRaw);
      if (exactHit) return exactHit;
      const lIdx = lowerRaw.indexOf('l_');
      if (lIdx > 0) {
        const suffixHit = edgeByMermaidLId.get(lowerRaw.slice(lIdx));
        if (suffixHit) return suffixHit;
      }
    }
    const meta = getSvgEdgeElementMeta(el);
    for (const item of getCompiledEdges()) {
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

  // O(E) pre-indexing of edge labels by data-id and by (from->to) pair
  const labelByDataId = new Map<string, SVGElement[]>();
  const labelsByPairKey = new Map<string, SVGElement[]>();
  for (const labelEl of edgeLabelElements) {
    const lid =
      labelEl.getAttribute('data-id') ||
      labelEl.querySelector('[data-id]')?.getAttribute('data-id') ||
      '';
    if (lid) {
      const arr = labelByDataId.get(lid) || [];
      arr.push(labelEl);
      labelByDataId.set(lid, arr);
    } else {
      const m = matchEdgeMeta(labelEl);
      if (m) {
        const pk = `${m.from}->${m.to}`;
        const arr = labelsByPairKey.get(pk) || [];
        arr.push(labelEl);
        labelsByPairKey.set(pk, arr);
      }
    }
  }

  const allEdges: LiveSvgEdgeHandle[] = [];
  const edgesByNode = new Map<string, LiveSvgEdgeHandle[]>();
  const svgNs = 'http://www.w3.org/2000/svg';
  const doc = svgEl.ownerDocument;
  const usedLabelEls = new Set<SVGElement>();
  const skipExtraHitPaths = edgeElements.length > 80;

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

    let matchedLabel: SVGElement | null = null;
    if (edgeOwnDataId) {
      const byId = labelByDataId.get(edgeOwnDataId);
      if (byId) {
        matchedLabel = byId.find((l) => !usedLabelEls.has(l)) || null;
      }
    }
    if (!matchedLabel) {
      const byPair = labelsByPairKey.get(`${matched.from}->${matched.to}`);
      if (byPair) {
        matchedLabel = byPair.find((l) => !usedLabelEls.has(l)) || null;
      }
    }
    if (
      !matchedLabel &&
      edgeLabelElements.length === edgeElements.length &&
      edgeLabelElements[idx] &&
      !usedLabelEls.has(edgeLabelElements[idx])
    ) {
      matchedLabel = edgeLabelElements[idx];
    }

    if (matchedLabel) {
      usedLabelEls.add(matchedLabel);
    }

    const labelText =
      matched.label ||
      (matchedLabel?.textContent || '').replace(/\s+/g, ' ').trim();

    edgeEl.setAttribute('data-callflow-edge-from', matched.from);
    edgeEl.setAttribute('data-callflow-edge-to', matched.to);
    edgeEl.setAttribute('data-callflow-edge-label', labelText);

    if (matchedLabel) {
      matchedLabel.setAttribute('data-callflow-edge-from', matched.from);
      matchedLabel.setAttribute('data-callflow-edge-to', matched.to);
      matchedLabel.setAttribute('data-callflow-edge-label', labelText);
    }

    const parsedPaths = pathNodes.map((p) => parseLivePathTokens(p));
    const hitPathEls: SVGPathElement[] = [];
    if (!skipExtraHitPaths) {
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
    }

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

/**
 * Resolves a node ID from screen pointer coordinates using the cached SVG viewBox and node local boxes,
 * enabling instant click & double-click interaction while the GPU raster proxy layer is active.
 */
export function hitTestLiveSvgNodeAtClientPoint(
  index: LiveSvgDomIndex,
  clientX: number,
  clientY: number,
  frameEl: HTMLElement | null
): string | null {
  if (!frameEl || !index.origVbParts) return null;
  const rect = frameEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null;
  }

  const [vbX, vbY, vbW, vbH] = index.origVbParts;
  const svgX = vbX + ((clientX - rect.left) / rect.width) * vbW;
  const svgY = vbY + ((clientY - rect.top) / rect.height) * vbH;
  const pad = Math.max(4, Math.min(18, (vbW / Math.max(1, rect.width)) * 4));

  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const [nodeId, node] of index.nodes.entries()) {
    let ancX = 0;
    let ancY = 0;
    let parent: Element | null = node.groupEl.parentElement;
    while (parent && parent !== index.svgEl) {
      const tr = parent.getAttribute('transform');
      if (tr) {
        const parsed = parseTranslateFromTransform(tr);
        ancX += parsed.x;
        ancY += parsed.y;
      }
      parent = parent.parentElement;
    }

    const tx = ancX + node.baseTx + node.currentDx;
    const ty = ancY + node.baseTy + node.currentDy;
    const minX = tx + node.box.minX - pad;
    const maxX = tx + node.box.maxX + pad;
    const minY = ty + node.box.minY - pad;
    const maxY = ty + node.box.maxY + pad;

    if (svgX >= minX && svgX <= maxX && svgY >= minY && svgY <= maxY) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const dist = Math.hypot(svgX - cx, svgY - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = nodeId;
      }
    }
  }

  return bestId;
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

  // Always clear previous selected-node element highlighters cleanly
  index.svgEl
    .querySelectorAll('.cf-selected-highlighter-layer')
    .forEach((el) => el.remove());
  index.nodes.forEach((node) => {
    node.groupEl.removeAttribute('data-selected-node');
  });

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
      const restEdgeOp = edge.edgeEl.getAttribute('data-resting-opacity');
      edge.edgeEl.style.opacity = restEdgeOp ?? edge.origOpacity;
      if (edge.labelEl) {
        const restLblOp = edge.labelEl.getAttribute('data-resting-opacity');
        edge.labelEl.style.opacity = restLblOp ?? edge.origLabelOpacity;
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
    const isSelectedNode = matchedId === trace.selectedNode.id;

    if (isSelectedNode) {
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

    if (isSelectedNode) {
      node.groupEl.setAttribute('data-selected-node', 'true');
      try {
        const bbox = node.groupEl.getBBox();
        if (bbox && bbox.width > 0 && bbox.height > 0) {
          const svgNs = 'http://www.w3.org/2000/svg';
          const pad = 7;
          const layer = document.createElementNS(svgNs, 'g');
          layer.setAttribute('class', 'cf-selected-highlighter-layer');
          layer.setAttribute('pointer-events', 'none');

          const outerRect = document.createElementNS(svgNs, 'rect');
          outerRect.setAttribute('class', 'cf-selected-highlighter-outer');
          outerRect.setAttribute('x', String(bbox.x - pad - 2));
          outerRect.setAttribute('y', String(bbox.y - pad - 2));
          outerRect.setAttribute('width', String(bbox.width + (pad + 2) * 2));
          outerRect.setAttribute('height', String(bbox.height + (pad + 2) * 2));
          outerRect.setAttribute('rx', '12');
          outerRect.setAttribute('ry', '12');
          outerRect.setAttribute('fill', 'none');
          outerRect.setAttribute('stroke', isDark ? 'rgba(251, 191, 36, 0.38)' : 'rgba(217, 119, 6, 0.34)');
          outerRect.setAttribute('stroke-width', '7');

          const innerRect = document.createElementNS(svgNs, 'rect');
          innerRect.setAttribute('class', 'cf-selected-highlighter-rect');
          innerRect.setAttribute('x', String(bbox.x - pad));
          innerRect.setAttribute('y', String(bbox.y - pad));
          innerRect.setAttribute('width', String(bbox.width + pad * 2));
          innerRect.setAttribute('height', String(bbox.height + pad * 2));
          innerRect.setAttribute('rx', '10');
          innerRect.setAttribute('ry', '10');
          innerRect.setAttribute('fill', isDark ? 'rgba(251, 191, 36, 0.12)' : 'rgba(245, 158, 11, 0.14)');
          innerRect.setAttribute('stroke', isDark ? '#fbbf24' : '#d97706');
          innerRect.setAttribute('stroke-width', '3');

          layer.appendChild(outerRect);
          layer.appendChild(innerRect);
          node.groupEl.insertBefore(layer, node.groupEl.firstChild);
        }
      } catch {
        // Fallback: CSS drop-shadow on [data-selected-node="true"] still highlights the node cleanly
      }
    }
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

/**
 * Shared upfront complexity gate used by BOTH the live Builder and interactive
 * Callflow.html batch export. Detects giant flowcharts that would freeze Mermaid's
 * synchronous single-threaded Dagre layout and routes them directly to the
 * O(V + E) deterministic vector flowchart engine (< 30 ms, zero freeze, zero placeholders).
 */
export function shouldUseFastDeterministicVectorLayout(mermaidCode: string): {
  useFastVector: boolean;
  edgeCount: number;
  charLength: number;
} {
  const trimmed = (mermaidCode || '').trim();
  const charLength = trimmed.length;
  if (!trimmed || !/^(?:flowchart|graph)\b/i.test(trimmed)) {
    return { useFastVector: false, edgeCount: 0, charLength };
  }
  const edgeMatches = trimmed.match(/-->|-.->|==>/g);
  const edgeCount = edgeMatches ? edgeMatches.length : 0;
  return {
    useFastVector: edgeCount > 200 || charLength > 32000,
    edgeCount,
    charLength,
  };
}

/**
 * Deterministic, O(V + E) layered SVG flowchart renderer with barycenter ordering
 * that produces a complete, clickable, traceable Builder-styled Mermaid-compatible SVG
 * directly from a parsed CallflowGraph. Ensures giant scripts NEVER freeze the browser
 * and NEVER degrade to static placeholder cards.
 */
export function buildDeterministicFlowchartSvg(
  graph: CallflowGraph,
  surface: 'dark' | 'light',
  title?: string,
  direction: 'LR' | 'TB' | 'TD' | 'RL' | 'BT' = 'LR'
): string {
  const escXml = (s: string): string =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const allNodes = Array.from(graph.nodes.values());
  const isDark = surface === 'dark';
  const bg = isDark ? '#0f172a' : '#f8fafc';
  const textMain = isDark ? '#f1f5f9' : '#0f172a';
  const textMuted = isDark ? '#94a3b8' : '#475569';
  const edgeStroke = isDark ? '#64748b' : '#64748b';
  const edgeLabelBg = isDark ? '#1e293b' : '#ffffff';
  const edgeLabelBorder = isDark ? '#334155' : '#cbd5e1';

  if (allNodes.length === 0) {
    const safeTitle = escXml((title || 'Callflow').slice(0, 80));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 160" width="640" height="160" style="background:${bg}"><rect x="16" y="16" width="608" height="128" rx="12" fill="${isDark ? '#1e293b' : '#ffffff'}" stroke="${edgeLabelBorder}" stroke-width="1.5"/><text x="36" y="72" font-family="ui-sans-serif, system-ui, sans-serif" font-size="16" font-weight="600" fill="${textMain}">${safeTitle}</text><text x="36" y="104" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" fill="${textMuted}">Keine Knoten im Diagramm vorhanden.</text></svg>`;
  }

  // Build adjacency & compute BFS topological layers (handles cycles safely)
  const outAdj = new Map<string, string[]>();
  const inAdj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const n of allNodes) {
    outAdj.set(n.id, []);
    inAdj.set(n.id, []);
    inDeg.set(n.id, 0);
  }
  for (const e of graph.edges) {
    if (!graph.nodes.has(e.from) || !graph.nodes.has(e.to)) continue;
    outAdj.get(e.from)!.push(e.to);
    inAdj.get(e.to)!.push(e.from);
    inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
  }

  const rankById = new Map<string, number>();
  const queue: string[] = [];
  const seeds =
    graph.entryNodes.length > 0
      ? graph.entryNodes.map((n) => n.id)
      : allNodes.filter((n) => (inDeg.get(n.id) || 0) === 0).map((n) => n.id);
  const effectiveSeeds = seeds.length > 0 ? seeds : [allNodes[0].id];

  for (const sid of effectiveSeeds) {
    if (!rankById.has(sid)) {
      rankById.set(sid, 0);
      queue.push(sid);
    }
  }

  let qHead = 0;
  const maxRankCap = Math.max(16, Math.min(120, Math.ceil(Math.sqrt(allNodes.length) * 4)));
  while (qHead < queue.length) {
    const cur = queue[qHead++];
    const curRank = rankById.get(cur) || 0;
    const nexts = outAdj.get(cur) || [];
    for (const nxt of nexts) {
      if (!rankById.has(nxt)) {
        rankById.set(nxt, Math.min(maxRankCap, curRank + 1));
        queue.push(nxt);
      }
    }
  }

  for (const n of allNodes) {
    if (!rankById.has(n.id)) {
      rankById.set(n.id, 0);
    }
  }

  const rawLayers = new Map<number, CallflowNode[]>();
  for (const n of allNodes) {
    const r = rankById.get(n.id) || 0;
    if (!rawLayers.has(r)) rawLayers.set(r, []);
    rawLayers.get(r)!.push(n);
  }

  const sortedRanks = Array.from(rawLayers.keys()).sort((a, b) => a - b);
  if (direction === 'RL' || direction === 'BT') {
    sortedRanks.reverse();
  }

  const orderIndexById = new Map<string, number>();
  for (const r of sortedRanks) {
    const layerNodes = rawLayers.get(r)!;
    if (orderIndexById.size > 0) {
      layerNodes.sort((a, b) => {
        const parentsA = (inAdj.get(a.id) || []).filter((p) => orderIndexById.has(p));
        const parentsB = (inAdj.get(b.id) || []).filter((p) => orderIndexById.has(p));
        const avgA =
          parentsA.length > 0
            ? parentsA.reduce((s, p) => s + (orderIndexById.get(p) || 0), 0) / parentsA.length
            : Number.MAX_SAFE_INTEGER;
        const avgB =
          parentsB.length > 0
            ? parentsB.reduce((s, p) => s + (orderIndexById.get(p) || 0), 0) / parentsB.length
            : Number.MAX_SAFE_INTEGER;
        return avgA - avgB;
      });
    }
    layerNodes.forEach((n, idx) => orderIndexById.set(n.id, idx));
  }

  const isVertical = direction === 'TB' || direction === 'TD' || direction === 'BT';
  const NODE_W = 248;
  const NODE_H = 68;
  const LAYER_GAP = isVertical ? 92 : 124;
  const SIBLING_GAP = isVertical ? 34 : 26;
  const PAD_X = 48;
  const PAD_Y = 58;

  // Single clean column (LR/RL) or single clean row (TB/BT) per rank — never pile overlapping sub-columns
  let maxLayerSpan = 1;
  for (const r of sortedRanks) {
    const count = rawLayers.get(r)!.length;
    if (count > maxLayerSpan) maxLayerSpan = count;
  }

  const maxCrossSize = isVertical
    ? maxLayerSpan * NODE_W + Math.max(0, maxLayerSpan - 1) * SIBLING_GAP
    : maxLayerSpan * NODE_H + Math.max(0, maxLayerSpan - 1) * SIBLING_GAP;

  const posById = new Map<string, { x: number; y: number; w: number; h: number }>();
  let maxRightX = 760;
  let maxBottomY = 340;

  sortedRanks.forEach((r, rankIdx) => {
    const layerNodes = rawLayers.get(r)!;
    const layerCrossSize = isVertical
      ? layerNodes.length * NODE_W + Math.max(0, layerNodes.length - 1) * SIBLING_GAP
      : layerNodes.length * NODE_H + Math.max(0, layerNodes.length - 1) * SIBLING_GAP;
    const crossOffset = Math.max(0, Math.round((maxCrossSize - layerCrossSize) * 0.5));

    layerNodes.forEach((node, slotIdx) => {
      const x = isVertical
        ? PAD_X + crossOffset + slotIdx * (NODE_W + SIBLING_GAP)
        : PAD_X + rankIdx * (NODE_W + LAYER_GAP);
      const y = isVertical
        ? PAD_Y + rankIdx * (NODE_H + LAYER_GAP)
        : PAD_Y + crossOffset + slotIdx * (NODE_H + SIBLING_GAP);
      posById.set(node.id, { x, y, w: NODE_W, h: NODE_H });
      if (x + NODE_W > maxRightX) maxRightX = x + NODE_W;
      if (y + NODE_H > maxBottomY) maxBottomY = y + NODE_H;
    });
  });

  const totalW = Math.max(760, maxRightX + PAD_X);
  const totalH = Math.max(340, maxBottomY + PAD_Y);

  const wrapLabelLines = (raw: string): string[] => {
    const normalized = String(raw || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/\r/g, '')
      .trim();
    const out: string[] = [];
    for (const seg of normalized.split('\n')) {
      const words = seg.trim().split(/\s+/).filter(Boolean);
      let line = '';
      for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        if (candidate.length > 33 && line) {
          out.push(line);
          line = w.length > 33 ? `${w.slice(0, 32)}…` : w;
        } else {
          line = candidate.length > 33 ? `${candidate.slice(0, 32)}…` : candidate;
        }
        if (out.length >= 3) break;
      }
      if (line && out.length < 3) out.push(line);
      if (out.length >= 3) break;
    }
    return out.length > 0 ? out.slice(0, 3) : ['Knoten'];
  };

  const getNodeColors = (node: CallflowNode): { fill: string; stroke: string; headerTint: string } => {
    const lbl = (node.label || '').toLowerCase();
    const idLower = node.id.toLowerCase();
    if (node.role === 'entry' || /einstieg|start|main/.test(idLower)) {
      return isDark
        ? { fill: '#064e3b', stroke: '#10b981', headerTint: '#047857' }
        : { fill: '#ecfdf5', stroke: '#059669', headerTint: '#d1fae5' };
    }
    if (
      /zeit|feiertag|sondzeit|bedingung|dtmf|wahl|menu|choice/.test(lbl) ||
      idLower.startsWith('choice_')
    ) {
      return isDark
        ? { fill: '#451a03', stroke: '#f59e0b', headerTint: '#78350f' }
        : { fill: '#fffbeb', stroke: '#d97706', headerTint: '#fef3c7' };
    }
    if (/queue|skillset|warteschlange|agent/.test(lbl) || idLower.startsWith('queue_')) {
      return isDark
        ? { fill: '#172554', stroke: '#3b82f6', headerTint: '#1e3a8a' }
        : { fill: '#eff6ff', stroke: '#2563eb', headerTint: '#dbeafe' };
    }
    if (node.role === 'terminal' || /disconnect|trennen|abwurf|ende|ansage/.test(lbl)) {
      return isDark
        ? { fill: '#3b0764', stroke: '#a855f7', headerTint: '#581c87' }
        : { fill: '#faf5ff', stroke: '#7e22ce', headerTint: '#f3e8ff' };
    }
    return isDark
      ? { fill: '#1e293b', stroke: '#475569', headerTint: '#334155' }
      : { fill: '#ffffff', stroke: '#94a3b8', headerTint: '#f1f5f9' };
  };

  const edgePathParts: string[] = [];
  const edgeLabelParts: string[] = [];
  const edgeCounterByPair = new Map<string, number>();

  for (const edge of graph.edges) {
    const pFrom = posById.get(edge.from);
    const pTo = posById.get(edge.to);
    if (!pFrom || !pTo) continue;

    const pairKey = `${edge.from}->${edge.to}`;
    const idx = edgeCounterByPair.get(pairKey) || 0;
    edgeCounterByPair.set(pairKey, idx + 1);
    const edgeDomId = `L_${edge.from}_${edge.to}_${idx}`;

    let d: string;
    let labelX: number;
    let labelY: number;

    if (edge.from === edge.to) {
      const lx = pFrom.x + pFrom.w / 2;
      const ly = pFrom.y;
      d = `M ${lx - 18} ${ly} C ${lx - 30} ${ly - 36}, ${lx + 30} ${ly - 36}, ${lx + 18} ${ly}`;
      labelX = lx;
      labelY = ly - 24;
    } else if (isVertical) {
      const x1 = pFrom.x + pFrom.w / 2;
      const y1 = pFrom.y + pFrom.h;
      const x2 = pTo.x + pTo.w / 2;
      const y2 = pTo.y;
      if (y2 >= y1 - 8) {
        const midY = y1 + Math.min(48, Math.max(20, (y2 - y1) * 0.5));
        d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x1.toFixed(1)} ${midY.toFixed(1)} L ${x2.toFixed(1)} ${midY.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        labelX = (x1 + x2) / 2;
        labelY = midY - 4;
      } else {
        const arcOffset = 28 + (idx % 4) * 14;
        const midX = Math.max(pFrom.x + pFrom.w, pTo.x + pTo.w) + arcOffset;
        const midY = (pFrom.y + pTo.y) / 2;
        d = `M ${pFrom.x + pFrom.w} ${pFrom.y + pFrom.h / 2} Q ${midX} ${midY}, ${pTo.x + pTo.w} ${pTo.y + pTo.h / 2}`;
        labelX = midX;
        labelY = midY;
      }
    } else {
      const x1 = pFrom.x + pFrom.w;
      const y1 = pFrom.y + pFrom.h / 2;
      const x2 = pTo.x;
      const y2 = pTo.y + pTo.h / 2;
      if (x2 >= x1 - 8) {
        const midX = x1 + Math.min(56, Math.max(24, (x2 - x1) * 0.5));
        d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${midX.toFixed(1)} ${y1.toFixed(1)} L ${midX.toFixed(1)} ${y2.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
        labelX = midX;
        labelY = (y1 + y2) / 2 - 4;
      } else {
        const arcOffset = 28 + (idx % 4) * 14;
        const midX = (x1 + x2) / 2;
        const midY = Math.min(y1, y2) - arcOffset;
        d = `M ${pFrom.x + pFrom.w / 2} ${pFrom.y} Q ${midX} ${midY}, ${pTo.x + pTo.w / 2} ${pTo.y}`;
        labelX = midX;
        labelY = midY + 4;
      }
    }

    const isDotted = edge.isAsync || edge.rawArrow.includes('.');
    const isThick = edge.rawArrow.includes('=');
    const strokeDash = isDotted ? ' stroke-dasharray="5,4"' : '';
    const strokeWidth = isThick ? '2.4' : '1.45';
    const escFrom = escXml(edge.from);
    const escTo = escXml(edge.to);
    edgePathParts.push(
      `<path id="${escXml(edgeDomId)}" data-id="${escXml(edgeDomId)}" data-edge-from="${escFrom}" data-edge-to="${escTo}" class="flowchart-link edge-thickness-normal edge-pattern-solid" d="${d}" fill="none" stroke="${edgeStroke}" stroke-width="${strokeWidth}"${strokeDash} marker-end="url(#det-arrow)"/>`
    );

    const cleanEdgeLabel = (edge.label || '').trim();
    if (cleanEdgeLabel && graph.edges.length <= 750) {
      const shortLbl =
        cleanEdgeLabel.length > 26 ? `${cleanEdgeLabel.slice(0, 25)}…` : cleanEdgeLabel;
      const pillW = Math.max(36, Math.min(180, shortLbl.length * 6.3 + 14));
      edgeLabelParts.push(
        `<g class="edgeLabel" data-id="${escXml(edgeDomId)}" data-edge-from="${escFrom}" data-edge-to="${escTo}" transform="translate(${labelX.toFixed(1)}, ${labelY.toFixed(1)})"><rect x="${(-pillW / 2).toFixed(1)}" y="-9" width="${pillW.toFixed(1)}" height="18" rx="4" fill="${edgeLabelBg}" stroke="${edgeLabelBorder}" stroke-width="0.9"/><text x="0" y="3.5" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="10.5" fill="${textMuted}">${escXml(shortLbl)}</text></g>`
      );
    }
  }

  const nodeParts: string[] = [];
  for (const node of allNodes) {
    const pos = posById.get(node.id);
    if (!pos) continue;
    const colors = getNodeColors(node);
    const lines = wrapLabelLines(node.label || node.id);
    const lineHeight = 15.5;
    const startY = (pos.h - (lines.length - 1) * lineHeight) / 2 + 4;
    const tspans = lines
      .map(
        (ln, li) =>
          `<tspan x="${(pos.w / 2).toFixed(1)}" y="${(startY + li * lineHeight).toFixed(1)}"${li === 0 ? ' font-weight="600"' : ` fill="${textMuted}" font-size="11"`}>${escXml(ln)}</tspan>`
      )
      .join('');
    const nodeDomId = `flowchart-${node.id}-0`;
    nodeParts.push(
      `<g class="node default" id="${escXml(nodeDomId)}" data-id="${escXml(node.id)}" transform="translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})"><rect class="basic label-container" x="0" y="0" width="${pos.w}" height="${pos.h}" rx="10" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.6"/><text font-family="ui-sans-serif, system-ui, sans-serif" font-size="12" fill="${textMain}" text-anchor="middle">${tspans}</text></g>`
    );
  }

  const headerNote = title
    ? `<text x="${PAD_X}" y="30" font-family="ui-sans-serif, system-ui, sans-serif" font-size="13" font-weight="600" fill="${textMuted}">${escXml(title.slice(0, 96))} · ${allNodes.length} Knoten · ${graph.edges.length} Übergänge (Vektor-Layout)</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}" style="background:${bg}"><defs><marker id="det-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="${edgeStroke}"/></marker></defs>${headerNote}<g class="edgePaths">${edgePathParts.join('')}</g><g class="edgeLabels">${edgeLabelParts.join('')}</g><g class="nodes">${nodeParts.join('')}</g></svg>`;
}

export interface InteractiveCallflowHtmlNodeDetail {
  nodeId: string;
  mode: 'workspace-module' | 'workspace-step' | 'workspace-external' | 'raw-mermaid';
  scriptNumber: string;
  title: string;
  blockType: string;
  prio?: number;
  announcement?: string;
  queueTarget?: string;
  schedule?: string;
  condition?: string;
  canJumpToDetailScript?: boolean;
  detailTargetScriptNumber?: string;
  entryDnisNumbers?: string[];
  organizationName?: string;
  cdnAlias?: string;
  resolvedScheduleDisplay?: string;
  hasHolidayCheck?: boolean;
  waitSeconds?: number;
  treatmentInfo?: string;
  hdxAction?: string;
  incomingConnections?: Array<{
    fromScriptNumber: string;
    fromLabel: string;
    edgeLabel: string;
  }>;
  outgoingConnections?: Array<{
    id: string;
    toTargetNumber: string;
    label: string;
    kind: string;
  }>;
  moduleRulesPreview?: Array<{
    id: string;
    prio: number;
    stepName: string;
    condition?: string;
    schedule?: string;
    holiday?: string;
    targetNumber?: string;
    queueTarget?: string;
    announcement?: string;
    choicesCount: number;
  }>;
  specialParameters?: CallflowScriptParameterItem[];
  relatedFindings?: Array<{
    severity: 'error' | 'warning' | 'info';
    title: string;
    recommendation: string;
  }>;
  rawLineSnippet?: string;
  highlightStartLine?: number;
  highlightEndLine?: number;
  explanation?: DualAudienceNodeExplanation;
}

export type GenesysProfileKey =
  | 'strict-dataAction'
  | 'strict-dataTable'
  | 'strict-review'
  | 'placeholder';

export interface InteractiveCallflowHtmlGenesysFinding {
  code: string;
  severity: 'error' | 'warning' | 'info';
  category: string;
  warningClass: string;
  message: string;
  nodeId?: string;
  suggestion?: string;
  fileName?: string;
  scriptNumber?: string;
  cleanName?: string;
}

export interface InteractiveCallflowHtmlGenesysModeReport {
  mode: 'avaya' | 'genesys';
  modeLabel: string;
  summary: string[];
  assumptionsAndOpenPoints: string[];
  migrationHints: string[];
  renderedCode?: string;
  renderedCodeKey?: string;
}

export interface InteractiveCallflowHtmlGenesysHolidayMapping {
  variableName: string;
  lookupTarget?: 'dataAction' | 'dataTable';
  lookupActionOrTable?: string;
  booleanVarName?: string;
  replacedSubflow?: string;
}

export interface InteractiveCallflowHtmlGenesysVariant {
  svgKey?: string;
  primaryViewKey?: string;
  readiness?: 'LOW' | 'MEDIUM' | 'HIGH';
  readinessReasons?: string[];
  warnings?: Array<{
    code: string;
    severity: 'warning' | 'blocker' | 'info' | 'error';
    message: string;
    lineNumber?: number;
  }>;
  archyYaml?: string;
  archyYamlKey?: string;
  archyFilename?: string;
  yamlValidation?: InteractiveCallflowHtmlView['genesysYamlValidation'];
  flowIR?: unknown;
  flowIrKey?: string;
  flowIrJson?: string;
  flowIRFilename?: string;
  irFindings?: InteractiveCallflowHtmlGenesysFinding[];
  avayaReport?: InteractiveCallflowHtmlGenesysModeReport;
  genesysReport?: InteractiveCallflowHtmlGenesysModeReport;
  holidayMappings?: InteractiveCallflowHtmlGenesysHolidayMapping[];
}

export interface InteractiveCallflowHtmlGenesysProfileSummary {
  profileKey: GenesysProfileKey;
  modeLabel: string;
  generatedAt: string;
  overallReadiness: 'LOW' | 'MEDIUM' | 'HIGH';
  compatibilityStubMode: boolean;
  resolvedTargetEnabled: boolean;
  holidayLookupTarget: 'dataAction' | 'dataTable';
  summary: {
    totalScripts: number;
    lowCount: number;
    mediumCount: number;
    highCount: number;
    commonModuleCount: number;
    yamlValidScriptCount: number;
    yamlErrorCount: number;
    totalIrFindings: number;
  };
  masterGenesysMermaid?: string;
  scripts: Array<{
    viewKey?: string;
    cleanName: string;
    scriptNumber: string;
    fileName: string;
    archyFilename: string;
    archyYaml?: string;
    flowIR?: unknown;
    flowIrJson?: string;
    readiness: 'LOW' | 'MEDIUM' | 'HIGH';
    readinessReasons: string[];
    yamlValid: boolean;
    yamlErrorCount: number;
  }>;
}

export interface InteractiveCallflowHtmlView {
  key: string;
  label: string;
  svg: string;
  graph: CallflowGraph;
  scriptNumber?: string;
  masterViewVariant?: 'compact' | 'detailed';
  nodeDetails?: Record<string, InteractiveCallflowHtmlNodeDetail>;
  genesysSvg?: string;
  genesysGraph?: CallflowGraph;
  genesysReadiness?: 'LOW' | 'MEDIUM' | 'HIGH';
  genesysReadinessReasons?: string[];
  genesysWarnings?: Array<{
    code: string;
    severity: 'warning' | 'blocker' | 'info' | 'error';
    message: string;
    lineNumber?: number;
  }>;
  genesysArchyYaml?: string;
  genesysArchyFilename?: string;
  genesysYamlValidation?: {
    isValid: boolean;
    errorCount: number;
    warningCount: number;
    validScriptCount?: number;
    totalScriptCount?: number;
    errors: Array<{
      lineNumber: number;
      code: string;
      message: string;
      suggestion?: string;
      fileName?: string;
    }>;
    warnings: Array<{
      lineNumber: number;
      code: string;
      message: string;
      suggestion?: string;
      fileName?: string;
    }>;
  };
  genesysVariants?: Partial<Record<GenesysProfileKey, InteractiveCallflowHtmlGenesysVariant>>;
  genesysVariantRefs?: Partial<Record<GenesysProfileKey, string>>;
}

export interface InteractiveCallflowHtmlAnalysisPayload {
  openIssues: CallflowOpenIssue[];
  healthFindings: CallflowHealthFinding[];
  scheduleRows: CallflowScheduleSummaryRow[];
  openingHoursBundle?: OpeningHoursExportBundle;
  inventoryBundle?: WorkspaceInventoryBundle;
  auditReport?: AuditReport;
  auditMermaid?: string;
  registry: CallflowResourceRegistry;
  routingMatrixRows: CallflowRoutingMatrixRow[];
  masterScriptNumber?: string;
  parametersByScript?: Record<string, CallflowScriptParameterItem[]>;
}

export interface InteractiveCallflowHtmlOptions {
  views?: InteractiveCallflowHtmlView[];
  activeViewKey?: string;
  initialMasterDensity?: 'compact' | 'detailed';
  initialPathColorMode?: PathColorMode;
  initialHiddenNodeTypes?: SmartColorNodeType[];
  initialIsolateSubgraph?: boolean;
  analysis?: InteractiveCallflowHtmlAnalysisPayload | null;
  globalSearchIndex?: GlobalSearchEntry[] | null;
  includeOriginalScripts?: boolean;
  rawScriptsByNumber?: Record<string, string>;
  initialGenesysProfile?: GenesysProfileKey;
  genesysSvgPool?: Record<string, { svg: string; graph?: CallflowGraph }>;
  genesysTextPool?: Record<string, string>;
  genesysVariantPool?: Record<string, InteractiveCallflowHtmlGenesysVariant>;
  genesysProfiles?: Partial<Record<GenesysProfileKey, InteractiveCallflowHtmlGenesysProfileSummary>>;
}

function escapeHtmlText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeJsonForScriptTag(jsonStr: string): string {
  return jsonStr.replace(/<\/script>/gi, '<\\/script>');
}

function pushSafeJsonChunk(parts: string[], value: unknown): void {
  const serialized = JSON.stringify(value);
  parts.push(serialized === undefined ? 'null' : sanitizeJsonForScriptTag(serialized));
}

function pushChunkedJsonArray(parts: string[], arr: unknown[] | null | undefined): void {
  if (!Array.isArray(arr)) {
    parts.push('[]');
    return;
  }
  parts.push('[');
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) parts.push(',');
    pushSafeJsonChunk(parts, arr[i]);
  }
  parts.push(']');
}

function pushChunkedJsonRecord(
  parts: string[],
  rec: Record<string, unknown> | null | undefined
): void {
  if (!rec || typeof rec !== 'object') {
    parts.push('null');
    return;
  }
  const entries = Object.entries(rec);
  parts.push('{');
  let first = true;
  for (let i = 0; i < entries.length; i++) {
    const [k, v] = entries[i];
    if (v === undefined) continue;
    if (!first) parts.push(',');
    first = false;
    parts.push(sanitizeJsonForScriptTag(JSON.stringify(k)), ':');
    pushSafeJsonChunk(parts, v);
  }
  parts.push('}');
}

function pushChunkedInventoryBundle(
  parts: string[],
  inv: WorkspaceInventoryBundle | undefined
): void {
  if (!inv) {
    parts.push('null');
    return;
  }
  const { items, occurrences, ...rest } = inv as WorkspaceInventoryBundle & {
    items?: unknown[];
    occurrences?: unknown[];
  };
  parts.push('{');
  let first = true;
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    if (!first) parts.push(',');
    first = false;
    parts.push(sanitizeJsonForScriptTag(JSON.stringify(k)), ':');
    pushSafeJsonChunk(parts, v);
  }
  if (!first) parts.push(',');
  parts.push('"items":');
  pushChunkedJsonArray(parts, items || []);
  parts.push(',"occurrences":');
  pushChunkedJsonArray(parts, occurrences || []);
  parts.push('}');
}

function pushChunkedAnalysisPayload(
  parts: string[],
  analysis: InteractiveCallflowHtmlAnalysisPayload | null
): void {
  if (!analysis) {
    parts.push('null');
    return;
  }
  parts.push('{"openIssues":');
  pushChunkedJsonArray(parts, analysis.openIssues);
  parts.push(',"healthFindings":');
  pushChunkedJsonArray(parts, analysis.healthFindings);
  parts.push(',"scheduleRows":');
  pushChunkedJsonArray(parts, analysis.scheduleRows);
  parts.push(',"openingHoursBundle":');
  pushSafeJsonChunk(parts, analysis.openingHoursBundle || null);
  parts.push(',"inventoryBundle":');
  pushChunkedInventoryBundle(parts, analysis.inventoryBundle);
  parts.push(',"auditReport":');
  pushSafeJsonChunk(parts, analysis.auditReport || null);
  parts.push(',"auditMermaid":');
  pushSafeJsonChunk(parts, analysis.auditMermaid || null);
  parts.push(',"registry":');
  pushSafeJsonChunk(parts, analysis.registry || null);
  parts.push(',"routingMatrixRows":');
  pushChunkedJsonArray(parts, analysis.routingMatrixRows);
  parts.push(',"masterScriptNumber":');
  pushSafeJsonChunk(parts, analysis.masterScriptNumber || null);
  parts.push(',"parametersByScript":');
  pushChunkedJsonRecord(
    parts,
    (analysis.parametersByScript as Record<string, unknown> | undefined) || null
  );
  parts.push('}');
}

/**
 * Generates a 100% standalone, offline-capable interactive HTML file as an array of Blob-ready string chunks
 * so even very large multi-script workspaces never exceed V8's maximum single-string length limit.
 */
export function generateInteractiveCallflowHtmlParts(
  diagramTitle: string,
  svgString: string,
  graph: CallflowGraph,
  canvasSurface: 'dark' | 'light',
  options?: InteractiveCallflowHtmlOptions
): string[] {
  const effectiveViews: InteractiveCallflowHtmlView[] =
    options?.views && options.views.length > 0
      ? options.views
      : [
          {
            key: 'current',
            label: diagramTitle || 'Callflow',
            svg: svgString,
            graph,
          },
        ];

  const targetViewKey =
    options?.activeViewKey && effectiveViews.some((v) => v.key === options.activeViewKey)
      ? options.activeViewKey
      : effectiveViews[0].key;

  const hasCompactMaster = effectiveViews.some((v) => v.key === 'master');
  const hasDetailedMaster = effectiveViews.some((v) => v.key === 'master:detailed');
  const initialMasterDensity: 'compact' | 'detailed' =
    options?.initialMasterDensity ||
    (targetViewKey === 'master:detailed' ? 'detailed' : 'compact');

  const initialPathColorMode: PathColorMode = options?.initialPathColorMode || 'semantic';
  const initialHiddenNodeTypes: SmartColorNodeType[] = options?.initialHiddenNodeTypes || [];
  const initialIsolateSubgraph = Boolean(options?.initialIsolateSubgraph);
  const initialGenesysProfile: GenesysProfileKey =
    options?.initialGenesysProfile || 'strict-dataAction';

  const mainView =
    effectiveViews.find(
      (v) =>
        v.scriptNumber &&
        /^(?:main|start|master(?:script)?)$/i.test(v.scriptNumber.trim())
    ) || effectiveViews.find((v) => /Main \(Einstiegsskript\)/i.test(v.label));

  const hasOriginalScriptsEnabled = Boolean(
    options?.includeOriginalScripts &&
      options?.rawScriptsByNumber &&
      Object.keys(options.rawScriptsByNumber).length > 0
  );

  const sanitizedRawScriptsByNumber = hasOriginalScriptsEnabled
    ? options?.rawScriptsByNumber || {}
    : null;

  const serializedGenesysSvgPool: Record<
    string,
    { svg: string; graph: { nodes: CallflowNode[]; edges: CallflowEdge[] } | null }
  > = {};
  if (options?.genesysSvgPool) {
    for (const [poolKey, entry] of Object.entries(options.genesysSvgPool)) {
      serializedGenesysSvgPool[poolKey] = {
        svg: entry.svg,
        graph: entry.graph
          ? {
              nodes: Array.from(entry.graph.nodes.values()),
              edges: entry.graph.edges,
            }
          : null,
      };
    }
  }

  const serializedViews = effectiveViews.map((v) => {
    let serializedNodeDetails: Record<string, InteractiveCallflowHtmlNodeDetail> | null = null;
    if (v.nodeDetails) {
      if (hasOriginalScriptsEnabled) {
        serializedNodeDetails = v.nodeDetails;
      } else {
        serializedNodeDetails = {};
        for (const [nid, det] of Object.entries(v.nodeDetails)) {
          const { rawLineSnippet: _r, highlightStartLine: _hs, highlightEndLine: _he, ...cleanDet } =
            det;
          serializedNodeDetails[nid] = cleanDet;
        }
      }
    }
    return {
      key: v.key,
      label: v.label,
      scriptNumber: v.scriptNumber || null,
      masterViewVariant: v.masterViewVariant || null,
      svg: v.svg,
      graph: {
        nodes: Array.from(v.graph.nodes.values()),
        edges: v.graph.edges,
      },
      nodeDetails: serializedNodeDetails,
      genesysSvg: v.genesysSvg || null,
      genesysGraph: v.genesysGraph
        ? {
            nodes: Array.from(v.genesysGraph.nodes.values()),
            edges: v.genesysGraph.edges,
          }
        : null,
      genesysReadiness: v.genesysReadiness || null,
      genesysReadinessReasons: v.genesysReadinessReasons || [],
      genesysWarnings: v.genesysWarnings || [],
      genesysArchyYaml: v.genesysArchyYaml || null,
      genesysArchyFilename: v.genesysArchyFilename || null,
      genesysYamlValidation: v.genesysYamlValidation || null,
      genesysVariants: v.genesysVariants || null,
      genesysVariantRefs: v.genesysVariantRefs || null,
    };
  });

  const hasGenesysViews = effectiveViews.some((v) =>
    Boolean(
      v.genesysSvg ||
        (v.genesysVariants && Object.keys(v.genesysVariants).length > 0) ||
        (v.genesysVariantRefs && Object.keys(v.genesysVariantRefs).length > 0)
    )
  );

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

  const enrichedAnalysis: InteractiveCallflowHtmlAnalysisPayload | null = options?.analysis
    ? {
        ...options.analysis,
        openingHoursBundle:
          options.analysis.openingHoursBundle ||
          buildOpeningHoursExportBundleFromRows(options.analysis.scheduleRows || [], {
            diagramTitle: diagramTitle || undefined,
          }),
      }
    : null;

  const scriptCount = effectiveViews.filter((v) => Boolean(v.scriptNumber)).length;
  const pushPayloadJsonParts = (parts: string[]) => {
    parts.push('{"views":');
    pushChunkedJsonArray(parts, serializedViews);
    parts.push(',"initialViewKey":"welcome","defaultTargetViewKey":');
    pushSafeJsonChunk(parts, targetViewKey);
    parts.push(',"mainViewKey":');
    pushSafeJsonChunk(parts, mainView ? mainView.key : null);
    parts.push(',"mainViewLabel":');
    pushSafeJsonChunk(parts, mainView ? mainView.label : null);
    parts.push(',"welcomeSummary":');
    pushSafeJsonChunk(parts, {
      title: diagramTitle || 'Callflow',
      viewCount: effectiveViews.length,
      scriptCount,
      hasMultiViews: effectiveViews.length > 1,
    });
    parts.push(',"initialMasterDensity":');
    pushSafeJsonChunk(parts, initialMasterDensity);
    parts.push(',"hasBothMasterVariants":');
    pushSafeJsonChunk(parts, hasCompactMaster && hasDetailedMaster);
    parts.push(',"initialPathColorMode":');
    pushSafeJsonChunk(parts, initialPathColorMode);
    parts.push(',"initialSurface":');
    pushSafeJsonChunk(parts, canvasSurface);
    parts.push(',"initialHiddenNodeTypes":');
    pushSafeJsonChunk(parts, initialHiddenNodeTypes);
    parts.push(',"initialIsolateSubgraph":');
    pushSafeJsonChunk(parts, initialIsolateSubgraph);
    parts.push(',"drillTargetsByNodeId":');
    pushSafeJsonChunk(parts, drillTargetsByNodeId);
    parts.push(',"viewKeyByScriptNumber":');
    pushSafeJsonChunk(parts, viewKeyByScriptNumber);
    parts.push(',"nodeTypeOptions":');
    pushSafeJsonChunk(parts, SMART_COLOR_NODE_TYPE_OPTIONS);
    parts.push(',"semanticPalettes":');
    pushSafeJsonChunk(parts, SEMANTIC_PALETTES);
    parts.push(',"analysis":');
    pushChunkedAnalysisPayload(parts, enrichedAnalysis);
    parts.push(',"globalSearchIndex":');
    pushChunkedJsonArray(parts, options?.globalSearchIndex || []);
    parts.push(',"includeOriginalScripts":');
    pushSafeJsonChunk(parts, hasOriginalScriptsEnabled);
    parts.push(',"rawScriptsByNumber":');
    pushChunkedJsonRecord(parts, sanitizedRawScriptsByNumber);
    parts.push(',"hasGenesysViews":');
    pushSafeJsonChunk(parts, hasGenesysViews);
    parts.push(',"initialGenesysProfile":');
    pushSafeJsonChunk(parts, initialGenesysProfile);
    parts.push(',"genesysSvgPool":');
    pushChunkedJsonRecord(parts, serializedGenesysSvgPool);
    parts.push(',"genesysTextPool":');
    pushChunkedJsonRecord(parts, options?.genesysTextPool || null);
    parts.push(',"genesysVariantPool":');
    pushChunkedJsonRecord(
      parts,
      (options?.genesysVariantPool as Record<string, unknown> | undefined) || null
    );
    parts.push(',"genesysProfiles":');
    pushChunkedJsonRecord(
      parts,
      (options?.genesysProfiles as Record<string, unknown> | undefined) || null
    );
    parts.push('}');
  };

  const hasMultiViews = effectiveViews.length > 1;
  const safeTitle = escapeHtmlText(diagramTitle || 'Callflow');
  const isDarkSurface = canvasSurface === 'dark';

  const htmlParts: string[] = [];
  htmlParts.push(`<!doctype html>
<html lang="de" class="${isDarkSurface ? 'dark' : 'light'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
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
    .seg-btn.genesys-active {
      background: #ea580c;
      color: #ffffff;
      font-weight: 600;
    }
    #genesys-subbar {
      display: none;
      flex-direction: column;
      background: var(--bg-header);
      border-bottom: 1px solid rgba(234, 88, 12, 0.45);
      flex-shrink: 0;
      z-index: 9;
    }
    #genesys-subbar.open {
      display: flex;
    }
    .genesys-subbar-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 14px;
    }
    .genesys-subbar-left, .genesys-subbar-right {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }
    .genesys-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid rgba(234, 88, 12, 0.5);
      background: rgba(234, 88, 12, 0.16);
      color: #fdba74;
      white-space: nowrap;
    }
    html.light .genesys-pill {
      color: #9a3412;
      background: rgba(234, 88, 12, 0.12);
    }
    .genesys-badge-low {
      background: var(--ok-bg);
      border-color: var(--ok-border);
      color: var(--ok-text);
    }
    .genesys-badge-medium {
      background: var(--warn-bg);
      border-color: var(--warn-border);
      color: var(--warn-text);
    }
    .genesys-badge-high {
      background: var(--err-bg);
      border-color: var(--err-border);
      color: var(--err-text);
    }
    .genesys-yaml-valid {
      background: var(--ok-bg);
      border-color: var(--ok-border);
      color: var(--ok-text);
    }
    .genesys-yaml-invalid {
      background: var(--err-bg);
      border-color: var(--err-border);
      color: var(--err-text);
    }
    .seg-btn.strict-active {
      background: #059669;
      color: #ffffff;
      font-weight: 600;
    }
    .seg-btn.placeholder-active {
      background: #d97706;
      color: #ffffff;
      font-weight: 600;
    }
    .seg-btn.cyan-active {
      background: #0891b2;
      color: #ffffff;
      font-weight: 600;
    }
    .genesys-holiday-btn {
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid rgba(6, 182, 212, 0.5);
      background: rgba(6, 182, 212, 0.14);
      color: #67e8f9;
      white-space: nowrap;
    }
    html.light .genesys-holiday-btn {
      color: #0e7490;
      background: rgba(6, 182, 212, 0.12);
    }
    .genesys-holiday-btn.strict-review {
      border-color: var(--border-strong);
      background: var(--bg-card);
      color: var(--text-muted);
    }
    .genesys-drawer {
      display: none;
      border-top: 1px solid var(--border);
      background: var(--bg-card);
      padding: 10px 14px;
      max-height: 320px;
      overflow-y: auto;
    }
    .genesys-drawer.open {
      display: block;
    }
    .genesys-banner {
      font-size: 11px;
      line-height: 1.45;
      padding: 7px 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      margin-bottom: 8px;
    }
    .genesys-banner.amber {
      background: var(--warn-bg);
      border-color: var(--warn-border);
      color: var(--warn-text);
    }
    .genesys-banner.cyan {
      background: rgba(6, 182, 212, 0.12);
      border-color: rgba(6, 182, 212, 0.45);
      color: #67e8f9;
    }
    html.light .genesys-banner.cyan {
      color: #155e75;
    }
    .genesys-banner.ok {
      background: var(--ok-bg);
      border-color: var(--ok-border);
      color: var(--ok-text);
    }
    .genesys-summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin: 8px 0;
    }
    @media (max-width: 900px) {
      .genesys-summary-grid {
        grid-template-columns: 1fr;
      }
    }
    .genesys-summary-col {
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 9px;
      font-size: 11px;
      color: var(--text-main);
    }
    .genesys-summary-col h4 {
      margin: 0 0 5px;
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }
    .genesys-summary-col ul {
      margin: 0;
      padding-left: 14px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .genesys-finding-group {
      margin-top: 8px;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
    }
    .genesys-finding-group-head {
      padding: 5px 9px;
      background: var(--bg-input);
      border-bottom: 1px solid var(--border);
      font-size: 11px;
      font-weight: 600;
      color: var(--text-main);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .genesys-finding-row {
      padding: 6px 9px;
      border-bottom: 1px solid var(--border);
      font-size: 11px;
      color: var(--text-main);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .genesys-finding-row:last-child {
      border-bottom: none;
    }
    .genesys-yaml-pre {
      margin: 6px 0 0;
      padding: 10px 12px;
      border-radius: 7px;
      border: 1px solid var(--border);
      background: var(--bg-seg);
      color: var(--text-main);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1.5;
      white-space: pre;
      overflow: auto;
      max-height: 220px;
      user-select: text;
    }
    .inv-status-pill {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 600;
      border: 1px solid var(--border);
      white-space: nowrap;
    }
    .inv-status-active { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-text); }
    .inv-status-missing { background: var(--err-bg); border-color: var(--err-border); color: var(--err-text); }
    .inv-status-warn { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-text); }
    .inv-status-muted { background: var(--bg-input); border-color: var(--border); color: var(--text-muted); }
    .inv-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
    }
    .inv-table th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--bg-header);
      color: var(--text-muted);
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      text-align: left;
      padding: 7px 10px;
      border-bottom: 1px solid var(--border-strong);
      white-space: nowrap;
    }
    .inv-table td {
      padding: 7px 10px;
      border-bottom: 1px solid var(--border);
      color: var(--text-main);
      vertical-align: top;
    }
    .inv-table tr.inv-row-main:hover td {
      background: var(--bg-input);
    }
    .inv-detail-cell {
      background: var(--bg-seg);
      padding: 10px 14px !important;
    }
    .audit-kpi-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      margin-bottom: 8px;
    }
    .audit-kpi-box {
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 8px;
    }
    .audit-kpi-val {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-variant-numeric: tabular-nums;
      font-size: 15px;
      font-weight: 700;
      color: var(--text-main);
    }
    .audit-kpi-lbl {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 1px;
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
    #canvas-wrap[data-transforming="true"] #svg-stage svg {
      shape-rendering: optimizeSpeed;
    }
    #svg-stage {
      flex: 0 0 auto;
      width: max-content;
      height: max-content;
      transform-origin: center center;
      padding: 32px;
    }
    #svg-stage-frame {
      position: relative;
      display: inline-block;
      flex-shrink: 0;
    }
    #svg-layer {
      visibility: visible;
    }
    #gpu-proxy-layer {
      display: none;
      pointer-events: none;
      user-select: none;
      max-width: none !important;
      max-height: none !important;
    }
    #canvas-wrap[data-gpu-proxy="true"] #svg-stage {
      will-change: transform;
    }
    #canvas-wrap[data-gpu-proxy="true"] #svg-layer {
      display: none !important;
    }
    #canvas-wrap[data-gpu-proxy="true"] #gpu-proxy-layer {
      display: block !important;
    }
    #svg-stage svg {
      max-width: none !important;
      max-height: none !important;
      flex-shrink: 0;
      display: block;
      background: transparent !important;
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
    #welcome-overlay {
      position: absolute;
      inset: 0;
      z-index: 6;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: var(--bg-canvas);
      overflow-y: auto;
      cursor: default;
    }
    #welcome-overlay.open {
      display: flex;
    }
    .welcome-card {
      width: 100%;
      max-width: 520px;
      background: var(--bg-header);
      border: 1px solid var(--border-strong);
      border-radius: 12px;
      padding: 22px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .welcome-eyebrow {
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #34d399;
      font-weight: 600;
    }
    html.light .welcome-eyebrow {
      color: #059669;
    }
    .welcome-title {
      margin: 4px 0 0;
      font-size: 17px;
      font-weight: 700;
      color: var(--text-main);
      line-height: 1.3;
    }
    .welcome-sub {
      margin: 5px 0 0;
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.45;
      font-variant-numeric: tabular-nums;
    }
    .welcome-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .welcome-actions .welcome-btn-main-primary {
      flex: 1;
      min-width: 210px;
      padding: 9px 14px;
      font-size: 12.5px;
    }
    .welcome-picker {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .welcome-picker-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
    }
    .welcome-script-list {
      max-height: 185px;
      overflow-y: auto;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .welcome-script-item {
      width: 100%;
      justify-content: flex-start;
      text-align: left;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-main);
      padding: 6px 9px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .welcome-script-item:hover {
      background: var(--bg-hover);
      border-color: var(--border-strong);
    }
    .welcome-footer {
      padding-top: 12px;
      border-top: 1px solid var(--border);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .welcome-footer button {
      font-size: 11px;
      padding: 4px 9px;
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
    .script-dropdown-wrap {
      position: relative;
      display: inline-block;
    }
    .script-dropdown-btn {
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      background: var(--bg-input);
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      max-width: 320px;
      box-sizing: border-box;
    }
    .script-dropdown-btn:hover {
      border-color: var(--accent);
    }
    .script-dropdown-popover {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      width: min(540px, calc(100vw - 24px));
      min-width: 340px;
      max-height: min(560px, calc(100vh - 80px));
      background: var(--bg-card);
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      box-shadow: 0 14px 36px rgba(0,0,0,0.45);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .script-dropdown-search-bar {
      padding: 10px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-header);
      flex-shrink: 0;
    }
    .script-dropdown-search-bar input {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 7px 10px;
      border-radius: 6px;
      font-size: 12.5px;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
    }
    .script-dropdown-search-bar input:focus {
      border-color: var(--accent);
    }
    .script-dropdown-list {
      overflow-y: auto;
      flex: 1;
      max-height: min(480px, calc(100vh - 150px));
      padding: 6px;
    }
    .script-dropdown-item {
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12.5px;
      line-height: 1.38;
      color: var(--text-main);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      white-space: normal;
      word-break: break-word;
    }
    .script-dropdown-item:hover, .script-dropdown-item.highlighted {
      background: var(--bg-hover);
      color: var(--accent-text);
    }
    .script-dropdown-item.selected {
      background: var(--accent);
      color: #ffffff;
      font-weight: 600;
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
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(2, 6, 23, 0.78);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal-backdrop.open {
      display: flex;
    }
    .modal-shell {
      background: var(--bg-card);
      border: 1px solid var(--border-strong);
      border-radius: 12px;
      width: 100%;
      max-height: 86vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
      overflow: hidden;
    }
    /* Right-docked non-obscuring Node Info Panel on desktop so background jump & highlighter stay visible */
    #node-info-modal-overlay {
      background: rgba(2, 6, 23, 0.56);
      backdrop-filter: none;
    }
    @media (min-width: 1024px) {
      #node-info-modal-overlay {
        justify-content: flex-end;
        align-items: stretch;
        padding: 14px;
        background: rgba(2, 6, 23, 0.16);
        backdrop-filter: none;
      }
      #node-info-modal-overlay .modal-shell {
        max-width: 560px !important;
        width: min(560px, 44vw);
        height: calc(100vh - 28px);
        max-height: calc(100vh - 28px);
        box-shadow: -12px 0 42px rgba(0, 0, 0, 0.42);
      }
    }
    /* Unmistakable Element Highlighter around selected SVG node */
    @keyframes cfExportHighlighterPulse {
      0%, 100% { stroke-opacity: 0.96; }
      50% { stroke-opacity: 0.56; }
    }
    svg g.node[data-selected-node="true"],
    svg g.actor[data-selected-node="true"],
    svg g.statediagram-state[data-selected-node="true"] {
      filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.78)) drop-shadow(0 0 22px rgba(245, 158, 11, 0.36));
    }
    html.light svg g.node[data-selected-node="true"],
    html.light svg g.actor[data-selected-node="true"],
    html.light svg g.statediagram-state[data-selected-node="true"] {
      filter: drop-shadow(0 0 8px rgba(217, 119, 6, 0.66)) drop-shadow(0 0 18px rgba(245, 158, 11, 0.32));
    }
    svg .cf-selected-highlighter-rect {
      pointer-events: none;
      animation: cfExportHighlighterPulse 2s ease-in-out infinite;
    }
    svg .cf-selected-highlighter-outer {
      pointer-events: none;
    }
    .modal-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-header);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-shrink: 0;
    }
    .modal-tabs {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 18px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-header);
      flex-shrink: 0;
    }
    .modal-tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 5px 11px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .modal-tab-btn:hover { color: var(--text-main); background: var(--bg-hover); }
    .modal-tab-btn.active {
      background: var(--accent);
      border-color: var(--accent-border);
      color: #ffffff;
    }
    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .modal-footer {
      padding: 12px 18px;
      border-top: 1px solid var(--border);
      background: var(--bg-header);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-shrink: 0;
    }
    .facts-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .fact-cell {
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-input);
      min-width: 0;
    }
    .fact-label {
      font-size: 10.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .fact-value {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text-main);
      word-break: break-word;
      font-variant-numeric: tabular-nums;
    }
    .fact-value.mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--accent-text);
    }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .profile-card {
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-input);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .profile-scripts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .profile-script-btn {
      padding: 4px 9px;
      border-radius: 6px;
      border: 1px solid var(--border-strong);
      background: var(--bg-card);
      color: var(--text-main);
      font-size: 11.5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      cursor: pointer;
      white-space: nowrap;
    }
    .profile-script-btn:hover {
      border-color: var(--accent-border);
      color: var(--accent-text);
      background: var(--bg-hover);
    }
    .raw-snippet {
      margin: 0;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-seg);
      color: var(--text-main);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      line-height: 1.45;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #canvas-node-info-btn {
      position: absolute;
      top: 0;
      left: 0;
      z-index: 26;
      display: none;
      align-items: center;
      gap: 5px;
      height: 30px;
      padding: 0 10px 0 7px;
      border-radius: 8px;
      border: 1px solid var(--accent-border);
      background: var(--bg-header);
      color: var(--text-main);
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
      white-space: nowrap;
      user-select: none;
      transition: background 120ms ease, border-color 120ms ease;
    }
    #canvas-node-info-btn:hover {
      background: var(--accent);
      color: #ffffff;
      border-color: var(--accent);
    }
    #canvas-node-info-btn .cnib-icon {
      width: 17px;
      height: 17px;
      border-radius: 50%;
      background: var(--accent);
      color: #ffffff;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    #canvas-node-info-btn:hover .cnib-icon {
      background: rgba(255, 255, 255, 0.22);
    }
    #diagram-legend-popover {
      position: absolute;
      left: 12px;
      bottom: 12px;
      z-index: 27;
      width: 320px;
      max-width: calc(100% - 24px);
      max-height: min(62vh, 460px);
      display: none;
      flex-direction: column;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--bg-header);
      color: var(--text-main);
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.35);
      overflow: hidden;
    }
    #diagram-legend-popover.open {
      display: flex;
    }
    .dleg-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-card);
    }
    .dleg-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-main);
    }
    .dleg-body {
      padding: 10px 12px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .dleg-section-title {
      font-size: 10.5px;
      font-weight: 700;
      color: var(--text-muted);
      margin-bottom: 5px;
    }
    .dleg-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .dleg-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 11.5px;
      line-height: 1.35;
    }
    .dleg-swatch {
      width: 12px;
      height: 12px;
      border-radius: 3px;
      margin-top: 2px;
      flex-shrink: 0;
      border: 1px solid rgba(255, 255, 255, 0.18);
    }
    .dleg-line-swatch {
      width: 18px;
      height: 0;
      border-top: 2.5px solid var(--accent);
      margin-top: 7px;
      flex-shrink: 0;
    }
    .dleg-row-text {
      min-width: 0;
      flex: 1;
    }
    .dleg-row-name {
      font-weight: 600;
      color: var(--text-main);
    }
    .dleg-row-desc {
      font-size: 10.5px;
      color: var(--text-muted);
    }
    .dleg-count {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10.5px;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .audience-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      padding: 9px 18px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-header);
      flex-shrink: 0;
    }
    .audience-switch {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 3px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-seg);
    }
    .audience-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background 120ms ease, color 120ms ease;
    }
    .audience-btn:hover {
      color: var(--text-main);
    }
    .audience-btn.active-layperson {
      background: #059669;
      color: #ffffff;
    }
    .audience-btn.active-pro {
      background: var(--accent);
      color: #ffffff;
    }
    .audience-btn.active-script {
      background: #475569;
      color: #ffffff;
    }
    html.light .audience-btn.active-script {
      background: #334155;
      color: #ffffff;
    }
    .script-panel {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: var(--bg-seg);
    }
    .script-toolbar {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-header);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .script-toolbar-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 11.5px;
    }
    .script-meta {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .script-meta strong {
      color: var(--text-main);
    }
    .script-meta-hl {
      color: var(--amber-text);
      font-weight: 600;
    }
    .script-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .script-search-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .script-search-input {
      flex: 1;
      min-width: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      padding: 5px 8px;
    }
    .script-search-nav {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .script-search-count {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      color: var(--text-muted);
      padding: 0 4px;
      white-space: nowrap;
    }
    .script-viewer {
      max-height: 50vh;
      overflow: auto;
      padding: 6px 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      line-height: 1.55;
      background: var(--bg-seg);
    }
    .script-line {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 1px 12px;
      color: var(--text-main);
    }
    .script-line:hover {
      background: var(--bg-hover);
    }
    .script-line.is-node-highlight {
      background: rgba(245, 158, 11, 0.14);
    }
    html.light .script-line.is-node-highlight {
      background: rgba(245, 158, 11, 0.16);
    }
    .script-line.is-search-match {
      background: rgba(99, 102, 241, 0.12);
    }
    .script-line.is-search-active {
      background: rgba(99, 102, 241, 0.28);
    }
    .script-ln {
      width: 38px;
      flex-shrink: 0;
      text-align: right;
      user-select: none;
      color: var(--text-dim);
      font-variant-numeric: tabular-nums;
    }
    .script-line.is-node-highlight .script-ln {
      color: var(--amber-text);
      font-weight: 700;
    }
    .script-line.is-search-active .script-ln {
      color: var(--accent-text);
      font-weight: 700;
    }
    .script-code {
      flex: 1;
      min-width: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .script-node-tag {
      flex-shrink: 0;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 10px;
      font-weight: 600;
      color: var(--amber-text);
      user-select: none;
      padding-left: 8px;
    }
    mark.script-mark {
      background: rgba(251, 191, 36, 0.35);
      color: inherit;
      border-radius: 2px;
      padding: 0 2px;
    }
    .script-empty {
      padding: 28px 18px;
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .layperson-hero {
      padding: 14px 16px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--bg-input);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .layperson-hero-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .layperson-hero-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-main);
    }
    .layperson-hero-tagline {
      font-size: 11.5px;
      font-weight: 600;
      color: #10b981;
    }
    .layperson-prose {
      margin: 0;
      font-size: 13px;
      line-height: 1.55;
      color: var(--text-main);
    }
    .layperson-steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .layperson-steps li {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--text-main);
    }
    .layperson-step-num {
      width: 20px;
      height: 20px;
      border-radius: 5px;
      border: 1px solid var(--border-strong);
      background: var(--bg-input);
      color: #10b981;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .tech-meta-strip {
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-seg);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
      word-break: break-word;
    }
    .copy-snippet-btn {
      padding: 3px 9px;
      border-radius: 5px;
      border: 1px solid var(--border-strong);
      background: var(--bg-card);
      color: var(--text-main);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
    .copy-snippet-btn:hover {
      background: var(--bg-hover);
      border-color: var(--accent-border);
    }
    main.sidebar-collapsed aside {
      display: none;
    }
    #minimap-box {
      position: absolute;
      right: 14px;
      bottom: 14px;
      z-index: 25;
      display: none;
      flex-direction: column;
      background: var(--bg-header);
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
      overflow: hidden;
      user-select: none;
    }
    #minimap-box.open {
      display: flex;
    }
    #minimap-resize-handle {
      position: absolute;
      top: 0;
      left: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      z-index: 6;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-dim);
      font-size: 10px;
      line-height: 1;
      border-bottom-right-radius: 4px;
    }
    #minimap-resize-handle:hover {
      color: var(--accent-text);
      background: var(--bg-hover);
    }
    .minimap-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 4px 8px 4px 18px;
      font-size: 10.5px;
      font-weight: 600;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }
    .minimap-head-controls {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      flex-shrink: 0;
    }
    .minimap-size-btn {
      padding: 1px 5px;
      font-size: 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      line-height: 1.3;
    }
    .minimap-size-btn:hover {
      background: var(--bg-hover);
      color: var(--text-main);
    }
    .minimap-size-btn.active {
      background: var(--accent);
      border-color: var(--accent-border);
      color: #ffffff;
    }
    #minimap-area {
      position: relative;
      margin: 6px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-canvas);
      overflow: hidden;
      cursor: crosshair;
      flex: 1;
      min-height: 70px;
    }
    #minimap-svg-host {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      overflow: hidden;
    }
    #minimap-svg-host svg {
      width: 100%;
      height: 100%;
      display: block;
      pointer-events: none;
    }
    .minimap-empty {
      font-size: 10.5px;
      color: var(--text-muted);
      text-align: center;
      padding: 8px;
      line-height: 1.4;
    }
    #minimap-viewport {
      position: absolute;
      top: 0;
      left: 0;
      border: 2px solid var(--accent-border);
      background: rgba(99, 102, 241, 0.18);
      border-radius: 2px;
      pointer-events: none;
      will-change: transform;
      display: none;
    }
    .gsearch-row {
      width: 100%;
      padding: 9px 14px;
      text-align: left;
      border: none;
      border-bottom: 1px solid var(--border);
      background: transparent;
      color: var(--text-main);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      cursor: pointer;
    }
    .gsearch-row:hover, .gsearch-row.active {
      background: var(--bg-hover);
    }
    @media (max-width: 960px) {
      main { flex-direction: column; }
      aside { width: 100%; height: 46vh; border-left: none; border-top: 1px solid var(--border); }
      .facts-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">${safeTitle} · Interaktiver Explorer</div>
    <div class="controls">
      <div class="view-bar" id="view-bar">
        <div class="script-dropdown-wrap" id="script-dropdown-wrap">
          <button type="button" class="script-dropdown-btn" id="script-dropdown-btn" title="Skript oder Ebene wählen">
            <span id="script-dropdown-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Startseite · Ansicht wählen</span>
            <span style="opacity:0.6;font-size:10px;">▼</span>
          </button>
          <div class="script-dropdown-popover" id="script-dropdown-popover" style="display:none;">
            <div class="script-dropdown-search-bar">
              <input type="text" id="script-dropdown-search" placeholder="Skript suchen (Nr., Name)..." />
            </div>
            <div class="script-dropdown-list" id="script-dropdown-items"></div>
          </div>
        </div>
        <div class="seg-group" id="master-density-group" style="display:none;" title="Kompakt-Modus für maximale Performance vs. Voll-Detail mit separaten Queue-/Endpunkt-Knoten">
          <button type="button" class="seg-btn" data-density="compact">Kompakt</button>
          <button type="button" class="seg-btn" data-density="detailed">Voll-Detail</button>
        </div>
        <button type="button" id="btn-open-schedules" title="Extra Fenster: Übersicht aller Öffnungszeiten, Zeitprofile &amp; SondZeit-Pläne öffnen" style="padding:3px 9px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid var(--amber-border);background:var(--amber-bg);color:var(--amber-text);cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex-shrink:0;">Öffnungszeiten <span id="btn-open-schedules-count" style="font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums;"></span></button>
        <button type="button" id="btn-open-inventory" title="Asset-Inventar (Prompts, Skillsets, Rufnummern, Variablen, DB/APIs, Subflows, Zeiten &amp; Auffälligkeiten) inkl. Excel-, CSV- &amp; JSON-Export" style="padding:3px 9px;font-size:11px;font-weight:600;border-radius:6px;border:1px solid var(--ok-border);background:var(--ok-bg);color:var(--ok-text);cursor:pointer;display:none;align-items:center;gap:5px;white-space:nowrap;flex-shrink:0;">Inventar <span id="btn-open-inventory-count" style="font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums;"></span></button>
        <button type="button" id="btn-global-search" title="Globale Suche über alle Skripte, DNIS, Queues &amp; Ansagen (Strg+K)" style="white-space:nowrap;">Suche <span style="opacity:0.65;font-family:ui-monospace,monospace;font-size:10px;">Strg+K</span></button>
        <button id="btn-master-back" style="display:none;" title="Zurück zur Master-Gesamtkarte (Ebene 1)">← Master-Karte</button>
        <button id="btn-welcome-home" style="display:none;" title="Zurück zur leeren Willkommensseite (Ansicht schließen)">Startseite</button>
      </div>
      <div class="seg-group" id="platform-mode-group" style="display:${hasGenesysViews ? 'inline-flex' : 'none'};" title="Direkt umschalten zwischen Avaya AACC Callflow und Genesys Cloud Architect Ziel-Callflow">
        <button type="button" class="seg-btn active" data-platform="avaya">Avaya AACC</button>
        <button type="button" class="seg-btn" data-platform="genesys">Genesys Cloud</button>
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
      <button id="btn-diagram-legend" title="Farb- und Bauteil-Legende ein-/ausblenden (L)">Legende</button>
      <button id="btn-minimap" title="Übersichts-Minimap ein-/ausblenden (M)">Minimap</button>
      <button id="btn-toggle-sidebar" title="Rechte Seitenleiste ein-/ausklappen (B)">Leiste</button>
      <button id="btn-fullscreen" title="Vollbild umschalten (F)">Vollbild</button>
      <button id="btn-theme" title="Hell/Dunkel-Darstellung umschalten">${isDarkSurface ? '☀ Hell' : '☾ Dunkel'}</button>
      <button id="btn-reset" title="Alle Filter, Auswahl &amp; Zoom zurücksetzen">Reset</button>
    </div>
  </header>
  <main id="main-layout">
    <div class="canvas-col">
      <div id="genesys-subbar" aria-label="Genesys Cloud Architect Migrationsleiste">
        <div class="genesys-subbar-row">
          <div class="genesys-subbar-left">
            <span class="genesys-pill" id="genesys-flow-label">Genesys Cloud Architect</span>
            <span class="genesys-pill" id="genesys-readiness-badge">Readiness: LOW</span>
            <button type="button" id="btn-genesys-yaml-status" style="display:none;padding:3px 8px;font-size:11px;font-weight:600;"></button>
            <span id="genesys-readiness-reasons" style="font-size:11px;color:var(--text-muted);"></span>
            <button type="button" id="btn-genesys-warnings" style="display:none;padding:3px 8px;font-size:11px;" class="amber"></button>
            <div class="seg-group" id="genesys-mode-group" style="display:none;" title="Quelltreu (Strikt): keine synthetischen Platzhalter. Platzhalter-Modus: Opt-In Kompatibilitäts-Stubs.">
              <button type="button" class="seg-btn" data-gmode="strict">Quelltreu (Strikt)</button>
              <button type="button" class="seg-btn" data-gmode="placeholder">Platzhalter-Modus</button>
            </div>
            <div id="genesys-holiday-controls" style="display:none;align-items:center;gap:6px;flex-wrap:wrap;">
              <button type="button" id="btn-genesys-holiday-toggle" class="genesys-holiday-btn" title="Umschalten zwischen Holiday DB: Guarded Standard und Strict Holiday Review">Holiday DB: Guarded Standard</button>
              <div class="seg-group" id="genesys-holiday-target-group" title="Genesys Ziel-Mechanismus für externe Feiertags-DB">
                <button type="button" class="seg-btn" data-htarget="dataAction">Data Action</button>
                <button type="button" class="seg-btn" data-htarget="dataTable">Data Table</button>
              </div>
              <button type="button" id="btn-genesys-holiday-mappings" style="display:none;padding:3px 8px;font-size:11px;font-weight:600;" title="Erkannte Feiertags-Variablen &amp; Ziel-Mappings anzeigen">Holiday Mappings</button>
            </div>
          </div>
          <div class="genesys-subbar-right">
            <button type="button" id="btn-genesys-yaml-toggle" style="display:none;padding:4px 9px;font-size:11px;font-weight:600;">Archy YAML / IR</button>
            <button type="button" id="btn-genesys-yaml-download" style="display:none;padding:4px 9px;font-size:11px;font-weight:600;background:#ea580c;border-color:#f97316;color:#fff;">Download .yaml</button>
            <button type="button" id="btn-genesys-flowir-download" style="display:none;padding:4px 9px;font-size:11px;font-weight:600;" title="Kanonisches FlowIR v1.1 als JSON herunterladen">flowIR (.json)</button>
            <button type="button" id="btn-genesys-zip-download" style="display:none;padding:4px 9px;font-size:11px;font-weight:600;background:#059669;border-color:#10b981;color:#fff;" title="Alle Archy-YAMLs, flowIR-Graphen, README &amp; Übersicht für den aktuellen Modus als ZIP-Paket laden">Alle YAML (.zip)</button>
          </div>
        </div>
        <div id="genesys-holiday-drawer" class="genesys-drawer"></div>
        <div id="genesys-validation-drawer" class="genesys-drawer"></div>
        <div id="genesys-warnings-drawer" class="genesys-drawer"></div>
        <div id="genesys-yaml-drawer" class="genesys-drawer">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <div class="seg-group" id="genesys-preview-mode-group">
                <button type="button" class="seg-btn genesys-active" data-pmode="genesys">Genesys (Archy YAML)</button>
                <button type="button" class="seg-btn" data-pmode="avaya">Avaya Mapping (flowIR v1.1)</button>
              </div>
              <span id="genesys-yaml-filename" style="font-family:ui-monospace,monospace;font-size:11.5px;color:var(--text-main);font-weight:600;"></span>
            </div>
            <button type="button" id="btn-genesys-yaml-copy" style="padding:3px 9px;font-size:11px;">Kopieren</button>
          </div>
          <div id="genesys-mode-banner"></div>
          <div id="genesys-mode-report" class="genesys-summary-grid" style="display:none;"></div>
          <pre id="genesys-yaml-code" class="genesys-yaml-pre"></pre>
        </div>
      </div>
      <div id="canvas-wrap">
        <div id="svg-stage">
          <div id="svg-stage-frame">
            <div id="svg-layer"></div>
            <img id="gpu-proxy-layer" alt="" draggable="false" />
          </div>
        </div>
        <button type="button" id="canvas-node-info-btn" title="Knoten-Info öffnen (Laie / IT-Profi)" aria-label="Knoten-Info öffnen"><span class="cnib-icon">i</span><span>Info</span></button>
        <div id="diagram-legend-popover" aria-label="Farb- und Bauteil-Legende">
          <div class="dleg-head">
            <span class="dleg-title">Farb- &amp; Bauteil-Legende</span>
            <button type="button" id="btn-close-diagram-legend" style="padding:1px 6px;font-size:11px;border:none;background:transparent;color:var(--text-muted);cursor:pointer;" title="Schließen (L / Esc)">✕</button>
          </div>
          <div class="dleg-body" id="diagram-legend-body"></div>
        </div>
        <div id="welcome-overlay" class="open" aria-label="Schnellstart Willkommensseite"></div>
        <div id="minimap-box" aria-label="Diagramm-Minimap">
          <div id="minimap-resize-handle" title="Ecke ziehen zum freien Skalieren">⤢</div>
          <div class="minimap-head">
            <span id="minimap-zoom-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Minimap</span>
            <div class="minimap-head-controls">
              <button type="button" class="minimap-size-btn active" data-msize="sm" title="Kompakt (S)">S</button>
              <button type="button" class="minimap-size-btn" data-msize="md" title="Mittel (M)">M</button>
              <button type="button" class="minimap-size-btn" data-msize="lg" title="Groß (L)">L</button>
              <button type="button" id="btn-close-minimap" style="padding:1px 5px;font-size:10.5px;border:none;background:transparent;color:var(--text-muted);cursor:pointer;" title="Schließen (M)">✕</button>
            </div>
          </div>
          <div id="minimap-area">
            <div id="minimap-svg-host"></div>
            <div id="minimap-viewport"></div>
          </div>
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
          <button class="an-subtab" data-subtab="audit">Audit</button>
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

  <!-- Dual-Audience Element Info Box Modal (Laie | IT-Profi) -->
  <div id="node-info-modal-overlay" class="modal-backdrop">
    <div class="modal-shell" style="max-width:780px;">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
          <button type="button" id="btn-node-info-back" style="display:none;flex-shrink:0;padding:5px 9px;border-radius:6px;border:1px solid var(--border-strong);background:var(--bg-card);color:var(--text-main);font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap;" title="Zum vorherigen Knoten im Info-Fenster">← Zurück</button>
          <div style="min-width:0;flex:1;">
            <h2 id="node-info-title" style="margin:0;font-size:15px;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Element-Details</h2>
            <div id="node-info-subtitle" style="font-size:11.5px;color:var(--text-muted);margin-top:2px;"></div>
          </div>
        </div>
        <button type="button" id="btn-close-node-info" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:4px 8px;flex-shrink:0;" title="Schließen (Esc)">✕</button>
      </div>
      <div class="audience-bar">
        <div class="audience-switch" id="node-info-tabs" role="tablist" aria-label="Ansichtsmodus">
          <button type="button" class="audience-btn active-layperson" data-nmode="layperson" role="tab" aria-selected="true">Laie</button>
          <button type="button" class="audience-btn" data-nmode="pro" role="tab" aria-selected="false">IT-Profi</button>${hasOriginalScriptsEnabled ? '\n          <button type="button" class="audience-btn" data-nmode="script" role="tab" aria-selected="false">Original-Skript</button>' : ''}
        </div>
        <span id="node-info-mode-hint" style="font-size:11px;color:var(--text-muted);">Verständlich erklärt für Fachbereich &amp; Projekt</span>
      </div>
      <div id="node-info-body" class="modal-body"></div>
      <div class="modal-footer">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <button type="button" id="btn-node-info-jump" class="primary" style="display:none;white-space:nowrap;"></button>
          <button type="button" id="btn-node-info-schedules" class="amber" style="display:none;white-space:nowrap;">Alle Öffnungszeiten</button>
        </div>
        <button type="button" id="btn-close-node-info-footer">Schließen</button>
      </div>
    </div>
  </div>

  <!-- Opening Hours Overview Modal (Wochenmatrix Mo–So + Zeitprofile + Detail-Regeln) -->
  <div id="schedules-modal-overlay" class="modal-backdrop">
    <div class="modal-shell" style="max-width:1180px;">
      <div class="modal-header">
        <div>
          <h2 style="margin:0;font-size:15px;color:var(--text-main);">Öffnungszeiten-Übersicht &amp; Wochenmatrix (Mo–So)</h2>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;font-variant-numeric:tabular-nums;" id="schedules-modal-subtitle">Konsolidierte Wochenmatrix pro Skript</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <div class="seg-group" id="modal-sched-view-group">
            <button type="button" class="seg-btn active" data-sview="matrix">Wochenmatrix (Mo–So)</button>
            <button type="button" class="seg-btn" data-sview="profiles">Zeitprofile</button>
            <button type="button" class="seg-btn" data-sview="table">Detail-Regeln</button>
          </div>
          <button type="button" id="btn-close-schedules-modal" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:4px 8px;" title="Schließen (Esc)">✕</button>
        </div>
      </div>
      <div style="padding:10px 18px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:var(--bg-input);flex-shrink:0;">
        <input type="text" id="modal-sched-search" placeholder="Skript, Uhrzeit (08:00), Fr, SondZeit suchen..." style="flex:1;min-width:190px;background:var(--bg-card);border:1px solid var(--border);color:var(--text-main);padding:6px 10px;border-radius:6px;font-size:11.5px;font-family:inherit;outline:none;" />
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;">
          <button type="button" id="btn-modal-hide-247" style="padding:6px 10px;background:var(--bg-card);color:var(--text-muted);border:1px solid var(--border-strong);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;" title="24/7-Skripte aus Vorschau und Export ausblenden">24/7 ausblenden</button>
          <button type="button" id="btn-modal-md" style="padding:6px 10px;background:var(--bg-card);color:var(--text-main);border:1px solid var(--border-strong);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">Markdown</button>
          <button type="button" id="btn-modal-csv" style="padding:6px 10px;background:var(--bg-card);color:var(--text-main);border:1px solid var(--border-strong);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">CSV</button>
          <button type="button" id="btn-modal-xlsx" style="padding:6px 12px;background:#059669;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;" title="Formatiertes 4-Blatt Excel-Workbook (.xlsx) herunterladen">Excel (.xlsx)</button>
        </div>
      </div>
      <div id="modal-sched-cats" style="padding:8px 18px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:6px;background:var(--bg-header);flex-shrink:0;">
        <button type="button" class="chip active" data-cat="all">Alle <span class="cat-cnt"></span></button>
        <button type="button" class="chip" data-cat="hours">Dienstzeiten <span class="cat-cnt"></span></button>
        <button type="button" class="chip" data-cat="sondzeit">SondZeit <span class="cat-cnt"></span></button>
        <button type="button" class="chip" data-cat="holiday">Feiertag <span class="cat-cnt"></span></button>
        <button type="button" class="chip" data-cat="always-open">24/7 <span class="cat-cnt"></span></button>
      </div>
      <div id="modal-sched-body" class="modal-body"></div>
    </div>
  </div>

  <!-- Asset-Inventar Modal (8 Domänen + Excel 9-Blatt, CSV, JSON) -->
  <div id="inventory-modal-overlay" class="modal-backdrop">
    <div class="modal-shell" style="max-width:1240px;">
      <div class="modal-header">
        <div>
          <h2 style="margin:0;font-size:15px;color:var(--text-main);">Asset-Inventar &amp; Migrations-Katalog</h2>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;font-variant-numeric:tabular-nums;" id="inv-modal-subtitle">Alle Prompts, Skillsets, Rufnummern, Variablen, DB/APIs, Subflows, Zeitpläne &amp; Auffälligkeiten</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <div class="seg-group" id="modal-inv-view-group">
            <button type="button" class="seg-btn active" data-iview="summary">Zusammenfassung</button>
            <button type="button" class="seg-btn" data-iview="occurrences">Einzelfunde</button>
          </div>
          <button type="button" id="btn-close-inventory-modal" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:4px 8px;" title="Schließen (Esc)">✕</button>
        </div>
      </div>
      <div style="padding:10px 18px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:var(--bg-input);flex-shrink:0;">
        <input type="text" id="modal-inv-search" placeholder="Prompt, WAV, Skillset, DNIS, Variable, HDX/API, Skript suchen..." style="flex:1;min-width:200px;background:var(--bg-card);border:1px solid var(--border);color:var(--text-main);padding:6px 10px;border-radius:6px;font-size:11.5px;font-family:inherit;outline:none;" />
        <div class="seg-group" id="modal-inv-status-group">
          <button type="button" class="seg-btn active" data-istatus="all">Alle</button>
          <button type="button" class="seg-btn" data-istatus="issues">Nur Auffälligkeiten</button>
        </div>
        <label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted);cursor:pointer;white-space:nowrap;">
          <input type="checkbox" id="chk-inv-export-filtered" />
          <span>Nur gefilterte exportieren</span>
        </label>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;">
          <button type="button" id="btn-inv-csv" style="padding:6px 10px;background:var(--bg-card);color:var(--text-main);border:1px solid var(--border-strong);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">CSV</button>
          <button type="button" id="btn-inv-json" style="padding:6px 10px;background:var(--bg-card);color:var(--text-main);border:1px solid var(--border-strong);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">JSON</button>
          <button type="button" id="btn-inv-xlsx" style="padding:6px 12px;background:#059669;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;" title="Formatiertes 9-Blatt Excel-Workbook (.xlsx) herunterladen">Excel (.xlsx)</button>
        </div>
      </div>
      <div id="modal-inv-cats" style="padding:8px 18px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;gap:6px;background:var(--bg-header);flex-shrink:0;"></div>
      <div id="modal-inv-body" class="modal-body" style="padding:0;"></div>
    </div>
  </div>

  <!-- Global Search Modal (Strg+K) -->
  <div id="global-search-modal-overlay" class="modal-backdrop">
    <div class="modal-shell" style="max-width:700px;max-height:78vh;">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;background:var(--bg-header);flex-shrink:0;">
        <input type="text" id="gsearch-input" placeholder="Skript, DNIS/Rufnummer, Queue, Ansage, CDN oder Uhrzeit suchen..." style="flex:1;background:var(--bg-card);border:1px solid var(--border-strong);color:var(--text-main);padding:8px 11px;border-radius:6px;font-size:13px;font-family:inherit;outline:none;" />
        <span id="gsearch-count" style="font-size:11px;color:var(--text-muted);font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums;white-space:nowrap;">0 Treffer</span>
        <button type="button" id="btn-close-gsearch" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;padding:4px 8px;" title="Schließen (Esc)">✕</button>
      </div>
      <div id="gsearch-cats" style="padding:8px 16px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;gap:6px;background:var(--bg-input);flex-shrink:0;"></div>
      <div id="gsearch-results" class="modal-body" style="padding:0;"></div>
      <div class="modal-footer" style="padding:8px 16px;font-size:11px;color:var(--text-muted);">
        <span>↑ ↓ Navigieren · Enter Öffnen · Esc Schließen</span>
        <span style="font-family:ui-monospace,monospace;">Strg+K</span>
      </div>
    </div>
  </div>

  <script>
    const PAYLOAD = `);
  pushPayloadJsonParts(htmlParts);
  htmlParts.push(`;
    const viewsByKey = new Map(PAYLOAD.views.map(v => [v.key, v]));
    let isDarkSurface = PAYLOAD.initialSurface !== 'light';
    let activePlatformMode = 'avaya';
    let activeGenesysProfile = PAYLOAD.initialGenesysProfile || 'strict-dataAction';
    let lastStrictHolidayProfile = activeGenesysProfile !== 'placeholder' ? activeGenesysProfile : 'strict-dataAction';
    let activeGenesysPreviewTab = 'genesys';
    let showGenesysHintsAndCleanup = false;
    let activeViewKey = PAYLOAD.initialViewKey;

    const hydratedGenesysVariantCache = new WeakMap();
    const masterGenesysAggCache = new Map();

    function resolveGenesysText(textKey, directVal) {
      if (typeof directVal === 'string' && directVal.length > 0) return directVal;
      if (textKey && PAYLOAD.genesysTextPool && typeof PAYLOAD.genesysTextPool[textKey] === 'string') {
        return PAYLOAD.genesysTextPool[textKey];
      }
      return '';
    }

    function resolveRawGenesysVariantForProfile(viewObj, profileKey) {
      if (!viewObj) return null;
      if (viewObj.genesysVariantRefs && PAYLOAD.genesysVariantPool) {
        const refKey = viewObj.genesysVariantRefs[profileKey] || viewObj.genesysVariantRefs[Object.keys(viewObj.genesysVariantRefs)[0]];
        if (refKey && PAYLOAD.genesysVariantPool[refKey]) {
          return PAYLOAD.genesysVariantPool[refKey];
        }
      }
      if (viewObj.genesysVariants) {
        if (viewObj.genesysVariants[profileKey]) {
          return viewObj.genesysVariants[profileKey];
        }
        const keys = Object.keys(viewObj.genesysVariants);
        if (keys.length > 0) return viewObj.genesysVariants[keys[0]];
      }
      if (viewObj.genesysSvg) {
        return {
          readiness: viewObj.genesysReadiness,
          readinessReasons: viewObj.genesysReadinessReasons || [],
          warnings: viewObj.genesysWarnings || [],
          archyYaml: viewObj.genesysArchyYaml || '',
          archyFilename: viewObj.genesysArchyFilename || '',
          yamlValidation: viewObj.genesysYamlValidation || null,
        };
      }
      return null;
    }

    function hydrateGenesysVariant(rawVar) {
      if (!rawVar || typeof rawVar !== 'object') return null;
      if (hydratedGenesysVariantCache.has(rawVar)) {
        return hydratedGenesysVariantCache.get(rawVar);
      }
      const hydrated = Object.assign({}, rawVar);
      hydrated.archyYaml = resolveGenesysText(rawVar.archyYamlKey, rawVar.archyYaml);
      hydrated.flowIrJson = resolveGenesysText(rawVar.flowIrKey, rawVar.flowIrJson);
      if (rawVar.avayaReport) {
        hydrated.avayaReport = Object.assign({}, rawVar.avayaReport, {
          renderedCode: resolveGenesysText(rawVar.avayaReport.renderedCodeKey, rawVar.avayaReport.renderedCode),
        });
      }
      hydratedGenesysVariantCache.set(rawVar, hydrated);
      return hydrated;
    }

    function getActiveGenesysVariant(viewObj) {
      if (!viewObj) return null;
      const rawVar = resolveRawGenesysVariantForProfile(viewObj, activeGenesysProfile);
      if (!rawVar) return null;
      if (isMasterViewKey(viewObj.key) && rawVar.primaryViewKey) {
        const cacheKey = activeGenesysProfile + '::' + (rawVar.svgKey || '');
        if (masterGenesysAggCache.has(cacheKey)) {
          return masterGenesysAggCache.get(cacheKey);
        }
        const primaryView = viewsByKey.get(rawVar.primaryViewKey);
        const primaryHydrated = primaryView
          ? hydrateGenesysVariant(resolveRawGenesysVariantForProfile(primaryView, activeGenesysProfile))
          : null;
        const aggWarnings = [];
        const aggYamlErrors = [];
        const aggYamlWarnings = [];
        const aggIrFindings = [];
        const aggHolidayByLower = new Map();
        let validScriptCount = 0;
        let totalScriptCount = 0;
        for (let i = 0; i < PAYLOAD.views.length; i++) {
          const sv = PAYLOAD.views[i];
          if (!sv || !sv.scriptNumber) continue;
          const sRaw = resolveRawGenesysVariantForProfile(sv, activeGenesysProfile);
          if (!sRaw) continue;
          totalScriptCount += 1;
          const sFileLabel = sRaw.archyFilename || sv.scriptNumber;
          if (Array.isArray(sRaw.warnings)) {
            for (let w = 0; w < sRaw.warnings.length; w++) {
              const wn = sRaw.warnings[w];
              aggWarnings.push({
                code: wn.code,
                severity: wn.severity,
                message: sFileLabel + ': ' + (wn.message || ''),
                lineNumber: wn.lineNumber,
              });
            }
          }
          if (sRaw.yamlValidation) {
            if (sRaw.yamlValidation.isValid) validScriptCount += 1;
            if (Array.isArray(sRaw.yamlValidation.errors)) {
              for (let e = 0; e < sRaw.yamlValidation.errors.length; e++) {
                aggYamlErrors.push(sRaw.yamlValidation.errors[e]);
              }
            }
            if (Array.isArray(sRaw.yamlValidation.warnings)) {
              for (let w = 0; w < sRaw.yamlValidation.warnings.length; w++) {
                aggYamlWarnings.push(sRaw.yamlValidation.warnings[w]);
              }
            }
          } else {
            validScriptCount += 1;
          }
          if (Array.isArray(sRaw.irFindings)) {
            for (let f = 0; f < sRaw.irFindings.length; f++) {
              const fn = sRaw.irFindings[f];
              aggIrFindings.push(fn.fileName ? fn : Object.assign({ fileName: sFileLabel }, fn));
            }
          }
          if (Array.isArray(sRaw.holidayMappings)) {
            for (let h = 0; h < sRaw.holidayMappings.length; h++) {
              const hm = sRaw.holidayMappings[h];
              if (!hm || !hm.variableName) continue;
              const lk = hm.variableName.toLowerCase();
              if (!aggHolidayByLower.has(lk) || hm.lookupTarget) {
                aggHolidayByLower.set(lk, hm);
              }
            }
          }
        }
        const agg = {
          svgKey: rawVar.svgKey,
          readiness: rawVar.readiness,
          readinessReasons: rawVar.readinessReasons || [],
          warnings: aggWarnings,
          archyYaml: primaryHydrated ? primaryHydrated.archyYaml : '',
          archyFilename: primaryHydrated ? primaryHydrated.archyFilename : '',
          yamlValidation: {
            isValid: aggYamlErrors.length === 0,
            errorCount: aggYamlErrors.length,
            warningCount: aggYamlWarnings.length,
            validScriptCount: validScriptCount,
            totalScriptCount: totalScriptCount,
            errors: aggYamlErrors,
            warnings: aggYamlWarnings,
          },
          flowIR: primaryHydrated ? primaryHydrated.flowIR : undefined,
          flowIrJson: primaryHydrated ? primaryHydrated.flowIrJson : '',
          flowIRFilename: primaryHydrated ? primaryHydrated.flowIRFilename : undefined,
          irFindings: aggIrFindings,
          avayaReport: primaryHydrated ? primaryHydrated.avayaReport : undefined,
          genesysReport: primaryHydrated ? primaryHydrated.genesysReport : undefined,
          holidayMappings: Array.from(aggHolidayByLower.values()).sort(function (a, b) {
            return (a.variableName || '').localeCompare(b.variableName || '');
          }),
        };
        masterGenesysAggCache.set(cacheKey, agg);
        return agg;
      }
      return hydrateGenesysVariant(rawVar);
    }

    function getViewCacheKey(viewKey) {
      return activePlatformMode === 'genesys' ? ('genesys::' + activeGenesysProfile + '::' + viewKey) : viewKey;
    }
    function getViewActiveGraph(viewObj) {
      if (!viewObj) return { nodes: [], edges: [] };
      if (activePlatformMode === 'genesys') {
        const variant = getActiveGenesysVariant(viewObj);
        if (variant && variant.svgKey && PAYLOAD.genesysSvgPool && PAYLOAD.genesysSvgPool[variant.svgKey] && PAYLOAD.genesysSvgPool[variant.svgKey].graph) {
          return PAYLOAD.genesysSvgPool[variant.svgKey].graph;
        }
        if (viewObj.genesysGraph) return viewObj.genesysGraph;
      }
      return viewObj.graph || { nodes: [], edges: [] };
    }
    function getViewActiveSvg(viewObj) {
      if (!viewObj) return '';
      if (activePlatformMode === 'genesys') {
        const variant = getActiveGenesysVariant(viewObj);
        if (variant && variant.svgKey && PAYLOAD.genesysSvgPool && PAYLOAD.genesysSvgPool[variant.svgKey] && PAYLOAD.genesysSvgPool[variant.svgKey].svg) {
          return PAYLOAD.genesysSvgPool[variant.svgKey].svg;
        }
        if (viewObj.genesysSvg) return viewObj.genesysSvg;
      }
      return viewObj.svg || '';
    }
    let GRAPH = getViewActiveGraph(viewsByKey.get(activeViewKey));
    let nodeMap = new Map((GRAPH.nodes || []).map(n => [n.id, n]));

    const scriptDropdownWrap = document.getElementById('script-dropdown-wrap');
    const scriptDropdownBtn = document.getElementById('script-dropdown-btn');
    const scriptDropdownLabel = document.getElementById('script-dropdown-label');
    const scriptDropdownPopover = document.getElementById('script-dropdown-popover');
    const scriptDropdownSearch = document.getElementById('script-dropdown-search');
    const scriptDropdownItems = document.getElementById('script-dropdown-items');
    const masterBackBtn = document.getElementById('btn-master-back');
    const welcomeHomeBtn = document.getElementById('btn-welcome-home');
    const masterDensityGroup = document.getElementById('master-density-group');
    const selectEl = document.getElementById('node-select');
    const searchEl = document.getElementById('node-search');
    const dimSelectEl = document.getElementById('dim-select');
    const autoFocusEl = document.getElementById('chk-autofocus');
    const isolateBtn = document.getElementById('btn-isolate');
    const isolateChk = document.getElementById('chk-isolate');
    const themeBtn = document.getElementById('btn-theme');
    const zoomReadoutEl = document.getElementById('zoom-readout');
    const stage = document.getElementById('svg-stage');
    const stageFrame = document.getElementById('svg-stage-frame');
    const svgLayer = document.getElementById('svg-layer');
    const gpuProxyImg = document.getElementById('gpu-proxy-layer');
    const welcomeOverlay = document.getElementById('welcome-overlay');
    const wrap = document.getElementById('canvas-wrap');

    let masterDensity = PAYLOAD.initialMasterDensity || 'compact';
    let activeAsideTab = 'path';
    let activeAnalysisSubtab = 'issues';
    let anIssueFilter = 'all';
    let anIssueSearch = '';
    let anSchedFilter = 'all';
    let anSchedSearch = '';
    let anInvCategory = 'skillsets';
    let anInvSearch = '';
    let anMatrixSearch = '';
    let anAuditTab = 'broken';
    let anAuditSearch = '';
    let anAuditShowMermaid = false;

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

    const normalizedSvgCache = new Map(); // viewKey -> SVGElement
    const viewThemeSigCache = new Map(); // viewKey -> string ("dark|semantic")
    const viewNodeBoxCache = new Map(); // viewKey -> { vbX, vbY, vbW, vbH, boxes: Array<{id, minX, maxX, minY, maxY}> }
    const gpuProxyCache = new Map(); // (viewKey + '|' + themeSig) -> { url, width, height }
    const gpuProxyPending = new Set();

    function isMasterViewKey(vk) {
      return vk === 'master' || vk === 'master:detailed';
    }

    function getActiveMasterViewKey() {
      if (masterDensity === 'detailed' && viewsByKey.has('master:detailed')) return 'master:detailed';
      if (viewsByKey.has('master')) return 'master';
      if (viewsByKey.has('master:detailed')) return 'master:detailed';
      return PAYLOAD.defaultTargetViewKey || (PAYLOAD.views[0] && PAYLOAD.views[0].key) || 'current';
    }

    function getCurrentThemeSig() {
      return (isDarkSurface ? 'dark' : 'light') + '|' + pathColorMode;
    }

    function esc(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    function escapeHtml(s) {
      return esc(s);
    }

    function escapeCsvCell(val) {
      const str = String(val == null ? '' : val).replace(/\\r?\\n/g, ' ');
      if (/[;,"\\t]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }

    const SCHEDULE_CSV_HEADERS = [
      'Skript-Nr.',
      'Skript-Name',
      'Prio',
      'Schritt / Regel',
      'Wochentage',
      'Uhrzeiten',
      'Öffnungszeiten (Gesamt)',
      'SondZeit / Zeitplan-Ref',
      'Feiertag / Sonderzeit',
      'Aktion / Überlauf / Ziel',
      'Status',
    ];

    function buildScheduleCsvRow(r) {
      const cleanHours = String(r.openingHours || '').replace(/(\\d{1,2})\\s*:\\s*(\\d{2})(?::\\d{2})?/g, '$1:$2').replace(/\\s+/g, ' ').trim();
      const is247 = !r.hasSchedule && /24\\/7|keine\\s+zeitbeschr/i.test(cleanHours);
      let weekdays = r.weekdays || '';
      let clockTimes = r.clockTimes || '';
      let source = r.scheduleSource || '';
      if (!clockTimes) {
        if (is247) {
          weekdays = weekdays || 'Mo–So (24/7)';
          clockTimes = '00:00–24:00 (24/7)';
          source = source || '24/7 (Keine Zeitbegrenzung)';
        } else if (r.hasSchedule) {
          const pm = cleanHours.match(/^(.*?)\\s*\\(([A-Za-z0-9_.-]+)\\)$/);
          const core = pm ? pm[1].trim() : cleanHours;
          if (!source) source = pm ? pm[2] : 'Direkt im Skript';
          const times = core.match(/\\b\\d{1,2}:\\d{2}\\s*[–-]\\s*\\d{1,2}:\\d{2}\\b/g);
          clockTimes = times && times.length ? times.join(', ') : (/\\b24\\/7\\b/i.test(core) ? '00:00–24:00 (24/7)' : '—');
          if (!weekdays) {
            const dm = core.match(/\\b(?:Mo|Di|Mi|Do|Fr|Sa|So)(?:[–-](?:Mo|Di|Mi|Do|Fr|Sa|So))?\\b/gi);
            weekdays = dm && dm.length ? Array.from(new Set(dm)).join(', ') : (clockTimes !== '—' ? 'Täglich / Alle Tage' : '—');
          }
        } else {
          weekdays = weekdays || '—';
          clockTimes = '—';
          source = source || '—';
        }
      }
      return [
        r.scriptNumber,
        r.scriptName,
        r.prio ?? '—',
        r.stepName,
        weekdays || '—',
        clockTimes || '—',
        cleanHours || '—',
        source || '—',
        r.holidayAndSpecial || '—',
        r.closedOrOverflowAction || '—',
        r.hasSchedule && r.hasHoliday
          ? 'Öffnungszeiten + Feiertag'
          : r.hasSchedule
          ? 'Öffnungszeiten hinterlegt'
          : r.hasHoliday
          ? 'Feiertag / Sonderzeit'
          : 'Ohne Zeitangabe (24/7)',
      ];
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

${getEmbeddedOpeningHoursExportRuntimeJs()}
${getEmbeddedInventoryAndGenesysZipRuntimeJs()}

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
      if (activeViewKey === 'welcome') {
        renderWelcomeOverlay();
        return;
      }
      const activeSvg = svgLayer.querySelector('svg');
      if (activeSvg) {
        if (activePlatformMode !== 'genesys') {
          applySvgSurfaceTheme(activeSvg, GRAPH, true);
        }
        viewThemeSigCache.set(getViewCacheKey(activeViewKey), getCurrentThemeSig());
        ensureGpuProxyForView(activeViewKey, activeSvg);
        if (minimapOpen) renderMinimapSvg(true);
      }
      applyCombinedCanvasState(false);
    }

    let diagramLegendOpen = false;
    const DIAGRAM_LEGEND_NODE_TYPES = [
      { id: 'start-actor', label: 'Einstieg & Akteure', desc: 'Hier kommen Anrufe über gewählte Rufnummern zuerst an.', color: '#38bdf8' },
      { id: 'core-service', label: 'Teil-Abläufe & Skripte', desc: 'Eigenständige Bausteine für Fachbereiche oder Themen.', color: '#818cf8' },
      { id: 'decision', label: 'Zeit- & Regelweichen', desc: 'Prüfen Öffnungszeiten, Feiertage oder Bedingungen.', color: '#fbbf24' },
      { id: 'announcement', label: 'Sprachansagen & Musik', desc: 'Spielen Begrüßungen, Hinweise oder Wartemusik ab.', color: '#14b8a6' },
      { id: 'queue', label: 'Warteschlangen / Teams', desc: 'Verbinden Anrufer mit der zuständigen Mitarbeiter-Gruppe.', color: '#a78bfa' },
      { id: 'storage', label: 'Datenbank & Externe Ziele', desc: 'IT-Abfragen (HDX/DB) oder Weiterleitung nach außen.', color: '#34d399' },
      { id: 'error-alert', label: 'Offene Punkte & Warnungen', desc: 'Fehlende Zielskripte, Außer-Betrieb oder Abbruch.', color: '#fb7185' },
    ];

    function classifyLegendNodeFallback(n) {
      const lbl = String((n && n.label) || '').toLowerCase();
      if (/fehler|nicht gefunden|fehlt|error|abbruch|disconnect|warnung|außer betrieb/.test(lbl)) return 'error-alert';
      if (/ansage|ran|music|musik|prompt|begrüß/.test(lbl)) return 'announcement';
      if (/queue|skill|warteschlange|team|agent/.test(lbl)) return 'queue';
      if (/hdx|datenbank|db|extern|abwurf|transfer|outpulse/.test(lbl)) return 'storage';
      if (/zeit|feiertag|sondzeit|öffnungs|if |bedingung|taste|dtmf|weiche|menü/.test(lbl)) return 'decision';
      if (n && n.role === 'entry') return 'start-actor';
      return 'core-service';
    }

    function renderDiagramLegendPopover() {
      const pop = document.getElementById('diagram-legend-popover');
      const body = document.getElementById('diagram-legend-body');
      const btn = document.getElementById('btn-diagram-legend');
      if (btn) btn.classList.toggle('btn-active', diagramLegendOpen);
      if (!pop || !body) return;
      pop.classList.toggle('open', diagramLegendOpen);
      if (!diagramLegendOpen) return;

      const typeCounts = {};
      const liveSvgNodes = svgLayer ? Array.from(svgLayer.querySelectorAll('g.node')) : [];
      if (liveSvgNodes.length > 0) {
        liveSvgNodes.forEach(g => {
          const nt = g.getAttribute('data-node-type') || 'core-service';
          typeCounts[nt] = (typeCounts[nt] || 0) + 1;
        });
      } else if (GRAPH && Array.isArray(GRAPH.nodes) && GRAPH.nodes.length > 0) {
        GRAPH.nodes.forEach(n => {
          const t = classifyLegendNodeFallback(n);
          typeCounts[t] = (typeCounts[t] || 0) + 1;
        });
      }

      let html = '<div><div class="dleg-section-title">Bauteil-Farben (Was bedeutet was?)</div><div class="dleg-list">' +
        DIAGRAM_LEGEND_NODE_TYPES.map(item => {
          const cnt = typeCounts[item.id] || 0;
          return '<div class="dleg-row">' +
            '<span class="dleg-swatch" style="background:' + item.color + ';"></span>' +
            '<div class="dleg-row-text"><div class="dleg-row-name">' + esc(item.label) + '</div><div class="dleg-row-desc">' + esc(item.desc) + '</div></div>' +
            (cnt > 0 ? '<span class="dleg-count">' + cnt + '</span>' : '') +
          '</div>';
        }).join('') +
      '</div></div>';

      if (currentEdgeLegend && currentEdgeLegend.length > 0) {
        html += '<div style="padding-top:8px;border-top:1px solid var(--border);"><div class="dleg-section-title">Verbindungs-Linien (' + (pathColorMode === 'branches' ? 'Modus B: Verzweigung' : 'Modus A: Semantik') + ')</div><div class="dleg-list">' +
          currentEdgeLegend.map(it =>
            '<div class="dleg-row">' +
              '<span class="dleg-line-swatch" style="border-top-color:' + it.color + ';border-top-style:' + (it.dashed ? 'dashed' : 'solid') + ';"></span>' +
              '<div class="dleg-row-text"><div class="dleg-row-name">' + esc(it.label) + '</div></div>' +
              (it.count !== undefined ? '<span class="dleg-count">' + it.count + '</span>' : '') +
            '</div>'
          ).join('') +
        '</div></div>';
      } else {
        html += '<div style="padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted);line-height:1.45;">Öffnen Sie eine Diagramm-Ansicht, um zusätzlich die exakten Knoten-Zähler und Linienfarben der aktuellen Ebene zu sehen.</div>';
      }

      body.innerHTML = html;
    }

    function setDiagramLegendOpen(nextOpen) {
      diagramLegendOpen = Boolean(nextOpen);
      renderDiagramLegendPopover();
    }

    function renderLegendBar(spotlightItems) {
      const bar = document.getElementById('legend-bar');
      if (!bar) return;
      if (activeViewKey === 'welcome' && !spotlightItems) {
        bar.innerHTML = '<strong style="color:var(--accent-text);">Schnellstart:</strong><span class="leg-item">Ansicht über Startkarte oder Skript-Menü wählen — Grafik wird erst bei Bedarf gerendert.</span>';
        if (diagramLegendOpen) renderDiagramLegendPopover();
        return;
      }
      const items = spotlightItems || currentEdgeLegend;
      const prefix = spotlightItems
        ? '<strong style="color:var(--amber-text);">Aktiver Pfad:</strong>'
        : '<strong style="color:var(--accent-text);">Pfade (' + (pathColorMode === 'branches' ? 'Modus B: Verzweigung' : 'Modus A: Semantik') + '):</strong>';
      bar.innerHTML = prefix + items.map(it =>
        '<span class="leg-item"><span class="leg-line" style="border-top-color:' + it.color + ';border-top-style:' + (it.dashed ? 'dashed' : 'solid') + ';"></span><span>' + esc(it.label) + '</span>' + (it.count !== undefined ? '<span class="leg-count">(' + it.count + ')</span>' : '') + '</span>'
      ).join('');
      if (diagramLegendOpen) renderDiagramLegendPopover();
    }

    function syncMasterDensityUi() {
      if (!masterDensityGroup) return;
      const showToggle = Boolean(PAYLOAD.hasBothMasterVariants) && isMasterViewKey(activeViewKey);
      masterDensityGroup.style.display = showToggle ? 'inline-flex' : 'none';
      if (showToggle) {
        masterDensityGroup.querySelectorAll('.seg-btn').forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-density') === masterDensity);
        });
      }
    }

    let welcomeScriptFilterQuery = '';
    function renderWelcomeOverlay() {
      if (!welcomeOverlay) return;
      if (activeViewKey !== 'welcome') {
        welcomeOverlay.classList.remove('open');
        return;
      }
      welcomeOverlay.classList.add('open');

      const summary = PAYLOAD.welcomeSummary || { title: 'Callflow', viewCount: 0, scriptCount: 0, hasMultiViews: false };
      const rawViews = PAYLOAD.views || [];
      const scriptViews = rawViews.filter(v => Boolean(v.scriptNumber));
      const masterTargetKey = (PAYLOAD.defaultTargetViewKey && isMasterViewKey(PAYLOAD.defaultTargetViewKey))
        ? getActiveMasterViewKey()
        : (viewsByKey.has('master') || viewsByKey.has('master:detailed'))
        ? getActiveMasterViewKey()
        : (PAYLOAD.defaultTargetViewKey || (rawViews[0] && rawViews[0].key) || '');
      const hasMainBtn = Boolean(PAYLOAD.mainViewKey && viewsByKey.has(PAYLOAD.mainViewKey));
      const hasSchedBtn = Boolean(PAYLOAD.analysis && Array.isArray(PAYLOAD.analysis.scheduleRows) && PAYLOAD.analysis.scheduleRows.length > 0);
      const hasInvBtn = Boolean(PAYLOAD.analysis && PAYLOAD.analysis.inventoryBundle);

      const subtitleText = summary.scriptCount > 0
        ? summary.scriptCount + ' Skripte geladen · Das Hauptscript wird für maximale Geschwindigkeit erst bei Klick geladen.'
        : 'Callflow geladen · Das Diagramm wird erst bei Bedarf gerendert.';

      const primaryLabel = summary.hasMultiViews
        ? 'Hauptscript (Master-Karte) laden'
        : 'Diagramm jetzt laden';

      let html =
        '<div class="welcome-card">' +
          '<div>' +
            '<div class="welcome-eyebrow">Schnellstart · Leere Willkommensseite</div>' +
            '<h2 class="welcome-title">' + esc(summary.title || 'Callflow') + '</h2>' +
            '<p class="welcome-sub">' + esc(subtitleText) + '</p>' +
          '</div>' +
          '<div class="welcome-actions">' +
            '<button type="button" class="primary welcome-btn-main-primary" id="welcome-btn-master">' + esc(primaryLabel) + '</button>' +
            (hasMainBtn ? '<button type="button" class="amber" id="welcome-btn-main">Main öffnen</button>' : '') +
          '</div>';

      if (scriptViews.length > 0) {
        html +=
          '<div class="welcome-picker">' +
            '<span class="welcome-picker-label">Oder direkt einzelnes Skript ohne Master-Render öffnen:</span>' +
            '<input type="text" id="welcome-script-search" placeholder="Skript auswählen (Nr., Name)..." value="' + esc(welcomeScriptFilterQuery) + '" />' +
            '<div class="welcome-script-list" id="welcome-script-list"></div>' +
          '</div>';
      }

      html +=
        '<div class="welcome-footer">' +
          '<button type="button" id="welcome-btn-search">Suche (Strg+K)</button>' +
          (hasSchedBtn ? '<button type="button" id="welcome-btn-sched" class="amber">Öffnungszeiten</button>' : '') +
          (hasInvBtn ? '<button type="button" id="welcome-btn-inv" style="border-color:var(--ok-border);background:var(--ok-bg);color:var(--ok-text);font-weight:600;">Asset-Inventar</button>' : '') +
        '</div>' +
      '</div>';

      welcomeOverlay.innerHTML = html;

      const btnMaster = document.getElementById('welcome-btn-master');
      if (btnMaster && masterTargetKey) {
        btnMaster.addEventListener('click', () => switchView(masterTargetKey));
      }
      const btnMain = document.getElementById('welcome-btn-main');
      if (btnMain && PAYLOAD.mainViewKey) {
        btnMain.addEventListener('click', () => switchView(PAYLOAD.mainViewKey));
      }
      const btnSearch = document.getElementById('welcome-btn-search');
      if (btnSearch) {
        btnSearch.addEventListener('click', () => openGlobalSearchModal());
      }
      const btnSched = document.getElementById('welcome-btn-sched');
      if (btnSched) {
        btnSched.addEventListener('click', () => openSchedulesModal(''));
      }
      const btnInv = document.getElementById('welcome-btn-inv');
      if (btnInv) {
        btnInv.addEventListener('click', () => openInventoryModal());
      }

      const listEl = document.getElementById('welcome-script-list');
      const searchInp = document.getElementById('welcome-script-search');
      const fillScriptList = (q) => {
        if (!listEl) return;
        const needle = (q || '').trim().toLowerCase();
        const matches = needle
          ? scriptViews.filter(v => (v.label || '').toLowerCase().includes(needle) || String(v.scriptNumber || '').toLowerCase().includes(needle))
          : scriptViews;
        listEl.innerHTML = '';
        if (matches.length === 0) {
          const emptyDiv = document.createElement('div');
          emptyDiv.style.cssText = 'padding:10px;text-align:center;font-size:11px;color:var(--text-muted);';
          emptyDiv.textContent = 'Kein passendes Skript gefunden.';
          listEl.appendChild(emptyDiv);
          return;
        }
        matches.forEach(v => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'welcome-script-item';
          btn.textContent = v.label.replace(/^Ebene 2:\\s*/i, '');
          btn.addEventListener('click', () => switchView(v.key));
          listEl.appendChild(btn);
        });
      };
      fillScriptList(welcomeScriptFilterQuery);
      if (searchInp) {
        searchInp.addEventListener('input', () => {
          welcomeScriptFilterQuery = searchInp.value || '';
          fillScriptList(welcomeScriptFilterQuery);
        });
      }
    }

    function populateViewSelect(filterQuery) {
      if (!scriptDropdownItems) return;
      const q = (filterQuery !== undefined ? filterQuery : (scriptDropdownSearch ? scriptDropdownSearch.value : '')).trim().toLowerCase();
      scriptDropdownItems.innerHTML = '';

      if (!q || 'startseite'.includes(q) || 'willkommen'.includes(q) || 'leer'.includes(q) || 'home'.includes(q)) {
        const homeEl = document.createElement('div');
        homeEl.className = 'script-dropdown-item' + (activeViewKey === 'welcome' ? ' selected' : '');
        homeEl.textContent = 'Startseite (Leere Willkommensseite)';
        homeEl.addEventListener('click', () => {
          switchView('welcome');
          if (scriptDropdownPopover) scriptDropdownPopover.style.display = 'none';
        });
        scriptDropdownItems.appendChild(homeEl);
      }

      // Show a single Master entry (mapping to active masterDensity) plus all Detail scripts
      const rawViews = PAYLOAD.views || [];
      const views = rawViews.filter(v => v.key !== 'master:detailed' || !viewsByKey.has('master'));
      const filtered = q
        ? views.filter(v => {
            if (isMasterViewKey(v.key)) {
              return 'master'.includes(q) || 'gesamt'.includes(q) || 'karte'.includes(q) || 'ebene 1'.includes(q) || 'einstieg'.includes(q) || 'alle'.includes(q);
            }
            const labelLower = (v.label || '').toLowerCase();
            const keyLower = (v.key || '').toLowerCase();
            return labelLower.includes(q) || keyLower.includes(q);
          })
        : views;

      const activeView = viewsByKey.get(activeViewKey);
      if (scriptDropdownLabel) {
        let btnLabelText = 'Startseite · Ansicht wählen';
        if (activeViewKey !== 'welcome' && activeView) {
          btnLabelText = isMasterViewKey(activeView.key)
            ? activeView.label.replace(/\\s*\\((?:Kompakt|Voll-Detail)\\)$/i, '')
            : activeView.label;
        }
        scriptDropdownLabel.textContent = btnLabelText;
        if (scriptDropdownBtn) scriptDropdownBtn.title = btnLabelText + ' — Skript oder Ebene wählen';
      }

      if (filtered.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.style.cssText = 'padding:12px;text-align:center;color:var(--text-muted);font-size:12px;';
        emptyEl.textContent = 'Kein Skript gefunden für „' + q + '“';
        scriptDropdownItems.appendChild(emptyEl);
      } else {
        filtered.forEach(v => {
          const isMasterItem = isMasterViewKey(v.key);
          const isSelected = isMasterItem ? isMasterViewKey(activeViewKey) : v.key === activeViewKey;
          const labelText = isMasterItem
            ? v.label.replace(/\\s*\\((?:Kompakt|Voll-Detail)\\)$/i, '')
            : v.label;
          const itemEl = document.createElement('div');
          itemEl.className = 'script-dropdown-item' + (isSelected ? ' selected' : '');
          itemEl.textContent = labelText;
          itemEl.title = labelText;
          itemEl.addEventListener('click', () => {
            switchView(isMasterItem ? getActiveMasterViewKey() : v.key);
            if (scriptDropdownPopover) scriptDropdownPopover.style.display = 'none';
          });
          scriptDropdownItems.appendChild(itemEl);
        });
      }

      if (masterBackBtn) {
        masterBackBtn.style.display = (PAYLOAD.views.length > 1 && activeViewKey !== 'welcome' && !isMasterViewKey(activeViewKey)) ? 'inline-block' : 'none';
      }
      if (welcomeHomeBtn) {
        welcomeHomeBtn.style.display = activeViewKey !== 'welcome' ? 'inline-block' : 'none';
      }
      syncMasterDensityUi();
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
      const gObj = getViewActiveGraph(viewObj);
      const scopedKey = getViewCacheKey(viewObj.key);
      const vb = (svgEl.getAttribute('viewBox') || '').trim().split(/[\\s,]+/).map(Number);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        const w = Math.ceil(vb[2]);
        const h = Math.ceil(vb[3]);
        svgEl.setAttribute('width', String(w));
        svgEl.setAttribute('height', String(h));
        svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svgEl.style.width = w + 'px';
        svgEl.style.height = h + 'px';
        svgEl.style.maxWidth = 'none';
        svgEl.style.maxHeight = 'none';
      }
      stampMissingNodeMetadata(svgEl, gObj);
      const targetThemeSig = (isDarkSurface ? 'dark' : 'light') + '|' + pathColorMode;
      if (activePlatformMode !== 'genesys') {
        if (isDarkSurface !== (PAYLOAD.initialSurface !== 'light')) {
          applySvgSurfaceTheme(svgEl, gObj, syncUi);
        } else {
          recolorExportEdges(svgEl, gObj, syncUi);
        }
      }
      viewThemeSigCache.set(scopedKey, targetThemeSig);

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

      normalizedSvgCache.set(scopedKey, svgEl);
      extractNodeBoxesForView(scopedKey, svgEl, gObj);
      ensureGpuProxyForView(viewObj.key, svgEl);
      if (syncUi) renderNodeTypeFilters();
      return svgEl;
    }

    function extractNodeBoxesForView(viewKey, svgEl, gObj) {
      if (!svgEl || !gObj) return;
      const vbParts = (svgEl.getAttribute('viewBox') || '').trim().split(/[\\s,]+/).map(Number);
      const wAttr = parseFloat(svgEl.getAttribute('width') || '1200');
      const hAttr = parseFloat(svgEl.getAttribute('height') || '800');
      const vbX = vbParts.length === 4 && isFinite(vbParts[0]) ? vbParts[0] : 0;
      const vbY = vbParts.length === 4 && isFinite(vbParts[1]) ? vbParts[1] : 0;
      const vbW = vbParts.length === 4 && vbParts[2] > 0 ? vbParts[2] : wAttr;
      const vbH = vbParts.length === 4 && vbParts[3] > 0 ? vbParts[3] : hAttr;
      const boxes = [];

      svgEl.querySelectorAll('g.node, g.actor, g.statediagram-state').forEach(g => {
        const nid = resolveNodeId(g, gObj);
        if (!nid) return;
        let tx = 0, ty = 0;
        let cur = g;
        while (cur && cur !== svgEl) {
          const tr = cur.getAttribute ? (cur.getAttribute('transform') || '') : '';
          const m = tr.match(/translate\\(\\s*([+-]?\\d+(?:\\.\\d+)?)(?:[\\s,]+([+-]?\\d+(?:\\.\\d+)?))?\\s*\\)/i);
          if (m) {
            tx += parseFloat(m[1] || '0') || 0;
            ty += parseFloat(m[2] || '0') || 0;
          }
          cur = cur.parentNode;
        }
        let minX = -60, maxX = 60, minY = -24, maxY = 24;
        const rect = g.querySelector('rect');
        const poly = g.querySelector('polygon');
        const circ = g.querySelector('circle');
        if (rect) {
          const rx = parseFloat(rect.getAttribute('x') || '0');
          const ry = parseFloat(rect.getAttribute('y') || '0');
          const rw = parseFloat(rect.getAttribute('width') || '0');
          const rh = parseFloat(rect.getAttribute('height') || '0');
          if (rw > 4 && rh > 4) { minX = rx; maxX = rx + rw; minY = ry; maxY = ry + rh; }
        } else if (poly) {
          const nums = (poly.getAttribute('points') || '').match(/[+-]?\\d+(?:\\.\\d+)?/g);
          if (nums && nums.length >= 6) {
            let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
            for (let i = 0; i + 1 < nums.length; i += 2) {
              const px = parseFloat(nums[i]); const py = parseFloat(nums[i + 1]);
              if (px < pMinX) pMinX = px; if (px > pMaxX) pMaxX = px;
              if (py < pMinY) pMinY = py; if (py > pMaxY) pMaxY = py;
            }
            if (isFinite(pMinX) && pMaxX - pMinX > 4) { minX = pMinX; maxX = pMaxX; minY = pMinY; maxY = pMaxY; }
          }
        } else if (circ) {
          const cx = parseFloat(circ.getAttribute('cx') || '0');
          const cy = parseFloat(circ.getAttribute('cy') || '0');
          const r = parseFloat(circ.getAttribute('r') || '0');
          if (r > 4) { minX = cx - r; maxX = cx + r; minY = cy - r; maxY = cy + r; }
        }
        boxes.push({ id: nid, minX: tx + minX, maxX: tx + maxX, minY: ty + minY, maxY: ty + maxY });
      });

      viewNodeBoxCache.set(viewKey, { vbX, vbY, vbW, vbH, boxes });
    }

    function hitTestNodeAtClientPoint(clientX, clientY) {
      const idx = viewNodeBoxCache.get(getViewCacheKey(activeViewKey));
      if (!idx || !stageFrame) return null;
      const rect = stageFrame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      const svgX = idx.vbX + ((clientX - rect.left) / rect.width) * idx.vbW;
      const svgY = idx.vbY + ((clientY - rect.top) / rect.height) * idx.vbH;
      const pad = 6;
      for (let i = idx.boxes.length - 1; i >= 0; i--) {
        const b = idx.boxes[i];
        if (svgX >= b.minX - pad && svgX <= b.maxX + pad && svgY >= b.minY - pad && svgY <= b.maxY + pad) {
          return b.id;
        }
      }
      return null;
    }

    function isLargeViewSvg(svgEl, gObj) {
      if (!svgEl || !gObj) return false;
      if (gObj.nodes.length >= 28 || gObj.edges.length >= 48) return true;
      const w = parseFloat(svgEl.getAttribute('width') || '0');
      const h = parseFloat(svgEl.getAttribute('height') || '0');
      return Math.max(w, h) > 2200 || w * h > 2200000;
    }

    function applyProxyImgElement(entry) {
      if (!gpuProxyImg) return;
      if (!entry) {
        gpuProxyImg.removeAttribute('src');
        delete wrap.dataset.gpuProxy;
        return;
      }
      gpuProxyImg.src = entry.url;
      gpuProxyImg.width = entry.width;
      gpuProxyImg.height = entry.height;
      gpuProxyImg.style.width = entry.width + 'px';
      gpuProxyImg.style.height = entry.height + 'px';
    }

    function syncGpuProxyState(forceGesture) {
      const activeViewObj = viewsByKey.get(activeViewKey);
      const activeSvgEl = svgLayer ? svgLayer.querySelector('svg') : null;
      const activeG = getViewActiveGraph(activeViewObj);
      if (!activeViewObj || !activeSvgEl || !isLargeViewSvg(activeSvgEl, activeG)) {
        delete wrap.dataset.gpuProxy;
        return;
      }
      const cacheKey = getViewCacheKey(activeViewKey) + '|' + getCurrentThemeSig();
      const entry = gpuProxyCache.get(cacheKey);
      if (!entry) {
        delete wrap.dataset.gpuProxy;
        return;
      }
      if (gpuProxyImg && gpuProxyImg.src !== entry.url) {
        applyProxyImgElement(entry);
      }
      // Use raster GPU proxy strictly during active pan/zoom gestures so resting views stay razor-sharp Vector SVG
      const isGesture = Boolean(forceGesture || wrap.dataset.transforming === 'true');
      if (isGesture) {
        wrap.dataset.gpuProxy = 'true';
      } else {
        delete wrap.dataset.gpuProxy;
      }
    }

    function ensureGpuProxyForView(viewKey, svgEl, forceForMinimap) {
      const viewObj = viewsByKey.get(viewKey);
      if (!svgEl || !viewObj) return;
      const viewGraph = getViewActiveGraph(viewObj);
      const scopedViewKey = getViewCacheKey(viewKey);
      if (!forceForMinimap && !isLargeViewSvg(svgEl, viewGraph) && !minimapOpen) {
        if (viewKey === activeViewKey) applyProxyImgElement(null);
        return;
      }
      const cacheKey = scopedViewKey + '|' + getCurrentThemeSig();
      const existing = gpuProxyCache.get(cacheKey);
      if (existing) {
        if (viewKey === activeViewKey) {
          if (isLargeViewSvg(svgEl, viewGraph)) {
            applyProxyImgElement(existing);
            syncGpuProxyState(false);
          } else {
            applyProxyImgElement(null);
          }
        }
        return;
      }
      if (gpuProxyPending.has(cacheKey)) return;
      gpuProxyPending.add(cacheKey);

      const w = Math.max(1, Math.ceil(parseFloat(svgEl.getAttribute('width') || '1200')));
      const h = Math.max(1, Math.ceil(parseFloat(svgEl.getAttribute('height') || '800')));
      const maxDim = 4096;
      const scale = Math.min(1.5, maxDim / Math.max(w, h));
      const pw = Math.max(1, Math.round(w * scale));
      const ph = Math.max(1, Math.round(h * scale));

      try {
        const clone = svgEl.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', String(w));
        clone.setAttribute('height', String(h));
        const xml = new XMLSerializer().serializeToString(clone);
        const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(svgUrl);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = pw;
            canvas.height = ph;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, pw, ph);
              canvas.toBlob(blob => {
                gpuProxyPending.delete(cacheKey);
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const entry = { url, width: w, height: h };
                gpuProxyCache.set(cacheKey, entry);
                if (viewKey === activeViewKey && cacheKey === getViewCacheKey(activeViewKey) + '|' + getCurrentThemeSig()) {
                  if (isLargeViewSvg(svgEl, viewGraph)) {
                    applyProxyImgElement(entry);
                    syncGpuProxyState(false);
                  }
                }
              }, 'image/png');
              return;
            }
          } catch {
            // fallback to vector mode if browser taints foreignObject canvas
          }
          gpuProxyPending.delete(cacheKey);
        };
        img.onerror = () => {
          URL.revokeObjectURL(svgUrl);
          gpuProxyPending.delete(cacheKey);
        };
        img.src = svgUrl;
      } catch {
        gpuProxyPending.delete(cacheKey);
      }
    }

    const genesysSubbar = document.getElementById('genesys-subbar');
    const genesysFlowLabel = document.getElementById('genesys-flow-label');
    const genesysReadinessBadge = document.getElementById('genesys-readiness-badge');
    const btnGenesysYamlStatus = document.getElementById('btn-genesys-yaml-status');
    const genesysReadinessReasons = document.getElementById('genesys-readiness-reasons');
    const btnGenesysWarnings = document.getElementById('btn-genesys-warnings');
    const genesysModeGroup = document.getElementById('genesys-mode-group');
    const genesysHolidayControls = document.getElementById('genesys-holiday-controls');
    const btnGenesysHolidayToggle = document.getElementById('btn-genesys-holiday-toggle');
    const genesysHolidayTargetGroup = document.getElementById('genesys-holiday-target-group');
    const btnGenesysHolidayMappings = document.getElementById('btn-genesys-holiday-mappings');
    const btnGenesysYamlToggle = document.getElementById('btn-genesys-yaml-toggle');
    const btnGenesysYamlDownload = document.getElementById('btn-genesys-yaml-download');
    const btnGenesysFlowIrDownload = document.getElementById('btn-genesys-flowir-download');
    const btnGenesysZipDownload = document.getElementById('btn-genesys-zip-download');
    const genesysHolidayDrawer = document.getElementById('genesys-holiday-drawer');
    const genesysValidationDrawer = document.getElementById('genesys-validation-drawer');
    const genesysWarningsDrawer = document.getElementById('genesys-warnings-drawer');
    const genesysYamlDrawer = document.getElementById('genesys-yaml-drawer');
    const genesysPreviewModeGroup = document.getElementById('genesys-preview-mode-group');
    const genesysYamlFilename = document.getElementById('genesys-yaml-filename');
    const genesysModeBanner = document.getElementById('genesys-mode-banner');
    const genesysModeReport = document.getElementById('genesys-mode-report');
    const genesysYamlCode = document.getElementById('genesys-yaml-code');
    const btnGenesysYamlCopy = document.getElementById('btn-genesys-yaml-copy');

    const GENESYS_FINDING_CAT_ORDER = [
      'provenance', 'expression_review', 'holiday_logic', 'terminality',
      'subflow', 'wait_hint', 'reference', 'scope', 'reachability', 'cleanup'
    ];
    const GENESYS_FINDING_CAT_LABELS = {
      provenance: 'Provenance',
      expression_review: 'Expression Review',
      holiday_logic: 'Holiday Logic',
      terminality: 'Terminality',
      subflow: 'Unloaded Subflows',
      wait_hint: 'WAIT & Source Hints',
      reference: 'References',
      scope: 'Scope',
      reachability: 'Reachability',
      cleanup: 'Cleanup / Info',
    };
    const GENESYS_WARN_CLASS_LABELS = {
      actionable_migration: 'Actionable',
      semantic_review: 'Semantic Review',
      source_hint: 'Source Hint',
      source_only_hint: 'Source Hint',
      informational_cleanup: 'Cleanup',
    };

    function getActiveGenesysProfileSummary() {
      if (!PAYLOAD.genesysProfiles) return null;
      return PAYLOAD.genesysProfiles[activeGenesysProfile] || null;
    }

    function buildGenesysModeBannerHtml() {
      if (activeGenesysProfile === 'placeholder') {
        return '<div class="genesys-banner amber"><strong>Platzhalter-Modus (Opt-In):</strong> Für offene Abhängigkeiten (z.&nbsp;B. externe Feiertags-DB oder ungeladene Subskripte) werden synthetische Kompatibilitäts-Platzhalter erzeugt. Vor produktivem Import im Zielsystem verifizieren.</div>';
      }
      if (activeGenesysProfile === 'strict-review') {
        return '<div class="genesys-banner ok"><strong>Quelltreu (Strikt) · Strict Holiday Review:</strong> Keine synthetischen Platzhalter. Alle externen Feiertags-DB-Variablen und offenen Abhängigkeiten werden transparent als Prüf-Befunde markiert.</div>';
      }
      const targetName = activeGenesysProfile === 'strict-dataTable' ? 'Data Table' : 'Data Action';
      return '<div class="genesys-banner cyan"><strong>Quelltreu (Strikt) · Holiday DB: Guarded Standard (' + targetName + '):</strong> Erkannte Feiertags-DB-Variablen werden deterministisch auf eine Genesys ' + targetName + ' gemappt; alle übrigen offenen Stellen bleiben strikt quelltreu.</div>';
    }

    function renderGenesysFindingGroupsHtml(findings, isMasterContext) {
      if (!findings || !findings.length) return '';
      const byCat = new Map();
      findings.forEach(function (f) {
        const c = f.category || 'cleanup';
        if (!byCat.has(c)) byCat.set(c, []);
        byCat.get(c).push(f);
      });
      const orderedCats = GENESYS_FINDING_CAT_ORDER.filter(function (c) { return byCat.has(c); });
      byCat.forEach(function (_, k) { if (orderedCats.indexOf(k) < 0) orderedCats.push(k); });
      return orderedCats.map(function (cat) {
        const list = byCat.get(cat) || [];
        const label = GENESYS_FINDING_CAT_LABELS[cat] || cat;
        const rowsHtml = list.map(function (f) {
          const sevColor = f.severity === 'error' ? 'var(--err-text)' : f.severity === 'warning' ? 'var(--warn-text)' : 'var(--text-muted)';
          const wLabel = GENESYS_WARN_CLASS_LABELS[f.warningClass] || f.warningClass || '';
          const scriptTag = (f.fileName || f.scriptNumber)
            ? '<span style="font-family:ui-monospace,monospace;font-size:10.5px;color:var(--accent-text);margin-right:6px;">' + escapeHtml(f.fileName || f.scriptNumber) + '</span>'
            : '';
          const jumpBtn = (isMasterContext && f.scriptNumber && PAYLOAD.viewKeyByScriptNumber && PAYLOAD.viewKeyByScriptNumber[f.scriptNumber])
            ? '<button type="button" class="btn-genesys-jump" data-jump-script="' + escapeHtml(f.scriptNumber) + '" style="padding:2px 7px;font-size:10.5px;flex-shrink:0;">Flow öffnen →</button>'
            : '';
          return '<div class="genesys-finding-row">'
            + '<div style="min-width:0;flex:1;">'
              + '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:2px;">'
                + scriptTag
                + '<strong style="color:' + sevColor + ';font-family:ui-monospace,monospace;font-size:10.5px;">[' + escapeHtml(f.code || 'IR') + ']</strong>'
                + (wLabel ? '<span class="an-tag">' + escapeHtml(wLabel) + '</span>' : '')
              + '</div>'
              + '<div>' + escapeHtml(f.message || '') + '</div>'
              + (f.suggestion ? '<div style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">Empfehlung: ' + escapeHtml(f.suggestion) + '</div>' : '')
            + '</div>'
            + jumpBtn
          + '</div>';
        }).join('');
        return '<div class="genesys-finding-group">'
          + '<div class="genesys-finding-group-head"><span>' + escapeHtml(label) + '</span><span class="an-tag">' + list.length + '</span></div>'
          + rowsHtml
        + '</div>';
      }).join('');
    }

    function renderGenesysSubbar() {
      if (!genesysSubbar) return;
      const viewObj = viewsByKey.get(activeViewKey);
      const variant = getActiveGenesysVariant(viewObj);
      const activeSvgStr = getViewActiveSvg(viewObj);
      if (activePlatformMode !== 'genesys' || activeViewKey === 'welcome' || !viewObj || !variant || !activeSvgStr) {
        genesysSubbar.classList.remove('open');
        if (genesysHolidayDrawer) genesysHolidayDrawer.classList.remove('open');
        if (genesysValidationDrawer) genesysValidationDrawer.classList.remove('open');
        if (genesysWarningsDrawer) genesysWarningsDrawer.classList.remove('open');
        if (genesysYamlDrawer) genesysYamlDrawer.classList.remove('open');
        return;
      }
      genesysSubbar.classList.add('open');

      const isStrict = activeGenesysProfile !== 'placeholder';
      const isHolidayEnabled = activeGenesysProfile === 'strict-dataAction' || activeGenesysProfile === 'strict-dataTable';
      const holidayTarget = activeGenesysProfile === 'strict-dataTable' ? 'dataTable' : 'dataAction';
      const hasMultiProfiles = Boolean(
        (viewObj.genesysVariantRefs && Object.keys(viewObj.genesysVariantRefs).length > 1) ||
        (viewObj.genesysVariants && Object.keys(viewObj.genesysVariants).length > 1)
      );
      const isMasterCtx = isMasterViewKey(activeViewKey);

      if (genesysFlowLabel) {
        genesysFlowLabel.textContent = 'Genesys Cloud: ' + (viewObj.label || 'Flow');
      }
      const rLevel = variant.readiness || viewObj.genesysReadiness || 'LOW';
      if (genesysReadinessBadge) {
        genesysReadinessBadge.textContent = 'Readiness: ' + rLevel;
        genesysReadinessBadge.className = 'genesys-pill ' + (rLevel === 'HIGH' ? 'genesys-badge-high' : rLevel === 'MEDIUM' ? 'genesys-badge-medium' : 'genesys-badge-low');
      }

      // Mode Toggle (Quelltreu (Strikt) vs. Platzhalter-Modus)
      if (genesysModeGroup) {
        genesysModeGroup.style.display = hasMultiProfiles ? 'inline-flex' : 'none';
        genesysModeGroup.querySelectorAll('.seg-btn').forEach(function (b) {
          const gm = b.getAttribute('data-gmode');
          b.classList.remove('strict-active', 'placeholder-active', 'active');
          if (gm === 'strict' && isStrict) b.classList.add('strict-active');
          if (gm === 'placeholder' && !isStrict) b.classList.add('placeholder-active');
        });
      }

      // Holiday-DB Controls (only active in Quelltreu (Strikt))
      const holidayMappings = variant.holidayMappings || [];
      if (genesysHolidayControls) {
        genesysHolidayControls.style.display = (hasMultiProfiles && isStrict) ? 'inline-flex' : 'none';
      }
      if (btnGenesysHolidayToggle) {
        btnGenesysHolidayToggle.classList.toggle('strict-review', !isHolidayEnabled);
        btnGenesysHolidayToggle.textContent = isHolidayEnabled
          ? 'Holiday DB: Guarded Standard'
          : 'Strict Holiday Review';
      }
      if (genesysHolidayTargetGroup) {
        genesysHolidayTargetGroup.style.display = isHolidayEnabled ? 'inline-flex' : 'none';
        genesysHolidayTargetGroup.querySelectorAll('.seg-btn').forEach(function (b) {
          b.classList.toggle('cyan-active', b.getAttribute('data-htarget') === holidayTarget);
        });
      }
      if (btnGenesysHolidayMappings) {
        const showMapBtn = hasMultiProfiles && isStrict && holidayMappings.length > 0;
        btnGenesysHolidayMappings.style.display = showMapBtn ? 'inline-flex' : 'none';
        btnGenesysHolidayMappings.textContent = 'Holiday Mappings (' + holidayMappings.length + ')';
        if (!showMapBtn && genesysHolidayDrawer) genesysHolidayDrawer.classList.remove('open');
      }
      if (genesysHolidayDrawer) {
        if (!isStrict || !holidayMappings.length) {
          genesysHolidayDrawer.innerHTML = '';
        } else {
          genesysHolidayDrawer.innerHTML =
            '<div style="font-size:11.5px;font-weight:600;color:var(--text-main);margin-bottom:6px;">Erkannte Feiertags-DB-Variablen (' + holidayMappings.length + ') · Aktiver Zielmodus: ' + (isHolidayEnabled ? (holidayTarget === 'dataTable' ? 'Data Table' : 'Data Action') : 'Strict Holiday Review (kein Mapping)') + '</div>'
            + '<table class="inv-table"><thead><tr><th>Avaya-Variable</th><th>Genesys Ziel-Typ</th><th>Action / Data Table</th><th>Boolean-Variable</th><th>Ersetzter Subflow</th></tr></thead><tbody>'
            + holidayMappings.map(function (m) {
                const tLabel = m.lookupTarget === 'dataTable' ? 'Data Table' : m.lookupTarget === 'dataAction' ? 'Data Action' : 'Offen (Review)';
                return '<tr>'
                  + '<td style="font-family:ui-monospace,monospace;font-weight:600;">' + escapeHtml(m.variableName || '') + '</td>'
                  + '<td><span class="inv-status-pill ' + (m.lookupTarget ? 'inv-status-active' : 'inv-status-warn') + '">' + escapeHtml(tLabel) + '</span></td>'
                  + '<td style="font-family:ui-monospace,monospace;">' + escapeHtml(m.lookupActionOrTable || '—') + '</td>'
                  + '<td style="font-family:ui-monospace,monospace;">' + escapeHtml(m.booleanVarName || '—') + '</td>'
                  + '<td style="font-family:ui-monospace,monospace;">' + escapeHtml(m.replacedSubflow || '—') + '</td>'
                + '</tr>';
              }).join('')
            + '</tbody></table>';
        }
      }

      // YAML Validation + flowIR v1.1 Findings Drawer
      const yamlVal = variant.yamlValidation || viewObj.genesysYamlValidation || null;
      const irFindings = variant.irFindings || [];
      const openReviewFindings = irFindings.filter(function (f) {
        return f.warningClass === 'actionable_migration' || f.warningClass === 'semantic_review';
      });
      const hintsFindings = irFindings.filter(function (f) {
        return f.warningClass !== 'actionable_migration' && f.warningClass !== 'semantic_review';
      });

      if (btnGenesysYamlStatus) {
        if (yamlVal || irFindings.length > 0) {
          btnGenesysYamlStatus.style.display = 'inline-flex';
          const isOk = !yamlVal || (Boolean(yamlVal.isValid) && (yamlVal.errorCount || 0) === 0);
          btnGenesysYamlStatus.className = isOk ? 'genesys-yaml-valid' : 'genesys-yaml-invalid';
          const parts = [];
          if (yamlVal) {
            if (isOk) {
              if (yamlVal.totalScriptCount && yamlVal.totalScriptCount > 1) {
                parts.push('YAML valide (' + (yamlVal.validScriptCount || 0) + '/' + yamlVal.totalScriptCount + ')');
              } else {
                parts.push('YAML valide');
              }
            } else {
              parts.push((yamlVal.errorCount || 0) + ' YAML-Fehler');
            }
          }
          if (openReviewFindings.length > 0) {
            parts.push(openReviewFindings.length + ' Review');
          }
          if (hintsFindings.length > 0) {
            parts.push(hintsFindings.length + ' Hinweise');
          }
          btnGenesysYamlStatus.textContent = parts.join(' · ');
        } else {
          btnGenesysYamlStatus.style.display = 'none';
          if (genesysValidationDrawer) genesysValidationDrawer.classList.remove('open');
        }
      }

      if (genesysValidationDrawer) {
        if (!yamlVal && irFindings.length === 0) {
          genesysValidationDrawer.innerHTML = '';
        } else {
          const valErrors = (yamlVal && yamlVal.errors) || [];
          const valWarns = (yamlVal && yamlVal.warnings) || [];
          let html = buildGenesysModeBannerHtml();
          if (valErrors.length === 0 && valWarns.length === 0) {
            html += '<div style="font-size:11.5px;padding:4px 0 6px;color:var(--ok-text);font-weight:600;">Archy-YAML Vollprüfung bestanden: Schema-Keys, Einrückung, RefIds &amp; Variablen sind valide.</div>';
          } else {
            html += valErrors.map(function (e) {
              const prefix = (e.fileName ? escapeHtml(e.fileName) + ' · ' : '') + 'Zeile ' + (e.lineNumber || 1) + ' [' + escapeHtml(e.code || 'ERROR') + ']';
              const sugg = e.suggestion ? '<div style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">Empfehlung: ' + escapeHtml(e.suggestion) + '</div>' : '';
              return '<div style="font-size:11.5px;padding:5px 0;border-bottom:1px solid var(--border);color:var(--text-main);"><strong style="color:var(--err-text);margin-right:6px;">' + prefix + '</strong>' + escapeHtml(e.message || '') + sugg + '</div>';
            }).join('');
            html += valWarns.map(function (w) {
              const prefix = (w.fileName ? escapeHtml(w.fileName) + ' · ' : '') + 'Zeile ' + (w.lineNumber || 1) + ' [' + escapeHtml(w.code || 'HINWEIS') + ']';
              const sugg = w.suggestion ? '<div style="font-size:10.5px;color:var(--text-muted);margin-top:2px;">Hinweis: ' + escapeHtml(w.suggestion) + '</div>' : '';
              return '<div style="font-size:11.5px;padding:5px 0;border-bottom:1px solid var(--border);color:var(--text-main);"><strong style="color:var(--warn-text);margin-right:6px;">' + prefix + '</strong>' + escapeHtml(w.message || '') + sugg + '</div>';
            }).join('');
          }

          if (openReviewFindings.length > 0) {
            html += '<div style="margin-top:8px;font-size:11px;font-weight:700;color:var(--warn-text);text-transform:uppercase;letter-spacing:0.04em;">Open Review Signals (flowIR v1.1 · ' + openReviewFindings.length + ')</div>';
            html += renderGenesysFindingGroupsHtml(openReviewFindings, isMasterCtx);
          } else if (irFindings.length > 0) {
            html += '<div style="margin-top:6px;font-size:11px;color:var(--ok-text);font-weight:600;">Keine offenen Review-Signale (Actionable / Semantic Review = 0).</div>';
          }

          if (hintsFindings.length > 0) {
            html += '<div style="margin-top:8px;">'
              + '<button type="button" id="btn-toggle-genesys-hints" style="padding:3px 9px;font-size:11px;font-weight:600;">'
                + (showGenesysHintsAndCleanup ? '▾ ' : '▸ ') + 'Hints / Cleanup (' + hintsFindings.length + ')'
              + '</button>'
              + (showGenesysHintsAndCleanup ? renderGenesysFindingGroupsHtml(hintsFindings, isMasterCtx) : '')
            + '</div>';
          }

          genesysValidationDrawer.innerHTML = html;
          const btnHints = genesysValidationDrawer.querySelector('#btn-toggle-genesys-hints');
          if (btnHints) {
            btnHints.addEventListener('click', function () {
              showGenesysHintsAndCleanup = !showGenesysHintsAndCleanup;
              renderGenesysSubbar();
            });
          }
          genesysValidationDrawer.querySelectorAll('.btn-genesys-jump').forEach(function (jb) {
            jb.addEventListener('click', function () {
              const sc = jb.getAttribute('data-jump-script');
              if (sc && PAYLOAD.viewKeyByScriptNumber && PAYLOAD.viewKeyByScriptNumber[sc]) {
                switchView(PAYLOAD.viewKeyByScriptNumber[sc]);
              }
            });
          });
        }
      }

      if (genesysReadinessReasons) {
        genesysReadinessReasons.textContent = (variant.readinessReasons || viewObj.genesysReadinessReasons || []).join(' · ');
      }
      const warns = variant.warnings || viewObj.genesysWarnings || [];
      if (btnGenesysWarnings) {
        if (warns.length > 0) {
          btnGenesysWarnings.style.display = 'inline-flex';
          btnGenesysWarnings.textContent = warns.length + (warns.length === 1 ? ' Warnung' : ' Warnungen');
        } else {
          btnGenesysWarnings.style.display = 'none';
          if (genesysWarningsDrawer) genesysWarningsDrawer.classList.remove('open');
        }
      }
      if (genesysWarningsDrawer) {
        genesysWarningsDrawer.innerHTML = warns.map(function (w) {
          return '<div style="font-size:11.5px;padding:4px 0;border-bottom:1px solid var(--border);color:var(--text-main);">'
            + '<strong style="color:var(--warn-text);margin-right:6px;">[' + escapeHtml(w.code || 'HINWEIS') + ']</strong>'
            + escapeHtml(w.message || '')
            + '</div>';
        }).join('');
      }

      // Dual-Mode Preview (Genesys Archy YAML <-> Avaya Mapping flowIR v1.1) & Downloads
      const yamlText = variant.archyYaml || viewObj.genesysArchyYaml || '';
      const yamlFile = variant.archyFilename || viewObj.genesysArchyFilename || 'flow.yaml';
      const hasYaml = Boolean(yamlText);
      const hasAvayaReport = Boolean(variant.avayaReport && variant.avayaReport.renderedCode);
      const hasFlowIr = Boolean(variant.flowIrJson || variant.flowIR);
      const profileSum = getActiveGenesysProfileSummary();
      const hasZip = Boolean(profileSum && Array.isArray(profileSum.scripts) && profileSum.scripts.length > 0);

      if (!hasAvayaReport && activeGenesysPreviewTab === 'avaya') {
        activeGenesysPreviewTab = 'genesys';
      }
      if (btnGenesysYamlToggle) btnGenesysYamlToggle.style.display = (hasYaml || hasAvayaReport) ? 'inline-flex' : 'none';
      if (btnGenesysYamlDownload) {
        btnGenesysYamlDownload.style.display = hasYaml ? 'inline-flex' : 'none';
        btnGenesysYamlDownload.textContent = yamlFile;
      }
      if (btnGenesysFlowIrDownload) {
        btnGenesysFlowIrDownload.style.display = hasFlowIr ? 'inline-flex' : 'none';
      }
      if (btnGenesysZipDownload) {
        btnGenesysZipDownload.style.display = hasZip ? 'inline-flex' : 'none';
        if (hasZip) {
          btnGenesysZipDownload.textContent = 'Alle YAML (' + profileSum.scripts.length + ') .zip';
        }
      }

      if (genesysPreviewModeGroup) {
        genesysPreviewModeGroup.style.display = hasAvayaReport ? 'inline-flex' : 'none';
        genesysPreviewModeGroup.querySelectorAll('.seg-btn').forEach(function (b) {
          const pm = b.getAttribute('data-pmode');
          b.classList.remove('active', 'genesys-active');
          if (pm === activeGenesysPreviewTab) {
            b.classList.add(pm === 'genesys' ? 'genesys-active' : 'active');
          }
        });
      }

      const activeReport = activeGenesysPreviewTab === 'avaya' ? variant.avayaReport : variant.genesysReport;
      if (genesysYamlFilename) {
        genesysYamlFilename.textContent = activeGenesysPreviewTab === 'avaya'
          ? (variant.flowIRFilename || yamlFile.replace(/\\.yaml$/i, '.flowir.txt'))
          : yamlFile;
      }
      if (genesysModeBanner) {
        genesysModeBanner.innerHTML = buildGenesysModeBannerHtml();
      }
      if (genesysModeReport) {
        if (activeReport && (activeReport.summary.length || activeReport.assumptionsAndOpenPoints.length || activeReport.migrationHints.length)) {
          genesysModeReport.style.display = 'grid';
          const renderList = function (arr) {
            if (!arr || !arr.length) return '<div style="color:var(--text-muted);">Keine offenen Einträge.</div>';
            return '<ul>' + arr.map(function (it) { return '<li>' + escapeHtml(it) + '</li>'; }).join('') + '</ul>';
          };
          genesysModeReport.innerHTML =
            '<div class="genesys-summary-col"><h4>1. Kurzfazit</h4>' + renderList(activeReport.summary) + '</div>'
            + '<div class="genesys-summary-col"><h4>2. Annahmen / offene Punkte</h4>' + renderList(activeReport.assumptionsAndOpenPoints) + '</div>'
            + '<div class="genesys-summary-col"><h4>3. Wichtigste Migrationshinweise</h4>' + renderList(activeReport.migrationHints) + '</div>';
        } else {
          genesysModeReport.style.display = 'none';
          genesysModeReport.innerHTML = '';
        }
      }
      if (genesysYamlCode) {
        genesysYamlCode.textContent = activeGenesysPreviewTab === 'avaya'
          ? ((variant.avayaReport && variant.avayaReport.renderedCode) || '')
          : yamlText;
      }
      if (!hasYaml && !hasAvayaReport && genesysYamlDrawer) genesysYamlDrawer.classList.remove('open');
    }

    function setGenesysProfile(nextProfile) {
      if (!nextProfile || activeGenesysProfile === nextProfile) return;
      if (nextProfile !== 'placeholder') {
        lastStrictHolidayProfile = nextProfile;
      }
      activeGenesysProfile = nextProfile;
      if (activePlatformMode === 'genesys' && activeViewKey !== 'welcome') {
        switchView(activeViewKey);
      } else {
        renderGenesysSubbar();
      }
    }

    function setPlatformMode(nextMode) {
      const normalized = nextMode === 'genesys' && PAYLOAD.hasGenesysViews ? 'genesys' : 'avaya';
      activePlatformMode = normalized;
      document.querySelectorAll('#platform-mode-group .seg-btn').forEach(function (b) {
        const isTarget = b.getAttribute('data-platform') === normalized;
        b.classList.remove('active', 'genesys-active');
        if (isTarget) {
          b.classList.add(normalized === 'genesys' ? 'genesys-active' : 'active');
        }
      });
      if (activeViewKey === 'welcome' && normalized === 'genesys') {
        const fallbackKey = PAYLOAD.defaultTargetViewKey || (PAYLOAD.views[0] && PAYLOAD.views[0].key) || 'master';
        switchView(fallbackKey);
        return;
      }
      if (activeViewKey !== 'welcome') {
        switchView(activeViewKey);
      } else {
        renderGenesysSubbar();
      }
    }

    function switchView(nextKey) {
      if (nextKey === 'welcome') {
        delete wrap.dataset.gpuProxy;
        applyProxyImgElement(null);
        activeViewKey = 'welcome';
        GRAPH = { nodes: [], edges: [] };
        nodeMap = new Map();
        activeNodeId = '';
        activeEdge = null;
        svgLayer.replaceChildren();
        zoom = 1;
        panX = 0;
        panY = 0;
        renderWelcomeOverlay();
        renderGenesysSubbar();
        populateViewSelect();
        populateSelect();
        renderNodeTypeFilters();
        applyCombinedCanvasState(false);
        if (minimapOpen) renderMinimapSvg(true);
        updateMinimapViewport();
        return;
      }

      const nextView = viewsByKey.get(nextKey);
      if (!nextView) return;
      if (nextKey === 'master') masterDensity = 'compact';
      else if (nextKey === 'master:detailed') masterDensity = 'detailed';

      if (welcomeOverlay) welcomeOverlay.classList.remove('open');
      delete wrap.dataset.gpuProxy;
      activeViewKey = nextKey;
      GRAPH = getViewActiveGraph(nextView);
      nodeMap = new Map(GRAPH.nodes.map(n => [n.id, n]));
      activeNodeId = '';
      activeEdge = null;

      const scopedKey = getViewCacheKey(nextKey);
      let cachedSvg = normalizedSvgCache.get(scopedKey);
      if (cachedSvg) {
        svgLayer.replaceChildren(cachedSvg);
        const curThemeSig = getCurrentThemeSig();
        if (activePlatformMode !== 'genesys') {
          if (viewThemeSigCache.get(scopedKey) !== curThemeSig) {
            applySvgSurfaceTheme(cachedSvg, GRAPH, true);
            viewThemeSigCache.set(scopedKey, curThemeSig);
          } else {
            recolorExportEdges(cachedSvg, GRAPH, true);
          }
        }
        ensureGpuProxyForView(nextKey, cachedSvg);
        renderNodeTypeFilters();
      } else {
        svgLayer.innerHTML = getViewActiveSvg(nextView);
        normalizeSvgElement(svgLayer.querySelector('svg'), nextView, true);
      }

      renderGenesysSubbar();
      populateViewSelect();
      populateSelect();
      applyCombinedCanvasState(false);
      fitToWindow();
      if (minimapOpen) renderMinimapSvg(true);
      if (diagramLegendOpen) renderDiagramLegendPopover();
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

    const canvasNodeInfoBtn = document.getElementById('canvas-node-info-btn');

    function syncCanvasNodeInfoButton() {
      if (!canvasNodeInfoBtn) return;
      if (!activeNodeId || activeViewKey === 'welcome' || !stageFrame || !wrap) {
        canvasNodeInfoBtn.style.display = 'none';
        return;
      }
      const idx = viewNodeBoxCache.get(getViewCacheKey(activeViewKey));
      if (!idx) {
        canvasNodeInfoBtn.style.display = 'none';
        return;
      }
      const box = idx.boxes.find(b => b.id === activeNodeId);
      if (!box) {
        canvasNodeInfoBtn.style.display = 'none';
        return;
      }
      const frameRect = stageFrame.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      if (frameRect.width <= 0 || frameRect.height <= 0 || wrapRect.width <= 0) {
        canvasNodeInfoBtn.style.display = 'none';
        return;
      }
      const relRight = (box.maxX - idx.vbX) / idx.vbW;
      const relTop = (box.minY - idx.vbY) / idx.vbH;
      const rawLeft = (frameRect.left - wrapRect.left) + relRight * frameRect.width + 6;
      const rawTop = (frameRect.top - wrapRect.top) + relTop * frameRect.height - 14;
      if (rawLeft < -40 || rawLeft > wrapRect.width + 40 || rawTop < -40 || rawTop > wrapRect.height + 40) {
        canvasNodeInfoBtn.style.display = 'none';
        return;
      }
      const clampedLeft = Math.max(8, Math.min(wrapRect.width - 78, rawLeft));
      const clampedTop = Math.max(8, Math.min(wrapRect.height - 42, rawTop));
      canvasNodeInfoBtn.style.display = 'inline-flex';
      canvasNodeInfoBtn.style.transform = 'translate3d(' + Math.round(clampedLeft) + 'px,' + Math.round(clampedTop) + 'px,0)';
    }

    if (canvasNodeInfoBtn) {
      canvasNodeInfoBtn.addEventListener('mousedown', e => e.stopPropagation());
      canvasNodeInfoBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (activeNodeId) openNodeInfoModal(activeNodeId);
      });
    }

    function applyTransformImmediate() {
      stage.style.transform = 'translate3d(' + panX + 'px,' + panY + 'px,0) scale(' + zoom + ')';
      updateMinimapViewport();
      syncCanvasNodeInfoButton();
    }

    function updateTransform(activeGesture) {
      if (activeGesture) {
        wrap.dataset.transforming = 'true';
        syncGpuProxyState(true);
        if (transformIdleTimer !== null) clearTimeout(transformIdleTimer);
        transformIdleTimer = setTimeout(() => {
          transformIdleTimer = null;
          delete wrap.dataset.transforming;
          syncGpuProxyState(false);
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
      syncGpuProxyState(false);
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
      // Reveal vector layer before measuring real SVG node bounds
      delete wrap.dataset.gpuProxy;
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
      let rightOcclusion = 0;
      const infoOverlay = document.getElementById('node-info-modal-overlay');
      if (infoOverlay && infoOverlay.style.display === 'flex' && window.innerWidth >= 1024) {
        const panelShell = infoOverlay.querySelector('.modal-shell');
        if (panelShell) {
          const panelRect = panelShell.getBoundingClientRect();
          if (panelRect.width > 0 && vpRect.right > panelRect.left) {
            rightOcclusion = Math.min(vpRect.width * 0.65, Math.max(0, vpRect.right - panelRect.left + 12));
          }
        }
      }
      zoom = nextZoom;
      panX = Math.round(-unscaledX * nextZoom - rightOcclusion / 2);
      panY = Math.round(-unscaledY * nextZoom);
      updateTransform(false);
    }

    wrap.addEventListener('wheel', e => {
      if (activeViewKey === 'welcome' || (e.target && e.target.closest && e.target.closest('#welcome-overlay'))) return;
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
      if (activeViewKey === 'welcome' || (e.target && e.target.closest && e.target.closest('#welcome-overlay'))) return;
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
      if (activeViewKey === 'welcome' || (e.target && e.target.closest && e.target.closest('#welcome-overlay'))) return;
      if (didDrag) return;
      const directNodeId = e.target && e.target.closest ? resolveNodeId(e.target) : null;
      if (directNodeId) return; // handled by SVG node listener
      const hitViaProxy = hitTestNodeAtClientPoint(e.clientX, e.clientY);
      if (hitViaProxy) {
        selectNode(hitViaProxy, false);
        return;
      }
      if (!e.target.closest('g.node, g.actor, g.statediagram-state, g.edgePaths > *, g.edgePath, path.flowchart-link, g.edgeLabels > *, g.edgeLabel')) {
        if (activeNodeId || activeEdge) {
          activeNodeId = '';
          activeEdge = null;
          selectEl.value = '';
          applyCombinedCanvasState(false);
        }
      }
    });
    wrap.addEventListener('dblclick', e => {
      if (activeViewKey === 'welcome' || (e.target && e.target.closest && e.target.closest('#welcome-overlay'))) return;
      const directNodeId = e.target && e.target.closest ? resolveNodeId(e.target) : null;
      const targetNodeId = directNodeId || hitTestNodeAtClientPoint(e.clientX, e.clientY);
      if (targetNodeId) {
        e.preventDefault();
        e.stopPropagation();
        openNodeInfoModal(targetNodeId);
        return;
      }
      zoom = 1;
      panX = 0;
      panY = 0;
      updateTransform(false);
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
      const existingParamWrap = drillSlot.querySelector('.param-card-slot');
      if (existingParamWrap) existingParamWrap.remove();
      const nObj = nodeMap.get(targetNodeId);
      if (!nObj) return;

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

      if (!paramsList || paramsList.length === 0) return;

      const categories = [
        { key: 'overflow', title: 'Überlauf & Schwellenwerte' },
        { key: 'routing', title: 'Routing & Zentralen' },
        { key: 'schedule', title: 'Öffnungszeiten & Status' },
        { key: 'media', title: 'Audio, Musik & Gründe' },
        { key: 'custom', title: 'Skript-Variablen' },
      ];

      let html = '<div class="card param-card" style="margin-top:8px;padding:10px 12px;">';
      html += '<div class="row-between" style="margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border);">';
      html += '<div style="font-size:12px;font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:6px;">';
      html += '<span>Sonderparameter</span>';
      html += '<span style="font-size:11px;font-weight:400;color:var(--text-muted);font-family:monospace;">[' + esc(scriptNum) + ']</span>';
      html += '</div>';
      html += '<span style="font-size:10px;color:var(--text-muted);font-variant-numeric:tabular-nums;">' + paramsList.length + ' Parameter</span>';
      html += '</div>';

      categories.forEach(cat => {
        const inCat = paramsList.filter(p => p.category === cat.key);
        if (!inCat.length) return;
        html += '<div style="margin-top:7px;margin-bottom:3px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);">' + esc(cat.title) + '</div>';
        html += '<div style="display:flex;flex-direction:column;gap:4px;">';
        inCat.forEach(p => {
          html += '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 6px;border-radius:4px;background:var(--bg-input);font-size:11px;gap:8px;">';
          html += '<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;">';
          html += '<span style="font-weight:500;color:var(--text-main);">' + esc(p.label) + '</span>';
          html += ' <span style="font-size:10px;color:var(--text-muted);font-family:monospace;">(' + esc(p.key) + ')</span>';
          html += '</div>';
          html += '<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;color:var(--accent-text);white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums;">';
          html += esc(p.value);
          html += '</div>';
          html += '</div>';
        });
        html += '</div>';
      });

      html += '</div>';
      const wrapper = document.createElement('div');
      wrapper.className = 'param-card-slot';
      wrapper.innerHTML = html;
      drillSlot.appendChild(wrapper);
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
      syncGpuProxyState(false);
    }

    function applyExportSelectedNodeHighlighter(svgEl, activeGroupEl) {
      if (!svgEl) return;
      svgEl.querySelectorAll('.cf-selected-highlighter-layer').forEach(el => el.remove());
      svgEl.querySelectorAll('[data-selected-node="true"]').forEach(el => el.removeAttribute('data-selected-node'));
      if (!activeGroupEl) return;
      activeGroupEl.setAttribute('data-selected-node', 'true');
      try {
        const bbox = activeGroupEl.getBBox();
        if (bbox && bbox.width > 0 && bbox.height > 0) {
          const svgNs = 'http://www.w3.org/2000/svg';
          const pad = 7;
          const layer = document.createElementNS(svgNs, 'g');
          layer.setAttribute('class', 'cf-selected-highlighter-layer');
          layer.setAttribute('pointer-events', 'none');

          const outerRect = document.createElementNS(svgNs, 'rect');
          outerRect.setAttribute('class', 'cf-selected-highlighter-outer');
          outerRect.setAttribute('x', String(bbox.x - pad - 2));
          outerRect.setAttribute('y', String(bbox.y - pad - 2));
          outerRect.setAttribute('width', String(bbox.width + (pad + 2) * 2));
          outerRect.setAttribute('height', String(bbox.height + (pad + 2) * 2));
          outerRect.setAttribute('rx', '12');
          outerRect.setAttribute('ry', '12');
          outerRect.setAttribute('fill', 'none');
          outerRect.setAttribute('stroke', isDarkSurface ? 'rgba(251, 191, 36, 0.38)' : 'rgba(217, 119, 6, 0.34)');
          outerRect.setAttribute('stroke-width', '7');

          const innerRect = document.createElementNS(svgNs, 'rect');
          innerRect.setAttribute('class', 'cf-selected-highlighter-rect');
          innerRect.setAttribute('x', String(bbox.x - pad));
          innerRect.setAttribute('y', String(bbox.y - pad));
          innerRect.setAttribute('width', String(bbox.width + pad * 2));
          innerRect.setAttribute('height', String(bbox.height + pad * 2));
          innerRect.setAttribute('rx', '10');
          innerRect.setAttribute('ry', '10');
          innerRect.setAttribute('fill', isDarkSurface ? 'rgba(251, 191, 36, 0.12)' : 'rgba(245, 158, 11, 0.14)');
          innerRect.setAttribute('stroke', isDarkSurface ? '#fbbf24' : '#d97706');
          innerRect.setAttribute('stroke-width', '3');

          layer.appendChild(outerRect);
          layer.appendChild(innerRect);
          activeGroupEl.insertBefore(layer, activeGroupEl.firstChild);
        }
      } catch {
        // CSS drop-shadow fallback remains active via data-selected-node
      }
    }

    function applyCombinedCanvasStateInner(shouldFocusCamera = false) {
      const allSvgNodes = Array.from(stage.querySelectorAll('g.node, g.actor, g.statediagram-state'));
      const allSvgEdges = Array.from(stage.querySelectorAll('g.edgePaths > *, g.edgePath, path.flowchart-link'));
      const allSvgLabels = Array.from(stage.querySelectorAll('g.edgeLabels > *, g.edgeLabel'));
      const drillSlot = document.getElementById('drilldown-slot');
      const cycleCard = document.getElementById('card-cycles');
      const cycleList = document.getElementById('list-cycles');
      const svgElRef = stage.querySelector('svg');

      applyExportSelectedNodeHighlighter(svgElRef, null);
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
          const restEdgeOp = edgeEl.getAttribute('data-resting-opacity') || '1';
          edgeEl.style.opacity = !hasSearchOrRole ? restEdgeOp : dimOpacity;
        });

        allSvgLabels.forEach((lblEl, idx) => {
          if (hiddenEdgeIdx.has(idx) && allSvgLabels.length === allSvgEdges.length) {
            lblEl.style.display = 'none';
            return;
          }
          if (!isEdgeAllowedByType(lblEl)) { lblEl.style.display = 'none'; return; }
          lblEl.style.display = '';
          const restLblOp = lblEl.getAttribute('data-resting-opacity') || '1';
          lblEl.style.opacity = !hasSearchOrRole ? restLblOp : dimOpacity;
        });

        updateClusterVisibility(visibleSvgNodes);
        renderLegendBar(null);

        document.getElementById('selected-info').innerHTML = activeViewKey === 'welcome'
          ? 'Willkommensseite aktiv — Hauptscript oder einzelnes Skript wählen, um den Callflow zu rendern.'
          : '<strong>' + visibleSvgNodes.length + ' von ' + GRAPH.nodes.length + ' Knoten</strong> und <strong>' + GRAPH.edges.length + ' Verbindungen</strong> im Diagramm.';
        drillSlot.innerHTML = '';
        cycleCard.style.display = 'none';
        const filterFn = n => (!q || n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) && allowedByType.has(n.id);
        renderList('list-entries', GRAPH.nodes.filter(n => n.inDegree === 0 && filterFn(n)).map(n => ({ ...n, badge: n.outDegree + ' Ausgänge' })));
        renderList('list-callers', []);
        renderList('list-callees', []);
        renderList('list-terminals', GRAPH.nodes.filter(n => n.outDegree === 0 && filterFn(n)).map(n => ({ ...n, badge: n.inDegree + ' Eingänge' })));
        syncCanvasNodeInfoButton();
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
      let activeSvgNodeEl = null;
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
          if (nid === activeNodeId) activeSvgNodeEl = g;
        }
      });
      if (activeSvgNodeEl) {
        applyExportSelectedNodeHighlighter(svgElRef, activeSvgNodeEl);
      }

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
      const actionsRow = document.createElement('div');
      actionsRow.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:6px;';
      const infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'primary';
      infoBtn.style.width = '100%';
      infoBtn.textContent = 'Knoten-Info öffnen (Laie / IT-Profi)';
      infoBtn.onclick = () => openNodeInfoModal(activeNodeId);
      actionsRow.appendChild(infoBtn);

      const drillTarget = PAYLOAD.drillTargetsByNodeId && PAYLOAD.drillTargetsByNodeId[activeNodeId];
      if (drillTarget && viewsByKey.has(drillTarget.viewKey) && drillTarget.viewKey !== activeViewKey) {
        const drillBtn = document.createElement('button');
        drillBtn.type = 'button';
        drillBtn.className = 'amber';
        drillBtn.style.width = '100%';
        drillBtn.textContent = 'Detail-Skript [' + drillTarget.scriptRef + '] öffnen →';
        drillBtn.onclick = () => switchView(drillTarget.viewKey);
        actionsRow.appendChild(drillBtn);
      }
      drillSlot.appendChild(actionsRow);

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
      syncCanvasNodeInfoButton();

      if (shouldFocusCamera && autoFocusEl.checked) {
        focusNodeCamera(activeNodeId);
      }
    }

    function jumpToScriptOrNode(scriptRef, preferredNodeTextOrId, forceFocusCamera = false) {
      let targetViewKey = activeViewKey === 'welcome' ? getActiveMasterViewKey() : activeViewKey;
      if (scriptRef && PAYLOAD.viewKeyByScriptNumber) {
        const vk = PAYLOAD.viewKeyByScriptNumber[scriptRef] || PAYLOAD.viewKeyByScriptNumber[String(scriptRef).toLowerCase()];
        if (vk && viewsByKey.has(vk)) targetViewKey = vk;
      }
      if (targetViewKey && targetViewKey !== activeViewKey) {
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
      if (!hitNode && GRAPH.nodes.length > 0) {
        hitNode = GRAPH.nodes.find(n => n.inDegree === 0) || GRAPH.nodes[0];
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
        selectNode(hitNode.id, !forceFocusCamera);
        if (forceFocusCamera) {
          requestAnimationFrame(() => focusNodeCamera(hitNode.id));
        }
        return hitNode.id;
      }
      return '';
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
        const ohBundle = an ? an.openingHoursBundle : null;
        const ctrl = document.createElement('div');
        ctrl.className = 'card';
        ctrl.innerHTML =
          '<div class="row-between" style="margin-bottom:7px;gap:5px;">' +
            '<input type="text" id="an-sched-search" placeholder="Skript, Zeit oder Feiertag suchen..." value="' + esc(anSchedSearch) + '" style="flex:1;" />' +
            '<button id="btn-xlsx-schedules" style="background:#059669;color:#fff;border-color:#059669;">Excel .xlsx</button>' +
            '<button id="btn-csv-schedules">CSV</button>' +
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
        ctrl.querySelector('#btn-xlsx-schedules').addEventListener('click', () => {
          if (ohBundle) {
            downloadOpeningHoursXlsxFromBundle(ohBundle, true, 'callflow-oeffnungszeiten.xlsx');
          }
        });
        ctrl.querySelector('#btn-csv-schedules').addEventListener('click', () => {
          if (ohBundle) {
            downloadUtf8Csv(
              'callflow-oeffnungszeiten.csv',
              OH_CSV_HEADERS,
              buildOpeningHoursCsvRowsFromBundle(ohBundle, true)
            );
          } else {
            downloadUtf8Csv(
              'callflow-oeffnungszeiten.csv',
              SCHEDULE_CSV_HEADERS,
              rows.map(buildScheduleCsvRow)
            );
          }
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
        const hasInvBundle = Boolean(an && an.inventoryBundle);
        ctrl.innerHTML =
          (hasInvBundle
            ? '<button type="button" id="btn-an-open-full-inventory" style="width:100%;justify-content:center;margin-bottom:8px;background:var(--ok-bg);border-color:var(--ok-border);color:var(--ok-text);font-weight:700;">Asset-Inventar &amp; Excel-Export öffnen (' + ((an.inventoryBundle.summary && an.inventoryBundle.summary.totalItems) || 0) + ' Assets)</button>'
            : '') +
          '<input type="text" id="an-inv-search" placeholder="Skillset, Ansage, Variable oder Skript suchen..." value="' + esc(anInvSearch) + '" style="width:100%;margin-bottom:7px;" />' +
          (reg
            ? '<div class="filter-chips" id="an-inv-chips">' +
                '<button class="chip' + (anInvCategory === 'skillsets' ? ' active' : '') + '" data-c="skillsets">Skillsets (' + reg.skillsets.length + ')</button>' +
                '<button class="chip' + (anInvCategory === 'announcements' ? ' active' : '') + '" data-c="announcements">Ansagen (' + reg.announcements.length + ')</button>' +
                '<button class="chip' + (anInvCategory === 'special' ? ' active' : '') + '" data-c="special">Sonderparameter (' + ((reg.specialParameters && reg.specialParameters.length) || 0) + ')</button>' +
                '<button class="chip' + (anInvCategory === 'variables' ? ' active' : '') + '" data-c="variables">Alle Variablen (' + reg.variables.length + ')</button>' +
                '<button class="chip' + (anInvCategory === 'externalApis' ? ' active' : '') + '" data-c="externalApis">FlixCheck / APIs (' + ((reg.externalApis && reg.externalApis.length) || 0) + ')</button>' +
                '<button class="chip' + (anInvCategory === 'crossRefs' ? ' active' : '') + '" data-c="crossRefs">Kreuzref. (' + reg.crossRefs.length + ')</button>' +
              '</div>'
            : '<div class="muted-note">Knoten-Inventar im aktuellen Diagramm (' + GRAPH.nodes.length + ' Knoten)</div>');
        body.appendChild(ctrl);
        const btnOpenFullInv = ctrl.querySelector('#btn-an-open-full-inventory');
        if (btnOpenFullInv) btnOpenFullInv.addEventListener('click', () => openInventoryModal());
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
            s.usages.slice(0, 6).forEach(u => {
              const btn = document.createElement('button');
              btn.className = 'node-chip';
              let subtitle = '[' + u.scriptNumber + '] ' + u.scriptName;
              if (u.stepName) subtitle += ' · ' + u.stepName;
              if (u.prio !== undefined) subtitle += ' (Prio ' + u.prio + ')';
              btn.innerHTML = '<span>' + esc(subtitle) + '</span><span class="badge">Zeigen →</span>';
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
        } else if (anInvCategory === 'externalApis') {
          const apiList = reg.externalApis || [];
          const items = apiList.filter(a => !q || (a.providerLabel + ' ' + (a.providerId || '') + ' ' + a.actionLabel + ' ' + (a.templateId || '') + ' ' + (a.channelLabel || '') + ' ' + (a.endpointPath || '') + ' ' + a.apiVersion).toLowerCase().includes(q) || (a.usages || []).some(u => (u.scriptNumber + ' ' + u.scriptName).toLowerCase().includes(q)));
          if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'card muted-note';
            empty.textContent = 'Keine FlixCheck- oder HDX-API-Integrationen gefunden.';
            body.appendChild(empty);
          } else {
            items.slice(0, 100).forEach(api => {
              const el = document.createElement('div');
              el.className = 'an-item';
              const verText = api.apiVersion === 'v1-legacy' ? 'API v1 Legacy' : api.apiVersion === 'v7' ? 'API v7' : 'HDX-Provider';
              const verCls = api.apiVersion === 'v1-legacy' ? 'err' : api.apiVersion === 'v7' ? 'ok' : '';
              const metaBits = [];
              if (api.channelLabel) metaBits.push('Kanal: ' + api.channelLabel);
              if (api.templateId) metaBits.push('Template: ' + api.templateId);
              if (api.endpointPath) metaBits.push(api.endpointPath);
              el.innerHTML =
                '<div class="row-between"><span class="an-item-title">' + esc((api.isFlixcheck ? 'FlixCheck · ' : '') + api.actionLabel) + '</span><span class="an-tag ' + verCls + '">' + esc(verText) + '</span></div>' +
                (metaBits.length ? '<div class="an-item-desc">' + esc(metaBits.join(' · ')) + '</div>' : '') +
                (api.hasWarning && api.warningSummary ? '<div class="an-item-desc" style="color:#fbbf24;">Warnung: ' + esc(api.warningSummary) + '</div>' : '');
              (api.usages || []).slice(0, 5).forEach(u => {
                const btn = document.createElement('button');
                btn.className = 'node-chip';
                btn.innerHTML = '<span>' + esc('[' + u.scriptNumber + '] ' + u.scriptName + (u.prio !== undefined ? ' (Prio ' + u.prio + ')' : '')) + '</span><span class="badge">Zeigen →</span>';
                btn.onclick = () => jumpToScriptOrNode(u.scriptNumber, api.templateId || api.providerLabel);
                el.appendChild(btn);
              });
              body.appendChild(el);
            });
          }
        } else {
          const items = reg.crossRefs.filter(cr => !q || (cr.refKey + ' ' + cr.displayName).toLowerCase().includes(q));
          items.slice(0, 100).forEach(cr => {
            const el = document.createElement('div');
            el.className = 'an-item';
            const stCls = cr.status === 'missing' ? 'err' : cr.status === 'present' || cr.status === 'master' ? 'ok' : '';
            const stLabel = cr.status === 'master' ? 'Master' : cr.status === 'present' ? 'Geladen' : cr.status === 'waypoint' ? 'Wegweiser' : cr.status === 'external' ? 'Extern' : 'Fehlend';
            el.innerHTML =
              '<div class="row-between"><span class="an-item-title">' + esc(cr.displayName) + '</span><span class="an-tag ' + stCls + '">' + esc(stLabel) + '</span></div>' +
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
        return;
      }

      if (activeAnalysisSubtab === 'audit') {
        const rep = an ? an.auditReport : null;
        if (!rep) {
          const empty = document.createElement('div');
          empty.className = 'card muted-note';
          empty.textContent = 'Graph-Audit ist für Multi-Skript Callflows verfügbar.';
          body.appendChild(empty);
          return;
        }
        const sum = rep.summary || {};
        const ctrl = document.createElement('div');
        ctrl.className = 'card';
        ctrl.innerHTML =
          '<div class="audit-kpi-grid">'
            + '<div class="audit-kpi-box"><div class="audit-kpi-val">' + (sum.totalScripts || 0) + '</div><div class="audit-kpi-lbl">Skripte · ' + (sum.totalEdges || 0) + ' Kanten</div></div>'
            + '<div class="audit-kpi-box"><div class="audit-kpi-val" style="color:' + ((sum.brokenLinkCount || 0) > 0 ? 'var(--err-text)' : 'var(--ok-text)') + ';">' + (sum.brokenLinkCount || 0) + '</div><div class="audit-kpi-lbl">Defekte Links</div></div>'
            + '<div class="audit-kpi-box"><div class="audit-kpi-val" style="color:' + ((sum.orphanScriptCount || 0) > 0 ? 'var(--warn-text)' : 'var(--ok-text)') + ';">' + (sum.orphanScriptCount || 0) + '</div><div class="audit-kpi-lbl">Waisen · ' + (sum.deadEndScriptCount || 0) + ' Sackgassen</div></div>'
            + '<div class="audit-kpi-box"><div class="audit-kpi-val" style="color:' + ((sum.circularLoopCount || 0) > 0 ? 'var(--err-text)' : 'var(--text-main)') + ';">' + (sum.circularLoopCount || 0) + '</div><div class="audit-kpi-lbl">Loops · ' + (sum.externalIntegrationCount || 0) + ' Externe</div></div>'
          + '</div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:7px;">'
            + '<button type="button" id="btn-audit-dl-json" style="flex:1;justify-content:center;font-size:11px;font-weight:600;">Report .json</button>'
            + (an.auditMermaid ? '<button type="button" id="btn-audit-dl-mmd" style="flex:1;justify-content:center;font-size:11px;font-weight:600;">Graph .mmd</button>' : '')
            + (an.auditMermaid ? '<button type="button" id="btn-audit-toggle-mmd" style="font-size:11px;">' + (anAuditShowMermaid ? 'Mermaid aus' : 'Mermaid') + '</button>' : '')
          + '</div>'
          + (anAuditShowMermaid && an.auditMermaid ? '<pre class="genesys-yaml-pre" style="max-height:150px;margin:0 0 8px;">' + esc(an.auditMermaid) + '</pre>' : '')
          + '<input type="text" id="an-audit-search" placeholder="Skript, Ziel, Loop oder System suchen..." value="' + esc(anAuditSearch) + '" style="width:100%;margin-bottom:7px;" />'
          + '<div class="filter-chips" id="an-audit-chips">'
            + '<button class="chip' + (anAuditTab === 'broken' ? ' active' : '') + '" data-at="broken">Defekte Links (' + ((rep.brokenLinks && rep.brokenLinks.length) || 0) + ')</button>'
            + '<button class="chip' + (anAuditTab === 'orphans' ? ' active' : '') + '" data-at="orphans">Waisen (' + ((rep.orphanScripts && rep.orphanScripts.length) || 0) + ')</button>'
            + '<button class="chip' + (anAuditTab === 'deadends' ? ' active' : '') + '" data-at="deadends">Sackgassen (' + ((rep.deadEndScripts && rep.deadEndScripts.length) || 0) + ')</button>'
            + '<button class="chip' + (anAuditTab === 'loops' ? ' active' : '') + '" data-at="loops">Loops (' + ((rep.circularLoops && rep.circularLoops.length) || 0) + ')</button>'
            + '<button class="chip' + (anAuditTab === 'external' ? ' active' : '') + '" data-at="external">Externe (' + ((rep.externalIntegrations && rep.externalIntegrations.length) || 0) + ')</button>'
          + '</div>';
        body.appendChild(ctrl);

        ctrl.querySelector('#an-audit-search').addEventListener('input', e => { anAuditSearch = e.target.value; renderAnalysisTab(); });
        ctrl.querySelectorAll('#an-audit-chips .chip').forEach(c => c.addEventListener('click', () => { anAuditTab = c.getAttribute('data-at'); renderAnalysisTab(); }));
        const dlJsonBtn = ctrl.querySelector('#btn-audit-dl-json');
        if (dlJsonBtn) {
          dlJsonBtn.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(rep, null, 2)], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'callflow-audit-report.json';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          });
        }
        const dlMmdBtn = ctrl.querySelector('#btn-audit-dl-mmd');
        if (dlMmdBtn && an.auditMermaid) {
          dlMmdBtn.addEventListener('click', () => {
            const blob = new Blob([an.auditMermaid], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'callflow-audit-graph.mmd';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          });
        }
        const tglMmdBtn = ctrl.querySelector('#btn-audit-toggle-mmd');
        if (tglMmdBtn) {
          tglMmdBtn.addEventListener('click', () => { anAuditShowMermaid = !anAuditShowMermaid; renderAnalysisTab(); });
        }

        const q = anAuditSearch.trim().toLowerCase();
        const resolveAuditScriptJump = (rawKeyOrFile) => {
          const raw = String(rawKeyOrFile || '').trim();
          if (!raw) return;
          if (PAYLOAD.viewKeyByScriptNumber && PAYLOAD.viewKeyByScriptNumber[raw]) {
            jumpToScriptOrNode(raw, raw);
            return;
          }
          const lower = raw.toLowerCase();
          if (PAYLOAD.viewKeyByScriptNumber && PAYLOAD.viewKeyByScriptNumber[lower]) {
            jumpToScriptOrNode(lower, raw);
            return;
          }
          const numMatch = raw.match(/(\\d{2,6})/);
          if (numMatch && PAYLOAD.viewKeyByScriptNumber && PAYLOAD.viewKeyByScriptNumber[numMatch[1]]) {
            jumpToScriptOrNode(numMatch[1], numMatch[1]);
            return;
          }
          jumpToScriptOrNode(raw, raw);
        };

        const appendEmptyAudit = (txt) => {
          const d = document.createElement('div');
          d.className = 'card muted-note';
          d.textContent = txt;
          body.appendChild(d);
        };

        if (anAuditTab === 'broken') {
          const list = (rep.brokenLinks || []).filter(b => !q || (b.sourceFileName + ' ' + b.sourceScriptKey + ' ' + b.targetRaw + ' ' + b.command + ' ' + (b.reason || '')).toLowerCase().includes(q));
          if (!list.length) { appendEmptyAudit('Keine defekten Links für diesen Filter.'); return; }
          list.slice(0, 120).forEach(b => {
            const el = document.createElement('div');
            el.className = 'an-item';
            el.innerHTML =
              '<div class="row-between"><span class="an-item-title">' + esc(b.sourceFileName || b.sourceScriptKey) + '</span><span class="an-tag err">Zeile ' + (b.lineNumber || 1) + '</span></div>'
              + '<div class="an-item-desc">' + esc(b.command + ' → ' + b.targetRaw) + (b.reason ? ' · ' + esc(b.reason) : '') + '</div>'
              + '<button class="node-chip"><span>Quellskript öffnen</span><span class="badge">Zeigen →</span></button>';
            el.querySelector('button').onclick = () => resolveAuditScriptJump(b.sourceScriptKey || b.sourceFileName);
            body.appendChild(el);
          });
        } else if (anAuditTab === 'orphans') {
          const list = (rep.orphanScripts || []).filter(o => !q || (o.scriptNumber + ' ' + o.scriptName + ' ' + o.fileName).toLowerCase().includes(q));
          if (!list.length) { appendEmptyAudit('Keine verwaisten Skripte (Waisen) gefunden.'); return; }
          list.slice(0, 120).forEach(o => {
            const el = document.createElement('div');
            el.className = 'an-item';
            el.innerHTML =
              '<div class="row-between"><span class="an-item-title">' + esc('[' + o.scriptNumber + '] ' + (o.scriptName || o.fileName)) + '</span><span class="an-tag warn">' + (o.outgoingEdgeCount || 0) + ' Ausgänge</span></div>'
              + '<div class="an-item-desc">Kein eingehender Verweis aus Main oder einem anderen geladenen Skript.</div>'
              + '<button class="node-chip"><span>Skript im Callflow öffnen</span><span class="badge">Zeigen →</span></button>';
            el.querySelector('button').onclick = () => resolveAuditScriptJump(o.scriptNumber || o.scriptKey);
            body.appendChild(el);
          });
        } else if (anAuditTab === 'deadends') {
          const list = (rep.deadEndScripts || []).filter(d => !q || (d.scriptNumber + ' ' + d.scriptName + ' ' + d.note + ' ' + (d.skillsetQueues || []).join(' ')).toLowerCase().includes(q));
          if (!list.length) { appendEmptyAudit('Keine Sackgassen-Skripte gefunden.'); return; }
          list.slice(0, 120).forEach(d => {
            const el = document.createElement('div');
            el.className = 'an-item';
            el.innerHTML =
              '<div class="row-between"><span class="an-item-title">' + esc('[' + d.scriptNumber + '] ' + (d.scriptName || d.fileName)) + '</span><span class="an-tag ' + (d.hasSkillsetQueue ? 'ok' : 'warn') + '">' + (d.hasSkillsetQueue ? 'Mit Queue' : 'Ohne Ende') + '</span></div>'
              + '<div class="an-item-desc">' + esc(d.note || '') + '</div>'
              + '<button class="node-chip"><span>Skript öffnen</span><span class="badge">Zeigen →</span></button>';
            el.querySelector('button').onclick = () => resolveAuditScriptJump(d.scriptNumber || d.scriptKey);
            body.appendChild(el);
          });
        } else if (anAuditTab === 'loops') {
          const list = (rep.circularLoops || []).filter(l => !q || (l.cycleFileNames.join(' ') + ' ' + l.cycleKeys.join(' ')).toLowerCase().includes(q));
          if (!list.length) { appendEmptyAudit('Keine zirkulären Schleifen (Loops) erkannt.'); return; }
          list.slice(0, 100).forEach(l => {
            const el = document.createElement('div');
            el.className = 'an-item';
            const chain = (l.cycleFileNames && l.cycleFileNames.length ? l.cycleFileNames : l.cycleKeys).join(' → ');
            el.innerHTML =
              '<div class="row-between"><span class="an-item-title">Zyklus (' + (l.length || l.cycleKeys.length) + ' Stationen)</span><span class="an-tag err">Loop</span></div>'
              + '<div class="an-item-desc">' + esc(chain) + '</div>'
              + '<button class="node-chip"><span>Einstieg des Loops öffnen</span><span class="badge">Zeigen →</span></button>';
            el.querySelector('button').onclick = () => resolveAuditScriptJump(l.cycleKeys[0]);
            body.appendChild(el);
          });
        } else {
          const list = (rep.externalIntegrations || []).filter(ex => !q || (ex.system + ' ' + ex.sourceFileName + ' ' + ex.targetRaw + ' ' + ex.category).toLowerCase().includes(q));
          if (!list.length) { appendEmptyAudit('Keine externen Integrationen (FlixCheck / Oracle) gefunden.'); return; }
          list.slice(0, 120).forEach(ex => {
            const el = document.createElement('div');
            el.className = 'an-item';
            el.innerHTML =
              '<div class="row-between"><span class="an-item-title">' + esc(ex.system + ' · ' + ex.targetRaw) + '</span><span class="an-tag">' + esc(ex.category || ex.command) + '</span></div>'
              + '<div class="an-item-desc">' + esc(ex.sourceFileName) + ' · Zeile ' + (ex.lineNumber || 1) + ' (' + esc(ex.command) + ')</div>'
              + '<button class="node-chip"><span>Aufrufendes Skript öffnen</span><span class="badge">Zeigen →</span></button>';
            el.querySelector('button').onclick = () => resolveAuditScriptJump(ex.sourceScriptKey || ex.sourceFileName);
            body.appendChild(el);
          });
        }
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

    // === EXTRA FENSTER: ÖFFNUNGSZEITEN-ÜBERSICHT (WOCHENMATRIX MO–SO, ZEITPROFILE & DETAIL-REGELN) ===
    let schedulesModalView = 'matrix'; // 'matrix' | 'profiles' | 'table'
    let schedulesModalCategory = 'all'; // 'all' | 'hours' | 'sondzeit' | 'holiday' | 'always-open'
    let schedulesModalHide247 = false;

    function classifyScheduleRow(r) {
      const hoursStr = String(r.openingHours || '').trim();
      const srcStr = String(r.scheduleSource || '').trim();
      const isSond = /sondzeit/i.test(srcStr) || /sondzeit/i.test(hoursStr) || /sondzeit/i.test(String(r.scriptName || '')) || /sondzeit/i.test(String(r.scriptNumber || ''));
      if (r.hasSchedule && isSond) return 'sondzeit';
      if (r.hasSchedule) return 'hours';
      if (r.hasHoliday) return 'holiday';
      return 'always-open';
    }

    function normalizeScheduleProfileTitle(r, cat) {
      const cleanHours = String(r.openingHours || '').replace(/:\\s+/g, ':').replace(/\\s+/g, ' ').trim();
      if (cat === 'hours') return cleanHours || 'Uhrzeiten hinterlegt';
      if (cat === 'sondzeit') return cleanHours && cleanHours !== '—' ? 'SondZeit · ' + cleanHours : 'SondZeit-Zeitplan (CCMA)';
      if (cat === 'holiday') return 'Feiertag / Sonderzeit · ' + (r.holidayAndSpecial || 'Prüfung aktiv');
      return 'Ohne Zeitbeschränkung (24/7)';
    }

    function getOpeningHoursBundle() {
      return (PAYLOAD.analysis && PAYLOAD.analysis.openingHoursBundle) || null;
    }

    function getFilteredMatrixRowsForModal() {
      const bundle = getOpeningHoursBundle();
      const allM = bundle ? (bundle.allMatrixRows || []) : [];
      const q = (document.getElementById('modal-sched-search') ? document.getElementById('modal-sched-search').value : '').trim().toLowerCase();
      return allM.filter(r => {
        if (schedulesModalHide247 && r.category === 'always-open' && schedulesModalCategory !== 'always-open') return false;
        if (schedulesModalCategory === 'hours' && !r.hasSchedule) return false;
        if (schedulesModalCategory === 'sondzeit' && r.category !== 'sondzeit') return false;
        if (schedulesModalCategory === 'holiday' && !r.hasHoliday) return false;
        if (schedulesModalCategory === 'always-open' && r.category !== 'always-open') return false;
        if (!q) return true;
        const d = r.days || {};
        const hay = (
          String(r.scriptNumber || '') + ' ' +
          String(r.scriptName || '') + ' ' +
          String(r.categoryLabel || '') + ' ' +
          String(r.compactScheduleSummary || '') + ' ' +
          String(r.sondZeitSource || '') + ' ' +
          String(r.holidaySummary || '') + ' ' +
          String(r.overflowSummary || '') + ' ' +
          OH_WEEKDAYS.map(k => k + ' ' + (d[k] || '')).join(' ')
        ).toLowerCase();
        return hay.includes(q);
      });
    }

    function getFilteredScheduleRowsForModal() {
      const bundle = getOpeningHoursBundle();
      const an = PAYLOAD.analysis;
      const rows = bundle ? (bundle.detailRows || []) : (an ? (an.scheduleRows || []) : []);
      const q = (document.getElementById('modal-sched-search') ? document.getElementById('modal-sched-search').value : '').trim().toLowerCase();
      return rows.filter(r => {
        const cat = classifyScheduleRow(r);
        if (schedulesModalHide247 && cat === 'always-open' && schedulesModalCategory !== 'always-open') return false;
        if (schedulesModalCategory === 'hours' && !r.hasSchedule) return false;
        if (schedulesModalCategory === 'sondzeit' && cat !== 'sondzeit') return false;
        if (schedulesModalCategory === 'holiday' && !r.hasHoliday) return false;
        if (schedulesModalCategory === 'always-open' && cat !== 'always-open') return false;
        if (!q) return true;
        const hay = (
          String(r.scriptNumber || '') + ' ' +
          String(r.scriptName || '') + ' ' +
          String(r.stepName || '') + ' ' +
          String(r.openingHours || '').replace(/:\\s+/g, ':') + ' ' +
          String(r.scheduleSource || '') + ' ' +
          String(r.holidayAndSpecial || '') + ' ' +
          String(r.closedOrOverflowAction || '')
        ).toLowerCase();
        return hay.includes(q);
      });
    }

    function renderDayCellHtml(val) {
      if (val === 'Geschlossen') return '<span style="color:var(--text-dim);font-style:italic;font-size:10.5px;">Geschl.</span>';
      if (val === '24/7') return '<span style="font-family:ui-monospace,monospace;font-weight:700;color:#34d399;font-size:11px;">24/7</span>';
      if (!val || val === '—') return '<span style="color:var(--text-dim);">—</span>';
      return '<span style="font-family:ui-monospace,monospace;font-weight:600;color:var(--accent-text);font-size:11px;white-space:nowrap;">' + esc(val) + '</span>';
    }

    function renderSchedulesModalContent() {
      const body = document.getElementById('modal-sched-body');
      const subtitle = document.getElementById('schedules-modal-subtitle');
      const hideBtn = document.getElementById('btn-modal-hide-247');
      if (!body) return;
      const bundle = getOpeningHoursBundle();
      const an = PAYLOAD.analysis;
      const allRows = bundle ? (bundle.detailRows || []) : (an ? (an.scheduleRows || []) : []);
      const filteredDetails = getFilteredScheduleRowsForModal();
      const filteredMatrix = getFilteredMatrixRowsForModal();

      if (hideBtn) {
        hideBtn.textContent = schedulesModalHide247 ? '24/7 ausgeblendet ✓' : '24/7 ausblenden';
        hideBtn.style.background = schedulesModalHide247 ? 'rgba(16,185,129,0.18)' : 'var(--bg-card)';
        hideBtn.style.borderColor = schedulesModalHide247 ? '#10b981' : 'var(--border-strong)';
        hideBtn.style.color = schedulesModalHide247 ? '#6ee7b7' : 'var(--text-muted)';
      }

      const st = bundle && bundle.stats
        ? bundle.stats
        : {
            totalScripts: new Set(allRows.map(r => r.scriptNumber)).size,
            withHours: allRows.filter(r => classifyScheduleRow(r) === 'hours').length,
            withSondZeit: allRows.filter(r => classifyScheduleRow(r) === 'sondzeit').length,
            withHoliday: allRows.filter(r => r.hasHoliday).length,
            alwaysOpen: allRows.filter(r => classifyScheduleRow(r) === 'always-open').length,
          };
      const catCounts = {
        all: st.totalScripts,
        hours: st.withHours + st.withSondZeit,
        sondzeit: st.withSondZeit,
        holiday: st.withHoliday,
        'always-open': st.alwaysOpen,
      };
      document.querySelectorAll('#modal-sched-cats .chip').forEach(ch => {
        const c = ch.getAttribute('data-cat');
        ch.classList.toggle('active', c === schedulesModalCategory);
        const cntEl = ch.querySelector('.cat-cnt');
        if (cntEl && c && catCounts[c] !== undefined) cntEl.textContent = '(' + catCounts[c] + ')';
      });
      document.querySelectorAll('#modal-sched-view-group .seg-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-sview') === schedulesModalView);
      });

      if (subtitle) {
        subtitle.textContent = st.totalScripts + ' Skripte · ' + st.withHours + ' Dienstzeiten · ' + st.withSondZeit + ' SondZeit · ' + st.withHoliday + ' Feiertage · ' + st.alwaysOpen + ' 24/7';
      }

      if (!allRows.length) {
        body.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;font-size:12px;">Keine Öffnungszeiten oder Zeitpläne im Callflow gefunden.</div>';
        return;
      }

      if (schedulesModalView === 'matrix' && bundle) {
        if (!filteredMatrix.length) {
          body.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;font-size:12px;">Keine passenden Skripte für die aktuelle Filterung gefunden.</div>';
          return;
        }
        const activeList = filteredMatrix.filter(r => r.category !== 'always-open');
        const aoList = filteredMatrix.filter(r => r.category === 'always-open');
        let htmlParts = [];

        if (activeList.length) {
          htmlParts.push(
            '<div style="margin-bottom:14px;">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:11.5px;">' +
                '<strong style="color:var(--text-main);">Öffnungszeiten, SondZeit &amp; Feiertage (' + activeList.length + ' Skripte)</strong>' +
                '<span style="color:var(--text-muted);">1 konsolidierte Zeile pro Skript</span>' +
              '</div>' +
              '<div class="an-table-wrap" style="max-height:none;overflow-x:auto;">' +
                '<table class="an-table"><thead><tr>' +
                  '<th>Skript</th><th>Kategorie</th>' +
                  OH_WEEKDAYS.map(d => '<th style="text-align:center;">' + d + '</th>').join('') +
                  '<th>SondZeit / Quelle</th><th>Feiertag</th><th>Überlauf / Ziel</th><th style="text-align:right;">Diagramm</th>' +
                '</tr></thead><tbody>' +
                activeList.map(r => {
                  const d = r.days || {};
                  const tagCls = r.category === 'hours' ? 'ok' : 'warn';
                  return '<tr>' +
                    '<td style="white-space:nowrap;"><strong>[' + esc(r.scriptNumber) + ']</strong> ' + esc(r.scriptName) + '</td>' +
                    '<td style="white-space:nowrap;"><span class="an-tag ' + tagCls + '">' + esc(r.categoryLabel) + '</span></td>' +
                    OH_WEEKDAYS.map(k => '<td style="text-align:center;">' + renderDayCellHtml(d[k]) + '</td>').join('') +
                    '<td style="font-family:ui-monospace,monospace;font-size:11px;">' + esc(r.sondZeitSource || '—') + '</td>' +
                    '<td>' + (r.hasHoliday ? '<span style="color:#fbbf24;">' + esc(r.holidaySummary) + '</span>' : '—') + '</td>' +
                    '<td>' + esc(r.overflowSummary || '—') + '</td>' +
                    '<td style="text-align:right;white-space:nowrap;"><button type="button" class="sched-jump-btn" data-snum="' + esc(r.scriptNumber) + '" style="padding:3px 8px;font-size:10.5px;background:var(--bg-input);border:1px solid var(--border);color:var(--text-main);border-radius:5px;cursor:pointer;white-space:nowrap;">Öffnen →</button></td>' +
                  '</tr>';
                }).join('') +
                '</tbody></table>' +
              '</div>' +
            '</div>'
          );
        }

        if (aoList.length) {
          htmlParts.push(
            '<div>' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:11.5px;">' +
                '<strong style="color:#34d399;">24/7-Skripte ohne Zeitbeschränkung (' + aoList.length + ')</strong>' +
                '<span style="color:var(--text-muted);">Im Excel-Workbook separat auf Blatt „24-7 &amp; Ohne Zeitplan“</span>' +
              '</div>' +
              '<div class="an-table-wrap" style="max-height:none;overflow-x:auto;">' +
                '<table class="an-table"><thead><tr><th>Skript</th><th>Status</th><th>Queues, Ansagen &amp; Ziele</th><th style="text-align:right;">Diagramm</th></tr></thead><tbody>' +
                aoList.map(r =>
                  '<tr>' +
                    '<td style="white-space:nowrap;"><strong>[' + esc(r.scriptNumber) + ']</strong> ' + esc(r.scriptName) + '</td>' +
                    '<td style="white-space:nowrap;"><span class="an-tag">' + esc(r.categoryLabel) + '</span></td>' +
                    '<td>' + esc(r.overflowSummary || '—') + '</td>' +
                    '<td style="text-align:right;white-space:nowrap;"><button type="button" class="sched-jump-btn" data-snum="' + esc(r.scriptNumber) + '" style="padding:3px 8px;font-size:10.5px;background:var(--bg-input);border:1px solid var(--border);color:var(--text-main);border-radius:5px;cursor:pointer;white-space:nowrap;">Öffnen →</button></td>' +
                  '</tr>'
                ).join('') +
                '</tbody></table>' +
              '</div>' +
            '</div>'
          );
        }

        body.innerHTML = htmlParts.join('');
      } else if (!filteredDetails.length) {
        body.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px;font-size:12px;">Keine passenden Öffnungszeiten für die aktuelle Filterung gefunden.</div>';
        return;
      } else if (schedulesModalView === 'profiles') {
        const groupMap = new Map();
        filteredDetails.forEach(r => {
          const cat = classifyScheduleRow(r);
          const title = normalizeScheduleProfileTitle(r, cat);
          const key = cat + '::' + title.toLowerCase();
          let grp = groupMap.get(key);
          if (!grp) {
            grp = { key, title, cat, rows: [], scriptsMap: new Map(), overflows: new Set() };
            groupMap.set(key, grp);
          }
          grp.rows.push(r);
          if (!grp.scriptsMap.has(r.scriptNumber)) {
            grp.scriptsMap.set(r.scriptNumber, { scriptNumber: r.scriptNumber, scriptName: r.scriptName });
          }
          if (r.closedOrOverflowAction && r.closedOrOverflowAction !== '—') {
            grp.overflows.add(r.closedOrOverflowAction);
          }
        });
        const catRank = { hours: 0, sondzeit: 1, holiday: 2, 'always-open': 3 };
        const groups = Array.from(groupMap.values()).sort((a, b) => (catRank[a.cat] - catRank[b.cat]) || (b.rows.length - a.rows.length));
        const catLabel = { hours: 'Dienstzeiten', sondzeit: 'SondZeit', holiday: 'Feiertag', 'always-open': '24/7' };
        const catTagClass = { hours: 'ok', sondzeit: 'warn', holiday: 'warn', 'always-open': '' };

        body.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px;">' + groups.map(grp => {
          const scripts = Array.from(grp.scriptsMap.values());
          const ovList = Array.from(grp.overflows).slice(0, 4);
          return '<div class="profile-card">' +
            '<div class="row-between" style="flex-wrap:wrap;gap:6px;">' +
              '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap;">' +
                '<span class="an-tag ' + (catTagClass[grp.cat] || '') + '">' + esc(catLabel[grp.cat] || grp.cat) + '</span>' +
                '<strong style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--text-main);">' + esc(grp.title) + '</strong>' +
              '</div>' +
              '<span style="font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums;">' + scripts.length + ' Skript(e) · ' + grp.rows.length + ' Regel(n)</span>' +
            '</div>' +
            (ovList.length ? '<div style="font-size:11px;color:var(--text-muted);">Überlauf / Geschlossen: <span style="color:var(--text-main);">' + esc(ovList.join(' · ')) + '</span></div>' : '') +
            '<div class="profile-scripts">' +
              scripts.map(s =>
                '<button type="button" class="profile-script-btn sched-jump-btn" data-snum="' + esc(s.scriptNumber) + '" title="Detail-Skript öffnen">[' + esc(s.scriptNumber) + '] ' + esc(s.scriptName || '') + ' →</button>'
              ).join('') +
            '</div>' +
          '</div>';
        }).join('') + '</div>';
      } else {
        body.innerHTML =
          '<div class="an-table-wrap" style="max-height:none;">' +
            '<table class="an-table"><thead><tr><th>Skript</th><th>Regel / Schritt</th><th>Öffnungszeiten (SondZeit)</th><th>Feiertag</th><th>Überlauf / Aktion</th><th style="text-align:right;">Aktion</th></tr></thead><tbody>' +
            filteredDetails.map(r =>
              '<tr>' +
                '<td><strong>[' + esc(r.scriptNumber) + ']</strong> ' + esc(r.scriptName) + '</td>' +
                '<td>' + (r.prio ? 'Prio ' + r.prio + ' · ' : '') + esc(r.stepName) + '</td>' +
                '<td><span style="font-family:ui-monospace,monospace;font-weight:600;color:var(--accent-text);font-size:11.5px;">' + esc((r.openingHours || '').replace(/:\\s+/g, ':')) + '</span></td>' +
                '<td>' + (r.hasHoliday ? esc(r.holidayAndSpecial) : '—') + '</td>' +
                '<td>' + esc(r.closedOrOverflowAction || '—') + '</td>' +
                '<td style="text-align:right;"><button type="button" class="sched-jump-btn" data-snum="' + esc(r.scriptNumber) + '" style="padding:3px 8px;font-size:10.5px;background:var(--bg-input);border:1px solid var(--border);color:var(--text-main);border-radius:5px;cursor:pointer;white-space:nowrap;">Im Diagramm →</button></td>' +
              '</tr>'
            ).join('') +
            '</tbody></table>' +
          '</div>';
      }

      body.querySelectorAll('.sched-jump-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const snum = btn.getAttribute('data-snum');
          const vk = (PAYLOAD.viewKeyByScriptNumber && (PAYLOAD.viewKeyByScriptNumber[snum] || PAYLOAD.viewKeyByScriptNumber[String(snum).toLowerCase()])) || ('script:' + snum);
          if (viewsByKey.has(vk)) {
            switchView(vk);
            const overlay = document.getElementById('schedules-modal-overlay');
            if (overlay) overlay.style.display = 'none';
          }
        });
      });
    }

    function openSchedulesModal(initialQuery) {
      const overlay = document.getElementById('schedules-modal-overlay');
      const searchInput = document.getElementById('modal-sched-search');
      if (!overlay) return;
      schedulesModalCategory = 'all';
      if (searchInput) searchInput.value = initialQuery || '';
      overlay.style.display = 'flex';
      renderSchedulesModalContent();
      if (searchInput) setTimeout(() => searchInput.focus(), 40);
    }

    // === DUAL-AUDIENCE KNOTEN-INFO-BOX (LAIE | IT-PROFI) ===
    let activeInfoModalNodeId = '';
    let activeInfoModalMode = 'layperson'; // 'layperson' | 'pro' | 'script'
    let infoModalHistory = [];

    function buildFallbackExplanation(snap) {
      const nObj = nodeMap.get(snap.nodeId);
      const role = nObj ? nObj.role : 'step';
      const inc = snap.incomingConnections || [];
      const out = snap.outgoingConnections || [];
      const rules = snap.moduleRulesPreview || [];
      const sched = snap.resolvedScheduleDisplay || snap.schedule || '';
      const bt = snap.blockType || 'script';

      let archetypeLabel = 'Prozessschritt im Ablauf';
      let shortTagline = 'Station im dargestellten Callflow';
      let whatIsIt = 'Ein einzelner Baustein im Anrufweg, der den Anruf entgegennimmt und gemäß seiner Konfiguration weiterführt.';

      if (snap.nodeId === 'FAX_BUNDLE' || /fax/i.test(snap.title || '')) {
        archetypeLabel = 'Fax-Weiterleitung (Fax-Bündel)';
        shortTagline = 'Gebündeltes Ziel für Fax-Verbindungen';
        whatIsIt = 'Sammelziel für eingehende Fax-Rufnummern, getrennt von normalen Sprachanrufen.';
      } else if (bt === 'dtmf') {
        archetypeLabel = 'Tastenmenü (Sprachauswahl)';
        shortTagline = 'Anrufer wählt per Telefontaste (1, 2, 3 …)';
        whatIsIt = 'Ein interaktives Auswahlmenü: Nach einer Ansage drückt der Anrufer eine Zahl, um direkt im richtigen Bereich zu landen.';
      } else if (bt === 'queue' || snap.queueTarget) {
        archetypeLabel = 'Warteschlange (Mitarbeiter-Team)';
        shortTagline = 'Verbindet den Anrufer mit dem zuständigen Team';
        whatIsIt = 'Hier wird der Anrufer an eine Mitarbeiter-Gruppe übergeben und wartet bei Bedarf, bis ein Ansprechpartner frei wird.';
      } else if (bt === 'condition' || sched || snap.condition || snap.hasHolidayCheck) {
        archetypeLabel = 'Zeit-, Feiertags- oder Regelweiche';
        shortTagline = 'Prüft Bedingungen und wählt automatisch den Weg';
        whatIsIt = 'Eine automatische Entscheidungsstelle: Sie prüft Uhrzeit, Feiertage oder Bedingungen und leitet den Anruf entsprechend weiter.';
      } else if (bt === 'announcement' || snap.announcement) {
        archetypeLabel = 'Sprachansage (Audio-Hinweis)';
        shortTagline = 'Spielt dem Anrufer eine Information vor';
        whatIsIt = 'Spielt eine aufgezeichnete Ton-Ansage ab, z. B. Begrüßung, Hinweis oder Information außerhalb der Geschäftszeiten.';
      } else if (bt === 'external' || snap.mode === 'workspace-external') {
        archetypeLabel = 'Externes Ziel / Weiterleitung / Ende';
        shortTagline = 'Übergibt nach außen oder beendet den Anruf';
        whatIsIt = 'An dieser Stelle verlässt der Anruf den Ablauf durch Weiterleitung nach außen oder reguläres Gesprächsende.';
      } else if (snap.mode === 'workspace-module') {
        archetypeLabel = 'Teil-Ablauf (Unter-Skript)';
        shortTagline = 'Eigenständiger Baustein für ein Thema / eine Abteilung';
        whatIsIt = 'Bündelt alle Regeln, Öffnungszeiten, Ansagen und Ziele für genau diesen Fachbereich.';
      } else if (role === 'entry') {
        archetypeLabel = 'Startpunkt im Ablauf';
        shortTagline = 'Hier beginnt dieser dargestellte Weg';
        whatIsIt = 'Einstiegspunkt im Diagramm, von dem aus der Anruf in die nachfolgenden Stationen geleitet wird.';
      } else if (role === 'terminal') {
        archetypeLabel = 'Endpunkt im Ablauf';
        shortTagline = 'Hier endet dieser dargestellte Pfad';
        whatIsIt = 'Abschließende Station im aktuellen Schaubild ohne weitere nachgelagerte Schritte.';
      } else if (role === 'hub') {
        archetypeLabel = 'Verteiler / Verzweigung';
        shortTagline = 'Bündelt oder verzweigt mehrere Wege';
        whatIsIt = 'Zentraler Knotenpunkt, an dem mehrere Wege zusammenlaufen oder sich auf Folgeziele aufteilen.';
      }

      function translateConditionFallback(rawCond) {
        const c = String(rawCond || '').replace(/^IF\s+/i, '').trim();
        if (!c) return '';
        if (/OUT\s+OF\s+SERVICE|OOS|NOT\s+IN\s+SERVICE/i.test(c)) return 'Es wird geprüft, ob der Dienst oder das Team aktuell außer Betrieb bzw. geschlossen ist.';
        if (/(?:LOGGED|AVAILABLE|IDLE)\s+AGENTS?.*(?:=|<=)\s*0|NOT\s+LOGGED/i.test(c)) return 'Es wird geprüft, ob aktuell kein Mitarbeiter im Team angemeldet bzw. frei ist.';
        if (/QUEUED\s+CALLS|CALLS\s+WAITING/i.test(c)) return 'Es wird geprüft, wie viele Anrufer bereits in der Warteschlange warten.';
        if (/EXPECTED\s+WAIT\s+TIME|EWT/i.test(c)) return 'Es wird geprüft, ob die geschätzte Wartezeit einen Grenzwert überschreitet.';
        if (/HOLIDAY|FEIERTAG/i.test(c)) return 'Es wird geprüft, ob heute ein Feiertag ist.';
        if (/SONDZEIT|NOTFALL|EMERGENCY/i.test(c)) return 'Es wird geprüft, ob eine Sonderzeit- oder Notfallschaltung aktiv ist.';
        if (/BUSY|FULL/i.test(c)) return 'Es wird geprüft, ob das Ziel oder die Warteschlange aktuell voll bzw. besetzt ist.';
        return 'Es wird eine Regel geprüft: „' + c + '“.';
      }

      const steps = [];
      if (snap.entryDnisNumbers && snap.entryDnisNumbers.length) {
        steps.push('Anrufer erreichen diesen Einstieg über: ' + snap.entryDnisNumbers.slice(0, 4).join(', ') + '.');
      } else if (inc.length) {
        steps.push('Der Anruf kommt von ' + inc.slice(0, 3).map(c => c.fromLabel || c.fromScriptNumber).join(', ') + ' hier an.');
      }
      if (sched) steps.push('Es gelten feste Zeiten: ' + sched + (snap.hasHolidayCheck ? ' (inkl. Feiertagsprüfung)' : '') + '.');
      else if (snap.hasHolidayCheck) steps.push('Es wird automatisch geprüft, ob heute ein Feiertag ist.');
      if (snap.condition) steps.push(translateConditionFallback(snap.condition));
      if (snap.announcement) steps.push('Der Anrufer hört die Sprachansage „' + snap.announcement + '“.');
      if (snap.queueTarget) steps.push('Der Anruf wird an das Team „' + snap.queueTarget + '“ übergeben.');
      if (out.length) {
        steps.push(out.length === 1
          ? 'Danach geht der Anruf weiter zu ' + out[0].toTargetNumber + '.'
          : 'Danach verzweigt der Anruf auf ' + out.length + ' Ziele (' + out.slice(0, 3).map(c => c.toTargetNumber).join(', ') + ').');
      } else if (rules.length) {
        steps.push('Intern enthält dieses Modul ' + rules.length + ' nacheinander geprüfte Ablaufregeln.');
      }
      if (!steps.length) {
        steps.push('Dieser Baustein verarbeitet den Anruf gemäß seiner Konfiguration.');
      }

      const plainFacts = [];
      if (snap.organizationName) plainFacts.push({ label: 'Bereich / Organisation', value: snap.organizationName });
      if (sched) plainFacts.push({ label: 'Erreichbarkeit / Zeiten', value: sched });
      if (snap.queueTarget) plainFacts.push({ label: 'Zuständiges Team', value: snap.queueTarget });
      if (snap.announcement) plainFacts.push({ label: 'Gesprochene Ansage', value: snap.announcement });
      if (rules.length) plainFacts.push({ label: 'Hinterlegte Regeln', value: rules.length + ' Ablaufschritte' });
      if (!plainFacts.length && nObj) {
        plainFacts.push({ label: 'Einbindung im Ablauf', value: nObj.inDegree + ' Zugänge · ' + nObj.outDegree + ' Ausgänge' });
      }

      const techSummary = 'Typ: ' + bt + ' · Modus: ' + (snap.mode || 'element') +
        (nObj ? ' · Rolle: ' + nObj.role + ' (' + nObj.inDegree + ' ein / ' + nObj.outDegree + ' aus)' : '');

      return {
        archetypeLabel,
        shortTagline,
        whatIsIt,
        whatHappensSteps: steps,
        plainFacts,
        technicalSummary: techSummary,
      };
    }

    function resolveNodeInfoSnapshot(nodeId) {
      const activeView = viewsByKey.get(activeViewKey);
      if (activeView && activeView.nodeDetails && activeView.nodeDetails[nodeId]) {
        return activeView.nodeDetails[nodeId];
      }
      const nObj = nodeMap.get(nodeId);
      const dt = PAYLOAD.drillTargetsByNodeId ? PAYLOAD.drillTargetsByNodeId[nodeId] : null;
      const incoming = GRAPH.edges.filter(e => e.to === nodeId).map(e => {
        const src = nodeMap.get(e.from);
        return { fromScriptNumber: e.from, fromLabel: src ? src.label : e.from, edgeLabel: e.label || '' };
      });
      const outgoing = GRAPH.edges.filter(e => e.from === nodeId).map((e, i) => {
        const dst = nodeMap.get(e.to);
        return { id: 'e-' + i, toTargetNumber: dst ? dst.label : e.to, label: e.label || '', kind: 'rule-target' };
      });
      return {
        nodeId,
        mode: 'raw-mermaid',
        scriptNumber: dt ? dt.scriptRef : (activeView && activeView.scriptNumber ? activeView.scriptNumber : nodeId),
        title: nObj ? nObj.label : nodeId,
        blockType: 'script',
        canJumpToDetailScript: Boolean(dt && viewsByKey.has(dt.viewKey)),
        detailTargetScriptNumber: dt ? dt.scriptRef : undefined,
        incomingConnections: incoming,
        outgoingConnections: outgoing,
        moduleRulesPreview: [],
        specialParameters: [],
        relatedFindings: [],
      };
    }

    function openNodeInfoModal(nodeId, preserveHistory = false) {
      if (!nodeId) return;
      if (!preserveHistory) {
        infoModalHistory = [];
        // Confirmed default: Layperson view first on fresh open, IT-Profi / Original-Skript in 1 click
        activeInfoModalMode = 'layperson';
      }
      activeInfoModalNodeId = nodeId;
      const overlay = document.getElementById('node-info-modal-overlay');
      if (!overlay) return;
      overlay.style.display = 'flex';
      // Ensure selected node is highlighted and smoothly centered beside the right-docked panel
      selectNode(nodeId, false);
      renderNodeInfoModal();
      requestAnimationFrame(() => focusNodeCamera(nodeId));
    }

    function closeNodeInfoModal() {
      const overlay = document.getElementById('node-info-modal-overlay');
      if (overlay) overlay.style.display = 'none';
      activeInfoModalNodeId = '';
      infoModalHistory = [];
    }

    function navigateNodeInfoInPlace(ref, lbl) {
      const cleanRef = (ref || '').trim();
      const cleanLbl = (lbl || '').trim();
      if (!cleanRef && !cleanLbl) return;

      const currentSnap = activeInfoModalNodeId ? resolveNodeInfoSnapshot(activeInfoModalNodeId) : null;
      const pushHistory = () => {
        if (!activeInfoModalNodeId) return;
        infoModalHistory.push({
          viewKey: activeViewKey,
          nodeId: activeInfoModalNodeId,
          title: (currentSnap && currentSnap.title) ? currentSnap.title : activeInfoModalNodeId
        });
      };

      let targetId = '';
      if (cleanRef && nodeMap.has(cleanRef)) {
        targetId = cleanRef;
      } else {
        const refLower = cleanRef.toLowerCase();
        const lblLower = cleanLbl.toLowerCase();
        const matchByLabel = GRAPH.nodes.find(n =>
          (refLower && n.id.toLowerCase() === refLower) ||
          (refLower && n.label.toLowerCase().includes(refLower)) ||
          (lblLower && n.label.toLowerCase() === lblLower)
        );
        if (matchByLabel) targetId = matchByLabel.id;
      }

      if (targetId) {
        if (targetId !== activeInfoModalNodeId) {
          pushHistory();
        }
        // Make sure hidden node-type filter does not conceal the target
        const svgNode = Array.from(stage.querySelectorAll('g.node, g.actor, g.statediagram-state')).find(g => resolveNodeId(g) === targetId);
        if (svgNode) {
          const nt = svgNode.getAttribute('data-node-type');
          if (nt && hiddenNodeTypes.has(nt)) {
            hiddenNodeTypes.delete(nt);
            syncFilterBadge();
            renderNodeTypeFilters();
          }
        }
        activeInfoModalNodeId = targetId;
        selectNode(targetId, false);
        renderNodeInfoModal();
        requestAnimationFrame(() => focusNodeCamera(targetId));
        return;
      }

      if (cleanRef) {
        const vk = PAYLOAD.viewKeyByScriptNumber
          ? (PAYLOAD.viewKeyByScriptNumber[cleanRef] || PAYLOAD.viewKeyByScriptNumber[cleanRef.toLowerCase()])
          : '';
        if (vk && viewsByKey.has(vk)) {
          pushHistory();
          const nextNodeId = jumpToScriptOrNode(cleanRef, cleanLbl, true);
          if (nextNodeId) {
            activeInfoModalNodeId = nextNodeId;
            renderNodeInfoModal();
          }
        }
      }
    }

    function goBackNodeInfoHistory() {
      if (!infoModalHistory.length) return;
      const prev = infoModalHistory.pop();
      if (!prev || !prev.nodeId) return;
      if (prev.viewKey && prev.viewKey !== activeViewKey && viewsByKey.has(prev.viewKey)) {
        switchView(prev.viewKey);
      }
      activeInfoModalNodeId = prev.nodeId;
      selectNode(prev.nodeId, false);
      renderNodeInfoModal();
      requestAnimationFrame(() => focusNodeCamera(prev.nodeId));
    }

    function wireInfoConnectionButtons(container) {
      container.querySelectorAll('.info-conn-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const ref = (btn.getAttribute('data-ref') || '').trim();
          const lbl = (btn.getAttribute('data-label') || '').trim();
          if (!ref && !lbl) return;
          navigateNodeInfoInPlace(ref, lbl);
        });
      });
    }

    function renderNodeInfoModal() {
      const overlay = document.getElementById('node-info-modal-overlay');
      if (!overlay || !activeInfoModalNodeId) return;
      const snap = resolveNodeInfoSnapshot(activeInfoModalNodeId);
      const exp = snap.explanation || buildFallbackExplanation(snap);
      const titleEl = document.getElementById('node-info-title');
      const subtitleEl = document.getElementById('node-info-subtitle');
      const modeHintEl = document.getElementById('node-info-mode-hint');
      const bodyEl = document.getElementById('node-info-body');
      const backBtn = document.getElementById('btn-node-info-back');
      const jumpBtn = document.getElementById('btn-node-info-jump');
      const schedBtn = document.getElementById('btn-node-info-schedules');

      if (backBtn) {
        if (infoModalHistory.length > 0) {
          const prevEntry = infoModalHistory[infoModalHistory.length - 1];
          backBtn.style.display = 'inline-flex';
          backBtn.title = prevEntry && prevEntry.title ? ('Zurück zu: ' + prevEntry.title) : 'Zum vorherigen Knoten';
        } else {
          backBtn.style.display = 'none';
        }
      }
      if (bodyEl) bodyEl.scrollTop = 0;

      if (titleEl) titleEl.textContent = snap.title || snap.nodeId;
      if (subtitleEl) {
        const metaParts = [exp.archetypeLabel || 'Element'];
        if (snap.scriptNumber && snap.mode !== 'raw-mermaid') metaParts.push('Skript [' + snap.scriptNumber + ']');
        if (snap.prio !== undefined && snap.prio !== null) metaParts.push('Prio ' + snap.prio);
        if (snap.organizationName) metaParts.push(snap.organizationName);
        subtitleEl.textContent = metaParts.join(' · ');
      }
      if (modeHintEl) {
        modeHintEl.textContent = activeInfoModalMode === 'layperson'
          ? 'Verständlich erklärt für Fachbereich & Projekt'
          : activeInfoModalMode === 'script'
          ? 'Vollständiger Skript-Quelltext mit markierter Knoten-Stelle'
          : 'Technische Kennwerte, Regeln & Parameter';
      }

      const targetScriptRef = snap.detailTargetScriptNumber || (snap.canJumpToDetailScript ? snap.scriptNumber : '');
      const targetViewKey = targetScriptRef && PAYLOAD.viewKeyByScriptNumber
        ? (PAYLOAD.viewKeyByScriptNumber[targetScriptRef] || PAYLOAD.viewKeyByScriptNumber[String(targetScriptRef).toLowerCase()])
        : '';
      const canJump = Boolean(targetViewKey && viewsByKey.has(targetViewKey) && targetViewKey !== activeViewKey);
      if (jumpBtn) {
        jumpBtn.style.display = canJump ? 'inline-flex' : 'none';
        jumpBtn.textContent = 'Detail-Skript [' + targetScriptRef + '] öffnen →';
        jumpBtn.onclick = () => {
          closeNodeInfoModal();
          switchView(targetViewKey);
        };
      }
      if (schedBtn) {
        const hasSchedRows = Boolean(PAYLOAD.analysis && PAYLOAD.analysis.scheduleRows && PAYLOAD.analysis.scheduleRows.length > 0);
        schedBtn.style.display = hasSchedRows ? 'inline-flex' : 'none';
        schedBtn.onclick = () => {
          const q = snap.scriptNumber || '';
          closeNodeInfoModal();
          openSchedulesModal(q);
        };
      }

      document.querySelectorAll('#node-info-tabs .audience-btn').forEach(btn => {
        const modeVal = btn.getAttribute('data-nmode');
        const isAct = modeVal === activeInfoModalMode;
        btn.classList.toggle('active-layperson', isAct && modeVal === 'layperson');
        btn.classList.toggle('active-pro', isAct && modeVal === 'pro');
        btn.classList.toggle('active-script', isAct && modeVal === 'script');
        btn.setAttribute('aria-selected', isAct ? 'true' : 'false');
      });

      if (!bodyEl) return;

      function resolveFullScriptForSnap(sObj) {
        if (!PAYLOAD.includeOriginalScripts) return '';
        const map = PAYLOAD.rawScriptsByNumber;
        if (map && sObj && sObj.scriptNumber) {
          const rawKey = String(sObj.scriptNumber).trim();
          if (map[rawKey]) return map[rawKey];
          const lower = rawKey.toLowerCase();
          const stripped = lower.replace(/^s_/, '').replace(/\.s$/i, '');
          const keys = Object.keys(map);
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const kl = k.toLowerCase();
            if (kl === lower || kl.replace(/^s_/, '').replace(/\.s$/i, '') === stripped) {
              return map[k];
            }
          }
        }
        return (sObj && sObj.rawLineSnippet) ? String(sObj.rawLineSnippet) : '';
      }

      const inc = snap.incomingConnections || [];
      const out = snap.outgoingConnections || [];

      if (activeInfoModalMode === 'layperson') {
        let html = '';
        html += '<div class="layperson-hero">' +
          '<div class="layperson-hero-head">' +
            '<span class="layperson-hero-title">Wofür ist dieses Bauteil?</span>' +
            '<span class="layperson-hero-tagline">' + esc(exp.shortTagline || '') + '</span>' +
          '</div>' +
          '<p class="layperson-prose">' + esc(exp.whatIsIt || '') + '</p>' +
        '</div>';

        const steps = exp.whatHappensSteps || [];
        if (steps.length) {
          html += '<div>' +
            '<div class="section-title">Was passiert hier mit dem Anrufer?</div>' +
            '<ol class="layperson-steps">' +
              steps.map((s, idx) =>
                '<li><span class="layperson-step-num">' + (idx + 1) + '</span><span>' + esc(s) + '</span></li>'
              ).join('') +
            '</ol>' +
          '</div>';
        }

        const plainFacts = exp.plainFacts || [];
        if (plainFacts.length) {
          html += '<div>' +
            '<div class="section-title">Wichtige Eckdaten im Klartext</div>' +
            '<div class="facts-grid">' +
              plainFacts.map(f =>
                '<div class="fact-cell"><div class="fact-label">' + esc(f.label) + '</div><div class="fact-value">' + esc(f.value) + '</div></div>'
              ).join('') +
            '</div>' +
          '</div>';
        }

        const friendlyMap = exp.friendlyTargetLabels || {};
        html += '<div class="facts-grid">' +
          '<div><div class="section-title">Woher kommt der Anrufer? (' + inc.length + ')</div>' +
            (inc.length
              ? inc.map(c => {
                  const refKey = String(c.fromScriptNumber || '').trim();
                  const displayFrom = (refKey && friendlyMap[refKey]) || c.fromLabel || c.fromScriptNumber;
                  return '<button type="button" class="node-chip info-conn-btn" data-ref="' + esc(c.fromScriptNumber) + '" data-label="' + esc(c.fromLabel) + '">' +
                    '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">← ' + esc(displayFrom) + '</span>' +
                    '<span class="badge">' + esc(c.edgeLabel || 'Zeigen') + '</span>' +
                  '</button>';
                }).join('')
              : '<div class="muted-note">Startpunkt oder kein vorgeschaltetes Element in dieser Ansicht.</div>') +
          '</div>' +
          '<div><div class="section-title">Wohin geht es danach? (' + out.length + ')</div>' +
            (out.length
              ? out.map(c => {
                  const refKey = String(c.toTargetNumber || '').trim();
                  const displayTo = (refKey && friendlyMap[refKey]) || c.toTargetNumber;
                  return '<button type="button" class="node-chip info-conn-btn" data-ref="' + esc(c.toTargetNumber) + '" data-label="' + esc(displayTo) + '">' +
                    '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">→ ' + esc(displayTo) + '</span>' +
                    '<span class="badge">' + esc(c.label || 'Weiter') + '</span>' +
                  '</button>';
                }).join('')
              : '<div class="muted-note">Kein weiterer Folgeschritt in dieser Ansicht.</div>') +
          '</div>' +
        '</div>';

        html += '<div style="display:flex;justify-content:flex-start;padding-top:4px;">' +
          '<button type="button" id="btn-inline-switch-pro" style="font-size:11.5px;padding:6px 11px;">Technische Details (IT-Profi) anzeigen →</button>' +
        '</div>';

        bodyEl.innerHTML = html;
        wireInfoConnectionButtons(bodyEl);
        const switchProBtn = document.getElementById('btn-inline-switch-pro');
        if (switchProBtn) {
          switchProBtn.addEventListener('click', () => {
            activeInfoModalMode = 'pro';
            renderNodeInfoModal();
          });
        }
      } else if (activeInfoModalMode === 'pro') {
        // IT-PROFI VIEW
        const nObj = nodeMap.get(snap.nodeId);
        const facts = [];
        const schedText = snap.resolvedScheduleDisplay || snap.schedule || '';
        facts.push({
          label: 'Öffnungszeiten / SondZeit',
          value: (schedText || 'Kein Zeitprofil (24/7 oder geerbt)') + (snap.hasHolidayCheck ? ' · Feiertagsprüfung aktiv' : ''),
          mono: true,
        });
        facts.push({
          label: 'DNIS / Direktruf',
          value: (snap.entryDnisNumbers && snap.entryDnisNumbers.length) ? snap.entryDnisNumbers.join(', ') : '—',
          mono: true,
        });
        facts.push({ label: 'Skillset / Queue', value: snap.queueTarget || '—', mono: true });
        facts.push({
          label: 'Ansage / Treatment / Wait / HDX',
          value: [
            snap.announcement || snap.treatmentInfo || '',
            snap.waitSeconds !== undefined && snap.waitSeconds !== null ? 'WAIT ' + snap.waitSeconds + 's' : '',
            snap.hdxAction ? 'HDX ' + snap.hdxAction : '',
          ].filter(Boolean).join(' · ') || '—',
          mono: true,
        });
        if (snap.condition) {
          facts.push({ label: 'Bedingung / IF-Ausdruck', value: snap.condition, mono: true });
        }
        if (snap.cdnAlias) {
          facts.push({ label: 'CDN / Alias', value: snap.cdnAlias, mono: true });
        }

        let html = '';
        html += '<div class="tech-meta-strip">' +
          '<strong style="color:var(--accent-text);">Node-ID: ' + esc(snap.nodeId) + '</strong>' +
          ' · ' + esc(exp.technicalSummary || (nObj ? ('Rolle: ' + nObj.role + ' (' + nObj.inDegree + ' ein / ' + nObj.outDegree + ' aus)') : '')) +
        '</div>';

        html += '<div><div class="section-title">Technische Konfiguration &amp; Schnittstellen</div><div class="facts-grid">' +
          facts.map(f =>
            '<div class="fact-cell"><div class="fact-label">' + esc(f.label) + '</div><div class="fact-value' + (f.mono ? ' mono' : '') + '">' + esc(f.value) + '</div></div>'
          ).join('') +
        '</div></div>';

        html += '<div class="facts-grid">' +
          '<div><div class="section-title">Eingehende Referenzen (' + inc.length + ')</div>' +
            (inc.length
              ? inc.map(c =>
                  '<button type="button" class="node-chip info-conn-btn" data-ref="' + esc(c.fromScriptNumber) + '" data-label="' + esc(c.fromLabel) + '">' +
                    '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">← ' + esc(c.fromLabel || c.fromScriptNumber) + '</span>' +
                    '<span class="badge">' + esc(c.edgeLabel || 'Aufruf') + '</span>' +
                  '</button>'
                ).join('')
              : '<div class="muted-note">Keine eingehenden Referenzen.</div>') +
          '</div>' +
          '<div><div class="section-title">Ausgehende Ziele (' + out.length + ')</div>' +
            (out.length
              ? out.map(c =>
                  '<button type="button" class="node-chip info-conn-btn" data-ref="' + esc(c.toTargetNumber) + '" data-label="' + esc(c.toTargetNumber) + '">' +
                    '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">→ ' + esc(c.toTargetNumber) + '</span>' +
                    '<span class="badge">' + esc(c.label || 'Weiter') + '</span>' +
                  '</button>'
                ).join('')
              : '<div class="muted-note">Keine ausgehenden Weiterleitungen.</div>') +
          '</div>' +
        '</div>';

        const rules = snap.moduleRulesPreview || [];
        if (rules.length) {
          html += '<div><div class="section-title">Prioritäts-Regeln &amp; Zeitpläne (' + rules.length + ')</div>' +
            '<div class="an-table-wrap" style="max-height:240px;">' +
              '<table class="an-table"><thead><tr><th>Prio</th><th>Schritt</th><th>Zeit / Feiertag</th><th>Bedingung</th><th>Ziel / Aktion</th></tr></thead><tbody>' +
              rules.map(r => {
                const actionParts = [];
                if (r.targetNumber) actionParts.push('→ ' + r.targetNumber);
                if (r.queueTarget) actionParts.push('Queue: ' + r.queueTarget);
                if (r.announcement) actionParts.push('Ansage: ' + r.announcement);
                if (r.choicesCount > 0) actionParts.push(r.choicesCount + ' Optionen');
                return '<tr>' +
                  '<td><strong>P' + esc(r.prio) + '</strong></td>' +
                  '<td>' + esc(r.stepName) + '</td>' +
                  '<td style="font-family:ui-monospace,monospace;color:var(--accent-text);">' + esc([r.schedule, r.holiday].filter(Boolean).join(' · ') || '—') + '</td>' +
                  '<td style="font-family:ui-monospace,monospace;">' + esc(r.condition || '—') + '</td>' +
                  '<td style="font-family:ui-monospace,monospace;">' + esc(actionParts.join(' · ') || '—') + '</td>' +
                '</tr>';
              }).join('') +
              '</tbody></table>' +
            '</div></div>';
        }

        const params = snap.specialParameters || [];
        if (params.length) {
          html += '<div><div class="section-title">Avaya-Sonderparameter (' + params.length + ')</div><div style="display:flex;flex-direction:column;gap:5px;">' +
            params.map(p =>
              '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);font-size:11.5px;">' +
                '<span><strong>' + esc(p.label) + '</strong> <span style="font-family:monospace;color:var(--text-muted);font-size:10.5px;">(' + esc(p.key) + ')</span></span>' +
                '<span style="font-family:ui-monospace,monospace;font-weight:600;color:var(--accent-text);white-space:nowrap;font-variant-numeric:tabular-nums;">' + esc(p.value) + '</span>' +
              '</div>'
            ).join('') +
          '</div></div>';
        }

        const findings = snap.relatedFindings || [];
        if (findings.length) {
          html += '<div><div class="section-title">Prüfhinweise (' + findings.length + ')</div><div style="display:flex;flex-direction:column;gap:6px;">' +
            findings.map(f => {
              const sevTxt = f.severity === 'error' ? 'Fehler' : (f.severity === 'warning' ? 'Warnung' : 'Hinweis');
              return '<div class="an-item ' + (f.severity === 'error' ? 'sev-error' : f.severity === 'warning' ? 'sev-warning' : '') + '">' +
                '<div class="an-item-title" style="display:flex;justify-content:space-between;gap:8px;"><span>' + esc(f.title) + '</span><span style="font-family:ui-monospace,monospace;font-size:10.5px;opacity:0.85;">' + sevTxt + '</span></div>' +
                (f.recommendation ? '<div class="an-item-desc">' + esc(f.recommendation) + '</div>' : '') +
              '</div>';
            }).join('') +
          '</div></div>';
        }

        const resolvedRawForPro = resolveFullScriptForSnap(snap);
        if (PAYLOAD.includeOriginalScripts && resolvedRawForPro) {
          html += '<div style="display:flex;justify-content:flex-start;padding-top:4px;">' +
            '<button type="button" id="btn-inline-switch-script" style="font-size:11.5px;padding:6px 11px;">Im Original-Skript prüfen →</button>' +
          '</div>';
        }

        bodyEl.innerHTML = html;
        wireInfoConnectionButtons(bodyEl);
        const switchScriptBtn = document.getElementById('btn-inline-switch-script');
        if (switchScriptBtn) {
          switchScriptBtn.addEventListener('click', () => {
            activeInfoModalMode = 'script';
            renderNodeInfoModal();
          });
        }
      }

      if (activeInfoModalMode === 'script') {
        const rawText = resolveFullScriptForSnap(snap);
        if (!rawText || !rawText.trim()) {
          bodyEl.innerHTML =
            '<div class="script-panel"><div class="script-empty">' +
              '<div style="font-weight:600;color:var(--text-main);margin-bottom:4px;">Kein Original-Skript hinterlegt</div>' +
              'Für dieses Element liegt kein eingelesener .s-Quelltext vor (z. B. externes Ziel oder manuelles Diagramm-Element).' +
            '</div></div>';
          return;
        }
        const scriptLines = rawText.replace(/\\r\\n?/g, '\\n').split('\\n');
        const hlStart = snap.highlightStartLine ? Number(snap.highlightStartLine) : 0;
        const hlEnd = hlStart > 0 ? Math.max(hlStart, Number(snap.highlightEndLine || hlStart)) : 0;
        const hlText = hlStart > 0
          ? (hlEnd > hlStart ? 'Zeilen ' + hlStart + '–' + hlEnd : 'Zeile ' + hlStart)
          : '';

        bodyEl.innerHTML =
          '<div class="script-panel">' +
            '<div class="script-toolbar">' +
              '<div class="script-toolbar-top">' +
                '<div class="script-meta">' +
                  '<strong>' + esc(snap.scriptNumber ? 'Skript ' + snap.scriptNumber : 'Original-Quelltext') + '</strong>' +
                  '<span>·</span><span>' + scriptLines.length + ' Zeilen</span>' +
                  (hlText ? '<span>·</span><span class="script-meta-hl">Knoten-Stelle: ' + esc(hlText) + '</span>' : '') +
                '</div>' +
                '<div class="script-actions">' +
                  (hlStart > 0 ? '<button type="button" id="btn-script-jump-hl" class="copy-snippet-btn" title="Zur markierten Knoten-Zeile springen">Zur Knoten-Stelle</button>' : '') +
                  '<button type="button" id="btn-script-copy-all" class="copy-snippet-btn">Skript kopieren</button>' +
                '</div>' +
              '</div>' +
              '<div class="script-search-row">' +
                '<input type="text" id="script-modal-search" class="script-search-input" placeholder="Im Original-Skript suchen (z. B. GIVE RAN, QUEUE, IF, Rufnummer)…" />' +
                '<div class="script-search-nav" id="script-search-nav" style="display:none;">' +
                  '<span class="script-search-count" id="script-search-count">0 Treffer</span>' +
                  '<button type="button" id="btn-script-prev" class="copy-snippet-btn" title="Vorheriger Treffer (Shift+Enter)">↑</button>' +
                  '<button type="button" id="btn-script-next" class="copy-snippet-btn" title="Nächster Treffer (Enter)">↓</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="script-viewer" id="script-modal-viewer"></div>' +
          '</div>';

        const viewerEl = document.getElementById('script-modal-viewer');
        const searchInput = document.getElementById('script-modal-search');
        const navWrap = document.getElementById('script-search-nav');
        const countEl = document.getElementById('script-search-count');
        const btnPrev = document.getElementById('btn-script-prev');
        const btnNext = document.getElementById('btn-script-next');
        const btnJumpHl = document.getElementById('btn-script-jump-hl');
        const btnCopyAll = document.getElementById('btn-script-copy-all');

        let matchLines = [];
        let activeMatchIdx = 0;

        function highlightQueryHtml(lineStr, q) {
          if (!q) return esc(lineStr || ' ');
          const lower = lineStr.toLowerCase();
          const qLower = q.toLowerCase();
          let out = '';
          let cur = 0;
          let pos = lower.indexOf(qLower, cur);
          while (pos !== -1) {
            if (pos > cur) out += esc(lineStr.slice(cur, pos));
            out += '<mark class="script-mark">' + esc(lineStr.slice(pos, pos + q.length)) + '</mark>';
            cur = pos + q.length;
            pos = lower.indexOf(qLower, cur);
          }
          if (cur < lineStr.length) out += esc(lineStr.slice(cur));
          return out || ' ';
        }

        function renderScriptLines(scrollTarget) {
          if (!viewerEl) return;
          const q = searchInput ? searchInput.value.trim() : '';
          matchLines = [];
          if (q) {
            const qLower = q.toLowerCase();
            for (let i = 0; i < scriptLines.length; i++) {
              if (scriptLines[i].toLowerCase().includes(qLower)) matchLines.push(i + 1);
            }
          }
          const activeLineNo = matchLines.length > 0
            ? matchLines[((activeMatchIdx % matchLines.length) + matchLines.length) % matchLines.length]
            : 0;
          if (navWrap) navWrap.style.display = q ? 'inline-flex' : 'none';
          if (countEl) {
            countEl.textContent = matchLines.length > 0
              ? ((((activeMatchIdx % matchLines.length) + matchLines.length) % matchLines.length) + 1) + ' / ' + matchLines.length
              : '0 Treffer';
          }
          const matchSet = new Set(matchLines);
          let linesHtml = '';
          for (let i = 0; i < scriptLines.length; i++) {
            const ln = i + 1;
            const isHl = hlStart > 0 && ln >= hlStart && ln <= hlEnd;
            const isFirstHl = hlStart > 0 && ln === hlStart;
            const isAct = activeLineNo === ln;
            const isHit = !isAct && matchSet.has(ln);
            const cls = 'script-line' + (isAct ? ' is-search-active' : (isHl ? ' is-node-highlight' : (isHit ? ' is-search-match' : '')));
            linesHtml += '<div class="' + cls + '" data-ln="' + ln + '">' +
              '<span class="script-ln">' + ln + '</span>' +
              '<span class="script-code">' + highlightQueryHtml(scriptLines[i], q) + '</span>' +
              (isFirstHl ? '<span class="script-node-tag">Knoten-Stelle</span>' : '') +
            '</div>';
          }
          viewerEl.innerHTML = linesHtml;
          if (scrollTarget === 'hl' && hlStart > 0) {
            const targetRow = viewerEl.querySelector('.script-line[data-ln="' + hlStart + '"]');
            if (targetRow && targetRow.scrollIntoView) {
              requestAnimationFrame(() => targetRow.scrollIntoView({ block: 'center', behavior: 'auto' }));
            }
          } else if (scrollTarget === 'match' && activeLineNo > 0) {
            const targetRow = viewerEl.querySelector('.script-line[data-ln="' + activeLineNo + '"]');
            if (targetRow && targetRow.scrollIntoView) {
              requestAnimationFrame(() => targetRow.scrollIntoView({ block: 'center', behavior: 'smooth' }));
            }
          }
        }

        renderScriptLines('hl');

        if (searchInput) {
          searchInput.addEventListener('input', () => {
            activeMatchIdx = 0;
            renderScriptLines('match');
          });
          searchInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && matchLines.length > 0) {
              e.preventDefault();
              activeMatchIdx += e.shiftKey ? -1 : 1;
              renderScriptLines('match');
            }
          });
        }
        if (btnPrev) {
          btnPrev.addEventListener('click', () => {
            if (!matchLines.length) return;
            activeMatchIdx -= 1;
            renderScriptLines('match');
          });
        }
        if (btnNext) {
          btnNext.addEventListener('click', () => {
            if (!matchLines.length) return;
            activeMatchIdx += 1;
            renderScriptLines('match');
          });
        }
        if (btnJumpHl && hlStart > 0) {
          btnJumpHl.addEventListener('click', () => {
            const row = viewerEl && viewerEl.querySelector('.script-line[data-ln="' + hlStart + '"]');
            if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
          });
        }
        if (btnCopyAll) {
          btnCopyAll.addEventListener('click', () => {
            const done = () => {
              btnCopyAll.textContent = 'Kopiert';
              setTimeout(() => { btnCopyAll.textContent = 'Skript kopieren'; }, 1600);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(rawText).then(done).catch(() => {});
            } else {
              const ta = document.createElement('textarea');
              ta.value = rawText;
              ta.style.position = 'fixed';
              ta.style.opacity = '0';
              document.body.appendChild(ta);
              ta.select();
              try { document.execCommand('copy'); done(); } catch {}
              document.body.removeChild(ta);
            }
          });
        }
      }
    }

    const btnOpenSchedules = document.getElementById('btn-open-schedules');
    const btnOpenSchedulesCount = document.getElementById('btn-open-schedules-count');
    const schedulesOverlay = document.getElementById('schedules-modal-overlay');
    const btnCloseSchedulesModal = document.getElementById('btn-close-schedules-modal');
    const modalSchedSearch = document.getElementById('modal-sched-search');
    const btnModalCsv = document.getElementById('btn-modal-csv');
    const btnModalXlsx = document.getElementById('btn-modal-xlsx');
    const btnModalMd = document.getElementById('btn-modal-md');
    const btnModalHide247 = document.getElementById('btn-modal-hide-247');

    if (btnOpenSchedulesCount && PAYLOAD.analysis && Array.isArray(PAYLOAD.analysis.scheduleRows)) {
      const schedScriptCount = new Set(PAYLOAD.analysis.scheduleRows.map(r => r.scriptNumber)).size;
      if (schedScriptCount > 0) btnOpenSchedulesCount.textContent = '(' + schedScriptCount + ')';
    }

    if (btnOpenSchedules && schedulesOverlay) {
      btnOpenSchedules.addEventListener('click', () => openSchedulesModal(''));
    }

    if (btnCloseSchedulesModal && schedulesOverlay) {
      btnCloseSchedulesModal.addEventListener('click', () => {
        schedulesOverlay.style.display = 'none';
      });
    }

    if (schedulesOverlay) {
      schedulesOverlay.addEventListener('click', (e) => {
        if (e.target === schedulesOverlay) {
          schedulesOverlay.style.display = 'none';
        }
      });
    }

    document.querySelectorAll('#modal-sched-view-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        schedulesModalView = btn.getAttribute('data-sview') || 'matrix';
        renderSchedulesModalContent();
      });
    });

    document.querySelectorAll('#modal-sched-cats .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        schedulesModalCategory = chip.getAttribute('data-cat') || 'all';
        renderSchedulesModalContent();
      });
    });

    if (btnModalHide247) {
      btnModalHide247.addEventListener('click', () => {
        schedulesModalHide247 = !schedulesModalHide247;
        renderSchedulesModalContent();
      });
    }

    if (modalSchedSearch) {
      modalSchedSearch.addEventListener('input', () => {
        renderSchedulesModalContent();
      });
    }

    if (btnModalMd) {
      btnModalMd.addEventListener('click', () => {
        const bundle = getOpeningHoursBundle();
        const includeAlwaysOpen = !schedulesModalHide247;
        const mdText = bundle
          ? buildOpeningHoursMarkdownFromBundle(bundle, includeAlwaysOpen)
          : '';
        if (!mdText) return;
        const markCopied = () => {
          const orig = btnModalMd.textContent;
          btnModalMd.textContent = 'Kopiert ✓';
          setTimeout(() => { btnModalMd.textContent = orig; }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(mdText).then(markCopied).catch(() => {});
        } else {
          const ta = document.createElement('textarea');
          ta.value = mdText;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); markCopied(); } catch {}
          document.body.removeChild(ta);
        }
      });
    }

    if (btnModalXlsx) {
      btnModalXlsx.addEventListener('click', () => {
        const bundle = getOpeningHoursBundle();
        if (bundle) {
          downloadOpeningHoursXlsxFromBundle(
            bundle,
            !schedulesModalHide247,
            'callflow-oeffnungszeiten.xlsx'
          );
        }
      });
    }

    if (btnModalCsv) {
      btnModalCsv.addEventListener('click', () => {
        const bundle = getOpeningHoursBundle();
        if (bundle) {
          downloadUtf8Csv(
            'callflow-oeffnungszeiten.csv',
            OH_CSV_HEADERS,
            buildOpeningHoursCsvRowsFromBundle(bundle, !schedulesModalHide247)
          );
        } else {
          const rows = getFilteredScheduleRowsForModal();
          downloadUtf8Csv(
            'callflow-oeffnungszeiten.csv',
            SCHEDULE_CSV_HEADERS,
            rows.map(buildScheduleCsvRow)
          );
        }
      });
    }

    // =========================================================================
    // ASSET-INVENTAR MODAL (8 DOMÄNEN + EXCEL 9-BLATT, CSV, JSON)
    // =========================================================================
    const btnOpenInventory = document.getElementById('btn-open-inventory');
    const btnOpenInventoryCount = document.getElementById('btn-open-inventory-count');
    const inventoryOverlay = document.getElementById('inventory-modal-overlay');
    const btnCloseInventoryModal = document.getElementById('btn-close-inventory-modal');
    const invModalSubtitle = document.getElementById('inv-modal-subtitle');
    const modalInvSearch = document.getElementById('modal-inv-search');
    const modalInvCats = document.getElementById('modal-inv-cats');
    const modalInvBody = document.getElementById('modal-inv-body');
    const chkInvExportFiltered = document.getElementById('chk-inv-export-filtered');
    const btnInvCsv = document.getElementById('btn-inv-csv');
    const btnInvJson = document.getElementById('btn-inv-json');
    const btnInvXlsx = document.getElementById('btn-inv-xlsx');

    let invModalCategory = 'all';
    let invModalStatus = 'all';
    let invModalView = 'summary';
    let invModalSearchQuery = '';
    let invModalExportFiltered = false;
    let invModalExpandedId = '';

    function getInventoryBundle() {
      return (PAYLOAD.analysis && PAYLOAD.analysis.inventoryBundle) || null;
    }

    if (btnOpenInventory && getInventoryBundle()) {
      const ib = getInventoryBundle();
      btnOpenInventory.style.display = 'inline-flex';
      if (btnOpenInventoryCount && ib.summary) {
        btnOpenInventoryCount.textContent = '(' + (ib.summary.totalItems || 0) + ')';
      }
    }

    function invStatusBadgeClass(st) {
      if (st === 'missing') return 'inv-status-missing';
      if (st === 'deprecated' || st === 'unused') return 'inv-status-warn';
      if (st === 'deactivated') return 'inv-status-muted';
      return 'inv-status-active';
    }

    function renderInventoryModal() {
      const fullBundle = getInventoryBundle();
      if (!fullBundle || !modalInvBody) return;
      const filtered = invFilterBundle(fullBundle, {
        category: invModalCategory,
        status: invModalStatus,
        searchQuery: invModalSearchQuery,
      });
      const sum = fullBundle.summary || {};
      const fSum = (filtered && filtered.summary) || {};
      if (invModalSubtitle) {
        invModalSubtitle.textContent =
          (fSum.totalItems || 0) + ' / ' + (sum.totalItems || 0) + ' Assets · '
          + (fSum.totalOccurrences || 0) + ' Fundstellen · '
          + (sum.totalScripts || 0) + ' Skripte · '
          + (sum.issueItemCount || 0) + ' Auffälligkeiten';
      }

      document.querySelectorAll('#modal-inv-view-group .seg-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-iview') === invModalView);
      });
      document.querySelectorAll('#modal-inv-status-group .seg-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-istatus') === invModalStatus);
      });

      if (modalInvCats) {
        const catMap = {};
        (fullBundle.categorySummaries || []).forEach(cs => { catMap[cs.category] = cs; });
        const allChips = [{ id: 'all', label: 'Alle', count: sum.totalItems || 0 }];
        INV_CAT_ORDER.forEach(c => {
          const cs = catMap[c];
          allChips.push({
            id: c,
            label: INV_CAT_LABELS[c] || c,
            count: cs ? cs.itemCount : 0,
          });
        });
        modalInvCats.innerHTML = allChips.map(ch =>
          '<button type="button" class="chip' + (invModalCategory === ch.id ? ' active' : '') + '" data-icat="' + esc(ch.id) + '">'
          + esc(ch.label) + ' <span style="font-family:ui-monospace,monospace;opacity:0.8;">' + ch.count + '</span></button>'
        ).join('');
        modalInvCats.querySelectorAll('.chip').forEach(ch => {
          ch.addEventListener('click', () => {
            invModalCategory = ch.getAttribute('data-icat') || 'all';
            invModalExpandedId = '';
            renderInventoryModal();
          });
        });
      }

      if (!filtered) {
        modalInvBody.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text-muted);">Kein Inventar verfügbar.</div>';
        return;
      }

      if (invModalView === 'summary') {
        const items = filtered.items || [];
        if (!items.length) {
          modalInvBody.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text-muted);">Keine Inventar-Einträge für diesen Filter gefunden.</div>';
          return;
        }
        const occByItem = new Map();
        (filtered.occurrences || []).forEach(o => {
          if (!occByItem.has(o.itemId)) occByItem.set(o.itemId, []);
          occByItem.get(o.itemId).push(o);
        });
        const shown = items.slice(0, 400);
        let rowsHtml = '';
        shown.forEach(item => {
          const isExp = invModalExpandedId === item.id;
          const itemOccs = occByItem.get(item.id) || [];
          rowsHtml +=
            '<tr class="inv-row-main" data-itemid="' + esc(item.id) + '" style="cursor:pointer;">'
              + '<td style="white-space:nowrap;font-weight:600;color:var(--text-muted);">' + (isExp ? '▾ ' : '▸ ') + esc(item.categoryLabel) + '</td>'
              + '<td style="white-space:nowrap;">' + esc(item.subTypeLabel) + '</td>'
              + '<td style="font-family:ui-monospace,monospace;font-weight:600;">' + esc(item.name) + '</td>'
              + '<td><span class="inv-status-pill ' + invStatusBadgeClass(item.status) + '">' + esc(item.statusLabel) + '</span></td>'
              + '<td style="font-family:ui-monospace,monospace;text-align:right;font-variant-numeric:tabular-nums;">' + (item.occurrenceCount || 0) + '</td>'
              + '<td style="font-family:ui-monospace,monospace;text-align:right;font-variant-numeric:tabular-nums;">' + (item.scriptCount || 0) + '</td>'
              + '<td style="max-width:260px;color:var(--text-muted);">' + esc(item.scriptsSummary || '—') + '</td>'
              + '<td style="max-width:280px;color:var(--text-muted);">' + esc(item.details || '—') + '</td>'
            + '</tr>';
          if (isExp) {
            rowsHtml +=
              '<tr><td colspan="8" class="inv-detail-cell">'
                + '<div style="font-size:11px;font-weight:600;margin-bottom:6px;color:var(--text-main);">Fundstellen (' + itemOccs.length + '):</div>'
                + (itemOccs.length
                  ? '<div style="display:flex;flex-direction:column;gap:4px;">'
                    + itemOccs.slice(0, 30).map(o =>
                        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg-card);font-size:11px;">'
                          + '<div style="min-width:0;flex:1;">'
                            + '<strong>[' + esc(o.scriptNumber) + '] ' + esc(o.scriptName || '') + '</strong>'
                            + (o.sectionName ? ' · <span style="color:var(--text-muted);">' + esc(o.sectionName) + '</span>' : '')
                            + (o.lineNumber ? ' · Zeile ' + o.lineNumber : '')
                            + (o.contextSnippet ? '<div style="font-family:ui-monospace,monospace;font-size:10.5px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(o.contextSnippet) + '</div>' : '')
                          + '</div>'
                          + '<button type="button" class="btn-inv-jump" data-jscript="' + esc(o.scriptNumber) + '" data-jname="' + esc(item.name) + '" style="padding:2px 8px;font-size:10.5px;">Skript öffnen →</button>'
                        + '</div>'
                      ).join('')
                    + '</div>'
                  : '<div style="font-size:11px;color:var(--text-muted);">Keine einzelnen Fundstellen erfasst.</div>')
              + '</td></tr>';
          }
        });
        modalInvBody.innerHTML =
          '<table class="inv-table"><thead><tr><th>Kategorie</th><th>Typ</th><th>Name / Ziel</th><th>Status</th><th style="text-align:right;">Funde</th><th style="text-align:right;">Skripte</th><th>Verwendet in</th><th>Details</th></tr></thead><tbody>'
          + rowsHtml + '</tbody></table>'
          + (items.length > shown.length ? '<div style="padding:8px 14px;font-size:11px;color:var(--text-muted);border-top:1px solid var(--border);">Zeige ' + shown.length + ' von ' + items.length + ' Einträgen (Export enthält alle).</div>' : '');

        modalInvBody.querySelectorAll('tr.inv-row-main').forEach(tr => {
          tr.addEventListener('click', () => {
            const id = tr.getAttribute('data-itemid') || '';
            invModalExpandedId = invModalExpandedId === id ? '' : id;
            renderInventoryModal();
          });
        });
        modalInvBody.querySelectorAll('.btn-inv-jump').forEach(jb => {
          jb.addEventListener('click', e => {
            e.stopPropagation();
            const sc = jb.getAttribute('data-jscript');
            const nm = jb.getAttribute('data-jname');
            closeInventoryModal();
            if (sc) jumpToScriptOrNode(sc, nm || sc);
          });
        });
      } else {
        const occs = filtered.occurrences || [];
        if (!occs.length) {
          modalInvBody.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text-muted);">Keine Einzelfunde für diesen Filter gefunden.</div>';
          return;
        }
        const shown = occs.slice(0, 450);
        modalInvBody.innerHTML =
          '<table class="inv-table"><thead><tr><th>Kategorie</th><th>Element</th><th>Status</th><th>Skript</th><th>Section / Zeile</th><th>Befehl / Auszug</th><th></th></tr></thead><tbody>'
          + shown.map(o =>
              '<tr class="inv-row-main">'
                + '<td style="white-space:nowrap;color:var(--text-muted);">' + esc(o.categoryLabel) + '</td>'
                + '<td style="font-family:ui-monospace,monospace;font-weight:600;">' + esc(o.itemName) + '</td>'
                + '<td><span class="inv-status-pill ' + invStatusBadgeClass(o.status) + '">' + esc(o.statusLabel) + '</span></td>'
                + '<td style="white-space:nowrap;"><strong>' + esc(o.scriptNumber) + '</strong> ' + esc(o.scriptName || '') + '</td>'
                + '<td style="white-space:nowrap;color:var(--text-muted);">' + esc((o.sectionName || '—') + (o.lineNumber ? ' · Z.' + o.lineNumber : '')) + '</td>'
                + '<td style="font-family:ui-monospace,monospace;font-size:10.5px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(o.contextSnippet || o.command || '') + '">' + esc(o.contextSnippet || o.command || '—') + '</td>'
                + '<td><button type="button" class="btn-inv-jump" data-jscript="' + esc(o.scriptNumber) + '" data-jname="' + esc(o.itemName) + '" style="padding:2px 7px;font-size:10.5px;">→</button></td>'
              + '</tr>'
            ).join('')
          + '</tbody></table>'
          + (occs.length > shown.length ? '<div style="padding:8px 14px;font-size:11px;color:var(--text-muted);border-top:1px solid var(--border);">Zeige ' + shown.length + ' von ' + occs.length + ' Einzelfunden (Export enthält alle).</div>' : '');

        modalInvBody.querySelectorAll('.btn-inv-jump').forEach(jb => {
          jb.addEventListener('click', () => {
            const sc = jb.getAttribute('data-jscript');
            const nm = jb.getAttribute('data-jname');
            closeInventoryModal();
            if (sc) jumpToScriptOrNode(sc, nm || sc);
          });
        });
      }
    }

    function openInventoryModal() {
      if (!inventoryOverlay || !getInventoryBundle()) return;
      inventoryOverlay.style.display = 'flex';
      renderInventoryModal();
      if (modalInvSearch) setTimeout(() => modalInvSearch.focus(), 30);
    }

    function closeInventoryModal() {
      if (inventoryOverlay) inventoryOverlay.style.display = 'none';
    }

    function getInventoryExportBundle() {
      const fullBundle = getInventoryBundle();
      if (!fullBundle) return null;
      if (!invModalExportFiltered) return fullBundle;
      return invFilterBundle(fullBundle, {
        category: invModalCategory,
        status: invModalStatus,
        searchQuery: invModalSearchQuery,
      });
    }

    if (btnOpenInventory) btnOpenInventory.addEventListener('click', openInventoryModal);
    if (btnCloseInventoryModal) btnCloseInventoryModal.addEventListener('click', closeInventoryModal);
    if (inventoryOverlay) {
      inventoryOverlay.addEventListener('click', e => {
        if (e.target === inventoryOverlay) closeInventoryModal();
      });
    }
    document.querySelectorAll('#modal-inv-view-group .seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        invModalView = b.getAttribute('data-iview') || 'summary';
        renderInventoryModal();
      });
    });
    document.querySelectorAll('#modal-inv-status-group .seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        invModalStatus = b.getAttribute('data-istatus') || 'all';
        invModalExpandedId = '';
        renderInventoryModal();
      });
    });
    if (modalInvSearch) {
      modalInvSearch.addEventListener('input', () => {
        invModalSearchQuery = modalInvSearch.value || '';
        renderInventoryModal();
      });
    }
    if (chkInvExportFiltered) {
      chkInvExportFiltered.addEventListener('change', () => {
        invModalExportFiltered = Boolean(chkInvExportFiltered.checked);
      });
    }
    if (btnInvXlsx) {
      btnInvXlsx.addEventListener('click', () => {
        const b = getInventoryExportBundle();
        if (b) downloadInventoryXlsxFromBundle(b, 'Callflow-Inventar.xlsx');
      });
    }
    if (btnInvCsv) {
      btnInvCsv.addEventListener('click', () => {
        const b = getInventoryExportBundle();
        if (b) downloadInventoryCsvFromBundle(b, invModalView === 'occurrences' ? 'occurrences' : 'summary', 'Callflow-Inventar.csv');
      });
    }
    if (btnInvJson) {
      btnInvJson.addEventListener('click', () => {
        const b = getInventoryExportBundle();
        if (b) downloadInventoryJsonFromBundle(b, 'Callflow-Inventar.json');
      });
    }

    const nodeInfoOverlay = document.getElementById('node-info-modal-overlay');
    const btnNodeInfoBack = document.getElementById('btn-node-info-back');
    const btnCloseNodeInfo = document.getElementById('btn-close-node-info');
    const btnCloseNodeInfoFooter = document.getElementById('btn-close-node-info-footer');
    if (btnNodeInfoBack) btnNodeInfoBack.addEventListener('click', goBackNodeInfoHistory);
    if (btnCloseNodeInfo) btnCloseNodeInfo.addEventListener('click', closeNodeInfoModal);
    if (btnCloseNodeInfoFooter) btnCloseNodeInfoFooter.addEventListener('click', closeNodeInfoModal);
    if (nodeInfoOverlay) {
      nodeInfoOverlay.addEventListener('click', e => {
        if (e.target === nodeInfoOverlay) closeNodeInfoModal();
      });
    }
    document.querySelectorAll('#node-info-tabs .audience-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextMode = btn.getAttribute('data-nmode');
        if (nextMode === 'script' && PAYLOAD.includeOriginalScripts) {
          activeInfoModalMode = 'script';
        } else if (nextMode === 'pro') {
          activeInfoModalMode = 'pro';
        } else {
          activeInfoModalMode = 'layperson';
        }
        renderNodeInfoModal();
      });
    });
    window.addEventListener('resize', () => { syncCanvasNodeInfoButton(); });
    const btnDiagramLegend = document.getElementById('btn-diagram-legend');
    const btnCloseDiagramLegend = document.getElementById('btn-close-diagram-legend');
    if (btnDiagramLegend) btnDiagramLegend.addEventListener('click', () => setDiagramLegendOpen(!diagramLegendOpen));
    if (btnCloseDiagramLegend) btnCloseDiagramLegend.addEventListener('click', () => setDiagramLegendOpen(false));

    if (masterDensityGroup) {
      masterDensityGroup.querySelectorAll('.seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const nextDensity = btn.getAttribute('data-density') === 'detailed' ? 'detailed' : 'compact';
          masterDensity = nextDensity;
          const targetKey = getActiveMasterViewKey();
          if (targetKey !== activeViewKey) {
            switchView(targetKey);
          } else {
            syncMasterDensityUi();
          }
        });
      });
    }

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

    if (scriptDropdownBtn && scriptDropdownPopover) {
      scriptDropdownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = scriptDropdownPopover.style.display === 'flex';
        scriptDropdownPopover.style.display = isOpen ? 'none' : 'flex';
        if (!isOpen && scriptDropdownSearch) {
          scriptDropdownSearch.value = '';
          populateViewSelect('');
          setTimeout(() => scriptDropdownSearch.focus(), 50);
        }
      });
    }

    if (scriptDropdownSearch) {
      scriptDropdownSearch.addEventListener('input', () => {
        populateViewSelect();
      });
      scriptDropdownSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          scriptDropdownPopover.style.display = 'none';
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (scriptDropdownWrap && !scriptDropdownWrap.contains(e.target)) {
        if (scriptDropdownPopover) scriptDropdownPopover.style.display = 'none';
      }
    });

    if (masterBackBtn) {
      masterBackBtn.addEventListener('click', () => switchView(getActiveMasterViewKey()));
    }
    if (welcomeHomeBtn) {
      welcomeHomeBtn.addEventListener('click', () => switchView('welcome'));
    }

    document.querySelectorAll('#platform-mode-group .seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setPlatformMode(btn.getAttribute('data-platform') || 'avaya');
      });
    });

    if (genesysModeGroup) {
      genesysModeGroup.querySelectorAll('.seg-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const gm = btn.getAttribute('data-gmode');
          if (gm === 'placeholder') {
            setGenesysProfile('placeholder');
          } else {
            setGenesysProfile(lastStrictHolidayProfile || 'strict-dataAction');
          }
        });
      });
    }
    if (btnGenesysHolidayToggle) {
      btnGenesysHolidayToggle.addEventListener('click', function () {
        if (activeGenesysProfile === 'strict-review') {
          setGenesysProfile('strict-dataAction');
        } else {
          setGenesysProfile('strict-review');
        }
      });
    }
    if (genesysHolidayTargetGroup) {
      genesysHolidayTargetGroup.querySelectorAll('.seg-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const target = btn.getAttribute('data-htarget');
          setGenesysProfile(target === 'dataTable' ? 'strict-dataTable' : 'strict-dataAction');
        });
      });
    }
    if (btnGenesysHolidayMappings && genesysHolidayDrawer) {
      btnGenesysHolidayMappings.addEventListener('click', function () {
        genesysHolidayDrawer.classList.toggle('open');
      });
    }
    if (btnGenesysYamlStatus && genesysValidationDrawer) {
      btnGenesysYamlStatus.addEventListener('click', function () {
        genesysValidationDrawer.classList.toggle('open');
      });
    }
    if (btnGenesysWarnings && genesysWarningsDrawer) {
      btnGenesysWarnings.addEventListener('click', function () {
        genesysWarningsDrawer.classList.toggle('open');
      });
    }
    if (btnGenesysYamlToggle && genesysYamlDrawer) {
      btnGenesysYamlToggle.addEventListener('click', function () {
        genesysYamlDrawer.classList.toggle('open');
      });
    }
    if (genesysPreviewModeGroup) {
      genesysPreviewModeGroup.querySelectorAll('.seg-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          activeGenesysPreviewTab = btn.getAttribute('data-pmode') === 'avaya' ? 'avaya' : 'genesys';
          renderGenesysSubbar();
        });
      });
    }
    if (btnGenesysYamlDownload) {
      btnGenesysYamlDownload.addEventListener('click', function () {
        const v = viewsByKey.get(activeViewKey);
        const variant = getActiveGenesysVariant(v);
        const yamlContent = (variant && variant.archyYaml) || (v && v.genesysArchyYaml) || '';
        const yamlName = (variant && variant.archyFilename) || (v && v.genesysArchyFilename) || 'genesys-flow.yaml';
        if (!yamlContent) return;
        const blob = new Blob([yamlContent], { type: 'application/x-yaml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = yamlName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      });
    }
    if (btnGenesysFlowIrDownload) {
      btnGenesysFlowIrDownload.addEventListener('click', function () {
        const v = viewsByKey.get(activeViewKey);
        const variant = getActiveGenesysVariant(v);
        if (!variant || (!variant.flowIrJson && !variant.flowIR)) return;
        const fname = variant.flowIRFilename || 'flowIR.json';
        let jsonText = '';
        if (variant.flowIrJson) {
          try {
            jsonText = JSON.stringify(JSON.parse(variant.flowIrJson), null, 2);
          } catch {
            jsonText = variant.flowIrJson;
          }
        } else {
          jsonText = JSON.stringify(variant.flowIR, null, 2);
        }
        const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fname.endsWith('.json') ? fname : (fname + '.json');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      });
    }
    if (btnGenesysZipDownload) {
      btnGenesysZipDownload.addEventListener('click', function () {
        const prof = getActiveGenesysProfileSummary();
        if (!prof || !Array.isArray(prof.scripts)) return;
        const hydratedProf = Object.assign({}, prof, {
          scripts: prof.scripts.map(function (s) {
            if (s.archyYaml && (s.flowIrJson || s.flowIR)) return s;
            const sv = s.viewKey ? viewsByKey.get(s.viewKey) : (s.scriptNumber && PAYLOAD.viewKeyByScriptNumber ? viewsByKey.get(PAYLOAD.viewKeyByScriptNumber[s.scriptNumber]) : null);
            const rawVar = sv ? resolveRawGenesysVariantForProfile(sv, activeGenesysProfile) : null;
            if (!rawVar) return s;
            return Object.assign({}, s, {
              archyYaml: s.archyYaml || resolveGenesysText(rawVar.archyYamlKey, rawVar.archyYaml),
              flowIrJson: s.flowIrJson || resolveGenesysText(rawVar.flowIrKey, rawVar.flowIrJson),
              flowIR: s.flowIR || rawVar.flowIR,
            });
          }),
        });
        downloadGenesysAllYamlsZipFromProfile(hydratedProf, 'genesys-archy-flows-' + activeGenesysProfile + '.zip');
      });
    }
    if (btnGenesysYamlCopy) {
      btnGenesysYamlCopy.addEventListener('click', function () {
        const textToCopy = genesysYamlCode ? (genesysYamlCode.textContent || '') : '';
        if (!textToCopy) return;
        const markDone = function () {
          btnGenesysYamlCopy.textContent = 'Kopiert!';
          setTimeout(function () { btnGenesysYamlCopy.textContent = 'Kopieren'; }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(textToCopy).then(markDone).catch(function () {});
        } else {
          const ta = document.createElement('textarea');
          ta.value = textToCopy;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); markDone(); } catch {}
          document.body.removeChild(ta);
        }
      });
    }

    document.querySelectorAll('#pathmode-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#pathmode-group .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        pathColorMode = btn.getAttribute('data-pathmode') || 'semantic';
        const activeSvg = svgLayer.querySelector('svg');
        if (activeSvg && activeViewKey !== 'welcome') {
          if (activePlatformMode !== 'genesys') {
            recolorExportEdges(activeSvg, GRAPH, true);
          }
          viewThemeSigCache.set(getViewCacheKey(activeViewKey), getCurrentThemeSig());
          ensureGpuProxyForView(activeViewKey, activeSvg);
        }
        if (activeNodeId || activeEdge) {
          applyCombinedCanvasState(false);
        } else {
          syncGpuProxyState(false);
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

    // =========================================================================
    // MINIMAP (CRISP VECTOR SVG + FREE CORNER RESIZE + S/M/L PRESETS)
    // =========================================================================
    const mainLayoutEl = document.getElementById('main-layout');
    const minimapBoxEl = document.getElementById('minimap-box');
    const minimapAreaEl = document.getElementById('minimap-area');
    const minimapSvgHostEl = document.getElementById('minimap-svg-host');
    const minimapVpEl = document.getElementById('minimap-viewport');
    const minimapZoomLabelEl = document.getElementById('minimap-zoom-label');
    const minimapResizeHandleEl = document.getElementById('minimap-resize-handle');
    const btnMinimap = document.getElementById('btn-minimap');
    const btnCloseMinimap = document.getElementById('btn-close-minimap');
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    const btnFullscreen = document.getElementById('btn-fullscreen');

    const MINIMAP_PRESETS = {
      sm: { w: 224, h: 158 },
      md: { w: 320, h: 220 },
      lg: { w: 460, h: 310 },
    };
    let minimapOpen = false;
    let minimapDragging = false;
    let minimapResizing = false;
    let minimapResizeStart = { x: 0, y: 0, w: 224, h: 158 };
    let minimapBoxSize = { w: 224, h: 158 };
    let minimapActivePreset = 'sm';
    let minimapRenderedSig = '';
    let minimapDims = { availW: 210, availH: 120, drawW: 210, drawH: 120, offsetX: 0, offsetY: 0, scale: 0.1, svgW: 1200, svgH: 800, hasSvg: false };

    function clampMinimapSize(w, h) {
      const wrapRect = wrap ? wrap.getBoundingClientRect() : { width: 1000, height: 700 };
      const maxW = Math.max(240, Math.min(680, Math.round((wrapRect.width || 1000) * 0.72)));
      const maxH = Math.max(170, Math.min(520, Math.round((wrapRect.height || 700) * 0.68)));
      return {
        w: Math.max(176, Math.min(maxW, Math.round(w))),
        h: Math.max(124, Math.min(maxH, Math.round(h))),
      };
    }

    function applyMinimapBoxSize(presetKey) {
      if (!minimapBoxEl) return;
      minimapBoxSize = clampMinimapSize(minimapBoxSize.w, minimapBoxSize.h);
      minimapBoxEl.style.width = minimapBoxSize.w + 'px';
      minimapBoxEl.style.height = minimapBoxSize.h + 'px';
      if (presetKey !== undefined) minimapActivePreset = presetKey;
      minimapBoxEl.querySelectorAll('.minimap-size-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-msize') === minimapActivePreset);
      });
      updateMinimapViewport();
    }

    function renderMinimapSvg(forceRefresh) {
      if (!minimapSvgHostEl) return;
      const activeSvg = svgLayer ? svgLayer.querySelector('svg') : null;
      const sig = getViewCacheKey(activeViewKey) + '|' + getCurrentThemeSig() + '|' + (activeSvg ? 'svg' : 'none');
      if (!forceRefresh && minimapRenderedSig === sig && minimapSvgHostEl.childNodes.length > 0) {
        updateMinimapViewport();
        return;
      }
      minimapRenderedSig = sig;
      minimapSvgHostEl.replaceChildren();
      if (!activeSvg || activeViewKey === 'welcome') {
        const empty = document.createElement('div');
        empty.className = 'minimap-empty';
        empty.textContent = 'Diagramm-Ansicht wählen für Live-Übersicht';
        minimapSvgHostEl.appendChild(empty);
        updateMinimapViewport();
        return;
      }
      try {
        const w = Math.max(100, parseFloat(activeSvg.getAttribute('width') || '1200'));
        const h = Math.max(100, parseFloat(activeSvg.getAttribute('height') || '800'));
        const clone = activeSvg.cloneNode(true);
        const existingVb = activeSvg.getAttribute('viewBox');
        clone.setAttribute('viewBox', existingVb || ('0 0 ' + w + ' ' + h));
        clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        clone.removeAttribute('width');
        clone.removeAttribute('height');
        clone.removeAttribute('id');
        clone.style.width = '100%';
        clone.style.height = '100%';
        clone.style.maxWidth = 'none';
        clone.style.maxHeight = 'none';
        clone.style.pointerEvents = 'none';
        minimapSvgHostEl.appendChild(clone);
      } catch {
        const fallback = document.createElement('div');
        fallback.className = 'minimap-empty';
        fallback.textContent = 'Übersicht wird vorbereitet…';
        minimapSvgHostEl.appendChild(fallback);
      }
      updateMinimapViewport();
    }

    function updateMinimapViewport() {
      if (!minimapOpen || !minimapAreaEl || !minimapVpEl) return;
      const svgEl = svgLayer ? svgLayer.querySelector('svg') : null;
      const safeZoom = Math.max(0.05, zoom);
      if (minimapZoomLabelEl) minimapZoomLabelEl.textContent = 'Minimap · ' + Math.round(safeZoom * 100) + '%';
      if (!svgEl || activeViewKey === 'welcome') {
        minimapDims.hasSvg = false;
        minimapVpEl.style.display = 'none';
        return;
      }
      const svgW = Math.max(100, parseFloat(svgEl.getAttribute('width') || '1200'));
      const svgH = Math.max(100, parseFloat(svgEl.getAttribute('height') || '800'));
      const areaRect = minimapAreaEl.getBoundingClientRect();
      const availW = Math.max(80, areaRect.width || (minimapBoxSize.w - 14));
      const availH = Math.max(60, areaRect.height || (minimapBoxSize.h - 42));
      const scale = Math.min(availW / svgW, availH / svgH);
      const drawW = svgW * scale;
      const drawH = svgH * scale;
      const offsetX = (availW - drawW) / 2;
      const offsetY = (availH - drawH) / 2;
      minimapDims = { availW, availH, drawW, drawH, offsetX, offsetY, scale, svgW, svgH, hasSvg: true };

      const rect = wrap.getBoundingClientRect();
      const visW = Math.max(100, rect.width) / safeZoom;
      const visH = Math.max(100, rect.height) / safeZoom;
      const worldCx = svgW / 2 - panX / safeZoom;
      const worldCy = svgH / 2 - panY / safeZoom;

      const boxW = Math.min(drawW, Math.max(14, visW * scale));
      const boxH = Math.min(drawH, Math.max(10, visH * scale));
      const relL = Math.max(0, Math.min(drawW - boxW, (worldCx - visW / 2) * scale));
      const relT = Math.max(0, Math.min(drawH - boxH, (worldCy - visH / 2) * scale));

      minimapVpEl.style.display = 'block';
      minimapVpEl.style.width = boxW + 'px';
      minimapVpEl.style.height = boxH + 'px';
      minimapVpEl.style.transform = 'translate3d(' + (offsetX + relL) + 'px,' + (offsetY + relT) + 'px,0)';
    }

    function panFromMinimapPoint(clientX, clientY) {
      if (!minimapAreaEl || !minimapDims.hasSvg) return;
      const r = minimapAreaEl.getBoundingClientRect();
      const localX = clientX - r.left - minimapDims.offsetX;
      const localY = clientY - r.top - minimapDims.offsetY;
      const clampedX = Math.max(0, Math.min(minimapDims.drawW, localX));
      const clampedY = Math.max(0, Math.min(minimapDims.drawH, localY));
      const targetWorldX = clampedX / minimapDims.scale;
      const targetWorldY = clampedY / minimapDims.scale;
      const safeZoom = Math.max(0.05, zoom);
      panX = (minimapDims.svgW / 2 - targetWorldX) * safeZoom;
      panY = (minimapDims.svgH / 2 - targetWorldY) * safeZoom;
      updateTransform(true);
    }

    function setMinimapOpen(nextOpen) {
      minimapOpen = Boolean(nextOpen);
      if (minimapBoxEl) minimapBoxEl.classList.toggle('open', minimapOpen);
      if (btnMinimap) btnMinimap.classList.toggle('btn-active', minimapOpen);
      if (minimapOpen) {
        applyMinimapBoxSize(minimapActivePreset);
        renderMinimapSvg(true);
      }
    }

    if (btnMinimap) btnMinimap.addEventListener('click', () => setMinimapOpen(!minimapOpen));
    if (btnCloseMinimap) btnCloseMinimap.addEventListener('click', () => setMinimapOpen(false));
    if (minimapBoxEl) {
      minimapBoxEl.querySelectorAll('.minimap-size-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const key = btn.getAttribute('data-msize') || 'sm';
          const preset = MINIMAP_PRESETS[key] || MINIMAP_PRESETS.sm;
          minimapBoxSize = { w: preset.w, h: preset.h };
          applyMinimapBoxSize(key);
        });
      });
    }
    if (minimapResizeHandleEl) {
      minimapResizeHandleEl.addEventListener('mousedown', e => {
        e.stopPropagation();
        e.preventDefault();
        minimapResizing = true;
        minimapResizeStart = { x: e.clientX, y: e.clientY, w: minimapBoxSize.w, h: minimapBoxSize.h };
      });
    }
    if (minimapAreaEl) {
      minimapAreaEl.addEventListener('mousedown', e => {
        e.stopPropagation();
        e.preventDefault();
        if (!minimapDims.hasSvg) return;
        minimapDragging = true;
        panFromMinimapPoint(e.clientX, e.clientY);
      });
    }
    window.addEventListener('mousemove', e => {
      if (minimapResizing) {
        const dx = minimapResizeStart.x - e.clientX;
        const dy = minimapResizeStart.y - e.clientY;
        minimapBoxSize = { w: minimapResizeStart.w + dx, h: minimapResizeStart.h + dy };
        applyMinimapBoxSize('');
        return;
      }
      if (!minimapDragging) return;
      panFromMinimapPoint(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => {
      if (minimapResizing) {
        minimapResizing = false;
        updateMinimapViewport();
      }
      if (minimapDragging) {
        minimapDragging = false;
        updateTransform(false);
      }
    });
    window.addEventListener('resize', () => {
      if (minimapOpen) applyMinimapBoxSize(minimapActivePreset);
    });

    function toggleSidebar() {
      if (!mainLayoutEl) return;
      const collapsed = mainLayoutEl.classList.toggle('sidebar-collapsed');
      if (btnToggleSidebar) {
        btnToggleSidebar.classList.toggle('btn-active', collapsed);
        btnToggleSidebar.textContent = collapsed ? 'Leiste ein' : 'Leiste';
      }
      setTimeout(() => updateMinimapViewport(), 40);
    }
    if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', toggleSidebar);

    function syncFullscreenBtn() {
      if (!btnFullscreen) return;
      const isFs = Boolean(document.fullscreenElement);
      btnFullscreen.classList.toggle('btn-active', isFs);
      btnFullscreen.textContent = isFs ? 'Vollbild aus' : 'Vollbild';
    }
    function toggleFullscreen() {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } else if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
    if (btnFullscreen) btnFullscreen.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', syncFullscreenBtn);

    // =========================================================================
    // GLOBAL SEARCH ACROSS ALL SCRIPTS (Strg+K)
    // =========================================================================
    const gsearchOverlay = document.getElementById('global-search-modal-overlay');
    const gsearchInput = document.getElementById('gsearch-input');
    const gsearchCatsEl = document.getElementById('gsearch-cats');
    const gsearchResultsEl = document.getElementById('gsearch-results');
    const gsearchCountEl = document.getElementById('gsearch-count');
    const btnGlobalSearch = document.getElementById('btn-global-search');
    const btnCloseGsearch = document.getElementById('btn-close-gsearch');

    const GSEARCH_CAT_LABELS = {
      all: 'Alle',
      script: 'Skripte',
      dnis: 'DNIS',
      queue: 'Queues',
      announcement: 'Ansagen',
      schedule: 'Zeiten',
      api: 'FlixCheck / API',
      cdn: 'CDN',
      node: 'Elemente',
    };

    const GLOBAL_SEARCH_ENTRIES = (() => {
      if (Array.isArray(PAYLOAD.globalSearchIndex) && PAYLOAD.globalSearchIndex.length > 0) {
        return PAYLOAD.globalSearchIndex;
      }
      const fallback = [];
      PAYLOAD.views.forEach(v => {
        if (v.masterViewVariant === 'detailed') return;
        (v.graph && v.graph.nodes ? v.graph.nodes : []).forEach(n => {
          fallback.push({
            id: v.key + ':' + n.id,
            category: 'node',
            title: n.label,
            subtitle: v.label + ' · ' + n.id,
            searchText: (n.label + ' ' + n.id + ' ' + v.label).toLowerCase(),
            viewKey: v.key,
            scriptNumber: v.scriptNumber || undefined,
            nodeId: n.id,
          });
        });
      });
      return fallback;
    })();

    let gsearchActiveCat = 'all';
    let gsearchSelectedIdx = 0;
    let gsearchCurrentList = [];

    function renderGlobalSearchCats() {
      if (!gsearchCatsEl) return;
      const counts = { all: GLOBAL_SEARCH_ENTRIES.length };
      GLOBAL_SEARCH_ENTRIES.forEach(e => {
        counts[e.category] = (counts[e.category] || 0) + 1;
      });
      const order = ['all', 'script', 'dnis', 'queue', 'announcement', 'schedule', 'api', 'cdn', 'node'];
      gsearchCatsEl.innerHTML = '';
      order.forEach(cat => {
        if (cat !== 'all' && !counts[cat]) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip' + (gsearchActiveCat === cat ? ' active' : '');
        btn.innerHTML = escapeHtml(GSEARCH_CAT_LABELS[cat] || cat) + ' <span style="font-family:ui-monospace,monospace;opacity:0.8;">' + (counts[cat] || 0) + '</span>';
        btn.addEventListener('click', () => {
          gsearchActiveCat = cat;
          gsearchSelectedIdx = 0;
          renderGlobalSearchCats();
          renderGlobalSearchResults();
        });
        gsearchCatsEl.appendChild(btn);
      });
    }

    function jumpToGlobalSearchEntry(entry) {
      if (!entry) return;
      closeGlobalSearchModal();
      const targetViewKey =
        (entry.viewKey && viewsByKey.has(entry.viewKey) ? entry.viewKey : null) ||
        (entry.scriptNumber && PAYLOAD.viewKeyByScriptNumber[entry.scriptNumber]) ||
        (activeViewKey === 'welcome' ? getActiveMasterViewKey() : activeViewKey);
      if (targetViewKey && targetViewKey !== activeViewKey) {
        switchView(targetViewKey);
      }
      // Resolve exact nodeId or best matching label in target graph
      let focusId = entry.nodeId && nodeMap.has(entry.nodeId) ? entry.nodeId : null;
      if (!focusId && entry.title) {
        const needle = entry.title.toLowerCase();
        const matched = GRAPH.nodes.find(n => (n.label || '').toLowerCase().includes(needle));
        if (matched) focusId = matched.id;
      }
      if (focusId) {
        selectNode(focusId, true);
      }
    }

    function renderGlobalSearchResults() {
      if (!gsearchResultsEl) return;
      const rawQ = (gsearchInput ? gsearchInput.value : '').trim().toLowerCase();
      const tokens = rawQ ? rawQ.split(/\s+/).filter(Boolean) : [];
      let list = GLOBAL_SEARCH_ENTRIES.filter(e => {
        if (gsearchActiveCat !== 'all' && e.category !== gsearchActiveCat) return false;
        if (tokens.length === 0) return true;
        return tokens.every(t => (e.searchText || '').includes(t));
      });
      if (rawQ) {
        list = list.slice().sort((a, b) => {
          const at = (a.title || '').toLowerCase();
          const bt = (b.title || '').toLowerCase();
          const ar = at === rawQ ? 0 : at.startsWith(rawQ) ? 1 : at.includes(rawQ) ? 2 : 3;
          const br = bt === rawQ ? 0 : bt.startsWith(rawQ) ? 1 : bt.includes(rawQ) ? 2 : 3;
          if (ar !== br) return ar - br;
          return at.localeCompare(bt, 'de', { numeric: true });
        });
      }
      gsearchCurrentList = list.slice(0, 120);
      if (gsearchSelectedIdx >= gsearchCurrentList.length) gsearchSelectedIdx = 0;
      if (gsearchCountEl) gsearchCountEl.textContent = gsearchCurrentList.length + ' Treffer';

      gsearchResultsEl.innerHTML = '';
      if (gsearchCurrentList.length === 0) {
        gsearchResultsEl.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text-muted);font-size:12.5px;">Keine Treffer gefunden.</div>';
        return;
      }
      gsearchCurrentList.forEach((item, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gsearch-row' + (idx === gsearchSelectedIdx ? ' active' : '');
        const catTxt = GSEARCH_CAT_LABELS[item.category] || item.category;
        btn.innerHTML =
          '<div style="min-width:0;flex:1;">' +
            '<div style="display:flex;align-items:center;gap:6px;font-size:12px;">' +
              '<span style="color:var(--accent-text);font-weight:600;white-space:nowrap;">' + escapeHtml(catTxt) + '</span>' +
              '<span style="color:var(--text-muted);">·</span>' +
              '<span style="font-family:ui-monospace,monospace;font-weight:600;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(item.title) + '</span>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
              escapeHtml(item.subtitle + (item.meta ? ' · ' + item.meta : '')) +
            '</div>' +
          '</div>' +
          '<span style="color:var(--text-muted);font-size:12px;flex-shrink:0;">→</span>';
        btn.addEventListener('mouseenter', () => {
          gsearchSelectedIdx = idx;
          gsearchResultsEl.querySelectorAll('.gsearch-row').forEach((el, i) => el.classList.toggle('active', i === idx));
        });
        btn.addEventListener('click', () => jumpToGlobalSearchEntry(item));
        gsearchResultsEl.appendChild(btn);
      });
    }

    function openGlobalSearchModal() {
      if (!gsearchOverlay) return;
      gsearchOverlay.classList.add('open');
      gsearchSelectedIdx = 0;
      renderGlobalSearchCats();
      renderGlobalSearchResults();
      if (gsearchInput) {
        gsearchInput.value = '';
        setTimeout(() => gsearchInput.focus(), 20);
      }
    }

    function closeGlobalSearchModal() {
      if (gsearchOverlay) gsearchOverlay.classList.remove('open');
    }

    if (btnGlobalSearch) btnGlobalSearch.addEventListener('click', openGlobalSearchModal);
    if (btnCloseGsearch) btnCloseGsearch.addEventListener('click', closeGlobalSearchModal);
    if (gsearchOverlay) {
      gsearchOverlay.addEventListener('click', e => {
        if (e.target === gsearchOverlay) closeGlobalSearchModal();
      });
    }
    if (gsearchInput) {
      gsearchInput.addEventListener('input', () => {
        gsearchSelectedIdx = 0;
        renderGlobalSearchResults();
      });
      gsearchInput.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          gsearchSelectedIdx = Math.min(Math.max(0, gsearchCurrentList.length - 1), gsearchSelectedIdx + 1);
          renderGlobalSearchResults();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          gsearchSelectedIdx = Math.max(0, gsearchSelectedIdx - 1);
          renderGlobalSearchResults();
        } else if (e.key === 'Enter' && gsearchCurrentList[gsearchSelectedIdx]) {
          e.preventDefault();
          jumpToGlobalSearchEntry(gsearchCurrentList[gsearchSelectedIdx]);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeGlobalSearchModal();
        }
      });
    }

    // Unified Priority Keyboard & Escape Dispatcher in Callflow.html
    document.addEventListener('keydown', e => {
      const isGsearchOpen = Boolean(gsearchOverlay && gsearchOverlay.classList.contains('open'));
      const isNodeInfoOpen = Boolean(nodeInfoOverlay && nodeInfoOverlay.style.display === 'flex');
      const isSchedulesOpen = Boolean(schedulesOverlay && schedulesOverlay.style.display === 'flex');
      const isInventoryOpen = Boolean(inventoryOverlay && inventoryOverlay.style.display === 'flex');
      const isScriptDropdownOpen = Boolean(scriptDropdownPopover && scriptDropdownPopover.style.display === 'flex');
      const anyModalOpen = isGsearchOpen || isNodeInfoOpen || isSchedulesOpen || isInventoryOpen;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isGsearchOpen) closeGlobalSearchModal();
        else openGlobalSearchModal();
        return;
      }
      if (e.key === 'Escape') {
        if (isGsearchOpen) { e.preventDefault(); closeGlobalSearchModal(); return; }
        if (isNodeInfoOpen) { e.preventDefault(); closeNodeInfoModal(); return; }
        if (isInventoryOpen) { e.preventDefault(); closeInventoryModal(); return; }
        if (isSchedulesOpen) { e.preventDefault(); schedulesOverlay.style.display = 'none'; return; }
        if (isScriptDropdownOpen) { e.preventDefault(); scriptDropdownPopover.style.display = 'none'; return; }
        if (diagramLegendOpen) { e.preventDefault(); setDiagramLegendOpen(false); return; }
        return;
      }
      if (anyModalOpen) return;

      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'l') {
        e.preventDefault();
        setDiagramLegendOpen(!diagramLegendOpen);
      } else if (key === 'm') {
        e.preventDefault();
        setMinimapOpen(!minimapOpen);
      } else if (key === 'b') {
        e.preventDefault();
        toggleSidebar();
      } else if (key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    });

    function bootActiveViewOnDemand() {
      if (activeViewKey === 'welcome') {
        svgLayer.replaceChildren();
        renderWelcomeOverlay();
        populateViewSelect();
        populateSelect();
        syncIsolateUi();
        renderAnalysisTab();
        applyCombinedCanvasStateInner(false);
        updateMinimapViewport();
        return;
      }
      normalizeSvgElement(svgLayer.querySelector('svg'), viewsByKey.get(activeViewKey), true);
      populateViewSelect();
      populateSelect();
      syncIsolateUi();
      renderAnalysisTab();
      applyCombinedCanvasStateInner(false);
      fitToWindow();
      updateMinimapViewport();
    }

    bootActiveViewOnDemand();
  </script>
</body>
</html>`);

  return htmlParts;
}

/**
 * Backward-compatible string wrapper around generateInteractiveCallflowHtmlParts.
 * For very large workspaces prefer generateInteractiveCallflowHtmlParts() + new Blob(parts)
 * to avoid V8's single-string length limit.
 */
export function generateInteractiveCallflowHtml(
  diagramTitle: string,
  svgString: string,
  graph: CallflowGraph,
  canvasSurface: 'dark' | 'light',
  options?: InteractiveCallflowHtmlOptions
): string {
  return generateInteractiveCallflowHtmlParts(
    diagramTitle,
    svgString,
    graph,
    canvasSurface,
    options
  ).join('');
}



