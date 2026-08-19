// esbuild via its JS API rather than a CLI string: the shebang must own line 1,
// and a real newline does not survive an npm script argument.
//
// Dependencies stay external. Bundling them pulled the MCP SDK's own
// `createRequire` into the same scope as the one the PixelCraft engine needs for
// node:zlib, which collides; letting Node resolve them from node_modules is both
// simpler and smaller.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: 'dist/index.mjs',
  banner: { js: '#!/usr/bin/env node' }
})
