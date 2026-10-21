/** Source-plane regression for the legacy explicit Kit-source adapter. */
import test from 'node:test'
import assert from 'node:assert/strict'
const {register}=await import('tsx/esm/api'); register()
const {StudioBundleSourceService}=await import('../src/bundle-source.ts')

function fixture() {
  const root='/installed/demo', base=root+'/skills/alpha'
  const files=new Map(Object.entries({
    [root+'/mindset.md']:'---\nname: demo\nversion: "1.0"\ndescription: Demo.\n---\n\nMethod.\n\n<design_skills>\n\n## alpha\n\nAlpha.\n\n</design_skills>\n',
    [base+'/SKILL.md']:'---\nname: alpha\ndescription: Alpha.\n---\n\nMethod.\n',
    [base+'/skill.yaml']:'name: alpha\nversion: "1.0"\ntitle: {zh: Alpha, en: Alpha}\nlabel: {zh: Alpha, en: Alpha}\nexecution: {handoff: none}\npresentation: {mode: none}\n',
    [base+'/schema.yaml']:'type: object\nproperties:\n  summary: {type: string}\n',
    [base+'/validation.yaml']:'skill: alpha\nrules:\n  - id: summary\n    scope: [completion]\n    code: alpha.summary\n    message: Required\n    check: {non_empty_string: summary}\n',
    [base+'/private.md']:'exact 1.0 file',
  }))
  let fileReads=0
  const source={
    listKitRoots:async()=>[root],
    readText:async path=>{if(path===base+'/private.md') fileReads++;return files.get(path)},
    listDir:async path=>[...new Set([...files.keys()].filter(key=>key.startsWith(path+'/')).map(key=>key.slice(path.length+1).split('/')[0]))],
    isDirectory:async path=>[...files.keys()].some(key=>key.startsWith(path+'/')),
    listFiles:async path=>[...files.keys()].filter(key=>key.startsWith(path+'/')).map(key=>key.slice(path.length+1)).sort(),
  }
  const catalog={snapshot:async()=>({kits:[{name:'demo',version:'1.0',bundles:[{name:'alpha',version:'1.0'}]}]})}
  return {service:new StudioBundleSourceService(catalog,source),fileReads:()=>fileReads}
}

test('legacy workspace rejects a requested unavailable exact version',async()=>{
  const f=fixture(), result=await f.service.readBundleWorkspace('alpha','9.9')
  assert.equal(result.workspace,undefined)
  assert.equal(result.diagnostics[0].code,'bundle.version_missing')
})

test('legacy file rejects a requested unavailable exact version before serving bytes',async()=>{
  const f=fixture(), result=await f.service.readBundleFile({name:'alpha',version:'9.9',path:'private.md'})
  assert.equal(result.file,undefined)
  assert.equal(result.diagnostics[0].code,'bundle.version_missing')
})

test('legacy matching exact version preserves workspace and byte-exact file reads',async()=>{
  const f=fixture(), workspace=await f.service.readBundleWorkspace('alpha','1.0')
  assert.deepEqual(workspace.diagnostics,[])
  assert.equal(workspace.workspace.version,'1.0')
  assert.equal(workspace.workspace.kit,'demo')
  assert.equal((await f.service.readBundleFile({name:'alpha',version:'1.0',path:'private.md'})).file.content,'exact 1.0 file')
})
