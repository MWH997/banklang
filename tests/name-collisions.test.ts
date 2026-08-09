import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";
import { compile } from "../packages/compiler/src/index";
import { toCobolFieldName } from "../packages/cobol-ir/src/index";

/**
 * `BANK-NAME-001` — two BankTS names that arrive at one COBOL word.
 *
 * A COBOL word is thirty characters, so a longer name is abbreviated word by
 * word until it fits. `fitCobolWord` is deterministic and stateless, which is
 * what makes the same source name produce the same COBOL name in every build —
 * and also what stops it noticing that the word it just produced is one another
 * name already reached.
 *
 * Before this diagnostic the compiler accepted such a program and said nothing.
 * `bankc check` printed `OK`, `bankc build` wrote the artifacts, and the COBOL
 * declared one name twice:
 *
 *     05  SETTLEMENTRECONCILIATIONTHRESH  PIC S9(16)V99 COMP-3.
 *     05  SETTLEMENTRECONCILIATIONTHRESH  PIC S9(16)V99 COMP-3.
 *
 * `cobc` answers `'SETTLEMENTRECONCILIATIONTHRESH IN PICK-P1' is ambiguous;
 * needs qualification` and refuses, so the compiler's own claim — that what it
 * emits compiles — was false for a program it called clean. Three documents and
 * two source comments said `BANK-NAME-001` reported this. None of them was
 * true: the identifier was not in the catalogue and the function they named,
 * `collectCobolNameCollisions`, did not exist.
 *
 * The two halves below are the two scopes COBOL requires uniqueness in, and the
 * third test is the case that must stay legal — the one that makes this a
 * scoped rule rather than "no two names may abbreviate alike".
 */

const MONEY = "type MoneyBDT = decimal<18, 2>;";

/** Two names long enough to be abbreviated, differing only past the limit. */
const ALPHA = "settlementreconciliationthresholdalpha";
const BETA = "settlementreconciliationthresholdbeta";

function compileSource(source: string) {
  return compile(source, { sourceFile: "main.bank.ts" });
}

function idsOf(source: string): string[] {
  return compileSource(source).diagnostics.map((entry) => entry.id);
}

describe("two names that become one COBOL word", () => {
  it("is the premise: these two names do reach the same word", () => {
    expect(toCobolFieldName(ALPHA)).toBe(toCobolFieldName(BETA));
    expect(toCobolFieldName(ALPHA)).toHaveLength(30);
  });

  it("is refused when both are fields of one record", () => {
    const result = compileSource(`module Collide;

${MONEY}

record Thresholds {
  ${ALPHA}: MoneyBDT;
  ${BETA}: MoneyBDT;
}

function pick(t: Thresholds): MoneyBDT {
  return t.${ALPHA};
}
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-NAME-001",
    );
    // No artifact, because the artifact is the thing that would not compile.
    expect(result.cobol).toBeNull();

    const reported = result.diagnostics.find(
      (entry) => entry.id === "BANK-NAME-001",
    );
    // Both names in the message: the author has to know which two to look at,
    // and the second one alone does not say what it collided with.
    expect(reported?.message).toContain(ALPHA);
    expect(reported?.message).toContain(BETA);
    expect(reported?.message).toContain(toCobolFieldName(ALPHA));
  });

  /**
   * The case a check on the paragraph names alone would miss.
   *
   * A routine owns more than its paragraph: `-P1` for each parameter, a
   * `-RESULT` cell, an `-EXIT` label. Each is built by appending a suffix and
   * abbreviating again, so two routines can collide on those while the
   * paragraph names still differ — `cobc` reported `'SETT-P1' is ambiguous` and
   * `'SETT-RESULT' is ambiguous` for exactly this program.
   */
  it("is refused when two functions share a generated cell", () => {
    const result = compileSource(`module TwoFunctions;

${MONEY}

function ${ALPHA}(x: MoneyBDT): MoneyBDT {
  return x;
}

function ${BETA}(x: MoneyBDT): MoneyBDT {
  return x;
}
`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-NAME-001",
    );
    expect(
      result.diagnostics.some((entry) => /-RESULT|-P1/.test(entry.message)),
    ).toBe(true);
  });

  /**
   * The same field name under two different `01` groups is ordinary COBOL.
   *
   * A reference qualified with `OF` resolves it and the backend qualifies, so a
   * rule that refused this would refuse a great deal of correct code. Checked
   * because the first draft of the rule was program-wide and did.
   */
  it("is allowed when the two fields are in different records", () => {
    expect(
      idsOf(`module CrossRecord;

${MONEY}

record Alpha {
  ${ALPHA}: MoneyBDT;
}

record Beta {
  ${BETA}: MoneyBDT;
}

function pick(a: Alpha, b: Beta): MoneyBDT {
  return a.${ALPHA} + b.${BETA};
}
`),
    ).not.toContain("BANK-NAME-001");
  });

  /**
   * Locals, where the backend resolves half the problem already.
   *
   * `planLocalFields` counts the *distinct* bare names each routine declares
   * and qualifies a name more than one routine uses — `scratch` in `feeOn` and
   * in `levyOn` become `FEE-ON-SCRATCH` and `LEVY-ON-SCRATCH`. Two locals of
   * one routine are the case it cannot see: the plan counts one distinct name
   * where the source has two, so it qualifies neither and both are emitted as
   * the same `01`.
   */
  it("is refused when one routine declares two locals that abbreviate alike", () => {
    const result = compileSource(`module OneRoutine;

${MONEY}

function total(x: MoneyBDT): MoneyBDT {
  let ${ALPHA}: MoneyBDT = x;
  let ${BETA}: MoneyBDT = x;
  return ${ALPHA} + ${BETA};
}
`);

    expect(result.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-NAME-001",
    );
  });

  it("is allowed when two routines declare the same local", () => {
    expect(
      idsOf(`module TwoRoutines;

${MONEY}

function feeOn(x: MoneyBDT): MoneyBDT {
  let scratch: MoneyBDT = x;
  return scratch;
}

function levyOn(x: MoneyBDT): MoneyBDT {
  let scratch: MoneyBDT = x;
  return scratch;
}
`),
    ).not.toContain("BANK-NAME-001");
  });

  it("says nothing about a program whose names are ordinary", () => {
    expect(
      idsOf(`module Plain;

${MONEY}

record Transfer {
  amount: MoneyBDT;
  fee: MoneyBDT;
}

function total(t: Transfer): MoneyBDT {
  return t.amount + t.fee;
}
`),
    ).not.toContain("BANK-NAME-001");
  });
});

/**
 * `bankc` and `compile()` answering the same question the same way.
 *
 * `compileProject` in the CLI walks the phases itself rather than calling
 * `compile()`, so the two are separate call sites over one pipeline. That is
 * how this diagnostic first landed: `compile()` reported it, `bankc check`
 * printed `OK`, and the difference was invisible because nothing compared them.
 * A check wired into one path and not the other is a compiler that answers
 * differently depending on who asks.
 */
describe("the CLI and the compiler API report the same diagnostics", () => {
  const cases: Record<string, string> = {
    "field collision": `module Collide;

${MONEY}

record Thresholds {
  ${ALPHA}: MoneyBDT;
  ${BETA}: MoneyBDT;
}
`,
    "routine collision": `module TwoFunctions;

${MONEY}

function ${ALPHA}(x: MoneyBDT): MoneyBDT { return x; }
function ${BETA}(x: MoneyBDT): MoneyBDT { return x; }
`,
    "no collision": `module Plain;

${MONEY}

record Transfer {
  amount: MoneyBDT;
}
`,
  };

  for (const [name, source] of Object.entries(cases)) {
    it(`agrees on ${name}`, () => {
      const project = mkdtempSync(join(tmpdir(), "banklang-names-"));
      mkdirSync(join(project, "src"), { recursive: true });
      writeFileSync(join(project, "src", "main.bank.ts"), source);

      const cli = runBankc(["check", project]);
      const api = compileSource(source);
      const reported = api.diagnostics.some(
        (entry) => entry.id === "BANK-NAME-001",
      );

      // Diagnostics go to stderr; `check` writes only its OK line to stdout.
      expect(cli.stderr.includes("BANK-NAME-001")).toBe(reported);
      expect(cli.exitCode === 0).toBe(!reported);
    });
  }
});
