import { constants } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export async function initializeMemory() {
  const destination = join(root, 'memory');
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(join(root, 'templates', 'memory'))) {
    if (!name.endsWith('.md')) continue;
    try {
      await copyFile(join(root, 'templates', 'memory', name), join(destination, name), constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

// Safe to run repeatedly: existing personal records are never overwritten.
await initializeMemory();
