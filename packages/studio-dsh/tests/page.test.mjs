/** Built acceptance for the plugin-owned standalone Studio page routes. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'tsdown'
import configurations from '../tsdown.config.ts'
import { analyzeEmittedLoaders } from '../../../scripts/emitted-loader-check.mjs'
import { apply, inject, name, STUDIO_PAGE_BASE, STUDIO_PAGE_PATH } from '../lib/page.js'

assert.equal(name, 'dsh-design-studio-page')
assert.deepEqual(inject, ['webServer'])
assert.equal(STUDIO_PAGE_BASE, '/design-studio/')
assert.equal(STUDIO_PAGE_PATH, '/design-studio')

function fakeResponse() {
  const headers = new Map()
  return {
    statusCode: 0,
    body: undefined,
    setHeader(headerName, value) { headers.set(headerName.toLowerCase(), value) },
    header(headerName) { return headers.get(headerName.toLowerCase()) },
    end(body) { this.body = body },
  }
}

/** Real WebRoute semantics: exact routes win; prefix p matches p and p/<anything>. */
function fakeServer(options = {}) {
  const routes = []
  return {
    routes,
    register(route) {
      routes.push(route)
      return () => {
        routes.splice(routes.indexOf(route), 1)
        if (options.unregisterError !== undefined) throw options.unregisterError
      }
    },
    async dispatch(url) {
      const path = url.split('?')[0]
      const exact = routes.find((route) => route.kind === 'exact' && route.path === path)
      const prefix = routes.find((route) => route.kind === 'prefix' && (path === route.path || path.startsWith(`${route.path}/`)))
      const route = exact ?? prefix
      const res = fakeResponse()
      if (route === undefined) {
        res.statusCode = 404
        return { route: undefined, res }
      }
      await route.handler({ url }, res)
      return { route, res }
    },
  }
}

const server = fakeServer()
const effects = []
const ctx = {
  webServer: server,
  effect(execute, label) {
    assert.equal(label, 'design-studio-page.route')
    const result = execute()
    effects.push(result)
    return result
  },
}
apply(ctx)
const dispose = await effects[0]
assert.deepEqual(
  server.routes.map((route) => ({ kind: route.kind, path: route.path })),
  [
    { kind: 'exact', path: '/design-studio' },
    { kind: 'prefix', path: '/design-studio' },
  ],
  'both routes register the slash-less path; a trailing-slash prefix would never match subresources',
)

const slashless = await server.dispatch('/design-studio')
assert.equal(slashless.route.kind, 'exact', 'the router hands the slash-less path to the exact route, never the prefix handler')
assert.equal(slashless.res.statusCode, 308)
assert.equal(slashless.res.header('Location'), '/design-studio/')

const shell = await server.dispatch('/design-studio/')
assert.equal(shell.route.kind, 'prefix')
assert.equal(shell.res.statusCode, 200)
assert.equal(shell.res.header('Content-Type'), 'text/html; charset=utf-8')
assert.equal(shell.res.header('Cache-Control'), 'no-store')
assert.match(String(shell.res.body), /<div id="root"><\/div>/)
assert.match(String(shell.res.body), /<script type="module" src="\.\/page-client\.js"><\/script>/, 'the shell loads the real bundle name below the route base')

const queried = await server.dispatch('/design-studio/?refresh=1')
assert.equal(queried.res.statusCode, 200, 'query strings never change the served document')

const bundle = await server.dispatch('/design-studio/page-client.js')
assert.equal(bundle.res.statusCode, 200)
assert.equal(bundle.res.header('Content-Type'), 'application/javascript; charset=utf-8')
assert.equal(bundle.res.header('Cache-Control'), 'no-store')
assert.ok(bundle.res.body.length > 0, 'the standalone page bundle ships from the built package')
const bundleText = String(bundle.res.body)
const loaders = analyzeEmittedLoaders(bundleText)
assert.deepEqual(loaders.loads, [], 'the standalone browser has no import map or external module loader')
assert.deepEqual(loaders.unverified, [], 'the standalone page cannot defer a computed or unverified module load')
assert.equal(bundleText.includes('__ModuleLoader__'), false, 'the page bundle must not depend on the SPA module loader')
assert.equal(bundleText.includes('dsh-client-connection'), false, 'the page bundle must not boot DSH client plugins')
assert.equal(bundleText.includes('remote.commands'), false, 'the page bundle must not embed the main UI runtime commands dependency')
assert.match(bundleText, /client-request/, 'the page bundle speaks the /api client-request envelope directly')
assert.match(bundleText, /studioManagement\/workspace/, 'the page bundle calls the session-free studioManagement namespace')

const unknown = await server.dispatch('/design-studio/admin')
assert.equal(unknown.res.statusCode, 404, 'unknown subpaths never fall through to the SPA')

await dispose()
assert.equal(server.routes.length, 0, 'disposing the plugin effect withdraws both routes')
assert.equal(effects.length, 1)

const unregisterError = new Error('route withdraw failed')
const failing = fakeServer({ unregisterError })
const failingEffects = []
apply({ webServer: failing, effect: (execute) => { const result = execute(); failingEffects.push(result); return result } })
const failingDispose = await failingEffects[0]
assert.equal(failing.routes.length, 2)
await assert.rejects(failingDispose, error => error === unregisterError, 'the first withdraw failure stays authoritative')
assert.equal(failing.routes.length, 0, 'both routes are withdrawn even when withdrawal reports')

const setupError = new Error('prefix registration rejected')
const partial = {
  routes: [],
  register(route) {
    if (route.kind === 'prefix') throw setupError
    this.routes.push(route)
    return () => { this.routes.splice(this.routes.indexOf(route), 1) }
  },
}
const partialEffects = []
apply({ webServer: partial, effect: (execute) => { partialEffects.push(execute); return undefined } })
assert.throws(() => partialEffects[0](), error => error === setupError, 'a failed registration keeps the setup error authoritative')
assert.equal(partial.routes.length, 0, 'a failed registration withdraws every route already acquired')

// Exercise the real configured bundler: an HTTP 200 or nonempty script does not
// prove that a browser can resolve its module graph.
const standalone = configurations.find(config => config.entry?.['page-client'])
assert.ok(standalone)
const fixture = await mkdtemp(join(tmpdir(), 'studio-browser-closure-'))
try {
  const entry = join(fixture, 'entry.mjs')
  const compile = async (code, inputOptions = {}) => {
    await writeFile(entry, code)
    return build({ ...standalone, config: false, entry: { 'page-client': entry },
      outDir: join(fixture, 'out'), write: false, logLevel: 'error', inputOptions })
  }
  const success = await compile('export const ready = true;')
  try {
    assert.equal(success.flatMap(result => result.chunks).length, 1)
  } finally {
    await Promise.all(success.map(result => result[Symbol.asyncDispose]()))
  }
  for (const code of [
    'import value from "studio-external-fixture"; export default value;',
    'export const load = () => import("studio-external-fixture");',
  ]) {
    await assert.rejects(compile(code, { external: ['studio-external-fixture'] }),
      /self-contained browser module/u, 'static and lazy external imports fail the actual build')
  }
  await assert.rejects(compile('import value from "studio-uninstalled-fixture"; export default value;'),
    'unresolved dependencies must fail instead of producing an external browser import')
} finally {
  await rm(fixture, { recursive: true, force: true })
}

console.log('DSH STUDIO PAGE ROUTE OK')
