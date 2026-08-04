# Statement Generation Evidence Bundle

Generated artifacts for the example covering currency types, enums, bounded
arrays, nullable values, and an indexed KSDS-style file.

## Contents

- `source/main.bank.ts`
- `cobol/STATEMENT-GENERATION.cbl`
- `copybooks/` for each record
- `jcl/STATEMENT-GENERATION.jcl`
- `maps/source-map.json`
- the audit bundle under `audit/`

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
