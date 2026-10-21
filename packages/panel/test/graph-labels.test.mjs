import test from 'node:test'
import assert from 'node:assert/strict'
import {wrapLabel,placeLabels,intersects,orientToViewport} from './graph-labels.mjs'

test('wrap Unicode labels within measured width, explicitly ellipsize long content',()=>{
  const measure=s=>[...s].length*10
  assert.deepEqual(wrapLabel('甲乙丙丁',measure,20,3),['甲乙','丙丁'])
  const lines=wrapLabel('甲乙丙丁戊己庚😀辛',measure,30,2)
  assert.equal(lines.length,2);assert.ok(lines.at(-1).endsWith('…'))
  assert.ok(lines.every(s=>measure(s)<=30))
})
test('labels avoid other labels, node circles and viewport edges',()=>{
  const items=[{id:'a',x:100,y:100,w:90,h:25},{id:'b',x:110,y:105,w:90,h:25}]
  const obstacles=[{x:90,y:90,w:30,h:30}]
  const {placed,hidden}=placeLabels(items,obstacles,300,200)
  assert.equal(hidden.length,0)
  assert.ok(!intersects(placed[0].box,placed[1].box))
  assert.ok(placed.every(p=>!intersects(p.box,obstacles[0])))
  assert.ok(placed.every(({box:b})=>b.x>=8&&b.y>=8&&b.x+b.w<=292&&b.y+b.h<=192))
})
test('impossible labels report hidden rather than overlapping silently',()=>{
  assert.deepEqual(placeLabels([{id:'a',x:5,y:5,w:500,h:200}],[],100,100).hidden,['a'])
})
test('quarter-turn preserves distances and does not mutate original coordinates',()=>{
  const p=new Map([['a',{x:0,y:0}],['b',{x:20,y:300}]])
  const result=orientToViewport(p,800,400)
  assert.deepEqual(result.get('b'),{x:-300,y:20})
  assert.deepEqual(p.get('b'),{x:20,y:300})
  assert.equal(Math.hypot(result.get('b').x,result.get('b').y),Math.hypot(20,300))
})
