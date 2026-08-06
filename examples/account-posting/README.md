# Account Posting Example

This example exercises the transaction path: ledger postings, an audit event,
and the banking safety diagnostics that guard them.

## Source

The input program lives in `src/main.bank.ts` and uses:

- a module declaration
- a decimal type alias
- a record declaration carrying an `idempotencyKey` field
- a transaction declaration with `debit`, `credit`, and `audit` statements
- record field access such as `request.amount`

## What the example proves

The transaction satisfies every banking safety rule the analyzer enforces:

- `BANK-TXN-001` is satisfied because `PostTransferRequest` declares
  `idempotencyKey`
- `BANK-AUD-001` is satisfied because the body emits an audit event
- `BANK-AUD-003` is satisfied because the event name is a string literal
- `BANK-LED-001` is satisfied because the debited and credited amount
  expressions match

Removing any one of those makes `pnpm bankc check examples/account-posting`
fail with the corresponding diagnostic.

## Expected artifacts

Running the CLI from the repository root writes generated artifacts to `dist/`.
The `build` command produces a full bundle:

- `dist/cobol/ACCOUNTP.cbl`
- `dist/copybooks/POSTTRAN.cpy`
- `dist/jcl/ACCOUNTP.jcl`
- `dist/maps/source-map.json`
- `dist/audit/diagnostics.json`
- `dist/audit/source-map.json`
- `dist/audit/generated-artifacts.json`
- `dist/audit/decimal-analysis.json`
- `dist/audit/transaction-analysis.json`
- `dist/audit/copybook-layout.json`
- `dist/audit/verification-report.md`
- `dist/audit/verification-report.json`
- `dist/audit/gnucobol-validation.md`
- `dist/audit/bankc-test-report.md`
- `dist/audit/validation-matrix.md`

## Generated transaction shape

The transaction lowers to a COBOL paragraph that fills a fixed interface group
item and calls a named program, as decided in
[ADR-0003](../../docs/adr/0003-ledger-and-audit-calling-convention.md):

```cobol
       POST-TRANSFER.
           MOVE "DEBIT" TO BANK-LEDGER-OPERATION
           MOVE DEBIT-ACCOUNT OF TRANSFER-REQUEST TO BANK-LEDGER-ACCOUNT
           MOVE AMOUNT OF TRANSFER-REQUEST TO BANK-LEDGER-AMOUNT
           CALL "BANKLEDG" USING BANK-LEDGER-INTERFACE
```

`BANKLEDG` and `BANKAUDT` are BankLang calling conventions. The institution
supplies the programs behind them. No IBM or vendor ledger interface is implied.

## Notes

The generated COBOL is validated locally with GnuCOBOL. No IBM Enterprise COBOL
validation is claimed.
