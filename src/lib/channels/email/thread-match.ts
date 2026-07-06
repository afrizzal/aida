import type { ParsedMail } from "mailparser";

// D-09 fallback: outbound subjects are "Re: {subject} [#{number}]"; this
// regexes the token back out when header matching misses.
export function extractSubjectTicketNumber(subject: string | undefined): number | null {
  const match = subject?.match(/\[#(\d+)\]/);
  return match ? Number(match[1]) : null;
}

// D-08 primary threading candidates: header Message-IDs, falsy-filtered and
// deduped while preserving order (mailparser already bracket-normalizes
// these, e.g. "<abc@host>" — see 03-RESEARCH.md Pitfall 1 on bracket
// consistency with outbound-generated IDs).
export function collectCandidateMessageIds(
  parsed: Pick<ParsedMail, "inReplyTo" | "references">,
): string[] {
  const raw = [
    parsed.inReplyTo,
    ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []),
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of raw) {
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

// Loosely typed db param so this stays bundling-context-agnostic (worker
// esbuild bundle vs. Next.js webpack) — the caller passes a scopedDb client,
// which auto-injects organizationId (STATE.md 02-01).
type ThreadMatchDb = {
  message: {
    findFirst: (args: unknown) => Promise<{ ticketId: string } | null>;
  };
  ticket: {
    findFirst: (
      args: unknown,
    ) => Promise<{ id: string; status: string; contactId: string } | null>;
  };
};

export async function findTicketIdByEmailMessageIds(
  db: ThreadMatchDb,
  candidateIds: string[],
): Promise<string | null> {
  if (candidateIds.length === 0) return null;
  const m = await db.message.findFirst({
    where: { emailMessageId: { in: candidateIds } },
    select: { ticketId: true },
  });
  return m?.ticketId ?? null;
}

export async function findTicketByNumber(
  db: ThreadMatchDb,
  number: number,
): Promise<{ id: string; status: string; contactId: string } | null> {
  return db.ticket.findFirst({
    where: { number },
    select: { id: true, status: true, contactId: true },
  });
}
