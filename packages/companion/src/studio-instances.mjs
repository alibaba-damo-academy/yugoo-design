/** Independent local Studio sources; composition and identity rewriting belong to Core adapters. */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { createStudioDraftPorts } from './studio-panel-drafts.mjs'

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
const same = (a, b) => a.name === b.name && a.version === b.version
const runtimeNameOf = value => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Trusted Bundle runtime name is missing or invalid.')
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
const active = record => { if (record.deletedAt) throw new Error('This instance was deleted; its retained data is recoverable.'); return record }
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

export async function createStudioInstances(options) {
  const { catalog, composition } = options
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
    && item.mounts.some(mount => (mount.bundle.instanceId ?? mount.instanceId) === record.id)).map(({ id, title }) => ({ id, title }))
  const projection = (record, records) => {
    const { overlays: _overlays, confirmed: _confirmed, ...result } = record
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
    const result = [...(await catalog.listBundles()).map(item => ({ ...pin(item), title: titleOf(item.title), runtimeName: runtimeNameOf(item.runtimeName) })),
      ...records.filter(item => item.recordVersion === 2 && item.kind === 'bundle' && !item.deletedAt)
        .map(item => ({ ...pin(item.bundle), title: item.title, runtimeName: runtimeNameOf(item.runtimeName), instanceId: item.id, revision: item.revision }))]
    const keys = new Set()
    for (const item of result) { const key = `${item.name}@${item.version}`; if (keys.has(key)) throw new Error(`Ambiguous global Bundle source ${key}.`); keys.add(key) }
    return result
  }
  const describe = async (record, records = undefined) => {
    records ??= await repository.list()
    if (record.recordVersion !== 2) return projection(record, records)
    const files = (await filesOf(record)).map(entry => {
      const bytes = Buffer.byteLength(entry.base64, 'base64'); let editable = bytes <= MAX_TEXT
      try { decode(entry.base64) } catch { editable = false }
      return { path: entry.path, bytes, editable }
    }).sort((a, b) => a.path.localeCompare(b.path))
    return { ...projection(record, records), ...await displayCopy(record), files, ...(record.kind === 'kit' ? { availableBundles: await candidates(records) } : {}) }
  }
  const read = async input => describe(active(await repository.read(typeof input === 'string' ? input : input.id)))
  const resolveMounts = mounts => async requested => {
    const selected = mounts.find(mount => same(mount.bundle, pin(requested)))
    if (!selected) throw new Error('Core requested a Bundle outside the selected exact mounts.')
    return { files: await entriesOf(selected.bundle.source.snapshot), sourceId: selected.bundle.source.sourceId }
  }
  const kitInput = async record => ({ kit: record.kit, kitFiles: await filesOf(record), mounts: record.mounts, resolveBundle: resolveMounts(record.mounts) })
  const retain = async (tx, files, sourceId) => { requireSourceId(sourceId); return { snapshot: (await tx.retainTree(files)).id, sourceId } }
  const mountOne = async (tx, requested, available) => {
    const selected = available.find(item => same(item, pin(requested)))
    if (!selected) throw new Error(`Bundle ${requested.name}@${requested.version} is unavailable in the global catalog.`)
    const bindingKey = runtimeNameOf(requested.bindingKey ?? selected.runtimeName)
    if (bindingKey !== selected.runtimeName) throw new Error('Bundle binding key must preserve its runtime name.')
    if (selected.instanceId) {
      if (requested.instanceId !== undefined && requested.instanceId !== selected.instanceId) throw new Error('Bundle instance identity does not match its pin.')
      const record = modern(await tx.read(selected.instanceId))
      if (requested.revision === undefined) throw new Error('Select the exact local Bundle revision.')
      checkRevision(record, requested.revision)
      return { bindingKey, bundle: { ...record.bundle, instanceId: record.id, revision: record.revision, source: await retain(tx, await filesOf(record), record.sourceId) } }
    }
    if (requested.instanceId !== undefined || requested.revision !== undefined) throw new Error('Installed Bundle pins do not accept local instance fields.')
    const captured = await catalog.captureBundle(pin(selected))
    return { bindingKey, bundle: { ...pin(selected), source: await retain(tx, captured.files, captured.sourceId) } }
  }
  const projectedKit = async (record, mounts) => {
    const kitFiles = await composition.projectMounts({ kit: record.kit, kitFiles: await filesOf(record), mounts: mounts.map(mount => ({ bindingKey: mount.bindingKey, ...pin(mount.bundle) })), resolveBundle: resolveMounts(mounts) })
    if (kitFiles.some(entry => entry.path.startsWith('skills/'))) throw new Error('Kit-owned sources cannot contain copied Bundle trees.')
    await composition.validateKit({ kit: record.kit, kitFiles, mounts, resolveBundle: resolveMounts(mounts) })
    return kitFiles
  }
  const newTitle = (input, base) => titleOf(input ?? { zh: `${base.zh} 副本`, en: `${base.en} copy` })
  return {
    read,
    async list({ kind } = {}) {
      if (kind !== undefined && !['kit', 'bundle'].includes(kind)) throw new Error('Unknown instance kind.')
      const records = await repository.list()
      return Promise.all(records.filter(record => !record.deletedAt && (!kind || record.kind === kind)).map(async record => ({ ...projection(record, records), ...await displayCopy(record) })))
    },
    async listBundles() { return candidates(await repository.list()) },
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
        if (input.kind === 'bundle') files = await composition.forkBundle({ files, from: sourcePin, to: identity, runtimeName })
        const source = await retain(tx, files, sourceId)
        const record = { recordVersion: 2, kind: input.kind, [input.kind]: identity, title: newTitle(input.title, baseTitle),
          source: origin, sourceId, baseSnapshot: source.snapshot, overlays: {}, mounts, confirmed: false,
          ...(input.kind === 'bundle' ? { runtimeName } : {}),
          createdAt: new Date().toISOString(), ...(original ? { forkedFrom: { id: original.id, revision: original.revision, pin: sourcePin } } : {}) }
        if (record.kind === 'kit') record.baseSnapshot = (await retain(tx, await projectedKit(record, mounts), sourceId)).snapshot
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
          mounts.push(existing ?? await mountOne(tx, selected, available))
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
        const retained = await tx.replace(id, expectedRevision, { ...current, deletedAt: new Date().toISOString() })
        return { id, revision: retained.revision, deletedAt: retained.deletedAt, recoverable: true }
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
        if (current.kind === 'kit') {
          if (path === 'kit.yaml') throw new Error('Use Bundle mount management to edit the Kit declaration.')
          const edited = files.map(entry => entry.path === path ? { path, base64: Buffer.from(content).toString('base64') } : entry)
          const projected = await composition.projectMounts({ kit: current.kit, kitFiles: edited, mounts: current.mounts.map(mount => ({ bindingKey: mount.bindingKey, ...pin(mount.bundle) })), resolveBundle: resolveMounts(current.mounts) })
          if (projected.find(entry => entry.path === path)?.base64 !== edited.find(entry => entry.path === path)?.base64) throw new Error('Use Bundle mount management to change generated Kit membership or identity.')
        }
        return tx.replace(id, expectedRevision, { ...current, overlays: { ...current.overlays, [path]: content } })
      })
      return describe(record)
    },
    async preview({ id, expectedRevision, bundle: requested, sampleSource }) {
      const record = modern(await repository.read(id)); checkRevision(record, expectedRevision)
      if (typeof composition.preview !== 'function') throw new Error('The host has not supplied the Core preview adapter.')
      if (record.kind === 'bundle') return composition.preview({ kind: 'bundle', bundle: record.bundle, runtimeName: record.runtimeName, bundleFiles: await filesOf(record), sourceId: record.sourceId, revision: record.revision, sampleSource })
      const bundle = pin(requested)
      if (!record.mounts.some(mount => same(mount.bundle, bundle))) throw new Error('Select an exact mounted Bundle.')
      return composition.preview({ kind: 'kit', ...await kitInput(record), bundle, revision: record.revision, sampleSource })
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
