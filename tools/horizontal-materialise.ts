/**
 * Turning an upstream benchmark record into something safe to implement from.
 *
 *   pnpm horizontal:materialise
 *
 * Both semantic corpora ship the answer next to the question. CobolCodeBench
 * carries `canonical_solution` — the full COBOL — and `complete_prompt`, which
 * is a COBOL skeleton. COBOLEval carries a COBOL `prompt` and the COBOL test
 * drivers. If a BankTS implementation were written with those on screen, the
 * benchmark would measure transliteration, and a transliteration score says
 * nothing about whether BankTS can *express* the task.
 *
 * So this splits each record in two:
 *
 *   validation/tasks/<corpus>/<id>/spec.json     the prose, the inputs, the
 *                                                expected outputs, the contract
 *   validation/sealed/<corpus>/<id>/…            the benchmark's own COBOL
 *
 * The spec is what an implementation is written from and is the only half
 * committed. The sealed half is derived from the ignored cache, is itself
 * ignored, and is read by the evaluator — never by the author.
 *
 * **What this does and does not guarantee.** It guarantees that the normal path
 * to writing an implementation does not show the reference, that the committed
 * material contains none of it, and that anybody reproducing this can see
 * exactly which bytes were on the authoring side of the line. It does not
 * guarantee that the agent which wrote the BankTS never read the sealed file —
 * no repository layout can. That limit is stated in
 * `docs/validation/horizontal-validation.md` rather than glossed: development
 * here is AI-assisted and says so, and what is model-free is compilation and
 * scoring.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  safeJoin,
  type SpecOnlyTask,
} from "../packages/horizontal-validation/src/index";
import { corpusDir } from "./horizontal-fetch";

export const TASKS_ROOT = "validation/tasks";
export const SEALED_ROOT = "validation/sealed";

/** One JSONL file, parsed, with the line number kept for error messages. */
function readJsonl(
  path: string,
): { line: number; record: Record<string, unknown> }[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((text, index) => ({ text: text.trim(), line: index + 1 }))
    .filter((entry) => entry.text.length > 0)
    .map((entry) => ({
      line: entry.line,
      record: JSON.parse(entry.text) as Record<string, unknown>,
    }));
}

function text(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

/**
 * A JSON field that itself holds JSON, which is how CobolCodeBench ships files.
 *
 * `inputs` is a string containing an object of file name to contents. A record
 * whose inner JSON does not parse is a malformed upstream record and is
 * reported as one rather than silently becoming an empty file set — a task with
 * no inputs would "pass" by writing nothing.
 */
function nestedFiles(
  record: Record<string, unknown>,
  field: string,
  id: string,
): Record<string, string> | null {
  const raw = text(record, field);
  if (raw === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const files: Record<string, string> = {};
    for (const [name, content] of Object.entries(parsed)) {
      if (typeof content !== "string") {
        return null;
      }
      files[name] = content;
    }
    return files;
  } catch {
    process.stderr.write(`${id}: '${field}' is not parseable JSON.\n`);
    return null;
  }
}

export interface Materialised {
  corpus: string;
  discovered: number;
  written: number;
  malformed: { id: string; why: string }[];
}

/**
 * CobolCodeBench: prose in, files out, and the reference sealed away.
 *
 * The behavioural oracle is the benchmark's own `outputs` — the exact bytes it
 * expects each file to hold — so the reference COBOL is not needed to score a
 * run at all. It is sealed rather than discarded only so a failure can be
 * investigated against what the benchmark's author intended.
 */
export function materialiseCobolCodeBench(cwd = process.cwd()): Materialised {
  const source = join(
    corpusDir("cobolcodebench", cwd),
    "CobolCodeBench_Dataset.jsonl",
  );
  const result: Materialised = {
    corpus: "cobolcodebench",
    discovered: 0,
    written: 0,
    malformed: [],
  };
  if (!existsSync(source)) {
    return result;
  }

  for (const { record } of readJsonl(source)) {
    result.discovered += 1;
    const upstreamId = text(record, "program_name");
    const id = `cobolcodebench/${upstreamId}`;

    const inputs = nestedFiles(record, "inputs", id);
    const outputs = nestedFiles(record, "outputs", id);
    const specification = text(record, "instruct_prompt");

    if (!inputs || !outputs || specification === "" || upstreamId === "") {
      result.malformed.push({
        id: upstreamId || "<unnamed>",
        why:
          specification === ""
            ? "no instruct_prompt to implement from"
            : "inputs or outputs are not a JSON object of file name to contents",
      });
      continue;
    }

    const task: SpecOnlyTask = {
      id,
      corpus: "cobolcodebench",
      upstreamId,
      upstreamVersion: "9d02534b7d1aabcbac1a1ec21c5a5e80c50323a8",
      licence: "Apache-2.0",
      specification,
      inputs,
      expectedOutputs: outputs,
      expectedStdout: null,
      expectedExitCode: null,
      timeoutMs: 30_000,
    };

    writeTask(task, cwd);
    // Sealed: the benchmark's own COBOL, and the skeleton, which is also COBOL.
    writeSealed(
      "cobolcodebench",
      upstreamId,
      {
        "canonical_solution.cbl": text(record, "canonical_solution"),
        "complete_prompt.cbl": text(record, "complete_prompt"),
      },
      cwd,
    );
    result.written += 1;
  }
  return result;
}

/**
 * COBOLEval: the docstring is the specification, the LINKAGE is the contract.
 *
 * A HumanEval task's prose lives in a COBOL comment inside `prompt`, and the
 * data layout the benchmark's test drivers call the program with lives in the
 * same file as a LINKAGE SECTION. Both are needed to implement the task and
 * neither is a solution, so the comment text and the LINKAGE declaration are
 * extracted into the spec while the rest of the prompt — the skeleton — is
 * sealed with the drivers.
 *
 * The LINKAGE is what makes most of this corpus inapplicable, and it has to be
 * in the spec for that to be an honest finding rather than a guess: the
 * interface says `COMP-2`, and that is the fact the applicability rule fires
 * on.
 */
export function materialiseCobolEval(cwd = process.cwd()): Materialised {
  const source = join(corpusDir("coboleval", cwd), "data/CobolEval.jsonl");
  const result: Materialised = {
    corpus: "coboleval",
    discovered: 0,
    written: 0,
    malformed: [],
  };
  if (!existsSync(source)) {
    return result;
  }

  for (const { record } of readJsonl(source)) {
    result.discovered += 1;
    const upstreamId = text(record, "task_id");
    const slug = upstreamId.replace(/[^A-Za-z0-9]+/g, "-");
    const prompt = text(record, "prompt");
    const entryPoint = text(record, "entry_point");

    if (upstreamId === "" || prompt === "") {
      result.malformed.push({
        id: upstreamId || "<unnamed>",
        why: "no prompt",
      });
      continue;
    }

    const specification = [
      `Entry point: ${entryPoint}`,
      "",
      "Behaviour, as the benchmark states it:",
      "",
      commentaryOf(prompt),
      "",
      "The calling interface the benchmark fixes:",
      "",
      linkageOf(prompt),
    ].join("\n");

    const task: SpecOnlyTask = {
      id: `coboleval/${slug}`,
      corpus: "coboleval",
      upstreamId,
      upstreamVersion: "0bb96c3114bb2bb28e221e9d6000614781f8609d",
      licence: "MIT",
      specification,
      inputs: {},
      // The benchmark's drivers write the answer to `<ENTRY-POINT>.TXT` and
      // assert on it, so the expected outputs are per-driver rather than one
      // fixed file. They are sealed with the drivers and read by the evaluator.
      expectedOutputs: {},
      expectedStdout: null,
      expectedExitCode: null,
      timeoutMs: 30_000,
    };

    writeTask(task, cwd);
    const tests = record.tests;
    writeSealed(
      "coboleval",
      slug,
      {
        "prompt.cbl": prompt,
        "tests.json": `${JSON.stringify(tests ?? [], null, 2)}\n`,
        "canonical_solution.txt": text(record, "canonical_solution"),
      },
      cwd,
    );
    result.written += 1;
  }
  return result;
}

/** The comment lines of a COBOL prompt, which is where the prose lives. */
export function commentaryOf(prompt: string): string {
  return prompt
    .split(/\r?\n/)
    .filter((line) => line[6] === "*")
    .map((line) => line.slice(7).trimEnd())
    .join("\n")
    .trim();
}

/** The LINKAGE SECTION, which is the contract the drivers call through. */
export function linkageOf(prompt: string): string {
  const lines = prompt.split(/\r?\n/);
  const start = lines.findIndex((line) => /LINKAGE\s+SECTION/i.test(line));
  if (start === -1) {
    return "(the benchmark declares no LINKAGE SECTION for this task)";
  }
  const body: string[] = [];
  for (const line of lines.slice(start)) {
    if (body.length > 0 && /^\s{7}[A-Z-]+\s+SECTION\s*\./i.test(line)) {
      break;
    }
    if (line[6] === "*") {
      continue;
    }
    body.push(line.trimEnd());
  }
  return body.filter((line) => line.trim() !== "").join("\n");
}

function writeTask(task: SpecOnlyTask, cwd: string): void {
  const root = resolve(
    cwd,
    TASKS_ROOT,
    task.corpus,
    task.upstreamId.replace(/[^A-Za-z0-9]+/g, "-"),
  );
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "spec.json"),
    `${JSON.stringify(task, null, 2)}\n`,
    "utf8",
  );
}

function writeSealed(
  corpus: string,
  id: string,
  files: Record<string, string>,
  cwd: string,
): void {
  const root = resolve(
    cwd,
    SEALED_ROOT,
    corpus,
    id.replace(/[^A-Za-z0-9]+/g, "-"),
  );
  mkdirSync(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    // Through `safeJoin` even though every name here is a literal: the rule is
    // that nothing writes a path from corpus-adjacent data without the check,
    // and an exception for "names I chose" is how the check stops being applied.
    writeFileSync(safeJoin(root, name), content, "utf8");
  }
}

function main(): number {
  const cwd = process.cwd();
  rmSync(resolve(cwd, SEALED_ROOT), { recursive: true, force: true });

  for (const materialise of [materialiseCobolCodeBench, materialiseCobolEval]) {
    const result = materialise(cwd);
    if (result.discovered === 0) {
      process.stdout.write(
        `${result.corpus.padEnd(16)} not in the cache. Run \`pnpm horizontal:fetch ${result.corpus}\`.\n`,
      );
      continue;
    }
    process.stdout.write(
      `${result.corpus.padEnd(16)} ${String(result.written)} / ${String(result.discovered)} materialised into ${relative(cwd, resolve(cwd, TASKS_ROOT, result.corpus))}\n`,
    );
    for (const bad of result.malformed) {
      process.stdout.write(`  malformed upstream: ${bad.id} — ${bad.why}\n`);
    }
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
