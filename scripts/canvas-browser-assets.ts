import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateFonts } from './validate-fonts.mjs'
import { transformMinimalWithEmbeddableSvg } from './font-svg-embeddable-transform.mjs'
import { transformUiFontLifecycle, UI_FONT_BROKER_SPECIFIER } from './ui-font-lifecycle-transform.mjs'
import { transformSceneFontLifecycle, SCENE_FONT_BROKER_SPECIFIER } from './scene-font-lifecycle-transform.mjs'

interface FontPin { path: string; bytes: number; sha256: string }
interface TargetPin { metadata: string; metadataSha256: string; cssSha256: string }
interface Pins { name: string; version: string; packageSha256: string; fonts: FontPin[]; targets: Record<string, TargetPin> }
const pins: Pins = JSON.parse(readFileSync(new URL('./canvas-font-inputs.json', import.meta.url), 'utf8'))
const fontRoot = fileURLToPath(new URL('./whiteboard-fonts/', import.meta.url))
const replacementManifestFile = fileURLToPath(new URL('./whiteboard-fonts/manifest.json', import.meta.url))
const indexPins = { prod: '7f651063487849c79a8cdedc3aa6bd04c6b0c717ee63959116f1f12dbc0a51b8', dev: 'e10e24df153077770849c7d68f9a8f5db3bb1eb1576d909d1e3c9a5b024d1882' }
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')

/** Build-only, exact upstream input boundary. This does not configure a host or a Worker. */
export function canvasBrowserAssets(configUrl: string, options: { packageRoot?: string; environment?: 'prod' | 'dev' } = {}) {
  const entry = options.packageRoot ? undefined : createRequire(configUrl).resolve('@excalidraw/excalidraw')
  const packageRoot = realpathSync(options.packageRoot ?? resolve(dirname(entry!), '../..'))
  const environment = options.environment ?? (entry && basename(dirname(entry)) === 'dev' ? 'dev' : 'prod')
  const target = pins.targets[environment]
  const dist = join(packageRoot, 'dist', environment)
  const metadataFile = join(dist, target.metadata), cssFile = join(dist, 'index.css'), indexFile = join(dist, 'index.js')
  const fontPins = new Map(pins.fonts.map(font => [font.path, font]))
  if (fontPins.size !== 234) throw Error('Canvas font pin inventory must contain all 234 fonts')
  let metadataTransformed = false, indexTransformed = false, cssTransformed = false
  function matches(file: string, expected: string) {
    if (resolve(file) === expected) return true
    if (basename(file) !== basename(expected)) return false
    try { return realpathSync(file) === expected } catch { return false }
  }

  function checked(file: string, sha256: string, bytes?: number) {
    const value = readFileSync(file)
    if (digest(value) !== sha256 || (bytes !== undefined && value.length !== bytes)) throw Error(`Canvas asset input drift: ${file}`)
    return value
  }
  function checkOriginalInputs() {
    checked(join(packageRoot, 'package.json'), pins.packageSha256)
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    if (manifest.name !== pins.name || manifest.version !== pins.version) throw Error('Unsupported canvas package version')
    const actual: string[] = []
    function visit(directory: string, prefix: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const name = `${prefix}/${entry.name}`
        if (entry.isDirectory()) visit(join(directory, entry.name), name)
        else if (entry.isFile()) actual.push(name)
        else throw Error(`Canvas font input must be a regular file: ${name}`)
      }
    }
    visit(join(dist, 'fonts'), 'fonts')
    if (actual.sort().join('\n') !== [...fontPins.keys()].sort().join('\n')) throw Error('Canvas font inventory drift')
    for (const font of pins.fonts) checked(join(dist, font.path), font.sha256, font.bytes)
  }
  function prepare() {
    checkOriginalInputs()
    const verified = validateFonts(fontRoot, replacementManifestFile)
    const manifest = JSON.parse(readFileSync(replacementManifestFile, 'utf8'))
    const fonts = Object.fromEntries(verified.map((font: any) => {
      const pin = manifest.fonts.find((entry: any) => entry.role === font.role)
      if (font.exportPolicy !== 'unchanged-original-bytes') throw Error('Unsupported fixed font export policy')
      // Binary measurements are authoritative; lineHeight is the explicit layout policy.
      return [font.role, { ...font, exportPolicy: 'embed-original', bytes: readFileSync(join(fontRoot, pin.file)), originalUnmodified: true,
        displayName: font.role === 'regular' ? 'Source Han Sans CN' : 'JetBrains Mono',
        coverage: font.role === 'regular' ? 'cjk-and-latin' : 'latin-monospace',
        metrics: { ...font.metrics, lineHeight: font.role === 'regular' ? 1.45 : 1.32 } }]
    }))
    const result = transformMinimalWithEmbeddableSvg({
      code: checked(metadataFile, target.metadataSha256).toString(),
      css: checked(cssFile, target.cssSha256).toString(),
      guards: target, fonts, mode: environment,
    }, checked(indexFile, indexPins[environment]).toString())
    return transformSceneFontLifecycle(transformUiFontLifecycle(result, { metadataSpecifier: './' + target.metadata, regularSha256: fonts.regular.sha256 }), { mode: environment })
  }
  let prepared = prepare()
  function preprocessCss(css: string, file: string) {
    if (!matches(file, cssFile)) return css
    cssTransformed = false
    if (digest(css) !== target.cssSha256) throw Error('Canvas CSS input drift')
    cssTransformed = true
    return prepared.css
  }

  return {
    preprocessCss,
    manifest: { name: pins.name, version: pins.version, environment, originalInputFontCount: 234,
      fontCount: 2, metadataCount: 230, cssCount: 4, exportPolicy: 'embed-original',
      authorityManifestSha256: digest(readFileSync(replacementManifestFile)),
      fonts: JSON.parse(readFileSync(replacementManifestFile, 'utf8')).fonts.map((font: any) => ({
        role: font.role, path: font.file, bytes: font.bytes, sha256: font.sha256,
        licenseFile: font.licenseFile, licenseSha256: font.licenseSha256,
      })), lifecycleDisposalVerified: false },
    plugin: {
      name: 'self-contained-canvas-fonts',
      resolveId(source: string) {
        if (source === SCENE_FONT_BROKER_SPECIFIER) return fileURLToPath(new URL('../packages/panel/src/scene-font-broker.mjs', import.meta.url))
        if (source !== UI_FONT_BROKER_SPECIFIER) return null
        return fileURLToPath(new URL('../packages/panel/src/ui-font-broker.mjs', import.meta.url))
      },
      buildStart(this: { addWatchFile(file: string): void }) {
        metadataTransformed = false; indexTransformed = false; cssTransformed = false
        prepared = prepare()
        for (const file of [join(packageRoot, 'package.json'), metadataFile, indexFile, cssFile, ...pins.fonts.map(font => join(dist, font.path)), replacementManifestFile, ...JSON.parse(readFileSync(replacementManifestFile, 'utf8')).fonts.flatMap((font: any) => [join(fontRoot, font.file), join(fontRoot, font.licenseFile)]), ...['validate-fonts.mjs', 'minimal-font-transform.mjs', 'font-picker-transform.mjs', 'font-svg-transform.mjs', 'font-svg-embeddable-transform.mjs', 'ui-font-lifecycle-transform.mjs', 'scene-font-lifecycle-transform.mjs', 'canvas-font-inputs.json'].map(file => fileURLToPath(new URL(file, import.meta.url)))]) this.addWatchFile(file)
        this.addWatchFile(fileURLToPath(new URL('../packages/panel/src/ui-font-broker.mjs', import.meta.url)))
        this.addWatchFile(fileURLToPath(new URL('../packages/panel/src/scene-font-broker.mjs', import.meta.url)))
      },
      transform(code: string, id: string) {
        if (matches(id, metadataFile)) {
          metadataTransformed = false
          if (digest(code) !== target.metadataSha256) throw Error('Canvas metadata input drift')
          metadataTransformed = true
          return { code: prepared.code, map: null }
        }
        if (matches(id, indexFile)) {
          indexTransformed = false
          if (digest(code) !== indexPins[environment]) throw Error('Canvas index input drift')
          indexTransformed = true
          return { code: prepared.indexCode, map: null }
        }
        return null
      },
      generateBundle() {
        if (!metadataTransformed || !indexTransformed || !cssTransformed) throw Error('Canvas asset integration incomplete: metadata, index and scoped CSS preprocessing are all required')
        // Reject source/binary/license drift even after successful hooks, before emission.
        prepare()
      },
    },
  }
}
