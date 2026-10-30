/** Requires the content-library adapter with normalizeLegacyKitImport wired in. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesignContentStore, contentNodeFs } from '../../core/lib/index.js'
import { createCompanionContentLibrary } from '../src/content-library.mjs'

const pin = { name: 'legacy_archive', version: '1.0' }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'companion-legacy-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const kitRoot = join(root, 'legacy')
  const bytes = {
    'mindset.md': '---\nname: legacy_archive\nversion: "1.0"\ndescription: Synthetic legacy Kit\n---\n<design_skills>\n## alpha\nAlpha method.\n</design_skills>\n',
    'LICENSE': 'Legacy Kit license\n', 'NOTICE': 'Legacy Kit notice\n',
    'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: Synthetic Bundle\n---\nOriginal method.\n',
    'skills/alpha/skill.yaml': 'name: alpha\nversion: "1.0"\ntitle: {en: Alpha, zh: Alpha}\nlabel: {en: Alpha, zh: Alpha}\npresentation: {mode: none}\nexecution: {handoff: none}\n',
    'skills/alpha/schema.yaml': 'type: object\nproperties:\n  summary: {type: string}\n',
    'skills/alpha/validation.yaml': 'skill: alpha\nrules:\n  - id: summary\n    scope: [completion]\n    code: alpha.summary\n    message: Required summary\n    check: {non_empty_string: summary}\n',
    'skills/alpha/reference/中文.md': 'Exact method\r\n',
    'skills/alpha/assets/image.bin': Buffer.from([0, 255, 128, 1]),
    'skills/alpha/LICENSE': 'Independent license\n',
    'skills/alpha/NOTICE': 'Independent notice\n',
    'skills/alpha/scripts/inert.mjs': 'throw new Error("must never execute")\n',
  }
  const files = []
  for (const [path, input] of Object.entries(bytes)) {
    const data = Buffer.from(input), target = join(kitRoot, path)
    await mkdir(join(target, '..'), {recursive:true}); await writeFile(target, data)
    files.push({path,base64:data.toString('base64'),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')})
  }
  const prepared = {validation:{valid:true},archive:{pin, files},contents:[{kind:'kit',pin,files}],executionGranted:false}
  const stateRoot = join(root,'state')
  const library = createCompanionContentLibrary({fs:contentNodeFs,kitRoot,stateRoot})
  return {root,kitRoot,stateRoot,prepared,library,bytes}
}

test('legacy adoption migrates through Core and repeated adoption reuses complete retained closure', async t => {
  const f = await fixture(t)
  const first = await f.library.adoptPrepared(f.prepared)
  assert.equal(first.executionGranted,false)
  assert.deepEqual(first.contents.map(item=>item.kind),['kit','bundle'])
  const kit = await f.library.store.loadRetainedKit(pin)
  const bundle = await f.library.store.resolveBundle({name:'alpha',version:'1.0'})
  const originalSource = bundle.sourceId, originalAuthority = bundle.skill.authority
  assert.ok(await readFile(join(kit.sourceRoot,'kit.yaml')))
  assert.ok(!(await readdir(kit.sourceRoot)).includes('skills'))
  for (const [path,bytes] of Object.entries(f.bytes)) {
    const root = path.startsWith('skills/alpha/') ? bundle.resourceRoot : kit.sourceRoot
    const local = path.replace(/^skills\/alpha\//,'')
    assert.deepEqual(await readFile(join(root,local)),Buffer.from(bytes))
  }
  assert.deepEqual(await f.library.adoptPrepared(f.prepared),first)
  const again = await f.library.store.resolveBundle({name:'alpha',version:'1.0'})
  assert.equal(again.sourceId,originalSource)
  assert.equal(again.skill.authority,originalAuthority)
  assert.equal((await f.library.store.listKits()).length,1)
  assert.equal((await f.library.store.listBundles()).length,1)
  assert.ok((await readdir(f.stateRoot)).every(name=>!name.startsWith('content-import-')))
})

test('legacy adoption reuses pre-existing Bundle provenance and rejects changed same-pin bytes', async t => {
  const f = await fixture(t)
  const store = new DesignContentStore(f.stateRoot)
  const before = await store.retainBundle(join(f.kitRoot,'skills/alpha'),{sourceId:'fixture:original-trusted-source'},{name:'alpha',version:'1.0'})
  await f.library.adoptPrepared(f.prepared)
  const after = await store.resolveBundle({name:'alpha',version:'1.0'})
  assert.equal(after.sourceId,before.sourceId)
  assert.equal(after.skill.authority,before.skill.authority)
  const changed = structuredClone(f.prepared)
  const file = changed.contents[0].files.find(file=>file.path==='skills/alpha/reference/中文.md')
  file.base64=Buffer.from('Conflicting bytes').toString('base64')
  await assert.rejects(f.library.adoptPrepared(changed),/Bundle conflicts/)
  assert.deepEqual(await readFile(join(after.resourceRoot,'reference/中文.md')),Buffer.from(f.bytes['skills/alpha/reference/中文.md']))
  assert.ok((await readdir(f.stateRoot)).every(name=>!name.startsWith('content-import-')))
})

test('legacy archive transport duplicates retain one exact independent Bundle closure', async t => {
  const f = await fixture(t)
  const owned = structuredClone(f.prepared.contents[0].files)
  const duplicates = owned.filter(file => file.path.startsWith('skills/alpha/')).map(file => ({ ...file,
    path: file.path.replace('skills/alpha/', 'bundles/alpha/1.0/') }))
  f.prepared.archive.dependencies = [{ name: 'alpha', version: '1.0' }]
  f.prepared.contents[0].files.push(...duplicates)
  const original = structuredClone(f.prepared)
  const result = await f.library.adoptPrepared(f.prepared)
  assert.deepEqual(f.prepared, original, 'the retained archive is not rewritten')
  assert.deepEqual(result.contents, [{ kind: 'kit', pin }, { kind: 'bundle', pin: { name: 'alpha', version: '1.0' } }])
  const kit = await f.library.store.loadRetainedKit(pin)
  const bundle = await f.library.store.resolveBundle({ name: 'alpha', version: '1.0' })
  assert.equal((await readdir(kit.sourceRoot)).includes('bundles'), false, 'reserved transport copies do not become Kit resources')
  for (const file of owned) {
    const target = file.path.startsWith('skills/alpha/') ? join(bundle.resourceRoot, file.path.slice('skills/alpha/'.length)) : join(kit.sourceRoot, file.path)
    assert.deepEqual(await readFile(target), Buffer.from(file.base64, 'base64'), file.path)
  }
  assert.deepEqual(await f.library.adoptPrepared(f.prepared), result)
  assert.ok((await readdir(f.stateRoot)).every(name => !name.startsWith('content-import-')))
})

test('legacy transport conflicts, partial trees and undeclared files cannot be silently discarded', async t => {
  const f = await fixture(t)
  const duplicates = f.prepared.contents[0].files.filter(file => file.path.startsWith('skills/alpha/')).map(file => ({ ...file,
    path: file.path.replace('skills/alpha/', 'bundles/alpha/1.0/') }))
  for (const variant of ['changed', 'partial', 'unknown']) {
    const prepared = structuredClone(f.prepared)
    prepared.archive.dependencies = [{ name: 'alpha', version: '1.0' }]
    const transport = structuredClone(duplicates)
    if (variant === 'changed') transport[0].base64 = Buffer.from('Conflicting transport bytes').toString('base64')
    if (variant === 'partial') transport.pop()
    if (variant === 'unknown') transport.push({ path: 'bundles/not-a-mount/notes.md', base64: Buffer.from('User-owned unknown content').toString('base64') })
    prepared.contents[0].files.push(...transport)
    await assert.rejects(f.library.adoptPrepared(prepared), /transport.*(match|declared|conflict|complete)/i, variant)
    assert.deepEqual(await f.library.store.listKits(), [])
    assert.deepEqual(await f.library.store.listBundles(), [])
    assert.ok((await readdir(f.stateRoot)).every(name => !name.startsWith('content-import-')))
  }
})
