import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { fixture } from '../../companion/test/fixture.mjs'
import { callCompanion } from '../../companion/src/connection-file.mjs'
import { createCompanionDevFrontend } from '../src/frontend.ts'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))

test('real Vite middleware transforms React/CSS while keeping filesystem and origin boundaries', async () => {
  const f = await fixture({ serverOptions: {
    indexPath: resolve(workspace, 'packages/companion/index.html'), devFrontend: createCompanionDevFrontend,
  } })
  try {
    const origin = f.server.origin
    const html = await (await fetch(origin + '/?view=studio')).text()
    assert.match(html, /@vite\/client/)
    assert.match(html, /@react-refresh/)
    assert.match(html, /src="\/src\/client\.tsx"/)
    const module = await fetch(origin + '/@fs/' + resolve(workspace, 'packages/panel/src/record-map.tsx'))
    assert.equal(module.status, 200)
    assert.match(await module.text(), /\$RefreshReg\$|registerExportsForReactRefresh/)
    const css = await fetch(origin + '/@fs/' + resolve(workspace, 'packages/panel/src/visual-components.css'))
    assert.equal(css.status, 200)
    assert.match(await css.text(), /import\.meta\.hot|__vite__updateStyle/)
    const canvasEntry = realpathSync(createRequire(new URL('../../panel/tsdown.config.ts', import.meta.url)).resolve('@excalidraw/excalidraw'))
    for (const query of ['', '?v=component-library-check']) {
      const canvas = await fetch(origin + '/@fs/' + canvasEntry + query)
      assert.equal(canvas.status, 200)
      assert.match(await canvas.text(), /acquireDesignUiFont/, 'cache-busted native canvas keeps the audited UI font facade')
    }
    assert.equal((await fetch(origin + '/@fs/' + resolve(workspace, 'package.json'))).status, 403)
    assert.equal((await fetch(origin + '/@vite/client', { headers: { Origin: 'https://foreign.invalid' } })).status, 403)
    // A hostile web page must not establish a live development socket, even
    // though the public /@vite/client resource reveals the dev socket token.
    const deniedUpgrade = await new Promise((resolve, reject) => {
      const req = request(origin, { headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', Origin: 'https://foreign.invalid',
        'Sec-WebSocket-Key': 'AAECAwQFBgcICQoLDA0ODw==', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Protocol': 'vite-hmr',
      } })
      req.setTimeout(5000, () => req.destroy(new Error('Upgrade guard timeout')))
      req.once('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Foreign upgrade accepted')) })
      req.once('response', response => { response.resume(); resolve(response.statusCode !== 101) })
      req.once('error', error => error.code === 'ECONNRESET' ? resolve(true) : reject(error))
      req.end()
    })
    assert.equal(deniedUpgrade, true)
    // Trials receive the explicit development factory through the normal
    // child service, but do not inherit the parent's API authority.
    const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
    const catalog = await call('studioWorkspace', { query: '' }), kit = catalog.kits[0]
    const trial = await call('studioTrialStart', { source: {
      kind: 'installed', kit: { name: kit.name, version: kit.version },
      bundle: { name: 'business_rules', version: '1.0' },
    }, task: 'Synthetic development child transport check.' })
    assert.equal(trial.status, 'queued') // Fixture queue, not native execution.
    const child = new URL(trial.resultUrl)
    const embedded = await fetch(child.origin + '/?view=trial-panel')
    assert.equal(embedded.headers.get('content-security-policy'), `frame-ancestors ${origin}`)
    assert.match(await embedded.text(), /@vite\/client/)
    assert.equal((await fetch(child.origin + '/@vite/client')).status, 200)
    assert.equal((await fetch(child.origin + '/?view=studio')).headers.get('x-frame-options'), 'DENY')
    assert.equal((await fetch(child.origin + '/api', { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: origin, 'X-Design-Token': child.hash.slice(1),
    }, body: JSON.stringify({ method: 'info' }) })).status, 403)
  } finally { await f.close() }
})
