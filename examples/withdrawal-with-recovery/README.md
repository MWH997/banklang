# Withdrawal With Recovery Example

The only example in the repository that is **executed**, not just compiled.
`tests/conformance.test.ts` compiles it, links it against the reference runtime
in [`runtime/`](../../runtime/README.md), runs it against seeded input, and
asserts on the balances the ledger ends up holding.

It demonstrates the two features that need running to be believed: record
inheritance, whose whole value is a byte layout, and the failure model, whose
whole value is what does _not_ reach the ledger.

## What it demonstrates

| Feature                 | Where                                             |
| ----------------------- | ------------------------------------------------- |
| Record inheritance      | `record SavingsAccount extends CurrentAccount`    |
| Record substitutability | `ledgerBalanceOf(account: CurrentAccount)`        |
| Guard clauses           | `if requested <= 0.00 { raise "..."; }`           |
| Raising a failure       | `raise "BELOW_MINIMUM_BALANCE";`                  |
| Failure handler         | `on failure { audit(...); }`                      |
| Failure through a call  | `permittedAmount` raises; `withdraw` unwinds      |
| Ledger rollback         | generated on the failure path, before the handler |
| Entry point             | `entry transaction withdraw`                      |
| Currency types          | `currency<"BDT", 18, 2>`                          |
| Per-field file mapping  | `read requestInput into account`                  |

## Inheritance is a layout claim

`SavingsAccount extends CurrentAccount` puts the base fields first, so the
derived record's leading bytes _are_ the base record:

```
CURRENT-ACCOUNT   ACCOUNT-ID  0..15   BALANCE 16..25   IDEMPOTENCY-KEY 26..61
SAVINGS-ACCOUNT   ACCOUNT-ID  0..15   BALANCE 16..25   IDEMPOTENCY-KEY 26..61
                  MINIMUM-BALANCE 62..71   REQUESTED 72..81
```

An existing `CURRENT-ACCOUNT` copybook still reads a `SAVINGS-ACCOUNT` record
correctly. `tests/conformance.test.ts` asserts this offset by offset against the
compiler's own layout report rather than against a hand-counted table.

That layout claim is also what makes substitutability safe. `ledgerBalanceOf` is
declared over the base record and called with a `SavingsAccount`:

```ts
function ledgerBalanceOf(account: CurrentAccount): MoneyBDT {
  return account.balance;
}
```

A function's record parameter is a `LINKAGE` cell rather than a group item in
working storage, and the caller points it at the argument before performing the
paragraph:

```cobol
       LINKAGE SECTION.
       01  LEDGER-BALANCE-OF-P1.
           05  ACCOUNT-ID           PIC X(16).
           05  BALANCE              PIC S9(16)V99 COMP-3.
           05  IDEMPOTENCY-KEY      PIC X(36).
       ...
           SET ADDRESS OF LEDGER-BALANCE-OF-P1 TO ADDRESS OF SAVINGS-ACCOUNT
           PERFORM LEDGER-BALANCE-OF
```

The cell describes the base record's fields, and those fields sit at the same
offsets in the derived record — which is exactly what `extends` guarantees. The
callee reads the caller's storage, so the closing balance in the executed test
is the proof that it read the right record and not a stale group item.

A transaction is a program entry point rather than something called with varying
arguments, so its records stay in working storage and take no part in this.

## The failure path

`permittedAmount` raises before returning anything:

```ts
function permittedAmount(account: SavingsAccount, requested: MoneyBDT): MoneyBDT {
  if requested <= 0.00 {
    raise "NON_POSITIVE_AMOUNT";
  }

  if account.balance - requested < account.minimumBalance {
    raise "BELOW_MINIMUM_BALANCE";
  }

  return requested;
}
```

COBOL has no exceptions and no stack unwinding, so this lowers to a code plus a
jump, and the caller has to test for it:

```cobol
       PERMITTED-AMOUNT.
           IF PERMITTED-AMOUNT-P2 <= 0.00
               MOVE "NON_POSITIVE_AMOUNT" TO BANK-FAILURE-CODE
               GO TO PERMITTED-AMOUNT-EXIT
           END-IF
           ...
       WITHDRAW.
           MOVE SPACES TO BANK-FAILURE-CODE
           PERFORM WITHDRAW-BODY THRU WITHDRAW-BODY-EXIT
           IF BANK-FAILURE-CODE NOT = SPACES
               PERFORM WITHDRAW-FAILURE
           END-IF
           GOBACK.
```

`THRU` matters: a `GO TO` out of a plain `PERFORM` range leaves the flow of
control undefined.

The failure paragraph asks the ledger to unwind before the handler runs. BankLang
does not own the ledger, so it does not invent compensating postings — it sends
`ROLLBK` and lets the institution's program decide what that means:

```cobol
       WITHDRAW-FAILURE.
           MOVE "ROLLBK" TO BANK-LEDGER-OPERATION
           CALL "BANKLEDG" USING BANK-LEDGER-INTERFACE
           MOVE "WITHDRAWAL_REJECTED" TO BANK-AUDIT-EVENT
           CALL "BANKAUDT" USING BANK-AUDIT-INTERFACE
           EXIT.
```

## What the executed test actually checks

Seeded with a balance of 5000.00, a minimum of 500.00, and a request for
1200.00:

```
ledger-journal.txt    DEBIT ACC-0000000001 -1200.00
                      CREDIT BRANCH-TILL 1200.00
ledger-balances.txt   ACC-0000000001 -1200.00
                      BRANCH-TILL 1200.00
audit-log.txt         WITHDRAWAL_POSTED IDEM-0001
RESULTOU              closing balance 3800.00
```

Seeded with a balance of 800.00, a minimum of 500.00, and a request for 700.00,
the guard fires before any posting:

```
ledger-journal.txt    ROLLBACK 0000
ledger-balances.txt   (empty)
audit-log.txt         WITHDRAWAL_REJECTED IDEM-0002
RESULTOU              (empty)
```

Nothing reached the ledger and no result record was written. That is the
property the exception model exists for, and it is checked by running the
program rather than by reading it.

## Limits

The run above is against the reference runtime in `runtime/`, which is a set of
small COBOL programs in this repository — not IBM software. It establishes that
the generated program executes and computes correctly. It establishes nothing
about Db2, CICS, or any real ledger. See [`runtime/README.md`](../../runtime/README.md).
