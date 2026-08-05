import {
  astToJson,
  createDiagnostic,
  type BlockNode,
  type BooleanLiteralNode,
  type CursorLoopStatementNode,
  type BinaryExpressionNode,
  type DeclarationNode,
  type DecimalLiteralNode,
  type DecimalTypeNode,
  type Diagnostic,
  type ExpressionNode,
  type FieldDeclarationNode,
  type FunctionDeclarationNode,
  type IdentifierNode,
  type ModuleDeclarationNode,
  type ParsedProgram,
  type LetStatementNode,
  type ParameterNode,
  type ProgramNode,
  type RecordDeclarationNode,
  type ReturnStatementNode,
  type SourcePosition,
  type SourceSpan,
  type StringTypeNode,
  type EditedTypeNode,
  type StringCallNode,
  type TemporalCallNode,
  type TemporalTypeNode,
  type ReturnCodeStatementNode,
  type SearchStatementNode,
  type CheckpointStatementNode,
  type SortStatementNode,
  type SplitStatementNode,
  type UnitOfWorkStatementNode,
  type TypeAliasDeclarationNode,
  type TypeNode,
  type TypeReferenceNode,
  type BoolTypeNode,
  type StatementNode,
  type IfStatementNode,
  type StringLiteralNode,
  type MemberAccessNode,
  type LedgerStatementNode,
  type AuditStatementNode,
  type TransactionDeclarationNode,
  type FileDeclarationNode,
  type CommentTrivia,
  type BinaryOperator,
  type ComparisonOperator,
  type UnaryExpressionNode,
  type RoundedExpressionNode,
  type RoundingMode,
  type CallExpressionNode,
  type WhileStatementNode,
  type AssignStatementNode,
  type ExpressionStatementNode,
  type FileStatementNode,
  type CurrencyTypeNode,
  type NullableTypeNode,
  type ArrayTypeNode,
  type TypeParameterNode,
  type RaiseStatementNode,
  type FailureHandlerNode,
  type EnumDeclarationNode,
  type EnumMemberNode,
  type IndexAccessNode,
  type NullableCheckNode,
  type SwitchStatementNode,
  type SwitchCaseNode,
  type FileOrganization,
  type SqlDeclarationNode,
  type SqlStatementNode,
  type CicsStatementNode,
  type CicsOperation,
  type ForEachStatementNode,
} from "../../ast/src/index";

type TokenKind =
  "identifier" | "number" | "string" | "keyword" | "punctuation" | "eof";

interface Token {
  kind: TokenKind;
  text: string;
  span: SourceSpan;
  /** Byte offset where the token starts, so a raw scan can resume from it. */
  offset: number;
}

/**
 * Every word the lexer treats as a keyword.
 *
 * Exported because the playground's highlighter and the VS Code grammar have to
 * cover the same set. Highlighting that lags the lexer is how a supported
 * keyword ends up looking like an undefined name, and
 * `tests/editor-surfaces.test.ts` is what stops the three drifting apart.
 */
export const KEYWORDS = new Set([
  "module",
  "type",
  "record",
  "function",
  "return",
  "true",
  "false",
  "decimal",
  "string",
  "bool",
  "date",
  "time",
  "timestamp",
  "let",
  "if",
  "else",
  "while",
  "for",
  "each",
  "in",
  "switch",
  "case",
  "enum",
  "sensitive",
  "redefines",
  "depending",
  "sql",
  "cursor",
  "execute",
  "cics",
  "link",
  "syncpoint",
  "rollback",
  "commit",
  "readFile",
  "writeFile",
  "rewriteFile",
  "writeQueue",
  "readQueue",
  "returnTransid",
  "returnCode",
  "split",
  "by",
  "search",
  "sort",
  "merge",
  "descending",
  "checkpoint",
  "every",
  "currency",
  "nullable",
  "edited",
  "binary",
  "zoned",
  "transaction",
  "file",
  "extends",
  "entry",
  "raise",
  "on",
  "failure",
]);

/**
 * File declaration clause words are matched contextually so `sequential`,
 * `input`, `output`, and `status` stay usable as field and parameter names.
 */
const FILE_MODES = new Set(["input", "output", "update"]);
const FILE_ORGANIZATIONS = new Set(["sequential", "indexed", "relative"]);

/** Built-ins for working with nullable values. */
const NULLABLE_BUILTINS = new Set(["isPresent", "valueOf"]);

/**
 * Ledger and audit operations are matched contextually rather than reserved as
 * keywords, so `debit`, `credit`, and `audit` remain usable as field and
 * parameter names.
 */
const LEDGER_OPERATIONS = new Set(["debit", "credit"]);
const AUDIT_OPERATION = "audit";

const TWO_CHAR_OPERATORS = new Set(["<=", ">=", "==", "!=", "&&", "||"]);

/** Longest first, so `<=` is matched before `<`. */
const COMPARISON_OPERATORS: ComparisonOperator[] = [
  "<=",
  ">=",
  "==",
  "!=",
  "<",
  ">",
];

/** Built-in expression forms that take an explicit rounding mode. */
const ROUNDING_BUILTINS = new Set(["round", "divide"]);

/** Calendar-aware builtins. They are contextual names, not reserved words. */
/** Keywords that begin a CICS command. */
const CICS_COMMANDS = new Set([
  "link",
  "syncpoint",
  "rollback",
  "readFile",
  "writeFile",
  "rewriteFile",
  "writeQueue",
  "readQueue",
  "returnTransid",
]);

const TEMPORAL_BUILTINS = new Set(["today", "addDays", "daysBetween"]);

/** String builtins. Contextual names, not reserved words. */
const STRING_BUILTINS = new Set([
  "trim",
  "upper",
  "lower",
  "substring",
  "concat",
  "now",
  "countOf",
  "replaceChars",
]);

const ROUNDING_MODES = new Set([
  "HALF_EVEN",
  "HALF_UP",
  "HALF_DOWN",
  "UP",
  "DOWN",
  "CEILING",
  "FLOOR",
]);

/** File operation keywords, matched contextually in statement position. */
const FILE_OPERATIONS = new Set([
  "open",
  "read",
  "readNext",
  "write",
  "rewrite",
  "delete",
  "start",
  "close",
]);

class Lexer {
  private readonly source: string;
  private readonly sourceFile: string;
  private offset = 0;
  private line = 1;
  private column = 1;
  public readonly comments: CommentTrivia[] = [];
  private tokenStartOffset = 0;

  public constructor(source: string, sourceFile: string) {
    this.source = source;
    this.sourceFile = sourceFile;
  }

  public nextToken(): Token {
    this.skipTrivia();

    if (this.offset >= this.source.length) {
      this.tokenStartOffset = this.offset;
      return this.makeToken(
        "eof",
        "",
        this.line,
        this.column,
        this.line,
        this.column,
      );
    }

    const startLine = this.line;
    const startColumn = this.column;
    this.tokenStartOffset = this.offset;
    const char = this.source[this.offset];

    if (this.isIdentifierStart(char)) {
      let text = "";
      while (
        this.offset < this.source.length &&
        this.isIdentifierPart(this.source[this.offset])
      ) {
        text += this.source[this.offset];
        this.advance(this.source[this.offset]);
      }
      const kind = KEYWORDS.has(text) ? "keyword" : "identifier";
      return this.makeToken(
        kind,
        text,
        startLine,
        startColumn,
        this.line,
        this.column,
      );
    }

    if (this.isDigit(char)) {
      let text = "";
      while (
        this.offset < this.source.length &&
        this.isDigit(this.source[this.offset])
      ) {
        text += this.source[this.offset];
        this.advance(this.source[this.offset]);
      }
      if (this.source[this.offset] === ".") {
        text += ".";
        this.advance(".");
        while (
          this.offset < this.source.length &&
          this.isDigit(this.source[this.offset])
        ) {
          text += this.source[this.offset];
          this.advance(this.source[this.offset]);
        }
      }
      return this.makeToken(
        "number",
        text,
        startLine,
        startColumn,
        this.line,
        this.column,
      );
    }

    if (char === '"') {
      this.advance(char);
      let text = "";
      while (
        this.offset < this.source.length &&
        this.source[this.offset] !== '"'
      ) {
        const current = this.source[this.offset];
        if (current === "\n") {
          break;
        }
        text += current;
        this.advance(current);
      }
      if (this.source[this.offset] !== '"') {
        return this.makeToken(
          "string",
          text,
          startLine,
          startColumn,
          this.line,
          this.column,
        );
      }
      this.advance('"');
      return this.makeToken(
        "string",
        text,
        startLine,
        startColumn,
        this.line,
        this.column,
      );
    }

    // Two-character operators must be lexed before single characters, or
    // `<=` would tokenise as `<` followed by `=`.
    const pair = char + (this.source[this.offset + 1] ?? "");
    if (TWO_CHAR_OPERATORS.has(pair)) {
      this.advance(char);
      this.advance(pair[1]);
      return this.makeToken(
        "punctuation",
        pair,
        startLine,
        startColumn,
        this.line,
        this.column,
      );
    }

    this.advance(char);
    return this.makeToken(
      "punctuation",
      char,
      startLine,
      startColumn,
      this.line,
      this.column,
    );
  }

  /**
   * Captures raw text from the current position to the matching close brace.
   *
   * Used for SQL bodies, which are passed through rather than parsed. Returns
   * the text and leaves the lexer positioned after the closing brace.
   */
  public captureBracedTextFrom(
    braceOffset: number,
    braceLine: number,
    braceColumn: number,
  ): { text: string; endLine: number; endColumn: number } | null {
    // Rewind to the brace: the parser has already lexed past it.
    this.offset = braceOffset;
    this.line = braceLine;
    this.column = braceColumn;

    if (this.source[this.offset] !== "{") {
      return null;
    }
    this.advance("{");

    let depth = 1;
    let text = "";
    while (this.offset < this.source.length) {
      const char = this.source[this.offset];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          this.advance("}");
          return { text, endLine: this.line, endColumn: this.column };
        }
      }
      text += char;
      this.advance(char);
    }

    return null;
  }

  private skipTrivia(): void {
    while (this.offset < this.source.length) {
      const char = this.source[this.offset];

      if (char === " " || char === "\t" || char === "\r") {
        this.advance(char);
        continue;
      }

      if (char === "\n") {
        this.advance(char);
        continue;
      }

      if (char === "/" && this.source[this.offset + 1] === "/") {
        const startLine = this.line;
        const startColumn = this.column;
        // A comment owns its line when only whitespace precedes it.
        const ownLine = this.onlyWhitespaceBeforeOnLine();
        let text = "";
        while (
          this.offset < this.source.length &&
          this.source[this.offset] !== "\n"
        ) {
          text += this.source[this.offset];
          this.advance(this.source[this.offset]);
        }
        this.comments.push({
          text: text.replace(/^\/\/\s?/, "").trimEnd(),
          span: {
            sourceFile: this.sourceFile,
            start: { line: startLine, column: startColumn },
            end: { line: this.line, column: this.column },
          },
          ownLine,
        });
        continue;
      }

      break;
    }
  }

  private onlyWhitespaceBeforeOnLine(): boolean {
    for (let index = this.offset - 1; index >= 0; index -= 1) {
      const char = this.source[index];
      if (char === "\n") {
        return true;
      }
      if (char !== " " && char !== "\t" && char !== "\r") {
        return false;
      }
    }
    return true;
  }

  private advance(char: string): void {
    this.offset += 1;
    if (char === "\n") {
      this.line += 1;
      this.column = 1;
      return;
    }

    this.column += 1;
  }

  private makeToken(
    kind: TokenKind,
    text: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
  ): Token {
    return {
      kind,
      text,
      offset: this.tokenStartOffset,
      span: {
        sourceFile: this.sourceFile,
        start: { line: startLine, column: startColumn },
        end: { line: endLine, column: endColumn },
      },
    };
  }

  private isIdentifierStart(char: string): boolean {
    return /[A-Za-z_]/.test(char);
  }

  private isIdentifierPart(char: string): boolean {
    return /[A-Za-z0-9_]/.test(char);
  }

  private isDigit(char: string | undefined): boolean {
    return char !== undefined && /[0-9]/.test(char);
  }
}

class Parser {
  private readonly lexer: Lexer;
  private current: Token;
  private next: Token;
  private previous: Token | null = null;
  private readonly diagnostics: Diagnostic[] = [];

  public constructor(source: string, sourceFile: string) {
    this.lexer = new Lexer(source, sourceFile);
    this.current = this.lexer.nextToken();
    this.next = this.lexer.nextToken();
  }

  public get comments(): CommentTrivia[] {
    return this.lexer.comments;
  }

  public parseProgram(): ParsedProgram {
    const declarations: DeclarationNode[] = [];
    const moduleDeclaration = this.parseModuleDeclaration();
    if (!moduleDeclaration) {
      return {
        program: null,
        diagnostics: this.diagnostics,
        comments: this.comments,
      };
    }

    while (!this.is("eof")) {
      const declaration = this.parseDeclaration();
      if (!declaration) {
        this.synchronizeToDeclaration();
        continue;
      }
      declarations.push(declaration);
    }

    const program: ProgramNode = {
      kind: "Program",
      span: {
        sourceFile: moduleDeclaration.span.sourceFile,
        start: moduleDeclaration.span.start,
        end: this.currentEnd(),
      },
      module: moduleDeclaration,
      declarations,
    };

    if (this.diagnostics.length > 0) {
      return {
        program: null,
        diagnostics: this.diagnostics,
        comments: this.comments,
      };
    }

    return {
      program,
      diagnostics: this.diagnostics,
      comments: this.comments,
    };
  }

  private parseModuleDeclaration(): ModuleDeclarationNode | null {
    const moduleToken = this.expectKeyword(
      "module",
      "Expected module declaration at the top of the file.",
    );
    if (!moduleToken) {
      return null;
    }

    const nameToken = this.expectIdentifier(
      "Expected module name after `module`.",
    );
    this.expectPunctuation(";", "Expected `;` after module declaration.");
    if (!nameToken) {
      return null;
    }

    return {
      kind: "ModuleDeclaration",
      name: nameToken.text,
      span: {
        sourceFile: moduleToken.span.sourceFile,
        start: moduleToken.span.start,
        end: nameToken.span.end,
      },
    };
  }

  private parseDeclaration(): DeclarationNode | null {
    if (this.matchKeyword("type")) {
      return this.parseTypeAliasDeclaration();
    }

    if (this.matchKeyword("record")) {
      return this.parseRecordDeclaration();
    }

    if (this.matchKeyword("function")) {
      return this.parseFunctionDeclaration();
    }

    if (this.matchKeyword("entry")) {
      const cics = this.matchKeyword("cics");
      if (!this.matchKeyword("transaction")) {
        this.errorAtCurrent(
          "BANK-SYN-001",
          "Expected `transaction` after `entry`.",
          "Write `entry transaction <name>(...) { ... }` to mark the program entry point.",
        );
        return null;
      }
      return this.parseTransactionDeclaration(cics, true);
    }

    if (this.matchKeyword("cics")) {
      if (!this.matchKeyword("transaction")) {
        this.errorAtCurrent(
          "BANK-SYN-001",
          "Expected `transaction` after `cics`.",
          "Write `cics transaction <name>(commarea: <Record>) { ... }`.",
        );
        return null;
      }
      return this.parseTransactionDeclaration(true, false);
    }

    if (this.matchKeyword("transaction")) {
      return this.parseTransactionDeclaration(false, false);
    }

    if (this.matchKeyword("file")) {
      return this.parseFileDeclaration();
    }

    if (this.matchKeyword("enum")) {
      return this.parseEnumDeclaration();
    }

    if (this.matchKeyword("sql")) {
      return this.parseSqlDeclaration("statement");
    }

    if (this.matchKeyword("cursor")) {
      return this.parseSqlDeclaration("cursor");
    }

    this.errorAtCurrent(
      "BANK-SYN-002",
      `Unexpected token ${this.current.text}.`,
      "Expected a declaration.",
    );
    return null;
  }

  private parseSqlDeclaration(
    form: "statement" | "cursor",
  ): SqlDeclarationNode | null {
    const nameToken = this.expectIdentifier("Expected SQL statement name.");
    this.expectPunctuation("(", "Expected `(` after SQL statement name.");
    const parameters = this.parseParameters();
    this.expectPunctuation(")", "Expected `)` after parameter list.");

    let resultTypeName: string | null = null;
    if (this.matchPunctuation(":")) {
      const resultToken = this.expectIdentifier(
        "Expected a result record type.",
      );
      resultTypeName = resultToken?.text ?? null;
    }

    // The body is captured verbatim, so the lexer must be positioned at the
    // opening brace before the raw scan begins.
    const bodyStart = this.current.span.start;
    const captured = this.captureSqlBody();
    if (!nameToken || !captured) {
      this.errorAtCurrent(
        "BANK-SYN-001",
        "Expected `{` to start the SQL body.",
        "Write the SQL statement between braces.",
      );
      return null;
    }

    const hostVariables: { name: string; span: SourceSpan }[] = [];
    let line = bodyStart.line;
    let column = bodyStart.column;
    for (let index = 0; index < captured.text.length; index += 1) {
      const char = captured.text[index];
      if (char === ":" && /[A-Za-z_]/.test(captured.text[index + 1] ?? "")) {
        let name = "";
        let cursor = index + 1;
        while (/[A-Za-z0-9_]/.test(captured.text[cursor] ?? "")) {
          name += captured.text[cursor];
          cursor += 1;
        }
        hostVariables.push({
          name,
          span: {
            sourceFile: nameToken.span.sourceFile,
            start: { line, column },
            end: { line, column: column + name.length + 1 },
          },
        });
      }
      if (char === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }

    return {
      kind: "SqlDeclaration",
      name: nameToken.text,
      parameters,
      resultTypeName,
      form,
      text: captured.text.trim(),
      hostVariables,
      span: {
        sourceFile: nameToken.span.sourceFile,
        start: nameToken.span.start,
        end: { line: captured.endLine, column: captured.endColumn },
      },
    };
  }

  private parseEnumDeclaration(): EnumDeclarationNode | null {
    const nameToken = this.expectIdentifier("Expected enum name.");
    const openBrace = this.expectPunctuation(
      "{",
      "Expected `{` to start enum body.",
    );
    const members: string[] = [];

    while (!this.is("eof") && !this.isPunctuation("}")) {
      const memberToken = this.expectIdentifier("Expected an enum member.");
      if (!memberToken) {
        return null;
      }
      members.push(memberToken.text);
      if (!this.matchPunctuation(",")) {
        break;
      }
    }

    const close = this.expectPunctuation(
      "}",
      "Expected `}` to close enum body.",
    );
    if (!nameToken || !openBrace || !close) {
      return null;
    }

    return {
      kind: "EnumDeclaration",
      name: nameToken.text,
      members,
      span: {
        sourceFile: nameToken.span.sourceFile,
        start: nameToken.span.start,
        end: close.span.end,
      },
    };
  }

  private parseFileDeclaration(): FileDeclarationNode | null {
    const fileToken = this.previous;
    const nameToken = this.expectIdentifier("Expected file name.");

    const organizationToken = this.expectContextualWord(
      FILE_ORGANIZATIONS,
      "Expected a file organization such as `sequential`.",
    );
    const modeToken = this.expectContextualWord(
      FILE_MODES,
      "Expected `input` or `output` after the file organization.",
    );
    this.expectKeyword("record", "Expected `record` before the record type.");
    const recordTypeToken = this.expectIdentifier(
      "Expected the record type name.",
    );

    let keyField: string | null = null;
    if (
      this.current.kind === "identifier" &&
      this.current.text === "key" &&
      this.next.kind === "identifier"
    ) {
      this.advance();
      const keyToken = this.expectIdentifier(
        "Expected a key field name after `key`.",
      );
      keyField = keyToken?.text ?? null;
    }

    let statusName: string | null = null;
    if (
      this.current.kind === "identifier" &&
      this.current.text === "status" &&
      this.next.kind === "identifier"
    ) {
      this.advance();
      const statusToken = this.expectIdentifier(
        "Expected a status field name after `status`.",
      );
      statusName = statusToken?.text ?? null;
    }

    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after file declaration.",
    );

    if (
      !fileToken ||
      !nameToken ||
      !organizationToken ||
      !modeToken ||
      !recordTypeToken ||
      !semicolon
    ) {
      return null;
    }

    return {
      kind: "FileDeclaration",
      name: nameToken.text,
      organization: organizationToken.text as FileOrganization,
      mode: modeToken.text as "input" | "output" | "update",
      recordTypeName: recordTypeToken.text,
      statusName,
      keyField,
      span: {
        sourceFile: fileToken.span.sourceFile,
        start: fileToken.span.start,
        end: semicolon.span.end,
      },
    };
  }

  private expectContextualWord(
    allowed: Set<string>,
    message: string,
  ): Token | null {
    if (this.current.kind === "identifier" && allowed.has(this.current.text)) {
      return this.advance();
    }

    this.errorAtCurrent(
      "BANK-SYN-001",
      message,
      `Expected one of: ${[...allowed].sort().join(", ")}.`,
    );
    return null;
  }

  private parseTransactionDeclaration(
    isCics: boolean,
    isEntry: boolean,
  ): TransactionDeclarationNode | null {
    const nameToken = this.expectIdentifier("Expected transaction name.");
    const openParen = this.expectPunctuation(
      "(",
      "Expected `(` after transaction name.",
    );
    const parameters = this.parseParameters();
    const closeParen = this.expectPunctuation(
      ")",
      "Expected `)` after parameter list.",
    );
    const handlerSink: { handler: FailureHandlerNode | null } = {
      handler: null,
    };
    const body = this.parseBlock(handlerSink);

    if (!nameToken || !openParen || !closeParen || !body) {
      return null;
    }

    return {
      kind: "TransactionDeclaration",
      name: nameToken.text,
      parameters,
      body,
      failureHandler: handlerSink.handler,
      isEntry,
      isCics,
      span: {
        sourceFile: nameToken.span.sourceFile,
        start: nameToken.span.start,
        end: body.span.end,
      },
    };
  }

  private parseTypeAliasDeclaration(): TypeAliasDeclarationNode | null {
    const nameToken = this.expectIdentifier("Expected type alias name.");
    this.expectPunctuation("=", "Expected `=` in type alias declaration.");
    const type = this.parseTypeNode();
    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after type alias declaration.",
    );

    if (!nameToken || !type || !semicolon) {
      return null;
    }

    return {
      kind: "TypeAliasDeclaration",
      name: nameToken.text,
      type,
      span: {
        sourceFile: nameToken.span.sourceFile,
        start: nameToken.span.start,
        end: semicolon.span.end,
      },
    };
  }

  private parseRecordDeclaration(): RecordDeclarationNode | null {
    const nameToken = this.expectIdentifier("Expected record name.");
    const typeParameters = this.parseTypeParameters();

    let baseType: TypeReferenceNode | null = null;
    if (this.matchKeyword("extends")) {
      const baseToken = this.expectIdentifier(
        "Expected a base record name after `extends`.",
      );
      if (!baseToken) {
        return null;
      }
      const baseArguments = this.parseTypeArguments();
      baseType = {
        kind: "TypeReference",
        name: baseToken.text,
        typeArguments: baseArguments,
        span: baseToken.span,
      };
    }

    const openBrace = this.expectPunctuation(
      "{",
      "Expected `{` to start record body.",
    );
    const fields: FieldDeclarationNode[] = [];

    while (!this.is("eof") && !this.matchPunctuation("}")) {
      const field = this.parseFieldDeclaration();
      if (!field) {
        this.synchronizeToFieldOrRecordEnd();
        continue;
      }
      fields.push(field);
    }

    const endToken = this.previous ?? openBrace ?? nameToken;
    if (!nameToken || !openBrace || !endToken) {
      return null;
    }

    return {
      kind: "RecordDeclaration",
      name: nameToken.text,
      typeParameters,
      baseType,
      fields,
      span: {
        sourceFile: nameToken.span.sourceFile,
        start: nameToken.span.start,
        end: endToken.span.end,
      },
    };
  }

  private parseFieldDeclaration(): FieldDeclarationNode | null {
    const modifierToken = this.isKeyword("sensitive") ? this.advance() : null;
    const nameToken = this.expectIdentifier("Expected field name.");
    this.expectPunctuation(":", "Expected `:` after field name.");
    const type = this.parseTypeNode();

    let redefines: string | null = null;
    if (this.matchKeyword("redefines")) {
      const targetToken = this.expectIdentifier(
        "Expected the field being redefined.",
      );
      redefines = targetToken?.text ?? null;
    }

    let dependingOn: string | null = null;
    if (this.matchKeyword("depending")) {
      this.expectKeyword("on", "Expected `on` after `depending`.");
      const countToken = this.expectIdentifier(
        "Expected the field holding the used length.",
      );
      dependingOn = countToken?.text ?? null;
    }

    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after field declaration.",
    );

    if (!nameToken || !type || !semicolon) {
      return null;
    }

    return {
      kind: "FieldDeclaration",
      name: nameToken.text,
      type,
      sensitive: modifierToken !== null,
      redefines,
      dependingOn,
      span: {
        sourceFile: (modifierToken ?? nameToken).span.sourceFile,
        start: (modifierToken ?? nameToken).span.start,
        end: semicolon.span.end,
      },
    };
  }

  private parseFunctionDeclaration(): FunctionDeclarationNode | null {
    const nameToken = this.expectIdentifier("Expected function name.");
    const typeParameters = this.parseTypeParameters();
    const openParen = this.expectPunctuation(
      "(",
      "Expected `(` after function name.",
    );
    const parameters = this.parseParameters();
    const closeParen = this.expectPunctuation(
      ")",
      "Expected `)` after parameter list.",
    );
    this.expectPunctuation(":", "Expected `:` before function return type.");
    const returnType = this.parseTypeNode();
    const body = this.parseBlock();

    if (!nameToken || !openParen || !closeParen || !returnType || !body) {
      return null;
    }

    return {
      kind: "FunctionDeclaration",
      name: nameToken.text,
      typeParameters,
      parameters,
      returnType,
      body,
      span: {
        sourceFile: nameToken.span.sourceFile,
        start: nameToken.span.start,
        end: body.span.end,
      },
    };
  }

  private parseParameters(): ParameterNode[] {
    const parameters: ParameterNode[] = [];
    if (this.isPunctuation(")")) {
      return parameters;
    }

    while (!this.is("eof") && !this.isPunctuation(")")) {
      const parameter = this.parseParameter();
      if (!parameter) {
        this.synchronizeToParameterOrEnd();
        continue;
      }
      parameters.push(parameter);
      if (!this.matchPunctuation(",")) {
        break;
      }
    }

    return parameters;
  }

  private parseParameter(): ParameterNode | null {
    const nameToken = this.expectIdentifier("Expected parameter name.");
    this.expectPunctuation(":", "Expected `:` after parameter name.");
    const type = this.parseTypeNode();

    if (!nameToken || !type) {
      return null;
    }

    return {
      kind: "Parameter",
      name: nameToken.text,
      type,
      span: {
        sourceFile: nameToken.span.sourceFile,
        start: nameToken.span.start,
        end: type.span.end,
      },
    };
  }

  private parseBlock(handlerSink?: {
    handler: FailureHandlerNode | null;
  }): BlockNode | null {
    const openBrace = this.expectPunctuation(
      "{",
      "Expected `{` to start function body.",
    );
    const statements: StatementNode[] = [];

    if (handlerSink && this.isKeyword("on")) {
      handlerSink.handler = this.parseFailureHandler();
    }

    while (!this.is("eof") && !this.matchPunctuation("}")) {
      const statement = this.parseStatement();
      if (!statement) {
        this.synchronizeToStatementOrBlockEnd();
        continue;
      }
      statements.push(statement);
    }

    const endToken = this.previous ?? openBrace;
    if (!openBrace || !endToken) {
      return null;
    }

    return {
      kind: "Block",
      statements,
      span: {
        sourceFile: openBrace.span.sourceFile,
        start: openBrace.span.start,
        end: endToken.span.end,
      },
    };
  }

  private parseStatement(): StatementNode | null {
    if (this.matchKeyword("let")) {
      return this.parseLetStatement();
    }

    if (this.matchKeyword("return")) {
      return this.parseReturnStatement();
    }

    if (this.matchKeyword("if")) {
      return this.parseIfStatement();
    }

    if (this.matchKeyword("while")) {
      return this.parseWhileStatement();
    }

    if (this.matchKeyword("for")) {
      return this.parseForEachStatement();
    }

    if (this.matchKeyword("switch")) {
      return this.parseSwitchStatement();
    }

    if (this.matchKeyword("execute")) {
      return this.parseSqlStatement();
    }

    if (this.matchKeyword("raise")) {
      return this.parseRaiseStatement();
    }

    if (this.isKeyword("checkpoint")) {
      const keyword = this.advance();
      const fileToken = this.expectIdentifier("Expected the restart file.");
      const fromToken = this.current;
      if (fromToken.kind !== "identifier" || fromToken.text !== "from") {
        this.errorAtCurrent(
          "BANK-SYN-001",
          "Expected `from` before the restart record.",
          "Write `checkpoint restartFile from restartRecord every 1000;`.",
        );
        return null;
      }
      this.advance();
      const recordToken = this.expectIdentifier("Expected the restart record.");
      if (!this.matchKeyword("every")) {
        this.errorAtCurrent(
          "BANK-SYN-001",
          "Expected `every` before the checkpoint interval.",
          "Write `checkpoint restartFile from restartRecord every 1000;`.",
        );
        return null;
      }
      const everyToken = this.expectNumber("Expected the checkpoint interval.");
      const semicolon = this.expectPunctuation(
        ";",
        "Expected `;` after the checkpoint statement.",
      );
      if (!fileToken || !recordToken || !everyToken || !semicolon) {
        return null;
      }
      return {
        kind: "CheckpointStatement",
        fileName: fileToken.text,
        recordName: recordToken.text,
        every: Number(everyToken.text),
        everySpan: everyToken.span,
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: semicolon.span.end,
        },
      } satisfies CheckpointStatementNode;
    }

    if (this.isKeyword("sort") || this.isKeyword("merge")) {
      const keyword = this.advance();
      const operation = keyword.text as "sort" | "merge";
      const inputs: string[] = [];
      do {
        const input = this.expectIdentifier("Expected an input file.");
        if (!input) {
          return null;
        }
        inputs.push(input.text);
      } while (this.matchPunctuation(","));

      if (this.current.kind !== "identifier" || this.current.text !== "into") {
        this.errorAtCurrent(
          "BANK-SYN-001",
          `Expected \`into\` after the ${operation} inputs.`,
          `Write \`${operation} <input> into <output> on <field>;\`.`,
        );
        return null;
      }
      this.advance();
      const outputToken = this.expectIdentifier("Expected an output file.");

      // `on` is already a keyword, from `on failure`.
      if (!this.matchKeyword("on")) {
        this.errorAtCurrent(
          "BANK-SYN-001",
          "Expected `on` before the sort keys.",
          `Write \`${operation} <input> into <output> on <field>;\`.`,
        );
        return null;
      }

      const keys: { name: string; descending: boolean }[] = [];
      do {
        const descending = this.matchKeyword("descending");
        const keyToken = this.expectIdentifier("Expected a sort key field.");
        if (!keyToken) {
          return null;
        }
        keys.push({ name: keyToken.text, descending });
      } while (this.matchPunctuation(","));

      const semicolon = this.expectPunctuation(
        ";",
        `Expected \`;\` after the ${operation} statement.`,
      );
      if (!outputToken || !semicolon) {
        return null;
      }

      return {
        kind: "SortStatement",
        operation,
        inputs,
        output: outputToken.text,
        keys,
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: semicolon.span.end,
        },
      } satisfies SortStatementNode;
    }

    if (this.isKeyword("split")) {
      const keyword = this.advance();
      const source = this.parseExpression();
      this.expectKeyword("by", "Expected `by` before the delimiter.");
      const delimiter = this.parseExpression();
      // `into` is contextual, like the file statement's clause words.
      if (this.current.kind !== "identifier" || this.current.text !== "into") {
        this.errorAtCurrent(
          "BANK-SYN-001",
          "Expected `into` before the targets.",
          'Write `split key by "-" into branch, account;`.',
        );
        return null;
      }
      this.advance();

      const targets: (MemberAccessNode | IdentifierNode)[] = [];
      do {
        const targetToken = this.expectIdentifier("Expected a target field.");
        if (!targetToken) {
          return null;
        }
        let target: MemberAccessNode | IdentifierNode = {
          kind: "Identifier",
          name: targetToken.text,
          span: targetToken.span,
        };
        if (this.matchPunctuation(".")) {
          const memberToken = this.expectIdentifier(
            "Expected a field name after `.`.",
          );
          if (!memberToken) {
            return null;
          }
          target = {
            kind: "MemberAccess",
            target: target as IdentifierNode,
            member: memberToken.text,
            span: {
              sourceFile: targetToken.span.sourceFile,
              start: targetToken.span.start,
              end: memberToken.span.end,
            },
          };
        }
        targets.push(target);
      } while (this.matchPunctuation(","));
      const semicolon = this.expectPunctuation(
        ";",
        "Expected `;` after the split statement.",
      );
      if (!source || !delimiter || !semicolon) {
        return null;
      }
      return {
        kind: "SplitStatement",
        source,
        delimiter,
        targets,
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: semicolon.span.end,
        },
      } satisfies SplitStatementNode;
    }

    if (this.isKeyword("search")) {
      const keyword = this.advance();
      const elementToken = this.expectIdentifier(
        "Expected a name for the matching element.",
      );
      this.expectKeyword("in", "Expected `in` after the element name.");
      const arrayToken = this.expectIdentifier("Expected a table to search.");
      if (!elementToken || !arrayToken) {
        return null;
      }
      let array: MemberAccessNode | IdentifierNode = {
        kind: "Identifier",
        name: arrayToken.text,
        span: arrayToken.span,
      };
      if (this.matchPunctuation(".")) {
        const memberToken = this.expectIdentifier(
          "Expected a field name after `.`.",
        );
        if (!memberToken) {
          return null;
        }
        array = {
          kind: "MemberAccess",
          target: array as IdentifierNode,
          member: memberToken.text,
          span: {
            sourceFile: arrayToken.span.sourceFile,
            start: arrayToken.span.start,
            end: memberToken.span.end,
          },
        };
      }
      if (this.current.kind !== "identifier" || this.current.text !== "where") {
        this.errorAtCurrent(
          "BANK-SYN-001",
          "Expected `where` before the condition.",
          "Write `search <name> in <table> where <condition> { ... } else { ... }`.",
        );
        return null;
      }
      this.advance();
      const condition = this.parseExpression();
      const body = this.parseBlock();
      // The not-found branch is required. A search that can fail and does not
      // say what then is the half a hand-written scan usually forgets.
      if (!this.matchKeyword("else")) {
        this.errorAtCurrent(
          "BANK-SYN-001",
          "Expected `else` after a search body.",
          "Write `search <name> in <table> where <condition> { ... } else { ... }`.",
        );
        return null;
      }
      const notFound = this.parseBlock();
      if (!condition || !body || !notFound) {
        return null;
      }
      return {
        kind: "SearchStatement",
        elementName: elementToken.text,
        array,
        condition,
        body,
        notFound,
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: notFound.span.end,
        },
      } satisfies SearchStatementNode;
    }

    if (this.isKeyword("returnCode")) {
      const keyword = this.advance();
      this.expectPunctuation("=", "Expected `=` after `returnCode`.");
      const value = this.parseExpression();
      const semicolon = this.expectPunctuation(
        ";",
        "Expected `;` after the return code.",
      );
      if (!value || !semicolon) {
        return null;
      }
      return {
        kind: "ReturnCodeStatement",
        value,
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: semicolon.span.end,
        },
      } satisfies ReturnCodeStatementNode;
    }

    // `commit;` and `rollback;` are the unit of work. `rollback resp x;` is the
    // CICS command, which takes a response code; the bare form does not.
    if (
      this.current.kind === "keyword" &&
      (this.current.text === "commit" ||
        (this.current.text === "rollback" &&
          this.next.kind === "punctuation" &&
          this.next.text === ";"))
    ) {
      const operationToken = this.advance();
      const semicolon = this.expectPunctuation(
        ";",
        "Expected `;` after the unit of work statement.",
      );
      if (!semicolon) {
        return null;
      }
      return {
        kind: "UnitOfWorkStatement",
        operation: operationToken.text as "commit" | "rollback",
        span: {
          sourceFile: operationToken.span.sourceFile,
          start: operationToken.span.start,
          end: semicolon.span.end,
        },
      } satisfies UnitOfWorkStatementNode;
    }

    if (
      this.current.kind === "keyword" &&
      CICS_COMMANDS.has(this.current.text)
    ) {
      return this.parseCicsStatement();
    }

    if (
      this.current.kind === "identifier" &&
      FILE_OPERATIONS.has(this.current.text) &&
      this.next.kind === "identifier"
    ) {
      return this.parseFileStatement();
    }

    if (this.current.kind === "identifier") {
      // `name`, `name.field`, and `name.field[i].sub` can all be assignment
      // targets; `name(` is a call.
      const next = this.next;
      if (
        next.kind === "punctuation" &&
        (next.text === "=" || next.text === "." || next.text === "[")
      ) {
        return this.parseAssignStatement();
      }
    }

    if (
      this.current.kind === "identifier" &&
      this.next.kind === "punctuation" &&
      this.next.text === "("
    ) {
      if (LEDGER_OPERATIONS.has(this.current.text)) {
        return this.parseLedgerStatement();
      }

      if (this.current.text === AUDIT_OPERATION) {
        return this.parseAuditStatement();
      }
    }

    if (
      this.current.kind === "identifier" &&
      this.next.kind === "punctuation" &&
      this.next.text === "("
    ) {
      const start = this.current;
      const expression = this.parseExpression();
      const semicolon = this.expectPunctuation(
        ";",
        "Expected `;` after expression statement.",
      );
      if (!expression || !semicolon) {
        return null;
      }
      return {
        kind: "ExpressionStatement",
        expression,
        span: {
          sourceFile: start.span.sourceFile,
          start: start.span.start,
          end: semicolon.span.end,
        },
      } satisfies ExpressionStatementNode;
    }

    this.errorAtCurrent(
      "BANK-SYN-002",
      `Unexpected token ${this.current.text}.`,
      "Expected a statement.",
    );
    return null;
  }

  private parseForEachStatement():
    ForEachStatementNode | CursorLoopStatementNode | null {
    const forToken = this.previous;
    this.expectKeyword("each", "Expected `each` after `for`.");
    const indexToken = this.expectIdentifier("Expected a loop index name.");
    this.expectKeyword("in", "Expected `in` after the loop index name.");

    // `name(` reads a cursor; anything else names an array. One token of
    // lookahead separates them, because an array is never called.
    if (
      forToken &&
      indexToken &&
      this.current.kind === "identifier" &&
      this.next.kind === "punctuation" &&
      this.next.text === "("
    ) {
      return this.parseCursorLoopStatement(forToken, indexToken);
    }

    const arrayToken = this.expectIdentifier("Expected an array to iterate.");
    if (!arrayToken) {
      return null;
    }

    let array: MemberAccessNode | IdentifierNode = {
      kind: "Identifier",
      name: arrayToken.text,
      span: arrayToken.span,
    };

    if (this.matchPunctuation(".")) {
      const memberToken = this.expectIdentifier(
        "Expected field name after `.`.",
      );
      if (!memberToken) {
        return null;
      }
      array = {
        kind: "MemberAccess",
        target: array as IdentifierNode,
        member: memberToken.text,
        span: {
          sourceFile: arrayToken.span.sourceFile,
          start: arrayToken.span.start,
          end: memberToken.span.end,
        },
      };
    }

    const body = this.parseBlock();
    if (!forToken || !indexToken || !body) {
      return null;
    }

    return {
      kind: "ForEachStatement",
      indexName: indexToken.text,
      array,
      body,
      span: {
        sourceFile: forToken.span.sourceFile,
        start: forToken.span.start,
        end: body.span.end,
      },
    };
  }

  /**
   * `for each <row> in <cursor>(args) limit <n> { ... }`
   *
   * The bound is required for the same reason a `while` bound is: a cursor over
   * a table nobody sized is an unbounded loop holding database locks.
   */
  private parseCursorLoopStatement(
    forToken: Token,
    rowToken: Token,
  ): CursorLoopStatementNode | null {
    const cursorToken = this.advance();
    this.expectPunctuation("(", "Expected `(` after the cursor name.");

    const args: ExpressionNode[] = [];
    if (!this.isPunctuation(")")) {
      do {
        const argument = this.parseExpression();
        if (!argument) {
          return null;
        }
        args.push(argument);
      } while (this.matchPunctuation(","));
    }
    this.expectPunctuation(")", "Expected `)` after the cursor arguments.");

    const limitWord = this.current;
    if (limitWord.kind !== "identifier" || limitWord.text !== "limit") {
      this.errorAtCurrent(
        "BANK-TXN-004",
        "A cursor loop must declare a static row limit.",
        "Write `for each <row> in <cursor>(...) limit <n> { ... }`.",
      );
      return null;
    }
    this.advance();

    const limitToken = this.expectNumber("Expected the row limit.");
    const body = this.parseBlock();

    if (!limitToken || !body) {
      return null;
    }

    return {
      kind: "CursorLoopStatement",
      cursorName: cursorToken.text,
      cursorSpan: cursorToken.span,
      args,
      rowName: rowToken.text,
      rowSpan: rowToken.span,
      limit: Number(limitToken.text),
      limitSpan: limitToken.span,
      body,
      span: {
        sourceFile: forToken.span.sourceFile,
        start: forToken.span.start,
        end: body.span.end,
      },
    };
  }

  private parseWhileStatement(): WhileStatementNode | null {
    const whileToken = this.previous;
    if (!whileToken) {
      return null;
    }

    const condition = this.parseExpression();

    // The bound is required, not optional. An unbounded loop in a financial
    // program is BANK-TXN-004, and the compiler cannot infer a safe limit.
    const limitWord = this.current;
    if (limitWord.kind !== "identifier" || limitWord.text !== "limit") {
      this.errorAtCurrent(
        "BANK-TXN-004",
        "A while loop must declare a static iteration limit.",
        "Write `while <condition> limit <n> { ... }`.",
      );
      return null;
    }
    this.advance();

    const limitToken = this.expectNumber("Expected the iteration limit.");
    const body = this.parseBlock();

    if (!condition || !limitToken || !body) {
      return null;
    }

    return {
      kind: "WhileStatement",
      condition,
      limit: Number(limitToken.text),
      body,
      span: {
        sourceFile: whileToken.span.sourceFile,
        start: whileToken.span.start,
        end: body.span.end,
      },
    };
  }

  private parseCicsStatement(): CicsStatementNode | null {
    const operationToken = this.advance();
    const operation = operationToken.text as CicsOperation;

    let program: string | null = null;
    let commarea: string | null = null;
    let respName: string | null = null;
    let key: ExpressionNode | null = null;

    // Every command but a syncpoint names the resource it acts on: a program, a
    // dataset, a queue, or the transaction to run next.
    const NAMED = new Set([
      "link",
      "readFile",
      "writeFile",
      "rewriteFile",
      "writeQueue",
      "readQueue",
      "returnTransid",
    ]);

    if (NAMED.has(operation)) {
      const nameToken = this.current;
      if (nameToken.kind !== "string") {
        this.errorAtCurrent(
          "BANK-SYN-001",
          `Expected a name after \`${operation}\`.`,
          `Write \`${operation} "NAME" ...;\`.`,
        );
        return null;
      }
      this.advance();
      program = nameToken.text;
    }

    // `commarea` for a link, `into`/`from` for a file or queue command. All
    // three name the record the command moves, so they share a field.
    for (const clause of ["commarea", "into", "from"] as const) {
      if (this.current.kind === "identifier" && this.current.text === clause) {
        this.advance();
        const recordToken = this.expectIdentifier("Expected a record name.");
        commarea = recordToken?.text ?? null;
        break;
      }
    }

    if (this.current.kind === "identifier" && this.current.text === "key") {
      this.advance();
      key = this.parseExpression();
      if (!key) {
        return null;
      }
    }

    // The response code is mandatory. A CICS command whose outcome is never
    // examined is BANK-CICS-001.
    if (this.current.kind === "identifier" && this.current.text === "resp") {
      this.advance();
      const respToken = this.expectIdentifier("Expected a response variable.");
      respName = respToken?.text ?? null;
    }

    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after CICS statement.",
    );
    if (!semicolon) {
      return null;
    }

    return {
      kind: "CicsStatement",
      operation,
      program,
      commarea,
      respName,
      key,
      span: {
        sourceFile: operationToken.span.sourceFile,
        start: operationToken.span.start,
        end: semicolon.span.end,
      },
    };
  }

  private parseSqlStatement(): SqlStatementNode | null {
    const executeToken = this.previous;
    const nameToken = this.expectIdentifier("Expected a SQL statement name.");
    this.expectPunctuation("(", "Expected `(` after the SQL statement name.");

    const args: ExpressionNode[] = [];
    if (!this.isPunctuation(")")) {
      for (;;) {
        const argument = this.parseExpression();
        if (!argument) {
          return null;
        }
        args.push(argument);
        if (!this.matchPunctuation(",")) {
          break;
        }
      }
    }
    this.expectPunctuation(")", "Expected `)` after arguments.");

    let intoRecord: string | null = null;
    if (this.current.kind === "identifier" && this.current.text === "into") {
      this.advance();
      const recordToken = this.expectIdentifier("Expected a record name.");
      intoRecord = recordToken?.text ?? null;
    }

    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after execute statement.",
    );

    if (!executeToken || !nameToken || !semicolon) {
      return null;
    }

    return {
      kind: "SqlStatement",
      name: nameToken.text,
      args,
      intoRecord,
      span: {
        sourceFile: executeToken.span.sourceFile,
        start: executeToken.span.start,
        end: semicolon.span.end,
      },
    };
  }

  private parseSwitchStatement(): SwitchStatementNode | null {
    const switchToken = this.previous;
    if (!switchToken) {
      return null;
    }

    const subject = this.parseExpression();
    this.expectPunctuation("{", "Expected `{` to start switch body.");

    const cases: SwitchCaseNode[] = [];
    let otherwise: BlockNode | null = null;

    while (!this.is("eof") && !this.isPunctuation("}")) {
      if (this.matchKeyword("case")) {
        const caseToken = this.previous;
        const memberToken = this.expectIdentifier("Expected an enum member.");
        const body = this.parseBlock();
        if (!caseToken || !memberToken || !body) {
          return null;
        }
        cases.push({
          kind: "SwitchCase",
          member: memberToken.text,
          body,
          span: {
            sourceFile: caseToken.span.sourceFile,
            start: caseToken.span.start,
            end: body.span.end,
          },
        });
        continue;
      }

      if (this.matchKeyword("else")) {
        otherwise = this.parseBlock();
        if (!otherwise) {
          return null;
        }
        continue;
      }

      this.errorAtCurrent(
        "BANK-SYN-001",
        `Unexpected token ${this.current.text} in switch body.`,
        "Expected `case <MEMBER> { ... }` or `else { ... }`.",
      );
      return null;
    }

    const close = this.expectPunctuation("}", "Expected `}` to close switch.");
    if (!subject || !close) {
      return null;
    }

    return {
      kind: "SwitchStatement",
      subject,
      cases,
      otherwise,
      span: {
        sourceFile: switchToken.span.sourceFile,
        start: switchToken.span.start,
        end: close.span.end,
      },
    };
  }

  private parseAssignStatement(): AssignStatementNode | null {
    const start = this.current;

    // The target is parsed with the expression parser so it can be a plain
    // name, a field, or a field reached through an array element.
    const target = this.parsePrimaryExpression();
    if (!target) {
      return null;
    }

    if (target.kind !== "Identifier" && target.kind !== "MemberAccess") {
      this.errorAtCurrent(
        "BANK-SYN-002",
        "This is not an assignable target.",
        "Assign to a local, a record field, or an array element field.",
      );
      return null;
    }

    this.expectPunctuation("=", "Expected `=` in assignment.");
    const expression = this.parseExpression();
    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after assignment.",
    );

    if (!expression || !semicolon) {
      return null;
    }

    return {
      kind: "AssignStatement",
      target,
      expression,
      span: {
        sourceFile: start.span.sourceFile,
        start: start.span.start,
        end: semicolon.span.end,
      },
    };
  }

  private parseFileStatement(): FileStatementNode | null {
    const operationToken = this.advance();
    const fileToken = this.expectIdentifier("Expected a file name.");
    if (!fileToken) {
      return null;
    }

    const operation = operationToken.text as FileStatementNode["operation"];
    let recordName: string | null = null;

    if (
      operation === "read" ||
      operation === "readNext" ||
      operation === "write" ||
      operation === "rewrite"
    ) {
      const clause =
        operation === "read" || operation === "readNext" ? "into" : "from";
      const clauseToken = this.current;
      if (clauseToken.kind !== "identifier" || clauseToken.text !== clause) {
        this.errorAtCurrent(
          "BANK-SYN-001",
          `Expected \`${clause}\` after \`${operation} ${fileToken.text}\`.`,
          `Write \`${operation} ${fileToken.text} ${clause} <record>;\`.`,
        );
        return null;
      }
      this.advance();
      const recordToken = this.expectIdentifier("Expected a record name.");
      if (!recordToken) {
        return null;
      }
      recordName = recordToken.text;
    }

    let key: ExpressionNode | null = null;
    // `read ... key <expr>` reads one record by key; `start ... key <expr>`
    // positions a browse at it, and `delete ... key <expr>` removes it.
    if (
      this.current.kind === "identifier" &&
      this.current.text === "key" &&
      (operation === "read" || operation === "start" || operation === "delete")
    ) {
      this.advance();
      key = this.parseExpression();
      if (!key) {
        return null;
      }
    }

    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after file statement.",
    );
    if (!semicolon) {
      return null;
    }

    return {
      kind: "FileStatement",
      operation,
      fileName: fileToken.text,
      recordName,
      key,
      span: {
        sourceFile: operationToken.span.sourceFile,
        start: operationToken.span.start,
        end: semicolon.span.end,
      },
    };
  }

  private parseLedgerStatement(): LedgerStatementNode | null {
    const operationToken = this.advance();
    this.expectPunctuation("(", "Expected `(` after ledger operation.");
    const account = this.parseExpression();
    this.expectPunctuation(",", "Expected `,` between account and amount.");
    const amount = this.parseExpression();
    this.expectPunctuation(")", "Expected `)` after ledger arguments.");
    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after ledger statement.",
    );

    if (!account || !amount || !semicolon) {
      return null;
    }

    return {
      kind: "LedgerStatement",
      operation: operationToken.text as "debit" | "credit",
      account,
      amount,
      span: {
        sourceFile: operationToken.span.sourceFile,
        start: operationToken.span.start,
        end: semicolon.span.end,
      },
    };
  }

  private parseAuditStatement(): AuditStatementNode | null {
    const auditToken = this.advance();
    this.expectPunctuation("(", "Expected `(` after `audit`.");
    const eventName = this.parseExpression();
    this.expectPunctuation(
      ",",
      "Expected `,` between audit event name and correlation key.",
    );
    const correlation = this.parseExpression();
    this.expectPunctuation(")", "Expected `)` after audit arguments.");
    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after audit statement.",
    );

    if (!eventName || !correlation || !semicolon) {
      return null;
    }

    return {
      kind: "AuditStatement",
      eventName,
      correlation,
      span: {
        sourceFile: auditToken.span.sourceFile,
        start: auditToken.span.start,
        end: semicolon.span.end,
      },
    };
  }

  private parseRaiseStatement(): RaiseStatementNode | null {
    const raiseToken = this.previous;
    if (!raiseToken) {
      return null;
    }

    if (!this.is("string")) {
      this.errorAtCurrent(
        "BANK-SYN-001",
        "Expected a failure code literal after `raise`.",
        'Write `raise "INSUFFICIENT_FUNDS";` so every failure a program can signal is visible in the source.',
      );
      return null;
    }

    const codeToken = this.advance();
    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after raise statement.",
    );
    if (!semicolon) {
      return null;
    }

    return {
      kind: "RaiseStatement",
      code: codeToken.text,
      codeSpan: codeToken.span,
      span: {
        sourceFile: raiseToken.span.sourceFile,
        start: raiseToken.span.start,
        end: semicolon.span.end,
      },
    };
  }

  /**
   * Parses a leading `on failure { ... }` block.
   *
   * The handler is read before the body so a reader meets the recovery path
   * before the statements that can trigger it.
   */
  private parseFailureHandler(): FailureHandlerNode | null {
    if (!this.isKeyword("on")) {
      return null;
    }

    const onToken = this.advance();
    if (!this.matchKeyword("failure")) {
      this.errorAtCurrent(
        "BANK-SYN-001",
        "Expected `failure` after `on`.",
        "Write `on failure { ... }` to declare the recovery path.",
      );
      return null;
    }

    const body = this.parseBlock();
    if (!body) {
      return null;
    }

    return {
      kind: "FailureHandler",
      body,
      span: {
        sourceFile: onToken.span.sourceFile,
        start: onToken.span.start,
        end: body.span.end,
      },
    };
  }

  private parseLetStatement(): LetStatementNode | null {
    const letToken = this.previous;
    if (!letToken) {
      return null;
    }

    const nameToken = this.expectIdentifier("Expected local variable name.");
    this.expectPunctuation(":", "Expected `:` after local variable name.");
    const type = this.parseTypeNode();
    this.expectPunctuation("=", "Expected `=` in let declaration.");
    const expression = this.parseExpression();
    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after let declaration.",
    );

    if (!nameToken || !type || !expression || !semicolon) {
      return null;
    }

    return {
      kind: "LetStatement",
      name: nameToken.text,
      type,
      expression,
      span: {
        sourceFile: letToken.span.sourceFile,
        start: letToken.span.start,
        end: semicolon.span.end,
      },
    };
  }

  private parseReturnStatement(): ReturnStatementNode | null {
    const returnToken = this.previous;
    if (!returnToken) {
      return null;
    }

    const expression = this.parseExpression();
    const semicolon = this.expectPunctuation(
      ";",
      "Expected `;` after return statement.",
    );
    if (!expression || !semicolon) {
      return null;
    }

    return {
      kind: "ReturnStatement",
      expression,
      span: {
        sourceFile: returnToken.span.sourceFile,
        start: returnToken.span.start,
        end: semicolon.span.end,
      },
    };
  }

  private parseIfStatement(): IfStatementNode | null {
    const ifToken = this.previous;
    if (!ifToken) {
      return null;
    }

    const condition = this.parseExpression();
    const thenBranch = this.parseBlock();
    let elseBranch: BlockNode | null = null;

    if (this.matchKeyword("else")) {
      elseBranch = this.parseBlock();
      if (!elseBranch) {
        return null;
      }
    }

    if (!condition || !thenBranch) {
      return null;
    }

    return {
      kind: "IfStatement",
      condition,
      thenBranch,
      elseBranch,
      span: {
        sourceFile: ifToken.span.sourceFile,
        start: ifToken.span.start,
        end: (elseBranch ?? thenBranch).span.end,
      },
    };
  }

  private parseExpression(): ExpressionNode | null {
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): ExpressionNode | null {
    return this.parseBinaryLevel(["||"], () => this.parseLogicalAnd());
  }

  private parseLogicalAnd(): ExpressionNode | null {
    return this.parseBinaryLevel(["&&"], () => this.parseComparison());
  }

  /** Comparisons do not chain: `a < b < c` is rejected as a type error. */
  private parseComparison(): ExpressionNode | null {
    const left = this.parseAdditive();
    if (!left) {
      return null;
    }

    const operator = COMPARISON_OPERATORS.find((candidate) =>
      this.isPunctuation(candidate),
    );
    if (!operator) {
      return left;
    }

    this.advance();
    const right = this.parseAdditive();
    if (!right) {
      return null;
    }

    return {
      kind: "BinaryExpression",
      operator,
      left,
      right,
      span: {
        sourceFile: left.span.sourceFile,
        start: left.span.start,
        end: right.span.end,
      },
    };
  }

  private parseAdditive(): ExpressionNode | null {
    return this.parseBinaryLevel(["+", "-"], () => this.parseMultiplicative());
  }

  private parseMultiplicative(): ExpressionNode | null {
    return this.parseBinaryLevel(["*", "/"], () => this.parseUnary());
  }

  /** Left-associative binary level shared by the arithmetic and logical tiers. */
  private parseBinaryLevel(
    operators: BinaryOperator[],
    next: () => ExpressionNode | null,
  ): ExpressionNode | null {
    let expression = next();
    if (!expression) {
      return null;
    }

    for (;;) {
      const operator = operators.find((candidate) =>
        this.isPunctuation(candidate),
      );
      if (!operator) {
        return expression;
      }

      this.advance();
      const right = next();
      if (!right) {
        return null;
      }

      expression = {
        kind: "BinaryExpression",
        operator,
        left: expression,
        right,
        span: {
          sourceFile: expression.span.sourceFile,
          start: expression.span.start,
          end: right.span.end,
        },
      };
    }
  }

  private parseUnary(): ExpressionNode | null {
    if (this.isPunctuation("!")) {
      const token = this.advance();
      const operand = this.parseUnary();
      if (!operand) {
        return null;
      }
      return {
        kind: "UnaryExpression",
        operator: "!",
        operand,
        span: {
          sourceFile: token.span.sourceFile,
          start: token.span.start,
          end: operand.span.end,
        },
      } satisfies UnaryExpressionNode;
    }

    return this.parsePrimaryExpression();
  }

  private parsePrimaryExpression(): ExpressionNode | null {
    if (this.matchKeyword("true")) {
      const token = this.previous;
      if (!token) {
        return null;
      }
      return {
        kind: "BooleanLiteral",
        value: true,
        span: token.span,
      } satisfies BooleanLiteralNode;
    }

    if (this.matchKeyword("false")) {
      const token = this.previous;
      if (!token) {
        return null;
      }
      return {
        kind: "BooleanLiteral",
        value: false,
        span: token.span,
      } satisfies BooleanLiteralNode;
    }

    if (this.is("number")) {
      const token = this.advance();
      return {
        kind: "DecimalLiteral",
        text: token.text,
        span: token.span,
      } satisfies DecimalLiteralNode;
    }

    if (this.is("string")) {
      const token = this.advance();
      return {
        kind: "StringLiteral",
        value: token.text,
        span: token.span,
      } satisfies StringLiteralNode;
    }

    if (this.is("identifier")) {
      if (
        NULLABLE_BUILTINS.has(this.current.text) &&
        this.next.kind === "punctuation" &&
        this.next.text === "("
      ) {
        const nameToken = this.advance();
        this.expectPunctuation("(", "Expected `(`.");
        const operand = this.parseExpression();
        const close = this.expectPunctuation(")", "Expected `)`.");
        if (!operand || !close) {
          return null;
        }
        return {
          kind: "NullableCheck",
          operation: nameToken.text as "isPresent" | "valueOf",
          operand,
          span: {
            sourceFile: nameToken.span.sourceFile,
            start: nameToken.span.start,
            end: close.span.end,
          },
        } satisfies NullableCheckNode;
      }

      if (
        STRING_BUILTINS.has(this.current.text) &&
        this.next.kind === "punctuation" &&
        this.next.text === "("
      ) {
        const nameToken = this.advance();
        this.expectPunctuation("(", "Expected `(` after the builtin name.");
        const args: ExpressionNode[] = [];
        if (!this.isPunctuation(")")) {
          do {
            const argument = this.parseExpression();
            if (!argument) {
              return null;
            }
            args.push(argument);
          } while (this.matchPunctuation(","));
        }
        const close = this.expectPunctuation(
          ")",
          "Expected `)` after the builtin arguments.",
        );
        if (!close) {
          return null;
        }
        return {
          kind: "StringCall",
          operation: nameToken.text as StringCallNode["operation"],
          args,
          span: {
            sourceFile: nameToken.span.sourceFile,
            start: nameToken.span.start,
            end: close.span.end,
          },
        } satisfies StringCallNode;
      }

      if (
        TEMPORAL_BUILTINS.has(this.current.text) &&
        this.next.kind === "punctuation" &&
        this.next.text === "("
      ) {
        const nameToken = this.advance();
        this.expectPunctuation("(", "Expected `(` after the builtin name.");
        const args: ExpressionNode[] = [];
        if (!this.isPunctuation(")")) {
          do {
            const argument = this.parseExpression();
            if (!argument) {
              return null;
            }
            args.push(argument);
          } while (this.matchPunctuation(","));
        }
        const close = this.expectPunctuation(
          ")",
          "Expected `)` after the builtin arguments.",
        );
        if (!close) {
          return null;
        }
        return {
          kind: "TemporalCall",
          operation: nameToken.text as TemporalCallNode["operation"],
          args,
          span: {
            sourceFile: nameToken.span.sourceFile,
            start: nameToken.span.start,
            end: close.span.end,
          },
        } satisfies TemporalCallNode;
      }

      if (
        ROUNDING_BUILTINS.has(this.current.text) &&
        this.next.kind === "punctuation" &&
        this.next.text === "("
      ) {
        return this.parseRoundedExpression();
      }

      const token = this.advance();

      if (this.isPunctuation("(")) {
        return this.parseCallExpression(token);
      }

      const identifier: IdentifierNode = {
        kind: "Identifier",
        name: token.text,
        span: token.span,
      };

      if (this.isPunctuation(".")) {
        this.advance();
        const memberToken = this.expectIdentifier(
          "Expected field name after `.`.",
        );
        if (!memberToken) {
          return null;
        }

        // `Status.ACTIVE` is an enum member; anything else is field access.
        // Enum names are resolved by the typechecker, so both parse the same
        // way and the distinction is made once types are known.
        const access: MemberAccessNode = {
          kind: "MemberAccess",
          target: identifier,
          member: memberToken.text,
          span: {
            sourceFile: token.span.sourceFile,
            start: token.span.start,
            end: memberToken.span.end,
          },
        };

        return this.withIndexSuffix(access);
      }

      return this.withIndexSuffix(identifier);
    }

    if (this.matchPunctuation("(")) {
      const expression = this.parseExpression();
      this.expectPunctuation(
        ")",
        "Expected `)` after parenthesized expression.",
      );
      return expression;
    }

    this.errorAtCurrent(
      "BANK-SYN-002",
      `Unexpected token ${this.current.text}.`,
      "Expected an expression.",
    );
    return null;
  }

  private withIndexSuffix(
    target: MemberAccessNode | IdentifierNode,
  ): ExpressionNode | null {
    if (!this.isPunctuation("[")) {
      return target;
    }

    this.advance();
    const index = this.parseExpression();
    const close = this.expectPunctuation(
      "]",
      "Expected `]` after array index.",
    );
    if (!index || !close) {
      return null;
    }

    const indexed: IndexAccessNode = {
      kind: "IndexAccess",
      target,
      index,
      span: {
        sourceFile: target.span.sourceFile,
        start: target.span.start,
        end: close.span.end,
      },
    };

    // `lines[i].amount` reaches a field of the indexed element.
    if (this.isPunctuation(".")) {
      this.advance();
      const memberToken = this.expectIdentifier(
        "Expected field name after `.`.",
      );
      if (!memberToken) {
        return null;
      }
      return {
        kind: "MemberAccess",
        target: indexed,
        member: memberToken.text,
        span: {
          sourceFile: indexed.span.sourceFile,
          start: indexed.span.start,
          end: memberToken.span.end,
        },
      } satisfies MemberAccessNode;
    }

    return indexed;
  }

  private parseCallExpression(nameToken: Token): ExpressionNode | null {
    this.expectPunctuation("(", "Expected `(` after function name.");
    const args: ExpressionNode[] = [];

    if (!this.isPunctuation(")")) {
      for (;;) {
        const argument = this.parseExpression();
        if (!argument) {
          return null;
        }
        args.push(argument);
        if (!this.matchPunctuation(",")) {
          break;
        }
      }
    }

    const close = this.expectPunctuation(")", "Expected `)` after arguments.");
    if (!close) {
      return null;
    }

    return {
      kind: "CallExpression",
      callee: nameToken.text,
      args,
      span: {
        sourceFile: nameToken.span.sourceFile,
        start: nameToken.span.start,
        end: close.span.end,
      },
    } satisfies CallExpressionNode;
  }

  /**
   * `round(expr, "MODE")` and `divide(a, b, "MODE")`.
   *
   * The rounding mode is a required argument rather than an option, because an
   * unstated rounding mode is a real defect in financial arithmetic.
   */
  private parseRoundedExpression(): ExpressionNode | null {
    const nameToken = this.advance();
    const isDivision = nameToken.text === "divide";
    this.expectPunctuation("(", `Expected \`(\` after \`${nameToken.text}\`.`);

    const first = this.parseExpression();
    if (!first) {
      return null;
    }

    let operand: ExpressionNode = first;

    if (isDivision) {
      this.expectPunctuation(",", "Expected `,` after the dividend.");
      const divisor = this.parseExpression();
      if (!divisor) {
        return null;
      }
      operand = {
        kind: "BinaryExpression",
        operator: "/",
        left: first,
        right: divisor,
        span: {
          sourceFile: first.span.sourceFile,
          start: first.span.start,
          end: divisor.span.end,
        },
      };
    }

    this.expectPunctuation(",", "Expected `,` before the rounding mode.");
    const modeToken = this.current;
    if (modeToken.kind !== "string" || !ROUNDING_MODES.has(modeToken.text)) {
      this.errorAtCurrent(
        "BANK-DEC-003",
        `Expected an explicit rounding mode.`,
        `Use one of: ${[...ROUNDING_MODES].sort().join(", ")}.`,
      );
      return null;
    }
    this.advance();

    const close = this.expectPunctuation(
      ")",
      `Expected \`)\` after \`${nameToken.text}\` arguments.`,
    );
    if (!close) {
      return null;
    }

    return {
      kind: "RoundedExpression",
      operand,
      mode: modeToken.text as RoundingMode,
      isDivision,
      span: {
        sourceFile: nameToken.span.sourceFile,
        start: nameToken.span.start,
        end: close.span.end,
      },
    } satisfies RoundedExpressionNode;
  }

  private parseTypeNode(): TypeNode | null {
    if (this.matchKeyword("decimal")) {
      const keyword = this.previous;
      const openAngle = this.expectPunctuation(
        "<",
        "Expected `<` after `decimal`.",
      );
      const precisionToken = this.expectNumber("Expected decimal precision.");
      this.expectPunctuation(",", "Expected `,` between precision and scale.");
      const scaleToken = this.expectNumber("Expected decimal scale.");
      const closeAngle = this.expectPunctuation(
        ">",
        "Expected `>` to close decimal type.",
      );
      if (
        !keyword ||
        !openAngle ||
        !precisionToken ||
        !scaleToken ||
        !closeAngle
      ) {
        return null;
      }
      return this.withArraySuffix({
        kind: "DecimalType",
        precision: Number(precisionToken.text),
        scale: Number(scaleToken.text),
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: closeAngle.span.end,
        },
      } satisfies DecimalTypeNode);
    }

    if (this.matchKeyword("string")) {
      const keyword = this.previous;
      const openAngle = this.expectPunctuation(
        "<",
        "Expected `<` after `string`.",
      );
      const lengthToken = this.expectNumber("Expected string length.");
      const closeAngle = this.expectPunctuation(
        ">",
        "Expected `>` to close string type.",
      );
      if (!keyword || !openAngle || !lengthToken || !closeAngle) {
        return null;
      }
      return this.withArraySuffix({
        kind: "StringType",
        length: Number(lengthToken.text),
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: closeAngle.span.end,
        },
      } satisfies StringTypeNode);
    }

    for (const unit of ["date", "time", "timestamp"] as const) {
      if (this.matchKeyword(unit)) {
        const keyword = this.previous;
        if (!keyword) {
          return null;
        }
        return this.withArraySuffix({
          kind: "TemporalType",
          unit,
          span: keyword.span,
        } satisfies TemporalTypeNode);
      }
    }

    for (const usage of ["binary", "zoned"] as const) {
      if (this.matchKeyword(usage)) {
        const keyword = this.previous;
        this.expectPunctuation("<", `Expected \`<\` after \`${usage}\`.`);
        const precisionToken = this.expectNumber("Expected digit count.");
        // A binary field is a whole number: a counter, a subscript, or a code.
        // Zoned decimal is a general number and carries a scale like any other.
        let scaleToken = null;
        if (usage === "zoned") {
          this.expectPunctuation(
            ",",
            "Expected `,` between precision and scale.",
          );
          scaleToken = this.expectNumber("Expected decimal scale.");
        }
        const closeAngle = this.expectPunctuation(
          ">",
          `Expected \`>\` to close \`${usage}\` type.`,
        );
        if (!keyword || !precisionToken || !closeAngle) {
          return null;
        }
        if (usage === "zoned" && !scaleToken) {
          return null;
        }
        return this.withArraySuffix({
          kind: "DecimalType",
          precision: Number(precisionToken.text),
          scale: scaleToken ? Number(scaleToken.text) : 0,
          usage: usage === "binary" ? "binary" : "display",
          span: {
            sourceFile: keyword.span.sourceFile,
            start: keyword.span.start,
            end: closeAngle.span.end,
          },
        } satisfies DecimalTypeNode);
      }
    }

    if (this.matchKeyword("edited")) {
      const keyword = this.previous;
      this.expectPunctuation("<", "Expected `<` after `edited`.");
      const inner = this.parseTypeNode();
      this.expectPunctuation(",", "Expected `,` before the edit style.");
      const styleToken = this.current;
      if (styleToken.kind !== "string") {
        this.errorAtCurrent(
          "BANK-SYN-001",
          "Expected an edit style.",
          'Write `edited<MoneyBDT, "signed">`.',
        );
        return null;
      }
      this.advance();
      const closeAngle = this.expectPunctuation(
        ">",
        "Expected `>` to close edited type.",
      );
      if (!keyword || !inner || !closeAngle) {
        return null;
      }
      return this.withArraySuffix({
        kind: "EditedType",
        inner,
        style: styleToken.text,
        styleSpan: styleToken.span,
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: closeAngle.span.end,
        },
      } satisfies EditedTypeNode);
    }

    if (this.matchKeyword("bool")) {
      const keyword = this.previous;
      if (!keyword) {
        return null;
      }
      return this.withArraySuffix({
        kind: "BoolType",
        span: keyword.span,
      } satisfies BoolTypeNode);
    }

    if (this.matchKeyword("currency")) {
      const keyword = this.previous;
      this.expectPunctuation("<", "Expected `<` after `currency`.");
      const codeToken = this.current;
      if (codeToken.kind !== "string") {
        this.errorAtCurrent(
          "BANK-SYN-001",
          "Expected a currency code string.",
          'Write currency<"BDT", 18, 2>.',
        );
        return null;
      }
      this.advance();
      this.expectPunctuation(",", "Expected `,` after the currency code.");
      const precisionToken = this.expectNumber("Expected currency precision.");
      this.expectPunctuation(",", "Expected `,` between precision and scale.");
      const scaleToken = this.expectNumber("Expected currency scale.");
      const closeAngle = this.expectPunctuation(
        ">",
        "Expected `>` to close currency type.",
      );
      if (!keyword || !precisionToken || !scaleToken || !closeAngle) {
        return null;
      }
      return this.withArraySuffix({
        kind: "CurrencyType",
        code: codeToken.text,
        precision: Number(precisionToken.text),
        scale: Number(scaleToken.text),
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: closeAngle.span.end,
        },
      } satisfies CurrencyTypeNode);
    }

    if (this.matchKeyword("nullable")) {
      const keyword = this.previous;
      this.expectPunctuation("<", "Expected `<` after `nullable`.");
      const inner = this.parseTypeNode();
      const closeAngle = this.expectPunctuation(
        ">",
        "Expected `>` to close nullable type.",
      );
      if (!keyword || !inner || !closeAngle) {
        return null;
      }
      return {
        kind: "NullableType",
        inner,
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: closeAngle.span.end,
        },
      } satisfies NullableTypeNode;
    }

    if (this.is("identifier")) {
      const token = this.advance();
      const typeArguments = this.parseTypeArguments();
      const end =
        typeArguments.length > 0
          ? (this.previous?.span.end ?? token.span.end)
          : token.span.end;
      return this.withArraySuffix({
        kind: "TypeReference",
        name: token.text,
        typeArguments,
        span: {
          sourceFile: token.span.sourceFile,
          start: token.span.start,
          end,
        },
      } satisfies TypeReferenceNode);
    }

    this.errorAtCurrent(
      "BANK-SYN-002",
      `Unexpected token ${this.current.text}.`,
      "Expected a type annotation.",
    );
    return null;
  }

  /**
   * Parses `<T, U>` in a declaration position.
   *
   * Only a declaration may introduce type parameters, so there is no ambiguity
   * with the comparison operator here.
   */
  private parseTypeParameters(): TypeParameterNode[] {
    if (!this.isPunctuation("<")) {
      return [];
    }

    this.advance();
    const parameters: TypeParameterNode[] = [];
    while (!this.is("eof") && !this.isPunctuation(">")) {
      const token = this.expectIdentifier("Expected a type parameter name.");
      if (!token) {
        break;
      }
      parameters.push({
        kind: "TypeParameter",
        name: token.text,
        span: token.span,
      });
      if (!this.matchPunctuation(",")) {
        break;
      }
    }
    this.expectPunctuation(
      ">",
      "Expected `>` to close the type parameter list.",
    );
    return parameters;
  }

  /**
   * Parses `<Money>` after a type name.
   *
   * A type position never contains a comparison, so consuming `<` here is
   * unambiguous — unlike a call site, which is why generic functions infer
   * their arguments instead of taking them explicitly.
   */
  private parseTypeArguments(): TypeNode[] {
    if (!this.isPunctuation("<")) {
      return [];
    }

    this.advance();
    const args: TypeNode[] = [];
    while (!this.is("eof") && !this.isPunctuation(">")) {
      const argument = this.parseTypeNode();
      if (!argument) {
        break;
      }
      args.push(argument);
      if (!this.matchPunctuation(",")) {
        break;
      }
    }
    this.expectPunctuation(
      ">",
      "Expected `>` to close the type argument list.",
    );
    return args;
  }

  /** Applies a `[n]` suffix, producing a bounded array type. */
  private withArraySuffix(type: TypeNode): TypeNode | null {
    if (!this.isPunctuation("[")) {
      return type;
    }

    this.advance();
    const lengthToken = this.expectNumber("Expected an array length.");
    const close = this.expectPunctuation(
      "]",
      "Expected `]` after array length.",
    );
    if (!lengthToken || !close) {
      return null;
    }

    return {
      kind: "ArrayType",
      element: type,
      length: Number(lengthToken.text),
      span: {
        sourceFile: type.span.sourceFile,
        start: type.span.start,
        end: close.span.end,
      },
    } satisfies ArrayTypeNode;
  }

  private expectKeyword(keyword: string, message: string): Token | null {
    if (this.matchKeyword(keyword)) {
      return this.previous;
    }
    this.errorAtCurrent(
      "BANK-SYN-001",
      message,
      `Expected keyword \`${keyword}\`.`,
    );
    return null;
  }

  private expectIdentifier(message: string): Token | null {
    if (this.is("identifier")) {
      return this.advance();
    }
    this.errorAtCurrent("BANK-SYN-001", message, "Expected an identifier.");
    return null;
  }

  private expectNumber(message: string): Token | null {
    if (this.is("number")) {
      return this.advance();
    }
    this.errorAtCurrent("BANK-SYN-001", message, "Expected a number.");
    return null;
  }

  private expectPunctuation(symbol: string, message: string): Token | null {
    if (this.matchPunctuation(symbol)) {
      return this.previous;
    }
    this.errorAtCurrent("BANK-SYN-001", message, `Expected \`${symbol}\`.`);
    return null;
  }

  private matchKeyword(keyword: string): boolean {
    if (this.current.kind === "keyword" && this.current.text === keyword) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchPunctuation(symbol: string): boolean {
    if (this.current.kind === "punctuation" && this.current.text === symbol) {
      this.advance();
      return true;
    }
    return false;
  }

  private isKeyword(keyword: string): boolean {
    return this.current.kind === "keyword" && this.current.text === keyword;
  }

  private is(kind: TokenKind): boolean {
    return this.current.kind === kind;
  }

  private isPunctuation(symbol: string): boolean {
    return this.current.kind === "punctuation" && this.current.text === symbol;
  }

  /**
   * Hands control to the lexer for a raw brace-delimited scan.
   *
   * The parser keeps two tokens of lookahead, so those are discarded and
   * refilled once the raw text has been consumed.
   */
  private captureSqlBody(): {
    text: string;
    endLine: number;
    endColumn: number;
  } | null {
    if (!this.isPunctuation("{")) {
      return null;
    }

    // `current` is the open brace and `next` is already lexed past it, so the
    // raw scan must start from the brace itself.
    const captured = this.lexer.captureBracedTextFrom(
      this.current.offset,
      this.current.span.start.line,
      this.current.span.start.column,
    );
    if (!captured) {
      return null;
    }

    this.current = this.lexer.nextToken();
    this.next = this.lexer.nextToken();
    return captured;
  }

  private advance(): Token {
    const token = this.current;
    this.previous = token;
    this.current = this.next;
    this.next = this.lexer.nextToken();
    return token;
  }

  private errorAtCurrent(id: string, message: string, hint?: string): void {
    this.diagnostics.push(
      createDiagnostic({
        id,
        severity: "error",
        message,
        span:
          this.current.kind === "eof"
            ? (this.previous?.span ?? null)
            : this.current.span,
        hint: hint ?? null,
        backendProfile: null,
      }),
    );
  }

  private synchronizeToDeclaration(): void {
    while (!this.is("eof")) {
      if (
        this.current.kind === "keyword" &&
        ["type", "record", "function", "transaction", "file"].includes(
          this.current.text,
        )
      ) {
        return;
      }
      this.advance();
    }
  }

  private synchronizeToFieldOrRecordEnd(): void {
    while (!this.is("eof")) {
      if (this.current.kind === "punctuation" && this.current.text === "}") {
        return;
      }
      if (
        this.current.kind === "identifier" &&
        this.next.kind === "punctuation" &&
        this.next.text === ":"
      ) {
        return;
      }
      this.advance();
    }
  }

  private synchronizeToParameterOrEnd(): void {
    while (!this.is("eof")) {
      if (
        this.current.kind === "identifier" &&
        this.next.kind === "punctuation" &&
        this.next.text === ":"
      ) {
        return;
      }
      if (this.current.kind === "punctuation" && this.current.text === ")") {
        return;
      }
      this.advance();
    }
  }

  private synchronizeToStatementOrBlockEnd(): void {
    while (!this.is("eof")) {
      if (
        this.current.kind === "keyword" &&
        (this.current.text === "return" ||
          this.current.text === "if" ||
          this.current.text === "else" ||
          this.current.text === "let")
      ) {
        return;
      }
      if (
        this.current.kind === "identifier" &&
        (LEDGER_OPERATIONS.has(this.current.text) ||
          this.current.text === AUDIT_OPERATION) &&
        this.next.kind === "punctuation" &&
        this.next.text === "("
      ) {
        return;
      }
      if (this.current.kind === "punctuation" && this.current.text === "}") {
        return;
      }
      this.advance();
    }
  }

  private currentEnd(): SourcePosition {
    return this.previous?.span.end ?? this.current.span.end;
  }
}

export function parseBankTs(source: string, sourceFile: string): ParsedProgram {
  const parser = new Parser(source, sourceFile);
  return parser.parseProgram();
}

export function parseBankTsToJson(source: string, sourceFile: string): unknown {
  return astToJson(parseBankTs(source, sourceFile));
}
