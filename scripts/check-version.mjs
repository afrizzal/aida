// ---------------------------------------------------------------------------
// scripts/check-version.mjs: the version gate of .github/workflows/check-version.yml
// (Phase 9, decisions U-05 and U-18, AIDA-40).
//
// Compares the head package.json "version" with the one at the base commit by SemVer 2.0.0
// precedence (build metadata ignored) and prints GitHub annotation lines:
//
//   head version missing or invalid       ::error::   exit 1
//   base package.json has no version      ::notice::  exit 0  (the pull request that adds it)
//   base version invalid                  ::error::   exit 1
//   head lower than base                  ::error::   exit 1
//   head equal to base                    ::notice::  exit 0  (bump policy is an owner decision)
//   head above base                       plain line  exit 0
//   base commit has no package.json       ::notice::  exit 0
//   no base to compare (manual run, new branch)  ::notice:: exit 0 after the head is validated
//
//   node scripts/check-version.mjs --head <path> --base <path>
//   node scripts/check-version.mjs --head <path> --base-without-file
//   node scripts/check-version.mjs --head <path> --no-base <reason>
//
// A head or base file that cannot be read or parsed is an ::error:: and exit 1: the gate never
// falls back to a guess. Wrong usage exits 2. Node built-ins only, no install step needed.
// Values from package.json are untrusted pull request content, so every value printed inside
// an annotation is JSON-quoted and escaped, and cannot start a new workflow command.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const NUMERIC = "0|[1-9]\\d*";
const PRE_ID = "0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*";
const BUILD_ID = "[0-9a-zA-Z-]+";
const SEMVER = new RegExp(
  `^(${NUMERIC})\\.(${NUMERIC})\\.(${NUMERIC})` +
    `(?:-((?:${PRE_ID})(?:\\.(?:${PRE_ID}))*))?` +
    `(?:\\+(${BUILD_ID}(?:\\.${BUILD_ID})*))?$`,
);
const MAX_LENGTH = 256;

/**
 * Parses a SemVer 2.0.0 version string. Returns null for anything else, including a leading
 * "v", surrounding whitespace and leading zeros in a numeric part or numeric pre-release id.
 * @param {unknown} text
 * @returns {{ version: string, major: bigint, minor: bigint, patch: bigint,
 *   prerelease: string[], build: string[] } | null}
 */
export function parseSemver(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_LENGTH) return null;
  const match = SEMVER.exec(text);
  if (!match) return null;
  return {
    version: text,
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split("."),
    build: match[5] === undefined ? [] : match[5].split("."),
  };
}

function toParsed(value) {
  const parsed = typeof value === "string" ? parseSemver(value) : value;
  if (!parsed || typeof parsed.major !== "bigint") {
    throw new TypeError(`not a SemVer 2.0.0 version: ${JSON.stringify(value)}`);
  }
  return parsed;
}

function sign(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareIdentifier(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return sign(BigInt(a), BigInt(b));
  if (aNum) return -1; // numeric identifiers rank below alphanumeric ones
  if (bNum) return 1;
  return sign(a, b); // ASCII order; the grammar allows only [0-9A-Za-z-]
}

/**
 * SemVer 2.0.0 precedence: -1, 0 or 1. Build metadata is ignored. Accepts version strings or
 * parseSemver results; an invalid string throws.
 */
export function compareSemver(a, b) {
  const x = toParsed(a);
  const y = toParsed(b);
  const core = sign(x.major, y.major) || sign(x.minor, y.minor) || sign(x.patch, y.patch);
  if (core !== 0) return core;
  const xp = x.prerelease;
  const yp = y.prerelease;
  if (xp.length === 0 && yp.length === 0) return 0;
  if (xp.length === 0) return 1; // a release ranks above its pre-releases
  if (yp.length === 0) return -1;
  for (let i = 0; i < Math.min(xp.length, yp.length); i++) {
    const c = compareIdentifier(xp[i], yp[i]);
    if (c !== 0) return c;
  }
  return sign(xp.length, yp.length); // a longer set ranks higher when the shared part is equal
}

/** Makes an untrusted value safe inside a GitHub annotation: JSON-quoted, escaped, bounded. */
export function shown(value) {
  let text = JSON.stringify(value);
  if (text === undefined) text = String(value);
  if (text.length > 80) text = `${text.slice(0, 77)}...`;
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function versionOf(json) {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return undefined;
  return Object.hasOwn(json, "version") ? json.version : undefined;
}

const BUMP_POLICY =
  "Whether every pull request must raise the version is an open owner decision (LAUNCH.md), " +
  "so an unchanged version passes.";

/**
 * @param {{ head: unknown,
 *   base: { kind: "file", json: unknown } | { kind: "no-file" } | { kind: "no-base", reason: string } }} input
 * @returns {{ exitCode: number, lines: string[] }}
 */
export function evaluateVersions({ head, base }) {
  const headVersion = versionOf(head);
  if (headVersion === undefined) {
    return {
      exitCode: 1,
      lines: [
        '::error::package.json has no "version" field. Add a SemVer 2.0.0 version such as "1.0.0".',
      ],
    };
  }
  const headParsed = parseSemver(headVersion);
  if (!headParsed) {
    return {
      exitCode: 1,
      lines: [
        `::error::package.json version ${shown(headVersion)} is not a valid SemVer 2.0.0 version.`,
      ],
    };
  }
  const headText = shown(headVersion);

  if (!base || typeof base !== "object") {
    return { exitCode: 1, lines: ["::error::check-version was called without a base."] };
  }
  if (base.kind === "no-file") {
    return {
      exitCode: 0,
      lines: [
        `::notice::The base commit has no package.json; head version ${headText} is accepted.`,
      ],
    };
  }
  if (base.kind === "no-base") {
    return {
      exitCode: 0,
      lines: [
        `::notice::No base to compare (${shown(String(base.reason ?? ""))}); head version ${headText} is a valid SemVer 2.0.0 version.`,
      ],
    };
  }
  if (base.kind !== "file") {
    return { exitCode: 1, lines: [`::error::Unknown base kind ${shown(base.kind)}.`] };
  }

  const baseVersion = versionOf(base.json);
  if (baseVersion === undefined) {
    return {
      exitCode: 0,
      lines: [
        `::notice::The base package.json has no "version" field; head version ${headText} is accepted as the first version.`,
      ],
    };
  }
  const baseParsed = parseSemver(baseVersion);
  if (!baseParsed) {
    return {
      exitCode: 1,
      lines: [
        `::error::The base package.json version ${shown(baseVersion)} is not a valid SemVer 2.0.0 version.`,
      ],
    };
  }
  const baseText = shown(baseVersion);
  const order = compareSemver(headParsed, baseParsed);
  if (order < 0) {
    return {
      exitCode: 1,
      lines: [
        `::error::package.json version ${headText} is lower than the base version ${baseText}.`,
      ],
    };
  }
  if (order === 0) {
    return {
      exitCode: 0,
      lines: [
        `::notice::package.json version ${headText} is unchanged from the base (${baseText}). ${BUMP_POLICY}`,
      ],
    };
  }
  return {
    exitCode: 0,
    lines: [`check-version: head version ${headText} is above the base version ${baseText}.`],
  };
}

function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    return {
      error: `::error::Cannot read the ${label} file ${shown(path)} (${shown(err.code ?? "error")}).`,
    };
  }
  try {
    return { json: JSON.parse(text) };
  } catch {
    return { error: `::error::The ${label} file ${shown(path)} is not valid JSON.` };
  }
}

const USAGE =
  "::error::Usage: check-version --head <path> (--base <path> | --base-without-file | --no-base <reason>)";

/**
 * CLI entry. Returns the exit code; prints every line through io.out.
 * @param {string[]} argv
 * @param {{ out: (line: string) => void }} [io]
 */
export function main(argv, io = { out: (line) => process.stdout.write(`${line}\n`) }) {
  let headPath;
  const bases = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--head" || arg === "--base" || arg === "--no-base") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        io.out(USAGE);
        return 2;
      }
      i++;
      if (arg === "--head") {
        if (headPath !== undefined) {
          io.out(USAGE);
          return 2;
        }
        headPath = value;
      } else if (arg === "--base") {
        bases.push({ kind: "path", path: value });
      } else {
        bases.push({ kind: "no-base", reason: value });
      }
    } else if (arg === "--base-without-file") {
      bases.push({ kind: "no-file" });
    } else {
      io.out(USAGE);
      return 2;
    }
  }
  if (headPath === undefined || bases.length !== 1) {
    io.out(USAGE);
    return 2;
  }

  const head = readJson(headPath, "head package.json");
  if (head.error) {
    io.out(head.error);
    return 1;
  }
  let base = bases[0];
  if (base.kind === "path") {
    const read = readJson(base.path, "base package.json");
    if (read.error) {
      io.out(read.error);
      return 1;
    }
    base = { kind: "file", json: read.json };
  }
  const result = evaluateVersions({ head: head.json, base });
  for (const line of result.lines) io.out(line);
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
