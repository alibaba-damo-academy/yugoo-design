import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncKnowledgeFile, syncKnowledgeDirectory } from '../src/durability.ts'

test('backup flush preserves bytes and directory flush uses native platform semantics', async t => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-durability-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'backup'), bytes = Buffer.from([0, 255, 1, 128, 13, 10])
  await writeFile(file, bytes)
  if (process.platform === 'win32') {
    const readonly = await open(file, 'r')
    try { await assert.rejects(readonly.sync(), { code: 'EPERM' }) }
    finally { await readonly.close() }
  }
  await syncKnowledgeFile(file)
  await syncKnowledgeDirectory(root)
  assert.deepEqual(await readFile(file), bytes)
  await assert.rejects(syncKnowledgeDirectory(file))
})

test('missing backups and directories are errors, not successful flushes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-durability-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const missing = join(root, 'missing')
  await assert.rejects(syncKnowledgeFile(missing), { code: 'ENOENT' })
  await assert.rejects(syncKnowledgeDirectory(missing), { code: 'ENOENT' })
})
