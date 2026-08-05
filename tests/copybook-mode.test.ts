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
    expect(cobol).not.toContain("COPY TRANSFER.");
  });

  it("is the default", () => {
    expect(emitCobol(program()).cobol).toBe(
      emitCobol(program(), { copybookMode: "inline" }).cobol,
    );
  });

  /**
   * The binder's SYSLIB is always there — that is how a static `CALL` is
   * resolved. What an inline program does not need is a copybook library on the
   * compile step, because it has no COPY statement to resolve.
   */
  it("needs no copybook library on the compile step", () => {
    const jcl = emitJcl(program()).jcl;

    expect(jcl).not.toContain("COBOL.SYSLIB");
    expect(jcl).not.toContain("BANKLANG.COPYLIB");
  });
});

describe("copy mode", () => {
  it("copies the record instead of writing it out", () => {
    const cobol = emitCobol(program(), { copybookMode: "copy" }).cobol;

    // The member name, not the record's COBOL name. A PDS member is eight
    // characters with no hyphens, and that is all a COPY resolves on: "only
    // the first eight characters of text-name are used as the identifying
    // name". `COPY TRANSFER-REQUEST` would have the compiler look for a member
    // called `TRANSFER-`, which no library can hold.
    expect(cobol).toContain("COPY TRANSFER.");
    expect(cobol).not.toContain("05  DEBIT-ACCOUNT        PIC X(16).");
  });

  /**
   * A COPY resolves against SYSLIB. Without it the copy statements find nothing
   * and the compile fails on undefined data names, so the job that omits it
   * describes a build that cannot succeed.
   */
  it("adds a copybook library to the compile step", () => {
    const jcl = emitJcl(program(), { usesCopybooks: true }).jcl;

    // IGYWCL's parameter list documents SYSLIB as the caller's to supply, and
    // qualifies it by procedure step: the compiler's SYSLIB is a copybook
    // library, the binder's is where object modules are resolved from.
    expect(jcl).toContain("//COBOL.SYSLIB   DD DISP=SHR,DSN=BANKLANG.COPYLIB");
    expect(jcl.indexOf("//COBOL.SYSLIB")).toBeGreaterThan(
      jcl.indexOf("//COMPILE  EXEC IGYWCL"),
    );
  });

  it("adds it to the expanded form too", () => {
    const jcl = emitJcl(program(), {
      usesCopybooks: true,
      mode: "expanded",
    }).jcl;

    expect(jcl).toContain("//SYSLIB   DD DISP=SHR,DSN=BANKLANG.COPYLIB");
    expect(jcl.indexOf("//SYSLIB")).toBeGreaterThan(
      jcl.indexOf("//COBOL    EXEC PGM=IGYCRCTL"),
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
