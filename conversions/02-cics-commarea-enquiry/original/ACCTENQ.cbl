       IDENTIFICATION DIVISION.
       PROGRAM-ID.    ACCTENQ.
       AUTHOR.        WRITTEN FOR THIS REPOSITORY IN PERIOD STYLE.
      *****************************************************************
      *  CICS ACCOUNT ENQUIRY.  CALLED WITH A COMMAREA HOLDING THE     *
      *  ACCOUNT NUMBER;  RETURNS THE BALANCE AND A STATUS CODE.       *
      *****************************************************************
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-RESP                 PIC S9(8) COMP.
           EXEC SQL INCLUDE SQLCA END-EXEC.
       01  WS-HOST-VARS.
           05  HV-ACCT-NO          PIC X(16).
           05  HV-BALANCE          PIC S9(13)V99 COMP-3.
           05  HV-STATUS           PIC X.

       LINKAGE SECTION.
       01  DFHCOMMAREA.
           05  CA-ACCT-NO          PIC X(16).
           05  CA-BALANCE          PIC S9(13)V99 COMP-3.
           05  CA-RETURN-CODE      PIC X(2).

       PROCEDURE DIVISION.
       0000-MAIN.
           IF EIBCALEN = 0
               EXEC CICS ABEND ABCODE('NOCA') END-EXEC.

           MOVE CA-ACCT-NO TO HV-ACCT-NO.

           EXEC SQL
               SELECT BALANCE, STATUS
                 INTO :HV-BALANCE, :HV-STATUS
                 FROM ACCOUNT
                WHERE ACCOUNT_ID = :HV-ACCT-NO
           END-EXEC.

           IF SQLCODE = 0
               MOVE HV-BALANCE TO CA-BALANCE
               MOVE '00'       TO CA-RETURN-CODE
           ELSE
               MOVE ZERO       TO CA-BALANCE
               MOVE '01'       TO CA-RETURN-CODE.

           EXEC CICS WRITEQ TD
               QUEUE('CSMT')
               FROM(CA-ACCT-NO)
               LENGTH(16)
               RESP(WS-RESP)
           END-EXEC.

           IF WS-RESP NOT = 0
               MOVE '02' TO CA-RETURN-CODE.

           EXEC CICS RETURN END-EXEC.
