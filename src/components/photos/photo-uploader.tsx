"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cn } from "@/components/ui";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Three at a time. A trip dump is thirty photos from a phone on lodge wifi;
 * firing all thirty at once makes every one of them slow and makes the progress
 * bars useless as a signal.
 */
const CONCURRENCY = 3;

type Phase = "waiting" | "uploading" | "finishing" | "done" | "error";

interface Upload {
  id: string;
  name: string;
  progress: number;
  phase: Phase;
  message?: string;
}

const MESSAGES: Record<string, string> = {
  forbidden: "Only people who were on this trip can add photos.",
  rate_limited: "That is a lot of photos at once. Try the rest in an hour.",
  storage_unconfigured: "Photo storage is not set up yet. Tell the board.",
  too_large: "Over the 25MB limit.",
  unsupported_type: "That file type is not accepted.",
  missing_object: "The upload did not finish. Try again.",
};

function describe(code: string | undefined): string {
  return (code && MESSAGES[code]) || "Upload failed. Try again.";
}

/** XHR rather than fetch, purely because it is the only one that reports upload progress. */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", file.type);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`storage responded ${request.status}`));
    request.onerror = () => reject(new Error("network error"));

    request.send(file);
  });
}

async function readDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    // HEIC will not decode in most browsers. Dimensions are a nicety, not a
    // reason to refuse the photo.
    return null;
  }
}

export function PhotoUploader({ tripId }: { tripId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const busy = useRef(false);

  const patch = useCallback((id: string, changes: Partial<Upload>) => {
    setUploads((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }, []);

  const uploadOne = useCallback(
    async (id: string, file: File) => {
      patch(id, { phase: "uploading", progress: 0 });

      const ticket = await fetch("/api/photos/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          contentType: file.type,
          sizeBytes: file.size,
          originalFilename: file.name,
        }),
      });

      if (!ticket.ok) {
        const body = (await ticket.json().catch(() => null)) as { error?: string } | null;
        patch(id, { phase: "error", message: describe(body?.error) });
        return;
      }

      const { photoId, uploadUrl } = (await ticket.json()) as {
        photoId: string;
        uploadUrl: string;
      };

      try {
        await putWithProgress(uploadUrl, file, (fraction) =>
          patch(id, { progress: Math.round(fraction * 100) }),
        );
      } catch {
        patch(id, { phase: "error", message: "Upload failed. Try again." });
        return;
      }

      patch(id, { phase: "finishing", progress: 100 });

      const dimensions = await readDimensions(file);
      const finalized = await fetch(`/api/photos/${photoId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dimensions ?? {}),
      });

      if (!finalized.ok) {
        const body = (await finalized.json().catch(() => null)) as { error?: string } | null;
        patch(id, { phase: "error", message: describe(body?.error) });
        return;
      }

      patch(id, { phase: "done" });
    },
    [patch, tripId],
  );

  const accept = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0 || busy.current) return;

      const files = Array.from(fileList);
      const queued: Array<{ id: string; file: File }> = [];
      const rejected: Upload[] = [];

      for (const file of files) {
        const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`;
        if (!ACCEPTED.includes(file.type)) {
          rejected.push({
            id,
            name: file.name,
            progress: 0,
            phase: "error",
            message: MESSAGES.unsupported_type,
          });
        } else if (file.size > MAX_BYTES) {
          rejected.push({
            id,
            name: file.name,
            progress: 0,
            phase: "error",
            message: MESSAGES.too_large,
          });
        } else {
          queued.push({ id, file });
        }
      }

      setUploads([
        ...rejected,
        ...queued.map(({ id, file }) => ({
          id,
          name: file.name,
          progress: 0,
          phase: "waiting" as Phase,
        })),
      ]);

      if (queued.length === 0) return;

      busy.current = true;
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, queued.length) },
        async () => {
          while (cursor < queued.length) {
            const next = queued[cursor++];
            await uploadOne(next.id, next.file);
          }
        },
      );

      try {
        await Promise.all(workers);
      } finally {
        busy.current = false;
        if (inputRef.current) inputRef.current.value = "";
        // New photos need freshly signed URLs, which only the server can mint.
        router.refresh();
      }
    },
    [router, uploadOne],
  );

  const pending = uploads.filter((u) => u.phase !== "done" && u.phase !== "error").length;
  const failed = uploads.filter((u) => u.phase === "error").length;
  const done = uploads.filter((u) => u.phase === "done").length;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void accept(event.dataTransfer.files);
        }}
        className={cn(
          "rounded-lg border border-dashed p-8 text-center transition-colors",
          dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface",
        )}
      >
        <p className="text-sm text-ink">Drop photos here, or choose them.</p>
        <p className="mt-1 text-xs text-ink-muted">
          JPEG, PNG, WebP, or HEIC. Up to 25MB each.
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED.join(",")}
          className="sr-only"
          onChange={(event) => void accept(event.target.files)}
        />
        <Button
          variant="secondary"
          className="mt-4"
          disabled={pending > 0}
          onClick={() => inputRef.current?.click()}
        >
          {pending > 0 ? `Uploading ${pending}...` : "Choose photos"}
        </Button>
      </div>

      {uploads.length > 0 ? (
        <div className="rounded-md border border-border bg-paper p-4">
          <p className="mb-3 text-xs text-ink-muted">
            {done} uploaded{failed > 0 ? `, ${failed} failed` : ""}
            {pending > 0 ? `, ${pending} in progress` : ""}
          </p>
          <ul className="space-y-2">
            {uploads.map((upload) => (
              <li key={upload.id} className="text-xs">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-ink">{upload.name}</span>
                  <span
                    className={cn(
                      "shrink-0 tnum",
                      upload.phase === "error" ? "text-alert" : "text-ink-muted",
                    )}
                  >
                    {upload.phase === "error"
                      ? upload.message
                      : upload.phase === "done"
                        ? "Done"
                        : upload.phase === "finishing"
                          ? "Finishing"
                          : upload.phase === "waiting"
                            ? "Queued"
                            : `${upload.progress}%`}
                  </span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded bg-surface-strong">
                  <div
                    className={cn(
                      "h-full transition-[width]",
                      upload.phase === "error" ? "bg-alert" : "bg-accent",
                    )}
                    style={{
                      width: `${upload.phase === "error" ? 100 : upload.phase === "done" ? 100 : upload.progress}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
