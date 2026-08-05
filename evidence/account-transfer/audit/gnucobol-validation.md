# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/account-transfer/src/main.bank.ts |
| source-artifact-sha256 | ce511a3e0e193fcb873d1c72af546e76aa49dac9665dab56e4f1e05428527a44 |
| generated-artifact | evidence/account-transfer/gnucobol/cobol/ACCOUNTT.cbl |
| generated-artifact-sha256 | effaee3fe94be6ba70151fe72618be69eb665fb7c5759de99ec99236abbc83a8 |
| source-map-artifact | evidence/account-transfer/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | d0197419f9fd1e5864da294d14156d504c2cce5dde6c96b83e5424017f48db6e |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/account-transfer/gnucobol/copybooks evidence/account-transfer/gnucobol/cobol/ACCOUNTT.cbl -o evidence/account-transfer/gnucobol/bin/accountt |
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
