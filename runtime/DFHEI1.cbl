      *> Stand-in for the CICS command-level interface stub.
      *>
      *> The translator in packages/precompiler rewrites each EXEC CICS
      *> block into `CALL "DFHEI1" USING DFHEIBLK, DFHEIV-COMMAND,
      *> <data operands>` followed by the `MOVE EIBRESP TO ...` that a
      *> command's RESP option asks for. That is the shape the CICS
      *> translator produces: a command does not return its response in
      *> an operand, it leaves it in the EXEC interface block, and which
      *> command it is arrives in a generated work field rather than
      *> being inferable from the operands.
      *>
      *> Responses are scripted, not produced by CICS. A test writes
      *> cics-outcomes.txt, one line per command it wants to control,
      *> numbered in the order the program issues them:
      *>
      *>     0001 +000 +000     command 1 succeeds (NORMAL)
      *>     0002 +027 +000     command 2 fails with PGMIDERR
      *>
      *> A command the file does not mention returns NORMAL. With no
      *> file at all, every command returns NORMAL, which is how this
      *> program behaved before it could be scripted at all.
      *>
      *> What running against this proves: the program links, reaches
      *> its CICS call sites in order, and takes the branch its RESP
      *> test selects — so an error path is executed rather than
      *> assumed.
      *>
      *> What it does NOT prove: any CICS behaviour. There is no task,
      *> no program to LINK to, no COMMAREA handed anywhere, no
      *> syncpoint and no recovery. A scripted PGMIDERR shows the
      *> generated COBOL handles a failed LINK; it does not show that
      *> CICS would fail that LINK.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. DFHEI1.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CICS-LOG-FILE ASSIGN TO "cics-calls.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS CICS-LOG-STATUS.
           SELECT OUTCOME-FILE ASSIGN TO "cics-outcomes.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS OUTCOME-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  CICS-LOG-FILE.
       01  CICS-LOG-RECORD          PIC X(80).
       FD  OUTCOME-FILE.
       01  OUTCOME-RECORD           PIC X(80).

       WORKING-STORAGE SECTION.
       01  CICS-LOG-STATUS          PIC XX.
       01  OUTCOME-STATUS           PIC XX.
       01  WS-STARTED               PIC X VALUE "N".
       01  WS-CALL-COUNT            PIC 9(4) COMP VALUE 0.
       01  WS-SHOW-COUNT            PIC 9(4).
       01  WS-SHOW-RESP             PIC -(8)9.
       01  WS-LINE                  PIC X(80).

      *> Scripted responses, read once and held across calls.
       01  WS-OUTCOME-COUNT         PIC 9(4) COMP VALUE 0.
       01  WS-OUTCOMES.
           05  WS-OUTCOME OCCURS 100 TIMES.
               10  WS-OUTCOME-CALL  PIC 9(4).
               10  WS-OUTCOME-RESP  PIC S9(8) COMP.
               10  WS-OUTCOME-RESP2 PIC S9(8) COMP.
       01  WS-INDEX                 PIC 9(4) COMP.
       01  WS-PARSED.
           05  WS-PARSED-CALL       PIC 9(4).
           05  FILLER               PIC X.
           05  WS-PARSED-RESP       PIC S9(3) SIGN IS LEADING SEPARATE.
           05  FILLER               PIC X.
           05  WS-PARSED-RESP2      PIC S9(3) SIGN IS LEADING SEPARATE.

       LINKAGE SECTION.
      *> The EIB the translator builds, field for field. This is a
      *> LINKAGE description of storage the caller owns, so it has to
      *> match that layout exactly: writing EIBRESP at the wrong offset
      *> writes into some other field and the caller reads a response it
      *> was never given.
       01  DFHEIBLK.
           05  EIBTIME              PIC S9(7) COMP-3.
           05  EIBDATE              PIC S9(7) COMP-3.
           05  EIBTRNID             PIC X(4).
           05  EIBTASKN             PIC S9(7) COMP-3.
           05  EIBTRMID             PIC X(4).
           05  FILLER               PIC S9(4) COMP.
           05  EIBCPOSN             PIC S9(4) COMP.
           05  EIBCALEN             PIC S9(4) COMP.
           05  EIBAID               PIC X(1).
           05  EIBFN                PIC X(2).
           05  EIBRCODE             PIC X(6).
           05  EIBDS                PIC X(8).
           05  EIBREQID             PIC X(8).
           05  EIBRSRCE             PIC X(8).
           05  EIBSYNC              PIC X(1).
           05  EIBFREE              PIC X(1).
           05  EIBRECV              PIC X(1).
           05  FILLER               PIC X(1).
           05  EIBATT               PIC X(1).
           05  EIBEOC               PIC X(1).
           05  EIBFMH               PIC X(1).
           05  EIBCOMPL             PIC X(1).
           05  EIBSIG               PIC X(1).
           05  EIBCONF              PIC X(1).
           05  EIBERR               PIC X(1).
           05  EIBERRCD             PIC X(4).
           05  EIBSYNRB             PIC X(1).
           05  EIBNODAT             PIC X(1).
           05  EIBRESP              PIC S9(8) COMP.
           05  EIBRESP2             PIC S9(8) COMP.
           05  EIBRLDBK             PIC X(1).
       01  DFHEIV-COMMAND           PIC X(20).

       PROCEDURE DIVISION USING DFHEIBLK, DFHEIV-COMMAND.
       MAIN-ENTRY.
           IF WS-STARTED = "N"
               MOVE "Y" TO WS-STARTED
               OPEN OUTPUT CICS-LOG-FILE
               CLOSE CICS-LOG-FILE
               PERFORM LOAD-OUTCOMES
           END-IF

           ADD 1 TO WS-CALL-COUNT

      *> NORMAL unless the test scripted something else for this
      *> command.
           MOVE 0 TO EIBRESP
           MOVE 0 TO EIBRESP2
           PERFORM APPLY-OUTCOME

           MOVE WS-CALL-COUNT TO WS-SHOW-COUNT
           MOVE EIBRESP TO WS-SHOW-RESP
           MOVE SPACES TO WS-LINE
           STRING "CICS " DELIMITED BY SIZE
                  WS-SHOW-COUNT DELIMITED BY SIZE
                  " " DELIMITED BY SIZE
                  FUNCTION TRIM(DFHEIV-COMMAND) DELIMITED BY SIZE
                  " RESP " DELIMITED BY SIZE
                  FUNCTION TRIM(WS-SHOW-RESP) DELIMITED BY SIZE
                  INTO WS-LINE
           OPEN EXTEND CICS-LOG-FILE
           MOVE WS-LINE TO CICS-LOG-RECORD
           WRITE CICS-LOG-RECORD
           CLOSE CICS-LOG-FILE
           GOBACK.

       APPLY-OUTCOME.
           PERFORM VARYING WS-INDEX FROM 1 BY 1
                   UNTIL WS-INDEX > WS-OUTCOME-COUNT
               IF WS-OUTCOME-CALL(WS-INDEX) = WS-CALL-COUNT
                   MOVE WS-OUTCOME-RESP(WS-INDEX) TO EIBRESP
                   MOVE WS-OUTCOME-RESP2(WS-INDEX) TO EIBRESP2
                   EXIT PERFORM
               END-IF
           END-PERFORM.

      *> No file means no script, which is the ordinary case: every
      *> command returns NORMAL. A missing file is therefore not an
      *> error.
       LOAD-OUTCOMES.
           OPEN INPUT OUTCOME-FILE
           IF OUTCOME-STATUS NOT = "00"
               EXIT PARAGRAPH
           END-IF

           PERFORM UNTIL WS-OUTCOME-COUNT >= 100
               READ OUTCOME-FILE
                   AT END
                       EXIT PERFORM
               END-READ
               IF OUTCOME-RECORD NOT = SPACES
                   MOVE OUTCOME-RECORD(1:14) TO WS-PARSED
                   ADD 1 TO WS-OUTCOME-COUNT
                   MOVE WS-PARSED-CALL TO
                       WS-OUTCOME-CALL(WS-OUTCOME-COUNT)
                   MOVE WS-PARSED-RESP TO
                       WS-OUTCOME-RESP(WS-OUTCOME-COUNT)
                   MOVE WS-PARSED-RESP2 TO
                       WS-OUTCOME-RESP2(WS-OUTCOME-COUNT)
               END-IF
           END-PERFORM

           CLOSE OUTCOME-FILE.

       END PROGRAM DFHEI1.
