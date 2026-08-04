module AmortisationSchedule;

type BDT = currency<"BDT", 18, 2>;

type Rate = decimal<9, 4>;

type Period = decimal<9, 0>;

record Instalment {
  dueBalance: BDT;
  interestDue: BDT;
}

record Loan {
  accountId: string<16>;
  principal: BDT;
  monthlyRate: Rate;
  termMonths: Period;
  schedule: Instalment[36];
  idempotencyKey: string<36>;
}

// Compound the outstanding balance forward one period at a time.
// Recursion is emitted as a separate RECURSIVE COBOL program, because a
// paragraph is not reentrant.
function compound(balance: BDT, rate: Rate, periods: Period): BDT {
  if periods <= 0 {
    return balance;
  } else {
    let grown: BDT = round(balance + balance * rate, "HALF_EVEN");
    return compound(grown, rate, periods - 1);
  }
}

function interestFor(balance: BDT, rate: Rate): BDT {
  return round(balance * rate, "HALF_EVEN");
}

transaction buildSchedule(loan: Loan) {
  let running: BDT = loan.principal;

  // The bound comes from the array itself, so no limit clause is needed.
  for each month in loan.schedule {
    loan.schedule[month].dueBalance = running;
    loan.schedule[month].interestDue = interestFor(running, loan.monthlyRate);
    running = compound(running, loan.monthlyRate, 1);
  }

  audit("SCHEDULE_BUILT", loan.idempotencyKey);
}
