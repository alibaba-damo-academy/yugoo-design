import test from 'node:test'
import assert from 'node:assert/strict'
import { basename, dirname, resolve } from 'node:path'
import { stringify } from 'yaml'
import { questionSchemaYaml, questionPanelYaml, questionValidationYaml } from './fixtures/declarative-question.mjs'

const { register } = await import('tsx/esm/api')
register()
const { loadDesignKit } = await import('../src/kit-loader.ts')
const { assembleDesignState } = await import('../src/renderer.ts')

const kitRoot = resolve('/virtual-auto-presentation-kit')
const target = resolve(kitRoot, 'skills/questions_fixture')
const targetManifest = resolve(target, 'skill.yaml')

function fixture(presentation, omitPanelSlots = true) {
  const files = new Map([
    [resolve(kitRoot, 'mindset.md'), '---\nname: test_catalog\nversion: "0.1"\n---\n<design_skills>\n## questions_fixture\n</design_skills>\n'],
    [targetManifest, stringify({ name: 'questions_fixture', version: '0.1',
      title: { zh: '问题', en: 'Questions' }, label: { zh: '问题', en: 'Questions' },
      execution: { mode: 'main', handoff: 'none' } }) + presentation],
    [resolve(target, 'SKILL.md'), '---\nname: questions_fixture\ndescription: Synthetic presentation fixture.\n---\nReview saved answers.\n'],
    [resolve(target, 'schema.yaml'), questionSchemaYaml],
    [resolve(target, 'validation.yaml'), questionValidationYaml],
    ...(!omitPanelSlots ? [[resolve(target, 'panel.yaml'), questionPanelYaml]] : []),
  ])
  return {
    readText: async path => files.get(path),
    listDir: async path => [...new Set([...files.keys()].filter(file => dirname(file) === path).map(file => basename(file))
      .concat(path === resolve(kitRoot, 'skills') ? ['questions_fixture'] : []))],
    isDirectory: async path => [...files.keys()].some(file => file.startsWith(`${path}/`)),
  }
}

async function load(presentation, omitPanelSlots = true) {
  return loadDesignKit(fixture(presentation, omitPanelSlots), kitRoot, { sourceId: 'test:auto-presentation' })
}

test('omitted presentation loads as none without silently opting into auto', async () => {
  const kit = await load('')
  const skill = kit.skills.find(entry => entry.name === 'questions_fixture')
  assert.deepEqual(skill.metadata.skillManifest.presentation, { mode: 'none' })
  assert.match(assembleDesignState([skill], [{ skill: skill.name, state: { questions: { q1: { prompt: 'Why?', answer: '' } } } }]), /questions_fixture/)
})

test('auto is explicit, requires no renderer, and does not require panel.yaml', async () => {
  const kit = await load('presentation:\n  mode: auto\n')
  const skill = kit.skills.find(entry => entry.name === 'questions_fixture')
  assert.equal(skill.metadata.skillManifest.presentation.mode, 'auto')
  assert.equal(skill.metadata.panelYaml, undefined)
})

test('auto rejects a renderer and stale declarative slots', async () => {
  await assert.rejects(load('presentation:\n  mode: auto\n  renderer: pilot-design/v2\n'), /cannot declare renderer/)
  await assert.rejects(load('presentation:\n  mode: auto\n', false), /does not declare declarative presentation/)
})
