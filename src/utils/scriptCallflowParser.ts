import {
  CallflowAnnouncementRegistryItem,
  CallflowBuildingBlockType,
  CallflowCrossRefRegistryItem,
  CallflowEdge,
  CallflowGraph,
  CallflowHealthFinding,
  CallflowIssueResolution,
  CallflowOpenIssue,
  CallflowParameterCategory,
  CallflowResourceRegistry,
  CallflowRoutingMatrixRow,
  CallflowScheduleSummaryRow,
  CallflowScriptParameterItem,
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
  return normalizeScriptRef(ref).replace(/\.s$/i, '').toLowerCase();
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

export function isDeactivatedSentinelTarget(token: string): boolean {
  const clean = normalizeScriptRef(token).toLowerCase();
  if (!clean) return true;
  return /^(?:0+|-1|none|null|empty|leer|inaktiv|deaktiviert|dummy|n\/?a|-+|_+)$/.test(clean);
}

export function isDynamicAvayaVariableTarget(token: string): boolean {
  const clean = normalizeScriptRef(token);
  if (!clean) return false;
  return /^(?:sys_|gv_|cv_|lv_|var_|call_var|default_)/i.test(clean);
}

export function isPlausibleNamedScriptTarget(token: string): boolean {
  const clean = normalizeScriptRef(token);
  if (!clean || clean.length < 3) return false;
  if (/^\d+$/.test(clean)) return false;
  if (isDeactivatedSentinelTarget(clean) || isDynamicAvayaVariableTarget(clean)) return false;
  if (/\.(?:wav|mp3|ogg|ulaw|alaw)$/i.test(clean)) return false;
  if (SCRIPT_NAME_STOPWORDS.has(clean.toLowerCase())) return false;
  return true;
}

export function isValidScriptRef(token: string): boolean {
  return isNumericScriptRef(token) || isPlausibleNamedScriptTarget(token);
}

export function isAnnouncementOrEndpointTargetName(token: string): boolean {
  const clean = normalizeScriptRef(token);
  if (!clean) return false;
  if (isDynamicAvayaVariableTarget(clean)) return true;
  if (/^(?:\+\d{5,}|00\d{5,}|0\d{6,}|\d{7,})$/.test(clean)) return true;
  if (/\.(?:wav|mp3|ogg|ulaw|alaw|vox|au)$/i.test(clean)) return true;
  return /(?:^|[_.\-\s])(?:sonderansage|ansage|ansagen|ran|prompt|voice(?:[\s_-]*segment)?|wav|audio|musik|music|wartemusik|treatment|busy|ringback|disconnect|drop|abwurf|mailbox|voicemail|anrufbeantworter|ab|fax|ivr|skillset|queue|warteschlange|hunt|trunk|pilot|extern|external|hotline|vdn|acd|geschlossen|nacht(?:schaltung)?|feiertag(?:sansage)?|st[oö]rung(?:sansage)?|stoerung(?:sansage)?|wartung(?:sansage)?|info(?:ansage|text)?|text(?:ansage)?|ende|endpunkt)(?:$|[_.\-\s\d])/i.test(
    clean
  );
}

export function formatScriptDisplayLabel(
  mod: Pick<ScriptModule, 'scriptNumber' | 'scriptName' | 'isMaster' | 'cdnAlias'>
): string {
  const numKey = canonicalScriptMatchKey(mod.scriptNumber || '');
  if (numKey === 'main' || (mod.isMaster && /^(?:main|start|master(?:script)?)$/i.test(numKey))) {
    return 'Main';
  }
  const cleanName = (mod.scriptName || '').trim();
  const hasDistinctName =
    cleanName &&
    canonicalScriptMatchKey(cleanName) !== numKey &&
    cleanName !== `Skript ${mod.scriptNumber}` &&
    cleanName !== 'Main (Masterscript)';
  return hasDistinctName ? `[${mod.scriptNumber}] ${cleanName}` : `[${mod.scriptNumber}]`;
}

export function promoteEntryModuleToMain(
  modules: ScriptModule[],
  preferredEntryNumber?: string
): ScriptModule[] {
  if (modules.length === 0) return modules;
  const prefKey = preferredEntryNumber ? canonicalScriptMatchKey(preferredEntryNumber) : '';
  let entryIdx = prefKey
    ? modules.findIndex(
        (m) =>
          canonicalScriptMatchKey(m.scriptNumber) === prefKey ||
          (m.cdnAlias && canonicalScriptMatchKey(m.cdnAlias) === prefKey)
      )
    : -1;
  if (entryIdx < 0) {
    entryIdx = modules.findIndex(
      (m) => canonicalScriptMatchKey(m.scriptNumber) === 'main' || m.isMaster
    );
  }
  if (entryIdx < 0) entryIdx = 0;

  return modules.map((m, idx) => {
    if (idx !== entryIdx) return m;
    const origKey = canonicalScriptMatchKey(m.scriptNumber);
    const preserveAsAlias =
      m.cdnAlias ||
      (origKey && !/^(?:main|start|master(?:script)?)$/i.test(origKey)
        ? m.scriptNumber
        : undefined);
    const updatedRules = m.rules.map((r) => ({
      ...r,
      sourceNumber: 'Main',
    }));
    const filteredOutgoing = m.outgoingNumbers.filter((t) => {
      const tk = canonicalScriptMatchKey(t);
      return tk !== 'main' && (!preserveAsAlias || tk !== canonicalScriptMatchKey(preserveAsAlias));
    });
    return {
      ...m,
      scriptNumber: 'Main',
      scriptName: 'Main',
      cdnAlias: preserveAsAlias,
      isMaster: true,
      rules: updatedRules,
      outgoingNumbers: filteredOutgoing,
    };
  });
}

export function isPureMasterDispatcherModule(
  mod: ScriptModule,
  _totalModulesCount?: number
): boolean {
  const key = canonicalScriptMatchKey(mod.scriptNumber);
  const nameKey = canonicalScriptMatchKey(mod.scriptName || '');
  const isExplicitMainName =
    /^(?:main|master(?:script)?|master_routing|0000)$/i.test(key) ||
    /^(?:main|master(?:script|\s*callflow)?)$/i.test(nameKey) ||
    /\(masterscript\)/i.test(mod.scriptName || '');
  if (!mod.isMaster && !isExplicitMainName) return false;
  const hasOwnSkillsetQueue = mod.rules.some(
    (r) => Boolean(r.queueTarget && r.queueTarget !== 'Default_Skillset')
  );
  if (hasOwnSkillsetQueue) return false;
  if (hasAaccMasterRoutingSignals(mod.rawText || '')) {
    return true;
  }
  const dispatchValueRulesCount = mod.rules.filter((r) =>
    Boolean((r.valueNumbers && r.valueNumbers.length > 0) || r.orgaCode)
  ).length;
  return dispatchValueRulesCount >= 4;
}

function sanitizeMermaidText(text: string): string {
  return text
    .replace(/\\/g, '/')
    .replace(/"/g, "'")
    .replace(/#/g, 'Nr.')
    .replace(/>=/g, '≥')
    .replace(/<=/g, '≤')
    .replace(/<>/g, '≠')
    .replace(/>/g, '›')
    .replace(/</g, '‹')
    .replace(/[;|]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeMermaidEdgeLabel(text: string): string {
  const cleaned = text
    .replace(/\\/g, '/')
    .replace(/"/g, "'")
    .replace(/\|/g, '/')
    .replace(/#/g, 'Nr.')
    .replace(/>=/g, '≥')
    .replace(/<=/g, '≤')
    .replace(/<>/g, '≠')
    .replace(/>/g, '›')
    .replace(/</g, '‹')
    .replace(/[;\[\]{}]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? `|"${cleaned}"|` : '';
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

function extractScriptHeaderFromCommentBlock(commentText: string): string | null {
  const kvMatch = commentText.match(
    /\b(?:script\s*name|scriptname|skript(?:\s*name)?|script|application(?:\s*name)?|modul(?:name)?|dateiname|file(?:name)?)\s*[:=]\s*["']?([A-Za-z0-9ÄÖÜäöüß_.-]{2,80})["']?/i
  );
  if (kvMatch?.[1]) {
    const clean = kvMatch[1].trim().replace(/\.s$/i, '').trim();
    if (clean && isValidScriptRef(clean)) return clean;
  }
  const dotSMatch = commentText.match(/(?:^|[\s*=-])([A-Za-z0-9ÄÖÜäöüß_-]{3,60})\.s(?:$|[\s*=-])/i);
  if (dotSMatch?.[1] && isValidScriptRef(dotSMatch[1])) {
    return dotSMatch[1].trim();
  }
  const singleToken = commentText
    .replace(/^[\s*=\-#/]+|[\s*=\-#/]+$/g, '')
    .trim()
    .replace(/\.s$/i, '')
    .trim();
  if (
    singleToken &&
    /^[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_-]{2,60}$/.test(singleToken) &&
    isValidScriptRef(singleToken) &&
    !isMetadataOrChangelogLine(singleToken)
  ) {
    return singleToken;
  }
  return null;
}

/**
 * Strips /* ... * / comments safely (including multi-line, nested /* /* ... * / * /,
 * and unclosed /* ... EOF alt-last blocks) while preserving line breaks and extracting
 * embedded script boundary headers (`Script Name: ...` or `<Script>.s`) outside the comment.
 */
function stripBlockCommentsSafely(input: string): string {
  let result = '';
  let commentBuffer = '';
  let i = 0;
  let depth = 0;
  const len = input.length;

  while (i < len) {
    const two = input.slice(i, i + 2);
    if (two === '/*') {
      if (depth === 0) {
        commentBuffer = '';
      }
      depth += 1;
      i += 2;
      continue;
    }
    if (two === '*/' && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        const extractedHeader = extractScriptHeaderFromCommentBlock(commentBuffer);
        if (extractedHeader) {
          result += `\n=== ${extractedHeader} ===\n`;
        } else {
          result += ' ';
        }
        commentBuffer = '';
      }
      i += 2;
      continue;
    }
    if (depth > 0) {
      commentBuffer += input[i];
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

function preserveMultiScriptHeadersInComments(rawText: string): string {
  return rawText.replace(
    /^(?:\/\/\s*|#\s*|--\s*)?\b(?:script\s*name|scriptname|skript(?:\s*name)?|script|application(?:\s*name)?|dateiname|file(?:name)?)\s*[:=]\s*["']?([A-Za-z0-9ÄÖÜäöüß_.-]{2,80})["']?\s*$/gim,
    (_m, rawName: string) => {
      const clean = rawName.trim().replace(/\.s$/i, '').trim();
      return clean ? `\n=== ${clean} ===\n` : _m;
    }
  );
}

/**
 * Strips multi-line /* ... * / and (* ... *) comments, inline // or -- comments,
 * and changelog/revision metadata lines before parsing active routing logic.
 */
function stripScriptCommentsAndNoise(rawText: string): string {
  const withPreservedMultiHeaders = preserveMultiScriptHeadersInComments(rawText);
  const withoutBlockComments = stripBlockCommentsSafely(withPreservedMultiHeaders)
    .replace(/\(\*[\s\S]*?\*\)/g, (match) => {
      const hdr = extractScriptHeaderFromCommentBlock(match);
      if (hdr) return `\n=== ${hdr} ===\n`;
      return match.includes('\n') ? '\n' : ' ';
    });

  return withoutBlockComments
    .split(/\r?\n/)
    .map((line) => {
      const inlineHeaderMatch = line.match(
        /^\s*(?:\/\/|--|#)\s*(?:(?:script\s*name|scriptname|skript(?:\s*name)?|script|application(?:\s*name)?|dateiname|file(?:name)?)\s*[:=]\s*["']?([A-Za-z0-9ÄÖÜäöüß_.-]{2,80})["']?|[=\-*#\s]*([A-Za-z0-9ÄÖÜäöüß_-]{3,60})\.s[=\-*#\s]*)\s*$/i
      );
      if (inlineHeaderMatch) {
        const hdrName = (inlineHeaderMatch[1] || inlineHeaderMatch[2] || '')
          .trim()
          .replace(/\.s$/i, '')
          .trim();
        if (hdrName && isValidScriptRef(hdrName)) {
          return `=== ${hdrName} ===`;
        }
      }
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

const TEAM_OR_FUNCTION_NAME_GUARD =
  /^(?:team|skillset|service|kundenservice|vertrieb|schaden|vertrag|leistung|inkasso|hotline|backoffice|zentrale|empfang|rechtsschutz|kfz|leben|kranken|komposit|makler|agentur|partner|ueberlauf|überlauf|overflow|nacht|feiertag|sondzeit|fax|faxrouting|ansage|men[uü]|auswahl|default|main|master)$/i;

export function isLikelyTeamOrDepartmentName(name: string | undefined): boolean {
  if (!name) return false;
  const clean = name.trim().replace(/^_+|_+$/g, '');
  if (!clean) return true;
  if (TEAM_OR_FUNCTION_NAME_GUARD.test(clean)) return true;
  if (/^(?:s|q|nq|ag|sk|team|skill|abt)_/i.test(clean)) return true;
  return false;
}

function detectOrgaFromText(text: string | undefined): {
  organizationName?: string;
  orgaCode?: string;
} {
  if (!text) return {};
  const cleaned = text.trim();
  if (!cleaned) return {};

  let orgaCode: string | undefined;
  let organizationName: string | undefined;

  // 1. Generic route number prefix mask (e.g. "290xxxx", "100xxx", "01234 500xxxx")
  const maskedRouteMatch = cleaned.match(
    /(?:^|[^0-9])(?:\d{3,6}[\s\-/]+)?(\d{2,5})[xX*]{2,6}(?=$|[^0-9A-Za-z])/
  );
  if (maskedRouteMatch && maskedRouteMatch[1]) {
    orgaCode = maskedRouteMatch[1];
  }

  // 2. Generic DNIS_Range_<Organization> or Mandant_<Organization> identifier
  const dnisRangeMatch = cleaned.match(
    /\b(?:DNIS_Range|Mandant|Orga|Brand|Gesellschaft)_([A-Za-z0-9ÄÖÜäöüß_-]{2,40})\b/i
  );
  if (dnisRangeMatch && dnisRangeMatch[1]) {
    const rawName = dnisRangeMatch[1].replace(/^_+|_+$/g, '');
    if (rawName && !/^\d+$/.test(rawName) && !isLikelyTeamOrDepartmentName(rawName)) {
      organizationName = rawName;
    }
  }

  return {
    ...(orgaCode ? { orgaCode } : {}),
    ...(organizationName ? { organizationName } : {}),
  };
}

export interface DiscoveredOrgaRule {
  id: string;
  organizationName: string;
  orgaCode: string;
  srcRouteNumber?: string;
  matchedCount: number;
  enabled: boolean;
}

export function extractDiscoveredOrganizationsFromModules(
  modules: ScriptModule[]
): DiscoveredOrgaRule[] {
  const byKey = new Map<string, DiscoveredOrgaRule>();

  const upsert = (name?: string, code?: string, route?: string, increment = 1) => {
    const cleanName = (name || '').trim();
    const cleanCode = (code || '').trim().replace(/[xX*]+$/g, '');
    if (!cleanName && !cleanCode) return;
    if (cleanName && isLikelyTeamOrDepartmentName(cleanName) && !cleanCode) return;

    // Try finding existing entry by code or by name
    let matchKey = '';
    for (const [k, existing] of byKey.entries()) {
      if (cleanCode && existing.orgaCode && existing.orgaCode === cleanCode) {
        matchKey = k;
        break;
      }
      if (
        cleanName &&
        existing.organizationName &&
        canonicalScriptMatchKey(existing.organizationName) === canonicalScriptMatchKey(cleanName)
      ) {
        matchKey = k;
        break;
      }
    }

    if (!matchKey) {
      matchKey = canonicalScriptMatchKey(cleanCode || cleanName);
      byKey.set(matchKey, {
        id: `orga-${matchKey}-${byKey.size + 1}`,
        organizationName: cleanName || (cleanCode ? `Gesellschaft ${cleanCode}` : 'Gesellschaft'),
        orgaCode: cleanCode,
        srcRouteNumber: route || (cleanCode ? `${cleanCode}xxxx` : undefined),
        matchedCount: increment,
        enabled: true,
      });
    } else {
      const prev = byKey.get(matchKey)!;
      byKey.set(matchKey, {
        ...prev,
        organizationName:
          cleanName && !/^Gesellschaft\s+\d+$/i.test(cleanName)
            ? cleanName
            : prev.organizationName,
        orgaCode: cleanCode || prev.orgaCode,
        srcRouteNumber: route || prev.srcRouteNumber,
        matchedCount: prev.matchedCount + increment,
      });
    }
  };

  modules.forEach((mod) => {
    if (mod.entryOrganizationName && !isLikelyTeamOrDepartmentName(mod.entryOrganizationName)) {
      upsert(mod.entryOrganizationName, undefined, undefined, 1);
    }
    mod.rules.forEach((r) => {
      const effectiveName = r.organizationName || r.brandName;
      const effectiveCode =
        r.orgaCode ||
        (r.srcRouteNumber
          ? r.srcRouteNumber.match(/(\d{2,5})[xX*]{2,6}/)?.[1]
          : undefined);
      if (effectiveName || effectiveCode) {
        upsert(effectiveName, effectiveCode, r.srcRouteNumber, 1);
      }
    });
  });

  return Array.from(byKey.values());
}

export function applyConfirmedOrgaRulesToModules(
  modules: ScriptModule[],
  orgaRules: DiscoveredOrgaRule[]
): ScriptModule[] {
  const activeRules = orgaRules.filter(
    (r) => r.enabled && (r.organizationName.trim() || r.orgaCode.trim())
  );
  if (activeRules.length === 0) return modules;

  const matchNumberToOrga = (numStr: string): DiscoveredOrgaRule | undefined => {
    const digits = numStr.replace(/\D+/g, '');
    if (!digits) return undefined;
    // Sort by longest prefix first (e.g. 6099 before 290)
    const sorted = [...activeRules]
      .filter((r) => r.orgaCode.trim().length > 0)
      .sort((a, b) => b.orgaCode.trim().length - a.orgaCode.trim().length);
    for (const rule of sorted) {
      const code = rule.orgaCode.trim().replace(/\D+/g, '');
      if (!code) continue;
      if (digits.startsWith(code)) return rule;
      // Also match after an area code prefix (e.g. 4-6 digit area code + orgaCode)
      const idx = digits.indexOf(code);
      if (idx >= 3 && idx <= 6 && digits.length - idx >= code.length + 2) {
        return rule;
      }
    }
    return undefined;
  };

  const matchTextToOrga = (text: string | undefined): DiscoveredOrgaRule | undefined => {
    if (!text) return undefined;
    for (const rule of activeRules) {
      const name = rule.organizationName.trim();
      if (name && name.length >= 2) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, 'i').test(text)) {
          return rule;
        }
      }
    }
    return undefined;
  };

  // Track which organization calls which target script from Main/Dispatcher
  const targetScriptOrgaMap = new Map<string, DiscoveredOrgaRule>();

  const firstPass = modules.map((mod) => {
    const updatedRules = mod.rules.map((r) => {
      let matched: DiscoveredOrgaRule | undefined;
      if (r.orgaCode) {
        matched = activeRules.find((ar) => ar.orgaCode.trim() === r.orgaCode?.trim());
      }
      if (!matched && (r.organizationName || r.brandName)) {
        matched = matchTextToOrga(`${r.organizationName || ''} ${r.brandName || ''}`);
      }
      if (!matched && r.valueNumbers && r.valueNumbers.length > 0) {
        for (const v of r.valueNumbers) {
          matched = matchNumberToOrga(v);
          if (matched) break;
        }
      }
      if (!matched && r.targetNumber) {
        matched = matchTextToOrga(r.targetNumber);
      }

      if (matched) {
        const orgName = matched.organizationName.trim();
        const orgCode = matched.orgaCode.trim();
        if (r.targetNumber) {
          targetScriptOrgaMap.set(canonicalScriptMatchKey(r.targetNumber), matched);
        }
        r.choices.forEach((ch) => {
          if (ch.targetNumber) {
            targetScriptOrgaMap.set(canonicalScriptMatchKey(ch.targetNumber), matched!);
          }
        });
        return {
          ...r,
          organizationName: orgName || r.organizationName,
          brandName: orgName || r.brandName,
          orgaCode: orgCode || r.orgaCode,
          srcRouteNumber:
            matched.srcRouteNumber || (orgCode ? `${orgCode}xxxx` : r.srcRouteNumber),
        };
      }

      // If previous organizationName was disabled/removed by user in wizard, clear it
      if (r.organizationName || r.brandName) {
        const stillEnabled = activeRules.some(
          (ar) =>
            canonicalScriptMatchKey(ar.organizationName) ===
            canonicalScriptMatchKey(r.organizationName || r.brandName || '')
        );
        if (!stillEnabled) {
          return {
            ...r,
            organizationName: undefined,
            brandName: undefined,
            orgaCode: undefined,
          };
        }
      }

      return r;
    });

    return {
      ...mod,
      rules: updatedRules,
    };
  });

  return firstPass.map((mod) => {
    const mKey = canonicalScriptMatchKey(mod.scriptNumber);
    const inherited =
      targetScriptOrgaMap.get(mKey) ||
      (mod.cdnAlias ? targetScriptOrgaMap.get(canonicalScriptMatchKey(mod.cdnAlias)) : undefined) ||
      matchTextToOrga(mod.scriptNumber) ||
      matchTextToOrga(mod.scriptName);

    if (inherited) {
      return {
        ...mod,
        entryOrganizationName: inherited.organizationName.trim(),
      };
    }
    return mod;
  });
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
    /\bassign\s+([^\r\n;]+?)\s+to\s+([A-Za-z0-9_]+)(?=\s*(?:assign\b|end\s*if\b|endif\b|else\b|execute\b|give\b|queue\b|route\b|transfer\b|disconnect\b|wait\b|;|$))/gim;
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
    /\bsection\s+["']?[A-Za-z0-9ÄÖÜäöüß_.-]+["']?/i.test(cleaned) ||
    /\bCDN\s*[:=]?\s*\d{3,6}\b/i.test(cleaned) ||
    /\bassign\b[\s\S]{1,120}\bto\s+(?:Sys_[A-Za-z0-9_]+|src_route_number|[A-Za-z_][A-Za-z0-9_]*)\b/i.test(
      cleaned
    ) ||
    /\b(?:Sys_Team_Skillset|Sys_Ueberlauf_Skillset|Sys_Retour_Zentrale|Sys_SondStat|Sys_SondZeit|Sys_brand|src_route_number)\b/i.test(
      cleaned
    ) ||
    /\b(?:queue\s+to|route\s+(?:call|target|end)|give\s+(?:announcement|ran|ivr|music|cdn|script|ringback|treatment|overflow|busy|controlled\s+broadcast|aura\s+recording|silence)|transfer\s+to|execute(?:\s+script)?)\b/i.test(
      cleaned
    ) ||
    /\b(?:readvar|send\s+info|logged\s+in\s+agents|idle\s+agents|expected\s+wait\s+time|calls\s+waiting|queue\s+length|oldest\s+call|not\s+queued|out\s+of\s+service)\b/i.test(
      cleaned
    ) ||
    /\b(?:open\s+voice\s+session|end\s+voice\s+session|play\s+prompt|voice\s+segment|collect\s+\d+\s+digits)\b/i.test(
      cleaned
    ) ||
    /\b(?:event\s+(?:handler|call\s+abandon)|end\s+where|end\s+section|disconnect|drop\s+call)\b/i.test(
      cleaned
    ) ||
    /\bVALUE\s+['"]?[0-9A-Za-z*#_.-]{1,15}['"]?\s*[:=]/i.test(cleaned) ||
    /\b(?:DNIS_Range[A-Za-z0-9_]*|WHERE\s+(?:DNIS|CDN|CLID|CALLING|CALLED|src_route_number|[A-Za-z0-9_]+)\b)/i.test(
      cleaned
    ) ||
    /\bif\b[\s\S]{1,160}\bthen\b/i.test(cleaned)
  );
}

function hasAaccMasterRoutingSignals(text: string): boolean {
  const valueDispatchMatches = text.match(
    /\bVALUE\s+['"]?[0-9xX*]{3,15}['"]?\s*:\s*(?:execute|call|route|transfer)\b/gi
  );
  if (valueDispatchMatches && valueDispatchMatches.length >= 2) {
    return true;
  }
  return (
    /\bDNIS_Range[A-Za-z0-9_]*\b/i.test(text) &&
    /\bVALUE\s+['"]?[0-9xX*]{2,15}['"]?\s*[:=]/i.test(text)
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

const DAY_TOKEN_MAP: Record<string, string> = {
  monday: 'Mo',
  mon: 'Mo',
  montag: 'Mo',
  mo: 'Mo',
  tuesday: 'Di',
  tue: 'Di',
  dienstag: 'Di',
  di: 'Di',
  wednesday: 'Mi',
  wed: 'Mi',
  mittwoch: 'Mi',
  mi: 'Mi',
  thursday: 'Do',
  thu: 'Do',
  donnerstag: 'Do',
  do: 'Do',
  friday: 'Fr',
  fri: 'Fr',
  freitag: 'Fr',
  fr: 'Fr',
  saturday: 'Sa',
  sat: 'Sa',
  samstag: 'Sa',
  sa: 'Sa',
  sunday: 'So',
  sun: 'So',
  sonntag: 'So',
  so: 'So',
};

function normalizeDayToken(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\.$/, '');
  return DAY_TOKEN_MAP[key] || raw.trim();
}

function normalizeClockToken(raw: string): string {
  const m = raw.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return raw.trim();
  const hh = m[1].padStart(2, '0');
  const mm = m[2] || '00';
  return `${hh}:${mm}`;
}

/**
 * Extracts human-readable opening hours (`schedule`) and holiday/special state (`holiday`)
 * from Avaya OCL conditions (`DAY OF WEEK`, `TIME OF DAY`, `HOLIDAY`, `Sys_SondZeit`) or German prose.
 */
export function extractReadableScheduleAndHolidayFromText(rawText: string): {
  schedule?: string;
  holiday?: string;
} {
  if (!rawText) return {};
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (!text) return {};

  const scheduleParts: string[] = [];
  const holidayParts: string[] = [];

  // 1. AACC `DAY OF WEEK` ranges / lists (e.g. `DAY OF WEEK EQUALS MONDAY..FRIDAY` or `DAY OF WEEK IN SATURDAY, SUNDAY`)
  const dowRangeMatch = text.match(
    /\bday\s+of\s+week\s*(?:equals|is|in|=|:)?\s*([A-Za-zÄÖÜäöüß]+)\s*(?:\.\.|to|bis|-|–)\s*([A-Za-zÄÖÜäöüß]+)/i
  );
  if (dowRangeMatch) {
    scheduleParts.push(
      `${normalizeDayToken(dowRangeMatch[1])}–${normalizeDayToken(dowRangeMatch[2])}`
    );
  } else {
    const dowSingleMatch = text.match(
      /\bday\s+of\s+week\s*(?:equals|is|in|=|:)?\s*([A-Za-zÄÖÜäöüß]+(?:\s*(?:,|or|oder)\s*[A-Za-zÄÖÜäöüß]+)*)/i
    );
    if (dowSingleMatch) {
      const days = dowSingleMatch[1]
        .split(/\s*(?:,|or|oder)\s*/i)
        .map(normalizeDayToken)
        .filter(Boolean);
      if (days.length > 0) scheduleParts.push(days.join(', '));
    }
  }

  // 2. German day ranges (e.g. `Mo-Fr`, `Mo - Do`, `Montag bis Freitag`, `Sa-So`)
  if (scheduleParts.length === 0) {
    const deDayRange = text.match(
      /\b(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Mo|Di|Mi|Do|Fr|Sa|So)\.?[\s]*(?:-+|–|\.\.|bis|to)[\s]*(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|Mo|Di|Mi|Do|Fr|Sa|So)\b/i
    );
    if (deDayRange) {
      scheduleParts.push(`${normalizeDayToken(deDayRange[1])}–${normalizeDayToken(deDayRange[2])}`);
    }
  }

  // 3. AACC `TIME OF DAY` or general clock range (`08:00..17:00`, `08:00 TO 18:00`, `08:00-17:00`)
  const todRangeMatch = text.match(
    /\b(?:time\s+of\s+day\s*(?:equals|is|in|=|:)?\s*)?(\d{1,2}[:.]\d{2})\s*(?:\.\.|to|bis|-|–)\s*(\d{1,2}[:.]\d{2})(?:\s*Uhr)?/i
  );
  if (todRangeMatch) {
    scheduleParts.push(
      `${normalizeClockToken(todRangeMatch[1])}–${normalizeClockToken(todRangeMatch[2])}`
    );
  } else {
    const todCompareMatch = text.match(
      /\btime\s+of\s+day\s*(<=|<|>=|>|before|after)\s*(\d{1,2}(?:[:.]\d{2})?)/i
    );
    if (todCompareMatch) {
      const op = todCompareMatch[1].toLowerCase();
      const prefix = op === 'before' || op === '<' || op === '<=' ? 'vor ' : 'ab ';
      scheduleParts.push(`${prefix}${normalizeClockToken(todCompareMatch[2])} Uhr`);
    } else {
      const shortUhrRange = text.match(
        /\b(\d{1,2})\s*(?:-+|–|bis)\s*(\d{1,2})\s*Uhr\b/i
      );
      if (shortUhrRange) {
        scheduleParts.push(
          `${normalizeClockToken(shortUhrRange[1])}–${normalizeClockToken(shortUhrRange[2])}`
        );
      }
    }
  }

  // 4. Explicit keywords for business hours / after-hours if no exact clock was given
  if (
    scheduleParts.length === 0 &&
    /\b(?:out\s+of\s+hours|after\s+hours|au[sß]erhalb\s+der\s+[oö]ffnungszeiten|geschlossen|nachtschaltung|wochenende)\b/i.test(
      text
    )
  ) {
    if (/\bwochenende\b/i.test(text)) {
      scheduleParts.push('Wochenende (Sa–So)');
    } else if (/\bnachtschaltung\b/i.test(text)) {
      scheduleParts.push('Nachtschaltung');
    } else {
      scheduleParts.push('Außerhalb Öffnungszeiten');
    }
  }

  // 5. Holiday / Special status detection
  if (/\b(?:feiertag(?:e|sliste|spr[uü]fung)?|holiday|bundesfeiertag|sondertag)\b/i.test(text)) {
    const notHol = /\b(?:not\s+holiday|kein\s+feiertag)\b/i.test(text);
    holidayParts.push(notHol ? 'Kein Feiertag (Regulär)' : 'Feiertags-Prüfung aktiv');
  }
  const sondMatch = text.match(/\b(Sys_Sond(?:Stat|Routing))\s*(?:[:=]\s*([^\s·,;]+))?/i);
  if (sondMatch) {
    holidayParts.push(
      sondMatch[2] ? `${sondMatch[1]}=${sondMatch[2]}` : sondMatch[1]
    );
  }

  if (scheduleParts.length === 0) {
    const sondZeitMatch = text.match(
      /\bSys_SondZeit\s*(?:[:=]|to)\s*["']?([A-Za-z0-9_.-]+)["']?/i
    );
    if (sondZeitMatch) {
      const rawVal = sondZeitMatch[1];
      const fromName = extractScheduleFromSondZeitName(rawVal);
      if (fromName) {
        scheduleParts.push(`${fromName} (${rawVal})`);
      } else {
        scheduleParts.push(rawVal);
      }
    }
  }

  return {
    schedule: scheduleParts.length > 0 ? scheduleParts.join(' ') : undefined,
    holiday: holidayParts.length > 0 ? holidayParts.join(' · ') : undefined,
  };
}

/**
 * Extracts opening days and clock times from a script or variable name
 * (e.g., `SondZeit_08_17`, `SondZeit_MoFr_0800_1630`, `SondZeit_0730_1800`, `SondZeit_Mo_Fr_8bis18`, `SondZeit_24_7`).
 */
export function extractScheduleFromSondZeitName(rawName: string): string | null {
  if (!rawName) return null;
  const clean = rawName.trim().replace(/^['"]|['"]$/g, '');
  if (!clean) return null;

  // 1. 24/7 or round-the-clock indications
  if (/(?:^|[^a-zA-Z0-9])(?:24h|24[_\-.]?7|24std|rund[_\-.]?um[_\-.]?die[_\-.]?uhr)(?:[^a-zA-Z0-9]|$)/i.test(clean)) {
    return '24/7 (Rund um die Uhr)';
  }

  // 2. Multi-block detection, e.g., `Mo_Do_08_17_Fr_08_15`
  const multiBlockSplit = clean.split(/(?=[_.-](?:Fr|Sa|So)[_.-])/i);
  if (multiBlockSplit.length > 1) {
    const parsedSub = multiBlockSplit
      .map((sub) => extractScheduleFromSondZeitName(sub))
      .filter(Boolean);
    if (parsedSub.length > 1) {
      return parsedSub.join(', ');
    }
  }

  // Day prefix check
  let dayPrefix = '';
  if (/(?:^|[_\-.])(?:werktags?|wt)(?:[_\-.]|$)/i.test(clean)) {
    dayPrefix = 'Mo–Fr ';
  } else if (/(?:^|[_\-.])wochenende(?:[_\-.]|$)/i.test(clean)) {
    dayPrefix = 'Sa–So ';
  } else {
    const dayTokensRegex =
      /(?:^|[_\-.])(Mo(?:ntag)?|Di(?:enstag)?|Mi(?:ttwoch)?|Do(?:nnerstag)?|Fr(?:eitag)?|Sa(?:mstag)?|So(?:nntag)?)[_\-.]*(?:bis|to|[_\-.])?[_\-.]*(Mo(?:ntag)?|Di(?:enstag)?|Mi(?:ttwoch)?|Do(?:nnerstag)?|Fr(?:eitag)?|Sa(?:mstag)?|So(?:nntag)?)(?:[_\-.]|$)/i;
    const singleDayRegex =
      /(?:^|[_\-.])(Mo(?:ntag)?|Di(?:enstag)?|Mi(?:ttwoch)?|Do(?:nnerstag)?|Fr(?:eitag)?|Sa(?:mstag)?|So(?:nntag)?)(?:[_\-.]|$)/i;

    const rangeMatch = clean.match(dayTokensRegex);
    if (rangeMatch) {
      dayPrefix = `${normalizeDayToken(rangeMatch[1])}–${normalizeDayToken(rangeMatch[2])} `;
    } else {
      const singleMatch = clean.match(singleDayRegex);
      if (singleMatch) {
        dayPrefix = `${normalizeDayToken(singleMatch[1])} `;
      }
    }
  }

  // 3. 4-digit time pairs, e.g. 0800_1700 or 0730_1830 or 0800-1630 or 0800bis1700
  const fourDigitMatch = clean.match(
    /(?:^|[_\-.a-zA-Z])([0-2]\d[0-5]\d)[_\-.]*(?:bis|to|[_\-.])+[_\-.]*([0-2]\d[0-5]\d)(?:[_\-.a-zA-Z]|$)/i
  );
  if (fourDigitMatch) {
    const sH = fourDigitMatch[1].slice(0, 2);
    const sM = fourDigitMatch[1].slice(2);
    const eH = fourDigitMatch[2].slice(0, 2);
    const eM = fourDigitMatch[2].slice(2);
    return `${dayPrefix}${sH}:${sM}–${eH}:${eM}`.trim();
  }

  // 4. 1-2 digit hour pairs, e.g. 08_17, 8_18, 08-18, 8bis17, 0800_17
  const hourMatch = clean.match(
    /(?:^|[_\-.a-zA-Z])([0-2]?\d)(?:[:.]?([0-5]\d))?[_\-.]*(?:bis|to|[_\-.])+[_\-.]*([0-2]?\d)(?:[:.]?([0-5]\d))?(?:[_\-.a-zA-Z]|$)/i
  );
  if (hourMatch) {
    const h1 = parseInt(hourMatch[1], 10);
    const m1 = hourMatch[2] || '00';
    const h2 = parseInt(hourMatch[3], 10);
    const m2 = hourMatch[4] || '00';
    if (
      !isNaN(h1) &&
      !isNaN(h2) &&
      h1 >= 0 &&
      h1 <= 24 &&
      h2 >= 0 &&
      h2 <= 24 &&
      (h1 < h2 || (h1 === h2 && m1 < m2))
    ) {
      const sH = String(h1).padStart(2, '0');
      const eH = String(h2).padStart(2, '0');
      return `${dayPrefix}${sH}:${m1}–${eH}:${m2}`.trim();
    }
  }

  return null;
}

/**
 * Resolves a schedule string or SondZeit script reference to concrete human-readable clock times.
 * Follows the 3-step hierarchy confirmed by user:
 * 1. Current script's internal TIME OF DAY / DAY OF WEEK rules or prose.
 * 2. Lookup of the referenced SondZeit module within the workspace.
 * 3. Pattern extraction from the SondZeit script/variable name (e.g. `_08_17` -> `08:00–17:00`).
 * 4. Fallback to clean script reference if no times can be derived.
 *
 * Formats result as: `[Wochentage] [Uhrzeiten] ([SondZeit-Referenz])`
 */
export function resolveScheduleWithSondZeit(
  rawSchedule: string | undefined,
  currentMod?: ScriptModule,
  workspace?: ScriptWorkspace
): {
  displayText: string;
  hasSchedule: boolean;
  hasConcreteTimes: boolean;
  scriptReference?: string;
  pureTimes?: string;
} {
  const schedStr = (rawSchedule || '').trim().replace(/^['"]|['"]$/g, '');

  // Guard: if already resolved and formatted like `Mo–Fr 08:00–17:00 (SondZeit_...)`, return directly
  const alreadyResolvedMatch = schedStr.match(/^(.*?)\s*\(([A-Za-z0-9_.-]+)\)$/);
  if (alreadyResolvedMatch && /\b(?:\d{1,2}[:.]\d{2}|24\/7)\b/i.test(alreadyResolvedMatch[1])) {
    return {
      displayText: schedStr,
      hasSchedule: true,
      hasConcreteTimes: true,
      scriptReference: alreadyResolvedMatch[2],
      pureTimes: alreadyResolvedMatch[1].trim(),
    };
  }

  const hasClockTime = /\b(?:\d{1,2}[:.]\d{2}|vor\s+\d{1,2}|ab\s+\d{1,2}|24\/7)\b/i.test(schedStr);
  const isSondZeitRef =
    /\b(?:sondzeit|sondstat|sondrouting|zeitplan|sonderzeit)\b/i.test(schedStr) ||
    (!hasClockTime &&
      schedStr.length > 0 &&
      !/\b(?:wochenende|nachtschaltung|feiertag|keine\s+zeit)\b/i.test(schedStr));

  // If it already has clock times and does NOT mention a raw SondZeit placeholder, return as-is
  if (hasClockTime && !isSondZeitRef) {
    return {
      displayText: schedStr,
      hasSchedule: true,
      hasConcreteTimes: true,
      pureTimes: schedStr,
    };
  }

  // Identify candidate SondZeit reference
  let sondRef = schedStr;
  if (!sondRef && currentMod) {
    const ruleSond = currentMod.rules.find(
      (r) => r.schedule && !/\b\d{1,2}[:.]\d{2}\b/.test(r.schedule)
    )?.schedule;
    if (ruleSond) {
      sondRef = ruleSond.trim().replace(/^['"]|['"]$/g, '');
    } else if (currentMod.rawText) {
      const matchAssign = currentMod.rawText.match(
        /\bassign\s+["']?([A-Za-z0-9_.-]+)["']?\s+to\s+Sys_SondZeit\b/i
      );
      const matchDirect = currentMod.rawText.match(
        /\bSys_SondZeit\s*[:=]\s*["']?([A-Za-z0-9_.-]+)["']?/i
      );
      const matchExec = currentMod.rawText.match(
        /\bexecute(?:\s+script)?\s+["']?(SondZeit[A-Za-z0-9_.-]*)["']?/i
      );
      sondRef = matchAssign?.[1] || matchDirect?.[1] || matchExec?.[1] || '';
    }
  }

  // 1. Current Script Direct Check: Check if currentMod contains concrete times in any of its rules or in rawText
  let directTimes: string | null = null;
  if (currentMod) {
    for (const r of currentMod.rules) {
      if (r.schedule && /\b\d{1,2}[:.]\d{2}\b/.test(r.schedule)) {
        directTimes = r.schedule.trim();
        break;
      }
      const det = extractReadableScheduleAndHolidayFromText(r.condition || '');
      if (det.schedule && /\b\d{1,2}[:.]\d{2}\b/.test(det.schedule)) {
        directTimes = det.schedule.trim();
        break;
      }
    }
    if (!directTimes && currentMod.rawText) {
      const fromText = extractReadableScheduleAndHolidayFromText(currentMod.rawText);
      if (fromText.schedule && /\b\d{1,2}[:.]\d{2}\b/.test(fromText.schedule)) {
        directTimes = fromText.schedule.trim();
      }
    }
  }

  // 2. Referenced SondZeit Module Lookup in Workspace
  let targetModTimes: string | null = null;
  let targetModFound: ScriptModule | null = null;

  if (workspace && sondRef) {
    const cleanRef = sondRef.replace(/^['"]|['"]$/g, '').trim();
    const targetKey = canonicalScriptMatchKey(cleanRef);

    targetModFound =
      workspace.modules.find((m) => {
        if (m === currentMod) return false;
        const mNumKey = canonicalScriptMatchKey(m.scriptNumber);
        const mNameKey = canonicalScriptMatchKey(m.scriptName);
        if (mNumKey === targetKey || mNameKey === targetKey) return true;
        if (cleanRef.length >= 3) {
          if (m.scriptNumber.toLowerCase() === cleanRef.toLowerCase()) return true;
          if (m.scriptName.toLowerCase().includes(cleanRef.toLowerCase())) return true;
          if (cleanRef.toLowerCase().includes(m.scriptNumber.toLowerCase())) return true;
        }
        return false;
      }) || null;

    if (targetModFound) {
      for (const r of targetModFound.rules) {
        if (r.schedule && /\b\d{1,2}[:.]\d{2}\b/.test(r.schedule)) {
          targetModTimes = r.schedule.trim();
          break;
        }
        const det = extractReadableScheduleAndHolidayFromText(r.condition || '');
        if (det.schedule && /\b\d{1,2}[:.]\d{2}\b/.test(det.schedule)) {
          targetModTimes = det.schedule.trim();
          break;
        }
      }
      if (!targetModTimes && targetModFound.rawText) {
        const fromText = extractReadableScheduleAndHolidayFromText(targetModFound.rawText);
        if (fromText.schedule && /\b\d{1,2}[:.]\d{2}\b/.test(fromText.schedule)) {
          targetModTimes = fromText.schedule.trim();
        }
      }
    }
  }

  // 3. Smart Name Pattern Heuristic (from sondRef or targetMod name/number)
  const nameTimes =
    extractScheduleFromSondZeitName(sondRef) ||
    (targetModFound ? extractScheduleFromSondZeitName(targetModFound.scriptName) : null) ||
    (targetModFound ? extractScheduleFromSondZeitName(targetModFound.scriptNumber) : null);

  // Precedence: Direct Script Times > Target Module Times > Name Pattern Times
  const resolvedTimes = directTimes || targetModTimes || nameTimes;

  if (resolvedTimes) {
    const refLabel =
      sondRef ||
      (targetModFound ? targetModFound.scriptName || targetModFound.scriptNumber : '');
    const refTag = refLabel ? ` (${refLabel})` : '';
    const formatted = resolvedTimes.includes(refLabel)
      ? resolvedTimes
      : `${resolvedTimes}${refTag}`;
    return {
      displayText: formatted,
      hasSchedule: true,
      hasConcreteTimes: true,
      scriptReference: refLabel || undefined,
      pureTimes: resolvedTimes,
    };
  }

  // 4. Pure Name Fallback if no times could be determined anywhere
  if (sondRef) {
    return {
      displayText: sondRef,
      hasSchedule: true,
      hasConcreteTimes: false,
      scriptReference: sondRef,
    };
  }

  return {
    displayText: schedStr,
    hasSchedule: Boolean(schedStr),
    hasConcreteTimes: hasClockTime,
  };
}

function parseAaccScriptBlocks(
  rawText: string,
  options?: {
    defaultScriptNumber?: string;
    defaultScriptName?: string;
    sourceFilename?: string;
    origin?: ScriptOrigin;
    isMasterHint?: boolean;
  }
): ScriptModule[] {
  const withoutComments = stripScriptCommentsAndNoise(rawText);
  const rawLines = withoutComments.split(/\r?\n/);

  const isOclBodyCodeLine = (line: string): boolean => {
    const t = line.trim();
    if (!t) return false;
    return /^(?:section\b(?!\s+["']?init\b)|const\b|var\b|event\b|assign\b|readvar\b|send\b|if\b|else\b|end\b|give\b|transfer\b|route\b|queue\b|collect\b|execute\b|call\b|goto\b|subscript\b|open\b|play\b|wait\b|disconnect\b|drop\b|where\b|select\b|case\b|value\b|default\b|otherwise\b)/i.test(
      t
    );
  };

  const findHeaderStartBeforeAnchor = (anchorIdx: number, maxLookback: number): number => {
    let start = anchorIdx;
    for (let k = anchorIdx - 1; k >= Math.max(0, anchorIdx - maxLookback); k--) {
      const prev = rawLines[k].trim();
      if (!prev) {
        continue;
      }
      if (/^[=\-*#]{2,}\s*(.+?)\s*[=\-*#]{2,}$/.test(prev)) {
        start = k;
        break;
      }
      if (isOclBodyCodeLine(prev)) {
        break;
      }
      start = k;
    }
    return start;
  };

  // Detect all script chunk boundaries across full exports (`=== Header ===`, `section Init`, or standalone `CDN <digits>`)
  const rawStartSet = new Set<number>();

  rawLines.forEach((l, idx) => {
    const t = l.trim();
    if (!t) return;

    if (/^[=\-*#]{2,}\s*(.+?)\s*[=\-*#]{2,}$/.test(t)) {
      rawStartSet.add(idx);
      return;
    }

    if (/^section\s+["']?init["']?\b/i.test(t)) {
      rawStartSet.add(findHeaderStartBeforeAnchor(idx, 8));
      return;
    }

    if (/^CDN\s*[:=]?\s*\d{3,6}\s*$/i.test(t)) {
      const hasUpcomingInit = rawLines
        .slice(idx + 1, Math.min(rawLines.length, idx + 9))
        .some((nl) => /^\s*section\s+["']?init["']?\b/i.test(nl));
      if (!hasUpcomingInit) {
        rawStartSet.add(findHeaderStartBeforeAnchor(idx, 3));
      }
    }
  });

  const sortedStarts = Array.from(rawStartSet).sort((a, b) => a - b);
  const chunks: Array<{ startIdx: number; endIdx: number }> = [];

  if (sortedStarts.length <= 1) {
    chunks.push({ startIdx: 0, endIdx: rawLines.length });
  } else {
    // Ensure any leading script (e.g. `Main` before the first sub-script) from line 0 is preserved as Chunk 0
    if (sortedStarts[0] > 0) {
      const preSlice = rawLines.slice(0, sortedStarts[0]).join('\n').trim();
      if (preSlice.length > 0) {
        sortedStarts.unshift(0);
      } else {
        sortedStarts[0] = 0;
      }
    }
    for (let i = 0; i < sortedStarts.length; i++) {
      const startIdx = sortedStarts[i];
      const endIdx = i + 1 < sortedStarts.length ? sortedStarts[i + 1] : rawLines.length;
      if (endIdx > startIdx) {
        chunks.push({ startIdx, endIdx });
      }
    }
  }

  const modules: ScriptModule[] = [];

  chunks.forEach((chunk, chunkIdx) => {
    const sliceLines = rawLines.slice(chunk.startIdx, chunk.endIdx);
    const chunkText = sliceLines.join('\n');
    const trimmedChunk = chunkText.trim();
    if (!trimmedChunk) return;

    const headerCommentSlice =
      chunks.length === 1 && chunkIdx === 0 ? rawText.slice(0, 4000) : chunkText.slice(0, 2000);
    const headerCommentScriptName = headerCommentSlice
      .match(
        /(?:script\s*name|scriptname|skript(?:\s*name)?|script|application(?:\s*name)?|modul(?:name)?|titel|title)\s*[:=]\s*["']?([^\r\n*/"']{2,80})["']?/i
      )?.[1]
      ?.trim()
      ?.replace(/\.s$/i, '')
      ?.trim();
    const headerCommentCdn = headerCommentSlice
      .match(/(?:^|[\s*/;(])(?:CDN|DNIS)\s*[:=]\s*["']?(\d{3,6})["']?/im)?.[1]
      ?.trim();

    // Extract descriptive name or framed header right before `CDN` / `section Init` FIRST so multi-script chunks get their real script name
    let detectedName = '';
    const nonEmptyBeforeSection: string[] = [];
    for (const rawLine of sliceLines.slice(0, 12)) {
      const t = rawLine.trim();
      if (!t) continue;
      if (/^(?:section|const|var|event|assign|readvar|send|if|where|select|case|value|open|give|queue|route|execute|call|collect|wait|disconnect|drop)\b/i.test(t)) {
        break;
      }
      nonEmptyBeforeSection.push(t);
    }

    for (const line of nonEmptyBeforeSection) {
      const framedMatch = line.match(/^[=\-*#]{2,}\s*(.+?)\s*[=\-*#]{2,}$/);
      const candidateLine = (framedMatch ? framedMatch[1] : line)
        .trim()
        .replace(/\.s$/i, '')
        .trim();
      if (
        candidateLine &&
        !isMetadataOrChangelogLine(candidateLine) &&
        !/^(?:CDN|Bereich|Abteilung|Team|section|event|assign|if|else|end(?:\s*(?:if|section|where|event|voice\s+session))?|give|transfer|route|queue|collect|execute|call|goto|subscript|open|play|wait|disconnect|drop|where|select|case|value|default|otherwise|dnis|fax(?:routing)?)\b/i.test(
          candidateLine
        ) &&
        !/^(?:prio|zeitplan|feiertag|bedingung|ansage|taste)\b/i.test(candidateLine) &&
        !/^\d{2,6}[xX*]{2,6}\b/.test(candidateLine) &&
        !candidateLine.includes('->') &&
        !candidateLine.includes('=>') &&
        candidateLine.length >= 3
      ) {
        detectedName = candidateLine;
        break;
      }
    }

    const detectedNameToken = detectedName.replace(/\s+/g, '_');
    const isExplicitMainChunkHeader = /^(?:main|master(?:script)?)$/i.test(detectedNameToken);
    const isPrimarySingleMaster = Boolean(chunks.length === 1 && options?.isMasterHint);
    const chunkIsMaster =
      isExplicitMainChunkHeader ||
      hasAaccMasterRoutingSignals(trimmedChunk) ||
      isPrimarySingleMaster;
    const topCdnHeaderMatch = chunkText.match(/^\s*CDN\s*[:=]?\s*(\d{3,6})\b/im);
    const inlineCdnMatch = chunkIsMaster ? null : chunkText.match(/\bCDN\s*[:=]?\s*(\d{3,6})\b/i);
    const cdnMatch = topCdnHeaderMatch || inlineCdnMatch;
    const detectedNameRef =
      detectedNameToken &&
      isValidScriptRef(detectedNameToken) &&
      !/^(?:main|start)$/i.test(detectedNameToken)
        ? normalizeScriptRef(detectedNameToken)
        : undefined;

    const cleanFileBase =
      chunks.length === 1 && options?.sourceFilename
        ? options.sourceFilename.replace(/\.[^.]+$/, '').trim()
        : '';
    const fileDigitRef = cleanFileBase.match(/(?:^|[\s_-])(\d{3,6})(?:$|[\s_-])/)?.[1];
    const fileTokenRef =
      cleanFileBase && isValidScriptRef(cleanFileBase.replace(/\s+/g, '_'))
        ? normalizeScriptRef(cleanFileBase.replace(/\s+/g, '_'))
        : undefined;

    const explicitDefaultNum =
      chunks.length === 1 &&
      options?.defaultScriptNumber?.trim() &&
      !/^(?:main|start)$/i.test(options.defaultScriptNumber.trim())
        ? normalizeScriptRef(options.defaultScriptNumber)
        : undefined;
    const namedFileCandidate =
      fileTokenRef && !/^(?:main|start)$/i.test(fileTokenRef) ? fileTokenRef : undefined;
    const namedCommentCandidate =
      headerCommentScriptName &&
      isValidScriptRef(headerCommentScriptName) &&
      !/^(?:main|start)$/i.test(headerCommentScriptName)
        ? normalizeScriptRef(headerCommentScriptName)
        : undefined;
    const detectedCdn = cdnMatch?.[1] || headerCommentCdn || fileDigitRef;

    const originalNonMainRef =
      explicitDefaultNum ||
      namedFileCandidate ||
      detectedNameRef ||
      namedCommentCandidate ||
      detectedCdn;

    const scriptNumber = chunkIsMaster
      ? 'Main'
      : originalNonMainRef ||
        (chunks.length === 1 && options?.defaultScriptNumber?.trim()
          ? normalizeScriptRef(options.defaultScriptNumber)
          : chunks.length === 1
          ? 'Start'
          : `900${chunkIdx}`);

    const cdnAlias = chunkIsMaster
      ? originalNonMainRef && canonicalScriptMatchKey(originalNonMainRef) !== 'main'
        ? originalNonMainRef
        : undefined
      : detectedCdn && canonicalScriptMatchKey(detectedCdn) !== canonicalScriptMatchKey(scriptNumber)
      ? detectedCdn
      : detectedNameRef &&
        canonicalScriptMatchKey(detectedNameRef) !== canonicalScriptMatchKey(scriptNumber)
      ? detectedNameRef
      : namedFileCandidate &&
        canonicalScriptMatchKey(namedFileCandidate) !== canonicalScriptMatchKey(scriptNumber)
      ? namedFileCandidate
      : namedCommentCandidate &&
        canonicalScriptMatchKey(namedCommentCandidate) !== canonicalScriptMatchKey(scriptNumber)
      ? namedCommentCandidate
      : undefined;

    const teamMatch = chunkText.match(/\bTeam\s*:\s*([^\n\r]+)/i);
    const bereichMatch = chunkText.match(/\bBereich\s*:\s*([^\n\r]+)/i);
    const abteilungMatch = chunkText.match(/\bAbteilung\s*:\s*([^\n\r]+)/i);

    // Parse top-level `assign <VALUE> to <VAR>` statements for classic AACC sub-scripts
    const vars = new Map<string, string>();
    for (const item of extractAssignStatements(chunkText)) {
      vars.set(item.variable, item.value);
    }

    const teamSkillset = vars.get('Sys_Team_Skillset');
    const cleanFilenameLabel = cleanFileBase.replace(/[_-]+/g, ' ').trim();
    const explicitSingleChunkName =
      chunks.length === 1 &&
      options?.defaultScriptName?.trim() &&
      !/^(?:main|start)$/i.test(options.defaultScriptName.trim())
        ? options.defaultScriptName.trim()
        : '';

    const scriptName =
      (chunkIsMaster || scriptNumber === 'Main' ? 'Main' : '') ||
      explicitSingleChunkName ||
      headerCommentScriptName ||
      detectedName ||
      teamSkillset ||
      (teamMatch ? teamMatch[1].trim() : '') ||
      cleanFilenameLabel ||
      `Skript ${scriptNumber}`;

    const rules: ScriptRule[] = [];
    let ruleCounter = 1;

    // Rule 1: Init / Sonderstatus & Sonderzeit / Gesellschaft
    const sondStat = vars.get('Sys_SondStat');
    const sondZeit = vars.get('Sys_SondZeit');
    const sondRouting = vars.get('Sys_SondRouting');
    const gesellschaft = vars.get('Sys_Gesellschaft');
    const retourZentrale = vars.get('Sys_Retour_Zentrale');
    const rawRetour = retourZentrale?.trim().replace(/^['"]|['"]$/g, '') || '';
    const cleanRetour =
      rawRetour && rawRetour !== '0' && rawRetour !== '-1' && isValidScriptRef(rawRetour)
        ? normalizeScriptRef(rawRetour)
        : rawRetour.match(/\b(\d{3,6})\b/)?.[1];

    if (sondStat || sondZeit || sondRouting || gesellschaft || teamMatch || bereichMatch) {
      const contextBits: string[] = [];
      if (teamMatch) contextBits.push(`Team: ${teamMatch[1].trim()}`);
      else if (abteilungMatch) contextBits.push(`Abt.: ${abteilungMatch[1].trim()}`);
      if (gesellschaft) contextBits.push(`Gesellschaft: ${gesellschaft}`);

      const sondTarget =
        sondRouting &&
        sondRouting !== '0' &&
        sondRouting !== '1' &&
        sondRouting !== '-1' &&
        isValidScriptRef(sondRouting)
          ? normalizeScriptRef(sondRouting)
          : undefined;

      rules.push({
        id: `${scriptNumber}-${ruleCounter++}`,
        prio: 1,
        stepName: contextBits.length > 0 ? `Init (${contextBits.join(' · ')})` : 'Init & Sonderprüfung',
        sourceNumber: scriptNumber,
        targetNumber: sondTarget,
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

    // Rule 4+: Only explicit target script jump variables (never generic Orga/Brand/Prompt/Timer variables)
    const seenExtraTargets = new Set<string>();
    if (cleanRetour) seenExtraTargets.add(canonicalScriptMatchKey(cleanRetour));

    for (const [varName, val] of vars.entries()) {
      if (
        /^(?:Sys_Retour_Zentrale|Sys_Team_Skillset|Sys_Ueberlauf_Skillset|Sys_SondStat|Sys_SondZeit|Sys_Team_Prio|Sys_Ueberlauf_Prio|Sys_Ueberlauf_Zeit|Sys_Musik|Sys_Gesellschaft|Sys_Besetztgrund|Sys_WS_Prozent|Sys_WS_Absolut|Sys_UeberlaufRouting|Sys_SondRouting|Sys_brand|src_route_number)$/i.test(
          varName
        )
      ) {
        continue;
      }
      const isExplicitJumpVar =
        /(?:weiterleitung|ziel(?:[\s_-]*(?:script|skript|cdn))?|next[\s_-]*(?:script|skript)|sub[\s_-]*(?:script|skript)|fallback[\s_-]*(?:script|skript)|overflow[\s_-]*(?:script|skript)|sprung[\s_-]*ziel)/i.test(
          varName
        ) &&
        !/(?:ansage|prompt|voice|ran|musik|music|skillset|queue|zeit|time|wait|prio|stat|status|prozent|absolut|brand|gesellschaft|orga|besetzt)/i.test(
          varName
        );
      if (!isExplicitJumpVar) {
        continue;
      }
      const cleanVal = val.trim().replace(/^['"]|['"]$/g, '');
      const candidateRef =
        cleanVal.match(/^\d{3,6}$/)?.[0] ||
        (cleanVal.length >= 3 &&
        !/^(?:0|1|-1|true|false|ja|nein|ein|aus)$/i.test(cleanVal) &&
        isValidScriptRef(cleanVal)
          ? normalizeScriptRef(cleanVal)
          : undefined);
      if (
        candidateRef &&
        canonicalScriptMatchKey(candidateRef) !== canonicalScriptMatchKey(scriptNumber) &&
        !seenExtraTargets.has(canonicalScriptMatchKey(candidateRef))
      ) {
        seenExtraTargets.add(canonicalScriptMatchKey(candidateRef));
        const nextPrio = Math.max(
          rules.reduce((mx, r) => Math.max(mx, r.prio || 0), 19) + 1,
          ruleCounter + 20
        );
        rules.push({
          id: `${scriptNumber}-${ruleCounter++}`,
          prio: nextPrio,
          stepName: varName.replace(/^Sys_/, ''),
          sourceNumber: scriptNumber,
          targetNumber: candidateRef,
          choices: [],
          rawLine: `assign ${val} to ${varName}`,
        });
      }
    }

    // Procedural body, OCL SECTION / EVENT / VOICE SESSION / IF-ELSE / WHERE / VALUE / QUEUE / DISCONNECT blocks
    const localSectionNames = new Set<string>();
    for (const sl of sliceLines) {
      const secDecl = sl.trim().match(/^section\s+["']?([A-Za-z0-9ÄÖÜäöüß_.-]+)["']?/i);
      if (secDecl && secDecl[1]) {
        localSectionNames.add(canonicalScriptMatchKey(secDecl[1]));
      }
    }

    interface ConditionFrame {
      kind: 'if' | 'where' | 'event';
      condText: string;
      orga: AaccOrgaContext;
      isFaxCond: boolean;
      hadInlineRules: boolean;
      intrinsics: string[];
    }

    const conditionStack: ConditionFrame[] = [];
    const orgaRegistry = new Map<string, AaccOrgaContext>();
    const ruleTracking: {
      lastCollect: ScriptRule | null;
      lastCreated: ScriptRule | null;
    } = {
      lastCollect: null,
      lastCreated: null,
    };
    let currentSection: string | undefined;
    let currentEvent: string | undefined;
    let inVoiceSession = false;
    let inDeclBlock = false;
    let pendingValueTrigger: {
      valueNumbers: string[];
      rawTrigger: string;
      orga: AaccOrgaContext;
      isFax: boolean;
      caseLabel?: string;
    } | null = null;

    const getStackOrga = (): AaccOrgaContext => {
      let acc: AaccOrgaContext = {};
      for (const f of conditionStack) {
        acc = mergeOrgaContext(acc, f.orga);
      }
      return acc;
    };

    const registerOrga = (ctx: AaccOrgaContext) => {
      const codeKey = ctx.orgaCode ? canonicalScriptMatchKey(ctx.orgaCode) : '';
      const nameKey =
        ctx.organizationName || ctx.brandName
          ? canonicalScriptMatchKey(ctx.organizationName || ctx.brandName || '')
          : '';
      if (!codeKey && !nameKey) return;
      const existing =
        (codeKey ? orgaRegistry.get(codeKey) : undefined) ||
        (nameKey ? orgaRegistry.get(nameKey) : undefined);
      const merged = mergeOrgaContext(existing, ctx);
      if (codeKey) orgaRegistry.set(codeKey, merged);
      if (nameKey) orgaRegistry.set(nameKey, merged);
    };

    const extractCcmaIntrinsicsFromText = (rawTextLine: string): string[] => {
      const text = rawTextLine.replace(/\s+/g, ' ').trim();
      const found: string[] = [];
      const pushUnique = (val: string) => {
        if (val && !found.includes(val)) found.push(val);
      };

      const loggedInMatch = text.match(
        /\blogged\s+in\s+agents(?:\s+(?:of|in|for))?\s+([A-Za-z0-9_.-]+)?(?:\s*(=|<>|!=|<=|>=|<|>)\s*([A-Za-z0-9_.-]+))?/i
      );
      if (loggedInMatch) {
        const cmp = loggedInMatch[2] && loggedInMatch[3] ? ` ${loggedInMatch[2]} ${loggedInMatch[3]}` : '';
        pushUnique(`Agents logged in${loggedInMatch[1] ? ` (${loggedInMatch[1]})` : ''}${cmp}`);
      }

      const countAgentsMatch = text.match(
        /\bcount\s+agents\s+in\s+skillset\s+([A-Za-z0-9_.-]+)\s*\(([^)]+)\)(?:\s*(=|<>|!=|<=|>=|<|>)\s*([A-Za-z0-9_.-]+))?/i
      );
      if (countAgentsMatch) {
        const cmp = countAgentsMatch[3] && countAgentsMatch[4] ? ` ${countAgentsMatch[3]} ${countAgentsMatch[4]}` : '';
        pushUnique(`${countAgentsMatch[2].trim()} Agents (${countAgentsMatch[1]})${cmp}`);
      }

      const idleMatch = text.match(
        /\b(?:idle|available)\s+agents(?:\s+(?:of|in|for))?\s*([A-Za-z0-9_.-]+)?(?:\s*(=|<>|!=|<=|>=|<|>)\s*([A-Za-z0-9_.-]+))?/i
      );
      if (idleMatch) {
        const sk = idleMatch[1] && !/^(?:of|in|for|then|and|or)$/i.test(idleMatch[1]) ? ` (${idleMatch[1]})` : '';
        const cmp = idleMatch[2] && idleMatch[3] ? ` ${idleMatch[2]} ${idleMatch[3]}` : '';
        pushUnique(`Idle Agents${sk}${cmp}`);
      }

      const ewtMatch = text.match(
        /\b(?:expected\s+wait\s+time|cewt|ewt)(?:\s+(?:of|in|for))?\s*([A-Za-z0-9_.-]+)?(?:\s*(=|<>|!=|<=|>=|<|>)\s*([A-Za-z0-9_.-]+))?/i
      );
      if (ewtMatch) {
        const sk = ewtMatch[1] && !/^(?:then|and|or|>|<|=)$/i.test(ewtMatch[1]) ? ` (${ewtMatch[1]})` : '';
        const cmp = ewtMatch[2] && ewtMatch[3] ? ` ${ewtMatch[2]} ${ewtMatch[3]}` : '';
        pushUnique(`EWT${sk}${cmp}`);
      }

      const callsWaitMatch = text.match(
        /\b(?:calls\s+waiting|queue\s+length)(?:\s+(?:of|in|for))?\s*([A-Za-z0-9_.-]+)?(?:\s*(=|<>|!=|<=|>=|<|>)\s*([A-Za-z0-9_.-]+))?/i
      );
      if (callsWaitMatch) {
        const sk = callsWaitMatch[1] && !/^(?:then|and|or|>|<|=)$/i.test(callsWaitMatch[1]) ? ` (${callsWaitMatch[1]})` : '';
        const cmp = callsWaitMatch[2] && callsWaitMatch[3] ? ` ${callsWaitMatch[2]} ${callsWaitMatch[3]}` : '';
        pushUnique(`Queue Length${sk}${cmp}`);
      }

      const waitTimeCondMatch = !ewtMatch
        ? text.match(/\bwait\s+time(?:\s*(=|<>|!=|<=|>=|<|>)\s*([A-Za-z0-9_.-]+))?/i)
        : null;
      if (waitTimeCondMatch) {
        const cmp = waitTimeCondMatch[1] && waitTimeCondMatch[2] ? ` ${waitTimeCondMatch[1]} ${waitTimeCondMatch[2]}` : '';
        pushUnique(`Wait Time${cmp}`);
      }

      if (/\boldest\s+call(?:\s+waiting)?\b/i.test(text)) {
        pushUnique('Oldest Call');
      }
      if (/\banswered\s+within\b/i.test(text)) {
        pushUnique('Service-Level (Answered Within)');
      }
      if (/\bnot\s+queued\b/i.test(text)) {
        pushUnique('Not Queued');
      } else if (/\bqueued\b/i.test(text)) {
        pushUnique('Queued');
      }
      if (/\bpriority\s+in\s+network\s+queue\b/i.test(text)) {
        pushUnique('Network Queue Prio');
      }
      const notOos = text.match(/\bnot\s+out\s+of\s+service\s+["']?([A-Za-z0-9_.-]+)["']?/i);
      if (notOos) {
        pushUnique(`Skillset aktiv (${notOos[1]})`);
      } else {
        const oos = text.match(/\bout\s+of\s+service\s+["']?([A-Za-z0-9_.-]+)["']?/i);
        if (oos) pushUnique(`Out of Service (${oos[1]})`);
      }

      return found;
    };

    const formatReadableOclCondition = (rawCond: string): string => {
      const trimmed = rawCond.trim();
      const notOos = trimmed.match(/^not\s+out\s+of\s+service\s+["']?(.+?)["']?$/i);
      if (notOos) return `Skillset aktiv (${notOos[1].trim()})`;
      const oos = trimmed.match(/^out\s+of\s+service\s+["']?(.+?)["']?$/i);
      if (oos) return `Skillset Out of Service (${oos[1].trim()})`;
      const intrinsics = extractCcmaIntrinsicsFromText(trimmed);
      if (intrinsics.length > 0 && !/\b(?:day\s+of\s+week|time\s+of\s+day|holiday)\b/i.test(trimmed)) {
        return intrinsics.join(' · ');
      }
      const extractedTime = extractReadableScheduleAndHolidayFromText(trimmed);
      if (extractedTime.schedule && extractedTime.holiday) {
        return `Öffnungszeiten ${extractedTime.schedule} · ${extractedTime.holiday}`;
      }
      if (extractedTime.schedule) {
        return `Öffnungszeiten: ${extractedTime.schedule}`;
      }
      if (extractedTime.holiday) {
        return extractedTime.holiday;
      }
      return trimmed.replace(/\s+/g, ' ');
    };

    const getActiveConditionLabel = (): string | undefined => {
      const nonEventFrames = conditionStack.filter((f) => f.kind !== 'event');
      if (nonEventFrames.length > 0) {
        return nonEventFrames.map((f) => f.condText).slice(-2).join(' · ');
      }
      return undefined;
    };

    const getActiveIntrinsics = (): string[] => {
      const set = new Set<string>();
      for (const frame of conditionStack) {
        for (const item of frame.intrinsics) {
          set.add(item);
        }
      }
      return Array.from(set);
    };

    const resolveOrgaForRule = (
      localCtx: AaccOrgaContext,
      valueNums: string[],
      lineText: string,
      targetScript?: string
    ): AaccOrgaContext => {
      let merged = mergeOrgaContext(getStackOrga(), localCtx);

      // 1. Check VALUE numbers against discovered orgaRegistry prefixes (e.g. 290, 210, 6099) or masked patterns
      if (!merged.organizationName || !merged.orgaCode) {
        const sortedReg = Array.from(orgaRegistry.values())
          .filter((r) => Boolean(r.orgaCode))
          .sort((a, b) => (b.orgaCode?.length || 0) - (a.orgaCode?.length || 0));

        for (const v of valueNums) {
          const digits = v.replace(/\D+/g, '');
          let matchedReg: AaccOrgaContext | undefined;
          for (const regItem of sortedReg) {
            const code = (regItem.orgaCode || '').replace(/\D+/g, '');
            if (!code) continue;
            if (digits.startsWith(code)) {
              matchedReg = regItem;
              break;
            }
            const idx = digits.indexOf(code);
            if (idx >= 3 && idx <= 6 && digits.length - idx >= code.length + 2) {
              matchedReg = regItem;
              break;
            }
          }
          if (matchedReg) {
            merged = mergeOrgaContext(matchedReg, merged);
            break;
          }
          const fromVal = detectOrgaFromText(v);
          if (fromVal.organizationName || fromVal.orgaCode) {
            merged = mergeOrgaContext(merged, fromVal);
            break;
          }
        }
      }

      // 2. Check target script name or line text for dynamic DNIS_Range / Orga identifiers
      if (!merged.organizationName || !merged.orgaCode) {
        const fromTarget = detectOrgaFromText(`${targetScript || ''} ${lineText}`);
        if (fromTarget.organizationName || fromTarget.orgaCode) {
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
            !isLikelyTeamOrDepartmentName(regCtx.brandName) &&
            new RegExp(`(?:^|_|-)${regCtx.brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|_|-)`, 'i').test(
              targetScript
            )
          ) {
            merged = mergeOrgaContext(regCtx, merged);
            break;
          }
        }
      }

      // Ensure brandName -> organizationName fallback (unless it's a generic team name)
      if (!merged.organizationName && merged.brandName && !isLikelyTeamOrDepartmentName(merged.brandName)) {
        const fromBrand = detectOrgaFromText(merged.brandName);
        if (fromBrand.organizationName || fromBrand.orgaCode) {
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
          if (det.organizationName || det.orgaCode) {
            next = mergeOrgaContext(next, det);
          }
        } else if (/^Sys_brand$/i.test(a.variable)) {
          if (!isLikelyTeamOrDepartmentName(a.value)) {
            next.brandName = a.value;
            const det = detectOrgaFromText(a.value);
            if (det.organizationName || det.orgaCode) {
              next = mergeOrgaContext(next, det);
            } else if (!next.organizationName) {
              next.organizationName = a.value;
            }
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
      explicitIsFax = false,
      explicitCaseLabel?: string
    ): boolean => {
      const valueNumbers =
        explicitValueNums.length > 0
          ? explicitValueNums
          : pendingValueTrigger?.valueNumbers || [];
      const caseLabel = explicitCaseLabel || pendingValueTrigger?.caseLabel;
      const stackFax = conditionStack.some((f) => f.isFaxCond);
      const lineHasFaxKeyword = /\bfax(?:routing)?\b/i.test(actionSegment);
      const has4DigitValue = valueNumbers.some((v) => /^\d{4}$/.test(v));
      const faxCdnMatch = actionSegment.match(
        /\b(?:fax(?:routing)?\s*(?:cdn)?|cdn)\s*[:=]?\s*(\d{4})\b/i
      );

      const execCmd = actionSegment.match(
        /\b(execute(?:\s+script)?|call(?:\s+script)?|subscript|give\s+script|goto)\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+))/i
      );
      const queueCmd = actionSegment.match(
        /\bqueue\s+to\s+(?:(network\s+skillset|skillset|agent|cdn)\s+)?(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+))(?:\s+with\s+priority\s+(\d{1,3}))?/i
      );
      const routeEndCmd = /\broute\s+end\b/i.test(actionSegment);
      const routeCmd = !routeEndCmd
        ? actionSegment.match(
            /\b(route\s+(?:call(?:\s+to)?|target)|transfer(?:\s+to)?|give\s+cdn)\s*[:=]?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_+.-]+))/i
          )
        : null;
      const readVarCmd = actionSegment.match(
        /\breadvar\s+([A-Za-z0-9ÄÖÜäöüß_.-]+)(?:\s+from\s+([A-Za-z0-9ÄÖÜäöüß_.-]+))?/i
      );
      const sendInfoCmd = actionSegment.match(
        /\bsend\s+info\b(?:\s+(.+))?$/i
      );
      const ivrTreatmentCmd = !execCmd
        ? actionSegment.match(
            /\bgive\s+ivr\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+))(?:\s+with\s+treatment\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+)))?/i
          )
        : null;
      const annCmd = !execCmd && !ivrTreatmentCmd
        ? actionSegment.match(
            /\b(?:give\s+(controlled\s+broadcast(?:\s+announcement)?|aura\s+recording|announcement|ran|music|treatment|overflow)|open\s+voice\s+segment|(?:play\s+)?(?:prompt\s+)?voice\s+segment|play\s+(?:prompt|announcement|tone|ran)|(?:sonderansage|ansage)\b)(?:\s*[:=]?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9ÄÖÜäöüß_.-]+)))?/i
          )
        : null;
      const ringbackOrBusyCmd = actionSegment.match(/\bgive\s+(ringback|busy|silence)\b/i);
      const collectCmd = actionSegment.match(
        /\bcollect\s+(\d+)\s+digits?(?:\s+into\s+([A-Za-z0-9_]+))?/i
      );
      const waitCmd = actionSegment.match(
        /\bwait\s+(\d+)\s*(?:(min(?:utes?|uten)?)|(sec(?:onds?)?|sek(?:unden)?))?/i
      );
      const disconnectCmd = routeEndCmd || /\b(?:disconnect|drop\s+call)\b/i.test(actionSegment);

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

      const rawExecToken = execCmd ? (execCmd[2] || execCmd[3] || execCmd[4] || '').trim() : '';
      const execKeyword = execCmd ? execCmd[1] : '';
      const isLocalSectionCall =
        Boolean(rawExecToken) &&
        !/\bscript\b/i.test(execKeyword) &&
        localSectionNames.has(canonicalScriptMatchKey(rawExecToken));

      const execTarget =
        rawExecToken && !isLocalSectionCall && isValidScriptRef(rawExecToken)
          ? normalizeScriptRef(rawExecToken)
          : undefined;

      const routeKeyword = routeCmd?.[1]?.toLowerCase() || '';
      const rawRouteToken = routeCmd
        ? (routeCmd[2] || routeCmd[3] || routeCmd[4] || '').trim()
        : '';
      const isPhoneOrExtTarget =
        Boolean(rawRouteToken) &&
        /^route\s+(?:call|target)/.test(routeKeyword) &&
        /^\+?\d{2,16}$/.test(rawRouteToken);
      const routeTarget =
        rawRouteToken && !isFaxRoute && (isValidScriptRef(rawRouteToken) || isPhoneOrExtTarget)
          ? normalizeScriptRef(rawRouteToken)
          : undefined;
      const isExternalRouteCall = Boolean(
        routeTarget && /^route\s+(?:call|target)/.test(routeKeyword)
      );
      const resolvedTarget = execTarget || routeTarget;

      const rawQueueKind = queueCmd?.[1]?.toLowerCase().replace(/\s+/g, ' ');
      const queueKind: ScriptRule['queueKind'] = queueCmd
        ? rawQueueKind === 'network skillset'
          ? 'network-skillset'
          : rawQueueKind === 'agent'
          ? 'agent'
          : rawQueueKind === 'cdn'
          ? 'cdn'
          : 'skillset'
        : undefined;
      const queueToken = queueCmd ? (queueCmd[2] || queueCmd[3] || queueCmd[4] || '').trim() : '';
      const queuePrio = queueCmd && queueCmd[5] ? parseInt(queueCmd[5], 10) : undefined;

      const annKind = annCmd?.[1]?.toLowerCase().replace(/\s+/g, ' ');
      const annVal = annCmd ? (annCmd[2] || annCmd[3] || annCmd[4] || '').trim() : '';
      const ivrPort = ivrTreatmentCmd
        ? (ivrTreatmentCmd[1] || ivrTreatmentCmd[2] || ivrTreatmentCmd[3] || '').trim()
        : '';
      const ivrTreat = ivrTreatmentCmd
        ? (ivrTreatmentCmd[4] || ivrTreatmentCmd[5] || ivrTreatmentCmd[6] || '').trim()
        : '';

      const treatmentInfo = ivrTreatmentCmd
        ? ivrTreat
          ? `IVR ${ivrPort} (Treatment ${ivrTreat})`
          : `IVR ${ivrPort}`
        : annKind && annKind.includes('controlled broadcast')
        ? `Broadcast${annVal ? `: ${annVal}` : ''}`
        : annKind === 'aura recording'
        ? `Aura Recording${annVal ? `: ${annVal}` : ''}`
        : annKind === 'treatment'
        ? `Treatment${annVal ? `: ${annVal}` : ''}`
        : annKind === 'overflow'
        ? `Overflow${annVal ? `: ${annVal}` : ''}`
        : undefined;

      const formattedAnnouncement = ivrTreatmentCmd
        ? treatmentInfo
        : annKind
        ? annKind === 'music'
          ? annVal
            ? `Musik: ${annVal}`
            : 'Wartemusik (Music)'
          : annKind === 'treatment'
          ? `Treatment${annVal ? `: ${annVal}` : ''}`
          : annKind === 'overflow'
          ? `Overflow${annVal ? `: ${annVal}` : ''}`
          : annKind.includes('controlled broadcast')
          ? `Broadcast${annVal ? `: ${annVal}` : ''}`
          : annKind === 'aura recording'
          ? `RAN ${annVal || 'Aura'}`
          : annKind === 'ran'
          ? `RAN ${annVal}`
          : annVal || 'Ansage / RAN'
        : ringbackOrBusyCmd
        ? ringbackOrBusyCmd[1].toLowerCase() === 'ringback'
          ? 'Freizeichen (Ringback)'
          : ringbackOrBusyCmd[1].toLowerCase() === 'silence'
          ? 'Stille (Silence)'
          : 'Besetztton (Busy)'
        : undefined;

      const hdxAction = readVarCmd
        ? `READVAR ${readVarCmd[1]}${readVarCmd[2] ? ` ⇐ ${readVarCmd[2]}` : ''}`
        : sendInfoCmd
        ? `SEND INFO${sendInfoCmd[1] ? `: ${sendInfoCmd[1].trim()}` : ''}`
        : undefined;

      const waitSecondsVal = waitCmd
        ? parseInt(waitCmd[1], 10) * (waitCmd[2] ? 60 : 1)
        : undefined;

      if (
        waitSecondsVal !== undefined &&
        !execCmd &&
        !queueCmd &&
        !routeCmd &&
        !ivrTreatmentCmd &&
        !annCmd &&
        !ringbackOrBusyCmd &&
        !collectCmd &&
        !disconnectCmd &&
        !readVarCmd &&
        !sendInfoCmd &&
        !isFaxRoute &&
        !isLocalSectionCall
      ) {
        if (ruleTracking.lastCreated && ruleTracking.lastCreated.waitSeconds === undefined) {
          ruleTracking.lastCreated.waitSeconds = waitSecondsVal;
          pendingValueTrigger = null;
          return true;
        }
      }

      if (
        execCmd ||
        isLocalSectionCall ||
        queueCmd ||
        routeCmd ||
        ivrTreatmentCmd ||
        annCmd ||
        ringbackOrBusyCmd ||
        collectCmd ||
        waitCmd ||
        disconnectCmd ||
        readVarCmd ||
        sendInfoCmd ||
        isFaxRoute
      ) {
        const orga = resolveOrgaForRule(
          pendingValueTrigger?.orga || {},
          valueNumbers,
          rawLine,
          resolvedTarget
        );
        const stackCond = getActiveConditionLabel();
        const combinedCondition = [stackCond, caseLabel].filter(Boolean).join(' · ') || undefined;
        const activeIntrinsics = getActiveIntrinsics();
        const valDisplay = valueNumbers.length > 0 ? valueNumbers.join(', ') : '';

        const stepLabel = routeEndCmd
          ? 'Anruf-Ende (Route End)'
          : disconnectCmd
          ? 'Anruf beenden (Disconnect)'
          : isLocalSectionCall
          ? `Zyklus / Abschnitt → ${rawExecToken}`
          : isFaxRoute && !execTarget
          ? `Fax-Routing (4-stellig)${valDisplay ? `: ${valDisplay}` : ''}`
          : execTarget
          ? `${valDisplay ? `VALUE ${valDisplay} → ` : 'Subskript: '}${execTarget}`
          : queueCmd
          ? queueKind === 'network-skillset'
            ? `Network-Skillset: ${queueToken}`
            : queueKind === 'agent'
            ? `Agent-Queue: ${queueToken}`
            : `Queue: ${queueToken}`
          : routeCmd
          ? `Route Call → ${routeTarget || rawRouteToken}`
          : hdxAction
          ? hdxAction
          : ivrTreatmentCmd
          ? treatmentInfo || 'IVR / Treatment'
          : collectCmd
          ? `${inVoiceSession ? 'Voice-Menü: ' : ''}DTMF-Eingabe (${collectCmd[1]} Ziffern)`
          : waitSecondsVal !== undefined && !formattedAnnouncement
          ? `Wartezeit (${waitSecondsVal}s)`
          : annKind === 'music'
          ? 'Wartemusik'
          : annKind && annKind.includes('controlled broadcast')
          ? `Controlled Broadcast${annVal ? `: ${annVal}` : ''}`
          : annKind === 'aura recording'
          ? `Aura Recording${annVal ? `: ${annVal}` : ''}`
          : annKind === 'treatment'
          ? `Treatment${annVal ? `: ${annVal}` : ''}`
          : ringbackOrBusyCmd
          ? ringbackOrBusyCmd[1].toLowerCase() === 'ringback'
            ? 'Freizeichen (Ringback)'
            : ringbackOrBusyCmd[1].toLowerCase() === 'silence'
            ? 'Stille (Silence)'
            : 'Besetztton (Busy)'
          : inVoiceSession
          ? 'Voice-Prompt'
          : 'Ansage / RAN';

        const detectedTime = extractReadableScheduleAndHolidayFromText(
          `${stackCond || ''} ${caseLabel || ''} ${rawLine}`
        );

        const nextPrio = Math.max(
          rules.reduce((mx, r) => Math.max(mx, r.prio || 0), 19) + 1,
          ruleCounter + 20
        );
        const createdRule: ScriptRule = {
          id: `${scriptNumber}-${ruleCounter++}`,
          prio: nextPrio,
          stepName: stepLabel,
          sourceNumber: scriptNumber,
          targetNumber: resolvedTarget,
          queueTarget: queueToken || undefined,
          queueKind,
          isExternalRouteCall: isExternalRouteCall || undefined,
          skillsetPriority: queuePrio,
          waitSeconds: waitSecondsVal,
          isDisconnect: disconnectCmd || undefined,
          sectionName: currentSection,
          eventName: currentEvent,
          announcement: formattedAnnouncement,
          treatmentInfo,
          hdxAction,
          loopSectionTarget: isLocalSectionCall ? rawExecToken : undefined,
          intrinsicMetrics: activeIntrinsics.length > 0 ? activeIntrinsics : undefined,
          schedule: detectedTime.schedule,
          holiday: detectedTime.holiday,
          condition: combinedCondition,
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
        ruleTracking.lastCreated = createdRule;
        if (collectCmd) {
          ruleTracking.lastCollect = createdRule;
        } else if (!caseLabel && valueNumbers.length === 0) {
          ruleTracking.lastCollect = null;
        }
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
      if (!t) continue;

      // Skip CONST / VAR declaration blocks cleanly without creating bogus rules
      if (/^(?:const|var)\b/i.test(t) && !/\bexecute\b|\bqueue\b|\broute\b/i.test(t)) {
        inDeclBlock = !/\bend\s+(?:const|var)\b/i.test(t);
        continue;
      }
      if (/^end\s+(?:const|var)\b/i.test(t)) {
        inDeclBlock = false;
        continue;
      }
      if (inDeclBlock) {
        continue;
      }

      // Track SECTION / END SECTION
      const sectionStartMatch = t.match(/^section\s+["']?([A-Za-z0-9ÄÖÜäöüß_.-]+)["']?/i);
      if (sectionStartMatch) {
        currentSection = sectionStartMatch[1].trim();
        ruleTracking.lastCollect = null;
        ruleTracking.lastCreated = null;
        pendingValueTrigger = null;
        continue;
      }
      if (/^end\s+section\b/i.test(t)) {
        currentSection = undefined;
        ruleTracking.lastCollect = null;
        ruleTracking.lastCreated = null;
        pendingValueTrigger = null;
        continue;
      }

      // Track EVENT HANDLER / EVENT CALL ABANDON / END EVENT
      const eventStartMatch = t.match(
        /^event\s+(?:handler\s*)?([A-Za-z0-9ÄÖÜäöüß_ .-]+?)\s*:?$/i
      );
      if (eventStartMatch && !/^event\b.*\bthen\b/i.test(t)) {
        const evtLabel = eventStartMatch[1].trim() || 'Handler';
        currentEvent = evtLabel;
        conditionStack.push({
          kind: 'event',
          condText: `Event: ${evtLabel}`,
          orga: {},
          isFaxCond: false,
          hadInlineRules: false,
          intrinsics: [],
        });
        continue;
      }
      if (/^end\s+event\b/i.test(t)) {
        currentEvent = undefined;
        for (let idx = conditionStack.length - 1; idx >= 0; idx--) {
          if (conditionStack[idx].kind === 'event') {
            conditionStack.splice(idx, 1);
            break;
          }
        }
        ruleTracking.lastCollect = null;
        continue;
      }

      // Track OPEN VOICE SESSION / END VOICE SESSION
      if (/^open\s+voice\s+session\b/i.test(t)) {
        inVoiceSession = true;
        continue;
      }
      if (/^end\s+voice\s+session\b/i.test(t)) {
        inVoiceSession = false;
        ruleTracking.lastCollect = null;
        continue;
      }

      // Handle END WHERE / END SELECT
      if (/^end\s+(?:where|select|case)\b/i.test(t)) {
        for (let idx = conditionStack.length - 1; idx >= 0; idx--) {
          if (conditionStack[idx].kind === 'where') {
            conditionStack.splice(idx, 1);
            break;
          }
        }
        pendingValueTrigger = null;
        ruleTracking.lastCollect = null;
        continue;
      }

      // Handle END IF / ENDIF (or trailing end if after inline assignments)
      if (/^(?:end\s*if|endif)\b/i.test(t)) {
        let closed: ConditionFrame | undefined;
        for (let idx = conditionStack.length - 1; idx >= 0; idx--) {
          if (conditionStack[idx].kind === 'if') {
            closed = conditionStack.splice(idx, 1)[0];
            break;
          }
        }
        if (
          closed &&
          !closed.hadInlineRules &&
          (closed.orga.organizationName || closed.orga.srcRouteNumber || closed.orga.brandName)
        ) {
          registerOrga(closed.orga);
        }
        ruleTracking.lastCollect = null;
        continue;
      }

      // Handle WHERE <field> EQUALS / SELECT <field> (AACC CASE/WHERE headers)
      const whereMatch = t.match(/^(?:where|select|case)\s+(.+?)(?:\s+(?:equals|is|in)\b(.*))?$/i);
      if (whereMatch && !/\bexecute\b/i.test(t)) {
        const condBody = `${whereMatch[1]} ${whereMatch[2] || ''}`.replace(/\s+/g, ' ').trim();
        const det = detectOrgaFromText(condBody);
        if (
          conditionStack.length > 0 &&
          conditionStack[conditionStack.length - 1].kind === 'where'
        ) {
          conditionStack.pop();
        }
        conditionStack.push({
          kind: 'where',
          condText: condBody,
          orga: det,
          isFaxCond: /\bfax/i.test(condBody),
          hadInlineRules: false,
          intrinsics: extractCcmaIntrinsicsFromText(condBody),
        });
        continue;
      }

      // Handle ELSE / ELSE IF (with optional inline action on same line)
      if (/^else\b(?:\s+if\b(.*?)\bthen\b)?/i.test(t)) {
        ruleTracking.lastCollect = null;
        const elseIfMatch = t.match(/^else\s+if\s+(.+?)\s+then(?:\s+(.*))?$/i);
        const topFrame = conditionStack[conditionStack.length - 1];
        const prevFrame = topFrame && topFrame.kind === 'if' ? conditionStack.pop() : undefined;

        if (elseIfMatch) {
          const condExpr = formatReadableOclCondition(elseIfMatch[1]);
          const inlineBody = elseIfMatch[2]?.trim() || '';
          const hasEndIf = /\bend\s*if\b|\bendif\b/i.test(inlineBody);
          const cleanInline = inlineBody.replace(/\b(?:end\s*if|endif)\b/gi, '').trim();
          let orga: AaccOrgaContext = detectOrgaFromText(condExpr);
          if (cleanInline) {
            orga = applyAssignmentsToOrga(cleanInline, orga);
          }
          const frame: ConditionFrame = {
            kind: 'if',
            condText: condExpr,
            orga,
            isFaxCond: /\bfax/i.test(condExpr),
            hadInlineRules: false,
            intrinsics: extractCcmaIntrinsicsFromText(elseIfMatch[1]),
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
          const inlineElseBody = t.replace(/^else\b/i, '').trim();
          const hasEndIf = /\bend\s*if\b|\bendif\b/i.test(inlineElseBody);
          const cleanInline = inlineElseBody.replace(/\b(?:end\s*if|endif)\b/gi, '').trim();
          conditionStack.push({
            kind: 'if',
            condText: prevFrame ? `Sonst (nicht: ${prevFrame.condText})` : 'Sonst (ELSE)',
            orga: {},
            isFaxCond: false,
            hadInlineRules: false,
            intrinsics: [],
          });
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
      }

      // Handle IF ... THEN (including IF NOT OUT OF SERVICE and inline assign/actions)
      const ifThenMatch = t.match(/^if\s+(.+?)\s+then(?:\s+(.*))?$/i);
      if (ifThenMatch) {
        ruleTracking.lastCollect = null;
        const condExpr = formatReadableOclCondition(ifThenMatch[1]);
        const inlineBody = ifThenMatch[2]?.trim() || '';
        const hasEndIf = /\bend\s*if\b|\bendif\b/i.test(inlineBody);
        const cleanInline = inlineBody.replace(/\b(?:end\s*if|endif)\b/gi, '').trim();

        let orga: AaccOrgaContext = detectOrgaFromText(condExpr);
        if (cleanInline) {
          orga = applyAssignmentsToOrga(cleanInline, orga);
        }

        const frame: ConditionFrame = {
          kind: 'if',
          condText: condExpr,
          orga,
          isFaxCond: /\bfax/i.test(condExpr),
          hadInlineRules: false,
          intrinsics: extractCcmaIntrinsicsFromText(ifThenMatch[1]),
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

      // Handle `VALUE <val> : <action>` & `DEFAULT:` / `OTHERWISE:` (numeric DNIS, DTMF choices, or WHERE cases)
      const valueMatch = t.match(/^(?:VALUE\s+(.+?)|(DEFAULT|OTHERWISE))\s*:\s*(.*)$/i);
      if (valueMatch) {
        const rawVals = (valueMatch[1] || valueMatch[2] || '').trim();
        const afterColon = (valueMatch[3] || '').trim();
        const valueNums = valueMatch[1] ? parseValueTriggerNumbers(rawVals) : [];
        const singleDtmfKey =
          valueMatch[1] && /^['"]?([0-9*#])['"]?$/.test(rawVals)
            ? rawVals.replace(/['"]/g, '')
            : undefined;

        // If inside a DTMF collect menu, attach direct target as a choice branch on ruleTracking.lastCollect
        if (singleDtmfKey && ruleTracking.lastCollect && afterColon) {
          const dtmfTarget = afterColon.match(
            /\b(?:execute(?:\s+script)?|call(?:\s+script)?|route\s+call(?:\s+to)?|transfer(?:\s+to)?|goto)\s+["']?([A-Za-z0-9ÄÖÜäöüß_.-]+)["']?/i
          )?.[1];
          if (dtmfTarget && isValidScriptRef(dtmfTarget) && !localSectionNames.has(canonicalScriptMatchKey(dtmfTarget))) {
            const normTarget = normalizeScriptRef(dtmfTarget);
            if (!ruleTracking.lastCollect.choices.some((c) => c.choice === singleDtmfKey && c.targetNumber === normTarget)) {
              ruleTracking.lastCollect.choices.push({
                choice: singleDtmfKey,
                targetNumber: normTarget,
              });
            }
          }
        }

        const orgaFromVal = resolveOrgaForRule({}, valueNums, t, afterColon);
        const isFaxVal =
          /\bfax(?:routing)?\b/i.test(t) ||
          valueNums.some((v) => /^\d{4}$/.test(v));
        const caseLabel =
          valueNums.length === 0 ? `Wert: ${rawVals.replace(/^['"]|['"]$/g, '')}` : undefined;

        if (!afterColon) {
          pendingValueTrigger = {
            valueNumbers: valueNums,
            rawTrigger: t,
            orga: orgaFromVal,
            isFax: isFaxVal,
            caseLabel,
          };
          continue;
        }

        if (processActionSegment(afterColon, t, valueNums, isFaxVal, caseLabel)) {
          continue;
        }
      }

      const actionSegment = t;
      const activeCondition = getActiveConditionLabel();

      // Choice mappings immediately following `COLLECT N DIGITS` (e.g. `1 -> 550`, `Taste 2 -> 123456`)
      if (
        /^(?:taste|dtmf|opt(?:ion)?|auswahl)?\s*[A-Za-z0-9*#]+\s*(?:->|=>)/i.test(actionSegment)
      ) {
        const parsedChoices = parseChoicesSegment(actionSegment, scriptNumber);
        if (parsedChoices.length > 0) {
          if (ruleTracking.lastCollect) {
            const targetCollect = ruleTracking.lastCollect;
            parsedChoices.forEach((c) => {
              if (
                !targetCollect.choices.some(
                  (ex) => ex.choice === c.choice && ex.targetNumber === c.targetNumber
                )
              ) {
                targetCollect.choices.push(c);
              }
            });
          } else {
            const nextPrio = Math.max(
              rules.reduce((mx, r) => Math.max(mx, r.prio || 0), 19) + 1,
              ruleCounter + 20
            );
            const dtmfRule: ScriptRule = {
              id: `${scriptNumber}-${ruleCounter++}`,
              prio: nextPrio,
              stepName: 'DTMF-Auswahl',
              sourceNumber: scriptNumber,
              sectionName: currentSection,
              eventName: currentEvent,
              condition: activeCondition,
              choices: parsedChoices,
              rawLine: t,
            };
            rules.push(dtmfRule);
            ruleTracking.lastCreated = dtmfRule;
          }
          continue;
        }
      }

      if (processActionSegment(actionSegment, t)) {
        continue;
      }

      ruleTracking.lastCollect = null;

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
        const nextAutoPrio = Math.max(
          rules.reduce((mx, r) => Math.max(mx, r.prio || 0), 19) + 1,
          ruleCounter + 20
        );
        const inlineRule: ScriptRule = {
          id: `${scriptNumber}-${ruleCounter++}`,
          prio: inline.prio !== undefined ? inline.prio : nextAutoPrio,
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
          sectionName: currentSection,
          eventName: currentEvent,
          rawLine: t,
        };
        rules.push(inlineRule);
        ruleTracking.lastCreated = inlineRule;
      }
    }

    // If the Masterscript had DNIS_Range Orga declarations
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
            orgaCtx.srcRouteNumber || (orgaCtx.orgaCode ? `${orgaCtx.orgaCode}xxxx` : ''),
          ].filter(Boolean);
          const nextOrgaPrio = Math.max(
            rules.reduce((mx, r) => Math.max(mx, r.prio || 0), 19) + 1,
            ruleCounter + 20
          );
          rules.push({
            id: `${scriptNumber}-${ruleCounter++}`,
            prio: nextOrgaPrio,
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

    if (
      rules.length === 0 &&
      (chunks.length > 1 ||
        Boolean(options?.sourceFilename || options?.defaultScriptNumber) ||
        /\bsection\s+["']?init["']?\b/i.test(trimmedChunk) ||
        isAnnouncementOrEndpointTargetName(scriptNumber) ||
        isAnnouncementOrEndpointTargetName(scriptName))
    ) {
      const isAnn =
        isAnnouncementOrEndpointTargetName(scriptNumber) ||
        isAnnouncementOrEndpointTargetName(scriptName) ||
        /\b(?:voice|ran|prompt|announcement|ansage|music|treatment)\b/i.test(trimmedChunk);
      rules.push({
        id: `${scriptNumber}-${ruleCounter++}`,
        prio: 1,
        stepName: isAnn ? `Sonderansage / Endpunkt (${scriptName})` : `Endpunkt (${scriptName})`,
        sourceNumber: scriptNumber,
        announcement: isAnn ? scriptName : undefined,
        isDisconnect: true,
        choices: [],
        rawLine: sliceLines[0]?.trim() || scriptNumber,
      });
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

      const hasQueueRules = rules.some(
        (r) => Boolean(r.queueTarget && r.queueTarget !== 'Default_Skillset')
      );
      const isAnnouncementEndpoint =
        outSet.size === 0 &&
        !hasQueueRules &&
        (isAnnouncementOrEndpointTargetName(scriptNumber) ||
          isAnnouncementOrEndpointTargetName(scriptName) ||
          rules.some((r) => Boolean(r.announcement || r.isDisconnect)));

      modules.push({
        scriptNumber,
        scriptName,
        cdnAlias,
        isAnnouncementEndpoint: isAnnouncementEndpoint || undefined,
        isMaster:
          chunkIsMaster ||
          /^(?:main|master(?:script)?|0000)$/i.test(canonicalScriptMatchKey(scriptNumber)) ||
          /\bmaster(?:script)?\b/i.test(scriptName),
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
    isMasterHint?: boolean;
  }
): ScriptModule[] {
  const cleanedRawText = stripScriptCommentsAndNoise(rawText);

  if (isAaccScriptText(rawText)) {
    const aaccModules = parseAaccScriptBlocks(rawText, options);
    if (aaccModules.length > 1) {
      return aaccModules;
    }

    // If the bundle mixes 2+ explicit `=== ... ===` / `Skript:` sections (e.g. AACC Main + CSV/table subscripts),
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
      const bareFramed = !/(?:->|=>|→|\|)/.test(t)
        ? t.match(
            /^[=\-*#]{2,}\s*(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.\s-]{1,78}?)\s*[=\-*#]{2,}$/
          )
        : null;

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
    if (namedHeadersCount >= 2 && explicitSections.length >= 2) {
      const merged = new Map<string, ScriptModule>();
      for (const sec of explicitSections) {
        const secText = sec.lines.join('\n').trim();
        if (!secText) continue;
        const secOpts = {
          ...options,
          sourceFilename: undefined,
          defaultScriptNumber: sec.num || options?.defaultScriptNumber,
          defaultScriptName: sec.name || options?.defaultScriptName,
        };
        const secMods = isAaccScriptText(secText)
          ? parseAaccScriptBlocks(secText, secOpts)
          : parseScriptTextBundle(secText, secOpts);
        secMods.forEach((m) => {
          const mod = sec.isMaster && secMods.length === 1 ? { ...m, isMaster: true } : m;
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
    const bareFramedHeader = !/(?:->|=>|→|\||;)/.test(line)
      ? line.match(
          /^[=\-*#]{2,}\s*(\d{3,6}|[A-Za-zÄÖÜäöüß][A-Za-z0-9ÄÖÜäöüß_.\s-]{1,78}?)\s*[=\-*#]{2,}$/
        )
      : null;
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

    if (/^[=\-*#]{2,}\s*.*?\s*[=\-*#]{2,}$/.test(line) && !/(?:->|=>|→|\||;)/.test(line)) {
      continue;
    }

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
    const fileDerivedRef = options?.sourceFilename
      ? options.sourceFilename.replace(/\.[^.]+$/, '').replace(/\s+/g, '_').trim()
      : '';
    const fallbackModNum =
      options?.defaultScriptNumber?.trim()
        ? normalizeScriptRef(options.defaultScriptNumber)
        : fileDerivedRef && isValidScriptRef(fileDerivedRef)
        ? normalizeScriptRef(fileDerivedRef)
        : 'Main';
    const effectiveSource =
      parsedLine.sourceNumber || currentHeaderNumber || fallbackModNum || resolvedTarget;
    if (
      !effectiveSource &&
      !resolvedTarget &&
      parsedLine.choices.length === 0 &&
      !parsedLine.queueTarget &&
      !parsedLine.schedule &&
      !parsedLine.holiday
    ) {
      continue;
    }

    const modNumber = effectiveSource || fallbackModNum;
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

    const detectedTimeFromCond = extractReadableScheduleAndHolidayFromText(
      parsedLine.condition || ''
    );

    pendingRule = {
      modNumber,
      prio: resolvedPrio,
      stepName: resolvedStepName,
      targetNumber: resolvedTarget,
      choices: [...parsedLine.choices],
      condition: parsedLine.condition,
      schedule: parsedLine.schedule || detectedTimeFromCond.schedule,
      holiday: parsedLine.holiday || detectedTimeFromCond.holiday,
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
    if (options?.isMasterHint && !structured.some((m) => canonicalScriptMatchKey(m.scriptNumber) === 'main')) {
      return promoteEntryModuleToMain(structured);
    }
    return structured.map((m) =>
      canonicalScriptMatchKey(m.scriptNumber) === 'main' || m.scriptName === 'Main (Masterscript)'
        ? { ...m, scriptName: 'Main', isMaster: true }
        : m
    );
  }

  const fileBaseCandidate = options?.sourceFilename
    ? options.sourceFilename.replace(/\.[^.]+$/, '').replace(/\s+/g, '_').trim()
    : '';
  const rawCandidateRef =
    normalizeScriptRef(
      options?.defaultScriptNumber ||
        (fileBaseCandidate && isValidScriptRef(fileBaseCandidate) ? fileBaseCandidate : 'Main')
    ) || 'Main';
  const rawCandidateKey = canonicalScriptMatchKey(rawCandidateRef);
  const isMaster =
    options?.isMasterHint ??
    (/^(?:main|master(?:script)?)$/i.test(rawCandidateKey) || rawCandidateKey === '0000');
  const defaultRef = isMaster ? 'Main' : rawCandidateRef;
  const cdnAlias =
    isMaster &&
    rawCandidateKey &&
    !/^(?:main|start|master(?:script)?)$/i.test(rawCandidateKey)
      ? rawCandidateRef
      : undefined;
  const defaultKey = canonicalScriptMatchKey(defaultRef);
  const defaultName = isMaster
    ? 'Main'
    : options?.defaultScriptName?.trim() ||
      (options?.sourceFilename ? options.sourceFilename.replace(/\.[^.]+$/, '').trim() : '') ||
      defaultRef;
  const origin: ScriptOrigin = options?.origin || 'legacy-text';

  const cleanedText = stripScriptCommentsAndNoise(trimmed);
  const cleanedLines = cleanedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      const isPureFramedBanner =
        /^[=\-*#]{2,}\s*.*?\s*[=\-*#]{2,}$/.test(l) &&
        !/(?:->|=>|→|\||;)/.test(l);
      if (isPureFramedBanner) return false;
      const bareInner = l.replace(/^[=\-*#]{2,}\s*|\s*[=\-*#]{2,}$/g, '').trim();
      const lineKey = canonicalScriptMatchKey(bareInner);
      if (
        !lineKey ||
        lineKey === defaultKey ||
        lineKey === rawCandidateKey ||
        /^main$/i.test(bareInner) ||
        /^master(?:script)?$/i.test(bareInner)
      ) {
        return false;
      }
      return true;
    });

  if (cleanedLines.length === 0) {
    return structured.length > 0 ? structured : [];
  }

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
      normalizedTarget &&
      canonicalScriptMatchKey(normalizedTarget) !== defaultKey &&
      canonicalScriptMatchKey(normalizedTarget) !== rawCandidateKey
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
      cdnAlias,
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
  treatUnresolvedAsEndpoint?: boolean;
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
  modules.forEach((m) => {
    moduleByKey.set(canonicalScriptMatchKey(m.scriptNumber), m);
    if (m.cdnAlias) {
      const aliasKey = canonicalScriptMatchKey(m.cdnAlias);
      if (aliasKey && !moduleByKey.has(aliasKey)) {
        moduleByKey.set(aliasKey, m);
      }
    }
  });

  const incomingCount = new Map<string, number>();
  modules.forEach((m) => incomingCount.set(canonicalScriptMatchKey(m.scriptNumber), 0));
  modules.forEach((m) => {
    m.outgoingNumbers.forEach((t) => {
      const matched = moduleByKey.get(canonicalScriptMatchKey(t));
      const k = matched
        ? canonicalScriptMatchKey(matched.scriptNumber)
        : canonicalScriptMatchKey(t);
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
  if (masterMod.cdnAlias) {
    seenTargetKeys.add(canonicalScriptMatchKey(masterMod.cdnAlias));
  }
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

  // Also traverse any other root / unvisited modules in logical callflow order so multi-script
  // imports connect and populate the checklist automatically without requiring a synthetic "Main" script
  modules.forEach((mod) => {
    const modKey = canonicalScriptMatchKey(mod.scriptNumber);
    if (!visitedModuleKeys.has(modKey) && (incomingCount.get(modKey) || 0) === 0) {
      traverseModule(mod, 1);
    }
  });
  modules.forEach((mod) => {
    const modKey = canonicalScriptMatchKey(mod.scriptNumber);
    if (!visitedModuleKeys.has(modKey)) {
      traverseModule(mod, 1);
    }
  });

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
  // (Global CCMA time tables such as Sys_SondZeit / Holiday are administered outside .s files and are valid)
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

      const isCommentOnlyRawLine = /^\s*(?:\/\*|\/\/|--|#|rem\b)/i.test(rule.rawLine || '');
      const hasExplicitRoute = Boolean(
        rule.targetNumber ||
          rule.queueTarget ||
          rule.announcement ||
          rule.treatmentInfo ||
          rule.hdxAction ||
          rule.isDisconnect ||
          rule.loopSectionTarget ||
          rule.waitSeconds !== undefined ||
          rule.choices.length > 0 ||
          (rule.condition && rule.condition.trim().length > 0) ||
          isCommentOnlyRawLine ||
          /\b(?:assign|give|queue|dequeue|route|transfer|execute|call|goto|subscript|disconnect|drop|stop|quit|exit|abort|continue|wait|return|send|readvar|set|open|close|log|syslog|print|write|get|put|clear|flush|hold|unhold|conference|consult|park|cancel|event|voice\s+session|play|prompt|collect|digits|speak|record|host|hdx|cti|section|end|if|else|where|when|value|case|otherwise|default)\b/i.test(
            rule.rawLine
          ) ||
          /deaktiviert\s*=\s*0|0\s*=\s*aus/i.test(`${rule.stepName} ${rule.condition || ''}`) ||
          /\b(?:default_skillset|sys_team_skillset|sys_ueberlauf_skillset|sys_musik|sys_sondstat|sys_sondrouting|sys_besetztgrund|sys_retour_zentrale|sys_ws_[a-z0-9_]+|sys_[a-z0-9_]+|gv_[a-z0-9_]+|cv_[a-z0-9_]+|lv_[a-z0-9_]+|skillset|queue|warteschlange|inaktiv|reserve|dummy|platzhalter|fallback|standard|sonstige)\b/i.test(
            `${rule.stepName} ${rule.condition || ''} ${rule.rawLine}`
          )
      );
      const isDeactivatedOverflow =
        /deaktiviert\s*=\s*0/i.test(`${rule.stepName} ${rule.condition || ''}`) &&
        !rule.targetNumber &&
        !rule.queueTarget;
      const hasExplicitTodoMarker = /(?:\?\?\?|\b(?:TODO|TBD|OFFEN|UNKLAR|KLÄREN)\b)/i.test(
        `${rule.stepName} ${rule.rawLine}`
      );
      const isTerminalOrInitLabel =
        /^(?:init\b|ende\b|end\b|stopp?\b|weiter\b|abwurf|auflegen|mailbox|voicemail|anrufbeantworter|fax|ansage|begrüßung|begruessung|willkommen|musik|wartemusik|start|call-men[uü]|men[uü]|menue|auswahl|menu|rücksprung|ruecksprung|routing|entscheider|entscheidung|weiche|verzweigung|prüfung|pruefung|abfrage|bedingung|inaktiv|reserve|dummy|platzhalter|notiz|kommentar|fallback|standard|sonstige)/i.test(
          rule.stepName.trim()
        ) ||
        /\b(?:abwurf|auflegen|mailbox|voicemail|anrufbeantworter|fax|ivr|hangup|disconnect|call-men[uü]|men[uü]|menue|auswahl|menu|ansage|musik|wartemusik|begrüßung|willkommen|rücksprung|ruecksprung|entscheider|entscheidung|weiche|verzweigung|event\s+handler|voice\s+session)\b/i.test(
          rule.stepName
        );

      const isOverflowRule =
        /\b(?:überlauf|ueberlauf|overflow)\b/i.test(rule.stepName) ||
        /\b(?:überlauf|ueberlauf|overflow)\b/i.test(rule.rawLine) ||
        Boolean(rule.queueTarget);

      const moduleHasOutgoingTarget =
        mod.outgoingNumbers.length > 0 ||
        manualLinks.some((lnk) => canonicalScriptMatchKey(lnk.fromScriptNumber) === modKey);

      const isVisioLastUnclear =
        mod.origin === 'visio-new' &&
        idx === sorted.length - 1 &&
        !hasExplicitRoute &&
        !isTerminalOrInitLabel &&
        !isOverflowRule &&
        !moduleHasOutgoingTarget;
      const isUnclearBranch =
        /\?/.test(rule.stepName) &&
        !hasExplicitRoute &&
        !isOverflowRule &&
        !isTerminalOrInitLabel &&
        !moduleHasOutgoingTarget &&
        idx === sorted.length - 1;

      if (hasExplicitTodoMarker || isVisioLastUnclear || isUnclearBranch) {
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

    // 3b. Script-level completeness check: If a loaded script has no actionable routing rules at all
    // Skip helper/config/parameter/CCMA-SondZeit/OCL scripts that contain valid Avaya directives in rawText
    // or any script module that is already connected to another script module (incoming or outgoing).
    const modAliasKeys = new Set<string>([modKey]);
    const suffixKey = canonicalScriptMatchKey(toMermaidNodeSuffix(mod.scriptNumber));
    if (suffixKey) modAliasKeys.add(suffixKey);
    if (mod.cdnAlias) modAliasKeys.add(canonicalScriptMatchKey(mod.cdnAlias));
    const trimmedName = (mod.scriptName || '').trim();
    if (trimmedName.length >= 3) {
      modAliasKeys.add(canonicalScriptMatchKey(trimmedName));
      const cleanNameToken = trimmedName.replace(/\s+/g, '_');
      modAliasKeys.add(canonicalScriptMatchKey(cleanNameToken));
    }
    if (mod.visioPageName && mod.visioPageName.trim().length >= 3) {
      modAliasKeys.add(canonicalScriptMatchKey(mod.visioPageName));
    }
    if (mod.sourceFilename) {
      const baseFile = mod.sourceFilename.replace(/\.[^.]+$/, '').trim();
      if (baseFile.length >= 3) {
        modAliasKeys.add(canonicalScriptMatchKey(baseFile));
      }
    }
    const hasValidAvayaDirectivesInRaw = Boolean(
      mod.rawText &&
        /(?:\b(?:assign|give|queue|dequeue|route|transfer|execute|exec|run|call|goto|jump|subscript|disconnect|drop|stop|quit|exit|wait|return|send|readvar|set|open|close|log|print|write|get|put|clear|event|voice\s+session|play|prompt|collect|digits|speak|record|host|hdx|cti|section|where|if|else|when|value|case|otherwise|default|sondzeit|sys_sondzeit|holiday|entscheider|entscheidung|treatment|announcement|ansage|skillset|music|musik|ran|cdn|ivr|fax|voicemail|mailbox|overflow|ueberlauf|überlauf|script|skript|include|redirect|forward|dial|hangup|terminate|release|const|var|def|define)\b|->|=>|→)/i.test(
          mod.rawText
        )
    );
    const hasIncomingCaller = modules.some(
      (other) =>
        canonicalScriptMatchKey(other.scriptNumber) !== modKey &&
        (other.outgoingNumbers.some((t) => modAliasKeys.has(canonicalScriptMatchKey(t))) ||
          other.rules.some(
            (r) =>
              (r.targetNumber && modAliasKeys.has(canonicalScriptMatchKey(r.targetNumber))) ||
              r.choices.some((c) => modAliasKeys.has(canonicalScriptMatchKey(c.targetNumber)))
          ))
    );
    const hasModuleLinkOrOutgoing =
      mod.outgoingNumbers.length > 0 ||
      hasIncomingCaller ||
      manualLinks.some(
        (lnk) =>
          modAliasKeys.has(canonicalScriptMatchKey(lnk.fromScriptNumber)) ||
          modAliasKeys.has(canonicalScriptMatchKey(lnk.toTargetNumber))
      );
    if (
      mod.rules.length === 0 &&
      !mod.isAnnouncementEndpoint &&
      !hasValidAvayaDirectivesInRaw &&
      !hasModuleLinkOrOutgoing
    ) {
      const id = `unclear:${modKey}:empty-module`;
      const rec = resolvedMap[id];
      issues.push({
        id,
        type: 'unclear-transition',
        status: rec ? 'resolved' : 'open',
        sourceScriptNumber: mod.scriptNumber,
        title: `Unvollständiges Skript [${mod.scriptNumber}]`,
        question: `Aus dem eingelesenen Skript [${mod.scriptNumber}] konnten noch keine Routing-Regeln, Skillsets oder Zielverweise extrahiert werden. Bitte prüfen Sie den Skript-Inhalt oder ergänzen Sie das Ziel manuell.`,
        resolution: rec?.resolution,
        resolutionNote: rec?.note,
        linkedTargetNumber: rec?.linkedTargetNumber,
        createdAt: now,
        resolvedAt: rec?.resolvedAt,
      });
    }
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
  const baseExternalEndpoints = dedupeRefsByCanonicalKey(prevState?.externalEndpoints);
  const ignoredChecklistTargets = dedupeRefsByCanonicalKey(prevState?.ignoredChecklistTargets);
  const externalKeySet = new Set(baseExternalEndpoints.map(canonicalScriptMatchKey));
  const ignoredKeySet = new Set(ignoredChecklistTargets.map(canonicalScriptMatchKey));
  const manualLinks = prevState?.manualLinks || [];
  const resolvedIssues = prevState?.resolvedIssues || {};
  const manualQuestions = prevState?.manualQuestions || [];
  const treatUnresolvedAsEndpoint =
    prevState?.treatUnresolvedAsEndpoint ?? modules.length >= 2;

  const knownKeyToDisplay = new Map<string, string>();
  modules.forEach((m) => {
    const primaryKey = canonicalScriptMatchKey(m.scriptNumber);
    if (primaryKey) {
      knownKeyToDisplay.set(primaryKey, m.scriptNumber);
    }
    if (m.cdnAlias) {
      const aliasKey = canonicalScriptMatchKey(m.cdnAlias);
      if (aliasKey && !knownKeyToDisplay.has(aliasKey)) {
        knownKeyToDisplay.set(aliasKey, m.scriptNumber);
      }
    }
    const nameToken = (m.scriptName || '').trim().replace(/\s+/g, '_');
    if (
      nameToken &&
      isValidScriptRef(nameToken) &&
      !/^(?:main|start|skript_)/i.test(nameToken)
    ) {
      const nameKey = canonicalScriptMatchKey(nameToken);
      if (nameKey && !knownKeyToDisplay.has(nameKey)) {
        knownKeyToDisplay.set(nameKey, m.scriptNumber);
      }
    }
  });

  // Inherit DNIS / VALUE numbers and Organization from any Master Dispatcher module (`Main`) onto the called entry scripts
  const inheritedDnisByKey = new Map<string, Set<string>>();
  const inheritedOrgaByKey = new Map<string, string>();
  modules.forEach((mod) => {
    if (!isPureMasterDispatcherModule(mod, modules.length)) return;
    mod.rules.forEach((rule) => {
      const rawTargets: string[] = [];
      if (rule.targetNumber) rawTargets.push(rule.targetNumber);
      rule.choices.forEach((c) => {
        if (c.targetNumber) rawTargets.push(c.targetNumber);
      });
      rawTargets.forEach((rawT) => {
        const clean = normalizeScriptRef(rawT);
        const resolved = knownKeyToDisplay.get(canonicalScriptMatchKey(clean)) || clean;
        const tKey = canonicalScriptMatchKey(resolved);
        if (!tKey) return;
        if (rule.valueNumbers && rule.valueNumbers.length > 0) {
          const set = inheritedDnisByKey.get(tKey) || new Set<string>();
          rule.valueNumbers.forEach((v) => set.add(v));
          inheritedDnisByKey.set(tKey, set);
        }
        const orgLabel = rule.organizationName || rule.brandName;
        if (orgLabel && !inheritedOrgaByKey.has(tKey)) {
          inheritedOrgaByKey.set(
            tKey,
            rule.orgaCode ? `${orgLabel} (${rule.orgaCode})` : orgLabel
          );
        }
      });
    });
  });

  const missingByKey = new Map<string, string>();
  const autoExternalByKey = new Map<string, string>();
  baseExternalEndpoints.forEach((ext) => {
    autoExternalByKey.set(canonicalScriptMatchKey(ext), ext);
  });

  const normalizedModules = modules
    .map((mod) => {
      const outMap = new Map<string, string>();
      const selfKey = canonicalScriptMatchKey(mod.scriptNumber);
      const selfAliasKey = mod.cdnAlias ? canonicalScriptMatchKey(mod.cdnAlias) : '';

      const resolveCanonicalTarget = (rawTarget: string): string => {
        const clean = normalizeScriptRef(rawTarget);
        const tKey = canonicalScriptMatchKey(clean);
        return knownKeyToDisplay.get(tKey) || clean;
      };

      const sortedRules = [...mod.rules]
        .sort((a, b) => a.prio - b.prio)
        .map((r) => ({
          ...r,
          targetNumber: r.targetNumber ? resolveCanonicalTarget(r.targetNumber) : undefined,
          choices: r.choices.map((c) => ({
            ...c,
            targetNumber: resolveCanonicalTarget(c.targetNumber),
          })),
        }));

      const recordTarget = (rawTarget: string, isExternalRoute = false) => {
        const clean = normalizeScriptRef(rawTarget);
        const rawKey = canonicalScriptMatchKey(clean);
        if (!clean || ignoredKeySet.has(rawKey) || isDeactivatedSentinelTarget(clean)) return;
        const canonicalDisplay = knownKeyToDisplay.get(rawKey) || clean;
        const tKey = canonicalScriptMatchKey(canonicalDisplay);
        if (ignoredKeySet.has(tKey) || isDeactivatedSentinelTarget(canonicalDisplay)) return;

        if (tKey !== selfKey && (!selfAliasKey || tKey !== selfAliasKey)) {
          outMap.set(tKey, canonicalDisplay);
        }

        if (!knownKeyToDisplay.has(tKey) && !externalKeySet.has(tKey)) {
          // Automatically classify Sonderansagen / announcement endpoints, dynamic Avaya variables,
          // external phone/Fax/IVR/Skillset targets, ROUTE CALL external targets, or unresolvable targets
          // in a multi-script export as endpoints rather than missing-script errors
          if (
            isExternalRoute ||
            isAnnouncementOrEndpointTargetName(canonicalDisplay) ||
            treatUnresolvedAsEndpoint
          ) {
            autoExternalByKey.set(tKey, canonicalDisplay);
            externalKeySet.add(tKey);
          } else {
            missingByKey.set(tKey, canonicalDisplay);
          }
        }
      };

      sortedRules.forEach((r) => {
        if (r.targetNumber) recordTarget(r.targetNumber, Boolean(r.isExternalRouteCall));
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

      const inheritedDnis = inheritedDnisByKey.get(selfKey);
      const mergedDnis = inheritedDnis
        ? Array.from(new Set([...(mod.entryDnisNumbers || []), ...inheritedDnis]))
        : mod.entryDnisNumbers;
      const mergedOrga = mod.entryOrganizationName || inheritedOrgaByKey.get(selfKey);

      return {
        ...mod,
        entryDnisNumbers: mergedDnis && mergedDnis.length > 0 ? mergedDnis : undefined,
        entryOrganizationName: mergedOrga,
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

  const externalEndpoints = dedupeRefsByCanonicalKey(Array.from(autoExternalByKey.values()));
  const missingTargets = Array.from(missingByKey.values());
  const issues = detectWorkspaceIssues(normalizedModules, missingTargets, {
    externalEndpoints,
    ignoredChecklistTargets,
    resolvedIssues,
    manualQuestions,
    manualLinks,
    treatUnresolvedAsEndpoint,
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
    treatUnresolvedAsEndpoint,
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

export function getModuleOpeningHoursSummary(
  mod: ScriptModule,
  workspace?: ScriptWorkspace
): {
  scheduleText: string;
  holidayText: string;
  combinedBadge: string;
} {
  const schedules: string[] = [];
  const holidays: string[] = [];

  for (const r of mod.rules) {
    if (r.schedule && r.schedule.trim()) {
      const s = r.schedule.trim();
      const resolved = resolveScheduleWithSondZeit(s, mod, workspace).displayText;
      if (resolved && !schedules.includes(resolved)) schedules.push(resolved);
    }
    if (r.holiday && r.holiday.trim()) {
      const h = r.holiday.trim();
      if (!holidays.includes(h)) holidays.push(h);
    }
    if ((!r.schedule || !r.holiday) && r.condition) {
      const det = extractReadableScheduleAndHolidayFromText(r.condition);
      if (det.schedule) {
        const resolved = resolveScheduleWithSondZeit(det.schedule, mod, workspace).displayText;
        if (resolved && !schedules.includes(resolved)) schedules.push(resolved);
      }
      if (det.holiday && !holidays.includes(det.holiday)) {
        holidays.push(det.holiday);
      }
    }
  }

  // Fallback: If no rule had a schedule, check module rawText or referenced SondZeit
  if (schedules.length === 0) {
    const fallback = resolveScheduleWithSondZeit('', mod, workspace);
    if (fallback.displayText && (fallback.hasConcreteTimes || fallback.scriptReference)) {
      schedules.push(fallback.displayText);
    }
  }

  const scheduleText = schedules.slice(0, 2).join(' · ');
  const holidayText = holidays.slice(0, 2).join(' · ');
  const badgeParts: string[] = [];
  if (scheduleText) badgeParts.push(scheduleText);
  if (holidayText) badgeParts.push(holidayText);

  return {
    scheduleText,
    holidayText,
    combinedBadge: badgeParts.join(' · '),
  };
}

/**
 * EBENE 1: Generates the clean Callflow Overview Mermaid diagram combining
 * text scripts and graphical Visio flows without an artificial `Main` hub node,
 * chaining scripts logically (`Einstiegs-Skript -> Folgeskript -> Skillset / Sonderansage`).
 */
export function buildMasterOverviewMermaid(
  workspace: ScriptWorkspace,
  direction: DiagramDirection = 'LR',
  options?: { compact?: boolean }
): string {
  if (workspace.modules.length === 0) {
    return `flowchart ${direction}\n    Empty["Keine Skripte im Callflow geladen"]`;
  }

  const isCompactMode = Boolean(options?.compact);
  const lines: string[] = [`flowchart ${direction}`];
  const incomingCounts = new Map<string, number>();
  const externalKeySet = new Set((workspace.externalEndpoints || []).map(canonicalScriptMatchKey));
  const ignoredKeySet = new Set(
    (workspace.ignoredChecklistTargets || []).map(canonicalScriptMatchKey)
  );

  // Always exclude pure Master Dispatcher (`Main`) modules from being rendered as a star-hub node
  const dispatcherModules = workspace.modules.filter((m) =>
    isPureMasterDispatcherModule(m, workspace.modules.length)
  );
  const nonDispatcherModules = workspace.modules.filter(
    (m) => !isPureMasterDispatcherModule(m, workspace.modules.length)
  );

  // If ONLY `Main` is loaded in workspace.modules so far (before sub-scripts are resolved),
  // render the entry scripts referenced in `Main` grouped cleanly without drawing a `Main` hub node or 265-line fan!
  if (nonDispatcherModules.length === 0 && dispatcherModules.length > 0) {
    const entryByKey = new Map<
      string,
      { ref: string; orga: string; dnisList: string[]; isAnn: boolean }
    >();
    dispatcherModules.forEach((m) => {
      m.rules.forEach((r) => {
        const targets: string[] = [];
        if (r.targetNumber) targets.push(r.targetNumber);
        r.choices.forEach((c) => {
          if (c.targetNumber) targets.push(c.targetNumber);
        });
        targets.forEach((rawT) => {
          const clean = normalizeScriptRef(rawT);
          const key = canonicalScriptMatchKey(clean);
          if (!clean || !key || ignoredKeySet.has(key)) return;
          const existing = entryByKey.get(key) || {
            ref: clean,
            orga: r.organizationName || r.brandName || 'Einstiegs-Skripte',
            dnisList: [],
            isAnn: isAnnouncementOrEndpointTargetName(clean),
          };
          if (r.valueNumbers) {
            r.valueNumbers.forEach((v) => {
              if (!existing.dnisList.includes(v)) existing.dnisList.push(v);
            });
          }
          entryByKey.set(key, existing);
        });
      });
    });

    if (entryByKey.size === 0) {
      return `flowchart ${direction}\n    Empty["Keine Einstiegs-Skripte erkannt"]`;
    }

    const entries = Array.from(entryByKey.values()).slice(0, 80);
    entries.forEach((entry) => {
      const suffix = toMermaidNodeSuffix(entry.ref);
      const safeRef = sanitizeMermaidText(entry.ref);
      const dnisTag =
        entry.dnisList.length > 0
          ? ` · DNIS ${sanitizeMermaidText(entry.dnisList.slice(0, 3).join(', '))}${
              entry.dnisList.length > 3 ? ` (+${entry.dnisList.length - 3})` : ''
            }`
          : '';
      const orgaTag =
        entry.orga && entry.orga !== 'Einstiegs-Skripte'
          ? ` · ${sanitizeMermaidText(entry.orga)}`
          : '';
      if (entry.isAnn) {
        lines.push(`    S_${suffix}[("■ 🔊 ${safeRef}${orgaTag}${dnisTag}")]`);
      } else {
        lines.push(`    S_${suffix}(["▶ ${safeRef}${orgaTag}${dnisTag}"])`);
      }
    });
    return lines.join('\n');
  }

  const candidateModules = nonDispatcherModules;

  const knownKeyToMod = new Map<string, ScriptModule>();
  candidateModules.forEach((m) => {
    knownKeyToMod.set(canonicalScriptMatchKey(m.scriptNumber), m);
    if (m.cdnAlias) {
      const aliasKey = canonicalScriptMatchKey(m.cdnAlias);
      if (aliasKey && !knownKeyToMod.has(aliasKey)) {
        knownKeyToMod.set(aliasKey, m);
      }
    }
    const nameToken = (m.scriptName || '').trim().replace(/\s+/g, '_');
    if (nameToken && isValidScriptRef(nameToken) && !/^(?:main|start)$/i.test(nameToken)) {
      const nameKey = canonicalScriptMatchKey(nameToken);
      if (nameKey && !knownKeyToMod.has(nameKey)) {
        knownKeyToMod.set(nameKey, m);
      }
    }
  });

  // Compute incoming script-to-script counts strictly among candidateModules (excluding Main dispatcher)
  candidateModules.forEach((m) => incomingCounts.set(canonicalScriptMatchKey(m.scriptNumber), 0));
  candidateModules.forEach((m) => {
    m.outgoingNumbers.forEach((target) => {
      const rawKey = canonicalScriptMatchKey(target);
      if (ignoredKeySet.has(rawKey)) return;
      const matched = knownKeyToMod.get(rawKey);
      const tKey = matched ? canonicalScriptMatchKey(matched.scriptNumber) : rawKey;
      if (ignoredKeySet.has(tKey)) return;
      incomingCounts.set(tKey, (incomingCounts.get(tKey) || 0) + 1);
    });
  });

  // Track which scripts are entry scripts called from Main
  const calledByDispatcherKeys = new Set<string>();
  dispatcherModules.forEach((m) => {
    m.outgoingNumbers.forEach((target) => {
      const rawKey = canonicalScriptMatchKey(target);
      const matched = knownKeyToMod.get(rawKey);
      calledByDispatcherKeys.add(
        matched ? canonicalScriptMatchKey(matched.scriptNumber) : rawKey
      );
    });
  });

  const moduleHasActiveQueue = (mod: ScriptModule): boolean =>
    mod.rules.some(
      (r) =>
        Boolean(r.queueTarget && r.queueTarget !== 'Default_Skillset') &&
        !/\(deaktiviert\s*=\s*0\)/i.test(r.stepName)
    );

  // In large multi-script exports (>10 modules), keep all scripts that have incoming/outgoing script calls,
  // active skillset queues, or are referenced by Main while skipping unreferenced legacy ("Altlast") scripts
  const connectedCandidates = candidateModules.filter((m) => {
    const mKey = canonicalScriptMatchKey(m.scriptNumber);
    const inCount = incomingCounts.get(mKey) || 0;
    const outCount = m.outgoingNumbers.length;
    return (
      inCount > 0 ||
      outCount > 0 ||
      moduleHasActiveQueue(m) ||
      calledByDispatcherKeys.has(mKey) ||
      Boolean(m.entryDnisNumbers && m.entryDnisNumbers.length > 0)
    );
  });
  const activeModules =
    candidateModules.length > 10 && connectedCandidates.length > 0
      ? connectedCandidates
      : candidateModules;

  const activeModuleKeySet = new Set<string>();
  activeModules.forEach((m) => {
    activeModuleKeySet.add(canonicalScriptMatchKey(m.scriptNumber));
    if (m.cdnAlias) {
      activeModuleKeySet.add(canonicalScriptMatchKey(m.cdnAlias));
    }
  });

  const referencedExternalTargets = new Map<string, string>();
  const referencedMissingTargets = new Map<string, string>();
  const externalRouteTargetKeys = new Set<string>();
  const skillsetsMap = new Map<
    string,
    { nodeId: string; name: string; kind: 'skillset' | 'network-skillset' | 'agent' | 'cdn' }
  >();

  activeModules.forEach((m) => {
    m.rules.forEach((r) => {
      if (r.isExternalRouteCall && r.targetNumber) {
        const matched = knownKeyToMod.get(canonicalScriptMatchKey(r.targetNumber));
        const resolvedRef = matched ? matched.scriptNumber : r.targetNumber;
        externalRouteTargetKeys.add(canonicalScriptMatchKey(resolvedRef));
      }
    });

    m.outgoingNumbers.forEach((target) => {
      const rawKey = canonicalScriptMatchKey(target);
      if (ignoredKeySet.has(rawKey)) return;
      const matched = knownKeyToMod.get(rawKey);
      const resolvedRef = matched ? matched.scriptNumber : target;
      const tKey = canonicalScriptMatchKey(resolvedRef);
      if (ignoredKeySet.has(tKey)) return;
      if (!activeModuleKeySet.has(tKey)) {
        if (
          externalKeySet.has(tKey) ||
          externalRouteTargetKeys.has(tKey) ||
          workspace.treatUnresolvedAsEndpoint ||
          isAnnouncementOrEndpointTargetName(resolvedRef)
        ) {
          referencedExternalTargets.set(tKey, resolvedRef);
        } else {
          referencedMissingTargets.set(tKey, resolvedRef);
        }
      }
    });

    m.rules.forEach((rule) => {
      if (
        rule.queueTarget &&
        rule.queueTarget !== 'Default_Skillset' &&
        !/\(deaktiviert\s*=\s*0\)/i.test(rule.stepName)
      ) {
        const kind = rule.queueKind || 'skillset';
        const qKey = `${kind}:${canonicalScriptMatchKey(rule.queueTarget)}`;
        if (!skillsetsMap.has(qKey)) {
          const prefix =
            kind === 'network-skillset' ? 'NQ' : kind === 'agent' ? 'AG' : 'Q';
          skillsetsMap.set(qKey, {
            nodeId: `${prefix}_${toMermaidNodeSuffix(rule.queueTarget)}`,
            name: rule.queueTarget,
            kind,
          });
        }
      }
    });
  });

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

  let hasOpenIssueNodes = false;

  activeModules.forEach((mod) => {
    const mKey = canonicalScriptMatchKey(mod.scriptNumber);
    const id = `S_${toMermaidNodeSuffix(mod.scriptNumber)}`;
    const safeName = sanitizeMermaidText(mod.scriptName);
    const safeRef = sanitizeMermaidText(mod.scriptNumber);
    const inCount = incomingCounts.get(mKey) || 0;
    const outCount = mod.outgoingNumbers.length;
    const hasQueue = moduleHasActiveQueue(mod);
    const hasChoices = mod.rules.some((r) => r.choices.length > 0);
    const openCount = openCountByKey.get(mKey) || 0;

    const openTag = openCount > 0 ? `● ${openCount} Offen · ` : '';
    const openClassSuffix = openCount > 0 ? ':::openIssue' : '';
    if (openCount > 0) hasOpenIssueNodes = true;

    const isMainModule =
      mKey === 'main' ||
      (mod.isMaster && /^(?:main|start|master(?:script)?)$/i.test(mKey));
    const showBothNameAndRef =
      !isMainModule &&
      canonicalScriptMatchKey(mod.scriptName) !== mKey &&
      mod.scriptName !== `Skript ${mod.scriptNumber}` &&
      mod.scriptName !== 'Main (Masterscript)';
    const aliasHint =
      mod.cdnAlias && canonicalScriptMatchKey(mod.cdnAlias) !== mKey
        ? isMainModule
          ? ` (Start-Ref ${sanitizeMermaidText(mod.cdnAlias)})`
          : ` (CDN ${sanitizeMermaidText(mod.cdnAlias)})`
        : '';
    const baseLabel = isMainModule
      ? `${openTag}Main${aliasHint}`
      : showBothNameAndRef
      ? `${openTag}${safeRef} · ${safeName}${aliasHint}`
      : `${openTag}${safeRef}${aliasHint}`;

    const dnisPreview =
      mod.entryDnisNumbers && mod.entryDnisNumbers.length > 0
        ? mod.entryDnisNumbers.slice(0, isCompactMode ? 2 : 3).join(', ') +
          (mod.entryDnisNumbers.length > (isCompactMode ? 2 : 3)
            ? ` (+${mod.entryDnisNumbers.length - (isCompactMode ? 2 : 3)})`
            : '')
        : '';
    const hoursSummary = getModuleOpeningHoursSummary(mod, workspace);

    let label: string;
    if (isCompactMode) {
      // Compact high-performance Master mode: at most 1 concise secondary metadata line per script node
      const modQueues = Array.from(
        new Set(
          mod.rules
            .filter(
              (r) =>
                Boolean(r.queueTarget && r.queueTarget !== 'Default_Skillset') &&
                !/\(deaktiviert\s*=\s*0\)/i.test(r.stepName)
            )
            .map((r) => r.queueTarget as string)
        )
      );
      const compactBits: string[] = [];
      if (dnisPreview) {
        compactBits.push(`📞 ${sanitizeMermaidText(dnisPreview)}`);
      }
      if (hoursSummary.combinedBadge) {
        compactBits.push(`🕒 ${sanitizeMermaidText(hoursSummary.combinedBadge.slice(0, 34))}`);
      }
      if (modQueues.length > 0) {
        const qLabel =
          modQueues.length === 1
            ? modQueues[0].slice(0, 24)
            : `${modQueues[0].slice(0, 18)} (+${modQueues.length - 1})`;
        compactBits.push(`🎧 ${sanitizeMermaidText(qLabel)}`);
      }
      const compactLine =
        compactBits.length > 0 ? `<br/>${compactBits.slice(0, 2).join(' · ')}` : '';
      label = `${baseLabel}${compactLine}`;
    } else {
      const orgaAndDnisParts = [
        mod.entryOrganizationName ? `🏢 ${sanitizeMermaidText(mod.entryOrganizationName)}` : '',
        dnisPreview ? `📞 ${sanitizeMermaidText(dnisPreview)}` : '',
      ].filter(Boolean);
      const dnisBadge = orgaAndDnisParts.length > 0 ? `<br/>${orgaAndDnisParts.join(' · ')}` : '';

      const hoursBadge = hoursSummary.combinedBadge
        ? `<br/>🕒 ${sanitizeMermaidText(hoursSummary.combinedBadge)}`
        : '';

      // Collect CCMA Intrinsics, Wait Cycles / Loop Sections, Broadcasts/Treatments, and HDX/CTI actions directly for Master display
      const intrinsicList: string[] = [];
      const loopTargets: string[] = [];
      const waitList: number[] = [];
      const mediaList: string[] = [];
      const hdxList: string[] = [];

      mod.rules.forEach((r) => {
        (r.intrinsicMetrics || []).forEach((metric) => {
          if (!intrinsicList.includes(metric)) intrinsicList.push(metric);
        });
        if (r.loopSectionTarget && !loopTargets.includes(r.loopSectionTarget)) {
          loopTargets.push(r.loopSectionTarget);
        }
        if (r.waitSeconds !== undefined && !waitList.includes(r.waitSeconds)) {
          waitList.push(r.waitSeconds);
        }
        if (r.treatmentInfo && !mediaList.includes(r.treatmentInfo)) {
          mediaList.push(r.treatmentInfo);
        } else if (r.announcement && !mediaList.includes(r.announcement)) {
          mediaList.push(r.announcement);
        }
        if (r.hdxAction && !hdxList.includes(r.hdxAction)) {
          hdxList.push(r.hdxAction);
        }
      });

      const ccmaIntrinsicsBadge =
        intrinsicList.length > 0
          ? `<br/>📊 ${sanitizeMermaidText(intrinsicList.slice(0, 3).join(' · '))}${
              intrinsicList.length > 3 ? ` (+${intrinsicList.length - 3})` : ''
            }`
          : '';

      const cycleParts: string[] = [];
      if (loopTargets.length > 0) {
        cycleParts.push(`🔄 Zyklus (${loopTargets.slice(0, 2).join(', ')})`);
      }
      if (waitList.length > 0) {
        cycleParts.push(`⏳ Wait ${waitList.slice(0, 2).map((s) => `${s}s`).join('/')}`);
      }
      if (mediaList.length > 0) {
        const hasBroadcastOrTreat = mediaList.some((m) => /broadcast|treatment|ivr/i.test(m));
        cycleParts.push(
          `${hasBroadcastOrTreat ? '📢' : '🎵'} ${mediaList.slice(0, 2).join(' · ')}`
        );
      }
      if (hdxList.length > 0) {
        cycleParts.push(`🗄️ ${hdxList.slice(0, 2).join(' · ')}`);
      }
      const ccmaCycleBadge =
        cycleParts.length > 0 ? `<br/>${sanitizeMermaidText(cycleParts.join(' · '))}` : '';

      label = `${baseLabel}${dnisBadge}${hoursBadge}${ccmaIntrinsicsBadge}${ccmaCycleBadge}`;
    }

    const isAnnEndpoint =
      Boolean(mod.isAnnouncementEndpoint) ||
      (outCount === 0 && !hasQueue && isAnnouncementOrEndpointTargetName(mod.scriptNumber));

    if (isAnnEndpoint) {
      lines.push(`    ${id}[("■ 🔊 ${label}")]${openClassSuffix}`);
    } else if (inCount === 0 && (outCount > 0 || hasQueue)) {
      lines.push(`    ${id}(["▶ ${label}"])${openClassSuffix}`);
    } else if (hasChoices || outCount >= 2) {
      lines.push(`    ${id}{{"◆ ${label}"}}${openClassSuffix}`);
    } else if (outCount === 0 && !hasQueue) {
      lines.push(`    ${id}[("■ ${label}")]${openClassSuffix}`);
    } else {
      lines.push(`    ${id}["${label}"]${openClassSuffix}`);
    }
  });

  referencedMissingTargets.forEach((targetRef) => {
    if (ignoredKeySet.has(canonicalScriptMatchKey(targetRef))) return;
    hasOpenIssueNodes = true;
    const suffix = toMermaidNodeSuffix(targetRef);
    const safeRef = sanitizeMermaidText(targetRef);
    lines.push(`    S_${suffix}["● OFFEN · ${safeRef} (Fehlendes Skript)"]:::missingScript`);
  });

  if (!isCompactMode) {
    referencedExternalTargets.forEach((targetRef) => {
      const tKey = canonicalScriptMatchKey(targetRef);
      const suffix = toMermaidNodeSuffix(targetRef);
      const safeRef = sanitizeMermaidText(targetRef);
      const isAnn = isAnnouncementOrEndpointTargetName(targetRef);
      const isRouteCall = externalRouteTargetKeys.has(tKey);
      const endLabel = isAnn
        ? `■ 🔊 ${safeRef} · Sonderansage / Endpunkt`
        : isRouteCall
        ? `↗ Route Call: ${safeRef} (Extern)`
        : `■ ${safeRef} · Endpunkt`;
      lines.push(`    S_${suffix}[("${endLabel}")]`);
    });

    skillsetsMap.forEach((sk) => {
      const safeSkill = sanitizeMermaidText(sk.name);
      if (sk.kind === 'network-skillset') {
        lines.push(`    ${sk.nodeId}[("🌐 Network-Skillset: ${safeSkill}")]`);
      } else if (sk.kind === 'agent') {
        lines.push(`    ${sk.nodeId}(["👤 Agent-Queue: ${safeSkill}"])`);
      } else {
        lines.push(`    ${sk.nodeId}[("🎧 Skillset: ${safeSkill}")]`);
      }
    });
  }

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
    if (fromNodeId === toNodeId) return;
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
    const rawToKey = canonicalScriptMatchKey(toRef);
    const matchedMod = knownKeyToMod.get(rawToKey);
    const resolvedToRef = matchedMod ? matchedMod.scriptNumber : toRef;
    const toKey = canonicalScriptMatchKey(resolvedToRef);
    if (ignoredKeySet.has(toKey) && !knownKeyToMod.has(toKey)) return;
    // In compact mode, omit external endpoint nodes (already summarized on script cards)
    if (isCompactMode && !activeModuleKeySet.has(toKey) && !referencedMissingTargets.has(toKey)) {
      return;
    }
    const fromSuffix = toMermaidNodeSuffix(fromRef);
    const toSuffix = toMermaidNodeSuffix(resolvedToRef);
    addAggregatedRawEdge(`S_${fromSuffix}`, `S_${toSuffix}`, tag, isChoice);
  };

  activeModules.forEach((mod) => {
    const fromNodeId = `S_${toMermaidNodeSuffix(mod.scriptNumber)}`;
    mod.rules.forEach((rule) => {
      const condBit =
        isCompactMode
          ? ''
          : rule.intrinsicMetrics && rule.intrinsicMetrics.length > 0
          ? rule.intrinsicMetrics.slice(0, 2).join(', ')
          : rule.condition && !/^(?:Skillset aktiv|Sonst)/i.test(rule.condition)
          ? rule.condition
          : '';
      const waitBit = !isCompactMode && rule.waitSeconds !== undefined ? `WAIT ${rule.waitSeconds}s` : '';

      if (rule.targetNumber) {
        const schedDisplay = rule.schedule
          ? resolveScheduleWithSondZeit(rule.schedule, mod, workspace).displayText
          : '';
        const baseTag =
          rule.valueNumbers && rule.valueNumbers.length > 0
            ? `VALUE ${rule.valueNumbers.slice(0, isCompactMode ? 2 : 5).join(', ')}`
            : schedDisplay
            ? `🕒 ${isCompactMode ? schedDisplay.slice(0, 22) : schedDisplay}`
            : rule.holiday
            ? `📅 ${rule.holiday}`
            : rule.isExternalRouteCall
            ? `Route Call (P${rule.prio})`
            : `P${rule.prio}`;
        const tag = [baseTag, condBit, waitBit].filter(Boolean).join(' · ');
        addAggregatedEdge(
          mod.scriptNumber,
          rule.targetNumber,
          tag,
          Boolean(rule.isExternalRouteCall && !knownKeyToMod.has(canonicalScriptMatchKey(rule.targetNumber)))
        );
      }
      rule.choices.forEach((ch) => {
        const isNamed = /^(?:Feiertag|Zeitplan|Bedingung|Sprung|Retour)$/i.test(ch.choice);
        const tag = isNamed ? ch.choice : `Taste ${ch.choice}`;
        addAggregatedEdge(mod.scriptNumber, ch.targetNumber, tag, true);
      });
      if (
        !isCompactMode &&
        rule.queueTarget &&
        rule.queueTarget !== 'Default_Skillset' &&
        !/\(deaktiviert\s*=\s*0\)/i.test(rule.stepName)
      ) {
        const kind = rule.queueKind || 'skillset';
        const sk = skillsetsMap.get(`${kind}:${canonicalScriptMatchKey(rule.queueTarget)}`);
        if (sk) {
          const isOverflow = /überlauf|overflow/i.test(rule.stepName);
          const qBase =
            kind === 'network-skillset'
              ? `Network-Queue (P${rule.prio})`
              : kind === 'agent'
              ? `Agent (P${rule.prio})`
              : isOverflow
              ? `Überlauf (P${rule.prio})`
              : `Queue (P${rule.prio})`;
          const qTag = [qBase, condBit, waitBit].filter(Boolean).join(' · ');
          addAggregatedRawEdge(fromNodeId, sk.nodeId, qTag, isOverflow || kind === 'network-skillset');
        }
      }
    });
  });

  (workspace.manualLinks || []).forEach((lnk) => {
    if (
      lnk.fromScriptNumber &&
      lnk.toTargetNumber &&
      activeModuleKeySet.has(canonicalScriptMatchKey(lnk.fromScriptNumber))
    ) {
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
    const isNumberList = edge.tags.length > 0 && edge.tags.every((t) => /^\d{2,10}$/.test(t));
    const maxShow = isCompactMode ? 2 : isNumberList ? 5 : 4;
    const joined = edge.tags.slice(0, maxShow).join(isNumberList ? ', ' : ' · ');
    const suffixExtra = edge.tags.length > maxShow ? ` (+${edge.tags.length - maxShow})` : '';
    const rawLabel = joined ? `${isNumberList ? 'VALUE ' : ''}${joined}${suffixExtra}` : '';
    const label = isCompactMode && rawLabel.length > 36 ? `${rawLabel.slice(0, 33)}…` : rawLabel;
    const labelPart = label ? sanitizeMermaidEdgeLabel(label) : '';
    lines.push(`    ${edge.fromNodeId} ${arrow}${labelPart} ${edge.toNodeId}`);
  }

  if (referencedMissingTargets.size > 0 || hasOpenIssueNodes) {
    lines.push('');
    if (hasOpenIssueNodes) {
      lines.push('    classDef openIssue stroke:#ef4444,stroke-width:2.5px;');
    }
    if (referencedMissingTargets.size > 0) {
      lines.push('    classDef missingScript stroke-dasharray: 5 5,stroke:#ef4444;');
    }
  }

  return lines.join('\n');
}

/**
 * Ultra-safe fallback Master overview graph guaranteed to parse cleanly in Mermaid v11/v12
 * without creating an artificial `Main` star hub.
 */
export function buildSafeFallbackMasterMermaid(
  workspace: ScriptWorkspace,
  direction: DiagramDirection = 'LR'
): string {
  if (workspace.modules.length === 0) {
    return `flowchart ${direction}\n    Empty["Keine Skripte im Callflow geladen"]`;
  }
  const lines: string[] = [`flowchart ${direction}`];
  const nonDispatcher = workspace.modules.filter(
    (m) => !isPureMasterDispatcherModule(m, workspace.modules.length)
  );
  if (nonDispatcher.length === 0) {
    const seen = new Set<string>();
    workspace.modules.forEach((m) => {
      m.outgoingNumbers.slice(0, 60).forEach((t) => {
        const id = `S_${toMermaidNodeSuffix(t)}`;
        if (!seen.has(id)) {
          seen.add(id);
          lines.push(`    ${id}(["▶ ${toMermaidNodeSuffix(t)}"])`);
        }
      });
    });
    if (seen.size === 0) {
      lines.push(`    Empty["Keine Einstiegs-Skripte erkannt"]`);
    }
    return lines.join('\n');
  }
  const activeModules = nonDispatcher;

  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  activeModules.forEach((mod) => {
    const fromId = `S_${toMermaidNodeSuffix(mod.scriptNumber)}`;
    if (!seenNodes.has(fromId)) {
      seenNodes.add(fromId);
      lines.push(`    ${fromId}["${toMermaidNodeSuffix(mod.scriptNumber)}"]`);
    }
    mod.outgoingNumbers.forEach((target) => {
      const toId = `S_${toMermaidNodeSuffix(target)}`;
      if (!seenNodes.has(toId)) {
        seenNodes.add(toId);
        lines.push(`    ${toId}["${toMermaidNodeSuffix(target)}"]`);
      }
      const edgeKey = `${fromId}->${toId}`;
      if (fromId !== toId && !seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        lines.push(`    ${fromId} --> ${toId}`);
      }
    });
  });

  return lines.join('\n');
}

/**
 * Re-parses stored text modules using the current AACC / multi-script parser so workspaces
 * persisted in localStorage before parser upgrades are automatically repaired on load.
 */
export function rehydrateAndUpgradeWorkspace(rawWorkspace: ScriptWorkspace): ScriptWorkspace {
  const upgradedModules: ScriptModule[] = [];
  const isFramedHeaderJunkRule = (rule: ScriptRule): boolean => {
    const hasRoutingData = Boolean(
      rule.targetNumber ||
        rule.choices.length > 0 ||
        rule.queueTarget ||
        rule.announcement ||
        rule.treatmentInfo ||
        rule.hdxAction ||
        rule.condition ||
        rule.schedule ||
        rule.holiday ||
        rule.isDisconnect ||
        rule.loopSectionTarget ||
        rule.waitSeconds !== undefined ||
        (rule.valueNumbers && rule.valueNumbers.length > 0)
    );
    if (hasRoutingData) return false;
    const stepTrim = (rule.stepName || '').trim();
    const rawTrim = (rule.rawLine || '').trim();
    return (
      (/^[=\-*#]{2,}\s*.*?\s*[=\-*#]{2,}$/.test(stepTrim) && !/(?:->|=>|→|\||;)/.test(stepTrim)) ||
      (/^[=\-*#]{2,}\s*.*?\s*[=\-*#]{2,}$/.test(rawTrim) && !/(?:->|=>|→|\||;)/.test(rawTrim))
    );
  };

  for (const mod of rawWorkspace.modules || []) {
    const strippedLegacyRules = (mod.rules || []).filter((r) => !isFramedHeaderJunkRule(r));
    if (mod.origin === 'visio-new' || !mod.rawText || !mod.rawText.trim()) {
      const cleanedBase =
        strippedLegacyRules.length !== (mod.rules || []).length
          ? { ...mod, rules: strippedLegacyRules }
          : mod;
      const cleaned =
        canonicalScriptMatchKey(cleanedBase.scriptNumber) === 'main' ||
        cleanedBase.scriptName === 'Main (Masterscript)'
          ? { ...cleanedBase, scriptNumber: 'Main', scriptName: 'Main', isMaster: true }
          : cleanedBase;
      upgradedModules.push(cleaned);
      continue;
    }
    const isGenericMainOrStart = /^(?:main|start|master(?:script)?)$/i.test(mod.scriptNumber || '');
    const reparsed = parseCallflowTextWithFallback(mod.rawText, {
      defaultScriptNumber: isGenericMainOrStart ? undefined : mod.scriptNumber,
      defaultScriptName:
        isGenericMainOrStart || mod.scriptName === 'Main (Masterscript)'
          ? undefined
          : mod.scriptName,
      sourceFilename: mod.sourceFilename,
      origin: mod.origin,
      isMasterHint: mod.isMaster && isGenericMainOrStart,
    });
    if (reparsed.length > 0) {
      for (const rm of reparsed) {
        const cleanRules = (rm.rules || []).filter((r) => !isFramedHeaderJunkRule(r));
        upgradedModules.push({
          ...rm,
          rules: cleanRules,
          cdnAlias: rm.cdnAlias || (reparsed.length === 1 ? mod.cdnAlias : undefined),
          entryOrganizationName:
            rm.entryOrganizationName ||
            (reparsed.length === 1 ? mod.entryOrganizationName : undefined),
        });
      }
    } else {
      upgradedModules.push(
        strippedLegacyRules.length !== (mod.rules || []).length
          ? { ...mod, rules: strippedLegacyRules }
          : mod
      );
    }
  }

  // Deduplicate upgradedModules by canonical key
  let deduped = mergeScriptModules([], upgradedModules);
  if (deduped.length > 0 && deduped.some((m) => m.isMaster)) {
    const primaryMaster = deduped.find((m) => m.isMaster);
    if (primaryMaster && canonicalScriptMatchKey(primaryMaster.scriptNumber) === 'main') {
      deduped = promoteEntryModuleToMain(deduped, primaryMaster.scriptNumber);
    }
  }

  return buildScriptWorkspace(deduped, {
    externalEndpoints: rawWorkspace.externalEndpoints,
    ignoredChecklistTargets: rawWorkspace.ignoredChecklistTargets,
    resolvedIssues: rawWorkspace.resolvedIssues,
    manualQuestions: rawWorkspace.manualQuestions,
    manualLinks: rawWorkspace.manualLinks,
    masterScriptNumber: rawWorkspace.masterScriptNumber,
    nodeOffsets: rawWorkspace.nodeOffsets,
    treatUnresolvedAsEndpoint:
      rawWorkspace.treatUnresolvedAsEndpoint ?? deduped.length >= 2,
  });
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
  const mod = workspace.modules.find(
    (m) =>
      canonicalScriptMatchKey(m.scriptNumber) === targetKey ||
      (m.cdnAlias && canonicalScriptMatchKey(m.cdnAlias) === targetKey)
  );
  if (!mod) {
    return buildMasterOverviewMermaid(workspace, direction);
  }

  const modKey = canonicalScriptMatchKey(mod.scriptNumber);
  const modSuffix = toMermaidNodeSuffix(mod.scriptNumber);
  const moduleByKey = new Map<string, ScriptModule>();
  workspace.modules.forEach((m) => {
    moduleByKey.set(canonicalScriptMatchKey(m.scriptNumber), m);
    if (m.cdnAlias) {
      const aliasKey = canonicalScriptMatchKey(m.cdnAlias);
      if (aliasKey && !moduleByKey.has(aliasKey)) {
        moduleByKey.set(aliasKey, m);
      }
    }
  });
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
  const isMainDetailModule =
    modKey === 'main' ||
    (mod.isMaster && /^(?:main|start|master(?:script)?)$/i.test(modKey));
  const selfPrefix = selfOpenCount > 0 ? `● ${selfOpenCount} Offen · ` : '';
  const showDetailBoth =
    !isMainDetailModule &&
    canonicalScriptMatchKey(mod.scriptName) !== modKey &&
    mod.scriptName !== `Skript ${mod.scriptNumber}` &&
    mod.scriptName !== 'Main (Masterscript)';
  const dnisInfo =
    mod.entryDnisNumbers && mod.entryDnisNumbers.length > 0
      ? `<br/>📞 DNIS: ${sanitizeMermaidText(mod.entryDnisNumbers.slice(0, 5).join(', '))}`
      : '';
  const entryLabel = isMainDetailModule
    ? `${selfPrefix}Main (Einstiegsskript)${dnisInfo}`
    : showDetailBoth
    ? `${selfPrefix}[${safeModRef}] ${safeModName}${dnisInfo}`
    : `${selfPrefix}${safeModRef}${dnisInfo}`;
  lines.push(
    `    ${entryId}(["★ ${entryLabel}"])${selfOpenCount > 0 ? ':::openIssue' : ''}`
  );

  const incomingCallers: Array<{ fromNum: string; fromSuffix: string; fromName: string; tag: string }> = [];
  workspace.modules.forEach((other) => {
    if (canonicalScriptMatchKey(other.scriptNumber) === modKey) return;
    if (isPureMasterDispatcherModule(other, workspace.modules.length)) return;
    const tags: string[] = [];
    other.rules.forEach((r) => {
      if (r.targetNumber && canonicalScriptMatchKey(r.targetNumber) === modKey) {
        tags.push(`Prio ${r.prio}`);
      }
      r.choices.forEach((c) => {
        if (canonicalScriptMatchKey(c.targetNumber) === modKey) {
          const isNamed = /^(?:Feiertag|Zeitplan|Bedingung|Sprung|Retour)$/i.test(c.choice);
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
      const callerDisplay =
        canonicalScriptMatchKey(caller.fromNum) === 'main'
          ? 'Main (Einstiegsskript)'
          : caller.fromName &&
            canonicalScriptMatchKey(caller.fromName) !== canonicalScriptMatchKey(caller.fromNum)
          ? `[${caller.fromNum}] ${caller.fromName}`
          : caller.fromNum;
      lines.push(
        `        INC_${caller.fromSuffix}(["← ${sanitizeMermaidText(callerDisplay)}"])`
      );
    });
    lines.push('    end');
    incomingCallers.forEach((caller) => {
      lines.push(`    INC_${caller.fromSuffix} -->${sanitizeMermaidEdgeLabel(caller.tag)} ${entryId}`);
    });
  }

  lines.push(
    isMainDetailModule
      ? `    subgraph ScriptBody["Main (Einstiegsskript)"]`
      : showDetailBoth
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
    const targetMod = moduleByKey.get(tKey);
    const effectiveNum = targetMod ? targetMod.scriptNumber : cleanTarget;
    const suffix = toMermaidNodeSuffix(effectiveNum);
    const jumpId = `JUMP_${suffix}`;
    const isConfirmedExt =
      externalKeySet.has(tKey) || isAnnouncementOrEndpointTargetName(cleanTarget);
    externalJumpRefs.set(canonicalScriptMatchKey(effectiveNum), {
      num: effectiveNum,
      suffix,
      name: targetMod
        ? targetMod.scriptName
        : isAnnouncementOrEndpointTargetName(cleanTarget)
        ? 'Sonderansage / Endpunkt'
        : isConfirmedExt
        ? 'Endpunkt'
        : 'Nicht geladen',
      known: Boolean(targetMod),
      externalConfirmed: isConfirmedExt,
    });
    return jumpId;
  };

  const firstStepBySection = new Map<string, string>();
  sortedRules.forEach((rule, idx) => {
    if (rule.sectionName) {
      const secKey = canonicalScriptMatchKey(rule.sectionName);
      if (secKey && !firstStepBySection.has(secKey)) {
        firstStepBySection.set(secKey, `STEP_${modSuffix}_${idx + 1}`);
      }
    }
  });

  sortedRules.forEach((rule, idx) => {
    const stepId = `STEP_${modSuffix}_${idx + 1}`;
    const hasBranching =
      rule.choices.length > 0 ||
      Boolean(rule.condition || rule.schedule || (rule.intrinsicMetrics && rule.intrinsicMetrics.length > 0));
    const isStepOpen = openRuleIds.has(rule.id);
    if (isStepOpen) hasOpenStep = true;

    const metaParts: string[] = [
      `${isStepOpen ? '● OFFEN · ' : ''}Prio ${rule.prio}: ${sanitizeMermaidText(rule.stepName)}`,
    ];
    if (rule.sectionName) {
      metaParts.push(`Abschnitt: ${sanitizeMermaidText(rule.sectionName)}`);
    }
    if (rule.eventName) {
      metaParts.push(`Event: ${sanitizeMermaidText(rule.eventName)}`);
    }
    if (rule.organizationName) {
      const orgTag = rule.orgaCode
        ? `${rule.organizationName} (${rule.orgaCode})`
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
    if (rule.schedule) {
      const resolved = resolveScheduleWithSondZeit(rule.schedule, mod, workspace).displayText;
      metaParts.push(`🕒 Öffnungszeiten: ${sanitizeMermaidText(resolved)}`);
    }
    if (rule.holiday) {
      metaParts.push(`📅 Feiertag: ${sanitizeMermaidText(rule.holiday)}`);
    }
    if (rule.intrinsicMetrics && rule.intrinsicMetrics.length > 0) {
      metaParts.push(`📊 CCMA: ${sanitizeMermaidText(rule.intrinsicMetrics.join(' · '))}`);
    }
    if (rule.condition) metaParts.push(`Bedingung: ${sanitizeMermaidText(rule.condition)}`);
    if (rule.treatmentInfo) {
      metaParts.push(`📢 Treatment: ${sanitizeMermaidText(rule.treatmentInfo)}`);
    } else if (rule.announcement) {
      metaParts.push(`Ansage: ${sanitizeMermaidText(rule.announcement)}`);
    }
    if (rule.hdxAction) {
      metaParts.push(`🗄️ CTI/HDX: ${sanitizeMermaidText(rule.hdxAction)}`);
    }
    if (rule.skillsetPriority !== undefined) {
      metaParts.push(`Queue-Prio: ${rule.skillsetPriority}`);
    }
    if (rule.waitSeconds !== undefined) {
      metaParts.push(`Wartezeit: ${rule.waitSeconds}s`);
    }

    const stepLabel = metaParts.join('<br/>');
    const stepSuffix = isStepOpen ? ':::openIssue' : '';

    if (hasBranching) {
      lines.push(`        ${stepId}{{"${stepLabel}"}}${stepSuffix}`);
    } else if (rule.isDisconnect) {
      lines.push(`        ${stepId}(["■ ${stepLabel}"])${stepSuffix}`);
    } else {
      lines.push(`        ${stepId}["${stepLabel}"]${stepSuffix}`);
    }

    if (idx === 0) {
      lines.push(`        ${entryId} --> ${stepId}`);
    } else {
      lines.push(`        ${prevStepId} -.->|Fallback / Weiter| ${stepId}`);
    }
    prevStepId = stepId;

    if (rule.loopSectionTarget) {
      const targetStepId = firstStepBySection.get(canonicalScriptMatchKey(rule.loopSectionTarget));
      if (targetStepId && targetStepId !== stepId) {
        lines.push(
          `        ${stepId} -.->${sanitizeMermaidEdgeLabel(`↻ Zyklus: ${rule.loopSectionTarget}`)} ${targetStepId}`
        );
      }
    }

    if (rule.queueTarget) {
      const qKey = sanitizeNodeKey(rule.queueTarget);
      const qPrefix =
        rule.queueKind === 'network-skillset'
          ? 'NQ'
          : rule.queueKind === 'agent'
          ? 'AG'
          : 'QUEUE';
      const qId = `${qPrefix}_${qKey}`;
      const qKindLabel =
        rule.queueKind === 'network-skillset'
          ? '🌐 Network-Skillset'
          : rule.queueKind === 'agent'
          ? '👤 Agent-Queue'
          : '🎧 Queue';
      const qLabel =
        rule.skillsetPriority !== undefined
          ? `${qKindLabel}: ${sanitizeMermaidText(rule.queueTarget)} (Prio ${rule.skillsetPriority})`
          : `${qKindLabel}: ${sanitizeMermaidText(rule.queueTarget)}`;
      queueNodes.set(qId, {
        id: qId,
        label: qLabel,
      });
      lines.push(
        `        ${stepId} -->${sanitizeMermaidEdgeLabel(rule.queueKind === 'network-skillset' ? 'Network-Queue' : 'Queue')} ${qId}`
      );
    }

    let targetHandledBySubNode = false;
    if (rule.schedule) {
      const resolvedSched = resolveScheduleWithSondZeit(rule.schedule, mod, workspace).displayText;
      const schedNodeId = `SCHED_${modSuffix}_${idx}`;
      const schedLabel = `🕒 Öffnungszeiten: ${resolvedSched}`;
      lines.push(`        ${schedNodeId}(["${sanitizeMermaidText(schedLabel)}"])`);
      lines.push(`        ${stepId} -->${sanitizeMermaidEdgeLabel(`Zeitbedingung`)} ${schedNodeId}`);
      if (rule.targetNumber) {
        targetHandledBySubNode = true;
        if (canonicalScriptMatchKey(rule.targetNumber) === modKey) {
          lines.push(`        ${schedNodeId} -->${sanitizeMermaidEdgeLabel(`↻ Rücksprung`)} ${entryId}`);
        } else {
          const jumpId = registerExternalJump(rule.targetNumber);
          lines.push(`        ${schedNodeId} -->${sanitizeMermaidEdgeLabel(`Ziel`)} ${jumpId}`);
        }
      }
    }

    if (rule.holiday) {
      const holidayNodeId = `HOLIDAY_${modSuffix}_${idx}`;
      const holidayLabel = `📅 Feiertag: ${rule.holiday}`;
      lines.push(`        ${holidayNodeId}(["${sanitizeMermaidText(holidayLabel)}"])`);
      lines.push(`        ${stepId} -->${sanitizeMermaidEdgeLabel(`Feiertag`)} ${holidayNodeId}`);
      if (rule.targetNumber) {
        targetHandledBySubNode = true;
        if (canonicalScriptMatchKey(rule.targetNumber) === modKey) {
          lines.push(`        ${holidayNodeId} -->${sanitizeMermaidEdgeLabel(`↻ Rücksprung`)} ${entryId}`);
        } else {
          const jumpId = registerExternalJump(rule.targetNumber);
          lines.push(`        ${holidayNodeId} -->${sanitizeMermaidEdgeLabel(`Ziel`)} ${jumpId}`);
        }
      }
    }

    if (rule.targetNumber && !targetHandledBySubNode) {
      if (canonicalScriptMatchKey(rule.targetNumber) === modKey) {
        lines.push(`        ${stepId} -.->${sanitizeMermaidEdgeLabel(`↻ Schleife ${safeModRef}`)} ${entryId}`);
      } else {
        const jumpId = registerExternalJump(rule.targetNumber);
        const edgeText = rule.isExternalRouteCall
          ? `Route Call: ${rule.targetNumber}`
          : `Wohin: ${rule.targetNumber}`;
        lines.push(`        ${stepId} -->${sanitizeMermaidEdgeLabel(edgeText)} ${jumpId}`);
      }
    }

    rule.choices.forEach((ch, cIdx) => {
      const isNamed = /^(?:Feiertag|Zeitplan|Bedingung|Sprung)$/i.test(ch.choice);
      const baseChoiceText = isNamed ? ch.choice : `Taste ${ch.choice}`;
      const choiceNodeId = `CHOICE_${modSuffix}_${idx}_${cIdx}`;
      const choiceLabel = ch.label
        ? `DTMF ${ch.choice}: ${ch.label}`
        : `DTMF ${ch.choice}`;

      lines.push(`        ${choiceNodeId}(["${sanitizeMermaidText(choiceLabel)}"])`);
      lines.push(`        ${stepId} -->${sanitizeMermaidEdgeLabel(`Wahl ${ch.choice}`)} ${choiceNodeId}`);

      if (canonicalScriptMatchKey(ch.targetNumber) === modKey) {
        lines.push(`        ${choiceNodeId} -->${sanitizeMermaidEdgeLabel(`↻ Rücksprung`)} ${entryId}`);
      } else {
        const jumpId = registerExternalJump(ch.targetNumber);
        lines.push(`        ${choiceNodeId} -->${sanitizeMermaidEdgeLabel(ch.label || `Ziel`)} ${jumpId}`);
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

  if (sortedRules.length === 0 && queueNodes.size === 0) {
    const emptyBodyNodeId = `BODY_INFO_${modSuffix}`;
    lines.push(
      `        ${emptyBodyNodeId}(["✓ ${mod.isAnnouncementEndpoint ? 'Endpunkt / Ansage' : 'Hilfs-/Prüfskript (keine Sub-Regeln)'}"])`
    );
    lines.push(`        ${entryId} --> ${emptyBodyNodeId}`);
  }

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
  const aliasToPrimaryKey = new Map<string, string>();
  const registerModuleAlias = (alias: string | undefined, primaryKey: string) => {
    if (!alias) return;
    const trimmed = alias.trim();
    if (!trimmed) return;
    const candidates = [
      trimmed,
      trimmed.replace(/\.s$/i, ''),
      trimmed.replace(/\s+/g, '_'),
      trimmed.replace(/_/g, ' '),
    ];
    candidates.forEach((cand) => {
      const key = canonicalScriptMatchKey(cand);
      if (key && !aliasToPrimaryKey.has(key)) {
        aliasToPrimaryKey.set(key, primaryKey);
      }
    });
  };

  modules.forEach((m) => {
    const primaryKey = canonicalScriptMatchKey(m.scriptNumber);
    if (!primaryKey) return;
    moduleByKey.set(primaryKey, m);
    aliasToPrimaryKey.set(primaryKey, primaryKey);
    registerModuleAlias(m.scriptNumber, primaryKey);
    registerModuleAlias(toMermaidNodeSuffix(m.scriptNumber), primaryKey);
    registerModuleAlias(m.cdnAlias, primaryKey);
    const trimmedName = (m.scriptName || '').trim();
    if (trimmedName.length >= 3 && !/^(?:main|start)$/i.test(trimmedName)) {
      registerModuleAlias(trimmedName, primaryKey);
    }
    if (m.visioPageName && m.visioPageName.trim().length >= 3) {
      registerModuleAlias(m.visioPageName, primaryKey);
    }
    if (m.sourceFilename) {
      const baseFile = m.sourceFilename.replace(/\.[^.]+$/, '').trim();
      if (baseFile.length >= 3) {
        registerModuleAlias(baseFile, primaryKey);
      }
    }
  });

  const resolveModuleKey = (ref: string | undefined): string => {
    if (!ref) return '';
    const rawKey = canonicalScriptMatchKey(ref);
    return aliasToPrimaryKey.get(rawKey) || rawKey;
  };

  // Build adjacency map (including rule targets, choices, manual links, masterChecklist & resolvedIssues)
  const adjacency = new Map<string, Set<string>>();
  const callersByTarget = new Map<string, Set<string>>();
  const checklistConnectedKeys = new Set<string>();
  const recordEdge = (fromRef: string | undefined, toRef: string | undefined) => {
    const fromKey = resolveModuleKey(fromRef);
    const toKey = resolveModuleKey(toRef);
    if (!fromKey || !toKey) return;
    if (!adjacency.has(fromKey)) adjacency.set(fromKey, new Set());
    if (fromKey !== toKey) {
      adjacency.get(fromKey)!.add(toKey);
      if (!callersByTarget.has(toKey)) callersByTarget.set(toKey, new Set());
      callersByTarget.get(toKey)!.add(fromRef || fromKey);
    }
  };

  modules.forEach((m) => {
    const k = canonicalScriptMatchKey(m.scriptNumber);
    if (!adjacency.has(k)) adjacency.set(k, new Set());
    m.outgoingNumbers.forEach((out) => recordEdge(m.scriptNumber, out));
    m.rules.forEach((r) => {
      if (r.targetNumber) recordEdge(m.scriptNumber, r.targetNumber);
      r.choices.forEach((c) => {
        if (c.targetNumber) recordEdge(m.scriptNumber, c.targetNumber);
      });
    });
  });

  (workspace.manualLinks || []).forEach((lnk) => {
    recordEdge(lnk.fromScriptNumber, lnk.toTargetNumber);
  });

  (workspace.masterChecklist || []).forEach((item) => {
    const callerRef = item.callerScriptNumber || item.parentScriptNumber;
    const targetRef = item.matchedModuleNumber || item.refKey;
    if (callerRef && targetRef) {
      recordEdge(callerRef, targetRef);
    }
    if (item.status === 'present' && targetRef) {
      const targetKey = resolveModuleKey(targetRef);
      if (targetKey) checklistConnectedKeys.add(targetKey);
    }
  });

  const externalEndpointKeys = new Set(
    (workspace.externalEndpoints || []).map((e) => resolveModuleKey(e))
  );
  const resolvedIssueKeys = new Set<string>();
  Object.entries(workspace.resolvedIssues || {}).forEach(([issueId, rec]) => {
    const parts = issueId.split(':');
    const sourceKey = parts.length >= 2 ? resolveModuleKey(parts[1]) : '';
    if (sourceKey) {
      resolvedIssueKeys.add(sourceKey);
      if (rec?.linkedTargetNumber) {
        recordEdge(sourceKey, rec.linkedTargetNumber);
      }
    }
  });

  // Helper to classify whether a cycle hop is an intentional/guarded Avaya return
  // (Sys_Retour_Zentrale, Überlauf, DTMF Menü, WAIT/Queue/Announcement loop, OCL guard, or shared helper/sub-script)
  const isSharedHelperOrSubScript = (mod: ScriptModule | undefined): boolean => {
    if (!mod) return false;
    const label = `${mod.scriptNumber} ${mod.scriptName || ''}`;
    return /(?:^|[_.\-\s])(?:sub|helper|hilfs|check|pruef|prüf|warteschleife|wait|ansage|sprachauswahl|oeffnung|öffnung|zeit|feiertag|sonder|notfall|zentrale|haupt|main|ivr|queue|skill|retour|men[uü]|menue)(?:$|[_.\-\s\d])/i.test(
      label
    );
  };

  const isCycleHopIntentionalOrGuarded = (fromKey: string, toKey: string): boolean => {
    const fromMod = moduleByKey.get(fromKey);
    const toMod = moduleByKey.get(toKey);
    if (!fromMod) return false;
    if (isSharedHelperOrSubScript(fromMod) || isSharedHelperOrSubScript(toMod)) {
      return true;
    }

    const matchingRules = fromMod.rules.filter((rule) => {
      const directTargetMatch =
        rule.targetNumber && canonicalScriptMatchKey(rule.targetNumber) === toKey;
      const choiceTargetMatch = rule.choices.some(
        (c) => c.targetNumber && canonicalScriptMatchKey(c.targetNumber) === toKey
      );
      return Boolean(directTargetMatch || choiceTargetMatch);
    });

    // Module-level WAIT, Queue, Announcement, Section loop, or OCL guard inside fromMod
    const hasModuleWaitOrQueueStep = fromMod.rules.some(
      (r) =>
        Boolean(r.queueTarget) ||
        r.waitSeconds !== undefined ||
        Boolean(r.announcement) ||
        Boolean(r.treatmentInfo) ||
        Boolean(r.loopSectionTarget) ||
        r.choices.length > 0
    );
    if (hasModuleWaitOrQueueStep) {
      return true;
    }

    if (matchingRules.length === 0) {
      return /\b(?:sys_retour_zentrale|retour|überlauf|ueberlauf|overflow|zurück|zurueck|men[uü]|collect|wait|queue|give|section|event|if|where|value|case|when|otherwise|default|return)\b/i.test(
        fromMod.rawText || ''
      );
    }

    return matchingRules.some((rule) => {
      const meta = `${rule.stepName} ${rule.condition || ''} ${rule.rawLine || ''}`;
      const isRetourOrOverflow =
        /\b(?:sys_retour_zentrale|retour|rücksprung|ruecksprung|überlauf|ueberlauf|overflow)\b/i.test(
          meta
        );
      const isMenuBack =
        rule.choices.length > 0 ||
        /\b(?:men[uü]|menue|taste|dtmf|auswahl|zurück|zurueck|hauptmen[uü]|call-men[uü]|collect)\b/i.test(
          meta
        );
      const isWaitQueueOrPrompt =
        Boolean(rule.queueTarget) ||
        rule.waitSeconds !== undefined ||
        Boolean(rule.announcement) ||
        Boolean(rule.treatmentInfo) ||
        Boolean(rule.loopSectionTarget) ||
        Boolean(rule.isExternalRouteCall);
      const hasExplicitGuard = Boolean(
        (rule.condition && rule.condition.trim().length > 0) ||
          (rule.schedule && rule.schedule.trim().length > 0) ||
          (rule.holiday && rule.holiday.trim().length > 0) ||
          /\b(?:if|where|value|case|when|otherwise|default|wait|queue|give|section|event|return)\b/i.test(
            rule.rawLine || ''
          )
      );
      return isRetourOrOverflow || isMenuBack || isWaitQueueOrPrompt || hasExplicitGuard;
    });
  };

  // 1. Detect multi-module cycles (distinguish intentional/guarded returns as 'info' vs unconditional infinite loops as 'error')
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

            // Inspect every hop along the cycle: if any hop is a guarded/intentional return, downgrade to 'info'
            let hasIntentionalReturnHop = false;
            for (let idx = 0; idx < cycleKeys.length; idx++) {
              const hopFrom = cycleKeys[idx];
              const hopTo = cycleKeys[(idx + 1) % cycleKeys.length];
              if (isCycleHopIntentionalOrGuarded(hopFrom, hopTo)) {
                hasIntentionalReturnHop = true;
                break;
              }
            }

            if (hasIntentionalReturnHop) {
              findings.push({
                id: `health:cycle:${signature}`,
                severity: 'info',
                category: 'cycle',
                scriptNumber: entryMod.scriptNumber,
                scriptName: entryMod.scriptName,
                title: `Bewusster Rücksprung-Kreislauf (${displayChain.join(' → ')})`,
                description: `Zwischen den Skripten existiert ein bedingter oder Avaya-typischer Rücksprung (${displayChain.join(
                  ' → '
                )}), z. B. über Sys_Retour_Zentrale, Überlauf, Warteschlange, WAIT-/Ansage-Schleife, Menü-Zurück oder ein gemeinsames Hilfsskript. Kein struktureller Fehler.`,
                recommendation:
                  'Nur zur Kontrolle: Stellen Sie sicher, dass die Rücksprung-Bedingung (Überlauf, Wartezeit, Menü-Taste oder Zähler) wie gewünscht greift.',
                cyclePath: displayChain,
              });
            } else {
              findings.push({
                id: `health:cycle:${signature}`,
                severity: 'error',
                category: 'cycle',
                scriptNumber: entryMod.scriptNumber,
                scriptName: entryMod.scriptName,
                title: `Unbedingte Skript-Schleife (${displayChain.join(' → ')})`,
                description: `Zwischen den Skripten besteht ein unbedingter geschlossener Rücksprung-Kreislauf (${displayChain.join(
                  ' → '
                )}) ohne erkannte Bedingung, Wartezeit, Warteschlange oder Menü-Auswahl.`,
                recommendation:
                  'Prüfen Sie die Übergänge und ergänzen Sie eine Bedingung, Zeit-/Überlauf-Schwelle oder einen Abbruch-Zähler.',
                cyclePath: displayChain,
              });
            }
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

  // 2. Per-module & per-rule checks (focused strictly on genuine structural errors;
  //    Entscheider, conditions, manual/graph links, sequential steps, and duplicate priorities are valid)
  const manualLinks = workspace.manualLinks || [];

  const isDecisionOrFlowRule = (rule: ScriptRule): boolean => {
    const meta = `${rule.stepName} ${rule.condition || ''} ${rule.rawLine || ''}`;
    return (
      Boolean(rule.condition && rule.condition.trim().length > 0) ||
      /\?/.test(rule.stepName) ||
      /\b(?:entscheider|entscheidung|verzweigung|weiche|prüfung|pruefung|abfrage|bedingung|filter|router|verteiler|schalter|status|zeit|zeitplan|feiertag|öffnungszeit|oeffnungszeit|sonderzeit|notfall|decision|branch|switch|check|if|where|when|case|value|otherwise|default|else)\b/i.test(
        meta
      )
    );
  };

  const isRuleActionable = (
    rule: ScriptRule,
    mod: ScriptModule,
    modKey: string,
    ruleIdx: number,
    totalRules: number,
    modHasAttachedScriptModule: boolean,
    modHasOutgoingScriptModule: boolean
  ): boolean => {
    const stepTrim = rule.stepName.trim();
    const combinedText = `${rule.stepName} ${rule.condition || ''} ${rule.rawLine || ''}`;
    const hasManualLinkForRule = manualLinks.some(
      (lnk) =>
        (resolveModuleKey(lnk.fromScriptNumber) === modKey &&
          (!lnk.fromRuleId || lnk.fromRuleId === rule.id)) ||
        resolveModuleKey(lnk.toTargetNumber) === modKey
    );
    const hasValueOrDnisNumbers =
      Boolean(rule.valueNumbers && rule.valueNumbers.length > 0) ||
      Boolean(mod.entryDnisNumbers && mod.entryDnisNumbers.length > 0 && ruleIdx === 0 && stepTrim.length > 0);
    const hasConnectedFlowForward =
      (ruleIdx < totalRules - 1 && stepTrim.length > 0) ||
      (modHasOutgoingScriptModule && stepTrim.length > 0) ||
      (modHasAttachedScriptModule && stepTrim.length > 0);

    const isCommentOnlyRawLine = /^\s*(?:\/\*|\/\/|--|#|rem\b)/i.test(rule.rawLine || '');
    const isFramedBannerRule =
      (/^[=\-*#]{2,}\s*.*?\s*[=\-*#]{2,}$/.test(stepTrim) && !/(?:->|=>|→|\||;)/.test(stepTrim)) ||
      (/^[=\-*#]{2,}\s*.*?\s*[=\-*#]{2,}$/.test((rule.rawLine || '').trim()) &&
        !/(?:->|=>|→|\||;)/.test(rule.rawLine || ''));
    const strippedBannerKey = canonicalScriptMatchKey(
      stepTrim.replace(/^[=\-*#\s]+|[=\-*#\s]+$/g, '')
    );
    const isSelfHeaderRule =
      Boolean(strippedBannerKey) &&
      (strippedBannerKey === modKey ||
        (mod.scriptName ? strippedBannerKey === canonicalScriptMatchKey(mod.scriptName) : false) ||
        (mod.cdnAlias ? strippedBannerKey === canonicalScriptMatchKey(mod.cdnAlias) : false));
    const hasArrowOrAssignmentInRaw = /(?:->|=>|→)/.test(rule.rawLine || '');

    return (
      Boolean(rule.targetNumber) ||
      rule.choices.length > 0 ||
      Boolean(rule.queueTarget) ||
      Boolean(rule.announcement) ||
      Boolean(rule.treatmentInfo) ||
      Boolean(rule.hdxAction) ||
      Boolean(rule.isDisconnect) ||
      Boolean(rule.loopSectionTarget) ||
      rule.waitSeconds !== undefined ||
      Boolean(rule.schedule) ||
      Boolean(rule.holiday) ||
      Boolean(rule.orgaCode || rule.organizationName || rule.brandName || rule.srcRouteNumber) ||
      hasValueOrDnisNumbers ||
      hasManualLinkForRule ||
      isDecisionOrFlowRule(rule) ||
      hasConnectedFlowForward ||
      isCommentOnlyRawLine ||
      isFramedBannerRule ||
      isSelfHeaderRule ||
      hasArrowOrAssignmentInRaw ||
      Boolean(mod.isAnnouncementEndpoint && stepTrim.length > 0) ||
      /deaktiviert\s*=\s*0|0\s*=\s*aus/i.test(combinedText) ||
      /\b(?:inaktiv|reserve|dummy|platzhalter|notiz|kommentar|fallback|standard|sonstige|default_skillset|sys_ueberlauf_skillset|sys_team_skillset|sys_musik|sys_sondstat|sys_sondrouting|sys_besetztgrund|sys_retour_zentrale|sys_ws_[a-z0-9_]+|sys_[a-z0-9_]+|gv_[a-z0-9_]+|cv_[a-z0-9_]+|lv_[a-z0-9_]+|var_[a-z0-9_]+)\b/i.test(
        combinedText
      ) ||
      /\b(?:assign|give|queue|dequeue|route|transfer|execute|exec|run|call|goto|jump|subscript|disconnect|drop|stop|quit|exit|abort|continue|wait|return|send|readvar|set|open|close|log|syslog|print|write|get|put|clear|flush|hold|unhold|conference|consult|park|cancel|event|voice\s+session|play|prompt|collect|digits|speak|record|host|hdx|cti|section|end|treatment|announcement|skillset|music|ran|cdn|ivr|fax|voicemail|mailbox|overflow|redirect|forward|dial|hangup|terminate|release|include|const|var|def|define)\b/i.test(
        rule.rawLine || ''
      ) ||
      /\b(?:direktruf|durchwahl|dnis|hotline|zentrale|vermittlung|weiterleitung|rufannahme|rufnummer|einstieg|eingang|call-men[uü]|men[uü]|menue|auswahl|abwurf|auflegen|mailbox|voicemail|anrufbeantworter|fax|ivr|ansage|musik|begrüßung|begruessung|willkommen|wartemusik|rücksprung|ruecksprung|routing|event\s+handler|voice\s+session|start|ende|stopp?|weiter|skript|script|sub[_-]?|sc[_-]?)\b/i.test(
        `${rule.stepName} ${rule.condition || ''} ${rule.rawLine || ''}`
      ) ||
      /^(?:Init|DNIS-Range|Assign|Überlauf|Ueberlauf|Overflow|Section|Event|Direktruf|Durchwahl|Einstieg|Start)/i.test(
        stepTrim
      )
    );
  };

  // Precompute all known script module tokens to detect direct module references inside rawText & rules
  const otherModuleTokens = modules.map((m) => {
    const rawCands = [
      m.scriptNumber,
      m.cdnAlias,
      m.scriptName,
      m.sourceFilename ? m.sourceFilename.replace(/\.[^.]+$/, '') : undefined,
      m.visioPageName,
    ].filter((t): t is string => Boolean(t && t.trim().length >= 3));
    const expanded = new Set<string>();
    rawCands.forEach((cand) => {
      const lower = cand.trim().toLowerCase();
      if (lower.length >= 3 && lower !== 'main' && lower !== 'start') {
        expanded.add(lower);
        expanded.add(lower.replace(/\.s$/i, ''));
        expanded.add(lower.replace(/\s+/g, '_'));
        expanded.add(lower.replace(/_/g, ' '));
      }
    });
    return {
      key: canonicalScriptMatchKey(m.scriptNumber),
      tokens: Array.from(expanded).filter((t) => t.length >= 3),
    };
  });

  const moduleSerializedRuleSearchText = new Map<string, string>();
  modules.forEach((m) => {
    const k = canonicalScriptMatchKey(m.scriptNumber);
    const parts: string[] = [];
    if (m.rawText) parts.push(m.rawText);
    m.outgoingNumbers.forEach((o) => parts.push(o));
    m.rules.forEach((r) => {
      parts.push(r.stepName);
      if (r.targetNumber) parts.push(r.targetNumber);
      if (r.condition) parts.push(r.condition);
      if (r.hdxAction) parts.push(r.hdxAction);
      if (r.treatmentInfo) parts.push(r.treatmentInfo);
      if (r.rawLine) parts.push(r.rawLine);
      r.choices.forEach((c) => {
        if (c.targetNumber) parts.push(c.targetNumber);
        if (c.label) parts.push(c.label);
      });
    });
    moduleSerializedRuleSearchText.set(k, parts.join(' ').toLowerCase());
  });

  for (const mod of modules) {
    const modKey = canonicalScriptMatchKey(mod.scriptNumber);
    const sortedRules = [...mod.rules].sort((a, b) => a.prio - b.prio);

    // 2a. Genuine dead-end module check:
    // Any module with an attached incoming/outgoing script module (outgoingNumbers, rule targets/choices,
    // manualLinks, masterChecklist, resolvedIssues, callersByTarget, or direct rawText/rule script reference),
    // announcement/external endpoint, Avaya directives, or actionable rules is a valid Callflow element.
    const hasRawAvayaDirectives = Boolean(
      mod.rawText &&
        /(?:\b(?:assign|give|queue|dequeue|route|transfer|execute|exec|run|call|goto|jump|subscript|disconnect|drop|stop|quit|exit|abort|continue|wait|return|send|readvar|set|open|close|log|syslog|print|write|get|put|clear|flush|hold|unhold|conference|consult|park|cancel|event|voice\s+session|play|prompt|collect|digits|speak|record|host|hdx|cti|section|where|if|else|when|value|case|otherwise|default|end|sondzeit|sys_sondzeit|holiday|entscheider|entscheidung|decision|direktruf|durchwahl|treatment|announcement|ansage|skillset|music|musik|ran|cdn|ivr|fax|voicemail|mailbox|overflow|ueberlauf|überlauf|script|skript|include|redirect|forward|dial|hangup|terminate|release|const|var|def|define)\b|->|=>|→)/i.test(
          mod.rawText
        )
    );
    const hasAnyManualLink = manualLinks.some(
      (l) =>
        resolveModuleKey(l.fromScriptNumber) === modKey ||
        resolveModuleKey(l.toTargetNumber) === modKey
    );
    const hasOutgoingEdge =
      mod.outgoingNumbers.length > 0 ||
      (adjacency.get(modKey)?.size || 0) > 0 ||
      sortedRules.some(
        (r) => Boolean(r.targetNumber) || r.choices.some((c) => Boolean(c.targetNumber))
      );
    const hasIncomingCaller =
      (callersByTarget.get(modKey)?.size || 0) > 0 ||
      checklistConnectedKeys.has(modKey);
    const hasResolvedIssue = resolvedIssueKeys.has(modKey);
    const isConfirmedExternal = externalEndpointKeys.has(modKey);

    const lowerSearchSelf = moduleSerializedRuleSearchText.get(modKey) || '';
    const referencesAnotherLoadedModuleInRaw =
      lowerSearchSelf.length > 0 &&
      otherModuleTokens.some(
        (entry) =>
          entry.key !== modKey &&
          entry.tokens.some((tok) => lowerSearchSelf.includes(tok))
      );
    const ownTokens = otherModuleTokens.find((entry) => entry.key === modKey)?.tokens || [];
    const referencedByAnotherModuleInRaw =
      ownTokens.length > 0 &&
      modules.some((other) => {
        const otherKey = canonicalScriptMatchKey(other.scriptNumber);
        if (otherKey === modKey) return false;
        const otherText = moduleSerializedRuleSearchText.get(otherKey) || '';
        return otherText.length > 0 && ownTokens.some((tok) => otherText.includes(tok));
      });

    const hasAttachedScriptModule =
      hasOutgoingEdge ||
      hasIncomingCaller ||
      hasAnyManualLink ||
      hasResolvedIssue ||
      isConfirmedExternal ||
      referencesAnotherLoadedModuleInRaw ||
      referencedByAnotherModuleInRaw ||
      Boolean(mod.entryDnisNumbers && mod.entryDnisNumbers.length > 0) ||
      Boolean(mod.cdnAlias) ||
      /direktruf|durchwahl|hotline|dnis/i.test(`${mod.scriptNumber} ${mod.scriptName}`);

    const hasAnyActionableStep =
      Boolean(mod.isAnnouncementEndpoint) ||
      hasAttachedScriptModule ||
      sortedRules.some((r, idx) =>
        isRuleActionable(
          r,
          mod,
          modKey,
          idx,
          sortedRules.length,
          hasAttachedScriptModule,
          hasOutgoingEdge || hasAnyManualLink
        )
      ) ||
      hasRawAvayaDirectives;

    if (!hasAnyActionableStep) {
      findings.push({
        id: `health:dead-end-mod:${modKey}`,
        severity: 'error',
        category: 'dead-end-module',
        scriptNumber: mod.scriptNumber,
        scriptName: mod.scriptName,
        title: `Skript [${mod.scriptNumber}] ohne gültige Aktion oder Ziel`,
        description: `In [${mod.scriptNumber}] wurde weder ein Ziel-Skript, eine Warteschlange/Skillset, eine Ansage/Treatment noch ein gültiger Abschluss (Disconnect/Route End) erkannt.`,
        recommendation:
          'Ergänzen Sie ein Ziel-Skript, eine Ansage, ein Ziel-Skillset oder einen expliziten Abschluss.',
      });
    }

    // 2b. Check individual rules strictly for truly empty/isolated steps without action, condition, decision role, or attached script link
    for (let idx = 0; idx < sortedRules.length; idx++) {
      const rule = sortedRules[idx];
      if (
        !isRuleActionable(
          rule,
          mod,
          modKey,
          idx,
          sortedRules.length,
          hasAttachedScriptModule,
          hasOutgoingEdge || hasAnyManualLink
        )
      ) {
        findings.push({
          id: `health:dead-end-rule:${modKey}:${rule.id}`,
          severity: 'error',
          category: 'dead-end-rule',
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName,
          ruleId: rule.id,
          prio: rule.prio,
          title: `Leere Regel ohne Aktion (Prio ${rule.prio}: ${rule.stepName})`,
          description: `Schritt "${rule.stepName}" in [${mod.scriptNumber}] besitzt weder Ziel, Bedingung/Entscheider, Direktruf-Verknüpfung, DTMF-Auswahl, Ansage/Treatment noch Warteschlange.`,
          recommendation:
            'Definieren Sie eine Aktion, Bedingung oder Verknüpfung — oder entfernen Sie die leere Zeile.',
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
 * Extrahiert alle relevanten Avaya-/Callflow-Sonderparameter eines Skripts
 * (Überlauf-Zeiten, Schwellenwerte, Rücksprung-Zentralen, Gesellschaften, Musik-IDs,
 * Besetztgründe, aufgelöste Öffnungszeiten sowie kundenspezifische Variablen)
 * und strukturiert sie mit verständlichen deutschen Bezeichnungen und Einheiten.
 */
export function extractScriptSpecialParameters(
  mod: ScriptModule,
  workspace?: ScriptWorkspace
): CallflowScriptParameterItem[] {
  const items: CallflowScriptParameterItem[] = [];
  const seenKeys = new Set<string>();

  const addParam = (item: CallflowScriptParameterItem) => {
    const k = item.key.toLowerCase();
    if (seenKeys.has(k)) return;
    seenKeys.add(k);
    items.push(item);
  };

  // 1. Collect all ASSIGN statements from rawText
  const varMap = new Map<string, string>();
  if (mod.rawText) {
    const cleaned = stripScriptCommentsAndNoise(mod.rawText);
    const assignToRegex = /\bassign\s+([\s\S]{1,120}?)\s+to\s+([A-Za-z0-9_]+)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = assignToRegex.exec(cleaned)) !== null) {
      const val = m[1].replace(/\s+/g, ' ').trim().replace(/^['"]|['"]$/g, '');
      const varName = m[2].trim();
      varMap.set(varName, val);
    }
    const assignEqRegex = /\bassign\s+([A-Za-z0-9_]+)\s*=\s*([^\r\n;]+)/gi;
    let meq: RegExpExecArray | null;
    while ((meq = assignEqRegex.exec(cleaned)) !== null) {
      const varName = meq[1].trim();
      const val = meq[2].trim().replace(/^['"]|['"]$/g, '');
      if (!/\bto\s+[A-Za-z0-9_]+$/i.test(val) && !varMap.has(varName)) {
        varMap.set(varName, val);
      }
    }
  }

  // A. Überlauf & Schwellenwerte (Category 'overflow')
  const ueberlaufZeit = varMap.get('Sys_Ueberlauf_Zeit');
  if (ueberlaufZeit !== undefined && ueberlaufZeit !== '' && ueberlaufZeit !== '-1') {
    addParam({
      key: 'Sys_Ueberlauf_Zeit',
      label: 'Überlauf-Verzögerung',
      category: 'overflow',
      value: `${ueberlaufZeit}s`,
      rawValue: ueberlaufZeit,
      unit: 's',
      note: 'Wartezeit vor Weiterleitung in Sekunden',
    });
  }

  const ueberlaufSkill =
    varMap.get('Sys_Ueberlauf_Skillset') ||
    mod.rules.find((r) => /[uü]berlauf/i.test(r.stepName) && r.queueTarget)?.queueTarget;
  if (ueberlaufSkill && ueberlaufSkill !== 'Default_Skillset' && ueberlaufSkill !== '-1') {
    addParam({
      key: 'Sys_Ueberlauf_Skillset',
      label: 'Überlauf-Warteschlange',
      category: 'overflow',
      value: ueberlaufSkill,
      rawValue: ueberlaufSkill,
      note: 'Ziel-Skillset bei Überlauf / Nicht-Erreichbarkeit',
    });
  }

  const ueberlaufPrio = varMap.get('Sys_Ueberlauf_Prio');
  if (ueberlaufPrio !== undefined && ueberlaufPrio !== '' && ueberlaufPrio !== '-1') {
    addParam({
      key: 'Sys_Ueberlauf_Prio',
      label: 'Überlauf-Priorität',
      category: 'overflow',
      value: `Prio ${ueberlaufPrio}`,
      rawValue: ueberlaufPrio,
      note: 'Prioritätsstufe in der Überlauf-Warteschlange',
    });
  }

  const ueberlaufRouting = varMap.get('Sys_UeberlaufRouting');
  if (ueberlaufRouting !== undefined && ueberlaufRouting !== '') {
    const isActive = ueberlaufRouting === '1' || ueberlaufRouting.toLowerCase() === 'true';
    addParam({
      key: 'Sys_UeberlaufRouting',
      label: 'Überlauf-Routing Status',
      category: 'overflow',
      value: isActive ? 'Aktiviert (1)' : 'Deaktiviert (0)',
      rawValue: ueberlaufRouting,
      isDefaultOrDisabled: !isActive,
      note: isActive ? 'Überlauf-Weiterleitung ist scharf geschaltet' : 'Überlauf temporär ausgesetzt',
    });
  }

  const wsProzent = varMap.get('Sys_WS_Prozent');
  if (wsProzent !== undefined && wsProzent !== '' && wsProzent !== '-1') {
    addParam({
      key: 'Sys_WS_Prozent',
      label: 'Warteschlangen-Schwelle (%)',
      category: 'overflow',
      value: `${wsProzent}%`,
      rawValue: wsProzent,
      unit: '%',
      note: 'Maximaler prozentualer Füllgrad der Warteschlange',
    });
  }

  const wsAbsolut = varMap.get('Sys_WS_Absolut');
  if (wsAbsolut !== undefined && wsAbsolut !== '' && wsAbsolut !== '-1') {
    addParam({
      key: 'Sys_WS_Absolut',
      label: 'Warteschlangen-Schwelle (Anrufer)',
      category: 'overflow',
      value: `${wsAbsolut} Anrufer`,
      rawValue: wsAbsolut,
      unit: 'Anrufer',
      note: 'Maximale absolute Anzahl wartender Anrufer',
    });
  }

  // B. Routing & Zentralen (Category 'routing')
  const retourZentrale = varMap.get('Sys_Retour_Zentrale');
  if (retourZentrale !== undefined && retourZentrale !== '' && retourZentrale !== '-1' && retourZentrale !== '0') {
    addParam({
      key: 'Sys_Retour_Zentrale',
      label: 'Rücksprung-Zentrale',
      category: 'routing',
      value: retourZentrale,
      rawValue: retourZentrale,
      note: 'Rückfall- und Abwurfelement zur Telefonzentrale',
    });
  }

  const gesellschaft = varMap.get('Sys_Gesellschaft');
  if (gesellschaft) {
    addParam({
      key: 'Sys_Gesellschaft',
      label: 'Gesellschaft / Mandant',
      category: 'routing',
      value: gesellschaft,
      rawValue: gesellschaft,
      note: 'Unternehmens- oder Mandantenzuordnung',
    });
  }

  const sysBrand =
    varMap.get('Sys_brand') ||
    mod.rules.find((r) => Boolean(r.brandName))?.brandName ||
    mod.entryOrganizationName;
  if (sysBrand && sysBrand !== gesellschaft) {
    addParam({
      key: 'Sys_brand',
      label: 'Marke / Brand',
      category: 'routing',
      value: sysBrand,
      rawValue: sysBrand,
      note: 'Markenprofil für Begrüßung und Routing',
    });
  }

  const srcRoute =
    varMap.get('src_route_number') ||
    mod.rules.find((r) => Boolean(r.srcRouteNumber))?.srcRouteNumber;
  if (srcRoute) {
    addParam({
      key: 'src_route_number',
      label: 'Inbound Routing-Nummer',
      category: 'routing',
      value: srcRoute,
      rawValue: srcRoute,
      note: 'Eingehende Avaya Route / CDN-Zuweisung',
    });
  }

  if (mod.entryDnisNumbers && mod.entryDnisNumbers.length > 0) {
    addParam({
      key: 'DNIS_Range',
      label: 'Eingehende DNIS-Rufnummern',
      category: 'routing',
      value: mod.entryDnisNumbers.join(', '),
      rawValue: mod.entryDnisNumbers.join(','),
      note: 'Direktwahlnummern für diesen Einstiegspunkt',
    });
  }

  const teamSkillset =
    varMap.get('Sys_Team_Skillset') ||
    mod.rules.find((r) => r.queueTarget && !/[uü]berlauf/i.test(r.stepName))?.queueTarget;
  if (teamSkillset && teamSkillset !== 'Default_Skillset' && teamSkillset !== '-1') {
    addParam({
      key: 'Sys_Team_Skillset',
      label: 'Haupt-Warteschlange (Team)',
      category: 'routing',
      value: teamSkillset,
      rawValue: teamSkillset,
      note: 'Primäres Ziel-Skillset der Anrufverteilung',
    });
  }

  const teamPrio = varMap.get('Sys_Team_Prio');
  if (teamPrio !== undefined && teamPrio !== '' && teamPrio !== '-1') {
    addParam({
      key: 'Sys_Team_Prio',
      label: 'Team-Priorität',
      category: 'routing',
      value: `Prio ${teamPrio}`,
      rawValue: teamPrio,
      note: 'Standard-Priorität für das Primär-Skillset',
    });
  }

  // C. Öffnungszeiten & Sonderstatus (Category 'schedule')
  const rawSondZeit = varMap.get('Sys_SondZeit') || mod.rules.find((r) => Boolean(r.schedule))?.schedule;
  if (rawSondZeit) {
    const resolved = resolveScheduleWithSondZeit(rawSondZeit, mod, workspace);
    addParam({
      key: 'Sys_SondZeit',
      label: 'Öffnungszeiten (SondZeit)',
      category: 'schedule',
      value: resolved.displayText,
      rawValue: rawSondZeit,
      note: resolved.hasConcreteTimes ? 'Aufgelöste Arbeitszeiten mit Referenz' : 'Referenziertes Zeit-Skript',
    });
  }

  const sondStat = varMap.get('Sys_SondStat') || mod.rules.find((r) => Boolean(r.holiday))?.holiday;
  if (sondStat) {
    addParam({
      key: 'Sys_SondStat',
      label: 'Sonderstatus / Feiertag',
      category: 'schedule',
      value: sondStat,
      rawValue: sondStat,
      note: 'Prüfstatus für Notfall, Feiertag oder Sonderansage',
    });
  }

  const sondRouting = varMap.get('Sys_SondRouting');
  if (sondRouting !== undefined && sondRouting !== '') {
    const isSondActive = sondRouting === '1' || sondRouting.toLowerCase() === 'true';
    addParam({
      key: 'Sys_SondRouting',
      label: 'Sonderrouting-Schalter',
      category: 'schedule',
      value: isSondActive ? 'Aktiv (1)' : sondRouting === '0' ? 'Inaktiv (0)' : sondRouting,
      rawValue: sondRouting,
      note: isSondActive ? 'Sonderrouting bei Feiertag/Notfall aktiv' : 'Normales Routing',
    });
  }

  // D. Medien & Audio (Category 'media')
  const sysMusik = varMap.get('Sys_Musik');
  if (sysMusik !== undefined && sysMusik !== '' && sysMusik !== '-1') {
    addParam({
      key: 'Sys_Musik',
      label: 'Wartemusik (Audio-ID)',
      category: 'media',
      value: `Musik-ID ${sysMusik}`,
      rawValue: sysMusik,
      note: 'Zugewiesene Wartemusik / Audio-Beleg',
    });
  }

  const besetztgrund = varMap.get('Sys_Besetztgrund');
  if (besetztgrund) {
    addParam({
      key: 'Sys_Besetztgrund',
      label: 'Besetzt-Ursache / Code',
      category: 'media',
      value: besetztgrund,
      rawValue: besetztgrund,
      note: 'Ursachencode bei Abwurf oder Überlastung',
    });
  }

  const firstAnn = mod.rules.find((r) => Boolean(r.announcement))?.announcement;
  if (firstAnn && !firstAnn.startsWith('Musik-ID')) {
    addParam({
      key: 'Ansage_RAN',
      label: 'Hauptansage / RAN',
      category: 'media',
      value: firstAnn,
      rawValue: firstAnn,
      note: 'Begrüßungs- oder Informationsansage',
    });
  }

  // E. Individuelle Skript-Variablen (Category 'custom')
  const standardSysKeys = new Set([
    'sys_ueberlauf_zeit', 'sys_ueberlauf_skillset', 'sys_ueberlauf_prio', 'sys_ueberlaufrouting',
    'sys_ws_prozent', 'sys_ws_absolut', 'sys_retour_zentrale', 'sys_gesellschaft', 'sys_brand',
    'src_route_number', 'sys_team_skillset', 'sys_team_prio', 'sys_sondzeit', 'sys_sondstat',
    'sys_sondrouting', 'sys_musik', 'sys_besetztgrund', 'dnis_range', 'ansage_ran'
  ]);

  for (const [vName, vVal] of varMap.entries()) {
    const vKey = vName.toLowerCase();
    if (standardSysKeys.has(vKey)) continue;
    if (/^(?:temp|dummy|loop_?cnt|counter|i|j|idx)$/i.test(vName)) continue;
    addParam({
      key: vName,
      label: vName.replace(/^[Ss]ys_/, '').replace(/_/g, ' '),
      category: 'custom',
      value: vVal,
      rawValue: vVal,
      note: 'Skriptinterne Zuweisung',
    });
  }

  return items;
}

/**
 * Erstellt eine Map aller Sonderparameter indexiert nach Skriptnummer und kanonischem Suchschlüssel.
 */
export function buildWorkspaceSpecialParametersMap(
  workspace: ScriptWorkspace
): Record<string, CallflowScriptParameterItem[]> {
  const map: Record<string, CallflowScriptParameterItem[]> = {};
  for (const mod of workspace.modules || []) {
    const params = extractScriptSpecialParameters(mod, workspace);
    map[mod.scriptNumber] = params;
    const cleanRef = canonicalScriptMatchKey(mod.scriptNumber);
    if (cleanRef) {
      map[cleanRef] = params;
    }
  }
  return map;
}

/**
 * Extrahiert die für einen konkreten Kanten-Übergang steuernden Sonderparameter
 * (z. B. Überlaufzeit, Rücksprungnummer zur Zentrale, Feiertags- oder Zeitstatus).
 */
export function extractEdgeSpecialParameters(
  edge: Pick<CallflowEdge, 'from' | 'to' | 'label'>,
  workspace: ScriptWorkspace
): CallflowScriptParameterItem[] {
  const fromNum =
    extractScriptNumberFromNodeId(edge.from, workspace.modules) || edge.from.replace(/^S_/, '');
  const toNum =
    extractScriptNumberFromNodeId(edge.to, workspace.modules) || edge.to.replace(/^S_/, '');
  const fromMod = workspace.modules.find(
    (m) => canonicalScriptMatchKey(m.scriptNumber) === canonicalScriptMatchKey(fromNum)
  );
  if (!fromMod) return [];

  const allParams = extractScriptSpecialParameters(fromMod, workspace);
  const relevant: CallflowScriptParameterItem[] = [];
  const edgeLbl = (edge.label || '').toLowerCase();
  const toClean = canonicalScriptMatchKey(toNum);

  for (const p of allParams) {
    const pValClean = canonicalScriptMatchKey(p.rawValue);
    // 1. Überlauf-Sprung
    if (p.category === 'overflow' && (/überlauf|overflow/i.test(edgeLbl) || pValClean === toClean)) {
      relevant.push(p);
      continue;
    }
    // 2. Rücksprung zur Zentrale
    if (p.key === 'Sys_Retour_Zentrale' && (/retour|zentrale/i.test(edgeLbl) || pValClean === toClean)) {
      relevant.push(p);
      continue;
    }
    // 3. Zeit- oder Sonderstatus-Bedingung
    if (
      (p.key === 'Sys_SondStat' || p.key === 'Sys_SondZeit' || p.key === 'Sys_SondRouting') &&
      (edgeLbl.includes('🕒') || edgeLbl.includes('📅') || /feiertag|zeit|sond/i.test(edgeLbl))
    ) {
      relevant.push(p);
      continue;
    }
    // 4. Direkte Erwähnung des Variablennamens im Label
    if (edgeLbl.includes(p.key.toLowerCase())) {
      relevant.push(p);
      continue;
    }
  }

  return relevant.length > 0
    ? relevant
    : allParams.filter((p) => p.category === 'routing' || p.category === 'overflow').slice(0, 3);
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

  const parametersByScript = buildWorkspaceSpecialParametersMap(workspace);
  const allParamsMap = new Map<string, CallflowScriptParameterItem>();
  Object.values(parametersByScript).forEach((list) => {
    list.forEach((p) => {
      if (!allParamsMap.has(p.key.toLowerCase())) {
        allParamsMap.set(p.key.toLowerCase(), p);
      }
    });
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
    specialParameters: Array.from(allParamsMap.values()),
    parametersByScript,
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
      const rawSched =
        rule.schedule ||
        extractReadableScheduleAndHolidayFromText(rule.condition || '').schedule;
      if (rawSched) {
        const resolved = resolveScheduleWithSondZeit(rawSched, mod, workspace).displayText;
        condParts.push(`Zeitplan: ${resolved}`);
      }
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

  // 2.4 Öffnungszeiten & Feiertags-Übersicht
  const scheduleRows = buildWorkspaceScheduleOverview(workspace);
  md.push('### 2.4 Öffnungszeiten & Feiertags-Übersicht');
  if (scheduleRows.length === 0) {
    md.push('_Keine Skripte im Arbeitsbereich vorhanden._');
  } else {
    md.push(
      '| Skript | Schritt / Regel | Öffnungszeiten | Feiertag / Sonderzeit | Aktion / Überlauf / Ziel |'
    );
    md.push('| --- | --- | --- | --- | --- |');
    scheduleRows.forEach((sr) => {
      md.push(
        `| \`[${sr.scriptNumber}]\` ${sr.scriptName} | ${sr.prio !== undefined ? `Prio ${sr.prio}: ` : ''}${sr.stepName} | ${sr.openingHours} | ${sr.holidayAndSpecial} | ${sr.closedOrOverflowAction} |`
      );
    });
  }
  md.push('');

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

/**
 * Erstellt die strukturierte Öffnungszeiten- und Feiertags-Übersichtsliste über alle Skripte im Callflow.
 */
export function buildWorkspaceScheduleOverview(
  workspace: ScriptWorkspace
): CallflowScheduleSummaryRow[] {
  const rows: CallflowScheduleSummaryRow[] = [];
  const modules = workspace.modules || [];

  for (const mod of modules) {
    const sortedRules = [...mod.rules].sort((a, b) => a.prio - b.prio);
    const matchingRules: Array<{
      rule: ScriptRule;
      scheduleText: string;
      holidayText: string;
    }> = [];

    for (const r of sortedRules) {
      const det = extractReadableScheduleAndHolidayFromText(r.condition || '');
      const rawSched = (r.schedule || det.schedule || '').trim();
      const hol = (r.holiday || det.holiday || '').trim();
      const resolved = resolveScheduleWithSondZeit(rawSched, mod, workspace);
      const sched = resolved.displayText || rawSched;
      if (sched || hol) {
        matchingRules.push({
          rule: r,
          scheduleText: sched,
          holidayText: hol,
        });
      }
    }

    if (matchingRules.length > 0) {
      for (const item of matchingRules) {
        const { rule, scheduleText, holidayText } = item;
        const targets: string[] = [];
        if (rule.targetNumber) targets.push(rule.targetNumber);
        rule.choices.forEach((c) => {
          if (c.targetNumber && !targets.includes(c.targetNumber)) {
            targets.push(c.targetNumber);
          }
        });

        const actionBits: string[] = [];
        if (rule.queueTarget) actionBits.push(`Queue: ${rule.queueTarget}`);
        if (rule.announcement) actionBits.push(`Ansage: ${rule.announcement}`);
        if (targets.length > 0) actionBits.push(`Wohin: ${targets.join(', ')}`);
        if (rule.isDisconnect) actionBits.push('Anruf trennen');

        rows.push({
          id: `${mod.scriptNumber}:${rule.id}`,
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName,
          isMaster: mod.isMaster,
          prio: rule.prio,
          ruleId: rule.id,
          stepName: rule.stepName || 'Zeit- / Feiertagsregel',
          openingHours: scheduleText || '— (nur Feiertag/Sonderstatus)',
          holidayAndSpecial: holidayText || '—',
          closedOrOverflowAction: actionBits.join(' · ') || 'Standard-Folgeschritt',
          targetNumbers: targets,
          hasSchedule: Boolean(scheduleText),
          hasHoliday: Boolean(holidayText),
        });
      }
    } else {
      const fallbackResolved = resolveScheduleWithSondZeit('', mod, workspace);
      const firstRule = sortedRules[0];
      const targets = [...mod.outgoingNumbers];
      const actionBits: string[] = [];
      const firstQueue = sortedRules.find((r) => Boolean(r.queueTarget))?.queueTarget;
      const firstAnn = sortedRules.find((r) => Boolean(r.announcement))?.announcement;
      if (firstQueue) actionBits.push(`Queue: ${firstQueue}`);
      if (firstAnn) actionBits.push(`Ansage: ${firstAnn}`);
      if (targets.length > 0) actionBits.push(`Ziele: ${targets.slice(0, 4).join(', ')}`);

      const hasFallbackSched = Boolean(
        fallbackResolved.displayText &&
          (fallbackResolved.hasConcreteTimes || fallbackResolved.scriptReference)
      );

      rows.push({
        id: `${mod.scriptNumber}:module`,
        scriptNumber: mod.scriptNumber,
        scriptName: mod.scriptName,
        isMaster: mod.isMaster,
        prio: firstRule?.prio,
        ruleId: firstRule?.id,
        stepName: firstRule?.stepName || mod.scriptName,
        openingHours: hasFallbackSched
          ? fallbackResolved.displayText
          : 'Keine Zeitbeschränkung (24/7)',
        holidayAndSpecial: '—',
        closedOrOverflowAction: actionBits.join(' · ') || '—',
        targetNumbers: targets,
        hasSchedule: hasFallbackSched,
        hasHoliday: false,
      });
    }
  }

  return rows;
}

/**
 * Exportiert die Öffnungszeiten- und Feiertags-Übersicht als UTF-8 CSV (mit BOM für Excel).
 */
export function exportOpeningHoursCsv(workspace: ScriptWorkspace): string {
  const rows = buildWorkspaceScheduleOverview(workspace);
  const escapeCsvCell = (val: string | number): string => {
    const str = String(val ?? '').replace(/\r?\n/g, ' ');
    if (/[;"\t]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = [
    'Skript-Nr.',
    'Skript-Name',
    'Prio',
    'Schritt / Regel',
    'Öffnungszeiten',
    'Feiertag / Sonderzeit',
    'Aktion / Überlauf / Ziel',
    'Status',
  ];

  const lines = [
    headers.map(escapeCsvCell).join(';'),
    ...rows.map((r) =>
      [
        r.scriptNumber,
        r.scriptName,
        r.prio ?? '—',
        r.stepName,
        r.openingHours,
        r.holidayAndSpecial,
        r.closedOrOverflowAction,
        r.hasSchedule && r.hasHoliday
          ? 'Öffnungszeiten + Feiertag'
          : r.hasSchedule
          ? 'Öffnungszeiten hinterlegt'
          : r.hasHoliday
          ? 'Feiertag / Sonderzeit'
          : 'Ohne Zeitangabe (24/7)',
      ]
        .map(escapeCsvCell)
        .join(';')
    ),
  ];

  return `\uFEFF${lines.join('\r\n')}`;
}

export interface EditableNodeConnectionItem {
  id: string;
  toTargetNumber: string;
  label: string;
  kind: 'rule-target' | 'choice' | 'manual-link';
  ruleId?: string;
  choiceKey?: string;
}

export interface EditableNodeIncomingItem {
  fromScriptNumber: string;
  fromLabel: string;
  edgeLabel: string;
}

export interface EditableNodeRulePreviewItem {
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
  // Enriched inspection data for the refined double-click Info Box
  canJumpToDetailScript?: boolean;
  detailTargetScriptNumber?: string;
  incomingConnections?: EditableNodeIncomingItem[];
  entryDnisNumbers?: string[];
  organizationName?: string;
  cdnAlias?: string;
  resolvedScheduleDisplay?: string;
  hasHolidayCheck?: boolean;
  waitSeconds?: number;
  treatmentInfo?: string;
  hdxAction?: string;
  moduleRulesPreview?: EditableNodeRulePreviewItem[];
  specialParameters?: CallflowScriptParameterItem[];
  relatedFindings?: Array<{
    severity: 'error' | 'warning' | 'info';
    title: string;
    recommendation: string;
  }>;
  rawLineSnippet?: string;
  fullScriptText?: string;
  highlightStartLine?: number;
  highlightEndLine?: number;
}

/**
 * Locates the 1-indexed start/end line numbers of a Callflow node inside its
 * full Avaya/CCaaS `.s` script source text using ordered candidate fragments.
 */
export function locateNodeLinesInScript(
  fullText: string | undefined,
  candidates: Array<string | undefined | null>
): { startLine: number; endLine: number } | undefined {
  if (!fullText) return undefined;
  const rawLines = fullText.replace(/\r\n?/g, '\n').split('\n');
  if (rawLines.length === 0) return undefined;

  const trimmedLines = rawLines.map((l) => l.trim());
  const normalizedLines = rawLines.map((l) => l.trim().replace(/\s+/g, ' ').toLowerCase());

  const cleanCandidates = candidates
    .map((c) => (typeof c === 'string' ? c.replace(/\r\n?/g, '\n').trim() : ''))
    .filter((c) => c.length >= 2);

  // Pass 1: Multi-line block match (e.g. multi-line rule.rawLine)
  for (const cand of cleanCandidates) {
    if (!cand.includes('\n')) continue;
    const candLines = cand
      .split('\n')
      .map((l) => l.trim().replace(/\s+/g, ' ').toLowerCase())
      .filter((l) => l.length > 0);
    if (candLines.length < 2) continue;
    for (let i = 0; i < normalizedLines.length; i++) {
      if (normalizedLines[i] !== candLines[0] && !normalizedLines[i].includes(candLines[0])) {
        continue;
      }
      let matchedAll = true;
      let endIdx = i;
      for (let j = 1; j < candLines.length; j++) {
        let foundNext = false;
        const maxLookahead = Math.min(normalizedLines.length - 1, endIdx + 3);
        for (let k = endIdx + 1; k <= maxLookahead; k++) {
          if (normalizedLines[k] === candLines[j] || normalizedLines[k].includes(candLines[j])) {
            endIdx = k;
            foundNext = true;
            break;
          }
        }
        if (!foundNext) {
          matchedAll = false;
          break;
        }
      }
      if (matchedAll) {
        return { startLine: i + 1, endLine: endIdx + 1 };
      }
    }
  }

  // Pass 2: Exact normalized single-line match
  for (const cand of cleanCandidates) {
    const firstLine = cand.split('\n')[0].trim().replace(/\s+/g, ' ').toLowerCase();
    if (firstLine.length < 2) continue;
    const exactIdx = normalizedLines.findIndex((ln) => ln === firstLine);
    if (exactIdx >= 0) {
      return { startLine: exactIdx + 1, endLine: exactIdx + 1 };
    }
  }

  // Pass 3: Substring match on normalized line (prefer longer, more specific candidates first)
  for (const cand of cleanCandidates) {
    const firstLine = cand.split('\n')[0].trim().replace(/\s+/g, ' ').toLowerCase();
    if (firstLine.length < 3) continue;
    const subIdx = normalizedLines.findIndex((ln) => ln.includes(firstLine));
    if (subIdx >= 0) {
      return { startLine: subIdx + 1, endLine: subIdx + 1 };
    }
  }

  // Fallback: first non-empty line in the script if any line has content
  const firstNonEmpty = trimmedLines.findIndex((ln) => ln.length > 0);
  if (firstNonEmpty >= 0) {
    return { startLine: firstNonEmpty + 1, endLine: firstNonEmpty + 1 };
  }
  return undefined;
}

export interface WorkspaceInspectContext {
  moduleByKey: Map<string, ScriptModule>;
  findingsByModKey: Map<string, CallflowHealthFinding[]>;
  parametersByScript: Record<string, CallflowScriptParameterItem[]>;
  incomingByModKey: Map<string, EditableNodeIncomingItem[]>;
  hoursSummaryByModKey: Map<string, ReturnType<typeof getModuleOpeningHoursSummary>>;
  rulesPreviewByModKey: Map<string, EditableNodeRulePreviewItem[]>;
}

/**
 * Builds a single-pass precomputed lookup context for `inspectWorkspaceNodeForEdit`
 * so batch exports (Interactive HTML) run in milliseconds instead of re-running
 * `analyzeWorkspaceLogicHealth` and full-workspace scans for every node.
 */
export function createWorkspaceInspectContext(
  workspace: ScriptWorkspace,
  precomputedFindings?: CallflowHealthFinding[],
  precomputedParametersByScript?: Record<string, CallflowScriptParameterItem[]>
): WorkspaceInspectContext {
  const moduleByKey = new Map<string, ScriptModule>();
  for (const m of workspace.modules || []) {
    const k = canonicalScriptMatchKey(m.scriptNumber);
    if (k && !moduleByKey.has(k)) {
      moduleByKey.set(k, m);
    }
    if (m.cdnAlias) {
      const aliasKey = canonicalScriptMatchKey(m.cdnAlias);
      if (aliasKey && !moduleByKey.has(aliasKey)) {
        moduleByKey.set(aliasKey, m);
      }
    }
  }

  const allFindings = precomputedFindings ?? analyzeWorkspaceLogicHealth(workspace);
  const findingsByModKey = new Map<string, CallflowHealthFinding[]>();
  for (const f of allFindings) {
    const mk = canonicalScriptMatchKey(f.scriptNumber);
    if (!mk) continue;
    let list = findingsByModKey.get(mk);
    if (!list) {
      list = [];
      findingsByModKey.set(mk, list);
    }
    list.push(f);
  }

  const parametersByScript =
    precomputedParametersByScript ?? buildWorkspaceSpecialParametersMap(workspace);

  const incomingByModKey = new Map<string, EditableNodeIncomingItem[]>();
  const seenByTarget = new Map<string, Set<string>>();
  const pushIncoming = (
    targetRef: string | undefined,
    fromScriptNumber: string,
    fromLabel: string,
    edgeLabel: string
  ) => {
    if (!targetRef) return;
    const tKey = canonicalScriptMatchKey(targetRef);
    if (!tKey) return;
    let seen = seenByTarget.get(tKey);
    if (!seen) {
      seen = new Set<string>();
      seenByTarget.set(tKey, seen);
    }
    const dedupKey = `${canonicalScriptMatchKey(fromScriptNumber)}::${edgeLabel}`;
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    let list = incomingByModKey.get(tKey);
    if (!list) {
      list = [];
      incomingByModKey.set(tKey, list);
    }
    list.push({ fromScriptNumber, fromLabel, edgeLabel });
  };

  for (const m of workspace.modules || []) {
    const mLabel = formatScriptDisplayLabel(m);
    for (const r of m.rules) {
      if (r.targetNumber) {
        pushIncoming(r.targetNumber, m.scriptNumber, mLabel, r.stepName || `Prio ${r.prio}`);
      }
      for (const ch of r.choices) {
        pushIncoming(ch.targetNumber, m.scriptNumber, mLabel, `Taste ${ch.choice}`);
      }
    }
  }

  for (const lnk of workspace.manualLinks || []) {
    const callerMod = moduleByKey.get(canonicalScriptMatchKey(lnk.fromScriptNumber));
    pushIncoming(
      lnk.toTargetNumber,
      lnk.fromScriptNumber,
      callerMod ? formatScriptDisplayLabel(callerMod) : lnk.fromScriptNumber,
      lnk.label || 'Manuelle Verknüpfung'
    );
  }

  return {
    moduleByKey,
    findingsByModKey,
    parametersByScript,
    incomingByModKey,
    hoursSummaryByModKey: new Map(),
    rulesPreviewByModKey: new Map(),
  };
}

/**
 * Inspects a node from the current diagram so the Double-Click Node Info & Editor modal can
 * display structured overview facts (incoming callers, outgoing targets, schedules, DNIS,
 * rules, parameters, findings, and script jump) alongside full inline editing.
 */
export function inspectWorkspaceNodeForEdit(
  workspace: ScriptWorkspace,
  viewLevel: CallflowViewLevel,
  nodeId: string,
  graph: CallflowGraph,
  inspectCtx?: WorkspaceInspectContext
): EditableCallflowNodeSnapshot {
  const graphNode = graph.nodes.get(nodeId);
  const fallbackLabel = graphNode?.label || nodeId;

  let cachedGraphIncoming: EditableNodeIncomingItem[] | null = null;
  const collectGraphIncoming = (): EditableNodeIncomingItem[] => {
    if (cachedGraphIncoming) return cachedGraphIncoming;
    cachedGraphIncoming = graph.edges
      .filter((e) => e.to === nodeId)
      .map((e) => ({
        fromScriptNumber: e.from,
        fromLabel: graph.nodes.get(e.from)?.label || e.from,
        edgeLabel: e.label || '',
      }));
    return cachedGraphIncoming;
  };

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
      incomingConnections: collectGraphIncoming(),
    };
  }

  const findModuleByKey = (key: string): ScriptModule | undefined =>
    inspectCtx
      ? inspectCtx.moduleByKey.get(key)
      : workspace.modules.find((m) => canonicalScriptMatchKey(m.scriptNumber) === key);

  const collectWorkspaceIncomingForKey = (tKey: string): EditableNodeIncomingItem[] => {
    if (inspectCtx) {
      return inspectCtx.incomingByModKey.get(tKey) || [];
    }
    const incoming: EditableNodeIncomingItem[] = [];
    const seen = new Set<string>();
    const pushItem = (fromScriptNumber: string, fromLabel: string, edgeLabel: string) => {
      const k = `${canonicalScriptMatchKey(fromScriptNumber)}::${edgeLabel}`;
      if (seen.has(k)) return;
      seen.add(k);
      incoming.push({ fromScriptNumber, fromLabel, edgeLabel });
    };

    for (const m of workspace.modules) {
      const mLabel = formatScriptDisplayLabel(m);
      for (const r of m.rules) {
        if (r.targetNumber && canonicalScriptMatchKey(r.targetNumber) === tKey) {
          pushItem(m.scriptNumber, mLabel, r.stepName || `Prio ${r.prio}`);
        }
        for (const ch of r.choices) {
          if (canonicalScriptMatchKey(ch.targetNumber) === tKey) {
            pushItem(m.scriptNumber, mLabel, `Taste ${ch.choice}`);
          }
        }
      }
    }
    for (const lnk of workspace.manualLinks || []) {
      if (canonicalScriptMatchKey(lnk.toTargetNumber) === tKey) {
        const callerMod = findModuleByKey(canonicalScriptMatchKey(lnk.fromScriptNumber));
        pushItem(
          lnk.fromScriptNumber,
          callerMod ? formatScriptDisplayLabel(callerMod) : lnk.fromScriptNumber,
          lnk.label || 'Manuelle Verknüpfung'
        );
      }
    }
    return incoming;
  };

  const buildModuleRulesPreview = (mod: ScriptModule): EditableNodeRulePreviewItem[] => {
    const mKey = canonicalScriptMatchKey(mod.scriptNumber);
    if (inspectCtx) {
      const cached = inspectCtx.rulesPreviewByModKey.get(mKey);
      if (cached) return cached;
    }
    const preview = [...mod.rules]
      .sort((a, b) => a.prio - b.prio)
      .map((r) => ({
        id: r.id,
        prio: r.prio,
        stepName: r.stepName,
        condition: r.condition,
        schedule: r.schedule
          ? resolveScheduleWithSondZeit(r.schedule, mod, workspace).displayText
          : undefined,
        holiday: r.holiday,
        targetNumber: r.targetNumber,
        queueTarget: r.queueTarget,
        announcement: r.announcement || r.treatmentInfo,
        choicesCount: r.choices.length,
      }));
    if (inspectCtx) {
      inspectCtx.rulesPreviewByModKey.set(mKey, preview);
    }
    return preview;
  };

  const getCachedHoursSummary = (mod: ScriptModule) => {
    const mKey = canonicalScriptMatchKey(mod.scriptNumber);
    if (inspectCtx) {
      const cached = inspectCtx.hoursSummaryByModKey.get(mKey);
      if (cached) return cached;
    }
    const summary = getModuleOpeningHoursSummary(mod, workspace);
    if (inspectCtx) {
      inspectCtx.hoursSummaryByModKey.set(mKey, summary);
    }
    return summary;
  };

  const getCachedSpecialParameters = (mod: ScriptModule) => {
    if (inspectCtx) {
      const hit = inspectCtx.parametersByScript[mod.scriptNumber];
      if (hit) return hit;
    }
    return extractScriptSpecialParameters(mod, workspace);
  };

  const collectFindingsForMod = (modKey: string, ruleId?: string) => {
    const modFindings = inspectCtx
      ? inspectCtx.findingsByModKey.get(modKey) || []
      : analyzeWorkspaceLogicHealth(workspace).filter(
          (f) => canonicalScriptMatchKey(f.scriptNumber) === modKey
        );
    return modFindings
      .filter((f) => !(ruleId && f.ruleId && f.ruleId !== ruleId))
      .slice(0, 8)
      .map((f) => ({
        severity: f.severity,
        title: f.title,
        recommendation: f.recommendation,
      }));
  };

  // Detail View Step (`STEP_<modSuffix>_<idx>`)
  const stepMatch = nodeId.match(/^STEP_([A-Za-z0-9_]+)_(\d+)$/);
  if (viewLevel.level === 'detail' && stepMatch) {
    const stepIndex = Math.max(0, parseInt(stepMatch[2], 10) - 1);
    const mod = findModuleByKey(canonicalScriptMatchKey(viewLevel.scriptNumber));
    const sortedRules = mod ? [...mod.rules].sort((a, b) => a.prio - b.prio) : [];
    const rule = sortedRules[stepIndex];
    if (mod && rule) {
      const modKey = canonicalScriptMatchKey(mod.scriptNumber);
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
            canonicalScriptMatchKey(lnk.fromScriptNumber) === modKey && lnk.fromRuleId === rule.id
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

      const resolvedSched = rule.schedule
        ? resolveScheduleWithSondZeit(rule.schedule, mod, workspace).displayText
        : '';

      const firstTargetMod = rule.targetNumber
        ? findModuleByKey(canonicalScriptMatchKey(rule.targetNumber))
        : undefined;

      const graphIn = collectGraphIncoming();
      const locatedLines = locateNodeLinesInScript(mod.rawText, [
        rule.rawLine,
        rule.condition,
        rule.announcement,
        rule.queueTarget,
        rule.targetNumber,
        rule.schedule,
        rule.stepName,
      ]);

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
        schedule: resolvedSched,
        condition: rule.condition || '',
        outgoingConnections: outgoing,
        canJumpToDetailScript: Boolean(firstTargetMod),
        detailTargetScriptNumber: firstTargetMod?.scriptNumber,
        incomingConnections:
          graphIn.length > 0 ? graphIn : collectWorkspaceIncomingForKey(modKey),
        entryDnisNumbers:
          rule.valueNumbers && rule.valueNumbers.length > 0
            ? rule.valueNumbers
            : mod.entryDnisNumbers,
        organizationName: rule.organizationName || mod.entryOrganizationName,
        cdnAlias: mod.cdnAlias,
        resolvedScheduleDisplay:
          resolvedSched || getCachedHoursSummary(mod).combinedBadge || undefined,
        hasHolidayCheck: Boolean(rule.holiday),
        waitSeconds: rule.waitSeconds,
        treatmentInfo: rule.treatmentInfo,
        hdxAction: rule.hdxAction,
        moduleRulesPreview: buildModuleRulesPreview(mod),
        specialParameters: getCachedSpecialParameters(mod).slice(0, 10),
        relatedFindings: collectFindingsForMod(modKey, rule.id),
        rawLineSnippet: rule.rawLine?.trim() || undefined,
        fullScriptText: mod.rawText?.trim() ? mod.rawText : undefined,
        highlightStartLine: locatedLines?.startLine,
        highlightEndLine: locatedLines?.endLine,
      };
    }
  }

  // Master View or Detail Jump/Self/Inc node -> maps to a ScriptModule or Missing/External target
  const extractedRef =
    extractScriptNumberFromNodeId(nodeId, workspace.modules) ||
    (viewLevel.level === 'detail' ? viewLevel.scriptNumber : nodeId.replace(/^S_/, ''));
  const targetKey = canonicalScriptMatchKey(extractedRef);
  const mod = findModuleByKey(targetKey);

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
    const rawSched = mod.rules.find((r) => Boolean(r.schedule))?.schedule || '';
    const firstSched = rawSched
      ? resolveScheduleWithSondZeit(rawSched, mod, workspace).displayText
      : resolveScheduleWithSondZeit('', mod, workspace).displayText;
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

    const hoursSummary = getCachedHoursSummary(mod);
    const isDifferentFromActiveDetail =
      viewLevel.level !== 'detail' ||
      canonicalScriptMatchKey(viewLevel.scriptNumber) !== targetKey;

    const locatedModuleLines = locateNodeLinesInScript(mod.rawText, [
      mod.scriptName,
      mod.scriptNumber,
      primaryRule?.rawLine,
    ]);

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
      canJumpToDetailScript: isDifferentFromActiveDetail,
      detailTargetScriptNumber: mod.scriptNumber,
      incomingConnections: collectWorkspaceIncomingForKey(targetKey),
      entryDnisNumbers: mod.entryDnisNumbers,
      organizationName: mod.entryOrganizationName,
      cdnAlias: mod.cdnAlias,
      resolvedScheduleDisplay: hoursSummary.combinedBadge || firstSched || undefined,
      hasHolidayCheck: mod.rules.some((r) => Boolean(r.holiday)),
      waitSeconds: mod.rules.find((r) => r.waitSeconds !== undefined)?.waitSeconds,
      treatmentInfo: mod.rules.find((r) => Boolean(r.treatmentInfo))?.treatmentInfo,
      hdxAction: mod.rules.find((r) => Boolean(r.hdxAction))?.hdxAction,
      moduleRulesPreview: buildModuleRulesPreview(mod),
      specialParameters: getCachedSpecialParameters(mod).slice(0, 12),
      relatedFindings: collectFindingsForMod(targetKey),
      rawLineSnippet: mod.rawText ? mod.rawText.trim().split('\n').slice(0, 8).join('\n') : undefined,
      fullScriptText: mod.rawText?.trim() ? mod.rawText : undefined,
      highlightStartLine: locatedModuleLines?.startLine,
      highlightEndLine: locatedModuleLines?.endLine,
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
    incomingConnections: collectWorkspaceIncomingForKey(targetKey),
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

    if (sorted.length === 1) {
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
      // Multi-rule script: preserve all existing rules & metadata while updating schedule, queue, announcement, condition & connections
      const schedRuleId = (sorted.find((r) => Boolean(r.schedule)) || sorted[0]).id;
      const annRuleId = (sorted.find((r) => Boolean(r.announcement)) || sorted[0]).id;
      const queueRuleId = (sorted.find((r) => Boolean(r.queueTarget)) || sorted[0]).id;
      const condRuleId = (sorted.find((r) => Boolean(r.condition)) || sorted[0]).id;

      const updatedRuleTargetByRuleId = new Map<string, string>();
      const updatedChoicesByRuleId = new Map<string, ScriptChoiceOption[]>();
      const extraConnections: EditableNodeConnectionItem[] = [];

      validConnections.forEach((conn) => {
        const targetNorm = normalizeScriptRef(conn.toTargetNumber);
        if (conn.kind === 'rule-target' && conn.ruleId) {
          updatedRuleTargetByRuleId.set(conn.ruleId, targetNorm);
        } else if (conn.kind === 'choice' && conn.ruleId) {
          const list = updatedChoicesByRuleId.get(conn.ruleId) || [];
          const cleanChoice = conn.label.replace(/^Taste\s+/i, '').trim() || conn.choiceKey || '1';
          list.push({ choice: cleanChoice, targetNumber: targetNorm });
          updatedChoicesByRuleId.set(conn.ruleId, list);
        } else if (conn.kind !== 'manual-link') {
          extraConnections.push(conn);
        }
      });

      updatedRules = sorted.map((r) => ({
        ...r,
        sourceNumber: cleanScriptNum,
        schedule: r.id === schedRuleId ? cleanSched || undefined : r.schedule,
        announcement: r.id === annRuleId ? cleanAnn || undefined : r.announcement,
        queueTarget: r.id === queueRuleId ? cleanQueue || undefined : r.queueTarget,
        condition: r.id === condRuleId ? cleanCond || undefined : r.condition,
        targetNumber: r.targetNumber
          ? updatedRuleTargetByRuleId.get(r.id)
          : undefined,
        choices: r.choices.length > 0 ? updatedChoicesByRuleId.get(r.id) || [] : [],
      }));

      let maxPrio = updatedRules.reduce((m, r) => Math.max(m, r.prio), 0);
      extraConnections.forEach((conn, idx) => {
        const targetNorm = normalizeScriptRef(conn.toTargetNumber);
        maxPrio += 1;
        updatedRules.push({
          id: `${toMermaidNodeSuffix(cleanScriptNum)}-r-${Date.now().toString(36)}-${idx}`,
          prio: maxPrio,
          stepName: conn.label.trim() || `Weiterleitung → ${targetNorm}`,
          sourceNumber: cleanScriptNum,
          targetNumber: targetNorm,
          choices: [],
          rawLine: `Prio ${maxPrio}: Wohin -> ${targetNorm}`,
        });
      });
    }
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

function isPureConnectionStubRule(rule: ScriptRule): boolean {
  return (
    !rule.targetNumber &&
    rule.choices.length === 0 &&
    !rule.announcement &&
    !rule.queueTarget &&
    !rule.schedule &&
    !rule.holiday &&
    !rule.condition &&
    (/-conn-/.test(rule.id) || /^(?:Weiterleitung|Sprung|Taste\s+[0-9*#]+)\s*→/i.test(rule.stepName))
  );
}

/**
 * Disconnects a single transition edge (`fromNodeId -> toNodeId`) cleanly inside the ScriptWorkspace
 * across Master Overview, Orga/Fax groupings, manual links, and Detail Step views.
 */
export function disconnectEdgeInWorkspace(
  workspace: ScriptWorkspace,
  viewLevel: CallflowViewLevel,
  fromNodeId: string,
  toNodeId: string
): ScriptWorkspace {
  if (!fromNodeId || !toNodeId) return workspace;

  // Case 1: Detail view connecting a STEP_<mod>_<idx> to a JUMP_<target> / S_<target>
  const stepMatch = fromNodeId.match(/^STEP_([A-Za-z0-9_]+)_(\d+)$/);
  if (viewLevel.level === 'detail' && stepMatch) {
    const stepIndex = Math.max(0, parseInt(stepMatch[2], 10) - 1);
    const toRef =
      extractScriptNumberFromNodeId(toNodeId, workspace.modules) ||
      toNodeId.replace(/^(?:S|JUMP|INC|SELF)_/, '');
    const toKey = canonicalScriptMatchKey(toRef);
    const activeKey = canonicalScriptMatchKey(viewLevel.scriptNumber);

    const nextModules = workspace.modules.map((mod) => {
      if (canonicalScriptMatchKey(mod.scriptNumber) !== activeKey) return mod;
      const sorted = [...mod.rules].sort((a, b) => a.prio - b.prio);
      const targetRule = sorted[stepIndex];
      if (!targetRule) return mod;

      const updatedRule: ScriptRule = {
        ...targetRule,
        targetNumber:
          targetRule.targetNumber && canonicalScriptMatchKey(targetRule.targetNumber) === toKey
            ? undefined
            : targetRule.targetNumber,
        choices: targetRule.choices.filter(
          (ch) => canonicalScriptMatchKey(ch.targetNumber) !== toKey
        ),
      };

      const updatedRules = mod.rules
        .map((r) => (r.id === targetRule.id ? updatedRule : r))
        .filter((r) => !(r.id === targetRule.id && isPureConnectionStubRule(r)));

      return { ...mod, rules: updatedRules };
    });

    const nextLinks = (workspace.manualLinks || []).filter(
      (lnk) =>
        !(
          canonicalScriptMatchKey(lnk.fromScriptNumber) === activeKey &&
          canonicalScriptMatchKey(lnk.toTargetNumber) === toKey
        )
    );

    return buildScriptWorkspace(nextModules, {
      ...workspace,
      manualLinks: nextLinks,
    });
  }

  // Case 2: Detail view disconnecting an incoming caller `INC_<caller> -> SELF_<mod>`
  if (fromNodeId.startsWith('INC_')) {
    const fromRef = fromNodeId.replace(/^INC_/, '');
    const toRef =
      extractScriptNumberFromNodeId(toNodeId, workspace.modules) ||
      (viewLevel.level === 'detail' ? viewLevel.scriptNumber : toNodeId.replace(/^(?:S|SELF)_/, ''));
    const fromKey = canonicalScriptMatchKey(fromRef);
    const toKey = canonicalScriptMatchKey(toRef);

    const nextModules = workspace.modules.map((mod) => {
      if (canonicalScriptMatchKey(mod.scriptNumber) !== toKey && canonicalScriptMatchKey(mod.scriptNumber) !== fromKey) {
        return mod;
      }
      if (canonicalScriptMatchKey(mod.scriptNumber) !== fromKey) return mod;
      const nextRules = mod.rules
        .map((r) => ({
          ...r,
          targetNumber:
            r.targetNumber && canonicalScriptMatchKey(r.targetNumber) === toKey
              ? undefined
              : r.targetNumber,
          choices: r.choices.filter(
            (ch) => canonicalScriptMatchKey(ch.targetNumber) !== toKey
          ),
        }))
        .filter((r) => !isPureConnectionStubRule(r));
      return { ...mod, rules: nextRules };
    });

    const nextLinks = (workspace.manualLinks || []).filter(
      (lnk) =>
        !(
          canonicalScriptMatchKey(lnk.fromScriptNumber) === fromKey &&
          canonicalScriptMatchKey(lnk.toTargetNumber) === toKey
        )
    );

    return buildScriptWorkspace(nextModules, {
      ...workspace,
      manualLinks: nextLinks,
    });
  }

  const fromRef =
    extractScriptNumberFromNodeId(fromNodeId, workspace.modules) ||
    fromNodeId.replace(/^(?:S|JUMP|INC|SELF)_/, '');
  const toRef =
    extractScriptNumberFromNodeId(toNodeId, workspace.modules) ||
    toNodeId.replace(/^(?:S|JUMP|INC|SELF)_/, '');
  const fromKey = canonicalScriptMatchKey(fromRef);
  const toKey = canonicalScriptMatchKey(toRef);

  const isFromOrg = fromNodeId.startsWith('ORG_');
  const orgSuffix = isFromOrg ? fromNodeId.slice(4) : '';
  const isFromFax = fromNodeId === 'FAX_BUNDLE';
  const isToFax = toNodeId === 'FAX_BUNDLE';

  const ruleMatchesOrg = (r: ScriptRule): boolean => {
    if (!isFromOrg) return true;
    const ruleOrgKey = toMermaidNodeSuffix(r.orgaCode || r.organizationName || r.brandName || 'Orga');
    return ruleOrgKey === orgSuffix;
  };

  const nextModules = workspace.modules.map((mod) => {
    if (canonicalScriptMatchKey(mod.scriptNumber) !== fromKey) return mod;
    const nextRules = mod.rules
      .map((r) => {
        if (isToFax) {
          if (r.isFaxRoute && ruleMatchesOrg(r)) {
            return { ...r, isFaxRoute: undefined, targetNumber: undefined };
          }
          return r;
        }
        if (isFromFax) {
          if (r.isFaxRoute && r.targetNumber && canonicalScriptMatchKey(r.targetNumber) === toKey) {
            return { ...r, targetNumber: undefined };
          }
          return r;
        }
        if (!ruleMatchesOrg(r)) return r;

        return {
          ...r,
          targetNumber:
            r.targetNumber && canonicalScriptMatchKey(r.targetNumber) === toKey
              ? undefined
              : r.targetNumber,
          choices: r.choices.filter(
            (ch) => canonicalScriptMatchKey(ch.targetNumber) !== toKey
          ),
        };
      })
      .filter((r) => !isPureConnectionStubRule(r));

    return { ...mod, rules: nextRules };
  });

  const nextLinks = (workspace.manualLinks || []).filter(
    (lnk) =>
      !(
        canonicalScriptMatchKey(lnk.fromScriptNumber) === fromKey &&
        canonicalScriptMatchKey(lnk.toTargetNumber) === toKey
      )
  );

  return buildScriptWorkspace(nextModules, {
    ...workspace,
    manualLinks: nextLinks,
  });
}

/**
 * Updates the display label / choice key of an existing edge inside the ScriptWorkspace.
 */
export function updateEdgeLabelInWorkspace(
  workspace: ScriptWorkspace,
  viewLevel: CallflowViewLevel,
  fromNodeId: string,
  toNodeId: string,
  newLabel: string
): ScriptWorkspace {
  const cleanLabel = newLabel.trim();
  if (!fromNodeId || !toNodeId || !cleanLabel) return workspace;

  const tasteMatch = cleanLabel.match(/^(?:taste\s*)?([0-9*#]+)$/i);

  const stepMatch = fromNodeId.match(/^STEP_([A-Za-z0-9_]+)_(\d+)$/);
  if (viewLevel.level === 'detail' && stepMatch) {
    const stepIndex = Math.max(0, parseInt(stepMatch[2], 10) - 1);
    const toRef =
      extractScriptNumberFromNodeId(toNodeId, workspace.modules) ||
      toNodeId.replace(/^(?:S|JUMP|INC|SELF)_/, '');
    const toKey = canonicalScriptMatchKey(toRef);
    const activeKey = canonicalScriptMatchKey(viewLevel.scriptNumber);

    const nextModules = workspace.modules.map((mod) => {
      if (canonicalScriptMatchKey(mod.scriptNumber) !== activeKey) return mod;
      const sorted = [...mod.rules].sort((a, b) => a.prio - b.prio);
      const targetRule = sorted[stepIndex];
      if (!targetRule) return mod;

      const updatedChoices = targetRule.choices.map((ch) =>
        canonicalScriptMatchKey(ch.targetNumber) === toKey
          ? {
              ...ch,
              choice: tasteMatch ? tasteMatch[1] : cleanLabel,
              label: cleanLabel,
            }
          : ch
      );
      const updatedRule: ScriptRule = {
        ...targetRule,
        stepName:
          targetRule.targetNumber && canonicalScriptMatchKey(targetRule.targetNumber) === toKey
            ? cleanLabel
            : targetRule.stepName,
        choices: updatedChoices,
      };
      return {
        ...mod,
        rules: mod.rules.map((r) => (r.id === targetRule.id ? updatedRule : r)),
      };
    });

    return buildScriptWorkspace(nextModules, workspace);
  }

  const fromRef =
    extractScriptNumberFromNodeId(fromNodeId, workspace.modules) ||
    fromNodeId.replace(/^(?:S|JUMP|INC|SELF)_/, '');
  const toRef =
    extractScriptNumberFromNodeId(toNodeId, workspace.modules) ||
    toNodeId.replace(/^(?:S|JUMP|INC|SELF)_/, '');
  const fromKey = canonicalScriptMatchKey(fromRef);
  const toKey = canonicalScriptMatchKey(toRef);

  // 1. Update matching manualLinks if present
  let matchedManual = false;
  const nextLinks = (workspace.manualLinks || []).map((lnk) => {
    if (
      canonicalScriptMatchKey(lnk.fromScriptNumber) === fromKey &&
      canonicalScriptMatchKey(lnk.toTargetNumber) === toKey
    ) {
      matchedManual = true;
      return { ...lnk, label: cleanLabel };
    }
    return lnk;
  });

  if (matchedManual) {
    return buildScriptWorkspace(workspace.modules, {
      ...workspace,
      manualLinks: nextLinks,
    });
  }

  // 2. Otherwise update matching choice or append/update manual link / rule tag cleanly
  let updatedRuleAny = false;
  const nextModules = workspace.modules.map((mod) => {
    if (canonicalScriptMatchKey(mod.scriptNumber) !== fromKey) return mod;
    const nextRules = mod.rules.map((r) => {
      const hasMatchingChoice = r.choices.some(
        (ch) => canonicalScriptMatchKey(ch.targetNumber) === toKey
      );
      const hasMatchingTarget =
        r.targetNumber && canonicalScriptMatchKey(r.targetNumber) === toKey;

      if (!hasMatchingChoice && !hasMatchingTarget) return r;
      updatedRuleAny = true;

      if (hasMatchingChoice) {
        return {
          ...r,
          choices: r.choices.map((ch) =>
            canonicalScriptMatchKey(ch.targetNumber) === toKey
              ? {
                  ...ch,
                  choice: tasteMatch ? tasteMatch[1] : cleanLabel,
                  label: cleanLabel,
                }
              : ch
          ),
        };
      }

      // Convert direct target into a labeled rule or choice tag so Master & Detail reflect the label
      if (tasteMatch) {
        return {
          ...r,
          stepName: `Taste ${tasteMatch[1]} → ${toRef}`,
          targetNumber: undefined,
          choices: [
            ...r.choices,
            { choice: tasteMatch[1], targetNumber: r.targetNumber!, label: cleanLabel },
          ],
        };
      }

      return {
        ...r,
        stepName: cleanLabel,
        targetNumber: undefined,
        choices: [
          ...r.choices,
          { choice: cleanLabel, targetNumber: r.targetNumber!, label: cleanLabel },
        ],
      };
    });
    return { ...mod, rules: nextRules };
  });

  if (updatedRuleAny) {
    return buildScriptWorkspace(nextModules, workspace);
  }

  return buildScriptWorkspace(workspace.modules, {
    ...workspace,
    manualLinks: [
      ...nextLinks,
      {
        id: `lnk-lbl-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        fromScriptNumber: fromRef,
        toTargetNumber: toRef,
        label: cleanLabel,
      },
    ],
  });
}




