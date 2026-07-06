import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";

describe("bankc cli", () => {
  it("prints help with supported commands", () => {
    const result = runBankc(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("emit cobol");
    expect(result.stdout).toContain("copybook diff");
    expect(result.stdout).toContain("build <project>");
    expect(result.stdout).toContain("layout <project>");
    expect(result.stdout).toContain("emit jcl");
    expect(result.stdout).toContain("verify <project>");
    expect(result.stdout).toContain("test <project>");
  });

  it("prints doctor output", () => {
    const result = runBankc(["doctor"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "compiler target: ibm-enterprise-cobol-zos",
    );
  });

  it("builds the account-transfer example", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-build-"));

    try {
      const result = runBankc([
        "build",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(outDir, "cobol", "ACCOUNT-TRANSFER.cbl"))).toBe(
        true,
      );
      expect(
        existsSync(join(outDir, "copybooks", "TRANSFER-REQUEST.cpy")),
      ).toBe(true);
      expect(existsSync(join(outDir, "jcl", "ACCOUNT-TRANSFER.jcl"))).toBe(
        true,
      );
      expect(existsSync(join(outDir, "audit", "validation-matrix.md"))).toBe(
        true,
      );
      expect(existsSync(join(outDir, "audit", "verification-report.md"))).toBe(
        true,
      );
      expect(
        existsSync(join(outDir, "audit", "verification-report.json")),
      ).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("verifies the account-transfer example", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-verify-"));

    try {
      const result = runBankc([
        "verify",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(outDir, "audit", "verification-report.md"))).toBe(
        true,
      );
      expect(
        existsSync(join(outDir, "audit", "verification-report.json")),
      ).toBe(true);
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
      });
      expect(
        readFileSync(join(outDir, "audit", "verification-report.md"), "utf8"),
      ).toContain("Deterministic regeneration");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("emits JCL for the account-transfer example", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-jcl-"));

    try {
      const result = runBankc([
        "emit",
        "jcl",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);

      expect(result.exitCode).toBe(0);
      const jclPath = join(outDir, "jcl", "ACCOUNT-TRANSFER.jcl");
      expect(existsSync(jclPath)).toBe(true);
      expect(readFileSync(jclPath, "utf8")).toContain("ACCOUNTT JOB");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("inspects generated copybooks", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-copybook-"));

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
        join(outDir, "copybooks", "TRANSFER-REQUEST.cpy"),
      ]);

      expect(inspectResult.exitCode).toBe(0);
      expect(inspectResult.stdout).toContain("Copybook inspection");
      expect(inspectResult.stdout).toContain("TRANSFER-REQUEST");
      expect(inspectResult.stdout).toContain("DEBIT-ACCOUNT");
      expect(inspectResult.stdout).toContain("AMOUNT");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("summarizes copybook types", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-copybook-types-"));

    try {
      const buildResult = runBankc([
        "build",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);
      expect(buildResult.exitCode).toBe(0);

      const typesResult = runBankc([
        "copybook",
        "types",
        join(outDir, "copybooks", "TRANSFER-REQUEST.cpy"),
      ]);

      expect(typesResult.exitCode).toBe(0);
      expect(typesResult.stdout).toContain("Copybook types");
      expect(typesResult.stdout).toContain("PIC X(16)");
      expect(typesResult.stdout).toContain("PIC S9(16)V99 COMP-3");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("emits copybook JSON reports", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-copybook-json-"));

    try {
      const buildResult = runBankc([
        "build",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);
      expect(buildResult.exitCode).toBe(0);

      const copybookPath = join(outDir, "copybooks", "TRANSFER-REQUEST.cpy");
      const inspectResult = runBankc([
        "copybook",
        "inspect",
        copybookPath,
        "--json",
      ]);
      const typesResult = runBankc([
        "copybook",
        "types",
        copybookPath,
        "--json",
      ]);
      const diffResult = runBankc([
        "copybook",
        "diff",
        copybookPath,
        copybookPath,
        "--json",
      ]);

      expect(inspectResult.exitCode).toBe(0);
      expect(typesResult.exitCode).toBe(0);
      expect(diffResult.exitCode).toBe(0);
      expect(JSON.parse(inspectResult.stdout)).toMatchObject({
        recordName: "TRANSFER-REQUEST",
        totalLength: 42,
      });
      expect(JSON.parse(typesResult.stdout)).toMatchObject({
        cobolName: "TRANSFER-REQUEST",
        totalLength: 42,
      });
      expect(JSON.parse(diffResult.stdout)).toMatchObject({
        identical: true,
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("diffs identical generated copybooks as clean", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-copybook-diff-"));

    try {
      const buildResult = runBankc([
        "build",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);
      expect(buildResult.exitCode).toBe(0);

      const left = join(outDir, "copybooks", "TRANSFER-REQUEST.cpy");
      const right = join(outDir, "copybooks", "TRANSFER-REQUEST.cpy");
      const diffResult = runBankc(["copybook", "diff", left, right]);

      expect(diffResult.exitCode).toBe(0);
      expect(diffResult.stdout).toContain("Copybook diff");
      expect(diffResult.stdout).toContain("Identical: yes");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("diffs changed generated copybooks as different", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-copybook-diff-"));

    try {
      const buildResult = runBankc([
        "build",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);
      expect(buildResult.exitCode).toBe(0);

      const left = join(outDir, "copybooks", "TRANSFER-REQUEST.cpy");
      const right = join(outDir, "copybooks", "TRANSFER-REQUEST-ALT.cpy");
      const leftText = readFileSync(left, "utf8");
      const rightText = leftText.replace("PIC X(16).", "PIC X(18).");
      writeFileSync(right, rightText, "utf8");

      const diffResult = runBankc(["copybook", "diff", left, right]);

      expect(diffResult.exitCode).toBe(1);
      expect(diffResult.stdout).toContain("Identical: no");
      expect(diffResult.stdout).toContain("Layout differences");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("runs the project-specific test command", () => {
    const outDir = mkdtempSync(join(tmpdir(), "banklang-test-"));

    try {
      const result = runBankc([
        "test",
        "examples/account-transfer",
        "--out",
        outDir,
      ]);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(outDir, "audit", "gnucobol-validation.md"))).toBe(
        true,
      );
      expect(existsSync(join(outDir, "audit", "bankc-test-report.md"))).toBe(
        true,
      );
      expect(
        readFileSync(join(outDir, "audit", "bankc-test-report.md"), "utf8"),
      ).toContain("bankc Test Report");
      expect(
        readFileSync(join(outDir, "audit", "bankc-test-report.md"), "utf8"),
      ).toContain("Check | passed");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
