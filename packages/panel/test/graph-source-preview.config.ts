/** Production GraphPanel in an isolated browser fixture; no presentation transforms. */
import { defineConfig } from 'tsdown'
import { graphLayoutWorker } from '../../../scripts/graph-layout-worker.ts'
import { graphBrowserDependencies } from '../../../scripts/graph-browser-dependencies.ts'

export default defineConfig({
  entry: { fixture: new URL('./graph-browser.tsx', import.meta.url).pathname },
  outDir: process.env.GRAPH_TEST_OUT,
  format: 'esm',
  platform: 'browser',
  tsconfig: false,
  dts: false,
  clean: false,
  inputOptions: { resolve: { conditionNames: ['import', 'browser', 'default'] } },
  plugins: [graphLayoutWorker(), graphBrowserDependencies()],
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  define: { 'process.env.NODE_ENV': '"production"' },
})
