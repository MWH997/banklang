import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
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
      expect(existsSync(join(outDir, "cobol", "ACCOUNTT.cbl"))).toBe(true);
      expect(existsSync(join(outDir, "copybooks", "TRANSFER.cpy"))).toBe(true);
      expect(existsSync(join(outDir, "jcl", "ACCOUNTT.jcl"))).toBe(true);
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
      const jclPath = join(outDir, "jcl", "ACCOUNTT.jcl");
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
        join(outDir, "copybooks", "TRANSFER.cpy"),
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
        join(outDir, "copybooks", "TRANSFER.cpy"),
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

      const copybookPath = join(outDir, "copybooks", "TRANSFER.cpy");
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

      const left = join(outDir, "copybooks", "TRANSFER.cpy");
      const right = join(outDir, "copybooks", "TRANSFER.cpy");
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

      const left = join(outDir, "copybooks", "TRANSFER.cpy");
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

/**
 * What a thrown error looks like from outside the process.
 *
 * Everything the compiler means to report comes back as a result with a
 * message and an exit code, and every test above reads one. The rest are
 * thrown, dozens of them across the packages, and `bin.ts` had no `try`/`catch`
 * at all — so a job whose two steps collapse to one load module, which the
 * backend detects and explains well, reached the user as a source excerpt, a
 * caret, forty frames of `node:internal` and Node's own version banner. The
 * message was the fifth line.
 *
 * F3 then split those throws in two. This collision is the reader's own — two
 * project directories they can rename — so it now carries `BANK-JOB-005` and
 * points at `bankc explain`, which is the path a typechecker diagnostic takes.
 * The `--debug` stack is still there for the failures that have no identifier,
 * and the second block below is one of those.
 *
 * Spawned rather than called, because the boundary being tested is `bin.ts`
 * and calling `runBankc` walks straight past it.
 */
describe("an error that escapes the compiler", () => {
  const BIN = join(process.cwd(), "packages/bankc-cli/src/bin.ts");
  const TSX = join(process.cwd(), "node_modules/.bin/tsx");

  /** A job whose two module names are the same within eight characters. */
  function collidingJob(): string {
    const dir = mkdtempSync(join(tmpdir(), "banklang-throw-"));
    for (const [name, module, txn] of [
      ["a", "SettlementAlpha", "runAlpha"],
      ["b", "SettlementBeta", "runBeta"],
    ]) {
      mkdirSync(join(dir, name as string, "src"), { recursive: true });
      writeFileSync(
        join(dir, name as string, "bankc.json"),
        '{ "source": "src/main.bank.ts" }\n',
        "utf8",
      );
      writeFileSync(
        join(dir, name as string, "src/main.bank.ts"),
        `module ${module};\n\nrecord Row {\n  idempotencyKey: string<36>;\n}\n\nentry transaction ${txn}(row: Row) {\n  audit("RAN", row.idempotencyKey);\n}\n`,
        "utf8",
      );
    }
    writeFileSync(
      join(dir, "job.json"),
      JSON.stringify({
        name: "COLLIDE",
        description: "Two modules, one load module",
        steps: [
          { name: "ALPHA", project: "a" },
          { name: "BETA", project: "b" },
        ],
      }),
      "utf8",
    );
    return dir;
  }

  const dir = collidingJob();
  const ran = spawnSync(TSX, [BIN, "job", dir], {
    encoding: "utf8",
    cwd: process.cwd(),
  });

  it("exits 1", () => {
    expect(ran.status).toBe(1);
  });

  it("prints the message the compiler wrote, under its identifier", () => {
    expect(ran.stderr).toContain("would both load SETTLEME");
    expect(ran.stderr.split("\n")[0]).toMatch(/^bankc: BANK-JOB-005: /);
  });

  /**
   * A stack is the right output for a bug in the compiler and the wrong output
   * for a mistake in a program. This one is the reader's own, so instead of the
   * stack they get the thing that says why the rule exists.
   */
  it("sends the reader to the catalogue rather than to a stack", () => {
    expect(ran.stderr).not.toMatch(/^\s+at /m);
    expect(ran.stderr).not.toContain("node:internal");
    expect(ran.stderr).toContain("bankc explain BANK-JOB-005");
  });

  it("writes nothing to stdout", () => {
    expect(ran.stdout).toBe("");
  });

  /**
   * A failure with no identifier, which is what `--debug` is still for.
   *
   * F3 catalogued what the compiler knows about. What is left is the file
   * system and Node — `ENOENT` on a project directory a `job.json` names and
   * nobody created — and there is nothing to catalogue about those: the message
   * is already the whole of what happened, and the interesting question is
   * which of the compiler's own reads asked for it. So they keep the original
   * behaviour: the message, and the stack one flag away.
   */
  describe("with no identifier", () => {
    const bad = mkdtempSync(join(tmpdir(), "banklang-throw-missing-"));
    writeFileSync(
      join(bad, "job.json"),
      JSON.stringify({
        name: "NIGHT",
        description: "A step whose project is not there",
        steps: [{ name: "POST", project: "missing" }],
      }),
      "utf8",
    );
    const plain = spawnSync(TSX, [BIN, "job", bad], {
      encoding: "utf8",
      cwd: process.cwd(),
    });

    it("prints the message and offers the stack", () => {
      expect(plain.status).toBe(1);
      expect(plain.stderr).not.toMatch(/^\s+at /m);
      expect(plain.stderr).toContain("--debug");
    });

    it("prints the stack when asked", () => {
      const debugged = spawnSync(TSX, [BIN, "job", bad, "--debug"], {
        encoding: "utf8",
        cwd: process.cwd(),
      });
      expect(debugged.status).toBe(1);
      expect(debugged.stderr).toMatch(/^\s+at /m);
    });
  });
});
