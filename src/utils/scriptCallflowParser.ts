import {
  CallflowAnnouncementRegistryItem,
  CallflowBuildingBlockType,
  CallflowCrossRefRegistryItem,
  CallflowGraph,
  CallflowHealthFinding,
  CallflowIssueResolution,
  CallflowOpenIssue,
  CallflowResourceRegistry,
  CallflowRoutingMatrixRow,
  CallflowSkillsetRegistryItem,
  CallflowVariableRegistryItem,
  CallflowViewLevel,
  DiagramDirection,
  MasterScriptChecklistItem,
  NodePositionOffset,
  ResolvedIssueRecord,
  ScriptChoiceOption,
  ScriptManualLink,
  ScriptModule,
  ScriptOrigin,
  ScriptRule,
  ScriptWorkspace,
} from '../types/mermaidStudio';

export const SAMPLE_MULTI_SCRIPT_TEXT = `=== Main ===
Prio: 1 | Name: Zeitplan & Feiertagsprüfung | Zeitplan: Mo-Fr 08:00-18:00 | Feiertag: 9900 | Wohin: Schaltung1
Prio: 2 | Name: Notfall-Direktleitung | Bedingung: Stoerungs-Flag aktiv | Sprung: 9100

=== Schaltung1 ===
Prio: 1 | Name: Begrüßung & Sprachwahl | Ansage: willkommen_dt.wav | Ziel: Vertrieb_VIP | Taste 1->Vertrieb_VIP, Taste 2->3757, Taste 3->TechSupport_DE, Taste 9->9900
Prio: 2 | Name: Timeout Wiederholung | Wohin: Schaltung1

=== Vertrieb_VIP ===
Prio 1: VIP-Routing
Ansage: vip_begruessung.wav
Queue: Vertrieb_VIP
Sprung: TechSupport_DE
Taste 0 -> Schaltung1

Prio 2: Standard-Warteschlange
Queue: Vertrieb_Standard
Wohin: 9900

=== 3757 ===
Prio: 1 | Name: Vertrag & Bestandskunden | Queue: Bestand_DE | Wohin: TechSupport_DE | Auswahl: 8->Schaltung1, 9->9900

=== TechSupport_DE ===
Prio: 1 | Name: Ticket-Status abfragen | Queue: TechSupport_L1 | Wohin: 9900 | Taste 1->9100, Taste 0->Schaltung1

=== 9100 ===
Prio: 1 | Name: Eskalation & Rückruf | Ansage: rueckruf_info.wav | Ziel: 9900

=== 9900 ===
Prio: 1 | Name: Abwurf & Mailbox | Ansage: feierabend_ansage.wav`;

const MERMAID_HEADER_REGEX =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|gitGraph|journey|mindmap|timeline|quadrantChart|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|sankey(?:-beta)?|block(?:-beta)?|xychart(?:-beta)?|kanban|packet(?:-beta)?|architecture(?:-beta)?|zenuml)\b/i;

const SCRIPT_NAME_STOPWORDS = new Set([
  'ende',
  'end',
  'aus',
  'nein',
  'ja',
  'aktiv',
  'inaktiv',
  'deaktiviert',
  'default',
  'default_skillset',
  'null',
  'none',
  'true',
  'false',
  'weiter',
  'fallback',
  'timeout',
  'abwurf',
  'auflegen',
  'mailbox',
  'ansage',
  'musik',
  'queue',
  'warteschlange',
  'skillset',
  'feiertag',
  'zeitplan',
  'bedingung',
  'prio',
  'prioritaet',
  'priorität',
  'name',
  'nummer',
  'wohin',
  'ziel',
  'sprung',
  'auswahl',
  'taste',
  'init',
  'start',
  'return',
  'retour',
  'alle',
  'standard',
  'queue',
  'skill',
  'assign',
  'section',
  'route',
  'call',
  'give',
  'werktag',
  'werktage',
  'wochenende',
  'uhr',
  'mo-fr',
  'mo-so',
  'stoerung',
  'störung',
  'extern',
  'offen',
  'keine',
  'kein',
]);

export function normalizeScriptRef(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^['"`\[\]()]+|['"`\[\]()]+$/g, '')
    .replace(/\s+/g, '_');
  const numeric = cleaned.match(/^(\d{3,6})$/);
  if (numeric) return numeric[1];
  return cleaned;
}

export function canonicalScriptMatchKey(ref: string): string {
  return normalizeScriptRef(ref).toLowerCase();
}

export function toMermaidNodeSuffix(ref: string): string {
  const normalized = normalizeScriptRef(ref);
  if (/^\d{3,6}$/.test(normalized)) return normalized;
  return (
    normalized
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/Ä/g, 'Ae')
      .replace(/Ö/g, 'Oe')
      .replace(/Ü/g, 'Ue')
      .replace(/ß/g, 'ss')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'Item'
  );
}

export function isNumericScriptRef(token: string): boolean {
  return /^\d{3,6}$/.test(normalizeScriptRef(token));
}

export function isPlausibleNamedScriptTarget(token: string): boolean {
  const clean = normalizeScriptRef(token);
  if (!clean || clean.length < 3) return false;
  if (/^\d+$/.test(clean)) return false;
  if (/^sys_/i.test(clean)) return false;
  if (/\.(?:wav|mp3|ogg|ulaw|alaw)$/i.test(clean)) return false;
  if (SCRIPT_NAME_STOPWORDS.has(clean.toLowerCase())) return false;
  return true;
}

export function isValidScriptRef(token: string): boolean {
  return isNumericScriptRef(token) || isPlausibleNamedScriptTarget(token);
}

function sanitizeMermaidText(text: string): string {
  return text.replace(/"/g, "'").replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeNodeKey(text: string): string {
  return toMermaidNodeSuffix(text);
}

function isMetadataOrChangelogLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (
    /^(?:letzte\s+[aä]nderung(?:en)?|[aä]nderungen?(?:\s+(?:von|am|durch))?|[aä]nderungshistorie|historie|changelog|history|revision|version|stand|datum|autor|bearbeiter|erstellt(?:\s+(?:am|von))?|ge[aä]ndert(?:\s+(?:am|von))?|freigabe|go[\s_-]*live|verantwortlich|notiz|kommentar|hinweis|alt|ausgeklammert)\b(?:\s*[:=\-–]|\s+)/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}\b/.test(trimmed) || /^\d{4}-\d{1,2}-\d{1,2}\b/.test(trimmed)) {
    return true;
  }
  return false;
}

function stripDatesAndTimes(text: string): string {
  return text
    .replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    .replace(/\b\d+\s*(?:ms|sek(?:unden)?|sec|min(?:uten)?|std)\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*%/g, ' ')
    .replace(/\b\d+s\b/gi, ' ');
}

function stripNumericNoiseForFreeText(text: string): string {
  return stripDatesAndTimes(text)
    .replace(/\bprio(?:rit[aä]t)?\s*[:=]?\s*\d+\b/gi, ' ')
    .replace(/\b(?:musik(?:-?id)?|ansage(?:-?id)?|wait|wartezeit)\s*[:=]?\s*\d+\b/gi, ' ');
}

/**
 * Strips /* ... * / comments safely (including multi-line, nested /* /* ... * / * /,
 * and unclosed /* ... EOF alt-last blocks) while preserving line breaks.
 */
function stripBlockCommentsSafely(input: string): string {
  let result = '';
  let i = 0;
  let depth = 0;
  const len = input.length;

  while (i < len) {
    const two = input.slice(i, i + 2);
    if (two === '/*') {
      depth += 1;
      i += 2;
      continue;
    }
    if (two === '*/' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        result += ' ';
      }
      i += 2;
      continue;
    }
    if (depth > 0) {
      if (input[i] === '\n') {
        result += '\n';
      }
      i += 1;
      continue;
    }
    result += input[i];
    i += 1;
  }

  return result;
}

/**
 * Strips multi-line /* ... * / and (* ... *) comments, inline // or -- comments,
 * and changelog/revision metadata lines before parsing active routing logic.
 */
function stripScriptCommentsAndNoise(rawText: string): string {
  const withoutBlockComments = stripBlockCommentsSafely(rawText)
    .replace(/\(\*[\s\S]*?\*\)/g, (match) => (match.includes('\n') ? '\n' : ' '));

  return withoutBlockComments
    .split(/\r?\n/)
    .map((line) => {
      const noInline = line
        .replace(/(^|\s)\/\/.*$/, '')
        .replace(/(^|\s)--.*$/, '');
      const trimmed = noInline.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('#') || trimmed.startsWith('%%') || /^REM\b/i.test(trimmed)) {
        return '';
      }
      if (isMetadataOrChangelogLine(trimmed)) {
        return '';
      }
      return noInline;
    })
    .join('\n');
}

interface AaccOrgaContext {
  organizationName?: string;
  orgaCode?: string;
  brandName?: string;
  srcRouteNumber?: string;
}

const KNOWN_ORGA_PREFIXES: Array<{ code: string; name: string; namePattern: RegExp }> = [
  { code: '290', name: 'Rheinland', namePattern: /\brheinland\b|rheinland(?:_?vers)?/i },
  { code: '210', name: 'CreditLife', namePattern: /\bcredit[\s_-]?life\b/i },
  { code: '6099', name: 'Rhion', namePattern: /\brhion\b/i },
];

function detectOrgaFromText(text: string | undefined): {
  organizationName?: string;
  orgaCode?: string;
} {
  if (!text) return {};
  const cleaned = text.trim();
  if (!cleaned) return {};

  // 1. Check 02131 + Orga prefix or Orga prefix + xxxx/digits
  const prefixMatch = cleaned.match(
    /(?:^|[^0-9])(?:0?2131[\s\-/]*)?(6099|290|210)(?:[xX*]{1,6}|\d{0,6})?(?=$|[^0-9])/
  );
  if (prefixMatch && prefixMatch[1]) {
    const code = prefixMatch[1];
    const found = KNOWN_ORGA_PREFIXES.find((o) => o.code === code);
    if (found) {
      return { orgaCode: found.code, organizationName: found.name };
    }
  }

  // 2. Check organization name keywords (e.g. Sys_brand = Rheinland, DNIS_Range_CreditLife)
  for (const orga of KNOWN_ORGA_PREFIXES) {
    if (orga.namePattern.test(cleaned)) {
      return { orgaCode: orga.code, organizationName: orga.name };
    }
  }

  return {};
}

function mergeOrgaContext(
  base?: AaccOrgaContext | null,
  override?: AaccOrgaContext | null
): AaccOrgaContext {
  const organizationName = override?.organizationName || base?.organizationName;
  const orgaCode = override?.orgaCode || base?.orgaCode;
  const brandName = override?.brandName || base?.brandName;
  const srcRouteNumber = override?.srcRouteNumber || base?.srcRouteNumber;
  return { organizationName, orgaCode, brandName, srcRouteNumber };
}

function extractAssignStatements(text: string): Array<{ value: string; variable: string }> {
  const results: Array<{ value: string; variable: string }> = [];
  const assignPattern =
    /\bassign\s+(.+?)\s+to\s+([A-Za-z0-9_]+)(?=\s*(?:assign\b|end\s*if\b|endif\b|else\b|;|$))/gi;
  let m: RegExpExecArray | null;
  while ((m = assignPattern.exec(text)) !== null) {
    const rawVal = m[1].replace(/\s+/g, ' ').trim().replace(/^['"]|['"]$/g, '');
    const varName = m[2].trim();
    if (rawVal && varName) {
      results.push({ value: rawVal, variable: varName });
    }
  }
  return results;
}

function parseChoicesSegment(raw: string, ownNumber?: string): ScriptChoiceOption[] {
  const results: ScriptChoiceOption[] = [];
  const seen = new Set<string>();
  const cleaned = raw
    .replace(
      /^(?:auswahl(?:nummern|optionen)?|option(?:en)?|choices?|dtmf|taste[n]?|menu|menü)\s*[:=]?\s*/i,
      ''
    )
    .trim();

  if (!cleaned) return results;

  // Pattern 1: `Taste 1 -> 210`, `Taste 1 -> 123456`, `Taste 1 -> schaltung1script`
  const pairRegex =
    /(?:taste|dtmf|opt(?:ion)?|auswahl)?\s*([A-Za-z0-9*#]+)\s*(?:->|=>|:|=|nach|zu)\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?\b(?:\s*\(([^)]+)\))?/gi;
  let m: RegExpExecArray | null;
  while ((m = pairRegex.exec(cleaned)) !== null) {
    const choice = m[1].trim();
    const rawTarget = m[2].trim();
    if (!isValidScriptRef(rawTarget)) continue;
    const targetNumber = normalizeScriptRef(rawTarget);
    const label = m[3]?.trim();
    const key = `${choice}->${canonicalScriptMatchKey(targetNumber)}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ choice, targetNumber, label });
    }
  }

  // Pattern 2: standalone 3-to-6-digit numbers or script names listed under Auswahl
  if (results.length === 0) {
    const cleanForDigits = stripDatesAndTimes(cleaned);
    const numericMatches = Array.from(cleanForDigits.match(/\b\d{3,6}\b/g) || []);
    numericMatches.forEach((num, idx) => {
      if (num === ownNumber && numericMatches.length === 1) return;
      const key = `${idx + 1}->${num}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ choice: `${idx + 1}`, targetNumber: num });
      }
    });

    const listTokens = cleanForDigits
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter((t) => !isNumericScriptRef(t) && /^[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,}$/.test(t));
    listTokens.forEach((tok, idx) => {
      if (!isPlausibleNamedScriptTarget(tok)) return;
      const ref = normalizeScriptRef(tok);
      if (ownNumber && canonicalScriptMatchKey(ref) === canonicalScriptMatchKey(ownNumber)) return;
      const key = `${idx + 1}->${canonicalScriptMatchKey(ref)}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ choice: `${numericMatches.length + idx + 1}`, targetNumber: ref });
      }
    });
  }

  return results;
}

function extractInlineKeyValuesFromText(
  line: string,
  activeHeaderNumber?: string
): {
  prio?: number;
  stepName?: string;
  sourceNumber?: string;
  targetNumber?: string;
  choices: ScriptChoiceOption[];
  condition?: string;
  schedule?: string;
  holiday?: string;
  announcement?: string;
  queueTarget?: string;
  matchedExplicitFields: boolean;
} {
  let prio: number | undefined;
  let stepName: string | undefined;
  let sourceNumber: string | undefined;
  let targetNumber: string | undefined;
  let choices: ScriptChoiceOption[] = [];
  let condition: string | undefined;
  let schedule: string | undefined;
  let holiday: string | undefined;
  let announcement: string | undefined;
  let queueTarget: string | undefined;
  let matchedExplicitFields = false;

  const hasDelimiter = /[|;\t]/.test(line);

  if (hasDelimiter) {
    const parts = line
      .split(/\s*[|;\t]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);

    const positional: string[] = [];

    for (const part of parts) {
      const prioKv = part.match(/^(?:prio(?:rit[aä]t)?)\s*[:=]?\s*(\d+)/i);
      const nameKv = part.match(/^(?:name|bezeichnung|schritt|step|titel)\s*[:=]\s*(.+)$/i);
      const numKv = part.match(
        /^(?:nummer|nr\.?|skript(?:nummer)?|script|id)\s*[:=]?\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?\b/i
      );
      const targetKv = part.match(
        /^(?:wohin|ziel(?:nummer)?|sprung(?:ziel)?|target|next|goto|weiter(?:leitung)?|execute(?:\s+script)?|call(?:\s+script)?|run|sub(?:script)?)\s*[:=]?\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?\b/i
      );
      const choiceKv = part.match(
        /^(?:auswahl(?:nummern|optionen)?|option(?:en)?|choices?|dtmf|taste[n]?|men[uü])\s*[:=]?\s*(.+)$/i
      );
      const tasteDirectKv = part.match(/^taste\s+[A-Za-z0-9*#]+\s*(?:->|=>|:|=)/i);
      const condKv = part.match(/^(?:bedingung|wenn|pr[uü]fung|condition|regel)\s*[:=]\s*(.+)$/i);
      const schedKv = part.match(/^(?:zeitplan|[oö]ffnungszeit(?:en)?|zeiten|schedule)\s*[:=]\s*(.+)$/i);
      const holKv = part.match(/^(?:feiertag(?:e|sregel)?|holiday)\s*[:=]\s*(.+)$/i);
      const annKv = part.match(/^(?:ansage|prompt|audio|wav|textansage)\s*[:=]\s*(.+)$/i);
      const queueKv = part.match(/^(?:queue|warteschlange|acd|skill|gruppe)\s*[:=]\s*(.+)$/i);

      if (prioKv) {
        prio = parseInt(prioKv[1], 10);
        matchedExplicitFields = true;
      } else if (nameKv) {
        stepName = nameKv[1].trim();
        matchedExplicitFields = true;
      } else if (numKv && isValidScriptRef(numKv[1])) {
        if (/^(?:script|skript)$/i.test(part.split(/[:=]/)[0].trim()) && !isNumericScriptRef(numKv[1])) {
          targetNumber = normalizeScriptRef(numKv[1]);
        } else {
          sourceNumber = normalizeScriptRef(numKv[1]);
        }
        matchedExplicitFields = true;
      } else if (targetKv && isValidScriptRef(targetKv[1])) {
        targetNumber = normalizeScriptRef(targetKv[1]);
        matchedExplicitFields = true;
      } else if (choiceKv || tasteDirectKv) {
        choices = choices.concat(parseChoicesSegment(choiceKv ? choiceKv[1] : part, sourceNumber));
        matchedExplicitFields = true;
      } else if (condKv) {
        condition = condKv[1].trim();
        const condClean = stripDatesAndTimes(condition);
        const condJump =
          condClean.match(/(?:->|=>)\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,})["']?\b/) ||
          condClean.match(
            /\b(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]*(?:script|schaltung)[A-Za-z0-9ÄÖÜäöüß_-]*)\b/i
          );
        if (condJump && isValidScriptRef(condJump[1])) {
          const ref = normalizeScriptRef(condJump[1]);
          choices.push({
            choice: 'Bedingung',
            targetNumber: ref,
            label:
              condition
                .replace(condJump[0], '')
                .replace(/[->=:]+/g, ' ')
                .trim() || undefined,
          });
        }
        matchedExplicitFields = true;
      } else if (schedKv) {
        schedule = schedKv[1].trim();
        const schedClean = stripDatesAndTimes(schedule);
        const schedJump =
          schedClean.match(/(?:->|=>)\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,})["']?\b/) ||
          schedClean.match(
            /\b(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]*(?:script|schaltung)[A-Za-z0-9ÄÖÜäöüß_-]*)\b/i
          );
        if (schedJump && isValidScriptRef(schedJump[1])) {
          choices.push({ choice: 'Zeitplan', targetNumber: normalizeScriptRef(schedJump[1]) });
        }
        matchedExplicitFields = true;
      } else if (holKv) {
        holiday = holKv[1].trim();
        const holClean = stripDatesAndTimes(holiday);
        const holJump =
          holClean.match(/(?:->|=>)\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,})["']?\b/) ||
          holClean.match(
            /\b(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]*(?:script|schaltung)[A-Za-z0-9ÄÖÜäöüß_-]*)\b/i
          ) ||
          (/^[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,}$/.test(holiday)
            ? ([holiday, holiday] as RegExpMatchArray)
            : null);
        if (holJump && isValidScriptRef(holJump[1])) {
          choices.push({ choice: 'Feiertag', targetNumber: normalizeScriptRef(holJump[1]) });
        }
        matchedExplicitFields = true;
      } else if (annKv) {
        announcement = annKv[1].trim();
        matchedExplicitFields = true;
      } else if (queueKv) {
        queueTarget = queueKv[1].trim();
        const qJump = queueTarget.match(/\b(\d{3,6})\b/);
        if (qJump && !targetNumber) {
          targetNumber = qJump[1];
        }
        matchedExplicitFields = true;
      } else {
        positional.push(part);
      }
    }

    // Handle pure delimiter table row `1; Begrüßung; 100; 12345; 1->210`
    for (const tok of positional) {
      if (
        prio === undefined &&
        /^\d{1,3}$/.test(tok) &&
        positional.indexOf(tok) === 0 &&
        (!activeHeaderNumber ||
          canonicalScriptMatchKey(tok) !== canonicalScriptMatchKey(activeHeaderNumber))
      ) {
        prio = parseInt(tok, 10);
      } else if (
        !sourceNumber &&
        isNumericScriptRef(tok) &&
        (!activeHeaderNumber ||
          canonicalScriptMatchKey(tok) === canonicalScriptMatchKey(activeHeaderNumber))
      ) {
        sourceNumber = tok;
      } else if (!targetNumber && isNumericScriptRef(tok)) {
        targetNumber = tok;
      } else if (targetNumber && isNumericScriptRef(tok)) {
        if (
          tok !== targetNumber &&
          !choices.some((c) => c.targetNumber === tok)
        ) {
          choices.push({ choice: 'Sprung', targetNumber: tok });
        }
      } else if (
        !targetNumber &&
        /(?:script|schaltung)/i.test(tok) &&
        isPlausibleNamedScriptTarget(tok)
      ) {
        targetNumber = normalizeScriptRef(tok);
      } else if (!stepName && !isNumericScriptRef(tok) && !/->/.test(tok)) {
        stepName = tok;
      } else if (/\d{3,6}|->/.test(tok)) {
        choices = choices.concat(parseChoicesSegment(tok, sourceNumber || activeHeaderNumber));
      }
    }

    return {
      prio,
      stepName,
      sourceNumber,
      targetNumber,
      choices,
      condition,
      schedule,
      holiday,
      announcement,
      queueTarget,
      matchedExplicitFields,
    };
  }

  // Single free-text or single attribute line without `|`, `;`, `\t`
  const singlePrioLine = line.match(
    /^(?:prio(?:rit[aä]t)?)\s*[:=]?\s*(\d{1,3})(?:\s*[-:|]\s*|\s+)?(.*)$/i
  );
  if (singlePrioLine) {
    prio = parseInt(singlePrioLine[1], 10);
    matchedExplicitFields = true;
    const rest = singlePrioLine[2]?.trim() || '';
    if (
      rest &&
      !/\b(?:wohin|ziel|sprung|auswahl|taste|zeitplan|feiertag|bedingung|ansage|queue)\b/i.test(
        rest
      ) &&
      !/->/.test(rest)
    ) {
      const numsInRest = Array.from(stripNumericNoiseForFreeText(rest).match(/\b\d{3,6}\b/g) || []);
      if (numsInRest.length === 0) {
        stepName = rest;
        return { prio, stepName, choices, matchedExplicitFields };
      }
    }
  }

  // Single standalone key: value attribute line (for multi-line script blocks)
  const attrCond = line.match(/^(?:bedingung|wenn|pr[uü]fung|condition)\s*[:=]\s*(.+)$/i);
  if (attrCond) {
    condition = attrCond[1].trim();
    const condClean = stripDatesAndTimes(condition);
    const j =
      condClean.match(/(?:->|=>)\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,})["']?\b/) ||
      condClean.match(/\b(\d{3,6})\b/);
    if (j && isValidScriptRef(j[1])) {
      choices.push({ choice: 'Bedingung', targetNumber: normalizeScriptRef(j[1]) });
    }
    return { choices, condition, matchedExplicitFields: true };
  }

  const attrSched = line.match(/^(?:zeitplan|[oö]ffnungszeit(?:en)?|zeiten|schedule)\s*[:=]\s*(.+)$/i);
  if (attrSched) {
    schedule = attrSched[1].trim();
    const schedClean = stripDatesAndTimes(schedule);
    const j =
      schedClean.match(/(?:->|=>)\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,})["']?\b/) ||
      schedClean.match(/\b(\d{3,6})\b/);
    if (j && isValidScriptRef(j[1])) {
      choices.push({ choice: 'Zeitplan', targetNumber: normalizeScriptRef(j[1]) });
    }
    return { choices, schedule, matchedExplicitFields: true };
  }

  const attrHol = line.match(/^(?:feiertag(?:e|sregel)?|holiday)\s*[:=]\s*(.+)$/i);
  if (attrHol) {
    holiday = attrHol[1].trim();
    const holClean = stripDatesAndTimes(holiday);
    const j =
      holClean.match(/(?:->|=>)\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,})["']?\b/) ||
      holClean.match(/\b(\d{3,6})\b/) ||
      (/^[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,}$/.test(holiday)
        ? ([holiday, holiday] as RegExpMatchArray)
        : null);
    if (j && isValidScriptRef(j[1])) {
      choices.push({ choice: 'Feiertag', targetNumber: normalizeScriptRef(j[1]) });
    }
    return { choices, holiday, matchedExplicitFields: true };
  }

  const attrAnn = line.match(/^(?:ansage|prompt|audio|wav|textansage)\s*[:=]\s*(.+)$/i);
  if (attrAnn) {
    return { choices, announcement: attrAnn[1].trim(), matchedExplicitFields: true };
  }

  const attrQueue = line.match(/^(?:queue|warteschlange|acd|skill|gruppe)\s*[:=]\s*(.+)$/i);
  if (attrQueue) {
    queueTarget = attrQueue[1].trim();
    const qJump = queueTarget.match(/\b(\d{3,6})\b/);
    return {
      choices,
      queueTarget,
      targetNumber: qJump ? qJump[1] : undefined,
      matchedExplicitFields: true,
    };
  }

  const attrName = line.match(/^(?:name|bezeichnung|schritt|step|titel)\s*[:=]\s*(.+)$/i);
  if (attrName) {
    return { choices, stepName: attrName[1].trim(), matchedExplicitFields: true };
  }

  const attrTarget = line.match(
    /^(?:wohin|ziel(?:nummer)?|sprung(?:ziel)?|weiter(?:leitung)?|goto|next|execute(?:\s+script)?|call(?:\s+script)?|run|sub(?:script)?|skript|script)\s*[:=]?\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?\b(?:\s*\(([^)]+)\))?/i
  );
  if (attrTarget && isValidScriptRef(attrTarget[1])) {
    return {
      choices,
      targetNumber: normalizeScriptRef(attrTarget[1]),
      matchedExplicitFields: true,
    };
  }

  const attrChoice = line.match(
    /^(?:auswahl(?:nummern|optionen)?|option(?:en)?|dtmf|taste[n]?|men[uü])\s*[:=]?\s*(.+)$/i
  );
  if (attrChoice || /^taste\s+[A-Za-z0-9*#]+\s*(?:->|=>|:|=)/i.test(line)) {
    choices = parseChoicesSegment(line);
    return { choices, matchedExplicitFields: true };
  }

  // General inline prose (mixed free-text on one line)
  const prioMatch = line.match(/\bprio(?:rit[aä]t)?\s*[:=]?\s*(\d{1,3})\b/i);
  if (prioMatch) {
    prio = parseInt(prioMatch[1], 10);
    matchedExplicitFields = true;
  }

  const choiceBlockMatch = line.match(
    /\b(?:auswahl(?:nummern|optionen)?|option(?:en)?|dtmf|taste[n]?|men[uü])\b[\s:=]*(.+)$/i
  );
  if (choiceBlockMatch) {
    const startIdx = choiceBlockMatch.index ?? 0;
    choices = parseChoicesSegment(line.slice(startIdx));
    matchedExplicitFields = true;
  }

  const lineWithoutChoices = choiceBlockMatch
    ? line.slice(0, choiceBlockMatch.index).trim()
    : line;

  const cleanLineForDigits = stripNumericNoiseForFreeText(lineWithoutChoices);

  const explicitTarget =
    cleanLineForDigits.match(
      /\b(?:wohin|ziel(?:nummer)?|sprung(?:ziel)?|weiter(?:leitung)?|next|goto|execute(?:\s+script)?|call(?:\s+script)?|run|sub(?:script)?|skript|script)\s*[:=]?\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,})["']?\b/i
    ) ||
    cleanLineForDigits.match(
      /(?:->|=>)\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,})["']?\b/
    );
  if (explicitTarget && isValidScriptRef(explicitTarget[1])) {
    targetNumber = normalizeScriptRef(explicitTarget[1]);
    matchedExplicitFields = true;
  }

  const explicitSource = cleanLineForDigits.match(
    /\b(?:nummer|nr\.?|modul|cdn)\s*[:=]?\s*(\d{3,6})\b/i
  );
  if (explicitSource) {
    sourceNumber = explicitSource[1];
    matchedExplicitFields = true;
  } else {
    const numericTokens: string[] = Array.from(cleanLineForDigits.match(/\b\d{3,6}\b/g) || []);
    if (numericTokens.length >= 2) {
      sourceNumber = numericTokens[0] || '';
      if (!targetNumber) targetNumber = numericTokens[1] || '';
    } else if (numericTokens.length === 1) {
      const singleNum = numericTokens[0] || '';
      if (!explicitTarget) {
        sourceNumber = singleNum;
      } else {
        targetNumber = targetNumber || singleNum;
      }
    }
  }

  // Detect named script identifiers in free text (e.g. `schaltung1script`, `feiertag_script`)
  if (!targetNumber) {
    const namedTargetMatch = cleanLineForDigits.match(
      /\b([A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]*(?:script|schaltung)[A-Za-z0-9ÄÖÜäöüß_-]*)\b/i
    );
    if (
      namedTargetMatch &&
      !/^master(?:script)?$/i.test(namedTargetMatch[1]) &&
      isPlausibleNamedScriptTarget(namedTargetMatch[1])
    ) {
      targetNumber = normalizeScriptRef(namedTargetMatch[1]);
      matchedExplicitFields = true;
    }
  }

  // Inline Queue mention in free-text (`... -> Queue Support_DE`)
  const inlineQueue = lineWithoutChoices.match(
    /\b(?:queue|warteschlange|acd)\s*[:=]?\s*([A-Za-z0-9_äöüÄÖÜß-]+)/i
  );
  if (inlineQueue) {
    queueTarget = inlineQueue[1].trim();
    matchedExplicitFields = true;
  }

  const cleanedName = lineWithoutChoices
    .replace(/\bprio(?:rit[aä]t)?\s*[:=]?\s*\d+\b/gi, '')
    .replace(/\b(?:nummer|nr\.?|wohin|ziel|sprung|weiter|name|skript|script|execute|call)\s*[:=]?\s*/gi, '')
    .replace(/\b\d{3,6}\b/g, '')
    .replace(/(?:->|=>|[:|])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleanedName) {
    stepName = cleanedName;
  }

  return {
    prio,
    stepName,
    sourceNumber,
    targetNumber,
    choices,
    condition,
    schedule,
    holiday,
    announcement,
    queueTarget,
    matchedExplicitFields,
  };
}

function isAaccScriptText(text: string): boolean {
  const cleaned = stripScriptCommentsAndNoise(text);
  return (
    /\bsection\s+[A-Za-z0-9_]+/i.test(cleaned) ||
    /\bCDN\s*[:=]?\s*\d{3,6}\b/i.test(cleaned) ||
    (/\bassign\b[\s\S]{1,120}\bto\s+(?:Sys_[A-Za-z0-9_]+|src_route_number)\b/i.test(cleaned)) ||
    /\b(?:Sys_Team_Skillset|Sys_Ueberlauf_Skillset|Sys_Retour_Zentrale|Sys_SondStat|Sys_SondZeit|Sys_brand|src_route_number)\b/i.test(
      cleaned
    ) ||
    /\b(?:queue\s+to|route\s+call|give\s+(?:announcement|ran|ivr|music|cdn|script)|transfer\s+to|execute\s+script)\b/i.test(
      cleaned
    ) ||
    /\bVALUE\s+['"]?[0-9xX*]{2,15}['"]?\s*[:=]/i.test(cleaned) ||
    /\b(?:DNIS_Range[A-Za-z0-9_]*|WHERE\s+(?:DNIS|CDN|CLID|CALLING|CALLED|src_route_number)\b)/i.test(
      cleaned
    ) ||
    /\bif\b[\s\S]{1,160}\bthen\b/i.test(cleaned)
  );
}

function hasAaccMasterRoutingSignals(text: string): boolean {
  return (
    /\bVALUE\s+['"]?[0-9xX*]{2,15}['"]?\s*[:=]/i.test(text) ||
    /\bexecute\s+script\b/i.test(text) ||
    /\b(?:DNIS_Range[A-Za-z0-9_]*|src_route_number|Sys_brand)\b/i.test(text) ||
    /\b02131[\s\-/]?(?:290|210|6099)/i.test(text) ||
    /\bfax(?:routing)?\b/i.test(text)
  );
}

function parseValueTriggerNumbers(rawValueExpr: string): string[] {
  const tokens = rawValueExpr
    .split(/[\s,;]+|\bor\b/i)
    .map((t) => t.trim().replace(/^['"`()]+|['"`()]+$/g, ''))
    .filter(Boolean);
  const nums: string[] = [];
  for (const tok of tokens) {
    if (/^(?:\d{2,14}|(?:0?2131)?(?:290|210|6099)[xX*\d]{1,6})$/.test(tok)) {
      if (!nums.includes(tok)) nums.push(tok);
    }
  }
  return nums;
}

function parseAaccScriptBlocks(
  rawText: string,
  options?: {
    defaultScriptNumber?: string;
    defaultScriptName?: string;
    sourceFilename?: string;
    origin?: ScriptOrigin;
  }
): ScriptModule[] {
  const withoutComments = stripScriptCommentsAndNoise(rawText);
  const rawLines = withoutComments.split(/\r?\n/);
  const isSingleMasterDocument = hasAaccMasterRoutingSignals(withoutComments);

  // Split into individual script chunks whenever a top-level `CDN <3-6-digit>` header block starts
  // (unless the file is a Masterscript containing VALUE/DNIS_Range/Fax-CDN routing lines)
  const chunks: Array<{ startIdx: number; endIdx: number }> = [];
  const cdnIndices: number[] = [];
  if (!isSingleMasterDocument) {
    rawLines.forEach((l, idx) => {
      if (/^\s*CDN\s*[:=]?\s*\d{3,6}\b/i.test(l)) {
        cdnIndices.push(idx);
      }
    });
  }

  if (cdnIndices.length <= 1) {
    chunks.push({ startIdx: 0, endIdx: rawLines.length });
  } else {
    for (let i = 0; i < cdnIndices.length; i++) {
      const startIdx = i === 0 ? 0 : Math.max(cdnIndices[i - 1] + 1, cdnIndices[i] - 2);
      const endIdx = i + 1 < cdnIndices.length ? Math.max(cdnIndices[i] + 1, cdnIndices[i + 1] - 2) : rawLines.length;
      chunks.push({ startIdx, endIdx });
    }
  }

  const modules: ScriptModule[] = [];

  chunks.forEach((chunk, chunkIdx) => {
    const sliceLines = rawLines.slice(chunk.startIdx, chunk.endIdx);
    const chunkText = sliceLines.join('\n');
    const trimmedChunk = chunkText.trim();
    if (!trimmedChunk) return;

    const chunkIsMaster = hasAaccMasterRoutingSignals(trimmedChunk);
    const topCdnHeaderMatch = chunkText.match(/^\s*CDN\s*[:=]?\s*(\d{3,6})\b/im);
    const inlineCdnMatch = chunkIsMaster ? null : chunkText.match(/\bCDN\s*[:=]?\s*(\d{3,6})\b/i);
    const cdnMatch = topCdnHeaderMatch || inlineCdnMatch;

    const fallbackNum =
      options?.defaultScriptNumber?.trim()
        ? normalizeScriptRef(options.defaultScriptNumber)
        : options?.sourceFilename?.match(/\b(\d{3,6})\b/)?.[1] ||
          (chunks.length === 1 || chunkIsMaster ? 'Main' : `900${chunkIdx}`);
    const scriptNumber =
      chunkIsMaster && (!options?.defaultScriptNumber || /^(?:main|master(?:script)?)$/i.test(options.defaultScriptNumber))
        ? 'Main'
        : cdnMatch?.[1] || fallbackNum;

    // Extract descriptive name: non-key-value line right before `CDN`, or `assign ... to Sys_Team_Skillset`
    let detectedName = '';
    const nonEmptyBeforeSection = sliceLines
      .slice(0, 12)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of nonEmptyBeforeSection) {
      if (
        !isMetadataOrChangelogLine(line) &&
        !/^(?:CDN|Bereich|Abteilung|Team|section|assign|if|else|end(?:\s*(?:if|section))?|give|transfer|route|queue|collect|execute|call|goto|subscript|open|where|select|case|value|default|otherwise|dnis|fax(?:routing)?)\b/i.test(
          line
        ) &&
        !/^(?:prio|zeitplan|feiertag|bedingung|ansage|taste)\b/i.test(line) &&
        !/^(?:02131|290|210|6099)\b/.test(line) &&
        !line.includes('->') &&
        !line.includes('=>') &&
        line.length >= 3
      ) {
        detectedName = line;
        break;
      }
    }

    const teamMatch = chunkText.match(/\bTeam\s*:\s*([^\n\r]+)/i);
    const bereichMatch = chunkText.match(/\bBereich\s*:\s*([^\n\r]+)/i);
    const abteilungMatch = chunkText.match(/\bAbteilung\s*:\s*([^\n\r]+)/i);

    // Parse top-level `assign <VALUE> to <VAR>` statements for classic AACC sub-scripts
    const vars = new Map<string, string>();
    for (const item of extractAssignStatements(chunkText)) {
      vars.set(item.variable, item.value);
    }

    const teamSkillset = vars.get('Sys_Team_Skillset');
    const scriptName =
      options?.defaultScriptName?.trim() ||
      (chunkIsMaster && scriptNumber === 'Main' ? 'Main (Masterscript)' : '') ||
      detectedName ||
      teamSkillset ||
      (teamMatch ? teamMatch[1].trim() : '') ||
      `Skript ${scriptNumber}`;

    const rules: ScriptRule[] = [];
    let ruleCounter = 1;

    // Rule 1: Init / Sonderstatus & Sonderzeit / Gesellschaft
    const sondStat = vars.get('Sys_SondStat');
    const sondZeit = vars.get('Sys_SondZeit');
    const sondRouting = vars.get('Sys_SondRouting');
    const gesellschaft = vars.get('Sys_Gesellschaft');
    const retourZentrale = vars.get('Sys_Retour_Zentrale');
    const cleanRetour = retourZentrale?.match(/\b(\d{3,6})\b/)?.[1];

    if (sondStat || sondZeit || sondRouting || gesellschaft || teamMatch || bereichMatch) {
      const contextBits: string[] = [];
      if (teamMatch) contextBits.push(`Team: ${teamMatch[1].trim()}`);
      else if (abteilungMatch) contextBits.push(`Abt.: ${abteilungMatch[1].trim()}`);
      if (gesellschaft) contextBits.push(`Gesellschaft: ${gesellschaft}`);

      rules.push({
        id: `${scriptNumber}-${ruleCounter++}`,
        prio: 1,
        stepName: contextBits.length > 0 ? `Init (${contextBits.join(' · ')})` : 'Init & Sonderprüfung',
        sourceNumber: scriptNumber,
        schedule: sondZeit || undefined,
        condition: sondStat
          ? `${sondStat}${sondRouting !== undefined ? ` (Routing: ${sondRouting === '0' ? 'aus' : sondRouting})` : ''}`
          : undefined,
        choices: cleanRetour
          ? [
              {
                choice: 'Retour',
                targetNumber: cleanRetour,
                label: 'Sys_Retour_Zentrale',
              },
            ]
          : [],
        rawLine: 'section Init',
      });
    }

    // Rule 2: Team-Skillset Routing
    const teamPrioRaw = vars.get('Sys_Team_Prio');
    const teamPrio = teamPrioRaw && /^\d+$/.test(teamPrioRaw) ? parseInt(teamPrioRaw, 10) : 4;
    const musikId = vars.get('Sys_Musik');
    const wsProzent = vars.get('Sys_WS_Prozent');
    const wsAbsolut = vars.get('Sys_WS_Absolut');

    if (teamSkillset) {
      const wsInfo: string[] = [];
      if (wsProzent && wsProzent !== '-1') wsInfo.push(`WS ${wsProzent}%`);
      if (wsAbsolut && wsAbsolut !== '-1') wsInfo.push(`WS ${wsAbsolut} abs.`);

      rules.push({
        id: `${scriptNumber}-${ruleCounter++}`,
        prio: teamPrio,
        stepName: 'Team-Skillset Routing',
        sourceNumber: scriptNumber,
        queueTarget: teamSkillset,
        announcement: musikId ? `Musik-ID ${musikId}` : undefined,
        condition: wsInfo.length > 0 ? wsInfo.join(' · ') : undefined,
        choices: [],
        rawLine: `assign ${teamSkillset} to Sys_Team_Skillset`,
      });
    }

    // Rule 3: Überlauf-Skillset & Rücksprung / Retour-Zentrale
    const ueberlaufSkill = vars.get('Sys_Ueberlauf_Skillset');
    const ueberlaufPrioRaw = vars.get('Sys_Ueberlauf_Prio');
    const ueberlaufPrio =
      ueberlaufPrioRaw && /^\d+$/.test(ueberlaufPrioRaw) ? parseInt(ueberlaufPrioRaw, 10) : teamPrio + 1;
    const ueberlaufRouting = vars.get('Sys_UeberlaufRouting');
    const ueberlaufZeit = vars.get('Sys_Ueberlauf_Zeit');

    if (ueberlaufSkill || cleanRetour) {
      const isActive = ueberlaufRouting && ueberlaufRouting !== '0';
      rules.push({
        id: `${scriptNumber}-${ruleCounter++}`,
        prio: ueberlaufPrio,
        stepName: ueberlaufSkill
          ? `Überlauf (${isActive ? `nach ${ueberlaufZeit || '0'}s` : 'deaktiviert = 0'})`
          : 'Rücksprung Zentrale',
        sourceNumber: scriptNumber,
        targetNumber: cleanRetour || undefined,
        queueTarget: ueberlaufSkill && ueberlaufSkill !== 'Default_Skillset' ? ueberlaufSkill : undefined,
        condition:
          ueberlaufSkill === 'Default_Skillset' ? 'Skillset: Default_Skillset' : undefined,
        choices: [],
        rawLine: ueberlaufSkill
          ? `assign ${ueberlaufSkill} to Sys_Ueberlauf_Skillset`
          : `assign ${cleanRetour} to Sys_Retour_Zentrale`,
      });
    }

    // Rule 4+: Any additional CDN jumps in classic Sys_* variables
    const seenExtraTargets = new Set<string>();
    if (cleanRetour) seenExtraTargets.add(cleanRetour);

    for (const [varName, val] of vars.entries()) {
      if (
        /^(?:Sys_Retour_Zentrale|Sys_Team_Skillset|Sys_Ueberlauf_Skillset|Sys_SondStat|Sys_SondZeit|Sys_Team_Prio|Sys_Ueberlauf_Prio|Sys_Ueberlauf_Zeit|Sys_Musik|Sys_Gesellschaft|Sys_Besetztgrund|Sys_WS_Prozent|Sys_WS_Absolut|Sys_UeberlaufRouting|Sys_SondRouting|Sys_brand|src_route_number)$/i.test(
          varName
        )
      ) {
        continue;
      }
      const cdnVal = val.match(/^\d{3,6}$/)?.[0];
      if (cdnVal && cdnVal !== scriptNumber && !seenExtraTargets.has(cdnVal)) {
        seenExtraTargets.add(cdnVal);
        rules.push({
          id: `${scriptNumber}-${ruleCounter++}`,
          prio: ruleCounter + 10,
          stepName: varName.replace(/^Sys_/, ''),
          sourceNumber: scriptNumber,
          targetNumber: cdnVal,
          choices: [],
          rawLine: `assign ${val} to ${varName}`,
        });
      }
    }

    // Procedural body, DNIS_Range IF-ELSE blocks, WHERE/VALUE cases, and Fax-CDN routing
    interface ConditionFrame {
      condText: string;
      orga: AaccOrgaContext;
      isFaxCond: boolean;
      hadInlineRules: boolean;
    }

    const conditionStack: ConditionFrame[] = [];
    const orgaRegistry = new Map<string, AaccOrgaContext>();
    let lastCollectRule: ScriptRule | null = null;
    let pendingValueTrigger: {
      valueNumbers: string[];
      rawTrigger: string;
      orga: AaccOrgaContext;
      isFax: boolean;
    } | null = null;

    const getStackOrga = (): AaccOrgaContext => {
      let acc: AaccOrgaContext = {};
      for (const f of conditionStack) {
        acc = mergeOrgaContext(acc, f.orga);
      }
      return acc;
    };

    const registerOrga = (ctx: AaccOrgaContext) => {
      const key = canonicalScriptMatchKey(ctx.orgaCode || ctx.organizationName || ctx.brandName || '');
      if (!key) return;
      const prev = orgaRegistry.get(key);
      orgaRegistry.set(key, mergeOrgaContext(prev, ctx));
    };

    const resolveOrgaForRule = (
      localCtx: AaccOrgaContext,
      valueNums: string[],
      lineText: string,
      targetScript?: string
    ): AaccOrgaContext => {
      let merged = mergeOrgaContext(getStackOrga(), localCtx);

      // 1. Check VALUE numbers for 02131 + 290/210/6099 or 290xxxx/210xxxx/6099xxxx
      if (!merged.organizationName || !merged.orgaCode) {
        for (const v of valueNums) {
          const fromVal = detectOrgaFromText(v);
          if (fromVal.organizationName) {
            merged = mergeOrgaContext(merged, fromVal);
            break;
          }
        }
      }

      // 2. Check target script name or line text (e.g. Rheinland_Vertrieb, Rhion_Service, CL_...)
      if (!merged.organizationName || !merged.orgaCode) {
        const fromTarget = detectOrgaFromText(`${targetScript || ''} ${lineText}`);
        if (fromTarget.organizationName) {
          merged = mergeOrgaContext(merged, fromTarget);
        }
      }

      // 3. Match against discovered DNIS_Range Sys_brand / src_route_number registry
      if (merged.orgaCode && orgaRegistry.has(canonicalScriptMatchKey(merged.orgaCode))) {
        merged = mergeOrgaContext(orgaRegistry.get(canonicalScriptMatchKey(merged.orgaCode)), merged);
      } else if (
        merged.organizationName &&
        orgaRegistry.has(canonicalScriptMatchKey(merged.organizationName))
      ) {
        merged = mergeOrgaContext(
          orgaRegistry.get(canonicalScriptMatchKey(merged.organizationName)),
          merged
        );
      } else if (!merged.brandName && targetScript) {
        for (const regCtx of orgaRegistry.values()) {
          if (
            regCtx.brandName &&
            new RegExp(`\\b${regCtx.brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(
              targetScript
            )
          ) {
            merged = mergeOrgaContext(regCtx, merged);
            break;
          }
        }
      }

      // Ensure brandName -> organizationName fallback for known codes
      if (!merged.organizationName && merged.brandName) {
        const fromBrand = detectOrgaFromText(merged.brandName);
        if (fromBrand.organizationName) {
          merged = mergeOrgaContext(merged, fromBrand);
        } else {
          merged.organizationName = merged.brandName;
        }
      }

      return merged;
    };

    const applyAssignmentsToOrga = (text: string, targetOrga: AaccOrgaContext): AaccOrgaContext => {
      let next = { ...targetOrga };
      const assigns = extractAssignStatements(text);
      for (const a of assigns) {
        if (/^src_route_number$/i.test(a.variable)) {
          next.srcRouteNumber = a.value;
          const det = detectOrgaFromText(a.value);
          if (det.organizationName) {
            next = mergeOrgaContext(next, det);
          }
        } else if (/^Sys_brand$/i.test(a.variable)) {
          next.brandName = a.value;
          const det = detectOrgaFromText(a.value);
          if (det.organizationName) {
            next = mergeOrgaContext(next, det);
          } else if (!next.organizationName) {
            next.organizationName = a.value;
          }
        }
      }
      if (next.organizationName || next.orgaCode || next.brandName || next.srcRouteNumber) {
        registerOrga(next);
      }
      return next;
    };

    const processActionSegment = (
      actionSegment: string,
      rawLine: string,
      explicitValueNums: string[] = [],
      explicitIsFax = false
    ): boolean => {
      const valueNumbers =
        explicitValueNums.length > 0
          ? explicitValueNums
          : pendingValueTrigger?.valueNumbers || [];
      const stackFax = conditionStack.some((f) => f.isFaxCond);
      const lineHasFaxKeyword = /\bfax(?:routing)?\b/i.test(actionSegment);
      const has4DigitValue = valueNumbers.some((v) => /^\d{4}$/.test(v));
      const faxCdnMatch = actionSegment.match(
        /\b(?:fax(?:routing)?\s*(?:cdn)?|cdn)\s*[:=]?\s*(\d{4})\b/i
      );

      const execCmd = actionSegment.match(
        /\b(?:execute(?:\s+script)?|call(?:\s+script)?|subscript|give\s+script)\s+["']?([A-Za-z0-9ÄÖÜäöüß_.-]+)["']?/i
      );
      const queueCmd = actionSegment.match(
        /\bqueue\s+to\s+(?:skillset|cdn)\s+["']?([A-Za-z0-9ÄÖÜäöüß_.-]+)["']?/i
      );
      const routeCmd = actionSegment.match(
        /\b(?:route\s+call(?:\s+to)?|transfer(?:\s+to)?|give\s+cdn|cdn|goto)\s*[:=]?\s*["']?(\d{3,6})["']?\b/i
      );
      const annCmd = actionSegment.match(
        /\b(?:give\s+(?:announcement|ran|ivr|music)|open\s+voice\s+segment)\s+["']?([A-Za-z0-9ÄÖÜäöüß_.-]+)["']?/i
      );
      const collectCmd = actionSegment.match(/\bcollect\s+(\d+)\s+digits?\b/i);

      const isFaxRoute =
        explicitIsFax ||
        pendingValueTrigger?.isFax ||
        stackFax ||
        lineHasFaxKeyword ||
        has4DigitValue ||
        Boolean(faxCdnMatch);

      if (faxCdnMatch && faxCdnMatch[1] && !valueNumbers.includes(faxCdnMatch[1])) {
        valueNumbers.push(faxCdnMatch[1]);
      }

      const execTarget =
        execCmd && isValidScriptRef(execCmd[1]) ? normalizeScriptRef(execCmd[1]) : undefined;
      const routeTarget =
        routeCmd && routeCmd[1] && !isFaxRoute ? routeCmd[1] : undefined;
      const resolvedTarget = execTarget || routeTarget;

      if (execCmd || queueCmd || routeCmd || annCmd || collectCmd || isFaxRoute) {
        const orga = resolveOrgaForRule(
          pendingValueTrigger?.orga || {},
          valueNumbers,
          rawLine,
          resolvedTarget
        );
        const activeCondition =
          conditionStack.length > 0
            ? conditionStack[conditionStack.length - 1].condText
            : undefined;
        const valDisplay = valueNumbers.length > 0 ? valueNumbers.join(', ') : '';

        const stepLabel = isFaxRoute && !execTarget
          ? `Fax-Routing (4-stellig)${valDisplay ? `: ${valDisplay}` : ''}`
          : execTarget
          ? `${valDisplay ? `VALUE ${valDisplay} → ` : 'Subskript: '}${execTarget}`
          : queueCmd
          ? 'Queue-Anweisung'
          : routeCmd
          ? `Weiterleitung Ziel ${routeCmd[1]}`
          : collectCmd
          ? `DTMF-Eingabe (${collectCmd[1]} Ziffern)`
          : 'Ansage / RAN';

        const createdRule: ScriptRule = {
          id: `${scriptNumber}-${ruleCounter++}`,
          prio: ruleCounter + 20,
          stepName: stepLabel,
          sourceNumber: scriptNumber,
          targetNumber: resolvedTarget,
          queueTarget:
            queueCmd && !isNumericScriptRef(queueCmd[1]) ? queueCmd[1] : undefined,
          announcement: annCmd ? annCmd[1] : undefined,
          condition: activeCondition,
          choices: [],
          rawLine,
          organizationName: orga.organizationName,
          orgaCode: orga.orgaCode,
          brandName: orga.brandName,
          srcRouteNumber: orga.srcRouteNumber,
          valueNumbers: valueNumbers.length > 0 ? [...valueNumbers] : undefined,
          isFaxRoute: isFaxRoute || undefined,
        };
        rules.push(createdRule);
        lastCollectRule = collectCmd ? createdRule : null;
        pendingValueTrigger = null;
        if (conditionStack.length > 0) {
          conditionStack[conditionStack.length - 1].hadInlineRules = true;
        }
        return true;
      }

      return false;
    };

    for (const line of sliceLines) {
      const t = line.trim();
      if (!t || /^(?:end\s+)?section\b/i.test(t)) {
        if (/^end\s+section\b/i.test(t)) {
          lastCollectRule = null;
          pendingValueTrigger = null;
        }
        continue;
      }

      // Handle END IF / ENDIF (or trailing end if after inline assignments)
      if (/^(?:end\s*if|endif)\b/i.test(t)) {
        const closed = conditionStack.pop();
        if (
          closed &&
          !closed.hadInlineRules &&
          (closed.orga.organizationName || closed.orga.srcRouteNumber || closed.orga.brandName)
        ) {
          registerOrga(closed.orga);
        }
        lastCollectRule = null;
        continue;
      }

      // Handle WHERE <field> EQUALS / SELECT <field> (AACC CASE/WHERE headers)
      const whereMatch = t.match(/^(?:where|select|case)\s+(.+?)(?:\s+(?:equals|is|in)\b(.*))?$/i);
      if (whereMatch && !/\bexecute\b/i.test(t)) {
        const condBody = `${whereMatch[1]} ${whereMatch[2] || ''}`.trim();
        const det = detectOrgaFromText(condBody);
        if (det.organizationName || /\bfax/i.test(condBody)) {
          // Reset prior sibling WHERE frame if any
          if (conditionStack.length > 0 && /^where|select|case:/i.test(conditionStack[conditionStack.length - 1].condText)) {
            conditionStack.pop();
          }
          conditionStack.push({
            condText: `where:${condBody}`,
            orga: det,
            isFaxCond: /\bfax/i.test(condBody),
            hadInlineRules: false,
          });
        }
        continue;
      }

      // Handle ELSE / ELSE IF
      if (/^else\b(?:\s+if\b(.*?)\bthen\b)?/i.test(t)) {
        lastCollectRule = null;
        const elseIfMatch = t.match(/^else\s+if\s+(.+?)\s+then(?:\s+(.*))?$/i);
        const prevFrame = conditionStack.pop();
        if (elseIfMatch) {
          const condExpr = elseIfMatch[1].trim();
          const inlineBody = elseIfMatch[2]?.trim() || '';
          const hasEndIf = /\bend\s*if\b|\bendif\b/i.test(inlineBody);
          const cleanInline = inlineBody.replace(/\b(?:end\s*if|endif)\b/gi, '').trim();
          let orga: AaccOrgaContext = detectOrgaFromText(condExpr);
          if (cleanInline) {
            orga = applyAssignmentsToOrga(cleanInline, orga);
          }
          const frame: ConditionFrame = {
            condText: condExpr,
            orga,
            isFaxCond: /\bfax/i.test(condExpr),
            hadInlineRules: false,
          };
          conditionStack.push(frame);
          if (cleanInline) {
            const actionPart = cleanInline
              .replace(/\bassign\s+.+?\s+to\s+[A-Za-z0-9_]+/gi, '')
              .trim();
            if (actionPart) {
              processActionSegment(actionPart, t);
            }
          }
          if (hasEndIf) {
            conditionStack.pop();
          }
          continue;
        } else {
          conditionStack.push({
            condText: prevFrame ? `Sonst (nicht: ${prevFrame.condText})` : 'Sonst (ELSE)',
            orga: {},
            isFaxCond: false,
            hadInlineRules: false,
          });
          continue;
        }
      }

      // Handle IF ... THEN (including inline `assign x to src_route_number assign NAME to Sys_brand end if`)
      const ifThenMatch = t.match(/^if\s+(.+?)\s+then(?:\s+(.*))?$/i);
      if (ifThenMatch) {
        lastCollectRule = null;
        const condExpr = ifThenMatch[1].trim();
        const inlineBody = ifThenMatch[2]?.trim() || '';
        const hasEndIf = /\bend\s*if\b|\bendif\b/i.test(inlineBody);
        const cleanInline = inlineBody.replace(/\b(?:end\s*if|endif)\b/gi, '').trim();

        let orga: AaccOrgaContext = detectOrgaFromText(condExpr);
        if (cleanInline) {
          orga = applyAssignmentsToOrga(cleanInline, orga);
        }

        const frame: ConditionFrame = {
          condText: condExpr,
          orga,
          isFaxCond: /\bfax/i.test(condExpr),
          hadInlineRules: false,
        };
        conditionStack.push(frame);

        if (cleanInline) {
          const actionPart = cleanInline
            .replace(/\bassign\s+.+?\s+to\s+[A-Za-z0-9_]+/gi, '')
            .trim();
          if (actionPart) {
            processActionSegment(actionPart, t);
          }
        }
        if (hasEndIf) {
          conditionStack.pop();
        }
        continue;
      }

      // Handle standalone `assign ... to ...` lines inside/outside IF blocks
      if (/^assign\b/i.test(t)) {
        const assigns = extractAssignStatements(t);
        const hasRoutingVar = assigns.some((a) =>
          /^(?:src_route_number|Sys_brand)$/i.test(a.variable)
        );
        if (hasRoutingVar) {
          if (conditionStack.length > 0) {
            const top = conditionStack[conditionStack.length - 1];
            top.orga = applyAssignmentsToOrga(t, top.orga);
          } else {
            applyAssignmentsToOrga(t, {});
          }
        }
        continue;
      }

      // Handle `VALUE <3-or-4-digit Rufnummer> : execute Script <NAME>` (single-line or multi-line)
      const valueMatch = t.match(/^VALUE\s+(.+?)\s*:\s*(.*)$/i);
      if (valueMatch) {
        const rawVals = valueMatch[1].trim();
        const afterColon = (valueMatch[2] || '').trim();
        const valueNums = parseValueTriggerNumbers(rawVals);
        const orgaFromVal = resolveOrgaForRule({}, valueNums, t, afterColon);
        const isFaxVal =
          /\bfax(?:routing)?\b/i.test(t) ||
          valueNums.some((v) => /^\d{4}$/.test(v));

        if (!afterColon) {
          pendingValueTrigger = {
            valueNumbers: valueNums,
            rawTrigger: t,
            orga: orgaFromVal,
            isFax: isFaxVal,
          };
          continue;
        }

        if (processActionSegment(afterColon, t, valueNums, isFaxVal)) {
          continue;
        }
      }

      const actionSegment = t;
      const activeCondition =
        conditionStack.length > 0 ? conditionStack[conditionStack.length - 1].condText : undefined;

      // Choice mappings immediately following `COLLECT N DIGITS` (e.g. `1 -> 550`, `Taste 2 -> 123456`)
      if (
        /^(?:taste|dtmf|opt(?:ion)?|auswahl)?\s*[A-Za-z0-9*#]+\s*(?:->|=>)/i.test(actionSegment)
      ) {
        const parsedChoices = parseChoicesSegment(actionSegment, scriptNumber);
        if (parsedChoices.length > 0) {
          if (lastCollectRule) {
            parsedChoices.forEach((c) => {
              if (
                !lastCollectRule!.choices.some(
                  (ex) => ex.choice === c.choice && ex.targetNumber === c.targetNumber
                )
              ) {
                lastCollectRule!.choices.push(c);
              }
            });
          } else {
            rules.push({
              id: `${scriptNumber}-${ruleCounter++}`,
              prio: ruleCounter + 20,
              stepName: 'DTMF-Auswahl',
              sourceNumber: scriptNumber,
              condition: activeCondition,
              choices: parsedChoices,
              rawLine: t,
            });
          }
          continue;
        }
      }

      if (processActionSegment(actionSegment, t)) {
        continue;
      }

      lastCollectRule = null;

      // Support hybrid inline rules / schedules / holidays inside AACC blocks (e.g. `Prio 2: VIP -> 999`, `Zeitplan: Mo-Fr 08:00-18:00`)
      const inline = extractInlineKeyValuesFromText(actionSegment, scriptNumber);
      if (
        inline.matchedExplicitFields &&
        (inline.targetNumber ||
          inline.choices.length > 0 ||
          inline.queueTarget ||
          inline.schedule ||
          inline.holiday ||
          inline.condition)
      ) {
        rules.push({
          id: `${scriptNumber}-${ruleCounter++}`,
          prio: inline.prio !== undefined ? inline.prio : ruleCounter + 20,
          stepName:
            inline.stepName ||
            (inline.schedule
              ? 'Zeitplan'
              : inline.holiday
              ? 'Feiertag'
              : inline.targetNumber
              ? `Aufruf ${inline.targetNumber}`
              : 'Regel'),
          sourceNumber: scriptNumber,
          targetNumber: inline.targetNumber,
          choices: inline.choices,
          condition: inline.condition || activeCondition,
          schedule: inline.schedule,
          holiday: inline.holiday,
          announcement: inline.announcement,
          queueTarget: inline.queueTarget,
          rawLine: t,
        });
      }
    }

    // If the Masterscript had DNIS_Range Orga declarations (290 Rheinland, 210 CreditLife, 6099 Rhion)
    // but some VALUE rules weren't inside IF blocks, try matching Orga from targetScript or add Orga context if no rules referenced it yet
    if (orgaRegistry.size > 0) {
      for (const orgaCtx of orgaRegistry.values()) {
        const hasRuleWithOrga = rules.some(
          (r) =>
            (orgaCtx.orgaCode && r.orgaCode === orgaCtx.orgaCode) ||
            (orgaCtx.organizationName &&
              canonicalScriptMatchKey(r.organizationName || '') ===
                canonicalScriptMatchKey(orgaCtx.organizationName))
        );
        if (!hasRuleWithOrga) {
          const labelBits = [
            orgaCtx.organizationName || orgaCtx.brandName || 'Orga-Bereich',
            orgaCtx.srcRouteNumber || (orgaCtx.orgaCode ? `02131 ${orgaCtx.orgaCode}xxxx` : ''),
          ].filter(Boolean);
          rules.push({
            id: `${scriptNumber}-${ruleCounter++}`,
            prio: ruleCounter + 5,
            stepName: `DNIS-Range: ${labelBits.join(' · ')}`,
            sourceNumber: scriptNumber,
            choices: [],
            rawLine: `DNIS_Range ${labelBits.join(' ')}`,
            organizationName: orgaCtx.organizationName || orgaCtx.brandName,
            orgaCode: orgaCtx.orgaCode,
            brandName: orgaCtx.brandName,
            srcRouteNumber: orgaCtx.srcRouteNumber,
          });
        }
      }
    }

    if (rules.length > 0) {
      const outSet = new Set<string>();
      rules.forEach((r) => {
        if (
          r.targetNumber &&
          canonicalScriptMatchKey(r.targetNumber) !== canonicalScriptMatchKey(scriptNumber)
        ) {
          outSet.add(r.targetNumber);
        }
        r.choices.forEach((c) => {
          if (
            c.targetNumber &&
            canonicalScriptMatchKey(c.targetNumber) !== canonicalScriptMatchKey(scriptNumber)
          ) {
            outSet.add(c.targetNumber);
          }
        });
      });

      modules.push({
        scriptNumber,
        scriptName,
        isMaster:
          chunkIsMaster ||
          /^(?:main|master(?:script)?|0000)$/i.test(canonicalScriptMatchKey(scriptNumber)) ||
          /master|zentrale/i.test(scriptName),
        origin: options?.origin || 'legacy-text',
        sourceFilename: options?.sourceFilename,
        rawText: trimmedChunk,
        rules,
        outgoingNumbers: Array.from(outSet),
      });
    }
  });

  return modules;
}

/**
 * Checks reliably whether raw editor text is a free-text/multi-line Callflow script
 * or AACC routing script rather than Mermaid syntax. Never hijacks valid Mermaid diagram definitions.
 */
export function looksLikeRawCallflowScript(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 10) return false;

  // Strip optional %%{init:...}%% or YAML frontmatter before checking Mermaid header
  const withoutPreambles = trimmed
    .replace(/^%%\{[\s\S]*?\}%%\s*/g, '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/m, '')
    .trim();

  const firstMeaningfulLine =
    withoutPreambles
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('%%')) || '';

  if (MERMAID_HEADER_REGEX.test(firstMeaningfulLine)) {
    return false;
  }

  if (isAaccScriptText(trimmed)) {
    const parsed = parseScriptTextBundle(trimmed);
    return parsed.some((m) => m.rules.length > 0);
  }

  const cleanedText = stripScriptCommentsAndNoise(trimmed);
  const hasKeywords =
    /\b(?:prio(?:rit[aä]t)?|wohin|ziel|sprung|auswahl|taste|zeitplan|feiertag|bedingung|ansage|queue|warteschlange|skript|script|masterscript|execute|call|nummer)\b/i.test(
      cleanedText
    ) || /^main$/im.test(cleanedText.trim());
  const hasNumericScriptRefs = /\b\d{3,6}\b/.test(stripNumericNoiseForFreeText(cleanedText));
  const hasNamedScripts =
    /\b[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]*(?:script|schaltung)[A-Za-z0-9ÄÖÜäöüß_-]*\b/i.test(
      cleanedText
    );

  if (!hasKeywords && !hasNumericScriptRefs && !hasNamedScripts) return false;

  const parsed = parseCallflowTextWithFallback(cleanedText, {
    defaultScriptNumber: 'Main',
    defaultScriptName: 'Main',
    isMasterHint: true,
  });
  const totalRules = parsed.reduce((sum, m) => sum + m.rules.length, 0);
  return parsed.length > 0 && totalRules > 0;
}

/**
 * Parses raw text (or file contents) containing one or multiple script definitions
 * (AACC orchestration scripts as well as single-line and multi-line free-text blocks)
 * with Prio, Name, 3-to-6-digit Number/CDN, Wohin/Ziel/Sprung, Auswahl/Taste, Zeitplan,
 * Feiertag, Bedingung, Ansage, and Queue/Skillset.
 * Automatically ignores /* ... * /, //, -- comments and changelog/revision lines.
 */
export function parseScriptTextBundle(
  rawText: string,
  options?: {
    defaultScriptNumber?: string;
    defaultScriptName?: string;
    sourceFilename?: string;
    origin?: ScriptOrigin;
  }
): ScriptModule[] {
  const cleanedRawText = stripScriptCommentsAndNoise(rawText);

  if (isAaccScriptText(rawText)) {
    // If the bundle mixes explicit `=== ... ===` / `Skript:` sections (e.g. AACC Main + CSV/table subscripts),
    // split by explicit section headers so each block uses its matching parser.
    const rawLinesForSplit = cleanedRawText.split(/\r?\n/);
    const explicitSections: Array<{
      num: string;
      name: string;
      isMaster: boolean;
      lines: string[];
    }> = [];
    let currentSec: { num: string; name: string; isMaster: boolean; lines: string[] } | null = null;

    for (const rl of rawLinesForSplit) {
      const t = rl.trim();
      const masterBare = t.match(
        /^[=\-*#\s]*(main|master(?:script|\s*callflow)?)(?:\s*[:\-–]\s*(.*))?[=\-*\s]*$/i
      );
      const explicitHdr =
        t.match(/^[=\-*#\s]*\[([^\]]+)\]\s*([^=\-*]*?)[=\-*\s]*$/) ||
        t.match(
          /^[=\-*#\s]*(?:master(?:callflow|script)?|skript|script|modul)\s*(?:nr\.?|nummer)?\s*[:#]?\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?(?:\s*[-:|]\s*|\s+)?([^=\-*]*?)[=\-*\s]*$/i
        );
      const bareFramed = t.match(
        /^[=\-*#]{2,}\s*(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})\s*[=\-*#]{2,}$/
      );

      let matchedSec: { num: string; name: string; isMaster: boolean } | null = null;
      if (
        masterBare &&
        !t.includes('->') &&
        !t.includes('=>') &&
        !/\b(?:wohin|ziel|sprung|auswahl|taste)\b/i.test(t)
      ) {
        matchedSec = {
          num: 'Main',
          name: masterBare[2]?.trim() || 'Main',
          isMaster: true,
        };
      } else if (
        explicitHdr &&
        !/\b(?:wohin|ziel|sprung|auswahl|taste|prio|zeitplan|feiertag|bedingung|ansage|queue)\b/i.test(
          t
        ) &&
        !t.includes('->') &&
        !t.includes('=>')
      ) {
        const ref = normalizeScriptRef(explicitHdr[1]);
        if (isValidScriptRef(ref)) {
          matchedSec = {
            num: ref,
            name: (explicitHdr[2] || '').trim() || ref,
            isMaster: /^(?:main|master|0000)$/i.test(canonicalScriptMatchKey(ref)) || /master/i.test(t),
          };
        }
      } else if (bareFramed && isValidScriptRef(bareFramed[1])) {
        const ref = normalizeScriptRef(bareFramed[1]);
        matchedSec = {
          num: ref,
          name: bareFramed[1].trim(),
          isMaster: /^(?:main|master|0000)$/i.test(canonicalScriptMatchKey(ref)) || /master/i.test(ref),
        };
      }

      if (matchedSec) {
        if (currentSec) explicitSections.push(currentSec);
        currentSec = { ...matchedSec, lines: [] };
      } else if (currentSec) {
        currentSec.lines.push(rl);
      } else {
        currentSec = {
          num: options?.defaultScriptNumber ? normalizeScriptRef(options.defaultScriptNumber) : '',
          name: options?.defaultScriptName?.trim() || '',
          isMaster: false,
          lines: [rl],
        };
      }
    }
    if (currentSec) explicitSections.push(currentSec);

    const namedHeadersCount = explicitSections.filter((s) => Boolean(s.num)).length;
    if (namedHeadersCount > 0 && explicitSections.length >= 1) {
      const merged = new Map<string, ScriptModule>();
      for (const sec of explicitSections) {
        const secText = sec.lines.join('\n').trim();
        if (!secText) continue;
        const secOpts = {
          ...options,
          defaultScriptNumber: sec.num || options?.defaultScriptNumber,
          defaultScriptName: sec.name || options?.defaultScriptName,
        };
        const secMods = isAaccScriptText(secText)
          ? parseAaccScriptBlocks(secText, secOpts)
          : parseScriptTextBundle(secText, secOpts);
        secMods.forEach((m) => {
          const mod = sec.isMaster ? { ...m, isMaster: true } : m;
          const key = canonicalScriptMatchKey(mod.scriptNumber);
          const prev = merged.get(key);
          if (!prev) {
            merged.set(key, mod);
          } else {
            const combinedRules = [...prev.rules, ...mod.rules];
            const outSet = new Set<string>([...prev.outgoingNumbers, ...mod.outgoingNumbers]);
            outSet.delete(prev.scriptNumber);
            merged.set(key, {
              ...prev,
              isMaster: prev.isMaster || mod.isMaster,
              rules: combinedRules,
              outgoingNumbers: Array.from(outSet),
            });
          }
        });
      }
      if (merged.size > 0) {
        return Array.from(merged.values());
      }
    }

    const aaccModules = parseAaccScriptBlocks(rawText, options);
    if (aaccModules.length > 0) {
      return aaccModules;
    }
  }

  const lines = cleanedRawText.split(/\r?\n/);
  const moduleMap = new Map<string, ScriptModule>();

  let currentHeaderNumber = options?.defaultScriptNumber
    ? normalizeScriptRef(options.defaultScriptNumber)
    : '';
  let currentHeaderName = options?.defaultScriptName?.trim() || '';
  let currentHeaderIsMaster = false;

  if (!currentHeaderNumber && options?.sourceFilename) {
    const fileNum = options.sourceFilename.match(/\b(\d{3,6})\b/);
    if (fileNum) currentHeaderNumber = fileNum[1];
  }
  if (!currentHeaderName && options?.sourceFilename) {
    currentHeaderName = options.sourceFilename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }

  const ensureModule = (
    scriptNumber: string,
    scriptName?: string,
    isMasterHint = false
  ): ScriptModule => {
    const normNum = normalizeScriptRef(scriptNumber);
    const matchKey = canonicalScriptMatchKey(normNum);
    let existing: ScriptModule | undefined;
    for (const [k, v] of moduleMap.entries()) {
      if (canonicalScriptMatchKey(k) === matchKey) {
        existing = v;
        break;
      }
    }
    if (existing) {
      if (scriptName && (existing.scriptName === `Skript ${existing.scriptNumber}` || !existing.scriptName)) {
        existing.scriptName = scriptName;
      }
      if (isMasterHint) existing.isMaster = true;
      return existing;
    }
    const created: ScriptModule = {
      scriptNumber: normNum,
      scriptName: scriptName?.trim() || `Skript ${normNum}`,
      isMaster: isMasterHint || normNum === '0000' || /^(?:main|master(?:script)?)$/i.test(normNum),
      origin: options?.origin || 'legacy-text',
      sourceFilename: options?.sourceFilename,
      rawText,
      rules: [],
      outgoingNumbers: [],
    };
    moduleMap.set(normNum, created);
    return created;
  };

  let autoPrioCounter = 1;
  let pendingRule: {
    modNumber: string;
    prio: number;
    stepName: string;
    targetNumber?: string;
    choices: ScriptChoiceOption[];
    condition?: string;
    schedule?: string;
    holiday?: string;
    announcement?: string;
    queueTarget?: string;
    rawLines: string[];
  } | null = null;

  const flushPendingRule = () => {
    if (!pendingRule) return;
    const mod = ensureModule(
      pendingRule.modNumber,
      pendingRule.modNumber === currentHeaderNumber && currentHeaderName
        ? currentHeaderName
        : undefined,
      /master/i.test(pendingRule.stepName) || pendingRule.modNumber === '0000'
    );

    if (
      mod.scriptName === `Skript ${pendingRule.modNumber}` &&
      pendingRule.stepName &&
      !pendingRule.stepName.startsWith('Regel Prio')
    ) {
      mod.scriptName = pendingRule.stepName;
    }

    mod.rules.push({
      id: `${pendingRule.modNumber}-${mod.rules.length + 1}`,
      prio: pendingRule.prio,
      stepName: pendingRule.stepName,
      sourceNumber: pendingRule.modNumber,
      targetNumber: pendingRule.targetNumber,
      choices: pendingRule.choices,
      condition: pendingRule.condition,
      schedule: pendingRule.schedule,
      holiday: pendingRule.holiday,
      announcement: pendingRule.announcement,
      queueTarget: pendingRule.queueTarget,
      rawLine: pendingRule.rawLines.join(' | '),
    });
    pendingRule = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      // Blank line terminates an open multi-line rule block cleanly
      flushPendingRule();
      continue;
    }

    if (line.startsWith('#') || line.startsWith('//') || line.startsWith('%%')) {
      continue;
    }

    if (/^(?:prio|prioritaet|priorität)\s*[;|\t,]\s*(?:name|skript|bezeichnung)/i.test(line)) {
      continue;
    }

    // 1. Detect section/script header lines (`=== [100] Hauptmenü ===`, `=== Main ===`, `Skript: schaltung1script`)
    const headerMatch =
      line.match(/^[=\-*#\s]*\[([^\]]+)\]\s*([^=\-*]*?)[=\-*\s]*$/) ||
      line.match(
        /^[=\-*#\s]*(?:master(?:callflow|script)?|skript|script|modul)\s*(?:nr\.?|nummer)?\s*[:#]?\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?(?:\s*[-:|]\s*|\s+)?([^=\-*]*?)[=\-*\s]*$/i
      ) ||
      line.match(/^(\d{3,6})\s*[:\-–]\s*([A-Za-zÄÖÜäöüß][^->|;]{2,})$/);

    const masterBareHeader = line.match(
      /^[=\-*#\s]*(main|master(?:script|\s*callflow)?)(?:\s*[:\-–]\s*(.*))?[=\-*\s]*$/i
    );

    if (
      masterBareHeader &&
      !line.includes('->') &&
      !line.includes('=>') &&
      !/\b(?:wohin|ziel|sprung|auswahl|taste)\b/i.test(line)
    ) {
      flushPendingRule();
      currentHeaderNumber = 'Main';
      currentHeaderName = masterBareHeader[2]?.trim() || 'Main';
      currentHeaderIsMaster = true;
      autoPrioCounter = 1;
      ensureModule(currentHeaderNumber, currentHeaderName, true);
      continue;
    }

    if (
      headerMatch &&
      !/\b(?:wohin|ziel|sprung|auswahl|taste|prio|zeitplan|feiertag|bedingung|ansage|queue)\b/i.test(
        line
      ) &&
      !line.includes('->') &&
      !line.includes('=>')
    ) {
      flushPendingRule();
      const rawRef = normalizeScriptRef(headerMatch[1]);
      if (isValidScriptRef(rawRef)) {
        currentHeaderNumber = rawRef;
        currentHeaderName = (headerMatch[2] || '').trim() || `Skript ${currentHeaderNumber}`;
        currentHeaderIsMaster =
          /^(?:main|master)$/i.test(currentHeaderNumber) ||
          /master/i.test(line) ||
          currentHeaderNumber === '0000';
        autoPrioCounter = 1;
        ensureModule(currentHeaderNumber, currentHeaderName, currentHeaderIsMaster);
        continue;
      }
    }

    // Bare `=== Schaltung1 ===`, `=== 550 ===`, or `=== Main ===` header line wrapped with === / --- / #
    const bareFramedHeader = line.match(
      /^[=\-*#]{2,}\s*(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})\s*[=\-*#]{2,}$/
    );
    if (bareFramedHeader && isValidScriptRef(bareFramedHeader[1])) {
      flushPendingRule();
      currentHeaderNumber = normalizeScriptRef(bareFramedHeader[1]);
      currentHeaderName = bareFramedHeader[1].trim();
      currentHeaderIsMaster =
        /^(?:main|master|0000)$/i.test(canonicalScriptMatchKey(currentHeaderNumber)) ||
        /master/i.test(currentHeaderNumber);
      autoPrioCounter = 1;
      ensureModule(currentHeaderNumber, currentHeaderName, currentHeaderIsMaster);
      continue;
    }

    // Standalone `Nummer: 100` / `Nummer: 123456` header line when no target exists yet
    const standaloneNumHeader = line.match(/^(?:nummer|nr\.?|skriptnummer)\s*[:=]\s*(\d{3,6})$/i);
    if (standaloneNumHeader && !pendingRule) {
      currentHeaderNumber = standaloneNumHeader[1];
      autoPrioCounter = 1;
      ensureModule(currentHeaderNumber, currentHeaderName || undefined, currentHeaderNumber === '0000');
      continue;
    }

    const parsedLine = extractInlineKeyValuesFromText(line, currentHeaderNumber || undefined);
    const hasDelimiter = /[|;\t]/.test(line);

    // Check if this line is a pure attribute continuation belonging to `pendingRule`
    const isAttributeOnlyLine =
      !hasDelimiter &&
      parsedLine.prio === undefined &&
      !parsedLine.sourceNumber &&
      Boolean(
        parsedLine.condition ||
          parsedLine.schedule ||
          parsedLine.holiday ||
          parsedLine.announcement ||
          parsedLine.queueTarget ||
          parsedLine.choices.length > 0 ||
          parsedLine.targetNumber
      ) &&
      !parsedLine.stepName;

    if (pendingRule && isAttributeOnlyLine) {
      if (parsedLine.condition) {
        pendingRule.condition = pendingRule.condition
          ? `${pendingRule.condition}; ${parsedLine.condition}`
          : parsedLine.condition;
      }
      if (parsedLine.schedule) {
        pendingRule.schedule = parsedLine.schedule;
      }
      if (parsedLine.holiday) {
        pendingRule.holiday = parsedLine.holiday;
      }
      if (parsedLine.announcement) {
        pendingRule.announcement = parsedLine.announcement;
      }
      if (parsedLine.queueTarget) {
        pendingRule.queueTarget = parsedLine.queueTarget;
      }
      if (parsedLine.targetNumber) {
        if (!pendingRule.targetNumber) {
          pendingRule.targetNumber = parsedLine.targetNumber;
        } else if (pendingRule.targetNumber !== parsedLine.targetNumber) {
          pendingRule.choices.push({
            choice: 'Sprung',
            targetNumber: parsedLine.targetNumber,
          });
        }
      }
      if (parsedLine.choices.length > 0) {
        parsedLine.choices.forEach((c) => {
          if (
            !pendingRule!.choices.some(
              (ex) => ex.choice === c.choice && ex.targetNumber === c.targetNumber
            )
          ) {
            pendingRule!.choices.push(c);
          }
        });
      }
      pendingRule.rawLines.push(line);
      continue;
    }

    // If delimiter line or explicit new Prio/StepName/SourceNumber -> start new rule
    flushPendingRule();

    const bareTargetToken =
      !parsedLine.targetNumber &&
      !parsedLine.sourceNumber &&
      parsedLine.choices.length === 0 &&
      (currentHeaderIsMaster || /^(?:main|master(?:script)?)$/i.test(currentHeaderNumber)) &&
      /^[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,}$/.test(line) &&
      isPlausibleNamedScriptTarget(line)
        ? normalizeScriptRef(line)
        : undefined;

    const resolvedTarget = parsedLine.targetNumber || bareTargetToken;
    const effectiveSource = parsedLine.sourceNumber || currentHeaderNumber || resolvedTarget;
    if (
      !effectiveSource &&
      !resolvedTarget &&
      parsedLine.choices.length === 0 &&
      !parsedLine.queueTarget
    ) {
      continue;
    }

    const modNumber = effectiveSource || 'Main';
    const resolvedPrio =
      parsedLine.prio !== undefined && Number.isFinite(parsedLine.prio)
        ? parsedLine.prio
        : autoPrioCounter++;
    const resolvedStepName =
      bareTargetToken
        ? `Aufruf ${bareTargetToken}`
        : parsedLine.stepName ||
          (resolvedTarget
            ? `Aufruf ${resolvedTarget}`
            : modNumber === currentHeaderNumber && currentHeaderName
            ? currentHeaderName
            : `Regel Prio ${resolvedPrio}`);

    pendingRule = {
      modNumber,
      prio: resolvedPrio,
      stepName: resolvedStepName,
      targetNumber: resolvedTarget,
      choices: [...parsedLine.choices],
      condition: parsedLine.condition,
      schedule: parsedLine.schedule,
      holiday: parsedLine.holiday,
      announcement: parsedLine.announcement,
      queueTarget: parsedLine.queueTarget,
      rawLines: [line],
    };

    // Single delimited line (table/pipe row) flushes immediately so adjacent pipe lines don't merge
    if (hasDelimiter) {
      flushPendingRule();
    }
  }

  flushPendingRule();

  return Array.from(moduleMap.values()).map((mod) => {
    const outSet = new Set<string>();
    const selfKey = canonicalScriptMatchKey(mod.scriptNumber);
    mod.rules.sort((a, b) => a.prio - b.prio);
    mod.rules.forEach((r) => {
      if (r.targetNumber && canonicalScriptMatchKey(r.targetNumber) !== selfKey) {
        outSet.add(r.targetNumber);
      }
      r.choices.forEach((c) => {
        if (c.targetNumber && canonicalScriptMatchKey(c.targetNumber) !== selfKey) {
          outSet.add(c.targetNumber);
        }
      });
    });
    return {
      ...mod,
      outgoingNumbers: Array.from(outSet),
    };
  });
}

/**
 * Shared text-script parser used across Start Wizard, Checklist Step input,
 * Multi-Script modal, and live Editor auto-conversion. Falls back cleanly to
 * line-by-line script/target detection when text uses free-form or bare target lists.
 */
export function parseCallflowTextWithFallback(
  rawText: string,
  options?: {
    defaultScriptNumber?: string;
    defaultScriptName?: string;
    sourceFilename?: string;
    origin?: ScriptOrigin;
    isMasterHint?: boolean;
  }
): ScriptModule[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  const structured = parseScriptTextBundle(trimmed, options);
  const hasRules = structured.some((m) => m.rules.length > 0);
  if (structured.length > 0 && hasRules) {
    return structured;
  }

  const defaultRef = normalizeScriptRef(options?.defaultScriptNumber || 'Main') || 'Main';
  const defaultKey = canonicalScriptMatchKey(defaultRef);
  const defaultName = options?.defaultScriptName?.trim() || defaultRef;
  const origin: ScriptOrigin = options?.origin || 'legacy-text';
  const isMaster =
    options?.isMasterHint ??
    (/^(?:main|master(?:script)?)$/i.test(defaultKey) || defaultKey === '0000');

  const cleanedText = stripScriptCommentsAndNoise(trimmed);
  const cleanedLines = cleanedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      const lineKey = canonicalScriptMatchKey(l);
      if (lineKey === defaultKey || /^main$/i.test(l) || /^master(?:script)?$/i.test(l)) {
        return false;
      }
      return true;
    });

  if (cleanedLines.length === 0) return [];

  const outMap = new Map<string, string>();
  const rules: ScriptRule[] = cleanedLines.map((line, idx) => {
    const withoutNoise = stripNumericNoiseForFreeText(line).trim();
    const numMatch = withoutNoise.match(/\b(\d{3,6})\b/);
    const arrowMatch = withoutNoise.match(
      /(?:->|=>|\b(?:wohin|ziel|sprung|execute(?:\s+script)?|call(?:\s+script)?|script|skript)\s*[:=]?)\s*["']?(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,})["']?\b/i
    );
    const namedMatch = withoutNoise.match(
      /\b([A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]*(?:script|schaltung)[A-Za-z0-9ÄÖÜäöüß_-]*)\b/i
    );
    const singleTokenCandidate =
      /^[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.-]{2,}$/.test(withoutNoise) &&
      isPlausibleNamedScriptTarget(withoutNoise)
        ? withoutNoise
        : undefined;

    const arrowTarget = arrowMatch && isValidScriptRef(arrowMatch[1]) ? arrowMatch[1] : undefined;

    const rawTargetRef =
      arrowTarget ||
      numMatch?.[1] ||
      (namedMatch && isPlausibleNamedScriptTarget(namedMatch[1]) ? namedMatch[1] : undefined) ||
      singleTokenCandidate;

    const normalizedTarget = rawTargetRef ? normalizeScriptRef(rawTargetRef) : undefined;
    const effectiveTarget =
      normalizedTarget && canonicalScriptMatchKey(normalizedTarget) !== defaultKey
        ? normalizedTarget
        : undefined;

    if (effectiveTarget) {
      outMap.set(canonicalScriptMatchKey(effectiveTarget), effectiveTarget);
    }

    return {
      id: `${toMermaidNodeSuffix(defaultRef)}-fb-${idx + 1}`,
      prio: idx + 1,
      stepName: line.slice(0, 80),
      sourceNumber: defaultRef,
      targetNumber: effectiveTarget,
      choices: [],
      rawLine: line,
    };
  });

  return [
    {
      scriptNumber: defaultRef,
      scriptName: defaultName,
      isMaster,
      origin,
      sourceFilename: options?.sourceFilename,
      rawText: trimmed,
      rules,
      outgoingNumbers: Array.from(outMap.values()),
    },
  ];
}

export interface WorkspaceResolutionState {
  externalEndpoints?: string[];
  ignoredChecklistTargets?: string[];
  resolvedIssues?: Record<string, ResolvedIssueRecord>;
  manualQuestions?: CallflowOpenIssue[];
  manualLinks?: ScriptManualLink[];
  masterScriptNumber?: string;
  nodeOffsets?: Record<string, NodePositionOffset>;
}

/**
 * Selects the active Masterscript and recursively traverses all referenced child
 * and nested sub-scripts (both named scripts like `schaltung1script` and 4-digit CDNs)
 * strictly in top-to-bottom order so nested Level-3+ sub-scripts are appended automatically.
 */
export function detectMasterScriptChecklist(
  modules: ScriptModule[],
  externalEndpoints: string[] = [],
  manualLinks: ScriptManualLink[] = [],
  preferredMasterNumber?: string,
  ignoredChecklistTargets: string[] = []
): {
  masterScriptNumber?: string;
  masterChecklist: MasterScriptChecklistItem[];
} {
  if (modules.length === 0) {
    return { masterScriptNumber: undefined, masterChecklist: [] };
  }

  const moduleByKey = new Map<string, ScriptModule>();
  modules.forEach((m) => moduleByKey.set(canonicalScriptMatchKey(m.scriptNumber), m));

  const incomingCount = new Map<string, number>();
  modules.forEach((m) => incomingCount.set(canonicalScriptMatchKey(m.scriptNumber), 0));
  modules.forEach((m) => {
    m.outgoingNumbers.forEach((t) => {
      const k = canonicalScriptMatchKey(t);
      if (incomingCount.has(k)) {
        incomingCount.set(k, (incomingCount.get(k) || 0) + 1);
      }
    });
  });

  let masterMod: ScriptModule | undefined;
  if (preferredMasterNumber) {
    masterMod = moduleByKey.get(canonicalScriptMatchKey(preferredMasterNumber));
  }
  if (!masterMod) {
    masterMod =
      modules.find(
        (m) =>
          m.isMaster &&
          /^(?:main|0000|master(?:script)?)$/i.test(canonicalScriptMatchKey(m.scriptNumber))
      ) ||
      modules.find((m) => m.isMaster) ||
      modules.find((m) => (incomingCount.get(canonicalScriptMatchKey(m.scriptNumber)) || 0) === 0) ||
      modules[0];
  }

  const masterKey = canonicalScriptMatchKey(masterMod.scriptNumber);
  const externalKeys = new Set(externalEndpoints.map(canonicalScriptMatchKey));
  const ignoredKeys = new Set(ignoredChecklistTargets.map(canonicalScriptMatchKey));
  const seenTargetKeys = new Set<string>([masterKey]);
  const visitedModuleKeys = new Set<string>([masterKey]);
  const checklist: MasterScriptChecklistItem[] = [];

  const traverseModule = (mod: ScriptModule, depth: number) => {
    const modKey = canonicalScriptMatchKey(mod.scriptNumber);
    const pendingNested: Array<{ mod: ScriptModule; nextDepth: number }> = [];

    const pushTargetRef = (
      rawRef: string,
      contextLabel: string,
      ruleId?: string,
      prio?: number
    ) => {
      const cleanRef = normalizeScriptRef(rawRef);
      const key = canonicalScriptMatchKey(cleanRef);
      if (!cleanRef || seenTargetKeys.has(key) || ignoredKeys.has(key)) return;
      seenTargetKeys.add(key);

      const matchedMod = moduleByKey.get(key);
      const status = matchedMod
        ? 'present'
        : externalKeys.has(key)
        ? 'external'
        : 'missing';

      checklist.push({
        id: `mchk:${masterKey}:${checklist.length + 1}:${key}`,
        orderIndex: checklist.length + 1,
        refKey: matchedMod ? matchedMod.scriptNumber : cleanRef,
        displayName: matchedMod ? matchedMod.scriptName : cleanRef,
        callerScriptNumber: mod.scriptNumber,
        parentScriptNumber: mod.scriptNumber,
        depth,
        ruleId,
        prio,
        contextLabel:
          depth > 1 ? `aus [${mod.scriptNumber}] · ${contextLabel}` : contextLabel,
        status,
        matchedModuleNumber: matchedMod?.scriptNumber,
      });

      if (matchedMod && !visitedModuleKeys.has(key)) {
        visitedModuleKeys.add(key);
        pendingNested.push({ mod: matchedMod, nextDepth: depth + 1 });
      }
    };

    const sortedRules = [...mod.rules].sort((a, b) => a.prio - b.prio);

    interface AggregatedTargetRef {
      rawRef: string;
      firstRuleId?: string;
      firstPrio?: number;
      firstSnippet: string;
      choiceTags: string[];
      valueNumbers: string[];
      orgaLabels: string[];
      brandNames: string[];
      isFaxRoute: boolean;
    }

    const aggregatedMap = new Map<string, AggregatedTargetRef>();

    const recordAggregatedTarget = (
      rawRef: string,
      rule: ScriptRule,
      choiceTag?: string
    ) => {
      const clean = normalizeScriptRef(rawRef);
      const key = canonicalScriptMatchKey(clean);
      if (!clean || key === modKey) return;

      let entry = aggregatedMap.get(key);
      if (!entry) {
        entry = {
          rawRef: clean,
          firstRuleId: rule.id,
          firstPrio: rule.prio,
          firstSnippet: rule.stepName ? rule.stepName.slice(0, 32) : `Prio ${rule.prio}`,
          choiceTags: [],
          valueNumbers: [],
          orgaLabels: [],
          brandNames: [],
          isFaxRoute: false,
        };
        aggregatedMap.set(key, entry);
      }

      if (choiceTag && !entry.choiceTags.includes(choiceTag)) {
        entry.choiceTags.push(choiceTag);
      }
      (rule.valueNumbers || []).forEach((v) => {
        if (!entry!.valueNumbers.includes(v)) entry!.valueNumbers.push(v);
      });
      if (rule.organizationName) {
        const orgLabel = rule.orgaCode
          ? `${rule.organizationName} (${rule.orgaCode})`
          : rule.organizationName;
        if (!entry.orgaLabels.includes(orgLabel)) entry.orgaLabels.push(orgLabel);
      }
      if (rule.brandName && !entry.brandNames.includes(rule.brandName)) {
        entry.brandNames.push(rule.brandName);
      }
      if (rule.isFaxRoute) {
        entry.isFaxRoute = true;
      }
    };

    sortedRules.forEach((rule) => {
      if (rule.targetNumber) {
        recordAggregatedTarget(rule.targetNumber, rule);
      }
      rule.choices.forEach((ch) => {
        const chTag = /^(?:Feiertag|Zeitplan|Bedingung|Sprung)$/i.test(ch.choice)
          ? ch.choice
          : `Taste ${ch.choice}`;
        recordAggregatedTarget(ch.targetNumber, rule, chTag);
      });
    });

    for (const agg of aggregatedMap.values()) {
      const cleanRef = agg.rawRef;
      const key = canonicalScriptMatchKey(cleanRef);
      if (seenTargetKeys.has(key) || ignoredKeys.has(key)) continue;
      seenTargetKeys.add(key);

      const matchedMod = moduleByKey.get(key);
      const status = matchedMod
        ? 'present'
        : externalKeys.has(key)
        ? 'external'
        : 'missing';

      let contextLabel: string;
      if (agg.valueNumbers.length > 0 || agg.orgaLabels.length > 0 || agg.isFaxRoute) {
        const parts: string[] = [];
        if (agg.isFaxRoute) parts.push('Fax (4-stellig)');
        if (agg.orgaLabels.length > 0) parts.push(agg.orgaLabels.join('/'));
        if (agg.valueNumbers.length > 0) {
          const preview = agg.valueNumbers.slice(0, 4).join(', ');
          const extra = agg.valueNumbers.length > 4 ? ` (+${agg.valueNumbers.length - 4})` : '';
          parts.push(`VALUE: ${preview}${extra}`);
        }
        contextLabel = parts.join(' · ');
      } else if (agg.choiceTags.length > 0) {
        contextLabel = `Prio ${agg.firstPrio ?? 1} · ${agg.choiceTags.slice(0, 2).join(', ')}`;
      } else {
        contextLabel = `Prio ${agg.firstPrio ?? 1} · ${agg.firstSnippet}`;
      }

      checklist.push({
        id: `mchk:${masterKey}:${checklist.length + 1}:${key}`,
        orderIndex: checklist.length + 1,
        refKey: matchedMod ? matchedMod.scriptNumber : cleanRef,
        displayName: matchedMod ? matchedMod.scriptName : cleanRef,
        callerScriptNumber: mod.scriptNumber,
        parentScriptNumber: mod.scriptNumber,
        depth,
        ruleId: agg.firstRuleId,
        prio: agg.firstPrio,
        contextLabel:
          depth > 1 ? `aus [${mod.scriptNumber}] · ${contextLabel}` : contextLabel,
        status,
        matchedModuleNumber: matchedMod?.scriptNumber,
        triggeredNumbers: agg.valueNumbers.length > 0 ? agg.valueNumbers : undefined,
        organizationNames: agg.orgaLabels.length > 0 ? agg.orgaLabels : undefined,
        brandNames: agg.brandNames.length > 0 ? agg.brandNames : undefined,
        isFaxRoute: agg.isFaxRoute || undefined,
      });

      if (matchedMod && !visitedModuleKeys.has(key)) {
        visitedModuleKeys.add(key);
        pendingNested.push({ mod: matchedMod, nextDepth: depth + 1 });
      }
    }

    manualLinks
      .filter((lnk) => canonicalScriptMatchKey(lnk.fromScriptNumber) === modKey && lnk.toTargetNumber)
      .forEach((lnk) => {
        pushTargetRef(lnk.toTargetNumber, lnk.label || 'Manuell verknüpft', lnk.fromRuleId);
      });

    // Recursively append nested sub-scripts discovered inside present detail modules
    pendingNested.forEach((nested) => {
      traverseModule(nested.mod, nested.nextDepth);
    });
  };

  traverseModule(masterMod, 1);

  return {
    masterScriptNumber: masterMod.scriptNumber,
    masterChecklist: checklist,
  };
}

/**
 * Automatically detects missing referenced scripts and unclear/incomplete routing transitions,
 * merging persisted answers & manual questions.
 */
export function detectWorkspaceIssues(
  modules: ScriptModule[],
  missingTargets: string[],
  state?: WorkspaceResolutionState
): CallflowOpenIssue[] {
  const resolvedMap = state?.resolvedIssues || {};
  const externalKeySet = new Set((state?.externalEndpoints || []).map(canonicalScriptMatchKey));
  const ignoredKeySet = new Set((state?.ignoredChecklistTargets || []).map(canonicalScriptMatchKey));
  const manualLinks = state?.manualLinks || [];
  const issues: CallflowOpenIssue[] = [];
  const now = Date.now();

  const callersByTargetKey = new Map<string, Set<string>>();
  modules.forEach((mod) => {
    mod.outgoingNumbers.forEach((target) => {
      const k = canonicalScriptMatchKey(target);
      const set = callersByTargetKey.get(k) || new Set<string>();
      set.add(mod.scriptNumber);
      callersByTargetKey.set(k, set);
    });
  });

  // 1. Missing targets (free script names or 4-digit numbers)
  missingTargets.forEach((targetRef) => {
    const tKey = canonicalScriptMatchKey(targetRef);
    if (externalKeySet.has(tKey) || ignoredKeySet.has(tKey)) return;
    const callers = Array.from(callersByTargetKey.get(tKey) || []);
    const primaryCaller = callers[0] || targetRef;
    const id = `missing:${tKey}`;
    const rec = resolvedMap[id] || resolvedMap[`missing:${targetRef}`];

    issues.push({
      id,
      type: 'missing-script',
      status: rec ? 'resolved' : 'open',
      sourceScriptNumber: primaryCaller,
      targetNumber: targetRef,
      title: `Fehlendes Skript [${targetRef}]`,
      question:
        callers.length > 0
          ? `Ziel [${targetRef}] wird von ${callers.map((c) => `[${c}]`).join(', ')} aufgerufen, liegt aber noch nicht im Detail vor.`
          : `Ziel [${targetRef}] liegt noch nicht als Detail-Skript oder grafischer Export vor.`,
      resolution: rec?.resolution,
      resolutionNote: rec?.note,
      linkedTargetNumber: rec?.linkedTargetNumber,
      createdAt: now,
      resolvedAt: rec?.resolvedAt,
    });
  });

  // 2. Unclear / incomplete transitions inside scripts or Visio pages
  modules.forEach((mod) => {
    const modKey = canonicalScriptMatchKey(mod.scriptNumber);
    const sorted = [...mod.rules].sort((a, b) => a.prio - b.prio);
    sorted.forEach((rule, idx) => {
      const hasManualRuleLink = manualLinks.some(
        (lnk) =>
          canonicalScriptMatchKey(lnk.fromScriptNumber) === modKey &&
          (!lnk.fromRuleId || lnk.fromRuleId === rule.id)
      );
      if (hasManualRuleLink) return;

      const hasExplicitRoute = Boolean(
        rule.targetNumber || rule.queueTarget || rule.choices.length > 0
      );
      const isDeactivatedOverflow =
        /\(deaktiviert\s*=\s*0\)/i.test(rule.stepName) && !rule.targetNumber && !rule.queueTarget;
      const hasExplicitTodoMarker = /(?:\?\?\?|\b(?:TODO|TBD|OFFEN|UNKLAR|KLÄREN)\b)/i.test(
        `${rule.stepName} ${rule.rawLine}`
      );
      const isTerminalOrInitLabel =
        /^(?:init\b|ende\b|end\b|abwurf|auflegen|mailbox|ansage|begrüßung|begruessung|willkommen|musik|start)/i.test(
          rule.stepName.trim()
        ) ||
        /\b(?:abwurf|auflegen|mailbox|hangup|disconnect)\b/i.test(rule.stepName);

      const isVisioLastUnclear =
        mod.origin === 'visio-new' &&
        idx === sorted.length - 1 &&
        !hasExplicitRoute &&
        !isTerminalOrInitLabel;
      const isUnclearBranch =
        (/\?/.test(rule.stepName) || /\b(?:wenn|falls|entscheidung|verzweigung)\b/i.test(rule.stepName)) &&
        !hasExplicitRoute &&
        idx === sorted.length - 1;

      if (isDeactivatedOverflow || hasExplicitTodoMarker || isVisioLastUnclear || isUnclearBranch) {
        const id = `unclear:${modKey}:${rule.id}`;
        const rec = resolvedMap[id] || resolvedMap[`unclear:${mod.scriptNumber}:${rule.id}`];
        issues.push({
          id,
          type: 'unclear-transition',
          status: rec ? 'resolved' : 'open',
          sourceScriptNumber: mod.scriptNumber,
          ruleId: rule.id,
          title: `Unklarer Übergang [${mod.scriptNumber}]`,
          question: isDeactivatedOverflow
            ? `Überlauf bei [${mod.scriptNumber}] ist aktuell deaktiviert (= 0). Gibt es ein alternatives Ziel oder endet der Anruf hier?`
            : `Bei [${mod.scriptNumber}] „${rule.stepName}“ fehlt ein klares Ziel bzw. enthält einen offenen Vermerk. Wohin führt dieser Schritt?`,
          resolution: rec?.resolution,
          resolutionNote: rec?.note,
          linkedTargetNumber: rec?.linkedTargetNumber,
          createdAt: now,
          resolvedAt: rec?.resolvedAt,
        });
      }
    });
  });

  // 4. User-created manual questions
  (state?.manualQuestions || []).forEach((mq) => {
    if (
      mq &&
      typeof mq.id === 'string' &&
      typeof mq.question === 'string' &&
      (mq.type === 'missing-script' ||
        mq.type === 'unclear-transition' ||
        mq.type === 'manual-question')
    ) {
      issues.push(mq);
    }
  });

  return issues;
}

/**
 * Rebuilds workspace metadata (missing referenced targets, manual links,
 * top-down master checklist, and open issues list).
 */
function dedupeRefsByCanonicalKey(refs?: string[]): string[] {
  const map = new Map<string, string>();
  (refs || []).forEach((ref) => {
    const clean = normalizeScriptRef(ref);
    const key = canonicalScriptMatchKey(clean);
    if (clean && key && !map.has(key)) {
      map.set(key, clean);
    }
  });
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function buildScriptWorkspace(
  modules: ScriptModule[],
  prevState?: WorkspaceResolutionState
): ScriptWorkspace {
  const externalEndpoints = dedupeRefsByCanonicalKey(prevState?.externalEndpoints);
  const ignoredChecklistTargets = dedupeRefsByCanonicalKey(prevState?.ignoredChecklistTargets);
  const externalKeySet = new Set(externalEndpoints.map(canonicalScriptMatchKey));
  const ignoredKeySet = new Set(ignoredChecklistTargets.map(canonicalScriptMatchKey));
  const manualLinks = prevState?.manualLinks || [];
  const resolvedIssues = prevState?.resolvedIssues || {};
  const manualQuestions = prevState?.manualQuestions || [];

  const knownKeyToDisplay = new Map<string, string>();
  modules.forEach((m) =>
    knownKeyToDisplay.set(canonicalScriptMatchKey(m.scriptNumber), m.scriptNumber)
  );
  const missingByKey = new Map<string, string>();

  const normalizedModules = modules
    .map((mod) => {
      const outMap = new Map<string, string>();
      const selfKey = canonicalScriptMatchKey(mod.scriptNumber);
      const sortedRules = [...mod.rules].sort((a, b) => a.prio - b.prio);

      const recordTarget = (rawTarget: string) => {
        const clean = normalizeScriptRef(rawTarget);
        const tKey = canonicalScriptMatchKey(clean);
        if (!clean || ignoredKeySet.has(tKey)) return;
        const canonicalDisplay = knownKeyToDisplay.get(tKey) || clean;
        if (tKey !== selfKey) {
          outMap.set(tKey, canonicalDisplay);
        }
        if (!knownKeyToDisplay.has(tKey) && !externalKeySet.has(tKey)) {
          missingByKey.set(tKey, canonicalDisplay);
        }
      };

      sortedRules.forEach((r) => {
        if (r.targetNumber) recordTarget(r.targetNumber);
        r.choices.forEach((c) => {
          if (c.targetNumber) recordTarget(c.targetNumber);
        });
      });

      manualLinks.forEach((lnk) => {
        if (
          canonicalScriptMatchKey(lnk.fromScriptNumber) === selfKey &&
          lnk.toTargetNumber
        ) {
          recordTarget(lnk.toTargetNumber);
        }
      });

      return {
        ...mod,
        origin: mod.origin || 'legacy-text',
        rules: sortedRules,
        outgoingNumbers: Array.from(outMap.values()),
      };
    })
    .sort((a, b) => {
      if (a.isMaster && !b.isMaster) return -1;
      if (!a.isMaster && b.isMaster) return 1;
      return a.scriptNumber.localeCompare(b.scriptNumber, undefined, { numeric: true });
    });

  const missingTargets = Array.from(missingByKey.values());
  const issues = detectWorkspaceIssues(normalizedModules, missingTargets, {
    externalEndpoints,
    ignoredChecklistTargets,
    resolvedIssues,
    manualQuestions,
    manualLinks,
  });

  const { masterScriptNumber, masterChecklist } = detectMasterScriptChecklist(
    normalizedModules,
    externalEndpoints,
    manualLinks,
    prevState?.masterScriptNumber,
    ignoredChecklistTargets
  );

  const openIssueCount = issues.filter((i) => i.status === 'open').length;

  return {
    modules: normalizedModules,
    missingTargets,
    externalEndpoints,
    ignoredChecklistTargets,
    resolvedIssues,
    manualQuestions,
    manualLinks,
    issues,
    openIssueCount,
    masterScriptNumber,
    masterChecklist,
    nodeOffsets: prevState?.nodeOffsets,
    updatedAt: Date.now(),
  };
}

/**
 * Merges newly imported/parsed modules (text scripts + graphical Visio exports) cleanly by canonical key.
 */
export function mergeScriptModules(
  existing: ScriptModule[],
  incoming: ScriptModule[]
): ScriptModule[] {
  const merged = new Map<string, ScriptModule>();
  existing.forEach((m) => merged.set(canonicalScriptMatchKey(m.scriptNumber), m));
  incoming.forEach((m) => {
    const key = canonicalScriptMatchKey(m.scriptNumber);
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, m);
      return;
    }
    const existingKeys = new Set(
      prev.rules.map((r) => `${r.prio}|${r.stepName}|${r.targetNumber || ''}|${r.rawLine}`)
    );
    const combinedRules = [...prev.rules];
    m.rules.forEach((r) => {
      const k = `${r.prio}|${r.stepName}|${r.targetNumber || ''}|${r.rawLine}`;
      if (!existingKeys.has(k)) {
        combinedRules.push({
          ...r,
          sourceNumber: prev.scriptNumber,
          id: `${toMermaidNodeSuffix(prev.scriptNumber)}-${combinedRules.length + 1}`,
        });
      }
    });

    const prevOrigin: ScriptOrigin = prev.origin === 'visio-new' ? 'visio-new' : 'legacy-text';
    const nextOrigin: ScriptOrigin = m.origin === 'visio-new' ? 'visio-new' : 'legacy-text';
    const mergedOrigin: ScriptOrigin =
      nextOrigin === 'visio-new' ? 'visio-new' : prevOrigin;

    merged.set(key, {
      ...prev,
      origin: mergedOrigin,
      visioPageName: m.visioPageName || prev.visioPageName,
      scriptName:
        m.scriptName && m.scriptName !== `Skript ${m.scriptNumber}`
          ? m.scriptName
          : prev.scriptName,
      isMaster: prev.isMaster || m.isMaster,
      rawText: prev.rawText === m.rawText ? prev.rawText : `${prev.rawText}\n${m.rawText}`,
      rules: combinedRules,
    });
  });

  return buildScriptWorkspace(Array.from(merged.values())).modules;
}

/**
 * Helper to apply an interactive checklist resolution onto a ScriptWorkspace cleanly.
 */
export function applyIssueResolutionToWorkspace(
  workspace: ScriptWorkspace,
  issue: CallflowOpenIssue,
  action: {
    resolution: CallflowIssueResolution;
    linkedTargetNumber?: string;
    linkLabel?: string;
    note?: string;
  }
): ScriptWorkspace {
  const nextExternalMap = new Map<string, string>();
  (workspace.externalEndpoints || []).forEach((ext) => {
    const clean = normalizeScriptRef(ext);
    if (clean) nextExternalMap.set(canonicalScriptMatchKey(clean), clean);
  });

  const nextResolved = { ...(workspace.resolvedIssues || {}) };
  let nextLinks = [...(workspace.manualLinks || [])];
  const nextModules = [...workspace.modules];
  let nextManualQuestions = [...(workspace.manualQuestions || [])];

  if (issue.type === 'missing-script' && issue.targetNumber) {
    const cleanTarget = normalizeScriptRef(issue.targetNumber);
    const targetKey = canonicalScriptMatchKey(cleanTarget);
    if (action.resolution === 'external-endpoint') {
      nextExternalMap.set(targetKey, cleanTarget);
    } else if (action.resolution === 'linked-target' && action.linkedTargetNumber) {
      nextExternalMap.set(targetKey, cleanTarget);
      nextLinks.push({
        id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fromScriptNumber: cleanTarget,
        toTargetNumber: normalizeScriptRef(action.linkedTargetNumber),
        label: action.linkLabel || 'Verknüpft',
        note: action.note,
      });
    }
  } else if (issue.type === 'unclear-transition') {
    if (action.resolution === 'linked-target' && action.linkedTargetNumber) {
      const srcKey = canonicalScriptMatchKey(issue.sourceScriptNumber);
      nextLinks = nextLinks.filter(
        (l) =>
          !(
            canonicalScriptMatchKey(l.fromScriptNumber) === srcKey &&
            l.fromRuleId === issue.ruleId
          )
      );
      nextLinks.push({
        id: `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fromScriptNumber: issue.sourceScriptNumber,
        fromRuleId: issue.ruleId,
        toTargetNumber: normalizeScriptRef(action.linkedTargetNumber),
        label: action.linkLabel || 'Geklärt',
        note: action.note,
      });
    }
  }

  if (issue.isManual) {
    nextManualQuestions = nextManualQuestions.map((mq) =>
      mq.id === issue.id
        ? {
            ...mq,
            status: 'resolved',
            resolution: action.resolution,
            resolutionNote: action.note,
            linkedTargetNumber: action.linkedTargetNumber,
            resolvedAt: Date.now(),
          }
        : mq
    );
  } else {
    nextResolved[issue.id] = {
      resolution: action.resolution,
      note: action.note,
      linkedTargetNumber: action.linkedTargetNumber,
      resolvedAt: Date.now(),
    };
  }

  return buildScriptWorkspace(nextModules, {
    externalEndpoints: Array.from(nextExternalMap.values()),
    ignoredChecklistTargets: workspace.ignoredChecklistTargets,
    resolvedIssues: nextResolved,
    manualQuestions: nextManualQuestions,
    manualLinks: nextLinks,
    masterScriptNumber: workspace.masterScriptNumber,
    nodeOffsets: workspace.nodeOffsets,
  });
}

export function reopenIssueInWorkspace(
  workspace: ScriptWorkspace,
  issue: CallflowOpenIssue
): ScriptWorkspace {
  const nextExternal = new Set(workspace.externalEndpoints || []);
  const nextResolved = { ...(workspace.resolvedIssues || {}) };
  let nextLinks = [...(workspace.manualLinks || [])];
  let nextManualQuestions = [...(workspace.manualQuestions || [])];

  if (issue.type === 'missing-script' && issue.targetNumber) {
    for (const ext of Array.from(nextExternal)) {
      if (canonicalScriptMatchKey(ext) === canonicalScriptMatchKey(issue.targetNumber)) {
        nextExternal.delete(ext);
      }
    }
  }
  if (issue.type === 'unclear-transition' && issue.ruleId) {
    nextLinks = nextLinks.filter((l) => l.fromRuleId !== issue.ruleId);
  }

  if (issue.isManual) {
    nextManualQuestions = nextManualQuestions.map((mq) =>
      mq.id === issue.id
        ? {
            ...mq,
            status: 'open',
            resolution: undefined,
            resolvedAt: undefined,
          }
        : mq
    );
  } else {
    delete nextResolved[issue.id];
  }

  return buildScriptWorkspace(workspace.modules, {
    externalEndpoints: Array.from(nextExternal),
    ignoredChecklistTargets: workspace.ignoredChecklistTargets,
    resolvedIssues: nextResolved,
    manualQuestions: nextManualQuestions,
    manualLinks: nextLinks,
    masterScriptNumber: workspace.masterScriptNumber,
    nodeOffsets: workspace.nodeOffsets,
  });
}

/**
 * Re-activates a previously ignored checklist target so it becomes requestable again.
 */
export function unignoreChecklistTargetInWorkspace(
  workspace: ScriptWorkspace,
  targetRef: string
): ScriptWorkspace {
  const targetKey = canonicalScriptMatchKey(targetRef);
  const nextIgnored = (workspace.ignoredChecklistTargets || []).filter(
    (t) => canonicalScriptMatchKey(t) !== targetKey
  );
  return buildScriptWorkspace(workspace.modules, {
    externalEndpoints: workspace.externalEndpoints,
    ignoredChecklistTargets: nextIgnored,
    resolvedIssues: workspace.resolvedIssues,
    manualQuestions: workspace.manualQuestions,
    manualLinks: workspace.manualLinks,
    masterScriptNumber: workspace.masterScriptNumber,
    nodeOffsets: workspace.nodeOffsets,
  });
}

/**
 * Extracts a script reference (4-digit number or named script identifier) from a Two-Level Mermaid node ID.
 */
export function extractScriptNumberFromNodeId(
  nodeId: string | null | undefined,
  modules?: ScriptModule[]
): string | null {
  if (!nodeId) return null;
  if (nodeId.startsWith('ORG_') || nodeId === 'FAX_BUNDLE') {
    const master = modules?.find((m) => m.isMaster) || modules?.[0];
    return master ? master.scriptNumber : 'Main';
  }
  const match = nodeId.match(/^(?:S|JUMP|INC|SELF)_([A-Za-z0-9_]+)$/);
  if (!match) return null;
  const suffix = match[1];
  if (modules && modules.length > 0) {
    const found = modules.find((m) => toMermaidNodeSuffix(m.scriptNumber) === suffix);
    if (found) return found.scriptNumber;
  }
  return suffix;
}

/**
 * EBENE 1: Generates the clean Master-Callflow Overview Mermaid diagram combining
 * text scripts and graphical Visio flows (free script names like `Main`/`Schaltung1` and numbers)
 * in one unified map with red open-issue markers.
 */
export function buildMasterOverviewMermaid(
  workspace: ScriptWorkspace,
  direction: DiagramDirection = 'LR'
): string {
  if (workspace.modules.length === 0) {
    return `flowchart ${direction}\n    Empty["Keine Skripte im Callflow geladen"]`;
  }

  const lines: string[] = [`flowchart ${direction}`];
  const incomingCounts = new Map<string, number>();
  const externalKeySet = new Set((workspace.externalEndpoints || []).map(canonicalScriptMatchKey));
  const ignoredKeySet = new Set(
    (workspace.ignoredChecklistTargets || []).map(canonicalScriptMatchKey)
  );
  const knownKeyToMod = new Map(
    workspace.modules.map((m) => [canonicalScriptMatchKey(m.scriptNumber), m])
  );
  const referencedExternalTargets = new Map<string, string>();

  // Count open issues per script canonical key
  const openCountByKey = new Map<string, number>();
  (workspace.issues || [])
    .filter((iss) => iss.status === 'open')
    .forEach((iss) => {
      const sKey = canonicalScriptMatchKey(iss.sourceScriptNumber);
      openCountByKey.set(sKey, (openCountByKey.get(sKey) || 0) + 1);
      if (iss.targetNumber) {
        const tKey = canonicalScriptMatchKey(iss.targetNumber);
        if (tKey !== sKey) {
          openCountByKey.set(tKey, (openCountByKey.get(tKey) || 0) + 1);
        }
      }
    });

  workspace.modules.forEach((m) => incomingCounts.set(canonicalScriptMatchKey(m.scriptNumber), 0));
  workspace.modules.forEach((m) => {
    m.outgoingNumbers.forEach((target) => {
      const tKey = canonicalScriptMatchKey(target);
      if (ignoredKeySet.has(tKey)) return;
      incomingCounts.set(tKey, (incomingCounts.get(tKey) || 0) + 1);
      if (!knownKeyToMod.has(tKey) && externalKeySet.has(tKey)) {
        referencedExternalTargets.set(tKey, target);
      }
    });
  });

  let hasOpenIssueNodes = false;

  workspace.modules.forEach((mod) => {
    const mKey = canonicalScriptMatchKey(mod.scriptNumber);
    const id = `S_${toMermaidNodeSuffix(mod.scriptNumber)}`;
    const safeName = sanitizeMermaidText(mod.scriptName);
    const safeRef = sanitizeMermaidText(mod.scriptNumber);
    const inCount = incomingCounts.get(mKey) || 0;
    const outCount = mod.outgoingNumbers.length;
    const hasChoices = mod.rules.some((r) => r.choices.length > 0);
    const openCount = openCountByKey.get(mKey) || 0;

    const openTag = openCount > 0 ? `● ${openCount} Offen · ` : '';
    const openClassSuffix = openCount > 0 ? ':::openIssue' : '';
    if (openCount > 0) hasOpenIssueNodes = true;

    const showBothNameAndRef =
      canonicalScriptMatchKey(mod.scriptName) !== canonicalScriptMatchKey(mod.scriptNumber) &&
      mod.scriptName !== `Skript ${mod.scriptNumber}`;
    const label = showBothNameAndRef
      ? `${openTag}[${safeRef}] ${safeName}`
      : `${openTag}${safeRef}`;

    if (mod.isMaster || inCount === 0) {
      lines.push(`    ${id}(["▶ ${label}"])${openClassSuffix}`);
    } else if (outCount === 0) {
      lines.push(`    ${id}[("■ ${label}")]${openClassSuffix}`);
    } else if (hasChoices || outCount >= 2) {
      lines.push(`    ${id}{{"◆ ${label}"}}${openClassSuffix}`);
    } else {
      lines.push(`    ${id}["${label}"]${openClassSuffix}`);
    }
  });

  workspace.missingTargets.forEach((targetRef) => {
    if (ignoredKeySet.has(canonicalScriptMatchKey(targetRef))) return;
    hasOpenIssueNodes = true;
    const suffix = toMermaidNodeSuffix(targetRef);
    const safeRef = sanitizeMermaidText(targetRef);
    lines.push(`    S_${suffix}["● OFFEN · [${safeRef}] Fehlendes Skript"]:::missingScript`);
  });

  referencedExternalTargets.forEach((targetRef) => {
    const suffix = toMermaidNodeSuffix(targetRef);
    const safeRef = sanitizeMermaidText(targetRef);
    lines.push(`    S_${suffix}[("■ [${safeRef}] Externes Ende")]`);
  });

  lines.push('');

  const edgePairMap = new Map<
    string,
    { fromNodeId: string; toNodeId: string; tags: string[]; isChoiceOnly: boolean }
  >();

  const addAggregatedRawEdge = (
    fromNodeId: string,
    toNodeId: string,
    tag: string,
    isChoice: boolean
  ) => {
    const key = `${fromNodeId}->${toNodeId}`;
    const existing = edgePairMap.get(key);
    if (existing) {
      if (tag && !existing.tags.includes(tag)) existing.tags.push(tag);
      if (!isChoice) existing.isChoiceOnly = false;
    } else {
      edgePairMap.set(key, {
        fromNodeId,
        toNodeId,
        tags: tag ? [tag] : [],
        isChoiceOnly: isChoice,
      });
    }
  };

  const addAggregatedEdge = (fromRef: string, toRef: string, tag: string, isChoice: boolean) => {
    const toKey = canonicalScriptMatchKey(toRef);
    if (ignoredKeySet.has(toKey) && !knownKeyToMod.has(toKey)) return;
    const fromSuffix = toMermaidNodeSuffix(fromRef);
    const toSuffix = toMermaidNodeSuffix(toRef);
    addAggregatedRawEdge(`S_${fromSuffix}`, `S_${toSuffix}`, tag, isChoice);
  };

  // Detect Orga-grouped Masterscript rules (02131 + 290 Rheinland / 210 CreditLife / 6099 Rhion) & 4-digit Fax routings
  const orgaNodesMap = new Map<
    string,
    {
      nodeId: string;
      orgName: string;
      orgaCode?: string;
      brandName?: string;
      srcRouteNumber?: string;
      masterModRef: string;
    }
  >();
  const faxNumbersCollected: string[] = [];
  const faxCallers = new Set<string>();
  const faxScriptTargets = new Set<string>();

  workspace.modules.forEach((mod) => {
    const modHasMasterRouting =
      mod.isMaster &&
      mod.rules.some(
        (r) =>
          Boolean(r.organizationName || r.orgaCode || r.brandName || r.isFaxRoute) ||
          Boolean(r.valueNumbers && r.valueNumbers.length > 0)
      );

    if (!modHasMasterRouting) {
      mod.rules.forEach((rule) => {
        if (rule.targetNumber) {
          const tag =
            rule.valueNumbers && rule.valueNumbers.length > 0
              ? `VALUE ${rule.valueNumbers.join(', ')}`
              : `P${rule.prio}`;
          addAggregatedEdge(mod.scriptNumber, rule.targetNumber, tag, false);
        }
        rule.choices.forEach((ch) => {
          const isNamed = /^(?:Feiertag|Zeitplan|Bedingung|Sprung)$/i.test(ch.choice);
          const tag = isNamed ? ch.choice : `Taste ${ch.choice}`;
          addAggregatedEdge(mod.scriptNumber, ch.targetNumber, tag, true);
        });
      });
      return;
    }

    const masterNodeId = `S_${toMermaidNodeSuffix(mod.scriptNumber)}`;

    mod.rules.forEach((rule) => {
      const hasOrga = Boolean(rule.organizationName || rule.orgaCode || rule.brandName);
      let sourceNodeForRule = masterNodeId;

      if (hasOrga) {
        const orgKey = canonicalScriptMatchKey(
          rule.orgaCode || rule.organizationName || rule.brandName || ''
        );
        const orgNodeId = `ORG_${toMermaidNodeSuffix(
          rule.orgaCode || rule.organizationName || rule.brandName || 'Orga'
        )}`;
        if (!orgaNodesMap.has(orgKey)) {
          orgaNodesMap.set(orgKey, {
            nodeId: orgNodeId,
            orgName: rule.organizationName || rule.brandName || 'Orga',
            orgaCode: rule.orgaCode,
            brandName: rule.brandName,
            srcRouteNumber: rule.srcRouteNumber,
            masterModRef: mod.scriptNumber,
          });
        } else {
          const prev = orgaNodesMap.get(orgKey)!;
          if (!prev.brandName && rule.brandName) prev.brandName = rule.brandName;
          if (!prev.srcRouteNumber && rule.srcRouteNumber) prev.srcRouteNumber = rule.srcRouteNumber;
        }
        sourceNodeForRule = orgNodeId;
      }

      if (rule.isFaxRoute) {
        (rule.valueNumbers || []).forEach((v) => {
          if (!faxNumbersCollected.includes(v)) faxNumbersCollected.push(v);
        });
        faxCallers.add(sourceNodeForRule);
        if (rule.targetNumber) {
          const tKey = canonicalScriptMatchKey(rule.targetNumber);
          if (!ignoredKeySet.has(tKey) || knownKeyToMod.has(tKey)) {
            faxScriptTargets.add(rule.targetNumber);
          }
        }
        return;
      }

      if (rule.targetNumber) {
        const toKey = canonicalScriptMatchKey(rule.targetNumber);
        if (!ignoredKeySet.has(toKey) || knownKeyToMod.has(toKey)) {
          const valTags =
            rule.valueNumbers && rule.valueNumbers.length > 0
              ? rule.valueNumbers.map((v) => `${v}`)
              : [`P${rule.prio}`];
          valTags.forEach((vt) => {
            addAggregatedRawEdge(
              sourceNodeForRule,
              `S_${toMermaidNodeSuffix(rule.targetNumber!)}`,
              vt,
              false
            );
          });
        }
      }

      rule.choices.forEach((ch) => {
        const toKey = canonicalScriptMatchKey(ch.targetNumber);
        if (ignoredKeySet.has(toKey) && !knownKeyToMod.has(toKey)) return;
        const isNamed = /^(?:Feiertag|Zeitplan|Bedingung|Sprung)$/i.test(ch.choice);
        const tag = isNamed ? ch.choice : `Taste ${ch.choice}`;
        addAggregatedRawEdge(
          sourceNodeForRule,
          `S_${toMermaidNodeSuffix(ch.targetNumber)}`,
          tag,
          true
        );
      });
    });
  });

  // Emit Orga group nodes & connect Main -> Orga
  if (orgaNodesMap.size > 0) {
    for (const org of orgaNodesMap.values()) {
      const prefixInfo = org.orgaCode ? `02131 ${org.orgaCode}xxxx` : org.srcRouteNumber || '';
      const brandInfo =
        org.brandName && canonicalScriptMatchKey(org.brandName) !== canonicalScriptMatchKey(org.orgName)
          ? `Brand: ${sanitizeMermaidText(org.brandName)}`
          : '';
      const detailParts = [prefixInfo, brandInfo].filter(Boolean).join(' · ');
      const orgLabel = detailParts
        ? `🏢 ${sanitizeMermaidText(org.orgName)}<br/>${sanitizeMermaidText(detailParts)}`
        : `🏢 ${sanitizeMermaidText(org.orgName)}`;
      lines.push(`    ${org.nodeId}{{"${orgLabel}"}}`);
      const edgeLbl = org.srcRouteNumber
        ? `DNIS ${sanitizeMermaidText(org.srcRouteNumber)}`
        : org.orgaCode
        ? `02131 ${org.orgaCode}`
        : 'DNIS-Range';
      addAggregatedRawEdge(
        `S_${toMermaidNodeSuffix(org.masterModRef)}`,
        org.nodeId,
        edgeLbl,
        false
      );
    }
  }

  // Emit bundled 4-digit Fax Endpoint if any Fax routings were detected
  if (faxCallers.size > 0) {
    const faxPreview = faxNumbersCollected.slice(0, 6).join(', ');
    const faxExtra =
      faxNumbersCollected.length > 6 ? ` (+${faxNumbersCollected.length - 6})` : '';
    const faxCdnLine = faxPreview ? `<br/>Fax-CDN: ${sanitizeMermaidText(faxPreview)}${faxExtra}` : '';
    lines.push(`    FAX_BUNDLE[("■ 📠 Fax-Routing (4-stellig)${faxCdnLine}")]`);
    for (const callerNodeId of faxCallers) {
      addAggregatedRawEdge(callerNodeId, 'FAX_BUNDLE', 'Fax (4-stellig)', false);
    }
    for (const targetRef of faxScriptTargets) {
      addAggregatedRawEdge(
        'FAX_BUNDLE',
        `S_${toMermaidNodeSuffix(targetRef)}`,
        'execute Script',
        false
      );
    }
  }

  (workspace.manualLinks || []).forEach((lnk) => {
    if (lnk.fromScriptNumber && lnk.toTargetNumber) {
      addAggregatedEdge(
        lnk.fromScriptNumber,
        lnk.toTargetNumber,
        lnk.label || 'Verknüpft',
        false
      );
    }
  });

  for (const edge of edgePairMap.values()) {
    const arrow = edge.isChoiceOnly ? '-.->' : '-->';
    const isNumberList = edge.tags.every((t) => /^\d{2,10}$/.test(t));
    const maxShow = isNumberList ? 5 : 4;
    const joined = edge.tags.slice(0, maxShow).join(isNumberList ? ', ' : ' · ');
    const suffixExtra = edge.tags.length > maxShow ? ` (+${edge.tags.length - maxShow})` : '';
    const label = joined ? `${isNumberList ? 'VALUE ' : ''}${joined}${suffixExtra}` : '';
    const labelPart = label ? `|${label.replace(/\|/g, '/')}|` : '';
    lines.push(`    ${edge.fromNodeId} ${arrow}${labelPart} ${edge.toNodeId}`);
  }

  if (workspace.missingTargets.length > 0 || hasOpenIssueNodes) {
    lines.push('');
    if (hasOpenIssueNodes) {
      lines.push('    classDef openIssue stroke:#ef4444,stroke-width:2.5px;');
    }
    if (workspace.missingTargets.length > 0) {
      lines.push('    classDef missingScript stroke-dasharray: 5 5,stroke:#ef4444;');
    }
  }

  return lines.join('\n');
}

/**
 * EBENE 2: Generates the detailed Mermaid diagram for a single selected script (by number or name).
 */
export function buildScriptDetailMermaid(
  workspace: ScriptWorkspace,
  scriptNumber: string,
  direction: DiagramDirection = 'LR'
): string {
  const targetKey = canonicalScriptMatchKey(scriptNumber);
  const mod = workspace.modules.find((m) => canonicalScriptMatchKey(m.scriptNumber) === targetKey);
  if (!mod) {
    return buildMasterOverviewMermaid(workspace, direction);
  }

  const modKey = canonicalScriptMatchKey(mod.scriptNumber);
  const modSuffix = toMermaidNodeSuffix(mod.scriptNumber);
  const moduleByKey = new Map(
    workspace.modules.map((m) => [canonicalScriptMatchKey(m.scriptNumber), m])
  );
  const externalKeySet = new Set((workspace.externalEndpoints || []).map(canonicalScriptMatchKey));
  const openRuleIds = new Set(
    (workspace.issues || [])
      .filter(
        (i) =>
          i.status === 'open' &&
          canonicalScriptMatchKey(i.sourceScriptNumber) === modKey &&
          i.ruleId
      )
      .map((i) => i.ruleId!)
  );
  const selfOpenCount = (workspace.issues || []).filter(
    (i) => i.status === 'open' && canonicalScriptMatchKey(i.sourceScriptNumber) === modKey
  ).length;

  const lines: string[] = [`flowchart ${direction}`];
  const safeModName = sanitizeMermaidText(mod.scriptName);
  const safeModRef = sanitizeMermaidText(mod.scriptNumber);

  const entryId = `SELF_${modSuffix}`;
  const selfPrefix = selfOpenCount > 0 ? `● ${selfOpenCount} Offen · ` : '';
  const showDetailBoth =
    canonicalScriptMatchKey(mod.scriptName) !== canonicalScriptMatchKey(mod.scriptNumber) &&
    mod.scriptName !== `Skript ${mod.scriptNumber}`;
  const entryLabel = showDetailBoth
    ? `${selfPrefix}[${safeModRef}] ${safeModName}`
    : `${selfPrefix}${safeModRef}`;
  lines.push(
    `    ${entryId}(["★ ${entryLabel}"])${selfOpenCount > 0 ? ':::openIssue' : ''}`
  );

  const incomingCallers: Array<{ fromNum: string; fromSuffix: string; fromName: string; tag: string }> = [];
  workspace.modules.forEach((other) => {
    if (canonicalScriptMatchKey(other.scriptNumber) === modKey) return;
    const tags: string[] = [];
    other.rules.forEach((r) => {
      if (r.targetNumber && canonicalScriptMatchKey(r.targetNumber) === modKey) {
        tags.push(`Prio ${r.prio}`);
      }
      r.choices.forEach((c) => {
        if (canonicalScriptMatchKey(c.targetNumber) === modKey) {
          const isNamed = /^(?:Feiertag|Zeitplan|Bedingung|Sprung)$/i.test(c.choice);
          tags.push(isNamed ? c.choice : `Taste ${c.choice}`);
        }
      });
    });
    (workspace.manualLinks || []).forEach((lnk) => {
      if (
        canonicalScriptMatchKey(lnk.fromScriptNumber) === canonicalScriptMatchKey(other.scriptNumber) &&
        canonicalScriptMatchKey(lnk.toTargetNumber) === modKey
      ) {
        tags.push(lnk.label || 'Verknüpft');
      }
    });
    if (tags.length > 0) {
      incomingCallers.push({
        fromNum: other.scriptNumber,
        fromSuffix: toMermaidNodeSuffix(other.scriptNumber),
        fromName: other.scriptName,
        tag: tags.slice(0, 3).join(', '),
      });
    }
  });

  if (incomingCallers.length > 0) {
    lines.push(`    subgraph Aufrufer["Eingehende Aufrufer (Woher)"]`);
    incomingCallers.forEach((caller) => {
      lines.push(
        `        INC_${caller.fromSuffix}(["← [${sanitizeMermaidText(caller.fromNum)}] ${sanitizeMermaidText(caller.fromName)}"])`
      );
    });
    lines.push('    end');
    incomingCallers.forEach((caller) => {
      lines.push(`    INC_${caller.fromSuffix} -->|${caller.tag}| ${entryId}`);
    });
  }

  lines.push(
    showDetailBoth
      ? `    subgraph ScriptBody["Skript [${safeModRef}] ${safeModName}"]`
      : `    subgraph ScriptBody["Skript ${safeModRef}"]`
  );
  const sortedRules = [...mod.rules].sort((a, b) => a.prio - b.prio);

  let prevStepId = entryId;
  const externalJumpRefs = new Map<
    string,
    { num: string; suffix: string; name: string; known: boolean; externalConfirmed: boolean }
  >();
  const queueNodes = new Map<string, { id: string; label: string }>();
  let hasOpenStep = selfOpenCount > 0;

  const registerExternalJump = (rawTarget: string): string => {
    const cleanTarget = normalizeScriptRef(rawTarget);
    const tKey = canonicalScriptMatchKey(cleanTarget);
    const suffix = toMermaidNodeSuffix(cleanTarget);
    const jumpId = `JUMP_${suffix}`;
    const targetMod = moduleByKey.get(tKey);
    externalJumpRefs.set(tKey, {
      num: targetMod ? targetMod.scriptNumber : cleanTarget,
      suffix,
      name: targetMod
        ? targetMod.scriptName
        : externalKeySet.has(tKey)
        ? 'Externes Ende'
        : 'Nicht geladen',
      known: Boolean(targetMod),
      externalConfirmed: externalKeySet.has(tKey),
    });
    return jumpId;
  };

  sortedRules.forEach((rule, idx) => {
    const stepId = `STEP_${modSuffix}_${idx + 1}`;
    const hasBranching = rule.choices.length > 0 || Boolean(rule.condition || rule.schedule);
    const isStepOpen = openRuleIds.has(rule.id);
    if (isStepOpen) hasOpenStep = true;

    const metaParts: string[] = [
      `${isStepOpen ? '● OFFEN · ' : ''}Prio ${rule.prio}: ${sanitizeMermaidText(rule.stepName)}`,
    ];
    if (rule.organizationName) {
      const orgTag = rule.orgaCode
        ? `${rule.organizationName} (02131 ${rule.orgaCode})`
        : rule.organizationName;
      metaParts.push(`Orga: ${sanitizeMermaidText(orgTag)}`);
    }
    if (
      rule.brandName &&
      canonicalScriptMatchKey(rule.brandName) !== canonicalScriptMatchKey(rule.organizationName || '')
    ) {
      metaParts.push(`Sys_brand: ${sanitizeMermaidText(rule.brandName)}`);
    }
    if (rule.srcRouteNumber) {
      metaParts.push(`Route: ${sanitizeMermaidText(rule.srcRouteNumber)}`);
    }
    if (rule.isFaxRoute) {
      metaParts.push('Typ: Fax-Routing (4-stellig)');
    }
    if (rule.schedule) metaParts.push(`Zeitplan: ${sanitizeMermaidText(rule.schedule)}`);
    if (rule.condition) metaParts.push(`Bedingung: ${sanitizeMermaidText(rule.condition)}`);
    if (rule.holiday) metaParts.push(`Feiertag: ${sanitizeMermaidText(rule.holiday)}`);
    if (rule.announcement) metaParts.push(`Ansage: ${sanitizeMermaidText(rule.announcement)}`);

    const stepLabel = metaParts.join('<br/>');
    const stepSuffix = isStepOpen ? ':::openIssue' : '';

    if (hasBranching) {
      lines.push(`        ${stepId}{{"${stepLabel}"}}${stepSuffix}`);
    } else {
      lines.push(`        ${stepId}["${stepLabel}"]${stepSuffix}`);
    }

    if (idx === 0) {
      lines.push(`        ${entryId} --> ${stepId}`);
    } else {
      lines.push(`        ${prevStepId} -.->|Fallback / Weiter| ${stepId}`);
    }
    prevStepId = stepId;

    if (rule.queueTarget && !isNumericScriptRef(rule.queueTarget)) {
      const qKey = sanitizeNodeKey(rule.queueTarget);
      const qId = `QUEUE_${qKey}`;
      queueNodes.set(qId, {
        id: qId,
        label: `Queue: ${sanitizeMermaidText(rule.queueTarget)}`,
      });
      lines.push(`        ${stepId} -->|Queue| ${qId}`);
    }

    if (rule.targetNumber) {
      if (canonicalScriptMatchKey(rule.targetNumber) === modKey) {
        lines.push(`        ${stepId} -.->|↻ Schleife ${safeModRef}| ${entryId}`);
      } else {
        const jumpId = registerExternalJump(rule.targetNumber);
        lines.push(`        ${stepId} -->|Wohin: ${sanitizeMermaidText(rule.targetNumber)}| ${jumpId}`);
      }
    }

    rule.choices.forEach((ch) => {
      const isNamed = /^(?:Feiertag|Zeitplan|Bedingung|Sprung)$/i.test(ch.choice);
      const baseChoiceText = isNamed ? ch.choice : `Taste ${ch.choice}`;
      const choiceLabel = ch.label
        ? `${baseChoiceText}: ${sanitizeMermaidText(ch.label)}`
        : baseChoiceText;

      if (canonicalScriptMatchKey(ch.targetNumber) === modKey) {
        lines.push(`        ${stepId} -.->|↻ ${choiceLabel}| ${entryId}`);
      } else {
        const jumpId = registerExternalJump(ch.targetNumber);
        lines.push(`        ${stepId} -.->|${choiceLabel}| ${jumpId}`);
      }
    });
  });

  // Render manual links added directly for this script
  (workspace.manualLinks || [])
    .filter(
      (lnk) =>
        canonicalScriptMatchKey(lnk.fromScriptNumber) === modKey && lnk.toTargetNumber
    )
    .forEach((lnk) => {
      const anchorStepIdx = lnk.fromRuleId
        ? sortedRules.findIndex((r) => r.id === lnk.fromRuleId)
        : -1;
      const anchorId = anchorStepIdx >= 0 ? `STEP_${modSuffix}_${anchorStepIdx + 1}` : entryId;
      const jumpId = registerExternalJump(lnk.toTargetNumber);
      lines.push(
        `        ${anchorId} -->|${sanitizeMermaidText(lnk.label || 'Verknüpft')}| ${jumpId}`
      );
    });

  if (queueNodes.size > 0) {
    for (const q of queueNodes.values()) {
      lines.push(`        ${q.id}[("${q.label}")]`);
    }
  }

  lines.push('    end');

  if (externalJumpRefs.size > 0) {
    lines.push(`    subgraph Ziele["Ausgehende Ziel-Skripte (Klick für Drilldown)"]`);
    for (const ref of externalJumpRefs.values()) {
      const jumpId = `JUMP_${ref.suffix}`;
      const safeName = sanitizeMermaidText(ref.name);
      const safeNum = sanitizeMermaidText(ref.num);
      if (ref.known) {
        lines.push(`        ${jumpId}(["→ [${safeNum}] ${safeName}"])`);
      } else if (ref.externalConfirmed) {
        lines.push(`        ${jumpId}[("■ [${safeNum}] ${safeName}")]`);
      } else {
        hasOpenStep = true;
        lines.push(`        ${jumpId}["● OFFEN · [${safeNum}] ${safeName}"]:::missingScript`);
      }
    }
    lines.push('    end');
    lines.push('    classDef missingScript stroke-dasharray: 5 5,stroke:#ef4444;');
  }

  if (hasOpenStep) {
    lines.push('    classDef openIssue stroke:#ef4444,stroke-width:2.5px;');
  }

  return lines.join('\n');
}

/**
 * Baustein A: Automatische Logik- & Qualitätsprüfung (Health-Check)
 * Prüft den gesamten Callflow-Arbeitsbereich auf Zyklus-Schleifen, Sackgassen,
 * verwaiste Skripte (Dead Code), deaktivierte Überläufe, fehlende Zeitplan-Prüfungen
 * und doppelte Prioritäten.
 */
export function analyzeWorkspaceLogicHealth(
  workspace: ScriptWorkspace
): CallflowHealthFinding[] {
  const findings: CallflowHealthFinding[] = [];
  const modules = workspace.modules || [];
  if (modules.length === 0) return findings;

  const moduleByKey = new Map<string, ScriptModule>();
  modules.forEach((m) => moduleByKey.set(canonicalScriptMatchKey(m.scriptNumber), m));

  const masterKey = workspace.masterScriptNumber
    ? canonicalScriptMatchKey(workspace.masterScriptNumber)
    : canonicalScriptMatchKey(
        (modules.find((m) => m.isMaster) || modules[0]).scriptNumber
      );

  // Build adjacency map (including manual links)
  const adjacency = new Map<string, Set<string>>();
  const callersByTarget = new Map<string, Set<string>>();
  modules.forEach((m) => {
    const k = canonicalScriptMatchKey(m.scriptNumber);
    if (!adjacency.has(k)) adjacency.set(k, new Set());
    m.outgoingNumbers.forEach((out) => {
      const outKey = canonicalScriptMatchKey(out);
      if (outKey && outKey !== k) {
        adjacency.get(k)!.add(outKey);
        if (!callersByTarget.has(outKey)) callersByTarget.set(outKey, new Set());
        callersByTarget.get(outKey)!.add(m.scriptNumber);
      }
    });
  });

  (workspace.manualLinks || []).forEach((lnk) => {
    const fromKey = canonicalScriptMatchKey(lnk.fromScriptNumber);
    const toKey = canonicalScriptMatchKey(lnk.toTargetNumber);
    if (fromKey && toKey && fromKey !== toKey) {
      if (!adjacency.has(fromKey)) adjacency.set(fromKey, new Set());
      adjacency.get(fromKey)!.add(toKey);
      if (!callersByTarget.has(toKey)) callersByTarget.set(toKey, new Set());
      callersByTarget.get(toKey)!.add(lnk.fromScriptNumber);
    }
  });

  // 1. Detect multi-module cycles (Ping-Pong / Endlosschleifen)
  const seenCycles = new Set<string>();
  const visitedGlobal = new Set<string>();

  const dfsCycles = (currentKey: string, stack: string[], stackSet: Set<string>) => {
    visitedGlobal.add(currentKey);
    const neighbors = adjacency.get(currentKey) || new Set<string>();
    for (const nextKey of neighbors) {
      if (!moduleByKey.has(nextKey)) continue;
      if (stackSet.has(nextKey)) {
        const cycleStartIdx = stack.indexOf(nextKey);
        if (cycleStartIdx >= 0) {
          const cycleKeys = stack.slice(cycleStartIdx);
          // Canonicalize cycle rotation so A->B->A and B->A->B only report once
          const rotations = cycleKeys.map((_, idx) =>
            [...cycleKeys.slice(idx), ...cycleKeys.slice(0, idx)].join('->')
          );
          rotations.sort();
          const signature = rotations[0];
          if (!seenCycles.has(signature)) {
            seenCycles.add(signature);
            const displayChain = [...cycleKeys, nextKey].map(
              (k) => moduleByKey.get(k)?.scriptNumber || k
            );
            const entryMod = moduleByKey.get(cycleKeys[0])!;
            findings.push({
              id: `health:cycle:${signature}`,
              severity: 'error',
              category: 'cycle',
              scriptNumber: entryMod.scriptNumber,
              scriptName: entryMod.scriptName,
              title: `Zyklische Skript-Schleife (${displayChain.join(' → ')})`,
              description: `Zwischen den Skripten besteht ein geschlossener Rücksprung-Kreislauf (${displayChain.join(
                ' → '
              )}). Ohne Abbruchbedingung oder Zähler droht eine Endlosschleife.`,
              recommendation:
                'Prüfen Sie die Rücksprung-Bedingung (z. B. Sys_Retour_Zentrale oder Überlauf) und begrenzen Sie die Wiederholungsanzahl.',
              cyclePath: displayChain,
            });
          }
        }
      } else if (!visitedGlobal.has(nextKey)) {
        stack.push(nextKey);
        stackSet.add(nextKey);
        dfsCycles(nextKey, stack, stackSet);
        stack.pop();
        stackSet.delete(nextKey);
      }
    }
  };

  for (const mod of modules) {
    const k = canonicalScriptMatchKey(mod.scriptNumber);
    if (!visitedGlobal.has(k)) {
      dfsCycles(k, [k], new Set([k]));
    }
  }

  // 2. Reachability from Master -> Orphan modules (Dead Code)
  const reachableFromMaster = new Set<string>();
  const queue: string[] = [masterKey];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (reachableFromMaster.has(curr)) continue;
    reachableFromMaster.add(curr);
    const nexts = adjacency.get(curr) || new Set<string>();
    for (const n of nexts) {
      if (!reachableFromMaster.has(n)) queue.push(n);
    }
  }

  // 3. Per-module checks
  for (const mod of modules) {
    const modKey = canonicalScriptMatchKey(mod.scriptNumber);
    const isMasterMod = modKey === masterKey || mod.isMaster;

    // 3a. Orphan check (when more than 1 module is loaded)
    if (
      modules.length > 1 &&
      !isMasterMod &&
      !reachableFromMaster.has(modKey) &&
      (callersByTarget.get(modKey)?.size || 0) === 0
    ) {
      findings.push({
        id: `health:orphan:${modKey}`,
        severity: 'warning',
        category: 'orphan-module',
        scriptNumber: mod.scriptNumber,
        scriptName: mod.scriptName,
        title: `Verwaistes Skript [${mod.scriptNumber}] (Dead Code)`,
        description: `Das Skript "${mod.scriptName}" (${mod.scriptNumber}) wird weder vom Hauptskript noch von einem anderen geladenen Teil-Skript aufgerufen.`,
        recommendation:
          'Prüfen Sie, ob ein Sprungbefehl aus Main fehlt oder ob das Skript bei der Migration stillgelegt werden kann.',
      });
    }

    // 3b. Dead-end module check (no outgoing scripts, no queueTarget, no choices)
    const hasAnyQueue = mod.rules.some((r) => Boolean(r.queueTarget));
    const hasAnyOutgoing =
      mod.outgoingNumbers.length > 0 ||
      (workspace.manualLinks || []).some(
        (l) => canonicalScriptMatchKey(l.fromScriptNumber) === modKey
      );
    if (!hasAnyQueue && !hasAnyOutgoing) {
      findings.push({
        id: `health:dead-end-mod:${modKey}`,
        severity: 'error',
        category: 'dead-end-module',
        scriptNumber: mod.scriptNumber,
        scriptName: mod.scriptName,
        title: `Skript [${mod.scriptNumber}] ohne Weiterleitung oder Queue`,
        description: `In [${mod.scriptNumber}] wurde weder ein Ziel-Skript noch eine Warteschlange/Skillset erkannt – Anrufe enden hier in einer Sackgasse.`,
        recommendation:
          'Ergänzen Sie ein Ziel-Skript (Wohin/Sprung), eine DTMF-Auswahl oder ein Ziel-Skillset (Queue).',
      });
    }

    // 3c. Duplicate priorities & dead-end rules & inactive overflows
    const prioMap = new Map<number, ScriptRule[]>();
    for (const rule of mod.rules) {
      const list = prioMap.get(rule.prio) || [];
      list.push(rule);
      prioMap.set(rule.prio, list);

      const hasAction =
        Boolean(rule.targetNumber) ||
        rule.choices.length > 0 ||
        Boolean(rule.queueTarget) ||
        Boolean(rule.announcement) ||
        Boolean(rule.schedule) ||
        Boolean(rule.holiday) ||
        /^Init\b/i.test(rule.stepName);

      if (!hasAction) {
        findings.push({
          id: `health:dead-end-rule:${modKey}:${rule.id}`,
          severity: 'warning',
          category: 'dead-end-rule',
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName,
          ruleId: rule.id,
          prio: rule.prio,
          title: `Unvollständige Regel (Prio ${rule.prio}: ${rule.stepName})`,
          description: `Schritt "${rule.stepName}" in [${mod.scriptNumber}] besitzt weder Zielnummer, DTMF-Auswahl, Ansage noch Warteschlange.`,
          recommendation:
            'Definieren Sie ein Sprungziel oder entfernen Sie den leeren Regelschritt.',
        });
      }

      if (
        /deaktiviert\s*=\s*0/i.test(rule.stepName) ||
        /Default_Skillset/i.test(rule.condition || '') ||
        /Default_Skillset/i.test(rule.rawLine || '')
      ) {
        findings.push({
          id: `health:inactive-overflow:${modKey}:${rule.id}`,
          severity: 'info',
          category: 'inactive-overflow',
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName,
          ruleId: rule.id,
          prio: rule.prio,
          title: `Deaktivierter Überlauf / Platzhalter-Skillset in [${mod.scriptNumber}]`,
          description: `In Schritt "${rule.stepName}" ist das Überlauf-Routing deaktiviert (Sys_UeberlaufRouting = 0) oder auf Default_Skillset gesetzt.`,
          recommendation:
            'Klären Sie für das Zielsystem, ob bei Wartezeit-Überschreitung ein echter Überlauf oder Rücksprung aktiv sein soll.',
        });
      }
    }

    for (const [prio, rulesWithPrio] of prioMap.entries()) {
      if (rulesWithPrio.length > 1) {
        // Ignore if rules have distinct conditions (e.g. IF / ELSE branches)
        const distinctConditions = new Set(
          rulesWithPrio.map((r) => (r.condition || '').trim()).filter(Boolean)
        );
        if (distinctConditions.size < rulesWithPrio.length) {
          findings.push({
            id: `health:dup-prio:${modKey}:${prio}`,
            severity: 'warning',
            category: 'duplicate-prio',
            scriptNumber: mod.scriptNumber,
            scriptName: mod.scriptName,
            prio,
            title: `Doppelte Priorität ${prio} in [${mod.scriptNumber}]`,
            description: `${rulesWithPrio.length} Regeln in [${mod.scriptNumber}] verwenden dieselbe Prioritätsstufe ${prio} (${rulesWithPrio
              .map((r) => r.stepName)
              .join(', ')}).`,
            recommendation:
              'Vergeben Sie eindeutige Prioritäten, damit die Auswertungsreihenfolge deterministisch bleibt.',
          });
        }
      }
    }

    // 3d. Master schedule/holiday check
    if (isMasterMod && mod.rules.length > 0) {
      const hasScheduleOrHolidayInMaster = mod.rules.some(
        (r) =>
          Boolean(r.schedule) ||
          Boolean(r.holiday) ||
          /zeitplan|feiertag|[oö]ffnungszeit|sondzeit|nacht/i.test(
            `${r.stepName} ${r.condition || ''} ${r.rawLine}`
          )
      );
      if (!hasScheduleOrHolidayInMaster) {
        findings.push({
          id: `health:no-schedule:${modKey}`,
          severity: 'info',
          category: 'missing-schedule-guard',
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName,
          title: `Keine explizite Zeitplan-/Feiertagsprüfung in [${mod.scriptNumber}]`,
          description: `Im Hauptskript [${mod.scriptNumber}] wurde keine direkte Öffnungszeiten-, Feiertags- oder Sonderzeit-Regel erkannt.`,
          recommendation:
            'Prüfen Sie, ob Öffnungszeiten und Feiertage in einem nachgelagerten Teil-Skript oder zentral vor dem Callflow geprüft werden.',
        });
      }
    }
  }

  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
  return findings.sort(
    (a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3)
  );
}

/**
 * Baustein B: Zentrales Ressourcen- & Variablen-Register
 * Extrahiert alle Skillsets/Warteschlangen, Ansagen/RAN-IDs, Systemvariablen (ASSIGN)
 * und Skript-/Rufnummern-Kreuzreferenzen über den gesamten Arbeitsbereich.
 */
export function extractWorkspaceResourceRegistry(
  workspace: ScriptWorkspace
): CallflowResourceRegistry {
  const modules = workspace.modules || [];
  const skillsetMap = new Map<string, CallflowSkillsetRegistryItem>();
  const announcementMap = new Map<string, CallflowAnnouncementRegistryItem>();
  const variableMap = new Map<string, CallflowVariableRegistryItem>();

  const registerSkillset = (
    rawName: string,
    role: 'primary' | 'overflow' | 'rule',
    usage: {
      scriptNumber: string;
      scriptName: string;
      prio?: number;
      stepName?: string;
      context?: string;
    }
  ) => {
    const clean = rawName.trim();
    if (!clean || clean === '-1' || clean === '0') return;
    const key = clean.toLowerCase();
    let item = skillsetMap.get(key);
    if (!item) {
      item = { name: clean, role, usages: [] };
      skillsetMap.set(key, item);
    } else if (role === 'primary' && item.role !== 'primary') {
      item.role = 'primary';
    }
    if (
      !item.usages.some(
        (u) =>
          u.scriptNumber === usage.scriptNumber &&
          u.prio === usage.prio &&
          u.stepName === usage.stepName
      )
    ) {
      item.usages.push(usage);
    }
  };

  const registerAnnouncement = (
    rawId: string,
    usage: {
      scriptNumber: string;
      scriptName: string;
      prio?: number;
      stepName?: string;
      context?: string;
    }
  ) => {
    const clean = rawId.trim();
    if (!clean || clean === '-1' || clean === '0') return;
    const key = clean.toLowerCase();
    let item = announcementMap.get(key);
    if (!item) {
      item = { idOrName: clean, usages: [] };
      announcementMap.set(key, item);
    }
    if (
      !item.usages.some(
        (u) =>
          u.scriptNumber === usage.scriptNumber &&
          u.prio === usage.prio &&
          u.stepName === usage.stepName
      )
    ) {
      item.usages.push(usage);
    }
  };

  const registerVariable = (
    varName: string,
    value: string,
    scriptNumber: string,
    scriptName: string
  ) => {
    const cleanVar = varName.trim();
    const cleanVal = value.trim();
    if (!cleanVar || !cleanVal) return;
    const key = cleanVar.toLowerCase();
    let item = variableMap.get(key);
    if (!item) {
      item = { variableName: cleanVar, valuesByScript: [] };
      variableMap.set(key, item);
    }
    if (
      !item.valuesByScript.some(
        (v) => v.scriptNumber === scriptNumber && v.value === cleanVal
      )
    ) {
      item.valuesByScript.push({ scriptNumber, scriptName, value: cleanVal });
    }
  };

  for (const mod of modules) {
    // 1. Rules inspection
    for (const rule of mod.rules) {
      if (rule.queueTarget) {
        const isOverflow = /[uü]berlauf/i.test(rule.stepName);
        registerSkillset(
          rule.queueTarget,
          isOverflow ? 'overflow' : 'rule',
          {
            scriptNumber: mod.scriptNumber,
            scriptName: mod.scriptName,
            prio: rule.prio,
            stepName: rule.stepName,
            context: rule.condition || rule.schedule,
          }
        );
      }
      if (rule.announcement) {
        registerAnnouncement(rule.announcement, {
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName,
          prio: rule.prio,
          stepName: rule.stepName,
          context: rule.condition || rule.schedule,
        });
      }
    }

    // 2. Raw text AACC ASSIGN statements (`assign <VAL> to <VAR>` and `ASSIGN <VAR> = <VAL>`)
    if (mod.rawText) {
      const cleanedRaw = stripScriptCommentsAndNoise(mod.rawText);
      const assignToRegex = /\bassign\s+([\s\S]{1,120}?)\s+to\s+([A-Za-z0-9_]+)\b/gi;
      let m: RegExpExecArray | null;
      while ((m = assignToRegex.exec(cleanedRaw)) !== null) {
        const val = m[1].replace(/\s+/g, ' ').trim();
        const varName = m[2].trim();
        registerVariable(varName, val, mod.scriptNumber, mod.scriptName);
        if (/^Sys_Team_Skillset$/i.test(varName)) {
          registerSkillset(val, 'primary', {
            scriptNumber: mod.scriptNumber,
            scriptName: mod.scriptName,
            stepName: 'Sys_Team_Skillset',
          });
        } else if (/^Sys_Ueberlauf_Skillset$/i.test(varName)) {
          registerSkillset(val, 'overflow', {
            scriptNumber: mod.scriptNumber,
            scriptName: mod.scriptName,
            stepName: 'Sys_Ueberlauf_Skillset',
          });
        } else if (/^Sys_Musik$/i.test(varName)) {
          registerAnnouncement(`Musik-ID ${val}`, {
            scriptNumber: mod.scriptNumber,
            scriptName: mod.scriptName,
            stepName: 'Sys_Musik',
          });
        }
      }

      const assignEqRegex = /\bassign\s+([A-Za-z0-9_]+)\s*=\s*([^\r\n]+)/gi;
      let meq: RegExpExecArray | null;
      while ((meq = assignEqRegex.exec(cleanedRaw)) !== null) {
        const varName = meq[1].trim();
        const val = meq[2].trim();
        if (!/\bto\s+[A-Za-z0-9_]+$/i.test(val)) {
          registerVariable(varName, val, mod.scriptNumber, mod.scriptName);
        }
      }
    }
  }

  // 3. Cross-Reference matrix (all loaded modules + missing/external targets)
  const moduleByKey = new Map<string, ScriptModule>();
  modules.forEach((m) => moduleByKey.set(canonicalScriptMatchKey(m.scriptNumber), m));
  const externalKeys = new Set(
    (workspace.externalEndpoints || []).map(canonicalScriptMatchKey)
  );
  const masterKey = workspace.masterScriptNumber
    ? canonicalScriptMatchKey(workspace.masterScriptNumber)
    : modules.find((m) => m.isMaster)
    ? canonicalScriptMatchKey(modules.find((m) => m.isMaster)!.scriptNumber)
    : '';

  const allRefKeysOrder: string[] = [];
  const displayByRefKey = new Map<string, { refKey: string; displayName: string }>();
  const callersMap = new Map<string, Set<string>>();
  const calleesMap = new Map<string, Set<string>>();

  const ensureRefEntry = (rawRef: string, displayName?: string) => {
    const k = canonicalScriptMatchKey(rawRef);
    if (!k) return k;
    if (!displayByRefKey.has(k)) {
      allRefKeysOrder.push(k);
      const matched = moduleByKey.get(k);
      displayByRefKey.set(k, {
        refKey: matched ? matched.scriptNumber : rawRef,
        displayName: matched ? matched.scriptName : displayName || rawRef,
      });
    }
    if (!callersMap.has(k)) callersMap.set(k, new Set());
    if (!calleesMap.has(k)) calleesMap.set(k, new Set());
    return k;
  };

  modules.forEach((m) => {
    const fromKey = ensureRefEntry(m.scriptNumber, m.scriptName);
    m.outgoingNumbers.forEach((out) => {
      const toKey = ensureRefEntry(out);
      if (toKey && toKey !== fromKey) {
        calleesMap.get(fromKey)!.add(displayByRefKey.get(toKey)!.refKey);
        callersMap.get(toKey)!.add(m.scriptNumber);
      }
    });
  });

  (workspace.manualLinks || []).forEach((lnk) => {
    const fromKey = ensureRefEntry(lnk.fromScriptNumber);
    const toKey = ensureRefEntry(lnk.toTargetNumber);
    if (fromKey && toKey && fromKey !== toKey) {
      calleesMap.get(fromKey)!.add(displayByRefKey.get(toKey)!.refKey);
      callersMap.get(toKey)!.add(displayByRefKey.get(fromKey)!.refKey);
    }
  });

  const crossRefs: CallflowCrossRefRegistryItem[] = allRefKeysOrder.map((k) => {
    const info = displayByRefKey.get(k)!;
    const matched = moduleByKey.get(k);
    const status: 'present' | 'missing' | 'external' | 'master' =
      k === masterKey || matched?.isMaster
        ? 'master'
        : matched
        ? 'present'
        : externalKeys.has(k)
        ? 'external'
        : 'missing';

    return {
      refKey: info.refKey,
      displayName: info.displayName,
      status,
      callers: Array.from(callersMap.get(k) || []),
      callees: Array.from(calleesMap.get(k) || []),
      ruleCount: matched ? matched.rules.length : 0,
    };
  });

  return {
    skillsets: Array.from(skillsetMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'de')
    ),
    announcements: Array.from(announcementMap.values()).sort((a, b) =>
      a.idOrName.localeCompare(b.idOrName, 'de')
    ),
    variables: Array.from(variableMap.values()).sort((a, b) =>
      a.variableName.localeCompare(b.variableName, 'de')
    ),
    crossRefs,
  };
}

/**
 * Baustein C: Erstellt die abgeflachte Routing-Matrix über alle geladenen Skripte
 * für die Tabellen-Vorschau, den CSV-/Excel-Export und die Migrations-Dokumentation.
 */
export function buildWorkspaceRoutingMatrix(
  workspace: ScriptWorkspace
): CallflowRoutingMatrixRow[] {
  const rows: CallflowRoutingMatrixRow[] = [];
  const modules = workspace.modules || [];
  const loadedKeys = new Set(
    modules.map((m) => canonicalScriptMatchKey(m.scriptNumber))
  );
  const externalKeys = new Set(
    (workspace.externalEndpoints || []).map(canonicalScriptMatchKey)
  );

  for (const mod of modules) {
    const sortedRules = [...mod.rules].sort((a, b) => a.prio - b.prio);
    for (const rule of sortedRules) {
      const condParts: string[] = [];
      if (rule.schedule) condParts.push(`Zeitplan: ${rule.schedule}`);
      if (rule.holiday) condParts.push(`Feiertag: ${rule.holiday}`);
      if (rule.condition) condParts.push(rule.condition);

      const targetParts: string[] = [];
      const referencedTargets: string[] = [];

      if (rule.targetNumber) {
        targetParts.push(`→ ${rule.targetNumber}`);
        referencedTargets.push(rule.targetNumber);
      }
      for (const ch of rule.choices) {
        const prefix = /^(?:Feiertag|Zeitplan|Bedingung|Sprung)$/i.test(ch.choice)
          ? ch.choice
          : `Taste ${ch.choice}`;
        targetParts.push(
          `${prefix} → ${ch.targetNumber}${ch.label ? ` (${ch.label})` : ''}`
        );
        referencedTargets.push(ch.targetNumber);
      }

      let targetStatus = 'Intern / Queue';
      if (referencedTargets.length > 0) {
        const statuses = referencedTargets.map((t) => {
          const k = canonicalScriptMatchKey(t);
          if (loadedKeys.has(k)) return 'Geladen';
          if (externalKeys.has(k)) return 'Extern';
          return 'Ausstehend';
        });
        if (statuses.includes('Ausstehend')) {
          targetStatus = 'Ausstehende Referenz';
        } else if (statuses.every((s) => s === 'Extern')) {
          targetStatus = 'Externes Ziel';
        } else {
          targetStatus = 'Vollständig geladen';
        }
      } else if (!rule.queueTarget && !rule.announcement) {
        targetStatus = 'Offen / Prüfen';
      }

      rows.push({
        scriptNumber: mod.scriptNumber,
        scriptName: mod.scriptName,
        isMaster: mod.isMaster,
        prio: rule.prio,
        stepName: rule.stepName,
        conditionAndSchedule: condParts.join(' · ') || '—',
        announcement: rule.announcement || '—',
        queueTarget: rule.queueTarget || '—',
        targetsAndChoices: targetParts.join(', ') || '—',
        targetStatus,
      });
    }
  }

  return rows;
}

function escapeCsvCell(val: string | number): string {
  const str = String(val ?? '')
    .replace(/\r?\n/g, ' ')
    .trim();
  if (/[;"\t]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Exportiert die gesamte Routing-Matrix als Semikolon-getrennte CSV-Datei mit UTF-8 BOM
 * (direkt in deutschem Microsoft Excel mit korrekten Umlauten öffenbar).
 */
export function exportRoutingMatrixCsv(workspace: ScriptWorkspace): string {
  const rows = buildWorkspaceRoutingMatrix(workspace);
  const header = [
    'Skript-ID',
    'Skript-Bezeichnung',
    'Rolle',
    'Prio',
    'Regelschritt',
    'Bedingung / Zeitplan / Feiertag',
    'Ansage / RAN / Musik',
    'Warteschlange / Skillset',
    'Ziel-Skripte & DTMF-Auswahl',
    'Referenz-Status',
  ];

  const lines = [
    header.map(escapeCsvCell).join(';'),
    ...rows.map((r) =>
      [
        r.scriptNumber,
        r.scriptName,
        r.isMaster ? 'Master (Main)' : 'Teil-Skript',
        r.prio,
        r.stepName,
        r.conditionAndSchedule,
        r.announcement,
        r.queueTarget,
        r.targetsAndChoices,
        r.targetStatus,
      ]
        .map(escapeCsvCell)
        .join(';')
    ),
  ];

  return `\uFEFF${lines.join('\r\n')}`;
}

/**
 * Erzeugt ein vollständiges technisches Migrations- und Fachkonzept-Handbuch im Markdown-Format.
 */
export function exportMigrationDocumentationMarkdown(
  workspace: ScriptWorkspace
): string {
  const modules = workspace.modules || [];
  const checklist = workspace.masterChecklist || [];
  const health = analyzeWorkspaceLogicHealth(workspace);
  const registry = extractWorkspaceResourceRegistry(workspace);
  const matrix = buildWorkspaceRoutingMatrix(workspace);
  const missingCount = checklist.filter((i) => i.status === 'missing').length;
  const presentCount = checklist.filter((i) => i.status === 'present').length;
  const externalCount = checklist.filter((i) => i.status === 'external').length;

  const md: string[] = [];
  md.push('# Callflow-Migrations- & Fachkonzept-Dokumentation');
  md.push('');
  md.push(`- **Erstellt am:** ${new Date().toLocaleString('de-DE')}`);
  md.push(`- **Geladene Skript-Module:** ${modules.length}`);
  md.push(
    `- **Hauptskript (Master):** ${workspace.masterScriptNumber || modules[0]?.scriptNumber || 'Main'}`
  );
  md.push(
    `- **Referenz-Abgleich:** ${presentCount} geladen · ${externalCount} extern · ${missingCount} ausstehend`
  );
  md.push(
    `- **Erkannte Ressourcen:** ${registry.skillsets.length} Skillsets/Queues · ${registry.announcements.length} Ansagen/RAN · ${registry.variables.length} Systemvariablen`
  );
  md.push(`- **Logik-Prüfbefunde:** ${health.length}`);
  md.push('');

  // 1. Callflow-Hierarchie / Checkliste
  md.push('## 1. Callflow-Referenzbaum & Abgleichstatus');
  md.push('');
  if (checklist.length === 0) {
    md.push('_Keine ausgehenden Skript-Referenzen in der Master-Checkliste._');
  } else {
    md.push('| Nr. | Ebene | Ziel-Skript / Nummer | Aufrufer | Kontext | Status |');
    md.push('| --- | --- | --- | --- | --- | --- |');
    checklist.forEach((item) => {
      const statusLabel =
        item.status === 'present'
          ? 'Vorhanden (Geladen)'
          : item.status === 'external'
          ? 'Externes Ziel'
          : 'Ausstehende Referenz';
      md.push(
        `| ${item.orderIndex} | Ebene ${item.depth || 1} | \`${item.refKey}\` (${item.displayName}) | \`${item.callerScriptNumber}\` | ${item.contextLabel} | **${statusLabel}** |`
      );
    });
  }
  md.push('');

  // 2. Ressourcen-Register
  md.push('## 2. Zentrales Ressourcen- & Variablen-Register');
  md.push('');
  md.push('### 2.1 Warteschlangen & Skillsets');
  if (registry.skillsets.length === 0) {
    md.push('_Keine Skillsets oder Warteschlangen im Callflow erkannt._');
  } else {
    md.push('| Skillset / Queue | Typ | Verwendet in Skripten |');
    md.push('| --- | --- | --- |');
    registry.skillsets.forEach((sk) => {
      const roleLabel =
        sk.role === 'primary'
          ? 'Primär-Skillset'
          : sk.role === 'overflow'
          ? 'Überlauf-Skillset'
          : 'Regel-Queue';
      const refs = sk.usages
        .map(
          (u) =>
            `\`[${u.scriptNumber}]\` ${u.stepName || ''}${u.prio !== undefined ? ` (Prio ${u.prio})` : ''}`
        )
        .join(', ');
      md.push(`| \`${sk.name}\` | ${roleLabel} | ${refs} |`);
    });
  }
  md.push('');

  md.push('### 2.2 Ansagen, RAN & Wartemusik');
  if (registry.announcements.length === 0) {
    md.push('_Keine Ansagen oder Musik-IDs erkannt._');
  } else {
    md.push('| Ansage / RAN / Audio | Verwendet in Skripten |');
    md.push('| --- | --- |');
    registry.announcements.forEach((ann) => {
      const refs = ann.usages
        .map(
          (u) =>
            `\`[${u.scriptNumber}]\` ${u.stepName || ''}${u.prio !== undefined ? ` (Prio ${u.prio})` : ''}`
        )
        .join(', ');
      md.push(`| \`${ann.idOrName}\` | ${refs} |`);
    });
  }
  md.push('');

  if (registry.variables.length > 0) {
    md.push('### 2.3 AACC-Systemvariablen (`ASSIGN`)');
    md.push('| Variable | Gesetzte Werte je Skript |');
    md.push('| --- | --- |');
    registry.variables.forEach((v) => {
      const vals = v.valuesByScript
        .map((s) => `\`[${s.scriptNumber}]\`: \`${s.value}\``)
        .join(' · ');
      md.push(`| \`${v.variableName}\` | ${vals} |`);
    });
    md.push('');
  }

  // 3. Logik-Prüfung
  md.push('## 3. Automatische Logik- & Qualitätsprüfung');
  md.push('');
  if (health.length === 0) {
    md.push('Keine kritischen Schleifen, Sackgassen oder verwaisten Skripte erkannt.');
  } else {
    health.forEach((f) => {
      const badge =
        f.severity === 'error'
          ? '[FEHLER]'
          : f.severity === 'warning'
          ? '[WARNUNG]'
          : '[HINWEIS]';
      md.push(`- **${badge} ${f.title}** (\`[${f.scriptNumber}] ${f.scriptName}\`)`);
      md.push(`  - *Befund:* ${f.description}`);
      md.push(`  - *Empfehlung:* ${f.recommendation}`);
    });
  }
  md.push('');

  // 4. Vollständige Routing-Matrix
  md.push('## 4. Vollständige Routing-Matrix');
  md.push('');
  if (matrix.length === 0) {
    md.push('_Keine Routing-Regeln vorhanden._');
  } else {
    md.push(
      '| Skript | Prio | Schritt | Bedingung / Zeitplan | Ansage / RAN | Queue / Skillset | Ziel / DTMF | Status |'
    );
    md.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    matrix.forEach((r) => {
      md.push(
        `| \`[${r.scriptNumber}]\` ${r.scriptName} | ${r.prio} | ${r.stepName} | ${r.conditionAndSchedule} | ${r.announcement} | ${r.queueTarget} | ${r.targetsAndChoices} | ${r.targetStatus} |`
      );
    });
  }
  md.push('');

  return md.join('\n');
}

export interface EditableNodeConnectionItem {
  id: string;
  toTargetNumber: string;
  label: string;
  kind: 'rule-target' | 'choice' | 'manual-link';
  ruleId?: string;
  choiceKey?: string;
}

export interface EditableCallflowNodeSnapshot {
  nodeId: string;
  mode: 'workspace-module' | 'workspace-step' | 'workspace-external' | 'raw-mermaid';
  scriptNumber: string;
  title: string;
  blockType: CallflowBuildingBlockType;
  prio?: number;
  ruleId?: string;
  announcement: string;
  queueTarget: string;
  schedule: string;
  condition: string;
  outgoingConnections: EditableNodeConnectionItem[];
}

/**
 * Inspects a node from the current diagram so the Double-Click Node Editor modal can
 * pre-populate its title, number, building block type, announcement, skillset, schedule/condition,
 * and outgoing transitions.
 */
export function inspectWorkspaceNodeForEdit(
  workspace: ScriptWorkspace,
  viewLevel: CallflowViewLevel,
  nodeId: string,
  graph: CallflowGraph
): EditableCallflowNodeSnapshot {
  const graphNode = graph.nodes.get(nodeId);
  const fallbackLabel = graphNode?.label || nodeId;

  if (workspace.modules.length === 0) {
    const rawOutgoing: EditableNodeConnectionItem[] = graph.edges
      .filter((e) => e.from === nodeId)
      .map((e, idx) => ({
        id: `raw-${idx}-${e.to}`,
        toTargetNumber: e.to,
        label: e.label || '',
        kind: 'manual-link',
      }));
    return {
      nodeId,
      mode: 'raw-mermaid',
      scriptNumber: nodeId,
      title: fallbackLabel,
      blockType: 'script',
      announcement: '',
      queueTarget: '',
      schedule: '',
      condition: '',
      outgoingConnections: rawOutgoing,
    };
  }

  // Detail View Step (`STEP_<modSuffix>_<idx>`)
  const stepMatch = nodeId.match(/^STEP_([A-Za-z0-9_]+)_(\d+)$/);
  if (viewLevel.level === 'detail' && stepMatch) {
    const stepIndex = Math.max(0, parseInt(stepMatch[2], 10) - 1);
    const mod = workspace.modules.find(
      (m) =>
        canonicalScriptMatchKey(m.scriptNumber) ===
        canonicalScriptMatchKey(viewLevel.scriptNumber)
    );
    const sortedRules = mod ? [...mod.rules].sort((a, b) => a.prio - b.prio) : [];
    const rule = sortedRules[stepIndex];
    if (mod && rule) {
      const outgoing: EditableNodeConnectionItem[] = [];
      if (rule.targetNumber) {
        outgoing.push({
          id: `rt-${rule.id}`,
          toTargetNumber: rule.targetNumber,
          label: `Wohin: ${rule.targetNumber}`,
          kind: 'rule-target',
          ruleId: rule.id,
        });
      }
      rule.choices.forEach((ch, cIdx) => {
        outgoing.push({
          id: `ch-${rule.id}-${cIdx}`,
          toTargetNumber: ch.targetNumber,
          label: ch.choice,
          kind: 'choice',
          ruleId: rule.id,
          choiceKey: ch.choice,
        });
      });
      (workspace.manualLinks || [])
        .filter(
          (lnk) =>
            canonicalScriptMatchKey(lnk.fromScriptNumber) ===
              canonicalScriptMatchKey(mod.scriptNumber) && lnk.fromRuleId === rule.id
        )
        .forEach((lnk) => {
          outgoing.push({
            id: lnk.id,
            toTargetNumber: lnk.toTargetNumber,
            label: lnk.label || 'Verknüpft',
            kind: 'manual-link',
            ruleId: rule.id,
          });
        });

      const blockType: CallflowBuildingBlockType =
        rule.choices.length > 0
          ? 'dtmf'
          : rule.schedule || rule.condition
          ? 'condition'
          : rule.queueTarget
          ? 'queue'
          : rule.announcement
          ? 'announcement'
          : 'script';

      return {
        nodeId,
        mode: 'workspace-step',
        scriptNumber: mod.scriptNumber,
        title: rule.stepName,
        blockType,
        prio: rule.prio,
        ruleId: rule.id,
        announcement: rule.announcement || '',
        queueTarget: rule.queueTarget || '',
        schedule: rule.schedule || '',
        condition: rule.condition || '',
        outgoingConnections: outgoing,
      };
    }
  }

  // Master View or Detail Jump/Self/Inc node -> maps to a ScriptModule or Missing/External target
  const extractedRef =
    extractScriptNumberFromNodeId(nodeId, workspace.modules) ||
    (viewLevel.level === 'detail' ? viewLevel.scriptNumber : nodeId.replace(/^S_/, ''));
  const targetKey = canonicalScriptMatchKey(extractedRef);
  const mod = workspace.modules.find(
    (m) => canonicalScriptMatchKey(m.scriptNumber) === targetKey
  );

  if (mod) {
    const primaryRule = [...mod.rules].sort((a, b) => a.prio - b.prio)[0];
    const outgoing: EditableNodeConnectionItem[] = [];
    mod.rules.forEach((r) => {
      if (r.targetNumber) {
        outgoing.push({
          id: `rt-${r.id}`,
          toTargetNumber: r.targetNumber,
          label: `P${r.prio}`,
          kind: 'rule-target',
          ruleId: r.id,
        });
      }
      r.choices.forEach((ch, cIdx) => {
        outgoing.push({
          id: `ch-${r.id}-${cIdx}`,
          toTargetNumber: ch.targetNumber,
          label: ch.choice,
          kind: 'choice',
          ruleId: r.id,
          choiceKey: ch.choice,
        });
      });
    });
    (workspace.manualLinks || [])
      .filter((lnk) => canonicalScriptMatchKey(lnk.fromScriptNumber) === targetKey)
      .forEach((lnk) => {
        outgoing.push({
          id: lnk.id,
          toTargetNumber: lnk.toTargetNumber,
          label: lnk.label || 'Verknüpft',
          kind: 'manual-link',
        });
      });

    const hasChoices = mod.rules.some((r) => r.choices.length > 0);
    const firstAnn = mod.rules.find((r) => Boolean(r.announcement))?.announcement || '';
    const firstQueue = mod.rules.find((r) => Boolean(r.queueTarget))?.queueTarget || '';
    const firstSched = mod.rules.find((r) => Boolean(r.schedule))?.schedule || '';
    const firstCond = mod.rules.find((r) => Boolean(r.condition))?.condition || '';

    const blockType: CallflowBuildingBlockType = hasChoices
      ? 'dtmf'
      : firstSched || firstCond
      ? 'condition'
      : firstQueue && mod.outgoingNumbers.length === 0
      ? 'queue'
      : firstAnn && mod.outgoingNumbers.length === 0
      ? 'announcement'
      : 'script';

    return {
      nodeId,
      mode: 'workspace-module',
      scriptNumber: mod.scriptNumber,
      title: mod.scriptName,
      blockType,
      prio: primaryRule?.prio ?? 1,
      ruleId: primaryRule?.id,
      announcement: firstAnn,
      queueTarget: firstQueue,
      schedule: firstSched,
      condition: firstCond,
      outgoingConnections: outgoing,
    };
  }

  const isExternal = (workspace.externalEndpoints || []).some(
    (e) => canonicalScriptMatchKey(e) === targetKey
  );
  const outgoing: EditableNodeConnectionItem[] = (workspace.manualLinks || [])
    .filter((lnk) => canonicalScriptMatchKey(lnk.fromScriptNumber) === targetKey)
    .map((lnk) => ({
      id: lnk.id,
      toTargetNumber: lnk.toTargetNumber,
      label: lnk.label || 'Verknüpft',
      kind: 'manual-link',
    }));

  return {
    nodeId,
    mode: 'workspace-external',
    scriptNumber: extractedRef,
    title: isExternal ? 'Externes Ziel' : `Skript ${extractedRef}`,
    blockType: isExternal ? 'external' : 'script',
    announcement: '',
    queueTarget: '',
    schedule: '',
    condition: '',
    outgoingConnections: outgoing,
  };
}

/**
 * Adds a new Callflow Building Block (from the PC Drag & Drop Palette Bar) into the
 * ScriptWorkspace and returns the updated workspace + created node ID + optional initial offset.
 */
export function addBuildingBlockToWorkspace(
  workspace: ScriptWorkspace,
  viewLevel: CallflowViewLevel,
  block: {
    type: CallflowBuildingBlockType;
    idOrNumber?: string;
    title?: string;
    announcement?: string;
    queueTarget?: string;
    schedule?: string;
    condition?: string;
    connectFromNodeId?: string | null;
    connectLabel?: string;
    initialOffset?: NodePositionOffset;
  }
): { workspace: ScriptWorkspace; createdNodeId: string; createdScriptNumber: string } {
  const existingKeys = new Set(
    workspace.modules.map((m) => canonicalScriptMatchKey(m.scriptNumber))
  );

  // Generate a clean default number/identifier if not provided
  const pickNextScriptNumber = (prefixNum: number): string => {
    let candidate = prefixNum;
    while (existingKeys.has(String(candidate))) {
      candidate += 10;
    }
    return String(candidate);
  };

  // Detail View: If viewing a specific script in Level 2, add a new Rule Step directly to that script!
  if (viewLevel.level === 'detail' && workspace.modules.length > 0 && block.type !== 'external') {
    const activeScriptNum = viewLevel.scriptNumber;
    const activeKey = canonicalScriptMatchKey(activeScriptNum);
    const mod = workspace.modules.find(
      (m) => canonicalScriptMatchKey(m.scriptNumber) === activeKey
    );
    if (mod) {
      const maxPrio = mod.rules.reduce((max, r) => Math.max(max, r.prio), 0);
      const nextPrio = maxPrio + 1;
      const newRuleId = `${toMermaidNodeSuffix(mod.scriptNumber)}-dd-${Date.now().toString(36)}`;
      const targetRef = block.idOrNumber
        ? normalizeScriptRef(block.idOrNumber)
        : block.type === 'script' || block.type === 'dtmf'
        ? pickNextScriptNumber(4500)
        : undefined;

      const newRule: ScriptRule = {
        id: newRuleId,
        prio: nextPrio,
        stepName:
          block.title?.trim() ||
          (block.type === 'announcement'
            ? 'Ansage / RAN abspielen'
            : block.type === 'queue'
            ? 'Skillset / Warteschlange'
            : block.type === 'condition'
            ? 'Zeit- / IF-Weiche'
            : block.type === 'dtmf'
            ? 'DTMF-Auswahlmenü'
            : `Aufruf ${targetRef || 'Folgeskript'}`),
        sourceNumber: mod.scriptNumber,
        targetNumber: block.type === 'dtmf' ? undefined : targetRef,
        announcement:
          block.announcement?.trim() ||
          (block.type === 'announcement' ? 'willkommen_ansage.wav' : undefined),
        queueTarget:
          block.queueTarget?.trim() ||
          (block.type === 'queue' ? 'Service_Skillset_DE' : undefined),
        schedule:
          block.schedule?.trim() ||
          (block.type === 'condition' ? 'Mo-Fr 08:00-18:00' : undefined),
        condition: block.condition?.trim() || undefined,
        choices:
          block.type === 'dtmf'
            ? [
                {
                  choice: '1',
                  targetNumber: targetRef || pickNextScriptNumber(4510),
                  label: 'Taste 1',
                },
              ]
            : [],
        rawLine: `Prio ${nextPrio}: ${block.title || block.type}`,
      };

      const nextModules = workspace.modules.map((m) =>
        canonicalScriptMatchKey(m.scriptNumber) === activeKey
          ? { ...m, rules: [...m.rules, newRule] }
          : m
      );
      const stepIdx = mod.rules.length + 1;
      const createdNodeId = `STEP_${toMermaidNodeSuffix(mod.scriptNumber)}_${stepIdx}`;
      const nextOffsets = { ...(workspace.nodeOffsets || {}) };
      if (block.initialOffset) {
        nextOffsets[createdNodeId] = block.initialOffset;
      }

      const updatedWs = buildScriptWorkspace(nextModules, {
        ...workspace,
        nodeOffsets: nextOffsets,
      });
      return {
        workspace: updatedWs,
        createdNodeId,
        createdScriptNumber: mod.scriptNumber,
      };
    }
  }

  // Master View (or creating an external target / new module)
  const defaultNumByType: Record<CallflowBuildingBlockType, number> = {
    script: 4100,
    announcement: 3100,
    queue: 5100,
    condition: 2100,
    dtmf: 6100,
    external: 9900,
  };
  const newScriptNumber = block.idOrNumber?.trim()
    ? normalizeScriptRef(block.idOrNumber)
    : workspace.modules.length === 0
    ? 'Main'
    : pickNextScriptNumber(defaultNumByType[block.type] || 4000);

  const defaultTitleByType: Record<CallflowBuildingBlockType, string> = {
    script: newScriptNumber === 'Main' ? 'Hauptskript (Main)' : `Teil-Skript ${newScriptNumber}`,
    announcement: `Ansage / RAN (${newScriptNumber})`,
    queue: `Skillset-Routing (${newScriptNumber})`,
    condition: `Zeit- & Feiertagsweiche (${newScriptNumber})`,
    dtmf: `DTMF-Sprachmenü (${newScriptNumber})`,
    external: `Externes Ziel (${newScriptNumber})`,
  };
  const newTitle = block.title?.trim() || defaultTitleByType[block.type];
  const createdNodeId = `S_${toMermaidNodeSuffix(newScriptNumber)}`;
  const nextOffsets = { ...(workspace.nodeOffsets || {}) };
  if (block.initialOffset) {
    nextOffsets[createdNodeId] = block.initialOffset;
  }

  // Determine optional source script to auto-connect from if user dropped onto a node
  const fromScriptRef = block.connectFromNodeId
    ? extractScriptNumberFromNodeId(block.connectFromNodeId, workspace.modules)
    : null;

  if (block.type === 'external') {
    const nextExternal = Array.from(
      new Set([...(workspace.externalEndpoints || []), newScriptNumber])
    );
    const nextLinks = [...(workspace.manualLinks || [])];
    const sourceCaller =
      fromScriptRef ||
      (viewLevel.level === 'detail'
        ? viewLevel.scriptNumber
        : workspace.masterScriptNumber || workspace.modules[0]?.scriptNumber);
    if (
      sourceCaller &&
      canonicalScriptMatchKey(sourceCaller) !== canonicalScriptMatchKey(newScriptNumber)
    ) {
      nextLinks.push({
        id: `lnk-dd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fromScriptNumber: sourceCaller,
        toTargetNumber: newScriptNumber,
        label: block.connectLabel || 'Extern',
      });
    }
    const updatedWs = buildScriptWorkspace(workspace.modules, {
      ...workspace,
      externalEndpoints: nextExternal,
      manualLinks: nextLinks,
      nodeOffsets: nextOffsets,
    });
    return {
      workspace: updatedWs,
      createdNodeId,
      createdScriptNumber: newScriptNumber,
    };
  }

  // Build initial rule for the new module based on building block type
  const ruleId = `${toMermaidNodeSuffix(newScriptNumber)}-1`;
  const initialRule: ScriptRule = {
    id: ruleId,
    prio: 1,
    stepName: newTitle,
    sourceNumber: newScriptNumber,
    announcement:
      block.announcement?.trim() ||
      (block.type === 'announcement' ? `ansage_${toMermaidNodeSuffix(newScriptNumber)}.wav` : undefined),
    queueTarget:
      block.queueTarget?.trim() ||
      (block.type === 'queue' || block.type === 'script'
        ? `Skillset_${toMermaidNodeSuffix(newScriptNumber)}`
        : undefined),
    schedule:
      block.schedule?.trim() ||
      (block.type === 'condition' ? 'Mo-Fr 08:00-18:00' : undefined),
    condition:
      block.condition?.trim() ||
      (block.type === 'condition' ? 'Öffnungszeiten aktiv' : undefined),
    choices:
      block.type === 'dtmf'
        ? [
            {
              choice: '1',
              targetNumber: pickNextScriptNumber(5200),
              label: 'Auswahl 1',
            },
          ]
        : [],
    rawLine: `Prio 1: ${newTitle}`,
  };

  const newModule: ScriptModule = {
    scriptNumber: newScriptNumber,
    scriptName: newTitle,
    isMaster:
      workspace.modules.length === 0 ||
      /^(?:main|master(?:script)?|0000)$/i.test(canonicalScriptMatchKey(newScriptNumber)),
    origin: 'legacy-text',
    rawText: `=== [${newScriptNumber}] ${newTitle} ===\n${initialRule.rawLine}`,
    rules: [initialRule],
    outgoingNumbers: [],
  };

  const nextModules = [...workspace.modules, newModule];
  const nextLinks = [...(workspace.manualLinks || [])];
  if (
    fromScriptRef &&
    canonicalScriptMatchKey(fromScriptRef) !== canonicalScriptMatchKey(newScriptNumber)
  ) {
    nextLinks.push({
      id: `lnk-dd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromScriptNumber: fromScriptRef,
      toTargetNumber: newScriptNumber,
      label: block.connectLabel || 'Sprung',
    });
  }

  const updatedWs = buildScriptWorkspace(nextModules, {
    ...workspace,
    manualLinks: nextLinks,
    nodeOffsets: nextOffsets,
  });

  return {
    workspace: updatedWs,
    createdNodeId,
    createdScriptNumber: newScriptNumber,
  };
}

/**
 * Creates a new transition connection (or updates an existing one) when the user drags a connection
 * wire from `fromNodeId` to `toNodeId` on the PC canvas.
 */
export function connectNodesInWorkspace(
  workspace: ScriptWorkspace,
  viewLevel: CallflowViewLevel,
  fromNodeId: string,
  toNodeId: string,
  edgeLabel: string = ''
): ScriptWorkspace {
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return workspace;

  const cleanLabel = edgeLabel.trim();

  // Case 1: Detail view connecting a STEP_<mod>_<idx> to a JUMP_<target> or S_<target>
  const stepMatch = fromNodeId.match(/^STEP_([A-Za-z0-9_]+)_(\d+)$/);
  if (viewLevel.level === 'detail' && stepMatch) {
    const stepIndex = Math.max(0, parseInt(stepMatch[2], 10) - 1);
    const toRef =
      extractScriptNumberFromNodeId(toNodeId, workspace.modules) ||
      toNodeId.replace(/^(?:S|JUMP|INC|SELF)_/, '');
    if (!toRef) return workspace;

    const activeKey = canonicalScriptMatchKey(viewLevel.scriptNumber);
    const nextModules = workspace.modules.map((mod) => {
      if (canonicalScriptMatchKey(mod.scriptNumber) !== activeKey) return mod;
      const sorted = [...mod.rules].sort((a, b) => a.prio - b.prio);
      const targetRule = sorted[stepIndex];
      if (!targetRule) return mod;

      const choiceMatch = cleanLabel.match(/^(?:taste\s*)?([0-9*#]+)$/i);
      const updatedRule: ScriptRule = choiceMatch
        ? {
            ...targetRule,
            choices: [
              ...targetRule.choices.filter((c) => c.choice !== choiceMatch[1]),
              { choice: choiceMatch[1], targetNumber: toRef, label: cleanLabel },
            ],
          }
        : !targetRule.targetNumber
        ? { ...targetRule, targetNumber: toRef }
        : {
            ...targetRule,
            choices: [
              ...targetRule.choices,
              { choice: cleanLabel || 'Sprung', targetNumber: toRef },
            ],
          };

      return {
        ...mod,
        rules: mod.rules.map((r) => (r.id === targetRule.id ? updatedRule : r)),
      };
    });

    return buildScriptWorkspace(nextModules, workspace);
  }

  // Case 2: Master Overview (or general script-to-script connection)
  const fromRef =
    extractScriptNumberFromNodeId(fromNodeId, workspace.modules) ||
    (viewLevel.level === 'detail' ? viewLevel.scriptNumber : fromNodeId.replace(/^S_/, ''));
  const toRef =
    extractScriptNumberFromNodeId(toNodeId, workspace.modules) ||
    toNodeId.replace(/^(?:S|JUMP|INC|SELF)_/, '');

  if (!fromRef || !toRef) return workspace;
  const fromKey = canonicalScriptMatchKey(fromRef);
  const toKey = canonicalScriptMatchKey(toRef);
  if (fromKey === toKey) return workspace;

  const sourceMod = workspace.modules.find(
    (m) => canonicalScriptMatchKey(m.scriptNumber) === fromKey
  );

  if (sourceMod) {
    const choiceMatch = cleanLabel.match(/^(?:taste\s*)?([0-9*#]+)$/i);
    const maxPrio = sourceMod.rules.reduce((max, r) => Math.max(max, r.prio), 0);
    const newRule: ScriptRule = {
      id: `${toMermaidNodeSuffix(sourceMod.scriptNumber)}-conn-${Date.now().toString(36)}`,
      prio: maxPrio + 1,
      stepName: cleanLabel ? `${cleanLabel} → ${toRef}` : `Weiterleitung → ${toRef}`,
      sourceNumber: sourceMod.scriptNumber,
      targetNumber: choiceMatch ? undefined : toRef,
      choices: choiceMatch ? [{ choice: choiceMatch[1], targetNumber: toRef }] : [],
      rawLine: `Prio ${maxPrio + 1}: ${cleanLabel || 'Wohin'} -> ${toRef}`,
    };

    const nextModules = workspace.modules.map((m) =>
      canonicalScriptMatchKey(m.scriptNumber) === fromKey
        ? { ...m, rules: [...m.rules, newRule] }
        : m
    );
    return buildScriptWorkspace(nextModules, workspace);
  }

  // Fallback if source is a missing/external node: record in manualLinks
  const nextLinks: ScriptManualLink[] = [
    ...(workspace.manualLinks || []),
    {
      id: `lnk-dd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromScriptNumber: fromRef,
      toTargetNumber: toRef,
      label: cleanLabel || 'Verknüpft',
    },
  ];
  return buildScriptWorkspace(workspace.modules, {
    ...workspace,
    manualLinks: nextLinks,
  });
}

/**
 * Updates a node's properties, text, and outgoing transitions from the Double-Click Node Editor modal.
 */
export function updateWorkspaceNodeFromEdit(
  workspace: ScriptWorkspace,
  viewLevel: CallflowViewLevel,
  snapshot: EditableCallflowNodeSnapshot,
  updates: {
    scriptNumber: string;
    title: string;
    blockType: CallflowBuildingBlockType;
    announcement: string;
    queueTarget: string;
    schedule: string;
    condition: string;
    outgoingConnections: EditableNodeConnectionItem[];
  }
): ScriptWorkspace {
  const cleanScriptNum = normalizeScriptRef(updates.scriptNumber || snapshot.scriptNumber) || snapshot.scriptNumber;
  const cleanTitle = updates.title.trim() || cleanScriptNum;
  const cleanAnn = updates.announcement.trim();
  const cleanQueue = updates.queueTarget.trim();
  const cleanSched = updates.schedule.trim();
  const cleanCond = updates.condition.trim();

  // Case 1: Editing a specific Rule Step in Level 2 Detail View
  if (snapshot.mode === 'workspace-step' && snapshot.ruleId) {
    const modKey = canonicalScriptMatchKey(snapshot.scriptNumber);
    const ruleTargets = updates.outgoingConnections.filter((c) => c.toTargetNumber.trim());
    const primaryTarget =
      ruleTargets.find((c) => c.kind === 'rule-target')?.toTargetNumber.trim() ||
      (updates.blockType !== 'dtmf' ? ruleTargets[0]?.toTargetNumber.trim() : undefined);

    const choiceItems: ScriptChoiceOption[] = ruleTargets
      .filter((c) => c.kind === 'choice' || (updates.blockType === 'dtmf' && c.toTargetNumber.trim()))
      .map((c, idx) => ({
        choice: c.label.replace(/^Taste\s+/i, '').trim() || String(idx + 1),
        targetNumber: normalizeScriptRef(c.toTargetNumber),
      }));

    const nextModules = workspace.modules.map((mod) => {
      if (canonicalScriptMatchKey(mod.scriptNumber) !== modKey) return mod;
      return {
        ...mod,
        rules: mod.rules.map((r) =>
          r.id === snapshot.ruleId
            ? {
                ...r,
                stepName: cleanTitle,
                targetNumber: primaryTarget ? normalizeScriptRef(primaryTarget) : undefined,
                announcement: cleanAnn || undefined,
                queueTarget: cleanQueue || undefined,
                schedule: cleanSched || undefined,
                condition: cleanCond || undefined,
                choices: choiceItems,
              }
            : r
        ),
      };
    });

    return buildScriptWorkspace(nextModules, workspace);
  }

  // Case 2: Editing a ScriptModule in Master Overview (or promoting a missing/external node to a full module)
  const oldKey = canonicalScriptMatchKey(snapshot.scriptNumber);
  const newKey = canonicalScriptMatchKey(cleanScriptNum);

  const validConnections = updates.outgoingConnections.filter((c) =>
    Boolean(c.toTargetNumber.trim())
  );

  // If the user set blockType === 'external' and there is no module for it (or they want it as an external endpoint)
  if (updates.blockType === 'external' && snapshot.mode === 'workspace-external') {
    const nextExternal = Array.from(
      new Set([
        ...(workspace.externalEndpoints || []).filter(
          (e) => canonicalScriptMatchKey(e) !== oldKey
        ),
        cleanScriptNum,
      ])
    );
    const nextLinks = [
      ...(workspace.manualLinks || []).filter(
        (l) => canonicalScriptMatchKey(l.fromScriptNumber) !== oldKey
      ),
      ...validConnections.map((c) => ({
        id: c.id || `lnk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        fromScriptNumber: cleanScriptNum,
        toTargetNumber: normalizeScriptRef(c.toTargetNumber),
        label: c.label.trim() || 'Verknüpft',
      })),
    ];
    return buildScriptWorkspace(workspace.modules, {
      ...workspace,
      externalEndpoints: nextExternal,
      manualLinks: nextLinks,
    });
  }

  const existingMod = workspace.modules.find(
    (m) => canonicalScriptMatchKey(m.scriptNumber) === oldKey
  );

  // Build updated rules list reflecting the edited fields & outgoing connections
  let updatedRules: ScriptRule[] = [];
  if (existingMod && existingMod.rules.length > 0) {
    const sorted = [...existingMod.rules].sort((a, b) => a.prio - b.prio);
    const firstRule = sorted[0];

    const newRulesFromConnections: ScriptRule[] = [];
    const choiceList: ScriptChoiceOption[] = [];
    let firstDirectTarget: string | undefined;

    validConnections.forEach((conn, idx) => {
      const targetNorm = normalizeScriptRef(conn.toTargetNumber);
      const tasteMatch = conn.label.match(/^(?:taste\s*)?([0-9*#]+)$/i);
      if (conn.kind === 'choice' || updates.blockType === 'dtmf' || tasteMatch) {
        choiceList.push({
          choice: tasteMatch ? tasteMatch[1] : conn.label.trim() || String(idx + 1),
          targetNumber: targetNorm,
        });
      } else if (!firstDirectTarget) {
        firstDirectTarget = targetNorm;
      } else {
        newRulesFromConnections.push({
          id: `${toMermaidNodeSuffix(cleanScriptNum)}-r-${idx + 2}`,
          prio: idx + 2,
          stepName: conn.label.trim() || `Weiterleitung → ${targetNorm}`,
          sourceNumber: cleanScriptNum,
          targetNumber: targetNorm,
          choices: [],
          rawLine: `Prio ${idx + 2}: Wohin -> ${targetNorm}`,
        });
      }
    });

    updatedRules = [
      {
        ...firstRule,
        sourceNumber: cleanScriptNum,
        stepName:
          firstRule.stepName === existingMod.scriptName || !firstRule.stepName
            ? cleanTitle
            : firstRule.stepName,
        announcement: cleanAnn || undefined,
        queueTarget: cleanQueue || undefined,
        schedule: cleanSched || undefined,
        condition: cleanCond || undefined,
        targetNumber: firstDirectTarget,
        choices: choiceList,
      },
      ...newRulesFromConnections,
    ];
  } else {
    // Creating a module from a previously missing/external node
    const firstTarget = validConnections[0]?.toTargetNumber
      ? normalizeScriptRef(validConnections[0].toTargetNumber)
      : undefined;
    updatedRules = [
      {
        id: `${toMermaidNodeSuffix(cleanScriptNum)}-1`,
        prio: 1,
        stepName: cleanTitle,
        sourceNumber: cleanScriptNum,
        targetNumber: firstTarget,
        announcement: cleanAnn || undefined,
        queueTarget: cleanQueue || undefined,
        schedule: cleanSched || undefined,
        condition: cleanCond || undefined,
        choices: validConnections.slice(1).map((c, idx) => ({
          choice: c.label.trim() || String(idx + 1),
          targetNumber: normalizeScriptRef(c.toTargetNumber),
        })),
        rawLine: `Prio 1: ${cleanTitle}`,
      },
    ];
  }

  let nextModules: ScriptModule[];
  if (existingMod) {
    nextModules = workspace.modules.map((mod) => {
      if (canonicalScriptMatchKey(mod.scriptNumber) === oldKey) {
        return {
          ...mod,
          scriptNumber: cleanScriptNum,
          scriptName: cleanTitle,
          rules: updatedRules,
        };
      }
      // If scriptNumber was renamed, update incoming references in other modules
      if (oldKey !== newKey) {
        return {
          ...mod,
          rules: mod.rules.map((r) => ({
            ...r,
            targetNumber:
              r.targetNumber && canonicalScriptMatchKey(r.targetNumber) === oldKey
                ? cleanScriptNum
                : r.targetNumber,
            choices: r.choices.map((ch) =>
              canonicalScriptMatchKey(ch.targetNumber) === oldKey
                ? { ...ch, targetNumber: cleanScriptNum }
                : ch
            ),
          })),
        };
      }
      return mod;
    });
  } else {
    nextModules = [
      ...workspace.modules,
      {
        scriptNumber: cleanScriptNum,
        scriptName: cleanTitle,
        isMaster: false,
        origin: 'legacy-text',
        rawText: `=== [${cleanScriptNum}] ${cleanTitle} ===`,
        rules: updatedRules,
        outgoingNumbers: [],
      },
    ];
  }

  // Clear old manualLinks from this module since outgoingConnections are now stored in rules
  const nextLinks = (workspace.manualLinks || [])
    .filter((lnk) => canonicalScriptMatchKey(lnk.fromScriptNumber) !== oldKey)
    .map((lnk) =>
      oldKey !== newKey && canonicalScriptMatchKey(lnk.toTargetNumber) === oldKey
        ? { ...lnk, toTargetNumber: cleanScriptNum }
        : lnk
    );

  // Preserve nodeOffsets if renamed
  const nextOffsets = { ...(workspace.nodeOffsets || {}) };
  const oldNodeId = `S_${toMermaidNodeSuffix(snapshot.scriptNumber)}`;
  const newNodeId = `S_${toMermaidNodeSuffix(cleanScriptNum)}`;
  if (oldNodeId !== newNodeId && nextOffsets[oldNodeId]) {
    nextOffsets[newNodeId] = nextOffsets[oldNodeId];
    delete nextOffsets[oldNodeId];
  }

  return buildScriptWorkspace(nextModules, {
    ...workspace,
    manualLinks: nextLinks,
    masterScriptNumber:
      workspace.masterScriptNumber &&
      canonicalScriptMatchKey(workspace.masterScriptNumber) === oldKey
        ? cleanScriptNum
        : workspace.masterScriptNumber,
    nodeOffsets: nextOffsets,
  });
}

/**
 * Deletes a node (module, external target, or detail-view rule step) from the ScriptWorkspace.
 */
export function deleteNodeFromWorkspace(
  workspace: ScriptWorkspace,
  viewLevel: CallflowViewLevel,
  nodeId: string
): ScriptWorkspace {
  const stepMatch = nodeId.match(/^STEP_([A-Za-z0-9_]+)_(\d+)$/);
  if (viewLevel.level === 'detail' && stepMatch) {
    const stepIndex = Math.max(0, parseInt(stepMatch[2], 10) - 1);
    const activeKey = canonicalScriptMatchKey(viewLevel.scriptNumber);
    const nextModules = workspace.modules.map((mod) => {
      if (canonicalScriptMatchKey(mod.scriptNumber) !== activeKey) return mod;
      const sorted = [...mod.rules].sort((a, b) => a.prio - b.prio);
      const targetRule = sorted[stepIndex];
      if (!targetRule) return mod;
      return {
        ...mod,
        rules: mod.rules.filter((r) => r.id !== targetRule.id),
      };
    });
    const nextOffsets = { ...(workspace.nodeOffsets || {}) };
    delete nextOffsets[nodeId];
    return buildScriptWorkspace(nextModules, {
      ...workspace,
      nodeOffsets: nextOffsets,
    });
  }

  const targetRef =
    extractScriptNumberFromNodeId(nodeId, workspace.modules) ||
    nodeId.replace(/^(?:S|JUMP|INC|SELF)_/, '');
  if (!targetRef) return workspace;
  const targetKey = canonicalScriptMatchKey(targetRef);

  const nextModules = workspace.modules
    .filter((m) => canonicalScriptMatchKey(m.scriptNumber) !== targetKey)
    .map((m) => ({
      ...m,
      rules: m.rules.map((r) => ({
        ...r,
        targetNumber:
          r.targetNumber && canonicalScriptMatchKey(r.targetNumber) === targetKey
            ? undefined
            : r.targetNumber,
        choices: r.choices.filter(
          (ch) => canonicalScriptMatchKey(ch.targetNumber) !== targetKey
        ),
      })),
    }));

  const nextExternal = (workspace.externalEndpoints || []).filter(
    (e) => canonicalScriptMatchKey(e) !== targetKey
  );
  const nextLinks = (workspace.manualLinks || []).filter(
    (l) =>
      canonicalScriptMatchKey(l.fromScriptNumber) !== targetKey &&
      canonicalScriptMatchKey(l.toTargetNumber) !== targetKey
  );
  const nextOffsets = { ...(workspace.nodeOffsets || {}) };
  delete nextOffsets[nodeId];
  delete nextOffsets[`S_${toMermaidNodeSuffix(targetRef)}`];

  return buildScriptWorkspace(nextModules, {
    ...workspace,
    externalEndpoints: nextExternal,
    manualLinks: nextLinks,
    nodeOffsets: nextOffsets,
  });
}



