import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCompanionMainContext } from '../src/main-context.mjs'
import { DesignProjectManager, GitVersioning, nodeDesignProjectSpawn, commitDesignProjectRecords, designProjectRecordsRoot,
  designClarityDigest, parseDesignClarityReported, writeDesignClarityAuthority } from '../../core/lib/index.js'
import { createCompanionReviews } from '../src/reviews.mjs'

function openSummaries(opened, kit, stateRoot) {
  const projectId = opened.metadata.id, threadId = randomUUID()
  const store = new GitVersioning(nodeDesignProjectSpawn, opened.root, 'design_files')
  store.sameDesignEvidenceAt = async (a, b) => await store.designEvidenceRevisionAt(a) === await store.designEvidenceRevisionAt(b)
  const project = { project: opened, kit, store, async requireWritable() {},
    async readWorkspace() { return { checkpoint: await store.head(), evidenceWorktreeRevision: await store.designEvidenceRevisionAt(await store.head()) } },
    async mutateAssessment(operation) { return operation() } }
  let main
  const reviews = createCompanionReviews({ project, stateRoot, threadId, host: 'workbuddy', readMainInput: () => main.input() })
  main = createCompanionMainContext({ project, reviews })
  return { main, reviews, project, store }
}

const assessment = (score = 82) => ({ summary: 'Scope is clear; test evidence needs work',
  u: { score, evidence: 'The owner and intended outcome are explicit' },
  s: { score: 70, evidence: 'Saved facts define the note structure' },
  t: { score: 65, evidence: 'Privacy checks still need observable evidence' } })

// Both public readers over a real project repository, without a Host or model.
async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'companion-clarity-summary-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const opened = await new DesignProjectManager().create({ root: join(stateRoot, 'project'), name: 'Summary fixture', knowledge: { provider: 'ladybug-wasm' } })
  const kit = { name: 'fixture', version: '1.0', skills: [], resources: {} }
  const { main, reviews, project, store } = openSummaries(opened, kit, stateRoot)
  return { main, reviews, project, kit, store,
    authorityPath: join(designProjectRecordsRoot(opened.root), 'clarity.json'),
    async publish(score) {
      const context = await main.context()
      return main.report({ input: context.input, ...assessment(score) })
    },
    async stagePending(score) {
      const context = await main.context(), value = assessment(score)
      const report = parseDesignClarityReported({ ...value, kit: kit.name, version: kit.version,
        origin: 'main-agent', kitContentHash: context.input.kitContentHash,
        digest: designClarityDigest(value, kit.name, kit.version) })
      await writeDesignClarityAuthority(designProjectRecordsRoot(opened.root), { schemaVersion: 1,
        projectId: opened.metadata.id, assessedCheckpoint: context.input.assessedCheckpoint, report })
    },
    async copy() {
      const target = join(stateRoot, 'copied-project')
      await cp(opened.root, target, { recursive: true })
      return openSummaries({ ...opened, root: target }, kit, join(stateRoot, 'fresh-runtime'))
    },
    async advance({ designChanged = true } = {}) {
      if (designChanged) {
        const git = new GitVersioning(nodeDesignProjectSpawn, opened.root)
        await git.commitExact('Change Design evidence', new Map([['design_files/sample/fact.json', Buffer.from('{"new":true}')]]), await git.head())
      } else {
        await writeFile(join(designProjectRecordsRoot(opened.root), 'clarity.json'), (await readFile(join(designProjectRecordsRoot(opened.root), 'clarity.json'), 'utf8')) + '\n')
        // This metadata change is explicitly auxiliary, unlike arbitrary records.
        await commitDesignProjectRecords({ projectRoot: opened.root, paths: ['design_records/clarity.json'], message: 'No-op auxiliary checkpoint' })
      }
    },
  }
}

test('missing clarity authority needs an assessment in both main and display summaries', async t => {
  const f = await fixture(t)
  const current = await f.main.context()
  assert.deepEqual(current.clarity, { assessment: null, assessedCheckpoint: null, needsReassessment: true, state: 'unknown' })
  assert.deepEqual(await f.reviews.readClarity(), { assessment: null, needsReassessment: true })
  const display = await f.reviews.readPresentation({ workspace: await f.project.readWorkspace(), includeReviews: false })
  assert.deepEqual(display.clarity, { assessment: null, needsReassessment: true })
  await assert.rejects(readFile(f.authorityPath), { code: 'ENOENT' }, 'reading summaries must not invent an assessment')
})

test('a verified current main report supplies the same assessment to both summaries', async t => {
  const f = await fixture(t), saved = await f.publish()
  const current = await f.main.context(), display = await f.reviews.readClarity()
  assert.equal(current.clarity.state, 'current')
  assert.equal(current.clarity.needsReassessment, false)
  assert.equal(display.needsReassessment, false)
  assert.deepEqual([display.assessment.u, display.assessment.s, display.assessment.t],
    [saved.report.u.score, saved.report.s.score, saved.report.t.score])
  assert.equal(display.explanation.assessedCheckpoint, saved.assessedCheckpoint)
  assert.equal(display.explanation.summary, current.clarity.assessment.summary)
  const before = await readFile(f.authorityPath, 'utf8')
  await f.reviews.readPresentation({ workspace: await f.project.readWorkspace(), includeReviews: false })
  assert.equal(await readFile(f.authorityPath, 'utf8'), before, 'display sampling never rewrites the authority')
})

for (const prior of [false, true]) test(`uncommitted replacement ${prior ? 'retains the successful score' : 'cannot invent a first score'} in both public summaries`, async t => {
  const f = await fixture(t)
  if (prior) await f.publish()
  await f.stagePending(95)
  const head = await f.store.head(), bytes = await readFile(f.authorityPath, 'utf8')
  const current = await f.main.context(), display = await f.reviews.readClarity()
  const presentation = await f.reviews.readPresentation({ workspace: await f.project.readWorkspace(), includeReviews: false })
  assert.equal(current.clarity.assessment?.u.score ?? null, prior ? 82 : null)
  assert.equal(current.clarity.state, prior ? 'current' : 'unknown')
  assert.equal(current.clarity.needsReassessment, !prior)
  assert.equal(display.assessment?.u ?? null, prior ? 82 : null)
  assert.equal(display.needsReassessment, !prior)
  assert.deepEqual(presentation.clarity, display)
  if (!prior) assert.deepEqual(display, { assessment: null, needsReassessment: true })
  assert.equal(await f.store.head(), head, 'public reads cannot repair failed publication')
  assert.equal(await readFile(f.authorityPath, 'utf8'), bytes, 'pending bytes remain available for explicit retry')
})

test('a copied Git project retains the committed assessment in fresh Companion summaries', async t => {
  const f = await fixture(t), saved = await f.publish(), copy = await f.copy()
  const current = await copy.main.context(), display = await copy.reviews.readClarity()
  assert.equal(current.clarity.state, 'current')
  assert.equal(display.needsReassessment, false)
  assert.deepEqual(current.clarity.assessment, saved.report)
  assert.equal(display.assessment.u, saved.report.u.score)
  assert.equal(display.explanation.assessedCheckpoint, saved.assessedCheckpoint)
})

test('restored legacy reports retain their score and explanations without acquiring new current-input pins', async t => {
  const f = await fixture(t), saved = await f.publish()
  const legacy = JSON.parse(await readFile(f.authorityPath, 'utf8'))
  delete legacy.report.kitContentHash
  Object.assign(legacy.report, { origin: 'evaluator', callId: 'historical-evaluation', turn: 1 })
  await writeDesignClarityAuthority(designProjectRecordsRoot(f.project.project.root), legacy)
  await commitDesignProjectRecords({ projectRoot: f.project.project.root,
    paths: ['design_records/clarity.json'], message: 'Restore legacy project assessment' })
  const copy = await f.copy(), head = await copy.store.head()
  const current = await copy.main.context(), display = await copy.reviews.readClarity()
  assert.equal(current.clarity.state, 'due')
  assert.equal(current.clarity.needsReassessment, true)
  assert.deepEqual(current.clarity.assessment, legacy.report)
  assert.equal(display.assessment.u, saved.report.u.score)
  assert.equal(display.explanation.summary, saved.report.summary)
  assert.equal(display.needsReassessment, true)
  assert.equal(await copy.store.head(), head, 'legacy reads never migrate or republish the report')
})

test('a metadata-only checkpoint retains the current assessment when Design evidence is unchanged', async t => {
  const f = await fixture(t)
  await f.publish()
  await f.advance({ designChanged: false })
  assert.equal((await f.main.context()).clarity.needsReassessment, false)
  assert.equal((await f.reviews.readClarity()).needsReassessment, false)
})

for (const [name, change] of [
  ['saved Design evidence', f => f.advance()],
  ['Kit version', f => { f.kit.version = '1.1' }],
  ['same-version Kit content', f => { f.kit.resources['method.md'] = 'A changed design method' }],
]) test(`changed ${name} keeps the old score visible but makes both summaries due`, async t => {
  const f = await fixture(t), saved = await f.publish()
  await change(f)
  const current = await f.main.context(), display = await f.reviews.readClarity()
  assert.equal(current.clarity.state, 'due')
  assert.equal(current.clarity.needsReassessment, true)
  assert.equal(display.needsReassessment, true)
  assert.equal(display.assessment.u, saved.report.u.score, 'staleness must not discard the historical score')
  assert.equal(display.explanation.assessedCheckpoint, saved.assessedCheckpoint)
})

test('a malformed clarity authority still fails instead of masquerading as no assessment', async t => {
  const f = await fixture(t)
  await f.publish()
  await writeFile(f.authorityPath, '{broken')
  // Only committed corruption is current. Retain the strict parse guard rather
  // than mistaking an uncommitted local replacement for a published authority.
  await commitDesignProjectRecords({ projectRoot: f.project.project.root,
    paths: ['design_records/clarity.json'], message: 'Corrupt committed authority fixture' })
  await assert.rejects(f.reviews.readClarity(), /invalid JSON/)
  await assert.rejects(f.main.context(), /invalid JSON/)
})
