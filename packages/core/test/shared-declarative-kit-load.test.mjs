import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { loadDesignKit } from '../src/kit-loader.ts'
import { localizePanelManifest, validatePanelManifest } from '../src/panel-dsl.ts'
import { validateSkillDesign } from '../src/validate-design.ts'
import { catalogFromListSkills } from '../../panel/src/client/ported/design/skillCatalog.ts'
import { fieldsForSection } from '../../panel/src/record-state.ts'

const fs = {
  readText: async path => {
    try { return await readFile(path, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  },
  listDir: readdir,
  isDirectory: async path => (await stat(path)).isDirectory(),
  realPath: realpath,
}

async function checkKit(directory, count) {
  const root = fileURLToPath(new URL(`../../${directory}/`, import.meta.url))
  const kit = await loadDesignKit(fs, root, { sourceId: `fixture:shared-ui:${directory}` })
  assert.equal(kit.skills.length, count)
  for (const skill of kit.skills) {
    assert.equal(skill.metadata.skillManifest.presentation.mode, 'declarative', skill.name)
    assert.equal(skill.metadata.skillManifest.presentation.renderer, 'pilot-design/v2', skill.name)
    assert.ok(skill.metadata.panelManifest, `${skill.name}: panel required`)
    assert.ok(skill.metadata.rendererManifest, `${skill.name}: summary required`)
    for (const locale of ['zh-CN', 'en-US']) {
      const panel = localizePanelManifest(skill.metadata.panelManifest, locale)
      assert.deepEqual(validatePanelManifest(panel), [], `${skill.name}/${locale}: real localized declaration must validate`)
    }
  }
  return kit
}

test('integration notes are optional in both presentation and real validation while essential fields remain required', async () => {
  const root = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
  const kit = await loadDesignKit(fs, root, { sourceId: 'fixture:integration-optional-notes' })
  const skill = kit.skills.find(skill => skill.name === 'integration_design')
  const record = { id: 'example', title: 'Example capability', description: 'Read example metadata', url: 'https://example.com/docs', prompt_content: 'Read confirmed metadata when requested.' }
  const state = value => ({ schema_version: 8, integrations: { example: value }, integration_order: ['example'] })
  for (const scopes of [['state'], ['completion']]) {
    for (const note of [undefined, '', 'Existing user-authored note']) {
      assert.deepEqual(await validateSkillDesign(skill, state({ ...record, ...(note === undefined ? {} : { business_rules: note }) }), { scopes }), [])
    }
    for (const field of ['title', 'description', 'url', 'prompt_content']) {
      const issues = await validateSkillDesign(skill, state({ ...record, [field]: '' }), { scopes })
      assert.ok(issues.some(issue => issue.code === 'integration_design.incomplete' && issue.message.includes(`\`${field}\``)), `${field}/${scopes[0]} still rejects blank essential facts`)
    }
    assert.ok((await validateSkillDesign(skill, state({ ...record, business_rules: 42 }), { scopes })).some(issue => issue.code === 'schema_violation'), 'provided notes still obey the string schema')
  }
  for (const locale of ['zh-CN', 'en-US']) {
    const panel = localizePanelManifest(skill.metadata.panelManifest, locale)
    assert.equal(panel.fields.find(field => field.key === 'business_rules').required, false)
    for (const field of ['title', 'description', 'url', 'prompt_content']) assert.equal(panel.fields.find(candidate => candidate.key === field).required, true)
    const credentials = panel.fields.find(field => field.key === 'secrets')
    assert.equal(credentials.columns[0].format, 'upper_identifier')
    assert.deepEqual(credentials.columns.map(column => column.key), ['name', 'description'], 'translation never changes canonical credential keys')
    if (locale === 'zh-CN') {
      assert.equal(panel.fields.find(field => field.key === 'description').label, '能力说明')
      assert.equal(panel.fields.find(field => field.key === 'url').label, '访问地址')
      assert.equal(panel.fields.find(field => field.key === 'prompt_content').label, '使用方法')
      assert.equal(credentials.columns[1].label, '用途说明')
    }
  }
})

test('notes stay optional across public Web App Bundles, including nested and scalar panel declarations', async () => {
  let noteCount = 0
  for (const directory of ['skills-web-app']) {
    const root = fileURLToPath(new URL(`../../${directory}/`, import.meta.url))
    const kit = await loadDesignKit(fs, root, { sourceId: `fixture:optional-notes:${directory}` })
    for (const skill of kit.skills) {
      const panel = localizePanelManifest(skill.metadata.panelManifest, 'zh-CN')
      const noteKeys = new Set()
      const walk = value => {
        if (!value || typeof value !== 'object') return
        if (Array.isArray(value)) { value.forEach(walk); return }
        const label = value.label ?? value.title ?? ''
        const key = (value.key ?? value.path ?? '').split('.').at(-1)
        if (/备注|^Notes$|^Remarks$/i.test(label) || ['notes', 'remarks'].includes(key)) {
          assert.notEqual(value.required, true, `${skill.name}/${key ?? label}: notes must not advertise a requirement`)
          if (key) { noteKeys.add(key); noteCount++ }
        }
        Object.values(value).forEach(walk)
      }
      walk(panel)
      const schema = parse(skill.metadata.schemaYaml)
      const schemaWalk = value => {
        if (!value || typeof value !== 'object') return
        if (Array.isArray(value.required)) for (const key of value.required) assert.ok(!noteKeys.has(key), `${skill.name}/${key}: notes must not be structurally required`)
        Object.values(value).forEach(schemaWalk)
      }
      schemaWalk(schema)
      const rules = parse(skill.metadata.validationYaml).rules ?? []
      const ruleWalk = value => {
        if (!value || typeof value !== 'object') return
        if (typeof value.non_empty_string === 'string') assert.ok(!noteKeys.has(value.non_empty_string.split('.').at(-1)), `${skill.name}: notes must not have a non-empty gate`)
        Object.values(value).forEach(ruleWalk)
      }
      rules.forEach(ruleWalk)
    }
  }
  assert.equal(noteCount, 5, 'all existing note declarations including the Agent notes are reached')
})

test('required field hints follow existing scoped contracts without adding content validation gates', async () => {
  const root = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
  const kit = await loadDesignKit(fs, root, { sourceId: 'fixture:required-field-alignment' })
  const requireSkill = name => kit.skills.find(skill => skill.name === name)
  for (const [name, keys] of [
    ['role_access', ['assignment_rule', 'capability']],
    ['notification_design', ['trigger', 'recipients', 'channels', 'message']],
    ['quality_acceptance', ['condition', 'pass_criteria']],
    ['business_rules', ['outcome']], ['ai_agent_capabilities', ['name']],
  ]) for (const locale of ['zh-CN', 'en-US']) {
    const panel = localizePanelManifest(requireSkill(name).metadata.panelManifest, locale)
    for (const key of keys) assert.equal(panel.fields.find(field => field.key === key).required, true, `${name}/${key}/${locale}`)
  }
  for (const locale of ['zh-CN', 'en-US']) {
    const aiPanel = localizePanelManifest(requireSkill('ai_agent_capabilities').metadata.panelManifest, locale)
    const aiDescription = aiPanel.fields.find(field => field.key === 'description')
    assert.deepEqual(aiDescription.required_in, ['agents'], 'Agent descriptions remain required in their owning section')
    assert.equal(aiDescription.required, undefined, 'shared resource descriptions are not all required')
    assert.deepEqual(aiDescription.applies_to, ['agents', 'model_sources', 'knowledge_resources'])
    assert.equal(fieldsForSection(aiPanel.fields, 'agents').find(field => field.key === 'description').required, true)
    for (const section of ['model_sources', 'knowledge_resources']) {
      assert.equal(fieldsForSection(aiPanel.fields, section).find(field => field.key === 'description').required, false)
    }
    const panel = localizePanelManifest(requireSkill('business_data').metadata.panelManifest, locale)
    const requirement = panel.fields.flatMap(field => field.item_fields ?? []).find(field => field.key === 'requirement')
    assert.equal(requirement.choice_layout, 'row_wrap', 'short peer choices share the horizontal wrapping presentation')
    assert.deepEqual(requirement.options.map(option => option.value), ['optional', 'always', 'conditional'])
    const field = panel.fields.find(field => field.key === 'description')
    assert.deepEqual(field.required_in, ['objects']); assert.equal(field.required, undefined)
    assert.deepEqual(field.applies_to, ['objects', 'relations'])
    assert.ok(!/optional|选填/i.test(field.label), 'shared caption must not call required object content optional')
  }
  // Publication still decides when completion-only facts must be present.
  // Presentation hints neither weaken these existing rules nor harden drafts.
  for (const [name, section, key, code] of [
    ['business_data', 'objects', 'description', 'business_data.empty_description'],
    ['business_rules', 'rules', 'outcome', 'business_rules.empty_outcome'],
    ['quality_acceptance', 'requirements', 'condition', 'quality_acceptance.missing_condition'],
    ['quality_acceptance', 'requirements', 'pass_criteria', 'quality_acceptance.missing_pass_criteria'],
    ['notification_design', 'notifications', 'trigger', 'notification_design.missing_trigger'],
  ]) {
    const skill = requireSkill(name)
    const state = JSON.parse(await readFile(`${skill.resourceRoot}/reference/preview.json`, 'utf8'))
    state[section][Object.keys(state[section])[0]][key] = ''
    assert.deepEqual(await validateSkillDesign(skill, state, { scopes: ['state'] }), [], `${name}/${key}: state remains unchanged`)
    const issues = await validateSkillDesign(skill, state, { scopes: ['completion'] })
    assert.ok(issues.some(issue => issue.code === code), `${name}/${key}: existing completion minimum remains enforced: ${JSON.stringify(issues)}`)
  }
  const functions = { functions: { f: { function_id: 'f', function_name: '', function_description: '', function_epic: '',
    reason: '', details: { behaviors: { b: { description: '' } }, exceptions: { e: { condition: '', response: '' } } } } } }
  for (const scopes of [['state'], ['completion']]) assert.deepEqual(await validateSkillDesign(requireSkill('function_modules'), functions, { scopes }), [], 'existing presence-only contract is not silently replaced with a quality gate')
  const role = { schema_version: 5, roles: { r: { id: 'r', title: '', assignment_rule: 'Assigned by owner' } }, role_order: ['r'],
    policies: { p: { id: 'p', title: '', role_ref: 'r', capability: 'Read own records', effect: 'allow' } }, policy_order: ['p'] }
  for (const scopes of [['state'], ['completion']]) {
    assert.deepEqual(await validateSkillDesign(requireSkill('role_access'), role, { scopes }), [], 'title presence versus quality policy remains unchanged')
    const blank = structuredClone(role); blank.roles.r.assignment_rule = ''
    assert.ok((await validateSkillDesign(requireSkill('role_access'), blank, { scopes })).some(issue => issue.code === 'role_access.incomplete_role'), 'existing essential state rule remains enforced')
  }
})

test('round context loader resolves declared metadata independently and rejects incompatible bindings', async () => {
  const root = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
  const panel = { version: 1, panel_kind: 'document', sections: [{ id: 'questions', title: 'Questions' }, { id: 'context', title: 'Context', records_path: 'round_envelope.context' }],
    fields: [{ key: 'prompt', control: 'textarea', applies_to: ['questions'] },
      ...['title', 'description'].map(key => ({ key, control: 'text', readonly: true, applies_to: ['context'] }))],
    ui: { id: 'questions', component: 'question_workspace', source: 'questions', rounds_source: 'context' } }
  const load = (collection, fieldsPath) => loadDesignKit({ ...fs, readText: async path => {
    const text = await fs.readText(path)
    if (path.endsWith('/smart_questions/panel.yaml')) {
      const view = structuredClone(panel)
      if (fieldsPath !== undefined) view.sections[1].fields_path = fieldsPath
      return JSON.stringify(view)
    }
    if (path.endsWith('/smart_questions/schema.yaml')) {
      const schema = parse(text)
      schema.properties.round_envelope = { type: 'object', properties: { context: collection } }
      return JSON.stringify(schema)
    }
    return text
  } }, root, { sourceId: 'fixture:round-context-binding' })
  const collection = { type: 'map', value: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } } } }
  const kit = await load(collection)
  assert.equal(kit.skills.find(skill => skill.name === 'smart_questions').metadata.panelManifest.ui.rounds_source, 'context')
  for (const invalid of [
    { type: 'array', items: collection.value },
    { type: 'map', value: { type: 'string' } },
    { type: 'map', value: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'number' } } } },
  ]) await assert.rejects(load(invalid), /rounds_source must resolve to a map of title\/description text records/)
  await assert.rejects(load(collection, 'nested'), /rounds_source must resolve to a map of title\/description text records/)
})

test('all 15 Web App bundles load their declarative profiles while preserving execution handoff', async () => {
  const kit = await checkKit('skills-web-app', 15)
  const page = kit.skills.find(skill => skill.name === 'page_design')
  assert.equal(page.execution.handoff, 'user_continue')
  assert.equal(page.execution.resumeAction.routeId, 'execute_plan')
  assert.equal(page.execution.mode ?? 'subagent', 'subagent')
  assert.equal(kit.skills.find(skill => skill.name === 'smart_questions').execution.mode, 'main')
  assert.equal(kit.skills.find(skill => skill.name === 'research').execution.mode, 'main')
  const notification = kit.skills.find(skill => skill.name === 'notification_design')
  for (const locale of ['zh-CN', 'en-US']) {
    const panel = localizePanelManifest(notification.metadata.panelManifest, locale)
    assert.equal(panel.fields.find(field => field.key === 'channels').token_add_mode, 'menu')
    assert.equal(panel.fields.find(field => field.key === 'recipients').token_add_mode, undefined, 'existing recipient entry stays inline')
  }
  for (const locale of ['zh-CN', 'en-US']) {
    const panel = localizePanelManifest(page.metadata.panelManifest, locale)
    assert.ok(panel.ui.navigation_map.edges.new_label.includes('{target}'))
    assert.ok(!panel.ui.navigation_map.edges.new_label.startsWith('$t:'))
  }
})

test('all 15 public declarations provide exactly one independent guidance and preserve empty-state descriptions', async () => {
  const visit = node => [node, ...(node.children ?? []).flatMap(visit), ...Object.values(node.slots ?? {}).flatMap(visit)]
  let count = 0
  for (const directory of ['skills-web-app']) {
    const root = fileURLToPath(new URL(`../../${directory}/`, import.meta.url))
    const kit = await loadDesignKit(fs, root, { sourceId: 'fixture:independent-panel-guidance' })
    for (const skill of kit.skills) {
      count++
      for (const locale of ['zh-CN', 'en-US']) {
        const panel = localizePanelManifest(skill.metadata.panelManifest, locale)
        const guided = visit(panel.ui).filter(node => node.guidance !== undefined)
        assert.equal(guided.length, 1, `${skill.name}: one owning guidance only`)
        assert.ok(guided[0].guidance.trim() && !guided[0].guidance.startsWith('$t:'))
        assert.notEqual(guided[0].guidance, skill.description, 'action guidance is not capability copy')
        if (['research', 'web_app_prd_assembly', 'design_style'].includes(skill.name)) {
          assert.ok(panel.ui.description && panel.ui.description !== panel.ui.guidance, `${skill.name}: empty description is independent`)
        }
        for (const section of panel.sections.filter(section => section.form?.header?.title?.editable)) {
          const field = fieldsForSection(panel.fields, section.id).find(field => field.key === section.form.header.title.field)
          assert.ok(field && !field.readonly && !field.hidden && field.control === 'text', `${skill.name}/${section.id}: real existing RW name`)
        }
      }
    }
    if (directory === 'skills-web-app') {
      const flow = kit.skills.find(skill => skill.name === 'flow_design').metadata.panelManifest
      assert.equal(flow.fields.find(field => field.key === 'title').readonly, true, 'diagram editing does not widen title permissions')
    }
  }
  assert.equal(count, 15)
})

test('Web App picker keeps exact localized copy while routing and Studio use the method description', async () => {
  const root = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
  const kit = await loadDesignKit(fs, root, { sourceId: 'fixture:description-projection' })
  const response = { mindset: kit.name, skills: kit.skills.map(skill => ({
    id: skill.name, description: skill.description, manifest: skill.metadata.skillManifest,
  })) }
  for (const [language, locale] of [['zh', 'zh-CN'], ['en', 'en-US']]) {
    const cards = catalogFromListSkills(response, language === 'zh' ? 'zh_CN' : 'en_US')[kit.name].entries
    for (const skill of kit.skills) {
      const messages = JSON.parse(await readFile(`${skill.resourceRoot}/locales/${locale}.json`, 'utf8'))
      assert.equal(cards.find(card => card.id === skill.name).description, messages.bundleDescription)
      assert.equal(skill.pickerDescription[language], messages.bundleDescription)
      assert.doesNotMatch(skill.metadata.skillYaml, /^description:/m)
      assert.doesNotMatch(skill.metadata.skillYaml, /renderer: pilot-design\/v2/)
      assert.ok(skill.description.trim())
    }
  }
})

test('localized Bundle copy rejects malformed and duplicate declarations and preserves manifest-only fallback', async () => {
  const root = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
  const load = (rewrite) => loadDesignKit({ ...fs, readText: async path => rewrite(path, await fs.readText(path)) }, root, { sourceId: 'fixture:description-guards' })
  for (const bad of [undefined, '', 7]) {
    await assert.rejects(load((path, text) => {
      if (!path.endsWith('/smart_questions/locales/en-US.json')) return text
      const messages = JSON.parse(text)
      messages.bundleDescription = bad
      return JSON.stringify(messages)
    }), /description.en must be a non-empty string/)
  }
  await assert.rejects(load((path, text) => path.endsWith('/smart_questions/skill.yaml')
    ? text + '\ndescription: {zh: 中文, en: English}\n' : text), /duplicate Bundle display descriptions/)
  const stripLocaleCopy = (path, text) => {
    if (!/smart_questions\/locales\/.*\.json$/.test(path)) return text
    const messages = JSON.parse(text)
    delete messages.bundleDescription
    return JSON.stringify(messages)
  }
  const fallback = (await load(stripLocaleCopy)).skills.find(skill => skill.name === 'smart_questions')
  assert.equal(fallback.pickerDescription, undefined)
  const cards = catalogFromListSkills({ mindset: 'test', skills: [{ id: fallback.name, description: fallback.description, manifest: fallback.metadata.skillManifest }] }, 'zh_CN')
  assert.equal(cards.test.entries[0].description, fallback.description)
  const explicit = (await load((path, text) => path.endsWith('/smart_questions/skill.yaml')
    ? text + '\ndescription: {zh: 中文, en: English}\n' : stripLocaleCopy(path, text))).skills.find(skill => skill.name === 'smart_questions')
  assert.deepEqual(explicit.pickerDescription, { zh: '中文', en: 'English' })
  assert.equal(explicit.description, fallback.description)
  assert.equal(explicit.content, fallback.content)
})

test('static grouped records reject invalid schema bindings at the authored path without requiring an editable category', async () => {
  const root = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
  const loadGrouped = (groupBy, groupingSpec = { type: 'string' }, placement = 'child') => {
    const group = { id: 'groups', component: 'grouped_records', source: 'rules', group_by: groupBy }
    const panel = {
      version: 1, panel_kind: 'document',
      sections: [{ id: 'rules', title: 'Rules', fields_path: 'details' }],
      fields: [{ key: 'title', label: 'Title', control: 'text', applies_to: ['rules'] }],
      ui: placement === 'slot'
        ? { id: 'layout', component: 'panel_workspace', slots: { sidebar: { id: 'context', component: 'text_block', text: 'Groups' }, main: group } }
        : { id: 'layout', component: 'stack', children: [group] },
    }
    return loadDesignKit({ ...fs, readText: async path => {
      const text = await fs.readText(path)
      if (path.endsWith('/business_rules/panel.yaml')) return JSON.stringify(panel)
      if (path.endsWith('/business_rules/schema.yaml')) {
        const schema = parse(text)
        Object.assign(schema.properties.rules.value.properties, {
          category: groupingSpec,
          details: { type: 'object', properties: { title: { type: 'string' }, nested_category: { type: 'string' } } },
        })
        return JSON.stringify(schema)
      }
      return text
    } }, root, { sourceId: 'fixture:grouped-binding' })
  }
  // Classification is a raw-record schema binding, not an editable field or
  // an inferred binding inside the section's nested fields_path.
  await loadGrouped('category')
  await loadGrouped('category', { type: 'enum', values: ['A', 'B'] }, 'slot')
  for (const [key, spec] of [
    ['category_typo', { type: 'string' }],
    ['nested_category', { type: 'string' }],
    ['category', { type: 'number' }],
    ['category', { type: 'string', knowledge: { role: 'metadata' } }],
    ['category', { type: 'string', knowledge: { role: 'reference' } }],
  ]) {
    await assert.rejects(loadGrouped(key, spec), /panel\.yaml ui\.children\[0\]\.group_by: grouped records need a declared scalar grouping field/)
  }
  await assert.rejects(loadGrouped('category_typo', { type: 'string' }, 'slot'),
    /panel\.yaml ui\.slots\.main\.group_by: grouped records need a declared scalar grouping field/)
})
