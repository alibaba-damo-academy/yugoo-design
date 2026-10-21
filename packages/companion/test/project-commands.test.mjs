import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCompanionCommand } from '../src/project-commands.mjs'
import { startCompanion } from '../src/server.mjs'
import { staticFixture } from './static-fixture.mjs'
import { loadDesignKit, createDirectoryBundleResolver } from '../../core/lib/index.js'
import { companionFs } from '../src/project.mjs'
import * as runtime from '../../knowledge-ladybug/lib/index.js'

// A passing lifecycle test reaches savePanel, which samples the shared Ladybug
// runtime in-process; stop its worker so the process exits naturally.
after(() => runtime.shutdownLadybugKnowledgeRuntime())
const kitRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
const installedVersion = (await loadDesignKit(companionFs, kitRoot, { sourceId: 'companion:explicit-kit', resolveBundle: createDirectoryBundleResolver(companionFs, [{ rootDir: join(kitRoot, 'bundles'), sourceId: 'companion:explicit-kit' }]) })).version

test('Kit activation preserves the current Panel across native hosts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-command-lifecycle-'))
  try {
    for (const host of ['codex', 'qoder', 'claude-code']) {
      const options = { host, threadId: '00000000-0000-4000-8000-000000000001',
        projectsRoot: join(root, host, 'projects'), stateRoot: join(root, host, 'state'),
        kitRoot: fileURLToPath(new URL('../../skills-web-app/', import.meta.url)) }
      const created = await runCompanionCommand({ ...options, input: `new ${host} lifecycle` })
      assert.equal(created.selected.kit, undefined)
      assert.equal(created.panelRestartRequired, true)
      const pinned = await runCompanionCommand({ ...options, input: 'kit web_app' })
      assert.equal(pinned.selected.projectId, created.selected.projectId)
      assert.deepEqual(pinned.selected.kit, { name: 'web_app', version: installedVersion })
      assert.equal(pinned.panelRestartRequired, false)
      assert.equal((await runCompanionCommand({ ...options, input: 'close' })).panelRestartRequired, true)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('native entry uses Core projects, isolated selection, mindset and file-preserving removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-commands-'))
  const threadId = '00000000-0000-4000-8000-000000000001'
  const options = { host: 'codex', threadId, projectsRoot: join(root, 'design-system/projects'), stateRoot: join(root, 'state'), kitRoot: fileURLToPath(new URL('../../skills-web-app/', import.meta.url)) }
  const command = (input, extra = {}) => runCompanionCommand({ ...options, input, ...extra })
  let server
  try {
    assert.equal((await command('status')).selected, undefined)
    assert.equal((await command('help')).commandEntry, '$yugoo')
    await assert.rejects(command('not-a-command'), /Unknown/)
    const created = await command('new Fresh test')
    assert.equal(created.kind, 'success')
    assert.equal(created.selected.name, 'Fresh test')
    assert.ok(created.text.includes(created.selected.root), 'command display must not replace /design inside real paths')
    assert.equal(created.selected.kit, undefined)
    assert.equal(created.panelRestartRequired, true)
    assert.equal((await command('status', { host: 'qoder' })).selected, undefined)
    await assert.rejects(command('mindset missing'), /Available Kits/)
    const pinned = await command('mindset web_app')
    assert.deepEqual(pinned.selected.kit, { name: 'web_app', version: installedVersion })
    assert.equal(pinned.panelRestartRequired, false, 'same-project Kit activation refreshes the live Panel')
    assert.match((await command('list')).text, /Fresh test/)
    const projectRoot = pinned.selected.root
    // The native CLI cwd deliberately differs from Design Files' parent.
    const transcriptPath = join(root, 'main.jsonl')
    await writeFile(transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd: root } }) + '\n')
    server = await startCompanion({ ...await staticFixture(root), ...options, projectRoot, nativeCwd: root, transcriptPath,
      connection: { threadId, send: async () => ({ accepted: true }) } })
    const call = async (method, params = {}) => {
      const response = await fetch(`${server.origin}/api`, { method: 'POST', headers: { Origin: server.origin, 'Content-Type': 'application/json', 'X-Design-Token': server.token }, body: JSON.stringify({ method, params }) })
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }
    const workspace = await call('readWorkspace')
    assert.ok(JSON.stringify(workspace).includes('Fresh test'))
    assert.equal(workspace.conversation.available, true, 'main transcript uses native cwd, not design root')
    const producerId = '00000000-0000-4000-8000-000000000002'
    const producerPath = join(root, 'producer.jsonl')
    await writeFile(producerPath, JSON.stringify({ type: 'session_meta', payload: { id: producerId, cwd: root,
      source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n' +
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }) + '\n')
    await call('registerNativeRun', { role: 'producer', skill: 'function_modules', artifactId: 'function_modules', runId: producerId, parentRunId: threadId, transcriptPath: producerPath })
    assert.equal((await call('readWorkspace')).executionAttempts[0].phase, 'working')
    assert.equal((await call('prepareBundle', { skill: 'smart_questions' })).execution.mode, 'main')
    const main = await call('beginMainBundle', { skill: 'smart_questions' })
    assert.equal((await call('readWorkspace')).executionAttempts.length, 1, 'main questions do not create another Producer')
    const state = { questions: { intro: { prompt: '项目目标？', kind: 'text', answer: '测试新项目', detail: '' } } }
    const saved = await server.project.savePanel({ skill: 'smart_questions', state, eventId: 'new-project-save' })
    assert.ok(saved.commit)
    assert.deepEqual(JSON.parse(await readFile(join(projectRoot, 'design_files/smart_questions/smart_questions.json'), 'utf8')), state)
    assert.equal((await call('finishMainBundle', { invocationId: main.invocationId, scope: 'state', outcome: 'pause' })).accepted, true)
    await server.close(); server = undefined
    assert.equal((await command('close')).selected, undefined)
    await command(`open ${projectRoot}`)
    assert.equal((await command('status')).selected.projectId, created.selected.projectId)
    const recovered = await command(`recover ${projectRoot}`)
    assert.notEqual(recovered.selected.root, projectRoot)
    assert.deepEqual(JSON.parse(await readFile(join(recovered.selected.root, 'design_files/smart_questions/smart_questions.json'), 'utf8')), state)
    await command('delete Fresh test')
    assert.ok(await readFile(join(projectRoot, 'project.json'), 'utf8'), 'delete retains all original files')
    await command('new Shared selection')
    await command('open Shared selection', { host: 'qoder' })
    await command('delete Shared selection', { host: 'qoder' })
    for (const input of ['help', 'list', 'status', 'close']) assert.equal((await command(input)).selected, undefined)
    await mkdir(join(root, 'source'))
    await writeFile(join(root, 'source/README.md'), 'Source evidence')
    const reconstructed = await command(`reconstruct ${join(root, 'source')}`)
    assert.equal(reconstructed.kind, 'success')
    assert.match(reconstructed.conversationPrompt, /Source|source/)
    assert.equal(await readFile(join(root, 'source/README.md'), 'utf8'), 'Source evidence')
  } finally {
    if (server) await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('pure commands read without an installed Kit or the project-command writer lock', async t => {
  const root = await mkdtemp(join(tmpdir(), 'design-command-readonly-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = { host: 'codex', threadId: '00000000-0000-4000-8000-000000000001',
    projectsRoot: join(root, 'projects'), stateRoot: join(root, 'state'), kitRoot: join(root, 'not-installed') }
  const created = await runCompanionCommand({ ...options, input: 'new Read without content' })
  const lock = join(options.stateRoot, 'project-management/command.lock')
  await mkdir(lock)
  for (const input of ['help', 'status', 'list', 'compose_spec bounded read']) {
    const result = await runCompanionCommand({ ...options, input })
    assert.equal(result.kind, 'success')
    assert.equal(result.selected.projectId, created.selected.projectId)
    assert.deepEqual(result.availableMindsets, [])
  }
  await assert.rejects(runCompanionCommand({ ...options, input: 'mindset web_app' }), /Another project command/)
  await rm(lock, { recursive: true })
  await assert.rejects(runCompanionCommand({ ...options, input: 'mindset web_app' }), /not-installed|ENOENT|mindset|not found/i)
})
