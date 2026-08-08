import type {
  BlockNode,
  ReportSourceNode,
  CommentTrivia,
  DeclarationNode,
  Diagnostic,
  ExpressionNode,
  FieldDeclarationNode,
  ParameterNode,
  ProgramNode,
  TypeParameterNode,
  StatementNode,
  TestStepNode,
  TypeNode,
} from "../../ast/src/index";
import { parseBankTs } from "../../parser/src/index";
import { CompilerInvariant } from "../../diagnostics/src/errors";

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
      this.comments[this.commentIndex]!.span.start.line < line
    ) {
      const comment = this.comments[this.commentIndex]!;
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
    const comment = this.comments[index]!;
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
      const comment = this.comments[index]!;
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
      const comment = this.comments[this.commentIndex]!;
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
      const base = declaration.baseType
        ? ` extends ${printType(declaration.baseType)}`
        : "";
      printer.push(
        `record ${declaration.name}${printTypeParameters(declaration.typeParameters)}${base} {${trailing}`,
      );
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
        `function ${declaration.name}${printTypeParameters(declaration.typeParameters)}(${printParameters(declaration.parameters)}): ${printType(declaration.returnType)} {${trailing}`,
      );
      printBlockBody(declaration.body, printer, 1);
      printer.push("}");
      return;

    case "TransactionDeclaration": {
      const modifiers = `${declaration.isEntry ? "entry " : ""}${declaration.isCics ? "cics " : ""}`;
      printer.push(
        `${modifiers}transaction ${declaration.name}(${printParameters(declaration.parameters)}) {${trailing}`,
      );
      if (declaration.failureHandler) {
        printer.push(`${INDENT}on failure {`);
        printBlockBody(declaration.failureHandler.body, printer, 2);
        printer.push(`${INDENT}}`);
        printer.push("");
      }
      printBlockBody(declaration.body, printer, 1);
      printer.push("}");
      return;
    }

    case "FileDeclaration": {
      const key = declaration.keyField ? ` key ${declaration.keyField}` : "";
      const alternates =
        declaration.alternateKeys.length > 0
          ? ` alternate ${declaration.alternateKeys.join(", ")}`
          : "";
      const varying = declaration.recordVarying
        ? ` varying ${declaration.recordVarying.min} to ${declaration.recordVarying.max} length ${declaration.recordVarying.lengthName}`
        : "";
      const linage = declaration.linage
        ? [
            ` page ${declaration.linage.lines}`,
            declaration.linage.footingAt === null
              ? ""
              : ` footing ${declaration.linage.footingAt}`,
            declaration.linage.linesAtTop === null
              ? ""
              : ` top ${declaration.linage.linesAtTop}`,
            declaration.linage.linesAtBottom === null
              ? ""
              : ` bottom ${declaration.linage.linesAtBottom}`,
          ].join("")
        : "";
      const status = declaration.statusName
        ? ` status ${declaration.statusName}`
        : "";
      printer.push(
        `file ${declaration.name} ${declaration.organization} ${declaration.mode} record ${declaration.recordTypeName}${key}${alternates}${varying}${linage}${status};${trailing}`,
      );
      return;
    }

    case "DatabaseDeclaration": {
      const status = declaration.statusName
        ? ` status ${declaration.statusName}`
        : "";
      /*
       * `pcb`, and the key as the string literal it is.
       *
       * This printed neither: it dropped the `pcb` keyword and wrote
       * `key ACCTID` where the source said `key "ACCTID"`. The result was not
       * a program that meant something else — it was a file that no longer
       * parsed, failing with `Expected \`pcb\` after the database name` on the
       * next build. `bankc fmt` destroying the source it was handed is the
       * worst outcome available to it.
       *
       * A DL/I database is reached through a PCB the region passes in, so the
       * keyword is not decoration, and the segment and key are DBD names —
       * quoted, because they are the database's spelling and not BankTS
       * identifiers.
       */
      printer.push(
        `database ${declaration.name} pcb segment "${declaration.segmentName}" key "${declaration.keyName}" record ${declaration.recordTypeName}${status};${trailing}`,
      );
      return;
    }

    case "QueueDeclaration": {
      const status = declaration.statusName
        ? ` status ${declaration.statusName}`
        : "";
      printer.push(
        `queue ${declaration.name} manager "${declaration.managerName}" name "${declaration.queueName}" ${declaration.direction} record ${declaration.recordTypeName}${status};${trailing}`,
      );
      return;
    }

    case "FileErrorHandler":
      printer.push(`on error ${declaration.fileName} {${trailing}`);
      printBlockBody(declaration.body, printer, 1);
      printer.push("}");
      return;

    case "ReportDeclaration": {
      const controls =
        declaration.controls.length > 0
          ? ` control ${declaration.controls.map((entry) => entry.name).join(", ")}`
          : "";
      const page = declaration.page
        ? [
            ` page ${declaration.page.limit}`,
            declaration.page.heading === null
              ? ""
              : ` heading ${declaration.page.heading}`,
            declaration.page.firstDetail === null
              ? ""
              : ` firstDetail ${declaration.page.firstDetail}`,
            declaration.page.lastDetail === null
              ? ""
              : ` lastDetail ${declaration.page.lastDetail}`,
            declaration.page.footing === null
              ? ""
              : ` footing ${declaration.page.footing}`,
          ].join("")
        : "";
      printer.push(
        `report ${declaration.name} on ${declaration.fileName}${controls}${page} {${trailing}`,
      );
      for (const group of declaration.groups) {
        const named = group.name ? ` ${group.name}` : "";
        const control = group.control ? ` ${group.control}` : "";
        printer.push(`${INDENT}${group.type}${named}${control} {`);
        for (const line of group.lines) {
          const position =
            line.position.kind === "absolute"
              ? `line ${line.position.value}`
              : line.position.value === 1
                ? "line next"
                : `line plus ${line.position.value}`;
          printer.push(`${INDENT.repeat(2)}${position} {`);
          for (const column of line.columns) {
            printer.push(
              `${INDENT.repeat(3)}column ${column.column} ${printReportSource(column.source)};`,
            );
          }
          printer.push(`${INDENT.repeat(2)}}`);
        }
        printer.push(`${INDENT}}`);
      }
      printer.push("}");
      return;
    }

    case "SqlDeclaration": {
      const result = declaration.resultTypeName
        ? `: ${declaration.resultTypeName}`
        : "";
      printer.push(
        `${declaration.form === "cursor" ? "cursor" : "sql"} ${declaration.name}(${printParameters(declaration.parameters)})${declaration.hold ? " hold" : ""}${declaration.scroll ? " scroll" : ""}${declaration.rowset === null ? "" : ` rowset ${declaration.rowset}`}${result} {${trailing}`,
      );
      for (const line of declaration.text.split("\n")) {
        printer.push(line.trim().length > 0 ? `${INDENT}${line.trim()}` : "");
      }
      printer.push("}");
      return;
    }

    case "EnumDeclaration":
      printer.push(`enum ${declaration.name} {${trailing}`);
      for (const member of declaration.members) {
        printer.push(`${INDENT}${member},`);
      }
      printer.push("}");
      return;

    case "TestDeclaration":
      printer.push(
        `test ${declaration.name} for ${declaration.transactionName} {${trailing}`,
      );
      for (const step of declaration.steps) {
        printer.push(`${INDENT}${printTestStep(step)}`);
      }
      printer.push("}");
      return;
  }

  unprintable(declaration);
}

/** One line of a `test` body, which is a `given` or an expected call. */
function printTestStep(step: TestStepNode): string {
  switch (step.kind) {
    case "TestGiven":
      return `given ${step.parameter} = ${printExpression(step.value)};`;
    case "TestExpectLedger":
      return `expect ${step.operation}(${printExpression(step.account)}, ${printExpression(step.amount)});`;
    case "TestExpectAudit":
      return `expect audit(${printExpression(step.event)}, ${printExpression(step.correlation)});`;
  }

  unprintable(step);
}

/** One `column` entry's value: a literal, a field, a total, or the page. */
function printReportSource(source: ReportSourceNode): string {
  switch (source.kind) {
    case "ReportLiteral":
      return JSON.stringify(source.value);
    case "ReportField":
      return source.field;
    case "ReportSum":
      return `sum ${source.field}`;
    case "ReportPageNumber":
      return "pageNumber";
  }
}

function printField(field: FieldDeclarationNode, printer: Printer): void {
  const trailing = printer.trailingCommentFor(field.span.start.line);

  // A reserved slot has no name and no type to print: the count is the whole
  // declaration, and the name it carries internally is not one anybody wrote.
  if (field.reserved) {
    printer.push(
      `${INDENT}reserved ${field.type.kind === "StringType" ? field.type.length : 0};${trailing}`,
    );
    return;
  }

  const modifier = field.sensitive ? "sensitive " : "";

  /*
   * `redefines` and `depending on` are part of the declaration, not decoration.
   *
   * They were not printed, so `bankc fmt` deleted them — and the result parsed
   * with no diagnostics, because a field without `redefines` is a perfectly
   * good field. It is a different record: a redefinition is a second reading of
   * storage that already exists, and dropping it makes the field new storage,
   * moving every field after it. Dropping `depending on` fixes a table at its
   * maximum, changing the record's length.
   *
   * Formatting somebody's source and silently changing what it lays out is the
   * worst thing this tool can do. Found by widening the formatter's corpus from
   * `examples/` to every BankTS program in the repository: no example uses
   * either clause, and `conversions/05-redefines-and-odo` uses both.
   */
  const redefines = field.redefines ? ` redefines ${field.redefines}` : "";
  const depending = field.dependingOn
    ? ` depending on ${field.dependingOn}`
    : "";

  printer.push(
    `${INDENT}${modifier}${field.name}: ${printType(field.type)}${redefines}${depending};${trailing}`,
  );
}

function printTypeParameters(parameters: TypeParameterNode[]): string {
  return parameters.length > 0
    ? `<${parameters.map((parameter) => parameter.name).join(", ")}>`
    : "";
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

    case "RaiseStatement":
      printer.push(`${indent}raise "${statement.code}";${trailing}`);
      return;

    case "WhileStatement":
      printer.push(
        `${indent}while ${printExpression(statement.condition)} limit ${statement.limit} {${trailing}`,
      );
      printBlockBody(statement.body, printer, depth + 1);
      printer.push(`${indent}}`);
      return;

    case "AssignStatement":
      printer.push(
        `${indent}${printExpression(statement.target)} = ${printExpression(statement.expression)};${trailing}`,
      );
      return;

    case "ExpressionStatement":
      printer.push(
        `${indent}${printExpression(statement.expression)};${trailing}`,
      );
      return;

    case "FileStatement": {
      // Every clause the statement can carry, because the formatter reprints
      // from the tree rather than editing the text: a clause this misses is
      // one the formatter deletes. `readNext ... into`, `rewrite ... from`,
      // `advancing` and `on page` were all missing, and running the formatter
      // over a browse silently turned `readNext accountMaster into account`
      // into `readNext accountMaster` — which then would not parse, so the
      // damage was at least loud. `write ... advancing page` parses perfectly
      // well without the `advancing`, and quietly writes over the last line.
      const clause =
        statement.recordName === null
          ? ""
          : statement.operation === "read" || statement.operation === "readNext"
            ? ` into ${statement.recordName}`
            : ` from ${statement.recordName}`;
      const key = statement.key ? ` key ${printExpression(statement.key)}` : "";
      const advancing =
        statement.advancing === null ? "" : ` advancing ${statement.advancing}`;
      const head = `${indent}${statement.operation} ${statement.fileName}${clause}${key}${advancing}`;

      if (!statement.atEndOfPage) {
        printer.push(`${head};${trailing}`);
        return;
      }

      printer.push(`${head} on page {`);
      printBlockBody(statement.atEndOfPage, printer, depth + 1);
      printer.push(`${indent}};${trailing}`);
      return;
    }

    case "ConsoleStatement": {
      if (statement.operation === "log") {
        printer.push(
          `${indent}log ${statement.values.map(printExpression).join(", ")};${trailing}`,
        );
        return;
      }
      printer.push(
        `${indent}accept ${statement.source} into ${printExpression(statement.target as ExpressionNode)};${trailing}`,
      );
      return;
    }

    case "UnitOfWorkStatement":
      printer.push(`${indent}${statement.operation};${trailing}`);
      return;

    case "ReturnCodeStatement":
      printer.push(
        `${indent}returnCode = ${printExpression(statement.value)};${trailing}`,
      );
      return;

    case "ResetStatement":
      printer.push(`${indent}reset ${statement.recordName};${trailing}`);
      return;

    case "ReleaseStatement":
      printer.push(`${indent}release ${statement.recordName};${trailing}`);
      return;

    case "SplitStatement":
      printer.push(
        `${indent}split ${printExpression(statement.source)} by ${printExpression(statement.delimiter)} into ${statement.targets.map(printExpression).join(", ")};${trailing}`,
      );
      return;

    case "ReportStatement":
      printer.push(
        `${indent}${statement.operation} ${statement.target};${trailing}`,
      );
      return;

    case "CheckpointStatement":
      printer.push(
        `${indent}checkpoint ${statement.fileName} from ${statement.recordName} every ${statement.every};${trailing}`,
      );
      return;

    case "RestartStatement": {
      printer.push(
        `${indent}restart ${statement.fileName} into ${statement.recordName} {${trailing}`,
      );
      printBlockBody(statement.resumed, printer, depth + 1);
      if (statement.fresh) {
        printer.push(`${indent}} else {`);
        printBlockBody(statement.fresh, printer, depth + 1);
      }
      printer.push(`${indent}}`);
      return;
    }

    case "SerializeStatement": {
      const count = statement.count
        ? ` count ${printExpression(statement.count)}`
        : "";
      const head = `${indent}${statement.format} ${printExpression(statement.target)} from ${printExpression(statement.source)}${count}`;
      if (!statement.onError) {
        printer.push(`${head};${trailing}`);
        return;
      }
      printer.push(`${head} on error {${trailing}`);
      printBlockBody(statement.onError, printer, depth + 1);
      printer.push(`${indent}};`);
      return;
    }

    case "XmlParseStatement": {
      printer.push(
        `${indent}xml parse ${printExpression(statement.source)} into {${trailing}`,
      );
      for (const binding of statement.bindings) {
        printer.push(
          `${indent}${INDENT}"${binding.element}": ${printExpression(binding.target)},`,
        );
      }
      if (!statement.onError) {
        printer.push(`${indent}};`);
        return;
      }
      printer.push(`${indent}} on error {`);
      printBlockBody(statement.onError, printer, depth + 1);
      printer.push(`${indent}};`);
      return;
    }

    case "ProgramCallStatement": {
      const using = statement.using
        ? ` using ${printExpression(statement.using)}`
        : "";
      const head = `${indent}${statement.operation} ${printExpression(statement.program)}${using}`;
      if (!statement.onError) {
        printer.push(`${head};${trailing}`);
        return;
      }
      printer.push(`${head} on error {${trailing}`);
      printBlockBody(statement.onError, printer, depth + 1);
      printer.push(`${indent}};`);
      return;
    }

    case "DliStatement": {
      const record = statement.recordName
        ? ` into ${statement.recordName}`
        : "";
      const key = statement.key ? ` key ${printExpression(statement.key)}` : "";
      printer.push(
        `${indent}${statement.operation} ${statement.databaseName}${record}${key};${trailing}`,
      );
      return;
    }

    case "QueueStatement": {
      if (statement.operation === "connect") {
        printer.push(
          `${indent}connectQueue ${statement.queueName};${trailing}`,
        );
        return;
      }
      if (statement.operation === "disconnect") {
        printer.push(
          `${indent}disconnectQueue ${statement.queueName};${trailing}`,
        );
        return;
      }
      if (statement.operation === "put") {
        printer.push(
          `${indent}putMessage ${statement.queueName} from ${statement.recordName};${trailing}`,
        );
        return;
      }
      printer.push(
        `${indent}getMessage ${statement.queueName} into ${statement.recordName} {${trailing}`,
      );
      printBlockBody(statement.body as BlockNode, printer, depth + 1);
      if (statement.notFound) {
        printer.push(`${indent}} else {`);
        printBlockBody(statement.notFound, printer, depth + 1);
      }
      printer.push(`${indent}};`);
      return;
    }

    case "SortStatement": {
      const keys = statement.keys
        .map((key) => `${key.name}${key.descending ? " descending" : ""}`)
        .join(", ");
      printer.push(
        `${indent}${statement.operation} ${statement.inputs.join(", ")} into ${statement.output} by ${keys}${statement.inputProcedure || statement.outputProcedure ? " {" : ";"}${trailing}`,
      );
      if (statement.inputProcedure) {
        printer.push(`${indent}${INDENT}on input {`);
        printBlockBody(statement.inputProcedure.body, printer, depth + 2);
        printer.push(`${indent}${INDENT}}`);
      }
      if (statement.outputProcedure) {
        printer.push(`${indent}${INDENT}on output {`);
        printBlockBody(statement.outputProcedure.body, printer, depth + 2);
        printer.push(`${indent}${INDENT}}`);
      }
      if (statement.inputProcedure || statement.outputProcedure) {
        printer.push(`${indent}}`);
      }
      return;
    }

    case "SearchStatement": {
      printer.push(
        `${indent}search ${statement.sorted ? "sorted " : ""}${statement.elementName} in ${printExpression(statement.array)} where ${printExpression(statement.condition)} {${trailing}`,
      );
      printBlockBody(statement.body, printer, depth + 1);
      printer.push(`${indent}} else {`);
      printBlockBody(statement.notFound, printer, depth + 1);
      printer.push(`${indent}}`);
      return;
    }

    case "CicsStatement": {
      const program = statement.program ? ` "${statement.program}"` : "";
      const commarea = statement.commarea
        ? ` commarea ${statement.commarea}`
        : "";
      const resp = statement.respName ? ` resp ${statement.respName}` : "";
      printer.push(
        `${indent}${statement.operation}${program}${commarea}${resp};${trailing}`,
      );
      return;
    }

    case "SqlStatement": {
      const into = statement.intoRecord ? ` into ${statement.intoRecord}` : "";
      printer.push(
        `${indent}execute ${statement.name}(${statement.args.map(printExpression).join(", ")})${into};${trailing}`,
      );
      return;
    }

    case "ForEachStatement": {
      printer.push(
        `${indent}for each ${statement.indexName} in ${printExpression(statement.array)} {${trailing}`,
      );
      printBlockBody(statement.body, printer, depth + 1);
      printer.push(`${indent}}`);
      return;
    }

    case "CursorLoopStatement": {
      const args = statement.args.map(printExpression).join(", ");
      // In the order they are read, which is the order they happen: where to
      // start, which way to go, how far.
      const from =
        statement.start === null
          ? ""
          : ` from ${printExpression(statement.start)}`;
      printer.push(
        `${indent}for each ${statement.rowName} in ${statement.cursorName}(${args})${from}${statement.backward ? " backward" : ""} limit ${statement.limit} {${trailing}`,
      );
      printBlockBody(statement.body, printer, depth + 1);
      printer.push(`${indent}}`);
      return;
    }

    case "SwitchStatement": {
      printer.push(
        `${indent}switch ${printExpression(statement.subject)} {${trailing}`,
      );
      for (const branch of statement.cases) {
        printer.push(`${indent}${INDENT}case ${branch.member} {`);
        printBlockBody(branch.body, printer, depth + 2);
        printer.push(`${indent}${INDENT}}`);
      }
      if (statement.otherwise) {
        printer.push(`${indent}${INDENT}else {`);
        printBlockBody(statement.otherwise, printer, depth + 2);
        printer.push(`${indent}${INDENT}}`);
      }
      printer.push(`${indent}}`);
      return;
    }
  }

  unprintable(statement);
}

/**
 * A node the printer has no case for.
 *
 * `never` makes this a compile error rather than a run-time one: a statement
 * kind added to the AST and not to the printer will not typecheck. The throw is
 * the belt to that brace, because the alternative is what actually happened —
 * every switch here simply fell through, printed nothing, and the formatter
 * deleted the statement from the source. `pnpm fmt` silently removed every
 * `log`, `commit`, `rollback`, `checkpoint`, `restart`, `getMessage`, `initiate`
 * and `on error` handler from a program, and the result still parsed.
 */
function unprintable(node: never): never {
  throw new CompilerInvariant(
    `The formatter has no printer for ${(node as { kind: string }).kind}. Formatting would delete it.`,
  );
}

function printType(type: TypeNode): string {
  switch (type.kind) {
    case "DecimalType":
      return type.usage === "binary"
        ? `binary<${type.precision}>`
        : type.usage === "display"
          ? `zoned<${type.precision}, ${type.scale}>`
          : type.usage === "unsigned"
            ? `unsigned<${type.precision}, ${type.scale}>`
            : `decimal<${type.precision}, ${type.scale}>`;
    case "StringType":
      return `${type.national ? "national" : "string"}<${type.length}>`;
    case "BoolType":
      return "bool";
    case "TemporalType":
      return type.unit;
    case "EditedType":
      return `edited<${printType(type.inner)}, "${type.style}">`;
    case "TypeReference":
      return type.typeArguments.length > 0
        ? `${type.name}<${type.typeArguments.map(printType).join(", ")}>`
        : type.name;
    case "CurrencyType":
      return `currency<"${type.code}", ${type.precision}, ${type.scale}>`;
    case "NullableType":
      return `nullable<${printType(type.inner)}>`;
    case "ArrayType":
      return `${printType(type.element)}[${type.length}]`;
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
      return `${printExpression(expression.target)}.${expression.member}`;
    case "BinaryExpression":
      return `${printExpression(expression.left)} ${expression.operator} ${printExpression(expression.right)}`;
    case "UnaryExpression":
      return `!${printExpression(expression.operand)}`;
    case "RoundedExpression":
      return expression.isDivision &&
        expression.operand.kind === "BinaryExpression"
        ? `divide(${printExpression(expression.operand.left)}, ${printExpression(expression.operand.right)}, "${expression.mode}")`
        : `round(${printExpression(expression.operand)}, "${expression.mode}")`;
    case "CallExpression":
      return `${expression.callee}(${expression.args.map(printExpression).join(", ")})`;
    case "EnumMember":
      return `${expression.enumName}.${expression.member}`;
    case "IndexAccess":
      return `${printExpression(expression.target)}[${printExpression(expression.index)}]`;
    case "StringCall":
      return `${expression.operation}(${expression.args.map(printExpression).join(", ")})`;
    case "NumericCall":
    case "TemporalCall":
      return `${expression.operation}(${expression.args.map(printExpression).join(", ")})`;
    case "NullableCheck":
      return `${expression.operation}(${printExpression(expression.operand)})`;
  }
}
