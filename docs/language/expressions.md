# Control flow and operators

Branching, loops, and every operator with the COBOL it becomes.

Part of the [BankTS language reference](../language-reference.md).

## Control flow

Supported:

```ts
if / else
while ... limit <n>
return
```

Also supported: `for each` over bounded arrays, `switch` over enums, and
`raise` with an `on failure` handler (see [Transactions](transactions.md)).

Never supported: `try`/`catch`, `throw`, `async`/`await`, `yield`. Failure is
modelled as an abandoned unit of work rather than a thrown value, because COBOL
has neither exceptions nor stack unwinding.

### `search`

```ts
search row in statement.lines where row.entryKind == "DEBIT" {
  // the first matching row, bound to `row`
} else {
  // no row matched
}
```

A linear scan with `for each` finds a row too, but it runs the whole table every
time and says nothing about what it was looking for. `SEARCH` stops at the first
match, and its `AT END` covers the case a hand-written scan usually forgets,
which is why the `else` is required rather than optional.

Every `OCCURS` carries an `INDEXED BY`, because COBOL's `SEARCH` walks an index
rather than a subscript. It costs nothing when nothing searches the table. The
index is set to 1 before each search: `SEARCH` begins wherever the index happens
to be pointing, and a stale one silently skips the front of the table.

The element name stands for the entry the index is pointing at, so the condition
and the body talk about the row rather than about a subscript.

#### Bisecting a sorted table

```ts
record Book {
  bands: Band[400] ascending upper;
}

search sorted band in book.bands where band.upper == target {
  book.rate = band.rate;
} else {
  raise "NO_BAND";
}
```

`SEARCH ALL`. A linear scan of four hundred bands reads two hundred rows to find
one; bisecting reads nine.

COBOL will do it only on a table whose declaration says it is ordered (
`ascending <field>` becomes `ASCENDING KEY IS`), and only on equality against
that key, because anything else has no ordering to cut in half. Both are checked
(`BANK-TYPE-028`).

**Keeping the table sorted is the program's job**, and the consequence of not
doing it is worse than slowness: `SEARCH ALL` on an unsorted table does not fall
back to a scan. It returns the wrong row, or reports no match on a row that is
sitting there.

`SEARCH ALL` sets the index itself, so unlike a plain `search` there is no
`SET ... TO 1` before it.

### `for each`

Iterating a bounded array needs no limit clause, because the array supplies the
bound:

```ts
for each month in loan.schedule {
  loan.schedule[month].dueBalance = running;
}
```

This lowers to `PERFORM VARYING` over the declared length. The index is
provably in range, so no runtime check is emitted for it.

### Bounded loops

Every loop must declare a static iteration limit:

```ts
while accountFeedStatus == "00" limit 100000 {
  read accountFeed into account;
}
```

The limit is not optional. An unbounded loop in a financial program can hold
locks or consume a batch window indefinitely, and the compiler cannot infer a
safe bound, so a missing limit is `BANK-TXN-004`.

The limit becomes a real guard counter in the generated COBOL, so a loop whose
condition never goes false still terminates.

## Operators

| Category   | Operators                   | Operand rules                            |
| ---------- | --------------------------- | ---------------------------------------- |
| Comparison | `<` `<=` `>` `>=` `==` `!=` | Ordering is decimal-only, matching scale |
| Equality   | `==` `!=`                   | Also works on `string<n>` and `bool`     |
| Logical    | `&&` `\|\|` `!`             | Bool operands only                       |
| Arithmetic | `+` `-` `*`                 | Decimal operands                         |
| Division   | `divide(a, b, "MODE")`      | Never a bare `/`                         |

Precedence, loosest first: `||`, `&&`, comparison, `+ -`, `*`, `!`, primary.
Comparisons do not chain.

Multiplication adds the operand scales: `decimal<18,2> * decimal<9,4>` produces
scale 6. That result usually needs rounding before it can be stored as money.

### Numbers COBOL already knows how to work out

| Written                    | COBOL                         | Gives                                    |
| -------------------------- | ----------------------------- | ---------------------------------------- |
| `abs(x)`                   | `FUNCTION ABS`                | the magnitude, keeping `x`'s type        |
| `min(a, b)` / `max(a, b)`  | `FUNCTION MIN` / `MAX`        | one of the two, which must be like-typed |
| `mod(a, b)` / `rem(a, b)`  | `FUNCTION MOD` / `REM`        | whole-number remainder                   |
| `annuity(rate, periods)`   | `FUNCTION ANNUITY`            | the repayment factor of a loan           |
| `presentValue(rate, cash)` | `FUNCTION PRESENT-VALUE`      | a cash flow discounted one period        |
| `isNumeric(text)`          | `FUNCTION TEST-NUMVAL-C`      | whether the characters will convert      |
| `toNumber(text)`           | `FUNCTION NUMVAL-C`           | the number those characters spell        |
| `integerPart(x)`           | `FUNCTION INTEGER-PART`       | the whole units                          |
| `fractionPart(x)`          | `FUNCTION FRACTION-PART`      | what is left of them                     |
| `sign(x)`                  | `FUNCTION SIGN`               | −1, 0, or 1                              |
| `reverse(text)`            | `FUNCTION REVERSE`            | the same characters, back to front       |
| `textLength(text)`         | `FUNCTION STORED-CHAR-LENGTH` | what the field holds, not its width      |

Two of these are in COBOL because COBOL was written for this industry.
`annuity` is the repayment factor of a loan, so a mortgage quote is one line:

```ts
mortgage.payment = round(
  mortgage.principal * annuity(mortgage.monthlyRate, mortgage.termMonths),
  "HALF_UP",
);
```

£100,000 at 0.5% a month over 240 months gives £716.43, and it is COBOL that
computes it, not this compiler. That is the reason to route to the intrinsic
rather than write the series out: a repayment factor worked out in a loop rounds
differently, and the difference shows up in a customer's final instalment.

The rate is a fraction per period, so a monthly rate is the annual one divided
by twelve: `decimal<9, 6>` holding `0.005000` for 0.5%. The term is a whole
number of periods.

`annuity`, `presentValue`, and `toNumber` take the scale of whatever they are
assigned to, the way `round` does: a repayment factor has no natural scale of
its own, and the only one that matters is the scale of the money it multiplies.

`mod` is what a check digit is: `mod(accountNumber, 97)` is the arithmetic
behind an IBAN.

`isNumeric` is worth its own line. A batch reading a flat file gets fields that
are supposed to be numbers and sometimes are not, and converting one that is not
is how a job abends at three in the morning. Asking first turns that into a
rejected record:

```ts
if isNumeric(feed.rawAmount) {
  feed.parsed = toNumber(feed.rawAmount);
} else {
  returnCode = 12;
}
```

Both read grouping and a currency symbol as well as plain digits, because
`NUMVAL-C` does.

`integerPart` and `fractionPart` split an amount into whole units and what is
left of them, which is what a cash-handling or a settlement program does.
`sign` says which way an amount moves without comparing it twice.

`textLength` is the length the field actually holds, trailing spaces excluded,
not the width it was declared as, which the compiler already knows. That is the
length a variable-length record needs to write, and what `reverse` pairs with
for the check-digit algorithms that read a number backwards.

`annuity`, `presentValue`, `toNumber`, `integerPart`, `fractionPart`, `sign`,
and `textLength` take their precision from whatever they are assigned to, the
way `round` does: none of them has a natural width of its own.

These are contextual names, so `min`, `max`, `abs`, and `sign` remain usable as
fields.

### Rounding is explicit

Division cannot be exact and narrowing a scale discards digits, so both require
a stated rounding mode:

```ts
let interest: MoneyBDT = round(balance * rate, "HALF_EVEN");
let share: MoneyBDT = divide(total, count, "HALF_UP");
```

A bare `a / b` is `BANK-DEC-003`. Assigning a wider scale to a narrower one
without `round(...)` is `BANK-DEC-002`.

Enterprise COBOL has **one** rounding phrase. `ROUNDED` is half-up away from
zero, and omitting it truncates towards zero; there is no `MODE IS` sub-phrase,
and `NEAREST-EVEN` appears nowhere in the 6.4 Language Reference. So two of the
seven modes are a phrase and the other five are arithmetic this compiler writes
out: a truncation, the excess that truncation discarded, and a conditional step
of one unit in the last place.

| Mode        | What is emitted    | Use                                  |
| ----------- | ------------------ | ------------------------------------ |
| `HALF_UP`   | `ROUNDED`          | Common commercial rounding           |
| `DOWN`      | no phrase          | Truncation, which is COBOL's default |
| `HALF_EVEN` | generated sequence | Banker's rounding; the usual choice  |
| `HALF_DOWN` | generated sequence |                                      |
| `UP`        | generated sequence |                                      |
| `CEILING`   | generated sequence |                                      |
| `FLOOR`     | generated sequence |                                      |

A division rounds from `DIVIDE ... REMAINDER`, which is exact: a quotient has no
truncation to subtract from. `BANK-DEC-006` refuses a rounding whose work fields
would not fit the eighteen digits `ARITH(COMPAT)` allows.

[numeric-model.md](../numeric-model.md) has each sequence, and
`examples/rounding-conformance` runs all seven against exact arithmetic.

`round(...)` takes the scale of whatever it is assigned to, mirroring COBOL,
where `ROUNDED` attaches to the receiving field rather than to the expression.

### A result too large for its field stops the step

Every computation is emitted with `ON SIZE ERROR`, which names the field in the
job log, sets a return code of 12, and returns. Without the phrase the Language
Reference is explicit that "truncation rules apply and the value of the affected
resultant identifier is computed", and the digits truncated are the high-order
ones, so an overflow does not produce a number large enough to notice. It
produces a plausible small one. Two amounts a `decimal<9, 2>` can each hold add
up to one it cannot: 9,999,999.99 twice stored 9,999,999.98 and returned zero.

With the phrase COBOL leaves the receiving field unchanged rather than storing
the truncated answer, which is why stopping is safe, the wrong value never
reaches the ledger. Division by zero raises the same condition and takes the
same path. Naming a value rather than computing one cannot overflow, so a plain
assignment is emitted unguarded.

The type system does not prevent this and is not trying to: `a + b` on two
`decimal<9, 2>` values has the type `decimal<9, 2>`, because requiring every sum
to be declared a digit wider than its operands would push the widening through
every record in the program. The check is at run time, where the actual values
are.

### Decimal literals

A literal widens to any decimal with the same scale and enough precision, so
`25.00` is a valid `decimal<18, 2>`. The scale must still match exactly: `25.0`
is not a `decimal<18, 2>`, because changing scale is a rounding decision.
