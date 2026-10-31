"use client";

import { setNonce } from "get-nonce";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// K126 (review a-CR-a1): the browser fixes a document's CSP when the document loads, from the
// first HTML response. Every later RSC request (router.refresh(), a revalidating server action)
// renders the root layout again under a fresh proxy nonce, which the document never allowed.
// So the client keeps the nonce of the first render and ignores later props. Module state lives
// as long as the document does: a full navigation loads a new document, a new policy and a fresh
// copy of this module.
let documentNonce: string | undefined;

export function ThemeProvider({
  children,
  nonce,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  if (typeof window === "undefined") {
    // Server render: pass the request's nonce through and never touch module state, which would
    // be shared across requests and leak one response's nonce into another.
    return (
      <NextThemesProvider {...props} nonce={nonce}>
        {children}
      </NextThemesProvider>
    );
  }
  // D-11/D-12: Radix scroll lock (react-remove-scroll) injects <style> tags through
  // react-style-singleton, which stamps the nonce it reads from get-nonce. Without this the
  // strict style-src-elem blocks those tags (plan 08-08 E2E). Set at render time so it runs
  // before any child effect injects a style. next-themes gets the same first value for its
  // transition-disabling style.
  if (documentNonce === undefined && typeof nonce === "string" && nonce !== "") {
    documentNonce = nonce;
    setNonce(nonce);
  }
  return (
    <NextThemesProvider {...props} nonce={documentNonce}>
      {children}
    </NextThemesProvider>
  );
}
