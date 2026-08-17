import { defineConfig } from "vitest/config";

/**
 * The suite Stryker runs when it is mutating the emitter's formatting.
 *
 * A separate configuration from `vitest.mutation.config.ts`, because the two
 * runs ask different questions of different tests. That one mutates the rules,
 * the typechecker and the semantic analyser, and excludes everything about
 * emitted text. This one mutates the code that decides what the emitted text
 * looks like, so the tests that read emitted text are the only ones that can
 * answer, and the rule suites would cost a full run each and kill nothing.
 *
 * An allowlist rather than a blocklist, because the question "does this test
 * read generated COBOL?" has a short and stable answer, and a blocklist grows a
 * hole every time a suite is added. Written out rather than merged onto
 * `vitest.config.ts`, because `mergeConfig` concatenates `include`, so merging
 * would have added these nine to the whole suite instead of narrowing to them.
 *
 * Why this scope. The 2026-08-05 audit's F13 shipped behind three controls that
 * were named as sufficient reason not to mutate the emitter at all: a golden
 * fixture that *contained* the defect, a conformance linter with no rule for
 * it, and `cobc`, which accepts both delimiters. All three passed. A surviving
 * mutant here means a house-style rule that nothing enforces, which is exactly
 * the class those controls proved blind to.
 */
export default defineConfig({
  // Nothing here is a BankTS module to be transformed; they are input.
  assetsInclude: ["**/*.bank.ts"],
  test: {
    include: [
      // The margin, Area A/B, and continuation.
      "tests/reference-format.test.ts",
      // The house style, now asserted over the whole corpus.
      "tests/generated-style.test.ts",
      // One spelling per picture shape, and the standards page's own checks.
      "tests/feature-coverage.test.ts",
      // Byte-for-byte output, including the fixture nothing else names.
      "tests/golden-fixtures.test.ts",
      // Column alignment of data description entries, and record layout.
      "tests/alignment.test.ts",
      "tests/layout.test.ts",
      // Names: abbreviation to 30, reserved-word collision, qualification.
      "tests/reserved-words.test.ts",
      "tests/ir.test.ts",
      // The same names and pictures asked directly rather than through a
      // compile. Omitting this one cost nothing visible and everything real:
      // the suite was written to kill `cobol-ir` mutants, ran green in CI, and
      // moved the lane's score by -0.10 because Stryker never loaded it.
      "tests/cobol-ir-names.test.ts",
      // The copybook is the record's own declaration through this emitter.
      "tests/copybook-emitter.test.ts",
      "tests/cobol-emitter.test.ts",
    ],
  },
});
