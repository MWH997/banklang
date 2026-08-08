# GnuCOBOL Validation Report

| Field | Value |
| --- | --- |
| validated-with-gnucobol | yes |
| backend-profile | gnucobol-local |
| source-artifact | examples/statement-generation/src/main.bank.ts |
| source-artifact-sha256 | 4870b116ab4fef588e93139cd42eb0c6e5cc4e178f735c3446d24f0b30377cee |
| generated-artifact | evidence/statement-generation/gnucobol/cobol/STATEMEN.cbl |
| generated-artifact-sha256 | 177fb8815c5da55effbdb5a6ba655e128ba1b4f3ec9567d7def7c1c5299f2889 |
| source-map-artifact | evidence/statement-generation/gnucobol/maps/source-map.json |
| source-map-artifact-sha256 | 1f7e28a1680a5ecc72c59fdc9a08bdfe35cdb4da10c9f35bf8c1963f7ac4722b |
| compiler-executable | cobc |
| compiler-version | cobc (GnuCOBOL) 3.2.0 |
| compiler-command | cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/statement-generation/gnucobol/copybooks evidence/statement-generation/gnucobol/cobol/STATEMEN-PRE.cbl -o evidence/statement-generation/gnucobol/bin/statemen |
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
