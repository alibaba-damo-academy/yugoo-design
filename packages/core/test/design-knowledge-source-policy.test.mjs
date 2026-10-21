import { webAppBundleUrl } from './web-app-content-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const { register } = await import('tsx/esm/api'); register()
const { parseSchemaYaml, compileSchema } = await import('../src/schema.ts')
const { projectDesignGraph, readDesignGraph } = await import('../src/design-graph.ts')
const { appendReferencedKnowledgeArtifacts } = await import('../src/design-knowledge-artifacts.ts')
const { designKnowledgeSourcePolicyIdentity, isIndependentDesignSource } = await import('../src/design-knowledge-source-policy.ts')
const { DESIGN_KNOWLEDGE_PUBLICATION_KEY, readDesignKnowledgePublication } = await import('../src/design-knowledge-refresh.ts')
const { materializeDesignFilesKnowledge } = await import('../src/design-knowledge-projection.ts')
const derived = parseSchemaYaml('type: object\nknowledge: {role: metadata, source_kind: derived}\n')
const original = { type: 'object', properties: { title: {type:'string'}, artifact: {type:'string'}, derived_ref:{type:'string'} } }
const schemas = {'requirements/requirements.json':original, 'compiled_prd/compiled_prd.json':derived, 'handoff/handoff.json':derived}
const files = {'requirements/requirements.json':{title:'Independent original requirement',artifact:'requirements/source.svg',derived_ref:'compiled_prd/prd.html'},
  'compiled_prd/compiled_prd.json':{title:'Repeated PRD compilation',html_file:'compiled_prd/prd.html'},
  'handoff/handoff.json':{title:'Repeated spec compilation',artifact:'handoff/spec.md'}}

test('explicit derived scopes exclude PRD/Spec without guessing ordinary requirements filenames',async()=>{
  const bytes={'requirements/source.svg':Buffer.from('<svg>original independent source</svg>'),'compiled_prd/prd.html':Buffer.from('<html>repeat</html>'),'handoff/spec.md':Buffer.from('repeat spec')}
  const reads=[]
  const store={listPathsAt:async()=>[...Object.keys(files),...Object.keys(bytes)].map(p=>'design_files/'+p),
    readTextAt:async(_rev,p)=>{reads.push(p);return files[p] ? JSON.stringify(files[p]):undefined},readBytesAt:async(_rev,p)=>bytes[p]}
  for(const purpose of ['view','storage']){
    const graph=await readDesignGraph(store,'checkpoint',undefined,schemas,{purpose})
    await appendReferencedKnowledgeArtifacts(store,graph,undefined,undefined,schemas)
    assert.ok(graph.nodes.some(n=>n.file==='requirements/requirements.json'))
    assert.ok(graph.nodes.some(n=>n.file==='requirements/source.svg'))
    assert.ok(!graph.nodes.some(n=>n.file.startsWith('compiled_prd/')||n.file.startsWith('handoff/')))
    assert.ok(!graph.semanticUnits.some(n=>n.file.startsWith('compiled_prd/')||n.file.startsWith('handoff/')))
    assert.ok(!reads.includes('compiled_prd/compiled_prd.json')&&!reads.includes('handoff/handoff.json'))
  }
  assert.ok(!projectDesignGraph(files,'checkpoint',schemas).nodes.some(n=>n.file.startsWith('compiled_prd/')))
  assert.equal(isIndependentDesignSource('requirements/spec.md',schemas),true)
  assert.equal(isIndependentDesignSource('ordinary/prd.html',schemas),true)
})
test('root-only declaration validates without changing authoritative JSON writes',()=>{
  assert.equal(derived.knowledge.source_kind,'derived')
  assert.throws(()=>parseSchemaYaml('type: object\nproperties:\n  title: {type: string, knowledge: {role: metadata, source_kind: derived}}'),/root/)
  assert.throws(()=>parseSchemaYaml('type: object\nknowledge: {role: metadata, source_kind: guessed}'),/root/)
  const plain=parseSchemaYaml('type: object\nrequired: [title]\nproperties: {title: {type: string}}')
  // Source semantics are projection-only: same required-field validation.
  const validator=compileSchema({...plain,knowledge:{role:'metadata',source_kind:'derived'}})
  assert.deepEqual(validator({title:'Document remains writable'}),[])
  assert.ok(validator({}).length)
})
test('new policy generation and publication key cannot reuse old semantic publication',async()=>{
  assert.notEqual(designKnowledgeSourcePolicyIdentity({}),designKnowledgeSourcePolicyIdentity(schemas))
  assert.equal(designKnowledgeSourcePolicyIdentity(schemas),designKnowledgeSourcePolicyIdentity(Object.fromEntries(Object.entries(schemas).reverse())))
  const old=createHash('sha256').update('kag-semantic-publication-v2').digest('hex')
  assert.notEqual(DESIGN_KNOWLEDGE_PUBLICATION_KEY,old)
  const oldPublication=JSON.stringify({schemaVersion:1,key:'legacy',edges:'legacy',checkpoint:'c1',revision:'rev:1',warnings:[]})
  const reads=[]
  const current=await readDesignKnowledgePublication({readSemanticCache:async key=>{reads.push(key);return key===old?oldPublication:undefined}})
  assert.equal(current,undefined)
  assert.deepEqual(reads,[DESIGN_KNOWLEDGE_PUBLICATION_KEY])
})
test('actual PRD Bundle declares derived input',async()=>{
  const yaml=await readFile(webAppBundleUrl('web_app_prd_assembly/schema.yaml'),'utf8')
  assert.equal(parseSchemaYaml(yaml).knowledge.source_kind,'derived')
})
test('normal new revision retires owned derived projection but preserves original source entities',async()=>{
  const entities=new Map(),relations=new Map();let revision=0,checkpoint='c1'
  const service={revision:async()=>String(revision),query:async({offset=0,limit})=>({revision:String(revision),entities:[...entities.values()].slice(offset,offset+limit),relations:[...relations.values()].slice(offset,offset+limit),page:{offset,totalEntities:entities.size,totalRelations:relations.size,nextOffset:offset+limit<Math.max(entities.size,relations.size)?offset+limit:null}}),applyDelta:async d=>{
    assert.equal(d.pin.expectedRevision,String(revision))
    for(const id of d.removeRelations)relations.delete(id)
    for(const id of d.removeEntities)entities.delete(id)
    for(const n of d.upsertEntities)entities.set(n.id,n)
    for(const n of d.upsertRelations)relations.set(n.id,n)
    return {revision:String(++revision)}
  }}
  const artifacts={'requirements/source.svg':'<svg>original</svg>','compiled_prd/prd.html':'<html>repeat</html>','handoff/spec.md':'repeat'}
  const store={head:async()=>checkpoint,listPathsAt:async()=>[...Object.keys(files),...Object.keys(artifacts)],readTextAt:async(_c,p)=>files[p]?JSON.stringify(files[p]):artifacts[p],readBytesAt:async(_c,p)=>Buffer.from(artifacts[p])}
  const legacySchemas=Object.fromEntries(Object.keys(files).map(p=>[p,original]))
  await materializeDesignFilesKnowledge({projectId:'test',store,service,schemas:legacySchemas})
  assert.ok([...entities.values()].some(n=>n.properties.file==='compiled_prd/prd.html'))
  const originalIds=[...entities.values()].filter(n=>n.properties.file.startsWith('requirements/')).map(n=>n.id)
  checkpoint='c2'
  await materializeDesignFilesKnowledge({projectId:'test',store,service,schemas})
  assert.ok(originalIds.every(id=>entities.has(id)))
  assert.ok([...entities.values()].every(n=>n.properties.file.startsWith('requirements/')))
  assert.ok([...relations.values()].every(e=>entities.has(e.from)&&entities.has(e.to)))
  assert.equal((await materializeDesignFilesKnowledge({projectId:'test',store,service,schemas})).changed,false)
})
