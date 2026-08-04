# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: /workspace/Code/banklang/dist/audit/copybook-layout.md

## INTEREST-ACCOUNT

Total length: 80

| Order | Path                              | Type          | PIC                  | Usage   | Offset | Length | Bytes |
| ----- | --------------------------------- | ------------- | -------------------- | ------- | ------ | ------ | ----- |
| 1     | INTEREST-ACCOUNT.ACCOUNT-ID       | string<16>    | PIC X(16)            | DISPLAY | 0      | 16     | 16    |
| 2     | INTEREST-ACCOUNT.BRANCH-CODE      | string<8>     | PIC X(8)             | DISPLAY | 16     | 8      | 8     |
| 3     | INTEREST-ACCOUNT.BALANCE          | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 24     | 10     | 10    |
| 4     | INTEREST-ACCOUNT.ACCRUED-INTEREST | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 34     | 10     | 10    |
| 5     | INTEREST-ACCOUNT.IDEMPOTENCY-KEY  | string<36>    | PIC X(36)            | DISPLAY | 44     | 36     | 36    |

## POSTING-ADVICE

Total length: 62

| Order | Path                           | Type          | PIC                  | Usage   | Offset | Length | Bytes |
| ----- | ------------------------------ | ------------- | -------------------- | ------- | ------ | ------ | ----- |
| 1     | POSTING-ADVICE.ACCOUNT-ID      | string<16>    | PIC X(16)            | DISPLAY | 0      | 16     | 16    |
| 2     | POSTING-ADVICE.INTEREST-AMOUNT | decimal<18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 16     | 10     | 10    |
| 3     | POSTING-ADVICE.IDEMPOTENCY-KEY | string<36>    | PIC X(36)            | DISPLAY | 26     | 36     | 36    |
