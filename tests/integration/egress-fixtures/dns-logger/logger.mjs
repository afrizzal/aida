// Minimal logging DNS server for the egress-isolation test (07-09.1 Task 1). No npm
// dependencies (dgram/fs are Node builtins) — this runs INSIDE the `internal: true` compose
// network as every other service's forwarding resolver (see docker-compose.egress-test.yml's
// `dns:` field on each service). Docker's embedded per-container resolver (127.0.0.11) always
// answers container/service-name lookups itself; anything it doesn't recognize gets forwarded
// here. On an internal network, Docker does NOT forward such queries anywhere by default (a
// plain lookup just times out silently — proven experimentally: EAI_AGAIN, no signal at all).
// Pointing every service's `dns:` at THIS container is what turns "attempted an external lookup"
// into an observable, logged event.
//
// Logs every query's requested name to stdout (captured via `docker compose logs dns-logger`)
// AND to a bind-mounted file (read directly by the host-side vitest test), then replies
// NXDOMAIN — correct protocol behavior, and irrelevant either way since this network has no
// route to resolve anything real.
import dgram from "node:dgram";
import fs from "node:fs";

const LOG_PATH = "/var/log/dns-queries.log";

function parseQName(msg) {
  let offset = 12; // fixed 12-byte DNS header
  const labels = [];
  while (offset < msg.length) {
    const len = msg[offset];
    if (len === 0) {
      offset += 1;
      break;
    }
    labels.push(msg.subarray(offset + 1, offset + 1 + len).toString("ascii"));
    offset += len + 1;
  }
  return { name: labels.join("."), questionEnd: offset + 4 }; // +4 = QTYPE(2) + QCLASS(2)
}

function buildNxdomainResponse(query) {
  const { questionEnd } = parseQName(query);
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // echo the query ID
  header.writeUInt16BE(0x8183, 2); // QR=1 (response), RD+RA, RCODE=3 (NXDOMAIN)
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(0, 6); // ANCOUNT
  header.writeUInt16BE(0, 8); // NSCOUNT
  header.writeUInt16BE(0, 10); // ARCOUNT
  const question = query.subarray(12, questionEnd);
  return Buffer.concat([header, question]);
}

const server = dgram.createSocket("udp4");

server.on("message", (msg, rinfo) => {
  let name = "<unparseable>";
  try {
    name = parseQName(msg).name;
  } catch {
    // leave <unparseable>
  }
  const line = `${new Date().toISOString()} query from=${rinfo.address} name=${name}\n`;
  process.stdout.write(`[dns-logger] ${line}`);
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch (err) {
    process.stdout.write(`[dns-logger] could not write log file: ${err}\n`);
  }

  try {
    server.send(buildNxdomainResponse(msg), rinfo.port, rinfo.address);
  } catch (err) {
    process.stdout.write(`[dns-logger] failed to build/send response: ${err}\n`);
  }
});

server.on("listening", () => {
  process.stdout.write("[dns-logger] listening on udp/53\n");
});

server.bind(53, "0.0.0.0");
