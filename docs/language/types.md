# Types

Primitive types, how each is stored, dates and times, edited fields, currency, and nullability.

Part of the [BankTS language reference](../language-reference.md).

## Primitive types

Supported primitive types:

```ts
bool;
decimal<precision, scale>;
string<length>;
national<length>;
date;
time;
timestamp;
```

Examples:

```ts
type AccountId = string<16>;
type CustomerId = string<20>;
type Amount = decimal<18, 2>;
```

### 3a. Dates and times

Banking is dates: a value date is not a posting date, an accrual runs between
two of them, and a maturity is compared against today. They are separate types
rather than aliases for a number, so a date cannot be compared with an amount,
or with a plain integer that happens to have eight digits.

| Type        | Storage     | Holds                        |
| ----------- | ----------- | ---------------------------- |
| `date`      | `PIC 9(8)`  | `YYYYMMDD`                   |
| `time`      | `PIC 9(6)`  | `HHMMSS`                     |
| `timestamp` | `PIC X(26)` | the Db2 host variable format |

`PIC 9(8)` as `YYYYMMDD` is the mainframe convention, and it is chosen for a
reason that matters: in that layout, ordinary numeric comparison is also
chronological comparison, and an ordinary sort is a chronological sort. A
timestamp is stored in Db2's own host variable format so it can be read from and
written to a `TIMESTAMP` column without conversion.

Dates order with `<`, `<=`, `>`, `>=`, `==`, and `!=`, but only against the same
kind: comparing a `date` with a `time`, or with an amount, is `BANK-TYPE-003`.

Three builtins do the arithmetic:

```ts
let runDate: date = today();
let term: decimal<9, 0> = daysBetween(loan.openedOn, loan.maturesOn);
let grace: date = addDays(loan.maturesOn, 5);
```

These lower to the COBOL intrinsics that know the calendar — `CURRENT-DATE`,
`INTEGER-OF-DATE`, and `DATE-OF-INTEGER` — rather than to `+` on the stored
digits. That is the whole reason they exist: thirty days after the 31st of
January is the 2nd of March, which arithmetic on `20260131` would never produce.
A date is therefore not something you can add to directly, and a fraction of a
day is not a number of days (`BANK-TYPE-003`).

`now()` reads the clock and assembles a `timestamp`. `CURRENT-DATE` offers
hundredths of a second, so the last four digits of the microseconds are zeros
rather than invented.

### 3c. How a number is stored

`decimal<p, s>` is packed decimal, `COMP-3`, which is what a ledger amount is
held in. The others exist because a real estate's copybooks are full of them,
and a compiler that only knows `COMP-3` cannot read those files at all:

| Declaration     | Picture                                      | Bytes           | Used for                                |
| --------------- | -------------------------------------------- | --------------- | --------------------------------------- |
| `decimal<p,s>`  | `PIC S9(p-s)V9(s) COMP-3`                    | `ceil((p+1)/2)` | money, and anything computed with it    |
| `binary<n>`     | `PIC S9(n) COMP`                             | 2, 4, or 8      | counters, sequence numbers, codes       |
| `native<n>`     | `PIC S9(n) COMP-5`                           | 2, 4, or 8      | an interface to something outside COBOL |
| `zoned<p,s>`    | `PIC S9(p-s)V9(s) SIGN IS TRAILING SEPARATE` | `p + 1`         | unpacked numbers a person reads         |
| `unsigned<p,s>` | `PIC 9(p-s)V9(s)`                            | `p`             | dates, counts and codes on an estate    |

`unsigned` is the one that surprises people, and it is the most common numeric
picture in a copybook. `PIC 9(8)` carries no sign, so it is eight bytes rather
than nine and cannot hold a negative — assigning one stores its absolute value,
which is COBOL's rule and not something this compiler changes. It exists
because `zoned` is a byte wider, and importing a `PIC 9(8)` as a `zoned<8,0>`
would move every field after it.

A `binary` field is held in the halfword, fullword, or doubleword that fits its
declared digit count, which is how IBM Enterprise COBOL allocates `COMP`: 1–4
digits take two bytes, 5–9 take four, 10–18 take eight. More than eighteen is
`BANK-TYPE-002` — a doubleword holds no more.

Zoned decimal is one byte per digit with the sign kept separate, so the field
reads as plain text, which is what a file another system or a person reads
needs.

`native<n>` is `COMP-5`, which holds the full range its storage can express
rather than truncating to the picture's decimal digits. That is what an
interface to something outside COBOL needs, and it is why the SQLCA uses it.

### What a field starts as

```ts
record Counters {
  processed: binary<9> = 0;
  marker: string<1> = "N";
  rate: decimal<5, 2> = 1.50;
  state: Status = Status.OPEN;
}
```

A COBOL `VALUE` clause. Working storage starts as whatever the region left there
unless a field says otherwise, so a counter with no initial value starts at an
unpredictable number — and writing it in the record rather than in an opening
paragraph keeps the fact next to the field, where it cannot drift out of step
when the record gains one.

COBOL evaluates `VALUE` when it compiles, so the value has to be a written
number, string, boolean, or enum member of the field's own type, short enough to
fit (`BANK-COPY-006`). Anything that needs computing belongs in the program. A
`redefines` field cannot carry one at all: it has no storage of its own, only a
second reading of another field's bytes.

The clause is dropped when the same record is written into an `FD`, where COBOL
does not allow it — a file record describes a buffer the file fills, so there is
nothing there to initialise.

### Alignment

```ts
counter: binary < 9 > sync;
```

`sync` aligns a binary field on a halfword or a fullword, and the compiler
inserts slack bytes before it to get there.

The boundary is **not** the field's own width. IBM's slack-byte algorithm
divides the bytes so far by 2 for a binary item of four digits or fewer and by 4
for one of five digits or more; there is no boundary of 8 for a binary item,
which belongs to `COMPUTATIONAL-2`. So a `binary<18>` occupies eight bytes and
still aligns on a fullword. Nothing else is aligned: a packed, zoned, or
character field needs no slack.

It is the one layout clause that moves every later field without appearing in
any field's own length, so a copybook that uses it and a reader that ignores it
disagree **silently**: every field after the first aligned one is read from the
wrong place. The layout report accounts for the slack, and counts it in the
record's length.

**Usage is representation, not meaning.** A count is a count whichever bytes
hold it, so usage takes no part in type compatibility — only in the picture and
the byte count. Currency stays nominally typed regardless: a BDT amount is still
not an unqualified number that happens to have two decimals.

### Naming a run of fields

```ts
record LegacyDate {
  yearPart: zoned<4, 0>;
  monthPart: zoned<2, 0>;
  dayPart: zoned<2, 0>;

  wholeDate renames yearPart through dayPart;
}
```

A legacy copybook splits a date into year, month, and day and then wants to move
all three at once. `renames` emits a level-66, which gives that run a second
name without a second copy of the storage — that is what distinguishes it from
`redefines`, which is a new _reading_ of the same bytes.

It costs nothing and appears after the record's own fields, which is where COBOL
requires it. Both ends are qualified by the group in the generated code, because
the same record is emitted in working storage and again inside every `FD` that
holds it.

The name reads as the alphanumeric span it covers — `string<11>` above, since
zoned decimal is a byte per digit plus one for the separate sign — which is
exactly what a COBOL group move treats it as. Both ends have to be fields of the
record, the first has to come before the last, and the run cannot cross a table
whose length depends on a count, since a 66 has no length of its own
(`BANK-COPY-004`).

### How a field is presented

```ts
reference: string < 12 > justified;
movement: (edited < GBP, "grouped" > blankWhenZero);
```

`justified` emits `JUSTIFIED RIGHT`. COBOL moves an alphanumeric value
left-aligned and pads on the right; this reverses it, which is how a code lands
in the right of a fixed column without the program counting spaces. Alphanumeric
only — a number's alignment comes from its picture (`BANK-COPY-005`).

`blankWhenZero` emits `BLANK WHEN ZERO`: a statement line with no movement
prints blank rather than `0.00`, and says so in the record rather than in a
conditional. Numbers and edited fields only, since there has to be a zero to
blank.

`sync`, `justified`, and `blankWhenZero` may be written in any order.

### National characters

```ts
given: national<20>;
```

`national<n>` emits `PIC N(n) USAGE NATIONAL`. The length counts characters;
Enterprise COBOL holds each in **two bytes** of UTF-16, so the field occupies
`2n`, and every field after it is placed accordingly. That arithmetic is the only
reason the type exists. A mainframe record with a national field does not line up
if the field is counted as `n` bytes, and a copybook that miscounts it puts
everything after it at the wrong offset.

It is a storage type, not a text type. A national may be assigned from, compared
with, and passed as another national of the same length; it can be read from and
written to files like any other field. What it cannot do is mix with
`string<n>` — in either direction, literals included:

```ts
name.given = "SMITH"; // BANK-TYPE-003
name.given = name.branch; // BANK-TYPE-003
```

The two hold different bytes for the same characters, and converting between them
needs `NATIONAL-OF` or `DISPLAY-OF`, which GnuCOBOL does not implement. Rather
than emit a move whose result differs between compilers, the compiler declines.

#### The caveat, stated plainly

**A national field is the one thing this compiler emits that its own validation
does not cover**, and every such field carries a warning (`BANK-TYPE-024`) saying
so.

GnuCOBOL 3.2.0 — the compiler everything else here is checked against —
allocates **four** bytes per national character inside a group, not two. That is
measured, not assumed:

```cobol
01  H.
    05  A2 PIC N(4) USAGE NATIONAL.
    05  C2 PIC X(4).
```

`C2` starts at byte 17 under GnuCOBOL and byte 9 under Enterprise COBOL.
GnuCOBOL also warns on every such line that its handling of `USAGE NATIONAL` is
unfinished, and allocates two bytes per character for the same picture at the 01
level, which makes it an inconsistency there rather than a rule.

This compiler emits the Enterprise COBOL width, because Enterprise COBOL is what
it targets. Verify the record on z/OS before relying on the offsets;
[`zos/README.md`](../../zos/README.md) records the divergence as the first thing to
check.

### 3b. Edited fields

An amount held as `COMP-3` cannot be printed. `edited<T, "style">` declares the
rendering, and assignment into it is the formatting step — which is exactly what
a COBOL `MOVE` into a numeric-edited item does:

```ts
record StatementRow {
  amount: MoneyBDT;
  printedAmount: edited<MoneyBDT, "signed">;
}

row.printedAmount = row.amount; // MOVE AMOUNT OF ... TO PRINTED-AMOUNT OF ...
```

The picture is generated from the value's own precision and scale, so nobody
counts `Z`s:

| Style         | Picture for `decimal<18,2>`  | Reads as      |
| ------------- | ---------------------------- | ------------- |
| `"plain"`     | `ZZZZZZZZZZZZZZZ9.99`        | `1234.50`     |
| `"grouped"`   | `Z,ZZZ,ZZZ,ZZZ,ZZZ,ZZ9.99`   | `1,234.50`    |
| `"signed"`    | `Z,ZZZ,ZZZ,ZZZ,ZZZ,ZZ9.99-`  | `1,234.50-`   |
| `"credit"`    | `Z,ZZZ,ZZZ,ZZZ,ZZZ,ZZ9.99CR` | `1,234.50CR`  |
| `"protected"` | `*,***,***,***,***,**9.99`   | `***1,234.50` |
| `"slashed"`   | `9999/99/99` (a `date` only) | `2026/08/05`  |

Leading positions suppress and the last integer position stays `9`, so a zero
amount prints as `0.00` rather than as nothing. Decimals never suppress: an
amount is read to the penny, and a blank penny column is a defect. Asterisk fill
is cheque protection — it leaves no room to write digits in. `CR` rather than a
minus is the accounting convention for a credit balance.

**An edited field is a rendering, not a number.** It may be assigned from a
value of its inner type and written to a file or a report line. It may not be
read back as a value, compared, or computed with — which is also what COBOL
allows, and which stops a report column becoming arithmetic input and losing
the digits the editing removed. A style the compiler does not know is
`BANK-TYPE-023` rather than a picture passed through unchecked.

## Currency types

Currency types are nominal and cannot be mixed implicitly.

```ts
type BDT = currency<"BDT", 18, 2>;
type USD = currency<"USD", 18, 2>;
```

Invalid:

```ts
let total: BDT = bdtAmount + usdAmount;
```

Valid:

```ts
let converted: BDT = fxConvert(usdAmount, rate, "HALF_EVEN");
```

## Nullable values

Nullable values are explicit:

```ts
type OptionalBranch = nullable<string<8>>;
```

A nullable value must be checked before use.
