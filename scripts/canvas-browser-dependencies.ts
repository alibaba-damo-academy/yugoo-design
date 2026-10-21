import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Resolve browser-only canvas dependencies before the client's package
 * pre-resolution can select a Node entry. Keep each importer's own version. */
export function canvasBrowserDependencies(configUrl: string) {
  const require = createRequire(configUrl)
  return {
    name: 'canvas-browser-dependencies',
    resolveId(this: { resolve(source: string, importer: string | undefined, options: { skipSelf: boolean }): Promise<{ id: string } | null> }, source: string, importer: string | undefined) {
      if (source === 'nanoid' && importer !== undefined) {
        const manifestPath = createRequire(importer).resolve('nanoid/package.json')
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        const browserEntry = manifest.exports?.['.']?.browser
        if (typeof browserEntry !== 'string') throw new Error('canvas browser dependency nanoid must declare a browser export')
        return this.resolve(join(dirname(manifestPath), browserEntry), importer, { skipSelf: true })
      }
      // Excalidraw's CSS is exposed only under development/production conditions.
      if (source !== '@excalidraw/excalidraw/index.css') return null
      return this.resolve(join(dirname(require.resolve('@excalidraw/excalidraw')), 'index.css'), importer, { skipSelf: true })
    },
  }
}
