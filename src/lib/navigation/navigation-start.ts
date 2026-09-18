// "A client-side navigation has started" for components that hold a pending navigation of their
// own (Codex diff critique D4). Next.js 16 calls `onRouterTransitionStart` from
// `src/instrumentation-client.ts` (a documented file convention) when a Link click,
// router.push/replace or back/forward begins, before the new route is fetched or committed.
// That hook re-broadcasts it as a window event, so a subscriber does not depend on sharing one
// module instance with the instrumentation bundle.

export type NavigationStartType = "push" | "replace" | "traverse";

export const NAVIGATION_START_EVENT = "aida:navigation-start";

export interface NavigationStartDetail {
  url: string;
  type: NavigationStartType;
}

/** Called by instrumentation-client.ts; a no-op outside the browser. */
export function announceNavigationStart(url: string, type: NavigationStartType): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<NavigationStartDetail>(NAVIGATION_START_EVENT, { detail: { url, type } }),
  );
}

/** Runs `listener` whenever a client-side navigation starts; returns the unsubscribe function. */
export function onNavigationStart(listener: (detail: NavigationStartDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => listener((event as CustomEvent<NavigationStartDetail>).detail);
  window.addEventListener(NAVIGATION_START_EVENT, handler);
  return () => window.removeEventListener(NAVIGATION_START_EVENT, handler);
}
