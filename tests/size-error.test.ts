import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed, localCobol } from "./helpers";

/**
 * `ON SIZE ERROR` — what COBOL does when a result does not fit.
 *
 * The Language Reference leaves no room: "If the ON SIZE ERROR phrase is not
 * specified and a size error condition occurs, truncation rules apply and the
 * value of the affected resultant identifier is computed." The digits truncated
 * are the high-order ones, so an overflowing addition does not produce a large
 * wrong number that stands out — it produces a plausible small one.
 *
 * Two amounts a field can each hold do not add up to one it can, and a bank's
 * arithmetic is nearly all additions of amounts of the same declared width. So
 * this is the ordinary case, not an exotic one.
 */

const PREAMBLE = `module Money;

record Acct {
  a: decimal<9, 2>;
  b: decimal<9, 2>;
  total: decimal<9, 2>;
  idempotencyKey: string<36>;
}
`;

function program(body: string): string {
  return `${PREAMBLE}
entry transaction post(acct: Acct) {
${body}
  audit("POSTED", acct.idempotencyKey);
}`;
}

describe("a computation that can overflow", () => {
  const result = compile(program(`  acct.total = acct.a + acct.b;`));

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  /**
   * COBOL leaves the receiving field alone when the phrase is present rather
   * than storing the truncated answer, which is what makes stopping safe: the
   * wrong value never reaches the ledger.
   */
  it("names the field, sets a return code, and stops", () => {
    const text = flowed(result.cobol);
    expect(text).toContain("ON SIZE ERROR");
    expect(text).toContain('DISPLAY "ARITHMETIC OVERFLOW TOTAL OF ACCT"');
    expect(text).toContain("MOVE 12 TO BANK-RETURN-CODE");
    expect(result.cobol).toContain("END-COMPUTE");
  });
});

/**
 * Naming a value cannot overflow the field it is named for: it already fits the
 * type it was declared with. Guarding those would be four lines of COBOL that
 * can never run, on the most common statement in any program.
 */
describe("a computation that cannot", () => {
  it("leaves a plain assignment unguarded", () => {
    const result = compile(program(`  acct.total = acct.a;`));
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).not.toContain("ON SIZE ERROR");
  });
});

/**
 * A contained program is where a failure has furthest to travel.
 *
 * `GOBACK` in the outermost program returns to the operating system; in a
 * contained program it returns to the *container*, which used to carry straight
 * on and then overwrite the return code with its own on the way out — so an
 * overflow inside a nested function reported itself to the job log and the step
 * still ended with zero.
 *
 * What carries it now is the pair of EXTERNAL registers. A contained program
 * cannot see the container's working storage, so a register held by the run
 * unit is the only thing both can describe; the guard names the failure there
 * and leaves through the program's own exit, and the container's call site
 * tests the same register and leaves too.
 */
describe("a computation inside a nested function", () => {
  const result = compile(`module Nest;

record Book {
  total: decimal<9, 2>;
  a: decimal<9, 2>;
  b: decimal<9, 2>;
  idempotencyKey: string<36>;
}

nested function addUp(book: Book): decimal<9, 2> {
  return book.a + book.b;
}

entry transaction go(book: Book) {
  book.total = addUp(book);
  audit("DONE", book.idempotencyKey);
}`);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("raises into a register the container can read", () => {
    const text = result.cobol ?? "";
    const contained = text.slice(text.indexOf("PROGRAM-ID. ADDUP"));

    expect(text).toContain("ON SIZE ERROR");
    // The contained program describes the same two registers the container
    // does, and leaves through its own exit rather than jumping at a paragraph
    // of the container's that it cannot see.
    expect(contained).toContain("01  BANK-FAILURE-CODE    PIC X(32) EXTERNAL.");
    expect(contained).toContain("MOVE 12 TO BANK-RETURN-CODE");
    expect(contained).toContain(
      'MOVE "ARITHMETIC-OVERFLOW" TO BANK-FAILURE-CODE',
    );
    expect(contained).toContain("GO TO ADD-UP-EXIT");
    expect(contained).toContain("       ADD-UP-EXIT.\n           GOBACK.");
    expect(text).toContain("END PROGRAM ADDUP");
  });

  /**
   * The other half: a container that calls and carries on regardless is how the
   * return code got overwritten. Every call site tests the register.
   */
  it("stops the container at the call site", () => {
    const text = result.cobol ?? "";
    const container = text.slice(0, text.indexOf("PROGRAM-ID. ADDUP"));

    expect(container).toContain('CALL "ADDUP"');
    expect(container).toContain("IF BANK-FAILURE-CODE NOT = SPACES");
  });
});

/**
 * The point of the whole thing, run rather than read.
 *
 * Before the phrase was emitted this printed 9,999,999.98 and exited zero: the
 * true total, 19,999,999.98, lost its leading digit on the way into a field
 * that could not hold it, and every signal the job produced said it had worked.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("stops rather than storing a truncated total", () => {
    const result = compile(
      program(`  acct.a = 9999999.99;
  acct.b = 9999999.99;
  acct.total = acct.a + acct.b;
  log "TOTAL=", acct.total;`),
    );
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-size-"));
    writeFileSync(
      join(dir, "program.cbl"),
      localCobol(result.cobol ?? ""),
      "utf8",
    );

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });

    // The overflow is named in the job log, the step fails, and the wrong
    // total is never printed because it was never stored.
    expect(ran.stdout).toContain("ARITHMETIC OVERFLOW TOTAL OF ACCT");
    expect(ran.status).toBe(12);
    expect(ran.stdout).not.toContain("TOTAL=+9999999.98");
  });
});
