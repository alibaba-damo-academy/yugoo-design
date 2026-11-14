import { localizePanelManifest, panelMessagesForLocale, parsePanelManifest, type PanelManifest } from '../dsl.ts'
import { fieldsForSection, sectionBindingOf } from '../record-state.ts'
import type { GraphNode } from './graph-model.ts'

export type GraphNodeLabel = (node: GraphNode) => string
type Caption = { path: string[]; exact?: boolean; source: string; target: string }
const properties = (path: string) => path.split('.').flatMap(key => ['properties', key])
const pointerPath = (pointer: string) => pointer.split('/').slice(1).map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'))
const readable = (text: string | undefined): text is string => Boolean(text?.trim() && !text.startsWith('$t:'))

/** Derive captions from the owning Panel's existing display declarations only.
 * `*` denotes a schema collection member (value/items), never a record ID. */
function captions(manifest: PanelManifest, locale: string): Caption[] {
  const translated = localizePanelManifest(manifest, locale)
  const sources = [...new Set([manifest.i18n?.default_locale ?? 'zh-CN', ...Object.keys(manifest.i18n?.locales ?? {})])]
    .map(language => localizePanelManifest(manifest, language))
  const result: Caption[] = []
  const add = (path: string[], originals: (string | undefined)[], target: string | undefined, exact = false) => {
    if (readable(target)) for (const source of originals) if (readable(source)) result.push({ path, source, target, exact })
  }
  const messages = panelMessagesForLocale(manifest.i18n, locale)
  for (const [key, source] of Object.entries(manifest.i18n?.messages?.[manifest.i18n.default_locale] ?? {})) {
    if (key.startsWith('knowledge.label:')) add(pointerPath(key.slice('knowledge.label:'.length)), [source], messages[key], true)
  }
  for (const section of translated.sections) {
    const binding = sectionBindingOf(translated, section.id)
    const path = [...properties(binding.recordsPath), '*', ...(binding.fieldsPath ? properties(binding.fieldsPath) : [])]
    const originalSections = sources.map(source => source.sections.find(item => item.id === section.id))
    // A detail section names a bound object, not the parent record's user title.
    if (binding.fieldsPath) add(path, originalSections.map(item => item?.title), section.title)
    else add(path, originalSections.map(item => item?.item_name), section.item_name)
    for (const field of fieldsForSection(translated.fields, section.id)) {
      const originals = sources.map(source => fieldsForSection(source.fields, section.id).find(item => item.key === field.key))
      const fieldPath = [...path, ...properties(field.key)]
      add(fieldPath, originals.map(item => item?.label), field.label)
      if (field.control === 'record_map' || field.control === 'rows') {
        add([...fieldPath, '*'], originals.map(item => item?.label !== item?.row_name ? item?.label : undefined), field.label)
        add([...fieldPath, '*'], originals.map(item => item?.row_name), field.row_name)
      }
    }
  }
  return result
}

/** Display-only resolution: never translate prose by matching its text alone.
 * Core's sourceLabel is the same record caption with knowledge metadata removed.
 * A distinct label plus the exact schema/Panel binding proves a metadata caption.
 * Unmapped, ambiguous and older nodes retain their original labels. */
export function graphNodeLabels(panels: Readonly<Record<string, { panelYaml?: string }>> | undefined, locale: string): GraphNodeLabel {
  const byOwner = new Map<string, Caption[]>()
  for (const [owner, panel] of Object.entries(panels ?? {})) {
    if (!panel.panelYaml) continue
    try { byOwner.set(owner, captions(parsePanelManifest(panel.panelYaml), locale)) }
    catch { /* A broken optional Panel definition must not hide the source graph. */ }
  }
  return node => {
    if (!node.contentKind || typeof node.schemaPointer !== 'string' || !node.sourceLabel || node.sourceLabel === node.label) return node.label
    const path = pointerPath(node.schemaPointer)
    const targets = new Set<string>()
    for (const caption of byOwner.get(node.owner) ?? []) {
      if (path.length !== caption.path.length || !path.every((key, index) => !caption.exact && caption.path[index] === '*' ? key === 'value' || key === 'items' : key === caption.path[index])) continue
      const memberKey = node.pointer.slice(node.pointer.lastIndexOf('/') + 1).replaceAll('~1', '/').replaceAll('~0', '~')
      const suffix = node.contentKind === 'unit' && path.at(-1) === 'value' && memberKey ? ` · ${memberKey}` : ''
      if (node.label === caption.source) targets.add(caption.target)
      else if (suffix && node.label === caption.source + suffix) targets.add(caption.target + suffix)
    }
    return targets.size === 1 ? [...targets][0]! : node.label
  }
}
