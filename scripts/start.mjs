import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { root } from './init-memory.mjs';

const cli = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js');
if (!existsSync(cli)) {
  console.error('Dependencies missing. Run setup.cmd first.');
  process.exit(1);
}
const agentDir = process.env.PI_CODING_AGENT_DIR || join(root, '.bt', 'agent');
await mkdir(agentDir, { recursive: true });
const child = spawn(process.execPath, [cli, '--approve', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
});
process.on('SIGINT', () => { /* The terminal also delivers Ctrl+C to Pi. */ });
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('error', (error) => { console.error(`BT startup failed: ${error.message}`); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
