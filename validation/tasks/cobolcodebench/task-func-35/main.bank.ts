module TaskFunc35;

// Written from `spec.json`. Specification: read an old master file and a
// transaction file, both in account-number order; where an account is in both,
// add the transaction amount to the master amount; where it is in one, carry it
// through unchanged; write the new master in account-number order.

// Both inputs are twelve characters and neither ends with a newline, so the
// records carry filler: a record that exactly fills an unterminated final line
// loses it under GnuCOBOL (divergence D23).
record MasterLine {
  mstAccount: unsigned<5, 0>;
  mstComma: string<1>;
  mstAmount: unsigned<6, 0>;
  mstFiller: string<6>;
}

// Same layout, separate name: a transaction is not a master record, and two
// parameters of one record type would be one piece of storage (BANK-TYPE-022).
record TransactionLine {
  trnAccount: unsigned<5, 0>;
  trnComma: string<1>;
  trnAmount: unsigned<6, 0>;
  trnFiller: string<6>;
}

// The new master carries a digit more, because two six-digit amounts add to
// seven. The specification says so; the fixture's 44444 proves it.
record NewMasterLine {
  newAccount: unsigned<5, 0>;
  newComma: string<1>;
  newAmount: unsigned<7, 0>;
}

file taskInp1 lineSequential input record MasterLine status taskInp1Status;

file taskInp2
  lineSequential
  input
  record TransactionLine
  status taskInp2Status;

file task5Out lineSequential output record NewMasterLine status task5OutStatus;

entry transaction updateMaster(
  master: MasterLine,
  movement: TransactionLine,
  updated: NewMasterLine,
  idempotencyKey: string<36>,
) {
  open taskInp1;
  open taskInp2;
  open task5Out;

  updated.newComma = ",";

  // A balanced-line merge: one record ahead on each file, and the smaller key
  // is written and replaced. When a file ends its status stops being "00",
  // which takes it out of the comparison without a sentinel key — the usual
  // HIGH-VALUES trick fails the day an account number really is all nines.
  read taskInp1 into master;
  read taskInp2 into movement;

  while taskInp1Status == "00" || taskInp2Status == "00" limit 100000 {
    if taskInp1Status == "00" &&
      (taskInp2Status != "00" || master.mstAccount < movement.trnAccount) {
      updated.newAccount = master.mstAccount;
      // `integerPart` is the widening. BankTS assigns between numeric types
      // only where they match exactly, so a six-digit amount reaches a
      // seven-digit field through a conversion rather than by being allowed to
      // fit; the same strictness is what makes `a + b` carry an ON SIZE ERROR.
      updated.newAmount = integerPart(master.mstAmount);
      write task5Out from updated;
      read taskInp1 into master;
    } else {
      if taskInp2Status == "00" &&
        (taskInp1Status != "00" || movement.trnAccount < master.mstAccount) {
        updated.newAccount = movement.trnAccount;
        updated.newAmount = integerPart(movement.trnAmount);
        write task5Out from updated;
        read taskInp2 into movement;
      } else {
        let held: decimal<9, 0> = integerPart(master.mstAmount);
        let posted: decimal<9, 0> = integerPart(movement.trnAmount);

        updated.newAccount = master.mstAccount;
        updated.newAmount = integerPart(held + posted);
        write task5Out from updated;
        read taskInp1 into master;
        read taskInp2 into movement;
      }
    }
  }

  close task5Out;
  close taskInp2;
  close taskInp1;

  audit("MASTER_UPDATED", idempotencyKey);
}
