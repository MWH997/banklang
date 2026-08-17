import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FIXTURES, exampleProgram } from "../tools/refresh-fixtures";

/**
 * Every golden fixture, compared against what the compiler emits today.
 *
 * One test over the whole set rather than one written by hand per file. A
 * fixture nothing compares is a file that goes stale silently, which is how
 * `tests/fixtures/interest-posting-batch.cbl` came to hold
 * `ROUNDED MODE IS NEAREST-EVEN`, a phrase Enterprise COBOL does not have,
 * for as long as it did: no test named it, so nothing ever read it.
 *
 * `pnpm fixtures:refresh` rewrites them all when a change to the emitter is
 * intended, and the diff is the review.
 */
describe("golden fixtures", () => {
  for (const fixture of FIXTURES) {
    it(`emits ${fixture.file}`, () => {
      const expected = readFileSync(
        resolve(process.cwd(), fixture.file),
        "utf8",
      );

      expect(fixture.render(exampleProgram(fixture.example))).toBe(expected);
    });
  }
});
