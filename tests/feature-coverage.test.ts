import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { KEYWORDS } from "../packages/parser/src/index";
import { CONFORMANCE_RULES } from "../packages/conformance-lint/src/index";
import { DIAGNOSTICS } from "../packages/diagnostics/src/index";
import { gradeExamples } from "../tools/evidence-grades";
import { checked, corpus } from "./helpers";

/**
 * No feature may rest on a single example.
 *
 * The 2026-08-05 audit's §5.5: "no feature may be represented by exactly one
 * fixture. Each needs at minimum a benign case, a boundary case, and a failure
 * case." A construct with one test has one shape proved, and the shape that was
 * chosen is the one the author already had in mind — which is exactly how
 * `ROUNDED MODE IS NEAREST-EVEN` survived two years of a green suite.
 *
 * These are meta-tests: they read the suite rather than the compiler, and they
 * fail when the suite stops covering something rather than when the compiler
 * breaks. That makes them annoying in the right way — a new statement kind
 * cannot be merged with one happy-path test.
 */

const SUITE = readdirSync("tests")
  .filter((entry) => entry.endsWith(".test.ts"))
  .map((entry) => readFileSync(join("tests", entry), "utf8"))
  .join("\n");

/**
 * Keywords that are not features of the language a program can use: type
 * names, literals, and the words that only appear inside another construct.
 */
const NOT_A_STATEMENT = new Set([
  "module",
  "type",
  "record",
  "function",
  "return",
  "true",
  "false",
  "decimal",
  "string",
  "national",
  "bool",
  "date",
  "time",
  "timestamp",
  "let",
  "else",
  "case",
  "in",
  "each",
  "by",
  "on",
  "through",
  "extends",
  "entry",
  "failure",
  "error",
  "every",
  "descending",
  "depending",
  "sync",
  "justified",
  "blankWhenZero",
  "redefines",
  "renames",
  "sensitive",
  "reserved",
  "cics",
  "sql",
  "cursor",
  "enum",
  "database",
  "queue",
  "report",
  "file",
  "transaction",
]);

describe("every statement kind", () => {
  const statements = [...KEYWORDS].filter(
    (keyword) => !NOT_A_STATEMENT.has(keyword),
  );

  it("has some to check", () => {
    expect(statements.length).toBeGreaterThan(20);
  });

  for (const statement of statements) {
    /**
     * Two occurrences, because one is a single example. The check is textual
     * and therefore loose — it counts how often the suite writes the keyword —
     * which is the right level for a meta-test: it cannot tell a good second
     * test from a bad one, and it can tell one from none.
     */
    it(`is written more than once in the suite: ${statement}`, () => {
      const occurrences =
        SUITE.split(new RegExp(`(?<![A-Za-z])${statement}(?![A-Za-z])`))
          .length - 1;

      expect(
        occurrences,
        `\`${statement}\` appears ${occurrences} time(s). A feature with one test has one shape proved.`,
      ).toBeGreaterThan(1);
    });
  }
});

/**
 * Every diagnostic the catalogue documents must have a test that provokes it.
 *
 * A rule nothing tests is a comment. The catalogue is the product's promise, so
 * this is the coverage that matters most — more than line coverage of the
 * emitter, which can be high while every safety rule is unproved.
 */
describe("every implemented diagnostic", () => {
  const implemented = DIAGNOSTICS.filter((entry) => entry.implemented);

  it("has some to check", () => {
    expect(implemented.length).toBeGreaterThan(50);
  });

  for (const entry of implemented) {
    it(`is provoked by a test: ${entry.id}`, () => {
      expect(
        SUITE.includes(entry.id),
        `${entry.id} is catalogued as implemented and no test names it.`,
      ).toBe(true);
    });
  }
});

/**
 * The evidence grades, held to their counts.
 *
 * §5.9 asks for the counts in CI so a feature sliding from "executed" to
 * "compiles only" shows up as a diff. The diff is `evidence/GRADES.md`; this is
 * what makes it a failure rather than an untracked change.
 *
 * The numbers are a floor, not an equality: adding an example that is only
 * compiled should not fail the suite, and dropping one that was executed
 * should.
 */
describe("evidence grades", () => {
  const grades = gradeExamples();

  it("still executes three examples against the reference runtime", () => {
    const executed = grades.filter((entry) => entry.grade === "executed");
    expect(executed.map((entry) => entry.example).sort()).toEqual([
      "examples/branch-accrual-cursor",
      "examples/online-enquiry",
      "examples/withdrawal-with-recovery",
    ]);
  });

  it("has a checked-in table matching what the suite does", () => {
    const page = readFileSync("evidence/GRADES.md", "utf8");
    for (const entry of grades) {
      const name = entry.example.replace("examples/", "");
      expect(
        page.replace(/[ \t]+/g, " "),
        `${name} is graded ${entry.grade}; run pnpm evidence:grades`,
      ).toContain(`| \`${name}\` | ${entry.grade} |`);
    }
  });
});

/**
 * The generated-code standards, held to having a check each.
 *
 * `docs/generated-code-standards.md` closes by saying "a rule that is not on
 * this page and not checked anywhere is not a rule". This is the other half of
 * that: a rule that is on the page and names a check that does not exist reads
 * as checked and is not.
 *
 * It also encodes what the 2026-08-05 audit's F13 taught, which no meta-test
 * caught the first time. A conformance-linter rule runs over every emitted
 * artifact, the checked-in fixtures and the evidence bundles, so it is
 * corpus-wide by construction. A rule checked by a hand-fixtured test is only
 * as good as the one program that test compiles — and F13's delimiter test
 * compiled a program that reached one of the two branches emitting a boolean,
 * passed, and left `MOVE 'Y'` in a shipped example for as long as it was there.
 * So a test named here has to assert over the corpus rather than over one
 * program it wrote itself.
 */
describe("the generated-code standards", () => {
  const page = readFileSync("docs/generated-code-standards.md", "utf8");
  /** The `Checked by` cell of every table row, split on its commas. */
  const checks = [...page.matchAll(/^\|(?!\s*-)[^|]+\|([^|]+)\|\s*$/gm)]
    .map((row) => row[1].trim())
    .filter((cell) => cell !== "" && cell !== "Checked by")
    .flatMap((cell) => cell.split(/,\s*/).map((part) => part.trim()))
    // Unbackticked here rather than at each use. Leaving the backticks on made
    // the corpus loop below select nothing, so it asserted over an empty list
    // and passed — the same shape of defect this whole file exists to catch.
    .map((check) => check.replace(/`/g, "").replace(/ skips them$/, ""));

  const named = [...new Set(checks)];
  const namedTests = named.filter((check) => check.startsWith("tests/"));

  it("has rows to check", () => {
    expect(checks.length).toBeGreaterThan(20);
  });

  it("names test files among them", () => {
    expect(namedTests.length).toBeGreaterThan(5);
  });

  /**
   * Every check is either a rule the linter can report or a test file that
   * exists. "review" is neither, and neither is "and others" — both name a
   * hope rather than something that fails.
   */
  for (const check of named) {
    it(`names something that exists: ${check}`, () => {
      if (check.startsWith("tests/")) {
        expect(existsSync(check), `${check} does not exist.`).toBe(true);
        return;
      }
      expect(
        (CONFORMANCE_RULES as readonly string[]).includes(check),
        `"${check}" is neither a conformance rule nor a test file. A standard whose check is prose is not checked.`,
      ).toBe(true);
    });
  }

  /**
   * A test may only be named as the check for a standard if it asserts over
   * every example rather than over one program written inside it. `corpus()`
   * in `tests/helpers.ts` is what that means here; a test that does not reach
   * for it is proving one shape.
   */
  for (const file of namedTests) {
    it(`asserts over the corpus rather than one program: ${file}`, () => {
      const source = readFileSync(file, "utf8");
      expect(
        source.includes("corpus("),
        `${file} is named as the check for a generated-code standard but never reads the corpus. One hand-written program proves one shape — which is how F13 survived.`,
      ).toBe(true);
    });
  }
});

/**
 * Every test that reads the corpus says how much of it it looked at.
 *
 * The recurring defect in this repository is an assertion that runs, passes,
 * and checks nothing. Six have been found: F13's delimiter test, the
 * `Checked by` loop directly above this one, an enum regex that missed the
 * qualified `SET x OF y TO TRUE` and so matched zero of twenty-three examples,
 * a floor set from a corpus that did not meet it, a framing test named "counts
 * content length in bytes, not characters" that never counted bytes, and a
 * conformance rule with no test at all. Every one of them was green.
 *
 * A corpus loop is where this is easiest to write by accident, because the loop
 * still executes — over nothing. `checked(count, atLeast, what)` in
 * `tests/helpers.ts` is the countermeasure, and this is what makes using it not
 * optional: a test that reaches for `corpus()` and never states a floor is
 * asserting over however much it happened to find, which may be none of it.
 */
describe("every corpus assertion", () => {
  /**
   * The file with its comments removed.
   *
   * Needed because the first version of this check searched the raw text and
   * passed over this very file, which reads the corpus and at the time stated
   * no floor: the prose above happens to name `checked(`, and that was enough.
   * A rule about what code does has to be asked of the code.
   */
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

  /**
   * A call with an argument, rather than the two characters `checked(`.
   *
   * The second version of this check stripped string literals as well, so that
   * the assertion message below — which also names `checked()` — could not
   * satisfy the rule out of its own failure text. Lexing TypeScript with a
   * regular expression went wrong immediately, swallowing whole statements
   * between adjacent string arguments. Requiring an argument is the cheap way
   * to tell the call from the mention: every real call passes a count, and
   * every mention in prose writes the empty parentheses.
   */
  const CALL = /\bchecked\([^)]/;

  const readers = readdirSync("tests")
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => `tests/${name}`)
    .filter((file) => /\bcorpus\(/.test(code(file)));

  it("has files to check", () => {
    expect(readers.length).toBeGreaterThan(5);
  });

  /**
   * One floor per file, which is coarser than the property deserves: a file
   * with two corpus loops satisfies this with a floor on one of them. It is
   * still worth having as it stands, because the failure it prevents is a file
   * with no floor at all, and the finer version would need to know which loop
   * a `checked()` belongs to.
   */
  for (const file of readers) {
    it(`states how much it looked at: ${file}`, () => {
      expect(
        CALL.test(code(file)),
        `${file} reads the corpus but never calls checked(). An assertion that finds nothing passes without asserting anything, so a loop over the corpus has to say how much it expected to find.`,
      ).toBe(true);
    });
  }
});

/**
 * One picture shape, one spelling, across everything the compiler emits.
 *
 * `PIC S9(16)V99` and `PIC S9(16)V9(2)` are the same picture; so are `PIC X`
 * and `PIC X(1)`. Enterprise COBOL takes either, and a program carrying both
 * reads as two people's work — the audit's F14, which was reported fixed
 * because the one spelling it named had gone.
 *
 * Both were still being emitted: the PARM field builder wrote the fractional
 * run as a repeat count where `decimalPicture` writes it out, the rounding work
 * field wrote its own, and a boolean result cell was `PIC X` where every other
 * alphanumeric picture carries a count. Nothing caught it because no test
 * compared two examples against each other — every one of them read a single
 * artifact and found it self-consistent.
 *
 * Normalising to (symbol, count) pairs is what makes the comparison possible:
 * two spellings that normalise the same are the same picture written twice.
 */
describe("every PICTURE in the corpus", () => {
  /**
   * `S9(16)V99` becomes `Sx1 9x16 Vx1 9x2`, which `S9(16)V9(2)` also becomes.
   *
   * The character class is the PICTURE symbols the Language Reference lists —
   * digits among them, `9` and `0` being symbols rather than counts.
   */
  const normalise = (picture: string): string =>
    [...picture.matchAll(/([A-Z90$*+\-.,/])(?:\((\d+)\))?/g)]
      .reduce<{ symbol: string; count: number }[]>(
        (runs, [, symbol, count]) => {
          const last = runs.at(-1);
          const size = count === undefined ? 1 : Number(count);
          if (last?.symbol === symbol) {
            last.count += size;
            return runs;
          }
          return [...runs, { symbol, count: size }];
        },
        [],
      )
      .map((run) => `${run.symbol}x${run.count}`)
      .join(" ");

  const spellings = new Map<string, Map<string, string>>();
  let pictures = 0;
  for (const { example, cobol } of corpus()) {
    for (const [, picture] of cobol.matchAll(/\bPIC\s+([^\s.]+)/g)) {
      pictures += 1;
      const shape = normalise(picture);
      const seen = spellings.get(shape) ?? new Map<string, string>();
      if (!seen.has(picture)) {
        seen.set(picture, example);
      }
      spellings.set(shape, seen);
    }
  }

  it("has pictures to compare", () => {
    checked(pictures, 500, "PICTURE clauses");
    expect(spellings.size).toBeGreaterThan(10);
  });

  it("is spelled one way", () => {
    const divergent = [...spellings.entries()]
      .filter(([, seen]) => seen.size > 1)
      .map(
        ([shape, seen]) =>
          `${shape}: ${[...seen]
            .map(([picture, example]) => `${picture} (${example})`)
            .join(" and ")}`,
      );

    expect(divergent).toEqual([]);
  });
});
