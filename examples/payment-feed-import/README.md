# Importing a text payment feed

A line-sequential file, text with one payment a line, read into a job that posts
it. The organisation an import from anything that is not a mainframe actually
has.

## Why

A counterparty does not send a QSAM dataset of packed decimal. It sends a file
with newlines in it, and the job that reads it has to say so:

```ts
file paymentFeed lineSequential input record PaymentLine status paymentFeedStatus;
```

```cobol
           SELECT PAYMENT-FEED-FILE ASSIGN TO PAYMENTF
               ORGANIZATION IS LINE SEQUENTIAL
               ACCESS MODE IS SEQUENTIAL
               FILE STATUS IS PAYMENT-FEED-STATUS.
```

Enterprise COBOL 6.4 has this organisation for files in the z/OS UNIX file
system, so the generated job allocates a path rather than a dataset:

```jcl
//PAYMENTF DD PATH='/u/banklang/paymentf',
//            PATHOPTS=(ORDONLY)
```

## Every field has to be printable

The restriction that catches people, and it catches them because BankTS's
default is exactly what the target forbids. Enterprise COBOL requires a
line-sequential record to "contain only USAGE DISPLAY and DISPLAY-1 items", and
`decimal<13,2>` is packed, two digits to a byte with a sign nibble.

```ts
payAmount: decimal<13, 2>; // BANK-FILE-014
payAmount: zoned<13, 2>; // what a text file can hold
```

Written packed into a text file, the `WRITE` succeeds and the bytes are neither
the number nor readable text. Nothing says so until somebody opens the file,
which is the shape of defect this language exists to move to compile time.

`zoned` emits `SIGN IS TRAILING SEPARATE`, the SEPARATE phrase the target asks
for, so a negative amount is readable rather than an overpunch.

## A feed from outside contains rubbish

Two rejections rather than two failures. A payment with no reference cannot be
reconciled and a payment of nothing is not a payment, and a job that abends on
the first bad line leaves the good ones unposted.

```ts
if isAcceptable(line.payReference, line.payAmount) {
  write acceptedFeed from accepted;
  totals.linesAccepted = totals.linesAccepted + 1;
} else {
  totals.linesRejected = totals.linesRejected + 1;
}
```

The three counts are logged at the end, which is what makes the run
reconcilable against what the counterparty said they sent.

## What it cannot do

No `update`, no `delete`, no browse. A record's length is fixed once written, so
there is nothing to rewrite in place: `BANK-FILE-013`. A text file is amended
by reading it and writing a new one.

## Artifacts

`dist/cobol/PAYMENTF.cbl`, `dist/jcl/PAYMENTF.jcl`, three copybooks.

## Related

- [docs/language/files.md](../../docs/language/files.md): file organisations
- [docs/divergences.md](../../docs/divergences.md): D23 and D24, both found
  running this organisation through both engines

<!-- playground-link -->

[Open this program in the playground](https://banklang.mwhassan.com/playground/#example=payment-feed-import). It compiles in your browser, with the generated COBOL beside it.
