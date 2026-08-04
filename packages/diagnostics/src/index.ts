/**
 * The diagnostic catalogue.
 *
 * Every diagnostic the compiler can emit has an entry here. `bankc explain`
 * reads it, the playground renders it, and `tests/diagnostic-catalogue.test.ts`
 * asserts that no diagnostic identifier appears in compiler source without a
 * catalogue entry. That test is what keeps this file honest.
 *
 * The prose here is the same as `docs/diagnostics.md`, which is the
 * human-readable version of the same catalogue.
 */

export type DiagnosticNamespace =
  | "SYN"
  | "TYPE"
  | "DEC"
  | "TXN"
  | "LED"
  | "AUD"
  | "SQL"
  | "CICS"
  | "FILE"
  | "COPY"
  | "GEN"
  | "SEC";

export interface DiagnosticDoc {
  id: string;
  title: string;
  /** What the compiler observed. */
  explanation: string;
  /** What the author should do about it. */
  remediation: string;
  /** Where the rule comes from, if it is specified rather than internal. */
  specReference?: string;
  /** False when the identifier is reserved but not yet implemented. */
  implemented: boolean;
}

export const NAMESPACE_TITLES: Record<DiagnosticNamespace, string> = {
  SYN: "Syntax",
  TYPE: "Type system",
  DEC: "Decimal and money",
  TXN: "Transaction",
  LED: "Ledger",
  AUD: "Audit",
  SQL: "Db2 and SQL",
  CICS: "CICS",
  FILE: "File I/O",
  COPY: "Copybook and layout",
  GEN: "Code generation",
  SEC: "Security",
};

export const DIAGNOSTICS: DiagnosticDoc[] = [
  {
    id: "BANK-SYN-001",
    title: "Unexpected token",
    explanation:
      "The parser expected a specific keyword, identifier, number, or punctuation mark and found something else.",
    remediation:
      "Check the surrounding declaration against the language reference.",
    implemented: true,
  },
  {
    id: "BANK-SYN-002",
    title: "Unexpected construct",
    explanation:
      "The parser reached a token that cannot begin a declaration, statement, type, or expression.",
    remediation:
      "BankTS is a restricted subset. Confirm the construct is supported before using it.",
    implemented: true,
  },
  {
    id: "BANK-TYPE-000",
    title: "No AST provided",
    explanation: "Type checking ran without a parsed program.",
    remediation: "Fix the reported syntax errors first.",
    implemented: true,
  },
  {
    id: "BANK-TYPE-001",
    title: "Unresolved type or symbol",
    explanation:
      "A type name or value symbol could not be resolved in the current scope.",
    remediation:
      "Declare the record, alias, parameter, or local before the point of use.",
    implemented: true,
  },
  {
    id: "BANK-TYPE-002",
    title: "Invalid type parameters",
    explanation:
      "Decimal precision and scale, or a string length, fell outside the supported range.",
    remediation:
      "Decimal precision must be positive, scale must be zero or greater, and scale cannot exceed precision.",
    implemented: true,
  },
  {
    id: "BANK-TYPE-003",
    title: "Type mismatch",
    explanation:
      "An expression, argument, return path, or branch does not match its expected type.",
    remediation:
      "The subset does not coerce. Make both sides resolve to the same BankLang type, including decimal precision and scale.",
    implemented: true,
  },
  {
    id: "BANK-TYPE-004",
    title: "Invalid statement position",
    explanation:
      "A statement appears where the subset does not allow it, such as after a terminal statement, or a function body with no terminal statement.",
    remediation:
      "Put local declarations before the final return or if statement, and make sure every function body ends with one.",
    implemented: true,
  },
  {
    id: "BANK-TYPE-005",
    title: "Duplicate symbol",
    explanation:
      "A parameter or local variable name is declared more than once in one scope.",
    remediation: "Rename one of them.",
    implemented: true,
  },
  {
    id: "BANK-TYPE-006",
    title: "Unknown record field",
    explanation: "Field access names a field the record does not declare.",
    remediation:
      "Check the record declaration. The diagnostic hint lists the available fields.",
    implemented: true,
  },
  {
    id: "BANK-TYPE-007",
    title: "Statement not allowed in this body",
    explanation:
      "A ledger or audit statement appears outside a transaction, or a return or if statement appears inside a transaction body.",
    remediation:
      "Transactions carry effects; functions compute values. Move the statement into the right kind of body.",
    implemented: true,
  },
  {
    id: "BANK-TYPE-008",
    title: "Nullable used without a presence check",
    explanation:
      "A nullable value was read with valueOf outside any isPresent guard, so the program could read a value that is not there.",
    remediation:
      "Guard the use: `if isPresent(value) { ... valueOf(value) ... }`.",
    specReference: "language-reference.md section 7",
    implemented: true,
  },
  {
    id: "BANK-TYPE-009",
    title: "Array index out of bounds",
    explanation:
      "A literal index falls outside the declared bounds of a bounded array.",
    remediation: "Use an index between 1 and the declared array length.",
    specReference: "language-reference.md section 6",
    implemented: true,
  },
  {
    id: "BANK-TYPE-010",
    title: "Switch does not handle every enum member",
    explanation:
      "A switch with no else branch leaves some members unhandled, so adding a member later would silently skip those cases.",
    remediation: "Handle every member, or add an else branch.",
    specReference: "language-reference.md section 9",
    implemented: true,
  },
  {
    id: "BANK-TYPE-014",
    title: "Generic expansion does not terminate",
    explanation:
      "A generic function calls itself at a type argument that keeps changing. Generics are monomorphised, so each new type argument creates another instantiation and the expansion never finishes.",
    remediation:
      "Make the recursive call use the same type arguments as the enclosing function.",
    specReference: "language-reference.md section 5",
    implemented: true,
  },
  {
    id: "BANK-TYPE-015",
    title: "Generic function is never instantiated",
    explanation:
      "A generic declaration is a template. Nothing is generated for one that is never called, and its body is never checked against real types, so a type error inside it would ship unnoticed.",
    remediation: "Call the function, or remove it.",
    specReference: "language-reference.md section 5",
    implemented: true,
  },
  {
    id: "BANK-TYPE-016",
    title: "Record inheritance cycle",
    explanation:
      "A record extends itself, directly or through another record. The flattened layout would be infinite.",
    remediation: "Break the cycle so the chain of base records terminates.",
    specReference: "language-reference.md section 3",
    implemented: true,
  },
  {
    id: "BANK-TYPE-017",
    title: "Inherited field redeclared",
    explanation:
      "A derived record declares a field its base already declares. Both would land in one COBOL group under the same name, which no qualification can disambiguate.",
    remediation:
      "Rename the field. A derived record extends the base layout; it cannot replace part of it.",
    specReference: "language-reference.md section 3",
    implemented: true,
  },
  {
    id: "BANK-TYPE-018",
    title: "Wrong number of type arguments",
    explanation:
      "A generic record was used with a different number of type arguments than it declares parameters, or with none at all. COBOL has no boxed values, so the layout has to be fixed at compile time.",
    remediation: "Supply one concrete type per declared type parameter.",
    specReference: "language-reference.md section 5",
    implemented: true,
  },
  {
    id: "BANK-TYPE-019",
    title: "Type arguments on a non-generic type",
    explanation:
      "A type that declares no type parameters was given type arguments.",
    remediation: "Drop the type argument list.",
    specReference: "language-reference.md section 5",
    implemented: true,
  },
  {
    id: "BANK-TYPE-020",
    title: "Type argument cannot be inferred",
    explanation:
      "A generic function is instantiated from the types of its arguments. A type parameter that appears in no parameter type, or that two arguments disagree about, has no single answer.",
    remediation:
      "Mention every type parameter in a parameter type, and pass arguments that agree on it.",
    specReference: "language-reference.md section 5",
    implemented: true,
  },
  {
    id: "BANK-TYPE-021",
    title: "Record argument is not a named record",
    explanation:
      "A record argument is passed by reference: the caller points the callee's LINKAGE cell at the argument's storage. A subscripted element has no address the caller can take without evaluating the subscript, so such an argument would compile and then read whatever the cell was last pointed at.",
    remediation:
      "Assign the element into a record of the parameter's type, then pass that record by name.",
    specReference: "language-reference.md section 6",
    implemented: true,
  },
  {
    id: "BANK-DEC-001",
    title: "Floating-point money forbidden",
    explanation:
      "Money was represented with binary floating point, which cannot represent decimal fractions exactly.",
    remediation: "Use decimal<precision, scale>.",
    implemented: false,
  },
  {
    id: "BANK-DEC-002",
    title: "Implicit scale narrowing",
    explanation:
      "Assigning a wider scale to a narrower one silently discards digits, which is the classic way money goes missing a fraction at a time.",
    remediation:
      'Wrap the value in round(value, "HALF_EVEN") to state how digits are discarded.',
    specReference: "language-reference.md section 4",
    implemented: true,
  },
  {
    id: "BANK-DEC-003",
    title: "Missing rounding mode",
    explanation:
      "Division cannot be exact, so a rounding mode must be stated. Leaving it implicit makes the result depend on the backend rather than on a decision someone made.",
    remediation: 'Write divide(a, b, "HALF_EVEN") instead of a / b.',
    specReference: "language-reference.md section 4",
    implemented: true,
  },
  {
    id: "BANK-DEC-004",
    title: "Possible overflow",
    explanation:
      "Multiplication adds the operand scales, and the result needs more digits than the declared precision allows.",
    remediation: "Widen the operand precision or reduce the operand scales.",
    implemented: true,
  },
  {
    id: "BANK-DEC-005",
    title: "Currency mismatch",
    explanation:
      "Values in different currencies were combined or compared. Currency types are nominal, so two currencies with identical precision and scale are still different types.",
    remediation:
      "Convert explicitly with a stated rate and rounding mode before combining.",
    specReference: "language-reference.md section 4",
    implemented: true,
  },
  {
    id: "BANK-TXN-001",
    title: "Missing idempotency key",
    explanation:
      "A transaction that posts financial effects has no reachable idempotency key. Retries are routine in payment infrastructure, and an unkeyed retry can post an amount twice.",
    remediation:
      "Add an idempotencyKey field to a record parameter, or take an idempotencyKey parameter directly.",
    specReference: "language-reference.md section 10",
    implemented: true,
  },
  {
    id: "BANK-TXN-002",
    title: "Missing rollback path",
    explanation:
      "The backend requires a rollback representation but none can be generated.",
    remediation: "Reserved for the CICS profile.",
    implemented: false,
  },
  {
    id: "BANK-TXN-003",
    title: "Unsafe non-deterministic operation",
    explanation:
      "A transaction contains an operation with backend-dependent behaviour.",
    remediation: "Reserved.",
    implemented: false,
  },
  {
    id: "BANK-TXN-004",
    title: "Unbounded loop in transaction",
    explanation:
      "A loop has no static iteration bound. An unbounded loop in a financial program can hold locks or consume a batch window indefinitely.",
    remediation: "Write `while <condition> limit 1000 { ... }`.",
    specReference: "language-reference.md section 9",
    implemented: true,
  },
  {
    id: "BANK-TXN-008",
    title: "Invalid failure code",
    explanation:
      "A raise code is empty or wider than BANK-FAILURE-CODE. A truncated code would not match the handler that tests it.",
    remediation: "Use a non-empty code of at most 32 characters.",
    specReference: "language-reference.md section 11",
    implemented: true,
  },
  {
    id: "BANK-TXN-009",
    title: "Failure handler raises",
    explanation:
      "An `on failure` handler contains a raise. It is the last line of defence: there is no outer handler to catch it, so the failure would be lost along with the record of why the transaction stopped.",
    remediation: "Record the failure and return instead of raising again.",
    specReference: "language-reference.md section 11",
    implemented: true,
  },
  {
    id: "BANK-TXN-010",
    title: "More than one entry transaction",
    explanation:
      "A program starts at one place. COBOL enters at the first statement of the PROCEDURE DIVISION and cannot choose between two entry points, so the second would never run.",
    remediation: "Mark exactly one transaction with `entry`.",
    specReference: "language-reference.md section 10",
    implemented: true,
  },
  {
    id: "BANK-LED-001",
    title: "Unbalanced posting",
    explanation:
      "The debited and credited amounts in a transaction do not match. Because the compiler does not evaluate expressions, balance is proven structurally by comparing the posted amount expressions as multisets.",
    remediation:
      "Post the same amount expressions to both sides. The check is deliberately conservative: it reports what it cannot prove rather than accepting it.",
    specReference: "language-reference.md section 10",
    implemented: true,
  },
  {
    id: "BANK-LED-002",
    title: "Missing ledger entry",
    explanation: "Money movement occurs without a ledger posting.",
    remediation: "Reserved.",
    implemented: false,
  },
  {
    id: "BANK-LED-003",
    title: "Inconsistent value date",
    explanation: "Posting date and value date policy is missing or unclear.",
    remediation: "Reserved.",
    implemented: false,
  },
  {
    id: "BANK-LED-004",
    title: "Posted amount does not fit the ledger interface",
    explanation:
      "BANK-LEDGER-AMOUNT is PIC S9(16)V99. An amount with more integer digits or a finer scale loses digits in the MOVE, and COBOL truncates silently.",
    remediation:
      "Round to two decimal places with an explicit mode, or narrow the amount type, so the loss is stated rather than silent.",
    specReference: "docs/adr/0003-ledger-and-audit-calling-convention.md",
    implemented: true,
  },
  {
    id: "BANK-AUD-001",
    title: "Missing audit event",
    explanation: "A financial transaction path emits no audit event.",
    remediation:
      "Add an audit(eventName, correlationKey) statement to the transaction body.",
    specReference: "language-reference.md section 10",
    implemented: true,
  },
  {
    id: "BANK-AUD-002",
    title: "Audit payload contains sensitive field",
    explanation: "An audit payload includes a field marked sensitive.",
    remediation: "Reserved until audit payloads enter the subset.",
    implemented: false,
  },
  {
    id: "BANK-AUD-003",
    title: "Audit event name is not a compile-time constant",
    explanation:
      "An audit event name was computed rather than written literally, so audit trails could not be searched or kept stable across releases.",
    remediation: 'Use a literal name, such as audit("TRANSFER_POSTED", key).',
    specReference: "language-reference.md section 11",
    implemented: true,
  },
  {
    id: "BANK-FILE-001",
    title: "File status not checked",
    explanation:
      "A file declaration binds no status field, so the generated COBOL has nowhere to observe the result of an I/O operation.",
    remediation:
      "Add a status clause: file input sequential input record R status inputStatus;",
    specReference: "language-reference.md section 13",
    implemented: true,
  },
  {
    id: "BANK-FILE-002",
    title: "Record layout mismatch",
    explanation:
      "A read or write uses a record variable whose type differs from the record type in the file declaration, so the bytes would not line up.",
    remediation:
      "Make the record variable match the record type in the file declaration.",
    specReference: "language-reference.md section 13",
    implemented: true,
  },
  {
    id: "BANK-FILE-003",
    title: "Unsafe restart behaviour",
    explanation: "Batch file processing lacks a checkpoint or restart policy.",
    remediation: "Reserved.",
    implemented: false,
  },
  {
    id: "BANK-SQL-001",
    title: "SQLCODE not handled",
    explanation:
      "A body runs SQL but never tests SQLCODE. A row that was not found otherwise looks identical to one that was.",
    remediation: "Test `sqlcode` after the execute statement.",
    specReference: "language-reference.md section 12",
    implemented: true,
  },
  {
    id: "BANK-SQL-002",
    title: "Dynamic SQL disallowed",
    explanation:
      "A SQL declaration uses EXECUTE IMMEDIATE or PREPARE. Dynamic SQL cannot be precompiled, bound, or checked ahead of time.",
    remediation: "Write the statement out so it can be precompiled and bound.",
    specReference: "language-reference.md section 12",
    implemented: true,
  },
  {
    id: "BANK-SQL-003",
    title: "Host variable mismatch",
    explanation:
      "A host variable does not resolve to a parameter or a field of the result record, matches both, or the result of a query is discarded.",
    remediation:
      "Give each host variable exactly one binding, and capture the result with `into <record>`.",
    specReference: "language-reference.md section 12",
    implemented: true,
  },
  {
    id: "BANK-SQL-004",
    title: "Transaction commit ambiguity",
    explanation:
      "A SQL statement participates in a transaction with no clear commit or rollback mapping.",
    remediation: "Reserved for the Db2 profile.",
    implemented: false,
  },
  {
    id: "BANK-CICS-001",
    title: "CICS response code not captured",
    explanation:
      "A CICS command does not capture RESP, so a failed command is indistinguishable from a successful one.",
    remediation:
      'Write `link "PROG" commarea <record> resp <status>;` and test the status.',
    specReference: "language-reference.md section 14",
    implemented: true,
  },
  {
    id: "BANK-CICS-002",
    title: "CICS command outside a CICS transaction",
    explanation:
      "A link, syncpoint, or rollback appears in a transaction that was not declared with `cics`.",
    remediation: "Declare the transaction as `cics transaction <name>(...)`.",
    specReference: "language-reference.md section 14",
    implemented: true,
  },
  {
    id: "BANK-CICS-003",
    title: "Syncpoint in a loop",
    explanation:
      "A syncpoint or rollback inside a loop commits or discards partial work on every iteration, which is rarely what a transaction means to do.",
    remediation: "Move the syncpoint outside the loop.",
    specReference: "language-reference.md section 14",
    implemented: true,
  },
  {
    id: "BANK-COPY-001",
    title: "Unsupported PIC clause",
    explanation:
      "A copybook contains a PIC clause the current parser subset does not support.",
    remediation:
      "The copybook parser covers the generated subset. Wider support is on the roadmap.",
    implemented: false,
  },
  {
    id: "BANK-COPY-002",
    title: "Unsupported REDEFINES shape",
    explanation:
      "A REDEFINES construct cannot be represented safely in the BankTS subset.",
    remediation: "Reserved.",
    implemented: false,
  },
  {
    id: "BANK-COPY-003",
    title: "Incompatible layout change",
    explanation:
      "A new copybook layout changes field offsets or byte lengths incompatibly, which would silently corrupt existing data.",
    remediation:
      "Compare layouts with `bankc copybook diff` before shipping the change.",
    implemented: false,
  },
  {
    id: "BANK-FILE-004",
    title: "Invalid file key",
    explanation:
      "An indexed file has no record key, names a key field the record does not declare, is read without a key, or a key clause appears on a file that is not indexed.",
    remediation:
      "Declare `key <field>` on an indexed file and read it with `read <file> into <record> key <value>;`.",
    specReference: "language-reference.md section 13",
    implemented: true,
  },
  {
    id: "BANK-GEN-001",
    title: "Module missing source map entry",
    explanation: "The generated source map has no entry for the module.",
    remediation:
      "This indicates a backend defect. Please open an issue with the program that triggered it.",
    implemented: true,
  },
  {
    id: "BANK-GEN-002",
    title: "Record missing source map entry",
    explanation: "A record reached the backend but has no source map entry.",
    remediation: "This indicates a backend defect. Please open an issue.",
    implemented: true,
  },
  {
    id: "BANK-GEN-003",
    title: "Field missing source map entry",
    explanation:
      "A record field reached the backend but has no source map entry.",
    remediation: "This indicates a backend defect. Please open an issue.",
    implemented: true,
  },
  {
    id: "BANK-GEN-004",
    title: "Function missing source map entry",
    explanation: "A function reached the backend but has no source map entry.",
    remediation: "This indicates a backend defect. Please open an issue.",
    specReference: "verification.md section 7",
    implemented: true,
  },
  {
    id: "BANK-GEN-005",
    title: "Source map entry outside generated artifact",
    explanation:
      "An entry targets a line range that does not exist in the generated COBOL, or an inverted range.",
    remediation: "This indicates a backend defect. Please open an issue.",
    implemented: true,
  },
  {
    id: "BANK-GEN-006",
    title: "Source map entry not anchored to generated name",
    explanation:
      "An entry targets a real line range that does not contain the COBOL name it claims to describe. An entry pointing at the wrong line is worse than a missing one, because it looks like traceability while misdirecting a reviewer.",
    remediation: "This indicates a backend defect. Please open an issue.",
    implemented: true,
  },
  {
    id: "BANK-GEN-007",
    title: "Transaction missing source map entry",
    explanation:
      "A transaction reached the backend but has no source map entry, so the transaction boundary is not traceable.",
    remediation: "This indicates a backend defect. Please open an issue.",
    specReference: "language-reference.md section 10",
    implemented: true,
  },
];

const BY_ID = new Map(DIAGNOSTICS.map((entry) => [entry.id, entry]));

export function explainDiagnostic(id: string): DiagnosticDoc | undefined {
  return BY_ID.get(id.toUpperCase());
}

export function namespaceOf(id: string): DiagnosticNamespace | null {
  const match = /^BANK-([A-Z]+)-\d+$/.exec(id.toUpperCase());
  const namespace = match?.[1] as DiagnosticNamespace | undefined;
  return namespace && namespace in NAMESPACE_TITLES ? namespace : null;
}

export function renderDiagnosticDoc(doc: DiagnosticDoc): string {
  const lines = [
    `${doc.id}  ${doc.title}`,
    "",
    doc.explanation,
    "",
    `Remediation: ${doc.remediation}`,
  ];

  if (doc.specReference) {
    lines.push(`Specified by: docs/${doc.specReference}`);
  }

  if (!doc.implemented) {
    lines.push(
      "Status: reserved. This identifier is catalogued but not yet emitted by the compiler.",
    );
  }

  return `${lines.join("\n")}\n`;
}
