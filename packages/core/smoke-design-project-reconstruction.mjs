import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESIGN_CORE_PROGRESSION_PROMPT, DesignProjectRegistry, parseDesignCommand, runDesignProjectCommand } from './lib/index.js'
import { RECONSTRUCTION_PRODUCER_METHOD, RECONSTRUCTION_WORKER_METHOD, RECONSTRUCTION_EVIDENCE_METHOD, RECONSTRUCTION_CONVERSION_METHOD } from './src/reconstruction-prompt.ts'
import { producerSystemPrompt, producerPrompt } from './lib/dsh-design-execution-plugin.js'
import { loadDesignKit } from './lib/kit-loader.js'
import { stat } from 'node:fs/promises'

// Exercise the real installed contract loading and the exact prompt builders
// used by the runtime, not an independently reconstructed prompt fixture.
const kitRoot = fileURLToPath(new URL('../skills-web-app/', import.meta.url))
const kit = await loadDesignKit({
  async readText(path) { try { return await readFile(path, 'utf8') } catch { return undefined } },
  async listDir(path) { return readdir(path) },
  async isDirectory(path) { return (await stat(path)).isDirectory() },
}, kitRoot, { sourceId: 'fixture:reconstruction-contract' })
const evidenceTools = { allowed: ['read', 'glob'], unavailableOptional: [] }
for (const installed of kit.skills) {
  const sentinel = `FORWARD-BODY-ONLY:${installed.name}`
  const skill = { ...installed, content: `${installed.content}\n${sentinel}` }
  const ordinary = producerSystemPrompt(skill, evidenceTools, '/source')
  assert.ok(ordinary.includes(skill.content), 'ordinary invocation keeps the complete forward method')
  assert.ok(!ordinary.includes(RECONSTRUCTION_CONVERSION_METHOD), `${skill.name}: source conversion never replaces forward authoring`)
  assert.ok(ordinary.includes('Route unresolved durable user decisions through the active Smart Questions Bundle'))
  const reconstructed = producerSystemPrompt(skill, evidenceTools, '/source', true, kit.resources)
  assert.ok(reconstructed.includes(RECONSTRUCTION_PRODUCER_METHOD), `${skill.name}: same extraction method for every installed Bundle`)
  assert.equal(reconstructed.split(RECONSTRUCTION_CONVERSION_METHOD).length - 1, 1, `${skill.name}: one conversion sequence, not duplicated instructions`)
  assert.ok(reconstructed.includes(RECONSTRUCTION_WORKER_METHOD), `${skill.name}: shared meaning and scope checks also reach the Producer`)
  assert.ok(reconstructed.includes(RECONSTRUCTION_EVIDENCE_METHOD), `${skill.name}: document/code/runtime evidence distinctions reach every Producer`)
  assert.ok(!reconstructed.includes(sentinel), `${skill.name}: no forward body injected during reconstruction`)
  assert.ok(!reconstructed.includes('<design_skill_body>'))
  const conflictingBody = { ...skill, content: 'Choose a new visual direction and invent a representative preview.' }
  assert.equal(producerSystemPrompt(conflictingBody, evidenceTools, '/source', true, kit.resources), reconstructed, `${skill.name}: forward workflow changes cannot affect reconstruction context`)
  assert.ok(!reconstructed.includes('Route unresolved durable user decisions through the active Smart Questions Bundle'))
  assert.equal(reconstructed.split('<bundle_schema>\n\n')[1].split('\n\n</bundle_schema>')[0], installed.metadata.schemaYaml)
  assert.equal(reconstructed.split('<bundle_validation>\n\n')[1].split('\n\n</bundle_validation>')[0], installed.metadata.validationYaml)
  const paths = JSON.parse(reconstructed.split('<bundle_resources>\n\n')[1].split('\n\n</bundle_resources>')[0])
  for (const path of paths) assert.equal(typeof kit.resources[`${skill.name}/${path}`], 'string', 'every advertised resource is actually readable')
  const contractPath = `${skill.name}/reference/artifact-contract.md`
  const contract = kit.resources[contractPath]
  assert.equal(typeof contract, 'string', `${skill.name}: installed Bundle exposes shared field/format semantics without loading its forward workflow`)
  if (contract !== undefined) {
    assert.deepEqual(paths, ['reference/artifact-contract.md'], 'artifact contract is discoverable without dumping asset catalogs')
    assert.ok(installed.content.includes('reference/artifact-contract.md'), 'ordinary authors use the same shared contract')
    for (const [, target] of contract.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      if (!/\.(?:md|yaml|mjs|html)$/u.test(target) || /^https?:/u.test(target)) continue
      const key = resolve('/', dirname(contractPath), target).slice(1)
      assert.equal(typeof kit.resources[key], 'string', `shared contract link resolves: ${key}`)
    }
  }
  for (const mode of ['engage', 'resume']) {
    const prompt = producerPrompt(mode, skill, { reconstruct: true, reconstructionSourceRoot: '/source', brief: 'Restore existing facts.' })
    assert.ok(!prompt.includes('remaining Skill Body work'), 'resume cannot reintroduce the forward method')
    assert.ok(prompt.includes('Restore existing facts.'))
    assert.ok(prompt.includes('"/source"'))
  }
}
const fixture = kit.skills[0]
assert.throws(() => producerSystemPrompt({ ...fixture, metadata: undefined }, evidenceTools, '/source', true), /missing its loaded schema or validation contract/u)
assert.ok(producerSystemPrompt({ ...fixture, metadata: undefined }, evidenceTools, '/source').includes(fixture.content), 'forward mode does not acquire a new metadata prerequisite')

const root = await mkdtemp(join(tmpdir(), 'dsh-design-reconstruction-'))
try {
  const sourceRoot = join(root, 'sample-app')
  await mkdir(join(sourceRoot, '.git'), { recursive: true })
  await writeFile(join(sourceRoot, 'package.json'), '{"name":"sample-app"}\n')

  const registry = new DesignProjectRegistry({
    projectsRoot: join(root, 'projects'),
    stateRoot: join(root, 'state'),
  })
  const invocation = parseDesignCommand(`reconstruct ${sourceRoot}`)
  assert.equal(invocation?.verb, 'reconstruct')

  let selectedProjectId
  const context = {
    projects: {
      async create(name) {
        assert.ok(name.endsWith('-reconstructed'))
        return registry.create(name, { provider: 'ladybug-wasm' })
      },
      async inspectReconstructionSource(reference) {
        return registry.inspectReconstructionSource(reference)
      },
      async list() { return registry.list() },
      async snapshot(projectId) { return registry.snapshot(projectId) },
    },
    conversation: {
      async current() { return undefined },
      async select(record) {
        selectedProjectId = record.projectId
        return { revision: 1 }
      },
    },
  }
  const result = await runDesignProjectCommand(invocation, context)

  assert.equal(result.kind, 'success')
  assert.ok(selectedProjectId)
  assert.match(result.text, /已创建材料重建设计项目并打开/u)
  assert.match(result.conversationPrompt, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  assert.match(result.conversationPrompt, /select_design_mindset/u)
  assert.match(result.conversationPrompt, /不得无脑运行整个 Kit/u)
  assert.match(result.conversationPrompt, /reconstruct=true/u)
  // These assert guidance delivery, not model adherence or reconstruction quality.
  // Both command entry and active-Kit continuation must preserve the same scope
  // procedure, including bounded inputs and exclusions supported by evidence.
  for (const prompt of [result.conversationPrompt, DESIGN_CORE_PROGRESSION_PROMPT]) {
    assert.ok(prompt.includes(RECONSTRUCTION_EVIDENCE_METHOD), 'command and continuation share the same source-authority method')
    for (const rule of [
      'Establish the reconstruction target before selecting Bundles',
      'An explicit user-selected subsystem or perspective sets the scope',
      'the evidenced product as a whole, not whichever component is read first',
      'a single file or limited materials can support only a partial reconstruction',
      'ask one focused scope question rather than silently choosing one',
      'Use bounded breadth before local depth',
      'not a new scope file, schema or approval stage',
      'Before excluding a dimension, check the reason',
      'any counterevidence already encountered',
      'none means the capability does not exist',
      'pass the same overall product scope',
      'Separate overall scope from execution order',
      'doing the core first does not exclude other in-scope surfaces',
      "Judge relevance by the Bundle's documented purpose and source evidence",
      'already located source-relative files and symbols or sections',
      'Label suggested search locations as unverified',
      'not whole source files or the entire exploration history',
      'A Bundle assignment is not a redefinition of the whole product',
      'update the shared understanding and affected briefs before dependent work',
      "the user's scope separately from the Agent's interpreted target",
      'including work scheduled for later',
      'Do not infer full coverage from the set of Bundles that happened to run',
    ]) assert.ok(prompt.includes(rule), `Missing reconstruction scope guidance: ${rule}`)
  }
  // Producer guidance permits focused rereading and discovery when needed;
  // it must not turn an efficiency instruction into blind trust in the brief.
  for (const rule of [
    'Start at the located files and symbols or sections in the brief',
    'Do not restart a root-level product survey merely because this is a fresh Producer',
    'Read applicable source instructions',
    'if a location is missing, stale or insufficient, search locally',
    'Broader inspection is justified by a concrete unresolved claim',
    'avoiding repeated discovery never means skipping source verification',
    'report the evidence to the main Agent for scope reconciliation',
  ]) assert.ok(RECONSTRUCTION_PRODUCER_METHOD.includes(rule), `Missing Producer reading guidance: ${rule}`)
  // The command hands this same bounded procedure to the main Agent; it does
  // not install a background completion hook or change advisory acceptance.
  assert.match(result.conversationPrompt, /one independent read-only review/u)
  assert.match(result.conversationPrompt, /After the selected Producers and their Workers have settled/u)
  assert.match(result.conversationPrompt, /native foreground\/wait-for-result mode/u)
  assert.match(result.conversationPrompt, /explicitly set run_in_background: false/u)
  assert.match(result.conversationPrompt, /same human-request turn before the final handoff/u)
  assert.match(result.conversationPrompt, /do not start a background reviewer and end the turn/u)
  assert.match(result.conversationPrompt, /If foreground review is unavailable, perform the checks directly/u)
  assert.match(result.conversationPrompt, /background notification does not authorize starting Design work/u)
  assert.match(result.conversationPrompt, /same capability/u)
  assert.match(result.conversationPrompt, /independent review was not obtained/u)
  assert.match(result.conversationPrompt, /Report validation scope precisely/u)
  assert.match(result.conversationPrompt, /recheck affected consumers with their existing validators/u)
  assert.match(result.conversationPrompt, /normal acceptance\/receipt rules/u)
  assert.match(result.conversationPrompt, /Do not launch repeated whole-project reviews/u)
  assert.match(result.conversationPrompt, /not independent corroboration of source evidence/u)
  assert.match(result.conversationPrompt, /not expected answers/u)
  assert.match(result.conversationPrompt, /byte-for-byte/u)
  assert.match(result.conversationPrompt, /before starting the owning Producer/u)
  assert.match(result.conversationPrompt, /A later asset copy requires a new owning-Bundle validation\/publication/u)
  assert.doesNotMatch(result.conversationPrompt, /never modify, copy, index|不要修改、复制/u)

  const created = await registry.require(selectedProjectId)
  const materials = join(root, 'materials without git')
  await mkdir(materials)
  const document = join(materials, 'product.md')
  await writeFile(document, '# Product\nExisting product requirements\n')
  const image = join(materials, 'screen.png')
  await writeFile(image, Buffer.from([137, 80, 78, 71]))
  for (const path of [materials, document, image]) {
    const inspected = await registry.inspectReconstructionSource(path)
    assert.equal(inspected.sourceRoot, path)
    assert.ok(inspected.suggestedProjectName.endsWith('-reconstructed'))
    const commandResult = await runDesignProjectCommand(parseDesignCommand(`reconstruct ${path}`), context)
    assert.equal(commandResult.kind, 'success')
    assert.ok(commandResult.conversationPrompt.includes(JSON.stringify(path)))
    assert.match(commandResult.conversationPrompt, /single file/u)
  }
  await assert.rejects(registry.inspectReconstructionSource(join(root, 'missing')))
  await assert.rejects(registry.inspectReconstructionSource(join(created.root, 'project.json')), /use \/design recover/u)
  assert.equal(await readFile(document, 'utf8'), '# Product\nExisting product requirements\n')
  assert.equal(created.kit, undefined)
  assert.deepEqual(await readdir(created.designFilesRoot), [])
  assert.equal(await readFile(join(sourceRoot, 'package.json'), 'utf8'), '{"name":"sample-app"}\n')
  await assert.rejects(
    registry.inspectReconstructionSource(created.root),
    /use \/design recover/u,
  )
  await assert.rejects(
    registry.inspectReconstructionSource('relative/repo'),
    /source path must be absolute/u,
  )

  const legacyProject = join(root, 'legacy-project')
  await mkdir(join(legacyProject, '.git'), { recursive: true })
  await mkdir(join(legacyProject, 'design_files'), { recursive: true })
  await assert.rejects(
    registry.inspectReconstructionSource(legacyProject),
    /use \/design recover/u,
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('DESIGN PROJECT RECONSTRUCTION OK')
