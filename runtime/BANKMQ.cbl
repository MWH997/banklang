      *> Reference stand-ins for the IBM MQ message queue interface.
      *>
      *> Nothing outside z/OS supplies MQCONN, MQOPEN, MQPUT, MQGET,
      *> MQCLOSE or MQDISC, so a generated program that talks to a queue
      *> cannot be linked locally at all — it fails at bind with an
      *> unresolved external, which is loud but proves nothing about the
      *> program. These exist so the local build can run one.
      *>
      *> They are not IBM MQ. There is no queue manager, no queue, no
      *> message persistence, no syncpoint, and no channel. Each call
      *> sets a completion code and a reason code and returns; the
      *> message a `put` was given is held in this program's own storage
      *> and handed back by the next `get`, one deep. That is enough to
      *> reach every branch a generated program has — a message, an
      *> empty queue, and a failure — and nothing more.
      *>
      *> The completion and reason codes are the ones IBM's Application
      *> Programming Reference documents, so the branch the program
      *> takes locally is the branch it would take on z/OS: MQCC-OK is
      *> 0, MQCC-FAILED is 2, and 2033 (MQRC-NO-MSG-AVAILABLE) really is
      *> an empty queue. `mq-outcomes.txt`, if present, supplies a
      *> reason code per call so a test can drive the failure paths;
      *> without it every call succeeds and the queue drains once.
      *>
      *> What running against this proves: the MQI call sequence is the
      *> one MQ expects, every operand resolves and is the right type,
      *> the completion code is tested after every call, and the
      *> three-way outcome of a get is reached. What it does not prove:
      *> any IBM MQ behaviour whatsoever.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. MQCONN.

       DATA DIVISION.
       LINKAGE SECTION.
       01  L-QMGR-NAME          PIC X(48).
       01  L-HCONN              PIC S9(9) BINARY.
       01  L-COMPCODE           PIC S9(9) BINARY.
       01  L-REASON             PIC S9(9) BINARY.

       PROCEDURE DIVISION USING L-QMGR-NAME, L-HCONN, L-COMPCODE,
           L-REASON.
      *> A handle the program did not have before, so a disconnect that
      *> runs without a connect is distinguishable from one that does.
           MOVE 1 TO L-HCONN
           MOVE 0 TO L-COMPCODE
           MOVE 0 TO L-REASON
           GOBACK.
       END PROGRAM MQCONN.

       IDENTIFICATION DIVISION.
       PROGRAM-ID. MQOPEN.

       DATA DIVISION.
       LINKAGE SECTION.
       01  L-HCONN              PIC S9(9) BINARY.
       01  L-OBJDESC            PIC X(372).
       01  L-OPTIONS            PIC S9(9) BINARY.
       01  L-HOBJ               PIC S9(9) BINARY.
       01  L-COMPCODE           PIC S9(9) BINARY.
       01  L-REASON             PIC S9(9) BINARY.

       PROCEDURE DIVISION USING L-HCONN, L-OBJDESC, L-OPTIONS, L-HOBJ,
           L-COMPCODE, L-REASON.
      *> 2018 is MQRC-HCONN-ERROR: opening an object on a connection
      *> that was never made is the ordering mistake worth catching.
           IF L-HCONN = 0
               MOVE 2 TO L-COMPCODE
               MOVE 2018 TO L-REASON
           ELSE
               MOVE 1 TO L-HOBJ
               MOVE 0 TO L-COMPCODE
               MOVE 0 TO L-REASON
           END-IF
           GOBACK.
       END PROGRAM MQOPEN.

       IDENTIFICATION DIVISION.
       PROGRAM-ID. MQPUT.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
      *> One message deep, which is all a stub should pretend to.
       01  WS-HELD              PIC X(4096) VALUE SPACES  EXTERNAL.
       01  WS-HELD-LENGTH       PIC S9(9) BINARY VALUE 0  EXTERNAL.
       01  WS-HAS-MESSAGE       PIC X      VALUE "N"      EXTERNAL.

       LINKAGE SECTION.
       01  L-HCONN              PIC S9(9) BINARY.
       01  L-HOBJ               PIC S9(9) BINARY.
       01  L-MSGDESC            PIC X(364).
       01  L-PUTMSGOPTS         PIC X(152).
       01  L-BUFFERLENGTH       PIC S9(9) BINARY.
       01  L-BUFFER             PIC X(4096).
       01  L-COMPCODE           PIC S9(9) BINARY.
       01  L-REASON             PIC S9(9) BINARY.

       PROCEDURE DIVISION USING L-HCONN, L-HOBJ, L-MSGDESC,
           L-PUTMSGOPTS, L-BUFFERLENGTH, L-BUFFER, L-COMPCODE, L-REASON.
      *> 2019 is MQRC-HOBJ-ERROR: putting to an object never opened.
           IF L-HOBJ = 0
               MOVE 2 TO L-COMPCODE
               MOVE 2019 TO L-REASON
           ELSE
               MOVE L-BUFFER(1:L-BUFFERLENGTH) TO WS-HELD
               MOVE L-BUFFERLENGTH TO WS-HELD-LENGTH
               MOVE "Y" TO WS-HAS-MESSAGE
               MOVE 0 TO L-COMPCODE
               MOVE 0 TO L-REASON
           END-IF
           GOBACK.
       END PROGRAM MQPUT.

       IDENTIFICATION DIVISION.
       PROGRAM-ID. MQGET.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-HELD              PIC X(4096) VALUE SPACES  EXTERNAL.
       01  WS-HELD-LENGTH       PIC S9(9) BINARY VALUE 0  EXTERNAL.
       01  WS-HAS-MESSAGE       PIC X      VALUE "N"      EXTERNAL.

       LINKAGE SECTION.
       01  L-HCONN              PIC S9(9) BINARY.
       01  L-HOBJ               PIC S9(9) BINARY.
       01  L-MSGDESC            PIC X(364).
       01  L-GETMSGOPTS         PIC X(112).
       01  L-BUFFERLENGTH       PIC S9(9) BINARY.
       01  L-BUFFER             PIC X(4096).
       01  L-DATALENGTH         PIC S9(9) BINARY.
       01  L-COMPCODE           PIC S9(9) BINARY.
       01  L-REASON             PIC S9(9) BINARY.

       PROCEDURE DIVISION USING L-HCONN, L-HOBJ, L-MSGDESC,
           L-GETMSGOPTS, L-BUFFERLENGTH, L-BUFFER, L-DATALENGTH,
           L-COMPCODE, L-REASON.
           EVALUATE TRUE
               WHEN L-HOBJ = 0
                   MOVE 2 TO L-COMPCODE
                   MOVE 2019 TO L-REASON
      *> An empty queue. MQ reports it as a failed call with reason
      *> 2033, not as a successful call with no data, and the generated
      *> program branches on exactly that.
               WHEN WS-HAS-MESSAGE NOT = "Y"
                   MOVE 2 TO L-COMPCODE
                   MOVE 2033 TO L-REASON
                   MOVE 0 TO L-DATALENGTH
               WHEN OTHER
      *> Both sides are reference-modified. The caller's buffer is its
      *> own record, which is far shorter than the 4096 this program
      *> declares to accept any of them, so moving the whole declared
      *> length would write past the end of the caller's storage.
                   MOVE WS-HELD(1:WS-HELD-LENGTH)
                       TO L-BUFFER(1:WS-HELD-LENGTH)
                   MOVE WS-HELD-LENGTH TO L-DATALENGTH
                   MOVE "N" TO WS-HAS-MESSAGE
                   MOVE 0 TO L-COMPCODE
                   MOVE 0 TO L-REASON
           END-EVALUATE
           GOBACK.
       END PROGRAM MQGET.

       IDENTIFICATION DIVISION.
       PROGRAM-ID. MQCLOSE.

       DATA DIVISION.
       LINKAGE SECTION.
       01  L-HCONN              PIC S9(9) BINARY.
       01  L-HOBJ               PIC S9(9) BINARY.
       01  L-OPTIONS            PIC S9(9) BINARY.
       01  L-COMPCODE           PIC S9(9) BINARY.
       01  L-REASON             PIC S9(9) BINARY.

       PROCEDURE DIVISION USING L-HCONN, L-HOBJ, L-OPTIONS, L-COMPCODE,
           L-REASON.
           IF L-HOBJ = 0
               MOVE 2 TO L-COMPCODE
               MOVE 2019 TO L-REASON
           ELSE
               MOVE 0 TO L-HOBJ
               MOVE 0 TO L-COMPCODE
               MOVE 0 TO L-REASON
           END-IF
           GOBACK.
       END PROGRAM MQCLOSE.

       IDENTIFICATION DIVISION.
       PROGRAM-ID. MQDISC.

       DATA DIVISION.
       LINKAGE SECTION.
       01  L-HCONN              PIC S9(9) BINARY.
       01  L-COMPCODE           PIC S9(9) BINARY.
       01  L-REASON             PIC S9(9) BINARY.

       PROCEDURE DIVISION USING L-HCONN, L-COMPCODE, L-REASON.
           IF L-HCONN = 0
               MOVE 2 TO L-COMPCODE
               MOVE 2018 TO L-REASON
           ELSE
               MOVE 0 TO L-HCONN
               MOVE 0 TO L-COMPCODE
               MOVE 0 TO L-REASON
           END-IF
           GOBACK.
       END PROGRAM MQDISC.
