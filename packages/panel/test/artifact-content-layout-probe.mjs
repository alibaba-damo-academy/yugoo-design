import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const origin=process.argv[2]
assert.ok(origin,'Usage: node test/artifact-content-layout-probe.mjs FIXTURE_ORIGIN')
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:1500,height:900}})
  await page.goto(origin)
  const rows=await page.evaluate(()=>[...document.querySelectorAll('.probe')].map(e=>{
    const p=e.querySelector('.dsh-artifact-preview'),m=e.querySelector('.dsh-artifact-markdown'),s=e.querySelector('section'),i=e.querySelector('iframe'),c=e.querySelector('.dsh-artifact-content'),o=e.querySelector('.dsh-artifact-output')
    const r=p.getBoundingClientRect(),sr=s.getBoundingClientRect()
    const mr=m?.getBoundingClientRect(),or=o.getBoundingClientRect()
    c.scrollTop=c.scrollHeight
    const end=s.getBoundingClientRect(),cr=c.getBoundingClientRect()
    return {kind:e.dataset.kind,width:e.dataset.width??'960',previewHeight:r.height,sourceGap:s.querySelector('h3').getBoundingClientRect().top-p.getBoundingClientRect().bottom,markdownContained:!mr||mr.bottom<=r.bottom+1,iframeHeight:i?.getBoundingClientRect().height,sourceWidth:sr.width,sourceCenterOffset:Math.abs((sr.x+sr.width/2)-(or.x+or.width/2)),bodySourceOffset:mr?Math.abs(mr.x-sr.x)+Math.abs(mr.width-sr.width):0,whiteReadingSurface:getComputedStyle(c).backgroundColor,bodyBorder:m?getComputedStyle(m).borderTopWidth:null,bodySize:m?getComputedStyle(m).fontSize:null,sourceSize:getComputedStyle(s).fontSize,h2Size:m?getComputedStyle(m.querySelector('h2')).fontSize:null,endReachable:end.bottom<=cr.bottom+1,overflow:c.scrollWidth>c.clientWidth+1}
  }))
  assert.equal(rows.length,4)
  for(const row of rows){const diagnostic=JSON.stringify(row);assert.ok(row.sourceGap>=15,diagnostic);assert.ok(row.markdownContained,diagnostic);assert.ok(row.sourceWidth<=920,diagnostic);assert.ok(row.sourceCenterOffset<1,diagnostic);assert.ok(row.bodySourceOffset<1,diagnostic);assert.equal(row.whiteReadingSurface,'rgb(255, 255, 255)',diagnostic);assert.ok(row.endReachable,diagnostic);assert.equal(row.overflow,false,diagnostic);assert.equal(row.sourceSize,'14px',diagnostic);if(row.kind==='markdown'){assert.ok(row.previewHeight>1000,diagnostic);assert.equal(row.bodyBorder,'0px',diagnostic);assert.equal(row.bodySize,'14px',diagnostic);assert.equal(row.h2Size,'16px',diagnostic)}else assert.ok(row.iframeHeight>=360,diagnostic)}
  console.log(JSON.stringify({passed:rows.length,rows}))
} finally {await browser.close()}
