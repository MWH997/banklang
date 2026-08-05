# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/batch-interest-accrual/src/main.bank.ts |
| source-artifact-sha256 | e00d1e4d0c48933eff9446afff772724436223f218d12e8015f4ac80369f10aa |
| generated-artifact | evidence/batch-interest-accrual/gnucobol/cobol/BATCHINT.cbl |
| generated-artifact-sha256 | 52baa4e701326c8c5083bf5b056bff6c96d27e8ef9bd8de6eed73c9913f66e72 |
| source-map-artifact | evidence/batch-interest-accrual/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | c820e2b29913f216240e55afee6a5c2e5d1e98db3678282b461451a867f2104c |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/batch-interest-accrual/gnucobol/copybooks evidence/batch-interest-accrual/gnucobol/cobol/BATCHINT.cbl -o evidence/batch-interest-accrual/gnucobol/bin/batchint |
| compiler-exit-code | 0 |
| compiler-status | passed |
| default-dialect-status | passed |
| dialects-diverge | no |

## Compiler Output

_No compiler output recorded._

## Known Backend Gaps

- This local profile covers the account-transfer subset only.
- GnuCOBOL validation is local smoke testing, not IBM Enterprise COBOL proof.
- Db2, CICS, and VSAM sections are not exercised by this example.

## Validation Notes

- GnuCOBOL is a local validation target only.
- The IBM Enterprise COBOL profile remains the source of truth.
- This report was generated without timestamps to preserve determinism.
