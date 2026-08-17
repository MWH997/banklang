import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { emitJcl } from "../packages/cobol-backend/src/index";
import { loadConfig } from "../packages/config/src/index";
import { lowerProgramToIR } from "../packages/ir/src/index";
import { parseBankTs } from "../packages/parser/src/index";
import { typecheckProgram } from "../packages/typechecker/src/index";

/**
 * What `banklang.json` is allowed to say, and what happens when it says
 * something else.
 *
 * The loader answers with a config and a list of problems rather than throwing,
 * so a malformed field falls back to its default and the reader is told which
 * one. That makes every branch a pair, the value taken and the default kept,
 * and the tools mutation lane found most of them surviving: the type checks,
 * the empty-string checks, and the card-width boundary.
 */

function configFor(json: string): ReturnType<typeof loadConfig> {
  const dir = mkdtempSync(join(tmpdir(), "banklang-config-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/main.bank.ts"), "module M;\n");
  writeFileSync(join(dir, "banklang.json"), json);
  return loadConfig(dir, dir);
}

describe("a malformed banklang.json", () => {
  it("is a JSON object, not an array", () => {
    expect(configFor("[]").problems.join()).toMatch(/must contain a JSON obje/);
  });

  it("keeps the default when a field is the wrong type", () => {
    const loaded = configFor('{"entry":42}');
    expect(loaded.problems.join()).toMatch(
      /"entry" must be a non-empty string/,
    );
    // The point of reporting rather than throwing: the build still runs.
    expect(loaded.config.entry).toBe("src/main.bank.ts");
  });

  it("treats an empty string as absent rather than as a path", () => {
    // `""` is a string, so only the length check catches it, and an empty
    // `outDir` would write the generated program into the project root.
    expect(configFor('{"entry":""}').problems.join()).toMatch(/"entry"/);
    expect(configFor('{"outDir":""}').problems.join()).toMatch(/"outDir"/);
    expect(configFor('{"outDir":""}').config.outDir).toBe("dist");
  });

  it("accepts the values it is given when they are well formed", () => {
    const loaded = configFor('{"entry":"src/other.bank.ts","outDir":"build"}');
    expect(loaded.problems).toEqual([]);
    expect(loaded.config.entry).toBe("src/other.bank.ts");
    expect(loaded.config.outDir).toBe("build");
  });

  it("requires runtimeOptions to be an array of strings", () => {
    expect(configFor('{"runtimeOptions":"x"}').problems.join()).toMatch(
      /array of strings/,
    );
    expect(configFor('{"runtimeOptions":[1]}').problems.join()).toMatch(
      /array of strings/,
    );
  });

  it("takes a well-formed runtimeOptions list", () => {
    const loaded = configFor(
      '{"runtimeOptions":["HEAP(4M,1M,ANYWHERE,KEEP)"]}',
    );
    expect(loaded.problems).toEqual([]);
    expect(loaded.config.runtimeOptions).toEqual(["HEAP(4M,1M,ANYWHERE,KEEP)"]);
  });

  it("requires formatCheck to be a boolean", () => {
    expect(configFor('{"formatCheck":"yes"}').problems.join()).toMatch(
      /must be a boolean/,
    );
    expect(configFor('{"formatCheck":true}').problems).toEqual([]);
  });
});

/**
 * The card-width limit, and the indent that decides it.
 *
 * `CEEOPTS` is read as cards: columns 1 to 71 are the option text. The loader
 * refuses an option longer than **69**, which looks like an off-by-two against
 * that sentence until you look at the emitter: it writes each option indented
 * by two spaces, so 2 + 69 is exactly 71.
 *
 * Those two numbers live in different packages and must agree. Asserted through
 * the JCL the emitter actually produces, so changing the indent without
 * changing the limit fails here rather than on somebody's spool.
 */
describe("a Language Environment option that will not fit on a card", () => {
  const CARD_COLUMNS = 71;

  it("accepts one that fills the card exactly", () => {
    const longest = "A".repeat(69);
    const loaded = configFor(JSON.stringify({ runtimeOptions: [longest] }));
    expect(loaded.problems).toEqual([]);
    expect(loaded.config.runtimeOptions).toEqual([longest]);
  });

  it("refuses one character more", () => {
    expect(
      configFor(
        JSON.stringify({ runtimeOptions: ["A".repeat(70)] }),
      ).problems.join(),
    ).toMatch(/longer than a card/);
  });

  const PROGRAM = `module PlainBatch;

type BDT = currency<"BDT", 18, 2>;

record Account {
  accountId: string<16>;
  balance: BDT;
  idempotencyKey: string<36>;
}

entry transaction settle(account: Account) {
  debit(account.accountId, account.balance);
  credit("CASH", account.balance);
  audit("SETTLED", account.idempotencyKey);
}
`;

  it("emits the longest accepted option within the card", () => {
    const parsed = parseBankTs(PROGRAM, "main.bank.ts");
    const ir = lowerProgramToIR(typecheckProgram(parsed.program));
    if (!ir.program) {
      throw new Error("the program did not compile");
    }

    const longest = "A".repeat(69);
    const jcl = emitJcl(ir.program, { runtimeOptions: [longest] }).jcl;

    const card = jcl.split("\n").find((line) => line.includes(longest));
    expect(card, "the option never reached the JCL").toBeDefined();
    expect(
      card!.length,
      "the emitter's indent and the loader's limit disagree",
    ).toBeLessThanOrEqual(CARD_COLUMNS);
  });
});
