# Statement Generation Evidence Bundle

Generated artifacts for the example covering currency types, enums, bounded
arrays, nullable values, and an indexed KSDS-style file.

## Contents

- `audit/bankc-test-report.md`
- `audit/copybook-layout.json`
- `audit/copybook-layout.md`
- `audit/decimal-analysis.json`
- `audit/diagnostics.json`
- `audit/generated-artifacts.json`
- `audit/gnucobol-validation.md`
- `audit/source-map.json`
- `audit/transaction-analysis.json`
- `audit/validation-matrix.md`
- `audit/verification-report.json`
- `audit/verification-report.md`
- `cobol/STATEMEN.cbl`
- `copybooks/ACCOUNTM.cpy`
- `copybooks/LEDGEREN.cpy`
- `copybooks/STATEMEN.cpy`
- `jcl/STATEMEN.jcl`
- `maps/source-map.json`
- `source/main.bank.ts`

## What this bundle shows

- 20 of 20 traced symbols with no source map coverage gaps, the largest program
  in the repository.
- `OCCURS 100 TIMES` with correctly stepped level numbers for the statement
  lines, and the qualified-subscript form for element field access.
- Level-88 condition names for each enum, sized to the widest member.
- A null indicator halfword beside the optional relationship manager.
- `ORGANIZATION IS INDEXED` with a qualified `RECORD KEY`, and `INVALID KEY`
  rather than `AT END` on the keyed read.
- COBOL reserved words mangled: `status` and `lines` become `STATUS-FLD` and
  `LINES-FLD`.

## Regeneration

```bash
pnpm bankc test examples/statement-generation
```

Generated on Node.js 24, validated with GnuCOBOL.

## Notes

No IBM validation claim is made here.
