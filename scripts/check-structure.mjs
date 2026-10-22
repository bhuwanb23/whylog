/**
 * Run the structural checker on whichever Python the machine has.
 *
 * The checker is pure Python 3 with no dependencies, which is the point: it runs
 * before `npm install` and on a machine with nothing else on it. But the name
 * of the interpreter is not the same everywhere — `python3` on Linux and macOS,
 * `python` on Windows — and an npm script cannot branch on the OS.
 *
 * Node is always present (it is a Node project), so Node picks the interpreter.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checker = join(here, "check_structure.py");

const candidates = ["python3", "python"];

for (const interpreter of candidates) {
  const probe = spawnSync(interpreter, ["--version"], { stdio: "ignore" });
  if (probe.error !== undefined || probe.status !== 0) continue;

  const result = spawnSync(interpreter, [checker], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

console.error(
  "No Python 3 found. The structural checker needs it:\n" +
    "  python3 scripts/check_structure.py   (Linux, macOS)\n" +
    "  python  scripts/check_structure.py   (Windows)",
);
process.exit(1);
