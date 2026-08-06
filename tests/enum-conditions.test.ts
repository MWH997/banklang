import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { localCobol } from "./helpers";

/**
 * `SET <condition> TO TRUE` — what the level-88 names are for.
 *
 * The 88s were always generated; nothing ever used them to set the field.
 * `MOVE "CLOSED" TO STATUS-FLD OF ACCOUNT` repeats the spelling of the member
 * in the procedure division, where it can drift from the 88 that defines it —
 * rename the member and the `MOVE` still compiles, still runs, and now writes a
 * value no condition matches.
 *
 * `SET STATUS-FLD-CLOSED OF ACCOUNT TO TRUE` names the condition instead, so
 * there is one place the spelling lives.
 */

const PREAMBLE = `module States;

enum Status { OPEN, CLOSED, FROZEN }

record Account {
  status: Status;
  idempotencyKey: string<36>;
}
`;

function program(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction shift(account: Account) {
${body}
  audit("SHIFTED", account.idempotencyKey);
}`);
}

describe("setting an enum field", () => {
  const result = program("  account.status = Status.CLOSED;");

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("sets the condition rather than moving the spelling", () => {
    expect(result.cobol).toContain("SET STATUS-FLD-CLOSED OF ACCOUNT TO TRUE");
    expect(result.cobol).not.toContain('MOVE "CLOSED"');
  });

  it("still declares the conditions it sets", () => {
    expect(result.cobol).toContain("88  STATUS-FLD-CLOSED");
  });

  /**
   * The same qualification the equivalent MOVE carried, and needed for the same
   * reason: the same record is emitted in working storage and again inside
   * every FD that holds it, so an unqualified condition name is ambiguous the
   * moment a second record has a field of the same name.
   */
  it("qualifies the condition by its group", () => {
    const result = compile(`${PREAMBLE}
record Mirror {
  status: Status;
}

entry transaction shift(account: Account, mirror: Mirror) {
  account.status = Status.CLOSED;
  mirror.status = Status.OPEN;
  audit("SHIFTED", account.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("SET STATUS-FLD-CLOSED OF ACCOUNT TO TRUE");
    expect(result.cobol).toContain("SET STATUS-FLD-OPEN-FLD OF MIRROR TO TRUE");
  });
});

describe("what keeps its MOVE", () => {
  /**
   * A local is an `01` item the emitter only qualifies when two routines
   * collide, so a condition on one has no group to be qualified by. A `SET`
   * there would be right until somebody declared the same local elsewhere.
   */
  it("a local of enum type", () => {
    const result = program(`  let held: Status = Status.OPEN;
  held = Status.FROZEN;
  account.status = held;`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain('MOVE "FROZEN" TO HELD');
  });

  /** Assigning from another field is a move of a value, not a choice of member. */
  it("a field assigned from another field", () => {
    const result = compile(`${PREAMBLE}
record Mirror {
  status: Status;
}

entry transaction shift(account: Account, mirror: Mirror) {
  mirror.status = account.status;
  audit("SHIFTED", account.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("MOVE STATUS-FLD OF ACCOUNT");
  });
});

/**
 * Testing a field is the other half, and it was still comparing the member's
 * spelling as a literal — the construct the level-88 exists to replace. The
 * condition name says which state is being asked about; a string comparison
 * repeats the spelling in the procedure division and has to be kept in step
 * with the 88 by hand.
 */
describe("testing an enum field", () => {
  it("tests the condition rather than the spelling", () => {
    const result = program(`  if account.status == Status.CLOSED {
    log "SHUT";
  }`);
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("IF STATUS-FLD-CLOSED OF ACCOUNT");
    expect(result.cobol).not.toContain('= "CLOSED"');
  });

  /** COBOL negates a condition name with NOT, there being no other operator. */
  it("negates with NOT", () => {
    const result = program(`  if account.status != Status.CLOSED {
    log "OPEN FOR BUSINESS";
  }`);
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("IF NOT STATUS-FLD-CLOSED OF ACCOUNT");
  });

  /** Either way round, since the field is what carries the conditions. */
  it("reads the same written the other way round", () => {
    const result = program(`  if Status.CLOSED == account.status {
    log "SHUT";
  }`);
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain("IF STATUS-FLD-CLOSED OF ACCOUNT");
  });

  /**
   * Two enum fields compared with each other have no single condition to name,
   * so that stays an ordinary comparison of the two fields.
   */
  it("leaves a field compared with another field alone", () => {
    const result = compile(`${PREAMBLE}
record Mirror {
  status: Status;
}

entry transaction shift(account: Account, mirror: Mirror) {
  if account.status == mirror.status {
    log "SAME";
  }
  audit("SHIFTED", account.idempotencyKey);
}`);
    expect(result.diagnostics).toEqual([]);
    expect(result.cobol).toContain(
      "IF STATUS-FLD OF ACCOUNT = STATUS-FLD OF MIRROR",
    );
  });
});

/**
 * A `SET` that names the wrong condition still compiles, so the value that
 * lands in the field is what gets checked.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("writes the member it named", () => {
    const result = compile(`${PREAMBLE}
record Mirror {
  status: Status;
}

entry transaction shift(account: Account, mirror: Mirror) {
  account.status = Status.CLOSED;
  mirror.status = Status.OPEN;
  log "ACCOUNT ", account.status;
  log "MIRROR ", mirror.status;
  audit("SHIFTED", account.idempotencyKey);
}`);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-set88-"));
    writeFileSync(
      join(dir, "program.cbl"),
      localCobol(result.cobol ?? ""),
      "utf8",
    );

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);

    // Two records with a field of the same name: unqualified conditions would
    // either not compile or set the wrong one.
    expect(ran.stdout).toContain("ACCOUNT CLOSED");
    expect(ran.stdout).toContain("MIRROR OPEN");
  });
});
