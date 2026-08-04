# Online Enquiry Evidence Bundle

Generated artifacts for the CICS + Db2 example.

## This bundle is deliberately not compiler-validated

Embedded SQL requires the Db2 precompiler and CICS commands require the CICS
translator. Neither is available here, so:

```txt
| compiler-status         | requires-preprocessor |
| validated-with-gnucobol | no                    |
```

This is the one program in the repository whose generated COBOL has never been
accepted by a compiler. The `EXEC SQL` and `EXEC CICS` blocks follow IBM's
documented syntax, but they have not been precompiled, translated, or run.

The compiler's own checks still apply: host variable resolution, SQLCODE
handling, CICS response codes, and syncpoint placement are all enforced without
needing a precompiler, and `audit/diagnostics.json` is empty.

## Contents

- `source/main.bank.ts`
- `cobol/ONLINE-ENQUIRY.cbl`
- `copybooks/` for each record
- `jcl/ONLINE-ENQUIRY.jcl`
- `maps/source-map.json`
- the audit bundle under `audit/`

## What this bundle shows

- 15 of 15 traced symbols with no source map coverage gaps.
- `EXEC SQL` with host variables rewritten to their COBOL bindings.
- `DFHCOMMAREA` in the `LINKAGE SECTION` and `EXEC CICS RETURN` in place of
  `GOBACK`.
- `EXEC CICS LINK ... RESP(...)` with the response tested before the syncpoint.

## Regeneration

```bash
pnpm bankc test examples/online-enquiry
```

Generated on Node.js 24.

## Notes

No IBM Db2, CICS, or Enterprise COBOL validation has been performed, and none is
claimed.
