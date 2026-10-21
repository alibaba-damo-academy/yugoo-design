/** Opt-in, bounded real Codex read-only executor probe. No user project access. */
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {createReviewExecutor} from '../src/review-executor.mjs'

if(process.env.KAG_NATIVE_SMOKE!=='1')throw new Error('Set KAG_NATIVE_SMOKE=1 to authorize a real native model call')
const root=await mkdtemp(join(tmpdir(),'kag-native-read-'))
try {
  const id=`record:${randomUUID()}`
  const snapshot={project:'isolated-probe',checkpoint:'fixture-c1',graph:{revision:'rev:1',relations:[],entities:[{
    id,entityType:'design-record',label:'Literature evidence',lifecycle:'observed',
    properties:{fields:[{pointer:'/answer',text:'Use citations to trace research claims.'}]},
    provenance:{producer:'design-file-projection',checkpoint:'fixture-c1',evidence:[{source:'source.json',locator:'/answer'}]},
  }]}}
  await writeFile(join(root,'knowledge-snapshot.json'),JSON.stringify(snapshot),{mode:0o400})
  await writeFile(join(root,'source.json'),JSON.stringify({answer:'Use citations to trace research claims.'}),{mode:0o400})
  const pins={project:snapshot.project,checkpoint:snapshot.checkpoint,revision:snapshot.graph.revision,limit:1,offset:0}
  const helper=resolve('packages/companion/dist-server/knowledge-snapshot-query.mjs')
  const outputSchema={type:'object',additionalProperties:false,required:['id','quote','isolatedMeansDefect'],properties:{
    id:{type:'string'},quote:{type:'string'},isolatedMeansDefect:{type:'boolean'},
  }}
  const executor=createReviewExecutor({timeoutMs:120000,configTimeoutMs:15000})
  const result=await executor({cwd:root,outputSchema,prompt:
    `This is a read-only software integration test. Query the fixed graph by running node ${JSON.stringify(helper)} ${JSON.stringify(join(root,'knowledge-snapshot.json'))} '${JSON.stringify(pins)}'. Read source.json in the evidence directory to verify the quote. Return the queried entity ID, the exact source answer, and whether having no graph edges alone proves a design defect (it does not). Do not guess the entity ID or modify anything.`})
  assert.equal(result.result.id,id)
  assert.equal(result.result.quote,'Use citations to trace research claims.')
  assert.equal(result.result.isolatedMeansDefect,false)
  console.log(JSON.stringify({passed:true,host:'codex',nativeRunId:result.nativeRunId,pinnedQuery:true,sourceVerified:true}))
} finally {await rm(root,{recursive:true,force:true})}
