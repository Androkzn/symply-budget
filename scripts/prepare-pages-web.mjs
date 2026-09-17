import { access, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const rule = '/assets/node_modules/* /assets/vendor/:splat 200';

// Pages excludes every node_modules directory, including Expo's exported
// fonts/images. Copy ONLY the compiled dependency assets, never the source
// node_modules tree, and preserve their original URLs with a Pages rewrite.
export async function preparePagesWeb(directory) {
  if (!directory) throw new Error('Usage: node scripts/prepare-pages-web.mjs <expo-export-directory>');
  const output = resolve(directory);
  await access(join(output, 'index.html'));
  const assets = join(output, 'assets', 'node_modules');
  await access(assets);
  await cp(assets, join(output, 'assets', 'vendor'), { recursive: true });
  const redirectsPath = join(output, '_redirects');
  const existing = await readFile(redirectsPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (!existing.split(/\r?\n/).includes(rule)) {
    await writeFile(redirectsPath, rule + '\n' + existing, 'utf8');
  }
  return { output, dependencyAssets: 'assets/vendor', originalAssetsPreserved: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await preparePagesWeb(process.argv[2]), null, 2));
}
