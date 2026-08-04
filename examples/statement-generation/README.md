# Statement Generation Example

Exercises the type system: currency types, enums with `switch`, bounded arrays,
nullable values, and keyed access to a VSAM-style indexed file.

## What it demonstrates

| Feature         | Where                                                      |
| --------------- | ---------------------------------------------------------- |
| Currency types  | `BDT` and `USD`, nominally distinct even at the same scale |
| Enums           | `AccountStatus`, `EntryKind`, as level-88 condition names  |
| `switch`        | Over `EntryKind`, lowering to `EVALUATE`                   |
| Bounded arrays  | `lines: LedgerEntry[100]`, lowering to `OCCURS`            |
| Indexed access  | `lines[lineIndex].amount` and `lines[i].entryKind`         |
| Nullable values | `relationshipManager` with a required presence check       |
| Indexed file    | `accountMaster` read by key, `ORGANIZATION IS INDEXED`     |

## Currency is nominal

`BDT` and `USD` are both `decimal<18, 2>`, but they are different types:

```ts
type BDT = currency<"BDT", 18, 2>;
type USD = currency<"USD", 18, 2>;
```

Adding one to the other is `BANK-DEC-005`. A written literal has no currency of
its own, so `balance + 1.00` stays legal as long as the scale matches.

Currency is a compile-time distinction. Both lower to the same packed decimal
storage, so there is no runtime cost.

## Enums become condition names

```ts
enum AccountStatus {
  ACTIVE,
  DORMANT,
  FROZEN,
  CLOSED,
}
```

```cobol
           05  STATUS-FLD           PIC X(7).
               88  STATUS-FLD-ACTIVE            VALUE "ACTIVE".
               88  STATUS-FLD-DORMANT           VALUE "DORMANT".
```

The field is sized to the widest member. A `switch` with no `else` must handle
every member (`BANK-TYPE-010`), so adding a member later surfaces every place
that has to deal with it.

Note `STATUS-FLD`: `STATUS` is a COBOL reserved word, so the compiler mangles
the generated data name rather than emitting something the compiler rejects.

## Arrays become OCCURS

```ts
lines: LedgerEntry[100];
```

```cobol
           05  LINES-FLD OCCURS 100 TIMES.
               10  ENTRY-KIND           PIC X(6).
               10  NARRATIVE            PIC X(40).
               10  AMOUNT               PIC S9(16)V99 COMP-3.
```

`statement.lines[i].amount` lowers to the qualified subscript form
`AMOUNT OF STATEMENT (I)`. A literal index outside the declared bounds is
`BANK-TYPE-009`; a computed index is not bounds-checked at run time.

## Nullable values must be checked

```ts
relationshipManager: nullable<string<20>>;
```

The value carries a Db2-style indicator halfword, and reading it without a
guard is `BANK-TYPE-008`:

```ts
if isPresent(statement.relationshipManager) {
  manager = valueOf(statement.relationshipManager);
}
```

The guard does not carry into the `else` branch.

## Indexed file access

```ts
file accountMaster indexed input record AccountMaster key accountId status accountMasterStatus;
...
read accountMaster into master key statement.accountId;
```

```cobol
           SELECT ACCOUNT-MASTER-FILE ASSIGN TO ACCOUNTM
               ORGANIZATION IS INDEXED
               ACCESS MODE IS RANDOM
               RECORD KEY IS ACCOUNT-ID OF ACCOUNT-MASTER-RECORD
               FILE STATUS IS ACCOUNT-MASTER-STATUS.
```

An indexed read reports `"23"` for a missing key rather than `"10"` for end of
file. Reading an indexed file without a key is `BANK-FILE-004`.

COBOL file names are suffixed `-FILE`, because a BankTS file and record type
frequently share a name and would otherwise collide.

## Running it

```bash
pnpm bankc check examples/statement-generation
pnpm bankc test  examples/statement-generation
```

## Notes

The generated COBOL is validated locally with GnuCOBOL. No IBM Enterprise COBOL
validation is claimed.
