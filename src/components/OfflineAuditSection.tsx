import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  FileText,
  Scale,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import {
  AUDIT_APP_VERSION,
  AUDIT_COMPLIANCE_STANDARDS,
  buildFullAuditMarkdownReport,
  buildStandaloneAuditHtmlDossier,
  CODE_INSPECT_AUDIT_PROOFS,
  ENTERPRISE_HIGHLIGHT_TILES,
  ENTERPRISE_STAKEHOLDER_FACTS,
  EnterpriseStakeholderFact,
  LEGAL_AVAYA_CARDS,
  LEGAL_AVAYA_COPY_TEXT,
  SBOM_PACKAGES,
  SbomScope,
  triggerAuditReportDownload,
} from '../utils/offlineAuditEngine';

interface OfflineAuditSectionProps {
  onCopyText: (text: string) => Promise<boolean>;
}

type SbomFilterValue = 'all' | SbomScope;

const STAKEHOLDER_ORDER: EnterpriseStakeholderFact['stakeholder'][] = [
  'IT-Security / ISMS',
  'Datenschutz (DSB)',
  'Betriebsrat',
  'IT-Betrieb / Paketierung',
];

const STAKEHOLDER_SUBTITLES: Record<EnterpriseStakeholderFact['stakeholder'], string> = {
  'IT-Security / ISMS': 'DLP · Ports · Lieferkette · Sandbox',
  'Datenschutz (DSB)': 'Art. 5, 25, 28 & 44 ff. DSGVO',
  Betriebsrat: '§ 87 Abs. 1 Nr. 6 BetrVG · Transparenz',
  'IT-Betrieb / Paketierung': 'Zero-Install · AppLocker · SHA-256',
};

export const OfflineAuditSection: React.FC<OfflineAuditSectionProps> = ({
  onCopyText,
}) => {
  // Global single-active accordion state: opening any long detail automatically collapses the previous one.
  const [expandedDetailKey, setExpandedDetailKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [sbomFilter, setSbomFilter] = useState<SbomFilterValue>('all');
  const [sbomQuery, setSbomQuery] = useState<string>('');

  const toggleExpand = (key: string) => {
    setExpandedDetailKey((prev) => (prev === key ? null : key));
  };

  const markCopied = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2200);
  };

  const handleCopyFullReport = async () => {
    const md = buildFullAuditMarkdownReport();
    const ok = await onCopyText(md);
    if (ok) markCopied('full-report');
  };

  const handleDownloadMarkdownReport = () => {
    const md = buildFullAuditMarkdownReport();
    triggerAuditReportDownload(md, 'md');
  };

  const handleDownloadHtmlDossier = () => {
    const html = buildStandaloneAuditHtmlDossier();
    triggerAuditReportDownload(html, 'html');
  };

  const handleCopyNormText = async (normId: string, text: string) => {
    const ok = await onCopyText(text);
    if (ok) markCopied(`norm-${normId}`);
  };

  const handleCopyCodeSnippet = async (proofId: string, code: string) => {
    const ok = await onCopyText(code);
    if (ok) markCopied(`code-${proofId}`);
  };

  const handleCopyLegalNotice = async () => {
    const ok = await onCopyText(LEGAL_AVAYA_COPY_TEXT);
    if (ok) markCopied('legal-avaya');
  };

  const groupedFacts = useMemo(() => {
    return STAKEHOLDER_ORDER.map((stakeholder) => ({
      stakeholder,
      subtitle: STAKEHOLDER_SUBTITLES[stakeholder],
      items: ENTERPRISE_STAKEHOLDER_FACTS.filter((f) => f.stakeholder === stakeholder),
    }));
  }, []);

  const filteredSbom = useMemo(() => {
    const q = sbomQuery.trim().toLowerCase();
    return SBOM_PACKAGES.filter((pkg) => {
      if (sbomFilter !== 'all' && pkg.scope !== sbomFilter) return false;
      if (!q) return true;
      return (
        pkg.name.toLowerCase().includes(q) ||
        pkg.license.toLowerCase().includes(q) ||
        pkg.purpose.toLowerCase().includes(q) ||
        pkg.corporateNote.toLowerCase().includes(q)
      );
    });
  }, [sbomFilter, sbomQuery]);

  const sbomCounts = useMemo(() => {
    return {
      all: SBOM_PACKAGES.length,
      runtime: SBOM_PACKAGES.filter((p) => p.scope === 'runtime-offline').length,
      build: SBOM_PACKAGES.filter((p) => p.scope === 'build-only').length,
      excluded: SBOM_PACKAGES.filter((p) => p.scope === 'excluded-from-bundle').length,
    };
  }, []);

  const sbomFilterOptions: Array<{ id: SbomFilterValue; label: string }> = [
    { id: 'all', label: `Alle (${sbomCounts.all})` },
    { id: 'runtime-offline', label: `Laufzeit-Bundle (${sbomCounts.runtime})` },
    { id: 'build-only', label: `Build-Zeit (${sbomCounts.build})` },
    { id: 'excluded-from-bundle', label: `Ausgeschlossen (${sbomCounts.excluded})` },
  ];

  return (
    <div className="space-y-8">
      {/* Audit Header & Gesamtbericht-Export */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
          <div className="space-y-2 max-w-3xl">
            <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 tabular-nums">
              Vollständiger IT-Audit · Version {AUDIT_APP_VERSION} · Reine Fakten &amp; Code-Inspect
            </p>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-50">
              Technische Fakten, Code-Inspect &amp; rechtliche Einordnung für Unternehmen
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Kompakte Fakten-Übersicht für IT-Security (ISMS), Datenschutz (DSB),
              Betriebsrat und Software-Paketierung. Vertiefende Prüfmatrizen und
              Quellcode-Belege lassen sich direkt über „Weiter lesen“ ausklappen (ein
              anderer offener Bereich klappt dabei automatisch ein).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyFullReport}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-100 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {copiedKey === 'full-report' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Gesamtbericht kopiert</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Gesamtbericht kopieren</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadMarkdownReport}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-100 transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5 text-sky-400" />
              <span>Audit-Bericht (.md)</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadHtmlDossier}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Audit-Dossier (.html)</span>
            </button>
          </div>
        </div>

        {/* Section Anchor Links */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-3 border-t border-slate-800 text-xs text-slate-400">
          <a href="#audit-eckdaten" className="hover:text-slate-100 transition-colors">
            1. Eckdaten
          </a>
          <a href="#audit-normen" className="hover:text-slate-100 transition-colors">
            2. Compliance-Normen (4)
          </a>
          <a href="#audit-fakten" className="hover:text-slate-100 transition-colors">
            3. Fakten nach Fachbereichen
          </a>
          <a href="#audit-code-inspect" className="hover:text-slate-100 transition-colors">
            4. Code-Inspect-Nachweise (6)
          </a>
          <a href="#audit-sbom" className="hover:text-slate-100 transition-colors">
            5. Open-Source-SBOM ({SBOM_PACKAGES.length})
          </a>
          <a href="#audit-avaya-recht" className="hover:text-slate-100 transition-colors">
            6. Avaya / Visio &amp; Datenerklärung
          </a>
        </div>
      </section>

      {/* 1. 6 Enterprise Highlight Tiles */}
      <section id="audit-eckdaten" className="scroll-mt-20 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base sm:text-lg font-semibold text-slate-100">
            1. Unternehmens-Eckdaten auf einen Blick
          </h2>
          <span className="text-[11px] font-mono text-slate-400">
            Verifizierte Architektur-Fakten
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {ENTERPRISE_HIGHLIGHT_TILES.map((tile) => (
            <div
              key={tile.id}
              className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-1.5"
            >
              <div className="text-[11px] text-slate-400">{tile.label}</div>
              <div className={`text-sm font-semibold font-mono ${tile.accentClass} tabular-nums`}>
                {tile.value}
              </div>
              <div className="text-[11px] text-slate-400 leading-snug">
                {tile.sublabel}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. All 4 Compliance Norms as Compact 2x2 Tiles + Accordion 7/5 Matrix */}
      <section id="audit-normen" className="scroll-mt-20 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base sm:text-lg font-semibold text-slate-100">
            2. Compliance-Normen (4 Regelwerke im Kachel-Raster)
          </h2>
          <p className="text-xs text-slate-400">
            Alle vier Regelwerke mit den wichtigsten Kennzahlen im direkten Überblick. Über
            „Weiter lesen“ klappt die vollständige 2-Spalten-Prüfmatrix mit CLI-Nachweis
            auf (bereits geöffnete Details klappen automatisch ein).
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {AUDIT_COMPLIANCE_STANDARDS.map((std) => {
            const detailKey = `norm:${std.id}`;
            const isExpanded = expandedDetailKey === detailKey;
            const isCopied = copiedKey === `norm-${std.id}`;

            return (
              <article
                key={std.id}
                className={`rounded-xl border bg-slate-900 p-5 space-y-4 transition-colors ${
                  isExpanded
                    ? 'lg:col-span-2 border-slate-700'
                    : 'border-slate-800'
                }`}
              >
                {/* Compact Tile Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3 border-b border-slate-800">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400 tabular-nums">
                      <span className={std.accentClass}>{std.indexLabel}</span>
                      <span>·</span>
                      <span>{std.subtitle}</span>
                    </div>
                    <h3 className="text-base font-semibold text-slate-100">
                      {std.label}
                    </h3>
                  </div>

                  <span
                    className={`text-[11px] font-mono font-medium shrink-0 ${std.accentClass}`}
                  >
                    {std.statusLabel}
                  </span>
                </div>

                {/* Concise Summary + 2x2 Core Facts Always Visible */}
                <p className="text-xs text-slate-300 leading-relaxed">
                  {std.summary}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {std.auditFacts.map((fact) => (
                    <div
                      key={fact.label}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 space-y-0.5"
                    >
                      <div className="text-[11px] text-slate-400">{fact.label}</div>
                      <div className="text-xs font-medium text-slate-100 leading-snug">
                        {fact.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Action Row: Weiter lesen + Copy */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => toggleExpand(detailKey)}
                    aria-expanded={isExpanded}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-100 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Einklappen</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Weiter lesen (Prüfmatrix &amp; Nachweise)</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyNormText(std.id, std.approvalCopyText)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-800 bg-slate-950/70 hover:bg-slate-800 text-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-300">Kopiert</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        <span>Norm-Text kopieren</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Expanded 7/5 2-Column Deep-Dive */}
                {isExpanded && (
                  <div className="pt-4 border-t border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                    <div className="lg:col-span-7 space-y-4">
                      <div className="text-xs font-semibold text-slate-200">
                        {std.deepDiveTitle}
                      </div>

                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 divide-y divide-slate-800/90">
                        {std.controlMatrix.map((row) => (
                          <div key={row.reference} className="p-3.5 space-y-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <span className="text-xs font-semibold text-slate-100">
                                {row.auditQuestion}
                              </span>
                              <span className="text-[11px] font-mono text-emerald-300 shrink-0">
                                {row.reference} · {row.verdict}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed">
                              {row.technicalProof}
                            </p>
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                          <div className="text-xs font-semibold text-slate-100">
                            Technisch ausgeschlossene Risiken
                          </div>
                          <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed list-disc pl-4">
                            {std.excludedRisks.map((risk) => (
                              <li key={risk}>{risk}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-2">
                          <div className="text-xs font-semibold text-slate-100">
                            Organisatorische Betreiberpflichten
                          </div>
                          <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed list-disc pl-4">
                            {std.operatorResponsibilities.map((duty) => (
                              <li key={duty}>{duty}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-5 space-y-4">
                      <div className="rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
                        <div className="px-3.5 py-2 border-b border-slate-800 flex items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                          <span className="flex items-center gap-1.5 text-slate-200 font-semibold">
                            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{std.verificationTitle}</span>
                          </span>
                          <span className="shrink-0">{std.verificationHint}</span>
                        </div>
                        <pre className="p-3.5 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                          <code>{std.verificationSteps}</code>
                        </pre>
                      </div>

                      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5">
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {std.legalClassification}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* 3. Technische Fakten nach Fachbereichen (Pure Facts, NO Checklists) */}
      <section id="audit-fakten" className="scroll-mt-20 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base sm:text-lg font-semibold text-slate-100">
            3. Technische Fakten nach Fachbereichen (2×2 Kacheln)
          </h2>
          <p className="text-xs text-slate-400">
            Verdichtete Einordnungsfakten für die vier typischen Prüfinstanzen im
            Unternehmen – sachlich belegt ohne Prüfhaken-Listen.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {groupedFacts.map((group) => (
            <div
              key={group.stakeholder}
              className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-3"
            >
              <div className="flex items-baseline justify-between gap-3 pb-3 border-b border-slate-800">
                <h3 className="text-sm font-semibold text-slate-100">
                  {group.stakeholder}
                </h3>
                <span className="text-[11px] font-mono text-slate-400 shrink-0">
                  {group.subtitle}
                </span>
              </div>

              <div className="space-y-2.5">
                {group.items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 p-3.5 space-y-1"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-100">
                        {item.factTitle}
                      </span>
                      <span className="text-[11px] font-mono text-emerald-300 shrink-0">
                        {item.reference}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {item.evidence}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Unternehmens-Nachweise mit Code-Inspect (Compact 2-Column Tiles + Accordion) */}
      <section id="audit-code-inspect" className="scroll-mt-20 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base sm:text-lg font-semibold text-slate-100">
            4. Unternehmens-Nachweise mit Code-Inspect (6 Quellcode-Belege)
          </h2>
          <p className="text-xs text-slate-400">
            Alle sechs Sicherheits- und Architekturmechanismen kompakt zusammengefasst.
            Klicken Sie auf „Weiter lesen &amp; Code Inspect“, um die ausführliche Erklärung
            und den zugehörigen TypeScript-/Build-Auszug aufzuklappen.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {CODE_INSPECT_AUDIT_PROOFS.map((proof) => {
            const detailKey = `proof:${proof.id}`;
            const isExpanded = expandedDetailKey === detailKey;
            const isCodeCopied = copiedKey === `code-${proof.id}`;

            return (
              <article
                key={proof.id}
                className={`rounded-xl border bg-slate-900 p-5 space-y-4 transition-colors ${
                  isExpanded
                    ? 'lg:col-span-2 border-slate-700'
                    : 'border-slate-800'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3 border-b border-slate-800">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400 tabular-nums">
                      <span className="text-indigo-300">{proof.numberLabel}</span>
                      <span>·</span>
                      <span>{proof.category}</span>
                    </div>
                    <h3 className="text-sm sm:text-base font-semibold text-slate-100">
                      {proof.title}
                    </h3>
                  </div>

                  <span className="text-[11px] font-mono text-slate-400 shrink-0">
                    {proof.moduleHint}
                  </span>
                </div>

                {/* Compact Facts + 1-Sentence Corporate Relevance */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {proof.auditFacts.map((fact) => (
                    <div
                      key={fact.label}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 space-y-0.5"
                    >
                      <div className="text-[11px] text-slate-400">{fact.label}</div>
                      <div className="text-xs font-medium text-slate-100 leading-snug">
                        {fact.value}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  <span className="font-semibold text-slate-100">Fakt für Unternehmen: </span>
                  {proof.relevanceForCompany}
                </p>

                <div>
                  <button
                    type="button"
                    onClick={() => toggleExpand(detailKey)}
                    aria-expanded={isExpanded}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-100 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Einklappen</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Weiter lesen &amp; Code Inspect</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Expanded 2-Column Technical Explanation & Code Inspect */}
                {isExpanded && (
                  <div className="pt-4 border-t border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                    <div className="lg:col-span-6 rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3 text-xs leading-relaxed">
                      <div>
                        <span className="font-semibold text-slate-100">
                          Technische Umsetzung:{' '}
                        </span>
                        <span className="text-slate-300">
                          {proof.technicalExplanation}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-emerald-300">
                          Ausgeschlossenes Risiko:{' '}
                        </span>
                        <span className="text-slate-300">{proof.excludedRisk}</span>
                      </div>
                    </div>

                    <div className="lg:col-span-6 rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
                      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-200 truncate">
                          <Code2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="truncate">{proof.codeTitle}</span>
                        </span>

                        <button
                          type="button"
                          onClick={() => handleCopyCodeSnippet(proof.id, proof.codeExcerpt)}
                          className="px-2 py-1 text-[11px] font-medium rounded border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                        >
                          {isCodeCopied ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-300">Kopiert</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 text-slate-400" />
                              <span>Snippet</span>
                            </>
                          )}
                        </button>
                      </div>

                      <pre className="p-3.5 text-[11px] font-mono text-slate-200 overflow-x-auto leading-relaxed">
                        <code>{proof.codeExcerpt}</code>
                      </pre>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* 5. Open-Source-Stückliste (SBOM) als Kachel-Raster */}
      <section id="audit-sbom" className="scroll-mt-20 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-semibold text-slate-100">
              5. Open-Source-Stückliste &amp; Lizenz-Nachweis (SBOM)
            </h2>
            <p className="text-xs text-slate-400">
              Vollständige Paketliste samt SPDX-Lizenz, Offline-Laufzeitumfang und
              Netzwerkverhalten (0 Byte Traffic).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={sbomQuery}
                onChange={(e) => setSbomQuery(e.target.value)}
                placeholder="Paket oder Lizenz suchen..."
                aria-label="SBOM Pakete filtern"
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-800 bg-slate-900 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-600 w-52"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {sbomFilterOptions.map((opt) => {
                const active = sbomFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSbomFilter(opt.id)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'border-indigo-500/70 bg-slate-800 text-slate-50'
                        : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-100 hover:border-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {filteredSbom.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-center space-y-2.5">
            <p className="text-xs text-slate-300">
              Keine SBOM-Einträge passend zu „{sbomQuery}“ im gewählten Filter gefunden.
            </p>
            <button
              type="button"
              onClick={() => {
                setSbomQuery('');
                setSbomFilter('all');
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-100 cursor-pointer"
            >
              Filter zurücksetzen
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filteredSbom.map((pkg) => {
              const scopeColor =
                pkg.scope === 'runtime-offline'
                  ? 'text-emerald-300'
                  : pkg.scope === 'build-only'
                    ? 'text-sky-300'
                    : 'text-slate-400';
              return (
                <div
                  key={pkg.name}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-mono font-semibold text-slate-100 break-all">
                          {pkg.name}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                          {pkg.versionSpec} · {pkg.license}
                        </div>
                      </div>
                      <span className={`text-[11px] font-mono shrink-0 ${scopeColor}`}>
                        {pkg.scopeLabel}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">
                      {pkg.purpose}
                    </p>
                  </div>

                  <div className="pt-2.5 border-t border-slate-800 space-y-1 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400">Netzwerk:</span>
                      <span className="font-mono text-slate-200">
                        {pkg.networkBehavior}
                      </span>
                    </div>
                    <p className="text-slate-400 leading-snug">{pkg.corporateNote}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 6. Marken-, Hersteller-Unabhängigkeits- & Datenerklärung (Avaya / Visio) */}
      <section
        id="audit-avaya-recht"
        className="scroll-mt-20 rounded-xl border border-slate-800 bg-slate-900 p-5 sm:p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-mono text-amber-300">
              <Scale className="w-4 h-4 shrink-0" />
              <span>Rechtliche Einordnung · § 23 MarkenG · Vertraulichkeit</span>
            </div>
            <h2 className="text-base sm:text-lg font-semibold text-slate-100">
              6. Marken-, Hersteller-Unabhängigkeits- &amp; Datenerklärung (Avaya / Visio)
            </h2>
            <p className="text-xs text-slate-400">
              Fakten zur Unabhängigkeit von Avaya Inc. und Microsoft Corporation sowie zum
              Ausschluss proprietärer Quelltexte und vorbefüllter Fremddaten.
            </p>
          </div>

          <button
            type="button"
            onClick={handleCopyLegalNotice}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 text-slate-100 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer self-start"
          >
            {copiedKey === 'legal-avaya' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300">Vermerk kopiert</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Rechts- &amp; Daten-Vermerk kopieren</span>
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          {LEGAL_AVAYA_CARDS.map((card) => {
            const detailKey = `legal:${card.id}`;
            const isExpanded = expandedDetailKey === detailKey;

            return (
              <div
                key={card.id}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-2.5"
              >
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <h3 className="text-xs font-semibold text-slate-100 leading-snug">
                    {card.title}
                  </h3>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{card.body}</p>

                {isExpanded && (
                  <p className="text-[11px] text-slate-400 leading-relaxed pt-2 border-t border-slate-800">
                    {card.detail}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => toggleExpand(detailKey)}
                  aria-expanded={isExpanded}
                  className="text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 flex items-center gap-1 cursor-pointer"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>Einklappen</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>Weiter lesen</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
