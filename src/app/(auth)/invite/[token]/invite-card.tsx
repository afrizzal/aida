"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/** The server's field limits, shown and checked before submit (the route checks them again). */
export interface InviteFieldLimits {
  nameMaxLength: number;
  passwordMinLength: number;
  passwordMaxLength: number;
}

interface SignedOutState extends JoinState {
  /** The invited address, shown read-only; never posted (the server uses the invitation's). */
  invitedEmail: string;
  limits: InviteFieldLimits;
}

export type InviteCardState =
  | ({ kind: "sign_up" } & SignedOutState)
  | ({ kind: "sign_in" } & SignedOutState)
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
/** The login form's copy for refused credentials (UI-SPEC: "the existing login error copy"). */
const WRONG_PASSWORD_COPY =
  "Invalid email or password. Please check your credentials and try again.";
/** Amendment A6 (b): the server refused the fields (the client checks normally catch this). */
const FIELD_ERROR_COPY = "Check your name and password, then try again.";
const LABEL_CLASS = "text-[13px] font-semibold";
const FIELD_ERROR_CLASS = "text-[12px] text-destructive";
const HELP_CLASS = "text-[12px] text-muted-foreground";

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
        {/* Never disabled: a disabled input would be left out of the posted form; while a
            submit is pending the inputs turn read-only and only the button is disabled. */}
        <input type="hidden" name="intent" value="accept" />
        <SubmitButton pending={pending} label="Accept invitation" pendingLabel="Joining…" />
      </form>
    </CardShell>
  );
}

/** The read-only invited address (aria-readonly). It has no name, so it is never posted. */
function InvitedEmailField({ email }: { email: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="invite-email" className={LABEL_CLASS}>
        Email
      </Label>
      <Input
        id="invite-email"
        type="email"
        value={email}
        readOnly
        aria-readonly="true"
        autoComplete="username"
      />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className={FIELD_ERROR_CLASS}>
      {message}
    </p>
  );
}

function SignUpForm({ state }: { state: Extract<InviteCardState, { kind: "sign_up" }> }) {
  const { pending, onSubmit } = usePendingSubmit();
  const { nameMaxLength, passwordMinLength, passwordMaxLength } = state.limits;
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const passwordRule = `Password must be at least ${passwordMinLength} characters`;

  function check(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const nextNameError =
      name.length === 0
        ? "Your name is required"
        : name.length > nameMaxLength
          ? `Use at most ${nameMaxLength} characters`
          : null;
    const nextPasswordError =
      password.length < passwordMinLength || password.length > passwordMaxLength
        ? passwordRule
        : null;
    setNameError(nextNameError);
    setPasswordError(nextPasswordError);
    if (nextNameError || nextPasswordError) {
      event.preventDefault();
      return;
    }
    onSubmit(event);
  }

  return (
    <CardShell
      title={`Join ${state.workspaceName}`}
      body={`You were invited as ${state.roleLabel}. Create your account to join.`}
    >
      <form
        method="post"
        action={state.actionPath}
        onSubmit={check}
        noValidate
        className="space-y-4"
      >
        <input type="hidden" name="intent" value="sign-up" />
        <div className="space-y-2">
          <Label htmlFor="invite-name" className={LABEL_CLASS}>
            Name
          </Label>
          <Input
            id="invite-name"
            name="name"
            autoComplete="name"
            required
            maxLength={nameMaxLength}
            readOnly={pending}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "invite-name-error" : undefined}
          />
          <FieldError id="invite-name-error" message={nameError} />
        </div>
        <InvitedEmailField email={state.invitedEmail} />
        <div className="space-y-2">
          <Label htmlFor="invite-password" className={LABEL_CLASS}>
            Password
          </Label>
          <Input
            id="invite-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={passwordMinLength}
            maxLength={passwordMaxLength}
            readOnly={pending}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? "invite-password-error" : "invite-password-help"}
          />
          {passwordError ? (
            <FieldError id="invite-password-error" message={passwordError} />
          ) : (
            <p id="invite-password-help" className={HELP_CLASS}>
              {passwordRule}.
            </p>
          )}
        </div>
        {state.error === "field" && (
          <div role="alert" className={CALLOUT_CLASS}>
            {FIELD_ERROR_COPY}
          </div>
        )}
        {state.error === "server" && <ServerErrorCallout />}
        <SubmitButton
          pending={pending}
          label="Create account and join"
          pendingLabel="Creating account…"
        />
      </form>
    </CardShell>
  );
}

function SignInForm({ state }: { state: Extract<InviteCardState, { kind: "sign_in" }> }) {
  const { pending, onSubmit } = usePendingSubmit();
  const [passwordError, setPasswordError] = useState<string | null>(
    state.error === "password" ? WRONG_PASSWORD_COPY : null,
  );

  function check(event: FormEvent<HTMLFormElement>) {
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    if (password.length === 0 || password.length > state.limits.passwordMaxLength) {
      setPasswordError("Password is required");
      event.preventDefault();
      return;
    }
    setPasswordError(null);
    onSubmit(event);
  }

  return (
    <CardShell
      title={`Join ${state.workspaceName}`}
      body={`You were invited as ${state.roleLabel}. Sign in to join.`}
    >
      <form
        method="post"
        action={state.actionPath}
        onSubmit={check}
        noValidate
        className="space-y-4"
      >
        <input type="hidden" name="intent" value="sign-in" />
        <InvitedEmailField email={state.invitedEmail} />
        <div className="space-y-2">
          <Label htmlFor="invite-password" className={LABEL_CLASS}>
            Password
          </Label>
          <Input
            id="invite-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={state.limits.passwordMaxLength}
            readOnly={pending}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? "invite-password-error" : undefined}
          />
          <FieldError id="invite-password-error" message={passwordError} />
        </div>
        {state.error === "field" && (
          <div role="alert" className={CALLOUT_CLASS}>
            {FIELD_ERROR_COPY}
          </div>
        )}
        {state.error === "server" && <ServerErrorCallout />}
        <SubmitButton pending={pending} label="Sign in and join" pendingLabel="Signing in…" />
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
      return <SignUpForm state={state} />;
    case "sign_in":
      return <SignInForm state={state} />;
    default:
      return <Invalid />;
  }
}
