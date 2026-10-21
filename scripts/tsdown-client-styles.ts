import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planCssResources } from './css-resource-plan.mjs'
import { createCssResourceEmitter, cssAssetUrl } from './css-resource-emission.mjs'

const INLINE_QUERY = '?inline'
const VIRTUAL_PREFIX = '\0dsh-design-css:'
const VIRTUAL_SUFFIX = '.mjs'

/**
 * Build a client stylesheet loader that follows dsh's plugin-owned style lifecycle.
 * Plain CSS imports install one tagged stylesheet when the plugin factory is
 * materialized. `?inline` imports return text for components that deliberately
 * render a stylesheet inside their own DOM lifetime.
 * @param pluginId - Client plugin id used by dsh HMR to remove owned styles.
 * @param configUrl - Import URL of the calling tsdown config for bare resolution.
 * @returns A tsdown-compatible loader plugin.
 */
export function dshClientStyles(pluginId: string, configUrl: string, options: {
  preprocessCss?: (css: string, file: string) => string
  resources?: {
    prefix: string
    ownerRoot: (stylesheet: string) => string
    parser: { parse: Function; walk: Function; url: { encode: Function } }
  }
} = {}) {
  const configRequire = createRequire(configUrl)
  const files = new Map<string, string>()
  let emitter = options.resources ? createCssResourceEmitter(options.resources.prefix) : undefined
  return {
    name: `${pluginId}-styles`,
    buildStart() {
      // Watch rebuilds must not reuse a previously emitted resource collection.
      emitter = options.resources ? createCssResourceEmitter(options.resources.prefix) : undefined
    },
    generateBundle(this: { emitFile(asset: { type: string; fileName: string; source: string | Buffer }): unknown }) {
      emitter?.generateBundle(asset => this.emitFile(asset))
    },
    resolveId(source: string, importer: string | undefined) {
      const inline = source.endsWith(`.css${INLINE_QUERY}`)
      if (!inline && !source.endsWith('.css')) return null
      const request = inline ? source.slice(0, -INLINE_QUERY.length) : source
      const file = request.startsWith('.')
        ? resolve(dirname(importer ?? new URL(configUrl).pathname), request)
        : configRequire.resolve(request)
      // Bundlers may print virtual ids in emitted region comments. Keep the
      // physical checkout path private while retaining it for reads and HMR.
      const sourceKey = relative(dirname(fileURLToPath(configUrl)), file).replaceAll('\\', '/')
      const sourceHash = createHash('sha256').update(sourceKey).digest('hex')
      const id = `${VIRTUAL_PREFIX}${inline ? 'inline:' : 'owned:'}${sourceHash}:${basename(file)}${VIRTUAL_SUFFIX}`
      files.set(id, file)
      return id
    },
    load(this: { addWatchFile(file: string): void }, id: string) {
      if (!id.startsWith(VIRTUAL_PREFIX) || !id.endsWith(VIRTUAL_SUFFIX)) return null
      const body = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length)
      const separator = body.indexOf(':')
      const mode = body.slice(0, separator)
      const file = files.get(id)
      if (file === undefined) return null
      this.addWatchFile(file)
      const original = readFileSync(file, 'utf8')
      let css = options.preprocessCss ? options.preprocessCss(original, file) : original
      let resourceSources: string[] = []
      if (options.resources) {
        const config = options.resources
        const plan = planCssResources(css, { file, ownerRoot: config.ownerRoot(file), parser: config.parser,
          renderUrl: resource => cssAssetUrl(config.prefix, resource) })
        emitter!.addPlan(plan, source => this.addWatchFile(source))
        css = plan.css
        resourceSources = plan.resources.map(resource => resource.source)
      }
      // Build-only provenance lets license observers inspect the real source
      // without reconstructing it from an emitted virtual id.
      const meta = { dshDesignCssSource: file, dshDesignCssResources: resourceSources }
      if (mode === 'inline') return { code: `export default ${JSON.stringify(css)};`, map: null, meta }
      // A single plugin may include sheets with identical basenames from
      // different packages. Deduplicate by source, not just by filename.
      const sourceKey = relative(dirname(fileURLToPath(configUrl)), file).replaceAll('\\', '/')
      const sourceHash = createHash('sha256').update(sourceKey).digest('hex').slice(0, 12)
      const tagId = `${pluginId}/${basename(file)}:${sourceHash}`
      return {
        code: [
          `const css = ${JSON.stringify(css)};`,
          `const tagId = ${JSON.stringify(tagId)};`,
          'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
          '  const tag = document.createElement("style");',
          `  tag.dataset.plugin = ${JSON.stringify(pluginId)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          'export {};',
        ].join('\n'),
        map: null,
        meta,
      }
    },
  }
}
