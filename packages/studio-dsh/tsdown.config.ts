import { withNormalBuildEvidence } from '../../scripts/normal-build-module-evidence.mjs'
import { defineConfig } from 'tsdown'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { prepareStudioAuthoringMaterial } from '../../scripts/studio-authoring-material.mjs'
import { preparePanelAuthoringMaterial } from '../../scripts/companion-authoring-material.mjs'
import { normalBuildModuleEvidence } from '../../scripts/normal-build-module-evidence.mjs'
import { dshClientStyles } from '../../scripts/tsdown-client-styles.ts'
import { cssResourceBuildOptions } from '../../scripts/css-resource-build-options.mjs'
import { canvasBrowserDependencies } from '../../scripts/canvas-browser-dependencies.ts'
import { graphLayoutWorker } from '../../scripts/graph-layout-worker.ts'
import { graphBrowserDependencies } from '../../scripts/graph-browser-dependencies.ts'

const panelConfigUrl = new URL('../panel/tsdown.config.ts', import.meta.url).href
const configRequire = createRequire(import.meta.url)
const authoringMaterial = await prepareStudioAuthoringMaterial(fileURLToPath(new URL('../../', import.meta.url)))
const panelAuthoringMaterial = await preparePanelAuthoringMaterial(fileURLToPath(new URL('../../', import.meta.url)))
const { parseSync } = await import(pathToFileURL(createRequire(configRequire.resolve('tsdown')).resolve('rolldown/utils')).href)

/** Rolldown can retain an eliminated self-edge in dynamicImports metadata.
 * Check emitted syntax as well: no actual import may escape the one module. */
function assertNoModuleImports(fileName: string, code: string): void {
  const parsed = parseSync(fileName, code)
  if (parsed.errors.length) throw new Error('Cannot parse standalone Studio browser module')
  const pending = [parsed.program]
  while (pending.length) {
    const node = pending.pop()!
    if (node.type === 'ImportExpression' || (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source)) {
      throw new Error('Studio page must emit one self-contained browser module without external imports')
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) pending.push(...value.filter(child => child && typeof child === 'object' && 'type' in child))
      else if (value && typeof value === 'object' && 'type' in value) pending.push(value)
    }
  }
}

const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-ui-slots',
]

export default withNormalBuildEvidence('dsh-release-studio-dsh', defineConfig([
  {
    entry: ['src/index.ts', 'src/authoring-agent.ts', 'src/authoring-session.ts', 'src/authoring-reference-store.ts', 'src/authoring-sources.ts', 'src/authoring.remote-client.ts', 'src/authoring.page-rpc.ts', 'src/authoring-host.ts', 'src/authoring-service.ts', 'src/authoring-entry.ts', 'src/authoring-workbench.tsx', 'src/client-adapter.tsx', 'src/page.ts', 'src/page-rpc.ts', 'src/page-path.ts', 'src/typert.host.ts', 'src/typert.remote-client.ts'],
    external: [/^@deepseek-ai\//, /^dsh-design-/, 'zod'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    plugins: [{ name: 'studio-creator-methods', generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'authoring/studio-creators/material.json', source: authoringMaterial.bytes })
      this.emitFile({ type: 'asset', fileName: 'authoring/panel-components.json', source: panelAuthoringMaterial.bytes })
    } }],
  },
  {
    entry: { client: 'src/client.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: PLATFORM_MODULES,
    noExternal: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify('dsh-design-studio-dsh')}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
  {
    entry: { 'page-client': 'src/page-client.tsx' },
    outDir: 'lib',
    format: 'esm',
    platform: 'browser',
    dts: false,
    sourcemap: false,
    clean: false,
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
    failOnWarn: true,
    hooks: normalBuildModuleEvidence('studio-dsh-page'),
    // The public Panel entry already owns its pinned canvas transformations.
    // Only remaining ordinary dependency CSS is collected for this page.
    plugins: [canvasBrowserDependencies(panelConfigUrl),
      dshClientStyles('dsh-design-studio-page', panelConfigUrl, {
        resources: cssResourceBuildOptions('dsh-design-studio-page'),
      }), graphLayoutWorker(), graphBrowserDependencies(), {
      name: 'studio-standalone-browser-closure',
      generateBundle(_options, bundle) {
        const chunks = Object.values(bundle).filter(output => output.type === 'chunk')
        if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.some(target => target !== chunks[0].fileName)) {
          const imports = chunks.map(({ fileName, imports, dynamicImports }) => ({ fileName, imports, dynamicImports }))
          throw new Error('Studio page must emit one self-contained browser module without external imports: ' + JSON.stringify(imports))
        }
        assertNoModuleImports(chunks[0].fileName, chunks[0].code)
      },
    }],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    outputOptions: { entryFileNames: 'page-client.js', codeSplitting: false },
  },
]))
