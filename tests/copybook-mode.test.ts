import { describe, expect, it } from "vitest";

import { emitCobol, emitJcl } from "../packages/cobol-backend/src/index";
import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";

/**
 * Whether record layouts are written into the program or copied into it.
 *
 * The compiler emitted `.cpy` files and then inlined every record anyway, so
 * nothing ever copied them. In a real shop the copybook is the contract between
 * programs, and a program that does not `COPY` it can drift from it silently —
 * which is the defect the copybook exists to prevent.
 *
 * `inline` stays the default, because a self-contained artifact is what the
 * playground shows and what a reviewer reads on its own.
 */

const SOURCE = `module Posting;

type BDT = currency<"BDT", 18, 2>;

record TransferRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: BDT;
  idempotencyKey: string<36>;
}

entry transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.amount);
  audit("POSTED", request.idempotencyKey);
}`;

function program() {
  const ir = lowerProgramToIR(
    typecheckProgram(parseBankTs(SOURCE, "m.ts").program),
  );
  if (!ir.program) {
    throw new Error("Expected the source to compile.");
  }
  return ir.program;
}

describe("inline mode", () => {
  it("writes the record into the program", () => {
    const cobol = emitCobol(program()).cobol;

    expect(cobol).toContain("01  TRANSFER-REQUEST.");
    expect(cobol).toContain("05  DEBIT-ACCOUNT        PIC X(16).");
    expect(cobol).not.toContain("COPY TRANSFER-REQUEST.");
  });

  it("is the default", () => {
    expect(emitCobol(program()).cobol).toBe(
      emitCobol(program(), { copybookMode: "inline" }).cobol,
    );
  });

  it("needs no SYSLIB in the job", () => {
    expect(emitJcl(program()).jcl).not.toContain("SYSLIB");
  });
});

describe("copy mode", () => {
  it("copies the record instead of writing it out", () => {
    const cobol = emitCobol(program(), { copybookMode: "copy" }).cobol;

    expect(cobol).toContain("COPY TRANSFER-REQUEST.");
    expect(cobol).not.toContain("05  DEBIT-ACCOUNT        PIC X(16).");
  });

  /**
   * A COPY resolves against SYSLIB. Without it the copy statements find nothing
   * and the compile fails on undefined data names, so the job that omits it
   * describes a build that cannot succeed.
   */
  it("adds a SYSLIB to the compile step", () => {
    const jcl = emitJcl(program(), { usesCopybooks: true }).jcl;

    expect(jcl).toContain("//SYSLIB   DD DISP=SHR,DSN=BANKLANG.COPYLIB");
    expect(jcl.indexOf("//SYSLIB")).toBeGreaterThan(
      jcl.indexOf("//COMPILE  EXEC PGM=IGYCRCTL"),
    );
  });

  /**
   * The record is still traceable: one entry for the record, and none for its
   * fields, because the fields are in the copybook and have a layout report of
   * their own.
   */
  it("keeps the record in the source map", () => {
    const emitted = emitCobol(program(), { copybookMode: "copy" });
    const records = emitted.sourceMap.entries.filter(
      (entry) => entry.category === "record",
    );

    expect(records.map((entry) => entry.symbol)).toEqual(["TransferRequest"]);
    expect(
      emitted.sourceMap.entries.filter((entry) => entry.category === "field"),
    ).toEqual([]);
  });

  it("still reports the layout, which is what the copybook contains", () => {
    const inline = emitCobol(program()).recordLayouts;
    const copied = emitCobol(program(), {
      copybookMode: "copy",
    }).recordLayouts;

    // The record is the same record either way; only where it is written
    // changes, so the layout a reviewer checks is identical.
    expect(copied).toEqual(inline);
  });
});
