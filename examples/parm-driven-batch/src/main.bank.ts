module ParmDrivenBatch;

type MoneyBDT = currency<"BDT", 18, 2>;

// A settlement run needs three things from whoever submitted it: which day it
// is for, which branch, and the key that makes a rerun idempotent. None of them
// is in the data. They are the job's parameters, and until the PARM convention
// existed the compiler declared them in working storage and nothing ever wrote
// to them, so the idempotency key satisfying BANK-TXN-001 was whatever the
// region had left there.
record PostingLine {
  lineAccountId: string<16>;
  lineAmount: MoneyBDT;
}

record DayTotals {
  linesRead: unsigned<9, 0>;
  totalPosted: MoneyBDT;
}

// The restart control record: one keyed record, rewritten in place. A
// sequential file would be rewritten from the start by the next OPEN, so a
// rerun that died before its own first checkpoint would destroy the position it
// was resuming from.
record RestartPoint {
  jobName: string<8>;
  lastAccountId: string<16>;
}

file settlementInput sequential input record PostingLine status settlementInputStatus;

file restartFile indexed update record RestartPoint key jobName status restartStatus;

// A DECLARATIVES handler, which is where COBOL puts the answer to "and if
// that failed?". Without it the status is captured into a field nobody
// reads, and a job that could not open its file ends with return code zero.
on error restartFile {
  log "RESTARTFILE FAILED, STATUS ", restartStatus;
  returnCode = 12;
}

// `runDate` is a date somebody types on the EXEC statement, so it arrives as
// eight characters rather than as a number: `unsigned<8, 0>` is `PIC 9(8)`,
// which is what a date on an estate is declared as and what the PARM carries.
entry transaction settleDay(totals: DayTotals, line: PostingLine, point: RestartPoint, runDate: unsigned<8, 0>, branchId: string<8>, idempotencyKey: string<36>) {
  totals.linesRead = 0;
  totals.totalPosted = 0.00;

  open restartFile;
  point.jobName = "SETTLEDY";

  restart restartFile into point {
    log "RESUMING AFTER ", point.lastAccountId;
  } else {
    log "STARTING FROM THE TOP";
  }

  open settlementInput;

  while settlementInputStatus == "00" limit 100000 {
    read settlementInput into line;

    if settlementInputStatus == "00" {
      totals.linesRead = totals.linesRead + 1;
      totals.totalPosted = totals.totalPosted + line.lineAmount;

      debit(line.lineAccountId, line.lineAmount);
      credit("SETTLEMENT", line.lineAmount);

      point.lastAccountId = line.lineAccountId;
      checkpoint restartFile from point every 1000;
    }
  }

  close settlementInput;
  close restartFile;

  log "SETTLED BRANCH ", branchId, " FOR ", runDate;
  log "LINES ", totals.linesRead, " TOTAL ", totals.totalPosted;
  audit("DAY_SETTLED", idempotencyKey);
}
