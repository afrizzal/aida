import { describe, expect, it } from "vitest";
import {
  CONNECTION_TEST_ERROR_CATEGORIES,
  CONNECTION_TEST_ERROR_MESSAGES,
  ConnectionTestConfigError,
  classifyConnectionError,
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
    expect(classifyConnectionError(withProps("x", { status: 500 }))).toBe("unknown");
    expect(classifyConnectionError(withProps("x", { code: 401 }))).toBe("unknown");
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
        "AIDA could not reach the server. Check the address and that the server is running and reachable from AIDA.",
      unknown:
        "The connection test failed for an unknown reason. Check the server log for the reference below.",
    });
  });
});
