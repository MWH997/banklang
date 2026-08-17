# Settlement Bill File Example

A settlement extract with three record layouts on one file: a header naming the
run, a detail line per counterparty, and a trailer carrying the control totals.

## Source

`src/main.bank.ts` uses:

- a currency type alias and a `zoned` amount, because the extract is text
- four record declarations, three of which are layouts of the same file
- an output file declared `record ExtractHeader, ExtractDetail, ExtractTrailer`
- an input feed with a status the read loop tests
- `edited` fields, so the amounts read as amounts

## What the example proves

### One file can carry several record layouts

```ts
file settlementExtract
  lineSequential
  output
  record ExtractHeader, ExtractDetail, ExtractTrailer
  status settlementExtractStatus;
```

COBOL's several `01` entries under one `FD`. They share a record area as long
as the longest of them, and each `write` names the layout it is writing:

```cobol
       FD  SETTLEMENT-EXTRACT-FILE.
       01  SETTLEMENT-EXTRACT-RECORD.
           05  HEADER-TAG    PIC X(1).
           05  HEADER-TITLE  PIC X(19).
           05  HEADER-DATE   PIC 9(8).
       01  SETT-EXTR-EXTR-DETAIL-RECORD.
           05  DETAIL-TAG           PIC X(1).
           05  DETAIL-COUNTERPARTY  PIC X(8).
           05  DETAIL-AMOUNT        PIC ZZ,ZZZ,ZZZ,ZZ9.99.
       01  SETT-EXTR-EXTR-TRAILER-RECORD.
           05  TRAILER-TAG    PIC X(1).
           05  TRAILER-COUNT  PIC ZZZZZZ9.
           05  TRAILER-TOTAL  PIC ZZ,ZZZ,ZZZ,ZZ9.99.
```

### The variant is chosen where its type is known

`write settlementExtract from detail` writes the detail layout because `detail`
is an `ExtractDetail`. Nothing in the language produces a value of an
undetermined variant, so there is nothing to narrow and no way to reach a
header's fields through a detail.

That is also why the feature is output-only. A `read` names no layout: which one
arrived is decided by the data, and a value whose type is a guess is what
`BANK-FILE-015` exists to refuse. A feed carrying several kinds of record is
read as one layout with a field saying which kind it is.

The measurement behind the decision is in
`evidence/horizontal/xcobol-v2/record-usage.json`: 2,812 of the corpus's 6,451
file descriptions carry more than one record, and 2,663 of those are opened
`OUTPUT`.

### The read loop tests what the read did

```ts
read movementFeed into movement;
if movementFeedStatus == "00" {
  ...
}
```

End of file is an answer rather than a failure, so the generated status check
lets it through. Without the test the last movement would be written to the
extract twice, because the record area still holds it, and the trailer's totals would
say so while the job ended with return code zero. `BANK-FILE-017`.

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=settlement-bill-file). It compiles in your browser, with the generated COBOL beside it.
