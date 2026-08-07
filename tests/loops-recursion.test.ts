import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed, unpadded } from "./helpers";

const PREAMBLE = `module Loops;

type BDT = currency<"BDT", 18, 2>;
type Count = decimal<9, 0>;

record Line {
  amount: BDT;
}

record Ledger {
  total: BDT;
  lines: Line[25];
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

describe("for each", () => {
  it("lowers to PERFORM VARYING over the declared bound", () => {
    const result = compile(`${PREAMBLE}
transaction sum(ledger: Ledger) {
  ledger.total = 0.00;
  for each i in ledger.lines {
    ledger.total = ledger.total + ledger.lines[i].amount;
  }
  audit("SUMMED", ledger.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "PERFORM VARYING I FROM 1 BY 1 UNTIL I > 25",
    );
    expect(result.cobol).toContain("END-PERFORM");
  });

  it("needs no limit clause, because the array supplies the bound", () => {
    const result = compile(`${PREAMBLE}
transaction sum(ledger: Ledger) {
  for each i in ledger.lines {
    ledger.total = ledger.total + ledger.lines[i].amount;
  }
  audit("SUMMED", ledger.idempotencyKey);
}`);

    expect(ids(result)).not.toContain("BANK-TXN-004");
  });

  it("declares the loop index in working storage", () => {
    const result = compile(`${PREAMBLE}
transaction sum(ledger: Ledger) {
  for each i in ledger.lines {
    ledger.total = ledger.total + ledger.lines[i].amount;
  }
  audit("SUMMED", ledger.idempotencyKey);
}`);

    expect(result.cobol).toMatch(/01 {2}I\s+PIC 9\(9\) COMP VALUE ZERO\./);
  });

  it("omits the runtime bounds check for a for-each index", () => {
    const result = compile(`${PREAMBLE}
transaction sum(ledger: Ledger) {
  for each i in ledger.lines {
    ledger.total = ledger.total + ledger.lines[i].amount;
  }
  audit("SUMMED", ledger.idempotencyKey);
}`);

    // PERFORM VARYING already bounds the index, so a guard would be dead code.
    expect(result.cobol).not.toContain("MOVE 25 TO I");
  });

  it("rejects iterating a non-array", () => {
    const result = compile(`${PREAMBLE}
transaction sum(ledger: Ledger) {
  for each i in ledger.total {
    ledger.total = ledger.total + 1.00;
  }
  audit("SUMMED", ledger.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-003");
  });
});

describe("runtime bounds checking", () => {
  it("guards a computed index", () => {
    const result = compile(`${PREAMBLE}
transaction pick(ledger: Ledger, at: Count) {
  ledger.total = ledger.lines[at].amount;
  audit("PICKED", ledger.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    // `at` is a transaction parameter, so it lives in PICK-P2.
    expect(result.cobol).toContain("IF PICK-P2 < 1 OR PICK-P2 > 25");
    expect(result.cobol).toContain('MOVE "23" TO BANK-BOUNDS-STATUS');
  });

  it("does not guard a literal index, which the compiler already proved", () => {
    const result = compile(`${PREAMBLE}
transaction pick(ledger: Ledger) {
  ledger.total = ledger.lines[3].amount;
  audit("PICKED", ledger.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).not.toContain("BANK-BOUNDS-STATUS)");
    expect(result.cobol).not.toMatch(/IF 3 < 1/);
  });

  it("declares the bounds status field when arrays are used", () => {
    const result = compile(`${PREAMBLE}
transaction pick(ledger: Ledger, at: Count) {
  ledger.total = ledger.lines[at].amount;
  audit("PICKED", ledger.idempotencyKey);
}`);

    expect(unpadded(result.cobol)).toContain(
      'BANK-BOUNDS-STATUS PIC X(2) VALUE "00".',
    );
  });
});

describe("recursion", () => {
  const RECURSIVE = `module Recur;

type Amount = decimal<18, 2>;
type Count = decimal<9, 0>;

function compound(balance: Amount, periods: Count): Amount {
  if periods <= 0 {
    return balance;
  } else {
    let grown: Amount = round(balance * 1.05, "HALF_EVEN");
    return compound(grown, periods - 1);
  }
}
`;

  it("emits a recursive function as a separate RECURSIVE program", () => {
    const result = compile(RECURSIVE);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("PROGRAM-ID. COMPOUND RECURSIVE.");
    expect(result.cobol).toContain("END PROGRAM COMPOUND.");
  });

  /**
   * WORKING-STORAGE is shared across invocations of a recursive program, so
   * locals held there would be overwritten by the nested call and the result
   * would be silently wrong. LOCAL-STORAGE gives each invocation its own copy.
   *
   * The two failure registers are the deliberate exception, and they go the
   * other way for the same reason: they are the run unit's, not the
   * invocation's, and the Language Reference forbids EXTERNAL in LOCAL-STORAGE
   * anyway.
   */
  it("puts locals in LOCAL-STORAGE, not WORKING-STORAGE", () => {
    const result = compile(RECURSIVE);
    const program = result.cobol ?? "";
    const recursiveProgram = program.slice(
      program.indexOf("PROGRAM-ID. COMPOUND RECURSIVE."),
    );
    const working = recursiveProgram.slice(
      recursiveProgram.indexOf("WORKING-STORAGE SECTION."),
      recursiveProgram.indexOf("LOCAL-STORAGE SECTION."),
    );

    expect(recursiveProgram).toContain("LOCAL-STORAGE SECTION.");
    expect(
      recursiveProgram.slice(recursiveProgram.indexOf("LOCAL-STORAGE")),
    ).toContain("01  GROWN");
    expect(working.match(/^ {7}01 {2}/gm) ?? []).toHaveLength(2);
    expect(unpadded(working)).toContain(
      "01 BANK-FAILURE-CODE PIC X(32) EXTERNAL.",
    );
    expect(unpadded(working)).toContain(
      "01 BANK-RETURN-CODE PIC S9(4) COMP EXTERNAL.",
    );
  });

  it("passes parameters and the result through LINKAGE", () => {
    const result = compile(RECURSIVE);

    expect(result.cobol).toContain("LINKAGE SECTION.");
    expect(result.cobol).toContain(
      "PROCEDURE DIVISION USING LK-P1 LK-P2 LK-RESULT.",
    );
  });

  it("reaches itself with CALL rather than PERFORM", () => {
    const result = compile(RECURSIVE);

    // A COBOL paragraph is not reentrant, so PERFORM would be undefined here.
    expect(result.cobol).toContain('CALL "COMPOUND" USING');
    expect(result.cobol).not.toContain("PERFORM COMPOUND");
  });

  it("computes a non-trivial argument instead of moving it", () => {
    const result = compile(RECURSIVE);

    // MOVE cannot take an arithmetic expression.
    expect(result.cobol).toContain("COMPUTE WS-ARG-2 = (LK-P2 - 1)");
  });

  it("keeps a non-recursive function as a paragraph", () => {
    const result = compile(`module Plain;

type Amount = decimal<18, 2>;

function double(a: Amount): Amount {
  return a + a;
}

function useIt(a: Amount): Amount {
  return double(a);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("PERFORM DOUBLE");
    expect(result.cobol).not.toContain("RECURSIVE.");
  });

  it("detects mutual recursion", () => {
    const result = compile(`module Mutual;

type Count = decimal<9, 0>;

function isEven(n: Count): bool {
  if n <= 0 {
    return true;
  } else {
    return isOdd(n - 1);
  }
}

function isOdd(n: Count): bool {
  if n <= 0 {
    return false;
  } else {
    return isEven(n - 1);
  }
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("PROGRAM-ID. ISEVEN RECURSIVE.");
    expect(result.cobol).toContain("PROGRAM-ID. ISODD RECURSIVE.");
  });
});

describe("per-field file mapping", () => {
  const FILES = `${PREAMBLE}
file feed sequential input record Ledger status feedStatus;
`;

  it("maps each field instead of moving the record as a group", () => {
    const result = compile(`${FILES}
transaction load(ledger: Ledger) {
  read feed into ledger;
  audit("LOADED", ledger.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("READ FEED-FILE");
    expect(result.cobol).not.toContain("READ FEED-FILE INTO");
    expect(result.cobol).toContain(
      "MOVE TOTAL OF FEED-RECORD TO TOTAL OF LEDGER",
    );
  });

  /**
   * COBOL rejects a move of an OCCURS item without a subscript, so a table has
   * to be copied element by element.
   */
  it("copies an array field element by element", () => {
    const result = compile(`${FILES}
transaction load(ledger: Ledger) {
  read feed into ledger;
  audit("LOADED", ledger.idempotencyKey);
}`);

    expect(flowed(result.cobol)).toContain(
      flowed(
        "PERFORM VARYING BANK-COPY-INDEX FROM 1 BY 1 UNTIL BANK-COPY-INDEX > 25",
      ),
    );
    expect(flowed(result.cobol)).toContain(
      flowed(
        "MOVE LINES-FLD OF FEED-RECORD (BANK-COPY-INDEX) TO LINES-FLD OF LEDGER (BANK-COPY-INDEX)",
      ),
    );
  });

  it("maps in the other direction on write", () => {
    const result = compile(`${PREAMBLE}
file sink sequential output record Ledger status sinkStatus;

transaction save(ledger: Ledger) {
  write sink from ledger;
  audit("SAVED", ledger.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "MOVE TOTAL OF LEDGER TO TOTAL OF SINK-RECORD",
    );
    expect(result.cobol).toContain("WRITE SINK-RECORD");
  });
});
