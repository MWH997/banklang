# Amortisation Schedule Example

Builds a loan repayment schedule using recursion and `for each` over a bounded
array.

## What it demonstrates

| Feature            | Where                                                  |
| ------------------ | ------------------------------------------------------ |
| Recursion          | `compound` calls itself to roll a balance forward      |
| `for each`         | Iterates the 36-month schedule with no explicit limit  |
| Indexed assignment | `loan.schedule[month].dueBalance = running;`           |
| Currency scaling   | `balance * rate`, money scaled by a dimensionless rate |
| Explicit rounding  | `round(..., "HALF_EVEN")` on every money result        |

## Recursion becomes a separate program

A COBOL paragraph is **not reentrant**: performing one that is already active is
undefined. So a recursive function is emitted as a sibling `RECURSIVE` program
and reached with `CALL` rather than `PERFORM`:

```cobol
       IDENTIFICATION DIVISION.
       PROGRAM-ID. COMPOUND RECURSIVE.
       DATA DIVISION.
       LOCAL-STORAGE SECTION.
       01  GROWN                PIC S9(16)V99 COMP-3.
       LINKAGE SECTION.
       01  LK-P1                PIC S9(16)V99 COMP-3.
       ...
       PROCEDURE DIVISION USING LK-P1 LK-P2 LK-P3 LK-RESULT.
```

`LOCAL-STORAGE` matters more than it looks. `WORKING-STORAGE` is shared across
invocations of a recursive program, so locals held there are clobbered by the
nested call and the program returns a wrong answer while compiling perfectly.
`LOCAL-STORAGE` gives each invocation its own copy.

Mutual recursion is detected too: two functions that call each other are both
emitted as recursive programs.

## `for each` needs no limit

A `while` loop must declare a bound (`BANK-TXN-004`) because the compiler cannot
infer one. `for each` takes its bound from the array:

```ts
for each month in loan.schedule {
  loan.schedule[month].dueBalance = running;
}
```

```cobol
           PERFORM VARYING MONTH FROM 1 BY 1 UNTIL MONTH > 36
```

The index is provably in range, so no runtime bounds check is emitted for it.
A _computed_ index gets one, because COBOL does not range-check subscripts and
an out-of-range subscript reads or writes adjacent storage:

```cobol
           IF PICK-P2 < 1 OR PICK-P2 > 25
               MOVE "23" TO BANK-BOUNDS-STATUS
               MOVE 25 TO PICK-P2
           END-IF
```

## Currency scaling

`BDT * Rate` is allowed and keeps the currency: multiplying money by a
dimensionless rate is a normal banking operation. Adding a plain decimal to a
currency is still `BANK-DEC-005`, because that is a units error rather than a
scaling one.

## Running it

```bash
pnpm bankc check examples/amortisation-schedule
pnpm bankc test  examples/amortisation-schedule
```

## Notes

The generated COBOL is validated locally with GnuCOBOL. No IBM Enterprise COBOL
validation is claimed.
