/**
 * panelData wiring contract smoke: the workspace resolver shape
 * (draft-first, named-section-only, live read-only references) exercised
 * through the interpreter's cross-panel option path.
 * Run: node scripts/smoke-dsl-panel-data.mjs (after `pnpm run build`).
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parsePanelManifest, renderManifest } from '../packages/panel/lib/index.js'

const yamlText = await readFile(fileURLToPath(new URL('../packages/panel/fixtures/dsl-expressiveness.panel.yaml', import.meta.url)), 'utf8')
const ownData = JSON.parse(await readFile(fileURLToPath(new URL('../packages/panel/fixtures/dsl-expressiveness.data.json', import.meta.url)), 'utf8'))
const manifest = parsePanelManifest(yamlText)

/** Workspace resolver shape: draft-first, named section only, live refs. */
const makeResolver = (store) => (panelType, sectionId) => {
  const state = store.drafts[panelType] ?? store.originals[panelType]
  if (state === null || typeof state !== 'object') return {}
  const section = state[sectionId]
  return section !== null && typeof section === 'object' ? section : {}
}

const optionTexts = (root) => {
  const texts = []
  const walk = (node) => {
    if (node === null || node === undefined || node === false) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node === 'object' && 'type' in node && 'props' in node) {
      if (node.type === 'option' && typeof node.props.children === 'string') texts.push(node.props.children)
      walk(node.props.children)
    }
  }
  walk(root)
  return texts
}

// --- a) references track draft updates -------------------------------------
const store = {
  drafts: {
    function_modules: { functions: { 'fn-1': { function_name: '用户管理' } } },
  },
  originals: {},
}
const resolver = makeResolver(store)
const before = optionTexts(renderManifest(manifest, ownData, { editable: true, panelData: resolver }))
if (!before.includes('用户管理')) throw new Error('panelData: initial draft record option missing')

// A draft edit in the referenced panel shows up on re-render (no stale cache).
store.drafts.function_modules.functions['fn-2'] = { function_name: '权限中心' }
const after = optionTexts(renderManifest(manifest, ownData, { editable: true, panelData: resolver }))
if (!after.includes('权限中心')) throw new Error('panelData: option did not track draft update')

// --- b) no copy, no pollution ----------------------------------------------
const sourceSection = store.drafts.function_modules.functions
const sourceSnapshot = JSON.stringify(sourceSection)
const edits = []
const rendered = renderManifest(manifest, ownData, {
  editable: true,
  panelData: resolver,
  onEdit: (edit) => { edits.push(edit) },
})
// Drive edits on the OWN panel (scalar + structured rows write).
const findEditable = (node, out = []) => {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) { node.forEach((child) => findEditable(child, out)); return out }
  if (typeof node === 'object' && 'type' in node && 'props' in node) {
    if (typeof node.props.onChange === 'function') out.push(node)
    findEditable(node.props.children, out)
  }
  return out
}
const editables = findEditable(rendered)
if (editables.length === 0) throw new Error('panelData: no editable controls rendered')
editables[0].props.onChange({ target: { value: '被编辑的值' } })
const findButtons = (node, out = []) => {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) { node.forEach((child) => findButtons(child, out)); return out }
  if (typeof node === 'object' && 'type' in node && 'props' in node) {
    if (node.type === 'button') out.push(node)
    findButtons(node.props.children, out)
  }
  return out
}
const rowsAdd = findButtons(renderManifest(manifest, ownData, { editable: true, panelData: resolver }))
  .find((el) => typeof el.props.children === 'string' && el.props.children.includes('添加'))
if (rowsAdd === undefined) throw new Error('panelData: rows add button missing')
rowsAdd.props.onClick()
if (edits.length < 1) throw new Error('panelData: edits were not emitted')
if (JSON.stringify(sourceSection) !== sourceSnapshot) throw new Error('panelData: source section was mutated by own-panel edits')
if (store.drafts.function_modules.functions !== sourceSection) throw new Error('panelData: source section identity changed (defensive copy detected)')

// --- c) missing panel / section resolve empty, never whole state ------------
const emptyPanel = optionTexts(renderManifest(manifest, ownData, { editable: true, panelData: makeResolver({ drafts: {}, originals: {} }) }))
if (emptyPanel.includes('用户管理')) throw new Error('panelData: option leaked with absent source panel')
// Panel exists but the named section does not: other sections must NOT leak.
const wrongSection = makeResolver({
  drafts: { function_modules: { other_section: { 'x-1': { name: '不应出现' } } } },
  originals: {},
})
const wrongTexts = optionTexts(renderManifest(manifest, ownData, { editable: true, panelData: wrongSection }))
if (wrongTexts.includes('不应出现')) throw new Error('panelData: whole-state fallback leaked a sibling section')

console.log('panelData contract OK')
