import { describe, expect, it } from "vitest";

import { buildGnucobolValidationReport } from "../tools/gnucobol-validation";

describe("gnucobol validation report", () => {
  it("renders the required evidence fields", () => {
    const report = buildGnucobolValidationReport({
      backendProfile: "gnucobol-local",
      backendRequirements: [],
      sourceArtifact: "examples/account-transfer/src/main.bank.ts",
      sourceArtifactHash:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      generatedArtifact: "dist/gnucobol/cobol/ACCOUNT-TRANSFER.cbl",
      generatedArtifactHash:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      sourceMapArtifact: "dist/gnucobol/maps/source-map.json",
      sourceMapArtifactHash:
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      compilerExecutable: "cobc",
      compilerVersion: "cobc (GnuCOBOL) 3.2.0",
      compilerCommand:
        "cobc -x -free dist/gnucobol/cobol/ACCOUNT-TRANSFER.cbl -o dist/gnucobol/bin/account-transfer",
      compilerExitCode: 0,
      compilerStatus: "passed",
      compilerOutput: "compiled",
      validatedWithGnucobol: true,
      knownBackendGaps: [
        "This local profile covers the account-transfer subset only.",
      ],
    });

    expect(report).toContain("validated-with-gnucobol | yes");
    expect(report).toContain("backend-profile | gnucobol-local");
    expect(report).toContain("source-artifact-sha256");
    expect(report).toContain("generated-artifact-sha256");
    expect(report).toContain("compiler-command");
    expect(report).toContain("Known Backend Gaps");
  });
});
