/**
 * Emitted COBOL read back as statements rather than as lines.
 *
 * Every rule in this package asks a question that spans a wrap. `CALL "MQCONN"
 * USING …` carries four operands and the fourth is regularly on the next line;
 * the `IF` that tests its completion code is two lines long whenever the queue
 * name is more than a few characters. A rule written against physical lines
 * sees half a statement and answers about the half it saw.
 *
 * **How a continuation is recognised.** Reference format puts a continuation
 * four columns past the line it continues, and so does a nested statement — the
 * indent alone cannot tell them apart. What can is the first word: the emitter
 * writes one statement per call to `addLine`, so a deeper line that does not
 * begin with a word that starts a statement is the tail of the one above it.
 *
 * That is a heuristic and it is worth saying which way it fails. A continuation
 * beginning with a statement word would be split, and each half read as a
 * statement of its own — which loses the operands after the break rather than
 * inventing any, so a rule goes quiet rather than reporting something that is
 * not there. `tests/zos-lint.test.ts` holds the reconstruction against wrapped
 * output from the corpus, which is the only place this can be checked honestly.
 *
 * An `EXEC … END-EXEC` block is one statement whatever it looks like inside.
 * SQL and CICS are not COBOL and their text obeys none of the rules above.
 */

/** One logical statement, and the physical line its first word is on. */
export interface Statement {
  /** 1-based, so an editor and a compiler listing agree. */
  line: number;
  /** The statement with every wrap flowed back into single spaces. */
  text: string;
}

/**
 * Words that begin a statement, a clause of one, or a scope terminator.
 *
 * Enterprise COBOL's verbs, plus the words that open and close the conditional
 * scopes the emitter writes. `END-` is matched by prefix rather than listed:
 * every scope terminator in the language begins with it, and one missing from a
 * list would silently join a `MOVE` to the `END-IF` above it.
 */
const STATEMENT_WORDS = new Set([
  "ACCEPT",
  "ADD",
  "ALTER",
  "CALL",
  "CANCEL",
  "CLOSE",
  "COMPUTE",
  "CONTINUE",
  "DELETE",
  "DISPLAY",
  "DIVIDE",
  "ELSE",
  "ENTRY",
  "EVALUATE",
  "EXEC",
  "EXECUTE",
  "EXIT",
  "GO",
  "GOBACK",
  "IF",
  "INITIALIZE",
  "INSPECT",
  "INVOKE",
  "JSON",
  "MERGE",
  "MOVE",
  "MULTIPLY",
  "OPEN",
  "PERFORM",
  "READ",
  "RELEASE",
  "RETURN",
  "REWRITE",
  "SEARCH",
  "SET",
  "SORT",
  "START",
  "STOP",
  "STRING",
  "SUBTRACT",
  "UNSTRING",
  "WHEN",
  "WRITE",
  "XML",
]);

/** Column 7, zero-based: the indicator area, where a `*` marks a comment. */
const INDICATOR_AREA = 6;

/**
 * The PROCEDURE DIVISION of one artifact, as statements.
 *
 * The data division is not read: nothing here asks a question about a
 * declaration, and a `VALUE` clause carrying the word `TO` inside a literal is
 * a needless way to be wrong.
 */
export function procedureStatements(text: string): Statement[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) =>
    /^\s*PROCEDURE\s+DIVISION\b/.test(line),
  );
  if (start < 0) {
    return [];
  }

  const statements: Statement[] = [];
  let current: Statement | null = null;
  /** True between `EXEC` and `END-EXEC`, whose text is not COBOL. */
  let inExec = false;

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!;
    const body = line.trim();
    if (body === "" || line[INDICATOR_AREA] === "*") {
      continue;
    }

    if (inExec) {
      current = append(current, body);
      if (/\bEND-EXEC\b/.test(body)) {
        inExec = false;
      }
      continue;
    }

    if (current && !startsStatement(body)) {
      current = append(current, body);
      continue;
    }

    current = { line: index + 1, text: body };
    statements.push(current);
    if (/^EXEC\b/.test(body) && !/\bEND-EXEC\b/.test(body)) {
      inExec = true;
    }
  }

  return statements;
}

function append(current: Statement | null, body: string): Statement | null {
  if (current) {
    current.text = `${current.text} ${body}`;
  }
  return current;
}

/**
 * True for a line the emitter began a statement with.
 *
 * A paragraph name counts: it is in Area A with nothing after it but a period,
 * and it ends whatever statement came before it. So does a period alone.
 */
function startsStatement(body: string): boolean {
  const word = /^[A-Z0-9-]+/.exec(body)?.[0] ?? "";
  if (STATEMENT_WORDS.has(word) || word.startsWith("END-")) {
    return true;
  }
  return /^[A-Z][A-Z0-9-]*\s*\.$/.test(body);
}

/**
 * A statement with every alphanumeric literal replaced by a blank of its width.
 *
 * The operand of `DISPLAY "MQCONN FAILED …"` is not a data name, and a rule
 * that reads it as one reports a program for a message it prints. Blanked
 * rather than deleted so that the words on either side stay separated.
 */
export function withoutLiterals(text: string): string {
  return text.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g, (literal) =>
    " ".repeat(literal.length),
  );
}

/** The first word of a statement, which is its verb where it has one. */
export function verbOf(statement: Statement): string {
  return /^[A-Z0-9-]+/.exec(statement.text)?.[0] ?? "";
}

/**
 * The operands of a `CALL "NAME" USING …`, in order.
 *
 * Commas are separators in COBOL and the emitter writes them; `BY REFERENCE`
 * and `BY CONTENT` are phrases rather than operands. A qualified operand keeps
 * its `OF` chain, because `MQOD OF PAYMENT-IN-MQOD` is one argument.
 */
export function callOperands(statement: Statement): string[] {
  const using = /\bUSING\b(.*)$/.exec(withoutLiterals(statement.text));
  if (!using) {
    return [];
  }
  return using[1]!
    .replace(/\bBY\s+(?:REFERENCE|CONTENT|VALUE)\b/g, ",")
    .replace(/\.\s*$/, "")
    .split(",")
    .map((operand) => operand.trim().replace(/\s+/g, " "))
    .filter((operand) => operand !== "");
}

/** The program name a `CALL "NAME"` holds, or null for a dynamic call. */
export function calledProgram(statement: Statement): string | null {
  return /^CALL\s+"([A-Z0-9$#@]+)"/.exec(statement.text)?.[1] ?? null;
}
