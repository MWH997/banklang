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

### 3a. Dates and times

Banking is dates: a value date is not a posting date, an accrual runs between
two of them, and a maturity is compared against today. They are separate types
rather than aliases for a number, so a date cannot be compared with an amount,
or with a plain integer that happens to have eight digits.

| Type        | Storage     | Holds                        |
| ----------- | ----------- | ---------------------------- |
| `date`      | `PIC 9(8)`  | `YYYYMMDD`                   |
| `time`      | `PIC 9(6)`  | `HHMMSS`                     |
| `timestamp` | `PIC X(26)` | the Db2 host variable format |

`PIC 9(8)` as `YYYYMMDD` is the mainframe convention, and it is chosen for a
reason that matters: in that layout, ordinary numeric comparison is also
chronological comparison, and an ordinary sort is a chronological sort. A
timestamp is stored in Db2's own host variable format so it can be read from and
written to a `TIMESTAMP` column without conversion.

Dates order with `<`, `<=`, `>`, `>=`, `==`, and `!=`, but only against the same
kind: comparing a `date` with a `time`, or with an amount, is `BANK-TYPE-003`.

Three builtins do the arithmetic:

```ts
let runDate: date = today();
let term: decimal<9, 0> = daysBetween(loan.openedOn, loan.maturesOn);
let grace: date = addDays(loan.maturesOn, 5);
```

These lower to the COBOL intrinsics that know the calendar — `CURRENT-DATE`,
`INTEGER-OF-DATE`, and `DATE-OF-INTEGER` — rather than to `+` on the stored
digits. That is the whole reason they exist: thirty days after the 31st of
January is the 2nd of March, which arithmetic on `20260131` would never produce.
A date is therefore not something you can add to directly, and a fraction of a
day is not a number of days (`BANK-TYPE-003`).

`now()` reads the clock and assembles a `timestamp`. `CURRENT-DATE` offers
hundredths of a second, so the last four digits of the microseconds are zeros
rather than invented.

### 3c. How a number is stored

`decimal<p, s>` is packed decimal, `COMP-3`, which is what a ledger amount is
held in. Two other usages exist because a real estate's copybooks are full of
them, and a compiler that only knows `COMP-3` cannot read those files at all:

| Declaration    | Picture                                      | Bytes           | Used for                             |
| -------------- | -------------------------------------------- | --------------- | ------------------------------------ |
| `decimal<p,s>` | `PIC S9(p-s)V9(s) COMP-3`                    | `ceil((p+1)/2)` | money, and anything computed with it |
| `binary<n>`    | `PIC S9(n) COMP`                             | 2, 4, or 8      | counters, sequence numbers, codes    |
| `zoned<p,s>`   | `PIC S9(p-s)V9(s) SIGN IS TRAILING SEPARATE` | `p + 1`         | unpacked numbers in legacy input     |

A `binary` field is held in the halfword, fullword, or doubleword that fits its
declared digit count, which is how IBM Enterprise COBOL allocates `COMP`: 1–4
digits take two bytes, 5–9 take four, 10–18 take eight. More than eighteen is
`BANK-TYPE-002` — a doubleword holds no more.

Zoned decimal is one byte per digit with the sign kept separate, so the field
reads as plain text, which is what a file another system or a person reads
needs.

`native<n>` is `COMP-5`, which holds the full range its storage can express
rather than truncating to the picture's decimal digits. That is what an
interface to something outside COBOL needs, and it is why the SQLCA uses it.

### Alignment

```ts
counter: binary < 9 > sync;
```

`sync` aligns a field on its natural boundary — a halfword, fullword, or
doubleword, by width — and the compiler inserts slack bytes before it to get
there.

It is the one layout clause that moves every later field without appearing in
any field's own length, so a copybook that uses it and a reader that ignores it
disagree **silently**: every field after the first aligned one is read from the
wrong place. The layout report accounts for the slack, and counts it in the
record's length.

**Usage is representation, not meaning.** A count is a count whichever bytes
hold it, so usage takes no part in type compatibility — only in the picture and
the byte count. Currency stays nominally typed regardless: a BDT amount is still
not an unqualified number that happens to have two decimals.

### Naming a run of fields

```ts
record LegacyDate {
  yearPart: zoned<4, 0>;
  monthPart: zoned<2, 0>;
  dayPart: zoned<2, 0>;

  wholeDate renames yearPart through dayPart;
}
```

A legacy copybook splits a date into year, month, and day and then wants to move
all three at once. `renames` emits a level-66, which gives that run a second
name without a second copy of the storage — that is what distinguishes it from
`redefines`, which is a new _reading_ of the same bytes.

It costs nothing and appears after the record's own fields, which is where COBOL
requires it. Both ends are qualified by the group in the generated code, because
the same record is emitted in working storage and again inside every `FD` that
holds it.

The name reads as the alphanumeric span it covers — `string<11>` above, since
zoned decimal is a byte per digit plus one for the separate sign — which is
exactly what a COBOL group move treats it as. Both ends have to be fields of the
record, the first has to come before the last, and the run cannot cross a table
whose length depends on a count, since a 66 has no length of its own
(`BANK-COPY-004`).

### How a field is presented

```ts
reference: string < 12 > justified;
movement: (edited < GBP, "grouped" > blankWhenZero);
```

`justified` emits `JUSTIFIED RIGHT`. COBOL moves an alphanumeric value
left-aligned and pads on the right; this reverses it, which is how a code lands
in the right of a fixed column without the program counting spaces. Alphanumeric
only — a number's alignment comes from its picture (`BANK-COPY-005`).

`blankWhenZero` emits `BLANK WHEN ZERO`: a statement line with no movement
prints blank rather than `0.00`, and says so in the record rather than in a
conditional. Numbers and edited fields only, since there has to be a zero to
blank.

`sync`, `justified`, and `blankWhenZero` may be written in any order.

### 3b. Edited fields

An amount held as `COMP-3` cannot be printed. `edited<T, "style">` declares the
rendering, and assignment into it is the formatting step — which is exactly what
a COBOL `MOVE` into a numeric-edited item does:

```ts
record StatementRow {
  amount: MoneyBDT;
  printedAmount: edited<MoneyBDT, "signed">;
}

row.printedAmount = row.amount; // MOVE AMOUNT OF ... TO PRINTED-AMOUNT OF ...
```

The picture is generated from the value's own precision and scale, so nobody
counts `Z`s:

| Style         | Picture for `decimal<18,2>`  | Reads as      |
| ------------- | ---------------------------- | ------------- |
| `"plain"`     | `ZZZZZZZZZZZZZZZ9.99`        | `1234.50`     |
| `"grouped"`   | `Z,ZZZ,ZZZ,ZZZ,ZZZ,ZZ9.99`   | `1,234.50`    |
| `"signed"`    | `Z,ZZZ,ZZZ,ZZZ,ZZZ,ZZ9.99-`  | `1,234.50-`   |
| `"credit"`    | `Z,ZZZ,ZZZ,ZZZ,ZZZ,ZZ9.99CR` | `1,234.50CR`  |
| `"protected"` | `*,***,***,***,***,**9.99`   | `***1,234.50` |
| `"slashed"`   | `9999/99/99` (a `date` only) | `2026/08/05`  |

Leading positions suppress and the last integer position stays `9`, so a zero
amount prints as `0.00` rather than as nothing. Decimals never suppress: an
amount is read to the penny, and a blank penny column is a defect. Asterisk fill
is cheque protection — it leaves no room to write digits in. `CR` rather than a
minus is the accounting convention for a credit balance.

**An edited field is a rendering, not a number.** It may be assigned from a
value of its inner type and written to a file or a report line. It may not be
read back as a value, compared, or computed with — which is also what COBOL
allows, and which stops a report column becoming arithmetic input and losing
the digits the editing removed. A style the compiler does not know is
`BANK-TYPE-023` rather than a picture passed through unchecked.

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

### 5c. Variant records and variable-length tables

Two clauses a real copybook is built on:

```ts
record LegacyRecord {
  recordType: string<2>;
  personalName: string<40>;
  companyName: string<40> redefines personalName;

  lineCount: binary<4>;
  lines: Entry[100] depending on lineCount;
}
```

`redefines` is a second reading of storage another field already occupies —
how a legacy layout says "this area means different things depending on the
record type". The field it redefines must be declared before it, and it must be
no longer, because COBOL gives a redefining field no storage of its own and a
longer one reads past the end into whatever follows (`BANK-COPY-004`). The
layout report shows it at the offset it shares, and the record's length is
unchanged by it.

`depending on` names the field holding how much of a table this record uses,
which is what makes a variable-length record variable. The fixed bound stays as
the maximum — the storage still has to be reserved — so the emitted clause is
`OCCURS 1 TO 100 TIMES DEPENDING ON LINE-COUNT`. The count must be a whole
number declared before the table, because COBOL reads it to decide the record's
length and cannot read a field it has not reached.

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

### `search`

```ts
search row in statement.lines where row.entryKind == "DEBIT" {
  // the first matching row, bound to `row`
} else {
  // no row matched
}
```

A linear scan with `for each` finds a row too, but it runs the whole table every
time and says nothing about what it was looking for. `SEARCH` stops at the first
match, and its `AT END` covers the case a hand-written scan usually forgets —
which is why the `else` is required rather than optional.

Every `OCCURS` carries an `INDEXED BY`, because COBOL's `SEARCH` walks an index
rather than a subscript. It costs nothing when nothing searches the table. The
index is set to 1 before each search: `SEARCH` begins wherever the index happens
to be pointing, and a stale one silently skips the front of the table.

The element name stands for the entry the index is pointing at, so the condition
and the body talk about the row rather than about a subscript.

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

## 8a. Strings

Six builtins cover what a banking program does to text:

```ts
trim(name)                      // FUNCTION TRIM
upper(name)  lower(name)        // FUNCTION UPPER-CASE / LOWER-CASE
substring(cardNumber, 16, 4)    // reference modification: field(16:4)
concat(prefix, " ", suffix)     // STRING ... DELIMITED BY SIZE INTO
now()                           // a Db2 timestamp, from CURRENT-DATE
```

Every result has a length the compiler can name, because a COBOL field has a
fixed one. `substring` therefore takes **literal** bounds — a length decided at
run time has no `PIC X(n)` to land in — and a slice that runs past the end of
its string is rejected outright. `concat` sums its arguments' lengths.

A computed string pads into a wider field, exactly as a written literal does,
because COBOL pads a shorter alphanumeric with spaces. It will not truncate into
a narrower one.

`concat` and `now` build a value rather than name one, so they lower to a
`STRING` statement rather than appearing inline; the target is cleared first,
because `STRING` leaves whatever was past the end of the new value alone.

This is also what makes masking expressible, and therefore what the `sensitive`
declassification rule in section 11 rests on:

```ts
function maskPan(pan: string<19>): string<16> {
  return concat("************", substring(pan, 16, 4));
}
```

Two more work on characters rather than whole fields, and lower to `INSPECT`:

```ts
row.commas = countOf(row.narrative, ","); // INSPECT ... TALLYING
row.branch = replaceChars(row.branch, " ", "0"); // INSPECT ... CONVERTING
```

`replaceChars` converts character by character, so the two sets must be the same
size — anything else is a substitution, which COBOL has no single statement for.

`split` takes a field apart, which is `UNSTRING`:

```ts
split reference by "-" into request.branch, request.account;
```

Every receiver is a string, because `UNSTRING` writes into fixed fields.

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

### Restricted data

A record field may be marked `sensitive`:

```ts
record Statement {
  accountId: string<16>;
  sensitive holderName: string<40>;
  sensitive nationalId: string<20>;
  idempotencyKey: string<36>;
}
```

The marking is on the field rather than inferred from its name, because whether
a value is restricted is a decision about the data and not a guess from
spelling. What the compiler adds is that the decision then holds everywhere the
value goes, rather than everywhere someone remembered.

A restricted value may not reach an **audit event** or a **ledger posting**
(`BANK-AUD-002`). Both are durable records that outlive the transaction and are
read by people with no business seeing a card number. It may not be assigned to
a field that is not itself marked (`BANK-SEC-001`): a field's marking is part of
its record declaration and therefore part of its copybook, so copying restricted
data into an unmarked field would reclassify it silently.

It may be read, compared, computed with, and written to a file — which is where
such data legitimately lives. The layout report marks which fields carry it, so
an auditor reading the evidence does not have to read the source.

The check follows a value through locals:

```ts
let carried: string<20> = customer.nationalId;
audit("SETTLED", carried);            // BANK-AUD-002
```

**The stated limit: a function call declassifies.** Taint does not cross a call,
so `maskPan(card.number)` is unrestricted and the compiler does not check that
`maskPan` masks anything. Following taint across a call would need per-function
summaries, and a language with no closures and no higher-order functions can
express masking no other way — so the call is the declassification point, made
explicit rather than hidden.

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

### Writing, and the unit of work

A `sql` declaration carries whatever statement was written, so `INSERT`,
`UPDATE`, and `DELETE` need nothing special:

```ts
sql insertPosting(keyAccount: string<16>, keyAmount: MoneyBDT) {
  INSERT INTO POSTING (ACCOUNT_ID, AMOUNT) VALUES (:keyAccount, :keyAmount)
}
```

`commit;` and `rollback;` end the unit of work in a batch program, lowering to
`EXEC SQL COMMIT` and `EXEC SQL ROLLBACK`.

Neither is available inside a `cics transaction` (`BANK-SQL-004`). There CICS
owns the syncpoint and commits Db2's work along with everything else, so an
`EXEC SQL COMMIT` is not merely redundant — Db2 rejects it at run time. Use
`syncpoint resp <status>;` instead, which is why that statement exists.

**Positioned update.** `WHERE CURRENT OF <cursor>` names a cursor the program
declared, and the compiler rewrites it to that cursor's COBOL name — without
which the update would refer to a cursor Db2 has never heard of:

```ts
sql zeroCurrentRow() {
  UPDATE ACCOUNT SET BALANCE = 0 WHERE CURRENT OF accountsInBranch
}
```

The cursor it names must be declared `FOR UPDATE OF` the columns being changed.
BankLang does not parse SQL, so it cannot check that for you.

### Cursors

A query that returns many rows is declared with `cursor` and read with a bounded
loop:

```ts
cursor accountsInBranch(keyBranch: string<8>): AccountRow {
  SELECT ACCOUNT_ID, BALANCE, STATUS
  INTO :rowAccountId, :rowBalance, :rowStatus
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
  ORDER BY ACCOUNT_ID
}

for each row in accountsInBranch(request.branchId) limit 5000 {
  // runs once per row, with the row in `row`
}
```

The `OPEN` and the `CLOSE` are generated around the body rather than written, so
a cursor cannot be left open — a cursor still holding Db2 locks at the end of a
batch window is a defect the language can simply make unwritable. There is
deliberately no `open` / `fetch` / `close` to write by hand; that shape would
need three more diagnostics to reach the same guarantee and would still permit
the bug.

The bound is mandatory, for the reason a `while` bound is: a cursor over a table
nobody sized is an unbounded loop holding locks. Omitting it is `BANK-TXN-004`.

The generated loop leaves on any non-zero `SQLCODE`, not only on 100. Treating
an error as end-of-data would process a partial result set as though it were the
whole one, which is how a batch silently under-posts. Because the loop tests
`SQLCODE` itself, it does not put the body under `BANK-SQL-001`; an `execute` in
the body still does.

**Where the `INTO` goes.** `DECLARE CURSOR` may not carry an `INTO` — Db2 puts
the row's destination on the `FETCH`, which is where a row actually arrives.
Writing it on the SELECT is how the query reads, so the author writes it there
and the compiler moves it:

```cobol
       EXEC SQL
           DECLARE ACCOUNTS-IN-BRANCH CURSOR FOR
           SELECT ACCOUNT_ID, BALANCE, STATUS
           FROM ACCOUNT
           WHERE BRANCH_ID = :ACCOUNTS-IN-BRANCH-H1
           ORDER BY ACCOUNT_ID
       END-EXEC.
...
           EXEC SQL
               FETCH ACCOUNTS-IN-BRANCH
               INTO :ROW-ACCOUNT-ID OF ACCOUNT-ROW, ...
           END-EXEC
```

A cursor with no result record, or no `INTO`, is `BANK-SQL-006`: a fetched row
would have nowhere to go, and this compiler does not parse SQL well enough to
bind the select list to the record's fields positionally instead.

A cursor and a `sql` statement are not interchangeable (`BANK-SQL-005`). One
lowers to a single `EXEC SQL`, the other to four.

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

Beyond `link`, `syncpoint`, and `rollback`:

```ts
readFile    "ACCTFILE" into row  key request.accountId resp readResp;
writeFile   "ACCTFILE" from row  key request.accountId resp writeResp;
rewriteFile "ACCTFILE" from row  resp writeResp;

writeQueue "ENQLOG" from row resp writeResp;
readQueue  "ENQLOG" into row resp readResp;

returnTransid "ENQ2" commarea request;
```

A CICS file command reaches a VSAM dataset through the region rather than
through COBOL file control: there is no `open`, no `close`, and no FD, because
CICS owns the dataset and the program only asks. A read or write names the key
it addresses; a rewrite does not, because it updates the record the preceding
read is holding and naming a key would describe a different operation.

Temporary storage is the scratchpad an online transaction passes state through.
A queue command is ordinary work rather than a commit boundary, so unlike a
syncpoint it is allowed inside a loop.

`returnTransid` ends the task naming what runs next, which is how a
pseudo-conversation continues: CICS frees the program between the halves and
starts the named transaction when the terminal replies. It takes no `resp`,
because there is no response to come back to, and the compiler does not append a
second `EXEC CICS RETURN` after one.

**Not yet available:** BMS `SEND`/`RECEIVE MAP`, `START`/`RETRIEVE`, channels
and containers, and `HANDLE ABEND`.

| Rule                                                  | Diagnostic      |
| ----------------------------------------------------- | --------------- |
| Every command but `returnTransid` must capture `resp` | `BANK-CICS-001` |
| CICS commands need a `cics transaction`               | `BANK-CICS-002` |
| No syncpoint or rollback inside a loop                | `BANK-CICS-003` |

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

The generated JCL carries the steps those blocks require, in the order z/OS
needs them: the CICS translator first, then the Db2 precompiler, then the
compiler, the link-edit, and the bind. A job that omitted the precompile step
would not be an incomplete skeleton but a wrong one — it would describe a build
that cannot succeed. A batch program's declared files become DD statements named
after the same DD the generated `SELECT` assigns to. A CICS program gets no run
step at all: it is started by a transaction identifier in a region, not by
`EXEC PGM` in a job.

Dataset names, unit and space parameters, and the Db2 subsystem and package
names are placeholders for an installation's own standards.

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

A file is declared `input`, `output`, or `update`. `update` opens I-O, which is
what a master file update needs: the same `OPEN` serves the read that finds a
record and the `rewrite` that puts it back.

An indexed file is declared `ACCESS MODE IS DYNAMIC`, not `RANDOM`, because it
is both read by key and browsed, and `RANDOM` allows only the first.

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

### Alternate keys

```ts
file accountMaster indexed input record Account
  key accountId alternate customerId, branchId status masterStatus;
```

A KSDS is read by its primary key and browsed by any of its alternates. A
program that can only name the primary cannot open a file whose alternate index
is the whole reason it exists — an account file read by customer, say.

Each alternate is declared `WITH DUPLICATES`, because many accounts per customer
is nearly always why one exists. Only an indexed file has them
(`BANK-FILE-004`).

### When an operation fails anyway

```ts
on error accountInput {
  log "FILE ERROR ", inStatus;
  returnCode = 12;
}
```

A file status check covers the statement that thought to look. This covers the
ones that did not: COBOL runs a `USE AFTER STANDARD ERROR` procedure when any
operation on that file fails, wherever it was written. That is what makes
`DECLARATIVES` the standard error path rather than a convenience.

The handler is declared at the top level, not inside a transaction, because it
is not reached from one — it runs when the failure happens. It sees the file
statuses and nothing else: there is no record in scope and no ledger to post to.

A file may have one handler (`BANK-FILE-005`), which is what COBOL allows. When
any handler exists, the program's own paragraphs move into a `BANK-BODY SECTION`,
because everything after `DECLARATIVES` has to be in a section.

### Browsing an indexed file

```ts
start accountMaster key master.accountId;   // position at or after the key
readNext accountMaster into master;         // walk from there
```

`START` uses `KEY IS NOT LESS THAN`, which begins at the first record at or
after the key — what a range walk wants. An exact match would make a browse from
a partial key impossible.

`readNext` reports end of data through the file status, the way a sequential
read does, because a browse runs out rather than failing.

### Updating in place

```ts
read accountMaster into master key master.accountId;
master.balance = master.balance + amount;
rewrite accountMaster from master;

delete accountMaster key master.accountId;
```

`rewrite` and `delete` need the file open for `update`, because updating a
record in place means finding it first (`BANK-FILE-005`). `start` and `readNext`
need an `indexed` file, because there is no index to walk otherwise. A `write`
or `rewrite` to an indexed file captures `INVALID KEY` in the file status: a
duplicate key is the failure a KSDS write actually has, and it is silent
otherwise.

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

## 13a. Batch operations

```ts
returnCode = 4;
```

The step's condition code, which lands in COBOL's `RETURN-CODE` and reaches the
job as the value the next step's `COND=` tests. Without it every step reports
success, and a job that found no records looks exactly like one that processed a
million. Conventionally 0 ran clean, 4 warned, 8 failed, 12 or more is fatal.

It must be a whole number in 0–4095, which is what `RETURN-CODE` holds.

### Talking to the job

```ts
accept parameter into run.mode;      // ACCEPT ... FROM SYSIN
accept date into run.runDate;        // ACCEPT ... FROM DATE YYYYMMDD
accept time into run.startedAt;      // ACCEPT ... FROM TIME
log "STARTED ", run.mode;            // DISPLAY ... UPON SYSOUT
reset summary;                       // INITIALIZE
```

The job log is the operator's only view of what happened between the return code
and an abend, and a job parameter is how the same program runs a different
cycle. `UPON SYSOUT` puts the message in the job's output rather than wherever
the runtime defaults to, and `FROM DATE YYYYMMDD` gives the four-digit year the
unqualified form does not.

A restricted value may not be written to the log (`BANK-AUD-002`), for the same
reason it may not reach an audit event: the log outlives the run and is read
widely.

`reset` clears a whole record — alphanumerics to spaces, numerics to zero.
Clearing it field by field is the same thing written out, and drifts the moment
the record gains a field.

### Paginating a report

```ts
file statementReport sequential output record ReportLine
  page 60 footing 55 top 3 bottom 3 status reportStatus;

write statementReport from heading advancing page;
write statementReport from line advancing 1 on page {
  write statementReport from heading advancing page;
};
```

`page` emits `LINAGE`. It is what makes a report paginate: COBOL counts the
lines written and signals end of page at the footing, which is where a program
writes its carried-forward total and the next page's heading. Without it a
statement run is one unbroken column of text. `footing`, `top`, and `bottom` are
optional; a depth alone is a page.

`advancing <n>` and `advancing page` emit `AFTER ADVANCING`, so a line is
written after spacing rather than on top of the last one.

`on page { ... }` is `AT END-OF-PAGE`. It needs the file to declare a depth,
since otherwise there is no page for a write to reach the end of
(`BANK-FILE-007`), and a page depth belongs to a `sequential output` file —
a keyed file has records, not lines to space.

### What the copybook contains

A generated copybook is the record's own COBOL declaration, not a summary of it:
every clause the program's inline record carries, the copybook carries too —
`REDEFINES`, `OCCURS` with its index, `SYNCHRONIZED`, `JUSTIFIED`, `BLANK WHEN
ZERO`, the nested groups, and the 88-levels of an enum.

That matters under `copybookMode: "copy"`, where the program's storage **is** the
copybook. A clause the copybook omitted was a clause the program did not have: a
redefining field took storage of its own and pushed every later field along, a
table collapsed to a single element, and an aligned field lost the slack bytes.
`bankc copybook inspect` reads the same structure, so its offsets and the layout
report's agree.

### Ordering the input

```ts
sort rawPostings into sortedPostings on branchId, descending accountId;
merge morningFile, eveningFile into dayFile on accountId;
```

An internal `SORT` is what a program uses when the ordering is its own business
rather than the job's. It runs through a sort-work file, described by `SD`
rather than `FD` because the sort owns its blocking, and the generated job
allocates `SORTWK01` for it. `USING` and `GIVING` let the sort open, read, write,
and close the files itself — the form to use when there is nothing to do to the
records on the way through.

Every file a sort touches holds the same record, and every key is a field of it:
a key that is not in the record sorts on nothing (`BANK-FILE-005`). A `merge`
takes two or more already-sorted inputs.

### Working on the records on the way through

```ts
sort rawPostings into sortedPostings on branchId, descending accountId
  input posting {
    if posting.amount > 0.00 {
      release posting;
    }
  }
  output posting {
    write sortedPostings from posting;
  };
```

A procedure replaces the clause it stands in for: `input` replaces `USING`,
`output` replaces `GIVING`. They are alternatives, not additions — the sort
either handles the file itself or leaves it to the program. Either may be given
alone.

The record named after `input` or `output` is an ordinary record variable, the
same way `read <file> into <record>` names one, so the body reads and assigns
fields exactly as the rest of the program does. Only the loop is generated: the
`OPEN`, the `READ` or `RETURN`, the end-of-data test, and the `CLOSE`.
Hand-writing those is where this shape is usually got wrong — a `RETURN` whose
`AT END` is forgotten reads the last record forever.

`release` is the statement an input procedure exists for. The records it does
not release are the ones the procedure filters out. It only means anything while
a sort is running, so writing it anywhere else is `BANK-FILE-006`, as is an
input procedure that never reaches one: that sorts an empty file, and there is
no reading of the program under which it is what was meant.

A `merge` takes no input procedure (`BANK-FILE-006`). Its premise is that the
inputs already arrive in order, and a procedure that could drop or reorder
records would break it. An output procedure on a merge is fine.

The procedures are emitted as `SECTION`s after the last `GOBACK`, because a
section in the flow of control would be run again on the way past; an
`INPUT PROCEDURE` is meant to be entered by `SORT` and by nothing else.

### Surviving a failure

```ts
checkpoint restartFile from restartPoint every 1000;
```

A job that dies halfway is rerun. Without a position written down, the rerun
starts at the beginning and posts everything twice. A checkpoint writes that
position and, in a program with SQL, commits the work up to it — position first,
commit after, so a restart that finds a position can trust everything up to it
is durable.

Counting rather than checkpointing every record is the whole trade: a commit
costs time, and rework after a failure costs the records since the last one.

A transaction that posts to the ledger **inside a loop** with no checkpoint is
`BANK-FILE-003`. It is a **warning**, not an error: the compiler can see the
hazard but cannot tell whether the job is rerunnable another way — a consumed
and recreated input, a small enough window, an operator procedure. It reports
what it can see and leaves the judgement where the knowledge is. A single
posting outside a loop is not flagged; rerunning that is the caller's problem,
and the idempotency key covers it.

## 14a. Copybooks in the program

`bankc` emits a `.cpy` file for every record. Whether the generated program
writes those layouts out or copies them in is a project setting:

```json
{ "copybookMode": "inline" }
```

| Mode     | Generated program               | For                                         |
| -------- | ------------------------------- | ------------------------------------------- |
| `inline` | `01 TRANSFER-REQUEST.` + fields | a self-contained artifact, reviewable alone |
| `copy`   | `COPY TRANSFER-REQUEST.`        | a shop with a shared copybook library       |

`inline` is the default: it is what the playground shows and what a reviewer
reads on its own.

`copy` is the shape a real shop expects, where the copybook is the contract
between programs rather than a document that can drift from them. The generated
job then carries a `SYSLIB` for the copybook library — without it the copy
statements resolve to nothing and every data name is undefined — and local
GnuCOBOL validation puts the copybook directory on the compiler's search path,
so the mode that ships is the mode that is checked.

The record stays traceable in `copy` mode: the source map carries one entry for
the record and none for its fields, because the fields are in the copybook and
have a layout report of their own.

## 14b. Locale conventions

Two `SPECIAL-NAMES` clauses are program-wide facts rather than per-field ones,
so they are project settings:

```json
{ "decimalPoint": "comma", "currencySign": "#" }
```

`DECIMAL-POINT IS COMMA` is what much of Europe writes: 1.234,56. It swaps the
roles of the comma and the point **inside pictures too**, so a grouped amount
becomes `PIC Z.ZZZ.ZZ9,99` — the compiler rewrites edited pictures to match. A
picture built the other way round is not merely printed oddly; the COBOL
compiler rejects it, because the separator would appear more than once.

`CURRENCY SIGN` must be a single ASCII character that a picture does not already
use. `E` is exponent notation, `Z` is suppression, `V` is the implied point, and
so on; `£` and `€` are more than one byte and cannot sit in a picture position
at all. An invalid one is reported when the configuration is read rather than
producing a program the COBOL compiler refuses.

## 15. Naming strategy

Source identifiers are converted to COBOL names deterministically.

Example:

```txt
validateAmount -> VALIDATE-AMOUNT
TransferRequest -> TRANSFER-REQUEST
debitAccount -> DEBIT-ACCOUNT
```

Conflicts are resolved with stable suffixes derived from source position and symbol table order, not randomness.
