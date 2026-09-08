import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const directory of ['src', 'vendor', 'scripts']) {
  for (const file of await readdir(new URL(`../${directory}/`, import.meta.url))) {
    if (!/\.m?js$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('All JavaScript syntax checks passed.');
