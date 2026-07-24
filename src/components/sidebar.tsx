"use client";

import { BookOpen, Inbox, Lightbulb, Settings2, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface SidebarUser {
  name: string;
  email: string;
}

interface SidebarProps {
  user: SidebarUser;
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

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary shadow-sm">
          <Sparkles className="size-4 text-sidebar-primary-foreground" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">
          AIDA
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-2 py-2">
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
      </nav>

      {/* User */}
      <div className="border-t border-sidebar-border p-2">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-sidebar-accent/60">
          <Avatar className="size-8">
            <AvatarFallback className="bg-sidebar-primary/10 text-[12px] font-medium text-sidebar-primary">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight text-sidebar-foreground">
              {user.name}
            </p>
            <p className="truncate text-[12px] leading-tight text-sidebar-foreground/60">
              {user.email}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
