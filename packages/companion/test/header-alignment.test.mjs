import test from 'node:test'
import assert from 'node:assert/strict'
import { alignConversationHeader } from '../src/header-alignment.mjs'

function fixture() {
  let height = 76.8, project = {}, conversation = {}, resizeCallback, mutationCallback
  const projectElement = { getBoundingClientRect: () => ({height}) }
  const conversationElement = { style: { minHeight:'', removeProperty() { this.minHeight = '' } } }
  project = projectElement; conversation = conversationElement
  const disconnected = []
  const root = { style: { setProperty(key,value) { this[key]=value }, removeProperty(key) { delete this[key] } }, querySelector: selector => selector.startsWith('.dsh-design-dock') ? project : conversation }
  const observers = {
    ResizeObserver: class { constructor(fn) { resizeCallback=fn } observe(el) { assert.equal(el,project) } disconnect() { disconnected.push('resize') } },
    MutationObserver: class { constructor(fn) { mutationCallback=fn } observe(el,options) { assert.equal(el,root); assert.equal(options.subtree,true) } disconnect() { disconnected.push('mutation') } },
  }
  return { root, observers, disconnected, conversationElement,
    resize(h) { height=h; resizeCallback() },
    replace(next) { conversation=next; mutationCallback() },
  }
}

test('shell alignment uses measured project height, follows resize and cleans up', () => {
  const f=fixture(), dispose=alignConversationHeader(f.root,f.observers)
  assert.equal(f.conversationElement.style.minHeight,'76.8px')
  assert.equal(f.root.style['--companion-top-header-height'],'76.8px')
  f.resize(112.4); assert.equal(f.conversationElement.style.minHeight,'112.4px')
  f.resize(76.8); assert.equal(f.conversationElement.style.minHeight,'76.8px')
  f.resize(0); assert.equal(f.conversationElement.style.minHeight,'76.8px')
  dispose(); assert.equal(f.conversationElement.style.minHeight,'')
  assert.equal(f.root.style['--companion-top-header-height'],undefined)
  assert.ok(f.disconnected.includes('mutation')); assert.ok(f.disconnected.includes('resize'))
})

test('replacement conversation is rebound without retaining stale geometry', () => {
  const f=fixture(), dispose=alignConversationHeader(f.root,f.observers)
  const next={style:{minHeight:'',removeProperty(){this.minHeight=''}}}
  f.replace(next)
  assert.equal(f.conversationElement.style.minHeight,'')
  assert.equal(next.style.minHeight,'76.8px')
  dispose(); assert.equal(next.style.minHeight,'')
})
