import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile, spawn as spawnChild } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

// This suite exercises the explicit CLI adapter and injects faults at its argv
// boundary. Keep that boundary pinned after native Git becomes the default;
// native publication and integrity coverage lives in git-native-backend.test.mjs.
const { register } = await import('tsx/esm/api')
register()
const { GitVersioning, collectGitStdout } = await import('../src/git.ts')
const { nodeDesignProjectSpawn } = await import('../src/design-project.ts')
const { DesignFilesStore, DesignWriteSettlementError } = await import('../src/design-files.ts')
const { default: DesignService } = await import('../src/design-service.ts')
const { registerDshProducerDesignTools } = await import('../src/dsh-producer-design-tools.ts')
const exec = promisify(execFile)
const fs = {
  readText: async path => { try { return await readFile(path, 'utf8') } catch (e) { if (e.code === 'ENOENT') return; throw e } },
  readBytes: async path => { try { return await readFile(path) } catch (e) { if (e.code === 'ENOENT') return; throw e } },
  writeText: async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) },
  writeBytes: async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) },
  ensureDir: path => mkdir(path, { recursive: true }), removeFile: path => rm(path),
}
async function fixture(t, spawn = nodeDesignProjectSpawn) {
  const root = await mkdtemp(join(tmpdir(), 'design-publication-integrity-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = new GitVersioning(spawn, root, 'design_files', false, 'cli')
  await git.ensureRepo()
  const command = (...argv) => exec('git', argv, { cwd: root })
  const store = new DesignFilesStore(fs, git, join(root, 'design_files'))
  return { root, git, store, command }
}
const publication = invocationId => ({ skill: 'sample', bundleVersion: '1.0', invocationId, stateStatus: 'complete', handoff: 'none', outcome: 'complete' })
const options = (id, settleEvent = async () => {}) => ({ origin: 'agent', publication: publication(id), settleEvent })

test('CLI adapter: the native Host subprocess port carries raw bytes through committed reads', async t => {
  const specs = []
  const service = Object.create(DesignService.prototype)
  service.context = { subprocess: { spawn(request) {
    specs.push(request.stdio.stdout)
    const [command, ...args] = request.argv
    const child = spawnChild(command, args, { cwd: request.cwd, signal: request.signal, env: { ...process.env, ...request.env } })
    let stdout = '', stderr = ''
    if (request.stdio.stdout !== 'pipe') child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    return { stdout: request.stdio.stdout === 'pipe' ? child.stdout : undefined,
      done: new Promise((resolve, reject) => { child.on('error', reject); child.on('close', exitCode => resolve({ exitCode })) }),
      collected: { stdout: { readFrom: () => ({ text: stdout }) }, stderr: { readFrom: () => ({ text: stderr }) } } }
  } } }
  const { git, store } = await fixture(t, service.spawnAdapter())
  const bytes = Buffer.from([0, 255, 128, 13, 10, 195, 169])
  const written = await store.write('sample', { a: 1 }, { ...options('native-port'), artifacts: { 'sample/raw.bin': bytes } })
  assert.deepEqual(Buffer.from(await git.readBytesAt(written.commit, 'sample/raw.bin')), bytes)
  assert.ok(specs.includes('pipe'))
  const unsupported = Object.create(DesignService.prototype)
  unsupported.context = { subprocess: { spawn: () => ({ done: Promise.resolve({ exitCode: 0 }) }) } }
  await assert.rejects(unsupported.spawnAdapter()({ argv: ['git'], cwd: '.', binaryStdout: { maxBytes: 1 } }), /does not expose binary stdout/)
})

test('Producer publication keeps committed follow-up facts in its tool receipt and rendering', async () => {
  const definitions = new Map()
  const maintenance = { state: 'deferred', message: 'foreign index lock' }
  const recovery = { stage: 'journal', state: 'pending', message: 'Journal unavailable' }
  registerDshProducerDesignTools({ tools: { register(definition) { definitions.set(definition.name, definition); return () => {} } } },
    { validate: async () => [], publish: async () => ({ kind: 'published', stateRevision: 'committed-revision', diff: '', indexMaintenance: maintenance, recovery }) },
    { read: async () => undefined }, 'none', { focus() {}, observeTool() {} })
  const publish = definitions.get('design_publish')
  const value = await publish.execute({ action: 'complete' }, { signal: new AbortController().signal, concludeTurn() {} })
  assert.deepEqual(value.indexMaintenance, maintenance)
  assert.deepEqual(value.recovery, recovery)
  const rendered = publish.output.render({}, value)[0].text
  assert.match(rendered, /journal recovery is pending/)
  assert.match(rendered, /Do not remove index locks/)
})

test('publication retry reads original blobs under autocrlf and explicit eol attributes', async t => {
  const { root, git, store, command } = await fixture(t)
  await command('config', '--local', 'core.autocrlf', 'true')
  await writeFile(join(root, '.gitattributes'), '*.json text eol=crlf\n*.bin -text\n')
  const binary = Buffer.from([0, 255, 128, 13, 10, 195, 169])
  const input = { ...options('same-event'), artifacts: { 'sample/image.bin': binary }, ownedArtifacts: ['sample/image.bin'] }
  const first = await store.write('sample', { label: '中文', order: 1 }, input)
  const retry = await store.write('sample', { label: '中文', order: 1 }, input)
  assert.equal(retry.commit, first.commit)
  assert.equal(await git.head(), first.commit)
  assert.deepEqual(Buffer.from(await git.readBytesAt(first.commit, 'sample/image.bin')), binary)
  assert.equal(Buffer.from(await git.readBytesAt(first.commit, 'sample/sample.json')).includes(13), false)
  assert.equal((await command('config', '--local', '--get', 'core.autocrlf')).stdout.trim(), 'true')
  await assert.rejects(store.write('sample', { label: '中文', order: 2 }, input), /reused with different bytes/)
  await assert.rejects(store.write('sample', { label: '中文', order: 1 }, { ...input, artifacts: { 'sample/image.bin': Buffer.from([1]) } }), /reused with different bytes/)
  await assert.rejects(store.write('sample', { label: '中文', order: 1 }, { ...input, artifacts: {}, ownedArtifacts: [] }), /different artifact set/)
  assert.equal(await git.head(), first.commit)
})

test('raw committed artifact reads never execute a checkout filter', async t => {
  const { root, git, store, command } = await fixture(t)
  await writeFile(join(root, '.gitattributes'), '*.json filter=reject\n')
  await command('config', '--local', 'filter.reject.smudge', 'a-command-that-does-not-exist')
  await command('config', '--local', 'filter.reject.required', 'true')
  const first = await store.write('sample', { a: 1 }, options('filter-safe'))
  assert.equal(Buffer.from(await git.readBytesAt(first.commit, 'sample/sample.json')).toString(), '{\n  "a": 1\n}\n')
  assert.equal((await store.write('sample', { a: 1 }, options('filter-safe'))).commit, first.commit)
})

test('size limits, missing artifacts and non-regular Git entries retain their guards', async t => {
  const { root, git, store, command } = await fixture(t)
  const first = await store.write('sample', { a: 1 }, options('bounded'))
  await assert.rejects(git.readBytesAt(first.commit, 'sample/sample.json', undefined, 1), /exceeds 1 bytes/)
  assert.equal(await git.readBytesAt(first.commit, 'sample/missing.bin'), undefined)
  await mkdir(join(root, 'design_files', 'sample'), { recursive: true })
  await symlink('sample.json', join(root, 'design_files', 'sample', 'link'))
  await command('add', '--', 'design_files/sample/link')
  await command('-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-m', 'symlink')
  await assert.rejects(git.readBytesAt(await git.head(), 'sample/link'), /not a regular file/)
  await assert.rejects(git.readBytesAt(first.commit, '../escape'), /unsafe path/)
})

test('CLI adapter: binary adapters cannot silently decode or truncate an immutable blob', async t => {
  let corrupt = false, unsupported = false
  const spawn = async request => {
    const result = await nodeDesignProjectSpawn(request)
    if (request.binaryStdout && unsupported) return { ...result, stdoutBytes: undefined, stdout: 'decoded' }
    if (request.binaryStdout && corrupt) return { ...result, stdoutBytes: Buffer.from([1]) }
    return result
  }
  const { git, store } = await fixture(t, spawn)
  const first = await store.write('sample', { a: 1 }, options('adapter'))
  unsupported = true
  await assert.rejects(git.readBytesAt(first.commit, 'sample/sample.json'), /does not support exact binary stdout/)
  unsupported = false; corrupt = true
  await assert.rejects(git.readBytesAt(first.commit, 'sample/sample.json'), /blob integrity mismatch/)
  async function* tooLarge() { yield Buffer.from([1, 2]); yield Buffer.from([3]) }
  await assert.rejects(collectGitStdout(tooLarge(), { maxBytes: 2 }), /exceeded/)
})

test('a foreign index lock defers maintenance without rejecting or duplicating publication', async t => {
  const { root, git, store, command } = await fixture(t)
  const lockPath = join(root, '.git', 'index.lock')
  await writeFile(lockPath, 'foreign-lock-owner\n')
  const settlements = []
  const input = options('locked', async e => { if (!settlements.includes(e.commit)) settlements.push(e.commit) })
  const first = await store.write('sample', { a: 1 }, input)
  assert.equal(first.indexMaintenance.state, 'deferred')
  assert.match(first.indexMaintenance.message, /EEXIST/)
  assert.equal(await git.head(), first.commit)
  assert.deepEqual(settlements, [first.commit])
  assert.equal(await readFile(lockPath, 'utf8'), 'foreign-lock-owner\n')
  assert.equal((await store.write('sample', { a: 1 }, input)).commit, first.commit)
  assert.equal((await command('rev-list', '--count', 'HEAD')).stdout.trim(), '1')
  assert.equal(await readFile(lockPath, 'utf8'), 'foreign-lock-owner\n')
})

test('CLI backend: HEAD CAS failure remains a pre-publication failure and cannot settle', async t => {
  const spawn = async request => request.argv[1] === 'update-ref'
    ? { exitCode: 128, stdout: '', stderr: 'injected HEAD CAS conflict' }
    : nodeDesignProjectSpawn(request)
  const { git, store } = await fixture(t, spawn)
  let settled = 0
  await assert.rejects(store.write('sample', { a: 1 }, options('cas', async () => settled++)), /HEAD CAS conflict/)
  assert.equal(await git.head(), undefined)
  assert.equal(settled, 0)
})

test('CLI backend: an external stage between publication and reconciliation survives intact', async t => {
  let onPublished
  const spawn = async request => {
    const result = await nodeDesignProjectSpawn(request)
    if (request.argv[1] === 'update-ref' && result.exitCode === 0 && onPublished) await onPublished(request.cwd)
    return result
  }
  const { root, git, store, command } = await fixture(t, spawn)
  await store.write('sample', { a: 0 }, options('initial'))
  onPublished = async () => {
    await writeFile(join(root, 'design_files/sample/sample.json'), 'external staged\n')
    await command('add', '--', 'design_files/sample/sample.json')
  }
  const next = await store.write('sample', { a: 1 }, options('external-stage'))
  assert.equal((await command('show', ':design_files/sample/sample.json')).stdout, 'external staged\n')
  assert.equal((await git.readTextAt(next.commit, 'sample/sample.json')).includes('"a": 1'), true)
  assert.equal(await readFile(join(root, 'design_files/sample/sample.json'), 'utf8'), 'external staged\n')
})

test('CLI backend: the reconciliation lock prevents an external stage after comparison', async t => {
  let tryStage = false, stageRejected = false
  const spawn = async request => {
    const result = await nodeDesignProjectSpawn(request)
    if (tryStage && request.argv[1] === 'ls-files' && request.env?.GIT_INDEX_FILE?.endsWith('maintenance-index')) {
      tryStage = false
      try { await exec('git', ['add', '--', 'design_files/sample/sample.json'], { cwd: request.cwd }) }
      catch (error) { stageRejected = String(error.stderr).includes('index.lock') }
    }
    return result
  }
  const { root, store, command } = await fixture(t, spawn)
  await store.write('sample', { a: 0 }, options('base'))
  tryStage = true
  await store.write('sample', { a: 1 }, options('locked-compare'))
  assert.equal(stageRejected, true)
  assert.equal((await command('status', '--porcelain=v1')).stdout, '')
  await assert.rejects(readFile(join(root, '.git/index.lock')), { code: 'ENOENT' })
})

test('Journal failure preserves the commit and exact replay repairs settlement', async t => {
  const { git, store, command } = await fixture(t)
  let fail = true, settled = 0, receipt
  const input = options('journal-recovery', async () => { if (fail) throw new Error('injected Journal failure'); settled++ })
  await assert.rejects(store.write('sample', { a: 1 }, input), error => {
    assert.equal(error instanceof DesignWriteSettlementError, true)
    receipt = error.result
    assert.equal(receipt.recovery.stage, 'journal')
    return true
  })
  assert.equal(await git.head(), receipt.commit)
  fail = false
  const retried = await store.write('sample', { a: 1 }, input)
  assert.equal(retried.commit, receipt.commit)
  assert.equal(settled, 1)
  assert.equal((await command('rev-list', '--count', 'HEAD')).stdout.trim(), '1')
  await assert.rejects(store.write('sample', { a: 2 }, input), /reused with different bytes/)
})

test('a diff projection failure settles content and retains its recovery receipt', async t => {
  const { git, store } = await fixture(t)
  const original = git.diffCommit.bind(git)
  git.diffCommit = async () => { throw new Error('injected diff failure') }
  let settled = 0, receipt
  const input = options('diff-recovery', async () => settled++)
  await assert.rejects(store.write('sample', { a: 1 }, input), error => {
    assert.equal(error instanceof DesignWriteSettlementError, true)
    receipt = error.result
    assert.equal(receipt.recovery.stage, 'diff')
    return true
  })
  assert.equal(settled, 1)
  assert.equal(await git.head(), receipt.commit)
  git.diffCommit = original
  assert.equal((await store.write('sample', { a: 1 }, input)).commit, receipt.commit)
})

test('reopening repairs the exact event against its original baseline, but fresh stale writes fail', async t => {
  const { root, git, store } = await fixture(t)
  const base = await store.write('sample', { a: 0 }, options('baseline'))
  const input = { ...options('restart', async () => { throw new Error('Journal unavailable') }), expectedHead: base.commit }
  let original
  await assert.rejects(store.write('sample', { a: 1 }, input), error => { original = error.result.commit; return true })
  const reopened = new DesignFilesStore(fs, new GitVersioning(nodeDesignProjectSpawn, root, 'design_files', false, 'cli'), join(root, 'design_files'))
  assert.equal((await reopened.write('sample', { a: 1 }, { ...input, settleEvent: async () => {} })).commit, original)
  await assert.rejects(reopened.write('sample', { a: 2 }, { ...options('fresh-stale'), expectedHead: base.commit }), /publication revision is stale/)
  assert.equal(await git.head(), original)
})

async function workingCopyFixture(t, id, settleEvent, spawn) {
  const { createProducerProjectWorkspace } = await import('../src/producer-project-workspace.ts')
  const f = await fixture(t, spawn)
  await f.store.write('sample', { label: 'base' }, options(`${id}-base`))
  const skill = { name: 'sample', version: '1.0', description: 'fixture', content: '# fixture',
    execution: { mode: 'subagent', handoff: 'none' },
    metadata: { schemaYaml: 'type: object\nrequired: [label]\nproperties:\n  label: { type: string }\n' } }
  const workspace = await createProducerProjectWorkspace({ store: f.store, signal: new AbortController().signal,
    invocationSkill: skill, resolveSkill: name => name === skill.name ? skill : undefined,
    ownsPath: path => path.startsWith('sample/'), publicationInvocationId: id,
    settleEvent, withMutation: action => action() })
  const working = await workspace.openWorkingCopy()
  await working.writeText('sample/sample.json', '{"label":"accepted"}\n')
  return { ...f, workspace, working }
}

test('CLI backend: a closed Producer working copy recovers exact Journal/diff facts without rewriting content', async t => {
  for (const stage of ['journal', 'diff']) {
    let fail = true, armed = false, calls = 0, settled
    const spawn = async request => {
      if (stage === 'diff' && armed && fail && request.argv.includes('show')) {
        fail = false
        throw new Error('temporary committed diff outage')
      }
      return nodeDesignProjectSpawn(request)
    }
    const f = await workingCopyFixture(t, `closed-${stage}`, async (_skill, event) => {
      calls++
      if (stage === 'journal' && fail) { fail = false; throw new Error('temporary Journal outage') }
      settled = event
    }, spawn)
    armed = true
    const first = await f.working.publish('complete', 'complete')
    assert.equal(first.recovery.stage, stage)
    const commits = (await f.command('rev-list', '--count', 'HEAD')).stdout
    await assert.rejects(f.working.writeText('sample/sample.json', '{}'), /closed/)
    await assert.rejects(f.working.publish('complete', 'complete'), /closed/)
    await assert.rejects(f.working.recoverPublication('in_progress', 'handoff'), /cannot change its outcome/)
    first.state.label = 'receipt mutation is not authority'
    // A user's unpublished work must not be overwritten by follow-up recovery.
    await writeFile(join(f.root, 'design_files/sample/sample.json'), '{"label":"new user draft"}\n')
    const recovered = await f.working.recoverPublication('complete', 'complete')
    assert.equal(recovered.recovery, undefined)
    assert.equal(recovered.stateRevision, first.stateRevision)
    assert.equal(recovered.state.label, 'accepted')
    assert.equal(settled.state.label, 'accepted')
    assert.equal((await f.command('rev-list', '--count', 'HEAD')).stdout, commits)
    assert.match(await readFile(join(f.root, 'design_files/sample/sample.json'), 'utf8'), /new user draft/)
    const priorCalls = calls
    await f.working.recoverPublication('complete', 'complete')
    assert.equal(calls, priorCalls, 'a settled receipt never resubmits its event')
    await assert.rejects(f.working.writeText('sample/sample.json', '{}'), /closed/)
  }
})

test('persistent or stale follow-up recovery keeps the original commit and does not reopen mutation authority', async t => {
  let calls = 0
  const f = await workingCopyFixture(t, 'persistent-closed', async () => { calls++; throw new Error('persistent Journal outage') })
  const first = await f.working.publish('complete', 'complete')
  const pending = await f.working.recoverPublication('complete', 'complete')
  assert.equal(pending.stateRevision, first.stateRevision)
  assert.equal(pending.recovery.stage, 'journal')
  assert.equal(calls, 2)
  const newer = await f.store.write('other', { new: true }, { origin: 'agent', settleEvent: async () => {} })
  const stale = await f.working.recoverPublication('complete', 'complete')
  assert.match(stale.recovery.message, /newer project state is preserved/)
  assert.equal(calls, 2, 'stale recovery cannot regress active project projection')
  assert.equal(await f.store.head(), newer.commit)
  assert.equal(stale.stateRevision, first.stateRevision)
  await assert.rejects(f.working.writeText('sample/sample.json', '{}'), /closed/)
  f.working.discard()
  await assert.rejects(f.working.recoverPublication('complete', 'complete'), /no committed publication/)
})

test('the DSH controller actually consumes pending recovery and never changes a committed outcome', async () => {
  let recoveries = 0, publishes = 0
  const signal = new AbortController().signal
  const recovery = { stage: 'journal', state: 'pending', message: 'outage' }
  const controller = registerDshProducerDesignTools({ tools: { register() { return () => {} } } }, {
    publish: async () => { publishes++; return { kind: 'published', stateRevision: 'committed', diff: '', recovery } },
    recoverPublication: async () => {
      recoveries++
      if (recoveries === 1) throw new Error('still down')
      return { stateRevision: 'committed', diff: '' }
    },
  }, { read: async () => undefined }, 'none', { focus() {}, observeTool() {} })
  const first = await controller.settle('complete', signal)
  assert.equal(first.recovery.message, 'still down')
  assert.equal(recoveries, 1, 'initial publication makes one bounded Host recovery attempt')
  assert.equal((await controller.settle('handoff', signal)).kind, 'invalid')
  assert.equal(recoveries, 1)
  assert.equal((await controller.settle('complete', signal)).recovery, undefined)
  assert.equal(controller.finished().recovery, undefined)
  await controller.settle('complete', signal)
  assert.equal(recoveries, 2, 'settled exact retry returns its cache')
  assert.equal(publishes, 1)
})

test('the enclosing execution transition and run tool retain committed follow-up facts', async () => {
  const { engageDesignExecution } = await import('../src/design-execution-runtime.ts')
  const { apply, renderResult } = await import('../src/dsh-run-design-skill-tool.ts')
  const recovery = { stage: 'journal', state: 'pending', message: 'persistent outage' }
  const maintenance = { state: 'deferred', message: 'foreign lock' }
  for (const handoff of ['none', 'must_edit']) {
    const skill = { name: 'sample', version: '1.0', execution: { mode: 'subagent', handoff } }
    const transition = await engageDesignExecution({ invocationId: 'invocation-a', projectId: '11111111-1111-4111-8111-111111111111',
      kit: { name: 'fixture', version: '1.0', skills: [skill] }, kitVersion: '1.0', skillName: skill.name,
      bundleVersion: '1.0', stateRevision: 'base' }, { brief: 'fixture', currentDesignState: '{}', userContext: '' },
      new AbortController().signal, { producer: { run: async () => ({ kind: 'committed', stateRevision: 'committed',
        stateStatus: handoff === 'none' ? 'complete' : 'pending', recovery, indexMaintenance: maintenance }) } })
    assert.deepEqual(transition.recovery, recovery)
    assert.deepEqual(transition.indexMaintenance, maintenance)
    const result = handoff === 'none'
      ? { kind: 'completed', summary: 'Content generated', stateRevision: transition.pin.stateRevision,
          projectRoot: '/isolated', clarity: { status: 'failed', summary: 'unavailable' }, recovery, indexMaintenance: maintenance }
      : { kind: 'await_user', summary: 'Content ready for editing', gate: transition.gate, recovery, indexMaintenance: maintenance }
    let definition
    apply({ on() {}, tools: { register(tool) { definition = tool } } }, { run: async () => result })
    const value = await definition.execute({ name: 'sample', brief: 'fixture' }, {
      agent: { session: { events: [] } }, signal: new AbortController().signal, callId: 'call-a', concludeTurn() {},
    })
    assert.deepEqual(value.recovery, recovery)
    assert.deepEqual(value.indexMaintenance, maintenance)
    assert.match(renderResult(value), /Committed Design revision: committed/)
    assert.match(renderResult(value), /journal recovery remains pending/)
    assert.match(renderResult(value), /Do not regenerate content/)
    assert.ok(definition.output.schema.oneOf.filter(branch => ['completed', 'await_user'].includes(branch.properties.kind.const))
      .every(branch => branch.properties.recovery && branch.properties.indexMaintenance))
  }
})
