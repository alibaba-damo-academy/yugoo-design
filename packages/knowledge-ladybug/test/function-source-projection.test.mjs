import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } = await import('../src/provider.ts')
const { materializeDesignFilesKnowledge } = await import('../../core/src/design-knowledge-projection.ts')
after(() => shutdownLadybugKnowledgeRuntime())

test('explicit source references persist, reopen and retire when current target is removed',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'kag-functional-source-'))
  const projectId='functional-source',a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40)
  const source='context/context.json',owner='capabilities/capabilities.json'
  const base={type:'object',properties:{records:{type:'map',value:{type:'object',properties:{text:{type:'string'}}}}}}
  const schema=structuredClone(base)
  schema.properties.records.value.properties.refs={type:'map',knowledge:{role:'metadata',source_reference:true},value:{type:'object'}}
  const schemas={[source]:base,[owner]:schema}
  const files={ [source]:{records:{r1:{text:'Trace a claim to evidence'}}},[owner]:{records:{f1:{text:'Inspect claim evidence',refs:{r1:{file:source,pointer:'/records/r1/text',revision:a}}}}}}
  let head=b,provider
  const historical=JSON.stringify(files[source])
  const store={head:async()=>head,listPathsAt:async()=>Object.keys(files),readTextAt:async(revision,file)=>revision===a&&file===source?historical:files[file]?JSON.stringify(files[file]):undefined}
  try {
    provider=await LadybugDesignKnowledgeProvider.open(projectId,{databaseRoot:directory})
    await materializeDesignFilesKnowledge({store,service:provider,projectId,schemas})
    let result=await provider.query({projectId,limit:100})
    let edge=result.relations.find(edge=>edge.id.startsWith('source-ref:'))
    assert.equal(edge.relationType,'references'); assert.equal(edge.lifecycle,'observed')
    assert.equal(edge.properties.relationSemantics.meaning,'references')
    assert.ok(!result.entities.some(node=>node.properties.pointer.includes('/refs')))
    await provider.close()
    provider=await LadybugDesignKnowledgeProvider.open(projectId,{databaseRoot:directory})
    result=await provider.query({projectId,limit:100})
    assert.ok(result.relations.some(current=>current.id===edge.id))
    files[source]={records:{}};head=c
    await materializeDesignFilesKnowledge({store,service:provider,projectId,schemas})
    result=await provider.query({projectId,limit:100})
    assert.ok(!result.relations.some(current=>current.id===edge.id))
  } finally {await provider?.close();await rm(directory,{recursive:true,force:true})}
})
