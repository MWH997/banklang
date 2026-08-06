# Functions and calls

Functions, string handling, calls between routines, calls to another program, and assignment.

Part of the [BankTS language reference](../language-reference.md).

## Functions

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

### Nested functions

```ts
nested function accrued(position: Position): decimal<9, 2> {
  let raw: decimal<9, 2> = round(position.balance * position.rate, "HALF_UP");
  return divide(raw, 100.0, "HALF_UP");
}
```

An ordinary function is a paragraph the program `PERFORM`s, sharing all its
storage. A `nested function` is a COBOL **contained program**: `PROGRAM-ID
... COMMON.`, written inside the container before its `END PROGRAM`, with its
own working storage and a real `CALL` boundary.

What it buys is what a sibling program cannot do — **it reads the module's
records directly**, because the container declares them `GLOBAL`:

```cobol
       01  POSITION-FLD GLOBAL.
...
       PROGRAM-ID. ACCRUED COMMON.
       PROCEDURE DIVISION USING LK-RESULT.
           COMPUTE RAW ... = (BALANCE OF POSITION-FLD * RATE OF POSITION-FLD)
```

So a record parameter is not passed at all: the callee can already see the
record, and handing it over as well would be a second name for the same storage.
Scalars still travel through `LINKAGE`, because a value has to be handed over.

**A nested function cannot recurse** (`BANK-TYPE-027`). COBOL forbids
`LOCAL-STORAGE` in a contained program, so its locals are one copy shared by
every invocation: a recursive call would overwrite them on the way down and read
the innermost call's values on the way back out — it compiles, it runs, and it
returns the wrong number. Drop `nested` and an ordinary recursive function is
emitted as a sibling with `LOCAL-STORAGE`, which is what makes recursion safe.

`nested` is contextual, and only in front of `function`, so it stays usable as a
field and parameter name.

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

## Strings

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

## Function calls

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

## Calling another program

```ts
call request.productModule using payload on error {
  returnCode = 12;
};

cancel request.productModule;
```

A **dynamic** `CALL`: the module is named by a value, not written into the
source. That is how a bank dispatches — a product code selects the module that
prices it, and a new product ships as a new load module without relinking
anything that calls it.

The name is `string<8>` or a literal, because that is what a load module name
is; a longer field would be truncated to a name that does not exist
(`BANK-TYPE-029`). The record handed over is what the callee reads through its
own `LINKAGE SECTION`.

**`on error` is the point.** A static call that cannot be resolved fails at link
time, where somebody sees it. A dynamic one fails in the middle of a batch, and
without a handler that is an abend rather than a rejected record — so a `call`
without one is warned about.

`cancel` drops the loaded module, so the next call gets its working storage as
the compiler left it rather than as the last call left it. It takes no handler:
nothing is being entered, so there is no failure to catch.

## Assignment

Assigning an enum field one of its members becomes `SET <condition> TO TRUE`,
which is what the level-88 names generated beside the field are for:

```ts
account.status = Status.CLOSED;
```

```cobol
SET STATUS-FLD-CLOSED OF ACCOUNT TO TRUE
```

rather than `MOVE "CLOSED" TO STATUS-FLD OF ACCOUNT`. The `MOVE` repeats the
spelling of the member in the procedure division, where it can drift from the 88
that defines it: rename the member and the `MOVE` still compiles, still runs, and
writes a value no condition matches.

The condition is qualified by its group, for the same reason the `MOVE` was —
the record is emitted in working storage and again inside every `FD` that holds
it.

A local of enum type keeps its `MOVE`. A local is an `01` item the emitter only
qualifies when two routines collide, so a condition on one has no group to be
qualified by. So does a field assigned from another field, which moves a value
rather than choosing a member.

```ts
account.balance = account.balance + 1.0;
advice.interestAmount = interest;
```

Assignment targets a local or a record field. The declared type must match, and
a narrowing assignment needs explicit rounding.
