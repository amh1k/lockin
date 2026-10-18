import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('../dist/', import.meta.url);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('public/manifest.json', root), new URL('manifest.json', output));
await cp(new URL('public/icons/', root), new URL('icons/', output), { recursive: true });
await cp(new URL('src/offscreen/index.html', root), new URL('offscreen.html', output));
await cp(new URL('src/popup/index.html', root), new URL('popup.html', output));
await cp(new URL('src/popup/styles.css', root), new URL('popup.css', output));

await build({
  entryPoints: [fileURLToPath(new URL('src/background/index.ts', root))],
  outfile: fileURLToPath(new URL('background.js', output)),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome106',
});

await build({
  entryPoints: [fileURLToPath(new URL('src/content/index.ts', root))],
  outfile: fileURLToPath(new URL('content.js', output)),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome106',
});

await build({
  entryPoints: [fileURLToPath(new URL('src/popup/index.ts', root))],
  outfile: fileURLToPath(new URL('popup.js', output)),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome106',
});

await build({ entryPoints: { offscreen: fileURLToPath(new URL('src/offscreen/index.ts', root)), 'inference-worker': fileURLToPath(new URL('src/offscreen/worker.ts', root)) }, outdir: fileURLToPath(output), bundle: true, format: 'esm', platform: 'browser', target: 'chrome116' });

console.info('Built the unpacked Chrome extension in dist/.');
