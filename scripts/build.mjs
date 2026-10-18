import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const output = new URL('../dist/', import.meta.url);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('public/manifest.json', root), new URL('manifest.json', output));
await cp(new URL('src/popup/index.html', root), new URL('popup.html', output));
await cp(new URL('src/popup/styles.css', root), new URL('popup.css', output));

await build({
  entryPoints: [new URL('src/background/index.ts', root).pathname],
  outfile: new URL('background.js', output).pathname,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome106',
});

await build({
  entryPoints: [new URL('src/content/index.ts', root).pathname],
  outfile: new URL('content.js', output).pathname,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome106',
});

await build({
  entryPoints: [new URL('src/popup/index.ts', root).pathname],
  outfile: new URL('popup.js', output).pathname,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome106',
});

console.info('Built the unpacked Chrome extension in dist/.');
