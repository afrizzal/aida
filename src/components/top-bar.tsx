"use client";

import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

interface TopBarUser {
  name: string;
  email: string;
}

interface TopBarProps {
  user: TopBarUser;
}

const pageTitles: Record<string, string> = {
  "/tickets": "Tickets",
  "/kb": "Knowledge Base",
  "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  for (const [prefix, title] of Object.entries(pageTitles)) {
    if (pathname.startsWith(prefix)) return title;
  }
  return "AIDA";
}

export function TopBar({ user }: TopBarProps) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border/70 bg-background/80 px-6 backdrop-blur-sm supports-[backdrop-filter]:bg-background/65">
      <h1 className="text-[18px] font-semibold">{title}</h1>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
