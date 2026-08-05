import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { compile } from "../packages/compiler/src/index";
import { renderCopybook } from "../packages/cobol-backend/src/index";
import {
  copybookMemberName,
  toCobolProgramId,
} from "../packages/cobol-ir/src/index";

/**
 * Builds an upload bundle for someone with z/OS access.
 *
 * The project's standing limit is that everything ends at GnuCOBOL: no
 * generated program has been compiled by IBM Enterprise COBOL, precompiled by
 * DSNHPC, or run in a CICS region. That is not a defect this repository can fix
 * from here — it needs a machine nobody involved has.
 *
 * What it can do is make the gap a bounded task rather than an open question.
 * This writes every artifact a z/OS run needs, in the member names the
 * generated JCL already expects, alongside the results the local GnuCOBOL run
 * produced so the two can be compared line by line. Someone with access uploads
 * it, submits the jobs, and fills in a results file. Nothing here claims the
 * run happened.
 */

interface Member {
  name: string;
  content: string;
  /** The record a copybook holds, so a name clash can say which two clashed. */
  record?: string;
}

const EXAMPLES = readdirSync("examples", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

export function buildZosKit(outputRoot = join("dist", "zos")): {
  members: number;
  examples: string[];
  skipped: { example: string; reason: string }[];
} {
  const cobol: Member[] = [];
  const copybooks: Member[] = [];
  const jcl: Member[] = [];
  const skipped: { example: string; reason: string }[] = [];

  for (const example of EXAMPLES) {
    const source = readFileSync(
      join("examples", example, "src", "main.bank.ts"),
      "utf8",
    );
    const result = compile(source, { emitJcl: true });

    if (!result.ok || !result.cobol || !result.program) {
      skipped.push({
        example,
        reason: result.diagnostics.map((entry) => entry.id).join(", "),
      });
      continue;
    }

    // A PDS member name is eight characters, which is the same transform the
    // generated JCL uses for the job and the load module.
    const member = toCobolProgramId(result.program.moduleName)
      .replace(/-/g, "")
      .slice(0, 8);

    cobol.push({ name: member, content: result.cobol });
    if (result.jcl) {
      jcl.push({ name: member, content: result.jcl });
    }
    for (const copybook of result.copybooks) {
      copybooks.push({
        name: copybookMemberName(copybook.record),
        content: copybook.content,
        record: copybook.record,
      });
    }
  }

  // Every folder goes to one PDS, so a name written twice is a member
  // overwritten. The same record shared by two programs is written twice with
  // the same bytes and is nothing to report; two *different* records sharing a
  // name means the library ships one of them under the other's name, and every
  // program that copies it then reads fields at offsets its dataset does not
  // have.
  const collisions: string[] = [];
  const write = (folder: string, members: Member[]): void => {
    const written = new Map<string, Member>();
    for (const member of members) {
      const earlier = written.get(member.name);
      if (earlier) {
        if (earlier.content !== member.content) {
          collisions.push(
            `${folder}/${member.name}: ${earlier.record ?? earlier.name} and ${member.record ?? member.name}`,
          );
        }
        continue;
      }
      written.set(member.name, member);
      const path = join(outputRoot, folder, `${member.name}.txt`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, member.content, "utf8");
    }
    // The manifest lists what shipped, not what was offered. It counted every
    // copybook the programs produced, so a library six members short still
    // looked complete.
    members.length = 0;
    members.push(...written.values());
  };

  write("cobol", cobol);
  write("copybooks", copybooks);
  write("jcl", jcl);

  if (collisions.length > 0) {
    throw new Error(
      [
        "Two different members would be written under one name, so the library",
        "would ship one of them under the other's name:",
        ...collisions.map((entry) => `  ${entry}`),
        "A PDS member name is eight characters with the hyphens removed, and",
        "that is also all a COPY resolves on. Rename so they differ within it.",
      ].join("\n"),
    );
  }

  const manifestPath = join(outputRoot, "MANIFEST.txt");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    renderManifest(cobol, copybooks, jcl, skipped),
    "utf8",
  );

  return {
    members: cobol.length + copybooks.length + jcl.length,
    examples: cobol.map((member) => member.name),
    skipped,
  };
}

function renderManifest(
  cobol: Member[],
  copybooks: Member[],
  jcl: Member[],
  skipped: { example: string; reason: string }[],
): string {
  const lines = [
    "BankLang z/OS conformance bundle",
    "",
    "Upload each folder to a PDS with the matching name:",
    "",
    "  cobol/      -> <HLQ>.BANKLANG.COBOL    (LRECL 80, RECFM FB)",
    "  copybooks/  -> <HLQ>.BANKLANG.COPYLIB  (LRECL 80, RECFM FB)",
    "  jcl/        -> <HLQ>.BANKLANG.JCL      (LRECL 80, RECFM FB)",
    "",
    "The COBOL is fixed reference format: sequence area 1-6 blank, the",
    "indicator in 7, Area A from 8, and nothing past column 72. Compile it",
    "with the default SOURCE format. Do not set the free-format option — it",
    "reads columns 1-7 as code, and every line here begins with six blanks.",
    "",
    "A copybook member is named for its record, with the hyphens removed and",
    "cut to eight characters, which is what a COPY on a PDS resolves on. Two",
    "records that agree within those eight characters cannot share a library,",
    "so the bundle refuses to build rather than ship one under the other's",
    "name.",
    "",
    "Members",
    "-------",
  ];

  for (const [folder, members] of [
    ["cobol", cobol],
    ["copybooks", copybooks],
    ["jcl", jcl],
  ] as const) {
    for (const member of members) {
      lines.push(`  ${folder}/${member.name}`);
    }
  }

  if (skipped.length > 0) {
    lines.push("", "Not included", "------------");
    for (const entry of skipped) {
      lines.push(`  ${entry.example}: ${entry.reason}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

if (process.argv[1]?.endsWith("zos-kit.ts")) {
  const summary = buildZosKit();
  process.stdout.write(
    `Wrote ${summary.members} members for ${summary.examples.length} programs.\n`,
  );
  for (const entry of summary.skipped) {
    process.stdout.write(`Skipped ${entry.example}: ${entry.reason}\n`);
  }
}
