module ReportWithControls;

type MoneyBDT = currency<"BDT", 18, 2>;

// A printed report with control breaks, where nothing in the source adds
// anything up.
//
// That is the reason to have Report Writer at all. A hand-written subtotal is
// three things a reader has to check — the accumulator, the reset, and the
// place the reset happens — and a reset in the wrong place gives a report that
// is wrong and still balances, which survives review. Here the subtotals, the
// grand total, the page turns and the repeated headings are all COBOL's, and
// the program's own statements are `initiate`, `generate`, `terminate`.
record PostingLine {
  branchId: string<8>;
  postingAccountId: string<16>;
  postingAmount: MoneyBDT;
}

record RunTotals {
  linesPrinted: unsigned<9, 0>;
  idempotencyKey: string<36>;
}

file postingInput sequential input record PostingLine status inputStatus;

file statementFile sequential output record PostingLine status reportStatus;

// The control field is `branchId`, so Report Writer breaks whenever it changes
// — which means the input has to arrive in branch order, and the job's sort
// step is what guarantees that. A control break on unsorted input produces a
// subtotal every time the value changes rather than one per branch.
report branchSummary on statementFile control branchId page 60 heading 1 firstDetail 5 lastDetail 55 {
  pageHeading {
    line 1 {
      column 1 "BRANCH POSTING SUMMARY";
      column 60 "PAGE ";
      column 66 pageNumber;
    }
    line 3 {
      column 1 "BRANCH";
      column 12 "ACCOUNT";
      column 32 "AMOUNT";
    }
  }
  detail postingDetail {
    line next {
      column 1 branchId;
      column 12 postingAccountId;
      column 32 postingAmount;
    }
  }
  controlFooting branchId {
    line next {
      column 12 "BRANCH TOTAL";
      column 32 sum postingAmount;
    }
  }
  controlFooting {
    line next {
      column 12 "GRAND TOTAL";
      column 32 sum postingAmount;
    }
  }
}

entry transaction printSummary(posting: PostingLine, totals: RunTotals) {
  on failure {
    audit("REPORT_FAILED", totals.idempotencyKey);
  }

  totals.linesPrinted = 0;

  open postingInput;

  if inputStatus != "00" {
    log "POSTINGINPUT OPEN FAILED, STATUS ", inputStatus;
    raise "INPUT_OPEN_FAILED";
  }

  open statementFile;

  if reportStatus != "00" {
    log "STATEMENTFILE OPEN FAILED, STATUS ", reportStatus;
    raise "REPORT_OPEN_FAILED";
  }

  initiate branchSummary;

  while inputStatus == "00" limit 100000 {
    read postingInput into posting;

    if inputStatus == "00" {
      // The only statement in the loop. It hands one row to Report Writer,
      // which decides whether that row also turns a page, repeats the heading,
      // or breaks a total first.
      generate postingDetail;
      totals.linesPrinted = totals.linesPrinted + 1;
    }
  }

  // `terminate` is what prints the final control footing. Leaving it out is a
  // report missing its grand total, and nothing else says so.
  terminate branchSummary;

  close statementFile;
  close postingInput;

  log "PRINTED ", totals.linesPrinted;
  audit("SUMMARY_PRINTED", totals.idempotencyKey);
}
