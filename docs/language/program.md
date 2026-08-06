# Programs and modules

What a BankTS module is, how it is named, what it may not do, and what the backend needs before it can be built.

Part of the [BankTS language reference](../language-reference.md).

## Design goal

BankTS is a restricted TypeScript-like language for banking workloads that compiles to COBOL.

It is intentionally less expressive than TypeScript. The goal is safety, auditability, and predictable COBOL generation.

## Modules

```ts
module AccountTransfer;
```

A file may define one module. Module names must be stable identifiers. Generated COBOL program names are derived from module names using a deterministic naming strategy.

## Reserved words are still field names

Every word this language reserves is a word some copybook uses as a field:
`type`, `date`, `currency`, `error`, `record`, `file`, `transaction`, `log`,
`commit`, `status`. So they stay usable where a name is being **declared** or
**selected**:

```ts
record Movement {
  type: string<4>;
  date: date;
  currency: string<3>;
  error: string<2>;
}

movement.type = "DR";
```

There is nothing to be ambiguous with in those positions — a field name is
followed by `:`, and a member name follows `.`, and nothing else can appear
there.

This does **not** extend to parameters and locals. Those are read as bare
identifiers in expressions, where a keyword really is a keyword — `log` begins a
statement — so a parameter called `type` could be declared and never read, which
is worse than not allowing it.

`sensitive` is the one word that has to be told apart from itself. It is a
marking when a name follows it and a name when a colon does:

```ts
sensitive pan: string<16>;   // a marked field called pan
sensitive: string<4>;        // an ordinary field called sensitive
```

## Naming strategy

Source identifiers are converted to COBOL names deterministically.

Example:

```txt
validateAmount -> VALIDATE-AMOUNT
TransferRequest -> TRANSFER-REQUEST
debitAccount -> DEBIT-ACCOUNT
```

Conflicts are resolved with stable suffixes derived from source position and symbol table order, not randomness.

## Locale conventions

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

## Banned features

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

## Backend requirements and precompilation

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

## Tests

A `test` declaration describes a run of the program under IBM's z/OS Automated
Unit Testing Framework. It is the one declaration that compiles to nothing: what
`bankc build` writes is byte for byte what it would write with the tests
deleted, and `bankc zunit` is what turns them into the three artifacts a zUnit
case is made of.

```
test postsBothLegs for postOne {
  given account = "0001234567890123";
  given amount = 100.00;
  given idempotencyKey = "IDEM-0001";
  expect debit("0001234567890123", 100.00);
  expect credit("SUSPENSE", 100.00);
  expect audit("POSTED", "IDEM-0001");
}
```

`test`, `given` and `expect` are matched in position rather than reserved, so
all three stay usable as field and parameter names — copybooks are full of
`TEST-FLAG`.

**`for`** names the entry transaction, which under zUnit is the whole program.
Naming anything else is `BANK-TEST-001`, and a CICS transaction or an IMS
program is `BANK-TEST-002`: neither is started the way a batch case starts a
program.

**`given`** supplies one scalar parameter of that transaction, which is one
field of the job's PARM. A record parameter is refused (`BANK-TEST-003`) — it is
a buffer the program fills from a file, so there is nothing for a caller to
supply.

**`expect`** names the calls the program must make to the ledger and the audit
trail, **in order**. The generated case checks each call against the expectation
in that position and fails a run that made fewer or more.

Every value is a literal (`BANK-TEST-004`). The generated driver holds them in
`MOVE` and `IF` statements and evaluates nothing.

Test names are letters and digits, at most 25 of them, and unique
(`BANK-TEST-005`, `BANK-TEST-006`): each becomes a `TEST_<NAME>` entry point in
one load module, and the runner picks a test by matching the name.

What a test may say is decided by what a zUnit driver can see. It runs in its
own program — it enters the program under test through its entry point and the
runner intercepts the modules that program calls — so the observable surface is
the LINKAGE the step is started with and the calls it makes, and nothing else.
The program's `WORKING-STORAGE` is not reachable, and a test that appeared to
assert on it would be reporting a pass nobody checked. See
[zunit.md](../zunit.md) for where
every shape in the generated artifacts came from.
