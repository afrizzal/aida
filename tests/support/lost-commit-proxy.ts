// A TCP proxy between the app's pg pool and the test Postgres that loses the reply to a COMMIT
// (run decision K148, Codex diff critique round 1, finding 1). Every byte is passed through until
// the proxy is armed with a table name. The first connection that then sends an INSERT into that
// table is watched: the server's frames after the INSERT are held back until the next
// ReadyForQuery. A ReadyForQuery with status `I` (idle) means the server has committed the work,
// either the transaction's COMMIT or an autocommit INSERT; the proxy drops that reply and
// destroys both sockets, so the server has committed and the client sees only a broken
// connection. A ReadyForQuery with any other status (inside a transaction) is passed on with the
// held frames. Plain TCP only (no TLS); the Testcontainers URL has no sslmode.
import net from "node:net";

export interface LostCommitProxy {
  /** The DATABASE_URL that routes through the proxy. */
  url: string;
  /** Loses the commit reply of the next connection that inserts into `table`. */
  arm(table: string): void;
  /** How many commit replies were lost so far. */
  readonly lost: number;
  close(): Promise<void>;
}

export async function startLostCommitProxy(targetUrl: string): Promise<LostCommitProxy> {
  const target = new URL(targetUrl);
  const host = target.hostname;
  const port = Number(target.port || 5432);
  let armedTable: string | null = null;
  let lost = 0;
  const sockets = new Set<net.Socket>();

  const server = net.createServer((client) => {
    const upstream = net.connect({ host, port });
    sockets.add(client);
    sockets.add(upstream);
    client.on("close", () => sockets.delete(client));
    upstream.on("close", () => sockets.delete(upstream));
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());

    let watched = false;
    let pending = Buffer.alloc(0);
    let held: Buffer[] = [];

    client.on("data", (chunk: Buffer) => {
      if (!watched && armedTable && chunk.includes(`INSERT INTO "public"."${armedTable}"`)) {
        watched = true;
        armedTable = null;
      }
      upstream.write(chunk);
    });

    upstream.on("data", (chunk: Buffer) => {
      if (!watched) {
        client.write(chunk);
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      // Server messages are framed: one type byte, then an int32 length that counts itself.
      while (pending.length >= 5) {
        const length = pending.readInt32BE(1);
        if (pending.length < 1 + length) break;
        const frame = pending.subarray(0, 1 + length);
        pending = pending.subarray(1 + length);
        if (frame[0] !== 0x5a /* Z, ReadyForQuery */) {
          held.push(frame);
          continue;
        }
        if (frame[5] === 0x49 /* I: idle, the work is committed */) {
          lost += 1;
          held = [];
          pending = Buffer.alloc(0);
          client.destroy();
          upstream.destroy();
          return;
        }
        client.write(Buffer.concat([...held, frame]));
        held = [];
      }
    });

    client.on("end", () => upstream.end());
    upstream.on("end", () => client.end());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;
  const proxied = new URL(targetUrl);
  proxied.hostname = "127.0.0.1";
  proxied.port = String(address.port);

  return {
    url: proxied.toString(),
    arm(table: string) {
      armedTable = table;
    },
    get lost() {
      return lost;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
