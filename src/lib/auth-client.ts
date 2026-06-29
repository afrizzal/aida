import { createAuthClient } from "better-auth/client";
import { adminClient, organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  // @ts-expect-error -- known type-parameter mismatch in better-auth 1.6.22 client plugins under TS6
  plugins: [organizationClient(), adminClient()],
});
