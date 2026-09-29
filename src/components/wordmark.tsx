import { inkMask } from "@/components/ui";

/**
 * The hand-drawn "CU Snowboarding" wordmark. The real words stay in the DOM,
 * visually hidden, for screen readers and find-in-page.
 */
export function Wordmark({ className = "h-4 sm:h-5" }: { className?: string }) {
  return (
    <>
      <span
        aria-hidden
        // The drawing is 8.73:1; height alone would leave the box square.
        style={{ ...inkMask("/nav/wordmark.png"), aspectRatio: "1118 / 128" }}
        className={`block bg-current ${className}`}
      />
      <span className="sr-only">CU Snowboarding</span>
    </>
  );
}
