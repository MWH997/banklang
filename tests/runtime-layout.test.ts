import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  flatten,
  parseUnit,
  type Field,
} from "../packages/cobol-runtime/src/index";
import { compile } from "../packages/compiler/src/index";
import type { CopybookLayoutReport } from "../packages/copybook/src/index";
import { precompile } from "../packages/precompiler/src/index";
import { differentialProjects } from "../tools/interpret";
import { checked } from "./helpers";

/**
 * The interpreter's storage map against the compiler's own layout report.
 *
 * Two independent accounts of where a field sits: `packages/copybook` derives
 * it from the IR on its way to writing a copybook, and `packages/cobol-runtime`
 * derives it from the emitted COBOL on its way to executing it. Both are
 * supposed to be the same rules out of the *Language Reference*, and neither is
 * evidence for the other unless they are actually compared — a disagreement is
 * a field the playground reads from the wrong offset while every other test
 * passes, because both sides are internally consistent.
 *
 * `packages/cobol-runtime/src/data.ts` claimed this comparison already existed,
 * in a file that does not exist. It did not, and there was a live disagreement
 * to find: the runtime read `SIGN IS [LEADING|TRAILING] SEPARATE` and discarded
 * it, so every `zoned` field — one byte per digit plus a byte for the sign —
 * was a byte narrower here than in the copybook, and every field after it in
 * the record was offset by one. No example uses `zoned`, so nothing noticed.
 */

/** Every elementary field of the generated program's WORKING-STORAGE. */
function runtimeFields(cobol: string): Map<string, Field> {
  const unit = parseUnit(precompile(cobol).cobol);
  const fields = new Map<string, Field>();
  for (const program of unit.programs) {
    for (const root of [...program.working, ...program.linkage]) {
      for (const field of flatten(root)) {
        // Qualified as the copybook reports it: `RECORD.FIELD`.
        const path = [...field.qualifiers].reverse().concat(field.name);
        fields.set(path.join("."), field);
      }
    }
  }
  return fields;
}

/**
 * One record, both ways.
 *
 * Compared on the offset and the width of every elementary item, which is
 * everything a read or a write depends on. Group items are skipped: the
 * copybook reports them with a picture of `""` and their extent is the sum of
 * what is under them, so comparing the children compares the group.
 */
function agree(
  report: CopybookLayoutReport,
  fields: Map<string, Field>,
): number {
  let compared = 0;

  for (const entry of report.entries) {
    if (entry.picture === "" || entry.path.includes("[")) {
      continue;
    }
    const field = fields.get(entry.path);
    if (!field) {
      continue;
    }
    expect(field.offset, `${entry.path} offset`).toBe(entry.offset);

    // A nullable is one logical entry to the copybook and two items to COBOL:
    // `PIC X(20)` followed by its `PIC S9(4) COMP` indicator, reported together
    // as 22 bytes and declared as siblings. Both are right about their own
    // subject, so the width is not comparable — the offset above still is, and
    // it is the offset that a disagreement would move.
    if (!entry.type.startsWith("nullable")) {
      // `length`, not `elementLength`: a table's entry in the report covers all
      // its occurrences, and one occurrence of a 20-byte item is not the 720
      // bytes `OCCURS 36` reserves.
      expect(field.length, `${entry.path} width`).toBe(entry.bytes);
    }
    compared += 1;
  }

  return compared;
}

describe("the interpreter and the copybook reporter", () => {
  /**
   * Every field of every example that both sides name.
   *
   * A record the emitter puts behind a `COPY` statement is not in the text the
   * interpreter parses, so it contributes nothing here rather than failing —
   * which is why the floor is on the total. An assertion that quietly stops
   * finding fields passes without comparing any.
   */
  it("lay the whole corpus out identically", () => {
    let compared = 0;

    // The two the interpreter refuses to parse at all, by the same list the
    // differential lane uses rather than a second copy of it.
    for (const example of differentialProjects()) {
      const result = compile(
        readFileSync(`${example}/src/main.bank.ts`, "utf8"),
        { sourceFile: `${example}/main.bank.ts` },
      );
      expect(result.cobol, `${example} no longer compiles`).toBeTruthy();

      const fields = runtimeFields(result.cobol!);
      for (const report of result.layout!.reports) {
        compared += agree(report, fields);
      }
    }

    checked(compared, 150, "fields");
  });

  /**
   * The case the corpus does not cover.
   *
   * `zoned` is the one type whose picture carries a `SIGN` clause into a
   * record, and no example declares one — so this is the fixture that keeps the
   * two implementations honest about it. Twelve bytes: eleven digits and the
   * separate sign.
   */
  it("agrees on a zoned field, which no example declares", () => {
    const result = compile(
      `module ZonedLayout;

record LegacyMaster {
  accountId: string<16>;
  legacyBalance: zoned<11, 2>;
  status: string<8>;
  idempotencyKey: string<36>;
}

entry transaction readMaster(master: LegacyMaster) {
  log "STATUS ", master.status;
  audit("MASTER_READ", master.idempotencyKey);
}
`,
      { sourceFile: "zoned.bank.ts" },
    );
    expect(
      result.diagnostics.filter((each) => each.severity === "error"),
    ).toEqual([]);

    const report = result.layout!.reports.find(
      (each) => each.recordName === "LegacyMaster",
    )!;
    const fields = runtimeFields(result.cobol!);

    expect(
      report.entries.find((each) => each.path.endsWith(".LEGACY-BALANCE"))
        ?.bytes,
    ).toBe(12);
    checked(agree(report, fields), 4, "zoned record fields");

    // And the field after it, which a one-byte disagreement would displace:
    // sixteen for the account plus twelve for the zoned balance. Found by
    // position rather than by name, because `STATUS` is a COBOL reserved word
    // and the emitter renames it.
    const balance = report.entries.findIndex((each) =>
      each.path.endsWith(".LEGACY-BALANCE"),
    );
    const next = report.entries[balance + 1]!;
    expect(next.offset).toBe(28);
    expect(fields.get(next.path)?.offset, next.path).toBe(28);
  });
});
