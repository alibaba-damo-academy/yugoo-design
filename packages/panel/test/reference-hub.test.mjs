import test from 'node:test'
import assert from 'node:assert/strict'
import { referenceHubProjection, hubRecordFacts } from '../src/reference-hub.ts'
import { RecordPortrait, recordPortraitVariant } from '../src/record-portrait.tsx'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { referenceNodeKey } from '../src/reference-graph.ts'
const sections = ['actors','models','knowledge','methods','tools']
const bindings = {
  nodes: sections.map(source => ({source,label_field:'name',description_field:'description'})),
  links: [
    {source:'actors',field:'model',target:'models',reverse:true},
    {source:'actors',field:'knowledge',target:'knowledge'},
    {source:'actors',field:'methods',target:'methods'},
    {source:'actors',field:'tools',target:'tools'},
    {source:'actors',field:'handoffs',item_field:'target',target:'actors'},
  ],
  layout:{kind:'hub',center:'actors',top:'models',bottom:'knowledge',left:'methods',right:'tools',group_by:'model',value_field:'choice',entries:{field:'entries',title_field:'name',description_field:'location'}},
}
const sample = () => ({models:{m:{name:'Same'},other:{name:'Same'}},knowledge:{k:{name:'Library'}},methods:{s:{name:'Review'}},tools:{t:{name:'Search'}},actors:{
  a:{name:'Reader',model:'m',knowledge:['k'],methods:['s'],tools:['t'],choice:'User chooses',entries:{e:{name:'Ask',location:'Document sidebar'}},handoffs:{one:{target:'b',condition:'Approved'},two:{target:'b',condition:'Retry'}}},
  b:{name:'Writer',model:'m',knowledge:['k']},c:{name:'Unknown',context:'Same'},d:{name:'Unknown',context:'Same'},e:{name:'Separate',model:'other'},
}})
const project = (data, focus) => referenceHubProjection(bindings, section => data[section] ?? {},section=>section,focus)
test('overview groups by explicit identities, never names or prose; no writes or fact loss',()=>{
  const data=sample(),before=structuredClone(data),view=project(data)
  assert.equal(view.nodes.length,8)
  assert.equal(view.groups.length,4)
  assert.equal(view.all.length,10)
  assert.equal(view.nodes.find(n=>n.record==='a').captions[0].description,'Document sidebar')
  assert.equal(view.nodes.find(n=>n.record==='a').value,'User chooses')
  assert.equal(view.edges.filter(e=>e.source===referenceNodeKey('actors','a')&&e.target===referenceNodeKey('actors','b')).length,1)
  assert.deepEqual(data,before,'multiple handoff rows remain canonical')
})
test('focus exposes only linked resources and navigation remains reversible without normalization',()=>{
  const data=sample(),before=JSON.stringify(data),focus=project(data,'a')
  assert.deepEqual(new Set(focus.nodes.map(n=>n.section)),new Set(sections))
  assert.equal(focus.nodes.length,5)
  assert.equal(focus.groups.length,0)
  assert.equal(project(data,'gone').focus,undefined)
  assert.equal(project(data).nodes.length,8)
  assert.equal(JSON.stringify(data),before)
})
test('long labels and dense resource lists do not overlap node boxes',()=>{
  const data=sample()
  data.actors.a.name='Long title '.repeat(50)
  data.actors.a.description='说明'.repeat(200)
  for(let i=0;i<20;i++){data.tools['t'+i]={name:'Tool '+i,description:'Description '.repeat(30)};data.actors.a.tools.push('t'+i)}
  for(const focus of [undefined,'a']){
    const {nodes}=project(data,focus)
    for(let i=0;i<nodes.length;i++)for(const b of nodes.slice(i+1)){
      const a=nodes[i];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`${a.id} / ${b.id}`)
    }
  }
})
test('missing targets stay visible as diagnostics, not invented nodes or shared groups',()=>{
  const data=sample();data.actors.a.model='missing'
  const view=project(data)
  assert.equal(view.missing.length,1)
  assert.equal(view.all.some(n=>n.record==='missing'),false)
  assert.equal(view.groups.length,5)
})
test('portrait preset encloses the real focused role; other hubs retain the legacy shape',()=>{
  const data=sample(),before=structuredClone(data)
  data.models.m.description='Long source description '.repeat(30)
  const refs=structuredClone(bindings);refs.layout.center_presentation='portrait'
  const view=referenceHubProjection(refs,source=>data[source],source=>source,'a')
  const frame=view.groups[0],role=view.nodes.find(node=>node.record==='a'&&node.section==='actors')
  assert.equal(frame.role,role)
  for(const node of view.nodes){assert.ok(node.x>=frame.x&&node.y>=frame.y);assert.ok(node.x+node.width<=frame.x+frame.width&&node.y+node.height<=frame.y+frame.height)}
  const top=view.nodes.find(node=>node.section==='models');assert.ok(top.y+top.height<role.y)
  assert.equal(project(data,'a').groups.length,0)
  assert.deepEqual(data.actors,before.actors)
  const bare={...data,actors:{a:{name:'Model-only',model:'m',choice:'Local choice'}}}
  const bareView=referenceHubProjection(refs,source=>bare[source],source=>source,'a')
  assert.deepEqual(bareView.nodes.map(node=>node.zone).sort(),['center','top'],'no invented tool, Skill or memory anatomy')
})
test('original portraits depend only on stable identity, not names, jobs or view state',()=>{
  const id=referenceNodeKey('actors','a'),html=renderToStaticMarkup(React.createElement(RecordPortrait,{identity:id}))
  assert.equal(html,renderToStaticMarkup(React.createElement(RecordPortrait,{identity:id})))
  assert.match(html,/viewBox="0 0 64 64"/);assert.match(html,/aria-hidden="true"/)
  assert.match(html,/ellipse/);assert.doesNotMatch(html,/<image|href=|https?:/)
  for(const key of ['a','b','new-role','名']) assert.ok(recordPortraitVariant(key)>=0&&recordPortraitVariant(key)<3)
  assert.ok(new Set(['a','b','new-role','名'].map(recordPortraitVariant)).size>1,'stable variants can distinguish records without inferring a role from its name')
})
test('portrait anatomy balances real side columns on the brain axis, with aligned column headings',()=>{
  const refs=structuredClone(bindings);refs.layout.center_presentation='portrait'
  for(const toolCount of [1,2,12]){
    const data=sample(),before=structuredClone(data)
    data.actors.a.tools=[]
    for(let i=0;i<toolCount;i++){
      data.tools['extra'+i]={name:i%2?'Long tool name '.repeat(12):'Tool '+i}
      data.actors.a.tools.push('extra'+i)
    }
    const canonical=structuredClone(data)
    const view=referenceHubProjection(refs,source=>data[source],source=>source,'a')
    const brain=view.nodes.find(node=>node.zone==='center'),axis=brain.y+brain.height/2
    for(const zone of ['left','right']){
      const column=view.nodes.filter(node=>node.zone===zone)
      const top=Math.min(...column.map(node=>node.y)),bottom=Math.max(...column.map(node=>node.y+node.height))
      assert.equal((top+bottom)/2,axis,`${zone} column must share the brain's horizontal axis`)
    }
    const frame=view.groups[0]
    assert.equal(new Set(frame.columns.map(column=>column.y)).size,1,'three headings sit on the same row')
    for(const column of frame.columns){
      const node=view.nodes.find(node=>node.zone===column.zone)
      assert.equal(column.x+frame.x,node.x+node.width/2,'each heading is horizontally centred on its column')
      assert.ok(column.y+18<Math.min(...view.nodes.filter(node=>['left','center','right'].includes(node.zone)).map(node=>node.y)))
    }
    const topBottom=Math.max(...view.nodes.filter(node=>node.zone==='top').map(node=>node.y+node.height))
    const middleTop=Math.min(...view.nodes.filter(node=>['left','center','right'].includes(node.zone)).map(node=>node.y))
    const middleBottom=Math.max(...view.nodes.filter(node=>['left','center','right'].includes(node.zone)).map(node=>node.y+node.height))
    assert.ok(topBottom<middleTop)
    assert.ok(view.nodes.filter(node=>node.zone==='bottom').every(node=>node.y>middleBottom))
    assert.deepEqual(data,canonical,'layout never changes design facts')
    assert.deepEqual(data.actors.b,before.actors.b)
  }
})
test('compact profile retains entry and collaboration facts using actual form semantics',()=>{
  const fields=[{key:'name',control:'text'},{key:'trigger',control:'radio',label:'Trigger',options:[{value:'background',label:'Automatic'}]},
    {key:'location',control:'text',label:'Location',label_when:[{field:'trigger',in:['background'],label:'When'}]},
    {key:'input',control:'text',visible_when:{field:'trigger',in:['conversation']}},
    {key:'context',control:'textarea',label:'Context'},{key:'feedback',control:'textarea',label:'Feedback'},
    {key:'target',control:'record_select',label:'Role',options_from_section:'actors'},
    {key:'handoff',control:'textarea',label:'Handoff'},{key:'condition',control:'textarea',label:'Condition'}]
  const row={name:'Entry',trigger:'background',location:'On approval',input:'Preserve hidden input',context:'Current selection',feedback:'Return a draft',target:'a',handoff:'Approved materials',condition:'Confirmed'}
  const before=structuredClone(row),facts=hubRecordFacts(fields,row,['name'],(_section,id)=>id==='a'?'Reader':id)
  assert.equal(facts.find(item=>item.key==='trigger').value,'Automatic')
  assert.equal(facts.find(item=>item.key==='location').label,'When')
  assert.equal(facts.find(item=>item.key==='target').value,'Reader')
  assert.deepEqual(facts.filter(item=>['context','feedback','handoff','condition'].includes(item.key)).map(item=>item.value),['Current selection','Return a draft','Approved materials','Confirmed'])
  assert.equal(facts.some(item=>item.key==='input'),false);assert.deepEqual(row,before)
})

test('portrait focus aggregates resource cards without merging canonical identities or reference evidence',()=>{
  const refs=structuredClone(bindings);refs.layout.center_presentation='portrait'
  for(const size of [1,2,24]){
    const data=sample();data.actors.a.methods=[];data.actors.a.tools=[]
    for(let i=0;i<size;i++){
      data.methods['s'+i]={name:'Same name',description:'Method '+i};data.actors.a.methods.push('s'+i)
      data.tools['t'+i]={name:'Same name',description:'Tool '+i};data.actors.a.tools.push('t'+i)
    }
    const before=structuredClone(data),view=referenceHubProjection(refs,source=>data[source],source=>source,'a')
    const lists=view.nodes.filter(node=>node.members)
    assert.equal(lists.length,2,'one connected card per declared side, independent of resource count')
    for(const list of lists){
      assert.equal(list.members.length,size)
      assert.equal(new Set(list.members.map(member=>member.id)).size,size,'equal names never merge distinct records')
      assert.ok(list.height<=268,'large resources scroll inside the bounded card')
      assert.equal(view.owners[list.id],undefined,'a synthetic group is not an editable record or its first member')
      const link=view.edges.find(edge=>edge.source===list.id||edge.target===list.id)
      assert.equal(link.referenceIds.length,size)
      for(const id of link.referenceIds)assert.ok(view.allEdges.some(edge=>edge.id===id),'all original link evidence remains reachable')
    }
    assert.equal(view.nodes.filter(node=>['left','right'].includes(node.zone)).length,2)
    assert.deepEqual(data,before,'aggregation does not rewrite facts, references or resource order')
    delete data.tools['t0']
    const removed=referenceHubProjection(refs,source=>data[source],source=>source,'a')
    assert.equal(removed.nodes.flatMap(node=>node.members??[]).some(member=>member.id===referenceNodeKey('tools','t0')),false)
    assert.ok(removed.missing.some(item=>item.id==='t0'),'missing targets stay diagnosable rather than silently removed')
    data.actors.a.methods=[];data.actors.a.tools=[]
    assert.equal(referenceHubProjection(refs,source=>data[source],source=>source,'a').nodes.some(node=>node.members),false,'empty sides do not invent cards')
  }
})
