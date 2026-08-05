import { describe, expect, it } from "vitest";

import { emitCobol } from "../packages/cobol-backend/src/index";
import { compile } from "../packages/compiler/src/index";
import { copybookMemberName } from "../packages/cobol-ir/src/index";
import { compileSource } from "./helpers";

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
 * that copybook as `ACCOUNTR` — two rules, derived separately, that never met.
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
