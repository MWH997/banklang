import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { KEYWORDS } from "../packages/parser/src/index";
import { DIAGNOSTICS } from "../packages/diagnostics/src/index";
import { gradeExamples } from "../tools/evidence-grades";

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
