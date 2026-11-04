/**
 * Workspace logo through the real UI (Phase 9 plan 09-07, AIDA-34, D-10, D-11, UI-SPEC
 * Surfaces 1 to 3). The images are built here at runtime (no committed binary): `realPng` is a
 * decodable PNG with real pixel data, so the browser renders it; the upload route (plan 09-05)
 * sniffs the bytes and reads the header dimensions.
 *
 * Shared state: the E2E organization has at most one logo. Every test sets the state it needs
 * through the admin API first, and afterAll removes the logo so later spec files see none.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { type APIRequestContext, type Page, request as playwrightRequest } from "@playwright/test";
import { expect, test } from "./support/fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_STORAGE = path.resolve(__dirname, ".auth/admin.json");

const LOGO_ROUTE = "/api/settings/branding/logo";
const WORKSPACE_NAME = "AIDA E2E";

test.use({ storageState: ADMIN_STORAGE });

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** A decodable RGBA PNG of one colour (filter byte 0 per row, zlib-deflated IDAT). */
function realPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x += 1) row.set(rgba, 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const LOGO_A = {
  name: "logo-a.png",
  mimeType: "image/png",
  buffer: realPng(96, 32, [79, 70, 229, 255]),
};

async function adminApi(baseURL: string | undefined): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL, storageState: ADMIN_STORAGE });
}

/** Removes the logo through the admin route; the first hit may be the router compiling (404). */
async function clearLogo(api: APIRequestContext): Promise<void> {
  await expect
    .poll(async () => (await api.delete(LOGO_ROUTE)).status(), { timeout: 30_000 })
    .toBe(200);
}

/** The sidebar brand mark (the first brand mark inside the app shell's aside). */
function sidebarBrand(page: Page) {
  return page.locator("aside [data-slot='brand-mark']");
}

test.describe("Workspace logo", () => {
  test.afterAll(async ({ baseURL }) => {
    const api = await adminApi(baseURL);
    await clearLogo(api);
    await api.dispose();
  });

  test("upload: an admin uploads a logo and the sidebar shows it next to the name", async ({
    page,
    baseURL,
  }) => {
    const api = await adminApi(baseURL);
    await clearLogo(api);
    await api.dispose();

    await page.goto("/settings/branding");
    await expect(
      page.getByText("No logo uploaded. The sidebar and public pages show the default icon."),
    ).toBeVisible();
    await expect(sidebarBrand(page)).toHaveAttribute("data-state", "fallback");
    await expect(sidebarBrand(page).locator("img")).toHaveCount(0);

    await page.getByLabel("Logo file").setInputFiles(LOGO_A);
    await expect(page.getByText("Logo uploaded.")).toBeVisible({ timeout: 15_000 });

    // The sidebar re-renders through router.refresh(): the logo appears beside the visible name.
    await expect
      .poll(async () => sidebarBrand(page).locator("img").getAttribute("src"), { timeout: 15_000 })
      .toMatch(/^\/api\/public\/logo\//);
    await expect(sidebarBrand(page).getByText(WORKSPACE_NAME)).toBeVisible();
    await expect(sidebarBrand(page)).toHaveAttribute("data-state", "logo");
    // The image actually decoded from the public route (not a broken image).
    await expect
      .poll(async () =>
        sidebarBrand(page)
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
      )
      .toBe(96);
  });
});
