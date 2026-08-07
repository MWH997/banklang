import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CobolUnsupportedError } from "../packages/cobol-runtime/src/index";
import {
  hasCobc,
  runConformance,
  type ConformanceOptions,
  type ConformanceRun,
} from "../tools/conformance";
import {
  differentialProjects,
  generatedCobol,
  NOT_INTERPRETED,
  parmDriver,
  programNameOf,
  runInterpreted,
  takesParm,
} from "../tools/interpret";

/**
 * The interpreter against a real COBOL compiler, over the whole example corpus.
 *
 * `packages/cobol-runtime` exists so the playground can run what it compiles.
 * On its own that is a second implementation of this project's semantics
 * written by the same hand as the first, which is worth exactly nothing as
 * evidence — a shared misreading of the Language Reference would agree with
 * itself perfectly.
 *
 * So every program is run twice: once compiled by `cobc` and executed as a
 * native binary against `runtime/`, and once interpreted. Then the two are
 * compared on everything a reader of the playground would look at — the return
 * code, what the program displayed, the ledger journal, the closing balances,
 * and the audit log. A difference in any of them fails here.
 *
 * **Skips without `cobc`.** A skipped run means unchecked, not passing; the CI
 * job builds GnuCOBOL 3.2 precisely so this lane runs there.
 */

const AVAILABLE = hasCobc();

interface Comparison {
  project: string;
  compiled: ConformanceRun;
  interpreted: ConformanceRun;
}

function compare(project: string): Comparison {
  const source = readFileSync(join(project, "src/main.bank.ts"), "utf8");
  const sourceFile = `${project}/src/main.bank.ts`;
  const cobol = generatedCobol(source, sourceFile);

  // A program entered with a PARM needs something to supply one, exactly as a
  // job step does. Without it `cobc -x` refuses to build the program at all,
  // which is why no example taking entry parameters had ever been executed.
  const options: ConformanceOptions = {
    source,
    sourceFile,
    workDir: join(tmpdir(), `banklang-diff-${project.replace(/\W+/g, "-")}`),
    driver: takesParm(cobol) ? parmDriver(programNameOf(cobol)) : undefined,
  };
  return {
    project,
    compiled: runConformance(options),
    interpreted: runInterpreted(options),
  };
}

describe("the interpreter and GnuCOBOL, on the same program", () => {
  const projects = differentialProjects();

  it("has a corpus worth comparing", () => {
    expect(projects.length).toBeGreaterThan(15);
  });

  for (const project of projects) {
    it.skipIf(!AVAILABLE)(
      `${project} runs the same both ways`,
      () => {
        const { compiled, interpreted } = compare(project);

        // The return code first: it is what a job step reads, and a program
        // that ends 12 under one and 0 under the other is the difference that
        // matters most.
        expect(interpreted.exitCode, "RETURN-CODE").toBe(compiled.exitCode);

        // DISPLAY output, line for line. GnuCOBOL pads a DISPLAY of a group
        // item to its full length, so both sides are compared with trailing
        // blanks removed rather than with one side reformatted to match.
        expect(lines(interpreted.stdout), "DISPLAY output").toEqual(
          lines(compiled.stdout),
        );

        expect(interpreted.journal, "ledger journal").toEqual(compiled.journal);
        expect([...interpreted.balances].sort(), "closing balances").toEqual(
          [...compiled.balances].sort(),
        );
        expect(interpreted.auditLog, "audit log").toEqual(compiled.auditLog);
      },
      30_000,
    );
  }

  it.skipIf(!AVAILABLE)(
    "refuses what it cannot run, rather than running it wrongly",
    () => {
      // The exclusions, held to their reasons. If Report Writer is ever
      // implemented this fails and the list has to be revisited, which is the
      // point: an exclusion nobody re-checks becomes a permanent hole.
      const excluded = Object.keys(NOT_INTERPRETED);
      expect(excluded).toHaveLength(2);

      // Paths built from the shared list rather than written out again. A
      // literal here would also be the string `tools/evidence-grades.ts` reads
      // to decide which examples a test asserts on, and this one asserts the
      // opposite: that the program cannot be run at all.
      for (const project of excluded) {
        expect(
          () =>
            runInterpreted({
              source: readFileSync(join(project, "src/main.bank.ts"), "utf8"),
              sourceFile: `${project}/src/main.bank.ts`,
              workDir: join(tmpdir(), "banklang-diff-unused"),
            }),
          project,
        ).toThrow(CobolUnsupportedError);
      }
    },
    30_000,
  );
});

/** Output lines, with trailing blanks removed and the final newline dropped. */
function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, all) => index < all.length - 1 || line !== "");
}
