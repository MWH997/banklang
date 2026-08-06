import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";

/**
 * The suite Stryker runs against, which is not the whole suite.
 *
 * Mutation testing asks one question: if this line were wrong, would anything
 * fail? A test that cannot answer it for the mutated code costs a full run of
 * itself per mutant and contributes nothing — so what is left out is everything
 * that does not exercise the typechecker or the semantic analyser:
 *
 * - the repository-hygiene tests (`conversions`, `documentation`,
 *   `feature-coverage`, `browser-safety`, `editor-surfaces`), which read files
 *   rather than compile programs, and whose answers a mutant cannot change;
 * - the ones that spawn `cobc` (`cobol-compiles`, `conformance`,
 *   `gnucobol-validation`, `rounding-oracle`, `generated-programs`), which are
 *   minutes each and prove things about the emitter rather than the rules.
 *
 * What is kept is every suite that compiles a program and asserts on what the
 * compiler said about it, which is what the diagnostics are.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: [
        "**/node_modules/**",
        "dist/**",
        ".stryker-tmp/**",
        "evidence/**",
        "conversions/**",
        "examples/**",
        "tests/fixtures/**",
        "tests/inputs/**",
        "tests/conversions.test.ts",
        "tests/documentation.test.ts",
        "tests/feature-coverage.test.ts",
        "tests/browser-safety.test.ts",
        "tests/editor-surfaces.test.ts",
        "tests/cobol-compiles.test.ts",
        "tests/conformance.test.ts",
        "tests/gnucobol-validation.test.ts",
        "tests/rounding-oracle.test.ts",
        "tests/generated-programs.test.ts",
        "tests/determinism.test.ts",
      ],
    },
  }),
);
