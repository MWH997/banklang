import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";

describe("copybook emitter", () => {
  it("emits the golden copybook output", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-copybook-"));
    const expected = readFileSync(
      resolve(process.cwd(), "tests/fixtures/transfer-request.cpy"),
      "utf8",
    );

    try {
      const result = runBankc([
        "emit",
        "copybooks",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);

      expect(result.exitCode).toBe(0);
      const outputPath = join(outDir, "copybooks", "TRANSFER.cpy");
      expect(readFileSync(outputPath, "utf8")).toBe(expected);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
