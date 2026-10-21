import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { experienceFreshness } from '../src/experience-view.ts'

// Guidance contract checks, not proof of a model answer or a live Host action.
const progression = await readFile(new URL('../src/design-core-prompt.ts', import.meta.url), 'utf8')
const service = await readFile(new URL('../src/design-service.ts', import.meta.url), 'utf8')
const scene = service.split('<design_experience>')[1]?.split('</design_experience>')[0]

test('scene action shares the existing optional selector, never a Bundle alias', () => {
  assert.ok(scene)
  assert.match(progression, /scene-experience actions below are non-catalog choices, never Bundle aliases/)
  assert.match(progression, /one to three options total and preserving the advisory option/)
  assert.match(progression, /open, refresh or creation route rather than run_design_skill/)
  assert.doesNotMatch(progression, /sole non-catalog option/)
  assert.match(scene, /existing 'dsh-design-next-step' question/)
  assert.match(scene, /never open a competing selector or override a pending Bundle user-continue gate/)
})

test('published identity, artifact availability and source bytes precede readiness', () => {
  assert.match(scene, /actual published _experiences\/<id>\/view\.json index/)
  assert.match(scene, /referenced section artifacts exist/)
  assert.match(scene, /title and purpose to judge relevance/)
  assert.match(scene, /hashes of the current original source bytes/)
  assert.match(scene, /never compare them with a Git commit/)
  assert.match(scene, /Invalid indexes or missing artifacts are unavailable/)
})

test('current, stale and unknown retain the existing freshness meaning', () => {
  const view = { sourceVersions: { 'intent/intent.json': 'captured' } }
  assert.deepEqual(experienceFreshness(view, { 'intent/intent.json': 'captured' }), { status: 'current', changed: [] })
  for (const files of [{}, { 'intent/intent.json': 'changed' }]) {
    assert.deepEqual(experienceFreshness(view, files), { status: 'stale', changed: ['intent/intent.json'] })
  }
  assert.deepEqual(experienceFreshness(view), { status: 'unknown', changed: [] })
  assert.match(scene, /freshness is unknown and offer only a qualified revisit/)
  assert.match(scene, /old scene remains available to revisit as an old version/)
})

test('absent scenes and selected actions do not invent readiness or product authority', () => {
  assert.match(scene, /no applicable published view exists, never label an experience as ready/)
  assert.match(scene, /otherwise omit the scene action/)
  assert.match(scene, /not a Bundle id or executable instruction/)
  assert.match(scene, /authorizes only that bounded derived view/)
  assert.match(scene, /does not authorize product edits/)
  assert.match(scene, /Never automatically run these actions on recommendation/)
  assert.match(scene, /merely replace source fingerprints/)
  assert.match(scene, /disclose the limitation without fabricating a successful view/)
  assert.match(scene, /owning design and refreshing a derived scene remain distinct outcomes/)
})
