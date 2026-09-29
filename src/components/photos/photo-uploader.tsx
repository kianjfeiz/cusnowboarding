"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cn } from "@/components/ui";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const MAX_BYTES = 25 * 1024 * 1024;

type Phase = "waiting" | "uploading" | "finishing" | "done" | "error";

const PHASE_LABEL: Record<Exclude<Phase, "uploading" | "error">, string> = {
  waiting: "Queued",
  finishing: "Finishing",
  done: "Done",
};

interface Upload {
  id: string;
  name: string;
  progress: number;
  phase: Phase;
  message?: string;
}

const MESSAGES: Record<string, string> = {
  forbidden: "This gallery is not open for photos.",
  rate_limited: "That is a lot of photos at once. Try the rest in an hour.",
  storage_unconfigured: "Photo storage is not set up yet. Tell the board.",
  too_large: "Over the 25MB limit.",
  unsupported_type: "That file type is not accepted.",
  missing_object: "The upload did not finish. Try again.",
};

/** The member-facing reason behind a non-2xx from one of the photo routes. */
async function describeFailure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return (body?.error && MESSAGES[body.error]) || "Upload failed. Try again.";
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

export function PhotoUploader({
  subject,
}: {
  /** The gallery this uploads into - one trip or one event. */
  subject: { type: "trip" | "event"; id: string };
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);

  function patch(id: string, changes: Partial<Upload>) {
    setUploads((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }

  /** Returns the reason it failed, or null once the photo is finalized. */
  async function uploadOne(id: string, file: File): Promise<string | null> {
    patch(id, { phase: "uploading" });

    const ticket = await fetch("/api/photos/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        [subject.type === "trip" ? "tripId" : "eventId"]: subject.id,
        contentType: file.type,
        sizeBytes: file.size,
        originalFilename: file.name,
      }),
    });
    if (!ticket.ok) return describeFailure(ticket);

    const { photoId, uploadUrl } = (await ticket.json()) as { photoId: string; uploadUrl: string };
    await putWithProgress(uploadUrl, file, (fraction) =>
      patch(id, { progress: Math.round(fraction * 100) }),
    );

    patch(id, { phase: "finishing", progress: 100 });
    const finalized = await fetch(`/api/photos/${photoId}/finalize`, { method: "POST" });
    return finalized.ok ? null : describeFailure(finalized);
  }

  async function accept(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const queue = files.map((file, index) => {
      const problem = !ACCEPTED.includes(file.type)
        ? MESSAGES.unsupported_type
        : file.size > MAX_BYTES
          ? MESSAGES.too_large
          : undefined;
      return { id: `${index}-${file.name}`, file, problem };
    });

    setUploads(
      queue.map(({ id, file, problem }) => ({
        id,
        name: file.name,
        progress: 0,
        phase: problem ? "error" : "waiting",
        message: problem,
      })),
    );

    // One at a time: on lodge wifi, parallel uploads make every one of them
    // slow and the progress bars useless as a signal.
    for (const { id, file, problem } of queue) {
      if (problem) continue;
      const failure = await uploadOne(id, file).catch(() => "Upload failed. Try again.");
      patch(id, failure ? { phase: "error", message: failure } : { phase: "done" });
    }

    if (inputRef.current) inputRef.current.value = "";
    // New photos need freshly signed URLs, which only the server can mint.
    router.refresh();
  }

  const pending = uploads.filter((u) => u.phase !== "done" && u.phase !== "error").length;
  const failed = uploads.filter((u) => u.phase === "error").length;
  const done = uploads.filter((u) => u.phase === "done").length;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-dashed border-border-strong bg-surface p-6 text-center">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED.join(",")}
          className="sr-only"
          disabled={pending > 0}
          onChange={(event) => void accept(event.target.files)}
        />
        <Button
          variant="secondary"
          disabled={pending > 0}
          onClick={() => inputRef.current?.click()}
        >
          {pending > 0 ? `Uploading ${pending}...` : "Upload photos"}
        </Button>
        <p className="mt-2 text-xs text-ink-muted">JPEG, PNG, WebP, or HEIC, up to 25MB each.</p>
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
                      : upload.phase === "uploading"
                        ? `${upload.progress}%`
                        : PHASE_LABEL[upload.phase]}
                  </span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded bg-surface-strong">
                  <div
                    className={cn(
                      "h-full transition-[width]",
                      upload.phase === "error" ? "bg-alert" : "bg-accent",
                    )}
                    style={{
                      width: `${upload.phase === "error" || upload.phase === "done" ? 100 : upload.progress}%`,
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
