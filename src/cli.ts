/**
 * aocl-trace CLI: validate + pretty-print a layer trace file, optionally
 * against a stack definition.
 *
 * Exit codes:
 *   0  trace parsed and no error-severity findings (warnings allowed)
 *   1  parsed but validation failed (error-severity findings present)
 *   2  usage error, unreadable file, or malformed stack definition
 */

import { readFileSync } from "node:fs";
import type { Finding } from "./types.js";
import { loadStack, validateStack } from "./stack.js";
import { normalizeAll, parseNdjson } from "./normalize.js";

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = `Usage: aocl-trace <trace.ndjson> [--stack <stack.json>]

Validate and pretty-print an AOCL layer trace (NDJSON of AEE envelopes).
Optionally check it against a stack definition with --stack.

Exit: 0 = valid, 1 = validation errors, 2 = usage/IO error.`;

function fmtFinding(f: Finding): string {
  const sev = f.severity === "error" ? "ERROR" : "warn ";
  const layer = f.layer ? ` [${f.layer}]` : "";
  return `  ${sev} ${f.code}${layer}: ${f.detail ?? f.reason}`;
}

export function runCli(argv: string[], io: CliIo): number {
  const args = argv.slice();
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    io.out(USAGE);
    return args.length === 0 ? 2 : 0;
  }

  let tracePath: string | undefined;
  let stackPath: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--stack") {
      stackPath = args[i + 1];
      i += 1;
    } else if (!a.startsWith("-")) {
      tracePath = a;
    } else {
      io.err(`Unknown option: ${a}`);
      return 2;
    }
  }

  if (!tracePath) {
    io.err("A trace file path is required.");
    io.err(USAGE);
    return 2;
  }

  let traceText: string;
  try {
    traceText = readFileSync(tracePath, "utf8");
  } catch {
    io.err(`Cannot read trace file: ${tracePath}`);
    return 2;
  }

  let stack;
  if (stackPath) {
    let stackText: string;
    try {
      stackText = readFileSync(stackPath, "utf8");
    } catch {
      io.err(`Cannot read stack file: ${stackPath}`);
      return 2;
    }
    try {
      stack = loadStack(stackText);
    } catch (e) {
      io.err(`Malformed stack JSON: ${(e as Error).message}`);
      return 2;
    }
    const sv = validateStack(stack);
    io.out(`Stack: ${stack.stack_id} (${stack.mode}): ${sv.valid ? "valid" : "INVALID"}`);
    for (const f of sv.findings) io.out(fmtFinding(f));
    if (!sv.valid) return 1;
  }

  const { events, parseErrors } = parseNdjson(traceText);
  for (const pe of parseErrors) io.out(fmtFinding(pe));

  // MINOR (a): a file that yields zero events is a failure, not a silent pass.
  if (events.length === 0) {
    io.err(`No AOCL events parsed from ${tracePath} (empty file or no valid JSON lines).`);
    return 1;
  }

  const traces = normalizeAll(events, stack ? { stack } : {});
  let hasError = parseErrors.some((f) => f.severity === "error");

  for (const t of traces) {
    io.out("");
    io.out(`corr ${t.corr}  stack=${t.stackId ?? "?"}  run=${t.runId ?? "?"}  ${t.valid ? "OK" : "VIOLATIONS"}`);
    for (const l of t.layers) {
      const codes = l.decisions.map((d) => d.code).join(",") || "-";
      io.out(`  ${l.id.padEnd(22)} idx=${l.index}  ${codes}`);
    }
    for (const f of t.findings) io.out(fmtFinding(f));
    if (!t.valid) hasError = true;
  }

  return hasError ? 1 : 0;
}
