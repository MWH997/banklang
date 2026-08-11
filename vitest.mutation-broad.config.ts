import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";
import {
  MUTATION_BROAD_ONLY_TESTS,
  MUTATION_NATIVE_COBOL_TESTS,
  MUTATION_REPOSITORY_HYGIENE_TESTS,
  MUTATION_SANDBOX_INCOMPATIBLE_TESTS,
} from "./vitest.mutation-excludes";

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
        // Minutes each: these spawn `cobc` and run what it builds.
        ...MUTATION_NATIVE_COBOL_TESTS,
        "tests/cobol-runtime-differential.test.ts",
        ...MUTATION_SANDBOX_INCOMPATIBLE_TESTS,
        // Repository hygiene: these read files, and no mutant changes a file.
        ...MUTATION_REPOSITORY_HYGIENE_TESTS,
        // These also compile the site's examples, so the rules lane keeps
        // them; runtime, backend and tools mutants cannot change their answer.
        ...MUTATION_BROAD_ONLY_TESTS,
      ],
    },
  }),
);
