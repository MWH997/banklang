# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: evidence/withdrawal-with-recovery/audit/copybook-layout.md

## CURRENT-ACCOUNT

Total length: 62

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | CURRENT-ACCOUNT.ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | CURRENT-ACCOUNT.BALANCE | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 16 | 10 | 10 | no |
| 3 | CURRENT-ACCOUNT.IDEMPOTENCY-KEY | string<36> | PIC X(36) | DISPLAY | 26 | 36 | 36 | no |

## SAVINGS-ACCOUNT

Total length: 82

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | SAVINGS-ACCOUNT.ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | SAVINGS-ACCOUNT.BALANCE | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 16 | 10 | 10 | no |
| 3 | SAVINGS-ACCOUNT.IDEMPOTENCY-KEY | string<36> | PIC X(36) | DISPLAY | 26 | 36 | 36 | no |
| 4 | SAVINGS-ACCOUNT.MINIMUM-BALANCE | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 62 | 10 | 10 | no |
| 5 | SAVINGS-ACCOUNT.REQUESTED | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 72 | 10 | 10 | no |

## WITHDRAWAL-RESULT

Total length: 72

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | WITHDRAWAL-RESULT.ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | WITHDRAWAL-RESULT.PAID-OUT | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 16 | 10 | 10 | no |
| 3 | WITHDRAWAL-RESULT.CLOSING-BALANCE | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 26 | 10 | 10 | no |
| 4 | WITHDRAWAL-RESULT.IDEMPOTENCY-KEY | string<36> | PIC X(36) | DISPLAY | 36 | 36 | 36 | no |
