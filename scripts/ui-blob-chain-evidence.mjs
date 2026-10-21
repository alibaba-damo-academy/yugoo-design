import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'
import { artifactInventory, inventorySha256, regularFile, sha256, classifyPicaWorker, PICA_WORKER_PINS } from './pica-worker-evidence.mjs'
import { proveEmbeddedImageLoader, EMBEDDED_IMAGE_PINS } from './embedded-image-loader-proof.mjs'
import { analyzeEmittedLoaders, BROWSERIFY_DISPATCHER } from './emitted-loader-check.mjs'

const require = createRequire(import.meta.url)
const { parseSync } = await import(pathToFileURL(createRequire(require.resolve('tsdown')).resolve('rolldown/utils')))
const parse = code => { const r = parseSync('client.js', code); assert.equal(r.errors.length, 0); return r.program }
const shape = n => JSON.stringify(n, (k, v) => ['start','end','loc','raw','comments','leadingComments','trailingComments'].includes(k) ? undefined : v)
const children = n => Object.values(n).flatMap(v => Array.isArray(v) ? v.filter(x => x?.type) : v?.type ? [v] : [])
export const UI_BLOB_FILES = Object.freeze({ client: 'client.js', pica: 'pica-DGw4b28J.js', runtime: 'rolldown-runtime-CEgmsyvS.js', image: 'image-blob-reduce.esm-BvXskEpO.js' })
export const UI_CONSUMER_PIN = '9c8f4e3fc42a9e027489ae81512fecd6a789fd1e4f79335e6e6440a7b7a68f17'
export const UI_NETWORK_CONTROL_SOURCE = "(async()=>{let fetchBlocked=false,importBlocked=false;try{await fetch('https://example.invalid/ui-blob-fetch-control')}catch{fetchBlocked=true}try{importScripts('https://example.invalid/ui-blob-import-control')}catch{importBlocked=true}postMessage({fetchBlocked,importBlocked})})()"
export function verifyUiBlobConsumer(code) {
  const program = parse(code)
  const matches = program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations).filter(n => n.id.name === '_Y')
  assert.equal(matches.length, 1, 'Expected one fixed UI consumer')
  const node = matches[0], bytes = code.slice(node.start, node.end)
  assert.equal(sha256(bytes), UI_CONSUMER_PIN, 'Changed UI consumer/configuration')
  const imports = []
  function walk(n) {
    if (n.type === 'ImportExpression' && [ './' + UI_BLOB_FILES.pica, './' + UI_BLOB_FILES.image ].includes(n.source?.value)) imports.push(n)
    children(n).forEach(walk)
  }
  walk(program)
  assert.equal(imports.length, 2, 'Ambiguous UI module routes')
  assert.ok(imports.every(n => node.start <= n.start && n.end <= node.end), 'UI imports escaped fixed consumer')
  assert.deepEqual(imports.map(n => n.source.value), ['./' + UI_BLOB_FILES.pica, './' + UI_BLOB_FILES.image])
  return { clientSha256: sha256(code), start: node.start, end: node.end, sliceSha256: UI_CONSUMER_PIN,
    configuredFeatures: ['js', 'wasm'], moduleChainOnly: true }
}
export async function verifyUiBlobInputs(webRoot) {
  const files = {}
  for (const [key, file] of Object.entries(UI_BLOB_FILES)) files[key] = await regularFile(webRoot, file)
  const consumer = verifyUiBlobConsumer(files.client.toString('utf8'))
  const pica = classifyPicaWorker(files.pica.toString('utf8'))
  assert.equal(sha256(files.runtime), PICA_WORKER_PINS.runtime, 'Changed emitted runtime')
  assert.equal(sha256(files.image), EMBEDDED_IMAGE_PINS.artifact, 'Changed embedded image artifact')
  const imageProof = proveEmbeddedImageLoader(files.image.toString('utf8'), { parse, shape, dispatcher: BROWSERIFY_DISPATCHER })
  const result = analyzeEmittedLoaders(files.image.toString('utf8'), imageProof)
  assert.deepEqual(result.unverified, imageProof.proof[0].staticUnknown)
  return { consumer, files: Object.fromEntries(Object.entries(files).map(([key, bytes]) => [UI_BLOB_FILES[key], { bytes: bytes.length, sha256: sha256(bytes) }])),
    offscreenSupportScriptSha256: pica.offscreenSupportScriptSha256, staticUnknown: result.unverified, dynamicClosureVerified: false }
}
const helperFiles = ['ui-blob-chain-evidence.mjs','pica-worker-evidence.mjs','embedded-image-loader-proof.mjs','emitted-loader-check.mjs','known-browser-loader-proof.mjs','known-node-loader-proof.mjs']
export async function uiBlobRunnerIdentity() {
  const helpers = {}
  for (const file of helperFiles) helpers[file] = sha256(await readFile(new URL('./' + file, import.meta.url)))
  return { runnerSha256: sha256(await readFile(new URL('./probe-companion-ui-blob-chain.mjs', import.meta.url))), helpers }
}
const hash = value => assert.match(value ?? '', /^[a-f0-9]{64}$/u, 'Explicit SHA-256 required')
export const UI_EXPECTED_SAMPLES = [[220,30,40,255],[20,180,60,255],[30,50,210,255],[230,200,20,255]]
export function validateUiPixels(bytes) {
  assert.equal(bytes.length, 64 * 32 * 4)
  const samples = [[16,8],[48,8],[16,24],[48,24]].map(([x,y]) => [...bytes.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)])
  samples.forEach((sample, i) => sample.forEach((v, j) => assert.ok(Math.abs(v - UI_EXPECTED_SAMPLES[i][j]) <= 3, 'Unexpected output pixels')))
  return samples
}
// Decode just this bounded, noninterlaced 8-bit RGB/RGBA PNG task. Validate
// actual PNG pixels rather than trusting dimensions/samples in a JSON report.
export function decodeUiPng(bytes) {
  assert.ok(bytes.length >= 45 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'Invalid PNG')
  let offset = 8, header, ended = false; const data = []
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, 'Truncated PNG chunk')
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length
    assert.ok(end <= bytes.length && length <= 1024 * 1024, 'Invalid PNG chunk size')
    const type = bytes.toString('ascii', offset + 4, offset + 8), payload = bytes.subarray(offset + 8, end - 4)
    let crc = 0xffffffff
    for (const byte of bytes.subarray(offset + 4, end - 4)) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
    assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(end - 4), 'PNG CRC mismatch')
    if (type === 'IHDR') {
      assert.ok(!header && offset === 8 && length === 13); header = payload
    } else if (type === 'IDAT') { assert.ok(header); data.push(payload) }
    else if (type === 'IEND') { assert.equal(length, 0); assert.equal(end, bytes.length); ended = true }
    else assert.ok(type === 'PLTE' || type[0] === type[0].toLowerCase(), 'Unsupported critical PNG chunk')
    offset = end
  }
  assert.ok(header && ended && data.length)
  assert.equal(header.readUInt32BE(0), 64); assert.equal(header.readUInt32BE(4), 32)
  assert.equal(header[8], 8); assert.ok([2,6].includes(header[9])); assert.deepEqual([...header.subarray(10)], [0,0,0])
  const channels = header[9] === 6 ? 4 : 3, stride = 64 * channels
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: (stride + 1) * 32 })
  assert.equal(raw.length, (stride + 1) * 32)
  const pixels = Buffer.alloc(64 * 32 * 4); let previous = Buffer.alloc(stride)
  const paeth = (a,b,c) => { const p=a+b-c, x=Math.abs(p-a), y=Math.abs(p-b), z=Math.abs(p-c); return x<=y&&x<=z?a:y<=z?b:c }
  for (let y=0;y<32;y++) {
    const filter = raw[y * (stride + 1)]; assert.ok(filter <= 4, 'Invalid PNG filter')
    const row = Buffer.alloc(stride)
    for (let x=0;x<stride;x++) {
      const left=x>=channels?row[x-channels]:0, up=previous[x], corner=x>=channels?previous[x-channels]:0
      const correction = [0,left,up,Math.floor((left+up)/2),paeth(left,up,corner)][filter]
      row[x] = (raw[y*(stride+1)+1+x]+correction)&255
    }
    for (let x=0;x<64;x++) { for (let c=0;c<3;c++) pixels[(y*64+x)*4+c]=row[x*channels+c]; pixels[(y*64+x)*4+3]=channels===4?row[x*channels+3]:255 }
    previous = row
  }
  return pixels
}

export async function validateUiBlobChainEvidence({ candidateDirectory, candidateInventorySha256, evidenceDirectory,
  reportSha256, runnerIdentity, versions }) {
  hash(candidateInventorySha256); hash(reportSha256)
  assert.deepEqual(runnerIdentity, await uiBlobRunnerIdentity(), 'Runner/helper drift')
  const candidate = resolve(candidateDirectory), evidence = resolve(evidenceDirectory), delta = relative(candidate,evidence)
  assert.ok(delta === '..' || delta.startsWith('../'), 'Evidence must be outside candidate')
  const inventory = await artifactInventory(candidate)
  assert.equal(inventorySha256(inventory), candidateInventorySha256, 'Candidate drift')
  const bytes = await regularFile(evidence,'report.json'); assert.equal(sha256(bytes), reportSha256, 'Report drift')
  const r = JSON.parse(bytes)
  assert.ok(!r.fixtureOnly, 'Marked fixture evidence rejected')
  assert.equal(r.kind,'candidate-injected-pica-ui-blob-chain'); assert.equal(r.status,'PASS')
  assert.equal(r.scope,'injected-pica-ui-blob-chain'); assert.equal(r.browserExecuted,true)
  assert.equal(r.root,evidence); assert.equal(r.inputRoot,candidate); assert.equal(r.source,join(candidate,'payload/shared/web'))
  assert.deepEqual(r.inputInventory,inventory); assert.equal(r.inputInventorySha256,candidateInventorySha256)
  assert.deepEqual(r.runnerIdentity,runnerIdentity)
  assert.equal(r.dynamicClosureVerified,false); assert.equal(r.embeddedDefaultWorkerVerified,false)
  for (const field of ['browserVersion','playwrightVersion','nodeVersion']) { assert.ok(typeof versions?.[field]==='string'&&versions[field]); assert.equal(r[field],versions[field],'Runtime version drift') }
  assert.equal(r.inputsUnchanged,true); assert.equal(r.copyUnchanged,true)
  assert.deepEqual(r.cleanup,{httpListening:false,browserConnected:false,browserPidAlive:false})
  assert.deepEqual(r.errors,[])
  const web = join(candidate,'payload/shared/web'), inputs = await verifyUiBlobInputs(web)
  assert.deepEqual(r.moduleInputs,inputs); assert.deepEqual(r.staticUnknown,inputs.staticUnknown)
  const webInventory = await artifactInventory(web)
  assert.deepEqual(r.webInventory,webInventory); assert.deepEqual(await artifactInventory(join(evidence,'web')),webInventory)
  const origin = new URL(r.origin); assert.equal(origin.protocol,'http:'); assert.equal(origin.hostname,'127.0.0.1')
  assert.ok(origin.port&&!['18421','9222'].includes(origin.port))
  assert.deepEqual(r.task.configuredFeatures,['js','wasm']); assert.equal(r.task.features.ww,false)
  assert.equal(r.task.features.js,true); assert.equal(r.task.features.wasm,true)
  assert.equal(r.task.mime,'image/png'); assert.equal(r.task.width,64); assert.equal(r.task.height,32)
  const output = await regularFile(evidence,'output.png'), pixels = decodeUiPng(output)
  assert.equal(output.length,r.task.outputBytes); assert.equal(sha256(output),r.task.outputSha256)
  assert.deepEqual(await regularFile(evidence,'output.rgba'),pixels)
  assert.equal(sha256(pixels),r.task.pixelSha256); assert.deepEqual(validateUiPixels(pixels),r.task.samples)
  assert.equal(r.task.workerTilePosts,0); assert.equal(r.task.workerTileResults,0)
  for (const worker of r.workers) {
    assert.equal(worker.terminated,true); assert.deepEqual(worker.errors,[])
    assert.ok(worker.messages.every(m=>m.error==null||m.error===''))
    assert.equal(worker.posts.length,0); assert.ok(worker.messages.every(m=>!m.dataLength&&!m.bitmap))
    const prefix='data:text/javascript;base64,'; assert.ok(worker.url.startsWith(prefix),'Unverified auxiliary Worker')
    const source=Buffer.from(worker.url.slice(prefix.length),'base64')
    assert.equal(sha256(source),inputs.offscreenSupportScriptSha256)
    assert.ok(worker.messages.some(m=>typeof m.support==='boolean'))
    assert.ok(/^ui-support-\d+\.js$/u.test(worker.sourceFile),'Unknown support evidence filename')
    assert.deepEqual(await regularFile(evidence,worker.sourceFile),source)
  }
  assert.equal(new Set(r.blobs.map(b=>b.file)).size,r.blobs.length)
  for(const b of r.blobs) {
    assert.ok(/^ui-blob-\d+\.bin$/u.test(b.file)); assert.equal(b.revoked,true); assert.equal(b.sourceRewritten,false)
    assert.ok(b.url.startsWith('blob:'+r.origin+'/'))
    const blob=await regularFile(evidence,b.file); assert.equal(blob.length,b.bytes); assert.equal(sha256(blob),b.sha256)
    assert.equal(b.type,'image/png','Unexpected generated Blob type')
  }
  const screenshot=await regularFile(evidence,'ui-blob-chain.png'); assert.equal(sha256(screenshot),r.screenshotSha256)
  const control=r.networkAuditControl
  assert.equal(control.status,'PASS'); assert.equal(control.fetchBlocked,true); assert.equal(control.importBlocked,true)
  assert.equal(control.workerTerminated,true); assert.equal(control.blobRevoked,true)
  assert.equal(control.sourceSha256,sha256(UI_NETWORK_CONTROL_SOURCE))
  assert.ok(control.url.startsWith('blob:'+r.origin+'/'))
  assert.equal(r.blocked.length,2)
  for(const suffix of ['fetch','import']) {
    const url=`https://example.invalid/ui-blob-${suffix}-control`
    assert.ok(r.blocked.some(x=>x.phase==='network-control'&&x.url===url))
    assert.ok(r.requests.some(x=>x.phase==='network-control'&&x.url===url))
  }
  const paths=['/probe.html',...Object.values(UI_BLOB_FILES).filter(f=>f!=='client.js').map(f=>'/web/'+f)]
  for(const q of r.requests) {
    assert.ok(['network-control','ui-blob-chain'].includes(q.phase),'Unknown request phase')
    if(q.phase==='network-control'&&r.blocked.some(x=>x.url===q.url))continue
    if(q.url===control.url&&q.phase==='network-control')continue
    if(r.blobs.some(b=>b.url===q.url)&&q.phase==='ui-blob-chain')continue
    if(r.workers.some(w=>w.url===q.url)&&q.phase==='ui-blob-chain')continue
    const url=new URL(q.url); assert.equal(url.origin,r.origin); assert.ok(paths.includes(url.pathname))
  }
  for(const file of Object.values(UI_BLOB_FILES).filter(f=>f!=='client.js')) assert.ok(r.requests.some(q=>q.phase==='ui-blob-chain'&&q.url===r.origin+'/web/'+file))
  assert.ok(r.serverRequests.length>0&&r.serverRequests.every(q=>q.status===200&&['GET','HEAD'].includes(q.method)&&paths.includes(q.path)))
  assert.equal(inventorySha256(await artifactInventory(candidate)),candidateInventorySha256)
  // These checks establish artifact/report consistency, not that a browser ran.
  // Execution requires a separately observed runner termination and review.
  return { scope:'injected-pica-ui-blob-chain-evidence-associations',evidenceAssociationsVerified:true,
    browserExecutionVerified:false,injectedUiBlobChainVerified:false,candidateInventorySha256,reportSha256,runnerIdentity,
    staticUnknown:inputs.staticUnknown, dynamicClosureVerified:false,embeddedDefaultWorkerVerified:false,
    candidateAccepted:false,bundlePanelGraKagVerified:false,publishReady:false }
}
