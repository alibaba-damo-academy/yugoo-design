import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const css=await readFile(new URL('../src/visual-components.css',import.meta.url),'utf8')
const nativeButton=await readFile(new URL('../../provider-web-app/src/client/ported/ui/button.tsx',import.meta.url),'utf8')
const nativeFlow=await readFile(new URL('../../provider-web-app/src/client/ported/design/FlowDesignPanel/FlowDesignPanel.tsx',import.meta.url),'utf8')
const nativeCss=await readFile(new URL('../../provider-web-app/src/client/generated/design.tw.css',import.meta.url),'utf8')
// Read the real native size utilities; no second hard-coded dimension baseline.
const small=/sm: '([^']+)'/.exec(nativeButton)[1].split(' ')
const escapeClass=value=>value.replace(/[^a-zA-Z0-9_-]/g,char=>'\\'+char)
const nativeSizeCss=small.map(name=>{
  const selector='.'+escapeClass(name)+'{',start=nativeCss.indexOf(selector)
  assert.ok(start>=0,`Native utility ${name} is shipped`)
  return nativeCss.slice(start,nativeCss.indexOf('}',start)+1)
}).join('\n')
const buttonRules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(match=>match[1].includes('.dsh-design-record-header.is-detail > button'))
  .map(match=>match[0]).join('\n')

test('page actions use the shared header height while canvas tools retain native outline/sm geometry',()=>{
  assert.equal((nativeFlow.match(/variant='outline'\s+size='sm'/g)??[]).length,2)
  const dom=new JSDOM(`<style>${nativeSizeCss}\n${css}</style><div class="dsh-design-panel"><header class="dsh-design-record-header is-detail dsh-diagram-heading"><button id="details">Details</button><button id="edit">Edit diagram</button></header><div class="dsh-bpmn-toolbar"><button id="fit">Fit all</button></div></div><button id="native" class="${small.join(' ')}">Native</button><button id="foreign">Host button</button>`)
  try {
    const native=dom.window.getComputedStyle(dom.window.document.getElementById('native'))
    for(const id of ['details','edit','fit']) {
      const style=dom.window.getComputedStyle(dom.window.document.getElementById(id))
      for(const property of ['paddingTop','paddingRight','paddingBottom','paddingLeft','fontSize','lineHeight'])
        assert.equal(style[property],native[property],`${id} retains native ${property}`)
      assert.equal(style.height,'var(--ygd-panel-action-height, 1.75rem)', 'the shared action rule keeps the native canvas fallback')
      assert.equal(style.boxSizing,'border-box')
      assert.equal(style.display,'inline-flex')
      assert.equal(style.boxShadow,'none')
    }
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('header')).getPropertyValue('--ygd-panel-action-height'),'32px', 'page headers own the 32px action context')
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('.dsh-bpmn-toolbar')).getPropertyValue('--ygd-panel-action-height'),'', 'the canvas does not inherit a page header context')
    assert.notEqual(dom.window.getComputedStyle(dom.window.document.getElementById('foreign')).height,native.height,'Host button does not receive Panel action dimensions')
  } finally { dom.window.close() }
})

test('outline states retain native theme tokens, keyboard focus and disabled isolation',()=>{
  assert.match(nativeButton,/outline:[\s\S]*?border-\[var\(--ds-fill-6\)\][\s\S]*?hover:bg-\[var\(--ds-bg-white-hover\)\]/)
  const dom=new JSDOM(`<style>${buttonRules}</style>`)
  try {
    const rules=[...dom.window.document.styleSheets[0].cssRules]
    const rule=part=>rules.find(item=>item.selectorText.includes(part)).style
    assert.match(rule(' > button,').borderRadius,/--button-radius/)
    assert.match(rule(' > button,').border,/--ds-fill-6/)
    assert.match(rule(':hover:not(:disabled)').backgroundColor,/--ds-bg-white-hover/)
    assert.match(rule(':active:not(:disabled)').backgroundColor,/--active/)
    assert.match(rule(':focus-visible').outline,/2px solid var\(--ds-brand-6/)
    const disabled=rule(':disabled,')
    assert.match(disabled.borderColor,/--ds-divider-default/)
    assert.match(disabled.color,/--ds-text-disabled/)
    assert.equal(disabled.cursor,'not-allowed')
    assert.equal(disabled.opacity,'1','Disabled theme text is not faded a second time')
  } finally { dom.window.close() }
})
