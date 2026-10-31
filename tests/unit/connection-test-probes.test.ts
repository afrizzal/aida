import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createImapClient } from "../../src/lib/channels/email/imap-client";
import {
  EMAIL_PROBE_TIMEOUT_MS,
  probeImapConnection,
} from "../../src/lib/channels/email/test-connection";
import { classifyConnectionError } from "../../src/lib/connection-test/errors";

// K127 (08-REVIEW.md, c-CR-01): the real probe clients against local fake servers on 127.0.0.1.
// Every network or protocol failure (closed port, a port that never greets, a port running some
// other service) gives the same category, so the category cannot tell an open port from a closed
// one. Only a server of the probed protocol rejecting the credentials gives authentication_failed.
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
