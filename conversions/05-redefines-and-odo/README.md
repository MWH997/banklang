# 05 — A copybook with REDEFINES and OCCURS DEPENDING ON

The customer master record, imported rather than retyped.

Written for this repository in period style — see the
[provenance note](../README.md#provenance).

## The original

[`original/CUSTREC.cpy`](original/CUSTREC.cpy)

Everything a real copybook has and a toy one does not:

```cobol
           05  CM-KIND                 PIC X.
               88  CM-PERSONAL         VALUE 'P'.
               88  CM-CORPORATE        VALUE 'C'.
           05  CM-PARTY.
               10  CM-PERSON           PIC X(30).
               10  FILLER              PIC X(20).
           05  CM-COMPANY REDEFINES CM-PARTY.
               10  CM-REG-NO           PIC X(12).
               10  CM-TRADING-NAME     PIC X(38).
           ...
           05  CM-ADDRESSES OCCURS 1 TO 5 TIMES
                   DEPENDING ON CM-ADDR-COUNT
                   INDEXED BY CM-ADDR-IX.
```

A `FILLER`, a `REDEFINES` that is longer than what it redefines, condition
names, and a table whose used length is a field of the same record.

## The import

```bash
pnpm bankc copybook import conversions/05-redefines-and-odo/original/CUSTREC.cpy
```

```ts
record CmParty {
  cmPerson: string<30>;
  reserved 20;
}

record CustomerRecord {
  cmCustNo: string<10>;
  cmName: string<40>;
  cmKind: string<1>;
  cmParty: CmParty;
  cmCompany: CmCompany redefines cmParty;
  cmOpened: unsigned<8, 0>;
  cmBalance: decimal<15, 2>;
  cmAddrCount: unsigned<2, 0>;
  cmAddresses: CmAddresses[5] depending on cmAddrCount;
}
```

**The importer writes nothing unless the record it produced lays out byte for
byte like the copybook it read.** It re-renders what it wrote, compares the two
layouts field by field, and refuses the whole file if they differ — because a
record that is one byte short is a record every program sharing the copybook
disagrees with, and it compiles.

That check is not decoration. Building this conversion is what found two real
defects in the importer:

- **`FILLER` was refused outright**, which is the correct answer to "can this be
  laid out short?" and a useless answer to "can this copybook be imported?" —
  no real copybook could be. `reserved <n>;` is what BankTS says now, and it
  counts bytes rather than digits: a `PIC S9(9) COMP-3` filler is nine digits
  and five bytes.
- **`CM-ADDR-LINE-1` came back out as `CM-ADDR-LINE1`.** The name generator did
  not treat a digit as starting a word, so the round-trip check refused the
  import. `WS-TIER-1-RATE` is how the name is written on an estate, and it is
  now how the compiler writes one.

## What is not imported

**The 88-levels.** BankTS has `enum` for a field with a fixed set of values, and
the importer does not turn condition names into one: it would have to decide
that the levels it saw are the whole set, and a copybook does not say so. The
program below writes the test out against the same letters, and the conversion
records that as a manual step rather than pretending it was automatic.

**`INDEXED BY CM-ADDR-IX`.** BankTS's `for each` declares its own index.

## The program

[`banklang/src/main.bank.ts`](banklang/src/main.bank.ts) reads the file, chooses
the variant, and walks the table to the count the record carries — so the
imported record is a record and not a picture of one.

## What the compiler generated

[`generated/copybooks/CUSTOMER.cpy`](generated/copybooks/CUSTOMER.cpy) is the
copybook again, and it is worth diffing against the original: same fields, same
order, same pictures, same total length.

## The measurements

<!-- measurements -->

|                                                | Original | Regenerated |
| ---------------------------------------------- | -------- | ----------- |
| Lines of code, comments and blanks excluded    | 21       | 278         |
| `GO TO` a paragraph that is not an exit        | 0        | 0           |
| `GO TO` in total, single-exit returns included | 0        | 10          |
| File operations whose result is tested         | 0 of 0   | 4 of 4      |

The BankTS in between is 71 lines.

<!-- /measurements -->

The line counts here compare a copybook against a program and mean nothing. The
number that matters is the one the importer enforces and neither column shows:
**every field at the same offset.**
