/** Actual normal CJS artifact and React18 module table; Host services are explicit fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const panelRequire = createRequire(new URL('../../panel/package.json', import.meta.url))
const { JSDOM } = panelRequire('jsdom')

async function loadClient(browser = {}) {
  const require = createRequire(new URL('../package.json', import.meta.url))
  const modules = new Map(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].map(name => [name, require(name)]))
  const loads = []
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const context = { ...browser, window: { __ModuleLoader__: { load: value => loads.push(value) } } }
  vm.runInNewContext(code, context, { timeout: 2000 })
  assert.equal(loads.length, 1); assert.equal(loads[0].id, 'dsh-design-studio-dsh')
  const requested = []
  const client = loads[0].factory(name => { requested.push(name); assert.ok(modules.has(name), 'unexpected native module-table dependency: ' + name); return modules.get(name) })
  return { client, requested, context }
}

test('normal native client registers Settings without adding a conversation-header entry or acquiring a Session', async () => {
  const dom = new JSDOM('')
  const { client, requested } = await loadClient({ document: dom.window.document })
  assert.deepEqual([...client.inject], ['slots', 'locale'])
  const registrations = [], effects = [], removed = []
  const localeSnapshot = { active: 'en', revision: 0 }
  const runtime = {
    effect(install) { effects.push({ dispose: install() }) },
    slots: {
      inject(name, install) { effects.push({ name, dispose: install() }) },
      register(spec, component) { registrations.push({ spec, component }); return () => removed.push(spec.id) },
    },
    locale: { getSnapshot: () => localeSnapshot, subscribe: () => () => {} },
    get uiSession() { assert.fail('Settings registration must not inspect the current Session') },
    get sessions() { assert.fail('Settings registration must not acquire a Session') },
  }
  await client.apply(runtime)
  assert.deepEqual(registrations.map(({ spec }) => spec.name), ['settings.section'])
  assert.deepEqual(registrations.map(({ spec }) => spec.id), ['design-studio'])
  assert.equal(registrations.every(entry => typeof entry.component === 'function'), true)
  for (const effect of effects) effect.dispose()
  assert.deepEqual(removed, ['design-studio'])
  assert.ok(requested.includes('react'))
  dom.window.close()
})

test('Desktop native chat links reach the same app window before the Host HTTP opener; unload restores Host handling', async () => {
  const dom = new JSDOM('<a id="studio"><span>Open Studio</span></a>', { url: 'dsh-app://app/' })
  const navigations = [], openedByHost = [], disposers = []
  const location = { href: 'dsh-app://app/', assign: value => navigations.push(value) }
  const { client, context } = await loadClient({ document: dom.window.document, location, URL,
    __DSH_TRANSPORT__: { streamBaseUrl: 'http://127.0.0.1:51454/' } })
  await client.apply({ effect: install => disposers.push(install()),
    slots: { inject() {} }, locale: { getSnapshot: () => ({ active: 'en' }) } })
  const anchor = dom.window.document.querySelector('a')
  const hostOpener = event => { openedByHost.push(anchor.href); event.preventDefault() }
  dom.window.document.addEventListener('click', hostOpener)
  const click = options => anchor.firstChild.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }))
  const path = '/design-studio/?agentId=session-67429468-112d-40b0-98af-000961b9a99e&presentation=full&studioTarget=%7B%22id%22%3A%22bundle-one%22%2C%22expectedRevision%22%3A2%7D&studioRequest=request-1&studioDigest=' + 'a'.repeat(64) + '#source'
  anchor.href = 'http://127.0.0.1:51454' + path
  assert.equal(click(), false)
  assert.deepEqual(navigations, [path], 'preserve the exact Session, target, receipt, encoding and fragment')
  assert.deepEqual(openedByHost, [], 'capture must precede the Host Markdown React bubble opener')
  anchor.href = 'http://127.0.0.1:51455' + path
  click()
  assert.equal(navigations.length, 1, 'a second instance with the same agentId is not this instance')
  assert.equal(openedByHost.length, 1)
  context.__DSH_TRANSPORT__.streamBaseUrl = 'http://127.0.0.1:51455/'
  click()
  assert.deepEqual(navigations, [path, path], 'read the public current origin at click time')
  for (const dispose of disposers) dispose()
  click()
  assert.equal(navigations.length, 2)
  assert.equal(openedByHost.length, 2, 'fiber disposal removes the capture handler')
  dom.window.document.removeEventListener('click', hostOpener)
  dom.window.close()
})

test('Studio routing preserves Web, other destinations and ordinary modified/default-prevented clicks', async t => {
  const cases = [
    ['Web', { location: 'http://127.0.0.1:51454/' }],
    ['unofficial app authority', { location: 'dsh-app://other/' }],
    ['missing origin', { transport: undefined }],
    ['invalid origin', { transport: { streamBaseUrl: 'invalid' } }],
    ['non HTTP transport', { transport: { streamBaseUrl: 'file:///tmp/' } }],
    ['other port', { href: 'http://127.0.0.1:51455/design-studio/?agentId=same' }],
    ['other hostname', { href: 'http://localhost:51454/design-studio/?agentId=same' }],
    ['other path', { href: 'http://127.0.0.1:51454/design-studio/other' }],
    ['other application page', { href: 'http://127.0.0.1:51454/settings' }],
    ['Settings relative link', { href: '/design-studio/' }],
    ['external link', { href: 'https://example.com/design-studio/' }],
    ...['ctrlKey', 'metaKey', 'shiftKey', 'altKey'].map(key => [key, { event: { [key]: true } }]),
    ['middle button', { event: { button: 1 } }],
    ['right button', { event: { button: 2 } }],
    ['already prevented', { prevented: true }],
  ]
  for (const [name, options] of cases) await t.test(name, async () => {
    const dom = new JSDOM('<a>Studio</a>', { url: 'dsh-app://app/' })
    const navigations = [], disposers = []
    const { client } = await loadClient({ document: dom.window.document, URL,
      location: { href: options.location ?? 'dsh-app://app/', assign: path => navigations.push(path) },
      __DSH_TRANSPORT__: Object.hasOwn(options, 'transport') ? options.transport : { streamBaseUrl: 'http://127.0.0.1:51454/' } })
    await client.apply({ effect: install => disposers.push(install()), slots: { inject() {} }, locale: {} })
    const anchor = dom.window.document.querySelector('a')
    anchor.href = options.href ?? 'http://127.0.0.1:51454/design-studio/?agentId=same'
    let bubbled = false
    dom.window.document.addEventListener('click', event => { bubbled = true; event.preventDefault() })
    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options.event })
    if (options.prevented) event.preventDefault()
    anchor.dispatchEvent(event)
    assert.deepEqual(navigations, [])
    assert.equal(bubbled, true, 'leave the original Host/default click policy in charge')
    for (const dispose of disposers) dispose()
    dom.window.close()
  })
})
