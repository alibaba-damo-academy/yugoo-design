/** Core-backed Studio adapters over trusted captures; no filesystem, installation or execution port. */
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseDocument, isMap, isScalar, stringify } from 'yaml'
import { loadDesignBundle, loadDesignKit, parseFrontmatter, parseKitMounts, parseMindsetSkillNames } from 'dsh-design-core'
import { finalizeStudioPanelPreview } from '../../studio/src/panel-preview.ts'

const MAX_TREE_BYTES = 16 * 1024 * 1024
const MAX_TREE_FILES = 4096
const MAX_CLOSURE_BYTES = 64 * 1024 * 1024
const MAX_CLOSURE_FILES = 16384
const pinOf = value => {
  if (!value || typeof value.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value.name)
    || typeof value.version !== 'string' || !/^\d+\.\d+$/.test(value.version)) throw new Error('Studio composition requires exact content pins.')
  return { name: value.name, version: value.version }
}
const samePin = (a, b) => a.name === b.name && a.version === b.version
const sourceIdOf = value => {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Trusted Bundle source identity is required.')
  return value
}
const decode = bytes => {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (value.includes('\0')) throw new Error('Studio definition text contains binary content.')
  return value
}
const entry = (path, content) => ({ path, base64: Buffer.from(content, 'utf8').toString('base64') })

/** The virtual filesystem never falls back to the host filesystem. */
function memorySource(entries, budget = { bytes: 0, files: 0 }) {
  if (!Array.isArray(entries) || entries.length > MAX_TREE_FILES) throw new Error('Studio source exceeds 4096 files.')
  const root = resolve('/studio-instance-memory', randomUUID()), files = new Map(), directories = new Set([''])
  let total = 0
  for (const item of entries) {
    const { path, base64 } = item ?? {}
    if (typeof path !== 'string' || !path || path.length > 1024 || /[\\:\u0000-\u001f\u007f]/u.test(path)
      || path.split('/').some(part => !part || ['.', '..', '.git', 'node_modules'].includes(part))
      || path.split('/').length > 32 || files.has(path) || typeof base64 !== 'string') throw new Error('Invalid or duplicate Studio source path.')
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.toString('base64') !== base64) throw new Error('Studio source base64 is not canonical.')
    total += bytes.length
    if (total > MAX_TREE_BYTES) throw new Error('Studio source exceeds 16 MiB.')
    files.set(path, bytes)
    const parts = path.split('/')
    for (let count = 1; count < parts.length; count++) directories.add(parts.slice(0, count).join('/'))
  }
  if ([...files.keys()].some(path => directories.has(path))) throw new Error('Studio source file conflicts with a directory.')
  budget.bytes += total; budget.files += files.size
  if (budget.bytes > MAX_CLOSURE_BYTES || budget.files > MAX_CLOSURE_FILES) throw new Error('Studio composition exceeds its 64 MiB or 16384 file budget.')
  const keyOf = path => {
    const rel = relative(root, resolve(path))
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Studio composition path escapes captured source.')
    return rel.split(sep).join('/')
  }
  const fs = {
    // Match Core's Node readText port for collected resources; retained bytes stay exact.
    async readText(path) { const bytes = files.get(keyOf(path)); return bytes === undefined ? undefined : bytes.toString('utf8') },
    async readBytes(path) { const bytes = files.get(keyOf(path)); return bytes === undefined ? undefined : Buffer.from(bytes) },
    async listDir(path) {
      const key = keyOf(path), prefix = key ? `${key}/` : ''
      return [...new Set([...files.keys()].filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length).split('/')[0]))].sort()
    },
    async isDirectory(path) { return directories.has(keyOf(path)) },
    async realPath(path) { keyOf(path); return resolve(path) },
  }
  return { root, fs, entries: [...files].map(([path, bytes]) => ({ path, base64: bytes.toString('base64') })),
    text(path) { const bytes = files.get(path); if (bytes === undefined) throw new Error(`Missing Studio definition ${path}.`); return decode(bytes) } }
}

/** Edit only one top-level YAML scalar; comments and every other source byte survive. */
function scalarEdit(source, key, value, allowInsert = false) {
  const document = parseDocument(source)
  if (document.errors.length || !isMap(document.contents)) throw new Error('Studio requires one valid YAML mapping.')
  const node = document.get(key, true), encoded = JSON.stringify(value)
  if (node !== undefined) {
    if (!isScalar(node) || !node.range) throw new Error(`Studio cannot rewrite non-scalar ${key}.`)
    return source.slice(0, node.range[0]) + encoded + source.slice(node.range[1])
  }
  if (!allowInsert) throw new Error(`Missing required identity field ${key}.`)
  if (document.contents.flow) {
    const index = document.contents.range[0] + 1
    return source.slice(0, index) + `${key}: ${encoded}${document.contents.items.length ? ', ' : ''}` + source.slice(index)
  }
  const first = document.contents.items[0]?.key
  if (!first?.range) throw new Error('Studio cannot insert identity into an empty mapping.')
  const start = source.lastIndexOf('\n', first.range[0] - 1) + 1
  const indent = source.slice(start, first.range[0]), newline = source.includes('\r\n') ? '\r\n' : '\n'
  return source.slice(0, start) + `${indent}${key}: ${encoded}${newline}` + source.slice(start)
}

async function projectMindset(source, kit, mounts, describeBundle) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error('Kit Mindset requires explicit YAML frontmatter.')
  const parsed = parseFrontmatter(source, 'mindset.md')
  // Core parses existing authored catalog syntax; the adapter only selects source spans.
  parseMindsetSkillNames(parsed.body, String(parsed.meta.name))
  let frontmatter = scalarEdit(match[1], 'name', kit.name)
  frontmatter = scalarEdit(frontmatter, 'version', kit.version)
  const frontStart = source.indexOf(match[1]), frontEnd = frontStart + match[1].length
  const renamed = source.slice(0, frontStart) + frontmatter + source.slice(frontEnd)
  const bodyStart = renamed.length - parseFrontmatter(renamed, 'mindset.md').body.length
  const marker = renamed.indexOf('<design_skills>', bodyStart)
  if (marker < 0) throw new Error('Mindset has no generated Bundle catalog block.')
  const start = marker + '<design_skills>'.length
  const end = renamed.indexOf('</design_skills>', start)
  const block = renamed.slice(start, end), headings = [...block.matchAll(/^##\s+(.+?)\s*$/gm)]
  if (end < start || headings.length === 0) throw new Error('Mindset generated Bundle catalog is empty or malformed.')
  const sections = new Map(headings.map((heading, index) => [heading[1], block.slice(heading.index, headings[index + 1]?.index ?? block.length)]))
  const newline = renamed.includes('\r\n') ? '\r\n' : '\n'
  const selected = []
  for (const mount of mounts) {
    if (sections.has(mount.bindingKey)) selected.push(sections.get(mount.bindingKey))
    else {
      const description = (await describeBundle(mount)).trim().replace(/\r\n?/g, '\n')
      if (!description) throw new Error(`Bundle ${mount.name} needs a SKILL frontmatter routing description before it can enter the Mindset catalog.`)
      const escaped = description.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', newline)
      selected.push(`## ${mount.bindingKey}${newline}${newline}${escaped}${newline}${newline}`)
    }
  }
  const generated = block.slice(0, headings[0].index) + selected.join('')
  const projected = renamed.slice(0, start) + generated + renamed.slice(end)
  const names = parseMindsetSkillNames(parseFrontmatter(projected, 'mindset.md').body, kit.name)
  if (JSON.stringify(names) !== JSON.stringify(mounts.map(mount => mount.bindingKey))) throw new Error('Generated Mindset catalog differs from Kit mounts.')
  return projected
}

/**
 * trusted.listBundles(): Promise<Pin[]>; trusted.captureBundle(pin): {files,sourceId};
 * trusted.captureKit(pin): {files,title?}. Captures are exact, host-selected sources.
 * composition.projectMounts additionally accepts resolveBundle(pin) for retained local sources;
 * the trusted installed capture is used only when that resolver is omitted.
 * Optional trusted.preview overrides the default Core-backed retained-source preview.
 * Returned catalog/composition match createStudioInstances; there is no legacy-tree fallback.
 */
export function createStudioInstanceAdapters(trusted) {
  if (!trusted || !['listBundles', 'captureBundle', 'captureKit'].every(key => typeof trusted[key] === 'function')) throw new Error('Trusted independent catalog capture ports are required.')
  const loadBundle = async (files, sourceId, expected, budget) => {
    const source = memorySource(files, budget)
    for (const path of ['skill.yaml', 'SKILL.md', 'schema.yaml', 'validation.yaml']) source.text(path)
    const content = await loadDesignBundle(source.fs, { rootDir: source.root, sourceId: sourceIdOf(sourceId) }, pinOf(expected))
    return { source, content }
  }
  const compileKit = async ({ kit, kitFiles, mounts, resolveBundle }) => {
    const expected = pinOf(kit), budget = { bytes: 0, files: 0 }, source = memorySource(kitFiles, budget)
    const declared = parseKitMounts(source.text('kit.yaml'))
    const selected = mounts.map(mount => ({ bindingKey: mount.bindingKey, ...pinOf(mount.bundle ?? mount) }))
    if (JSON.stringify(declared) !== JSON.stringify(selected)) throw new Error('Selected mounts differ from authoritative kit.yaml.')
    const loaded = await loadDesignKit(source.fs, source.root, { sourceId: `local:kit:${expected.name}`, resolveBundle: async pin => {
      if (!declared.some(mount => samePin(mount, pin))) throw new Error('Core requested an undeclared Bundle.')
      const capture = await resolveBundle(pin)
      if (!capture) throw new Error(`Missing exact Bundle ${pin.name}@${pin.version}.`)
      return (await loadBundle(capture.files, capture.sourceId, pin, budget)).content
    } })
    if (!samePin({ name: loaded.name, version: String(loaded.version) }, expected)) throw new Error('Kit source identity differs from its exact pin.')
    return loaded
  }
  const previewRetained = async input => {
    const failure = (code, message) => ({ diagnostics: [{ code, message }] })
    if (!input || !['kit', 'bundle'].includes(input.kind) || !Number.isSafeInteger(input.revision) || input.revision < 0) {
      return failure('preview.request', 'Select a retained Kit or Bundle and a non-negative revision.')
    }
    // Capture all caller-owned scalars and source entries before the first await.
    const { kind, revision, sampleSource, runtimeName, sourceId } = input
    let bundle, kit, kitFiles, bundleFiles, mounts
    const resolveBundle = input.resolveBundle
    try {
      bundle = pinOf(input.bundle)
      if (kind === 'kit') {
        kit = pinOf(input.kit); kitFiles = structuredClone(input.kitFiles); mounts = structuredClone(input.mounts)
        if (!Array.isArray(mounts) || !mounts.some(mount => samePin(mount.bundle ?? mount, bundle))) return failure('preview.bundle_pin', 'Select an exact mounted Bundle.')
        if (typeof resolveBundle !== 'function') return failure('preview.request', 'Kit preview requires its retained Bundle resolver.')
      } else {
        if (input.kit !== undefined) return failure('preview.request', 'A standalone Bundle preview cannot claim a Kit context.')
        bundleFiles = structuredClone(input.bundleFiles)
      }
      let compiled, retained
      const oversizedPanel = files => Array.isArray(files) && files.some(file => file.path === 'panel.yaml' && typeof file.base64 === 'string' && Buffer.byteLength(file.base64, 'base64') > 1_048_576)
      if (kind === 'bundle') {
        if (oversizedPanel(bundleFiles)) return failure('preview.size', 'Panel source is limited to 1 MiB.')
        retained = await loadBundle(bundleFiles, sourceId, bundle)
        compiled = retained.content.skill
        if (runtimeName !== undefined && compiled.name !== runtimeName) return failure('preview.bundle_pin', 'The retained runtime name does not match the selected Bundle.')
      } else {
        const captured = await resolveBundle(bundle)
        if (!captured) return failure('preview.bundle_pin', 'The retained Bundle source is missing.')
        const selected = { files: structuredClone(captured.files), sourceId: captured.sourceId }
        if (oversizedPanel(selected.files)) return failure('preview.size', 'Panel source is limited to 1 MiB.')
        const loaded = await compileKit({ kit, kitFiles, mounts, resolveBundle: pin => samePin(pin, bundle) ? Promise.resolve(selected) : resolveBundle(pin) })
        compiled = loaded.skills.find(skill => (skill.catalogName ?? skill.name) === bundle.name && String(skill.version) === bundle.version)
        retained = { source: memorySource(selected.files) }
      }
      if (!compiled) return failure('preview.bundle_pin', 'The source does not match the selected Bundle version.')
      if (typeof compiled.metadata?.panelYaml !== 'string') return failure('preview.not_declarative', 'Only an existing declarative Panel can be previewed.')
      let sample = sampleSource
      if (sample === undefined) {
        const example = retained.source.entries.find(file => file.path === 'reference/preview.json')
        if (example) sample = retained.source.text(example.path)
        else if (compiled.metadata.panelManifest?.initial_values !== undefined) sample = JSON.stringify(compiled.metadata.panelManifest.initial_values)
        else return failure('preview.sample_missing', 'Add reference/preview.json, Panel initial_values, or explicit isolated sample JSON.')
      }
      return finalizeStudioPanelPreview({ compiled, bundle, ...(kit === undefined ? {} : { kit }), revision, sampleSource: sample })
    } catch (error) { return failure('preview.definition', error instanceof Error ? error.message : String(error)) }
  }
  const catalog = {
    async listBundles() {
      const pins = await trusted.listBundles()
      if (!Array.isArray(pins) || pins.length > 1024) throw new Error('Studio catalog exceeds 1024 Bundle pins.')
      const seen = new Set(), result = []
      for (const value of pins) {
        const pin = pinOf(value), key = `${pin.name}@${pin.version}`
        if (seen.has(key)) throw new Error(`Ambiguous exact Bundle ${key}.`)
        seen.add(key)
        const captured = await catalog.captureBundle(pin)
        result.push({ ...pin, title: captured.title, runtimeName: captured.runtimeName })
      }
      return result
    },
    async captureBundle(value) {
      const pin = pinOf(value), raw = await trusted.captureBundle(pin)
      const { source, content } = await loadBundle(raw.files, raw.sourceId, pin)
      return { files: source.entries, sourceId: raw.sourceId, title: { ...content.skill.title }, runtimeName: content.skill.name }
    },
    async captureKit(value) {
      const kit = pinOf(value), raw = await trusted.captureKit(kit), source = memorySource(raw.files)
      if (source.entries.some(file => file.path.startsWith('skills/'))) throw new Error('Kit capture must not contain embedded Bundle trees.')
      const mounts = parseKitMounts(source.text('kit.yaml'))
      await compileKit({ kit, kitFiles: source.entries, mounts, resolveBundle: pin => trusted.captureBundle(pin) })
      // A trusted caller may supply existing localized picker copy. Do not invent a new title authority.
      return { files: source.entries, mounts, ...(raw.title === undefined ? {} : { title: raw.title }) }
    },
  }
  const composition = {
    async forkBundle({ files, from, to, runtimeName }) {
      from = pinOf(from); to = pinOf(to)
      if (to.name === from.name || to.version !== from.version) throw new Error('A fork requires a new catalog identity and preserves its source version.')
      const before = await loadBundle(files, `studio:fork-source:${from.name}`, from)
      if (before.content.skill.name !== runtimeName) throw new Error('Fork runtime name does not match its retained source.')
      const presentation = before.content.skill.metadata?.skillManifest?.presentation
      if (presentation?.mode === 'native' || (presentation?.mode === 'auto' && presentation.renderer && !before.content.skill.metadata?.panelYaml)) {
        throw new Error('Native-only Bundles cannot be forked: the new identity has no trusted native renderer authority.')
      }
      const manifest = scalarEdit(before.source.text('skill.yaml'), 'identity', to.name, true)
      const next = before.source.entries.map(file => file.path === 'skill.yaml' ? entry(file.path, manifest) : file)
      const after = await loadBundle(next, `local:bundle:${to.name}`, to)
      if (after.content.skill.name !== runtimeName || after.content.skill.content !== before.content.skill.content) throw new Error('A fork cannot alter the runtime name or Bundle method.')
      return next
    },
    async projectMounts({ kit, kitFiles, mounts, resolveBundle = pin => trusted.captureBundle(pin) }) {
      kit = pinOf(kit)
      const declaration = stringify({ version: 1, mounts: mounts.map(mount => ({ bindingKey: mount.bindingKey, ...pinOf(mount) })) })
      const normalized = parseKitMounts(declaration), source = memorySource(kitFiles)
      const budget = { bytes: 0, files: 0 }
      const mindset = await projectMindset(source.text('mindset.md'), kit, normalized, async mount => {
        const captured = await resolveBundle(pinOf(mount))
        if (!captured) throw new Error(`Missing exact Bundle ${mount.name}@${mount.version} for catalog projection.`)
        const loaded = await loadBundle(captured.files, captured.sourceId, mount, budget)
        if (loaded.content.skill.name !== mount.bindingKey) throw new Error('Bundle bindingKey must preserve the runtime name.')
        return loaded.content.skill.description
      })
      const files = source.entries.filter(file => !['kit.yaml', 'mindset.md'].includes(file.path))
      return [...files, entry('mindset.md', mindset), entry('kit.yaml', declaration)]
    },
    async validateKit(input) { await compileKit(input) },
    preview: typeof trusted.preview === 'function' ? input => trusted.preview(input) : previewRetained,
  }
  return { catalog, composition }
}
