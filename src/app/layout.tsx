import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "AIDA",
  description: "Open-source, AI-native, self-hostable helpdesk",
};

// The proxy sets `x-nonce` on every forwarded request (D-11, D-12); next-themes stamps it on its
// inline theme script and transition style. Reading headers() here makes every page dynamic,
// which nonces require (D-13).
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
