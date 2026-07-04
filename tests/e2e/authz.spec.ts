import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe("Unauthenticated access", () => {
  test("visiting /tickets without a session redirects to /login", async ({ page }) => {
    await page.goto("/tickets");
    await page.waitForURL(/\/login/);
    // shadcn's CardTitle renders as a styled <div>, not a semantic heading — assert by text.
    await expect(page.getByText("Sign in to AIDA")).toBeVisible();
  });
});

test.describe("Non-admin member", () => {
  test.use({ storageState: path.resolve(__dirname, ".auth/member.json") });

  test("cannot save SLA targets — server-side authz rejects the mutation", async ({ page }) => {
    const before = await prisma.slaPolicy.count({ where: { organizationId: orgId } });

    await page.goto("/settings/sla");
    const firstInput = page.getByLabel("First response (hours)").first();
    await firstInput.fill("13");
    await page.getByRole("button", { name: "Save SLA Targets" }).click();

    await expect(page.getByText("Failed to save SLA targets. Please try again.")).toBeVisible();

    const after = await prisma.slaPolicy.count({ where: { organizationId: orgId } });
    expect(after).toBe(before);
  });
});
