# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/account-file-batch/src/main.bank.ts                     |
| source-artifact-sha256     | 561b89ea4116a112a95061ece3e92d7df8aa8e0f44c86899be645f0a6df5de6e |
| generated-artifact         | dist/gnucobol/cobol/ACCOUNT-FILE-BATCH.cbl                       |
| generated-artifact-sha256  | 11f323705e558d9e365573b6e698dc802aeff8eedfccc8a943337b86f8f84f98 |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | 05e2f4fe9fd735dca0ee39abb8237005b6f0270f6c51a8b8295a714c66d40e1e |
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
