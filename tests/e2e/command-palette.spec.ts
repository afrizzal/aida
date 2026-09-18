// Phase 11, plan 11-07: the command palette (AIDA-49, D-11, D-12, D-23; UI-SPEC Surface 4).
// Each case asserts what an agent observes in the palette and where a choice lands, never a
// keystroke script. Tickets carry a token unique to the run, so other specs' rows never match.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_EMAIL } from "./global-setup";
import { createTicket, orgId, prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();

async function seedTicket(token: string) {
  const subject = `E2E Palette ${token} subject`;
  const ticket = await createTicket(orgId, {
    subject,
    priority: "NORMAL",
    body: `Seed body ${token}`,
    contact: { email: `palette-${token}@example.com` },
    direction: "INBOUND",
  });
  return { id: ticket.id, number: ticket.number, subject };
}

function palette(page: Page) {
  return page.getByRole("dialog", { name: "Command palette" });
}

/** Opens a route, polling past a first-hit 404 while next dev compiles it. */
async function openRoute(page: Page, route: string) {
  await expect
    .poll(async () => {
      const response = await page.goto(route);
      return response?.status() ?? 0;
    })
    .toBe(200);
}

/**
 * next dev compiles /api/palette/tickets on its first hit and can answer a transient 404 before
 * that; the palette would then show its search-error row. Warm it with the page's session first.
 */
async function warmPaletteSearch(page: Page) {
  await expect
    .poll(async () => (await page.request.get("/api/palette/tickets?q=warm")).status())
    .toBe(200);
}

/** Warms a page route, so a later client navigation to it does not wait on its first compile. */
async function warmRoute(page: Page, route: string) {
  await expect.poll(async () => (await page.request.get(route)).status()).toBe(200);
}

/**
 * Opens the palette from the top-bar trigger. Retried, because a click that lands before
 * hydration has no handler yet; a click that opened the palette ends the retry.
 */
async function openPalette(page: Page) {
  const trigger = page.getByRole("banner").getByRole("button", { name: "Search" });
  await expect(async () => {
    if (!(await palette(page).isVisible())) await trigger.click();
    await expect(palette(page)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

function paletteInput(page: Page) {
  return palette(page).getByRole("combobox");
}

function group(page: Page, heading: string) {
  return palette(page).getByRole("group", { name: heading });
}

const SAVE_COMMAND = "Save these filters as a view…";
const isPaletteSearch = (url: URL) => url.pathname === "/api/palette/tickets";

async function userIdOf(email: string): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true } });
  return user.id;
}

const seededViewNames: string[] = [];

test.describe("Command palette", () => {
  test.beforeEach(async ({ page }) => {
    await warmPaletteSearch(page);
  });

  test.afterAll(async () => {
    await prisma.savedView.deleteMany({
      where: { organizationId: orgId, name: { in: seededViewNames } },
    });
  });

  test("finds a ticket from the top-bar trigger and opens it", async ({ page }) => {
    const token = `paltracer${ts}`;
    const ticket = await seedTicket(token);

    await openRoute(page, "/tickets");
    await openPalette(page);
    await palette(page).getByRole("combobox").fill(token);

    const option = palette(page).getByRole("option").filter({ hasText: ticket.subject });
    await expect(option).toBeVisible();
    await expect(option).toContainText(`#${ticket.number}`);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.id}$`));
    await expect(palette(page)).toBeHidden();
  });

  test("Go to lists the other sidebar sections, never the current one, and navigates", async ({
    page,
  }) => {
    await warmRoute(page, "/contacts");
    await openRoute(page, "/tickets");
    await openPalette(page);

    const goTo = group(page, "Go to");
    for (const label of ["Contacts", "Knowledge Base", "Insight", "Settings"]) {
      await expect(goTo.getByRole("option", { name: label, exact: true })).toBeVisible();
    }
    await expect(goTo.getByRole("option", { name: "Tickets", exact: true })).toHaveCount(0);

    await goTo.getByRole("option", { name: "Contacts", exact: true }).click();
    await expect(page).toHaveURL(/\/contacts$/);
    await expect(palette(page)).toBeHidden();
  });

  test("Create ticket from another page goes to the inbox and opens the New Ticket dialog", async ({
    page,
  }) => {
    await warmRoute(page, "/tickets");
    await openRoute(page, "/contacts");
    await openPalette(page);

    await group(page, "Create").getByRole("option", { name: "Create ticket", exact: true }).click();

    await expect(page.getByRole("dialog", { name: "New Ticket" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(palette(page)).toBeHidden();
  });

  test("Create ticket on the inbox opens the dialog over the page, with the palette already closed", async ({
    page,
  }) => {
    await openRoute(page, "/tickets");
    // The dialog's opener registers once the list panel (and its New Ticket button) is mounted.
    await expect(page.getByRole("button", { name: "New Ticket" })).toBeVisible();
    await openPalette(page);

    await group(page, "Create").getByRole("option", { name: "Create ticket", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "New Ticket" });
    await expect(dialog).toBeVisible();
    await expect(palette(page)).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page).toHaveURL(/\/tickets$/);
    await dialog.getByLabel("Subject").fill("Typed into the new dialog");
    await expect(dialog.getByLabel("Subject")).toHaveValue("Typed into the new dialog");
  });

  test("two views with the same name both appear, each with its own label, and each opens itself", async ({
    page,
  }) => {
    const name = `E2E palette view ${ts}`;
    seededViewNames.push(name);
    const ownerUserId = await userIdOf(ADMIN_EMAIL);
    const filters = { version: 1, view: "all", statuses: ["OPEN"] };
    const privateView = await prisma.savedView.create({
      data: {
        organizationId: orgId,
        ownerUserId,
        name,
        visibility: "PRIVATE",
        filters,
        position: 0,
      },
      select: { id: true },
    });
    const sharedView = await prisma.savedView.create({
      data: {
        organizationId: orgId,
        ownerUserId,
        name,
        visibility: "SHARED",
        filters,
        position: 0,
      },
      select: { id: true },
    });

    await openRoute(page, "/tickets");
    await openPalette(page);
    await paletteInput(page).fill(name);

    const views = group(page, "Views");
    const matching = views.getByRole("option").filter({ hasText: name });
    await expect(matching).toHaveCount(2);
    await expect(matching.filter({ hasText: "Private" })).toHaveCount(1);
    await expect(matching.filter({ hasText: "Shared" })).toHaveCount(1);

    await matching.filter({ hasText: "Shared" }).click();
    await expect(page).toHaveURL(new RegExp(`sv=${sharedView.id}`));
    await expect(page).not.toHaveURL(new RegExp(`sv=${privateView.id}`));
    await expect(palette(page)).toBeHidden();
  });

  test("the save command exists only with a filter set and opens the Save view dialog", async ({
    page,
  }) => {
    await openRoute(page, "/tickets?status=OPEN");
    // The command is registered by the filter row; wait until its Save view button is enabled.
    await expect(page.getByRole("button", { name: "Save these filters as a view" })).toBeEnabled();
    await openPalette(page);

    const save = group(page, "Views").getByRole("option", { name: SAVE_COMMAND });
    await expect(save).toBeVisible();
    await save.click();
    await expect(page.getByRole("dialog", { name: "Save view" })).toBeVisible();
    await expect(palette(page)).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(1);

    await openRoute(page, "/tickets");
    await expect(page.getByRole("button", { name: "Save these filters as a view" })).toBeDisabled();
    await openPalette(page);
    await expect(group(page, "Go to")).toBeVisible();
    await expect(palette(page).getByRole("option", { name: SAVE_COMMAND })).toHaveCount(0);
  });

  test("shows 'No tickets match' for an unmatched search and 'Nothing matches' when nothing at all matches", async ({
    page,
  }) => {
    const queries: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (isPaletteSearch(url)) queries.push(url.searchParams.get("q") ?? "");
    });

    await openRoute(page, "/tickets");
    await openPalette(page);

    // One character: no ticket request, no Tickets group, and no command matches "~".
    await paletteInput(page).fill("~");
    await expect(palette(page).getByText('Nothing matches "~".')).toBeVisible();
    await expect(group(page, "Tickets")).toHaveCount(0);
    // Longer than the 300 ms debounce, so a request for "~" would have been sent by now.
    await page.waitForTimeout(600);
    expect(queries).toEqual([]);

    const token = `palnone${ts}`;
    await paletteInput(page).fill(token);
    await expect(group(page, "Tickets").getByText(`No tickets match "${token}".`)).toBeVisible();
    await expect(palette(page).getByText(/Nothing matches/)).toHaveCount(0);
    expect(queries).toEqual([token]);
  });

  test("shows 'Searching tickets…' while the first response is pending and the error row when search is refused, while other groups keep working", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(isPaletteSearch, async (route) => {
      await held;
      await route
        .fulfill({ status: 403, json: { error: "membership_ended" } })
        .catch(() => undefined);
    });

    await openRoute(page, "/tickets");
    await openPalette(page);
    await paletteInput(page).fill("contacts");

    const tickets = group(page, "Tickets");
    await expect(tickets.getByText("Searching tickets…")).toBeVisible();
    release();
    await expect(
      tickets.getByText("Ticket search is not available right now. Try again in a moment."),
    ).toBeVisible();
    await expect(tickets.getByText("Searching tickets…")).toHaveCount(0);

    await group(page, "Go to").getByRole("option", { name: "Contacts", exact: true }).click();
    await expect(page).toHaveURL(/\/contacts$/);
  });

  test("discards the response of an older query", async ({ page }) => {
    const stale = `palstale${ts}`;
    const fresh = `palfresh${ts}`;

    // A controlled fetch for the palette search endpoint (Codex diff critique D6). It ignores the
    // AbortSignal, so the older request is NOT cancelled when the query changes: its response
    // resolves after the newer one, only when the test releases it, and only the stale-response
    // guard in useTicketSearch can keep it off the screen. Every other request uses the real
    // fetch.
    await page.addInitScript(
      ({ staleQuery }) => {
        const realFetch = window.fetch.bind(window);
        const w = window as unknown as {
          __staleRequested: boolean;
          __releaseStale: () => void;
          __staleProcessed: Promise<void>;
        };
        w.__staleRequested = false;
        let release: () => void = () => {};
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        w.__releaseStale = release;
        let markProcessed: () => void = () => {};
        w.__staleProcessed = new Promise<void>((resolve) => {
          markProcessed = resolve;
        });
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            location.href,
          );
          if (url.pathname !== "/api/palette/tickets") return realFetch(input, init);
          const q = url.searchParams.get("q");
          if (q !== staleQuery) {
            return new Response(JSON.stringify({ results: [] }), {
              headers: { "content-type": "application/json" },
            });
          }
          w.__staleRequested = true;
          await held;
          const body = {
            results: [{ id: "stale-ticket", number: 99999, subject: `Stale ${q}`, status: "OPEN" }],
          };
          const response = new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
          });
          const json = response.json.bind(response);
          // The palette's code after `await response.json()` (results check, stale guard,
          // setSearch) runs before this timer, so the promise marks it as processed.
          response.json = async () => {
            const value = await json();
            setTimeout(markProcessed, 0);
            return value;
          };
          return response;
        };
      },
      { staleQuery: stale },
    );

    await openRoute(page, "/tickets");
    await openPalette(page);
    await paletteInput(page).fill(stale);
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __staleRequested: boolean }).__staleRequested),
      )
      .toBe(true);
    await paletteInput(page).fill(fresh);
    await expect(palette(page).getByText(`No tickets match "${fresh}".`)).toBeVisible();

    // The older response now resolves, after the newer one. Wait until the palette processed it
    // and React had time to commit any update it caused, then check the screen.
    await page.evaluate(async () => {
      const w = window as unknown as {
        __releaseStale: () => void;
        __staleProcessed: Promise<void>;
      };
      w.__releaseStale();
      await w.__staleProcessed;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await expect(palette(page).getByText(`Stale ${stale}`)).toHaveCount(0);
    await expect(palette(page).getByText("Searching tickets…")).toHaveCount(0);
    await expect(palette(page).getByText(`No tickets match "${fresh}".`)).toBeVisible();
  });
});
