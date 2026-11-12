// K170 (review c-WR-05): the digest sender's classification of a settled sendMail. A 4xx reply is
// a transient rejection (released, sent again by the next run, R2-5); a 5xx reply is permanent
// (the batch is closed). No reply code is ambiguous. digestErrorLabel carries the error class and
// codes only, never a message.
import { describe, expect, it } from "vitest";
import { digestErrorLabel } from "@/lib/notifications/digest-log";
import { classifySendResult } from "@/lib/notifications/digest-sender";

const TO = "member@example.test";

function smtpError(responseCode: number | undefined, code = "EENVELOPE") {
  return Object.assign(new Error(`Can't send mail - all recipients were rejected: ${TO}`), {
    code,
    responseCode,
    response: `${responseCode} 5.1.1 <${TO}> rejected`,
  });
}

describe("classifySendResult (K170)", () => {
  it("5xx replies are permanent rejections", () => {
    for (const code of [500, 550, 554, 599]) {
      expect(classifySendResult(TO, { ok: false, error: smtpError(code) })).toEqual({
        outcome: "rejected",
        responseCode: code,
        permanent: true,
      });
    }
  });

  it("4xx replies are transient rejections", () => {
    for (const code of [400, 421, 450, 451, 452, 499]) {
      expect(classifySendResult(TO, { ok: false, error: smtpError(code) })).toEqual({
        outcome: "rejected",
        responseCode: code,
        permanent: false,
      });
    }
  });

  it("a recipient in info.rejected takes the code of its rejectedErrors entry; without one it is transient", () => {
    const rejectedErrors = [Object.assign(new Error("x"), { recipient: TO, responseCode: 550 })];
    expect(
      classifySendResult(TO, {
        ok: true,
        info: { accepted: [], rejected: [TO], rejectedErrors },
      }),
    ).toEqual({ outcome: "rejected", responseCode: 550, permanent: true });
    expect(classifySendResult(TO, { ok: true, info: { accepted: [], rejected: [TO] } })).toEqual({
      outcome: "rejected",
      permanent: false,
    });
  });

  it("no reply code, or a code outside 400 to 599, is ambiguous", () => {
    expect(
      classifySendResult(TO, { ok: false, error: smtpError(undefined, "ECONNECTION") }),
    ).toEqual({ outcome: "ambiguous" });
    expect(classifySendResult(TO, { ok: false, error: smtpError(354) })).toEqual({
      outcome: "ambiguous",
      responseCode: 354,
    });
    expect(classifySendResult(TO, { ok: true, info: { accepted: [TO], rejected: [] } })).toEqual({
      outcome: "accepted",
    });
  });
});

/** A nodemailer-shaped error: `code` (EAUTH, EENVELOPE, ...), reply code and the failed command. */
function commandError(code: string, responseCode: number | undefined, command: string) {
  return Object.assign(new Error(`failed: ${responseCode ?? ""} for ${TO}`), {
    code,
    responseCode,
    command,
  });
}

const CONFIGURATION = (responseCode?: number) =>
  responseCode === undefined
    ? { outcome: "rejected", permanent: false, configuration: true }
    : { outcome: "rejected", responseCode, permanent: false, configuration: true };

// K179 (Codex diff round 1): a failure of the SMTP login or of the server's willingness to take
// mail at all is the operator's to fix (the password, the account, the from address), not this
// recipient's. It is told apart from a recipient's permanent rejection by nodemailer's error code,
// the failed command and the reply code; the digest then releases the batch instead of closing it.
describe("classifySendResult: SMTP configuration failures (K179)", () => {
  it("an authentication failure is a configuration failure, whatever its 5xx code or none", () => {
    for (const code of [535, 530, 534, 538, 500, 554]) {
      expect(
        classifySendResult(TO, { ok: false, error: commandError("EAUTH", code, "AUTH PLAIN") }),
        String(code),
      ).toEqual(CONFIGURATION(code));
    }
    // nodemailer's own credential check (no reply): "Missing credentials".
    expect(
      classifySendResult(TO, { ok: false, error: commandError("EAUTH", undefined, "API") }),
    ).toEqual(CONFIGURATION());
  });

  it("the authentication reply codes 530, 534, 535 and 538 are configuration failures at any command", () => {
    for (const code of [530, 534, 535, 538]) {
      for (const command of ["MAIL FROM", "RCPT TO", "DATA"]) {
        expect(
          classifySendResult(TO, { ok: false, error: commandError("EENVELOPE", code, command) }),
          `${code} ${command}`,
        ).toEqual(CONFIGURATION(code));
      }
    }
  });

  it("a server that does not accept mail (521, 556, a 5xx greeting) or refuses the from address (5xx to MAIL FROM) is a configuration failure", () => {
    for (const code of [521, 556]) {
      expect(
        classifySendResult(TO, { ok: false, error: commandError("EENVELOPE", code, "RCPT TO") }),
      ).toEqual(CONFIGURATION(code));
    }
    expect(
      classifySendResult(TO, { ok: false, error: commandError("EPROTOCOL", 554, "CONN") }),
    ).toEqual(CONFIGURATION(554));
    for (const code of [550, 553, 554]) {
      expect(
        classifySendResult(TO, { ok: false, error: commandError("EENVELOPE", code, "MAIL FROM") }),
      ).toEqual(CONFIGURATION(code));
    }
  });

  it("a recipient's permanent rejection keeps the K170 close; 4xx stays transient, also at AUTH", () => {
    for (const [code, command, type] of [
      [550, "RCPT TO", "EENVELOPE"],
      [551, "RCPT TO", "EENVELOPE"],
      [553, "RCPT TO", "EENVELOPE"],
      [554, "DATA", "EENVELOPE"],
      [554, "DATA", "EMESSAGE"],
      [552, "DATA", "EMESSAGE"],
    ] as const) {
      expect(
        classifySendResult(TO, { ok: false, error: commandError(type, code, command) }),
        `${code} ${command}`,
      ).toEqual({ outcome: "rejected", responseCode: code, permanent: true });
    }
    for (const [code, command, type] of [
      [454, "AUTH PLAIN", "EAUTH"],
      [421, "CONN", "EPROTOCOL"],
      [451, "MAIL FROM", "EENVELOPE"],
      [450, "RCPT TO", "EENVELOPE"],
    ] as const) {
      expect(
        classifySendResult(TO, { ok: false, error: commandError(type, code, command) }),
        `${code} ${command}`,
      ).toEqual({ outcome: "rejected", responseCode: code, permanent: false });
    }
    // A rejected recipient of a resolved send is the recipient's, whatever its code.
    const rejectedErrors = [Object.assign(new Error("x"), { recipient: TO, responseCode: 550 })];
    expect(
      classifySendResult(TO, { ok: true, info: { accepted: [], rejected: [TO], rejectedErrors } }),
    ).toEqual({ outcome: "rejected", responseCode: 550, permanent: true });
  });
});

describe("digestErrorLabel (K170)", () => {
  it("class, code and reply only; never the message or the server's reply text", () => {
    const label = digestErrorLabel(smtpError(550));
    expect(label).toBe("class=Error code=EENVELOPE reply=550");
    expect(label).not.toContain(TO);
  });

  it("drops a name or code that is not a plain identifier, and handles non-errors", () => {
    const odd = Object.assign(new Error("m"), { code: `bad ${TO}`, responseCode: "550" });
    odd.name = `Name ${TO}`;
    expect(digestErrorLabel(odd)).toBe("class=unknown");
    expect(digestErrorLabel("a string")).toBe("class=unknown");
    expect(digestErrorLabel(null)).toBe("class=unknown");
    const prismaLike = Object.assign(new Error("Unique constraint failed on (email)"), {
      code: "P2002",
    });
    prismaLike.name = "PrismaClientKnownRequestError";
    expect(digestErrorLabel(prismaLike)).toBe("class=PrismaClientKnownRequestError code=P2002");
  });
});
