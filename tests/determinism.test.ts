import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compareExactBytes } from "../packages/verifier/src/index";
import { compileExample } from "./helpers";

describe("determinism", () => {
  it("produces identical bytes on repeated writes", () => {
    const { emit } = compileExample();
    const dirA = mkdtempSync(join(tmpdir(), "banklang-a-"));
    const dirB = mkdtempSync(join(tmpdir(), "banklang-b-"));

    try {
      const cobolA = join(dirA, "ACCOUNT-TRANSFER.cbl");
      const cobolB = join(dirB, "ACCOUNT-TRANSFER.cbl");
      const mapA = join(dirA, "source-map.json");
      const mapB = join(dirB, "source-map.json");

      writeFileSync(cobolA, emit.cobol, "utf8");
      writeFileSync(cobolB, emit.cobol, "utf8");
      writeFileSync(mapA, JSON.stringify(emit.sourceMap, null, 2), "utf8");
      writeFileSync(mapB, JSON.stringify(emit.sourceMap, null, 2), "utf8");

      expect(
        compareExactBytes(
          Buffer.from(readFileSync(cobolA)),
          Buffer.from(readFileSync(cobolB)),
        ),
      ).toMatchObject({
        identical: true,
      });
      expect(
        compareExactBytes(
          Buffer.from(readFileSync(mapA)),
          Buffer.from(readFileSync(mapB)),
        ),
      ).toMatchObject({
        identical: true,
      });
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});
