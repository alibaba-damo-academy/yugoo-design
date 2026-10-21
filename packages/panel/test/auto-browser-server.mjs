/** Isolated UI/validation probe. It does not stand in for DesignFilesStore. */
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { register } = await import('tsx/esm/api')
register()
const { autoPanelManifest } = await import('../../core/src/auto-panel-spec.ts')
const { basicGenericManifest } = await import('../../core/src/auto-panel-generation.ts')
const { readAutoPanelCache, publishAutoPanelCache, assertAutoPanelSave } = await import('../../core/src/auto-panel-cache.ts')
const { questionSchema: schema, questionState, questionContext } = await import('../../core/test/fixtures/declarative-question.mjs')
const { recordSchema, recordState, reportSchema, reportState } = await import('./fixtures/declarative-visuals.mjs')

const output = process.env.AUTO_BROWSER_OUT
if (!output) throw new Error('AUTO_BROWSER_OUT required')
const stateRoot = await mkdtemp(join(tmpdir(), 'auto-panel-browser-'))
let state = structuredClone(questionState)
const recordManifest = basicGenericManifest({ schema: recordSchema, state: recordState })
const plainRecordManifest = structuredClone(recordManifest)
const reportManifest = basicGenericManifest({ schema: reportSchema, state: reportState,
  artifacts: { 'report_fixture/report.md': 'fixture-digest' } })
const recordNode = recordManifest.ui.children.find(node => node.component === 'record_form')
if (!recordNode) throw new Error('record fixture requires a generic record form')
recordNode.component = 'grouped_records'
recordNode.group_by = 'group'
const context = () => ({ ...questionContext, schema, state })
const messages = [
  { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
  { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [
    { id: 'root', component: 'DesignPanel', manifest: basicGenericManifest(context()) },
  ] } },
]
await publishAutoPanelCache(stateRoot, context(), messages)

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && (request.url === '/' || request.url === '/?case=records' || request.url === '/?case=plain-records' || request.url === '/?case=report')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><div id="root"></div><script type="module" src="/auto-browser.js"></script></html>')
      return
    }
    if (request.method === 'GET' && request.url === '/auto-browser.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(await readFile(join(output, 'auto-browser.js')))
      return
    }
    if (request.method === 'GET' && request.url === '/fixture?case=records') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ manifest: recordManifest, state: recordState }))
      return
    }
    if (request.method === 'GET' && request.url === '/fixture?case=plain-records') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ manifest: plainRecordManifest, state: recordState }))
      return
    }
    if (request.method === 'GET' && request.url === '/fixture?case=report') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ manifest: reportManifest, state: reportState }))
      return
    }
    if (request.method === 'GET' && request.url === '/fixture') {
      const cached = await readAutoPanelCache(stateRoot, context())
      if (cached.status !== 'ready') throw new Error('generated snapshot not ready')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ manifest: autoPanelManifest(cached.snapshot, context()), state }))
      return
    }
    if (request.method === 'POST' && request.url === '/save') {
      let body = ''
      for await (const chunk of request) {
        body += chunk
        if (body.length > 64_000) throw new Error('payload too large')
      }
      const { before, after } = JSON.parse(body)
      await assertAutoPanelSave({ stateRoot, context: context(), before, visibleState: state, after })
      state = after
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
      return
    }
    response.writeHead(404).end()
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
})
server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (address && typeof address !== 'string') console.log(`http://127.0.0.1:${address.port}`)
})
const stop = () => { server.close(); void rm(stateRoot, { recursive: true, force: true }) }
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
