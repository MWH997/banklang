import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `nested function` — a COBOL contained program.
 *
 * An ordinary function is a paragraph the program `PERFORM`s, sharing all its
 * storage. A nested one is a program inside the program: its own working
 * storage, a real `CALL` boundary, and — the reason to write one — it reads the
 * module's records directly, because the container declares them `GLOBAL`.
 *
 * That is the difference from the sibling programs a recursive function already
 * becomes. A sibling sees nothing of its container and must be handed
 * everything; a contained program sees what the container shares.
 */

const PREAMBLE = `module Accrual;

record Position {
  balance: decimal<9, 2>;
  rate: decimal<5, 2>;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

const ACCRUED = `nested function accrued(position: Position): decimal<9, 2> {
  let raw: decimal<9, 2> = round(position.balance * position.rate, "HALF_UP");
  return divide(raw, 100.00, "HALF_UP");
}`;

function program(body: string, declaration = ACCRUED): string {
  return `${PREAMBLE}
${declaration}

entry transaction post(position: Position) {
${body}
  audit("ACCRUED", position.idempotencyKey);
}`;
}

describe("the contained program", () => {
  const result = compile(
    program("  position.balance = position.balance + accrued(position);"),
  );

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("is a program, not a paragraph", () => {
    expect(result.cobol).toContain("PROGRAM-ID. ACCRUED COMMON.");
    expect(result.cobol).toContain("END PROGRAM ACCRUED.");
  });

  /** Contained, not beside: it sits before the container's own END PROGRAM. */
  it("sits inside the container", () => {
    const text = result.cobol ?? "";

    expect(text.indexOf("END PROGRAM ACCRUED.")).toBeLessThan(
      text.indexOf("END PROGRAM ACCRUAL."),
    );
  });

  it("is called rather than performed", () => {
    expect(result.cobol).toContain('CALL "ACCRUED" USING ACCRUED-RESULT');
    expect(result.cobol).not.toContain("PERFORM ACCRUED");
  });

  /**
   * The whole point. Without `GLOBAL` the contained program cannot see the
   * container's storage at all, and the record would have to be passed.
   */
  it("reads the module's records through GLOBAL", () => {
    expect(result.cobol).toContain("01  POSITION-FLD GLOBAL.");
    expect(result.cobol).toContain("BALANCE OF POSITION-FLD");
  });

  /**
   * A record it can already see is not handed over as well. Passing it would be
   * a second name for the same storage.
   */
  it("takes no linkage item for a record it can see", () => {
    expect(result.cobol).not.toContain("01  LK-P1");
    expect(result.cobol).toContain("PROCEDURE DIVISION USING LK-RESULT.");
  });

  /** A value has to be handed over; only records come through GLOBAL. */
  it("passes a scalar through linkage", () => {
    const scaled = compile(
      program(
        "  position.balance = scaled(position, 2.00);",
        `nested function scaled(position: Position, factor: decimal<5, 2>): decimal<9, 2> {
  return round(position.balance * factor, "HALF_UP");
}`,
      ),
    );

    expect(scaled.diagnostics).toEqual([]);
    expect(scaled.cobol).toContain("01  LK-P1");
    expect(scaled.cobol).toContain("PROCEDURE DIVISION USING LK-P1 LK-RESULT.");
    expect(scaled.cobol).toContain(
      'CALL "SCALED" USING SCALED-P2, SCALED-RESULT',
    );
  });

  /** No GLOBAL where nothing is contained: it would be noise on every record. */
  it("leaves a program with no nested function alone", () => {
    const plain = compile(`${PREAMBLE}
entry transaction post(position: Position) {
  audit("ACCRUED", position.idempotencyKey);
}`);

    expect(plain.cobol).not.toContain("GLOBAL");
  });
});

/**
 * COBOL forbids LOCAL-STORAGE in a contained program, so a nested function's
 * locals are one copy shared by every invocation. A recursive one would
 * overwrite them on the way down and read the innermost call's values on the
 * way back out — it compiles, it runs, and it returns the wrong number.
 */
describe("it cannot recurse", () => {
  it("reports a nested function that calls itself", () => {
    const result = compile(`${PREAMBLE}
nested function countdown(position: Position, n: decimal<9, 0>): decimal<9, 0> {
  if n <= 0 {
    return 0;
  } else {
    return countdown(position, n - 1);
  }
}

entry transaction post(position: Position) {
  position.balance = 0.00;
  audit("ACCRUED", position.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-027");
  });

  it("reports one that reaches itself through another function", () => {
    const result = compile(`${PREAMBLE}
nested function outer(position: Position, n: decimal<9, 0>): decimal<9, 0> {
  return inner(position, n);
}

function inner(position: Position, n: decimal<9, 0>): decimal<9, 0> {
  return outer(position, n);
}

entry transaction post(position: Position) {
  position.balance = 0.00;
  audit("ACCRUED", position.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-TYPE-027");
  });

  /** An ordinary recursive function is a sibling with LOCAL-STORAGE. */
  it("leaves an ordinary recursive function alone", () => {
    const result = compile(`${PREAMBLE}
function countdown(n: decimal<9, 0>): decimal<9, 0> {
  if n <= 0 {
    return 0;
  } else {
    return countdown(n - 1);
  }
}

entry transaction post(position: Position) {
  position.balance = 0.00;
  audit("ACCRUED", position.idempotencyKey);
}`);

    expect(ids(result)).not.toContain("BANK-TYPE-027");
    expect(result.cobol).toContain("LOCAL-STORAGE SECTION.");
  });
});

/**
 * Reading the emitted COBOL says a contained program was written. It does not
 * say the container's storage is actually visible inside it, which is the only
 * claim the feature makes.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("computes through the container's record", () => {
    const result = compile(
      program(`  position.balance = 1000.00;
  position.rate = 5.00;
  position.balance = position.balance + accrued(position);
  log "BALANCE ", position.balance;`),
    );
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-nested-"));
    writeFileSync(join(dir, "program.cbl"), result.cobol ?? "", "utf8");

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
    expect(ran.status, ran.stderr).toBe(0);

    // 1000.00 + (1000.00 * 5.00 / 100) — computed inside the contained program
    // from a record it was never passed.
    expect(ran.stdout).toContain("1050.00");
  });
});
