function SkeletonBlocks() {
  return (
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
  );
}

/**
 * The loading fallback shown inside the persistent site layout the instant a
 * navigation starts. `wide` matches the max-w-4xl pages so the swap to real
 * content does not jump. The pulse is load state, and stops under reduced motion.
 */
export function PageSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <main className={`mx-auto px-5 ${wide ? "max-w-4xl py-10" : "max-w-2xl py-12"}`}>
      <SkeletonBlocks />
    </main>
  );
}

/** The board's fallback: AdminLayout already provides the `<main>` and its width. */
export function AdminSkeleton() {
  return <SkeletonBlocks />;
}
