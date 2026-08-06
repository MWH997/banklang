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
