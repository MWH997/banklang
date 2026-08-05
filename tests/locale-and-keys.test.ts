import { describe, expect, it } from "vitest";

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emitCobol } from "../packages/cobol-backend/src/index";
import { loadConfig } from "../packages/config/src/index";
import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";
import { compile } from "../packages/compiler/src/index";
import { flowed } from "./helpers";

/**
 * Alternate record keys, and the two `SPECIAL-NAMES` conventions.
 *
 * Both are program-wide facts rather than per-field ones, which is why the
 * locale settings live in the project configuration and not in the source.
 */

const SOURCE = `module Locale;

type EUR = currency<"EUR", 18, 2>;

record Account {
  accountId: string<16>;
  customerId: string<20>;
  branchId: string<8>;
  balance: EUR;
  printed: edited<EUR, "grouped">;
  idempotencyKey: string<36>;
}

file accountMaster indexed input record Account key accountId alternate customerId, branchId status masterStatus;

entry transaction show1(account: Account) {
  open accountMaster;
  read accountMaster into account key account.accountId;
  close accountMaster;
  account.printed = account.balance;
  audit("SHOWN", account.idempotencyKey);
}`;

function emit(options: Parameters<typeof emitCobol>[1] = {}): string {
  const ir = lowerProgramToIR(
    typecheckProgram(parseBankTs(SOURCE, "m.ts").program),
  );
  if (!ir.program) {
    throw new Error("Expected the source to compile.");
  }
  return emitCobol(ir.program, options).cobol;
}

describe("alternate record keys", () => {
  /**
   * A KSDS is read by its primary key and browsed by any of its alternates. A
   * program that can only name the primary cannot open a file whose alternate
   * index is the whole reason it exists.
   */
  it("declares each alternate", () => {
    const cobol = emit();

    expect(flowed(cobol)).toContain(
      flowed("ALTERNATE RECORD KEY IS CUSTOMER-ID OF ACCOUNT-MASTER-RECORD"),
    );
    expect(flowed(cobol)).toContain(
      flowed("ALTERNATE RECORD KEY IS BRANCH-ID OF ACCOUNT-MASTER-RECORD"),
    );
  });

  /** Many accounts per customer is nearly always why an alternate exists. */
  it("allows duplicates on them", () => {
    expect(emit()).toContain("WITH DUPLICATES");
  });

  it("rejects an alternate that is not a field of the record", () => {
    const result = compile(
      SOURCE.replace("alternate customerId, branchId", "alternate nowhere"),
    );

    expect(result.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-FILE-004",
    );
  });

  it("rejects alternates on a file with no index", () => {
    const result = compile(
      SOURCE.replace("indexed input", "sequential input").replace(
        " key accountId",
        "",
      ),
    );

    expect(result.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-FILE-004",
    );
  });
});

describe("special names", () => {
  it("emits nothing when the defaults apply", () => {
    expect(emit()).not.toContain("SPECIAL-NAMES");
  });

  it("emits the comma convention", () => {
    expect(emit({ decimalPoint: "comma" })).toContain("DECIMAL-POINT IS COMMA");
  });

  it("emits a currency sign", () => {
    expect(emit({ currencySign: "#" })).toContain('CURRENCY SIGN IS "#"');
  });

  /**
   * The convention swaps the roles of the comma and the point *inside pictures
   * too*, so a grouped amount is written `Z.ZZZ.ZZ9,99`. A picture built the
   * other way round is not merely printed oddly — the COBOL compiler rejects
   * it, because the separator would appear more than once.
   */
  it("swaps the separators in an edited picture", () => {
    expect(emit()).toContain("PIC Z,ZZZ,ZZZ,ZZZ,ZZZ,ZZ9.99.");
    expect(emit({ decimalPoint: "comma" })).toContain(
      "PIC Z.ZZZ.ZZZ.ZZZ.ZZZ.ZZ9,99.",
    );
  });
});

describe("the currency sign is checked", () => {
  function problemsFor(currencySign: string): string[] {
    const directory = mkdtempSync(join(tmpdir(), "banklang-config-"));
    writeFileSync(
      join(directory, "banklang.json"),
      JSON.stringify({ currencySign }),
      "utf8",
    );
    return loadConfig(directory, directory).problems;
  }

  it("accepts a character a picture does not already use", () => {
    expect(problemsFor("#")).toEqual([]);
  });

  /**
   * A picture already means something by `E` (exponent), `Z` (suppression),
   * and `V` (the implied point). Emitting one of those as a currency sign
   * produces a program the COBOL compiler rejects, so it is caught here.
   */
  it("rejects a character a picture already uses", () => {
    expect(problemsFor("E").join(" ")).toContain("picture clause");
    expect(problemsFor("Z").join(" ")).toContain("picture clause");
  });

  /**
   * A picture position holds one byte. `£` is two bytes in UTF-8 and `€` is
   * three, so neither can sit in one, whatever the source file's encoding.
   */
  it("rejects anything that is not a single ASCII character", () => {
    expect(problemsFor("£").join(" ")).toContain("single ASCII character");
    expect(problemsFor("EUR").join(" ")).toContain("single ASCII character");
  });
});
