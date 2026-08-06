export {
  checkSourceMapCoverage,
  type SourceMapCoverageResult,
} from "./source-map-coverage";

export interface DeterminismComparison {
  identical: boolean;
  leftBytes: number;
  rightBytes: number;
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
