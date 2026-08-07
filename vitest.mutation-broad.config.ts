import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";

/**
 * The suite the wider mutation lanes run against: everything except the slow.
 *
 * A blocklist, deliberately, and the opposite choice from
 * `vitest.mutation-emitter.config.ts`. That one lists the ten suites that read
 * generated COBOL, on the reasoning that the question has a short stable answer
 * — which is true, and it has the failure this file exists to avoid. A suite
 * written *for* a lane and not added to its list runs green in CI and
 * contributes nothing: `tests/cobol-ir-names.test.ts` was written to raise
 * `packages/cobol-ir/src/index.ts` off 44%, passed 21 assertions, and moved the
 * score by -0.10 because Stryker never loaded it. Adding one line took the file
 * to 80.38%.
 *
 * **An allowlist is an optimisation here, not a requirement.** Every lane sets
 * `coverageAnalysis: "perTest"`, so Stryker runs only the tests that cover each
 * mutant regardless of how many are in scope. What a list of ten buys is a
 * faster initial dry run; what it costs is that the next suite is invisible
 * until somebody remembers. These lanes take the slower dry run.
 *
 * What is excluded is only what is slow for reasons a mutant cannot change:
 * the suites that spawn `cobc` and execute the binary it produces, and the
 * repository-hygiene suites that read files rather than run code.
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
        // Minutes each: these spawn `cobc` and run what it builds.
        "tests/cobol-compiles.test.ts",
        "tests/conformance.test.ts",
        "tests/gnucobol-validation.test.ts",
        "tests/rounding-oracle.test.ts",
        "tests/generated-programs.test.ts",
        "tests/cobol-runtime-differential.test.ts",
        "tests/determinism.test.ts",
        // Repository hygiene: these read files, and no mutant changes a file.
        "tests/conversions.test.ts",
        "tests/documentation.test.ts",
        "tests/docs-site.test.ts",
        "tests/site.test.ts",
        "tests/site-layout.test.ts",
        "tests/blog.test.ts",
        "tests/prose.test.ts",
        "tests/accessibility.test.ts",
        "tests/contrast.test.ts",
        "tests/workflows.test.ts",
        "tests/browser-safety.test.ts",
        "tests/editor-surfaces.test.ts",
        "tests/mutation-scope.test.ts",
        "tests/mutation-floor.test.ts",
      ],
    },
  }),
);
