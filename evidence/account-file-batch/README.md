# Account File Batch Evidence Bundle

This bundle captures the generated artifacts for the account-file-batch example,
which exercises sequential file declarations and the file-status diagnostic.

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
- `cobol/ACCOUNTF.cbl`
- `copybooks/ACCOUNTR.cpy`
- `copybooks/POSTINGR.cpy`
- `jcl/ACCOUNTF.jcl`
- `maps/source-map.json`
- `source/main.bank.ts`

## What this bundle shows

- `cobol/ACCOUNT-FILE-BATCH.cbl` contains a `FILE-CONTROL` section with a
  `SELECT` entry and a `FILE STATUS` clause per declared file, and a
  `FILE SECTION` whose `FD` records are buffers sized from the copybook layout.
- `audit/copybook-layout.json` shows the 26-byte record layout that the `FD`
  buffer length is derived from.
- Both files declare a status field, so `audit/diagnostics.json` is empty.
  Removing a `status` clause produces `BANK-FILE-001`.

## Regeneration

```bash
pnpm bankc test examples/account-file-batch
```

Generated on Node.js 24.

## Notes

Read and write statements are not part of the current subset, so the generated
program declares the files without operating on them.

No IBM validation claim is made here. The bundle records local deterministic
outputs only.
