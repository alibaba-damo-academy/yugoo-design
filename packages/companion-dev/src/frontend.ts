import { createServer, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { Server, IncomingMessage, ServerResponse } from 'node:http'
import { webAppBrowserDependencies } from '../../provider-web-app/tsdown.config.ts'
import { canvasBrowserAssets } from '../../../scripts/canvas-browser-assets.ts'
import { canvasBrowserDependencies } from '../../../scripts/canvas-browser-dependencies.ts'
import { graphBrowserDependencies } from '../../../scripts/graph-browser-dependencies.ts'
import { graphLayoutWorker } from '../../../scripts/graph-layout-worker.ts'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))
const panelConfig = new URL('../../panel/tsdown.config.ts', import.meta.url).href
const path = (relative: string) => join(workspace, relative)

/** Same-origin development transport only. Core and native model access stay
 * with the already authenticated Companion, including owned child trials. */
export async function createCompanionDevFrontend({ server, origin }: { server: Server; origin: string }) {
  const guardUpgrade = (request: IncomingMessage, socket: import('node:net').Socket) => {
    if (request.headers.host !== new URL(origin).host || request.headers.origin !== origin) socket.destroy()
  }
  const canvas = canvasBrowserAssets(panelConfig)
  const canvasRequire = createRequire(createRequire(panelConfig).resolve('@excalidraw/excalidraw'))
  // The pinned canvas stays unoptimized so its audited font rewrite runs.
  // Prebundle its browser imports (including transitive CommonJS) explicitly;
  // Vite cannot discover nested imports of an excluded dependency by crawling.
  const canvasDependencies = [
    '@braintree/sanitize-url', 'es6-promise-pool', 'png-chunks-extract', 'png-chunk-text', 'png-chunks-encode',
    'pako', 'fuzzy', 'lodash.throttle', 'lodash.debounce', 'jotai', 'jotai-scope', 'tunnel-rat',
    '@radix-ui/react-popover', '@radix-ui/react-tabs', '@excalidraw/laser-pointer', 'browser-fs-access',
    'fractional-indexing', 'perfect-freehand', 'points-on-curve', 'roughjs/bin/rough', 'roughjs/bin/generator', 'roughjs/bin/math',
  ]
  const aliases = {
    'dsh-design-panel/client-api': path('packages/panel/src/client-api.ts'),
    'dsh-design-core/dsl': path('packages/core/src/panel-dsl.ts'),
    'dsh-design-core/experience-view': path('packages/core/src/experience-view.ts'),
    'dsh-design-core/source-reference': path('packages/core/src/design-source-reference.ts'),
    react: path('packages/panel/node_modules/react'),
    'react-dom': path('packages/panel/node_modules/react-dom'),
    '@deepseek-ai/cordis': path('packages/panel/node_modules/@deepseek-ai/cordis'),
  }
  // Preserve the pinned production canvas transformation even in development;
  // do not accidentally use Excalidraw's unrelated upstream font catalog.
  const canvasCss: Plugin = { name: 'companion-dev-canvas-css', enforce: 'pre',
    transform(code, id) { if (id.split('?', 1)[0].endsWith('.css')) return canvas.preprocessCss(code, id.split('?', 1)[0]) } }
  // Vite appends version queries to excluded dependency requests. The audited
  // transformer identifies exact filesystem inputs, not browser cache keys.
  const canvasCode: Plugin = { ...canvas.plugin,
    transform(code, id) { return canvas.plugin.transform(code, id.split('?', 1)[0]) } }
  server.prependListener('upgrade', guardUpgrade)
  let vite: ViteDevServer
  try { vite = await createServer({
    configFile: false, root: path('packages/companion'), publicDir: false,
    cacheDir: path('node_modules/.cache/yugoo-companion-vite'),
    appType: 'custom',
    resolve: { alias: [
      ...canvasDependencies.map(name => ({ find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: canvasRequire.resolve(name) })),
      ...Object.entries(aliases).map(([find, replacement]) => ({ find, replacement })),
    ], dedupe: ['react', 'react-dom'], conditions: ['browser', 'import', 'production'] },
    plugins: [canvasCss, canvasCode, canvasBrowserDependencies(panelConfig) as Plugin,
      webAppBrowserDependencies() as Plugin, graphBrowserDependencies() as Plugin, graphLayoutWorker() as Plugin, react()],
    optimizeDeps: { exclude: ['@excalidraw/excalidraw'], include: canvasDependencies },
    server: { middlewareMode: true, hmr: { server }, cors: false,
      fs: { strict: true, allow: [
        ...['panel', 'core', 'studio-ui', 'provider-web-app', 'companion'].map(name => path(`packages/${name}/src`)),
        path('scripts/whiteboard-fonts'), realpathSync(path('node_modules')),
        realpathSync(path('packages/companion-dev/node_modules')),
      ], deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/design_files/**', '**/connections/**'] } },
  }) } catch (error) { server.off('upgrade', guardUpgrade); throw error }
  return {
    async html(url: string, html: string) {
      return vite.transformIndexHtml(url, html.replace('src="/client.js"', 'src="/src/client.tsx"'))
    },
    handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      return new Promise((resolve, reject) => {
        const done = () => settle(true)
        const settle = (handled: boolean, error?: unknown) => {
          response.off('finish', done); response.off('close', done)
          if (error) reject(error); else resolve(handled)
        }
        response.once('finish', done); response.once('close', done)
        vite.middlewares(request, response, (error?: unknown) => settle(false, error))
      })
    },
    async close() { server.off('upgrade', guardUpgrade); await vite.close() },
  }
}
