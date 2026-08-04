import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";
import { loadConfig } from "../packages/config/src/index";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "bankc-toolchain-"));
}

function project(source: string): { dir: string; file: string } {
  const dir = scratch();
  const file = join(dir, "src", "main.bank.ts");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(file, source, "utf8");
  return { dir, file };
}

const UNSAFE = `module Unsafe;

type MoneyBDT = decimal<18, 2>;

record Posting {
  debitAccount: string<16>;
  amount: MoneyBDT;
}

transaction post(request: Posting) {
  debit(request.debitAccount, request.amount);
}
`;

describe("bankc init", () => {
  it("scaffolds a project that compiles cleanly", () => {
    const dir = join(scratch(), "my-bank");
    const created = runBankc(["init", dir]);

    expect(created.exitCode).toBe(0);
    expect(created.stdout).toContain("banklang.json");
    expect(runBankc(["check", dir]).exitCode).toBe(0);
  });

  it("derives a valid module name from the directory", () => {
    const dir = join(scratch(), "my-payments-service");
    runBankc(["init", dir]);

    const source = readFileSync(join(dir, "src", "main.bank.ts"), "utf8");
    expect(source).toContain("module MyPaymentsService;");
  });

  it("refuses to overwrite an existing project", () => {
    const dir = join(scratch(), "twice");
    runBankc(["init", dir]);
    const second = runBankc(["init", dir]);

    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("Refusing to overwrite");
  });

  it("requires a target directory", () => {
    expect(runBankc(["init"]).exitCode).toBe(1);
  });
});

describe("bankc fmt", () => {
  it("rewrites an unformatted file in place", () => {
    const { dir, file } = project("module A;\ntype M=decimal<18,2>;\n");

    const result = runBankc(["fmt", dir]);

    expect(result.exitCode).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(
      "module A;\n\ntype M = decimal<18, 2>;\n",
    );
  });

  it("reports an already-formatted file without rewriting", () => {
    const { dir } = project("module A;\n\ntype M = decimal<18, 2>;\n");

    const result = runBankc(["fmt", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Already formatted");
  });

  it("--check fails without modifying the file", () => {
    const original = "module A;\ntype M=decimal<18,2>;\n";
    const { dir, file } = project(original);

    const result = runBankc(["fmt", dir, "--check"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Would reformat");
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("refuses to format a file with syntax errors", () => {
    const broken = "module A;\n\nrecord {";
    const { dir, file } = project(broken);

    const result = runBankc(["fmt", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("syntax errors");
    expect(readFileSync(file, "utf8")).toBe(broken);
  });

  it("leaves every checked-in example unchanged", () => {
    for (const example of [
      "examples/account-transfer",
      "examples/batch-interest-accrual",
      "examples/account-posting",
      "examples/account-file-batch",
    ]) {
      const result = runBankc(["fmt", example, "--check"], process.cwd());
      expect(result.exitCode, `${example} is not formatted`).toBe(0);
    }
  });
});

describe("bankc check --format", () => {
  it("emits SARIF that names the rules it reports", () => {
    const { dir } = project(UNSAFE);
    const result = runBankc(["check", dir, "--format", "sarif"]);

    expect(result.exitCode).toBe(1);
    const sarif = JSON.parse(result.stdout);
    expect(sarif.version).toBe("2.1.0");

    const driver = sarif.runs[0].tool.driver;
    expect(driver.name).toBe("bankc");
    expect(driver.rules.map((rule: { id: string }) => rule.id)).toEqual([
      "BANK-TXN-001",
      "BANK-AUD-001",
      "BANK-LED-001",
    ]);
    expect(driver.rules[0].help.markdown).toContain("Remediation");

    const first = sarif.runs[0].results[0];
    expect(first.level).toBe("error");
    expect(first.locations[0].physicalLocation.region.startLine).toBe(10);
  });

  it("emits valid SARIF with no results for a clean project", () => {
    const result = runBankc(
      ["check", "examples/account-posting", "--format", "sarif"],
      process.cwd(),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).runs[0].results).toEqual([]);
  });

  it("emits JSON enriched with catalogue titles", () => {
    const { dir } = project(UNSAFE);
    const result = runBankc(["check", dir, "--format", "json"]);

    const report = JSON.parse(result.stdout);
    expect(report.diagnostics[0]).toMatchObject({
      id: "BANK-TXN-001",
      severity: "error",
      title: "Missing idempotency key",
      line: 10,
    });
  });

  it("writes to a file with --output", () => {
    const { dir } = project(UNSAFE);
    const target = join(scratch(), "reports", "bankc.sarif");

    const result = runBankc([
      "check",
      dir,
      "--format",
      "sarif",
      "--output",
      target,
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(readFileSync(target, "utf8")).version).toBe("2.1.0");
  });

  it("accepts the project path before or after the flags", () => {
    const before = runBankc(
      ["check", "examples/account-posting", "--format", "json"],
      process.cwd(),
    );
    const after = runBankc(
      ["check", "--format", "json", "examples/account-posting"],
      process.cwd(),
    );

    expect(before.exitCode).toBe(0);
    expect(after.exitCode).toBe(0);
    expect(after.stdout).toBe(before.stdout);
  });

  it("rejects an unknown format", () => {
    const result = runBankc(
      ["check", "examples/account-posting", "--format", "xml"],
      process.cwd(),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown --format");
  });
});

describe("banklang.json", () => {
  it("falls back to defaults when absent", () => {
    const { dir } = project("module A;\n");
    const loaded = loadConfig(dir, process.cwd());

    expect(loaded.path).toBeNull();
    expect(loaded.problems).toEqual([]);
    expect(loaded.config.outDir).toBe("dist");
  });

  it("reads a valid config", () => {
    const { dir } = project("module A;\n");
    writeFileSync(
      join(dir, "banklang.json"),
      JSON.stringify({ outDir: "build", backendProfile: "gnucobol-local" }),
      "utf8",
    );

    const loaded = loadConfig(dir, process.cwd());
    expect(loaded.problems).toEqual([]);
    expect(loaded.config.outDir).toBe("build");
    expect(loaded.config.backendProfile).toBe("gnucobol-local");
  });

  it("reports unknown and malformed options instead of throwing", () => {
    const { dir } = project("module A;\n");
    writeFileSync(
      join(dir, "banklang.json"),
      JSON.stringify({ outDir: 5, typo: true, backendProfile: "nope" }),
      "utf8",
    );

    const loaded = loadConfig(dir, process.cwd());
    expect(loaded.problems).toHaveLength(3);
    expect(loaded.problems.join(" ")).toContain('Unknown option "typo"');
    // Invalid values fall back to defaults rather than corrupting the build.
    expect(loaded.config.outDir).toBe("dist");
  });

  it("reports invalid JSON with the parser message", () => {
    const { dir } = project("module A;\n");
    writeFileSync(join(dir, "banklang.json"), "{ not json", "utf8");

    const loaded = loadConfig(dir, process.cwd());
    expect(loaded.problems[0]).toContain("not valid JSON");
  });

  it("is surfaced by bankc config", () => {
    const dir = join(scratch(), "configured");
    runBankc(["init", dir]);

    const result = runBankc(["config", dir]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("backendProfile: ibm-enterprise-cobol-zos");
  });

  it("makes bankc config fail when the file is broken", () => {
    const { dir } = project("module A;\n");
    writeFileSync(join(dir, "banklang.json"), "{ nope", "utf8");

    const result = runBankc(["config", dir]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("warning:");
  });
});

describe("help", () => {
  it("lists the toolchain commands", () => {
    const help = runBankc(["--help"]).stdout;

    for (const command of ["fmt", "init", "config", "explain"]) {
      expect(help).toContain(command);
    }
    expect(help).toContain("--format text|json|sarif");
  });
});
