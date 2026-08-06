/**
 * A DCLGEN member read into a BankTS record.
 *
 * DCLGEN is Db2's own declarations generator: given a table it writes an
 * `EXEC SQL DECLARE ... TABLE` block naming every column with its SQL type and
 * whether it may be null, and a COBOL host structure to match. Shops keep the
 * members in a library and `INCLUDE` them, so a DCLGEN is the closest thing a
 * Db2 estate has to a schema anybody agrees on.
 *
 * Reading one gives two things a copybook cannot. The SQL type is the column's
 * real type rather than a guess from a picture — `DATE` is a date and not ten
 * characters that happen to look like one. And `NOT NULL` is stated, so a
 * column that may be null becomes `nullable<T>` and the compiler makes the
 * program check before reading it, which is the defect `BANK-TYPE-008` exists
 * for.
 *
 * What makes it checkable rather than a translation table somebody typed: the
 * member carries DCLGEN's own COBOL declaration for the same columns. Every
 * type this reads is turned back into a picture and compared against the one
 * IBM's tool wrote. A disagreement is this compiler being wrong about Db2, and
 * it is reported rather than imported.
 *
 * The mapping is Table 109 of the Application Programming and SQL Guide,
 * "COBOL host variable equivalents that you can use when retrieving data of a
 * particular SQL data type".
 */

import { copybookLines } from "./index";
import {
  bankTsName,
  bankTsRecordName,
  type CopybookImportProblem,
} from "./import";

export interface DclgenColumn {
  /** Column name as Db2 has it. */
  column: string;
  /** SQL type as the DECLARE TABLE block writes it. */
  sqlType: string;
  /** True when the column may hold a null. */
  nullable: boolean;
  /** BankTS type, or the empty string when there is no spelling for it. */
  bankTsType: string;
  /** Why there is no spelling, when there is not. */
  problem?: string;
}

export interface DclgenImport {
  /** Table the member declares. */
  table: string;
  /** BankTS record source, ready to paste into a module. */
  source: string;
  recordName: string;
  columns: DclgenColumn[];
  problems: CopybookImportProblem[];
}

/**
 * One SQL type, in the terms BankTS has words for.
 *
 * Each entry is Table 109's row for that type. Where the table's equivalent is
 * a form BankTS has no declaration for — a varying-length string, a graphic
 * string, floating point — the column is reported rather than approximated: a
 * host variable of the wrong shape is one Db2 refuses at bind time if you are
 * lucky and fills with something else if you are not.
 */
export function bankTsTypeForSql(sqlType: string): {
  text: string;
  problem?: string;
} {
  const type = sqlType.toUpperCase().replace(/\s+/g, " ").trim();

  if (/^SMALLINT$/.test(type)) {
    return { text: "binary<4>" };
  }
  if (/^INT(EGER)?$/.test(type)) {
    return { text: "binary<9>" };
  }
  if (/^BIGINT$/.test(type)) {
    return { text: "binary<18>" };
  }

  const decimal = /^(?:DECIMAL|NUMERIC|DEC)\s*\((\d+)(?:\s*,\s*(\d+))?\)$/.exec(
    type,
  );
  if (decimal) {
    const precision = Number(decimal[1]);
    const scale = Number(decimal[2] ?? 0);
    if (precision > 18) {
      return {
        text: "",
        problem: `DECIMAL(${precision},${scale}) has more digits than ARITH(COMPAT) allows. Db2 permits 31; the program is compiled at 18.`,
      };
    }
    return { text: `decimal<${precision}, ${scale}>` };
  }

  const char = /^CHAR(?:ACTER)?\s*\((\d+)\)$/.exec(type);
  if (char) {
    return { text: `string<${char[1]}>` };
  }
  if (/^CHAR(?:ACTER)?$/.test(type)) {
    return { text: "string<1>" };
  }

  if (/^VARCHAR/.test(type) || /^VARGRAPHIC/.test(type)) {
    return {
      text: "",
      problem:
        "A varying-length string is a group of two level-49 items, a halfword length and the text. BankTS has no declaration for one, so the column has to be read into a CHAR host variable or handled by hand.",
    };
  }
  if (/^GRAPHIC/.test(type)) {
    return {
      text: "",
      problem:
        "A graphic string is `PIC G(n) USAGE DISPLAY-1`, which BankTS's `national` is not — national is USAGE NATIONAL.",
    };
  }
  if (/^(?:REAL|DOUBLE|FLOAT|DECFLOAT)/.test(type)) {
    return {
      text: "",
      problem:
        "Floating point. A bank's arithmetic is decimal, and BankTS has no floating-point type.",
    };
  }
  if (/^(?:VAR)?BINARY/.test(type)) {
    return {
      text: "",
      problem:
        "A binary string is declared with `SQL TYPE IS`, which the precompiler expands and BankTS does not write.",
    };
  }

  // Db2 hands a date, a time and a timestamp to COBOL as fixed-length
  // character strings, in the lengths the table gives: at least 10 for a date,
  // at least 8 to include a time's seconds, and 26 for a timestamp with
  // microseconds.
  if (/^DATE$/.test(type)) {
    return { text: "string<10>" };
  }
  if (/^TIME$/.test(type)) {
    return { text: "string<8>" };
  }
  if (/^TIMESTAMP(?:\s*\(\d+\))?$/.test(type)) {
    return { text: "timestamp" };
  }

  return { text: "", problem: `No BankTS type for the SQL type ${sqlType}.` };
}

/** The picture a BankTS type emits, for the check against DCLGEN's own. */
function pictureForBankTs(type: string): string | null {
  const decimal = /^decimal<(\d+), (\d+)>$/.exec(type);
  if (decimal) {
    const precision = Number(decimal[1]);
    const scale = Number(decimal[2]);
    const integer = precision - scale;
    return scale === 0
      ? `S9(${integer}) COMP-3`
      : `S9(${integer})V${"9".repeat(scale)} COMP-3`;
  }
  const binary = /^binary<(\d+)>$/.exec(type);
  if (binary) {
    return `S9(${binary[1]}) COMP`;
  }
  const text = /^string<(\d+)>$/.exec(type);
  if (text) {
    return `X(${text[1]})`;
  }
  if (type === "timestamp") {
    return "X(26)";
  }
  return null;
}

/**
 * A picture as what it describes: repeat counts expanded, usage words settled.
 *
 * DCLGEN writes `S9(13)V9(2) USAGE COMP-3` where this compiler writes
 * `S9(13)V99 COMP-3`, and the two are the same fifteen digits.
 */
function normalise(picture: string): string {
  return picture
    .toUpperCase()
    .replace(/\bUSAGE\s+(IS\s+)?/g, "")
    .replace(/\bPIC(TURE)?\s+(IS\s+)?/g, "")
    .replace(/\bPACKED-DECIMAL\b|\bCOMPUTATIONAL-3\b/g, "COMP-3")
    .replace(
      /\bCOMPUTATIONAL-4\b|\bCOMPUTATIONAL\b|\bBINARY\b|\bCOMP-4\b/g,
      "COMP",
    )
    .replace(/([A-Z9])\((\d+)\)/g, (_all, symbol: string, count: string) =>
      symbol.repeat(Number(count)),
    )
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .trim();
}

/** The `DECLARE ... TABLE` block's columns, in the order Db2 wrote them. */
function readColumns(text: string): {
  table: string;
  columns: { column: string; sqlType: string; nullable: boolean }[];
} {
  const flat = copybookLines(text).join(" ").replace(/\s+/g, " ");
  const declare =
    /EXEC SQL DECLARE\s+(\S+)\s+TABLE\s*\((.*?)\)\s*END-EXEC/i.exec(flat);
  if (!declare) {
    throw new Error("No EXEC SQL DECLARE ... TABLE block was found.");
  }

  const columns: { column: string; sqlType: string; nullable: boolean }[] = [];
  // Split on the commas that separate columns rather than the ones inside
  // `DECIMAL(15,2)`, which is what the depth counter is for.
  let depth = 0;
  let start = 0;
  const body = declare[2];
  const parts: string[] = [];
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "(") depth += 1;
    else if (body[index] === ")") depth -= 1;
    else if (body[index] === "," && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === "") {
      continue;
    }
    const match = /^"?([A-Za-z0-9_@#$]+)"?\s+(.+)$/.exec(trimmed);
    if (!match) {
      throw new Error(`Not a column definition: ${trimmed}`);
    }
    const rest = match[2].trim();
    const nullable = !/\bNOT\s+NULL\b/i.test(rest);
    columns.push({
      column: match[1],
      sqlType: rest
        .replace(/\bNOT\s+NULL\b.*$/i, "")
        .replace(/\bWITH\s+DEFAULT\b.*$/i, "")
        .replace(/\bFOR\s+(BIT|SBCS|MIXED)\s+DATA\b.*$/i, "")
        .trim(),
      nullable,
    });
  }

  return { table: declare[1].replace(/"/g, ""), columns };
}

/** DCLGEN's own COBOL declaration, as a picture per column name. */
function readHostPictures(text: string): Map<string, string> {
  const pictures = new Map<string, string>();
  const lines = copybookLines(text);
  const start = lines.findIndex((line) => /^\s*01\s+/.test(line));
  if (start === -1) {
    return pictures;
  }

  let pending = "";
  for (const line of lines.slice(start + 1)) {
    pending = `${pending} ${line.trim()}`.trim();
    if (!pending.endsWith(".")) {
      continue;
    }
    const entry = /^\d\d\s+([A-Z0-9$#@-]+)\s+(.*)\.$/i.exec(pending);
    pending = "";
    if (entry) {
      pictures.set(entry[1].toUpperCase(), entry[2].trim());
    }
  }

  return pictures;
}

export function importDclgen(text: string): DclgenImport {
  const { table, columns } = readColumns(text);
  const hostPictures = readHostPictures(text);
  const problems: CopybookImportProblem[] = [];

  const read: DclgenColumn[] = columns.map((column) => {
    const resolved = bankTsTypeForSql(column.sqlType);
    if (resolved.problem) {
      problems.push({ field: column.column, message: resolved.problem });
      return { ...column, bankTsType: "", problem: resolved.problem };
    }

    // The check against IBM's own tool: DCLGEN wrote a picture for this column
    // from the catalogue, and so did this. If they disagree, this compiler is
    // wrong about Db2 rather than the member being unusual.
    const declared = hostPictures.get(
      column.column.replace(/_/g, "-").toUpperCase(),
    );
    const ours = pictureForBankTs(resolved.text);
    if (declared && ours && normalise(declared) !== normalise(ours)) {
      problems.push({
        field: column.column,
        message: `DCLGEN declares ${declared.replace(/\s+/g, " ")} and this reads ${column.sqlType} as ${resolved.text}, which is PIC ${ours}.`,
      });
    }

    return { ...column, bankTsType: resolved.text };
  });

  const recordName = bankTsRecordName(`${table.replace(/^.*\./, "")}-ROW`);
  const fields = read
    .filter((column) => column.bankTsType !== "")
    .map(
      (column) =>
        `  ${bankTsName(column.column.replace(/_/g, "-"))}: ${
          column.nullable ? `nullable<${column.bankTsType}>` : column.bankTsType
        };`,
    );

  return {
    table,
    recordName,
    source: `record ${recordName} {\n${fields.join("\n")}\n}`,
    columns: read,
    problems,
  };
}
