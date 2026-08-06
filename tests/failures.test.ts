import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { corpus } from "./helpers";

const PREAMBLE = `module Failures;

type BDT = currency<"BDT", 18, 2>;
type Count = decimal<9, 0>;

record Request {
  accountId: string<16>;
  amount: BDT;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

describe("raise", () => {
  it("records the code and leaves the body", () => {
    const result = compile(`${PREAMBLE}
transaction post(request: Request) {
  if request.amount <= 0.00 {
    raise "NON_POSITIVE";
  }
  debit(request.accountId, request.amount);
  credit("CASH", request.amount);
  audit("POSTED", request.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain('MOVE "NON_POSITIVE" TO BANK-FAILURE-CODE');
    expect(result.cobol).toContain("GO TO POST-BODY-EXIT");
  });

  /**
   * `GO TO` out of a plain `PERFORM` range leaves the flow of control
   * undefined, so the wrapper has to perform the body THRU its exit paragraph.
   */
  it("performs the body THRU its exit paragraph", () => {
    const result = compile(`${PREAMBLE}
transaction post(request: Request) {
  if request.amount <= 0.00 {
    raise "NON_POSITIVE";
  }
  audit("POSTED", request.idempotencyKey);
}`);

    expect(result.cobol).toContain("PERFORM POST-BODY THRU POST-BODY-EXIT");
  });

  it("declares the failure code as EXTERNAL so sibling programs share it", () => {
    const result = compile(`${PREAMBLE}
transaction post(request: Request) {
  if request.amount <= 0.00 {
    raise "NON_POSITIVE";
  }
  audit("POSTED", request.idempotencyKey);
}`);

    expect(result.cobol).toContain(
      "01  BANK-FAILURE-CODE    PIC X(32) EXTERNAL.",
    );
  });

  /**
   * The wrapper is what a declared failure buys: a body paragraph performed
   * THRU its exit, and a handler run when the register is set. A transaction
   * that raises nothing has no handler to run, so it has no wrapper.
   *
   * The register itself is not part of that. Every program declares one,
   * because a subscript outside its table, an overflow or a failed OPEN is a
   * failure the source never declared — and gating the declaration on a
   * declared `raise` is how a generated guard came to write into a field its
   * program had never described.
   */
  it("generates no failure wrapper for a transaction that cannot fail", () => {
    const result = compile(`${PREAMBLE}
transaction post(request: Request) {
  debit(request.accountId, request.amount);
  credit("CASH", request.amount);
  audit("POSTED", request.idempotencyKey);
}`);

    expect(result.cobol).not.toContain("POST-BODY");
    expect(result.cobol).not.toContain("POST-FAILURE");
    expect(result.cobol).toContain("01  BANK-FAILURE-CODE    PIC X(32)");
  });

  it("rejects an empty failure code", () => {
    const result = compile(`${PREAMBLE}
transaction post(request: Request) {
  raise "";
  audit("POSTED", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TXN-008");
  });

  it("rejects a code wider than the failure field", () => {
    const result = compile(`${PREAMBLE}
transaction post(request: Request) {
  raise "THIS_FAILURE_CODE_IS_MUCH_TOO_LONG_TO_FIT_THE_FIELD";
  audit("POSTED", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TXN-008");
  });
});

describe("on failure", () => {
  const HANDLED = `${PREAMBLE}
transaction post(request: Request) {
  on failure {
    audit("REJECTED", request.idempotencyKey);
  }

  if request.amount <= 0.00 {
    raise "NON_POSITIVE";
  }

  debit(request.accountId, request.amount);
  credit("CASH", request.amount);
  audit("POSTED", request.idempotencyKey);
}`;

  it("runs the handler when the body raised", () => {
    const result = compile(HANDLED);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("IF BANK-FAILURE-CODE NOT = SPACES");
    expect(result.cobol).toContain("PERFORM POST-FAILURE");
    expect(result.cobol).toContain('MOVE "REJECTED" TO BANK-AUDIT-EVENT');
  });

  /**
   * A transaction that raised after posting has to leave the ledger as it found
   * it. Unwinding is the ledger's job, so the failure path asks for it rather
   * than generating compensating postings of its own invention.
   */
  it("asks the ledger to unwind before the handler runs", () => {
    const result = compile(HANDLED);
    const failurePath = (result.cobol ?? "").slice(
      (result.cobol ?? "").indexOf("       POST-FAILURE."),
    );

    expect(failurePath).toContain('MOVE "ROLLBK" TO BANK-LEDGER-OPERATION');
    expect(failurePath.indexOf('CALL "BANKLEDG"')).toBeLessThan(
      failurePath.indexOf('MOVE "REJECTED"'),
    );
  });

  it("does not ask for a rollback when nothing was posted", () => {
    const result = compile(`${PREAMBLE}
transaction check(request: Request) {
  on failure {
    audit("REJECTED", request.idempotencyKey);
  }

  if request.amount <= 0.00 {
    raise "NON_POSITIVE";
  }

  audit("CHECKED", request.idempotencyKey);
}`);

    expect(result.cobol).not.toContain("ROLLBK");
  });

  it("rejects a handler that raises", () => {
    const result = compile(`${PREAMBLE}
transaction post(request: Request) {
  on failure {
    raise "HANDLER_FAILED";
  }

  if request.amount <= 0.00 {
    raise "NON_POSITIVE";
  }

  audit("POSTED", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TXN-009");
  });
});

describe("failure propagation through calls", () => {
  const CALLING = `${PREAMBLE}
function checked(amount: BDT): BDT {
  if amount <= 0.00 {
    raise "NON_POSITIVE";
  }
  return amount;
}

transaction post(request: Request) {
  let amount: BDT = checked(request.amount);
  debit(request.accountId, amount);
  credit("CASH", amount);
  audit("POSTED", request.idempotencyKey);
}`;

  /**
   * COBOL does not unwind, so a failure raised inside a callee only propagates
   * if the caller tests for it and leaves too.
   */
  it("tests the failure code after performing a callee that can fail", () => {
    const result = compile(CALLING);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("PERFORM CHECKED THRU CHECKED-EXIT");
    const body = (result.cobol ?? "").slice(
      (result.cobol ?? "").indexOf("PERFORM CHECKED THRU"),
    );
    expect(body).toContain("IF BANK-FAILURE-CODE NOT = SPACES");
    expect(body).toContain("GO TO POST-BODY-EXIT");
  });

  it("marks the calling transaction as able to fail", () => {
    const result = compile(CALLING);

    expect(
      result.program?.transactions.find(
        (transaction) => transaction.name === "post",
      )?.canFail,
    ).toBe(true);
  });

  it("propagates through a function that only calls a raising function", () => {
    const result = compile(`${PREAMBLE}
function inner(amount: BDT): BDT {
  if amount <= 0.00 {
    raise "NON_POSITIVE";
  }
  return amount;
}

function outer(amount: BDT): BDT {
  return inner(amount);
}

transaction post(request: Request) {
  let amount: BDT = outer(request.amount);
  audit("POSTED", request.idempotencyKey);
}`);

    expect(
      result.program?.functions.find((fn) => fn.name === "outer")?.canFail,
    ).toBe(true);
  });

  /**
   * Every routine is performed THRU its exit, whether or not it was declared
   * able to raise. A `GO TO` out of the middle of a plain `PERFORM` range
   * leaves the flow of control undefined, and what puts one there is usually a
   * generated guard rather than a `raise` anybody wrote — an overflow, a failed
   * READ, a subscript outside its table. One shape for every call site, so the
   * one that can jump is not the exception nobody remembered.
   */
  it("performs a function that cannot fail THRU its exit as well", () => {
    const result = compile(`${PREAMBLE}
function twice(amount: BDT): BDT {
  return amount + amount;
}

transaction post(request: Request) {
  let amount: BDT = twice(request.amount);
  audit("POSTED", request.idempotencyKey);
}`);

    expect(result.cobol).toContain("PERFORM TWICE THRU TWICE-EXIT");
    expect(result.cobol).toContain("       TWICE-EXIT.\n           EXIT.");
  });
});

describe("guard clauses", () => {
  /**
   * `if <bad> { raise "..."; }` reads as a precondition, not as a branch that
   * has to produce a value, so it needs no else.
   */
  it("allows a guard with no else in a function body", () => {
    const result = compile(`${PREAMBLE}
function checked(amount: BDT): BDT {
  if amount <= 0.00 {
    raise "NON_POSITIVE";
  }
  return amount;
}

transaction post(request: Request) {
  let amount: BDT = checked(request.amount);
  audit("POSTED", request.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
  });

  it("still requires an else when the branch can fall through", () => {
    const result = compile(`${PREAMBLE}
function checked(amount: BDT): BDT {
  if amount <= 0.00 {
    let zero: BDT = 0.00;
  }
  return amount;
}

transaction post(request: Request) {
  let amount: BDT = checked(request.amount);
  audit("POSTED", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-004");
  });
});

describe("bounds violations", () => {
  const ARRAY = `${PREAMBLE}
record Batch {
  amounts: BDT[25];
  idempotencyKey: string<36>;
}
`;

  /**
   * A clamped subscript runs the statement against the wrong element, which is
   * the defect the check exists to prevent. Raising abandons the work instead.
   */
  it("raises instead of clamping when a handler can see it", () => {
    const result = compile(`${ARRAY}
transaction pick(batch: Batch, at: Count) {
  on failure {
    audit("PICK_REJECTED", batch.idempotencyKey);
  }

  let value: BDT = batch.amounts[at];
  audit("PICKED", batch.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      'MOVE "BANK-BOUNDS-VIOLATION" TO BANK-FAILURE-CODE',
    );
    expect(result.cobol).not.toContain("MOVE 25 TO PICK-P2");
  });

  it("still records the file-status style code for an operator", () => {
    const result = compile(`${ARRAY}
transaction pick(batch: Batch, at: Count) {
  let value: BDT = batch.amounts[at];
  audit("PICKED", batch.idempotencyKey);
}`);

    expect(result.cobol).toContain('MOVE "23" TO BANK-BOUNDS-STATUS');
  });

  it("marks a transaction with a computed subscript as able to fail", () => {
    const result = compile(`${ARRAY}
transaction pick(batch: Batch, at: Count) {
  let value: BDT = batch.amounts[at];
  audit("PICKED", batch.idempotencyKey);
}`);

    expect(
      result.program?.transactions.find(
        (transaction) => transaction.name === "pick",
      )?.canFail,
    ).toBe(true);
  });

  it("leaves a literal subscript unguarded", () => {
    const result = compile(`${ARRAY}
transaction pick(batch: Batch) {
  let value: BDT = batch.amounts[3];
  audit("PICKED", batch.idempotencyKey);
}`);

    expect(
      result.program?.transactions.find(
        (transaction) => transaction.name === "pick",
      )?.canFail,
    ).toBe(false);
  });
});

describe("entry point", () => {
  it("starts the program at the entry transaction", () => {
    const result = compile(`${PREAMBLE}
transaction helper(request: Request) {
  audit("HELPED", request.idempotencyKey);
}

entry transaction main(request: Request) {
  audit("STARTED", request.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    // The two registers are set first: both are EXTERNAL, so the run unit owns
    // the storage and a VALUE clause on one is honoured by Enterprise COBOL and
    // ignored by GnuCOBOL.
    expect(result.cobol).toContain(
      [
        "       BANK-MAIN.",
        "           MOVE 0 TO BANK-RETURN-CODE",
        "           MOVE SPACES TO BANK-FAILURE-CODE",
        "           PERFORM MAIN",
      ].join("\n"),
    );
  });

  /**
   * COBOL enters a program at the first statement of the PROCEDURE DIVISION,
   * which without this paragraph would be whichever function was emitted first.
   */
  it("falls back to the first transaction when none is marked", () => {
    const result = compile(`${PREAMBLE}
function helper(amount: BDT): BDT {
  return amount;
}

transaction first(request: Request) {
  audit("FIRST", request.idempotencyKey);
}

transaction second(request: Request) {
  audit("SECOND", request.idempotencyKey);
}`);

    expect(result.cobol).toContain("PERFORM FIRST");
    expect((result.cobol ?? "").indexOf("BANK-MAIN.")).toBeLessThan(
      (result.cobol ?? "").indexOf("HELPER."),
    );
  });

  it("rejects a second entry transaction", () => {
    const result = compile(`${PREAMBLE}
entry transaction one(request: Request) {
  audit("ONE", request.idempotencyKey);
}

entry transaction two(request: Request) {
  audit("TWO", request.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TXN-010");
  });
});

/**
 * The exit convention, over every example rather than the one written above.
 *
 * `PERFORM ... THRU ...-EXIT` and a single terminating paragraph are the whole
 * of the audit F4 fix, and a fix proved on one program is proved for one
 * program. Every generated paragraph in the corpus is read here instead.
 */
describe("across the corpus", () => {
  it("ends the program only in BANK-MAIN", () => {
    for (const { example, cobol } of corpus()) {
      // A contained program has a BANK-MAIN of its own, and a recursive one
      // returns through its own exit; both are terminations of that program.
      const terminators = cobol
        .split("\n")
        .filter((line) => /^\s+GOBACK\.?$/.test(line.slice(6)));
      const mains = cobol.match(/^ {7}BANK-MAIN\.$/gm) ?? [];

      expect(
        terminators.length,
        `${example} ends the program ${terminators.length} times for ${mains.length} BANK-MAIN paragraph(s).`,
      ).toBeLessThanOrEqual(mains.length + 1);
    }
  });

  it("performs every routine THRU its exit paragraph", () => {
    for (const { example, cobol } of corpus()) {
      const performed = [
        ...cobol.matchAll(/PERFORM ([A-Z][A-Z0-9-]*) THRU ([A-Z][A-Z0-9-]*)/g),
      ];
      for (const [, routine, exit] of performed) {
        expect(
          exit,
          `${example} performs ${routine} THRU ${exit}, which is not its exit paragraph.`,
        ).toBe(`${routine}-EXIT`);
      }
    }
  });
});
