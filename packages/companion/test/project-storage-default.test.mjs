/** Normal compiled CLI/MCP entry points, with a completely isolated Linux home. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const exec = promisify(execFile)
const entry = fileURLToPath(new URL('../dist-server/design.mjs', import.meta.url))
const kit = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))

test('compiled CLI and MCP share Documents defaults, overrides and original selections', { skip: process.platform !== 'linux' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-documents-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = join(root, 'config')
  await mkdir(config)
  const documents = join(root, '文档 My Documents')
  await writeFile(join(config, 'user-dirs.dirs'), `XDG_DOCUMENTS_DIR="${documents}"\n`)
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: config }
  const args = ['--state-root', join(root, 'state'), '--kit', kit]
  const thread = '00000000-0000-4000-8000-000000000001'
  const cli = async (host, input, more = []) => JSON.parse((await exec(process.execPath, [entry, 'command', ...args, '--host', host, '--thread', thread, '--input', input, ...more], { env, timeout: 30000 })).stdout)
  const client = new Client({ name: 'documents-default-test', version: '1' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, 'mcp', ...args], env, stderr: 'pipe' })
  await client.connect(transport)
  try {
    const mcp = async (host, action, argument) => client.callTool({ name: 'design_command', arguments: { host, threadId: thread, action, ...(argument ? { argument } : {}) } })
    const projects = []
    for (const host of ['codex', 'claude-code', 'qoder', 'qwenwork', 'workbuddy']) {
      const result = await mcp(host, 'new', `Documents ${host}`)
      assert.ok(!result.isError, JSON.stringify(result))
      const created = JSON.parse(result.content[0].text).selected
      assert.equal(dirname(created.root), join(documents, 'YuGoo', 'Projects'))
      assert.equal((await cli(host, 'status')).selected.projectId, created.projectId)
      projects.push(created)
    }
    // Make Documents resolution fail on purpose; status/open still read exact
    // registered paths, and explicit roots bypass the failed default entirely.
    await rm(join(config, 'user-dirs.dirs'))
    await mkdir(join(config, 'user-dirs.dirs'))
    const before = await cli('qwenwork', 'status')
    assert.equal(before.selected.projectId, projects[3].projectId)
    assert.equal((await mcp('qwenwork', 'new', 'Must fail')).isError, true)
    const custom = await cli('qwenwork', 'new Explicit override', ['--projects-root', join(root, 'custom')])
    assert.equal(dirname(custom.selected.root), join(root, 'custom'))
    const reopened = await mcp('qwenwork', 'open', projects[3].projectId)
    assert.ok(!reopened.isError)
    assert.equal(JSON.parse(reopened.content[0].text).selected.root, projects[3].root)
  } finally { await client.close() }
})
