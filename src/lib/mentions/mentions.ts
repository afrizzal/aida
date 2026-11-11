// Mentions in internal notes (Phase 10, AIDA-45, D-20, D-21, V-12).
//
// The composer sends the mentioned user ids in a `mentions` form field (a JSON array of strings)
// next to the body; the body itself keeps a readable `@Name`. Every guarantee is enforced here and
// in the messages route, never in the composer:
//   - parseMentionField runs before the transaction: malformed data or more than MAX_MENTIONS ids
//     is `invalid_mentions`, and any mention on a message that is not an internal note is
//     `mentions_not_allowed` (D-21). Both are a 400 with nothing written.
//   - resolveMentionedMembers runs inside the message transaction, after its membership re-check
//     and the ticket lock: ids are deduplicated, the author is dropped, and an id is kept only when
//     it has a member row in the organization (V-26: any row counts, a mention grants no right).
//   - recordMentions writes one MessageMention per kept member and one MENTION notification each,
//     in the same transaction (D-16).
// Mention ids and names come from untrusted input. They are never rendered as HTML here: the
// display names go to renderMarkdown's mention option, which wraps text nodes of the Markdown tree
// before the sanitize pass, whose schema allows exactly that span; the span guard runs before and
// after that pass (src/lib/markdown/render.ts). A display name never contains an email address.
//
// Relative imports only and no framework import, like the notification modules it calls.
import { type EmitTx, emitNotifications } from "../notifications/emit";
import { type NotificationItem, TICKET_ENTITY } from "../notifications/types";

/** At most this many mentioned ids per message (V-12, T-10-29); more is a 400. */
export const MAX_MENTIONS = 50;

/** The longest id accepted in the field; user ids are far shorter. */
export const MAX_MENTION_ID_LENGTH = 128;

export type MentionErrorCode = "invalid_mentions" | "mentions_not_allowed";

/** A refusal of the `mentions` field; the route answers 400 with the code. */
export class MentionError extends Error {
  readonly status = 400;
  constructor(readonly code: MentionErrorCode) {
    super(code);
    this.name = "MentionError";
  }
}

/** The composer modes of the messages route. */
export type MessageMode = "internal" | "public";

/**
 * Parses the `mentions` form field. Absent or empty: no mentions. Otherwise it must be a JSON
 * array of at most MAX_MENTIONS non-empty strings of at most MAX_MENTION_ID_LENGTH characters,
 * else `invalid_mentions`. A non-empty list on a message whose mode is not internal is
 * `mentions_not_allowed` (D-21), whatever the composer showed. Ids are returned as sent;
 * resolveMentionedMembers deduplicates them.
 */
export function parseMentionField(raw: unknown, mode: MessageMode): string[] {
  if (raw === null || raw === undefined || raw === "") return [];
  if (typeof raw !== "string") throw new MentionError("invalid_mentions");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MentionError("invalid_mentions");
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_MENTIONS) {
    throw new MentionError("invalid_mentions");
  }
  const ids: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string" || entry === "" || entry.length > MAX_MENTION_ID_LENGTH) {
      throw new MentionError("invalid_mentions");
    }
    ids.push(entry);
  }
  if (ids.length > 0 && mode !== "internal") throw new MentionError("mentions_not_allowed");
  return ids;
}

/**
 * The name a mention shows: the user's name, else the local part of their email. Never the full
 * email: a name that is empty or contains `@` falls back to the local part, so the mention markup
 * can never carry an email address (D-20).
 */
export function mentionDisplayName(name: string | null | undefined, email: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed !== "" && !trimmed.includes("@")) return trimmed;
  const at = email.indexOf("@");
  const local = (at === -1 ? email : email.slice(0, at)).trim();
  return local;
}

/** A mentioned user who holds a member row in the organization. */
export interface MentionedMember {
  userId: string;
  displayName: string;
}

/**
 * The transaction client resolveMentionedMembers needs, typed structurally so a scopedDb
 * transaction and a global-client transaction both fit. `member` is a Better Auth model outside
 * DOMAIN_MODELS, so the organization term is explicit.
 */
export interface MentionReadTx {
  member: {
    findMany(args: {
      where: { organizationId: string; userId: { in: string[] } };
      select: { userId: true; user: { select: { name: true; email: true } } };
      orderBy: { id: "asc" };
    }): PromiseLike<{ userId: string; user: { name: string; email: string } }[]>;
  };
}

/**
 * Inside the message transaction: deduplicates ids, drops the author, and keeps an id only when
 * it has a member row in orgId (one read, explicit organization term). Returns the kept members
 * in the order their ids were sent, each once, with their display name. With duplicate member
 * rows (owner item O-4 open, V-06) a user still appears once.
 */
export async function resolveMentionedMembers(
  tx: MentionReadTx,
  orgId: string,
  authorUserId: string,
  ids: readonly string[],
): Promise<MentionedMember[]> {
  if (!orgId) throw new Error("resolveMentionedMembers requires a non-empty organizationId");
  const wanted = [...new Set(ids)].filter((id) => id !== authorUserId);
  if (wanted.length === 0) return [];
  const rows = await tx.member.findMany({
    where: { organizationId: orgId, userId: { in: wanted } },
    select: { userId: true, user: { select: { name: true, email: true } } },
    orderBy: { id: "asc" },
  });
  const byUser = new Map<string, MentionedMember>();
  for (const row of rows) {
    if (byUser.has(row.userId)) continue;
    const displayName = mentionDisplayName(row.user.name, row.user.email);
    if (displayName === "") continue;
    byUser.set(row.userId, { userId: row.userId, displayName });
  }
  return wanted.flatMap((id) => {
    const member = byUser.get(id);
    return member ? [member] : [];
  });
}

/** The transaction client recordMentions needs: the MessageMention insert plus the emitter's. */
export interface MentionWriteTx extends EmitTx {
  messageMention: {
    createMany(args: {
      data: { organizationId: string; messageId: string; mentionedUserId: string }[];
      skipDuplicates: boolean;
    }): PromiseLike<{ count: number }>;
  };
}

export interface RecordMentionsInput {
  messageId: string;
  ticketId: string;
  authorUserId: string;
  members: readonly MentionedMember[];
}

/**
 * Inside the message transaction, after message.create: one MessageMention per member (the
 * organization written explicitly, duplicates skipped) and one MENTION notification each with
 * eventKey `mention:{messageId}` and the author as actor. Returns both counts.
 */
export async function recordMentions(
  tx: MentionWriteTx,
  orgId: string,
  input: RecordMentionsInput,
): Promise<{ mentions: number; notifications: number }> {
  if (!orgId) throw new Error("recordMentions requires a non-empty organizationId");
  const members = input.members.filter((m) => m.userId !== input.authorUserId);
  if (members.length === 0) return { mentions: 0, notifications: 0 };
  const { count } = await tx.messageMention.createMany({
    data: members.map((m) => ({
      organizationId: orgId,
      messageId: input.messageId,
      mentionedUserId: m.userId,
    })),
    skipDuplicates: true,
  });
  const items: NotificationItem[] = members.map((m) => ({
    recipientUserId: m.userId,
    actorUserId: input.authorUserId,
    type: "MENTION",
    eventKey: `mention:${input.messageId}`,
    entityType: TICKET_ENTITY,
    entityId: input.ticketId,
  }));
  const notifications = await emitNotifications(tx, orgId, items);
  return { mentions: count, notifications };
}
