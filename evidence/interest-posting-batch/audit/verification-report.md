# Verification Report

Project: examples/interest-posting-batch/src/main.bank.ts
Version: 1
Backend profile: ibm-enterprise-cobol-zos
Phase: verify

| Check | Status | Details |
| --- | --- | --- |
| Parse | passed | 0 diagnostics |
| Typecheck | passed | 0 diagnostics |
| COBOL emit | passed | evidence/interest-posting-batch/cobol/INTEREST.cbl |
| Copybook emit | passed | 2 copybook file(s) |
| Source map emit | passed | evidence/interest-posting-batch/maps/source-map.json |
| JCL emit | passed | evidence/interest-posting-batch/jcl/INTEREST.jcl |
| Audit artifacts | passed | evidence/interest-posting-batch/audit |
| Deterministic regeneration | passed | Re-emitted COBOL, copybooks, source map, and JCL matched the written artifacts. |
| Source map coverage | passed | 17/17 traced symbols, all entries anchored in the generated COBOL. |
| GnuCOBOL validation | passed | Local cobc validation passed. |
| Audit schema | passed | version 1, backend profile ibm-enterprise-cobol-zos |

## Notes

- This report records the current deterministic compiler pipeline for the supported subset.
- IBM Enterprise COBOL validation is not claimed here.
- GnuCOBOL validation is recorded separately in dist/audit/gnucobol-validation.md when available.

## Source Map Coverage

- expected-symbols: 17
- traced-symbols: 17
- coverage-gaps: 0

## GnuCOBOL Validation

- validated-with-gnucobol: yes
- compiler-status: passed
- compiler-command: cobc -x -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/interest-posting-batch/gnucobol/copybooks evidence/interest-posting-batch/gnucobol/cobol/INTEREST-PRE.cbl -o evidence/interest-posting-batch/gnucobol/bin/interest
- compiler-exit-code: 0
