# zUnit integration

**Status: researched, not built.** This page exists so the next attempt starts
from what is known rather than from a guess.

## Why it is not built

The 2026-08-05 audit ranked zUnit generation fifth of seven missing features:
"Emitting zUnit cases alongside the program is directly runnable on z/OS later
and would be very impressive."

The word that matters there is **runnable**. An artifact that looks like a zUnit
test case and is not one is worse than none: it is a file somebody uploads to a
mainframe, submits, and gets a translator error from — and the reason it would
be wrong is the same reason `ROUNDED MODE IS NEAREST-EVEN` was wrong for two
years, which is that nobody checked the artifact against IBM's own definition of
it.

IBM's zUnit documentation is not in `vendor-docs/`, and
`https://www.ibm.com/docs/...` refuses automated retrieval. What is below was
assembled from IBM's search summaries and a Jazz community article, which is
enough to describe the shape and **not** enough to generate one.

## What is known

### The artifacts

A zUnit test case is three files, not one:

| Artifact          | What it is                                                    |
| ----------------- | ------------------------------------------------------------- |
| `.bzucfg`         | The test configuration, in XML. Ties the three together.      |
| The test case     | A generated COBOL program that drives the program under test. |
| The playback file | The data the run is driven with and checked against.          |

The three live in separate partitioned datasets, conventionally `BZUCFG`,
`BZUPLAY` and a load library for the test program.

### The configuration, in part

The Jazz article shows a `.bzucfg` containing elements of the shape:

```xml
<runner:testCase moduleName="..."/>
<runner:playback moduleName="..."/>
<playbackFile name="..." localName="..."/>
```

That is a fragment, not a schema. The root element, the namespace URI, the
required attributes and the ordering are all unknown here, and an XML document
that is nearly right is a document the runner rejects.

### Running one

A REXX exec reads the configuration and generates JCL that allocates `BZUCFG`,
`BZUPLAY`, `BZUCBK`, `BZULOD`, `BZUMSG` and `BZURPT`, executes the `BZUPPLAY`
procedure, and reads the step's return code for pass or fail.

### Where the test data comes from

Two routes, and both are relevant to whether a compiler can generate one:

- **Recorded.** zUnit runs the program — under CICS, under Db2, in batch — and
  records the linkage and I/O it saw. A compiler that has never run the program
  has nothing to record.
- **Supplied.** Data can be added to a test entry by hand in the Test Case
  Editor, or imported from an XML file that z/OS Debugger captured. This is the
  route a generator would have to use, and it is the one the format for is
  least documented.

## What would have to be true to build it

1. IBM's schema for `.bzucfg`, at the release being targeted.
2. The generated test case's own structure — which `BZU*` entry points it calls,
   with what operands, and what the assertion interface is.
3. The format of a supplied (rather than recorded) playback file.
4. A way to check the result, which for this repository means a real z/OS run.
   [zos/README.md](../../zos/README.md) is the kit; until `RESULTS.md` exists,
   nothing here has been through a real compiler, and a zUnit artifact would be
   the first thing shipped that nobody could verify locally at all.

## What exists instead

Not a substitute, and worth being plain about the difference — these run on this
machine and prove things about the compiler, where a zUnit case would run on
z/OS and prove things about the program:

- [`tests/conformance.test.ts`](../../tests/conformance.test.ts) executes
  generated programs against the reference runtime in
  [`runtime/`](../../runtime/README.md) and asserts on the ledger, the balances
  and the branches taken.
- [`tests/rounding-oracle.test.ts`](../../tests/rounding-oracle.test.ts) runs the
  generated rounding arithmetic against an exact oracle.
- `pnpm bankc verify` writes a verification report per project.

## References

- [ZUnit overview](https://www.ibm.com/docs/en/developer-for-zos/15.0.x?topic=applications-zos-automated-unit-testing-framework-zunit)
- [Generating and editing COBOL test cases](https://www.ibm.com/docs/en/developer-for-zos/14.2.x?topic=applications-generating-editing-cobol-test-cases)
- [Integrating zUnit with EWM](https://jazz.net/library/article/95563) — the
  source of the `.bzucfg` fragment and the DD list above
- [Integrating IBM zUnit Testing into a CI/CD pipeline](https://www.ibm.com/support/pages/system/files/inline-files/Integrating%20IBM%20zUnit%20Testing%20into%20an%20open%20and%20modern%20CICD%20pipeline%20-%20v1.2_0.pdf)
