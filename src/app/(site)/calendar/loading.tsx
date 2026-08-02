/** Matches the calendar page's width so the swap to real content does not jump. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <div className="animate-pulse motion-reduce:animate-none">
        <div className="space-y-3">
          <div className="h-7 w-40 rounded-md bg-surface-strong" />
          <div className="h-4 w-72 rounded bg-surface" />
        </div>
        <div className="mt-8 h-96 rounded-lg border border-border bg-surface" />
      </div>
    </main>
  );
}
