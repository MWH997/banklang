# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/interest-posting-batch/src/main.bank.ts                 |
| source-artifact-sha256     | 7383eb12eccef651dc091e9b78889cf4579f004901d7d61036c8ad7380f58c23 |
| generated-artifact         | dist/gnucobol/cobol/INTEREST-POSTING-BATCH.cbl                   |
| generated-artifact-sha256  | 2589fc20a3e46b86458af62bc1c6c58437cf922a51c9bbda8d84579f40f4f571 |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | 5cfa77acb4af1c9d706bb28700542168c3c2399c6ec9c82eb88cee7c12a7b5de |
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
