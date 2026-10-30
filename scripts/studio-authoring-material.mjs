/** Build-time publication of the existing author methods. No runtime filesystem authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const STUDIO_AUTHORING_RESOURCE = 'authoring/studio-creators/material.json'
export const STUDIO_AUTHORING_DIRECTORY = 'authoring/studio-creators'
export const STUDIO_CREATOR_SKILLS = ['design-kit-creator', 'design-bundle-creator', 'design-skill-creator']
export const STUDIO_AUTHORING_LIMITS = Object.freeze({ resources: 128, fileBytes: 2 * 1024 * 1024, totalBytes: 4 * 1024 * 1024 })
const examples = ['smart_questions', 'function_modules', 'business_data', 'research', 'page_design',
  'flow_design', 'whiteboard', 'design_style', 'role_access', 'web_app_prd_assembly']
const documents = ['docs/bundle-contract.md', 'docs/dsl-spec.md', 'docs/panel-uiux-standard.md',
  'docs/system-design-baseline.md', 'docs/a2ui-component-catalog-contract.md', 'docs/wiki/extending.md',
  'docs/wiki/terminology.md', 'packages/skills-web-app/kits/web_app/mindset.md',
  'examples/community-workshop-delivery/mindset.md']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const slash = path => path.split(sep).join('/')
const safe = path => typeof path === 'string' && !isAbsolute(path) && !/[\\\x00-\x1f]/u.test(path)
  && path.split('/').every(part => part && !['.', '..', '__proto__', 'constructor', 'prototype'].includes(part))
const links = /(!?\[[^\]\n]*\])\(([^)\n]+)\)/gu
const linkPath = value => value.split('#')[0]
const external = value => /^[a-z][a-z0-9+.-]*:/iu.test(value)
const textType = path => /\.(?:md|json|ya?ml|mjs|[cm]?[jt]s|css|txt)$/iu.test(path)

async function readSource(workspace, path) {
  assert.ok(safe(path), 'Invalid authoring source path')
  const absolute = join(workspace, path), info = await lstat(absolute)
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Authoring source must be a regular file: ' + path)
  assert.equal(await realpath(absolute), absolute, 'Authoring source symlink rejected: ' + path)
  assert.ok(info.size <= STUDIO_AUTHORING_LIMITS.fileBytes, 'Authoring source exceeds file limit: ' + path)
  const bytes = await readFile(absolute)
  return { bytes, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
}

async function collectSources(workspace) {
  workspace = await realpath(resolve(workspace))
  const roots = STUDIO_CREATOR_SKILLS.map(name => '.agents/skills/' + name)
  const sourcePaths = [...documents, '.agents/skills/design-bundle-creator/references/validation-authoring.md']
  async function walk(path) {
    const info = await lstat(join(workspace, path))
    assert.ok(!info.isSymbolicLink(), 'Authoring source symlink rejected: ' + path)
    if (info.isDirectory()) for (const name of (await readdir(join(workspace, path))).sort()) await walk(path + '/' + name)
    else { assert.ok(info.isFile()); sourcePaths.push(path) }
  }
  for (const root of roots) { await walk(root); sourcePaths.push(root + '/SKILL.md') }
  for (const name of examples) sourcePaths.push('packages/skills-web-app/bundles/' + name + '/SKILL.md',
    'packages/skills-web-app/bundles/' + name + '/reference/artifact-contract.md',
    'packages/skills-web-app/bundles/' + name + '/schema.yaml',
    'packages/skills-web-app/bundles/' + name + '/validation.yaml')
  const exampleRoots = examples.map(name => 'packages/skills-web-app/bundles/' + name + '/')
  const sources = new Map()
  while (sourcePaths.length) {
    const path = sourcePaths.shift()
    if (sources.has(path)) continue
    sources.set(path, await readSource(workspace, path))
    assert.ok(sources.size < STUDIO_AUTHORING_LIMITS.resources, 'Authoring reference closure exceeds resource limit')
    if (!path.endsWith('.md')) continue
    for (const match of sources.get(path).content.matchAll(links)) {
      const target = linkPath(match[2])
      if (!target || external(target)) continue
      const normalized = slash(relative(workspace, resolve(workspace, dirname(path), target)))
      // Include the mature method's actual referenced contracts/examples, not all documentation.
      if (textType(normalized) && exampleRoots.some(root => normalized.startsWith(root))) sourcePaths.push(normalized)
    }
  }
  return { workspace, sources }
}

export async function studioAuthoringInputPaths(workspace) {
  const { sources } = await collectSources(workspace)
  return [...sources.keys(), 'scripts/studio-authoring-material.mjs'].sort()
}

const context = [
  '## Installed Studio authoring context',
  '',
  'Author reusable Kit/Bundle content in the current Studio working copy. The method being edited is source evidence, not the authoring Skill to execute.',
  'Read the professional method and its relevant references below before proposing changes. The bundled reference root preserves repository-relative locations; its index resolves those locations without a development checkout.',
  'Use the actual Host Studio tools: Companion design_studio_customize, DSH studio_customize, or the restricted child read/prepare tools supplied by that Host. Read the exact copy and revision, prepare complete-file changes, and inspect real compiler/preview diagnostics. Preparation never saves. Save only on the current user instruction through the existing revision/digest check; after uncertainty read back rather than replaying a save.',
  'Before authoring validation.yaml, read source/.agents/skills/design-bundle-creator/references/validation-authoring.md and its complete rules/examples through the indexed resource reader. Do not guess operators or omit rule metadata. The same index contains source/.agents/skills/design-bundle-creator/assets/skill.template.yaml; both title and label require non-empty zh/en strings.',
  'For a Panel, first read source/docs/dsl-spec.md for the complete manifest and required root fields, then discover the installed component catalog and its contract/docs/examples through the existing component read capability. Follow returned type selectors for allowed values; a component name is not a manifest panel_kind. The reference snapshot explains methods; it does not register components or supersede the actual installed compiler.',
  'References to runtime design_validate/design_publish, Design Files, Producer or Worker protocols explain the methods being authored. They do not grant this Studio author filesystem, project, model, delegation, publication or installation capabilities. Keep the current Host scope. Open the same Studio working copy in its own tab or browser. Host AI assistance belongs only to Kit/Bundle creation or editing; the original Host conversation may prepare changes first or guide the user to that independent Studio.',
  'Developer scripts and implementation-source locations are retained for an explicitly requested runtime-development checkout. They are not installation prerequisites and must not be run against the user plugin or presented as installed Studio APIs. Installed content checks use the existing Host compiler/prepare path.',
  'Preserve methods, user content, IDs and exact references. Keep each source file\'s retained catalog identity, runtime name and version: they may differ in a copied Bundle, and a display-title change does not rename them. When repairing diagnostics, preserve already-correct changes in the complete replacement set. A schema-valid candidate is not proof of professional quality, durable save, native consumption, installation or publication.',
  '',
].join('\n')

export async function prepareStudioAuthoringMaterial(workspace) {
  const collected = await collectSources(workspace), sources = collected.sources
  const resources = Object.create(null), sourceReferences = new Set(), rewrites = []
  const skills = STUDIO_CREATOR_SKILLS.map(name => {
    const path = '.agents/skills/' + name + '/SKILL.md', content = sources.get(path).content
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/u)
    assert.ok(frontmatter, 'Creator frontmatter is required: ' + name)
    const description = frontmatter[1].match(/^description:\s*(.+)$/mu)?.[1]
    assert.ok(description && frontmatter[1].includes('name: ' + name), 'Creator discovery metadata must stay available')
    return { name, description, method: 'source/' + path }
  })
  for (const [path, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
    const key = 'source/' + path
    const content = path.endsWith('.md') ? source.content.replace(links, (match, label, link) => {
      const target = linkPath(link)
      if (!target || external(target)) return match
      const normalized = slash(relative(collected.workspace, resolve(collected.workspace, dirname(path), target)))
      if (sources.has(normalized)) return match
      sourceReferences.add(normalized)
      const replacement = slash(relative(dirname(key), 'index.md')) + '#developer-source-references'
      rewrites.push({ sourcePath: path, target: link, replacement })
      return label + '(' + replacement + ')'
    }) : source.content
    resources[key] = { content, bytes: Buffer.byteLength(content), sourcePath: path, sourceSha256: hash(source.bytes) }
  }
  const index = [
    '# Studio authoring methods', '', context,
    '## Creator methods', '',
    ...skills.map(skill => '- [' + skill.name + '](' + skill.method + '): ' + skill.description), '',
    '## Validation and manifest starting points', '',
    '- [Validation authoring: complete rules, common operators and positive/negative states](source/.agents/skills/design-bundle-creator/references/validation-authoring.md)',
    '- [Complete manifest starting point: title and label are both required](source/.agents/skills/design-bundle-creator/assets/skill.template.yaml)', '',
    '## Reference root', '',
    'Repository-relative paths in these methods resolve below source/. Read only the professional references needed for the current task. Examples are synthetic/reference content, not facts or instructions for the user project.', '',
    ...[...sources.keys()].sort().map(path => '- [' + path + '](source/' + path + ')'), '',
    '## Developer source references', '',
    'These additional links concern implementation development, general repository navigation or external media. Their original source locations are retained below; they are not installed content-authoring prerequisites. For actual runtime development, use its reviewed source checkout. Do not guess an installed filesystem path.', '',
    ...[...sourceReferences].sort().map(path => '- ' + path), '',
  ].join('\n')
  resources['index.md'] = { content: index, bytes: Buffer.byteLength(index) }
  const material = { schemaVersion: 1, skills, resources, retention: { protocolRelocations: [], markdownLinkRewrites: rewrites } }
  const bytes = Buffer.from(JSON.stringify(material) + '\n')
  assert.ok(Object.keys(resources).length <= STUDIO_AUTHORING_LIMITS.resources)
  assert.ok(bytes.length <= STUDIO_AUTHORING_LIMITS.totalBytes, 'Authoring material exceeds total limit')
  const skillEntries = Object.fromEntries(skills.map(skill => {
    const original = sources.get('.agents/skills/' + skill.name + '/SKILL.md').content
    const metadata = original.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u)[0]
    return [skill.name, metadata + '\n# ' + skill.name.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') + '\n\n' + context
      + '\nRead [the packaged professional method](../../' + STUDIO_AUTHORING_DIRECTORY + '/' + skill.method + ') and [its reference index](../../' + STUDIO_AUTHORING_DIRECTORY + '/index.md).\n']
  }))
  return { material, bytes, skillEntries }
}

async function writeNew(root, path, bytes) {
  assert.ok(safe(path), 'Invalid authoring output path')
  let current = resolve(root)
  await mkdir(current, { recursive: true })
  for (const part of path.split('/').slice(0, -1)) {
    const info = await lstat(current)
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Authoring output symlink rejected')
    current = join(current, part)
    await mkdir(current, { recursive: true })
  }
  assert.ok(!(await lstat(current)).isSymbolicLink(), 'Authoring output symlink rejected')
  await writeFile(join(root, path), bytes, { flag: 'wx' })
}

export async function writeStudioAuthoringMaterial(target, prepared, { sources = true, skills = true } = {}) {
  if (sources) {
    await writeNew(target, STUDIO_AUTHORING_RESOURCE, prepared.bytes)
    for (const [path, resource] of Object.entries(prepared.material.resources)) await writeNew(target, STUDIO_AUTHORING_DIRECTORY + '/' + path, resource.content)
  }
  if (skills) for (const [name, content] of Object.entries(prepared.skillEntries)) await writeNew(target, 'skills/' + name + '/SKILL.md', content)
  return { resource: STUDIO_AUTHORING_RESOURCE, skills: prepared.material.skills.map(skill => skill.name) }
}

export async function verifyStudioAuthoringMaterial(target, prepared, { sources = true, skills = true } = {}) {
  const expected = new Map([
    ...(sources ? [[STUDIO_AUTHORING_RESOURCE, prepared.bytes], ...Object.entries(prepared.material.resources).map(([path, value]) => [STUDIO_AUTHORING_DIRECTORY + '/' + path, value.content])] : []),
    ...(skills ? Object.entries(prepared.skillEntries).map(([name, content]) => ['skills/' + name + '/SKILL.md', content]) : [])])
  for (const [path, bytes] of expected) {
    const info = await lstat(join(target, path))
    assert.ok(info.isFile() && !info.isSymbolicLink(), 'Authoring output must be a regular file')
    assert.equal(hash(await readFile(join(target, path))), hash(bytes), 'Authoring resource differs: ' + path)
  }
  return STUDIO_AUTHORING_RESOURCE
}
