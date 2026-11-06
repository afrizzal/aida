// The app-shell title for a path: the top bar's text (src/components/top-bar.tsx) and the sr-only
// h1 of the app-level error state (src/app/(app)/error.tsx, K147), so both name a route the same
// way. Relative imports only.

const PAGE_TITLES: ReadonlyArray<readonly [prefix: string, title: string]> = [
  ["/tickets", "Tickets"],
  ["/contacts", "Contacts"],
  ["/kb", "Knowledge Base"],
  ["/settings", "Settings"],
];

/** The title of the first matching path prefix, or "AIDA" for any other path. */
export function getPageTitle(pathname: string): string {
  for (const [prefix, title] of PAGE_TITLES) {
    if (pathname.startsWith(prefix)) return title;
  }
  return "AIDA";
}
