#!/usr/bin/env node
/**
 * aocl-trace bin wrapper. Delegates to the compiled CLI in dist/.
 * Run `npm run build` first (dist/ is produced by tsc, not checked in).
 */
import { runCli } from "../dist/cli.js";

const io = {
  out: (line) => process.stdout.write(line + "\n"),
  err: (line) => process.stderr.write(line + "\n"),
};

process.exit(runCli(process.argv.slice(2), io));
