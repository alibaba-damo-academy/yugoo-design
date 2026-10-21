import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { useFlowContainerFit } from '../src/use-flow-container-fit.ts'

test('container fitting preserves manual views except on actual geometry changes', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  const keys = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame']
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })
  let observer, next = 0, fits = 0, disconnected = false
  const viewports = [], bounds = { current: undefined }
  const frames = new Map()
  globalThis.requestAnimationFrame = callback => { frames.set(++next, callback); return next }
  globalThis.cancelAnimationFrame = id => frames.delete(id)
  globalThis.ResizeObserver = class {
    constructor(callback) { observer = callback }
    observe() {}
    disconnect() { disconnected = true }
  }
  const flow = { fitView: async options => { assert.equal(options.maxZoom, 1); fits++; return true },
    setViewport: async viewport => { viewports.push(viewport); return true } }
  function Probe({ tick }) {
    const ref = useRef(null)
    useFlowContainerFit(ref, flow, bounds)
    return React.createElement('div', { ref }, tick)
  }
  const root = createRoot(document.getElementById('root'))
  const resize = (width, height) => observer([{ contentRect: { width, height } }])
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback() }
  try {
    await act(async () => root.render(React.createElement(Probe, { tick: 1 })))
    resize(800, 600); resize(790, 600); flush()
    assert.equal(fits, 1, 'resize events coalesce')
    await act(async () => root.render(React.createElement(Probe, { tick: 2 })))
    resize(790, 600); flush()
    assert.equal(fits, 1, 'ordinary props and same-size observations preserve manual viewport')
    resize(0, 0); resize(790, 600); flush()
    assert.equal(fits, 1, 'same-size hidden/show preserves manual viewport')
    resize(0, 0); resize(480, 320); flush()
    assert.equal(fits, 2, 'changed size while hidden fits upon showing')
    resize(1000, 600); flush()
    assert.equal(fits, 3, 'returning to wide geometry fits')
    resize(720, 600); resize(0, 0); flush()
    assert.equal(fits, 3, 'hiding cancels a queued resize fit')
    resize(720, 600); flush()
    assert.equal(fits, 4, 'showing must reschedule the cancelled same-size fit')
    resize(0, 0); resize(720, 600); flush()
    assert.equal(fits, 4, 'after fitting, same-size hide/show preserves manual viewport')
    bounds.current = { x: 0, y: 0, width: 1500, height: 900 }
    resize(480, 320); flush()
    assert.equal(fits, 4, 'a routed graph uses its full node + label bounds')
    assert.equal(viewports.length, 1)
    assert.ok(viewports[0].zoom < 1 && viewports[0].zoom > 0.15)
    assert.ok(viewports[0].x + bounds.current.width * viewports[0].zoom <= 480)
    assert.ok(viewports[0].y + bounds.current.height * viewports[0].zoom <= 320)
    resize(480, 320); resize(0, 0); resize(480, 320); flush()
    assert.equal(viewports.length, 1, 'same-size show still preserves a user viewport for routed graphs')
    bounds.current = undefined
    resize(640, 420); flush()
    assert.equal(fits, 5, 'clearing stale routed bounds after a node drag restores current-node fitView')
    assert.equal(viewports.length, 1, 'stale layout bounds are not reused')
    resize(900, 600)
    await act(async () => root.unmount())
    flush()
    assert.equal(fits, 5, 'unmount cancels pending fit')
    assert.equal(viewports.length, 1, 'unmount cancels a queued bounds-aware fit too')
    assert.equal(disconnected, true)
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
