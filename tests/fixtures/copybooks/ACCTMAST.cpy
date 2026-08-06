      *****************************************************************
      * ACCOUNT MASTER RECORD                                         *
      * WRITTEN BY HAND, IN THE SHAPE A COPYBOOK ON AN ESTATE IS:     *
      * BANNER COMMENTS, TWO-DIGIT REPEAT COUNTS, LEVEL-88 CONDITION  *
      * NAMES, A GROUP INSIDE A GROUP, AND A TABLE.                   *
      *****************************************************************
       01  ACCOUNT-MASTER.
           05  ACCT-KEY.
               10  ACCT-BRANCH        PIC X(04).
               10  ACCT-NUMBER        PIC X(12).
           05  ACCT-NAME              PIC X(30).
           05  ACCT-BALANCE           PIC S9(13)V99 COMP-3.
           05  ACCT-MINIMUM           PIC S9(13)V99 COMP-3.
           05  ACCT-OPEN-DATE         PIC 9(08).
           05  ACCT-STATUS            PIC X(01).
               88  ACCT-OPEN                    VALUE 'O'.
               88  ACCT-CLOSED                  VALUE 'C'.
               88  ACCT-DORMANT                 VALUE 'D'.
           05  ACCT-CYCLE             PIC S9(04) COMP.
           05  ACCT-RATE              PIC S9(01)V9(04) COMP-3.
           05  ACCT-HISTORY OCCURS 12 TIMES.
               10  HIST-AMOUNT        PIC S9(11)V99 COMP-3.
               10  HIST-DATE          PIC 9(08).
           05  ACCT-RELATIONSHIP      PIC X(20).
