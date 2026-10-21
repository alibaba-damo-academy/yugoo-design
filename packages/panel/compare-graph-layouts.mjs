/** Bounded, read-only real-project experiment. Saves artifacts; closes test server/browser. */
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const {register}=await import('tsx/esm/api');register()
const {projectGraphFixture}=await import('../core/test/project-graph-fixture.mjs')
const {projectRecords,recordOwner,structuralGroups}=await import('./src/client/graph-model.ts')
const {engines,initialPositions,calculate,fitted,metrics}=await import('./test/layout-comparison-engines.mjs')
const [root,reportPath,kit]=process.argv.slice(2)
assert.ok(root&&reportPath&&kit,'Usage: node compare-graph-layouts.mjs PROJECT SEMANTIC_REPORT KIT')
const source=await projectGraphFixture(root,kit),semantic=JSON.parse(await readFile(reportPath,'utf8'))
assert.equal(semantic.checkpoint,source.checkpoint,'Do not compare stale semantic edges')
const units=new Map(source.semanticUnits.map(u=>[u.id,u.digest]))
assert.equal(units.size,semantic.units.length)
for(const u of semantic.units)assert.equal(units.get(u.id),u.digest)
source.edges.push(...semantic.result.edges)
delete source.semanticUnits
const before=JSON.stringify(source),out=await mkdtemp(join(tmpdir(),'graph-layout-comparison-'))
const owner=new Map(source.nodes.map(n=>[n.id,recordOwner(source,n.id)])),roots=source.nodes.filter(n=>n.record)
const count=xs=>Object.fromEntries([...new Set(xs)].map(x=>[x,xs.filter(y=>y===x).length]))
const scopes={overview:projectRecords(source,false),expanded:projectRecords(source,true)}
const profile={checkpoint:source.checkpoint,nodes:source.nodes.length,records:roots.length,fields:source.nodes.length-roots.length,edgeKinds:count(source.edges.map(e=>e.kind)),
  crossRecordRelations:source.edges.filter(e=>e.kind!=='contains'&&owner.get(e.from)!==owner.get(e.to)).length,
  internalRelations:source.edges.filter(e=>e.kind!=='contains'&&owner.get(e.from)===owner.get(e.to)).length,
  descendantsPerRecord:roots.map(n=>({label:n.label,children:source.nodes.filter(c=>c.id!==n.id&&owner.get(c.id)===n.id).length})),
  modes:Object.fromEntries(Object.entries(scopes).map(([mode,s])=>{
    const groups=structuralGroups(s),degree=new Map(s.nodes.map(n=>[n.id,new Set()]))
    for(const e of s.edges){degree.get(e.from).add(e.to);degree.get(e.to).add(e.from)}
    return [mode,{nodes:s.nodes.length,edges:s.edges.length,components:count([...groups.values()]),isolates:[...degree].filter(([,v])=>!v.size).length,maxDegree:Math.max(...[...degree.values()].map(v=>v.size))}]
  }))}
const results=[]
for(const [mode,scope]of Object.entries(scopes))for(const engine of engines)for(const seed of [42,137,2026]){
  const result=calculate(engine,scope,initialPositions(scope,seed),new Set(),{seed})
  results.push({mode,engine,seed,milliseconds:result.milliseconds,...metrics(scope,result.positions)})
}
assert.equal(JSON.stringify(source),before,'Layout must not mutate graph facts')
execFileSync('pnpm',['exec','tsdown','--config','test/layout-comparison.config.ts'],{cwd:import.meta.dirname,env:{...process.env,GRAPH_TEST_OUT:out},stdio:'pipe'})
const bundle=await readFile(join(out,'comparison.js'),'utf8')
const html=`<!doctype html><meta charset="utf-8"><title>图布局同数据对比</title><style>
*{box-sizing:border-box}body{margin:0;color:#394150;background:#fafafa;font:14px system-ui}header{padding:16px 24px;border-bottom:1px solid #ddd}h1{font-size:18px;margin:0 0 10px}nav{display:flex;align-items:center;gap:12px}button,select{padding:6px 12px;border:1px solid #ccd1da;background:white;border-radius:5px;color:inherit}button[aria-pressed=true]{background:#e8eaf2}svg{display:block;width:1100px;height:660px;touch-action:none}footer{border-top:1px solid #ddd;padding:12px 24px;max-height:160px;overflow:auto;white-space:pre-wrap;font-size:12px}#status{margin-left:auto}small{display:block;margin-top:8px;color:#717b88}</style>
<header><h1>同一份设计关系图 · 三种成熟布局</h1><nav><select id="engine" aria-label="布局算法"></select><button id="overview">概览</button><button id="expanded">展开</button><button id="reset">重置布局</button><button id="fit">适应画布</button><span id="status"></span></nav><small>实线：记录/字段关联（语义关系仍是候选）　灰虚线：父子包含　颜色：来源 Bundle　无区域框，未修改项目数据。</small></header>
<svg viewBox="0 0 1100 660" aria-label="对比图谱"></svg><footer id="detail"></footer><script id="graph-data" type="application/json">${JSON.stringify(source).replaceAll('<','\\u003c')}</script><script type="module">${bundle.replaceAll('</script','<\\/script')}</script>`
await writeFile(join(out,'comparison.html'),html)
let browser,server
const browserResults=[],errors=[]
try{
  server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  browser=await chromium.launch({headless:true})
  const page=await browser.newPage({viewport:{width:1100,height:850}})
  page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(()=>window.comparison)
  for(const [i,engine]of engines.entries()){
    for(const [mode,expanded]of [['overview',false],['expanded',true]]){
      await page.mouse.move(5,5)
      await page.evaluate(([name,all])=>window.chooseComparison(name,all),[engine,expanded])
      const state=await page.evaluate(()=>window.comparison)
      assert.equal(state.nodes,scopes[mode].nodes.length);assert.equal(state.edges,scopes[mode].edges.length)
      assert.equal(await page.locator('svg rect').count(),0)
      const labelCount=await page.locator('svg text[opacity="1"]').count()
      browserResults.push({engine,mode,milliseconds:state.milliseconds,visibleLabels:labelCount,...state.metrics})
      await page.screenshot({path:join(out,`${i}-${mode}.png`)})
    }
    await page.evaluate(name=>window.chooseComparison(name,false),engine)
    const overviewPositions=await page.evaluate(()=>comparison.positions)
    await page.locator('#expanded').click()
    const expandedPositions=await page.evaluate(()=>comparison.positions),oldScreen=fitted(new Map(Object.entries(overviewPositions))),newScreen=fitted(new Map(Object.entries(expandedPositions)))
    const movement=[...oldScreen].map(([id,p])=>Math.hypot(newScreen.get(id).x-p.x,newScreen.get(id).y-p.y)).sort((a,b)=>a-b)
    browserResults.push({engine,mode:'expanded-from-overview',medianRecordMovementPixels:movement[Math.floor(movement.length/2)],...(await page.evaluate(()=>({milliseconds:comparison.milliseconds,...comparison.metrics})))})
    await page.screenshot({path:join(out,`${i}-incremental.png`)})
    const target=page.locator('[data-node]').first(),p=await target.evaluate(el=>{const p=new DOMPoint().matrixTransform(el.getScreenCTM());return{x:p.x,y:p.y}})
    await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+45,p.y+25,{steps:8});await page.mouse.up()
    assert.equal((await page.evaluate(()=>window.comparison)).nodes,scopes.expanded.nodes.length)
    const beforeZoom=await page.locator('svg>g').getAttribute('transform')
    await page.locator('svg').hover();await page.mouse.wheel(0,-180)
    await page.waitForFunction(old=>document.querySelector('svg>g').getAttribute('transform')!==old,beforeZoom)
  }
  assert.deepEqual(errors,[])
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r))}
await writeFile(join(out,'report.json'),JSON.stringify({profile,parameters:'test/layout-comparison-engines.mjs',results,browserResults,errors},null,2))
console.log(JSON.stringify({out,profile,results,browserResults},null,2))
