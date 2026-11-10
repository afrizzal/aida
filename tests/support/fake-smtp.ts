// A minimal SMTP server for tests (Phase 10, V-15, C8, R2-5), hand-written on a plain TCP socket
// so no package is added. It binds 127.0.0.1 on a random port and never relays anything: every
// Phase 10 email test (invitations, digests, the mention leak test) points the organization's
// email settings at it. Real email is never sent.
//
// Protocol: EHLO and HELO (EHLO advertises AUTH PLAIN LOGIN and, by default, never STARTTLS, so
// nodemailer authenticates and stays on plain TCP), AUTH PLAIN and LOGIN (any credentials), MAIL
// FROM, RCPT TO, DATA with dot-unstuffing up to the terminating line, RSET, NOOP and QUIT. No
// PIPELINING is advertised, so the client sends one command at a time.
//
// Captures: `received` holds every fully received message whether it was accepted or not;
// `messages` holds the accepted ones only.
//
// Fault modes, set at runtime with setMode:
//   none                 every command succeeds;
//   reject-rcpt          550 to every RCPT TO;
//   reject-data-command  RCPT accepted, then 554 to the DATA command;
//   reject-data          the whole message is read, then 554 after the terminator;
//   drop-on-data         the socket is destroyed on the DATA command, with no reply;
//   drop-after-data-end  the whole message is read and recorded in `received`, then the socket is
//                        destroyed with no reply (the client cannot know whether it was accepted);
//   delay-ms             like none, but every reply waits `delayMs` first;
//   trickle              like none, but the reply to the end of the data (250) is written one
//                        byte at a time with `tricklePauseMs` (default 200 ms) between bytes, so
//                        the client's inactivity timeout never fires while the reply takes
//                        longer than any deadline (plan 10-09, V-29);
//   starttls             EHLO advertises STARTTLS and the server answers 220 to it, then it
//                        cannot complete a handshake: the first bytes after the 220 (the TLS
//                        ClientHello) close the connection.
// `delayMs` also applies to any other mode when given.
//
// Counters: `connections` counts accepted TCP connections and `startTlsCommands` counts STARTTLS
// commands, so a test can prove that a client never connected or did try to upgrade.
//
// Relative imports only (none), so tests/e2e can import it too.
import net from "node:net";

export type FakeSmtpMode =
  | "none"
  | "reject-rcpt"
  | "reject-data-command"
  | "reject-data"
  | "drop-on-data"
  | "drop-after-data-end"
  | "delay-ms"
  | "trickle"
  | "starttls";

export const FAKE_SMTP_MODES: readonly FakeSmtpMode[] = [
  "none",
  "reject-rcpt",
  "reject-data-command",
  "reject-data",
  "drop-on-data",
  "drop-after-data-end",
  "delay-ms",
  "trickle",
  "starttls",
];

export interface FakeSmtpMessage {
  /** The MAIL FROM address, without angle brackets. */
  from: string;
  /** Every RCPT TO address the server accepted, without angle brackets, in order. */
  recipients: string[];
  /** The message as received, dot-unstuffed, lines joined with CRLF, without the terminator. */
  raw: string;
  /** True when the server answered 250 to the message. */
  accepted: boolean;
}

export interface FakeSmtpOptions {
  /** Advertise STARTTLS in the EHLO reply (default false; the server never upgrades). */
  advertiseStartTls?: boolean;
}

type SessionState =
  | "command"
  | "auth-plain"
  | "auth-login-user"
  | "auth-login-pass"
  | "data"
  | "tls";

interface Session {
  socket: net.Socket;
  buffer: string;
  state: SessionState;
  from: string | null;
  recipients: string[];
  dataLines: string[];
  /** Replies are written in order even when delayed. */
  queue: Promise<void>;
}

const HOSTNAME = "fake-smtp.test";

/** Strips the angle brackets and any parameters from a MAIL FROM or RCPT TO argument. */
function pathOf(arg: string): string {
  const match = /<([^>]*)>/.exec(arg);
  return (match ? match[1] : (arg.trim().split(/\s+/)[0] ?? "")).trim();
}

export class FakeSmtpServer {
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private readonly options: FakeSmtpOptions;
  private mode: FakeSmtpMode = "none";
  private delayMs = 0;
  private tricklePauseMs = 200;
  private boundPort = 0;
  /** Every accepted message, in arrival order. */
  readonly messages: FakeSmtpMessage[] = [];
  /** Every fully received message, accepted or not, in arrival order. */
  readonly received: FakeSmtpMessage[] = [];
  /** Accepted TCP connections since the last reset. */
  connections = 0;
  /** STARTTLS commands since the last reset. */
  startTlsCommands = 0;

  constructor(options: FakeSmtpOptions = {}) {
    this.options = options;
    this.server = net.createServer((socket) => this.onConnection(socket));
  }

  /** Listens on 127.0.0.1 with a random port and resolves with it. */
  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.boundPort = (this.server.address() as net.AddressInfo).port;
    return this.boundPort;
  }

  get port(): number {
    return this.boundPort;
  }

  /** Changes the fault mode for every following command (open connections included). */
  setMode(
    mode: FakeSmtpMode,
    { delayMs, tricklePauseMs }: { delayMs?: number; tricklePauseMs?: number } = {},
  ): void {
    this.mode = mode;
    this.delayMs = delayMs ?? (mode === "delay-ms" ? 100 : 0);
    this.tricklePauseMs = tricklePauseMs ?? 200;
  }

  /** Forgets every captured message and resets the mode to none. */
  reset(): void {
    this.messages.length = 0;
    this.received.length = 0;
    this.connections = 0;
    this.startTlsCommands = 0;
    this.setMode("none");
  }

  /** Destroys every open connection and closes the listener. */
  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private onConnection(socket: net.Socket): void {
    this.sockets.add(socket);
    this.connections += 1;
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("close", () => this.sockets.delete(socket));
    const session: Session = {
      socket,
      buffer: "",
      state: "command",
      from: null,
      recipients: [],
      dataLines: [],
      queue: Promise.resolve(),
    };
    socket.on("data", (chunk: string) => {
      if (session.state === "tls") {
        // starttls mode: a handshake is never completed.
        socket.destroy();
        return;
      }
      session.buffer += chunk;
      let index = session.buffer.indexOf("\r\n");
      while (index !== -1 && !socket.destroyed) {
        const line = session.buffer.slice(0, index);
        session.buffer = session.buffer.slice(index + 2);
        this.onLine(session, line);
        index = session.buffer.indexOf("\r\n");
      }
    });
    this.reply(session, `220 ${HOSTNAME} ESMTP ready`);
  }

  private reply(session: Session, text: string, after?: () => void): void {
    const delay = this.delayMs;
    session.queue = session.queue.then(async () => {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (session.socket.destroyed) return;
      session.socket.write(`${text}\r\n`);
      after?.();
    });
  }

  /** Writes the reply one byte at a time, `tricklePauseMs` apart (trickle mode). */
  private trickle(session: Session, text: string, done: () => void): void {
    const pause = this.tricklePauseMs;
    session.queue = session.queue.then(async () => {
      const bytes = [...`${text}\r\n`];
      for (const [index, byte] of bytes.entries()) {
        if (index > 0) await new Promise((r) => setTimeout(r, pause));
        if (session.socket.destroyed) return;
        session.socket.write(byte);
      }
      done();
    });
  }

  private drop(session: Session): void {
    session.queue = session.queue.then(() => {
      session.socket.destroy();
    });
  }

  private resetEnvelope(session: Session): void {
    session.from = null;
    session.recipients = [];
    session.dataLines = [];
  }

  private onLine(session: Session, line: string): void {
    switch (session.state) {
      case "data":
        this.onDataLine(session, line);
        return;
      case "auth-plain":
      case "auth-login-pass":
        session.state = "command";
        this.reply(session, "235 2.7.0 Authentication successful");
        return;
      case "auth-login-user":
        session.state = "auth-login-pass";
        this.reply(session, "334 UGFzc3dvcmQ6");
        return;
      default:
        this.onCommand(session, line);
    }
  }

  private onCommand(session: Session, line: string): void {
    const space = line.indexOf(" ");
    const verb = (space === -1 ? line : line.slice(0, space)).toUpperCase();
    const arg = space === -1 ? "" : line.slice(space + 1);

    switch (verb) {
      case "EHLO": {
        this.resetEnvelope(session);
        const lines = [`250-${HOSTNAME} greets you`, "250-AUTH PLAIN LOGIN", "250-8BITMIME"];
        if (this.options.advertiseStartTls || this.mode === "starttls") lines.push("250-STARTTLS");
        lines.push("250 SMTPUTF8");
        this.reply(session, lines.join("\r\n"));
        return;
      }
      case "HELO":
        this.resetEnvelope(session);
        this.reply(session, `250 ${HOSTNAME}`);
        return;
      case "AUTH": {
        const [mechanism, initial] = arg.trim().split(/\s+/);
        const mech = (mechanism ?? "").toUpperCase();
        if (mech === "PLAIN") {
          if (initial) {
            this.reply(session, "235 2.7.0 Authentication successful");
          } else {
            session.state = "auth-plain";
            this.reply(session, "334 ");
          }
        } else if (mech === "LOGIN") {
          if (initial) {
            session.state = "auth-login-pass";
            this.reply(session, "334 UGFzc3dvcmQ6");
          } else {
            session.state = "auth-login-user";
            this.reply(session, "334 VXNlcm5hbWU6");
          }
        } else {
          this.reply(session, "504 5.5.4 Unrecognized authentication type");
        }
        return;
      }
      case "MAIL":
        this.resetEnvelope(session);
        session.from = pathOf(arg.replace(/^FROM:/i, ""));
        this.reply(session, "250 2.1.0 OK");
        return;
      case "RCPT": {
        if (session.from === null) {
          this.reply(session, "503 5.5.1 Need MAIL first");
          return;
        }
        if (this.mode === "reject-rcpt") {
          this.reply(session, "550 5.1.1 Recipient rejected");
          return;
        }
        session.recipients.push(pathOf(arg.replace(/^TO:/i, "")));
        this.reply(session, "250 2.1.5 OK");
        return;
      }
      case "DATA":
        if (session.from === null || session.recipients.length === 0) {
          this.reply(session, "503 5.5.1 Need RCPT first");
          return;
        }
        if (this.mode === "reject-data-command") {
          this.reply(session, "554 5.5.1 Transaction failed");
          return;
        }
        if (this.mode === "drop-on-data") {
          this.drop(session);
          return;
        }
        session.state = "data";
        session.dataLines = [];
        this.reply(session, "354 End data with <CR><LF>.<CR><LF>");
        return;
      case "STARTTLS":
        this.startTlsCommands += 1;
        if (this.mode !== "starttls") {
          this.reply(session, "502 5.5.2 Command not implemented");
          return;
        }
        this.reply(session, "220 2.0.0 Ready to start TLS", () => {
          session.state = "tls";
        });
        return;
      case "RSET":
        this.resetEnvelope(session);
        this.reply(session, "250 2.0.0 OK");
        return;
      case "NOOP":
        this.reply(session, "250 2.0.0 OK");
        return;
      case "QUIT":
        this.reply(session, "221 2.0.0 Bye", () => session.socket.end());
        return;
      default:
        this.reply(session, "502 5.5.2 Command not implemented");
    }
  }

  private onDataLine(session: Session, line: string): void {
    if (line !== ".") {
      // Dot-unstuffing (RFC 5321 section 4.5.2).
      session.dataLines.push(line.startsWith(".") ? line.slice(1) : line);
      return;
    }
    session.state = "command";
    const message: FakeSmtpMessage = {
      from: session.from ?? "",
      recipients: [...session.recipients],
      raw: session.dataLines.join("\r\n"),
      accepted: false,
    };
    this.resetEnvelope(session);
    this.received.push(message);

    if (this.mode === "reject-data") {
      this.reply(session, "554 5.6.0 Message rejected");
      return;
    }
    if (this.mode === "drop-after-data-end") {
      this.drop(session);
      return;
    }
    if (this.mode === "trickle") {
      // Accepted only once the whole reply has been written; a client cut off earlier never
      // learns of it, so the message counts as received only.
      this.trickle(session, "250 2.0.0 OK queued", () => {
        message.accepted = true;
        this.messages.push(message);
      });
      return;
    }
    message.accepted = true;
    this.messages.push(message);
    this.reply(session, "250 2.0.0 OK queued");
  }
}

/** Creates and starts a fake SMTP server. */
export async function startFakeSmtp(options: FakeSmtpOptions = {}): Promise<FakeSmtpServer> {
  const server = new FakeSmtpServer(options);
  await server.start();
  return server;
}
