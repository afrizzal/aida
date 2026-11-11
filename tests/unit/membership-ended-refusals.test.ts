// K164 (review a-WR-1): a session with no active organization, or with no member row in it, gets
// the typed MEMBERSHIP_ENDED refusal from every server action and a 403 from every gated API route,
// never a thrown plain Error. Deactivation in a one-organization install leaves the session's
// organization null (D-07), so this is what a removed member's open tab meets on its next action.
//
// The real gates run (src/lib/session.ts, src/lib/authz.ts, src/lib/fresh-session.ts) and the real
// server actions and routes. Only the lowest layers are replaced: Better Auth's getSession, the
// member read, Next's request scope and cache, and the queue. Every other database access throws
// and is recorded, so a refusal provably reads and writes nothing past the gate. A refusal never
// revalidates (the page keeps its client state, R10-1) and reads the session once (K141).
//
// a-IN-7: a failure of the gate itself (the session read throws) is not a membership refusal. An
// action rethrows it; a route answers 500 with a fixed log line, not 401 "unauthorized". Without a
// session the gate's redirect still becomes a 401 in the routes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  memberFindMany: vi.fn(),
  dbTouched: [] as string[],
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => {}, delete: () => {} })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.getSession } } }));
vi.mock("@/lib/queue/boss-client", () => ({
  getBoss: vi.fn(async () => {
    h.dbTouched.push("getBoss");
    throw new Error("queue touched");
  }),
}));
vi.mock("@/lib/db", () => {
  /** Any access below a model or a client method records itself and throws. */
  const touched = (path: string): unknown =>
    new Proxy(() => {}, {
      get: (_t, prop) => (typeof prop === "string" ? touched(`${path}.${prop}`) : undefined),
      apply: () => {
        h.dbTouched.push(path);
        throw new Error(`database touched: ${path}`);
      },
    });
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "member") return { findMany: h.memberFindMany };
        if (prop === "then") return undefined;
        return touched(String(prop));
      },
    },
  );
  return { prisma };
});

import { revalidatePath } from "next/cache";
import { saveContactNotes } from "../../src/app/(app)/contacts/[id]/actions";
import { generateInsightRun } from "../../src/app/(app)/insights/actions";
import { createKbArticleAction, updateKbArticleAction } from "../../src/app/(app)/kb/actions";
import {
  loadStartSelectionAction,
  publishProposalAction,
  rejectProposalAction,
  requestProposalAction,
  restartGenerationAction,
  retryIndexingAction,
  saveProposalAction,
} from "../../src/app/(app)/kb/proposals/actions";
import {
  archiveNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "../../src/app/(app)/notification-actions";
import {
  reembedAllKb,
  saveEmbeddingSettings,
  saveLlmSettings,
  setAiEnabled,
  testEmbeddingConnection,
  testLlmConnection,
} from "../../src/app/(app)/settings/actions";
import { saveBranding } from "../../src/app/(app)/settings/branding/actions";
import {
  createCustomField,
  deleteCustomField,
  updateCustomField,
} from "../../src/app/(app)/settings/custom-fields/actions";
import {
  saveEmailSettings,
  setEmailChannelEnabled,
  testImapConnection,
  testSmtpConnection,
} from "../../src/app/(app)/settings/email/actions";
import {
  setPreferenceAction,
  setUnassignedSettingAction,
} from "../../src/app/(app)/settings/notifications/actions";
import { saveAutoCloseSetting, saveSlaTargets } from "../../src/app/(app)/settings/sla/actions";
import {
  createStatusAction,
  deleteStatusAction,
  moveStatusAction,
  setDefaultStatusAction,
  updateStatusAction,
} from "../../src/app/(app)/settings/statuses/actions";
import { deleteTag, renameTag } from "../../src/app/(app)/settings/tags/actions";
import {
  changeRoleAction,
  deactivateMemberAction,
  inviteMemberAction,
  reassignTicketsAction,
  revokeInvitationAction,
} from "../../src/app/(app)/settings/team/actions";
import {
  addTag,
  assignTicket,
  changePriority,
  changeState,
  generateDraftReply,
  removeTag,
  rerunTriage,
  retryOutboundSend,
  setCustomFieldValue,
  setTriageCategory,
  setTriageLanguage,
  setTriageSentiment,
} from "../../src/app/(app)/tickets/[id]/actions";
import { mergeTicketAction } from "../../src/app/(app)/tickets/[id]/merge-actions";
import {
  addRelationAction,
  removeRelationAction,
} from "../../src/app/(app)/tickets/[id]/relation-actions";
import {
  snoozeTicketAction,
  wakeTicketAction,
} from "../../src/app/(app)/tickets/[id]/snooze-actions";
import { bulkUpdateTickets } from "../../src/app/(app)/tickets/bulk-actions";
import { createTicketAction } from "../../src/app/(app)/tickets/new-ticket-action";
import {
  createSavedViewAction,
  deleteSavedViewAction,
  updateSavedViewAction,
} from "../../src/app/(app)/tickets/saved-view-actions";
import { GET as attachmentGet } from "../../src/app/api/attachments/[id]/route";
import { GET as mentionableGet } from "../../src/app/api/members/mentionable/route";
import { GET as notificationsGet } from "../../src/app/api/notifications/route";
import { DELETE as logoDelete } from "../../src/app/api/settings/branding/logo/route";
import { POST as messagesPost } from "../../src/app/api/tickets/[id]/messages/route";
import { requireOrgAdminScope } from "../../src/lib/authz";
import { AccessDeniedError } from "../../src/lib/membership";
import { getScopedDb, getSessionActor } from "../../src/lib/session";

const ENDED = { ok: false, error: "MEMBERSHIP_ENDED" } as const;
const ENDED_CODE = { ok: false, code: "MEMBERSHIP_ENDED" } as const;
const TEAM_ENDED = { ok: false, error: "membership_ended" } as const;
const MEMBERSHIP_ENDED_COPY =
  "Your access to this workspace has ended. Sign out, then sign in again.";

const EMAIL_INPUT = {
  fromAddress: "support@example.test",
  imapHost: "imap.example.test",
  imapPort: "993",
  imapSecure: true,
  imapUser: "u",
  smtpHost: "smtp.example.test",
  smtpPort: "587",
  smtpSecure: false,
  smtpUser: "u",
};
const LLM_INPUT = { provider: "openai", model: "m", apiKey: "k" } as const;
const EMBED_INPUT = { provider: "openai", model: "m", apiKey: "k" } as const;
const VIEW_INPUT = { name: "Mine", visibility: "PRIVATE", filters: {} } as never;

type Case = [label: string, call: () => Promise<unknown>, expected: unknown];

/** Server actions whose gate is getSessionActor; the service never runs on a refusal. */
const ACTOR_ACTIONS: Case[] = [
  ["changeState", () => changeState("t1", "s1"), ENDED],
  ["changePriority", () => changePriority("t1", "HIGH"), ENDED],
  ["assignTicket", () => assignTicket("t1", "u2"), ENDED],
  ["addTag", () => addTag("t1", "billing"), ENDED],
  ["removeTag", () => removeTag("t1", "tag1"), ENDED],
  [
    "bulkUpdateTickets",
    () => bulkUpdateTickets({ ticketIds: ["t1"], op: { kind: "priority", priority: "LOW" } }),
    ENDED,
  ],
  ["mergeTicketAction", () => mergeTicketAction("t1", "t2", null), ENDED],
  ["addRelationAction", () => addRelationAction("t1", "t2", "related"), ENDED],
  ["removeRelationAction", () => removeRelationAction("t1", "r1"), ENDED],
  ["snoozeTicketAction", () => snoozeTicketAction("t1", "2030-01-01T00:00:00.000Z"), ENDED],
  ["wakeTicketAction", () => wakeTicketAction("t1"), ENDED],
  ["createSavedViewAction", () => createSavedViewAction(VIEW_INPUT), ENDED],
  ["updateSavedViewAction", () => updateSavedViewAction("v1", VIEW_INPUT), ENDED],
  ["deleteSavedViewAction", () => deleteSavedViewAction("v1"), ENDED],
  [
    "createTicketAction",
    () =>
      createTicketAction({
        subject: "S",
        priority: "NORMAL",
        body: "B",
        contactEmail: "c@example.test",
      }),
    ENDED,
  ],
  ["saveAutoCloseSetting", () => saveAutoCloseSetting(7), ENDED],
  ["createStatusAction", () => createStatusAction({ name: "X", group: "OPEN" }), ENDED],
  ["updateStatusAction", () => updateStatusAction({ id: "s1", name: "X" }), ENDED],
  ["moveStatusAction", () => moveStatusAction({ id: "s1", direction: "up" }), ENDED],
  ["setDefaultStatusAction", () => setDefaultStatusAction({ id: "s1" }), ENDED],
  ["deleteStatusAction", () => deleteStatusAction({ id: "s1" }), ENDED],
  ["changeRoleAction", () => changeRoleAction("u2", "admin"), TEAM_ENDED],
  ["deactivateMemberAction", () => deactivateMemberAction("u2", null), TEAM_ENDED],
  ["reassignTicketsAction", () => reassignTicketsAction("u2", "u3"), TEAM_ENDED],
  ["inviteMemberAction", () => inviteMemberAction("new@example.test", "member"), TEAM_ENDED],
  ["revokeInvitationAction", () => revokeInvitationAction("i1"), TEAM_ENDED],
  ["requestProposalAction", () => requestProposalAction(["t1"]), ENDED_CODE],
  [
    "loadStartSelectionAction",
    () => loadStartSelectionAction(["t1"]),
    { kind: "MEMBERSHIP_ENDED" },
  ],
  [
    "saveProposalAction",
    () => saveProposalAction({ proposalId: "p1", expectedVersion: 1 } as never),
    ENDED_CODE,
  ],
  [
    "rejectProposalAction",
    () => rejectProposalAction({ proposalId: "p1", expectedVersion: 1 }),
    ENDED_CODE,
  ],
  [
    "publishProposalAction",
    () => publishProposalAction({ proposalId: "p1", expectedVersion: 1 }),
    ENDED_CODE,
  ],
  [
    "restartGenerationAction",
    () => restartGenerationAction({ proposalId: "p1", expectedVersion: 1 }),
    ENDED_CODE,
  ],
  ["retryIndexingAction", () => retryIndexingAction({ proposalId: "p1" }), ENDED_CODE],
];

/** Server actions whose gate is getScopedDb or requireOrgAdminScope (they re-read the member row). */
const SCOPED_ACTIONS: Case[] = [
  ["retryOutboundSend", () => retryOutboundSend("m1"), ENDED],
  ["rerunTriage", () => rerunTriage("t1"), ENDED],
  ["generateDraftReply", () => generateDraftReply("t1"), ENDED],
  ["setTriageCategory", () => setTriageCategory("t1", "BILLING" as never), ENDED],
  ["setTriageSentiment", () => setTriageSentiment("t1", "NEGATIVE" as never), ENDED],
  ["setTriageLanguage", () => setTriageLanguage("t1", "en"), ENDED],
  ["setCustomFieldValue", () => setCustomFieldValue("t1", "d1", "x"), ENDED],
  ["saveContactNotes", () => saveContactNotes("c1", "notes"), ENDED],
  ["generateInsightRun", () => generateInsightRun(7), ENDED],
  ["markNotificationReadAction", () => markNotificationReadAction("n1"), TEAM_ENDED],
  ["markAllNotificationsReadAction", () => markAllNotificationsReadAction(), TEAM_ENDED],
  ["archiveNotificationAction", () => archiveNotificationAction("n1"), TEAM_ENDED],
  ["setPreferenceAction", () => setPreferenceAction("MENTION", { inApp: false }), TEAM_ENDED],
  ["setUnassignedSettingAction", () => setUnassignedSettingAction(true), TEAM_ENDED],
  ["setAiEnabled", () => setAiEnabled(true), ENDED],
  ["saveLlmSettings", () => saveLlmSettings(LLM_INPUT), ENDED],
  ["testLlmConnection", () => testLlmConnection(LLM_INPUT), ENDED],
  ["saveEmbeddingSettings", () => saveEmbeddingSettings(EMBED_INPUT), ENDED],
  ["testEmbeddingConnection", () => testEmbeddingConnection(EMBED_INPUT), ENDED],
  ["reembedAllKb", () => reembedAllKb(), { ...ENDED, count: 0 }],
  [
    "saveBranding",
    () => saveBranding({ workspaceName: "W" }),
    { ok: false, code: "MEMBERSHIP_ENDED", error: MEMBERSHIP_ENDED_COPY },
  ],
  ["renameTag", () => renameTag("tag1", "new"), ENDED],
  ["deleteTag", () => deleteTag("tag1"), ENDED],
  [
    "createCustomField",
    () => createCustomField({ label: "L", type: "TEXT" }),
    { ok: false, code: "MEMBERSHIP_ENDED", error: MEMBERSHIP_ENDED_COPY },
  ],
  [
    "updateCustomField",
    () => updateCustomField("d1", { label: "L", type: "TEXT" }),
    { ok: false, code: "MEMBERSHIP_ENDED", error: MEMBERSHIP_ENDED_COPY },
  ],
  ["deleteCustomField", () => deleteCustomField("d1"), ENDED],
  [
    "saveSlaTargets",
    () => saveSlaTargets([{ priority: "LOW", firstResponseHours: 1, resolutionHours: 2 }]),
    ENDED,
  ],
  ["saveEmailSettings", () => saveEmailSettings(EMAIL_INPUT), ENDED],
  ["setEmailChannelEnabled", () => setEmailChannelEnabled(true), ENDED],
  ["testImapConnection", () => testImapConnection(EMAIL_INPUT), ENDED],
  ["testSmtpConnection", () => testSmtpConnection(EMAIL_INPUT), ENDED],
  ["createKbArticleAction", () => createKbArticleAction({ title: "T", bodyMarkdown: "B" }), ENDED],
  [
    "updateKbArticleAction",
    () => updateKbArticleAction("a1", { title: "T", bodyMarkdown: "B" }),
    ENDED,
  ],
];

function noActiveOrganization(): void {
  h.getSession.mockResolvedValue({
    user: { id: "user-1" },
    session: { activeOrganizationId: null },
  });
}

function noMemberRow(): void {
  h.getSession.mockResolvedValue({
    user: { id: "user-1" },
    session: { activeOrganizationId: "org-1" },
  });
  h.memberFindMany.mockResolvedValue([]);
}

function messagesRequest(): Request {
  const form = new FormData();
  form.set("mode", "internal");
  form.set("body", "note");
  return new Request("http://localhost/api/tickets/t1/messages", { method: "POST", body: form });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.dbTouched.length = 0;
  h.memberFindMany.mockResolvedValue([]);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("the session gates throw the typed refusal (K164)", () => {
  it("getSessionActor, getScopedDb and requireOrgAdminScope throw AccessDeniedError (403, MEMBERSHIP_ENDED) without an active organization", async () => {
    noActiveOrganization();
    for (const gate of [getSessionActor, getScopedDb, requireOrgAdminScope]) {
      const err = await gate().catch((e: unknown) => e);
      expect(err, gate.name).toBeInstanceOf(AccessDeniedError);
      expect((err as AccessDeniedError).status).toBe(403);
      expect((err as AccessDeniedError).code).toBe("MEMBERSHIP_ENDED");
    }
  });

  it("getScopedDb and requireOrgAdminScope throw AccessDeniedError when the user holds no member row", async () => {
    noMemberRow();
    for (const gate of [getScopedDb, requireOrgAdminScope]) {
      const err = await gate().catch((e: unknown) => e);
      expect(err, gate.name).toBeInstanceOf(AccessDeniedError);
    }
  });

  it("a member without an admin role is still refused by requireOrgAdminScope as before", async () => {
    h.getSession.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    h.memberFindMany.mockResolvedValue([{ id: "m1", role: "member" }]);
    await expect(requireOrgAdminScope()).rejects.toThrow("Forbidden: admin role required");
  });
});

describe("server actions answer MEMBERSHIP_ENDED without an active organization (K164, one-organization deactivation)", () => {
  for (const [label, call, expected] of [...ACTOR_ACTIONS, ...SCOPED_ACTIONS]) {
    it(`${label} returns the refusal, reads the session once, touches nothing and revalidates nothing`, async () => {
      noActiveOrganization();
      await expect(call()).resolves.toEqual(expected);
      expect(h.getSession).toHaveBeenCalledTimes(1);
      expect(h.dbTouched).toEqual([]);
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  }
});

describe("server actions behind getScopedDb or requireOrgAdminScope answer MEMBERSHIP_ENDED when the member row is gone (K164)", () => {
  for (const [label, call, expected] of SCOPED_ACTIONS) {
    it(`${label} returns the refusal and touches nothing`, async () => {
      noMemberRow();
      await expect(call()).resolves.toEqual(expected);
      expect(h.dbTouched).toEqual([]);
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  }
});

describe("gated API routes answer 403 MEMBERSHIP_ENDED (K164); the attachment keeps its 404", () => {
  for (const [label, setup] of [
    ["no active organization", noActiveOrganization],
    ["no member row", noMemberRow],
  ] as const) {
    it(`${label}: notifications, mentionable, messages and the logo answer 403; the attachment 404`, async () => {
      setup();
      const notifications = await notificationsGet(
        new Request("http://localhost/api/notifications?view=count"),
      );
      expect(notifications.status).toBe(403);
      expect(await notifications.json()).toEqual({ error: "membership_ended" });

      const mentionable = await mentionableGet();
      expect(mentionable.status).toBe(403);
      expect(await mentionable.json()).toEqual({ error: "membership_ended" });

      const messages = await messagesPost(messagesRequest(), {
        params: Promise.resolve({ id: "t1" }),
      });
      expect(messages.status).toBe(403);
      expect(await messages.json()).toEqual({ error: "membership_ended" });

      const logo = await logoDelete();
      expect(logo.status).toBe(403);
      expect(await logo.json()).toEqual({ code: "membership_ended" });

      const attachment = await attachmentGet(new Request("http://localhost/api/attachments/a1"), {
        params: Promise.resolve({ id: "a1" }),
      });
      expect(attachment.status).toBe(404);
      expect(await attachment.json()).toEqual({ error: "not_found" });

      expect(h.dbTouched).toEqual([]);
    });
  }
});

describe("a failure of the gate itself is not a refusal (a-IN-7)", () => {
  it("the routes answer 500 with a fixed log line, never 401 and never the error text", async () => {
    h.getSession.mockRejectedValue(new Error("connection terminated: secret-db-host"));
    const responses = [
      await notificationsGet(new Request("http://localhost/api/notifications?view=count")),
      await mentionableGet(),
      await messagesPost(messagesRequest(), { params: Promise.resolve({ id: "t1" }) }),
      await attachmentGet(new Request("http://localhost/api/attachments/a1"), {
        params: Promise.resolve({ id: "a1" }),
      }),
      await logoDelete(),
    ];
    for (const response of responses) {
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("secret-db-host");
    }
    const lines = errorSpy.mock.calls.map((call: unknown[]) => call.map(String).join(" "));
    expect(lines.length).toBeGreaterThanOrEqual(responses.length);
    for (const line of lines) expect(line).not.toContain("secret-db-host");
  });

  it("without a session the routes still answer 401 (the gate's redirect)", async () => {
    h.getSession.mockResolvedValue(null);
    const responses = [
      await notificationsGet(new Request("http://localhost/api/notifications?view=count")),
      await mentionableGet(),
      await messagesPost(messagesRequest(), { params: Promise.resolve({ id: "t1" }) }),
      await attachmentGet(new Request("http://localhost/api/attachments/a1"), {
        params: Promise.resolve({ id: "a1" }),
      }),
      await logoDelete(),
    ];
    for (const response of responses) expect(response.status).toBe(401);
  });

  it("a server action rethrows a gate failure instead of reporting MEMBERSHIP_ENDED", async () => {
    const failure = new Error("connection terminated");
    h.getSession.mockRejectedValue(failure);
    await expect(changeState("t1", "s1")).rejects.toBe(failure);
    await expect(saveContactNotes("c1", "n")).rejects.toBe(failure);
    await expect(setAiEnabled(true)).rejects.toBe(failure);
  });
});
