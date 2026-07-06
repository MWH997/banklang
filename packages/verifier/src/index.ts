export interface DeterminismComparison {
  identical: boolean;
  leftBytes: number;
  rightBytes: number;
}

export function compareExactText(
  left: string,
  right: string,
): DeterminismComparison {
  const leftBytes = Buffer.byteLength(left, "utf8");
  const rightBytes = Buffer.byteLength(right, "utf8");
  return {
    identical: left === right,
    leftBytes,
    rightBytes,
  };
}

export function compareExactBytes(
  left: Uint8Array,
  right: Uint8Array,
): DeterminismComparison {
  return {
    identical:
      left.length === right.length &&
      left.every((value, index) => value === right[index]),
    leftBytes: left.length,
    rightBytes: right.length,
  };
}
