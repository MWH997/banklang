import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { KEYWORDS } from "../packages/parser/src/index";

/**
 * A reserved word is still a field name.
 *
 * Every word this language reserves is a word some copybook uses as a field:
 * `type`, `date`, `currency`, `error`, `record`, `file`, `transaction`, `log`,
 * `commit`, `status`. Reserving them for the whole source text meant a real
 * record could not be described at all — and describing real records is the
 * point of the language.
 *
 * In a name position there is nothing to be ambiguous with. A field name is
 * followed by `:`, a member name follows `.`, and a parameter name is followed
 * by `:`. Nothing else can appear there, so a keyword read in one of those
 * places is a name and only a name.
 *
 * This test exists because the alternative — making words contextual one at a
 * time as each collision is discovered — is a slow leak that only shows up when
 * somebody's copybook cannot be expressed.
 */

function roundTrip(word: string): ReturnType<typeof compile> {
  return compile(`module P;

record R {
  ${word}: string<4>;
  idempotencyKey: string<36>;
}

entry transaction t(r: R) {
  r.${word} = "AB";
  audit("X", r.idempotencyKey);
}`);
}

describe("every reserved word", () => {
  it("has some words to check", () => {
    expect(KEYWORDS.size).toBeGreaterThan(50);
  });

  for (const word of KEYWORDS) {
    it(`can be a field, declared, read, and assigned: ${word}`, () => {
      const result = roundTrip(word);

      expect(
        result.diagnostics.map((entry) => `${entry.id}: ${entry.message}`),
      ).toEqual([]);
    });
  }
});

describe("the name positions", () => {
  /** `sensitive` is a modifier unless it is the name, which the `:` settles. */
  it("tells the sensitive modifier from a field called sensitive", () => {
    const asName = compile(`module P;

record R {
  sensitive: string<4>;
  idempotencyKey: string<36>;
}

entry transaction t(r: R) {
  audit("X", r.idempotencyKey);
}`);

    expect(asName.diagnostics).toEqual([]);
    // Still a marking when it precedes a name rather than a colon.
    const asModifier = compile(`module P;

record R {
  sensitive pan: string<16>;
  idempotencyKey: string<36>;
}

entry transaction t(r: R) {
  audit("X", r.pan);
}`);

    expect(asModifier.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-AUD-002",
    );
  });

  /**
   * Deliberately not extended to parameters and locals. Those are read as bare
   * identifiers in expressions, where a keyword really is a keyword — `log`
   * begins a statement — so accepting one at the declaration would allow a name
   * that could be declared and never read. A record field is always reached
   * through `.`, which is why the copybook case is the one that works.
   */
  it("does not take a reserved word as a parameter name", () => {
    const result = compile(`module P;

record R {
  idempotencyKey: string<36>;
}

function pick(type: decimal<9, 2>): decimal<9, 2> {
  return type;
}

entry transaction t(r: R) {
  audit("X", r.idempotencyKey);
}`);

    expect(result.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-SYN-001",
    );
  });

  /**
   * A keyword is still a keyword where a statement starts, which is the whole
   * reason the name positions had to be separated from the general one.
   */
  it("still reads a statement keyword as a keyword", () => {
    const result = compile(`module P;

record R {
  idempotencyKey: string<36>;
}

entry transaction t(r: R) {
  log "STARTED";
  audit("X", r.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("DISPLAY");
  });
});

/**
 * A redefinition longer than what it redefines, which is IBM's own example.
 *
 * The Language Reference gives `05 A PICTURE X(6).` redefined by
 * `05 B REDEFINES A GLOBAL PICTURE N(4).` and says in as many words that B "can
 * occupy more storage than the redefined item, A" — six bytes against eight.
 * The redefinition extends the storage area; the only case it forbids is a
 * redefined item declared as an external data record.
 *
 * The compiler used to refuse it and say the longer field would read past the
 * end into whatever follows, which is not what happens. The numbers below are
 * the manual's, not this compiler's: A at 0 for 6, B at 0 for 8, and whatever
 * comes next at 8 rather than at 6.
 */
describe("a redefines longer than what it redefines", () => {
  it("extends the storage area, and the record grows with it", () => {
    const result = compile(`module Redef;

record Master {
  a: string<6>;
  b: national<4> redefines a;
  tail: string<4>;
  idempotencyKey: string<36>;
}

entry transaction touch1(master: Master) {
  audit("TOUCHED", master.idempotencyKey);
}`);

    expect(
      result.diagnostics.filter((entry) => entry.severity === "error"),
    ).toEqual([]);

    const layout = result.layout?.reports.find(
      (report) => report.recordName === "Master",
    );
    const offsetOf = (path: string) =>
      layout?.entries.find((entry) => entry.path === path)?.offset;

    expect(offsetOf("MASTER.A")).toBe(0);
    expect(offsetOf("MASTER.B")).toBe(0);
    expect(offsetOf("MASTER.TAIL")).toBe(8);
    expect(layout?.totalLength).toBe(48);
  });

  /** The same storage the other way round is the same record either way. */
  it("accepts the same storage described the other way round", () => {
    const result = compile(`module Redef;

record Master {
  b: national<4>;
  a: string<6> redefines b;
  idempotencyKey: string<36>;
}

entry transaction touch1(master: Master) {
  audit("TOUCHED", master.idempotencyKey);
}`);

    expect(
      result.diagnostics.filter((entry) => entry.severity === "error"),
    ).toEqual([]);
  });
});
