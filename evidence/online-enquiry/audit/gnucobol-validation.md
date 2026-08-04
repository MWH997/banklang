# GnuCOBOL Validation Report

| Field                      | Value                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| validated-with-gnucobol    | no                                                               |
| backend-profile            | gnucobol-local                                                   |
| source-artifact            | examples/online-enquiry/src/main.bank.ts                         |
| source-artifact-sha256     | b063de9a71be722c8b71124fa6f15e42b5aaeee5f80d4e91c348b4805b1e3347 |
| generated-artifact         | dist/gnucobol/cobol/ONLINE-ENQUIRY.cbl                           |
| generated-artifact-sha256  | 1531c9944aceaa470b8cbba68736afa2bd65b2fc0e4a8a5f0b6dec622039b918 |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                               |
| source-map-artifact-sha256 | 183b315aba44d3a99757d403086e1e3ce123656e8190e6d0c20a2948b235ad0c |
| compiler-executable        | not found                                                        |
| compiler-version           | unavailable                                                      |
| compiler-command           | cobc not found                                                   |
| compiler-exit-code         | n/a                                                              |
| compiler-status            | skipped                                                          |

## Compiler Output

_No compiler output recorded._

## Known Backend Gaps

- This program requires db2-precompiler and cics-translator. It was translated by the BankLang precompiler before compiling, which checks the surrounding COBOL and every host variable but does not validate SQL semantics, Db2 bind behaviour, or CICS runtime behaviour.
- This local profile covers the account-transfer subset only.
- GnuCOBOL validation is local smoke testing, not IBM Enterprise COBOL proof.
- Db2, CICS, and VSAM sections are not exercised by this example.

## Validation Notes

- GnuCOBOL is a local validation target only.
- The IBM Enterprise COBOL profile remains the source of truth.
- This report was generated without timestamps to preserve determinism.
