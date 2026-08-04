# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/account-posting/src/main.bank.ts                        |
| source-artifact-sha256     | 4923b5458c2d8286c458d300d10906fc158ca0410b4c4fd174d47c79665c0ae9 |
| generated-artifact         | dist/gnucobol/cobol/ACCOUNT-POSTING.cbl                          |
| generated-artifact-sha256  | 43b004ac3d73e0b3ae7b32bdc29b574d7ed49c4424a013d701c5d2ed31c39e2e |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | 7e2137939b3df0a355817e82a0ad736793b5c1d58b1ee11bdeef25ed34df052d |
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
