import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { fixture } from './fixture.mjs'
import { startCompanion } from '../src/server.mjs'

test('development presentation is opt-in and preserves same-origin API authority and lifecycle', async () => {
  let htmlCalls = 0, assets = 0, closed = 0
  const f = await fixture({ serverOptions: { devFrontend: async ({ server, origin }) => {
    assert.ok(server.listening); assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/)
    return {
      async html(url, html) { htmlCalls++; assert.equal(url, '/?view=studio'); return html + '<!-- development entry -->' },
      async handle(req, res) {
        assets++
        if (req.url !== '/@vite/client') return false
        res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('// HMR transport fixture'); return true
      },
      async close() { closed++ },
    }
  } } })
  try {
    const origin = f.server.origin
    const html = await fetch(origin + '/?view=studio')
    assert.equal(html.status, 200); assert.match(await html.text(), /development entry/)
    assert.equal(html.headers.get('x-frame-options'), 'DENY')
    assert.equal(htmlCalls, 1)
    assert.equal((await fetch(origin + '/@vite/client')).status, 200)
    assert.equal((await fetch(origin + '/@vite/client', { headers: { Origin: 'https://foreign.invalid' } })).status, 403)
    assert.equal((await fetch(origin + '/undeclared-secret')).status, 404)
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(origin + '/@vite/client', { headers: { Host: 'foreign.invalid' } }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject); req.end()
    })
    assert.equal(wrongHost, 403)
    const headers = { 'Content-Type': 'application/json', Origin: origin, 'X-Design-Token': f.server.token }
    const body = JSON.stringify({ method: 'listSkills' })
    const beforeApi = assets
    assert.equal((await fetch(origin + '/api', { method: 'POST', headers: { ...headers, 'X-Design-Token': 'wrong' }, body })).status, 403)
    assert.equal((await fetch(origin + '/api', { method: 'POST', headers: { ...headers, Origin: 'https://foreign.invalid' }, body })).status, 403)
    assert.equal((await fetch(origin + '/api', { method: 'POST', headers, body })).status, 200)
    assert.equal(assets, beforeApi, 'the development frontend never receives API calls')
  } finally { await f.close() }
  assert.equal(closed, 1)
})

test('production serves built bytes without a development runtime or source routes', async () => {
  const f = await fixture()
  try {
    const html = await (await fetch(f.server.origin + '/?view=studio')).text()
    assert.doesNotMatch(html, /@vite|development entry/)
    assert.match(html, /client\.js/)
    assert.equal((await fetch(f.server.origin + '/@vite/client')).status, 404)
  } finally { await f.close() }
})

test('development factory is explicit and HTML transform failures are returned without broken headers', async () => {
  await assert.rejects(startCompanion({ devFrontend: true }), /explicit factory/)
  const f = await fixture({ serverOptions: { devFrontend: async () => ({
    html() { throw new Error('synthetic transform failure') }, handle() { return false }, close() {},
  }) } })
  try {
    const response = await fetch(f.server.origin + '/?view=studio')
    assert.equal(response.status, 400); assert.match(await response.text(), /synthetic transform failure/)
  } finally { await f.close() }
})
