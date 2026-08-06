# Verification Report

Project: examples/batch-interest-accrual/src/main.bank.ts
Version: 1
Backend profile: ibm-enterprise-cobol-zos
Phase: verify

| Check | Status | Details |
| --- | --- | --- |
| Parse | passed | 0 diagnostics |
| Typecheck | passed | 0 diagnostics |
| COBOL emit | passed | evidence/batch-interest-accrual/cobol/BATCHINT.cbl |
| Copybook emit | passed | 1 copybook file(s) |
| Source map emit | passed | evidence/batch-interest-accrual/maps/source-map.json |
| JCL emit | passed | evidence/batch-interest-accrual/jcl/BATCHINT.jcl |
| Audit artifacts | passed | evidence/batch-interest-accrual/audit |
| Deterministic regeneration | passed | Re-emitted COBOL, copybooks, source map, and JCL matched the written artifacts. |
| Source map coverage | passed | 5/5 traced symbols, all entries anchored in the generated COBOL. |
| GnuCOBOL validation | passed | Local cobc validation passed. |
| Audit schema | passed | version 1, backend profile ibm-enterprise-cobol-zos |

## Notes

- This report records the current deterministic compiler pipeline for the supported subset.
- IBM Enterprise COBOL validation is not claimed here.
- GnuCOBOL validation is recorded separately in dist/audit/gnucobol-validation.md when available.

## Source Map Coverage

- expected-symbols: 5
- traced-symbols: 5
- coverage-gaps: 0

## GnuCOBOL Validation

- validated-with-gnucobol: yes
- compiler-status: passed
- compiler-command: cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/batch-interest-accrual/gnucobol/copybooks evidence/batch-interest-accrual/gnucobol/cobol/BATCHINT-PRE.cbl -o evidence/batch-interest-accrual/gnucobol/bin/batchint
- compiler-exit-code: 0
