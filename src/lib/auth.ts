import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin, organization } from "better-auth/plugins";
import { prisma } from "./db";
import { CLIENT_IP_HEADER } from "./rate-limit/client-ip";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  session: { strategy: "database", cookieCache: { enabled: true, maxAge: 5 * 60 } },
  advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } }, // D-18: only the proxy-written identity, never raw X-Forwarded-For
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
