import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { PANEL_AUTHORING_RESOURCE, panelAuthoringInputPaths, preparePanelAuthoringMaterial,
  writePanelAuthoringMaterial, verifyPanelAuthoringMaterial } from './companion-authoring-material.mjs'

const workspace = fileURLToPath(new URL('../', import.meta.url))
let preparation
const prepare = () => preparation ??= preparePanelAuthoringMaterial(workspace)
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'companion-authoring-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('normal material generation covers the source catalog and all source examples', async t => {
  const prepared = await prepare(), root = await fixture(t)
  assert.deepEqual(Object.keys(prepared.material.components),
    Object.keys(JSON.parse(prepared.material.catalogIdentity).catalog),
    'material must cover the exact source catalog rather than a stale fixed count')
  const inputs = await panelAuthoringInputPaths(workspace)
  for (const component of Object.values(prepared.material.components)) {
    for (const example of component.examples) assert.ok(inputs.includes(example.file), example.file)
  }
  assert.ok(inputs.includes('docs/dsl-spec.md'))
  assert.ok(inputs.includes('docs/panel-uiux-standard.md'))
  const standard = await readFile(new URL('../docs/panel-uiux-standard.md', import.meta.url), 'utf8')
  assert.equal(prepared.material.components.record_form.documentation.sharedStandards.content, standard)
  assert.ok(inputs.includes('packages/skills-web-app/package.json'))
  assert.ok(inputs.includes('packages/skills-web-app/bundles/function_modules/panel.yaml'))
  assert.ok(Object.values(prepared.material.components).some(component =>
    component.examples.some(example => example.file.startsWith('packages/skills-web-app/bundles/'))),
  'generated material must retain actual publicly available Kit examples')
  assert.ok(!inputs.some(path => path.startsWith('packages/skills-web-app/skills/')))
  await writePanelAuthoringMaterial(root, prepared)
  await verifyPanelAuthoringMaterial(root, prepared)
  await assert.rejects(writePanelAuthoringMaterial(root, prepared), { code: 'EEXIST' })
})

test('authoring inputs discover a self-contained non-Web Kit', async t => {
  const root = await fixture(t), packageRoot = join(root, 'packages/skills-fixture-domain')
  const panel = join(packageRoot, 'panels/overview/panel.yaml')
  await mkdir(join(packageRoot, 'panels/overview'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: 'synthetic-authoring-kit', version: '1.0.0',
    designSystem: { kit: { bundles: './panels' } },
  }))
  // Input discovery needs only the declaration; use public content, never an internal Kit.
  await writeFile(panel, await readFile(new URL('../packages/skills-web-app/bundles/function_modules/panel.yaml', import.meta.url)))
  const inputs = await panelAuthoringInputPaths(root)
  assert.ok(inputs.includes('packages/skills-fixture-domain/package.json'))
  assert.ok(inputs.includes('packages/skills-fixture-domain/panels/overview/panel.yaml'))
})

test('missing, stale documentation and incomplete component coverage reject', async t => {
  const prepared = await prepare(), root = await fixture(t)
  await assert.rejects(verifyPanelAuthoringMaterial(root, prepared), { code: 'ENOENT' })
  const path = await writePanelAuthoringMaterial(root, prepared)
  const stale = structuredClone(prepared.material)
  stale.components.record_workspace.documentation.sections[0].content += '\nold text'
  await writeFile(path, JSON.stringify(stale))
  await assert.rejects(verifyPanelAuthoringMaterial(root, prepared), /stale or incomplete/)
  const staleStandard = structuredClone(prepared.material)
  staleStandard.components.record_form.documentation.sharedStandards.content += '\nstale rules'
  await writeFile(path, JSON.stringify(staleStandard))
  await assert.rejects(verifyPanelAuthoringMaterial(root, prepared), /stale or incomplete/)
  const incomplete = structuredClone(prepared.material)
  delete incomplete.components.record_workspace
  await writeFile(path, JSON.stringify(incomplete))
  await assert.rejects(verifyPanelAuthoringMaterial(root, prepared), /stale or incomplete/)
})

test('npm archive includes fixed resource readable by plain Node after relocation', async t => {
  const prepared = await prepare(), root = await fixture(t), packageRoot = join(root, 'package')
  await mkdir(packageRoot)
  await writePanelAuthoringMaterial(packageRoot, prepared)
  await mkdir(join(packageRoot, 'scripts'))
  await writeFile(join(packageRoot, 'scripts/read.mjs'), "import {readFile} from 'node:fs/promises';console.log(await readFile(new URL('../authoring/panel-components.json',import.meta.url),'utf8'))")
  // Same enclosing payload file selection as the normal npm candidate.
  const candidate = join(root, 'candidate')
  await mkdir(join(candidate, 'payload'), { recursive: true })
  await import('node:fs/promises').then(({rename}) => rename(packageRoot, join(candidate, 'payload/shared')))
  const template = JSON.parse(await readFile(new URL('../docs/companion-npm-fixture-2026-09-30.json', import.meta.url)))
  await writeFile(join(candidate, 'package.json'), JSON.stringify({ name: 'authoring-resource-fixture', version: '1.0.0', files: template.files }))
  const env = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--offline'], { cwd: candidate, env, encoding: 'utf8' }))[0]
  assert.ok(packed.files.some(file => file.path === `payload/shared/${PANEL_AUTHORING_RESOURCE}`))
  const extracted = join(root, 'relocated'); await mkdir(extracted)
  execFileSync('tar', ['-xzf', join(candidate, packed.filename), '-C', extracted])
  const read = execFileSync(process.execPath, [join(extracted, 'package/payload/shared/scripts/read.mjs')], { cwd: root, env, maxBuffer: 4_000_000, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(read), prepared.material)
})
