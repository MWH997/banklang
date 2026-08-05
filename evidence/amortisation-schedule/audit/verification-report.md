# Verification Report

Project: /workspace/Code/banklang/examples/amortisation-schedule/src/main.bank.ts
Version: 1
Backend profile: ibm-enterprise-cobol-zos
Phase: verify

| Check                      | Status | Details                                                                         |
| -------------------------- | ------ | ------------------------------------------------------------------------------- |
| Parse                      | passed | 0 diagnostics                                                                   |
| Typecheck                  | passed | 0 diagnostics                                                                   |
| COBOL emit                 | passed | /workspace/Code/banklang/dist/cobol/AMORTISATION-SCHEDULE.cbl                   |
| Copybook emit              | passed | 2 copybook file(s)                                                              |
| Source map emit            | passed | /workspace/Code/banklang/dist/maps/source-map.json                              |
| JCL emit                   | passed | /workspace/Code/banklang/dist/jcl/AMORTISATION-SCHEDULE.jcl                     |
| Audit artifacts            | passed | /workspace/Code/banklang/dist/audit                                             |
| Deterministic regeneration | passed | Re-emitted COBOL, copybooks, source map, and JCL matched the written artifacts. |
| Source map coverage        | passed | 14/14 traced symbols, all entries anchored in the generated COBOL.              |
| GnuCOBOL validation        | passed | Local cobc validation passed.                                                   |
| Audit schema               | passed | version 1, backend profile ibm-enterprise-cobol-zos                             |

## Notes

- This report records the current deterministic compiler pipeline for the supported subset.
- IBM Enterprise COBOL validation is not claimed here.
- GnuCOBOL validation is recorded separately in dist/audit/gnucobol-validation.md when available.

## Source Map Coverage

- expected-symbols: 14
- traced-symbols: 14
- coverage-gaps: 0

## GnuCOBOL Validation

- validated-with-gnucobol: yes
- compiler-status: passed
- compiler-command: cobc -x -free -I dist/gnucobol/copybooks dist/gnucobol/cobol/AMORTISATION-SCHEDULE.cbl -o dist/gnucobol/bin/amortisation-schedule
- compiler-exit-code: 0
