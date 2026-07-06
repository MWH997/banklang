import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";

describe("audit report", () => {
  it("writes audit artifacts", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-audit-"));

    try {
      const result = runBankc([
        "audit-report",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(outDir, "audit", "diagnostics.json"))).toBe(true);
      expect(existsSync(join(outDir, "audit", "validation-matrix.md"))).toBe(
        true,
      );
      expect(existsSync(join(outDir, "audit", "copybook-layout.json"))).toBe(
        true,
      );
      expect(existsSync(join(outDir, "jcl", "ACCOUNT-TRANSFER.jcl"))).toBe(
        true,
      );
      expect(existsSync(join(outDir, "audit", "verification-report.md"))).toBe(
        true,
      );
      expect(existsSync(join(outDir, "audit", "copybook-layout.md"))).toBe(
        true,
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
