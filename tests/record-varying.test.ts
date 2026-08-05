import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * `varying <min> to <max> length <field>` — `RECORD IS VARYING IN SIZE`.
 *
 * A fixed-length file pads every record to the longest one it might hold. For a
 * feed whose records differ by hundreds of bytes that is most of the dataset,
 * and on tape it is most of the tape.
 *
 * The length field is how the program says how much of the record it is using:
 * set before a write, filled by a read.
 */

const PREAMBLE = `module Feed;

record FeedLine {
  payload: string<80>;
}
`;

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

function program(file: string, body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
${file}

entry transaction emit(line: FeedLine, idempotencyKey: string<36>) {
${body}
  audit("EMITTED", idempotencyKey);
}`);
}

const VARYING = `file feed sequential output record FeedLine
  varying 10 to 80 length feedLength status feedStatus;`;

describe("the declaration", () => {
  const result = program(
    VARYING,
    `  open feed;
  line.payload = "SHORTER ONE";
  feedLength = textLength(line.payload);
  write feed from line;
  close feed;`,
  );

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("becomes RECORD IS VARYING on the FD", () => {
    expect(result.cobol).toContain(
      "RECORD IS VARYING IN SIZE FROM 10 TO 80 CHARACTERS",
    );
    expect(result.cobol).toContain("DEPENDING ON FEED-LENGTH");
  });

  /** The used length is the program's to set and read, not the file's. */
  it("declares the length field in working storage", () => {
    expect(result.cobol).toContain("01  FEED-LENGTH          PIC S9(4) COMP.");
  });

  it("leaves a fixed-length file alone", () => {
    const plain = program(
      "file feed sequential output record FeedLine status feedStatus;",
      `  open feed;
  close feed;`,
    );

    expect(plain.cobol).not.toContain("VARYING IN SIZE");
  });
});

describe("what it will take", () => {
  it("needs a range that is a range", () => {
    expect(
      ids(
        program(
          `file feed sequential output record FeedLine
  varying 80 to 10 length feedLength status feedStatus;`,
          "  open feed;\n  close feed;",
        ),
      ),
    ).toContain("BANK-FILE-009");
  });

  it("needs a shortest record of at least one character", () => {
    expect(
      ids(
        program(
          `file feed sequential output record FeedLine
  varying 0 to 80 length feedLength status feedStatus;`,
          "  open feed;\n  close feed;",
        ),
      ),
    ).toContain("BANK-FILE-009");
  });

  /**
   * An indexed or relative dataset addresses a record by key or by position,
   * which a varying length would move.
   */
  it("belongs to a sequential file", () => {
    expect(
      ids(
        program(
          `file feed indexed output record FeedLine key payload
  varying 10 to 80 length feedLength status feedStatus;`,
          "  open feed;\n  close feed;",
        ),
      ),
    ).toContain("BANK-FILE-009");
  });

  /** `varying`, `to`, and `length` are contextual, so all stay usable. */
  it("does not reserve the clause words", () => {
    const result = compile(`module Feed;

record Row {
  varying: binary<4>;
  length: binary<4>;
  idempotencyKey: string<36>;
}

entry transaction emit(row: Row) {
  row.varying = row.length;
  audit("EMITTED", row.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
  });
});

/**
 * The saving is the claim, so the bytes are what gets checked: two records of
 * different lengths, neither padded to the declared eighty.
 */
describe("executed", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("writes each record at its own length", () => {
    const result = program(
      VARYING,
      `  open feed;
  line.payload = "SHORTER ONE";
  feedLength = textLength(line.payload);
  write feed from line;
  line.payload = "A MUCH LONGER RECORD INDEED";
  feedLength = textLength(line.payload);
  write feed from line;
  close feed;`,
    );
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-varying-"));
    writeFileSync(join(dir, "program.cbl"), result.cobol ?? "", "utf8");

    // GnuCOBOL's default assign clause does not bind an unquoted ASSIGN to the
    // DD name; `external` does. On z/OS the DD comes from the JCL.
    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "-fassign-clause=external",
        "program.cbl",
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync("./program", [], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, DD_FEED: join(dir, "FEED") },
    });
    expect(ran.status, ran.stderr).toBe(0);

    const written = readFileSync(join(dir, "FEED"));
    // Eleven characters and twenty-seven, each with a length prefix. Padded to
    // the declared eighty this would be a hundred and sixty bytes.
    expect(written.length).toBeLessThan(60);
    expect(written.toString("latin1")).toContain("SHORTER ONE");
    expect(written.toString("latin1")).toContain("A MUCH LONGER RECORD INDEED");
    expect(written.toString("latin1")).not.toContain("SHORTER ONE   ");
  });
});

/**
 * The length field cannot be a member of the record whose length it gives.
 *
 * Inside it, it would be part of the data it is measuring. And the generated
 * `DEPENDING ON` names it bare, which resolves twice — the record is laid out
 * in working storage and again inside the FD — so `cobc` answers "is ambiguous;
 * needs qualification" and there is no qualification that fixes it, because the
 * item may not be in the record at all.
 *
 * Found by compiling every construct under GnuCOBOL rather than the one example
 * the validator defaulted to.
 */
describe("where the length field lives", () => {
  it("rejects one declared inside the record", () => {
    const result = compile(`module M;

record V {
  text: string<80>;
  len: binary<4>;
}

file f sequential output record V varying 1 to 80 length len status fs;

entry transaction t(v: V, idempotencyKey: string<36>) {
  open f;
  write f from v;
  close f;
  audit("A", idempotencyKey);
}`);

    expect(result.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-FILE-009",
    );
  });
});
