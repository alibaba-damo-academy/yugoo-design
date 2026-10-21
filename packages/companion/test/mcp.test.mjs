import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fixture, threadId } from './fixture.mjs'

test('source MCP native binding schema explains host IDs, child paths and Codex-only launch references', async () => {
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
  const { createDesignMcp } = await import('../src/mcp.mjs')
  const server = createDesignMcp()
  const client = new Client({ name: 'native-binding-contract-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    const { tools } = await client.listTools()
    const properties = tools.find(tool => tool.name === 'design_register_run').inputSchema.properties
    assert.match(properties.runId.description, /Actual native child ID/)
    assert.match(properties.runId.description, /WorkBuddy: agent-/)
    assert.match(properties.runId.description, /Never a custom task name/)
    assert.match(properties.parentRunId.description, /real Producer parent ID/)
    assert.match(properties.transcriptPath.description, /Exact child transcript path, never the parent\/main transcript/)
    assert.match(properties.taskPath.description, /Qoder or QwenWork only/)
    assert.match(properties.taskPath.description, /Omit for WorkBuddy/)
    for (const field of ['launchCallId', 'agentPath']) {
      assert.match(properties[field].description, /Codex only/)
      assert.match(properties[field].description, /Other hosts must omit this/)
      assert.match(properties[field].description, /actual native child runId/)
    }
    const reviewProperties = tools.find(tool => tool.name === 'design_bind_review').inputSchema.properties.nativeRun.properties
    for (const field of ['runId', 'parentRunId', 'transcriptPath', 'taskPath', 'launchCallId', 'agentPath']) {
      assert.equal(reviewProperties[field].description, properties[field].description)
    }
    const batchProperties = tools.find(tool => tool.name === 'design_bind_reviews').inputSchema.properties.bindings.items.properties.nativeRun.properties
    assert.equal(batchProperties.launchCallId.description, properties.launchCallId.description)
    assert.equal(batchProperties.agentPath.description, properties.agentPath.description)
  } finally {
    await client.close()
    await server.close()
  }
})

test('packaged stdio MCP exposes explicit tools and preserves existing per-project/native identity validation', async () => {
  const f = await fixture(), other = await fixture()
  const client = new Client({ name: 'design-bridge-test', version: '1' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('packages/companion/dist-server/design.mjs'), 'mcp'], stderr: 'pipe' })
  const call = (name, args = {}, connection = f.server.connectionPath) => client.callTool({ name, arguments: { connection, ...args } })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert.equal(tools.length, 41)
    const catalogTool = tools.find(tool => tool.name === 'design_list_panel_components')
    assert.ok(catalogTool)
    assert.equal(catalogTool.annotations.readOnlyHint, true)
    assert.equal(catalogTool.inputSchema.properties.connection, undefined)
    const catalogResponse = await client.callTool({ name: catalogTool.name, arguments: {} })
    assert.ok(!catalogResponse.isError, JSON.stringify(catalogResponse))
    const catalog = JSON.parse(catalogResponse.content[0].text)
    assert.ok(catalog.components.length > 0)
    assert.match(catalog.contract, /not a complete parameter schema/)
    const firstComponent = catalog.components[0]
    assert.equal(typeof firstComponent.description, 'string')
    for (const flag of ['sourceBound', 'ownsWorkspace', 'generated']) assert.equal(typeof firstComponent[flag], 'boolean')
    const filteredCatalog = await client.callTool({ name: catalogTool.name, arguments: { name: firstComponent.name } })
    assert.deepEqual(JSON.parse(filteredCatalog.content[0].text).components, [firstComponent])
    assert.equal((await client.callTool({ name: catalogTool.name, arguments: { name: '__proto__' } })).isError, true)
    assert.ok(tools.some(tool => tool.name === 'design_query_knowledge'))
    assert.ok(tools.some(tool => tool.name === 'design_knowledge_status'))
    assert.ok(tools.some(tool => tool.name === 'design_refresh_knowledge'))
    assert.equal(tools.find(tool => tool.name === 'design_knowledge_status').annotations.readOnlyHint, true)
    assert.notEqual(tools.find(tool => tool.name === 'design_refresh_knowledge').annotations.readOnlyHint, true)
    const knowledgeSchema = tools.find(tool => tool.name === 'design_query_knowledge').inputSchema
    assert.equal(knowledgeSchema.properties.designRoles, undefined)
    for (const name of ['relationMeanings', 'relationOrigins', 'ontologyTypes', 'recordKinds', 'identityQualities']) {
      assert.equal(knowledgeSchema.properties[name].type, 'array')
      assert.equal(knowledgeSchema.required.includes(name), false)
    }
    assert.ok(tools.some(tool => tool.name === 'design_knowledge_context'))
    assert.ok(tools.some(tool => tool.name === 'design_begin_main_bundle'))
    assert.ok(tools.some(tool => tool.name === 'design_finish_main_bundle'))
    for (const tool of tools) {
      if (!['design_command', 'design_list_panel_components'].includes(tool.name)) assert.ok(tool.inputSchema.required.includes('connection'))
      assert.equal(tool.inputSchema.additionalProperties, false)
    }
    assert.ok(!tools.some(tool => /spawn|write_file|accept|send_prompt/.test(tool.name)))
    const prepared = await call('design_prepare_bundle', { skill: 'smart_questions' })
    assert.ok(!prepared.isError, JSON.stringify(prepared))
    assert.match(prepared.content[0].text, /smart_questions/)
    const guidance = JSON.parse(prepared.content[0].text)
    assert.match(guidance.cooperationMethod, /bounded assignment/)
    assert.match(guidance.workerMethod, /smallest relevant source record/)
    assert.match(guidance.knowledgeMethod, /ordinary generation and revision/)
    assert.equal(JSON.parse(prepared.content[0].text).execution.mode, 'subagent')
    assert.equal((await call('design_begin_main_bundle', { skill: 'smart_questions' })).isError, true, 'cannot silently replace configured Producer execution')
    assert.equal((await call('design_prepare_bundle', {})).isError, true)
    const runId = '00000000-0000-4000-8000-000000000029', transcriptPath = join(f.root, 'child.jsonl')
    await writeFile(transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: runId, cwd: f.options.projectRoot, source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n')
    const child = { runId, parentRunId: threadId, transcriptPath, role: 'producer', skill: 'smart_questions', artifactId: 'smart_questions' }
    assert.ok(!(await call('design_register_run', child)).isError)
    assert.equal((await call('design_register_run', child, other.server.connectionPath)).isError, true)
    const status = JSON.parse((await call('design_status')).content[0].text)
    assert.equal(status.executionAttempts.length, 1)
    assert.equal(status.design, undefined)
    assert.equal(status.reviews.length, 4)
    assert.equal(status.reviewDispatchOwner, 'main')
    const review = JSON.parse((await call('design_prepare_review', { profile: 'alignment', userContext: '先展示原型，暂缓细节' })).content[0].text)
    assert.match(review.prompt, /先展示原型，暂缓细节/)
    const batch=JSON.parse((await call('design_prepare_reviews', {profiles:['reflection','clarity']})).content[0].text)
    assert.equal(batch.requests.length,2)
    assert.ok(batch.requests.every(item=>item.dispatch && !item.prompt && !item.schema))
    const full=await call('design_read_review',{reviewId:batch.requests[0].reviewId})
    assert.ok(JSON.parse(full.content[0].text).schema)
    assert.equal((await call('design_read_review',{reviewId:batch.requests[0].reviewId},other.server.connectionPath)).isError,true)
    assert.equal((await call('design_prepare_review', { profile: 'alignment', userContext: 'x'.repeat(8193) })).isError, true)
    assert.equal(JSON.parse((await call('design_status', {}, other.server.connectionPath)).content[0].text).executionAttempts.length, 0)
    assert.equal((await call('design_finish_run', { runId })).isError, true, 'missing canonical file must still fail shared settlement')
    const malformed = join(f.root, 'malformed.json'), secret = 'a'.repeat(64)
    await writeFile(malformed, '{"token":"' + secret + '",broken}')
    const bad = await call('design_status', {}, malformed)
    assert.equal(bad.isError, true)
    assert.ok(!JSON.stringify(bad).includes(secret))
    assert.equal(f.messages.length + other.messages.length, 0)
  } finally { await client.close(); await transport.close(); await f.close(); await other.close() }
})
