import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installCodex } from '../install-codex.mjs'

test('personal install and update preserve other entries and keep previous package; native failure is retryable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'design-install-'))
  try {
    const source = join(root, 'package/design-system'), userHome = join(root, 'user')
    const files = { '.codex-plugin/plugin.json': JSON.stringify({name:'yugoo-design',version:'0.1.0+codex.one',skills:'./skills/',mcpServers:'./.mcp.json'}),
      'scripts/design.mjs':'// server', 'web/index.html':'<script src="/client.js"></script>', 'web/client.js':'// client',
      '.mcp.json':JSON.stringify({mcpServers:{'design-system':{command:'node',args:['scripts/design.mjs','mcp'],cwd:'.'}}}),
      'skills/yugoo/SKILL.md':'skill', 'skills/design-panel/SKILL.md':'panel', 'skills/design-panel/native-execution.md':'native',
      'kits/web_app/mindset.md':'kit','kits/web_app/kit.yaml':'version: 1\nmounts: []\n' }
    for (const [path, content] of Object.entries(files)) {
      const full = join(source, path); await mkdir(join(full, '..'), {recursive:true}); await writeFile(full,content)
    }
    const marketPath = join(userHome,'.agents/plugins/marketplace.json')
    await mkdir(join(marketPath,'..'),{recursive:true})
    const other = { name:'other', source:{source:'local',path:'./plugins/other'} }
    await writeFile(marketPath,JSON.stringify({name:'personal',interface:{displayName:'My Plugins'},plugins:[other]}))
    const calls=[]
    const run = async (cmd,args) => { calls.push([cmd,...args]);return {stdout:args[1]==='list'?'{"installed":[]}':'{"installed":true}'} }
    const first = await installCodex({packageRoot:source,userHome,run})
    assert.equal(first.backup,null)
    assert.equal(first.target,join(userHome,'plugins/yugoo-design'))
    assert.deepEqual(calls.at(-1),['codex','plugin','add','yugoo-design@personal','--json'])
    const registered = await readFile(marketPath,'utf8')
    assert.deepEqual(JSON.parse(registered).plugins[0],other)
    assert.equal(JSON.parse(registered).interface.displayName,'My Plugins')
    await writeFile(join(source,'scripts/design.mjs'),'// updated server')
    const second = await installCodex({packageRoot:source,userHome,run})
    assert.equal(await readFile(marketPath,'utf8'),registered,'upgrade does not rewrite marketplace')
    assert.equal(await readFile(join(second.backup,'scripts/design.mjs'),'utf8'),'// server')
    assert.equal(await readFile(join(second.target,'scripts/design.mjs'),'utf8'),'// updated server')
    const count=calls.length
    await rm(join(source,'kits/web_app/kit.yaml'))
    await writeFile(join(source,'kits/web_app/package.json'),'{}')
    await assert.rejects(installCodex({packageRoot:source,userHome,run}), /ENOENT.*kit\.yaml/)
    assert.equal(calls.length,count,'old package metadata cannot replace the Kit mount manifest')
    assert.equal(await readFile(marketPath,'utf8'),registered)
    await writeFile(join(source,'kits/web_app/kit.yaml'),files['kits/web_app/kit.yaml'])
    await rm(join(source,'kits/web_app/package.json'))
    await rm(join(source,'web/client.js'))
    await assert.rejects(installCodex({packageRoot:source,userHome,run}),/ENOENT/)
    await writeFile(join(source,'web/client.js'),'// client')
    await writeFile(join(source,'.mcp.json'),'{}')
    await assert.rejects(installCodex({packageRoot:source,userHome,run}),/Invalid design-system MCP/)
    await writeFile(join(source,'.mcp.json'),files['.mcp.json'])
    assert.equal(calls.length,count,'invalid packages do not invoke native install')
    assert.equal(await readFile(join(second.target,'scripts/design.mjs'),'utf8'),'// updated server')
    assert.equal(await readFile(marketPath,'utf8'),registered)
    await assert.rejects(installCodex({packageRoot:source,userHome,run:async(cmd,args)=>{
      if(args.includes('--help'))return {stdout:''};if(args[1]==='list')return {stdout:'{"installed":[]}'};throw new Error('offline')
    }}),/Package retained.*Retry: codex plugin add yugoo-design@personal/)
    assert.equal(await readFile(marketPath,'utf8'),registered)
    const changed=JSON.parse(registered);changed.plugins[1].source.path='./plugins/another'
    await writeFile(marketPath,JSON.stringify(changed))
    await assert.rejects(installCodex({packageRoot:source,userHome,run}),/different source/)
    for (const mixed of [false,true]) {
      const legacy={name:'design-system',source:{source:'local',path:'./plugins/design-system'}}
      const catalog={name:'personal',plugins:[other,legacy,...(mixed?[JSON.parse(registered).plugins[1]]:[])]}
      const bytes=JSON.stringify(catalog);await writeFile(marketPath,bytes)
      await assert.rejects(installCodex({packageRoot:source,userHome,run}),/Legacy design-system registration/)
      assert.equal(await readFile(marketPath,'utf8'),bytes)
      assert.equal(await readFile(join(second.target,'scripts/design.mjs'),'utf8'),'// updated server')
    }
    await writeFile(marketPath,registered)
    const nativeCalls=[]
    await assert.rejects(installCodex({packageRoot:source,userHome,run:async(_cmd,args)=>{
      nativeCalls.push(args)
      return {stdout:args[1]==='list'?JSON.stringify({installed:[{pluginId:'design-system@another-market'}]}):''}
    }}),/Legacy design-system plugin is still installed/)
    assert.ok(nativeCalls.every(args=>args.includes('--help')||args[1]==='list'))
    assert.equal(await readFile(marketPath,'utf8'),registered)

  } finally {await rm(root,{recursive:true,force:true})}
})
