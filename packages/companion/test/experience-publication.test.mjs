import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DesignProjectManager } from '../../core/lib/index.js'
import { openCompanionProject } from '../src/project.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createDesignMcp } from '../src/mcp.mjs'
import { fixture } from './fixture.mjs'
import { parse } from 'yaml'

const exec = promisify(execFile)

test('Companion MCP publishes derived scenarios through Core and retains source and publication conflicts', async () => {
  const f = await fixture()
  const mcp = createDesignMcp()
  const client = new Client({ name: 'experience-publication-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const store = f.server.project.store
  const source = 'smart_questions/smart_questions.json'
  const sourceContent = '{"questions":{},"question_order":[]}'
  const html = '<html><body><h1>Fee decision</h1><button onclick="this.textContent=\'Compared\'">Compare</button></body></html>'
  const request = (action, args = {}) => client.callTool({ name: 'design_experience', arguments: {
    connection: f.server.connectionPath, action, id: 'fee-decision', ...args,
  } })
  const call = async (action, args) => {
    const result = await request(action, args)
    assert.ok(!result.isError, JSON.stringify(result))
    return JSON.parse(result.content[0].text)
  }
  const prepare = () => call('prepare', { sources: [source] })
  const write = version => call('write', { version, artifactId: 'overview', content: html })
  const publish = (version, title = 'Fee decision') => call('publish', { version, title, purpose: 'Compare the current design',
    sections: [{ id: 'overview', title: 'Overview', sources: [source], assumptions: ['Synthetic example'] }],
  })
  try {
    await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)])
    const tool = (await client.listTools()).tools.find(tool => tool.name === 'design_experience')
    assert.ok(tool, 'native Agent can discover the existing experience lifecycle')
    assert.deepEqual(tool.inputSchema.properties.action.enum, ['prepare', 'write', 'publish'])
    assert.equal(tool.inputSchema.additionalProperties, false)
    await store.writeWorktreeText(source, sourceContent)
    await exec('git', ['add', 'design_files'], { cwd: f.options.projectRoot })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'source fixture'], { cwd: f.options.projectRoot })
    const before = await store.head()
    const journal = await f.server.project.readDesignJournal()
    const draft = await prepare()
    assert.equal(draft.designFiles, f.server.project.project.designFilesRoot)
    assert.equal(draft.authoring.version, 'web-explanation-v1')
    assert.match(draft.authoring.guide, /evidence|source/i)
    await write(draft.version)
    assert.deepEqual((await f.server.project.readWorkspace()).experienceFiles, {}, 'drafts stay out of the saved scenario list')
    const published = await publish(draft.version)
    assert.equal(published.published, true)
    const index = '_experiences/fee-decision/view.json'
    const workspace = await f.server.project.readWorkspace()
    assert.equal(workspace.experienceFiles[index], published.commit)
    assert.equal((await f.server.project.readArtifact({ path: index, revision: published.commit })).found, true)
    assert.equal(await store.readWorktreeText(source), sourceContent)
    assert.equal(await store.sameDesignEvidenceAt(before, published.commit), true)
    assert.deepEqual(await f.server.project.readDesignJournal(), journal, 'derived views do not publish Bundle facts')

    const a = await prepare(), b = await prepare()
    await write(a.version); await write(b.version)
    await publish(a.version, 'New saved scenario')
    const saved = await store.readWorktreeText(index)
    const stale = await request('publish', { version: b.version, title: 'Stale scenario', purpose: 'Compare',
      sections: [{ id: 'overview', title: 'Overview', sources: [source], assumptions: [] }] })
    assert.equal(stale.isError, true)
    assert.match(stale.content[0].text, /changed|another/i)
    assert.equal(await store.readWorktreeText(index), saved, 'a stale publisher preserves the latest view')

    const changed = await prepare()
    await write(changed.version)
    const newerSource = '{"questions":{},"question_order":[],"remarks":"new user input"}'
    await store.writeWorktreeText(source, newerSource)
    const drift = await request('publish', { version: changed.version, title: 'Outdated source', purpose: 'Compare',
      sections: [{ id: 'overview', title: 'Overview', sources: [source], assumptions: [] }] })
    assert.equal(drift.isError, true)
    assert.match(drift.content[0].text, /source.*changed/i)
    assert.equal(await store.readWorktreeText(index), saved)
    assert.equal(await store.readWorktreeText(source), newerSource, 'failed publication retains human source edits')
  } finally {
    await client.close(); await mcp.close(); await f.close()
  }
})

async function isolated(run) {
  const root = await mkdtemp(join(tmpdir(), 'companion-experience-publication-'))
  try {
    const projectRoot = join(root, 'project')
    const kitRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
    const kitVersion = parse((await readFile(join(kitRoot, 'kits/web_app/mindset.md'), 'utf8')).split('---')[1]).version
    await new DesignProjectManager().create({ root: projectRoot, name: 'Synthetic experience',
      knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'web_app', version: String(kitVersion) } })
    const api = await openCompanionProject({ projectRoot,
      kitRoot,
      stateRoot: join(root, 'state'), connection: { host: 'codex', threadId: 'experience-test' } })
    const commit = async () => {
      await exec('git', ['add', 'design_files'], { cwd: projectRoot })
      await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'synthetic experience'], { cwd: projectRoot })
      return api.store.head()
    }
    await run(api, commit)
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('only committed experience paths appear, and publication cache refreshes on a new checkpoint', async () => {
  await isolated(async (api, commit) => {
    const index = '_experiences/example/view.json'
    await api.store.writeWorktreeText(index, '{"id":"example"}')
    assert.deepEqual((await api.readWorkspace()).experienceFiles, {})
    const first = await commit()
    assert.deepEqual((await api.readWorkspace()).experienceFiles, { [index]: first })
    const unpublished = '_experiences/unpublished/view.json'
    await api.store.writeWorktreeText(unpublished, '{}')
    await api.store.writeWorktreeText(index, '{"id":"uncommitted-edit"}')
    assert.deepEqual((await api.readWorkspace()).experienceFiles, { [index]: first })
    assert.equal((await api.readArtifact({ path: index, revision: first })).content, '{"id":"example"}')
    const second = await commit()
    assert.deepEqual((await api.readWorkspace()).experienceFiles, { [index]: second, [unpublished]: second })
  })
})

test('frozen image reads remain at the requested commit while ordinary and worktree reads stay live', async () => {
  await isolated(async (api, commit) => {
    const path = '_experiences/example/versions/1/image.png'
    const before = Buffer.from([137, 80, 78, 71, 1])
    const after = Buffer.from([137, 80, 78, 71, 2])
    await api.store.writeWorktreeBytes(path, before)
    const revision = await commit()
    await api.store.writeWorktreeBytes(path, after)
    assert.equal((await api.readBinaryArtifact({ path, revision })).base64, before.toString('base64'))
    assert.equal((await api.readBinaryArtifact({ path })).base64, after.toString('base64'))
    assert.equal((await api.readBinaryArtifact({ path, revision: 'worktree:live' })).base64, after.toString('base64'))
    assert.equal((await api.readBinaryArtifact({ path: '_experiences/missing.png', revision })).found, false)
  })
})

test('binary size, format and path rejection remain in force for versioned and live reads', async () => {
  await isolated(async (api, commit) => {
    const path = '_experiences/example/oversize.png'
    await api.store.writeWorktreeBytes(path, Buffer.alloc(10 * 1024 * 1024 + 1))
    await assert.rejects(api.readBinaryArtifact({ path }), /10 MiB/)
    const revision = await commit()
    await assert.rejects(api.readBinaryArtifact({ path, revision }), /limit|exceed|large|bytes/i)
    await assert.rejects(api.readBinaryArtifact({ path: '_experiences/example/file.exe', revision }), /Unsupported/)
    await assert.rejects(api.readBinaryArtifact({ path: '../outside.png', revision }), /path|travers|relative|\.\./i)
  })
})
