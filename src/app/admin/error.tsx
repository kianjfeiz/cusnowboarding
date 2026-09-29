"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BackArrow, Button, Notice } from "@/components/ui";

/**
 * Capability guards and roster mutations throw rather than returning false, so
 * a refusal reaches the client as a thrown error. Without this boundary the
 * board sees Next's default error page, which reads like the tool is broken
 * when in fact it correctly declined.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("admin error", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-10">
      <Notice tone="alert" title="That did not go through">
        <p>{error.message || "Something went wrong."}</p>
        <p className="mt-2 text-xs text-ink-faint">
          Nothing was changed. If this was a permissions message, ask the
          president to adjust your role in Settings.
        </p>
      </Notice>

      <div className="mt-4 flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link
          href="/admin"
          className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-surface"
        >
          <BackArrow />
          Dashboard
        </Link>
      </div>
    </div>
  );
}
