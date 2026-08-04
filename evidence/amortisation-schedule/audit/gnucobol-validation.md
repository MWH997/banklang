# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/amortisation-schedule/src/main.bank.ts                  |
| source-artifact-sha256     | 1a2193f454760ceae605f6901d0b6bb6c6e14ce0fb869f34a5e9b02f849cef57 |
| generated-artifact         | dist/gnucobol/cobol/AMORTISATION-SCHEDULE.cbl                    |
| generated-artifact-sha256  | 842299761ef1601895f39745f851e2e6a16e84552b0f60d6e621afea506a0fb1 |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | 5ab8b88792c66b4aec5c1617839c82bb301bcfbfd66d82bdc42a00f056a78d8e |
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
