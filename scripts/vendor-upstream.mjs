// Explicit maintenance command; the installed extension never downloads executable code.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const upstream = 'https://api.github.com/repos/SkyCloudDev/ForumPostDownloader/commits/main';
const commitResponse = await fetch(upstream);
if (!commitResponse.ok) throw new Error(`GitHub: ${commitResponse.status}`);
const { sha } = await commitResponse.json();
const sources = {
  'forum-post-downloader.user.js': `https://raw.githubusercontent.com/SkyCloudDev/ForumPostDownloader/${sha}/dist/build.user.js`,
  'popper.min.js': 'https://unpkg.com/@popperjs/core@2.11.8/dist/umd/popper.min.js',
  'tippy.min.js': 'https://unpkg.com/tippy.js@6.3.7/dist/tippy-bundle.umd.min.js',
  'file-saver.min.js': 'https://unpkg.com/file-saver@2.0.4/dist/FileSaver.min.js',
  'jszip.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js',
  'sha256.min.js': 'https://raw.githubusercontent.com/geraintluff/sha256/gh-pages/sha256.min.js',
  'popper.LICENSE.txt': 'https://unpkg.com/@popperjs/core@2.11.8/LICENSE.md',
  'tippy.LICENSE.txt': 'https://unpkg.com/tippy.js@6.3.7/LICENSE',
  'file-saver.LICENSE.txt': 'https://unpkg.com/file-saver@2.0.4/LICENSE.md',
  'jszip.LICENSE.txt': 'https://unpkg.com/jszip@3.1.5/LICENSE.markdown',
  'sha256.LICENSE.txt': 'https://raw.githubusercontent.com/geraintluff/sha256/gh-pages/README.md',
};
await mkdir(new URL('../vendor/', import.meta.url), { recursive: true });
const files = {};
for (const [name, url] of Object.entries(sources)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(`../vendor/${name}`, import.meta.url), bytes);
  files[name] = { url, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(new URL('../vendor/provenance.json', import.meta.url), JSON.stringify({
  commit: sha, retrievedAt: new Date().toISOString(), files,
}, null, 2) + '\n');
console.log(`Vendored ForumPostDownloader ${sha}, five dependencies and their license notices.`);
