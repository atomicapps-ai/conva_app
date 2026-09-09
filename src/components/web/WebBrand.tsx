import { LockedMark } from "@/components/ui/LockedIcon";

/**
 * The website brand lockup, shared by every browser-app auth/header state.
 *
 * This intentionally mirrors conva_web's `.brand` markup and treatment:
 * the canonical cutout mark, an outline-stroked Michroma wordmark, and the
 * azure final A. Keep this component web-only so the hosted app cannot drift
 * to the desktop rail's separate V5 vector wordmark again.
 */
export function WebBrand({ className = "" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="conva"
      className={["inline-flex items-center gap-[0.6em] text-fg", className].join(" ")}
    >
      <span aria-hidden="true" className="inline-flex h-[1.6em] w-[1.6em] shrink-0">
        <LockedMark size={26} title="" className="h-full w-full" />
      </span>
      <span aria-hidden="true" className="web-brand-wordmark">
        CON<span className="web-brand-wordmark-v">V</span>
        <span className="web-brand-wordmark-a">A</span>
      </span>
    </span>
  );
}
