import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { GitVersioning, gitBackendSetting } from '../src/git.ts'
import { executeNativeGit } from '../src/git-native.ts'
import { nodeDesignProjectSpawn } from '../src/design-project.ts'
import { DesignFilesStore, DesignWriteSettlementError } from '../src/design-files.ts'

const exec = promisify(execFile)
const fs = {
  readText: async p => { try { return await readFile(p, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e } },
  readBytes: async p => { try { return await readFile(p) } catch (e) { if (e.code !== 'ENOENT') throw e } },
  writeText: async (p,b) => { await mkdir(dirname(p), {recursive:true}); await writeFile(p,b) },
  writeBytes: async (p,b) => { await mkdir(dirname(p), {recursive:true}); await writeFile(p,b) },
  ensureDir: p => mkdir(p,{recursive:true}), removeFile: p => rm(p),
}
async function fixture(t, backend) {
  const root = await mkdtemp(join(tmpdir(),'yugoo-native-backend-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const command = (...argv)=>exec('git',argv,{cwd:root,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}})
  await command('init','--quiet')
  await mkdir(join(root,'design_files','sample'),{recursive:true})
  await writeFile(join(root,'notes.txt'),'base\n')
  await writeFile(join(root,'design_files','sample','run.sh'),'old\n')
  await writeFile(join(root,'design_files','sample','remove.bin'),'remove\n')
  await command('add','--','.')
  await command('update-index','--chmod=+x','--','design_files/sample/run.sh')
  await command('-c','user.name=test','-c','user.email=test@local','commit','--quiet','-m','base')
  let beforeNative, afterNative
  const nativeCalls=[]
  const spawn=Object.assign(request=>nodeDesignProjectSpawn(request),{native:async request=>{
    nativeCalls.push(request.operation)
    await beforeNative?.(request.operation)
    const result = await executeNativeGit(root,request.operation)
    return afterNative?.(request.operation,result) ?? result
  }})
  const git=new GitVersioning(spawn,root,'design_files',false,backend)
  return {root,command,git,nativeCalls,beforeNative:fn=>{beforeNative=fn},afterNative:fn=>{afterNative=fn},store:new DesignFilesStore(fs,git,join(root,'design_files'))}
}
const options = id => ({origin:'agent',publication:{skill:'sample',bundleVersion:'1.0',invocationId:id,stateStatus:'complete',handoff:'none',outcome:'complete'},settleEvent:async()=>{}})

for(const backend of ['cli','native']) {
  test(`${backend}: conflicting unlisted directory or parent facts cannot be replaced implicitly`,async t=>{
    const f=await fixture(t,backend),baseline=await f.git.head()
    await assert.rejects(f.git.commitExactReceipt('replace directory',new Map([['sample','replacement']]),baseline))
    assert.equal(await f.git.head(),baseline)
    await assert.rejects(f.git.commitExactReceipt('replace parent',new Map([['sample/run.sh/child','replacement']]),baseline))
    assert.equal(await f.git.head(),baseline)
    assert.equal(await f.git.readTextAt(baseline,'sample/run.sh'),'old\n')
    const replaced=await f.git.commitExactReceipt('explicit replacement',new Map([
      ['sample/run.sh',undefined],['sample/run.sh/child','replacement'],
    ]),baseline)
    assert.ok(replaced.commit)
    assert.equal(await f.git.readTextAt(replaced.commit,'sample/run.sh/child'),'replacement')
    assert.equal(await f.git.readTextAt(replaced.commit,'sample/remove.bin'),'remove\n')
  })

  test(`${backend}: exact raw publication retains modes, deletion and unrelated staging`,async t=>{
    const f=await fixture(t,backend)
    await writeFile(join(f.root,'notes.txt'),'external staged\n');await f.command('add','--','notes.txt')
    await writeFile(join(f.root,'notes.txt'),'external unstaged\n')
    const binary=Buffer.from([0,255,128,13,10,195,169])
    const receipt=await f.git.commitExactReceipt('exact',new Map([
      ['sample/run.sh','new\n'],['sample/remove.bin',undefined],['sample/中文 空白.bin',binary],
    ]),await f.git.head())
    assert.ok(receipt.commit);assert.equal(receipt.indexMaintenance,undefined)
    assert.deepEqual(Buffer.from(await f.git.readBytesAt(receipt.commit,'sample/中文 空白.bin')),binary)
    assert.equal(await f.git.readBytesAt(receipt.commit,'sample/remove.bin'),undefined)
    assert.match((await f.command('ls-tree',receipt.commit,'--','design_files/sample/run.sh')).stdout,/^100755 blob /)
    assert.equal((await f.command('show',':notes.txt')).stdout,'external staged\n')
    assert.equal(await readFile(join(f.root,'notes.txt'),'utf8'),'external unstaged\n')
    assert.equal(await f.git.readTextAt(receipt.commit,'sample/run.sh'),'new\n')
    const listed=await f.git.listPathsAt(receipt.commit)
    assert.ok(listed.includes('sample/中文 空白.bin'));assert.ok(!listed.includes('sample/remove.bin'))
  })

  test(`${backend}: Store event replay reuses exact commit and rejects changed canonical/artifact facts`,async t=>{
    const f=await fixture(t,backend)
    await writeFile(join(f.root,'.gitattributes'),'*.json text eol=crlf\n*.bin -text\n')
    await f.command('config','core.autocrlf','true')
    const input={...options('same-event'),artifacts:{'sample/data.bin':Buffer.from([0,255,13,10])},ownedArtifacts:['sample/data.bin']}
    const first=await f.store.write('sample',{label:'中文',value:1},input)
    const again=await f.store.write('sample',{label:'中文',value:1},input)
    assert.equal(first.commit,again.commit);assert.equal(await f.git.head(),first.commit)
    await assert.rejects(f.store.write('sample',{label:'中文',value:2},input),/reused with different bytes/)
    await assert.rejects(f.store.write('sample',{label:'中文',value:1},{...input,artifacts:{'sample/data.bin':Buffer.from([3])}}),/reused with different bytes/)
    await assert.rejects(f.store.write('sample',{label:'中文',value:1},{...input,artifacts:{},ownedArtifacts:[]}),/different artifact set/)
  })

  test(`${backend}: foreign index lock defers maintenance without revoking or duplicating publication`,async t=>{
    const f=await fixture(t,backend)
    const lock=join(f.root,'.git','index.lock');await writeFile(lock,'foreign owner\n')
    const first=await f.store.write('sample',{a:1},options('index-deferred'))
    assert.ok(first.commit);assert.equal(first.indexMaintenance?.state,'deferred')
    assert.equal(await f.git.head(),first.commit);assert.equal(await readFile(lock,'utf8'),'foreign owner\n')
    assert.equal((await f.store.write('sample',{a:1},options('index-deferred'))).commit,first.commit)
  })
}

test('native: external winner before publication is retained and no receipt is fabricated',async t=>{
  const f=await fixture(t,'native'),baseline=await f.git.head();let winner
  f.beforeNative(async op=>{
    if(op.kind!=='publish')return
    f.beforeNative(undefined)
    const tree=(await f.command('rev-parse',`${baseline}^{tree}`)).stdout.trim()
    winner=(await f.command('-c','user.name=external','-c','user.email=external@local','commit-tree',tree,'-p',baseline,'-m','external')).stdout.trim()
    await f.command('update-ref','HEAD',winner,baseline)
  })
  await assert.rejects(f.git.commitExactReceipt('loser',new Map([['sample/a.txt','new']]),baseline),/stale-publication/)
  assert.equal((await f.command('rev-parse','HEAD')).stdout.trim(),winner)
})

test('native: size and regular-file gates run before native blob capture',async t=>{
  const f=await fixture(t,'native')
  const first=await f.git.commitExactReceipt('blob',new Map([['sample/a.bin',Buffer.alloc(128)]]),await f.git.head())
  const prior=f.nativeCalls.filter(op=>op.kind==='blob').length
  await assert.rejects(f.git.readBytesAt(first.commit,'sample/a.bin',undefined,1),/exceeds 1 bytes/)
  assert.equal(f.nativeCalls.filter(op=>op.kind==='blob').length,prior)
  if(process.platform!=='win32'){
    await symlink('run.sh',join(f.root,'design_files','sample','link'))
    await f.command('add','--','design_files/sample/link')
    await f.command('-c','user.name=test','-c','user.email=test@local','commit','--quiet','-m','link')
    const head=await f.git.head()
    await assert.rejects(f.git.readBytesAt(head,'sample/link'),/not a regular file/)
    assert.equal(await f.git.readTextAt(head,'sample/link'),'run.sh')
    assert.ok((await f.git.listPathsAt(head)).includes('sample/link'))
  }
})

test('native: unchanged save, forced audit and pre-abort preserve their separate outcomes',async t=>{
  const f=await fixture(t,'native'),baseline=await f.git.head()
  assert.deepEqual(await f.git.commitExactReceipt('same',new Map([['sample/run.sh','old\n']]),baseline),{})
  assert.equal(await f.git.head(),baseline)
  const forced=await f.git.commitExactReceipt('audit',new Map(),baseline,undefined,true)
  assert.ok(forced.commit);assert.equal(forced.change,'unchanged')
  const calls=f.nativeCalls.length,abort=new AbortController();abort.abort()
  await assert.rejects(f.git.commitExactReceipt('cancel',new Map([['sample/a','x']]),forced.commit,abort.signal))
  assert.equal(f.nativeCalls.length,calls)
  await assert.rejects(f.git.commitExactReceipt('overlap',new Map([['sample/a','x'],['sample/a/b','y']]),forced.commit),/conflicting regular parent/)
})

test('native selection rejects unknown configuration and never falls back after a native capability failure',async()=>{
  assert.equal(gitBackendSetting('cli'),'cli');assert.equal(gitBackendSetting('native'),'native')
  assert.throws(()=>gitBackendSetting('automatic'),/must be cli or native/)
  let nativeCalls=0
  const spawn=Object.assign(async()=>assert.fail('native failure launched external Git'),{native:async()=>{
    nativeCalls++;throw new Error('native binding unavailable')
  }})
  const git=new GitVersioning(spawn,tmpdir(),undefined,false,'native')
  await assert.rejects(git.commitExactReceipt('x',new Map([['a','x']]),undefined),/native binding unavailable/)
  assert.equal(nativeCalls,1)
})

for(const view of ['loose-replace','packed-replace','grafts']) {
  test(`native: ${view} is explicitly refused before returning facts or publishing`,async t=>{
    const f=await fixture(t,'native'),baseline=await f.git.head()
    if(view==='grafts'){
      await mkdir(join(f.root,'.git','info'),{recursive:true})
      await writeFile(join(f.root,'.git','info','grafts'),`${baseline}\n`)
    }else{
      const tree=(await f.command('rev-parse',`${baseline}^{tree}`)).stdout.trim()
      const replacement=(await f.command('-c','user.name=test','-c','user.email=test@local','commit-tree',tree,'-m','replacement')).stdout.trim()
      await f.command('replace',baseline,replacement)
      if(view==='packed-replace')await f.command('pack-refs','--all')
    }
    await assert.rejects(f.git.head(),/unsupported-history/)
    await assert.rejects(f.git.listPathsAt(baseline),/unsupported-history/)
    await assert.rejects(f.git.commitExactReceipt('refused',new Map([['sample/new','must not land']]),baseline),/unsupported-history/)
    assert.equal((await f.command('rev-parse','HEAD')).stdout.trim(),baseline)
  })
}

test('native: linked worktree checks packed replacement refs in the common Git directory',async t=>{
  const f=await fixture(t,'native'),baseline=await f.git.head()
  const worktree=join(f.root,'linked-checkout')
  await f.command('worktree','add','--detach',worktree,baseline)
  const tree=(await f.command('rev-parse',`${baseline}^{tree}`)).stdout.trim()
  const replacement=(await f.command('-c','user.name=test','-c','user.email=test@local','commit-tree',tree,'-m','replacement')).stdout.trim()
  await f.command('replace',baseline,replacement);await f.command('pack-refs','--all')
  await assert.rejects(executeNativeGit(worktree,{kind:'head'}),/unsupported-history/)
})

test('native: history admission bounds metadata reads and refuses custom rewrite environment',async t=>{
  const f=await fixture(t,'native')
  await writeFile(join(f.root,'.git','packed-refs'),`#${'x'.repeat(2<<20)}\n`)
  await assert.rejects(executeNativeGit(f.root,{kind:'head'}),/unsupported-history/)
  await rm(join(f.root,'.git','packed-refs'))
  for(const name of ['GIT_REPLACE_REF_BASE','GIT_GRAFT_FILE']){
    const previous=process.env[name]
    try{
      process.env[name]='explicit-test-rewrite-view'
      await assert.rejects(executeNativeGit(f.root,{kind:'head'}),/unsupported-history/)
    }finally{
      if(previous===undefined)delete process.env[name];else process.env[name]=previous
    }
  }
})

test('native: confirmed publication survives scope invalidation without subsequent index mutation',async t=>{
  const f=await fixture(t,'native'),baseline=await f.git.head()
  const oldIndex=(await f.command('ls-files','--stage')).stdout
  f.afterNative((operation,result)=>operation.kind==='publish'
    ? {...result,publicationScopeInvalidated:true} : result)
  const receipt=await f.git.commitExactReceipt('known committed',new Map([['sample/new.txt','saved']]),baseline)
  assert.ok(receipt.commit);assert.equal(receipt.change,'changed')
  assert.equal(receipt.indexMaintenance?.state,'deferred')
  assert.match(receipt.indexMaintenance.message,/scope was invalidated/)
  assert.equal((await f.command('rev-parse','HEAD')).stdout.trim(),receipt.commit)
  assert.equal((await f.command('ls-files','--stage')).stdout,oldIndex)
  assert.equal((await f.command('show',`${receipt.commit}:design_files/sample/new.txt`)).stdout,'saved')
})

test('native: confirmed receipt reaches Store settlement recovery and exact retry never republishes',async t=>{
  const f=await fixture(t,'native');let fail=true,settled=0,receipt
  f.afterNative((operation,result)=>operation.kind==='publish'
    ? {...result,publicationScopeInvalidated:true} : result)
  const input={...options('native-known-commit-recovery'),settleEvent:async()=>{
    if(fail)throw new Error('injected scope settlement failure')
    settled++
  }}
  await assert.rejects(f.store.write('sample',{a:1},input),error=>{
    assert.ok(error instanceof DesignWriteSettlementError)
    receipt=error.result
    assert.ok(receipt.commit);assert.equal(receipt.recovery.stage,'journal')
    assert.equal(receipt.indexMaintenance.state,'deferred')
    return true
  })
  assert.equal((await f.command('rev-parse','HEAD')).stdout.trim(),receipt.commit)
  const published=f.nativeCalls.filter(operation=>operation.kind==='publish').length
  fail=false;f.afterNative(undefined)
  const recovered=await f.store.write('sample',{a:1},input)
  assert.equal(recovered.commit,receipt.commit);assert.equal(settled,1)
  assert.equal(f.nativeCalls.filter(operation=>operation.kind==='publish').length,published)
  assert.equal((await f.command('rev-list','--count','HEAD')).stdout.trim(),'2')
  await assert.rejects(f.store.write('sample',{a:2},input),/reused with different bytes/)
})
