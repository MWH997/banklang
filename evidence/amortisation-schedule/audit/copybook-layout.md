# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: evidence/amortisation-schedule/audit/copybook-layout.md

## INSTALMENT

Total length: 20

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | INSTALMENT.DUE-BALANCE | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 0 | 10 | 10 | no |
| 2 | INSTALMENT.INTEREST-DUE | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 10 | 10 | 10 | no |

## LOAN

Total length: 792

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | LOAN.ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | LOAN.PRINCIPAL | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 16 | 10 | 10 | no |
| 3 | LOAN.MONTHLY-RATE | decimal<9,4> | PIC S9(5)V9999 COMP-3 | COMP-3 | 26 | 5 | 5 | no |
| 4 | LOAN.TERM-MONTHS | decimal<9,0> | PIC S9(9) COMP-3 | COMP-3 | 31 | 5 | 5 | no |
| 5 | LOAN.SCHEDULE | record<Instalment>[36] | GROUP | GROUP | 36 | 720 | 720 | no |
| 6 | LOAN.IDEMPOTENCY-KEY | string<36> | PIC X(36) | DISPLAY | 756 | 36 | 36 | no |
