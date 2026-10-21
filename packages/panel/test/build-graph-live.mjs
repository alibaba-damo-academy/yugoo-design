/** Rebuild only the experimental UI from an existing, immutable snapshot HTML. */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
const [input,directory]=process.argv.slice(2)
assert.ok(input&&directory,'Usage: node test/build-graph-live.mjs SNAPSHOT_HTML OUTPUT_DIRECTORY')
const out=resolve(directory),target=join(out,'comparison.html')
assert.notEqual(resolve(input),target,'Keep the original comparison page for A/B')
const html=await readFile(input,'utf8'),data=html.match(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1]
assert.ok(data,'Input must contain the frozen graph-data snapshot')
const source=JSON.parse(data)
await mkdir(out,{recursive:true})
execFileSync('pnpm',['exec','tsdown','--config','test/graph-live.config.ts'],{cwd:join(import.meta.dirname,'..'),env:{...process.env,GRAPH_TEST_OUT:out},stdio:'pipe'})
const template=await readFile(new URL('./graph-live.html',import.meta.url),'utf8'),bundle=await readFile(join(out,'live.js'),'utf8')
const worker=await readFile(join(out,'drag-worker.js'),'utf8')
await writeFile(target,template.replace('__GRAPH_DATA__',()=>JSON.stringify(source).replaceAll('<','\\u003c')).replace('__GRAPH_WORKER__',()=>JSON.stringify(worker).replaceAll('<','\\u003c')).replace('__GRAPH_SCRIPT__',()=>bundle.replaceAll('</script','<\\/script')))
console.log(JSON.stringify({path:target,checkpoint:source.checkpoint,nodes:source.nodes.length,edges:source.edges.length}))
