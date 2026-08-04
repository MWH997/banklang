# Online Enquiry Evidence Bundle

Generated artifacts for the CICS + Db2 example.

## How this program is validated

Embedded SQL requires the Db2 precompiler and CICS commands require the CICS
translator, so a plain COBOL compiler rejects both. BankLang's own precompiler
performs the equivalent translation — `EXEC SQL INCLUDE SQLCA` expands to the
SQLCA, and each block becomes a runtime call passing every data item it
referenced — after which the program compiles with GnuCOBOL.

**What that proves:** the surrounding COBOL is valid, every host variable and
data name resolves, and SQLCA fields such as `SQLCODE` are declared and usable.
Compiling the translated output is what first revealed that CICS response
variables were being referenced without ever being declared.

**What it does not prove:** SQL semantics, Db2 bind behaviour, or CICS runtime
behaviour. It is not IBM's precompiler and produces no bind artifacts.

The bundle in this directory was generated in a container without GnuCOBOL, so
its report records `compiler-status: skipped`. Run `pnpm bankc test
examples/online-enquiry` locally with `cobc` installed to see it pass.

The compiler's own checks apply regardless of any precompiler: host variable
resolution, SQLCODE handling, CICS response codes, and syncpoint placement are
all enforced, and `audit/diagnostics.json` is empty.

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
