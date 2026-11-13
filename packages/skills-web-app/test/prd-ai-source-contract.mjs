import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

// Real template-backed PRD validation, without rendering, a Host or a model.
const bundle = new URL('../bundles/web_app_prd_assembly/', import.meta.url)
const template = readFileSync(new URL('reference/prd-template.html', bundle), 'utf8')
const script = new URL('scripts/prd.mjs', bundle)
const sections = [...template.matchAll(/<!--\s*prd-section\s*\n[\s\S]*?-->\s*\n<h2\b[^>]*data-prd-section-id="(?<id>[^"]+)"[^>]*>(?<title>[\s\S]*?)<\/h2>/gu)]
const style = /<style\b[^>]*data-prd-document-style[^>]*>[\s\S]*?<\/style>/u.exec(template)[0]
const aiChapters = new Set(['product_definition', 'capability_architecture', 'rules_controls',
  'roles_security_audit', 'pages_interactions', 'quality_acceptance', 'assembly_traceability'])
const aiPath = 'ai_agent_capabilities/ai_agent_capabilities.json'
const sources = {
  ...Object.fromEntries(['business_data', 'business_rules', 'role_access', 'integration_design',
    'notification_design', 'quality_acceptance'].map(owner => [`${owner}/${owner}.json`, '{}'])),
  [aiPath]: JSON.stringify({ schema_version: 1, agents: { review: {
    id: 'review', name: 'Review assistant', description: 'Draft clarification for human review.',
    context: 'Only the selected request and authorized scope material.',
    actions: { suggest: { action: 'Suggest clarification', condition: 'Scope material is available', result: 'Editable suggestion; a person decides whether to adopt it.' } },
    exceptions: { no_scope: { condition: 'Scope material is unavailable', handling: 'Explain the gap and request the missing material; do not approve.' } },
  } } }),
}
const state = { schema_version: 8, title: 'Request review PRD', detail_level: 'detailed',
  ai_provenance: [], html_file: 'web_app_prd_assembly/prd.html' }

function document(extraAiChapter) {
  const body = sections.map((section, index) => {
    const id = section.groups.id
    const end = sections[index + 1]?.index ?? template.indexOf('</main>')
    const visuals = [...template.slice(section.index, end).matchAll(/<!--\s*prd-visual:([\w-]+):start\s*-->/gu)]
    const owner = aiChapters.has(id) || id === extraAiChapter ? 'ai_agent_capabilities' : 'user'
    const prose = id === 'capability_architecture'
      ? '<h3>Review assistant</h3><p>For the selected request, the assistant uses only authorized scope material and offers an editable clarification suggestion. A person decides whether to adopt it.</p><ul><li>If scope material is unavailable, explain the gap and request it; do not approve.</li></ul>'
      : '<p>The product preserves the sourced conditions and human decision boundary.</p>'
    return `<h2 data-prd-section-id="${id}" data-prd-sources="${owner}" data-prd-provenance-ids="">${section.groups.title}</h2>${prose}${visuals.map(v => `<!-- prd-visual:${v[1]}:start --><!-- prd-visual:${v[1]}:end -->`).join('')}`
  }).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${style}</head><body class="prd-document"><main class="prd-container">${body}</main></body></html>`
}

function validate(html = document(), input_files = sources) {
  const result = spawnSync(process.execPath, [script.pathname, 'validate-html-file'], {
    input: JSON.stringify({ state, input_files }) + '\n' + html,
    encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10000,
  })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.stderr, '')
  return { status: result.status, ...JSON.parse(result.stdout) }
}

test('saved AI behavior and exceptions can be grounded in the existing applicable chapters', () => {
  const result = validate()
  assert.equal(result.status, 0, result.diagnostics?.join('\n'))
  assert.equal(result.valid, true)
})

test('AI source annotations still require the exact owner input', () => {
  const missing = { ...sources }
  delete missing[aiPath]
  const result = validate(document(), missing)
  assert.equal(result.status, 1)
  assert.ok(result.diagnostics.some(d => d.includes('uses unavailable source owner "ai_agent_capabilities"')))
  assert.ok(result.diagnostics.some(d => d.includes('not supplied in input_files')),
    'missing transport input must not be described as a missing project design')
})

test('available acceptance verification steps cannot disappear behind a criteria summary', () => {
  const path = 'quality_acceptance/quality_acceptance.json'
  const verification = 'Return the same request twice. Reject a whitespace-only reason & preserve all earlier entries.'
  const input_files = { ...sources, [path]: JSON.stringify({ requirements: {
    'return-timeline': { id: 'return-timeline', title: 'Repeated return', verification },
  } }) }
  const omitted = validate(document(), input_files)
  assert.equal(omitted.status, 1)
  assert.ok(omitted.diagnostics.some(d => /return-timeline.*verification/u.test(d)))
  const retained = document().replace('data-prd-section-id="quality_acceptance" data-prd-sources="ai_agent_capabilities"',
    'data-prd-section-id="quality_acceptance" data-prd-sources="ai_agent_capabilities,quality_acceptance"').replace(
    /(<h2[^>]*data-prd-section-id="quality_acceptance"[^>]*>.*?<\/h2>)/u,
    '$1<p>Return the same request twice. Reject a whitespace-only reason &amp; preserve all earlier entries.</p>',
  )
  const valid = validate(retained, input_files)
  assert.equal(valid.status, 0, valid.diagnostics?.join('\n'))
})

test('an omitted authority input requests the source without directing invented completions', () => {
  const missing = { ...sources }
  delete missing['business_data/business_data.json']
  const result = validate(document(), missing)
  assert.equal(result.status, 1)
  assert.ok(result.diagnostics.some(d => /authority Bundle "business_data".*not supplied in input_files/u.test(d)))
  assert.ok(result.diagnostics.some(d => d.includes('do not invent absence or remove source annotations')))
  assert.ok(result.diagnostics.every(d => !d.includes('wrap every temporary completion')))
})

test('adding the AI owner does not bypass unrelated chapter source policy', () => {
  const result = validate(document('visual_experience'))
  assert.equal(result.status, 1)
  assert.ok(result.diagnostics.some(d => d.includes('chapter "visual_experience" uses disallowed source owner "ai_agent_capabilities"')))
})
