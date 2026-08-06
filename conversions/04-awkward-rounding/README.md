# 04 — An interest calculation with awkward rounding

Tiered rates, and banker's rounding written out by hand because COBOL's
`ROUNDED` is half-up.

Written for this repository in period style — see the
[provenance note](../README.md#provenance).

## The original

[`original/INTCALC.cbl`](original/INTCALC.cbl)

```cobol
      *    BANKERS ROUNDING.  COBOL ROUNDED IS HALF UP, WHICH OVER A
      *    MILLION ACCOUNTS A MONTH IS NOT NOTHING, SO WE DO IT BY HAND.
           COMPUTE WS-TRUNC  = WS-GROSS.
           COMPUTE WS-EXCESS = WS-GROSS - WS-TRUNC.
           COMPUTE WS-PENNIES = WS-TRUNC * 100.

           IF WS-EXCESS > WS-HALF
               COMPUTE WS-TRUNC = WS-TRUNC + 0.01
           ELSE
               IF WS-EXCESS = WS-HALF
                   DIVIDE WS-PENNIES BY 2 GIVING WS-PENNIES
                       REMAINDER WS-PENNIES
                   IF WS-PENNIES NOT = 0
                       COMPUTE WS-TRUNC = WS-TRUNC + 0.01.
```

The comment is right, the approach is right, and it is nearly correct. Two
things are wrong with it, and neither has ever produced a number that looked
wrong.

**The parity test overwrites its own operand.**
`DIVIDE WS-PENNIES BY 2 GIVING WS-PENNIES REMAINDER WS-PENNIES` makes one field
the dividend, the quotient and the remainder. The Language Reference defines the
remainder as "the result of subtracting the product of the quotient and the
divisor from the dividend", and says the quotient is stored in the `GIVING`
identifier first — so by the time the remainder is worked out, the field the
definition calls the dividend is holding the quotient. What the statement leaves
behind is not something the manual pins down, and which way every tie goes rests
on it.

**Every negative amount is truncated toward zero.**
`IF WS-EXCESS > WS-HALF` compares a signed field against `+0.005000`. On a debit
balance the gross is negative, so the excess is negative, so both tests are
false whatever it was — no rounding step is taken and the value is truncated.
The 1998 memo the header refers to is specifically about which way the
half-penny goes on a debit.

## The BankTS

[`banklang/src/main.bank.ts`](banklang/src/main.bank.ts)

```ts
function interestOn(balance: MoneyBDT): MoneyBDT {
  return round(balance * rateFor(balance), "HALF_EVEN");
}
```

The rounding mode is mandatory: `a / b` with no mode is `BANK-DEC-003`, because
the answer depends on it and somebody has to say.

## What the compiler generated

[`generated/cobol/INTCALC.cbl`](generated/cobol/INTCALC.cbl)

The same shape, done right:

```cobol
           COMPUTE BANK-RND-1-STEP = 0.01
           IF BANK-RND-1-EXCESS < 0
               COMPUTE BANK-RND-1-STEP = -0.01
           END-IF
           ...
               WHEN FUNCTION ABS (BANK-RND-1-EXCESS) = 0.005
                   IF FUNCTION MOD (BANK-RND-1-UNITS, 2) = 1
                       ADD BANK-RND-1-STEP TO BANK-RND-1-VALUE
                   END-IF
```

`FUNCTION ABS` on both sides of the comparison, so the sign does not decide
whether rounding happens; a step whose sign comes from the excess, so it moves
away from zero in both directions; and `FUNCTION MOD` for the parity, which
needs no second field to hold a remainder in.

## How it is known to be right

Not by reading it. [`tests/rounding-oracle.test.ts`](../../tests/rounding-oracle.test.ts)
executes the generated sequence over inputs chosen to land on and around every
boundary — an exact tie, one unit either side, both signs, zero — and compares
each answer against a rational held in two BigInts. Inverting the parity test
makes it say 1.01 where the oracle says 1.00, and the test fails.

## The measurements

<!-- measurements -->

|                                                | Original | Regenerated |
| ---------------------------------------------- | -------- | ----------- |
| Lines of code, comments and blanks excluded    | 45       | 96          |
| `GO TO` a paragraph that is not an exit        | 0        | 0           |
| `GO TO` in total, single-exit returns included | 0        | 3           |
| File operations whose result is tested         | 0 of 0   | 0 of 0      |

The BankTS in between is 28 lines.

<!-- /measurements -->

## What changed about what it does

- **Ties on a negative amount now round.** They were truncated.
- **Ties on a positive amount now go to the even penny reliably**, rather than
  depending on what the reused field held.

Both are changes to money. Neither would have been found by comparing outputs on
ordinary data, and both are what the conversion was for.
