import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { Repository, Signature } from '../index.cjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'yugoo-native-header-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('headers distinguish empty, binary, tree, commit and missing objects without reading a JS blob', t => {
  const root = fixture(t)
  const repo = Repository.init(root)
  t.after(() => repo.free())
  const empty = repo.blob(Buffer.alloc(0))
  const bytes = Buffer.from([0, 255, 128, 42])
  const binary = repo.blob(bytes)
  repo.findBlob = () => { throw Error('The header API must not use the JS content accessor') }
  assert.deepEqual(repo.readObjectHeader(empty), { kind: 'blob', size: 0 })
  assert.deepEqual(repo.readObjectHeader(binary), { kind: 'blob', size: bytes.length })
  const builder = repo.treebuilder(null)
  builder.insert('binary.bin', binary, 0o100644)
  const tree = builder.write()
  const signature = Signature.now('Yugoo fixture', 'fixture@local')
  const commit = repo.commit('HEAD', signature, signature, 'header fixture\n', repo.findTree(tree), [])
  for (const [oid, kind] of [[tree, 'tree'], [commit, 'commit']]) {
    const expected = Number(execFileSync('git', ['cat-file', '-s', oid], { cwd: root }).toString())
    assert.deepEqual(repo.readObjectHeader(oid), { kind, size: expected })
  }
  assert.equal(repo.readObjectHeader('f'.repeat(40)), null)
  assert.throws(() => repo.readObjectHeader('not-an-oid'))
  repo.free()
  assert.throws(() => repo.readObjectHeader(binary))
})

test('packed blob headers agree with Git after ordinary repacking', t => {
  const root = fixture(t)
  let repo = Repository.init(root)
  const bytes = Buffer.alloc(4 << 20, 37)
  const oid = repo.blob(bytes)
  const builder = repo.treebuilder(null)
  builder.insert('sample.bin', oid, 0o100644)
  const tree = builder.write()
  const signature = Signature.now('Yugoo fixture', 'fixture@local')
  repo.commit('HEAD', signature, signature, 'packed fixture\n', repo.findTree(tree), [])
  repo.free()
  execFileSync('git', ['repack', '-a', '-d'], { cwd: root })
  repo = new Repository(root)
  t.after(() => repo.free())
  assert.deepEqual(repo.readObjectHeader(oid), { kind: 'blob', size: bytes.length })
  assert.equal(Number(execFileSync('git', ['cat-file', '-s', oid], { cwd: root }).toString()), bytes.length)
})

test('header-only access does not allocate a declared 512 MiB blob or need Git on PATH', t => {
  const root = fixture(t)
  const repo = Repository.init(root)
  repo.free()
  // Deliberately incomplete object: only its compressed header is present.
  // This checks admission metadata without claiming body/hash validity.
  const oid = '1'.repeat(40)
  mkdirSync(join(root, '.git/objects/11'), { recursive: true })
  writeFileSync(join(root, '.git/objects/11', oid.slice(2)), deflateSync(Buffer.from(`blob ${512 << 20}\0`)))
  const loader = new URL('../index.cjs', import.meta.url).href
  const script = `import {Repository} from ${JSON.stringify(loader)};
    const repo=new Repository(${JSON.stringify(root)});
    const before=process.memoryUsage().rss;
    const header=repo.readObjectHeader(${JSON.stringify(oid)});
    console.log(JSON.stringify({header,rssDelta:process.memoryUsage().rss-before})); repo.free();`
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, env: { ...process.env, PATH: '' }, timeout: 10_000,
  }).toString())
  assert.deepEqual(result.header, { kind: 'blob', size: 512 << 20 })
  assert.ok(result.rssDelta < 64 << 20, JSON.stringify(result))
})
