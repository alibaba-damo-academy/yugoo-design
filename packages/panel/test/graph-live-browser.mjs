/** Reuses the comparison page's exact frozen data, without opening a project or DB. */
import {readFile,writeFile,mkdtemp} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const input=process.argv[2]
assert.ok(input,'Usage: node test/graph-live-browser.mjs PREVIOUS_COMPARISON_HTML')
const previous=await readFile(input,'utf8'),data=previous.match(/<script id="graph-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1]
assert.ok(data,'Missing original comparison dataset')
const source=JSON.parse(data),out=await mkdtemp(join(tmpdir(),'graph-live-'))
execFileSync('pnpm',['exec','tsdown','--config','test/graph-live.config.ts'],{cwd:join(import.meta.dirname,'..'),env:{...process.env,GRAPH_TEST_OUT:out},stdio:'pipe'})
const bundle=await readFile(join(out,'live.js'),'utf8'),template=await readFile(new URL('./graph-live.html',import.meta.url),'utf8')
const worker=await readFile(join(out,'drag-worker.js'),'utf8')
const html=template.replace('__GRAPH_DATA__',()=>JSON.stringify(source).replaceAll('<','\\u003c'))
  .replace('__GRAPH_WORKER__',()=>JSON.stringify(worker).replaceAll('<','\\u003c'))
  .replace('__GRAPH_SCRIPT__',()=>bundle.replaceAll('</script','<\\/script'))
const path=join(out,'comparison.html');await writeFile(path,html)
const browser=await chromium.launch({headless:true}),errors=[],result={path,sourceNodes:source.nodes.length,sourceEdges:source.edges.length}
try{
  const page=await browser.newPage({viewport:{width:1200,height:860}})
  await page.addInitScript(()=>{
    const original=CanvasRenderingContext2D.prototype.setLineDash
    window.__containsDashes=[]
    CanvasRenderingContext2D.prototype.setLineDash=function(segments){
      if(segments.length===2){window.__containsDashes.push(segments.map(n=>n*Math.abs(this.getTransform().a)));if(window.__containsDashes.length>30)window.__containsDashes.shift()}
      return original.call(this,segments)
    }
  })
  page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(pathToFileURL(path).href)
  await page.waitForFunction(()=>window.graphExperiment?.snapshot().stopped)
  await page.selectOption('#algorithm','D3')
  await page.waitForFunction(()=>window.graphExperiment?.snapshot().stopped,{},{timeout:15000})
  await page.waitForTimeout(250)
  const snapshot=()=>page.evaluate(()=>graphExperiment.snapshot())
  let state=await snapshot();assert.equal(state.nodes.length,source.nodes.filter(n=>n.record).length)
  result.overview={labels:state.labels.length,nodes:state.nodes.length,ticks:state.ticks}
  await page.screenshot({path:join(out,'overview.png')})
  const host=await page.locator('#graph').boundingBox()
  const target=state.nodes.filter(n=>n.screen.x>130&&n.screen.x<host.width-200&&n.screen.y>100&&n.screen.y<host.height-100)
    .sort((a,b)=>b.degree-a.degree)[0]
  assert.ok(target,'A visible drag target is required')
  const neighbors=await page.evaluate(id=>graphExperiment.adjacent(id),target.id)
  await page.mouse.move(host.x+target.screen.x,host.y+target.screen.y)
  await page.waitForFunction(id=>graphExperiment.snapshot().hovered===id,target.id,{timeout:3000})
  await page.mouse.down()
  for(let i=1;i<=20;i++){
    await page.mouse.move(host.x+target.screen.x+i*6,host.y+target.screen.y+i*2)
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(250)
  const during=await snapshot()
  assert.ok(during.dragged>0,'Actual Canvas node drag must fire')
  const moves=during.nodes.filter(n=>neighbors.includes(n.id)).map(n=>{
    const old=state.nodes.find(o=>o.id===n.id);return Math.hypot(n.x-old.x,n.y-old.y)
  })
  assert.ok(Math.max(...moves)>5,'Neighbors must move while the pointer is held')
  assert.deepEqual(during.camera,state.camera,'Node drag must not move camera')
  await page.screenshot({path:join(out,'dragging.png')})
  await page.mouse.up();await page.mouse.move(10,10);await page.waitForTimeout(500)
  const after=await snapshot();assert.equal(after.released,1);assert.ok(after.nodes.every(n=>!n.fixed))
  assert.deepEqual(after.camera,state.camera,'Release must not auto-fit')
  const releaseMotion=after.nodes.reduce((max,n)=>{const old=during.nodes.find(o=>o.id===n.id);return Math.max(max,Math.hypot(n.x-old.x,n.y-old.y))},0)
  assert.ok(releaseMotion>1,'Network must settle after release, not freeze')
  result.drag={callbacks:during.dragged,neighborMaxDisplacement:Math.max(...moves),releaseMotion,cameraStable:true}
  await page.waitForFunction(()=>graphExperiment.snapshot().stopped,{},{timeout:15000})
  state=await snapshot();const camera=state.camera
  await page.locator('#expanded').click();await page.waitForTimeout(100)
  await page.waitForFunction(()=>graphExperiment.snapshot().stopped,{},{timeout:15000})
  state=await snapshot();assert.equal(state.nodes.length,source.nodes.length);assert.equal(state.edges,source.edges.length)
  await page.locator('#fit').click();await page.waitForTimeout(500);state=await snapshot()
  result.expanded={nodes:state.nodes.length,edges:state.edges,labels:state.labels.length}
  await page.screenshot({path:join(out,'expanded.png')})
  await page.mouse.move(host.x+host.width/2,host.y+host.height/2);await page.mouse.wheel(0,-450);await page.waitForTimeout(400)
  assert.ok((await snapshot()).camera.zoom>state.camera.zoom,'Wheel zoom must work')
  const zoomed=await snapshot();result.zoomedLabels=zoomed.labels.length
  await page.screenshot({path:join(out,'zoomed.png')})
  await page.locator('#search').fill('文献');await page.waitForTimeout(200)
  assert.deepEqual((await snapshot()).camera,zoomed.camera,'Search must not move camera')
  assert.ok((await snapshot()).sourceUnchanged,'Never mutate the source graph')
  await page.locator('#search').fill('')
  await page.setViewportSize({width:680,height:780});await page.locator('#fit').click();await page.waitForTimeout(500)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:join(out,'narrow.png')})
  await page.setViewportSize({width:1200,height:860})
  result.algorithms=[]
  const coordinates=s=>s.nodes.map(n=>[n.id,n.x,n.y])
  for(const algorithm of ['ForceAtlas2 LinLog','fCoSE','WebCoLa','ELK Stress']){
    await page.locator('#overview').click()
    await page.selectOption('#algorithm',algorithm)
    await page.waitForFunction(name=>{const s=graphExperiment.snapshot();return s.algorithm===name&&s.stopped},algorithm)
    await page.waitForTimeout(250)
    const overview=await snapshot()
    assert.equal(overview.layoutError,'')
    assert.equal(overview.nodes.length,source.nodes.filter(n=>n.record).length)
    await page.screenshot({path:join(out,`${algorithm}-overview.png`)})
    await page.waitForTimeout(400)
    assert.deepEqual(coordinates(await snapshot()),coordinates(overview),'Idle D3 must not overwrite another algorithm')
    await page.locator('#expanded').click()
    await page.waitForFunction(()=>graphExperiment.snapshot().expanded&&graphExperiment.snapshot().stopped)
    await page.locator('#reset').click()
    await page.waitForFunction(()=>graphExperiment.snapshot().stopped)
    await page.waitForTimeout(250)
    const cold=await snapshot()
    assert.equal(cold.layoutError,'')
    assert.equal(cold.nodes.length,source.nodes.length);assert.equal(cold.edges,source.edges.length)
    assert.equal(cold.adjusted,false);assert.ok(cold.sourceUnchanged)
    await page.screenshot({path:join(out,`${algorithm}-expanded.png`)})
    const dashes=await page.evaluate(()=>window.__containsDashes)
    assert.ok(dashes.some(d=>Math.abs(d[0]-4)<.01&&Math.abs(d[1]-4)<.01),'Parent dashes must be 4px/4px on screen')
    await page.waitForTimeout(400)
    assert.deepEqual(coordinates(await snapshot()),coordinates(cold))
    const bounds=await page.locator('#graph').boundingBox()
    const node=cold.nodes.filter(n=>n.degree>0&&n.screen.x>50&&n.screen.x<bounds.width-140&&n.screen.y>50&&n.screen.y<bounds.height-80&&
      cold.nodes.every(o=>o.id===n.id||Math.hypot(n.screen.x-o.screen.x,n.screen.y-o.screen.y)>22)).sort((a,b)=>b.degree-a.degree)[0]
    assert.ok(node,'Non-overlapping visible node needed for drag')
    await page.mouse.move(bounds.x+node.screen.x,bounds.y+node.screen.y)
    await page.waitForFunction(id=>graphExperiment.snapshot().hovered===id,node.id)
    await page.mouse.down()
    for(let i=1;i<=15;i++){await page.mouse.move(bounds.x+node.screen.x+i*5,bounds.y+node.screen.y+i*2);await page.waitForTimeout(30)}
    const dragging=await snapshot();assert.ok(dragging.dragged>cold.dragged);assert.equal(dragging.adjusted,true)
    assert.deepEqual(dragging.camera,cold.camera)
    await page.mouse.up();await page.mouse.move(10,10)
    await page.waitForFunction(()=>graphExperiment.snapshot().stopped,{},{timeout:15000})
    const settled=await snapshot();assert.ok(settled.nodes.every(n=>!n.fixed));assert.deepEqual(settled.camera,cold.camera)
    await page.locator('#reset').click();await page.waitForFunction(()=>graphExperiment.snapshot().stopped);await page.waitForTimeout(150)
    assert.equal((await snapshot()).adjusted,false)
    assert.deepEqual(coordinates(await snapshot()),coordinates(cold),'Reset must reproduce chosen solver, not D3 relaxation')
    result.algorithms.push({algorithm,overviewNodes:overview.nodes.length,expandedNodes:cold.nodes.length,edges:cold.edges,milliseconds:cold.layoutMilliseconds,
      preservedAtRest:true,elasticDrag:true,resetReproducible:true,containsDashPixels:dashes.find(d=>Math.abs(d[0]-4)<.01&&Math.abs(d[1]-4)<.01)})
  }
  // Size is computed from the complete input, not the currently visible projection.
  result.nodeSize=[]
  const owner=new Map(source.nodes.map(n=>[n.id,n.record?n.id:n.recordId]))
  const targets=new Map(source.nodes.filter(n=>n.record).map(n=>[n.id,new Set()]))
  for(const e of source.edges){const a=owner.get(e.from),b=owner.get(e.to)
    if(e.kind!=='contains'&&a&&b&&a!==b){targets.get(a)?.add(b);targets.get(b)?.add(a)}}
  const checkSize=s=>{
    assert.equal(s.layoutError,'');assert.ok(s.sourceUnchanged)
    for(const n of s.nodes){
      if(!n.record){assert.equal(n.radius,2);continue}
      assert.equal(n.reach,targets.get(n.id).size)
      assert.equal(n.radius,Math.sqrt(6.25+9*Math.min(48,n.reach)))
      assert.equal(n.layoutDiameter,24+4*Math.max(0,n.radius-6))
    }
  }
  for(const algorithm of ['fCoSE','WebCoLa','ELK Stress','ForceAtlas2 LinLog','D3']){
    await page.selectOption('#algorithm',algorithm)
    await page.waitForFunction(()=>graphExperiment.snapshot().stopped,{},{timeout:30000})
    if((await snapshot()).sizeMode!=='uniform'){
      await page.selectOption('#node-size','uniform')
      await page.waitForFunction(()=>graphExperiment.snapshot().stopped,{},{timeout:30000})
    }
    const uniform=await snapshot()
    assert.ok(uniform.nodes.every(n=>n.radius===(n.record?4:2)))
    await page.selectOption('#node-size','reach')
    await page.waitForFunction(()=>graphExperiment.snapshot().stopped,{},{timeout:30000})
    const sized=await snapshot();checkSize(sized)
    assert.deepEqual(sized.camera,uniform.camera,'Size toggle must not reset camera')
    assert.equal(sized.nodes.length,source.nodes.length);assert.equal(sized.edges,source.edges.length)
    await page.locator('#fit').click();await page.waitForTimeout(500)
    await page.screenshot({path:join(out,`${algorithm}-reach-expanded.png`)})
    await page.locator('#overview').click()
    await page.waitForFunction(()=>graphExperiment.snapshot().stopped,{},{timeout:30000})
    checkSize(await snapshot())
    await page.locator('#fit').click();await page.waitForTimeout(500)
    await page.screenshot({path:join(out,`${algorithm}-reach-overview.png`)})
    const overview=await snapshot()
    await page.locator('#search').fill('文献')
    checkSize(await snapshot());assert.deepEqual((await snapshot()).camera,overview.camera)
    await page.locator('#search').fill('')
    await page.locator('#expanded').click()
    await page.waitForFunction(()=>graphExperiment.snapshot().stopped,{},{timeout:30000})
    checkSize(await snapshot())
    result.nodeSize.push({algorithm,fullInputCounts:true,sizeStableAcrossViews:true,cameraStableOnToggle:true,
      minRadius:Math.min(...sized.nodes.filter(n=>n.record).map(n=>n.radius)),maxRadius:Math.max(...sized.nodes.map(n=>n.radius))})
  }
  await page.setViewportSize({width:680,height:780})
  await page.waitForTimeout(250)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:join(out,'reach-narrow.png')})
  assert.deepEqual(errors,[])
}finally{await browser.close()}
await writeFile(join(out,'verification.json'),JSON.stringify({...result,errors},null,2))
console.log(JSON.stringify(result,null,2))
