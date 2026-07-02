/**
 * Coarse relative-duration formatter for SLA due labels.
 * Rounds down to whole minutes/hours/days — no seconds precision.
 * Used by `SlaDueChip`'s "Due in {duration}" on-track label.
 */
export function formatDueDuration(dueAt: Date | string): string {
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const deltaMs = due.getTime() - Date.now();
  const minutes = Math.round(deltaMs / 60_000);
  const absMinutes = Math.abs(minutes);

  if (absMinutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return `${hours}h`;
  }

  const days = Math.round(hours / 24);
  return `${days}d`;
}
