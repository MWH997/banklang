import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { emitCobol, renderCopybook } from "../packages/cobol-backend/src/index";
import { compile } from "../packages/compiler/src/index";
import { copybookMemberName } from "../packages/cobol-ir/src/index";
import { compileSource, localCobol } from "./helpers";

/**
 * What a copybook is called on the library it lives in.
 *
 * A PDS member name is one to eight characters of letters, digits, and the
 * national characters, with no hyphens. That is also all the COBOL compiler
 * looks at: "when the compiler searches for COPY members in PDS or PDSE
 * datasets ... only the first eight characters of text-name are used as the
 * identifying name".
 *
 * The compiler used to write `COPY ACCOUNT-RECORD.` while the bundle shipped
 * that copybook as `ACCOUNTR`: two rules, derived separately, that never met.
 * On a PDS the compiler would look for a member called `ACCOUNT-`, which no
 * library can hold, so `copy` mode had never resolved on z/OS.
 */

const PREAMBLE = `module Members;

record TransferRequest {
  debitAccount: string<16>;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

describe("the member name", () => {
  it("takes the hyphens out and cuts to eight", () => {
    expect(copybookMemberName("TransferRequest")).toBe("TRANSFER");
    expect(copybookMemberName("AccountRecord")).toBe("ACCOUNTR");
    expect(copybookMemberName("Loan")).toBe("LOAN");
  });

  it("is what the COPY statement names", () => {
    const { ir } = compileSource(`${PREAMBLE}
entry transaction post(request: TransferRequest) {
  audit("POSTED", request.idempotencyKey);
}`);
    const cobol = emitCobol(ir.program!, { copybookMode: "copy" }).cobol;

    expect(cobol).toContain("COPY TRANSFER.");
    // The record's COBOL name is not a member name: it is fifteen characters
    // and carries a hyphen, and a PDS holds neither.
    expect(cobol).not.toContain("COPY TRANSFER-REQUEST.");
  });
});

/**
 * The reason the rule has to be enforced rather than merely followed: two
 * records that agree within those eight characters cannot share a library. One
 * copybook overwrites the other, and every program that copies either gets a
 * record with the name it asked for and different fields at different offsets.
 */
describe("two records that would share one member", () => {
  const result = compile(`module Members;

record AccountRecord {
  id1: string<10>;
  idempotencyKey: string<36>;
}

record AccountRow {
  balance: decimal<9, 2>;
}

entry transaction go(a: AccountRecord, b: AccountRow) {
  audit("DONE", a.idempotencyKey);
}`);

  it("is reported, naming both", () => {
    expect(ids(result)).toContain("BANK-COPY-007");
    expect(
      result.diagnostics.find((entry) => entry.id === "BANK-COPY-007")?.message,
    ).toContain("ACCOUNTR");
  });
});

describe("records that differ within eight characters", () => {
  it("are left alone", () => {
    const result = compile(`module Members;

record AccountRecord {
  id1: string<10>;
  idempotencyKey: string<36>;
}

record BalanceRow {
  balance: decimal<9, 2>;
}

entry transaction go(a: AccountRecord, b: BalanceRow) {
  audit("DONE", a.idempotencyKey);
}`);
    expect(result.diagnostics).toEqual([]);
  });
});

/**
 * The two names have to agree, run rather than argued.
 *
 * `copy` mode had never been compiled anywhere: no example sets it, so the
 * GnuCOBOL gate never reached it, and the `COPY` the program emitted and the
 * file the compiler wrote were free to drift apart, which they had. With the
 * copybook written under any other name, `cobc` says
 * `TRANSFER: No such file or directory`.
 */
describe("executed in copy mode", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("resolves the COPY against the file written", () => {
    const { ir } = compileSource(`${PREAMBLE}
entry transaction post(request: TransferRequest) {
  request.debitAccount = "ACC0000000000001";
  audit("POSTED", request.idempotencyKey);
}`);
    const cobol = emitCobol(ir.program!, { copybookMode: "copy" }).cobol;

    const dir = mkdtempSync(join(tmpdir(), "bankc-copy-"));
    mkdirSync(join(dir, "cpy"), { recursive: true });
    writeFileSync(join(dir, "program.cbl"), localCobol(cobol), "utf8");
    for (const record of ir.program!.records) {
      writeFileSync(
        join(dir, "cpy", `${copybookMemberName(record.name)}.cpy`),
        renderCopybook(record),
        "utf8",
      );
    }

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "-I",
        "cpy",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);
    expect(spawnSync("./program", [], { cwd: dir }).status).toBe(0);
  });
});
