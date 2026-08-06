# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/interest-posting-batch/src/main.bank.ts |
| source-artifact-sha256 | 35acc811cd349652b86bcdde8ee2355c97cf5f8a5b8434b79327ea599fc61049 |
| generated-artifact | evidence/interest-posting-batch/gnucobol/cobol/INTEREST.cbl |
| generated-artifact-sha256 | 12a106a3934fd0708350488261c932a55e4fcc8108c0a485eef456d613822250 |
| source-map-artifact | evidence/interest-posting-batch/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 807df9c58da0f0f79bc53ad1753864162cdeccd7f9dff159cdf090155ea4a63a |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/interest-posting-batch/gnucobol/copybooks evidence/interest-posting-batch/gnucobol/cobol/INTEREST-PRE.cbl -o evidence/interest-posting-batch/gnucobol/bin/interest |
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
