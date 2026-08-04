# Verification Report

Project: /workspace/examples/online-enquiry/src/main.bank.ts
Version: 1
Backend profile: ibm-enterprise-cobol-zos
Phase: verify

| Check                      | Status  | Details                                                                         |
| -------------------------- | ------- | ------------------------------------------------------------------------------- |
| Parse                      | passed  | 0 diagnostics                                                                   |
| Typecheck                  | passed  | 0 diagnostics                                                                   |
| COBOL emit                 | passed  | /workspace/dist/cobol/ONLINE-ENQUIRY.cbl                                        |
| Copybook emit              | passed  | 3 copybook file(s)                                                              |
| Source map emit            | passed  | /workspace/dist/maps/source-map.json                                            |
| JCL emit                   | passed  | /workspace/dist/jcl/ONLINE-ENQUIRY.jcl                                          |
| Audit artifacts            | passed  | /workspace/dist/audit                                                           |
| Deterministic regeneration | passed  | Re-emitted COBOL, copybooks, source map, and JCL matched the written artifacts. |
| Source map coverage        | passed  | 15/15 traced symbols, all entries anchored in the generated COBOL.              |
| GnuCOBOL validation        | skipped | Not validated locally: requires db2-precompiler and cics-translator.            |
| Audit schema               | passed  | version 1, backend profile ibm-enterprise-cobol-zos                             |

## Notes

- This report records the current deterministic compiler pipeline for the supported subset.
- IBM Enterprise COBOL validation is not claimed here.
- GnuCOBOL validation is recorded separately in dist/audit/gnucobol-validation.md when available.

## Source Map Coverage

- expected-symbols: 15
- traced-symbols: 15
- coverage-gaps: 0

## GnuCOBOL Validation

- validated-with-gnucobol: no
- compiler-status: requires-preprocessor
- compiler-command: not run: requires db2-precompiler and cics-translator
- compiler-exit-code: n/a
