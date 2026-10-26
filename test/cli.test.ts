import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => join(here, "fixtures", name);

function capture(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

describe("aocl-trace CLI", () => {
  it("exits 0 on a valid trace (warnings only)", () => {
    const { io, out } = capture();
    const code = runCli([fx("backup-check.ndjson")], io);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("01AOCL_CORR_0001");
    expect(out.join("\n")).toContain("OK");
  });

  it("exits 0 and prints per-layer lines with a stack", () => {
    const { io, out } = capture();
    const code = runCli([fx("backup-check.ndjson"), "--stack", fx("realtime-alert.json")], io);
    // realtime-alert flags missing/unexpected layers (warnings), still exit 0.
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("L0.ingress.normalize");
  });

  it("exits 2 with no arguments (usage)", () => {
    const { io } = capture();
    expect(runCli([], io)).toBe(2);
  });

  it("exits 2 when the trace file is missing", () => {
    const { io, err } = capture();
    expect(runCli([fx("does-not-exist.ndjson")], io)).toBe(2);
    expect(err.join("\n")).toContain("Cannot read trace file");
  });

  it("exits 2 on an unknown option", () => {
    const { io } = capture();
    expect(runCli(["--wat"], io)).toBe(2);
  });

  it("exits 1 with a clear message when the file yields zero events", () => {
    const { io, err } = capture();
    expect(runCli([fx("no-events.ndjson")], io)).toBe(1);
    expect(err.join("\n")).toContain("No AOCL events parsed");
  });
});
