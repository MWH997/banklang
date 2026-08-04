import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";

describe("audit schema", () => {
  it("includes version and backend profile in audit artifacts", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-audit-schema-"));

    try {
      const result = runBankc([
        "verify",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);

      expect(result.exitCode).toBe(0);

      expect(
        JSON.parse(
          readFileSync(join(outDir, "audit", "diagnostics.json"), "utf8"),
        ),
      ).toMatchObject({
        version: 1,
        backendProfile: "ibm-enterprise-cobol-zos",
        diagnostics: [],
      });

      expect(
        JSON.parse(
          readFileSync(join(outDir, "maps", "source-map.json"), "utf8"),
        ),
      ).toMatchObject({
        version: 1,
        backendProfile: "ibm-enterprise-cobol-zos",
        entries: expect.any(Array),
      });

      expect(
        JSON.parse(
          readFileSync(join(outDir, "audit", "decimal-analysis.json"), "utf8"),
        ),
      ).toMatchObject({
        version: 1,
        backendProfile: "ibm-enterprise-cobol-zos",
        entries: expect.any(Array),
      });

      expect(
        JSON.parse(
          readFileSync(
            join(outDir, "audit", "transaction-analysis.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({
        version: 1,
        backendProfile: "ibm-enterprise-cobol-zos",
        // account-transfer declares no transactions; the account-posting
        // example covers the "analyzed" case in tests/transactions.test.ts.
        status: "no-transactions",
        transactions: [],
      });

      expect(
        JSON.parse(
          readFileSync(join(outDir, "audit", "copybook-layout.json"), "utf8"),
        ),
      ).toMatchObject({
        version: 1,
        backendProfile: "ibm-enterprise-cobol-zos",
        reports: expect.any(Array),
      });

      expect(
        JSON.parse(
          readFileSync(
            join(outDir, "audit", "generated-artifacts.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({
        version: 1,
        backendProfile: "ibm-enterprise-cobol-zos",
        artifacts: expect.arrayContaining([
          join(outDir, "audit", "verification-report.json"),
        ]),
      });

      expect(
        JSON.parse(
          readFileSync(
            join(outDir, "audit", "verification-report.json"),
            "utf8",
          ),
        ),
      ).toMatchObject({
        version: 1,
        backendProfile: "ibm-enterprise-cobol-zos",
        phase: "verify",
        checks: expect.arrayContaining([
          expect.objectContaining({
            name: "Deterministic regeneration",
            status: "passed",
          }),
        ]),
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
