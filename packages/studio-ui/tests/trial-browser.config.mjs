export default {
  entry: ['trial-browser.tsx'], outDir: '../lib-trial-browser', platform: 'browser',
  format: 'esm', dts: false, clean: false, deps: { alwaysBundle: [/./] },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
}
