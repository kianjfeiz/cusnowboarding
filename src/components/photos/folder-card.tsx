import Link from "next/link";
import { formatDenver } from "@/components/ui";
import type { PhotoSubjectCard } from "@/lib/photos/photos";

/**
 * The back panel and its tab as one outline, so the shoulder of the tab joins
 * the body without a seam. Drawn in a 4:3 box to match the card's aspect.
 */
const BACK_PANEL =
  "M0 16Q0 0 16 0H126C146 0 148 30 170 30H384Q400 30 400 46V284Q400 300 384 300H16Q0 300 0 284Z";

function photoCountLabel(count: number) {
  if (count === 0) return "No photos yet";
  return `${count} photo${count === 1 ? "" : "s"}`;
}

/**
 * One gallery on the Photos tab. The opening on hover and focus is pure CSS
 * (`.folder*` in globals.css), so this stays a server component.
 */
export function FolderCard({ subject }: { subject: PhotoSubjectCard }) {
  return (
    <Link
      href={`/photos/${subject.type}s/${subject.slug}`}
      className="folder block rounded-xl"
    >
      <div className="folder-art relative aspect-[4/3]">
        <svg
          aria-hidden
          viewBox="0 0 400 300"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          <path
            d={BACK_PANEL}
            vectorEffect="non-scaling-stroke"
            className="folder-back"
          />
        </svg>

        <div aria-hidden className="folder-sheet folder-sheet-back" />
        {/* A print on top of the pile; only its upper edge ever shows. */}
        <div aria-hidden className="folder-sheet folder-sheet-front">
          <div className="folder-print">
            <svg viewBox="0 0 100 28">
              <circle cx="80" cy="11.5" r="3.5" vectorEffect="non-scaling-stroke" />
              <path d="M-2 32 22 14l10 7L50 8l26 20 26-12" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        </div>

        <div className="folder-front">
          <h2 className="line-clamp-2 break-words text-lg font-semibold leading-snug tracking-tight text-ink">
            {subject.title}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {formatDenver(subject.startsAt, { timeZoneName: undefined })}
          </p>
          <p className="tnum text-sm text-ink-muted">{photoCountLabel(subject.photoCount)}</p>
        </div>
      </div>
    </Link>
  );
}
