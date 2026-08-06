import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { checked, corpus, flowed, localCobol, parmDriver } from "./helpers";

/**
 * Computed subscripts, and every place one can appear.
 *
 * COBOL does not check subscripts. An index past the end of a table addresses
 * whatever storage follows it, which inside a record is the next field — so an
 * out-of-range *write* does not fail, it quietly changes a different field of
 * the same record.
 *
 * Guarding used to be reached only from the right-hand side of an assignment,
 * which left the subscript on an assignment's target, in a condition, in a
 * `log`, and in everything inside a sort procedure unguarded. These tests are
 * one per seam, because that is how the gaps got there.
 */

const PREAMBLE = `module Bounds;

type GBP = currency<"GBP", 18, 2>;
type Count = decimal<9, 0>;

record Band {
  cap: GBP;
}

record Book {
  bands: Band[10];
  total: GBP;
  idempotencyKey: string<36>;
}
`;

function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction go(book: Book, at: Count) {
${body}
  audit("DONE", book.idempotencyKey);
}`);
}

const GUARD = "IF GO-FLD-P2 < 1 OR GO-FLD-P2 > 10";

describe("a computed subscript is guarded wherever it appears", () => {
  it("on the value being assigned", () => {
    const result = txn("  book.total = book.bands[at].cap;");
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(GUARD);
  });

  /**
   * The one that corrupts rather than merely misreads: the element addressed
   * is written to, so an index past the end changes the field after the table.
   */
  it("on the target being assigned to", () => {
    const result = txn("  book.bands[at].cap = book.total;");
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(GUARD);
  });

  it("in a condition", () => {
    const result = txn(`  if book.total > book.bands[at].cap {
    book.total = 0.00;
  }`);
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(GUARD);
  });

  it("in a value written to the job log", () => {
    const result = txn('  log "CAP=", book.bands[at].cap;');
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(GUARD);
  });

  it("as the argument of an intrinsic", () => {
    const result = txn("  book.total = abs(book.bands[at].cap);");
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(GUARD);
  });

  /**
   * A literal subscript was proved in range when it was compiled, so guarding
   * one would be a branch that can never be taken.
   */
  it("but not a literal one", () => {
    const result = txn("  book.total = book.bands[3].cap;");
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).not.toMatch(/IF 3 < 1/);
  });

  /** One guard per statement, however many times the statement reads it. */
  it("once per statement", () => {
    const result = txn("  book.bands[at].cap = book.bands[at].cap;");
    expect(result.diagnostics).toEqual([]);
    expect((result.cobol ?? "").split(GUARD).length - 1).toBe(1);
  });
});

/**
 * A `while` condition is evaluated again before every iteration after the
 * first, and the body may have moved the subscript since the guard that ran
 * ahead of the loop. So there are two: one before, one at the end of the body.
 */
describe("a subscript in a loop condition", () => {
  const result = compile(`${PREAMBLE}
entry transaction go(book: Book, at: Count) {
  while book.total > book.bands[at].cap limit 10 {
    book.total = book.total - 1.00;
  }
  audit("DONE", book.idempotencyKey);
}`);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("is guarded before the loop and again inside it", () => {
    expect((result.cobol ?? "").split(GUARD).length - 1).toBe(2);
  });
});

/**
 * Control may not leave a sort procedure while the sort is running, so this is
 * the one place the guard cannot raise. It fails the sort instead, and brings
 * the subscript inside the table so the statement it guards cannot write over
 * the record on the way out.
 */
describe("a subscript inside a sort procedure", () => {
  const result = compile(`module Ordering;

type GBP = currency<"GBP", 18, 2>;
type Count = decimal<9, 0>;

record Band {
  cap: GBP;
}

record Posting {
  branchId: string<8>;
  amount: GBP;
  idempotencyKey: string<36>;
}

record Book {
  bands: Band[10];
  idempotencyKey: string<36>;
}

file rawPostings sequential input record Posting status rawStatus;
file sortedPostings sequential output record Posting status sortedStatus;

entry transaction order(posting: Posting, book: Book, at: Count) {
  sort rawPostings into sortedPostings on branchId
    input posting {
      if posting.amount > book.bands[at].cap {
        release posting;
      }
    };
  audit("SORTED", posting.idempotencyKey);
}`);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("fails the sort rather than returning through it", () => {
    const text = flowed(result.cobol);
    expect(text).toContain("IF ORDER-FLD-P3 < 1 OR ORDER-FLD-P3 > 10");
    expect(text).toContain('DISPLAY "SUBSCRIPT OUT OF RANGE " ORDER-FLD-P3');
    expect(text).toContain("MOVE 16 TO SORT-RETURN");
    expect(text).not.toContain("GO TO ORDER-FLD-BODY-EXIT");
  });
});

/**
 * A raise with no handler used to end the step with return code zero: the body
 * stopped where it failed, and the job reported the same success as one that
 * finished its work.
 */
describe("a failure nothing handles", () => {
  it("names itself and fails the step", () => {
    const result = txn("  book.total = book.bands[at].cap;");
    const text = flowed(result.cobol);
    expect(text).toContain('DISPLAY "TRANSACTION FAILED go "');
    expect(text).toContain("MOVE 12 TO BANK-RETURN-CODE");
  });

  it("leaves a transaction with a handler to its own handler", () => {
    const result = compile(`${PREAMBLE}
entry transaction go(book: Book, at: Count) {
  on failure {
    audit("REJECTED", book.idempotencyKey);
  }
  book.total = book.bands[at].cap;
  audit("DONE", book.idempotencyKey);
}`);
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).not.toContain("TRANSACTION FAILED");
  });
});

/**
 * The point of all of it, run rather than read.
 *
 * `bands` is ten elements and `total` is declared straight after it, so index
 * 11 addresses `total`. Before the target of an assignment was guarded, this
 * set `total` to 999.00 — a field the program never assigns — and exited zero.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  function run(at: number): { stdout: string; status: number | null } {
    const result = txn(`  book.total = 42.00;
  book.bands[at].cap = 999.00;
  log "TOTAL=", book.total;`);
    expect(result.diagnostics).toEqual([]);

    // `at` is an entry parameter, so it arrives in the job's PARM. The driver
    // builds one the way the initiator would, which is also the only way to
    // choose the subscript from outside the program.
    const dir = mkdtempSync(join(tmpdir(), "bankc-bounds-"));
    writeFileSync(
      join(dir, "program.cbl"),
      localCobol(result.cobol ?? ""),
      "utf8",
    );
    writeFileSync(
      join(dir, "driver.cbl"),
      parmDriver(result.program!, { at }),
      "utf8",
    );
    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "driver.cbl",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });
    return { stdout: ran.stdout, status: ran.status };
  }

  it.skipIf(!available)("does not write past the end of the table", () => {
    const out = run(11);
    expect(out.stdout).toContain("BANK-BOUNDS-VIOLATION");
    expect(out.status).toBe(12);
    // The neighbouring field still holds what the program put there.
    expect(out.stdout).not.toContain("999.00");
  });

  it.skipIf(!available)("leaves an index inside the table alone", () => {
    const out = run(3);
    expect(out.stdout).toContain("TOTAL=+0000000000000042.00");
    expect(out.status).toBe(0);
  });
});

/**
 * The bounds guard, over every example that subscripts anything.
 *
 * `SSRANGE` is a compile option a site can turn off, so the check is generated
 * rather than asked for. That only holds if it is generated everywhere.
 */
describe("across the corpus", () => {
  it("range-checks a computed subscript before the statement using it", () => {
    let tables = 0;
    for (const { example, cobol } of corpus()) {
      // Only a program with a table can subscript one. Everything else that
      // looks like `NAME (SOMETHING)` is a function reference, a CICS
      // condition name or a reference modification, none of which is indexing.
      if (!cobol.includes("OCCURS")) {
        continue;
      }
      tables += 1;
      const text = flowed(cobol)
        .replace(/FUNCTION [A-Z0-9-]+ \([^)]*\)/g, " ")
        .replace(/DFHRESP\([^)]*\)/g, " ")
        .replace(/\([^)]*:[^)]*\)/g, " ");
      // A `PERFORM VARYING` index is bounded by the loop that drives it: the
      // UNTIL clause is the check, and generating a second one inside the loop
      // would be a branch that cannot be taken. So what needs a guard is a
      // subscript that came from somewhere the statement does not control.
      const loopIndexes = new Set(
        [...text.matchAll(/PERFORM VARYING ([A-Z][A-Z0-9-]*) FROM/g)].map(
          (match) => match[1],
        ),
      );
      const computed = [
        ...text.matchAll(/[A-Z][A-Z0-9-]* \(([A-Z][A-Z0-9-]*)\)/g),
      ].filter((match) => !loopIndexes.has(match[1]));

      if (computed.length === 0) {
        continue;
      }
      expect(
        flowed(cobol),
        `${example} subscripts a table with ${computed[0][1]}, which no loop bounds, and emits no bounds status.`,
      ).toContain("BANK-BOUNDS-STATUS");
    }

    checked(tables, 2, "programs with a table");
  });
});
