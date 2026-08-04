      *> Reference implementation of the BankLang audit interface (ADR-0003).
      *>
      *> Appends each audit event and its correlation key to a log file, so a
      *> test can assert which events a generated program actually emitted and
      *> in what order. An institution supplies its own BANKAUDT.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. BANKAUDT.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT AUDIT-FILE ASSIGN TO "audit-log.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS AUDIT-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  AUDIT-FILE.
       01  AUDIT-RECORD             PIC X(120).

       WORKING-STORAGE SECTION.
       01  AUDIT-STATUS             PIC XX.
       01  WS-STARTED               PIC X VALUE "N".
       01  WS-LINE                  PIC X(120).

       LINKAGE SECTION.
       01  BANK-AUDIT-INTERFACE.
           05  BANK-AUDIT-EVENT         PIC X(32).
           05  BANK-AUDIT-CORRELATION   PIC X(64).

       PROCEDURE DIVISION USING BANK-AUDIT-INTERFACE.
       MAIN-ENTRY.
           IF WS-STARTED = "N"
               MOVE "Y" TO WS-STARTED
               OPEN OUTPUT AUDIT-FILE
               CLOSE AUDIT-FILE
           END-IF

           MOVE SPACES TO WS-LINE
           STRING FUNCTION TRIM(BANK-AUDIT-EVENT) DELIMITED BY SIZE
                  " " DELIMITED BY SIZE
                  FUNCTION TRIM(BANK-AUDIT-CORRELATION) DELIMITED BY SIZE
                  INTO WS-LINE

           OPEN EXTEND AUDIT-FILE
           MOVE WS-LINE TO AUDIT-RECORD
           WRITE AUDIT-RECORD
           CLOSE AUDIT-FILE
           GOBACK.

       END PROGRAM BANKAUDT.
