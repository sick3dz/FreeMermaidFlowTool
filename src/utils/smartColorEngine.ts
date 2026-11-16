import {
  LegendItem,
  LogicAnalysisSummary,
  SmartColorMode,
} from '../types/mermaidStudio';

export type SemanticRoleId =
  | 'start-actor'
  | 'decision-gate'
  | 'storage-db'
  | 'async-queue'
  | 'error-alert'
  | 'core-service';

interface RolePalette {
  id: SemanticRoleId;
  label: string;
  dark: { fill: string; border: string; text: string };
  light: { fill: string; border: string; text: string };
}

const SEMANTIC_PALETTES: Record<SemanticRoleId, RolePalette> = {
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
    /\b(error|fehler|fail|failed|abbruch|exception|ungültig|invalid|401|403|404|422|500|timeout|alert|warnung|ablehnung|denied|reject|kritisch)\b/i.test(
      lower
    )
  ) {
    return 'error-alert';
  }

  // 2. Storage / Database / Persistence
  if (
    shapeHint === 'cylinder' ||
    /\b(db|database|datenbank|postgres|postgresql|mysql|sql|redis|cache|storage|speicher|archiv|archive|s3|disk|bucket|mongo|repository|table|persistenz)\b/i.test(
      lower
    )
  ) {
    return 'storage-db';
  }

  // 3. Decision / Gateway / Security / Firewall
  if (
    shapeHint === 'diamond' ||
    lower.includes('?') ||
    /\b(if|prüfung|pruefung|check|valid|validation|auth|oauth|oidc|idp|waf|firewall|gateway|apigw|entscheidung|bedingung|gate|filter|load\s*balancer|ingress)\b/i.test(
      lower
    )
  ) {
    return 'decision-gate';
  }

  // 4. Async / Event / Queue / Stream
  if (
    shapeHint === 'subroutine' ||
    /\b(kafka|queue|event|events|bus|stream|streaming|topic|worker|webhook|async|message|broker|rabbitmq|pubsub)\b/i.test(
      lower
    )
  ) {
    return 'async-queue';
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
 * - [(...)] -> storage-db
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
    for (const m of cylMatches) map.set(m[1], 'storage-db');
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
    for (const m of stadMatches) map.set(m[1], 'start-actor');
  }

  return map;
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

/**
 * Applies Smart Logic Coloring to a rendered Mermaid SVG string and returns both the enhanced SVG
 * and the logic analysis summary (including recommended mode and active legend items).
 */
export function applySmartLogicColoring(
  rawSvg: string,
  code: string,
  mode: SmartColorMode,
  canvasSurface: 'dark' | 'light'
): { svg: string; summary: LogicAnalysisSummary } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawSvg, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');

  // Count structural characteristics for recommendation engine
  const subgraphCountInCode = (
    code.match(/^\s*(subgraph|group|section|state\s+\S+\s*\{)/gm) || []
  ).length;
  const asyncEdgeCountInCode = (code.match(/-\.-?>|-->>|\.\.>/g) || []).length;
  const syntaxRoleMap = buildCodeSyntaxRoleMap(code);

  if (!svgEl) {
    return {
      svg: rawSvg,
      summary: {
        activeMode: mode,
        recommendedMode: 'semantic',
        recommendationReason: 'Semantische Rollen-Erkennung hebt Knotenfunktionen hervor.',
        legend: [],
        nodeCount: 0,
        clusterCount: subgraphCountInCode,
        asyncEdgeCount: asyncEdgeCountInCode,
      },
    };
  }

  const nodeGroups = Array.from(
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

  // Determine the best recommended mode based on diagram structure
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

  if (mode === 'standard') {
    return {
      svg: rawSvg,
      summary: {
        activeMode: mode,
        recommendedMode,
        recommendationReason,
        legend: [],
        nodeCount: nodeGroups.length,
        clusterCount: Math.max(clusterGroups.length, subgraphCountInCode),
        asyncEdgeCount: asyncEdgeCountInCode,
      },
    };
  }

  const legendMap = new Map<string, LegendItem>();

  // MODE 1: SEMANTIC ROLES (Knoten-Rollen + Datenfluss-Akzente)
  if (mode === 'semantic') {
    nodeGroups.forEach((node) => {
      const idAttr = node.getAttribute('id') || '';
      const textContent = (node.textContent || '').trim();
      const combined = `${idAttr} ${textContent}`;

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

      const role = classifySemanticRole(combined, shapeHint, syntaxRoleMap);
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
        });
      }
    });

    // Also subtly differentiate dashed async edges vs solid edges
    const allPaths = svgEl.querySelectorAll('g.edgePath path.path, g.edgePaths path');
    allPaths.forEach((pathEl) => {
      const styleAttr = pathEl.getAttribute('style') || '';
      const dashAttr = pathEl.getAttribute('stroke-dasharray') || '';
      const isDashed =
        dashAttr.length > 0 ||
        styleAttr.includes('stroke-dasharray') ||
        pathEl.classList.contains('edge-pattern-dotted') ||
        pathEl.classList.contains('edge-pattern-dashed');

      if (isDashed) {
        const asyncColor = canvasSurface === 'dark' ? '#c084fc' : '#7c3aed';
        (pathEl as SVGElement).style.stroke = asyncColor;
        (pathEl as SVGElement).style.strokeWidth = '2.2px';
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

    let syncCount = 0;
    let asyncCount = 0;
    const allPaths = svgEl.querySelectorAll(
      'g.edgePath path.path, g.edgePaths path, line.messageLine0, line.messageLine1'
    );
    allPaths.forEach((pathEl) => {
      const styleAttr = pathEl.getAttribute('style') || '';
      const dashAttr = pathEl.getAttribute('stroke-dasharray') || '';
      const isDashed =
        dashAttr.length > 0 ||
        styleAttr.includes('stroke-dasharray') ||
        pathEl.classList.contains('edge-pattern-dotted') ||
        pathEl.classList.contains('edge-pattern-dashed') ||
        pathEl.classList.contains('messageLine1');

      if (isDashed) {
        asyncCount += 1;
        const asyncStroke = canvasSurface === 'dark' ? '#f59e0b' : '#d97706';
        (pathEl as SVGElement).style.stroke = asyncStroke;
        (pathEl as SVGElement).style.strokeWidth = '2.5px';
      } else {
        syncCount += 1;
        const syncStroke = canvasSurface === 'dark' ? '#38bdf8' : '#0284c7';
        (pathEl as SVGElement).style.stroke = syncStroke;
        (pathEl as SVGElement).style.strokeWidth = '2.5px';
      }
    });

    if (syncCount > 0) {
      legendMap.set('flow-sync', {
        id: 'flow-sync',
        label: 'Synchroner Hauptpfad',
        fillColor: canvasSurface === 'dark' ? '#0c4a6e' : '#e0f2fe',
        borderColor: canvasSurface === 'dark' ? '#38bdf8' : '#0284c7',
        textColor: canvasSurface === 'dark' ? '#f0f9ff' : '#0c4a6e',
        count: syncCount,
      });
    }
    if (asyncCount > 0) {
      legendMap.set('flow-async', {
        id: 'flow-async',
        label: 'Asynchroner Event-Fluss',
        fillColor: canvasSurface === 'dark' ? '#78350f' : '#fef3c7',
        borderColor: canvasSurface === 'dark' ? '#f59e0b' : '#d97706',
        textColor: canvasSurface === 'dark' ? '#fffbeb' : '#78350f',
        count: asyncCount,
      });
    }
  }

  const serializer = new XMLSerializer();
  return {
    svg: serializer.serializeToString(svgEl),
    summary: {
      activeMode: mode,
      recommendedMode,
      recommendationReason,
      legend: Array.from(legendMap.values()),
      nodeCount: nodeGroups.length,
      clusterCount: Math.max(clusterGroups.length, subgraphCountInCode),
      asyncEdgeCount: Math.max(asyncEdgeCountInCode, edgeGroups.length),
    },
  };
}

/**
 * Generates and appends Mermaid `classDef` and `class` statements directly into Flowchart code
 * if the user wants to persist the detected semantic colors in their source text.
 */
export function injectSmartColorsIntoCode(
  code: string,
  canvasSurface: 'dark' | 'light'
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

  const roleMap = buildCodeSyntaxRoleMap(cleaned);
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
    const role = classifySemanticRole(`${id} ${label}`, shapeHint, roleMap);
    roleMap.set(id, role);
  }

  if (roleMap.size === 0) return code;

  const grouped = new Map<SemanticRoleId, string[]>();
  for (const [nodeId, role] of roleMap.entries()) {
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
