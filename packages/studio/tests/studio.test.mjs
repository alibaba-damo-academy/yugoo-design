/**
 * Keyless acceptance for the host-neutral Design Studio foundation.
 *
 * Runs against an in-memory file-ops port (no node:fs, no host cwd, no Agent
 * Host runtime) to prove the Studio is a pure, portable domain library. It
 * exercises explicit definition validation: a valid Kit/Bundle reports empty
 * diagnostics, an invalid one reports locatable diagnostics, and validation
 * never degrades to a silently empty result.
 *
 * Run (built plane): node tests/studio.test.mjs
 */
import assert from 'node:assert/strict'
import { validateBundle, validateKit } from '../lib/index.js'

// --- In-memory file-ops port (the host adapter's native file operations) ----
function createMemoryFs(files) {
  const map = new Map(Object.entries(files))
  return {
    map,
    async readText(path) { return map.get(path) },
    async listDir(path) {
      const prefix = `${path}/`
      const names = new Set()
      for (const key of map.keys()) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0])
      return [...names].sort()
    },
    async isDirectory(path) {
      const prefix = `${path}/`
      for (const key of map.keys()) if (key.startsWith(prefix)) return true
      return false
    },
    async realPath(path) { return path },
  }
}

const ROOT = '/install/demo_kit'
const BUNDLE = `${ROOT}/skills/alpha`

/** A minimal valid Kit source tree: one Mindset plus one Bundle. */
function kitFiles() {
  return {
    [`${ROOT}/mindset.md`]: '---\nname: demo_kit\nversion: "1.0"\ndescription: "Demo Studio Kit."\n---\n\n# demo_kit Design Mindset\n\nCalibrate design judgment.\n\n<design_skills>\n\n## alpha\n\nAlpha facet.\n\n</design_skills>\n',
    [`${BUNDLE}/SKILL.md`]: '---\nname: alpha\ndescription: "Alpha facet."\n---\n\n# alpha\n\nAuthor the alpha method here.\n',
    [`${BUNDLE}/skill.yaml`]: 'name: alpha\nversion: "1.0"\ntitle:\n  zh: "alpha"\n  en: "alpha"\nlabel:\n  zh: "alpha"\n  en: "alpha"\nexecution:\n  handoff: none\npresentation:\n  mode: none\n',
    [`${BUNDLE}/schema.yaml`]: 'type: object\nproperties:\n  summary:\n    type: string\n',
    [`${BUNDLE}/validation.yaml`]: 'skill: alpha\nrules:\n  - id: definition_contract\n    scope: [completion]\n    code: alpha.summary_present\n    message: describe the facet in `summary` before completing.\n    check:\n      non_empty_string: summary\n',
  }
}

{
  const fs = createMemoryFs(kitFiles())
  const valid = await validateKit(fs, ROOT)
  assert.equal(valid.valid, true)
  assert.deepEqual(valid.diagnostics, [], 'a valid Kit reports empty diagnostics')

  const validBundle = await validateBundle(fs, ROOT, 'alpha')
  assert.equal(validBundle.valid, true)
  assert.deepEqual(validBundle.diagnostics, [])
  console.log('a valid Kit and Bundle validate with empty diagnostics')
}

{
  const files = kitFiles()
  files[`${BUNDLE}/skill.yaml`] = 'name: [unclosed\n'
  const invalid = await validateKit(createMemoryFs(files), ROOT)
  assert.equal(invalid.valid, false)
  assert.equal(invalid.diagnostics[0].code, 'kit.load')
  assert.ok(invalid.diagnostics[0].message.length > 0, 'the loader error is captured, never swallowed')

  const broken = await validateBundle(createMemoryFs(files), ROOT, 'alpha')
  assert.equal(broken.valid, false)
  assert.equal(broken.diagnostics[0].code, 'bundle.load')
  console.log('an invalid definition reports explicit locatable diagnostics')
}

{
  const files = kitFiles()
  delete files[`${BUNDLE}/validation.yaml`]
  const missing = await validateBundle(createMemoryFs(files), ROOT, 'alpha')
  assert.equal(missing.valid, false)
  assert.equal(missing.diagnostics[0].code, 'bundle.missing_slot')
  assert.equal(missing.diagnostics[0].subject, 'alpha')

  const files2 = kitFiles()
  // A physically present Bundle the Mindset catalog never references: the Kit
  // still loads, but the Bundle is not in the compiled catalog.
  files2[`${ROOT}/skills/beta/SKILL.md`] = '---\nname: beta\ndescription: "Beta facet."\n---\n\n# beta\n\nMethod.\n'
  files2[`${ROOT}/skills/beta/skill.yaml`] = 'name: beta\nversion: "1.0"\ntitle:\n  zh: "beta"\n  en: "beta"\nlabel:\n  zh: "beta"\n  en: "beta"\nexecution:\n  handoff: none\npresentation:\n  mode: none\n'
  files2[`${ROOT}/skills/beta/schema.yaml`] = 'type: object\nproperties:\n  summary:\n    type: string\n'
  files2[`${ROOT}/skills/beta/validation.yaml`] = 'skill: beta\nrules:\n  - id: r\n    scope: [completion]\n    code: beta.r\n    message: m\n    check:\n      non_empty_string: summary\n'
  const uncataloged = await validateBundle(createMemoryFs(files2), ROOT, 'beta')
  assert.equal(uncataloged.valid, false)
  assert.equal(uncataloged.diagnostics[0].code, 'bundle.not_in_catalog')
  console.log('missing slots and uncataloged Bundles diagnose without silent-empty results')
}

console.log('DESIGN STUDIO VALIDATION OK')
