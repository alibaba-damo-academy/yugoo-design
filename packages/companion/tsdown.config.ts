import { defineConfig } from 'tsdown'
import { dshClientStyles } from '../../scripts/tsdown-client-styles.ts'
import { webAppBrowserDependencies } from '../provider-web-app/tsdown.config.ts'
import { graphLayoutWorker } from '../../scripts/graph-layout-worker.ts'
import { graphBrowserDependencies } from '../../scripts/graph-browser-dependencies.ts'
import { canvasBrowserAssets } from '../../scripts/canvas-browser-assets.ts'
import { canvasBrowserDependencies } from '../../scripts/canvas-browser-dependencies.ts'
import { cssResourceBuildOptions } from '../../scripts/css-resource-build-options.mjs'
import { fileURLToPath } from 'node:url'
import { normalBuildModuleEvidence } from '../../scripts/normal-build-module-evidence.mjs'
import { componentSkillResource } from '../../scripts/component-skill-resource.ts'
import { companionSourceLabels } from '../../scripts/companion-source-labels.mjs'

const panelConfigUrl = new URL('../panel/tsdown.config.ts', import.meta.url).href
const canvasAssets = canvasBrowserAssets(panelConfigUrl)

export default defineConfig({
  entry: { client: 'src/client.tsx' }, outDir: 'dist', format: 'esm', platform: 'browser',
  // Typecheck-only .d.ts aliases must never be bundled as executable modules.
  tsconfig: false,
  dts: false, clean: true, deps: { alwaysBundle: [/.*/], onlyBundle: false },
  failOnWarn: true,
  hooks: normalBuildModuleEvidence('web'),
  inputOptions: { resolve: { conditionNames: ['import', 'browser', 'default'] } },
  alias: {
    'dsh-design-panel/client-api': new URL('../panel/src/client-api.ts', import.meta.url).pathname,
    'dsh-design-panel/sample-preview': new URL('../panel/src/sample-preview.tsx', import.meta.url).pathname,
    'dsh-design-core/dsl': fileURLToPath(new URL('../core/src/panel-dsl.ts', import.meta.url)),
    'dsh-design-core/experience-view': fileURLToPath(new URL('../core/src/experience-view.ts', import.meta.url)),
    'dsh-design-core/source-reference': fileURLToPath(new URL('../core/src/design-source-reference.ts', import.meta.url)),
    react: new URL('../panel/node_modules/react', import.meta.url).pathname,
    'react-dom': new URL('../panel/node_modules/react-dom', import.meta.url).pathname,
    '@deepseek-ai/cordis': new URL('../panel/node_modules/@deepseek-ai/cordis', import.meta.url).pathname,
  },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.MODE': '"production"', 'import.meta.env': '{"MODE":"production"}' },
  // Bare CSS belongs to the provider's declared dependencies, not Companion's absent package tree.
  plugins: [companionSourceLabels(), componentSkillResource(), {
    name: 'companion-browser-client-directive',
    onLog(level, log) {
      // This entry runs entirely in the browser; React Server Component boundaries do not apply.
      if (level === 'warn' && log.code === 'MODULE_LEVEL_DIRECTIVE'
        && log.message.includes('"use client"')
        && /[\\/]node_modules[\\/]/.test(log.id ?? '')) return false
    },
  }, webAppBrowserDependencies(), canvasBrowserDependencies(panelConfigUrl), canvasAssets.plugin,
    dshClientStyles('design-companion', new URL('../provider-web-app/tsdown.config.ts', import.meta.url).href, {
      preprocessCss: canvasAssets.preprocessCss, resources: cssResourceBuildOptions('design-companion'),
    }),
    graphLayoutWorker(), graphBrowserDependencies()],
})
