// Decorative wrapper for all unauthenticated public pages (/request, /status/[token]).
// Mirrors (auth)/layout.tsx's dotted-grid + brand-glow background exactly, but renders
// {children} only — pages render their own PublicPageShell (brand mark + Card).
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:24px_24px]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-[-12%] size-[520px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]"
        aria-hidden
      />
      <div className="relative w-full">{children}</div>
    </div>
  );
}
