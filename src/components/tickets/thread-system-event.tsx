// Lightweight inline system-event row rendered between thread messages — distinct from
// both ThreadMessage variants (no avatar, no border). Currently used for the auto-reopen
// marker (Message.triggeredReopen), but exported generically so plan 12's public status
// page can reuse it for the same copy.
export function ThreadSystemEvent({ text }: { text: string }) {
  return <p className="py-1 text-center text-[12px] text-muted-foreground">{text}</p>;
}
