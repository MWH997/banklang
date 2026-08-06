import { defineConfig } from "vitest/config";

/**
 * The suite's boundaries, stated rather than inferred.
 *
 * BankTS sources are named `*.bank.ts`, which is a TypeScript extension and is
 * not TypeScript. Nothing imports one — every test reads them as text — but a
 * tool that crawls the project for modules to transform finds them and fails,
 * which is what happened the first time Stryker ran the suite in its sandbox.
 *
 * Stating the include and exclude here fixes that for every tool at once, and
 * it stops the runner from walking `evidence/`, `conversions/` and `dist/`,
 * none of which holds a test.
 */
export default defineConfig({
  test: {
    // Builds the reference runtime once, before any worker starts. See
    // `tests/global-setup.ts` for why it is not a `beforeAll`.
    globalSetup: ["tests/global-setup.ts"],

    /*
     * A hang detector, not a performance budget.
     *
     * Around twenty suites here spawn `cobc` and execute the binary it
     * produces, so their wall time is set by an external toolchain competing
     * for the machine with every other worker — not by anything the assertion
     * does. Solo, the slowest is under 600ms; with the whole suite running,
     * ten workers each spawning compilers, the same test has been measured past
     * five seconds. The default 5s therefore failed on a busy machine and
     * passed on an idle one, which makes the suite report a compiler defect
     * when the runner was merely loaded.
     *
     * The work itself was cut first — the reference runtime is now compiled
     * once rather than six times per test — and this covers what is left. It is
     * deliberately far above any measured run: the failure worth catching here
     * is a test that never returns, and CI's job timeout bounds that anyway.
     */
    testTimeout: 30_000,

    include: ["tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "dist/**",
      ".stryker-tmp/**",
      "evidence/**",
      "conversions/**",
      "examples/**",
      "tests/fixtures/**",
      "tests/inputs/**",
    ],
  },
  // Nothing here is a BankTS module to be transformed; they are input.
  assetsInclude: ["**/*.bank.ts"],
});
