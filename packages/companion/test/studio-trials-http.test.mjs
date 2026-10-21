/** Real HTTP and isolated project/server lifecycle, with a fixture native queue. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createDesignMcp } from '../src/mcp.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { startCompanion } from '../src/server.mjs'

test('embedding startup rejects non-owned services and noncanonical parent origins before effects', async () => {
  await assert.rejects(startCompanion({ studioTrial: true, trialInput: { locale: 'fr-FR' } }), /locale binding/)
  await assert.rejects(startCompanion({ trialEmbedOrigin: 'http://127.0.0.1:1234' }), /owned child/)
  await assert.rejects(startCompanion({ studioTrial: true, trialEmbedOrigin: 'http://127.0.0.1:1234' }), /owned child/)
  for (const origin of ['https://example.com', 'http://localhost:1234', 'http://127.0.0.1:1234/', 'http://127.0.0.1:1234/?x=1', 'http://user:secret@127.0.0.1:1234', 'http://127.0.0.1:1234\r\nX:bad', 'null']) {
    await assert.rejects(startCompanion({ studioTrial: true, trialInput: {}, trialEmbedOrigin: origin }), /embedding|owned child/, origin)
  }
})

test('Studio trial RPC dispatches the isolated binding, not the source project', async () => {
  const f = await fixture()
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const original = await readFile(join(f.options.projectRoot, 'project.json'), 'utf8')
    const catalog = await call('studioWorkspace', { query: '' })
    const kit = catalog.kits[0]
    const source = { kind: 'installed', kit: { name: kit.name, version: kit.version }, bundle: { name: 'business_rules', version: '1.0' } }
    await assert.rejects(call('studioTrialStart', { source, locale: 'zh' }), /locale/)
    assert.equal(f.messages.length, 0)
    assert.deepEqual(await call('studioTrialAvailability'), { status: 'unknown' }, 'configured identity alone is not a connection check')
    assert.equal(f.messages.length, 0, 'availability does not dispatch a native turn')
    assert.deepEqual(await call('studioTrialList'), [])
    const task = '  Test only the isolated Bundle.\r\n 保留原文。  '
    const result = await call('studioTrialStart', { source, locale: 'zh-CN', task })
    assert.equal(result.locale, 'zh-CN'); assert.equal(result.task, task)
    assert.equal(result.status, 'queued', JSON.stringify(result))
    assert.notEqual(new URL(result.resultUrl).origin, f.server.origin)
    assert.equal(f.messages.length, 1)
    assert.match(f.messages[0], /Trial output language: zh-CN \(Simplified Chinese\)/)
    assert.match(f.messages[0], /studio-trials/)
    assert.match(f.messages[0], new RegExp(result.id))
    assert.equal(await readFile(join(f.options.projectRoot, 'project.json'), 'utf8'), original)
    assert.equal((await call('studioTrialRead', { id: result.id })).status, 'unknown')
    assert.equal((await call('studioTrialList')).length, 1)
    await assert.rejects(call('studioTrialRemove', { id: result.id }), /unverified/)
    const url = new URL(result.resultUrl)
    assert.equal((await call('info')).trialPanel, undefined, 'ordinary workspace exposes no trial binding')
    const childInfo = await fetch(`${url.origin}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url.origin, 'X-Design-Token': url.hash.slice(1) }, body: JSON.stringify({ method: 'info' }) })
    assert.equal(childInfo.status, 200)
    assert.deepEqual((await childInfo.json()).trialPanel, { trialId: result.id, parentOrigin: f.server.origin, locale: 'zh-CN' })
    const embedded = await fetch(`${url.origin}/?view=trial-panel`)
    assert.equal(embedded.headers.get('x-frame-options'), null)
    assert.equal(embedded.headers.get('content-security-policy'), `frame-ancestors ${f.server.origin}`)
    for (const path of ['/', '/?view=studio', '/index.html?view=trial-panel', '/?view=trial-panel&extra=1', '/?view=trial-panel&view=studio', '/client.js?view=trial-panel']) {
      assert.equal((await fetch(`${url.origin}${path}`)).headers.get('x-frame-options'), 'DENY', path)
    }
    assert.equal((await fetch(`${f.server.origin}/?view=trial-panel`)).headers.get('x-frame-options'), 'DENY', 'parent cannot opt in using a query')
    const crossOrigin = await fetch(`${url.origin}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.server.origin, 'X-Design-Token': url.hash.slice(1) }, body: JSON.stringify({ method: 'info' }) })
    assert.equal(crossOrigin.status, 403, 'embedding does not permit parent-origin API calls')
    const opaqueOrigin = await fetch(`${url.origin}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'null', 'X-Design-Token': url.hash.slice(1) }, body: JSON.stringify({ method: 'info' }) })
    assert.equal(opaqueOrigin.status, 403)
    const nested = await fetch(`${url.origin}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url.origin, 'X-Design-Token': url.hash.slice(1) }, body: JSON.stringify({ method: 'studioTrialList', params: {} }) })
    assert.equal(nested.ok, false)
    assert.match((await nested.json()).error, /Nested Studio trials/)
    const childAvailability = await fetch(`${url.origin}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url.origin, 'X-Design-Token': url.hash.slice(1) }, body: JSON.stringify({ method: 'studioTrialAvailability' }) })
    assert.deepEqual(await childAvailability.json(), { status: 'unavailable' })
  } finally { await f.close() }
})

test('Studio availability reports only an explicit transport probe, without dispatching or leaking failures', async () => {
  let probes = 0, sends = 0, response = { status: 'available' }
  const f = await fixture({ serverOptions: { connection: {
    threadId: '00000000-0000-4000-8000-000000000001',
    async probe() { probes++; if (response instanceof Error) throw response; return response },
    async send() { sends++; throw new Error('Unexpected dispatch') },
  } } })
  const call = () => callCompanion(f.server.connectionPath, { method: 'studioTrialAvailability' })
  try {
    assert.deepEqual(await call(), { status: 'available' })
    response = { status: 'unsupported', secret: 'private' }
    assert.deepEqual(await call(), { status: 'unknown' })
    response = new Error('private host token')
    assert.deepEqual(await call(), { status: 'unavailable' })
    assert.equal(probes, 3); assert.equal(sends, 0)
    assert.deepEqual(await callCompanion(f.server.connectionPath, { method: 'studioTrialList' }), [])
  } finally { await f.close() }
})

test('actual MCP/HTTP receipt belongs only to the owned child and unlocks execution once', async () => {
  const f = await fixture({ researchMode: 'main' })
  const server = createDesignMcp(), client = new Client({ name: 'trial-input-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const call = (method, params = {}, connection = f.server.connectionPath) => callCompanion(connection, { method, params })
  try {
    await server.connect(serverTransport); await client.connect(clientTransport)
    const tool = (await client.listTools()).tools.find(item => item.name === 'design_submit_trial_input')
    assert.ok(tool)
    assert.deepEqual(tool.inputSchema.required.sort(), ['connection', 'task', 'trialId'])
    assert.equal(tool.inputSchema.additionalProperties, false)
    const catalog = await call('studioWorkspace', { query: '' }), kit = catalog.kits[0]
    const result = await call('studioTrialStart', { source: { kind: 'installed', kit: { name: kit.name, version: kit.version }, bundle: { name: 'research', version: '1.0' } }, locale: 'en-US' })
    assert.equal(result.status, 'preparing')
    assert.equal(result.locale, 'en-US')
    assert.match(f.messages[0], /Trial output language: en-US \(English\)/)
    const connections = join(f.options.stateRoot, 'studio-trials', result.id, 'runtime', 'connections')
    const childConnection = join(connections, (await readdir(connections))[0])
    assert.equal((await call('info', {}, childConnection)).trialPanel.locale, 'en-US')
    const task = 'research: compare synthetic approval strategies using explicitly identified evidence.'
    const receipt = connection => client.callTool({ name: tool.name, arguments: { connection, trialId: result.id, task } })
    assert.equal((await receipt(f.server.connectionPath)).isError, true, 'ordinary parent cannot submit')
    await assert.rejects(call('beginMainBundle', { skill: 'research' }, childConnection), /Record generated/)
    await assert.rejects(call('registerNativeRun', { skill: 'research' }, childConnection), /Record generated/)
    assert.equal((await call('prepareBundle', { skill: 'research' }, childConnection)).execution.mode, 'main')
    const response = await receipt(childConnection)
    assert.ok(!response.isError, JSON.stringify(response))
    assert.equal(JSON.parse(response.content[0].text).task, task)
    assert.equal(JSON.parse(response.content[0].text).locale, 'en-US')
    assert.equal((await call('studioTrialRead', { id: result.id })).task, task)
    assert.equal((await receipt(childConnection)).isError, true, 'one-time receipt rejects a duplicate')
    assert.ok((await call('beginMainBundle', { skill: 'research' }, childConnection)).invocationId)
    await assert.rejects(call('beginMainBundle', { skill: 'smart_questions' }, childConnection), /bound trial/)
    assert.equal(f.messages.length, 1, 'receipt does not send a second native prompt')
    assert.notEqual((await call('studioTrialRead', { id: result.id })).status, 'completed')
  } finally { await client.close(); await server.close(); await f.close() }
})
