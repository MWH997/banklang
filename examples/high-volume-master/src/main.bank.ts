module HighVolumeMaster;

type MoneyBDT = currency<"BDT", 18, 2>;

// The example the loop bound exists for.
//
// A five-million-record master and a bound of one million. Before the
// exhaustion branch, this program read the first million records, closed its
// files, wrote its audit event and ended with return code zero: a night that
// posted a fifth of the book and reported success. The bound had been added
// deliberately, with a comment saying it was what stopped a corrupt file
// spinning the job until an operator cancelled it, and it gave the safe case
// and the catastrophic case the same ending.
record MasterRecord {
  masterAccountId: string<16>;
  masterBalance: MoneyBDT;
}

record RunTotals {
  recordsRead: unsigned<9, 0>;
  accrued: MoneyBDT;
}

file accountMaster sequential input record MasterRecord status accountMasterStatus;

file accrualOutput sequential output record MasterRecord status accrualOutputStatus;

// A DECLARATIVES handler, which is where COBOL puts the answer to "and if
// that failed?". Without it the status is captured into a field nobody
// reads, and a job that could not open its file ends with return code zero.
on error accrualOutput {
  log "ACCRUALOUTPUT FAILED, STATUS ", accrualOutputStatus;
  returnCode = 12;
}

function monthlyAccrual(balance: MoneyBDT): MoneyBDT {
  return round(balance * 0.0025, "HALF_EVEN");
}

entry transaction accrueMaster(master: MasterRecord, totals: RunTotals, idempotencyKey: string<36>) {
  totals.recordsRead = 0;
  totals.accrued = 0.00;

  open accountMaster;
  open accrualOutput;

  // One million, and the generated program now tells the two ways out of this
  // loop apart: falling out because the file ran out is the ordinary end;
  // falling out with the counter at the limit and the status still "00" is the
  // bound stopping work that had not finished, and it fails the step.
  while accountMasterStatus == "00" limit 1000000 {
    read accountMaster into master;

    if accountMasterStatus == "00" {
      totals.recordsRead = totals.recordsRead + 1;
      master.masterBalance = master.masterBalance + monthlyAccrual(master.masterBalance);
      totals.accrued = totals.accrued + monthlyAccrual(master.masterBalance);

      write accrualOutput from master;
    }
  }

  close accountMaster;
  close accrualOutput;

  log "READ ", totals.recordsRead, " ACCRUED ", totals.accrued;
  audit("MASTER_ACCRUED", idempotencyKey);
}
