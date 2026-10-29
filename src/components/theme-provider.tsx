"use client";

import { setNonce } from "get-nonce";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  // D-11/D-12: Radix scroll lock (react-remove-scroll) injects <style> tags through
  // react-style-singleton, which stamps the nonce it reads from get-nonce. Without this the
  // strict style-src-elem blocks those tags (plan 08-08 E2E). Set at render time so it runs
  // before any child effect injects a style. Browser only: on the server get-nonce's module
  // state would be shared across requests and leak one response's nonce into another.
  if (typeof window !== "undefined" && typeof props.nonce === "string" && props.nonce !== "") {
    setNonce(props.nonce);
  }
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
