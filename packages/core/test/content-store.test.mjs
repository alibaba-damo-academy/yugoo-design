import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, writeFile, rm, symlink, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { writeContentCatalog } from './fixtures/content-catalog.mjs'
const { register } = await import('tsx/esm/api'); register()
const { DesignContentStore, contentNodeFs } = await import('../src/content-store.ts')
const { loadDesignKit, loadDesignBundle, createDirectoryBundleResolver, parseKitMounts } = await import('../src/kit-loader.ts')
const { default: DesignService } = await import('../src/design-service.ts')
const { DesignBundleContributionRegistry } = await import('../src/runtime-drivers.ts')
const { createSkillScriptPort } = await import('../src/dsh-design-execution-plugin.ts')
const { compileSchema } = await import('../src/schema.ts')

function resourceProjectionFixture() {
  const root = resolve('/virtual-resource-bundle')
  const files = new Map(Object.entries({
    'SKILL.md': '---\nname: alpha\ndescription: Resource fixture\n---\nRead original resources.\n',
    'skill.yaml': 'name: alpha\nversion: "1.0"\ntitle: {en: Alpha, zh: Alpha}\nlabel: {en: Alpha, zh: Alpha}\npresentation: {mode: none}\nexecution: {handoff: none}\n',
    'schema.yaml': 'type: object\nproperties:\n  summary: {type: string}\n',
    'validation.yaml': 'skill: alpha\nrules:\n  - id: summary\n    scope: [completion]\n    code: summary\n    message: Required\n    check: {non_empty_string: summary}\n',
    'assets.bin/notes.md': 'A directory name is not an opaque file.\r\n',
  }).map(([path, text]) => [resolve(root, path), Buffer.from(text)]))
  const binary = resolve(root, 'reference/sample.bin')
  files.set(binary, Buffer.from([0, 255, 128, 42]))
  const children = path => [...new Set([...files.keys()].filter(file => file.startsWith(`${path}/`))
    .map(file => file.slice(path.length + 1).split('/')[0]))]
  const projected = []
  const fs = {
    async readText(path) { const bytes = files.get(path); return bytes === undefined ? undefined : new TextDecoder('utf-8', { fatal: true }).decode(bytes) },
    async readResource(path) {
      projected.push(path)
      const bytes = files.get(path)
      return bytes === undefined ? undefined : path === binary ? { kind: 'opaque', byteLength: bytes.length }
        : { kind: 'text', content: await fs.readText(path) }
    },
    async listDir(path) { return children(path) },
    async isDirectory(path) { return children(path).length > 0 },
    async realPath(path) { return path },
  }
  return { root, files, binary, fs, projected, load: (port = fs) => loadDesignBundle(port, { rootDir: root, sourceId: 'fixture:resource-projection' }) }
}

test('optional resource projection retains complete traversal and confines opaque files without creating text', async () => {
  const f = resourceProjectionFixture(), bundle = await f.load()
  assert.deepEqual(await f.fs.listDir(resolve(f.root, 'reference')), ['sample.bin'])
  assert.ok(f.projected.includes(f.binary))
  assert.equal(Object.hasOwn(bundle.resources, 'reference/sample.bin'), false)
  assert.equal(bundle.resources['assets.bin/notes.md'], 'A directory name is not an opaque file.\n')
  const { readResource, ...legacy } = f.fs
  await assert.rejects(f.load(legacy), /utf-8/, 'old adapters keep their original text-read behavior')
  await assert.rejects(f.load({ ...f.fs, realPath: async path => path === f.binary ? resolve('/outside.bin') : path }), /escapes Bundle root/)
})

test('opaque resources count their full byte length against the same cumulative resource budget', async () => {
  const f = resourceProjectionFixture()
  const textBytes = [...f.files].filter(([path]) => path !== f.binary).reduce((sum, [, bytes]) => sum + bytes.length, 0)
  f.files.set(f.binary, Buffer.alloc(16 * 1024 * 1024 - textBytes))
  assert.ok(await f.load(), 'exact total byte limit is permitted')
  f.files.set(f.binary, Buffer.alloc(16 * 1024 * 1024 - textBytes + 1))
  await assert.rejects(f.load(), /Bundle resources exceed .* bytes/)
  for (const byteLength of [-1, NaN, Infinity]) {
    await assert.rejects(f.load({ ...f.fs, readResource: async path => path === f.binary
      ? { kind: 'opaque', byteLength } : f.fs.readResource(path) }), /invalid Bundle resource byte length/)
  }
})

test('required method and definition slots cannot be bypassed by an opaque resource claim', async () => {
  for (const slot of ['SKILL.md', 'skill.yaml', 'schema.yaml', 'validation.yaml']) {
    const f = resourceProjectionFixture(), path = resolve(f.root, slot)
    f.files.set(path, Buffer.concat([f.files.get(path), Buffer.from([255])]))
    await assert.rejects(f.load({ ...f.fs, readResource: async resource => resource === path
      ? { kind: 'opaque', byteLength: f.files.get(path).length } : f.fs.readResource(resource) }), /utf-8/)
  }
  const f = resourceProjectionFixture()
  const manifest = resolve(f.root, 'skill.yaml')
  const locale = resolve(f.root, 'locales/en-US.json')
  f.files.set(locale, Buffer.from([255]))
  f.files.set(manifest, Buffer.from(f.files.get(manifest).toString().replace('mode: none', 'mode: declarative')))
  f.files.set(resolve(f.root, 'panel.yaml'), Buffer.from(stringify({ version: 1, panel_kind: 'document', sections: [], fields: [],
    i18n: { default_locale: 'en-US', locales: { 'en-US': 'locales/en-US.json' } },
    ui: { component: 'stack', id: 'alpha', children: [{ component: 'text_block', id: 'guide', text: 'Guide' }] },
  })))
  await assert.rejects(f.load({ ...f.fs, readResource: async path => path === locale
    ? { kind: 'opaque', byteLength: 1 } : f.fs.readResource(path) }), /utf-8/, 'explicit locale reads cannot be bypassed by an opaque resource claim')
})

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'independent-content-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const original = join(root, 'original')
  const source = await writeContentCatalog(original)
  const kit = await loadDesignKit(contentNodeFs, original, { sourceId: 'package:original' })
  const bundles = join(root, 'bundles')
  await cp(join(original, 'bundles'), bundles, { recursive: true })
  const sourceId = 'package:original'
  const resolver = createDirectoryBundleResolver(contentNodeFs, [{ rootDir: bundles, sourceId }])
  const kitRoot = join(root, 'kit')
  await cp(source.kitRoot, kitRoot, { recursive: true })
  await writeFile(join(kitRoot, 'kit.yaml'), stringify({ version: 1, mounts: kit.skills.map(s => ({bindingKey:s.name,name:s.name,version:String(s.version)})) }))
  return { root, original, kitRoot, bundles, kit, sourceId, resolver, options: {sourceId,resolveBundle:resolver} }
}

test('independent mounts preserve original compilation, resources and authority', async t => {
  const f = await fixture(t)
  const compiled = await loadDesignKit(contentNodeFs, f.kitRoot, f.options)
  assert.equal(compiled.name, f.kit.name)
  assert.deepEqual(compiled.resources, f.kit.resources)
  for (let i=0;i<compiled.skills.length;i++) {
    const {resourceRoot: _a,...actual}=compiled.skills[i], {resourceRoot: _b,...expected}=f.kit.skills[i]
    assert.deepEqual(actual,expected)
  }
  const first=compiled.skills[0]
  assert.equal(first.resourceRoot,join(f.bundles,first.name))
  assert.equal(await f.resolver({name:first.name,version:'99.99'}),undefined)
})

test('retains bytes and complete closure across restart and deleted editable Kit sources', async t => {
  const f=await fixture(t), store=new DesignContentStore(join(f.root,'state'))
  const first=f.kit.skills[0]
  await writeFile(join(f.bundles,first.name,'image.bin'),Buffer.from([0,255,128,13,10]))
  const retained=await store.retainKitClosure(f.kitRoot,f.options)
  const secondRoot=join(f.root,'second-kit')
  await cp(f.kitRoot,secondRoot,{recursive:true})
  await writeFile(join(secondRoot,'mindset.md'),(await readFile(join(secondRoot,'mindset.md'),'utf8')).replace('name: catalog_fixture','name: second_kit'))
  await store.retainKitClosure(secondRoot,f.options)
  await rm(f.kitRoot,{recursive:true}); await rm(f.bundles,{recursive:true})
  const restarted=new DesignContentStore(join(f.root,'state'))
  const reopened=await restarted.loadRetainedKit({name:retained.name,version:String(retained.version)})
  assert.equal(reopened.skills.length,2)
  assert.equal((await restarted.loadRetainedKit({name:'second_kit',version:String(retained.version)})).skills.length,2)
  const bundle=await restarted.resolveBundle({name:first.name,version:String(first.version)})
  assert.deepEqual(await readFile(join(bundle.resourceRoot,'image.bin')),Buffer.from([0,255,128,13,10]))
  assert.equal(bundle.skill.authority,first.authority)
  assert.equal(await restarted.resolveBundle({name:first.name,version:'99.99'}),undefined)
  assert.equal((await restarted.listBundles()).length,2)
})

test('same pin different bytes is rejected atomically and old closure remains usable',async t=>{
  const f=await fixture(t), store=new DesignContentStore(join(f.root,'state'))
  await store.retainKitClosure(f.kitRoot,f.options)
  const first=f.kit.skills[0], path=join(f.bundles,first.name,'SKILL.md')
  await writeFile(path,(await readFile(path,'utf8'))+'\nChanged method.\n')
  await assert.rejects(store.retainKitClosure(f.kitRoot,f.options),/immutable.*pin conflict/)
  const reopened=await new DesignContentStore(join(f.root,'state')).loadRetainedKit({name:f.kit.name,version:String(f.kit.version)})
  assert.equal(reopened.skills[0].content,f.kit.skills[0].content)
  assert.equal((await store.listBundles()).length,2)
})

test('unsafe mounts, missing exact version and symlink resources fail without publication',async t=>{
  const f=await fixture(t), store=new DesignContentStore(join(f.root,'state'))
  assert.throws(()=>parseKitMounts('version: 1\nmounts: [{bindingKey: x, name: ../x, version: "0.1"}]'),/unsafe/)
  const first=f.kit.skills[0]
  await symlink(join(f.root,'kit','mindset.md'),join(f.bundles,first.name,'escaped.txt'))
  await assert.rejects(store.retainKitClosure(f.kitRoot,f.options),/escapes|symlink/)
  assert.deepEqual(await store.listBundles(),[])
  assert.deepEqual(await store.listKits(),[])
})

test('package root entry discovers separated content without host-specific resolver duplication',async t=>{
  const f=await fixture(t)
  await writeFile(join(f.root,'package.json'),JSON.stringify({designSystem:{kit:{root:'./kit',mindset:'./kit/mindset.md',manifest:'./kit/kit.yaml',bundles:'./bundles'}}}))
  const loaded=await loadDesignKit(contentNodeFs,f.root,{sourceId:f.sourceId})
  assert.equal(loaded.skills.length,2)
  assert.equal(loaded.sourceRoot,f.kitRoot)
  const store=new DesignContentStore(join(f.root,'state'))
  assert.equal((await store.retainKitClosure(f.root,{sourceId:f.sourceId})).skills.length,2)
})

test('standalone Bundle and independent Kit retain their complete license and notice files',async t=>{
  const f=await fixture(t), store=new DesignContentStore(join(f.root,'state'))
  const first=f.kit.skills[0], pin={name:first.name,version:String(first.version)}
  const bundle=await store.retainBundle(join(f.bundles,first.name),{sourceId:f.sourceId},pin)
  assert.equal(bundle.skill.authority,first.authority)
  assert.deepEqual(await store.listKits(),[])
  assert.equal((await new DesignContentStore(join(f.root,'state')).resolveBundle(pin)).skill.name,first.name)
  for (const name of ['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md']) {
    assert.deepEqual(await readFile(join(bundle.resourceRoot,name)),await readFile(join(f.original,name)))
  }
  await store.retainKitClosure(f.original,{sourceId:f.sourceId})
  const reopened=await store.loadRetainedKit({name:f.kit.name,version:String(f.kit.version)})
  assert.equal(await readFile(join(reopened.sourceRoot,'LICENSE'),'utf8'),await readFile(join(f.original,'LICENSE'),'utf8'))
  assert.equal(await readFile(join(reopened.sourceRoot,'NOTICE'),'utf8'),await readFile(join(f.original,'NOTICE'),'utf8'))
  assert.deepEqual(await readFile(join(reopened.sourceRoot,'THIRD_PARTY_NOTICES.md')),await readFile(join(f.original,'THIRD_PARTY_NOTICES.md')))
})

test('custom Kit entry paths remain exact and reopen after editable sources are removed',async t=>{
  const f=await fixture(t), store=new DesignContentStore(join(f.root,'state'))
  await mkdir(join(f.kitRoot,'docs')); await mkdir(join(f.kitRoot,'spec'))
  const mindsetPath=join(f.kitRoot,'docs','method.md'), manifestPath=join(f.kitRoot,'spec','mounts.yaml')
  await rename(join(f.kitRoot,'mindset.md'),mindsetPath)
  await rename(join(f.kitRoot,'kit.yaml'),manifestPath)
  const mindsetBytes=await readFile(mindsetPath), manifestBytes=await readFile(manifestPath)
  const location={rootDir:f.kitRoot,mindsetPath,manifestPath,skillsDir:f.bundles,bundlesDir:f.bundles}
  const retained=await store.retainKitClosure(location,f.options)
  await rm(f.kitRoot,{recursive:true}); await rm(f.bundles,{recursive:true})
  const reopened=await new DesignContentStore(join(f.root,'state')).loadRetainedKit({name:f.kit.name,version:String(f.kit.version)})
  assert.equal(reopened.skills.length,2)
  assert.deepEqual(await readFile(join(reopened.sourceRoot,'docs','method.md')),mindsetBytes)
  assert.deepEqual(await readFile(join(reopened.sourceRoot,'spec','mounts.yaml')),manifestBytes)
  assert.deepEqual(reopened.resources,retained.resources)
  const indexFile=join(store.root,'index.json'), index=JSON.parse(await readFile(indexFile,'utf8'))
  index.kits[0].kitPaths.mindset='../escape.md'
  await writeFile(indexFile,JSON.stringify(index))
  await assert.rejects(store.loadRetainedKit({name:f.kit.name,version:String(f.kit.version)}),/escapes retained root/)
})

test('independent catalog and retained pin survive Kit source disposal; scripts use the retained Bundle root',async t=>{
  const f=await fixture(t), store=new DesignContentStore(join(f.root,'state'))
  const first=f.kit.skills[0], pin={name:first.name,version:String(first.version)}
  await mkdir(join(f.bundles,first.name,'scripts'),{recursive:true})
  await writeFile(join(f.bundles,first.name,'scripts','ok.mjs'),'process.stdout.write("ok")\n')
  const retained=await store.retainKitClosure(f.kitRoot,f.options), bundle=await store.resolveBundle(pin)
  const design=Object.create(DesignService.prototype)
  design.kits=new Map(); design.retainedKits=new Map(); design.independentBundles=new Map()
  design.contributions=new DesignBundleContributionRegistry()
  design.registerBundleContent(bundle, {retained: true})
  design.registerRetainedKit(retained)
  const publisher=design.registerKitSource(await loadDesignKit(contentNodeFs,f.kitRoot,f.options))
  const editable=await loadDesignBundle(contentNodeFs,{rootDir:join(f.bundles,first.name),sourceId:f.sourceId},pin)
  design.registerBundleContent(editable)
  assert.equal(design.resolveBundleRoot(pin),bundle.resourceRoot,'retained root wins over editable same pin')
  assert.throws(()=>design.registerBundleContent({...editable,resources:{...editable.resources,'changed.txt':'different'}}),/immutable Bundle version conflict/)
  assert.equal(design.listBundles().length,2,'independent catalog does not hide legacy Kit Bundles')
  assert.equal(new Set(design.listBundles().map(skill=>`${skill.catalogName??skill.name}@${skill.version}`)).size,2)
  await rm(f.bundles,{recursive:true})
  publisher.dispose()
  assert.equal(design.listKits().length,1,'validated retained versions remain in the installed catalog after source disposal')
  assert.equal(design.listBundles()[0].name,first.name)
  assert.equal(design.resolveKit({kit:f.kit.name,version:f.kit.version}),retained)
  assert.equal(design.resolveBundleRoot(pin),bundle.resourceRoot)
  let invocation
  const subprocess={spawn(request){invocation=request;return {done:Promise.resolve({exitCode:0}),collected:{stdout:{readFrom:()=>({text:'ok',lossy:false})},stderr:{readFrom:()=>({text:'',lossy:false})}}}}}
  const port=createSkillScriptPort({sourceRoot:'/nonexistent-kit'},bundle.skill,subprocess)
  await port.run('ok.mjs',[],'',new AbortController().signal)
  assert.equal(invocation.argv[1],join(bundle.resourceRoot,'scripts','ok.mjs'))
  await assert.rejects(port.run('../skill.yaml',[],'',new AbortController().signal),/escapes/)
})

test('the current Research release coexists with retained 1.0 content and its Kit mounts only the new exact version', async t => {
  const root = await mkdtemp(join(tmpdir(), 'research-version-coexistence-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const packageRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
  const sourceRoot = join(packageRoot, 'bundles/research'), sourceId = 'package:dsh-design-skills-web-app'
  const store = new DesignContentStore(join(root, 'state'))
  // Synthetic previous content, isolated from any real profile or imported tree.
  const oldRoot = join(root, 'old-research')
  await cp(sourceRoot, oldRoot, { recursive: true })
  const manifest = parse(await readFile(join(oldRoot, 'skill.yaml'), 'utf8'))
  manifest.version = '1.0'
  await writeFile(join(oldRoot, 'skill.yaml'), stringify(manifest))
  await writeFile(join(oldRoot, 'SKILL.md'), (await readFile(join(oldRoot, 'SKILL.md'), 'utf8')) + '\nRetained historical method fixture.\n')
  const oldPin = { name: 'research', version: '1.0' }, newPin = { name: 'research', version: '1.1' }
  const retained = await store.retainBundle(oldRoot, { sourceId }, oldPin)
  const previousMethod = await readFile(join(retained.resourceRoot, 'SKILL.md'))
  const previousEntry = JSON.parse(await readFile(join(store.root, 'index.json'), 'utf8')).bundles[0]
  const released = await store.retainBundle(sourceRoot, { sourceId }, newPin)
  assert.notEqual(released.skill.content, retained.skill.content)
  assert.equal(released.skill.authority, retained.skill.authority, 'authority is stable while versions distinguish immutable content')
  const preview = JSON.parse(released.resources['reference/preview.json'])
  assert.deepEqual(compileSchema(released.skill.metadata.schemaDocument)(preview), [], 'the released nonempty example still matches its existing schema')

  const reopened = new DesignContentStore(join(root, 'state'))
  const oldContent = await reopened.resolveBundle(oldPin), newContent = await reopened.resolveBundle(newPin)
  assert.deepEqual(await readFile(join(oldContent.resourceRoot, 'SKILL.md')), previousMethod)
  assert.deepEqual(JSON.parse(await readFile(join(store.root, 'index.json'), 'utf8')).bundles.find(pin => pin.version === '1.0'), previousEntry)
  const design = Object.create(DesignService.prototype)
  design.kits = new Map(); design.independentBundles = new Map()
  design.registerBundleContent(oldContent, { retained: true })
  design.registerBundleContent(newContent, { retained: true })
  assert.deepEqual(design.listBundles().map(skill => `${skill.name}@${skill.version}`), ['research@1.0', 'research@1.1'])
  assert.equal(design.resolveBundle(oldPin), oldContent)
  assert.equal(design.resolveBundle(newPin), newContent)
  assert.throws(() => design.registerBundleContent({ ...newContent, skill: { ...newContent.skill, version: '1.0' } }), /immutable Bundle version conflict/, 'a version collision still fails')

  const kit = await loadDesignKit(contentNodeFs, packageRoot, { sourceId })
  assert.equal(kit.version, '1.2')
  assert.equal(kit.skills.find(skill => skill.name === 'research').version, '1.1')
  assert.equal(kit.skills.find(skill => skill.name === 'flow_design').version, '1.1')
  assert.ok(kit.skills.filter(skill => !['research', 'flow_design'].includes(skill.name)).every(skill => skill.version === '1.0'))
  assert.ok(kit.resources['research/reference/artifact-contract.md'])
})

test('fork catalog identity preserves runtime name, method and data paths but cannot inherit authority',async t=>{
  const f=await fixture(t), first=f.kit.skills[0], forkName='local_fork'
  const forkRoot=join(f.bundles,forkName)
  await cp(join(f.bundles,first.name),forkRoot,{recursive:true})
  const file=join(forkRoot,'skill.yaml'), manifest=parse(await readFile(file,'utf8'))
  manifest.identity=forkName
  await writeFile(file,stringify(manifest))
  const fork=await loadDesignBundle(contentNodeFs,{rootDir:forkRoot,sourceId:f.sourceId},{name:forkName,version:String(first.version)})
  assert.equal(fork.skill.name,first.name)
  assert.equal(fork.skill.catalogName,forkName)
  assert.equal(fork.skill.content,first.content)
  assert.notEqual(fork.skill.authority,first.authority)
  const mounts=f.kit.skills.map(s=>({bindingKey:s.name,name:s.name===first.name?forkName:s.name,version:String(s.version)}))
  await writeFile(join(f.kitRoot,'kit.yaml'),stringify({version:1,mounts}))
  const loaded=await loadDesignKit(contentNodeFs,f.kitRoot,f.options)
  assert.equal(loaded.skills[0].name,first.name)
  assert.equal(loaded.skills[0].catalogName,forkName)
  assert.deepEqual(loaded.resources,f.kit.resources)
  const store=new DesignContentStore(join(f.root,'state'))
  await store.retainKitClosure(f.kitRoot,f.options)
  const reopened=await new DesignContentStore(join(f.root,'state')).loadRetainedKit({name:f.kit.name,version:String(f.kit.version)})
  assert.equal(reopened.skills[0].catalogName,forkName)
  assert.equal((await store.resolveBundle({name:forkName,version:String(first.version)})).skill.name,first.name)
  mounts[0].bindingKey='changed_runtime'
  await writeFile(join(f.kitRoot,'kit.yaml'),stringify({version:1,mounts}))
  await assert.rejects(loadDesignKit(contentNodeFs,f.kitRoot,f.options),/catalog differs|preserve/)
})

test('independent identity declarations obey the existing authority namespace',async t=>{
  const f=await fixture(t), first=f.kit.skills[0], root=join(f.bundles,first.name)
  const file=join(root,'skill.yaml'), manifest=parse(await readFile(file,'utf8'))
  for (const identity of ['alpha.fork','alpha-fork','Alpha_fork','1alpha_fork']) {
    await writeFile(file,stringify({...manifest,identity}))
    await assert.rejects(loadDesignBundle(contentNodeFs,{rootDir:root,sourceId:f.sourceId}),/invalid independent identity/)
  }
  await writeFile(file,stringify({...manifest,identity:'alpha_fork'}))
  assert.equal((await loadDesignBundle(contentNodeFs,{rootDir:root,sourceId:f.sourceId})).skill.catalogName,'alpha_fork')
})
