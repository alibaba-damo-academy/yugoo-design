import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { parse } from 'yaml'

test('DSH guide distinguishes official declarative content from the retained native provider', async () => {
  const skills = webAppBundleUrl('')
  const directories = (await readdir(skills, { withFileTypes: true })).filter(entry => entry.isDirectory())
  let declarations = 0
  for (const entry of directories) {
    let text
    try { text = await readFile(new URL(`${entry.name}/panel.yaml`, skills), 'utf8') }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    const panel = parse(text)
    assert.equal(panel.version, 1, entry.name)
    assert.equal(typeof panel.ui?.component, 'string', entry.name)
    declarations++
  }
  assert.equal(declarations, 14)
  const guide = await readFile(new URL('../../dsh/README.md', import.meta.url), 'utf8')
  assert.match(guide, /14 Bundles now declare their presentations/)
  assert.match(guide, /not the default presentation contract/)
  assert.match(guide, /explicitly selected native Web App presentations/)
  assert.match(guide, /native-equivalence acceptance remains separate/)
  assert.doesNotMatch(guide, /native React Panels referenced by\s+those Bundles/)
  const loader = await readFile(new URL('../../dsh/cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(loader, /name: dsh-design-provider-web-app/)
  assert.match(loader, /packageName: dsh-design-skills-web-app/)
})
