/** Prepare verified managed-file backups and replacements. Never changes the target. */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { EXPORT_MANIFEST, inspectPublicSync } from './public-snapshot-stage.mjs'
import { EXPORT_FILE_BYTE_LIMIT } from './public-snapshot-preflight.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const identity = ({ bytes, mode }) => ({ sha256: digest(bytes), mode })
function outside(a, b) {
  const delta = relative(a, b)
  return delta && (isAbsolute(delta) || delta === '..' || delta.startsWith(`..${sep}`))
}
async function regular(root, path) {
  const parts = path.split('/')
  let current = root
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    const stat = await lstat(current)
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error('Sync input must be regular without symlink ancestors')
    }
  }
  if (await realpath(dirname(current)) !== dirname(current)) throw new Error('Sync input parent changed')
  const before = await lstat(current)
  if (before.size > EXPORT_FILE_BYTE_LIMIT) throw new Error('Sync input exceeds bounded file size')
  const file = await open(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size !== before.size) throw new Error('Sync input changed while opening')
    const bytes = await file.readFile()
    if (bytes.length !== stat.size) throw new Error('Sync input changed while reading')
    return { bytes, mode: stat.mode & 0o111 ? '100755' : '100644' }
  } finally { await file.close() }
}
async function save(root, path, file) {
  const destination = join(root, path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, file.bytes, { flag: 'wx', mode: file.mode === '100755' ? 0o755 : 0o644 })
  const stored = await regular(root, path)
  if (JSON.stringify(identity(stored)) !== JSON.stringify(identity(file))) throw new Error('Prepared backup verification failed')
  return identity(stored)
}
function sameFence(actual, approved) {
  return actual.applicable && actual.stageRoot === approved.stageRoot && actual.targetRoot === approved.targetRoot
    && actual.stageManifestSha256 === approved.stageManifestSha256
    && actual.targetStateSha256 === approved.targetStateSha256 && actual.targetExists === approved.targetExists
}

/** Caller supplies the exact accepted read-only plan. Prepared data is not an apply authorization. */
export async function preparePublicSync({ approvedPlan, preparationRoot }) {
  if (!approvedPlan?.applicable || !/^[a-f0-9]{64}$/u.test(approvedPlan.stageManifestSha256)
    || !/^[a-f0-9]{64}$/u.test(approvedPlan.targetStateSha256)) throw new Error('An accepted applicable sync plan is required')
  const stageRoot = resolve(approvedPlan.stageRoot), targetRoot = resolve(approvedPlan.targetRoot)
  const root = resolve(preparationRoot)
  if (await realpath(dirname(root)) !== dirname(root)) throw new Error('Preparation parent must be canonical')
  for (const other of [stageRoot, targetRoot]) {
    if (!outside(other, root) || !outside(root, other)) throw new Error('Preparation must not overlap stage or target')
  }
  const first = await inspectPublicSync({ stageRoot, targetRoot })
  if (!sameFence(first, approvedPlan)) throw new Error('Sync plan changed; inspect and approve again')
  await mkdir(root) // New exclusive output only; partial failure is retained without a prepared marker.
  const manifestFile = await regular(stageRoot, EXPORT_MANIFEST)
  const nextManifest = JSON.parse(manifestFile.bytes.toString('utf8'))
  const backups = {}, replacements = {}
  let previousManifest
  try {
    const old = await regular(targetRoot, EXPORT_MANIFEST)
    previousManifest = await save(root, 'previous-manifest.json', old)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const path of [...new Set([...first.writes, ...first.deletes])].sort()) {
    try { Object.defineProperty(backups, path, { enumerable: true, value: await save(root, `previous/${path}`, await regular(targetRoot, path)) }) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  for (const path of first.writes) {
    const file = await regular(stageRoot, path)
    const expected = nextManifest.files[path]
    if (identity(file).sha256 !== expected.sha256 || file.mode !== expected.mode) throw new Error('Staged replacement changed')
    Object.defineProperty(replacements, path, { enumerable: true, value: await save(root, `next/${path}`, file) })
  }
  const nextManifestIdentity = await save(root, 'next-manifest.json', manifestFile)
  const second = await inspectPublicSync({ stageRoot, targetRoot })
  if (!sameFence(second, first)) throw new Error('Sync inputs changed during preparation')
  const record = { schemaVersion: 1, kind: 'prepared-managed-public-sync',
    targetRoot, stageRoot, revision: first.revision, targetExists: first.targetExists,
    stageManifestSha256: first.stageManifestSha256, targetStateSha256: first.targetStateSha256,
    writes: first.writes, deletes: first.deletes, backups, replacements,
    previousManifest: previousManifest ?? null, nextManifestIdentity,
    targetUpdated: false, applyImplemented: false, releaseApproved: false }
  const bytes = Buffer.from(JSON.stringify(record, null, 2) + '\n')
  await writeFile(join(root, 'prepared.json'), bytes, { flag: 'wx' })
  return { preparationRoot: root, record, preparedSha256: digest(bytes), targetUpdated: false }
}
