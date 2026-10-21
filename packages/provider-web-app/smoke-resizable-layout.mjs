#!/usr/bin/env node
/**
 * Runtime regression for the shared native-panel splitter: the primitive owns
 * registration and a resized auto-saved layout survives unmount/remount.
 * Run from the repository root:
 *   node --conditions=browser --import tsx packages/provider-web-app/smoke-resizable-layout.mjs
 * The browser condition selects the same resizable-panel implementation as the
 * client build; the package's default Node entry disables layout registration.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React, { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
})
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
})
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  AbortController: dom.window.AbortController,
  AbortSignal: dom.window.AbortSignal,
  localStorage: dom.window.localStorage,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  MutationObserver: dom.window.MutationObserver,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
})

const {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} = await import('./src/client/ported/ui/resizable.tsx')

const wrapperSource = await readFile(new URL('./src/client/ported/ui/resizable.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(wrapperSource, /\.(?:getLayout|setLayout)\(/, 'the wrapper must not race primitive panel registration')

const autoSaveId = 'dsh-design-smoke-resizable-layout'
const firstPanelRef = createRef()
let latestLayout = []

function splitter(panelRef) {
  return React.createElement(
    ResizablePanelGroup,
    {
      autoSaveId,
      direction: 'horizontal',
      onLayout: (layout) => { latestLayout = layout },
    },
    React.createElement(ResizablePanel, {
      id: 'navigation',
      order: 1,
      ref: panelRef,
      defaultSize: 25,
      minSize: 10,
    }, 'navigation'),
    React.createElement(ResizableHandle, { id: 'handle' }),
    React.createElement(ResizablePanel, {
      id: 'content',
      order: 2,
      defaultSize: 75,
      minSize: 10,
    }, 'content'),
  )
}

let container = document.getElementById('root')
assert.ok(container)
let root = createRoot(container)
await act(async () => { root.render(splitter(firstPanelRef)) })
await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
assert.deepEqual(latestLayout, [25, 75])

await act(async () => { firstPanelRef.current.resize(40) })
assert.deepEqual(latestLayout, [40, 60])
await new Promise(resolve => setTimeout(resolve, 150))

await act(async () => { root.unmount() })
container.remove()
container = document.createElement('div')
document.body.append(container)
root = createRoot(container)
latestLayout = []
await act(async () => { root.render(splitter(createRef())) })
await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
assert.deepEqual(latestLayout, [40, 60])

await act(async () => { root.unmount() })
dom.window.close()
console.log('RESIZABLE LAYOUT RESTORE OK')
