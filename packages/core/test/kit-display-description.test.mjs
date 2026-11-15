import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { loadDesignKit } from '../src/kit-loader.ts'
import { renderDesignSkillCatalog } from '../src/design-core-prompt.ts'

const mindsetPath = fileURLToPath(new URL('../../skills-web-app/kits/web_app/mindset.md', import.meta.url))
const kitManifestPath = fileURLToPath(new URL('../../skills-web-app/kits/web_app/kit.yaml', import.meta.url))
const original = await readFile(mindsetPath, 'utf8')
const withoutDisplay = original.replace(/\ndisplay_description:\n[\s\S]*?(?=\n---)/, '')
const fs = (source, changeMounts) => ({
  async readText(path) {
    if (path === mindsetPath) return source
    try {
      const text = await readFile(path, 'utf8')
      return changeMounts && path === kitManifestPath ? changeMounts(text) : text
    } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  },
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
})
// Read source content explicitly; package discovery deliberately targets built lib/.
const bundlesDir = fileURLToPath(new URL('../../skills-web-app/bundles/', import.meta.url))
const sourceLocation = {
  rootDir: fileURLToPath(new URL('../../skills-web-app/kits/web_app/', import.meta.url)),
  mindsetPath, skillsDir: bundlesDir, bundlesDir,
}
const load = (source, changeMounts) => loadDesignKit(fs(source, changeMounts), sourceLocation, { sourceId: 'fixture:kit-display-copy' })

test('official Web App keeps ordered membership while mounted descriptions supply the full routing catalog', async () => {
  const kit = await load(original)
  const mounts = parse(await readFile(`${sourceLocation.rootDir}/kit.yaml`, 'utf8')).mounts
  const names = mounts.map(mount => mount.bindingKey)
  assert.equal(names.length, 15)
  assert.ok(!kit.mindset.includes('<design_skills>'), 'official Mindset does not duplicate runtime membership')
  assert.deepEqual(kit.skills.map(skill => skill.name), names)
  assert.equal(kit.mindsetSource, original, 'loading preserves the complete saved source')

  const catalog = renderDesignSkillCatalog(kit)
  assert.deepEqual([...catalog.matchAll(/^- id: (.+)$/gm)].map(match => match[1]), names)
  for (const skill of kit.skills) {
    const source = await readFile(`${bundlesDir}/${skill.name}/SKILL.md`, 'utf8')
    const metadata = parse(source.match(/^---\n([\s\S]*?)\n---/)[1])
    assert.equal(skill.description, metadata.description, `${skill.name}: mounted frontmatter owns routing`)
    for (const text of [skill.description, skill.title.zh, skill.title.en, skill.label.zh, skill.label.en]) {
      assert.ok(catalog.includes(text), `${skill.name}: routing description and exact bilingual choices remain model-visible`)
    }
  }
  const descriptions = Object.fromEntries(kit.skills.map(skill => [skill.name, skill.description]))
  for (const pattern of [/same canonical records/, /execute tools/, /configure the coding host/, /confirmation choices/]) {
    assert.match(descriptions.ai_agent_capabilities, pattern)
  }
  for (const pattern of [/URL/, /API Secret requirements/, /usage Prompt/, /optional product-side remarks/, /recovery/]) {
    assert.match(descriptions.integration_design, pattern)
  }
  for (const pattern of [/observable functional scenarios/, /grounded, measurable targets/, /material quality concerns/]) {
    assert.match(descriptions.quality_acceptance, pattern)
  }
  assert.match(descriptions.whiteboard, /same scene file as the user/)
  assert.match(descriptions.whiteboard, /do not substitute.*explicitly requested formal BPMN/)
})

test('custom Mindset catalog prose remains saved and model-visible without generic stripping', async () => {
  const rule = 'A restored request must retain its observed rejection reason and handoff owner.'
  const source = original.replace(/^name: web_app$/m, 'name: custom_catalog')
    + `\n<design_skills>\n## smart_questions\n\n${rule}\n</design_skills>\n`
  const kit = await load(source)
  assert.equal(kit.name, 'custom_catalog')
  assert.equal(kit.mindsetSource, source)
  assert.ok(kit.mindset.includes(rule))
  assert.ok(!kit.skills.find(skill => skill.name === 'smart_questions').description.includes(rule),
    'custom domain instructions do not replace the mounted Bundle routing description')
})

test('legacy Mindset headings cannot override or gate exact mounts', async () => {
  const legacy = `${original}\n<design_skills>\n## ghost_bundle\n\nKeep this custom domain rule.\n## ghost_bundle\n</design_skills>\n`
  const kit = await load(legacy)
  const expected = parse(await readFile(`${sourceLocation.rootDir}/kit.yaml`, 'utf8')).mounts
  assert.deepEqual(kit.skills.map(skill => skill.name), expected.map(mount => mount.bindingKey))
  assert.equal(kit.mindsetSource, legacy)
  assert.ok(kit.mindset.includes('Keep this custom domain rule.'))
  assert.ok(!renderDesignSkillCatalog(kit).includes('ghost_bundle'))
})

test('the manifest alone changes catalog order and membership without rewriting Mindset', async () => {
  const kit = await load(original, text => {
    const manifest = parse(text)
    manifest.mounts = manifest.mounts.filter(mount => mount.bindingKey !== 'whiteboard').reverse()
    return JSON.stringify(manifest)
  })
  const expected = parse(await readFile(`${sourceLocation.rootDir}/kit.yaml`, 'utf8')).mounts
    .map(mount => mount.bindingKey).filter(name => name !== 'whiteboard').reverse()
  assert.deepEqual(kit.skills.map(skill => skill.name), expected)
  assert.deepEqual([...renderDesignSkillCatalog(kit).matchAll(/^- id: (.+)$/gm)].map(match => match[1]), expected)
  assert.equal(kit.mindsetSource, original)
  assert.ok(!kit.resources['whiteboard/SKILL.md'])
})

test('optional Kit display copy is bilingual while methods, routing and exact mounts remain unchanged', async () => {
  const translated = await load(original), legacy = await load(withoutDisplay)
  assert.ok(translated.pickerDescription.zh.includes('Web App'))
  assert.ok(translated.pickerDescription.en.includes('web app designs'))
  assert.equal(legacy.pickerDescription, undefined)
  assert.equal(translated.description, legacy.description)
  assert.equal(translated.mindset, legacy.mindset)
  assert.equal(translated.mindsetSource, original)
  // Each load receives a fresh caller-owned filesystem adapter, not different content.
  const definitions = kit => kit.skills.map(({ sourceFs, ...skill }) => skill)
  assert.deepEqual(definitions(translated), definitions(legacy))
  assert.deepEqual(translated.resources, legacy.resources)
  assert.ok(Object.isFrozen(translated.pickerDescription))
})

test('present invalid Kit display copy fails actual loading rather than guessing a language', async () => {
  for (const value of ['plain text', '{zh: 中文}', '{zh: 中文, en: 12}', '{zh: " ", en: English}', '[中文, English]']) {
    const source = withoutDisplay.replace('\n---', `\ndisplay_description: ${value}\n---`)
    await assert.rejects(load(source), /display_description.*description/)
  }
})
