import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
const { register } = await import('tsx/esm/api')
register()
const { readHostDockGeometry, observeHostDockGeometry } = await import('../src/client/host-dock-geometry.ts')

function fixture() {
  const dom = new JSDOM(`<div id="frame" style="padding-top:40px"><main data-slot="conversation">
    <div data-slot="conversation.header" style="display:contents"><header><div data-slot="conversation.session.header" style="display:contents"><div id="inner">Title</div></div></header></div>
    <div id="messages"></div></main><div data-shell-overlay></div></div>`, { pretendToBeVisual:true })
  const document = dom.window.document, frame = document.getElementById('frame')
  const overlay = document.querySelector('[data-shell-overlay]'), header = document.querySelector('header')
  const state = { frameTop:120, overlayTop:120, top:160, height:51, overlayBorder:0, frameBorder:0, scroll:0 }
  const rect = (top, height, width=800) => ({x:0,y:top,top,left:0,right:width,bottom:top+height,width,height})
  frame.getBoundingClientRect=()=>rect(state.frameTop,700)
  overlay.getBoundingClientRect=()=>rect(state.overlayTop,700)
  header.getBoundingClientRect=()=>rect(state.top,state.height)
  document.getElementById('inner').getBoundingClientRect=()=>rect(state.top+10,30)
  Object.defineProperty(frame,'clientTop',{get:()=>state.frameBorder})
  Object.defineProperty(overlay,'clientTop',{get:()=>state.overlayBorder})
  Object.defineProperty(overlay,'clientHeight',{get:()=>700-2*state.overlayBorder})
  Object.defineProperty(overlay,'scrollTop',{get:()=>state.scroll})
  return { dom,document,frame,overlay,header,state,rect }
}

test('outer resident header owns both edges; Desktop caption is not a fixed viewport offset',()=>{
  const f=fixture()
  assert.deepEqual(readHostDockGeometry(f.document),{top:40,headerHeight:51})
  f.state.height=76;assert.deepEqual(readHostDockGeometry(f.document),{top:40,headerHeight:76})
  f.state.top=177.25;assert.deepEqual(readHostDockGeometry(f.document),{top:57.25,headerHeight:76})
  f.state.overlayBorder=2;f.state.scroll=3
  assert.deepEqual(readHostDockGeometry(f.document),{top:58.25,headerHeight:76})
  f.dom.window.close()
})

test('Web/fullscreen has no caption gap; hidden old headers are not alignment owners',()=>{
  const f=fixture()
  f.state.frameTop=0;f.state.overlayTop=0;f.state.top=0
  const old=f.document.createElement('div');old.dataset.slot='conversation.header'
  old.innerHTML='<header>Hidden old session</header>'
  old.firstElementChild.getBoundingClientRect=()=>f.rect(0,100,0)
  f.frame.prepend(old)
  assert.deepEqual(readHostDockGeometry(f.document),{top:0,headerHeight:51})
  f.dom.window.close()
})

test('zero-height/sessionless and absent headers preserve independently derived safe top',()=>{
  const f=fixture()
  f.state.height=0
  assert.deepEqual(readHostDockGeometry(f.document),{top:40,headerHeight:64})
  f.header.remove();f.frame.style.paddingTop='37.25px';f.state.frameBorder=3;f.state.overlayBorder=1
  assert.deepEqual(readHostDockGeometry(f.document),{top:39.25,headerHeight:64})
  f.overlay.remove();assert.deepEqual(readHostDockGeometry(f.document),{top:0,headerHeight:64})
  f.dom.window.close()
})

test('geometry clamps top and retains a readable two-line minimum without inventing an equal-height Host bar',()=>{
  const f=fixture()
  f.state.top=100;f.state.height=20
  assert.deepEqual(readHostDockGeometry(f.document),{top:0,headerHeight:48})
  f.state.top=2000
  assert.equal(readHostDockGeometry(f.document).top,700)
  f.dom.window.close()
})

test('observer coalesces geometry, rebinds header/frame, ignores message streaming and disposes pending work',async()=>{
  const f=fixture(),view=f.dom.window,frames=new Map(),ros=[]
  let sequence=0,requests=0
  view.requestAnimationFrame=callback=>{requests++;frames.set(++sequence,callback);return sequence}
  view.cancelAnimationFrame=id=>frames.delete(id)
  view.ResizeObserver=class {
    observed=new Set()
    constructor(callback){this.callback=callback;ros.push(this)}
    observe(element){this.observed.add(element)}
    disconnect(){this.observed.clear()}
  }
  const values=[],release=observeHostDockGeometry(f.document,value=>values.push(value))
  const flush=()=>{for(const [id,callback] of [...frames]){frames.delete(id);callback()}}
  const mutations=()=>new Promise(resolve=>setImmediate(resolve))
  assert.deepEqual(values,[{top:40,headerHeight:51}])
  assert(ros[0].observed.has(f.header));assert(!ros[0].observed.has(f.document.getElementById('inner')))
  f.state.height=76
  ros[0].callback();ros[0].callback();view.dispatchEvent(new view.Event('resize'))
  assert.equal(frames.size,1);flush();assert.equal(values.at(-1).headerHeight,76)
  ros[0].callback();flush();assert.equal(values.length,2,'unchanged geometry must not notify React')
  const before=requests
  f.document.getElementById('messages').append(f.document.createElement('p'))
  await mutations();assert.equal(requests,before,'ordinary streamed message elements must not schedule geometry')
  const replacement=f.document.createElement('header')
  replacement.getBoundingClientRect=()=>f.rect(160,51)
  f.header.replaceWith(replacement);await mutations();flush()
  assert.equal(values.at(-1).headerHeight,51);assert(ros[0].observed.has(replacement));assert(!ros[0].observed.has(f.header))
  f.frame.remove();await mutations();flush();assert.deepEqual(values.at(-1),{top:0,headerHeight:64})
  f.document.body.append(f.frame);await mutations();flush();assert.deepEqual(values.at(-1),{top:40,headerHeight:51})
  view.document.documentElement.setAttribute('data-fullscreen','');await mutations()
  assert.equal(frames.size,1);release();assert.equal(frames.size,0);assert.equal(ros[0].observed.size,0)
  const count=values.length
  view.dispatchEvent(new view.Event('resize'));f.frame.append(f.document.createElement('span'));await mutations();flush()
  assert.equal(values.length,count);assert.equal(frames.size,0)
  view.close()
})
