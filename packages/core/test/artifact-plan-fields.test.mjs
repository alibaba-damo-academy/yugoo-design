import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { stringify } from 'yaml'
import { loadDesignKit } from '../src/kit-loader.ts'
import { parsePanelManifest, validatePanelManifest, localizePanelManifest } from '../src/panel-dsl.ts'

const root = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
const panelPath = `${root}bundles/research/panel.yaml`
const original = parsePanelManifest(await readFile(panelPath, 'utf8'))
const fs = replacement => ({
  readText: async path => {
    if (path === panelPath && replacement !== undefined) return stringify(replacement)
    try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  }, listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
})
// Discovery of installed packages deliberately targets lib. This check loads
// the current source declarations and Core source validator explicitly.
const location = { rootDir: `${root}kits/web_app`, mindsetPath: `${root}kits/web_app/mindset.md`, bundlesDir: `${root}bundles`, skillsDir: `${root}bundles` }
const load = panel => loadDesignKit(fs(panel), location, { sourceId: 'fixture:artifact-plan-fields-source' })

test('real Research declares only its user-owned topic, direction title and research points, in both locales', async () => {
  const kit = await load()
  const research = kit.skills.find(skill => skill.name === 'research')
  assert.ok(research)
  for (const locale of ['zh-CN', 'en-US']) {
    const panel = localizePanelManifest(research.metadata.panelManifest, locale)
    assert.deepEqual(validatePanelManifest(panel), [])
    assert.deepEqual(panel.ui.artifacts.fields.map(field => [field.key, field.control]), [['topic', 'text']])
    assert.deepEqual(panel.ui.artifacts.children.fields.map(field => [field.key, field.control]), [['title', 'text'], ['research_points', 'list']])
    assert.doesNotMatch(JSON.stringify(panel.ui), /\$t:/)
    assert.equal(panel.ui.artifacts.children.fields[1].label, locale === 'en-US' ? 'Questions and scope' : '调研问题与范围')
  }
})

test('artifact field declarations reject foreign paths, missing/hidden titles and malformed local fields without a new schema dialect', () => {
  for (const fields of [[], [null], [{ key: 'title', control: 'made_up' }],
    [{ key: 'title', control: 'text' }, { key: 'other.field', control: 'text' }],
    [{ key: '__proto__', control: 'text' }], [{ key: 'title', control: 'text', applies_to: ['outside'] }],
    [{ key: 'research_points', control: 'list' }], [{ key: 'title', control: 'text', hidden: true }],
    [{ key: 'title', control: 'text', readonly: true }],
  ]) {
    const panel = structuredClone(original)
    panel.ui.artifacts.children.fields = fields
    assert.ok(validatePanelManifest(panel).length > 0, JSON.stringify(fields))
  }
  const legacy = structuredClone(original)
  delete legacy.ui.artifacts.fields
  delete legacy.ui.artifacts.children.fields
  assert.deepEqual(validatePanelManifest(legacy), [], 'optional fields preserve reader-only declarations')
})

test('owning schema validates artifact editor keys and actual value types', async () => {
  for (const extra of [{ key: 'not_a_research_field', control: 'text' }, { key: 'research_points', control: 'text' }, { key: 'source_urls', control: 'number' }]) {
    const panel = structuredClone(original)
    panel.ui.artifacts.children.fields = [panel.ui.artifacts.children.fields[0], extra]
    await assert.rejects(load(panel), /panel\.yaml|field|control|schema/)
  }
})
