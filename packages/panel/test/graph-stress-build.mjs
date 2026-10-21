/** Graphviz is build-time only. The resulting page is fully offline. */
import {readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {projectRecords} from '../src/client/graph-model.ts'
const [input,output]=process.argv.slice(2)
const html=await readFile(input,'utf8')
const source=JSON.parse(html.match(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
const result={engine:execFileSync('neato',['-V'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim(),scopes:{}}
for(const expanded of [false,true]){
  const scope=projectRecords(source,expanded),indices=new Map(scope.nodes.map((n,i)=>[n.id,i]))
  const dot=['graph { graph [dim=3,dimen=3,mode=major,start=42,maxiter=1500,notranslate=true]; node [shape=point,width=.1,label=""];',
    ...scope.nodes.map((n,i)=>`n${i};`),...scope.edges.map(e=>`n${indices.get(e.from)} -- n${indices.get(e.to)} [len=${e.kind==='contains'?.7:1.8}];`),'}'].join('\n')
  const layout=JSON.parse(execFileSync('neato',['-Tjson'],{input:dot,encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024}))
  const positions=scope.nodes.map((n,i)=>{const xyz=layout.objects.find(o=>o.name===`n${i}`).pos.split(',').map(Number);assert.equal(xyz.length,3);assert.ok(xyz.every(Number.isFinite));return [n.id,...xyz]})
  const center=[1,2,3].map(d=>positions.reduce((sum,p)=>sum+p[d],0)/positions.length)
  result.scopes[expanded?'expanded':'overview']=Object.fromEntries(positions.map(([id,x,y,z])=>[id,{x:x-center[0],y:y-center[1],z:z-center[2]}]))
}
result.engine='Graphviz neato 3D stress majorization; start=42; maxiter=1500'
await writeFile(output,JSON.stringify(result))
