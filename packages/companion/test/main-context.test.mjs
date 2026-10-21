/** Real project records/Git; no native Host, transcript or model. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DesignProjectManager, GitVersioning, nodeDesignProjectSpawn, designProjectRecordsRoot } from '../../core/lib/index.js'
import { createCompanionMainContext } from '../src/main-context.mjs'

const scores = { summary: 'Intent known; permissions need evidence', u: { score: 82, evidence: 'Owner and outcome are explicit' },
  s: { score: 70, evidence: 'Saved facts describe note boundaries' }, t: { score: 65, evidence: 'Privacy criteria need evidence' } }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'companion-main-records-')); t.after(() => rm(root, { recursive: true, force: true }))
  const opened = await new DesignProjectManager().create({ root: join(root, 'project'), name: 'Clarity files', knowledge: { provider: 'ladybug-wasm' } })
  const store = new GitVersioning(nodeDesignProjectSpawn, opened.root, 'design_files')
  store.sameDesignEvidenceAt = async (a, b) => await store.designEvidenceRevisionAt(a) === await store.designEvidenceRevisionAt(b)
  const kit = { name: 'fixture', version: '1.0', skills: [], resources: {} }
  let tail = Promise.resolve(), knowledgeReads = 0
  const project = { project: opened, kit, store, async requireWritable() {},
    async readWorkspace() { return { checkpoint: await store.head() } },
    mutateAssessment(operation) { const result = tail.then(operation); tail = result.catch(() => {}); return result } }
  const create = project => createCompanionMainContext({ project,
    reviews: { mutateAssessment: operation => operation() },
    knowledge: { async status() { knowledgeReads++; return { state: 'unavailable' } } } })
  return { root, project, kit, store, create, api: create(project), knowledgeReads: () => knowledgeReads,
    authorityPath: join(designProjectRecordsRoot(opened.root), 'clarity.json') }
}

test('ordinary report needs no native log and records tracked project files without changing Design evidence', async t => {
  const f = await fixture(t), first = await f.api.context(), before = await f.store.head()
  assert.equal(first.clarity.state, 'unknown')
  assert.deepEqual(Object.keys(first.input).sort(), ['assessedCheckpoint', 'kitContentHash', 'projectId'])
  await writeFile(join(f.project.project.root, 'user-notes.txt'), 'Uncommitted user work')
  const result = await f.api.report({ input: first.input, ...scores })
  assert.equal(result.report.origin, 'main-agent')
  assert.equal('turn' in result.report, false); assert.equal('callId' in result.report, false)
  assert.equal(result.assessedCheckpoint, before)
  assert.notEqual(await f.store.head(), before)
  assert.equal(await f.store.sameDesignEvidenceAt(before, await f.store.head()), true)
  assert.equal((await f.api.context()).clarity.state, 'current')
  const git = new GitVersioning(nodeDesignProjectSpawn, f.project.project.root)
  const paths = await git.listPathsAt(await git.head())
  assert.ok(paths.includes('design_records/clarity.json'))
  assert.ok(paths.some(path => path.startsWith('design_records/journal/') && path.endsWith('.jsonl')))
  assert.equal(paths.includes('user-notes.txt'), false)
  assert.equal(paths.some(path => /native|review.lock|runtime/.test(path)), false)
})

test('same-input retry is a no-op and legitimate same-checkpoint corrections A to B to A are allowed', async t => {
  const f = await fixture(t), args = { input: (await f.api.context()).input, ...scores }
  const a = await f.api.report(args), head = await f.store.head()
  assert.equal((await f.api.report(args)).replayed, true)
  assert.equal(await f.store.head(), head)
  const b = await f.api.report({ ...args, summary: 'New conversation intent changes the interpretation' })
  assert.equal(b.replayed, false)
  assert.equal((await f.api.report(args)).replayed, false)
  assert.deepEqual((await f.api.context()).clarity.assessment, a.report)
})

test('wrong project, changed Kit, invalid scores and truly stale Design evidence do not replace the score', async t => {
  const f = await fixture(t), args = { input: (await f.api.context()).input, ...scores }
  await f.api.report(args)
  const before = await readFile(f.authorityPath, 'utf8')
  await assert.rejects(f.api.report({ ...args, input: { ...args.input, projectId: randomUUID() } }), /no longer current/)
  await assert.rejects(f.api.report({ ...args, u: { score: 101, evidence: 'Invalid' } }))
  await assert.rejects(f.api.report({ ...args, input: { ...args.input, scopeDigest: 'd'.repeat(64) } }), /Expected the project/)
  f.kit.resources['changed.md'] = 'Changed effective Kit'
  await assert.rejects(f.api.report(args), /no longer current/)
  delete f.kit.resources['changed.md']
  const git = new GitVersioning(nodeDesignProjectSpawn, f.project.project.root)
  await git.commitExact('Save new Design evidence', new Map([['design_files/test/facts.json', Buffer.from('{"changed":true}')]]), await git.head())
  assert.equal((await f.api.context()).clarity.state, 'due')
  await assert.rejects(f.api.report(args), /no longer current/)
  assert.equal(await readFile(f.authorityPath, 'utf8'), before)
})

test('copying the project with Git restores assessments in another runtime without native credentials', async t => {
  const f = await fixture(t), args = { input: (await f.api.context()).input, ...scores }
  await f.api.report(args)
  const copy = join(f.root, 'copy'); await cp(f.project.project.root, copy, { recursive: true })
  const opened = await new DesignProjectManager().open(copy)
  const other = { ...f.project, project: opened, store: new GitVersioning(nodeDesignProjectSpawn, copy, 'design_files') }
  other.store.sameDesignEvidenceAt = async (a, b) => await other.store.designEvidenceRevisionAt(a) === await other.store.designEvidenceRevisionAt(b)
  const restored = await f.create(other).context()
  assert.equal(restored.clarity.state, 'current')
  assert.equal(restored.clarity.assessment.u.score, 82)
})

test('save notification does not read KAG or require a main transcript', async t => {
  const f = await fixture(t)
  assert.match(await f.api.notification({ commit: await f.store.head() }), /files are durable/)
  assert.equal(f.knowledgeReads(), 0)
  assert.match((await f.api.context()).method, /does not block|never gates/)
})
