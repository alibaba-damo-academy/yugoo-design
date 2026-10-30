/** Independent local Studio sources; composition and identity rewriting belong to Core adapters. */
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { parse as parseYaml, stringify } from 'yaml'
import { parseKitMounts } from 'dsh-design-core'
import { createStudioDraftPorts } from './studio-panel-drafts.mjs'
import { normalizeStudioInstanceChanges, STUDIO_INSTANCE_CHANGE_LIMITS } from '../instance-changes.ts'
import { exportStudioSourceArchive, readStudioArchiveResource } from '../content-archive.ts'

/** Byte-complete virtual snapshot over canonical retained S2 files; no filesystem extraction. */
function archiveSnapshot(root, entries, sourceId) {
  const files = new Map(entries.map(entry => [entry.path, Buffer.from(entry.base64, 'base64')]))
  const key = path => {
    const value = relative(root, resolve(path))
    if (isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`)) throw new Error('Instance archive read escaped its retained tree.')
    return value.split(sep).join('/')
  }
  const children = path => {
    const selected = key(path), prefix = selected ? selected + '/' : ''
    return [...new Set([...files.keys()].filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length).split('/')[0]))].sort()
  }
  return { root, sourceId, listFiles: async () => [...files.keys()], readBytes: async path => {
    const bytes = files.get(key(path)); if (!bytes) throw new Error('Missing retained instance archive file.'); return Buffer.from(bytes)
  }, fs: {
    readText: async path => { const bytes = files.get(key(path)); return bytes === undefined ? undefined : new TextDecoder('utf8', { fatal: true }).decode(bytes) },
    readResource: async path => { const bytes = files.get(key(path)); return bytes === undefined ? undefined : readStudioArchiveResource(path, bytes) },
    listDir: async path => children(path), isDirectory: async path => children(path).length > 0,
    realPath: async path => { key(path); return resolve(path) },
  } }
}

/**
 * @typedef {{path:string,base64:string}} Entry
 * @typedef {{name:string,version:string}} Pin
 * @typedef {{zh:string,en:string}} Title
 * @typedef {{snapshot:string,sourceId:string}} SourceRef
 * @typedef {{bindingKey:string,bundle:Pin & {source:SourceRef,instanceId?:string,revision?:number}}} Mount
 * Required trusted ports (never browser parameters):
 * catalog.listBundles(): Promise<Array<Pin & {title:Title,runtimeName:string}>>
 * catalog.captureKit(pin): Promise<{files:Entry[],title?:Title,mounts:Array<Pin & {bindingKey:string}>}>
 * catalog.captureBundle(pin): Promise<{files:Entry[],title:Title,sourceId:string,runtimeName:string}>
 * composition.forkBundle({files:Entry[],from:Pin,to:Pin,runtimeName:string}): Promise<Entry[]>
 * composition.projectMounts({kit:Pin,kitFiles:Entry[],mounts:Array<Pin & {bindingKey:string}>,resolveBundle(pin)}): Promise<Entry[]>
 * composition.validateKit({kit:Pin,kitFiles:Entry[],mounts:Mount[],resolveBundle(pin)}): Promise<void>
 * resolveBundle returns {files:Entry[],sourceId:string} for retained exact pins only.
 * Optional composition.preview returns the existing StudioPanelPreviewResult:
 * Kit input adds {kind:'kit',bundle,revision,sampleSource} to validateKit input.
 * Bundle input: {kind:'bundle',bundle,runtimeName,bundleFiles,sourceId,revision,sampleSource}.
 * projectMounts owns kit.yaml AND generated XML. forkBundle changes ONLY skill.yaml identity;
 * runtime name, SKILL frontmatter/body and validation paths remain byte-identical.
 */
const MAX_TEXT = 1024 * 1024
const pin = value => {
  if (!value || typeof value.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(value.name)
    || typeof value.version !== 'string' || !/^\d+\.\d+$/.test(value.version)) throw new Error('Select an exact source version.')
  return { name: value.name, version: value.version }
}
const same = (a, b) => a.name === b.name
// Core standalone runtime names are distinct from the stricter catalog identity.
const runtimeNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const runtimeNameOf = value => {
  if (typeof value !== 'string' || !runtimeNamePattern.test(value)) throw new Error('Trusted Bundle runtime name is missing or invalid.')
  return value
}
const titleOf = value => {
  if (!value || typeof value.zh !== 'string' || typeof value.en !== 'string' || !value.zh.trim() || !value.en.trim()
    || value.zh.length > 200 || value.en.length > 200) throw new Error('Provide Chinese and English display names of at most 200 characters.')
  return { zh: value.zh.trim(), en: value.en.trim() }
}
const safePath = path => {
  if (typeof path !== 'string' || !path || path.length > 1024 || /[\\:\u0000-\u001f\u007f]/u.test(path)
    || path.split('/').some(part => !part || ['.', '..', '.git', 'node_modules', '__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('Invalid instance source path.')
  return path
}
const checkRevision = (record, expected) => {
  if (!Number.isSafeInteger(expected) || record.revision !== expected) throw new Error('Instance changed elsewhere. Reopen it before saving.')
}
const active = record => { if (record.deletedAt) throw new Error('This working copy is no longer available or has been moved to the system trash.'); return record }
const modern = record => {
  active(record)
  if (record.recordVersion !== 2) throw new Error('This legacy instance requires explicit migration before editing or mounting.')
  return record
}
const decode = base64 => {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(base64, 'base64'))
  if (text.includes('\0')) throw new Error('Binary source files cannot be edited as text.')
  return text
}
const localPin = (kind, version, id = randomUUID()) => ({ name: `local_${kind}_${id.replaceAll('-', '_')}`, version })
const localSourceId = (kind, identity) => `local:${kind}:${identity.name}`
const requireSourceId = value => {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('Trusted source identity is missing or invalid.')
  return value
}
const canonicalFiles = files => JSON.stringify(files.map(({ path, base64 }) => [path, base64]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

// Blank authoring sources are incomplete drafts, never captured installed content or published definitions.
// In particular validation.yaml stays incomplete until the author supplies meaningful domain checks.
function blankSources(kind, identity, title) {
  const entry = (path, content) => ({ path, base64: Buffer.from(content, 'utf8').toString('base64') })
  const frontmatter = stringify({ ...identity, description: kind === 'kit' ? 'A new Design Kit being authored.' : 'A new design Bundle being authored.' })
  if (kind === 'kit') return [
    entry('mindset.md', '---\n' + frontmatter + '---\n\n# ' + title.en + '\n\n' +
      'Define this Kit’s design purpose, domain judgment and Bundle selection guidance.\n\n<design_skills>\n</design_skills>\n'),
    entry('kit.yaml', stringify({ version: 1, mounts: [] })),
  ]
  return [
    entry('SKILL.md', '---\n' + frontmatter + '---\n\n# ' + title.en + '\n\n' +
      'This is an unfinished authoring source. Define the user need, owned design facts, domain methods, failure handling and revision protocol before using this Bundle.\n\n' +
      'Keep the [output contract](reference/output-contract.md), schema, validation and Panel aligned.\n'),
    entry('skill.yaml', stringify({ ...identity, title, label: { ...title }, execution: { handoff: 'must_edit' }, presentation: { mode: 'declarative' } })),
    entry('schema.yaml', '# Define the domain-owned design facts before use.\ntype: object\nadditional_properties: false\nproperties: {}\n'),
    entry('validation.yaml', stringify({ skill: identity.name, rules: [] })),
    entry('panel.yaml', '# Compose the shared components after defining the design facts.\nversion: 1\nsections: []\nfields: []\n'),
    entry('reference/output-contract.md', '# Output contract\n\nThis Bundle is not yet defined. Specify owned facts, source evidence, validation and saved outputs alongside the method.\n'),
    entry('reference/preview.json', '{}\n'),
  ]
}

export async function createStudioInstances(options) {
  const { catalog, composition, stateRoot } = options
  if (!catalog || !['listBundles', 'captureKit', 'captureBundle'].every(method => typeof catalog[method] === 'function')
    || !composition || !['forkBundle', 'projectMounts', 'validateKit'].every(method => typeof composition[method] === 'function')) throw new Error('Independent Studio catalog and Core composition ports are required.')
  const { repository, sources } = await createStudioDraftPorts(options, 'instance')
  const entriesOf = async snapshotId => {
    const snapshot = await sources.open(snapshotId), entries = []
    const walk = async prefix => {
      for (const name of await snapshot.fs.listDir(join(snapshot.root, prefix))) {
        const path = prefix ? `${prefix}/${name}` : name
        if (await snapshot.fs.isDirectory(join(snapshot.root, path))) await walk(path)
        else entries.push({ path, base64: (await snapshot.fs.readBytes(join(snapshot.root, path))).toString('base64') })
      }
    }
    await walk(''); return entries
  }
  const filesOf = async record => {
    const files = new Map((await entriesOf(record.baseSnapshot)).map(entry => [entry.path, entry.base64]))
    for (const [path, content] of Object.entries(record.overlays)) files.set(path, Buffer.from(content).toString('base64'))
    return [...files].map(([path, base64]) => ({ path, base64 }))
  }
  const references = (record, records) => records.filter(item => !item.deletedAt && item.kind === 'kit'
    && item.mounts.some(mount => (mount.bundle.instanceId ?? mount.instanceId) === record.id || (record.current === true && record.kind === 'bundle' && mount.bundle.name === record.bundle.name))).map(({ id, title }) => ({ id, title }))
  const projection = (record, records) => {
    const { overlays: _overlays, importedFromSnapshot: _imported, ...result } = record
    return { ...result, refs: references(record, records), ...(record.recordVersion !== 2 ? { requiresMigration: true } : {}) }
  }
  // Display only: read the selected retained bytes, never a mutable installed base.
  // Incomplete working copies remain inspectable; their validity is still Core-owned.
  const displayCopy = async record => {
    if (record.recordVersion !== 2) return {}
    const snapshot = await sources.open(record.baseSnapshot)
    const text = async path => {
      safePath(path)
      let value
      try { value = record.overlays[path] ?? await snapshot.fs.readText(join(snapshot.root, path)) }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
      return typeof value === 'string' && Buffer.byteLength(value) <= MAX_TEXT ? value : undefined
    }
    const source = await text(record.kind === 'kit' ? 'mindset.md' : 'SKILL.md')
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source ?? '')
    let meta = {}, translated
    try { meta = frontmatter ? parseYaml(frontmatter[1]) ?? {} : {} } catch { /* Editable malformed metadata is not a catalog-wide failure. */ }
    if (record.kind === 'kit') translated = meta.display_description
    else {
      let locales = {}
      try { locales = parseYaml(await text('panel.yaml') ?? '')?.i18n?.locales ?? {} } catch { /* A working declaration may be incomplete. */ }
      const readLocale = async locale => {
        const path = locales[locale]
        if (typeof path !== 'string' || !/^locales\/[A-Za-z0-9._-]+\.json$/.test(path)) return undefined
        try { return JSON.parse(await text(path) ?? '{}').bundleDescription } catch { return undefined }
      }
      translated = { zh: await readLocale('zh-CN'), en: await readLocale('en-US') }
      if (translated.zh === undefined && translated.en === undefined) {
        try { translated = parseYaml(await text('skill.yaml') ?? '')?.description } catch { /* Original description remains available. */ }
      }
    }
    return {
      ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
      ...(translated && ['zh', 'en'].every(language => typeof translated[language] === 'string' && translated[language].trim())
        ? { displayDescription: { zh: translated.zh, en: translated.en } } : {}),
    }
  }
  const candidates = async records => {
    const result = [...(await catalog.listBundles().catch(() => [])).map(item => ({ ...pin(item), title: titleOf(item.title), runtimeName: runtimeNameOf(item.runtimeName),
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      ...(item.displayDescription && ['zh', 'en'].every(language => typeof item.displayDescription[language] === 'string' && item.displayDescription[language].trim())
        ? { displayDescription: { zh: item.displayDescription.zh, en: item.displayDescription.en } } : {}),
    })),
      ...await Promise.all(records.filter(item => item.recordVersion === 2 && item.kind === 'bundle' && !item.deletedAt)
        .map(async item => ({ ...pin(item.bundle), title: item.title, runtimeName: runtimeNameOf(item.runtimeName), instanceId: item.id, revision: item.revision, ...await displayCopy(item) })))]
    const unique = new Map()
    // A current editable source replaces its read-only catalog projection by identity.
    for (const item of result) {
      const previous = unique.get(item.name)
      if (!previous || item.instanceId !== undefined) unique.set(item.name, item)
    }
    return [...unique.values()]
  }
  const identityDiagnostics = (record, files) => {
    if (record.kind !== 'bundle') return []
    const file = files.find(file => file.path === 'skill.yaml')
    if (!file) return []
    let manifest
    try { manifest = parseYaml(decode(file.base64)) } catch { return [] }
    if ((manifest?.identity ?? manifest?.name) === record.bundle.name) return []
    return [{ code: 'instance.identity', subject: 'skill.yaml',
      message: `skill.yaml：请设置 identity: ${record.bundle.name}；name 与 SKILL.md 的运行名称保持一致。\nSet skill.yaml identity to ${record.bundle.name}. Keep name consistent with the runtime name in SKILL.md.` }]
  }
  const displayDiagnostics = (record, diagnostics) => diagnostics.map(diagnostic => {
    if (record.kind !== 'kit') return diagnostic
    if (/Mindset .*?(?:must contain|has an empty).*?<design_skills> catalog/.test(diagnostic.message)) return {
      ...diagnostic, subject: 'mindset.md',
      message: 'mindset.md 的技能目录尚未完善：请保留方法正文，并按 kit.yaml 中的挂载补充一个 <design_skills> 目录。\nComplete one <design_skills> catalog in mindset.md using the mounts in kit.yaml, while preserving the method guidance.',
    }
    return { ...diagnostic, message: diagnostic.message.replaceAll(record.kit.name, `${record.title.zh} / ${record.title.en}`) }
  })
  const readinessDiagnostics = (record, diagnostics) => displayDiagnostics(record, diagnostics)
    .map(({ subject, ...diagnostic }) => ({ ...diagnostic, ...(subject ? { path: subject } : {}) }))
  // Imported sources remain editable; readiness always evaluates the current saved bytes.
  const readiness = async record => {
    if (!record.importedFromSnapshot) return {}
    const files = await filesOf(record), paths = new Set(files.map(file => file.path)), diagnostics = []
    const required = record.kind === 'bundle' ? ['SKILL.md', 'skill.yaml', 'schema.yaml', 'validation.yaml'] : ['mindset.md', 'kit.yaml']
    for (const path of required) if (!paths.has(path)) diagnostics.push({ code: 'instance.missing_source', path,
      message: `Missing ${path}. Add this source file to complete the definition.`, severity: 'error' })
    if (!diagnostics.length) {
      try {
        if (record.kind === 'kit') {
          for (const mount of record.mounts) {
            const entries = (await resolveMounts(record.mounts, record.current === true)(mount.bundle)).files
            if (!entries.some(file => file.path === 'SKILL.md')) diagnostics.push({ code: 'instance.missing_mount', path: 'kit.yaml',
              message: `Missing exact Bundle ${mount.bundle.name}@${mount.bundle.version}. Repair the Bundle selection in mount management.`, severity: 'error' })
          }
          if (!diagnostics.length) await composition.validateKit(await kitInput(record))
        } else {
          const identity = identityDiagnostics(record, files)
          if (identity.length) return { readiness: { ready: false, diagnostics: readinessDiagnostics(record, identity) } }
          if (typeof composition.validateBundle !== 'function') throw new Error('The host has not supplied the Core Bundle definition validator.')
          await composition.validateBundle({ bundle: record.bundle, bundleFiles: files, sourceId: record.sourceId, runtimeName: record.runtimeName })
        }
      } catch (error) { diagnostics.push({ code: 'instance.definition', message: error instanceof Error ? error.message : String(error), severity: 'error' }) }
    }
    return { readiness: { ready: diagnostics.length === 0, diagnostics: readinessDiagnostics(record, diagnostics) } }
  }
  const importedRuntime = (record, files) => {
    if (record.kind !== 'bundle' || !record.importedFromSnapshot) return {}
    try {
      const method = decode(files.find(file => file.path === 'SKILL.md')?.base64 ?? '')
      const metadata = parseYaml(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(method)?.[1] ?? '')
      return { runtimeName: runtimeNameOf(metadata?.name) }
    } catch { return {} }
  }
  const projectImported = async (record, files) => typeof composition.projectSourceIdentity === 'function'
    ? composition.projectSourceIdentity({ kind: record.kind, files, identity: record[record.kind] }) : files
  const describe = async (record, records = undefined) => {
    records ??= await repository.list()
    if (record.recordVersion !== 2) return projection(record, records)
    const files = (await filesOf(record)).map(entry => {
      const bytes = Buffer.byteLength(entry.base64, 'base64'); let editable = bytes <= MAX_TEXT
      try { decode(entry.base64) } catch { editable = false }
      return { path: entry.path, bytes, editable }
    }).sort((a, b) => a.path.localeCompare(b.path))
    return { ...projection(record, records), ...await displayCopy(record), ...await readiness(record), files, ...(record.kind === 'kit' ? { availableBundles: await candidates(records) } : {}) }
  }
  const read = async input => describe(active(await repository.read(typeof input === 'string' ? input : input.id)))
  const mountRequests = (kitFiles, mounts) => {
    const declaration = kitFiles.find(file => file.path === 'kit.yaml')
    try { return declaration ? parseKitMounts(decode(declaration.base64)) : mounts.map(mount => pin(mount.bundle)) }
    catch { return mounts.map(mount => pin(mount.bundle)) } // Incomplete source remains savable/exportable; Core diagnoses it at load/preview.
  }
  const resolveMounts = (mounts, currentLibrary = false) => async requested => {
    const selected = mounts.find(mount => same(mount.bundle, pin(requested)))
    if (!selected) throw new Error('Core requested a Bundle outside the selected exact mounts.')
    if (selected.bundle.instanceId) {
      const current = modern(await repository.read(selected.bundle.instanceId))
      if (current.kind !== 'bundle' || current.bundle.name !== selected.bundle.name) throw new Error('Mounted Bundle identity changed.')
      return { files: await filesOf(current), sourceId: current.sourceId }
    }
    const current = (await repository.list()).find(record => !record.deletedAt && record.current === true && record.kind === 'bundle' && record.bundle.name === selected.bundle.name)
    if (current) return { files: await filesOf(current), sourceId: current.sourceId }
    if (currentLibrary && selected.bundle.version !== requested.version) return catalog.captureBundle(pin(requested))
    return { files: await entriesOf(selected.bundle.source.snapshot), sourceId: selected.bundle.source.sourceId }
  }
  const kitInput = async record => ({ kit: record.kit, kitFiles: await filesOf(record), mounts: record.mounts, resolveBundle: resolveMounts(record.mounts, record.current === true) })
  const retain = async (tx, files, sourceId) => { requireSourceId(sourceId); return { snapshot: (await tx.retainTree(files)).id, sourceId } }
  const mountOne = async (tx, requested, available) => {
    const selected = available.find(item => same(item, pin(requested)))
    if (!selected) throw new Error(`Bundle ${requested.name}@${requested.version} is unavailable in the global catalog.`)
    const bindingKey = runtimeNameOf(requested.bindingKey ?? selected.runtimeName)
    if (bindingKey !== selected.runtimeName) throw new Error('Bundle binding key must preserve its runtime name.')
    if (selected.instanceId) {
      if (requested.instanceId !== undefined && requested.instanceId !== selected.instanceId) throw new Error('Bundle instance identity does not match its pin.')
      const record = modern(await tx.read(selected.instanceId))
      // Membership follows stable identity. Revisions protect writes, never mount usability.
      return { bindingKey, bundle: { ...record.bundle, instanceId: record.id, revision: record.revision, source: await retain(tx, await filesOf(record), record.sourceId) } }
    }
    if (requested.instanceId !== undefined || requested.revision !== undefined) throw new Error('Installed Bundle pins do not accept local instance fields.')
    const captured = await catalog.captureBundle(pin(requested))
    return { bindingKey, bundle: { ...pin(requested), source: await retain(tx, captured.files, captured.sourceId) } }
  }
  const projectedKit = async (record, mounts) => {
    const kitFiles = await composition.projectMounts({ allowEmptyDraft: true, kit: record.kit, kitFiles: await filesOf(record), mounts: mounts.map(mount => ({ bindingKey: mount.bindingKey, ...pin(mount.bundle) })), resolveBundle: resolveMounts(mounts, record.current === true) })
    if (kitFiles.some(entry => entry.path.startsWith('skills/'))) throw new Error('Kit-owned sources cannot contain copied Bundle trees.')
    return kitFiles
  }
  const newTitle = (input, base) => titleOf(input ?? { zh: `${base.zh} 副本`, en: `${base.en} copy` })
  const prepareFiles = async (current, input) => {
    const before = await filesOf(current), entries = new Map(before.map(file => [file.path, file.base64])), diff = []
    let diffBytes = 0
    for (const { path, content } of input.changes) {
      const original = entries.get(path)
      if (original === undefined && content === null) throw new Error(`Cannot remove missing source file ${path}.`)
      if (original !== undefined && Buffer.byteLength(original, 'base64') > MAX_TEXT) throw new Error('Text editing is limited to 1 MiB per existing file.')
      const previous = original === undefined ? undefined : decode(original)
      diffBytes += Buffer.byteLength(previous ?? '') + Buffer.byteLength(content ?? '')
      if (diffBytes > STUDIO_INSTANCE_CHANGE_LIMITS.diffBytes) throw new Error('Instance diff exceeds the 8 MiB text budget.')
      if (current.kind === 'kit' && (path === 'kit.yaml' || path.startsWith('skills/'))) throw new Error('Use Bundle mount management to edit the Kit declaration; Kit copies contain only Kit-owned files.')
      if (content === null) entries.delete(path)
      else entries.set(path, Buffer.from(content, 'utf8').toString('base64'))
      if (previous !== (content ?? undefined)) diff.push({ path, ...(previous === undefined ? {} : { before: previous }), ...(content === null ? {} : { after: content }) })
    }
    const files = [...entries].map(([path, base64]) => ({ path, base64 }))
    if (files.length > 4096 || files.reduce((bytes, file) => bytes + Buffer.byteLength(file.base64, 'base64'), 0) > 16 * 1024 * 1024) throw new Error('Instance source tree exceeds 4096 files or 16 MiB.')
    const paths = new Set(entries.keys())
    for (const path of paths) {
      const parts = path.split('/')
      for (let length = 1; length < parts.length; length++) if (paths.has(parts.slice(0, length).join('/'))) throw new Error('Instance source file conflicts with a directory.')
    }
    const dependencyRequests = current.kind === 'kit' ? mountRequests(files, current.mounts) : []
    const digest = createHash('sha256').update(JSON.stringify({ id: current.id, baseRevision: current.revision,
      kind: current.kind, pin: current[current.kind], runtimeName: current.runtimeName, sourceId: current.sourceId,
      mounts: await Promise.all(dependencyRequests.map(async requested => ({ name: requested.name, source: await resolveMounts(current.mounts, current.current === true)(requested) }))), before: canonicalFiles(before), after: canonicalFiles(files), bundle: input.bundle, sampleSource: input.sampleSource })).digest('hex')
    return { files, diff: diff.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), digest }
  }
  const previewChanges = async (current, input, prepared) => {
    const revision = current.revision + 1
    let result
    try {
      if (typeof composition.preview !== 'function') throw new Error('The host has not supplied the Core preview adapter.')
      if (current.kind === 'bundle') {
        if (input.bundle && !same(input.bundle, current.bundle)) throw new Error('Select this exact Bundle instance.')
        const identity = identityDiagnostics(current, prepared.files)
        result = identity.length ? { diagnostics: identity } : await composition.preview({ kind: 'bundle', bundle: current.bundle, runtimeName: importedRuntime(current, prepared.files).runtimeName ?? current.runtimeName,
          bundleFiles: prepared.files, sourceId: current.sourceId, revision, sampleSource: input.sampleSource })
      } else {
        const bundle = pin(input.bundle)
        if (!current.mounts.some(mount => same(mount.bundle, bundle))) throw new Error('Select an exact mounted Bundle.')
        result = await composition.preview({ kind: 'kit', kit: current.kit, kitFiles: prepared.files, mounts: current.mounts,
          resolveBundle: resolveMounts(current.mounts, current.current === true), bundle, revision, sampleSource: input.sampleSource })
      }
      if (!result || !Array.isArray(result.diagnostics)) throw new Error('Core preview did not return a diagnostic result.')
      if (result.preview && result.preview.revision !== revision) throw new Error('Core preview revision does not match this candidate.')
    } catch (error) { result = { diagnostics: [{ code: 'instance.candidate', message: error instanceof Error ? error.message : String(error) }] } }
    return { id: current.id, baseRevision: current.revision, revision, digest: prepared.digest, diff: prepared.diff,
      valid: !!result.preview && !result.diagnostics.some(entry => entry.severity !== 'warning'),
      diagnostics: displayDiagnostics(current, result.diagnostics), ...(result.preview ? { preview: result.preview } : {}) }
  }
  const definitionOnly = (current, input, files) => {
    if (current.kind === 'kit') return input.bundle === undefined
    try {
      const manifest = parseYaml(decode(files.find(file => file.path === 'skill.yaml')?.base64 ?? ''))
      // This selects the existing validator; only Core can accept the definition.
      return manifest && typeof manifest === 'object' && !Array.isArray(manifest)
        && (manifest.presentation === undefined || manifest.presentation?.mode === 'none')
    } catch { return false }
  }
  const definitionDiagnostics = async (current, input, files) => {
    const diagnostics = []
    try {
      if (current.kind === 'kit') {
        await composition.validateKit({ kit: current.kit, kitFiles: files, mounts: current.mounts,
          resolveBundle: resolveMounts(current.mounts, current.current === true) })
      } else {
        if (input.bundle && !same(input.bundle, current.bundle)) throw new Error('Select this exact Bundle instance.')
        diagnostics.push(...identityDiagnostics(current, files))
        if (!diagnostics.length) {
          if (typeof composition.validateBundle !== 'function') throw new Error('The host has not supplied the Core Bundle definition validator.')
          await composition.validateBundle({ bundle: current.bundle, bundleFiles: files, sourceId: current.sourceId,
            runtimeName: importedRuntime(current, files).runtimeName ?? current.runtimeName })
        }
      }
    } catch (error) { diagnostics.push({ code: 'instance.definition', message: error instanceof Error ? error.message : String(error) }) }
    return diagnostics
  }
  const validateChanges = async (current, input, prepared) => {
    if (!definitionOnly(current, input, prepared.files)) return previewChanges(current, input, prepared)
    const diagnostics = await definitionDiagnostics(current, input, prepared.files)
    return { id: current.id, baseRevision: current.revision, revision: current.revision + 1,
      digest: prepared.digest, diff: prepared.diff, valid: diagnostics.length === 0, diagnostics: displayDiagnostics(current, diagnostics) }
  }
  return {
    read,
    async captureKit({ id, expectedRevision } = {}) {
      return repository.transaction(async tx => {
        const record = modern(await tx.read(id))
        if (expectedRevision !== undefined) checkRevision(record, expectedRevision)
        if (record.kind !== 'kit') throw new Error('Select a Kit source.')
        const captured = new Map(), kitFiles = await filesOf(record), resolveBundle = resolveMounts(record.mounts, record.current === true)
        for (const requested of mountRequests(kitFiles, record.mounts)) captured.set(requested.name, await resolveBundle(requested))
        return { kit: record.kit, kitFiles, mounts: structuredClone(record.mounts),
          resolveBundle: async requested => captured.get(requested.name) }
      })
    },
    async loadKit(input) {
      if (typeof composition.loadKit !== 'function') throw new Error('The host has not supplied the Core Kit loader.')
      return composition.loadKit(await this.captureKit(input))
    },
    async editCurrent(input) {
      if (!['kit', 'bundle'].includes(input.kind)) throw new Error('Select a Kit or Bundle.')
      const selected = pin(input[input.kind])
      const record = await repository.transaction(async tx => {
        const records = await tx.list()
        const existing = records.find(item => !item.deletedAt && item.kind === input.kind && item.current === true && item[item.kind].name === selected.name)
        if (existing) return existing
        const captured = input.kind === 'kit' ? await catalog.captureKit(selected) : await catalog.captureBundle(selected)
        const sourceId = input.kind === 'bundle' ? captured.sourceId : `local:kit:${selected.name}`
        const source = await retain(tx, captured.files, sourceId)
        const mounts = []
        if (input.kind === 'kit') {
          const available = await candidates(records)
          for (const mounted of captured.mounts) mounts.push(await mountOne(tx, mounted, available))
        }
        return tx.create({ recordVersion: 2, current: true, kind: input.kind, [input.kind]: selected,
          title: captured.title ?? { zh: selected.name, en: selected.name }, source: { [input.kind]: selected }, sourceId,
          baseSnapshot: source.snapshot, overlays: {}, mounts,
          ...(input.kind === 'bundle' ? { runtimeName: captured.runtimeName } : {}), createdAt: new Date().toISOString() })
      })
      return describe(record)
    },
    /** Unsaved, bounded source candidate; diff and real preview use the same bytes. */
    async exportArchive(request) {
      const input = structuredClone(request)
      return repository.transaction(async tx => {
        const current = active(await tx.read(input.id))
        if (current.revision !== input.expectedRevision) throw new Error('Instance revision changed before archive export.')
        if (current.recordVersion !== 2) throw new Error('Migrate the working copy before archive export.')
        const root = resolve(stateRoot, 'instance-archive-view', current.id)
        const snapshot = archiveSnapshot(root, await filesOf(current), `studio-instance:${current.id}`)
        if (current.kind === 'bundle') snapshot.bundle = pin(current.bundle)
        else {
          snapshot.bundles = []
          const resolveBundle = resolveMounts(current.mounts, current.current === true)
          for (const requested of mountRequests(await filesOf(current), current.mounts)) {
            const captured = await resolveBundle(requested)
            snapshot.bundles.push({ ...pin(requested), sourceId: captured.sourceId,
              snapshot: archiveSnapshot(resolve(root, '..', `${current.id}-bundle-${requested.name}`), captured.files, captured.sourceId) })
          }
        }
        return exportStudioSourceArchive(snapshot, { kind: current.kind, pin: current.kind === 'kit' ? current.kit : current.bundle, title: current.title,
          provenance: input.provenance, ...(input.dependencies ? { dependencies: input.dependencies } : {}) })
      })
    },
    async prepareChanges(request) {
      const input = normalizeStudioInstanceChanges(request)
      return repository.transaction(async tx => {
        const current = modern(await tx.read(input.id)); checkRevision(current, input.expectedRevision)
        return validateChanges(current, input, await prepareFiles(current, input))
      })
    },
    /** One snapshot pointer + one existing atomic record CAS, never per-file writes. */
    async saveChanges(request) {
      const input = normalizeStudioInstanceChanges(request), mode = request.mode ?? 'draft', digest = request.digest
      if (!['draft', 'validated'].includes(mode)) throw new Error('Select draft or validated save mode.')
      if ((mode === 'validated' || digest !== undefined) && (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))) throw new Error('Select the exact prepared candidate digest.')
      let receipt
      const record = await repository.transaction(async tx => {
        const current = modern(await tx.read(input.id)); checkRevision(current, input.expectedRevision)
        const prepared = await prepareFiles(current, input)
        if (digest !== undefined && digest !== prepared.digest) throw new Error('Candidate source digest changed. Prepare and review the current changes again.')
        let validation = 'not_requested'
        if (mode === 'validated') {
          const sourceOnly = definitionOnly(current, input, prepared.files)
          const candidate = await validateChanges(current, input, prepared)
          if (!candidate.valid) throw new Error(`Candidate failed Core ${sourceOnly ? 'definition' : 'preview'}: ${candidate.diagnostics.map(entry => `${entry.code}: ${entry.message}`).join('; ') || 'no valid declarative preview'}`)
          validation = sourceOnly ? 'definition_passed' : 'preview_passed'
        }
        const retained = await retain(tx, prepared.files, current.sourceId)
        const saved = await tx.replace(current.id, input.expectedRevision, { ...current, ...importedRuntime(current, prepared.files), baseSnapshot: retained.snapshot, overlays: {} })
        receipt = { baseRevision: current.revision, revision: saved.revision, digest: prepared.digest, mode, validation }
        return saved
      })
      return { ...await describe(record), changeReceipt: receipt }
    },
    async list({ kind } = {}) {
      if (kind !== undefined && !['kit', 'bundle'].includes(kind)) throw new Error('Unknown instance kind.')
      const records = await repository.list()
      return Promise.all(records.filter(record => !record.deletedAt && (!kind || record.kind === kind)).map(async record => ({ ...projection(record, records), ...await displayCopy(record), ...await readiness(record) })))
    },
    async listBundles() { return candidates(await repository.list()) },
    async importSources(request) {
      const input = structuredClone(request)
      if (!input || !['kit', 'bundle'].includes(input.kind) || !Array.isArray(input.files)) throw new Error('Provide Kit or Bundle source files.')
      const kind = input.kind
      for (const file of input.files) safePath(file?.path)
      const paths = new Set(input.files.map(file => file.path))
      for (const path of kind === 'bundle' ? ['SKILL.md'] : ['mindset.md', 'kit.yaml']) {
        if (!paths.has(path)) throw new Error(`Missing required import source ${path}.`)
      }
      const metadata = path => {
        try {
          const text = decode(input.files.find(file => file.path === path)?.base64 ?? '')
          return parseYaml(path.endsWith('.md') ? /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? '' : text) ?? {}
        } catch { return {} }
      }
      const method = metadata(kind === 'bundle' ? 'SKILL.md' : 'mindset.md'), manifest = metadata(kind === 'bundle' ? 'skill.yaml' : 'kit.yaml')
      const version = /^\d+\.\d+$/.test(String(manifest.version)) ? String(manifest.version) : /^\d+\.\d+$/.test(String(method.version)) ? String(method.version) : '1.0'
      const identity = localPin(kind, version), sourceId = localSourceId(kind, identity)
      const runtimeName = [method.name, manifest.name].find(value => typeof value === 'string' && runtimeNamePattern.test(value)) ?? identity.name
      const label = typeof method.name === 'string' && method.name.trim() ? method.name.trim().slice(0, 180) : kind === 'kit' ? 'Imported Kit' : 'Imported Bundle'
      const inferredTitle = ['zh', 'en'].every(language => typeof manifest.title?.[language] === 'string'
        && manifest.title[language].trim() && manifest.title[language].length <= 200) ? manifest.title : { zh: label, en: label }
      const baseTitle = titleOf(input.title ?? inferredTitle)
      const created = await repository.transaction(async tx => {
        // Reuse retained S2 snapshots for originals and every projected revision.
        const original = await retain(tx, input.files, sourceId), records = await tx.list()
        const labels = [...records.filter(record => !record.deletedAt).map(record => record.title), ...(await catalog.listBundles()).map(item => item.title)]
        let title = baseTitle, suffix = 2
        while (labels.some(item => item.zh === title.zh || item.en === title.en)) {
          title = titleOf({ zh: `${baseTitle.zh.slice(0, 180)} (${suffix})`, en: `${baseTitle.en.slice(0, 180)} (${suffix})` }); suffix++
        }
        let files = input.files, mounts = []
        if (kind === 'kit') {
          const consumed = new Set(), declared = Array.isArray(manifest.mounts) ? manifest.mounts : []
          for (const item of declared) {
            let selected, bindingKey
            try { selected = pin(item); bindingKey = runtimeNameOf(item.bindingKey) } catch { continue }
            if (mounts.some(mount => same(mount.bundle, selected) || mount.bindingKey === bindingKey)) continue
            const prefixes = [`bundles/${selected.name}/${selected.version}/`, `bundles/${selected.name}/`, `skills/${bindingKey}/`]
            const prefix = prefixes.find(prefix => input.files.some(file => file.path.startsWith(prefix)))
            let bundleFiles = prefix ? input.files.filter(file => file.path.startsWith(prefix)).map(file => { consumed.add(file.path); return { ...file, path: file.path.slice(prefix.length) } }) : []
            let mountedSourceId = `import:bundle:${selected.name}@${selected.version}`
            if (!prefix) {
              // Only the exact declared pin may resolve from the trusted catalog.
              try { const capture = await catalog.captureBundle(selected); bundleFiles = capture.files; mountedSourceId = capture.sourceId } catch { /* Missing exact dependency is repairable through mount management. */ }
            }
            mounts.push({ bindingKey, bundle: { ...selected, source: await retain(tx, bundleFiles, mountedSourceId) } })
          }
          files = input.files.filter(file => !consumed.has(file.path))
        }
        const record = { recordVersion: 2, kind, [kind]: identity, title, source: {}, sourceId,
          baseSnapshot: original.snapshot, importedFromSnapshot: original.snapshot, overlays: {}, mounts,
          ...(kind === 'bundle' ? { runtimeName } : {}), createdAt: new Date().toISOString() }
        files = await projectImported(record, files)
        record.baseSnapshot = (await retain(tx, files, sourceId)).snapshot
        return tx.create(record)
      })
      return describe(created)
    },
    async create(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['kind', 'title'].includes(key))
        || !['kit', 'bundle'].includes(input.kind)) throw new Error('Provide a new Kit or Bundle kind and display title.')
      const kind = input.kind, title = titleOf(input.title), identity = localPin(kind, '1.0')
      const sourceId = localSourceId(kind, identity), initial = blankSources(kind, identity, title)
      const files = kind === 'kit' ? await composition.projectMounts({ allowEmptyDraft: true, kit: identity, kitFiles: initial,
        mounts: [], resolveBundle: async () => { throw new Error('Blank Kit creation cannot resolve installed Bundles.') } }) : initial
      const created = await repository.transaction(async tx => {
        const source = await retain(tx, files, sourceId)
        return tx.create({ recordVersion: 2, kind, [kind]: identity, title, source: {}, sourceId,
          baseSnapshot: source.snapshot, overlays: {}, mounts: [], createdBlank: true,
          ...(kind === 'bundle' ? { runtimeName: identity.name } : {}), createdAt: new Date().toISOString() })
      })
      return describe(created)
    },
    async copy(input) {
      if (!['kit', 'bundle'].includes(input.kind)) throw new Error('Select a Kit or Bundle instance.')
      const created = await repository.transaction(async tx => {
        const original = input.sourceId ? modern(await tx.read(input.sourceId)) : undefined
        if (original && original.kind !== input.kind) throw new Error('The source instance kind does not match.')
        if (original && input.expectedRevision !== undefined) checkRevision(original, input.expectedRevision)
        let files, origin, baseTitle, mounts = [], sourcePin, runtimeName
        if (original) {
          files = await filesOf(original); sourcePin = original[original.kind]; origin = original.source; baseTitle = original.title; mounts = structuredClone(original.mounts); runtimeName = original.runtimeName
        } else if (input.kind === 'bundle') {
          sourcePin = pin(input.bundle)
          const captured = await catalog.captureBundle(sourcePin)
          requireSourceId(captured.sourceId)
          runtimeName = runtimeNameOf(captured.runtimeName)
          files = captured.files; baseTitle = titleOf(captured.title); origin = { bundle: sourcePin }
        } else {
          sourcePin = pin(input.kit)
          const captured = await catalog.captureKit(sourcePin)
          files = captured.files; origin = { kit: sourcePin }
          const label = sourcePin.name.replace(/[_-]+/g, ' ')
          baseTitle = captured.title ?? { zh: label, en: label }
          const available = await candidates(await tx.list())
          for (const mounted of captured.mounts) mounts.push(await mountOne(tx, mounted, available))
        }
        const identity = localPin(input.kind, sourcePin.version), sourceId = localSourceId(input.kind, identity)
        if (input.kind === 'kit' && files.some(file => file.path.startsWith('skills/'))) throw new Error('Kit capture must contain only Kit-owned files; legacy whole-Kit sources require explicit migration.')
        if (input.kind === 'bundle') files = original?.importedFromSnapshot
          ? await projectImported({ kind: 'bundle', bundle: identity }, files)
          : await composition.forkBundle({ files, from: sourcePin, to: identity, runtimeName })
        const source = await retain(tx, files, sourceId)
        const record = { recordVersion: 2, kind: input.kind, [input.kind]: identity, title: newTitle(input.title, baseTitle),
          source: origin, sourceId, baseSnapshot: source.snapshot, overlays: {}, mounts,
          ...(input.kind === 'bundle' ? { runtimeName } : {}), ...(original?.createdBlank ? { createdBlank: true } : {}),
          ...(original?.importedFromSnapshot ? { importedFromSnapshot: original.importedFromSnapshot } : {}),
          createdAt: new Date().toISOString(), ...(original ? { forkedFrom: { id: original.id, revision: original.revision, pin: sourcePin } } : {}) }
        if (record.kind === 'kit') record.baseSnapshot = (await retain(tx, record.importedFromSnapshot ? await projectImported(record, files) : await projectedKit(record, mounts), sourceId)).snapshot
        return tx.create(record)
      })
      return describe(created)
    },
    async rename({ id, expectedRevision, title }) {
      const nextTitle = titleOf(title)
      const record = await repository.transaction(async tx => {
        const current = modern(await tx.read(id)); checkRevision(current, expectedRevision)
        return tx.replace(id, expectedRevision, { ...current, title: nextTitle })
      })
      return describe(record)
    },
    async updateMounts({ id, expectedRevision, bundles }) {
      if (!Array.isArray(bundles) || bundles.length > 4096) throw new Error('Provide a bounded Bundle selection.')
      if (new Set(bundles.map(item => pin(item).name)).size !== bundles.length) throw new Error('A Kit can mount each Bundle only once.')
      const record = await repository.transaction(async tx => {
        const current = modern(await tx.read(id)); checkRevision(current, expectedRevision)
        if (current.kind !== 'kit') throw new Error('Mount management requires a local Kit instance.')
        const available = await candidates(await tx.list()), mounts = []
        for (const selected of bundles) {
          const existing = current.mounts.find(mount => same(mount.bundle, pin(selected))
            && (selected.bindingKey === undefined || selected.bindingKey === mount.bindingKey)
            && (selected.instanceId === undefined || selected.instanceId === mount.bundle.instanceId)
            && (selected.revision === undefined || selected.revision === mount.bundle.revision))
          let mounted = existing
          if (existing && current.importedFromSnapshot) {
            const files = await entriesOf(existing.bundle.source.snapshot)
            if (available.some(item => same(item, selected))) {
              let incomplete = !files.some(file => file.path === 'SKILL.md')
              if (!incomplete && typeof composition.validateBundle === 'function') {
                try { await composition.validateBundle({ bundle: pin(existing.bundle), bundleFiles: files,
                  sourceId: existing.bundle.source.sourceId, runtimeName: existing.bindingKey }) }
                catch { incomplete = true }
              }
              if (incomplete) {
                try { mounted = await mountOne(tx, selected, available) } catch { /* Preserve unresolved dependencies while authoring other membership. */ }
              }
            }
          }
          mounts.push(mounted ?? await mountOne(tx, selected, available))
        }
        if (new Set(mounts.map(mount => mount.bindingKey)).size !== mounts.length) throw new Error('Bundle binding keys must be unique.')
        const source = await retain(tx, await projectedKit(current, mounts), current.sourceId)
        return tx.replace(id, expectedRevision, { ...current, mounts, baseSnapshot: source.snapshot, overlays: {} })
      })
      return describe(record)
    },
    async remove({ id, expectedRevision }) {
      return repository.transaction(async tx => {
        const current = active(await tx.read(id)); checkRevision(current, expectedRevision)
        const refs = references(current, await tx.list())
        if (refs.length) throw new Error(`This Bundle is referenced by ${refs.map(item => item.title.en).join(', ')}. Referenced instances are protected from deletion.`)
        return tx.trash(id, expectedRevision)
      })
    },
    async readFile({ id, path }) {
      safePath(path)
      const record = modern(await repository.read(id)), file = (await filesOf(record)).find(entry => entry.path === path)
      if (!file) throw new Error('Instance source file does not exist.')
      if (Buffer.byteLength(file.base64, 'base64') > MAX_TEXT) throw new Error('Text editing is limited to 1 MiB per file.')
      return { id, revision: record.revision, path, content: decode(file.base64) }
    },
    async saveFile({ id, expectedRevision, path, content }) {
      safePath(path)
      if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_TEXT || content.includes('\0')) throw new Error('Source must be UTF-8 text of at most 1 MiB.')
      const record = await repository.transaction(async tx => {
        const current = modern(await tx.read(id)); checkRevision(current, expectedRevision)
        const files = await filesOf(current), found = files.find(entry => entry.path === path)
        if (!found) throw new Error('Select an existing source file to edit.')
        decode(found.base64)
        if (current.kind === 'kit' && path === 'kit.yaml') throw new Error('Use Bundle mount management to edit the Kit declaration.')
        return tx.replace(id, expectedRevision, { ...current, ...importedRuntime(current, files.map(file => file.path === path ? { path, base64: Buffer.from(content).toString('base64') } : file)), overlays: { ...current.overlays, [path]: content } })
      })
      return describe(record)
    },
    async preview({ id, expectedRevision, bundle: requested, sampleSource }) {
      return repository.transaction(async tx => {
        const record = modern(await tx.read(id)); checkRevision(record, expectedRevision)
        const files = record.kind === 'bundle' ? await filesOf(record) : undefined
        if (files && definitionOnly(record, {}, files)) {
          return { diagnostics: displayDiagnostics(record, await definitionDiagnostics(record, {}, files)) }
        }
        if (typeof composition.preview !== 'function') throw new Error('The host has not supplied the Core preview adapter.')
        if (record.kind === 'bundle') {
          const diagnostics = identityDiagnostics(record, files)
          if (diagnostics.length) return { diagnostics }
          return composition.preview({ kind: 'bundle', bundle: record.bundle, runtimeName: record.runtimeName, bundleFiles: files, sourceId: record.sourceId, revision: record.revision, sampleSource })
        }
        const bundle = pin(requested)
        if (!record.mounts.some(mount => same(mount.bundle, bundle))) throw new Error('Select an exact mounted Bundle.')
        const result = await composition.preview({ kind: 'kit', ...await kitInput(record), bundle, revision: record.revision, sampleSource })
        return { ...result, diagnostics: displayDiagnostics(record, result.diagnostics) }
      })
    },
    async migrate({ id, expectedRevision }) {
      const migrated = await repository.transaction(async tx => {
        const current = active(await tx.read(id)); checkRevision(current, expectedRevision)
        if (current.recordVersion === 2) throw new Error('Instance is already migrated.')
        const allFiles = await filesOf(current), identity = localPin(current.kind, current.source[current.kind].version, id), sourceId = localSourceId(current.kind, identity)
        let files, mounts = [], runtimeName
        if (current.kind === 'bundle') {
          const prefix = `${current.bundlePath}/`
          files = allFiles.filter(entry => entry.path.startsWith(prefix)).map(entry => ({ ...entry, path: entry.path.slice(prefix.length) }))
          runtimeName = runtimeNameOf(current.source.bundle.name)
          files = await composition.forkBundle({ files, from: current.source.bundle, to: identity, runtimeName })
        } else {
          for (const path of Object.keys(current.overlays)) if (path.startsWith('skills/')) {
            const name = path.split('/')[1]
            if (!current.mounts.some(mount => mount.bundle.name === name && mount.instanceId)) throw new Error('Legacy Kit contains independent Bundle edits. Preserve them as Bundle copies before migrating this Kit.')
          }
          files = allFiles.filter(entry => !entry.path.startsWith('skills/'))
          for (const old of current.mounts) {
            const prefix = `skills/${old.bundle.name}/`
            let bundleFiles = allFiles.filter(entry => entry.path.startsWith(prefix)).map(entry => ({ ...entry, path: entry.path.slice(prefix.length) }))
            let bundle = pin(old.bundle), authority
            if (old.instanceId) {
              const linked = active(await tx.read(old.instanceId))
              bundle = linked.recordVersion === 2 ? linked.bundle : localPin('bundle', old.bundle.version, old.instanceId)
              authority = localSourceId('bundle', bundle)
              bundleFiles = await composition.forkBundle({ files: bundleFiles, from: old.bundle, to: bundle, runtimeName: old.bundle.name })
            } else {
              const trusted = await catalog.captureBundle(bundle)
              if (canonicalFiles(trusted.files) !== canonicalFiles(bundleFiles)) throw new Error('Legacy Bundle bytes differ from the trusted catalog. Migrate a separate local Bundle before adopting this source.')
              authority = requireSourceId(trusted.sourceId)
            }
            mounts.push({ bindingKey: old.bundle.name, bundle: { ...bundle, source: await retain(tx, bundleFiles, authority), ...(old.instanceId ? { instanceId: old.instanceId, revision: old.revision } : {}) } })
          }
        }
        const next = { ...current, recordVersion: 2, [current.kind]: identity, sourceId, baseSnapshot: (await retain(tx, files, sourceId)).snapshot,
          overlays: {}, mounts, ...(current.kind === 'bundle' ? { runtimeName } : {}), migration: { fromRevision: current.revision, fromSnapshot: current.baseSnapshot } }
        delete next.bundlePath
        if (current.kind === 'kit') next.baseSnapshot = (await retain(tx, await projectedKit(next, mounts), sourceId)).snapshot
        return tx.migrate(id, expectedRevision, next)
      })
      return describe(migrated)
    },
  }
}
