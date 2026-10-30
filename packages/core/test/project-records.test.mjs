import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
const { register } = await import('tsx/esm/api'); register()
const { NativeGitExecutor } = await import('../src/git-native-executor.ts')
// The production native worker is a built .js entry, not a tsx child process.
import { DesignProjectManager, nodeDesignProjectSpawn, GitVersioning,
  commitDesignProjectRecords, designProjectRecordsRoot } from '../lib/index.js'

async function fixture(run) {
  const temp = await mkdtemp(join(tmpdir(), 'yugoo-project-records-'))
  try {
    const root = join(temp, 'project')
    await new DesignProjectManager().create({ root, name: 'Records fixture', knowledge: { provider: 'ladybug-wasm' } })
    const git = new GitVersioning(nodeDesignProjectSpawn, root)
    await run({ root, git, temp })
  } finally { await rm(temp, { recursive: true, force: true }) }
}

// The interleaving happens after real commit preparation and before the real
// native CAS, rather than simulating a successful publication or stubbing Git.
async function publisher(beforePublish, run) {
  const executor = new NativeGitExecutor(() => new Worker(new URL('../lib/git-native-worker.js', import.meta.url), { execArgv: [] }))
  let attempts = 0
  const spawn = Object.assign(request => nodeDesignProjectSpawn(request), { native: async request => {
    if (request.operation.kind === 'publish' && request.operation.message === 'Publish tested record') await beforePublish(++attempts, request)
    return executor.execute(request)
  } })
  try { await run(spawn, () => attempts) } finally { await executor.close() }
}

test('record-only commits between preparation and native CAS retry frozen bytes without consuming user WIP', async () => fixture(async ({ root, git }) => {
  await mkdir(join(root, 'design_records/knowledge'), { recursive: true })
  const path = 'design_records/clarity.json', content = 'exact pending assessment'
  await writeFile(join(root, path), content)
  await writeFile(join(root, 'user-wip.txt'), 'keep local')
  const before = await git.head()
  await publisher(async attempt => {
    if (attempt === 1) await git.commitExact('Concurrent KAG records', new Map([['design_records/knowledge/archive.json', '{}']]), await git.head())
  }, async (spawn, attempts) => {
    const committed = await commitDesignProjectRecords({ projectRoot: root, paths: [path], message: 'Publish tested record', expectedHead: before, spawn })
    assert.equal(attempts(), 2)
    assert.equal(await git.readTextAt(committed, path), content)
    assert.equal(await git.readTextAt(committed, 'design_records/knowledge/archive.json'), '{}')
    assert.equal(await git.designEvidenceRevisionAt(committed), await git.designEvidenceRevisionAt(before))
    assert.equal(await git.readTextAt(committed, 'user-wip.txt'), undefined)
    assert.equal(await readFile(join(root, 'user-wip.txt'), 'utf8'), 'keep local')
  })
}))

test('true Design changes during the same native CAS window reject the old assessment', async () => fixture(async ({ root, git }) => {
  await mkdir(join(root, 'design_records'), { recursive: true })
  const path = 'design_records/clarity.json'
  await writeFile(join(root, path), 'old assessment input')
  await publisher(async () => {
    await git.commitExact('New Design evidence', new Map([['design_files/new/facts.json', '{"new":true}']]), await git.head())
  }, async (spawn, attempts) => {
    await assert.rejects(commitDesignProjectRecords({ projectRoot: root, paths: [path], message: 'Publish tested record', spawn }), /Design evidence changed/)
    assert.equal(attempts(), 1)
    assert.equal(await git.readTextAt(await git.head(), path), undefined)
    assert.equal(await git.readTextAt(await git.head(), 'design_files/new/facts.json'), '{"new":true}')
  })
}))

test('a target committed since the caller checkpoint conflicts even before publication preparation', async () => fixture(async ({ root, git }) => {
  const path = 'design_records/clarity.json', before = await git.head()
  await mkdir(join(root, 'design_records'), { recursive: true })
  await writeFile(join(root, path), 'caller candidate')
  await git.commitExact('Other assessment before preparation', new Map([[path, 'other committed assessment']]), before)
  await assert.rejects(commitDesignProjectRecords({ projectRoot: root, paths: [path], expectedHead: before,
    message: 'Publish tested record' }), /committed target changed/)
  assert.equal(await git.readTextAt(await git.head(), path), 'other committed assessment')
  assert.equal(await readFile(join(root, path), 'utf8'), 'caller candidate')
}))

for (const changed of ['committed target', 'local target']) test(`${changed} is never absorbed or overwritten by a record retry`, async () => fixture(async ({ root, git }) => {
  await mkdir(join(root, 'design_records'), { recursive: true })
  const path = 'design_records/clarity.json'
  await writeFile(join(root, path), 'caller frozen bytes')
  await publisher(async () => {
    if (changed === 'committed target') {
      await git.commitExact('Other assessment', new Map([[path, 'other committed assessment']]), await git.head())
    } else {
      await writeFile(join(root, path), 'new local writer bytes')
      await git.commitExact('Other record', new Map([['design_records/reviews/test.json', '{}']]), await git.head())
    }
  }, async (spawn, attempts) => {
    await assert.rejects(commitDesignProjectRecords({ projectRoot: root, paths: [path], message: 'Publish tested record', spawn }), /target.*changed/)
    assert.equal(attempts(), 1)
    assert.equal(await git.readTextAt(await git.head(), path), changed === 'committed target' ? 'other committed assessment' : undefined)
    assert.equal(await readFile(join(root, path), 'utf8'), changed === 'committed target' ? 'caller frozen bytes' : 'new local writer bytes')
  })
}))

test('repeated CAS contention stays bounded and cannot report a missing commit as success', async () => fixture(async ({ root, git }) => {
  await mkdir(join(root, 'design_records'), { recursive: true })
  const path = 'design_records/clarity.json'
  await writeFile(join(root, path), 'pending')
  await publisher(async attempt => {
    await git.commitExact('Continued contention', new Map([['design_records/reviews/test.json', String(attempt)]]), await git.head())
  }, async (spawn, attempts) => {
    await assert.rejects(commitDesignProjectRecords({ projectRoot: root, paths: [path], message: 'Publish tested record', spawn }), /stale-publication/)
    assert.equal(attempts(), 3)
    assert.equal(await git.readTextAt(await git.head(), path), undefined)
  })
}))

for (const failure of ['io', 'cancel']) test(`${failure} is not swallowed or retried as record contention`, async () => fixture(async ({ root, git }) => {
  await mkdir(join(root, 'design_records'), { recursive: true })
  const path = 'design_records/clarity.json', controller = new AbortController()
  await writeFile(join(root, path), 'pending')
  await publisher(async () => {
    if (failure === 'io') throw Error('Injected publication I/O failure')
    controller.abort()
    throw Error('design git native: stale-publication')
  }, async (spawn, attempts) => {
    await assert.rejects(commitDesignProjectRecords({ projectRoot: root, paths: [path], message: 'Publish tested record', signal: controller.signal, spawn }),
      failure === 'io' ? /publication I\/O failure/ : { name: 'AbortError' })
    assert.equal(attempts(), 1)
    assert.equal(await git.readTextAt(await git.head(), path), undefined)
  })
}))

test('project records are versioned, explicit-path only, and do not invalidate their assessed Design commit', async () => fixture(async ({ root, git }) => {
  const before = await git.head(), evidence = await git.designEvidenceRevisionAt(before)
  assert.equal(designProjectRecordsRoot(root), join(root, 'design_records'))
  await mkdir(join(root, 'design_records/journal'), { recursive: true })
  await writeFile(join(root, 'design_records/clarity.json'), JSON.stringify({ assessedCheckpoint: before, summary: 'Saved reasoning' }))
  await writeFile(join(root, 'design_records/journal/project.jsonl'), '{}\n')
  await writeFile(join(root, 'unrelated.txt'), 'User WIP')
  const commit = await commitDesignProjectRecords({ projectRoot: root, paths: ['design_records/clarity.json', 'design_records/journal/project.jsonl'], message: 'Record assessment', expectedHead: before })
  assert.notEqual(commit, before)
  assert.equal(await git.designEvidenceRevisionAt(commit), evidence)
  assert.match(await git.readTextAt(commit, 'design_records/clarity.json'), /Saved reasoning/)
  assert.equal(await git.readTextAt(commit, 'unrelated.txt'), undefined)
  assert.equal(await readFile(join(root, 'unrelated.txt'), 'utf8'), 'User WIP')
  assert.equal(await commitDesignProjectRecords({ projectRoot: root, paths: ['design_records/clarity.json'], message: 'No duplicate', expectedHead: before }), undefined)
}))

test('only declared auxiliary records are excluded; wrong version, traversal and symlinks remain rejected', async () => fixture(async ({ root, git, temp }) => {
  const before = await git.head(), evidence = await git.designEvidenceRevisionAt(before)
  await mkdir(join(root, 'design_records'), { recursive: true })
  await writeFile(join(root, 'design_records/source.json'), '{"originalKnowledge":true}')
  const fact = await commitDesignProjectRecords({ projectRoot: root, paths: ['design_records/source.json'], message: 'Original knowledge fact' })
  assert.notEqual(await git.designEvidenceRevisionAt(fact), evidence)
  await writeFile(join(root, 'design_records/clarity.json'), '{}')
  await assert.rejects(commitDesignProjectRecords({ projectRoot: root, paths: ['design_records/clarity.json'], message: 'Obsolete', expectedHead: before }), /evidence changed/)
  for (const path of ['project.json', 'design_records/../project.json', 'design_records/.git/config']) {
    await assert.rejects(commitDesignProjectRecords({ projectRoot: root, paths: [path], message: 'Invalid' }))
  }
  await mkdir(join(temp, 'external'))
  await writeFile(join(temp, 'external/value.json'), '{}')
  await symlink(join(temp, 'external'), join(root, 'design_records/escape'))
  await assert.rejects(commitDesignProjectRecords({ projectRoot: root, paths: ['design_records/escape/value.json'], message: 'Invalid' }), /symbolic link/)
  assert.equal(await git.head(), fact)
}))
