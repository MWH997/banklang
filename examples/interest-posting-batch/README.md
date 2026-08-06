# Interest Posting Batch Example

The example that exercises the full language surface: tiered interest accrual,
eligibility rules, fee application, balanced double-entry posting, and a bounded
batch loop over sequential files.

This is the closest thing in the repository to a real banking workload.

## What it demonstrates

| Feature                    | Where                                           |
| -------------------------- | ----------------------------------------------- |
| Comparison operators       | `balance >= minimumBalance`, `balance > 0.00`   |
| Boolean operators          | `balance >= minimumBalance && balance > 0.00`   |
| Multiplication             | `balance * rate`, adding the operand scales     |
| Explicit rounding          | `round(balance * rate, "HALF_EVEN")`            |
| Function calls             | `accrue(account.balance, rateFor(...))`, nested |
| Branching in a function    | `rateFor` returns a tiered rate                 |
| Branching in a transaction | eligibility decides whether interest accrues    |
| Field assignment           | `advice.interestAmount = interest;`             |
| Bounded loops              | `while accountFeedStatus == "00" limit 100000`  |
| File operations            | `open`, `read into`, `write from`, `close`      |
| Balanced posting           | every credit is funded by a matching debit      |

## The arithmetic

Interest is `balance * rate`. `MoneyBDT` is `decimal<18, 2>` and `Rate` is
`decimal<9, 4>`, so the product has scale 6. Assigning that to a `MoneyBDT`
would discard four digits, which the compiler rejects as `BANK-DEC-002` unless
the rounding is stated:

```ts
function accrue(balance: MoneyBDT, rate: Rate): MoneyBDT {
  return round(balance * rate, "HALF_EVEN");
}
```

`HALF_EVEN` is banker's rounding, the usual choice for interest because it does
not bias upward across many postings. Enterprise COBOL has no phrase for it —
`ROUNDED` is half-up away from zero and there is nothing else — so the compiler
writes the arithmetic out: the truncated value, the excess truncation
discarded, and a step of one unit in the last place taken only when the excess
is over half, or exactly half onto an odd digit.

```cobol
       ACCRUE.
           *> HALF_EVEN is generated. COBOL has
           *> only ROUNDED, which is HALF_UP.
           COMPUTE BANK-RND-1-VALUE = (ACCRUE-P1 * ACCRUE-P2)
               ON SIZE ERROR
                   DISPLAY "ARITHMETIC OVERFLOW ACCRUE-RESULT" UPON
                       SYSOUT
                   MOVE 12 TO BANK-RETURN-CODE
                   MOVE "ARITHMETIC-OVERFLOW" TO BANK-FAILURE-CODE
                   GO TO ACCRUE-EXIT
           END-COMPUTE
           COMPUTE BANK-RND-1-EXCESS =
               (ACCRUE-P1 * ACCRUE-P2) - BANK-RND-1-VALUE
           COMPUTE BANK-RND-1-STEP = 0.01
           IF BANK-RND-1-EXCESS < 0
               COMPUTE BANK-RND-1-STEP = -0.01
           END-IF
           COMPUTE BANK-RND-1-UNITS = BANK-RND-1-VALUE * 100
           EVALUATE TRUE
               WHEN FUNCTION ABS (BANK-RND-1-EXCESS) > 0.005
                   ADD BANK-RND-1-STEP TO BANK-RND-1-VALUE
               WHEN FUNCTION ABS (BANK-RND-1-EXCESS) = 0.005
                   IF FUNCTION MOD (BANK-RND-1-UNITS, 2) = 1
                       ADD BANK-RND-1-STEP TO BANK-RND-1-VALUE
                   END-IF
           END-EVALUATE
           MOVE BANK-RND-1-VALUE TO ACCRUE-RESULT
           CONTINUE.
       ACCRUE-EXIT.
           EXIT.
```

The sequence is checked against exact arithmetic in
[`tests/rounding-oracle.test.ts`](../../tests/rounding-oracle.test.ts), and
`examples/rounding-conformance` runs all seven modes.

Bare division is rejected outright (`BANK-DEC-003`). Write
`divide(a, b, "HALF_UP")` so the rounding decision is visible in the source.

## Why the postings balance

`BANK-LED-001` requires the debited and credited amount expressions to match as
multisets. Interest is credited to the customer and debited from the interest
expense account; the fee moves the other way:

```ts
credit(account.accountId, interest);
debit("INTEREST-EXPENSE", interest);

debit(account.accountId, fee);
credit("FEE-INCOME", fee);
```

Debits are `{interest, fee}` and credits are `{interest, fee}`, so the
transaction balances. Removing either counterpart fails the build.

## The batch loop

```ts
while accountFeedStatus == "00" limit 100000 {
  read accountFeed into account;
  write adviceOutput from advice;
}
```

The `limit` clause is required. An unbounded loop in a transaction is
`BANK-TXN-004`, and the compiler cannot infer a safe bound. The limit becomes a
real guard counter in the generated COBOL, so a loop whose condition never goes
false still terminates:

```cobol
           MOVE 0 TO WS-LOOP-89-3
           PERFORM UNTIL WS-LOOP-89-3 >= 100000 OR NOT (ACCOUNT-FEED-STATUS = "00")
               ADD 1 TO WS-LOOP-89-3
               READ ACCOUNT-FEED INTO INTEREST-ACCOUNT
                   AT END MOVE "10" TO ACCOUNT-FEED-STATUS
               END-READ
```

`accountFeedStatus` is the field bound by the file declaration's `status`
clause, readable as an ordinary symbol.

## Function calls

Calls lower to argument moves plus a `PERFORM`, because COBOL has no
call-in-expression form. Nested calls are ordered so inner results are available
before the outer call runs:

```cobol
               MOVE BALANCE OF INTEREST-ACCOUNT TO RATE-FOR-P1
               MOVE PREMIUM-THRESHOLD TO RATE-FOR-P2
               PERFORM RATE-FOR
               MOVE BALANCE OF INTEREST-ACCOUNT TO ACCRUE-P1
               MOVE RATE-FOR-RESULT TO ACCRUE-P2
               PERFORM ACCRUE
```

## Running it

```bash
pnpm bankc check examples/interest-posting-batch
pnpm bankc build examples/interest-posting-batch
pnpm bankc test  examples/interest-posting-batch
```

## Notes

Read and write statements move whole records between the file buffer and
working storage. There is no per-field file mapping yet.

The generated COBOL is validated locally with GnuCOBOL. No IBM Enterprise COBOL
validation is claimed, and this program has never been run against a real
ledger.

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=interest-posting-batch) — it compiles in your browser, with the generated COBOL beside it.
