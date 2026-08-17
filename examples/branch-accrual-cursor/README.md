# Branch Accrual Cursor Example

A batch Db2 program: read every account in a branch through a cursor, accrue
interest on the open ones, and write a summary record. Reading many rows with a
cursor is what most real mainframe batch actually does.

## What it demonstrates

| Feature                | Where                                                           |
| ---------------------- | --------------------------------------------------------------- |
| Cursor declaration     | `cursor accountsInBranch(...) hold : AccountBalanceRow { ... }` |
| `WITH HOLD`            | `hold`, so the cursor survives the checkpoint's commit          |
| Bounded cursor loop    | `for each row in accountsInBranch(...) limit 5000`              |
| Generated OPEN / CLOSE | neither appears in the source                                   |
| Host variables         | `:keyBranch` and `:resumeAfter` in, `:rowBalance` out           |
| Checkpoint and restart | `checkpoint restartFile from point every 100`, and `restart`    |
| Explicit rounding      | `round(balance * rate, "HALF_EVEN")`                            |
| Double-entry posting   | `credit` to the account, `debit` to interest expense            |
| Sequential output file | `write summaryOutput from summary`                              |

## The loop is the whole point

A cursor is four Db2 statements, and one of them is easy to forget:

```cobol
       EXEC SQL
           DECLARE ACCOUNTS-IN-BRANCH CURSOR FOR
           SELECT ACCOUNT_ID, BALANCE, STATUS
           FROM ACCOUNT
           WHERE BRANCH_ID = :ACCOUNTS-IN-BRANCH-H1
           ORDER BY ACCOUNT_ID
       END-EXEC.
...
           EXEC SQL OPEN ACCOUNTS-IN-BRANCH END-EXEC
           MOVE 0 TO ACCOUNTS-IN-BRANCH-ROWS
           PERFORM UNTIL ACCOUNTS-IN-BRANCH-ROWS >= 5000
               EXEC SQL
                   FETCH ACCOUNTS-IN-BRANCH
                   INTO :ROW-ACCOUNT-ID OF ACCOUNT-ROW, ...
               END-EXEC
               IF SQLCODE NOT = 0
                   EXIT PERFORM
               END-IF
               ADD 1 TO ACCOUNTS-IN-BRANCH-ROWS
               ...
           END-PERFORM
           EXEC SQL CLOSE ACCOUNTS-IN-BRANCH END-EXEC
```

The `OPEN` and the `CLOSE` are generated around the body. There is no way to
write a cursor that stays open, because there is no way to write the `OPEN`.

The bound is mandatory. A cursor over a table nobody sized is an unbounded loop
holding Db2 locks, so it is `BANK-TXN-004` for the same reason a `while` without
one is.

The loop leaves on **any** non-zero `SQLCODE`, not only on 100. An error treated
as end-of-data would process a partial result set as though it were the whole
one, which is exactly how a batch silently under-posts.

## Committing inside the loop, which is why it is held

A batch that posts to a ledger inside a loop has to write down where it got to.
Without that, a job that dies halfway is rerun from the beginning and every
account already accrued is accrued a second time. `BANK-FILE-003` says so, and
this example is the one it used to fire on.

```ts
point.lastAccountId = row.rowAccountId;
checkpoint restartFile from point every 100;
```

The position first, the commit after. A commit that landed before the position
was written would leave a rerun resuming from further back than the work that is
already durable.

That commit is what makes `hold` necessary rather than decorative. The
Application Programming and SQL Guide: "A held cursor does not close after a
commit operation. A cursor that is not held closes after a commit operation." So
over an unheld cursor the `FETCH` after the first checkpoint answers `-501`,
cursor not open, having already accrued and committed a hundred accounts.

`BANK-SQL-008` refuses that combination, and it could not see it until this
example was written: the rule looked for `commit;` and a checkpoint is a commit
the compiler writes for you.

The rerun resumes through the query rather than by counting rows:

```sql
WHERE BRANCH_ID = :keyBranch
AND ACCOUNT_ID > :resumeAfter
```

On a first run the restart record is spaces, which sorts below every account
number, so the cursor opens on the whole branch.

## Where the INTO moves to

The declaration is written with its `INTO` where the query reads best:

```ts
cursor accountsInBranch(keyBranch: string<8>): AccountBalanceRow {
  SELECT ACCOUNT_ID, BALANCE, STATUS
  INTO :rowAccountId, :rowBalance, :rowStatus
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
  ORDER BY ACCOUNT_ID
}
```

`DECLARE CURSOR` may not carry an `INTO`, so the compiler moves it to the
`FETCH`, which is the statement a row actually arrives at. A cursor with no
`INTO` at all is `BANK-SQL-006`, rather than the compiler guessing that the
select list lines up with the record's fields, and it does not parse SQL well
enough to know that.

## What the executed test checks

`tests/conformance.test.ts` runs this program against the reference Db2 runtime,
scripting how many fetches succeed:

| Scripted                          | Executed result                             |
| --------------------------------- | ------------------------------------------- |
| 3 fetches succeed, then `100`     | open, 4 fetches, close; 3 rows processed    |
| the first fetch reports `100`     | open, 1 fetch, close; no postings           |
| every fetch succeeds, `limit 4`   | open, 4 fetches, close; the bound held      |
| 2 succeed, then `-911` (deadlock) | open, 3 fetches, close; the error ended it  |
| 150 fetches succeed, then `100`   | one commit at row 100, and fetching goes on |

The cursor is closed in every case, including the ones that ended early.

## Running it

```bash
pnpm bankc check examples/branch-accrual-cursor
pnpm bankc test  examples/branch-accrual-cursor
```

## Notes

The runtime this executes against is a reference implementation in this
repository, not Db2. It writes the host variables it is scripted with, so a
fetched row arrives with values in it and the postings above are real
arithmetic over them, but the rows are the test's, not a query's. What is
established is that the generated loop handles the protocol: how many rows it
processed, that it opened, bounded and closed correctly, that it commits inside
the loop and goes on fetching, and that an error is not treated as the end. What
is not established is that Db2 would answer this `SELECT` with those rows, and
nothing local can establish it. No IBM Db2 or Enterprise COBOL validation has
been performed, and none is claimed.

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=branch-accrual-cursor). It compiles in your browser, with the generated COBOL beside it.
