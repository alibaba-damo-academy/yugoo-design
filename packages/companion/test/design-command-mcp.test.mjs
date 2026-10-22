import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createDesignMcp } from '../src/mcp.mjs'
import { PANEL_COMPONENT_CATALOG, GENERATED_COMPONENT_KINDS } from '../../core/src/panel-component-catalog.ts'
import { exportPanelAuthoringReference } from '../../../.agents/skills/design-bundle-creator/scripts/inspect-panel-component.mjs'

test('installed authoring queries use packaged data, require exact names and reject missing or incompatible materials', async () => {
  let material = await exportPanelAuthoringReference(fileURLToPath(new URL('../../../', import.meta.url)))
  const server = createDesignMcp({ loadAuthoringReference: async () => material })
  const client = new Client({ name: 'authoring-reference-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport); await client.connect(clientTransport)
    const call = arguments_ => client.callTool({ name: 'design_list_panel_components', arguments: arguments_ })
    const focused = await call({ name: 'navigation_workspace', reference: 'contract', type: 'ComponentNode.navigation_map.edges' })
    assert.ok(!focused.isError)
    assert.match(JSON.parse(focused.content[0].text).contract.declaration, /hotspot_label/)
    const overview = JSON.parse((await call({ name: 'record_form', reference: 'contract' })).content[0].text)
    const next = await call(overview.contracts[0].read)
    assert.ok(!next.isError, 'installed reference hints must be directly usable as tool arguments, not source CLI flags')
    const docs = JSON.parse((await call({ name: 'record_form', reference: 'docs' })).content[0].text)
    assert.ok(!(await call(docs.documentation.read)).isError, 'documentation followup uses the installed tool rather than --docs')
    for (const reference of ['contract', 'docs', 'examples']) assert.ok(!(await call({ name: 'stack', reference })).isError)
    for (const args of [{ reference: 'docs' }, { name: '__proto__', reference: 'docs' },
      { name: 'stack', type: 'ComponentNode' }, { name: 'stack', reference: 'docs', type: 'ComponentNode' },
      { name: 'stack', reference: 'contract', type: 'ComponentNode.constructor' }]) assert.equal((await call(args)).isError, true)
    material = { ...material, catalogIdentity: 'stale' }
    assert.equal((await call({ name: 'stack', reference: 'docs' })).isError, true)
    material = undefined
    assert.equal((await call({ name: 'stack', reference: 'contract' })).isError, true)
    assert.ok(!(await call({})).isError, 'vocabulary discovery remains available without reference material')
  } finally { await client.close(); await server.close() }
})

test('component discovery uses the actual Core vocabulary without a project or connection', async () => {
  const server = createDesignMcp()
  const client = new Client({ name: 'component-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const tool = (await client.listTools()).tools.find(item => item.name === 'design_list_panel_components')
    assert.ok(tool)
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.equal(tool.inputSchema.properties.connection, undefined)
    const call = arguments_ => client.callTool({ name: tool.name, arguments: arguments_ })
    const response = await call({})
    assert.ok(!response.isError)
    const result = JSON.parse(response.content[0].text)
    assert.match(result.contract, /not a complete parameter schema/)
    assert.deepEqual(result.components.map(item => item.name), Object.keys(PANEL_COMPONENT_CATALOG))
    for (const item of result.components) {
      const entry = PANEL_COMPONENT_CATALOG[item.name]
      assert.equal(item.description, entry.description)
      assert.equal(item.sourceBound, entry.sourceBound === true)
      assert.equal(item.ownsWorkspace, entry.ownsWorkspace === true)
      assert.equal(item.generated, GENERATED_COMPONENT_KINDS.includes(item.name))
    }
    const filtered = JSON.parse((await call({ name: 'question_workspace' })).content[0].text)
    assert.deepEqual(filtered.components, result.components.filter(item => item.name === 'question_workspace'))
    for (const name of ['unknown_component', '__proto__', 'constructor', 'toString']) {
      assert.equal((await call({ name })).isError, true)
    }
    assert.equal((await call({ connection: '/not-a-project' })).isError, true)
  } finally { await client.close(); await server.close() }
})

test('project MCP works without Panel and shares CLI selection across all native hosts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-command-mcp-'))
  const server = createDesignMcp({ commandOptions: {
    projectsRoot: join(root, 'projects'), stateRoot: join(root, 'state'),
    kitRoot: fileURLToPath(new URL('../../skills-web-app/', import.meta.url)),
  } })
  const client = new Client({ name: 'command-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const tool = (await client.listTools()).tools.find(item => item.name === 'design_command')
    assert.ok(tool)
    assert.equal(tool.inputSchema.properties.connection, undefined)
    const session = '00000000-0000-4000-8000-000000000001'
    assert.ok(tool.inputSchema.properties.action.enum.includes('compose_spec'))
    assert.ok(tool.inputSchema.properties.action.enum.includes('kit'))
    assert.ok(tool.inputSchema.properties.action.enum.includes('mindset'))
    assert.ok(tool.inputSchema.properties.action.enum.includes('migrate'))
    assert.ok(!tool.inputSchema.properties.action.enum.includes('recover'))
    assert.match(tool.description, /migrate/)
    for (const host of ['codex', 'claude-code', 'qoder', 'qwenwork', 'workbuddy']) {
      const run = async (action, argument, threadId = session) => {
        const value = await client.callTool({ name: 'design_command', arguments: { host, threadId, action, ...(argument ? { argument } : {}) } })
        assert.ok(!value.isError, JSON.stringify(value))
        return JSON.parse(value.content[0].text)
      }
      assert.equal((await run('status')).selected, undefined)
      const created = await run('new', `${host} 科研平台`)
      assert.equal(created.panelRestartRequired, true)
      const listBeforeMigration = (await run('list')).text
      const missingKit = await client.callTool({ name: 'design_command', arguments: { host, threadId: session, action: 'migrate', argument: created.selected.root } })
      assert.equal(missingKit.isError, true)
      assert.match(missingKit.content[0].text, /Select a Kit before migration/)
      assert.equal((await run('list')).text, listBeforeMigration, 'missing Kit cannot create a target')
      const selected = await run('kit', 'web_app')
      assert.equal(selected.selected.projectId, created.selected.projectId)
      assert.equal(selected.selected.kit.name, 'web_app')
      const legacy = await run('mindset', 'web_app')
      assert.deepEqual(legacy.selected.kit, selected.selected.kit, 'legacy spelling preserves the exact Kit pin')
      assert.equal(legacy.panelRestartRequired, false)
      const composed = await run('compose_spec', 'Activity browsing')
      assert.match(composed.conversationPrompt, /Activity browsing/)
      assert.match(composed.text, /尚未生成或写入 Spec/)
      assert.equal(composed.panelRestartRequired, false)
      assert.equal(composed.selected.projectId, created.selected.projectId)
      assert.equal((await run('status', undefined, '00000000-0000-4000-8000-000000000002')).selected, undefined)
      assert.equal((await run('close')).selected, undefined)
      assert.equal((await run('open', created.selected.projectId)).selected.projectId, created.selected.projectId)
      const sourceFile = join(created.selected.root, 'design_files/smart_questions/smart_questions.json')
      const sourceBytes = JSON.stringify({ questions: { goal: { prompt: 'Goal?', kind: 'text', answer: 'Preserve source', detail: '' } } }) + '\n'
      await mkdir(join(created.selected.root, 'design_files/smart_questions'), { recursive: true })
      await writeFile(sourceFile, sourceBytes)
      const sourceMetadata = await readFile(join(created.selected.root, 'project.json'), 'utf8')
      const rejected = await client.callTool({ name: 'design_command', arguments: { host, threadId: session, action: 'recover', argument: created.selected.root } })
      assert.equal(rejected.isError, true, 'removed action must be rejected by the public MCP schema')
      assert.equal((await run('status')).selected.projectId, created.selected.projectId)
      const migrated = await run('migrate', created.selected.root)
      assert.equal(migrated.kind, 'success')
      assert.equal(migrated.panelRestartRequired, true)
      assert.notEqual(migrated.selected.projectId, created.selected.projectId)
      assert.notEqual(migrated.selected.root, created.selected.root)
      assert.deepEqual(migrated.selected.kit, selected.selected.kit)
      assert.ok(migrated.conversationPrompt.includes(created.selected.root))
      assert.match(migrated.conversationPrompt, /smart_questions/)
      assert.equal(await readFile(join(migrated.selected.root, 'design_files/smart_questions/smart_questions.json'), 'utf8'), sourceBytes)
      assert.equal(await readFile(sourceFile, 'utf8'), sourceBytes)
      assert.equal(await readFile(join(created.selected.root, 'project.json'), 'utf8'), sourceMetadata)
      assert.equal((await run('status')).selected.projectId, migrated.selected.projectId)
      assert.equal((await run('status', undefined, '00000000-0000-4000-8000-000000000002')).selected, undefined)
    }
    const invalid = await client.callTool({ name: 'design_command', arguments: { host: 'codex', threadId: session, action: 'new' } })
    assert.equal(invalid.isError, true)
  } finally {
    await client.close(); await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
