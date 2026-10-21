import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {DesignProjectRegistry,loadDesignKit,createDirectoryBundleResolver} from '../../core/lib/index.js'
import {companionFs} from '../src/project.mjs'
import {startCompanion} from '../src/server.mjs'
import {callCompanion} from '../src/connection-file.mjs'
import {staticFixture} from './static-fixture.mjs'
import * as runtime from '../../knowledge-ladybug/lib/index.js'

// prepareReview opens the shared Ladybug runtime in-process; stop its worker
// so the test process exits naturally after each server closes.
after(()=>runtime.shutdownLadybugKnowledgeRuntime())

const threadId='11111111-1111-4111-8111-111111111111'
const kitRoot=fileURLToPath(new URL('../../skills-web-app/',import.meta.url))
const installedVersion=(await loadDesignKit(companionFs,kitRoot,{sourceId:'companion:explicit-kit',resolveBundle:createDirectoryBundleResolver(companionFs,[{rootDir:join(kitRoot,'bundles'),sourceId:'companion:explicit-kit'}])})).version

for(const host of ['codex','qoder','claude-code'])test(`${host}: unconfigured Panel survives live Kit pin, mismatch and recovery`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'companion-access-'))
  let server
  try {
    const registry=new DesignProjectRegistry({projectsRoot:join(root,'projects'),stateRoot:join(root,'registry')})
    const project=await registry.create('Unconfigured',{provider:'ladybug-wasm'})
    await mkdir(join(project.root,'design_files','archived_bundle'),{recursive:true})
    await writeFile(join(project.root,'design_files','archived_bundle','notes.md'),'Preserved source evidence')
    const notifications=[]
    server=await startCompanion({...await staticFixture(root),host,threadId,projectRoot:project.root,kitRoot,stateRoot:join(root,'companion'),
      connection:{host,threadId,async send(text){notifications.push(text);return {accepted:true,status:host==='codex'?'queued':'hook_received'}}}})
    const call=(method,params={})=>callCompanion(server.connectionPath,{method,params})
    const initialMetadata=await readFile(join(project.root,'project.json'),'utf8')
    const initial=await call('readWorkspace')
    assert.equal(initial.access.mode,'unconfigured');assert.equal(initial.access.writable,false)
    assert.equal(initial.clarity.assessment,null)
    assert.equal(initial.clarity.needsReassessment,true,'unconfigured access cannot certify a current assessment')
    const inspected=JSON.parse((await promisify(execFile)(process.execPath,[
      fileURLToPath(new URL('../src/plugin-cli.mjs',import.meta.url)), 'inspect',
      '--project',project.root,'--kit',kitRoot,'--state-root',join(root,'companion'),
    ])).stdout)
    assert.equal(inspected.access.mode,'unconfigured')
    assert.deepEqual(inspected.bundles,[])
    assert.equal(inspected.availableMindsets[0].name,'web_app')
    assert.deepEqual((await call('listSkills')).skills,[])
    const catalog=await call('listProjects')
    assert.ok(catalog.mindsets.some(kit=>kit.name==='web_app'))
    assert.equal(catalog.currentProjectId,project.projectId)
    assert.equal((await call('readArtifact',{path:'archived_bundle/notes.md'})).content,'Preserved source evidence')
    assert.equal((await call('sendPrompt',{text:'I want to design an app'})).accepted,true)
    assert.equal(notifications.length,1)
    assert.equal(await readFile(join(project.root,'project.json'),'utf8'),initialMetadata,'opening/sending does not implicitly pin a Kit')
    const blocked=async()=>{
      for(const [method,params] of [
        ['prepareBundle',{skill:'smart_questions'}],
        ['beginMainBundle',{skill:'smart_questions'}],
        ['prepareReviews',{}],
        ['prepareReview',{profile:'alignment'}],
        ['savePanel',{skill:'smart_questions',state:{questions:{}},eventId:'blocked-save'}],
      ])await assert.rejects(call(method,params),/Kit|mindset|pin|writ|unconfigured|recovery/i,method)
    }
    await blocked()
    await registry.setKitPin(project.projectId,{name:'web_app',version:installedVersion})
    const active=await call('readWorkspace')
    assert.equal(active.access.mode,'writable');assert.equal(active.access.writable,true)
    assert.ok((await call('listSkills')).skills.some(skill=>skill.id==='smart_questions'))
    assert.equal((await call('prepareBundle',{skill:'smart_questions'})).skill,'smart_questions')
    const invocation=await call('beginMainBundle',{skill:'smart_questions'})
    assert.ok(invocation.invocationId)
    assert.ok((await call('savePanel',{skill:'smart_questions',state:{questions:{}},eventId:'active-save'})).commit)
    assert.equal((await call('finishMainBundle',{invocationId:invocation.invocationId,scope:'state',outcome:'pause'})).accepted,true)
    await registry.setKitPin(project.projectId,{name:'web_app',version:'999.0'})
    const recovery=await call('readWorkspace')
    assert.equal(recovery.access.mode,'recovery');assert.equal(recovery.access.writable,false)
    assert.equal(recovery.clarity.assessment,null)
    assert.equal(recovery.clarity.needsReassessment,true,'recovery access cannot certify a current assessment')
    assert.equal((await call('readArtifact',{path:'archived_bundle/notes.md'})).content,'Preserved source evidence')
    await blocked()
    assert.equal((await call('sendPrompt',{text:'Please restore the installed Kit pin'})).accepted,true)
    await registry.setKitPin(project.projectId,{name:'web_app',version:installedVersion})
    assert.equal((await call('readWorkspace')).access.writable,true)
    assert.equal((await call('prepareBundle',{skill:'smart_questions'})).skill,'smart_questions')
  }finally {await server?.close();await rm(root,{recursive:true,force:true})}
})
