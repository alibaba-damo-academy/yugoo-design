import { defineConfig } from 'tsdown'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshClientStyles } from '../../scripts/tsdown-client-styles.ts'
import { cssResourceBuildOptions } from '../../scripts/css-resource-build-options.mjs'
import { canvasBrowserDependencies } from '../../scripts/canvas-browser-dependencies.ts'
import { canvasBrowserAssets } from '../../scripts/canvas-browser-assets.ts'

const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const ID = 'dsh-design-provider-web-app'
const clientAssets = canvasBrowserAssets(import.meta.url)
const REACT_RESIZABLE_PANELS_BROWSER = join(
  dirname(fileURLToPath(import.meta.resolve('react-resizable-panels/package.json'))),
  'dist/react-resizable-panels.browser.js',
)

/** Resolve browser-only dependency entries shared by production and browser fixtures. */
export function webAppBrowserDependencies() {
  return {
    name: 'dsh-design-provider-web-app-browser-deps',
    resolveId(this: { resolve(source: string, importer: string | undefined, options: { skipSelf: boolean }): Promise<{ id: string } | null> }, source: string, importer: string | undefined) {
      if (source === '@excalidraw/excalidraw/index.css') {
        const css = join(dirname(fileURLToPath(import.meta.resolve('@excalidraw/excalidraw'))), 'index.css')
        return this.resolve(css, importer, { skipSelf: true })
      }
      if (source === 'react-resizable-panels') return REACT_RESIZABLE_PANELS_BROWSER
      if (source === 'yaml') {
        return join(dirname(fileURLToPath(import.meta.url)), 'node_modules/yaml/browser/index.js')
      }
      const vfileBrowserImports: Readonly<Record<string, string>> = {
        '#minpath': 'minpath.browser.js',
        '#minproc': 'minproc.browser.js',
        '#minurl': 'minurl.browser.js',
      }
      const browserFile = vfileBrowserImports[source]
      if (browserFile !== undefined && importer !== undefined && /[\\/]node_modules[\\/]vfile[\\/]lib[\\/]index\.js$/.test(importer)) {
        return join(dirname(importer), browserFile)
      }
      return null
    },
  }
}

export default defineConfig([
  {
    entry: ['src/index.ts'],
    external: [
      /^@deepseek-ai\/cordis/,
      /^@deepseek-ai\/dsh-tools/,
      /^dsh-design-core/,
      /^yaml/,
    ],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    // tsdown defaults CJS resolution to Node even for a browser factory.
    inputOptions: { platform: 'browser', resolve: { conditionNames: ['browser', 'import', 'default'], mainFields: ['browser', 'module', 'main'] } },
    dts: false,
    sourcemap: true,
    clean: false,
    external: PLATFORM_MODULES,
    noExternal: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      // DSH loads one factory and only resolves platform modules, not chunks.
      codeSplitting: false,
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
    plugins: [canvasBrowserDependencies(import.meta.url), clientAssets.plugin, webAppBrowserDependencies(),
      dshClientStyles(ID, import.meta.url, { preprocessCss: clientAssets.preprocessCss, resources: cssResourceBuildOptions('dsh-design-provider-web-app-client') })],
  },
])
