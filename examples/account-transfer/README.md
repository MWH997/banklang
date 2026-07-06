# Account Transfer Example

This example is the first BankTS program the repository compiles.

## Source

The input program lives in `src/main.bank.ts` and uses:

- a module declaration
- a decimal type alias
- a record declaration
- a function that validates a decimal amount

## Expected artifacts

Running the CLI from the repository root writes generated artifacts to `dist/`.
The `build` command produces a full bundle:

- `dist/cobol/ACCOUNT-TRANSFER.cbl`
- `dist/copybooks/TRANSFER-REQUEST.cpy`
- `dist/jcl/ACCOUNT-TRANSFER.jcl`
- `dist/maps/source-map.json`
- `dist/audit/copybook-layout.md`
- `dist/audit/diagnostics.json`
- `dist/audit/source-map.json`
- `dist/audit/generated-artifacts.json`
- `dist/audit/decimal-analysis.json`
- `dist/audit/transaction-analysis.json`
- `dist/audit/copybook-layout.json`
- `dist/audit/verification-report.md`
- `dist/audit/gnucobol-validation.md`
- `dist/audit/validation-matrix.md`

The narrower emit commands still write their respective outputs:

- `pnpm bankc emit cobol examples/account-transfer` writes
  `dist/cobol/ACCOUNT-TRANSFER.cbl` and `dist/maps/source-map.json`
- `pnpm bankc emit copybooks examples/account-transfer` writes
  `dist/copybooks/TRANSFER-REQUEST.cpy`
- `pnpm bankc emit jcl examples/account-transfer` writes
  `dist/jcl/ACCOUNT-TRANSFER.jcl`
- `pnpm bankc audit-report examples/account-transfer` writes the audit bundle
- `pnpm bankc verify examples/account-transfer` writes a verification report in
  `dist/audit/verification-report.md`
- `pnpm bankc test examples/account-transfer` writes the verification report
  plus the local GnuCOBOL report in `dist/audit/gnucobol-validation.md`
- `pnpm bankc layout examples/account-transfer` writes
  `dist/layout/copybook-layout.md` and `dist/layout/copybook-layout.json`

## Notes

The example stays small on purpose. It exists to prove deterministic parsing,
type resolution, IR lowering, COBOL emission, and source mapping before the
language grows more features.
