import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DesignProjectManager } from '../../core/lib/index.js'
import { openCompanionProject } from '../src/project.mjs'
const kitRoot = new URL('../../skills-web-app/', import.meta.url).pathname
const example = JSON.parse(await readFile(join(kitRoot, 'skills/business_data/reference/example.json'), 'utf8'))

test('portable Companion save uses the same relationship validators and preserves facts after reopening', async t => {
  const root = await mkdtemp(join(tmpdir(), 'business-native-parity-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  const projectRoot = join(root, 'project'), stateRoot = join(root, 'journal')
  await new DesignProjectManager().create({root:projectRoot, name:'Business parity', knowledge:{provider:'ladybug-wasm'}, kit:{name:'web_app', version:'1.0'}})
  const options = {projectRoot,kitRoot,stateRoot,connection:{host:'codex',threadId:'00000000-0000-4000-8000-000000000001'}}
  const context = await openCompanionProject(options)
  assert.equal((await context.prepareBundle({skill:'business_data'})).version, '1.0')
  await context.savePanel({skill:'business_data',state:example,eventId:'valid-save'})
  const reopened = await openCompanionProject(options)
  assert.deepEqual(await reopened.store.read('business_data'), example)
  for (const [i, mutate] of [
    s => {s.relations['references-paper'].target = 'missing'},
    s => {s.relations.loop = {id:'loop',name:'是一种',kind:'generalization',source:'project',target:'experimental-project'}},
    s => {s.relations['inherits-project'].source_count = '1'},
  ].entries()) {
    const bad = structuredClone(example); mutate(bad)
    await assert.rejects(reopened.savePanel({skill:'business_data',state:bad,eventId:`invalid-${i}`}))
    assert.deepEqual(await reopened.store.read('business_data'), example)
  }
  const old = structuredClone(example); delete old.relations
  await reopened.savePanel({skill:'business_data',state:old,eventId:'legacy-save'})
  assert.deepEqual(await reopened.store.read('business_data'), old)
})
