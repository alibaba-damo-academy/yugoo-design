/**
 * Load the current web_app content package through its declared Kit entry.
 * Check mounted methods, exact versions, retained resources and conditional
 * presentation slots, including malformed and unreadable-content negatives.
 * This consumes freshly built Core lib; it does not execute a model or Host.
 * Run: node scripts/smoke-kit-load.mjs
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { DESIGN_CORE_PROGRESSION_PROMPT, renderDesignSkillCatalog } from '../packages/core/lib/index.js'
import { loadDesignKit } from '../packages/core/lib/kit-loader.js'

const loadFixtureKit = (fs, root) => loadDesignKit(fs, root, { sourceId: 'fixture:smoke-kit-load' })

const kitDir = fileURLToPath(new URL('../packages/skills-web-app/', import.meta.url))

const fs = {
  readText: async (p) => { try { return await readFile(p, 'utf8') } catch { return undefined } },
  listDir: async (p) => { try { return await readdir(p) } catch { return [] } },
  isDirectory: async (p) => (await stat(p)).isDirectory(),
}

const kit = await loadFixtureKit(fs, kitDir)
console.log('kit name:', kit.name)
console.log('skills:', kit.skills.map((s) => s.name).join(', '))
for (const skill of kit.skills) {
  const expected = ['smart_questions', 'research'].includes(skill.name) ? 'main' : 'subagent'
  if ((skill.execution.mode ?? 'subagent') !== expected) throw new Error(`unexpected execution mode for ${skill.name}`)
}

if (kit.name !== 'web_app') throw new Error(`expected kit name web_app, got ${kit.name}`)
if (kit.mindset.length < 100) throw new Error('mindset body too short')
const installedMindsetSource = await readFile(`${kit.sourceRoot}/mindset.md`, 'utf8')
if (kit.mindsetSource !== installedMindsetSource) throw new Error('directory loader did not retain the exact raw mindset.md source')
if (!kit.mindsetSource.startsWith('---\n')) throw new Error('retained mindset source must include the installed frontmatter')
for (const deadReference of ['<design_decision_policy>', '<design_loop>']) {
  if (kit.mindset.includes(deadReference)) throw new Error(`mindset references absent host section ${deadReference}`)
}
for (const coreRule of [
  'After run_design_skill returns completed',
  'intrinsic completion requirement of the explicitly requested output',
  'Recommend one to three genuine alternatives',
  'through the host-native question mechanism (ask_user_question)',
  'conversation-language title from the injected catalog',
  'never invent, translate, rename, or concatenate a Bundle identifier into a visible option',
  'Map a returned Bundle title back to the exact Bundle id through the same pinned injected catalog',
  'when it matches none of the offered actions or catalog titles, treat it as no selection and never guess an id',
  'A valid host-native answer is the visible user decision receipt',
  'first emit one concise conversation-language acknowledgement',
  'never jump silently from the answered question to the tool call',
  'never fabricate a duplicate human message',
  'reserve one option for the conversation-language action',
  'The advisory-review action and the explicitly offered scene-experience actions below are non-catalog choices, never Bundle aliases',
  'A validator finding, advisory item, suggested recovery, ordinary evidence dependency, or newly discovered inconsistency is not that explicit request',
  'obtain a new host-native selection or direct user instruction instead of silently invoking its owning Bundle',
  'never ask again',
  'route grouped editable decisions through run_design_skill with that question skill',
  'is a Question Bundle round even when it contains exactly one question',
  'A direct conversation or host-native blocking question is permitted only for a transient non-Design prerequisite',
  'Never call run_design_skill before Kit activation',
  "never treat a previous project's Kit or catalog as active",
  'installed Kit resources, not Design Project WorkingCopy files',
  'During an active Bundle invocation',
]) {
  if (!DESIGN_CORE_PROGRESSION_PROMPT.includes(coreRule)) throw new Error(`Design Core missing progression rule: ${coreRule}`)
  if (kit.mindset.includes(coreRule)) throw new Error(`mindset duplicates Design Core progression rule: ${coreRule}`)
}
for (const mindsetRule of [
  'These relations never impose a fixed execution order',
  'Maintain the coherent product background',
  'its result is a set of high-fidelity pages, never unstyled wireframes',
  'first run `design_style` with a brief to derive a product-appropriate, unconfirmed baseline',
]) {
  if (!kit.mindset.includes(mindsetRule)) throw new Error(`mindset missing Kit calibration rule: ${mindsetRule}`)
}

const pageSkill = kit.skills.find(skill => skill.name === 'page_design')
if (pageSkill === undefined) throw new Error('web_app Kit missing page_design')
for (const rule of [
  'A valid Design Style result is required before Page HTML generation',
  'Script success does not replace',
  'Never create a provisional map',
]) {
  if (!pageSkill.content.includes(rule)) throw new Error(`page_design missing visual-baseline rule: ${rule}`)
}

const catalog = renderDesignSkillCatalog(kit)
for (const catalogRule of [
  'run_design_skill always takes the exact id',
  'maps back to its id only through this same pinned catalog',
]) {
  if (!catalog.includes(catalogRule)) throw new Error(`skill catalog missing mapping rule: ${catalogRule}`)
}
for (const skill of kit.skills) {
  for (const line of [
    `- id: ${skill.name}`,
    `title: zh「${skill.title.zh}」en「${skill.title.en}」`,
    `label: zh「${skill.label.zh}」en「${skill.label.en}」`,
    `description: ${skill.description}`,
  ]) {
    if (!catalog.includes(line)) throw new Error(`skill catalog missing ${skill.name} line: ${line}`)
  }
}

const yamlReformatted = await loadFixtureKit({
  ...fs,
  readText: async (path) => {
    const text = await fs.readText(path)
    return text !== undefined && path.endsWith('/smart_questions/skill.yaml') ? `\n${text}\n` : text
  },
}, kitDir)
if (yamlReformatted.version !== kit.version) throw new Error('YAML-only whitespace changed the Kit version')
const reformattedSkill = yamlReformatted.skills.find((skill) => skill.name === 'smart_questions')
if (!reformattedSkill?.metadata?.skillYaml?.startsWith('\n')) throw new Error('whitespace probe did not reach the loader; stability check is vacuous')

// Identity is the declared name+version: every Bundle pins the explicit
// version its skill.yaml declares, and content edits never move it
// (same-version hot update).
// The official Web App 1.1 release explicitly pins corrected Flow 1.1.
// Other Bundle pins remain 1.0; ordinary resource edits below do not retarget them.
if (kit.version !== '1.1') throw new Error(`kit version ${kit.version} does not match the declared 1.1`)
for (const skill of kit.skills) {
  const expectedVersion = skill.name === 'flow_design' ? '1.1' : '1.0'
  if (skill.version !== expectedVersion) throw new Error(`skill ${skill.name} version ${skill.version} does not match ${expectedVersion}`)
}

const resourceChanged = await loadFixtureKit({
  ...fs,
  readText: async (path) => {
    const text = await fs.readText(path)
    return text !== undefined && path.endsWith('/research/reference/trusted_sources.md') ? `${text}\nversion probe\n` : text
  },
}, kitDir)
if (resourceChanged.version !== kit.version) throw new Error('resource content changed the declared Kit version')
for (const skill of resourceChanged.skills) {
  if (skill.version !== kit.skills.find(entry => entry.name === skill.name)?.version) throw new Error(`resource change moved the declared version of ${skill.name}`)
}
const resourcePath = 'research/reference/trusted_sources.md'
if (kit.resources[resourcePath] === undefined) throw new Error('validated Kit did not retain immutable resources')
if (!resourceChanged.resources[resourcePath]?.includes('version probe')) throw new Error('changed load did not retain its resource bytes')

// A single-Bundle content change is a hot update: declared versions stay.
const skillChanged = await loadFixtureKit({
  ...fs,
  readText: async (path) => {
    const text = await fs.readText(path)
    return text !== undefined && path.endsWith('/smart_questions/SKILL.md') ? `${text}\nversion probe\n` : text
  },
}, kitDir)
if (skillChanged.version !== kit.version) throw new Error('SKILL.md content changed the declared Kit version')
for (const skill of skillChanged.skills) {
  if (skill.version !== kit.skills.find(entry => entry.name === skill.name)?.version) throw new Error(`SKILL.md change moved the declared version of ${skill.name}`)
}

// Kit-level inputs are hot updates too: a mindset-only change keeps every
// declared version.
const mindsetChanged = await loadFixtureKit({
  ...fs,
  readText: async (path) => {
    const text = await fs.readText(path)
    return text !== undefined && path.endsWith('/mindset.md') ? `${text}\nversion probe\n` : text
  },
}, kitDir)
if (mindsetChanged.version !== kit.version) throw new Error('mindset content changed the declared Kit version')
for (const skill of mindsetChanged.skills) {
  if (skill.version !== kit.skills.find(entry => entry.name === skill.name)?.version) throw new Error(`mindset change moved the declared version of ${skill.name}`)
}

// An advertised but unreadable resource must fail publication loudly.
let unreadableRejected = false
try {
  await loadFixtureKit({
    ...fs,
    readText: async (path) => {
      if (path.endsWith('/research/reference/trusted_sources.md')) return undefined
      return fs.readText(path)
    },
  }, kitDir)
} catch (error) {
  unreadableRejected = error instanceof Error && /cannot read Bundle resource/.test(error.message)
}
if (!unreadableRejected) throw new Error('unreadable advertised resource did not fail Kit loading')

// Fail-loud version grammar: missing or malformed declared versions reject
// publication instead of defaulting.
const rejectLoad = async (transform, expectedMessage, label) => {
  try {
    await loadFixtureKit({ ...fs, readText: transform(fs.readText) }, kitDir)
  } catch (error) {
    if (error instanceof Error && expectedMessage.test(error.message)) return
    throw new Error(`${label} failed with an unexpected error: ${error instanceof Error ? error.message : String(error)}`)
  }
  throw new Error(`${label} did not fail Kit loading`)
}
await rejectLoad(
  (readText) => async (path) => {
    const text = await readText(path)
    return text !== undefined && path.endsWith('/mindset.md') ? text.replace(/^version: [^\n]+\n/m, '') : text
  },
  /mindset file missing "version" frontmatter/,
  'missing Kit version',
)
await rejectLoad(
  (readText) => async (path) => {
    const text = await readText(path)
    return text !== undefined && path.endsWith('/mindset.md') ? text.replace(/^version: [^\n]+/m, 'version: "1"') : text
  },
  /invalid Design Kit version/,
  'malformed Kit version',
)
await rejectLoad(
  (readText) => async (path) => {
    const text = await readText(path)
    return text !== undefined && path.endsWith('/smart_questions/skill.yaml') ? text.replace(/^version: "1\.0"\n/m, '') : text
  },
  /smart_questions\/skill\.yaml must declare a top-level version/,
  'missing Bundle version',
)
await rejectLoad(
  (readText) => async (path) => {
    const text = await readText(path)
    return text !== undefined && path.endsWith('/smart_questions/skill.yaml') ? text.replace(/^version: "1\.0"/m, 'version: "one.zero"') : text
  },
  /invalid Bundle version/,
  'malformed Bundle version',
)
await rejectLoad(
  (readText) => async (path) => {
    const text = await readText(path)
    return text !== undefined && path.endsWith('/smart_questions/skill.yaml') ? text.replace(/^title:\n(?:[ \t]+.*\n)+/m, '') : text
  },
  /smart_questions\/skill\.yaml title must be a bilingual object/,
  'missing bilingual title',
)
await rejectLoad(
  (readText) => async (path) => {
    const text = await readText(path)
    return text !== undefined && path.endsWith('/smart_questions/skill.yaml') ? text.replace(/^(label:\n[ \t]+zh: .*\n)[ \t]+en: .*\n/m, '$1') : text
  },
  /smart_questions\/skill\.yaml label\.en must be a non-empty string/,
  'missing bilingual label language',
)
await rejectLoad(
  (readText) => async (path) => {
    const text = await readText(path)
    if (text === undefined || !path.endsWith('/smart_questions/locales/en-US.json')) return text
    const locale = JSON.parse(text)
    delete locale.bundleDescription
    return JSON.stringify(locale)
  },
  /description\.en must be a non-empty string/,
  'missing bilingual picker description language',
)
await rejectLoad(
  (readText) => async (path) => {
    const text = await readText(path)
    return text !== undefined && path.endsWith('/smart_questions/skill.yaml') ? text.replace(/^title:\n  zh: .*\n  en: .*\n/m, 'title:\n  zh: 调研分析\n  en: Research\n') : text
  },
  /title "(Research|调研分析)" is declared by both/,
  'duplicate per-locale title',
)

await rejectLoad(
  readText => async path => path.endsWith('/smart_questions/panel.yaml') ? undefined : readText(path),
  /missing required declarative slot/,
  'missing declarative Panel',
)
await rejectLoad(
  readText => async path => {
    const text = await readText(path)
    if (text === undefined || !path.endsWith('/smart_questions/skill.yaml')) return text
    return JSON.stringify({ ...parse(text), summary: { fields: 'not-a-list' } })
  },
  /skill\.yaml summary.*invalid:[\s\S]*fields must be a list/,
  'invalid explicit summary',
)
const withoutSummary = await loadFixtureKit({
  ...fs,
  readText: async path => {
    const text = await fs.readText(path)
    if (text === undefined || !path.endsWith('/smart_questions/skill.yaml')) return text
    const manifest = parse(text)
    delete manifest.summary
    return JSON.stringify(manifest)
  },
}, kitDir)
const unadorned = withoutSummary.skills.find(skill => skill.name === 'smart_questions')
if (unadorned.metadata.rendererManifest !== undefined || unadorned.metadata.panelManifest === undefined) {
  throw new Error('optional summary omission must preserve the declarative Panel without inventing a summary')
}

const expected = [
  'smart_questions',
  'research',
  'function_modules',
  'ai_agent_capabilities',
  'flow_design',
  'design_style',
  'business_data',
  'business_rules',
  'role_access',
  'integration_design',
  'notification_design',
  'quality_acceptance',
  'page_design',
  'web_app_prd_assembly',
  'whiteboard',
]
const extensionPrerequisites = {
  business_data: ['function_modules', 'flow_design'],
  business_rules: ['function_modules', 'flow_design'],
  role_access: ['function_modules', 'flow_design'],
  integration_design: ['research', 'function_modules'],
  notification_design: ['flow_design', 'design_style'],
  quality_acceptance: ['smart_questions', 'flow_design'],
  page_design: ['function_modules', 'design_style'],
}
const postWriteSelfCheckSkills = new Set([
  ...Object.keys(extensionPrerequisites),
  'web_app_prd_assembly',
])
const forbiddenModelToolNames = [
  'write_design_json',
  'edit_design_json',
  'read_design_json',
  'record_design_clarity',
  'validate_skill_artifacts',
  'render_prd_pdf',
  'commit_design_style_preview',
  'commit_bpmn',
  'commit_research_direction',
  'commit_research_conclusion',
]
if (kit.skills.map((skill) => skill.name).join(',') !== expected.join(',')) {
  throw new Error(`unexpected Web App catalog: ${kit.skills.map((skill) => skill.name).join(', ')}`)
}
for (const name of expected) {
  const skill = kit.skills.find((s) => s.name === name)
  if (skill === undefined) throw new Error(`missing skill ${name}`)
  if (skill.content.length < 100) throw new Error(`skill ${name} has no SKILL.md body`)
  const prerequisites = extensionPrerequisites[name]
  if (prerequisites !== undefined) {
    for (const owner of prerequisites) {
      if (!skill.content.includes(`\`${owner}\``)) throw new Error(`skill ${name} missing prerequisite owner ${owner}`)
    }
    if (!skill.content.includes('This evidence relationship is not a fixed execution order')) {
      throw new Error(`skill ${name} turns prerequisite evidence into a workflow order`)
    }
  }
  if (postWriteSelfCheckSkills.has(name)) {
    for (const required of name === 'page_design' ? [
      'Script success does not replace this review',
      'report the checks actually performed plus remaining gaps',
    ] : [
      name === 'web_app_prd_assembly' ? 'pinned owner evidence' : 'revision-pinned Design projection',
      'at most one focused follow-up',
      'Ask the user when',
      'non-blocking evidence gap',
      'retrying indefinitely',
      'G/R/A owns ongoing cross-Bundle drift checks',
    ]) {
      if (!skill.content.replace(/\s+/gu, ' ').includes(required)) throw new Error(`skill ${name} missing post-write self-check policy: ${required}`)
    }
  }
  for (const toolName of forbiddenModelToolNames) {
    if (skill.content.includes(toolName)) throw new Error(`skill ${name} exposes removed model tool ${toolName}`)
  }
  if (typeof skill.metadata?.schemaYaml !== 'string') throw new Error(`skill ${name} missing schemaYaml`)
  if (typeof skill.metadata?.skillYaml !== 'string') throw new Error(`skill ${name} missing skillYaml`)
  for (const field of ['title', 'label', 'pickerDescription']) {
    for (const language of ['zh', 'en']) {
      const text = skill[field]?.[language]
      if (typeof text !== 'string' || text.trim() === '') throw new Error(`skill ${name} missing ${field}.${language}`)
    }
  }
  const mode = parse(skill.metadata.skillYaml).presentation?.mode
  for (const key of ['panelYaml', 'panelManifest']) {
    if (mode === 'declarative' && skill.metadata?.[key] === undefined) throw new Error(`declarative skill ${name} missing ${key}`)
    if (mode !== 'declarative' && skill.metadata?.[key] !== undefined) throw new Error(`non-declarative skill ${name} carries ${key}`)
  }
  if (skill.metadata.rendererMd !== undefined) throw new Error(`skill ${name} retains a retired renderer.md instead of skill.yaml.summary`)
}
for (const [path, content] of Object.entries(kit.resources)) {
  for (const toolName of forbiddenModelToolNames) {
    if (content.includes(toolName)) throw new Error(`Bundle resource ${path} exposes removed model tool ${toolName}`)
  }
}

const researchSkill = kit.skills.find((skill) => skill.name === 'research')
const researchSchema = parse(researchSkill.metadata.schemaYaml)
const roundSchema = researchSchema.properties.rounds.value
const directionSchema = roundSchema.properties.directions.value
if (!roundSchema.required.includes('stage')) throw new Error('research rounds must materialize stage at the structured-output boundary')
if (directionSchema.required.includes('status')) throw new Error('research direction execution status must remain outside authored Design state')
if (!('findings_file' in directionSchema.properties) || !('conclusion_file' in roundSchema.properties)) {
  throw new Error('research must expose direct findings and conclusion artifact references')
}

// Common slots and presentation-specific files use the resolved Bundle root,
// never the transport package's retired skills/ directory.
const REQUIRED_SLOTS = ['SKILL.md', 'skill.yaml', 'schema.yaml', 'validation.yaml']
for (const name of expected) {
  const base = kit.skills.find(skill => skill.name === name)?.resourceRoot
  if (!base) throw new Error(`missing resolved resource root for ${name}`)
  for (const slot of REQUIRED_SLOTS) {
    const text = await fs.readText(`${base}/${slot}`)
    if (text === undefined || text.trim() === '') throw new Error(`skill ${name} missing slot ${slot}`)
  }
  const skillYaml = parse(await readFile(`${base}/skill.yaml`, 'utf8'))
  const panel = await fs.readText(`${base}/panel.yaml`)
  if (skillYaml.presentation?.mode === 'declarative' ? !panel?.trim() : panel !== undefined) {
    throw new Error(`skill ${name}: panel.yaml disagrees with presentation.mode`)
  }
  if (await fs.readText(`${base}/renderer.md`) !== undefined) {
    throw new Error(`skill ${name}: summary belongs in skill.yaml, not renderer.md`)
  }
  if (skillYaml.description !== undefined) throw new Error(`skill ${name}: routing description belongs in SKILL.md frontmatter`)
  if (skillYaml.name !== name) throw new Error(`skill ${name}: skill.yaml name=${skillYaml.name}`)
  if (!Number.isInteger(skillYaml.order)) throw new Error(`skill ${name}: skill.yaml missing integer order`)
  if (typeof skillYaml.execution !== 'object' || skillYaml.execution === null || Array.isArray(skillYaml.execution)) {
    throw new Error(`skill ${name}: skill.yaml execution must be an object`)
  }
  const executionKeys = Object.keys(skillYaml.execution)
  if (executionKeys.some((key) => !['handoff', 'resume_action', 'mode'].includes(key))) {
    throw new Error(`skill ${name}: skill.yaml execution carries retired authority fields`)
  }
  if (!['none', 'must_edit', 'user_continue'].includes(skillYaml.execution.handoff)) {
    throw new Error(`skill ${name}: skill.yaml execution.handoff invalid`)
  }
  if (skillYaml.execution.handoff === 'user_continue') {
    if (
      typeof skillYaml.execution.resume_action !== 'object'
      || skillYaml.execution.resume_action === null
      || Array.isArray(skillYaml.execution.resume_action)
      || typeof skillYaml.execution.resume_action.route_id !== 'string'
      || skillYaml.execution.resume_action.route_id.trim() === ''
    ) {
      throw new Error(`skill ${name}: user_continue execution missing resume_action`)
    }
  } else if (skillYaml.execution.resume_action !== undefined) {
    throw new Error(`skill ${name}: non-user_continue execution carries resume_action`)
  }
  const validationYaml = parse(await readFile(`${base}/validation.yaml`, 'utf8'))
  if (validationYaml.skill !== name) throw new Error(`skill ${name}: validation.yaml skill mismatch`)
  if (!Array.isArray(validationYaml.rules) || validationYaml.rules.length === 0) {
    throw new Error(`skill ${name}: validation.yaml has no rules`)
  }
  for (const rule of validationYaml.rules) {
    if (typeof rule.code !== 'string' || !rule.code.startsWith(`${name}.`)) {
      throw new Error(`skill ${name}: rule ${rule.id} code ${rule.code} not skill-prefixed`)
    }
    if (!Array.isArray(rule.scope) || rule.scope.length === 0) {
      throw new Error(`skill ${name}: rule ${rule.id} has no scope`)
    }
    if (rule.check === undefined) throw new Error(`skill ${name}: rule ${rule.id} has no check`)
  }
  parse(await readFile(`${base}/schema.yaml`, 'utf8'))
  console.log(`${name}: slots complete (${REQUIRED_SLOTS.length} files)`)
}

// References stay Bundle-relative even when Kit and Bundle roots are separate.
const referenceFiles = [
  'research/reference/trusted_sources.md',
  'flow_design/reference/bpmn_authoring.md',
  'design_style/reference/aesthetic_index.yaml',
  'design_style/reference/quality_rubric.md',
]
for (const rel of referenceFiles) {
  const [name, ...parts] = rel.split('/')
  const root = kit.skills.find(skill => skill.name === name)?.resourceRoot
  const text = root ? await fs.readText(`${root}/${parts.join('/')}`) : undefined
  if (text === undefined || text.trim() === '') throw new Error(`missing reference asset ${rel}`)
  if (kit.resources[rel] !== text) throw new Error(`retained reference bytes differ for ${rel}`)
}
const icons = await fs.listDir(`${kit.skills.find(skill => skill.name === 'design_style').resourceRoot}/assets/icons`)
if (!icons.some((f) => f.endsWith('.svg'))) throw new Error('design_style icon assets missing')

console.log('KIT LOAD OK')
