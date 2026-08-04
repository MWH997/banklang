import type {
  BlockNode,
  CommentTrivia,
  DeclarationNode,
  Diagnostic,
  ExpressionNode,
  FieldDeclarationNode,
  ParameterNode,
  ProgramNode,
  StatementNode,
  TypeNode,
} from "../../ast/src/index";
import { parseBankTs } from "../../parser/src/index";

const INDENT = "  ";

export interface FormatResult {
  /** Formatted source, or the original text when parsing failed. */
  text: string;
  /** True when the input was already formatted. */
  unchanged: boolean;
  /**
   * Parse diagnostics. Formatting is skipped when this is non-empty: a
   * formatter must never rewrite source it could not fully understand.
   */
  diagnostics: Diagnostic[];
}

/**
 * Formats BankTS source deterministically.
 *
 * The formatter prints from the AST rather than rewriting text, so output shape
 * is decided by one code path. Comments are captured by the lexer as trivia and
 * reattached by line, because a formatter that silently deletes comments is
 * worse than no formatter.
 */
export function formatBankTs(
  source: string,
  sourceFile = "main.bank.ts",
): FormatResult {
  const parsed = parseBankTs(source, sourceFile);

  if (!parsed.program || parsed.diagnostics.length > 0) {
    return { text: source, unchanged: true, diagnostics: parsed.diagnostics };
  }

  const text = printProgram(parsed.program, parsed.comments);
  return { text, unchanged: text === source, diagnostics: [] };
}

class Printer {
  private readonly lines: string[] = [];
  private readonly comments: CommentTrivia[];
  private commentIndex = 0;

  public constructor(comments: CommentTrivia[]) {
    this.comments = [...comments].sort(
      (left, right) => left.span.start.line - right.span.start.line,
    );
  }

  /** Emits any own-line comments that appeared before `line` in the source. */
  public flushCommentsBefore(line: number, indent: string): void {
    while (
      this.commentIndex < this.comments.length &&
      this.comments[this.commentIndex].span.start.line < line
    ) {
      const comment = this.comments[this.commentIndex];
      this.commentIndex += 1;
      if (comment.ownLine) {
        this.push(`${indent}// ${comment.text}`.trimEnd());
      }
    }
  }

  /**
   * A trailing comment sits on the same source line as the code it annotates,
   * so it is appended rather than given a line of its own.
   */
  public trailingCommentFor(line: number): string {
    const index = this.comments.findIndex(
      (comment, position) =>
        position >= this.commentIndex &&
        !comment.ownLine &&
        comment.span.start.line === line,
    );
    if (index === -1) {
      return "";
    }
    const comment = this.comments[index];
    this.comments.splice(index, 1);
    return ` // ${comment.text}`;
  }

  /**
   * The source line where the next construct's block visually begins, taking
   * any own-line comments attached to it into account. Used to decide whether
   * the author left a blank line worth keeping.
   */
  public visualStartLine(line: number): number {
    for (
      let index = this.commentIndex;
      index < this.comments.length;
      index += 1
    ) {
      const comment = this.comments[index];
      if (comment.span.start.line >= line) {
        break;
      }
      if (comment.ownLine) {
        return comment.span.start.line;
      }
    }
    return line;
  }

  /**
   * Keeps a single blank line where the author left one. Grouping inside a
   * body is meaningful, so the formatter normalises runs of blank lines to one
   * rather than removing them.
   */
  public separateIfAuthorDid(
    nextLine: number,
    previousEndLine: number | null,
  ): void {
    if (previousEndLine === null) {
      return;
    }
    if (this.visualStartLine(nextLine) - previousEndLine > 1) {
      this.push("");
    }
  }

  public flushRemaining(): void {
    while (this.commentIndex < this.comments.length) {
      const comment = this.comments[this.commentIndex];
      this.commentIndex += 1;
      if (comment.ownLine) {
        this.push(`// ${comment.text}`.trimEnd());
      }
    }
  }

  public push(line: string): void {
    this.lines.push(line);
  }

  public blankLine(): void {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== "") {
      this.lines.push("");
    }
  }

  public toString(): string {
    const trimmed = [...this.lines];
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
      trimmed.pop();
    }
    return `${trimmed.join("\n")}\n`;
  }
}

function printProgram(program: ProgramNode, comments: CommentTrivia[]): string {
  const printer = new Printer(comments);

  printer.flushCommentsBefore(program.module.span.start.line, "");
  printer.push(
    `module ${program.module.name};${printer.trailingCommentFor(program.module.span.start.line)}`,
  );

  for (const declaration of program.declarations) {
    printer.blankLine();
    printer.flushCommentsBefore(declaration.span.start.line, "");
    printDeclaration(declaration, printer);
  }

  printer.blankLine();
  printer.flushRemaining();
  return printer.toString();
}

function printDeclaration(
  declaration: DeclarationNode,
  printer: Printer,
): void {
  const trailing = printer.trailingCommentFor(declaration.span.start.line);

  switch (declaration.kind) {
    case "TypeAliasDeclaration":
      printer.push(
        `type ${declaration.name} = ${printType(declaration.type)};${trailing}`,
      );
      return;

    case "RecordDeclaration": {
      printer.push(`record ${declaration.name} {${trailing}`);
      let previousLine: number | null = null;
      for (const field of declaration.fields) {
        printer.separateIfAuthorDid(field.span.start.line, previousLine);
        printer.flushCommentsBefore(field.span.start.line, INDENT);
        printField(field, printer);
        previousLine = field.span.end.line;
      }
      printer.push("}");
      return;
    }

    case "FunctionDeclaration":
      printer.push(
        `function ${declaration.name}(${printParameters(declaration.parameters)}): ${printType(declaration.returnType)} {${trailing}`,
      );
      printBlockBody(declaration.body, printer, 1);
      printer.push("}");
      return;

    case "TransactionDeclaration":
      printer.push(
        `transaction ${declaration.name}(${printParameters(declaration.parameters)}) {${trailing}`,
      );
      printBlockBody(declaration.body, printer, 1);
      printer.push("}");
      return;

    case "FileDeclaration": {
      const status = declaration.statusName
        ? ` status ${declaration.statusName}`
        : "";
      printer.push(
        `file ${declaration.name} ${declaration.organization} ${declaration.mode} record ${declaration.recordTypeName}${status};${trailing}`,
      );
      return;
    }
  }
}

function printField(field: FieldDeclarationNode, printer: Printer): void {
  const trailing = printer.trailingCommentFor(field.span.start.line);
  printer.push(`${INDENT}${field.name}: ${printType(field.type)};${trailing}`);
}

function printParameters(parameters: ParameterNode[]): string {
  return parameters
    .map((parameter) => `${parameter.name}: ${printType(parameter.type)}`)
    .join(", ");
}

function printBlockBody(
  block: BlockNode,
  printer: Printer,
  depth: number,
): void {
  const indent = INDENT.repeat(depth);
  let previousLine: number | null = null;
  for (const statement of block.statements) {
    printer.separateIfAuthorDid(statement.span.start.line, previousLine);
    printer.flushCommentsBefore(statement.span.start.line, indent);
    printStatement(statement, printer, depth);
    previousLine = statement.span.end.line;
  }
}

function printStatement(
  statement: StatementNode,
  printer: Printer,
  depth: number,
): void {
  const indent = INDENT.repeat(depth);
  const trailing = printer.trailingCommentFor(statement.span.start.line);

  switch (statement.kind) {
    case "LetStatement":
      printer.push(
        `${indent}let ${statement.name}: ${printType(statement.type)} = ${printExpression(statement.expression)};${trailing}`,
      );
      return;

    case "ReturnStatement":
      printer.push(
        `${indent}return ${printExpression(statement.expression)};${trailing}`,
      );
      return;

    case "IfStatement":
      printer.push(
        `${indent}if ${printExpression(statement.condition)} {${trailing}`,
      );
      printBlockBody(statement.thenBranch, printer, depth + 1);
      if (statement.elseBranch) {
        printer.push(`${indent}} else {`);
        printBlockBody(statement.elseBranch, printer, depth + 1);
      }
      printer.push(`${indent}}`);
      return;

    case "LedgerStatement":
      printer.push(
        `${indent}${statement.operation}(${printExpression(statement.account)}, ${printExpression(statement.amount)});${trailing}`,
      );
      return;

    case "AuditStatement":
      printer.push(
        `${indent}audit(${printExpression(statement.eventName)}, ${printExpression(statement.correlation)});${trailing}`,
      );
      return;
  }
}

function printType(type: TypeNode): string {
  switch (type.kind) {
    case "DecimalType":
      return `decimal<${type.precision}, ${type.scale}>`;
    case "StringType":
      return `string<${type.length}>`;
    case "BoolType":
      return "bool";
    case "TypeReference":
      return type.name;
  }
}

function printExpression(expression: ExpressionNode): string {
  switch (expression.kind) {
    case "Identifier":
      return expression.name;
    case "DecimalLiteral":
      return expression.text;
    case "BooleanLiteral":
      return expression.value ? "true" : "false";
    case "StringLiteral":
      return `"${expression.value}"`;
    case "MemberAccess":
      return `${expression.target.name}.${expression.member}`;
    case "BinaryExpression":
      return `${printExpression(expression.left)} ${expression.operator} ${printExpression(expression.right)}`;
  }
}
