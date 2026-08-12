import { describe, expect, it } from "vitest";

import { compile } from "../packages/compiler/src/index";

/**
 * The monomorphiser, measured rather than assumed.
 *
 * `packages/typechecker/src/generics.ts` turns every generic declaration into
 * concrete COBOL: a mangled name per instantiation, a substituted copy of the
 * record or paragraph, and a deep clone of every node underneath it. The end-to-
 * end suite in `tests/generics-inheritance.test.ts` covers the shapes a program
 * usually has — a record over a currency, a function over two currencies — and
 * that left most of the file unmeasured. The 2026-08-10 mutation run scored it
 * at 45.10%, below the 60% floor `tools/mutation-floor.ts` enforces, with 47
 * mutants no test executed at all.
 *
 * What was unreached was not exotic: every type kind other than a currency or a
 * plain decimal, every statement kind other than `if` and `return`, and every
 * expression kind that owns a sub-expression. So this file walks those arms
 * deliberately.
 *
 * Two properties are worth stating, because they are what the arms are *for*:
 *
 * - **The mangled name is the identity of an instantiation.** Two type
 *   arguments that generate different storage must produce different names, or
 *   one instantiation silently overwrites the other. That is why the name
 *   encodes usage and width and not just the base type.
 * - **Nothing may be shared between two instantiations.** `cloneStatement` and
 *   `cloneExpression` exist because a call expression is matched by node
 *   identity when it is rewritten to its instantiated target, so one shared
 *   node makes the second instantiation overwrite the first one's target.
 */

const PREAMBLE = `module Generic;

type BDT = currency<"BDT", 18, 2>;
type Count = decimal<9, 0>;
`;

/** A generic record instantiated at one type argument, and the names it made. */
function slotNames(typeArgument: string): {
  diagnostics: string[];
  names: string[];
} {
  const result = compile(`${PREAMBLE}
record Slot<T> {
  value: T;
}

record Holder {
  slot: Slot<${typeArgument}>;
  idempotencyKey: string<36>;
}

transaction touch(holder: Holder) {
  audit("TOUCHED", holder.idempotencyKey);
}`);

  return {
    diagnostics: result.diagnostics.map((entry) => entry.id),
    names: (result.program?.records ?? [])
      .map((record) => record.name)
      .filter((name) => name.startsWith("Slot$")),
  };
}

describe("the name a type argument mangles to", () => {
  /**
   * One case per arm of `describeTypeNode`.
   *
   * A table rather than one assertion per kind: the property is that each kind
   * produces *its own* encoding, and a table makes a mutant that collapses two
   * arms into one fail on the arm it broke rather than passing because some
   * other assertion happened to cover it.
   */
  const encodings: [label: string, typeArgument: string, mangled: string][] = [
    ["a bool", "bool", "Slot$bool"],
    ["a date", "date", "Slot$date"],
    ["a time", "time", "Slot$time"],
    ["a timestamp", "timestamp", "Slot$timestamp"],
    ["a string", "string<8>", "Slot$str8"],
    ["a nullable", "nullable<BDT>", "Slot$optcurBDT18_2"],
    ["a bounded array", "Count[4]", "Slot$arr4_dec9_0"],
    ["a currency", "BDT", "Slot$curBDT18_2"],
  ];

  for (const [label, typeArgument, mangled] of encodings) {
    it(`encodes ${label} as ${mangled}`, () => {
      const { diagnostics, names } = slotNames(typeArgument);
      expect(diagnostics).toEqual([]);
      expect(names).toEqual([mangled]);
    });
  }

  /**
   * Usage is part of the identity, not a detail of it.
   *
   * `binary<9>`, `zoned<9, 2>` and `unsigned<9, 0>` are all decimals to the type
   * system and three different `PIC` clauses in the generated COBOL. If the
   * mangled name ignored usage, `Slot<binary<9>>` and `Slot<zoned<9, 0>>` would
   * resolve to one record and one of the two programs would read the wrong
   * storage.
   */
  const usages: [typeArgument: string, mangled: string][] = [
    ["binary<9>", "Slot$bin9_0"],
    ["zoned<9, 2>", "Slot$zon9_2"],
    ["unsigned<9, 0>", "Slot$uns9_0"],
    ["decimal<9, 0>", "Slot$dec9_0"],
  ];

  for (const [typeArgument, mangled] of usages) {
    it(`distinguishes ${typeArgument} as ${mangled}`, () => {
      const { diagnostics, names } = slotNames(typeArgument);
      expect(diagnostics).toEqual([]);
      expect(names).toEqual([mangled]);
    });
  }

  /** Every usage above has to be distinct, which the table alone does not say. */
  it("gives the four decimal usages four different names", () => {
    const mangled = usages.map(([, name]) => name);
    expect(new Set(mangled).size).toBe(mangled.length);
  });

  /**
   * A type argument that is itself an instantiation nests, rather than
   * flattening to the base name — `Slot<Slot<BDT>>` is a distinct layout from
   * `Slot<BDT>` and must not collide with it.
   */
  it("nests an instantiation inside a mangled name", () => {
    const { diagnostics, names } = slotNames("Slot<BDT>");
    expect(diagnostics).toEqual([]);
    expect(names).toEqual(
      expect.arrayContaining(["Slot$curBDT18_2", "Slot$Slot$curBDT18_2"]),
    );
  });

  /**
   * An edited type has no encoding here, and must not be asked for one.
   *
   * `typeToTypeNode` refuses to rebuild an edited type as a type argument —
   * correctly, since it renders a value rather than being one and names no
   * storage. What was wrong was the silence: the argument could not be
   * normalised, `instantiateGenericRecord` returned null, and the field was
   * dropped from the record. `Slot<edited<BDT, "credit">>` compiled with no
   * diagnostic and generated no COBOL for the field, while the same edited type
   * written on a plain field works — so the author had every reason to believe
   * it had worked here too.
   */
  it("refuses an edited type as a type argument", () => {
    const { diagnostics, names } = slotNames(`edited<BDT, "credit">`);
    expect(diagnostics).toEqual(["BANK-TYPE-031"]);
    expect(names).toEqual([]);
  });

  /** The same type on an ordinary field is fine, which is why the silence hurt. */
  it("still allows an edited type on a plain field", () => {
    const result = compile(`${PREAMBLE}
record Holder {
  amount: BDT;
  shown: edited<BDT, "credit">;
  idempotencyKey: string<36>;
}

transaction touch(holder: Holder) {
  audit("TOUCHED", holder.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const fields = (result.program?.records ?? []).find(
      (record) => record.name === "Holder",
    )?.fields;
    expect(fields?.map((field) => field.name)).toContain("shown");
  });

  /**
   * A reference with no type arguments contributes its bare name.
   *
   * This is the arm that returns early rather than appending a `$` suffix, and
   * a mutant that inverts it produces `Account$` — a name that is still unique,
   * so nothing but reading the name catches it.
   */
  it("uses a plain record name with no suffix", () => {
    const result = compile(`${PREAMBLE}
record Account {
  balance: BDT;
}

record Slot<T> {
  value: T;
}

record Holder {
  slot: Slot<Account>;
  idempotencyKey: string<36>;
}

transaction touch(holder: Holder) {
  audit("TOUCHED", holder.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const names = (result.program?.records ?? []).map((record) => record.name);
    expect(names).toContain("Slot$Account");
  });
});

describe("substituting a type parameter into a field type", () => {
  /**
   * The parameter is reached wherever it is written, not only at the top level.
   *
   * `substituteType` recurses through the types that own another type. A mutant
   * that stops the recursion leaves `T` in the instantiated record, which the
   * resolver then reports as an unknown type — so the diagnostics being empty
   * is the assertion that the rewrite went all the way down.
   */
  const NESTED = `${PREAMBLE}
record Inner<T> {
  value: T;
}

record Wrap<T> {
  maybe: nullable<T>;
  many: T[4];
  nested: Inner<T>;
  direct: T;
}

record Holder {
  money: Wrap<BDT>;
  idempotencyKey: string<36>;
}

transaction touch(holder: Holder) {
  audit("TOUCHED", holder.idempotencyKey);
}`;

  it("rewrites the parameter under a nullable, an array and a reference", () => {
    const result = compile(NESTED);
    expect(result.diagnostics).toEqual([]);
    const names = (result.program?.records ?? []).map((record) => record.name);
    expect(names).toContain("Wrap$curBDT18_2");
    expect(names).toContain("Inner$curBDT18_2");
  });

  /**
   * The substituted field types reach the COBOL, which is the point of doing
   * any of this: `PIC S9(16)V99 COMP-3` four times over is the array of `T`.
   */
  it("emits the substituted storage rather than the parameter", () => {
    const result = compile(NESTED);
    const cobol = result.cobol ?? "";
    expect(cobol).toContain("OCCURS 4");
    expect(cobol).not.toContain(" T.");
  });

  /**
   * A type argument list on the parameter's own use site is preserved.
   *
   * `Inner<T>` inside `Wrap<T>` is a reference *with* arguments, so it takes the
   * arm that rewrites the arguments rather than the arm that replaces the whole
   * node. Instantiating `Wrap` at two types must therefore produce two `Inner`
   * instantiations, not one shared one.
   */
  it("instantiates the inner generic once per outer instantiation", () => {
    const result = compile(`${PREAMBLE}
record Inner<T> {
  value: T;
}

record Wrap<T> {
  nested: Inner<T>;
}

record Holder {
  money: Wrap<BDT>;
  count: Wrap<Count>;
  idempotencyKey: string<36>;
}

transaction touch(holder: Holder) {
  audit("TOUCHED", holder.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const names = (result.program?.records ?? []).map((record) => record.name);
    expect(names).toContain("Inner$curBDT18_2");
    expect(names).toContain("Inner$dec9_0");
  });
});

/**
 * A generic function whose body uses every statement and expression kind that
 * `substituteStatement`, `cloneStatement` and `cloneExpression` can be handed.
 *
 * One program rather than one per construct: the clone walk runs over the whole
 * body, so a mutant in any arm has to survive an instantiation of all of it.
 */
const WALKED_BODY = `${PREAMBLE}
enum Kind {
  ONE,
  TWO
}

record Bucket {
  total: BDT;
  rates: Count[4];
  flag: bool;
  maybe: nullable<BDT>;
}

function walk<T>(seed: T, bucket: Bucket): T {
  let local: T = seed;
  let n: Count = 0;
  let kind: Kind = Kind.ONE;
  n = bucket.rates[1];
  bucket.total = round(bucket.total * 2, "FLOOR");
  bucket.total = divide(bucket.total, 2, "FLOOR");
  log("WALKED");
  while n > 0 limit 10 {
    n = n - 1;
  }
  for each rate in bucket.rates {
    log("RATE");
  }
  switch kind {
    case ONE {
      log("ONE");
    }
    else {
      log("OTHER");
    }
  }
  if !bucket.flag {
    return local;
  } else {
    if isPresent(bucket.maybe) {
      return seed;
    } else {
      return local;
    }
  }
}
`;

describe("instantiating a generic function body", () => {
  const TWO_INSTANTIATIONS = `${WALKED_BODY}
transaction pick(a: BDT, c: Count, bucket: Bucket, idempotencyKey: string<36>) {
  let viaMoney: BDT = walk(a, bucket);
  let viaCount: Count = walk(c, bucket);
  debit("SOURCE", viaMoney);
  credit("TARGET", viaMoney);
  audit("PICKED", idempotencyKey);
}`;

  it("walks a body holding every statement kind without complaint", () => {
    const result = compile(TWO_INSTANTIATIONS);
    expect(result.diagnostics).toEqual([]);
  });

  /**
   * Two instantiations, two paragraphs.
   *
   * This is the property the deep clone protects. If a statement or expression
   * node were shared, the second instantiation would rewrite the first one's
   * call target and one of these paragraphs would be missing or wrong.
   */
  it("emits one paragraph per instantiation", () => {
    const result = compile(TWO_INSTANTIATIONS);
    const cobol = result.cobol ?? "";
    expect(cobol).toContain("WALK-CUR-BDT-18-2");
    expect(cobol).toContain("WALK-DEC-9-0");
  });

  /**
   * The annotation on a `let` is substituted, not copied.
   *
   * `let local: T` is the only place a type parameter can appear inside a body,
   * so a mutant that skips the `LetStatement` arm leaves `T` unresolved there
   * and nowhere else.
   */
  it("substitutes the type annotation on a let", () => {
    const result = compile(TWO_INSTANTIATIONS);
    expect(result.diagnostics).toEqual([]);
    const cobol = result.cobol ?? "";
    expect(cobol).not.toMatch(/\bLOCAL\b.*\bT\b/);
  });

  /**
   * The body is walked for each instantiation independently.
   *
   * Both paragraphs must carry the full body: the loop, the table subscript and
   * the rounding all have to appear twice, once under each instantiated name.
   */
  it("copies the whole body into both instantiations", () => {
    const result = compile(TWO_INSTANTIATIONS);
    const cobol = result.cobol ?? "";
    const walked = [...cobol.matchAll(/WALKED/g)];
    expect(walked.length).toBeGreaterThanOrEqual(2);
    const rates = [...cobol.matchAll(/RATE/g)];
    expect(rates.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * An instantiation is not itself generic.
   *
   * `instantiateRecord` and `instantiateFunction` both clear `typeParameters`,
   * and a copy that kept them would be re-instantiated or reported as a generic
   * that is never called. Asking for the same instantiation twice is what makes
   * that observable: it must resolve to the single paragraph already generated.
   */
  it("does not re-instantiate an instantiation asked for twice", () => {
    const result = compile(`${WALKED_BODY}
transaction pick(a: BDT, b: BDT, bucket: Bucket, idempotencyKey: string<36>) {
  let first: BDT = walk(a, bucket);
  let second: BDT = walk(b, bucket);
  debit("SOURCE", second);
  credit("TARGET", second);
  audit("PICKED", idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const cobol = result.cobol ?? "";
    const paragraphs = [...cobol.matchAll(/^\s*WALK-CUR-BDT-18-2\s*\.\s*$/gm)];
    expect(paragraphs).toHaveLength(1);
  });

  /**
   * And a generic record instantiated twice is one record, for the same reason:
   * two copies of the storage under one name is a redefinition, and two copies
   * under two names is storage nobody asked for.
   */
  it("shares one record between two identical instantiations", () => {
    const result = compile(`${PREAMBLE}
record Slot<T> {
  value: T;
}

record Holder {
  first: Slot<BDT>;
  second: Slot<BDT>;
  idempotencyKey: string<36>;
}

transaction touch(holder: Holder) {
  audit("TOUCHED", holder.idempotencyKey);
}`);

    expect(result.diagnostics).toEqual([]);
    const slots = (result.program?.records ?? []).filter((record) =>
      record.name.startsWith("Slot$"),
    );
    expect(slots).toHaveLength(1);
  });
});
