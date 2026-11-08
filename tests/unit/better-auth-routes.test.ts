/**
 * Plan 10-15 (D-02, V-03, O-5, AIDA-43, threats T-10-06 and T-10-52): every HTTP route of the
 * Better Auth organization and admin plugins is refused by the proxy.
 *
 * The route list is read from the installed package, never typed from memory: the test locates
 * better-auth through module resolution, pins its version, scans the plugin files of its dist
 * output for every endpoint path (the conditional team and dynamic-role groups included), and
 * compares that set with the constant list below. An upgrade that adds, removes or renames a
 * route fails here until the list is re-read and the proxy block is re-checked. A second source,
 * the plugin factories themselves, confirms the same set at runtime.
 *
 * Read on 2026-11-13 from better-auth 1.7.20: 36 organization paths, 15 admin paths.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { admin, organization } from "better-auth/plugins";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

const BETTER_AUTH_VERSION = "1.7.20";
const EXPECTED_ORGANIZATION_COUNT = 36;
const EXPECTED_ADMIN_COUNT = 15;

const TEAM_NOTE =
  "team route: registered only when teams.enabled; closed so enabling cannot open it";
const ROLE_NOTE =
  "dynamic-role route: registered only when dynamicAccessControl.enabled; closed so enabling cannot open it";

type Plugin = "organization" | "admin";
type RouteEntry = { path: string; plugin: Plugin; note?: string };

/** Every endpoint path better-auth 1.7.20 defines for the two plugins, read from the package. */
const ROUTES: readonly RouteEntry[] = [
  // organization: routes/crud-org.mjs
  { path: "/organization/create", plugin: "organization" },
  { path: "/organization/check-slug", plugin: "organization" },
  { path: "/organization/update", plugin: "organization" },
  {
    path: "/organization/delete",
    plugin: "organization",
    note: "owner item 09-o3: closed by default (O-5)",
  },
  { path: "/organization/get-organization", plugin: "organization" },
  { path: "/organization/get-full-organization", plugin: "organization" },
  { path: "/organization/set-active", plugin: "organization" },
  { path: "/organization/list", plugin: "organization" },
  // organization: routes/crud-invites.mjs
  { path: "/organization/invite-member", plugin: "organization" },
  { path: "/organization/accept-invitation", plugin: "organization" },
  { path: "/organization/reject-invitation", plugin: "organization" },
  { path: "/organization/cancel-invitation", plugin: "organization" },
  { path: "/organization/get-invitation", plugin: "organization" },
  { path: "/organization/list-invitations", plugin: "organization" },
  { path: "/organization/list-user-invitations", plugin: "organization" },
  // organization: routes/crud-members.mjs (addMember has no path: server-only, no HTTP route)
  {
    path: "/organization/remove-member",
    plugin: "organization",
    note: "would bypass the D-09 owner floor",
  },
  { path: "/organization/update-member-role", plugin: "organization" },
  { path: "/organization/get-active-member", plugin: "organization" },
  {
    path: "/organization/leave",
    plugin: "organization",
    note: "would bypass the D-09 owner floor",
  },
  { path: "/organization/list-members", plugin: "organization" },
  { path: "/organization/get-active-member-role", plugin: "organization" },
  // organization: organization.mjs
  { path: "/organization/has-permission", plugin: "organization" },
  // organization: routes/crud-team.mjs (conditional group)
  { path: "/organization/create-team", plugin: "organization", note: TEAM_NOTE },
  { path: "/organization/remove-team", plugin: "organization", note: TEAM_NOTE },
  { path: "/organization/update-team", plugin: "organization", note: TEAM_NOTE },
  { path: "/organization/list-teams", plugin: "organization", note: TEAM_NOTE },
  { path: "/organization/set-active-team", plugin: "organization", note: TEAM_NOTE },
  { path: "/organization/list-user-teams", plugin: "organization", note: TEAM_NOTE },
  { path: "/organization/list-team-members", plugin: "organization", note: TEAM_NOTE },
  { path: "/organization/add-team-member", plugin: "organization", note: TEAM_NOTE },
  { path: "/organization/remove-team-member", plugin: "organization", note: TEAM_NOTE },
  // organization: routes/crud-access-control.mjs (conditional group)
  { path: "/organization/create-role", plugin: "organization", note: ROLE_NOTE },
  { path: "/organization/delete-role", plugin: "organization", note: ROLE_NOTE },
  { path: "/organization/list-roles", plugin: "organization", note: ROLE_NOTE },
  { path: "/organization/get-role", plugin: "organization", note: ROLE_NOTE },
  { path: "/organization/update-role", plugin: "organization", note: ROLE_NOTE },
  // admin: routes.mjs
  { path: "/admin/set-role", plugin: "admin" },
  { path: "/admin/get-user", plugin: "admin" },
  { path: "/admin/create-user", plugin: "admin" },
  { path: "/admin/update-user", plugin: "admin" },
  { path: "/admin/list-users", plugin: "admin" },
  { path: "/admin/list-user-sessions", plugin: "admin" },
  { path: "/admin/unban-user", plugin: "admin" },
  { path: "/admin/ban-user", plugin: "admin" },
  { path: "/admin/impersonate-user", plugin: "admin" },
  { path: "/admin/stop-impersonating", plugin: "admin" },
  { path: "/admin/revoke-user-session", plugin: "admin" },
  { path: "/admin/revoke-user-sessions", plugin: "admin" },
  { path: "/admin/remove-user", plugin: "admin" },
  { path: "/admin/set-user-password", plugin: "admin" },
  { path: "/admin/has-permission", plugin: "admin" },
];

/** Endpoints defined without a path (server-only, never routed over HTTP). */
const EXPECTED_PATHLESS_ENDPOINTS = 1; // organization addMember (routes/crud-members.mjs)

const require = createRequire(import.meta.url);

/** The installed better-auth package directory, found by walking up from its resolved entry. */
function betterAuthRoot(): string {
  // better-auth's "exports" map does not expose ./package.json, so resolve the main entry.
  let dir = path.dirname(require.resolve("better-auth"));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
        name?: string;
      };
      if (pkg.name === "better-auth") return dir;
    } catch {
      // no package.json at this level
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("better-auth package root not found");
    dir = parent;
  }
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (/\.(mjs|cjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

type Scan = { paths: string[]; pathless: number; other: string[] };

/** Every `createAuthEndpoint(...)` call in the given files, classified by its first argument. */
function scanEndpoints(files: string[]): Scan {
  const scan: Scan = { paths: [], pathless: 0, other: [] };
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/createAuthEndpoint\(\s*(\S)/g)) {
      const first = match[1];
      if (first === '"' || first === "'" || first === "`") {
        const literal = /^\s*["'`]([^"'`]*)["'`]/.exec(
          text.slice((match.index ?? 0) + "createAuthEndpoint(".length),
        );
        if (literal) scan.paths.push(literal[1]);
        else scan.other.push(`${path.basename(file)}: unreadable literal`);
      } else if (first === "{") {
        scan.pathless += 1;
      } else {
        scan.other.push(
          `${path.basename(file)}: ${text.slice(match.index ?? 0, (match.index ?? 0) + 60)}`,
        );
      }
    }
  }
  return scan;
}

function setDiff(a: Iterable<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort();
}

const root = betterAuthRoot();
const dist = path.join(root, "dist");
const pluginFiles = [
  ...filesUnder(path.join(dist, "plugins", "organization")),
  ...filesUnder(path.join(dist, "plugins", "admin")),
];

beforeEach(() => {
  vi.stubEnv("TRUSTED_PROXY_HOPS", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("better-auth routes (10-15): installed package matches the constant list", () => {
  it(`the installed better-auth is ${BETTER_AUTH_VERSION} (an upgrade must re-read the route list)`, () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      version: string;
    };
    expect(pkg.version).toBe(BETTER_AUTH_VERSION);
  });

  it("the constant list has no duplicate, and its counts are 36 organization and 15 admin paths", () => {
    const paths = ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(ROUTES.filter((r) => r.plugin === "organization")).toHaveLength(
      EXPECTED_ORGANIZATION_COUNT,
    );
    expect(ROUTES.filter((r) => r.plugin === "admin")).toHaveLength(EXPECTED_ADMIN_COUNT);
    for (const route of ROUTES) {
      expect(route.path.startsWith(`/${route.plugin}/`), route.path).toBe(true);
    }
    expect(ROUTES.find((r) => r.path === "/organization/delete")?.note).toContain("09-o3");
  });

  it("the plugin files of the installed dist define exactly the listed paths", () => {
    expect(pluginFiles.length).toBeGreaterThan(0);
    const scan = scanEndpoints(pluginFiles);
    expect(scan.other, "an endpoint defined in a form this scan cannot read").toEqual([]);
    expect(scan.pathless, "path-less (server-only) endpoints").toBe(EXPECTED_PATHLESS_ENDPOINTS);

    const scanned = new Set(scan.paths);
    expect(scan.paths.length, "a path defined twice").toBe(scanned.size);
    // Every path must sit under one of the two blocked prefixes, or the prefix block misses it.
    expect(
      scan.paths.filter((p) => !p.startsWith("/organization/") && !p.startsWith("/admin/")),
    ).toEqual([]);

    const listed = new Set(ROUTES.map((r) => r.path));
    const added = setDiff(scanned, listed);
    const removed = setDiff(listed, scanned);
    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });

  it("no other file of the installed dist defines an /organization/ or /admin/ endpoint", () => {
    const pluginSet = new Set(pluginFiles);
    const elsewhere = filesUnder(dist)
      .filter((f) => !pluginSet.has(f))
      .filter((f) =>
        /createAuthEndpoint\(\s*["'`]\/(organization|admin)\//.test(readFileSync(f, "utf8")),
      )
      .map((f) => path.relative(dist, f));
    expect(elsewhere).toEqual([]);
  });

  it("the plugin factories agree: all groups enabled gives the full list; AIDA's options register 22 organization paths", () => {
    const endpointPaths = (endpoints: Record<string, unknown>) =>
      Object.values(endpoints)
        .map((e) => (e as { path?: string }).path)
        .filter((p): p is string => typeof p === "string");

    const allOrg = endpointPaths(
      organization({ teams: { enabled: true }, dynamicAccessControl: { enabled: true } }).endpoints,
    );
    const adminPaths = endpointPaths(admin().endpoints);
    const listedOrg = ROUTES.filter((r) => r.plugin === "organization").map((r) => r.path);
    const listedAdmin = ROUTES.filter((r) => r.plugin === "admin").map((r) => r.path);
    expect([...allOrg].sort()).toEqual([...listedOrg].sort());
    expect([...adminPaths].sort()).toEqual([...listedAdmin].sort());

    // Mirrors src/lib/auth.ts: neither teams nor dynamicAccessControl is enabled there.
    const registered = new Set(
      endpointPaths(organization({ allowUserToCreateOrganization: false }).endpoints),
    );
    const conditional = ROUTES.filter((r) => r.note === TEAM_NOTE || r.note === ROLE_NOTE);
    expect(conditional).toHaveLength(14);
    expect(conditional.filter((r) => registered.has(r.path))).toEqual([]);
    expect(registered.size).toBe(EXPECTED_ORGANIZATION_COUNT - conditional.length);
  });
});

describe("better-auth routes (10-15): the proxy refuses every listed route", () => {
  const cookie = "better-auth.session_token=abc";

  for (const route of ROUTES) {
    it(`${route.plugin} ${route.path}${route.note ? ` (${route.note})` : ""}: 403 for GET and POST, with and without a session`, async () => {
      for (const method of ["GET", "POST"]) {
        for (const headers of [{}, { cookie }] as Record<string, string>[]) {
          const label = `${method} ${route.path} ${headers.cookie ? "with" : "without"} cookie`;
          const response = proxy(
            new NextRequest(`http://localhost/api/auth${route.path}`, { method, headers }),
          );
          expect(response.status, label).toBe(403);
          expect(response.headers.get("x-middleware-next"), label).toBeNull();
          const body = (await response.json()) as { error: string };
          expect(body.error, label).toBe("Team changes are made in AIDA under Settings → Team.");
        }
      }
    });
  }
});
