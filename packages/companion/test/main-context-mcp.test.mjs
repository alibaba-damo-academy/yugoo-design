/** Real MCP/API transport with synthetic responses; no native execution claims. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createDesignMcp } from '../src/mcp.mjs'

test('MCP exposes actual main assessment routes and preserves background capability status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'main-context-mcp-')), calls = []
  const api = createServer(async (request, response) => {
    const parts = []; for await (const part of request) parts.push(part)
    const value = JSON.parse(Buffer.concat(parts)); calls.push(value)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(value.method === 'readWorkspace'
      ? { hostCapabilities: { backgroundReviews: false, backgroundReviewReadiness: 'unverified',
          backgroundReviewProtocol: { state: 'unverified', canAttemptReadiness: false, proof: 'Full host-specific proof contract' } },
          design: { large: 'Not routine model status' }, projectId: 'fixture-project', checkpoint: 'fixture-checkpoint' }
      : { received: value.method, input: value.params.input }))
  })
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  const connection = join(root, 'private.json')
  await writeFile(connection, JSON.stringify({ origin: `http://127.0.0.1:${api.address().port}`, token: 'a'.repeat(64) }))
  const mcp = createDesignMcp(), client = new Client({ name: 'main-context-fixture', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)])
    const { tools } = await client.listTools()
    assert.equal(tools.find(tool => tool.name === 'design_main_context').annotations.readOnlyHint, true)
    assert.notEqual(tools.find(tool => tool.name === 'report_design_clarity').annotations.readOnlyHint, true)
    const call = (name, args = {}) => client.callTool({ name, arguments: { connection, ...args } })
    const status = JSON.parse((await call('design_status')).content[0].text)
    assert.equal(status.hostCapabilities.backgroundReviews, false)
    assert.equal(status.hostCapabilities.backgroundReviewReadiness, 'unverified')
    assert.equal(status.hostCapabilities.backgroundReviewProtocol.canAttemptReadiness, false)
    assert.equal(status.hostCapabilities.backgroundReviewProtocol.proof, undefined)
    assert.equal(status.projectId, 'fixture-project')
    assert.equal(status.design, undefined)
    assert.deepEqual(calls.at(-1).params, { includeServices: true, includeConversation: false })
    const detailed = JSON.parse((await call('design_status', { details: true })).content[0].text)
    assert.equal(detailed.hostCapabilities.backgroundReviewProtocol.proof, 'Full host-specific proof contract')
    assert.equal(detailed.design.large, 'Not routine model status')
    assert.equal(calls.at(-1).params.details, undefined, 'details controls only the model transport projection')
    assert.equal(JSON.parse((await call('design_main_context')).content[0].text).received, 'mainContext')
    const input = { projectId: randomUUID(), assessedCheckpoint: 'b'.repeat(40), kitContentHash: 'c'.repeat(64) }
    const assessment = { input, summary: 'Bound main assessment', u: { score: 70, evidence: 'Fact' }, s: { score: 60, evidence: 'Fact' }, t: { score: 50, evidence: 'Fact' } }
    const result = JSON.parse((await call('report_design_clarity', assessment)).content[0].text)
    assert.equal(result.received, 'reportMainClarity'); assert.deepEqual(result.input, input)
    const before = calls.length
    assert.equal((await call('report_design_clarity', { ...assessment, turn: 123 })).isError, true)
    assert.equal(calls.length, before, 'obsolete caller-supplied turn is not ordinary report input')
    assert.equal((await call('report_design_clarity', { ...assessment, input: { ...input, scopeDigest: 'd'.repeat(64) } })).isError, true)
    assert.equal(calls.length, before)
  } finally {
    await client.close(); await mcp.close(); api.closeAllConnections()
    await new Promise(resolve => api.close(resolve)); await rm(root, { recursive: true, force: true })
  }
})

test('native review MCP advertises shared nested types and preserves valid JSON without coercion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'typed-review-mcp-')), calls = []
  const api = createServer(async (request, response) => {
    const parts = []; for await (const part of request) parts.push(part)
    const value = JSON.parse(Buffer.concat(parts)); calls.push(value)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ status: 'completed' }))
  })
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  const connection = join(root, 'private.json')
  await writeFile(connection, JSON.stringify({ origin: `http://127.0.0.1:${api.address().port}`, token: 'a'.repeat(64) }))
  const mcp = createDesignMcp(), client = new Client({ name: 'typed-review-fixture', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const nativeRun = { runId: 'agent-review', parentRunId: 'main-session', transcriptPath: join(root, 'reviewer.jsonl') }
  try {
    await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)])
    const { tools } = await client.listTools()
    const resultSchema = tools.find(tool => tool.name === 'design_submit_review').inputSchema.properties.result
    const alignment = resultSchema.anyOf.find(schema => schema.properties.questions)
    assert.equal(alignment.properties.schemaVersion.const, 1)
    assert.equal(alignment.properties.schemaVersion.type, 'number')
    assert.equal(alignment.properties.questions.type, 'array')
    assert.equal(alignment.properties.questions.items.properties.facets.type, 'array')
    assert.notEqual(alignment.additionalProperties, false, 'the bound server owns optional KAG failure isolation')
    const submit = result => client.callTool({ name: 'design_submit_review', arguments: {
      connection, reviewId: 'exact-review', nativeRun, result,
    } })
    const valid = [
      { schemaVersion: 1, inconsistencies: [] },
      { schemaVersion: 1, researchNeeds: [] },
      { schemaVersion: 1, questions: [] },
      { schemaVersion: 1, questions: [{ id: 'audience', facets: ['facts'], decision: 'Audience',
        question: 'Which audience?', rationale: 'Different needs', impact: 'Changes scope' }],
      knowledgeRelations: [{ from: 'a', to: 'b', relationType: 'supports', summary: 'Saved evidence',
        evidence: [{ source: 'a.json', locator: '/fact', quote: 'A' }, { source: 'b.json', locator: '/fact', quote: 'B' }] }],
      knowledgeRetractions: [] },
      { summary: 'Saved scope', u: { score: 45, evidence: 'Users' },
        s: { score: 65, evidence: 'Structure' }, t: { score: 58, evidence: 'Criteria' } },
    ]
    for (const result of valid) {
      assert.notEqual((await submit(result)).isError, true)
      assert.deepEqual(calls.at(-1), { method: 'submitReview', params: { reviewId: 'exact-review', nativeRun, result } })
    }
    const before = calls.length
    for (const result of [
      { schemaVersion: '1', questions: [] },
      { schemaVersion: 1, questions: { item: [] } },
      { schemaVersion: 1, questions: [{ id: 'q', facets: { item: [] }, decision: 'Audience',
        question: 'Which audience?', rationale: 'Different needs', impact: 'Changes scope' }] },
    ]) {
      const rejected = await submit(result)
      assert.equal(rejected.isError, true)
      const diagnostic = rejected.content.map(item => item.text ?? '').join('\n')
      assert.match(diagnostic, /design_read_review/)
      assert.match(diagnostic, /schemaVersion is 1/)
      assert.match(diagnostic, /JSON arrays/)
      assert.equal(calls.length, before, 'malformed JSON shapes cannot reach publication or be silently coerced')
    }
    // These fields must reach the existing server unchanged: it can publish
    // valid advice while recording a Knowledge error, or reject an unknown field
    // against the exact bound profile. Transport must not become that authority.
    for (const result of [
      { schemaVersion: 1, questions: [], knowledgeRelations: { item: [] } },
      { schemaVersion: 1, questions: [], knowledgeRetractions: '' },
      { schemaVersion: 1, questions: [], unexpected: true },
    ]) {
      assert.notEqual((await submit(result)).isError, true)
      assert.deepEqual(calls.at(-1).params.result, result)
    }
  } finally {
    await client.close(); await mcp.close(); api.closeAllConnections()
    await new Promise(resolve => api.close(resolve)); await rm(root, { recursive: true, force: true })
  }
})
