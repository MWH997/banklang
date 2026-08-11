/**
 * Tests that inspect the repository rather than the code Stryker mutates.
 *
 * The rules and broad mutation configs both use this list. Keeping it here is
 * important: a repository test added to one blocklist but not the other can
 * make a lane's initial dry run fail before it measures a single mutant.
 */
export const MUTATION_REPOSITORY_HYGIENE_TESTS = [
  "tests/conversions.test.ts",
  "tests/documentation.test.ts",
  "tests/blog.test.ts",
  "tests/prose.test.ts",
  "tests/contrast.test.ts",
  "tests/workflows.test.ts",
  "tests/browser-safety.test.ts",
  "tests/editor-surfaces.test.ts",
  "tests/mutation-scope.test.ts",
  "tests/mutation-floor.test.ts",
  "tests/example-corpus.test.ts",
] as const;

/**
 * Site suites that are irrelevant to runtime/tool mutants but still exercise
 * the compiler rules lane through `siteContent()` and direct `compile()` calls.
 */
export const MUTATION_BROAD_ONLY_TESTS = [
  "tests/docs-site.test.ts",
  "tests/site.test.ts",
  "tests/site-layout.test.ts",
  "tests/accessibility.test.ts",
] as const;

/** Tests whose own execution model is incompatible with a Stryker sandbox. */
export const MUTATION_SANDBOX_INCOMPATIBLE_TESTS = [
  // Scans source for bare `Error` constructors. Stryker's instrumentation
  // injects one into every mutated file before the dry run begins.
  "tests/errors.test.ts",
] as const;

/** Tests whose cost is dominated by spawning and running native COBOL. */
export const MUTATION_NATIVE_COBOL_TESTS = [
  "tests/cobol-compiles.test.ts",
  "tests/conformance.test.ts",
  "tests/gnucobol-validation.test.ts",
  "tests/rounding-oracle.test.ts",
  "tests/generated-programs.test.ts",
  "tests/determinism.test.ts",
] as const;
