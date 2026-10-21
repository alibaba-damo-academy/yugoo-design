import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Companion wires shared Graph status reads to the existing readonly backend contract', async () => {
  const client = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8')
  const workspace = await readFile(new URL('../../panel/src/client/workspace.tsx', import.meta.url), 'utf8')
  assert.match(client, /readKnowledgeStatus:\s*\(\)\s*=>\s*rpc\('knowledgeStatus'\)/)
  assert.match(server, /method === 'knowledgeStatus'\) return send\(response, 200, await knowledge\.status\(\)\)/)
  assert.match(workspace, /readStatus=\{runtime\.readKnowledgeStatus \? readKnowledgeStatus : undefined\}/)
  // This static adapter regression complements the mounted Graph status-refresh
  // behavior checks; it does not claim installed-host interaction acceptance.
})
