# Verification Report

Project: examples/withdrawal-with-recovery/src/main.bank.ts
Version: 1
Backend profile: ibm-enterprise-cobol-zos
Phase: verify

| Check | Status | Details |
| --- | --- | --- |
| Parse | passed | 0 diagnostics |
| Typecheck | passed | 0 diagnostics |
| COBOL emit | passed | evidence/withdrawal-with-recovery/cobol/WITHDRAW.cbl |
| Copybook emit | passed | 3 copybook file(s) |
| Source map emit | passed | evidence/withdrawal-with-recovery/maps/source-map.json |
| JCL emit | passed | evidence/withdrawal-with-recovery/jcl/WITHDRAW.jcl |
| Audit artifacts | passed | evidence/withdrawal-with-recovery/audit |
| Deterministic regeneration | passed | Re-emitted COBOL, copybooks, source map, and JCL matched the written artifacts. |
| Source map coverage | passed | 19/19 traced symbols, all entries anchored in the generated COBOL. |
| GnuCOBOL validation | passed | Local cobc validation passed. |
| Audit schema | passed | version 1, backend profile ibm-enterprise-cobol-zos |

## Notes

- This report records the current deterministic compiler pipeline for the supported subset.
- IBM Enterprise COBOL validation is not claimed here.
- GnuCOBOL validation is recorded separately in dist/audit/gnucobol-validation.md when available.

## Source Map Coverage

- expected-symbols: 19
- traced-symbols: 19
- coverage-gaps: 0

## GnuCOBOL Validation

- validated-with-gnucobol: yes
- compiler-status: passed
- compiler-command: cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/withdrawal-with-recovery/gnucobol/copybooks evidence/withdrawal-with-recovery/gnucobol/cobol/WITHDRAW-PRE.cbl -o evidence/withdrawal-with-recovery/gnucobol/bin/withdraw
- compiler-exit-code: 0
