module FullDisk;

type MoneyBDT = currency<"BDT", 18, 2>;

// The failure that happens halfway through.
//
// A sequential dataset runs out of extents and the WRITE comes back status 34,
// a boundary violation. Everything before it was written and is still there;
// everything after it was not. Without SMS the step usually ends B37 before the
// program sees anything at all, which is why the message the operator gets from
// here matters: it names the last record written, so the rerun can start from
// the one after it rather than from the top of a file half of which is already
// on the output.
record PostingRecord {
  postingAccountId: string<16>;
  postingAmount: MoneyBDT;
}

record WriteProgress {
  linesWritten: unsigned<9, 0>;
  lastAccountId: string<16>;
  idempotencyKey: string<36>;
}

file postingInput sequential input record PostingRecord status inputStatus;

file postingOutput sequential output record PostingRecord status outputStatus;

on error postingOutput {
  log "POSTINGOUTPUT FAILED, STATUS ", outputStatus;
  returnCode = 12;
}

entry transaction copyPostings(posting: PostingRecord, progress: WriteProgress) {
  on failure {
    // The handler's job is the operator's message, not recovery: there is no
    // recovering from a full volume inside the program that filled it.
    log "STOPPED AFTER ", progress.linesWritten, " AT ", progress.lastAccountId;
    audit("OUTPUT_EXHAUSTED", progress.idempotencyKey);
  }

  progress.linesWritten = 0;
  progress.lastAccountId = "";

  open postingInput;
  open postingOutput;

  while inputStatus == "00" limit 100000 {
    read postingInput into posting;

    if inputStatus == "00" {
      write postingOutput from posting;

      // 34 is the boundary violation: the dataset has no room for another
      // record. 24 is the same thing on a VSAM file, where the key sequence
      // rather than the extent is what ran out. Neither is recoverable and
      // both are silent: a WRITE that fails and is not tested loses the
      // record and leaves the count agreeing with itself.
      if outputStatus == "34" {
        log "POSTINGOUTPUT OUT OF SPACE";
        raise "OUTPUT_FULL";
      }

      if outputStatus != "00" {
        log "POSTINGOUTPUT WRITE FAILED, STATUS ", outputStatus;
        raise "OUTPUT_WRITE_FAILED";
      }

      progress.linesWritten = progress.linesWritten + 1;
      progress.lastAccountId = posting.postingAccountId;
    }
  }

  close postingInput;
  close postingOutput;

  log "COPIED ", progress.linesWritten;
  audit("POSTINGS_COPIED", progress.idempotencyKey);
}
