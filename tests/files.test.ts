import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { IRProgram } from "../packages/ir/src/index";
import { analyzeProgramSemantics } from "../packages/semantic-analyzer/src/index";

import { compileExample, compileSource } from "./helpers";

const RECORD = `module Files;

type MoneyBDT = decimal<18, 2>;

record AccountRecord {
  accountId: string<16>;
  balance: MoneyBDT;
}
`;

describe("file declarations", () => {
  it("parses organization, mode, record type, and status", () => {
    const { parsed, typechecked } = compileSource(
      `${RECORD}
file accountInput sequential input record AccountRecord status accountInputStatus;`,
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(typechecked.diagnostics).toEqual([]);
    expect(typechecked.files).toHaveLength(1);
    expect(typechecked.files[0]).toMatchObject({
      name: "accountInput",
      organization: "sequential",
      mode: "input",
      statusName: "accountInputStatus",
    });
  });

  it("parses a declaration with no status clause", () => {
    const { parsed, typechecked } = compileSource(
      `${RECORD}
file accountInput sequential input record AccountRecord;`,
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(typechecked.files[0].statusName).toBeNull();
  });

  it("rejects an unknown record type", () => {
    const { typechecked } = compileSource(
      `${RECORD}
file accountInput sequential input record MissingRecord status s;`,
    );

    expect(typechecked.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-TYPE-001",
    );
  });

  it("rejects an unknown file mode", () => {
    const { parsed } = compileSource(
      `${RECORD}
file accountInput sequential sideways record AccountRecord status s;`,
    );

    expect(parsed.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-SYN-001",
    );
  });

  it("keeps status, input, and output usable as field names", () => {
    const { parsed, typechecked } = compileSource(`module Naming;

record Flags {
  status: string<1>;
  input: string<1>;
  output: string<1>;
  sequential: string<1>;
}`);

    expect(parsed.diagnostics).toEqual([]);
    expect(typechecked.diagnostics).toEqual([]);
  });
});

describe("file status diagnostics", () => {
  it("reports BANK-FILE-001 when a file has no status field", () => {
    const { ir } = compileSource(
      `${RECORD}
file accountInput sequential input record AccountRecord;`,
    );

    const result = analyzeProgramSemantics(ir.program as IRProgram);

    expect(result.diagnostics.map((entry) => entry.id)).toEqual([
      "BANK-FILE-001",
    ]);
    expect(result.diagnostics[0].message).toContain(
      "File accountInput declares no file status field.",
    );
  });

  it("accepts a file with a status field", () => {
    const { ir } = compileSource(
      `${RECORD}
file accountInput sequential input record AccountRecord status accountInputStatus;`,
    );

    const result = analyzeProgramSemantics(ir.program as IRProgram);

    expect(result.diagnostics).toEqual([]);
    expect(result.summary.fileCount).toBe(1);
  });

  it("reports one diagnostic per unstatused file", () => {
    const { ir } = compileSource(
      `${RECORD}
file accountInput sequential input record AccountRecord;

file postingOutput sequential output record AccountRecord;`,
    );

    const result = analyzeProgramSemantics(ir.program as IRProgram);

    expect(result.diagnostics.map((entry) => entry.id)).toEqual([
      "BANK-FILE-001",
      "BANK-FILE-001",
    ]);
  });
});

describe("file COBOL emission", () => {
  it("emits the golden COBOL output for the account-file-batch example", () => {
    const { emit } = compileExample("examples/account-file-batch");
    const expected = readFileSync(
      resolve(process.cwd(), "tests/fixtures/account-file-batch.cbl"),
      "utf8",
    );

    expect(emit.cobol).toBe(expected);
  });

  it("emits a FILE-CONTROL entry with the FILE STATUS clause", () => {
    const { emit } = compileExample("examples/account-file-batch");

    expect(emit.cobol).toContain("SELECT ACCOUNT-INPUT ASSIGN TO ACCOUNTI");
    expect(emit.cobol).toContain("FILE STATUS IS ACCOUNT-INPUT-STATUS.");
  });

  /**
   * Emitting the structured record inside every FD would duplicate field names
   * across FD and working storage, and GnuCOBOL rejects the resulting
   * unqualified references as ambiguous.
   */
  it("emits the FD record as a buffer sized from the copybook layout", () => {
    const { emit } = compileExample("examples/account-file-batch");

    expect(emit.cobol).toContain("01  ACCOUNT-INPUT-RECORD     PIC X(26).");
    expect(emit.cobol).not.toMatch(
      /01 {2}ACCOUNT-INPUT-RECORD\.\n {11}05 {2}ACCOUNT-ID/,
    );
  });

  it("declares each file status field once in working storage", () => {
    const { emit } = compileExample("examples/account-file-batch");
    const occurrences = emit.cobol.split("01  ACCOUNT-INPUT-STATUS").length - 1;

    expect(occurrences).toBe(1);
  });
});
