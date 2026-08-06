import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { compile } from "../packages/compiler/src/index";
import { emitZunit } from "../packages/zunit/src/index";
import { renderCopybook } from "../packages/cobol-backend/src/index";
import {
  copybookMemberName,
  toCobolProgramId,
} from "../packages/cobol-ir/src/index";
import { exampleProjects } from "./example-projects";

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
  /**
   * The library the member goes to, for the folders that have one per program.
   *
   * The examples are independent programs rather than one application, and
   * seven of them declare an `AccountRecord`, a `TransferRequest` or a
   * `PostingLine` of their own with different fields. One flat copybook library
   * would ship one program's record under another program's name — so each
   * program's copybooks go to a library of its own, and the clash that is still
   * an error is two records inside one program.
   */
  library?: string;
}

const EXAMPLES = exampleProjects().map((path) =>
  path.replace(/^examples\//, ""),
);

export function buildZosKit(outputRoot = join("dist", "zos")): {
  members: number;
  examples: string[];
  skipped: { example: string; reason: string }[];
} {
  // Removed rather than overwritten. A member that was renamed leaves the old
  // one behind, and a bundle holding both is a library where two members claim
  // to be the same program — which is exactly the failure the collision check
  // below exists to prevent, arriving by another route.
  rmSync(outputRoot, { recursive: true, force: true });

  const cobol: Member[] = [];
  /** Program members only: a test case driver is in cobol/ and is not one. */
  const programs: string[] = [];
  const copybooks: Member[] = [];
  const jcl: Member[] = [];
  // A generated zUnit case: the driver goes to the COBOL library beside the
  // program it tests, and the configuration to a library of its own. It is the
  // one part of this bundle nothing here has ever run — see divergence D20 —
  // so a run of it is worth more than a run of anything else in the folder.
  const bzucfg: Member[] = [];
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
    programs.push(member);
    if (result.jcl) {
      jcl.push({ name: member, content: result.jcl });
    }
    for (const copybook of result.copybooks) {
      copybooks.push({
        name: copybookMemberName(copybook.record),
        content: copybook.content,
        record: copybook.record,
        library: member,
      });
    }

    if (result.program.tests.length > 0) {
      const zunit = emitZunit(result.program);
      cobol.push({ name: zunit.moduleName, content: zunit.driver });
      jcl.push({ name: zunit.moduleName, content: zunit.jcl });
      bzucfg.push({ name: zunit.moduleName, content: zunit.configuration });
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
      const key = member.library
        ? `${member.library}/${member.name}`
        : member.name;
      const earlier = written.get(key);
      if (earlier) {
        if (earlier.content !== member.content) {
          collisions.push(
            `${folder}/${key}: ${earlier.record ?? earlier.name} and ${member.record ?? member.name}`,
          );
        }
        continue;
      }
      written.set(key, member);
      const path = join(outputRoot, folder, `${key}.txt`);
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
  write("bzucfg", bzucfg);

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
    renderManifest(cobol, copybooks, jcl, bzucfg, skipped),
    "utf8",
  );

  return {
    members: cobol.length + copybooks.length + jcl.length + bzucfg.length,
    examples: programs,
    skipped,
  };
}

function renderManifest(
  cobol: Member[],
  copybooks: Member[],
  jcl: Member[],
  bzucfg: Member[],
  skipped: { example: string; reason: string }[],
): string {
  const lines = [
    "BankLang z/OS conformance bundle",
    "",
    "Upload each folder to a PDS with the matching name:",
    "",
    "  cobol/      -> <HLQ>.BANKLANG.COBOL    (LRECL 80, RECFM FB)",
    "  copybooks/<program>/ -> <HLQ>.BANKLANG.<program>.COPYLIB",
    "  jcl/        -> <HLQ>.BANKLANG.JCL      (LRECL 80, RECFM FB)",
    "  bzucfg/     -> <HLQ>.ZUNIT.BZUCFG      (LRECL 80, RECFM FB)",
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
    "Each program's copybooks go to a library of its own. These examples are",
    "independent programs rather than one application, and several declare an",
    "`AccountRecord` or a `PostingLine` of their own with different fields; one",
    "flat library would ship one program's record under another's name. A real",
    "estate shares a library, and there the eight-character rule is what stops",
    "the same thing happening.",
    "",
    "Members",
    "-------",
  ];

  if (bzucfg.length > 0) {
    lines.push(
      "",
      "zUnit test cases",
      "----------------",
      "",
      "A member of cobol/ named T<program> is a generated zUnit test case, and",
      "bzucfg/ holds its configuration. Its job compiles the driver and runs it",
      "through EQAPPLAY. The program under test has to be compiled with TEST",
      "and be in the same load library: that is what the runner intercepts its",
      "calls through, and a program compiled without it calls the real",
      "BANKLEDG.",
      "",
      "Nothing here has ever been run. Two values in each configuration are",
      "inferred rather than observed — divergences D20 and D21 — and one real",
      "run settles both.",
    );
  }

  for (const [folder, members] of [
    ["cobol", cobol],
    ["copybooks", copybooks],
    ["jcl", jcl],
    ["bzucfg", bzucfg],
  ] as const) {
    for (const member of members) {
      lines.push(
        `  ${folder}/${member.library ? `${member.library}/` : ""}${member.name}`,
      );
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
