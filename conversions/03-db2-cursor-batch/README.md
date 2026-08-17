# 03. A Db2 cursor batch

Read every account in a branch and post interest. The branch arrives on the
PARM.

Written for this repository in period style. See the
[provenance note](../README.md#provenance).

## The original

[`original/BRACCR.cbl`](original/BRACCR.cbl)

```cobol
           PERFORM 2000-FETCH UNTIL SQLCODE = 100.
```

Unbounded, and it exits on exactly one value. A `-911` leaves `SQLCODE` at -911
and the loop fetches again, against a cursor Db2 has already closed under it,
and again, until an operator cancels the job. A `-904` does the same.

```cobol
           EXEC SQL OPEN ACCTCUR END-EXEC.
           PERFORM 2000-FETCH UNTIL SQLCODE = 100.
           EXEC SQL CLOSE ACCTCUR END-EXEC.
```

The `CLOSE` is a statement somebody has to remember to write, in a paragraph
that a later maintainer can return from early.

```cobol
           MOVE 'CREDIT'      TO LG-OP.
           ...
           CALL 'BANKLEDG' USING WS-LEDGER-AREA.
```

One side of the entry. Interest is an expense to the bank and the other side has
to go somewhere.

## The BankTS

[`banklang/src/main.bank.ts`](banklang/src/main.bank.ts)

```ts
for each row in accountsInBranch(branchId) limit 100000 {
```

The cursor is a declaration; the `OPEN` and the `CLOSE` are generated around the
loop and there is no way in the language to write one without the other. The
bound is mandatory, and reaching it fails the step rather than ending quietly.

`BANK-LED-001` refused the transaction until the debit was there:

```txt
BANK-LED-001  Transaction accrueBranch does not balance:
              credited interest against nothing debited.
```

## What the compiler generated

[`generated/cobol/BRACCR.cbl`](generated/cobol/BRACCR.cbl)

```cobol
               IF SQLCODE < 0
                   DISPLAY "FETCH FAILED accountsInBranch SQLCODE "
                       SQLCODE UPON SYSOUT
                   MOVE 12 TO BANK-RETURN-CODE
                   MOVE "SQL-FETCH-FAILED" TO BANK-FAILURE-CODE
               END-IF
```

inside the fetch loop, so a negative SQLCODE ends the loop rather than driving
it.

## The measurements

<!-- measurements -->

|                                                | Original | Regenerated |
| ---------------------------------------------- | -------- | ----------- |
| Lines of code, comments and blanks excluded    | 61       | 207         |
| `GO TO` a paragraph that is not an exit        | 0        | 0           |
| `GO TO` in total, single-exit returns included | 2        | 8           |
| File operations whose result is tested         | 0 of 0   | 0 of 0      |

The BankTS in between is 42 lines.

<!-- /measurements -->

## What changed about what it does

- **A negative SQLCODE now ends the step.** The original looped.
- **The loop is bounded.** Reaching the bound fails the step.
- **The postings balance.** `INTEREST-EXPENSE` is debited for what the accounts
  are credited. This is a change to what the ledger receives, and it is the one
  that needs a conversation with the people who own the chart of accounts.

## One warning the compiler leaves standing

```txt
BANK-FILE-003  Transaction accrueBranch posts to the ledger inside a loop
               with no checkpoint.
```

It is a warning rather than an error because the compiler cannot tell whether
the job is rerunnable by other means. The original had no restart position
either, and this conversion does not add one, and the warning is the record of
that. [`parm-driven-batch`](../../examples/parm-driven-batch/) shows what adding
one looks like.
