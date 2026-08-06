       IDENTIFICATION DIVISION.
       PROGRAM-ID.    BRACCR.
       AUTHOR.        WRITTEN FOR THIS REPOSITORY IN PERIOD STYLE.
      *****************************************************************
      *  MONTHLY BRANCH ACCRUAL.  READS EVERY OPEN ACCOUNT IN THE      *
      *  BRANCH AND POSTS INTEREST.  BRANCH IS SUPPLIED ON THE PARM.   *
      *****************************************************************
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
           EXEC SQL INCLUDE SQLCA END-EXEC.
       01  WS-BRANCH               PIC X(8).
       01  WS-RATE                 PIC S9(1)V9(4) COMP-3 VALUE 0.0025.
       01  WS-COUNTS.
           05  WS-ROWS             PIC 9(7)    VALUE ZERO.
           05  WS-POSTED           PIC 9(7)    VALUE ZERO.
       01  WS-INTEREST             PIC S9(13)V99 COMP-3.
       01  WS-LEDGER-AREA.
           05  LG-OP               PIC X(6).
           05  LG-ACCT             PIC X(32).
           05  LG-AMT              PIC S9(13)V99 COMP-3.

           EXEC SQL BEGIN DECLARE SECTION END-EXEC.
       01  HV-BRANCH               PIC X(8).
       01  HV-ACCT-NO              PIC X(16).
       01  HV-BALANCE              PIC S9(13)V99 COMP-3.
       01  HV-STATUS               PIC X(8).
           EXEC SQL END DECLARE SECTION END-EXEC.

           EXEC SQL DECLARE ACCTCUR CURSOR FOR
               SELECT ACCOUNT_ID, BALANCE, STATUS
                 FROM ACCOUNT
                WHERE BRANCH_ID = :HV-BRANCH
                ORDER BY ACCOUNT_ID
           END-EXEC.

       LINKAGE SECTION.
       01  PARM-AREA.
           05  PARM-LEN            PIC S9(4) COMP.
           05  PARM-DATA           PIC X(8).

       PROCEDURE DIVISION USING PARM-AREA.
       0000-MAIN.
           MOVE PARM-DATA TO WS-BRANCH.
           MOVE WS-BRANCH TO HV-BRANCH.

           EXEC SQL OPEN ACCTCUR END-EXEC.

           PERFORM 2000-FETCH UNTIL SQLCODE = 100.

           EXEC SQL CLOSE ACCTCUR END-EXEC.
           EXEC SQL COMMIT END-EXEC.

           DISPLAY 'ROWS   ' WS-ROWS.
           DISPLAY 'POSTED ' WS-POSTED.
           GOBACK.

       2000-FETCH.
           EXEC SQL
               FETCH ACCTCUR INTO :HV-ACCT-NO, :HV-BALANCE, :HV-STATUS
           END-EXEC.
           IF SQLCODE = 100
               GO TO 2999-EXIT.
           ADD 1 TO WS-ROWS.
           IF HV-STATUS NOT = 'OPEN'
               GO TO 2999-EXIT.
           COMPUTE WS-INTEREST ROUNDED = HV-BALANCE * WS-RATE.
           MOVE 'CREDIT'      TO LG-OP.
           MOVE HV-ACCT-NO    TO LG-ACCT.
           MOVE WS-INTEREST   TO LG-AMT.
           CALL 'BANKLEDG' USING WS-LEDGER-AREA.
           ADD 1 TO WS-POSTED.
       2999-EXIT.
           EXIT.
