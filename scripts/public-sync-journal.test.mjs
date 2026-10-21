import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stagePublicSnapshot, inspectPublicSync } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { acquirePublicSyncLock, releaseUnusedPublicSyncLock } from './public-sync-lock.mjs'
import { appendPublicSyncJournal, createPublicSyncJournal, inspectPublicSyncJournal } from './public-sync-journal.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'public journal '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  await writeFile(join(source, 'a.txt'), 'candidate')
  git(['add', '.']); git(['commit', '-qm', 'fixture'])
  const policy = { version: 1, rules: [{ kind: 'file', path: 'a.txt', action: 'include', reason: 'fixture' }] }
  const stage = await stagePublicSnapshot({ source, revision: git(['rev-parse', 'HEAD']), policy, destination: join(root, 'stage') })
  const targetRoot = join(root, 'missing target'), approvedPlan = await inspectPublicSync({ stageRoot: stage.target, targetRoot })
  const prepared = await preparePublicSync({ approvedPlan, preparationRoot: join(root, 'prepared') })
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({ lock })
  return { root, targetRoot, prepared, lock, journal }
}
const append = (f, state, event) => appendPublicSyncJournal({ ...f.journal, expectedTailSha256: state.tailSha256, event })

test('intent precedes result, pins original preparation and never writes a missing target', async t => {
  const f = await fixture(t)
  let state = await inspectPublicSyncJournal(f.journal)
  assert.equal(state.events.length, 0); assert.equal(state.applyAuthorized, false)
  state = await append(f, state, { kind: 'intent', operation: 'install', path: 'a.txt' })
  assert.equal(state.pending.path, 'a.txt')
  await assert.rejects(append(f, state, { kind: 'intent', operation: 'install', path: 'a.txt' }), /unresolved/)
  state = await append(f, state, { kind: 'result', intentSequence: 1, outcome: 'not-applied' })
  assert.equal(state.pending, undefined); assert.equal(state.events.length, 2)
  await assert.rejects(releaseUnusedPublicSyncLock(f.lock), /transaction journal/)
  await assert.rejects(access(f.targetRoot), { code: 'ENOENT' })
})

test('wrong tail, outside path, wrong result and changed receipt are rejected', async t => {
  const f = await fixture(t), state = await inspectPublicSyncJournal(f.journal)
  await assert.rejects(append(f, { ...state, tailSha256: '0'.repeat(64) }, { kind: 'intent', operation: 'install', path: 'a.txt' }), /tail changed/)
  await assert.rejects(append(f, state, { kind: 'intent', operation: 'install', path: '../outside' }), /prepared managed/)
  await assert.rejects(append(f, state, { kind: 'result', intentSequence: 1, outcome: 'completed' }), /known intent/)
  const prepared = join(f.prepared.preparationRoot, 'prepared.json'); await writeFile(prepared, '{}')
  await assert.rejects(inspectPublicSyncJournal(f.journal), /prepared receipt changed/)
})

test('truncated intent and ambiguous result are retained and block all new appends', async t => {
  const f = await fixture(t), state = await inspectPublicSyncJournal(f.journal)
  await appendFile(join(f.journal.journalRoot, 'journal.jsonl'), '{"kind":"intent"')
  const interrupted = await inspectPublicSyncJournal(f.journal)
  assert.equal(interrupted.interrupted, true); assert.equal(interrupted.appendable, false)
  await assert.rejects(append(f, state, { kind: 'intent', operation: 'install', path: 'a.txt' }), /Interrupted/)
  assert.ok((await readFile(join(f.journal.journalRoot, 'journal.jsonl'), 'utf8')).endsWith('{"kind":"intent"'))
  const g = await fixture(t)
  let next = await append(g, await inspectPublicSyncJournal(g.journal), { kind: 'intent', operation: 'install', path: 'a.txt' })
  next = await append(g, next, { kind: 'result', intentSequence: 1, outcome: 'ambiguous' })
  assert.equal(next.pending.path, 'a.txt'); assert.equal(next.appendable, false)
  await assert.rejects(append(g, next, { kind: 'result', intentSequence: 1, outcome: 'completed' }), /ambiguous/)
})

test('concurrent appends have one winner and a changed hash chain fails inspection', async t => {
  const f = await fixture(t), state = await inspectPublicSyncJournal(f.journal)
  const event = { kind: 'intent', operation: 'install', path: 'a.txt' }
  const results = await Promise.allSettled([append(f, state, event), append(f, state, event)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const current = await inspectPublicSyncJournal(f.journal)
  assert.equal(current.events.length, 1)
  const path = join(f.journal.journalRoot, 'journal.jsonl'), bytes = await readFile(path, 'utf8')
  const lines = bytes.trimEnd().split('\n'), changed = JSON.parse(lines[1]); changed.previousSha256 = '0'.repeat(64)
  await writeFile(path, lines[0] + '\n' + JSON.stringify(changed) + '\n')
  await assert.rejects(inspectPublicSyncJournal(f.journal), /hash chain changed/)
})

test('interrupted append lease stays visible and cannot be stolen', async t => {
  const f = await fixture(t), state = await inspectPublicSyncJournal(f.journal)
  await mkdir(join(f.journal.journalRoot, '.append-lock'))
  const busy = await inspectPublicSyncJournal(f.journal)
  assert.equal(busy.writerActive, true); assert.equal(busy.appendable, false)
  await assert.rejects(append(f, state, { kind: 'intent', operation: 'install', path: 'a.txt' }), /busy/)
  await access(join(f.journal.journalRoot, '.append-lock'))
})

test('process dies after durable intent and inspection retains unresolved operation', { timeout: 10000 }, async t => {
  const f = await fixture(t), state = await inspectPublicSyncJournal(f.journal)
  const module = new URL('./public-sync-journal.mjs', import.meta.url).href
  const input = { ...f.journal, expectedTailSha256: state.tailSha256, event: { kind: 'intent', operation: 'install', path: 'a.txt' } }
  const code = `import {appendPublicSyncJournal} from ${JSON.stringify(module)};
    await appendPublicSyncJournal(${JSON.stringify(input)}); process.kill(process.pid,'SIGKILL');`
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe'] })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes })
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })
  assert.equal(stderr, ''); assert.equal(result.signal, 'SIGKILL')
  const current = await inspectPublicSyncJournal(f.journal)
  assert.equal(current.pending.path, 'a.txt'); assert.equal(current.pending.sequence, 1)
  await assert.rejects(releaseUnusedPublicSyncLock(f.lock), /transaction journal/)
  await assert.rejects(access(f.targetRoot), { code: 'ENOENT' })
})
