# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/online-enquiry/src/main.bank.ts                         |
| source-artifact-sha256     | b063de9a71be722c8b71124fa6f15e42b5aaeee5f80d4e91c348b4805b1e3347 |
| generated-artifact         | dist/gnucobol/cobol/ONLINE-ENQUIRY.cbl                           |
| generated-artifact-sha256  | e5d803b1bb927f89f0c4fd74e9de8f1096a2deea7360999f4a44fd3238be2a5b |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | a2fe03ed3f16a836ef932d3d4251e16c8fa60f679feb3368eae8791a1d8676b2 |
| compiler-executable        | not found                                                        |
| compiler-version           | unavailable                                                      |
| compiler-command           | not run: requires db2-precompiler and cics-translator            |
| compiler-exit-code         | n/a                                                              |
| compiler-status            | requires-preprocessor                                            |

## Compiler Output

_No compiler output recorded._

## Known Backend Gaps

- This program requires db2-precompiler and cics-translator; plain GnuCOBOL cannot validate it.
- This local profile covers the account-transfer subset only.
- GnuCOBOL validation is local smoke testing, not IBM Enterprise COBOL proof.
- Db2, CICS, and VSAM sections are not exercised by this example.

## Validation Notes

- GnuCOBOL is a local validation target only.
- The IBM Enterprise COBOL profile remains the source of truth.
- This report was generated without timestamps to preserve determinism.
