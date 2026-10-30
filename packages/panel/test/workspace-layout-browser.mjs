/** Built shared renderer geometry and real browser scrolling; no host/model or save claim. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PanelSamplePreview } from '../lib/sample-preview.js'

const run = promisify(execFile), session = `panel-layout-${process.pid}`
const browser = async (...args) => (await run('agent-browser', ['--session', session, ...args], { timeout: 45000, maxBuffer: 1e6 })).stdout
const question = component => ({ component, id: component, source: 'questions', question_policy: { numbered_rounds: true } })
const stack = child => ({ component: 'stack', id: `stack-${child.id}`, children: [child] })
const views = child => ({ component: 'tabs', id: 'views', children: [child, { ...question('question_workspace'), id: 'other', title: 'Other round view' }] })
const form = { component: 'record_form', id: 'form', source: 'questions' }
const shell = child => ({ component: 'panel_workspace', id: 'shell', slots: { sidebar: { component: 'text_block', id: 'context', text: 'Context' }, main: child } })
const variants = {
  rounds: question('question_rounds'), questions: question('question_workspace'),
  stack: stack(stack(question('question_rounds'))), tabs: views(question('question_rounds')),
  combined: stack(views(stack(question('question_rounds')))),
  guided: { ...stack(views(question('question_rounds'))), guidance: 'Read the question, then review the saved answer.' },
  mixed: { component: 'tabs', id: 'mixed', children: [form, question('question_rounds')] },
  records: { component: 'record_workspace', id: 'records', sources: ['questions'], children: [{ component: 'record_inspector', id: 'inspector' }] },
  shell: shell(question('question_rounds')), ordinary: shell(form), document: form,
}
function render(name, long) {
  const panel = { version: 1, panel_kind: 'document', sections: [{ id: 'questions', title: 'Questions' }],
    fields: [{ key: 'prompt', label: 'Question', control: 'textarea', applies_to: ['questions'] }], ui: variants[name] }
  const count = long && name !== 'records' ? 18 : 1
  const sample = { questions: Object.fromEntries(Array.from({ length: count }, (_,i) => [`q${i}`, {
    prompt: `Question ${i + 1}: ` + ('Synthetic context for reading. '.repeat(long && name === 'records' ? 250 : 1)),
    kind: 'text', answer: 'A saved answer', round: 0,
  }])) }
  // React 18 SSR escapes style text; a client mount sets textContent verbatim.
  // Decode only trusted emitted style blocks to reproduce the browser mount.
  return renderToStaticMarkup(createElement(PanelSamplePreview, { skill: 'layout-fixture', panelYaml: JSON.stringify(panel), sample, locale: 'en' }))
    .replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => '<style>' + css.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&') + '</style>')
}
const server = createServer((request, response) => {
  const params = new URL(request.url, 'http://localhost').searchParams
  const name = params.get('view') ?? 'rounds'
  if (!Object.hasOwn(variants, name)) { response.writeHead(404).end(); return }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(`<!doctype html><meta charset="utf-8"><title>Shared Panel layout</title><style>html,body{margin:0;height:100%}#host{height:100%;display:flex;flex-direction:column;min-height:0}</style><main id="host">${render(name, params.get('long') === '1')}</main>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
if (process.argv.includes('--serve')) {
  console.log(JSON.stringify({ pid: process.pid, origin }))
  await new Promise(resolve => process.once('SIGTERM', resolve))
  server.close(); process.exit(0)
}
try {
  for (const [width, height] of [[1280, 760], [620, 360]]) {
    await browser('set', 'viewport', String(width), String(height))
    for (const name of Object.keys(variants)) for (const long of [false, true]) {
      await browser('open', `${origin}/?view=${name}&long=${Number(long)}`)
      const inspect = () => browser('eval', `JSON.stringify((()=>{
        const host=document.querySelector('#host'), body=document.querySelector('.dsh-design-dock-panel-body');
        const roots=[...document.querySelectorAll('.dsh-design-workspace-surface')].filter(e=>e.getBoundingClientRect().height>0);
        const scroll=[...document.querySelectorAll('.dsh-question-workspace-content,.dsh-record-inspector,.dsh-panel-workspace-content')].find(e=>e.getBoundingClientRect().height>0)??body;
        const rect=scroll.getBoundingClientRect();
        return {height:innerHeight,width:innerWidth,body:body.getBoundingClientRect().height,root:roots[0]?.getBoundingClientRect().height,
          scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,top:scroll.scrollTop,overflow:getComputedStyle(scroll).overflowY,
          bottom:rect.bottom,docWidth:document.documentElement.scrollWidth,docTop:document.scrollingElement.scrollTop,
          minSurface:Math.min(...roots.map(e=>e.getBoundingClientRect().height))};})())`)
      const parse = text => { let value=JSON.parse(text); return typeof value === 'string' ? JSON.parse(value) : value }
      const before=parse(await inspect()), label=`${name}/${long?'long':'short'}/${width}x${height}`
      assert.ok(Math.abs(before.body-height)<2, `${label}: host fills height ${JSON.stringify(before)}`)
      if(!['document','mixed'].includes(name)) {
        assert.ok(Math.abs(before.root-height)<2, `${label}: root fills height ${JSON.stringify(before)}`)
        assert.ok(before.minSurface>0 && before.bottom<=height+2, `${label}: nested surface stays in viewport ${JSON.stringify(before)}`)
      }
      assert.ok(before.docWidth<=width+1, `${label}: horizontal overflow`)
      if(long) {
        assert.ok(before.scrollHeight>before.clientHeight+10, `${label}: long content must overflow its own region ${JSON.stringify(before)}`)
        const selector = ['document','mixed'].includes(name)?'.dsh-design-dock-panel-body':name==='ordinary'?'.dsh-panel-workspace-content':name==='records'?'.dsh-record-inspector':'.dsh-question-workspace-content'
        await browser('scroll','down','600','--selector',selector)
        const after=parse(await inspect())
        assert.ok(after.top>before.top, `${label}: real wheel reaches content`)
        assert.equal(after.docTop,0,`${label}: document must not scroll`)
      }
      console.log(`PASS ${label}`)
    }
  }
} finally { await browser('close').catch(()=>{}); await new Promise(resolve=>server.close(resolve)) }
