import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Allows isolated Core builds without touching the running application's lib/.
const coreRoot = new URL(`../../core/${process.env.DESIGN_CORE_TEST_BUILD ?? 'lib'}/`, import.meta.url)
const core = await import(new URL('index.js', coreRoot))
const source = (await readFile(new URL('../src/project.mjs', import.meta.url), 'utf8'))
  .replaceAll('../../core/lib/', coreRoot.href)
  .replaceAll('./auto-panel-tickets.mjs', new URL('../src/auto-panel-tickets.mjs', import.meta.url).href)
const { openCompanionProject } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

for (const host of ['codex', 'claude-code', 'qoder']) test(`${host}: live files do not replace publication authority`, { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'companion-refresh-'))
  try {
    const registry = new core.DesignProjectRegistry({ projectsRoot: join(root, 'projects'), stateRoot: join(root, 'registry') })
    const created = await registry.create('fixture', { provider: 'ladybug-wasm' })
    await registry.setKitPin(created.projectId, { name: 'web_app', version: '1.0' })
    const project = await openCompanionProject({ projectRoot: created.root,
      kitRoot: fileURLToPath(new URL('../../skills-web-app/', import.meta.url)), stateRoot: join(root, 'runtime'),
      connection: { host, threadId: '11111111-1111-4111-8111-111111111111' } })
    const state = { rounds: [{ id: 'R-001', title: 'Published' }] }
    const commit = await project.store.write('research', state, { origin: 'agent', settleEvent: async () => {}, publication: {
      skill: 'research', bundleVersion: '1.0', invocationId: 'pending-1', stateStatus: 'pending', handoff: 'user_continue',
    } })
    const read = () => project.readWorkspace({ displayOnly: true })
    const originalGateRead = project.store.readLatestPublishedExecutionForSkillAt.bind(project.store)
    let arrivals = 0, release, entered
    const together = new Promise(resolve => { release = resolve })
    const firstEntered = new Promise(resolve => { entered = resolve })
    project.store.readLatestPublishedExecutionForSkillAt = async (...args) => {
      if (++arrivals === 1) entered()
      await together
      return originalGateRead(...args)
    }
    // readWorkspace now shares the project mutation fence. Queue a second cold
    // read while the first is paused, rather than requiring both to enter a
    // critical section that intentionally serializes them.
    const firstRead = read()
    await Promise.race([firstEntered, firstRead.then(result => {
      throw new Error(`Cold fixture did not reach its publication gate: ${JSON.stringify({ access: result.access, checkpoint: result.checkpoint, publicationError: result.publicationError, continuations: result.continuations })}`)
    })])
    const secondRead = read()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(arrivals, 1, 'a queued cold reader cannot bypass the mutation fence')
    release()
    const pair = await Promise.all([firstRead, secondRead])
    project.store.readLatestPublishedExecutionForSkillAt = originalGateRead
    const first = pair[0]
    assert.deepEqual(pair[0].continuations, pair[1].continuations)
    assert.equal(first.continuations.length, 1, 'concurrent cold readers must not append duplicate gates')
    assert.ok(first.continuations.length > 0)
    assert.equal(first.checkpoint, commit.commit)
    await project.store.writeWorktreeText('research/research.json', '{}')
    const edited = await read()
    assert.deepEqual(edited.design.research.state, {})
    assert.deepEqual(edited.continuations, first.continuations, 'empty draft must not erase published handoff')
    await project.store.writeWorktreeText('research/new.html', 'uncommitted worker result')
    assert.ok((await read()).artifactFiles['research/new.html'])
    await rm(join(created.designFilesRoot, 'research', 'research.json'))
    assert.equal((await read()).design.research, undefined)
    await project.store.writeWorktreeText('research/research.json', '{"rounds":[]}')
    if (host === 'codex') {
      const publish = (title, invocationId) => project.store.write('research', { title }, {
        origin: 'agent', settleEvent: async () => {}, publication: {
          skill: 'research', bundleVersion: '1.0', invocationId, stateStatus: 'pending', handoff: 'user_continue',
        },
      })
      const a = await publish('A', 'run-A')
      const originalTextRead = project.store.readWorktreeText.bind(project.store)
      let entered, releaseA, blockOnce = true
      const blocked = new Promise(resolve => { entered = resolve })
      const unblock = new Promise(resolve => { releaseA = resolve })
      project.store.readWorktreeText = async path => {
        const text = await originalTextRead(path)
        if (path === 'research/research.json' && blockOnce) {
          blockOnce = false; entered(); await unblock
        }
        return text
      }
      const readA = project.readWorkspace()
      await blocked
      let bPublished = false
      const pendingPublishB = publish('B', 'run-B').then(result => { bPublished = true; return result })
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(bPublished, false, 'a publication cannot interleave with the paused workspace snapshot')
      releaseA()
      const older = await readA
      const b = await pendingPublishB
      const readB = await project.readWorkspace()
      project.store.readWorktreeText = originalTextRead
      assert.equal(older.checkpoint, a.commit)
      assert.equal(older.design.research.state.title, 'A')
      assert.equal(older.continuations[0].invocationId, 'run-A')
      assert.equal(readB.checkpoint, b.commit)
      assert.equal(readB.design.research.state.title, 'B')
      assert.equal(readB.continuations[0].invocationId, 'run-B')

      // Valid repository/metadata, but a corrupt committed Bundle. Live preview
      // is repaired while publication authority must still fail closed.
      await writeFile(join(created.designFilesRoot, 'research', 'research.json'), '{')
      const exec = promisify(execFile)
      await exec('git', ['add', 'design_files'], { cwd: created.root })
      await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'corrupt fixture'], { cwd: created.root })
      await project.store.writeWorktreeText('research/research.json', '{"rounds":[]}')
      await assert.rejects(project.readWorkspace(), /JSON|property name/)
      const preview = await read()
      assert.ok(preview.publicationError)
      assert.equal(preview.access.writable, false)
      assert.deepEqual(preview.continuations, [])
      await project.store.write('research', { rounds: [] }, { origin: 'agent', settleEvent: async () => {} })

      // A valid state but failed execution metadata read is also fatal only
      // to authority consumers, not the explicitly read-only file preview.
      const fresh = await openCompanionProject({ projectRoot: created.root,
        kitRoot: fileURLToPath(new URL('../../skills-web-app/', import.meta.url)), stateRoot: join(root, 'runtime-2'),
        connection: { host, threadId: '22222222-2222-4222-8222-222222222222' } })
      fresh.store.readLatestPublishedExecutionForSkillAt = async () => { throw new Error('execution authority read failed') }
      await assert.rejects(fresh.readWorkspace(), /execution authority read failed/)
      const failedGate = await fresh.readWorkspace({ displayOnly: true })
      assert.equal(failedGate.access.writable, false)
      assert.deepEqual(failedGate.continuations, [])
    }
    await rename(join(created.root, '.git'), join(created.root, '.git-backup'))
    await mkdir(join(created.root, '.git'))
    const failed = await read()
    assert.ok(failed.publicationError)
    assert.equal(failed.access.writable, false)
    assert.deepEqual(failed.continuations, [])
    assert.deepEqual(failed.design.research.state, { rounds: [] })
    await assert.rejects(project.requireWritable(), /git/i)
    await rm(join(created.root, '.git'), { recursive: true })
    await rename(join(created.root, '.git-backup'), join(created.root, '.git'))
    assert.equal((await read()).access.writable, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
