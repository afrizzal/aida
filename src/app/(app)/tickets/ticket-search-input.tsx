"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

const DEBOUNCE_MS = 300;

/**
 * Full-text search box for the ticket inbox. Self-contained — reads/writes the `q`
 * searchParam directly so FilterChipRow doesn't need to thread search state through.
 * Debounced so every keystroke doesn't trigger a server re-fetch.
 */
export function TicketSearchInput() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.get("q") ?? "";
  const [value, setValue] = useState(currentQuery);

  // Keep local state in sync when the URL changes from elsewhere (browser back/forward,
  // another filter control clearing `q`, etc.) without fighting the debounce below.
  useEffect(() => {
    setValue(currentQuery);
  }, [currentQuery]);

  useEffect(() => {
    if (value === currentQuery) return;

    const timeout = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("q", value.trim());
      } else {
        params.delete("q");
      }
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [value, currentQuery, searchParams, pathname, router]);

  return (
    <InputGroup className="h-8 w-full">
      <InputGroupAddon>
        <Search className="size-4" />
      </InputGroupAddon>
      <InputGroupInput
        placeholder="Search tickets…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </InputGroup>
  );
}
