/**
 * A hand-drawn page title, standing in for the `h1` text.
 *
 * Painted rather than displayed: each PNG carries only an alpha channel and
 * `currentColor` fills it, exactly like the nav glyphs and the wordmark. That
 * is why there is no light and no dark copy - the mark takes the ink colour of
 * whatever theme is on, and follows it through a theme switch with no flash.
 *
 * The real words stay in the DOM as the accessible name, so headings still
 * announce, and find-in-page still finds them.
 */

interface Drawn {
  /** Intrinsic aspect of the trimmed drawing; height alone would leave a square box. */
  aspect: string;
  /**
   * Rendered height. Tuned per drawing rather than shared, because the ink box
   * of each word covers a different span: "Calendar" is ascender-to-baseline,
   * while "My Trips" also carries the descenders of y and p, so an identical
   * height would render its letters visibly smaller than the others.
   */
  height: string;
}

const TITLES = {
  home: { aspect: "331 / 160", height: "h-12 sm:h-16" },
  calendar: { aspect: "830 / 160", height: "h-7 sm:h-8" },
  "my-trips": { aspect: "519 / 160", height: "h-9 sm:h-10" },
} satisfies Record<string, Drawn>;

export type DrawnTitleName = keyof typeof TITLES;

export function DrawnTitle({
  name,
  children,
  className = "",
}: {
  name: DrawnTitleName;
  /** The words the drawing says, kept for screen readers and find-in-page. */
  children: string;
  className?: string;
}) {
  const { aspect, height } = TITLES[name];
  const mask = `url(/titles/${name}.png)`;

  return (
    <h1 className={`text-ink ${className}`}>
      <span
        aria-hidden
        style={{
          maskImage: mask,
          WebkitMaskImage: mask,
          maskSize: "contain",
          WebkitMaskSize: "contain",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "left center",
          WebkitMaskPosition: "left center",
          aspectRatio: aspect,
        }}
        className={`block bg-current ${height}`}
      />
      <span className="sr-only">{children}</span>
    </h1>
  );
}
