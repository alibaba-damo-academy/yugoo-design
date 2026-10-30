/** Actual normal CJS artifact and React18 module table; Host services are explicit fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

test('normal native client registers Settings without adding a conversation-header entry or acquiring a Session', async () => {
  const require = createRequire(new URL('../package.json', import.meta.url))
  const modules = new Map(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].map(name => [name, require(name)]))
  const loads = []
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: value => loads.push(value) } } }, { timeout: 2000 })
  assert.equal(loads.length, 1); assert.equal(loads[0].id, 'dsh-design-studio-dsh')
  const requested = []
  const client = loads[0].factory(name => { requested.push(name); assert.ok(modules.has(name), 'unexpected native module-table dependency: ' + name); return modules.get(name) })
  assert.deepEqual([...client.inject], ['slots', 'locale'])
  const registrations = [], effects = [], removed = []
  const localeSnapshot = { active: 'en', revision: 0 }
  const runtime = {
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
})
