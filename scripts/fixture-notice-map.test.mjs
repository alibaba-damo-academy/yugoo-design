import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mapPath = 'scripts/test-fixtures/fixture-notice-map.json'
const mapSha256 = 'd1ae011d9839b6447023bdc1ee869fd526b28d3d5c8cbd575256011a70c4f163'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = path => readFile(resolve(root, path))
// Independent reviewed authority: do not derive this list or these hashes from the map.
const noticePins = {
  'scripts/test-fixtures/pica-worker/source/glur/LICENSE': 'b6138f8837c5776c0760cb5a711e593dacd423b11195f6365ab17be69e715fcc',
  'scripts/test-fixtures/pica-worker/source/inherits/LICENSE': '5ffe28e7ade7d8f10d85d5337a73fd793dac5c462fb9a28fbf8c5046c7fbca3b',
  'scripts/test-fixtures/pica-worker/source/multimath/LICENSE': '87ce65401af04f9a31e681276faeb166e0de56cc483751d6ca99a7dcb353dd7f',
  'scripts/test-fixtures/pica-worker/source/object-assign/license': '6fb9754611c20f6649f68805e8c990e83261f29316e29de9e6cedae607b8634c',
  'scripts/test-fixtures/pica-worker/source/rolldown/LICENSE': '23ecfff35a5a2e80d92142f75228912c3b1abc4b5a8337a821ff4397e2f9f734',
  'scripts/test-fixtures/pica-worker/source/rolldown/THIRD-PARTY-LICENSE': 'a877291d800ed43692f3f9ae09d8e01cc6f7293ad39d43896059c188ffbb8b7c',
  'scripts/test-fixtures/ui-blob-chain/LICENSE': '1352d204fdb90d5e482c13139d848bc2c9300a9a7de358a0a558a23e72d0d8be',
  'scripts/test-fixtures/pica-worker/source/pica/LICENSE': '55c3dde19ab8a9b9b23c576375fb7a48423124d76530a3ddeeb897a3c47223aa',
  'scripts/test-fixtures/pica-worker/source/webworkify/LICENSE': '435a6722c786b0a56fbe7387028f1d9d3f3a2d0fb615bb8fee118727c3f59b7b',
  'scripts/test-fixtures/embedded-image-loader/LICENSE': '23620d4179e5deb477db18c09c07f5bc2bd9ffd6ccd0839a3da79d156694b980',
}
const fixturePaths = [
  'scripts/test-fixtures/pica-worker/default-worker-worker-0.js',
  'scripts/test-fixtures/pica-worker/default-worker-worker-1.js',
  'scripts/test-fixtures/pica-worker/js-worker-worker-0.js',
  'scripts/test-fixtures/pica-worker/js-worker-worker-1.js',
  'scripts/test-fixtures/pica-worker/pica-DGw4b28J.js',
  'scripts/test-fixtures/pica-worker/rolldown-runtime-CEgmsyvS.js',
  'scripts/test-fixtures/pica-worker/source/pica/dist/pica.js',
  'scripts/test-fixtures/embedded-image-loader/image-blob-reduce.esm.js',
  'scripts/test-fixtures/ui-blob-chain/client-consumer.js',
].sort()

async function verify(readBytes = read) {
  const raw = await readBytes(mapPath)
  assert.equal(sha(raw), mapSha256, 'Fixed source/notice map changed')
  const map = JSON.parse(raw)
  assert.equal(map.scope, 'fixed-public-test-fixtures-only')
  assert.equal(map.completeBundledInventory, false)
  assert.equal(map.releaseLicenseAcceptance, false)
  assert.deepEqual(map.noticeFiles.map(x => x.path).sort(), Object.keys(noticePins).sort())
  assert.deepEqual(map.fixtures.map(x => x.path).sort(), fixturePaths)
  for (const entry of map.noticeFiles) {
    assert.equal(entry.sha256, noticePins[entry.path])
    const bytes = await readBytes(entry.path)
    assert.equal(bytes.length, entry.bytes, `Notice length: ${entry.path}`)
    assert.equal(sha(bytes), noticePins[entry.path], `Notice hash: ${entry.path}`)
  }
  for (const entry of map.fixtures) {
    assert.equal(sha(await readBytes(entry.path)), entry.sha256, `Fixture hash: ${entry.path}`)
  }
  return map
}

test('fixed ten notices and nine copied fixtures retain their reviewed identities', async () => {
  const map = await verify()
  assert.deepEqual(map.components.slice(0, 6).map(x => [x.name, x.comparedSourceVersion, x.moduleId]), [
    ['glur', '1.1.2', 18], ['inherits', '2.0.4', 19], ['multimath', '2.0.0', 20],
    ['multimath', '2.0.0', 21], ['multimath', '2.0.0', 22], ['object-assign', '4.1.1', 23],
  ])
  const runtime = map.components.find(x => x.name === 'rolldown')
  assert.equal(runtime.version, '1.2.4')
  assert.equal(runtime.matchedInitializers.length, 13)
  assert.deepEqual(runtime.runtimeBlobSha1, [
    'b322b17154822cc820bd399daef37ff6197617fb', 'ef5a963f45a7db7a19fd9b7b85cf22a68cd62147',
  ])
  assert.match((await read('scripts/test-fixtures/pica-worker/source/inherits/LICENSE')).toString(), /The ISC License/)
  const thirdParty = await read('scripts/test-fixtures/pica-worker/source/rolldown/THIRD-PARTY-LICENSE')
  assert.notEqual(thirdParty.at(-1), 10, 'Preserve original absence of terminal newline')
  assert.match(thirdParty.toString(), /Copyright \(c\) 2020 Evan Wallace/)
  assert.doesNotMatch(JSON.stringify(map), /\/tmp\/|\/home\/|\/Users\/|gitlab\.momenta/)
})

test('all ten notice byte changes and nine fixture changes are rejected without writing them', async () => {
  for (const path of [...Object.keys(noticePins), ...fixturePaths]) {
    await assert.rejects(verify(async requested => {
      const bytes = await read(requested)
      if (requested !== path) return bytes
      const changed = Buffer.from(bytes)
      changed[0] ^= 1
      return changed
    }), /Notice hash|Fixture hash/, path)
  }
})

test('dropping notice or refreshing its pin cannot make a changed map pass', async () => {
  const original = JSON.parse(await read(mapPath))
  const variants = [
    { ...original, noticeFiles: original.noticeFiles.slice(1) },
    { ...original, noticeFiles: original.noticeFiles.map((x, i) => i ? x : { ...x, sha256: '0'.repeat(64) }) },
    { ...original, releaseLicenseAcceptance: true },
    { ...original, completeBundledInventory: true },
  ]
  for (const changed of variants) {
    await assert.rejects(verify(path => path === mapPath ? Buffer.from(JSON.stringify(changed)) : read(path)), /Fixed source\/notice map changed/)
  }
})

test('README links resolve and UI distinguishes upstream license from installed-file absence', async () => {
  for (const dir of ['pica-worker', 'embedded-image-loader', 'ui-blob-chain']) {
    const path = `scripts/test-fixtures/${dir}/README.md`
    const body = (await read(path)).toString()
    for (const link of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      assert.ok(!link[1].startsWith('/'), 'No private absolute links')
      await readFile(resolve(root, dirname(path), link[1]))
    }
    assert.match(body, /fixture-notice-map\.json/)
  }
  const p = JSON.parse(await read('scripts/test-fixtures/ui-blob-chain/source-provenance.json'))
  assert.equal(p.installedLicenseFileLocated, false)
  assert.equal(p.completeLicenseInventoryVerified, false)
  assert.equal(p.releaseLicenseAcceptance, false)
  assert.equal(p.officialVersionLicenseLocated, true)
  assert.equal(p.upstreamCommit, 'a2ec2889babf7d2295469c6d90ebe77fae57df84')
  assert.equal(p.officialLicenseSha256, noticePins['scripts/test-fixtures/ui-blob-chain/LICENSE'])
  assert.equal(p.officialLicenseUrl, `https://raw.githubusercontent.com/excalidraw/excalidraw/${p.upstreamCommit}/LICENSE`)
  assert.equal(p.officialPackageManifestSha256, '402f54fc7de128b25d22bd4d905fb46dbcdbe2ce6efee567d4da0fc79a29aab1')
})
