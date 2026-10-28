// Pre-upgrade Better Auth fixture (plan 08-02, decision D-02).
//
// Captured from better-auth 1.6.22, before the 1.7 upgrade, by running the real code path of
// src/lib/auth.ts against a freshly migrated database: auth.api.signUpEmail, then
// auth.api.createOrganization (the system-action form src/lib/bootstrap.ts uses), then
// auth.api.signInEmail with returnHeaders. Every value below is what that code produced and
// what Postgres stored; nothing was typed by hand. Timestamps are the stored UTC values as ISO
// strings.
//
// The secret, email and password are synthetic, test-only values. No deployment uses them.
//
// `session` is the sign-in session that `signedSessionCookie` points at. Sign-up with
// auto sign-in created a second session row before the organization existed (its
// activeOrganizationId is null), so the database held 2 session rows and exactly one user,
// account, organization and member row at capture time.
//
// Consumed by plan 08-03's regression tests: they migrate a fresh database to exactly
// PRE_UPGRADE_MIGRATIONS, insert these rows, and prove that the upgraded Better Auth still
// accepts the old signed cookie and the old password hash.

export const BA_PRE_UPGRADE_FIXTURE = {
  betterAuthVersion: "1.6.22",
  secret: "aida-test-fixture-secret-not-for-production-0000000000",
  baseURL: "http://localhost:3000",
  email: "fixture-admin@example.test",
  password: "fixture-password-0000",
  sessionCookieName: "better-auth.session_token",
  signedSessionCookie:
    "wKKIbuLhuYLyKuXq9CCLcGfEQBxm7oP2.hZSonZQ8kt%2BQqLR3Ql9Px4AOUPzKzvebfrsYrpU2I%2F8%3D",
  user: {
    id: "KP26tgOcGJDvP6GOoyEcRBWIwmxSR4ob",
    name: "Fixture Admin",
    email: "fixture-admin@example.test",
    emailVerified: false,
    image: null,
    createdAt: "2026-11-11T11:33:11.724Z",
    updatedAt: "2026-11-11T11:33:11.724Z",
    role: "user",
    banned: false,
    banReason: null,
    banExpires: null,
  },
  account: {
    id: "SzGru6bnsO2JFb8gjR4N4Biq4N5boYKy",
    accountId: "KP26tgOcGJDvP6GOoyEcRBWIwmxSR4ob",
    providerId: "credential",
    userId: "KP26tgOcGJDvP6GOoyEcRBWIwmxSR4ob",
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null,
    password:
      "d65feda228795dbc5729a86d2c71bde8:063a86e27e7e949adb592549ad92c695915c2b331ef34b6b3bb0fbc0e77dbbae3cdda6c347dd85b3094abb10b599cd1655e2a4f829ab2082fb4898c11df2645a",
    createdAt: "2026-11-11T11:33:11.729Z",
    updatedAt: "2026-11-11T11:33:11.729Z",
  },
  session: {
    id: "Zwb0ilil4WM7GIAB2UxdpjRvRECQvnLQ",
    expiresAt: "2026-11-18T11:33:11.811Z",
    token: "wKKIbuLhuYLyKuXq9CCLcGfEQBxm7oP2",
    createdAt: "2026-11-11T11:33:11.811Z",
    updatedAt: "2026-11-11T11:33:11.811Z",
    ipAddress: "",
    userAgent: "",
    userId: "KP26tgOcGJDvP6GOoyEcRBWIwmxSR4ob",
    impersonatedBy: null,
    activeOrganizationId: "wBfUUPDPlTKh5FlNF4VbQpw24KgxK7NF",
  },
  organization: {
    id: "wBfUUPDPlTKh5FlNF4VbQpw24KgxK7NF",
    name: "Fixture Org",
    slug: "fixture-org",
    logo: null,
    createdAt: "2026-11-11T11:33:11.769Z",
    metadata: null,
  },
  member: {
    id: "htl8B5rKvxUavJif2uPeV50JKZLozDrm",
    organizationId: "wBfUUPDPlTKh5FlNF4VbQpw24KgxK7NF",
    userId: "KP26tgOcGJDvP6GOoyEcRBWIwmxSR4ob",
    role: "owner",
    createdAt: "2026-11-11T11:33:11.771Z",
  },
} as const;

/** The migration directories the capture database had applied, in order (all of them at capture time). */
export const PRE_UPGRADE_MIGRATIONS = [
  "20260629020504_init",
  "20260701234550_core_ticketing",
  "20260701234808_ticket_search",
  "20260706025051_email_channel",
  "20260707053633_ai_foundation",
  "20260721154325_rag_kb",
  "20260724171144_insight_aida",
  "20261108140000_inbox",
  "20261109100000_ticket_lifecycle",
  "20261110100000_ticket_states",
  "20261110110000_ticket_state_fk_on_update_restrict",
  "20261111100000_kb_proposals",
  "20261112100000_kb_proposal_final_fence",
  "20261113100000_projects_foundation",
] as const;
