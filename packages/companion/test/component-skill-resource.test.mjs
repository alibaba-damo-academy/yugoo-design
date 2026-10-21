import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { componentSkillResource } from '../../../scripts/component-skill-resource.ts'
import { COMPONENT_SKILL_SOURCE } from '../component-skill-package.mjs'

test('production raw loader embeds the exact canonical Skill without browser filesystem code', async () => {
  const plugin = componentSkillResource()
  const importer = fileURLToPath(new URL('../src/studio-components.tsx', import.meta.url))
  const id = plugin.resolveId('../plugin/design-system/skills/design-component/SKILL.md?raw', importer)
  assert.equal(id, `${COMPONENT_SKILL_SOURCE}?raw`)
  const loaded = await plugin.load(id)
  assert.equal(JSON.parse(loaded.code.replace(/^export default /u, '')), await readFile(COMPONENT_SKILL_SOURCE, 'utf8'))
  assert.equal(loaded.moduleType, 'js')
  assert.equal(plugin.resolveId('other/file.md?raw', importer), null)
  assert.equal(await plugin.load('/not-a-skill.md?raw'), null)
  assert.doesNotMatch(loaded.code, /import.*node:fs/)
})
