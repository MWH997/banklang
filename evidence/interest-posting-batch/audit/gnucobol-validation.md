# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/interest-posting-batch/src/main.bank.ts |
| source-artifact-sha256 | 35acc811cd349652b86bcdde8ee2355c97cf5f8a5b8434b79327ea599fc61049 |
| generated-artifact | evidence/interest-posting-batch/gnucobol/cobol/INTEREST.cbl |
| generated-artifact-sha256 | 5173fa153ba3d47f12e4edd92a5375ae2a5a81f782d3a4bf14cf0221119f2367 |
| source-map-artifact | evidence/interest-posting-batch/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | d630b79448acb84de4894bff57def9a5758d2f92fcd578df6f3d693884f2eb23 |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/interest-posting-batch/gnucobol/copybooks evidence/interest-posting-batch/gnucobol/cobol/INTEREST.cbl -o evidence/interest-posting-batch/gnucobol/bin/interest |
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
