# Reports

Report Writer: control breaks, totals, and pagination.

Part of the [BankTS language reference](../language-reference.md).

## Reports

`page ... footing ...` on a file paginates, but the program still writes every
line itself and counts nothing. A `report` declares the shape and lets COBOL run
it:

```ts
file statementFile sequential output record StatementLine status reportStatus;

report branchSummary on statementFile control branch
  page 20 heading 1 firstDetail 4 lastDetail 15 {
  pageHeading {
    line 1 {
      column 1 "BRANCH SUMMARY";
      column 40 "PAGE ";
      column 46 pageNumber;
    }
  }
  detail lineDetail {
    line next {
      column 1 branch;
      column 10 amount;
    }
  }
  controlFooting branch {
    line next {
      column 1 "SUBTOTAL:";
      column 10 sum amount;
    }
  }
  controlFooting {
    line next {
      column 1 "TOTAL:";
      column 10 sum amount;
    }
  }
}
```

Driven by three statements:

```ts
initiate branchSummary;
generate lineDetail;
terminate branchSummary;
```

`generate` names the detail group, because that is the thing being printed;
`initiate` and `terminate` name the report. Everything between the two is the
compiler's: it turns the page, repeats the heading, and breaks the totals.

Printing the source above three times (twice for LONDON, once for LEEDS)
produces:

```
BRANCH SUMMARY                         PAGE     1

LONDON          42.50
LONDON          42.50
SUBTOTAL:                   85.00
LEEDS           42.50
SUBTOTAL:                   42.50
TOTAL:                     127.50
```

**Nothing in the source adds anything up.** That is the reason to have it: a
hand-written subtotal reset in the wrong place is a report that is wrong and
still balances, which is the kind of defect that survives review.

A total is printed wider than the rows above it, which is why the figures do not
line up under the detail column. Report Writer sizes the accumulator from the
picture on the `sum` entry rather than from the field being totalled, so a total
given the row's own picture is an accumulator sized for one row: two postings of
9,999,999.99 would subtotal 9,999,999.98. The compiler gives every total all
eighteen digits `ARITH(COMPAT)` carries, since how large a total gets depends on
how many rows arrive and that is not known until the job runs.

A column prints a literal, a field, `sum` of a field, or `pageNumber`. A field is
named bare and resolved against the record the report's file holds. A report is
declared at the top level, where no transaction's variables are in scope, and
that record is the only thing it reads. An amount is printed in its edited form,
with the picture taken from the field's own precision and scale, which is what
lets a `COMP-3` balance reach a page at all.

Groups are `pageHeading`, `pageFooting`, `detail`, `controlHeading`, and
`controlFooting`. A heading or footing may name a control field or leave it off,
which means `FINAL`: the total over everything. Lines are placed with
`line <n>` for an absolute line, or `line next` / `line plus <n>` to space.

The checks are `BANK-FILE-008`: a control field has to be in the record, a
control heading or footing has to name a control the report breaks on, a `sum`
has to total a numeric field and has to sit in a footing, and there has to be a
detail group for `generate` to name. Confining `sum` to a footing is stricter
than COBOL, which allows one in any group; the reason is in `docs/diagnostics.md`. A report's file is `sequential output` and may not also
carry a `page ...` clause, since both decide where the page ends
(`BANK-FILE-007`).

#### What a report costs on z/OS

**Report Writer is not part of Enterprise COBOL.** The Language Reference says
so: the Report Writer module of the standard "is supported with the optional IBM
COBOL Report Writer Precompiler and Libraries (5798-DYR)", and `RD`,
`PAGE LIMIT`, `CONTROL HEADING`, `PAGE FOOTING`, `SUM`, `COLUMN` and report
description entries are all listed as features that precompiler supplies. A
`REPORT SECTION` handed straight to `IGYCRCTL` does not compile.

The generated job therefore runs the stand-alone precompiler first (`SPCRWCOB`,
reading `SYSIN`, writing the expanded COBOL to `SYSINS`, with `RWWORK` as
working space), and the compile step reads what it wrote. It runs before the
CICS translator and the Db2 precompiler, because Report Writer passes
`EXEC ... END-EXEC` through unchanged and neither of the others understands a
`REPORT SECTION`. The link-edit step picks up the Report Writer run time library,
since the expansion leaves external references to it.

If your installation does not license 5798-DYR, do not use `report`: `page` on
the file paginates with `LINAGE`, which is in the base compiler.

#### Verifying one locally

GnuCOBOL implements Report Writer and [the tests
execute one](../../tests/report-writer.test.ts): headings, control breaks, and
totals all check out. One local wrinkle is worth knowing: GnuCOBOL's default
`assign_clause` resolves an unquoted `ASSIGN TO <name>` on a file carrying
`REPORT IS` to report-section storage rather than to the DD name, so the output
lands in a file named after a printed value. Compile with
`-fassign-clause=external` to bind it. On z/OS the DD comes from the JCL and the
question does not arise; `zos/README.md` records it.

### Paginating a report

```ts
file statementReport sequential output record ReportLine
  page 60 footing 55 top 3 bottom 3 status reportStatus;

write statementReport from heading advancing page;
write statementReport from line advancing 1 on page {
  write statementReport from heading advancing page;
};
```

`page` emits `LINAGE`. It is what makes a report paginate: COBOL counts the
lines written and signals end of page at the footing, which is where a program
writes its carried-forward total and the next page's heading. Without it a
statement run is one unbroken column of text. `footing`, `top`, and `bottom` are
optional; a depth alone is a page.

`advancing <n>` and `advancing page` emit `AFTER ADVANCING`, so a line is
written after spacing rather than on top of the last one.

`on page { ... }` is `AT END-OF-PAGE`. It needs the file to declare a depth,
since otherwise there is no page for a write to reach the end of
(`BANK-FILE-007`), and a page depth belongs to a `sequential output` file:
a keyed file has records, not lines to space.

### What the copybook contains

A generated copybook is the record's own COBOL declaration, not a summary of it:
every clause the program's inline record carries, the copybook carries too,
`REDEFINES`, `OCCURS` with its index, `SYNCHRONIZED`, `JUSTIFIED`, `BLANK WHEN
ZERO`, the nested groups, and the 88-levels of an enum.

That matters under `copybookMode: "copy"`, where the program's storage **is** the
copybook. A clause the copybook omitted was a clause the program did not have: a
redefining field took storage of its own and pushed every later field along, a
table collapsed to a single element, and an aligned field lost the slack bytes.
`bankc copybook inspect` reads the same structure, so its offsets and the layout
report's agree.
