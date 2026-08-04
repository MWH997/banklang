# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/interest-posting-batch/src/main.bank.ts                 |
| source-artifact-sha256     | 7383eb12eccef651dc091e9b78889cf4579f004901d7d61036c8ad7380f58c23 |
| generated-artifact         | dist/gnucobol/cobol/INTEREST-POSTING-BATCH.cbl                   |
| generated-artifact-sha256  | bb8f41070c263dcf89cd4dbdaa9c98b37bcee49661c8cbf898e4fc7d425c4584 |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | 0bf1cf380b47c8fa4502eab48196b253c707294f5e3dc964a157250bde7c2b63 |
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
