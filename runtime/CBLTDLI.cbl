       IDENTIFICATION DIVISION.
      *> Reference stand-in for the IMS DL/I language interface.
      *>
      *> This is not IMS. It evaluates no database, holds no segments,
      *> and honours no hierarchy: it reads a status code per call from
      *> `dli-outcomes.txt` and puts it in the PCB, so a generated
      *> program can be executed and its branches reached. See
      *> runtime/README.md.
       PROGRAM-ID. CBLTDLI.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT OUTCOME-FILE ASSIGN TO "dli-outcomes.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS OUTCOME-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  OUTCOME-FILE.
       01  OUTCOME-RECORD        PIC X(16).

       WORKING-STORAGE SECTION.
       01  OUTCOME-STATUS        PIC XX      VALUE SPACES.
      *> Which call this is. A script line names the call it applies
      *> to, so a test can make the third GU miss and leave the rest
      *> alone.
       01  CALL-NUMBER           PIC S9(4) COMP VALUE 0.
       01  WANTED-CALL           PIC S9(4) COMP VALUE 0.
       01  SCRIPTED-STATUS       PIC XX      VALUE SPACES.
       01  LINE-CALL             PIC X(4)    VALUE SPACES.
       01  LINE-STATUS           PIC XX      VALUE SPACES.
       01  END-OF-FILE           PIC X       VALUE "N".
       01  FOUND-ENTRY           PIC X       VALUE "N".

       LINKAGE SECTION.
       01  DLI-FUNCTION          PIC X(4).
       01  DLI-PCB.
           05  PCB-DBD-NAME      PIC X(8).
           05  PCB-SEG-LEVEL     PIC XX.
           05  PCB-STATUS        PIC XX.
           05  PCB-PROC-OPTS     PIC X(4).
           05  FILLER            PIC S9(5) COMP.
           05  PCB-SEG-NAME      PIC X(8).
           05  PCB-KEY-LENGTH    PIC S9(5) COMP.
           05  PCB-SENSEG-COUNT  PIC S9(5) COMP.
           05  PCB-KEY-FEEDBACK  PIC X(64).
       01  DLI-AREA              PIC X(1).

       PROCEDURE DIVISION USING DLI-FUNCTION DLI-PCB DLI-AREA.
       DLI-ENTRY.
           ADD 1 TO CALL-NUMBER
           MOVE "N" TO FOUND-ENTRY
           MOVE SPACES TO SCRIPTED-STATUS

      *> No script at all means every call succeeds, which is what
      *> makes the happy path runnable without a fixture.
           OPEN INPUT OUTCOME-FILE
           IF OUTCOME-STATUS = "00"
               MOVE "N" TO END-OF-FILE
               PERFORM UNTIL END-OF-FILE = "Y"
                   READ OUTCOME-FILE
                       AT END MOVE "Y" TO END-OF-FILE
                       NOT AT END
                           MOVE OUTCOME-RECORD(1:4) TO LINE-CALL
                           MOVE OUTCOME-RECORD(6:2) TO LINE-STATUS
                           MOVE FUNCTION NUMVAL(LINE-CALL)
                               TO WANTED-CALL
                           IF WANTED-CALL = CALL-NUMBER
                               MOVE LINE-STATUS TO SCRIPTED-STATUS
                               MOVE "Y" TO FOUND-ENTRY
                           END-IF
                   END-READ
               END-PERFORM
               CLOSE OUTCOME-FILE
           END-IF

           IF FOUND-ENTRY = "Y"
               MOVE SCRIPTED-STATUS TO PCB-STATUS
           ELSE
               MOVE SPACES TO PCB-STATUS
           END-IF

      *> The segment name the last call reached. A real PCB reports the
      *> segment DL/I positioned on; this reports the one it was asked
      *> for, which is enough for a program that tests its own status
      *> and no more.
           MOVE DLI-FUNCTION TO PCB-SEG-NAME
           GOBACK.

       END PROGRAM CBLTDLI.
