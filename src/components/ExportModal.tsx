import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileCode,
  FileImage,
  Globe,
  Image as ImageIcon,
  X,
} from 'lucide-react';
import {
  exportSvgToPngBlob,
  getSvgDimensions,
  prepareStandaloneSvg,
  triggerLocalDownload,
} from '../utils/mermaidEngine';
import {
  CallflowGraph,
  SmartColorMode,
  ThemeConfiguration,
} from '../types/mermaidStudio';
import { generateInteractiveCallflowHtml } from '../utils/callflowEngine';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  svgContent: string | null;
  code: string;
  diagramTitle: string;
  defaultBackground: 'dark' | 'light';
  themeConfig: ThemeConfiguration;
  smartColorMode: SmartColorMode;
  callflowGraph: CallflowGraph;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  svgContent,
  code,
  diagramTitle,
  defaultBackground,
  themeConfig,
  smartColorMode,
  callflowGraph,
}) => {
  const [pngScale, setPngScale] = useState<1 | 2 | 4>(2);
  const [bgMode, setBgMode] = useState<'transparent' | 'dark' | 'light'>(defaultBackground);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [copiedType, setCopiedType] = useState<'svg' | 'mmd' | 'md' | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  React.useEffect(() => {
    setBgMode(defaultBackground);
  }, [defaultBackground, isOpen]);

  const baseDimensions = useMemo(() => {
    if (!svgContent) return { width: 1200, height: 800 };
    return getSvgDimensions(svgContent);
  }, [svgContent]);

  if (!isOpen) return null;

  const safeFilename =
    diagramTitle
      .toLowerCase()
      .replace(/[^a-z0-9äöüß_-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'mermaid-diagramm';

  const handleDownloadSvg = () => {
    if (!svgContent) return;
    const { serializedSvg } = prepareStandaloneSvg(svgContent, bgMode, 32);
    const blob = new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' });
    triggerLocalDownload(blob, `${safeFilename}.svg`);
    setExportStatus('SVG-Vektorgrafik wurde lokal heruntergeladen.');
    setTimeout(() => setExportStatus(null), 3000);
  };

  const handleDownloadPng = async () => {
    if (!svgContent) return;
    setIsExportingPng(true);
    setExportStatus(null);
    try {
      const { blob, width, height } = await exportSvgToPngBlob(svgContent, pngScale, bgMode, {
        code,
        themeConfig,
        smartColorMode,
        canvasSurface: bgMode === 'light' ? 'light' : 'dark',
      });
      triggerLocalDownload(blob, `${safeFilename}-${pngScale}x-${width}x${height}.png`);
      setExportStatus(`PNG (${width} × ${height} px) wurde lokal gerendert und heruntergeladen.`);
    } catch (err) {
      setExportStatus(
        err instanceof Error ? err.message : 'Fehler beim lokalen PNG-Export.'
      );
    } finally {
      setIsExportingPng(false);
      setTimeout(() => setExportStatus(null), 3500);
    }
  };

  const handleDownloadInteractiveHtml = () => {
    if (!svgContent) return;
    const htmlContent = generateInteractiveCallflowHtml(
      diagramTitle,
      svgContent,
      callflowGraph,
      bgMode === 'light' ? 'light' : 'dark'
    );
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    triggerLocalDownload(blob, `${safeFilename}-interaktiv-callflow.html`);
    setExportStatus(
      'Interaktive Callflow-HTML wurde gespeichert (offline im Browser klickbar).'
    );
    setTimeout(() => setExportStatus(null), 3500);
  };

  const handleDownloadMmd = () => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    triggerLocalDownload(blob, `${safeFilename}.mmd`);
    setExportStatus('Mermaid-Quelldatei (.mmd) wurde heruntergeladen.');
    setTimeout(() => setExportStatus(null), 3000);
  };

  const handleCopy = async (type: 'svg' | 'mmd' | 'md') => {
    try {
      if (type === 'svg' && svgContent) {
        const { serializedSvg } = prepareStandaloneSvg(svgContent, bgMode, 32);
        await navigator.clipboard.writeText(serializedSvg);
      } else if (type === 'mmd') {
        await navigator.clipboard.writeText(code);
      } else if (type === 'md') {
        await navigator.clipboard.writeText(`\`\`\`mermaid\n${code.trim()}\n\`\`\``);
      }
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
    } catch {
      setExportStatus('Kopieren in die Zwischenablage nicht möglich.');
    }
  };

  const targetPngW = Math.round((baseDimensions.width + 72) * pngScale);
  const targetPngH = Math.round((baseDimensions.height + 72) * pngScale);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-6">
      <div className="w-full max-w-3xl max-h-[90vh] bg-slate-900 border-t sm:border border-slate-800 rounded-t-2xl sm:rounded-xl flex flex-col overflow-hidden shadow-2xl">
        {/* Mobile Grab Handle */}
        <div className="sm:hidden w-10 h-1.5 bg-slate-700 rounded-full mx-auto mt-2.5 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-950/60 shrink-0">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-slate-100">
              Lokaler Diagramm- &amp; Callflow-Export
            </h2>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 tabular-nums">
              <span>100 % Browser-basiert</span>
              <span aria-hidden="true">·</span>
              <span>
                Basis: {baseDimensions.width} × {baseDimensions.height} px
              </span>
              <span aria-hidden="true">·</span>
              <span>{callflowGraph.nodes.size} Callflow-Knoten</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Export-Dialog schließen"
            className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 p-1.5 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto">
          {/* Background Selection */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-300 block">
              Hintergrund-Modus für PNG, SVG &amp; HTML
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { id: 'dark', label: 'Studio Dunkel (#0B0F19)' },
                { id: 'light', label: 'Dokument Hell (#FFFFFF)' },
                { id: 'transparent', label: 'Transparent (Alpha)' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setBgMode(opt.id as 'transparent' | 'dark' | 'light')}
                  className={`min-h-[40px] sm:min-h-0 py-2 px-3 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    bgMode === opt.id
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* PNG Resolution Scale */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">
                PNG-Skalierungsfaktor (Raster-Auflösung)
              </span>
              <span className="font-mono text-indigo-300 tabular-nums">
                {targetPngW} × {targetPngH} px
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { scale: 1 as const, label: '1x Standard (Web)' },
                { scale: 2 as const, label: '2x Retina HD (Präsentation)' },
                { scale: 4 as const, label: '4x Ultra-HD (Druck / 4K)' },
              ].map((item) => (
                <button
                  key={item.scale}
                  type="button"
                  onClick={() => setPngScale(item.scale)}
                  className={`min-h-[40px] sm:min-h-0 py-2 px-3 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    pngScale === item.scale
                      ? 'bg-indigo-600/20 border-indigo-500 text-indigo-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Primary Download Cards (4 Formats: PNG, Interactive HTML, SVG, .mmd) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
            <button
              type="button"
              disabled={!svgContent || isExportingPng}
              onClick={handleDownloadPng}
              className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/60 hover:border-indigo-400 text-left transition-colors flex flex-col justify-between group disabled:opacity-50"
            >
              <div>
                <FileImage className="w-5 h-5 text-indigo-400 mb-2" />
                <div className="text-sm font-semibold text-slate-100 group-hover:text-indigo-200">
                  PNG Bild ({pngScale}x)
                </div>
                <div className="text-xs text-slate-300 mt-1 tabular-nums">
                  Hochauflösend ({targetPngW} × {targetPngH} px)
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
                <Download className="w-3.5 h-3.5" />
                <span>{isExportingPng ? 'Rendere...' : '.png laden'}</span>
              </div>
            </button>

            <button
              type="button"
              disabled={!svgContent}
              onClick={handleDownloadInteractiveHtml}
              className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/50 hover:border-emerald-400 text-left transition-colors flex flex-col justify-between group disabled:opacity-50"
            >
              <div>
                <Globe className="w-5 h-5 text-emerald-400 mb-2" />
                <div className="text-sm font-semibold text-slate-100 group-hover:text-emerald-200">
                  Interaktive HTML
                </div>
                <div className="text-xs text-slate-300 mt-1">
                  Offline-Viewer mit klickbarer Pfad-Filterung
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                <Download className="w-3.5 h-3.5" />
                <span>.html laden</span>
              </div>
            </button>

            <button
              type="button"
              disabled={!svgContent}
              onClick={handleDownloadSvg}
              className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/60 text-left transition-colors flex flex-col justify-between group disabled:opacity-50"
            >
              <div>
                <FileCode className="w-5 h-5 text-indigo-400 mb-2" />
                <div className="text-sm font-semibold text-slate-100 group-hover:text-indigo-300">
                  SVG Vektor
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Verlustfrei skalierbar für Browser &amp; Doku
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-indigo-400">
                <Download className="w-3.5 h-3.5" />
                <span>.svg laden</span>
              </div>
            </button>

            <button
              type="button"
              onClick={handleDownloadMmd}
              className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/60 text-left transition-colors flex flex-col justify-between group"
            >
              <div>
                <ImageIcon className="w-5 h-5 text-indigo-400 mb-2" />
                <div className="text-sm font-semibold text-slate-100 group-hover:text-indigo-300">
                  Mermaid Code
                </div>
                <div className="text-xs text-slate-400 mt-1 tabular-nums">
                  Quelldatei ({code.split('\n').length} Zeilen)
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-indigo-400">
                <Download className="w-3.5 h-3.5" />
                <span>.mmd laden</span>
              </div>
            </button>
          </div>

          {/* Clipboard Quick Actions */}
          <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs text-slate-400">Direkt in Zwischenablage kopieren:</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy('md')}
                className="min-h-[38px] sm:min-h-0 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {copiedType === 'md' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Markdown kopiert</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Markdown-Block</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleCopy('mmd')}
                className="min-h-[38px] sm:min-h-0 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {copiedType === 'mmd' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Quellcode kopiert</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Mermaid-Code</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={!svgContent}
                onClick={() => handleCopy('svg')}
                className="min-h-[38px] sm:min-h-0 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {copiedType === 'svg' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>SVG-Code kopiert</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>SVG-XML</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {exportStatus && (
            <div className="px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-indigo-300 flex items-center justify-between">
              <span>{exportStatus}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
