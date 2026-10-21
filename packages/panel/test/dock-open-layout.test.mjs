import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

// Exercise the actual client functions, store and reflow effect without loading
// the unrelated React/renderer graph or requiring a previously built lib.
const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function clientFunction(name) {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(node, `client function ${name} must exist`)
  return node.getText(ast)
}
let reflow
function findReflow(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ctx.effect'
    && node.arguments[1]?.text === 'design panel: Host layout reflow') reflow = node.arguments[0].getText(ast)
  ts.forEachChild(node, findReflow)
}
findReflow(ast)
assert.ok(reflow, 'the installed Host reflow effect must exist')
const layoutStart = source.indexOf('let layout:')
const layoutEnd = source.indexOf('/**\n * Mount the shared native-renderer', layoutStart)
assert.ok(layoutStart >= 0 && layoutEnd > layoutStart)
const modules = await Promise.all(['dock-layout.ts', 'dock-session-state.ts'].map(name =>
  readFile(new URL(`../src/client/${name}`, import.meta.url), 'utf8')))
const code = ts.transpileModule([
  ...modules.map(text => text.replace(/^export /gm, '')),
  clientFunction('frameElement'), clientFunction('clampDockWidth'), source.slice(layoutStart, layoutEnd),
  `({ rail, activateDesignDockSession, currentDockSession, setRailWidth, openDesignDock, closeDesignDock,
    installLayout(value) { layout = value }, installClamp() { setDockWidthClamp(clampDockWidth) },
    mountReflow: ${reflow} })`,
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText

function fixture({ viewport = 1536, navigation = 280, collapsed = false, toggle = 'async' } = {}) {
  const state = { navigation, toggles: 0 }
  const mutations = new Set(), resizes = new Set(), frames = new Map(), listeners = new Map()
  let sequence = 0
  const frame = { dataset: collapsed ? { sidebarCollapsed: 'true' } : {}, firstElementChild: {
    getBoundingClientRect: () => ({ width: state.navigation }),
  } }
  class MutationObserver {
    constructor(callback) { this.callback = callback }
    observe() { mutations.add(this) }
    disconnect() { mutations.delete(this) }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback }
    observe() { resizes.add(this) }
    disconnect() { resizes.delete(this) }
  }
  const window = {
    innerWidth: viewport,
    requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence },
    cancelAnimationFrame(id) { frames.delete(id) },
    addEventListener(name, callback) { listeners.set(name, callback) },
    removeEventListener(name) { listeners.delete(name) },
  }
  const document = { querySelector: () => ({ parentElement: state.frame ?? frame }) }
  const client = runInNewContext(code, { window, document, MutationObserver, ResizeObserver })
  if (toggle !== 'missing') client.installLayout({ toggleSidebar() {
    state.toggles++
    if (toggle === 'throw') throw new Error('unwired Host layout')
    // Like the Host's React update, the default toggle returns before the DOM
    // commits. The attribute may then commit before its CSS width transition.
  } })
  client.installClamp()
  client.activateDesignDockSession('a')
  const release = client.mountReflow()
  const flush = () => {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback() }
  }
  const commit = (collapsed, navigation = state.navigation, count = 1) => {
    state.navigation = navigation
    if (collapsed) frame.dataset.sidebarCollapsed = 'true'
    else delete frame.dataset.sidebarCollapsed
    for (const observer of [...mutations]) observer.callback(Array.from({ length: count }, () => ({ type: 'attributes', target: frame })))
  }
  const resize = navigation => {
    state.navigation = navigation
    for (const observer of [...resizes]) observer.callback()
    flush()
  }
  return { ...client, state, frame, window, frames, flush, commit, resize, release }
}

test('opening retains 70/30 across delayed Host commit and animated navigation collapse', () => {
  const f = fixture()
  f.openDesignDock('a')
  assert.equal(f.state.toggles, 1)
  assert.equal(f.rail.getSnapshot().width, 1036, 'old 280px navigation must not destroy the initial target')
  f.flush() // A reflow may arrive even before React commits the collapse.
  assert.equal(f.rail.getSnapshot().width, 1036)
  f.commit(true, 280)
  f.flush()
  f.resize(200) // Attribute committed, but CSS transition is still running.
  assert.equal(f.rail.getSnapshot().width, 1036)
  f.resize(56)
  assert.equal(f.rail.getSnapshot().width / (1536 - 56), 0.7)
  assert.equal(f.frames.size, 0, 'settled geometry must not poll or schedule itself')
  f.release()
})

test('drag during the opening transition and later Design focus retain the user width', () => {
  const f = fixture()
  f.openDesignDock('a')
  f.setRailWidth(640)
  f.commit(true, 200)
  f.flush()
  f.resize(56)
  f.openDesignDock('a', { focus: { skill: 'research', nonce: 1 } })
  f.flush()
  assert.equal(f.rail.getSnapshot().width, 640)
  assert.equal(f.rail.getSnapshot().focus.skill, 'research')
  assert.equal(f.state.toggles, 1, 'activity in an open dock must not toggle navigation again')
  f.release()
})

test('later Host/user navigation changes use measured limits and never reapply 70/30', () => {
  const f = fixture()
  f.openDesignDock('a')
  f.commit(true, 56)
  f.setRailWidth(2000)
  assert.equal(f.rail.getSnapshot().width, 1120, 'drag still preserves the 360px conversation minimum')
  // A synchronous drag can precede the MutationObserver delivery too.
  delete f.frame.dataset.sidebarCollapsed
  f.state.navigation = 280
  f.setRailWidth(2000)
  assert.equal(f.rail.getSnapshot().width, 896)
  f.commit(false, 56) // User reopens navigation; the opening lease is superseded.
  f.resize(280)
  assert.equal(f.rail.getSnapshot().width, 896)
  f.commit(true, 56)
  f.flush()
  assert.equal(f.rail.getSnapshot().width, 896, 'a later collapse must not restore the opening target')
  f.closeDesignDock('a')
  assert.equal(f.state.toggles, 1, 'close cannot restore navigation after the user took ownership')
  f.release()
})

test('collapse ownership cannot change a replacement frame or outlive dock close', () => {
  const f = fixture()
  f.openDesignDock('a')
  f.commit(true, 56)
  f.state.frame = { dataset: {}, firstElementChild: { getBoundingClientRect: () => ({ width: 280 }) } }
  f.setRailWidth(2000)
  assert.equal(f.rail.getSnapshot().width, 896, 'a lease belongs only to its original frame')
  delete f.state.frame
  f.closeDesignDock('a')
  f.commit(false, 280)
  f.setRailWidth(2000)
  assert.equal(f.rail.getSnapshot().width, 896, 'released ownership uses rendered navigation')
  f.release()
})

test('session switches, stale opens and close cannot apply a delayed opening reset', () => {
  const f = fixture()
  f.openDesignDock('a')
  f.activateDesignDockSession('b')
  assert.equal(f.rail.getSnapshot().open, false)
  f.setRailWidth(500)
  f.commit(true, 56)
  f.flush()
  f.openDesignDock('a')
  assert.equal(f.rail.getSnapshot().open, false, 'stale activity cannot reopen another session')
  assert.equal(f.rail.getSnapshot().width, 500)
  f.activateDesignDockSession('a')
  f.flush()
  assert.equal(f.rail.getSnapshot().open, true)
  assert.equal(f.rail.getSnapshot().width, 500, 'session restoration keeps the page-global user width')
  f.closeDesignDock('a')
  f.commit(false, 280)
  f.flush()
  assert.equal(f.rail.getSnapshot().open, false)
  assert.equal(f.rail.getSnapshot().width, 500)
  assert.equal(f.state.toggles, 2, 'close restores only the navigation collapsed by this opening')
  f.release()
  assert.equal(f.frames.size, 0)
})

test('missing/throwing collapse capability and already collapsed Host use real geometry', () => {
  for (const options of [{ toggle: 'missing' }, { toggle: 'throw' }, { collapsed: true, navigation: 200 }]) {
    const f = fixture(options)
    f.openDesignDock('a')
    const expected = options.collapsed ? 935 : 879
    assert.equal(f.rail.getSnapshot().width, expected)
    f.setRailWidth(2000)
    assert.equal(f.rail.getSnapshot().width, 1536 - f.state.navigation - 360)
    f.closeDesignDock('a')
    assert.equal(f.state.toggles, options.toggle === 'throw' ? 1 : 0, 'failed/unowned collapse must not be restored')
    f.release()
  }
})

test('small viewports retain dock/conversation minima and disposal cancels queued reflow', () => {
  const f = fixture({ viewport: 700 })
  f.openDesignDock('a')
  f.commit(true, 56)
  f.flush()
  assert.equal(f.rail.getSnapshot().width, 320)
  f.setRailWidth(800)
  assert.equal(f.rail.getSnapshot().width, 320)
  f.window.innerWidth = 1536
  f.resize(56)
  assert.equal(f.rail.getSnapshot().width, 320, 'viewport growth is not a new opening')
  f.setRailWidth(600)
  assert.equal(f.frames.size, 1)
  f.release()
  assert.equal(f.frames.size, 0)
})

// A real DOM/MutationObserver is necessary here: installing an observer with no
// Host frame must not silently omit the later navigation subscription.
function mountedFixture() {
  const dom = new JSDOM('<div id="messages"></div>', { pretendToBeVisual: true })
  const { window } = dom, { document } = window
  const frames = new Map(), observers = []
  let sequence = 0
  window.innerWidth = 1536
  window.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence }
  window.cancelAnimationFrame = id => frames.delete(id)
  class ResizeObserver {
    observed = new Set()
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(element) { this.observed.add(element) }
    disconnect() { this.observed.clear() }
  }
  const client = runInNewContext(code, {
    window, document, MutationObserver: window.MutationObserver, ResizeObserver, Element: window.Element,
  })
  client.installClamp()
  client.activateDesignDockSession('a')
  const release = client.mountReflow()
  const flush = async () => {
    await new Promise(resolve => setImmediate(resolve))
    for (const [id, callback] of [...frames]) { frames.delete(id); callback() }
  }
  const mount = (width = 56) => {
    const frame = document.createElement('div')
    frame.innerHTML = '<nav></nav><main></main><div data-shell-overlay></div>'
    frame.dataset.sidebarCollapsed = 'true'
    const state = { width }
    frame.firstElementChild.getBoundingClientRect = () => ({ width: state.width })
    document.body.append(frame)
    return { frame, state }
  }
  return { ...client, window, document, frames, observers, mount, flush, release, dispose: () => { release(); window.close() } }
}

test('Host navigation mounted after the reflow effect still constrains a dragged dock on expand', async () => {
  const f = mountedFixture()
  try {
    await f.flush() // Effect starts before shell.overlay/frame exist.
    const { frame, state } = f.mount()
    await f.flush()
    f.openDesignDock('a')
    f.setRailWidth(956)
    await f.flush()
    delete frame.dataset.sidebarCollapsed
    state.width = 280
    await f.flush()
    assert.equal(f.rail.getSnapshot().width, 896, 'late-mounted navigation must preserve the 360px conversation minimum')
    assert.ok(f.observers.some(observer => observer.observed.has(frame.firstElementChild)))
  } finally { f.dispose() }
})

test('Host frame/navigation replacement rebinds observations; streaming and disposal schedule no reflow', async () => {
  const f = mountedFixture()
  try {
    const first = f.mount()
    await f.flush()
    f.openDesignDock('a')
    f.setRailWidth(956)
    await f.flush()
    first.frame.remove()
    const next = f.mount()
    await f.flush()
    assert.ok(f.observers.some(observer => observer.observed.has(next.frame.firstElementChild)), 'new frame navigation must be observed')
    assert.ok(f.observers.every(observer => !observer.observed.has(first.frame.firstElementChild)))
    const oldNavigation = next.frame.firstElementChild
    const newNavigation = f.document.createElement('nav')
    newNavigation.getBoundingClientRect = () => ({ width: 280 })
    oldNavigation.replaceWith(newNavigation)
    delete next.frame.dataset.sidebarCollapsed
    await f.flush()
    assert.equal(f.rail.getSnapshot().width, 896)
    assert.ok(f.observers.some(observer => observer.observed.has(newNavigation)))
    assert.ok(f.observers.every(observer => !observer.observed.has(oldNavigation)))
    await f.flush() // Settle the existing rail notification after its width clamp.
    assert.equal(f.frames.size, 0)
    next.frame.querySelector('main').append(f.document.createElement('p'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.frames.size, 0, 'ordinary streamed content is not a layout-anchor change')
    next.frame.remove()
    await f.flush()
    assert.ok(f.observers.every(observer => observer.observed.size === 0), 'detached geometry must not remain observed')
    f.release()
    f.mount(280)
    f.window.dispatchEvent(new f.window.Event('resize'))
    await f.flush()
    assert.equal(f.frames.size, 0)
    assert.ok(f.observers.every(observer => observer.observed.size === 0))
  } finally { f.dispose() }
})
