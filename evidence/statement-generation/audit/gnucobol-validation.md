# GnuCOBOL Validation Report

| Field                      | Value                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                                  |
| backend-profile            | gnucobol-local                                                                                       |
| source-artifact            | examples/statement-generation/src/main.bank.ts                                                       |
| source-artifact-sha256     | fd7417adfb56fe65bd07db63f16fd518853c20c0c938245d15e622bd0ca71052                                     |
| generated-artifact         | dist/gnucobol/cobol/STATEMENT-GENERATION.cbl                                                         |
| generated-artifact-sha256  | e2aea078f73acb362f9c93fb6975226fa5ba7b7843301cba306509a200bedb3f                                     |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                                   |
| source-map-artifact-sha256 | e7545b70e79e2cc94f9f43ee87525bcf15194b75d242fd91f08589daad4a7824                                     |
| compiler-executable        | cobc                                                                                                 |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                                |
| compiler-command           | cobc -x -free dist/gnucobol/cobol/STATEMENT-GENERATION.cbl -o dist/gnucobol/bin/statement-generation |
| compiler-exit-code         | 0                                                                                                    |
| compiler-status            | passed                                                                                               |

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
