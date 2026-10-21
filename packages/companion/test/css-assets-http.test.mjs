import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixture } from './fixture.mjs'
import { staticFixture } from './static-fixture.mjs'
import { startCompanion } from '../src/server.mjs'

test('actual Companion serves only current CSS assets behind its existing Host guard', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-css-http-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const assets = await staticFixture(root)
  const bytes = Buffer.from('synthetic font bytes; HTTP identity test only')
  const sha256 = createHash('sha256').update(bytes).digest('hex'), name = `${sha256}.woff2`
  const folder = join(assets.staticRoot, 'css-assets/design-companion')
  await writeFile(join(folder, name), bytes)
  await writeFile(join(folder, 'undeclared.woff2'), 'not served')
  await writeFile(join(folder, 'manifest.json'), JSON.stringify({
    schema: 'design-system-css-assets-v1', prefix: '/design-system-assets/design-companion/',
    assets: [{ name, file: `css-assets/design-companion/${name}`, sha256, bytes: bytes.length, mime: 'font/woff2' }],
  }))
  const f = await fixture({ serverOptions: assets })
  t.after(() => f.close())
  const url = `${f.server.origin}/design-system-assets/design-companion/${name}?v=1`
  const response = await fetch(url)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'font/woff2')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  const head = await fetch(url, { method: 'HEAD' })
  assert.equal(head.status, 200); assert.equal(await head.text(), '')
  assert.equal(head.headers.get('content-length'), String(bytes.length))
  assert.equal((await fetch(url, { method: 'POST' })).status, 405)
  for (const path of ['design-companion/undeclared.woff2', 'other/' + name, 'design-companion/manifest.json']) {
    assert.equal((await fetch(`${f.server.origin}/design-system-assets/${path}`)).status, 404)
  }
  const wrongHost = await new Promise((resolve, reject) => {
    const req = request(url, { headers: { Host: 'foreign.invalid' } }, res => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject); req.end()
  })
  assert.equal(wrongHost, 403)
})

test('missing/corrupt resource delivery refuses startup before opening a project', async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-css-refusal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const assets = await staticFixture(root)
  const options = { ...assets, projectRoot: join(root, 'nonexistent-project'), stateRoot: join(root, 'state') }
  const path = join(assets.staticRoot, 'css-assets/design-companion/manifest.json')
  await rm(path)
  await assert.rejects(startCompanion(options), /ENOENT/)
  await writeFile(path, '{invalid')
  await assert.rejects(startCompanion(options), /JSON|Unexpected/)
  // Neither refusal creates project or journal state.
  const { access } = await import('node:fs/promises')
  await assert.rejects(access(options.projectRoot), /ENOENT/)
  await assert.rejects(access(options.stateRoot), /ENOENT/)
})
