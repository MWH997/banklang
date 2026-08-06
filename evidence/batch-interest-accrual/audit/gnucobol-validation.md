# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/batch-interest-accrual/src/main.bank.ts |
| source-artifact-sha256 | e00d1e4d0c48933eff9446afff772724436223f218d12e8015f4ac80369f10aa |
| generated-artifact | evidence/batch-interest-accrual/gnucobol/cobol/BATCHINT.cbl |
| generated-artifact-sha256 | 8446fb3376fb7ef57bb289a0d0ac3de2f51ab617f7ff169e50b83bd1c9e152b8 |
| source-map-artifact | evidence/batch-interest-accrual/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 90ddaa9a1f89df523751d1a2a1db200b6d89e1ba5120e378c6b166e76467c634 |
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
