module EodReport;

type MoneyBDT = currency<"BDT", 18, 2>;

// Step four: what the morning reads.
//
// It touches no ledger and holds no restart position, because printing the
// report twice costs paper. A step that can simply be rerun is worth keeping
// apart from one that cannot, and that is the whole argument for splitting a
// night into steps rather than writing one program that does everything.
record PostedItem {
  postedBranchId: string<8>;
  postedAccountId: string<16>;
  postedAmount: MoneyBDT;
}

// A print line is a group of fields, not a string somebody built. The amount
// is `edited`, which is what makes a COMP-3 balance printable at all: the MOVE
// into it is the formatting step, and the picture comes from the value's own
// precision and scale rather than from counting Zs by hand.
record ReportLine {
  lineLabel: string<20>;
  lineBranch: string<8>;
  lineGap: string<4>;
  lineAmount: edited<MoneyBDT, "grouped">;
}

record ReportState {
  branchOnHand: string<8>;
  branchTotal: MoneyBDT;
  grandTotal: MoneyBDT;
  linesPrinted: unsigned<9, 0>;
  idempotencyKey: string<36>;
}

file postedSettlement sequential input record PostedItem status postedStatus;

// `page` paginates with LINAGE, which is in the base compiler. The report with
// control breaks written by Report Writer is a separate example, because Report
// Writer needs a licensed precompiler and this job should not.
file printedReport sequential output record ReportLine page 60 footing 55 top 3 bottom 3 status reportStatus;

on error postedSettlement {
  log "POSTEDSETTLEMENT FAILED, STATUS ", postedStatus;
  returnCode = 12;
}

entry transaction printSettlement(posted: PostedItem, line: ReportLine, state: ReportState) {
  on failure {
    audit("REPORT_FAILED", state.idempotencyKey);
  }

  state.branchOnHand = "";
  state.branchTotal = 0.00;
  state.grandTotal = 0.00;
  state.linesPrinted = 0;

  open postedSettlement;

  if postedStatus != "00" {
    log "POSTEDSETTLEMENT OPEN FAILED, STATUS ", postedStatus;
    raise "INPUT_OPEN_FAILED";
  }

  open printedReport;

  if reportStatus != "00" {
    log "PRINTEDREPORT OPEN FAILED, STATUS ", reportStatus;
    raise "OUTPUT_OPEN_FAILED";
  }

  reset line;
  line.lineLabel = "SETTLEMENT BY BRANCH";
  write printedReport from line advancing page;

  while postedStatus == "00" limit 500000 {
    read postedSettlement into posted;

    if postedStatus == "00" {
      // The control break. It works because the sort step put the records in
      // branch order. On unsorted input this prints a total every time the
      // branch changes, which is a report that is wrong and still balances.
      if posted.postedBranchId != state.branchOnHand {
        if state.branchOnHand != "" {
          reset line;
          line.lineLabel = "BRANCH TOTAL";
          line.lineBranch = state.branchOnHand;
          line.lineAmount = state.branchTotal;
          write printedReport from line advancing 2 on page {
            reset line;
            line.lineLabel = "SETTLEMENT BY BRANCH";
            write printedReport from line advancing page;
          };
          state.linesPrinted = state.linesPrinted + 1;
        }

        state.branchOnHand = posted.postedBranchId;
        state.branchTotal = 0.00;
      }

      state.branchTotal = state.branchTotal + posted.postedAmount;
      state.grandTotal = state.grandTotal + posted.postedAmount;
    }
  }

  // The last branch has no successor to trigger its break, so its total is
  // printed here. Leaving this out loses one branch from the report and
  // nothing says so, the grand total still agrees with the ledger.
  if state.branchOnHand != "" {
    reset line;
    line.lineLabel = "BRANCH TOTAL";
    line.lineBranch = state.branchOnHand;
    line.lineAmount = state.branchTotal;
    write printedReport from line advancing 2;
    state.linesPrinted = state.linesPrinted + 1;
  }

  reset line;
  line.lineLabel = "GRAND TOTAL";
  line.lineAmount = state.grandTotal;
  write printedReport from line advancing 2;
  state.linesPrinted = state.linesPrinted + 1;

  close printedReport;
  close postedSettlement;

  log "PRINTED ", state.linesPrinted;
  audit("SETTLEMENT_REPORTED", state.idempotencyKey);
}
