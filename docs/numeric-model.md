# The numeric model

Precision, scale, intermediate results, and rounding. This is the page a bank
reads most carefully, because it is the one that decides whether the money is
right.

---

## Every number has a declared precision and scale

There is no floating point in the language. `decimal<18,2>` is eighteen digits
of which two are fractional, held as `PIC S9(16)V99 COMP-3` — packed decimal.
Binary floating point cannot represent 0.10, and a bank's arithmetic is decimal.

| Declaration           | Picture                                      | Bytes           | Used for                                     |
| --------------------- | -------------------------------------------- | --------------- | -------------------------------------------- |
| `decimal<p,s>`        | `PIC S9(p-s)V9(s) COMP-3`                    | `ceil((p+1)/2)` | money, and anything computed with it         |
| `currency<"BDT",p,s>` | the same                                     | the same        | money with a currency the typechecker tracks |
| `binary<n>`           | `PIC S9(n) COMP`                             | 2, 4 or 8       | counters, sequence numbers, codes            |
| `native<n>`           | `PIC S9(n) COMP-5`                           | 2, 4 or 8       | an interface to something outside COBOL      |
| `zoned<p,s>`          | `PIC S9(p-s)V9(s) SIGN IS TRAILING SEPARATE` | `p + 1`         | numbers a person or another system reads     |
| `unsigned<p,s>`       | `PIC 9(p-s)V9(s)`                            | `p`             | dates, counts and codes on an estate         |

`unsigned` cannot hold a negative. Assigning one stores its absolute value,
which is COBOL's rule and not something this compiler changes. It exists because
`PIC 9(n)` is the most common numeric picture in a copybook and `zoned` is a
byte wider — importing one as the other would move every field after it.

## Eighteen digits, not thirty-one

The generated program is compiled `ARITH(COMPAT)`, which the `CBL` statement
states. Under it, the Programming Guide says, "the maximum number of digits for
an arithmetic operand is 18". `ARITH(EXTEND)` gives 31.

Eighteen is what every generated picture is sized against and what
`BANK-DEC-006` refuses a rounding for. Compiling the same program under
`ARITH(EXTEND)` would not break it, but the compiler's own refusals would stop
matching the arithmetic — which is why the option is written into the source
rather than left to the installation's defaults module.

`BANK-TYPE-002` refuses a declaration past eighteen digits.

## `TRUNC(STD)`

A binary receiver is truncated to the number of digits in its PICTURE.
`TRUNC(OPT)` does not truncate at all, and `TRUNC(BIN)` truncates to the
storage. The three give different numbers from the same program, which is why
`TRUNC(STD)` is stated rather than assumed.

## Scale is decided by the receiver

`round(balance * rate, "HALF_EVEN")` rounds to the scale of the field being
assigned to, not to the scale of the expression. That is what `ROUNDED` attaches
to in COBOL and BankTS copies it.

A `return round(...)` rounds to the routine's declared return type.

## Intermediate results

COBOL's own. `COMPUTE X = A * B` evaluates the product in the compiler's
intermediate, which carries more digits than any field the emitter could
declare — the Programming Guide's Appendix A gives the number of integer and
decimal places carried through a fixed-point expression.

This matters for the rounding sequences below. The excess a truncation discarded
is computed as `expression - truncated`, evaluated in that same intermediate,
which is what makes it exact. A work field wide enough to hold the untruncated
product would not fit in eighteen digits for two `decimal<18,2>` operands.

It is also why `tools/banklang-ibm.conf` turns GnuCOBOL's `arithmetic-osvs` off:
`ibm-strict` models the OS/VS rules, where an intermediate is truncated at each
step, and under those the subtraction can lose the digit the tie test is about.

## Rounding

### What IBM has

One phrase. `ROUNDED`, and the Language Reference defines it as half-up away
from zero:

> the absolute value of the resultant identifier is increased by 1 whenever the
> absolute value of the discarded digits is greater than or equal to 5

There is no `MODE IS` sub-phrase. `ROUNDED MODE IS NEAREST-EVEN` is COBOL 2002
and `NEAREST-EVEN` appears in no column of Appendix E's reserved word table —
Enterprise COBOL has never heard of the word. BankLang emitted it for two years
because GnuCOBOL's default dialect, which is a superset of every COBOL it knows,
accepted it.

### What BankLang offers

| Mode        | How                                                   |
| ----------- | ----------------------------------------------------- |
| `HALF_UP`   | `ROUNDED`. It is what the phrase means.               |
| `DOWN`      | Nothing. Leaving `ROUNDED` off truncates toward zero. |
| `HALF_EVEN` | Generated                                             |
| `HALF_DOWN` | Generated                                             |
| `UP`        | Generated                                             |
| `CEILING`   | Generated                                             |
| `FLOOR`     | Generated                                             |

`round(x, mode)` and `divide(a, b, mode)` both take a mode and the mode is
mandatory. `a / b` with no mode is `BANK-DEC-003`: the answer depends on it, so
somebody has to say.

### What "generated" means

Two shapes, because a product and a quotient are different problems.

**A product**, or anything that is not a division, is truncated into the
receiver's scale and the excess taken by subtraction:

```cobol
           COMPUTE BANK-RND-1-VALUE = (INTEREST-FOR-P1 * INTEREST-FOR-P2)
           COMPUTE BANK-RND-1-EXCESS =
               (INTEREST-FOR-P1 * INTEREST-FOR-P2) - BANK-RND-1-VALUE
           COMPUTE BANK-RND-1-STEP = 0.01
           IF BANK-RND-1-EXCESS < 0
               COMPUTE BANK-RND-1-STEP = -0.01
           END-IF
           COMPUTE BANK-RND-1-UNITS = BANK-RND-1-VALUE * 100
           EVALUATE TRUE
               WHEN FUNCTION ABS (BANK-RND-1-EXCESS) > 0.005
                   ADD BANK-RND-1-STEP TO BANK-RND-1-VALUE
               WHEN FUNCTION ABS (BANK-RND-1-EXCESS) = 0.005
                   IF FUNCTION MOD (BANK-RND-1-UNITS, 2) = 1
                       ADD BANK-RND-1-STEP TO BANK-RND-1-VALUE
                   END-IF
           END-EVALUATE
```

The expression is re-stated rather than held in a wider field, because the
subtraction is then evaluated in COBOL's own intermediate — exact given the
operands' declared scales, where any field the emitter declared would not be.
Every call in the expression has already run and left its answer in a result
field, so naming it twice reads it twice rather than running it twice.

**A quotient** has no exact truncation to subtract from, so it uses `DIVIDE`'s
own remainder:

```cobol
           DIVIDE BANK-RND-1-DIVIDEND BY BANK-RND-1-DIVISOR
               GIVING BANK-RND-1-VALUE REMAINDER BANK-RND-1-REMAINDER
```

The remainder is exact. The tie test is `|remainder| × 10^scale × 2` against
`|divisor|`, which is the same comparison as `|excess|` against half a unit with
both sides multiplied by the same positive number — and no division in it.

The step's sign comes from the remainder and the divisor together, because the
remainder carries the dividend's sign.

### Why not a wider work field

Because it does not fit. `divide(a, b)` where both are `decimal<18,2>` needs
`max(divisor.precision - divisor.scale - receiver.scale, 1)` integer digits and
`max(dividend.scale, receiver.scale + divisor.scale)` fractional ones — 18
exactly. One more and `BANK-DEC-006` refuses the rounding rather than emitting
arithmetic that overflows.

### `BANK-DEC-006`

Refused when the rounding is not the whole value being stored —
`a + round(b, "HALF_EVEN")` — because COBOL's rounding attaches to the receiving
field, and there is no receiver for the inner one. And refused when the work
fields the sequence needs would not fit in eighteen digits.

### How it is proved

Not by reading it. `tests/rounding-oracle.test.ts` runs the generated program
over inputs chosen to land on and around every boundary — an exact tie, one unit
either side of it, both signs, zero, and a recurring quotient — and compares
each answer against an oracle that holds the value as a rational in two BigInts
and rounds it by the rule the mode names.

Both shapes, seven modes. Inverting the parity test in the `HALF_EVEN` sequence
makes it say 1.01 where the oracle says 1.00, and the test fails.

## Currency

`currency<"BDT",18,2>` lays out exactly as `decimal<18,2>`; the code is a
typechecker fact. Adding a `MoneyBDT` to a `MoneyUSD` is `BANK-DEC-005`, and
there is no conversion operator — a rate is a number somebody has to supply, and
a compiler that invented one would be inventing an exchange rate.

## Comparison

Two decimals of different scale do not compare. `BANK-TYPE-003` says so, with
"matching scale" in the message. COBOL would align them on the decimal point and
give an answer; the objection is that the two values were not measured the same
way and comparing them is a decision rather than an operation.

## Related pages

- [error-handling.md](error-handling.md) — what an overflow does
- [target-conformance.md](target-conformance.md) — the eighteen-digit rule, and its citation
- [divergences.md](divergences.md) — D17, the generated rounding modes
- [language-reference.md](language-reference.md) — the whole type system
