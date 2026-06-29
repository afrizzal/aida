export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrapFromEnv } = await import("@/lib/bootstrap");
    await bootstrapFromEnv();
  }
}
