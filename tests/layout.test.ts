import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";

describe("layout report", () => {
  it("writes a copybook layout report", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-layout-"));

    try {
      const result = runBankc([
        "layout",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(outDir, "layout", "copybook-layout.md"))).toBe(
        true,
      );
      expect(existsSync(join(outDir, "layout", "copybook-layout.json"))).toBe(
        true,
      );
      expect(
        readFileSync(join(outDir, "layout", "copybook-layout.md"), "utf8"),
      ).toContain("Copybook Layout Report");
      expect(
        readFileSync(join(outDir, "layout", "copybook-layout.md"), "utf8"),
      ).toContain("TRANSFER-REQUEST.DEBIT-ACCOUNT");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
