import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runBankc } from "../packages/bankc-cli/src/index";
import { renderCopybook } from "../packages/cobol-backend/src/index";
import { inspectGeneratedCopybook } from "../packages/copybook/src/index";
import {
  compareLayouts,
  importCopybook,
  normalisePicture,
  typeFor,
} from "../packages/copybook/src/import";
import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";

/**
 * A production copybook read back into a BankTS record.
 *
 * The 2026-08-05 audit called this "the single most valuable missing feature —
 * the difference between a greenfield toy and works with our estate", and set
 * the target itself: import a real copybook, emit a BankTS record, regenerate
 * the copybook, and compare. Every bank's records already exist, in copybooks
 * that other programs share, and a language that can only describe records it
 * invented cannot be used on the same data as the programs beside it.
 *
 * The round trip is what makes it safe rather than approximate. A field read at
 * the wrong length moves every field after it, and a record laid out
 * differently from the one the rest of the estate uses is a program reading
 * somebody else's data — so an import that does not survive the comparison is
 * refused rather than written.
 */

const COPYBOOK = resolve(process.cwd(), "tests/inputs/copybooks/ACCTMAST.cpy");

/** The BankTS source, compiled, so a record can be emitted back out of it. */
function recordFrom(source: string, name: string) {
  const parsed = parseBankTs(`module Imported;\n\n${source}\n`, "imported.ts");
  const ir = lowerProgramToIR(typecheckProgram(parsed.program));
  const record = ir.program?.records.find((entry) => entry.name === name);
  if (!record) {
    throw new Error(
      `The imported record did not compile: ${[
        ...parsed.diagnostics,
        ...ir.diagnostics,
      ]
        .map((entry) => entry.id)
        .join(", ")}`,
    );
  }
  return record;
}

describe("a copybook nobody generated", () => {
  const text = readFileSync(COPYBOOK, "utf8");
  const imported = importCopybook(text);

  it("imports with nothing left unread", () => {
    expect(imported.problems).toEqual([]);
  });

  /** Banner comments in the indicator area are not data description entries. */
  it("reads past the comments a copybook opens with", () => {
    expect(imported.recordName).toBe("AccountMaster");
  });

  it("names each field the way BankTS names one", () => {
    expect(imported.source).toContain("acctBranch: string<4>;");
    expect(imported.source).toContain("acctName: string<30>;");
  });

  /**
   * `PIC 9(08)` carries no sign and occupies eight bytes. BankTS's `zoned` is
   * `SIGN IS TRAILING SEPARATE`, which is nine — so before `unsigned` existed
   * there was no way to import one without moving every field after it.
   */
  it("tells the two display forms apart", () => {
    expect(imported.source).toContain("acctOpenDate: unsigned<8, 0>;");
  });

  it("reads a group as a record and a table as an array", () => {
    expect(imported.source).toContain("record AcctKey {");
    expect(imported.source).toContain("acctKey: AcctKey;");
    expect(imported.source).toContain("acctHistory: AcctHistory[12];");
  });

  /**
   * The target the audit set. Not byte-identical text — spacing is not part of
   * the contract and a copybook nobody generated will not match this emitter's
   * columns — but identical in every way a program can observe: the same
   * fields, in the same order, at the same offsets, with the same lengths and
   * the same pictures.
   */
  it("regenerates a copybook with the same layout", () => {
    const record = recordFrom(imported.source, imported.recordName);
    const problems = compareLayouts(
      inspectGeneratedCopybook(text),
      inspectGeneratedCopybook(renderCopybook(record)),
    );

    expect(problems).toEqual([]);
  });

  it("puts the record at the length the copybook describes", () => {
    const record = recordFrom(imported.source, imported.recordName);

    expect(inspectGeneratedCopybook(renderCopybook(record)).totalLength).toBe(
      inspectGeneratedCopybook(text).totalLength,
    );
  });
});

/**
 * A copybook this compiler generated is the strict case: the emitter wrote it,
 * so importing and re-emitting has to give back the same bytes.
 */
describe("a copybook this compiler generated", () => {
  it("round-trips byte for byte", () => {
    const original = renderCopybook(
      recordFrom(
        `record TransferRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: decimal<18, 2>;
  postedOn: unsigned<8, 0>;
  idempotencyKey: string<36>;
}`,
        "TransferRequest",
      ),
    );

    const imported = importCopybook(original);
    expect(imported.problems).toEqual([]);

    expect(
      renderCopybook(recordFrom(imported.source, imported.recordName)),
    ).toBe(original);
  });
});

describe("what a picture becomes", () => {
  const cases: [string, string][] = [
    ["PIC X(16)", "string<16>"],
    ["PIC A(10)", "string<10>"],
    ["PIC N(8)", "national<8>"],
    ["PIC 9(8)", "unsigned<8, 0>"],
    ["PIC 9(7)V99", "unsigned<9, 2>"],
    ["PIC S9(13)V99 COMP-3", "decimal<15, 2>"],
    ["PIC S9(13)V99 PACKED-DECIMAL", "decimal<15, 2>"],
    ["PIC S9(4) COMP", "binary<4>"],
    ["PIC S9(9) BINARY", "binary<9>"],
    ["PIC S9(9) COMP-5", "native<9>"],
    ["PIC S9(7)V99 SIGN IS TRAILING SEPARATE", "zoned<9, 2>"],
  ];

  for (const [picture, expected] of cases) {
    it(`reads ${picture} as ${expected}`, () => {
      expect(typeFor(picture)).toEqual({ text: expected });
    });
  }
});

/**
 * What BankTS cannot say, said out loud.
 *
 * An importer that silently drops a clause produces a record that lays out
 * differently from the one every other program on the estate is using, which is
 * the defect this feature exists to avoid rather than to cause.
 */
describe("what the importer refuses", () => {
  it("a sign carried as an overpunch, which is a byte narrower", () => {
    expect(typeFor("PIC S9(7)V99").problem).toContain("overpunch");
  });

  it("a leading separate sign, which is in a different byte", () => {
    expect(typeFor("PIC S9(7)V99 SIGN IS LEADING SEPARATE").problem).toContain(
      "LEADING SEPARATE",
    );
  });

  it("floating point, which a bank's arithmetic is not", () => {
    expect(typeFor("PIC S9(9)V99 COMP-1").problem).toContain("Floating point");
  });

  it("an edited picture it cannot spell", () => {
    expect(typeFor("PIC ZZ,ZZ9.99-").problem).toContain("edited picture");
  });

  it("more digits than ARITH(COMPAT) allows", () => {
    expect(typeFor("PIC S9(20) COMP-3").problem).toContain("18");
  });

  /** A FILLER whose bytes cannot be worked out moves every field after it. */
  it("a FILLER it cannot size", () => {
    const imported = importCopybook(`       01  BAD-FILLER.
           05  KEEP-ME                PIC X(4).
           05  FILLER.
           05  KEEP-ME-TOO            PIC X(4).
`);

    expect(
      imported.problems.map((problem) => problem.message).join(" "),
    ).toContain("wrong offset");
  });
});

/**
 * `FILLER` is bytes nothing names, and every copybook on an estate has them.
 *
 * The importer used to refuse one outright, which is the right answer to the
 * question "can this be laid out short?" and a useless answer to the question
 * "can this copybook be imported?" — no real record could be. `reserved <n>;`
 * is what BankTS says instead, and it counts bytes rather than digits: a
 * `PIC S9(9) COMP-3` FILLER is nine digits and five bytes, and reserving nine
 * would move every field after it four bytes along.
 */
describe("a FILLER", () => {
  it("becomes a reserved slot of the same width", () => {
    const imported = importCopybook(`       01  WITH-FILLER.
           05  KEEP-ME                PIC X(4).
           05  FILLER                 PIC X(6).
           05  KEEP-ME-TOO            PIC X(4).
`);

    expect(imported.problems).toEqual([]);
    expect(imported.source).toContain("reserved 6;");
  });

  it("counts the bytes a packed FILLER occupies, not its digits", () => {
    const imported = importCopybook(`       01  PACKED-FILLER.
           05  KEEP-ME                PIC X(4).
           05  FILLER                 PIC S9(9) COMP-3.
`);

    expect(imported.problems).toEqual([]);
    expect(imported.source).toContain("reserved 5;");
  });

  it("counts a separate sign on a display FILLER", () => {
    const imported = importCopybook(`       01  SIGNED-FILLER.
           05  FILLER                 PIC S9(4) SIGN IS LEADING SEPARATE.
`);

    expect(imported.problems).toEqual([]);
    expect(imported.source).toContain("reserved 5;");
  });
});

describe("comparing two layouts", () => {
  /** Spelling is not the contract; the bytes are. */
  it("reads a repeat count as the characters it stands for", () => {
    expect(normalisePicture("PIC X(04)")).toBe(normalisePicture("PIC XXXX"));
    expect(normalisePicture("PIC S9(4) COMPUTATIONAL")).toBe(
      normalisePicture("PIC S9999 COMP"),
    );
  });

  it("reports a field that moved", () => {
    const problems = compareLayouts(
      {
        recordName: "R",
        cobolName: "R",
        totalLength: 10,
        fields: [
          {
            name: "A",
            cobolName: "A",
            offset: 0,
            length: 4,
            picture: "PIC X(4)",
          },
        ],
      },
      {
        recordName: "R",
        cobolName: "R",
        totalLength: 10,
        fields: [
          {
            name: "A",
            cobolName: "A",
            offset: 2,
            length: 4,
            picture: "PIC X(4)",
          },
        ],
      },
    );

    expect(problems[0]!.message).toContain("offset 0");
  });
});

describe("bankc copybook import", () => {
  it("writes the record when the round trip holds", () => {
    const result = runBankc([
      "copybook",
      "import",
      "tests/inputs/copybooks/ACCTMAST.cpy",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("record AccountMaster {");
  });

  /** Nothing is written when it does not, and the reason is named. */
  it("refuses one it cannot read whole", () => {
    const result = runBankc(["copybook", "import", "runtime/README.md"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });
});
