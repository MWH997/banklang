import type {
  BlockNode,
  ExpressionNode,
  FieldDeclarationNode,
  FunctionDeclarationNode,
  ParameterNode,
  RecordDeclarationNode,
  StatementNode,
  TypeNode,
} from "../../ast/src/index";

/**
 * Compile-time monomorphisation for BankTS generics.
 *
 * COBOL has no runtime polymorphism and no boxing: a `PIC` clause is a fixed
 * layout decided when the program is compiled. A generic declaration therefore
 * cannot survive into the generated program in any form. Every instantiation is
 * expanded into a distinct concrete record or paragraph, so what a reviewer
 * reads in the COBOL is ordinary COBOL with no indirection to unpick.
 *
 * The cost is deliberate and worth stating: two instantiations of the same
 * generic produce two copies of the storage and the code.
 */

/** A binding from type parameter name to the type node it stands for. */
export type Substitution = ReadonlyMap<string, TypeNode>;

/**
 * Builds the mangled name of an instantiation, such as `Box$Money`.
 *
 * The name is derived only from the type arguments, so the same instantiation
 * requested from two places resolves to one declaration and one copy of the
 * generated COBOL.
 */
export function mangleInstantiation(
  baseName: string,
  typeArguments: readonly TypeNode[],
): string {
  if (typeArguments.length === 0) {
    return baseName;
  }

  return `${baseName}$${typeArguments.map(describeTypeNode).join("$")}`;
}

/** A stable, name-safe rendering of a type node for use in a mangled name. */
export function describeTypeNode(node: TypeNode): string {
  switch (node.kind) {
    case "DecimalType":
      // Usage is part of the instantiation: two fields with the same digits but
      // different storage generate different COBOL.
      return `${
        node.usage === "binary"
          ? "bin"
          : node.usage === "display"
            ? "zon"
            : node.usage === "unsigned"
              ? "uns"
              : "dec"
      }${node.precision}_${node.scale}`;
    case "StringType":
      // A national is twice the bytes, so it is a different instantiation.
      return `${node.national ? "nat" : "str"}${node.length}`;
    case "BoolType":
      return "bool";
    case "TemporalType":
      return node.unit;
    case "EditedType":
      return `edt${node.style}${describeTypeNode(node.inner)}`;
    case "CurrencyType":
      return `cur${node.code}${node.precision}_${node.scale}`;
    case "NullableType":
      return `opt${describeTypeNode(node.inner)}`;
    case "ArrayType":
      return `arr${node.length}_${describeTypeNode(node.element)}`;
    case "TypeReference":
      return node.typeArguments.length > 0
        ? mangleInstantiation(node.name, node.typeArguments)
        : node.name;
  }
}

/** Rewrites a type node, replacing every type parameter reference. */
export function substituteType(
  node: TypeNode,
  substitution: Substitution,
): TypeNode {
  switch (node.kind) {
    case "EditedType":
    case "TemporalType":
    case "DecimalType":
    case "StringType":
    case "BoolType":
    case "CurrencyType":
      return node;
    case "NullableType":
      return {
        ...node,
        inner: substituteType(node.inner, substitution),
      };
    case "ArrayType":
      return {
        ...node,
        element: substituteType(node.element, substitution),
      };
    case "TypeReference": {
      const bound = substitution.get(node.name);
      if (bound && node.typeArguments.length === 0) {
        // Keep the use site's span so a diagnostic points at the code the
        // author wrote, not at the generic declaration.
        return { ...bound, span: node.span };
      }

      return {
        ...node,
        typeArguments: node.typeArguments.map((argument) =>
          substituteType(argument, substitution),
        ),
      };
    }
  }
}

/** Produces a concrete record declaration from a generic one. */
export function instantiateRecord(
  declaration: RecordDeclarationNode,
  substitution: Substitution,
  name: string,
): RecordDeclarationNode {
  return {
    ...declaration,
    name,
    typeParameters: [],
    baseType: declaration.baseType
      ? (substituteType(
          declaration.baseType,
          substitution,
        ) as RecordDeclarationNode["baseType"] & object)
      : null,
    fields: declaration.fields.map((field): FieldDeclarationNode => ({
      ...field,
      type: substituteType(field.type, substitution),
    })),
  };
}

/** Produces a concrete function declaration from a generic one. */
export function instantiateFunction(
  declaration: FunctionDeclarationNode,
  substitution: Substitution,
  name: string,
): FunctionDeclarationNode {
  return {
    ...declaration,
    name,
    typeParameters: [],
    parameters: declaration.parameters.map((parameter): ParameterNode => ({
      ...parameter,
      type: substituteType(parameter.type, substitution),
    })),
    returnType: substituteType(declaration.returnType, substitution),
    body: substituteBlock(declaration.body, substitution),
  };
}

/**
 * Rewrites type annotations inside a body.
 *
 * Only `let` carries a type annotation in the statement grammar, but blocks
 * nest, so every statement that owns a block has to be walked.
 */
function substituteBlock(
  block: BlockNode,
  substitution: Substitution,
): BlockNode {
  return {
    ...block,
    statements: block.statements.map((statement) =>
      substituteStatement(statement, substitution),
    ),
  };
}

function substituteStatement(
  statement: StatementNode,
  substitution: Substitution,
): StatementNode {
  switch (statement.kind) {
    case "LetStatement":
      return {
        ...statement,
        type: substituteType(statement.type, substitution),
        expression: cloneExpression(statement.expression),
      };
    case "IfStatement":
      return {
        ...statement,
        condition: cloneExpression(statement.condition),
        thenBranch: substituteBlock(statement.thenBranch, substitution),
        elseBranch: statement.elseBranch
          ? substituteBlock(statement.elseBranch, substitution)
          : null,
      };
    case "WhileStatement":
      return {
        ...statement,
        body: substituteBlock(statement.body, substitution),
      };
    case "ForEachStatement":
      return {
        ...statement,
        body: substituteBlock(statement.body, substitution),
      };
    case "SwitchStatement":
      return {
        ...statement,
        subject: cloneExpression(statement.subject),
        cases: statement.cases.map((entry) => ({
          ...entry,
          body: substituteBlock(entry.body, substitution),
        })),
        otherwise: statement.otherwise
          ? substituteBlock(statement.otherwise, substitution)
          : null,
      };
    default:
      return cloneStatement(statement);
  }
}

/**
 * Clones a statement so two instantiations never share a node.
 *
 * Sharing would be observable: call expressions are matched by node identity
 * when a call is rewritten to its instantiated target, so one shared node would
 * make the second instantiation overwrite the first one's target.
 */
function cloneStatement(statement: StatementNode): StatementNode {
  switch (statement.kind) {
    case "ReturnStatement":
      return {
        ...statement,
        expression: cloneExpression(statement.expression),
      };
    case "AssignStatement":
      return {
        ...statement,
        target: cloneExpression(statement.target) as typeof statement.target,
        expression: cloneExpression(statement.expression),
      };
    case "ExpressionStatement":
      return {
        ...statement,
        expression: cloneExpression(statement.expression),
      };
    case "LedgerStatement":
      return {
        ...statement,
        account: cloneExpression(statement.account),
        amount: cloneExpression(statement.amount),
      };
    case "AuditStatement":
      return {
        ...statement,
        eventName: cloneExpression(statement.eventName),
        correlation: cloneExpression(statement.correlation),
      };
    default:
      return { ...statement };
  }
}

function cloneExpression(expression: ExpressionNode): ExpressionNode {
  switch (expression.kind) {
    case "BinaryExpression":
      return {
        ...expression,
        left: cloneExpression(expression.left),
        right: cloneExpression(expression.right),
      };
    case "UnaryExpression":
      return { ...expression, operand: cloneExpression(expression.operand) };
    case "RoundedExpression":
      return { ...expression, operand: cloneExpression(expression.operand) };
    case "CallExpression":
      return {
        ...expression,
        args: expression.args.map(cloneExpression),
      };
    case "MemberAccess":
      return {
        ...expression,
        target: cloneExpression(expression.target) as typeof expression.target,
      };
    case "IndexAccess":
      return {
        ...expression,
        target: cloneExpression(expression.target) as typeof expression.target,
        index: cloneExpression(expression.index),
      };
    case "NullableCheck":
      return { ...expression, operand: cloneExpression(expression.operand) };
    default:
      return { ...expression };
  }
}
