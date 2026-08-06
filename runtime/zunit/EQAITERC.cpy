      *> A stand-in for IBM's EQAITERC, for local compilation only.
      *>
      *> A generated zUnit test case declares its info block as
      *> `01 AZ-INFO-BLOCK. COPY EQAITERC.`, because that is what IBM's own
      *> generator writes and what resolves on z/OS from the IDz copybook
      *> library. Nothing in this repository has that copybook, so a local
      *> compile of the driver has nothing to resolve.
      *>
      *> This declares the two fields the generated driver names — and only
      *> those two, because the rest of the real layout is unknown and a made-up
      *> field would be a claim about a layout nobody here has seen.
      *>
      *> What compiling against it establishes is therefore narrow: that the
      *> driver's syntax is accepted and every name in it resolves. It says
      *> nothing about offsets, and the driver is never run locally. See
      *> `docs/integrations/zunit-integration.md` and divergence D20.
           05  ITER                 PIC 9(5) COMP-5.
           05  TC-WORK-AREA         PIC X(256).
