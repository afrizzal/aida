"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { onNavigationStart } from "@/lib/navigation/navigation-start";

interface ContactSearchProps {
  defaultValue?: string;
}

export function ContactSearch({ defaultValue = "" }: ContactSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const currentQuery = useSearchParams().get("q") ?? "";
  const [value, setValue] = useState(defaultValue);
  // Queries this box sent to the URL that have not landed yet. A URL change that is not one of
  // them came from outside (the sidebar link, a palette command, back/forward).
  const requested = useRef(new Set<string>());

  useEffect(() => {
    // The URL is the source of truth when it changes from outside: adopt it, so the debounced
    // replace below does not navigate back to the old text (review WR-01). The page stays
    // mounted across a same-route navigation, so the typed text would otherwise survive it.
    if (requested.current.delete(currentQuery)) return;
    requested.current.clear();
    setValue(currentQuery);
  }, [currentQuery]);

  useEffect(() => {
    // Navigate only when the search text differs from the URL. The /contacts page stays
    // mounted until a navigation away commits, so an unconditional replace 300 ms after mount
    // overrode a navigation started in that window (the palette's Create ticket landed back
    // on /contacts).
    const next = value.trim();
    if (next === currentQuery) return;
    const handle = setTimeout(() => {
      const params = new URLSearchParams();
      if (next) params.set("q", next);
      const query = params.toString();
      requested.current.add(next);
      router.replace(query ? `${pathname}?${query}` : pathname);
    }, 300);
    // Any navigation that starts inside the 300 ms window wins: drop the pending search, so it
    // cannot replace the URL while the page stays mounted until that navigation commits (Codex
    // diff critique D4). The search's own replace also starts a navigation, but only after the
    // timer has fired, so clearing it then is a no-op.
    const stop = onNavigationStart(() => clearTimeout(handle));

    return () => {
      clearTimeout(handle);
      stop();
    };
  }, [value, currentQuery, pathname, router]);

  return (
    <div className="relative max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search contacts…"
        className="pl-8"
        aria-label="Search contacts"
      />
    </div>
  );
}
