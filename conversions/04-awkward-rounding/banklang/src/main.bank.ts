module IntCalc;

type MoneyBDT = currency<"BDT", 15, 2>;

type Rate = decimal<5, 4>;

// The rates and the caps, which in the original were `VALUE` clauses on working
// storage and therefore the same three numbers whatever the run.
record InterestRequest {
  balance: MoneyBDT;
  interest: MoneyBDT;
  idempotencyKey: string<36>;
}

function rateFor(balance: MoneyBDT): Rate {
  if balance <= 100000.00 {
    return 0.0125;
  } else {
    if balance <= 500000.00 {
      return 0.0250;
    } else {
      return 0.0375;
    }
  }
}

// Fourteen lines of hand-written banker's rounding become one word.
//
// The original's sequence is nearly right, and its two defects are the reason
// this is a conversion worth reading:
//
//   1. `DIVIDE WS-PENNIES BY 2 GIVING WS-PENNIES REMAINDER WS-PENNIES` makes
//      one field the dividend, the quotient and the remainder. The Language
//      Reference defines the remainder as "the result of subtracting the
//      product of the quotient and the divisor from the dividend" and says the
//      quotient is stored in the GIVING identifier first — so by the time the
//      remainder is worked out, the field the definition calls the dividend
//      holds the quotient. What the statement leaves behind is not something
//      the manual pins down, and the parity test that decides which way every
//      tie goes rests on it.
//   2. `IF WS-EXCESS > WS-HALF` compares a signed field against a positive
//      constant. On a negative interest — a debit balance, which the 1998 memo
//      is about — the excess is negative, both tests are false whatever it was,
//      and the rounding quietly becomes truncation toward zero.
//
// Neither had ever produced a number that looked wrong.
function interestOn(balance: MoneyBDT): MoneyBDT {
  return round(balance * rateFor(balance), "HALF_EVEN");
}

entry transaction calculateInterest(request: InterestRequest) {
  request.interest = interestOn(request.balance);

  log "BALANCE  ", request.balance;
  log "INTEREST ", request.interest;
  audit("INTEREST_CALCULATED", request.idempotencyKey);
}
