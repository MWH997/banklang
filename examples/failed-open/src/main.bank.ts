module FailedOpen;

type MoneyBDT = currency<"BDT", 18, 2>;

// The first thing that goes wrong in a real batch, and the one no example
// showed: the OPEN.
//
// A step whose input dataset is not catalogued gets file status 35 and then, if
// nothing looks, reads end-of-file immediately and reports success over an
// empty run. Three of the four statuses below are indistinguishable from an
// empty file to a program that only tests for "00" before reading, and the
// difference between them is the difference between a night that had no work
// and a night whose work is still sitting on the queue.
record AccountRecord {
  accountRecordId: string<16>;
  accountBalance: MoneyBDT;
}

record RunSummary {
  accountsRead: unsigned<9, 0>;
  idempotencyKey: string<36>;
}

file accountMaster sequential input record AccountRecord status masterStatus;

// The declarative. A file status test covers the statement that thought to
// look; this covers the ones that did not, wherever in the program they were
// written, because COBOL runs a USE AFTER STANDARD ERROR procedure for any
// operation on the file that fails.
on error accountMaster {
  log "ACCOUNTMASTER FAILED, STATUS ", masterStatus;
  returnCode = 12;
}

entry transaction readMaster(account: AccountRecord, summary: RunSummary) {
  on failure {
    audit("MASTER_UNREADABLE", summary.idempotencyKey);
  }

  summary.accountsRead = 0;

  open accountMaster;

  // Four ways an OPEN INPUT ends, named rather than collapsed. All but the
  // first mean the step has to stop: there is no reading around a dataset that
  // is not there, and a program that carries on is one that reports success
  // over nothing.
  if masterStatus == "35" {
    // The dataset is not in the catalogue, or the DD is missing from the JCL.
    log "ACCOUNTMASTER NOT FOUND";
    raise "INPUT_NOT_FOUND";
  }

  if masterStatus == "37" {
    // Opened for a mode the device cannot do: INPUT against a printer, or a
    // sequential OPEN of something defined to VSAM as a KSDS.
    log "ACCOUNTMASTER WRONG DEVICE OR ORGANISATION";
    raise "INPUT_WRONG_DEVICE";
  }

  if masterStatus == "39" {
    // The classic: the JCL's LRECL, BLKSIZE or RECFM disagrees with the FD.
    // The program is right, the dataset is right, and the two do not match.
    log "ACCOUNTMASTER ATTRIBUTE MISMATCH";
    raise "INPUT_ATTRIBUTES_DIFFER";
  }

  if masterStatus != "00" {
    log "ACCOUNTMASTER OPEN FAILED, STATUS ", masterStatus;
    raise "INPUT_OPEN_FAILED";
  }

  while masterStatus == "00" limit 10000 {
    read accountMaster into account;

    if masterStatus == "00" {
      summary.accountsRead = summary.accountsRead + 1;
    }
  }

  close accountMaster;

  log "READ ", summary.accountsRead;
  audit("MASTER_READ", summary.idempotencyKey);
}
