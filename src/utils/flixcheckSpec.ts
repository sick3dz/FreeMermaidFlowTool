import type {
  CallflowHealthFinding,
  ExternalApiCommandKind,
  ExternalApiIntegrationMeta,
  FlixcheckActionKind,
  FlixcheckApiVersionStatus,
  FlixcheckChannelKind,
  ScriptModule,
  ScriptRule,
} from '../types/mermaidStudio';

/**
 * 100 % offline embedded specification for FlixCheck API v7 (api.flixcheck.com)
 * and Avaya AACC Host Data Exchange (HDX) integration validation.
 * Zero network requests, automatic secret redaction.
 */
export const FLIXCHECK_OFFLINE_SPEC = {
  currentVersion: 'v7' as const,
  baseUrl: 'https://api.flixcheck.com',
  openApiReference: 'https://dev.flixcheck.com/api/flixcheck_api.json',
  legacyDeprecationDate: '31.12.2026',
  activeRoutePrefixes: ['/user/v7/', '/customer/v7/', '/guest/v7/'] as const,
  deprecatedRoutePrefixes: ['/api/v1/', '/frontend/v1/', '/v1/'] as const,
  supportedChannels: ['sms', 'whatsapp', 'email'] as const,
};

const FLIXCHECK_KEYWORD_RE =
  /\b(?:flixcheck|flix[\s_-]*check|api\.flixcheck\.com|dev\.flixcheck\.com|flixcheck\.de|(?:\/(?:user|customer|guest)\/v7\/)|(?:\/(?:api|frontend)\/v1\/checks?))\b/i;

const FLIXCHECK_VAR_HINT_RE =
  /(?:^|[_\s.-])(?:(?:flix|flixcheck)[_-]?(?:template|check|channel|sendtype|status|url|endpoint|api|provider|id|token|key|mobile|phone|recipient|mail|email|custom)|fc[_-]?(?:template|check|sendtype|channel|endpoint|api[_-]?url|flix))\b/i;

const EXPLICIT_EXTERNAL_HTTP_RE =
  /(?:https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\/(?:api|rest)\/v\d+\/|\b(?:webhook|rest[_-]?api|http[_-]?post|http[_-]?get|http[_-]?put|http[_-]?request|json[_-]?api)\b)/i;

const SECRET_ASSIGN_VAR_RE =
  /(?:^|[_\s.-])(?:api[_-]?key|x[_-]?api[_-]?key|auth[_-]?token|bearer[_-]?token|access[_-]?token|secret[_-]?key|flixcheck[_-]?key|fc[_-]?key|fc[_-]?token)(?:$|[_\s.-])/i;

const SECRET_VALUE_PATTERN_RE =
  /(?:bearer\s+[A-Za-z0-9._-]{12,}|(?:fc|flx|sk|pk|api)[_-]?live[_-]?[A-Za-z0-9]{10,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_-]{28,}={0,2})/;

const TEMPLATE_VAR_RE =
  /(?:template[_-]?id|check[_-]?template|fc[_-]?template|flix[_-]?template|vorlage(?:[_-]?id)?)/i;

const CHANNEL_VAR_RE =
  /(?:send[_-]?type|channel|kanal|versand(?:art|kanal)?|delivery[_-]?channel|fc[_-]?channel|fc[_-]?sendtype)/i;

const RECIPIENT_VAR_RE =
  /(?:recipient|empfaenger|empfänger|mobile|mobil|handy|phone|rufnummer|telefon|clid|ani|email|mail)/i;

const ENDPOINT_VAR_RE =
  /(?:endpoint|api[_-]?url|base[_-]?url|request[_-]?url|service[_-]?url|flix[_-]?url|fc[_-]?url|uri|route|path)/i;

const CUSTOM_VAL_VAR_RE =
  /(?:custom[_-]?val|vorgang|ticket|case[_-]?id|kunden[_-]?nr|customer[_-]?id|contract|vertrag|policen|schaden)/i;

const RESPONSE_STATUS_COND_RE =
  /\b(?:status|http|rc|ret(?:urn)?[_-]?code|resp(?:onse)?|result|ergebnis|error|fehler|timeout|zeit[uü]berschreitung|fc[_-]?status|flix[_-]?status|check[_-]?status|hdx[_-]?status|ok|sent|failed|200|201|400|401|403|404|429|500|502|503|504)\b/i;

const ERROR_OR_FALLBACK_COND_RE =
  /\b(?:error|err|fehler|fail(?:ed)?|timeout|zeit[uü]berschreitung|not\s+ok|<>|=!|!=|else|sonst|nicht:|otherwise|default|400|401|403|404|429|500|502|503|504|fallback|abbruch)\b/i;

function stripQuotes(raw: string): string {
  return String(raw || '').trim().replace(/^["']|["']$/g, '').trim();
}

/**
 * Checks whether a variable assignment looks like a hardcoded API key / Bearer token.
 * Safe against false positives on normal placeholder variables or short numeric flags.
 */
export function isHardcodedApiSecretAssignment(varName: string, rawValue: string): boolean {
  const cleanVar = String(varName || '').trim();
  const cleanVal = stripQuotes(rawValue);
  if (!cleanVal || cleanVal.length < 12) return false;
  // Ignore obvious variable references / placeholders
  if (/^(?:gv_|cv_|sv_|sys_|env_|vault_|secret_|<|\$\{|\{\{)/i.test(cleanVal)) return false;
  if (/^(?:placeholder|dummy|none|null|empty|test|changeme)$/i.test(cleanVal)) return false;
  if (SECRET_ASSIGN_VAR_RE.test(cleanVar)) {
    return /^[A-Za-z0-9._:/+=-]{12,}$/.test(cleanVal) || /^bearer\s+\S{10,}$/i.test(cleanVal);
  }
  return /^bearer\s+[A-Za-z0-9._-]{16,}$/i.test(cleanVal);
}

/**
 * Redacts potential API keys / Bearer tokens from free text before exporting to Registry/HTML/Markdown.
 */
export function redactPotentialSecrets(text: string): string {
  if (!text) return '';
  let out = String(text);
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, '$1***redacted***');
  out = out.replace(
    /((?:api[_-]?key|x[_-]?api[_-]?key|token|secret)\s*[:=]\s*["']?)([A-Za-z0-9._/+=-]{12,})(["']?)/gi,
    '$1***redacted***$3'
  );
  return out;
}

function detectApiVersionFromText(text: string): {
  apiVersion: FlixcheckApiVersionStatus;
  endpointPath?: string;
} {
  const urlOrPathMatch = text.match(
    /(?:https?:\/\/[A-Za-z0-9.-]*flixcheck\.[A-Za-z]{2,})?(\/(?:user|customer|guest)\/v7\/[A-Za-z0-9_./{}-]*|\/(?:api|frontend)\/v1\/[A-Za-z0-9_./{}-]*|\/v1\/checks?[A-Za-z0-9_./{}-]*)/i
  );
  const endpointPath = urlOrPathMatch ? urlOrPathMatch[1] : undefined;

  if (endpointPath) {
    const low = endpointPath.toLowerCase();
    if (FLIXCHECK_OFFLINE_SPEC.activeRoutePrefixes.some((p) => low.startsWith(p))) {
      return { apiVersion: 'v7', endpointPath };
    }
    if (FLIXCHECK_OFFLINE_SPEC.deprecatedRoutePrefixes.some((p) => low.startsWith(p))) {
      return { apiVersion: 'v1-legacy', endpointPath };
    }
  }

  if (/\b(?:v7|api[\s_-]*v7|\/user\/v7|\/customer\/v7|\/guest\/v7)\b/i.test(text)) {
    return { apiVersion: 'v7', endpointPath: endpointPath || '/user/v7/checks' };
  }
  if (/\b(?:api[\s_-]*v1|frontend\/v1|\/api\/v1|flixcheck[\s_-]*v1)\b/i.test(text)) {
    return { apiVersion: 'v1-legacy', endpointPath: endpointPath || '/api/v1/checks' };
  }

  return { apiVersion: 'via-provider', endpointPath };
}

function detectChannel(text: string): {
  channel: FlixcheckChannelKind;
  channelLabel?: string;
} {
  if (/\bwhatsapp\b|\bwa[_-]?check\b/i.test(text)) {
    return { channel: 'whatsapp', channelLabel: 'WhatsApp' };
  }
  if (/\bsms\b|\bmobil(?:funk|nummer)?\b/i.test(text)) {
    return { channel: 'sms', channelLabel: 'SMS' };
  }
  if (/\be[\s_-]?mail\b|\bmail\b/i.test(text)) {
    return { channel: 'email', channelLabel: 'E-Mail' };
  }
  return { channel: 'unknown' };
}

function detectAction(
  commandKind: ExternalApiCommandKind,
  text: string,
  isFlixcheck: boolean
): { action: FlixcheckActionKind; actionLabel: string } {
  const low = text.toLowerCase();
  if (/webhook|callback|check\.(?:created|opened|completed)/i.test(low)) {
    return { action: 'webhook', actionLabel: 'Webhook / Event' };
  }
  if (/download|file|attachment|anhang|pdf|dokument|document|foto|photo/i.test(low)) {
    return { action: 'download-file', actionLabel: 'Dateien abrufen' };
  }
  if (/custom[_-]?val|update[_-]?check|patch|vorgang.*update/i.test(low)) {
    return { action: 'update-custom-values', actionLabel: 'Custom Values aktualisieren' };
  }
  if (
    commandKind === 'get-response' ||
    commandKind === 'readvar' ||
    /\b(?:get[_-]?check|check[_-]?status|poll|status[_-]?abfrage|read[_-]?status)\b/i.test(low)
  ) {
    return {
      action: 'get-check',
      actionLabel: isFlixcheck ? 'Check-Status / Antwort lesen' : 'HDX-Antwort lesen',
    };
  }
  if (
    isFlixcheck &&
    (commandKind === 'send-request' ||
      commandKind === 'send-info' ||
      commandKind === 'host-call' ||
      /\b(?:create[_-]?check|send[_-]?check|trigger|dispatch|versend|senden|start[_-]?check|\/checks?)\b/i.test(
        low
      ))
  ) {
    return { action: 'create-check', actionLabel: 'Check erstellen & senden' };
  }
  return {
    action: 'generic',
    actionLabel:
      commandKind === 'send-request'
        ? 'HDX Request senden'
        : commandKind === 'send-info'
        ? 'HDX Info senden'
        : commandKind === 'host-call'
        ? 'Host-Service aufrufen'
        : 'HDX-Daten lesen',
  };
}

export interface DetectExternalApiInput {
  commandKind: ExternalApiCommandKind;
  providerId?: string;
  argsText?: string;
  rawLine: string;
  activeVars: Map<string, string>;
  moduleContextText: string;
  hasHardcodedSecretInModule?: boolean;
}

/**
 * Builds structured FlixCheck / explicit external HTTP-API metadata from an AACC command
 * plus active contextual ASSIGN variables.
 *
 * Returns `undefined` for ordinary internal Avaya AACC HDX commands (e.g. internal Host/DB/CTI
 * SEND REQUEST, SEND INFO, READVAR, OPEN/SEND/RECEIVE HOST) that have no FlixCheck or
 * explicit external HTTP/REST API context — preventing false-positive mixing and HTTP warnings.
 */
export function detectExternalApiIntegration(
  input: DetectExternalApiInput
): ExternalApiIntegrationMeta | undefined {
  const {
    commandKind,
    providerId,
    argsText = '',
    rawLine,
    activeVars,
    moduleContextText,
    hasHardcodedSecretInModule = false,
  } = input;

  // Inspect active ASSIGN variables for FlixCheck context
  let templateId: string | undefined;
  let channelSourceText = '';
  let recipientRef: string | undefined;
  let endpointSourceText = '';
  const customValueVars: string[] = [];
  let varIndicatesFlixcheck = false;
  let hasHardcodedSecret = hasHardcodedSecretInModule;

  for (const [vName, vVal] of activeVars.entries()) {
    const cleanVal = stripQuotes(vVal);
    if (FLIXCHECK_KEYWORD_RE.test(`${vName} ${cleanVal}`) || FLIXCHECK_VAR_HINT_RE.test(vName)) {
      varIndicatesFlixcheck = true;
    }
    if (isHardcodedApiSecretAssignment(vName, cleanVal)) {
      hasHardcodedSecret = true;
    }
    if (!templateId && TEMPLATE_VAR_RE.test(vName) && cleanVal && cleanVal.length <= 64) {
      templateId = cleanVal;
    }
    if (CHANNEL_VAR_RE.test(vName) && cleanVal) {
      channelSourceText += ` ${cleanVal}`;
    }
    if (!recipientRef && RECIPIENT_VAR_RE.test(vName)) {
      recipientRef = cleanVal && cleanVal.length <= 36 ? `${vName} (${cleanVal})` : vName;
    }
    if (ENDPOINT_VAR_RE.test(vName) && cleanVal) {
      endpointSourceText += ` ${cleanVal}`;
    }
    if (CUSTOM_VAL_VAR_RE.test(vName)) {
      customValueVars.push(vName);
    }
  }

  // Inline templateId extraction (e.g. templateId=TPL_104 or "TPL-Schaden-01")
  if (!templateId) {
    const inlineTpl = `${argsText} ${rawLine}`.match(
      /(?:template[_-]?id|vorlage(?:[_-]?id)?|check[_-]?template)\s*[:=]\s*["']?([A-Za-z0-9._-]{2,48})["']?/i
    );
    if (inlineTpl && inlineTpl[1]) {
      templateId = inlineTpl[1];
    }
  }

  // Inline recipient variable detection (e.g. SEND REQUEST FlixCheck_HDX, CLID, gv_template)
  const argTokens = argsText
    .split(/[\s,;]+/)
    .map((t) => stripQuotes(t))
    .filter(Boolean);

  if (!recipientRef) {
    const recTok = argTokens.find((t) => RECIPIENT_VAR_RE.test(t));
    if (recTok) recipientRef = recTok;
  }

  // Check if any argToken matches an active ASSIGN variable with a template value
  if (!templateId) {
    for (const tok of argTokens) {
      if (TEMPLATE_VAR_RE.test(tok)) {
        const assigned = activeVars.get(tok.toLowerCase());
        templateId = assigned ? stripQuotes(assigned) : tok;
        break;
      }
    }
  }

  const combinedContext = `${providerId || ''} ${argsText} ${rawLine} ${endpointSourceText} ${channelSourceText} ${moduleContextText}`;
  const isFlixcheck =
    FLIXCHECK_KEYWORD_RE.test(combinedContext) ||
    varIndicatesFlixcheck ||
    (Boolean(providerId) && /\b(?:flixcheck|flix[\s_-]?check|flix[_-]?hdx)\b/i.test(providerId!));

  // Explicit non-FlixCheck HTTP/REST API detection ONLY from actual code/endpoint vars (never comments)
  const codeOnlyContext = `${providerId || ''} ${argsText} ${rawLine} ${endpointSourceText}`;
  const isExplicitExternalHttpApi =
    !isFlixcheck && EXPLICIT_EXTERNAL_HTTP_RE.test(codeOnlyContext);

  // Strictly leave ordinary internal Avaya AACC HDX commands untouched (no mixing, no HTTP warnings)
  if (!isFlixcheck && !isExplicitExternalHttpApi) {
    return undefined;
  }

  if (!hasHardcodedSecret && SECRET_VALUE_PATTERN_RE.test(rawLine) && /api[_-]?key|bearer|token|secret/i.test(rawLine)) {
    hasHardcodedSecret = true;
  }

  const { apiVersion, endpointPath } = detectApiVersionFromText(
    `${endpointSourceText} ${rawLine} ${argsText} ${isFlixcheck ? moduleContextText : ''}`
  );

  // Channel detection prioritizes explicit channel variable / line text before general module text
  let channelInfo = detectChannel(`${channelSourceText} ${argsText} ${rawLine}`);
  if (channelInfo.channel === 'unknown' && isFlixcheck) {
    channelInfo = detectChannel(moduleContextText);
  }

  const actionInfo = detectAction(commandKind, `${endpointPath || ''} ${argsText} ${rawLine}`, isFlixcheck);

  const responseVars =
    commandKind === 'get-response' || commandKind === 'readvar'
      ? argTokens.filter((t) => t !== providerId && !/^(?:from|into|to)$/i.test(t)).slice(0, 6)
      : undefined;

  return {
    provider: isFlixcheck ? 'flixcheck' : 'hdx',
    providerId: providerId || (isFlixcheck ? 'FlixCheck' : undefined),
    isFlixcheck,
    commandKind,
    action: actionInfo.action,
    actionLabel: actionInfo.actionLabel,
    channel: channelInfo.channel,
    channelLabel: channelInfo.channelLabel,
    templateId,
    recipientRef,
    endpointPath,
    apiVersion,
    customValueVars: customValueVars.length > 0 ? Array.from(new Set(customValueVars)).slice(0, 6) : undefined,
    responseVars: responseVars && responseVars.length > 0 ? responseVars : undefined,
    hasHardcodedSecret: hasHardcodedSecret || undefined,
  };
}

/**
 * Post-processes parsed rules of a module to correlate synchronous SEND REQUEST calls
 * with subsequent GET RESPONSE / READVAR rules and Error/Timeout fallback branches.
 */
export function enrichModuleExternalApiFlow(rules: ScriptRule[], rawText: string): void {
  if (!rules || rules.length === 0) return;

  const hasSecretInRaw = (() => {
    const assignRe = /\bassign\s+("[^"]+"|'[^']+'|[^\s\r\n]+)\s+to\s+([A-Za-z0-9_]+)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = assignRe.exec(rawText || '')) !== null) {
      if (isHardcodedApiSecretAssignment(m[2], m[1])) return true;
    }
    const assignEqRe = /\bassign\s+([A-Za-z0-9_]+)\s*=\s*([^\r\n]+)/gi;
    while ((m = assignEqRe.exec(rawText || '')) !== null) {
      if (isHardcodedApiSecretAssignment(m[1], m[2])) return true;
    }
    return false;
  })();

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const ext = rule.externalIntegration;
    if (!ext) continue;

    if (hasSecretInRaw && ext.isFlixcheck) {
      ext.hasHardcodedSecret = true;
    }

    if (ext.commandKind === 'send-request' || ext.commandKind === 'host-call') {
      let foundResponse = false;
      let foundErrorFallback = false;

      // Look ahead across the module (same section first, plus subsequent response/event/fallback sections)
      for (let j = i + 1; j < Math.min(rules.length, i + 40); j++) {
        const next = rules[j];
        const isSameSection =
          !rule.sectionName ||
          !next.sectionName ||
          rule.sectionName.toLowerCase() === next.sectionName.toLowerCase();

        // Check paired GET RESPONSE / READVAR (even if GET RESPONSE itself didn't repeat the FlixCheck keyword)
        const nextIsRawResponseCmd =
          !next.externalIntegration &&
          Boolean(next.hdxAction && /^(?:GET\s+RESPONSE|READVAR|RECEIVE\s+HOST)\b/i.test(next.hdxAction));

        if (
          (next.externalIntegration &&
            (next.externalIntegration.commandKind === 'get-response' ||
              next.externalIntegration.commandKind === 'readvar')) ||
          (isSameSection && nextIsRawResponseCmd)
        ) {
          foundResponse = true;
          if (!next.externalIntegration && nextIsRawResponseCmd) {
            next.externalIntegration = {
              provider: ext.provider,
              providerId: ext.providerId,
              isFlixcheck: ext.isFlixcheck,
              commandKind: /^READVAR\b/i.test(next.hdxAction || '') ? 'readvar' : 'get-response',
              action: 'get-check',
              actionLabel: ext.isFlixcheck ? 'Check-Status / Antwort lesen' : 'API-Antwort lesen',
              channel: ext.channel,
              channelLabel: ext.channelLabel,
              templateId: ext.templateId,
              endpointPath: ext.endpointPath,
              apiVersion: ext.apiVersion,
            };
          } else if (next.externalIntegration) {
            if (ext.isFlixcheck && !next.externalIntegration.isFlixcheck) {
              next.externalIntegration.isFlixcheck = true;
              next.externalIntegration.provider = 'flixcheck';
            }
            if (!next.externalIntegration.templateId && ext.templateId) {
              next.externalIntegration.templateId = ext.templateId;
            }
            if (next.externalIntegration.channel === 'unknown' && ext.channel !== 'unknown') {
              next.externalIntegration.channel = ext.channel;
              next.externalIntegration.channelLabel = ext.channelLabel;
            }
            if (next.externalIntegration.apiVersion === 'via-provider' && ext.apiVersion !== 'via-provider') {
              next.externalIntegration.apiVersion = ext.apiVersion;
              next.externalIntegration.endpointPath = ext.endpointPath;
            }
          }
        }

        const condAndLine = `${next.condition || ''} ${next.stepName || ''} ${next.eventName || ''} ${next.sectionName || ''} ${next.rawLine || ''}`;
        if (RESPONSE_STATUS_COND_RE.test(condAndLine)) {
          foundResponse = true;
        }
        if (
          (ERROR_OR_FALLBACK_COND_RE.test(condAndLine) || Boolean(next.eventName)) &&
          (next.queueTarget ||
            next.targetNumber ||
            next.announcement ||
            next.isDisconnect ||
            next.loopSectionTarget)
        ) {
          foundErrorFallback = true;
        }
      }

      ext.hasResponseHandler = foundResponse;
      ext.hasErrorFallback = foundErrorFallback;
    }
  }
}

/**
 * Formats a concise human-readable line for Mermaid / ELK step cards.
 */
export function formatExternalIntegrationCardSummary(meta: ExternalApiIntegrationMeta): string {
  const parts: string[] = [];
  if (meta.isFlixcheck) {
    const verTag =
      meta.apiVersion === 'v1-legacy'
        ? '⚠️ API v1 (Legacy)'
        : meta.apiVersion === 'v7'
        ? 'API v7'
        : 'HDX-Connector';
    parts.push(`📲 FlixCheck · ${meta.actionLabel} (${verTag})`);
  } else {
    parts.push(`🔌 HDX: ${meta.actionLabel}${meta.providerId ? ` (${meta.providerId})` : ''}`);
  }
  const detailBits: string[] = [];
  if (meta.channelLabel) detailBits.push(`Kanal: ${meta.channelLabel}`);
  if (meta.templateId) detailBits.push(`Template: ${meta.templateId}`);
  if (meta.endpointPath) detailBits.push(meta.endpointPath);
  if (detailBits.length > 0) {
    parts.push(detailBits.join(' · '));
  }
  return parts.join(' — ');
}

/**
 * Runs offline FlixCheck API v7 & HDX robustness checks for a single ScriptModule.
 */
export function analyzeModuleExternalApiHealth(mod: ScriptModule): CallflowHealthFinding[] {
  const findings: CallflowHealthFinding[] = [];
  const emittedKeys = new Set<string>();

  const pushUnique = (key: string, finding: CallflowHealthFinding) => {
    if (emittedKeys.has(key)) return;
    emittedKeys.add(key);
    findings.push(finding);
  };

  for (const rule of mod.rules) {
    const ext = rule.externalIntegration;
    if (!ext) continue;

    // 1. Hardcoded API key / Bearer token security check
    if (ext.hasHardcodedSecret) {
      pushUnique(`secret:${mod.scriptNumber}`, {
        id: `health-api-secret-${mod.scriptNumber}-${rule.id}`,
        severity: 'error',
        category: 'external-api',
        scriptNumber: mod.scriptNumber,
        scriptName: mod.scriptName,
        ruleId: rule.id,
        prio: rule.prio,
        title: `Möglicher Klartext-API-Key im Skript [${mod.scriptNumber}]`,
        description: `Im Modul "${mod.scriptName}" wurde ein potenziell hartcodierter API-Schlüssel oder Bearer-Token in einer Zuweisung/HDX-Zeile erkannt. Der Wert wird in Exporten automatisch maskiert.`,
        recommendation:
          'API-Keys und Zugangsdaten ausschließlich im sicheren HDX-Provider / Secret-Store hinterlegen und niemals im AACC-Skript speichern.',
      });
    }

    // 2. Deprecated FlixCheck v1 endpoint warning (EOL 31.12.2026)
    if (ext.isFlixcheck && ext.apiVersion === 'v1-legacy') {
      pushUnique(`v1:${mod.scriptNumber}:${ext.endpointPath || 'v1'}`, {
        id: `health-api-v1-${mod.scriptNumber}-${rule.id}`,
        severity: 'warning',
        category: 'external-api',
        scriptNumber: mod.scriptNumber,
        scriptName: mod.scriptName,
        ruleId: rule.id,
        prio: rule.prio,
        title: `Veraltete FlixCheck-API v1 in [${mod.scriptNumber}] (EOL ${FLIXCHECK_OFFLINE_SPEC.legacyDeprecationDate})`,
        description: `Prio ${rule.prio} referenziert die abgekündigte Route "${ext.endpointPath || '/api/v1/'}". FlixCheck unterstützt Legacy-Routen nur noch bis zum ${FLIXCHECK_OFFLINE_SPEC.legacyDeprecationDate}.`,
        recommendation:
          'Auf FlixCheck API v7 (z. B. https://api.flixcheck.com/user/v7/…) migrieren und den HDX-Provider entsprechend umstellen.',
      });
    }

    // 3. Synchronous SEND REQUEST without GET RESPONSE or error/timeout fallback
    //    Strictly scoped to genuine FlixCheck / external HTTP-API integrations and deduplicated per module
    if (ext.commandKind === 'send-request' || ext.commandKind === 'host-call') {
      if (ext.hasResponseHandler === false) {
        pushUnique(`noresp:${mod.scriptNumber}`, {
          id: `health-api-noresp-${mod.scriptNumber}-${rule.id}`,
          severity: 'warning',
          category: 'external-api',
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName,
          ruleId: rule.id,
          prio: rule.prio,
          title: `${ext.isFlixcheck ? 'FlixCheck' : 'API'}: SEND REQUEST ohne GET RESPONSE / Statusprüfung in [${mod.scriptNumber}]`,
          description: `Prio ${rule.prio} (${rule.stepName}) sendet eine synchrone ${ext.isFlixcheck ? 'FlixCheck-' : 'API-'}Anfrage, aber im Anschluss wurden weder GET RESPONSE / READVAR noch eine Statusprüfung erkannt.`,
          recommendation:
            'Antwort mit GET RESPONSE entgegennehmen und Erfolgs- sowie Timeout-/Fehlerpfade explizit verzweigen (oder SEND INFO für Fire-and-Forget verwenden).',
        });
      } else if (ext.hasErrorFallback === false) {
        pushUnique(`nofallback:${mod.scriptNumber}`, {
          id: `health-api-nofallback-${mod.scriptNumber}-${rule.id}`,
          severity: 'warning',
          category: 'external-api',
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName,
          ruleId: rule.id,
          prio: rule.prio,
          title: `${ext.isFlixcheck ? 'FlixCheck' : 'API'}: Fehlender Fehler-/Timeout-Fallback in [${mod.scriptNumber}]`,
          description: `Nach dem synchronen ${ext.isFlixcheck ? 'FlixCheck-' : 'API-'}Aufruf (Prio ${rule.prio}) wurde zwar eine Antwort gelesen, aber kein expliziter Fehler- oder Timeout-Fallback (z. B. Agenten-Queue, Subskript oder Ansage) erkannt.`,
          recommendation:
            'Für API-Fehler (4xx/5xx) oder Timeouts einen klaren ELSE-Fallback auf eine Warteschlange oder Entschuldigungsansage definieren.',
        });
      }
    }

    // 4. FlixCheck create-check missing templateId or channel info (deduplicated per module)
    if (ext.isFlixcheck && ext.action === 'create-check') {
      const missingFields: string[] = [];
      if (!ext.templateId) missingFields.push('Template-ID');
      if (ext.channel === 'unknown') missingFields.push('Versandkanal (SMS / WhatsApp / E-Mail)');
      if (missingFields.length > 0) {
        pushUnique(`missing-params:${mod.scriptNumber}`, {
          id: `health-api-params-${mod.scriptNumber}-${rule.id}`,
          severity: 'info',
          category: 'external-api',
          scriptNumber: mod.scriptNumber,
          scriptName: mod.scriptName,
          ruleId: rule.id,
          prio: rule.prio,
          title: `FlixCheck-Parameter im Skript [${mod.scriptNumber}] nicht explizit sichtbar`,
          description: `Bei Prio ${rule.prio} (${ext.actionLabel}) konnten folgende Felder im AACC-Skript nicht direkt ausgelesen werden: ${missingFields.join(' und ')}.`,
          recommendation:
            'Prüfen, ob Template-ID und sendType fest im HDX-Provider hinterlegt sind oder vor dem Aufruf per ASSIGN gesetzt werden sollten.',
        });
      }
    }
  }

  return findings;
}
