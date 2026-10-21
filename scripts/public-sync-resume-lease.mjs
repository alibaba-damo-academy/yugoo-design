/** Read-only approval for an explicitly stopped settlement resume's retained lease. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {lstat, readdir, realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {inspectPublicSyncSettlementResume} from './public-sync-interruption.mjs'
import {inspectPublicSyncResumeClaimChain} from './public-sync-resume-claim.mjs'

async function retainedLease(evidenceRoot) {
  const root = join(evidenceRoot, '.resume-lock')
  const stat = await lstat(root)
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(root) === root,
    'Retained resume lease must be a canonical directory')
  assert.equal(stat.mode & 0o077, 0, 'Retained resume lease permissions are unsafe')
  assert.deepEqual(await readdir(root), [], 'Retained resume lease contains unknown evidence')
  return {root, dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o7777}
}

/** Pins evidence only. This never removes a lease or establishes executor quiescence. */
export async function inspectStoppedPublicSyncResumeLease(input) {
  const resume = await inspectPublicSyncSettlementResume(input)
  const lease = await retainedLease(resume.evidenceRoot)
  const chain = await inspectPublicSyncResumeClaimChain({evidenceRoot: resume.evidenceRoot})
  const second = await inspectPublicSyncSettlementResume(input)
  assert.deepEqual(second, resume, 'Settlement evidence changed while inspecting retained lease')
  assert.deepEqual(await retainedLease(resume.evidenceRoot), lease,
    'Retained resume lease changed during inspection')
  assert.deepEqual(await inspectPublicSyncResumeClaimChain({evidenceRoot: resume.evidenceRoot}), chain,
    'Resume claim chain changed during lease inspection')
  const claims = {generation: chain.generation, tipSha256: chain.tipSha256, planSha256: chain.planSha256,
    rootIdentity: chain.rootIdentity, parentIdentity: chain.parentIdentity}
  const plan = {kind: 'stopped-settlement-resume-lease-plan', resume, lease, claims}
  return {...plan, planSha256: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    executorStoppedAcknowledged: false, executorLivenessProven: false,
    leaseArchived: false, targetUpdated: false, lockReleased: false, publicationReady: false}
}
