// Client instrumentation (Next.js file convention). Nothing is sent anywhere: the only export
// re-broadcasts the start of a client-side navigation inside the page, so a component holding a
// pending navigation of its own (the contacts search debounce) can drop it (Codex diff critique
// D4).
import {
  announceNavigationStart,
  type NavigationStartType,
} from "@/lib/navigation/navigation-start";

export function onRouterTransitionStart(url: string, navigationType: NavigationStartType): void {
  announceNavigationStart(url, navigationType);
}
