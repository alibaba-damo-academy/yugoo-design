import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {dirname,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {writeFile} from 'node:fs/promises'
const path=process.argv[2],out=dirname(path),browser=await chromium.launch({headless:true}),errors=[],results=[]
let maxWorkers=0,workersStarted=0
const activeWorkers=new Set()
try{
  const page=await browser.newPage({viewport:{width:1500,height:980}})
  page.on('worker',worker=>{workersStarted++;activeWorkers.add(worker);maxWorkers=Math.max(maxWorkers,activeWorkers.size);worker.on('close',()=>activeWorkers.delete(worker))})
  page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(pathToFileURL(path).href)
  const snap=()=>page.evaluate(()=>graphExperiment.snapshot())
  const settled=()=>page.waitForFunction(()=>graphExperiment.snapshot().stopped,{},{timeout:15000})
  for(const expanded of [false,true])for(const size of ['uniform','reach']){
    await settled();await page.selectOption('#node-size',size);await settled()
    await page.locator(expanded?'#expanded':'#overview').click();await settled()
    await page.locator('#reset').click();await settled();await page.locator('#fit').click();await page.waitForTimeout(450)
    const before=await snap(),r=await page.locator('#graph').boundingBox()
    const n=before.nodes.find(n=>n.label==='文献精读与关联发现'&&n.record)
    const neighbors=await page.evaluate(id=>graphExperiment.adjacent(id),n.id),far=before.nodes.filter(o=>o.id!==n.id&&!neighbors.includes(o.id))
    const displacement=(s,ids)=>Math.max(0,...s.nodes.filter(n=>ids.includes(n.id)).map(n=>{const p=before.nodes.find(o=>o.id===n.id);return Math.hypot(n.x-p.x,n.y-p.y)}))
    await page.mouse.move(r.x+n.screen.x,r.y+n.screen.y);await page.waitForFunction(id=>graphExperiment.snapshot().hovered===id,n.id)
    await page.mouse.down()
    for(let i=1;i<=15;i++){await page.mouse.move(r.x+n.screen.x+i*6,r.y+n.screen.y+i*2);await page.waitForTimeout(30)}
    await page.waitForTimeout(250)
    const during=await snap()
    assert.ok(during.dragged>before.dragged);assert.ok(during.localSolves>before.localSolves)
    assert.equal(displacement(during,far.map(n=>n.id)),0,'Far coordinates must not move during drag')
    assert.ok(displacement(during,neighbors)>1,'Actual neighboring nodes must follow')
    assert.deepEqual(during.camera,before.camera)
    await page.screenshot({path:join(out,`${expanded?'expanded':'overview'}-${size}-dragging.png`)})
    await page.mouse.up();await page.mouse.move(5,5);await settled()
    const after=await snap()
    assert.equal(displacement(after,far.map(n=>n.id)),0,'Far nodes must remain stationary after release')
    assert.ok(after.nodes.every(n=>!n.fixed));assert.equal(after.localDragging,false)
    assert.deepEqual(after.camera,before.camera);assert.ok(after.sourceUnchanged);assert.equal(after.layoutError,'')
    assert.match(await page.locator('#algorithm-note').textContent(),/不切换 D3/)
    const finalPosition=after.nodes.find(o=>o.id===n.id)
    assert.ok(Math.abs(finalPosition.screen.x-n.screen.x-90)<2,'Dragged node follows pointer in screen coordinates')
    await page.waitForTimeout(250)
    assert.deepEqual((await snap()).nodes.map(n=>[n.x,n.y]),after.nodes.map(n=>[n.x,n.y]))
    results.push({expanded,size,farNodes:far.length,farMovement:0,neighborMovement:displacement(after,neighbors),solves:after.localSolves-before.localSolves,maxSolveMs:after.maxLocalSolveMs,sourceUnchanged:true})
  }
  // A second drag after wheel zoom still uses graph coordinates correctly.
  const beforeZoom=await snap(),r=await page.locator('#graph').boundingBox()
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.wheel(0,-240);await page.waitForTimeout(450)
  assert.ok((await snap()).camera.zoom>beforeZoom.camera.zoom)
  const s=await snap(),n=s.nodes.find(n=>n.record&&n.screen.x>60&&n.screen.x<r.width-100&&n.screen.y>60&&n.screen.y<r.height-100)
  await page.mouse.move(r.x+n.screen.x,r.y+n.screen.y);await page.waitForFunction(id=>graphExperiment.snapshot().hovered===id,n.id)
  await page.mouse.down();await page.mouse.move(r.x+n.screen.x+40,r.y+n.screen.y+20,{steps:10});await page.mouse.up();await page.mouse.move(5,5);await settled()
  assert.ok(Math.abs((await snap()).nodes.find(o=>o.id===n.id).screen.x-n.screen.x-40)<2)
  // Re-grab the same node before release relaxation finishes. A previous released
  // flag must not end this new held gesture, and no worker backlog may build up.
  for(let i=0;i<2;i++){
    const start=await snap(),target=start.nodes.find(o=>o.id===n.id)
    await page.mouse.move(r.x+target.screen.x,r.y+target.screen.y);await page.waitForFunction(id=>graphExperiment.snapshot().hovered===id,n.id)
    await page.mouse.down();await page.mouse.move(r.x+target.screen.x+30,r.y+target.screen.y+15,{steps:5})
    if(i===1){await page.waitForTimeout(500);assert.equal((await snap()).localDragging,true)}
    await page.mouse.up()
  }
  // Switching view while the last worker/animation is still active cancels both.
  await page.locator('#overview').click();await settled()
  const switched=await snap();assert.equal(switched.nodes.length,24);assert.equal(switched.localDragging,false)
  await page.waitForTimeout(350)
  assert.deepEqual((await snap()).nodes.map(n=>[n.x,n.y]),switched.nodes.map(n=>[n.x,n.y]),'No stale worker may move replacement nodes')
  // After local adjustment, spacing must scale the static result, not wake D3.
  const coords=switched.nodes.map(n=>[n.x,n.y])
  await page.locator('#spacing').fill('1.2');await page.waitForTimeout(200)
  const spaced=await snap();assert.ok(spaced.stopped);assert.deepEqual(spaced.nodes.map(n=>[n.x,n.y]),coords.map(([x,y])=>[x*1.2,y*1.2]))
  await page.waitForTimeout(250);assert.deepEqual((await snap()).nodes.map(n=>[n.x,n.y]),spaced.nodes.map(n=>[n.x,n.y]))
  assert.ok(workersStarted>0,'Actual browser workers must perform local solves')
  assert.equal(maxWorkers,1,'At most one geometry worker may exist')
  assert.equal(activeWorkers.size,0,'No idle worker is kept after settling or switching views')
  // A worker launch failure stays explicit; dragging must not silently fall back
  // to D3, create one new worker per move, or leave a permanently pinned node.
  await page.locator('#reset').click();await settled();await page.locator('#fit').click();await page.waitForTimeout(450)
  await page.evaluate(()=>{window.originalWorker=window.Worker;window.failedLaunches=0;window.Worker=class{constructor(){window.failedLaunches++;throw Error('test worker unavailable')}}})
  const failureStart=await snap(),target=failureStart.nodes.find(n=>n.record&&n.label==='文献精读与关联发现')
  await page.mouse.move(r.x+target.screen.x,r.y+target.screen.y);await page.waitForFunction(id=>graphExperiment.snapshot().hovered===id,target.id)
  await page.mouse.down()
  for(let i=1;i<=10;i++){await page.mouse.move(r.x+target.screen.x+i*5,r.y+target.screen.y+i);await page.waitForTimeout(40)}
  await page.mouse.up();await page.mouse.move(5,5);await settled()
  assert.equal(await page.evaluate(()=>window.failedLaunches),1)
  const failed=await snap();assert.match(failed.layoutError,/test worker unavailable/);assert.equal(failed.algorithm,'fCoSE');assert.ok(failed.nodes.every(n=>!n.fixed))
  assert.deepEqual(failed.camera,failureStart.camera)
  await page.evaluate(()=>{window.Worker=window.originalWorker;delete window.originalWorker})
  await page.locator('#reset').click();await settled();assert.equal((await snap()).layoutError,'')
  assert.deepEqual(errors,[])
}finally{await browser.close()}
await writeFile(join(out,'local-drag-verification.json'),JSON.stringify({results,zoomedDrag:true,regrab:true,cancelOnViewChange:true,workersStarted,maxWorkers,activeWorkers:activeWorkers.size,errors},null,2));console.log(JSON.stringify({results,zoomedDrag:true,regrab:true,cancelOnViewChange:true,workersStarted,maxWorkers,activeWorkers:activeWorkers.size,errors}))
