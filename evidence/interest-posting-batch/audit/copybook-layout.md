# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: evidence/interest-posting-batch/audit/copybook-layout.md

## ACCRUAL-FEED-ROW

Total length: 80

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ACCRUAL-FEED-ROW.ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | ACCRUAL-FEED-ROW.BRANCH-CODE | string<8> | PIC X(8) | DISPLAY | 16 | 8 | 8 | no |
| 3 | ACCRUAL-FEED-ROW.BALANCE | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 24 | 10 | 10 | no |
| 4 | ACCRUAL-FEED-ROW.ACCRUED-INTEREST | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 34 | 10 | 10 | no |
| 5 | ACCRUAL-FEED-ROW.IDEMPOTENCY-KEY | string<36> | PIC X(36) | DISPLAY | 44 | 36 | 36 | no |

## POSTING-ADVICE

Total length: 62

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | POSTING-ADVICE.ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | POSTING-ADVICE.INTEREST-AMOUNT | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 16 | 10 | 10 | no |
| 3 | POSTING-ADVICE.IDEMPOTENCY-KEY | string<36> | PIC X(36) | DISPLAY | 26 | 36 | 36 | no |
