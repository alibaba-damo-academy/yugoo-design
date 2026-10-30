import test from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {installSelectDom} from './select-interaction.mjs'
const {register}=await import('tsx/esm/api');register()
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://panel.test/',pretendToBeVisual:true})
for(const name of ['window','document','navigator','HTMLElement','HTMLFormElement','Element','Node','Event','MouseEvent','MutationObserver','DocumentFragment','HTMLInputElement','HTMLSelectElement']) if(globalThis[name]===undefined)globalThis[name]=dom.window[name]
installSelectDom(dom.window)
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const React=await import('react');globalThis.React=React
const {createRoot}=await import('react-dom/client')
const {renderManifest}=await import('../src/interpreter.ts')
const {validatePanelManifest}=await import('../../core/src/panel-dsl.ts')
const {PanelLocaleContext}=await import('../src/panel-i18n.tsx')
const manifest={version:1,panel_kind:'document',sections:[{id:'runs',title:'Runs',add_mode:'none'},{id:'views',title:'Views',navigation:'contextual',add_mode:'none'}],fields:[
 {key:'title',control:'text',applies_to:['runs','views']},
 {key:'owner',control:'record_select',applies_to:['views'],options_from_section:'runs'},
 {key:'file',control:'artifact_ref',applies_to:['views']},
 {key:'meaning',control:'textarea',applies_to:['views']},
],ui:{id:'results',component:'record_workspace',sources:['runs','views'],navigation_layout:'list',children:[{id:'detail',component:'record_inspector',children:[{id:'charts',component:'record_artifact',source:'views',artifact:{field:'file',reference_field:'owner',explanation_field:'meaning'}}]}]}}
const data={runs:{a:{title:'Run A'},b:{title:'Run B'}},views:{
 one:{title:'Chart one',owner:'a',file:'example/artifacts/one.html',meaning:'Read this as an assignment, not a new computation.'},
 two:{title:'Chart two',owner:'a',file:'example/artifacts/two.html'},
 orphan:{title:'Unassigned chart',file:'example/artifacts/orphan.html'},
}}

test('related artifact bindings require an explicit visible single reference and plain text',()=>{
 assert.deepEqual(validatePanelManifest(manifest),[])
 for(const value of [null, 7, 'invalid']) {
  const bad=structuredClone(manifest);bad.fields.unshift(value)
  assert.doesNotThrow(()=>validatePanelManifest(bad),'malformed fields stay diagnostics, never an exception')
  assert.ok(validatePanelManifest(bad).length)
 }
 for(const mutate of [
 p=>p.ui.children[0].children[0].artifact.reference_field='missing',
 p=>p.fields.find(f=>f.key==='owner').control='text',
 p=>p.fields.find(f=>f.key==='owner').options_from_section='outside',
 p=>p.fields.find(f=>f.key==='owner').options_from_section='views',
 p=>p.fields.find(f=>f.key==='owner').hidden=true,
 p=>p.ui.children[0].children[0].artifact.explanation_field='file',
 ]){const bad=structuredClone(manifest);mutate(bad);assert.ok(validatePanelManifest(bad).length)}
})

test('related previews show all matching records, preserve unassigned views and keep missing/error states visible',async()=>{
 const container=document.getElementById('root'),root=createRoot(container),before=structuredClone(data)
 const calls=[];let revision='a'.repeat(40),fail=true,edits=0
 const artifactFiles=Object.fromEntries(Object.values(data.views).map(v=>[v.file,'hash-one']))
 const read=async(path,pin)=>{calls.push([path,pin]);if(path.endsWith('/two.html')&&fail)throw Error('Synthetic read failure');return{found:true,content:'<h1>Bound file</h1><script>window.bad=true</script>'}}
 const render=()=>root.render(React.createElement(PanelLocaleContext.Provider,{value:'en-US'},renderManifest(manifest,data,{editable:true,onEdit(){edits++},onPanelUpdate(){edits++},locale:'en',artifactFiles,sourceRevision:revision,readArtifact:read})))
 const act=async f=>React.act(async()=>{f();await new Promise(r=>setTimeout(r,15))})
 const select=async label=>act(()=>[...container.querySelectorAll('nav button')].find(node=>node.getAttribute('aria-label')===label||node.getAttribute('aria-label')?.startsWith(label+' · ')).click())
 try{
  await act(render)
  assert.equal(container.querySelectorAll('[role=tab]').length,0)
  assert.equal(container.querySelector('nav button[aria-label="Chart one"]'),null,'associated charts are not a second sidebar result')
  assert.equal(container.querySelectorAll('nav button[aria-label^="Unassigned chart ·"]').length,1,'unassigned history remains reachable once through the existing recovery navigation')
  assert.deepEqual([...container.querySelectorAll('.dsh-record-artifact h3')].map(e=>e.textContent),['Chart one','Chart two'])
  assert.equal(container.querySelectorAll('.dsh-record-artifact iframe').length,1)
  assert.match(container.querySelector('.dsh-record-artifact [role=alert]').textContent,/Synthetic read failure/)
  assert.ok(calls.every(([,pin])=>pin===revision))
  const frame=container.querySelector('iframe');assert.equal(frame.getAttribute('sandbox'),'');assert.equal(frame.getAttribute('referrerpolicy'),'no-referrer')
  assert.match(frame.srcdoc,/Content-Security-Policy/)
  assert.match(container.querySelector('.dsh-artifact-explanation').textContent,/assignment/)
  fail=false;await act(()=>container.querySelector('.dsh-record-artifact [role=alert] button').click())
  assert.equal(container.querySelectorAll('.dsh-record-artifact iframe').length,2)
  revision='b'.repeat(40);await act(render);assert.ok(calls.slice(-2).every(([,pin])=>pin===revision))
  await act(()=>container.querySelector('.dsh-artifact-details-link').click());assert.match(container.querySelector('.dsh-record-inspector-back').textContent,/Run A/);await act(()=>container.querySelector('.dsh-record-inspector-back').click())
  await select('Run B');assert.equal(container.querySelectorAll('.dsh-record-artifact').length,0,'no matching chart creates no blank page')
  await select('Unassigned chart');assert.equal(container.querySelectorAll('.dsh-record-artifact iframe').length,1,'existing unassigned view remains reachable')
  assert.equal(container.querySelector('.dsh-record-inspector-back'),null,'sidebar navigation clears the preview return trail')
  await select('Run A');assert.equal(container.querySelectorAll('.dsh-record-artifact').length,2)
  assert.equal(edits,0);assert.deepEqual(data,before,'view selection never edits or copies facts')
 }finally{await act(()=>root.unmount())}
})

test('unsafe, missing and oversized referenced files keep local status and never become a missing related collection',async()=>{
 const container=document.getElementById('root'),root=createRoot(container),state=structuredClone(data)
 delete state.views.two;delete state.views.orphan
 const artifactFiles={};let calls=0;let mode='missing'
 const read=async()=>{calls++;return mode==='missing'?{found:false,content:''}:{found:true,content:'x'.repeat(2_000_001)}}
 const render=()=>root.render(React.createElement(PanelLocaleContext.Provider,{value:'en-US'},renderManifest(manifest,state,{artifactFiles,readArtifact:read,locale:'en'})))
 const act=async f=>React.act(async()=>{f();await new Promise(r=>setTimeout(r,10))})
 try{
  await act(render);assert.match(container.querySelector('.dsh-record-artifact').textContent,/not.*published|unavailable/i);assert.equal(calls,0)
  artifactFiles[state.views.one.file]='one';await act(render);assert.equal(calls,1);assert.ok(container.querySelector('[role=alert]'))
  mode='large';await act(()=>container.querySelector('[role=alert] button').click());assert.match(container.querySelector('[role=alert]').textContent,/large|limit|exceeds/i)
  state.views.one.file='../unsafe.html';artifactFiles[state.views.one.file]='unsafe';const prior=calls;await act(render);assert.equal(calls,prior);assert.ok(container.querySelector('[role=alert]'))
 }finally{await act(()=>root.unmount())}
})
