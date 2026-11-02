// Connection-test error categories (D-25, F-08, K127). The Settings "Test connection" actions (LLM,
// embedding, IMAP, SMTP) used to return the probe's raw error text, which let an org admin map
// the internal network through the Ollama base URL or the mail host fields ("ECONNREFUSED
// 10.0.0.5:11434" versus "ENOTFOUND"). This module maps any thrown value to one of four fixed
// categories. The response carries the category and a correlation ID; the server log line adds
// only an allowlisted error name, code and HTTP status (connectionErrorLogShape).
//
// What it removes: the error-text oracle, and the difference between network and protocol
// failures. Every timeout, refusal, close, DNS or TLS failure and every reply that is not the
// expected protocol, status or response shape falls into one category, connection_failed.
//
// Credentials (K131): authentication_failed is given only where AIDA sends a credential, so that a
// rejection can be a rejection of it (OpenAI and Anthropic API keys, IMAP and SMTP logins). The
// Ollama probes send none and take an admin-typed URL; they wrap every failure in
// UncredentialedProbeError, so an HTTP 401 or 403 there is connection_failed, and a 200 counts only
// with Ollama's response shape (UnexpectedResponseError otherwise). A credential rejection proves
// nothing about the protocol: any service can answer 401.
//
// What remains (docs/SECURITY.md states the same): a service that imitates the protocol's replies
// (on the Ollama URL, Ollama's /api/tags or /api/embed shapes) still passes; timing still differs
// between outcomes; and the probe still connects to the address the admin typed, so SSRF itself
// is not removed.
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

/**
 * Thrown by a probe when the server answered 200 but not with the protocol's response shape (an
 * Ollama /api/tags without a `models` array, K131). Always connection_failed.
 */
export class UnexpectedResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnexpectedResponseError";
  }
}

/**
 * Wraps every failure of a probe that sends no credential (the Ollama probes, K131). A credential
 * signal on its cause chain (HTTP 401 or 403, an auth error name) cannot be a rejection of AIDA's
 * credentials, so the wrapped failure is never authentication_failed. Its other categories are
 * kept, and the log shape reads the wrapped failure, not this wrapper.
 */
export class UncredentialedProbeError extends Error {
  constructor(cause: unknown) {
    super("connection test without credentials failed", { cause });
    this.name = "UncredentialedProbeError";
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
  // A 200 without the protocol's response shape (K131).
  "UnexpectedResponseError",
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
    try {
      current = (current as ErrorLike).cause;
    } catch {
      break; // A hostile getter ends the chain instead of throwing.
    }
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

function constructorName(e: ErrorLike): string | undefined {
  try {
    const ctor = (e as { constructor?: { name?: unknown } }).constructor;
    return ctor && typeof ctor.name === "string" ? ctor.name : undefined;
  } catch {
    return undefined; // A hostile getter must not turn classification into a throw.
  }
}

/** Own `name` plus the constructor name (SDK error classes do not always set `name`). */
function names(e: ErrorLike): string[] {
  const result: string[] = [];
  const own = stringProp(e, "name");
  if (own) result.push(own);
  const ctor = constructorName(e);
  if (ctor) result.push(ctor);
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
 * authentication_failed. A chain that holds an UncredentialedProbeError skips the
 * authentication_failed step (K131), so its 401 or 403 is connection_failed. The raw message is
 * read only to recognise the probes' own "Unsupported provider" errors; no part of it ever leaves
 * this function.
 */
export function classifyConnectionError(e: unknown): ConnectionTestErrorCategory {
  const chain = causeChain(e);
  if (chain.some(isConfig)) return "invalid_configuration";
  const credentialed = !chain.some((link) => link instanceof UncredentialedProbeError);
  if (credentialed && chain.some(isAuth)) return "authentication_failed";
  if (chain.some(isConnection)) return "connection_failed";
  return "unknown";
}

// --- Server log shape (K127, c-WR-02) ---------------------------------------------------------
//
// The log line under the correlation ID carries the error's name, code and HTTP status, each only
// from the fixed sets below. A value outside them is logged as "other" and a missing one as
// "none", so no message, host, port, URL, header or stack can reach the log through these fields.

const LOG_NAMES = new Set([
  "Error",
  "TypeError",
  "SyntaxError",
  "RangeError",
  "DOMException",
  "AbortError",
  "TimeoutError",
  "ConnectionTestConfigError",
  "UnexpectedResponseError",
  // imapflow
  "AuthenticationFailure",
  // ollama
  "ResponseError",
  // undici
  "HTTPParserError",
  "SocketError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
  // openai and anthropic SDKs
  "APIError",
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "APIUserAbortError",
  "AuthenticationError",
  "PermissionDeniedError",
  "BadRequestError",
  "NotFoundError",
  "ConflictError",
  "UnprocessableEntityError",
  "RateLimitError",
  "InternalServerError",
]);

const LOG_CODES = new Set([
  ...CONFIG_CODES,
  ...CONNECTION_CODES,
  // nodemailer
  "EAUTH",
  "ENOAUTH",
  "EOAUTH2",
  "ECONFIG",
  "EENVELOPE",
  "EMESSAGE",
  "ESTREAM",
  "EREQUIRETLS",
  // imapflow parser errors
  ...Array.from({ length: 11 }, (_, i) => `ParserError${i + 1}`),
  "ParserErrorExchange",
  // undici's HTTP parser
  "HPE_INVALID_CONSTANT",
  "HPE_INVALID_VERSION",
  "HPE_INVALID_STATUS",
  "HPE_INVALID_HEADER_TOKEN",
  "HPE_HEADER_OVERFLOW",
  // TLS and certificates
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

const LOG_STATUSES = new Set([
  400, 401, 403, 404, 405, 407, 408, 409, 410, 413, 415, 422, 429, 500, 501, 502, 503, 504,
]);

/** The allowlisted shape of a failure, for the server log line under the correlation ID. */
export interface ConnectionErrorLogShape {
  name: string;
  code: string;
  status: number | "other" | "none";
}

function logName(e: ErrorLike | undefined): string {
  if (!e) return "none";
  const own = stringProp(e, "name");
  const ctor = constructorName(e);
  if (own !== undefined && own !== "Error") return LOG_NAMES.has(own) ? own : "other";
  // Subclasses that keep the inherited name "Error" (imapflow's AuthenticationFailure).
  if (ctor !== undefined && ctor !== "Error" && LOG_NAMES.has(ctor)) return ctor;
  if (own === "Error") return "Error";
  if (ctor !== undefined) return LOG_NAMES.has(ctor) ? ctor : "other";
  return "none";
}

/**
 * The thrown value's name, plus the first `code` and the first HTTP status found on its cause
 * chain, each from a fixed set (otherwise "other", or "none" when absent). Never a message.
 */
export function connectionErrorLogShape(e: unknown): ConnectionErrorLogShape {
  // The K131 wrapper says only that the probe sent no credential; log what it wraps.
  const chain = causeChain(e).filter((link) => !(link instanceof UncredentialedProbeError));
  let code: string | undefined;
  let status: number | undefined;
  for (const link of chain) {
    code ??= stringProp(link, "code");
    status ??=
      numberProp(link, "status") ??
      numberProp(link, "statusCode") ??
      numberProp(link, "status_code");
  }
  return {
    name: logName(chain[0]),
    code: code === undefined ? "none" : LOG_CODES.has(code) ? code : "other",
    status: status === undefined ? "none" : LOG_STATUSES.has(status) ? status : "other",
  };
}
