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
  graph?: CallflowGraph
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
  const queueTarget = cleanReadableText(input.queueTarget);
  const condition = cleanReadableText(input.condition);
  const treatment = cleanReadableText(input.treatmentInfo);
  const hdx = cleanReadableText(input.hdxAction);

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
      incoming.map((c) => c.fromLabel || c.fromScriptNumber),
      3
    );
    steps.push(
      `Der Anruf kommt von ${fromNames} hier an.`
    );
  }

  if (schedDisplay) {
    steps.push(
      `Es gelten feste Zeiten: ${schedDisplay}${input.hasHolidayCheck ? ' (inklusive automatischer Feiertagsprüfung)' : ''}.`
    );
  } else if (input.hasHolidayCheck) {
    steps.push('Es wird automatisch geprüft, ob heute ein Feiertag ist.');
  }

  if (condition) {
    steps.push(`Es wird eine Regel geprüft: „${condition}“.`);
  }

  if (hdx) {
    steps.push(`Im Hintergrund läuft eine System-/Datenabfrage (${hdx}).`);
  }

  if (announcement) {
    steps.push(`Der Anrufer hört die Ansage „${announcement}“.`);
  }

  if (treatment || input.waitSeconds !== undefined) {
    const waitParts: string[] = [];
    if (input.waitSeconds !== undefined) waitParts.push(`${input.waitSeconds} Sekunden Wartezeit`);
    if (treatment) waitParts.push(`Wartemusik / Hinweis (${treatment})`);
    steps.push(`Wartephase aktiv: ${waitParts.join(' mit ')}.`);
  }

  if (queueTarget) {
    steps.push(`Der Anruf wird an das Team bzw. die Warteschlange „${queueTarget}“ übergeben.`);
  }

  if (archetypeId === 'dtmf-menu' && outgoing.length > 0) {
    const choiceList = outgoing
      .slice(0, 5)
      .map((c) => `${cleanReadableText(c.label) || 'Auswahl'} → ${c.toTargetNumber}`)
      .join(' · ');
    steps.push(`Der Anrufer wählt per Taste zwischen ${outgoing.length} Optionen: ${choiceList}.`);
  } else if (outgoing.length > 0) {
    const targets = formatReadableList(
      outgoing.map((c) =>
        cleanReadableText(c.label)
          ? `${c.toTargetNumber} (${cleanReadableText(c.label)})`
          : c.toTargetNumber
      ),
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
      rules.map((r) => r.targetNumber || '').filter(Boolean),
      3
    );
    if (ruleQueues) {
      steps.push(`Intern arbeitet dieses Modul ${rules.length} Regeln ab und vermittelt u. a. an ${ruleQueues}.`);
    } else if (ruleTargets) {
      steps.push(`Intern prüft dieses Modul ${rules.length} Regeln in fester Reihenfolge und leitet u. a. an ${ruleTargets} weiter.`);
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
    plainFacts.push({ label: 'Gesprochene Ansage', value: announcement });
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
  if (treatment) {
    plainFacts.push({ label: 'Wartemusik / Hinweis', value: treatment });
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

  // Concise one-line layperson headline summarizing concrete behavior
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
  };
}
