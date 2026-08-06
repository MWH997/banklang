# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/account-transfer/src/main.bank.ts |
| source-artifact-sha256 | ce511a3e0e193fcb873d1c72af546e76aa49dac9665dab56e4f1e05428527a44 |
| generated-artifact | evidence/account-transfer/gnucobol/cobol/ACCOUNTT.cbl |
| generated-artifact-sha256 | 64efed151e99af01a0e0df590a9bc5ea0d81698b6904f377869234d44d7b196f |
| source-map-artifact | evidence/account-transfer/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 1ea4c312e8f135806c42d56ea26d05a34a05e893343a49ebe74fc81ca6acd7cd |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/account-transfer/gnucobol/copybooks evidence/account-transfer/gnucobol/cobol/ACCOUNTT-PRE.cbl -o evidence/account-transfer/gnucobol/bin/accountt |
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
