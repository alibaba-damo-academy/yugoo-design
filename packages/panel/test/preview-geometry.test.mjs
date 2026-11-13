import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { previewGeometryMarkup, previewGeometryReport } from '../src/preview-geometry.ts'

// Executes the real injected script with controlled geometry. This tests the
// diagnostics boundary; it does not claim browser layout/visual acceptance.
function preview(body, regions = ['submit', 'success']) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, reports = [], frames = new Map(), boxes = new Map()
  let id = 0, resize, disconnected = false
  w.requestAnimationFrame = callback => { frames.set(++id, callback); return id }
  w.cancelAnimationFrame = handle => frames.delete(handle)
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30 }
  const measure = element => boxes.get(element.getAttribute('data-prototype-id')) ?? rect
  w.HTMLElement.prototype.getBoundingClientRect = function () { return measure(this) }
  w.HTMLElement.prototype.getClientRects = function () { return [measure(this)] }
  w.Range.prototype.getClientRects = () => [rect]
  w.ResizeObserver = class {
    constructor(callback) { resize = callback }
    observe() {} unobserve() {} disconnect() { disconnected = true }
  }
  w.postMessage = value => reports.push(structuredClone(value))
  const markup = previewGeometryMarkup('current-preview', regions)
  w.eval(markup.slice('<script>'.length, -'</script>'.length))
  const flush = async () => {
    await Promise.resolve()
    // Double RAF plus a possible load/mutation callback, without a timer loop.
    for (let n = 0; frames.size && n < 8; n++) {
      const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback())
      await Promise.resolve()
    }
    assert.equal(frames.size, 0, 'measurement must settle without perpetual frames')
  }
  return { w, reports, boxes, flush, resize: () => resize(), frames,
    latest: () => reports.at(-1)?.issues,
    close: () => { w.dispatchEvent(new w.Event('pagehide')); assert.ok(disconnected); dom.window.close() } }
}

const form = '<p>Complete the request</p><button data-prototype-id="submit">Submit</button><section id="result" hidden><a data-prototype-id="success">View request</a></section>'

test('conditional hidden triggers are skipped, current-state issues are refreshed and duplicate reports are suppressed', async () => {
  const p = preview(form)
  try {
    await p.flush(); assert.deepEqual(p.latest(), [])
    const count = p.reports.length
    p.resize(); p.resize(); await p.flush(); assert.equal(p.reports.length, count)
    p.boxes.set('success', { width: 0, height: 0 })
    p.w.document.getElementById('result').hidden = false
    await p.flush(); assert.deepEqual(p.latest(), ['region-invisible:success'])
    p.boxes.delete('success'); p.resize(); await p.flush()
    assert.deepEqual(p.latest(), [], 'a corrected visible result clears the previous warning')
    p.boxes.set('success', { width: 0, height: 0 })
    p.w.document.getElementById('result').className = 'returned-to-form'
    p.w.document.getElementById('result').style.display = 'none'
    await p.flush(); assert.deepEqual(p.latest(), [])
    p.w.document.querySelector('[data-prototype-id="submit"]').remove()
    await p.flush(); assert.deepEqual(p.latest(), ['region-missing:submit'], 'missing bindings still fail')
  } finally { p.close() }
})

test('hidden ancestors and closed details are conditional, but visible zero-size targets are errors', async () => {
  for (const attributes of ['hidden', 'style="display:none"', 'style="visibility:hidden"', 'style="opacity:0"']) {
    const p = preview(`<p>Content</p><section ${attributes}><button data-prototype-id="success">Next</button></section>`, ['success'])
    try { p.boxes.set('success', { width: 0, height: 0 }); await p.flush(); assert.deepEqual(p.latest(), []) }
    finally { p.close() }
  }
  const p = preview('<p>Content</p><details><summary>More</summary><button data-prototype-id="success">Next</button></details>', ['success'])
  try {
    p.boxes.set('success', { width: 0, height: 0 }); await p.flush(); assert.deepEqual(p.latest(), [])
    p.w.document.querySelector('details').open = true; await p.flush()
    assert.deepEqual(p.latest(), ['region-invisible:success'])
  } finally { p.close() }
})

test('body, document root and horizontal overflow diagnostics remain meaningful negative checks', async () => {
  const p = preview('<p>Content</p>', ['missing'])
  try {
    Object.defineProperty(p.w.document.documentElement, 'clientWidth', { configurable: true, value: 320 })
    Object.defineProperty(p.w.document.documentElement, 'scrollWidth', { configurable: true, value: 600 })
    await p.flush(); assert.deepEqual(p.latest(), ['region-missing:missing', 'horizontal-overflow:600'])
    p.w.document.body.replaceChildren(); await p.flush()
    assert.ok(p.latest().includes('body-empty'))
    p.w.document.body.remove(); await p.flush()
    assert.ok(p.latest().some(issue => issue.startsWith('document-root:')))
  } finally { p.close() }
})

test('page teardown disconnects observation and cancels pending measurements', async () => {
  const p = preview(form)
  await p.flush(); const count = p.reports.length
  p.w.document.getElementById('result').hidden = false
  await Promise.resolve(); assert.ok(p.frames.size)
  p.w.dispatchEvent(new p.w.Event('pagehide')); assert.equal(p.frames.size, 0)
  p.resize(); await p.flush(); assert.equal(p.reports.length, count)
  p.close()
})

test('script configuration preserves literal ids and message validation fences the preview channel', async () => {
  const channel = '</script><script>unexpected()</script>'
  const markup = previewGeometryMarkup(channel, ['<a>'])
  assert.equal(markup.match(/<script>/g).length, 1)
  assert.equal(markup.match(/<\/script>/g).length, 1)
  const valid = { type: 'design-preview:geometry', channel, issues: ['region-missing:<a>'] }
  assert.deepEqual(previewGeometryReport(valid, channel), valid.issues)
  assert.equal(previewGeometryReport(valid, 'other'), undefined)
  assert.equal(previewGeometryReport({ ...valid, extra: true }, channel), undefined)
})
