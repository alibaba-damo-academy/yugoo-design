import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  external: ['react', 'react/jsx-runtime', 'react-dom', 'dsh-design-studio'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'browser',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
})
