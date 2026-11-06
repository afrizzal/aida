"use client";

import { Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useCommands } from "@/components/command-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { isApplePlatform, subscribeNever } from "@/lib/keyboard/platform";
import { getPageTitle } from "@/lib/navigation/page-title";

interface TopBarUser {
  name: string;
  email: string;
}

interface TopBarProps {
  user: TopBarUser;
}

/**
 * The palette key cap: "⌘ K" on Apple platforms, "Ctrl K" elsewhere. The server snapshot is
 * null, so the cap is decided only on the client after hydration (no hydration mismatch).
 */
function usePaletteKeyLabel(): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => (isApplePlatform() ? "⌘ K" : "Ctrl K"),
    () => null,
  );
}

export function TopBar({ user }: TopBarProps) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);
  const { openPalette } = useCommands();
  const keyLabel = usePaletteKeyLabel();

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/70 bg-background/80 px-6 backdrop-blur-sm supports-[backdrop-filter]:bg-background/65">
      {/* AIDA-36 (D-14, DESIGN-SYSTEM 4.2): the top-bar title is text, not a heading. Each page
          owns its one h1 inside <main> (sr-only when it repeats these words). */}
      <p className="text-[18px] font-semibold">{title}</p>
      <div className="flex items-center gap-2">
        {/* Palette trigger (AIDA-49, UI-SPEC Surface 4a): the visible entry point for mouse and
            touch; the key cap is decorative, the shortcut is announced by aria-keyshortcuts. */}
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-[13px] text-muted-foreground"
          aria-keyshortcuts="Meta+K Control+K"
          onClick={openPalette}
        >
          <Search className="size-4" />
          Search
          {keyLabel && (
            <kbd
              aria-hidden
              className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[12px] text-foreground"
            >
              {keyLabel}
            </kbd>
          )}
        </Button>
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
