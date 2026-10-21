/** Generic file integrity rules: no Bundle-specific Core behavior. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseValidationYaml, evaluateValidationRules } from '../packages/core/lib/index.js'

const doc = parseValidationYaml(`
skill: arbitrary_future_bundle
rules:
  - id: refs
    scope: [state]
    code: missing
    check: { referenced_files: ["groups.*.items.*.output"] }
  - id: required
    scope: [completion]
    code: required
    check: { required_files: ["arbitrary_future_bundle/final.bin"] }
`)
const state = { groups: { a: { items: [{ output: 'arbitrary_future_bundle/一.html' }, { output: null }] } } }
let files = new Map()
const env = { skill: doc.skill, state, artifactText: async path => files.get(path) }
let issues = await evaluateValidationRules(doc, env, 'state')
assert.equal(issues.length, 1)
assert.equal(issues[0].artifact, 'arbitrary_future_bundle/一.html')
assert.match(issues[0].message, /groups.a.items.0.output.*missing/)
files.set('arbitrary_future_bundle/一.html', '  \n')
assert.match((await evaluateValidationRules(doc, env, 'state'))[0].message, /empty/)
files.set('arbitrary_future_bundle/一.html', '<html>valid bytes</html>')
assert.deepEqual(await evaluateValidationRules(doc, env, 'state'), [])
assert.equal((await evaluateValidationRules(doc, env, 'completion')).length, 1)
files.set('arbitrary_future_bundle/final.bin', '<binary artifact>')
assert.deepEqual(await evaluateValidationRules(doc, env, 'completion'), [])
assert.deepEqual(await evaluateValidationRules(doc, { ...env, state: {} }, 'state'), [])
assert.match((await evaluateValidationRules(doc, { ...env, artifactText: undefined }, 'state'))[0].message, /reader unavailable/)
assert.match((await evaluateValidationRules(doc, { ...env, artifactText: async () => { throw new Error('unreadable') } }, 'state'))[0].message, /unreadable/)
for (const path of ['../escape', '/absolute', 'https://example.org/a', 'C:/file', 'a/.git/config']) {
  state.groups.a.items[0].output = path
  const result = await evaluateValidationRules(doc, { ...env, artifactText: () => { throw new Error('must not read unsafe paths') } }, 'state')
  assert.equal(result.length, 1)
  assert.doesNotMatch(result[0].message, /must not read/)
}
assert.throws(() => parseValidationYaml('skill: bad\nrules:\n - id: a\n   scope: [state]\n   code: bad\n   check: {referenced_files: ["__proto__.file"]}'))

// Exercise every shipped reference declaration against actual schema-shaped data.
const cases = {
  web_app_prd_assembly: { html_file: 'web_app_prd_assembly/prd.html' },
  page_design: { pages: { p: { artifact_file: 'page_design/p.html' } } },
  flow_design: { processes: { p: { bpmn_file: 'flow_design/p.bpmn' } } },
  research: { rounds: { r: { directions: { d: { findings_file: 'research/r/d.md' } }, conclusion_file: 'research/r/conclusion.html' } } },
  design_style: { config: { preview_page: { html_file: 'design_style/p.html' }, images: { i: { path: 'images/i.png' } } } },
  smart_questions: { questions: { q: { multimodal_answer: [{ artifact_file: 'smart_questions/a.png' }] } } },
}
for (const [skill, bundleState] of Object.entries(cases)) {
  const parsed = parseValidationYaml(await readFile(new URL(`../packages/skills-web-app/bundles/${skill}/validation.yaml`, import.meta.url), 'utf8'))
  const refsOnly = { ...parsed, rules: parsed.rules.filter(rule => 'referenced_files' in rule.check) }
  assert.equal(refsOnly.rules.length, 1, skill)
  const run = artifactText => evaluateValidationRules(refsOnly, { skill, state: bundleState, artifactText }, 'state')
  assert.ok((await run(async () => undefined)).length > 0, skill)
  assert.deepEqual(await run(async () => 'landed bytes'), [], skill)
}
console.log('REFERENCED FILE INTEGRITY OK')
