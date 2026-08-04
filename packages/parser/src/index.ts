import {
  astToJson,
  createDiagnostic,
  type BlockNode,
  type BooleanLiteralNode,
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
} from "../../ast/src/index";

type TokenKind =
  "identifier" | "number" | "string" | "keyword" | "punctuation" | "eof";

interface Token {
  kind: TokenKind;
  text: string;
  span: SourceSpan;
}

const KEYWORDS = new Set([
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
  "let",
  "if",
  "else",
  "transaction",
  "file",
]);

/**
 * File declaration clause words are matched contextually so `sequential`,
 * `input`, `output`, and `status` stay usable as field and parameter names.
 */
const FILE_MODES = new Set(["input", "output"]);
const FILE_ORGANIZATIONS = new Set(["sequential"]);

/**
 * Ledger and audit operations are matched contextually rather than reserved as
 * keywords, so `debit`, `credit`, and `audit` remain usable as field and
 * parameter names.
 */
const LEDGER_OPERATIONS = new Set(["debit", "credit"]);
const AUDIT_OPERATION = "audit";

class Lexer {
  private readonly source: string;
  private readonly sourceFile: string;
  private offset = 0;
  private line = 1;
  private column = 1;

  public constructor(source: string, sourceFile: string) {
    this.source = source;
    this.sourceFile = sourceFile;
  }

  public nextToken(): Token {
    this.skipTrivia();

    if (this.offset >= this.source.length) {
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
        while (
          this.offset < this.source.length &&
          this.source[this.offset] !== "\n"
        ) {
          this.advance(this.source[this.offset]);
        }
        continue;
      }

      break;
    }
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

  public parseProgram(): ParsedProgram {
    const declarations: DeclarationNode[] = [];
    const moduleDeclaration = this.parseModuleDeclaration();
    if (!moduleDeclaration) {
      return { program: null, diagnostics: this.diagnostics };
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
      return { program: null, diagnostics: this.diagnostics };
    }

    return {
      program,
      diagnostics: this.diagnostics,
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

    if (this.matchKeyword("transaction")) {
      return this.parseTransactionDeclaration();
    }

    if (this.matchKeyword("file")) {
      return this.parseFileDeclaration();
    }

    this.errorAtCurrent(
      "BANK-SYN-002",
      `Unexpected token ${this.current.text}.`,
      "Expected a declaration.",
    );
    return null;
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
      organization: organizationToken.text as "sequential",
      mode: modeToken.text as "input" | "output",
      recordTypeName: recordTypeToken.text,
      statusName,
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

  private parseTransactionDeclaration(): TransactionDeclarationNode | null {
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
    const body = this.parseBlock();

    if (!nameToken || !openParen || !closeParen || !body) {
      return null;
    }

    return {
      kind: "TransactionDeclaration",
      name: nameToken.text,
      parameters,
      body,
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
      fields,
      span: {
        sourceFile: nameToken.span.sourceFile,
        start: nameToken.span.start,
        end: endToken.span.end,
      },
    };
  }

  private parseFieldDeclaration(): FieldDeclarationNode | null {
    const nameToken = this.expectIdentifier("Expected field name.");
    this.expectPunctuation(":", "Expected `:` after field name.");
    const type = this.parseTypeNode();
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
      span: {
        sourceFile: nameToken.span.sourceFile,
        start: nameToken.span.start,
        end: semicolon.span.end,
      },
    };
  }

  private parseFunctionDeclaration(): FunctionDeclarationNode | null {
    const nameToken = this.expectIdentifier("Expected function name.");
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

  private parseBlock(): BlockNode | null {
    const openBrace = this.expectPunctuation(
      "{",
      "Expected `{` to start function body.",
    );
    const statements: StatementNode[] = [];

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

    this.errorAtCurrent(
      "BANK-SYN-002",
      `Unexpected token ${this.current.text}.`,
      "Expected a statement.",
    );
    return null;
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
    return this.parseComparisonExpression();
  }

  private parseComparisonExpression(): ExpressionNode | null {
    const left = this.parseAdditiveExpression();
    if (!left) {
      return null;
    }

    if (this.matchPunctuation(">")) {
      const operatorToken = this.previous;
      const right = this.parseAdditiveExpression();
      if (!right || !operatorToken) {
        return null;
      }

      return {
        kind: "BinaryExpression",
        operator: ">",
        left,
        right,
        span: {
          sourceFile: left.span.sourceFile,
          start: left.span.start,
          end: right.span.end,
        },
      };
    }

    return left;
  }

  private parseAdditiveExpression(): ExpressionNode | null {
    let expression = this.parsePrimaryExpression();
    if (!expression) {
      return null;
    }

    while (this.isPunctuation("+") || this.isPunctuation("-")) {
      const operatorToken = this.advance();
      const right = this.parsePrimaryExpression();
      if (!right) {
        return null;
      }

      expression = {
        kind: "BinaryExpression",
        operator: operatorToken.text as "+" | "-",
        left: expression,
        right,
        span: {
          sourceFile: expression.span.sourceFile,
          start: expression.span.start,
          end: right.span.end,
        },
      };
    }

    return expression;
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
      const token = this.advance();
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

        return {
          kind: "MemberAccess",
          target: identifier,
          member: memberToken.text,
          span: {
            sourceFile: token.span.sourceFile,
            start: token.span.start,
            end: memberToken.span.end,
          },
        } satisfies MemberAccessNode;
      }

      return identifier;
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
      return {
        kind: "DecimalType",
        precision: Number(precisionToken.text),
        scale: Number(scaleToken.text),
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: closeAngle.span.end,
        },
      } satisfies DecimalTypeNode;
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
      return {
        kind: "StringType",
        length: Number(lengthToken.text),
        span: {
          sourceFile: keyword.span.sourceFile,
          start: keyword.span.start,
          end: closeAngle.span.end,
        },
      } satisfies StringTypeNode;
    }

    if (this.matchKeyword("bool")) {
      const keyword = this.previous;
      if (!keyword) {
        return null;
      }
      return {
        kind: "BoolType",
        span: keyword.span,
      } satisfies BoolTypeNode;
    }

    if (this.is("identifier")) {
      const token = this.advance();
      return {
        kind: "TypeReference",
        name: token.text,
        span: token.span,
      } satisfies TypeReferenceNode;
    }

    this.errorAtCurrent(
      "BANK-SYN-002",
      `Unexpected token ${this.current.text}.`,
      "Expected a type annotation.",
    );
    return null;
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

  private is(kind: TokenKind): boolean {
    return this.current.kind === kind;
  }

  private isPunctuation(symbol: string): boolean {
    return this.current.kind === "punctuation" && this.current.text === symbol;
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
