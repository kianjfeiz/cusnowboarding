/**
 * The hand-drawn "CU Snowboarding" wordmark.
 *
 * Painted rather than displayed: the PNG carries only an alpha channel and
 * `currentColor` fills it, exactly like the nav glyphs. That is what lets one
 * file serve light and dark without a second asset, and what keeps the mark the
 * same colour as the text beside it at every moment.
 *
 * The real words stay in the DOM, visually hidden. Screen readers, the browser
 * tab's find-in-page, and anything that reads the accessibility tree get
 * "CU Snowboarding" rather than an unlabelled box.
 */
export function Wordmark({ className = "h-4 sm:h-5" }: { className?: string }) {
  const mask = "url(/nav/wordmark.png)";
  return (
    <>
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
          // The drawing is 8.73:1, so height alone would leave the box square
          // and the mask would sit in a fraction of it.
          aspectRatio: "1118 / 128",
        }}
        className={`block bg-current ${className}`}
      />
      <span className="sr-only">CU Snowboarding</span>
    </>
  );
}
