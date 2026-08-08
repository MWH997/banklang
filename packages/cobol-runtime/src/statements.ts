/**
 * The PROCEDURE DIVISION, as a tree.
 *
 * Only the statements this compiler emits and the reference programs in
 * `runtime/` use are implemented. Everything else raises
 * `CobolUnsupportedError` naming the verb and the line, and no statement is
 * ever skipped: a COBOL interpreter that ignores what it does not recognise
 * produces a run that looks like a pass, and this project treats a green that
 * means nothing as worse than no green at all.
 *
 * Adding a verb is deliberately a three-part change — parse it here, execute it
 * in `machine.ts`, and add a case to `tests/cobol-runtime.test.ts` that the
 * differential test then re-checks against GnuCOBOL.
 */

import type { Cursor } from "./cursor";
import { AREA_A_END, CobolSyntaxError, CobolUnsupportedError } from "./source";

/* ------------------------------------------------------------------ *
 * References and expressions.
 * ------------------------------------------------------------------ */

export interface Reference {
  name: string;
  /** From `OF`/`IN`, nearest qualifier first. */
  qualifiers: string[];
  subscripts: Expr[];
  /** `FIELD(3:5)`, COBOL's substring. */
  refmod: { from: Expr; length: Expr | null } | null;
  line: number;
}

export type Figurative =
  "SPACES" | "ZEROS" | "HIGH-VALUES" | "LOW-VALUES" | "QUOTES" | "NULL";

export type Expr =
  | { kind: "ref"; ref: Reference }
  | { kind: "number"; text: string }
  | { kind: "string"; value: string }
  | { kind: "figurative"; value: Figurative }
  | { kind: "all"; value: string }
  | { kind: "unary"; op: "-" | "+"; operand: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "function"; name: string; args: Expr[]; line: number }
  /**
   * `ADDRESS OF X`, which is a pointer rather than a value.
   *
   * The generated code tests it against `NULL` to find out whether a program
   * was entered with a parameter at all — `examples/parm-driven-batch` is
   * exactly that question, and a batch that reads an unbound LINKAGE item
   * instead reads whatever the region left there.
   */
  | { kind: "address"; ref: Reference };

export type RelOp = "=" | "<>" | "<" | ">" | "<=" | ">=";

export type Cond =
  | { kind: "relation"; left: Expr; op: RelOp; right: Expr }
  | { kind: "condition-name"; ref: Reference }
  | { kind: "class"; operand: Expr; test: "NUMERIC" | "ALPHABETIC" }
  | { kind: "sign"; operand: Expr; test: "POSITIVE" | "NEGATIVE" | "ZERO" }
  | { kind: "not"; operand: Cond }
  | { kind: "and"; left: Cond; right: Cond }
  | { kind: "or"; left: Cond; right: Cond };

/* ------------------------------------------------------------------ *
 * Statements.
 * ------------------------------------------------------------------ */

export interface DisplayItem {
  value: Expr;
}

export type Statement =
  | { kind: "move"; from: Expr; to: Reference[]; line: number }
  | {
      kind: "compute";
      targets: { ref: Reference; rounded: boolean }[];
      value: Expr;
      onSizeError: Statement[] | null;
      notOnSizeError: Statement[] | null;
      line: number;
    }
  | {
      kind: "arith";
      verb: "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE";
      /** Everything before the joining word. */
      operands: Expr[];
      /** `TO`, `FROM`, `BY` or `INTO` — which one decides the direction. */
      joiner: "TO" | "FROM" | "BY" | "INTO" | null;
      /**
       * What follows the joiner.
       *
       * These are the targets when there is no GIVING, and further operands
       * when there is: `ADD A TO B` writes B, `ADD A TO B GIVING C` writes C
       * and leaves B alone.
       */
      rhs: { ref: Reference; rounded: boolean }[];
      giving: { ref: Reference; rounded: boolean }[];
      remainder: Reference | null;
      onSizeError: Statement[] | null;
      line: number;
    }
  | {
      kind: "if";
      condition: Cond;
      then: Statement[];
      otherwise: Statement[];
      line: number;
    }
  | {
      kind: "evaluate";
      subject: Expr | { kind: "true" };
      branches: { whens: (Cond | { kind: "other" })[]; body: Statement[] }[];
      line: number;
    }
  | {
      kind: "perform";
      /** A named range, or null for an inline PERFORM. */
      target: { from: string; thru: string | null } | null;
      times: Expr | null;
      until: Cond | null;
      testAfter: boolean;
      varying: {
        ref: Reference;
        from: Expr;
        by: Expr;
        until: Cond;
      } | null;
      body: Statement[] | null;
      line: number;
    }
  | { kind: "goto"; target: string; line: number }
  | {
      kind: "call";
      program: Expr;
      using: { by: "reference" | "content"; value: Expr }[];
      line: number;
    }
  | { kind: "display"; items: DisplayItem[]; upon: string | null; line: number }
  | {
      kind: "open";
      files: { mode: "INPUT" | "OUTPUT" | "I-O" | "EXTEND"; name: string }[];
      line: number;
    }
  | { kind: "close"; files: string[]; line: number }
  | {
      kind: "read";
      file: string;
      next: boolean;
      into: Reference | null;
      key: Reference | null;
      atEnd: Statement[] | null;
      notAtEnd: Statement[] | null;
      invalidKey: Statement[] | null;
      notInvalidKey: Statement[] | null;
      line: number;
    }
  | {
      kind: "write";
      record: Reference;
      from: Expr | null;
      /** `ADVANCING PAGE`, `ADVANCING n LINES`, or nothing. */
      advancing: Expr | "page" | null;
      endOfPage: Statement[] | null;
      invalidKey: Statement[] | null;
      line: number;
    }
  | {
      kind: "rewrite";
      record: Reference;
      from: Expr | null;
      invalidKey: Statement[] | null;
      line: number;
    }
  | {
      kind: "start";
      file: string;
      key: Reference | null;
      op: RelOp;
      invalidKey: Statement[] | null;
      line: number;
    }
  | { kind: "set-address"; target: Reference; source: Reference; line: number }
  | { kind: "set"; targets: Reference[]; value: Expr; line: number }
  | { kind: "set-condition"; targets: Reference[]; line: number }
  | {
      kind: "string";
      sources: { value: Expr; delimiter: Expr | "SIZE" }[];
      into: Reference;
      pointer: Reference | null;
      overflow: Statement[] | null;
      line: number;
    }
  | {
      /**
       * `UNSTRING source DELIMITED BY d INTO a b c ON OVERFLOW ... END-UNSTRING`.
       *
       * The form BankLang's `split` lowers to, and only that form. One
       * delimiter, several receivers, an optional overflow block. `WITH
       * POINTER`, `TALLYING`, `DELIMITED BY ALL` and multiple delimiters raise
       * rather than being approximated — an UNSTRING that silently does less
       * than it says leaves a record half-parsed with no error anywhere, which
       * is the failure this interpreter exists to catch rather than commit.
       */
      kind: "unstring";
      source: Expr;
      delimiter: Expr;
      into: Reference[];
      overflow: Statement[] | null;
      line: number;
    }
  | { kind: "initialize"; targets: Reference[]; line: number }
  | {
      kind: "inspect";
      target: Reference;
      /** `REPLACING ALL "_" BY "-"`, which is the only form implemented. */
      replacements: { from: Expr; to: Expr }[];
      line: number;
    }
  | { kind: "continue"; line: number }
  | { kind: "exit"; what: "paragraph" | "perform" | "program"; line: number }
  | { kind: "goback"; line: number }
  | { kind: "stop-run"; line: number };

export interface Paragraph {
  name: string;
  /** Order in the division, which is what `PERFORM ... THRU` walks. */
  index: number;
  statements: Statement[];
}

/**
 * A `USE AFTER STANDARD ERROR PROCEDURE ON <file>` section.
 *
 * COBOL runs it when an I/O statement on that file fails and the statement had
 * no phrase of its own to handle it. That is not a nicety: `examples/failed-open`
 * and `examples/full-disk` exist because the alternative is a job that ends with
 * return code 0 having processed nothing.
 */
export interface UseProcedure {
  file: string;
  /** First and last paragraph of the section, as indices. */
  from: number;
  thru: number;
}

export interface Division {
  paragraphs: Paragraph[];
  declaratives: UseProcedure[];
}

/* ------------------------------------------------------------------ *
 * Parsing.
 * ------------------------------------------------------------------ */

/** Words that end a statement list without being a statement themselves. */
const TERMINATORS = new Set([
  "ELSE",
  "END-IF",
  "WHEN",
  "END-EVALUATE",
  "END-PERFORM",
  "END-READ",
  "END-WRITE",
  "END-REWRITE",
  "END-START",
  "END-COMPUTE",
  "END-ADD",
  "END-SUBTRACT",
  "END-MULTIPLY",
  "END-DIVIDE",
  "END-CALL",
  "END-STRING",
  "END-UNSTRING",
  "AT",
  "NOT",
  "ON",
  "INVALID",
  "SIZE",
  "OTHER",
  "END",
  "PROGRAM",
]);

const VERBS = new Set([
  "MOVE",
  "COMPUTE",
  "ADD",
  "SUBTRACT",
  "MULTIPLY",
  "DIVIDE",
  "IF",
  "EVALUATE",
  "PERFORM",
  "GO",
  "CALL",
  "DISPLAY",
  "OPEN",
  "CLOSE",
  "READ",
  "WRITE",
  "REWRITE",
  "START",
  "DELETE",
  "SET",
  "STRING",
  "UNSTRING",
  "INITIALIZE",
  "CONTINUE",
  "EXIT",
  "GOBACK",
  "STOP",
  "ACCEPT",
  "INSPECT",
  "SEARCH",
  "SORT",
  "RETURN",
  "RELEASE",
  "MERGE",
  "CANCEL",
]);

export class StatementParser {
  private readonly cursor: Cursor;

  public constructor(cursor: Cursor) {
    this.cursor = cursor;
  }

  /* -------------------------------------------------- paragraphs */

  /**
   * Splits the division into paragraphs.
   *
   * A word in Area A followed by a period starts one. Statements before the
   * first such name belong to an unnamed leading paragraph, which the generated
   * programs never have but hand-written COBOL does.
   */
  public paragraphs(): Division {
    const result: Paragraph[] = [];
    const declaratives: UseProcedure[] = [];
    let current: Paragraph = { name: "", index: 0, statements: [] };
    result.push(current);

    const open = (name: string): void => {
      current = { name, index: result.length, statements: [] };
      result.push(current);
    };

    // DECLARATIVES comes first when it comes at all, and its sections are not
    // part of the fall-through flow: control reaches them only through a failed
    // I/O statement.
    if (
      this.cursor.looksLike("DECLARATIVES") &&
      this.cursor.peek(1).kind === "period"
    ) {
      this.cursor.next();
      this.cursor.next();
      let section: { file: string; from: number } | null = null;
      const close = (): void => {
        if (section) {
          declaratives.push({
            file: section.file,
            from: section.from,
            thru: result.length - 1,
          });
          section = null;
        }
      };

      while (
        !this.cursor.done &&
        !this.cursor.looksLike("END", "DECLARATIVES")
      ) {
        const header = this.paragraphHeader();
        if (header !== null) {
          open(header);
          if (this.cursor.accept("USE")) {
            this.cursor.skipNoise(
              "AFTER",
              "STANDARD",
              "ERROR",
              "EXCEPTION",
              "PROCEDURE",
              "ON",
              "GLOBAL",
            );
            close();
            section = { file: this.cursor.word(), from: current.index };
            this.cursor.acceptPeriod();
          }
          continue;
        }
        const statement = this.statement();
        if (statement) {
          current.statements.push(statement);
        }
      }
      close();
      this.cursor.expect("END", "DECLARATIVES");
      this.cursor.acceptPeriod();
    }

    while (!this.cursor.done) {
      if (this.cursor.looksLike("END", "PROGRAM")) {
        break;
      }
      const header = this.paragraphHeader();
      if (header !== null) {
        open(header);
        continue;
      }
      const statement = this.statement();
      if (statement) {
        current.statements.push(statement);
      }
    }

    // An empty unnamed leading paragraph is noise in a trace; drop it. Indices
    // are rewritten so the declarative ranges keep pointing at their sections.
    if (
      result[0]!.statements.length === 0 &&
      result.length > 1 &&
      declaratives.length === 0
    ) {
      return {
        paragraphs: result
          .slice(1)
          .map((paragraph, index) => ({ ...paragraph, index })),
        declaratives,
      };
    }
    return { paragraphs: result, declaratives };
  }

  /** Consumes and returns a paragraph or section name, or null. */
  private paragraphHeader(): string | null {
    const token = this.cursor.peek();
    if (token.kind !== "word" || token.column > AREA_A_END) {
      return null;
    }
    // `NAME.` or `NAME SECTION.`
    if (this.cursor.peek(1).kind === "period") {
      this.cursor.next();
      this.cursor.next();
      return token.text;
    }
    if (
      this.cursor.peek(1).kind === "word" &&
      this.cursor.peek(1).text === "SECTION" &&
      this.cursor.peek(2).kind === "period"
    ) {
      this.cursor.next();
      this.cursor.next();
      this.cursor.next();
      return token.text;
    }
    return null;
  }

  /* -------------------------------------------------- statements */

  /** A list of statements, ending at a terminator, a period, or a paragraph. */
  public statements(): Statement[] {
    const list: Statement[] = [];
    for (;;) {
      if (this.cursor.done) {
        return list;
      }
      if (this.cursor.acceptPeriod()) {
        return list;
      }
      const token = this.cursor.peek();
      if (
        token.kind === "word" &&
        TERMINATORS.has(token.text) &&
        !VERBS.has(token.text)
      ) {
        return list;
      }
      if (
        token.kind === "word" &&
        token.column <= AREA_A_END &&
        !VERBS.has(token.text)
      ) {
        return list;
      }
      const statement = this.statement();
      if (statement) {
        list.push(statement);
      }
    }
  }

  private statement(): Statement | null {
    if (this.cursor.acceptPeriod()) {
      return null;
    }
    const token = this.cursor.peek();
    const line = token.line;
    if (token.kind !== "word") {
      throw new CobolSyntaxError(
        `Line ${String(line)}: expected a statement, found ${token.text}.`,
      );
    }

    switch (token.text) {
      case "MOVE":
        return this.move();
      case "COMPUTE":
        return this.compute();
      case "ADD":
      case "SUBTRACT":
      case "MULTIPLY":
      case "DIVIDE":
        return this.arithmetic();
      case "IF":
        return this.ifStatement();
      case "EVALUATE":
        return this.evaluate();
      case "PERFORM":
        return this.perform();
      case "GO":
        this.cursor.expect("GO");
        this.cursor.skipNoise("TO");
        return { kind: "goto", target: this.cursor.word(), line };
      case "CALL":
        return this.call();
      case "DISPLAY":
        return this.display();
      case "OPEN":
        return this.open();
      case "CLOSE":
        return this.close();
      case "READ":
        return this.read();
      case "WRITE":
      case "REWRITE":
        return this.write();
      case "START":
        return this.start();
      case "SET":
        return this.set();
      case "STRING":
        return this.stringStatement();
      case "UNSTRING":
        return this.unstring();
      case "INSPECT":
        return this.inspect();
      case "INITIALIZE": {
        this.cursor.expect("INITIALIZE");
        const targets = [this.reference()];
        while (this.startsReference()) {
          targets.push(this.reference());
        }
        return { kind: "initialize", targets, line };
      }
      case "CONTINUE":
        this.cursor.expect("CONTINUE");
        return { kind: "continue", line };
      case "EXIT": {
        this.cursor.expect("EXIT");
        if (this.cursor.accept("PERFORM")) {
          return { kind: "exit", what: "perform", line };
        }
        if (this.cursor.accept("PROGRAM")) {
          return { kind: "exit", what: "program", line };
        }
        // `EXIT PARAGRAPH` and `EXIT SECTION` leave the current one without
        // ending the program; a bare `EXIT` is the no-op that marks the end of
        // a performed range, which the emitter writes for every function.
        this.cursor.accept("PARAGRAPH");
        this.cursor.accept("SECTION");
        return { kind: "exit", what: "paragraph", line };
      }
      case "GOBACK":
        this.cursor.expect("GOBACK");
        return { kind: "goback", line };
      case "STOP":
        this.cursor.expect("STOP");
        this.cursor.expect("RUN");
        return { kind: "stop-run", line };
      default:
        throw new CobolUnsupportedError(
          `Line ${String(line)}: ${token.text} is not a statement this interpreter implements.`,
        );
    }
  }

  private move(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("MOVE");
    const from = this.expression();
    this.cursor.expect("TO");
    const to = [this.reference()];
    while (this.startsReference()) {
      to.push(this.reference());
    }
    return { kind: "move", from, to, line };
  }

  private compute(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("COMPUTE");
    const targets: { ref: Reference; rounded: boolean }[] = [];
    for (;;) {
      const ref = this.reference();
      const rounded = this.cursor.accept("ROUNDED");
      targets.push({ ref, rounded });
      if (this.cursor.acceptPunct("=") || this.cursor.accept("EQUALS")) {
        break;
      }
    }
    const value = this.expression();
    const { onSizeError, notOnSizeError } = this.sizeErrorClauses();
    this.cursor.accept("END-COMPUTE");
    return {
      kind: "compute",
      targets,
      value,
      onSizeError,
      notOnSizeError,
      line,
    };
  }

  private sizeErrorClauses(): {
    onSizeError: Statement[] | null;
    notOnSizeError: Statement[] | null;
  } {
    let onSizeError: Statement[] | null = null;
    let notOnSizeError: Statement[] | null = null;
    for (;;) {
      if (
        this.cursor.accept("ON", "SIZE", "ERROR") ||
        this.cursor.accept("SIZE", "ERROR")
      ) {
        onSizeError = this.statements();
        continue;
      }
      if (
        this.cursor.accept("NOT", "ON", "SIZE", "ERROR") ||
        this.cursor.accept("NOT", "SIZE", "ERROR")
      ) {
        notOnSizeError = this.statements();
        continue;
      }
      return { onSizeError, notOnSizeError };
    }
  }

  /**
   * `ADD`, `SUBTRACT`, `MULTIPLY` and `DIVIDE`.
   *
   * The joining word is not decoration: `DIVIDE A INTO B` and `DIVIDE A BY B`
   * compute reciprocal things, and `ADD A TO B` writes B where
   * `ADD A TO B GIVING C` leaves B untouched. All of it is kept and settled in
   * `machine.ts`, where the direction is one `switch` rather than four parsers.
   */
  private arithmetic(): Statement {
    const line = this.cursor.line;
    const verb = this.cursor.word() as
      "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE";

    const JOINERS = ["TO", "FROM", "BY", "INTO"] as const;
    const isJoiner = (): boolean =>
      this.cursor.peek().kind === "word" &&
      (JOINERS as readonly string[]).includes(this.cursor.peek().text);

    const operands: Expr[] = [];
    while (
      !isJoiner() &&
      !this.cursor.looksLike("GIVING") &&
      this.startsExpression()
    ) {
      operands.push(this.expression());
    }

    let joiner: "TO" | "FROM" | "BY" | "INTO" | null = null;
    const rhs: { ref: Reference; rounded: boolean }[] = [];
    if (isJoiner()) {
      joiner = this.cursor.word() as "TO" | "FROM" | "BY" | "INTO";
      while (this.startsReference()) {
        const ref = this.reference();
        rhs.push({ ref, rounded: this.cursor.accept("ROUNDED") });
      }
    }

    const giving: { ref: Reference; rounded: boolean }[] = [];
    if (this.cursor.accept("GIVING")) {
      while (this.startsReference()) {
        const ref = this.reference();
        giving.push({ ref, rounded: this.cursor.accept("ROUNDED") });
      }
    }

    const remainder = this.cursor.accept("REMAINDER") ? this.reference() : null;
    const { onSizeError } = this.sizeErrorClauses();
    this.cursor.accept(`END-${verb}`);

    return {
      kind: "arith",
      verb,
      operands,
      joiner,
      rhs,
      giving,
      remainder,
      onSizeError,
      line,
    };
  }

  private ifStatement(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("IF");
    const condition = this.condition();
    this.cursor.skipNoise("THEN");
    const then = this.statements();
    let otherwise: Statement[] = [];
    if (this.cursor.accept("ELSE")) {
      otherwise = this.statements();
    }
    this.cursor.accept("END-IF");
    return { kind: "if", condition, then, otherwise, line };
  }

  private evaluate(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("EVALUATE");
    const subject: Expr | { kind: "true" } = this.cursor.accept("TRUE")
      ? { kind: "true" }
      : this.expression();

    const branches: {
      whens: (Cond | { kind: "other" })[];
      body: Statement[];
    }[] = [];

    while (this.cursor.accept("WHEN")) {
      const whens: (Cond | { kind: "other" })[] = [];
      if (this.cursor.accept("OTHER")) {
        whens.push({ kind: "other" });
      } else {
        whens.push(this.whenSubject(subject));
      }
      while (this.cursor.accept("WHEN")) {
        if (this.cursor.accept("OTHER")) {
          whens.push({ kind: "other" });
        } else {
          whens.push(this.whenSubject(subject));
        }
      }
      branches.push({ whens, body: this.statements() });
    }

    this.cursor.accept("END-EVALUATE");
    return { kind: "evaluate", subject, branches, line };
  }

  /**
   * A `WHEN` object, which means different things depending on the subject.
   *
   * `EVALUATE TRUE / WHEN cond` is a condition; `EVALUATE X / WHEN "A"` is an
   * implied equality against X. Both appear in generated code, and reading the
   * second as a condition would compare a literal against nothing.
   */
  private whenSubject(subject: Expr | { kind: "true" }): Cond {
    if ("kind" in subject && subject.kind === "true") {
      return this.condition();
    }
    const value = this.expression();
    if (this.cursor.accept("THRU") || this.cursor.accept("THROUGH")) {
      const upper = this.expression();
      return {
        kind: "and",
        left: { kind: "relation", left: subject, op: ">=", right: value },
        right: { kind: "relation", left: subject, op: "<=", right: upper },
      };
    }
    return { kind: "relation", left: subject, op: "=", right: value };
  }

  private perform(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("PERFORM");

    let target: { from: string; thru: string | null } | null = null;
    // A name here is a paragraph; anything else starts an inline PERFORM.
    if (
      this.cursor.peek().kind === "word" &&
      !["UNTIL", "VARYING", "WITH", "TEST"].includes(this.cursor.peek().text) &&
      !this.isCountFollowedByTimes()
    ) {
      const from = this.cursor.word();
      const thru =
        this.cursor.accept("THRU") || this.cursor.accept("THROUGH")
          ? this.cursor.word()
          : null;
      target = { from, thru };
    }

    let times: Expr | null = null;
    if (!target && this.isCountFollowedByTimes()) {
      times = this.expression();
      this.cursor.expect("TIMES");
    } else if (target && this.cursor.peek().kind === "number") {
      times = this.expression();
      this.cursor.expect("TIMES");
    }

    let testAfter = false;
    if (
      this.cursor.accept("WITH", "TEST", "AFTER") ||
      this.cursor.accept("TEST", "AFTER")
    ) {
      testAfter = true;
    } else {
      this.cursor.accept("WITH", "TEST", "BEFORE");
      this.cursor.accept("TEST", "BEFORE");
    }

    let until: Cond | null = null;
    let varying: {
      ref: Reference;
      from: Expr;
      by: Expr;
      until: Cond;
    } | null = null;

    if (this.cursor.accept("VARYING")) {
      const ref = this.reference();
      this.cursor.expect("FROM");
      const from = this.expression();
      this.cursor.expect("BY");
      const by = this.expression();
      this.cursor.expect("UNTIL");
      varying = { ref, from, by, until: this.condition() };
    } else if (this.cursor.accept("UNTIL")) {
      until = this.condition();
    }

    const body = target === null ? this.statements() : null;
    if (body !== null) {
      this.cursor.accept("END-PERFORM");
    }

    return {
      kind: "perform",
      target,
      times,
      until,
      testAfter,
      varying,
      body,
      line,
    };
  }

  /** `PERFORM 3 TIMES` against `PERFORM PARA`: only the first has a number. */
  private isCountFollowedByTimes(): boolean {
    return this.cursor.peek().kind === "number";
  }

  private call(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("CALL");
    const program = this.expression();
    const using: { by: "reference" | "content"; value: Expr }[] = [];
    if (this.cursor.accept("USING")) {
      let by: "reference" | "content" = "reference";
      for (;;) {
        if (
          this.cursor.accept("BY", "REFERENCE") ||
          this.cursor.accept("REFERENCE")
        ) {
          by = "reference";
          continue;
        }
        if (
          this.cursor.accept("BY", "CONTENT") ||
          this.cursor.accept("CONTENT")
        ) {
          by = "content";
          continue;
        }
        if (!this.startsReference() && this.cursor.peek().kind !== "string") {
          break;
        }
        using.push({ by, value: this.expression() });
      }
    }
    this.cursor.accept("END-CALL");
    return { kind: "call", program, using, line };
  }

  private display(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("DISPLAY");
    const items: DisplayItem[] = [];
    while (this.startsExpression() && !this.cursor.looksLike("UPON")) {
      items.push({ value: this.expression() });
    }
    const upon = this.cursor.accept("UPON") ? this.cursor.word() : null;
    this.cursor.accept("WITH", "NO", "ADVANCING");
    return { kind: "display", items, upon, line };
  }

  private open(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("OPEN");
    const files: {
      mode: "INPUT" | "OUTPUT" | "I-O" | "EXTEND";
      name: string;
    }[] = [];
    let mode: "INPUT" | "OUTPUT" | "I-O" | "EXTEND" | null = null;
    for (;;) {
      const token = this.cursor.peek();
      if (token.kind !== "word") {
        break;
      }
      if (["INPUT", "OUTPUT", "I-O", "EXTEND"].includes(token.text)) {
        mode = this.cursor.word() as "INPUT" | "OUTPUT" | "I-O" | "EXTEND";
        continue;
      }
      if (mode === null) {
        break;
      }
      if (
        TERMINATORS.has(token.text) ||
        VERBS.has(token.text) ||
        token.column <= AREA_A_END
      ) {
        break;
      }
      files.push({ mode, name: this.cursor.word() });
    }
    if (files.length === 0) {
      throw new CobolSyntaxError(`Line ${String(line)}: OPEN names no file.`);
    }
    return { kind: "open", files, line };
  }

  private close(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("CLOSE");
    const files: string[] = [];
    while (
      this.cursor.peek().kind === "word" &&
      !TERMINATORS.has(this.cursor.peek().text) &&
      !VERBS.has(this.cursor.peek().text) &&
      this.cursor.peek().column > AREA_A_END
    ) {
      files.push(this.cursor.word());
    }
    return { kind: "close", files, line };
  }

  private read(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("READ");
    const file = this.cursor.word();
    const next = this.cursor.accept("NEXT") || this.cursor.accept("PREVIOUS");
    this.cursor.skipNoise("RECORD");
    const into = this.cursor.accept("INTO") ? this.reference() : null;
    const key = this.cursor.accept("KEY")
      ? (this.cursor.skipNoise("IS"), this.reference())
      : null;

    let atEnd: Statement[] | null = null;
    let notAtEnd: Statement[] | null = null;
    let invalidKey: Statement[] | null = null;
    let notInvalidKey: Statement[] | null = null;

    for (;;) {
      if (this.cursor.accept("AT", "END") || this.cursor.accept("END")) {
        atEnd = this.statements();
        continue;
      }
      if (this.cursor.accept("NOT", "AT", "END")) {
        notAtEnd = this.statements();
        continue;
      }
      if (
        this.cursor.accept("INVALID", "KEY") ||
        this.cursor.accept("INVALID")
      ) {
        invalidKey = this.statements();
        continue;
      }
      if (this.cursor.accept("NOT", "INVALID", "KEY")) {
        notInvalidKey = this.statements();
        continue;
      }
      break;
    }
    this.cursor.accept("END-READ");

    return {
      kind: "read",
      file,
      next,
      into,
      key,
      atEnd,
      notAtEnd,
      invalidKey,
      notInvalidKey,
      line,
    };
  }

  /**
   * `INSPECT X REPLACING ALL a BY b`.
   *
   * `runtime/BANKJSON.cbl` uses it to turn the underscores of a JSON name into
   * the hyphens of a COBOL one, and that is the only form here. `TALLYING`,
   * `CONVERTING`, and the `BEFORE`/`AFTER` phrases raise rather than being
   * approximated: an INSPECT that silently does less than it says leaves a
   * record half-translated and no error anywhere.
   */
  private inspect(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("INSPECT");
    const target = this.reference();
    if (!this.cursor.accept("REPLACING")) {
      throw new CobolUnsupportedError(
        `Line ${String(line)}: only INSPECT ... REPLACING is implemented.`,
      );
    }
    const replacements: { from: Expr; to: Expr }[] = [];
    while (this.cursor.accept("ALL") || this.cursor.accept("FIRST")) {
      const from = this.expression();
      this.cursor.expect("BY");
      replacements.push({ from, to: this.expression() });
      if (this.cursor.looksLike("BEFORE") || this.cursor.looksLike("AFTER")) {
        throw new CobolUnsupportedError(
          `Line ${String(line)}: INSPECT with BEFORE or AFTER is not implemented.`,
        );
      }
    }
    if (replacements.length === 0) {
      throw new CobolUnsupportedError(
        `Line ${String(line)}: only INSPECT ... REPLACING ALL and FIRST are implemented.`,
      );
    }
    return { kind: "inspect", target, replacements, line };
  }

  private write(): Statement {
    const line = this.cursor.line;
    const verb = this.cursor.word();
    const record = this.reference();
    const from = this.cursor.accept("FROM") ? this.expression() : null;

    // The ADVANCING phrase is printer control, and its operand has to be
    // consumed whatever it is: `AFTER ADVANCING PAGE`, `AFTER ADVANCING 2
    // LINES`, or a mnemonic. Leaving `PAGE` in the stream made it the next
    // statement.
    let advancing: Expr | "page" | null = null;
    if (
      this.cursor.accept("AFTER", "ADVANCING") ||
      this.cursor.accept("BEFORE", "ADVANCING") ||
      this.cursor.accept("AFTER") ||
      this.cursor.accept("BEFORE")
    ) {
      this.cursor.accept("ADVANCING");
      if (this.cursor.accept("PAGE")) {
        advancing = "page";
      } else {
        advancing = this.expression();
        this.cursor.skipNoise("LINE", "LINES");
      }
    }

    let invalidKey: Statement[] | null = null;
    let endOfPage: Statement[] | null = null;
    for (;;) {
      if (
        this.cursor.accept("INVALID", "KEY") ||
        this.cursor.accept("INVALID")
      ) {
        invalidKey = this.statements();
        continue;
      }
      if (
        this.cursor.accept("AT", "END-OF-PAGE") ||
        this.cursor.accept("END-OF-PAGE") ||
        this.cursor.accept("AT", "EOP") ||
        this.cursor.accept("EOP")
      ) {
        endOfPage = this.statements();
        continue;
      }
      if (
        this.cursor.accept("NOT", "AT", "END-OF-PAGE") ||
        this.cursor.accept("NOT", "END-OF-PAGE")
      ) {
        this.statements();
        continue;
      }
      break;
    }
    this.cursor.accept(`END-${verb}`);
    return verb === "WRITE"
      ? { kind: "write", record, from, advancing, endOfPage, invalidKey, line }
      : { kind: "rewrite", record, from, invalidKey, line };
  }

  private start(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("START");
    const file = this.cursor.word();
    let key: Reference | null = null;
    let op: RelOp = "=";
    if (this.cursor.accept("KEY")) {
      this.cursor.skipNoise("IS");
      op = this.relationOperator();
      key = this.reference();
    }
    let invalidKey: Statement[] | null = null;
    if (this.cursor.accept("INVALID", "KEY") || this.cursor.accept("INVALID")) {
      invalidKey = this.statements();
    }
    this.cursor.accept("END-START");
    return { kind: "start", file, key, op, invalidKey, line };
  }

  private set(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("SET");

    if (this.cursor.accept("ADDRESS")) {
      this.cursor.skipNoise("OF");
      const target = this.reference();
      this.cursor.expect("TO");
      this.cursor.expect("ADDRESS");
      this.cursor.skipNoise("OF");
      return { kind: "set-address", target, source: this.reference(), line };
    }

    const targets = [this.reference()];
    while (this.startsReference() && !this.cursor.looksLike("TO")) {
      targets.push(this.reference());
    }
    this.cursor.expect("TO");
    if (this.cursor.accept("TRUE")) {
      return { kind: "set-condition", targets, line };
    }
    if (this.cursor.accept("FALSE")) {
      throw new CobolUnsupportedError(
        `Line ${String(line)}: SET ... TO FALSE needs a FALSE phrase on the condition, which this interpreter does not implement.`,
      );
    }
    return { kind: "set", targets, value: this.expression(), line };
  }

  private stringStatement(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("STRING");
    const sources: { value: Expr; delimiter: Expr | "SIZE" }[] = [];
    while (!this.cursor.looksLike("INTO")) {
      const value = this.expression();
      let delimiter: Expr | "SIZE" = "SIZE";
      if (this.cursor.accept("DELIMITED")) {
        this.cursor.skipNoise("BY");
        delimiter = this.cursor.accept("SIZE") ? "SIZE" : this.expression();
      }
      sources.push({ value, delimiter });
    }
    this.cursor.expect("INTO");
    const into = this.reference();
    const pointer = this.cursor.accept("WITH", "POINTER")
      ? this.reference()
      : null;
    let overflow: Statement[] | null = null;
    if (
      this.cursor.accept("ON", "OVERFLOW") ||
      this.cursor.accept("OVERFLOW")
    ) {
      overflow = this.statements();
    }
    this.cursor.accept("END-STRING");
    return { kind: "string", sources, into, pointer, overflow, line };
  }

  /**
   * `UNSTRING source DELIMITED BY d INTO a b c`.
   *
   * Enterprise COBOL allows a great deal more than this — several delimiters
   * joined by OR, `ALL` to collapse runs, `WITH POINTER` to start part way in,
   * `TALLYING` to count the fields found. None of it is accepted here, because
   * none of it is emitted: `packages/cobol-backend` lowers BankTS's `split` to
   * exactly one delimiter and a list of receivers. Accepting a form and
   * approximating it would make this interpreter agree with `cobc` about
   * programs it does not really understand, which is worth less than nothing.
   */
  private unstring(): Statement {
    const line = this.cursor.line;
    this.cursor.expect("UNSTRING");
    const source = this.expression();

    this.cursor.expect("DELIMITED");
    this.cursor.skipNoise("BY");
    if (this.cursor.looksLike("ALL")) {
      throw new CobolUnsupportedError(
        `Line ${String(line)}: UNSTRING ... DELIMITED BY ALL is not implemented.`,
      );
    }
    const delimiter = this.expression();
    if (this.cursor.looksLike("OR")) {
      throw new CobolUnsupportedError(
        `Line ${String(line)}: UNSTRING with more than one delimiter is not implemented.`,
      );
    }

    this.cursor.expect("INTO");
    const into = [this.reference()];
    while (this.startsReference()) {
      into.push(this.reference());
    }
    if (this.cursor.looksLike("DELIMITER") || this.cursor.looksLike("COUNT")) {
      throw new CobolUnsupportedError(
        `Line ${String(line)}: UNSTRING with DELIMITER IN or COUNT IN is not implemented.`,
      );
    }
    if (this.cursor.looksLike("WITH") || this.cursor.looksLike("POINTER")) {
      throw new CobolUnsupportedError(
        `Line ${String(line)}: UNSTRING ... WITH POINTER is not implemented.`,
      );
    }
    if (this.cursor.looksLike("TALLYING")) {
      throw new CobolUnsupportedError(
        `Line ${String(line)}: UNSTRING ... TALLYING is not implemented.`,
      );
    }

    let overflow: Statement[] | null = null;
    if (
      this.cursor.accept("ON", "OVERFLOW") ||
      this.cursor.accept("OVERFLOW")
    ) {
      overflow = this.statements();
    }
    this.cursor.accept("END-UNSTRING");
    return { kind: "unstring", source, delimiter, into, overflow, line };
  }

  /* -------------------------------------------------- conditions */

  public condition(): Cond {
    return this.orCondition();
  }

  private orCondition(): Cond {
    let left = this.andCondition();
    while (this.cursor.accept("OR")) {
      left = { kind: "or", left, right: this.andCondition() };
    }
    return left;
  }

  private andCondition(): Cond {
    let left = this.notCondition();
    while (this.cursor.accept("AND")) {
      left = { kind: "and", left, right: this.notCondition() };
    }
    return left;
  }

  private notCondition(): Cond {
    if (this.cursor.accept("NOT")) {
      return { kind: "not", operand: this.notCondition() };
    }
    return this.primaryCondition();
  }

  private primaryCondition(): Cond {
    // A parenthesised condition, told from a parenthesised expression by
    // whether a relation operator follows the closing bracket.
    if (
      this.cursor.peek().kind === "punct" &&
      this.cursor.peek().text === "("
    ) {
      const mark = this.cursor.position;
      this.cursor.next();
      try {
        const inner = this.condition();
        if (this.cursor.acceptPunct(")") && !this.startsRelation()) {
          return inner;
        }
      } catch {
        /* Not a condition; fall through and read it as an expression. */
      }
      this.cursor.position = mark;
    }

    const left = this.expression();

    // `IS` and `NOT` are both optional and both may precede either a relation
    // or a class test: `A NOT = B`, `A IS NOT NUMERIC`, `A IS NOT LESS THAN B`.
    // They are consumed once here so the three forms below do not each have to
    // spell out four spellings.
    const mark = this.cursor.position;
    this.cursor.accept("IS");
    const negated = this.cursor.accept("NOT");
    const wrap = (condition: Cond): Cond =>
      negated ? { kind: "not", operand: condition } : condition;

    if (this.cursor.accept("NUMERIC")) {
      return wrap({ kind: "class", operand: left, test: "NUMERIC" });
    }
    if (this.cursor.accept("ALPHABETIC")) {
      return wrap({ kind: "class", operand: left, test: "ALPHABETIC" });
    }
    if (this.cursor.accept("POSITIVE")) {
      return wrap({ kind: "sign", operand: left, test: "POSITIVE" });
    }
    if (this.cursor.accept("NEGATIVE")) {
      return wrap({ kind: "sign", operand: left, test: "NEGATIVE" });
    }
    if (this.cursor.accept("ZERO") || this.cursor.accept("ZEROS")) {
      return wrap({ kind: "sign", operand: left, test: "ZERO" });
    }
    if (this.startsRelation()) {
      const op = this.relationOperator();
      const right = this.expression();
      return wrap({ kind: "relation", left, op, right });
    }

    // Neither, so the `IS`/`NOT` belonged to something else — an abbreviated
    // combined relation, or the end of this condition. Give them back.
    this.cursor.position = mark;

    // A bare name is a condition name — an 88 level.
    if (left.kind === "ref") {
      return { kind: "condition-name", ref: left.ref };
    }

    throw new CobolSyntaxError(
      `Line ${String(this.cursor.line)}: not a condition.`,
    );
  }

  private startsRelation(): boolean {
    const token = this.cursor.peek();
    if (token.kind === "punct") {
      return ["=", ">", "<", ">=", "<=", "<>"].includes(token.text);
    }
    if (token.kind !== "word") {
      return false;
    }
    if (token.text === "IS") {
      const after = this.cursor.peek(1);
      return (
        (after.kind === "punct" &&
          ["=", ">", "<", ">=", "<=", "<>"].includes(after.text)) ||
        (after.kind === "word" &&
          ["EQUAL", "GREATER", "LESS", "NOT"].includes(after.text))
      );
    }
    return ["EQUAL", "GREATER", "LESS"].includes(token.text);
  }

  private relationOperator(): RelOp {
    this.cursor.skipNoise("IS");
    const negated = this.cursor.accept("NOT");

    let op: RelOp;
    if (this.cursor.acceptPunct(">=")) {
      op = ">=";
    } else if (this.cursor.acceptPunct("<=")) {
      op = "<=";
    } else if (this.cursor.acceptPunct("<>")) {
      op = "<>";
    } else if (this.cursor.acceptPunct("=")) {
      op = "=";
    } else if (this.cursor.acceptPunct(">")) {
      op = ">";
    } else if (this.cursor.acceptPunct("<")) {
      op = "<";
    } else if (this.cursor.accept("EQUAL")) {
      this.cursor.skipNoise("TO");
      op = "=";
    } else if (this.cursor.accept("GREATER")) {
      this.cursor.skipNoise("THAN");
      op = this.cursor.accept("OR", "EQUAL")
        ? (this.cursor.skipNoise("TO"), ">=")
        : ">";
    } else if (this.cursor.accept("LESS")) {
      this.cursor.skipNoise("THAN");
      op = this.cursor.accept("OR", "EQUAL")
        ? (this.cursor.skipNoise("TO"), "<=")
        : "<";
    } else {
      throw new CobolSyntaxError(
        `Line ${String(this.cursor.line)}: expected a relational operator.`,
      );
    }

    if (!negated) {
      return op;
    }
    const inverted: Record<RelOp, RelOp> = {
      "=": "<>",
      "<>": "=",
      "<": ">=",
      ">": "<=",
      "<=": ">",
      ">=": "<",
    };
    return inverted[op];
  }

  /* -------------------------------------------------- expressions */

  public expression(): Expr {
    return this.additive();
  }

  private additive(): Expr {
    let left = this.multiplicative();
    for (;;) {
      // `A - B` is arithmetic; `A -B` cannot occur because the tokenizer only
      // produces a `-` operator when it is surrounded by separators.
      if (this.cursor.acceptPunct("+")) {
        left = { kind: "binary", op: "+", left, right: this.multiplicative() };
        continue;
      }
      if (this.cursor.acceptPunct("-")) {
        left = { kind: "binary", op: "-", left, right: this.multiplicative() };
        continue;
      }
      return left;
    }
  }

  private multiplicative(): Expr {
    let left = this.power();
    for (;;) {
      if (this.cursor.acceptPunct("*")) {
        left = { kind: "binary", op: "*", left, right: this.power() };
        continue;
      }
      if (this.cursor.acceptPunct("/")) {
        left = { kind: "binary", op: "/", left, right: this.power() };
        continue;
      }
      return left;
    }
  }

  private power(): Expr {
    const left = this.unary();
    if (this.cursor.acceptPunct("**")) {
      return { kind: "binary", op: "**", left, right: this.power() };
    }
    return left;
  }

  private unary(): Expr {
    if (this.cursor.acceptPunct("-")) {
      return { kind: "unary", op: "-", operand: this.unary() };
    }
    if (this.cursor.acceptPunct("+")) {
      return this.unary();
    }
    return this.primary();
  }

  private primary(): Expr {
    const token = this.cursor.peek();

    if (this.cursor.acceptPunct("(")) {
      const inner = this.expression();
      this.cursor.expectPunct(")");
      return inner;
    }

    if (token.kind === "number") {
      this.cursor.next();
      return { kind: "number", text: token.text };
    }

    if (token.kind === "string") {
      this.cursor.next();
      return { kind: "string", value: token.value ?? "" };
    }

    if (token.kind !== "word") {
      throw new CobolSyntaxError(
        `Line ${String(token.line)}: expected a value, found ${token.text}.`,
      );
    }

    if (this.cursor.accept("FUNCTION")) {
      const name = this.cursor.word();
      const args: Expr[] = [];
      if (this.cursor.acceptPunct("(")) {
        if (!this.cursor.acceptPunct(")")) {
          args.push(this.expression());
          while (this.cursor.acceptPunct(",") || this.startsExpression()) {
            args.push(this.expression());
          }
          this.cursor.expectPunct(")");
        }
      }
      return { kind: "function", name, args, line: token.line };
    }

    if (this.cursor.accept("ALL")) {
      const literal = this.cursor.next();
      return { kind: "all", value: literal.value ?? literal.text };
    }

    if (this.cursor.accept("ADDRESS")) {
      this.cursor.skipNoise("OF");
      return { kind: "address", ref: this.reference() };
    }

    // `LENGTH OF X` is the special register, not a data name. Only the `OF`
    // form is treated as one, so a program that declares a field called LENGTH
    // still resolves to its own field.
    if (this.cursor.looksLike("LENGTH", "OF")) {
      this.cursor.expect("LENGTH", "OF");
      return {
        kind: "function",
        name: "LENGTH",
        args: [{ kind: "ref", ref: this.reference() }],
        line: token.line,
      };
    }

    const figurative: Record<string, Figurative> = {
      SPACE: "SPACES",
      SPACES: "SPACES",
      ZERO: "ZEROS",
      ZEROS: "ZEROS",
      ZEROES: "ZEROS",
      "HIGH-VALUE": "HIGH-VALUES",
      "HIGH-VALUES": "HIGH-VALUES",
      "LOW-VALUE": "LOW-VALUES",
      "LOW-VALUES": "LOW-VALUES",
      QUOTE: "QUOTES",
      QUOTES: "QUOTES",
      NULL: "NULL",
      NULLS: "NULL",
    };
    const known = figurative[token.text];
    if (known) {
      this.cursor.next();
      return { kind: "figurative", value: known };
    }

    return { kind: "ref", ref: this.reference() };
  }

  public reference(): Reference {
    const token = this.cursor.peek();
    const name = this.cursor.word();
    const qualifiers: string[] = [];
    while (this.cursor.accept("OF") || this.cursor.accept("IN")) {
      qualifiers.push(this.cursor.word());
    }

    const subscripts: Expr[] = [];
    let refmod: Reference["refmod"] = null;

    if (
      this.cursor.peek().kind === "punct" &&
      this.cursor.peek().text === "("
    ) {
      const mark = this.cursor.position;
      this.cursor.next();
      const first = this.expression();
      if (this.cursor.acceptPunct(":")) {
        const length = this.cursor.acceptPunct(")")
          ? null
          : (() => {
              const value = this.expression();
              this.cursor.expectPunct(")");
              return value;
            })();
        refmod = { from: first, length };
      } else {
        subscripts.push(first);
        while (this.cursor.acceptPunct(",") || !this.cursor.acceptPunct(")")) {
          if (this.cursor.done) {
            this.cursor.position = mark;
            throw new CobolSyntaxError(
              `Line ${String(token.line)}: unclosed subscript on ${name}.`,
            );
          }
          subscripts.push(this.expression());
          if (this.cursor.acceptPunct(")")) {
            break;
          }
        }
      }
    }

    return { name, qualifiers, subscripts, refmod, line: token.line };
  }

  /** True when the next token could begin a reference. */
  private startsReference(): boolean {
    const token = this.cursor.peek();
    return (
      token.kind === "word" &&
      !TERMINATORS.has(token.text) &&
      !VERBS.has(token.text) &&
      token.column > AREA_A_END
    );
  }

  private startsExpression(): boolean {
    const token = this.cursor.peek();
    if (token.kind === "number" || token.kind === "string") {
      return true;
    }
    if (token.kind === "punct") {
      return token.text === "(";
    }
    return this.startsReference() || token.text === "FUNCTION";
  }
}
