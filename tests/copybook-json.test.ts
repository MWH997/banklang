import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";

describe("copybook json tools", () => {
  it("renders generated copybook inspection as json", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-copybook-json-"));

    try {
      const buildResult = runBankc([
        "build",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);
      expect(buildResult.exitCode).toBe(0);

      const inspectResult = runBankc([
        "copybook",
        "inspect",
        "--json",
        join(outDir, "copybooks", "TRANSFER.cpy"),
      ]);

      expect(inspectResult.exitCode).toBe(0);
      expect(JSON.parse(inspectResult.stdout)).toMatchObject({
        cobolName: "TRANSFER-REQUEST",
        totalLength: 42,
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("renders copybook diffs as json", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-copybook-json-"));

    try {
      const buildResult = runBankc([
        "build",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);
      expect(buildResult.exitCode).toBe(0);

      const left = join(outDir, "copybooks", "TRANSFER.cpy");
      const diffResult = runBankc(["copybook", "diff", "--json", left, left]);

      expect(diffResult.exitCode).toBe(0);
      expect(JSON.parse(diffResult.stdout)).toMatchObject({
        identical: true,
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
