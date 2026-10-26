/** Implementation gate probes; no user project or installed Kit is changed. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runInNewContext } from 'node:vm'
const { register } = await import('tsx/esm/api'); register()
const { parseSchemaYaml, compileSchema } = await import('../src/schema.ts')
const { GitVersioning } = await import('../src/git.ts')
const { default: DesignService } = await import('../src/design-service.ts')
const { loadDesignKit } = await import('../src/kit-loader.ts')
const { readdir, stat, realpath } = await import('node:fs/promises')
const ts = await import('typescript')
const { parse, stringify } = await import('yaml')
const exec = promisify(execFile)
const schemaText = await readFile(new URL('./fixtures/function-modules-v1.schema.yaml', import.meta.url), 'utf8')
const oldSchema = parseSchemaYaml(schemaText)
const legacy = { functions: { 'F-1': { function_id: 'F-1', function_name: 'Search',
  function_description: 'Find literature', function_epic: 'Research', priority: 'High', rejected: false, source: 'user', reason: 'User need' } } }
const enriched = structuredClone(legacy)
enriched.functions['F-1'].details = { behaviors: { 'B-1': { description: 'Find the source of a claim' } } }
enriched.functions['F-1'].references = { 'R-1': { file: 'smart_questions/smart_questions.json', pointer: '/questions/q1/answer', revision: 'a'.repeat(40) } }

test('a closed old schema accepts old cards and rejects new per-function fields', () => {
  assert.deepEqual(compileSchema(oldSchema)(legacy), [])
  assert.ok(compileSchema(oldSchema)(enriched).some(error => error.includes('details')))
  assert.ok(compileSchema(oldSchema)(enriched).some(error => error.includes('references')))
  // Separate validator instances are required: optional fields in a NEW schema
  // do not teach the installed OLD validator to accept those fields.
  const proposed = structuredClone(oldSchema)
  proposed.properties.functions.value.properties.details = { type: 'object', additional_properties: false,
    properties: { behaviors: { type: 'map', value: { type: 'object', additional_properties: false,
      required: ['description'], properties: { description: { type: 'string' } } } } } }
  proposed.properties.functions.value.properties.references = { type: 'map', value: { type: 'object', additional_properties: false,
    required: ['file', 'pointer', 'revision'], properties: { file: { type: 'string' }, pointer: { type: 'string' }, revision: { type: 'string' } } } }
  assert.deepEqual(compileSchema(proposed)(legacy), [])
  assert.deepEqual(compileSchema(proposed)(enriched), [])
  const malformed = structuredClone(enriched)
  malformed.functions['F-1'].details.behaviors['B-1'].approved = true
  assert.ok(compileSchema(proposed)(malformed).some(error => error.includes('approved')))
})

test('real registry selects the project pin, not latest; old versions are only process-local', async () => {
  const fs = { readText: async path => { try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
    listDir: path => readdir(path), isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath }
  const root = new URL('../../skills-web-app/', import.meta.url).pathname
  const options = { sourceId: 'package:dsh-design-skills-web-app' }
  const candidate = await loadDesignKit(fs, root, options)
  // Replay the frozen old contract through the actual loader, not the new
  // source relabelled as an old version. This fixture never changes a Kit pin.
  const legacyFs = { ...fs, readText: async path => {
    const text = await fs.readText(path)
    if (path.endsWith('/function_modules/schema.yaml')) return schemaText
    // Distinct fixture-only pins prove registry behavior. Production manifest
    // pins remain untouched by this source projection; fixtures are not live upgrades.
    if (path.endsWith('/mindset.md')) return text?.replace('version: "1.1"', 'version: "0.0"')
    if (path.endsWith('/function_modules/skill.yaml')) return text?.replace('version: "1.0"', 'version: "0.0"')
    if (path.endsWith('/kits/web_app/kit.yaml')) return text?.replace(/(name: function_modules\n\s+version:) "1.0"/, '$1 "0.0"')
    if (path.endsWith('/function_modules/panel.yaml')) {
      // Freeze a coherent overview-only old Panel alongside the closed v1 schema;
      // using a new detail declaration against the old schema is not an old pin.
      const panel = parse(text)
      panel.sections = panel.sections.filter(section => section.id !== 'function_details')
      panel.fields = panel.fields.filter(field => !field.applies_to?.includes('function_details') && field.key !== 'references')
      panel.ui.board.detail_fields = ['reason']
      delete panel.ui.board.detail_sections
      return stringify(panel)
    }
    return text
  } }
  const kit = await loadDesignKit(legacyFs, root, options)
  const functionSkill = kit.skills.find(skill => skill.name === 'function_modules')
  assert.ok(functionSkill)
  assert.equal(kit.version, '0.0'); assert.equal(candidate.version, '1.1')
  // The real registry and project-selection methods; driver installation is
  // outside this pin probe, hence only that independent check is stubbed.
  const create = () => { const design = Object.create(DesignService.prototype)
    design.kits = new Map(); design.activeWorkspaces = new WeakMap(); design.assertKitInstallable = () => {}; return design }
  const design = create(), agent = {}
  const publisher = design.registerKitSource(kit)
  publisher.publish(candidate)
  design.activeWorkspaces.set(agent, { project: { kit: { name: kit.name, version: kit.version } } })
  const pinned = design.requireKitForAgent(agent).skills.find(skill => skill.name === 'function_modules')
  assert.equal(pinned, functionSkill)
  assert.equal(design.latestKit(kit.name), candidate)
  assert.ok(compileSchema(pinned.metadata.schemaDocument)(enriched).some(error => error.includes('details')))
  design.activeWorkspaces.set(agent, { project: { kit: { name: kit.name, version: candidate.version } } })
  const withDetails = structuredClone(legacy); withDetails.functions['F-1'].details = enriched.functions['F-1'].details
  assert.deepEqual(compileSchema(design.requireKitForAgent(agent).skills.find(skill => skill.name === 'function_modules').metadata.schemaDocument)(withDetails), [])
  publisher.dispose()
  const restarted = create(); restarted.registerKitSource(candidate)
  assert.equal(restarted.resolveKit({ kit: kit.name, version: kit.version }), undefined, 'restart does not retain old Kit contracts on disk')
  restarted.activeWorkspaces.set(agent, { project: { kit: { name: kit.name, version: kit.version } } })
  assert.throws(() => restarted.requireKitForAgent(agent), /explicit upgrade/)
})

test('real provider adapter preserves nested fields through overview edits and JSON round-trip', async () => {
  const source = await readFile(new URL('../../provider-web-app/src/client/panels/function-modules.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('function stateToPanel(')
  const end = source.indexOf('/** The panel body:')
  assert.ok(start > 0 && end > start)
  // Compile the actual pure adapter bodies, not a handwritten imitation.
  const { outputText } = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
  const adapter = runInNewContext(`${outputText}; ({stateToPanel, panelToState})`, { Map, PANEL_ID: 'function_modules', isRecord: value => value !== null && typeof value === 'object' && !Array.isArray(value) })
  const panel = adapter.stateToPanel(enriched, 'Functions')
  panel.modules[0].function_modules[0].function_name = 'Renamed search'
  panel.modules[0].function_modules[0].rejected = true
  const saved = JSON.parse(JSON.stringify(adapter.panelToState(panel, enriched)))
  assert.equal(saved.functions['F-1'].function_name, 'Renamed search')
  assert.equal(saved.functions['F-1'].rejected, true)
  assert.deepEqual(saved.functions['F-1'].details, enriched.functions['F-1'].details)
  assert.deepEqual(saved.functions['F-1'].references, enriched.functions['F-1'].references)
  assert.deepEqual(enriched.functions['F-1'].function_name, 'Search', 'editing the projection must not mutate its input')
})

test('real Git reads preserve historical values after map/order and object-array changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'design-detail-probe-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (...args) => exec('git', args, { cwd: root })
  await git('init', '-q')
  const path = 'source.json'
  const initial = { records: { p1: { id: 'p1', name: 'First' }, p2: { id: 'p2', name: 'Second' } },
    order: ['p1', 'p2'], anonymous: [{ text: 'A' }, { text: 'B' }], identified: [{ id: 'x', text: 'X' }, { id: 'y', text: 'Y' }] }
  await writeFile(join(root, path), JSON.stringify(initial))
  await git('add', '--', path)
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial')
  const before = (await git('rev-parse', 'HEAD')).stdout.trim()
  const changed = structuredClone(initial)
  changed.order.reverse(); changed.anonymous.reverse(); changed.identified.reverse()
  changed.records.p1.name = 'Renamed'
  await writeFile(join(root, path), JSON.stringify(changed))
  await git('add', '--', path)
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'reorder')
  const after = (await git('rev-parse', 'HEAD')).stdout.trim()
  const store = new GitVersioning(async ({ argv, cwd, signal, env }) => {
    try { const result = await exec(argv[0], argv.slice(1), { cwd, signal, env: { ...process.env, ...env } }); return { exitCode: 0, ...result } }
    catch (error) { return { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } }
  }, root)
  assert.deepEqual(JSON.parse(await store.readTextAt(before, path)), initial)
  const current = JSON.parse(await store.readTextAt(after, path))
  assert.equal(current.records.p1.id, 'p1', 'map identity survives display rename and order change')
  assert.equal(current.anonymous[0].text, 'B', 'an old positional pointer would now target a different object')
  assert.equal(current.identified.find(record => record.id === 'x').text, 'X', 'identity lookup, not index, is necessary for arrays')
  assert.equal(await store.readTextAt(before, 'absent.json'), undefined)
  await assert.rejects(store.readTextAt(before, '../source.json'), /unsafe|path/i)
  await assert.rejects(store.readTextAt('HEAD', path), /commit/i)
})
