import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The site's floating bottom-right widgets (the homepage match-highlight
// card and the site-wide "match is live" popup) used to each position
// themselves with `fixed bottom-6 right-6` - i.e. both at the exact same
// spot, so they overlapped whenever both were visible, and the small
// "show again" buttons added for dismissed widgets would have sat exactly on
// top of each other. They now render into ONE shared fixed container (a
// flex column), so they stack naturally no matter which ones are open,
// collapsed or dismissed.
//
// <FloatingDock /> is mounted once in root.tsx; widgets render through
// <FloatingPortal>. The portal only attaches after mount (the dock element
// doesn't exist during SSR), which also keeps these purely client-driven
// widgets out of the server HTML, so there's no hydration surface.
const FLOATING_DOCK_ID = "floating-widget-dock";

export function FloatingDock() {
  return (
    <div
      id={FLOATING_DOCK_ID}
      className="pointer-events-none fixed bottom-6 right-6 z-40 flex max-w-[85vw] flex-col items-end gap-3"
    />
  );
}

/** `className` positions the widget within the dock - pass a literal Tailwind
 * order-* class (e.g. "order-1") so the stacking order doesn't depend on
 * which widget happens to mount first. */
export function FloatingPortal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [dock, setDock] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setDock(document.getElementById(FLOATING_DOCK_ID));
  }, []);

  if (!dock) return null;
  return createPortal(<div className={`pointer-events-auto ${className}`}>{children}</div>, dock);
}

/** The small "bring it back" pill shown in place of a widget the visitor
 * closed with the X - labelled (not just an icon) so it's discoverable. */
export function RestorePill({
  label,
  ariaLabel,
  variant,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  variant: "match" | "live";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="inline-flex items-center gap-2 rounded-full border border-red-600/40 bg-gray-900 px-3.5 py-2 text-xs font-semibold text-gray-200 shadow-xl transition-colors hover:border-red-500 hover:text-white motion-safe:animate-slide-in-up"
    >
      {variant === "live" ? (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
      ) : (
        <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
        </svg>
      )}
      {label}
    </button>
  );
}
