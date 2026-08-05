import type { IRProgram, IRRecord, IRType } from "../../ir/src/index";
import {
  enumWidth,
  decimalPicture,
  packedDecimalByteLength,
  toCobolName,
  toCobolPicture,
  temporalLength,
  editedLength,
  numericByteLength,
  alignmentOf,
  slackBefore,
} from "../../cobol-ir/src/index";

export interface CopybookFieldLayout {
  name: string;
  cobolName: string;
  offset: number;
  length: number;
  picture: string;
}

export interface CopybookRecordLayout {
  name: string;
  cobolName: string;
  totalLength: number;
  fields: CopybookFieldLayout[];
}

export interface CopybookInspectionField {
  name: string;
  cobolName: string;
  offset: number;
  length: number;
  picture: string;
}

export interface CopybookInspection {
  recordName: string;
  cobolName: string;
  totalLength: number;
  fields: CopybookInspectionField[];
}

export interface CopybookDiffField {
  index: number;
  left: CopybookInspectionField | null;
  right: CopybookInspectionField | null;
}

export interface CopybookDiffResult {
  identical: boolean;
  left: CopybookInspection;
  right: CopybookInspection;
  fieldDiffs: CopybookDiffField[];
  recordNameDiffers: boolean;
  totalLengthDiffers: boolean;
}

export interface CopybookLayoutEntry {
  order: number;
  path: string;
  type: string;
  picture: string;
  usage: string;
  offset: number;
  length: number;
  bytes: number;
  /**
   * Restricted data, as the BankTS record declared it.
   *
   * Reported here so an auditor reading the layout can see which bytes of a
   * record hold data that must not reach a log, without reading the source.
   */
  sensitive: boolean;
}

export interface CopybookLayoutReport {
  recordName: string;
  cobolName: string;
  totalLength: number;
  entries: CopybookLayoutEntry[];
}

export interface CopybookLayoutDocument {
  version: number;
  backendProfile: string;
  artifact: string;
  reports: CopybookLayoutReport[];
}

export function describeRecordLayout(record: IRRecord): CopybookRecordLayout {
  const fields: CopybookFieldLayout[] = [];
  let offset = 0;
  /** Where the field currently being redefined starts. */
  let anchor = 0;

  for (const field of record.fields) {
    // A renames is a second name for a run already laid out, so it is not part
    // of the layout — the emitter writes it as a level-66 after the fields.
    if (field.renames) {
      continue;
    }
    // A redefining field starts where the field it redefines starts — it is a
    // second reading of the same bytes, not the next ones. Reporting it at the
    // running offset put it after the storage it shares.
    //
    // It may also be longer, which COBOL permits: the redefinition extends the
    // area rather than overrunning it, so the record grows to the longest
    // reading of it.
    const start = field.redefines ? anchor : offset;
    if (field.synchronized) {
      offset += slackBefore(offset, alignmentOf(field.type));
    }
    const at = field.redefines ? start : offset;
    const length = fieldLength(field.type, at);
    fields.push({
      name: field.name,
      cobolName: toCobolName(field.name),
      offset: at,
      length,
      picture: toCobolPicture(field.type),
    });
    if (field.redefines) {
      offset = Math.max(offset, at + length);
    } else {
      anchor = offset;
      offset += length;
    }
  }

  return {
    name: record.name,
    cobolName: toCobolName(record.name),
    totalLength: offset,
    fields,
  };
}

/** Db2-style null indicator: a two-byte signed halfword beside the value. */
export const NULL_INDICATOR_BYTES = 2;

/**
 * Bytes a field occupies at a given offset in its record.
 *
 * The offset matters only for a group or a table holding a `SYNCHRONIZED`
 * binary: IBM measures the slack before one from the start of the record, so
 * the same group is a different length in a different place. Everything else
 * ignores it.
 */
export function fieldLength(type: IRType, base = 0): number {
  switch (type.kind) {
    case "edited":
      return editedLength(type.style, type.precision, type.scale);
    case "temporal":
      return temporalLength(type.unit);
    case "currency":
      return packedDecimalByteLength(type.precision);
    case "enum":
      return enumWidth(type.members);
    case "nullable":
      // The value plus a two-byte null indicator, following the Db2 convention.
      return fieldLength(type.inner) + NULL_INDICATOR_BYTES;
    case "array": {
      // Each occurrence is padded to the largest boundary anything inside it
      // demanded, so that every occurrence has the same internal layout. Without
      // it the second one starts on a different boundary from the first and its
      // fields sit somewhere else — which is why COBOL adds the bytes rather
      // than leaving the table ragged.
      const element = fieldLength(type.element, base);
      const boundary = innerAlignmentOf(type.element, base);
      const padded = element + slackBefore(element, boundary);
      return padded * type.length;
    }
    case "decimal":
      return numericByteLength(type.precision, type.usage);
    case "string":
      // `length` counts characters. A national character is two bytes.
      return type.national ? type.length * 2 : type.length;
    case "bool":
      return 1;
    case "record":
      return groupLength(type.fields, base).length;
  }
}

/**
 * A group's length, counting the slack a `SYNCHRONIZED` item inside it forces.
 *
 * Slack is measured from the start of the *record*, not the group: IBM's
 * algorithm counts "all elementary data items that precede the binary item",
 * which is why the group's own offset has to be passed in. A group holding a
 * `sync`ed binary is a different length at offset 1 than at offset 4.
 *
 * `alignment` is the largest boundary any item inside demanded, which is what
 * an enclosing `OCCURS` pads each occurrence up to.
 */
function groupLength(
  fields: IRRecord["fields"],
  base: number,
): { length: number; alignment: number } {
  let offset = base;
  let anchor = base;
  let alignment = 1;

  for (const field of fields) {
    // A renames is a second name for a run already laid out, and a redefines
    // shares storage rather than adding any.
    if (field.renames) {
      continue;
    }
    if (field.synchronized) {
      const boundary = alignmentOf(field.type);
      offset += slackBefore(offset, boundary);
      alignment = Math.max(alignment, boundary);
    }
    const at = field.redefines ? anchor : offset;
    alignment = Math.max(alignment, innerAlignmentOf(field.type, at));
    if (field.redefines) {
      offset = Math.max(offset, at + fieldLength(field.type, at));
    } else {
      anchor = offset;
      offset += fieldLength(field.type, offset);
    }
  }

  return { length: offset - base, alignment };
}

/** The largest boundary demanded from inside a group or a table's element. */
function innerAlignmentOf(type: IRType, base: number): number {
  if (type.kind === "record") {
    return groupLength(type.fields, base).alignment;
  }
  if (type.kind === "array") {
    return innerAlignmentOf(type.element, base);
  }
  return 1;
}

/**
 * One data description entry, gathered from however many lines it spans.
 *
 * `OCCURS` and `INDEXED BY` are written on continuation lines, so an entry runs
 * until the line that ends it with a period. Splitting on newlines alone read
 * `OCCURS 3 TIMES` as a field named OCCURS.
 */
interface CopybookEntry {
  level: number;
  name: string;
  text: string;
}

function readCopybookEntries(lines: string[]): CopybookEntry[] {
  const entries: CopybookEntry[] = [];
  let pending: string[] = [];

  for (const line of lines) {
    pending.push(line.trim());
    if (!line.trimEnd().endsWith(".")) {
      continue;
    }
    const text = pending.join(" ").replace(/\s+/g, " ").replace(/\.$/, "");
    pending = [];

    const match = text.match(/^(\d{2})\s+([A-Z0-9-]+)\s*(.*)$/);
    if (!match) {
      throw new Error(`Unable to parse copybook entry: ${text}`);
    }
    entries.push({
      level: Number(match[1]),
      name: match[2],
      text: match[3].trim(),
    });
  }

  return entries;
}

export function inspectGeneratedCopybook(
  sourceText: string,
): CopybookInspection {
  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.trimStart().startsWith("*>"));

  const entries = readCopybookEntries(lines);
  const record = entries.find((entry) => entry.level === 1);
  if (!record) {
    throw new Error("No generated 01-level record was found.");
  }

  const fields: CopybookInspectionField[] = [];
  const startOffsets = new Map<string, number>();
  let offset = 0;
  // A group's own length is the sum of what it contains, so an open group is
  // closed by the next entry at its level or above.
  const openGroups: { name: string; start: number; level: number }[] = [];

  for (const entry of entries) {
    // A 66 renames a run of fields that is already counted, and an 88 is a
    // condition name. Neither is storage.
    if (entry.level === 1 || entry.level === 66 || entry.level === 88) {
      continue;
    }
    while (
      openGroups.length > 0 &&
      openGroups[openGroups.length - 1].level >= entry.level
    ) {
      const group = openGroups.pop();
      if (group) {
        fields.push({
          name: group.name,
          cobolName: group.name,
          offset: group.start,
          length: offset - group.start,
          picture: "",
        });
      }
    }

    // A group item has no picture; its children carry the storage.
    if (!/\bPIC\b/.test(entry.text)) {
      openGroups.push({ name: entry.name, start: offset, level: entry.level });
      startOffsets.set(entry.name, offset);
      continue;
    }

    const picture = entry.text
      .replace(/^REDEFINES\s+[A-Z0-9-]+\s+/, "")
      .replace(/\s+(SYNCHRONIZED|SYNC)\b/, "")
      .replace(/\s+JUSTIFIED RIGHT\b/, "")
      .replace(/\s+BLANK WHEN ZERO\b/, "")
      .replace(/\s+OCCURS\b.*$/, "")
      .trim();

    let length = inspectPictureLength(picture);
    // OCCURS multiplies the entry's own length by the number of elements.
    const occurs = entry.text.match(/\bOCCURS (?:1 TO )?(\d+) TIMES/);
    if (occurs) {
      length *= Number(occurs[1]);
    }

    // A SYNCHRONIZED field starts on its own boundary, and the bytes skipped to
    // reach it are slack the record still occupies. Only a binary item has a
    // boundary: COMP-3 and DISPLAY align to a byte, so SYNC on one does
    // nothing, which is what `alignmentOf` says of the same type.
    if (/\b(SYNCHRONIZED|SYNC)\b/.test(entry.text)) {
      const binary = /\bCOMP(-5)?\b/.test(picture);
      offset += slackBefore(offset, binary ? length : 1);
    }

    // A redefining field is a second reading of storage that already exists, so
    // it reports the offset of what it redefines and adds nothing.
    const redefines = entry.text.match(/^REDEFINES\s+([A-Z0-9-]+)/);
    const start = redefines
      ? (startOffsets.get(redefines[1]) ?? offset)
      : offset;
    startOffsets.set(entry.name, start);

    fields.push({
      name: entry.name,
      cobolName: entry.name,
      offset: start,
      length,
      picture,
    });
    if (!redefines) {
      offset += length;
    }
  }

  for (const group of openGroups.reverse()) {
    fields.push({
      name: group.name,
      cobolName: group.name,
      offset: group.start,
      length: offset - group.start,
      picture: "",
    });
  }

  return {
    recordName: record.name,
    cobolName: record.name,
    totalLength: offset,
    fields,
  };
}

export function renderCopybookInspection(
  inspection: CopybookInspection,
): string {
  const lines = [
    "Copybook inspection",
    "",
    `Record: ${inspection.cobolName}`,
    `Total length: ${inspection.totalLength}`,
    "",
    "Fields:",
    ...inspection.fields.map(
      (field) =>
        `- ${field.cobolName} | ${field.picture} | offset ${field.offset} | length ${field.length}`,
    ),
    "",
  ];

  return `${lines.join("\n")}`;
}

export function diffGeneratedCopybooks(
  leftText: string,
  rightText: string,
): CopybookDiffResult {
  const left = inspectGeneratedCopybook(leftText);
  const right = inspectGeneratedCopybook(rightText);
  const maxFields = Math.max(left.fields.length, right.fields.length);
  const fieldDiffs: CopybookDiffField[] = [];

  for (let index = 0; index < maxFields; index += 1) {
    fieldDiffs.push({
      index,
      left: left.fields[index] ?? null,
      right: right.fields[index] ?? null,
    });
  }

  const recordNameDiffers = left.cobolName !== right.cobolName;
  const totalLengthDiffers = left.totalLength !== right.totalLength;
  const fieldsDiffer = fieldDiffs.some((diff) => {
    if (!diff.left || !diff.right) {
      return true;
    }

    return (
      diff.left.cobolName !== diff.right.cobolName ||
      diff.left.offset !== diff.right.offset ||
      diff.left.length !== diff.right.length ||
      diff.left.picture !== diff.right.picture
    );
  });

  return {
    identical: !recordNameDiffers && !totalLengthDiffers && !fieldsDiffer,
    left,
    right,
    fieldDiffs,
    recordNameDiffers,
    totalLengthDiffers,
  };
}

export function renderCopybookDiff(result: CopybookDiffResult): string {
  const lines = [
    "Copybook diff",
    "",
    `Left record: ${result.left.cobolName}`,
    `Right record: ${result.right.cobolName}`,
    `Left total length: ${result.left.totalLength}`,
    `Right total length: ${result.right.totalLength}`,
    `Identical: ${result.identical ? "yes" : "no"}`,
    "",
    "Field comparison:",
    "| Index | Left | Right |",
    "| --- | --- | --- |",
  ];

  for (const diff of result.fieldDiffs) {
    lines.push(
      `| ${diff.index} | ${renderFieldSummary(diff.left)} | ${renderFieldSummary(diff.right)} |`,
    );
  }

  if (result.recordNameDiffers || result.totalLengthDiffers) {
    lines.push("");
    lines.push("Layout differences:");
    if (result.recordNameDiffers) {
      lines.push("- Record name differs.");
    }
    if (result.totalLengthDiffers) {
      lines.push("- Total length differs.");
    }
  }

  lines.push("");
  return `${lines.join("\n")}`;
}

export function renderCopybookTypes(inspection: CopybookInspection): string {
  const lines = [
    "Copybook types",
    "",
    `Record: ${inspection.cobolName}`,
    `Total length: ${inspection.totalLength}`,
    "",
    "| Field | Picture | Offset | Length |",
    "| --- | --- | --- | --- |",
  ];

  for (const field of inspection.fields) {
    lines.push(
      `| ${field.cobolName} | ${field.picture} | ${field.offset} | ${field.length} |`,
    );
  }

  lines.push("");
  return `${lines.join("\n")}`;
}

export function buildCopybookLayoutDocument(
  program: IRProgram,
  artifact: string,
): CopybookLayoutDocument {
  return {
    version: 1,
    backendProfile: "ibm-enterprise-cobol-zos",
    artifact,
    reports: program.records.map((record) => buildCopybookLayoutReport(record)),
  };
}

export function buildCopybookLayoutReport(
  record: IRRecord,
): CopybookLayoutReport {
  const entries: CopybookLayoutEntry[] = [];
  const startOffsets = new Map<string, number>();
  let order = 0;
  let offset = 0;

  for (const field of record.fields) {
    if (field.renames) {
      continue;
    }
    // A redefining field reports the offset of what it redefines, because that
    // is the storage it reads. Reporting where it happens to be declared would
    // describe a field that is not there.
    // A SYNCHRONIZED field starts on its own boundary, and the bytes skipped to
    // reach it are slack the record still occupies. This is the one clause that
    // moves every later field without appearing in any field's own length.
    const aligned = field.synchronized
      ? offset + slackBefore(offset, alignmentOf(field.type))
      : offset;

    const start = field.redefines
      ? (startOffsets.get(field.redefines) ?? offset)
      : aligned;
    startOffsets.set(field.name, start);

    const before = aligned;
    offset = collectLayoutEntries(
      field,
      `${toCobolName(record.name)}.${toCobolName(field.name)}`,
      start,
      entries,
      () => {
        order += 1;
        return order;
      },
    );
    // The redefining field added nothing, so the record goes on from where it
    // already was rather than from the storage this field re-read.
    if (field.redefines) {
      offset = before;
    }
  }

  return {
    recordName: record.name,
    cobolName: toCobolName(record.name),
    totalLength: offset,
    entries,
  };
}

export function renderCopybookLayoutDocument(
  document: CopybookLayoutDocument,
): string {
  const lines = [
    "# Copybook Layout Report",
    "",
    `Version: ${document.version}`,
    `Backend profile: ${document.backendProfile}`,
    "",
    `Artifact: ${document.artifact}`,
    "",
  ];

  for (const report of document.reports) {
    lines.push(
      `## ${report.cobolName}`,
      "",
      `Total length: ${report.totalLength}`,
      "",
      "| Order | Path | Type | PIC | Usage | Offset | Length | Bytes | Sensitive |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );

    for (const entry of report.entries) {
      lines.push(
        `| ${entry.order} | ${entry.path} | ${entry.type} | ${entry.picture} | ${entry.usage} | ${entry.offset} | ${entry.length} | ${entry.bytes} | ${entry.sensitive ? "yes" : "no"} |`,
      );
    }

    lines.push("");
  }

  return `${lines.join("\n")}`;
}

/**
 * Bytes a generated picture occupies, for the copybook inspector and diff.
 *
 * This reads what this compiler emits, which is a narrower language than COBOL
 * allows — a general copybook parser is a different and larger job. It has to
 * keep up with the emitter, though: it once knew only `PIC X` and `COMP-3`, and
 * every field the numeric-usage, temporal, and edited work added made it throw
 * on the compiler's own output.
 */
function inspectPictureLength(picture: string): number {
  const normalized = picture.replace(/\s+/g, " ").trim().toUpperCase();
  const body = normalized.replace(/^PIC /, "").replace(/ VALUE '.+'$/, "");

  const digitsIn = (text: string): number => {
    const repeated = /9\((\d+)\)/g;
    let total = 0;
    let rest = text;
    for (const match of text.matchAll(repeated)) {
      total += Number(match[1]);
    }
    rest = text.replace(repeated, "");
    total += (rest.match(/9/g) ?? []).length;
    return total;
  };

  const alphanumeric = body.match(/^X\((\d+)\)$/);
  if (alphanumeric) {
    return Number(alphanumeric[1]);
  }
  if (body === "X") {
    return 1;
  }

  // `PIC N(n) USAGE NATIONAL` counts characters, and each is two bytes. Reading
  // it as n would put every later field in the record two bytes per character
  // too early, which is the mistake the type exists to prevent.
  const national = body.match(/^N\((\d+)\)(?: USAGE NATIONAL)?$/);
  if (national) {
    return Number(national[1]) * 2;
  }

  // A numeric-edited picture is one character per position, and every position
  // is written out, so its own length is the byte count.
  if (/[Z*,.\/]/.test(body) && !body.includes("COMP")) {
    return body.replace(/CR|DB/g, "XX").length;
  }

  const digits = digitsIn(body);
  if (digits === 0) {
    throw new Error(`Unsupported generated picture clause: ${picture}`);
  }

  if (body.endsWith("COMP-3")) {
    return packedDecimalByteLength(digits);
  }
  if (/\bCOMP-5\b/.test(body) || /\bCOMP\b/.test(body)) {
    // Binary is held in the halfword, fullword, or doubleword that fits.
    return digits <= 4 ? 2 : digits <= 9 ? 4 : 8;
  }

  // Zoned decimal: one byte per digit, plus a byte when the sign is separate.
  return digits + (body.includes("SEPARATE") ? 1 : 0);
}

function renderFieldSummary(field: CopybookInspectionField | null): string {
  if (!field) {
    return "_missing_";
  }

  return `${field.cobolName} (${field.picture}, offset ${field.offset}, length ${field.length})`;
}

function collectLayoutEntries(
  field: IRRecord["fields"][number],
  path: string,
  offset: number,
  entries: CopybookLayoutEntry[],
  nextOrder: () => number,
): number {
  // The slack a SYNCHRONIZED item forces comes before it, so the offset it is
  // reported at is past those bytes. Without this the report names an offset
  // the dataset does not have, which is the one number anyone reads it for.
  if (field.synchronized) {
    offset += slackBefore(offset, alignmentOf(field.type));
  }
  const length = fieldLength(field.type, offset);
  const order = nextOrder();
  // A redefining field is a second reading of storage that already exists, so
  // it reports the same offset as what it redefines and adds nothing to the
  // record's length. Advancing here would push every later field along.
  const occupiesStorage = !field.redefines;

  entries.push({
    order,
    path,
    type: formatLayoutType(field.type),
    picture: formatLayoutPicture(field.type),
    usage: formatLayoutUsage(field.type),
    offset,
    length,
    bytes: length,
    sensitive: field.sensitive,
  });

  if (field.type.kind !== "record") {
    return occupiesStorage ? offset + length : offset;
  }

  let childOffset = offset;
  for (const child of field.type.fields) {
    childOffset = collectLayoutEntries(
      child,
      `${path}.${toCobolName(child.name)}`,
      childOffset,
      entries,
      nextOrder,
    );
  }

  return occupiesStorage ? offset + length : offset;
}

function formatLayoutType(type: IRType): string {
  switch (type.kind) {
    case "edited":
      return `edited<decimal<${type.precision},${type.scale}>,"${type.style}">`;
    case "temporal":
      return type.unit;
    case "decimal":
      return type.usage === "binary"
        ? `binary<${type.precision}>`
        : type.usage === "display"
          ? `zoned<${type.precision},${type.scale}>`
          : `decimal<${type.precision},${type.scale}>`;
    case "string":
      return `${type.national ? "national" : "string"}<${type.length}>`;
    case "bool":
      return "bool";
    case "record":
      return `record<${type.name}>`;
    case "currency":
      return `currency<"${type.code}",${type.precision},${type.scale}>`;
    case "enum":
      return `enum<${type.name}>`;
    case "nullable":
      return `nullable<${formatLayoutType(type.inner)}>`;
    case "array":
      return `${formatLayoutType(type.element)}[${type.length}]`;
  }
}

function formatLayoutPicture(type: IRType): string {
  switch (type.kind) {
    case "record":
      return "GROUP";
    default:
      return toCobolPicture(type);
  }
}

function formatLayoutUsage(type: IRType): string {
  switch (type.kind) {
    case "edited":
      return "DISPLAY";
    case "temporal":
      return "DISPLAY";
    case "decimal":
      return type.usage === "binary"
        ? "COMP"
        : type.usage === "display"
          ? "DISPLAY"
          : "COMP-3";
    case "currency":
      return "COMP-3";
    case "enum":
      return "DISPLAY";
    case "nullable":
      return formatLayoutUsage(type.inner);
    case "array":
      return formatLayoutUsage(type.element);
    case "string":
      return type.national ? "NATIONAL" : "DISPLAY";
    case "bool":
      return "DISPLAY";
    case "record":
      return "GROUP";
  }
}
