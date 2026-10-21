import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { migrationDefinitionReadPlan, ProjectContentCandidate, loadDesignKit, contentNodeFs } from '../lib/index.js'

test('real Web App single-Bundle migration requires complete affected methods once and retains full definitions on demand', async t => {
  const source = await loadDesignKit(contentNodeFs, resolve('packages/skills-web-app'), { sourceId: 'real-kit-read-cost-regression' })
  const target = { ...source, skills: source.skills.map(skill => skill.name === 'role_access'
    ? { ...skill, version: '1.1', content: `${skill.content}\nPreserve every accepted role and permission.\n` } : skill) }
  const plan = migrationDefinitionReadPlan(source, target)
  const required = JSON.parse(plan.required.target), full = JSON.stringify(target, null, 2)
  assert.deepEqual(required.changed, ['role_access'])
  assert.equal(required.files['role_access/SKILL.md'], target.skills.find(skill => skill.name === 'role_access').content)
  for (const [path, bytes] of plan.resources.target) if (path.startsWith('role_access/') && path.endsWith('.md')) assert.equal(required.files[path], bytes, `complete professional resource ${path}`)
  assert.equal(required.files['mindset.md'], source.mindsetSource ?? source.mindset)
  assert.ok(required.files['role_access/schema.yaml']); assert.ok(required.files['role_access/validation.yaml'])
  assert.equal(required.files['page_design/SKILL.md'], undefined, 'unrelated method is available but not repeated in required reading')
  assert.ok(plan.required.target.length < 150_000, `bounded real-Kit reading: ${plan.required.target.length} vs ${full.length}`)
  assert.ok(full.length > plan.required.target.length * 5)
  t.diagnostic(`real Kit full=${full.length} chars; required source=${plan.required.source.length}, target=${plan.required.target.length}`)
  const root = await mkdtemp(join(tmpdir(), 'real-kit-required-reading-')); t.after(() => rm(root, { recursive: true, force: true }))
  const definitions = join(root, 'definitions.json'); await writeFile(definitions, JSON.stringify({ source, target }))
  const candidate = new ProjectContentCandidate(root, definitions)
  assert.equal((await candidate.readDefinition('target', 0, 'complete')).total, full.length)
  assert.throws(() => candidate.assertDefinitionsRead(), /complete required methods/, 'on-demand full reading does not fake required coverage')
  const resource = 'page_design/SKILL.md'
  assert.equal((await candidate.readDefinition('source', 0, resource)).text, plan.resources.source.get(resource).slice(0, 12000))
  for (const side of ['source', 'target']) {
    let offset = 0
    do { offset = (await candidate.readDefinition(side, offset)).nextOffset } while (offset !== null)
  }
  candidate.assertDefinitionsRead()
})
