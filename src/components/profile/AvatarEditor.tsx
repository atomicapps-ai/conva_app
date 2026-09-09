import { useEffect, useMemo, useRef, useState } from "react";

import {
  AVATAR_MAX_ZOOM,
  AVATAR_MIN_ZOOM,
  clampCrop,
  DEFAULT_CROP,
  exportAvatarBlob,
  panAfterDrag,
  type CropState,
} from "@/lib/image/avatarCrop";

/** Fixed square preview frame, in CSS px. The exported avatar is always
 *  512×512 (`AVATAR_OUTPUT_SIZE`) regardless of this — this only sets how
 *  big the picker feels, not the output resolution. */
const VIEWPORT = 240;

/**
 * Pick → pan/zoom in a circular frame → export one fixed-size square image.
 * Same component on desktop and web (per the platform design doc,
 * `conva_core/docs/platform/15-avatar-editor-and-shared-storage.md`) — it's
 * plain Canvas/DOM code, and both surfaces render the identical React tree
 * in a WebView, so there's nothing platform-specific here. The caller
 * supplies the picked `File` and gets back the exported `Blob` (or
 * cancellation) — it doesn't know or care how that blob gets uploaded.
 */
export function AvatarEditor({
  file,
  onCancel,
  onSave,
}: {
  file: File;
  onCancel: () => void;
  onSave: (blob: Blob) => Promise<void> | void;
}) {
  const [crop, setCrop] = useState<CropState>(DEFAULT_CROP);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const objectUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

  // Rendered size of the image inside the viewport at the current zoom —
  // `object-fit: cover` at zoom 1, scaled up from there. Recomputed from the
  // image's natural size once it loads; a 1:1 fallback keeps the frame from
  // collapsing before then.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const short = natural ? Math.min(natural.w, natural.h) : 1;
  const renderedW = natural ? (VIEWPORT * crop.zoom * natural.w) / short : VIEWPORT;
  const renderedH = natural ? (VIEWPORT * crop.zoom * natural.h) / short : VIEWPORT;
  const translateX = -((renderedW - VIEWPORT) * crop.panX);
  const translateY = -((renderedH - VIEWPORT) * crop.panY);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setCrop((c) => panAfterDrag(c, dx, dy, renderedW, renderedH, VIEWPORT));
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const save = async () => {
    if (!imgRef.current) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await exportAvatarBlob(imgRef.current, crop);
      await onSave(blob);
    } catch {
      setError("Couldn't process that image — try a different one.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg/70 backdrop-blur-sm">
      <div className="w-[22rem] max-w-[90vw] rounded-lg border border-border bg-panel p-4 shadow-xl">
        <h2 className="text-sm font-semibold text-fg">Set profile photo</h2>
        <p className="mt-0.5 text-xs text-fg-faint">Drag to reposition, scroll or use the slider to zoom.</p>

        <div
          className="relative mx-auto mt-4 touch-none select-none overflow-hidden rounded-full border border-border bg-panel-raised"
          style={{ width: VIEWPORT, height: VIEWPORT, cursor: dragRef.current ? "grabbing" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={(e) => {
            e.preventDefault();
            setCrop((c) => clampCrop({ ...c, zoom: c.zoom - e.deltaY * 0.0015 }));
          }}
        >
          {/* eslint-disable-next-line jsx-a11y/alt-text -- decorative crop preview, not content */}
          <img
            ref={imgRef}
            src={objectUrl}
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget;
              setNatural({ w: el.naturalWidth, h: el.naturalHeight });
            }}
            style={{
              position: "absolute",
              width: renderedW,
              height: renderedH,
              transform: `translate(${translateX}px, ${translateY}px)`,
              maxWidth: "none",
            }}
          />
        </div>

        <label className="mt-4 flex items-center gap-2 text-[11px] text-fg-faint">
          <span aria-hidden>−</span>
          <input
            type="range"
            aria-label="Zoom"
            min={AVATAR_MIN_ZOOM}
            max={AVATAR_MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => setCrop((c) => clampCrop({ ...c, zoom: Number(e.target.value) }))}
            className="flex-1"
          />
          <span aria-hidden>+</span>
        </label>

        {error && <p className="mt-2 text-xs text-rec">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn text-xs" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary text-xs" onClick={() => void save()} disabled={saving || !natural}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
