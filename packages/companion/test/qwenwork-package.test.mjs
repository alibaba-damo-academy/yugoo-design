import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { configureQwenWorkPackage, validateQwenWorkRuntime, packageQwenWorkExpertKit, qwenWorkConnectorConfiguration, qwenWorkNativeExecutionReference } from '../qwenwork-package.mjs'
test('Qwen reference preserves shared Host qualifiers instead of renaming another Host protocol', async () => {
 const shared=await readFile(new URL('../plugin/design-system/skills/design-panel/native-execution.md',import.meta.url),'utf8')
 const reference=qwenWorkNativeExecutionReference(shared)
 assert.ok(reference.endsWith(shared),'all shared methods and Host-specific limits retain their exact bytes')
 assert.match(reference,/Codex-only launch references are not QwenWork parameters/)
 assert.match(reference,/for `host=codex` only/)
 assert.match(reference,/QwenWork has a separate native background contract/)
 assert.match(reference,/WorkBuddy's `TaskOutput/)
 assert.match(shared,/\| Bundle operation \| Native Host operation \|/)
})
test('Qwen entry defers to current readiness and policy without a permanent GRA prohibition', async () => {
 const skill=await readFile(new URL('../plugin-qwenwork/design-system/skills/yugoo/SKILL.md',import.meta.url),'utf8')
 assert.match(skill,/native-execution\.md/)
 assert.match(skill,/design_status\.hostCapabilities/)
 assert.match(skill,/reviewPolicy/)
 assert.match(skill,/backgroundReviewReadiness: "ready"/)
 assert.match(skill,/dispatch: true/)
 assert.match(skill,/explicitly requested content-free readiness bootstrap/)
 assert.match(skill,/canAttemptReadiness: true/)
 assert.match(skill,/Policy `off` forbids autonomous GRA/)
 assert.match(skill,/explicit human recheck without changing that policy/)
 assert.match(skill,/synchronous `Agent`\/`Task` is not a background substitute/)
 assert.match(skill,/Do not wait for background GRA or busy-poll/)
 assert.match(skill,/executionMode: "foreground"/)
 assert.match(skill,/turn off automatic GRA\s+while keeping manual checks/)
 assert.doesNotMatch(skill,/has \*\*no verified background reviewer execution\*\*|backgroundReviews` is false|do not create\s+new bindings/)
})

test('actual CLI startup receipt leaves Qwen cooperative GRA to live status, not a static failure or success', async () => {
 // Exercise the actual output expression, without launching a Host, service or
 // model. Native receipt observation is covered by qwenwork-background tests.
 const source=await readFile(new URL('../src/plugin-cli.mjs',import.meta.url),'utf8')
 const start=source.indexOf('    console.log(JSON.stringify({ url: server.url')
 const end=source.indexOf('\n    return\n',start)
 assert.ok(start>=0&&end>start,'the CLI startup receipt remains discoverable')
 for(const host of ['qwenwork','codex','qoder','claude-code']) {
  const printed=[]
  runInNewContext(source.slice(start,end),{
   host, server:{url:'http://127.0.0.1/fixture',browserAccess:'local',connectionPath:'/fixture/connection.json',...(host==='qwenwork'?{inputMode:'desktop'}:{})},
   options:{projectRoot:'/fixture/project'},values:{thread:'fixture-session'},transcriptPath:'/fixture/native.jsonl',
   console:{log:text=>printed.push(JSON.parse(text))},
  })
  assert.equal(printed.length,1)
  const receipt=printed[0]
  assert.deepEqual(receipt.unavailable,host==='codex'?['project-switching']:['project-switching','managed-background-reviews'])
  assert.ok(!receipt.capabilities.includes('native-background-reviews'),'startup is not proof of a real asynchronous launch')
  if(host==='qwenwork') {
   assert.match(receipt.nativeAgentTools,/design_status\.hostCapabilities and reviewPolicy/)
   assert.match(receipt.nativeAgentTools,/startup alone does not verify/)
   assert.equal(receipt.inputMode,'desktop')
  } else {
   assert.equal(receipt.nativeAgentTools,'Owned by the host session, not probed by Companion. Check the actual native tools; Companion does not spawn foreground agents.')
  }
 }
})
test('CLI entry summaries preserve shared capability, dispatch-owner and policy boundaries', async () => {
 const entries={
  codex:'../plugin/design-system/skills/design-panel/SKILL.md',
  qoder:'../plugin-qoder/design-system/skills/yugoo/SKILL.md',
  claude:'../plugin-claude/design-system/skills/yugoo/SKILL.md',
 }
 for(const [host,path] of Object.entries(entries)) {
  const skill=await readFile(new URL(path,import.meta.url),'utf8')
  assert.match(skill,/design_status\.hostCapabilities/,host)
  assert.match(skill,/reviewDispatchOwner/,host)
  assert.match(skill,/reviewPolicy/,host)
  assert.match(skill,/dispatch: true/,host)
  assert.doesNotMatch(skill,/backgroundReviewReadiness: "ready"/,`${host} does not use the Qwen/WorkBuddy readiness receipt protocol`)
 }
 const qoder=await readFile(new URL(entries.qoder,import.meta.url),'utf8')
 assert.match(qoder,/Main U\/S\/T uses\s+`design_main_context` and `report_design_clarity` independently/)
 assert.doesNotMatch(qoder,/GRA\/U\/S\/T follow/)
 const claude=await readFile(new URL(entries.claude,import.meta.url),'utf8')
 assert.match(claude,/Do not pass `--background-reviews`/,'the real managed-executor limitation is retained')
 assert.match(claude,/dispatch, use `design_prepare_reviews` to obtain the current batch\. Launch native\s+background reviewers and call `design_bind_reviews` only for returned entries\s+with `dispatch: true`/,'prepare obtains dispatch references; an existing reference is not a precondition to preparation')
 const codex=await readFile(new URL(entries.codex,import.meta.url),'utf8')
 assert.match(codex,/If Companion owns\s+dispatch, do not prepare or launch duplicate reviewers/)
 assert.doesNotMatch(codex,/Launch a bounded review when settled\s+design evidence changes/)
})
test('Qwen package uses exact external Node and portable manifest without shell interpolation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-package-'));t.after(()=>rm(root,{recursive:true,force:true}))
 await cp(new URL('../plugin-qwenwork/design-system/',import.meta.url),root,{recursive:true})
 const pins={executable:'C:/Apps/QwenWorkCN.exe',worker:'C:/Apps/worker.mjs',nodeExecutable:"C:/Tools/Jeff's Node/node.exe",executableSha256:'a'.repeat(64),workerSha256:'b'.repeat(64)}
 await configureQwenWorkPackage(root,pins)
 assert.equal(JSON.parse(await readFile(join(root,'.mcp.json'),'utf8')).mcpServers['design-system'].command,pins.nodeExecutable)
 const hooks=JSON.parse(await readFile(join(root,'hooks/hooks.json'),'utf8'))
 assert.match(hooks.hooks.PostToolUse[0].hooks[0].command,/Jeff''s Node/)
 assert.equal(JSON.parse(await readFile(join(root,'.claude-plugin/plugin.json'),'utf8')).name,'yugoo-design')
 assert.throws(()=>validateQwenWorkRuntime({...pins,nodeExecutable:'node'}),/explicit Windows/)
 assert.throws(()=>validateQwenWorkRuntime({...pins,workerSha256:''}),/hashes/)
})

test('thin expert suite points to the exact shared runtime instead of copying heavy dependencies',async t=>{
 const root=await mkdtemp(join(tmpdir(),'qwen-thin-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const full=join(root,'full'),thin=join(root,'thin')
 await cp(new URL('../plugin-qwenwork/design-system/',import.meta.url),full,{recursive:true})
 const pins={executable:'C:/Qwen/app.exe',worker:'C:/Qwen/worker.mjs',nodeExecutable:'C:/Node/node.exe',executableSha256:'a'.repeat(64),workerSha256:'b'.repeat(64)}
 await configureQwenWorkPackage(full,pins)
 for(const name of ['qwenwork-hook-transport.mjs','qwenwork-connection.mjs','native-hook-transport.mjs','windows-private-storage.mjs','windows-native-platform.mjs']) await cp(new URL('../src/'+name,import.meta.url),join(full,'scripts',name))
 for(const name of ['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md'])await writeFile(join(full,name),'test fixture')
 await packageQwenWorkExpertKit(full,thin,'C:/My Runtime/design-system')
 const mcp=JSON.parse(await readFile(join(thin,'.mcp.json'),'utf8'))
 assert.equal(mcp.mcpServers['design-system'].args[0],'C:\\My Runtime\\design-system\\scripts\\design.mjs')
 assert.match(await readFile(join(thin,'skills/yugoo/SKILL.md'),'utf8'),/runtime-location.json/)
 assert.match(await readFile(join(thin,'skills/yugoo/SKILL.md'),'utf8'),/^---\nname: yugoo\n/)
 await assert.rejects(readFile(join(thin,'skills/design/SKILL.md')), {code:'ENOENT'})
 await assert.rejects(readFile(join(thin,'scripts/design.mjs')), {code:'ENOENT'})
 const separate=join(root,'separate')
 await packageQwenWorkExpertKit(full,separate,'C:/My Runtime/design-system',{includeMcp:false})
 await assert.rejects(readFile(join(separate,'.mcp.json')),{code:'ENOENT'})
 assert.deepEqual(qwenWorkConnectorConfiguration('C:/My Runtime/design-system',pins),mcp)
 assert.deepEqual(JSON.parse(await readFile(join(separate,'scripts/runtime-location.json'),'utf8')),
  {runtimeRoot:'C:/My Runtime/design-system',nodeExecutable:pins.nodeExecutable})
 assert.ok(await readFile(join(separate,'hooks/hooks.json'),'utf8'))
 await assert.rejects(packageQwenWorkExpertKit(full,join(root,'invalid'),'C:/My Runtime/design-system',{includeMcp:'false'}),/boolean/)
})
