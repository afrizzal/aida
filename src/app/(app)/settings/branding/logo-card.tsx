"use client";

import { CircleAlert, Loader2, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LOGO_MIME_TYPES } from "@/lib/branding/settings";
import { MEMBERSHIP_ENDED } from "@/lib/tickets/state-copy";

const LOGO_ROUTE = "/api/settings/branding/logo";

/**
 * LOGO_MAX_BYTES of src/lib/branding/logo-validate.ts (1 MiB). Repeated here because that module
 * imports file-type and must stay out of the client bundle; the server re-checks every byte.
 */
const MAX_LOGO_BYTES = 1_048_576;

/** The extensions of the accepted types, for a browser that reports no type for a file. */
const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

// The Copywriting rows of UI-SPEC Phase 9, keyed by the route's response code (plan 09-05).
const ERROR_COPY = {
  not_image: "This file is not a PNG, JPEG or WebP image. Choose a PNG, JPEG or WebP file.",
  svg: "SVG logos are not accepted. Export the logo as PNG or WebP and upload that file.",
  too_large: "This file is larger than 1 MiB. Export a smaller version, then upload it again.",
  too_many_pixels: "This image is larger than 1024 × 1024 pixels. Resize it, then upload it again.",
  unreadable:
    "This image could not be read. Check that the file opens on your computer, then try again.",
  not_allowed: "Only workspace admins can change the logo.",
  // K164: the route's membership refusal; the app's one MEMBERSHIP_ENDED sentence, no new copy.
  membership_ended: MEMBERSHIP_ENDED,
} as const;

/** Rate-limited, network and every unknown or unexpected answer. */
const SAVE_FAILED = "The logo could not be saved. Wait a moment and try again.";
const REMOVE_FAILED = "The logo could not be removed. Wait a moment and try again.";

type RefusalCode = keyof typeof ERROR_COPY;

function isRefusalCode(code: unknown): code is RefusalCode {
  return typeof code === "string" && Object.hasOwn(ERROR_COPY, code);
}

/** The client pre-check (UI-SPEC Surface 1): type and size only; nothing is sent on a refusal. */
function precheck(file: File): RefusalCode | null {
  const name = file.name.toLowerCase();
  if (file.type === "image/svg+xml" || name.endsWith(".svg")) return "svg";
  const typeAccepted = file.type
    ? (LOGO_MIME_TYPES as readonly string[]).includes(file.type)
    : ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!typeAccepted) return "not_image";
  if (file.size > MAX_LOGO_BYTES) return "too_large";
  return null;
}

async function readCode(response: Response): Promise<unknown> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return body?.code;
  } catch {
    return undefined;
  }
}

interface LogoCardProps {
  /** The current logo's versioned public URL, or null when none is set. */
  logoUrl: string | null;
  /** Owner or admin of the active organization; members see the logo and a notice only. */
  canEdit: boolean;
}

/**
 * Settings > Branding's Logo card (Phase 9 plan 09-07, AIDA-34, D-11, UI-SPEC Surface 1). A
 * file pick uploads at once through the 09-05 route handler (POST, form field `file`); Remove
 * asks first, then sends DELETE. The server's byte sniffing, dimension check and role check are
 * authoritative and its response code picks the Copywriting row. router.refresh() then
 * re-renders the sidebar, the Name-card preview and this card without a full reload.
 */
export function LogoCard({ logoUrl, canEdit }: LogoCardProps) {
  const router = useRouter();
  const helpId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<"upload" | "remove" | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const busy = pending !== null || refreshing;

  async function upload(file: File) {
    const refusal = precheck(file);
    if (refusal) {
      setError(ERROR_COPY[refusal]);
      return;
    }
    setPending("upload");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(LOGO_ROUTE, { method: "POST", body });
      if (response.ok) {
        const result = (await response.json().catch(() => null)) as { replaced?: unknown } | null;
        toast.success(result?.replaced === true ? "Logo replaced." : "Logo uploaded.");
        startRefresh(() => router.refresh());
        return;
      }
      const code = await readCode(response);
      setError(isRefusalCode(code) ? ERROR_COPY[code] : SAVE_FAILED);
    } catch {
      setError(SAVE_FAILED);
    } finally {
      setPending(null);
    }
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setError(null); // cleared on every pick
    try {
      if (file) await upload(file);
    } finally {
      // Reset after every attempt, so the same file can be picked again.
      input.value = "";
    }
  }

  async function confirmRemove() {
    setPending("remove");
    setRemoveError(null);
    try {
      const response = await fetch(LOGO_ROUTE, { method: "DELETE" });
      if (!response.ok) {
        setRemoveError(REMOVE_FAILED);
        return;
      }
      // { ok: true, removed: false }: another admin removed the logo first (review c-IN-05).
      const result = (await response.json().catch(() => null)) as { removed?: unknown } | null;
      setRemoveOpen(false);
      setError(null);
      if (result?.removed === false) toast("There was no logo to remove.");
      else toast.success("Logo removed.");
      startRefresh(() => router.refresh());
    } catch {
      setRemoveError(REMOVE_FAILED);
    } finally {
      setPending(null);
    }
  }

  function onRemoveOpenChange(open: boolean) {
    // The dialog stays open while the removal is pending; its result decides.
    if (pending === "remove") return;
    if (open) setRemoveError(null);
    setRemoveOpen(open);
  }

  // Card is flex-col with a 16px gap (--card-spacing): the contract's space-y-4 stack.
  return (
    <Card className="border-border/70 p-4 shadow-sm">
      <h2 className="text-[15px] font-semibold tracking-tight">Logo</h2>
      <p id={helpId} className="text-[12px] text-muted-foreground">
        PNG, JPEG or WebP. Up to 1 MiB and 1024 × 1024 pixels. SVG is not accepted. Use a logo that
        reads on both light and dark backgrounds.
      </p>

      {logoUrl ? (
        <div className="flex h-16 w-40 items-center justify-center rounded-md border border-border/70 bg-muted/40 p-2">
          {/* biome-ignore lint/performance/noImgElement: a plain img of the same-origin logo route (UI-SPEC Surface 1) */}
          <img
            src={logoUrl}
            alt="Current workspace logo"
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : (
        <p className="text-[13px] text-foreground">
          No logo uploaded. The sidebar and public pages show the default icon.
        </p>
      )}

      {canEdit ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label="Logo file"
            aria-describedby={helpId}
            tabIndex={-1}
            onChange={onFileChange}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant={logoUrl ? "outline" : "default"}
              disabled={busy}
              aria-describedby={helpId}
              onClick={() => inputRef.current?.click()}
            >
              {pending === "upload" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Upload className="mr-2 size-4" />
              )}
              {pending === "upload" ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() => onRemoveOpenChange(true)}
              >
                <Trash2 className="mr-2 size-4" />
                Remove logo
              </Button>
            ) : null}
          </div>
          {error ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-[13px] text-destructive"
            >
              <CircleAlert className="size-4 shrink-0" />
              {error}
            </div>
          ) : null}

          <Dialog open={removeOpen} onOpenChange={onRemoveOpenChange}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove the workspace logo?</DialogTitle>
                <DialogDescription>
                  The sidebar and your public pages will show the default icon next to the workspace
                  name. You can upload a logo again at any time.
                </DialogDescription>
                {removeError ? (
                  <p role="alert" className="text-[13px] text-destructive">
                    {removeError}
                  </p>
                ) : null}
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={pending === "remove"}
                  onClick={() => onRemoveOpenChange(false)}
                >
                  Keep logo
                </Button>
                <Button
                  variant="destructive"
                  disabled={pending === "remove"}
                  onClick={confirmRemove}
                >
                  {pending === "remove" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  {pending === "remove" ? "Removing…" : "Remove logo"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Only workspace admins can change the logo.
        </p>
      )}
    </Card>
  );
}
