/**
 * Avatar crop/scale math — the shared piece behind `AvatarEditor.tsx`.
 *
 * Kept pure and DOM-free (no `HTMLCanvasElement`, no `HTMLImageElement`) so
 * it's directly unit-testable and, per the platform design doc
 * (`conva_core/docs/platform/15-avatar-editor-and-shared-storage.md`), the
 * same module a future desktop-native picker could reuse unchanged — only
 * the canvas-touching export step at the bottom is web-Canvas-specific.
 *
 * The crop frame is always square (the avatar renders as a circle). At
 * `zoom === 1` the crop exactly covers the image's shorter side (like
 * `object-fit: cover`); zooming in shrinks the source square (magnifying),
 * and `panX`/`panY` slide that square across whatever slack remains on the
 * longer axis. `pan*` and the crop's top-left share one convention — 0 is
 * the leftmost/topmost position, 1 the rightmost/bottommost, 0.5 centered —
 * so a CSS preview can reuse the exact same numbers (see `AvatarEditor.tsx`).
 */

export const AVATAR_OUTPUT_SIZE = 512;
export const AVATAR_JPEG_QUALITY = 0.9;
export const AVATAR_MIN_ZOOM = 1;
export const AVATAR_MAX_ZOOM = 3;
/** Flatten transparent sources onto the app's own panel color rather than
 *  white — a flattened edge is far more likely to show against the UI than
 *  disappear into it (design doc §6.2). */
export const AVATAR_FLATTEN_BG = "#09121e";

export interface CropState {
  zoom: number;
  panX: number;
  panY: number;
}

export const DEFAULT_CROP: CropState = { zoom: AVATAR_MIN_ZOOM, panX: 0.5, panY: 0.5 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keeps a crop state inside its valid ranges — zoom bounded, pan always 0..1. */
export function clampCrop(state: CropState): CropState {
  return {
    zoom: clamp(state.zoom, AVATAR_MIN_ZOOM, AVATAR_MAX_ZOOM),
    panX: clamp(state.panX, 0, 1),
    panY: clamp(state.panY, 0, 1),
  };
}

/** The square source rectangle (image-pixel coordinates) a crop state
 *  selects out of an image of the given natural size. */
export function computeCropRect(
  imageWidth: number,
  imageHeight: number,
  crop: CropState,
): { sx: number; sy: number; size: number } {
  const { zoom, panX, panY } = clampCrop(crop);
  const shortSide = Math.min(imageWidth, imageHeight);
  const size = shortSide / zoom;
  const maxX = imageWidth - size;
  const maxY = imageHeight - size;
  return { sx: maxX * panX, sy: maxY * panY, size };
}

/** Dragging the image by `(dxPx, dyPx)` CSS pixels inside a viewport that
 *  currently renders it at `renderedWidth × renderedHeight`, shifts the pan
 *  by the inverse fraction of the available slack on each axis (no slack →
 *  no movement on that axis, avoiding a divide-by-zero). */
export function panAfterDrag(
  crop: CropState,
  dxPx: number,
  dyPx: number,
  renderedWidth: number,
  renderedHeight: number,
  viewportSize: number,
): CropState {
  const slackX = renderedWidth - viewportSize;
  const slackY = renderedHeight - viewportSize;
  const { panX, panY } = clampCrop(crop);
  return clampCrop({
    zoom: crop.zoom,
    panX: slackX > 0 ? panX - dxPx / slackX : panX,
    panY: slackY > 0 ? panY - dyPx / slackY : panY,
  });
}

/** Renders the crop into a fixed-size square JPEG. The one DOM-touching
 *  function in this module — everything above is pure and covered directly. */
export function exportAvatarBlob(
  image: HTMLImageElement,
  crop: CropState,
  opts: { outputSize?: number; background?: string; quality?: number } = {},
): Promise<Blob> {
  const outputSize = opts.outputSize ?? AVATAR_OUTPUT_SIZE;
  const background = opts.background ?? AVATAR_FLATTEN_BG;
  const quality = opts.quality ?? AVATAR_JPEG_QUALITY;
  const rect = computeCropRect(image.naturalWidth, image.naturalHeight, crop);

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("2d canvas context unavailable"));
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, outputSize, outputSize);
  ctx.drawImage(image, rect.sx, rect.sy, rect.size, rect.size, 0, 0, outputSize, outputSize);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob produced no blob"))),
      "image/jpeg",
      quality,
    );
  });
}
