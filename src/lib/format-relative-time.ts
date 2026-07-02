/**
 * Coarse relative-past-time formatter (e.g. "5m ago", "3h ago", "2d ago").
 * Companion to `formatDueDuration` (future-facing SLA durations) — this one is
 * past-facing, used for "last activity" / message / ticket-history timestamps.
 */
export function formatRelativeTime(date: Date | string): string {
  const then = typeof date === "string" ? new Date(date) : date;
  const deltaMs = Date.now() - then.getTime();
  const minutes = Math.round(deltaMs / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.round(months / 12);
  return `${years}y ago`;
}
