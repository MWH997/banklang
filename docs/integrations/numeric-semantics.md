# Numeric Semantics

## Purpose

Numeric semantics are a core BankLang credibility layer.

Money bugs are not syntax bugs. They are precision, scale, rounding, overflow, sign, representation, and layout bugs.

## Source of truth

Use IBM Enterprise COBOL documentation for IBM backend mappings.

## BankTS decimal model

```ts
decimal<precision, scale>;
currency<"BDT", precision, scale>;
```

Required metadata:

- precision
- scale
- signedness
- rounding policy
- overflow policy
- backend representation
- source span
- generated field mapping

## Default IBM COBOL mapping

Initial default for signed fixed decimal:

```txt
decimal<p, s> -> PIC S9(p-s)V9(s) COMP-3
```

Example:

```txt
decimal<18,2> -> PIC S9(16)V99 COMP-3
```

## Packed decimal byte calculation

For supported IBM `COMP-3`/packed-decimal fields:

```txt
packedDecimalBytes(totalDigits) = floor(totalDigits / 2) + 1
```

Examples:

| BankTS type     | COBOL PIC               | Total digits | Bytes |
| --------------- | ----------------------- | -----------: | ----: |
| `decimal<18,2>` | `PIC S9(16)V99 COMP-3`  |           18 |    10 |
| `decimal<15,2>` | `PIC S9(13)V99 COMP-3`  |           15 |     8 |
| `decimal<9,4>`  | `PIC S9(5)V9999 COMP-3` |            9 |     5 |

## Required diagnostics

- precision loss
- missing rounding mode
- possible overflow
- currency mismatch
- unsupported conversion
- unsafe display conversion
- backend representation mismatch

## Required tests

- property-based addition/subtraction tests
- multiplication scale tests
- division requires rounding tests
- overflow tests
- COMP-3 byte-length tests
- COBOL PIC generation golden tests

## References

- [IBM Enterprise COBOL computational items](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=clause-computational-items)
- [IBM Enterprise COBOL formats for numeric data](https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=arithmetic-formats-numeric-data)
