import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * Storage for what is nested inside something else.
 *
 * The COBOL backend declares `WORKING-STORAGE` for things it finds by walking
 * the IR: a guard counter per loop, an index per `for each`, a field per local,
 * a `RESP` field per CICS command. Six walkers did that, each with its own list
 * of which statement kinds carry a block, and the lists disagreed.
 *
 * On 2026-08-07 that cost a real defect. `collectLoops` did not list
 * `SwitchStatement`; `planStatementNames`, which assigns the counter its name,
 * did. So a `while` loop inside a `switch` branch was named and never declared,
 * the emitter referenced the counter four times, and `cobc` said
 * `'CLASSIFY-LOOP-1' is not defined`. The compiler reported no diagnostic at
 * all — it emitted a program no COBOL compiler accepts and called it clean.
 *
 * Nothing caught it because no example in the corpus puts a loop inside a
 * `switch`. That is what these are for: every combination of a
 * storage-declaring statement inside a block-carrying one, which is the product
 * no corpus covers by accident.
 *
 * The assertion is deliberately not "the counter is declared". It is that
 * **every data name the program refers to is declared**, because the defect was
 * never about counters specifically — it was about two walkers disagreeing, and
 * the next disagreement will be about something else.
 */

/**
 * A transaction rather than a function, because a function's every block has to
 * end with a `return` or an `if` (`BANK-TYPE-004`) — which rules out ending one
 * with the loop these probes exist to nest.
 */
const PRELUDE = `module NestedWalkers;

type MoneyBDT = currency<"BDT", 18, 2>;
type Counter = decimal<4, 0>;

enum EntryKind {
  DEBIT,
  CREDIT
}

record Work {
  kind: EntryKind;
  total: MoneyBDT;
  idempotencyKey: string<36>;
}
`;

/**
 * Data names the program uses, minus the ones it declares.
 *
 * Paragraph labels are not data names, and neither are literals, so the scan
 * reads the operands of the statements that can only take a data name. `MOVE x
 * TO y` and `ADD 1 TO y` are enough to catch the whole class: everything the
 * walkers declare is written to before it is read.
 */
function undeclaredOperands(cobol: string): string[] {
  const declared = new Set<string>();
  for (const line of cobol.split("\n")) {
    const entry = /^\s+\d\d\s+([A-Z][A-Z0-9-]*)/.exec(line);
    if (entry?.[1]) {
      declared.add(entry[1]);
    }
  }

  const used = new Set<string>();
  for (const line of cobol.split("\n")) {
    // `GO TO` names a paragraph, which is a label rather than a data item.
    if (/\bGO\s+TO\b/.test(line)) {
      continue;
    }
    // `MOVE <literal-or-name> TO <name>` and `ADD <n> TO <name>`: the target of
    // a MOVE or an ADD is always a data name.
    for (const match of line.matchAll(/\bTO\s+([A-Z][A-Z0-9-]*)\b/g)) {
      if (match[1]) {
        used.add(match[1]);
      }
    }
  }

  // Special registers the compiler provides; a program never declares them.
  const registers = new Set(["RETURN-CODE", "TALLY", "WHEN-COMPILED"]);

  return [...used]
    .filter((name) => !declared.has(name) && !registers.has(name))
    .sort();
}

/** Compiles, and fails loudly rather than returning an empty program. */
function emit(source: string): string {
  const result = compile(PRELUDE + source, { sourceFile: "nested.bank.ts" });
  expect(
    result.diagnostics.map((entry) => `${entry.id} ${entry.message}`),
    "the probe itself does not compile, so it proves nothing",
  ).toEqual([]);
  expect(result.cobol).toBeDefined();
  return result.cobol ?? "";
}

/**
 * A body that declares one of everything a walker collects.
 *
 * A local (`collectFunctionLocals`), a bounded loop and so a guard counter
 * (`collectLoops` and `planStatementNames`), and a `for each` and so an index
 * (`collectForEachIndexes`).
 */
const DECLARING_BODY = `      let scratch: MoneyBDT = 1.00;
      let guard: Counter = 0;
      while guard < 3 limit 10 {
        guard = guard + 1;
        scratch = scratch + 1.00;
      }
      work.total = scratch;`;

describe("storage is declared for statements nested inside every block", () => {
  const nestings: [string, string][] = [
    [
      "a switch branch",
      `switch work.kind {
    case DEBIT {
${DECLARING_BODY}
    }
    case CREDIT {
      work.total = 2.00;
    }
  }`,
    ],
    [
      "a switch else branch",
      `switch work.kind {
    case DEBIT {
      work.total = 2.00;
    }
    else {
${DECLARING_BODY}
    }
  }`,
    ],
    [
      "an if branch",
      `if work.kind == EntryKind.DEBIT {
${DECLARING_BODY}
  }`,
    ],
    [
      "an else branch",
      `if work.kind == EntryKind.DEBIT {
    work.total = 2.00;
  } else {
${DECLARING_BODY}
  }`,
    ],
    [
      "a loop body",
      `while work.total < 5.00 limit 4 {
${DECLARING_BODY}
    work.total = work.total + 1.00;
  }`,
    ],
    [
      "two levels down, a loop inside a switch inside an if",
      `if work.kind == EntryKind.DEBIT {
    switch work.kind {
      case DEBIT {
${DECLARING_BODY}
      }
      case CREDIT {
        work.total = 3.00;
      }
    }
  }`,
    ],
  ];

  for (const [where, body] of nestings) {
    it(`declares everything used inside ${where}`, () => {
      const cobol = emit(`entry transaction run(work: Work) {
  audit("RAN", work.idempotencyKey);
  ${body}
}
`);

      expect(
        undeclaredOperands(cobol),
        `the generated COBOL writes to a data name it never declares, so no COBOL compiler will accept it`,
      ).toEqual([]);
    });
  }
});

/**
 * The guard against the next disagreement.
 *
 * The six walkers are migrated onto `childBlocks`, which is one `switch` over
 * every statement kind with no `default` — so a kind added with a block and
 * forgotten there is a type error. That property is worth keeping, and it is
 * lost the moment somebody writes a seventh walker with its own list.
 *
 * This reads the backend for the shape of the mistake rather than for a name:
 * a function that recurses over statements and tests `statement.kind` against
 * the block-carrying kinds is one that has its own list.
 */
describe("nothing in the backend keeps its own list of block-carrying kinds", () => {
  const source = readFileSync("packages/cobol-backend/src/index.ts", "utf8");

  it("enumerates the nesting kinds in exactly one place, which is the IR's", () => {
    const body = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    // `SwitchStatement` is the kind the defect turned on: a walker that names
    // it is a walker deciding for itself what carries a block.
    const decidesForItself = [
      ...body.matchAll(/statement\.kind === "SwitchStatement"/g),
    ];

    expect(
      decidesForItself.length,
      "a walker in the backend is testing for a block-carrying kind itself instead of calling childBlocks(), which is how a loop inside a switch went undeclared",
    ).toBe(0);
  });

  it("calls childBlocks wherever it walks nested blocks", () => {
    // The import, not one spelling of it: this asserted the exact single
    // -specifier form, so adding a second name to the same statement failed a
    // test about where the enumeration lives.
    expect(source).toMatch(
      /import \{[^}]*\bchildBlocks\b[^}]*\} from "\.\.\/\.\.\/ir\/src\/index"/,
    );
    expect(source.match(/childBlocks\(/g)?.length ?? 0).toBeGreaterThanOrEqual(
      5,
    );
  });
});
