# Reference runtime

Four small COBOL programs that satisfy the interfaces generated code calls out
to, so a generated program can be **executed** rather than only compiled.

| Program    | Stands in for                     | Called by                                |
| ---------- | --------------------------------- | ---------------------------------------- |
| `BANKLEDG` | The institution's ledger          | `debit`, `credit`, and the rollback path |
| `BANKAUDT` | The institution's audit log       | `audit`                                  |
| `DSNHLI`   | The Db2 language interface module | Precompiled `EXEC SQL` blocks            |
| `DFHEI1`   | The CICS command-level stub       | Precompiled `EXEC CICS` blocks           |

`tests/conformance.test.ts` compiles a BankTS program, links it against these,
runs it, and asserts on the balances, the journal, the audit log, and the output
records.

## Why this exists

A compiler that is only ever compiled can be confidently wrong. Two defects
found in this project passed every static check and every golden fixture:

- the bounds guard **clamped** an out-of-range subscript instead of refusing it,
  so the statement ran against the wrong element
- a recursive function returned `5` for `5!`, because `WORKING-STORAGE` is
  shared across invocations and the nested call overwrote its caller's locals

Both are invisible until the program runs. That is what these programs are for.

## What running against this establishes

- the generated program compiles, links, and runs to completion
- it reaches its ledger, audit, SQL, and CICS call sites in the expected order
- the arithmetic it performs produces the expected values, to the penny
- a raised failure abandons the unit of work and reaches the rollback path
  before the handler runs
- the branch guarded by `sqlcode == 0` or by a `resp` test is taken, because the
  outcome that selects it can be scripted

## Scripted outcomes

`DSNHLI` and `DFHEI1` evaluate nothing, so on their own every statement succeeds
and every command returns `NORMAL` — which leaves half of every generated
program unreachable. A test can therefore script what they report:

| File                | Line format            | Meaning                          |
| ------------------- | ---------------------- | -------------------------------- |
| `sql-outcomes.txt`  | `0002 +100 02000 0000` | statement 2 reports no row found |
| `sql-outcomes.txt`  | `0002 +000 00000 0003` | statement 2 succeeds three times |
| `cics-outcomes.txt` | `0001 +027 +000`       | command 1 fails with `PGMIDERR`  |

Statements are numbered as the precompiler numbers them, counting only executable
blocks — a cursor's `DECLARE` is read at precompile time and takes no number.
Commands are numbered in the order the program issues them.

The trailing count on a SQL line is how many calls the entry applies to, `0000`
meaning every remaining one. That is what scripts a cursor: a `FETCH` is one
statement run many times, so `n` successes followed by an unbounded `+100` is a
result set of `n` rows. Anything not listed succeeds, and with no file at all
every call succeeds. `tests/conformance.test.ts` writes these through
`sqlOutcomes` and `cicsOutcomes` rather than by hand.

**Scripting an outcome proves something about the generated program, not about
Db2 or CICS.** A scripted `SQLCODE 100` shows the program handles a missing row;
it does not show Db2 would return 100 for that query.

`DSNHLI` never writes host variables. They are passed, so the COBOL compiler
checks that each one resolves, but the program has no way to know their types or
lengths and does not touch them. A fetched row therefore arrives unchanged: a
test can assert how many rows a loop processed and that it opened, bounded, and
closed correctly, but not what was in them.

## What it does not establish

**These are not IBM products and imply no IBM behaviour.**

- `BANKLEDG` is not a bank ledger. It has no accounting model, no double-entry
  enforcement, no value dating, no concurrency, and no durability. The BankLang
  calling convention has no commit operation, so it treats everything posted
  since the last rollback as the open unit of work — its own choice, not a
  BankLang guarantee.
- `DSNHLI` parses no SQL, reads no table, and binds no plan. Every `SQLCODE` it
  reports was either the default or written down by a test; none was produced by
  a database deciding anything. Correct SQL behaviour needs a real Db2 and a
  bind.
- `DFHEI1` provides no task, no program to `LINK` to, no COMMAREA handed
  anywhere, no syncpoint, and no recovery. Its `RESP` values are scripted in the
  same way and mean no more.
- Nothing here has been run on z/OS, against IBM Enterprise COBOL, against Db2,
  or in a CICS region. Local validation uses GnuCOBOL, which is a different
  compiler with different behaviour at the edges.

## Running them

The conformance suite compiles these automatically. To use them by hand:

```sh
cobc -m -free runtime/BANKLEDG.cbl -o BANKLEDG.dylib   # .so on Linux
cobc -x -free dist/cobol/YOUR-PROGRAM.cbl -o program
COB_LIBRARY_PATH=. ./program
```

GnuCOBOL resolves a dynamic `CALL` using the platform's own module extension, so
a module built as `.so` on macOS is never found and the program dies at the
first ledger call.

Output lands in the working directory: `ledger-journal.txt`,
`ledger-balances.txt`, `audit-log.txt`, `sql-calls.txt`, `cics-calls.txt`. The
last two record the outcome of each call, so `SQL 0001 SQLCODE 100` and
`CICS 0002 SYNCPOINT ROLLBACK RESP 0` show which branch the program took.
