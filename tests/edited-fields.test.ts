import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed, unpadded } from "./helpers";

/**
 * `edited<T, "style">` — numeric-edited items, which is how a mainframe program
 * puts a number in front of a person.
 *
 * A statement whose amounts cannot be printed is not a statement. The picture is
 * generated from the value's own precision and scale rather than written out, so
 * nobody counts Z's, and assignment into the field is the formatting step —
 * which is exactly what a COBOL `MOVE` into a numeric-edited item does.
 */

const PREAMBLE = `module Edited;

type BDT = currency<"BDT", 18, 2>;
type Count = decimal<7, 0>;

record StatementRow {
  amount: BDT;
  count: Count;
  postedOn: date;
  printedAmount: edited<BDT, "signed">;
  printedCredit: edited<BDT, "credit">;
  printedCheque: edited<BDT, "protected">;
  printedCount: edited<Count, "grouped">;
  printedPlain: edited<Count, "plain">;
  printedDate: edited<date, "slashed">;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction render(row: StatementRow) {
${body}
  audit("RENDERED", row.idempotencyKey);
}`);
}

describe("generated pictures", () => {
  /**
   * The leading positions suppress and the last integer position stays `9`, so
   * a zero amount prints as `0.00` rather than as nothing. Decimals never
   * suppress: an amount is read to the penny, and a blank penny column is a
   * defect.
   */
  it("suppresses leading zeros and groups thousands, with a trailing sign", () => {
    expect(unpadded(txn("").cobol)).toContain(
      "05 PRINTED-AMOUNT PIC Z,ZZZ,ZZZ,ZZZ,ZZZ,ZZ9.99-.",
    );
  });

  /** `CR` rather than a minus is the accounting convention for a credit. */
  it("renders a credit balance with CR", () => {
    expect(unpadded(txn("").cobol)).toContain(
      "05 PRINTED-CREDIT PIC Z,ZZZ,ZZZ,ZZZ,ZZZ,ZZ9.99CR.",
    );
  });

  /** Asterisk fill is cheque protection: it leaves no room to write digits in. */
  it("fills a protected amount with asterisks", () => {
    expect(unpadded(txn("").cobol)).toContain(
      "05 PRINTED-CHEQUE PIC *,***,***,***,***,**9.99.",
    );
  });

  it("groups an integer count and leaves a plain one ungrouped", () => {
    const cobol = txn("").cobol ?? "";

    expect(unpadded(cobol)).toContain("05 PRINTED-COUNT PIC Z,ZZZ,ZZ9.");
    expect(unpadded(cobol)).toContain("05 PRINTED-PLAIN PIC ZZZZZZ9.");
  });

  it("renders a date through a slashed picture", () => {
    expect(unpadded(txn("").cobol)).toContain(
      "05 PRINTED-DATE PIC 9999/99/99.",
    );
  });

  it("reports the edited length in the layout", () => {
    const layout = txn("").layout?.reports.find(
      (report) => report.recordName === "StatementRow",
    );

    expect(
      layout?.entries.find(
        (entry) => entry.path === "STATEMENT-ROW.PRINTED-DATE",
      )?.bytes,
    ).toBe(10);
    expect(
      layout?.entries.find(
        (entry) => entry.path === "STATEMENT-ROW.PRINTED-PLAIN",
      )?.bytes,
    ).toBe(7);
  });
});

describe("assignment is the formatting step", () => {
  /**
   * COBOL performs the editing on the MOVE and rejects a COMPUTE into a
   * numeric-edited item, so the decision belongs to the receiving field rather
   * than to the value being rendered.
   */
  it("moves rather than computes into an edited field", () => {
    const result = txn("  row.printedAmount = row.amount;");

    expect(result.diagnostics).toEqual([]);
    expect(flowed(result.cobol)).toContain(
      flowed("MOVE AMOUNT OF STATEMENT-ROW TO PRINTED-AMOUNT OF STATEMENT-ROW"),
    );
    expect(result.cobol).not.toContain("COMPUTE PRINTED-AMOUNT");
  });

  it("moves a date into a slashed field", () => {
    const result = txn("  row.printedDate = row.postedOn;");

    expect(result.diagnostics).toEqual([]);
    expect(flowed(result.cobol)).toContain(
      flowed(
        "MOVE POSTED-ON OF STATEMENT-ROW TO PRINTED-DATE OF STATEMENT-ROW",
      ),
    );
  });

  it("rejects an amount whose scale the picture was not built for", () => {
    const result = compile(`${PREAMBLE}
entry transaction render(row: StatementRow) {
  row.printedCount = row.amount;
  audit("RENDERED", row.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});

describe("an edited field is a rendering, not a number", () => {
  /**
   * Reading one back as a value is how a report column ends up being
   * arithmetic input, which is a real way to lose the digits editing removed.
   */
  it("refuses to read an edited field back as a value", () => {
    const result = txn("  row.amount = row.printedAmount;");

    expect(ids(result)).toContain("BANK-TYPE-003");
  });

  it("refuses to compute with one", () => {
    const result = txn("  row.printedAmount = row.printedCredit + row.amount;");

    expect(result.diagnostics).not.toEqual([]);
  });
});

describe("styles are checked", () => {
  it("rejects a style the compiler does not know", () => {
    const result = compile(
      `${PREAMBLE.replace('"signed"', '"fancy"')}
entry transaction render(row: StatementRow) {
  audit("RENDERED", row.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-TYPE-023");
  });

  it("rejects a date style on an amount", () => {
    const result = compile(
      `${PREAMBLE.replace('edited<BDT, "signed">', 'edited<BDT, "slashed">')}
entry transaction render(row: StatementRow) {
  audit("RENDERED", row.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-TYPE-023");
  });

  it("rejects an amount style on a date", () => {
    const result = compile(
      `${PREAMBLE.replace('edited<date, "slashed">', 'edited<date, "signed">')}
entry transaction render(row: StatementRow) {
  audit("RENDERED", row.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-TYPE-023");
  });

  it("rejects rendering something with no edited form", () => {
    const result = compile(
      `${PREAMBLE.replace('printedPlain: edited<Count, "plain">;', 'printedPlain: edited<string<4>, "plain">;')}
entry transaction render(row: StatementRow) {
  audit("RENDERED", row.idempotencyKey);
}`,
    );

    expect(ids(result)).toContain("BANK-TYPE-023");
  });
});
