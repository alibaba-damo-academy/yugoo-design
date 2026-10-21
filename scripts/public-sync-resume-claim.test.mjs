import assert from 'node:assert/strict'
import {fork} from 'node:child_process'
import {chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {inspectPublicSyncResumeClaimChain, publishPublicSyncResumeClaim, readPublicSyncResumeClaim} from './public-sync-resume-claim.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'resume claim fixture '))
  t.after(() => rm(root, {recursive: true, force: true}))
  const evidenceRoot = join(root, 'evidence'); await mkdir(evidenceRoot, {mode: 0o700})
  return {root, input: {evidenceRoot, generation: 1, acceptedPlanSha256: 'a'.repeat(64), purpose: 'resume'}}
}

test('two generation contenders publish exactly one immutable complete claim', async t => {
  const f = await fixture(t)
  let arrivals = 0, release
  const barrier = new Promise(resolve => {release = resolve})
  const onCheckpoint = async e => {if (e.stage === 'claim-validated') {if (++arrivals === 2) release(); await barrier}}
  const results = await Promise.allSettled([
    publishPublicSyncResumeClaim({...f.input, onCheckpoint}),
    publishPublicSyncResumeClaim({...f.input, acceptedPlanSha256: 'b'.repeat(64), onCheckpoint}),
  ])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  const rejected = results.find(r => r.status === 'rejected'); assert.equal(rejected.reason.code, 'EEXIST')
  const winner = results.find(r => r.status === 'fulfilled').value
  assert.deepEqual(await readPublicSyncResumeClaim(f.input), {path: winner.path, claimSha256: winner.claimSha256,
    record: winner.record, identity: winner.identity})
  assert.equal(winner.publicationReady, false); assert.equal(winner.executorLivenessProven, false)
})

test('existing empty directory and foreign record are not overwritten', async t => {
  const f = await fixture(t), path = `${f.input.evidenceRoot}.resume-generation-1.json`
  await mkdir(path); const before = await lstat(path)
  await assert.rejects(publishPublicSyncResumeClaim(f.input), /bounded private regular data/)
  assert.equal((await lstat(path)).ino, before.ino)
  await rm(path, {recursive: true}); await writeFile(path, 'foreign', {mode: 0o600})
  await assert.rejects(publishPublicSyncResumeClaim(f.input), /Unexpected token|JSON/)
  assert.equal(await readFile(path, 'utf8'), 'foreign')
})

test('successor binds its predecessor and stopped acknowledgement without authorizing recovery', async t => {
  const f = await fixture(t), first = await publishPublicSyncResumeClaim(f.input)
  const next = {...f.input, generation: 2, previousClaimSha256: first.claimSha256, purpose: 'archive-stopped'}
  await assert.rejects(publishPublicSyncResumeClaim(next), /explicit acknowledgement/)
  await assert.rejects(publishPublicSyncResumeClaim({...next, executorStoppedAcknowledged: true,
    previousClaimSha256: '0'.repeat(64)}), /Previous resume claim changed/)
  const result = await publishPublicSyncResumeClaim({...next, executorStoppedAcknowledged: true})
  assert.equal(result.record.previousClaimSha256, first.claimSha256)
  assert.equal(result.record.executorLivenessProven, false)
  assert.equal((await readPublicSyncResumeClaim(f.input)).claimSha256, first.claimSha256)
})

test('replacing evidence root cannot reuse a published claim', async t => {
  const f = await fixture(t), claim = await publishPublicSyncResumeClaim(f.input)
  const before = await readFile(claim.path)
  await rename(f.input.evidenceRoot, f.input.evidenceRoot + '.kept')
  await mkdir(f.input.evidenceRoot, {mode: 0o700})
  await assert.rejects(readPublicSyncResumeClaim(f.input), /root identity differs/)
  await assert.rejects(publishPublicSyncResumeClaim({...f.input, generation: 2,
    previousClaimSha256: claim.claimSha256}), /root identity differs/)
  assert.ok((await readFile(claim.path)).equals(before))
  assert.ok((await lstat(f.input.evidenceRoot + '.kept')).isDirectory())
})

for (const stage of ['claim-prepared', 'claim-validated', 'claim-published']) test(`SIGKILL at ${stage} preserves unambiguous ownership evidence`, async t => {
  const f = await fixture(t)
  const child = fork(new URL('./test-fixtures/public-resume-claim-child.mjs', import.meta.url), [], {
    env: {...process.env, OWNED_RESUME_CLAIM_INPUT: JSON.stringify(f.input), OWNED_RESUME_CLAIM_STOP: stage},
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  t.after(() => {if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')})
  const terminal = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})))
  const event = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Owned child checkpoint timeout')), 10000)
    child.once('message', e => {clearTimeout(timeout); resolve(e)})
    child.once('error', e => {clearTimeout(timeout); reject(e)})
    child.once('exit', () => {clearTimeout(timeout); reject(Error('Owned child exited before checkpoint'))})
  })
  assert.equal(event.stage, stage); child.kill('SIGKILL')
  assert.deepEqual(await terminal, {code: null, signal: 'SIGKILL'})
  assert.throws(() => process.kill(child.pid, 0), {code: 'ESRCH'})
  assert.ok((await readFile(event.preparedPath)).length > 0)
  if (stage !== 'claim-published') {
    await assert.rejects(readPublicSyncResumeClaim(f.input), {code: 'ENOENT'})
    await publishPublicSyncResumeClaim(f.input) // No published owner was abandoned.
  } else {
    const claim = await readPublicSyncResumeClaim(f.input)
    await assert.rejects(publishPublicSyncResumeClaim(f.input), /Previous resume claim changed/)
    assert.equal(claim.record.acceptedPlanSha256, f.input.acceptedPlanSha256)
  }
})

test('chain inspection binds ordered predecessors and refuses gaps or foreign namespace entries', async t => {
  const f = await fixture(t), empty = await inspectPublicSyncResumeClaimChain(f.input)
  assert.equal(empty.generation, 0); assert.equal(empty.tipSha256, null)
  const first = await publishPublicSyncResumeClaim(f.input)
  const next = await publishPublicSyncResumeClaim({...f.input, generation: 2, previousClaimSha256: first.claimSha256,
    purpose: 'archive-stopped', executorStoppedAcknowledged: true})
  const chain = await inspectPublicSyncResumeClaimChain(f.input)
  assert.equal(chain.generation, 2); assert.equal(chain.tipSha256, next.claimSha256)
  assert.deepEqual(chain.claims.map(c => c.claimSha256), [first.claimSha256, next.claimSha256])
  assert.deepEqual(await inspectPublicSyncResumeClaimChain(f.input), chain)
  await rename(first.path, join(f.root, 'kept-first'))
  await assert.rejects(inspectPublicSyncResumeClaimChain(f.input), /not contiguous/)
  await rename(join(f.root, 'kept-first'), first.path)
  const foreign = `${f.input.evidenceRoot}.resume-generation-01.json`
  await writeFile(foreign, 'keep')
  await assert.rejects(inspectPublicSyncResumeClaimChain(f.input), /Unknown resume claim namespace/)
  assert.equal(await readFile(foreign, 'utf8'), 'keep')
})

test('changed prepared bytes cannot be published as a claim', async t => {
  const f = await fixture(t)
  let preparation
  await assert.rejects(publishPublicSyncResumeClaim({...f.input, onCheckpoint: async event => {
    if (event.stage !== 'claim-prepared') return
    preparation = event.preparedPath
    await writeFile(preparation, '{}\n')
  }}), /Claim preparation bytes changed/)
  await assert.rejects(readPublicSyncResumeClaim(f.input), {code: 'ENOENT'})
  assert.equal(await readFile(preparation, 'utf8'), '{}\n')
  await publishPublicSyncResumeClaim(f.input)
})

test('continuous namespace rejects a structurally valid but changed predecessor', async t => {
  const f = await fixture(t), first = await publishPublicSyncResumeClaim(f.input)
  await publishPublicSyncResumeClaim({...f.input, generation: 2, previousClaimSha256: first.claimSha256})
  const changed = {...first.record, acceptedPlanSha256: 'b'.repeat(64)}
  await writeFile(first.path, JSON.stringify(changed) + '\n')
  assert.deepEqual((await readPublicSyncResumeClaim(f.input)).record, changed)
  await assert.rejects(inspectPublicSyncResumeClaimChain(f.input), /Resume claim predecessor differs/)
})

test('correct predecessor hash does not authorize skipping a generation', async t => {
  const f = await fixture(t), first = await publishPublicSyncResumeClaim(f.input)
  await assert.rejects(publishPublicSyncResumeClaim({...f.input, generation: 3,
    previousClaimSha256: first.claimSha256}), /Resume generation is not the current successor/)
  assert.equal((await inspectPublicSyncResumeClaimChain(f.input)).generation, 1)
})

test('unsafe evidence permissions refuse both inspection and publication', async t => {
  const f = await fixture(t)
  for (const mode of [0o750, 0o707]) {
    await chmod(f.input.evidenceRoot, mode)
    await assert.rejects(inspectPublicSyncResumeClaimChain(f.input), /Claim evidence permissions are unsafe/)
    await assert.rejects(publishPublicSyncResumeClaim(f.input), /Claim evidence permissions are unsafe/)
  }
  await chmod(f.input.evidenceRoot, 0o700)
  assert.equal((await inspectPublicSyncResumeClaimChain(f.input)).generation, 0)
})

test('claim hashes require exact lowercase SHA256 strings', async t => {
  const f = await fixture(t)
  for (const acceptedPlanSha256 of ['short', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) {
    await assert.rejects(publishPublicSyncResumeClaim({...f.input, acceptedPlanSha256}), /Exact claim hash required/)
  }
  const first = await publishPublicSyncResumeClaim(f.input)
  const second = await publishPublicSyncResumeClaim({...f.input, generation: 2, previousClaimSha256: first.claimSha256})
  await writeFile(second.path, JSON.stringify({...second.record, previousClaimSha256: 'short'}) + '\n')
  await assert.rejects(readPublicSyncResumeClaim({...f.input, generation: 2}), /Exact claim hash required/)
})

test('post-link byte changes reject publication but retain the record without granting executor authority', async t => {
  const f = await fixture(t)
  await assert.rejects(publishPublicSyncResumeClaim({...f.input, onCheckpoint: async event => {
    if (event.stage !== 'claim-published') return
    const record = JSON.parse(await readFile(event.path, 'utf8'))
    await writeFile(event.path, JSON.stringify({...record, acceptedPlanSha256: 'b'.repeat(64)}) + '\n')
  }}), /Published claim differs from prepared bytes/)
  const retained = await readPublicSyncResumeClaim(f.input)
  assert.equal(retained.record.acceptedPlanSha256, 'b'.repeat(64))
  const chain = await inspectPublicSyncResumeClaimChain(f.input)
  assert.equal(chain.generation, 1)
  assert.equal(chain.executorLivenessProven, false)
  assert.equal(chain.publicationReady, false)
  // A readable chain is not a successful publication result or permission to run.
})
