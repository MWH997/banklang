import { describe, expect, it } from "vitest";

import { KEYWORDS, parseBankTs } from "../packages/parser/src/index";

/**
 * A syntax error has to end in a diagnostic, not in a hung compiler.
 *
 * Each recovery routine stops on the token it wants to resume at. A parse that
 * failed without consuming anything leaves that same token current, so the
 * loop that called the recovery resumed exactly where it started, and did it
 * again forever. What the author saw was the compiler exhausting memory, which
 * is the worst possible way to be told about a missing brace.
 *
 * The rule that makes it impossible is that recovery either advances or the
 * caller advances for it, so every iteration consumes at least one token.
 * Progress is structural rather than a property each routine has to remember to
 * preserve, which matters because a new recovery routine will be added by
 * somebody who has not read this comment.
 *
 * Across the sources below that guarantee has to force progress a couple of
 * hundred times. Every one of those was a hang.
 */

const VALID = `module P;

enum Status { OPEN, CLOSED }

record Row {
  rate: decimal<9, 4>;
}

record R {
  code: string<4>;
  rows: Row[4] ascending rate;
  state: Status;
  idempotencyKey: string<36>;
}

file feed sequential output record R varying 10 to 80 length feedLength status feedStatus;

function pick(a: decimal<9, 2>): decimal<9, 2> {
  return abs(a);
}

entry transaction t(r: R) {
  let x: decimal<9, 2> = 1.00;
  r.code = "AB";
  search sorted row in r.rows where row.rate == 0.05 {
    r.code = "CD";
  } else {
    r.code = "EF";
  }
  call "MOD" using r on error { returnCode = 12; };
  audit("X", r.idempotencyKey);
}
`;

/** Truncations, keyword injections, and stray punctuation at every boundary. */
function malformedSources(): string[] {
  const tokens = VALID.split(/(\s+)/);
  const sources: string[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    sources.push(tokens.slice(0, index).join(""));
  }

  const words = [...KEYWORDS];
  for (let index = 0; index < tokens.length; index += 3) {
    for (const word of words.filter((_, n) => n % 7 === index % 7)) {
      sources.push(
        [...tokens.slice(0, index), ` ${word} `, ...tokens.slice(index)].join(
          "",
        ),
      );
    }
  }

  for (let index = 0; index < tokens.length; index += 2) {
    for (const junk of ["}", "{", ")", "(", ";", ":", "]", "["]) {
      sources.push(
        [...tokens.slice(0, index), junk, ...tokens.slice(index)].join(""),
      );
    }
  }

  return sources;
}

describe("the parser always finishes", () => {
  const sources = malformedSources();

  it("has a broad enough sweep to mean something", () => {
    expect(sources.length).toBeGreaterThan(1000);
  });

  it("parses the source it was built from", () => {
    expect(parseBankTs(VALID, "p.bank.ts").diagnostics).toEqual([]);
  });

  /**
   * The budget is the assertion. A parser that loops does not fail this by a
   * margin. It never returns at all, and the runner's own timeout is what
   * reports it.
   */
  it("terminates on every malformed source", () => {
    const started = Date.now();

    for (const source of sources) {
      const parsed = parseBankTs(source, "p.bank.ts");
      // Every one of these is malformed, so every one has something to say,
      // except a bare prefix that happens to be a complete, valid module.
      expect(Array.isArray(parsed.diagnostics)).toBe(true);
    }

    expect(Date.now() - started).toBeLessThan(20_000);
  });
});

describe("a construct that runs off the end", () => {
  /**
   * Running out of source is not the same as reaching the closing brace, and
   * the field loop cannot tell them apart on its own: a record whose `}` was
   * missing parsed clean and silently became a record with fewer fields than it
   * was written with.
   */
  it("is reported rather than silently accepted", () => {
    const parsed = parseBankTs(
      `module P;
record R {
  a: string<4>;
`,
      "p.bank.ts",
    );

    expect(parsed.diagnostics.map((entry) => entry.id)).toContain(
      "BANK-SYN-001",
    );
    expect(parsed.diagnostics[0]?.message).toContain("closing");
  });

  it("still accepts a record that is closed", () => {
    const parsed = parseBankTs(
      `module P;
record R {
  a: string<4>;
}
`,
      "p.bank.ts",
    );

    expect(parsed.diagnostics).toEqual([]);
  });
});
