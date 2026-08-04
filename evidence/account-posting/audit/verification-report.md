# Verification Report

Project: /workspace/examples/account-posting/src/main.bank.ts
Version: 1
Backend profile: ibm-enterprise-cobol-zos
Phase: verify

| Check                      | Status  | Details                                                                         |
| -------------------------- | ------- | ------------------------------------------------------------------------------- |
| Parse                      | passed  | 0 diagnostics                                                                   |
| Typecheck                  | passed  | 0 diagnostics                                                                   |
| COBOL emit                 | passed  | /workspace/dist/cobol/ACCOUNT-POSTING.cbl                                       |
| Copybook emit              | passed  | 1 copybook file(s)                                                              |
| Source map emit            | passed  | /workspace/dist/maps/source-map.json                                            |
| JCL emit                   | passed  | /workspace/dist/jcl/ACCOUNT-POSTING.jcl                                         |
| Audit artifacts            | passed  | /workspace/dist/audit                                                           |
| Deterministic regeneration | passed  | Re-emitted COBOL, copybooks, source map, and JCL matched the written artifacts. |
| Source map coverage        | passed  | 7/7 traced symbols, all entries anchored in the generated COBOL.                |
| GnuCOBOL validation        | skipped | No local cobc executable was available.                                         |
| Audit schema               | passed  | version 1, backend profile ibm-enterprise-cobol-zos                             |

## Notes

- This report records the current deterministic compiler pipeline for the supported subset.
- IBM Enterprise COBOL validation is not claimed here.
- GnuCOBOL validation is recorded separately in dist/audit/gnucobol-validation.md when available.

## Source Map Coverage

- expected-symbols: 7
- traced-symbols: 7
- coverage-gaps: 0

## GnuCOBOL Validation

- validated-with-gnucobol: no
- compiler-status: skipped
- compiler-command: cobc not found
- compiler-exit-code: n/a
