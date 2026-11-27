import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_APP_VERSION,
  CODE_INSPECT_AUDIT_PROOFS,
  ENTERPRISE_STAKEHOLDER_FACTS,
  LEGAL_AVAYA_CARDS,
  LEGAL_AVAYA_COPY_TEXT,
  buildFullAuditMarkdownReport,
  buildStandaloneAuditHtmlDossier,
} from './offlineAuditEngine';

function walkTextFiles(dirPath: string, results: string[] = []): string[] {
  if (!fs.existsSync(dirPath)) return results;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkTextFiles(fullPath, results);
    } else if (/\.(ts|tsx|js|mjs|cjs|html|css|json|md)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function walkBinaryImageFiles(dirPath: string, results: string[] = []): string[] {
  if (!fs.existsSync(dirPath)) return results;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkBinaryImageFiles(fullPath, results);
    } else if (/\.(png|jpe?g|gif|webp|bmp|ico|pdf)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('offlineAuditEngine — IT Audit, § 23 MarkenG, Brand Hygiene & Repository Privacy (v1.7.5)', () => {
  it('exposes version 1.7.5, script-analysis proofs 08–10, canonical Holiday DB terminology, and complete § 23 MarkenG notices including Genesys Cloud', () => {
    expect(AUDIT_APP_VERSION).toBe('1.7.5');

    const proofNumbers = CODE_INSPECT_AUDIT_PROOFS.map((p) => p.numberLabel);
    expect(proofNumbers).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);

    const proofIds = CODE_INSPECT_AUDIT_PROOFS.map((p) => p.id);
    expect(proofIds).toContain('genesys-flowir-migration-engine');
    expect(proofIds).toContain('workspace-inventory-multi-export');
    expect(proofIds).toContain('flixcheck-ocl-script-analysis');

    expect(ENTERPRISE_STAKEHOLDER_FACTS.some((f) => f.id === 'arch-genesys-flowir')).toBe(true);
    expect(ENTERPRISE_STAKEHOLDER_FACTS.some((f) => f.id === 'rev-inventory-export')).toBe(true);
    expect(ENTERPRISE_STAKEHOLDER_FACTS.some((f) => f.id === 'sec-flixcheck-redaction')).toBe(true);

    const legacyBrand = ['MermaidFree2Use', 'Open'].join('');
    const markdown = buildFullAuditMarkdownReport();
    const html = buildStandaloneAuditHtmlDossier();

    for (const text of [LEGAL_AVAYA_COPY_TEXT, markdown, html]) {
      expect(text).toContain('MermaidFree2Use');
      expect(text).not.toContain(legacyBrand);
      expect(text).toContain('Genesys Telecommunications Laboratories, Inc.');
      expect(text).toContain('Genesys Cloud CX');
      expect(text).toContain('Genesys Cloud Architect');
      expect(text).toContain('Archy');
      expect(text).toContain('Avaya Inc.');
      expect(text).toContain('Microsoft Corporation');
      expect(text).toContain('Oracle Corporation');
      expect(text).toContain('FlixCheck');
      expect(text).toContain('§ 23 MarkenG');
      expect(text).toContain('1.7.5');
    }

    expect(LEGAL_AVAYA_CARDS[0].title).toContain('Genesys Cloud');
    expect(markdown).toContain('WAIT source_hint');
    expect(markdown).toContain('Holiday DB: Guarded Standard');
    expect(markdown).toContain('Strict Holiday Review');
    expect(markdown).toContain('Holiday_Service');
    expect(markdown).toContain('CheckHolidayByDate');
    expect(markdown).toContain('Flow.IsExternalHolidayToday');
    expect(html).toContain('Workspace Asset Inventory');
  });

  it('enforces repository privacy hygiene: zero private image binaries, zero banned client/partner/regional/event/number pattern-group violations, and zero legacy brand suffix in src/, scripts/, and index.html', () => {
    const repoRoot = process.cwd();
    const scanDirs = [path.join(repoRoot, 'src'), path.join(repoRoot, 'scripts')];
    const filesToScan = [
      ...scanDirs.flatMap((d) => walkTextFiles(d)),
      path.join(repoRoot, 'index.html'),
    ];

    // Assemble prohibited exact tokens and pattern groups from fragments so no banned token appears literally in source
    const privacyPatternGroups: Array<{ group: string; regex: RegExp }> = [
      {
        group: 'client_brand_tokens',
        regex: new RegExp(
          [
            ['r', 'h', 'l', 'd'].join(''),
            ['rhein', 'land'].join(''),
            ['rh', 'ion'].join(''),
            ['credit', 'life'].join(''),
          ].join('|'),
          'i'
        ),
      },
      {
        group: 'org_prefix_and_regional_holiday_patterns',
        regex: new RegExp(
          [
            `\\b${['r', 'h'].join('')}\\d{2}(?:_[A-Za-z0-9]+)?\\b`,
            `${['Sys_', 'Feiertag', 'liste_'].join('')}[A-Za-z0-9_]+`,
            `\\b${['N', 'R', 'W'].join('')}\\b`,
          ].join('|'),
          'i'
        ),
      },
      {
        group: 'venue_event_and_internal_numbering_patterns',
        regex: new RegExp(
          [
            ['do', 'rint'].join(''),
            ['betriebs', 'versammlung'].join(''),
            `\\b${['Gesell', 'schaft'].join('')}\\d+\\b`,
            `\\b${['Gru', 'nd'].join('')}\\d+\\b`,
            `\\b${['CDN_', '6556'].join('')}\\b`,
          ].join('|'),
          'i'
        ),
      },
      {
        group: 'partner_internal_and_real_phone_patterns',
        regex: new RegExp(
          [
            `\\b${['AD', 'AC'].join('')}(?:_[A-Za-z0-9]+)?\\b`,
            `\\b${['KP', 'V_'].join('')}[A-Za-z0-9]+\\b`,
            `\\b${['L_', 'CL_', 'TOD'].join('')}\\b`,
            `\\b${['MCF_', 'Blacklist_', 'flag_cv'].join('')}\\b`,
            ['8976', '760'].join(''),
            ['8277', '2790', '35'].join(''),
          ].join('|'),
          'i'
        ),
      },
    ];
    const legacyBrand = ['MermaidFree2Use', 'Open'].join('');

    const patternViolations: Array<{ file: string; group: string }> = [];
    const brandViolations: string[] = [];

    for (const filePath of filesToScan) {
      const content = fs.readFileSync(filePath, 'utf8');
      const relPath = path.relative(repoRoot, filePath);
      for (const { group, regex } of privacyPatternGroups) {
        if (regex.test(content)) {
          patternViolations.push({ file: relPath, group });
        }
      }
      if (content.includes(legacyBrand)) {
        brandViolations.push(relPath);
      }
    }

    expect(patternViolations).toEqual([]);
    expect(brandViolations).toEqual([]);

    const imageBinaries = scanDirs.flatMap((d) => walkBinaryImageFiles(d));
    expect(imageBinaries).toEqual([]);
  });
});
