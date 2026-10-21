/** Real-loader preview checks over the official Kit; no writes or model calls. */
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { prepareStudioPanelPreview } from '../lib/index.js'

const root = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
const source = {
  async readText(path) { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
  listDir: path => readdir(path),
  isDirectory: async path => (await stat(path)).isDirectory(),
  realPath: path => realpath(path),
}
const original = await source.readText(`${root}/bundles/business_rules/panel.yaml`)
const request = {
  kit: { name: 'web_app', version: '1.0' },
  bundle: { name: 'business_rules', version: '1.0' },
  revision: 3,
  panelSource: `${original}\n# Studio draft only\n`,
  sampleSource: JSON.stringify({ schema_version: 4, rules: { rule_a: { id: 'rule_a', title: 'Sample eligibility', condition: 'Age ≥ 18', outcome: 'Allow application' } }, rule_order: ['rule_a'] }),
}
const run = overrides => prepareStudioPanelPreview(source, root, { ...request, ...overrides })
const valid = await run({})
assert.deepEqual(valid.diagnostics, [])
assert.equal(valid.preview.revision, 3)
assert.equal(valid.preview.sample.rules.rule_a.title, 'Sample eligibility')
assert.match(valid.preview.panelYaml, /messages:/, 'use loader-resolved locale content, not raw uncompiled YAML')
assert.equal(await source.readText(`${root}/bundles/business_rules/panel.yaml`), original, 'installed source stays byte-identical')

const resourceReads = []
const resourceSource = { ...source, async readResource(path) {
  resourceReads.push(path)
  const content = await source.readText(path)
  return content === undefined ? undefined : { kind: 'text', content }
} }
const projected = await prepareStudioPanelPreview(resourceSource, root, { ...request,
  panelSource: original.replace('guidance: "$t:guidance"', 'guidance: Current draft guidance'),
})
assert.deepEqual(projected.diagnostics, [])
assert.match(projected.preview.panelYaml, /Current draft guidance/)
assert.equal(resourceReads.filter(path => path.endsWith('/business_rules/panel.yaml')).length, 1,
  'only the base load reads the original resource; the candidate projects the current panel edit')

for (const [overrides, code] of [
  [{ kit: { name: 'web_app', version: '9.9' } }, 'preview.kit_pin'],
  [{ bundle: { name: 'business_rules', version: '9.9' } }, 'preview.bundle_pin'],
  [{ bundle: { name: '../business_rules', version: '1.0' } }, 'preview.request'],
  [{ revision: -1 }, 'preview.request'],
  [{ sampleSource: '{' }, 'preview.sample_json'],
  [{ sampleSource: '[]' }, 'preview.sample_json'],
  [{ sampleSource: '{"schema_version":999}' }, 'preview.sample_schema'],
  [{ panelSource: 'version: [broken' }, 'preview.definition'],
  [{ panelSource: original.replace('field: condition', 'field: missing_field') }, 'preview.definition'],
  [{ panelSource: 'x'.repeat(1_048_577) }, 'preview.size'],
]) {
  const result = await run(overrides)
  assert.equal(result.preview, undefined)
  assert.equal(result.diagnostics[0]?.code, code, JSON.stringify(result))
}

// No eager binding to a mutable request object across loader awaits.
const mutable = structuredClone(request)
const pending = prepareStudioPanelPreview(source, root, mutable)
mutable.revision = 99
mutable.kit.version = '9.9'
mutable.bundle.name = 'other_bundle'
mutable.sampleSource = '{}'
const captured = await pending
assert.deepEqual(captured.diagnostics, [])
assert.equal(captured.preview.revision, 3)
assert.equal(captured.preview.kit.version, '1.0')
assert.equal(captured.preview.bundle.name, 'business_rules')
assert.notEqual(captured.preview.sample, valid.preview.sample)
console.log('STUDIO PANEL PREVIEW: real loader, exact pins, schema sample, source isolation, revision capture PASS')
