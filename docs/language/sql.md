# Db2 and embedded SQL

Statements, host variables, SQLCODE handling, cursors, and units of work.

Part of the [BankTS language reference](../language-reference.md).

## SQL

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

### A cursor that survives a commit

```ts
cursor accountsInBranch(keyBranch: string<8>) hold : AccountBalanceRow {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowAccountId, :rowBalance
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
}
```

`DECLARE ... CURSOR WITH HOLD FOR`. The Application Programming and SQL Guide
puts it plainly: "A held cursor does not close after a commit operation. A
cursor that is not held closes after a commit operation."

A long batch has to commit inside its own cursor loop. Not committing means the
log fills and the locks accumulate until nothing else can read the table, so a
run over a million rows commits every few thousand — and over a cursor that is
not held, the `FETCH` after the first commit answers `-501`, cursor not open,
having already processed and committed part of the result set.

`BANK-SQL-008` refuses that combination. It is an error rather than a warning
because there is no reading under which the program is right: either the commit
does not belong in the loop, or the cursor needs `hold`, and the author knows
which.

**A rollback is not a commit, and `hold` does not save it.** The same manual:
"A ROLLBACK statement closes all open cursors. A COMMIT statement ... closes
cursors that are not declared WITH HOLD and leaves open those cursors that are
declared WITH HOLD." Under CICS it says it again — "SYNCPOINT ROLLBACK closes
all cursors". So a `rollback;` inside a cursor loop is `BANK-SQL-008` whether
the cursor is held or not, and the only fix is to move it out.

`hold` is also not available everywhere. The manual: "You cannot use DECLARE
CURSOR...WITH HOLD in message processing programs (MPP) and message-driven batch
message processing (BMP). Each message is a new user for Db2." The compiler does
not know which kind of IMS region a program will run in, so it does not refuse
one — this is a thing to know rather than a thing it checks.

Holding a cursor is not free. Db2 does not close a held cursor at a syncpoint —
the same manual says "Close all cursors that are declared with the WITH HOLD
option before each sync point. Db2 does not automatically close them" — and a
thread with an open cursor cannot be reused. The generated `CLOSE` is what
covers that, and it is emitted whether the cursor is held or not.

### Many rows per fetch

```ts
cursor accountsInBranch(keyBranch: string<8>) rowset 100 : AccountBalanceRow {
  ...
}
```

`DECLARE ... CURSOR WITH ROWSET POSITIONING FOR`, and a
`FETCH NEXT ROWSET FROM ... FOR 100 ROWS` into a host-variable array per column.
One fetch per row is one crossing into Db2 per row; over a million-row master
that is the difference between a million crossings and ten thousand.

The loop reads the same: `for each row in ...` still gives one row at a time.
What changed is underneath it — an inner `PERFORM VARYING` over the rows the
last fetch returned, moving each column's array element into the record before
the body runs.

**The last rowset is the part that is easy to get wrong.** From the Application
Programming and SQL Guide: "when the last row has been retrieved, the program
must still process the rows in the last rowset through that last row." `+100`
arrives _with_ the final partial rowset, not after it — so a loop that leaves on
the `+100` where a single-row fetch would silently drops up to one rowset of
work off the end of every run, and the total is short by a number nobody can
predict. The generated loop processes the rowset first and tests `SQLCODE = 100`
at the bottom.

How many rows came back is `SQLERRD(3)`. The declared bound still applies inside
a rowset, so `limit 1000` with `rowset 100` stops at a thousand rows rather than
at the end of the eleventh fetch.

The dimension is 1 to 32767, which is what the manual allows a host-variable
array's `OCCURS` to be. Each column becomes an elementary item with its own
`OCCURS` — a group with the `OCCURS` on the group is a host structure array,
which a multiple-row fetch does not take, and Db2 answers
`UNDECLARED HOST VARIABLE ARRAY`.

### What SQL BankLang does not have words for

BankLang does not parse SQL. It resolves the `:hostVariable` references and
emits the statement as written, so anything Db2 accepts in a static statement
already works without the language knowing about it:

```ts
sql lockAccounts() {
  LOCK TABLE ACCOUNT IN EXCLUSIVE MODE
}

sql markPoint() {
  SAVEPOINT BEFORE_POSTING ON ROLLBACK RETAIN CURSORS
}

sql undoToPoint() {
  ROLLBACK TO SAVEPOINT BEFORE_POSTING
}

cursor repeatableRead(keyBranch: string<8>): AccountBalanceRow {
  SELECT ACCOUNT_ID, BALANCE
  INTO :rowAccountId, :rowBalance
  FROM ACCOUNT
  WHERE BRANCH_ID = :keyBranch
  WITH RR
}
```

Isolation levels, savepoints and `LOCK TABLE` need nothing from the compiler.

**Two things do not go here.** A bare `COMMIT` or `ROLLBACK` written as SQL is
`BANK-SQL-009`, because the language has `commit;` and `rollback;` and routing
around them skips the rules attached to them — `BANK-SQL-004`, which refuses one
inside a `cics transaction` because Db2 answers `-925` for a `COMMIT` and `-926`
for a `ROLLBACK` there, and `BANK-FILE-003`, which is about where a batch can be
restarted from.

`ROLLBACK TO SAVEPOINT` is a different statement and is left alone. The same
manual: "IMS and CICS environments do not allow those SQL statements; however,
IMS and CICS do allow ROLLBACK TO SAVEPOINT."
