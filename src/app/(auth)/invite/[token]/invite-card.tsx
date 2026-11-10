"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

// The invitation card (Phase 10, plan 10-08; UI-SPEC Surface 2 and its Copywriting rows). The
// server page decides the state; this renders exactly one <h1> and one primary action per state.
// Every join is a plain HTML form that posts to the accept route and follows its 303: no client
// fetch and no server action (V-24). The token never appears as text, only in the form action.

/** The `error` query value the accept route redirects with. */
export type InviteCardError = "server" | "field" | "password";

interface JoinState {
  workspaceName: string;
  roleLabel: string;
  /** The accept route of this link. */
  actionPath: string;
  error: InviteCardError | null;
}

export type InviteCardState =
  | ({ kind: "sign_up"; invitedEmail: string } & JoinState)
  | ({ kind: "sign_in"; invitedEmail: string } & JoinState)
  | ({ kind: "accept"; currentEmail: string } & JoinState)
  | { kind: "wrong_account"; currentEmail: string }
  | { kind: "invalid" }
  | { kind: "throttled" };

const CARD_CLASS = "w-full max-w-[400px] border-border/70 shadow-xl shadow-primary/5";
const TITLE_CLASS = "text-[18px] font-semibold wrap-anywhere";
const BODY_CLASS = "text-[13px] text-muted-foreground wrap-anywhere";
const CALLOUT_CLASS =
  "rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive";

const SERVER_ERROR_COPY = "Something went wrong while joining. Wait a moment and try again.";

function CardShell({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={CARD_CLASS}>
      <CardHeader className="gap-2">
        <h1 className={TITLE_CLASS}>{title}</h1>
        <p className={BODY_CLASS}>{body}</p>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function ServerErrorCallout() {
  return (
    <div role="alert" className={CALLOUT_CLASS}>
      {SERVER_ERROR_COPY}
    </div>
  );
}

/**
 * The pending state of one plain form post: set on submit (a second submit is ignored), and
 * cleared when the browser restores the page from its back-forward cache.
 */
function usePendingSubmit() {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    setPending(true);
  }
  return { pending, onSubmit };
}

function SubmitButton({
  pending,
  label,
  pendingLabel,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
}) {
  return (
    <Button type="submit" className="w-full" disabled={pending} aria-disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {pending ? pendingLabel : label}
    </Button>
  );
}

function AcceptForm({ state }: { state: Extract<InviteCardState, { kind: "accept" }> }) {
  const { pending, onSubmit } = usePendingSubmit();
  return (
    <CardShell
      title={`Join ${state.workspaceName}`}
      body={`You were invited as ${state.roleLabel}. You are signed in as ${state.currentEmail}.`}
    >
      {state.error === "server" && <ServerErrorCallout />}
      <form method="post" action={state.actionPath} onSubmit={onSubmit}>
        {/* Never disabled: a disabled input would be left out of the posted form. */}
        <input type="hidden" name="intent" value="accept" />
        <SubmitButton pending={pending} label="Accept invitation" pendingLabel="Joining…" />
      </form>
    </CardShell>
  );
}

function WrongAccount({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    await authClient.signOut();
    // The same link again, now signed out: the server renders the sign-in or create-account state.
    router.refresh();
    setPending(false);
  }

  return (
    <CardShell
      title="This invitation is for a different email"
      body={`You are signed in as ${currentEmail}. Sign out, then open the invitation link again.`}
    >
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={pending}
        onClick={handleSignOut}
      >
        Sign out
      </Button>
    </CardShell>
  );
}

function Invalid() {
  return (
    <CardShell
      title="This invitation link is not valid"
      body="It may have expired, been revoked or already been used. Ask a workspace admin to send you a new invitation."
    >
      <Button asChild variant="link" className="w-full">
        <Link href="/login">Go to sign in</Link>
      </Button>
    </CardShell>
  );
}

/** Amendment A6: a throttled view shows the server-error copy and looks nothing up. */
function Throttled() {
  return (
    <Card className={CARD_CLASS}>
      <CardHeader className="gap-2">
        <h1 className={TITLE_CLASS}>Something went wrong while joining.</h1>
        <p className={BODY_CLASS}>Wait a moment and try again.</p>
      </CardHeader>
      <CardContent>
        <Button asChild variant="link" className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function InviteCard({ state }: { state: InviteCardState }) {
  switch (state.kind) {
    case "accept":
      return <AcceptForm state={state} />;
    case "wrong_account":
      return <WrongAccount currentEmail={state.currentEmail} />;
    case "throttled":
      return <Throttled />;
    case "sign_up":
    case "sign_in":
      return (
        <CardShell
          title={`Join ${state.workspaceName}`}
          body={`You were invited as ${state.roleLabel}. ${
            state.kind === "sign_up" ? "Create your account to join." : "Sign in to join."
          }`}
        >
          {state.error === "server" && <ServerErrorCallout />}
        </CardShell>
      );
    default:
      return <Invalid />;
  }
}
