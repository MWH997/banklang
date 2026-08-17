# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/batch-interest-accrual/src/main.bank.ts |
| source-artifact-sha256 | e00d1e4d0c48933eff9446afff772724436223f218d12e8015f4ac80369f10aa |
| generated-artifact | evidence/batch-interest-accrual/gnucobol/cobol/BATCHINT.cbl |
| generated-artifact-sha256 | 328c90e0de8292a2f6cc89db0b4ef266ab84fbabb70945172cfeb2dfc24c9938 |
| source-map-artifact | evidence/batch-interest-accrual/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | d639e374d56874c72f00a4e686f9ac0c0cf53b364fe68e727afb81d01577f9f1 |
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
