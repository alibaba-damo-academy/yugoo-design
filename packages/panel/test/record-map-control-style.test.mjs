import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'

const css=await readFile(new URL('../src/visual-components.css',import.meta.url),'utf8')
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(match=>match[1].includes('.dsh-record-map input') && !match[1].includes('.dsh-design-panel'))
  .map(match=>match[0]).join('\n')

test('simple record card titles and field captions have distinct hierarchy without changing nested forms or compact tables',()=>{
 const dom=new JSDOM(`<style>${css}</style><div class="dsh-design-panel"><div class="dsh-record-map"><section>
 <header><strong id="title">Credential 1</strong></header>
 <div class="dsh-record-map-body">
 <label><span id="caption">Credential name</span><input id="input"></label>
 <div class="dsh-design-field"><span id="nested" class="dsh-design-field-label">Nested typed field</span></div>
 </div>
 </section></div><div class="dsh-record-map is-compact"><section><label><span id="compact">Table caption</span><input></label></section></div></div><div class="dsh-record-map"><section><header><strong id="host">Host heading</strong></header></section></div>`)
 try{
  const style=id=>dom.window.getComputedStyle(dom.window.document.getElementById(id))
  assert.equal(style('title').fontSize,'14px')
  assert.equal(style('title').fontWeight,'500')
  assert.equal(style('caption').fontSize,style('nested').fontSize)
  assert.equal(style('caption').fontWeight,'400')
  assert.equal(style('caption').lineHeight,'20px')
  assert.equal(style('input').fontSize,'var(--ygd-panel-text-size,14px)','editing text uses the shared text-size token')
  assert.equal(style('input').height,'36px')
  assert.equal(style('compact').fontSize,style('nested').fontSize,'field labels share the same density in compact and nested views')
  assert.equal(style('compact').fontWeight,'400')
  assert.notEqual(style('nested').fontSize,'12px','nested form labels retain their own hierarchy')
  assert.equal(style('nested').fontWeight,'400','ordinary nested labels do not compete with record titles')
  assert.notEqual(style('host').fontWeight,'500','host headings are outside Panel scope')
 }finally{dom.window.close()}
})

test('nested native choice controls do not inherit full-width text input styling',()=>{
 const dom=new JSDOM(`<style>${rules}</style><div class="dsh-record-map"><label class="dsh-design-field-choice"><input id="radio" type="radio" checked>Always required</label><label><input id="checkbox" type="checkbox" disabled>Confirmed</label><input id="text" type="text"><input id="number" type="number"><textarea id="textarea"></textarea><select id="select"><option>One</option></select></div><input id="host" type="radio">`)
 try{
  const style=id=>dom.window.getComputedStyle(dom.window.document.getElementById(id))
  for(const id of ['radio','checkbox']){
   assert.equal(style(id).width,'16px',`${id} keeps the shared choice-control size instead of full-width text styling`)
   assert.equal(style(id).flex,'0 0 16px',`${id} is not stretched or compressed by choice labels`)
   assert.notEqual(style(id).paddingLeft,'10px',`${id} does not inherit text field padding`)
  }
  for(const id of ['text','number','textarea','select']){
   assert.equal(style(id).width,'100%',`${id} keeps full-width editable control`)
   assert.equal(style(id).paddingLeft,'12px')
   assert.equal(style(id).borderRadius,'8px')
  }
  assert.notEqual(style('host').flex,'0 0 auto','Host controls remain outside the Panel scope')
  assert.equal(dom.window.document.getElementById('radio').checked,true)
  assert.equal(dom.window.document.getElementById('checkbox').disabled,true)
 }finally{dom.window.close()}
})

test('nested choice rows use only the shared choice gap while card fields own section spacing',()=>{
 const dom=new JSDOM(`<style>${css}</style><div class="dsh-design-panel"><div class="dsh-record-workspace">
 <button class="dsh-panel-workspace-map-toggle"><svg class="dsh-panel-disclosure-icon"></svg></button>
 <div class="dsh-record-map"><details open>
   <summary class="dsh-record-map-heading dsh-panel-disclosure"><span class="dsh-panel-disclosure-label">Field</span><div class="dsh-record-map-actions"><button>Remove</button></div><svg class="dsh-panel-disclosure-icon"></svg></summary>
   <div class="dsh-record-map-body">
   <label id="column"><span>Name</span><input></label>
   <div class="dsh-design-field"><span class="dsh-design-field-label">When required?</span><div class="dsh-design-field-choices">
     <label id="first" class="dsh-design-field-choice"><input type="radio" checked><span>Optional</span></label>
     <label id="second" class="dsh-design-field-choice"><input type="radio"><span>Required</span></label>
   </div></div></div>
 </details><section><header><strong>Ordinary record</strong></header></section><button class="dsh-record-map-add">Add</button></div>
 <details class="dsh-record-board-editor" open><summary class="dsh-panel-disclosure"><span class="dsh-panel-disclosure-label">Details</span><svg class="dsh-panel-disclosure-icon"></svg></summary><section><h5 id="detail-group">Input</h5></section><div class="dsh-compact-record-details"><section data-detail-control="record_map"><header><h5 id="nested-group">Output</h5></header></section></div></details>
 </div></div>`)
 try{
  const style=selector=>dom.window.getComputedStyle(dom.window.document.querySelector(selector))
  assert.equal(style('.dsh-record-map').gap,'var(--ygd-panel-detail-section-gap, 16px)')
  assert.equal(style('.dsh-record-map > section').gap,'var(--ygd-panel-detail-control-gap, 8px)')
  assert.equal(style('.dsh-record-map-body').gap,'var(--ygd-panel-detail-section-gap, 16px)')
  assert.equal(style('#column').margin,'0px')
  assert.equal(style('.dsh-design-field').margin,'0px')
  assert.equal(style('.dsh-design-field-choices').gap,'8px')
  for(const id of ['first','second']){
   assert.equal(style(`#${id}`).margin,'0px',`${id} does not inherit margins from a card's column label`)
   assert.equal(style(`#${id}`).display,'flex')
   assert.equal(style(`#${id}`).minHeight,'24px')
   assert.notEqual(style(`#${id} > span`).fontWeight,'500','choice text does not inherit field-heading weight')
  }
  assert.equal(style('.dsh-record-map-heading').fontWeight,'500')
  assert.equal(style('.dsh-record-map-heading').fontSize,'14px')
  assert.equal(style('.dsh-record-map-heading').gap,'8px')
  // The native summary resets physical padding. JSDOM reports an empty logical
  // shorthand here; keep checking both real insets instead of dropping the guard.
  assert.equal(style('.dsh-record-map-heading').paddingLeft,'0px','inline heading never inherits ordinary button indentation')
  assert.equal(style('.dsh-record-map-heading').paddingRight,'0px')
  assert.equal(style('.dsh-record-map-heading').minHeight,'28px')
  assert.equal(style('.dsh-panel-disclosure-label').overflowWrap,'anywhere')
  assert.equal(style('.dsh-panel-disclosure-icon').width,'16px')
  assert.equal(style('.dsh-panel-workspace-map-toggle').padding,'0px','workspace defaults cannot override the shared canvas toggle')
  assert.equal(style('.dsh-panel-workspace-map-toggle').borderRadius,'8px 0 0 8px')
  // CSS normal and 400 are the same weight; JSDOM serializes the inherited
  // font shorthand as normal. Baseline and current stylesheet both do this.
  assert.ok(['400','normal'].includes(style('.dsh-record-board-editor > summary').fontWeight),'detail disclosure retains its accepted normal weight')
  assert.equal(style('#detail-group').fontWeight,'500','record detail groups do not outweigh the record title')
  assert.equal(style('#nested-group').fontWeight,'400','compact dimension captions use the shared field-label role, not a second record heading')
  // JSDOM incorrectly lets its UA summary rules override author styles. Real
  // Chromium verifies flex + no marker; retain the authored rule check here.
  assert.equal([...dom.window.document.styleSheets[0].cssRules].find(rule=>rule.selectorText==='summary.dsh-panel-disclosure').style.getPropertyValue('list-style'),'none')
  assert.equal(style('summary > svg').transform,'rotate(90deg)','native details open state owns the same disclosure glyph')
 }finally{dom.window.close()}
})

test('short peer choices opt into shared wrapping rows without changing the legacy vertical baseline',()=>{
 const dom=new JSDOM(`<style>${css}</style><div class="dsh-design-panel"><div class="dsh-record-map"><section>
 <div id="wrapped" class="dsh-design-field-choices is-row_wrap"><label class="dsh-design-field-choice"><input type="radio" checked>Optional</label><label class="dsh-design-field-choice"><input type="radio">Conditionally required</label></div>
 <div id="legacy" class="dsh-design-field-choices"><label class="dsh-design-field-choice"><input type="radio">Long explanation</label></div>
 </section></div></div>`)
 try{
  const style=id=>dom.window.getComputedStyle(dom.window.document.getElementById(id))
  assert.equal(style('wrapped').display,'flex')
  assert.equal(style('wrapped').flexWrap,'wrap')
  assert.equal(style('wrapped').gap,'8px 20px')
  assert.notEqual(style('legacy').flexWrap,'wrap','omitted layout retains its established presentation')
  assert.equal(dom.window.document.querySelector('#wrapped input').checked,true)
 }finally{dom.window.close()}
})
