import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, stat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parse } from 'yaml'
import { DesignFilesStore } from '../../core/src/design-files.ts'
import { GitVersioning } from '../../core/src/git.ts'
import { applyPanelEdit } from '../../core/src/panel-save.ts'
import { validatorFromSchemaYaml } from '../../core/src/schema.ts'
import { applyDesignEditToDraft } from '../src/record-state.ts'

// Real canonical save/validation/Git path; no host notification or model is simulated.
test('native presentation edits persist through the existing save path and retain sibling data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'panel-native-save-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fs = {
    readText: async path => { try { return await readFile(path, 'utf8') } catch(error) { if(error.code === 'ENOENT') return undefined; throw error } },
    writeText: async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) },
    ensureDir: path => mkdir(path, { recursive: true }), listDir: readdir,
    isDirectory: async path => (await stat(path)).isDirectory(), realPath: realpath,
  }
  const exec = promisify(execFile)
  const spawn = async ({ argv, cwd, env }) => { try { return { exitCode: 0, ...await exec(argv[0], argv.slice(1), { cwd, env: {...process.env, ...env} }) } } catch(error) { return { exitCode: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' } } }
  const git = new GitVersioning(spawn, directory, 'design_files'); await git.ensureRepo()
  const open = () => new DesignFilesStore(fs, new GitVersioning(spawn, directory, 'design_files'), join(directory, 'design_files'))
  const store = open()
  const base = new URL('../../skills-web-app/bundles/function_modules/', import.meta.url)
  const manifest = parse(await readFile(new URL('panel.yaml', base), 'utf8'))
  const validate = validatorFromSchemaYaml(await readFile(new URL('schema.yaml', base), 'utf8'))
  const original = {functions:{a:{function_id:'a',function_name:'Capture',function_description:'Before',function_epic:'Tasks',priority:'High',details:{situation:'Preserved usage scenario'}},b:{function_id:'b',function_name:'Review',function_description:'Unchanged',function_epic:'Tasks'}}}
  await applyPanelEdit(store, {skill:'function_modules',state:original}, async()=>{}, validate)
  let draft = applyDesignEditToDraft(original,manifest,{section:'functions',record:'a',field:'function_description',value:'After'})
  draft = applyDesignEditToDraft(draft,manifest,{section:'functions',record:'a',field:'priority',value:'Low'})
  await applyPanelEdit(store,{skill:'function_modules',state:draft},async()=>{},validate)
  assert.deepEqual(await open().read('function_modules'),draft)
  assert.deepEqual(draft.functions.b,original.functions.b)
  assert.deepEqual(draft.functions.a.details,original.functions.a.details)
  const head = await store.head()
  const invalid = structuredClone(draft); invalid.functions.a.priority='invalid'
  await assert.rejects(applyPanelEdit(store,{skill:'function_modules',state:invalid},async()=>{},validate))
  assert.equal(await store.head(),head)
  assert.deepEqual(await open().read('function_modules'),draft)
  const aiBase = new URL('../../skills-web-app/bundles/ai_agent_capabilities/',import.meta.url)
  const aiManifest = parse(await readFile(new URL('panel.yaml',aiBase),'utf8'))
  const aiValidate = validatorFromSchemaYaml(await readFile(new URL('schema.yaml',aiBase),'utf8'))
  const ai = JSON.parse(await readFile(new URL('reference/preview.json',aiBase),'utf8'))
  await applyPanelEdit(store,{skill:'ai_agent_capabilities',state:ai},async()=>{},aiValidate)
  const edited = applyDesignEditToDraft(ai,aiManifest,{section:'skills',record:ai.agents['A-reading'].skill_refs[0],field:'body',
    value:'# Complete manual method\n\nPreserve user constraints, evidence and failure handling.'})
  await applyPanelEdit(store,{skill:'ai_agent_capabilities',state:edited},async()=>{},aiValidate)
  assert.deepEqual(await open().read('ai_agent_capabilities'),edited)
  assert.deepEqual(edited.agents['A-title'],ai.agents['A-title'])
  assert.deepEqual(edited.tools,ai.tools)
  assert.deepEqual(await open().read('function_modules'),draft)
})
