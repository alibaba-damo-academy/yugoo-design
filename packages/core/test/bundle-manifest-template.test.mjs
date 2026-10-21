import assert from 'node:assert/strict'
import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { loadDesignKit } from '../src/kit-loader.ts'
import { questionSchemaYaml, questionPanelYaml, questionValidation } from './fixtures/declarative-question.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const asset = '.agents/skills/design-bundle-creator/assets/skill.template.yaml'
const template = await readFile(resolve(repo, asset), 'utf8')
const manifest = parse(template)
const slots = { 'schema.yaml': questionSchemaYaml, 'panel.yaml': questionPanelYaml,
  'validation.yaml': stringify({ ...questionValidation, skill: 'example_bundle' }) }

// Exercise the real loader with an in-memory content Kit. Other slots reuse a
// minimal compatible synthetic slots to isolate this manifest test; no user project,
// installed Kit, model execution, UI persistence or publication is claimed.
async function load(value = manifest) {
  const root = resolve(repo, '.manifest-template-fixture-not-written')
  const bundle = resolve(root, 'skills/example_bundle')
  const files = new Map([
    [resolve(root, 'mindset.md'), '---\nname: template_fixture\nversion: "0.1"\n---\n<design_skills>\n## example_bundle\n</design_skills>\n'],
    [resolve(bundle, 'skill.yaml'), stringify(value)],
    [resolve(bundle, 'SKILL.md'), '---\nname: example_bundle\ndescription: Manifest loader fixture only.\n---\nNo execution or user facts.\n'],
    ...Object.entries(slots).map(([name, text]) => [resolve(bundle, name), text]),
  ])
  return loadDesignKit({
    readText: async path => files.get(path),
    listDir: async path => [...new Set([...files.keys()].filter(file => dirname(file) === path).map(file => basename(file))
      .concat(path === resolve(root, 'skills') ? ['example_bundle'] : []))],
    isDirectory: async path => [...files.keys()].some(file => file.startsWith(path + '/')),
  }, root, { sourceId: 'manifest-template-source-test' })
}

test('documented copyable manifest is reachable and passes actual declarative Kit loading', async () => {
  const doc = await readFile(resolve(repo, 'docs/bundle-contract.md'), 'utf8')
  assert.equal(doc.split(`](../${asset})`).length - 1, 2)
  assert.doesNotMatch(doc, /all\s+existing manifests share its field order and comments/)
  assert.doesNotMatch(doc, /exactly five items|Every Design Bundle body must own a/)
  assert.match(doc, /not a loader-required item count/)
  assert.match(doc, /actual validation and completion evidence/)
  const kit = await load()
  const skill = kit.skills[0]
  assert.equal(kit.skills.length, 1)
  assert.equal(skill.name, 'example_bundle')
  assert.equal(skill.version, '0.1')
  assert.equal(skill.execution.mode, 'main')
  assert.equal(skill.execution.handoff, 'must_edit')
  assert.equal(skill.metadata.skillManifest.presentation.mode, 'declarative')
  assert.equal(skill.metadata.skillManifest.presentation.renderer, 'pilot-design/v2')
})

test('actual loader rejects mismatched identity, invalid versions and incompatible manifest policies', async () => {
  for (const [change, expected] of [
    [{ name: 'other_bundle' }, /name must equal directory/],
    [{ version: 1 }, /version must be a string/],
    ...['01.0', '1.01', '1.0.0', '1.0-beta'].map(version => [{ version }, /expected major.minor/]),
    [{ title: undefined }, /title must be a bilingual object/],
    [{ label: { zh: '有效', en: ' ' } }, /label.en must be a non-empty string/],
    [{ execution: { mode: 'background', handoff: 'must_edit' } }, /execution.mode/],
    [{ execution: { mode: 'main', handoff: 'user_continue' } }, /resume_action/],
    [{ presentation: { mode: 'declarative', renderer: 'invented' } }, /declarative presentation only supports renderer/],
  ]) await assert.rejects(load({ ...manifest, ...change }), expected)
})

test('minimal manifest preserves the explicit interpreter and sole method description', async () => {
  assert.equal(manifest.description, undefined)
  assert.equal(manifest.presentation.renderer, undefined)
  const minimal = (await load()).skills[0]
  const explicit = (await load({ ...manifest, presentation: { mode: 'declarative', renderer: 'pilot-design/v2' } })).skills[0]
  assert.deepEqual(minimal.metadata.skillManifest.presentation, explicit.metadata.skillManifest.presentation)
  assert.deepEqual(minimal.execution, explicit.execution)
  assert.deepEqual(minimal.metadata.panelManifest, explicit.metadata.panelManifest)
  assert.deepEqual(minimal.metadata.rendererManifest, explicit.metadata.rendererManifest)
  assert.equal(minimal.description, 'Manifest loader fixture only.')
  assert.equal(minimal.content, explicit.content)
  assert.equal(minimal.pickerDescription, undefined)
  await assert.rejects(load({ ...manifest, presentation: { mode: 'native' } }), /native presentation requires renderer/)
  await assert.rejects(load({ ...manifest, description: { zh: '不完整' } }), /description.en/)
})

test('Web App manifest authoring headers do not point to the removed sibling template', async () => {
  const root = fileURLToPath(webAppBundleUrl())
  const entries = await readdir(root, { withFileTypes: true })
  let documented = 0
  for (const entry of entries.filter(entry => entry.isDirectory())) {
    const slots = await readdir(resolve(root, entry.name))
    if (!slots.includes('skill.yaml')) continue // Legacy non-Bundle directories have no manifest.
    const text = await readFile(resolve(root, entry.name, 'skill.yaml'), 'utf8')
    assert.doesNotMatch(text, /See \.\.\/skill\.template\.yaml/)
    if (text.startsWith('# Skill manifest. Repository authoring guide: docs/bundle-contract.md.')) documented++
  }
  assert.equal(documented, 13)
  assert.ok((await readFile(resolve(repo, 'docs/bundle-contract.md'), 'utf8')).length > 0)
})
