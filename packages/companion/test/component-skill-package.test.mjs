import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyComponentSkill, COMPONENT_SKILL_SOURCE } from '../component-skill-package.mjs'

test('host package slot copies one byte-identical self-contained Skill and never overwrites another', async () => {
  const root = await mkdtemp(join(tmpdir(), 'component-skill-'))
  try {
    const expected = await readFile(COMPONENT_SKILL_SOURCE, 'utf8')
    for (const host of ['claude-code', 'qoder']) {
      const target = join(root, host); await mkdir(target)
      const path = await copyComponentSkill(target)
      assert.equal(await readFile(path, 'utf8'), expected)
      await assert.rejects(copyComponentSkill(target), { code: 'EEXIST' })
    }
    assert.match(expected, /name: design-component/)
    assert.match(expected, /generated: true/)
    assert.match(expected, /installed plugin/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
