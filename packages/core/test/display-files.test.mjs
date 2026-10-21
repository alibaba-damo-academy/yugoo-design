import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { listDisplayFiles } = await import('../src/display-files.ts')
const { projectWorktreeDesign } = await import('../src/panel-worktree.ts')

test('display polling reads only changed bytes, handles deletion/repair and excludes unrelated trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'display-files-'))
  try {
    await mkdir(join(root, 'research'))
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'node_modules', 'secret'), 'not design output')
    await writeFile(join(root, 'research', 'research.json'), '{"rounds":[]}')
    await writeFile(join(root, 'research', 'a.html'), 'first')
    await writeFile(join(root, 'research', 'b.html'), 'second')
    const reads = []
    const store = {
      listDisplayFiles: names => listDisplayFiles(root, names),
      listWorktreeFiles: () => { throw new Error('must not use Git inventory') },
      readWorktreeText: async path => { reads.push(path); return readFile(join(root, path), 'utf8') },
      readWorktreeBytes: async path => { reads.push(path); return readFile(join(root, path)) },
    }
    const skills = [{ name: 'research', metadata: { panelYaml: 'test-panel' } }]
    const published = { research: { state: { rounds: ['old'] }, origin: 'agent' } }
    let snapshot = await projectWorktreeDesign(store, published, skills, 'base')
    assert.equal(reads.length, 3)
    assert.equal(snapshot.design.research.panelYaml, 'test-panel')
    reads.length = 0
    assert.equal(await projectWorktreeDesign(store, published, skills, 'base', snapshot), snapshot)
    assert.equal(reads.length, 0)
    await writeFile(join(root, 'research', 'a.html'), 'changed')
    snapshot = await projectWorktreeDesign(store, published, skills, 'base', snapshot)
    assert.deepEqual(reads, ['research/a.html'])
    await writeFile(join(root, 'research', 'research.json'), '{')
    await assert.rejects(projectWorktreeDesign(store, published, skills, 'base', snapshot), /incomplete or invalid/)
    await writeFile(join(root, 'research', 'research.json'), '{"rounds":["repaired"]}')
    snapshot = await projectWorktreeDesign(store, published, skills, 'base', snapshot)
    assert.deepEqual(snapshot.design.research.state.rounds, ['repaired'])
    await rm(join(root, 'research', 'research.json'))
    snapshot = await projectWorktreeDesign(store, published, skills, 'base', snapshot)
    assert.equal(snapshot.design.research, undefined, 'do not resurrect a deleted file from publication')
    await symlink(tmpdir(), join(root, 'research', 'escape'))
    await assert.rejects(listDisplayFiles(root, ['research']), /symbolic link/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a first-ever uncommitted Bundle gets current Kit rendering metadata', async () => {
  const store = {
    listWorktreeFiles: async () => [{ path: 'first/first.json', size: 2, mtimeMs: 1, ctimeMs: 1, ino: 1 }],
    readWorktreeText: async () => '{}', readWorktreeBytes: async () => undefined,
  }
  const result = await projectWorktreeDesign(store, {}, [{ name: 'first', metadata: { panelYaml: 'current' } }], 'base')
  assert.equal(result.design.first.panelYaml, 'current')
})
