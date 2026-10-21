/** Companion tool/connection boundary only; shared Core owns Git semantics. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createDesignMcp } from '../src/mcp.mjs'
import { browserMethods } from '../src/browser-access.mjs'
import { designGitReadArguments, GitVersioning } from '../../core/lib/index.js'
import { callCompanion } from '../src/connection-file.mjs'
import { fixture } from './fixture.mjs'

test('Git MCP uses the exact existing connection and preserves complete-page receipts without granting argv/root access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'companion-git-tool-'))
  const token = 'a'.repeat(64), checkpoint = 'b'.repeat(40), from = 'c'.repeat(40)
  const requests = []
  let origin
  const http = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.headers.origin !== origin || request.headers['x-design-token'] !== token) {
      response.writeHead(403); response.end(JSON.stringify({ error: 'Unauthorized companion request.' })); return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push(input)
    response.end(JSON.stringify({ project: 'fixture-project', checkpoint, from,
      page: { offset: input.params.offset ?? 0, nextOffset: 32768, complete: false,
        totalCharacters: 49152, offsetUnit: 'utf16-code-units' }, text: 'complete page, not a summary' }))
  })
  const server = createDesignMcp(), client = new Client({ name: 'git-tool-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${http.address().port}`
    const connection = join(root, 'connection.json')
    await writeFile(connection, JSON.stringify({ origin, token }), { mode: 0o600 })
    await server.connect(serverTransport); await client.connect(clientTransport)
    const tool = (await client.listTools()).tools.find(item => item.name === 'design_git_read')
    assert.ok(tool)
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.equal(tool.inputSchema.additionalProperties, false)
    assert.ok(tool.inputSchema.required.includes('connection'))
    assert.deepEqual(tool.inputSchema.properties.action.enum, ['status', 'history', 'message', 'diff', 'list', 'read'])
    assert.equal(tool.inputSchema.properties.argv, undefined)
    assert.equal(tool.inputSchema.properties.root, undefined)
    assert.equal(browserMethods.has('readGit'), false, 'native read tool does not expand browser admission')
    const call = args => client.callTool({ name: tool.name, arguments: { connection, ...args } })
    const params = designGitReadArguments({ action: 'diff', project: 'fixture-project', checkpoint, from,
      path: 'design_files/example/example.json', offset: 16384 })
    const result = await call(params)
    assert.ok(!result.isError, JSON.stringify(result))
    assert.deepEqual(requests, [{ method: 'readGit', params }])
    const page = JSON.parse(result.content[0].text)
    assert.equal(page.page.complete, false)
    assert.equal(page.page.nextOffset, 32768)
    assert.equal(page.page.totalCharacters, 49152)
    assert.equal(page.page.offsetUnit, 'utf16-code-units')
    assert.equal(page.text, 'complete page, not a summary')
    const messageArgs = designGitReadArguments({ action: 'message', checkpoint })
    await call(messageArgs)
    assert.deepEqual(requests[1], { method: 'readGit', params: messageArgs })
    const accepted = requests.length
    for (const args of [{ action: 'write' }, { action: 'status', argv: ['git', 'status'] },
      { action: 'list', root: '/another/project' }, { action: 'read', checkpoint: 'HEAD', path: 'x' },
      { action: 'history', limit: 51 }, { action: 'list', offset: -1 }]) {
      assert.equal((await call(args)).isError, true)
    }
    assert.equal(requests.length, accepted, 'invalid tool requests never reach the server')
    const wrongConnection = join(root, 'wrong-connection.json')
    await writeFile(wrongConnection, JSON.stringify({ origin, token: 'd'.repeat(64) }), { mode: 0o600 })
    assert.equal((await call({ action: 'status', connection: wrongConnection })).isError, true)
    assert.equal(requests.length, accepted, 'another token does not acquire this connection')
  } finally {
    await client.close(); await server.close()
    http.closeAllConnections()
    await new Promise(resolve => http.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('Companion reads complete pinned pages with no Git executable and never substitutes draft or binary text', async () => {
  const f = await fixture(), oldPath = process.env.PATH, oldBackend = process.env.YUGOO_GIT_BACKEND
  try {
    process.env.PATH = ''; process.env.YUGOO_GIT_BACKEND = 'native'
    const root = f.options.projectRoot, project = f.server.project.project.metadata.id
    const git = new GitVersioning(async () => assert.fail('external Git is not available in this read fixture'), root)
    const path = 'design_files/example/说明.txt', binaryPath = 'design_files/example/raw.bin'
    const text = ('x'.repeat(16383) + '😀\n').repeat(3), binary = Buffer.from([0, 255, 128, 10])
    await mkdir(join(root, 'design_files/example'), { recursive: true })
    await writeFile(join(root, path), text); await writeFile(join(root, binaryPath), binary)
    const baseline = await git.head()
    const checkpoint = await git.commitExact('read tool fixture', new Map([[path, text], [binaryPath, binary]]), baseline)
    const read = input => callCompanion(f.server.connectionPath, { method: 'readGit', params: input })
    const first = await read({ action: 'read', project, path })
    assert.equal(first.checkpoint, checkpoint)
    assert.equal(first.page.complete, false)
    assert.equal(first.page.offsetUnit, 'utf16-code-units')
    await writeFile(join(root, path), 'unpublished draft')
    const advanced = await git.commitExact('later checkpoint', new Map([['design_files/example/later.txt', 'later']]), checkpoint)
    const completeText = async (args, initial) => {
      let page = initial ?? await read(args), result = page.text
      const pinned = page.checkpoint
      while (!page.page.complete) {
        assert.ok(page.page.nextOffset > page.page.offset)
        page = await read({ ...args, checkpoint: pinned, offset: page.page.nextOffset })
        assert.equal(page.checkpoint, pinned)
        result += page.text
      }
      assert.equal(page.page.nextOffset, null)
      return result
    }
    assert.equal(await completeText({ action: 'read', project, checkpoint, path }, first), text)
    const diff = await completeText({ action: 'diff', project, checkpoint, from: baseline })
    assert.equal(diff, await git.diffBetween(baseline, checkpoint))
    const bytes = await read({ action: 'read', project, checkpoint, path: binaryPath })
    assert.equal(bytes.kind, 'binary'); assert.equal(bytes.contentIncluded, false)
    assert.equal(bytes.size, binary.length); assert.equal(bytes.text, undefined)
    const history = await read({ action: 'history', project, checkpoint, limit: 1 })
    const second = await read({ action: 'history', project, checkpoint, limit: 1, offset: history.page.nextOffset })
    assert.equal(history.entries[0].commit, checkpoint)
    assert.equal(second.entries[0].commit, baseline)
    assert.equal(second.page.complete, true)
    const status = await read({ action: 'status', project })
    assert.equal(status.project, project); assert.equal(status.head, advanced); assert.equal(status.dirty, true)
    await assert.rejects(read({ action: 'read', project: 'another-project', checkpoint, path }))
    await assert.rejects(read({ action: 'read', project, checkpoint, path: '../outside' }))
    await assert.rejects(read({ action: 'read', project, path, offset: 1 }))
    await assert.rejects(read({ action: 'status', root: '/another/project' }))
    assert.equal(await git.head(), advanced, 'read operations never publish another commit')
    assert.equal(f.messages.length, 0, 'read operations never contact the native conversation')
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath
    if (oldBackend === undefined) delete process.env.YUGOO_GIT_BACKEND; else process.env.YUGOO_GIT_BACKEND = oldBackend
    await f.close()
  }
})

test('Companion rejects changed project identity before reading and again before returning a successful read', async t => {
  const f = await fixture()
  try {
    const project = f.server.project, file = join(f.options.projectRoot, 'project.json')
    const original = await readFile(file, 'utf8'), metadata = JSON.parse(original)
    const changed = JSON.stringify({ ...metadata, id: '00000000-0000-4000-8000-000000000002' })
    const checkpoint = await project.store.head(), readMessage = GitVersioning.prototype.commitMessageAt
    let reads = 0
    t.mock.method(GitVersioning.prototype, 'commitMessageAt', async function (...args) {
      reads++
      const result = await readMessage.apply(this, args)
      await writeFile(file, changed)
      return result
    })
    await writeFile(file, changed)
    await assert.rejects(project.readGit({ action: 'message', checkpoint }), /identity changed/i)
    assert.equal(reads, 0)
    await writeFile(file, original)
    await assert.rejects(project.readGit({ action: 'message', checkpoint }), /identity changed/i)
    assert.equal(reads, 1, 'post-read identity change is checked before returning any successful result')
  } finally { await f.close() }
})
