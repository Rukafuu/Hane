import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directories = ['src', 'bin', 'test'];
const scripts = [];

for (const directory of directories) {
  const absolute = path.join(root, directory);
  walk(absolute);
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile() && entry.name.endsWith('.js')) scripts.push(absolute);
  }
}

if (scripts.length === 0) {
  console.error('no .js files found to check.');
  process.exit(1);
}

let failed = 0;
for (const script of scripts) {
  const result = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed += 1;
    console.error(result.stderr);
  }
}

console.log(`checked ${scripts.length} files with node --check.`);
process.exit(failed === 0 ? 0 : 1);
