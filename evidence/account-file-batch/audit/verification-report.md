# Verification Report

Project: examples/account-file-batch/src/main.bank.ts
Version: 1
Backend profile: ibm-enterprise-cobol-zos
Phase: verify

| Check | Status | Details |
| --- | --- | --- |
| Parse | passed | 0 diagnostics |
| Typecheck | passed | 0 diagnostics |
| COBOL emit | passed | evidence/account-file-batch/cobol/ACCOUNTF.cbl |
| Copybook emit | passed | 2 copybook file(s) |
| Source map emit | passed | evidence/account-file-batch/maps/source-map.json |
| JCL emit | passed | evidence/account-file-batch/jcl/ACCOUNTF.jcl |
| Audit artifacts | passed | evidence/account-file-batch/audit |
| Deterministic regeneration | passed | Re-emitted COBOL, copybooks, source map, and JCL matched the written artifacts. |
| Source map coverage | passed | 10/10 traced symbols, all entries anchored in the generated COBOL. |
| GnuCOBOL validation | passed | Local cobc validation passed. |
| Audit schema | passed | version 1, backend profile ibm-enterprise-cobol-zos |

## Notes

- This report records the current deterministic compiler pipeline for the supported subset.
- IBM Enterprise COBOL validation is not claimed here.
- GnuCOBOL validation is recorded separately in dist/audit/gnucobol-validation.md when available.

## Source Map Coverage

- expected-symbols: 10
- traced-symbols: 10
- coverage-gaps: 0

## GnuCOBOL Validation

- validated-with-gnucobol: yes
- compiler-status: passed
- compiler-command: cobc -m -conf=tools/banklang-ibm.conf -fixed -Wcolumn-overflow -I evidence/account-file-batch/gnucobol/copybooks evidence/account-file-batch/gnucobol/cobol/ACCOUNTF-PRE.cbl -o evidence/account-file-batch/gnucobol/bin/accountf
- compiler-exit-code: 0
