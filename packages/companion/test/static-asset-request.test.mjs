import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { staticAssetRequest } from '../src/static-asset-request.mjs'

const admitted = new Set(['index.html', 'client.js', 'bpmn.eot', 'bpmn.svg', 'font.woff2', 'font.ttf', 'a b.css', 'opaque.bin'])

test('queries select the same exact admitted resource and preserve font MIME', () => {
  assert.deepEqual(staticAssetRequest('/bpmn.eot?v=1', admitted), { name: 'bpmn.eot', type: 'application/vnd.ms-fontobject' })
  assert.deepEqual(staticAssetRequest('/bpmn.svg?version=2', admitted), { name: 'bpmn.svg', type: 'image/svg+xml' })
  assert.deepEqual(staticAssetRequest('/font.woff2?', admitted), { name: 'font.woff2', type: 'font/woff2' })
  assert.deepEqual(staticAssetRequest('/font.ttf', admitted), { name: 'font.ttf', type: 'font/ttf' })
  assert.deepEqual(staticAssetRequest('/?v=1', admitted), { name: 'index.html', type: 'text/html' })
  assert.deepEqual(staticAssetRequest('/a%20b.css?v=1', admitted), { name: 'a b.css', type: 'text/css' })
  assert.deepEqual(staticAssetRequest('/opaque.bin', admitted), { name: 'opaque.bin', type: 'application/octet-stream' })
})

test('query decoding never widens the top-level static allowlist', () => {
  for (const url of ['/missing.eot?v=1', '/assets/bpmn.eot', '/assets%2fbpmn.eot', '/assets%5cbpmn.eot',
    '/../client.js', '/%2e%2e/client.js', '/%2e%2e%2fclient.js', '//client.js', '/%00client.js',
    '/client.js%0a', '/%', '/client.js#fragment', 'https://foreign.invalid/client.js', null, {}]) {
    assert.equal(staticAssetRequest(url, admitted), null, String(url))
  }
  assert.equal(staticAssetRequest('/client.js?name=missing.eot', new Set()), null)
})

test('the normal Companion static route uses the shared resolver without changing admission', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8')
  assert.match(source, /import \{ staticAssetRequest \} from '\.\/static-asset-request\.mjs'/u)
  assert.match(source, /const asset = staticAssetRequest\(request\.url, staticFiles\)/u)
  assert.match(source, /if \(!asset\) return send\(response, 404/u)
  assert.match(source, /'X-Content-Type-Options': 'nosniff'/u)
  assert.doesNotMatch(source, /const name = request\.url === '\/'/u)
})
