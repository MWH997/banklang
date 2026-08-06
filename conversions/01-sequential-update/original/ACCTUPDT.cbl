       IDENTIFICATION DIVISION.
       PROGRAM-ID.    ACCTUPDT.
       AUTHOR.        WRITTEN FOR THIS REPOSITORY IN PERIOD STYLE.
      *****************************************************************
      *  DAILY ACCOUNT MASTER UPDATE.                                 *
      *  READS THE TRANSACTION FILE AND APPLIES EACH POSTING TO THE   *
      *  ACCOUNT MASTER, WRITING A NEW MASTER AND A REJECT FILE.      *
      *****************************************************************
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT TRANS-FILE   ASSIGN TO TRANSIN.
           SELECT MASTER-IN    ASSIGN TO MASTIN.
           SELECT MASTER-OUT   ASSIGN TO MASTOUT.
           SELECT REJECT-FILE  ASSIGN TO REJECTS.

       DATA DIVISION.
       FILE SECTION.
       FD  TRANS-FILE
           RECORDING MODE IS F.
       01  TRANS-REC.
           05  TR-ACCT-NO          PIC X(16).
           05  TR-AMOUNT           PIC S9(13)V99 COMP-3.
           05  TR-TYPE             PIC X.
           05  FILLER              PIC X(4).

       FD  MASTER-IN
           RECORDING MODE IS F.
       01  MAST-IN-REC.
           05  MI-ACCT-NO          PIC X(16).
           05  MI-BALANCE          PIC S9(13)V99 COMP-3.
           05  MI-STATUS           PIC X.

       FD  MASTER-OUT
           RECORDING MODE IS F.
       01  MAST-OUT-REC.
           05  MO-ACCT-NO          PIC X(16).
           05  MO-BALANCE          PIC S9(13)V99 COMP-3.
           05  MO-STATUS           PIC X.

       FD  REJECT-FILE
           RECORDING MODE IS F.
       01  REJECT-REC              PIC X(40).

       WORKING-STORAGE SECTION.
       01  WS-SWITCHES.
           05  WS-EOF-TRANS        PIC X       VALUE 'N'.
           05  WS-EOF-MAST         PIC X       VALUE 'N'.
       01  WS-COUNTS.
           05  WS-READ             PIC 9(7)    VALUE ZERO.
           05  WS-APPLIED          PIC 9(7)    VALUE ZERO.
           05  WS-REJECTED         PIC 9(7)    VALUE ZERO.
       01  WS-WORK.
           05  WS-NEW-BAL          PIC S9(13)V99 COMP-3.

       PROCEDURE DIVISION.
       0000-MAIN.
           OPEN INPUT  TRANS-FILE
                       MASTER-IN
                OUTPUT MASTER-OUT
                       REJECT-FILE.
           PERFORM 1000-READ-TRANS.
           PERFORM 2000-PROCESS
               UNTIL WS-EOF-TRANS = 'Y'.
           CLOSE TRANS-FILE
                 MASTER-IN
                 MASTER-OUT
                 REJECT-FILE.
           DISPLAY 'READ     ' WS-READ.
           DISPLAY 'APPLIED  ' WS-APPLIED.
           DISPLAY 'REJECTED ' WS-REJECTED.
           GOBACK.

       1000-READ-TRANS.
           READ TRANS-FILE
               AT END MOVE 'Y' TO WS-EOF-TRANS.
           IF WS-EOF-TRANS NOT = 'Y'
               ADD 1 TO WS-READ.

       2000-PROCESS.
           READ MASTER-IN
               AT END MOVE 'Y' TO WS-EOF-MAST.
           IF MI-ACCT-NO NOT = TR-ACCT-NO
               GO TO 2900-REJECT.
           IF MI-STATUS NOT = 'O'
               GO TO 2900-REJECT.
           IF TR-TYPE = 'D'
               COMPUTE WS-NEW-BAL = MI-BALANCE - TR-AMOUNT
           ELSE
               COMPUTE WS-NEW-BAL = MI-BALANCE + TR-AMOUNT.
           IF WS-NEW-BAL < 0
               GO TO 2900-REJECT.
           MOVE MI-ACCT-NO   TO MO-ACCT-NO.
           MOVE WS-NEW-BAL   TO MO-BALANCE.
           MOVE MI-STATUS    TO MO-STATUS.
           WRITE MAST-OUT-REC.
           ADD 1 TO WS-APPLIED.
           GO TO 2999-EXIT.

       2900-REJECT.
           MOVE SPACES       TO REJECT-REC.
           MOVE TR-ACCT-NO   TO REJECT-REC(1:16).
           WRITE REJECT-REC.
           ADD 1 TO WS-REJECTED.

       2999-EXIT.
           PERFORM 1000-READ-TRANS.
