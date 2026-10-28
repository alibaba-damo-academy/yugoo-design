import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installerMain } from '../src/npm-installer.mjs'

async function fixture(t, body) {
  const npmRoot = await mkdtemp(join(tmpdir(), 'embedding-cli-'))
  t.after(() => rm(npmRoot, { recursive: true, force: true }))
  const directory = join(npmRoot, 'payload/shared/knowledge')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'runtime.mjs'), body)
  await writeFile(join(directory, 'cli-lifecycle.mjs'), `export async function runStandaloneKnowledgeOperation({loadRuntime, run}) { return run(await loadRuntime()) }`)
  return npmRoot
}

test('help is available before reading a package, project, profile or runtime', async () => {
  const help = await installerMain(['prepare-embedding', '--help'])
  assert.equal(help.kind, 'embedding-preparation-help')
  assert.match(help.usage, /--allow-download.*--probe/)
  assert.ok(help.results['assets-ready'])
})

test('CLI uses only the acquired Knowledge entry and passes explicit download, cache, probe and cancellation', async t => {
  const npmRoot = await fixture(t, `export async function prepareLocalEmbedding(options) {
    return { status: options.probe ? 'ready' : 'assets-ready', options: { ...options, signal: options.signal?.aborted } }
  }`)
  const before = await readdir(npmRoot)
  const checked = await installerMain(['prepare-embedding'], { npmRoot })
  assert.deepEqual(checked, { status: 'assets-ready', options: { cacheDir: undefined, allowDownload: false, probe: false, signal: undefined } })
  const signal = AbortSignal.abort()
  const prepared = await installerMain(['prepare-embedding', '--embedding-cache', join(npmRoot, 'isolated-cache'), '--allow-download', '--probe'], { npmRoot, signal })
  assert.equal(prepared.status, 'ready')
  assert.deepEqual(prepared.options, { cacheDir: join(npmRoot, 'isolated-cache'), allowDownload: true, probe: true, signal: true })
  assert.deepEqual(await readdir(npmRoot), before)
})

test('CLI distinguishes runtime failure and rejects irrelevant, ambiguous or relative inputs', async t => {
  const npmRoot = await fixture(t, `throw Error('PRIVATE_URL?token=PRIVATE')`)
  const result = await installerMain(['prepare-embedding'], { npmRoot })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.reasonCode, 'runtime-unavailable')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/)
  for (const args of [['--host', 'codex'], ['--project', '/tmp/project'], ['other'], ['--embedding-cache', 'relative'], ['--allow-download=false']]) {
    await assert.rejects(installerMain(['prepare-embedding', ...args], { npmRoot }))
  }
})
