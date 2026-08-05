# Account Posting Evidence Bundle

This bundle captures the generated artifacts for the account-posting example,
which exercises transactions, ledger postings, and audit events.

## Contents

- `audit/bankc-test-report.md`
- `audit/copybook-layout.json`
- `audit/copybook-layout.md`
- `audit/decimal-analysis.json`
- `audit/diagnostics.json`
- `audit/generated-artifacts.json`
- `audit/gnucobol-validation.md`
- `audit/source-map.json`
- `audit/transaction-analysis.json`
- `audit/validation-matrix.md`
- `audit/verification-report.json`
- `audit/verification-report.md`
- `cobol/ACCOUNTP.cbl`
- `copybooks/POSTTRAN.cpy`
- `jcl/ACCOUNTP.jcl`
- `maps/source-map.json`
- `source/main.bank.ts`

## What this bundle shows

- `audit/transaction-analysis.json` lists the debit, the credit, and the audit
  event the analyzer found, with the amount expressions it compared to prove the
  posting balances.
- `audit/verification-report.md` records 7 of 7 traced symbols with no source
  map coverage gaps, including the transaction paragraph.
- The transaction satisfies `BANK-TXN-001`, `BANK-AUD-001`, `BANK-AUD-003`, and
  `BANK-LED-001`, so `audit/diagnostics.json` is empty.

## Regeneration

```bash
pnpm bankc test examples/account-posting
```

Generated on Node.js 24.

## Related tester notes

- [Banking diagnostics tester notes](../../tester-notes/2026-08-04-banking-diagnostics.md)
- [Source map coverage tester notes](../../tester-notes/2026-08-04-source-map-coverage-checker.md)

## Notes

The generated COBOL calls `BANKLEDG` and `BANKAUDT`, which are BankLang calling
conventions described in
[ADR-0003](../../docs/adr/0003-ledger-and-audit-calling-convention.md). No IBM
or vendor ledger interface is implied.

No IBM validation claim is made here. The bundle records local deterministic
outputs only.
