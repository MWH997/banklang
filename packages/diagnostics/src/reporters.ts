import { formatDiagnostic, type Diagnostic } from "../../ast/src/index";

import { explainDiagnostic } from "./index";

export type DiagnosticFormat = "text" | "json" | "sarif";

export const DIAGNOSTIC_FORMATS: DiagnosticFormat[] = ["text", "json", "sarif"];

export function isDiagnosticFormat(value: string): value is DiagnosticFormat {
  return (DIAGNOSTIC_FORMATS as string[]).includes(value);
}

export function renderDiagnostics(
  diagnostics: Diagnostic[],
  format: DiagnosticFormat,
): string {
  switch (format) {
    case "json":
      return renderJson(diagnostics);
    case "sarif":
      return renderSarif(diagnostics);
    case "text":
      return `${diagnostics.map(formatDiagnostic).join("\n\n")}\n`;
  }
}

function renderJson(diagnostics: Diagnostic[]): string {
  return `${JSON.stringify(
    {
      version: 1,
      diagnostics: diagnostics.map((diagnostic) => {
        const doc = explainDiagnostic(diagnostic.id);
        return {
          id: diagnostic.id,
          severity: diagnostic.severity,
          message: diagnostic.message,
          hint: diagnostic.hint,
          title: doc?.title ?? null,
          explanation: doc?.explanation ?? null,
          file: diagnostic.span?.sourceFile ?? null,
          line: diagnostic.span?.start.line ?? null,
          column: diagnostic.span?.start.column ?? null,
          endLine: diagnostic.span?.end.line ?? null,
          endColumn: diagnostic.span?.end.column ?? null,
        };
      }),
    },
    null,
    2,
  )}\n`;
}

/**
 * SARIF 2.1.0, the format GitHub code scanning ingests.
 *
 * Emitting this means `bankc check --format sarif` output can be uploaded by
 * the `codeql-action/upload-sarif` action, and banking safety diagnostics then
 * appear as inline annotations on a pull request rather than buried in a log.
 */
function renderSarif(diagnostics: Diagnostic[]): string {
  const used = [...new Set(diagnostics.map((diagnostic) => diagnostic.id))];

  const rules = used.map((id) => {
    const doc = explainDiagnostic(id);
    return {
      id,
      name: doc?.title ?? id,
      shortDescription: { text: doc?.title ?? id },
      fullDescription: { text: doc?.explanation ?? "" },
      help: {
        text: doc
          ? `${doc.explanation}\n\nRemediation: ${doc.remediation}`
          : "",
        markdown: doc
          ? `${doc.explanation}\n\n**Remediation:** ${doc.remediation}`
          : "",
      },
      properties: { tags: ["banklang", namespaceTag(id)] },
    };
  });

  const results = diagnostics.map((diagnostic) => ({
    ruleId: diagnostic.id,
    ruleIndex: used.indexOf(diagnostic.id),
    level: sarifLevel(diagnostic.severity),
    message: {
      text: diagnostic.hint
        ? `${diagnostic.message} ${diagnostic.hint}`
        : diagnostic.message,
    },
    locations: diagnostic.span
      ? [
          {
            physicalLocation: {
              artifactLocation: {
                uri: toUri(diagnostic.span.sourceFile),
              },
              region: {
                startLine: diagnostic.span.start.line,
                startColumn: diagnostic.span.start.column,
                endLine: diagnostic.span.end.line,
                endColumn: diagnostic.span.end.column,
              },
            },
          },
        ]
      : [],
  }));

  return `${JSON.stringify(
    {
      $schema:
        "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "bankc",
              informationUri: "https://github.com/MWH997/banklang",
              rules,
            },
          },
          results,
        },
      ],
    },
    null,
    2,
  )}\n`;
}

function sarifLevel(severity: Diagnostic["severity"]): string {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    default:
      return "note";
  }
}

function namespaceTag(id: string): string {
  return id.split("-")[1]?.toLowerCase() ?? "unknown";
}

/** SARIF wants repository-relative, forward-slash URIs. */
function toUri(sourceFile: string): string {
  return sourceFile.replace(/\\/g, "/").replace(/^\.\//, "");
}
