import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { loadDesignKit } from '../lib/kit-loader.js'
import { parsePanelManifest, localizePanelManifest } from '../lib/panel-dsl.js'

const root = fileURLToPath(new URL('../../skills-web-app', import.meta.url))
const fs = {
  readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return; throw error } },
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
}
const load = overrides => loadDesignKit({ ...fs, ...overrides }, root, { sourceId: 'fixture:i18n' })
const panel = kit => parsePanelManifest(kit.skills.find(skill => skill.name === 'business_rules').metadata.panelYaml)

test('initial label declaration loads localized templates and rejects non-string schema targets', async () => {
  const { register } = await import('tsx/esm/api'); register()
  const { loadDesignKit: loadSource } = await import('../src/kit-loader.ts')
  const { parsePanelManifest: parseSource, localizePanelManifest: localizeSource } = await import('../src/panel-dsl.ts')
  const loadCurrent = overrides => loadSource({ ...fs, ...overrides }, root, { sourceId: 'fixture:initial-label' })
  const kit = await loadCurrent()
  const manifest = parseSource(kit.skills.find(skill => skill.name === 'quality_acceptance').metadata.panelYaml)
  assert.equal(localizeSource(manifest, 'zh-CN').sections[0].create.initial_label.text, '新验收要求')
  assert.equal(localizeSource(manifest, 'en-US').sections[0].create.initial_label.numbered_text, 'New acceptance requirement {index}')
  assert.equal(localizeSource(manifest, 'en-US').sections[0].create.defaults.title, '')
  for (const field of ['missing', 'id']) {
    await assert.rejects(loadCurrent({ readText: async path => {
      const text = await fs.readText(path)
      if (!path.endsWith('/quality_acceptance/panel.yaml')) return text
      const candidate = parseSource(text)
      candidate.sections[0].create.initial_label.field = field
      return JSON.stringify(candidate)
    } }), /initial_label/)
  }
  // Keep the editable title/default valid so the initial-label schema guard,
  // rather than an earlier header/default guard, owns the negative result.
  const labelTarget = type => ({ readText: async path => {
    const text = await fs.readText(path)
    if (path.endsWith('/quality_acceptance/panel.yaml')) {
      const candidate = parseSource(text)
      candidate.sections[0].create.initial_label.field = 'condition'
      return JSON.stringify(candidate)
    }
    if (path.endsWith('/quality_acceptance/schema.yaml')) {
      const candidate = parse(text)
      const target = candidate.properties.requirements.value.properties.condition
      assert.equal(target.type, 'string', 'fixture must mutate a real string field')
      target.type = type
      return stringify(candidate)
    }
    return text
  } })
  const validTarget = await loadCurrent(labelTarget('string'))
  assert.equal(validTarget.skills.find(skill => skill.name === 'quality_acceptance')
    .metadata.panelManifest.sections[0].create.initial_label.field, 'condition')
  await assert.rejects(loadCurrent(labelTarget('number')),
    /requirements initial_label field must reference a non-id string schema field$/)
})

test('locale resource changes update effective panel payload without compiling runtime', async () => {
  const first = await load()
  const second = await load({ readText: async path => {
    const text = await fs.readText(path)
    if (path.endsWith('/business_rules/locales/en-US.json')) return JSON.stringify({ ...JSON.parse(text), rules: 'Updated rules' })
    return text
  } })
  assert.equal(localizePanelManifest(panel(first), 'en-US').ui.title, 'Business rules')
  assert.equal(localizePanelManifest(panel(second), 'en-US').ui.title, 'Updated rules')
  assert.equal(localizePanelManifest(panel(first), 'zh-CN').ui.title, '业务规则')
  assert.notDeepEqual(panel(first).i18n.messages, panel(second).i18n.messages)
})

test('default missing translation rejects a kit, optional missing key falls back', async () => {
  const missing = locale => ({ readText: async path => {
    const text = await fs.readText(path)
    if (path.endsWith(`/business_rules/locales/${locale}.json`)) { const messages = JSON.parse(text); delete messages.rules; return JSON.stringify(messages) }
    return text
  } })
  await assert.rejects(load(missing('zh-CN')), /missing default translation: rules/)
  const kit = await load(missing('en-US'))
  assert.equal(localizePanelManifest(panel(kit), 'en-US').ui.title, '业务规则')
})

test('a locale symlink cannot read another Bundle even inside the Kit', async () => {
  await assert.rejects(load({ realPath: async path => path.endsWith('/business_rules/locales/en-US.json')
    ? `${root}/skills/smart_questions/locales/en-US.json` : realpath(path) }), /path escapes Kit root/)
})

test('preview presets and direct scalar controls must obey the canonical schema', async () => {
  const mutate = update => ({ readText: async path => {
    const text = await fs.readText(path)
    if (!path.endsWith('/design_style/panel.yaml')) return text
    const manifest = JSON.parse(text); update(manifest); return JSON.stringify(manifest)
  } })
  await assert.rejects(load(mutate(panel => { panel.ui.live_preview.presets[0].values['config.layout.mode'] = 'invented-mode' })), /invalid preset binding/)
  await assert.rejects(load(mutate(panel => { panel.ui.children[0].children[0].path = 'config.missing' })), /scalar binding/)
  const kit = await load(), style = parsePanelManifest(kit.skills.find(skill => skill.name === 'design_style').metadata.panelYaml)
  const english = localizePanelManifest(style, 'en-US')
  assert.equal(english.ui.live_preview.presets[0].title, 'Vermilion festival')
  assert.equal(english.ui.live_preview.presets[0].values['config.theme'], '节庆朱橙', 'localization must not translate canonical preset values')
})

test('typed nested fields and creation defaults are checked against the actual child schema', async () => {
  const mutate = update => ({ readText: async path => {
    const text = await fs.readText(path)
    if (!path.endsWith('/integration_design/panel.yaml')) return text
    const manifest = parsePanelManifest(text), field = manifest.fields.find(field => field.key === 'secrets')
    delete field.columns
    field.item_fields = [{ key: 'name', label: 'Name', control: 'text' }, { key: 'description', label: 'Description', control: 'textarea' }]
    field.item_label_field = 'name'
    field.item_defaults = { name: '', description: '' }
    update(field)
    return JSON.stringify(manifest)
  } })
  await load(mutate(() => {}))
  await assert.rejects(load(mutate(field => { field.item_fields[1].control = 'toggle' })), /incompatible child description/)
  await assert.rejects(load(mutate(field => { field.item_defaults.name = false })), /invalid record_map secrets default name/)
  await assert.rejects(load(mutate(field => { field.item_fields.push({ key: 'missing', label: 'Missing', control: 'text' }) })), /incompatible child missing/)
})
