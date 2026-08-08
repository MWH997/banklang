module StatementGeneration;

type BDT = currency<"BDT", 18, 2>;

type USD = currency<"USD", 18, 2>;

type LineNo = decimal<4, 0>;

enum AccountStatus {
  ACTIVE,
  DORMANT,
  FROZEN,
  CLOSED,
}

enum EntryKind {
  DEBIT,
  CREDIT,
}

record LedgerEntry {
  entryKind: EntryKind;
  narrative: string<40>;
  amount: BDT;
}

record Statement {
  accountId: string<16>;
  // Restricted data. It belongs on the statement and in the output file, but it
  // must never reach the audit log or the ledger journal, which outlive the
  // transaction and are read by people with no business seeing it.
  sensitive holderName: string<40>;
  sensitive nationalId: string<20>;
  status: AccountStatus;
  openingBalance: BDT;
  closingBalance: BDT;
  // A statement holds at most 100 lines, bounded so the layout is fixed.
  lines: LedgerEntry[100];
  // Not every account has a relationship manager.
  relationshipManager: nullable<string<20>>;
  idempotencyKey: string<36>;
}

record AccountMaster {
  accountId: string<16>;
  status: AccountStatus;
  balance: BDT;
}

// Keyed access to the account master, read by account id.
file accountMaster indexed input record AccountMaster key accountId status accountMasterStatus;

// A DECLARATIVES handler, which is where COBOL puts the answer to "and if
// that failed?". Without it the status is captured into a field nobody
// reads, and a job that could not open its file ends with return code zero.
on error accountMaster {
  log "ACCOUNTMASTER FAILED, STATUS ", accountMasterStatus;
  returnCode = 12;
}

file statementOutput sequential output record Statement status statementOutputStatus;

// A DECLARATIVES handler, which is where COBOL puts the answer to "and if
// that failed?". Without it the status is captured into a field nobody
// reads, and a job that could not open its file ends with return code zero.
on error statementOutput {
  log "STATEMENTOUTPUT FAILED, STATUS ", statementOutputStatus;
  returnCode = 12;
}

// Only an active or dormant account produces a statement.
function isStatementable(status: AccountStatus): bool {
  return status == AccountStatus.ACTIVE || status == AccountStatus.DORMANT;
}

// A frozen or closed account has its statement suppressed.
// Functions return a value, so they branch with if/else; `switch` carries
// effects and belongs in a transaction body.
function suppressionReason(status: AccountStatus): string<16> {
  if status == AccountStatus.FROZEN {
    return "FROZEN";
  } else {
    if status == AccountStatus.CLOSED {
      return "CLOSED";
    } else {
      return "NONE";
    }
  }
}

transaction generateStatement(statement: Statement, master: AccountMaster) {
  let lineIndex: LineNo = 1;
  let running: BDT = statement.openingBalance;
  let manager: string<20> = "UNASSIGNED";

  open accountMaster;
  read accountMaster into master key statement.accountId;

  // A relationship manager is optional, so it must be checked before use.
  if isPresent(statement.relationshipManager) {
    manager = valueOf(statement.relationshipManager);
  }

  if isStatementable(master.status) {
    while lineIndex <= 100 limit 100 {
      switch statement.lines[lineIndex].entryKind {
        case DEBIT {
          running = running - statement.lines[lineIndex].amount;
        }
        case CREDIT {
          running = running + statement.lines[lineIndex].amount;
        }
      }
      lineIndex = lineIndex + 1;
    }

    statement.closingBalance = running;
    write statementOutput from statement;
  }

  close accountMaster;

  audit("STATEMENT_GENERATED", statement.idempotencyKey);
}
