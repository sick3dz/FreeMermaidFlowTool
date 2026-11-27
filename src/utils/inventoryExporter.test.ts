import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  buildScriptWorkspace,
  parseCallflowTextWithFallback,
} from './scriptCallflowParser';
import { ScriptModule } from '../types/mermaidStudio';
import {
  INVENTORY_SCHEMA_VERSION,
  buildWorkspaceInventory,
  exportInventoryCsv,
  exportInventoryJson,
  exportInventoryXlsxUint8Array,
  filterWorkspaceInventoryBundle,
} from './inventoryExporter';

function makeModule(scriptNumber: string, rawText: string, fileName?: string): ScriptModule {
  const parsed = parseCallflowTextWithFallback(`=== ${scriptNumber} ===\n${rawText}`);
  const base = parsed[0] || {
    scriptNumber,
    scriptName: scriptNumber,
    isMaster: false,
    rawText,
    rules: [],
    outgoingNumbers: [],
  };
  return {
    ...base,
    scriptNumber,
    scriptName: base.scriptName || scriptNumber,
    isMaster: scriptNumber === 'Main',
    sourceFilename: fileName || `${scriptNumber}.s`,
    rawText,
  };
}

describe('inventoryExporter — Workspace Asset Inventory & Multi-Format Export (v1.6.5)', () => {
  const mainMod = makeModule(
    'Main',
    `
CDN 4711
DNIS 0800123456
VAR lv_unused_flag STRING
GLOBAL gv_customer_tier STRING
SECTION Entry_Checks
  ASSIGN "sk_live_secret_token_998877665544" TO gv_api_token
  ASSIGN "VIP" TO gv_customer_tier
  ASSIGN "unused_val" TO lv_unused_flag
  IF TIME OF DAY 08:00..18:00 AND gv_customer_tier = "VIP" THEN
    GIVE RAN "welcome_vip.wav"
    EXECUTE Sub_Service_Flow
  ELSE
    GIVE RAN Closed_Prompt
    DISCONNECT
  END IF
SECTION External_Lookup
  DB_QUERY "SELECT * FROM CUST_HIST"
  HIST_CALL CustHistoryLookup
  SEND REQUEST "https://api.flixcheck.com/user/v7/checks"
  GET RESPONSE INTO lv_hdx_resp
  QUEUE TO SKILLSET Service_VIP_Skill WITH PRIORITY 10
  QUEUE TO AGENT Agent_007
  TRANSFER TO +49301234567
  /* EXECUTE Legacy_Disabled_Flow */
`
  );

  const subMod = makeModule(
    'Sub_Service_Flow',
    `
SECTION Sub_Routing
  GIVE MUSIC 42
  IF date = Sys_Holiday_List THEN
    GIVE RAN holiday_notice.wav
    TRANSFER TO 0000
  END IF
  EXECUTE Missing_Subflow_Ref
  QUEUE TO SKILLSET Overflow_General
`
  );

  const orphanMod = makeModule(
    'Orphan_Legacy',
    `
SECTION Legacy_Only
  GIVE RAN legacy_only.wav
  DISCONNECT
`
  );

  it('extracts Prompts, WAVs, Skillsets, Agents, DNIS/CDNs/Transfers, Variables, DB/Hist/API calls, Subflows, Schedules & Anomalies with exact script/section/line provenance', () => {
    const ws = buildScriptWorkspace([mainMod, subMod, orphanMod]);
    const bundle = buildWorkspaceInventory(ws, { diagramTitle: 'Enterprise Demo' });

    expect(bundle.schemaVersion).toBe('1.6.5');
    expect(INVENTORY_SCHEMA_VERSION).toBe('1.6.5');
    expect(bundle.scriptCount).toBe(3);

    // Prompts & WAVs
    const wavItems = bundle.items.filter((i) => i.category === 'prompts_wavs');
    expect(wavItems.some((i) => i.name === 'welcome_vip.wav' && i.subType === 'wav-file')).toBe(true);
    expect(wavItems.some((i) => i.name === 'holiday_notice.wav' && i.subType === 'wav-file')).toBe(true);
    expect(wavItems.some((i) => i.name === 'Closed_Prompt' && i.subType === 'prompt-ran')).toBe(true);
    expect(wavItems.some((i) => i.subType === 'music-treatment')).toBe(true);

    const welcomeOcc = wavItems.find((i) => i.name === 'welcome_vip.wav')!.occurrences[0];
    expect(welcomeOcc.scriptNumber).toBe('Main');
    expect(welcomeOcc.sectionName).toBe('Entry_Checks');
    expect(welcomeOcc.lineNumber).toBeGreaterThan(5);

    // Skillsets & Agents
    const skillItems = bundle.items.filter((i) => i.category === 'skillsets_queues');
    expect(skillItems.some((i) => i.name === 'Service_VIP_Skill' && i.priority === 10)).toBe(true);
    expect(skillItems.some((i) => i.name === 'Agent_007' && i.subType === 'agent-target')).toBe(true);
    expect(skillItems.some((i) => i.name === 'Overflow_General')).toBe(true);

    // Numbers, DNIS, CDNs & Transfers
    const numItems = bundle.items.filter((i) => i.category === 'numbers_dnis_cdn');
    expect(numItems.some((i) => i.name === '4711' && i.subType === 'cdn')).toBe(true);
    expect(numItems.some((i) => i.name === '0800123456' && i.subType === 'dnis')).toBe(true);
    expect(numItems.some((i) => i.name === '+49301234567' && i.subType === 'transfer-number')).toBe(true);

    // Variables + Secret Redaction + Unused Variable detection
    const varItems = bundle.items.filter((i) => i.category === 'variables');
    const unusedFlagVar = varItems.find((i) => i.name === 'lv_unused_flag');
    expect(unusedFlagVar?.status).toBe('unused');
    expect(unusedFlagVar?.readCount).toBe(0);
    expect(unusedFlagVar?.writeCount).toBeGreaterThanOrEqual(1);

    const tierVar = varItems.find((i) => i.name === 'gv_customer_tier');
    expect(tierVar?.subType).toBe('global-var');
    expect(tierVar?.readCount).toBeGreaterThanOrEqual(1);
    expect(tierVar?.status).toBe('active');

    // Secret must NEVER appear unredacted anywhere in JSON/CSV/Items
    const rawJson = exportInventoryJson(bundle);
    expect(rawJson).not.toContain('sk_live_secret_token_998877665544');

    // External DB, Hist & API calls
    const extItems = bundle.items.filter((i) => i.category === 'external_db_hist_api');
    expect(extItems.some((i) => i.name.includes('DB_QUERY') && i.subType === 'db-hist-call')).toBe(true);
    expect(extItems.some((i) => i.name.includes('HIST_CALL') && i.subType === 'db-hist-call')).toBe(true);
    expect(extItems.some((i) => i.subType === 'flixcheck-api')).toBe(true);

    // Subflows & Missing Subflows
    const subItems = bundle.items.filter((i) => i.category === 'subflows_modules');
    expect(subItems.some((i) => i.name === 'Sub_Service_Flow' && i.status === 'active')).toBe(true);
    expect(
      subItems.some((i) => i.name === 'Missing_Subflow_Ref' && i.status === 'missing')
    ).toBe(true);

    // Schedules & Holidays
    const schedItems = bundle.items.filter((i) => i.category === 'schedules_holidays');
    expect(schedItems.length).toBeGreaterThanOrEqual(1);

    // Anomalies (Unused vars, Orphan script, Deactivated 0000 & commented-out EXECUTE, Missing refs)
    const anomalies = bundle.items.filter((i) => i.category === 'anomalies_references');
    expect(anomalies.some((i) => i.subType === 'unused-variable' && i.name === 'lv_unused_flag')).toBe(true);
    expect(anomalies.some((i) => i.subType === 'deactivated-target' && i.name === '0000')).toBe(true);
    expect(
      anomalies.some(
        (i) => i.subType === 'deactivated-target' && i.name.includes('Legacy_Disabled_Flow')
      )
    ).toBe(true);
    expect(anomalies.some((i) => i.subType === 'unused-script' && i.name.includes('Orphan_Legacy'))).toBe(
      true
    );
  });

  it('exports valid UTF-8 BOM CSV, structured JSON, filtered subsets, and 9-sheet OOXML .xlsx workbook', async () => {
    const ws = buildScriptWorkspace([mainMod, subMod]);
    const bundle = buildWorkspaceInventory(ws, { diagramTitle: 'Export Test' });

    // CSV Occurrences & Summary
    const csvOcc = exportInventoryCsv(bundle, { mode: 'occurrences' });
    expect(csvOcc.startsWith('\uFEFF')).toBe(true);
    expect(csvOcc).toContain('Skript-Nr.;Skript-Name;Quelldatei;Section / Bereich;Zeile');
    expect(csvOcc).toContain('welcome_vip.wav');
    expect(csvOcc).not.toContain('sk_live_secret_token_998877665544');

    const csvSum = exportInventoryCsv(bundle, { mode: 'summary' });
    expect(csvSum).toContain('Kategorie;Typ;Element / Name;Status;Fundstellen;Skripte');

    // Filtered subset bundle
    const filteredOnlyWav = filterWorkspaceInventoryBundle(
      bundle,
      bundle.items.filter((i) => i.subType === 'wav-file')
    );
    expect(filteredOnlyWav.items.every((i) => i.subType === 'wav-file')).toBe(true);
    expect(filteredOnlyWav.stats.totalItems).toBeLessThan(bundle.stats.totalItems);

    // JSON export
    const parsedJson = JSON.parse(exportInventoryJson(bundle));
    expect(parsedJson.schemaVersion).toBe('1.6.5');
    expect(Array.isArray(parsedJson.items)).toBe(true);
    expect(parsedJson.items[0].occurrences.length).toBeGreaterThan(0);

    // Native 9-sheet .xlsx OOXML ZIP validation
    const xlsxBytes = await exportInventoryXlsxUint8Array(bundle);
    const zip = await JSZip.loadAsync(xlsxBytes);
    const workbookXml = await zip.file('xl/workbook.xml')!.async('string');
    expect(workbookXml).toContain('Übersicht');
    expect(workbookXml).toContain('Prompts &amp; WAVs');
    expect(workbookXml).toContain('Skillsets &amp; Agents');
    expect(workbookXml).toContain('Rufnummern &amp; CDNs');
    expect(workbookXml).toContain('Variablen');
    expect(workbookXml).toContain('Externe DB &amp; APIs');
    expect(workbookXml).toContain('Subflows &amp; Zeitpläne');
    expect(workbookXml).toContain('Auffälligkeiten');
    expect(workbookXml).toContain('Fundstellen-Details');
  });
});
