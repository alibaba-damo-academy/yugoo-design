import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

// Exercise the real file-script entries without layout builds, snapshots or a Host.
const flowScript = new URL('../bundles/flow_design/scripts/bpmn-validator.mjs', import.meta.url)
const prdScript = new URL('../bundles/web_app_prd_assembly/scripts/prd.mjs', import.meta.url)
const example = new URL('../../../examples/web-app-panel-review/en-US/design_files/', import.meta.url)
const flow = JSON.parse(readFileSync(new URL('flow_design/flow_design.json', example), 'utf8'))
const originalXml = readFileSync(new URL('flow_design/P-001.bpmn', example), 'utf8')
const originalName = flow.roles.find(role => role.id === 'System').name
const process = flow.processes['P-001']

function invoke(script, action, context, text) {
  const result = spawnSync(globalThis.process.execPath, [script.pathname, action], {
    input: `${JSON.stringify(context)}\n${text}`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.stderr, '', result.stderr)
  return { status: result.status, text: result.stdout, ...(result.status !== 0 || action !== 'materialize-visuals' ? JSON.parse(result.stdout) : {}) }
}

function localizedFlow(name) {
  return {
    roles: flow.roles.map(role => role.id === 'System' ? { ...role, name } : role),
    process: { ...process, stakeholders: process.stakeholders.map(role => role === originalName ? name : role) },
    xml: originalXml.replaceAll(`name="${originalName}"`, `name="${name}"`),
  }
}

for (const action of ['validate-bpmn-file', 'validate-final-bpmn-file']) {
  function check(candidate, diagnostic) {
    const xml = action === 'validate-bpmn-file'
      ? candidate.xml.replace(/<bpmndi:BPMNDiagram\b[\s\S]*?<\/bpmndi:BPMNDiagram\s*>/giu, '')
      : candidate.xml
    const result = invoke(flowScript, action, { process_id: 'P-001', process: candidate.process, ...(candidate.roles === undefined ? {} : { roles: candidate.roles }) }, xml)
    assert.equal(result.status, diagnostic ? 1 : 0, result.diagnostics?.join('\n'))
    if (diagnostic) assert.ok(result.diagnostics.some(message => message.startsWith(`flow_design.${diagnostic}:`)), result.diagnostics.join('\n'))
  }
  test(`${action}: localized System identity retains all role and activity checks`, () => {
    const en = localizedFlow('System')
    check(localizedFlow('系统'))
    check(en)
    check(localizedFlow('Produit')) // Identity must not be inferred from a name whitelist.
    check({ ...localizedFlow('系统'), roles: undefined }) // Legacy Chinese context.
    const systemOnly = { ...en, process: { ...en.process, stakeholders: ['System'] }, xml: en.xml.replace(/<bpmn:laneSet\b[\s\S]*?<\/bpmn:laneSet>/u, '').replaceAll('bpmn:userTask', 'bpmn:serviceTask') }
    check(systemOnly)
    check({ ...systemOnly, xml: systemOnly.xml.replaceAll('bpmn:serviceTask', 'bpmn:manualTask') }, 'human_task_in_system_lane')
    check({ ...en, roles: en.roles.filter(role => role.id !== 'System') }, 'missing_system_role')
    check({ ...en, roles: [...en.roles, { id: 'System', name: 'Another product' }] }, 'duplicate_role_id')
    check({ ...en, roles: en.roles.map(role => role.id === 'System' ? { ...role, id: 'Product' } : role) }, 'missing_system_role')
    check({ ...en, roles: en.roles.map(role => role.id === 'System' ? { ...role, name: '' } : role) }, 'invalid_role')
    check({ ...en, roles: en.roles.map(role => role.id === 'System' ? { ...role, name: 'Ｃustomer' } : role) }, 'duplicate_role_name')
    check({ ...en, process: { ...en.process, stakeholders: [...en.process.stakeholders, 'Unknown'] } }, 'unknown_stakeholder')
    check({ ...en, process: { ...en.process, stakeholders: en.process.stakeholders.filter(name => name !== 'System') } }, 'system_not_participating')
    check({ ...en, process: { ...en.process, system_responsibilities: [] } }, 'missing_system_responsibility')
    check({ ...en, xml: en.xml.replace('name="System"', 'name="Wrong role"') }, 'lane_role_mismatch')
    for (const tag of ['userTask', 'manualTask', 'task']) {
      check({ ...en, xml: en.xml.replaceAll('bpmn:serviceTask', `bpmn:${tag}`) }, tag === 'task' ? 'untyped_system_task' : 'human_task_in_system_lane')
    }
    for (const tag of ['serviceTask', 'businessRuleTask', 'scriptTask', 'sendTask', 'receiveTask']) {
      check({ ...en, xml: en.xml.replaceAll('bpmn:serviceTask', `bpmn:${tag}`) })
      check({ ...en, xml: en.xml.replaceAll('bpmn:userTask', `bpmn:${tag}`) }, 'automation_in_human_lane')
    }
    check({ ...en, xml: en.xml.replaceAll('bpmn:serviceTask', 'bpmn:callActivity') }, 'system_responsibility_unrealized')
    check({ ...en, roles: undefined }, 'automation_in_human_lane') // Missing cast cannot silently accept English automation.
  })
}

const template = readFileSync(new URL('../bundles/web_app_prd_assembly/reference/prd-template.html', import.meta.url), 'utf8')
const sections = [...template.matchAll(/<!--\s*prd-section\s*\n(?<meta>[\s\S]*?)-->\s*\n<h2\b[^>]*\bdata-prd-section-id\s*=\s*(["'])(?<id>.*?)\2[^>]*>(?<title>[\s\S]*?)<\/h2\s*>/giu)]
const fixedStyle = /<style\b[^>]*\bdata-prd-document-style\b[^>]*>[\s\S]*?<\/style\s*>/iu.exec(template)[0]
const body = sections.map((section, index) => {
  const end = sections[index + 1]?.index ?? template.indexOf('</main>')
  const visuals = [...template.slice(section.index, end).matchAll(/<!--\s*prd-visual:([A-Za-z0-9_-]+):start\s*-->/gu)]
  const owner = { capability_architecture: 'function_modules', pages_interactions: 'page_design' }[section.groups.id] ?? 'user'
  return `<h2 data-prd-section-id="${section.groups.id}" data-prd-sources="${owner}" data-prd-provenance-ids="">${section.groups.title}</h2><p>Grounded business context.</p>${visuals.map(match => `<!-- prd-visual:${match[1]}:start --><!-- prd-visual:${match[1]}:end -->`).join('')}`
}).join('')
const skeleton = lang => `<!doctype html><html${lang ? ` lang="${lang}"` : ''}><head><meta charset="utf-8">${fixedStyle}</head><body class="prd-document"><main class="prd-container">${body}</main></body></html>`
const prdState = { schema_version: 8, title: 'Product PRD', detail_level: 'concise', ai_provenance: [], html_file: 'web_app_prd_assembly/prd.html' }
const sources = {
  ...Object.fromEntries(['business_data', 'business_rules', 'role_access', 'integration_design', 'notification_design', 'quality_acceptance'].map(owner => [`${owner}/${owner}.json`, '{}'])),
  'function_modules/function_modules.json': JSON.stringify({ functions: { f: { function_id: 'f', function_name: 'Keep supplied business name', function_description: 'Business behavior.' } } }),
  'page_design/page_design.json': JSON.stringify({ pages: {}, page_order: [], connections: {}, connection_order: [] }),
}
function materialize(lang, input_files = sources) {
  const result = invoke(prdScript, 'materialize-visuals', { input_files }, skeleton(lang))
  assert.equal(result.status, 0, result.diagnostics?.join('\n'))
  const validation = invoke(prdScript, 'validate-html-file', { state: prdState, template, input_files }, result.text)
  assert.equal(validation.status, 0, validation.diagnostics?.join('\n'))
  return result.text
}
test('PRD: document lang controls fixed labels and deterministic validation, preserving source content', () => {
  const en = materialize('en-US')
  for (const label of ['Function scope map', 'Product functions', 'Other functions', 'Page map', 'Main navigation', 'Related navigation', 'No page structure yet']) assert.ok(en.includes(label), label)
  assert.ok(en.includes('Keep supplied business name'))
  for (const label of ['功能范围图', '产品功能结构', '其他功能', '页面关系图', '主要导航', '关联跳转', '暂无页面结构']) assert.ok(!en.includes(label), label)
  const empty = materialize('en', { ...sources, 'function_modules/function_modules.json': '{"functions":{}}' })
  assert.ok(empty.includes('No functions yet'))
  const zh = materialize('zh-CN')
  for (const label of ['功能范围图', '产品功能结构', '其他功能', '页面关系图', '主要导航', '关联跳转', '暂无页面结构']) assert.ok(zh.includes(label), label)
  assert.equal(materialize(''), zh.replace(' lang="zh-CN"', ''))
  assert.equal(materialize('EN-gb'), en.replace('lang="en-US"', 'lang="EN-gb"'))
  const stale = invoke(prdScript, 'validate-html-file', { state: prdState, template, input_files: sources }, en.replace('lang="en-US"', 'lang="zh-CN"'))
  assert.equal(stale.status, 1)
  assert.ok(stale.diagnostics.some(message => message.includes('deterministic owner projection')))
  const ownerTitle = materialize('en-US', { ...sources, 'function_modules/function_modules.json': JSON.stringify({ title: '用户自己的标题', functions: {} }) })
  assert.ok(ownerTitle.includes('用户自己的标题'), 'localization must not translate user-owned text')
})
