import assert from 'node:assert/strict'
import test from 'node:test'
import { questionSchemaYaml as schema, questionValidation } from './fixtures/declarative-question.mjs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify } from 'yaml'
import { loadDesignKit } from '../src/kit-loader.ts'
import { parseReviewSupport, reviewSupportOf, reviewCandidates } from '../src/review-support.ts'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

// Real source loader over an in-memory Kit, not an installed package, running
// model, receipt-selection flow, user project or durable publication fixture.
async function load(declarations, extraManifest = {}) {
  const root = resolve(repo, '.review-support-fixture-not-written')
  const names = Object.keys(declarations)
  const files = new Map([
    [resolve(root, 'mindset.md'), `---\nname: review_fixture\nversion: "0.1"\n---\n<design_skills>\n${names.map(name => `## ${name}`).join('\n')}\n</design_skills>\n`],
  ])
  for (const name of names) {
    const dir = resolve(root, 'skills', name)
    const support = declarations[name]
    files.set(resolve(dir, 'skill.yaml'), stringify({
      name, version: '0.1', title: { zh: name, en: name }, label: { zh: name, en: name },
      execution: { mode: 'main', handoff: 'none' },
      ...(support === undefined ? {} : { review_support: support }), ...extraManifest,
    }))
    files.set(resolve(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Candidate fixture, not user facts.\n---\nMethod unchanged.\n`)
    files.set(resolve(dir, 'schema.yaml'), schema)
    files.set(resolve(dir, 'validation.yaml'), stringify({ ...questionValidation, skill: name }))
  }
  return loadDesignKit({
    readText: async path => files.get(path),
    listDir: async path => [...new Set([...files.keys()]
      .filter(file => dirname(file) === path).map(file => basename(file))
      .concat(path === resolve(root, 'skills') ? names : []))],
    isDirectory: async path => [...files.keys()].some(file => file.startsWith(path + '/')),
  }, root, { sourceId: 'review-support-source-test' })
}

test('omitted and empty declarations load without candidates or inferred roles', async () => {
  const kit = await load({ omitted: undefined, empty: [] })
  assert.deepEqual(reviewCandidates(kit, 'alignment'), [])
  assert.deepEqual(reviewCandidates(kit, 'reflection'), [])
  assert.equal(Object.hasOwn(kit.skills[0].metadata.skillManifest, 'review_support'), false)
  assert.deepEqual(reviewSupportOf(kit.skills[0]), [])
  assert.deepEqual(kit.skills[1].metadata.skillManifest.review_support, [])
})

test('multiple Bundles may support either or both roles without unique-provider routing', async () => {
  const kit = await load({ both: ['reflection', 'alignment'], clarify: ['alignment'], investigate: ['reflection'] })
  assert.deepEqual(reviewCandidates(kit, 'alignment').map(skill => skill.name), ['both', 'clarify'])
  assert.deepEqual(reviewCandidates(kit, 'reflection').map(skill => skill.name), ['both', 'investigate'])
  assert.deepEqual(reviewSupportOf(kit.skills[0]), ['reflection', 'alignment'])
  assert.ok(Object.isFrozen(kit.skills[0].metadata.skillManifest.review_support))
  assert.ok(Object.isFrozen(reviewCandidates(kit, 'alignment')))
  assert.equal(reviewCandidates(kit, 'alignment')[0], kit.skills[0])
  // Discovery does not add a semantic capability, change placement/handoff or
  // mint a receipt/target into content. Selection is a separate trusted path.
  assert.equal(kit.skills[0].metadata.skillManifest.semantic_capabilities, undefined)
  assert.equal(kit.skills[0].execution.mode, 'main')
  assert.equal(kit.skills[0].execution.handoff, 'none')
  assert.equal(kit.skills[0].metadata.skillManifest.actionReceipts, undefined)
})

test('actual loader rejects duplicate, unknown and malformed candidate declarations', async () => {
  for (const [value, message] of [
    [['alignment', 'alignment'], /review_support must be unique/],
    [['reflection', 'reflection'], /review_support must be unique/],
    [['grounding'], /review_support\[0\] must be alignment or reflection/],
    [['Alignment'], /review_support\[0\]/],
    [['alignment', 'unknown'], /review_support\[1\]/],
    [[null], /review_support\[0\]/],
    [[1], /review_support\[0\]/],
    [[{}], /review_support\[0\]/],
    ['alignment', /review_support must be a list/],
    [null, /review_support must be a list/],
    [{ alignment: true }, /review_support must be a list/],
  ]) await assert.rejects(load({ invalid: value }), message)
})

test('candidate roles do not weaken the existing unique semantic capability contract', async () => {
  await assert.rejects(load({ first: ['alignment'], second: ['alignment'] }, {
    semantic_capabilities: ['io.deepseek.design.capability.question-round/v1'],
  }), /semantic capability .* is declared by both/)
})

test('parsing keeps authored roles isolated and rejects unsafe hand-constructed metadata', () => {
  const source = ['alignment']
  const parsed = parseReviewSupport(source, 'skill.yaml')
  source.push('reflection')
  assert.deepEqual(parsed, ['alignment'])
  assert.ok(Object.isFrozen(parsed))
  assert.deepEqual(parseReviewSupport(undefined, 'skill.yaml'), [])
  assert.throws(() => reviewSupportOf({ name: 'unsafe', metadata: {
    skillManifest: { review_support: ['grounding'] },
  } }), /review_support\[0\]/)
})
