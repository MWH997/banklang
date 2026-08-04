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
      "Values in different currencies were combined without an explicit conversion.",
    remediation: "Convert explicitly with a stated rate and rounding mode.",
    implemented: false,
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
      "A generated SQL operation does not handle the success, not-found, and error branches.",
    remediation: "Reserved for the Db2 profile.",
    implemented: false,
  },
  {
    id: "BANK-SQL-002",
    title: "Dynamic SQL disallowed",
    explanation:
      "Dynamic SQL is not supported by the selected backend profile.",
    remediation: "Reserved for the Db2 profile.",
    implemented: false,
  },
  {
    id: "BANK-SQL-003",
    title: "Host variable layout mismatch",
    explanation:
      "A SQL host variable does not match the expected COBOL field layout.",
    remediation: "Reserved for the Db2 profile.",
    implemented: false,
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
    title: "CICS response code not handled",
    explanation: "A CICS command does not handle its response code.",
    remediation: "Reserved for the CICS profile.",
    implemented: false,
  },
  {
    id: "BANK-CICS-002",
    title: "Unsupported CICS operation",
    explanation:
      "The selected backend profile does not support the requested operation.",
    remediation: "Reserved for the CICS profile.",
    implemented: false,
  },
  {
    id: "BANK-CICS-003",
    title: "Syncpoint misuse",
    explanation: "A transaction uses a syncpoint in an invalid scope.",
    remediation: "Reserved for the CICS profile.",
    implemented: false,
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
