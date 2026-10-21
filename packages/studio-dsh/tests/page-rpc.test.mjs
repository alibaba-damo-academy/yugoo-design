/** Built acceptance for the same-origin Studio RPC transport. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, stat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadDesignKit } from 'dsh-design-core/kit'
import { snapshotKit, StudioManagementService, StudioBundleSourceService } from 'dsh-design-studio'
import { writeContentCatalog } from '../../core/test/fixtures/content-catalog.mjs'
import { createSameOriginStudioRemote } from '../lib/page-rpc.js'

const workspaceValue = Object.freeze({
  query: 'flow',
  kits: Object.freeze([{ name: 'web_app', version: '1.0' }]),
  bundles: Object.freeze([{ name: 'flows', version: '1.0', description: 'Flow design', usedBy: Object.freeze([{ name: 'web_app', version: '1.0' }]) }]),
})

function fakeFetch(respond) {
  const calls = []
  return {
    calls,
    async transport(url, init) {
      calls.push({ url, init })
      const body = JSON.parse(init.body)
      return respond(body, { url, init })
    },
  }
}

function serverResponse(request, result) {
  return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

// Wire shape: URL, method, content type, and the exact client-request envelope.
{
  const fetchSpy = fakeFetch((request) => serverResponse(request, { ok: true, value: workspaceValue }))
  const remote = createSameOriginStudioRemote(fetchSpy.transport)
  const outcome = await remote.workspace('flow')
  assert.deepEqual(outcome, { ok: true, value: workspaceValue })
  const { url, init } = fetchSpy.calls[0]
  assert.equal(url.pathname, '/api/studioManagement/workspace')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers['content-type'], 'application/json')
  const body = JSON.parse(init.body)
  assert.equal(body.type, 'client-request')
  assert.match(body.rpcId, /^[0-9a-f-]{36}$/u, 'rpcId is a generated UUID')
  assert.equal(body.method, 'studioManagement/workspace')
  assert.deepEqual(body.payload, { args: { query: 'flow' } }, 'business arguments ride the wire-named args object')
}

// Desktop's custom scheme may have an opaque origin. Both representations must
// keep the six read methods on the protocol proxy; Web retains its own origin.
{
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')
  try {
    for (const [location, expected] of [
      [{ href: 'dsh-app://app/design-studio/?returnTo=https://evil.example#private=value', origin: 'null' }, 'dsh-app://app/api/studioManagement/workspace'],
      [{ href: 'dsh-app://app/design-studio/', origin: 'dsh-app://app' }, 'dsh-app://app/api/studioManagement/workspace'],
      [{ href: 'https://host.example:8443/design-studio/', origin: 'https://host.example:8443' }, 'https://host.example:8443/api/studioManagement/workspace'],
      [{ href: 'http://127.0.0.1:3000/design-studio/', origin: 'http://127.0.0.1:3000' }, 'http://127.0.0.1:3000/api/studioManagement/workspace'],
    ]) {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: location })
      const fetchSpy = fakeFetch(request => serverResponse(request, { ok: true, value: workspaceValue }))
      assert.deepEqual(await createSameOriginStudioRemote(fetchSpy.transport).workspace('flow'), { ok: true, value: workspaceValue })
      assert.equal(fetchSpy.calls[0].url.href, expected, 'no backend port or private URL data is needed')
      assert.equal(fetchSpy.calls[0].init.headers.cookie, undefined, 'the page does not manufacture host credentials')
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor)
    else delete globalThis.location
  }
}

// Read-by-name arguments travel inside the wire envelope.
{
  const readValue = Object.freeze({
    workspace: Object.freeze({
      name: 'flows',
      version: '1.0',
      kit: 'web_app',
      description: 'Flow design',
      files: Object.freeze([{ path: 'SKILL.md', bytes: 12 }]),
      panel: Object.freeze({ kind: 'native', renderer: 'demo.flows/v1' }),
    }),
    diagnostics: Object.freeze([]),
  })
  const fetchSpy = fakeFetch((request) => serverResponse(request, { ok: true, value: readValue }))
  const remote = createSameOriginStudioRemote(fetchSpy.transport)
  const outcome = await remote.readBundleWorkspace('flows')
  assert.deepEqual(outcome, { ok: true, value: readValue })
  assert.deepEqual(JSON.parse(fetchSpy.calls[0].init.body).payload, { args: { name: 'flows' } })
}

// The Kit workspace read rides the same wire with its strict result schema.
{
  const kitWorkspaceValue = Object.freeze({
    workspace: Object.freeze({
      name: 'web_app',
      version: '1.0',
      description: 'Web app Kit',
      mindsetSource: '---\nname: "web_app"\n---\n\n<design_skills>\n</design_skills>\n',
      mounts: Object.freeze([{
        name: 'shared', version: '1.0', description: 'Shared Bundle', mountedBy: Object.freeze([{ name: 'web_app', version: '1.0' }]),
      }]),
      resources: Object.freeze([{ path: 'shared/reference/a.md', bytes: 4 }]),
    }),
    diagnostics: Object.freeze([]),
  })
  const fetchSpy = fakeFetch((request) => serverResponse(request, { ok: true, value: kitWorkspaceValue }))
  const remote = createSameOriginStudioRemote(fetchSpy.transport)
  const outcome = await remote.readKitWorkspace('web_app', '1.0')
  assert.deepEqual(outcome, { ok: true, value: kitWorkspaceValue })
  const { url, init } = fetchSpy.calls[0]
  assert.equal(url.pathname, '/api/studioManagement/readKitWorkspace')
  assert.equal(JSON.parse(init.body).method, 'studioManagement/readKitWorkspace')
  assert.deepEqual(JSON.parse(init.body).payload, { args: { name: 'web_app', version: '1.0' } }, 'the exact pin travels as required wire arguments')
  await assert.rejects(
    createSameOriginStudioRemote(fakeFetch((request) => serverResponse(request, { ok: true, value: { workspace: { name: 'web_app' }, diagnostics: [] } })).transport).readKitWorkspace('web_app', '1.0'),
    /required|invalid/iu,
    'a partial Kit workspace view is rejected by the strict result schema',
  )
}

// Kit source reads carry the exact required pin and relative file path.
{
  const paths = ['kit.yaml', 'mindset.md', 'reference/guide.md']
  const fileValue = { content: 'schemaVersion: 1\nname: web_app\n' }
  const fetchSpy = fakeFetch(request => serverResponse(request, {
    ok: true, value: request.method.endsWith('/readKitFiles') ? paths : fileValue,
  }))
  const remote = createSameOriginStudioRemote(fetchSpy.transport)
  assert.deepEqual(await remote.readKitFiles('web_app', '1.0'), { ok: true, value: paths })
  assert.deepEqual(await remote.readKitFile('web_app', '1.0', 'kit.yaml'), { ok: true, value: fileValue })
  for (const [index, method, args] of [
    [0, 'readKitFiles', { name: 'web_app', version: '1.0' }],
    [1, 'readKitFile', { name: 'web_app', version: '1.0', path: 'kit.yaml' }],
  ]) {
    const { url, init } = fetchSpy.calls[index]
    assert.equal(url.pathname, `/api/studioManagement/${method}`)
    assert.equal(JSON.parse(init.body).method, `studioManagement/${method}`)
    assert.deepEqual(JSON.parse(init.body).payload, { args }, 'Kit reads preserve the exact required version on the JSON wire')
  }
  assert.deepEqual(await createSameOriginStudioRemote(fakeFetch(request => serverResponse(request,
    { ok: true, value: [] })).transport).readKitFiles('web_app', '1.0'), { ok: true, value: [] })
  for (const invalid of [{ files: paths }, ['kit.yaml', 1], null]) {
    await assert.rejects(createSameOriginStudioRemote(fakeFetch(request => serverResponse(request,
      { ok: true, value: invalid })).transport).readKitFiles('web_app', '1.0'), /required|invalid/iu,
    'Kit file lists require the raw string-array result')
  }
  for (const invalid of [{}, { content: 1 }, { content: '', path: 'kit.yaml' }, { content: '', diagnostics: [] }]) {
    await assert.rejects(createSameOriginStudioRemote(fakeFetch(request => serverResponse(request,
      { ok: true, value: invalid })).transport).readKitFile('web_app', '1.0', 'kit.yaml'), /required|invalid|unrecognized/iu,
    'Kit file content has one required string field and rejects unknown result fields')
  }
}

// Bundle file reads ride the wire with both business arguments.
{
  const fileValue = Object.freeze({ file: Object.freeze({ path: 'SKILL.md', content: '# flows\n' }), diagnostics: Object.freeze([]) })
  const fetchSpy = fakeFetch((request) => serverResponse(request, { ok: true, value: fileValue }))
  const remote = createSameOriginStudioRemote(fetchSpy.transport)
  const outcome = await remote.readBundleFile('flows', 'SKILL.md')
  assert.deepEqual(outcome, { ok: true, value: fileValue })
  const { url, init } = fetchSpy.calls[0]
  assert.equal(url.pathname, '/api/studioManagement/readBundleFile')
  assert.deepEqual(JSON.parse(init.body).payload, { args: { name: 'flows', path: 'SKILL.md' } })
  await remote.readBundleFile('flows', 'SKILL.md', '1.0')
  assert.deepEqual(JSON.parse(fetchSpy.calls[1].init.body).payload,
    { args: { name: 'flows', path: 'SKILL.md', version: '1.0' } }, 'exact Bundle version survives the transport')
  // The public Remote surface is exactly the six read-only methods.
  assert.deepEqual(Object.keys(remote).sort(), ['readBundleFile', 'readBundleWorkspace', 'readKitFile', 'readKitFiles', 'readKitWorkspace', 'workspace'], 'no mutation method exists on the page Remote')
}

// Outer gateway failures converge on code/message and drop host details.
{
  const fetchSpy = fakeFetch((request) => serverResponse(request, { ok: false, error: { code: 'internal', message: 'gateway exploded', details: { trace: 'x' } } }))
  const remote = createSameOriginStudioRemote(fetchSpy.transport)
  const outcome = await remote.readBundleWorkspace('flows')
  assert.deepEqual(outcome, { ok: false, error: { code: 'internal', message: 'gateway exploded' } }, 'outer failures converge and never leak details')
  assert.deepEqual(await remote.readKitFiles('web_app', '1.0'), outcome)
  assert.deepEqual(await remote.readKitFile('web_app', '1.0', 'kit.yaml'), outcome)
}

// Strict validation rejects every malformed layer.
{
  const reject = async (respond, pattern, message) => {
    const fetchSpy = fakeFetch(respond)
    const remote = createSameOriginStudioRemote(fetchSpy.transport)
    await assert.rejects(remote.workspace(''), pattern, message)
  }
  await reject(
    (request) => serverResponse({ rpcId: 'another-id' }, { ok: true, value: workspaceValue }),
    /rpcId mismatch/u,
    'a mismatched correlation id fails loud',
  )
  await reject(
    () => new Response('not json', { status: 200 }),
    /SyntaxError|Unexpected/u,
    'non-JSON bodies fail loud',
  )
  await reject(
    (request) => new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: workspaceValue }, extra: 1 }), { status: 200 }),
    /unrecognized|extra/iu,
    'the outer envelope is strict',
  )
  await reject(
    (request) => serverResponse(request, { ok: true }),
    /required|invalid/iu,
    'a success result without a value is rejected',
  )
  await reject(
    (request) => serverResponse(request, { ok: false, error: { code: 'bad-request', message: 'nope' } }),
    /required|invalid/iu,
    'an outer failure without details is rejected',
  )
  await reject(
    (request) => serverResponse(request, { ok: true, value: { query: 'x' } }),
    /required|invalid/iu,
    'the success value is parsed by the strict TYPERT_REMOTE result schema',
  )
  const fetchSpy = fakeFetch(() => new Response('', { status: 500 }))
  const remote = createSameOriginStudioRemote(fetchSpy.transport)
  await assert.rejects(remote.workspace(''), /HTTP 500/u, 'non-OK transport fails loud')
}

// Core-compiled installed content must survive the domain → strict codec →
// same-origin page path. Hand-authored minimal values miss optional display copy.
await test('compiled synthetic catalogs retain bilingual copy through every strict RPC read', async t => {
  const root = await mkdtemp(join(tmpdir(), 'studio-page-rpc-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = {
    async readText(path) {
      try { return await readFile(path, 'utf8') }
      catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
    },
    listDir: readdir,
    isDirectory: async path => (await stat(path)).isDirectory(),
    realPath: realpath,
  }
  const catalogs = await Promise.all([
    writeContentCatalog(join(root, 'first'), { name: 'first_catalog' }),
    writeContentCatalog(join(root, 'second'), { name: 'second_catalog', bundles: [{ name: 'gamma' }, { name: 'delta' }] }),
  ])
  const kits = await Promise.all(catalogs.map((catalog, index) => loadDesignKit(source, catalog.root,
    { sourceId: `fixture:studio-rpc:${index}` })))
  const kitSnapshots = kits.map(snapshotKit)
  const bundles = kitSnapshots.flatMap(kit => kit.bundles)
  const catalog = { snapshot: async () => ({ kits: kitSnapshots, bundles }) }
  const management = new StudioManagementService(catalog)
  const bundleSource = new StudioBundleSourceService(catalog, {
    ...source,
    listKitRoots: async () => [],
    resolveBundleRoot: async pin => bundles.find(bundle => bundle.name === pin.name && bundle.version === pin.version)?.definition.resourceRoot,
    async listFiles(root) {
      const files = []
      async function visit(path, prefix = '') {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          const relative = prefix + entry.name
          if (entry.isDirectory()) await visit(join(path, entry.name), relative + '/')
          else if (entry.isFile()) files.push(relative)
        }
      }
      await visit(root)
      return files.sort()
    },
  })
  const actual = await management.workspace('')
  assert.ok(actual.kits.some(kit => kit.description && kit.displayDescription))
  assert.ok(actual.bundles.some(bundle => bundle.title && bundle.displayDescription))
  const fetchSpy = fakeFetch(async request => {
    const { args } = request.payload
    const method = request.method.split('/')[1]
    const value = method === 'workspace' ? await management.workspace(args.query)
      : method === 'readKitWorkspace' ? await management.readKitWorkspace(args.name, args.version)
        : method === 'readBundleWorkspace' ? await bundleSource.readBundleWorkspace(args.name, args.version)
          : await bundleSource.readBundleFile({ name: args.name, path: args.path, version: args.version })
    return serverResponse(request, { ok: true, value })
  })
  const remote = createSameOriginStudioRemote(fetchSpy.transport)
  assert.deepEqual(await remote.workspace(''), { ok: true, value: actual })
  for (const kit of kits) {
    const expected = await management.readKitWorkspace(kit.name, kit.version)
    assert.ok(expected.workspace.mounts.some(bundle => bundle.title && bundle.displayDescription))
    assert.deepEqual(await remote.readKitWorkspace(kit.name, kit.version), { ok: true, value: expected })
  }
  const selected = bundles.find(bundle => bundle.definition.pickerDescription)
  assert.ok(selected)
  const expected = await bundleSource.readBundleWorkspace(selected.name, selected.version)
  assert.deepEqual(expected.diagnostics, [])
  assert.ok(expected.workspace.displayDescription)
  assert.deepEqual(await remote.readBundleWorkspace(selected.name, selected.version), { ok: true, value: expected })
  const file = await bundleSource.readBundleFile({ name: selected.name, path: 'SKILL.md', version: selected.version })
  assert.deepEqual(file.diagnostics, [])
  assert.deepEqual(await remote.readBundleFile(selected.name, 'SKILL.md', selected.version), { ok: true, value: file })
  for (const corrupt of [
    value => { value.kits[0].unknownField = true },
    value => { value.bundles[0].title.zh = 1 },
    value => { value.bundles.find(bundle => bundle.displayDescription).displayDescription.extra = 'unknown locale' },
  ]) {
    const invalid = structuredClone(actual)
    corrupt(invalid)
    await assert.rejects(createSameOriginStudioRemote(fakeFetch(request => serverResponse(request,
      { ok: true, value: invalid })).transport).workspace(''), /unrecognized|invalid/iu)
  }
  console.log(`DSH STUDIO COMPILED CATALOG RPC OK (${kits.length} Kits, ${bundles.length} Bundles)`)
})

console.log('DSH STUDIO PAGE RPC OK')
