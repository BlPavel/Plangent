/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */
// Cross-platform postinstall: make node-pty's spawn-helper executable on macOS.
// On Windows/Linux this is a no-op. Runs via `node`, so it doesn't depend on
// the shell (cmd.exe on Windows has no chmod and breaks bash-only syntax).
const { chmodSync, existsSync } = require("node:fs");
const { join } = require("node:path");

if (process.platform !== "darwin") process.exit(0);

const helper = join(
  __dirname,
  "..",
  "node_modules",
  "node-pty",
  "prebuilds",
  "darwin-arm64",
  "spawn-helper",
);

try {
  if (existsSync(helper)) chmodSync(helper, 0o755);
} catch (err) {
  // Non-fatal: never fail `npm install` over this.
  console.warn("postinstall: could not chmod spawn-helper:", err.message);
}
