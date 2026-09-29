import { inkMask } from "@/components/ui";

/**
 * Intrinsic aspect of each trimmed drawing, and a rendered height tuned per
 * drawing: "My Trips" carries descenders, so a shared height would render its
 * letters visibly smaller than the others.
 */
const TITLES = {
  home: { aspect: "331 / 160", height: "h-12 sm:h-16" },
  calendar: { aspect: "830 / 160", height: "h-7 sm:h-8" },
  "my-trips": { aspect: "519 / 160", height: "h-9 sm:h-10" },
};

/** A hand-drawn page title. The words stay in the DOM as the accessible name. */
export function DrawnTitle({ name, children }: { name: keyof typeof TITLES; children: string }) {
  const { aspect, height } = TITLES[name];

  return (
    <h1 className="text-ink">
      <span
        aria-hidden
        style={{ ...inkMask(`/titles/${name}.png`), aspectRatio: aspect }}
        className={`block bg-current ${height}`}
      />
      <span className="sr-only">{children}</span>
    </h1>
  );
}
