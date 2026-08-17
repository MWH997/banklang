import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc, watchProject } from "../packages/bankc-cli/src/index";
import { parseJobDescriptor } from "../packages/bankc-cli/src/index";
import { importCopybook } from "../packages/copybook/src/import";
import { importDclgen } from "../packages/copybook/src/dclgen";
import { inspectGeneratedCopybook } from "../packages/copybook/src/index";
import {
  BankcError,
  CompilerInvariant,
} from "../packages/diagnostics/src/errors";
import { explainDiagnostic } from "../packages/diagnostics/src/index";

/**
 * The failures that are not diagnostics, and which of them is whose fault.
 *
 * There were 38 `throw new Error` sites across the compiler. A boundary in
 * `bin.ts` stops any of them reaching a user as a Node stack trace, and this is
 * the triage behind it. A throw is either the reader's file (a copybook that is
 * not a copybook, a `job.json` with no steps) or bankc's own, and the two want
 * completely different output.
 *
 * The rule below is the one that makes the triage stick: no compiler package
 * throws a bare `Error`. An unclassified failure is exactly the shape those
 * defects arrived in.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

describe("every failure is classified", () => {
  /**
   * `packages/diagnostics/src/errors.ts` names the thing it forbids in its own
   * prose, so it is read as code rather than as text, the same trick
   * `tests/feature-coverage.test.ts` needed when its check passed over itself.
   */
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

  const files = readdirSync("packages")
    .filter((pkg) => pkg !== "vscode-extension")
    .flatMap((pkg) => {
      try {
        return sourceFiles(join("packages", pkg, "src"));
      } catch {
        return [];
      }
    });

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("throws no bare Error anywhere in the compiler", () => {
    const bare = files.filter((file) => /throw new Error\(/.test(code(file)));

    expect(
      bare,
      `These throw an unclassified Error. Use BankcError with a catalogue id where the reader can fix it, and CompilerInvariant where they cannot:\n${bare.join("\n")}`,
    ).toEqual([]);
  });

  it("gives every BankcError a catalogue entry", () => {
    const ids = new Set<string>();
    for (const file of files) {
      for (const match of code(file).matchAll(
        /new BankcError\(\s*"(BANK-[A-Z]+-\d+)"/g,
      )) {
        ids.add(match[1]!);
      }
    }

    expect(ids.size).toBeGreaterThan(5);
    for (const id of ids) {
      expect(
        explainDiagnostic(id),
        `${id} has no catalogue entry`,
      ).toBeDefined();
    }
  });
});

/**
 * What a reader gets, at the boundary.
 *
 * Spawned rather than called: `runBankc` returns before `bin.ts` decides how to
 * print a throw, and how it prints is the whole point here.
 */
describe("the CLI boundary", () => {
  function bankc(args: string[], cwd: string) {
    return spawnSync(
      "npx",
      ["tsx", join(process.cwd(), "packages/bankc-cli/src/bin.ts"), ...args],
      { cwd, encoding: "utf8" },
    );
  }

  it("prints a catalogued failure with its id, where it is, and how to read it", () => {
    const dir = mkdtempSync(join(tmpdir(), "banklang-errors-"));
    writeFileSync(
      join(dir, "broken.cpy"),
      ["       01  ACCOUNT-REC.", "           MOVE 1 TO X.", ""].join("\n"),
    );

    const result = bankc(["copybook", "import", join(dir, "broken.cpy")], dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("BANK-COPY-008");
    // The line, because a copybook of six hundred entries is where "somewhere
    // in this file" is no help at all.
    expect(result.stderr).toContain("line 2");
    expect(result.stderr).toContain("bankc explain BANK-COPY-008");
    // No stack: the reader has a file to look at, not a control flow.
    expect(result.stderr).not.toContain("    at ");
  });

  it("explains the identifier it just printed", () => {
    const result = runBankc(["explain", "BANK-COPY-008"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("BANK-COPY-008");
    expect(result.stdout).toContain("Not a data description entry");
  });
});

/**
 * One provoking case per new catalogue entry.
 *
 * `tests/feature-coverage.test.ts` requires this: a catalogue entry with no
 * test is a promise nobody checked, printed by `bankc explain` as though it
 * were a guarantee.
 */
function thrown(work: () => unknown): BankcError {
  try {
    work();
  } catch (error) {
    if (error instanceof BankcError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected a BankcError and nothing was thrown.");
}

describe("BANK-COPY-008", () => {
  it("is a copybook line that is not a level number and a name", () => {
    const error = thrown(() =>
      importCopybook("       01  ACCOUNT-REC.\n       GO TO SOMEWHERE.\n"),
    );

    expect(error.id).toBe("BANK-COPY-008");
    expect(error.location).toBe("line 2");
  });

  it("is also what the layout reader says", () => {
    const error = thrown(() =>
      inspectGeneratedCopybook(
        "       01  ACCOUNT-REC.\n       NOT AN ENTRY.\n",
      ),
    );

    expect(error.id).toBe("BANK-COPY-008");
  });
});

describe("BANK-COPY-009", () => {
  it("is a copybook with entries and no 01", () => {
    const error = thrown(() =>
      importCopybook("           05  ACCOUNT-ID  PIC X(16).\n"),
    );

    expect(error.id).toBe("BANK-COPY-009");
    expect(error.message).toContain("01-level record");
  });

  it("is also what the layout reader says", () => {
    const error = thrown(() =>
      inspectGeneratedCopybook("           05  ACCOUNT-ID  PIC X(16).\n"),
    );

    expect(error.id).toBe("BANK-COPY-009");
  });
});

describe("BANK-COPY-010", () => {
  /**
   * A picture with no digits, no `X`, no `N` and no editing symbol. The reader
   * refuses rather than guessing, because the byte count it would be guessing
   * decides the offset of every field after it.
   */
  it("is a picture the layout reader cannot size", () => {
    const error = thrown(() =>
      inspectGeneratedCopybook(
        "       01  ACCOUNT-REC.\n           05  ODD  PIC GGG.\n",
      ),
    );

    expect(error.id).toBe("BANK-COPY-010");
    expect(error.message).toContain("GGG");
  });
});

describe("BANK-COPY-011", () => {
  it("is a file with no DECLARE TABLE block", () => {
    const error = thrown(() =>
      importDclgen("       01  ACCOUNT-REC.\n           05  X  PIC X(4).\n"),
    );

    expect(error.id).toBe("BANK-COPY-011");
  });
});

describe("BANK-COPY-012", () => {
  it("is a column in the block that is not a name and a type", () => {
    const error = thrown(() =>
      importDclgen(
        [
          "           EXEC SQL DECLARE ACCOUNT TABLE",
          "           ( ACCOUNT_ID CHAR(16) NOT NULL,",
          "             BALANCE",
          "           ) END-EXEC.",
          "",
        ].join("\n"),
      ),
    );

    expect(error.id).toBe("BANK-COPY-012");
    expect(error.message).toContain("BALANCE");
  });
});

describe("BANK-JOB-001", () => {
  it.each([
    ["no name", '{"description":"Nightly","steps":[{"name":"S1"}]}'],
    ["no description", '{"name":"NIGHT","steps":[{"name":"S1"}]}'],
    ["no steps", '{"name":"NIGHT","description":"Nightly","steps":[]}'],
  ])("is a job descriptor with %s", (_case, text) => {
    expect(thrown(() => parseJobDescriptor(text)).id).toBe("BANK-JOB-001");
  });
});

describe("BANK-JOB-002", () => {
  it("is a step name JCL will not take", () => {
    const error = thrown(() =>
      parseJobDescriptor(
        '{"name":"NIGHT","description":"Nightly","steps":[{"name":"extract-step","project":"a"}]}',
      ),
    );

    expect(error.id).toBe("BANK-JOB-002");
    expect(error.message).toContain("one to eight characters");
  });
});

describe("BANK-JOB-003", () => {
  it("is two steps under one name", () => {
    const error = thrown(() =>
      parseJobDescriptor(
        '{"name":"NIGHT","description":"Nightly","steps":[{"name":"POST","project":"a"},{"name":"POST","project":"b"}]}',
      ),
    );

    expect(error.id).toBe("BANK-JOB-003");
  });
});

describe("BANK-JOB-004", () => {
  it("is a step that runs neither a program nor a sort", () => {
    const error = thrown(() =>
      parseJobDescriptor(
        '{"name":"NIGHT","description":"Nightly","steps":[{"name":"POST"}]}',
      ),
    );

    expect(error.id).toBe("BANK-JOB-004");
  });
});

/**
 * The two that live in the backend rather than in the descriptor reader.
 *
 * Both are decided while the job stream is being written, because both are
 * about how the steps sit together: a program built on its own has nothing to
 * collide with, and a sort has no files to check until the programs around it
 * have declared theirs. They are the reader's own all the same: one renames a
 * project, the other fixes a name in `job.json`, so they carry identifiers
 * rather than reading as compiler defects, which is what they did for a day
 * when this triage was first applied by pattern rather than by reading.
 */
describe("BANK-JOB-005", () => {
  it("is two steps whose modules collapse to one member name", () => {
    const dir = mkdtempSync(join(tmpdir(), "banklang-collide-"));
    // Provoked through the CLI, because the collision is only visible once two
    // programs are in one job.
    const project = (name: string, module: string, txn: string) => {
      const root = join(dir, name);
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "bankc.json"),
        '{ "source": "src/main.bank.ts" }\n',
      );
      writeFileSync(
        join(root, "src/main.bank.ts"),
        `module ${module};\n\nrecord Row {\n  idempotencyKey: string<36>;\n}\n\nentry transaction ${txn}(row: Row) {\n  audit("RAN", row.idempotencyKey);\n}\n`,
      );
    };
    project("a", "SettlementAlpha", "runAlpha");
    project("b", "SettlementBeta", "runBeta");
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
    );

    const error = thrown(() => runBankc(["job", dir]));

    expect(error.id).toBe("BANK-JOB-005");
    expect(error.message).toContain("SETTLEME");
  });
});

describe("BANK-JOB-006", () => {
  it("is a sort step reading a file no program in the job writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "banklang-sort-"));
    mkdirSync(join(dir, "a/src"), { recursive: true });
    writeFileSync(
      join(dir, "a/bankc.json"),
      '{ "source": "src/main.bank.ts" }\n',
    );
    writeFileSync(
      join(dir, "a/src/main.bank.ts"),
      'module Extract;\n\nrecord Row {\n  idempotencyKey: string<36>;\n}\n\nentry transaction go(row: Row) {\n  audit("RAN", row.idempotencyKey);\n}\n',
    );
    writeFileSync(
      join(dir, "job.json"),
      JSON.stringify({
        name: "NIGHT",
        description: "A sort over a file nobody declares",
        steps: [
          { name: "EXTRACT", project: "a" },
          {
            name: "SORTIT",
            input: "notAFile",
            output: "alsoNot",
            fields: "FIELDS=(1,16,CH,A)",
          },
        ],
      }),
    );

    const error = thrown(() => runBankc(["job", dir]));

    expect(error.id).toBe("BANK-JOB-006");
    expect(error.message).toContain("notAFile");
  });
});

/**
 * The other half of the triage.
 *
 * A `CompilerInvariant` is a state the typechecker is supposed to make
 * impossible, so there is no program that reaches one, which is the point, and
 * also why the class itself is what gets tested rather than a way of provoking
 * it. What matters is that it is a distinct type, so `bin.ts` can tell it apart
 * and say whose defect it is.
 */
describe("a compiler invariant", () => {
  it("is not a BankcError, and says it is bankc's own", () => {
    const invariant = new CompilerInvariant("switch has no case for Widget");

    expect(invariant).toBeInstanceOf(Error);
    expect(invariant).not.toBeInstanceOf(BankcError);
    expect(invariant.name).toBe("CompilerInvariant");
  });
});

/**
 * A throw during a rebuild ends the build, not the session.
 *
 * The boundary in `bin.ts` cannot reach this one. By the time a file changes,
 * its `try` has long returned and the rebuild is running inside the watcher's
 * callback, where a throw is an uncaught exception: Node prints it and ends the
 * process, and the user loses the watch over a typo, which is the case
 * `--watch` exists to shorten.
 *
 * The colliding job from BANK-JOB-005 is the provocation, because it is a real
 * failure a reader can cause and fix while watching: rename one of the two
 * modules and the next save builds.
 */
describe("the watch loop", () => {
  /** Two projects whose module names collapse to one eight-character member. */
  function collidingJob(): string {
    const dir = mkdtempSync(join(tmpdir(), "banklang-watch-"));
    const project = (name: string, module: string, txn: string) => {
      const root = join(dir, name);
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "bankc.json"),
        '{ "source": "src/main.bank.ts" }\n',
      );
      writeFileSync(
        join(root, "src/main.bank.ts"),
        `module ${module};\n\nrecord Row {\n  idempotencyKey: string<36>;\n}\n\nentry transaction ${txn}(row: Row) {\n  audit("RAN", row.idempotencyKey);\n}\n`,
      );
    };
    project("a", "SettlementAlpha", "runAlpha");
    project("b", "SettlementBeta", "runBeta");
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
    );
    return dir;
  }

  /**
   * `poke` runs before every poll, and exists because of how `fs.watch`
   * starts.
   *
   * On macOS a recursive watch is an FSEvents stream, and the stream is
   * registered asynchronously: a change made in the first moments after
   * `watch()` returns can be dropped outright rather than delivered late. On a
   * loaded machine, with 128 test files across several forks, that window is wide
   * enough to hit, and when it is hit no timeout is long enough, because there
   * is no event still in flight to wait for. Saving again on each poll is what
   * a reader does when nothing happens, and it keeps the assertion on the
   * property under test rather than on the platform's event delivery.
   */
  async function until(
    condition: () => boolean,
    what: string,
    poke: () => void = () => undefined,
    timeoutMs = 15_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (condition()) {
        return;
      }
      poke();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${what}.`);
  }

  it("reports a throwing build and goes on watching", async () => {
    const dir = collidingJob();
    const errors: unknown[] = [];
    const built: { exitCode: number }[] = [];

    const stop = watchProject(
      ["job", dir, "--watch"],
      dir,
      (result) => built.push(result),
      (error) => errors.push(error),
    );

    try {
      // The first build throws. It is reported rather than propagated, so the
      // watcher below was still installed.
      expect(errors).toHaveLength(1);
      expect((errors[0] as BankcError).id).toBe("BANK-JOB-005");
      expect(built).toEqual([]);

      // The reader fixes the collision and saves. Before the `finally` that
      // resets `running`, this rebuild never happened: the throw left the guard
      // set for the life of the session and every later change was swallowed,
      // which is worse than the crash because it looks like nothing is wrong.
      const fixed =
        'module Posting;\n\nrecord Row {\n  idempotencyKey: string<36>;\n}\n\nentry transaction runBeta(row: Row) {\n  audit("RAN", row.idempotencyKey);\n}\n';
      const save = () => {
        writeFileSync(join(dir, "b/src/main.bank.ts"), fixed);
      };
      save();

      await until(() => built.length > 0, "the rebuild after the fix", save);
      expect(built.at(-1)?.exitCode).toBe(0);
      expect(errors).toHaveLength(1);
    } finally {
      stop();
    }
  });

  /**
   * The watcher is installed before the first build, not after it.
   *
   * The first build of a job compiles every step and takes seconds, and it ran
   * with nothing watching: a change saved during it was not queued and not
   * delivered late, it was never seen at all, and the session went on reporting
   * a failure the reader had already fixed. That is the same shape as the
   * `running` guard this file's first test is about, and the watch goes quiet
   * while still looking like it is working.
   *
   * Asserted against the source, because provoking it needs a change to land
   * inside the first build's window and that window is the platform's to
   * schedule: a test that tried would be the flake described on `until` above,
   * failing on a loaded machine and passing on a quiet one. The order of these
   * two statements is the whole of the fix, so the order is what is held.
   */
  it("starts watching before it starts building", () => {
    const source = readFileSync("packages/bankc-cli/src/index.ts", "utf8");
    const body = source.slice(source.indexOf("export function watchProject"));

    const installed = body.indexOf("const watcher = watch(");
    const firstBuild = body.search(/^ {2}run\(\);$/m);

    expect(
      installed,
      "watchProject no longer installs a watcher",
    ).toBeGreaterThan(0);
    expect(
      firstBuild,
      "watchProject no longer builds on start",
    ).toBeGreaterThan(0);
    expect(
      installed,
      "the first build runs before anything is watching, so a save during it is lost",
    ).toBeLessThan(firstBuild);
  });

  /**
   * The same property at the boundary, where it is the process that has to
   * survive. Spawned, because an uncaught exception inside the callback is
   * something only a real process can demonstrate.
   */
  it("does not end the process the throw happened in", async () => {
    const dir = collidingJob();
    const child = spawn(
      "npx",
      [
        "tsx",
        join(process.cwd(), "packages/bankc-cli/src/bin.ts"),
        "job",
        dir,
        "--watch",
      ],
      { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));

    try {
      await until(
        () => stderr.includes("BANK-JOB-005"),
        `the failure to be reported (stderr so far: ${stderr})`,
      );

      // Reported the way a one-shot run reports it, rather than as a crash.
      expect(stderr).toContain("bankc explain BANK-JOB-005");
      expect(stderr).not.toContain("at watchProject");
      expect(stdout).toContain("Watching for changes");

      // Still there. `exitCode` is null while a child is running.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(child.exitCode, `exited with ${child.exitCode}`).toBeNull();
    } finally {
      child.kill("SIGKILL");
    }
  }, 30_000);
});
