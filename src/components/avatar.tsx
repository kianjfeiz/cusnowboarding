import { cn } from "@/components/ui";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Falls back to initials rather than a placeholder image: plenty of members
 * will sign in with a Google account that has no photo, and a wall of identical
 * silhouettes reads worse than initials.
 *
 * Plain <img> rather than next/image because these are Google avatar URLs on a
 * domain we do not control, and configuring a remote loader for them is not
 * worth it at 32px.
 */
export function Avatar({
  src,
  name,
  size = 32,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        title={name}
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={cn(
          "shrink-0 rounded-full border border-border object-cover",
          className,
        )}
        style={style}
      />
    );
  }

  return (
    <span
      title={name}
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-surface-strong font-medium text-ink-muted",
        className,
      )}
      style={{ ...style, fontSize: Math.max(10, size * 0.36) }}
    >
      {initials(name)}
    </span>
  );
}

export interface AttendeeFace {
  id: string;
  name: string;
  imageUrl: string | null;
}

/**
 * Shows who is on a trip at a glance: a few faces and a count of the rest.
 *
 * Only rendered for trips whose roster the board has finalized. Before that the
 * list churns as holds lapse and the waitlist moves, and showing it would out
 * people who are about to lose their spot.
 */
export function AvatarStack({
  people,
  total,
  max = 3,
  size = 32,
}: {
  people: AttendeeFace[];
  total: number;
  max?: number;
  size?: number;
}) {
  const shown = people.slice(0, max);
  const remaining = Math.max(0, total - shown.length);

  if (total === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {shown.map((person) => (
          <Avatar
            key={person.id}
            src={person.imageUrl}
            name={person.name}
            size={size}
            className="ring-2 ring-paper"
          />
        ))}
      </div>
      {remaining > 0 ? (
        <span className="text-xs text-ink-muted">+{remaining} more</span>
      ) : null}
    </div>
  );
}
