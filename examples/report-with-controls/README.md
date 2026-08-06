# Report with control breaks

A printed report where nothing in the source adds anything up.

## Why

That is the entire argument for Report Writer. A hand-written subtotal is three
things a reader has to check — the accumulator, the reset, and the place the
reset happens — and a reset in the wrong place produces a report that is wrong
and still balances, which is the kind of defect that survives review.

Here the subtotals, the grand total, the page turns and the repeated headings
are COBOL's. The program's own statements are three:

```ts
initiate branchSummary;
generate postingDetail;
terminate branchSummary;
```

`terminate` is what prints the final control footing. Leaving it out is a report
missing its grand total, and nothing else says so.

## The control break depends on the sort

`control branchId` breaks whenever the field changes, so the input has to arrive
in branch order. On unsorted input this prints a subtotal every time the value
changes rather than one per branch — see
[`end-of-day-settlement`](../end-of-day-settlement/), where the sort step is the
thing that guarantees it.

## What it costs on z/OS

**Report Writer is not part of Enterprise COBOL.** The Language Reference says
the Report Writer module "is supported with the optional IBM COBOL Report Writer
Precompiler and Libraries (5798-DYR)", and `RD`, `PAGE LIMIT`,
`CONTROL HEADING`, `SUM` and `COLUMN` are all on the list of features that
precompiler supplies. A `REPORT SECTION` handed straight to `IGYCRCTL` does not
compile.

The generated job therefore runs `SPCRWCOB` first, writing the expanded COBOL to
`SYSINS`, and the compile step reads what it wrote. If your installation does
not license 5798-DYR, use `page` on the file instead: that paginates with
`LINAGE`, which is in the base compiler.

GnuCOBOL implements Report Writer, so this example compiles and runs locally.

## Artifacts

`dist/cobol/REPORTWI.cbl`, `dist/jcl/REPORTWI.jcl`, two copybooks.

## Related

- [docs/divergences.md](../../docs/divergences.md) — where GnuCOBOL and Enterprise COBOL differ

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=report-with-controls) — it compiles in your browser, with the generated COBOL beside it.
