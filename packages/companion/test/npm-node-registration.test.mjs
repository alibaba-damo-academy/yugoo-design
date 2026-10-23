import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeRegistrationFiles } from '../src/npm-node-registration.mjs'

test('Node projection preserves MCP arguments and safely quotes Qoder Hook executable paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'node-binding-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'hooks'))
  const mcp = JSON.stringify({ mcpServers: { 'design-system': { command: 'node', args: ['${QODER_PLUGIN_ROOT}/scripts/design.mjs', 'mcp'], env: { KEEP: 'yes' } } } })
  const hooks = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "${QODER_PLUGIN_ROOT}/scripts/qoder-context.mjs"', timeout: 10 }] }] } })
  await writeFile(join(root, '.mcp.json'), mcp); await writeFile(join(root, 'hooks/hooks.json'), hooks)
  const executable = "/opt/Jeff's node/bin/node"
  const files = await nodeRegistrationFiles(root, 'qoder', { executable })
  assert.equal(JSON.parse(files['.mcp.json']).mcpServers['design-system'].command, executable)
  assert.deepEqual(JSON.parse(files['.mcp.json']).mcpServers['design-system'].args, ['${QODER_PLUGIN_ROOT}/scripts/design.mjs', 'mcp'])
  assert.equal(JSON.parse(files['.mcp.json']).mcpServers['design-system'].env.KEEP, 'yes')
  assert.equal(JSON.parse(files['hooks/hooks.json']).hooks.SessionStart[0].hooks[0].command, "'/opt/Jeff'\\''s node/bin/node' \"${QODER_PLUGIN_ROOT}/scripts/qoder-context.mjs\"")
  assert.equal(await readFile(join(root, '.mcp.json'), 'utf8'), mcp)
  assert.equal(await readFile(join(root, 'hooks/hooks.json'), 'utf8'), hooks)
})
