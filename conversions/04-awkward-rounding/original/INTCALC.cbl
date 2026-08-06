       IDENTIFICATION DIVISION.
       PROGRAM-ID.    INTCALC.
       AUTHOR.        WRITTEN FOR THIS REPOSITORY IN PERIOD STYLE.
      *****************************************************************
      *  TIERED INTEREST CALCULATION.  THE HALF-PENNY GOES TO THE      *
      *  BANK ON A CREDIT AND TO THE CUSTOMER ON A DEBIT -- SEE THE    *
      *  1998 MEMO.  DO NOT CHANGE WITHOUT ASKING TREASURY.            *
      *****************************************************************
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-RATES.
           05  WS-TIER-1-RATE      PIC S9V9(4) COMP-3 VALUE 0.0125.
           05  WS-TIER-2-RATE      PIC S9V9(4) COMP-3 VALUE 0.0250.
           05  WS-TIER-3-RATE      PIC S9V9(4) COMP-3 VALUE 0.0375.
       01  WS-LIMITS.
           05  WS-TIER-1-CAP       PIC S9(13)V99 COMP-3 VALUE 100000.00.
           05  WS-TIER-2-CAP       PIC S9(13)V99 COMP-3 VALUE 500000.00.
       01  WS-WORK.
           05  WS-GROSS            PIC S9(13)V9(6) COMP-3.
           05  WS-TRUNC            PIC S9(13)V99 COMP-3.
           05  WS-EXCESS           PIC S9(13)V9(6) COMP-3.
           05  WS-PENNIES          PIC S9(15)   COMP-3.
           05  WS-HALF             PIC S9(1)V9(6) COMP-3 VALUE 0.005000.

       LINKAGE SECTION.
       01  LS-PARMS.
           05  LS-BALANCE          PIC S9(13)V99 COMP-3.
           05  LS-INTEREST         PIC S9(13)V99 COMP-3.

       PROCEDURE DIVISION USING LS-PARMS.
       0000-MAIN.
           IF LS-BALANCE <= WS-TIER-1-CAP
               COMPUTE WS-GROSS = LS-BALANCE * WS-TIER-1-RATE
           ELSE
               IF LS-BALANCE <= WS-TIER-2-CAP
                   COMPUTE WS-GROSS = LS-BALANCE * WS-TIER-2-RATE
               ELSE
                   COMPUTE WS-GROSS = LS-BALANCE * WS-TIER-3-RATE.

      *    BANKERS ROUNDING.  COBOL ROUNDED IS HALF UP, WHICH OVER A
      *    MILLION ACCOUNTS A MONTH IS NOT NOTHING, SO WE DO IT BY HAND.
           COMPUTE WS-TRUNC  = WS-GROSS.
           COMPUTE WS-EXCESS = WS-GROSS - WS-TRUNC.
           COMPUTE WS-PENNIES = WS-TRUNC * 100.

           IF WS-EXCESS > WS-HALF
               COMPUTE WS-TRUNC = WS-TRUNC + 0.01
           ELSE
               IF WS-EXCESS = WS-HALF
                   DIVIDE WS-PENNIES BY 2 GIVING WS-PENNIES
                       REMAINDER WS-PENNIES
                   IF WS-PENNIES NOT = 0
                       COMPUTE WS-TRUNC = WS-TRUNC + 0.01.

           MOVE WS-TRUNC TO LS-INTEREST.
           GOBACK.
