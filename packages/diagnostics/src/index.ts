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
  | "DLI"
  | "MQ"
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
  DLI: "IMS DL/I",
  MQ: "IBM MQ",
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
    id: "BANK-TYPE-022",
    title: "Two transaction parameters share one record",
    explanation:
      "A transaction is a program entry point, so its record parameters live in working storage — one COBOL group per record type. Two parameters of the same type would be two names for one piece of storage, and writing through either would be visible through the other.",
    remediation:
      "Declare a second record type, or take one parameter and fill it twice. A function is unaffected: its record parameters are LINKAGE cells the caller rebinds.",
    specReference: "language-reference.md section 3",
    implemented: true,
  },
  {
    id: "BANK-TYPE-023",
    title: "Invalid edited field",
    explanation:
      'An `edited<T, "style">` field names a style the compiler does not know, or asks to render something that has no edited form. A picture nobody checked is a report column that silently loses digits.',
    remediation:
      "Use one of the documented styles, and render a decimal, a currency amount, or a date.",
    specReference: "language-reference.md section 3b",
    implemented: true,
  },
  {
    id: "BANK-TYPE-024",
    title: "National layout is not locally verifiable",
    explanation:
      "A `national<n>` field is `PIC N(n) USAGE NATIONAL`. Enterprise COBOL holds each character in two bytes of UTF-16, which is the width the layout report and the copybook use. GnuCOBOL 3.2.0 allocates four bytes per character inside a group — measured, not assumed — and warns on every such line that its handling of USAGE NATIONAL is unfinished. Byte-exact layout is the only thing the type promises, so the one compiler available to check it disagrees about the one thing that matters.",
    remediation:
      "Use the type when a mainframe record requires it, and verify the record on z/OS before relying on the offsets. `zos/README.md` records the divergence.",
    specReference: "language-reference.md section 3",
    implemented: true,
  },
  {
    id: "BANK-TYPE-025",
    title: "Parsed document cannot be checked locally",
    explanation:
      "`json <text> into <record>` and its `xml` twin become `JSON PARSE` and `XML PARSE`. Enterprise COBOL implements both. GnuCOBOL 3.2.0 compiles them, warns that they are not implemented, and then does nothing at run time: the record is left untouched and no exception is raised, so a program reading a payload runs clean and processes an empty record. On Enterprise COBOL the hazard is different but has the same shape — a JSON PARSE can meet a nonexception condition, which does not terminate the statement and may leave the receiver partially modified, so the exception branch is never taken and the record holds some fields and not others. The compiler emits a JSON-STATUS test that reports it.",
    remediation:
      "Verify the program on z/OS before relying on what it reads, and check the record rather than trusting the failure path — a parse that did nothing does not report an exception, and one that partly worked reports only in JSON-STATUS. `zos/README.md` records the divergence.",
    specReference: "language-reference.md section 13a",
    implemented: true,
  },
  {
    id: "BANK-TYPE-026",
    title: "invalid xml read",
    explanation:
      '`XML PARSE` is event-driven, so `xml <text> into <record>` has no COBOL to become: neither Enterprise COBOL nor GnuCOBOL has a form that fills a record. The form that exists is `xml <text> processing { element "NAME" into <field>; }`, and its bindings have to make sense — at least one element, each element bound once, and each read into something characters can be moved into.',
    remediation:
      "Use the `processing` form, bind each element once, and read into a string<n> or a number. `json <text> into <record>` fills a record directly if the document is JSON.",
    specReference: "language-reference.md section 13a",
    implemented: true,
  },
  {
    id: "BANK-TYPE-027",
    title: "Nested function is recursive",
    explanation:
      "COBOL forbids `LOCAL-STORAGE` in a contained program, so a `nested function`'s locals sit in `WORKING-STORAGE` — one copy shared by every invocation. A recursive one would overwrite its own locals on the way down and read the innermost call's values on the way back out: it compiles, it runs, and it returns the wrong number.",
    remediation:
      "Drop `nested`. An ordinary recursive function is emitted as a sibling program with `LOCAL-STORAGE`, which is what makes recursion safe.",
    specReference: "language-reference.md section 8",
    implemented: true,
  },
  {
    id: "BANK-TYPE-028",
    title: "Invalid sorted search",
    explanation:
      "`search sorted` becomes COBOL `SEARCH ALL`, a binary search. COBOL will bisect a table only if the declaration says it is ordered — `ascending <field>` — and only on equality against that key, because anything else has no ordering to cut in half. A `SEARCH ALL` on a table that is not actually sorted does not fall back to a scan: it returns the wrong row, or none.",
    remediation:
      "Add `ascending <field>` to the table's declaration and keep it sorted, and test that field for equality. Use a plain `search` to walk a table in any other way.",
    specReference: "language-reference.md section 9",
    implemented: true,
  },
  {
    id: "BANK-TYPE-029",
    title: "Invalid dynamic call",
    explanation:
      "`call <name> using <record>` names its load module by a value rather than by a literal in the source, so the name has to be text and short enough to be one — eight characters, because a longer field is truncated to a name that does not exist. What the compiler cannot check is whether the module is there: that is the nature of a dynamic call, which is why a call with no `on error` is warned about. A static call that cannot be resolved fails at link time where somebody sees it; a dynamic one fails in the middle of a batch.",
    remediation:
      "Name the module with a `string<8>` field or a literal, hand over a record, and add `on error { ... }` so a missing module becomes a rejected record rather than an abend.",
    specReference: "language-reference.md section 9b",
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
    id: "BANK-DEC-006",
    title: "Rounding cannot be generated",
    explanation:
      "Enterprise COBOL has one rounding phrase, `ROUNDED`, which is half up away from zero; leaving it off truncates. The other five modes are generated arithmetic, and that generation has preconditions: the rounded value must be the whole value being stored, because COBOL attaches ROUNDED to the receiving field, and a rounded division's remainder must fit an eighteen-digit item, because the tie test is run against it.",
    remediation:
      "Bind the rounded value to its own `let` before combining it, or reduce the divisor's precision or the result's scale so the remainder fits.",
    specReference: "numeric-model.md",
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
    title: "Restricted data reaches a log",
    explanation:
      "A value marked `sensitive` reaches an audit event or a ledger posting. Both are durable records that outlive the transaction and are read by people with no business seeing a card number or a national identifier.",
    remediation:
      "Pass an idempotency key or another unrestricted identifier, or derive a masked value through a function first.",
    specReference: "language-reference.md section 11",
    implemented: true,
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
    explanation:
      "A transaction posts to the ledger inside a loop without both halves of checkpoint/restart. A job that dies halfway is rerun, and without a position written down the rerun starts at the beginning and posts everything twice — and a position written down but never read back leaves the rerun starting at the beginning just the same. A single posting is different: rerunning it is the caller's problem, and the idempotency key covers it. The same id covers a restart file that is not `indexed update`: a sequential output file is rewritten from the start by the next OPEN, so a rerun that dies before its own first checkpoint destroys the position it was resuming from.",
    remediation:
      "Add `checkpoint <file> from <record> every <n>;` inside the loop and `restart <file> into <record> { ... }` before it, or confirm the job is rerunnable another way. Reported as a warning, because the compiler cannot tell whether it is.",
    specReference: "language-reference.md section 13a",
    implemented: true,
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
      "A `commit` or `rollback` appears inside a CICS transaction. CICS owns the unit of work there and commits Db2's work along with everything else, so an EXEC SQL COMMIT is not merely redundant — Db2 rejects it at run time.",
    remediation:
      "Use `syncpoint resp <status>;` or `rollback resp <status>;`, the CICS commands, which cover Db2's work too.",
    specReference: "language-reference.md section 12",
    implemented: true,
  },
  {
    id: "BANK-SQL-005",
    title: "Cursor and statement confused",
    explanation:
      "A cursor was executed like a single-row statement, or a single-row statement was read like a cursor. They lower to different Db2 statements: a statement is one EXEC SQL, a cursor is DECLARE, OPEN, FETCH, and CLOSE.",
    remediation:
      "Run a `sql` declaration with `execute`, and read a `cursor` declaration with `for each <row> in <cursor>(...) limit <n>`.",
    specReference: "language-reference.md section 12",
    implemented: true,
  },
  {
    id: "BANK-SQL-006",
    title: "Cursor row binding missing",
    explanation:
      "A cursor declares no result record, or no INTO clause naming where a fetched row lands. Either way the generated FETCH would have nowhere to put a row, and the compiler does not parse SQL well enough to bind the select list positionally instead.",
    remediation:
      "Declare the result record, and write `INTO :field, ...` between the select list and FROM.",
    specReference: "language-reference.md section 12",
    implemented: true,
  },
  {
    id: "BANK-CICS-001",
    title: "CICS response code not captured",
    explanation:
      "A CICS command does not capture RESP, so a failed command is indistinguishable from a successful one.",
    remediation:
      'Write `link "PROG" commarea <record> resp <status>;` and test the status.',
    specReference: "language-reference.md section 14a",
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
    id: "BANK-COPY-004",
    title: "Invalid variant record clause",
    explanation:
      "A `redefines` names a field that is not declared before it, or is longer than what it redefines. A `depending on` names something that is not a count declared before the table, which COBOL reads to decide the record's length. On the length: COBOL itself permits a longer redefining item except where the redefined item is an external data record — the redefinition extends the storage area rather than overrunning it. This compiler refuses it anyway, which is a deliberate narrowing rather than COBOL's rule: a redefinition that changes the record's length moves every field after it, and a copybook whose length depends on which of several readings is the longest is the kind that is read wrong by the program on the other side of the interface.",
    remediation:
      "Declare the field being redefined first and keep the redefining field no longer, and declare the count as `binary<n>` or `decimal<n, 0>` before the table. If the layout genuinely needs a longer reading, declare the longer field first and redefine it with the shorter one.",
    specReference: "language-reference.md section 5c",
    implemented: true,
  },
  {
    id: "BANK-COPY-005",
    title: "Invalid field clause",
    explanation:
      "`justified` right-aligns an alphanumeric value, so a number cannot carry it — a number's alignment is decided by its picture. `blankWhenZero` prints spaces for a zero, so there has to be a number to be zero.",
    remediation:
      "Put `justified` on a string field, and `blankWhenZero` on a decimal, currency, or edited field.",
    specReference: "language-reference.md section 3",
    implemented: true,
  },
  {
    id: "BANK-FILE-005",
    title: "File operation does not match the declaration",
    explanation:
      "A `rewrite` or `delete` needs the file open for update, because updating a record in place means finding it first. A `start` or `readNext` browses an index, which a sequential file does not have.",
    remediation:
      "Declare the file as `update` to both read and write it, and as `indexed` with a record key to browse it.",
    specReference: "language-reference.md section 13",
    implemented: true,
  },
  {
    id: "BANK-FILE-006",
    title: "Invalid sort procedure",
    explanation:
      "A sort procedure works through a record variable that does not hold the record being sorted, or `release` appears where no sort is running. An input procedure that never reaches a `release` sorts an empty file, and a `merge` has no input procedure at all: its premise is that the inputs already arrive in order.",
    remediation:
      "Name a variable of the record the sort moves, write `release` inside the sort's `input` procedure, and reach it on at least one path.",
    specReference: "language-reference.md section 13",
    implemented: true,
  },
  {
    id: "BANK-FILE-007",
    title: "Invalid page declaration",
    explanation:
      "A page depth describes a print file, so it belongs to a sequential output file, and its footing has to be a line the page has. `advancing` writes a report line, and `on page` is signalled from the page counter, so a file with no declared depth never reaches the end of one.",
    remediation:
      "Declare the report as `sequential output` with `page <lines>`, and put the footing on a line within the page.",
    specReference: "language-reference.md section 13",
    implemented: true,
  },
  {
    id: "BANK-FILE-008",
    title: "Invalid report description",
    explanation:
      "A report's names have to resolve for the generated COBOL to mean anything: a control field must be a field of the record the report prints, a control heading or footing must name a control the report breaks on, `sum` must sit in a footing where something has been counted, and `generate` must name a detail group while `initiate` and `terminate` name the report.",
    remediation:
      "Add the field to the record or to the report's `control` list, move a `sum` into a `controlFooting` or `pageFooting`, and give the report at least one `detail` group for `generate` to name.",
    specReference: "language-reference.md section 13b",
    implemented: true,
  },
  {
    id: "BANK-COPY-006",
    title: "Invalid initial value",
    explanation:
      "A field's initial value becomes a COBOL `VALUE` clause, which the compiler evaluates when it compiles. It therefore has to be something the compiler can see: a written number, string, boolean, or enum member of the field's own type, short enough to fit. A `REDEFINES` field cannot carry one at all — it has no storage of its own, only a second reading of another field's bytes.",
    remediation:
      "Give the field a literal of its own type that fits, or move the initialisation into the program where it can be computed. Put a redefining field's value on the field being redefined.",
    specReference: "language-reference.md section 3",
    implemented: true,
  },
  {
    id: "BANK-FILE-009",
    title: "Invalid varying record",
    explanation:
      "`varying <min> to <max> length <field>` becomes `RECORD IS VARYING IN SIZE`. The bounds have to be a range of lengths — a shortest of at least one character, and no longer than the longest — and the file has to be sequential, because an indexed or relative dataset addresses a record by key or by position, which a varying length would move.",
    remediation:
      "Give the shortest and longest lengths in that order, and declare the file `sequential`.",
    specReference: "language-reference.md section 13",
    implemented: true,
  },
  {
    id: "BANK-FILE-010",
    title: "Update with nothing read",
    explanation:
      "`rewrite` and `delete` replace the record the last `read` returned, so on a file the program accesses sequentially they need one. Without it the operation is not performed and the file status is 92 — no abend and no exception, so a program that does not test the status carries on believing it updated something. Only sequential and relative files are affected: an indexed file is accessed dynamically, where the record key in the record area says which record is meant. A read in an enclosing block covers a branch inside it, but a read inside a branch does not travel back out, because the path that skipped it reaches the update with nothing read.",
    remediation:
      "Read the record before replacing or deleting it, or put the read where every path to the update passes through it.",
    specReference: "language-reference.md section 13",
    implemented: true,
  },
  {
    id: "BANK-FILE-011",
    title: "Delete on a sequential file",
    explanation:
      "Enterprise COBOL has no `DELETE` for a file with sequential organization: a record is removed by leaving it out of the file the next program writes, not by deleting it in place. GnuCOBOL compiles the statement, so local validation does not catch this one.",
    remediation:
      "Copy the records worth keeping into a new file, or declare the file `indexed` or `relative` so a record can be addressed for removal.",
    specReference: "language-reference.md section 13",
    implemented: true,
  },
  {
    id: "BANK-DLI-001",
    title: "Invalid DL/I access",
    explanation:
      "A DL/I statement names a database that is not declared, moves a segment into a record of the wrong shape, looks for a key that is not text, or reaches a database with no status field. The segment and key names are eight bytes each, because that is what a search argument carries — a longer one is truncated into a name matching nothing in the DBD. The status field matters most: the two characters DL/I leaves in the PCB are the entire error model, so without somewhere to read them a `getUnique` that found nothing is indistinguishable from one that worked, and the program goes on to use whatever the segment area held last.",
    remediation:
      'Declare the database with `database <name> pcb segment "SEG" key "KEY" record <Record> status <field>;`, read into the record it declares, and test the status after every call.',
    specReference: "language-reference.md section 12a",
    implemented: true,
  },
  {
    id: "BANK-MQ-001",
    title: "Invalid queue access",
    explanation:
      "An MQ statement names a queue that is not declared, or reaches one with no status field, or the declaration names a queue manager or a queue longer than MQ carries. `MQ_Q_MGR_NAME_LENGTH` and `MQ_Q_NAME_LENGTH` are both 48, which is what `MQOD-OBJECTNAME` and the `MQCONN` name parameter are declared as, so a longer name is truncated into one the queue manager does not have. The status field matters most: MQ reports what happened in a completion code and a reason code, and without somewhere to read the reason a `getMessage` that found an empty queue is indistinguishable from one that read a message — so the program processes whatever the message area held last.",
    remediation:
      'Declare the queue with `queue <name> manager "MGR" name "Q.NAME" output record <Record> status <field>;` and test the reason after a get.',
    specReference: "language-reference.md section 12b",
    implemented: true,
  },
  {
    id: "BANK-MQ-002",
    title: "Queue used against its direction",
    explanation:
      "A queue is opened for input or for output, not both, because that is what the `MQOPEN` options say: an `output` queue is opened `MQOO-OUTPUT` and an `input` queue `MQOO-INPUT-AS-Q-DEF`. Reading a queue opened for output fails at run time with reason 2037, `MQRC-NOT-OPEN-FOR-INPUT`, and putting to one opened for input fails with 2039, `MQRC-NOT-OPEN-FOR-OUTPUT`. This also covers a message record of the wrong shape: the buffer is the record the queue declares, and MQ moves bytes without checking what they mean.",
    remediation:
      "Declare a second queue for the other direction, or correct the statement to match the direction the queue was declared with.",
    specReference: "language-reference.md section 12b",
    implemented: true,
  },
  {
    id: "BANK-DLI-002",
    title: "Segment updated without being held",
    explanation:
      "DL/I will not update a segment the program has not held. A `REPL` or `DLET` after a plain `getUnique` comes back with status `DJ` — no preceding get-hold — and the update simply does not happen, which the program only discovers if it tests the status. A get-hold both retrieves the segment and locks it, which is what makes the later update legal.",
    remediation:
      "Read the segment with `getHoldUnique` or `getHoldNext` before replacing or deleting it, in the same block — a hold inside a branch leaves the path that skipped the branch reaching the update unheld.",
    specReference: "language-reference.md section 12a",
    implemented: true,
  },
  {
    id: "BANK-SEC-001",
    title: "Restricted data reclassified",
    explanation:
      "A value marked `sensitive` is assigned to a field that is not. A field's marking is part of its record declaration and therefore part of its copybook, so this would reclassify the data silently and defeat the marking everywhere downstream.",
    remediation:
      "Mark the target field `sensitive`, or derive an unrestricted value through a function first.",
    specReference: "language-reference.md section 11",
    implemented: true,
  },
  {
    id: "BANK-COPY-007",
    title: "Two records share one copybook member",
    explanation:
      'A PDS member name is one to eight characters of letters, digits, and the national characters, with no hyphens — and that is also all the COBOL compiler looks at when it resolves a `COPY` from a PDS: "only the first eight characters of text-name are used as the identifying name". So `AccountRecord` and `AccountRow` are both the member `ACCOUNTR`. One copybook overwrites the other in the library, and every program that copies either gets whichever was written last: a record with the name it asked for and different fields at different offsets, which is the one thing a copybook exists to prevent.',
    remediation:
      "Rename one of the records so the two differ within the first eight characters once the hyphens are removed.",
    specReference: "language-reference.md section 14",
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
