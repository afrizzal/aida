"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionActor } from "@/lib/session";
import {
  createTicketState,
  type DeleteTicketStateResult,
  deleteTicketState,
  type MoveTicketStateResult,
  moveTicketState,
  type SetDefaultTicketStateResult,
  setDefaultTicketState,
  type TicketStateWriteResult,
  updateTicketState,
} from "@/lib/tickets/ticket-state-admin";

// The server actions of /settings/statuses (Phase 12.1, AIDA-97, D-01, D-14). Each passes the
// session actor and the untrusted input to the 12.1-08 service, which checks active membership
// first (MEMBERSHIP_ENDED), then the exact owner or admin role (NOT_ALLOWED), then the input.
// The result is returned unchanged and a refusal is never thrown; the settings page and the
// ticket pages are revalidated only after a success.

function revalidateStatusPaths(): void {
  revalidatePath("/settings/statuses");
  revalidatePath("/tickets", "layout");
}

export async function createStatusAction(raw: unknown): Promise<TicketStateWriteResult> {
  const actor = await getSessionActor();
  const result = await createTicketState(prisma, actor, raw);
  if (result.ok) revalidateStatusPaths();
  return result;
}

export async function updateStatusAction(raw: unknown): Promise<TicketStateWriteResult> {
  const actor = await getSessionActor();
  const result = await updateTicketState(prisma, actor, raw);
  if (result.ok) revalidateStatusPaths();
  return result;
}

export async function moveStatusAction(raw: unknown): Promise<MoveTicketStateResult> {
  const actor = await getSessionActor();
  const result = await moveTicketState(prisma, actor, raw);
  if (result.ok) revalidateStatusPaths();
  return result;
}

export async function setDefaultStatusAction(raw: unknown): Promise<SetDefaultTicketStateResult> {
  const actor = await getSessionActor();
  const result = await setDefaultTicketState(prisma, actor, raw);
  if (result.ok) revalidateStatusPaths();
  return result;
}

export async function deleteStatusAction(raw: unknown): Promise<DeleteTicketStateResult> {
  const actor = await getSessionActor();
  const result = await deleteTicketState(prisma, actor, raw);
  if (result.ok) revalidateStatusPaths();
  return result;
}
