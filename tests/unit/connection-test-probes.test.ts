import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createImapClient } from "../../src/lib/channels/email/imap-client";
import {
  EMAIL_PROBE_TIMEOUT_MS,
  probeImapConnection,
  probeSmtpConnection,
} from "../../src/lib/channels/email/test-connection";
import { classifyConnectionError } from "../../src/lib/connection-test/errors";
import { PROBE_TIMEOUT_MS, testProviderConnection } from "../../src/lib/llm/test-connection";
import {
  EMBEDDING_PROBE_TIMEOUT_MS,
  testEmbeddingConnection,
} from "../../src/lib/rag/embed-test-connection";

// K127 (08-REVIEW.md, c-CR-01): the real probe clients against local fake servers on 127.0.0.1.
// Every network or protocol failure (closed port, a port that never greets, a port running some
// other service) gives the same category, so the category cannot tell an open port from a closed
// one. Only a server of the probed protocol rejecting the credentials gives authentication_failed.
// The Ollama probes send no credential, so for them an HTTP 401 or 403 is connection_failed too,
// and a 200 passes only with the Ollama response shape (K131).
// No test here connects anywhere but 127.0.0.1.

/** Short per-phase budget for the tests, passed through the same option the actions use. */
const TEST_TIMEOUT_MS = 300;

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A TCP server on 127.0.0.1 with a random port; every accepted socket is destroyed afterwards. */
async function tcpServer(onSocket: (socket: net.Socket) => void): Promise<number> {
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    onSocket(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

/** An HTTP server on 127.0.0.1 with a random port. */
async function httpServer(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

/** Answers every request with one fixed status, content type and body. */
const httpAnswer = (status: number, contentType: string, body: string) =>
  httpServer((_req, res) => {
    res.writeHead(status, { "content-type": contentType });
    res.end(body);
  });

/** A port on 127.0.0.1 that was free a moment ago and has nothing listening now. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((r) => server.close(r));
  return port;
}

/** Accepts the connection and never sends a byte (a service that waits for the client). */
const silent = () => tcpServer(() => {});

/** Sends another protocol's banner and closes (an SSH or HTTP port probed as mail). */
const bannerAndClose = (banner: string) => tcpServer((socket) => socket.end(banner));

/** Sends another protocol's banner and keeps the connection open. */
const bannerAndWait = (banner: string) => tcpServer((socket) => socket.write(banner));

/** Feeds each CRLF-terminated line to `onLine`. */
function onLines(socket: net.Socket, onLine: (line: string) => void) {
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("latin1");
    for (let i = buffer.indexOf("\r\n"); i >= 0; i = buffer.indexOf("\r\n")) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      onLine(line);
    }
  });
}

/** A minimal IMAP server: greets, answers CAPABILITY, rejects every LOGIN. */
const imapRejectingLogin = () =>
  tcpServer((socket) => {
    socket.write("* OK [CAPABILITY IMAP4rev1] fake IMAP ready\r\n");
    onLines(socket, (line) => {
      const [tag, command = ""] = line.split(" ");
      switch (command.toUpperCase()) {
        case "CAPABILITY":
          socket.write(`* CAPABILITY IMAP4rev1\r\n${tag} OK done\r\n`);
          break;
        case "LOGIN":
          socket.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
          break;
        case "LOGOUT":
          socket.end(`* BYE\r\n${tag} OK bye\r\n`);
          break;
        default:
          socket.write(`${tag} BAD unknown command\r\n`);
      }
    });
  });

/** The category the action would return for whatever the probe throws. */
async function categoryOf(probe: Promise<void>): Promise<string> {
  try {
    await probe;
  } catch (e) {
    return classifyConnectionError(e);
  }
  throw new Error("the probe unexpectedly succeeded");
}

const imapConfig = (port: number) => ({
  imapHost: "127.0.0.1",
  imapPort: port,
  imapSecure: false,
  imapUser: "support",
  imapPassword: "fake-imap-password",
});

const imapCategory = (port: number) =>
  categoryOf(probeImapConnection(imapConfig(port), { timeoutMs: TEST_TIMEOUT_MS }));

describe("IMAP probe with the real imapflow client (K127, c-CR-01)", () => {
  it("gives connection_failed for a closed port", async () => {
    expect(await imapCategory(await closedPort())).toBe("connection_failed");
  });

  it("gives connection_failed for a port that accepts and never greets", async () => {
    expect(await imapCategory(await silent())).toBe("connection_failed");
  });

  it("gives connection_failed for a non-IMAP banner followed by a close", async () => {
    expect(await imapCategory(await bannerAndClose("SSH-2.0-OpenSSH_9.6\r\n"))).toBe(
      "connection_failed",
    );
  });

  it("gives connection_failed for a non-IMAP banner on a connection that stays open", async () => {
    expect(await imapCategory(await bannerAndWait("HTTP/1.1 400 Bad Request\r\n\r\n"))).toBe(
      "connection_failed",
    );
  });

  it("gives authentication_failed only when an IMAP server rejects LOGIN", async () => {
    expect(await imapCategory(await imapRejectingLogin())).toBe("authentication_failed");
  });

  it("collapses closed, silent and wrong-service into one category", async () => {
    const categories = new Set([
      await imapCategory(await closedPort()),
      await imapCategory(await silent()),
      await imapCategory(await bannerAndClose("SSH-2.0-OpenSSH_9.6\r\n")),
    ]);
    expect([...categories]).toEqual(["connection_failed"]);
  });

  it("bounds the TCP connect phase with the same timeout as the greeting (no 90 s default)", () => {
    const client = createImapClient(imapConfig(993), { timeoutMs: 1234 });
    const options = (client as unknown as { options: Record<string, unknown> }).options;
    expect(options.connectionTimeout).toBe(1234);
    expect(options.greetingTimeout).toBe(1234);
    expect(EMAIL_PROBE_TIMEOUT_MS).toBe(10_000);
  });
});

/** A minimal SMTP server: greets, advertises AUTH, answers AUTH with `authReply`. */
const smtpRejectingAuth = (authReply: string) =>
  tcpServer((socket) => {
    socket.write("220 fake.test ESMTP ready\r\n");
    onLines(socket, (line) => {
      const command = (line.split(" ")[0] ?? "").toUpperCase();
      if (command === "EHLO") socket.write("250-fake.test\r\n250 AUTH PLAIN LOGIN\r\n");
      else if (command === "AUTH") socket.write(`${authReply}\r\n`);
      else if (command === "QUIT") socket.end("221 bye\r\n");
      else socket.write("502 5.5.2 not implemented\r\n");
    });
  });

const smtpCategory = (port: number) =>
  categoryOf(
    probeSmtpConnection(
      {
        smtpHost: "127.0.0.1",
        smtpPort: port,
        smtpSecure: false,
        smtpUser: "support",
        smtpPassword: "fake-smtp-password",
      },
      { timeoutMs: TEST_TIMEOUT_MS },
    ),
  );

describe("SMTP probe with the real nodemailer client (K127, c-WR-01)", () => {
  it.each([
    ["a closed port", () => closedPort()],
    ["a port that accepts and never greets", () => silent()],
    ["an SSH banner followed by a close", () => bannerAndClose("SSH-2.0-OpenSSH_9.6\r\n")],
    [
      "an HTTP reply on an open connection",
      () => bannerAndWait("HTTP/1.1 400 Bad Request\r\n\r\n"),
    ],
    ["a server that closes at once", () => tcpServer((socket) => socket.destroy())],
    [
      "an SMTP server answering AUTH with a non-credential reply (454)",
      () => smtpRejectingAuth("454 4.7.0 Temporary authentication failure"),
    ],
  ])("gives connection_failed for %s", async (_label, start) => {
    expect(await smtpCategory(await start())).toBe("connection_failed");
  });

  it.each([
    ["530 5.7.0 Authentication required"],
    ["534 5.7.9 Authentication mechanism is too weak"],
    ["535 5.7.8 Authentication credentials invalid"],
  ])("gives authentication_failed when an SMTP server answers AUTH with %s", async (reply) => {
    expect(await smtpCategory(await smtpRejectingAuth(reply))).toBe("authentication_failed");
  });

  it("collapses closed, silent and wrong-service into one category", async () => {
    const categories = new Set([
      await smtpCategory(await closedPort()),
      await smtpCategory(await silent()),
      await smtpCategory(await bannerAndClose("SSH-2.0-OpenSSH_9.6\r\n")),
      await smtpCategory(await tcpServer((socket) => socket.destroy())),
    ]);
    expect([...categories]).toEqual(["connection_failed"]);
  });
});

const ollamaProbes = {
  llm: (port: number) =>
    testProviderConnection({
      provider: "ollama",
      model: "llama3",
      apiKey: "",
      ollamaBaseUrl: `http://127.0.0.1:${port}`,
    }),
  embedding: (port: number) =>
    testEmbeddingConnection({
      provider: "ollama",
      model: "nomic-embed-text",
      apiKey: "",
      ollamaBaseUrl: `http://127.0.0.1:${port}`,
    }),
};

describe.each(
  Object.entries(ollamaProbes),
)("Ollama %s probe with the real ollama client (K127, c-WR-01)", (_probe, run) => {
  const ollamaCategory = async (port: number) => categoryOf(run(port));

  it.each([
    ["a closed port", () => closedPort()],
    [
      "an HTTP 404 with a text body (any web server, or a missing model)",
      () => httpAnswer(404, "text/plain", "404 page not found"),
    ],
    [
      "an HTTP 404 with an Ollama JSON error",
      () =>
        httpAnswer(404, "application/json", '{"error":"model not found, try pulling it first"}'),
    ],
    ["an HTTP 500", () => httpAnswer(500, "application/json", '{"error":"boom"}')],
    ["a 200 with a body that is not JSON", () => httpAnswer(200, "text/html", "<html>hi</html>")],
    ["a non-HTTP banner followed by a close", () => bannerAndClose("SSH-2.0-OpenSSH_9.6\r\n")],
    ["a server that closes at once", () => tcpServer((socket) => socket.destroy())],
  ])("gives connection_failed for %s", async (_label, start) => {
    expect(await ollamaCategory(await start())).toBe("connection_failed");
  });

  // K131: AIDA sends Ollama no credential, so a 401 or 403 there cannot be a rejection of AIDA's
  // credentials. It is some other service (or a proxy) at the address: connection_failed. This
  // case used to pin authentication_failed (K127), which was the oracle Codex 1 names.
  it.each([
    [401, "application/json", '{"error":"denied"}'],
    [403, "application/json", '{"error":"denied"}'],
    [401, "text/html", "<html>Unauthorized</html>"],
    [403, "text/plain", "Forbidden"],
  ])("gives connection_failed for a foreign HTTP %i (%s)", async (status, type, body) => {
    expect(await ollamaCategory(await httpAnswer(status, type, body))).toBe("connection_failed");
  });

  it.each([
    ["an empty JSON object", "{}"],
    ["a foreign status object", '{"status":"ok","version":"1.2.3"}'],
    ["a JSON array", "[]"],
    ["JSON null", "null"],
    ["a models field that is not an array", '{"models":"llama3"}'],
    ["an embeddings field that is not an array", '{"embeddings":{"0":[0.1]}}'],
    ["an empty embedding vector", '{"embeddings":[[]]}'],
    ["an embedding vector of strings", '{"embeddings":[["0.1","0.2"]]}'],
    ["an embedding vector with a null", '{"embeddings":[[0.1,null]]}'],
  ])("gives connection_failed for a foreign 200 JSON body: %s", async (_label, body) => {
    expect(await ollamaCategory(await httpAnswer(200, "application/json", body))).toBe(
      "connection_failed",
    );
  });

  it("collapses closed, other web servers and other services into one category", async () => {
    const categories = new Set([
      await ollamaCategory(await closedPort()),
      await ollamaCategory(await httpAnswer(404, "text/plain", "404 page not found")),
      await ollamaCategory(await httpAnswer(200, "text/html", "<html>hi</html>")),
      await ollamaCategory(await httpAnswer(200, "application/json", '{"status":"ok"}')),
      await ollamaCategory(await httpAnswer(401, "application/json", '{"error":"denied"}')),
      await ollamaCategory(await httpAnswer(403, "text/plain", "Forbidden")),
      await ollamaCategory(await bannerAndClose("SSH-2.0-OpenSSH_9.6\r\n")),
    ]);
    expect([...categories]).toEqual(["connection_failed"]);
  });
});

/** A fake Ollama on 127.0.0.1: the /api/tags and /api/embed shapes a real Ollama returns. */
const fakeOllama = (models: unknown[] = []) =>
  httpServer((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/api/tags")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models }));
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/api/embed")) {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: "nomic-embed-text", embeddings: [[0.12, -0.5, 3]] }));
      });
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("404 page not found");
  });

describe("Ollama probes pass only on the Ollama response shape (K131)", () => {
  it("the LLM probe passes on /api/tags with a models array, empty or not", async () => {
    await expect(ollamaProbes.llm(await fakeOllama())).resolves.toBeUndefined();
    await expect(
      ollamaProbes.llm(await fakeOllama([{ name: "llama3", model: "llama3" }])),
    ).resolves.toBeUndefined();
  });

  it("the embedding probe passes on /api/embed with an embeddings array of number arrays", async () => {
    await expect(ollamaProbes.embedding(await fakeOllama())).resolves.toBeUndefined();
  });

  it("a closed port still fails both probes as connection_failed", async () => {
    const port = await closedPort();
    expect(await categoryOf(ollamaProbes.llm(port))).toBe("connection_failed");
    expect(await categoryOf(ollamaProbes.embedding(port))).toBe("connection_failed");
  });
});

describe("Ollama probe deadline (c-WR-03)", () => {
  it("defaults to the documented 10 s budget for the Settings actions", () => {
    expect(PROBE_TIMEOUT_MS).toBe(10_000);
    expect(EMBEDDING_PROBE_TIMEOUT_MS).toBe(10_000);
  });

  const probes = {
    llm: (port: number) =>
      testProviderConnection(
        {
          provider: "ollama",
          model: "llama3",
          apiKey: "",
          ollamaBaseUrl: `http://127.0.0.1:${port}`,
        },
        { timeoutMs: TEST_TIMEOUT_MS },
      ),
    embedding: (port: number) =>
      testEmbeddingConnection(
        {
          provider: "ollama",
          model: "nomic-embed-text",
          apiKey: "",
          ollamaBaseUrl: `http://127.0.0.1:${port}`,
        },
        { timeoutMs: TEST_TIMEOUT_MS },
      ),
  };

  it.each(
    Object.entries(probes),
  )("%s: a port that accepts and never answers fails as connection_failed within the timeout", async (_probe, run) => {
    const started = Date.now();
    expect(await categoryOf(run(await silent()))).toBe("connection_failed");
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it.each(
    Object.entries(probes),
  )("%s: an HTTP server that never sends a response fails as connection_failed within the timeout", async (_probe, run) => {
    const started = Date.now();
    expect(await categoryOf(run(await httpServer(() => {})))).toBe("connection_failed");
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it.each(
    Object.entries(probes),
  )("%s: headers sent, body never finished, fails as connection_failed within the timeout", async (_probe, run) => {
    const port = await httpServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"models":');
    });
    const started = Date.now();
    expect(await categoryOf(run(port))).toBe("connection_failed");
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
