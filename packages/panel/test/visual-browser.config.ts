import { defineConfig } from 'tsdown'
import { dshClientStyles } from '../../../scripts/tsdown-client-styles.ts'
import { canvasBrowserDependencies } from '../../../scripts/canvas-browser-dependencies.ts'
import { canvasBrowserAssets } from '../../../scripts/canvas-browser-assets.ts'
// This fixture rebundles sources/dependencies; it is not an installed-runtime font probe.
if (process.env.VISUAL_TEST_BUILT === '1') {
  throw new Error('VISUAL_TEST_BUILT mixes rebuilt sources with built files. Use a dedicated installed renderer probe; this fixture is source-only.')
}
const canvasAssets = canvasBrowserAssets(import.meta.url)
export default defineConfig({
  entry: { fixture: new URL(process.env.VISUAL_TEST_ENTRY ?? './visual-browser.tsx', import.meta.url).pathname }, outDir: process.env.VISUAL_TEST_OUT,
  format: 'esm', platform: 'browser', tsconfig: false, dts: false, clean: false,
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    ...(process.env.VISUAL_TEST_FLOW_PROBE === '1' ? [{ name: 'observe-navigation-flow', resolveId(source: string, importer: string | undefined) {
      return source === '@xyflow/react' && importer?.endsWith('/src/navigation-workspace.tsx')
        ? new URL('./navigation-flow-browser-probe.tsx', import.meta.url).pathname : null
    } }] : []),
    canvasBrowserDependencies(import.meta.url), canvasAssets.plugin,
    dshClientStyles('declarative-visual-test', import.meta.url, { preprocessCss: canvasAssets.preprocessCss }),
  ],
})
