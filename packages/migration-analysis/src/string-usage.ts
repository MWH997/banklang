/**
 * How real COBOL actually uses its string operations.
 *
 * `detectFeatures` answers *whether* a member uses reference modification,
 * `STRING`, `UNSTRING` or `INSPECT`. That is enough to rank a gap and not
 * enough to decide what to build, because these four constructs are each a
 * family rather than a feature. `INSPECT ... CONVERTING` and `INSPECT ...
 * REPLACING ... BEFORE INITIAL` are the same keyword and different problems;
 * `FIELD(1:4)` and `FIELD(WS-POS:WS-LEN)` are the same syntax and a different
 * language.
 *
 * So this counts the forms. It exists because BankTS already has an operation
 * for each of the four (`substring`, `concat`, `split`, `countOf` and
 * `replaceChars`) and the question worth answering is not "should we build
 * one" but "how much of what people write does the one we have actually
 * cover". A representability rule that says `supported` when the language
 * covers a third of the uses is the same kind of wrong as one that says
 * `unsupported` when it covers most of them.
 *
 * Detection rather than parsing, for the reason the rest of this package gives:
 * these files do not compile without copybooks nobody has. What that costs is
 * that a construct named inside a literal can be miscounted, so every pattern
 * is anchored on the syntax around it.
 */

import { contentDigest, sourceLines } from "./features";

/**
 * Reference modification, split by whether the compiler could check it.
 *
 * The distinction that matters to BankTS: `substring` takes constant bounds and
 * refuses anything else, so every out-of-range access is a compile error. A
 * corpus use with a literal offset is expressible today; one with a computed
 * offset is not, and no amount of implementation effort makes it safe in the
 * same way.
 */
export interface RefModUsage {
  /** `FIELD(1:4)`: both bounds literal. */
  constantBoth: number;
  /** `FIELD(WS-I:4)`: computed start, literal length. */
  dynamicStart: number;
  /** `FIELD(1:WS-LEN)`: literal start, computed length. */
  dynamicLength: number;
  /** `FIELD(WS-I:WS-LEN)`: neither known. */
  dynamicBoth: number;
  /** `FIELD(WS-I:)`: to the end of the field, a length COBOL infers. */
  openEnded: number;
  total: number;
  files: number;
}

export interface StringUsage {
  /** `DELIMITED BY SIZE`, the whole sending field. */
  delimitedBySize: number;
  /** `DELIMITED BY <literal or identifier>`, which stops at a delimiter. */
  delimitedByValue: number;
  /** `WITH POINTER`, an explicit cursor into the receiver. */
  withPointer: number;
  onOverflow: number;
  statements: number;
  files: number;
}

export interface UnstringUsage {
  /** Exactly one `DELIMITED BY` delimiter. */
  singleDelimiter: number;
  /** `DELIMITED BY a OR b`, several at once. */
  multipleDelimiters: number;
  /** `DELIMITED BY ALL x`, which collapses runs. */
  delimitedByAll: number;
  withPointer: number;
  tallying: number;
  onOverflow: number;
  statements: number;
  files: number;

  /* --- what the TALLYING statements actually are --- */

  /**
   * Digests of the distinct file *contents* carrying an `UNSTRING ...
   * TALLYING`.
   *
   * A statement count answers the wrong question when a corpus gathers 168
   * repositories, because a program copied into five of them is counted five
   * times. This one was: 130 `TALLYING` statements in 5,195 files reads as an
   * estate pattern, and 126 of them are `NC218A.CBL`, the NIST CCVS85
   * conformance test for `UNSTRING`, vendored into five language-tool
   * repositories. Deduplicating is the difference between "a common idiom" and
   * "a conformance suite exercises the clause".
   */
  tallyingContents: string[];
  /** `TALLYING` statements that also carry `WITH POINTER`: a scanning loop. */
  tallyingWithPointer: number;
  /**
   * `TALLYING` statements with exactly one receiver.
   *
   * The count is only a *field count* when there are several receivers. With
   * one, the statement is pulling a single field out at a moving pointer and
   * the tally is how far the scan got, which is pointer machinery rather than
   * "how many fields did this line have".
   */
  tallyingSingleReceiver: number;
}

export interface InspectUsage {
  tallying: number;
  replacing: number;
  converting: number;
  /** `ALL`, `LEADING` and `FIRST` change which occurrences are affected. */
  all: number;
  leading: number;
  first: number;
  /** `BEFORE`/`AFTER INITIAL` restrict the operation to part of the field. */
  beforeAfter: number;
  statements: number;
  files: number;
}

export interface StringUsageReport {
  filesScanned: number;
  referenceModification: RefModUsage;
  string: StringUsage;
  unstring: UnstringUsage;
  inspect: InspectUsage;
}

function emptyReport(): StringUsageReport {
  return {
    filesScanned: 0,
    referenceModification: {
      constantBoth: 0,
      dynamicStart: 0,
      dynamicLength: 0,
      dynamicBoth: 0,
      openEnded: 0,
      total: 0,
      files: 0,
    },
    string: {
      delimitedBySize: 0,
      delimitedByValue: 0,
      withPointer: 0,
      onOverflow: 0,
      statements: 0,
      files: 0,
    },
    unstring: {
      singleDelimiter: 0,
      multipleDelimiters: 0,
      delimitedByAll: 0,
      withPointer: 0,
      tallying: 0,
      onOverflow: 0,
      statements: 0,
      files: 0,
      tallyingContents: [],
      tallyingWithPointer: 0,
      tallyingSingleReceiver: 0,
    },
    inspect: {
      tallying: 0,
      replacing: 0,
      converting: 0,
      all: 0,
      leading: 0,
      first: 0,
      beforeAfter: 0,
      statements: 0,
      files: 0,
    },
  };
}

/** True when a reference-modification bound is a literal the compiler can see. */
function isLiteral(bound: string): boolean {
  return /^\s*\d+\s*$/.test(bound);
}

/**
 * A statement and everything up to its terminator, as one line of text.
 *
 * COBOL statements wrap, and `STRING ... DELIMITED BY SIZE INTO X END-STRING`
 * routinely spans five lines. Counting per line would report the clauses of one
 * statement as several statements and miss every clause that fell on a
 * continuation. So the source is flattened and the statements are cut out of
 * it, which is also why this cannot simply reuse `detectFeatures`.
 */
function statementsOf(flat: string, verb: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(
    `(?<![A-Z0-9-])${verb}\\b([\\s\\S]*?)(?=END-${verb}\\b|(?<![A-Z0-9-])(?:MOVE|IF|PERFORM|READ|WRITE|COMPUTE|ADD|SUBTRACT|MULTIPLY|DIVIDE|EVALUATE|GO\\s+TO|CALL|OPEN|CLOSE|DISPLAY|ACCEPT|SET|INITIALIZE|EXIT|GOBACK|STOP)\\b|\\.\\s|$)`,
    "g",
  );
  for (const match of flat.matchAll(pattern)) {
    found.push(match[1] ?? "");
  }
  return found;
}

/**
 * Receivers of an `UNSTRING`: the fields between `INTO` and the next clause.
 *
 * `DELIMITER IN` and `COUNT IN` belong to the receiver before them rather than
 * being receivers of their own, so they are dropped before the split.
 */
function receiverCount(body: string): number {
  const into =
    /\bINTO\b([\s\S]*?)(?=\bWITH\s+POINTER\b|\bTALLYING\b|\bON\s+OVERFLOW\b|\bNOT\s+ON\s+OVERFLOW\b|$)/.exec(
      body,
    );
  if (!into) {
    return 0;
  }
  return (into[1] ?? "")
    .replace(/\bDELIMITER\s+IN\s+[A-Z0-9][A-Z0-9-]*(\s*\([^)]*\))?/g, " ")
    .replace(/\bCOUNT\s+IN\s+[A-Z0-9][A-Z0-9-]*(\s*\([^)]*\))?/g, " ")
    .split(/[\s,]+/)
    .filter((word) => /^[A-Z][A-Z0-9-]*(\([^)]*\))?$/.test(word)).length;
}

/** One member's string usage, added into a running report. */
export function addStringUsage(text: string, into: StringUsageReport): void {
  into.filesScanned += 1;
  const lines = sourceLines(text);
  const flat = lines.join(" ").replace(/\s+/g, " ");

  /*
   * Reference modification: `NAME(start:length)` or `NAME(start:)`.
   *
   * Anchored on a name followed directly by the parenthesis, and requiring the
   * colon, so `PIC X(20)` and `OCCURS 5 TIMES` never match. A subscripted item
   * carrying a reference modification, `TABLE(I)(1:4)`, matches on the second
   * parenthesis, which is the one holding the colon.
   */
  let refModHere = 0;
  for (const match of flat.matchAll(
    /[A-Z][A-Z0-9-]*\s*\(\s*([^():]+?)\s*:\s*([^()]*?)\s*\)/g,
  )) {
    const start = match[1] ?? "";
    const length = match[2] ?? "";
    refModHere += 1;
    into.referenceModification.total += 1;
    if (length.trim() === "") {
      into.referenceModification.openEnded += 1;
    } else if (isLiteral(start) && isLiteral(length)) {
      into.referenceModification.constantBoth += 1;
    } else if (isLiteral(start)) {
      into.referenceModification.dynamicLength += 1;
    } else if (isLiteral(length)) {
      into.referenceModification.dynamicStart += 1;
    } else {
      into.referenceModification.dynamicBoth += 1;
    }
  }
  if (refModHere > 0) {
    into.referenceModification.files += 1;
  }

  /*
   * `STRING`, and not the `STRING` inside `UNSTRING`.
   *
   * The lookbehind is what separates them: the character before `STRING` in
   * `UNSTRING` is `N`, which the class rejects. No extra filtering is needed,
   * and the first version of this had some: a `.filter()` that tested an empty
   * string and therefore did nothing at all.
   */
  const strings = [...flat.matchAll(/(?<![A-Z0-9-])STRING\b/g)];
  if (strings.length > 0) {
    into.string.files += 1;
    into.string.statements += strings.length;
    for (const body of statementsOf(flat, "STRING")) {
      if (/DELIMITED\s+BY\s+SIZE/.test(body)) {
        into.string.delimitedBySize += 1;
      }
      if (/DELIMITED\s+BY\s+(?!SIZE)/.test(body)) {
        into.string.delimitedByValue += 1;
      }
      if (/WITH\s+POINTER/.test(body)) {
        into.string.withPointer += 1;
      }
      if (/ON\s+OVERFLOW/.test(body)) {
        into.string.onOverflow += 1;
      }
    }
  }

  const unstrings = [...flat.matchAll(/(?<![A-Z0-9-])UNSTRING\b/g)];
  if (unstrings.length > 0) {
    into.unstring.files += 1;
    into.unstring.statements += unstrings.length;
    for (const body of statementsOf(flat, "UNSTRING")) {
      const delimiters =
        /DELIMITED\s+BY([\s\S]*?)(?=INTO\b|$)/.exec(body)?.[1] ?? "";
      if (/\bOR\b/.test(delimiters)) {
        into.unstring.multipleDelimiters += 1;
      } else if (delimiters.trim() !== "") {
        into.unstring.singleDelimiter += 1;
      }
      if (/\bALL\b/.test(delimiters)) {
        into.unstring.delimitedByAll += 1;
      }
      if (/WITH\s+POINTER/.test(body)) {
        into.unstring.withPointer += 1;
      }
      if (/\bTALLYING\b/.test(body)) {
        into.unstring.tallying += 1;
        const digest = contentDigest(text);
        if (!into.unstring.tallyingContents.includes(digest)) {
          into.unstring.tallyingContents.push(digest);
        }
        if (/WITH\s+POINTER/.test(body)) {
          into.unstring.tallyingWithPointer += 1;
        }
        if (receiverCount(body) === 1) {
          into.unstring.tallyingSingleReceiver += 1;
        }
      }
      if (/ON\s+OVERFLOW/.test(body)) {
        into.unstring.onOverflow += 1;
      }
    }
  }

  const inspects = [...flat.matchAll(/(?<![A-Z0-9-])INSPECT\s+[A-Z]/g)];
  if (inspects.length > 0) {
    into.inspect.files += 1;
    into.inspect.statements += inspects.length;
    for (const body of statementsOf(flat, "INSPECT")) {
      if (/\bTALLYING\b/.test(body)) {
        into.inspect.tallying += 1;
      }
      if (/\bREPLACING\b/.test(body)) {
        into.inspect.replacing += 1;
      }
      if (/\bCONVERTING\b/.test(body)) {
        into.inspect.converting += 1;
      }
      if (/\bALL\b/.test(body)) {
        into.inspect.all += 1;
      }
      if (/\bLEADING\b/.test(body)) {
        into.inspect.leading += 1;
      }
      if (/\bFIRST\b/.test(body)) {
        into.inspect.first += 1;
      }
      if (/\b(?:BEFORE|AFTER)\b/.test(body)) {
        into.inspect.beforeAfter += 1;
      }
    }
  }
}

export function emptyStringUsage(): StringUsageReport {
  return emptyReport();
}
