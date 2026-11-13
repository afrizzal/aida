import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SignOutButton } from "./sign-out-button";

// Phase 10, V-27 and UI-SPEC Surface 6 with amendments A5 and A11 (the recovery sentence, K178:
// deactivation leaves the session on no workspace, and signing in again opens another workspace
// the person still belongs to): where requirePageAccess
// (src/lib/page-access.ts) sends a signed-in user who has no active organization or no member row
// in it. It lives under (auth), so it inherits the auth background and needs no membership: it
// reads no session, no organization and no tenant data, and so it cannot redirect back here.
// Fixed copy only; one <h1>; the one action is Sign out.
export default function NoAccessPage() {
  return (
    <Card className="w-full max-w-[400px] border-border/70 shadow-xl shadow-primary/5">
      <CardHeader className="gap-2">
        <h1 className="text-[18px] font-semibold">You don't have access to this workspace</h1>
        <p className="text-[13px] text-muted-foreground">
          You are not a member of this workspace, or your membership was removed. If this is a
          mistake, ask a workspace admin to invite you again. If you still belong to another
          workspace, sign out and sign in again to open it.
        </p>
      </CardHeader>
      <CardContent>
        <SignOutButton />
      </CardContent>
    </Card>
  );
}
