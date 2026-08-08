import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { unpadded } from "./helpers";

/**
 * String handling: `trim`, `upper`, `lower`, `substring`, `concat`, and `now`.
 *
 * Without these a program cannot assemble a narrative, parse a composite key,
 * or mask a card number — and masking is what the `sensitive` declassification
 * rule rests on, which until now could only be a stub returning `"****"`.
 *
 * Every result has a length the compiler can name, because a COBOL field has a
 * fixed one.
 */

const PREAMBLE = `module Strings;

record Card {
  cardNumber: string<19>;
  holderName: string<40>;
  maskedCard: string<16>;
  narrative: string<60>;
  bookedAt: timestamp;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction write1(card: Card) {
${body}
  audit("WRITTEN", card.idempotencyKey);
}`);
}

describe("intrinsic functions", () => {
  it("trims, folds case, and nests", () => {
    const result = txn("  card.narrative = trim(upper(card.holderName));");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "FUNCTION TRIM(FUNCTION UPPER-CASE(HOLDER-NAME OF CARD))",
    );
  });

  it("folds to lower case", () => {
    expect(txn("  card.narrative = lower(card.holderName);").cobol).toContain(
      "FUNCTION LOWER-CASE(HOLDER-NAME OF CARD)",
    );
  });
});

describe("substring", () => {
  /**
   * Reference modification, `s(start:length)`. The bounds are literals because
   * a COBOL field has a fixed length and the compiler has to know it: a length
   * decided at run time has no `PIC X(n)` to land in.
   */
  it("emits reference modification", () => {
    const result = txn("  card.maskedCard = substring(card.cardNumber, 5, 4);");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("CARD-NUMBER OF CARD(5:4)");
  });

  it("rejects bounds decided at run time", () => {
    const result = txn(
      "  card.maskedCard = substring(card.cardNumber, 5, card.cardNumber);",
    );

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("rejects a slice that runs past the end", () => {
    const result = txn(
      "  card.maskedCard = substring(card.cardNumber, 18, 4);",
    );

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});

describe("concat", () => {
  /**
   * COBOL assembles a string with `STRING ... INTO`, which is a statement, so
   * this cannot render inline the way an intrinsic function can. The target is
   * cleared first, because `STRING` leaves whatever was past the end alone.
   */
  it("emits STRING into the target", () => {
    const result = txn(
      '  card.narrative = concat(card.holderName, " ", card.maskedCard);',
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("MOVE SPACES TO NARRATIVE OF CARD");
    expect(result.cobol).toContain(
      "STRING HOLDER-NAME OF CARD DELIMITED BY SIZE",
    );
    expect(result.cobol).toContain('" " DELIMITED BY SIZE');
    expect(result.cobol).toContain("INTO NARRATIVE OF CARD");
  });

  it("sums the argument lengths and pads into a wider field", () => {
    // 40 + 1 + 16 = 57 characters into a 60-character field: COBOL pads.
    const result = txn(
      '  card.narrative = concat(card.holderName, " ", card.maskedCard);',
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a result too long for the target", () => {
    const result = txn(
      "  card.maskedCard = concat(card.holderName, card.narrative);",
    );

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("joins strings, not numbers", () => {
    const result = txn("  card.narrative = concat(card.holderName, 5);");

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});

describe("masking is now expressible", () => {
  /**
   * The `sensitive` rule treats a function call as the declassification point.
   * Until strings existed, a masking function could only return a constant,
   * which made the boundary real but the masking fictional.
   */
  it("builds a masked card number from a real one", () => {
    const result = compile(`${PREAMBLE}
function maskPan(pan: string<19>): string<16> {
  return concat("************", substring(pan, 16, 4));
}

entry transaction write1(card: Card) {
  card.maskedCard = maskPan(card.cardNumber);
  audit("WRITTEN", card.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain('STRING "************" DELIMITED BY SIZE');
    expect(result.cobol).toContain("MASK-PAN-P1(16:4) DELIMITED BY SIZE");
  });
});

describe("now", () => {
  /**
   * `CURRENT-DATE` returns `YYYYMMDDHHMMSShh...`; a Db2 timestamp is
   * `YYYY-MM-DD-HH.MM.SS.NNNNNN`. The clock offers hundredths, so the last four
   * digits of the microseconds are zeros rather than invented.
   */
  it("assembles a Db2 timestamp from the clock", () => {
    const result = txn("  card.bookedAt = now();");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "MOVE FUNCTION CURRENT-DATE TO BANK-CURRENT-DATE",
    );
    expect(result.cobol).toContain("BANK-CURRENT-DATE(1:4) DELIMITED BY SIZE");
    expect(result.cobol).toContain('"0000" DELIMITED BY SIZE');
    expect(result.cobol).toContain("INTO BOOKED-AT OF CARD");
  });

  it("declares the clock field only in a program that reads the clock", () => {
    expect(txn("").cobol).not.toContain("BANK-CURRENT-DATE");
    expect(unpadded(txn("  card.bookedAt = now();").cobol)).toContain(
      "01 BANK-CURRENT-DATE PIC X(21) VALUE SPACES.",
    );
  });

  it("takes no arguments", () => {
    expect(ids(txn("  card.bookedAt = now(card.holderName);"))).toContain(
      "BANK-TYPE-003",
    );
  });
});

/**
 * `concat`, `now`, `countOf` and `replaceChars` lower to a COBOL statement
 * writing into a field of their own, so there is no expression to nest one in.
 *
 * The backend knew and raised an internal invariant, which reaches the author
 * as a stack trace rather than a diagnostic:
 * `toNumber(concat("0.", substring(rate, 7, 3)))` — a reasonable way to parse a
 * rate written in thousandths — crashed `bankc` while a benchmark task was
 * being written. An internal invariant is for what cannot happen.
 */
describe("a value-building call written where no statement can go", () => {
  it("is refused inside another call rather than crashing the backend", () => {
    expect(
      ids(
        txn(
          '  card.maskedCard = upper(concat("**", substring(card.cardNumber, 16, 4)));',
        ),
      ),
    ).toContain("BANK-TYPE-030");
  });

  it("is refused in a condition", () => {
    expect(
      ids(
        txn(`  if concat(card.holderName, "!") == "X" {
    card.narrative = "MATCHED";
  }`),
      ),
    ).toContain("BANK-TYPE-030");
  });

  it("is allowed as the whole right-hand side", () => {
    expect(
      txn(
        '  card.maskedCard = concat("************", substring(card.cardNumber, 16, 4));',
      ).diagnostics,
    ).toEqual([]);
  });

  it("is allowed as the initialiser of a local", () => {
    expect(
      txn(`  let built: string<16> = concat("************", substring(card.cardNumber, 16, 4));
  card.maskedCard = built;`).diagnostics,
    ).toEqual([]);
  });
});
