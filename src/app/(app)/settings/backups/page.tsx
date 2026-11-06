import { CircleAlert, CircleCheck, DatabaseBackup } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getOrgRole } from "@/lib/authz";
import {
  BACKUP_FAILURE_SENTENCES,
  BACKUP_STATUS_KEY,
  type BackupStatus,
  formatBackupTime,
  parseBackupStatus,
} from "@/lib/backup/status";
import { prisma } from "@/lib/db";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { isAdminRole } from "@/lib/membership";
import { e2eFault } from "@/lib/testing/e2e-fault";

// Reads the database at request time (the last backup run) — must never be statically prerendered.
export const dynamic = "force-dynamic";

const COPY = {
  subtitle:
    "AIDA backs up its database and uploaded files on this server on a schedule. This page shows the most recent run. The schedule, retention and the off switch are server settings described in docs/OPERATIONS.md.",
  adminOnly: "Only workspace admins can see backup status.",
  emptyHeading: "No backup has run yet",
  emptyBody:
    "The first backup runs at its next scheduled time. If backups are turned off on this server, nothing appears here.",
  unreadable: "Backup status could not be read. Check the backup service logs.",
  noSet: "None — this run did not publish a set",
} as const;

const CALLOUT =
  "flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-[13px] text-destructive";

/**
 * Settings -> Backups (AIDA-33, D-04, UI-SPEC Surface 4): the most recent backup run, read-only.
 * The record is instance-wide (`SystemSetting`), holds no tenant data and no secret, and is shown
 * only to workspace owners and admins. The role check runs before the read, so a member's request
 * reads nothing. No button, no form: backups are configured on the server.
 */
export default async function BackupsSettingsPage() {
  await e2eFault("settings-backups-page"); // inert outside the E2E server (src/lib/testing/e2e-fault.ts)
  const role = await getOrgRole();
  const canView = isAdminRole(role);

  let status: BackupStatus | null = null;
  if (canView) {
    const row = await prisma.systemSetting.findUnique({
      where: { key: BACKUP_STATUS_KEY },
      select: { value: true },
    });
    status = parseBackupStatus(row?.value ?? null);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[18px] font-semibold">Backups</h1>
        <p className="text-[13px] text-muted-foreground">{COPY.subtitle}</p>
      </div>
      {status === null ? (
        <p className="text-[13px] text-muted-foreground">{COPY.adminOnly}</p>
      ) : (
        <BackupStatusBody status={status} />
      )}
    </div>
  );
}

function BackupStatusBody({ status }: { status: BackupStatus }) {
  if (status.kind === "none") {
    return <EmptyState icon={DatabaseBackup} heading={COPY.emptyHeading} body={COPY.emptyBody} />;
  }
  if (status.kind === "unreadable") {
    return (
      <div role="status" className={CALLOUT}>
        <CircleAlert className="size-4 shrink-0" aria-hidden />
        {COPY.unreadable}
      </div>
    );
  }

  const failed = status.kind === "failed";
  return (
    <Card className="border-border/70 p-4 shadow-sm">
      <h2 className="text-[15px] font-semibold tracking-tight">Last backup</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
        <dt className="text-muted-foreground">Result</dt>
        <dd className="min-w-0">
          {failed ? (
            // The spec's /10 tint in both themes: the variant's dark /20 tint measured 3.96:1 for
            // destructive text on the card (axe, tests/e2e/backups-status.spec.ts).
            <Badge
              variant="destructive"
              className="border-transparent bg-destructive/10 text-destructive dark:bg-destructive/10"
            >
              <CircleAlert aria-hidden />
              Failed
            </Badge>
          ) : (
            <Badge
              variant="success"
              className="border-transparent bg-success/10 text-success dark:bg-success/10"
            >
              <CircleCheck aria-hidden />
              Succeeded
            </Badge>
          )}
        </dd>
        <dt className="text-muted-foreground">Finished</dt>
        <dd className="min-w-0 text-foreground">
          <time dateTime={status.finishedAt} title={formatBackupTime(status.finishedAt)}>
            {formatRelativeTime(status.finishedAt)}
          </time>
          <span className="text-[12px] text-muted-foreground">
            {" · "}
            {formatBackupTime(status.finishedAt)}
          </span>
        </dd>
        <dt className="text-muted-foreground">Backup set</dt>
        <dd className="min-w-0 text-foreground">
          {status.setId ? (
            <span className="font-mono text-[13px] break-all">{status.setId}</span>
          ) : (
            COPY.noSet
          )}
        </dd>
        {failed ? (
          <>
            <dt className="text-muted-foreground">Failure reason</dt>
            <dd className="min-w-0 text-foreground">{BACKUP_FAILURE_SENTENCES[status.category]}</dd>
          </>
        ) : null}
      </dl>
      {failed ? (
        <div role="status" className={CALLOUT}>
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <span>
            Check the backup service logs with{" "}
            <code className="font-mono">docker compose logs backup</code>. The next scheduled run
            tries again on its own.
          </span>
        </div>
      ) : null}
    </Card>
  );
}
