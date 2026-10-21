import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: { fixture: new URL('./whiteboard-browser.tsx', import.meta.url).pathname }, outDir: process.env.WHITEBOARD_TEST_OUT,
  format: 'esm', platform: 'browser', tsconfig: false, dts: false, clean: false,
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  define: { 'process.env.NODE_ENV': '"production"' },
})
