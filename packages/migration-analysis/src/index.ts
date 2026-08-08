/**
 * Reading COBOL that already exists, and saying what is in it.
 *
 * The 2026-08-05 audit's §4.4, and the one thing on its missing list that is
 * not about generating anything. Before a bank asks whether a compiler produces
 * COBOL it likes, it asks what would happen to the two thousand programs it
 * already has — and the honest first answer is a count: how many, how big, what
 * they touch, and which ones nobody can follow.
 *
 * This is deliberately a *reader*, not a converter. It parses nothing
 * semantically and translates nothing: it reads reference-format text, finds
 * the constructs COBOL puts in fixed places, and reports them. A tool that
 * claimed to understand a program it had not compiled would be making exactly
 * the promise this project exists to refuse.
 *
 * What that costs is stated in `describeLimits()` and printed on every report.
 */

import { detectFeatures, type FeatureCounts } from "./features";

export {
  detectFeatures,
  featureNames,
  isFixedFormat,
  sourceLines,
  FEATURES,
} from "./features";
export type { FeatureCounts, FeatureDefinition } from "./features";

export { addStringUsage, emptyStringUsage } from "./string-usage";
export type {
  InspectUsage,
  RefModUsage,
  StringUsage,
  StringUsageReport,
  UnstringUsage,
} from "./string-usage";

/** Columns 8 through 72, which is where COBOL text lives. */
const AREA_A_INDEX = 7;
const LAST_COLUMN = 72;

export interface Paragraph {
  name: string;
  /** True when it is a `SECTION` header rather than a paragraph. */
  section: boolean;
  /** 1-based line the header is on. */
  line: number;
  /** Statements counted between this header and the next. */
  statements: number;
  /** Paragraphs this one performs, in order of appearance. */
  performs: string[];
  /** The far end of a `PERFORM a THRU b`, which reaches everything between. */
  performsThru: string[];
  /** Paragraphs this one jumps to. */
  goTos: string[];
  /**
   * True when the paragraph is inside `DECLARATIVES`.
   *
   * Nothing performs a declarative and nothing falls into one: the runtime
   * enters it when the condition it declares happens. Counting one as dead
   * code would have somebody delete the program's error handling.
   */
  declarative: boolean;
}

export interface FileUse {
  name: string;
  /** The DD name the `ASSIGN` clause binds it to. */
  dd: string | null;
  organization: string | null;
  /** The verbs used on it, deduplicated. */
  operations: string[];
  /** True when the program declares a `FILE STATUS` field for it. */
  statusChecked: boolean;
}

export interface SqlUse {
  /** `SELECT`, `DECLARE`, `FETCH`, `UPDATE` and so on. */
  verb: string;
  /** Tables and cursors named, best effort. */
  names: string[];
  line: number;
}

export interface CicsUse {
  command: string;
  /** The resource the command names, when it names one in quotes. */
  resource: string | null;
  /** True when the command captures `RESP`. */
  respCaptured: boolean;
  line: number;
}

export interface ProgramAnalysis {
  /** The member the text came from. */
  artifact: string;
  programId: string | null;
  /** Lines that are neither blank nor a comment. */
  statementLines: number;
  commentLines: number;
  paragraphs: Paragraph[];
  /** Paragraphs nothing performs and nothing falls into. */
  unreachable: string[];
  files: FileUse[];
  sql: SqlUse[];
  cics: CicsUse[];
  /** `CALL "X"` targets, and `CALL identifier` reported as a dynamic call. */
  calls: string[];
  dynamicCalls: number;
  copybooks: string[];
  /** `GO TO`s that leave a paragraph for somewhere that is not its own exit. */
  jumps: number;
  /** `ALTER`, which rewrites a `GO TO` at run time. */
  alters: number;
  /** The deepest `IF`/`EVALUATE`/`PERFORM` nesting reached. */
  maxNesting: number;
  /**
   * Which COBOL constructs the member contains, and how many lines use each.
   *
   * The paragraph graph above says how a program is shaped; this says what it
   * is made of, which is the question an estate asks when it wants to know
   * what a migration would have to cover. See `./features.ts`.
   */
  features: FeatureCounts;
}

const VERBS = ["OPEN", "CLOSE", "READ", "WRITE", "REWRITE", "DELETE", "START"];

/** True for a line COBOL treats as a comment. */
function isComment(line: string): boolean {
  return line[6] === "*" || line[6] === "/";
}

/** Columns 8 to 72 of a line, which is the text the compiler reads. */
function area(line: string): string {
  return line.slice(AREA_A_INDEX, LAST_COLUMN);
}

/**
 * One program, read.
 *
 * Everything here is found by position and shape rather than by parsing, which
 * is what makes it work on a member that will not compile without its
 * copybooks — and on an estate, that is most of them.
 */
export function analyseCobol(text: string, artifact: string): ProgramAnalysis {
  const lines = text.split("\n");
  const paragraphs: Paragraph[] = [];
  const files = new Map<string, FileUse>();
  const sql: SqlUse[] = [];
  const cics: CicsUse[] = [];
  const calls = new Set<string>();
  const copybooks = new Set<string>();

  let programId: string | null = null;
  let statementLines = 0;
  let commentLines = 0;
  let dynamicCalls = 0;
  let jumps = 0;
  let alters = 0;
  let maxNesting = 0;
  let nesting = 0;
  let current: Paragraph | null = null;
  let inProcedure = false;
  let inDeclaratives = false;
  /**
   * Between `FILE-CONTROL.` and the end of the section.
   *
   * Files are only declared there, and `SELECT` outside it is something else —
   * a data name ending in `-SELECT`, or the word inside a message. Found by
   * running this over AWS's CardDemo: `COCRDLIC` declares
   * `05 WS-EDIT-SELECT PIC X(1)` and displays
   * `'PLEASE SELECT ONLY ONE RECORD TO VIEW OR UPDATE'`, and the report claimed
   * the program had two files called `PIC` and `ONLY`, neither of which
   * declared a `FILE STATUS`. A finding invented out of a literal is worse than
   * a missed one: it is the kind a reader checks, does not find, and stops
   * trusting the rest of the page over.
   */
  let inFileControl = false;
  /** `PROGRAM-ID.` has been seen and its name is on a line still to come. */
  let awaitingProgramId = false;
  /** The first paragraph after `END DECLARATIVES`, which is the entry point. */
  let entryParagraph: string | null = null;
  let exec: { kind: string; text: string; line: number } | null = null;

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (isComment(raw)) {
      commentLines += 1;
      return;
    }
    const content = area(raw);
    if (content.trim() === "") {
      return;
    }
    statementLines += 1;
    const upper = content.toUpperCase();

    // An EXEC block runs to END-EXEC and its text is not COBOL.
    if (exec) {
      exec.text += ` ${upper}`;
      if (/\bEND-EXEC\b/.test(upper)) {
        recordExec(exec, sql, cics);
        exec = null;
      }
      return;
    }
    const execStart = /\bEXEC\s+(SQL|CICS|DLI)\b(.*)$/.exec(upper);
    if (execStart) {
      exec = { kind: execStart[1]!, text: execStart[2]!, line };
      if (/\bEND-EXEC\b/.test(upper)) {
        recordExec(exec, sql, cics);
        exec = null;
      }
      return;
    }

    /*
     * `PROGRAM-ID.` and the name it introduces, which need not share a line.
     *
     * A COBOL clause continues across lines, and nine of CardDemo's thirty-one
     * programs write the name underneath: `PROGRAM-ID.` on one line, `COACTUPC`
     * on the next. Requiring both on one line reported those nine with no name
     * at all — an estate report where a third of the rows say `?` is one nobody
     * reads twice.
     */
    if (programId === null) {
      const sameLine = /\bPROGRAM-ID\.\s*([A-Z0-9$#@-]+)/.exec(upper);
      if (sameLine) {
        programId = sameLine[1] ?? null;
      } else if (awaitingProgramId) {
        programId = /^\s*([A-Z0-9$#@-]+)/.exec(upper)?.[1] ?? null;
        awaitingProgramId = false;
      } else if (/\bPROGRAM-ID\s*\.\s*$/.test(upper)) {
        awaitingProgramId = true;
      }
    }

    for (const member of upper.matchAll(/\bCOPY\s+([A-Z0-9$#@-]+)/g)) {
      copybooks.add(member[1]!);
    }

    if (/\bFILE-CONTROL\s*\./.test(upper)) {
      inFileControl = true;
    }
    if (/\b(?:DATA|PROCEDURE)\s+DIVISION\s*\./.test(upper)) {
      inFileControl = false;
    }

    // `(?<![A-Z0-9-])` rather than `\b`: a hyphen is a word boundary to a
    // regular expression and a letter to COBOL, so `\bSELECT` matches inside
    // `WS-EDIT-SELECT`.
    const select = /(?<![A-Z0-9-])SELECT\s+(?:OPTIONAL\s+)?([A-Z0-9-]+)/.exec(
      upper,
    );
    if (select && inFileControl && !inProcedure) {
      files.set(select[1]!, {
        name: select[1]!,
        dd: null,
        organization: null,
        operations: [],
        statusChecked: false,
      });
    }
    /*
     * `ASSIGN TO [comment-]...[S-]ddname`, and the ddname is the last part.
     *
     * A DD name is one to eight alphanumeric characters and cannot contain a
     * hyphen, so everything before the final hyphen is the comment and the
     * organisation letters IBM allows there. Stripping one optional prefix
     * read `ASSIGN TO UT-S-MASTER` — the ordinary QSAM form — as the DD name
     * `S-MASTER`, and this tool exists to read other people's COBOL, which is
     * where that form actually appears. The conversions' own originals use
     * bare names, so nothing here noticed.
     */
    const assign = /\bASSIGN\s+TO\s+([A-Z0-9-]+)/.exec(upper);
    if (assign && files.size > 0) {
      const last = [...files.values()][files.size - 1]!;
      last.dd = assign[1]!.split("-").at(-1)!;
    }
    const organization = /\bORGANIZATION\s+(?:IS\s+)?([A-Z]+)/.exec(upper);
    if (organization && files.size > 0) {
      [...files.values()][files.size - 1]!.organization = organization[1]!;
    }
    if (/\bFILE\s+STATUS\s+(?:IS\s+)?/.test(upper) && files.size > 0) {
      [...files.values()][files.size - 1]!.statusChecked = true;
    }

    if (/^\s*PROCEDURE\s+DIVISION/.test(upper)) {
      inProcedure = true;
      return;
    }
    if (!inProcedure) {
      return;
    }
    if (/^\s*DECLARATIVES\s*\./.test(upper)) {
      inDeclaratives = true;
      return;
    }
    if (/^\s*END\s+DECLARATIVES\s*\./.test(upper)) {
      inDeclaratives = false;
      return;
    }

    // A paragraph or section header sits in Area A and is a name and a period.
    const header = /^([A-Z0-9][A-Z0-9-]*)(\s+SECTION)?\s*\.\s*$/.exec(
      content.trimEnd(),
    );
    if (
      header &&
      raw[AREA_A_INDEX] !== " " &&
      !/^(DECLARATIVES)$/.test(header[1]!)
    ) {
      current = {
        name: header[1]!.toUpperCase(),
        section: header[2] !== undefined,
        line,
        statements: 0,
        performs: [],
        performsThru: [],
        goTos: [],
        declarative: inDeclaratives,
      };
      paragraphs.push(current);
      entryParagraph ??= inDeclaratives ? null : current.name;
      // A count of how deeply one paragraph nests, so a drift in one does not
      // become the whole program's number.
      nesting = 0;
      return;
    }

    if (current) {
      current.statements += 1;
    }

    nesting += (upper.match(/\bIF\b|\bEVALUATE\b|\bPERFORM\s+UNTIL\b/g) ?? [])
      .length;
    nesting -= (
      upper.match(/\bEND-IF\b|\bEND-EVALUATE\b|\bEND-PERFORM\b/g) ?? []
    ).length;
    // Floored, because a period-terminated `IF` needs no `END-IF` and old code
    // is full of them: without this the count only ever goes up and the number
    // stops being a nesting depth.
    nesting = Math.max(nesting, 0);
    maxNesting = Math.max(maxNesting, nesting);

    const performed =
      /\bPERFORM\s+([A-Z0-9][A-Z0-9-]*)(?:\s+(?:THRU|THROUGH)\s+([A-Z0-9][A-Z0-9-]*))?/.exec(
        upper,
      );
    // `PERFORM UNTIL`, `PERFORM VARYING`, `PERFORM WITH TEST` and
    // `PERFORM n TIMES` are inline loops rather than calls. A paragraph name
    // may itself start with a digit — `1000-READ-TRANS` is the house style on
    // half the estates there are — so the count form has to be matched with
    // its `TIMES` rather than by the digit alone.
    if (
      performed &&
      !/\bPERFORM\s+(UNTIL|VARYING|WITH)\b/.test(upper) &&
      !/\bPERFORM\s+[A-Z0-9-]+\s+TIMES\b/.test(upper)
    ) {
      current?.performs.push(performed[1]!);
      if (performed[2]) {
        current?.performsThru.push(performed[2]);
      }
    }

    for (const jump of upper.matchAll(/\bGO\s+TO\s+([A-Z0-9][A-Z0-9-]*)/g)) {
      current?.goTos.push(jump[1]!);
      if (!/-EXIT$/.test(jump[1]!)) {
        jumps += 1;
      }
    }

    if (/\bALTER\b/.test(upper)) {
      alters += 1;
    }

    // Both delimiters: COBOL takes an apostrophe or a quotation mark for an
    // alphanumeric literal, and which one an estate uses is a house style
    // rather than a language question. Under `QUOTE` the compiler's own
    // figurative constant is the quotation mark, and half the code in the
    // world is written with the other one.
    const call = /\bCALL\s+(?:"([^"]+)"|'([^']+)')/.exec(upper);
    if (call) {
      calls.add(call[1] ?? call[2]!);
    } else if (/\bCALL\s+[A-Z]/.test(upper)) {
      dynamicCalls += 1;
    }

    for (const verb of VERBS) {
      const used = new RegExp(
        `^\\s*${verb}\\s+(?:INPUT\\s+|OUTPUT\\s+|I-O\\s+|EXTEND\\s+)?([A-Z0-9-]+)`,
      ).exec(upper);
      if (used) {
        const file = files.get(used[1]!);
        if (file && !file.operations.includes(verb)) {
          file.operations.push(verb);
        }
      }
    }
  });

  return {
    artifact,
    programId,
    statementLines,
    commentLines,
    paragraphs,
    unreachable: unreachableParagraphs(paragraphs, entryParagraph),
    files: [...files.values()],
    sql,
    cics,
    calls: [...calls].sort(),
    dynamicCalls,
    copybooks: [...copybooks].sort(),
    jumps,
    alters,
    maxNesting,
    features: detectFeatures(text),
  };
}

function recordExec(
  exec: { kind: string; text: string; line: number },
  sql: SqlUse[],
  cics: CicsUse[],
): void {
  const body = exec.text.replace(/\bEND-EXEC\b.*/, "").trim();
  const verb = /^([A-Z-]+)/.exec(body)?.[1] ?? "";

  if (exec.kind === "SQL") {
    const names = new Set<string>();
    for (const match of body.matchAll(
      /\b(?:FROM|INTO|UPDATE|TABLE|CURSOR\s+FOR|DECLARE)\s+([A-Z][A-Z0-9_.]*)/g,
    )) {
      names.add(match[1]!);
    }
    sql.push({ verb, names: [...names].sort(), line: exec.line });
    return;
  }
  if (exec.kind === "CICS") {
    cics.push({
      command: verb,
      resource:
        /\b(?:FILE|PROGRAM|QUEUE|TRANSID|MAP)\s*\(\s*'?"?([A-Z0-9$#@-]+)/.exec(
          body,
        )?.[1] ?? null,
      respCaptured: /\bRESP\s*\(/.test(body),
      line: exec.line,
    });
  }
}

/**
 * Paragraphs nothing reaches.
 *
 * Fall-through counts: COBOL runs into the next paragraph unless something
 * stops it, so a paragraph is reachable if the one before it can fall into it.
 * That makes this a *lower* bound on dead code, which is the right direction —
 * a tool that over-reported dead paragraphs would have somebody delete a live
 * one.
 */
function unreachableParagraphs(
  paragraphs: Paragraph[],
  entry: string | null,
): string[] {
  if (paragraphs.length === 0) {
    return [];
  }
  const named = new Set<string>();
  for (const paragraph of paragraphs) {
    for (const target of [
      ...paragraph.performs,
      ...paragraph.performsThru,
      ...paragraph.goTos,
    ]) {
      named.add(target);
    }
  }

  // Everything between the two ends of a `PERFORM a THRU b` is reached by it.
  for (const paragraph of paragraphs) {
    for (const [index, from] of paragraph.performs.entries()) {
      const to = paragraph.performsThru[index];
      if (!to) {
        continue;
      }
      const start = paragraphs.findIndex((entry) => entry.name === from);
      const end = paragraphs.findIndex((entry) => entry.name === to);
      if (start === -1 || end === -1) {
        continue;
      }
      for (let step = start; step <= end; step += 1) {
        named.add(paragraphs[step]!.name);
      }
    }
  }

  return paragraphs
    .filter((paragraph, index) => {
      if (paragraph.name === entry || (entry === null && index === 0)) {
        // The entry point, which is the first paragraph after the
        // declaratives rather than the first in the division.
        return false;
      }
      if (paragraph.declarative) {
        // The runtime enters it; nothing in the program does.
        return false;
      }
      if (named.has(paragraph.name)) {
        return false;
      }
      // Fall-through from whatever is above it, unless that one leaves.
      // Approximated by whether it jumps at all, and a section header with no
      // statements of its own always falls into its first paragraph — reading
      // an empty paragraph as one that leaves had the entry point of every
      // generated program reported as dead code.
      const previous = paragraphs[index - 1]!;
      return previous.goTos.length > 0 && !previous.section;
    })
    .map((paragraph) => paragraph.name);
}

/** What this tool does not know, printed on every report. */
export function describeLimits(): string[] {
  return [
    "Read from reference-format text, not compiled. A construct written in a way this reader does not recognise is absent from the report rather than reported as unknown.",
    "Copybooks are named, not expanded. A paragraph, file or SQL statement inside one is not counted.",
    "`unreachable` is a lower bound: fall-through and `PERFORM ... THRU` are both followed, so a paragraph listed here is very likely dead and one absent from it may still be.",
    "Nothing here is a conversion estimate. It is a count of what is in the source.",
  ];
}

/** The inventory, as the page a migration conversation starts from. */
export function renderInventory(analyses: ProgramAnalysis[]): string {
  const total = (pick: (entry: ProgramAnalysis) => number): number =>
    analyses.reduce((sum, entry) => sum + pick(entry), 0);

  const lines = [
    "# COBOL inventory",
    "",
    `${analyses.length} program(s), ${total((entry) => entry.statementLines)} lines of code and ${total((entry) => entry.commentLines)} of comment.`,
    "",
    "| Program | Member | Lines | Paragraphs | Jumps | Depth | Files | SQL | CICS | Calls |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...analyses.map(
      (entry) =>
        `| \`${entry.programId ?? "?"}\` | \`${entry.artifact}\` | ${entry.statementLines} | ${entry.paragraphs.length} | ${entry.jumps} | ${entry.maxNesting} | ${entry.files.length} | ${entry.sql.length} | ${entry.cics.length} | ${entry.calls.length + entry.dynamicCalls} |`,
    ),
    "",
  ];

  const risks = analyses.flatMap((entry) => describeRisks(entry));
  lines.push("## What to look at first", "");
  if (risks.length === 0) {
    lines.push("Nothing in these programs raised one of the flags below.", "");
  } else {
    lines.push(...risks.map((risk) => `- ${risk}`), "");
  }

  lines.push(
    "## What this report does not know",
    "",
    ...describeLimits().map((limit) => `- ${limit}`),
    "",
  );

  return lines.join("\n");
}

/**
 * The things worth knowing before anyone estimates.
 *
 * Not a score. Each is a specific property with a specific consequence, because
 * a single number is what lets a conversation skip the properties.
 */
function describeRisks(analysis: ProgramAnalysis): string[] {
  // Named by member as well, because two versions of one program have the
  // same PROGRAM-ID and a reader has to be able to tell them apart.
  const name = `${analysis.programId ?? "?"} (${analysis.artifact})`;
  const risks: string[] = [];

  if (analysis.alters > 0) {
    risks.push(
      `\`${name}\` uses \`ALTER\` ${analysis.alters} time(s). It rewrites a \`GO TO\` at run time, so what the program does cannot be read from the source at all.`,
    );
  }
  if (analysis.dynamicCalls > 0) {
    risks.push(
      `\`${name}\` makes ${analysis.dynamicCalls} dynamic \`CALL\`(s). What it calls is decided at run time, so the call graph is incomplete.`,
    );
  }
  if (analysis.jumps > 10) {
    risks.push(
      `\`${name}\` has ${analysis.jumps} \`GO TO\`s to somewhere that is not an exit. Following one transaction through it means holding several paragraphs at once.`,
    );
  }
  if (analysis.unreachable.length > 0) {
    risks.push(
      `\`${name}\` has paragraphs nothing reaches: ${analysis.unreachable.join(", ")}.`,
    );
  }
  const unchecked = analysis.files.filter((file) => !file.statusChecked);
  if (unchecked.length > 0) {
    risks.push(
      `\`${name}\` declares no \`FILE STATUS\` for ${unchecked.map((file) => file.name).join(", ")}. A failed open or write is invisible to the program.`,
    );
  }
  // `RETURN` and `ABEND` do not come back, so there is nothing for a response
  // to be reported into and no branch that could read one.
  const unguarded = analysis.cics.filter(
    (use) => !use.respCaptured && !["RETURN", "ABEND"].includes(use.command),
  );
  if (unguarded.length > 0) {
    risks.push(
      `\`${name}\` has ${unguarded.length} CICS command(s) with no \`RESP\`. A failure abends the task with nothing said about it.`,
    );
  }

  return risks;
}

/**
 * The paragraph graph, as Mermaid.
 *
 * Mermaid because it renders in the places a reader already is — a Markdown
 * file, a pull request — rather than needing a tool installed. A `PERFORM` and
 * a `GO TO` are drawn differently, because the difference between them is the
 * whole question a reader is asking.
 */
export function renderParagraphGraph(analysis: ProgramAnalysis): string {
  const identifiers = new Map<string, string>();
  const id = (name: string): string => {
    if (!identifiers.has(name)) {
      identifiers.set(name, `p${identifiers.size}`);
    }
    return identifiers.get(name) as string;
  };

  // Deduplicated: three `GO TO`s to the same paragraph from one place are one
  // edge in the graph, and drawing them three times says the graph is denser
  // than the program is.
  const edges = new Set<string>();
  for (const paragraph of analysis.paragraphs) {
    id(paragraph.name);
    for (const [index, target] of paragraph.performs.entries()) {
      edges.add(`  ${id(paragraph.name)} --> ${id(target)}`);
      const thru = paragraph.performsThru[index];
      if (thru) {
        edges.add(`  ${id(paragraph.name)} -.-> ${id(thru)}`);
      }
    }
    for (const target of paragraph.goTos) {
      edges.add(`  ${id(paragraph.name)} ==> ${id(target)}`);
    }
  }

  return [
    "```mermaid",
    "graph TD",
    ...[...identifiers].map(([name, key]) => `  ${key}["${name}"]`),
    ...edges,
    "```",
    "",
    "A solid arrow is a `PERFORM`, a dotted one the far end of a `THRU`, and a",
    "thick one a `GO TO`.",
  ].join("\n");
}
