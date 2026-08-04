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

- no closures in v0.1
- no generators
- no async functions
- no higher-order functions in v0.1
- recursion disabled by default
- every function has explicit parameter and return types

## 9. Control flow

Supported:

```ts
if / else
while ... limit <n>
return
```

Not yet implemented: `for each` over bounded arrays, and `switch` over enums.

Never supported: `try`/`catch`, `throw`, `async`/`await`, `yield`.

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

Recursion is not supported.

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

## 15. Backend requirements

Embedded SQL requires the Db2 precompiler and CICS commands require the CICS
translator. A program using either **cannot be validated by a plain COBOL
compiler**, and BankLang reports that rather than pretending otherwise:

```txt
| compiler-status         | requires-preprocessor                          |
| validated-with-gnucobol | no                                             |
| compiler-command        | not run: requires db2-precompiler and cics-translator |
```

The compile-verification lane reports such programs instead of passing them.

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

Operations move whole records between the file buffer and working storage.
There is no per-field file mapping yet.

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
