import type { IRRecord, IRType } from "../../ir/src/index";

export function toCobolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/[^A-Za-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

export function toCobolProgramId(moduleName: string): string {
  return toCobolName(moduleName);
}

export function toCobolParagraphName(functionName: string): string {
  return toCobolName(functionName);
}

export function toCobolRecordName(record: IRRecord): string {
  return toCobolName(record.name);
}

export function toCobolFieldName(fieldName: string): string {
  return toCobolName(fieldName);
}

export function toCobolPicture(type: IRType): string {
  switch (type.kind) {
    case "decimal":
      return decimalPicture(type.precision, type.scale);
    case "string":
      return `PIC X(${type.length})`;
    case "bool":
      return `PIC X VALUE 'N'`;
    case "record":
      return "GROUP";
  }
}

export function decimalPicture(precision: number, scale: number): string {
  const integerDigits = precision - scale;
  if (scale === 0) {
    return `PIC S9(${integerDigits}) COMP-3`;
  }

  return `PIC S9(${integerDigits})V${"9".repeat(scale)} COMP-3`;
}

export function packedDecimalByteLength(precision: number): number {
  return Math.ceil((precision + 1) / 2);
}
