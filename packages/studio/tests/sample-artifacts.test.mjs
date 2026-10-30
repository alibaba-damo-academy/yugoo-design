import test from 'node:test'
import assert from 'node:assert/strict'
const {register}=await import('tsx/esm/api');register()
const {finalizeStudioPanelPreview}=await import('../src/panel-preview.ts')
const compiled={name:'example',version:'0.1',metadata:{panelYaml:'version: 1',schemaDocument:{type:'object',properties:{schema_version:{type:'number'}}}}}
const file='example/artifacts/chart.html',resource='reference/preview-artifacts/chart.html'
const map={version:1,files:{[file]:resource}}
const run=(mapping=map,content='<h1>Synthetic</h1>')=>{const reads=[];const result=finalizeStudioPanelPreview({compiled,bundle:{name:'example',version:'0.1'},revision:3,sampleSource:'{"schema_version":1}',readSampleResource:path=>{reads.push(path);return path==='reference/preview-artifacts.json'?mapping===undefined?undefined:typeof mapping==='string'?mapping:JSON.stringify(mapping):path===resource?content:undefined}});return{result,reads}}

test('registered sample files come only from bounded definition resources, without changing sample facts',()=>{
 const {result,reads}=run();assert.deepEqual(result.diagnostics,[])
 assert.deepEqual({...result.preview.artifacts},{[file]:'<h1>Synthetic</h1>'})
 assert.deepEqual(result.preview.sample,{schema_version:1})
 assert.deepEqual(reads,['reference/preview-artifacts.json',resource])
 const plain=finalizeStudioPanelPreview({compiled,bundle:{name:'example',version:'0.1'},revision:0,sampleSource:'{}'})
 assert.deepEqual(plain.diagnostics,[]);assert.equal(plain.preview.artifacts,undefined,'ordinary JSON-only previews need no map')
})

test('unsafe mappings fail before a resource read and never grant project access',()=>{
 for(const files of [
 {'../outside.html':resource},{'/absolute.html':resource},{'example/artifacts/chart.html':'../../project.html'},
 {[file]:'/absolute.html'},{[file]:'reference/preview-artifacts/../private.html'},
 {'other/artifacts/chart.html':resource},{'example/artifacts/a.js':resource},
 {[file]:'reference/preview-artifacts/remote.html?x=1'},
 ]){const {result,reads}=run({version:1,files});assert.equal(result.preview,undefined);assert.equal(result.diagnostics[0].code,'preview.sample_artifacts');assert.deepEqual(reads,['reference/preview-artifacts.json'])}
})

test('missing, malformed and oversized registered resources are explicit diagnostics',()=>{
 for(const [mapping,content] of [[map,''],[map,undefined],[map,'x'.repeat(262145)],['{','x'],[{version:2,files:{}},'x'],[{version:1,files:{},unexpected:true},'x'],[{version:1,files:Object.fromEntries(Array.from({length:9},(_,i)=>[`example/artifacts/${i}.html`,resource]))},'x'],[' '.repeat(16385),'x']]){
  // Explicit absent contents, without the helper default.
  const {result}=run(mapping,content===undefined?null:content);assert.equal(result.preview,undefined);assert.equal(result.diagnostics[0].code,'preview.sample_artifacts')
 }
})
