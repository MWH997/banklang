import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { flowed } from "./helpers";

/**
 * The rest of VSAM: `update` mode, `rewrite`, `delete`, and the `start` /
 * `readNext` browse.
 *
 * With only `open`, `read`, `write`, and `close`, and files that were either
 * input or output, a master file update — the archetypal batch program — could
 * not be written at all. Updating a record in place means finding it first,
 * which needs one file open for both.
 */

const PREAMBLE = `module MasterUpdate;

type BDT = currency<"BDT", 18, 2>;

record AccountMaster {
  accountId: string<16>;
  balance: BDT;
  idempotencyKey: string<36>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

/** A transaction over a file declared with the given organization and mode. */
function txn(
  body: string,
  declaration = "indexed update",
): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
file accountMaster ${declaration} record AccountMaster key accountId status masterStatus;

entry transaction apply1(master: AccountMaster, amount: BDT) {
  open accountMaster;
${body}
  // Every fixture here ends by testing the status, because BANK-FILE-017
  // requires the outcome of a keyed operation to be looked at before the file
  // is closed — a close overwrites the status, and 23 means the record the
  // program is about to use is the one before it.
  if masterStatus == "00" {
    log "APPLIED ", masterStatus;
  }
  close accountMaster;

  debit(master.accountId, amount);
  credit("SUSPENSE", amount);
  audit("APPLIED", master.idempotencyKey);
}`);
}

describe("update mode", () => {
  /**
   * I-O is what a master file update needs: the same OPEN serves the read that
   * finds a record and the rewrite that puts it back.
   */
  it("opens I-O", () => {
    const result = txn(
      "  read accountMaster into master key master.accountId;",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("OPEN I-O ACCOUNT-MASTER-FILE");
  });

  it("still opens INPUT and OUTPUT for the other modes", () => {
    const sequential = (mode: string, body: string) =>
      compile(`${PREAMBLE}
file accountMaster sequential ${mode} record AccountMaster status masterStatus;

entry transaction apply1(master: AccountMaster, amount: BDT) {
  open accountMaster;
${body}
  // Every fixture here ends by testing the status, because BANK-FILE-017
  // requires the outcome of a keyed operation to be looked at before the file
  // is closed — a close overwrites the status, and 23 means the record the
  // program is about to use is the one before it.
  if masterStatus == "00" {
    log "APPLIED ", masterStatus;
  }
  close accountMaster;

  debit(master.accountId, amount);
  credit("SUSPENSE", amount);
  audit("APPLIED", master.idempotencyKey);
}`).cobol;

    expect(sequential("input", "  read accountMaster into master;")).toContain(
      "OPEN INPUT ACCOUNT-MASTER-FILE",
    );
    expect(
      sequential("output", "  write accountMaster from master;"),
    ).toContain("OPEN OUTPUT ACCOUNT-MASTER-FILE");
  });
});

describe("rewrite and delete", () => {
  it("rewrites a record in place", () => {
    const result = txn(`  read accountMaster into master key master.accountId;
  if masterStatus == "00" {
    rewrite accountMaster from master;
  }`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("REWRITE ACCOUNT-MASTER-RECORD");
    expect(result.cobol).toContain('INVALID KEY MOVE "23" TO MASTER-STATUS');
  });

  it("deletes by key", () => {
    const result = txn("  delete accountMaster key master.accountId;");

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("DELETE ACCOUNT-MASTER-FILE RECORD");
  });

  /** Updating a record in place means finding it first. */
  it("refuses to rewrite a file opened for input", () => {
    const result = txn("  rewrite accountMaster from master;", "indexed input");

    expect(ids(result)).toContain("BANK-FILE-005");
  });
});

describe("browsing with start and readNext", () => {
  /**
   * `KEY IS NOT LESS THAN` starts at the first record at or after the key,
   * which is what a range walk wants. An exact match would make a browse from a
   * partial key impossible.
   */
  it("positions the browse at or after the key", () => {
    const result = txn("  start accountMaster key master.accountId;");

    expect(result.diagnostics).toEqual([]);
    expect(flowed(result.cobol)).toContain(
      flowed(
        "START ACCOUNT-MASTER-FILE KEY IS NOT LESS THAN ACCOUNT-ID OF ACCOUNT-MASTER-RECORD",
      ),
    );
  });

  it("walks the browse and reports end of data", () => {
    const result = txn(`  start accountMaster key master.accountId;
  if masterStatus != "00" {
    raise "NO_SUCH_KEY";
  }
  readNext accountMaster into master;`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("READ ACCOUNT-MASTER-FILE NEXT RECORD");
    expect(result.cobol).toContain('AT END MOVE "10" TO MASTER-STATUS');
  });

  /**
   * DYNAMIC rather than RANDOM: an indexed file is read by key *and* browsed,
   * and RANDOM allows only the first.
   */
  it("declares dynamic access so both are possible", () => {
    expect(
      txn("  read accountMaster into master key master.accountId;").cobol,
    ).toContain("ACCESS MODE IS DYNAMIC");
  });

  it("refuses to browse a file with no index to walk", () => {
    const result = compile(`${PREAMBLE}
file accountMaster sequential update record AccountMaster status masterStatus;

entry transaction apply1(master: AccountMaster, amount: BDT) {
  open accountMaster;
  readNext accountMaster into master;
  close accountMaster;

  debit(master.accountId, amount);
  credit("SUSPENSE", amount);
  audit("APPLIED", master.idempotencyKey);
}`);

    expect(ids(result)).toContain("BANK-FILE-005");
  });
});

describe("the whole master file update", () => {
  it("compiles read, change, and put back", () => {
    const result = txn(`  read accountMaster into master key master.accountId;
  if masterStatus == "00" {
    master.balance = master.balance + amount;
    rewrite accountMaster from master;
  }`);

    expect(result.diagnostics).toEqual([]);
    const cobol = result.cobol ?? "";
    expect(cobol.indexOf("OPEN I-O")).toBeLessThan(cobol.indexOf("READ "));
    expect(cobol.indexOf("READ ")).toBeLessThan(cobol.indexOf("REWRITE "));
    expect(cobol.indexOf("REWRITE ")).toBeLessThan(cobol.indexOf("CLOSE "));
  });
});
