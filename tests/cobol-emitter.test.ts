import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadExampleSource,
  exampleSourceFile,
  compileExample,
} from "./helpers";

describe("cobol emitter", () => {
  it("emits the golden COBOL output", () => {
    const { emit } = compileExample();
    const expected = readFileSync(
      resolve(process.cwd(), "tests/fixtures/account-transfer.cbl"),
      "utf8",
    );

    expect(emit.cobol).toBe(expected);
  });
});
