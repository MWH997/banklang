# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/account-transfer/src/main.bank.ts                       |
| source-artifact-sha256     | ce511a3e0e193fcb873d1c72af546e76aa49dac9665dab56e4f1e05428527a44 |
| generated-artifact         | dist/gnucobol/cobol/ACCOUNT-TRANSFER.cbl                         |
| generated-artifact-sha256  | 6be2dc8d493fb8db769500191123fb1a382ca0dfe7019f22e8fd36d0c2bc306d |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | 42ccbefbb933575941dc5b3fdbf3b9080cbb4c294349381d8bb176657936a74f |
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
