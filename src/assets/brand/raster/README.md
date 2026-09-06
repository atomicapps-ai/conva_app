# Locked raster artwork — imported, never regenerated

Byte-for-byte copies of the approved artwork in **conva_core** (the single
source of truth for brand assets). Verified identical by md5 at import time.

| File | conva_core source path | Native px | Render at (CSS px) |
| --- | --- | --- | --- |
| `conva-core-orbit-reference@2x.png` | `brand/UI/AppUI_V4.0/assets/raster/conva-core-orbit-reference@2x.png` | 456 × 460 | 228 × 230 — the full expanded-rail region |
| `conva-intelligence-field-reference@2x.png` | `brand/UI/AppUI_V4.0/assets/raster/conva-intelligence-field-reference@2x.png` | 1194 × 490 | ≤ 597 × 245, right-aligned in the Home hero |

Imported for **AppUI V5.0** (`conva_core/brand/UI/AppUI_V5.0`, design authority
`conva_core@1b007ed`) from the V4.0 raster pack the V5 handoff references.

## Rules (from the source `README.md` — do not relax them here)

- Use the files directly. **Never** redraw, trace, generate, recolor, sharpen,
  mask, crop, filter, or substitute them. Image Trace is explicitly not approved.
- Preserve the complete image, aspect ratio, baked background, glow, particles,
  line weights, and spacing. No image-level border — **the containing component
  owns the only border**.
- Never enlarge beyond the listed CSS maximum. A wider window adds negative
  space around the artwork; it does not stretch it.
- **Intelligence field:** right-aligned against the hero's right edge at its
  intrinsic aspect ratio. The empty left lead-in and the full incoming tail must
  stay visible and blend into the hero background — never cropped behind content.
- **Core orbit:** an edge-to-edge rail region. Its parent must have
  `padding-inline: 0` and the image must be `display:block; width:100%;
  height:auto; margin:0; border:0; border-radius:0` — touching both rail edges,
  with no inset card treatment and no duplicate divider line.

Consumers: `src/components/studio/NavRail.tsx` (orbit) and
`src/components/dashboard/DashboardView.tsx` (intelligence field).

If either asset changes in `conva_core`, re-copy it verbatim — do not edit here.
