module TaskFunc20;

// Written from `spec.json`. Specification: read a name, age, annual salary and
// credit score from 'input.txt'; the base loan is four times salary, adjusted
// by an age band and then by a credit-score band; write the name and the
// resulting amount to 'output.txt'.

// Forty characters for a thirty-one character record. The last line of the
// input carries a tab and a space past the credit score and has no newline
// after it, and a record narrower than the line it reads is the other half of
// divergence D23 — the trailing filler is what keeps the read whole.
record CustomerLine {
  custName: string<20>;
  custAge: unsigned<2, 0>;
  custSalary: unsigned<6, 0>;
  custCredit: unsigned<3, 0>;
  custFiller: string<9>;
}

// Twenty-five characters of name field, declared as the twenty the input
// carries plus the five that separate it from the amount.
record LoanLine {
  loanName: string<20>;
  loanGap: string<5>;
  loanAmount: unsigned<7, 0>;
}

file inputTxt lineSequential input record CustomerLine status inputTxtStatus;

file outputTxt lineSequential output record LoanLine status outputTxtStatus;

// The bands are the specification's, in its order. Written as a chain rather
// than a table because each boundary is a business rule with its own number,
// and a table of four rows would hide which is which.
function ageFactor(custAge: unsigned<2, 0>): decimal<2, 1> {
  if custAge <= 30 {
    return 1.0;
  } else {
    if custAge <= 40 {
      return 1.2;
    } else {
      if custAge <= 50 {
        return 1.1;
      } else {
        return 0.9;
      }
    }
  }
}

function creditFactor(custCredit: unsigned<3, 0>): decimal<2, 1> {
  if custCredit >= 750 {
    return 1.3;
  } else {
    if custCredit >= 700 {
      return 1.2;
    } else {
      if custCredit >= 650 {
        return 1.1;
      } else {
        return 1.0;
      }
    }
  }
}

entry transaction assessLoans(
  line: CustomerLine,
  loan: LoanLine,
  idempotencyKey: string<36>,
) {
  open inputTxt;
  open outputTxt;

  while inputTxtStatus == "00" limit 100000 {
    read inputTxt into line;

    if inputTxtStatus == "00" {
      // `integerPart` is the widening: BankTS assigns between numeric types
      // only where they match exactly, so four times a six-digit salary is
      // computed in a field declared wide enough for it rather than in the
      // input's own width.
      let salary: decimal<12, 0> = integerPart(line.custSalary);
      let base: decimal<12, 0> = salary * 4;
      let adjusted: decimal<12, 2> =
        base * ageFactor(line.custAge) * creditFactor(line.custCredit);

      loan.loanName = line.custName;
      loan.loanAmount = integerPart(adjusted);
      write outputTxt from loan;
    }
  }

  close outputTxt;
  close inputTxt;

  audit("LOANS_ASSESSED", idempotencyKey);
}
