// Test-only static inventory of src/ (Phase 10, plan 10-02: D-08, C5, R2-3, V-05, K141).
//
// Parses every source file with the TypeScript parser (ts.createSourceFile, syntax only: no type
// checker, no program, no new package) and answers per FUNCTION, not per file:
//   - which functions are entry points under src/app (exported server actions, route handlers,
//     page and layout default exports, default-exported async server components of src/app/(app)
//     imported by a page);
//   - which calls each function makes, by callee name and receiver chain, following calls to
//     functions of the same module and to helpers in other src/app modules;
//   - how imports resolve (`@/` and relative) into src files;
//   - whether a src/lib module reaches tenant data: it, or a src/lib module it imports
//     transitively, references the shared prisma client, calls scopedDb( or uses $queryRaw or
//     $executeRaw;
//   - whether a src/lib function reads membership (calls a membership reader, directly or through
//     the functions it calls).
// findViolations runs the rules of tests/unit/membership-inventory.test.ts on the real tree or on
// in-memory fixture sources. The rules' names and allowlists live in that test; this file only
// knows how to evaluate them.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Repo-relative POSIX path (for example "src/app/(app)/kb/page.tsx") to file text. */
export type Sources = ReadonlyMap<string, string>;

/** Every .ts and .tsx file under `<root>/src`, generated code excluded. */
export function readSourceTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(root, rel))) {
      const childRel = `${rel}/${name}`;
      if (childRel === "src/generated") continue;
      const abs = path.join(root, childRel);
      if (statSync(abs).isDirectory()) walk(childRel);
      else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
        out.set(childRel, readFileSync(abs, "utf8"));
      }
    }
  };
  walk("src");
  return out;
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

export interface ImportBinding {
  local: string;
  /** "default", "*" or the exported name. */
  imported: string;
  specifier: string;
  /** The src file the specifier resolves to, or null for a package. */
  resolved: string | null;
  typeOnly: boolean;
}

export interface FunctionInfo {
  file: string;
  name: string;
  exported: boolean;
  isDefault: boolean;
  async: boolean;
  /** The node whose subtree is the function: the declaration or the variable initializer. */
  node: ts.Node;
}

export interface ModuleInfo {
  file: string;
  sf: ts.SourceFile;
  useServer: boolean;
  useClient: boolean;
  imports: Map<string, ImportBinding>;
  /** Top-level functions (and function-valued or call-valued top-level consts) by local name. */
  functions: Map<string, FunctionInfo>;
  /** Exported name to local function name. */
  exports: Map<string, string>;
}

export interface CallSite {
  /** Receiver chain plus callee, for example ["auth", "api", "getSession"]. */
  chain: string[];
  name: string;
  node: ts.CallExpression | ts.TaggedTemplateExpression;
  /** The first argument, when it is a call. */
  firstArg: ts.Expression | undefined;
}

function directiveOf(sf: ts.SourceFile, directive: string): boolean {
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteral(stmt.expression)) return false;
    if (stmt.expression.text === directive) return true;
  }
  return false;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

/** Resolves an import specifier to a src file of `known`, or a best-guess .ts path for `@/`. */
export function resolveSpecifier(spec: string, fromFile: string, known: Sources): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith("."))
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  for (const c of candidates) if (known.has(c)) return c;
  return /\.tsx?$/.test(base) ? base : `${base}.ts`;
}

function isFunctionLike(node: ts.Node | undefined): boolean {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

export function parseModule(file: string, text: string, known: Sources): ModuleInfo {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const mod: ModuleInfo = {
    file,
    sf,
    useServer: directiveOf(sf, "use server"),
    useClient: directiveOf(sf, "use client"),
    imports: new Map(),
    functions: new Map(),
    exports: new Map(),
  };
  const addFn = (
    name: string,
    node: ts.Node,
    exported: boolean,
    isDefault: boolean,
    async: boolean,
  ) => {
    mod.functions.set(name, { file, name, exported, isDefault, async, node });
    if (exported) mod.exports.set(isDefault ? "default" : name, name);
  };

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const specifier = stmt.moduleSpecifier.text;
      const resolved = resolveSpecifier(specifier, file, known);
      const clause = stmt.importClause;
      if (!clause) continue;
      const clauseType = clause.isTypeOnly;
      if (clause.name) {
        mod.imports.set(clause.name.text, {
          local: clause.name.text,
          imported: "default",
          specifier,
          resolved,
          typeOnly: clauseType,
        });
      }
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) {
        mod.imports.set(nb.name.text, {
          local: nb.name.text,
          imported: "*",
          specifier,
          resolved,
          typeOnly: clauseType,
        });
      } else if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          mod.imports.set(el.name.text, {
            local: el.name.text,
            imported: (el.propertyName ?? el.name).text,
            specifier,
            resolved,
            typeOnly: clauseType || el.isTypeOnly,
          });
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.body) {
      const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
      const isDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
      const name = stmt.name?.text ?? "default";
      addFn(
        name,
        stmt,
        exported,
        exported && isDefault,
        hasModifier(stmt, ts.SyntaxKind.AsyncKeyword),
      );
    } else if (ts.isVariableStatement(stmt)) {
      const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer;
        if (!init) continue;
        if (ts.isIdentifier(decl.name)) {
          if (isFunctionLike(init) || ts.isCallExpression(init)) {
            const async = isFunctionLike(init) && hasModifier(init, ts.SyntaxKind.AsyncKeyword);
            addFn(decl.name.text, init, exported, false, async);
          }
        } else if (ts.isObjectBindingPattern(decl.name)) {
          // export const { GET, POST } = handler(...): each name is a function of that initializer.
          for (const el of decl.name.elements) {
            if (ts.isIdentifier(el.name)) addFn(el.name.text, init, exported, false, false);
          }
        }
      }
    } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = stmt.expression;
      if (ts.isIdentifier(expr)) mod.exports.set("default", expr.text);
      else if (isFunctionLike(expr))
        addFn("default", expr, true, true, hasModifier(expr, ts.SyntaxKind.AsyncKeyword));
    } else if (
      ts.isExportDeclaration(stmt) &&
      !stmt.moduleSpecifier &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) {
        mod.exports.set(el.name.text, (el.propertyName ?? el.name).text);
      }
    }
  }
  // An `export { x }` or `export default x` marks the local function as exported.
  for (const [exportName, local] of mod.exports) {
    const fn = mod.functions.get(local);
    if (fn) {
      fn.exported = true;
      if (exportName === "default") fn.isDefault = true;
    }
  }
  return mod;
}

/** The receiver chain of a callee expression, outermost receiver first. */
export function chainOf(expr: ts.Expression): string[] {
  if (ts.isIdentifier(expr)) return [expr.text];
  if (ts.isPropertyAccessExpression(expr)) return [...chainOf(expr.expression), expr.name.text];
  if (ts.isElementAccessExpression(expr)) return [...chainOf(expr.expression), "[]"];
  if (ts.isCallExpression(expr)) return [...chainOf(expr.expression), "()"];
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAwaitExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    return chainOf(expr.expression);
  }
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) return chainOf(expr.expression);
  if (expr.kind === ts.SyntaxKind.ThisKeyword) return ["this"];
  return ["?"];
}

/** Every call and tagged template in the subtree of `node`, in source order. */
export function callsIn(node: ts.Node): CallSite[] {
  const out: CallSite[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const chain = chainOf(n.expression);
      out.push({ chain, name: chain[chain.length - 1], node: n, firstArg: n.arguments[0] });
    } else if (ts.isTaggedTemplateExpression(n)) {
      const chain = chainOf(n.tag);
      out.push({ chain, name: chain[chain.length - 1], node: n, firstArg: undefined });
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** The identifier tag names of JSX elements in the subtree (<Foo />, <Foo>…</Foo>). */
export function jsxTagsIn(node: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      ts.isIdentifier(n.tagName)
    ) {
      out.add(n.tagName.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** Identifiers used as values in the subtree (not property names, not declared names). */
export function valueRefsIn(node: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isPropName =
        (p && ts.isPropertyAccessExpression(p) && p.name === n) ||
        (p && ts.isPropertyAssignment(p) && p.name === n) ||
        (p && ts.isQualifiedName(p)) ||
        (p && ts.isTypeReferenceNode(p)) ||
        (p && (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p))) ||
        (p && ts.isExportSpecifier(p)) ||
        (p &&
          (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p)) &&
          p.name === n);
      if (!isPropName) out.add(n.text);
    }
    if (ts.isTypeNode(n)) return; // type positions never reach data
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** The raw text of a tagged template (or a template or string first argument). */
export function sqlTextOf(site: CallSite): string {
  if (ts.isTaggedTemplateExpression(site.node)) return site.node.template.getText();
  const a = site.firstArg;
  if (
    a &&
    (ts.isTemplateExpression(a) || ts.isNoSubstitutionTemplateLiteral(a) || ts.isStringLiteral(a))
  ) {
    return a.getText();
  }
  return "";
}

const RAW_NAMES = new Set(["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"]);

/** True when the SQL writes rows. A row lock (FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE) is not a write. */
export function isRawWrite(site: CallSite): boolean {
  const isRaw =
    RAW_NAMES.has(site.name) || (ts.isTaggedTemplateExpression(site.node) && site.name === "sql");
  if (!isRaw) return false;
  const text = sqlTextOf(site).replace(
    /\bFOR\s+(NO\s+KEY\s+)?(UPDATE|SHARE)\b|\bFOR\s+KEY\s+SHARE\b/gi,
    " ",
  );
  return /\b(INSERT|UPDATE|DELETE)\b/i.test(text);
}

// ---------------------------------------------------------------------------------------------
// The project: modules, entries, call closures, reach
// ---------------------------------------------------------------------------------------------

export type EntryKind = "server-action" | "route-handler" | "page" | "layout" | "component";

export interface EntryFunction {
  file: string;
  function: string;
  kind: EntryKind;
}

const ROUTE_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** A function of a module, the unit every rule reports on. */
export interface FnRef {
  mod: ModuleInfo;
  fn: FunctionInfo;
}

export class Project {
  readonly modules = new Map<string, ModuleInfo>();
  private reachMemo = new Map<string, boolean>();
  private membershipMemo = new Map<string, boolean>();

  constructor(readonly sources: Sources) {
    for (const [file, text] of sources) this.modules.set(file, parseModule(file, text, sources));
  }

  /** The function a module exports under `exportName`, or null. */
  exported(file: string, exportName: string): FnRef | null {
    const mod = this.modules.get(file);
    if (!mod) return null;
    const local = mod.exports.get(exportName);
    const fn = local ? mod.functions.get(local) : undefined;
    return fn ? { mod, fn } : null;
  }

  /** Entry functions under src/app. */
  entries(): EntryFunction[] {
    const out: EntryFunction[] = [];
    const seen = new Set<string>();
    const push = (e: EntryFunction) => {
      const key = `${e.file}#${e.function}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    };
    for (const mod of this.modules.values()) {
      const f = mod.file;
      if (!f.startsWith("src/app/")) continue;
      const base = path.posix.basename(f);
      if (mod.useServer) {
        for (const fn of mod.functions.values()) {
          if (fn.exported) push({ file: f, function: fn.name, kind: "server-action" });
        }
      }
      if (base === "route.ts") {
        for (const fn of mod.functions.values()) {
          if (fn.exported && ROUTE_METHODS.has(fn.name))
            push({ file: f, function: fn.name, kind: "route-handler" });
        }
      }
      if (base === "page.tsx" || base === "layout.tsx") {
        const def = this.exported(f, "default");
        if (def)
          push({ file: f, function: def.fn.name, kind: base === "page.tsx" ? "page" : "layout" });
        // Default-exported async server components of src/app/(app) imported by a page.
        if (base === "page.tsx" && f.startsWith("src/app/(app)/")) {
          for (const b of mod.imports.values()) {
            if (b.typeOnly || b.imported !== "default" || !b.resolved?.startsWith("src/app/(app)/"))
              continue;
            const target = this.modules.get(b.resolved);
            const comp = this.exported(b.resolved, "default");
            if (target && !target.useClient && comp?.fn.async) {
              push({ file: b.resolved, function: comp.fn.name, kind: "component" });
            }
          }
        }
      }
    }
    return out.sort((a, b) =>
      a.file === b.file ? a.function.localeCompare(b.function) : a.file.localeCompare(b.file),
    );
  }

  fnRef(file: string, fnName: string): FnRef | null {
    const mod = this.modules.get(file);
    const fn = mod?.functions.get(fnName);
    return mod && fn ? { mod, fn } : null;
  }

  /**
   * The function a call resolves to: a function of the same module, or an imported function of a
   * src module (when `follow` admits that module). null for anything else.
   */
  resolveCall(from: FnRef, site: CallSite, follow: (file: string) => boolean): FnRef | null {
    if (site.chain.length !== 1) return null;
    const name = site.chain[0];
    const local = from.mod.functions.get(name);
    if (local && local !== from.fn) return { mod: from.mod, fn: local };
    const b = from.mod.imports.get(name);
    if (!b || b.typeOnly || !b.resolved || !follow(b.resolved)) return null;
    return this.exported(b.resolved, b.imported);
  }

  /**
   * The functions an entry runs: itself, the functions of its module it calls, and the functions
   * of other src/app modules it calls, transitively (helpers, loaders, local gate wrappers).
   */
  closure(start: FnRef): FnRef[] {
    const out: FnRef[] = [];
    const seen = new Set<string>();
    const visit = (ref: FnRef) => {
      const key = `${ref.mod.file}#${ref.fn.name}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(ref);
      for (const site of callsIn(ref.fn.node)) {
        const next = this.resolveCall(ref, site, (file) => file.startsWith("src/app/"));
        if (next) visit(next);
      }
      // A server component rendered as JSX (<TicketListPanel />) runs like a call.
      for (const tag of jsxTagsIn(ref.fn.node)) {
        const b = ref.mod.imports.get(tag);
        if (!b || b.typeOnly || !b.resolved?.startsWith("src/app/")) continue;
        if (this.modules.get(b.resolved)?.useClient) continue;
        const next = this.exported(b.resolved, b.imported);
        if (next) visit(next);
      }
    };
    visit(start);
    return out;
  }

  /** The binding a call's receiver root or callee name refers to in its module. */
  bindingOf(ref: FnRef, name: string): ImportBinding | undefined {
    return ref.mod.imports.get(name);
  }

  /**
   * Tenant reach of a src/lib module: it references the shared prisma client, calls scopedDb( or
   * uses raw SQL, or it imports (as a value) a src/lib module that does, transitively.
   */
  libReaches(file: string, stack: Set<string> = new Set()): boolean {
    const memo = this.reachMemo.get(file);
    if (memo !== undefined) return memo;
    if (file === "src/lib/db.ts" || file === "src/lib/scoped-db.ts") return true;
    const mod = this.modules.get(file);
    if (!mod || stack.has(file)) return false;
    stack.add(file);
    let reaches = false;
    const refs = valueRefsIn(mod.sf);
    for (const b of mod.imports.values()) {
      if (b.typeOnly || !b.resolved?.startsWith("src/lib/")) continue;
      if (
        refs.has(b.local) &&
        (b.resolved === "src/lib/db.ts" || b.resolved === "src/lib/scoped-db.ts")
      )
        reaches = true;
    }
    if (!reaches && callsIn(mod.sf).some((s) => RAW_NAMES.has(s.name))) reaches = true;
    if (!reaches) {
      for (const b of mod.imports.values()) {
        if (b.typeOnly || !b.resolved?.startsWith("src/lib/") || !refs.has(b.local)) continue;
        if (this.libReaches(b.resolved, stack)) {
          reaches = true;
          break;
        }
      }
    }
    stack.delete(file);
    this.reachMemo.set(file, reaches);
    return reaches;
  }

  /**
   * Whether a src/lib function reads membership: it (or a function of its module it calls, or a
   * src/lib function it calls, transitively) calls one of `readers` imported from their module.
   */
  readsMembership(
    ref: FnRef,
    readers: ReadonlyMap<string, string>,
    stack: Set<string> = new Set(),
  ): boolean {
    const key = `${ref.mod.file}#${ref.fn.name}`;
    const memo = this.membershipMemo.get(key);
    if (memo !== undefined) return memo;
    if (stack.has(key)) return false;
    stack.add(key);
    let reads = false;
    for (const site of callsIn(ref.fn.node)) {
      if (site.chain.length === 1) {
        const home = readers.get(site.name);
        const b = ref.mod.imports.get(site.name);
        if (home && (ref.mod.file === home || b?.resolved === home)) {
          reads = true;
          break;
        }
      }
      const next = this.resolveCall(ref, site, (file) => file.startsWith("src/lib/"));
      if (next && this.readsMembership(next, readers, stack)) {
        reads = true;
        break;
      }
    }
    stack.delete(key);
    this.membershipMemo.set(key, reads);
    return reads;
  }

  /** The top-level function of `mod` whose subtree contains `node`, or "<module>". */
  enclosingFunction(mod: ModuleInfo, node: ts.Node): string {
    for (const fn of mod.functions.values()) {
      if (node.pos >= fn.node.pos && node.end <= fn.node.end) return fn.name;
    }
    return "<module>";
  }
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

export type RuleId = "A" | "C" | "C2" | "D";

export interface AllowEntry {
  rule: RuleId;
  file: string;
  function: string;
  reason: string;
}

export interface Violation {
  rule: RuleId;
  file: string;
  function: string;
  detail: string;
}

/** A gate: a function name and the src module it must be imported from. */
export interface NamedFn {
  name: string;
  home: string;
}

export interface InventoryRules {
  /** Rule A gates (full gates). */
  gates: readonly NamedFn[];
  /** The conditional gate: counts only with a call to a membership-reading src/lib function. */
  conditionalGate: NamedFn;
  /** Functions that read membership, by name, with their home module. */
  membershipReaders: readonly NamedFn[];
  /** Session and gate functions: calling them is not, by itself, tenant reach (Rule A). */
  sessionInfra: readonly NamedFn[];
  /** Rule A skips entries whose file starts with one of these. */
  ruleAExcludedPrefixes: readonly string[];
  /** Rule C: the one home of auth.api.getSession. */
  sessionReadHome: { file: string; function: string };
  /** Rule C: session readers an entry under src/app may call only through an allowlist entry. */
  entrySessionReaders: readonly NamedFn[];
  /** Rule C2: session-reading calls; at most one per server action or route handler. */
  sessionReadingCalls: readonly NamedFn[];
  /** Rule D: DOMAIN_MODELS model names (PascalCase, as in src/lib/scoped-db.ts). */
  domainModels: readonly string[];
  allowlist: readonly AllowEntry[];
}

export interface InventoryRow {
  file: string;
  function: string;
  kind: EntryKind;
  tenantReach: boolean;
  /** The gates found, or "" when none. */
  gates: string;
  /** The rule A allowlist reason, the exclusion, or "". */
  exemption: string;
}

export interface InventoryResult {
  violations: Violation[];
  /** Allowlist problems: missing file or function, empty reason, or no finding suppressed. */
  hygiene: string[];
  suppressed: { entry: AllowEntry; violation: Violation }[];
  inventory: InventoryRow[];
}

const WRITE_OPS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

/** Whether the subtree holds a property named organizationId (assignment or shorthand). */
function mentionsOrganizationId(node: ts.Node | undefined): boolean {
  if (!node) return false;
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (
      (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
      n.name.getText() === "organizationId"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function propertyOf(obj: ts.Expression | undefined, name: string): ts.Expression | undefined {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
  }
  return undefined;
}

/** Names bound to a scopedDb client inside a function: `x = scopedDb(...)`, a ScopedDb-typed parameter, a scoped $transaction callback parameter. */
function scopedNames(fnNode: ts.Node): Set<string> {
  const names = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const add = (n: string) => {
      if (!names.has(n)) {
        names.add(n);
        changed = true;
      }
    };
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const init = ts.isAwaitExpression(n.initializer) ? n.initializer.expression : n.initializer;
        if (ts.isCallExpression(init) && chainOf(init.expression).join(".") === "scopedDb")
          add(n.name.text);
      }
      if (
        ts.isParameter(n) &&
        ts.isIdentifier(n.name) &&
        n.type &&
        /\bScopedDb\b/.test(n.type.getText())
      ) {
        add(n.name.text);
      }
      if (ts.isCallExpression(n)) {
        const chain = chainOf(n.expression);
        const cb = n.arguments[0];
        if (
          chain.length === 2 &&
          chain[1] === "$transaction" &&
          names.has(chain[0]) &&
          cb &&
          (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))
        ) {
          const p = cb.parameters[0];
          if (p && ts.isIdentifier(p.name)) add(p.name.text);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(fnNode);
  }
  return names;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function isCallOf(project: Project, ref: FnRef, site: CallSite, target: NamedFn): boolean {
  if (site.chain.length !== 1 || site.name !== target.name) return false;
  if (ref.mod.file === target.home) return !!ref.mod.functions.get(target.name);
  const b = project.bindingOf(ref, site.name);
  return !!b && !b.typeOnly && b.resolved === target.home && b.imported === target.name;
}

function refersTo(project: Project, ref: FnRef, local: string, target: NamedFn): boolean {
  const b = project.bindingOf(ref, local);
  return !!b && b.resolved === target.home && b.imported === target.name;
}

/** The number of session-reading calls an entry makes, expanding calls to same-module and src/app helpers. */
function sessionReadCount(
  project: Project,
  ref: FnRef,
  rules: InventoryRules,
  stack: Set<string>,
): number {
  const key = `${ref.mod.file}#${ref.fn.name}`;
  if (stack.has(key)) return 0;
  stack.add(key);
  let count = 0;
  for (const site of callsIn(ref.fn.node)) {
    if (rules.sessionReadingCalls.some((t) => isCallOf(project, ref, site, t))) {
      count += 1;
      continue;
    }
    const next = project.resolveCall(ref, site, (file) => file.startsWith("src/app/"));
    if (next) count += sessionReadCount(project, next, rules, stack);
  }
  stack.delete(key);
  return count;
}

export function findViolations(rules: InventoryRules, sources: Sources): InventoryResult {
  const project = new Project(sources);
  const raw: Violation[] = [];
  const inventory: InventoryRow[] = [];
  const readers = new Map(rules.membershipReaders.map((r) => [r.name, r.home]));
  const allowedA = (file: string, fn: string) =>
    rules.allowlist.find((e) => e.rule === "A" && e.file === file && e.function === fn);

  // Rules A, C (entry readers) and C2, per entry function under src/app.
  for (const entry of project.entries()) {
    const start = project.fnRef(entry.file, entry.function);
    if (!start) continue;
    const closure = project.closure(start);
    const gatesFound = new Set<string>();
    let reach = false;
    let conditional = false;
    let membershipService = false;
    for (const ref of closure) {
      const sites = callsIn(ref.fn.node);
      for (const site of sites) {
        for (const g of rules.gates) if (isCallOf(project, ref, site, g)) gatesFound.add(g.name);
        if (isCallOf(project, ref, site, rules.conditionalGate)) conditional = true;
        if (site.chain.length === 1 && site.name === "scopedDb") reach = true;
        if (RAW_NAMES.has(site.name)) reach = true;
        // A call to an imported src/lib function that reads membership (for the conditional gate).
        if (site.chain.length === 1) {
          const b = project.bindingOf(ref, site.name);
          if (b && !b.typeOnly && b.resolved?.startsWith("src/lib/")) {
            const target = project.exported(b.resolved, b.imported);
            if (
              target &&
              !rules.sessionInfra.some((s) => s.name === b.imported && s.home === b.resolved)
            ) {
              if (project.readsMembership(target, readers)) membershipService = true;
            }
          }
        }
        // Rule C, entry part: a direct session reader in an entry's closure.
        for (const r of rules.entrySessionReaders) {
          if (isCallOf(project, ref, site, r)) {
            raw.push({
              rule: "C",
              file: entry.file,
              function: entry.function,
              detail: `calls ${r.name} (session read outside the gates) in ${ref.mod.file}#${ref.fn.name}`,
            });
          }
        }
      }
      // Tenant reach: any value reference to a binding from a reaching src/lib module, except the
      // session and gate functions themselves.
      for (const local of valueRefsIn(ref.fn.node)) {
        const b = project.bindingOf(ref, local);
        if (!b || b.typeOnly || !b.resolved?.startsWith("src/lib/")) continue;
        if (rules.sessionInfra.some((s) => refersTo(project, ref, local, s))) continue;
        if (project.libReaches(b.resolved)) reach = true;
      }
    }
    if (conditional && membershipService)
      gatesFound.add(`${rules.conditionalGate.name}+membership service`);
    // A gate hands out tenant data (a scoped client or the role), so a gated entry reaches it too.
    if (gatesFound.size > 0) reach = true;

    const excluded = rules.ruleAExcludedPrefixes.find((p) => entry.file.startsWith(p));
    const allow = allowedA(entry.file, entry.function);
    if (reach && gatesFound.size === 0 && !excluded) {
      raw.push({
        rule: "A",
        file: entry.file,
        function: entry.function,
        detail: conditional
          ? `reaches tenant data; ${rules.conditionalGate.name} without a membership-reading service`
          : "reaches tenant data without a gate",
      });
    }
    inventory.push({
      file: entry.file,
      function: entry.function,
      kind: entry.kind,
      tenantReach: reach,
      gates: [...gatesFound].join(", "),
      exemption: excluded
        ? `excluded (${excluded})`
        : reach && gatesFound.size === 0
          ? (allow?.reason ?? "")
          : "",
    });

    if (entry.kind === "server-action" || entry.kind === "route-handler") {
      const n = sessionReadCount(project, start, rules, new Set());
      if (n > 1) {
        raw.push({
          rule: "C2",
          file: entry.file,
          function: entry.function,
          detail: `${n} session-reading calls (K141 allows one)`,
        });
      }
    }
  }

  // Rule C, auth.api part, across all of src.
  for (const mod of project.modules.values()) {
    for (const site of callsIn(mod.sf)) {
      if (site.chain.length < 3 || site.chain[1] !== "api") continue;
      const root = site.chain[0];
      const b = mod.imports.get(root);
      const isAuth =
        (b && b.resolved === "src/lib/auth.ts") ||
        (mod.file === "src/lib/auth.ts" && root === "auth");
      if (!isAuth) continue;
      const fnName = project.enclosingFunction(mod, site.node);
      if (site.name === "getSession") {
        const home = rules.sessionReadHome;
        if (mod.file === home.file && fnName === home.function) continue;
        raw.push({
          rule: "C",
          file: mod.file,
          function: fnName,
          detail: `calls auth.api.getSession outside ${home.file}#${home.function} (never allowlisted)`,
        });
        continue;
      }
      raw.push({
        rule: "C",
        file: mod.file,
        function: fnName,
        detail: `calls auth.api.${site.name}`,
      });
    }
  }

  // Rule D, the worker.
  const domain = new Set(rules.domainModels.map(lowerFirst));
  for (const mod of project.modules.values()) {
    if (!mod.file.startsWith("src/lib/worker/")) continue;
    for (const b of mod.imports.values()) {
      if (b.typeOnly) continue;
      const bad =
        b.specifier === "next" ||
        b.specifier.startsWith("next/") ||
        b.resolved?.startsWith("src/app/") ||
        b.resolved === "src/lib/session.ts";
      if (bad) {
        raw.push({
          rule: "D",
          file: mod.file,
          function: "<module>",
          detail: `imports ${b.specifier}`,
        });
      }
    }
    for (const fn of mod.functions.values()) {
      const scoped = scopedNames(fn.node);
      for (const site of callsIn(fn.node)) {
        if (site.chain.length >= 3 && site.chain[1] === "api") {
          const b = mod.imports.get(site.chain[0]);
          if (b?.resolved === "src/lib/auth.ts") {
            raw.push({
              rule: "D",
              file: mod.file,
              function: fn.name,
              detail: `calls auth.api.${site.name}`,
            });
          }
        }
        if (isRawWrite(site)) {
          raw.push({
            rule: "D",
            file: mod.file,
            function: fn.name,
            detail: `raw SQL write (${site.name})`,
          });
          continue;
        }
        if (site.chain.length < 3 || !WRITE_OPS.has(site.name)) continue;
        const model = site.chain[site.chain.length - 2];
        if (!domain.has(model)) continue;
        if (scoped.has(site.chain[0])) continue;
        const arg = site.firstArg;
        const op = site.name;
        let ok: boolean;
        if (op.startsWith("create")) ok = mentionsOrganizationId(propertyOf(arg, "data"));
        else if (op === "upsert") {
          ok =
            mentionsOrganizationId(propertyOf(arg, "where")) &&
            mentionsOrganizationId(propertyOf(arg, "create"));
        } else ok = mentionsOrganizationId(propertyOf(arg, "where"));
        if (!ok) {
          raw.push({
            rule: "D",
            file: mod.file,
            function: fn.name,
            detail: `${site.chain.join(".")} on a DOMAIN_MODELS model without organizationId in its ${op.startsWith("create") ? "data" : "where"} and not through scopedDb`,
          });
        }
      }
    }
  }

  // Allowlist: suppression and hygiene.
  const violations: Violation[] = [];
  const suppressed: { entry: AllowEntry; violation: Violation }[] = [];
  const used = new Set<AllowEntry>();
  for (const v of raw) {
    const neverAllowed = v.rule === "C" && v.detail.includes("never allowlisted");
    const entry = neverAllowed
      ? undefined
      : rules.allowlist.find(
          (e) => e.rule === v.rule && e.file === v.file && e.function === v.function,
        );
    if (entry) {
      used.add(entry);
      suppressed.push({ entry, violation: v });
    } else violations.push(v);
  }
  const hygiene: string[] = [];
  for (const e of rules.allowlist) {
    const label = `${e.rule} ${e.file}#${e.function}`;
    if (!e.reason.trim()) hygiene.push(`${label}: empty reason`);
    const mod = project.modules.get(e.file);
    if (!mod) hygiene.push(`${label}: file does not exist`);
    else if (e.function !== "<module>" && !mod.functions.has(e.function)) {
      hygiene.push(`${label}: function does not exist`);
    }
    if (!used.has(e)) hygiene.push(`${label}: suppresses no finding`);
  }
  return { violations, hygiene, suppressed, inventory };
}
