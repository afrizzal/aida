// Phase 12.2, review b-WR-02: the version rule of the review page's DRAFT editor. Pure and
// client-safe; relative imports only.
//
// The editor is no longer remounted by its own save (that remount threw away anything typed
// between the save and the refresh). It keeps the version it last saved or loaded (`local`) and
// the last version it saw in the server props (`seen`), and applies this rule to the props'
// version (`incoming`).

/**
 * "none": the props carry a version already seen. "ownSave": they carry the version this editor
 * just saved, so the stored values become the form's defaults and typed fields keep their value.
 * "other": any other version (another admin's save, read by a reload), which replaces the form.
 */
export type EditorVersionChange = "none" | "ownSave" | "other";

export function classifyVersionChange(versions: {
  seen: number;
  incoming: number;
  local: number;
}): EditorVersionChange {
  if (versions.incoming === versions.seen) return "none";
  return versions.incoming === versions.local ? "ownSave" : "other";
}

/**
 * True from a save until the server props carry the saved version: until then the preview HTML
 * and the publish dialog's data belong to the previous version, so Preview and "Approve and
 * publish…" wait.
 */
export function isAwaitingSavedVersion(versions: { propsVersion: number; local: number }): boolean {
  return versions.propsVersion !== versions.local;
}
