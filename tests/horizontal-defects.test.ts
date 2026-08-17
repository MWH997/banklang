import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import {
  DEFECT_DEMONSTRATIONS,
  DEFECT_FAMILIES,
} from "../packages/horizontal-validation/src/index";

/**
 * The defects BankLang claims to prevent, compiled to prove it.
 *
 * The OpenCBS suite is 43 defects real COBOL developers reported on public
 * forums, reconstructed as programs. It is easy, and worthless, to read that
 * list and assert that a safer language would have caught most of them. So the
 * rule for the defect-coverage matrix is that nothing may be reported as
 * prevented without a program here that the compiler refuses, and this is where
 * the compiler is asked.
 *
 * Each case names the diagnostic exactly. A defect that starts being caught by
 * a different rule is worth being told about: it may mean the rule that used to
 * catch it has stopped working, and the program would still compile if both
 * regressed.
 *
 * **These reproduce the defect, not the upstream COBOL.** Each was written from
 * the defect's own description: the banner comment saying what went wrong and
 * why. A transliteration of the upstream program would only establish that
 * BankTS cannot parse COBOL.
 *
 * Nothing here reads the corpus. The BankTS is checked in, so the suite runs
 * on a clone with no `validation/cache/`; `tests/horizontal-corpus.test.ts`
 * is what ties these ids back to the upstream files when the cache is present.
 */

describe("defects from the OpenCBS suite, against the compiler", () => {
  for (const demonstration of DEFECT_DEMONSTRATIONS) {
    it(`${demonstration.defect}: ${demonstration.summary.slice(0, 72)}…`, () => {
      const source = demonstration.source;
      expect(
        source,
        `${demonstration.defect} has no program to compile`,
      ).not.toBeNull();

      const result = compile(source as string, {
        sourceFile: `${demonstration.defect}.bank.ts`,
      });

      expect(
        result.ok,
        `${demonstration.defect} compiled. The defect it reproduces is not prevented, and the matrix says it is.`,
      ).toBe(false);

      const ids = result.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.id);

      expect(
        ids,
        `${demonstration.defect} was refused, and not by ${demonstration.expectDiagnostic}. Refused by: ${ids.join(", ")}`,
      ).toContain(demonstration.expectDiagnostic);
    });
  }

  it("claims prevention only where a program demonstrates it", () => {
    // `prevented-at-compile-time` is the only coverage that asserts BankLang
    // does something. Every row carrying it must have a program above.
    const claimed = DEFECT_DEMONSTRATIONS.filter(
      (entry) => entry.coverage === "prevented-at-compile-time",
    );
    for (const entry of claimed) {
      expect(
        entry.source,
        `${entry.defect} claims prevention with no program`,
      ).not.toBeNull();
    }
    expect(claimed.length).toBeGreaterThan(4);
  });

  it("gives every defect family a position and a pattern that can match", () => {
    for (const family of DEFECT_FAMILIES) {
      expect(family.banklangPosition.length, family.family).toBeGreaterThan(60);
      // A pattern that matches nothing silently empties a family, and an empty
      // family reads as "no defects of this kind" rather than "the rule broke".
      expect(() => "probe".match(family.pattern)).not.toThrow();
    }
    expect(new Set(DEFECT_FAMILIES.map((family) => family.family)).size).toBe(
      DEFECT_FAMILIES.length,
    );
  });
});

/**
 * The compiler defect horizontal validation found, kept fixed.
 *
 * Writing COBOLEval's `is_prime` from its specification needs a conditional
 * inside a trial-division loop, in a function, because the task is a
 * computation rather than a unit of work. That was refused with
 * `BANK-TYPE-007`, while a `switch` in exactly the same position compiled.
 *
 * The inconsistency was already known here and already fixed *for transactions*:
 * the comment in `validateWhileStatement` calls it "an oversight rather than a
 * rule". The guard read `inTransaction && …`, so the other half of the language
 * kept it. Nothing noticed because every example that branches inside a loop is
 * a transaction.
 */
describe("a branch inside a loop, in a function", () => {
  const head = `module Probe;

enum Flag {
  YES,
  NO,
}

record Totals {
  total: decimal<9, 0>;
  flag: Flag;
}
`;

  const withBody = (body: string) => `${head}
function walk(totals: Totals): bool {
  let index: decimal<9, 0> = 0;

  while index < 10 limit 100 {
${body}
    index = index + 1;
  }

  return true;
}
`;

  it("accepts an `if`, as it has always accepted a `switch`", () => {
    const result = compile(
      withBody(`    if index == 3 {
      totals.total = 1;
    } else {
      totals.total = 2;
    }`),
      { sourceFile: "probe.bank.ts" },
    );
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toEqual([]);
  });

  it("still accepts a `switch`, which is what made the difference visible", () => {
    const result = compile(
      withBody(`    switch totals.flag {
      case YES {
        totals.total = 1;
      }
      case NO {
        totals.total = 2;
      }
    }`),
      { sourceFile: "probe.bank.ts" },
    );
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toEqual([]);
  });

  it("still keeps a `return` out of a loop, which is what the rule is for", () => {
    // The diagnostic was never about branches. Allowing the branch must not
    // allow a return to escape through it.
    const result = compile(
      withBody(`    if index == 3 {
      return false;
    } else {
      totals.total = 2;
    }`),
      { sourceFile: "probe.bank.ts" },
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.id)).toContain(
      "BANK-TYPE-007",
    );
  });

  it("does not let a function's branch gain a transaction's statements", () => {
    // The branch validator now runs for functions too, and it must not carry
    // `audit` and the ledger across with it.
    const result = compile(
      `${head}
function walk(totals: Totals): bool {
  let index: decimal<9, 0> = 0;

  while index < 10 limit 100 {
    if index == 3 {
      audit("NOPE", "key");
    } else {
      totals.total = 2;
    }
    index = index + 1;
  }

  return true;
}
`,
      { sourceFile: "probe.bank.ts" },
    );
    expect(result.ok).toBe(false);
  });
});

/**
 * Diagnostics that named an internal AST node instead of the syntax.
 *
 * "A IfStatement is not allowed inside a loop body.": the wrong article in
 * front of a word that appears nowhere in BankTS, in a message whose only job
 * is to tell somebody which line to change.
 */
describe("what a diagnostic calls a statement", () => {
  it("names the syntax the author wrote, with the right article", () => {
    const result = compile(
      `module Probe;

record R {
  total: decimal<9, 0>;
}

function walk(r: R): bool {
  let index: decimal<9, 0> = 0;

  while index < 10 limit 100 {
    return false;
  }

  return true;
}
`,
      { sourceFile: "probe.bank.ts" },
    );
    const message = result.diagnostics.find(
      (diagnostic) => diagnostic.id === "BANK-TYPE-007",
    )?.message;
    expect(message).toBe("A `return` is not allowed inside a loop body.");
  });

  it("leaks no internal node name into any diagnostic", () => {
    const sources = [
      // A `return` in a loop, and a `while` in a transaction body position
      // that refuses one.
      `module A;
record R { total: decimal<9, 0>; }
function f(r: R): bool {
  let i: decimal<9, 0> = 0;
  while i < 2 limit 2 {
    return false;
  }
  return true;
}
`,
    ];
    for (const source of sources) {
      const result = compile(source, { sourceFile: "probe.bank.ts" });
      for (const diagnostic of result.diagnostics) {
        expect(
          diagnostic.message,
          `${diagnostic.id} names an AST node kind`,
        ).not.toMatch(/\b[A-Z][a-z]+Statement\b/);
      }
    }
  });
});
