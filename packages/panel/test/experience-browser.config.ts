import { defineConfig } from 'tsdown'
import { graphLayoutWorker } from '../../../scripts/graph-layout-worker.ts'
export default defineConfig({ entry: { fixture: new URL('./experience-browser.tsx', import.meta.url).pathname }, outDir: process.env.EXPERIENCE_TEST_OUT,
  format: 'esm', platform: 'browser', tsconfig: false, dts: false, clean: false,
  plugins: [graphLayoutWorker()], deps: { alwaysBundle: [/.*/], onlyBundle: false }, define: { 'process.env.NODE_ENV': '"production"' } })
