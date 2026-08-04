# BankTS Language Specification

## 1. Design goal

BankTS is a restricted TypeScript-like language for banking workloads that compiles to COBOL.

It is intentionally less expressive than TypeScript. The goal is safety, auditability, and predictable COBOL generation.

## 2. Modules

```ts
module AccountTransfer;
```

A file may define one module. Module names must be stable identifiers. Generated COBOL program names are derived from module names using a deterministic naming strategy.

## 3. Primitive types

Supported primitive types:

```ts
bool;
int<digits>;
uint<digits>;
decimal<precision, scale>;
string<length>;
date;
time;
timestamp;
```

Examples:

```ts
type AccountId = string<16>;
type CustomerId = string<20>;
type Amount = decimal<18, 2>;
```

## 4. Currency types

Currency types are nominal and cannot be mixed implicitly.

```ts
type BDT = currency<"BDT", 18, 2>;
type USD = currency<"USD", 18, 2>;
```

Invalid:

```ts
let total: BDT = bdtAmount + usdAmount;
```

Valid:

```ts
let converted: BDT = fxConvert(usdAmount, rate, "HALF_EVEN");
```

## 5. Records

Records map to COBOL group items and copybook structures.

```ts
record TransferRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: decimal<18, 2>;
  idempotencyKey: string<36>;
}
```

Rules:

- field order is preserved
- field lengths are fixed
- nullable fields must be explicit
- dynamic object fields are forbidden
- nested records are allowed
- arrays must be bounded

### 5a. Inheritance

A record may extend another. The base fields are laid out first, so the derived
record's leading storage is the base record's storage byte for byte:

```ts
record CurrentAccount {
  accountId: string<16>;
  balance: currency<"BDT", 18, 2>;
}

record SavingsAccount extends CurrentAccount {
  minimumBalance: currency<"BDT", 18, 2>;
}
```

That layout guarantee is the point: an existing copybook for the base still
reads a derived record correctly.

It is also what makes a derived record substitutable for its base at a call
site. A function's record parameter is a `LINKAGE` cell rather than a group item
in working storage, and the caller points the cell at the argument before
performing the paragraph:

```cobol
           SET ADDRESS OF LEDGER-BALANCE-OF-P1 TO ADDRESS OF SAVINGS-ACCOUNT
           PERFORM LEDGER-BALANCE-OF
```

The cell describes the declared parameter's fields, and `extends` guarantees
those fields sit at the same offsets in the derived record, so the callee reads
the caller's storage correctly. An argument whose address the caller cannot take
without evaluating a subscript first is `BANK-TYPE-021`.

A transaction is a program entry point rather than something called with varying
arguments, so its record parameters stay in working storage and take no part in
this.

Redeclaring an inherited field is `BANK-TYPE-017`; a cycle is `BANK-TYPE-016`.

### 5b. Generics

Records and functions may take type parameters. There is no runtime
polymorphism in COBOL and no boxing, so every instantiation is expanded into a
concrete declaration at compile time:

```ts
record Slot<T> {
  value: T;
  present: bool;
}

record Holder {
  money: Slot<currency<"BDT", 18, 2>>;
  count: Slot<decimal<9, 0>>;
}
```

That emits two records, `SLOT-CUR-BDT18-2` and `SLOT-DEC9-0`, each with its own
storage. Two instantiations of one generic cost two copies of the layout and,
for a function, two copies of the code. Type arguments are normalised through
the resolver first, so `Slot<Money>` and `Slot<currency<"BDT", 18, 2>>` are one
record rather than two identical ones.

Generic functions take their type arguments by inference from the argument
types, never explicitly:

```ts
function larger<T>(left: T, right: T): T {
  if left >= right {
    return left;
  } else {
    return right;
  }
}
```

`larger(a, b)` instantiates from the types of `a` and `b`. There is no
`larger<Money>(a, b)` syntax, because `f<T>(x)` cannot be told apart from two
comparisons without unbounded lookahead. A type parameter that appears in no
parameter type therefore cannot be inferred, and is `BANK-TYPE-020`.

A generic that is never instantiated generates nothing and is never checked
against real types, which is reported as `BANK-TYPE-015`.

Two instantiations of a generic **function** that lower to identical COBOL share
one paragraph. `larger<currency<"BDT", 18, 2>>` and
`larger<currency<"USD", 18, 2>>` both emit `PIC S9(16)V99 COMP-3`, so emitting
both is the same paragraph and the same storage twice. Sharing follows the
callee: two instantiations that differ only in which instantiation they call
merge once those callees have merged. The surviving name is the alphabetically
first of the group, so the choice does not depend on the order the instantiations
were created in.

This is a decision about emitted COBOL and nothing else. Currency stays nominally
typed, so `larger(bdtAmount, usdAmount)` is still `BANK-TYPE-020`. A function you
wrote yourself keeps its own paragraph even if another one happens to match it
exactly, because that name appears in the source, the source map, and the audit
record.

Instantiated **records** are never shared: two instantiations are two variables
holding different values, not two copies of one routine.

## 6. Bounded arrays

```ts
record Statement {
  entries: LedgerEntry[1000];
}
```

Arrays must be statically bounded unless mapped to a known COBOL `OCCURS DEPENDING ON` construct.

## 7. Nullable values

Nullable values are explicit:

```ts
type OptionalBranch = nullable<string<8>>;
```

A nullable value must be checked before use.

## 8. Functions

```ts
function validateAmount(amount: decimal<18, 2>): bool {
  return amount > 0.0;
}
```

Restrictions:

- no closures
- no generators
- no async functions
- no higher-order functions
- every function has explicit parameter and return types

Recursion is supported. A COBOL paragraph is not reentrant, so a recursive
function is emitted as a sibling `RECURSIVE` program with its locals in
`LOCAL-STORAGE`, reached with `CALL` rather than `PERFORM`. Mutual recursion is
detected through the call graph.

Functions may take type parameters; see section 5b.

### Locals

COBOL has no block scope. Every `let` becomes an `01` item in
`WORKING-STORAGE` — including one written inside a loop or a `switch` branch,
which is allocated once for the whole routine rather than per iteration.

A local keeps its own name when only one routine declares it. When two do, both
are qualified with the routine that owns them, the way parameters and results
already are:

```ts
function feeOn(amount: MoneyBDT): MoneyBDT {
  let scratch: MoneyBDT = amount; // 01 FEE-ON-SCRATCH
  return scratch;
}
```

Qualifying only on collision keeps the common case readable and keeps names
inside the 30-character limit IBM Enterprise COBOL imposes, which a transaction
name plus a local name can exceed. A recursive function is a separate program, so
its locals never collide with anything and are never qualified.

## 9. Control flow

Supported:

```ts
if / else
while ... limit <n>
return
```

Also supported: `for each` over bounded arrays, `switch` over enums, and
`raise` with an `on failure` handler (section 10b).

Never supported: `try`/`catch`, `throw`, `async`/`await`, `yield`. Failure is
modelled as an abandoned unit of work rather than a thrown value, because COBOL
has neither exceptions nor stack unwinding.

### `for each`

Iterating a bounded array needs no limit clause, because the array supplies the
bound:

```ts
for each month in loan.schedule {
  loan.schedule[month].dueBalance = running;
}
```

This lowers to `PERFORM VARYING` over the declared length. The index is
provably in range, so no runtime check is emitted for it.

### Bounded loops

Every loop must declare a static iteration limit:

```ts
while accountFeedStatus == "00" limit 100000 {
  read accountFeed into account;
}
```

The limit is not optional. An unbounded loop in a financial program can hold
locks or consume a batch window indefinitely, and the compiler cannot infer a
safe bound, so a missing limit is `BANK-TXN-004`.

The limit becomes a real guard counter in the generated COBOL, so a loop whose
condition never goes false still terminates.

## 9a. Operators

| Category   | Operators                   | Operand rules                            |
| ---------- | --------------------------- | ---------------------------------------- |
| Comparison | `<` `<=` `>` `>=` `==` `!=` | Ordering is decimal-only, matching scale |
| Equality   | `==` `!=`                   | Also works on `string<n>` and `bool`     |
| Logical    | `&&` `\|\|` `!`             | Bool operands only                       |
| Arithmetic | `+` `-` `*`                 | Decimal operands                         |
| Division   | `divide(a, b, "MODE")`      | Never a bare `/`                         |

Precedence, loosest first: `||`, `&&`, comparison, `+ -`, `*`, `!`, primary.
Comparisons do not chain.

Multiplication adds the operand scales: `decimal<18,2> * decimal<9,4>` produces
scale 6. That result usually needs rounding before it can be stored as money.

### Rounding is explicit

Division cannot be exact and narrowing a scale discards digits, so both require
a stated rounding mode:

```ts
let interest: MoneyBDT = round(balance * rate, "HALF_EVEN");
let share: MoneyBDT = divide(total, count, "HALF_UP");
```

A bare `a / b` is `BANK-DEC-003`. Assigning a wider scale to a narrower one
without `round(...)` is `BANK-DEC-002`.

| Mode        | COBOL `ROUNDED MODE IS`  | Use                                 |
| ----------- | ------------------------ | ----------------------------------- |
| `HALF_EVEN` | `NEAREST-EVEN`           | Banker's rounding; the usual choice |
| `HALF_UP`   | `NEAREST-AWAY-FROM-ZERO` | Common commercial rounding          |
| `HALF_DOWN` | `NEAREST-TOWARD-ZERO`    |                                     |
| `UP`        | `AWAY-FROM-ZERO`         |                                     |
| `DOWN`      | `TRUNCATION`             | Truncation                          |
| `CEILING`   | `TOWARD-GREATER`         |                                     |
| `FLOOR`     | `TOWARD-LESSER`          |                                     |

`round(...)` takes the scale of whatever it is assigned to, mirroring COBOL,
where `ROUNDED` attaches to the receiving field rather than to the expression.

### Decimal literals

A literal widens to any decimal with the same scale and enough precision, so
`25.00` is a valid `decimal<18, 2>`. The scale must still match exactly: `25.0`
is not a `decimal<18, 2>`, because changing scale is a rounding decision.

## 9b. Function calls

Functions may call other functions, including ones declared later in the file:

```ts
function accrue(balance: MoneyBDT, rate: Rate): MoneyBDT {
  return round(balance * rate, "HALF_EVEN");
}

transaction post(account: Account) {
  let interest: MoneyBDT = accrue(account.balance, rateFor(account.balance));
}
```

Calls lower to argument moves plus a `PERFORM`, because COBOL has no
call-in-expression form. Each parameter gets its own working-storage field, and
nested calls are ordered so inner results are ready before the outer call runs.

Recursion is supported, including mutual recursion.

A recursive function is emitted as a separate `RECURSIVE` COBOL program and
reached with `CALL` rather than `PERFORM`, because a COBOL paragraph is not
reentrant: performing one that is already active is undefined.

Its locals go in `LOCAL-STORAGE`, not `WORKING-STORAGE`. That distinction is
not cosmetic — `WORKING-STORAGE` is shared across invocations, so locals held
there are overwritten by the nested call and the program returns a wrong answer
while compiling perfectly.

## 9c. Assignment

```ts
account.balance = account.balance + 1.0;
advice.interestAmount = interest;
```

Assignment targets a local or a record field. The declared type must match, and
a narrowing assignment needs explicit rounding.

## 10. Transactions

Transactions are first-class:

```ts
transaction postTransfer(request: TransferRequest) {
  debit(request.debitAccount, request.amount);
  credit(request.creditAccount, request.amount);
  audit("TRANSFER_POSTED", request.idempotencyKey);
}
```

Rules:

- transaction must have an idempotency key
- transaction must emit at least one audit event
- debit and credit totals must balance for ledger-posting operations
- rollback path must be representable in target backend
- generated COBOL must expose transaction boundary in source map

### 10a. Entry point

COBOL enters a program at the first statement of the `PROCEDURE DIVISION`.
Without a designated entry that would be whichever declaration happened to be
emitted first, which no caller can rely on. `entry` names the transaction the
program starts at:

```ts
entry transaction runBatch(account: Account, advice: Advice) { ... }
```

The backend emits a `BANK-MAIN` paragraph that performs it. A program with no
`entry` starts at its first declared transaction. Two `entry` transactions is
`BANK-TXN-010`.

## 10b. Failures

COBOL has no exceptions and no stack unwinding, so BankTS models failure as an
abandoned unit of work rather than as a thrown value.

`raise` records a code and abandons the rest of the body:

```ts
function permittedAmount(account: SavingsAccount, requested: MoneyBDT): MoneyBDT {
  if requested <= 0.00 {
    raise "NON_POSITIVE_AMOUNT";
  }
  return requested;
}
```

`if <bad> { raise "..."; }` is a guard clause. It needs no `else`, because
control only reaches the next statement when the guard did not fire.

A transaction is the unit of work, so it is the only place a handler can sit:

```ts
entry transaction withdraw(account: SavingsAccount, result: WithdrawalResult) {
  on failure {
    audit("WITHDRAWAL_REJECTED", account.idempotencyKey);
  }
  ...
}
```

The handler is declared before the statements it covers, so a reader meets the
recovery path before the code that can trigger it. It runs when anything in the
body raises, including inside a function the body called.

What the backend generates:

- `BANK-FAILURE-CODE`, an `EXTERNAL` `PIC X(32)`, so a recursive function —
  which is a sibling program rather than a paragraph — raises into the same
  field its caller tests
- a wrapper paragraph that performs the body `THRU` its exit paragraph, then
  inspects the code. `THRU` is required: a `GO TO` out of a plain `PERFORM`
  range leaves the flow of control undefined
- a test after every `PERFORM` of a function that can fail, because COBOL will
  not propagate anything on its own
- a `ROLLBK` call to the ledger on the failure path, before the handler, for a
  transaction that posted. BankLang does not own the ledger and does not invent
  compensating postings

A transaction that cannot reach a failure generates none of this.

A handler may not itself raise (`BANK-TXN-009`): it is the last line of defence,
and there is no outer handler to catch it.

Failure codes are literals rather than expressions, so every failure a program
can signal is visible in the source, and in the audit report, without running
it. A code must be non-empty and fit `BANK-FAILURE-CODE` (`BANK-TXN-008`).

An out-of-range computed subscript raises `BANK-BOUNDS-VIOLATION` where a
handler can see it. It is not clamped: running the statement against a
substituted element is the defect the check exists to prevent.

## 11. Audit events

```ts
audit("TRANSFER_REJECTED", request.idempotencyKey, {
  reason: "INSUFFICIENT_FUNDS",
});
```

Audit event names are compile-time strings. Audit payloads must be typed records.

## 12. SQL

SQL is declared, never assembled at run time:

```ts
sql fetchAccount(keyAccountId: string<16>): AccountRow {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowAccountId, :rowBalance
  FROM ACCOUNT
  WHERE ACCOUNT_ID = :keyAccountId
}
```

BankLang does not parse SQL. It resolves the `:hostVariable` references,
rewrites them to the COBOL fields they bind to, and emits the statement inside
`EXEC SQL` / `END-EXEC`. Each host variable must resolve to exactly one place:
a declared parameter or a field of the result record. A name that matches both
is `BANK-SQL-003`.

Run a statement with `execute`:

```ts
execute fetchAccount(request.accountId) into row;

if sqlcode == 0 {
  // found
} else {
  // not found, or an error
}
```

`sqlcode` is readable wherever SQL can run. A body that runs SQL without ever
testing it is `BANK-SQL-001`: a row that was not found otherwise looks
identical to one that was.

Dynamic SQL (`EXECUTE IMMEDIATE`, `PREPARE`) is `BANK-SQL-002`, because it
cannot be precompiled, bound, or checked ahead of time.

## 14. CICS

An online transaction is declared with `cics`:

```ts
cics transaction accountEnquiry(request: EnquiryRequest, reply: EnquiryReply) {
  link "AUDITLOG" commarea reply resp linkResp;

  if linkResp == 0 {
    syncpoint resp commitResp;
  } else {
    rollback resp rollbackResp;
  }
}
```

A CICS transaction receives input through `DFHCOMMAREA` in the `LINKAGE
SECTION` and ends with `EXEC CICS RETURN` rather than `GOBACK`.

| Rule                                    | Diagnostic      |
| --------------------------------------- | --------------- |
| Every command must capture `resp`       | `BANK-CICS-001` |
| CICS commands need a `cics transaction` | `BANK-CICS-002` |
| No syncpoint or rollback inside a loop  | `BANK-CICS-003` |

`BANK-CICS-003` exists because a syncpoint inside a loop commits or discards
partial work on every iteration, which is rarely what a transaction means.

## 15. Backend requirements and precompilation

Embedded SQL requires the Db2 precompiler and CICS commands require the CICS
translator. Neither is a COBOL compiler feature: on z/OS, `DSNHPC` and the CICS
translator rewrite those blocks into calls before the compiler runs.

BankLang ships its own precompiler that performs the equivalent translation, so
such a program can still be compiled and checked locally:

- `EXEC SQL INCLUDE SQLCA` expands to the SQLCA structure.
- `EXEC SQL ... END-EXEC` becomes a call to the SQL runtime, passing SQLCA, a
  statement descriptor identifying the call site, and every host variable the
  statement referenced. Db2 numbers a program's statements the same way, because
  the operands alone do not say which statement is being run.
- `EXEC CICS ... END-EXEC` becomes a call to the CICS runtime, passing the EXEC
  interface block, a generated field naming the command, and every data item the
  command referenced.
- A command's `RESP` option is not passed as an operand. CICS returns a response
  in `EIBRESP`, so the translator emits the `MOVE EIBRESP TO ...` that follows
  the call — which is what makes a generated program's error branch reachable.

**What this proves:** the surrounding COBOL is valid, every host variable and
data name resolves, and SQLCA fields such as `SQLCODE` are declared and usable.
Against the reference runtime in `runtime/`, it also proves that the branch a
`sqlcode` or `resp` test guards is reached and taken.

**What it does not prove:** SQL semantics, Db2 bind behaviour, or CICS runtime
behaviour. It is not IBM's precompiler and produces no bind artifacts. The
reference runtime replays outcomes a test writes down; a scripted `SQLCODE 100`
says what the generated program does with a missing row, not what Db2 would
return.

The translated output exists only for verification. The shipped artifact keeps
its `EXEC SQL` and `EXEC CICS` blocks.

## 13. File declarations

```ts
file accountInput sequential input record AccountRecord status accountInputStatus;
file postingOutput sequential output record PostingRecord status postingOutputStatus;
```

Rules:

- file status must be checked
- record type must map to a copybook-compatible layout
- generated COBOL must contain file-control and FD sections

The `status` clause names the field that receives the COBOL `FILE STATUS`
value. It is optional at parse time so that a missing status is reported as
`BANK-FILE-001` with a remediation hint rather than as a syntax error.

### File operations

```ts
open accountFeed;
read accountFeed into account;
write adviceOutput from advice;
close accountFeed;
```

The record variable's type must match the file's declared record type, or the
bytes would not line up; a mismatch is `BANK-FILE-002`. Reading an output file
or writing an input file is `BANK-FILE-001`.

A `read` sets the status field to `"10"` at end of file, so a batch loop can
test it:

```ts
while accountFeedStatus == "00" limit 100000 {
  read accountFeed into account;
}
```

Read and write map the record **field by field** rather than moving it as a
group, so the correspondence between the file record and working storage is
explicit in the generated COBOL and does not depend on the two layouts being
byte-identical. An array field is copied element by element, because COBOL
rejects a move of an `OCCURS` item without a subscript.

The `FD` record is emitted as an unstructured buffer sized from the copybook
layout, and the structured record is declared once in working storage. Emitting
the record inside each `FD` as well would duplicate field names and make every
unqualified reference ambiguous.

## 14. Banned features

BankTS rejects:

- `any`
- `unknown` without narrowing
- `eval`
- object spread in data-layout records
- dynamic property access on records
- floating-point money
- implicit string-number coercion
- implicit nullable access
- prototype mutation
- ambient runtime mutation
- time-zone-dependent operations without explicit calendar/time-zone policy

## 15. Naming strategy

Source identifiers are converted to COBOL names deterministically.

Example:

```txt
validateAmount -> VALIDATE-AMOUNT
TransferRequest -> TRANSFER-REQUEST
debitAccount -> DEBIT-ACCOUNT
```

Conflicts are resolved with stable suffixes derived from source position and symbol table order, not randomness.
