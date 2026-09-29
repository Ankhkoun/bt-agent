import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const agentDir = process.env.PI_CODING_AGENT_DIR || join(root, '.bt', 'agent');
let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK' : 'MISSING'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
}
const [major, minor] = process.versions.node.split('.').map(Number);
check('Node >=22.19.0', major > 22 || (major === 22 && minor >= 19), process.versions.node);
const git = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
check('Git', git.status === 0, git.stdout?.trim());
const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', 'exit 0'] : ['-c', 'exit 0'];
check('Shell', spawnSync(shell, shellArgs, { windowsHide: true }).status === 0);
const pkgPath = join(root, 'node_modules/@earendil-works/pi-coding-agent/package.json');
check('Pi package', existsSync(pkgPath), existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')).version : 'run setup.cmd');
for (const name of ['profile', 'goals', 'tasks', 'projects', 'knowledge_map', 'learning_log', 'bt_memory']) {
  check(`memory/${name}.md`, existsSync(join(root, 'memory', `${name}.md`)));
}
console.log(`Private Pi directory: ${agentDir}`);
console.log(`Pi auth file exists: ${existsSync(join(agentDir, 'auth.json'))} (contents not inspected)`);
console.log('Configure credentials with /login or provider environment variables; /model chooses a model.');
process.exitCode = failures ? 1 : 0;
