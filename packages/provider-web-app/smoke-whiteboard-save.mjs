/** Existing shared file/Git save pipeline, not a whiteboard-specific backend. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fixture } from '../companion/test/fixture.mjs'
const { register } = await import('tsx/esm/api'); register()
const { prepareWhiteboardIndexSave } = await import('./src/client/panels/whiteboard-scene.ts')
const { validateScene, validateIndex } = await import('../skills-web-app/bundles/whiteboard/scripts/scene.mjs')
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII='
const scene = { elements:[{id:'image1',type:'image',x:0,y:0,width:10,height:10,fileId:'photo1'}],appState:{viewBackgroundColor:'#ffffff'},files:{},
  pendingFiles:{photo1:{id:'photo1',mimeType:'image/png',created:1,dataURL:`data:image/png;base64,${png}`}} }
const state = { boards:{one:{id:'one',title:'主题',artifact_file:'whiteboard/boards/one.json'}},board_order:['one'] }
const draft = {...state,_scenes:{one:{scene,baseKey:'new'}}}, before=structuredClone(draft)
const f = await fixture()
try {
  const api=f.server.project, prepared=prepareWhiteboardIndexSave(draft)
  assert.deepEqual(draft,before)
  const saved=await api.savePanel({skill:'whiteboard',...prepared,eventId:'whiteboard-first'})
  assert.ok(saved.commit)
  assert.deepEqual((await api.readWorkspace()).design.whiteboard.state,state)
  const diskScene=JSON.parse((await api.readArtifact({path:state.boards.one.artifact_file})).content)
  assert.deepEqual(diskScene.elements,scene.elements)
  assert.equal((await api.readBinaryArtifact({path:diskScene.files.photo1.path})).base64,png)
  assert.ok(!JSON.stringify(prepared.state).includes('elements'))
  assert.ok(!JSON.stringify(diskScene).includes('data:image'))
  const cli=new URL('../skills-web-app/bundles/whiteboard/scripts/validate.mjs',import.meta.url).pathname
  assert.equal(JSON.parse(execFileSync(process.execPath,[cli,join(f.options.projectRoot,'design_files')],{encoding:'utf8'})).valid,true)
  assert.throws(()=>validateScene({...diskScene,elements:[...diskScene.elements,...diskScene.elements]}),/duplicate/)
  assert.throws(()=>validateIndex({...state,board_order:['../escape']}),/Invalid board/)
  assert.throws(()=>validateScene({...diskScene,files:{photo1:{...diskScene.files.photo1,path:'../escape'}}}),/Invalid image/)
  await assert.rejects(api.savePanel({skill:'whiteboard',state:{boards:{two:{id:'two',title:'missing',artifact_file:'whiteboard/boards/two.json'}},board_order:['two']},eventId:'missing-scene'}))
  assert.equal(await api.store.head(),saved.commit)
  console.log('WHITEBOARD SAVE OK: existing file/Git pipeline, scene/image separation, Bundle-only CLI, invalid refs rejected without new commit')
} finally {await f.close()}
