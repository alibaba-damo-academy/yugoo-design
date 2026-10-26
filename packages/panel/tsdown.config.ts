import { defineConfig } from 'tsdown'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dshClientStyles } from '../../scripts/tsdown-client-styles.ts'
import { cssResourceBuildOptions } from '../../scripts/css-resource-build-options.mjs'
import { graphLayoutWorker } from '../../scripts/graph-layout-worker.ts'
import { graphBrowserDependencies } from '../../scripts/graph-browser-dependencies.ts'
import { canvasBrowserDependencies } from '../../scripts/canvas-browser-dependencies.ts'
import { canvasBrowserAssets } from '../../scripts/canvas-browser-assets.ts'

/**
 * Module specifiers the dsh web shell shares into the frozen module table.
 * The client bundle keeps these external and resolves them at runtime through
 * the injected `require`; everything else is inlined. Mirrors dsh's
 * packages/client/web/src/platform.ts PLATFORM_MODULES plus the runtime store
 * exemption.
 */
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

const ID = 'dsh-design-panel'
const configRequire = createRequire(import.meta.url)
const { esmExternalRequirePlugin } = await import(pathToFileURL(
  createRequire(configRequire.resolve('tsdown')).resolve('rolldown/plugins'),
).href)
// One descriptor per fresh release build; watch/cache reuse is not supported here.
const interpreterAssets = canvasBrowserAssets(import.meta.url)
const clientAssets = canvasBrowserAssets(import.meta.url)

export default defineConfig([
  // Node half: exists so the Loader row mounts and the ClientModuleRegistry can
  // discover the dsh.client manifest.
  {
    entry: ['src/host.ts', 'src/index.ts', 'src/client-api.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    plugins: [graphLayoutWorker()],
  },
  // Keep the standalone control in its own build graph. Adding it to the broad
  // client-api build would let shared chunks retain workspace/canvas imports.
  {
    entry: ['src/select.ts'],
    outDir: 'lib',
    format: 'esm',
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: false,
  },
  // Reusable browser renderer: do not inherit Node's createRequire shim.
  {
    entry: ['src/interpreter.ts'],
    outDir: 'lib',
    format: 'esm',
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: false,
    // Exact package roots do not cover CSS subpaths in tsdown's dependency matcher.
    // Keep this stylesheet in the graph so the original scoped-CSS preprocessor runs.
    // Let the ESM peer plugin see CJS React edges before automatic peer
    // externalization makes them opaque browser require helpers.
    noExternal: ['react', 'elkjs', '@excalidraw/excalidraw', '@excalidraw/excalidraw/index.css', 'bpmn-js'],
    plugins: [esmExternalRequirePlugin({ external: ['react'] }), canvasBrowserDependencies(import.meta.url), interpreterAssets.plugin,
      dshClientStyles(ID, import.meta.url, { preprocessCss: interpreterAssets.preprocessCss, resources: cssResourceBuildOptions('dsh-design-panel-renderer') })],
  },
  // Browser client half: a closure-factory artifact. The bundle calls
  // window.__ModuleLoader__.load({ id, factory }) and resolves externals
  // through the injected require (loader module table).
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    // Keep conditional package imports on their browser branches. Without an
    // explicit list tsdown 0.22 can resolve vfile's #minpath/#minproc/#minurl
    // imports through the Node condition before Rolldown sees the graph,
    // leaking node:* requires into the Harness module table.
    inputOptions: {
      platform: 'browser',
      resolve: { conditionNames: ['browser', 'import', 'default'], mainFields: ['browser', 'module', 'main'] },
    },
    dts: false,
    sourcemap: true,
    clean: false,
    external: PLATFORM_MODULES,
    // tsdown auto-externalizes package dependencies; anything NOT in the
    // platform externals must be inlined, or the browser module table lookup
    // fails at load time (e.g. require("yaml")). Mirrors dsh's clientBundle.
    noExternal: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      codeSplitting: false,
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
    plugins: [canvasBrowserDependencies(import.meta.url), clientAssets.plugin, {
      // The client runs in the browser module table, which answers only
      // platform modules. Force known conditional dependencies to their
      // browser implementations before tsdown resolves package imports.
      name: 'dsh-design-panel-browser-deps',
      resolveId(source: string, importer: string | undefined) {
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
    }, dshClientStyles(ID, import.meta.url, { preprocessCss: clientAssets.preprocessCss, resources: cssResourceBuildOptions('dsh-design-panel-client') }), graphLayoutWorker(), graphBrowserDependencies()],
  },
])
