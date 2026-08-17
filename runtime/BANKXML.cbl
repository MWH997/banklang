      *> Stand-in for the XML PARSE statement.
      *>
      *> Enterprise COBOL implements XML PARSE. GnuCOBOL 3.2.0 compiles
      *> it, warns that it is not implemented, and does nothing at run
      *> time, so the handler section the compiler generated is never
      *> entered, no exception is raised, and the record keeps whatever
      *> it held. Every local signal says the program worked.
      *>
      *> XML PARSE is event-driven: the statement calls a procedure once
      *> per event, with the event name in XML-EVENT and the text of it
      *> in XML-TEXT. A subprogram cannot PERFORM a section in its
      *> caller, so the loop belongs to the caller and this program is
      *> one step of it: given a position in the document it finds the
      *> next event, describes it, and moves the position past it. The
      *> precompiler in packages/precompiler writes that loop. What
      *> ships to z/OS keeps its XML PARSE.
      *>
      *> The registers cannot be used locally either. GnuCOBOL 3.2
      *> reserves XML-EVENT, XML-TEXT and XML-INFORMATION as special
      *> registers, but XML-TEXT is a zero-length one that only a real
      *> XML PARSE sets, so a MOVE to it ends the run with a
      *> segmentation fault. The precompiler therefore points the
      *> generated handler at fields of its own, which is the same
      *> substitution it makes for EXEC SQL and EXEC CICS.
      *>
      *> Events reported: START-OF-ELEMENT, CONTENT-CHARACTERS,
      *> END-OF-ELEMENT. A real parser reports many more, and a
      *> generated handler ignores any it was not written for, so the
      *> shorter list changes nothing about the branches taken. Content
      *> is returned whole, with XML-INFORMATION set to 1, because a
      *> scan has no reason to break a value across events; the handler
      *> still accumulates, so it behaves the same when IBM's parser
      *> does break one.
      *>
      *> This is not an XML parser. Attributes, namespaces, entity
      *> references, CDATA and encoding declarations are past what a
      *> stub should pretend to. What running against it proves is that
      *> the handler is reached, that its EVALUATE selects the branch
      *> the document asks for, and that the record is populated from
      *> the text, and nothing about z/OS.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. BANKXML.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-START             PIC S9(9) COMP-5 VALUE 0.
       01  WS-LEN               PIC S9(9) COMP-5 VALUE 0.
       01  WS-CLOSING           PIC X      VALUE "N".

       LINKAGE SECTION.
       01  LK-DOC               PIC X(32000).
       01  LK-DOC-LEN           PIC S9(9) COMP-5.
      *> Where the next event starts. The caller sets it to 1 and this
      *> program moves it on, so the loop needs no state of its own.
       01  LK-POS               PIC S9(9) COMP-5.
       01  LK-EVENT             PIC X(30).
       01  LK-TEXT              PIC X(1024).
       01  LK-TEXT-LEN          PIC S9(9) COMP-5.
       01  LK-INFO              PIC S9(9) COMP-5.
      *> "Y" once the document is exhausted, which ends the caller's
      *> loop.
       01  LK-END               PIC X.

       PROCEDURE DIVISION USING LK-DOC, LK-DOC-LEN, LK-POS, LK-EVENT,
           LK-TEXT, LK-TEXT-LEN, LK-INFO, LK-END.
           MOVE SPACES TO LK-EVENT
           MOVE SPACES TO LK-TEXT
           MOVE 0 TO LK-TEXT-LEN
           MOVE 1 TO LK-INFO
           MOVE "N" TO LK-END

           IF LK-POS < 1
               MOVE 1 TO LK-POS
           END-IF
           IF LK-POS > LK-DOC-LEN
               MOVE "Y" TO LK-END
               GOBACK
           END-IF

           IF LK-DOC(LK-POS:1) = "<"
               PERFORM READ-TAG
           ELSE
               PERFORM READ-CONTENT
           END-IF

      *> A call can produce no event and still not be the end: an XML
      *> declaration or a comment is stepped over, and the whitespace
      *> between two elements is not a value. Both paragraphs always
      *> move the position on, so the caller's loop makes progress and
      *> reaches the end anyway. Reporting those as the end is what made
      *> a document beginning `<?xml ... ?>` look empty.
           GOBACK.

      *> `<name ...>` opens an element and `</name>` closes one. A
      *> declaration or a comment is stepped over rather than reported:
      *> a handler has no branch for either, so reporting them would
      *> only add empty passes.
       READ-TAG.
           ADD 1 TO LK-POS
           MOVE "N" TO WS-CLOSING
           IF LK-POS <= LK-DOC-LEN AND LK-DOC(LK-POS:1) = "/"
               MOVE "Y" TO WS-CLOSING
               ADD 1 TO LK-POS
           END-IF

           MOVE LK-POS TO WS-START
      *> The name ends at the first space, slash or closing bracket.
           PERFORM UNTIL LK-POS > LK-DOC-LEN
               OR LK-DOC(LK-POS:1) = ">"
               OR LK-DOC(LK-POS:1) = " "
               OR LK-DOC(LK-POS:1) = "/"
               ADD 1 TO LK-POS
           END-PERFORM
           COMPUTE WS-LEN = LK-POS - WS-START

      *> Past the rest of the tag, whatever it held.
           PERFORM UNTIL LK-POS > LK-DOC-LEN
               OR LK-DOC(LK-POS:1) = ">"
               ADD 1 TO LK-POS
           END-PERFORM
           ADD 1 TO LK-POS

           IF WS-LEN < 1
               EXIT PARAGRAPH
           END-IF
           IF WS-LEN > 1024
               MOVE 1024 TO WS-LEN
           END-IF
      *> `<?xml ...?>` and `<!-- ... -->` open with a character no
      *> element name may start with, which is how they are told apart
      *> without parsing them.
           IF LK-DOC(WS-START:1) = "?" OR LK-DOC(WS-START:1) = "!"
               EXIT PARAGRAPH
           END-IF

           MOVE LK-DOC(WS-START:WS-LEN) TO LK-TEXT
           MOVE WS-LEN TO LK-TEXT-LEN
           IF WS-CLOSING = "Y"
               MOVE "END-OF-ELEMENT" TO LK-EVENT
           ELSE
               MOVE "START-OF-ELEMENT" TO LK-EVENT
           END-IF.

      *> Everything up to the next tag is one content event. A run that
      *> is all spaces is the whitespace between elements rather than a
      *> value, and is skipped: reporting it would clear the buffer of
      *> the value just read.
       READ-CONTENT.
           MOVE LK-POS TO WS-START
           PERFORM UNTIL LK-POS > LK-DOC-LEN
               OR LK-DOC(LK-POS:1) = "<"
               ADD 1 TO LK-POS
           END-PERFORM
           COMPUTE WS-LEN = LK-POS - WS-START

           IF WS-LEN < 1
               EXIT PARAGRAPH
           END-IF
           IF WS-LEN > 1024
               MOVE 1024 TO WS-LEN
           END-IF
           IF LK-DOC(WS-START:WS-LEN) = SPACES
               EXIT PARAGRAPH
           END-IF

           MOVE LK-DOC(WS-START:WS-LEN) TO LK-TEXT
           MOVE WS-LEN TO LK-TEXT-LEN
           MOVE "CONTENT-CHARACTERS" TO LK-EVENT.

       END PROGRAM BANKXML.
