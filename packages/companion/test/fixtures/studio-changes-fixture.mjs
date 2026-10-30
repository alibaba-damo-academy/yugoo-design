/** Finite independent Bundle; actual Core adapter over retained bytes, no installed files. */
import { createStudioInstanceAdapters } from '../../src/studio-instance-composition.mjs'
export const pin = { name: 'observations', version: '1.0' }
export const entry = (path, content) => ({ path, base64: Buffer.from(content, 'utf8').toString('base64') })
export const originalFiles = [
  entry('SKILL.md', '---\nname: observations\ndescription: Record supplied observations without inventing missing facts.\n---\nPreserve observation text and select one declared status.\n'),
  entry('skill.yaml', 'name: observations\nversion: "1.0"\ntitle: {zh: 观察记录, en: Observations}\nlabel: {zh: 观察记录, en: Observations}\npresentation: {mode: declarative}\nexecution: {mode: main, handoff: none}\n'),
  entry('schema.yaml', 'type: object\nproperties:\n  items:\n    type: map\n    value:\n      type: object\n      properties:\n        title: {type: string}\n        status: {type: enum, values: [open, closed]}\n'),
  entry('validation.yaml', 'skill: observations\nrules:\n  - id: observation_title\n    scope: [completion]\n    code: observations.title\n    message: Supply the observation title.\n    check: {non_empty_string: items.item_01.title}\n'),
  entry('panel.yaml', 'version: 1\npanel_kind: evidence_workbook\ni18n:\n  default_locale: zh-CN\n  locales: {zh-CN: locales/zh-CN.json, en-US: locales/en-US.json}\nsections:\n  - {id: items, title: "$t:records", add_mode: none}\nfields:\n  - {key: title, label: "$t:title", control: text, applies_to: [items]}\n  - key: status\n    label: "$t:status"\n    control: select\n    applies_to: [items]\n    options:\n      - {value: open, label: "$t:open"}\n      - {value: closed, label: "$t:closed"}\nui: {component: record_form, id: observations, title: "$t:records", source: items}\n'),
  entry('locales/zh-CN.json', JSON.stringify({ records: '观察记录', title: '记录名称', status: '状态', open: '待处理', closed: '已关闭' })),
  entry('locales/en-US.json', JSON.stringify({ records: 'Observations', title: 'Title', status: 'Status', open: 'Open', closed: 'Closed' })),
  entry('reference/preview.json', JSON.stringify({ items: { item_01: { title: '结算金额核对', status: 'open' } } })),
  { path: 'reference/preserved.bin', base64: Buffer.from([0, 255, 128, 10]).toString('base64') },
]
export const textOf = (files, path) => Buffer.from(files.find(file => file.path === path).base64, 'base64').toString('utf8')
export const additions = () => [
  { path: 'schema.yaml', content: textOf(originalFiles, 'schema.yaml').replace('[open, closed]', '[open, review, closed]') },
  { path: 'panel.yaml', content: textOf(originalFiles, 'panel.yaml').replace('      - {value: closed,', '      - {value: review, label: "$t:review"}\n      - {value: closed,') },
  { path: 'locales/zh-CN.json', content: JSON.stringify({ ...JSON.parse(textOf(originalFiles, 'locales/zh-CN.json')), review: '待复核' }) },
  { path: 'locales/en-US.json', content: JSON.stringify({ ...JSON.parse(textOf(originalFiles, 'locales/en-US.json')), review: 'Needs review' }) },
]
export function adapters({ captureKit } = {}) {
  return createStudioInstanceAdapters({
    listBundles: async () => [pin],
    captureBundle: async requested => { if (requested.name !== pin.name || requested.version !== pin.version) throw new Error('Missing fixture pin.'); return { files: structuredClone(originalFiles), sourceId: 'trusted:studio-changes-fixture' } },
    captureKit: captureKit ?? (async () => { throw new Error('This fixture has no installed Kit.') }),
  })
}
