import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const localNpm = join(root, ".tools", "npm", "bin", "npm-cli.js");
const npmCli = existsSync(localNpm) ? localNpm : null;

let result;
if (npmCli) {
  result = spawnSync(process.execPath, [npmCli, ...process.argv.slice(2)], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  });
} else {
  const candidates = process.platform === "win32" ? ["npm.cmd", "npm"] : ["npm"];
  for (const command of candidates) {
    result = spawnSync(command, process.argv.slice(2), {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      env: process.env,
    });
    if (!result.error || result.error.code !== "ENOENT") break;
  }
}

if (result.error) {
  console.error(`npm runner failed: ${result.error.message}`);
  if (result.error.code === "ENOENT") {
    console.error("Project-local npm is missing and no system npm executable was found. Run setup.ps1 or install Node.js/npm.");
  }
  process.exit(1);
}
process.exit(result.status ?? 1);
