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
    for (const code of [500, 535, 550, 554, 599]) {
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
