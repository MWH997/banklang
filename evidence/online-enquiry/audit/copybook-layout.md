# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: evidence/online-enquiry/audit/copybook-layout.md

## ENQUIRY-COMMAREA

Total length: 96

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ENQUIRY-COMMAREA.CA-ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | ENQUIRY-COMMAREA.CA-REQUESTED-BY | string<20> | PIC X(20) | DISPLAY | 16 | 20 | 20 | no |
| 3 | ENQUIRY-COMMAREA.CA-BALANCE | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 36 | 10 | 10 | no |
| 4 | ENQUIRY-COMMAREA.CA-OUTCOME | enum<EnquiryOutcome> | PIC X(14) | DISPLAY | 46 | 14 | 14 | no |
| 5 | ENQUIRY-COMMAREA.IDEMPOTENCY-KEY | string<36> | PIC X(36) | DISPLAY | 60 | 36 | 36 | no |

## ACCOUNT-BALANCE-ROW

Total length: 34

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ACCOUNT-BALANCE-ROW.ROW-ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | ACCOUNT-BALANCE-ROW.ROW-BALANCE | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3 | 16 | 10 | 10 | no |
| 3 | ACCOUNT-BALANCE-ROW.ROW-STATUS | string<8> | PIC X(8) | DISPLAY | 26 | 8 | 8 | no |

## AUDIT-ENTRY

Total length: 50

| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | AUDIT-ENTRY.AUDIT-ACCOUNT-ID | string<16> | PIC X(16) | DISPLAY | 0 | 16 | 16 | no |
| 2 | AUDIT-ENTRY.AUDIT-REQUESTED-BY | string<20> | PIC X(20) | DISPLAY | 16 | 20 | 20 | no |
| 3 | AUDIT-ENTRY.AUDIT-OUTCOME | enum<EnquiryOutcome> | PIC X(14) | DISPLAY | 36 | 14 | 14 | no |
