/** Matches the trips page's width so the swap to real content does not jump. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <div className="animate-pulse motion-reduce:animate-none">
        <div className="h-7 w-36 rounded-md bg-surface-strong" />
        <div className="mt-8 space-y-3">
          <div className="h-28 rounded-lg border border-border bg-surface" />
          <div className="h-28 rounded-lg border border-border bg-surface" />
        </div>
      </div>
    </main>
  );
}
