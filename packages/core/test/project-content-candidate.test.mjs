import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectContentCandidate } from '../lib/index.js'

test('candidate capability confines writes, rejects symlink ancestors and requires complete definition pages', async t => {
  const root = await mkdtemp(join(tmpdir(), 'candidate-capability-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'candidate/design_files'), { recursive: true })
  const outside = join(root, 'live'); await mkdir(outside)
  const definitions = join(root, 'definitions.json')
  await writeFile(definitions, JSON.stringify({ source: { method: 's'.repeat(24001) }, target: { method: 'target method' } }))
  const cap = new ProjectContentCandidate(join(root, 'candidate'), definitions)
  for (const path of ['../project.json', '/tmp/escaped', 'a/../../live', 'a\\b', 'C:/live', 'a//b']) {
    await assert.rejects(cap.write(path, '{}'), /relative path/)
  }
  await symlink(outside, join(root, 'candidate/design_files/escape'))
  await assert.rejects(cap.write('escape/changed.json', '{}'), /unsafe candidate parent/)
  await assert.rejects(cap.list(), /regular candidate|unsafe candidate/)
  await rm(join(root, 'candidate/design_files/escape'))
  await cap.write('example/example.json', '{"savedFact":"unchanged"}')
  assert.deepEqual(await cap.list(), ['example/example.json'])
  assert.equal((await cap.read('example/example.json', 0)).text, '{"savedFact":"unchanged"}')
  await assert.rejects(cap.readDefinition('source', 1), /invalid definition/)
  await cap.readDefinition('source', 0); await cap.readDefinition('target', 0)
  assert.throws(() => cap.assertDefinitionsRead(), /both complete/)
  await cap.readDefinition('source', 12000); await cap.readDefinition('source', 24000)
  cap.assertDefinitionsRead()
  assert.equal(await readFile(join(root, 'candidate/design_files/example/example.json'), 'utf8'), '{"savedFact":"unchanged"}')
})
