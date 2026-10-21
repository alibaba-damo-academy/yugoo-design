import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { graphBrowserDependencies } = await import('../../../scripts/graph-browser-dependencies.ts')

test('ngraph CommonJS consumers get a callable event export without changing unrelated resolution', () => {
  const panel = createRequire(new URL('../package.json', import.meta.url))
  const threeGraph = createRequire(panel.resolve('3d-force-graph'))
  const force = createRequire(threeGraph.resolve('three-forcegraph'))
  const layout = force.resolve('ngraph.forcelayout')
  const resolver = graphBrowserDependencies()
  for (const importer of [layout, join(dirname(layout), 'lib/createPhysicsSimulator.js')]) {
    const resolved = resolver.resolveId('ngraph.events', importer)
    assert.match(resolved, /ngraph\.events\.cjs$/)
    assert.equal(typeof createRequire(importer)(resolved), 'function')
  }
  assert.equal(resolver.resolveId('ngraph.events', undefined), null)
  assert.equal(resolver.resolveId('ngraph.events', '/another/package/index.js'), null)
  assert.equal(resolver.resolveId('yaml', layout), null)
})
