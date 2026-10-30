/** Requires the production Studio build. No source loader in the child probe. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as built from 'dsh-design-studio/node'
import * as instances from '../../companion/src/studio-instances.mjs'
import * as storage from '../../companion/src/studio-panel-drafts.mjs'
import * as composition from '../../companion/src/studio-instance-composition.mjs'
import * as authoring from '../../companion/src/studio-authoring.mjs'
import * as sharedInstances from '../src/node/studio-instances.mjs'
import * as sharedStorage from '../src/node/studio-panel-drafts.mjs'
import * as sharedComposition from '../src/node/studio-instance-composition.mjs'
import * as sharedAuthoring from '../src/node/studio-authoring.mjs'
import { originalFiles, pin, additions } from '../../companion/test/fixtures/studio-changes-fixture.mjs'

test('Companion compatibility entries forward to the same shared implementation and retain no storage copy', async () => {
  for (const [compatibility, shared] of [[instances, sharedInstances], [storage, sharedStorage], [composition, sharedComposition], [authoring, sharedAuthoring]]) {
    for (const key of Object.keys(shared)) assert.equal(compatibility[key], shared[key])
  }
  for (const name of ['studio-instances', 'studio-panel-drafts', 'studio-instance-composition', 'studio-authoring']) {
    const text = await readFile(new URL(`../../companion/src/${name}.mjs`, import.meta.url), 'utf8')
    assert.match(text, /export \{ .* \} from '\.\.\/\.\.\/studio\/src\/node\//)
    assert.doesNotMatch(text, /node:fs|function |=>|withLock|repository\s*=/)
  }
})

test('built domain root reaches no filesystem adapter and the Node export has real typed factories', async () => {
  for (const name of ['createStudioDraftPorts', 'createStudioInstances', 'createStudioInstanceAdapters', 'createStudioAuthoring']) assert.equal(typeof built[name], 'function')
  const base = fileURLToPath(new URL('../lib/', import.meta.url)), seen = new Set()
  async function visit(path) {
    if (seen.has(path)) return
    seen.add(path)
    const text = await readFile(path, 'utf8')
    assert.doesNotMatch(text, /(?:from\s*|import\s*\()["'](?:node:)?fs(?:\/promises)?["']/)
    for (const match of text.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+\.js)["']/g)) await visit(resolve(dirname(path), match[1]))
  }
  await visit(resolve(base, 'index.js'))
  const declaration = await readFile(resolve(base, 'node.d.ts'), 'utf8')
  assert.match(declaration, /StudioAuthoring/)
  assert.doesNotMatch(declaration, /\bany\b|@ts-nocheck|companion\/src|\.mjs["']/)
})

test('production Node entry runs without TS stripping, persists one record and shares source-authoring CAS semantics', async () => {
  const script = `
    import assert from 'node:assert/strict';
    import {mkdtemp,rm} from 'node:fs/promises';
    import {tmpdir} from 'node:os';
    import {join} from 'node:path';
    import {createStudioDraftPorts,createStudioAuthoring,createStudioInstanceAdapters,createStudioInstances} from 'dsh-design-studio/node';
    const stateRoot=await mkdtemp(join(tmpdir(),'studio-node-export-'));
    try {
      const {repository,sources}=await createStudioDraftPorts({stateRoot},'instance');
      const retained=await sources.retainTree([{path:'SKILL.md',base64:Buffer.from('retained method').toString('base64')}]);
      const pin={name:'local_bundle_probe',version:'1.0'};
      const record=await repository.create({recordVersion:2,kind:'bundle',bundle:pin,runtimeName:'probe',source:{bundle:{name:'probe',version:'1.0'}},sourceId:'local:bundle:'+pin.name,title:{zh:'探针',en:'Probe'},baseSnapshot:retained.id,overlays:{},mounts:[]});
      const fresh=await createStudioDraftPorts({stateRoot},'instance');
      assert.equal((await fresh.repository.read(record.id)).baseSnapshot,retained.id);
      assert.equal(await (await fresh.sources.open(retained.id)).fs.readText(join(retained.root,'SKILL.md')),'retained method');
      const adapter=createStudioAuthoring({scope:{id:record.id,expectedRevision:0,allowedPaths:['SKILL.md']},instances:{read:async()=>({...record,files:[{path:'SKILL.md',bytes:15,editable:true}]}),readFile:async()=>({id:record.id,revision:0,path:'SKILL.md',content:'retained method'}),prepareChanges:async()=>{throw Error('not invoked')}},readComponents:()=>({components:[{name:'record_form'}]})});
      assert.equal((await adapter.read()).files[0].content,'retained method');
      await fresh.repository.replace(record.id,0,{...record,overlays:{'SKILL.md':'human saved'}});
      await assert.rejects(repository.replace(record.id,0,record),/changed/);
      const originalFiles=${JSON.stringify(originalFiles)}, originalPin=${JSON.stringify(pin)}, changes=${JSON.stringify(additions())};
      const adapters=createStudioInstanceAdapters({listBundles:async()=>[originalPin],captureBundle:async requested=>{assert.deepEqual(requested,originalPin);return {files:originalFiles,sourceId:'trusted:node-entry'}},captureKit:async()=>{throw Error('Bundle-only fixture')}});
      const instances=await createStudioInstances({stateRoot,...adapters});
      const copy=await instances.copy({kind:'bundle',bundle:originalPin});
      const scoped=createStudioAuthoring({scope:{id:copy.id,expectedRevision:copy.revision,allowedPaths:changes.map(change=>change.path)},instances,readComponents:()=>({components:[{name:'record_form'}]})});
      const prepared=await scoped.prepare({changes});
      assert.equal(prepared.candidate.valid,true,JSON.stringify(prepared.candidate.diagnostics));
      const saved=await instances.saveChanges({...prepared.request,mode:'validated',digest:prepared.candidate.digest});
      const reopened=await createStudioInstances({stateRoot,...adapters});
      assert.equal((await reopened.readFile({id:copy.id,path:'schema.yaml'})).content,changes[0].content);
      await assert.rejects(scoped.read(),/changed/);
      console.log(JSON.stringify({ok:true,revision:(await repository.read(record.id)).revision,candidateRevision:saved.revision}));
    } finally {await rm(stateRoot,{recursive:true,force:true});}
  `
  const { stdout } = await promisify(execFile)(process.execPath, ['--no-experimental-strip-types', '--input-type=module', '-e', script], { cwd: fileURLToPath(new URL('..', import.meta.url)) })
  assert.deepEqual(JSON.parse(stdout), { ok: true, revision: 1, candidateRevision: 1 })
})
