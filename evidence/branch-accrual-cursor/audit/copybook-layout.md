# Copybook Layout Report

Version: 1
Backend profile: ibm-enterprise-cobol-zos

Artifact: /workspace/Code/banklang/dist/audit/copybook-layout.md

## ACCRUAL-REQUEST

Total length: 47

| Order | Path                            | Type         | PIC                   | Usage   | Offset | Length | Bytes | Sensitive |
| ----- | ------------------------------- | ------------ | --------------------- | ------- | ------ | ------ | ----- | --------- |
| 1     | ACCRUAL-REQUEST.BRANCH-ID       | string<8>    | PIC X(8)              | DISPLAY | 0      | 8      | 8     | no        |
| 2     | ACCRUAL-REQUEST.ACCRUAL-RATE    | decimal<5,4> | PIC S9(1)V9999 COMP-3 | COMP-3  | 8      | 3      | 3     | no        |
| 3     | ACCRUAL-REQUEST.IDEMPOTENCY-KEY | string<36>   | PIC X(36)             | DISPLAY | 11     | 36     | 36    | no        |

## ACCOUNT-ROW

Total length: 34

| Order | Path                       | Type                 | PIC                  | Usage   | Offset | Length | Bytes | Sensitive |
| ----- | -------------------------- | -------------------- | -------------------- | ------- | ------ | ------ | ----- | --------- |
| 1     | ACCOUNT-ROW.ROW-ACCOUNT-ID | string<16>           | PIC X(16)            | DISPLAY | 0      | 16     | 16    | no        |
| 2     | ACCOUNT-ROW.ROW-BALANCE    | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 16     | 10     | 10    | no        |
| 3     | ACCOUNT-ROW.ROW-STATUS     | string<8>            | PIC X(8)             | DISPLAY | 26     | 8      | 8     | no        |

## ACCRUAL-SUMMARY

Total length: 64

| Order | Path                              | Type                 | PIC                  | Usage   | Offset | Length | Bytes | Sensitive |
| ----- | --------------------------------- | -------------------- | -------------------- | ------- | ------ | ------ | ----- | --------- |
| 1     | ACCRUAL-SUMMARY.SUMMARY-BRANCH-ID | string<8>            | PIC X(8)             | DISPLAY | 0      | 8      | 8     | no        |
| 2     | ACCRUAL-SUMMARY.ACCOUNTS-READ     | decimal<9,0>         | PIC S9(9) COMP-3     | COMP-3  | 8      | 5      | 5     | no        |
| 3     | ACCRUAL-SUMMARY.ACCOUNTS-ACCRUED  | decimal<9,0>         | PIC S9(9) COMP-3     | COMP-3  | 13     | 5      | 5     | no        |
| 4     | ACCRUAL-SUMMARY.INTEREST-POSTED   | currency<"BDT",18,2> | PIC S9(16)V99 COMP-3 | COMP-3  | 18     | 10     | 10    | no        |
| 5     | ACCRUAL-SUMMARY.IDEMPOTENCY-KEY   | string<36>           | PIC X(36)            | DISPLAY | 28     | 36     | 36    | no        |
