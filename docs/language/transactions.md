# Transactions

The unit the banking safety rules apply to: entry points, ledger postings, failures, and audit events.

Part of the [BankTS language reference](../language-reference.md).

## Transactions

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

## Failures

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
substituted element is the defect the check exists to prevent. Every subscript a
statement evaluates is guarded, not only the ones in the value being assigned —
the subscript on an assignment's _target_ is the one that writes past the table,
and inside a record the storage past a table is the next field.

A `while` condition is guarded twice, once before the loop and once at the end
of the body, because it is evaluated again before every iteration and the body
may have moved the subscript in between. Inside a sort procedure the guard
cannot raise, since control may not leave one while the sort is running: it
names the subscript, sets `SORT-RETURN` to 16 to stop the sort, and brings the
index inside the table so the guarded statement cannot write over the record on
its way out.

When a transaction has no `on failure` handler, a raise names the code in the
job log and sets a return code of 12. Without that the body simply stopped where
it failed and the step ended with return code zero, which is what a transaction
that finished its work also returns.

## Audit events

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
