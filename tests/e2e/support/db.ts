import "./test-env";
import { prisma } from "../../../src/lib/db";
import { createTicket } from "../../../src/lib/tickets/create-ticket";
import { autoCloseHandler } from "../../../src/lib/worker/jobs/auto-close";
import { orgId } from "./test-env";

export { autoCloseHandler, createTicket, orgId, prisma };
