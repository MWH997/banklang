# GnuCOBOL Validation Report

| Field                      | Value                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| validated-with-gnucobol    | yes                                                                                          |
| backend-profile            | gnucobol-local                                                                               |
| source-artifact            | examples/online-enquiry/src/main.bank.ts                                                     |
| source-artifact-sha256     | b063de9a71be722c8b71124fa6f15e42b5aaeee5f80d4e91c348b4805b1e3347                             |
| generated-artifact         | dist/gnucobol/cobol/ONLINE-ENQUIRY.cbl                                                       |
| generated-artifact-sha256  | 84e9ebb01199f72406484d6d4a39851b6b2049ee530d36c2aea8cb9f37e34076                             |
| source-map-artifact        | dist/gnucobol/maps/source-map.json                                                           |
| source-map-artifact-sha256 | 8fe89a14db121a59ebcf7238e6387ebd348285b0297508e793d1a8cefded6849                             |
| compiler-executable        | cobc                                                                                         |
| compiler-version           | cobc (GnuCOBOL) 3.2.0                                                                        |
| compiler-command           | cobc -x -free dist/gnucobol/cobol/ONLINE-ENQUIRY-PRE.cbl -o dist/gnucobol/bin/online-enquiry |
| compiler-exit-code         | 0                                                                                            |
| compiler-status            | passed                                                                                       |

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
