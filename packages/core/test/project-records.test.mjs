import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
