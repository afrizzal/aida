"use client";

import { ListFilter } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { SavedViewListItem } from "@/lib/saved-views/service";
import type { SidebarViews as SidebarViewLists } from "@/lib/saved-views/ui-state";
import { cn } from "@/lib/utils";

// The sidebar "Views" section (Phase 11, AIDA-47, D-06, UI-SPEC Surface 1). The lists arrive
// with the page from the (app) layout, already filtered by the server: the viewer's own private
// views and the organization's shared views, each in position, name, id order. sidebar-* tokens
// and the DESIGN-SYSTEM section 4.1 row classes only. Rows carry no inline actions; editing and
// deleting happen from the strip above the inbox list.

const VIEWS_EMPTY = "Save filters from the inbox to see them here.";

function ViewGroup({
  id,
  label,
  items,
  activeId,
}: {
  id: string;
  label: string;
  items: SavedViewListItem[];
  activeId: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p id={id} className="px-3 py-1 text-[12px] text-sidebar-foreground/70">
        {label}
      </p>
      <ul aria-labelledby={id} className="space-y-0.5">
        {items.map((view) => {
          const isActive = view.id === activeId;
          return (
            <li key={view.id}>
              <Link
                href={view.href}
                title={view.name}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex h-8 items-center gap-2 rounded-md px-3 text-[13px] transition-colors",
                  isActive
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <ListFilter
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 transition-colors",
                    isActive
                      ? "text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground",
                  )}
                />
                <span className="min-w-0 truncate">{view.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SidebarViews({ views }: { views: SidebarViewLists }) {
  const searchParams = useSearchParams();
  const activeId = searchParams.get("sv");
  const isEmpty = views.private.length === 0 && views.shared.length === 0;

  return (
    <section aria-labelledby="sidebar-views-heading" className="mt-4">
      <h2
        id="sidebar-views-heading"
        className="px-3 py-1 text-[12px] font-semibold text-sidebar-foreground/70"
      >
        Views
      </h2>
      {isEmpty ? (
        <p className="px-3 py-1 text-[12px] text-sidebar-foreground/70">{VIEWS_EMPTY}</p>
      ) : (
        <>
          <ViewGroup
            id="sidebar-views-private"
            label="Private"
            items={views.private}
            activeId={activeId}
          />
          <ViewGroup
            id="sidebar-views-shared"
            label="Shared"
            items={views.shared}
            activeId={activeId}
          />
        </>
      )}
    </section>
  );
}
