import test from 'node:test'
import assert from 'node:assert/strict'
import { stringify } from 'yaml'
const { validateKit, validateBundle, loadStudioKit, StudioKitDraftService } = await import(
  process.env.STUDIO_DECLARATION_TEST_PLANE === 'built' ? '../lib/index.js' : '../src/index.ts')

function fixture() {
  const root = '/retained/knowledge', name = 'alpha', base = `${root}/skills/${name}`
  const files = new Map([
    [`${root}/mindset.md`, '---\nname: advice_fixture\nversion: "1.0"\n---\n# Method\n<design_skills>\n## alpha\nOwn the supplied facts.\n</design_skills>\n'],
    [`${base}/SKILL.md`, '---\nname: alpha\ndescription: Synthetic method.\n---\n# Method\nPreserve the owned facts.\n'],
    [`${base}/skill.yaml`, stringify({ name, version: '1.0', title: { en: 'Alpha', zh: '甲' }, label: { en: 'Alpha', zh: '甲' }, presentation: { mode: 'declarative' }, execution: { mode: 'main', handoff: 'none' } })],
    [`${base}/schema.yaml`, stringify({ type: 'object', properties: {
      records: { type: 'map', value: { type: 'object', properties: { title: { type: 'string' }, role: { type: 'string' } } } },
      roles: { type: 'map', value: { type: 'object', properties: { title: { type: 'string' } } } },
    } })],
    [`${base}/validation.yaml`, stringify({ skill: name, rules: [{ id: 'records', scope: ['completion'], code: 'alpha.records', check: { non_empty_map: 'records' } }] })],
    [`${base}/panel.yaml`, stringify({ version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'records', title: 'Records' }, { id: 'roles', title: 'Roles' }],
      fields: [{ key: 'role', label: 'Role', control: 'record_select', options_from_section: 'roles', applies_to: ['records'] }], ui: { component: 'stack', id: 'root' } })],
  ])
  const fs = {
    readText: async path => files.get(path),
    listDir: async path => [...new Set([...files.keys()].filter(p => p.startsWith(path + '/')).map(p => p.slice(path.length + 1).split('/')[0]))].sort(),
    isDirectory: async path => [...files.keys()].some(p => p.startsWith(path + '/')),
    realPath: async path => path,
  }
  return { root, base, files, fs }
}

test('real authoring validation returns non-blocking, located warnings while the runtime loader remains unchanged', async () => {
  const { root, base, files, fs } = fixture(), before = [...files]
  const loaded = await loadStudioKit(fs, root)
  assert.equal(loaded.skills.length, 1)
  for (const report of [await validateKit(fs, root), await validateBundle(fs, root, 'alpha')]) {
    assert.equal(report.valid, true)
    assert.equal(report.diagnostics.length, 1)
    assert.equal(report.diagnostics[0].severity, 'warning')
    assert.equal(report.diagnostics[0].code, 'knowledge.reference_role')
    assert.equal(report.diagnostics[0].subject, 'alpha')
    assert.match(report.diagnostics[0].message, /schema.yaml#\/properties\/records\/value\/properties\/role/)
  }
  assert.deepEqual([...files], before)
  assert.equal(loaded.skills[0].metadata.schemaDocument.properties.records.value.properties.role.knowledge, undefined)
  files.set(`${base}/panel.yaml`, 'version: [broken')
  const broken = await validateKit(fs, root)
  assert.equal(broken.valid, false)
  assert.equal(broken.diagnostics[0].code, 'kit.load')
  assert.equal(broken.diagnostics[0].severity, undefined, 'legacy error severity remains the default')
})

test('Kit working-copy validation/confirmation retains warnings without blocking adoption or mutating installed sources', async () => {
  const { root, files, fs } = fixture(), before = [...files]
  const records = new Map()
  const repository = {
    async create(value) { const row = { ...structuredClone(value), id: 'draft', revision: 0 }; records.set(row.id, row); return structuredClone(row) },
    async read(id) { return structuredClone(records.get(id)) },
    async list() { return structuredClone([...records.values()]) },
    async replace(id, expected, value) { const previous = records.get(id); assert.equal(previous.revision, expected); assert.equal(previous.confirmed, false); const row = { ...structuredClone(value), id, revision: expected + 1 }; records.set(id, row); return structuredClone(row) },
  }
  const snapshot = { id: 'retained', root, fs }
  const service = new StudioKitDraftService(repository, { capture: async () => snapshot, open: async () => snapshot })
  const draft = await service.create({ kit: { name: 'advice_fixture', version: '1.0' } })
  const pin = { id: draft.id, expectedRevision: draft.revision }
  const validated = await service.validate(pin)
  assert.equal(validated.valid, true)
  assert.equal(validated.diagnostics[0].severity, 'warning')
  const confirmed = await service.confirm(pin)
  assert.equal(confirmed.valid, true)
  assert.equal(confirmed.diagnostics[0].severity, 'warning')
  assert.equal(confirmed.draft.confirmed, true)
  assert.equal((await service.read(draft.id)).confirmed, true)
  assert.deepEqual([...files], before)
})
