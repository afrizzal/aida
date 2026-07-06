import { pollInbox } from "../../channels/email/poll-inbox";

export async function emailInboundPollHandler(_data?: unknown): Promise<void> {
  await pollInbox();
}
