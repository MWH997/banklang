module AcctUpdt;

type MoneyBDT = currency<"BDT", 15, 2>;

// The BankTS the original ACCTUPDT becomes.
//
// The layouts are unchanged, field for field, so the same datasets are read and
// written by the same DD names. What is different is everything the original
// left implicit: no OPEN was checked, no READ or WRITE status was checked, and
// there was no way to tell a run that processed nothing from a run whose
// transaction file was never allocated.
record TransRecord {
  trAcctNo: string<16>;
  trAmount: MoneyBDT;
  trType: string<1>;
  trFiller: string<4>;
}

record MasterRecord {
  miAcctNo: string<16>;
  miBalance: MoneyBDT;
  miStatus: string<1>;
}

// The original wrote `PIC X(40)` and addressed it with reference modification:
// `MOVE TR-ACCT-NO TO REJECT-REC(1:16)`. The offsets were the layout, and the
// only place they were written down was the statement that used them.
record RejectRecord {
  rejectAcctNo: string<16>;
  rejectFiller: string<24>;
}

record RunCounts {
  countRead: unsigned<7, 0>;
  countApplied: unsigned<7, 0>;
  countRejected: unsigned<7, 0>;
  idempotencyKey: string<36>;
}

file transFile sequential input record TransRecord status transStatus;

file masterIn sequential input record MasterRecord status masterInStatus;

file masterOut sequential output record MasterRecord status masterOutStatus;

file rejectFile sequential output record RejectRecord status rejectStatus;

on error transFile {
  log "TRANSIN FAILED, STATUS ", transStatus;
  returnCode = 12;
}

on error masterOut {
  log "MASTOUT FAILED, STATUS ", masterOutStatus;
  returnCode = 12;
}

// `2900-REJECT` was reached by two `GO TO`s from the middle of a paragraph and
// fell through into `2999-EXIT`. Here it is a routine with one way in and one
// way out, which is the same control flow written where a reader can see it.
function shouldReject(trans: TransRecord, master: MasterRecord, newBalance: MoneyBDT): string<1> {
  if master.miAcctNo != trans.trAcctNo {
    return "Y";
  } else {
    if master.miStatus != "O" {
      return "Y";
    } else {
      if newBalance < 0.00 {
        return "Y";
      } else {
        return "N";
      }
    }
  }
}

function newBalanceFor(trans: TransRecord, master: MasterRecord): MoneyBDT {
  if trans.trType == "D" {
    return master.miBalance - trans.trAmount;
  } else {
    return master.miBalance + trans.trAmount;
  }
}

entry transaction updateAccounts(trans: TransRecord, master: MasterRecord, reject: RejectRecord, counts: RunCounts) {
  on failure {
    audit("UPDATE_ABANDONED", counts.idempotencyKey);
  }

  counts.countRead = 0;
  counts.countApplied = 0;
  counts.countRejected = 0;

  open transFile;

  // The original opened four files in one statement and tested nothing. A
  // missing TRANSIN gave file status 35, the first READ hit end-of-file, and
  // the step ended with return code zero having applied nothing.
  if transStatus != "00" {
    log "TRANSIN OPEN FAILED, STATUS ", transStatus;
    raise "TRANSIN_OPEN_FAILED";
  }

  open masterIn;

  if masterInStatus != "00" {
    log "MASTIN OPEN FAILED, STATUS ", masterInStatus;
    raise "MASTIN_OPEN_FAILED";
  }

  open masterOut;
  open rejectFile;

  while transStatus == "00" limit 1000000 {
    read transFile into trans;

    if transStatus == "00" {
      counts.countRead = counts.countRead + 1;

      read masterIn into master;

      // The original never looked at this either. A master file that runs out
      // before the transaction file leaves `master` holding the record before
      // it, and every remaining transaction is applied to that account —
      // silently, with a return code of zero. BANK-FILE-017.
      if masterInStatus != "00" {
        log "MASTIN READ FAILED, STATUS ", masterInStatus;
        raise "MASTIN_READ_FAILED";
      }

      if shouldReject(trans, master, newBalanceFor(trans, master)) == "Y" {
        reset reject;
        reject.rejectAcctNo = trans.trAcctNo;
        write rejectFile from reject;
        counts.countRejected = counts.countRejected + 1;
      } else {
        master.miBalance = newBalanceFor(trans, master);
        write masterOut from master;

        // The original never looked at whether the WRITE worked. A full output
        // volume lost every record after the failure and left the counts
        // agreeing with themselves.
        if masterOutStatus != "00" {
          log "MASTOUT WRITE FAILED, STATUS ", masterOutStatus;
          raise "MASTOUT_WRITE_FAILED";
        }

        counts.countApplied = counts.countApplied + 1;
      }
    }
  }

  close rejectFile;
  close masterOut;
  close masterIn;
  close transFile;

  log "READ     ", counts.countRead;
  log "APPLIED  ", counts.countApplied;
  log "REJECTED ", counts.countRejected;

  // Nothing applied is not a failure and is not a normal night. The original
  // said so only in the job log, where nothing acts on it.
  if counts.countApplied == 0 {
    returnCode = 4;
  }

  audit("MASTER_UPDATED", counts.idempotencyKey);
}
