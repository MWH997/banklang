# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: /workspace/Code/banklang/dist/audit/copybook-layout.md

## ENQUIRY-REQUEST

Total length: 72

| Order | Path                            | Type       | PIC       | Usage   | Offset | Length | Bytes | Sensitive |
| ----- | ------------------------------- | ---------- | --------- | ------- | ------ | ------ | ----- | --------- |
| 1     | ENQUIRY-REQUEST.ACCOUNT-ID      | string<16> | PIC X(16) | DISPLAY | 0      | 16     | 16    | no        |
| 2     | ENQUIRY-REQUEST.REQUESTED-BY    | string<20> | PIC X(20) | DISPLAY | 16     | 20     | 20    | no        |
| 3     | ENQUIRY-REQUEST.IDEMPOTENCY-KEY | string<36> | PIC X(36) | DISPLAY | 36     | 36     | 36    | no        |

## ACCOUNT-ROW

Total length: 34

| Order | Path                       | Type                 | PIC                  | Usage   | Offset | Length | Bytes | Sensitive |
| ----- | -------------------------- | -------------------- | -------------------- | ------- | ------ | ------ | ----- | --------- |
| 1     | ACCOUNT-ROW.ROW-ACCOUNT-ID | string<16>           | PIC X(16)            | DISPLAY | 0      | 16     | 16    | no        |
| 2     | ACCOUNT-ROW.ROW-BALANCE    | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 16     | 10     | 10    | no        |
| 3     | ACCOUNT-ROW.ROW-STATUS     | string<8>            | PIC X(8)             | DISPLAY | 26     | 8      | 8     | no        |

## ENQUIRY-REPLY

Total length: 37

| Order | Path                           | Type                 | PIC                  | Usage   | Offset | Length | Bytes | Sensitive |
| ----- | ------------------------------ | -------------------- | -------------------- | ------- | ------ | ------ | ----- | --------- |
| 1     | ENQUIRY-REPLY.REPLY-ACCOUNT-ID | string<16>           | PIC X(16)            | DISPLAY | 0      | 16     | 16    | no        |
| 2     | ENQUIRY-REPLY.REPLY-BALANCE    | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 16     | 10     | 10    | no        |
| 3     | ENQUIRY-REPLY.OUTCOME          | enum<EnquiryOutcome> | PIC X(11)            | DISPLAY | 26     | 11     | 11    | no        |
