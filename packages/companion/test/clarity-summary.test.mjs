import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCompanionMainContext } from '../src/main-context.mjs'
import { DesignProjectManager, GitVersioning, nodeDesignProjectSpawn, commitDesignProjectRecords, designProjectRecordsRoot } from '../../core/lib/index.js'
import { createCompanionReviews } from '../src/reviews.mjs'

// Both public readers over a real project repository, without a Host or model.
async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'companion-clarity-summary-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const opened = await new DesignProjectManager().create({ root: join(stateRoot, 'project'), name: 'Summary fixture', knowledge: { provider: 'ladybug-wasm' } })
  const projectId = opened.metadata.id, threadId = randomUUID()
  const kit = { name: 'fixture', version: '1.0', skills: [], resources: {} }
  const store = new GitVersioning(nodeDesignProjectSpawn, opened.root, 'design_files')
  store.sameDesignEvidenceAt = async (a, b) => await store.designEvidenceRevisionAt(a) === await store.designEvidenceRevisionAt(b)
  const project = { project: opened, kit, store, async requireWritable() {},
    async readWorkspace() { return { checkpoint: await store.head(), evidenceWorktreeRevision: await store.designEvidenceRevisionAt(await store.head()) } },
    async mutateAssessment(operation) { return operation() } }
  let main
  const reviews = createCompanionReviews({ project, stateRoot, threadId, host: 'workbuddy', readMainInput: () => main.input() })
  main = createCompanionMainContext({ project, reviews })
  return { main, reviews, project, kit,
    authorityPath: join(designProjectRecordsRoot(opened.root), 'clarity.json'),
    async publish() {
      const context = await main.context()
      return main.report({ input: context.input, summary: 'Scope is clear; test evidence needs work',
        u: { score: 82, evidence: 'The owner and intended outcome are explicit' },
        s: { score: 70, evidence: 'Saved facts define the note structure' },
        t: { score: 65, evidence: 'Privacy checks still need observable evidence' } })
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
  await assert.rejects(f.reviews.readClarity(), /invalid JSON/)
  await assert.rejects(f.main.context(), /invalid JSON/)
})
