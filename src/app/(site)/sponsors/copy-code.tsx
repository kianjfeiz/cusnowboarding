"use client";

import { useEffect, useRef, useState } from "react";

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      return;
    } catch {
      // Refused (permissions, in-app browsers). Fall through to selecting it.
    }
    const node = codeRef.current;
    if (!node) return;
    window.getSelection()?.selectAllChildren(node);
    // The legacy command still works in some places the Clipboard API does
    // not; where it fails too, the code is left selected to copy by hand.
    if (document.execCommand("copy")) setCopied(true);
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2">
      <span
        ref={codeRef}
        className="min-w-0 select-all break-all font-mono text-sm font-semibold text-ink"
      >
        {code}
      </span>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-strong hover:text-ink"
      >
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
