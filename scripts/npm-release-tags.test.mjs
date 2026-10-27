import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import YAML from 'yaml'
import { latestPlan,verifyLatest,readPublishedMetadata,assertCompleteProductPublication } from './npm-release-tags.mjs'
import { RELEASE_SOURCE_PACKAGES,packageNameFor,publicationOrder } from './prepare-product-release.mjs'
const name='yugoo-design',releaseVersion='0.1.0'
const metadata=(latest='0.0.9',extra=[])=>({name,versions:Object.fromEntries(['0.0.9',releaseVersion,...extra].map(version=>[version,{name,version}])), 'dist-tags':{latest}})
test('formal latest selects the highest stable publication without requiring beta',()=>{
 const plan=latestPlan({name,releaseVersion,metadata:metadata()});assert.equal(plan.action,'update');assert.equal(plan.latestVersion,releaseVersion)
 assert.equal(latestPlan({name,releaseVersion,metadata:metadata(releaseVersion)}).action,'skip')
 assert.equal(latestPlan({name,releaseVersion,metadata:metadata(releaseVersion,['9.0.0-beta.1'])}).latestVersion,releaseVersion)
 assert.equal(latestPlan({name,releaseVersion,metadata:metadata(releaseVersion,['0.2.0'])}).latestVersion,'0.2.0')
})
test('older stable tag retries never downgrade and unrelated tags survive',()=>{
 const newer='0.2.0',old=latestPlan({name,releaseVersion,metadata:metadata()});const data=metadata(newer,[newer]);assert.equal(verifyLatest(old,data).latestVersion,newer)
 assert.throws(()=>verifyLatest(old,metadata()),/highest currently published/)
 const tagged={...metadata(),'dist-tags':{latest:'0.0.9',preview:'0.0.9'}};const plan=latestPlan({name,releaseVersion,metadata:tagged})
 assert.throws(()=>verifyLatest(plan,{...metadata(releaseVersion),'dist-tags':{latest:releaseVersion}}),/unrelated tags/)
})
test('unpublished release, malformed metadata and unavailable registry stop tag planning',async()=>{
 for(const data of [{...metadata(),name:'wrong'},{...metadata(),versions:[]},{...metadata(),versions:{latest:{name,version:'latest'}}},{...metadata(),'dist-tags':{latest:'9.0.0'}}])assert.throws(()=>latestPlan({name,releaseVersion,metadata:data}))
 assert.throws(()=>latestPlan({name,releaseVersion:'1.0.0',metadata:metadata()}),/Release must be published/)
 assert.throws(()=>latestPlan({name,releaseVersion:'0.1.0-beta.1',metadata:metadata()}))
 for(const status of [404,403,429,500])await assert.rejects(readPublishedMetadata(name,{fetchImpl:async()=>({status})}))
 await assert.rejects(readPublishedMetadata(name,{fetchImpl:async()=>{throw Error('network failed')}}),/network failed/)
})
test('latest requires complete current verification for the eleven actual identities',()=>{
 const head='a'.repeat(40),rows=RELEASE_SOURCE_PACKAGES.map((sourceName,index)=>({sourceName,name:packageNameFor(sourceName),version:releaseVersion,dependencies:index?[packageNameFor(RELEASE_SOURCE_PACKAGES[index-1])]:[]}))
 const receipt={sourceCommit:head,entries:publicationOrder(rows)},complete={sourceCommit:head,states:receipt.entries.map(x=>({name:x.name,version:releaseVersion,state:'identical'}))}
 assertCompleteProductPublication(receipt,complete,head,releaseVersion)
 for(const bad of [{...complete,states:complete.states.slice(0,10)},{...complete,sourceCommit:'b'.repeat(40)},{...complete,states:complete.states.map((x,i)=>i?x:{...x,state:'absent'})}])assert.throws(()=>assertCompleteProductPublication(receipt,bad,head,releaseVersion))
})
test('only the unified official publish job may publish or update stable latest',async()=>{
 const text=await readFile(new URL('../.github/workflows/publish-product.yml',import.meta.url),'utf8'),flow=YAML.parse(text)
 assert.deepEqual(flow.permissions,{contents:'read',actions:'read'});assert.equal(flow.jobs.dryrun.permissions,undefined)
 assert.deepEqual(flow.jobs.publish.permissions,{contents:'read',actions:'read','id-token':'write'})
 const steps=flow.jobs.publish.steps,index=steps.findIndex(x=>x.run?.includes('npm dist-tag add'))
 assert.ok(index>steps.findIndex(x=>x.run?.includes('prepare-product-release.mjs complete')));assert.equal(steps[index].if,"github.job == 'publish'")
 assert.equal(steps[index].env.RELEASE_CHAIN,'product');assert.match(steps[index].run,/npm-release-tags.mjs confirm/)
 assert.doesNotMatch(text,/--tag beta|dist-tag rm|NPM_TOKEN|NODE_AUTH_TOKEN|workflow_call/)
 const helper=await readFile(new URL('./npm-release-tags.mjs',import.meta.url),'utf8');assert.doesNotMatch(helper,/spawnSync|dist-tag add|execFileSync\([^\n]*npm/)
})
