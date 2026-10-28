/**
 * Cross-platform Python launcher for npm scripts.
 * Prefers a real interpreter; skips the Windows Store `python3` stub (exit 9009).
 */
import { spawnSync } from "node:child_process";

const scriptArgs = process.argv.slice(2);
if (scriptArgs.length === 0) {
  console.error("usage: node scripts/run_python.mjs <script.py> [args...]");
  process.exit(2);
}

const win = process.platform === "win32";
const candidates = win
  ? [
      ["py", ["-3", ...scriptArgs]],
      ["python", scriptArgs],
      ["python3", scriptArgs],
    ]
  : [
      ["python3", scriptArgs],
      ["python", scriptArgs],
    ];

for (const [cmd, args] of candidates) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  const err = /** @type {NodeJS.ErrnoException | undefined} */ (result.error);
  if (err?.code === "ENOENT") continue;
  // Windows App Execution Alias for missing python3/python
  if (win && (result.status === 9009 || result.status === 49)) continue;
  process.exit(result.status === null ? 1 : result.status);
}

console.error("Python not found (tried py -3, python, python3)");
process.exit(1);
