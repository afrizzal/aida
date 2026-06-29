import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin, organization } from "better-auth/plugins";
import { prisma } from "./db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  session: { strategy: "database", cookieCache: { enabled: true, maxAge: 5 * 60 } },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          // Pitfall 2: activeOrganizationId is NOT auto-set. Populate from the user's first membership.
          const member = await prisma.member.findFirst({ where: { userId: session.userId } });
          return { data: { ...session, activeOrganizationId: member?.organizationId ?? null } };
        },
      },
    },
  },
  plugins: [
    organization({ allowUserToCreateOrganization: false }), // D-07: admin-invite-only
    admin({ impersonationSessionDuration: 60 * 60 }), // D-02: impersonation = 1h
    nextCookies(),
  ],
});
