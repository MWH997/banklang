      *> Stand-in for the CICS command-level interface stub.
      *>
      *> The precompiler rewrites each EXEC CICS block into
      *> `CALL "DFHEI1" USING <data operands>`, mirroring what the CICS
      *> translator emits. Linking against this program lets a generated CICS
      *> program be executed outside a region.
      *>
      *> What running against this proves: the program links and reaches its
      *> CICS call sites.
      *>
      *> What it does NOT prove: any CICS behaviour. There is no task, no
      *> COMMAREA passing, no syncpoint, and no recovery. RESP values are left
      *> exactly as the generated program initialised them, because this program
      *> cannot tell which operand of a given command is the response field.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. DFHEI1.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CICS-LOG-FILE ASSIGN TO "cics-calls.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS CICS-LOG-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  CICS-LOG-FILE.
       01  CICS-LOG-RECORD          PIC X(80).

       WORKING-STORAGE SECTION.
       01  CICS-LOG-STATUS          PIC XX.
       01  WS-STARTED               PIC X VALUE "N".
       01  WS-CALL-COUNT            PIC 9(4) COMP VALUE 0.
       01  WS-SHOW-COUNT            PIC 9(4).
       01  WS-LINE                  PIC X(80).

       PROCEDURE DIVISION.
       MAIN-ENTRY.
           IF WS-STARTED = "N"
               MOVE "Y" TO WS-STARTED
               OPEN OUTPUT CICS-LOG-FILE
               CLOSE CICS-LOG-FILE
           END-IF

           ADD 1 TO WS-CALL-COUNT
           MOVE WS-CALL-COUNT TO WS-SHOW-COUNT
           MOVE SPACES TO WS-LINE
           STRING "CICS CALL " DELIMITED BY SIZE
                  WS-SHOW-COUNT DELIMITED BY SIZE
                  INTO WS-LINE
           OPEN EXTEND CICS-LOG-FILE
           MOVE WS-LINE TO CICS-LOG-RECORD
           WRITE CICS-LOG-RECORD
           CLOSE CICS-LOG-FILE
           GOBACK.

       END PROGRAM DFHEI1.
