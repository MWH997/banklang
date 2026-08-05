import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `json` and `xml` — COBOL `JSON GENERATE` and `XML GENERATE`.
 *
 * A batch that has to hand a record to something outside the estate — a queue,
 * a gateway, a file a distributed system reads — otherwise builds the text by
 * hand with `STRING`, which is where the quoting and the escaping go wrong.
 *
 * COBOL builds the document from the group's own field names, so nothing in the
 * language describes the shape: the record is the schema.
 */

const PREAMBLE = `module Payload;

record Account {
  accountId: string<8>;
  balance: decimal<9, 2>;
  idempotencyKey: string<36>;
}

record Message {
  body: string<200>;
  length: binary<4>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function program(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction publish(account: Account, message: Message) {
${body}
  audit("PUBLISHED", account.idempotencyKey);
}`);
}

describe("generating", () => {
  it("emits JSON GENERATE", () => {
    const result = program("  json message.body from account;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "JSON GENERATE BODY OF MESSAGE-FLD FROM ACCOUNT",
    );
    expect(result.cobol).toContain("END-JSON");
  });

  it("emits XML GENERATE", () => {
    const result = program("  xml message.body from account;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "XML GENERATE BODY OF MESSAGE-FLD FROM ACCOUNT",
    );
    expect(result.cobol).toContain("END-XML");
  });

  /**
   * The target is a fixed COBOL field and the compiler space-fills whatever the
   * document does not reach, so without the count the caller cannot tell the
   * text from the padding when it comes to write it out.
   */
  it("puts the generated length somewhere", () => {
    const result = program(
      "  json message.body from account count message.length;",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("COUNT IN LENGTH-FLD OF MESSAGE-FLD");
  });

  it("leaves the count out when none was asked for", () => {
    expect(program("  json message.body from account;").cobol).not.toContain(
      "COUNT IN",
    );
  });
});

describe("the failure path", () => {
  it("becomes ON EXCEPTION", () => {
    const result = program(`  json message.body from account on error {
    returnCode = 12;
  };`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("ON EXCEPTION");
    expect(result.cobol).toContain("MOVE 12 TO RETURN-CODE");
  });

  it("is optional", () => {
    expect(program("  json message.body from account;").diagnostics).toEqual(
      [],
    );
  });

  /** The handler is ordinary code, so the banking checks have to see into it. */
  it("is not a blind spot for the analyzer", () => {
    const result = program(`  json message.body from account on error {
    debit("SUSPENSE", 1.00);
  };`);

    expect(ids(result)).toContain("BANK-LED-001");
  });
});

describe("what it will take", () => {
  it("generates into text", () => {
    expect(ids(program("  json message.length from account;"))).toContain(
      "BANK-TYPE-003",
    );
  });

  it("generates from a record", () => {
    expect(ids(program("  json message.body from message.body;"))).toContain(
      "BANK-TYPE-003",
    );
  });

  it("counts into a whole number", () => {
    expect(
      ids(program("  json message.body from account count message.body;")),
    ).toContain("BANK-TYPE-003");
  });

  /** Two bytes to a character is not what JSON GENERATE writes. */
  it("does not generate into a national", () => {
    const result = compile(`${PREAMBLE}
record Wide {
  text: national<100>;
}

entry transaction publish(account: Account, wide: Wide) {
  json wide.text from account;
  audit("PUBLISHED", account.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});

/**
 * Serialised text is data on its way out of the program. A record carrying a
 * `sensitive` field is a card number about to be written into a payload in
 * clear, which is the same escape `BANK-AUD-002` covers for an audit event.
 */
describe("restricted data", () => {
  const source = (marking: string) => `module Payload;

record Card {
  ${marking}pan: string<16>;
  idempotencyKey: string<36>;
}

record Message {
  body: string<200>;
}

entry transaction publish(card: Card, message: Message) {
  json message.body from card;
  audit("PUBLISHED", card.idempotencyKey);
}`;

  it("cannot be generated into a payload", () => {
    const result = compile(source("sensitive "));

    expect(ids(result)).toContain("BANK-AUD-002");
    expect(
      result.diagnostics.find((entry) => entry.id === "BANK-AUD-002")?.message,
    ).toContain("pan");
  });

  it("leaves an unmarked record alone", () => {
    expect(compile(source("")).diagnostics).toEqual([]);
  });
});

/**
 * Reading the emitted COBOL says the statement was written. It does not say the
 * document is well formed, which is the only thing the consumer cares about, so
 * this one is run.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  function run(body: string): string {
    const result = compile(`module Payload;

record Account {
  accountId: string<8>;
  balance: decimal<9, 2>;
  idempotencyKey: string<36>;
}

record Message {
  body: string<200>;
  length: binary<4>;
}

entry transaction publish(account: Account, message: Message) {
  account.accountId = "12345678";
  account.balance = 1234.56;
${body}
  log(message.body);
  audit("PUBLISHED", account.idempotencyKey);
}`);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-serialize-"));
    const source = join(dir, "program.cbl");
    const binary = join(dir, "program");
    writeFileSync(source, result.cobol ?? "", "utf8");

    // The audit event calls out to the reference runtime, so it is linked in.
    const built = spawnSync(
      "cobc",
      ["-x", "-free", source, "runtime/BANKAUDT.cbl", "-o", binary],
      { encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync(binary, [], { encoding: "utf8", cwd: dir });
    expect(ran.status, ran.stderr).toBe(0);
    // The audit runtime prints too; the document is the line that was logged.
    return (
      ran.stdout
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("{") || line.startsWith("<")) ?? ""
    );
  }

  it.skipIf(!available)("writes JSON a consumer can read", () => {
    const output = run(
      "  json message.body from account count message.length;",
    );

    expect(JSON.parse(output)).toEqual({
      ACCOUNT: {
        "ACCOUNT-ID": "12345678",
        BALANCE: 1234.56,
        "IDEMPOTENCY-KEY": " ",
      },
    });
  });

  it.skipIf(!available)("writes XML with the record's own field names", () => {
    const output = run("  xml message.body from account count message.length;");

    expect(output).toContain("<ACCOUNT-ID>12345678</ACCOUNT-ID>");
    expect(output).toContain("<BALANCE>1234.56</BALANCE>");
    expect(output.startsWith("<ACCOUNT>")).toBe(true);
  });
});

/** `from` and `count` read as field names everywhere else. */
describe("the clause words are not reserved", () => {
  it("leaves `from` and `count` usable", () => {
    const result = compile(`module Payload;

record Ledger {
  from: string<8>;
  count: binary<4>;
  idempotencyKey: string<36>;
}

entry transaction publish(ledger: Ledger) {
  ledger.count = 1;
  audit("PUBLISHED", ledger.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
  });
});
