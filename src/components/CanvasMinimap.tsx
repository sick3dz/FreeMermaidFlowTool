import React, { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface CanvasMinimapProps {
  visible: boolean;
  thumbnailUrl: string | null;
  svgWidth: number;
  svgHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  isDarkSurface: boolean;
  onPanTo: (nextPanX: number, nextPanY: number) => void;
  onClose: () => void;
}

const MINIMAP_MAX_W = 216;
const MINIMAP_MAX_H = 144;

export const CanvasMinimap: React.FC<CanvasMinimapProps> = ({
  visible,
  thumbnailUrl,
  svgWidth,
  svgHeight,
  viewportWidth,
  viewportHeight,
  zoom,
  panX,
  panY,
  isDarkSurface,
  onPanTo,
  onClose,
}) => {
  const mapAreaRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const safeW = Math.max(100, svgWidth || 1200);
  const safeH = Math.max(100, svgHeight || 800);
  const mapScale = Math.min(MINIMAP_MAX_W / safeW, MINIMAP_MAX_H / safeH);
  const mapW = Math.max(88, Math.round(safeW * mapScale));
  const mapH = Math.max(58, Math.round(safeH * mapScale));

  const safeZoom = Math.max(0.05, zoom || 1);
  const vpW = Math.max(100, viewportWidth || 900);
  const vpH = Math.max(100, viewportHeight || 600);

  // Stage is centered in viewport; transform is translate3d(panX, panY, 0) scale(zoom) around stage center
  const visibleWorldW = vpW / safeZoom;
  const visibleWorldH = vpH / safeZoom;
  const worldCenterX = safeW / 2 - panX / safeZoom;
  const worldCenterY = safeH / 2 - panY / safeZoom;

  const boxW = Math.min(mapW, Math.max(14, visibleWorldW * mapScale));
  const boxH = Math.min(mapH, Math.max(10, visibleWorldH * mapScale));
  const boxLeft = Math.max(
    0,
    Math.min(mapW - boxW, (worldCenterX - visibleWorldW / 2) * mapScale)
  );
  const boxTop = Math.max(
    0,
    Math.min(mapH - boxH, (worldCenterY - visibleWorldH / 2) * mapScale)
  );

  const panFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = mapAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const relX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const relY = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const targetWorldX = relX / mapScale;
      const targetWorldY = relY / mapScale;
      const nextPanX = (safeW / 2 - targetWorldX) * safeZoom;
      const nextPanY = (safeH / 2 - targetWorldY) * safeZoom;
      onPanTo(nextPanX, nextPanY);
    },
    [mapScale, safeW, safeH, safeZoom, onPanTo]
  );

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      panFromPointer(e.clientX, e.clientY);
    };
    const handleUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [panFromPointer]);

  if (!visible) return null;

  return (
    <div
      className={`hidden md:flex flex-col rounded-lg border shadow-lg select-none overflow-hidden ${
        isDarkSurface
          ? 'bg-slate-950/92 border-slate-700/80 text-slate-200'
          : 'bg-white/95 border-slate-300 text-slate-800'
      }`}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className={`flex items-center justify-between px-2 py-1 text-[10px] font-medium border-b ${
          isDarkSurface
            ? 'border-slate-800 text-slate-400'
            : 'border-slate-200 text-slate-500'
        }`}
      >
        <span className="tabular-nums">Minimap · {Math.round(safeZoom * 100)}%</span>
        <button
          type="button"
          onClick={onClose}
          title="Minimap schließen (M)"
          className="p-0.5 rounded hover:bg-slate-700/40 transition-colors cursor-pointer"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <div
        ref={mapAreaRef}
        onPointerDown={(e) => {
          e.preventDefault();
          draggingRef.current = true;
          panFromPointer(e.clientX, e.clientY);
        }}
        className="relative cursor-crosshair overflow-hidden m-1.5 rounded border border-slate-700/40"
        style={{ width: `${mapW}px`, height: `${mapH}px` }}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt="Diagramm-Übersicht"
            draggable={false}
            className="w-full h-full object-contain pointer-events-none opacity-85"
          />
        ) : (
          <div className="w-full h-full bg-slate-800/30 flex items-center justify-center text-[10px] text-slate-500">
            Übersicht
          </div>
        )}
        <div
          className="absolute top-0 left-0 border-2 border-indigo-400 bg-indigo-500/20 rounded-[2px] pointer-events-none"
          style={{
            width: `${boxW}px`,
            height: `${boxH}px`,
            transform: `translate3d(${boxLeft}px, ${boxTop}px, 0)`,
          }}
        />
      </div>
    </div>
  );
};
