import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const origin=process.argv[2]
assert.ok(origin,'Usage: node test/artifact-content-layout-probe.mjs FIXTURE_ORIGIN')
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:1200,height:900}})
  await page.goto(origin)
  const rows=await page.evaluate(()=>[...document.querySelectorAll('.probe')].map(e=>{
    const p=e.querySelector('.dsh-artifact-preview'),m=e.querySelector('.dsh-artifact-markdown'),s=e.querySelector('section'),i=e.querySelector('iframe')
    const r=p.getBoundingClientRect(),sr=s.getBoundingClientRect()
    return {kind:e.dataset.kind,width:e.dataset.width??'960',previewHeight:r.height,sourceGap:sr.top-r.bottom,markdownContained:!m||m.getBoundingClientRect().bottom<=r.bottom+1,iframeHeight:i?.getBoundingClientRect().height}
  }))
  assert.equal(rows.length,3)
  for(const row of rows){const diagnostic=JSON.stringify(row);assert.ok(row.sourceGap>=15,diagnostic);assert.ok(row.markdownContained,diagnostic);if(row.kind==='markdown')assert.ok(row.previewHeight>1000,diagnostic);else assert.ok(row.iframeHeight>=360,diagnostic)}
  console.log(JSON.stringify({passed:rows.length,rows}))
} finally {await browser.close()}
