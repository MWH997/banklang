      *****************************************************************
      *  CUSTOMER MASTER RECORD.  WRITTEN FOR THIS REPOSITORY IN       *
      *  PERIOD STYLE.  VARIABLE LENGTH -- SEE CM-ADDR-COUNT.          *
      *****************************************************************
       01  CUSTOMER-RECORD.
           05  CM-CUST-NO              PIC X(10).
           05  CM-NAME                 PIC X(40).
           05  CM-KIND                 PIC X.
               88  CM-PERSONAL         VALUE 'P'.
               88  CM-CORPORATE        VALUE 'C'.
           05  CM-PARTY.
               10  CM-PERSON           PIC X(30).
               10  FILLER              PIC X(20).
           05  CM-COMPANY REDEFINES CM-PARTY.
               10  CM-REG-NO           PIC X(12).
               10  CM-TRADING-NAME     PIC X(38).
           05  CM-OPENED               PIC 9(8).
           05  CM-BALANCE              PIC S9(13)V99 COMP-3.
           05  CM-ADDR-COUNT           PIC 9(2).
           05  CM-ADDRESSES OCCURS 1 TO 5 TIMES
                   DEPENDING ON CM-ADDR-COUNT
                   INDEXED BY CM-ADDR-IX.
               10  CM-ADDR-LINE-1      PIC X(35).
               10  CM-ADDR-LINE-2      PIC X(35).
               10  CM-ADDR-POSTCODE    PIC X(8).
