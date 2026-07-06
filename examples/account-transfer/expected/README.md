# Expected Artifacts

This directory documents the checked-in expectations for the account-transfer
example.

The generated files are emitted into `dist/` by the CLI:

- COBOL source in `dist/cobol/ACCOUNT-TRANSFER.cbl`
- copybook in `dist/copybooks/TRANSFER-REQUEST.cpy`
- JCL in `dist/jcl/ACCOUNT-TRANSFER.jcl`
- source map in `dist/maps/source-map.json`
- audit artifacts in `dist/audit/`
- verification report in `dist/audit/verification-report.md`
- local GnuCOBOL report in `dist/audit/gnucobol-validation.md`

The example source itself stays in `src/main.bank.ts` so the input and output
paths remain separate and deterministic.
