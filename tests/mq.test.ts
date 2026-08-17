import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";
import { precompile } from "../packages/precompiler/src/index";
import { flowed, localCobol } from "./helpers";

/**
 * IBM MQ: the message queue interface.
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
   * declare their groups at level 10 with fixed names (`MQOD`, `MQMD`) so a
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
    for (const part of ["HOBJ", "OPTIONS", "COMPCODE", "REASON", "BUFFLEN"]) {
      expect(result.cobol).toContain(`01  PAYMENT-OUT-${part}`);
    }
  });

  /**
   * The connection belongs to the queue manager, not to the queue, so the
   * handle and the manager name are declared once for both queues on `CSQ1`
   * and neither is qualified by a queue name.
   */
  it("declares one connection per queue manager", () => {
    expect(result.cobol).toContain("*> Queue manager CSQ1.");
    expect(flowed(result.cobol)).toContain(
      "01 BANK-MQM-1-HCONN PIC S9(9) BINARY VALUE 0.",
    );
    // MQ_Q_MGR_NAME_LENGTH is 48, which is what MQCONN's first parameter is.
    expect(flowed(result.cobol)).toContain(
      "01 BANK-MQM-1-MGRNAME PIC X(48) VALUE SPACES.",
    );
    expect(flowed(result.cobol)).toContain(
      "01 BANK-MQM-1-OPENS PIC S9(4) BINARY VALUE 0.",
    );
    expect(result.cobol).not.toContain("PAYMENT-OUT-HCONN");
    expect(result.cobol).not.toContain("PAYMENT-IN-HCONN");
    expect(result.cobol).not.toContain("PAYMENT-OUT-MGRNAME");
  });

  /** A second manager is a second connection, and gets its own storage. */
  it("declares one per manager, not one for all of them", () => {
    const two = compile(`module M;
record R { idempotencyKey: string<36>; }
queue here manager "CSQ1" name "Q.HERE" output record R status hereReason;
queue there manager "CSQ2" name "Q.THERE" output record R status thereReason;
entry transaction t(r: R) {
  connectQueue here;
  connectQueue there;
  disconnectQueue there;
  disconnectQueue here;
  audit("A", r.idempotencyKey);
}`);
    expect(two.diagnostics).toEqual([]);
    expect(two.cobol).toContain("*> Queue manager CSQ1.");
    expect(two.cobol).toContain("*> Queue manager CSQ2.");
    expect(two.cobol).toContain("01  BANK-MQM-2-HCONN");
    expect(flowed(two.cobol)).toContain(
      flowed('MOVE "CSQ2" TO BANK-MQM-2-MGRNAME'),
    );
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
        'CALL "MQCONN" USING BANK-MQM-1-MGRNAME, BANK-MQM-1-HCONN, PAYMENT-OUT-COMPCODE, PAYMENT-OUT-REASON',
      ),
    );
    expect(text).toContain('CALL "MQOPEN" USING BANK-MQM-1-HCONN, MQOD OF');
    expect(text).toContain('CALL "MQCLOSE" USING BANK-MQM-1-HCONN');
    expect(text).toContain('CALL "MQDISC" USING BANK-MQM-1-HCONN');
    expect(text.indexOf("MQCONN")).toBeLessThan(text.indexOf("MQOPEN"));
    expect(text.indexOf("MQCLOSE")).toBeLessThan(text.indexOf("MQDISC"));
  });

  /**
   * The defect this replaced. `MQCONN` naming a queue manager the program is
   * already connected to returns the handle it gave the first time with
   * `MQCC-WARNING` and `MQRC-ALREADY-CONNECTED` rather than `MQCC-OK`, so a program
   * that connected once per queue failed its own completion-code test on the
   * second queue and ended the step with RC 12 before reading a message.
   * Nothing local could see it: the reference MQI returned a fresh handle and
   * `MQCC-OK` every time, so the whole suite passed.
   */
  it("connects once per manager, however many queues are on it", () => {
    const both = flowed(
      txn(`  connectQueue paymentIn;
  connectQueue paymentOut;
  disconnectQueue paymentOut;
  disconnectQueue paymentIn;`).cobol,
    );
    // Two queues, so two opens and two closes, and every MQCONN and MQDISC
    // between them behind the count, so exactly one of each runs. The pairing
    // is the assertion: an unguarded call site is the defect returning.
    expect(both.match(/CALL "MQOPEN"/g)).toHaveLength(2);
    expect(both.match(/CALL "MQCLOSE"/g)).toHaveLength(2);
    expect(both.match(/IF BANK-MQM-1-OPENS = 0 MOVE "CSQ1"/g)).toHaveLength(
      both.match(/CALL "MQCONN"/g)?.length ?? 0,
    );
    expect(
      both.match(/IF BANK-MQM-1-OPENS < 1 MOVE 0 TO BANK-MQM-1-OPENS/g),
    ).toHaveLength(both.match(/CALL "MQDISC"/g)?.length ?? 0);
  });

  /**
   * The count is what carries that across the two statements. `connectQueue`
   * cannot know statically whether an earlier one has already run, since it may sit
   * behind a condition or inside a loop, so the test is made at run time.
   */
  it("counts the open queues on a manager to decide", () => {
    expect(text).toContain("IF BANK-MQM-1-OPENS = 0");
    expect(text).toContain("ADD 1 TO BANK-MQM-1-OPENS");
    expect(text).toContain("SUBTRACT 1 FROM BANK-MQM-1-OPENS");
    expect(text).toContain("IF BANK-MQM-1-OPENS < 1");
  });

  /**
   * IBM's Application Programming Reference, on MQCONN: "If the application is
   * already connected, the handle returned is the same as that returned by the
   * previous MQCONN call, but with completion code MQCC_WARNING and reason
   * code MQRC_ALREADY_CONNECTED", and "Use the connection handle returned in
   * this situation as normal." A generated program does not provoke this
   * itself; a caller that connected before linking to it does.
   */
  it("does not treat an already-made connection as a failure", () => {
    expect(text).toContain(
      flowed(
        "IF PAYMENT-OUT-COMPCODE NOT = MQCC-OK AND PAYMENT-OUT-REASON NOT = MQRC-ALREADY-CONNECTED",
      ),
    );
    // Every other call keeps the plain test. A truncated message is still a
    // failure, and this exemption is not a licence to ignore warnings.
    expect(result.cobol).toContain("IF PAYMENT-OUT-COMPCODE NOT = MQCC-OK\n");
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
    expect(text).toContain("MOVE 12 TO BANK-RETURN-CODE");
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
        'CALL "MQPUT" USING BANK-MQM-1-HCONN, PAYMENT-OUT-HOBJ, MQMD OF PAYMENT-OUT-MQMD, MQPMO OF PAYMENT-OUT-MQPMO, PAYMENT-OUT-BUFFLEN, PAYMENT, PAYMENT-OUT-COMPCODE, PAYMENT-OUT-REASON',
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
 * The job. MQ needs no precompiler, since the MQI is plain `CALL`s, but the
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

  /**
   * `COPY CMQV` resolves against the compiler's SYSLIB, which under IGYWCL is
   * qualified by the procedure step whose DD it is.
   */
  it("puts the copybook library on SYSLIB for the compile", () => {
    const jcl = result.jcl ?? "";
    const compile = jcl.slice(
      jcl.indexOf("//COBOL.SYSLIB"),
      jcl.indexOf("//LKED.SYSLIB"),
    );

    expect(compile).toContain("//               DD DISP=SHR,DSN=MQM.SCSQCOBC");
  });

  it("puts the stub and run-time libraries where the link and run need them", () => {
    const jcl = result.jcl ?? "";
    const link = jcl.slice(jcl.indexOf("//LKED.SYSLIB"), jcl.indexOf("//RUN "));
    const run = jcl.slice(jcl.indexOf("//RUN "));

    // The stub is what turns each MQI CALL into an entry the queue manager
    // resolves; the run-time libraries are what it resolves against.
    expect(link).toContain("//               DD DISP=SHR,DSN=MQM.SCSQLOAD");
    expect(run).toContain("//         DD DISP=SHR,DSN=MQM.SCSQANLE");
    expect(run).toContain("//         DD DISP=SHR,DSN=MQM.SCSQLOAD");
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

  /** Compile a generated program against the reference MQI and run it. */
  function run(cobol: string): { status: number | null; stdout: string } {
    const dir = mkdtempSync(join(tmpdir(), "bankc-mq-"));
    writeFileSync(join(dir, "program.cbl"), localCobol(cobol), "utf8");

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
    return { status: ran.status, stdout: ran.stdout };
  }

  /**
   * Two queues on one manager, which is the shape `examples/mq-request-reply`
   * has and the shape that was broken. The reference MQI answers a second
   * MQCONN naming a manager it is already connected to the way IBM documents
   * it, MQCC-WARNING with reason 2002, so a program that connected per queue
   * ends here with RC 12 and `MQCONN FAILED` on stdout rather than a message.
   */
  it.skipIf(!available)("drains a queue with a reply queue beside it", () => {
    const result = txn(`  connectQueue paymentOut;
  connectQueue paymentIn;
  payment.accountId = "ACC0000000000001";
  putMessage paymentOut from payment;
  payment.accountId = "OVERWRITTEN";
  getMessage paymentIn into payment {
    log "RELAYED ", payment.accountId;
  } else {
    log "EMPTY";
  };
  disconnectQueue paymentIn;
  disconnectQueue paymentOut;`);
    expect(result.diagnostics).toEqual([]);

    const ran = run(precompile(result.cobol ?? "").cobol);
    expect(ran.stdout).not.toContain("MQCONN FAILED");
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain("RELAYED ACC0000000000001");
  });

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
      localCobol(precompile(result.cobol ?? "").cobol),
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
