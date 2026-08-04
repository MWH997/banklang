# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/interest-posting-batch/src/main.bank.ts                 |
| source-artifact-sha256     | 7383eb12eccef651dc091e9b78889cf4579f004901d7d61036c8ad7380f58c23 |
| generated-artifact         | dist/gnucobol/cobol/INTEREST-POSTING-BATCH.cbl                   |
| generated-artifact-sha256  | 3b2d04d53ce2d0abfd6be95b03051e7bca8bd547595508db408013cf45f4b5d1 |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | ba51366fef4a5334c41c655200e68bea36b618ee95a1b50bbf22238366816289 |
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
