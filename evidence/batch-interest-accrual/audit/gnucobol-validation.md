# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/batch-interest-accrual/src/main.bank.ts |
| source-artifact-sha256 | e00d1e4d0c48933eff9446afff772724436223f218d12e8015f4ac80369f10aa |
| generated-artifact | evidence/batch-interest-accrual/gnucobol/cobol/BATCHINT.cbl |
| generated-artifact-sha256 | b1e0d405dca3c89031ff15d9e2e7a7c0436d872999ccc23b4fd9a7fad6b2974d |
| source-map-artifact | evidence/batch-interest-accrual/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 1b438b53a7c0a6b2b5a1fbc3efa189bb529b08bbf166b5e146072a5be1d8c178 |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/batch-interest-accrual/gnucobol/copybooks evidence/batch-interest-accrual/gnucobol/cobol/BATCHINT-PRE.cbl -o evidence/batch-interest-accrual/gnucobol/bin/batchint |
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
