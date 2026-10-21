import { defineConfig } from 'tsdown'
import { dshClientStyles } from '../../../scripts/tsdown-client-styles.ts'

export default defineConfig({
  entry: { 'auto-browser': new URL('./auto-browser.tsx', import.meta.url).pathname },
  outDir: process.env.AUTO_BROWSER_OUT,
  format: 'esm', platform: 'browser', tsconfig: false, dts: false, clean: false,
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [dshClientStyles('auto-panel-browser-test', import.meta.url)],
})
