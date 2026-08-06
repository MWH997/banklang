import { defineConfig } from "vitest/config";

/**
 * The suite Stryker runs when it is mutating the conformance linter.
 *
 * The third mutation lane, and the one that asks the uncomfortable question.
 * `stryker.config.json` mutates the rules that refuse a program;
 * `stryker.emitter.config.json` mutates the code that decides what the emitted
 * text looks like. Both of those are checked, in the end, by the conformance
 * linter — every claim of the form "the emitted COBOL does not do X" is a claim
 * about a rule in `packages/conformance-lint`. Nothing was checking the
 * checker.
 *
 * The 2026-08-06 audit gave the reason to. Five assertions have now been found
 * in this repository that ran, passed, and checked nothing or the wrong thing:
 * F13's delimiter test, the standards meta-test's own loop, the enum corpus
 * regex, a `checked()` floor set from an empty corpus, and a framing test named
 * "counts content length in bytes, not characters" that had never once counted
 * bytes. Reading finds them one at a time and only where someone thinks to
 * look. Mutation testing is the only instrument that finds them by construction:
 * a surviving mutant is precisely an assertion that runs and passes over
 * changed behaviour.
 *
 * Scope is the linter's own suites plus the corpus checks that run it over
 * every example, because a rule is only as good as the text it is pointed at.
 */
export default defineConfig({
  assetsInclude: ["**/*.bank.ts"],
  test: {
    include: [
      // The rules, each with a citation and a fixture that should trip it.
      "tests/conformance-lint.test.ts",
      // The linter run across every example and every checked-in artifact.
      "tests/conformance.test.ts",
      // The vocabulary rule's word list, extracted from Appendix E.
      "tests/reserved-words.test.ts",
      // The standards page, whose "Checked by" column names these rules.
      "tests/feature-coverage.test.ts",
      // House style over the corpus, which several rules exist to hold.
      "tests/generated-style.test.ts",
    ],
  },
});
