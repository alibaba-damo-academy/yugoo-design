import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } = await import('../src/provider.ts')
const { materializeDesignFilesKnowledge } = await import('../../core/src/design-knowledge-projection.ts')
const { storedKnowledgeGraph } = await import('../../core/src/design-knowledge-semantic.ts')
const { queryReviewSnapshot } = await import('../../companion/src/knowledge-snapshot-query.mjs')

test('refresh removes abandoned role metadata without losing evidence or GRA; reading survives reopen and replica pagination', async () => {
  const directory=await mkdtemp(join(tmpdir(),'kag-reading-')); let provider
  const projectId='reading',file='tasks/tasks.json', checkpoint='c1'
  const source=JSON.stringify({tasks:{a:{caption:'实现任务',notes:'实施页面'},b:{caption:'功能定义',notes:'实现要求'}}})
  const schema={type:'object',properties:{tasks:{type:'map',value:{type:'object'}}}}
  const store={head:async()=>checkpoint,listPathsAt:async()=>[file],readTextAt:async()=>source}
  try {
    provider=await LadybugDesignKnowledgeProvider.open(projectId,{databaseRoot:directory})
    const run=()=>materializeDesignFilesKnowledge({store,service:provider,projectId,schemas:{[file]:schema}})
    await run()
    const before=await provider.query({projectId,limit:100})
    const a=before.entities.find(n=>n.properties.pointer==='/tasks/a'), b=before.entities.find(n=>n.properties.pointer==='/tasks/b')
    await provider.applyDelta({mutationId:'review',pin:{projectId,inputCheckpoint:checkpoint,observedCheckpoint:checkpoint,expectedRevision:before.revision},
      upsertEntities:[{...a,properties:{...a.properties,designRoles:['abandoned-experiment']}}],removeEntities:[],removeRelations:[],upsertRelations:[{id:'review-edge',from:a.id,to:b.id,relationType:'realizes',lifecycle:'proposed',
        properties:{projection:'review-v1'},provenance:{producer:'grounding',checkpoint,evidence:[{source:file,locator:'/tasks/a',revision:checkpoint},{source:file,locator:'/tasks/b',revision:checkpoint}]}}]})
    assert.equal((await run()).changed,true)
    assert.equal((await run()).changed,false,'derived readings must not cause perpetual deltas')
    const after=await provider.query({projectId,limit:100})
    assert.deepEqual(after.entities.map(n=>n.id),before.entities.map(n=>n.id))
    assert.equal(after.entities.find(n=>n.id===a.id).properties.contentRevision,a.properties.contentRevision)
    assert.ok(after.relations.some(n=>n.id==='review-edge'))
    assert.ok(after.relations.every(n=>!n.reading && !n.properties.reading),'read interpretation is not persisted')
    await provider.close()
    provider=await LadybugDesignKnowledgeProvider.open(projectId,{databaseRoot:directory})
    const snapshot=await provider.query({projectId,limit:100})
    assert.ok(snapshot.entities.every(n=>n.properties.designRoles===undefined),'ordinary projection removes experimental derived metadata')
    for(const field of ['relationMeanings','relationOrigins']) await assert.rejects(provider.query({projectId,limit:1,[field]:'bad'}),/string array/)
    const args={project:projectId,checkpoint,revision:snapshot.revision,limit:1,offset:0,relationMeanings:['realizes'],relationOrigins:['agent'],entityIds:[]}
    const replica=queryReviewSnapshot({project:projectId,checkpoint,graph:snapshot},args)
    assert.equal(replica.page.totalRelations,1);assert.equal(replica.relations[0].reading.direction,'forward')
    const direct=await provider.query({...args,projectId})
    assert.deepEqual(direct.relations.map(n=>n.id),replica.relations.map(n=>n.id))
    const graph=storedKnowledgeGraph(snapshot,checkpoint)
    assert.equal(graph.edges.find(n=>n.id==='review-edge').reading.meaning,'realizes')
    assert.ok(graph.nodes.every(n=>n.designRoles===undefined))
  } finally { await provider?.close(); await shutdownLadybugKnowledgeRuntime(); await rm(directory,{recursive:true,force:true}) }
})
