import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api')
register()
const { basicGenericManifest } = await import('../src/auto-panel-generation.ts')
const { autoPanelSnapshot, exportAutoPanelDsl, validateAutoPanelEdit,
  preserveAutoPanelDefinition, readSavedAutoPanelDefinition, validateSavedAutoPanelEdit } = await import('../src/auto-panel-spec.ts')
const { parsePanelManifest } = await import('../src/panel-dsl.ts')

const context = {
  kit: 'equipment', kitVersion: '1.0', bundle: 'inventory', bundleVersion: '1.0',
  schema: { type: 'object', required: ['items'], additional_properties: false, properties: {
    items: { type: 'map', value: { type: 'object', required: ['title'], additional_properties: false,
      properties: { title: { type: 'string' } } } },
  } },
  state: { items: { first: { title: 'UNIQUE-SOURCE-CONTENT' } } },
}
function snapshot(manifest = basicGenericManifest(context)) {
  return autoPanelSnapshot(context, [
    { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest }] } },
  ])
}

test('question fallback preserves declared extra content through snapshot, DSL retention and rendering without granting writes', async () => {
  const React = await import('../../panel/node_modules/react/index.js')
  globalThis.React = React
  const { renderToStaticMarkup } = await import('../../panel/node_modules/react-dom/server.js')
  const { renderManifest } = await import('../../panel/src/interpreter.ts')
  const properties = Object.fromEntries(['prompt', 'answer', 'detail', 'domain_note'].map(key => [key, { type: 'string' }]))
  const questionContext = { ...context, bundle: 'questions',
    schema: { type: 'object', properties: { questions: { type: 'map', value: { type: 'object', properties } } } },
    state: { questions: { first: { prompt: 'Question', answer: 'Answer', detail: 'Detail', domain_note: 'UNIQUE-DOMAIN-CONTENT' } } },
  }
  const makeSnapshot = manifest => autoPanelSnapshot(questionContext, [
    { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest }] } },
  ])
  const manifest = basicGenericManifest(questionContext)
  const hidden = structuredClone(manifest)
  hidden.ui.children = hidden.ui.children.filter(node => node.component !== 'structured_data')
  assert.throws(() => makeSnapshot(hidden), /question fields omitted without readable overview/)
  const overview = manifest.ui.children.find(node => node.component === 'structured_data')
  for (const branch of ['children', 'slots']) {
    const ignored = structuredClone(hidden)
    ignored.ui.children[0][branch] = branch === 'children' ? [overview] : { main: overview }
    assert.equal(renderToStaticMarkup(renderManifest(ignored, questionContext.state)).includes('UNIQUE-DOMAIN-CONTENT'), false)
    assert.throws(() => makeSnapshot(ignored), /unrendered branches/)
  }
  for (const layout of ['stack', 'tabs', 'split']) {
    const composed = structuredClone(manifest)
    const question = { ...composed.ui.children[0], title: 'Question' }
    const data = { ...overview, title: 'Overview' }
    composed.ui = layout === 'split'
      ? { id: 'layout', component: layout, slots: { sidebar: question, main: data } }
      : { id: 'layout', component: layout, children: [question, { id: 'nested', component: 'stack', title: 'Overview', children: [data] }] }
    assert.doesNotThrow(() => makeSnapshot(composed))
    assert.match(renderToStaticMarkup(renderManifest(composed, questionContext.state)), /UNIQUE-DOMAIN-CONTENT/)
  }
  for (const ui of [
    { id: 'bad-stack', component: 'stack', children: hidden.ui.children, slots: { main: overview } },
    { id: 'bad-tabs', component: 'tabs', children: hidden.ui.children, slots: { main: overview } },
    { id: 'bad-split', component: 'split', slots: { main: hidden.ui.children[0] }, children: [overview] },
    { id: 'bad-slot', component: 'split', slots: { main: hidden.ui.children[0], extra: overview } },
  ]) assert.throws(() => makeSnapshot({ ...manifest, ui }))
  const generated = makeSnapshot(manifest)
  const saved = JSON.parse(JSON.stringify(preserveAutoPanelDefinition(generated, questionContext)))
  const exported = parsePanelManifest(exportAutoPanelDsl(generated, questionContext))
  const reopened = readSavedAutoPanelDefinition(saved, questionContext).manifest
  assert.deepEqual(exported, manifest)
  assert.deepEqual(reopened, manifest)
  for (const locale of ['zh-CN', 'en']) {
    for (const editable of [false, true]) {
      const options = { locale, editable }
      const before = renderToStaticMarkup(renderManifest(manifest, questionContext.state, options))
      const after = renderToStaticMarkup(renderManifest(reopened, questionContext.state, options))
      assert.match(after, /UNIQUE-DOMAIN-CONTENT/)
      assert.equal(after, before)
    }
  }
  const edited = structuredClone(questionContext.state)
  edited.questions.first.answer = 'Updated answer'
  edited.questions.first.detail = 'Updated detail'
  assert.doesNotThrow(() => validateSavedAutoPanelEdit(saved, questionContext, edited))
  edited.questions.first.domain_note = 'Unauthorized write'
  assert.throws(() => validateSavedAutoPanelEdit(saved, questionContext, edited), /protected/)
  const corrupt = JSON.parse(saved.dsl)
  corrupt.ui.children = corrupt.ui.children.filter(node => node.component !== 'structured_data')
  assert.throws(() => readSavedAutoPanelDefinition({ ...saved, dsl: JSON.stringify(corrupt) }, questionContext), /question fields omitted/)
})

test('question coverage keeps basic text compact but does not assume nested choice configuration is fully projected', async () => {
  globalThis.React = await import('../../panel/node_modules/react/index.js')
  const { renderToStaticMarkup } = await import('../../panel/node_modules/react-dom/server.js')
  const { renderManifest } = await import('../../panel/src/interpreter.ts')
  const properties = Object.fromEntries(['prompt', 'answer', 'detail', 'note'].map(key => [key, { type: 'string' }]))
  properties.internal_id = { type: 'string', knowledge: { role: 'metadata' } }
  const questionContext = { ...context,
    schema: { type: 'object', properties: { questions: { type: 'map', value: { type: 'object', properties } } } },
    state: { questions: { first: { prompt: 'Question', answer: '', detail: '', note: 'Explanation', internal_id: 'private' } } },
  }
  const compact = basicGenericManifest(questionContext)
  assert.deepEqual(compact.ui.children.map(node => node.component), ['question_workspace'])
  for (const locale of ['zh-CN', 'en']) {
    assert.match(renderToStaticMarkup(renderManifest(compact, questionContext.state, { locale })), /Explanation/)
  }
  properties.choices = { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, label: { type: 'string' }, rationale: { type: 'string' } } } }
  assert.deepEqual(basicGenericManifest(questionContext).ui.children.map(node => node.component), ['question_workspace', 'structured_data'])
})

test('question overview checks the actual source while the renderer preserves logical section aliases', async () => {
  globalThis.React = await import('../../panel/node_modules/react/index.js')
  const { renderToStaticMarkup } = await import('../../panel/node_modules/react-dom/server.js')
  const { renderManifest } = await import('../../panel/src/interpreter.ts')
  const properties = Object.fromEntries(['prompt', 'answer', 'detail', 'domain_note'].map(key => [key, { type: 'string' }]))
  const questionContext = { ...context,
    schema: { type: 'object', properties: { questions: { type: 'map', value: { type: 'object', properties } } } },
    state: { questions: { first: { prompt: 'UNIQUE-BOUND-QUESTION', answer: '', detail: '', domain_note: 'UNIQUE-ALIAS-CONTENT' } } },
  }
  const direct = basicGenericManifest(questionContext)
  const aliased = structuredClone(direct)
  aliased.sections[0] = { ...aliased.sections[0], id: 'alias', records_path: 'questions' }
  for (const field of aliased.fields) field.applies_to = ['alias']
  aliased.ui.children[0].source = 'alias'
  const questionOnly = { ...aliased, ui: aliased.ui.children[0] }
  assert.match(renderToStaticMarkup(renderManifest(questionOnly, questionContext.state)), /UNIQUE-BOUND-QUESTION/)
  assert.match(renderToStaticMarkup(renderManifest(direct, questionContext.state)), /UNIQUE-BOUND-QUESTION/)
  const makeSnapshot = manifest => autoPanelSnapshot(questionContext, [
    { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest }] } },
  ])
  const saved = preserveAutoPanelDefinition(makeSnapshot(aliased), questionContext)
  const reopened = readSavedAutoPanelDefinition(saved, questionContext).manifest
  for (const locale of ['zh-CN', 'en']) {
    const html = renderToStaticMarkup(renderManifest(reopened, questionContext.state, { locale }))
    assert.match(html, /UNIQUE-BOUND-QUESTION/)
    assert.match(html, /UNIQUE-ALIAS-CONTENT/)
  }
  const edited = structuredClone(questionContext.state)
  edited.questions.first.answer = 'Alias answer'
  edited.questions.first.detail = 'Alias detail'
  assert.doesNotThrow(() => validateSavedAutoPanelEdit(saved, questionContext, edited))
  edited.questions.first.domain_note = 'Forbidden alias write'
  assert.throws(() => validateSavedAutoPanelEdit(saved, questionContext, edited), /protected/)
  assert.throws(() => validateSavedAutoPanelEdit(saved, questionContext, { questions: {} }), /identities/)
  aliased.ui.children.pop()
  assert.throws(() => makeSnapshot(aliased), /question fields omitted without readable overview/)
  direct.sections[0].records_path = 'questions'
  assert.doesNotThrow(() => makeSnapshot(direct))
})

test('supported A2UI exports ordinary DSL without source data or envelope, preserving all manifest fields', () => {
  const before = snapshot(), original = structuredClone(before)
  const text = exportAutoPanelDsl(before, context)
  assert.deepEqual(parsePanelManifest(text), before.messages[1].updateComponents.components[0].manifest)
  assert.equal(text.includes('UNIQUE-SOURCE-CONTENT'), false)
  assert.equal(text.includes('createSurface'), false)
  assert.deepEqual(before, original)
  const after = structuredClone(context.state)
  after.items.first.title = 'Updated'
  assert.doesNotThrow(() => validateAutoPanelEdit(context.state, after, context, parsePanelManifest(text)))
  assert.throws(() => validateAutoPanelEdit(context.state, { ...after, injected: true }, context, parsePanelManifest(text)))
})

test('definition output is deterministic across JSON object key ordering', () => {
  const manifest = basicGenericManifest(context)
  const reversed = Object.fromEntries(Object.entries(manifest).reverse())
  assert.equal(exportAutoPanelDsl(snapshot(manifest), context), exportAutoPanelDsl(snapshot(reversed), context))
})

test('scalar enum choices cannot silently omit values through duplicate options', () => {
  const enumContext = { ...context,
    schema: { type: 'object', properties: { mode: { type: 'enum', values: ['a', 'b'] } } },
    state: { mode: 'b' },
  }
  const makeSnapshot = options => {
    const manifest = basicGenericManifest(enumContext)
    manifest.ui = { id: 'root', component: 'schema_field', path: 'mode', control: 'select', options }
    return autoPanelSnapshot(enumContext, [
      { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
      { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest }] } },
    ])
  }
  assert.throws(() => makeSnapshot([{ value: 'a', label: 'A' }, { value: 'a', label: 'Duplicate A' }]), /scalar field does not match schema/)
  const valid = makeSnapshot([{ value: 'b', label: 'B first' }, { value: 'a', label: 'A second' }])
  const saved = preserveAutoPanelDefinition(valid, enumContext)
  const expected = valid.messages[1].updateComponents.components[0].manifest
  assert.deepEqual(parsePanelManifest(exportAutoPanelDsl(valid, enumContext)), expected)
  assert.deepEqual(readSavedAutoPanelDefinition(saved, enumContext).manifest, expected)
  const corrupt = JSON.parse(saved.dsl)
  corrupt.ui.options[1].value = 'b'
  assert.throws(() => readSavedAutoPanelDefinition({ ...saved, dsl: JSON.stringify(corrupt) }, enumContext), /scalar field does not match schema/)
})

test('saved definition survives serialization and bound-data changes without regeneration or widened writes', () => {
  const saved = JSON.parse(JSON.stringify(preserveAutoPanelDefinition(snapshot(), context)))
  const bytes = JSON.stringify(saved)
  assert.equal(readSavedAutoPanelDefinition(saved, context).sourceChanged, false)
  const next = { ...context, state: { items: { second: { title: 'New record' } } } }
  const loaded = readSavedAutoPanelDefinition(saved, next)
  assert.equal(loaded.sourceChanged, true)
  assert.equal(JSON.stringify(saved), bytes)
  assert.deepEqual(loaded.manifest, JSON.parse(saved.dsl))
  assert.doesNotThrow(() => validateSavedAutoPanelEdit(saved, next, { items: { second: { title: 'Edited' } } }))
  assert.throws(() => validateSavedAutoPanelEdit(saved, next, { items: {} }), /identities/)
  assert.throws(() => validateSavedAutoPanelEdit(saved, next, { items: { second: { title: 'Edited', injected: true } } }), /protected/)
  for (const patch of [{ kit: 'foreign' }, { protocol: 'unknown' }, { catalogId: 'unknown' }, { schemaDigest: 'bad' }]) {
    assert.throws(() => readSavedAutoPanelDefinition({ ...saved, ...patch }, context), /incompatible/)
  }
  assert.throws(() => readSavedAutoPanelDefinition({ ...saved, dsl: '{' }, context))
})

test('export rejects stale, foreign and unsupported surfaces instead of dropping semantics', () => {
  const saved = snapshot()
  assert.throws(() => exportAutoPanelDsl(saved, { ...context, bundle: 'another' }), /identity/)
  assert.throws(() => exportAutoPanelDsl(saved, { ...context, state: { items: {} } }), /stale/)
  const unknown = structuredClone(saved)
  unknown.messages[1].updateComponents.components[0].component = 'UnknownWidget'
  assert.throws(() => exportAutoPanelDsl(unknown, context), /DesignPanel/)
  const extra = structuredClone(saved)
  extra.messages.push({ arbitraryAction: 'execute' })
  assert.throws(() => exportAutoPanelDsl(extra, context), /one surface/)
  const widget = structuredClone(saved)
  widget.messages[1].updateComponents.components[0].manifest.ui.component = 'uninstalled_widget'
  assert.throws(() => exportAutoPanelDsl(widget, context))
  assert.throws(() => exportAutoPanelDsl({ ...saved, protocol: 'a2ui/unknown' }, context), /identity or protocol/)
  assert.throws(() => exportAutoPanelDsl({ ...saved, catalogId: 'foreign' }, context), /identity or protocol/)
  const menu = basicGenericManifest(context)
  menu.fields[0].token_add_mode = 'menu'
  assert.throws(() => snapshot(menu), /token_add_mode|unsupported generated editor field/, 'unsupported addition presentation cannot disappear during retention')
  const longText = basicGenericManifest(context)
  const conditionalLabel = basicGenericManifest(context)
  conditionalLabel.fields[0].label_when = [{ field: conditionalLabel.fields[0].key, in: ['example'], label: 'Example label' }]
  assert.throws(() => snapshot(conditionalLabel), /unsupported generated editor field/, 'authored copy variants cannot silently widen the generated-origin contract')
  longText.fields[0].control = 'textarea'; longText.fields[0].textarea_rows = 8
  assert.throws(() => snapshot(longText), /unsupported generated editor field/, 'authored textarea sizing must not widen the generated-origin editor contract')
})

test('retained definition reloads from disk, preserves source files and reports corruption without regeneration', async () => {
  const { mkdtemp, readFile, writeFile, readdir, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { saveAutoPanelDefinition, loadSavedAutoPanel } = await import('../src/saved-auto-panel-store.ts')
  const root = await mkdtemp(join(tmpdir(), 'saved-panel-test-'))
  try {
    assert.deepEqual(await loadSavedAutoPanel(root, context), { status: 'missing' })
    await saveAutoPanelDefinition(root, snapshot(), context)
    assert.deepEqual(await readdir(root), ['saved-panels'])
    const path = join(root, 'saved-panels', 'inventory.json')
    const bytes = await readFile(path, 'utf8')
    assert.equal(bytes.includes('UNIQUE-SOURCE-CONTENT'), false)
    const reopened = await loadSavedAutoPanel(root, context)
    assert.equal(reopened.status, 'ready')
    assert.equal(reopened.sourceChanged, false)
    const updated = await loadSavedAutoPanel(root, { ...context, state: { items: {} } })
    assert.equal(updated.status, 'ready')
    assert.equal(updated.sourceChanged, true)
    assert.equal(await readFile(path, 'utf8'), bytes)
    await assert.rejects(() => saveAutoPanelDefinition(root, snapshot(), { ...context, bundle: '../escape' }), /invalid Bundle/)
    assert.deepEqual((await readdir(join(root, 'saved-panels'))).sort(), ['.owner', 'inventory.json'])
    await writeFile(path, '{broken')
    assert.equal((await loadSavedAutoPanel(root, context)).status, 'incompatible')
    assert.equal(await readFile(path, 'utf8'), '{broken')
    await writeFile(path, 'x'.repeat(262145))
    assert.match((await loadSavedAutoPanel(root, context)).reason, /size limit/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('converted DSL uses the same renderer for both locales, read-only/editable modes and updated bound data', async () => {
  const React = await import('../../panel/node_modules/react/index.js')
  globalThis.React = React
  const { renderToStaticMarkup } = await import('../../panel/node_modules/react-dom/server.js')
  const { renderManifest } = await import('../../panel/src/interpreter.ts')
  const before = snapshot()
  const original = before.messages[1].updateComponents.components[0].manifest
  const converted = parsePanelManifest(exportAutoPanelDsl(before, context))
  for (const locale of ['zh-CN', 'en']) {
    for (const editable of [false, true]) {
      for (const state of [context.state, { items: { first: { title: 'LATEST-BOUND-VALUE' } } }]) {
        const options = { locale, editable, onEdit: () => assert.fail('render must not write') }
        const expected = renderToStaticMarkup(renderManifest(original, state, options))
        const actual = renderToStaticMarkup(renderManifest(converted, state, options))
        assert.equal(actual, expected)
        assert.ok(actual.includes(state.items.first.title))
        if (editable) assert.match(actual, /<input/)
      }
    }
  }
})

test('retained definition refuses linked directory, file and state root without reading or changing external sentinel', async () => {
  const { mkdtemp, writeFile, readFile, mkdir, symlink, unlink, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { saveAutoPanelDefinition, loadSavedAutoPanel } = await import('../src/saved-auto-panel-store.ts')
  const sandbox = await mkdtemp(join(tmpdir(), 'saved-panel-links-'))
  const root = join(sandbox, 'root'), external = join(sandbox, 'external')
  try {
    await mkdir(root); await mkdir(external)
    const sentinel = join(external, 'inventory.json')
    const valid = JSON.stringify(preserveAutoPanelDefinition(snapshot(), context))
    await writeFile(sentinel, valid)
    await symlink(external, join(root, 'saved-panels'), 'dir')
    assert.match((await loadSavedAutoPanel(root, context)).reason, /not confined/)
    await assert.rejects(() => saveAutoPanelDefinition(root, snapshot(), context), /not confined/)
    assert.equal(await readFile(sentinel, 'utf8'), valid)
    await unlink(join(root, 'saved-panels')); await mkdir(join(root, 'saved-panels'))
    await symlink(sentinel, join(root, 'saved-panels', 'inventory.json'), 'file')
    assert.match((await loadSavedAutoPanel(root, context)).reason, /confined regular file/)
    await assert.rejects(() => saveAutoPanelDefinition(root, snapshot(), context), /confined regular file/)
    assert.equal(await readFile(sentinel, 'utf8'), valid)
    const alias = join(sandbox, 'alias'); await symlink(root, alias, 'dir')
    assert.match((await loadSavedAutoPanel(alias, context)).reason, /canonical directory/)
    await assert.rejects(() => saveAutoPanelDefinition(alias, snapshot(), context), /canonical directory/)
  } finally { await rm(sandbox, { recursive: true, force: true }) }
})

test('pre-existing user directory is refused without adopting or overwriting its contents', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, readdir, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { saveAutoPanelDefinition, loadSavedAutoPanel } = await import('../src/saved-auto-panel-store.ts')
  const root = await mkdtemp(join(tmpdir(), 'panel-user-directory-'))
  try {
    const directory = join(root, 'saved-panels')
    await mkdir(directory)
    await writeFile(join(directory, 'inventory.json'), 'user-owned')
    assert.match((await loadSavedAutoPanel(root, context)).reason, /ownership conflict/)
    await assert.rejects(() => saveAutoPanelDefinition(root, snapshot(), context), /ownership conflict/)
    assert.equal(await readFile(join(directory, 'inventory.json'), 'utf8'), 'user-owned')
    assert.deepEqual(await readdir(directory), ['inventory.json'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('retained definition is reusable with independent host caches, without importing host-local definitions', async () => {
  const { mkdtemp, mkdir, cp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { saveAutoPanelDefinition } = await import('../src/saved-auto-panel-store.ts')
  const { resolveAutoPanel } = await import('../src/auto-panel-resolution.ts')
  const root = await mkdtemp(join(tmpdir(), 'panel-host-roots-'))
  const project = join(root, 'project'), hostA = join(root, 'host-a'), hostB = join(root, 'host-b')
  try {
    await Promise.all([project, hostA, hostB].map(path => mkdir(path)))
    await saveAutoPanelDefinition(hostA, snapshot(), context)
    const rootsA = { definitionRoot: project, cacheRoot: hostA }
    const rootsB = { definitionRoot: project, cacheRoot: hostB }
    assert.equal((await resolveAutoPanel(rootsA, context)).status, 'needs-generation', 'do not silently import legacy host-local definitions')
    await saveAutoPanelDefinition(project, snapshot(), context)
    const a = await resolveAutoPanel(rootsA, context), b = await resolveAutoPanel(rootsB, context)
    assert.equal(a.origin, 'retained')
    assert.deepEqual(a, b, 'definition and revision must be independent of host cache availability')
    const relocated = join(root, 'relocated-project')
    await cp(project, relocated, { recursive: true })
    assert.deepEqual(await resolveAutoPanel({ definitionRoot: relocated, cacheRoot: hostB }, context), a,
      'copied project definitions cannot depend on the original absolute project path')
    assert.equal((await resolveAutoPanel({ definitionRoot: relocated, cacheRoot: hostB }, { ...context, kitVersion: '2.0' })).status,
      'incompatible', 'portability must not weaken the exact Kit version pin')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('host-neutral resolution prefers retained DSL and fences saves against source and definition changes', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { saveAutoPanelDefinition } = await import('../src/saved-auto-panel-store.ts')
  const { publishAutoPanelCache } = await import('../src/auto-panel-cache.ts')
  const { resolveAutoPanel, assertResolvedAutoPanelSave } = await import('../src/auto-panel-resolution.ts')
  const root = await mkdtemp(join(tmpdir(), 'panel-resolution-'))
  const roots = { definitionRoot: root, cacheRoot: root }
  try {
    assert.equal((await resolveAutoPanel(roots, context)).status, 'needs-generation')
    await publishAutoPanelCache(root, context, snapshot().messages)
    assert.equal((await resolveAutoPanel(roots, context)).origin, 'generated')
    await saveAutoPanelDefinition(root, snapshot(), context)
    const changed = { ...context, state: { items: { first: { title: 'Current value' } } } }
    const panel = await resolveAutoPanel(roots, changed)
    assert.equal(panel.origin, 'retained')
    assert.equal(panel.sourceChanged, true)
    const save = { roots, context: changed, before: changed.state, visibleState: changed.state,
      after: { items: { first: { title: 'Edited value' } } }, definitionRevision: panel.definitionRevision }
    await assert.doesNotReject(() => assertResolvedAutoPanelSave(save))
    await assert.rejects(() => assertResolvedAutoPanelSave({ ...save, before: context.state }), /source changed/)
    await assert.rejects(() => assertResolvedAutoPanelSave({ ...save, visibleState: context.state }), /source changed/)
    await assert.rejects(() => assertResolvedAutoPanelSave({ ...save, definitionRevision: 'obsolete' }), /definition changed/)
    await assert.rejects(() => assertResolvedAutoPanelSave({ ...save, after: { items: {} } }), /identities/)
    await writeFile(join(root, 'saved-panels', 'inventory.json'), '{broken')
    assert.equal((await resolveAutoPanel(roots, context)).status, 'incompatible', 'must not hide a broken retained definition behind valid cache')
    await assert.rejects(() => assertResolvedAutoPanelSave(save), /definition changed/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
