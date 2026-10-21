/** Thin read-only port for the existing Studio domain; no second catalog. */
import { readFile, readdir, lstat, realpath, mkdir } from 'node:fs/promises'
import { join, relative, resolve, sep, isAbsolute } from 'node:path'
import { StudioManagementService } from '../../studio/src/management.ts'
import { StudioBundleSourceService } from '../../studio/src/bundle-source.ts'
import { StudioBinaryContentError } from '../../studio/src/types.ts'
import { snapshotKit } from '../../studio/src/snapshot.ts'
import { loadStudioKit } from '../../studio/src/load.ts'
import { finalizeStudioPanelPreview } from '../../studio/src/panel-preview.ts'
import { createStudioPanelDrafts, createStudioDraftPorts } from './studio-panel-drafts.mjs'
import { StudioKitDraftService } from '../../studio/src/kit-drafts.ts'
import { ensureWindowsPrivateDirectory } from './windows-private-storage.mjs'

export async function createCompanionStudio(kit, kitRoot, stateRoot, contentLibrary) {
  const currentKit = () => typeof kit === 'function' ? kit() : kit
  const root = await realpath(currentKit().sourceRoot ?? kitRoot)
  let kitSnapshot, bundleSnapshot, catalogKit = currentKit()
  const invalidateCatalog = () => { kitSnapshot = undefined; bundleSnapshot = undefined }
  const checkCatalogKit = () => {
    const selected = currentKit()
    if (selected !== catalogKit) { invalidateCatalog(); catalogKit = selected }
  }
  // Retained exact versions are immutable. Reuse their compiled definitions
  // across detail/file reads; explicit refresh, adoption and host Kit changes
  // invalidate the projection. Source reads still perform confinement checks.
  const installedKits = () => {
    checkCatalogKit()
    return kitSnapshot ??= (async () => {
      const selected = currentKit(), entries = new Map([[`${selected.name}@${selected.version}`, selected]])
      if (contentLibrary) for (const pin of await contentLibrary.store.listKits()) {
        const retained = await contentLibrary.store.loadRetainedKit(pin)
        if (retained) entries.set(`${pin.name}@${pin.version}`, retained)
      }
      return [...entries.values()]
    })().catch(error => { kitSnapshot = undefined; throw error })
  }
  const selectedKit = async pin => {
    const selected = (await installedKits()).find(item => item.name === pin.name && String(item.version) === pin.version)
    if (!selected) throw new Error('Select the exact registered Kit version.')
    return selected
  }
  const installedBundles = () => {
    checkCatalogKit()
    return bundleSnapshot ??= readInstalledBundles().catch(error => { bundleSnapshot = undefined; throw error })
  }
  const readInstalledBundles = async () => {
    const entries = new Map(currentKit().skills.map(skill => [`${skill.catalogName ?? skill.name}@${skill.version}`, skill]))
    if (contentLibrary) for (const pin of await contentLibrary.store.listBundles()) {
      const retained = await contentLibrary.store.resolveBundle(pin)
      if (retained) entries.set(`${pin.name}@${pin.version}`, retained.skill)
    }
    return [...entries.values()]
  }
  const catalog = { snapshot: async () => {
    // Legacy directory authoring is mutable and keeps its existing fresh-read
    // behavior; only the retained content-library catalog can be reused.
    if (!contentLibrary) invalidateCatalog()
    return { kits: (await installedKits()).map(snapshotKit), bundles: (await installedBundles()).map(skill => ({
      name: skill.catalogName ?? skill.name, version: String(skill.version), definition: skill,
    })) }
  } }
  const safe = async path => {
    const roots = [root, ...(await installedKits()).map(kit => kit.sourceRoot).filter(Boolean), ...(await installedBundles()).map(skill => skill.resourceRoot).filter(Boolean)]
    const owner = roots.find(base => { const rel = relative(base, resolve(path)); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) })
    if (!owner) throw new Error('Studio path outside registered content.')
    const rel = relative(owner, resolve(path))
    if (rel.split(sep).some(part => ['.git', 'node_modules'].includes(part))) throw new Error('Studio path outside registered content.')
    let current = owner
    for (const part of rel.split(sep).filter(Boolean)) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('Studio does not follow source symlinks.') }
    return current
  }
  const source = {
    listKitRoots: async () => [root],
    resolveBundleRoot: async pin => (await installedBundles()).find(skill => (skill.catalogName ?? skill.name) === pin.name && String(skill.version) === pin.version)?.resourceRoot,
    readText: async path => {
      try {
        const file = await safe(path)
        if (!(await lstat(file)).isFile()) throw new Error('Studio expects a regular file.')
        const bytes = await readFile(file)
        try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (text.includes('\0')) throw new Error('binary'); return text }
        catch { throw new StudioBinaryContentError(path) }
      } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
    },
    listDir: async path => { try { return (await readdir(await safe(path))).filter(name => !['.git', 'node_modules'].includes(name)) } catch (error) { if (error.code === 'ENOENT') return []; throw error } },
    isDirectory: async path => { try { return (await lstat(await safe(path))).isDirectory() } catch (error) { if (error.code === 'ENOENT') return false; throw error } },
    listFiles: async path => {
      const base = await safe(path), files = []
      const visit = async dir => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (['.git', 'node_modules'].includes(entry.name) || entry.isSymbolicLink()) continue
          const next = join(dir, entry.name)
          if (entry.isDirectory()) await visit(next)
          else if (entry.isFile()) files.push(relative(base, next).split(sep).join('/'))
        }
      }
      await visit(base); return files.sort()
    },
  }
  const management = new StudioManagementService(catalog)
  const bundles = new StudioBundleSourceService(catalog, source)
  // Capture bounded, confined source bytes once per request. Compilation never
  // falls back to live files, retained drafts or a production Design Project.
  const previewInstalledPanel = async input => {
    const diagnostic = (code, message) => ({ diagnostics: [{ code, message }] })
    if (!input || !Number.isSafeInteger(input.revision) || input.revision < 0
      || (input.kit !== undefined && (typeof input.kit?.name !== 'string' || typeof input.kit?.version !== 'string'))
      || typeof input.bundle?.name !== 'string' || typeof input.bundle?.version !== 'string'
      || !/^[a-z][a-z0-9_]*$/.test(input.bundle.name)
      || (input.sampleSource !== undefined && typeof input.sampleSource !== 'string')) {
      return diagnostic('preview.request', 'Select exact Kit and Bundle pins and a non-negative preview revision.')
    }
    const kitPin = { ...input.kit }, bundlePin = { ...input.bundle }, revision = input.revision
    const requestedSample = input.sampleSource
    if (requestedSample !== undefined && Buffer.byteLength(requestedSample) > 262_144) {
      return diagnostic('preview.size', 'Sample JSON is limited to 256 KiB.')
    }
    try {
      if (input.kit === undefined) {
        const selected = (await installedBundles()).find(skill => (skill.catalogName ?? skill.name) === bundlePin.name && String(skill.version) === bundlePin.version)
        if (!selected) throw new Error('Select the exact registered Bundle version.')
        const retained = contentLibrary ? await contentLibrary.store.resolveBundle(bundlePin) : undefined
        const base = retained?.resourceRoot ?? selected.resourceRoot
        if (!base) throw new Error('Independent Bundle source is unavailable.')
        const { createStudioInstanceAdapters } = await import('./studio-instance-composition.mjs')
        const { composition } = createStudioInstanceAdapters({
          listBundles: async () => [bundlePin],
          captureKit: async () => { throw new Error('Standalone preview has no Kit.') },
          captureBundle: async () => { throw new Error('Standalone preview uses only its captured source.') },
        })
        return composition.preview({ kind: 'bundle', bundle: bundlePin, runtimeName: selected.name,
          bundleFiles: await captureRegisteredTree(base), sourceId: retained?.sourceId ?? 'companion:explicit-kit', revision,
          ...(requestedSample === undefined ? {} : { sampleSource: requestedSample }) })
      }
      const selected = await selectedKit(kitPin)
      const root = selected.sourceRoot ?? kitRoot
      const locations = []
      for (const skill of selected.skills) {
        const pin = { name: skill.catalogName ?? skill.name, version: String(skill.version) }
        const retained = contentLibrary ? await contentLibrary.store.resolveBundle(pin) : undefined
        locations.push({ ...pin, rootDir: retained?.resourceRoot ?? skill.resourceRoot ?? join(root, 'skills', skill.name), sourceId: retained?.sourceId ?? 'companion:explicit-kit' })
      }
      const loadOptions = { sourceId: 'companion:explicit-kit', bundles: locations }
      const capturedRoots = [...new Set([root, ...locations.map(location => location.rootDir)])]
      const files = []
      for (const base of capturedRoots) for (const path of await source.listFiles(base)) files.push({ base, path })
      if (files.length > 4096) throw new Error('Installed preview source exceeds 4096 files.')
      const texts = new Map(), binary = new Set(), directories = new Set(capturedRoots)
      let bytes = 0
      for (const { base, path } of files) {
        const absolute = join(base, path), info = await lstat(await safe(absolute))
        bytes += info.size
        if (bytes > 16 * 1024 * 1024) throw new Error('Installed preview source exceeds 16 MiB.')
        try {
          const text = await source.readText(absolute)
          if (text !== undefined) texts.set(absolute, text)
          // Recheck decoded byte count if a source changed after lstat.
          if (text !== undefined && Buffer.byteLength(text) > info.size) {
            bytes += Buffer.byteLength(text) - info.size
            if (bytes > 16 * 1024 * 1024) throw new Error('Installed preview source exceeds 16 MiB.')
          }
        } catch (error) { if (error instanceof StudioBinaryContentError) binary.add(absolute); else throw error }
        const parts = path.split('/')
        for (let count = 1; count < parts.length; count++) directories.add(join(base, ...parts.slice(0, count)))
      }
      const paths = new Set([...texts.keys(), ...binary, ...directories])
      const captured = {
        readText: async path => { const key = resolve(path); if (binary.has(key)) throw new StudioBinaryContentError(key); return texts.get(key) },
        isDirectory: async path => directories.has(resolve(path)),
        listDir: async path => {
          const base = resolve(path)
          return [...new Set([...paths].filter(key => key !== base && relative(base, key).split(sep).length === 1
            && !relative(base, key).startsWith('..')).map(key => relative(base, key)))].sort()
        },
      }
      const installed = await loadStudioKit(captured, root, loadOptions)
      if (installed.name !== kitPin.name || String(installed.version) !== kitPin.version) return diagnostic('preview.kit_pin', 'Source does not match the selected Kit version.')
      const bundle = installed.skills.find(entry => (entry.catalogName ?? entry.name) === bundlePin.name && String(entry.version) === bundlePin.version)
      if (!bundle) return diagnostic('preview.bundle_pin', 'Source does not match the selected Bundle version.')
      if (typeof bundle.metadata?.panelYaml !== 'string') return diagnostic('preview.not_declarative', 'This Bundle has no declarative Panel preview.')
      const bundleRoot = bundle.resourceRoot ?? join(root, 'skills', bundle.name)
      const panelSource = texts.get(join(bundleRoot, 'panel.yaml'))
      if (panelSource === undefined) return diagnostic('preview.definition', 'Panel source is missing.')
      if (Buffer.byteLength(panelSource) > 1_048_576) return diagnostic('preview.size', 'Panel source is limited to 1 MiB and sample JSON to 256 KiB.')
      const initial = bundle.metadata.panelManifest?.initial_values
      // Author-owned demonstration data is distinct from runtime initialization.
      // Read only the captured Bundle path; never search a project or invent data.
      const example = texts.get(join(bundleRoot, 'reference', 'preview.json'))
      if (requestedSample === undefined && example === undefined && initial === undefined) return diagnostic('preview.sample_missing', 'No preview sample is provided. Add reference/preview.json to this Bundle or supply isolated sample JSON.')
      const sampleSource = requestedSample ?? example ?? JSON.stringify(initial)
      // This is an unedited installed Panel, already compiled above from the
      // confined capture. Reuse the shared sample finalizer; the authoring
      // overlay path would redundantly compile this unchanged Kit twice more.
      return finalizeStudioPanelPreview({ compiled: bundle, kit: kitPin, bundle: bundlePin, revision, sampleSource })
    } catch (error) { return diagnostic('preview.definition', error instanceof Error ? error.message : String(error)) }
  }
  const hasBundle = async name => (await installedBundles()).some(skill => (skill.catalogName ?? skill.name) === name)
  const unknownBundle = name => ({ diagnostics: [{ code: 'bundle.missing', message: 'Select an installed Bundle by its exact name.', subject: String(name) }] })
  let draftService
  const drafts = () => {
    if (!stateRoot) throw new Error('Studio authoring storage is not configured.')
    return draftService ??= createStudioPanelDrafts({ stateRoot, kitRoot: root, readInstalledKit: currentKit, readInstalledBundle: pin => contentLibrary?.store.resolveBundle(pin) })
  }
  let kitDraftService
  let kitDraftPorts
  const kitPorts = () => {
    if (!stateRoot) throw new Error('Studio authoring storage is not configured.')
    return kitDraftPorts ??= createStudioDraftPorts({ stateRoot, kitRoot: root, readInstalledKit: currentKit, readInstalledBundle: pin => contentLibrary?.store.resolveBundle(pin) }, 'kit')
  }
  const kitDrafts = () => {
    return kitDraftService ??= kitPorts().then(({ repository, sources }) => new StudioKitDraftService(repository, sources))
  }
  let contentArchiveService
  let instanceService
  const captureRegisteredTree = async base => {
    const paths = await source.listFiles(base)
    if (paths.length > 4096) throw new Error('Content snapshot exceeds 4096 files.')
    const entries = []
    let total = 0
    for (const path of paths) {
      const file = await safe(join(base, path)), info = await lstat(file)
      if (!info.isFile() || total + info.size > 16 * 1024 * 1024) throw new Error('Content snapshot exceeds 16 MiB or contains an invalid file.')
      const bytes = await readFile(file)
      total += bytes.length
      if (total > 16 * 1024 * 1024) throw new Error('Content snapshot exceeds 16 MiB.')
      entries.push({ path, base64: bytes.toString('base64') })
    }
    return entries
  }
  const instances = () => {
    if (!stateRoot) throw new Error('Studio authoring storage is not configured.')
    return instanceService ??= Promise.all([import('./studio-instances.mjs'), import('./studio-instance-composition.mjs')]).then(async ([{ createStudioInstances }, { createStudioInstanceAdapters }]) => {
      const ports = createStudioInstanceAdapters({
        listBundles: async () => (await installedBundles()).map(skill => ({ name: skill.catalogName ?? skill.name, version: String(skill.version) })),
        captureKit: async pin => {
          const selected = await selectedKit(pin)
          return { files: await captureRegisteredTree(selected.sourceRoot ?? root), title: selected.title }
        },
        captureBundle: async pin => {
          const selected = (await installedBundles()).find(skill => (skill.catalogName ?? skill.name) === pin.name && String(skill.version) === pin.version)
          if (!selected) throw new Error('Select the exact registered Bundle.')
          const retained = contentLibrary ? await contentLibrary.store.resolveBundle(pin) : undefined
          const base = retained?.resourceRoot ?? selected.resourceRoot ?? join(root, 'skills', selected.name)
          return { files: await captureRegisteredTree(base), sourceId: retained?.sourceId ?? 'companion:explicit-kit' }
        },
      })
      return createStudioInstances({ stateRoot, ...ports })
    }).catch(error => { instanceService = undefined; throw error })
  }
  const contentArchives = () => {
    if (!stateRoot) throw new Error('Studio import storage is not configured.')
    return contentArchiveService ??= import('./studio-content-archive.mjs').then(async ({ createStudioContentArchives }) => {
      // Do not chmod the host's existing state directory. This new, dedicated
      // parent is private; the adapter validates it and all path ancestors.
      const state = await realpath(stateRoot)
      if (state !== resolve(stateRoot) || !(await lstat(state)).isDirectory()) throw new Error('Studio archive state must be an existing canonical directory.')
      const privateRoot = join(state, 'studio-content-state')
      const inside = (base, target) => { const rel = relative(base, target); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) }
      if (inside(root, privateRoot) || inside(privateRoot, root)) throw new Error('Studio archive state and installed Kit must not be nested.')
      if (process.platform === 'win32') await ensureWindowsPrivateDirectory(privateRoot)
      else await mkdir(privateRoot, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
      const bundles = []
      for (const skill of await installedBundles()) {
        const pin = { name: skill.catalogName ?? skill.name, version: String(skill.version) }
        const retained = contentLibrary ? await contentLibrary.store.resolveBundle(pin) : undefined
        bundles.push({ ...pin, rootDir: retained?.resourceRoot ?? skill.resourceRoot ?? join(root, 'skills', skill.name), sourceId: retained?.sourceId ?? 'companion:explicit-kit' })
      }
      return createStudioContentArchives({ stateRoot: privateRoot, kitRoot: root, readInstalledKit: currentKit, sourceId: 'companion:explicit-kit', bundles })
    })
  }
  return {
    listInstances: async input => (await instances()).list(input),
    readInstance: async input => (await instances()).read(input),
    copyInstance: async input => (await instances()).copy(input),
    renameInstance: async input => (await instances()).rename(input),
    removeInstance: async input => (await instances()).remove(input),
    updateInstanceMounts: async input => (await instances()).updateMounts(input),
    readInstanceFile: async input => (await instances()).readFile(input),
    saveInstanceFile: async input => (await instances()).saveFile(input),
    previewInstance: async input => (await instances()).preview(input),
    workspace: ({ query = '' }) => { invalidateCatalog(); return management.workspace(query) },
    readKitFiles: async ({ name, version }) => {
      const current = await selectedKit({ name, version })
      return source.listFiles(current.sourceRoot ?? root)
    },
    readKitFile: async ({ name, version, path }) => {
      const current = await selectedKit({ name, version })
      if (typeof path !== 'string' || !path || /[\\\\:\u0000]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid Kit file path.')
      const target = await safe(join(current.sourceRoot ?? root, path))
      if ((await lstat(target)).size > 1024 * 1024) throw new Error('This file is too large for the text viewer.')
      const content = await source.readText(target)
      if (content === undefined) throw new Error('Kit file not found.')
      return { content }
    },
    readKitWorkspace: ({ name, version }) => management.readKitWorkspace(name, version),
    readBundleWorkspace: async ({ name, version }) => await hasBundle(name) ? bundles.readBundleWorkspace(name, version) : unknownBundle(name),
    readBundleFile: async input => await hasBundle(input.name) ? bundles.readBundleFile(input) : unknownBundle(input.name),
    previewInstalledPanel,
    createPanelDraft: async input => (await drafts()).create(input),
    listPanelDrafts: async () => (await drafts()).list(),
    readPanelDraft: async ({ id }) => (await drafts()).read(id),
    savePanelDraft: async input => (await drafts()).save(input),
    previewPanelDraft: async input => (await drafts()).preview(input),
    confirmPanelDraft: async input => (await drafts()).confirm(input),
    forkPanelDraft: async ({ id }) => (await drafts()).fork(id),
    createKitDraft: async input => (await kitDrafts()).create(input),
    listKitDrafts: async () => (await kitDrafts()).list(),
    readKitDraft: async ({ id }) => (await kitDrafts()).read(id),
    saveKitDraft: async input => (await kitDrafts()).save(input),
    validateKitDraft: async input => (await kitDrafts()).validate(input),
    previewKitDraft: async input => (await kitDrafts()).preview(input),
    confirmKitDraft: async input => (await kitDrafts()).confirm(input),
    forkKitDraft: async ({ id }) => (await kitDrafts()).fork(id),
    exportContentArchive: async input => (await contentArchives()).exportArchive(input),
    prepareContentImport: async input => (await contentArchives()).prepareImport(input),
    readContentImport: async ({ id }) => (await contentArchives()).readImport(id),
    listContentImports: async () => (await contentArchives()).listImports(),
    adoptContentImport: async ({ id }) => {
      // Only a retained import identity enters this route, never a filesystem path
      // or a browser assertion that a definition was already validated.
      const record = await (await contentArchives()).readImport(id)
      const prepared = await (await contentArchives()).revalidateImport(id)
      if (!prepared.validation.valid) throw new Error(`Imported definition is invalid: ${prepared.validation.diagnostics.map(item => item.message).join('; ')}`)
      if (!contentLibrary) throw new Error('Independent content installation is not configured.')
      const adopted = await contentLibrary.adoptPrepared(prepared)
      invalidateCatalog(); contentArchiveService = undefined
      let draft
      if (record.archive.kind === 'kit') {
        const retained = await contentLibrary.store.loadRetainedKit(prepared.archive.pin)
        const ports = await createStudioDraftPorts({ stateRoot, kitRoot: retained.sourceRoot, readInstalledKit: () => retained,
          readInstalledBundle: pin => contentLibrary.store.resolveBundle(pin) }, 'kit')
        draft = await new StudioKitDraftService(ports.repository, ports.sources).create({ kit: prepared.archive.pin })
      }
      return { importId: id, ...adopted, ...(draft ? { draft } : {}), executionGranted: false, requiresTrustReview: prepared.requiresTrustReview }
    },
  }
}
