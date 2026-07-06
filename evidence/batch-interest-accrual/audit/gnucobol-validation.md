# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/batch-interest-accrual/src/main.bank.ts                 |
| source-artifact-sha256     | 271e70e778647fe020d67b563de3036df6c562b56471c1c3f4c1aed4bc0e95a2 |
| generated-artifact         | dist/gnucobol/cobol/BATCH-INTEREST-ACCRUAL.cbl                   |
| generated-artifact-sha256  | db207dd6b44d6a34f26492623a05249d6fe4c40bc765bcc97622c702620385f2 |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | 935567d4d4bb4e3be4c302c2375dcbb93a96afa035794640fb523a4357cb5413 |
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
