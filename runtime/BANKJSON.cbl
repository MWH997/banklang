      *> Stand-in for the JSON PARSE statement.
      *>
      *> Enterprise COBOL implements JSON PARSE. GnuCOBOL 3.2.0 compiles
      *> it, warns that it is not implemented, and then does nothing at
      *> run time: the record is left untouched and no exception is
      *> raised, so a program reading a payload runs clean and processes
      *> an empty record. That is the worst shape a divergence can take,
      *> because every local signal says the program worked.
      *>
      *> The precompiler in packages/precompiler rewrites each `JSON
      *> PARSE <text> INTO <record>` into one call per elementary item
      *> of the record, naming the item. This program looks that name up
      *> in the document and hands back the value it found. What ships
      *> to z/OS keeps its JSON PARSE; this exists so the local build
      *> can run one.
      *>
      *> Matching follows Enterprise COBOL's rule closely enough to be
      *> worth executing: names are compared without regard to case, and
      *> a hyphen in the COBOL name matches a hyphen or an underscore in
      *> the JSON name. It is not a JSON parser. It scans for a quoted
      *> name at the top level of the document and reads the scalar
      *> after the colon; nesting, arrays, and escape sequences are past
      *> what a stub should pretend to.
      *>
      *> What running against this proves: the record is populated from
      *> the document, the fields land where the layout says, and the
      *> JSON-STATUS test the compiler emits is reached with a value it
      *> did not invent. What it does not prove: any Enterprise COBOL
      *> behaviour. IBM's parser is a real one and this is a scan.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. BANKJSON.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-POS               PIC S9(9) COMP-5 VALUE 0.
       01  WS-START             PIC S9(9) COMP-5 VALUE 0.
       01  WS-END               PIC S9(9) COMP-5 VALUE 0.
       01  WS-WANTED            PIC X(30)  VALUE SPACES.
       01  WS-SEEN              PIC X(30)  VALUE SPACES.
       01  WS-CHAR              PIC X      VALUE SPACE.
       01  WS-DONE              PIC X      VALUE "N".
       01  WS-INDEX             PIC S9(9) COMP-5 VALUE 0.

       LINKAGE SECTION.
      *> The document, its length, the item being asked for, the value
      *> found, and whether it was there at all. The length is passed
      *> because a called program cannot see how wide its caller's field
      *> is.
       01  LK-DOC               PIC X(32000).
       01  LK-DOC-LEN           PIC S9(9) COMP-5.
       01  LK-NAME              PIC X(30).
       01  LK-VALUE             PIC X(256).
       01  LK-FOUND             PIC X.

       PROCEDURE DIVISION USING LK-DOC, LK-DOC-LEN, LK-NAME, LK-VALUE,
           LK-FOUND.
           MOVE SPACES TO LK-VALUE
           MOVE "N" TO LK-FOUND

      *> An empty or blank document is the exception condition the
      *> caller reports through JSON-CODE, and there is nothing here to
      *> search.
           IF LK-DOC-LEN < 1
               GOBACK
           END-IF

           MOVE FUNCTION UPPER-CASE(LK-NAME) TO WS-WANTED
           INSPECT WS-WANTED REPLACING ALL "_" BY "-"

           MOVE 1 TO WS-POS
           MOVE "N" TO WS-DONE
           PERFORM UNTIL WS-DONE = "Y" OR WS-POS > LK-DOC-LEN
               MOVE LK-DOC(WS-POS:1) TO WS-CHAR
               IF WS-CHAR = QUOTE OR WS-CHAR = "'"
                   PERFORM READ-ONE-NAME
               ELSE
                   ADD 1 TO WS-POS
               END-IF
           END-PERFORM
           GOBACK.

      *> A quoted run followed by a colon is a name. Anything else
      *> quoted is a value, and is stepped over so its contents cannot
      *> be read as a name.
       READ-ONE-NAME.
           ADD 1 TO WS-POS
           MOVE WS-POS TO WS-START
           PERFORM UNTIL WS-POS > LK-DOC-LEN
               OR LK-DOC(WS-POS:1) = WS-CHAR
               ADD 1 TO WS-POS
           END-PERFORM
           MOVE WS-POS TO WS-END
           ADD 1 TO WS-POS
           IF WS-END <= WS-START
               EXIT PARAGRAPH
           END-IF

           MOVE SPACES TO WS-SEEN
           COMPUTE WS-INDEX = WS-END - WS-START
           IF WS-INDEX > 30
               MOVE 30 TO WS-INDEX
           END-IF
           MOVE LK-DOC(WS-START:WS-INDEX) TO WS-SEEN
           MOVE FUNCTION UPPER-CASE(WS-SEEN) TO WS-SEEN
           INSPECT WS-SEEN REPLACING ALL "_" BY "-"

      *> Skip to the colon, if this quoted run is a name at all.
           PERFORM UNTIL WS-POS > LK-DOC-LEN
               OR LK-DOC(WS-POS:1) NOT = SPACE
               ADD 1 TO WS-POS
           END-PERFORM
           IF WS-POS > LK-DOC-LEN OR LK-DOC(WS-POS:1) NOT = ":"
               EXIT PARAGRAPH
           END-IF
           ADD 1 TO WS-POS

           IF WS-SEEN = WS-WANTED
               PERFORM READ-ONE-VALUE
               MOVE "Y" TO LK-FOUND
               MOVE "Y" TO WS-DONE
           END-IF.

      *> The scalar after the colon: a quoted string without its quotes,
      *> or a run of characters up to the comma or brace that ends it.
       READ-ONE-VALUE.
           PERFORM UNTIL WS-POS > LK-DOC-LEN
               OR LK-DOC(WS-POS:1) NOT = SPACE
               ADD 1 TO WS-POS
           END-PERFORM
           IF WS-POS > LK-DOC-LEN
               EXIT PARAGRAPH
           END-IF

           IF LK-DOC(WS-POS:1) = QUOTE OR LK-DOC(WS-POS:1) = "'"
               MOVE LK-DOC(WS-POS:1) TO WS-CHAR
               ADD 1 TO WS-POS
               MOVE WS-POS TO WS-START
               PERFORM UNTIL WS-POS > LK-DOC-LEN
                   OR LK-DOC(WS-POS:1) = WS-CHAR
                   ADD 1 TO WS-POS
               END-PERFORM
           ELSE
               MOVE WS-POS TO WS-START
               PERFORM UNTIL WS-POS > LK-DOC-LEN
                   OR LK-DOC(WS-POS:1) = ","
                   OR LK-DOC(WS-POS:1) = "}"
                   OR LK-DOC(WS-POS:1) = "]"
                   ADD 1 TO WS-POS
               END-PERFORM
           END-IF

           COMPUTE WS-INDEX = WS-POS - WS-START
           IF WS-INDEX < 1
               EXIT PARAGRAPH
           END-IF
           IF WS-INDEX > 256
               MOVE 256 TO WS-INDEX
           END-IF
           MOVE LK-DOC(WS-START:WS-INDEX) TO LK-VALUE.

       END PROGRAM BANKJSON.
