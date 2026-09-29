import { cn } from "@/components/ui";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Falls back to initials: plenty of Google accounts have no photo. Plain <img>
 * because these are Google avatar URLs on a domain we do not control.
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
        className={cn("shrink-0 rounded-full border border-border object-cover", className)}
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

/** A few overlapping faces. Only for a finalized roster; the caller says the count. */
export function AvatarStack({
  people,
  max = 3,
  size = 32,
}: {
  people: AttendeeFace[];
  max?: number;
  size?: number;
}) {
  if (people.length === 0) return null;

  return (
    <div className="flex -space-x-2">
      {people.slice(0, max).map((person) => (
        <Avatar
          key={person.id}
          src={person.imageUrl}
          name={person.name}
          size={size}
          className="ring-2 ring-paper"
        />
      ))}
    </div>
  );
}

/** The full attendee list, shown only to people who are themselves on the trip. */
export function AttendeeList({
  people,
}: {
  people: Array<{ memberId: string; name: string; imageUrl: string | null; detail: string | null }>;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {people.map((person) => (
        <li key={person.memberId} className="flex items-center gap-3">
          <Avatar src={person.imageUrl} name={person.name} size={32} />
          <div className="min-w-0">
            <p className="truncate text-sm">{person.name}</p>
            {person.detail ? (
              <p className="tnum truncate text-xs text-ink-faint">{person.detail}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
