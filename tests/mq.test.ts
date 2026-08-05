import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { precompile } from "../packages/precompiler/src/index";
import { flowed } from "./helpers";

/**
 * IBM MQ — the message queue interface.
 *
 * A queue is not a file. Nothing opens it with file control: the program
 * connects to a queue manager, opens the queue as an *object* described by an
 * MQOD, and every operation is a `CALL` with a completion code and a reason
 * code coming back. The call signatures, the structures, and the constants here
 * are IBM's, from the Application Programming Reference:
 *
 *     MQCONN  (QMgrName, Hconn, CompCode, Reason)
 *     MQOPEN  (Hconn, ObjDesc, Options, Hobj, CompCode, Reason)
 *     MQPUT   (Hconn, Hobj, MsgDesc, PutMsgOpts, BufferLength, Buffer,
 *              CompCode, Reason)
 *     MQGET   (Hconn, Hobj, MsgDesc, GetMsgOpts, BufferLength, Buffer,
 *              DataLength, CompCode, Reason)
 *     MQCLOSE (Hconn, Hobj, Options, CompCode, Reason)
 *     MQDISC  (Hconn, CompCode, Reason)
 */

const PREAMBLE = `module Payments;

record Payment {
  accountId: string<16>;
  amount: decimal<15, 2>;
  idempotencyKey: string<36>;
}

queue paymentOut manager "CSQ1" name "PAYMENT.OUT" output
  record Payment status outReason;
queue paymentIn manager "CSQ1" name "PAYMENT.IN" input
  record Payment status inReason;
`;

function txn(body: string): ReturnType<typeof compile> {
  return compile(`${PREAMBLE}
entry transaction relay(payment: Payment) {
${body}
  audit("RELAYED", payment.idempotencyKey);
}`);
}

function ids(result: { diagnostics: { id: string }[] }): string[] {
  return result.diagnostics.map((entry) => entry.id);
}

describe("the declaration", () => {
  const result = txn(
    "  connectQueue paymentOut;\n  disconnectQueue paymentOut;",
  );

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  /**
   * Each structure is copied under an 01 of this queue's own. The copybooks
   * declare their groups at level 10 with fixed names — `MQOD`, `MQMD` — so a
   * program with two queues has two of each, and every reference has to be
   * qualified or it will not compile. IBM's own samples copy each once and
   * reference it bare, which is why the ambiguity does not arise there.
   */
  it("copies each control block into its own group", () => {
    expect(result.cobol).toContain("01  PAYMENT-OUT-MQOD.");
    expect(result.cobol).toContain("COPY CMQODV.");
    expect(result.cobol).toContain("01  PAYMENT-OUT-MQMD.");
    expect(result.cobol).toContain("COPY CMQMDV.");
    expect(result.cobol).toContain("COPY CMQV SUPPRESS.");
  });

  /** An output queue gets put-message options; an input queue gets get. */
  it("copies only the options block its direction uses", () => {
    expect(result.cobol).toContain("COPY CMQPMOV.");
    expect(result.cobol).toContain("COPY CMQGMOV.");
    expect(result.cobol).toContain("01  PAYMENT-IN-DATALEN");
    // A put has no data length to return, so an output queue has no field.
    expect(result.cobol).not.toContain("01  PAYMENT-OUT-DATALEN");
  });

  it("declares the handles and codes MQ writes back into", () => {
    for (const part of [
      "HCONN",
      "HOBJ",
      "OPTIONS",
      "COMPCODE",
      "REASON",
      "BUFFLEN",
    ]) {
      expect(result.cobol).toContain(`01  PAYMENT-OUT-${part}`);
    }
    // MQ_Q_MGR_NAME_LENGTH is 48, which is what MQCONN's first parameter is.
    expect(result.cobol).toContain("01  PAYMENT-OUT-MGRNAME  PIC X(48).");
  });
});

describe("connecting and opening", () => {
  const result = txn(
    "  connectQueue paymentOut;\n  disconnectQueue paymentOut;",
  );
  const text = flowed(result.cobol);

  /**
   * A connection with nothing open does no work, and an open object with no
   * connection cannot exist. Emitting them as one statement removes the two
   * orderings that are wrong.
   */
  it("connects then opens, and closes then disconnects", () => {
    expect(text).toContain(
      flowed(
        'CALL "MQCONN" USING PAYMENT-OUT-MGRNAME, PAYMENT-OUT-HCONN, PAYMENT-OUT-COMPCODE, PAYMENT-OUT-REASON',
      ),
    );
    expect(text).toContain('CALL "MQOPEN" USING PAYMENT-OUT-HCONN, MQOD OF');
    expect(text).toContain('CALL "MQCLOSE" USING PAYMENT-OUT-HCONN');
    expect(text).toContain('CALL "MQDISC" USING PAYMENT-OUT-HCONN');
    expect(text.indexOf("MQCONN")).toBeLessThan(text.indexOf("MQOPEN"));
    expect(text.indexOf("MQCLOSE")).toBeLessThan(text.indexOf("MQDISC"));
  });

  it("describes the object before opening it", () => {
    expect(text).toContain(
      "MOVE MQOT-Q TO MQOD-OBJECTTYPE OF PAYMENT-OUT-MQOD",
    );
    expect(text).toContain(
      'MOVE "PAYMENT.OUT" TO MQOD-OBJECTNAME OF PAYMENT-OUT-MQOD',
    );
  });

  it("asks for the option its direction means", () => {
    expect(text).toContain("MOVE MQOO-OUTPUT TO PAYMENT-OUT-OPTIONS");
    const input = flowed(
      txn("  connectQueue paymentIn;\n  disconnectQueue paymentIn;").cobol,
    );
    expect(input).toContain("MOVE MQOO-INPUT-AS-Q-DEF TO PAYMENT-IN-OPTIONS");
  });

  /**
   * The completion code says whether it worked and the reason says why it did
   * not. Reporting one without the other leaves an operator with either "it
   * failed" or a number with no context.
   */
  it("tests the completion code after every call, naming both codes", () => {
    expect(text).toContain("IF PAYMENT-OUT-COMPCODE NOT = MQCC-OK");
    expect(text).toContain(
      flowed(
        'DISPLAY "MQCONN FAILED paymentOut COMPCODE " PAYMENT-OUT-COMPCODE " REASON " PAYMENT-OUT-REASON',
      ),
    );
    expect(text).toContain("MOVE 12 TO RETURN-CODE");
  });
});

describe("putting a message", () => {
  const result = txn(
    "  connectQueue paymentOut;\n  putMessage paymentOut from payment;\n  disconnectQueue paymentOut;",
  );
  const text = flowed(result.cobol);

  it("passes the buffer and its length", () => {
    expect(text).toContain("MOVE LENGTH OF PAYMENT TO PAYMENT-OUT-BUFFLEN");
    expect(text).toContain(
      flowed(
        'CALL "MQPUT" USING PAYMENT-OUT-HCONN, PAYMENT-OUT-HOBJ, MQMD OF PAYMENT-OUT-MQMD, MQPMO OF PAYMENT-OUT-MQPMO, PAYMENT-OUT-BUFFLEN, PAYMENT, PAYMENT-OUT-COMPCODE, PAYMENT-OUT-REASON',
      ),
    );
  });

  /**
   * A message released before the unit of work commits is one the downstream
   * system acts on and the bank has not recorded.
   */
  it("puts under syncpoint", () => {
    expect(text).toContain(
      "MOVE MQPMO-SYNCPOINT TO MQPMO-OPTIONS OF PAYMENT-OUT-MQPMO",
    );
  });

  /**
   * Leaving the previous message's identifiers in place would put the new
   * message out under the old one's, and a duplicate-detecting consumer would
   * drop it.
   */
  it("asks the queue manager for a new message identifier", () => {
    expect(text).toContain("MOVE MQMI-NONE TO MQMD-MSGID OF PAYMENT-OUT-MQMD");
    expect(text).toContain(
      "MOVE MQCI-NONE TO MQMD-CORRELID OF PAYMENT-OUT-MQMD",
    );
  });
});

/**
 * A get has three outcomes, not two: a message, an empty queue, and a failure.
 * Folding the empty queue in with the failures stops a batch every time it
 * finishes its work; folding it in with success processes the message area
 * again, still holding the last message read.
 */
describe("getting a message", () => {
  const result = txn(`  connectQueue paymentIn;
  getMessage paymentIn into payment {
    log "GOT";
  } else {
    log "EMPTY";
  };
  disconnectQueue paymentIn;`);
  const text = flowed(result.cobol);

  it("compiles", () => {
    expect(result.diagnostics).toEqual([]);
  });

  it("branches on a message, an empty queue, and anything else", () => {
    expect(text).toContain("WHEN PAYMENT-IN-COMPCODE = MQCC-OK");
    expect(text).toContain("WHEN PAYMENT-IN-REASON = MQRC-NO-MSG-AVAILABLE");
    expect(text).toContain("WHEN OTHER");
    expect(text).toContain('DISPLAY "MQGET FAILED paymentIn COMPCODE "');
  });

  it("asks for any message rather than the last one it read", () => {
    expect(text).toContain("MOVE MQMI-NONE TO MQMD-MSGID OF PAYMENT-IN-MQMD");
  });

  it("gets under syncpoint, without waiting", () => {
    expect(text).toContain(
      flowed(
        "COMPUTE MQGMO-OPTIONS OF PAYMENT-IN-MQGMO = MQGMO-SYNCPOINT + MQGMO-NO-WAIT",
      ),
    );
  });
});

describe("what the compiler refuses", () => {
  it("rejects reading a queue opened for output", () => {
    expect(
      ids(txn("  getMessage paymentOut into payment { } else { };")),
    ).toContain("BANK-MQ-002");
  });

  it("rejects putting to a queue opened for input", () => {
    expect(ids(txn("  putMessage paymentIn from payment;"))).toContain(
      "BANK-MQ-002",
    );
  });

  it("rejects a queue that is not declared", () => {
    expect(ids(txn("  connectQueue nowhere;"))).toContain("BANK-MQ-001");
  });

  /**
   * MQ carries 48 characters in both names. A longer one is truncated into a
   * name the queue manager has never heard of.
   */
  it("rejects a queue name longer than MQ carries", () => {
    const long = "Q".repeat(49);
    expect(
      ids(
        compile(`module M;
record R { idempotencyKey: string<36>; }
queue q manager "CSQ1" name "${long}" output record R status reason1;
entry transaction t(r: R) { audit("A", r.idempotencyKey); }`),
      ),
    ).toContain("BANK-MQ-001");
  });

  it("requires somewhere to read the reason code", () => {
    expect(
      ids(
        compile(`module M;
record R { idempotencyKey: string<36>; }
queue q manager "CSQ1" name "Q.NAME" output record R;
entry transaction t(r: R) {
  connectQueue q;
  audit("A", r.idempotencyKey);
}`),
      ),
    ).toContain("BANK-MQ-001");
  });
});

/**
 * The job. MQ needs no precompiler — the MQI is plain `CALL`s — but the
 * copybooks have to resolve at compile time and the stub has to resolve at
 * link time, or the job produces nothing that can run.
 */
describe("the job a queue needs", () => {
  const result = compile(
    `${PREAMBLE}
entry transaction relay(payment: Payment) {
  connectQueue paymentOut;
  disconnectQueue paymentOut;
  audit("RELAYED", payment.idempotencyKey);
}`,
    { emitJcl: true },
  );

  it("names MQ as a backend requirement", () => {
    expect(result.backendRequirements).toContain("mq");
  });

  it("puts the copybook library on SYSLIB for the compile", () => {
    expect(result.jcl).toContain("//         DD DISP=SHR,DSN=MQM.SCSQCOBC");
  });

  it("puts the stub and run-time libraries where the link and run need them", () => {
    expect(result.jcl).toContain("//SYSLIB   DD DISP=SHR,DSN=MQM.SCSQLOAD");
    expect(result.jcl).toContain("//STEPLIB  DD DISP=SHR,DSN=MQM.SCSQANLE");
  });

  it("leaves a program with no queue alone", () => {
    const plain = compile(
      `module M;
record R { idempotencyKey: string<36>; }
entry transaction t(r: R) { audit("A", r.idempotencyKey); }`,
      { emitJcl: true },
    );
    expect(plain.jcl).not.toContain("SCSQ");
  });
});

/**
 * Executed, against the reference stubs in `runtime/BANKMQ.cbl`.
 *
 * This is evidence of the second grade: it proves the call sequence is one MQ
 * accepts, that every operand resolves and is the right type, and that all
 * three outcomes of a get are reachable with the codes IBM documents. It proves
 * nothing about IBM MQ, which is not here.
 */
describe("executed against the reference MQI", () => {
  const available =
    spawnSync("cobc", ["--version"], { encoding: "utf8" }).status === 0;

  it.skipIf(!available)("puts a message and gets it back, then drains", () => {
    const result = txn(`  connectQueue paymentOut;
  payment.accountId = "ACC0000000000001";
  putMessage paymentOut from payment;
  disconnectQueue paymentOut;
  connectQueue paymentIn;
  payment.accountId = "OVERWRITTEN";
  getMessage paymentIn into payment {
    log "GOT ", payment.accountId;
  } else {
    log "EMPTY";
  };
  getMessage paymentIn into payment {
    log "GOT AGAIN";
  } else {
    log "DRAINED ", inReason;
  };
  disconnectQueue paymentIn;`);
    expect(result.diagnostics).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "bankc-mq-"));
    writeFileSync(
      join(dir, "program.cbl"),
      precompile(result.cobol ?? "").cobol,
      "utf8",
    );

    const built = spawnSync(
      "cobc",
      [
        "-x",
        "-fixed",
        "program.cbl",
        join(process.cwd(), "runtime/BANKMQ.cbl"),
        join(process.cwd(), "runtime/BANKAUDT.cbl"),
        "-o",
        "program",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);

    const ran = spawnSync("./program", [], { cwd: dir, encoding: "utf8" });
    expect(ran.status, ran.stderr).toBe(0);

    // The record was overwritten between the put and the get, so reading the
    // put value back proves the buffer was filled from the message rather
    // than left holding what the program already had.
    expect(ran.stdout).toContain("GOT ACC0000000000001");
    // And the second get found nothing, with the reason code IBM documents
    // for an empty queue.
    expect(ran.stdout).toContain("DRAINED");
    expect(ran.stdout).toContain("2033");
  });
});
