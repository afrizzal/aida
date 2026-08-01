export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapFromEnv } = await import("@/lib/bootstrap");
    await bootstrapFromEnv();
    // Demo mode is a no-op unless DEMO_MODE === "true"; imported lazily so the demo
    // fixtures never load in a normal production boot.
    const { bootstrapDemoMode } = await import("@/lib/demo/bootstrap-demo");
    await bootstrapDemoMode();
  }
}
