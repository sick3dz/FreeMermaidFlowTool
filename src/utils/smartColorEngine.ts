import {
  LegendItem,
  LogicAnalysisSummary,
  PathColorMode,
  SmartColorMode,
  SmartColorNodeType,
} from '../types/mermaidStudio';
import { isColorDark, sanitizeSvgForXmlParser } from './mermaidEngine';

export type SemanticRoleId =
  | 'start-actor'
  | 'decision-gate'
  | 'storage-db'
  | 'async-queue'
  | 'error-alert'
  | 'core-service';

export interface SmartColorNodeTypeOption {
  id: SmartColorNodeType;
  label: string;
  description: string;
  swatchColor: string;
}

export const SMART_COLOR_NODE_TYPE_OPTIONS: SmartColorNodeTypeOption[] = [
  {
    id: 'announcement',
    label: 'Ansagen & Audio',
    description: 'Sonderansagen, Broadcast, Treatment, Wartemusik, RAN',
    swatchColor: '#14b8a6',
  },
  {
    id: 'queue',
    label: 'Skillsets & Queues',
    description: 'Skillsets, Network-Skillsets, Agent-Queues, Event-Bus',
    swatchColor: '#a78bfa',
  },
  {
    id: 'decision',
    label: 'Entscheidungen & Gates',
    description: 'Verzweigungen, CCMA-Intrinsics, Gateways, Auth',
    swatchColor: '#fbbf24',
  },
  {
    id: 'storage',
    label: 'Datenbank & CTI / Endpunkte',
    description: 'DB, READVAR / HDX, Route Call, externe Endpunkte',
    swatchColor: '#34d399',
  },
  {
    id: 'start-actor',
    label: 'Einstieg & Akteure',
    description: 'Einstiegs-Skripte, Client, Akteur, Ziel',
    swatchColor: '#38bdf8',
  },
  {
    id: 'core-service',
    label: 'Skripte & Services',
    description: 'Reguläre Skripte, Prozesse, Services',
    swatchColor: '#818cf8',
  },
  {
    id: 'error-alert',
    label: 'Offene Punkte & Fehler',
    description: 'Fehlende Skripte, Out of Service, Abbruch, Fehler',
    swatchColor: '#fb7185',
  },
];

interface RolePalette {
  id: SemanticRoleId;
  label: string;
  dark: { fill: string; border: string; text: string };
  light: { fill: string; border: string; text: string };
}

export const SEMANTIC_PALETTES: Record<SemanticRoleId, RolePalette> = {
  'start-actor': {
    id: 'start-actor',
    label: 'Client / Einstieg / Akteur',
    dark: { fill: '#0c4a6e', border: '#38bdf8', text: '#f0f9ff' },
    light: { fill: '#e0f2fe', border: '#0284c7', text: '#0c4a6e' },
  },
  'decision-gate': {
    id: 'decision-gate',
    label: 'Entscheidung / Gateway / Auth',
    dark: { fill: '#78350f', border: '#fbbf24', text: '#fffbeb' },
    light: { fill: '#fef3c7', border: '#d97706', text: '#78350f' },
  },
  'storage-db': {
    id: 'storage-db',
    label: 'Datenbank / Speicher / Cache',
    dark: { fill: '#064e3b', border: '#34d399', text: '#ecfdf5' },
    light: { fill: '#d1fae5', border: '#059669', text: '#064e3b' },
  },
  'async-queue': {
    id: 'async-queue',
    label: 'Event-Bus / Queue / Async',
    dark: { fill: '#4c1d95', border: '#a78bfa', text: '#f5f3ff' },
    light: { fill: '#ede9fe', border: '#7c3aed', text: '#4c1d95' },
  },
  'error-alert': {
    id: 'error-alert',
    label: 'Fehler / Warnung / Abbruch',
    dark: { fill: '#881337', border: '#fb7185', text: '#fff1f2' },
    light: { fill: '#ffe4e6', border: '#e11d48', text: '#881337' },
  },
  'core-service': {
    id: 'core-service',
    label: 'Service / Prozess / Logik',
    dark: { fill: '#1e1b4b', border: '#818cf8', text: '#eef2ff' },
    light: { fill: '#e0e7ff', border: '#4f46e5', text: '#1e1b4b' },
  },
};

const CLUSTER_ZONE_PALETTES = [
  {
    name: 'Ebene 1 (Blau)',
    dark: { bg: 'rgba(30, 58, 138, 0.28)', border: '#60a5fa', text: '#dbeafe', nodeFill: '#172554', nodeBorder: '#3b82f6' },
    light: { bg: 'rgba(219, 234, 254, 0.65)', border: '#2563eb', text: '#1e3a8a', nodeFill: '#eff6ff', nodeBorder: '#2563eb' },
  },
  {
    name: 'Ebene 2 (Violett)',
    dark: { bg: 'rgba(76, 29, 149, 0.28)', border: '#a78bfa', text: '#ede9fe', nodeFill: '#2e1065', nodeBorder: '#8b5cf6' },
    light: { bg: 'rgba(237, 233, 254, 0.65)', border: '#7c3aed', text: '#4c1d95', nodeFill: '#f5f3ff', nodeBorder: '#7c3aed' },
  },
  {
    name: 'Ebene 3 (Smaragd)',
    dark: { bg: 'rgba(6, 78, 59, 0.30)', border: '#34d399', text: '#d1fae5', nodeFill: '#022c22', nodeBorder: '#10b981' },
    light: { bg: 'rgba(209, 250, 229, 0.65)', border: '#059669', text: '#064e3b', nodeFill: '#ecfdf5', nodeBorder: '#059669' },
  },
  {
    name: 'Ebene 4 (Bernstein)',
    dark: { bg: 'rgba(120, 53, 15, 0.28)', border: '#fbbf24', text: '#fef3c7', nodeFill: '#451a03', nodeBorder: '#f59e0b' },
    light: { bg: 'rgba(254, 243, 199, 0.65)', border: '#d97706', text: '#78350f', nodeFill: '#fffbeb', nodeBorder: '#d97706' },
  },
  {
    name: 'Ebene 5 (Cyan)',
    dark: { bg: 'rgba(12, 74, 110, 0.30)', border: '#38bdf8', text: '#e0f2fe', nodeFill: '#082f49', nodeBorder: '#0ea5e9' },
    light: { bg: 'rgba(224, 242, 254, 0.65)', border: '#0284c7', text: '#0c4a6e', nodeFill: '#f0f9ff', nodeBorder: '#0284c7' },
  },
  {
    name: 'Ebene 6 (Koralle)',
    dark: { bg: 'rgba(136, 19, 55, 0.28)', border: '#fb7185', text: '#ffe4e6', nodeFill: '#4c0519', nodeBorder: '#f43f5e' },
    light: { bg: 'rgba(255, 228, 230, 0.65)', border: '#e11d48', text: '#881337', nodeFill: '#fff1f2', nodeBorder: '#e11d48' },
  },
];

/**
 * Classifies a node's semantic role from its label text, node ID, and Mermaid code context.
 */
export function classifySemanticRole(
  textAndId: string,
  shapeHint: 'diamond' | 'cylinder' | 'stadium' | 'subroutine' | 'circle' | 'rect',
  codeContextMap: Map<string, SemanticRoleId>
): SemanticRoleId {
  const lower = textAndId.toLowerCase();

  // Check if exact ID was already classified from raw Mermaid syntax
  for (const [nodeId, mappedRole] of codeContextMap.entries()) {
    if (lower.includes(nodeId.toLowerCase())) {
      return mappedRole;
    }
  }

  // 1. Error / Alert / Rejection keywords
  if (
    /\b(error|fehler|fail|failed|abbruch|exception|ungültig|invalid|401|403|404|422|500|timeout|alert|warnung|ablehnung|denied|reject|kritisch|out\s+of\s+service|missingscript|fehlendes)\b/i.test(
      lower
    )
  ) {
    return 'error-alert';
  }

  // 2. Async / Queue / Skillset / Network-Skillset (check before cylinder shapeHint so Skillsets are colored as Queues)
  if (
    shapeHint === 'subroutine' ||
    /\b(kafka|queue|skillset|network-skillset|agent-queue|event|events|bus|stream|streaming|topic|worker|webhook|async|message|broker|rabbitmq|pubsub)\b/i.test(
      lower
    ) ||
    /^(?:q|nq|ag|queue)_/i.test(lower)
  ) {
    return 'async-queue';
  }

  // 3. Storage / Database / Persistence / HDX READVAR / Recorded Prompts
  if (
    shapeHint === 'cylinder' ||
    /\b(db|database|datenbank|postgres|postgresql|mysql|sql|redis|cache|storage|speicher|archiv|archive|s3|disk|bucket|mongo|repository|table|persistenz|readvar|hdx|sonderansage|endpunkt|route\s*call)\b/i.test(
      lower
    )
  ) {
    return 'storage-db';
  }

  // 4. Decision / Gateway / Security / Firewall / CCMA Intrinsics
  if (
    shapeHint === 'diamond' ||
    lower.includes('?') ||
    /\b(if|prüfung|pruefung|check|valid|validation|auth|oauth|oidc|idp|waf|firewall|gateway|apigw|entscheidung|bedingung|gate|filter|load\s*balancer|ingress|ewt|logged\s*in\s*agents|idle\s*agents|calls\s*waiting)\b/i.test(
      lower
    )
  ) {
    return 'decision-gate';
  }

  // 5. Start / End / Client / User / Actor
  if (
    shapeHint === 'stadium' ||
    shapeHint === 'circle' ||
    /\b(start|beginn|ende|end|ziel|user|nutzer|client|web|mobile|browser|app|frontend|ui|kunde|actor|akteur|cdn|dns|edge)\b/i.test(
      lower
    )
  ) {
    return 'start-actor';
  }

  return 'core-service';
}

/**
 * Parses the raw Mermaid code to pre-classify node IDs based on bracket syntax:
 * - [(...)] -> storage-db (or async-queue when Skillset / Queue)
 * - {...} or {{...}} -> decision-gate
 * - [[...]] -> async-queue
 * - ([...]) or ((...)) -> start-actor
 */
export function buildCodeSyntaxRoleMap(code: string): Map<string, SemanticRoleId> {
  const map = new Map<string, SemanticRoleId>();
  const lines = code.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;

    // Cylinder [(...)] or @{ shape: cyl }
    const cylMatches = trimmed.matchAll(/\b([A-Za-z0-9_-]+)\s*\[\(/g);
    for (const m of cylMatches) {
      const id = m[1];
      if (/^(?:Q|NQ|AG|QUEUE)_/i.test(id) || /\b(?:skillset|queue)\b/i.test(trimmed)) {
        map.set(id, 'async-queue');
      } else {
        map.set(id, 'storage-db');
      }
    }
    if (/shape\s*:\s*(cyl|db|database|disk)/i.test(trimmed)) {
      const idMatch = trimmed.match(/^([A-Za-z0-9_-]+)@/);
      if (idMatch) map.set(idMatch[1], 'storage-db');
    }

    // Diamond {...} or Hexagon {{...}} or @{ shape: hex|diam }
    const diamMatches = trimmed.matchAll(/\b([A-Za-z0-9_-]+)\s*\{/g);
    for (const m of diamMatches) map.set(m[1], 'decision-gate');
    if (/shape\s*:\s*(hex|diam|diamond|decision)/i.test(trimmed)) {
      const idMatch = trimmed.match(/^([A-Za-z0-9_-]+)@/);
      if (idMatch) map.set(idMatch[1], 'decision-gate');
    }

    // Subroutine [[...]]
    const subMatches = trimmed.matchAll(/\b([A-Za-z0-9_-]+)\s*\[\[/g);
    for (const m of subMatches) map.set(m[1], 'async-queue');

    // Stadium ([...]) or Circle ((...))
    const stadMatches = trimmed.matchAll(/\b([A-Za-z0-9_-]+)\s*\([[(]/g);
    for (const m of stadMatches) {
      const id = m[1];
      if (/^(?:Q|NQ|AG|QUEUE)_/i.test(id) || /\b(?:agent-queue|skillset|queue)\b/i.test(trimmed)) {
        map.set(id, 'async-queue');
      } else {
        map.set(id, 'start-actor');
      }
    }
  }

  return map;
}

function getPrimaryNodeTitle(rawLabel: string): string {
  const beforeDetailBadges = rawLabel
    .split(/📊|🔄|⏳|🗄️|🕒|📅|Abschnitt:|Bedingung:/)[0]
    .trim();
  return beforeDetailBadges || rawLabel.trim();
}

export function isAnnouncementNodeText(idAndAttr: string, textContent: string): boolean {
  const idLower = idAndAttr.toLowerCase();
  const fullText = textContent.replace(/\s+/g, ' ').trim();
  const primaryTitle = getPrimaryNodeTitle(fullText);

  if (fullText.includes('🔊') || /sonderansage\s*\/\s*endpunkt/i.test(fullText)) {
    return true;
  }

  // Detail-view step nodes playing announcements, broadcasts, treatments, or audio
  if (
    /^(?:step_|flowchart-step_)/i.test(idLower) ||
    /^prio\s+\d+\s*:/i.test(primaryTitle)
  ) {
    if (
      /^prio\s+\d+\s*:\s*(?:controlled\s+broadcast|aura\s+recording|treatment|wartemusik|musik|freizeichen|besetztton|stille|ringback|busy|silence|sonderansage|ansage|voice\s+segment|play\b|ran\b|ivr\s+\S+\s*\(treatment)/i.test(
        primaryTitle
      ) ||
      /\b(?:ansage|wartemusik)\s*:/i.test(primaryTitle) ||
      /📢\s*treatment\s*:/i.test(fullText)
    ) {
      return true;
    }
    return false;
  }

  // Master script summary nodes (▶ or ◆) are only announcement nodes if their own name/ID is an announcement
  const cleanTitleForMatch = primaryTitle.replace(/^[▶◆★■●\s]+/, '').trim();
  if (
    /\b(announcement|announcements|sonderansage|ansage|ansagen|voice[\s_-]*segment|controlled[\s_-]*broadcast|aura[\s_-]*recording|wartemusik|ringback|audio[\s_-]*prompt|ran)\b/i.test(
      `${idAndAttr} ${cleanTitleForMatch}`
    ) ||
    /\.(?:wav|mp3|ogg|ulaw|alaw|vox|au)\b/i.test(`${idAndAttr} ${cleanTitleForMatch}`)
  ) {
    return true;
  }

  return false;
}

export function classifySmartFilterNodeType(
  idAndAttr: string,
  textContent: string,
  shapeHint: 'diamond' | 'cylinder' | 'stadium' | 'subroutine' | 'circle' | 'rect',
  codeContextMap: Map<string, SemanticRoleId>,
  element?: Element
): { filterType: SmartColorNodeType; semanticRole: SemanticRoleId } {
  const combined = `${idAndAttr} ${textContent}`;
  const semanticRole = classifySemanticRole(combined, shapeHint, codeContextMap);

  const isOpenIssue =
    Boolean(element?.classList.contains('missingScript')) ||
    Boolean(element?.classList.contains('openIssue')) ||
    textContent.includes('●');

  if (isOpenIssue || semanticRole === 'error-alert') {
    return { filterType: 'error-alert', semanticRole };
  }

  if (isAnnouncementNodeText(idAndAttr, textContent)) {
    return { filterType: 'announcement', semanticRole };
  }

  switch (semanticRole) {
    case 'async-queue':
      return { filterType: 'queue', semanticRole };
    case 'decision-gate':
      return { filterType: 'decision', semanticRole };
    case 'storage-db':
      return { filterType: 'storage', semanticRole };
    case 'start-actor':
      return { filterType: 'start-actor', semanticRole };
    case 'core-service':
    default:
      return { filterType: 'core-service', semanticRole };
  }
}

function collectDeclaredCodeNodeIds(code: string): {
  allIds: string[];
  subgraphNodeIds: Map<string, Set<string>>;
} {
  const idSet = new Set<string>();
  const subgraphNodeIds = new Map<string, Set<string>>();
  const lines = code.split('\n');
  const subgraphStack: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;

    const sgMatch = trimmed.match(/^subgraph\s+([A-Za-z0-9_.-]+)/i);
    if (sgMatch) {
      const sgId = sgMatch[1];
      subgraphStack.push(sgId);
      if (!subgraphNodeIds.has(sgId)) {
        subgraphNodeIds.set(sgId, new Set<string>());
      }
      continue;
    }
    if (/^end\b/i.test(trimmed)) {
      subgraphStack.pop();
      continue;
    }

    const tokenMatches = trimmed.matchAll(
      /\b([A-Za-z0-9_]+)\s*(?:\[\[|\[\(|\(\[|\(\(|\{\{|[\[\(\{])/g
    );
    for (const m of tokenMatches) {
      const id = m[1];
      if (
        ['subgraph', 'end', 'direction', 'classDef', 'class', 'style', 'click', 'linkStyle'].includes(
          id
        )
      ) {
        continue;
      }
      idSet.add(id);
      for (const sgId of subgraphStack) {
        subgraphNodeIds.get(sgId)?.add(id);
      }
    }
  }

  return {
    allIds: Array.from(idSet).sort((a, b) => b.length - a.length),
    subgraphNodeIds,
  };
}

function extractNodeIdFromSvgElement(nodeEl: Element, sortedKnownIds: string[]): string | null {
  const fastId = nodeEl.getAttribute('data-callflow-node-id');
  if (fastId) return fastId;
  const dataId = nodeEl.getAttribute('data-id');
  if (dataId) return dataId;

  const domId = nodeEl.getAttribute('id') || '';
  for (const knownId of sortedKnownIds) {
    const escaped = knownId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[-_])${escaped}(?:[-_]\\d+|$)`, 'i').test(domId)) {
      return knownId;
    }
  }

  const mermaidPrefixMatch = domId.match(/^(?:flowchart|state)-(.+?)-\d+$/i);
  if (mermaidPrefixMatch) return mermaidPrefixMatch[1];
  return domId || null;
}

function edgeElementConnectsHiddenNode(
  edgeEl: Element,
  hiddenNodeIdPatterns: RegExp[]
): boolean {
  if (hiddenNodeIdPatterns.length === 0) return false;
  const nestedDataId =
    edgeEl.getAttribute('data-id') ||
    edgeEl.querySelector('[data-id]')?.getAttribute('data-id') ||
    '';
  const meta = `${edgeEl.getAttribute('id') || ''} ${nestedDataId} ${edgeEl.getAttribute('class') || ''}`;
  return hiddenNodeIdPatterns.some((re) => re.test(meta));
}

/**
 * Applies text color to both SVG `<text>`/`<tspan>` and HTML `<foreignObject>` inside a group.
 */
function applyGroupTextStyle(group: Element, textColor: string, fontWeight?: string): void {
  const textEls = group.querySelectorAll('text, tspan');
  textEls.forEach((el) => {
    (el as SVGElement).style.fill = textColor;
    el.setAttribute('fill', textColor);
    if (fontWeight) {
      (el as SVGElement).style.fontWeight = fontWeight;
    }
  });

  const htmlEls = group.querySelectorAll('foreignObject div, foreignObject span, foreignObject p');
  htmlEls.forEach((el) => {
    (el as HTMLElement).style.color = textColor;
    if (fontWeight) {
      (el as HTMLElement).style.fontWeight = fontWeight;
    }
  });
}

// ============================================================================
// Edge / Path Differentiation (Modus A: Semantik vs. Modus B: Verzweigung)
// ============================================================================

export type SemanticEdgeCategory =
  | 'edge-flow'
  | 'edge-decision'
  | 'edge-queue'
  | 'edge-fallback'
  | 'edge-error'
  | 'edge-cycle'
  | 'edge-external';

export interface ParsedCodeEdgeMeta {
  index: number;
  from: string;
  to: string;
  label: string;
  isDashed: boolean;
}

interface SvgMarkerRegistry {
  markersById: Map<string, Element>;
  defsEl: Element | null;
}

const svgMarkerRegistryCache = new WeakMap<SVGSVGElement, SvgMarkerRegistry>();

function getSvgMarkerRegistry(svgEl: SVGSVGElement): SvgMarkerRegistry {
  const cached = svgMarkerRegistryCache.get(svgEl);
  if (cached) return cached;

  const markersById = new Map<string, Element>();
  svgEl.querySelectorAll('defs marker, marker').forEach((m) => {
    const id = m.getAttribute('id');
    if (id && !markersById.has(id)) {
      markersById.set(id, m);
    }
  });
  const defsEl = svgEl.querySelector('defs');
  const reg = { markersById, defsEl };
  svgMarkerRegistryCache.set(svgEl, reg);
  return reg;
}

function extractMarkerIdFromUrl(val: string | null | undefined): string | null {
  if (!val) return null;
  const match = val.match(/url\(\s*['"]?(?:[^'"#)]*)#([^'")\s]+)['"]?\s*\)/i);
  return match ? match[1] : null;
}

/**
 * Sets stroke color on an SVG edge path and clones its `<marker>` arrowheads per color
 * so every differentiated path renders with matching arrowhead color in Chromium, SVG & PNG exports.
 */
export function applyColorToEdgePathAndMarkers(
  svgEl: SVGSVGElement,
  pathEl: SVGElement,
  color: string
): void {
  pathEl.style.stroke = color;
  pathEl.setAttribute('stroke', color);

  const registry = getSvgMarkerRegistry(svgEl);
  const safeHex = color.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'c';

  const markerAttrs: Array<{ attr: 'marker-end' | 'marker-start'; styleProp: 'markerEnd' | 'markerStart' }> = [
    { attr: 'marker-end', styleProp: 'markerEnd' },
    { attr: 'marker-start', styleProp: 'markerStart' },
  ];

  for (const { attr, styleProp } of markerAttrs) {
    const rawRef = pathEl.style[styleProp] || pathEl.getAttribute(attr);
    const rawMarkerId = extractMarkerIdFromUrl(rawRef);
    if (!rawMarkerId) continue;

    const baseMarkerId = rawMarkerId.replace(/__c_[a-z0-9]+$/i, '');
    const targetMarkerId = `${baseMarkerId}__c_${safeHex}`;

    if (!registry.markersById.has(targetMarkerId)) {
      const origMarker =
        registry.markersById.get(baseMarkerId) || registry.markersById.get(rawMarkerId);
      if (!origMarker) continue;

      const cloned = origMarker.cloneNode(true) as Element;
      cloned.setAttribute('id', targetMarkerId);
      cloned.setAttribute('data-colored-marker', 'true');

      cloned.querySelectorAll('path, polygon, circle, rect, polyline').forEach((child) => {
        const svgChild = child as SVGElement;
        const origFill = svgChild.style.fill || child.getAttribute('fill') || '';
        if (origFill !== 'none') {
          svgChild.style.fill = color;
          child.setAttribute('fill', color);
        }
        svgChild.style.stroke = color;
        child.setAttribute('stroke', color);
      });

      const parentContainer = origMarker.parentNode || registry.defsEl || svgEl;
      parentContainer.appendChild(cloned);
      registry.markersById.set(targetMarkerId, cloned);
    }

    const nextUrl = `url(#${targetMarkerId})`;
    pathEl.setAttribute(attr, nextUrl);
    pathEl.style[styleProp] = nextUrl;
  }
}

const EDGE_CODE_RESERVED_IDS = new Set([
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

function splitStatementsOutsideQuotesForEdges(line: string): string[] {
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

function extractSimpleNodeIdFromToken(rawToken: string): string | null {
  let token = rawToken.trim().replace(/:::[A-Za-z0-9_-]+$/, '').trim();
  if (!token) return null;
  if (token === '[*]') return 'START_END';
  const v11 = token.match(/^([A-Za-z0-9_.-]+)\s*@\s*\{[\s\S]*\}$/);
  if (v11) {
    return EDGE_CODE_RESERVED_IDS.has(v11[1].toLowerCase()) ? null : v11[1];
  }
  const withShape = token.match(/^([A-Za-z0-9_.-]+)\s*[\[(\{>]/);
  if (withShape) {
    return EDGE_CODE_RESERVED_IDS.has(withShape[1].toLowerCase()) ? null : withShape[1];
  }
  const plain = token.match(/^([A-Za-z0-9_.-]+)$/);
  if (plain) {
    return EDGE_CODE_RESERVED_IDS.has(plain[1].toLowerCase()) ? null : plain[1];
  }
  return null;
}

export function parseCodeEdgeMetaList(code: string): ParsedCodeEdgeMeta[] {
  const edges: ParsedCodeEdgeMeta[] = [];
  const cleaned = code
    .replace(/%%\{[\s\S]*?\}%%/g, '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/m, '');

  const statements: string[] = [];
  for (const rawLine of cleaned.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('%%')) continue;
    const withoutComment = line.replace(/\s+%%[^"']*$/, '').trim();
    if (!withoutComment) continue;
    statements.push(...splitStatementsOutsideQuotesForEdges(withoutComment));
  }

  for (const line of statements) {
    if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr|participant|actor)\b/i.test(line)) {
      continue;
    }

    const seqMatch = line.match(
      /^([A-Za-z0-9_.-]+)\s*(->>|-->>|->|-->|-x|--x|-\)|--\))\+?-?\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/
    );
    if (seqMatch) {
      edges.push({
        index: edges.length,
        from: seqMatch[1],
        to: seqMatch[3],
        label: seqMatch[4].replace(/^["'`]|["'`]$/g, '').replace(/<br\s*\/?>/gi, ' ').trim(),
        isDashed: seqMatch[2].includes('--'),
      });
      continue;
    }

    const arrowRegex =
      /\s*(<-->|<-\.->|<==>|-->|-\.->|==>|---|-\.-|==|--\s+[^-|\n]+\s+-->|-\.\s+[^.|\n]+\s+\.->|==\s+[^=|\n]+\s+==>)\s*(?:\|([^|]*)\|)?\s*/g;
    if (!arrowRegex.test(line)) continue;
    arrowRegex.lastIndex = 0;

    const segments: string[] = [];
    const arrows: Array<{ label: string; isDashed: boolean; bidirectional: boolean }> = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = arrowRegex.exec(line)) !== null) {
      segments.push(line.slice(lastIdx, m.index).trim());
      const rawArrow = m[1].trim();
      let edgeLabel = (m[2] || '').trim();
      const inlineMatch = rawArrow.match(
        /^--\s+(.+?)\s+-->$|^-\.\s+(.+?)\s+\.->$|^==\s+(.+?)\s+==>$/
      );
      if (inlineMatch) {
        edgeLabel = (inlineMatch[1] || inlineMatch[2] || inlineMatch[3] || '').trim();
      }
      arrows.push({
        label: edgeLabel.replace(/^["'`]|["'`]$/g, '').replace(/<br\s*\/?>/gi, ' ').trim(),
        isDashed: rawArrow.includes('-.'),
        bidirectional: rawArrow.startsWith('<'),
      });
      lastIdx = arrowRegex.lastIndex;
    }
    segments.push(line.slice(lastIdx).trim());

    for (let i = 0; i < arrows.length; i++) {
      const leftRaw = segments[i];
      const rightRaw = segments[i + 1];
      if (!leftRaw || !rightRaw) continue;
      for (const lPart of leftRaw.split('&')) {
        for (const rPart of rightRaw.split('&')) {
          const from = extractSimpleNodeIdFromToken(lPart);
          const to = extractSimpleNodeIdFromToken(rPart);
          if (!from || !to) continue;
          edges.push({
            index: edges.length,
            from,
            to,
            label: arrows[i].label,
            isDashed: arrows[i].isDashed,
          });
          if (arrows[i].bidirectional) {
            edges.push({
              index: edges.length,
              from: to,
              to: from,
              label: arrows[i].label,
              isDashed: arrows[i].isDashed,
            });
          }
        }
      }
    }
  }

  return edges;
}

/**
 * Finds true cycle back-edges via 3-color DFS (no false positives on converging DAG branches).
 */
function detectCycleEdgeIndices(edges: ParsedCodeEdgeMeta[]): Set<number> {
  const cycleIndices = new Set<number>();
  const adj = new Map<string, ParsedCodeEdgeMeta[]>();
  const inDeg = new Map<string, number>();

  for (const e of edges) {
    const list = adj.get(e.from) || [];
    list.push(e);
    adj.set(e.from, list);
    if (!inDeg.has(e.from)) inDeg.set(e.from, 0);
    inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
  }

  const state = new Map<string, 0 | 1 | 2>();
  const roots = Array.from(inDeg.entries())
    .filter(([, d]) => d === 0)
    .map(([id]) => id);
  const visitOrder = [...roots, ...Array.from(inDeg.keys())];

  const dfs = (u: string) => {
    state.set(u, 1);
    const outgoing = adj.get(u) || [];
    for (const edge of outgoing) {
      const st = state.get(edge.to) || 0;
      if (st === 1) {
        cycleIndices.add(edge.index);
      } else if (st === 0) {
        dfs(edge.to);
      }
    }
    state.set(u, 2);
  };

  for (const nodeId of visitOrder) {
    if ((state.get(nodeId) || 0) === 0) {
      dfs(nodeId);
    }
  }

  return cycleIndices;
}

interface EdgeVisualStyle {
  id: SemanticEdgeCategory;
  label: string;
  color: string;
  dashed: boolean;
  strokeWidth: string;
}

const SEMANTIC_EDGE_STYLES: Record<
  SemanticEdgeCategory,
  { label: string; dark: string; light: string; dashed: boolean; strokeWidth: string }
> = {
  'edge-flow': {
    label: 'Standard-Fluss',
    dark: '#818cf8',
    light: '#4f46e5',
    dashed: false,
    strokeWidth: '2px',
  },
  'edge-decision': {
    label: 'Bedingung / Auswahl / Taste',
    dark: '#38bdf8',
    light: '#0284c7',
    dashed: false,
    strokeWidth: '2.2px',
  },
  'edge-queue': {
    label: 'Queue / Skillset / Async',
    dark: '#a78bfa',
    light: '#7c3aed',
    dashed: false,
    strokeWidth: '2.3px',
  },
  'edge-external': {
    label: 'Sprung / Route / Verknüpfung',
    dark: '#2dd4bf',
    light: '#0d9488',
    dashed: false,
    strokeWidth: '2.3px',
  },
  'edge-fallback': {
    label: 'Fallback / Nein / Weiter',
    dark: '#fbbf24',
    light: '#d97706',
    dashed: true,
    strokeWidth: '2.2px',
  },
  'edge-error': {
    label: 'Fehler / Timeout / Abbruch',
    dark: '#f43f5e',
    light: '#dc2626',
    dashed: true,
    strokeWidth: '2.4px',
  },
  'edge-cycle': {
    label: 'Zyklus / Rücksprung',
    dark: '#fb7185',
    light: '#e11d48',
    dashed: true,
    strokeWidth: '2.5px',
  },
};

export function classifySemanticEdgeStyle(
  labelText: string,
  isDashed: boolean,
  isCycle: boolean,
  canvasSurface: 'dark' | 'light',
  fromRole?: SemanticRoleId,
  toRole?: SemanticRoleId
): EdgeVisualStyle {
  const lower = labelText.toLowerCase();
  let cat: SemanticEdgeCategory = 'edge-flow';

  if (
    isCycle ||
    labelText.includes('↻') ||
    /\b(zyklus|cycle|schleife|loop|rücksprung|wiederhol)\b/i.test(lower)
  ) {
    cat = 'edge-cycle';
  } else if (
    toRole === 'error-alert' ||
    /\b(fehler|error|fail|failed|out of service|oos|abort|abbruch|timeout|ungültig|invalid|nicht gefunden|missing|denied|verweigert|unavailable|down)\b/i.test(
      lower
    )
  ) {
    cat = 'edge-error';
  } else if (
    /\b(fallback|default|weiter|nein|no|false|sonst|else|otherwise|standard|kein|none|skip)\b/i.test(
      lower
    ) ||
    (isDashed && toRole !== 'async-queue')
  ) {
    cat = 'edge-fallback';
  } else if (
    toRole === 'async-queue' ||
    /\b(queue|network-queue|skillset|async|event|bus|wait|warte|musik|hold|publish|subscribe)\b/i.test(
      lower
    )
  ) {
    cat = 'edge-queue';
  } else if (
    fromRole === 'decision-gate' ||
    /\b(ja|yes|true|ok|match|treffer|bedingung|condition|if|check|auth|zeitplan|schedule|feiertag|holiday|taste|dtmf|ivr|wahl|auswahl|option|case|menu)\b/i.test(
      lower
    )
  ) {
    cat = 'edge-decision';
  } else if (
    /\b(route|sprung|jump|sub|include|verknüpft|linked|wohin|transfer|weiterleitung|forward|redirect|cti|db|database|hdx|readvar|api|http|webhook|extern|endpunkt)\b/i.test(
      lower
    )
  ) {
    cat = 'edge-external';
  }

  const def = SEMANTIC_EDGE_STYLES[cat];
  return {
    id: cat,
    label: def.label,
    color: canvasSurface === 'dark' ? def.dark : def.light,
    dashed: def.dashed || (isDashed && cat === 'edge-queue'),
    strokeWidth: def.strokeWidth,
  };
}

const BRANCH_PALETTE = [
  { label: 'Zweig 1 (Blau)', dark: '#38bdf8', light: '#0284c7' },
  { label: 'Zweig 2 (Smaragd)', dark: '#34d399', light: '#059669' },
  { label: 'Zweig 3 (Bernstein)', dark: '#fbbf24', light: '#d97706' },
  { label: 'Zweig 4 (Violett)', dark: '#a78bfa', light: '#7c3aed' },
  { label: 'Zweig 5 (Türkis)', dark: '#2dd4bf', light: '#0d9488' },
  { label: 'Zweig 6 (Orange)', dark: '#fb923c', light: '#ea580c' },
  { label: 'Zweig 7 (Pink)', dark: '#f472b6', light: '#db2777' },
  { label: 'Zweig 8 (Indigo)', dark: '#818cf8', light: '#4f46e5' },
];

function computeBranchIndexByEdge(
  edges: ParsedCodeEdgeMeta[],
  cycleIndices: Set<number>
): Map<number, number> {
  const edgeBranch = new Map<number, number>();
  const outByNode = new Map<string, ParsedCodeEdgeMeta[]>();
  const inDegree = new Map<string, number>();

  for (const e of edges) {
    if (!inDegree.has(e.from)) inDegree.set(e.from, 0);
    if (!inDegree.has(e.to)) inDegree.set(e.to, 0);
    if (cycleIndices.has(e.index)) continue;
    const list = outByNode.get(e.from) || [];
    list.push(e);
    outByNode.set(e.from, list);
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
  }

  const nodeBranch = new Map<string, number>();
  const visitedNodes = new Set<string>();
  const roots = Array.from(inDegree.entries())
    .filter(([, d]) => d === 0)
    .map(([id]) => id);
  const startOrder = roots.length > 0 ? roots : Array.from(inDegree.keys());

  let nextGlobalBranch = 0;

  for (const startId of startOrder) {
    if (visitedNodes.has(startId)) continue;
    if (!nodeBranch.has(startId)) {
      nodeBranch.set(startId, nextGlobalBranch % BRANCH_PALETTE.length);
      nextGlobalBranch += 1;
    }

    const queue: string[] = [startId];
    while (queue.length > 0) {
      const u = queue.shift()!;
      if (visitedNodes.has(u)) continue;
      visitedNodes.add(u);

      const parentBranch = nodeBranch.get(u) ?? 0;
      const outgoing = outByNode.get(u) || [];

      if (outgoing.length === 1) {
        const edge = outgoing[0];
        edgeBranch.set(edge.index, parentBranch);
        if (!nodeBranch.has(edge.to)) {
          nodeBranch.set(edge.to, parentBranch);
        }
        if (!visitedNodes.has(edge.to)) queue.push(edge.to);
      } else if (outgoing.length > 1) {
        outgoing.forEach((edge, siblingIdx) => {
          const branchIdx =
            siblingIdx === 0
              ? parentBranch
              : (parentBranch + siblingIdx) % BRANCH_PALETTE.length;
          edgeBranch.set(edge.index, branchIdx);
          if (!nodeBranch.has(edge.to)) {
            nodeBranch.set(edge.to, branchIdx);
          }
          if (!visitedNodes.has(edge.to)) queue.push(edge.to);
        });
        nextGlobalBranch = Math.max(nextGlobalBranch, parentBranch + outgoing.length);
      }
    }
  }

  return edgeBranch;
}

function applyPathColorDifferentiation(
  svgEl: SVGSVGElement,
  code: string,
  pathColorMode: PathColorMode,
  canvasSurface: 'dark' | 'light',
  syntaxRoleMap: Map<string, SemanticRoleId>,
  legendMap: Map<string, LegendItem>
): void {
  const codeEdges = parseCodeEdgeMetaList(code);
  const cycleIndices = detectCycleEdgeIndices(codeEdges);
  const branchByEdge =
    pathColorMode === 'branches'
      ? computeBranchIndexByEdge(codeEdges, cycleIndices)
      : new Map<number, number>();

  let edgeElements = Array.from(
    svgEl.querySelectorAll(
      'g.edgePaths > *, g.edgePath, path.transition, path.relationshipLine'
    )
  ).filter((el) => el.getAttribute('data-smart-hidden') !== 'true');

  if (edgeElements.length === 0) {
    edgeElements = Array.from(
      svgEl.querySelectorAll('line.messageLine0, line.messageLine1, path.messageLine0, path.messageLine1')
    ).filter((el) => el.getAttribute('data-smart-hidden') !== 'true');
  }

  const edgeLabels = Array.from(svgEl.querySelectorAll('g.edgeLabels > *, g.edgeLabel'));
  const labelsByDataId = new Map<string, string>();
  const labelElsByDataId = new Map<string, Element>();
  edgeLabels.forEach((lblEl) => {
    const dataId =
      lblEl.getAttribute('data-id') ||
      lblEl.querySelector('[data-id]')?.getAttribute('data-id') ||
      lblEl.getAttribute('id') ||
      '';
    const text = (lblEl.textContent || '').replace(/\s+/g, ' ').trim();
    if (dataId) {
      labelElsByDataId.set(dataId, lblEl);
      if (text) labelsByDataId.set(dataId, text);
    }
  });

  // Pre-build O(1) indexed lookup maps before falling back to regex matchers
  const consumedCodeEdgeIdx = new Set<number>();
  const edgesByPairKey = new Map<string, ParsedCodeEdgeMeta[]>();
  const edgeByMermaidLId = new Map<string, ParsedCodeEdgeMeta>();
  const pairOccurrenceCounter = new Map<string, number>();

  for (const e of codeEdges) {
    const fLow = e.from.toLowerCase();
    const tLow = e.to.toLowerCase();
    const pairKey = `${fLow}->${tLow}`;
    const list = edgesByPairKey.get(pairKey);
    if (list) list.push(e);
    else edgesByPairKey.set(pairKey, [e]);

    const occ = pairOccurrenceCounter.get(pairKey) || 0;
    pairOccurrenceCounter.set(pairKey, occ + 1);
    edgeByMermaidLId.set(`l_${fLow}_${tLow}_${occ}`, e);
    edgeByMermaidLId.set(`l-${fLow}-${tLow}-${occ}`, e);
  }

  let compiledMatchers: Array<{
    edge: ParsedCodeEdgeMeta;
    exactLsLe: RegExp;
    exactL: RegExp;
    generic: RegExp;
  }> | null = null;

  const getCompiledMatchers = () => {
    if (compiledMatchers) return compiledMatchers;
    compiledMatchers = [...codeEdges]
      .sort((a, b) => b.from.length + b.to.length - (a.from.length + a.to.length))
      .map((e) => {
        const fEsc = e.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tEsc = e.to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return {
          edge: e,
          exactLsLe: new RegExp(`(?:^|\\s)LS_${fEsc}\\s+LE_${tEsc}(?:\\s|$)`),
          exactL: new RegExp(`(?:^|[-\\s])L[-_]${fEsc}[-_]${tEsc}(?:[-_]\\d+(?:[-_]\\d+)?)?(?=$|\\s)`, 'i'),
          generic: new RegExp(`(?:^|[-_L\\s])${fEsc}[-_]${tEsc}(?:[-_]\\d+|\\s|$)`, 'i'),
        };
      });
    return compiledMatchers;
  };

  const takeNextUnconsumedForPair = (pairKey: string): ParsedCodeEdgeMeta | null => {
    const bucket = edgesByPairKey.get(pairKey);
    if (!bucket) return null;
    for (const candidate of bucket) {
      if (!consumedCodeEdgeIdx.has(candidate.index)) {
        consumedCodeEdgeIdx.add(candidate.index);
        return candidate;
      }
    }
    return null;
  };

  const matchCodeEdge = (edgeEl: Element, idx: number): ParsedCodeEdgeMeta | null => {
    // 1. O(1) direct data-edge-from / data-edge-to attribute hit (deterministic vector SVGs)
    const directFrom = edgeEl.getAttribute('data-edge-from');
    const directTo = edgeEl.getAttribute('data-edge-to');
    if (directFrom && directTo) {
      const hit = takeNextUnconsumedForPair(`${directFrom.toLowerCase()}->${directTo.toLowerCase()}`);
      if (hit) return hit;
    }

    // 2. O(1) exact Mermaid L_<from>_<to>_<occ> lookup (handles multi-underscore node IDs safely)
    const nestedDataId =
      edgeEl.getAttribute('data-id') ||
      edgeEl.querySelector('[data-id]')?.getAttribute('data-id') ||
      '';
    const rawId = nestedDataId || edgeEl.getAttribute('id') || '';
    if (rawId) {
      const lowerRaw = rawId.toLowerCase();
      const directExact = edgeByMermaidLId.get(lowerRaw);
      if (directExact && !consumedCodeEdgeIdx.has(directExact.index)) {
        consumedCodeEdgeIdx.add(directExact.index);
        return directExact;
      }
      const lIdx = lowerRaw.indexOf('l_');
      if (lIdx > 0) {
        const suffixExact = edgeByMermaidLId.get(lowerRaw.slice(lIdx));
        if (suffixExact && !consumedCodeEdgeIdx.has(suffixExact.index)) {
          consumedCodeEdgeIdx.add(suffixExact.index);
          return suffixExact;
        }
      }
    }

    // 3. O(1) LS_<from> LE_<to> class token lookup
    const cls = edgeEl.getAttribute('class') || '';
    if (cls.includes('LS_') && cls.includes('LE_')) {
      const lsMatch = cls.match(/(?:^|\s)LS_(\S+)/);
      const leMatch = cls.match(/(?:^|\s)LE_(\S+)/);
      if (lsMatch && leMatch) {
        const hit = takeNextUnconsumedForPair(`${lsMatch[1].toLowerCase()}->${leMatch[1].toLowerCase()}`);
        if (hit) return hit;
      }
    }

    // 4. Lazy fallback regex scan only for non-standard Mermaid edge IDs
    const meta = `${edgeEl.getAttribute('id') || ''} ${nestedDataId} ${cls}`;
    for (const m of getCompiledMatchers()) {
      if (consumedCodeEdgeIdx.has(m.edge.index)) continue;
      if (
        m.exactLsLe.test(meta) ||
        m.exactL.test(meta) ||
        m.generic.test(meta) ||
        meta.includes(`-${m.edge.from}-${m.edge.to}-`) ||
        meta.includes(`_${m.edge.from}_${m.edge.to}_`)
      ) {
        consumedCodeEdgeIdx.add(m.edge.index);
        return m.edge;
      }
    }

    if (idx < codeEdges.length && !consumedCodeEdgeIdx.has(codeEdges[idx].index)) {
      consumedCodeEdgeIdx.add(codeEdges[idx].index);
      return codeEdges[idx];
    }
    return null;
  };

  const getEdgeLabelText = (edgeEl: Element, idx: number, codeEdge: ParsedCodeEdgeMeta | null): string => {
    if (codeEdge?.label) return codeEdge.label;
    const dataId =
      edgeEl.getAttribute('data-id') ||
      edgeEl.querySelector('[data-id]')?.getAttribute('data-id') ||
      edgeEl.getAttribute('id') ||
      '';
    if (dataId && labelsByDataId.has(dataId)) {
      return labelsByDataId.get(dataId) || '';
    }
    if (edgeLabels.length === edgeElements.length && edgeLabels[idx]) {
      return (edgeLabels[idx].textContent || '').replace(/\s+/g, ' ').trim();
    }
    return '';
  };

  edgeElements.forEach((edgeEl, idx) => {
    const codeEdge = matchCodeEdge(edgeEl, idx);
    const labelText = getEdgeLabelText(edgeEl, idx, codeEdge);
    if (codeEdge) {
      edgeEl.setAttribute('data-edge-from', codeEdge.from);
      edgeEl.setAttribute('data-edge-to', codeEdge.to);
      if (labelText) edgeEl.setAttribute('data-edge-label', labelText);

      const eDataId =
        edgeEl.getAttribute('data-id') ||
        edgeEl.querySelector('[data-id]')?.getAttribute('data-id') ||
        edgeEl.getAttribute('id') ||
        '';
      const matchedLblEl =
        (eDataId ? labelElsByDataId.get(eDataId) : undefined) ||
        (edgeLabels.length === edgeElements.length ? edgeLabels[idx] : undefined);
      if (matchedLblEl) {
        matchedLblEl.setAttribute('data-edge-from', codeEdge.from);
        matchedLblEl.setAttribute('data-edge-to', codeEdge.to);
        if (labelText) matchedLblEl.setAttribute('data-edge-label', labelText);
      }
    }
    const isCycle =
      (codeEdge !== null && cycleIndices.has(codeEdge.index)) ||
      labelText.includes('↻') ||
      /\b(zyklus|cycle|schleife|loop|rücksprung)\b/i.test(labelText);

    const shapeTag = edgeEl.tagName.toLowerCase();
    const shapes =
      shapeTag === 'path' || shapeTag === 'line'
        ? [edgeEl]
        : Array.from(edgeEl.querySelectorAll('path, line'));

    if (shapes.length === 0) return;

    const firstShape = shapes[0];
    const styleAttr = firstShape.getAttribute('style') || '';
    const dashAttr = firstShape.getAttribute('stroke-dasharray') || '';
    const isDashed =
      Boolean(codeEdge?.isDashed) ||
      dashAttr.length > 0 ||
      styleAttr.includes('stroke-dasharray') ||
      firstShape.classList.contains('edge-pattern-dotted') ||
      firstShape.classList.contains('edge-pattern-dashed') ||
      firstShape.classList.contains('messageLine1');

    let legendId = '';
    let legendLabel = '';
    let color = '';
    let applyDashed = isDashed;
    let strokeWidth = '2.2px';

    if (pathColorMode === 'branches') {
      if (isCycle) {
        const cycDef = SEMANTIC_EDGE_STYLES['edge-cycle'];
        legendId = 'branch-cycle';
        legendLabel = cycDef.label;
        color = canvasSurface === 'dark' ? cycDef.dark : cycDef.light;
        applyDashed = true;
        strokeWidth = cycDef.strokeWidth;
      } else {
        const branchIdx =
          codeEdge !== null
            ? (branchByEdge.get(codeEdge.index) ?? idx % BRANCH_PALETTE.length)
            : idx % BRANCH_PALETTE.length;
        const pal = BRANCH_PALETTE[branchIdx % BRANCH_PALETTE.length];
        legendId = `branch-${branchIdx % BRANCH_PALETTE.length}`;
        legendLabel = pal.label;
        color = canvasSurface === 'dark' ? pal.dark : pal.light;
        applyDashed = isDashed;
        strokeWidth = '2.3px';
      }
    } else {
      const fromRole = codeEdge ? syntaxRoleMap.get(codeEdge.from) : undefined;
      const toRole = codeEdge ? syntaxRoleMap.get(codeEdge.to) : undefined;
      const sem = classifySemanticEdgeStyle(
        labelText,
        isDashed,
        isCycle,
        canvasSurface,
        fromRole,
        toRole
      );
      legendId = sem.id;
      legendLabel = sem.label;
      color = sem.color;
      applyDashed = sem.dashed;
      strokeWidth = sem.strokeWidth;
    }

    shapes.forEach((shape) => {
      const svgShape = shape as SVGElement;
      applyColorToEdgePathAndMarkers(svgEl, svgShape, color);
      svgShape.style.strokeWidth = strokeWidth;
      shape.setAttribute('data-path-colored', 'true');
      if (applyDashed) {
        svgShape.style.strokeDasharray = '6 4';
        shape.setAttribute('stroke-dasharray', '6 4');
      }
    });

    const existingLegend = legendMap.get(legendId);
    if (existingLegend) {
      existingLegend.count += 1;
    } else {
      legendMap.set(legendId, {
        id: legendId,
        label: legendLabel,
        fillColor: color,
        borderColor: color,
        textColor: canvasSurface === 'dark' ? '#f8fafc' : '#0f172a',
        count: 1,
        kind: 'edge',
        dashed: applyDashed,
      });
    }
  });
}

/**
 * Resolves a safe, high-contrast line color for dark mode (never black/dark gray).
 */
function resolveDarkModeLineColor(preferredLineColor?: string): string {
  if (preferredLineColor && !isColorDark(preferredLineColor)) {
    return preferredLineColor;
  }
  return '#818cf8';
}

/**
 * Ensures all edge paths, sequence/state/class/ER lines, and SVG arrowhead markers
 * are clearly visible on a dark canvas and never remain black (#000 / #333 / #0b0b0b).
 */
function ensureDarkModeEdgeVisibility(
  svgEl: SVGSVGElement,
  solidColor: string,
  asyncColor: string,
  overwriteAllEdges = false
): void {
  const isDashedEdge = (el: Element): boolean => {
    const styleAttr = el.getAttribute('style') || '';
    const dashAttr = el.getAttribute('stroke-dasharray') || '';
    return (
      dashAttr.length > 0 ||
      styleAttr.includes('stroke-dasharray') ||
      el.classList.contains('edge-pattern-dotted') ||
      el.classList.contains('edge-pattern-dashed') ||
      el.classList.contains('messageLine1')
    );
  };

  // 1. Patch embedded <style> rules if Mermaid generated dark/black line or marker rules
  const svgIdAttr = svgEl.getAttribute('id');
  const scopePrefix = svgIdAttr ? `#${svgIdAttr} ` : '';
  const overrideCss = `
${scopePrefix}.flowchart-link,
${scopePrefix}.edgePaths .path,
${scopePrefix}.edgePath path.path,
${scopePrefix}path.transition,
${scopePrefix}path.relationshipLine,
${scopePrefix}line.messageLine0,
${scopePrefix}line.messageLine1,
${scopePrefix}line.actor-line {
  stroke: ${solidColor};
}
${scopePrefix}.arrowheadPath,
${scopePrefix}.arrowMarkerPath,
${scopePrefix}marker:not([data-colored-marker="true"]) path,
${scopePrefix}marker:not([data-colored-marker="true"]) circle,
${scopePrefix}marker:not([data-colored-marker="true"]) polygon {
  fill: ${solidColor};
  stroke: ${solidColor};
}
${scopePrefix}.edgeLabel text,
${scopePrefix}.edgeLabel span,
${scopePrefix}.edgeLabel p {
  color: #e2e8f0;
  fill: #e2e8f0;
}
${scopePrefix}.edgeLabel rect,
${scopePrefix}.labelBkg {
  fill: #0f172a;
  background-color: rgba(15, 23, 42, 0.88);
}
`;

  const styleTags = svgEl.querySelectorAll('style');
  if (styleTags.length > 0) {
    const lastStyle = styleTags[styleTags.length - 1];
    lastStyle.textContent = `${lastStyle.textContent || ''}\n${overrideCss}`;
  } else {
    const nsStyle = svgEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style');
    nsStyle.textContent = overrideCss;
    svgEl.insertBefore(nsStyle, svgEl.firstChild);
  }

  // 2. Directly inspect and fix edge paths & lines (never overwrite already differentiated edges)
  const edgeShapes = svgEl.querySelectorAll(
    'g.edgePaths path, g.edgePath path, path.flowchart-link, path.transition, path.relationshipLine, line.messageLine0, line.messageLine1, line.actor-line, g.mindmap-edges path, path.edge'
  );

  edgeShapes.forEach((el) => {
    if (el.getAttribute('data-path-colored') === 'true' || el.closest('[data-path-colored="true"]')) {
      return;
    }
    const svgShape = el as SVGElement;
    const inlineStroke = svgShape.style.stroke || el.getAttribute('stroke') || '';
    const dashed = isDashedEdge(el);
    const targetStroke = dashed ? asyncColor : solidColor;

    if (
      overwriteAllEdges ||
      !inlineStroke ||
      inlineStroke === 'none' ||
      isColorDark(inlineStroke)
    ) {
      svgShape.style.stroke = targetStroke;
      el.setAttribute('stroke', targetStroke);
      if (!svgShape.style.strokeWidth) {
        svgShape.style.strokeWidth = '2px';
      }
    }
  });

  // 3. Fix uncolored SVG markers & arrowheads so none stay default SVG black (#000)
  const markerShapes = svgEl.querySelectorAll(
    'defs marker path, defs marker polygon, defs marker circle, marker path, marker polygon, marker circle, .arrowheadPath, .arrowMarkerPath'
  );
  markerShapes.forEach((mEl) => {
    if (mEl.closest('[data-colored-marker="true"]')) return;
    const svgMarker = mEl as SVGElement;
    const curFill = svgMarker.style.fill || mEl.getAttribute('fill') || '';
    const curStroke = svgMarker.style.stroke || mEl.getAttribute('stroke') || '';
    if (!curFill || curFill === 'none' || isColorDark(curFill)) {
      svgMarker.style.fill = solidColor;
      mEl.setAttribute('fill', solidColor);
    }
    if (!curStroke || isColorDark(curStroke)) {
      svgMarker.style.stroke = solidColor;
      mEl.setAttribute('stroke', solidColor);
    }
  });
}

const MAX_SMART_COLOR_CACHE = 80;
const smartColorResultCache = new Map<
  string,
  { svg: string; summary: LogicAnalysisSummary }
>();

function computeSmartColorFastHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(36)}_${input.length}`;
}

function buildSmartColorCacheKey(
  rawSvg: string,
  code: string,
  mode: SmartColorMode,
  canvasSurface: 'dark' | 'light',
  preferredLineColor?: string,
  hiddenNodeTypes: SmartColorNodeType[] = [],
  pathColorMode: PathColorMode = 'semantic'
): string {
  const hiddenKey = hiddenNodeTypes.length > 0 ? [...hiddenNodeTypes].sort().join(',') : '';
  return [
    computeSmartColorFastHash(rawSvg),
    computeSmartColorFastHash(code),
    mode,
    pathColorMode,
    canvasSurface,
    preferredLineColor || '',
    hiddenKey,
  ].join('|');
}

function cloneSummary(summary: LogicAnalysisSummary): LogicAnalysisSummary {
  return {
    ...summary,
    legend: summary.legend.map((item) => ({ ...item })),
    detectedTypeCounts: summary.detectedTypeCounts
      ? { ...summary.detectedTypeCounts }
      : undefined,
  };
}

/**
 * Applies Smart Logic Coloring to a rendered Mermaid SVG string and returns both the enhanced SVG
 * and the logic analysis summary (including recommended mode and active legend items).
 */
export function applySmartLogicColoring(
  rawSvg: string,
  code: string,
  mode: SmartColorMode,
  canvasSurface: 'dark' | 'light',
  preferredLineColor?: string,
  hiddenNodeTypes: SmartColorNodeType[] = [],
  pathColorMode: PathColorMode = 'semantic'
): { svg: string; summary: LogicAnalysisSummary } {
  const cacheKey = buildSmartColorCacheKey(
    rawSvg,
    code,
    mode,
    canvasSurface,
    preferredLineColor,
    hiddenNodeTypes,
    pathColorMode
  );
  const cached = smartColorResultCache.get(cacheKey);
  if (cached) {
    smartColorResultCache.delete(cacheKey);
    smartColorResultCache.set(cacheKey, cached);
    return {
      svg: cached.svg,
      summary: cloneSummary(cached.summary),
    };
  }

  const parser = new DOMParser();
  const safeSvg = sanitizeSvgForXmlParser(rawSvg);
  const doc = parser.parseFromString(safeSvg, 'image/svg+xml');
  const svgEl = doc.querySelector('parsererror') ? null : doc.querySelector('svg');

  // Count structural characteristics for recommendation engine
  const subgraphCountInCode = (
    code.match(/^\s*(subgraph|group|section|state\s+\S+\s*\{)/gm) || []
  ).length;
  const asyncEdgeCountInCode = (code.match(/-\.-?>|-->>|\.\.>/g) || []).length;
  const syntaxRoleMap = buildCodeSyntaxRoleMap(code);
  const hiddenTypeSet = new Set<SmartColorNodeType>(hiddenNodeTypes || []);

  if (!svgEl) {
    return {
      svg: rawSvg,
      summary: {
        activeMode: mode,
        recommendedMode: 'semantic',
        recommendationReason: 'Semantische Rollen-Erkennung hebt Knotenfunktionen hervor.',
        legend: [],
        nodeCount: 0,
        hiddenNodeCount: 0,
        detectedTypeCounts: {},
        clusterCount: subgraphCountInCode,
        asyncEdgeCount: asyncEdgeCountInCode,
      },
    };
  }

  const allNodeGroups = Array.from(
    svgEl.querySelectorAll(
      'g.node, g.actor, g.er.entityBox, g.mindmap-node, g.statediagram-state, g.classGroup, g.kanban-item, g.architecture-service'
    )
  );
  const clusterGroups = Array.from(
    svgEl.querySelectorAll('g.cluster, g.architecture-group, g.kanban-column')
  );
  const edgeGroups = Array.from(
    svgEl.querySelectorAll('g.edgePath, g.edgePaths > g, path.er.relationshipLine, path.transition')
  );

  const { allIds: sortedKnownIds, subgraphNodeIds } = collectDeclaredCodeNodeIds(code);
  const detectedTypeCounts: Partial<Record<SmartColorNodeType, number>> = {};
  const nodeClassificationMap = new Map<
    Element,
    {
      filterType: SmartColorNodeType;
      semanticRole: SemanticRoleId;
      shapeHint: 'diamond' | 'cylinder' | 'stadium' | 'subroutine' | 'circle' | 'rect';
    }
  >();

  const hiddenNodeElements = new Set<Element>();
  const hiddenSvgNodeIds = new Set<string>();

  allNodeGroups.forEach((node) => {
    const idAttr = node.getAttribute('id') || '';
    const textContent = (node.textContent || '').trim();

    let shapeHint: 'diamond' | 'cylinder' | 'stadium' | 'subroutine' | 'circle' | 'rect' =
      'rect';
    if (node.querySelector('polygon')) {
      shapeHint = 'diamond';
    } else if (node.querySelector('circle, ellipse')) {
      shapeHint = 'circle';
    } else {
      const pathEl = node.querySelector('path');
      const dAttr = pathEl?.getAttribute('d') || '';
      if (dAttr.includes('a') || dAttr.includes('A')) {
        shapeHint = 'cylinder';
      }
    }

    const classified = classifySmartFilterNodeType(
      idAttr,
      textContent,
      shapeHint,
      syntaxRoleMap,
      node
    );
    nodeClassificationMap.set(node, { ...classified, shapeHint });
    node.setAttribute('data-node-type', classified.filterType);
    node.setAttribute('data-semantic-role', classified.semanticRole);
    const resolvedIdForAttr = extractNodeIdFromSvgElement(node, sortedKnownIds);
    if (resolvedIdForAttr && !node.getAttribute('data-callflow-node-id')) {
      node.setAttribute('data-callflow-node-id', resolvedIdForAttr);
    }
    detectedTypeCounts[classified.filterType] =
      (detectedTypeCounts[classified.filterType] || 0) + 1;

    if (hiddenTypeSet.has(classified.filterType)) {
      hiddenNodeElements.add(node);
      (node as SVGElement).style.display = 'none';
      node.setAttribute('data-smart-hidden', 'true');
      if (resolvedIdForAttr) {
        hiddenSvgNodeIds.add(resolvedIdForAttr);
      }
    }
  });

  // Hide edges and edge labels attached to any filtered-out node without changing source code
  if (hiddenSvgNodeIds.size > 0) {
    const hiddenPatterns = Array.from(hiddenSvgNodeIds).map((hid) => {
      const esc = hid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|[-\\s_])(?:LS_|LE_|L_)?${esc}(?:[-_\\s\\d]|$)`, 'i');
    });

    const svgEdges = Array.from(
      svgEl.querySelectorAll('g.edgePaths > *, g.edgePath, path.flowchart-link, path.transition, path.relationshipLine')
    );
    const svgEdgeLabels = Array.from(
      svgEl.querySelectorAll('g.edgeLabels > *, g.edgeLabel')
    );
    const hiddenEdgeIndices = new Set<number>();

    svgEdges.forEach((edgeEl, idx) => {
      if (edgeElementConnectsHiddenNode(edgeEl, hiddenPatterns)) {
        hiddenEdgeIndices.add(idx);
        (edgeEl as SVGElement).style.display = 'none';
        edgeEl.setAttribute('data-smart-hidden', 'true');
      }
    });

    svgEdgeLabels.forEach((labelEl, idx) => {
      const matchedByMeta = edgeElementConnectsHiddenNode(labelEl, hiddenPatterns);
      const matchedByIndex =
        svgEdgeLabels.length === svgEdges.length && hiddenEdgeIndices.has(idx);
      if (matchedByMeta || matchedByIndex) {
        (labelEl as SVGElement).style.display = 'none';
        labelEl.setAttribute('data-smart-hidden', 'true');
      }
    });

    // Hide empty clusters whose nodes are all hidden
    if (subgraphNodeIds.size > 0 && clusterGroups.length > 0) {
      clusterGroups.forEach((clusterEl) => {
        const cid = clusterEl.getAttribute('id') || '';
        for (const [sgId, memberIds] of subgraphNodeIds.entries()) {
          if (memberIds.size === 0) continue;
          const escSg = sgId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`(?:^|[-_])${escSg}(?:[-_\\d]|$)`, 'i').test(cid)) {
            const allHidden = Array.from(memberIds).every((mId) => hiddenSvgNodeIds.has(mId));
            if (allHidden) {
              (clusterEl as SVGElement).style.display = 'none';
              clusterEl.setAttribute('data-smart-hidden', 'true');
            }
            break;
          }
        }
      });
    }
  }

  const nodeGroups = allNodeGroups.filter((n) => !hiddenNodeElements.has(n));

  // Determine the best recommended mode based on visible diagram structure
  let recommendedMode: SmartColorMode = 'semantic';
  let recommendationReason = 'Erkennt Knoten-Rollen (Services, DBs, Entscheidungen, Clients)';

  if (clusterGroups.length >= 3 || subgraphCountInCode >= 3) {
    recommendedMode = 'clusters';
    recommendationReason = `${Math.max(clusterGroups.length, subgraphCountInCode)} Architektur-Zonen erkannt — Ebenen-Fokus trennt Gruppen optimal`;
  } else if (asyncEdgeCountInCode >= 3 && nodeGroups.length >= 5) {
    recommendedMode = 'semantic';
    recommendationReason = `${nodeGroups.length} Knoten & ${asyncEdgeCountInCode} Event-Flüsse erkannt — Semantische Rollen empfohlen`;
  } else if (nodeGroups.length >= 8) {
    recommendedMode = 'high-contrast';
    recommendationReason = `Komplexes Diagramm (${nodeGroups.length} Elemente) — Hoher Kontrast verbessert Pfad-Lesbarkeit`;
  }

  const darkLineColor = resolveDarkModeLineColor(preferredLineColor);
  const legendMap = new Map<string, LegendItem>();

  // MODE 1: SEMANTIC ROLES (Knoten-Rollen + Datenfluss-Akzente)
  if (mode === 'semantic') {
    nodeGroups.forEach((node) => {
      const classified = nodeClassificationMap.get(node);
      const idAttr = node.getAttribute('id') || '';
      const textContent = (node.textContent || '').trim();
      const role =
        classified?.semanticRole ||
        classifySemanticRole(`${idAttr} ${textContent}`, 'rect', syntaxRoleMap);
      const palette = SEMANTIC_PALETTES[role];
      const colors = canvasSurface === 'dark' ? palette.dark : palette.light;

      const shapes = node.querySelectorAll(
        'rect, polygon, circle, ellipse, path.label-container, path.basic, g.label-container > path'
      );
      // Fallback if specific class selectors didn't match inner shape
      const targetShapes =
        shapes.length > 0
          ? Array.from(shapes)
          : Array.from(node.children).filter((el) =>
              ['rect', 'polygon', 'circle', 'ellipse', 'path'].includes(
                el.tagName.toLowerCase()
              )
            );

      targetShapes.forEach((shape) => {
        // Avoid coloring tiny decorative line paths inside cylinder caps with solid fill if not appropriate
        (shape as SVGElement).style.fill = colors.fill;
        (shape as SVGElement).style.stroke = colors.border;
        (shape as SVGElement).style.strokeWidth = '2px';
        shape.setAttribute('fill', colors.fill);
        shape.setAttribute('stroke', colors.border);
      });

      applyGroupTextStyle(node, colors.text, '600');

      const existing = legendMap.get(palette.id);
      if (existing) {
        existing.count += 1;
      } else {
        legendMap.set(palette.id, {
          id: palette.id,
          label: palette.label,
          fillColor: colors.fill,
          borderColor: colors.border,
          textColor: colors.text,
          count: 1,
          kind: 'node',
        });
      }
    });
  }

  // MODE 2: CLUSTERS & LAYERS (Ebenen- & Subgraph-Fokus)
  if (mode === 'clusters') {
    if (clusterGroups.length > 0) {
      clusterGroups.forEach((cluster, index) => {
        const zone = CLUSTER_ZONE_PALETTES[index % CLUSTER_ZONE_PALETTES.length];
        const colors = canvasSurface === 'dark' ? zone.dark : zone.light;
        const clusterTitle =
          (cluster.querySelector('.cluster-label, text, foreignObject')?.textContent || '')
            .trim() || zone.name;

        const rectOrPath = cluster.querySelector('rect, path, polygon');
        if (rectOrPath) {
          (rectOrPath as SVGElement).style.fill = colors.bg;
          (rectOrPath as SVGElement).style.stroke = colors.border;
          (rectOrPath as SVGElement).style.strokeWidth = '2px';
          rectOrPath.setAttribute('fill', colors.bg);
          rectOrPath.setAttribute('stroke', colors.border);
        }

        applyGroupTextStyle(cluster, colors.text, '600');

        const legendKey = `cluster-${index}`;
        legendMap.set(legendKey, {
          id: legendKey,
          label: clusterTitle.slice(0, 28),
          fillColor: colors.nodeFill,
          borderColor: colors.border,
          textColor: colors.text,
          count: 1,
        });
      });

      // Color nodes harmoniously by matching their bounding position or cycling through cluster palettes
      nodeGroups.forEach((node, idx) => {
        const zone = CLUSTER_ZONE_PALETTES[idx % Math.max(1, clusterGroups.length) % CLUSTER_ZONE_PALETTES.length];
        const colors = canvasSurface === 'dark' ? zone.dark : zone.light;
        const shapes = Array.from(node.children).filter((el) =>
          ['rect', 'polygon', 'circle', 'ellipse', 'path'].includes(el.tagName.toLowerCase())
        );
        shapes.forEach((shape) => {
          (shape as SVGElement).style.fill = colors.nodeFill;
          (shape as SVGElement).style.stroke = colors.nodeBorder;
          (shape as SVGElement).style.strokeWidth = '2px';
        });
        applyGroupTextStyle(node, colors.text, '500');
      });
    } else {
      // If no subgraphs exist, group nodes by vertical/horizontal sequence into clear visual tiers
      nodeGroups.forEach((node, index) => {
        const tierIndex = Math.floor(index / Math.max(1, Math.ceil(nodeGroups.length / 4)));
        const zone = CLUSTER_ZONE_PALETTES[tierIndex % CLUSTER_ZONE_PALETTES.length];
        const colors = canvasSurface === 'dark' ? zone.dark : zone.light;

        const shapes = Array.from(node.children).filter((el) =>
          ['rect', 'polygon', 'circle', 'ellipse', 'path'].includes(el.tagName.toLowerCase())
        );
        shapes.forEach((shape) => {
          (shape as SVGElement).style.fill = colors.nodeFill;
          (shape as SVGElement).style.stroke = colors.nodeBorder;
          (shape as SVGElement).style.strokeWidth = '2px';
        });
        applyGroupTextStyle(node, colors.text, '600');

        const key = `tier-${tierIndex}`;
        const existing = legendMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          legendMap.set(key, {
            id: key,
            label: `Stufe ${tierIndex + 1}`,
            fillColor: colors.nodeFill,
            borderColor: colors.border,
            textColor: colors.text,
            count: 1,
          });
        }
      });
    }
  }

  // MODE 3: HIGH CONTRAST & DATA FLOW (Hoher Kontrast & Pfad-Fokus)
  if (mode === 'high-contrast') {
    nodeGroups.forEach((node) => {
      const idAttr = node.getAttribute('id') || '';
      const textContent = (node.textContent || '').trim();
      const role = classifySemanticRole(`${idAttr} ${textContent}`, 'rect', syntaxRoleMap);

      const isDark = canvasSurface === 'dark';
      let fill = isDark ? '#090d16' : '#ffffff';
      let border = isDark ? '#38bdf8' : '#0284c7';
      let text = isDark ? '#ffffff' : '#090d16';

      if (role === 'decision-gate') {
        border = isDark ? '#facc15' : '#ca8a04';
      } else if (role === 'storage-db') {
        border = isDark ? '#4ade80' : '#16a34a';
      } else if (role === 'error-alert') {
        border = isDark ? '#fb7185' : '#e11d48';
      } else if (role === 'async-queue') {
        border = isDark ? '#c084fc' : '#9333ea';
      }

      const shapes = Array.from(node.children).filter((el) =>
        ['rect', 'polygon', 'circle', 'ellipse', 'path'].includes(el.tagName.toLowerCase())
      );
      shapes.forEach((shape) => {
        (shape as SVGElement).style.fill = fill;
        (shape as SVGElement).style.stroke = border;
        (shape as SVGElement).style.strokeWidth = '2.75px';
      });
      applyGroupTextStyle(node, text, '700');
    });
  }

  // Differentiate edge paths & arrowheads cleanly in Mode A ('semantic') or Mode B ('branches')
  applyPathColorDifferentiation(
    svgEl,
    code,
    pathColorMode,
    canvasSurface,
    syntaxRoleMap,
    legendMap
  );

  if (canvasSurface === 'dark') {
    const asyncCol =
      mode === 'semantic'
        ? '#c084fc'
        : mode === 'high-contrast'
        ? '#f59e0b'
        : darkLineColor;
    const solidCol = mode === 'high-contrast' ? '#38bdf8' : darkLineColor;
    ensureDarkModeEdgeVisibility(
      svgEl,
      solidCol,
      asyncCol,
      false
    );
  }

  // Decorate any visible node flagged as `openIssue` or `missingScript` with a crisp SVG red sphere ("rote Kugel")
  let openIssueSvgCount = 0;
  const svgNs = 'http://www.w3.org/2000/svg';
  const allNodesForOpen = Array.from(
    svgEl.querySelectorAll('g.node, g.statediagram-state')
  ).filter((n) => !hiddenNodeElements.has(n));

  for (const node of allNodesForOpen) {
    const labelTxt = (node.textContent || '').trim();
    const isMissing = node.classList.contains('missingScript');
    const hasOpen =
      isMissing ||
      node.classList.contains('openIssue') ||
      labelTxt.includes('●');
    if (!hasOpen) continue;

    openIssueSvgCount++;

    // Enforce crimson stroke so open status stands out in all color modes
    const shapes = node.querySelectorAll('rect, polygon, path, circle, ellipse');
    shapes.forEach((shape) => {
      if (shape.closest('.open-issue-sphere')) return;
      (shape as SVGElement).style.stroke = '#ef4444';
      shape.setAttribute('stroke', '#ef4444');
      (shape as SVGElement).style.strokeWidth = '2.5px';
      if (isMissing) {
        (shape as SVGElement).style.strokeDasharray = '6 4';
        shape.setAttribute('stroke-dasharray', '6 4');
      }
    });

    // Compute local top-right corner from child shape geometry (works without browser getBBox)
    let cornerX = 48;
    let cornerY = -18;
    const rectEl = node.querySelector('rect');
    const polyEl = node.querySelector('polygon');
    if (rectEl) {
      const rx = parseFloat(rectEl.getAttribute('x') || '0') || 0;
      const ry = parseFloat(rectEl.getAttribute('y') || '0') || 0;
      const rw = parseFloat(rectEl.getAttribute('width') || '0') || 0;
      if (rw > 0) {
        cornerX = rx + rw - 4;
        cornerY = ry + 4;
      }
    } else if (polyEl) {
      const pts = (polyEl.getAttribute('points') || '')
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(',').map(Number))
        .filter((xy) => xy.length === 2 && Number.isFinite(xy[0]) && Number.isFinite(xy[1]));
      if (pts.length > 0) {
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        cornerX = Math.max(...xs) - 4;
        cornerY = Math.min(...ys) + 4;
      }
    }

    const countMatch = labelTxt.match(/●\s*(\d+)\s*Offen/i);
    const badgeNum = countMatch ? countMatch[1] : '';

    const sphereGroup = doc.createElementNS(svgNs, 'g');
    sphereGroup.setAttribute('class', 'open-issue-sphere');
    sphereGroup.setAttribute('data-open-issue', 'true');

    const outerCircle = doc.createElementNS(svgNs, 'circle');
    outerCircle.setAttribute('cx', String(cornerX));
    outerCircle.setAttribute('cy', String(cornerY));
    outerCircle.setAttribute('r', badgeNum ? '9.5' : '7.5');
    outerCircle.setAttribute('fill', '#dc2626');
    outerCircle.setAttribute(
      'stroke',
      canvasSurface === 'dark' ? '#0f172a' : '#ffffff'
    );
    outerCircle.setAttribute('stroke-width', '2');
    sphereGroup.appendChild(outerCircle);

    if (badgeNum) {
      const txtEl = doc.createElementNS(svgNs, 'text');
      txtEl.setAttribute('x', String(cornerX));
      txtEl.setAttribute('y', String(cornerY + 3.5));
      txtEl.setAttribute('text-anchor', 'middle');
      txtEl.setAttribute('font-size', '10');
      txtEl.setAttribute('font-weight', '700');
      txtEl.setAttribute('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace');
      txtEl.setAttribute('fill', '#ffffff');
      txtEl.textContent = badgeNum;
      sphereGroup.appendChild(txtEl);
    }

    node.appendChild(sphereGroup);
  }

  if (openIssueSvgCount > 0) {
    legendMap.set('open-issues', {
      id: 'open-issues',
      label: 'Offene Punkte / Rückfragen (●)',
      fillColor: '#dc2626',
      borderColor: '#ef4444',
      textColor: '#ffffff',
      count: openIssueSvgCount,
    });
  }

  const serializer = new XMLSerializer();
  const result = {
    svg: serializer.serializeToString(svgEl),
    summary: {
      activeMode: mode,
      recommendedMode,
      recommendationReason,
      legend: Array.from(legendMap.values()),
      nodeCount: nodeGroups.length,
      hiddenNodeCount: hiddenNodeElements.size,
      detectedTypeCounts,
      clusterCount: Math.max(clusterGroups.length, subgraphCountInCode),
      asyncEdgeCount: Math.max(asyncEdgeCountInCode, edgeGroups.length),
    },
  };

  if (smartColorResultCache.has(cacheKey)) {
    smartColorResultCache.delete(cacheKey);
  }
  smartColorResultCache.set(cacheKey, result);
  if (smartColorResultCache.size > MAX_SMART_COLOR_CACHE) {
    const oldestKey = smartColorResultCache.keys().next().value;
    if (oldestKey !== undefined) {
      smartColorResultCache.delete(oldestKey);
    }
  }

  return {
    svg: result.svg,
    summary: cloneSummary(result.summary),
  };
}

/**
 * Generates and appends Mermaid `classDef` and `class` statements directly into Flowchart code
 * if the user wants to persist the detected semantic colors in their source text.
 */
export function injectSmartColorsIntoCode(
  code: string,
  canvasSurface: 'dark' | 'light',
  hiddenNodeTypes: SmartColorNodeType[] = []
): string {
  const isFlowchart = /^\s*(flowchart|graph)\b/m.test(code);
  if (!isFlowchart) {
    return code;
  }

  // Strip previous auto-generated block if present
  const cleaned = code.replace(
    /\n*%% --- AUTO-LOGIK-FARBEN START ---[\s\S]*?%% --- AUTO-LOGIK-FARBEN ENDE ---\n*/g,
    '\n'
  );

  const hiddenSet = new Set<SmartColorNodeType>(hiddenNodeTypes || []);
  const roleMap = buildCodeSyntaxRoleMap(cleaned);
  const filteredRoleMap = new Map<string, SemanticRoleId>();
  // Also scan all node declarations `ID["Label"]`
  const nodeMatches = cleaned.matchAll(
    /\b([A-Za-z0-9_]+)\s*(?:\["([^"]+)"\]|\["?([^"\]]+)"?\]|\(\("?([^"\)]+)"?\)\)|\(\["?([^"\]]+)"?\]\)|\{\{"?([^"\}]+)"?\}\}|\{"?([^"\}]+)"?\}|\[\("?([^"\)]+)"?\)\]|\[\["?([^"\]]+)"?\]\])/g
  );

  for (const m of nodeMatches) {
    const id = m[1];
    if (['subgraph', 'end', 'direction', 'classDef', 'class', 'style'].includes(id)) {
      continue;
    }
    const label = m[2] || m[3] || m[4] || m[5] || m[6] || m[7] || m[8] || m[9] || '';
    const existingHint = roleMap.get(id);
    const shapeHint =
      existingHint === 'storage-db'
        ? 'cylinder'
        : existingHint === 'decision-gate'
        ? 'diamond'
        : existingHint === 'async-queue'
        ? 'subroutine'
        : existingHint === 'start-actor'
        ? 'stadium'
        : 'rect';
    const classified = classifySmartFilterNodeType(id, label, shapeHint, roleMap);
    if (hiddenSet.has(classified.filterType)) {
      continue;
    }
    filteredRoleMap.set(id, classified.semanticRole);
  }

  if (filteredRoleMap.size === 0) return code;

  const grouped = new Map<SemanticRoleId, string[]>();
  for (const [nodeId, role] of filteredRoleMap.entries()) {
    const list = grouped.get(role) || [];
    if (!list.includes(nodeId)) list.push(nodeId);
    grouped.set(role, list);
  }

  const lines: string[] = [
    '',
    '    %% --- AUTO-LOGIK-FARBEN START ---',
  ];

  for (const [role, ids] of grouped.entries()) {
    const pal = SEMANTIC_PALETTES[role];
    const col = canvasSurface === 'dark' ? pal.dark : pal.light;
    const className = `role_${role.replace('-', '_')}`;
    lines.push(
      `    classDef ${className} fill:${col.fill},stroke:${col.border},stroke-width:2px,color:${col.text};`
    );
    lines.push(`    class ${ids.join(',')} ${className};`);
  }

  lines.push('    %% --- AUTO-LOGIK-FARBEN ENDE ---');
  return `${cleaned.trimEnd()}\n${lines.join('\n')}\n`;
}
