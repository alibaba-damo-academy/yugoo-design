/** Built DSH adapter acceptance; the filesystem capability is isolated and in-memory. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { loadDesignBundle } from 'dsh-design-core/kit'
import DshStudioManagementService from '../lib/index.js'

function memoryFs(seed, aliases = {}) {
  const files = new Map(Object.entries(seed)), directories = new Set()
  for (const path of files.keys()) {
    const parts = path.split('/')
    for (let i=1;i<parts.length;i++) directories.add(parts.slice(0,i).join('/'))
  }
  const error = code => Object.assign(new Error(code), {code})
  const target = path => ({targetKey: aliases[path] ?? path})
  return {
    files,
    async resolve(path) {
      if (!files.has(path) && !directories.has(path)) throw error('FS_NOT_FOUND')
      return target(path)
    },
    async stat(t) { return files.has(t.targetKey) ? {type:'file'} : directories.has(t.targetKey) ? {type:'directory'} : undefined },
    async readText(t) {
      if (!files.has(t.targetKey)) throw error('FS_NOT_FOUND')
      const value=files.get(t.targetKey)
      if (typeof value !== 'string') throw error('FS_NOT_TEXT')
      return value
    },
    async listDir(t) {
      const prefix=t.targetKey+'/', names=new Set()
      for (const path of [...files.keys(),...directories]) if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split('/')[0])
      return [...names].sort().map(name=>{
        const path=prefix+name
        return {name,type:directories.has(path)?'directory':'file',target:target(path)}
      })
    },
    contains(parent,child) { return child.targetKey===parent.targetKey || child.targetKey.startsWith(parent.targetKey+'/') },
  }
}

function bundleFiles(root, version='1.0', identity='fork_alpha') {
  return {
    [root+'/SKILL.md']:'---\nname: alpha\ndescription: Alpha method.\n---\n\nKeep alpha/alpha.json paths.\n',
    [root+'/skill.yaml']:`name: alpha\nidentity: ${identity}\nversion: "${version}"\ntitle: {zh: Alpha, en: Alpha}\nlabel: {zh: Alpha, en: Alpha}\nexecution: {handoff: none}\npresentation: {mode: none}\n`,
    [root+'/schema.yaml']:'type: object\nproperties:\n  summary: {type: string}\n',
    [root+'/validation.yaml']:'skill: alpha\nrules:\n  - id: summary\n    scope: [completion]\n    code: alpha.summary\n    message: Required\n    check: {non_empty_string: summary}\n',
    [root+'/guide.md']:version+' retained bytes\n',
  }
}

async function fixture(t, {config={followInstalledSources:true}, aliases={}}={}) {
  const retained='/retained/fork_alpha/1.0', newer='/installed/fork_alpha/2.0'
  const fs=memoryFs({...bundleFiles(retained),...bundleFiles(newer,'2.0'),
    [retained+'/image.bin']:new Uint8Array([255]),
    [retained+'/escape.md']:'not readable', '/outside/secret.md':'secret',
  }, aliases)
  const loader={readText:async path=>{
      const value=fs.files.get(path)
      return typeof value==='string'?value:value===undefined?undefined:Buffer.from(value).toString('utf8')
    },
    listDir:async path=>(await fs.listDir({targetKey:path})).map(entry=>entry.name)}
  const original=await loadDesignBundle(loader,{rootDir:retained,sourceId:'package:trusted'})
  const second=await loadDesignBundle(loader,{rootDir:newer,sourceId:'package:trusted'})
  let bundles=[original.skill], roots=new Map([['fork_alpha@1.0',retained],['fork_alpha@2.0',newer]])
  let snapshots=0
  const design={listKits:()=>[],listBundles:()=>{snapshots++;return bundles},resolveBundleRoot:pin=>roots.get(pin.name+'@'+pin.version)}
  const ctx=new Context(); ctx.provide('design',design); ctx.provide('fs',fs)
  const fiber=ctx.plugin(DshStudioManagementService,config); await fiber
  t.after(()=>fiber.dispose())
  return {service:ctx.get('studioManagement'),fiber,fs,retained,newer,original,
    setBundles:value=>{bundles=value},second,setRoots:value=>{roots=value},snapshots:()=>snapshots}
}

test('unmounted fork catalog identity reads exact retained root without a Kit or provider grant',async t=>{
  const f=await fixture(t)
  const catalog=await f.service.workspace('')
  assert.deepEqual(catalog.kits,[])
  assert.equal(catalog.bundles[0].name,'fork_alpha')
  assert.equal(f.original.skill.name,'alpha')
  const before=f.snapshots(), result=await f.service.readBundleWorkspace('fork_alpha','1.0')
  assert.equal(f.snapshots()-before,1,'one independent catalog snapshot owns a source read')
  assert.deepEqual(result.diagnostics,[])
  assert.equal(result.workspace.name,'fork_alpha')
  assert.equal(result.workspace.kit,undefined)
  assert.equal((await f.service.readBundleFile('fork_alpha','guide.md','1.0')).file.content,'1.0 retained bytes\n')
  assert.equal((await f.service.readBundleWorkspace('alpha','1.0')).diagnostics[0].code,'bundle.missing')
})

test('multiple versions require an exact pin and legacy compiled resourceRoot remains a bounded fallback',async t=>{
  const f=await fixture(t)
  f.setBundles([f.original.skill,f.second.skill])
  assert.equal((await f.service.readBundleWorkspace('fork_alpha')).diagnostics[0].code,'studio.ambiguous_version')
  assert.equal((await f.service.readBundleFile('fork_alpha','guide.md','2.0')).file.content,'2.0 retained bytes\n')
  assert.equal((await f.service.readBundleWorkspace('fork_alpha','9.9')).diagnostics[0].code,'bundle.missing')
  f.setRoots(new Map())
  assert.equal((await f.service.readBundleFile('fork_alpha','guide.md','1.0')).file.content,'1.0 retained bytes\n')
  f.setBundles([{...f.original.skill,resourceRoot:'/missing/root'}])
  assert.equal((await f.service.readBundleWorkspace('fork_alpha','1.0')).diagnostics[0].code,'studio.source_unavailable')
})

test('Core resolved retained root wins over an editable definition root',async t=>{
  const f=await fixture(t)
  f.setBundles([{...f.original.skill,resourceRoot:'/deleted/editable/root'}])
  assert.equal((await f.service.readBundleFile('fork_alpha','guide.md','1.0')).file.content,'1.0 retained bytes\n')
})

test('file reads reject traversal, escaping resolved targets and binary without leaking sibling resources',async t=>{
  const root='/retained/fork_alpha/1.0', f=await fixture(t,{aliases:{[root+'/escape.md']:'/outside/secret.md'}})
  assert.equal((await f.service.readBundleFile('fork_alpha','../secret.md','1.0')).diagnostics[0].code,'bundle_file.path_forbidden')
  const escaped=await f.service.readBundleFile('fork_alpha','escape.md','1.0')
  assert.equal(escaped.file,undefined)
  // Escaping targets are excluded from the physical tree before the shared file locator reads them.
  assert.equal(escaped.diagnostics[0].code,'bundle_file.missing')
  assert.equal((await f.service.readBundleFile('fork_alpha','image.bin','1.0')).diagnostics[0].code,'bundle_file.binary')
  const result=await f.service.readBundleWorkspace('fork_alpha','1.0')
  assert.ok(!result.workspace.files.some(file=>file.path==='escape.md'||file.path==='image.bin'))
})

test('catalog visibility never enables source reads without explicit followInstalledSources',async t=>{
  const f=await fixture(t,{config:{}})
  assert.equal((await f.service.workspace('')).bundles[0].name,'fork_alpha')
  assert.equal((await f.service.readBundleFile('fork_alpha','guide.md','1.0')).diagnostics[0].code,'studio.source_not_configured')
  await f.fiber.dispose()
  await assert.rejects(f.service.workspace(''),/disposing/)
})
