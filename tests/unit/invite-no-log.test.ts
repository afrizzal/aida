// Phase 10, plan 10-08 Task 3 (AIDA-42; D-04, C12, V-20; threat T-10-32): an invitation token
// travels in the URL path (/invite/<token>), so it must not reach any log AIDA ships. Static
// checks, no runtime:
//   (1) the shipped Caddyfile has no `log` directive (Caddy writes no access log by default);
//   (2) no file of the invitation path (src/app/(auth)/invite and src/lib/workspace-members/invit*)
//       calls console or process.stdout/stderr, or imports a logging module;
//   (3) no console call anywhere under src (src/generated excluded) logs a request path or URL
//       (pathname, nextUrl, request.url, req.url);
//   (4) the console calls of src/lib/rate-limit/client-ip.ts (two configuration messages) carry
//       no request path, URL or header value.
// Each detector is proved on a failing fixture first, so a passing real tree is not vacuous.
//
// The operator note (an access log, if an operator enables one, records the tokens) is owner
// item 08-o4 for docs/SECURITY.md (O-6) and goes to the phase SUMMARY and 10-GATE.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { readSourceTree } from "../support/source-inventory";

const ROOT = path.resolve(__dirname, "../..");
const REAL = readSourceTree(ROOT);
const CADDYFILE = readFileSync(path.join(ROOT, "Caddyfile"), "utf8");
const CLIENT_IP = "src/lib/rate-limit/client-ip.ts";

/** Lines of a Caddyfile whose first word, outside a comment, is `log`. */
function caddyLogDirectives(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => /^log(\s|\{|$)/.test(line));
}

/** Is `file` part of the invitation path whose modules must not log at all? */
function isInviteModule(file: string): boolean {
  return (
    file.startsWith("src/app/(auth)/invite/") ||
    /^src\/lib\/workspace-members\/invit[^/]*\.ts$/.test(file)
  );
}

interface ConsoleCall {
  file: string;
  line: number;
  /** console.<method>, process.stdout.write or process.stderr.write */
  callee: string;
  args: ts.NodeArray<ts.Expression>;
  argText: string;
}

function parse(file: string, text: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

/** console.x(...), console["x"](...), process.stdout.write(...) and process.stderr.write(...). */
function logCalls(file: string, text: string): ConsoleCall[] {
  const sf = parse(file, text);
  const out: ConsoleCall[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf).replace(/\s+/g, "");
      if (
        /^console(\.[A-Za-z]+|\[["'][A-Za-z]+["']\])$/.test(callee) ||
        /^process\.(stdout|stderr)\.write$/.test(callee)
      ) {
        out.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          callee,
          args: node.arguments,
          argText: node.arguments.map((a) => a.getText(sf)).join(", "),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Module specifiers that name a logging library or a project logging module. */
const LOGGING_SPECIFIER =
  /(^|[/@])(pino|winston|bunyan|loglevel|log4js|signale|consola|debug)([/-]|$)|(^|[/.-])log(ger|ging)?(\.[cm]?[jt]s)?$/i;

function loggingImports(file: string, text: string): string[] {
  const sf = parse(file, text);
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specifiers.filter((s) => LOGGING_SPECIFIER.test(s));
}

/** Rule 2: every log call or logging import in an invitation module. */
function inviteModuleFindings(sources: Map<string, string>): string[] {
  const findings: string[] = [];
  for (const [file, text] of sources) {
    if (!isInviteModule(file)) continue;
    for (const call of logCalls(file, text)) findings.push(`${file}:${call.line} ${call.callee}`);
    for (const spec of loggingImports(file, text)) findings.push(`${file} imports ${spec}`);
  }
  return findings;
}

const REQUEST_URL_MENTION = /\b(pathname|nextUrl)\b|\b(request|req)\s*\??\.\s*url\b/;

/** Rule 3: console calls under src whose arguments mention a request path or URL. */
function requestUrlLogFindings(sources: Map<string, string>): string[] {
  const findings: string[] = [];
  for (const [file, text] of sources) {
    for (const call of logCalls(file, text)) {
      if (REQUEST_URL_MENTION.test(call.argText)) findings.push(`${file}:${call.line}`);
    }
  }
  return findings;
}

/** Identifiers that would carry a request path, URL, header or token into a log line. */
const REQUEST_IDENTIFIER = /url|path|href|request|^req$|header|token|^ip$|address|forwarded/i;

/**
 * Rule 4: an argument of a console call in client-ip.ts may only be fixed text plus the parsed
 * TRUSTED_PROXY_HOPS count: no identifier naming a request, path, URL, header or address, and no
 * text that contains a URL or the invitation path.
 */
function pathMentions(file: string, text: string): string[] {
  const findings: string[] = [];
  for (const call of logCalls(file, text)) {
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && REQUEST_IDENTIFIER.test(node.text)) {
        findings.push(`${call.line}: identifier ${node.text}`);
      }
      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)) &&
        /:\/\/|\/invite\b/.test(node.text)
      ) {
        findings.push(`${call.line}: text ${node.text}`);
      }
      ts.forEachChild(node, visit);
    };
    for (const arg of call.args) visit(arg);
  }
  return findings;
}

describe("detectors fail on fixtures first", () => {
  it("finds a log directive in a Caddyfile, at any indentation, and ignores comments", () => {
    expect(caddyLogDirectives(":443 {\n\tlog {\n\t\toutput stdout\n\t}\n}\n")).toEqual(["log {"]);
    expect(caddyLogDirectives("log\n")).toEqual(["log"]);
    expect(caddyLogDirectives("# log\n:80 {\n\t# log {\n\treverse_proxy app:3000\n}\n")).toEqual(
      [],
    );
    // A directive that merely starts with the letters is not `log`.
    expect(caddyLogDirectives("\tlogo_handler\n")).toEqual([]);
  });

  it("flags a console call or a logging import in an invitation module, and only there", () => {
    const sources = new Map([
      ["src/app/(auth)/invite/[token]/page.tsx", "export default function P() { console.log(1); }"],
      ["src/lib/workspace-members/invite-x.ts", 'import pino from "pino";\nexport const a = pino;'],
      ["src/lib/workspace-members/invitations.ts", 'import { logger } from "../logger";'],
      ["src/lib/workspace-members/inviter.ts", "process.stderr.write('x');"],
      ["src/lib/other.ts", "console.log(1);"],
    ]);
    expect(inviteModuleFindings(sources).sort()).toEqual([
      "src/app/(auth)/invite/[token]/page.tsx:1 console.log",
      "src/lib/workspace-members/invitations.ts imports ../logger",
      "src/lib/workspace-members/invite-x.ts imports pino",
      "src/lib/workspace-members/inviter.ts:1 process.stderr.write",
    ]);
  });

  it("flags a console call anywhere in src that logs a request path or URL", () => {
    const sources = new Map([
      ["src/a.ts", "export function f(request: Request) { console.error('x', request.url); }"],
      ["src/b.ts", "export function f(req: { url: string }) { console.warn(req.url); }"],
      [
        "src/c.ts",
        `export function f(r: { nextUrl: { pathname: string } }) {
  console.info(
    \`at \${r.nextUrl.pathname}\`,
  );
}`,
      ],
      ["src/d.ts", "export function f(url: string) { console.log('fixed text'); return url; }"],
    ]);
    expect(requestUrlLogFindings(sources)).toEqual(["src/a.ts:1", "src/b.ts:1", "src/c.ts:2"]);
  });

  it("flags a client-ip console call that carries a request value or a URL", () => {
    expect(
      pathMentions(
        "src/x.ts",
        `function f(header: string, hops: number) {
 console.error(\`bad \${header}\`);
 console.error('see https://x.test');
 console.error(\`hops \${hops}\`);
}`,
      ),
    ).toEqual(["2: identifier header", "3: text see https://x.test"]);
  });
});

describe("the shipped tree", () => {
  it("(1) the Caddyfile has no log directive", () => {
    expect(CADDYFILE).toContain("reverse_proxy");
    expect(caddyLogDirectives(CADDYFILE)).toEqual([]);
  });

  it("(2) the invitation modules call no console and import no logging module", () => {
    const inviteFiles = [...REAL.keys()].filter(isInviteModule).sort();
    // Anchored: the check runs over the modules this phase ships.
    expect(inviteFiles).toEqual(
      expect.arrayContaining([
        "src/app/(auth)/invite/[token]/accept/route.ts",
        "src/app/(auth)/invite/[token]/invite-card.tsx",
        "src/app/(auth)/invite/[token]/page.tsx",
        "src/lib/workspace-members/invitations.ts",
        "src/lib/workspace-members/invite-email.ts",
        "src/lib/workspace-members/invite-onboarding.ts",
        "src/lib/workspace-members/invite-token.ts",
      ]),
    );
    expect(inviteModuleFindings(REAL)).toEqual([]);
  });

  it("(3) no console call under src logs a request path or URL", () => {
    expect(REAL.size).toBeGreaterThan(100);
    expect([...REAL.keys()].some((f) => f.startsWith("src/generated/"))).toBe(false);
    expect(requestUrlLogFindings(REAL)).toEqual([]);
  });

  it("(4) the two console.error calls of client-ip.ts carry no path, URL or header value", () => {
    const text = REAL.get(CLIENT_IP) ?? "";
    const calls = logCalls(CLIENT_IP, text);
    expect(calls.map((c) => c.callee)).toEqual(["console.error", "console.error"]);
    expect(pathMentions(CLIENT_IP, text)).toEqual([]);
  });
});
