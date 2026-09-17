// Platform detection for key labels (⌘ on Apple platforms, Ctrl elsewhere), shared by the top
// bar's palette trigger and the key caps (review IN-07: both kept their own copy). Client-only
// callers read it through useSyncExternalStore with their own server snapshot.

export interface PlatformNavigator {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/** True on macOS and iOS. Reads the browser's navigator unless one is passed (tests). */
export function isApplePlatform(nav: PlatformNavigator = navigator): boolean {
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The platform never changes during a session: a useSyncExternalStore subscribe that does nothing. */
export function subscribeNever(): () => void {
  return () => {};
}
