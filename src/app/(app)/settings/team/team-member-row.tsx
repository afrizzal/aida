"use client";

import { UserMinus } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { changeRoleAction } from "./actions";
import { DeactivateDialog } from "./deactivate-dialog";
import {
  DEACTIVATE_TRIGGER,
  displayName,
  initialsOf,
  MEMBERS_ADMIN_ONLY,
  MEMBERS_HEADING,
  membersCount,
  OWNER_ROW_TOOLTIP,
  ROLE_ERRORS,
  ROLE_LABELS,
  type RoleErrorKey,
  roleChangedToast,
  roleSelectLabel,
  type TeamRole,
  YOU_BADGE,
} from "./team-copy";
import { type RowRights, rowRights, type TeamMember } from "./team-rights";

// UI-SPEC Surface 1, the Members card (E1): one row per member, sorted by the server (owners,
// admins, members, then name). The role control and the actions follow the "Who may do what"
// table; the table is a convenience only, because every change is re-checked by the service under
// the organization lock (T-10-39). Nothing is optimistic: a role change disables its Select and
// shows the new value until the action returns; the row updates through revalidatePath.

const ERROR_CALLOUT =
  "rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive";

export function TeamMembersCard({
  members,
  actorUserId,
  actorRole,
}: {
  members: TeamMember[];
  actorUserId: string;
  actorRole: TeamRole;
}) {
  const [roleError, setRoleError] = useState<RoleErrorKey | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The Deactivate dialog: a snapshot of the target, kept after the row leaves the list (A7).
  const [deactivate, setDeactivate] = useState<{ target: TeamMember; key: number } | null>(null);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const removedRef = useRef(false);

  function openDeactivate(member: TeamMember) {
    removedRef.current = false;
    setDeactivate((prev) => ({ target: member, key: (prev?.key ?? 0) + 1 }));
    setDeactivateOpen(true);
  }

  return (
    // Card is flex-col with a 16px gap (--card-spacing): the contract's space-y-4 stack.
    <Card className="border-border/70 p-4 shadow-sm">
      <div className="space-y-1">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-[15px] font-semibold tracking-tight outline-none"
        >
          {MEMBERS_HEADING}
        </h2>
        <p className="text-[13px] text-muted-foreground">{membersCount(members.length)}</p>
      </div>
      {actorRole === "member" && (
        <p className="text-[13px] text-muted-foreground">{MEMBERS_ADMIN_ONLY}</p>
      )}
      {roleError && (
        <div role="alert" className={ERROR_CALLOUT}>
          {ROLE_ERRORS[roleError]}
        </div>
      )}
      <ul className="divide-y divide-border/70">
        {members.map((member) => (
          <TeamMemberRow
            key={member.userId}
            member={member}
            isSelf={member.userId === actorUserId}
            rights={rowRights(actorUserId, actorRole, member)}
            onRoleChangeStart={() => setRoleError(null)}
            onRoleError={setRoleError}
            onDeactivate={() => openDeactivate(member)}
          />
        ))}
      </ul>
      {deactivate && (
        <DeactivateDialog
          key={deactivate.key}
          open={deactivateOpen}
          target={deactivate.target}
          reassignees={members.filter((m) => m.userId !== deactivate.target.userId)}
          onOpenChange={setDeactivateOpen}
          onRemoved={() => {
            removedRef.current = true;
          }}
          onCloseAutoFocus={(event) => {
            // After a removal the trigger is gone: focus moves to the Members heading (UI-SPEC).
            if (!removedRef.current) return;
            event.preventDefault();
            headingRef.current?.focus();
          }}
        />
      )}
    </Card>
  );
}

export function TeamMemberRow({
  member,
  isSelf,
  rights,
  onRoleChangeStart,
  onRoleError,
  onDeactivate,
}: {
  member: TeamMember;
  isSelf: boolean;
  rights: RowRights;
  onRoleChangeStart: () => void;
  onRoleError: (error: RoleErrorKey) => void;
  onDeactivate: () => void;
}) {
  const [pendingRole, setPendingRole] = useState<TeamRole | null>(null);
  const name = displayName(member.name, member.email);
  const showEmail = name !== member.email;

  async function handleRoleChange(value: string) {
    const next = rights.roleOptions.find((role) => role === value);
    if (!next || next === member.role || pendingRole) return;
    onRoleChangeStart();
    setPendingRole(next);
    const result = await changeRoleAction(member.userId, next).catch(() => null);
    setPendingRole(null);
    if (result?.ok) {
      toast.success(roleChangedToast(name, result.role));
      return;
    }
    // The Select falls back to the stored role (pendingRole cleared); the card shows the callout.
    onRoleError(result ? result.error : "unknown");
  }

  const roleBadge = (
    <Badge variant="secondary" className="text-[12px]">
      {ROLE_LABELS[member.role]}
    </Badge>
  );

  return (
    <li className="flex flex-wrap items-center gap-4 py-2">
      {/* Under 640px the identity takes the whole line, so the role control and action wrap below. */}
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/10 text-[12px] text-primary-emphasis">
            {initialsOf(member.name, member.email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[13px] font-semibold text-foreground">{name}</p>
            {isSelf && (
              <Badge variant="outline" className="text-[12px]">
                {YOU_BADGE}
              </Badge>
            )}
          </div>
          {showEmail && (
            <p className="truncate text-[12px] text-muted-foreground">{member.email}</p>
          )}
        </div>
      </div>

      {rights.roleOptions.length > 0 ? (
        <Select
          value={pendingRole ?? member.role}
          disabled={pendingRole !== null}
          onValueChange={handleRoleChange}
        >
          <SelectTrigger aria-label={roleSelectLabel(name)} className="h-8 w-[120px] text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {rights.roleOptions.map((role) => (
              <SelectItem key={role} value={role} className="text-[13px]">
                {ROLE_LABELS[role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : rights.ownerTooltip ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Focusable so keyboard users reach the reason, not only pointer users. */}
              <Badge variant="secondary" tabIndex={0} className="text-[12px]">
                {ROLE_LABELS[member.role]}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-[240px] text-[12px]">
              {OWNER_ROW_TOOLTIP}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        roleBadge
      )}

      {rights.canDeactivate && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-[13px] text-destructive"
          onClick={onDeactivate}
        >
          <UserMinus className="size-4" aria-hidden="true" />
          {DEACTIVATE_TRIGGER}
        </Button>
      )}
    </li>
  );
}
