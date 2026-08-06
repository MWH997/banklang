module DeadlockRetry;

type MoneyBDT = currency<"BDT", 18, 2>;

// -911 and -913, which every Db2 batch meets and no example showed.
//
// Two units of work touch the same rows in a different order, Db2 picks one to
// break, and the loser gets SQLCODE -911 with its work already rolled back or
// -913 with its work still open. Neither is a bug in either program and neither
// is a reason to fail the step: the answer is to start the unit of work again.
//
// What makes it worth writing down is that a retry is only safe if it is
// bounded and if the rollback is explicit. An unbounded retry against a lock
// that is genuinely held forever is a step that never ends, and a -913 retried
// without a ROLLBACK retries on top of the work the previous attempt had
// already done.
record TransferRequest {
  fromAccountId: string<16>;
  toAccountId: string<16>;
  transferAmount: MoneyBDT;
  idempotencyKey: string<36>;
}

record RetryState {
  attempts: unsigned<9, 0>;
  lastSqlcode: binary<9>;
  settled: string<1>;
}

sql debitAccount(keyFrom: string<16>, keyAmount: MoneyBDT) {
  UPDATE ACCOUNT SET BALANCE = BALANCE - :keyAmount
  WHERE ACCOUNT_ID = :keyFrom
}

sql creditAccount(keyTo: string<16>, keyAmount: MoneyBDT) {
  UPDATE ACCOUNT SET BALANCE = BALANCE + :keyAmount
  WHERE ACCOUNT_ID = :keyTo
}

entry transaction transferWithRetry(request: TransferRequest, state: RetryState) {
  on failure {
    audit("TRANSFER_ABANDONED", request.idempotencyKey);
  }

  state.attempts = 0;
  state.lastSqlcode = 0;
  state.settled = "N";

  // Three attempts. The bound is the point: a retry loop with no limit turns a
  // lock somebody is holding over lunch into a step that runs until an
  // operator cancels it, and the cancel is the only record of what happened.
  while state.settled == "N" limit 3 {
    state.attempts = state.attempts + 1;
    state.lastSqlcode = 0;

    execute debitAccount(request.fromAccountId, request.transferAmount);

    // Three outcomes, not two. Negative is an error, +100 is a row that was
    // not there, and 0 is a row that was updated — and an UPDATE that matched
    // nothing is the account not existing, which is not a lock problem and
    // will not come right on the third attempt.
    if sqlcode < 0 {
      state.lastSqlcode = sqlcode;
      rollback;
    } else {
      if sqlcode == 100 {
        rollback;
        log "NO SUCH ACCOUNT ", request.fromAccountId;
        raise "ACCOUNT_NOT_FOUND";
      } else {
        execute creditAccount(request.toAccountId, request.transferAmount);

        if sqlcode < 0 {
          state.lastSqlcode = sqlcode;
          rollback;
        } else {
          if sqlcode == 100 {
            rollback;
            log "NO SUCH ACCOUNT ", request.toAccountId;
            raise "ACCOUNT_NOT_FOUND";
          } else {
            commit;
            state.settled = "Y";
          }
        }
      }
    }

    // -911 arrives with the unit of work already rolled back, -913 with it
    // still open; the ROLLBACK above covers both, because rolling back
    // something Db2 has already rolled back is a no-op and leaving a -913 open
    // is not. Both mean try again. Anything else negative is a real error — an
    // authorisation failure, a check constraint, a tablespace in recovery —
    // and retrying it just fails three times instead of once.
    if state.settled == "N" {
      if state.lastSqlcode == 0 - 911 {
        log "DEADLOCK, ATTEMPT ", state.attempts;
      } else {
        if state.lastSqlcode == 0 - 913 {
          log "LOCK TIMEOUT, ATTEMPT ", state.attempts;
        } else {
          log "SQL ERROR ", state.lastSqlcode;
          raise "SQL_ERROR";
        }
      }
    }
  }

  if state.settled == "N" {
    log "GAVE UP AFTER ", state.attempts;
    raise "CONTENTION_UNRESOLVED";
  }

  debit(request.fromAccountId, request.transferAmount);
  credit(request.toAccountId, request.transferAmount);

  log "TRANSFERRED ON ATTEMPT ", state.attempts;
  audit("TRANSFER_SETTLED", request.idempotencyKey);
}
