/**
 * Workspace logo through the real UI (Phase 9 plan 09-07, AIDA-34, D-10, D-11, UI-SPEC
 * Surfaces 1 to 3): upload, replace, the SVG, size and dimension refusals, remove, the fallback
 * for a logo that fails to load, the public request and status pages, and the member and
 * unauthenticated refusals of the upload route through real sessions.
 *
 * The images are built here at runtime (no committed binary). `realPng` is a decodable PNG with
 * real pixel data, so the browser renders it. A header-only PNG (tests/support/logo-images.ts
 * `pngBytes`) does not exercise the fallback: Chrome loads it from its header without an error
 * event. The fallback case therefore stores a reference whose file is gone, so the public route
 * answers 404 (plan 09-05 readCurrentLogo) and the image fails to load.
 *
 * Shared state: the E2E organization has at most one logo. Every test sets the state it needs
 * through the admin API first, and afterAll removes the logo so later spec files see none.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { type APIRequestContext, type Page, request as playwrightRequest } from "@playwright/test";
import { padTo } from "../support/logo-images";
import { createTicket, orgId, prisma } from "./support/db";
import { expect, requireBrowser, test } from "./support/fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_STORAGE = path.resolve(__dirname, ".auth/admin.json");
const MEMBER_STORAGE = path.resolve(__dirname, ".auth/member.json");

const LOGO_ROUTE = "/api/settings/branding/logo";
const WORKSPACE_NAME = "AIDA E2E";

const COPY = {
  empty: "No logo uploaded. The sidebar and public pages show the default icon.",
  adminOnly: "Only workspace admins can change the logo.",
  svg: "SVG logos are not accepted. Export the logo as PNG or WebP and upload that file.",
  tooLarge: "This file is larger than 1 MiB. Export a smaller version, then upload it again.",
  tooManyPixels: "This image is larger than 1024 × 1024 pixels. Resize it, then upload it again.",
};

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

type UploadFile = { name: string; mimeType: string; buffer: Buffer };

const LOGO_A: UploadFile = {
  name: "logo-a.png",
  mimeType: "image/png",
  buffer: realPng(96, 32, [79, 70, 229, 255]),
};
const LOGO_B: UploadFile = {
  name: "logo-b.png",
  mimeType: "image/png",
  buffer: realPng(48, 48, [16, 185, 129, 255]),
};
const SVG_MARKUP = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
);

function logoUrl(version: string): string {
  return `/api/public/logo/${encodeURIComponent(orgId)}/${version}`;
}

async function apiContext(baseURL: string | undefined, storageState?: string) {
  return playwrightRequest.newContext({ baseURL, storageState });
}

/** Removes the logo through the admin route; the first hit may be the router compiling (404). */
async function clearLogo(api: APIRequestContext): Promise<void> {
  await expect
    .poll(async () => (await api.delete(LOGO_ROUTE)).status(), { timeout: 30_000 })
    .toBe(200);
}

/** Uploads a logo through the admin route and returns its version. */
async function setLogo(api: APIRequestContext, file: UploadFile = LOGO_A): Promise<string> {
  let version = "";
  await expect
    .poll(
      async () => {
        const res = await api.post(LOGO_ROUTE, { multipart: { file } });
        if (res.status() === 200) version = ((await res.json()) as { version: string }).version;
        return res.status();
      },
      { timeout: 30_000 },
    )
    .toBe(200);
  return version;
}

async function withAdminApi<T>(
  baseURL: string | undefined,
  run: (api: APIRequestContext) => Promise<T>,
): Promise<T> {
  const api = await apiContext(baseURL, ADMIN_STORAGE);
  try {
    return await run(api);
  } finally {
    await api.dispose();
  }
}

/** The stored `branding:logo` value of the E2E organization, or null. */
async function storedLogo(): Promise<string | null> {
  const row = await prisma.setting.findFirst({
    where: { organizationId: orgId, key: "branding:logo" },
  });
  return row?.value ?? null;
}

/** The sidebar brand mark inside the app shell's aside. */
function sidebarBrand(page: Page) {
  return page.locator("aside [data-slot='brand-mark']");
}

/** The Logo card on Settings > Branding. */
function logoCard(page: Page) {
  return page
    .locator("[data-slot='card']")
    .filter({ has: page.getByRole("heading", { name: "Logo", exact: true }) });
}

/** Counts the upload requests the page sends (a client-side refusal must send none). */
function countUploads(page: Page): { posts: number } {
  const counter = { posts: 0 };
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === LOGO_ROUTE) counter.posts += 1;
  });
  return counter;
}

test.describe("Workspace logo", () => {
  test.afterAll(async ({ baseURL }) => {
    await withAdminApi(baseURL, clearLogo);
  });

  test("upload: an admin uploads a logo and the sidebar shows it next to the name", async ({
    page,
    baseURL,
  }) => {
    await withAdminApi(baseURL, clearLogo);

    await page.goto("/settings/branding");
    await expect(logoCard(page).getByText(COPY.empty)).toBeVisible();
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
    // The card's populated state and the Name-card preview show the same logo.
    await expect(logoCard(page).getByRole("img", { name: "Current workspace logo" })).toBeVisible();
    await expect(logoCard(page).getByRole("button", { name: "Replace logo" })).toBeVisible();
    await expect(logoCard(page).getByRole("button", { name: "Remove logo" })).toBeVisible();
    await expect(page.locator("main [data-slot='brand-mark'][data-state='logo']")).toHaveCount(1);
  });

  test("replace: a second logo replaces the first and the versioned sidebar URL changes", async ({
    page,
    baseURL,
  }) => {
    const first = await withAdminApi(baseURL, (api) => setLogo(api, LOGO_A));

    await page.goto("/settings/branding");
    await expect(sidebarBrand(page).locator("img")).toHaveAttribute("src", logoUrl(first));

    await page.getByLabel("Logo file").setInputFiles(LOGO_B);
    await expect(page.getByText("Logo replaced.")).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => sidebarBrand(page).locator("img").getAttribute("src"), { timeout: 15_000 })
      .not.toBe(logoUrl(first));

    const stored = JSON.parse((await storedLogo()) ?? "null") as { version: string } | null;
    expect(stored).not.toBeNull();
    await expect(sidebarBrand(page).locator("img")).toHaveAttribute(
      "src",
      logoUrl(stored?.version ?? ""),
    );
    await expect
      .poll(async () =>
        sidebarBrand(page)
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
      )
      .toBe(48);
  });

  test("svg: an SVG pick shows the SVG error and the stored logo stays", async ({
    page,
    baseURL,
  }) => {
    const version = await withAdminApi(baseURL, (api) => setLogo(api, LOGO_A));
    const before = await storedLogo();
    const uploads = countUploads(page);

    await page.goto("/settings/branding");
    await page
      .getByLabel("Logo file")
      .setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: SVG_MARKUP });
    await expect(logoCard(page).getByRole("alert")).toHaveText(COPY.svg);
    expect(uploads.posts).toBe(0); // refused before sending

    // The same markup named and typed as a PNG passes the client pre-check; the server's byte
    // sniffing refuses it with the svg code, which shows the same copy.
    await page
      .getByLabel("Logo file")
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: SVG_MARKUP });
    await expect.poll(() => uploads.posts).toBe(1);
    await expect(logoCard(page).getByRole("alert")).toHaveCount(1);
    await expect(logoCard(page).getByRole("alert")).toHaveText(COPY.svg);

    expect(await storedLogo()).toBe(before);
    await expect(sidebarBrand(page).locator("img")).toHaveAttribute("src", logoUrl(version));
  });

  test("oversize: a file over 1 MiB shows the 1 MiB error and sends no request", async ({
    page,
    baseURL,
  }) => {
    await withAdminApi(baseURL, clearLogo);
    const uploads = countUploads(page);

    await page.goto("/settings/branding");
    const big = padTo(realPng(8, 8, [0, 0, 0, 255]), 1_048_577);
    await page
      .getByLabel("Logo file")
      .setInputFiles({ name: "big.png", mimeType: "image/png", buffer: big });
    await expect(logoCard(page).getByRole("alert")).toHaveText(COPY.tooLarge);
    expect(uploads.posts).toBe(0);
    expect(await storedLogo()).toBeNull();

    // The next pick replaces the error row (exactly one), and a good pick clears it.
    await page
      .getByLabel("Logo file")
      .setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: SVG_MARKUP });
    await expect(logoCard(page).getByRole("alert")).toHaveCount(1);
    await expect(logoCard(page).getByRole("alert")).toHaveText(COPY.svg);
    await page.getByLabel("Logo file").setInputFiles(LOGO_A);
    await expect(page.getByText("Logo uploaded.")).toBeVisible({ timeout: 15_000 });
    await expect(logoCard(page).getByRole("alert")).toHaveCount(0);
    expect(uploads.posts).toBe(1);
  });

  test("too many pixels: the server's refusal code picks its copy and stores nothing", async ({
    page,
    baseURL,
  }) => {
    await withAdminApi(baseURL, clearLogo);
    const uploads = countUploads(page);

    await page.goto("/settings/branding");
    await page.getByLabel("Logo file").setInputFiles({
      name: "wide.png",
      mimeType: "image/png",
      buffer: realPng(1025, 1, [0, 0, 0, 255]),
    });
    await expect(logoCard(page).getByRole("alert")).toHaveText(COPY.tooManyPixels, {
      timeout: 15_000,
    });
    expect(uploads.posts).toBe(1);
    expect(await storedLogo()).toBeNull();
    await expect(logoCard(page).getByText(COPY.empty)).toBeVisible();
  });

  test("remove: removing through the dialog shows the Sparkles fallback and the empty line", async ({
    page,
    baseURL,
  }) => {
    await withAdminApi(baseURL, (api) => setLogo(api, LOGO_A));

    await page.goto("/settings/branding");
    await expect(sidebarBrand(page)).toHaveAttribute("data-state", "logo");

    // "Keep logo" closes the dialog and changes nothing.
    await logoCard(page).getByRole("button", { name: "Remove logo" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove the workspace logo?" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(
        "The sidebar and your public pages will show the default icon next to the workspace name. You can upload a logo again at any time.",
      ),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Keep logo" }).click();
    await expect(dialog).toBeHidden();
    expect(await storedLogo()).not.toBeNull();

    await logoCard(page).getByRole("button", { name: "Remove logo" }).click();
    await dialog.getByRole("button", { name: "Remove logo" }).click();
    await expect(page.getByText("Logo removed.")).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toBeHidden();

    await expect(sidebarBrand(page)).toHaveAttribute("data-state", "fallback", { timeout: 15_000 });
    await expect(sidebarBrand(page).locator("img")).toHaveCount(0);
    await expect(sidebarBrand(page).locator("svg")).toHaveCount(1);
    await expect(sidebarBrand(page).getByText(WORKSPACE_NAME)).toBeVisible();
    await expect(logoCard(page).getByText(COPY.empty)).toBeVisible();
    await expect(logoCard(page).getByRole("button", { name: "Upload logo" })).toBeVisible();
    expect(await storedLogo()).toBeNull();
  });

  test("fallback: a logo that fails to load falls back to the Sparkles box", async ({
    page,
    baseURL,
  }) => {
    await withAdminApi(baseURL, clearLogo);
    // A well-formed reference whose stored file does not exist (a lost file): the layout builds
    // its versioned URL and the public route answers 404 for it. Removed directly afterwards, so
    // no cleanup row is queued for a key that never had a file.
    const version = "0123456789ab";
    await prisma.setting.create({
      data: {
        organizationId: orgId,
        key: "branding:logo",
        value: JSON.stringify({ storageKey: "e2emissing.png", mimeType: "image/png", version }),
      },
    });
    try {
      const anonApi = await apiContext(baseURL);
      expect((await anonApi.get(logoUrl(version))).status()).toBe(404);
      await anonApi.dispose();

      await page.goto("/tickets");
      await expect(sidebarBrand(page)).toHaveAttribute("data-state", "fallback", {
        timeout: 15_000,
      });
      await expect(sidebarBrand(page).locator("img")).toHaveCount(0);
      await expect(sidebarBrand(page).locator("svg")).toHaveCount(1);
      await expect(sidebarBrand(page).getByText(WORKSPACE_NAME)).toBeVisible();
    } finally {
      await prisma.setting.deleteMany({ where: { organizationId: orgId, key: "branding:logo" } });
    }
  });

  test("request page: shows the logo when set and the Sparkles box when not", async ({
    context,
    baseURL,
  }) => {
    const version = await withAdminApi(baseURL, (api) => setLogo(api, LOGO_A));

    const anon = await requireBrowser(context).newContext({ baseURL });
    const publicPage = await anon.newPage();
    await publicPage.goto("/request");
    const brand = publicPage.locator("[data-slot='brand-mark']");
    await expect(brand).toHaveCount(1);
    await expect(brand.locator("img")).toHaveAttribute("src", logoUrl(version));
    await expect(brand.getByText(WORKSPACE_NAME)).toBeVisible();
    await expect
      .poll(async () =>
        brand.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
      )
      .toBe(96);

    await withAdminApi(baseURL, clearLogo);
    await publicPage.reload();
    await expect(brand).toHaveAttribute("data-state", "fallback");
    await expect(brand.locator("img")).toHaveCount(0);
    await expect(brand.getByText(WORKSPACE_NAME)).toBeVisible();
    await anon.close();
  });

  test("valid status: a valid token shows the ticket organization's logo and name", async ({
    context,
    baseURL,
  }) => {
    const version = await withAdminApi(baseURL, (api) => setLogo(api, LOGO_A));
    const ticket = await createTicket(orgId, {
      subject: `E2E logo status ${Date.now()}`,
      priority: "NORMAL",
      body: "Status page logo check.",
      contact: { email: `logo-status-${Date.now()}@example.com` },
      direction: "INBOUND",
    });

    const anon = await requireBrowser(context).newContext({ baseURL });
    const publicPage = await anon.newPage();
    await publicPage.goto(`/status/${ticket.statusToken}`);
    await expect(publicPage.getByText("Status page logo check.")).toBeVisible();
    const brand = publicPage.locator("[data-slot='brand-mark']");
    await expect(brand).toHaveCount(1);
    await expect(brand.locator("img")).toHaveAttribute("src", logoUrl(version));
    await expect(brand.getByText(WORKSPACE_NAME)).toBeVisible();
    await anon.close();
  });

  test("invalid status: an invalid token renders no brand row, no image and no workspace name", async ({
    context,
    baseURL,
  }) => {
    await withAdminApi(baseURL, (api) => setLogo(api, LOGO_A));

    const anon = await requireBrowser(context).newContext({ baseURL });
    const publicPage = await anon.newPage();
    await publicPage.goto("/status/not-a-real-status-token");
    await expect(
      publicPage.getByRole("heading", { name: "We couldn't find that ticket" }),
    ).toBeVisible();
    await expect(publicPage.locator("[data-slot='brand-mark']")).toHaveCount(0);
    await expect(publicPage.locator("img")).toHaveCount(0);
    await expect(publicPage.getByText(WORKSPACE_NAME)).toHaveCount(0);
    await anon.close();
  });

  test("member refused: no logo buttons, and POST and DELETE answer 403 not_allowed", async ({
    context,
    baseURL,
  }) => {
    await withAdminApi(baseURL, (api) => setLogo(api, LOGO_A));
    const before = await storedLogo();

    const memberContext = await requireBrowser(context).newContext({
      baseURL,
      storageState: MEMBER_STORAGE,
    });
    const memberPage = await memberContext.newPage();
    await memberPage.goto("/settings/branding");
    const card = logoCard(memberPage);
    await expect(card.getByText(COPY.adminOnly, { exact: true })).toBeVisible();
    await expect(card.getByRole("img", { name: "Current workspace logo" })).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(card.locator("input[type='file']")).toHaveCount(0);
    await memberContext.close();

    const memberApi = await apiContext(baseURL, MEMBER_STORAGE);
    const post = await memberApi.post(LOGO_ROUTE, { multipart: { file: LOGO_B } });
    expect(post.status()).toBe(403);
    expect(await post.json()).toEqual({ code: "not_allowed" });
    const del = await memberApi.delete(LOGO_ROUTE);
    expect(del.status()).toBe(403);
    expect(await del.json()).toEqual({ code: "not_allowed" });
    await memberApi.dispose();

    expect(await storedLogo()).toBe(before);
  });

  test("unauthenticated refused: POST and DELETE without a session answer 401", async ({
    baseURL,
  }) => {
    await withAdminApi(baseURL, (api) => setLogo(api, LOGO_A));
    const before = await storedLogo();

    const anonApi = await apiContext(baseURL);
    const post = await anonApi.post(LOGO_ROUTE, { multipart: { file: LOGO_B } });
    expect(post.status()).toBe(401);
    const del = await anonApi.delete(LOGO_ROUTE);
    expect(del.status()).toBe(401);
    await anonApi.dispose();

    expect(await storedLogo()).toBe(before);
  });

  test("public logo URL: answers the image with its content type and nosniff", async ({
    baseURL,
  }) => {
    const version = await withAdminApi(baseURL, (api) => setLogo(api, LOGO_A));

    const anonApi = await apiContext(baseURL);
    const res = await anonApi.get(logoUrl(version));
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(await res.body()).equals(LOGO_A.buffer)).toBe(true);
    await anonApi.dispose();
  });
});
