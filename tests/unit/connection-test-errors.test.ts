import { describe, expect, it } from "vitest";
import {
  CONNECTION_TEST_ERROR_CATEGORIES,
  CONNECTION_TEST_ERROR_MESSAGES,
  ConnectionTestConfigError,
  classifyConnectionError,
  connectionErrorLogShape,
} from "../../src/lib/connection-test/errors";

function withProps(message: string, props: Record<string, unknown>): Error {
  return Object.assign(new Error(message), props);
}

function named(name: string, message = "x"): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

describe("classifyConnectionError (D-25, F-08)", () => {
  it("maps network, DNS, timeout and socket codes to connection_failed", () => {
    for (const code of [
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
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
      "UND_ERR_HEADERS_TIMEOUT",
    ]) {
      expect(classifyConnectionError(withProps("x", { code })), code).toBe("connection_failed");
    }
  });

  it("maps imapflow 1.x connection codes to connection_failed (K127, c-CR-01)", () => {
    for (const code of [
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
      "ParserError1",
      "ParserError11",
      "ParserErrorExchange",
    ]) {
      expect(classifyConnectionError(withProps("x", { code })), code).toBe("connection_failed");
    }
  });

  it("keeps an imapflow authentication failure as authentication_failed", () => {
    class AuthenticationFailure extends Error {
      authenticationFailed = true;
    }
    expect(classifyConnectionError(new AuthenticationFailure("Authentication failed"))).toBe(
      "authentication_failed",
    );
  });

  it("maps protocol mismatches to connection_failed (K127, c-WR-01)", () => {
    // nodemailer: a greeting or reply that is not SMTP.
    expect(classifyConnectionError(withProps("Invalid greeting", { code: "EPROTOCOL" }))).toBe(
      "connection_failed",
    );
    // A body that is not JSON (an HTML page where Ollama was expected).
    expect(classifyConnectionError(new SyntaxError("Unexpected token '<'"))).toBe(
      "connection_failed",
    );
    // undici: a reply that is not HTTP, and its other socket and body failures.
    const notHttp = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Response does not match the HTTP/1.1 protocol"), {
        name: "HTTPParserError",
        code: "HPE_INVALID_CONSTANT",
      }),
    });
    expect(classifyConnectionError(notHttp)).toBe("connection_failed");
    for (const code of [
      "UND_ERR_BODY_TIMEOUT",
      "UND_ERR_CLOSED",
      "UND_ERR_HEADERS_OVERFLOW",
      "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
      "UND_ERR_RES_EXCEEDED_MAX_SIZE",
      "UND_ERR_INFO",
      "UND_ERR_PRX_TLS",
    ]) {
      expect(classifyConnectionError(withProps("x", { code })), code).toBe("connection_failed");
    }
  });

  it("maps a non-auth HTTP status on the probe call to connection_failed (K127, c-WR-01)", () => {
    for (const status of [400, 404, 405, 429, 500, 502, 503]) {
      expect(classifyConnectionError(withProps("x", { status })), `status ${status}`).toBe(
        "connection_failed",
      );
      expect(classifyConnectionError(withProps("x", { statusCode: status }))).toBe(
        "connection_failed",
      );
      // ollama's ResponseError carries `status_code`.
      expect(classifyConnectionError(withProps("x", { status_code: status }))).toBe(
        "connection_failed",
      );
    }
    expect(classifyConnectionError(withProps("x", { status_code: 401 }))).toBe(
      "authentication_failed",
    );
  });

  it("keeps only SMTP 530, 534 and 535 as authentication_failed (K127, c-WR-01)", () => {
    // A non-credential SMTP reply to AUTH (nodemailer still says EAUTH) is a protocol answer.
    for (const responseCode of [421, 454, 500, 502, 504]) {
      expect(
        classifyConnectionError(withProps("Invalid login", { code: "EAUTH", responseCode })),
        String(responseCode),
      ).toBe("connection_failed");
    }
    for (const responseCode of [530, 534, 535]) {
      expect(classifyConnectionError(withProps("x", { code: "EAUTH", responseCode }))).toBe(
        "authentication_failed",
      );
    }
  });

  it("maps TLS and certificate codes to connection_failed", () => {
    for (const code of [
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "ERR_SSL_WRONG_VERSION_NUMBER",
      "ETLS",
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    ]) {
      expect(classifyConnectionError(withProps("x", { code })), code).toBe("connection_failed");
    }
  });

  it("maps SDK connection and abort error names to connection_failed", () => {
    for (const name of [
      "APIConnectionError",
      "APIConnectionTimeoutError",
      "AbortError",
      "TimeoutError",
    ]) {
      expect(classifyConnectionError(named(name)), name).toBe("connection_failed");
    }
    class APIConnectionTimeoutError extends Error {}
    expect(classifyConnectionError(new APIConnectionTimeoutError("t"))).toBe("connection_failed");
  });

  it("maps HTTP 401 and 403 (status or statusCode) to authentication_failed", () => {
    expect(classifyConnectionError({ status: 401 })).toBe("authentication_failed");
    expect(classifyConnectionError({ status: 403 })).toBe("authentication_failed");
    expect(classifyConnectionError(withProps("x", { statusCode: 401 }))).toBe(
      "authentication_failed",
    );
    expect(classifyConnectionError(withProps("x", { statusCode: 403 }))).toBe(
      "authentication_failed",
    );
  });

  it("maps mail auth failures (EAUTH, SMTP 530/534/535, imapflow flag) to authentication_failed", () => {
    expect(classifyConnectionError(withProps("x", { code: "EAUTH" }))).toBe(
      "authentication_failed",
    );
    for (const responseCode of [530, 534, 535]) {
      expect(classifyConnectionError(withProps("x", { responseCode })), String(responseCode)).toBe(
        "authentication_failed",
      );
    }
    expect(classifyConnectionError(withProps("x", { authenticationFailed: true }))).toBe(
      "authentication_failed",
    );
  });

  it("maps SDK AuthenticationError and PermissionDeniedError names to authentication_failed", () => {
    expect(classifyConnectionError(named("AuthenticationError"))).toBe("authentication_failed");
    expect(classifyConnectionError(named("PermissionDeniedError"))).toBe("authentication_failed");
  });

  it("maps config errors, bad URLs, bad ports and RangeErrors to invalid_configuration", () => {
    expect(classifyConnectionError(new ConnectionTestConfigError("bad port"))).toBe(
      "invalid_configuration",
    );
    for (const code of ["ERR_INVALID_URL", "ERR_SOCKET_BAD_PORT", "ERR_OUT_OF_RANGE"]) {
      expect(classifyConnectionError(withProps("x", { code })), code).toBe("invalid_configuration");
    }
    expect(classifyConnectionError(new RangeError("port out of range"))).toBe(
      "invalid_configuration",
    );
  });

  it("maps the probes' Unsupported provider errors to invalid_configuration", () => {
    expect(classifyConnectionError(new Error("Unsupported provider: foo"))).toBe(
      "invalid_configuration",
    );
    expect(classifyConnectionError(new Error("Unsupported embedding provider: foo"))).toBe(
      "invalid_configuration",
    );
  });

  it("walks the cause chain (fetch failed -> cause.code)", () => {
    const fetchFailed = new TypeError("fetch failed", {
      cause: withProps("connect ECONNREFUSED 10.0.0.5:11434", { code: "ECONNREFUSED" }),
    });
    expect(classifyConnectionError(fetchFailed)).toBe("connection_failed");
  });

  it("walks the cause chain up to 5 levels deep and no further", () => {
    const wrap = (inner: unknown, depth: number): unknown => {
      let e = inner;
      for (let i = 0; i < depth; i++) e = new Error("wrapper", { cause: e });
      return e;
    };
    const leaf = withProps("x", { code: "ENOTFOUND" });
    expect(classifyConnectionError(wrap(leaf, 5))).toBe("connection_failed");
    expect(classifyConnectionError(wrap(leaf, 6))).toBe("unknown");
  });

  it("survives a cyclic cause chain", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b", { cause: a });
    a.cause = b;
    expect(classifyConnectionError(a)).toBe("unknown");
  });

  it("applies the fixed precedence invalid > authentication > connection > unknown", () => {
    expect(classifyConnectionError({ status: 401, code: "ECONNREFUSED" })).toBe(
      "authentication_failed",
    );
    expect(classifyConnectionError(withProps("x", { code: "ERR_INVALID_URL", status: 401 }))).toBe(
      "invalid_configuration",
    );
    // Precedence holds across the cause chain too: an auth signal in a cause beats a
    // network code on the outer error.
    expect(
      classifyConnectionError(
        Object.assign(new Error("outer", { cause: { status: 403 } }), { code: "ETIMEDOUT" }),
      ),
    ).toBe("authentication_failed");
  });

  it("classifies empty, non-Error and message-less values as unknown", () => {
    for (const value of [undefined, null, "", 0, 42, new Error(""), {}, [], "ECONNREFUSED"]) {
      expect(classifyConnectionError(value), JSON.stringify(value) ?? "undefined").toBe("unknown");
    }
    // K127: a non-auth HTTP status is connection_failed now (see the c-WR-01 case above).
    expect(classifyConnectionError(withProps("x", { status: 500 }))).toBe("connection_failed");
    expect(classifyConnectionError(withProps("x", { code: 401 }))).toBe("unknown");
    expect(classifyConnectionError(withProps("x", { status: 99 }))).toBe("unknown");
    expect(classifyConnectionError(withProps("x", { status: "500" }))).toBe("unknown");
  });

  it("returns only the four ASCII category literals, whatever the raw message encoding", () => {
    const inputs: unknown[] = [
      new Error("connect ECONNREFUSED 10.0.0.5:11434"),
      new Error("\u0000�‮evil\u{1F600} 10.0.0.5"),
      withProps("Ünsupported provider", { code: "ECONNREFUSED" }),
      new Error("unsupported provider: lowercase"),
      Symbol("s"),
      () => "fn",
    ];
    for (const input of inputs) {
      const category = classifyConnectionError(input);
      expect(CONNECTION_TEST_ERROR_CATEGORIES).toContain(category);
      expect(/^[a-z_]+$/.test(category)).toBe(true);
    }
  });

  it("exposes exactly four categories, each with a fixed human message", () => {
    expect([...CONNECTION_TEST_ERROR_CATEGORIES]).toEqual([
      "invalid_configuration",
      "authentication_failed",
      "connection_failed",
      "unknown",
    ]);
    expect(CONNECTION_TEST_ERROR_MESSAGES).toEqual({
      invalid_configuration:
        "The settings are incomplete or invalid. Check the provider, host, port and URL.",
      authentication_failed:
        "The server rejected the credentials. Check the API key, username or password.",
      connection_failed:
        "AIDA could not reach the server, or the server did not answer as expected (for example a different service on that port, or a model that does not exist there). Check the address, the port and the model name, and that the right server is running and reachable from AIDA.",
      unknown:
        "The connection test failed for an unknown reason. Check the server log for the reference below.",
    });
  });
});

describe("connectionErrorLogShape (K127, c-WR-02)", () => {
  it("gives the name, the first code and the first HTTP status found on the cause chain", () => {
    const fetchFailed = new TypeError("fetch failed", {
      cause: withProps("connect ECONNREFUSED 10.0.0.5:11434", { code: "ECONNREFUSED" }),
    });
    expect(connectionErrorLogShape(fetchFailed)).toEqual({
      name: "TypeError",
      code: "ECONNREFUSED",
      status: "none",
    });

    const notFound = Object.assign(new Error("model 'llama3' not found at 10.0.0.5"), {
      name: "ResponseError",
      status_code: 404,
    });
    expect(connectionErrorLogShape(notFound)).toEqual({
      name: "ResponseError",
      code: "none",
      status: 404,
    });

    class AuthenticationFailure extends Error {
      authenticationFailed = true;
    }
    expect(connectionErrorLogShape(new AuthenticationFailure("Authentication failed"))).toEqual({
      name: "AuthenticationFailure",
      code: "none",
      status: "none",
    });
    expect(
      connectionErrorLogShape(
        withProps("Greeting from mail.internal.example", { code: "GREETING_TIMEOUT" }),
      ),
    ).toEqual({ name: "Error", code: "GREETING_TIMEOUT", status: "none" });
  });

  it("logs anything outside the fixed sets as other, and nothing at all as none", () => {
    expect(
      connectionErrorLogShape(
        Object.assign(new Error("x"), {
          name: "Error at http://10.0.0.5:11434",
          code: "ECONNREFUSED 10.0.0.5:11434",
          status: 599,
        }),
      ),
    ).toEqual({ name: "other", code: "other", status: "other" });
    expect(connectionErrorLogShape(withProps("x", { status: 1e9 }))).toEqual({
      name: "Error",
      code: "none",
      status: "other",
    });
    for (const value of [undefined, null, "", "ECONNREFUSED 10.0.0.5", 42, Symbol("s")]) {
      expect(connectionErrorLogShape(value)).toEqual({
        name: "none",
        code: "none",
        status: "none",
      });
    }
  });

  it("never carries a message, host, port, URL, header or stack, whatever the input", () => {
    const hostile = Object.assign(
      new Error(
        "401 sk-live-SHAPE at https://user:pw@llm.corp.example:8443/v1 Authorization: Bearer t0k",
      ),
      {
        name: "sk-live-NAME",
        code: "sk-live-CODE",
        status: "401 sk-live-STATUS",
        headers: { authorization: "Bearer sk-live-HEADER" },
        cause: withProps("connect 10.0.0.5:11434", { code: "10.0.0.5", url: "http://10.0.0.5" }),
      },
    );
    const shape = connectionErrorLogShape(hostile);
    expect(Object.keys(shape).sort()).toEqual(["code", "name", "status"]);
    const text = JSON.stringify(shape);
    for (const fragment of ["sk-live", "10.0.0.5", "llm.corp.example", "8443", "Bearer", "http"]) {
      expect(text).not.toContain(fragment);
    }
  });

  it("survives hostile getters and cycles", () => {
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
      },
    );
    expect(connectionErrorLogShape(trap)).toEqual({ name: "none", code: "none", status: "none" });
    const a = new Error("a") as Error & { cause?: unknown };
    a.cause = a;
    expect(connectionErrorLogShape(a)).toEqual({ name: "Error", code: "none", status: "none" });
  });
});
