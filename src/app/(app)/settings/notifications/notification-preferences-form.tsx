// biome-ignore-all lint/a11y/useSemanticElements: UI-SPEC Surface 5 specifies a div role="table" grid (grid-cols-[1fr_auto_auto]) so the two switch columns align at 360px; native table elements lose their table semantics in some browsers when given display:contents, so the ARIA roles carry them here.
// biome-ignore-all lint/a11y/useFocusableInteractive: the row, rowheader, columnheader and cell roles of this static (non-grid) ARIA table are structural, not widgets; the focusable controls are the Switch elements inside the cells.
"use client";

// The switch grid of Settings -> Notifications (Phase 10, AIDA-46, D-22, UI-SPEC Surface 5) and,
// for owners and admins, the "Unassigned tickets" switch of owner item 11 (V-28, amendment A3).
//
// Each toggle saves at once through a server action; the switch is disabled while its save is
// pending; success is silent (the switch position is the confirmation); a failed save puts the
// switch back and shows the error callout above the grid. Coupling: the digest is built from
// in-app notifications, so while In app is off for a type its Email digest switch shows off and
// disabled; turning In app back on shows the stored digest value again (it was never changed).

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { NotificationTypeName } from "@/lib/notifications/types";
import { setPreferenceAction, setUnassignedSettingAction } from "./actions";

// The Copywriting Contract rows "Preference rows", "Digest coupling tooltip" and "Preference save
// error", verbatim, in the Surface 5 order. The "Unassigned tickets" copy is amendment A3.
const ROWS: ReadonlyArray<{ type: NotificationTypeName; label: string; description: string }> = [
  {
    type: "ASSIGNED",
    label: "Assigned to me",
    description: "A ticket is assigned to you by someone else.",
  },
  {
    type: "CUSTOMER_REPLY",
    label: "Customer replies on my tickets",
    description: "A customer replies on a ticket assigned to you.",
  },
  { type: "MENTION", label: "Mentions", description: "Someone mentions you in an internal note." },
  {
    type: "SLA_AT_RISK",
    label: "SLA at risk",
    description: "A ticket assigned to you is close to its SLA deadline.",
  },
  {
    type: "SLA_BREACHED",
    label: "SLA breached",
    description: "A ticket assigned to you missed its SLA.",
  },
];

const COUPLING_TOOLTIP = "Turn on in-app notifications to include this in the digest.";
const SAVE_ERROR = "Your change could not be saved. Try again.";
const UNASSIGNED_LABEL = "Unassigned tickets";
const UNASSIGNED_DESCRIPTION =
  "Customer replies and SLA alerts on tickets nobody is assigned to. Owners and admins get these, in the app and in the digest.";

type Field = "inApp" | "digest";

interface PreferenceValue {
  type: NotificationTypeName;
  inApp: boolean;
  digest: boolean;
}

interface NotificationPreferencesFormProps {
  /** The caller's five preferences, defaults filled in (getPreferences). */
  initial: readonly PreferenceValue[];
  /** The caller's "Unassigned tickets" switch; null when the caller is not an owner or admin. */
  initialUnassigned: boolean | null;
}

const cellKey = (type: NotificationTypeName, field: Field) => `${type}:${field}`;

export function NotificationPreferencesForm({
  initial,
  initialUnassigned,
}: NotificationPreferencesFormProps) {
  const [prefs, setPrefs] = useState<Record<NotificationTypeName, PreferenceValue>>(() => {
    const byType = {} as Record<NotificationTypeName, PreferenceValue>;
    for (const row of ROWS) {
      byType[row.type] = initial.find((p) => p.type === row.type) ?? {
        type: row.type,
        inApp: true,
        digest: true,
      };
    }
    return byType;
  });
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [unassigned, setUnassigned] = useState(initialUnassigned);
  const [unassignedPending, setUnassignedPending] = useState(false);
  const [error, setError] = useState(false);

  function setCellPending(key: string, on: boolean) {
    setPending((prev) => {
      const copy = new Set(prev);
      if (on) copy.add(key);
      else copy.delete(key);
      return copy;
    });
  }

  function setField(type: NotificationTypeName, field: Field, value: boolean) {
    setPrefs((prev) => ({ ...prev, [type]: { ...prev[type], [field]: value } }));
  }

  async function toggle(type: NotificationTypeName, field: Field, value: boolean) {
    const key = cellKey(type, field);
    const before = prefs[type][field];
    setField(type, field, value);
    setCellPending(key, true);
    const result = await setPreferenceAction(type, { [field]: value }).catch(() => null);
    setCellPending(key, false);
    if (!result?.ok) {
      setField(type, field, before);
      setError(true);
      return;
    }
    setError(false);
    setField(type, field, result.preference[field]);
  }

  async function toggleUnassigned(value: boolean) {
    if (unassigned === null) return;
    const before = unassigned;
    setUnassigned(value);
    setUnassignedPending(true);
    const result = await setUnassignedSettingAction(value).catch(() => null);
    setUnassignedPending(false);
    if (!result?.ok) {
      setUnassigned(before);
      setError(true);
      return;
    }
    setError(false);
    setUnassigned(result.enabled);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
        >
          {SAVE_ERROR}
        </div>
      )}

      <TooltipProvider>
        <div
          role="table"
          aria-label="Event types"
          className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2"
        >
          <div role="row" className="contents">
            <div role="columnheader" className="text-[12px] text-muted-foreground">
              Event
            </div>
            <div role="columnheader" className="text-center text-[12px] text-muted-foreground">
              In app
            </div>
            <div role="columnheader" className="text-center text-[12px] text-muted-foreground">
              Email digest
            </div>
          </div>

          {ROWS.map((row) => {
            const value = prefs[row.type];
            const inAppPending = pending.has(cellKey(row.type, "inApp"));
            const digestPending = pending.has(cellKey(row.type, "digest"));
            const coupled = !value.inApp;
            return (
              <div role="row" key={row.type} className="contents">
                <div role="rowheader" className="min-w-0 space-y-1">
                  <p className="break-words text-[13px] text-foreground">{row.label}</p>
                  <p className="break-words text-[12px] text-muted-foreground">{row.description}</p>
                </div>
                <div role="cell" className="flex justify-center">
                  <Switch
                    aria-label={`${row.label}: in app`}
                    checked={value.inApp}
                    disabled={inAppPending}
                    onCheckedChange={(next) => void toggle(row.type, "inApp", next)}
                  />
                </div>
                <div role="cell" className="flex justify-center">
                  {coupled ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* Focusable so keyboard users reach the reason, not only pointer users. */}
                        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a disabled switch takes no focus, so this wrapper is the keyboard path to the coupling tooltip (the Team page's owner-row tooltip does the same) */}
                        <span tabIndex={0} className="inline-flex rounded-full">
                          <Switch
                            aria-label={`${row.label}: email digest`}
                            checked={false}
                            disabled
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[240px] text-[12px]">
                        {COUPLING_TOOLTIP}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Switch
                      aria-label={`${row.label}: email digest`}
                      checked={value.digest}
                      disabled={digestPending}
                      onCheckedChange={(next) => void toggle(row.type, "digest", next)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </TooltipProvider>

      {unassigned !== null && (
        <div className="flex items-center justify-between gap-4 border-t border-border/70 pt-4">
          <div className="min-w-0 space-y-1">
            <p className="break-words text-[13px] text-foreground">{UNASSIGNED_LABEL}</p>
            <p className="break-words text-[12px] text-muted-foreground">
              {UNASSIGNED_DESCRIPTION}
            </p>
          </div>
          <Switch
            aria-label={`${UNASSIGNED_LABEL}: notify me`}
            checked={unassigned}
            disabled={unassignedPending}
            onCheckedChange={(next) => void toggleUnassigned(next)}
          />
        </div>
      )}
    </div>
  );
}
