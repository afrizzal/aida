"use client";

import { BookOpen, Inbox, Settings2 } from "lucide-react";
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
  { href: "/kb", label: "Knowledge Base", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 flex-col bg-muted">
      {/* Wordmark */}
      <div className="p-4">
        <span className="text-[18px] font-semibold">AIDA</span>
      </div>

      {/* Nav list */}
      <nav className="flex-1 px-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex h-9 items-center gap-2 rounded px-3 text-[14px]",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User area */}
      <div className="mt-auto p-4">
        <div className="flex items-center gap-2">
          <Avatar>
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-tight">{user.name}</p>
            <p className="truncate text-[12px] text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
