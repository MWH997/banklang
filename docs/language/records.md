# Records

Records and their layout, inheritance, generics, variant records, bounded arrays, and copybooks brought in from outside.

Part of the [BankTS language reference](../language-reference.md).

## Records

Records map to COBOL group items and copybook structures.

```ts
record TransferRequest {
  debitAccount: string<16>;
  creditAccount: string<16>;
  amount: decimal<18, 2>;
  idempotencyKey: string<36>;
}
```

Rules:

- field order is preserved
- field lengths are fixed
- nullable fields must be explicit
- dynamic object fields are forbidden
- nested records are allowed
- arrays must be bounded

### Space nothing names

```ts
record CustomerParty {
  personName: string<30>;
  reserved 20;
}
```

`FILLER PIC X(20)`. Every copybook on an estate has them (a field that was
removed, a gap left for one that is coming, an area another program's copybook
overlays), and a record language without a way to say so cannot describe the
records it has to interoperate with. The importer used to refuse such a
copybook outright, which is the right answer to "can this be laid out short?"
and a useless answer to "can this copybook be imported?"

A reserved slot has no name and there is deliberately no way to give it one:
nothing can read it, assign to it, or move a record through it. `FILLER` is not
a name in COBOL either, and a slot a program could write to would be writing
into space the layout says belongs to nobody.

The number is **bytes**, not digits. `PIC S9(9) COMP-3` is nine digits and five
bytes, and `reserved 9` where the copybook had five would move every field after
it four bytes along.

A field really can be called `reserved`; what settles it is the token after.
A slot is followed by its byte count, a field by the `:` before its type.

### 5c. Variant records and variable-length tables

Two clauses a real copybook is built on:

```ts
record LegacyRecord {
  recordType: string<2>;
  personalName: string<40>;
  companyName: string<40> redefines personalName;

  lineCount: binary<4>;
  lines: Entry[100] depending on lineCount;
}
```

`redefines` is a second reading of storage another field already occupies:
how a legacy layout says "this area means different things depending on the
record type". The layout report shows it at the offset it shares.

It must name the field immediately before it, or a redefinition of that same
area written since; COBOL requires the readings of an area to follow its
description with nothing in between that takes storage of its own. It cannot
redefine a table, and it cannot carry a `depending on` (`BANK-COPY-004`).

It may be **longer** than what it redefines. COBOL then extends the storage
area, so the record runs to the end of the longest reading of it and every field
after it moves by the overhang: `a: string<6>` redefined by `national<4>` is
the Language Reference's own example, and leaves the next field at byte 8.

`depending on` names the field holding how much of a table this record uses,
which is what makes a variable-length record variable. The fixed bound stays as
the maximum (the storage still has to be reserved), so the emitted clause is
`OCCURS 1 TO 100 TIMES DEPENDING ON LINE-COUNT OF BATCH`. The count must be a
whole number declared before the table, because COBOL reads it to decide the
record's length and cannot read a field it has not reached.

The count is qualified by its group because the same record is laid out in
working storage and again inside every `FD` that holds it, so the bare name
exists twice and both compilers reject it as ambiguous. The Language Reference
allows the qualification: "All data-names used in the `OCCURS` clause can be
qualified; they cannot be subscripted or indexed."

**The count is checked before anything uses it.** The Language Reference says
"the behavior is undefined if the value of the object is outside of the range",
and the object decides how long the record containing the table is: a count of
500 on a table declared to hold 100 describes a record longer than the storage
allocated for it, so every group move, write, or call using that record runs off
the end. The check matters most where the value is least controlled: the count
usually arrives in the record read from the file, so it holds whatever was in
the dataset. Out of range, the count is named in the job log and the step fails
with a return code of 12. A `read` also copies only the occurrences the count
says are there, rather than the declared maximum, which would read past the data
the read delivered.

**The varying table has to be the last field that takes storage.** A field
declared after it is _variably located_: it sits at the start of the table plus
the count times the entry, so it moves every time the count does, and no
copybook can give it an offset. IBM calls this complex `ODO` and permits it;
this compiler is stricter and says why (`BANK-COPY-004`). The layout report
would otherwise state the offset the field has when the table is full, which is
an offset no other record has, and a copybook that names a byte position
nothing is at is worse than no copybook at all. GnuCOBOL refuses the shape
outright, so such a program could not be executed locally either.

### 5a. Inheritance

A record may extend another. The base fields are laid out first, so the derived
record's leading storage is the base record's storage byte for byte:

```ts
record CurrentAccount {
  accountId: string<16>;
  balance: currency<"BDT", 18, 2>;
}

record SavingsAccount extends CurrentAccount {
  minimumBalance: currency<"BDT", 18, 2>;
}
```

That layout guarantee is the point: an existing copybook for the base still
reads a derived record correctly.

It is also what makes a derived record substitutable for its base at a call
site. A function's record parameter is a `LINKAGE` cell rather than a group item
in working storage, and the caller points the cell at the argument before
performing the paragraph:

```cobol
           SET ADDRESS OF LEDGER-BALANCE-OF-P1 TO ADDRESS OF SAVINGS-ACCOUNT
           PERFORM LEDGER-BALANCE-OF
```

The cell describes the declared parameter's fields, and `extends` guarantees
those fields sit at the same offsets in the derived record, so the callee reads
the caller's storage correctly. An argument whose address the caller cannot take
without evaluating a subscript first is `BANK-TYPE-021`.

A transaction is a program entry point rather than something called with varying
arguments, so its record parameters stay in working storage and take no part in
this.

Redeclaring an inherited field is `BANK-TYPE-017`; a cycle is `BANK-TYPE-016`.

### 5b. Generics

Records and functions may take type parameters. There is no runtime
polymorphism in COBOL and no boxing, so every instantiation is expanded into a
concrete declaration at compile time:

```ts
record Slot<T> {
  value: T;
  present: bool;
}

record Holder {
  money: Slot<currency<"BDT", 18, 2>>;
  count: Slot<decimal<9, 0>>;
}
```

That emits two records, `SLOT-CUR-BDT18-2` and `SLOT-DEC9-0`, each with its own
storage. Two instantiations of one generic cost two copies of the layout and,
for a function, two copies of the code. Type arguments are normalised through
the resolver first, so `Slot<Money>` and `Slot<currency<"BDT", 18, 2>>` are one
record rather than two identical ones.

Generic functions take their type arguments by inference from the argument
types, never explicitly:

```ts
function larger<T>(left: T, right: T): T {
  if left >= right {
    return left;
  } else {
    return right;
  }
}
```

`larger(a, b)` instantiates from the types of `a` and `b`. There is no
`larger<Money>(a, b)` syntax, because `f<T>(x)` cannot be told apart from two
comparisons without unbounded lookahead. A type parameter that appears in no
parameter type therefore cannot be inferred, and is `BANK-TYPE-020`.

A generic that is never instantiated generates nothing and is never checked
against real types, which is reported as `BANK-TYPE-015`.

Two instantiations of a generic **function** that lower to identical COBOL share
one paragraph. `larger<currency<"BDT", 18, 2>>` and
`larger<currency<"USD", 18, 2>>` both emit `PIC S9(16)V99 COMP-3`, so emitting
both is the same paragraph and the same storage twice. Sharing follows the
callee: two instantiations that differ only in which instantiation they call
merge once those callees have merged. The surviving name is the alphabetically
first of the group, so the choice does not depend on the order the instantiations
were created in.

This is a decision about emitted COBOL and nothing else. Currency stays nominally
typed, so `larger(bdtAmount, usdAmount)` is still `BANK-TYPE-020`. A function you
wrote yourself keeps its own paragraph even if another one happens to match it
exactly, because that name appears in the source, the source map, and the audit
record.

Instantiated **records** are never shared: two instantiations are two variables
holding different values, not two copies of one routine.

## Bounded arrays

```ts
record Statement {
  entries: LedgerEntry[1000];
}
```

Arrays must be statically bounded unless mapped to a known COBOL `OCCURS DEPENDING ON` construct.

### Tables of tables

```ts
record RateBook {
  rates: decimal<9, 4>[3][4];
}
```

Nested `OCCURS`, three rows of four. The bounds read outermost-first, so the 3
becomes the outer table and the 4 the inner one: a rate matrix by term and
band, which is how a bank holds one.

```ts
book.rates[1][1] = 0.05;
```

COBOL subscripts the **innermost** data name with every dimension at once, so
that becomes `RATES-ITEM OF BOOK (1, 1)` rather than `RATES (1) (1)`. The inner
dimension is named for you, since nothing in the source names it and COBOL needs
something to subscript.

Each dimension gets its own `INDEXED BY`.

## Copybooks in the program

`bankc` emits a `.cpy` file for every record. Whether the generated program
writes those layouts out or copies them in is a project setting:

```json
{ "copybookMode": "inline" }
```

| Mode     | Generated program               | For                                         |
| -------- | ------------------------------- | ------------------------------------------- |
| `inline` | `01 TRANSFER-REQUEST.` + fields | a self-contained artifact, reviewable alone |
| `copy`   | `COPY TRANSFER.`                | a shop with a shared copybook library       |

`inline` is the default: it is what the playground shows and what a reviewer
reads on its own.

`copy` is the shape a real shop expects, where the copybook is the contract
between programs rather than a document that can drift from them. The generated
job then carries a `SYSLIB` for the copybook library (without it the copy
statements resolve to nothing and every data name is undefined), and local
GnuCOBOL validation puts the copybook directory on the compiler's search path,
so the mode that ships is the mode that is checked.

The record stays traceable in `copy` mode: the source map carries one entry for
the record and none for its fields, because the fields are in the copybook and
have a layout report of their own.

**A copybook is named for its member, not for its record.** A PDS member name is
one to eight characters of letters, digits, and the national characters, with no
hyphens, and that is also all the compiler looks at: "only the first eight
characters of text-name are used as the identifying name" when it searches a PDS
or PDSE. So `TransferRequest` is the member `TRANSFER`, and the `COPY` names
that. `COPY TRANSFER-REQUEST` would have the compiler look for a member called
`TRANSFER-`, which no library can hold.

The consequence is that two records agreeing within those eight characters
cannot share a copybook library: one overwrites the other, and every program
that copies either gets a record with the name it asked for and different fields
at different offsets. `BANK-COPY-007` reports that within a program, and
`pnpm zos:kit` refuses to build a bundle whose members would overwrite each
other rather than shipping one under the other's name.
