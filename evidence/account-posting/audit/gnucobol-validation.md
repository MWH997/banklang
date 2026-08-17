# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/account-posting/src/main.bank.ts |
| source-artifact-sha256 | a3ca7e907f6ffac48fef7d94510932452133f0e32963fd9dd26f09bdc4ef10b4 |
| generated-artifact | evidence/account-posting/gnucobol/cobol/ACCOUNTP.cbl |
| generated-artifact-sha256 | 1bfa2e3faa87955a52c2be9e8f4c179c06b57d9c908d815a8a5dd57ea2830a66 |
| source-map-artifact | evidence/account-posting/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 4c079848c84925d065325cf0e86b2f118ddbc1dbbbe5b29d155ff9173f3572fe |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/account-posting/gnucobol/copybooks evidence/account-posting/gnucobol/cobol/ACCOUNTP-PRE.cbl -o evidence/account-posting/gnucobol/bin/accountp |
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
