/**
 * Which source members name which copybooks.
 *
 * This is deliberately dependency analysis rather than copybook expansion. A
 * `COPY ... REPLACING` edge records that replacement happens, but this module
 * neither applies the replacement nor claims to know the declarations that
 * result. Following names is useful even when the source cannot be compiled;
 * rewriting it without a compiler's semantics would be a different promise.
 */

import { isFixedFormat } from "./features";
import { CompilerInvariant } from "../../diagnostics/src/errors";

/** A `COPY` statement found in source text. */
export interface CopyReference {
  /** The case-insensitive member name, canonicalised without `.cpy`. */
  member: string;
  /** The original, 1-based source line on which `COPY` begins. */
  line: number;
  /** Whether the statement contains a `REPLACING` phrase. */
  replacing: boolean;
}

/** A program whose copybook dependencies are to be followed. */
export interface CopybookGraphProgramSource {
  kind: "program";
  /** Stable name written into reports, normally a path relative to the run. */
  artifact: string;
  text: string;
}

/** A copybook whose own dependencies are to be followed. */
export interface CopybookGraphCopybookSource {
  kind: "copybook";
  /** Stable name written into reports, normally a path relative to the run. */
  artifact: string;
  /** Member name supplied by the caller, with or without a `.cpy` suffix. */
  member: string;
  text: string;
}

/** Source input kept free of filesystem concerns so it also runs in a browser. */
export type CopybookGraphSource =
  CopybookGraphProgramSource | CopybookGraphCopybookSource;

/** One source member in the dependency graph. */
export interface CopybookGraphNode {
  /** Stable graph identity: the source kind followed by its artifact name. */
  id: string;
  kind: "program" | "copybook";
  artifact: string;
  /** `null` for programs; canonical member name for copybooks. */
  member: string | null;
}

export type CopybookResolutionStatus = "resolved" | "missing" | "ambiguous";

/** One source-level `COPY`, including references that cannot be resolved. */
export interface CopybookGraphEdge {
  /** Id of the program or copybook containing the statement. */
  source: string;
  member: string;
  line: number;
  replacing: boolean;
  status: CopybookResolutionStatus;
  /** One resolved id, no ids when missing, or every candidate when ambiguous. */
  targets: string[];
}

/**
 * Stable, JSON-ready dependency data.
 *
 * Arrays and ids are sorted independently of caller input order. `cycles`
 * contains strongly connected groups in the resolved copybook subgraph;
 * uncertain edges are reported but cannot truthfully establish a cycle.
 */
export interface CopybookDependencyGraph {
  schemaVersion: 1;
  /** Always false: this graph records references and never expands source. */
  semanticExpansion: false;
  nodes: CopybookGraphNode[];
  edges: CopybookGraphEdge[];
  /** Sorted node-id groups; a direct self-copy is a one-member cycle. */
  cycles: string[][];
}

interface SourceToken {
  kind: "word" | "literal" | "period";
  text: string;
  line: number;
}

/** Code-point order, rather than host-locale order, for reproducible output. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** COBOL names are case-insensitive and source libraries add the suffix. */
function canonicalMember(member: string): string {
  const leaf = member.trim().replaceAll("\\", "/").split("/").at(-1) ?? "";
  return leaf.replace(/\.cpy$/i, "").toUpperCase();
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9$#@_-]/.test(character);
}

/**
 * Lex only the pieces a COPY statement needs.
 *
 * Quoted literals and replacement pseudotext are each opaque. In particular,
 * a period inside `==pseudo-text==` is not the end of the COPY statement and a
 * word inside a message is not source syntax. Comments are removed while the
 * quote state is known, so `*>` inside a literal remains literal text.
 */
function sourceTokens(text: string): SourceToken[] {
  const rawLines = text.split(/\r?\n/);
  // A meaningful fixed-format line necessarily reaches Area A in column 8.
  // `isFixedFormat` deliberately defaults an empty sample to fixed, but a
  // short free statement such as `COPY A.` is a real sample for this reader.
  const fixed =
    rawLines.some((line) => line.trim() !== "" && line.length > 7) &&
    isFixedFormat(rawLines);
  const tokens: SourceToken[] = [];
  let inPseudoText = false;

  rawLines.forEach((raw, index) => {
    const line = index + 1;
    if (fixed && (raw[6] === "*" || raw[6] === "/")) {
      return;
    }

    const content = fixed ? raw.slice(7, 72) : raw;
    if (!fixed && content.trimStart().startsWith("*")) {
      return;
    }

    const firstToken = tokens.length;
    const joinsPreviousToken =
      fixed &&
      raw[6] === "-" &&
      !inPseudoText &&
      /^\s*(?:["']|[A-Za-z0-9$#@_-])/.test(content);
    let offset = 0;
    while (offset < content.length) {
      const character = content[offset];

      if (inPseudoText) {
        if (character === "=" && content[offset + 1] === "=") {
          inPseudoText = false;
          offset += 2;
        } else {
          offset += 1;
        }
        continue;
      }

      if (character === "*" && content[offset + 1] === ">") {
        break;
      }
      if (character === "=" && content[offset + 1] === "=") {
        inPseudoText = true;
        offset += 2;
        continue;
      }
      if (character === '"' || character === "'") {
        const delimiter = character;
        let literal = "";
        offset += 1;
        while (offset < content.length) {
          const literalCharacter = content[offset];
          if (literalCharacter === delimiter) {
            if (content[offset + 1] === delimiter) {
              literal += delimiter;
              offset += 2;
              continue;
            }
            offset += 1;
            break;
          }
          literal += literalCharacter;
          offset += 1;
        }
        tokens.push({ kind: "literal", text: literal, line });
        continue;
      }
      if (character === ".") {
        tokens.push({ kind: "period", text: character, line });
        offset += 1;
        continue;
      }
      if (isWordCharacter(character)) {
        const start = offset;
        while (isWordCharacter(content[offset])) {
          offset += 1;
        }
        tokens.push({
          kind: "word",
          text: content.slice(start, offset).toUpperCase(),
          line,
        });
        continue;
      }
      offset += 1;
    }

    if (!joinsPreviousToken || firstToken === tokens.length) {
      return;
    }
    const previous = tokens[firstToken - 1];
    const continued = tokens[firstToken];
    if (
      previous !== undefined &&
      continued !== undefined &&
      previous.line === line - 1 &&
      previous.kind === continued.kind &&
      (previous.kind === "word" || previous.kind === "literal")
    ) {
      previous.text += continued.text;
      tokens.splice(firstToken, 1);
    }
  });

  return tokens;
}

/** SQL, CICS and DL/I bodies are not COBOL and may contain the word `COPY`. */
function cobolTokens(tokens: readonly SourceToken[]): SourceToken[] {
  const result: SourceToken[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const dialect = tokens[index + 1];
    if (
      token?.kind === "word" &&
      token.text === "EXEC" &&
      dialect?.kind === "word" &&
      (dialect.text === "SQL" ||
        dialect.text === "CICS" ||
        dialect.text === "DLI")
    ) {
      index += 2;
      while (
        index < tokens.length &&
        !(tokens[index]?.kind === "word" && tokens[index]?.text === "END-EXEC")
      ) {
        index += 1;
      }
      continue;
    }
    if (token !== undefined) {
      result.push(token);
    }
  }

  return result;
}

/**
 * Find source-level COPY statements without expanding them.
 *
 * Statements may cross physical lines. Both fixed and free source formats are
 * accepted, and comments, ordinary literals and replacement pseudotext do not
 * contribute keywords. A quoted text-name is accepted as a member name.
 */
export function parseCopyReferences(text: string): CopyReference[] {
  const references: CopyReference[] = [];
  let current: CopyReference | null = null;

  const finish = (): void => {
    if (current && current.member !== "") {
      references.push(current);
    }
    current = null;
  };

  for (const token of cobolTokens(sourceTokens(text))) {
    if (!current) {
      if (token.kind === "word" && token.text === "COPY") {
        current = { member: "", line: token.line, replacing: false };
      }
      continue;
    }

    if (token.kind === "period") {
      finish();
      continue;
    }
    if (current.member === "") {
      const member = canonicalMember(token.text);
      if (member !== "") {
        current.member = member;
      }
      continue;
    }
    if (token.kind === "word" && token.text === "REPLACING") {
      current.replacing = true;
    }
  }
  finish();

  return references;
}

function nodeId(source: CopybookGraphSource): string {
  return `${source.kind}:${source.artifact}`;
}

function compareNodes(
  left: CopybookGraphNode,
  right: CopybookGraphNode,
): number {
  return compareText(left.id, right.id);
}

function compareEdges(
  left: CopybookGraphEdge,
  right: CopybookGraphEdge,
): number {
  return (
    compareText(left.source, right.source) ||
    left.line - right.line ||
    compareText(left.member, right.member) ||
    compareText(left.status, right.status) ||
    Number(left.replacing) - Number(right.replacing) ||
    compareText(left.targets.join("\u0000"), right.targets.join("\u0000"))
  );
}

/** Strongly connected groups in the resolved copybook-only graph. */
function copybookCycles(
  nodes: readonly CopybookGraphNode[],
  edges: readonly CopybookGraphEdge[],
): string[][] {
  const copybookIds = nodes
    .filter((node) => node.kind === "copybook")
    .map((node) => node.id)
    .sort(compareText);
  const copybookIdSet = new Set(copybookIds);
  const adjacency = new Map(
    copybookIds.map((id) => [id, new Set<string>()] as const),
  );
  for (const edge of edges) {
    const target = edge.targets[0];
    if (
      edge.status === "resolved" &&
      copybookIdSet.has(edge.source) &&
      target !== undefined
    ) {
      adjacency.get(edge.source)?.add(target);
    }
  }

  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (id: string): void => {
    const index = nextIndex;
    nextIndex += 1;
    indices.set(id, index);
    lowLinks.set(id, index);
    stack.push(id);
    onStack.add(id);

    const targets = [...(adjacency.get(id) ?? [])].sort(compareText);
    for (const target of targets) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(
          id,
          Math.min(lowLinks.get(id) ?? index, lowLinks.get(target) ?? index),
        );
      } else if (onStack.has(target)) {
        lowLinks.set(
          id,
          Math.min(lowLinks.get(id) ?? index, indices.get(target) ?? index),
        );
      }
    }

    if (lowLinks.get(id) !== indices.get(id)) {
      return;
    }
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member !== undefined) {
        onStack.delete(member);
        component.push(member);
      }
    } while (member !== id && member !== undefined);
    component.sort(compareText);
    const selfCycle = component.length === 1 && adjacency.get(id)?.has(id);
    if (component.length > 1 || selfCycle === true) {
      components.push(component);
    }
  };

  for (const id of copybookIds) {
    if (!indices.has(id)) {
      visit(id);
    }
  }
  return components.sort((left, right) =>
    compareText(left.join("\u0000"), right.join("\u0000")),
  );
}

/**
 * Resolve every program and copybook reference against caller-supplied `.cpy`
 * members. Resolution is case-insensitive; duplicate member names remain
 * visible as ambiguous edges instead of being selected by input order.
 */
export function buildCopybookDependencyGraph(
  sources: readonly CopybookGraphSource[],
): CopybookDependencyGraph {
  const orderedSources = [...sources].sort((left, right) =>
    compareText(nodeId(left), nodeId(right)),
  );
  const nodes = orderedSources
    .map<CopybookGraphNode>((source) => ({
      id: nodeId(source),
      kind: source.kind,
      artifact: source.artifact,
      member:
        source.kind === "copybook" ? canonicalMember(source.member) : null,
    }))
    .sort(compareNodes);

  const seenIds = new Set<string>();
  for (const node of nodes) {
    if (seenIds.has(node.id)) {
      throw new CompilerInvariant(
        `Duplicate copybook graph source: ${node.id}`,
      );
    }
    seenIds.add(node.id);
    if (node.kind === "copybook" && node.member === "") {
      throw new CompilerInvariant(
        `Copybook graph source has no member name: ${node.id}`,
      );
    }
  }

  const candidates = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.kind !== "copybook" || node.member === null) {
      continue;
    }
    const members = candidates.get(node.member) ?? [];
    members.push(node.id);
    members.sort(compareText);
    candidates.set(node.member, members);
  }

  const sourceById = new Map(
    orderedSources.map((source) => [nodeId(source), source] as const),
  );
  const edges: CopybookGraphEdge[] = [];
  for (const node of nodes) {
    const source = sourceById.get(node.id);
    if (!source) {
      continue;
    }
    for (const reference of parseCopyReferences(source.text)) {
      const targets = [...(candidates.get(reference.member) ?? [])].sort(
        compareText,
      );
      edges.push({
        source: node.id,
        member: reference.member,
        line: reference.line,
        replacing: reference.replacing,
        status:
          targets.length === 0
            ? "missing"
            : targets.length === 1
              ? "resolved"
              : "ambiguous",
        targets,
      });
    }
  }
  edges.sort(compareEdges);

  return {
    schemaVersion: 1,
    semanticExpansion: false,
    nodes,
    edges,
    cycles: copybookCycles(nodes, edges),
  };
}

function mermaidText(text: string): string {
  let rendered = "";
  let previousWasControl = false;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isControl =
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029;
    if (isControl) {
      if (!previousWasControl) {
        rendered += " ";
      }
      previousWasControl = true;
      continue;
    }
    previousWasControl = false;
    switch (character) {
      case "&":
        rendered += "&amp;";
        break;
      case "`":
        rendered += "&#96;";
        break;
      case '"':
        rendered += "&quot;";
        break;
      case "'":
        rendered += "&#39;";
        break;
      case "<":
        rendered += "&lt;";
        break;
      case ">":
        rendered += "&gt;";
        break;
      case "[":
        rendered += "&#91;";
        break;
      case "]":
        rendered += "&#93;";
        break;
      default:
        rendered += character;
    }
  }
  return rendered;
}

/** A stable Mermaid Markdown rendering of a copybook dependency graph. */
export function renderCopybookDependencyGraph(
  graph: CopybookDependencyGraph,
): string {
  const nodeKeys = new Map(
    graph.nodes.map((node, index) => [node.id, `n${index}`] as const),
  );
  const missingMembers = [
    ...new Set(
      graph.edges
        .filter((edge) => edge.status === "missing")
        .map((edge) => edge.member),
    ),
  ].sort(compareText);
  const missingKeys = new Map(
    missingMembers.map((member, index) => [member, `m${index}`] as const),
  );
  const lines = ["```mermaid", "flowchart LR"];

  for (const node of graph.nodes) {
    const key = nodeKeys.get(node.id);
    if (!key) {
      continue;
    }
    const kind =
      node.kind === "program" ? "PROGRAM" : `COPYBOOK ${node.member}`;
    lines.push(
      `  ${key}["${mermaidText(kind)}<br/>${mermaidText(node.artifact)}"]`,
    );
  }
  for (const member of missingMembers) {
    lines.push(
      `  ${missingKeys.get(member)}["MISSING COPYBOOK ${mermaidText(member)}"]`,
    );
  }

  for (const edge of graph.edges) {
    const source = nodeKeys.get(edge.source);
    if (!source) {
      continue;
    }
    const replacing = edge.replacing ? " REPLACING" : "";
    const uncertain = edge.status === "resolved" ? "" : ` · ${edge.status}`;
    const label = mermaidText(
      `COPY ${edge.member}${replacing} · line ${edge.line}${uncertain}`,
    );
    if (edge.status === "missing") {
      lines.push(
        `  ${source} -.->|"${label}"| ${missingKeys.get(edge.member)}`,
      );
      continue;
    }
    for (const target of edge.targets) {
      const targetKey = nodeKeys.get(target);
      if (targetKey) {
        const arrow = edge.status === "resolved" ? "-->" : "-.->";
        lines.push(`  ${source} ${arrow}|"${label}"| ${targetKey}`);
      }
    }
  }

  const cycleKeys = [
    ...new Set(
      graph.cycles.flatMap((cycle) =>
        cycle.flatMap((id) => nodeKeys.get(id) ?? []),
      ),
    ),
  ].sort(compareText);
  if (cycleKeys.length > 0) {
    lines.push("  classDef cycle stroke-width:3px");
    lines.push(`  class ${cycleKeys.join(",")} cycle`);
  }

  return [
    ...lines,
    "```",
    "",
    "Resolved references are solid; missing and ambiguous references are dotted.",
    "`COPY REPLACING` is edge metadata only: source is not expanded or rewritten.",
  ].join("\n");
}
