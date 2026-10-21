/** Immutable no-overwrite claims for settlement-resume generations.
 * The explicitly stopped settlement-resume executor uses this gate after
 * accepting a pinned plan. This primitive alone does not authorize takeover.
 */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {constants} from 'node:fs'
import {link, lstat, mkdtemp, open, readdir, realpath} from 'node:fs/promises'
import {basename, dirname, isAbsolute, join} from 'node:path'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const hash = value => assert.match(value, /^[a-f0-9]{64}$/u, 'Exact claim hash required')
const claimPath = (root, generation) => `${root}.resume-generation-${generation}.json`

async function directoryIdentity(path) {
  assert.ok(isAbsolute(path) && await realpath(path) === path, 'Claim root must remain canonical')
  const stat = await lstat(path)
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Claim root must be a physical directory')
  assert.ok(Number.isSafeInteger(stat.dev) && Number.isSafeInteger(stat.ino), 'Unsafe claim directory identity')
  return {dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o7777}
}

async function privateBytes(path) {
  const before = await lstat(path)
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 4096 && (before.mode & 0o077) === 0,
    'Claim must be bounded private regular data')
  assert.ok(Number.isSafeInteger(before.dev) && Number.isSafeInteger(before.ino), 'Unsafe claim identity')
  const descriptor = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let bytes
  try {
    const actual = await descriptor.stat()
    assert.ok(actual.dev === before.dev && actual.ino === before.ino && actual.size === before.size, 'Claim changed while opening')
    bytes = await descriptor.readFile(); assert.equal(bytes.length, before.size)
  } finally { await descriptor.close() }
  const after = await lstat(path)
  assert.ok(after.dev === before.dev && after.ino === before.ino && after.size === before.size && after.mode === before.mode,
    'Claim changed while reading')
  return {bytes, identity: {dev: before.dev, ino: before.ino, mode: before.mode & 0o7777}}
}

/** Reads one exact immutable record, without accepting it as liveness evidence. */
export async function readPublicSyncResumeClaim({evidenceRoot, generation}) {
  assert.ok(Number.isSafeInteger(generation) && generation > 0 && generation <= 10000, 'Invalid resume generation')
  const rootIdentity = await directoryIdentity(evidenceRoot)
  const path = claimPath(evidenceRoot, generation), {bytes, identity} = await privateBytes(path)
  assert.deepEqual(await directoryIdentity(evidenceRoot), rootIdentity, 'Claim root changed while reading')
  const record = JSON.parse(bytes)
  assert.equal(record.schemaVersion, 1); assert.equal(record.kind, 'settlement-resume-generation-claim')
  assert.equal(record.evidenceRoot, evidenceRoot); assert.equal(record.generation, generation)
  assert.deepEqual(record.evidenceRootIdentity, rootIdentity, 'Claim evidence root identity differs')
  hash(record.acceptedPlanSha256)
  if (generation === 1) assert.equal(record.previousClaimSha256, null)
  else hash(record.previousClaimSha256)
  assert.ok(['resume', 'archive-stopped'].includes(record.purpose), 'Unknown claim purpose')
  assert.equal(record.executorStoppedAcknowledged, record.purpose === 'archive-stopped')
  assert.equal(record.executorLivenessProven, false); assert.equal(record.publicationReady, false)
  return {path, claimSha256: sha(bytes), record, identity}
}

/** Inspect only typed claim siblings; unrelated files and preparations are not claims. */
export async function inspectPublicSyncResumeClaimChain({evidenceRoot}) {
  const rootIdentity = await directoryIdentity(evidenceRoot), parent = dirname(evidenceRoot)
  assert.equal(rootIdentity.mode & 0o077, 0, 'Claim evidence permissions are unsafe')
  const parentIdentity = await directoryIdentity(parent), prefix = basename(evidenceRoot) + '.resume-generation-'
  const names = async () => (await readdir(parent)).filter(name => name.startsWith(prefix)).sort()
  const initialNames = await names()
  assert.ok(initialNames.length <= 10000, 'Resume claim chain exceeds bound')
  const generations = initialNames.map(name => {
    const tail = name.slice(prefix.length)
    assert.match(tail, /^[1-9][0-9]*\.json$/u, 'Unknown resume claim namespace entry')
    return Number(tail.slice(0, -5))
  }).sort((a, b) => a - b)
  const claims = []
  for (const generation of generations) {
    assert.equal(generation, claims.length + 1, 'Resume claim chain is not contiguous')
    const current = await readPublicSyncResumeClaim({evidenceRoot, generation})
    assert.equal(current.record.previousClaimSha256, claims.at(-1)?.claimSha256 ?? null, 'Resume claim predecessor differs')
    claims.push(current)
  }
  assert.deepEqual(await names(), initialNames, 'Resume claim membership changed while inspecting')
  for (const current of claims) assert.deepEqual(await readPublicSyncResumeClaim({evidenceRoot, generation: current.record.generation}),
    current, 'Resume claim changed during chain inspection')
  assert.deepEqual(await directoryIdentity(evidenceRoot), rootIdentity, 'Claim chain evidence root changed')
  assert.deepEqual(await directoryIdentity(parent), parentIdentity, 'Claim chain parent changed')
  assert.deepEqual(await names(), initialNames, 'Resume claim membership changed before inspection completed')
  const plan = {kind: 'settlement-resume-claim-chain', evidenceRoot, rootIdentity, parentIdentity, claims,
    generation: claims.length, tipSha256: claims.at(-1)?.claimSha256 ?? null}
  return {...plan, planSha256: sha(JSON.stringify(plan)), executorLivenessProven: false, publicationReady: false}
}

/** Publish a complete record atomically with hard-link no-overwrite semantics.
 * Prepared bytes are deliberately retained on failure/crash and confer no ownership.
 * Caller must separately inspect the chain and validate quiescence/allowed transitions.
 */
export async function publishPublicSyncResumeClaim({evidenceRoot, generation, previousClaimSha256 = null,
  acceptedPlanSha256, purpose, executorStoppedAcknowledged = false, onCheckpoint}) {
  assert.ok(Number.isSafeInteger(generation) && generation > 0 && generation <= 10000, 'Invalid resume generation')
  hash(acceptedPlanSha256)
  assert.ok(['resume', 'archive-stopped'].includes(purpose), 'Unknown claim purpose')
  assert.equal(executorStoppedAcknowledged, purpose === 'archive-stopped', 'Stopped recovery requires explicit acknowledgement')
  const rootIdentity = await directoryIdentity(evidenceRoot), parent = dirname(evidenceRoot)
  assert.equal(rootIdentity.mode & 0o077, 0, 'Claim evidence permissions are unsafe')
  const parentIdentity = await directoryIdentity(parent)
  const verify = async () => {
    assert.deepEqual(await directoryIdentity(evidenceRoot), rootIdentity, 'Claim evidence root changed')
    assert.deepEqual(await directoryIdentity(parent), parentIdentity, 'Claim parent changed')
    const chain = await inspectPublicSyncResumeClaimChain({evidenceRoot})
    assert.equal(chain.tipSha256, previousClaimSha256, 'Previous resume claim changed')
    assert.equal(chain.generation + 1, generation, 'Resume generation is not the current successor')
  }
  await verify()
  const record = {schemaVersion: 1, kind: 'settlement-resume-generation-claim', evidenceRoot,
    evidenceRootIdentity: rootIdentity, generation,
    previousClaimSha256, acceptedPlanSha256, purpose, executorStoppedAcknowledged,
    executorLivenessProven: false, publicationReady: false}
  const bytes = Buffer.from(JSON.stringify(record) + '\n')
  assert.ok(bytes.length <= 4096, 'Claim exceeds bound')
  // Same filesystem as the final claim. A private preparation directory is not a gate.
  const preparedRoot = await mkdtemp(join(parent, '.resume-claim-prepared-'))
  const preparedPath = join(preparedRoot, 'record.json'), descriptor = await open(preparedPath, 'wx', 0o600)
  try { await descriptor.writeFile(bytes); await descriptor.sync() } finally { await descriptor.close() }
  const preparedDirectory = await open(preparedRoot, 'r')
  try { await preparedDirectory.sync() } finally { await preparedDirectory.close() }
  const preparedIdentity = (await privateBytes(preparedPath)).identity
  const preparationIdentity = await directoryIdentity(preparedRoot)
  await onCheckpoint?.({stage: 'claim-prepared', preparedRoot, preparedPath})
  await verify()
  const verifyPrepared = async () => {
    assert.deepEqual(await directoryIdentity(preparedRoot), preparationIdentity, 'Claim preparation directory changed')
    const actual = await privateBytes(preparedPath)
    assert.deepEqual(actual.identity, preparedIdentity, 'Claim preparation file identity changed')
    assert.ok(actual.bytes.equals(bytes), 'Claim preparation bytes changed')
  }
  await verifyPrepared()
  const path = claimPath(evidenceRoot, generation)
  await onCheckpoint?.({stage: 'claim-validated', preparedRoot, preparedPath, path})
  await verifyPrepared()
  await link(preparedPath, path) // EEXIST is terminal; never replace an empty directory or prior record.
  const parentDirectory = await open(parent, 'r')
  try { await parentDirectory.sync() } finally { await parentDirectory.close() }
  await onCheckpoint?.({stage: 'claim-published', preparedRoot, preparedPath, path})
  const actual = await readPublicSyncResumeClaim({evidenceRoot, generation})
  assert.equal(actual.claimSha256, sha(bytes), 'Published claim differs from prepared bytes')
  return {...actual, preparedRoot, ownershipClaimed: true, executorLivenessProven: false, publicationReady: false}
}
