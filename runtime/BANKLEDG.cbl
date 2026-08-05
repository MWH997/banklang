      *> Reference implementation of the BankLang ledger interface
      *> (ADR-0003).
      *>
      *> This is NOT a bank ledger. It is a deliberately small program
      *> that honours the calling convention BankLang generates against,
      *> so that a generated program can be executed end to end and its
      *> postings observed. An institution supplies its own BANKLEDG;
      *> this one exists so the project can show generated COBOL running
      *> rather than only compiling.
      *>
      *> Behaviour:
      *>   DEBIT  <account> <amount>  subtracts from the balance
      *>   CREDIT <account> <amount>  adds to the balance
      *>   ROLLBK                     reverses every posting since the
      *>                              last ROLLBK, which is what the
      *>                              generated failure path asks for
      *>
      *> There is no COMMIT in the BankLang calling convention, so the
      *> open unit of work is everything posted since the last rollback.
      *> That is this implementation's choice, not a BankLang guarantee.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. BANKLEDG.

       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT JOURNAL-FILE ASSIGN TO "ledger-journal.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS JOURNAL-STATUS.
           SELECT BALANCE-FILE ASSIGN TO "ledger-balances.txt"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS BALANCE-STATUS.

       DATA DIVISION.
       FILE SECTION.
       FD  JOURNAL-FILE.
       01  JOURNAL-RECORD           PIC X(80).
       FD  BALANCE-FILE.
       01  BALANCE-RECORD           PIC X(80).

       WORKING-STORAGE SECTION.
      *> WORKING-STORAGE persists between calls, which is what lets
      *> this program hold balances across the many calls one
      *> transaction makes.
       01  JOURNAL-STATUS           PIC XX.
       01  BALANCE-STATUS           PIC XX.
       01  WS-STARTED               PIC X VALUE "N".
       01  WS-ACCOUNT-COUNT         PIC 9(4) COMP VALUE 0.
       01  WS-ACCOUNTS.
           05  WS-ACCOUNT OCCURS 200 TIMES.
               10  WS-ACCOUNT-ID    PIC X(32).
               10  WS-ACCOUNT-BAL   PIC S9(16)V99 COMP-3.
       01  WS-POSTING-COUNT         PIC 9(4) COMP VALUE 0.
       01  WS-SHOW-COUNT            PIC 9(4).
       01  WS-POSTINGS.
           05  WS-POSTING OCCURS 500 TIMES.
               10  WS-POST-ID       PIC X(32).
               10  WS-POST-AMOUNT   PIC S9(16)V99 COMP-3.
       01  WS-INDEX                 PIC 9(4) COMP.
       01  WS-SLOT                  PIC 9(4) COMP.
       01  WS-SIGNED-AMOUNT         PIC S9(16)V99 COMP-3.
       01  WS-SHOW-AMOUNT           PIC -(16)9.99.
       01  WS-LINE                  PIC X(80).

       LINKAGE SECTION.
       01  BANK-LEDGER-INTERFACE.
           05  BANK-LEDGER-OPERATION    PIC X(6).
           05  BANK-LEDGER-ACCOUNT      PIC X(32).
           05  BANK-LEDGER-AMOUNT       PIC S9(16)V99 COMP-3.

       PROCEDURE DIVISION USING BANK-LEDGER-INTERFACE.
       MAIN-ENTRY.
           IF WS-STARTED = "N"
               MOVE "Y" TO WS-STARTED
               OPEN OUTPUT JOURNAL-FILE
               CLOSE JOURNAL-FILE
           END-IF

           EVALUATE BANK-LEDGER-OPERATION
               WHEN "DEBIT"
                   COMPUTE WS-SIGNED-AMOUNT = 0 - BANK-LEDGER-AMOUNT
                   PERFORM APPLY-POSTING
               WHEN "CREDIT"
                   MOVE BANK-LEDGER-AMOUNT TO WS-SIGNED-AMOUNT
                   PERFORM APPLY-POSTING
               WHEN "ROLLBK"
                   PERFORM APPLY-ROLLBACK
               WHEN OTHER
                   MOVE SPACES TO WS-LINE
                   STRING "REJECT " DELIMITED BY SIZE
                          BANK-LEDGER-OPERATION DELIMITED BY SIZE
                          INTO WS-LINE
                   PERFORM WRITE-JOURNAL
           END-EVALUATE

           PERFORM WRITE-BALANCES
           GOBACK.

       APPLY-POSTING.
           PERFORM FIND-ACCOUNT
           COMPUTE WS-ACCOUNT-BAL(WS-SLOT) =
               WS-ACCOUNT-BAL(WS-SLOT) + WS-SIGNED-AMOUNT

      *> Remembered so a later ROLLBK can reverse exactly what was
      *> applied.
           IF WS-POSTING-COUNT < 500
               ADD 1 TO WS-POSTING-COUNT
               MOVE BANK-LEDGER-ACCOUNT TO WS-POST-ID(WS-POSTING-COUNT)
               MOVE WS-SIGNED-AMOUNT TO WS-POST-AMOUNT(WS-POSTING-COUNT)
           END-IF

           MOVE WS-SIGNED-AMOUNT TO WS-SHOW-AMOUNT
           MOVE SPACES TO WS-LINE
           STRING FUNCTION TRIM(BANK-LEDGER-OPERATION) DELIMITED BY SIZE
                  " " DELIMITED BY SIZE
                  FUNCTION TRIM(BANK-LEDGER-ACCOUNT) DELIMITED BY SIZE
                  " " DELIMITED BY SIZE
                  FUNCTION TRIM(WS-SHOW-AMOUNT) DELIMITED BY SIZE
                  INTO WS-LINE
           PERFORM WRITE-JOURNAL.

      *> Reversal walks backwards so the balances retrace the same path
      *> they took on the way in.
       APPLY-ROLLBACK.
           PERFORM VARYING WS-INDEX FROM WS-POSTING-COUNT BY -1
                   UNTIL WS-INDEX < 1
               MOVE WS-POST-ID(WS-INDEX) TO BANK-LEDGER-ACCOUNT
               PERFORM FIND-ACCOUNT
               COMPUTE WS-ACCOUNT-BAL(WS-SLOT) =
                   WS-ACCOUNT-BAL(WS-SLOT) - WS-POST-AMOUNT(WS-INDEX)
           END-PERFORM

           MOVE WS-POSTING-COUNT TO WS-SHOW-COUNT
           MOVE SPACES TO WS-LINE
           STRING "ROLLBACK " DELIMITED BY SIZE
                  WS-SHOW-COUNT DELIMITED BY SIZE
                  INTO WS-LINE
           PERFORM WRITE-JOURNAL
           MOVE 0 TO WS-POSTING-COUNT.

       FIND-ACCOUNT.
           MOVE 0 TO WS-SLOT
           PERFORM VARYING WS-INDEX FROM 1 BY 1
                   UNTIL WS-INDEX > WS-ACCOUNT-COUNT
               IF WS-ACCOUNT-ID(WS-INDEX) = BANK-LEDGER-ACCOUNT
                   MOVE WS-INDEX TO WS-SLOT
                   EXIT PERFORM
               END-IF
           END-PERFORM

           IF WS-SLOT = 0
               ADD 1 TO WS-ACCOUNT-COUNT
               MOVE WS-ACCOUNT-COUNT TO WS-SLOT
               MOVE BANK-LEDGER-ACCOUNT TO WS-ACCOUNT-ID(WS-SLOT)
               MOVE 0 TO WS-ACCOUNT-BAL(WS-SLOT)
           END-IF.

       WRITE-JOURNAL.
           OPEN EXTEND JOURNAL-FILE
           MOVE WS-LINE TO JOURNAL-RECORD
           WRITE JOURNAL-RECORD
           CLOSE JOURNAL-FILE.

      *> Rewritten in full after every call, so the file always
      *> reflects the current balances no matter where the program
      *> stopped.
       WRITE-BALANCES.
           OPEN OUTPUT BALANCE-FILE
           PERFORM VARYING WS-INDEX FROM 1 BY 1
                   UNTIL WS-INDEX > WS-ACCOUNT-COUNT
               MOVE WS-ACCOUNT-BAL(WS-INDEX) TO WS-SHOW-AMOUNT
               MOVE SPACES TO WS-LINE
               STRING FUNCTION TRIM(WS-ACCOUNT-ID(WS-INDEX))
                          DELIMITED BY SIZE
                      " " DELIMITED BY SIZE
                      FUNCTION TRIM(WS-SHOW-AMOUNT) DELIMITED BY SIZE
                      INTO WS-LINE
               MOVE WS-LINE TO BALANCE-RECORD
               WRITE BALANCE-RECORD
           END-PERFORM
           CLOSE BALANCE-FILE.

       END PROGRAM BANKLEDG.
