      ******************************************************************
      * DCLGEN TABLE(BANKDB.ACCOUNT)                                   *
      *        LIBRARY(BANKLANG.DCLGEN(ACCOUNT))                       *
      *        ACTION(REPLACE)                                         *
      *        LANGUAGE(COBOL)                                         *
      *        APOST                                                   *
      * ... IS THE DCLGEN COMMAND THAT MADE THE FOLLOWING STATEMENTS   *
      ******************************************************************
           EXEC SQL DECLARE BANKDB.ACCOUNT TABLE
           ( ACCOUNT_ID                     CHAR(16) NOT NULL,
             BRANCH_ID                      CHAR(8) NOT NULL,
             BALANCE                        DECIMAL(15, 2) NOT NULL,
             OVERDRAFT_LIMIT                DECIMAL(15, 2),
             STATUS                         CHAR(8) NOT NULL,
             CYCLE_DAY                      SMALLINT NOT NULL,
             POSTING_COUNT                  INTEGER NOT NULL,
             OPENED_ON                      DATE NOT NULL,
             LAST_POSTED                    TIMESTAMP
           ) END-EXEC.
      ******************************************************************
      * COBOL DECLARATION FOR TABLE BANKDB.ACCOUNT                     *
      ******************************************************************
       01  DCLACCOUNT.
           10 ACCOUNT-ID           PIC X(16).
           10 BRANCH-ID            PIC X(8).
           10 BALANCE              PIC S9(13)V9(2) USAGE COMP-3.
           10 OVERDRAFT-LIMIT      PIC S9(13)V9(2) USAGE COMP-3.
           10 STATUS               PIC X(8).
           10 CYCLE-DAY            PIC S9(4) USAGE COMP.
           10 POSTING-COUNT        PIC S9(9) USAGE COMP.
           10 OPENED-ON            PIC X(10).
           10 LAST-POSTED          PIC X(26).
      ******************************************************************
      * THE NUMBER OF COLUMNS DESCRIBED BY THIS DECLARATION IS 9       *
      ******************************************************************
