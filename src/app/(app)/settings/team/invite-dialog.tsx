"use client";

import { Check, Copy, Loader2, Send, TriangleAlert, UserPlus } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inviteMemberAction } from "./actions";
import {
  COPIED,
  COPY_LINK,
  copyLinkNotice,
  grantableRoles,
  INVITATION_LINK_LABEL,
  INVITE_BUTTON,
  INVITE_DESCRIPTION,
  INVITE_DISMISS_FORM,
  INVITE_DISMISS_RESULT,
  INVITE_EMAIL_LABEL,
  INVITE_ROLE_HELP,
  INVITE_ROLE_LABEL,
  INVITE_SENDING,
  INVITE_SUBMIT,
  INVITE_TITLE,
  type InviteErrorKey,
  inviteError,
  inviteSentToast,
  ROLE_LABELS,
  type TeamRole,
} from "./team-copy";

// UI-SPEC Surface 1, "Invite dialog" (E3; D-03, D-06). One email per submit. The role options are
// capped by the actor for convenience only; createInvitation re-checks the ceiling under the
// organization lock (T-10-39). When the email was not delivered the dialog switches to the
// copy-link view: the link lives only in this component's state, is shown once, is never logged,
// and is dropped when the dialog closes (T-10-40). The base URL comes from the server's
// configuration, never from the browser.

const COPIED_MS = 2_000;
const MAX_EMAIL_LENGTH = 254;

const ERROR_CALLOUT =
  "rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive";
const WARNING_CALLOUT =
  "flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-warning";

/** The same shape check as the server: one `@`, both parts non-empty, no whitespace. */
function isPlausibleEmail(email: string): boolean {
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || /\s/.test(email)) return false;
  const at = email.indexOf("@");
  return at > 0 && at === email.lastIndexOf("@") && at < email.length - 1;
}

type CopyLinkResult = { delivery: "smtp_off" | "send_failed"; email: string; link: string };

export function InviteDialog({ actorRole }: { actorRole: TeamRole }) {
  const roles = grantableRoles(actorRole);
  const emailId = useId();
  const roleId = useId();
  const roleHelpId = useId();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ key: InviteErrorKey; email: string } | null>(null);
  const [result, setResult] = useState<CopyLinkResult | null>(null);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  /** Every close drops the form, the error and the link: the next invite starts empty (D-06). */
  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) return;
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    setEmail("");
    setRole("member");
    setError(null);
    setResult(null);
    setCopied(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const typed = email.trim();
    setError(null);
    if (!isPlausibleEmail(typed)) {
      setError({ key: "invalid_email", email: typed });
      return;
    }
    setPending(true);
    const response = await inviteMemberAction(typed, role).catch(() => null);
    setPending(false);
    if (!response) {
      setError({ key: "unknown", email: typed });
      return;
    }
    if (!response.ok) {
      setError({ key: response.error, email: typed });
      return;
    }
    if (response.delivery === "sent") {
      toast.success(inviteSentToast(response.email));
      setOpen(false);
      setEmail("");
      setRole("member");
      return;
    }
    setResult({ delivery: response.delivery, email: response.email, link: response.link });
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
    } catch {
      // No clipboard access: select the link so it can be copied by hand.
      linkRef.current?.focus();
      linkRef.current?.select();
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <>
      <Button type="button" className="text-[13px]" onClick={() => handleOpenChange(true)}>
        <UserPlus className="size-4" aria-hidden="true" />
        {INVITE_BUTTON}
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold tracking-tight">
              {INVITE_TITLE}
            </DialogTitle>
            <DialogDescription className="text-[13px]">{INVITE_DESCRIPTION}</DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="min-w-0 space-y-4">
              <div className={WARNING_CALLOUT}>
                <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                <p role="status" className="min-w-0 wrap-anywhere">
                  {copyLinkNotice(result.delivery, result.email)}
                </p>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  ref={linkRef}
                  readOnly
                  value={result.link}
                  aria-label={INVITATION_LINK_LABEL}
                  className="h-8 min-w-0 flex-1 font-mono text-[12px]"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-[13px]"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                  <span aria-live="polite">{copied ? COPIED : COPY_LINK}</span>
                </Button>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  className="text-[13px]"
                  onClick={() => handleOpenChange(false)}
                >
                  {INVITE_DISMISS_RESULT}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form noValidate onSubmit={handleSubmit} className="min-w-0 space-y-4">
              <div className="space-y-2">
                <Label htmlFor={emailId} className="text-[13px] font-semibold">
                  {INVITE_EMAIL_LABEL}
                </Label>
                <Input
                  id={emailId}
                  type="email"
                  autoComplete="off"
                  required
                  value={email}
                  disabled={pending}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-8 text-[13px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={roleId} className="text-[13px] font-semibold">
                  {INVITE_ROLE_LABEL}
                </Label>
                <Select
                  value={role}
                  disabled={pending}
                  onValueChange={(value) => {
                    const next = roles.find((r) => r === value);
                    if (next) setRole(next);
                  }}
                >
                  <SelectTrigger
                    id={roleId}
                    aria-describedby={roleHelpId}
                    className="h-8 w-full text-[13px]"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r} className="text-[13px]">
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p id={roleHelpId} className="text-[12px] text-muted-foreground">
                  {INVITE_ROLE_HELP}
                </p>
              </div>

              {error && (
                <div role="alert" className={`${ERROR_CALLOUT} wrap-anywhere`}>
                  {inviteError(error.key, error.email)}
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="text-[13px]"
                  disabled={pending}
                  onClick={() => handleOpenChange(false)}
                >
                  {INVITE_DISMISS_FORM}
                </Button>
                <Button
                  type="submit"
                  className="text-[13px]"
                  disabled={pending || email.trim() === ""}
                >
                  {pending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="size-4" aria-hidden="true" />
                  )}
                  {pending ? INVITE_SENDING : INVITE_SUBMIT}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
