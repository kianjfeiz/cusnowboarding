/** Coarse, readable durations: the board never needs seconds past a minute out. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export interface DeadlineView {
  label: string;
  lapsed: boolean;
}

/**
 * Lazy expiry, stated in words. A hold whose deadline has passed reads as
 * lapsed everywhere in the admin whether or not the release cron has run, so a
 * missed cron never shows the board a spot that is not really taken.
 */
export function describeDeadline(
  deadline: Date | string | null,
  now: number = Date.now(),
): DeadlineView {
  if (!deadline) return { label: "-", lapsed: false };

  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return { label: `lapsed ${formatDuration(-ms)} ago`, lapsed: true };
  return { label: `${formatDuration(ms)} left`, lapsed: false };
}

export function fullName(first: string, last: string): string {
  return `${first} ${last}`.trim();
}
