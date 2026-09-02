// tsdown config — output layout matches the shipped app:
//   src/bin.ts            -> lib/bin.js              (CLI entry; roots entry set at package base,
//                                                     tsdown keeps the src/ segment for other entries)
//   src/bridge/index.ts   -> lib/src/bridge/index.js (cordis plugin row name in cordis.yml)
// fixedExtension: false + package "type": "module" -> plain .js ESM outputs.
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    bin: 'src/bin.ts',
    'src/bridge/index': 'src/bridge/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'lib',
  fixedExtension: false,
  clean: true,
  sourcemap: false,
})
