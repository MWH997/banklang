# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/account-file-batch/src/main.bank.ts                     |
| source-artifact-sha256     | 561b89ea4116a112a95061ece3e92d7df8aa8e0f44c86899be645f0a6df5de6e |
| generated-artifact         | dist/gnucobol/cobol/ACCOUNT-FILE-BATCH.cbl                       |
| generated-artifact-sha256  | 65f17296af1c7e35b8cd47b4efb3fd5dce2ebebbc010c10fa2fd3d45d4689fdb |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | 5c476ab499b4e30ee798224c8db248ea55cf2a9b6748352549f0b15d4a061a4b |
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
