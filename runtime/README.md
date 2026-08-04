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

## What it does not establish

**These are not IBM products and imply no IBM behaviour.**

- `BANKLEDG` is not a bank ledger. It has no accounting model, no double-entry
  enforcement, no value dating, no concurrency, and no durability. The BankLang
  calling convention has no commit operation, so it treats everything posted
  since the last rollback as the open unit of work — its own choice, not a
  BankLang guarantee.
- `DSNHLI` parses no SQL, reads no table, and binds no plan. `SQLCODE` is always
  zero because this program has no way to know what the statement asked for. A
  test must not read meaning into it. Correct SQL behaviour needs a real Db2 and
  a bind.
- `DFHEI1` provides no task, no COMMAREA passing, no syncpoint, and no recovery.
  It leaves `RESP` values exactly as the generated program initialised them,
  because it cannot tell which operand of a given command is the response field.
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
`ledger-balances.txt`, `audit-log.txt`, `sql-calls.txt`, `cics-calls.txt`.
