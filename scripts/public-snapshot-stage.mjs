/** Fixed-source staging and pure sync planning. Never updates a public checkout. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { inspectPublicSnapshot, EXPORT_FILE_BYTE_LIMIT, EXPORT_TOTAL_BYTE_LIMIT } from './public-snapshot-preflight.mjs'
import { proposePublicDocuments, validateCanonicalDocumentLinks } from './public-document-projection.mjs'
import { proposePublicSourceConfig } from './public-source-config.mjs'
import YAML from 'yaml'

export const EXPORT_MANIFEST = '.yugoo-export.json'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
function safePath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /[\\\0\r\n]/u.test(path)
    || path.split('/').some(part => !part || ['.', '..', '.git', EXPORT_MANIFEST].includes(part))) {
    throw new Error('Invalid managed export path')
  }
}
function validateFiles(files) {
  const folded = new Set()
  for (const [path, value] of Object.entries(files)) {
    safePath(path)
    if (!/^[a-f0-9]{64}$/u.test(value?.sha256) || !['100644', '100755'].includes(value.mode)) throw new Error('Invalid managed file identity')
    const lower = path.toLowerCase()
    if (folded.has(lower)) throw new Error('Case-colliding export paths')
    folded.add(lower)
  }
  for (const path of folded) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) if (folded.has(parts.slice(0, i).join('/'))) throw new Error('File/directory export collision')
  }
}
const equal = (a, b) => a?.sha256 === b?.sha256 && a?.mode === b?.mode
const SOURCE_CONFIG_INPUTS = ['release/public-source-baseline.json', 'release/public-source-test-selection.json']
const sourceConfigPath = path => ['package.json', 'pnpm-workspace.yaml'].includes(path)
  || /^packages\/[a-z0-9-]+\/package\.json$/u.test(path)

// Like document provenance, this checks stage consistency, not Git authenticity.
function validateSourceConfigProvenance(manifest) {
  const projection = manifest.sourceConfig
  if (projection === undefined) return
  const invalid = () => { throw new Error('Invalid export provenance manifest') }
  const oid = value => typeof value === 'string' && new RegExp(`^[a-f0-9]{${manifest.revision.length}}$`, 'u').test(value)
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
  if (!projection || projection.kind !== 'public-source-config-projection' || projection.schemaVersion !== 1
    || projection.releaseApproved !== false || projection.lockAction !== 'regenerate-in-isolated-source-candidate'
    || Object.hasOwn(manifest.files, 'pnpm-lock.yaml') || !Array.isArray(projection.inputs)
    || projection.inputs.length !== SOURCE_CONFIG_INPUTS.length || !Array.isArray(projection.files)) invalid()
  const inputs = new Set()
  for (const input of projection.inputs) {
    if (!SOURCE_CONFIG_INPUTS.includes(input?.path) || inputs.has(input.path) || !oid(input.sourceOid)
      || !hash(input.sourceSHA256) || manifest.files[input.path]?.sha256 !== input.sourceSHA256
      || manifest.files[input.path]?.mode !== '100644') invalid()
    inputs.add(input.path)
  }
  const paths = new Set()
  for (const file of projection.files) {
    if (!sourceConfigPath(file?.path) || paths.has(file.path) || !oid(file.sourceOid)
      || !hash(file.sourceSHA256) || !hash(file.outputSHA256)
      || manifest.files[file.path]?.sha256 !== file.outputSHA256
      || manifest.files[file.path]?.mode !== '100644') invalid()
    paths.add(file.path)
  }
  if (!paths.has('package.json') || !paths.has('pnpm-workspace.yaml')
    || !paths.has('packages/knowledge-ladybug/package.json')
    || Object.keys(manifest.files).some(path => sourceConfigPath(path) && !paths.has(path))) invalid()
}

// Structural provenance verification only: reading a stage cannot authenticate
// the source Git repository or grant release approval.
function validateDocumentProvenance(manifest) {
  const invalid = () => { throw new Error('Invalid export provenance manifest') }
  if (manifest.releaseApproved !== false) invalid()
  if (manifest.transforms === undefined) return // Pre-relocation stages.
  if (!Array.isArray(manifest.transforms)) invalid()
  if (manifest.transforms.length === 0) return
  if (manifest.transforms.length !== 3) invalid()
  const destinations = new Set()
  const oid = value => typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value)
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
  for (const transform of manifest.transforms) {
    if (!transform || typeof transform !== 'object' || Array.isArray(transform)
      || transform.kind !== 'public-document-relocation'
      || !['README.md', 'CONTRIBUTING.md', 'SECURITY.md'].includes(transform.destination)
      || destinations.has(transform.destination)
      || transform.origin !== `release/${transform.destination.slice(0, -3)}.public.md`
      || !oid(transform.sourceOid) || transform.sourceOid.length !== manifest.revision.length
      || !hash(transform.sourceSHA256) || !hash(transform.outputSHA256)
      || !Object.hasOwn(manifest.files, transform.destination)
      || manifest.files[transform.destination].sha256 !== transform.outputSHA256
      || manifest.files[transform.destination].mode !== '100644'
      || Object.hasOwn(manifest.files, transform.origin)
      || transform.anchorsValidated !== false
      || !Array.isArray(transform.links) || !Array.isArray(transform.replacedSource)
      || transform.replacedSource.length > 1) invalid()
    destinations.add(transform.destination)
    for (const replaced of transform.replacedSource) {
      if (!replaced || replaced.path !== transform.destination || !oid(replaced.oid)
        || replaced.oid.length !== manifest.revision.length) invalid()
    }
    for (const link of transform.links) {
      if (!link || typeof link.original !== 'string' || !link.original
        || typeof link.output !== 'string' || !link.output || typeof link.target !== 'string') invalid()
      try { safePath(link.target) } catch { invalid() }
      if (!Object.hasOwn(manifest.files, link.target)
        || link.output.split('#')[0] !== link.target) invalid()
    }
  }
}

/** Current includes unmanaged regular files; callers must separately reject symlinks/nonregulars. */
export function planPublicSync({ previous = {}, current, next }) {
  for (const files of [previous, current, next]) validateFiles(files)
  const writes = [], deletes = [], unchanged = [], conflicts = []
  for (const path of Object.keys(previous).sort()) {
    if (!equal(current[path], previous[path])) conflicts.push({ path, reason: 'Managed file was modified or removed' })
    else if (!Object.hasOwn(next, path)) deletes.push(path)
  }
  for (const path of Object.keys(next).sort()) {
    if (Object.hasOwn(previous, path)) {
      if (equal(previous[path], next[path])) unchanged.push(path)
      else writes.push(path)
    } else if (Object.hasOwn(current, path)) conflicts.push({ path, reason: 'Unmanaged file would be overwritten' })
    else writes.push(path)
  }
  // validateFiles above must precede indexing: it rejects folded-key collisions.
  // Index once instead of comparing every new path against every current file.
  const currentPaths = new Map(), currentDirectories = new Set()
  for (const existing of Object.keys(current)) {
    const lower = existing.toLowerCase(), parts = lower.split('/')
    currentPaths.set(lower, existing)
    for (let i = 1; i < parts.length; i++) currentDirectories.add(parts.slice(0, i).join('/'))
  }
  for (const path of Object.keys(next)) {
    const lower = path.toLowerCase(), parts = lower.split('/')
    const ancestorFile = parts.slice(0, -1).some((_, index) => currentPaths.has(parts.slice(0, index + 1).join('/')))
    if (ancestorFile || currentDirectories.has(lower)) conflicts.push({ path, reason: 'Existing file/directory boundary conflicts with new output' })
    if (currentPaths.has(lower) && currentPaths.get(lower) !== path) conflicts.push({ path, reason: 'Existing case-colliding path' })
  }
  return { schemaVersion: 1, applicable: conflicts.length === 0, writes, deletes, unchanged, conflicts,
    preservesUnmanagedFiles: true, targetUpdated: false }
}

/** A new exclusive staging directory only; success marker is written last. */
export async function stagePublicSnapshot({ source, revision, policy, destination, publicDocuments = false, publicSourceConfig = false }) {
  if (typeof publicDocuments !== 'boolean') throw new Error('Explicit public document selection must be boolean')
  if (typeof publicSourceConfig !== 'boolean') throw new Error('Explicit public source config selection must be boolean')
  const inspection = inspectPublicSnapshot({ source, revision, policy, publicSourceConfig })
  if (!inspection.automatedChecksPassed) throw new Error('Public source review is incomplete; staging refused')
  let selected = inspection.entries.filter(entry => entry.action === 'include')
  const readBlob = entry => {
    const bytes = execFileSync('git', ['--no-replace-objects', '-C', source, 'cat-file', 'blob', entry.oid], { maxBuffer: EXPORT_FILE_BYTE_LIMIT })
    if (bytes.length !== entry.bytes) throw new Error('Git object size changed')
    return bytes
  }
  let documents, transforms = []
  if (publicDocuments) {
    const names = ['README', 'CONTRIBUTING', 'SECURITY']
    const origins = names.map(name => `release/${name}.public.md`)
    const roots = names.map(name => `${name}.md`)
    const legacyInputs = selected.filter(entry => origins.includes(entry.path))
    if (legacyInputs.length === 0) {
      // Current public documents have one source and need no relocation. Their
      // byte/mode identities remain ordinary fixed-Git entries in the manifest.
      for (const path of roots) {
        if (!selected.some(entry => entry.path === path && entry.mode === '100644')) {
          throw new Error('All canonical root documents must be reviewed regular documents')
        }
      }
      const byPath = new Map(selected.map(entry => [entry.path, entry])), texts = new Map()
      const readMarkdown = path => {
        if (!texts.has(path)) {
          const bytes = readBlob(byPath.get(path)), value = bytes.toString('utf8')
          if (!Buffer.from(value).equals(bytes)) throw new Error('Public document must be valid UTF-8')
          texts.set(path, value)
        }
        return texts.get(path)
      }
      const paths = selected.filter(entry => roots.includes(entry.path)
        || /^README\.[A-Za-z0-9-]+\.md$/u.test(entry.path) || entry.path === 'AGENTS.md'
        || entry.path === 'docs/public-document-sync.md'
        || ((entry.path.startsWith('docs/wiki/') || entry.path.startsWith('examples/')) && entry.path.endsWith('.md'))).map(entry => entry.path)
      const checked = validateCanonicalDocumentLinks({
        documents: Object.fromEntries(paths.map(path => [path, readMarkdown(path)])),
        includedPaths: selected.map(entry => entry.path), readTarget: readMarkdown,
      })
      if (!checked.localFileLinksClosed) {
        const first = checked.missing[0]
        throw new Error(`Canonical public document links are not closed: ${first.origin} -> ${first.href} (${first.reason})`)
      }
    } else {
      // Historical fixed commits retain their explicit three-draft relocation.
      // Partial draft selection cannot silently fall back to another authority.
      const entries = origins.map(path => {
        const entry = selected.find(item => item.path === path)
        if (!entry || entry.mode !== '100644') throw new Error('All public drafts must be reviewed regular documents')
        return entry
      })
      const replaced = selected.filter(entry => roots.includes(entry.path))
      selected = selected.filter(entry => !origins.includes(entry.path) && !roots.includes(entry.path))
      documents = proposePublicDocuments({ drafts: Object.fromEntries(entries.map(entry => {
        const bytes = readBlob(entry), text = bytes.toString('utf8')
        if (!Buffer.from(text).equals(bytes)) throw new Error('Public draft must be valid UTF-8')
        return [entry.path, text]
      })),
        includedPaths: selected.map(entry => entry.path) })
      if (!documents.localFileLinksClosed) throw new Error('Public document links are not closed')
      for (const file of documents.files) if (Buffer.byteLength(file.text) > EXPORT_FILE_BYTE_LIMIT) throw new Error('Projected document exceeds export bound')
      if (selected.reduce((sum, entry) => sum + entry.bytes, 0)
        + documents.files.reduce((sum, file) => sum + Buffer.byteLength(file.text), 0) > EXPORT_TOTAL_BYTE_LIMIT) {
        throw new Error('Projected documents exceed total export bound')
      }
      transforms = documents.files.map(file => ({ kind: 'public-document-relocation', origin: file.origin,
        destination: file.destination, sourceOid: entries.find(entry => entry.path === file.origin).oid,
        sourceSHA256: file.sourceSHA256, outputSHA256: file.outputSHA256, links: file.links,
        replacedSource: replaced.filter(entry => entry.path === file.destination).map(entry => ({ path: entry.path, oid: entry.oid })),
        anchorsValidated: false }))
    }
  }
  let sourceConfig, sourceFiles = []
  if (publicSourceConfig) {
    if (selected.some(entry => entry.path === 'pnpm-lock.yaml')) throw new Error('Public source config requires an excluded development lock; generate a new lock in the isolated candidate')
    // Project committed manifests for retained packages, not excluded packages.
    // Preserve source folders whose manifests are generated by existing builds.
    const selectedPackageRoots = new Set(selected.flatMap(entry => {
      const match = /^packages\/([^/]+)\//u.exec(entry.path)
      return match ? [`packages/${match[1]}/`] : []
    }))
    const packagePaths = inspection.entries.filter(entry => /^packages\/[^/]+\/package\.json$/u.test(entry.path)
      && selectedPackageRoots.has(entry.path.slice(0, -'package.json'.length))).map(entry => entry.path)
    const paths = [...SOURCE_CONFIG_INPUTS, 'package.json', 'pnpm-workspace.yaml', ...packagePaths]
    const inputs = paths.map(path => {
      const entry = selected.find(item => item.path === path)
      if (!entry || entry.mode !== '100644') throw new Error('Public source config inputs must all be reviewed regular included files')
      const bytes = readBlob(entry), text = bytes.toString('utf8')
      if (!Buffer.from(text).equals(bytes)) throw new Error('Public source config input must be valid UTF-8')
      return { entry, text, sha256: digest(bytes) }
    })
    const input = path => inputs.find(value => value.entry.path === path)
    const baseline = JSON.parse(input(SOURCE_CONFIG_INPUTS[0]).text)
    const selection = JSON.parse(input(SOURCE_CONFIG_INPUTS[1]).text)
    if (baseline?.kind !== 'proposed-public-source-dependency-baseline' || baseline.schemaVersion !== 1
      || baseline.releaseApproved !== false || baseline.registry !== 'https://registry.npmjs.org'
      || baseline.ladybugSource !== 'registry'
      || selection?.kind !== 'proposed-public-source-root-test-selection' || selection.schemaVersion !== 1
      || selection.releaseApproved !== false || !selection.rootScriptFileExclusions) throw new Error('Invalid public source baseline or test selection proposal')
    const packages = Object.fromEntries(packagePaths.map(path => [path, JSON.parse(input(path).text)]))
    const proposal = proposePublicSourceConfig({ root: JSON.parse(input('package.json').text),
      workspace: YAML.parse(input('pnpm-workspace.yaml').text), packages,
      officialVersions: baseline.officialVersions, ladybugVersion: baseline.ladybugVersion,
      rootScripts: baseline.rootScripts, reviewedWorkspaceOverrides: baseline.reviewedWorkspaceOverrides,
      rootScriptFileExclusions: selection.rootScriptFileExclusions })
    const outputs = { 'package.json': JSON.stringify(proposal.root, null, 2) + '\n',
      'pnpm-workspace.yaml': YAML.stringify(proposal.workspace),
      ...Object.fromEntries(Object.entries(proposal.packages).map(([path, manifest]) => [path, JSON.stringify(manifest, null, 2) + '\n'])) }
    for (const [path, text] of Object.entries(outputs)) {
      if (!sourceConfigPath(path)) throw new Error('Invalid projected source configuration path')
      sourceFiles.push({ destination: path, text, outputSHA256: digest(Buffer.from(text)) })
    }
    sourceConfig = { kind: 'public-source-config-projection', schemaVersion: 1, releaseApproved: false,
      lockAction: proposal.lockAction,
      inputs: SOURCE_CONFIG_INPUTS.map(path => ({ path, sourceOid: input(path).entry.oid, sourceSHA256: input(path).sha256 })),
      files: sourceFiles.map(file => ({ path: file.destination, sourceOid: input(file.destination).entry.oid,
        sourceSHA256: input(file.destination).sha256, outputSHA256: file.outputSHA256 })) }
    selected = selected.filter(entry => !Object.hasOwn(outputs, entry.path))
  }
  const projectedFiles = [...(documents?.files ?? []), ...sourceFiles]
  if (projectedFiles.some(file => Buffer.byteLength(file.text) > EXPORT_FILE_BYTE_LIMIT)
    || selected.reduce((sum, entry) => sum + entry.bytes, 0)
      + projectedFiles.reduce((sum, file) => sum + Buffer.byteLength(file.text), 0) > EXPORT_TOTAL_BYTE_LIMIT) throw new Error('Projected source files exceed export bound')
  for (const entry of selected) safePath(entry.path)
  // Check the portable path layout before creating any staging files; these
  // placeholder hashes carry no content claim and are never persisted.
  validateFiles(Object.fromEntries([...selected.map(entry => [entry.path, { sha256: '0'.repeat(64), mode: entry.mode }]),
    ...projectedFiles.map(file => [file.destination, { sha256: '0'.repeat(64), mode: '100644' }])]))
  const target = resolve(destination)
  if (await realpath(dirname(target)) !== dirname(target)) throw new Error('Staging parent must be canonical')
  const delta = relative(await realpath(source), target)
  if (!delta || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith(`..${sep}`))) throw new Error('Staging must be outside source')
  await mkdir(target) // Never replaces an existing staging output.
  const files = {}
  for (const entry of selected) {
    const bytes = readBlob(entry)
    await mkdir(dirname(join(target, entry.path)), { recursive: true })
    await writeFile(join(target, entry.path), bytes, { flag: 'wx', mode: entry.mode === '100755' ? 0o755 : 0o644 })
    const stored = await readFile(join(target, entry.path))
    if (!stored.equals(bytes) || !(await lstat(join(target, entry.path))).isFile()) throw new Error('Staging verification failed')
    Object.defineProperty(files, entry.path, { enumerable: true, value: { sha256: digest(bytes), mode: entry.mode } })
  }
  for (const file of projectedFiles) {
    const bytes = Buffer.from(file.text)
    if (bytes.length > EXPORT_FILE_BYTE_LIMIT || digest(bytes) !== file.outputSHA256) throw new Error('Projected document identity mismatch')
    await mkdir(dirname(join(target, file.destination)), { recursive: true })
    await writeFile(join(target, file.destination), bytes, { flag: 'wx', mode: 0o644 })
    if (!(await readFile(join(target, file.destination))).equals(bytes)) throw new Error('Projected document verification failed')
    Object.defineProperty(files, file.destination, { enumerable: true, value: { sha256: digest(bytes), mode: '100644' } })
  }
  validateFiles(files)
  const manifest = { schemaVersion: 1, revision, policySha256: inspection.policySha256, files,
    kind: 'fixed-source-export-stage', releaseApproved: false, transforms,
    ...(sourceConfig === undefined ? {} : { sourceConfig }) }
  validateSourceConfigProvenance(manifest)
  await writeFile(join(target, EXPORT_MANIFEST), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return { target, manifest, targetCheckoutUpdated: false }
}

async function readRegular(path, maximum) {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum) throw new Error('Nonregular or oversized export file')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maximum || stat.ino !== before.ino || stat.dev !== before.dev) throw new Error('Export file changed while opening')
    const bytes = await handle.readFile()
    if (bytes.length !== stat.size) throw new Error('Export file changed while reading')
    return { bytes, mode: (stat.mode & 0o111) ? '100755' : '100644' }
  } finally { await handle.close() }
}

/** Bounded target scan; root Git metadata is preserved and never traversed. */
async function scanDirectory(root, { allowMissing = false, preserveGit = false } = {}) {
  root = resolve(root)
  let info
  try { info = await lstat(root) } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return { files: {}, manifest: undefined, exists: false }
    throw error
  }
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) throw new Error('Export root must be a canonical regular directory')
  const files = {}
  let manifest, total = 0, count = 0
  async function visit(prefix = '') {
    const directory = join(root, prefix)
    if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory) throw new Error('Export directory changed or aliases another path')
    for (const name of (await readdir(directory)).sort()) {
      if (!prefix && name === '.git' && preserveGit) continue
      const path = prefix ? `${prefix}/${name}` : name
      if (!prefix && name === EXPORT_MANIFEST) {
        const { bytes } = await readRegular(join(root, path), 2 * 1024 * 1024)
        try { manifest = JSON.parse(bytes.toString('utf8')) }
        catch { throw new Error('Invalid export provenance manifest') }
        if (manifest?.schemaVersion !== 1 || manifest.kind !== 'fixed-source-export-stage'
          || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(manifest.revision)
          || !/^[a-f0-9]{64}$/u.test(manifest.policySha256)
          || typeof manifest.files !== 'object' || manifest.files === null || Array.isArray(manifest.files)) throw new Error('Invalid export provenance manifest')
        validateFiles(manifest.files)
        validateDocumentProvenance(manifest)
        validateSourceConfigProvenance(manifest)
        continue
      }
      safePath(path)
      const entry = await lstat(join(root, path))
      if (entry.isSymbolicLink()) throw new Error('Export scan refuses symlinks')
      if (++count > 20000) throw new Error('Export scan entry bound exceeded')
      if (entry.isDirectory()) await visit(path)
      else {
        const { bytes, mode } = await readRegular(join(root, path), EXPORT_FILE_BYTE_LIMIT)
        total += bytes.length
        if (total > EXPORT_TOTAL_BYTE_LIMIT) throw new Error('Export scan byte bound exceeded')
        Object.defineProperty(files, path, { enumerable: true, value: { sha256: digest(bytes), mode } })
      }
    }
  }
  await visit()
  validateFiles(files)
  return { files, manifest, exists: true }
}

/** Reads actual staged/target bytes, but applies no changes and grants no release approval. */
export async function inspectPublicSync({ stageRoot, targetRoot }) {
  stageRoot = resolve(stageRoot); targetRoot = resolve(targetRoot)
  for (const [a, b] of [[stageRoot, targetRoot], [targetRoot, stageRoot]]) {
    const delta = relative(a, b)
    if (!delta || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith(`..${sep}`))) throw new Error('Stage and target must not overlap')
  }
  const stage = await scanDirectory(stageRoot)
  if (!stage.manifest) throw new Error('Stage has no completed provenance marker')
  if (JSON.stringify(stage.files) !== JSON.stringify(stage.manifest.files)) {
    // Ordering differs between Git trees and directory traversal; compare identities.
    if (Object.keys(stage.files).length !== Object.keys(stage.manifest.files).length
      || Object.keys(stage.files).some(path => !Object.hasOwn(stage.manifest.files, path)
        || !equal(stage.files[path], stage.manifest.files[path]))) throw new Error('Staged files differ from their provenance manifest')
  }
  const target = await scanDirectory(targetRoot, { allowMissing: true, preserveGit: true })
  return { ...planPublicSync({ previous: target.manifest?.files ?? {}, current: target.files, next: stage.files }),
    stageRoot, targetRoot, targetExists: target.exists, revision: stage.manifest.revision,
    stageManifestSha256: digest(JSON.stringify(stage.manifest)),
    targetStateSha256: digest(JSON.stringify({ files: target.files, manifest: target.manifest ?? null })),
    releaseApproved: false }
}
