// Phase 9 plan 09-12 (AIDA-40, D-22, U-05, U-18; reviews P12, Q6): the one-command installer
// scripts/install.sh, run against a local fixture release with fake `curl` and `docker` first on
// PATH (tests/unit/fixtures/install/). The fakes record every call and exit 97 on any call the
// case did not expect: a different URL or host, a second download, a Docker subcommand outside
// the case's allowlist. Nothing here reaches the network, a Docker daemon or a real install
// directory: every case installs into its own temporary directory.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "scripts", "install.sh");
const FAKES = path.join(ROOT, "tests", "unit", "fixtures", "install");
const VERSION = (
  JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }
).version;
const DEFAULT_TAG = `v${VERSION}`;
// The default slug is the one README.md already uses (D-22); read from there, not repeated here.
const SLUG = (() => {
  const match = /https:\/\/github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)\/actions\//.exec(
    readFileSync(path.join(ROOT, "README.md"), "utf8"),
  );
  if (!match) throw new Error("README.md carries no GitHub slug");
  return match[1];
})();
const EXAMPLE = readFileSync(path.join(ROOT, ".env.example"), "utf8");
const GENERATED_BASE64 = ["BETTER_AUTH_SECRET", "APP_ENCRYPTION_KEY", "RATE_LIMIT_PEPPER"];

const archiveUrl = (tag: string, slug = SLUG) =>
  `https://github.com/${slug}/archive/refs/tags/${tag}.tar.gz`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Work {
  root: string;
  bin: string;
  tmp: string;
  dir: string;
  curlLog: string;
  dockerLog: string;
  scriptLog: string;
}

/** A fresh work area: fakes on PATH, a private TMPDIR, and the install directory (absent). */
function work(): Work {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aida-install-test-")));
  dirs.push(root);
  const bin = path.join(root, "bin");
  const tmp = path.join(root, "tmp");
  mkdirSync(bin);
  mkdirSync(tmp);
  symlinkSync(path.join(FAKES, "fake-curl.sh"), path.join(bin, "curl"));
  symlinkSync(path.join(FAKES, "fake-docker.sh"), path.join(bin, "docker"));
  return {
    root,
    bin,
    tmp,
    dir: path.join(root, "aida"),
    curlLog: path.join(root, "curl.log"),
    dockerLog: path.join(root, "docker.log"),
    scriptLog: path.join(root, "scripts.log"),
  };
}

interface Release {
  tarball: string;
  compose: string;
}

/**
 * A stand-in release archive shaped like GitHub's tag archive: one top-level folder holding a
 * docker-compose.yml, the real .env.example, and stub backup and restore scripts that record
 * their arguments.
 */
function release(w: Work, tag: string, extra: Record<string, string> = {}): Release {
  const base = path.join(w.root, `release-${tag}`);
  const top = path.join(base, `aida-${tag.slice(1)}`);
  mkdirSync(path.join(top, "scripts"), { recursive: true });
  const compose = `# fixture compose for ${tag}\nservices:\n  app:\n    image: aida-fixture:${tag}\n`;
  writeFileSync(path.join(top, "docker-compose.yml"), compose);
  writeFileSync(path.join(top, ".env.example"), EXAMPLE);
  const stub = (name: string) =>
    `#!/bin/sh\nprintf '%s\\n' "${name} $*" >>"$FAKE_SCRIPT_LOG"\npwd >>"$FAKE_SCRIPT_LOG.cwd"\n`;
  writeFileSync(path.join(top, "scripts", "backup.sh"), stub("backup.sh"));
  writeFileSync(path.join(top, "scripts", "restore.sh"), stub("restore.sh"));
  writeFileSync(path.join(top, "scripts", "install.sh"), "#!/bin/sh\n# fixture copy\n");
  for (const [rel, content] of Object.entries(extra)) {
    mkdirSync(path.dirname(path.join(top, rel)), { recursive: true });
    writeFileSync(path.join(top, rel), content);
  }
  const tarball = path.join(base, `${tag}.tar.gz`);
  const made = spawnSync("tar", ["-czf", tarball, "-C", base, path.basename(top)], {
    encoding: "utf8",
  });
  if (made.status !== 0) throw new Error(`fixture tar failed: ${made.stderr}`);
  return { tarball, compose };
}

interface Opts {
  env?: Record<string, string>;
  shell?: string;
  input?: string;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  curl: string[];
  docker: string[];
  dockerCwd: string[];
  scripts: string[];
}

function lines(file: string): string[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line !== "");
  } catch {
    return [];
  }
}

function env(w: Work, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PATH: `${w.bin}:/usr/bin:/bin`,
    HOME: w.root,
    TMPDIR: w.tmp,
    LC_ALL: "C",
    AIDA_DIR: w.dir,
    FAKE_CURL_LOG: w.curlLog,
    FAKE_DOCKER_LOG: w.dockerLog,
    FAKE_SCRIPT_LOG: w.scriptLog,
    FAKE_DOCKER_ALLOW: "compose up -d --build",
    ...extra,
  };
}

function run(w: Work, args: string[], opts: Opts = {}): Run {
  const before = { curl: lines(w.curlLog).length, docker: lines(w.dockerLog).length };
  const res = spawnSync(opts.shell ?? "/bin/sh", [SCRIPT, ...args], {
    cwd: w.root,
    env: env(w, opts.env),
    input: opts.input ?? "",
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    curl: lines(w.curlLog).slice(before.curl),
    docker: lines(w.dockerLog).slice(before.docker),
    dockerCwd: lines(`${w.dockerLog}.cwd`).slice(before.docker),
    scripts: lines(w.scriptLog),
  };
}

/** The one curl call the installer may make, with its temporary output path. */
function expectDownload(call: string, tag: string, slug = SLUG): string {
  const match = /^-fsSL --proto =https --proto-redir =https -o (\S+) (\S+)$/.exec(call);
  expect(match, call).not.toBeNull();
  expect(match?.[2]).toBe(archiveUrl(tag, slug));
  return match?.[1] ?? "";
}

function installEnv(rel: Release, tag = DEFAULT_TAG): Record<string, string> {
  return { FAKE_CURL_EXPECT_URL: archiveUrl(tag), FAKE_CURL_TARBALL: rel.tarball };
}

function parseEnv(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    map.set(match[1], [...(map.get(match[1]) ?? []), match[2]]);
  }
  return map;
}

describe("scripts/install.sh install (fixture release, fake curl and docker)", () => {
  it("install: one download of the default tag, generated secrets in a mode-600 .env, compose up, the URL printed", () => {
    const w = work();
    const rel = release(w, DEFAULT_TAG);
    const res = run(w, ["install"], { env: installEnv(rel) });
    expect(res.status, res.stderr).toBe(0);

    // Exactly one network call: the release archive of the default tag, to a temp file that is gone.
    expect(res.curl).toHaveLength(1);
    const out = expectDownload(res.curl[0], DEFAULT_TAG);
    expect(out.startsWith(`${w.tmp}/`)).toBe(true);
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(w.tmp)).toEqual([]);

    // The archive is extracted (top-level folder stripped).
    expect(readFileSync(path.join(w.dir, "docker-compose.yml"), "utf8")).toBe(rel.compose);
    expect(existsSync(path.join(w.dir, "scripts", "backup.sh"))).toBe(true);

    // .env: every example line in order, the four secrets generated, everything else as shipped.
    const envPath = path.join(w.dir, ".env");
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    const text = readFileSync(envPath, "utf8");
    const got = parseEnv(text);
    const shipped = parseEnv(EXAMPLE);
    expect([...got.keys()]).toEqual([...shipped.keys()]);
    expect(text.split("\n").length).toBe(EXAMPLE.split("\n").length);
    const secrets: string[] = [];
    for (const [key, values] of got) {
      expect(values, key).toHaveLength(1);
      const value = values[0];
      if (key === "POSTGRES_PASSWORD") {
        expect(value).toMatch(/^[0-9a-f]{64}$/);
        secrets.push(value);
      } else if (GENERATED_BASE64.includes(key)) {
        expect(value).toMatch(/^[A-Za-z0-9+/]{43}=$/);
        expect(Buffer.from(value, "base64")).toHaveLength(32);
        secrets.push(value);
      } else {
        expect(value, key).toBe(shipped.get(key)?.[0]);
      }
    }
    expect(new Set(secrets).size).toBe(4);
    expect(
      readdirSync(w.dir).filter((name) => name.startsWith(".env") && name !== ".env.example"),
    ).toEqual([".env"]);

    // The stack is started through compose in the install directory.
    expect(res.docker).toEqual(["compose up -d --build"]);
    expect(res.dockerCwd).toEqual([w.dir]);

    // The URL to open is printed; no secret value is.
    expect(res.stdout).toContain("http://localhost");
    for (const secret of secrets) {
      expect(res.stdout).not.toContain(secret);
      expect(res.stderr).not.toContain(secret);
    }
  });

  it("install under dash behaves the same (POSIX sh, no bashisms)", () => {
    const w = work();
    const res = run(w, ["install"], {
      env: installEnv(release(w, DEFAULT_TAG)),
      shell: "/bin/dash",
    });
    expect(res.status, res.stderr).toBe(0);
    expect(res.curl).toHaveLength(1);
    expect(res.docker).toEqual(["compose up -d --build"]);
    expect(
      parseEnv(readFileSync(path.join(w.dir, ".env"), "utf8")).get("POSTGRES_PASSWORD")?.[0],
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it("install [tag] downloads that tag, and AIDA_REPO overrides the slug", () => {
    const w = work();
    const rel = release(w, "v1.2.3-rc.1");
    const fork = "example-org/aida-fork";
    const res = run(w, ["install", "v1.2.3-rc.1"], {
      env: {
        AIDA_REPO: fork,
        FAKE_CURL_EXPECT_URL: archiveUrl("v1.2.3-rc.1", fork),
        FAKE_CURL_TARBALL: rel.tarball,
      },
    });
    expect(res.status, res.stderr).toBe(0);
    expect(res.curl).toHaveLength(1);
    expectDownload(res.curl[0], "v1.2.3-rc.1", fork);
  });

  it("the default tag is v plus the package.json version (U-05, U-18)", () => {
    const match = /^AIDA_DEFAULT_TAG=([^\s#]+)$/m.exec(readFileSync(SCRIPT, "utf8"));
    expect(match?.[1]).toBe(DEFAULT_TAG);
    expect(DEFAULT_TAG).toBe("v1.0.0");
  });

  it("any other URL or host makes the fake curl exit 97 and the install fail with nothing written", () => {
    const w = work();
    const rel = release(w, DEFAULT_TAG);
    const res = run(w, ["install"], {
      env: {
        FAKE_CURL_EXPECT_URL: archiveUrl(DEFAULT_TAG, "someone-else/aida"),
        FAKE_CURL_TARBALL: rel.tarball,
      },
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("fake curl: unexpected call");
    expect(res.curl).toHaveLength(1);
    expect(res.docker).toEqual([]);
    expect(existsSync(w.dir)).toBe(false);
    expect(readdirSync(w.tmp)).toEqual([]);
  });

  it("an unexpected docker subcommand makes the fake exit 97 and the install fail", () => {
    const w = work();
    const res = run(w, ["install"], {
      env: { ...installEnv(release(w, DEFAULT_TAG)), FAKE_DOCKER_ALLOW: "" },
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("fake docker: unexpected call: compose up -d --build");
  });

  it("a non-empty AIDA_DIR that is not an AIDA checkout is refused with exit 1 and nothing written", () => {
    const w = work();
    mkdirSync(w.dir);
    writeFileSync(path.join(w.dir, "notes.txt"), "keep me\n");
    const res = run(w, ["install"], { env: installEnv(release(w, DEFAULT_TAG)) });
    expect(res.status).toBe(1);
    expect(res.curl).toEqual([]);
    expect(res.docker).toEqual([]);
    expect(readdirSync(w.dir)).toEqual(["notes.txt"]);
  });
});
