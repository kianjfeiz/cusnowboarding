"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { MARK_PAID_FORM } from "./mark-paid-form";

/** The row checkboxes are server-rendered and attach to the form by id. */
const BOXES = `input[name="signupIds"][form="${MARK_PAID_FORM}"]`;

function boxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(BOXES));
}

export function BulkMarkPaid() {
  const [checked, setChecked] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const recount = () => {
      const all = boxes();
      setTotal(all.length);
      setChecked(all.filter((box) => box.checked).length);
    };
    recount();
    const onChange = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.matches(BOXES)) recount();
    };
    document.addEventListener("change", onChange);
    // Rows disappear once marked paid; count what is actually still there.
    const observer = new MutationObserver(recount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("change", onChange);
      observer.disconnect();
    };
  }, []);

  function toggleAll(on: boolean) {
    for (const box of boxes()) box.checked = on;
    setChecked(on ? total : 0);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={total > 0 && checked === total}
          onChange={(event) => toggleAll(event.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        Select all
      </label>
      <Button
        type="submit"
        form={MARK_PAID_FORM}
        disabled={checked === 0}
        onClick={(event) => {
          if (!window.confirm(`Mark ${checked} paid through Fusion?`)) event.preventDefault();
        }}
        className="h-8 px-3 text-xs"
      >
        {checked > 0 ? `Mark ${checked} paid` : "Mark selected paid"}
      </Button>
    </div>
  );
}
