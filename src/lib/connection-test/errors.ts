// Connection-test error categories (D-25, F-08). The Settings "Test connection" actions (LLM,
// embedding, IMAP, SMTP) used to return the probe's raw error text, which let an org admin map
// the internal network through the Ollama base URL or the mail host fields ("ECONNREFUSED
// 10.0.0.5:11434" versus "ENOTFOUND"). This module maps any thrown value to one of four fixed
// categories, so the response and the server log carry a category and a correlation ID only.
//
// What it does NOT do: it does not stop SSRF (the probe still connects to the address the admin
// typed) and it does not hide timing differences between categories. It only removes the
// error-text oracle; docs/SECURITY.md states the residual.
//
// No imports at all: client-safe (the buttons read CONNECTION_TEST_ERROR_MESSAGES) and
// bundleable by both webpack and esbuild.

export const CONNECTION_TEST_ERROR_CATEGORIES = [
  "invalid_configuration",
  "authentication_failed",
  "connection_failed",
  "unknown",
] as const;

export type ConnectionTestErrorCategory = (typeof CONNECTION_TEST_ERROR_CATEGORIES)[number];

/**
 * Result of every Settings connection test: success, or one fixed category plus a fresh
 * correlation ID that matches the server log line. Never carries the raw failure text.
 */
export type ConnectionTestResult =
  | { ok: true }
  | { ok: false; error: ConnectionTestErrorCategory; correlationId: string };

/** Thrown by the actions' own input validation (bad port, empty host); always invalid_configuration. */
export class ConnectionTestConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionTestConfigError";
  }
}

/** Fixed human text per category; the only failure text a button may render. */
export const CONNECTION_TEST_ERROR_MESSAGES: Record<ConnectionTestErrorCategory, string> = {
  invalid_configuration:
    "The settings are incomplete or invalid. Check the provider, host, port and URL.",
  authentication_failed:
    "The server rejected the credentials. Check the API key, username or password.",
  connection_failed:
    "AIDA could not reach the server, or the server did not answer as expected (for example a different service on that port, or a model that does not exist there). Check the address, the port and the model name, and that the right server is running and reachable from AIDA.",
  unknown:
    "The connection test failed for an unknown reason. Check the server log for the reference below.",
};

/** How many `cause` links are followed below the thrown value (fetch failed -> cause.code). */
const MAX_CAUSE_DEPTH = 5;

const CONFIG_CODES = new Set(["ERR_INVALID_URL", "ERR_SOCKET_BAD_PORT", "ERR_OUT_OF_RANGE"]);
const CONFIG_MESSAGE_PREFIXES = ["Unsupported provider", "Unsupported embedding provider"];

const AUTH_STATUSES = new Set([401, 403]);
const AUTH_SMTP_RESPONSE_CODES = new Set([530, 534, 535]);
const AUTH_NAMES = new Set(["AuthenticationError", "PermissionDeniedError"]);

const CONNECTION_CODES = new Set([
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ECONNABORTED",
  "ESOCKET",
  "ECONNECTION",
  "EDNS",
  "ETLS",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CLOSED",
  "UND_ERR_HEADERS_OVERFLOW",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_RES_EXCEEDED_MAX_SIZE",
  "UND_ERR_INFO",
  "UND_ERR_PRX_TLS",
  // nodemailer: a greeting or reply that is not SMTP (K127).
  "EPROTOCOL",
  // imapflow 1.x (lib/imap-flow.js, lib/connection-deadline.js, lib/handler/*): timeouts, early
  // close, lost connection, and replies that are not IMAP (K127).
  "CONNECT_TIMEOUT",
  "GREETING_TIMEOUT",
  "UPGRADE_TIMEOUT",
  "ETIMEOUT",
  "NoConnection",
  "EConnectionClosed",
  "ClosedAfterConnectText",
  "ClosedAfterConnectTLS",
  "STARTTLS_INJECTION",
  "InvalidResponse",
  "UnexpectedTag",
  "ResponseProcessingFailed",
  "LineTooLarge",
  "ResponseTooLarge",
  "LiteralTooLarge",
  "MAX_IMAP_NESTING_REACHED",
  "ETHROTTLE",
  "COMPRESS_TRAILING_DATA",
]);
/**
 * imapflow's parser errors (`ParserError1` ... `ParserError11`, `ParserErrorExchange`) and the
 * llhttp parser codes undici sets when a reply is not HTTP (`HPE_INVALID_CONSTANT`, ...).
 */
const CONNECTION_CODE_PREFIXES = ["ParserError", "HPE_"];
const CONNECTION_NAMES = new Set([
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "AbortError",
  "TimeoutError",
  // undici's socket, parser and timeout errors.
  "HTTPParserError",
  "SocketError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
  // A body that is not JSON where the probe expects JSON (K127).
  "SyntaxError",
]);

type ErrorLike = Record<string, unknown>;

/** The thrown value plus up to MAX_CAUSE_DEPTH causes; non-objects are skipped, cycles stop. */
function causeChain(e: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  const seen = new Set<unknown>();
  let current: unknown = e;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (current === null || typeof current !== "object" || seen.has(current)) break;
    seen.add(current);
    chain.push(current as ErrorLike);
    current = (current as ErrorLike).cause;
  }
  return chain;
}

function stringProp(e: ErrorLike, key: string): string | undefined {
  try {
    const value = e[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function numberProp(e: ErrorLike, key: string): number | undefined {
  try {
    const value = e[key];
    return typeof value === "number" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Own `name` plus the constructor name (SDK error classes do not always set `name`). */
function names(e: ErrorLike): string[] {
  const result: string[] = [];
  const own = stringProp(e, "name");
  if (own) result.push(own);
  try {
    const ctor = (e as { constructor?: { name?: unknown } }).constructor;
    if (ctor && typeof ctor.name === "string") result.push(ctor.name);
  } catch {
    // A hostile getter must not turn classification into a throw.
  }
  return result;
}

function isConfig(e: ErrorLike): boolean {
  if (e instanceof ConnectionTestConfigError || e instanceof RangeError) return true;
  const code = stringProp(e, "code");
  if (code && CONFIG_CODES.has(code)) return true;
  const message = stringProp(e, "message");
  return !!message && CONFIG_MESSAGE_PREFIXES.some((prefix) => message.startsWith(prefix));
}

/** An HTTP status on the error (`status`, `statusCode`, or ollama's `status_code`), 100..599. */
function httpStatus(e: ErrorLike): number | undefined {
  const status =
    numberProp(e, "status") ?? numberProp(e, "statusCode") ?? numberProp(e, "status_code");
  return status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

/** An SMTP reply code on a nodemailer error (`responseCode`), 200..599. */
function smtpReplyCode(e: ErrorLike): number | undefined {
  const code = numberProp(e, "responseCode");
  return code !== undefined && Number.isInteger(code) && code >= 200 && code <= 599
    ? code
    : undefined;
}

function isAuth(e: ErrorLike): boolean {
  const status = httpStatus(e);
  if (status !== undefined && AUTH_STATUSES.has(status)) return true;
  const responseCode = smtpReplyCode(e);
  if (responseCode !== undefined && AUTH_SMTP_RESPONSE_CODES.has(responseCode)) return true;
  // nodemailer's EAUTH without a server reply is its own credential check ("Missing credentials").
  // With a reply other than 530, 534 or 535 the server did not reject the credentials (K127).
  if (stringProp(e, "code") === "EAUTH" && responseCode === undefined) return true;
  try {
    if (e.authenticationFailed === true) return true;
  } catch {
    // fall through
  }
  return names(e).some((name) => AUTH_NAMES.has(name));
}

function isConnection(e: ErrorLike): boolean {
  // Any other HTTP status on the probe call, or any other SMTP reply: a server answered, but not
  // as the probe expected (another web server, a missing model, a non-credential SMTP refusal).
  if (httpStatus(e) !== undefined || smtpReplyCode(e) !== undefined) return true;
  const code = stringProp(e, "code");
  if (code) {
    if (CONNECTION_CODES.has(code)) return true;
    if (CONNECTION_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))) return true;
    if (code.startsWith("ERR_TLS_") || code.startsWith("ERR_SSL_") || code.startsWith("CERT_")) {
      return true;
    }
    if (code.includes("SELF_SIGNED") || code.includes("UNABLE_TO_VERIFY")) return true;
  }
  return names(e).some((name) => CONNECTION_NAMES.has(name));
}

/**
 * Maps any thrown value to one of the four categories. Precedence is fixed and applies across
 * the whole cause chain: invalid_configuration, then authentication_failed, then
 * connection_failed, then unknown. So `{ status: 401, code: "ECONNREFUSED" }` is
 * authentication_failed. The raw message is read only to recognise the probes' own
 * "Unsupported provider" errors; no part of it ever leaves this function.
 */
export function classifyConnectionError(e: unknown): ConnectionTestErrorCategory {
  const chain = causeChain(e);
  if (chain.some(isConfig)) return "invalid_configuration";
  if (chain.some(isAuth)) return "authentication_failed";
  if (chain.some(isConnection)) return "connection_failed";
  return "unknown";
}
