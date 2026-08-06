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

## The one place they are already known to disagree

`USAGE NATIONAL` is not a "could differ" — it is measured. GnuCOBOL 3.2.0
allocates **four bytes per national character inside a group**, where Enterprise
COBOL holds each in two bytes of UTF-16. Standalone at the 01 level GnuCOBOL
allocates two, which is an inconsistency in GnuCOBOL rather than a rule. It also
warns on every such line that its handling of `USAGE NATIONAL` is unfinished, and
implements neither `NATIONAL-OF` nor `DISPLAY-OF`.

Reproduce it with:

```cobol
01  H.
    05  A2 PIC N(4) USAGE NATIONAL.
    05  C2 PIC X(4).
01  FLAT REDEFINES H PIC X(100).
```

`C2` starts at byte 17 under GnuCOBOL and at byte 9 under Enterprise COBOL.

This compiler emits the Enterprise COBOL width, because that is the backend it
targets, and warns (`BANK-TYPE-024`) on every `national<n>` field to say that the
local validation does not cover it. Because of that, the conversion between an
alphanumeric and a national is the one move the compiler refuses to emit at all:
the bytes would differ between the two compilers and neither `NATIONAL-OF` nor
`DISPLAY-OF` is available to make them agree.

**Verify this first.** A record with a national field is the most likely thing in
this repository to be wrong, and it is the cheapest to check: compile the
fragment above and print the offsets.

## GnuCOBOL quirks that are not defects here

None of these affects the generated program on z/OS. All of them will confuse
anyone validating locally, so they are written down.

**Report Writer does not total a packed field.** GnuCOBOL 3.2.0 reads a `COMP-3`
operand of a `SUM` clause from the wrong place, picking up only its low-order
digits. A `PIC S9(7)V99 COMP-3` holding 1,000,000.00 totals as **zero**; one
holding 9,999,999.99 totals as 999.99. The same field read by a `SOURCE` clause
on the line above prints correctly, so the report shows right details under a
wrong total. It reproduces in a hand-written program with no BankLang involved —
two fields of the same value and picture, differing only in `USAGE`:

```cobol
01  TYPE IS CONTROL FOOTING FINAL.
    05  LINE PLUS 1.
        10  COLUMN 1  PIC ZZZ,ZZZ,ZZ9.99 SUM PACKED-AMT.
        10  COLUMN 20 PIC ZZZ,ZZZ,ZZ9.99 SUM DISPLAY-AMT.
```

Money is `COMP-3` in every generated program, so **every total in every report is
wrong under the local validator** and none of it says anything about z/OS. This
is the one place where a green executed test proves least: small amounts survive
the truncation and come out right by luck, which is how it went unnoticed. The
executed tests in `tests/report-writer.test.ts` now assert the divergence
directly, and prove the totals themselves over a `zoned` amount, which GnuCOBOL
accumulates correctly. **Report totals are the first thing to check on z/OS.**

**A report file will not bind to a DD name.** GnuCOBOL's default `assign_clause`
resolves an unquoted `ASSIGN TO <name>` on a file carrying `REPORT IS` to
report-section storage rather than to the DD name, so the output lands in a file
named after a printed value — a filename like `        0.00`. It reproduces in a
hand-written program with no BankLang involved. Compile with
`-fassign-clause=external` (or `=ibm`) to bind it. On z/OS the DD comes from the
JCL and the question does not arise.

**`JSON PARSE` and `XML PARSE` compile and do nothing.** GnuCOBOL warns
`-Wpending` that neither is implemented, then leaves the record untouched and
raises no exception — so a program reading a payload runs clean and processes an
empty record. The local build works around it the way it already did for
`EXEC SQL` and `EXEC CICS`: the precompiler rewrites both statements into calls
on `BANKJSON` and `BANKXML`, reference stubs in `runtime/`, and the translated
program is what `pnpm test:gnucobol` compiles and runs. **The artifact in
`dist/zos/` is untranslated** and carries the statement Enterprise COBOL
implements, which is the one to check on the mainframe.

Those stubs are scans, not parsers. `BANKJSON` reads a quoted name at the top
level and the scalar after its colon; `BANKXML` reads the next tag and the
characters between tags. Nesting, arrays, escape sequences, attributes,
namespaces, entity references and CDATA are past what either attempts, so a
document exercising any of them is one to try on z/OS first. Every parse carries
`BANK-TYPE-025` for that reason. `JSON GENERATE` and `XML GENERATE` are
implemented by GnuCOBOL and are executed by the tests directly.

## What to run

```bash
pnpm tsx tools/zos-kit.ts
```

That writes `dist/zos/` with every generated program, copybook, job and zUnit
configuration, in the eight-character member names the JCL already expects.
`MANIFEST.txt` says which dataset each folder belongs in. Each program's
copybooks go to a library of its own: these examples are independent programs
rather than one application, and several declare an `AccountRecord` of their own
with different fields.

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
5. **Run the zUnit case.** `TZUNITTE`, whose job compiles the driver and submits
   it through `EQAPPLAY`. Compile `ZUNITTES` with `TEST` first and put both in
   the same load library — that is what the runner intercepts the program's
   calls through. This is the one artifact in the bundle nothing here has ever
   run, which makes it the most valuable thing in it: it settles divergence
   **D21** — whether a runner accepts `noPlaybackData="true"` — and it is the
   only way to learn anything about **D20**, the info block whose layout is
   behind a copybook this repository does not have.

## What to write down

Copy `RESULTS-TEMPLATE.md` to `RESULTS.md` and fill it in. A finding that
contradicts something the README claims is the most valuable thing this
directory can produce; record it as found rather than as fixed.

Until `RESULTS.md` exists, every claim in this repository stops at GnuCOBOL, and
the README says so.
