/** Bounded visual acceptance of the frozen HTML, not a production/KAG test. */
import {chromium} from 'playwright'
import {writeFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {intersects} from './graph-labels.mjs'
const path=process.argv[2],out=dirname(path),browser=await chromium.launch({headless:true})
const report=[],errors=[]
try{
 for(const [width,height]of [[1600,1000],[1366,900],[1920,1080]]){
  const page=await browser.newPage({viewport:{width,height}})
  page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(pathToFileURL(path).href)
  const settled=()=>page.waitForFunction(()=>window.graphExperiment?.snapshot().stopped)
  const snap=()=>page.evaluate(()=>graphExperiment.snapshot())
  const inspect=async name=>{
    await page.waitForTimeout(120)
    const s=await snap(),box=await page.locator('#graph').boundingBox()
    const onScreen=s.nodes.filter(n=>n.screen.x>=0&&n.screen.x<=box.width&&n.screen.y>=0&&n.screen.y<=box.height)
    const records=s.nodes.filter(n=>n.record),visibleRecords=records.filter(n=>s.labels.includes(n.id))
    const overlapping=s.labelBoxes.flatMap((a,i)=>s.labelBoxes.slice(i+1).filter(b=>intersects(a,b)))
    assert.equal(overlapping.length,0,`${width} ${name}: overlapping labels`)
    assert.equal(s.layoutError,'');assert.ok(s.sourceUnchanged)
    if(!s.selected){
      assert.equal(onScreen.length,s.nodes.length,`${width} ${name}: clipped nodes`)
      assert.equal(visibleRecords.length,records.length,`${width} ${name}: unlabeled design records`)
    }else{
      assert.ok(s.labels.includes(s.selected),`${name}: selected record label missing`)
      assert.ok(s.labels.includes(s.targetRecord),`${name}: other record label missing`)
      assert.ok(s.highlightedNodes.every(id=>s.labels.includes(id)),`${name}: path label missing`)
    }
    await page.screenshot({path:join(out,`visual-${width}-${name}.png`)})
    report.push({width,height,name,nodes:s.nodes.length,records:records.length,visibleRecords:visibleRecords.length,labels:s.labels.length,overlaps:0,sourceUnchanged:true})
    return s
  }
  await settled();const overview=await inspect('overview')
  const title=overview.labelBoxes.find(b=>overview.nodes.find(n=>n.id===b.id)?.label==='文献精读与关联发现')
  const host=await page.locator('#graph').boundingBox()
  await page.mouse.move(host.x+title.x+title.w/2,host.y+title.y+title.h/2);await page.waitForTimeout(120)
  await page.mouse.click(host.x+title.x+title.w/2,host.y+title.y+title.h/2)
  assert.equal((await snap()).selected,title.id,'A visible title must remain clickable through hover')
  await page.getByRole('button',{name:'清除选择',exact:true}).click();await page.mouse.move(5,5)
  await page.locator('#expanded').click();await settled();await inspect('expanded')
  await page.locator('#reset').click();await settled();await inspect('expanded-reset')
  await page.getByRole('button',{name:'文献精读与关联发现',exact:true}).click()
  await page.locator('.relation-choice').filter({hasText:'深度阅读与笔记'}).click()
  const before=await inspect('evidence')
  for(let i=1;i<7;i++){
    await page.getByRole('button',{name:'下一处',exact:true}).click()
    const after=await inspect(`evidence-${i+1}`)
    assert.deepEqual(after.camera,before.camera)
    assert.deepEqual(after.nodes.map(n=>[n.x,n.y]),before.nodes.map(n=>[n.x,n.y]))
  }
  await page.getByRole('button',{name:'放大这条关联',exact:true}).click();await page.waitForTimeout(450)
  await inspect('focus')
  await page.close()
 }
 assert.deepEqual(errors,[])
}finally{await browser.close()}
await writeFile(join(out,'visual-acceptance.json'),JSON.stringify({report,errors},null,2))
console.log(JSON.stringify({cases:report.length,errors}))
