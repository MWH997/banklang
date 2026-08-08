# 01 — The classic sequential update

Read a transaction file, apply each posting to an account master, write a new
master and a reject file. Every estate has thirty of these.

Written for this repository in period style — see the
[provenance note](../README.md#provenance).

## The original

[`original/ACCTUPDT.cbl`](original/ACCTUPDT.cbl)

```cobol
       0000-MAIN.
           OPEN INPUT  TRANS-FILE
                       MASTER-IN
                OUTPUT MASTER-OUT
                       REJECT-FILE.
```

Four files, one statement, no `FILE STATUS` field declared for any of them.
A missing `TRANSIN` gives file status 35; the first `READ` hits `AT END`
immediately; the step closes its files, displays three zeroes and ends with
return code **zero**. A night that applied nothing looks exactly like a night
that had nothing to apply.

```cobol
           IF MI-ACCT-NO NOT = TR-ACCT-NO
               GO TO 2900-REJECT.
```

Three `GO TO`s out of the middle of `2000-PROCESS` into `2900-REJECT`, which
falls through into `2999-EXIT`, which performs the next read. Following what
happens to one transaction means holding four paragraphs in your head.

## The BankTS

[`banklang/src/main.bank.ts`](banklang/src/main.bank.ts)

The layouts are unchanged, field for field, so the same datasets are read and
written under the same DD names. What changed:

| Original                              | BankTS                                                         |
| ------------------------------------- | -------------------------------------------------------------- |
| `OPEN` × 4, untested                  | one `open` each, each followed by the status it can fail with  |
| `GO TO 2900-REJECT` × 3               | `shouldReject(...)`, a routine with one way in and one way out |
| `WRITE MAST-OUT-REC` untested         | a status test, and a `raise` on anything that is not `"00"`    |
| `MOVE TR-ACCT-NO TO REJECT-REC(1:16)` | a record with named fields, so the offsets are declared once   |
| return code always 0                  | 4 when nothing was applied, 12 when a file failed              |

## What the compiler generated

[`generated/cobol/ACCTUPDT.cbl`](generated/cobol/ACCTUPDT.cbl)

Every `OPEN`, `READ`, `WRITE` and `CLOSE` is followed by a test on that file's
own status, against `88`-level condition names rather than literals:

```cobol
       01  TRANS-STATUS         PIC X(2).
           88  TRANS-STATUS-OK      VALUE "00" THRU "09".
           88  TRANS-STATUS-EOF     VALUE "10".
```

## The measurements

<!-- measurements -->

|                                                | Original | Regenerated |
| ---------------------------------------------- | -------- | ----------- |
| Lines of code, comments and blanks excluded    | 92       | 453         |
| `GO TO` a paragraph that is not an exit        | 3        | 0           |
| `GO TO` in total, single-exit returns included | 4        | 25          |
| File operations whose result is tested         | 2 of 6   | 12 of 12    |

The BankTS in between is 113 lines.

<!-- /measurements -->

The regenerated program is five times the length, and almost all of the
difference is the column on the right of the last row. The original's six file
operations carried two tests between them; the regenerated program's twelve
carry twelve.

## What changed about what it does

- **A missing or unreadable input now fails the step.** The original reported
  success.
- **A failed `WRITE` now fails the step.** The original lost the record and
  kept counting.
- **An empty run returns 4.** The original returned 0.

Nothing else. The arithmetic, the rejection rules and the record layouts are the
same, which is the point: the conversion is not an opportunity to change what
the program decides.
