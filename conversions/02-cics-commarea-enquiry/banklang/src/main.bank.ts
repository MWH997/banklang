module AcctEnq;

type MoneyBDT = currency<"BDT", 15, 2>;

// The commarea, field for field. A CICS program's commarea is a contract with
// whatever links to it, so this layout does not get to change in translation.
record CommareaLayout {
  caAcctNo: string<16>;
  caBalance: MoneyBDT;
  caReturnCode: string<2>;
  idempotencyKey: string<36>;
}

record AccountRow {
  rowBalance: MoneyBDT;
  rowStatus: string<1>;
}

sql fetchAccount(keyAcctNo: string<16>): AccountRow {
  SELECT BALANCE, STATUS
  INTO :rowBalance, :rowStatus
  FROM ACCOUNT
  WHERE ACCOUNT_ID = :keyAcctNo
}

cics transaction enquireAccount(commarea: CommareaLayout, row: AccountRow) {
  execute fetchAccount(commarea.caAcctNo) into row;

  // The original had two branches where there are three. `SQLCODE = 0` was
  // "found" and everything else was "01", so a deadlock (-911), a resource
  // that was not available (-904) and a package that was never bound (-805)
  // all reached the terminal as "account not found" — and the operator saw a
  // customer enquiry that worked, for an account that exists.
  //
  // `BANK-SQL-007` refuses a program that cannot tell those apart.
  if sqlcode < 0 {
    commarea.caBalance = 0.00;
    commarea.caReturnCode = "09";
    log "SQL ERROR ", sqlcode;
  } else {
    if sqlcode == 0 {
      commarea.caBalance = row.rowBalance;
      commarea.caReturnCode = "00";
    } else {
      commarea.caBalance = 0.00;
      commarea.caReturnCode = "01";
    }
  }

  // `IF WS-RESP NOT = 0` compared a CICS response against a literal. The
  // translator resolves `DFHRESP(NORMAL)` to whatever the release defines, and
  // a program that assumes zero is one whose comparison stops meaning what it
  // says the first time that changes. `BANK-CICS-004` refuses it.
  writeQueue "CSMT" commarea commarea resp writeResp;

  if writeResp != 0 {
    commarea.caReturnCode = "02";
  }

  audit("ACCOUNT_ENQUIRED", commarea.idempotencyKey);
}
