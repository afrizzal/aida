"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/** The no-access page's one action: the user menu's sign-out call, then /login (UI-SPEC Surface 6). */
export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    await authClient.signOut();
    router.push("/login");
  }

  return (
    <Button type="button" className="w-full" disabled={pending} onClick={handleSignOut}>
      Sign out
    </Button>
  );
}
