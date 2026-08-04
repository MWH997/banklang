# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/statement-generation/src/main.bank.ts                   |
| source-artifact-sha256     | fd7417adfb56fe65bd07db63f16fd518853c20c0c938245d15e622bd0ca71052 |
| generated-artifact         | dist/gnucobol/cobol/STATEMENT-GENERATION.cbl                     |
| generated-artifact-sha256  | f81ca66d1e88ff9e1cccff9a3a0a049efbc2c9eb7cd626e585ae5d1e6effb84f |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | 13a0e44b32054b44a196fd4755f3723176d87cddcd904520b65e61242a7b6186 |
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
