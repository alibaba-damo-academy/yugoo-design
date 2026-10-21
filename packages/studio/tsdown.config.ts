import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  // The Design Core domain model stays external; the Studio consumes its
  // public Kit/Bundle loader and validation as the single authority.
  external: [/^dsh-design-core/],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
})
