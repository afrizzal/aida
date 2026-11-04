"use client";

import { BookOpen, Inbox, Lightbulb, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { SidebarViews } from "@/components/sidebar-views";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { SidebarViews as SidebarViewLists } from "@/lib/saved-views/ui-state";
import { cn } from "@/lib/utils";

interface SidebarUser {
  name: string;
  email: string;
}

interface SidebarProps {
  user: SidebarUser;
  brandName: string;
  /** The workspace logo's versioned public URL, or null for the Sparkles box (AIDA-34, D-11). */
  logoUrl: string | null;
  /** Saved views loaded server-side by the (app) layout (AIDA-47, UI-SPEC Surface 1). */
  views: SidebarViewLists;
}

const navItems = [
  { href: "/tickets", label: "Tickets", icon: Inbox },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/kb", label: "Knowledge Base", icon: BookOpen },
  { href: "/insights", label: "Insight", icon: Lightbulb },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Sidebar({ user, brandName, logoUrl, views }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Brand: the workspace logo or the Sparkles box, always with the name (BrandMark). */}
      <div className="flex h-14 items-center px-4">
        <BrandMark variant="sidebar" name={brandName} logoUrl={logoUrl} />
      </div>

      {/* Nav: scrolls when the links plus the Views section exceed the height, so the user
          footer stays pinned (UI-SPEC Surface 1). */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "group flex h-9 items-center gap-2.5 rounded-md px-3 text-[14px] transition-colors",
                  isActive
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    isActive
                      ? "text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground",
                  )}
                />
                {label}
              </Link>
            );
          })}
        </div>
        <SidebarViews views={views} />
      </nav>

      {/* User */}
      <div className="border-t border-sidebar-border p-2">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-sidebar-accent/60">
          <Avatar className="size-8">
            <AvatarFallback className="bg-sidebar-primary/10 text-[12px] font-medium text-sidebar-primary-emphasis">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight text-sidebar-foreground">
              {user.name}
            </p>
            {/* /70 (not /60): axe-core color-contrast found /60 rendered ~3.76:1 against the
                sidebar background, short of WCAG AA's 4.5:1 for normal text (07-09.1 Task 3).
                /70 matches the opacity already used for inactive nav-item text one section up
                (and DESIGN-SYSTEM.md §4.1's documented inactive-nav-item value) and verified
                >=4.5:1 empirically. */}
            <p className="truncate text-[12px] leading-tight text-sidebar-foreground/70">
              {user.email}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
