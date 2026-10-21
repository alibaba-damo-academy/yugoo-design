import { defineConfig } from 'tsdown'
import { webAppBrowserDependencies } from '../tsdown.config.ts'

export default defineConfig({
  entry: ['./resizable-pointer.tsx'],
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  resolve: { conditionNames: ['import', 'browser', 'default'] },
  noExternal: () => true,
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  plugins: [webAppBrowserDependencies()],
})
