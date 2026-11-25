import { describe, expect, it } from 'vitest';
import {
  buildMasterOverviewMermaid,
  buildScriptDetailMermaid,
  buildScriptWorkspace,
  canonicalScriptMatchKey,
  classifyAvayaWaypointTarget,
  classifyExtractedTarget,
  extractOclDeclaredVariables,
  isDynamicAvayaVariableTarget,
  isPlausibleNamedScriptTarget,
  parseScriptTextBundle,
  splitInlineIfThenElseClauses,
} from './scriptCallflowParser';
import { extractFirstScriptTargetRef } from './visioParser';

describe('Avaya AACC / OCL Parser Optimierungen (v1.3+)', () => {
  // 1. Interne GOTO <SECTION> vs. externe EXECUTE <SCRIPT>
  it('1. trennt internes GOTO Local_Section sauber von externem EXECUTE External_Script', () => {
    const script = `
SECTION Init
  IF CALLS WAITING > 5 THEN GOTO Local_Section
  EXECUTE External_Script
END SECTION

SECTION Local_Section
  GIVE ANNOUNCEMENT 4010
  WAIT 10
  DISCONNECT
END SECTION
`;
    const [mod] = parseScriptTextBundle(script, {
      defaultScriptNumber: 'Main',
      sourceFilename: 'Main.s',
    });

    const gotoRule = mod.rules.find((r) => r.loopSectionTarget === 'Local_Section');
    const execRule = mod.rules.find((r) => r.targetNumber === 'External_Script');

    expect(gotoRule).toBeDefined();
    expect(gotoRule?.targetNumber).toBeUndefined();
    expect(execRule).toBeDefined();
    expect(mod.outgoingNumbers).toEqual(['External_Script']);

    // Ebene-2-Mermaid zeichnet interne Verzweigung zu Local_Section
    const workspace = buildScriptWorkspace([mod]);
    const detailMermaid = buildScriptDetailMermaid(workspace, 'Main');
    expect(detailMermaid).toContain('↻ Zyklus: Local_Section');
    expect(workspace.missingTargets).toContain('External_Script');
    expect(workspace.missingTargets).not.toContain('Local_Section');
  });

  // 2. GOTO-Fallback auf bekanntes externes Skript im Skript-Pool
  it('2. löst GOTO auf ein existierendes externes Skript aus dem Skript-Pool als Fallback auf', () => {
    const [mainMod] = parseScriptTextBundle(
      `
SECTION Init
  GOTO Sales_Fallback
END SECTION
`,
      { defaultScriptNumber: 'Main', sourceFilename: 'Main.s' }
    );
    const [salesMod] = parseScriptTextBundle(
      `
SECTION Init
  QUEUE TO SKILLSET Sales_DE
END SECTION
`,
      { defaultScriptNumber: 'Sales_Fallback', sourceFilename: 'Sales_Fallback.s' }
    );

    const workspace = buildScriptWorkspace([mainMod, salesMod]);
    const updatedMain = workspace.modules.find((m) => m.scriptNumber === 'Main')!;

    expect(updatedMain.outgoingNumbers).toContain('Sales_Fallback');
    expect(workspace.missingTargets).toHaveLength(0);
  });

  // 3. GOTO auf unbekanntes Label erzeugt KEIN fehlendes Skript
  it('3. behandelt unbekanntes GOTO-Label ohne Treffer im Skript-Pool als internen Sprung statt fehlendes Skript', () => {
    const [mainMod] = parseScriptTextBundle(
      `
SECTION Init
  GOTO Unbekanntes_Label
END SECTION
`,
      { defaultScriptNumber: 'Main', sourceFilename: 'Main.s' }
    );

    const workspace = buildScriptWorkspace([mainMod]);
    expect(workspace.missingTargets).toHaveLength(0);
    expect(workspace.modules[0].rules[0].targetNumber).toBeUndefined();
    expect(workspace.modules[0].rules[0].loopSectionTarget).toBe('Unbekanntes_Label');
  });

  // 4. Deklarierte Variablen (VAR, GLOBAL, CONST, SET) niemals als statische Skriptnamen werten
  it('4. erkennt deklarierte OCL-Variablen (VAR, GLOBAL, CONST, SET) und blockiert sie als statische Skriptziele', () => {
    const lines = [
      'VAR',
      '  dyn_script STRING',
      'END VAR',
      'GLOBAL routing_var STRING',
      'CONST fallback_const = 42',
      'SET runtime_target = CLID',
    ];
    const { declaredVars } = extractOclDeclaredVariables(lines);

    expect(declaredVars.has('dyn_script')).toBe(true);
    expect(declaredVars.has('routing_var')).toBe(true);
    expect(declaredVars.has('fallback_const')).toBe(true);
    expect(declaredVars.has('runtime_target')).toBe(true);

    expect(isDynamicAvayaVariableTarget('dyn_script', declaredVars)).toBe(true);
    expect(isDynamicAvayaVariableTarget('routing_var', declaredVars)).toBe(true);
    expect(isPlausibleNamedScriptTarget('dyn_script', declaredVars)).toBe(false);
    expect(isPlausibleNamedScriptTarget('Sales_DE', declaredVars)).toBe(true);

    const [mod] = parseScriptTextBundle(
      `
VAR
  dyn_script STRING
END VAR
SECTION Init
  SET dyn_script = CLID
  EXECUTE dyn_script
END SECTION
`,
      { defaultScriptNumber: 'Main', sourceFilename: 'Main.s' }
    );
    expect(mod.outgoingNumbers).toHaveLength(0);
  });

  // 5. Bonus-Auflösung: SET target = 'FlixCheck_Main' -> EXECUTE target
  it('5. löst eindeutig auf ein String-Literal gesetzte Variablen (SET target = \'FlixCheck_Main\' -> EXECUTE target) auf', () => {
    const script = `
VAR
  target STRING
END VAR
SECTION Init
  SET target = 'FlixCheck_Main'
  EXECUTE target
END SECTION
`;
    const [mod] = parseScriptTextBundle(script, {
      defaultScriptNumber: 'Main',
      sourceFilename: 'Main.s',
    });

    expect(mod.outgoingNumbers).toContain('FlixCheck_Main');
    expect(mod.outgoingNumbers).not.toContain('target');
    expect(mod.rules.some((r) => r.targetNumber === 'FlixCheck_Main')).toBe(true);
  });

  // 6. Bonus-Auflösung auch bei Inline-Zuweisung mit Semikolon (`SET ziel_script = 'Sales_DE'; EXECUTE ziel_script`)
  it('6. löst Inline-Zuweisungen (SET ziel_script = \'Sales_DE\'; EXECUTE ziel_script) zuverlässig auf', () => {
    const [mod] = parseScriptTextBundle(
      `
SECTION Init
  SET ziel_script = 'Sales_DE'; EXECUTE ziel_script
END SECTION
`,
      { defaultScriptNumber: 'Main', sourceFilename: 'Main.s' }
    );

    expect(mod.outgoingNumbers).toEqual(['Sales_DE']);
  });

  // 7. Existierendes SUBFLOW_Kundenservice.s vs. unbekanntes Subflow_AEP
  it('7. priorisiert existierendes SUBFLOW_Kundenservice.s vor Wegweiser-Heuristiken und erkennt unbekanntes Subflow_AEP als Avaya-only Flow', () => {
    const knownScriptKeys = new Set([canonicalScriptMatchKey('SUBFLOW_Kundenservice.s')]);

    // Existierendes Skript im Pool hat IMMER Vorrang
    const existingClass = classifyExtractedTarget('SUBFLOW_Kundenservice.s', { knownScriptKeys });
    expect(existingClass.category).toBe('known-script');
    expect(
      classifyAvayaWaypointTarget('SUBFLOW_Kundenservice', { knownScriptKeys })
    ).toBeNull();

    // Selbst ohne knownScriptKeys darf der gefixte Regex `SUBFLOW_Kundenservice` nicht gierig schlucken
    expect(classifyAvayaWaypointTarget('SUBFLOW_Kundenservice')).toBeNull();

    // Unbekanntes Subflow_AEP wird als Avaya-only Menü / Flow erkannt
    const aepClass = classifyExtractedTarget('Subflow_AEP', { knownScriptKeys });
    expect(aepClass.category).toBe('avaya-waypoint');
    expect(aepClass.reason).toBe('Menü / Flow (Avaya-only)');
  });

  // 8. Strikte 5-Schritte-Prüfreihenfolge in classifyExtractedTarget
  it('8. erzwingt die strikte 5-Schritte-Reihenfolge (Sentinel/Var -> Known Pool -> Nummer/CDN -> Waypoint -> Missing)', () => {
    const declaredVars = new Set(['ziel_var']);
    const knownScriptKeys = new Set(['4910', 'flixcheck_custom', 'subflow_kundenservice']);

    // 1. Sentinel / Variable
    expect(classifyExtractedTarget('none', { knownScriptKeys, declaredVars }).category).toBe('ignored');
    expect(classifyExtractedTarget('ziel_var', { knownScriptKeys, declaredVars }).category).toBe('ignored');

    // 2. Bekannter Pool schlägt Wegweiser & Nummern
    expect(classifyExtractedTarget('4910', { knownScriptKeys }).category).toBe('known-script');
    expect(classifyExtractedTarget('FlixCheck_Custom', { knownScriptKeys }).category).toBe('known-script');

    // 3. Unbekannte reine Nummer -> Avaya-Nummer / CDN
    const unknownNum = classifyExtractedTarget('5500', { knownScriptKeys });
    expect(unknownNum.category).toBe('avaya-waypoint');
    expect(unknownNum.reason).toBe('Avaya-Nummer / CDN');

    // 4. Unbekannter Wegweiser -> Avaya-Waypoint
    expect(classifyExtractedTarget('Agent_Queing_Oracle', { knownScriptKeys }).reason).toBe(
      'Oracle Agent-Queuing (System)'
    );

    // 5. Unbekanntes reguläres Skript -> Missing / External Script
    const missing = classifyExtractedTarget('Flow_Vertrieb_DE', { knownScriptKeys });
    expect(missing.category).toBe('missing-script');
    expect(missing.reason).toBe('Missing / External Script');
  });

  // 9. Multi-Skillset-Support bei QUEUE TO
  it('9. parst kommagetrennte Multi-Skillset-Zuweisungen (QUEUE TO SKILLSET A, B, C WITH PRIORITY 5) als eigene Queue-Referenzen', () => {
    const [mod] = parseScriptTextBundle(
      `
SECTION Init
  QUEUE TO SKILLSET A, B, C WITH PRIORITY 5
END SECTION
`,
      { defaultScriptNumber: 'Main', sourceFilename: 'Main.s' }
    );

    const queueRules = mod.rules.filter((r) => Boolean(r.queueTarget));
    expect(queueRules.map((r) => r.queueTarget)).toEqual(['A', 'B', 'C']);
    expect(queueRules.every((r) => r.skillsetPriority === 5)).toBe(true);
    expect(queueRules.every((r) => r.queueKind === 'skillset')).toBe(true);

    const workspace = buildScriptWorkspace([mod]);
    const masterMermaid = buildMasterOverviewMermaid(workspace);
    expect(masterMermaid).toContain('Q_A');
    expect(masterMermaid).toContain('Q_B');
    expect(masterMermaid).toContain('Q_C');
  });

  // 10. Multi-Skillset mit langen Namen & Leerzeichen in Anführungszeichen
  it('10. parst QUEUE TO SKILLSET Sales_DE, Support_DE, VIP_DE WITH PRIORITY 10 vollständig', () => {
    const [mod] = parseScriptTextBundle(
      `
SECTION Routing
  QUEUE TO SKILLSET Sales_DE, Support_DE, VIP_DE WITH PRIORITY 10
END SECTION
`,
      { defaultScriptNumber: 'Sales_Main', sourceFilename: 'Sales_Main.s' }
    );

    const queueRules = mod.rules.filter((r) => Boolean(r.queueTarget));
    expect(queueRules.map((r) => r.queueTarget)).toEqual(['Sales_DE', 'Support_DE', 'VIP_DE']);
    expect(queueRules.map((r) => r.skillsetPriority)).toEqual([10, 10, 10]);
  });

  // 11. CALL HAS ABANDONED (kein False Positive) vs. CALL MeinSkript
  it('11. blockiert CALL HAS ABANDONED als False Positive und erkennt CALL MeinSkript korrekt als Skriptaufruf', () => {
    const [mod] = parseScriptTextBundle(
      `
SECTION Init
  IF CALL HAS ABANDONED THEN DISCONNECT
  ELSE CALL MeinSkript
END SECTION
`,
      { defaultScriptNumber: 'Main', sourceFilename: 'Main.s' }
    );

    expect(mod.outgoingNumbers).toEqual(['MeinSkript']);
    expect(mod.outgoingNumbers).not.toContain('has');
    expect(mod.outgoingNumbers).not.toContain('abandoned');
    expect(mod.rules.some((r) => r.isDisconnect)).toBe(true);
    expect(mod.rules.some((r) => r.targetNumber === 'MeinSkript')).toBe(true);
  });

  // 12. Inline IF ... THEN ... ELSE ... Splitting
  it('12. trennt Inline-Zeilen wie IF CALL HAS ABANDONED THEN DISCONNECT ELSE EXECUTE FlixCheck_Start sauber auf', () => {
    const clauses = splitInlineIfThenElseClauses(
      'IF CALL HAS ABANDONED THEN DISCONNECT ELSE EXECUTE FlixCheck_Start END IF'
    );
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toMatchObject({
      kind: 'if-then',
      condition: 'CALL HAS ABANDONED',
      action: 'DISCONNECT',
    });
    expect(clauses[1]).toMatchObject({
      kind: 'else',
      action: 'EXECUTE FlixCheck_Start',
      closesIf: true,
    });

    const [mod] = parseScriptTextBundle(
      `
SECTION Init
  IF CALL HAS ABANDONED THEN DISCONNECT ELSE EXECUTE FlixCheck_Start END IF
END SECTION
`,
      { defaultScriptNumber: 'Main', sourceFilename: 'Main.s' }
    );
    expect(mod.rules.some((r) => r.isDisconnect)).toBe(true);
    expect(mod.rules.some((r) => r.targetNumber === 'FlixCheck_Start')).toBe(true);
    expect(mod.outgoingNumbers).toEqual(['FlixCheck_Start']);
  });

  // 13. ELSE EXECUTE FlixCheck_Start auf eigener Zeile
  it('13. erkennt ELSE EXECUTE FlixCheck_Start nach einem IF-Block sauber als Skriptaufruf', () => {
    const [mod] = parseScriptTextBundle(
      `
SECTION Init
  IF NOT OUT OF SERVICE Hotline_DE THEN QUEUE TO SKILLSET Hotline_DE
  ELSE EXECUTE FlixCheck_Start
  END IF
END SECTION
`,
      { defaultScriptNumber: 'Main', sourceFilename: 'Main.s' }
    );

    expect(mod.rules.some((r) => r.queueTarget === 'Hotline_DE')).toBe(true);
    expect(mod.rules.some((r) => r.targetNumber === 'FlixCheck_Start')).toBe(true);
    expect(mod.outgoingNumbers).toEqual(['FlixCheck_Start']);
  });

  // 14. Oracle SEND REQUEST / GET RESPONSE / HOST-Anbindungen ohne False-Positive-Skriptziele
  it('14. erkennt Oracle SEND REQUEST, GET RESPONSE und OPEN/SEND/RECEIVE HOST als HDX-Anbindungen ohne Fehl-Sprünge', () => {
    const [mod] = parseScriptTextBundle(
      `
SECTION Oracle_Lookup
  OPEN HOST Oracle_CRM, "timeout=5"
  SEND REQUEST Oracle_CRM, CLID, "The call has arrived"
  GET RESPONSE Oracle_CRM, gv_customer_tier
  RECEIVE HOST Oracle_CRM, gv_status
END SECTION
`,
      { defaultScriptNumber: 'Oracle_Router', sourceFilename: 'Oracle_Router.s' }
    );

    expect(mod.outgoingNumbers).toHaveLength(0);
    const hdxActions = mod.rules.map((r) => r.hdxAction).filter(Boolean);
    expect(hdxActions.some((a) => a?.startsWith('OPEN HOST Oracle_CRM'))).toBe(true);
    expect(hdxActions.some((a) => a?.startsWith('SEND REQUEST Oracle_CRM'))).toBe(true);
    expect(hdxActions.some((a) => a?.startsWith('GET RESPONSE Oracle_CRM'))).toBe(true);
    expect(hdxActions.some((a) => a?.startsWith('RECEIVE HOST Oracle_CRM'))).toBe(true);
    expect(mod.rules.every((r) => Boolean(r.hdxAction))).toBe(true);
  });

  // 15. Visio-Shape mit gequotetem Skriptziel: Execute "Target_Script" & Execute "Kundenservice_DE"
  it('15. extrahiert gequotete Ziele in Visio-Shapes nach Schlüsselwörtern (Execute "Target_Script", Execute "Kundenservice_DE")', () => {
    expect(extractFirstScriptTargetRef('Execute "Target_Script"')).toBe('Target_Script');
    expect(extractFirstScriptTargetRef('Execute "Kundenservice_DE"')).toBe('Kundenservice_DE');
    expect(extractFirstScriptTargetRef("CALL SCRIPT 'VIP_Routing'")).toBe('VIP_Routing');
    expect(extractFirstScriptTargetRef('Weiterleitung -> "Hotline_Nord"')).toBe('Hotline_Nord');
  });

  // 16. Visio-Shape mit unbeteiligten Strings, Zeiten und Dauern ohne False Positives
  it('16. ignoriert unbeteiligte Strings sowie Datums-/Zeitangaben (08:00 - 17:00, 10s, 24.12.2025) in Visio-Shapes', () => {
    expect(extractFirstScriptTargetRef('08:00 - 17:00')).toBeUndefined();
    expect(extractFirstScriptTargetRef('Öffnungszeiten Mo-Fr 08:00 - 17:00')).toBeUndefined();
    expect(extractFirstScriptTargetRef('Wartezeit 10s')).toBeUndefined();
    expect(extractFirstScriptTargetRef('Feiertag 24.12.2025 · Pause 30 sec')).toBeUndefined();
    expect(extractFirstScriptTargetRef('SEND INFO "The call has ended"')).toBeUndefined();
    expect(extractFirstScriptTargetRef('CALL HAS ABANDONED')).toBeUndefined();
  });

  // 17. Integrierter End-to-End-Workspace-Check (SUBFLOW_Kundenservice.s + Subflow_AEP + FlixCheck + Oracle)
  it('17. baut einen konsistenten 350-Skript-tauglichen Workspace ohne Fehlklassifikation von geladenen SUBFLOW-Skripten', () => {
    const [mainMod] = parseScriptTextBundle(
      `
SECTION Init
  EXECUTE SUBFLOW_Kundenservice.s
  EXECUTE Subflow_AEP
  EXECUTE Agent_Queing_Oracle.s
  EXECUTE Unbekanntes_Modul
END SECTION
`,
      { defaultScriptNumber: 'Main', sourceFilename: 'Main.s' }
    );
    const [subflowMod] = parseScriptTextBundle(
      `
SECTION Init
  QUEUE TO SKILLSET Kundenservice_A, Kundenservice_B WITH PRIORITY 3
END SECTION
`,
      { defaultScriptNumber: 'SUBFLOW_Kundenservice', sourceFilename: 'SUBFLOW_Kundenservice.s' }
    );

    const workspace = buildScriptWorkspace([mainMod, subflowMod]);

    // SUBFLOW_Kundenservice ist geladen -> present, nicht missing, nicht waypoint
    const subflowChecklistItem = workspace.masterChecklist?.find(
      (i) => canonicalScriptMatchKey(i.refKey) === 'subflow_kundenservice'
    );
    expect(subflowChecklistItem?.status).toBe('present');

    // Subflow_AEP & Agent_Queing_Oracle -> waypoint
    const aepItem = workspace.masterChecklist?.find(
      (i) => canonicalScriptMatchKey(i.refKey) === 'subflow_aep'
    );
    expect(aepItem?.status).toBe('waypoint');
    const oracleItem = workspace.masterChecklist?.find(
      (i) => canonicalScriptMatchKey(i.refKey) === 'agent_queing_oracle'
    );
    expect(oracleItem?.status).toBe('waypoint');

    // Nur Unbekanntes_Modul bleibt wirklich missing
    expect(workspace.missingTargets).toEqual(['Unbekanntes_Modul']);
  });
});
