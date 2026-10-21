import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, realpath, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parse } from 'yaml'
import { loadDesignKit } from '../src/kit-loader.ts'
import { validatorFromSchemaYaml } from '../src/schema.ts'
import { localizePanelManifest, validatePanelManifest } from '../src/panel-dsl.ts'
import { validateSkillDesign } from '../src/validate-design.ts'
import { renderDeclarativeState } from '../src/renderer.ts'
import { DesignFilesStore } from '../src/design-files.ts'
import { GitVersioning } from '../src/git.ts'
import {parseValidationYaml,evaluateValidationRules} from '../src/validation-rules.ts'
import {panelGraphSaveRules} from '../src/panel-graph-save-rules.ts'
import { applyPanelEdit } from '../src/panel-save.ts'
import { DesignPanelRemote } from '../src/panel-remote.ts'
import { applyRecordFieldEdit, applyDesignEditToDraft } from '../../panel/src/record-state.ts'
import { projectReferenceGraph } from '../../panel/src/reference-graph.ts'

const root = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
const source = {
  async readText(path) { try { return await readFile(path, 'utf8') } catch (e) { if (e.code === 'ENOENT') return undefined; throw e } },
  listDir: readdir, isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
}
const kit = await loadDesignKit(source, root, {sourceId:'isolated-ai-agent-redesign'})
const bundle = kit.skills.find(skill => skill.name === 'ai_agent_capabilities')
const base = root + '/bundles/ai_agent_capabilities/'
const sample = JSON.parse(await readFile(base + 'reference/preview.json', 'utf8'))
const validate = validatorFromSchemaYaml(bundle.metadata.schemaYaml)

test('real Kit loads Agent design, complete method/resources and both localized panels', async () => {
  assert.equal(kit.skills.length,15)
  assert.equal(String(bundle.version),'1.0')
  assert.equal(bundle.execution.handoff,'must_edit')
  assert.equal(parse(await readFile(base+'skill.yaml','utf8')).description,undefined,'one authored description source')
  assert.ok(bundle.metadata.skillManifest.description.zh,'locale picker copy projects into loaded metadata')
  const methodSource=await readFile(base+'SKILL.md','utf8')
  const routingDescription=parse(methodSource.split('---')[1]).description
  const picker=bundle.metadata.skillManifest.description
  assert.equal(picker.en,routingDescription.trim(),'English picker copy matches the authoritative frontmatter description')
  for(const label of ['Capability','Resolves','Candidate when','Do not infer','Output'])assert.ok(picker.en.includes('**'+label+'**'),label)
  for(const label of ['能力','解决','适用时机','不要推断','输出'])assert.ok(picker.zh.includes('**'+label+'**'),label)
  assert.deepEqual(bundle.metadata.panelManifest.sections.map(x=>x.id),['skills','tools','model_sources','knowledge_resources','agents'])
  assert.equal(bundle.metadata.panelManifest.ui.component,'record_workspace')
  assert.equal(bundle.metadata.panelManifest.ui.navigation_group_by,undefined)
  assert.equal(bundle.metadata.panelManifest.ui.children[0].component,'reference_graph')
  assert.match(bundle.content.replace(/\s+/g,' '),/manual configuration is a full path/i)
  assert.match(bundle.content.replace(/\s+/g,' '),/explicitly asks to find resources/)
  for(const file of ['artifact-contract.md','runtime-guide.md']) assert.ok(Object.keys(kit.resources).some(x=>x.endsWith('/reference/'+file)))
  assert.ok(!Object.keys(kit.resources).some(x=>x.endsWith('/reference/six-kind-example.json')))
  for(const locale of ['zh-CN','en-US']) {
    const panel=localizePanelManifest(bundle.metadata.panelManifest,locale)
    assert.ok(!JSON.stringify(panel).includes('$t:'))
    const config=panel.fields.find(x=>x.key==='config_json')
    assert.equal(config.control,'textarea')
    assert.equal(config.readonly,undefined)
    assert.equal(panel.fields.find(x=>x.key==='notes').required,undefined)
    const entryType=panel.fields.find(x=>x.key==='entries').item_fields.find(x=>x.key==='trigger')
    assert.equal(entryType.label,locale==='zh-CN'?'触发方式':'Trigger method')
    assert.deepEqual(entryType.options.map(x=>x.value),['conversation','action','background'])
    assert.deepEqual(entryType.options.map(x=>x.label),locale==='zh-CN'
      ?['对话触发','按钮或菜单','后台自动触发']:['Conversation','Button or menu','Automatic background trigger'])
    const connection=panel.fields.find(x=>x.key==='model_connection')
    assert.equal(connection.choice_layout,'row_wrap')
    assert.deepEqual(connection.options.map(x=>x.value),['runtime','existing','other'])
    assert.deepEqual(connection.options.map(x=>x.label),locale==='zh-CN'
      ?['使用时配置','集成已有模型服务','其他']:['Configure at use time','Integrate an existing service','Other'])
    assert.ok(!JSON.stringify(panel).includes(locale==='zh-CN'?'模型服务要求':'Model service requirements'))
    assert.equal(panel.sections.find(x=>x.id==='agents').form.body[0].tabs.at(-1).id,'model-connection')
  }
  for(const file of ['preview.json','example.json']) {
    const state=JSON.parse(await readFile(base+'reference/'+file,'utf8'))
    assert.equal(validate(state).ok,true,file)
    assert.deepEqual(await validateSkillDesign(bundle,state,{scopes:['state','completion']}),[],file)
  }
  assert.ok(renderDeclarativeState(sample,bundle).join('\n').includes('阅读整理助手'))
  assert.equal(sample.agents['A-reading'].harness,undefined,'preview does not preselect an SDK')
  assert.equal(sample.agents['A-reading'].model_access,undefined,'preview does not invent a model-access decision')
  assert.ok(!renderDeclarativeState(sample,bundle).join('\n').includes('Model gateways'))
  assert.ok(!renderDeclarativeState(sample,bundle).join('\n').includes('Collaborators'))
})

test('shared resources remain optional, explicitly identified and closed without inventing mechanisms', async () => {
  const old=structuredClone(sample)
  delete old.model_sources; delete old.knowledge_resources
  for(const agent of Object.values(old.agents))for(const key of ['model_source_ref','model_selection','knowledge_resource_refs'])delete agent[key]
  assert.equal(validate(old).ok,true)
  assert.deepEqual(await validateSkillDesign(bundle,old,{scopes:['state','completion']}),[])
  for(const [key,kind] of [['model_sources',undefined],['knowledge_resources','knowledge_base']]) {
    const invalid=structuredClone(sample); const id=Object.keys(invalid[key])[0]
    invalid[key][id].id='wrong'
    assert.ok((await validateSkillDesign(bundle,invalid,{scopes:['state']})).some(issue=>issue.code===`ai_agent_capabilities.${key}_id`))
    invalid[key][id].id=id; invalid[key][id].name=''
    assert.equal(validate(invalid).ok,true,'empty name is a draft, not fake completion')
    assert.ok((await validateSkillDesign(bundle,invalid,{scopes:['completion']})).length)
    if(kind) {
      for(const value of [undefined,'model',42]) { invalid[key][id].kind=value; assert.equal(validate(invalid).ok,false) }
    } else { invalid[key][id].api_key='not-a-real-key'; assert.equal(validate(invalid).ok,false,'model intent is not a credential store') }
  }
  const graph=bundle.metadata.panelManifest.ui.children[0]
  assert.equal(graph.references.layout.kind,'hub')
  assert.equal(graph.references.layout.entries.description_field,'location')
  const summary=renderDeclarativeState(sample,bundle).join('\n')
  assert.match(summary,/Model entries/)
  assert.equal(sample.agents['A-reading'].model_source_ref,sample.agents['A-title'].model_source_ref)
  assert.notEqual(sample.agents['A-reading'].model_selection,sample.agents['A-title'].model_selection)
  assert.equal(sample.agents['A-title'].knowledge_resource_refs,undefined,'simple Agent has no invented memory')
})

test('capability-first resources need no implementation choice and retain optional declarations', async () => {
  const panel=bundle.metadata.panelManifest
  const tools=panel.sections.find(x=>x.id==='tools'),skills=panel.sections.find(x=>x.id==='skills')
  assert.equal(tools.create.defaults.tool_kind,undefined)
  assert.equal(tools.form.body[0].field,'purpose')
  assert.deepEqual(tools.form.body.filter(x=>x.kind==='group').map(x=>[x.collapsible,x.items.map(y=>y.field)]),[
    [true,['scope','approval','failure']],[true,['tool_kind','source','interface','config_json']],
  ])
  assert.ok(skills.form.body.some(x=>x.kind==='field'&&x.field==='source'))
  assert.ok(skills.form.body.some(x=>x.kind==='group'&&x.collapsible&&x.items[0].field==='resources'))
  const minimal={schema_version:1,tools:{scan:{id:'scan',name:'Scan text',purpose:'Read user-selected scans, keep page locations and flag unreadable text.'}},agents:{a:{id:'a',name:'A',description:'Review the material',tool_refs:['scan']}}}
  const before=structuredClone(minimal)
  assert.equal(validate(minimal).ok,true)
  assert.deepEqual(await validateSkillDesign(bundle,minimal,{scopes:['state','completion']}),[])
  assert.ok(renderDeclarativeState(minimal,bundle).join('\n').includes(minimal.tools.scan.purpose))
  assert.deepEqual(minimal,before,'load, completion and summary never infer a tool type')
  for(const tool_kind of ['',null,42,'connected'])assert.equal(validate({...minimal,tools:{scan:{...minimal.tools.scan,tool_kind}}}).ok,false)
  for(const field of ['config_json','interface','source'])assert.equal(validate({...minimal,tools:{scan:{...minimal.tools.scan,[field]:{invalid:true}}}}).ok,false)
  assert.match(bundle.content,/Leave `tool_kind` absent when undecided/)
  assert.match(bundle.content,/interface\/JSON are not prerequisites/)
  const contract=await readFile(base+'reference/artifact-contract.md','utf8')
  assert.match(contract,/undecided/)
  assert.match(contract,/This list neither uploads nor installs files/)
})

test('model connection choices are optional intent, retain hidden plans and summarize their applicability', async () => {
  const agent={id:'unit',name:'Unit',description:'A useful result',model_service:'Retained service plan',integration_ref:'existing-id'}
  const state={schema_version:1,agents:{unit:agent}}
  assert.equal(validate(state).ok,true,'older text/ref without a choice remain valid')
  for(const model_connection of ['runtime','existing','other']) {
    const candidate={...state,agents:{unit:{...agent,model_connection}}}
    assert.equal(validate(candidate).ok,true)
    assert.deepEqual(await validateSkillDesign(bundle,candidate,{scopes:['state','completion']}),[],'no new configuration completeness gate')
    const summary=renderDeclarativeState(candidate,bundle).join('\n')
    for(const field of ['model_connection','model_service','integration_ref'])assert.ok(summary.includes(field+'='),field)
    const edited=applyDesignEditToDraft(candidate,bundle.metadata.panelManifest,{section:'agents',record:'unit',field:'model_connection',value:'runtime'})
    assert.equal(edited.agents.unit.model_service,agent.model_service)
    assert.equal(edited.agents.unit.integration_ref,agent.integration_ref)
  }
  for(const model_connection of ['connected','',42,{},null])assert.equal(validate({...state,agents:{unit:{...agent,model_connection}}}).ok,false)
  const contract=bundle.content
  assert.match(contract,/Real keys are supplied when using the product/)
  assert.match(contract,/\$\{MODEL_API_KEY\}/)
  assert.match(contract,/hidden values are inactive/)
})

test('optional product behavior fields remain a draft-friendly closed contract', async () => {
  const minimal={schema_version:1,agents:{a:{id:'a',name:'A',description:'A useful result'}}}
  assert.equal(validate(minimal).ok,true)
  assert.deepEqual(await validateSkillDesign(bundle,minimal,{scopes:['state','completion']}),[])
  const draft=structuredClone(minimal)
  Object.assign(draft.agents.a,{actions:{row:{action:'',condition:''}},result_adoption:'',failure_handling:'',usage_requirements:''})
  assert.equal(validate(draft).ok,true,'existing empty action rows and optional text are valid drafts')
  assert.deepEqual(await validateSkillDesign(bundle,draft,{scopes:['state','completion']}),[],'no new completeness gate')
  const absentRow=structuredClone(minimal);absentRow.agents.a.actions={}
  assert.equal(validate(absentRow).ok,true)
  for(const actions of [[],{row:'Run'},{row:{action:42,condition:'If requested'}},{row:{action:'Run',condition:[]}},
    {row:{action:'Run'}},{row:{action:'Run',condition:'If requested',authorized:true}}]) {
    assert.equal(validate({schema_version:1,agents:{a:{...minimal.agents.a,actions}}}).ok,false,'invalid action structure is not normalized')
  }
  for(const field of ['result_adoption','failure_handling','usage_requirements']) {
    for(const value of [42,[],{},null]) assert.equal(validate({schema_version:1,agents:{a:{...minimal.agents.a,[field]:value}}}).ok,false,field)
  }
  const entries=structuredClone(sample)
  entries.agents['A-reading'].entries.background={name:'Synthetic background entry',trigger:'background'}
  assert.equal(validate(entries).ok,true)
  assert.deepEqual(await validateSkillDesign(bundle,entries,{scopes:['state','completion']}),[],'three triggers may coexist, without a new Agent')
  for (const trigger of ['conversation','action','background']) {
    const agent={...minimal.agents.a,entries:{entry:{name:'Entry',trigger,auto_context:'Selected object, within authorized scope'}}}
    assert.equal(validate({schema_version:1,agents:{a:agent}}).ok,true,'inputs need not be invented for '+trigger)
    agent.entries.entry.auto_context={untyped:true}
    assert.equal(validate({schema_version:1,agents:{a:agent}}).ok,false)
  }
})

test('loaded methods, reconstruction contract and scalar summary retain product and implementation meaning', async () => {
  const authoredContract=await readFile(base+'reference/artifact-contract.md','utf8')
  const contractKey=Object.keys(kit.resources).find(x=>x.endsWith('/reference/artifact-contract.md')&&kit.resources[x]===authoredContract)
  assert.ok(contractKey,'reconstruction must be able to read the same output contract')
  const contract=kit.resources[contractKey]
  assert.equal(typeof contract,'string')
  assert.match(contract,/Partial results are not completion/)
  assert.match(contract,/stopping, resuming and replaying are different/)
  const adoptionContract=contract.replace(/\s+/g,' ')
  assert.match(adoptionContract,/protects or overwrites subsequent user edits/)
  assert.match(adoptionContract,/according to source evidence or explicit user decisions/)
  assert.match(adoptionContract,/Unknown behavior does not default to protection/)
  assert.match(adoptionContract,/Reconstruction preserves source-backed overwrite behavior/)
  assert.match(adoptionContract,/preserve user-owned fields when revising Design Files/)
  assert.match(contract,/not mandatory SDK, model, endpoint or credential configuration/)
  assert.match(bundle.content,/Start with the experience rather than an SDK choice/)
  assert.match(bundle.content,/complete Markdown body/)
  assert.match(bundle.content,/Preserve arbitrary configuration keys/)
  for(const field of ['actions','result_adoption','failure_handling','usage_requirements']) assert.ok(contract.includes('`'+field+'`'))
  const configured=structuredClone(sample)
  configured.agents['A-reading'].harness='codex_app_server'
  configured.agents['A-reading'].model_access='inherit'
  Object.assign(configured.agents['A-reading'], {result_adoption:'Old adoption',failure_handling:'Old recovery',usage_requirements:'Old requirements',execution_policy:'Old execution',external_delegation:'Preserved external handoff'})
  const summary=renderDeclarativeState(configured,bundle).join('\n')
  for(const field of ['result_adoption','failure_handling','usage_requirements','harness','model_access','execution_policy','external_delegation']) assert.ok(summary.includes(field+'='),field)
  assert.ok(!summary.includes('[object Object]'),'nested actions are canonical records, not scalar summary copies')
  const before=structuredClone(sample)
  renderDeclarativeState(sample,bundle)
  assert.deepEqual(sample,before,'summary never fills or rewrites canonical values')
})

test('external collaboration drafts retain local reference authority and do not invent graph targets', async () => {
  const candidate=structuredClone(sample)
  const rows=candidate.agents['A-reading'].collaborations
  for(const row of [{},{external_target:''},{external_target:'Team assistant'},
    {agent_ref:'',external_target:'Team assistant'}, {agent_ref:'A-title',external_target:'Retained external text'}]) {
    rows.test=row
    assert.equal(validate(candidate).ok,true)
    assert.deepEqual(await validateSkillDesign(bundle,candidate,{scopes:['state','completion']}),[])
    const graph=projectReferenceGraph(bundle.metadata.panelManifest.ui.children[0].references,id=>candidate[id]??{},id=>id)
    assert.deepEqual(graph.missing,[])
    assert.equal(Object.keys(graph.nodes).length,['agents','skills','tools','model_sources','knowledge_resources'].reduce((count,section)=>count+Object.keys(candidate[section]??{}).length,0))
    assert.equal(Object.keys(graph.edges).filter(id=>JSON.parse(id)[2]==='collaborations').length,1,'external text creates no additional edge; local duplicates share one edge')
  }
  for(const external_target of [42,{},[],null]) {
    rows.test={external_target}
    assert.equal(validate(candidate).ok,false,'external text has a real type contract')
  }
  for(const agent_ref of ['missing',' ']) {
    rows.test={agent_ref,external_target:'Not a bypass'}
    assert.equal(validate(candidate).ok,true)
    assert.ok((await validateSkillDesign(bundle,candidate,{scopes:['state','completion']})).some(x=>x.code==='ai_agent_capabilities.missing_collaborator'))
  }
  const fields=bundle.metadata.panelManifest.fields
  assert.equal(fields.find(x=>x.key==='external_delegation').hidden,true)
  const external=fields.find(x=>x.key==='collaborations').item_fields.find(x=>x.key==='external_target')
  assert.deepEqual(external.visible_when,{field:'agent_ref',in:['']})
  assert.ok(!bundle.metadata.panelManifest.ui.children[0].references.links.some(x=>x.item_field==='external_target'))
})

test('nested reference rules are opt-in, draft-friendly and exact at root and row scope', async () => {
  const make=(spec,root=false)=>parseValidationYaml(JSON.stringify({skill:'test',rules:[{id:'nested',scope:['state'],code:'missing',check:{...(root?{}:{for_each_in_map:'agents'}),members_of_map:spec}}]}))
  const spec={value:'collaborations',item_field:'agent_ref',map:'agents'}
  for(const root of [false,true])for(const [target,valid] of [[undefined,true],['',true],['b',true],['missing',false],[' ',false],[null,false],[42,false]]) {
    const state={agents:{a:{collaborations:{row:{agent_ref:target}}},b:{}}}
    if(root)state.collaborations=state.agents.a.collaborations
    assert.equal((await evaluateValidationRules(make(spec,root),{skill:'test',state},'state')).length===0,valid,JSON.stringify({root,target}))
  }
  for(const root of [false,true])for(const item_field of ['__proto__','a.b',null,42])assert.throws(()=>make({...spec,item_field},root))
  const legacy=make({value:'refs',map:'agents'})
  assert.equal((await evaluateValidationRules(legacy,{skill:'test',state:{agents:{a:{refs:{row:{agent_ref:'a'}}}}}},'state')).length,1,'old list contract still rejects maps')
  const rules=panelGraphSaveRules(parseValidationYaml(bundle.metadata.validationYaml),bundle.metadata.panelManifest)
  assert.ok(rules.some(rule=>rule.id==='collaboration_refs'))
  const different=structuredClone(bundle.metadata.panelManifest);different.ui.children[0].references.links.at(-1).item_field='another'
  assert.ok(!panelGraphSaveRules(parseValidationYaml(bundle.metadata.validationYaml),different).some(rule=>rule.id==='collaboration_refs'))
})

test('negative shape, identity, evidence and completion checks remain real guards', async () => {
  const old={schema_version:1,capabilities:{},components:{},relations:{}}
  assert.equal(validate(old).ok,false,'legacy state must not silently become the new panel')
  const invalid=structuredClone(sample); invalid.agents['A-reading'].harness=42
  assert.equal(validate(invalid).ok,false)
  invalid.agents['A-reading'].harness='公司已有 AI 服务'
  assert.equal(validate(invalid).ok,true,'Other is an ordinary user-supplied runtime/access name')
  invalid.agents['A-reading'].model_access='installed-and-tested'
  assert.equal(validate(invalid).ok,false,'access intent has only the declared two choices')
  invalid.agents['A-reading'].model_access='inherit'
  invalid.agents['A-reading'].harness='custom_harness'; invalid.agents['A-reading'].id='wrong'
  assert.ok((await validateSkillDesign(bundle,invalid,{scopes:['state']})).some(x=>x.code==='ai_agent_capabilities.agents_id'))
  const unsafe=structuredClone(sample)
  unsafe.agents['A-reading'].references={bad:{file:'../private.txt',revision:'HEAD'}}
  assert.ok((await validateSkillDesign(bundle,unsafe,{scopes:['state']})).length)
  const draft=structuredClone(sample); draft.agents['A-reading'].description=''
  assert.deepEqual(await validateSkillDesign(bundle,draft,{scopes:['state']}),[],'draft is not a fake quality result')
  assert.ok((await validateSkillDesign(bundle,draft,{scopes:['completion']})).some(x=>x.code==='ai_agent_capabilities.responsibility'))
  const undecided={schema_version:1,agents:{a:{id:'a',name:'A',description:'A useful result'}}}
  assert.equal(validate(undecided).ok,true)
  assert.deepEqual(await validateSkillDesign(bundle,undecided,{scopes:['state','completion']}),[],'no mandatory harness, search, resource or credential')
  for(const mode of ['inherit','configure']) assert.equal(validate({schema_version:1,agents:{a:{...undecided.agents.a,harness:'codex_app_server',model_access:mode}}}).ok,true,'model access needs no URL/protocol/credential/precise model ID')
  assert.equal(validate({...undecided,gateways:{}}).ok,false,'retired gateway shape is not a second authority')
})

test('reference canvas rejects unrelated fields, mismatched targets and editable graph authorities', () => {
  assert.deepEqual(validatePanelManifest(bundle.metadata.panelManifest),[])
  const invalid=change=>{
    const panel=structuredClone(bundle.metadata.panelManifest)
    change(panel.ui.children[0],panel)
    assert.ok(validatePanelManifest(panel).length)
  }
  invalid(graph=>{graph.references.nodes.push({...graph.references.nodes[0]})})
  invalid(graph=>{graph.references.nodes[0].source='outside'})
  invalid(graph=>{graph.references.links[0].field='description'})
  invalid(graph=>{graph.references.links[0].target='tools'})
  invalid(graph=>{graph.references.links.push({...graph.references.links[0]})})
  for(const item_field of ['missing','agent_ref.deep','__proto__',42])invalid(graph=>{graph.references.links.at(-1).item_field=item_field})
  invalid(graph=>{graph.references.links.at(-1).target='skills'})
  invalid(graph=>{graph.graph={nodes:'agents',edges:'tools',label_field:'name',source_field:'id',target_field:'id'}})
  invalid(graph=>{graph.children=[{id:'unexpected',component:'text',text:'Extra editor'}]})
})

test('manual independent resources and type changes preserve text, opaque config and sibling units', async () => {
  const panel=bundle.metadata.panelManifest, skillId=sample.agents['A-reading'].skill_refs[0],toolId=sample.agents['A-reading'].tool_refs[0]
  const body='# User method\n\nKeep limitations.\n',config='{"custom":{"unknown":[1,2]},"env":{"KEY":"env:KEY"}}'
  let edited=applyDesignEditToDraft(sample,panel,{section:'skills',record:skillId,field:'body',value:body})
  edited=applyDesignEditToDraft(edited,panel,{section:'tools',record:toolId,field:'config_json',value:config})
  edited=applyDesignEditToDraft(edited,panel,{section:'agents',record:'A-reading',field:'harness',value:'model_call'})
  edited=applyDesignEditToDraft(edited,panel,{section:'agents',record:'A-title',field:'skill_refs',value:[skillId]})
  assert.equal(edited.skills[skillId].body,body)
  assert.equal(edited.tools[toolId].config_json,config)
  assert.deepEqual(edited.agents['A-reading'].skill_refs,sample.agents['A-reading'].skill_refs)
  assert.deepEqual(await validateSkillDesign(bundle,edited,{scopes:['state','completion']}),[])
  const dangling=structuredClone(edited);delete dangling.skills[skillId]
  assert.ok((await validateSkillDesign(bundle,dangling,{scopes:['state']})).some(x=>x.code==='ai_agent_capabilities.missing_reference'))
  assert.equal(edited.agents['A-reading'].model_access,sample.agents['A-reading'].model_access)
  assert.equal(edited.agents['A-reading'].notes,sample.agents['A-reading'].notes)
  assert.equal(edited.agents['A-title'].system_prompt,sample.agents['A-title'].system_prompt)
  assert.deepEqual(JSON.parse(JSON.stringify(edited)),edited)
})

test('product behavior edits preserve legacy technical values, full resources, pins and sibling records', async () => {
  const initial=structuredClone(sample),panel=bundle.metadata.panelManifest
  initial.agents['A-reading'].references={source:{file:'ai_agent_capabilities/ai_agent_capabilities.json',revision:'a'.repeat(40),pointer:'/agents/A-reading',subject_pointer:'/system_prompt'}}
  const values={actions:{'user-action':{action:'Suggest selected changes',condition:'User explicitly requests; no write permission inferred'}},
    result_adoption:'Preview only; preserve user edits',failure_handling:'Keep partial results uncompleted; no automatic replay',usage_requirements:'Authorized readable input, not required SDK setup'}
  let edited=initial
  for(const [field,value] of Object.entries(values)) edited=applyDesignEditToDraft(edited,panel,{section:'agents',record:'A-reading',field,value})
  edited=applyDesignEditToDraft(edited,panel,{section:'agents',record:'A-reading',field:'harness',value:'model_call'})
  assert.equal(validate(edited).ok,true)
  assert.deepEqual(await validateSkillDesign(bundle,edited,{scopes:['state','completion']}),[])
  assert.deepEqual(edited.skills,initial.skills);assert.deepEqual(edited.tools,initial.tools)
  assert.deepEqual(edited.agents['A-title'],initial.agents['A-title'])
  for(const [field,value] of Object.entries(initial.agents['A-reading'])) {
    if(field!=='harness'&&!Object.hasOwn(values,field)) assert.deepEqual(edited.agents['A-reading'][field],value,field)
  }
  for(const [field,value] of Object.entries(values)) assert.deepEqual(edited.agents['A-reading'][field],value,field)
  const deleted=applyDesignEditToDraft(edited,panel,{section:'agents',record:'A-reading',field:'actions',value:{}})
  assert.deepEqual(deleted.agents['A-reading'].actions,{})
  assert.equal(deleted.agents['A-reading'].system_prompt,initial.agents['A-reading'].system_prompt)
  assert.deepEqual(deleted.agents['A-reading'].references,initial.agents['A-reading'].references)
})

test('manual resource edits save and reopen via real Core Files/Git without discovery or native model', async t => {
  const directory=await mkdtemp(join(tmpdir(),'ai-agent-save-'))
  t.after(()=>rm(directory,{recursive:true,force:true}))
  const fs={...source,readText:source.readText,writeText:async(path,text)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,text)},ensureDir:path=>mkdir(path,{recursive:true})}
  const exec=promisify(execFile)
  const spawn=async({argv,cwd,env})=>{try{return{exitCode:0,...await exec(argv[0],argv.slice(1),{cwd,env:{...process.env,...env}})}}catch(e){return{exitCode:e.code??1,stdout:e.stdout??'',stderr:e.stderr??''}}}
  const git=new GitVersioning(spawn,directory,'design_files');await git.ensureRepo()
  const open=()=>new DesignFilesStore(fs,new GitVersioning(spawn,directory,'design_files'),join(directory,'design_files'))
  const store=open()
  await applyPanelEdit(store,{skill:bundle.name,state:sample},async()=>{},validate)
  const edited=structuredClone(sample)
  edited.skills[edited.agents['A-reading'].skill_refs[0]].body='# Manual Skill\n\nPreserve user method.'
  edited.tools[edited.agents['A-reading'].tool_refs[0]].config_json='{"url":"env:MCP_URL","custom":{"keep":true}}'
  const savedSkill=edited.skills[edited.agents['A-reading'].skill_refs[0]]
  savedSkill.source='User-owned local method'
  savedSkill.resources=['reference/method.md','templates/result.md']
  const savedTool=edited.tools[edited.agents['A-reading'].tool_refs[0]]
  Object.assign(savedTool,{interface:'search(query) → source excerpts',approval:'Read only with user permission',failure:'Report missing permission without retrying',source:'User supplied connection'})
  edited.tools['T-scan-text'].purpose='Extract selected pages without choosing an implementation.'
  edited.agents['A-reading'].tool_refs.push('T-scan-text')
  edited.agents['A-reading'].harness='公司现有 AI 服务'
  edited.agents['A-reading'].model_access='inherit'
  edited.agents['A-reading'].model_connection='existing'
  edited.agents['A-reading'].model_service='Synthetic plan: api_key = ${MODEL_API_KEY}'
  edited.agents['A-reading'].integration_ref='external-service'
  edited.agents['A-reading'].entries.chat.trigger='background'
  edited.agents['A-reading'].entries.chat.auto_context='User-authored event data; preserve across trigger switches'
  assert.deepEqual(edited.agents['A-reading'].entries.chat.input_modes,['text','files'],'hidden data remains part of the save')
  edited.agents['A-reading'].actions={'retained-key':{action:'',condition:''}}
  edited.agents['A-reading'].result_adoption='User-approved preview; never overwrite later user changes'
  edited.agents['A-reading'].failure_handling='Keep partial work uncompleted; stop is not durable resume'
  edited.agents['A-reading'].usage_requirements='User-authorized readable material; SDK setup remains optional'
  edited.agents['A-reading'].external_delegation='Old task handoff and failure policy remain verbatim'
  edited.agents['A-reading'].collaborations.title.external_target='Retained while local Agent is selected'
  edited.agents['A-reading'].references={source:{file:'ai_agent_capabilities/ai_agent_capabilities.json',revision:'b'.repeat(40),pointer:'/agents/A-reading',subject_pointer:'/actions/retained-key'}}
  await applyPanelEdit(store,{skill:bundle.name,state:edited},async()=>{},validate)
  assert.deepEqual(await open().read(bundle.name),edited)
  for(const tool_kind of ['function','mcp']) {
    savedTool.tool_kind=tool_kind
    await applyPanelEdit(store,{skill:bundle.name,state:edited},async()=>{},validate)
    assert.deepEqual(await open().read(bundle.name),edited,'full hidden interface/config, supporting files and undecided capability survive durable reopen')
    assert.equal((await open().read(bundle.name)).tools['T-scan-text'].tool_kind,undefined)
  }
  for(const mode of ['other','runtime','existing']) {
    edited.agents['A-reading'].model_connection=mode
    await applyPanelEdit(store,{skill:bundle.name,state:edited},async()=>{},validate)
    assert.deepEqual(await open().read(bundle.name),edited,'choice switches retain inactive plan and reference on durable reopen')
  }
  for(const agent_ref of ['', 'A-title']) {
    edited.agents['A-reading'].collaborations.title.agent_ref=agent_ref
    await applyPanelEdit(store,{skill:bundle.name,state:edited},async()=>{},validate)
    assert.deepEqual(await open().read(bundle.name),edited,'external target, legacy prose and handoff survive switching and durable reopen')
  }
  const head=await store.head()
  const invalidConnection=structuredClone(edited);invalidConnection.agents['A-reading'].model_connection='connected'
  await assert.rejects(applyPanelEdit(store,{skill:bundle.name,state:invalidConnection},async()=>{},validate))
  assert.equal(await store.head(),head)
  const malformed=structuredClone(edited);malformed.agents['A-reading'].actions['retained-key'].condition=42
  await assert.rejects(applyPanelEdit(store,{skill:bundle.name,state:malformed},async()=>{},validate))
  assert.equal(await store.head(),head)
  assert.deepEqual(await open().read(bundle.name),edited)
  assert.deepEqual(edited.agents['A-title'],sample.agents['A-title'])
  const broken=structuredClone(edited);broken.agents['A-reading'].model_access='invalid'
  await assert.rejects(applyPanelEdit(store,{skill:bundle.name,state:broken},async()=>{},validate))
  assert.equal(await store.head(),head)
  assert.deepEqual(await open().read(bundle.name),edited)
  // Use the actual Remote integrity gate, not only the raw schema write helper.
  const remote=Object.create(DesignPanelRemote.prototype)
  const project={projectId:'11111111-1111-4111-8111-111111111111'}
  let settlements=0,notifications=0
  remote.design={projectForAgent:async()=>project,withProjectMutationFor:async(_a,_p,op)=>op(),
    withSelectedDesignFilesMutation:async(_a,_fs,_signal,op,entered)=>{entered?.();return op(project,store)},
    requireKitForAgent:()=>kit,designFilesForProject:async()=>store,
    readDesignJournal:async()=>({revision:0,records:[]}),assertProjectSelection(){},
    recordDesignChange:async()=>++settlements}
  const agent={inject(){notifications++}}
  const dangling=structuredClone(edited);delete dangling.skills[dangling.agents['A-reading'].skill_refs[0]]
  await assert.rejects(remote.savePanel(agent,bundle.name,dangling,[],'missing-ref',new AbortController().signal),/missing_reference/)
  assert.equal(await store.head(),head);assert.equal(settlements,0);assert.equal(notifications,0)
  const invalidCollaboration=structuredClone(edited)
  invalidCollaboration.agents['A-reading'].collaborations={row:{agent_ref:'missing',external_target:'Not a bypass',handoff:'Keep full task'}}
  await assert.rejects(remote.savePanel(agent,bundle.name,invalidCollaboration,[],'missing-collaborator',new AbortController().signal),/missing_collaborator/)
  assert.equal(await store.head(),head);assert.equal(settlements,0);assert.equal(notifications,0)
  for(const [field,invalidValue,code] of [['model_source_ref','missing','missing_model_source'],['model_source_ref',' ','missing_model_source'],['model_source_ref','','missing_model_source'],['knowledge_resource_refs',['missing'],'missing_knowledge_resource']]) {
    const invalid=structuredClone(edited);invalid.agents['A-reading'][field]=invalidValue
    await assert.rejects(remote.savePanel(agent,bundle.name,invalid,[],code,new AbortController().signal),new RegExp(code))
    assert.equal(await store.head(),head);assert.equal(settlements,0);assert.equal(notifications,0)
  }
  const clear=applyDesignEditToDraft(edited,bundle.metadata.panelManifest,{section:'agents',record:'A-reading',field:'model_source_ref',value:undefined})
  assert.equal(clear.agents['A-reading'].model_source_ref,undefined)
  await applyPanelEdit(store,{skill:bundle.name,state:clear},async()=>{},validate)
  assert.deepEqual(await open().read(bundle.name),clear,'clearing only the selected reference survives durable reopen')
  for(const key of ['model_connection','model_service','integration_ref'])assert.equal(clear.agents['A-reading'][key],edited.agents['A-reading'][key])
  const valid=structuredClone(edited);valid.agents['A-reading'].notes='Remote saved draft'
  valid.agents['A-reading'].description='' // completeness is not a save gate
  await remote.savePanel(agent,bundle.name,valid,[],'valid-ref',new AbortController().signal)
  assert.deepEqual(await open().read(bundle.name),valid)
  assert.equal(settlements,1);assert.equal(notifications,1)
})
