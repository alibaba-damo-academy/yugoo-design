/**
 * Conditional Bundle-slot acceptance smoke. Asserts the contract agreed in
 * docs/system-design-baseline.md: presentation, renderer, and artifact slots
 * are conditional, not universal. Presentation is explicit per Bundle —
 * native, declarative, or `mode: none` (no interactive panel, not a third
 * panel type) — and a non-declarative Bundle carrying a declarative slot is
 * contradictory authored presentation, rejected at load.
 *
 * Cases (domain-neutral temp kits, no product content):
 *   1. native_clean_ok            native Bundle with only the four common slots loads
 *   2. native_residue_panel_yaml  native Bundle with a stray panel.yaml is rejected
 *   3. native_residue_renderer_md native Bundle with a stray renderer.md is rejected
 *   4. declarative_missing_panel  declarative Bundle without panel.yaml is rejected
 *   5. declarative_missing_renderer declarative Bundle without renderer.md is rejected
 *   6. declarative_complete_ok    declarative Bundle with both slots loads
 *   7. nopanel_clean_ok           presentation.mode none Bundle with four common slots loads
 *   8. crossref_declarative_ok    cross-panel refs validate among declarative Bundles
 *                                 while a slotless native Bundle is present
 *   9. crossref_unknown_panel     a dangling cross-panel reference still fails loudly
 *
 * Run: node scripts/smoke-conditional-bundle-slots.mjs (after `pnpm run build`).
 */
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDesignKit } from '../packages/core/lib/kit-loader.js'

const loadFixtureKit = (fs, root) => loadDesignKit(fs, root, { sourceId: 'fixture:smoke-conditional-bundle-slots' })

const kitFs = {
  readText: async (p) => { try { return await readFile(p, 'utf8') } catch { return undefined } },
  listDir: async (p) => { try { return await readdir(p) } catch { return [] } },
  isDirectory: async (p) => (await stat(p)).isDirectory(),
}

// --- Domain-neutral slot builders ---------------------------------------------

function skillMd(name) {
  return `---
name: ${name}
description: |-
  - **Capability**: domain-neutral fixture bundle.
  - **Output**: fixture state only.
---

# ${name}

Fixture bundle for the conditional-slot acceptance smoke.
`
}

function skillYaml(name, presentation) {
  return `name: ${name}
version: "1.0"

title:
  zh: ${name}
  en: ${name}

label:
  zh: ${name}
  en: ${name}

execution:
  handoff: must_edit
${presentation === undefined ? '' : `
presentation:
${presentation}
`}`
}

const NATIVE_PRESENTATION = `  mode: native
  renderer: fixture.native-driver/v1

runtime:
  driver: fixture.native-driver/v1`

const DECLARATIVE_PRESENTATION = `  mode: declarative
  renderer: pilot-design/v2`

/** No-panel Bundles explicitly declare `presentation.mode: none` — the absence of an interactive panel, not a third panel type. */
const NONE_PRESENTATION = `  mode: none`

const SCHEMA_YAML = `type: object
properties:
  items:
    type: map
    value:
      type: object
      properties:
        name: { type: string }
        target: { type: string }
`

function validationYaml(name) {
  return `skill: ${name}

rules:
  - id: item_name_required
    scope: [state, completion]
    code: ${name}.empty_item_name
    message: "item {key} has no name"
    check:
      for_each_in_map: items
      non_empty_string: name
`
}

const PANEL_YAML = `version: 1
panel_kind: evidence_workbook
renderer: workspace
item_name: item

sections:
  - id: items
    title: Items
    item_name: item
    add_label: Add item

fields:
  - key: name
    control: text
    label: Name
    applies_to: [items]
    required: true
  - key: target
    control: text
    label: Target
    applies_to: [items]

ui:
  component: record_form
  id: items-view
  source: items
`

/** Panel manifest whose `target` field references another Bundle's section. */
function panelYamlReferencing(panelType, sectionId) {
  return PANEL_YAML.replace(
    '  - key: target\n    control: text\n    label: Target\n    applies_to: [items]\n',
    `  - key: target
    control: record_select
    label: Target
    applies_to: [items]
    options_from_panel:
      panel_type: ${panelType}
      section_id: ${sectionId}
`,
  )
}

const RENDERER_MD = `---
version: 1
renderer: pilot-design/v2
fields: []
collections:
  - source: items
    title: Items
    title_fields: [name]
    limit: 20
---

# Fixture design_state summary contract.

## Rules

- Emit nothing when the state is missing or empty.
`

// --- Temp kit assembly ----------------------------------------------------------

/** One Bundle directory description. */
function bundle(name, presentation, { panelYaml, rendererMd } = {}) {
  return { name, presentation, panelYaml, rendererMd }
}

async function writeKit(kitName, bundles) {
  const root = await mkdtemp(join(tmpdir(), `dsh-conditional-slots-${kitName}-`))
  const catalog = bundles.map((entry) => `## ${entry.name}\n\nDomain-neutral fixture bundle.\n`).join('\n')
  await writeFile(join(root, 'mindset.md'), `---
name: ${kitName}
version: "1.0"
description: Domain-neutral fixture kit for the conditional-slot smoke.
---

# ${kitName}

<design_skills>

${catalog}

</design_skills>
`)
  for (const entry of bundles) {
    const dir = join(root, 'skills', entry.name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), skillMd(entry.name))
    await writeFile(join(dir, 'skill.yaml'), skillYaml(entry.name, entry.presentation))
    await writeFile(join(dir, 'schema.yaml'), SCHEMA_YAML)
    await writeFile(join(dir, 'validation.yaml'), validationYaml(entry.name))
    if (entry.panelYaml !== undefined) await writeFile(join(dir, 'panel.yaml'), entry.panelYaml)
    if (entry.rendererMd !== undefined) await writeFile(join(dir, 'renderer.md'), entry.rendererMd)
  }
  return root
}

// --- Case runner ------------------------------------------------------------------

const results = []

async function expectCase(id, label, run) {
  try {
    await run()
    results.push({ id, label, ok: true })
    console.log(`ok   ${id}: ${label}`)
  } catch (error) {
    results.push({ id, label, ok: false, error })
    console.log(`FAIL ${id}: ${label}\n     ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function expectLoads(kitName, bundles, inspect) {
  const root = await writeKit(kitName, bundles)
  try {
    const kit = await loadFixtureKit(kitFs, root)
    if (inspect !== undefined) inspect(kit)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function expectRejects(kitName, bundles, pattern) {
  const root = await writeKit(kitName, bundles)
  try {
    await loadFixtureKit(kitFs, root)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (pattern !== undefined && !pattern.test(message)) {
      throw new Error(`rejected for the wrong reason: ${message}`)
    }
    return
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  throw new Error('kit loaded but the target contract requires rejection')
}

const declarativeSlots = { panelYaml: PANEL_YAML, rendererMd: RENDERER_MD }
const noDeclarativeMetadata = (skill) => {
  for (const key of ['panelYaml', 'panelManifest', 'rendererMd', 'rendererManifest']) {
    if (skill.metadata?.[key] !== undefined) {
      throw new Error(`${skill.name} metadata must not carry declarative slot ${key}`)
    }
  }
}

// 1. native Bundle with only the four common slots loads.
await expectCase('native_clean_ok', 'native Bundle loads without panel.yaml/renderer.md', () =>
  expectLoads('fixture_native_clean', [bundle('native_one', NATIVE_PRESENTATION)], (kit) => {
    noDeclarativeMetadata(kit.skills[0])
  }))

// 2-3. residual declarative slots on a native Bundle are contradictory presentation.
await expectCase('native_residue_panel_yaml', 'native Bundle with stray panel.yaml is rejected', () =>
  expectRejects('fixture_native_residue_panel', [
    bundle('native_one', NATIVE_PRESENTATION, { panelYaml: PANEL_YAML }),
  ], /native|presentation|panel\.yaml/i))

await expectCase('native_residue_renderer_md', 'native Bundle with stray renderer.md is rejected', () =>
  expectRejects('fixture_native_residue_renderer', [
    bundle('native_one', NATIVE_PRESENTATION, { rendererMd: RENDERER_MD }),
  ], /native|presentation|renderer\.md/i))

// 4-5. declarative Bundles require both presentation slots.
await expectCase('declarative_missing_panel', 'declarative Bundle without panel.yaml is rejected', () =>
  expectRejects('fixture_decl_no_panel', [
    bundle('decl_one', DECLARATIVE_PRESENTATION, { rendererMd: RENDERER_MD }),
  ], /panel\.yaml/))

await expectCase('declarative_missing_renderer', 'declarative Bundle without renderer.md is rejected', () =>
  expectRejects('fixture_decl_no_renderer', [
    bundle('decl_one', DECLARATIVE_PRESENTATION, { panelYaml: PANEL_YAML }),
  ], /renderer\.md/))

// 6. complete declarative Bundle loads (positive control, green today).
await expectCase('declarative_complete_ok', 'declarative Bundle with both slots loads', () =>
  expectLoads('fixture_decl_complete', [bundle('decl_one', DECLARATIVE_PRESENTATION, declarativeSlots)], (kit) => {
    if (kit.skills[0].metadata?.rendererManifest === undefined) {
      throw new Error('declarative skill must carry a parsed renderer manifest')
    }
  }))

// 7. explicit no-panel Bundle loads with the four common slots.
await expectCase('nopanel_clean_ok', 'presentation.mode none Bundle loads with four common slots', () =>
  expectLoads('fixture_nopanel', [bundle('plain_one', NONE_PRESENTATION)], (kit) => {
    noDeclarativeMetadata(kit.skills[0])
  }))

// 8. cross-panel references validate among declarative Bundles with a slotless native present.
await expectCase('crossref_declarative_ok', 'cross-panel refs validate with a slotless native Bundle present', () =>
  expectLoads('fixture_crossref', [
    bundle('native_one', NATIVE_PRESENTATION),
    bundle('decl_source', DECLARATIVE_PRESENTATION, declarativeSlots),
    bundle('decl_ref', DECLARATIVE_PRESENTATION, {
      panelYaml: panelYamlReferencing('decl_source', 'items'),
      rendererMd: RENDERER_MD,
    }),
  ]))

// 9. a dangling cross-panel reference still fails loudly.
await expectCase('crossref_unknown_panel', 'dangling cross-panel reference is rejected', () =>
  expectRejects('fixture_crossref_dangling', [
    bundle('native_one', NATIVE_PRESENTATION),
    bundle('decl_ref', DECLARATIVE_PRESENTATION, {
      panelYaml: panelYamlReferencing('ghost_panel', 'items'),
      rendererMd: RENDERER_MD,
    }),
  ], /unknown panel/))

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} conditional-slot cases pass`)
if (failed.length > 0) {
  console.log(`Failing cases: ${failed.map((entry) => entry.id).join(', ')}`)
  process.exit(1)
}
