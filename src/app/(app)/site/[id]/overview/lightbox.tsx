"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Full-screen view of a drawing: scroll or pinch to zoom, drag to move around, Esc or Close to go back.
 */
export function Lightbox({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const [z, setZ] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const zoom = useCallback((f: number) => setZ((v) => {
    const next = Math.min(8, Math.max(1, v * f));
    if (next === 1) setPos({ x: 0, y: 0 });
    return next;
  }), []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") zoom(1.25);
      if (e.key === "-") zoom(0.8);
    };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [onClose, zoom]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="lightbox">
      <div className="lightbox-bar">
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</strong>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn" onClick={() => zoom(0.8)} aria-label="Zoom out">−</button>
          <button type="button" className="btn" onClick={() => { setZ(1); setPos({ x: 0, y: 0 }); }}>{Math.round(z * 100)}%</button>
          <button type="button" className="btn" onClick={() => zoom(1.25)} aria-label="Zoom in">+</button>
          <button type="button" className="btn dark" onClick={onClose}>Close</button>
        </div>
      </div>
      <div
        className="lightbox-stage"
        onWheel={(e) => zoom(e.deltaY < 0 ? 1.15 : 0.87)}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; setDragging(true); (e.target as Element).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current && z > 1) setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y }); }}
        onPointerUp={() => { drag.current = null; setDragging(false); }}
        onTouchStart={(e) => { if (e.touches.length === 2) pinch.current = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z }; }}
        onTouchMove={(e) => { if (e.touches.length === 2 && pinch.current) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); setZ(Math.min(8, Math.max(1, pinch.current.z * d / pinch.current.d))); } }}
        onTouchEnd={() => { pinch.current = null; }}
        style={{ cursor: z > 1 ? "grab" : "zoom-in" }}
        onDoubleClick={() => zoom(z > 1 ? 0 : 2)}
      >
        <div style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${z})`, transformOrigin: "center top", transition: dragging ? "none" : "transform .08s" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
