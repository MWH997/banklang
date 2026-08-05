# z/OS conformance

**Nothing in this directory has been run.** No BankLang program has been
compiled by IBM Enterprise COBOL, precompiled by `DSNHPC`, bound to a Db2
package, or started in a CICS region. That is the project's standing limit and
this directory does not change it.

What it does is make the gap a bounded task rather than an open question. The
compiler cannot close it from here — that needs a machine nobody working on this
repository has. Someone with access can close it in an afternoon.

## Why the gap matters

GnuCOBOL is a different compiler. Every example compiles with it and the
[conformance suite](../tests/conformance.test.ts) executes several of them, but
that establishes GnuCOBOL's reading of the generated COBOL, not IBM's. The
places the two most plausibly disagree:

| Area           | What could differ                                              |
| -------------- | -------------------------------------------------------------- |
| `COMP` sizing  | Halfword/fullword/doubleword boundaries and `SYNCHRONIZED`     |
| `COMP-3`       | Sign nibble on unsigned fields, and `NUMPROC`                  |
| Collating      | EBCDIC ordering, which is not ASCII ordering                   |
| Free format    | Enterprise COBOL 6.1+ only; earlier releases need fixed format |
| `SORT`         | Work dataset naming and the sort product in use                |
| Reserved words | The two lists are close but not identical                      |

Anything found here is a real defect in this compiler, not in the runner.

## What to run

```bash
pnpm tsx tools/zos-kit.ts
```

That writes `dist/zos/` with every generated program, copybook, and job, in the
eight-character member names the JCL already expects. `MANIFEST.txt` says which
dataset each folder belongs in.

Then, in order:

1. **Compile every program.** The `COMPILE` step of each generated job. Record
   the highest return code and every message of severity W or above.
2. **Precompile and bind the Db2 programs.** `online-enquiry` and
   `branch-accrual-cursor`. Their jobs already carry the `DSNHPC` and `BIND`
   steps; the placeholders to replace are the subsystem name, the DBRM library,
   and the package collection.
3. **Translate and install the CICS program.** `online-enquiry`. Define the
   program and a transaction, and drive it from a terminal.
4. **Run the batch programs** against the same seeded input the local
   conformance suite uses, and compare the output records byte for byte.

## What to write down

Copy `RESULTS-TEMPLATE.md` to `RESULTS.md` and fill it in. A finding that
contradicts something the README claims is the most valuable thing this
directory can produce; record it as found rather than as fixed.

Until `RESULTS.md` exists, every claim in this repository stops at GnuCOBOL, and
the README says so.
