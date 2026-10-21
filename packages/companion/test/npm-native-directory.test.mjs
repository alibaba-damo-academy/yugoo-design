import assert from 'node:assert/strict'
import {test} from 'node:test'
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {installerMain} from '../src/npm-installer.mjs'

const run=promisify(execFile)
async function fixture(t,host) {
  const root=await mkdtemp(join(tmpdir(),'native directory '))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const npmRoot=join(root,'installed package'),pluginRoot=join(npmRoot,'payload/overlays',host)
  const prefix=host==='claude-code'?'claude':'qoder'
  const put=async(path,body)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,body)}
  await cp(new URL(`../plugin-${prefix}/design-system/`,import.meta.url),pluginRoot,{recursive:true})
  const manifest=JSON.parse(await readFile(join(pluginRoot,`.${prefix}-plugin/plugin.json`)))
  await put(join(npmRoot,'package.json'),JSON.stringify({name:'@fixture/native-directory',version:manifest.version}))
  await put(join(pluginRoot,'skills/yugoo/native-execution.md'),'shared execution reference')
  for(const file of ['native-hook-transport.mjs', 'windows-private-storage.mjs', 'windows-native-platform.mjs',`${prefix}-connection.mjs`,`${prefix}-hook-transport.mjs`])
    await cp(new URL('../src/'+file,import.meta.url),join(pluginRoot,'scripts',file))
  // Same relative shim used by the existing candidate builder, not a new runtime.
  await put(join(pluginRoot,'scripts/design.mjs'),"await import('../../../shared/scripts/design.mjs')\n")
  await put(join(npmRoot,'payload/shared/scripts/design.mjs'),"console.log(JSON.stringify({entry:import.meta.url,args:process.argv.slice(2)}))\n")
  for(const file of ['web/index.html','kits/web_app/package.json','knowledge/runtime.mjs'])
    await put(join(npmRoot,'payload/shared',file),'{}')
  return {root,npmRoot,pluginRoot,prefix,put}
}

for(const host of ['claude-code','qoder']) {
  test(`${host}: reuse packaged native directory without profile writes or transaction admission`,async t=>{
    const f=await fixture(t,host),foreign=join(f.root,'profile/settings.json')
    await f.put(foreign,'unrelated user settings\n')
    const result=await installerMain(['plugin-directory','--host',host],{npmRoot:f.npmRoot,userRoot:join(f.root,'profile'),
      claudeAdapterFactory:async()=>assert.fail('Directory loading must not invoke persistent registration')})
    assert.equal(result.status,'plugin-directory-ready');assert.equal(result.hostRegistered,false)
    assert.equal(result.hostLaunched,false);assert.equal(result.runtimePrerequisites.status,'missing')
    assert.deepEqual(result.launch.args,['--plugin-dir',f.pluginRoot])
    assert.equal(result.launch.executable,host==='claude-code'?'claude':'qodercli')
    assert.equal(await readFile(foreign,'utf8'),'unrelated user settings\n')
    const output=await run(process.execPath,[join(f.pluginRoot,'scripts/design.mjs'),'help'],{cwd:f.root})
    const observed=JSON.parse(output.stdout)
    assert.ok(observed.entry.endsWith('/payload/shared/scripts/design.mjs'))
    assert.deepEqual(observed.args,['help'])
  })
  test(`${host}: missing notification bridge is not declared ready`,async t=>{
    const f=await fixture(t,host)
    await rm(join(f.pluginRoot,`scripts/${f.prefix}-hook-transport.mjs`))
    await assert.rejects(installerMain(['plugin-directory','--host',host],{npmRoot:f.npmRoot}),/Missing native plugin asset/)
  })
  test(`${host}: missing Windows dependency is rejected before registration`,async t=>{
    const f=await fixture(t,host)
    await rm(join(f.pluginRoot,'scripts/windows-private-storage.mjs'))
    await assert.rejects(installerMain(['plugin-directory','--host',host],{npmRoot:f.npmRoot}),/Missing native plugin asset: scripts\/windows-private-storage.mjs/)
  })
  if(host==='qoder')test('Qoder missing slash command is not declared ready',async t=>{
    const f=await fixture(t,host)
    await rm(join(f.pluginRoot,'commands/yugoo.md'))
    await assert.rejects(installerMain(['plugin-directory','--host',host],{npmRoot:f.npmRoot}),/Missing native plugin asset: commands\/yugoo.md/)
  })
  test(`${host}: directory loading cannot swallow transaction flags`,async t=>{
    const f=await fixture(t,host)
    for(const flags of [['--plan','/unused'],['--receipt-dir','/unused'],['--user-root','/unused'],['--disable-embedding']])
      await assert.rejects(installerMain(['plugin-directory','--host',host,...flags],{npmRoot:f.npmRoot}),/accepts only --host/)
  })
}
