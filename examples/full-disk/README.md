# Full disk

The failure that happens halfway through: an output dataset that runs out of
room with half the work written.

## Why

Everything before the failing WRITE was written and is still there. Everything
after it was not. A rerun from the top duplicates the first half, and a rerun
from the wrong place loses records, so what the operator gets out of the step
decides how expensive the night is.

| Status | Means                                                         |
| ------ | ------------------------------------------------------------- |
| `34`   | Boundary violation: no room for another record                |
| `24`   | The same thing on a VSAM file, where the key sequence ran out |

Without SMS the step usually ends B37 before the program sees anything at all.
With it, the WRITE returns and the program is the only thing that can say what
happened.

## What to look at

The `on failure` handler names the last record written:

```
STOPPED AFTER 0000418362 AT ACCT-0000418362
```

A WRITE whose status is never tested loses the record and leaves the program's
own count agreeing with itself: the count is of records the program handed to
the file system, not of records the file system took.

## Artifacts

`dist/cobol/FULLDISK.cbl`, `dist/jcl/FULLDISK.jcl`, two copybooks. The generated
job gives the output `DISP=(NEW,CATLG,DELETE)`, so a step that dies halfway
leaves nothing catalogued for the next job to read as though it were complete.

## Related

- [docs/jcl-model.md](../../docs/jcl-model.md): dispositions, and what to change

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=full-disk). It compiles in your browser, with the generated COBOL beside it.
