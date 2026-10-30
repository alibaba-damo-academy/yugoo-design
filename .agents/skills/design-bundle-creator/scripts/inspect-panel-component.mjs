#!/usr/bin/env node
/** Source-derived authoring reference, not another schema or runtime validator. */
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, relative, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// The complete trusted shared guide has a separate budget from each focused
// component section (16 KiB), the DSL document (256 KiB), and the packaged
// authoring artifact (4 MB). Keep the guide whole; never truncate its methods.
const MAX_SHARED_STANDARD_BYTES = 128 * 1024

async function inspectionContext(repo) {
  repo = resolve(repo)
  const require = createRequire(join(repo, 'package.json'))
  const ts = require('typescript')
  const { PANEL_COMPONENT_CATALOG, GENERATED_COMPONENT_KINDS } = await import(
    pathToFileURL(join(repo, 'packages/core/src/panel-component-catalog.ts')).href)
  const contractPath = 'packages/core/src/panel-dsl.ts'
  const source = ts.createSourceFile(contractPath,
    await readFile(join(repo, contractPath), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = new Map(source.statements
    .filter(node => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
    .map(node => [node.name.text, node]))
  const constants = new Map(source.statements
    .filter(node => ts.isVariableStatement(node) && (node.declarationList.flags & ts.NodeFlags.Const))
    .flatMap(node => [...node.declarationList.declarations])
    .filter(node => ts.isIdentifier(node.name))
    .map(node => [node.name.text, node]))
  // Follow only same-source typeof dependencies. Keep raw declarations rather
  // than evaluating initializers or exposing every implementation constant.
  // A work queue makes even a cyclic dependency graph finite.
  const pending = [...declarations.values()]
  for (let index = 0; index < pending.length; index++) {
    function visit(node) {
      if (ts.isTypeQueryNode(node)) {
        if (!ts.isIdentifier(node.exprName)) {
          throw new Error(`Unsupported local typeof contract reference: ${node.exprName.getText(source)}`)
        }
        const name = node.exprName.text
        const constant = constants.get(name)
        if (!constant) throw new Error(`Unknown local typeof contract constant: ${name}`)
        if (!constant.initializer) throw new Error(`Missing local typeof contract initializer: ${name}`)
        if (declarations.has(name) && declarations.get(name) !== constant) {
          throw new Error(`Ambiguous local typeof contract name: ${name}`)
        }
        if (!declarations.has(name)) {
          declarations.set(name, constant)
          pending.push(constant)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(pending[index])
  }
  return { repo, ts, PANEL_COMPONENT_CATALOG, GENERATED_COMPONENT_KINDS, contractPath, source, declarations }
}

export async function inspectPanelComponent(repo, name, typeName, options = {}) {
  return inspectWithContext(await inspectionContext(repo), name, typeName, options)
}

async function inspectWithContext(context, name, typeName, options = {}) {
  const { repo, ts, PANEL_COMPONENT_CATALOG, GENERATED_COMPONENT_KINDS, contractPath, source, declarations } = context
  if (!Object.hasOwn(PANEL_COMPONENT_CATALOG, name)) throw new Error(`Unknown component: ${name}`)
  function contract(name) {
    const [root, ...properties] = name.split('.')
    let node = declarations.get(root)
    if (!node) throw new Error(`Unknown local contract type: ${name}`)
    for (const property of properties) {
      const members = ts.isInterfaceDeclaration(node) ? node.members
        : node.type && ts.isTypeLiteralNode(node.type) ? node.type.members : undefined
      node = members?.find(member => ts.isPropertySignature(member)
        && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))
        && member.name.text === property)
      if (!node) throw new Error(`Unknown local contract property: ${name}`)
    }
    const references = new Set()
    function visit(child) {
      if (ts.isTypeReferenceNode(child) && ts.isIdentifier(child.typeName)
        && declarations.has(child.typeName.text) && child.typeName.text !== root) {
        references.add(child.typeName.text)
      }
      if (ts.isTypeQueryNode(child) && ts.isIdentifier(child.exprName)
        && child.exprName.text !== root) {
        references.add(child.exprName.text)
      }
      ts.forEachChild(child, visit)
    }
    visit(node)
    return {
      name, file: contractPath,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      declaration: node.getText(source),
      references: [...references].sort().map(name => ({ name, read: `--type ${name}` })),
    }
  }
  const base = {
    component: name, ...PANEL_COMPONENT_CATALOG[name],
    generated: GENERATED_COMPONENT_KINDS.includes(name),
    protocolStatus: 'Local PanelManifest component; not a claim of standard A2UI interoperability.',
    limits: [
      'Shared TypeScript types are not per-component JSON Schema; optional properties may be constrained by the runtime validator.',
      'Example validation below checks panel structure only, not Kit schema consistency, rendering or save behavior.',
      'Example records, labels and defaults are not facts for the new Bundle.',
    ],
    documentation: { file: 'docs/dsl-spec.md', read: '--docs' },
    validator: `${contractPath}#parsePanelManifest`,
    bindingValidator: 'packages/core/src/kit-loader.ts#assertDeclarativeConsistency',
    renderer: 'packages/panel/src/interpreter.ts#PANEL_COMPONENT_RENDERERS',
  }
  if (options.documentationOnly) {
    if (typeName) throw new Error('Choose documentation or a focused type contract, not both')
    const path = base.documentation.file
    const text = await readFile(join(repo, path), 'utf8')
    if (Buffer.byteLength(text) > 262144) throw new Error('Panel documentation exceeds the bounded reference size')
    const lines = text.split('\n'), headings = []
    let fence
    for (const [index, line] of lines.entries()) {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (marker) {
        if (!fence) fence = { character: marker[1][0], width: marker[1].length }
        else if (marker[1][0] === fence.character && marker[1].length >= fence.width && marker[2].trim() === '') fence = undefined
        continue
      }
      if (fence) continue
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
      if (heading) headings.push({ level: heading[1].length, heading: heading[2], line: index + 1 })
    }
    const dedicated = headings.filter(entry => entry.heading.includes('\`' + name + '\`'))
    const selected = dedicated.length ? dedicated : headings.filter(entry =>
      entry.heading.startsWith('\`component\` '))
    if (selected.length === 0) throw new Error('No component reference section found in current panel documentation')
    const sections = selected.map(entry => {
      const end = headings.find(next => next.line > entry.line && next.level <= entry.level)?.line ?? lines.length + 1
      const content = lines.slice(entry.line - 1, end - 1).join('\n')
      if (Buffer.byteLength(content) > 16384) throw new Error('Component reference exceeds the bounded section size')
      return { file: path, line: entry.line, endLine: end - 1, heading: entry.heading, content }
    })
    // One canonical visual/interaction guide accompanies component syntax.
    // This is packaged pure text, not a second schema, CSS or edit authority.
    const standardFile = 'docs/panel-uiux-standard.md'
    const standardContent = await readFile(join(repo, standardFile), 'utf8')
    if (!standardContent.startsWith('# Panel UIUX 规范\n') || Buffer.byteLength(standardContent) > MAX_SHARED_STANDARD_BYTES) {
      throw new Error('Panel UIUX standard is missing its heading or exceeds the bounded reference size')
    }
    return { ...base, documentation: { ...base.documentation,
      coverage: dedicated.length ? 'dedicated-component-section' : 'shared-library-reference-only',
      validation: 'documentation-only; examples are not validated Bundle facts', sections,
      sharedStandards: { file: standardFile, line: 1, content: standardContent,
        authority: 'Authoring and review guidance, not a component schema, permission or proof of runtime conformance.' } } }
  }
  if (typeName) return { ...base, contract: contract(typeName) }

  const { parsePanelManifest } = await import(pathToFileURL(join(repo, contractPath)).href)
  const examples = []
  const invalidExamples = []
  const packages = join(repo, 'packages')
  const packageEntries = (await readdir(packages, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name.startsWith('skills-'))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of packageEntries) {
    const packageRoot = join(packages, entry.name)
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    const skills = join(packageRoot, manifest.designSystem?.kit?.bundles ?? manifest.designSystem?.kit?.skills ?? './skills')
    let bundles
    try { bundles = await readdir(skills, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    for (const bundle of bundles.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(skills, bundle.name, 'panel.yaml')
      let text
      try { text = await readFile(path, 'utf8') }
      catch (error) { if (error.code === 'ENOENT') continue; throw error }
      let manifest
      try { manifest = parsePanelManifest(text) }
      catch (error) { invalidExamples.push({ file: relative(repo, path), error: error.message }); continue }
      function visit(node, pointer) {
        if (node.component === name) examples.push({
          file: relative(repo, path), pointer, node, validation: 'panel-structure-only',
        })
        for (const [index, child] of (node.children ?? []).entries()) visit(child, `${pointer}/children/${index}`)
        for (const [slot, child] of Object.entries(node.slots ?? {})) if (child) visit(child, `${pointer}/slots/${slot}`)
      }
      visit(manifest.ui, '/ui')
    }
  }
  return {
    ...base,
    contracts: ['ComponentNode', 'PanelSection', 'EditorField'].map(name => {
      const { declaration, ...location } = contract(name)
      return { ...location, read: `--type ${name}` }
    }),
    examples, invalidExamples,
  }
}

/** Build-time export of the existing inspector. Installed readers need only
 * this pure data, not a checkout, TypeScript, or permission to execute code.
 * Coverage labels and validation limits remain those of the source inspector.
 */
export async function exportPanelAuthoringReference(repo) {
  repo = resolve(repo)
  const { COMPONENT_KINDS } = await import(pathToFileURL(join(repo, 'packages/core/src/panel-component-catalog.ts')).href)
  const { panelAuthoringCatalogIdentity } = await import(pathToFileURL(join(repo, 'packages/core/src/panel-authoring-reference.ts')).href)
  // One invocation owns one fresh parse. Never cache across exports: callers
  // rely on edits being reflected in the next generated authoring material.
  const context = await inspectionContext(repo)
  const { ts, source } = context
  const names = []
  function properties(node, name) {
    names.push(name)
    const members = ts.isInterfaceDeclaration(node) ? node.members
      : ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type) ? node.type.members
      : ts.isPropertySignature(node) && node.type && ts.isTypeLiteralNode(node.type) ? node.type.members : undefined
    for (const member of members ?? []) {
      if (ts.isPropertySignature(member) && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) {
        properties(member, `${name}.${member.name.text}`)
      }
    }
  }
  for (const [name, node] of context.declarations) {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) properties(node, node.name.text)
    else names.push(name)
  }
  const components = Object.create(null), contracts = Object.create(null)
  for (const name of COMPONENT_KINDS) {
    const reference = await inspectWithContext(context, name)
    const documentation = await inspectWithContext(context, name, undefined, { documentationOnly: true })
    components[name] = { ...reference, documentation: documentation.documentation }
  }
  // Contract names are source-derived, including focused nested properties;
  // they are not another component vocabulary or a per-component JSON Schema.
  for (const name of names) {
    contracts[name] = (await inspectWithContext(context, COMPONENT_KINDS[0], name)).contract
  }
  const callbackSource = await readFile(join(repo, 'packages/panel/src/interpreter.ts'), 'utf8')
  return {
    format: 'panel-authoring-reference/v1', catalogIdentity: panelAuthoringCatalogIdentity(), components, contracts,
    hostCallbackContract: {
      file: 'packages/panel/src/interpreter.ts', type: 'RenderOptions',
      declaration: (() => {
        const ast = ts.createSourceFile('interpreter.ts', callbackSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
        const node = ast.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'RenderOptions')
        if (!node) throw Error('Missing RenderOptions authoring contract')
        return node.getText(ast)
      })(),
      authority: 'Trusted host callbacks, not DSL event handlers or permission to execute scripts. Editing and save authority remain host-owned.',
    },
    contract: 'Source-derived local PanelManifest authoring reference; not a complete per-component parameter schema or standard A2UI specification.',
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [repo, component, flag, typeName, ...extra] = process.argv.slice(2)
    const docs = flag === '--docs'
    if (!repo || !component || repo.startsWith('-') || component.startsWith('-')
      || extra.length || (docs && typeName)
      || (!docs && flag && (flag !== '--type' || !typeName)) || (!flag && typeName)) {
      throw new Error('Usage: inspect-panel-component.mjs <repo> <component> [--type <local-type-name> | --docs]')
    }
    console.log(JSON.stringify(await inspectPanelComponent(repo, component, docs ? undefined : typeName, { documentationOnly: docs }), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
