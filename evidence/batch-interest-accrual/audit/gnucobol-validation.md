# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/batch-interest-accrual/src/main.bank.ts                 |
| source-artifact-sha256     | e00d1e4d0c48933eff9446afff772724436223f218d12e8015f4ac80369f10aa |
| generated-artifact         | dist/gnucobol/cobol/BATCH-INTEREST-ACCRUAL.cbl                   |
| generated-artifact-sha256  | dc18fc14cd248eb8bffb83eab832edc7965b0b187f0b201e42e618df3dc9c03d |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | 8a2a6d2ef89ce4b65b876917b3b8a353472b9778fb4be005a12f59945281eade |
| compiler-executable        | not found                                                        |
| compiler-version           | unavailable                                                      |
| compiler-command           | cobc not found                                                   |
| compiler-exit-code         | n/a                                                              |
| compiler-status            | skipped                                                          |

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
