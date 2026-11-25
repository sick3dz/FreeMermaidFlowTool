import JSZip from 'jszip';
import {
  ScriptChoiceOption,
  ScriptModule,
  ScriptRule,
} from '../types/mermaidStudio';
import {
  canonicalScriptMatchKey,
  extractReadableScheduleAndHolidayFromText,
  isPlausibleNamedScriptTarget,
  isValidScriptRef,
  normalizeScriptRef,
} from './scriptCallflowParser';

interface VisioExtractedShape {
  id: string;
  text: string;
  x: number;
  y: number;
  props: Record<string, string>;
  isConnector: boolean;
}

interface VisioExtractedEdge {
  fromShapeId: string;
  toShapeId: string;
  label: string;
}

function cleanVisioText(raw: string): string {
  return raw
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFirstScriptTargetRef(text: string): string | undefined {
  // Ignore dates, clock times, durations/units, and priority numbers before extracting 3-to-6-digit script/CDN IDs
  const withoutDates = text
    .replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    .replace(/\b\d+\s*(?:ms|sek(?:unden)?|sec|min(?:uten)?|std)\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, ' ')
    .replace(/\b\d+s\b/gi, ' ')
    .replace(/\bprio(?:rit[aä]t)?\s*[:=]?\s*\d+\b/gi, ' ')
    .trim();

  const withoutQuoted = withoutDates.replace(/(["'])(?:\\.|[^"'\\])*\1/g, ' ');
  const explicitNamed =
    withoutQuoted.match(
      /\b(?:wohin|ziel|sprung|script|skript|subscript|execute(?:\s+script)?|call\s+script|goto|schaltung|transfer(?:\s+to)?|route(?:\s+call)?(?:\s+to)?|cdn)\s*[:=]?\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?\b/i
    ) ||
    withoutQuoted.match(
      /^\s*call\s+["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?\b/i
    ) ||
    withoutDates.match(
      /(?:->|=>)\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?\b/
    );
  if (explicitNamed && isValidScriptRef(explicitNamed[1])) {
    return normalizeScriptRef(explicitNamed[1]);
  }

  const numMatch = withoutDates.match(/\b(\d{3,6})\b/);
  if (numMatch) return numMatch[1];

  const namedScriptToken = withoutDates.match(
    /\b([A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]*(?:script|schaltung)[A-Za-z0-9ÄÖÜäöüß_-]*)\b/i
  );
  if (namedScriptToken && isPlausibleNamedScriptTarget(namedScriptToken[1])) {
    return normalizeScriptRef(namedScriptToken[1]);
  }

  // Standalone free script identifier on a Visio box (e.g. `Main`, `Schaltung1`, `Vertrieb_VIP`)
  if (
    /^[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,}$/.test(withoutDates) &&
    isPlausibleNamedScriptTarget(withoutDates)
  ) {
    return normalizeScriptRef(withoutDates);
  }

  return undefined;
}

function getNumericCell(shapeEl: Element, cellName: string): number {
  const cells = Array.from(shapeEl.getElementsByTagName('Cell'));
  for (const c of cells) {
    if (c.getAttribute('N') === cellName) {
      const val = parseFloat(c.getAttribute('V') || '');
      if (Number.isFinite(val)) return val;
    }
  }
  return 0;
}

function parseVisioXmlPage(
  xmlDoc: Document,
  pageName: string,
  pageIndex: number,
  sourceFilename: string
): ScriptModule | null {
  const pageContents = xmlDoc.getElementsByTagName('PageContents')[0] || xmlDoc.documentElement;
  if (!pageContents) return null;

  const shapeElements = Array.from(pageContents.getElementsByTagName('Shape'));
  const shapesMap = new Map<string, VisioExtractedShape>();
  const connectorTexts = new Map<string, string>();

  for (const shapeEl of shapeElements) {
    const id = shapeEl.getAttribute('ID') || '';
    if (!id) continue;

    // Collect text inside direct or descendant <Text>
    let textParts: string[] = [];
    const textEls = Array.from(shapeEl.getElementsByTagName('Text'));
    for (const tEl of textEls) {
      const txt = cleanVisioText(tEl.textContent || '');
      if (txt) textParts.push(txt);
    }
    const text = cleanVisioText(textParts.join(' '));

    // Extract Visio Shape Data properties (<Section N="Property"> -> <Row> -> Value)
    const props: Record<string, string> = {};
    const rows = Array.from(shapeEl.getElementsByTagName('Row'));
    for (const row of rows) {
      const rowName = row.getAttribute('N') || '';
      const cells = Array.from(row.getElementsByTagName('Cell'));
      let label = rowName;
      let val = '';
      for (const c of cells) {
        const cn = c.getAttribute('N');
        if (cn === 'Label' && c.getAttribute('V')) label = c.getAttribute('V')!;
        if (cn === 'Value' && c.getAttribute('V')) val = c.getAttribute('V')!;
      }
      if (label && val) {
        props[label] = val;
      }
    }

    const beginX = getNumericCell(shapeEl, 'BeginX');
    const endX = getNumericCell(shapeEl, 'EndX');
    const nameU = (shapeEl.getAttribute('NameU') || shapeEl.getAttribute('Name') || '').toLowerCase();
    const isConnector =
      (beginX !== 0 || endX !== 0 || nameU.includes('connector') || nameU.includes('verbinder')) &&
      shapeEl.getElementsByTagName('Cell').length > 0;

    if (isConnector) {
      if (text) connectorTexts.set(id, text);
      continue;
    }

    const x = getNumericCell(shapeEl, 'PinX');
    const y = getNumericCell(shapeEl, 'PinY');

    if (text || Object.keys(props).length > 0) {
      shapesMap.set(id, {
        id,
        text: text || Object.values(props).join(' · '),
        x,
        y,
        props,
        isConnector: false,
      });
    }
  }

  // Parse <Connect> elements linking connector shapes (FromSheet) to 2D shapes (ToSheet)
  const connects = Array.from(pageContents.getElementsByTagName('Connect'));
  const connEndpoints = new Map<string, { beginTo?: string; endTo?: string }>();
  for (const conn of connects) {
    const fromSheet = conn.getAttribute('FromSheet') || '';
    const toSheet = conn.getAttribute('ToSheet') || '';
    const fromCell = conn.getAttribute('FromCell') || '';
    if (!fromSheet || !toSheet) continue;

    const entry = connEndpoints.get(fromSheet) || {};
    if (/Begin/i.test(fromCell)) {
      entry.beginTo = toSheet;
    } else if (/End/i.test(fromCell)) {
      entry.endTo = toSheet;
    } else if (!entry.beginTo) {
      entry.beginTo = toSheet;
    } else {
      entry.endTo = toSheet;
    }
    connEndpoints.set(fromSheet, entry);
  }

  const edges: VisioExtractedEdge[] = [];
  for (const [connId, endpoints] of connEndpoints.entries()) {
    if (endpoints.beginTo && endpoints.endTo && endpoints.beginTo !== endpoints.endTo) {
      edges.push({
        fromShapeId: endpoints.beginTo,
        toShapeId: endpoints.endTo,
        label: connectorTexts.get(connId) || '',
      });
    }
  }

  if (shapesMap.size === 0) return null;

  // Determine 4-digit script number from page name, filename, or top/start shapes
  const sortedShapes = Array.from(shapesMap.values()).sort((a, b) => {
    if (Math.abs(b.y - a.y) > 0.35) return b.y - a.y; // top-to-bottom first
    return a.x - b.x;
  });

  const cdnFromPage = extractFirstScriptTargetRef(pageName);
  const cdnFromFile = extractFirstScriptTargetRef(sourceFilename);
  let cdnFromFirstShape: string | undefined;
  for (const s of sortedShapes.slice(0, 4)) {
    const found = extractFirstScriptTargetRef(s.text);
    if (found) {
      cdnFromFirstShape = found;
      break;
    }
  }

  const scriptNumber =
    cdnFromPage ||
    cdnFromFirstShape ||
    cdnFromFile ||
    String(8001 + pageIndex);

  const cleanFileTitle = sourceFilename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const scriptName =
    (pageName && !/^Page-\d+$|^Zeichenblatt-\d+$/i.test(pageName) ? pageName : '') ||
    cleanFileTitle ||
    `Visio Flow ${scriptNumber}`;

  return convertExtractedShapesToModule({
    scriptNumber,
    scriptName,
    visioPageName: pageName || `Seite ${pageIndex + 1}`,
    sourceFilename,
    shapes: sortedShapes,
    edges,
  });
}

function convertExtractedShapesToModule(params: {
  scriptNumber: string;
  scriptName: string;
  visioPageName: string;
  sourceFilename: string;
  shapes: VisioExtractedShape[];
  edges: VisioExtractedEdge[];
}): ScriptModule {
  const { scriptNumber, scriptName, visioPageName, sourceFilename, shapes, edges } = params;
  const shapeById = new Map(shapes.map((s) => [s.id, s]));

  // Build adjacency for Visio shapes
  const outgoingEdgesByShape = new Map<string, VisioExtractedEdge[]>();
  edges.forEach((e) => {
    const list = outgoingEdgesByShape.get(e.fromShapeId) || [];
    list.push(e);
    outgoingEdgesByShape.set(e.fromShapeId, list);
  });

  const rules: ScriptRule[] = [];
  const outNumbers = new Set<string>();

  shapes.forEach((shape, idx) => {
    const txt = shape.text;
    const outEdges = outgoingEdgesByShape.get(shape.id) || [];
    const propEntries = Object.entries(shape.props)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');

    // Detect fields from Visio box text
    const isSchedule = /\b(?:zeit|zeitplan|öffnung|oeffnung|uhr|mo-fr|werktag|geschäftszeit)\b/i.test(txt);
    const isHoliday = /\b(?:feiertag|sondertag|holiday)\b/i.test(txt);
    const isAnnouncement = /\b(?:ansage|prompt|wav|begrüßung|begruessung|text|info-ansage)\b/i.test(txt);
    const isQueue = /\b(?:queue|skillset|skill|warteschlange|agent|gruppe|team)\b/i.test(txt);
    const isCondition = /\?|\b(?:wenn|falls|bedingung|abfrage|prüfung|pruefung|status|vip)\b/i.test(txt);

    let targetNumber: string | undefined;
    const choices: ScriptChoiceOption[] = [];

    // Inspect connected target Visio shapes + connector labels
    const selfKey = canonicalScriptMatchKey(scriptNumber);
    outEdges.forEach((edge, edgeIdx) => {
      const targetShape = shapeById.get(edge.toShapeId);
      const targetCdn =
        (targetShape ? extractFirstScriptTargetRef(targetShape.text) : undefined) ||
        extractFirstScriptTargetRef(edge.label);

      if (targetCdn && canonicalScriptMatchKey(targetCdn) !== selfKey) {
        outNumbers.add(targetCdn);
        if (!edge.label && outEdges.length === 1 && !targetNumber) {
          targetNumber = targetCdn;
        } else {
          choices.push({
            choice: edge.label || `Pfad ${edgeIdx + 1}`,
            targetNumber: targetCdn,
            label: targetShape?.text ? targetShape.text.slice(0, 42) : undefined,
          });
        }
      } else if (edge.label && targetShape) {
        const internalNum = extractFirstScriptTargetRef(targetShape.text);
        if (internalNum && canonicalScriptMatchKey(internalNum) !== selfKey) {
          outNumbers.add(internalNum);
          choices.push({
            choice: edge.label,
            targetNumber: internalNum,
          });
        }
      }
    });

    // Also inspect shape's own text for explicit jump/Sprung/CDN/Target 3-to-6-digit numbers or named scripts
    if (!targetNumber) {
      const txtNoQuoted = txt.replace(/(["'])(?:\\.|[^"'\\])*\1/g, ' ');
      const explicitJump =
        txtNoQuoted.match(
          /\b(?:wohin|ziel|sprung|cdn|transfer(?:\s+to)?|route(?:\s+call)?(?:\s+to)?|weiter(?:leitung)?|nach|execute(?:\s+script)?|call\s+script|script|skript)\s*[:=]?\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?\b/i
        ) ||
        txtNoQuoted.match(
          /^\s*call\s+["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?\b/i
        ) ||
        txt.match(
          /\b([A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]*(?:script|schaltung)[A-Za-z0-9ÄÖÜäöüß_-]*)\b/i
        );
      if (
        explicitJump &&
        canonicalScriptMatchKey(explicitJump[1]) !== selfKey &&
        isValidScriptRef(explicitJump[1])
      ) {
        targetNumber = normalizeScriptRef(explicitJump[1]);
        outNumbers.add(targetNumber);
      }
    }

    // Also detect queue name if present
    let queueTarget: string | undefined;
    const qMatch = txt.match(/\b(?:queue|skillset|skill|warteschlange)\s*[:=]?\s*([A-Za-z0-9_äöüÄÖÜß-]+)/i);
    if (qMatch) {
      queueTarget = qMatch[1];
    } else if (isQueue && outEdges.length === 0 && !targetNumber) {
      queueTarget = txt.slice(0, 42);
    }

    const parsedVisioTime = extractReadableScheduleAndHolidayFromText(txt);
    rules.push({
      id: `${scriptNumber}-visio-${idx + 1}`,
      prio: idx + 1,
      stepName: txt.slice(0, 72) || `Visio-Schritt ${idx + 1}`,
      sourceNumber: scriptNumber,
      targetNumber,
      choices,
      schedule:
        parsedVisioTime.schedule || (isSchedule ? txt.slice(0, 160) : undefined),
      holiday: parsedVisioTime.holiday || (isHoliday ? txt.slice(0, 80) : undefined),
      announcement: isAnnouncement ? txt.slice(0, 80) : undefined,
      condition: isCondition ? txt.slice(0, 90) : propEntries || undefined,
      queueTarget,
      rawLine: `[Visio: ${visioPageName}] ${txt}${outEdges.length > 0 ? ` (Ausgänge: ${outEdges.length})` : ''}`,
    });
  });

  return {
    scriptNumber,
    scriptName,
    isMaster:
      /^(?:main|master(?:script)?)$/i.test(scriptNumber) ||
      /master|zentrale|haupt/i.test(scriptName),
    origin: 'visio-new',
    visioPageName,
    sourceFilename,
    rawText: shapes.map((s) => s.text).join('\n'),
    rules,
    outgoingNumbers: Array.from(outNumbers),
  };
}

function parseVisioSvgExport(svgText: string, sourceFilename: string): ScriptModule[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgEl = doc.documentElement;
  if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') return [];

  const shapes: VisioExtractedShape[] = [];
  const groups = Array.from(svgEl.querySelectorAll('g'));
  const seenTexts = new Set<string>();

  groups.forEach((g, idx) => {
    // Skip connector groups in Visio SVG exports
    const groupCtx = g.getAttribute('v:groupContext') || '';
    if (groupCtx === 'connector') return;

    // Only collect leaf-level shape groups that hold text
    const childGroupsWithText = Array.from(g.querySelectorAll('g')).some(
      (sub) => cleanVisioText(sub.textContent || '').length > 0
    );
    if (childGroupsWithText) return;

    const textParts: string[] = [];
    g.querySelectorAll('text, tspan').forEach((t) => {
      const txt = cleanVisioText(t.textContent || '');
      if (txt) textParts.push(txt);
    });
    const combined = cleanVisioText(textParts.join(' '));
    if (!combined || seenTexts.has(combined)) return;
    seenTexts.add(combined);

    const titleEl = g.querySelector(':scope > title');
    const props: Record<string, string> = {};
    if (titleEl?.textContent) {
      props['Shape'] = cleanVisioText(titleEl.textContent);
    }

    shapes.push({
      id: g.getAttribute('id') || `svg-${idx + 1}`,
      text: combined,
      x: 0,
      y: -idx * 10,
      props,
      isConnector: false,
    });
  });

  // Fallback for plain SVGs without nested <g> per shape
  if (shapes.length === 0) {
    svgEl.querySelectorAll('text').forEach((t, idx) => {
      const combined = cleanVisioText(t.textContent || '');
      if (!combined || seenTexts.has(combined)) return;
      seenTexts.add(combined);
      shapes.push({
        id: `svg-txt-${idx + 1}`,
        text: combined,
        x: parseFloat(t.getAttribute('x') || '0') || 0,
        y: -(parseFloat(t.getAttribute('y') || String(idx * 20)) || idx * 20),
        props: {},
        isConnector: false,
      });
    });
  }

  if (shapes.length === 0) return [];

  const cleanFileTitle = sourceFilename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const scriptNumber =
    extractFirstScriptTargetRef(sourceFilename) ||
    extractFirstScriptTargetRef(shapes.slice(0, 4).map((s) => s.text).join(' ')) ||
    '8001';

  return [
    convertExtractedShapesToModule({
      scriptNumber,
      scriptName: cleanFileTitle || `Visio SVG ${scriptNumber}`,
      visioPageName: cleanFileTitle || 'Visio SVG',
      sourceFilename,
      shapes,
      edges: [],
    }),
  ];
}

export function isVisioFilename(filename: string): boolean {
  return /\.(?:vsdx|vdx|svg)$/i.test(filename);
}

/**
 * Parses a Visio export file (.vsdx ZIP package, .vdx XML, or .svg export)
 * 100% locally in the browser into ScriptModule[] tagged with origin: 'visio-new'.
 */
export async function parseVisioFileToModules(
  file: File,
  options?: { overridePrimaryScriptNumber?: string }
): Promise<ScriptModule[]> {
  const name = file.name || 'visio-export';
  const lower = name.toLowerCase();
  let modules: ScriptModule[] = [];

  if (lower.endsWith('.vsdx')) {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const parser = new DOMParser();

    // Map page XML filenames to human-readable page names if pages.xml exists
    const pageNameMap = new Map<string, string>();
    const pagesXmlFile = zip.file('visio/pages/pages.xml');
    if (pagesXmlFile) {
      const pagesXmlText = await pagesXmlFile.async('text');
      const pagesDoc = parser.parseFromString(pagesXmlText, 'application/xml');
      const pageEls = Array.from(pagesDoc.getElementsByTagName('Page'));
      pageEls.forEach((pEl, idx) => {
        const pName = pEl.getAttribute('Name') || pEl.getAttribute('NameU') || '';
        const relEl = pEl.getElementsByTagName('Rel')[0];
        const rId = relEl?.getAttribute('r:id') || '';
        if (pName) {
          pageNameMap.set(`page${idx + 1}.xml`, pName);
          if (rId) pageNameMap.set(rId, pName);
        }
      });
    }

    const pageEntries = Object.keys(zip.files)
      .filter((path) => /^visio\/pages\/page\d+\.xml$/i.test(path))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (let i = 0; i < pageEntries.length; i++) {
      const entryPath = pageEntries[i];
      const baseFilename = entryPath.split('/').pop() || entryPath;
      const xmlText = await zip.files[entryPath].async('text');
      const doc = parser.parseFromString(xmlText, 'application/xml');
      const mod = parseVisioXmlPage(
        doc,
        pageNameMap.get(baseFilename) || `Seite ${i + 1}`,
        i,
        name
      );
      if (mod) {
        modules.push(mod);
      }
    }
  } else if (lower.endsWith('.vdx') || lower.endsWith('.xml')) {
    const text = await file.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    const pageEls = Array.from(doc.getElementsByTagName('Page'));
    if (pageEls.length === 0) {
      const single = parseVisioXmlPage(doc, name.replace(/\.[^.]+$/, ''), 0, name);
      if (single) modules = [single];
    } else {
      pageEls.forEach((pageEl, idx) => {
        const pName = pageEl.getAttribute('Name') || pageEl.getAttribute('NameU') || `Seite ${idx + 1}`;
        // Wrap individual <Page> into a lightweight XML doc fragment
        const subDoc = document.implementation.createDocument(null, 'VisioPage', null);
        subDoc.documentElement.appendChild(subDoc.importNode(pageEl, true));
        const mod = parseVisioXmlPage(subDoc, pName, idx, name);
        if (mod) modules.push(mod);
      });
    }
  } else if (lower.endsWith('.svg')) {
    const text = await file.text();
    modules = parseVisioSvgExport(text, name);
  }

  if (options?.overridePrimaryScriptNumber && modules.length > 0) {
    const targetRef =
      normalizeScriptRef(options.overridePrimaryScriptNumber) ||
      options.overridePrimaryScriptNumber.trim();
    const targetKey = canonicalScriptMatchKey(targetRef);

    let primaryIdx = modules.findIndex(
      (m) => canonicalScriptMatchKey(m.scriptNumber) === targetKey
    );
    if (primaryIdx < 0) {
      primaryIdx = modules.findIndex(
        (m) =>
          /^(?:main|master(?:script)?)$/i.test(canonicalScriptMatchKey(m.scriptNumber)) ||
          m.isMaster
      );
    }
    if (primaryIdx < 0) primaryIdx = 0;

    const primaryMod = modules[primaryIdx];
    const updatedPrimary: ScriptModule = {
      ...primaryMod,
      scriptNumber: targetRef,
      scriptName:
        primaryMod.scriptName && !/^(?:Visio\s+(?:Flow|SVG)|Seite\s*1)/i.test(primaryMod.scriptName)
          ? primaryMod.scriptName
          : targetRef,
      isMaster: targetKey === 'main' ? true : primaryMod.isMaster,
      rules: primaryMod.rules.map((r) => ({ ...r, sourceNumber: targetRef })),
      outgoingNumbers: primaryMod.outgoingNumbers.filter(
        (out) => canonicalScriptMatchKey(out) !== targetKey
      ),
    };
    modules = [updatedPrimary, ...modules.filter((_, idx) => idx !== primaryIdx)];
  }

  return modules;
}
