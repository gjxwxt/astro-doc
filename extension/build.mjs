import { build } from 'esbuild';

await build({
  entryPoints: ['extension/src/explosion.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  outfile: 'extension/explosion.bundle.js',
  minify: true,
  legalComments: 'inline',
  logLevel: 'info',
});
