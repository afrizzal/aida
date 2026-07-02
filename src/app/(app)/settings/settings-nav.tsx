"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/settings", label: "AI Features" },
  { href: "/settings/sla", label: "SLA Policies" },
  { href: "/settings/tags", label: "Tags" },
  { href: "/settings/custom-fields", label: "Custom Fields" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1.5">
      {navItems.map(({ href, label }) => {
        // Exact match for /settings (AI Features) so sub-routes like /settings/sla
        // don't also light it up; sub-routes use startsWith.
        const isActive = href === "/settings" ? pathname === href : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex h-8 items-center rounded-full px-3 text-[13px] font-medium transition-colors",
              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
