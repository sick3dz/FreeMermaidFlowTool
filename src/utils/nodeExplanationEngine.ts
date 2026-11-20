import { CallflowGraph } from '../types/mermaidStudio';
import {
  EditableCallflowNodeSnapshot,
  canonicalScriptMatchKey,
} from './scriptCallflowParser';

export type NodeArchetypeId =
  | 'entry-main'
  | 'script-module'
  | 'schedule-condition'
  | 'announcement'
  | 'queue-skillset'
  | 'dtmf-menu'
  | 'wait-treatment'
  | 'hdx-integration'
  | 'external-target'
  | 'fax-bundle'
  | 'organization-group'
  | 'generic-step';

export interface DualAudienceNodePlainFact {
  label: string;
  value: string;
}

export interface DualAudienceNodeExplanation {
  archetypeId: NodeArchetypeId;
  archetypeLabel: string;
  shortTagline: string;
  whatIsIt: string;
  whatHappensSummary: string;
  whatHappensSteps: string[];
  plainFacts: DualAudienceNodePlainFact[];
  technicalSummary: string;
  friendlyTargetLabels?: Record<string, string>;
}

export interface NodeExplanationInput {
  nodeId: string;
  mode: EditableCallflowNodeSnapshot['mode'];
  scriptNumber: string;
  title: string;
  blockType: string;
  prio?: number;
  announcement?: string;
  queueTarget?: string;
  schedule?: string;
  condition?: string;
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
  specialParameters?: Array<{
    key: string;
    label: string;
    value: string;
  }>;
  relatedFindings?: Array<{
    severity: 'error' | 'warning' | 'info';
    title: string;
    recommendation: string;
  }>;
}

function cleanReadableText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function formatReadableList(items: string[], maxItems = 4): string {
  const unique = Array.from(new Set(items.map((x) => cleanReadableText(x)).filter(Boolean)));
  if (unique.length === 0) return '';
  if (unique.length <= maxItems) return unique.join(', ');
  return `${unique.slice(0, maxItems).join(', ')} (+${unique.length - maxItems} weitere)`;
}

const WEEKDAY_GERMAN_MAP: Record<string, string> = {
  MONDAY: 'Montag',
  MON: 'Mo',
  MO: 'Mo',
  TUESDAY: 'Dienstag',
  TUE: 'Di',
  DI: 'Di',
  WEDNESDAY: 'Mittwoch',
  WED: 'Mi',
  MI: 'Mi',
  THURSDAY: 'Donnerstag',
  THU: 'Do',
  DO: 'Do',
  FRIDAY: 'Freitag',
  FRI: 'Fr',
  FR: 'Fr',
  SATURDAY: 'Samstag',
  SAT: 'Sa',
  SA: 'Sa',
  SUNDAY: 'Sonntag',
  SUN: 'So',
  SO: 'So',
};

function translateWeekdayToken(token: string): string {
  const key = token.trim().toUpperCase();
  return WEEKDAY_GERMAN_MAP[key] || token.trim();
}

/**
 * Deterministic translator that turns raw Avaya / CCMA condition syntax into
 * plain, everyday German for non-technical readers (Laie view).
 * IT-Profi always retains the untouched original condition expression.
 */
export function translateAvayaConditionToPlainGerman(rawCondition?: string): string {
  const raw = cleanReadableText(rawCondition);
  if (!raw) return '';

  // Split composite AND / && conditions into readable clauses
  const rawClauses = raw
    .replace(/^IF\s+/i, '')
    .split(/\s+(?:AND|&&)\s+|\s*&\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const translatedClauses = rawClauses.map((clause) => {
    const upper = clause.toUpperCase();

    // 1. Out of service / geschlossen
    if (/\b(?:OUT\s+OF\s+SERVICE|OOS|NOT\s+IN\s+SERVICE)\b/i.test(clause)) {
      const skMatch = clause.match(/SKILLSET\s+([A-Za-z0-9_.-]+)/i);
      return skMatch
        ? `das Team „${skMatch[1]}“ aktuell außer Betrieb bzw. geschlossen ist`
        : 'der Dienst oder das Team aktuell außer Betrieb bzw. geschlossen ist';
    }

    // 2. Logged / Available / Idle Agents
    const loggedZeroMatch = clause.match(
      /(?:LOGGED|AVAILABLE|IDLE)\s+AGENTS?(?:\s+(?:IN\s+)?SKILLSET)?\s*([A-Za-z0-9_.-]+)?\s*(?:=|<=)\s*0\b/i
    );
    if (loggedZeroMatch || /\bNOT\s+LOGGED\b/i.test(clause)) {
      const sk = loggedZeroMatch?.[1] && !/^(?:SKILLSET|QUEUE)$/i.test(loggedZeroMatch[1])
        ? loggedZeroMatch[1]
        : '';
      return sk
        ? `im Team „${sk}“ aktuell kein Mitarbeiter angemeldet bzw. frei ist`
        : 'aktuell kein Mitarbeiter im Team angemeldet bzw. frei ist';
    }
    const loggedCompMatch = clause.match(
      /(?:LOGGED|AVAILABLE|IDLE)\s+AGENTS?(?:\s+(?:IN\s+)?SKILLSET)?\s*([A-Za-z0-9_.-]+)?\s*(>=|<=|>|<|=)\s*(\d+)/i
    );
    if (loggedCompMatch) {
      const sk = loggedCompMatch[1] && !/^(?:SKILLSET|QUEUE)$/i.test(loggedCompMatch[1])
        ? ` im Team „${loggedCompMatch[1]}“`
        : '';
      const op = loggedCompMatch[2];
      const num = loggedCompMatch[3];
      const opText =
        op === '>'
          ? `mehr als ${num}`
          : op === '>='
            ? `mindestens ${num}`
            : op === '<'
              ? `weniger als ${num}`
              : op === '<='
                ? `höchstens ${num}`
                : `genau ${num}`;
      return `${opText} Mitarbeiter${sk} angemeldet bzw. verfügbar sind`;
    }

    // 3. Queued calls / waiting callers
    const queuedMatch = clause.match(
      /(?:QUEUED\s+CALLS|CALLS\s+WAITING|QUEUE\s+LENGTH)(?:\s+(?:IN\s+)?SKILLSET)?\s*([A-Za-z0-9_.-]+)?\s*(>=|<=|>|<|=)\s*(\d+)/i
    );
    if (queuedMatch) {
      const sk = queuedMatch[1] && !/^(?:SKILLSET|QUEUE)$/i.test(queuedMatch[1])
        ? ` in „${queuedMatch[1]}“`
        : '';
      const op = queuedMatch[2];
      const num = queuedMatch[3];
      const opText =
        op === '>'
          ? `mehr als ${num}`
          : op === '>='
            ? `mindestens ${num}`
            : op === '<'
              ? `weniger als ${num}`
              : op === '<='
                ? `höchstens ${num}`
                : `genau ${num}`;
      return `bereits ${opText} Anrufer${sk} in der Warteschlange warten`;
    }

    // 4. Expected Wait Time (EWT)
    const ewtMatch = clause.match(
      /(?:EXPECTED\s+WAIT\s+TIME|EWT|WAIT\s+TIME)(?:\s+SKILLSET)?\s*([A-Za-z0-9_.-]+)?\s*(>=|<=|>|<|=)\s*(\d+)/i
    );
    if (ewtMatch) {
      const op = ewtMatch[2];
      const sec = ewtMatch[3];
      const opText =
        op === '>' || op === '>=' ? `länger als ${sec} Sekunden` : `höchstens ${sec} Sekunden`;
      return `die geschätzte Wartezeit ${opText} beträgt`;
    }

    // 5. Day of Week
    const dowRange = clause.match(
      /DAY\s+OF\s+WEEK\s*(?:=|IN)?\s*([A-Za-z]+)\s*(?:\.\.|-|TO|BIS)\s*([A-Za-z]+)/i
    );
    if (dowRange) {
      return `der Anruf zwischen ${translateWeekdayToken(dowRange[1])} und ${translateWeekdayToken(dowRange[2])} eingeht`;
    }
    const dowSingle = clause.match(/DAY\s+OF\s+WEEK\s*(?:=|IN)?\s*([A-Za-z,\s]+)/i);
    if (dowSingle) {
      const days = dowSingle[1]
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(translateWeekdayToken);
      if (days.length > 0) {
        return `der Anruf an ${days.join(', ')} eingeht`;
      }
    }

    // 6. Time of Day
    const todRange = clause.match(
      /TIME(?:\s+OF\s+DAY)?\s*(?:=|IN)?\s*(\d{1,2}:\d{2})\s*(?:\.\.|-|TO|BIS)\s*(\d{1,2}:\d{2})/i
    );
    if (todRange) {
      return `die Uhrzeit zwischen ${todRange[1]} und ${todRange[2]} Uhr liegt`;
    }

    // 7. Holiday / Feiertag
    if (/\b(?:HOLIDAY|FEIERTAG)\b/i.test(clause)) {
      if (/\b(?:NOT|FALSE|!|NEIN|= *0)\b/i.test(clause)) {
        return 'heute kein Feiertag ist';
      }
      return 'heute ein gesetzlicher oder hinterlegter Feiertag ist';
    }

    // 8. SondZeit / Notfall / Störung
    if (/\b(?:SONDZEIT|NOTFALL|EMERGENCY|STOERUNG|STÖRUNG)\b/i.test(clause)) {
      if (/\b(?:NOT|FALSE|INAKTIV|AUS|= *0)\b/i.test(clause)) {
        return 'keine Sonder- oder Notfallschaltung aktiv ist';
      }
      return 'eine Sonderzeit- oder Notfallschaltung aktiv ist';
    }

    // 9. DNIS / Calling Number / CLID
    const dnisMatch = clause.match(/\b(?:DNIS|CALLED\s+NUMBER)\s*(?:=|IN)\s*([0-9*#,\s+.-]+)/i);
    if (dnisMatch) {
      return `die gewählte Rufnummer ${cleanReadableText(dnisMatch[1])} ist`;
    }
    const clidMatch = clause.match(/\b(?:CLID|CALLING\s+NUMBER|ANI)\s*(?:=|IN)\s*([0-9*#,\s+.-]+)/i);
    if (clidMatch) {
      return `die Rufnummer des Anrufers zu ${cleanReadableText(clidMatch[1])} passt`;
    }

    // 10. Busy / Full
    if (upper.includes('BUSY') || upper.includes('FULL')) {
      return 'die Zielstelle bzw. Warteschlange aktuell voll oder besetzt ist';
    }

    // Fallback: keep clean human phrasing for custom rules
    return `die Bedingung „${clause}“ zutrifft`;
  });

  if (translatedClauses.length === 1) {
    return `Es wird geprüft, ob ${translatedClauses[0]}.`;
  }
  return `Es wird geprüft, ob ${translatedClauses.join(' und ')}.`;
}

/**
 * Translates raw Avaya audio/treatment commands (GIVE MUSIC, GIVE RAN, RINGBACK, etc.)
 * into plain German descriptions for non-technical readers.
 */
export function translateAvayaTreatmentToPlainGerman(rawTreatment?: string): string {
  const raw = cleanReadableText(rawTreatment);
  if (!raw) return '';

  const musicMatch = raw.match(/\bGIVE\s+MUSIC\s*([A-Za-z0-9_.-]+)?/i);
  if (musicMatch) {
    return musicMatch[1]
      ? `Wartemusik (Kanal ${musicMatch[1]})`
      : 'Wartemusik';
  }
  const ranMatch = raw.match(/\bGIVE\s+RAN\s*([A-Za-z0-9_.-]+)?/i);
  if (ranMatch) {
    return ranMatch[1]
      ? `Aufgezeichnete Sprachansage (Nr. ${ranMatch[1]})`
      : 'Aufgezeichnete Sprachansage';
  }
  if (/\bGIVE\s+RINGBACK\b/i.test(raw)) {
    return 'Freizeichen / Klingelton für den Anrufer';
  }
  if (/\bGIVE\s+SILENCE\b/i.test(raw)) {
    return 'Kurze Stille-Pause in der Leitung';
  }
  if (/\bGIVE\s+BUSY\b/i.test(raw)) {
    return 'Besetztzeichen (Leitung belegt)';
  }
  if (/\bGIVE\s+IVR\b/i.test(raw)) {
    return 'Sprachmenü-Ansage (IVR)';
  }
  if (/\bDISCONNECT\b/i.test(raw)) {
    return 'Gespräch wird regulär beendet';
  }
  return raw;
}

/**
 * Resolves a numeric or technical target reference to "Number · Friendly Name"
 * whenever a matching script name is known from the workspace.
 */
export function formatFriendlyTargetName(
  ref: string,
  scriptLabelMap?: Record<string, string>
): string {
  const cleaned = cleanReadableText(ref);
  if (!cleaned) return '';
  if (!scriptLabelMap) return cleaned;

  const direct =
    scriptLabelMap[cleaned] ||
    scriptLabelMap[cleaned.toLowerCase()] ||
    scriptLabelMap[canonicalScriptMatchKey(cleaned)];
  if (!direct) return cleaned;

  const cleanName = cleanReadableText(direct);
  if (!cleanName || cleanName.toLowerCase() === cleaned.toLowerCase()) {
    return cleaned;
  }
  if (cleanName.toLowerCase().includes(cleaned.toLowerCase())) {
    return cleanName;
  }
  return `${cleaned} · ${cleanName}`;
}

function detectArchetype(
  input: NodeExplanationInput,
  graphRole?: 'entry' | 'hub' | 'terminal' | 'step'
): NodeArchetypeId {
  const nodeIdUpper = (input.nodeId || '').toUpperCase();
  const titleLower = cleanReadableText(input.title).toLowerCase();
  const scriptKey = canonicalScriptMatchKey(input.scriptNumber || '');
  const outgoing = input.outgoingConnections || [];
  const hasDtmfChoices =
    input.blockType === 'dtmf' ||
    outgoing.some((c) => c.kind === 'choice' || /\btaste\s*[0-9*#]|\bdtmf\b/i.test(c.label || ''));

  if (nodeIdUpper === 'FAX_BUNDLE' || /\bfax\b/.test(titleLower)) {
    return 'fax-bundle';
  }
  if (nodeIdUpper.startsWith('ORG_')) {
    return 'organization-group';
  }
  if (
    scriptKey === 'main' ||
    scriptKey === 'start' ||
    scriptKey === 'master' ||
    (input.entryDnisNumbers && input.entryDnisNumbers.length > 0 && input.mode === 'workspace-module')
  ) {
    return 'entry-main';
  }
  if (hasDtmfChoices) {
    return 'dtmf-menu';
  }
  if (input.blockType === 'external' || input.mode === 'workspace-external') {
    return 'external-target';
  }
  if (input.blockType === 'queue' || (Boolean(cleanReadableText(input.queueTarget)) && input.mode === 'workspace-step')) {
    return 'queue-skillset';
  }
  if (
    input.blockType === 'condition' ||
    ((Boolean(cleanReadableText(input.condition)) ||
      Boolean(cleanReadableText(input.schedule)) ||
      Boolean(input.hasHolidayCheck)) &&
      input.mode === 'workspace-step')
  ) {
    return 'schedule-condition';
  }
  if (Boolean(cleanReadableText(input.hdxAction)) && !cleanReadableText(input.announcement)) {
    return 'hdx-integration';
  }
  if (
    (input.waitSeconds !== undefined || Boolean(cleanReadableText(input.treatmentInfo))) &&
    !cleanReadableText(input.announcement) &&
    input.mode === 'workspace-step'
  ) {
    return 'wait-treatment';
  }
  if (
    input.blockType === 'announcement' ||
    (Boolean(cleanReadableText(input.announcement)) && input.mode === 'workspace-step')
  ) {
    return 'announcement';
  }
  if (input.mode === 'workspace-module' || input.blockType === 'script') {
    return 'script-module';
  }
  if (graphRole === 'entry' && input.mode === 'raw-mermaid') {
    return 'entry-main';
  }
  return 'generic-step';
}

const ARCHETYPE_DEFINITIONS: Record<
  NodeArchetypeId,
  { label: string; tagline: string; whatIsIt: string }
> = {
  'entry-main': {
    label: 'Anruf-Einstieg (Hauptverteilung)',
    tagline: 'Erste Anlaufstelle für eingehende Anrufe',
    whatIsIt:
      'Hier kommen Anrufe über eine gewählte Rufnummer zuerst in der Telefonanlage an. Dieses Bauteil erkennt die gewählte Nummer und leitet den Anrufer geordnet an den passenden Fachbereich weiter.',
  },
  'script-module': {
    label: 'Teil-Ablauf (Unter-Skript)',
    tagline: 'Eigenständiger Baustein für einen Fachbereich oder ein Thema',
    whatIsIt:
      'Ein gekapselter Teil-Ablauf innerhalb der Telefonanlage. Darin sind alle Regeln, Öffnungszeiten, Ansagen und Ziele für genau dieses Anliegen oder diese Abteilung gebündelt.',
  },
  'schedule-condition': {
    label: 'Zeit-, Feiertags- oder Regelweiche',
    tagline: 'Prüft Bedingungen und wählt automatisch den richtigen Weg',
    whatIsIt:
      'Eine automatische Entscheidungsstelle im Anrufweg. Sie prüft z. B. Uhrzeit, Wochentag, Feiertage oder eine System-Bedingung und lenkt den Anrufer je nach Ergebnis auf den passenden Folgepfad.',
  },
  announcement: {
    label: 'Sprachansage (Audio-Hinweis)',
    tagline: 'Spielt dem Anrufer eine aufgezeichnete Information vor',
    whatIsIt:
      'Dieses Bauteil spielt eine hinterlegte Ton-Ansage ab – etwa eine Begrüßung, einen Datenschutz-Hinweis, eine Öffnungszeiten-Ansage oder eine Information bei Überlast.',
  },
  'queue-skillset': {
    label: 'Warteschlange (Mitarbeiter-Team)',
    tagline: 'Verbindet den Anrufer mit dem zuständigen Team',
    whatIsIt:
      'Hier wird der Anrufer an eine bestimmte Mitarbeiter-Gruppe (Warteschlange / Skillset) übergeben. Ist gerade niemand frei, wartet der Anrufer geordnet, bis ein passender Ansprechpartner übernimmt.',
  },
  'dtmf-menu': {
    label: 'Tastenmenü (Sprachauswahl)',
    tagline: 'Anrufer wählt sein Anliegen per Telefontaste (1, 2, 3 …)',
    whatIsIt:
      'Ein interaktives Auswahlmenü für Anrufer. Nach einer Ansage drückt der Anrufer eine Zahl auf dem Telefon, um direkt im richtigen Bereich zu landen.',
  },
  'wait-treatment': {
    label: 'Warteschleife & Wartemusik',
    tagline: 'Überbrückt Wartezeit mit Musik oder Zwischenansage',
    whatIsIt:
      'Dieses Bauteil hält den Anrufer für eine festgelegte Dauer in der Leitung und spielt währenddessen Wartemusik oder Hinweise ab, bevor der nächste Schritt greift.',
  },
  'hdx-integration': {
    label: 'System- & Datenbankabfrage',
    tagline: 'Ruft im Hintergrund Informationen aus einem IT-System ab',
    whatIsIt:
      'Für den Anrufer unsichtbarer Zwischenschritt: Die Telefonanlage fragt Daten aus einer Datenbank oder Schnittstelle ab (z. B. Kundenstatus oder Notfall-Schalter), um die Weiterleitung anzupassen.',
  },
  'external-target': {
    label: 'Externes Ziel / Weiterleitung / Ende',
    tagline: 'Übergibt das Gespräch nach außen oder beendet den Anruf',
    whatIsIt:
      'An dieser Stelle verlässt der Anruf diesen Teil-Ablauf – entweder durch Weiterleitung an eine externe Rufnummer/Stelle oder durch reguläres Beenden der Verbindung.',
  },
  'fax-bundle': {
    label: 'Fax-Weiterleitung (Fax-Bündel)',
    tagline: 'Gebündelter Zielpunkt für Fax-Rufnummern',
    whatIsIt:
      'Sammelziel für eingehende Fax-Verbindungen, die getrennt von normalen Sprachanrufen direkt an die zuständigen Fax-Empfänger geleitet werden.',
  },
  'organization-group': {
    label: 'Organisationsbereich / Standort',
    tagline: 'Bündelt die Anrufwege einer Abteilung oder Gesellschaft',
    whatIsIt:
      'Übersichts-Knoten, der zusammengehörige Rufnummern und Unter-Abläufe einer Organisationseinheit strukturiert gruppiert.',
  },
  'generic-step': {
    label: 'Prozessschritt im Ablauf',
    tagline: 'Station im dargestellten Callflow',
    whatIsIt:
      'Ein einzelner Schritt innerhalb des dargestellten Ablaufs, der den Anruf von einem vorherigen Schritt übernimmt und zum nächsten Ziel weiterführt.',
  },
};

export function buildDualAudienceNodeExplanation(
  input: NodeExplanationInput,
  graph?: CallflowGraph,
  scriptLabelMap?: Record<string, string>
): DualAudienceNodeExplanation {
  const graphNode = graph?.nodes.get(input.nodeId);
  const graphRole = graphNode?.role;
  const archetypeId = detectArchetype(input, graphRole);
  const baseDef = ARCHETYPE_DEFINITIONS[archetypeId];

  const incoming = input.incomingConnections || [];
  const outgoing = input.outgoingConnections || [];
  const rules = input.moduleRulesPreview || [];
  const dnis = input.entryDnisNumbers || [];
  const schedDisplay = cleanReadableText(input.resolvedScheduleDisplay || input.schedule);
  const announcement = cleanReadableText(input.announcement);
  const announcementPlain = translateAvayaTreatmentToPlainGerman(announcement);
  const queueTarget = cleanReadableText(input.queueTarget);
  const condition = cleanReadableText(input.condition);
  const conditionPlain = translateAvayaConditionToPlainGerman(condition);
  const treatment = cleanReadableText(input.treatmentInfo);
  const treatmentPlain = translateAvayaTreatmentToPlainGerman(treatment);
  const hdx = cleanReadableText(input.hdxAction);

  // Build friendly target label lookup for both incoming & outgoing targets
  const friendlyTargetLabels: Record<string, string> = {};
  const resolveTarget = (rawRef: string, fallbackLabel?: string): string => {
    const cleaned = cleanReadableText(rawRef);
    if (!cleaned) return cleanReadableText(fallbackLabel);
    const mapped = formatFriendlyTargetName(cleaned, scriptLabelMap);
    const finalLabel =
      mapped !== cleaned
        ? mapped
        : cleanReadableText(fallbackLabel) &&
            cleanReadableText(fallbackLabel).toLowerCase() !== cleaned.toLowerCase()
          ? `${cleaned} · ${cleanReadableText(fallbackLabel)}`
          : cleaned;
    friendlyTargetLabels[cleaned] = finalLabel;
    return finalLabel;
  };

  incoming.forEach((c) => {
    if (c.fromScriptNumber) resolveTarget(c.fromScriptNumber, c.fromLabel);
  });
  outgoing.forEach((c) => {
    if (c.toTargetNumber) resolveTarget(c.toTargetNumber);
  });

  // Refine label & explanation for generic raw-mermaid nodes using graph topology
  let archetypeLabel = baseDef.label;
  let shortTagline = baseDef.tagline;
  let whatIsIt = baseDef.whatIsIt;

  if (archetypeId === 'generic-step' && graphRole) {
    if (graphRole === 'entry') {
      archetypeLabel = 'Startpunkt im Ablauf';
      shortTagline = 'Hier beginnt dieser dargestellte Weg';
      whatIsIt =
        'Startknoten des Diagramms: Von hier aus startet der Anruf- oder Prozesspfad in die nachfolgenden Stationen.';
    } else if (graphRole === 'terminal') {
      archetypeLabel = 'Endpunkt im Ablauf';
      shortTagline = 'Hier endet dieser dargestellte Pfad';
      whatIsIt =
        'Abschließender Knoten im Diagramm: Nach dieser Station folgen im aktuellen Schaubild keine weiteren Schritte mehr.';
    } else if (graphRole === 'hub') {
      archetypeLabel = 'Verteiler / Verzweigung';
      shortTagline = 'Bündelt oder verzweigt mehrere Wege';
      whatIsIt =
        'Zentraler Knotenpunkt, an dem mehrere Wege zusammenlaufen oder sich auf verschiedene Folgeziele aufteilen.';
    }
  }

  // Concrete, step-by-step plain-language summary of what happens at THIS specific node
  const steps: string[] = [];

  if (dnis.length > 0) {
    steps.push(
      `Anrufer erreichen diesen Einstieg über ${dnis.length === 1 ? 'die Rufnummer' : 'die Rufnummern'} ${formatReadableList(dnis, 4)}.`
    );
  } else if (incoming.length > 0) {
    const fromNames = formatReadableList(
      incoming.map((c) => resolveTarget(c.fromScriptNumber, c.fromLabel)),
      3
    );
    steps.push(`Der Anruf kommt von ${fromNames} hier an.`);
  }

  if (schedDisplay) {
    steps.push(
      `Es gelten feste Zeiten: ${schedDisplay}${input.hasHolidayCheck ? ' (inklusive automatischer Feiertagsprüfung)' : ''}.`
    );
  } else if (input.hasHolidayCheck) {
    steps.push('Es wird automatisch geprüft, ob heute ein Feiertag ist.');
  }

  if (conditionPlain) {
    steps.push(conditionPlain);
  }

  if (hdx) {
    steps.push(
      `Im Hintergrund ruft die Telefonanlage automatisch Daten aus einem angebundenen IT-System ab (${hdx}).`
    );
  }

  if (announcement) {
    steps.push(
      announcementPlain && announcementPlain !== announcement
        ? `Der Anrufer hört eine Ansage: ${announcementPlain}.`
        : `Der Anrufer hört die Sprachansage „${announcement}“.`
    );
  }

  if (treatment || input.waitSeconds !== undefined) {
    const waitParts: string[] = [];
    if (input.waitSeconds !== undefined) waitParts.push(`${input.waitSeconds} Sekunden Wartezeit`);
    if (treatmentPlain) waitParts.push(treatmentPlain);
    steps.push(`Wartephase aktiv: ${waitParts.join(' mit ')}.`);
  }

  if (queueTarget) {
    steps.push(`Der Anruf wird an das Team bzw. die Warteschlange „${queueTarget}“ übergeben.`);
  }

  if (archetypeId === 'dtmf-menu' && outgoing.length > 0) {
    const choiceList = outgoing
      .slice(0, 5)
      .map(
        (c) =>
          `${cleanReadableText(c.label) || 'Auswahl'} → ${resolveTarget(c.toTargetNumber)}`
      )
      .join(' · ');
    steps.push(`Der Anrufer wählt per Taste zwischen ${outgoing.length} Optionen: ${choiceList}.`);
  } else if (outgoing.length > 0) {
    const targets = formatReadableList(
      outgoing.map((c) => {
        const targetText = resolveTarget(c.toTargetNumber);
        const cleanEdge = cleanReadableText(c.label);
        return cleanEdge ? `${targetText} (${cleanEdge})` : targetText;
      }),
      3
    );
    steps.push(
      outgoing.length === 1
        ? `Danach geht der Anruf weiter zu ${targets}.`
        : `Je nach Ergebnis verzweigt der Anruf auf ${outgoing.length} Ziele: ${targets}.`
    );
  } else if (rules.length > 0) {
    const ruleQueues = formatReadableList(
      rules.map((r) => r.queueTarget || '').filter(Boolean),
      3
    );
    const ruleTargets = formatReadableList(
      rules
        .map((r) => (r.targetNumber ? resolveTarget(r.targetNumber) : ''))
        .filter(Boolean),
      3
    );
    if (ruleQueues) {
      steps.push(
        `Intern arbeitet dieses Modul ${rules.length} Regeln ab und vermittelt u. a. an ${ruleQueues}.`
      );
    } else if (ruleTargets) {
      steps.push(
        `Intern prüft dieses Modul ${rules.length} Regeln in fester Reihenfolge und leitet u. a. an ${ruleTargets} weiter.`
      );
    } else {
      steps.push(`Intern enthält dieses Modul ${rules.length} nacheinander geprüfte Ablaufregeln.`);
    }
  }

  if (steps.length === 0) {
    if (archetypeId === 'external-target') {
      steps.push('Der Anruf wird an dieses externe Ziel übergeben oder regulär beendet.');
    } else if (archetypeId === 'fax-bundle') {
      steps.push('Eingehende Fax-Verbindungen werden direkt auf die hinterlegten Fax-Ziele durchgestellt.');
    } else {
      steps.push('Dieser Baustein verarbeitet den Anruf gemäß seiner Konfiguration und gibt ihn im Ablauf weiter.');
    }
  }

  // Plain-language key facts (no cryptic acronyms)
  const plainFacts: DualAudienceNodePlainFact[] = [];
  if (input.organizationName) {
    plainFacts.push({ label: 'Bereich / Organisation', value: input.organizationName });
  }
  if (schedDisplay) {
    plainFacts.push({
      label: 'Erreichbarkeit / Zeiten',
      value: `${schedDisplay}${input.hasHolidayCheck ? ' (mit Feiertagsprüfung)' : ''}`,
    });
  } else if (input.hasHolidayCheck) {
    plainFacts.push({ label: 'Feiertagsregelung', value: 'Feiertage werden automatisch berücksichtigt' });
  }
  if (queueTarget) {
    plainFacts.push({ label: 'Zuständiges Team', value: queueTarget });
  }
  if (announcement) {
    plainFacts.push({
      label: 'Gesprochene Ansage',
      value: announcementPlain || announcement,
    });
  }
  if (dnis.length > 0) {
    plainFacts.push({
      label: dnis.length === 1 ? 'Gewählte Rufnummer' : 'Gewählte Rufnummern',
      value: formatReadableList(dnis, 4),
    });
  }
  if (input.waitSeconds !== undefined) {
    plainFacts.push({ label: 'Wartezeit', value: `${input.waitSeconds} Sekunden` });
  }
  if (treatmentPlain) {
    plainFacts.push({ label: 'Wartemusik / Hinweis', value: treatmentPlain });
  }
  if (rules.length > 0) {
    plainFacts.push({
      label: 'Hinterlegte Regeln',
      value: `${rules.length} ${rules.length === 1 ? 'Ablaufschritt' : 'Ablaufschritte'} im Detail`,
    });
  }
  if (plainFacts.length === 0) {
    const inCnt = graphNode ? graphNode.inDegree : incoming.length;
    const outCnt = graphNode ? graphNode.outDegree : outgoing.length;
    plainFacts.push({
      label: 'Einbindung im Ablauf',
      value: `${inCnt} ${inCnt === 1 ? 'Zugang' : 'Zugänge'} · ${outCnt} ${outCnt === 1 ? 'Ausgang' : 'Ausgänge'}`,
    });
  }

  const whatHappensSummary = steps[0];

  // Crisp IT-Profi architectural line
  const techParts: string[] = [];
  techParts.push(`Typ: ${input.blockType || 'element'}`);
  techParts.push(`Modus: ${input.mode}`);
  if (input.scriptNumber) techParts.push(`Skript: ${input.scriptNumber}`);
  if (input.prio !== undefined) techParts.push(`Prio: ${input.prio}`);
  if (graphNode) {
    techParts.push(`Graph-Rolle: ${graphNode.role} (${graphNode.inDegree} ein / ${graphNode.outDegree} aus)`);
  }
  if (input.cdnAlias) techParts.push(`CDN: ${input.cdnAlias}`);

  return {
    archetypeId,
    archetypeLabel,
    shortTagline,
    whatIsIt,
    whatHappensSummary,
    whatHappensSteps: steps.slice(0, 5),
    plainFacts: plainFacts.slice(0, 6),
    technicalSummary: techParts.join(' · '),
    friendlyTargetLabels:
      Object.keys(friendlyTargetLabels).length > 0 ? friendlyTargetLabels : undefined,
  };
}
