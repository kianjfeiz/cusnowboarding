/**
 * Shown inside the persistent site layout the instant a navigation starts, so
 * switching tabs responds immediately while the page's data loads. Sized to the
 * narrow (max-w-2xl) pages; /calendar and /me carry their own wider fallbacks.
 * The pulse is load-state information, not decoration, and still collapses
 * under reduced motion.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="animate-pulse space-y-8 motion-reduce:animate-none">
        <div className="space-y-3">
          <div className="h-8 w-56 rounded-md bg-surface-strong" />
          <div className="h-4 w-72 rounded bg-surface" />
        </div>
        <div className="space-y-3">
          <div className="h-24 rounded-lg border border-border bg-surface" />
          <div className="h-24 rounded-lg border border-border bg-surface" />
        </div>
      </div>
    </main>
  );
}
