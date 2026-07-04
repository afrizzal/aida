import "./test-env";
import { prisma } from "../../../src/lib/db";
import { createTicket } from "../../../src/lib/tickets/create-ticket";
import { orgId } from "./test-env";

export { prisma, createTicket, orgId };
