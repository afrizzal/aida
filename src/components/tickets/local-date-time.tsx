"use client";

import { useEffect, useState } from "react";

// UI-SPEC 4a (D-12): times are stored in UTC and shown in the viewer's browser time zone. The
// server render and the first client render use the UTC form so hydration matches; after mount
// the same formatter runs in the browser zone. The title holds the full form with the zone name.
const BASE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};

export function formatLocalDateTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { ...BASE_OPTIONS, timeZone }).format(date);
}

function formatUtc(date: Date): string {
  return `${formatLocalDateTime(date, "UTC")} UTC`;
}

function formatFull(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    ...BASE_OPTIONS,
    year: "numeric",
    timeZone,
    timeZoneName: "short",
  }).format(date);
}

export function LocalDateTime({ value, className }: { value: Date | string; className?: string }) {
  const date = typeof value === "string" ? new Date(value) : value;
  const [local, setLocal] = useState<{ text: string; title: string } | null>(null);
  const iso = date.toISOString();

  useEffect(() => {
    const at = new Date(iso);
    setLocal({ text: formatLocalDateTime(at), title: formatFull(at) });
  }, [iso]);

  return (
    <time dateTime={iso} title={local?.title ?? formatFull(date, "UTC")} className={className}>
      {local?.text ?? formatUtc(date)}
    </time>
  );
}
