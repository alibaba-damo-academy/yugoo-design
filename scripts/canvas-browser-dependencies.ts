import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { dirname, join, isAbsolute } from 'node:path'

/** Resolve browser-only canvas dependencies before the client's package
 * pre-resolution can select a Node entry. Keep each importer's own version. */
export function canvasBrowserDependencies(configUrl: string) {
  const require = createRequire(configUrl)
  const selected = new Map<string, { kind: 'standalone' | 'embedded'; directory: string }>()
  const preparing = new Map<string, Promise<any>>()
  const prepared = new Map<string, any>()
  function select(name: string, directory: string) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (manifest.name !== name) throw Error('Canvas Worker package identity drift')
    const entry = name === 'pica' ? manifest.main : manifest.module
    if (typeof entry !== 'string') throw Error('Canvas Worker package entry drift')
    const file = realpathSync(join(directory, entry))
    selected.set(file, { kind: name === 'pica' ? 'standalone' : 'embedded', directory })
    return file
  }
  function matchedFile(id: string) {
    if (!isAbsolute(id) || id.includes('?') || id.includes('\0')) return undefined
    if (selected.has(id)) return id
    if (!/[\\/]node_modules[\\/](?:pica|image-blob-reduce)[\\/]/u.test(id)) return undefined
    // Resolve aliases/symlinks, then prove the actual package manifest and entry.
    // This also covers a package entry pre-resolved by the host build tool.
    const file = realpathSync(id)
    if (selected.has(file)) return file
    const matches = [...file.matchAll(/[\\/]node_modules[\\/](pica|image-blob-reduce)(?=[\\/])/gu)]
    const owner = matches.at(-1)
    if (!owner) return undefined
    const directory = file.slice(0, owner.index! + owner[0].length)
    return select(owner[1], directory) === file ? file : undefined
  }
  return {
    name: 'canvas-browser-dependencies',
    resolveId(this: { resolve(source: string, importer: string | undefined, options: { skipSelf: boolean }): Promise<{ id: string } | null> }, source: string, importer: string | undefined) {
      if ((source === 'pica' || source === 'image-blob-reduce') && importer !== undefined) {
        return select(source, dirname(createRequire(importer).resolve(source + '/package.json')))
      }
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
    async load(id: string) {
      const file = matchedFile(id)
      if (!file) return null
      let promise = preparing.get(file)
      if (!promise) {
        const input = selected.get(file)!
        // Neither resolveId nor an unrelated module compiles the other graph.
        promise = import('./pica-static-worker-adapter.mjs').then(({ prepareStaticPicaParent }) => prepareStaticPicaParent(input))
        preparing.set(file, promise)
      }
      const result = await promise
      prepared.set(file, result)
      return { code: result.code, map: null }
    },
    generateBundle(this: { emitFile(value: { type: 'asset'; fileName: string; source: string }): void }, _options: unknown, bundle: Record<string, any>) {
      if (!prepared.size) return
      for (const [file, result] of prepared) {
        const directory = selected.get(file)!.directory
        for (const [path, pin] of [[file, result.manifest.source.sha256], [join(directory, 'package.json'), result.manifest.source.manifestSha256],
          [join(directory, 'LICENSE'), result.manifest.source.licenseSha256]]) {
          if (createHash('sha256').update(readFileSync(path)).digest('hex') !== pin) throw Error('Canvas Worker input drift after loading')
        }
      }
      const entries = Object.values(bundle).filter(file => file.type === 'chunk' && file.isEntry && /\.[cm]?js$/u.test(file.fileName)).map(file => file.name).sort()
      if (!entries.length) return // Declaration-only outputs do not carry runtime assets.
      if (entries.some(name => !/^[\w-]+$/u.test(name))) throw Error('Unknown Canvas Worker output entry')
      const sources = [...new Map([...prepared.values()].map(result => [result.manifest.kind + ':' + result.manifest.source.sha256, result])).values()]
        .sort((a, b) => a.manifest.kind < b.manifest.kind ? -1 : a.manifest.kind > b.manifest.kind ? 1 : 0)
      this.emitFile({ type: 'asset', fileName: `pica-static-workers-${entries.join('-')}.json`,
        source: JSON.stringify({ version: 1, entries, sources: sources
          .map(result => ({ source: { package: result.manifest.package, version: result.manifest.version, entry: result.manifest.entry },
            manifest: result.manifest, workers: result.scripts })), browserExecuted: false }, null, 2) + '\n' })
    },
  }
}
