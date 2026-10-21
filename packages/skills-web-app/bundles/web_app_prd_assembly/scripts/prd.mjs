import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { BPMN_RENDERER, PAGE_VIEWPORT, renderPrdVisuals } from './visual-renderer.mjs'

const rawInput = readFileSync(0, 'utf8')
const action = process.argv[2]
const boundary = rawInput.indexOf('\n')
if (boundary < 0) throw new Error('file input must include structured context')
const input = JSON.parse(rawInput.slice(0, boundary))
const inputHtml = rawInput.slice(boundary + 1)
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const record = value => isRecord(value) ? value : {}
const stripFence = value => String(value ?? '').trim().replace(/^```(?:html)?\s*\n?/u, '').replace(/\n?```\s*$/u, '').trim()
const htmlPath = 'web_app_prd_assembly/prd.html'
const splitIds = value => String(value ?? '').split(/[\s,，、]+/u).map(item => item.trim()).filter(Boolean)

const VISUAL_REGIONS = Object.freeze([
  'function_scope_map',
  'all_bpmn',
  'page_map',
  'all_page_prototypes',
  'design_preview',
])

const OWNER_GATED_SECTIONS = Object.freeze({
  business_information: 'business_data',
  rules_controls: 'business_rules',
  roles_security_audit: 'role_access',
  integrations: 'integration_design',
  notifications_communications: 'notification_design',
  quality_acceptance: 'quality_acceptance',
})

const NARRATIVE_SECTIONS = new Set([
  'product_definition',
  'users_scope_release',
  'capability_architecture',
  'business_information',
  'journeys_processes',
  'rules_controls',
  'roles_security_audit',
  'pages_interactions',
  'visual_experience',
  'integrations',
  'notifications_communications',
  'analytics_outputs',
  'quality_acceptance',
  'delivery_operations',
])

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const digest = value => createHash('sha256').update(String(value ?? '')).digest('hex')
const compactLabel = (value, limit = 24) => {
  const text = String(value ?? '').trim()
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function parseSourceJson(sourceFiles, path, diagnostics) {
  const text = sourceFiles[path]
  if (typeof text !== 'string') return undefined
  try {
    const value = JSON.parse(text)
    if (!isRecord(value)) throw new Error('root must be an object')
    return value
  } catch (error) {
    diagnostics.push(`visual source ${JSON.stringify(path)} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function orderedRecords(container, order) {
  const values = record(container)
  const keys = Array.isArray(order) ? order.map(String) : Object.keys(values)
  const seen = new Set()
  return [...keys, ...Object.keys(values)].flatMap(key => {
    if (seen.has(key)) return []
    seen.add(key)
    const value = values[key]
    return isRecord(value) ? [[key, value]] : []
  })
}

function visualPlan(sourceFiles) {
  const diagnostics = []
  const plan = Object.fromEntries(VISUAL_REGIONS.map(name => [name, []]))
  const tokensPath = 'design_style/tokens.css'
  const tokensCss = sourceFiles[tokensPath]
  const functionsPath = 'function_modules/function_modules.json'
  const functionsState = parseSourceJson(sourceFiles, functionsPath, diagnostics)
  if (functionsState !== undefined) plan.function_scope_map.push({ path: functionsPath, kind: 'function-map', state: functionsState })

  const flowPath = 'flow_design/flow_design.json'
  const flowState = parseSourceJson(sourceFiles, flowPath, diagnostics)
  if (flowState !== undefined) {
    for (const [id, process] of orderedRecords(flowState.processes, flowState.process_order)) {
      if (process.deleted === true || typeof process.bpmn_file !== 'string' || process.bpmn_file.trim() === '') continue
      const path = process.bpmn_file.trim()
      if (!path.startsWith('flow_design/') || path.includes('..') || !path.endsWith('.bpmn')) diagnostics.push(`process ${JSON.stringify(id)} has unsafe BPMN artifact path ${JSON.stringify(path)}`)
      else if (typeof sourceFiles[path] !== 'string') diagnostics.push(`visual source ${JSON.stringify(path)} referenced by process ${JSON.stringify(id)} is missing`)
      else plan.all_bpmn.push({ path, kind: 'bpmn', id, title: String(process.title ?? id), content: sourceFiles[path] })
    }
  }

  const pagesPath = 'page_design/page_design.json'
  const pageState = parseSourceJson(sourceFiles, pagesPath, diagnostics)
  if (pageState !== undefined) {
    plan.page_map.push({ path: pagesPath, kind: 'page-map', state: pageState })
    for (const [id, page] of orderedRecords(pageState.pages, pageState.page_order)) {
      if (typeof page.artifact_file !== 'string' || page.artifact_file.trim() === '') continue
      const path = page.artifact_file.trim()
      if (!path.startsWith('page_design/') || path.includes('..') || !path.endsWith('.html')) diagnostics.push(`page ${JSON.stringify(id)} has unsafe HTML artifact path ${JSON.stringify(path)}`)
      else if (typeof sourceFiles[path] !== 'string') diagnostics.push(`visual source ${JSON.stringify(path)} referenced by page ${JSON.stringify(id)} is missing`)
      else {
        const content = sourceFiles[path]
        const usesDesignTokens = /var\(\s*--ds-|<link\b[^>]*href\s*=\s*(["'])[^"']*tokens\.css\1/iu.test(content)
        if (usesDesignTokens && typeof tokensCss !== 'string') diagnostics.push(`visual dependency ${JSON.stringify(tokensPath)} required by page prototype ${JSON.stringify(path)} is missing`)
        else plan.all_page_prototypes.push({
          path,
          dependencies: typeof tokensCss === 'string' ? [tokensPath] : [],
          kind: 'html',
          id,
          title: String(page.name ?? id),
          content,
          tokensCss: typeof tokensCss === 'string' ? tokensCss : undefined,
        })
      }
    }
  }

  const stylePath = 'design_style/design_style.json'
  const styleState = parseSourceJson(sourceFiles, stylePath, diagnostics)
  if (styleState !== undefined) {
    const config = record(styleState.config)
    const primaryPreview = record(config.preview_page)
    const fallbackPreview = (Array.isArray(config.preview_pages) ? config.preview_pages : []).find(candidate => typeof record(candidate).html_file === 'string' && record(candidate).html_file.trim() !== '')
    const previews = typeof primaryPreview.html_file === 'string' && primaryPreview.html_file.trim() !== '' ? [primaryPreview] : fallbackPreview === undefined ? [] : [fallbackPreview]
    const seen = new Set()
    for (const raw of previews) {
      const preview = record(raw)
      if (typeof preview.html_file !== 'string' || preview.html_file.trim() === '') continue
      const path = preview.html_file.trim()
      if (seen.has(path)) continue
      seen.add(path)
      if (!path.startsWith('design_style/') || path.includes('..') || !path.endsWith('.html')) diagnostics.push(`design style has unsafe preview artifact path ${JSON.stringify(path)}`)
      else if (typeof sourceFiles[path] !== 'string') diagnostics.push(`visual source ${JSON.stringify(path)} referenced by design style is missing`)
      else if (typeof sourceFiles[tokensPath] !== 'string') diagnostics.push(`visual dependency ${JSON.stringify(tokensPath)} required by design style preview ${JSON.stringify(path)} is missing`)
      else plan.design_preview.push({ path, dependencies: [tokensPath], kind: 'html', id: String(preview.name ?? path), title: String(preview.title ?? preview.name ?? path), content: sourceFiles[path], tokensCss: sourceFiles[tokensPath] })
    }
  }
  return { plan, diagnostics }
}

function svgDocument(content, viewBox) {
  return `<svg class="prd-visual-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img"><defs><marker id="prd-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs>${content}</svg>`
}

function functionMapSvg(state) {
  const active = orderedRecords(state.functions).filter(([, item]) => item.rejected !== true)
  const groups = new Map()
  for (const [id, item] of active) {
    const epic = String(item.function_epic ?? '').trim() || '其他功能'
    if (!groups.has(epic)) groups.set(epic, [])
    groups.get(epic).push([id, item])
  }
  const width = 960
  const rootX = 24, rootWidth = 176, epicX = 292, epicWidth = 190, leafX = 570, leafWidth = 366
  const rowHeight = 54, groupGap = 28, top = 28
  const palette = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#ca8a04', '#db2777']
  const branches = []
  let cursorY = top
  if (groups.size === 0) {
    branches.push({ epic: '暂无功能', functions: [], color: palette[0], centerY: 68 })
    cursorY = 108
  } else for (const [index, [epic, functions]] of [...groups].entries()) {
    const leaves = functions.map(([id, item], leafIndex) => ({ id, item, y: cursorY + leafIndex * rowHeight }))
    const centerY = leaves.length === 0 ? cursorY + 20 : (leaves[0].y + leaves.at(-1).y) / 2 + 18
    branches.push({ epic, functions: leaves, color: palette[index % palette.length], centerY })
    cursorY += Math.max(rowHeight, leaves.length * rowHeight) + groupGap
  }
  const height = Math.max(180, cursorY)
  const rootY = height / 2 - 34
  const parts = []
  for (const branch of branches) {
    parts.push(`<path d="M ${rootX + rootWidth} ${rootY + 34} C 238 ${rootY + 34}, 246 ${branch.centerY}, ${epicX} ${branch.centerY}" fill="none" stroke="${branch.color}" stroke-width="3"/>`)
    for (const leaf of branch.functions) parts.push(`<path d="M ${epicX + epicWidth} ${branch.centerY} C 520 ${branch.centerY}, 530 ${leaf.y + 18}, ${leafX} ${leaf.y + 18}" fill="none" stroke="${branch.color}" stroke-width="2" opacity="0.72"/>`)
  }
  parts.push(`<rect x="${rootX}" y="${rootY}" width="${rootWidth}" height="68" rx="18" fill="#4c1d95" stroke="#4c1d95"/><text x="${rootX + rootWidth / 2}" y="${rootY + 41}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="17" font-weight="700" fill="#ffffff">${escapeHtml(compactLabel(state.title ?? '产品功能结构', 16))}</text>`)
  for (const branch of branches) {
    parts.push(`<rect x="${epicX}" y="${branch.centerY - 24}" width="${epicWidth}" height="48" rx="14" fill="${branch.color}" stroke="${branch.color}"/><text x="${epicX + epicWidth / 2}" y="${branch.centerY + 5}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#ffffff">${escapeHtml(compactLabel(branch.epic, 18))}</text>`)
    for (const leaf of branch.functions) {
      parts.push(`<rect x="${leafX}" y="${leaf.y}" width="${leafWidth}" height="36" rx="10" fill="#ffffff" stroke="${branch.color}" stroke-width="1.5" data-prd-function-id="${escapeHtml(leaf.id)}"/>`)
      parts.push(`<circle cx="${leafX + 16}" cy="${leaf.y + 18}" r="4" fill="${branch.color}"/><text x="${leafX + 29}" y="${leaf.y + 23}" font-family="system-ui,sans-serif" font-size="13" fill="#1f2937">${escapeHtml(compactLabel(leaf.item.function_name ?? leaf.id, 30))}</text>`)
      if (typeof leaf.item.priority === 'string') parts.push(`<text x="${leafX + leafWidth - 12}" y="${leaf.y + 23}" text-anchor="end" font-family="system-ui,sans-serif" font-size="11" fill="#64748b">${escapeHtml(leaf.item.priority)}</text>`)
    }
  }
  return svgDocument(parts.join(''), `0 0 ${width} ${height}`)
}

function pageMapSvg(state) {
  const pages = record(state.pages)
  const ordered = orderedRecords(pages, state.page_order)
  const ids = ordered.map(([id]) => id)
  const idSet = new Set(ids)
  const connections = orderedRecords(state.connections, state.connection_order).flatMap(([id, connection]) => {
    const source = String(connection.source_page_id ?? '')
    const target = String(connection.target_page_id ?? '')
    return idSet.has(source) && idSet.has(target) ? [{ id, source, target }] : []
  })
  const outgoing = new Map(ids.map(id => [id, []]))
  const indegree = new Map(ids.map(id => [id, 0]))
  for (const edge of connections) {
    outgoing.get(edge.source)?.push(edge)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const primaryRoot = [...ids].sort((a, b) => (outgoing.get(b)?.length ?? 0) - (outgoing.get(a)?.length ?? 0))[0]
  const roots = [...new Set([primaryRoot, ...ids.filter(id => (indegree.get(id) ?? 0) === 0)].filter(Boolean))]
  const depths = new Map()
  const primaryEdges = new Set()
  const queued = new Set(roots)
  const queue = roots.map(id => ({ id, depth: 0 }))
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined || depths.has(current.id)) continue
    depths.set(current.id, current.depth)
    for (const edge of outgoing.get(current.id) ?? []) {
      if (depths.has(edge.target) || queued.has(edge.target)) continue
      primaryEdges.add(edge.id)
      queued.add(edge.target)
      queue.push({ id: edge.target, depth: current.depth + 1 })
    }
  }
  const fallbackDepth = Math.max(0, ...depths.values())
  for (const id of ids) if (!depths.has(id)) depths.set(id, fallbackDepth)
  const layers = new Map()
  for (const id of ids) {
    const depth = depths.get(id) ?? 0
    if (!layers.has(depth)) layers.set(depth, [])
    layers.get(depth).push(id)
  }
  const positions = new Map()
  const width = 960
  const cardWidth = 204, cardHeight = 76, horizontalGap = 24, verticalGap = 78, top = 72
  for (const [depth, layer] of [...layers].sort(([a], [b]) => a - b)) {
    const layerWidth = layer.length * cardWidth + Math.max(0, layer.length - 1) * horizontalGap
    const startX = (width - layerWidth) / 2
    layer.forEach((id, index) => positions.set(id, { x: startX + index * (cardWidth + horizontalGap), y: top + depth * (cardHeight + verticalGap) }))
  }
  const maxDepth = Math.max(0, ...depths.values())
  const height = top + (maxDepth + 1) * cardHeight + maxDepth * verticalGap + 72
  const parts = []
  parts.push('<path d="M 24 18 H 60" stroke="#6d28d9" stroke-width="3" marker-end="url(#prd-arrow)"/><text x="70" y="22" font-family="system-ui,sans-serif" font-size="12" fill="#475569">主要导航</text><path d="M 170 18 H 206" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="5 5"/><text x="216" y="22" font-family="system-ui,sans-serif" font-size="12" fill="#475569">关联跳转</text>')
  for (const edge of connections.filter(edge => !primaryEdges.has(edge.id))) {
    const from = positions.get(edge.source), to = positions.get(edge.target)
    if (from === undefined || to === undefined) continue
    const x1 = from.x + cardWidth / 2, y1 = from.y + cardHeight, x2 = to.x + cardWidth / 2, y2 = to.y
    parts.push(`<path d="M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}" fill="none" stroke="#94a3b8" stroke-width="1.35" stroke-dasharray="5 5" opacity="0.62" marker-end="url(#prd-arrow)"/>`)
  }
  for (const edge of connections.filter(edge => primaryEdges.has(edge.id))) {
    const from = positions.get(edge.source), to = positions.get(edge.target)
    if (from === undefined || to === undefined) continue
    const x1 = from.x + cardWidth / 2, y1 = from.y + cardHeight, x2 = to.x + cardWidth / 2, y2 = to.y
    const middle = (y1 + y2) / 2
    parts.push(`<path d="M ${x1} ${y1} V ${middle} H ${x2} V ${y2}" fill="none" stroke="#6d28d9" stroke-width="2.4" marker-end="url(#prd-arrow)"/>`)
  }
  for (const [id, page] of ordered) {
    const position = positions.get(id)
    if (position === undefined) continue
    const typeLabel = compactLabel(page.page_type ?? 'page', 12)
    const isRoot = id === primaryRoot
    parts.push(`<g data-prd-page-id="${escapeHtml(id)}"><rect x="${position.x}" y="${position.y}" width="${cardWidth}" height="${cardHeight}" rx="12" fill="${isRoot ? '#f5f3ff' : '#ffffff'}" stroke="${isRoot ? '#6d28d9' : '#94a3b8'}" stroke-width="${isRoot ? '2' : '1.2'}"/><text x="${position.x + 14}" y="${position.y + 31}" font-family="system-ui,sans-serif" font-size="14" font-weight="700" fill="#0f172a">${escapeHtml(compactLabel(page.name ?? id, 14))}</text><rect x="${position.x + 14}" y="${position.y + 45}" width="${Math.max(48, typeLabel.length * 8 + 16)}" height="20" rx="10" fill="#f1f5f9"/><text x="${position.x + 22}" y="${position.y + 59}" font-family="system-ui,sans-serif" font-size="10.5" fill="#475569">${escapeHtml(typeLabel)}</text></g>`)
  }
  if (ordered.length === 0) parts.push('<rect x="48" y="48" width="864" height="80" rx="12" fill="#f8fafc" stroke="#cbd5e1"/><text x="480" y="96" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" fill="#64748b">暂无页面结构</text>')
  return svgDocument(parts.join(''), `0 0 ${width} ${height}`)
}

const OWNER_PREVIEW_CSP = "default-src 'none'; base-uri 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'none'"

function confinedOwnerHtml(html, tokensCss) {
  let content = html
  let tokenStyle = ''
  if (typeof tokensCss === 'string') {
    if (/<\/style/iu.test(tokensCss)) throw new Error('design_style/tokens.css contains an unsafe closing style tag')
    tokenStyle = `<style data-prd-source-ref="design_style/tokens.css">${tokensCss}</style>`
    const link = /<link\b[^>]*href\s*=\s*(["'])[^"']*tokens\.css\1[^>]*>/iu
    if (link.test(content)) content = content.replace(link, tokenStyle)
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${OWNER_PREVIEW_CSP}">`
  const needsTokenStyle = tokenStyle !== '' && !content.includes('data-prd-source-ref="design_style/tokens.css"')
  const headContent = `${meta}${needsTokenStyle ? tokenStyle : ''}`
  if (/<head(?:\s[^>]*)?>/iu.test(content)) return content.replace(/<head(?:\s[^>]*)?>/iu, open => `${open}${headContent}`)
  if (/<html(?:\s[^>]*)?>/iu.test(content)) return content.replace(/<html(?:\s[^>]*)?>/iu, open => `${open}<head>${headContent}</head>`)
  return `<!doctype html><html><head>${headContent}</head><body>${content}</body></html>`
}

function htmlPreview(item) {
  if (typeof item.screenshot !== 'string') throw new Error(`HTML visual ${JSON.stringify(item.path)} has not been rendered`)
  const dependencies = Array.isArray(item.dependencies) && item.dependencies.length > 0 ? ` data-prd-source-dependencies="${escapeHtml(item.dependencies.join(','))}"` : ''
  return `<figure class="prd-visual-figure" data-prd-source-ref="${escapeHtml(item.path)}" data-prd-source-digest="${digest(item.content)}" data-prd-projection-digest="${digest(item.screenshot)}"${dependencies}><figcaption class="prd-visual-caption">${escapeHtml(item.title)}</figcaption><img class="prd-page-image" loading="lazy" alt="${escapeHtml(item.title)}" width="${PAGE_VIEWPORT.width * PAGE_VIEWPORT.deviceScaleFactor}" height="${PAGE_VIEWPORT.height * PAGE_VIEWPORT.deviceScaleFactor}" src="${item.screenshot}"></figure>`
}

function renderVisual(item) {
  if (item.kind === 'function-map') return `<figure class="prd-visual-figure" data-prd-source-ref="${escapeHtml(item.path)}"><figcaption class="prd-visual-caption">功能范围图</figcaption>${functionMapSvg(item.state)}</figure>`
  if (item.kind === 'page-map') return `<figure class="prd-visual-figure" data-prd-source-ref="${escapeHtml(item.path)}"><figcaption class="prd-visual-caption">页面关系图</figcaption>${pageMapSvg(item.state)}</figure>`
  if (item.kind === 'bpmn') {
    if (typeof item.renderedSvg !== 'string') throw new Error(`BPMN visual ${JSON.stringify(item.path)} has not been rendered`)
    return `<figure class="prd-visual-figure" data-prd-source-ref="${escapeHtml(item.path)}" data-prd-source-digest="${digest(item.content)}" data-prd-projection-digest="${digest(item.renderedSvg)}"><figcaption class="prd-visual-caption">${escapeHtml(item.title)}</figcaption>${item.renderedSvg}</figure>`
  }
  return htmlPreview(item)
}

function replaceVisualRegion(html, name, content) {
  const expression = new RegExp(`(<!--\\s*prd-visual:${name}:start\\s*-->)[\\s\\S]*?(<!--\\s*prd-visual:${name}:end\\s*-->)`, 'giu')
  const matches = [...html.matchAll(expression)]
  if (matches.length !== 1) throw new Error(`prd.html must keep one ordered ${name} visual region`)
  return html.replace(expression, (_match, start, end) => `${start}\n${content}\n${end}`)
}

const DISTRIBUTED_VISUAL_REGIONS = new Set(['all_bpmn', 'all_page_prototypes'])

function replaceDistributedVisualRegion(html, name, items, diagnostics) {
  const regionExpression = new RegExp(`(<!--\\s*prd-visual:${name}:start\\s*-->)(?<body>[\\s\\S]*?)(<!--\\s*prd-visual:${name}:end\\s*-->)`, 'iu')
  const region = regionExpression.exec(html)
  if (region === null) throw new Error(`prd.html must keep one ordered ${name} visual region`)
  let body = region.groups?.body ?? ''
  const expectedPaths = new Set(items.map(item => item.path))
  for (const item of items) {
    const expression = new RegExp(`(<!--\\s*prd-visual-item:${escapeRegex(item.path)}:start\\s*-->)[\\s\\S]*?(<!--\\s*prd-visual-item:${escapeRegex(item.path)}:end\\s*-->)`, 'giu')
    const matches = [...body.matchAll(expression)]
    if (matches.length !== 1) {
      diagnostics.push(`visual region ${JSON.stringify(name)} must place exactly one inline visual reference for ${JSON.stringify(item.path)}`)
      continue
    }
    body = body.replace(expression, (_match, start, end) => `${start}\n${renderVisual(item)}\n${end}`)
  }
  for (const match of body.matchAll(/<!--\s*prd-visual-item:(?<path>[A-Za-z0-9._/-]+):start\s*-->/giu)) {
    const path = match.groups?.path ?? ''
    if (!expectedPaths.has(path)) diagnostics.push(`visual region ${JSON.stringify(name)} contains unexpected inline visual reference ${JSON.stringify(path)}`)
  }
  return html.replace(regionExpression, (_match, start, _oldBody, end) => `${start}${body}${end}`)
}

async function materializeVisuals(html, sourceFiles) {
  const { plan, diagnostics } = visualPlan(sourceFiles)
  if (diagnostics.length > 0) return { html, diagnostics }
  try {
    const bpmnItems = plan.all_bpmn
    const htmlItems = [...plan.all_page_prototypes, ...plan.design_preview]
    const rendered = await renderPrdVisuals({
      bpmnItems,
      htmlItems: htmlItems.map(item => ({ ...item, ownerHtml: confinedOwnerHtml(item.content, item.tokensCss) })),
    })
    bpmnItems.forEach((item, index) => { item.renderedSvg = rendered.bpmnSvgs[index] })
    htmlItems.forEach((item, index) => { item.screenshot = rendered.htmlScreenshots[index] })
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error))
    return { html, diagnostics }
  }
  let outputHtml = html
  try {
    for (const name of VISUAL_REGIONS) {
      outputHtml = DISTRIBUTED_VISUAL_REGIONS.has(name)
        ? replaceDistributedVisualRegion(outputHtml, name, plan[name], diagnostics)
        : replaceVisualRegion(outputHtml, name, plan[name].map(renderVisual).join('\n'))
    }
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error))
  }
  return { html: outputHtml, diagnostics }
}

function output(value, ok = true) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
  if (!ok) process.exitCode = 1
}

function attribute(tag, name) {
  return new RegExp(`\\b${name}\\s*=\\s*(["'])(?<value>[\\s\\S]*?)\\1`, 'iu').exec(tag)?.groups?.value
}

function parseTemplate(template) {
  const expression = /<!--\s*prd-section\s*\n(?<meta>[\s\S]*?)-->\s*\n<h2\b[^>]*\bdata-prd-section-id\s*=\s*(["'])(?<headingId>.*?)\2[^>]*>(?<title>[\s\S]*?)<\/h2\s*>/giu
  const matches = [...String(template).matchAll(expression)]
  const sections = matches.map((match, index) => {
    const metadata = Object.fromEntries((match.groups?.meta ?? '').split('\n').flatMap(line => {
      const separator = line.indexOf(':')
      return separator < 0 ? [] : [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]]
    }))
    const id = metadata.id ?? ''
    const policy = metadata.policy
    const sources = splitIds(metadata.sources)
    const bodyStart = (match.index ?? 0) + match[0].length
    const bodyEnd = matches[index + 1]?.index ?? template.length
    const body = template.slice(bodyStart, bodyEnd)
    const visualRegions = [...body.matchAll(/<!--\s*prd-visual:([A-Za-z0-9_-]+):start\s*-->/gu)].map(item => item[1])
    const visualEnds = [...body.matchAll(/<!--\s*prd-visual:([A-Za-z0-9_-]+):end\s*-->/gu)].map(item => item[1])
    if (id === '' || id !== match.groups?.headingId || !['required', 'conditional'].includes(policy) || sources.length === 0) throw new Error(`invalid prd-section metadata before ${JSON.stringify(visibleText(match.groups?.title ?? ''))}`)
    if (JSON.stringify(visualRegions) !== JSON.stringify(visualEnds)) throw new Error(`template chapter ${JSON.stringify(id)} has unpaired visual regions`)
    return { id, policy, sources, visualRegions }
  })
  if (sections.length === 0 || new Set(sections.map(section => section.id)).size !== sections.length) throw new Error('template must declare unique prd-section blocks')
  return sections
}

function documentShellDiagnostics(html, template) {
  const diagnostics = []
  const templateStyle = /<style\b[^>]*\bdata-prd-document-style\b[^>]*>(?<css>[\s\S]*?)<\/style\s*>/iu.exec(template)
  const actualStyles = [...html.matchAll(/<style\b[^>]*>(?<css>[\s\S]*?)<\/style\s*>/giu)]
  if (templateStyle === null) diagnostics.push('reference/prd-template.html must contain the fixed document stylesheet')
  if (actualStyles.length !== 1 || !/\bdata-prd-document-style\b/iu.test(actualStyles[0]?.[0] ?? '')) diagnostics.push('prd.html must contain exactly the fixed template stylesheet')
  else if ((actualStyles[0].groups?.css ?? '').trim() !== (templateStyle?.groups?.css ?? '').trim()) diagnostics.push('prd.html document stylesheet must exactly match reference/prd-template.html')
  if (!/<body\b[^>]*\bclass\s*=\s*(["'])prd-document\1[^>]*>/iu.test(html)) diagnostics.push('prd.html body must use the fixed prd-document shell')
  if (!/<main\b[^>]*\bclass\s*=\s*(["'])prd-container\1[^>]*>/iu.test(html)) diagnostics.push('prd.html must use the fixed prd-container shell')

  let authored = html
  for (const name of VISUAL_REGIONS) authored = authored.replace(new RegExp(`(<!--\\s*prd-visual:${name}:start\\s*-->)[\\s\\S]*?(<!--\\s*prd-visual:${name}:end\\s*-->)`, 'giu'), '$1$2')
  if (/\sstyle\s*=/iu.test(authored)) diagnostics.push('prd.html authored content must not use inline style attributes; use the fixed template semantics')
  const allowedClasses = new Set([
    'prd-document', 'prd-container', 'prd-header', 'prd-title', 'prd-subtitle',
    'prd-meta', 'prd-note', 'prd-warning', 'ai-provenance',
    'prd-verbatim-source', 'prd-function', 'prd-function-summary',
    'prd-function-meta', 'prd-function-flow', 'prd-function-notes',
  ])
  for (const match of authored.matchAll(/\bclass\s*=\s*(["'])(?<classes>.*?)\1/giu)) {
    for (const name of splitIds(match.groups?.classes)) if (!allowedClasses.has(name)) diagnostics.push(`prd.html authored content uses unsupported class ${JSON.stringify(name)}`)
  }
  return diagnostics
}

function sourceFileDiagnostics(sourceFiles) {
  const diagnostics = []
  const entries = Object.entries(sourceFiles)
  if (entries.length > 64) diagnostics.push('input_files exceeds 64 files')
  let bytes = 0
  for (const [path, content] of entries) {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(path) || path.split('/').includes('..')) diagnostics.push(`input_files contains unsafe path ${JSON.stringify(path)}`)
    if (typeof content !== 'string') diagnostics.push(`source file ${JSON.stringify(path)} must be text`)
    else {
      const size = Buffer.byteLength(content, 'utf8')
      bytes += size
      if (size > 512 * 1024) diagnostics.push(`source file ${JSON.stringify(path)} exceeds 524288 bytes`)
    }
  }
  if (bytes > 4 * 1024 * 1024) diagnostics.push('input_files exceeds 4194304 total bytes')
  return diagnostics
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function sourceOwner(ref) {
  const value = String(ref ?? '').trim()
  return value === 'user' || value === 'upload' ? value : value.split('/')[0]
}

function decodeEntities(value) {
  return value.replace(/&#(\d+);/gu, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&nbsp;', ' ').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&')
}

function visibleText(value) {
  return decodeEntities(String(value).replace(/<style\b[\s\S]*?<\/style>/giu, ' ').replace(/<[^>]+>/gu, ' ')).replace(/\s+/gu, ' ').trim()
}

function protectedBlocks(body) {
  const matches = []
  const expression = /<(?<tag>div|p|li|td|th|section|article|blockquote)\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/\k<tag>\s*>/giu
  for (const match of body.matchAll(expression)) {
    const classes = splitIds(attribute(match[0], 'class'))
    if (classes.includes('ai-provenance') || classes.includes('prd-verbatim-source')) matches.push({ ...match.groups, full: match[0] })
  }
  return matches
}

function htmlDiagnostics(state, html, template, sourceFiles) {
  const diagnostics = []
  const lower = html.toLowerCase()
  if (!lower.includes('<html') || !lower.includes('</html>') || !lower.includes('<body') || !lower.includes('</body>')) diagnostics.push('prd.html must be a complete HTML document')
  if (/<(?:script|object|embed|base)\b/iu.test(html)) diagnostics.push('prd.html must not contain executable or base-rewriting elements')
  diagnostics.push(...documentShellDiagnostics(html, template))
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*(["'])(?<ref>.*?)\1/giu)) {
    const ref = match.groups?.ref ?? ''
    if (/^(?:javascript|file):/iu.test(ref)) diagnostics.push(`prd.html contains unsafe reference: ${ref}`)
    if (/^https?:\/\//iu.test(ref) && /\bsrc\s*=/iu.test(match[0])) diagnostics.push(`remote visual asset must be embedded or copied into the Bundle: ${ref}`)
  }

  const templateSections = parseTemplate(template)
  const templateById = new Map(templateSections.map(section => [section.id, section]))
  const declaredVisuals = new Set(templateSections.flatMap(section => section.visualRegions))
  const headingMatches = [...html.matchAll(/<h2\b[^>]*\bdata-prd-section-id\s*=\s*(["'])(?<id>.*?)\1[^>]*>/giu)]
  const actualSections = new Map()
  for (const [index, match] of headingMatches.entries()) {
    const id = match.groups?.id ?? ''
    if (actualSections.has(id)) diagnostics.push(`prd.html repeats chapter ${JSON.stringify(id)}`)
    const openingEnd = (match.index ?? 0) + match[0].length
    const closing = html.indexOf('</h2>', openingEnd)
    const bodyStart = closing < 0 ? openingEnd : closing + '</h2>'.length
    actualSections.set(id, { tag: match[0], body: html.slice(bodyStart, headingMatches[index + 1]?.index ?? html.length) })
  }
  for (const section of templateSections.filter(section => section.policy === 'required')) if (!actualSections.has(section.id)) diagnostics.push(`prd.html is missing required chapter ${JSON.stringify(section.id)}`)
  for (const id of actualSections.keys()) if (!templateById.has(id)) diagnostics.push(`prd.html contains unknown chapter ${JSON.stringify(id)}`)

  const provenanceItems = new Map()
  for (const raw of Array.isArray(state.ai_provenance) ? state.ai_provenance : []) {
    const item = record(raw)
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (id === '') diagnostics.push('every ai_provenance item requires an id')
    else if (provenanceItems.has(id)) diagnostics.push(`ai_provenance id ${JSON.stringify(id)} is duplicated`)
    else provenanceItems.set(id, item)
    if (!Array.isArray(item.section_ids) || item.section_ids.length === 0) diagnostics.push(`ai_provenance ${JSON.stringify(id)} requires section_ids`)
    if (!Array.isArray(item.source_refs)) diagnostics.push(`ai_provenance ${JSON.stringify(id)} requires source_refs`)
    if (item.operation !== 'completion') diagnostics.push(`ai_provenance ${JSON.stringify(id)} must be a temporary completion`)
    if (!isRecord(item.assumption)) diagnostics.push(`ai_provenance ${JSON.stringify(id)} requires a pending assumption`)
    else for (const field of ['decision', 'reason', 'impact', 'decision_owner']) {
      if (typeof item.assumption[field] !== 'string' || item.assumption[field].trim() === '') diagnostics.push(`ai_provenance ${JSON.stringify(id)} pending assumption requires ${field}`)
    }
  }

  const globallyVisible = new Set()
  for (const [id, actual] of actualSections) {
    const policy = templateById.get(id)
    if (policy === undefined) continue
    const listedSources = new Set(splitIds(attribute(actual.tag, 'data-prd-sources')))
    const listedProvenance = new Set(splitIds(attribute(actual.tag, 'data-prd-provenance-ids')))
    if (listedSources.size === 0) diagnostics.push(`chapter ${JSON.stringify(id)} must declare data-prd-sources`)
    if (attribute(actual.tag, 'data-prd-provenance-ids') === undefined) diagnostics.push(`chapter ${JSON.stringify(id)} must declare data-prd-provenance-ids`)
    if (NARRATIVE_SECTIONS.has(id) && !/<p\b[^>]*>[\s\S]*?\S[\s\S]*?<\/p\s*>/iu.test(actual.body)) diagnostics.push(`chapter ${JSON.stringify(id)} requires explanatory prose; tables and lists may only support the narrative`)
    for (const owner of listedSources) {
      if (!policy.sources.includes(owner)) diagnostics.push(`chapter ${JSON.stringify(id)} uses disallowed source owner ${JSON.stringify(owner)}`)
      if (owner !== 'user' && owner !== 'upload') {
        const canonical = sourceFiles[`${owner}/${owner}.json`]
        if (typeof canonical !== 'string') diagnostics.push(`chapter ${JSON.stringify(id)} uses unavailable source owner ${JSON.stringify(owner)}`)
      }
    }

    const expectedIds = new Set([...provenanceItems].filter(([, item]) => Array.isArray(item.section_ids) && item.section_ids.includes(id)).map(([provenanceId]) => provenanceId))
    for (const provenanceId of expectedIds) if (!listedProvenance.has(provenanceId)) diagnostics.push(`chapter ${JSON.stringify(id)} omits provenance ${JSON.stringify(provenanceId)} from data-prd-provenance-ids`)
    for (const provenanceId of listedProvenance) if (!expectedIds.has(provenanceId)) diagnostics.push(`chapter ${JSON.stringify(id)} lists undeclared provenance ${JSON.stringify(provenanceId)}`)

    const visibleHere = new Set()
    for (const block of protectedBlocks(actual.body)) {
      const classes = splitIds(attribute(block.full, 'class'))
      if (classes.includes('ai-provenance')) {
        const provenanceId = attribute(block.full, 'data-provenance-id')?.trim() ?? ''
        if (provenanceId === '') diagnostics.push(`chapter ${JSON.stringify(id)} has an ai-provenance rail without data-provenance-id`)
        else { visibleHere.add(provenanceId); globallyVisible.add(provenanceId) }
      }
      if (classes.includes('prd-verbatim-source')) {
        const ref = attribute(block.full, 'data-prd-source-ref')?.trim() ?? ''
        const owner = sourceOwner(ref)
        const source = sourceFiles[ref]
        if (ref === '' || typeof source !== 'string') diagnostics.push(`chapter ${JSON.stringify(id)} has an unverifiable verbatim source ${JSON.stringify(ref)}`)
        else if (!visibleText(source).includes(visibleText(block.body))) diagnostics.push(`chapter ${JSON.stringify(id)} verbatim text is absent from fixed source ${JSON.stringify(ref)}`)
        if (!policy.sources.includes(owner) || !listedSources.has(owner)) diagnostics.push(`chapter ${JSON.stringify(id)} verbatim source ${JSON.stringify(ref)} is not allowed and listed`)
      }
    }
    for (const provenanceId of visibleHere) if (!expectedIds.has(provenanceId)) diagnostics.push(`chapter ${JSON.stringify(id)} visibly uses undeclared provenance ${JSON.stringify(provenanceId)}`)
    const authorityOwner = OWNER_GATED_SECTIONS[id]
    if (authorityOwner !== undefined && typeof sourceFiles[`${authorityOwner}/${authorityOwner}.json`] !== 'string') {
      const outsideRails = actual.body
        .replace(/<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bai-provenance\b[^"']*\1)[^>]*>[\s\S]*?<\/div\s*>/giu, '')
        .replace(/<figure\b[^>]*>[\s\S]*?<\/figure\s*>/giu, '')
        .replace(/<h[34]\b[^>]*>[\s\S]*?<\/h[34]\s*>/giu, '')
        .replace(/<!--[\s\S]*?-->/gu, '')
      if (visibleText(outsideRails) !== '') diagnostics.push(`chapter ${JSON.stringify(id)} has concrete content without its authority Bundle ${JSON.stringify(authorityOwner)}; wrap every temporary completion in declared ai-provenance rails`)
    }
    for (const name of policy.visualRegions) {
      const starts = [...actual.body.matchAll(new RegExp(`<!--\\s*prd-visual:${name}:start\\s*-->`, 'giu'))]
      const ends = [...actual.body.matchAll(new RegExp(`<!--\\s*prd-visual:${name}:end\\s*-->`, 'giu'))]
      if (starts.length !== 1 || ends.length !== 1 || (starts[0]?.index ?? 0) >= (ends[0]?.index ?? 0)) diagnostics.push(`visual region ${JSON.stringify(name)} must remain inside chapter ${JSON.stringify(id)}`)
    }
    for (const match of actual.body.matchAll(/<!--\s*prd-visual:([A-Za-z0-9_-]+):(?:start|end)\s*-->/giu)) {
      if (!policy.visualRegions.includes(match[1])) diagnostics.push(`visual region ${JSON.stringify(match[1])} is in the wrong chapter ${JSON.stringify(id)}`)
    }
  }

  for (const [provenanceId, item] of provenanceItems) {
    if (!globallyVisible.has(provenanceId)) diagnostics.push(`ai_provenance ${JSON.stringify(provenanceId)} has no visible rail in prd.html`)
    for (const ref of Array.isArray(item.source_refs) ? item.source_refs : []) {
      const owner = sourceOwner(ref)
      for (const sectionId of Array.isArray(item.section_ids) ? item.section_ids : []) {
        const policy = templateById.get(String(sectionId))
        const actual = actualSections.get(String(sectionId))
        const listed = new Set(splitIds(attribute(actual?.tag ?? '', 'data-prd-sources')))
        if (policy === undefined || !policy.sources.includes(owner)) diagnostics.push(`ai_provenance ${JSON.stringify(provenanceId)} uses source ${JSON.stringify(ref)} outside chapter policy`)
        if (!listed.has(owner)) diagnostics.push(`ai_provenance ${JSON.stringify(provenanceId)} source owner ${JSON.stringify(owner)} is absent from chapter data-prd-sources`)
      }
      if (owner !== 'user' && owner !== 'upload' && typeof sourceFiles[String(ref)] !== 'string') diagnostics.push(`ai_provenance ${JSON.stringify(provenanceId)} references unavailable fixed source ${JSON.stringify(ref)}`)
    }
  }

  for (const name of declaredVisuals) {
    const starts = [...html.matchAll(new RegExp(`<!--\\s*prd-visual:${name}:start\\s*-->`, 'giu'))]
    const ends = [...html.matchAll(new RegExp(`<!--\\s*prd-visual:${name}:end\\s*-->`, 'giu'))]
    if (starts.length !== 1 || ends.length !== 1 || (starts[0]?.index ?? 0) >= (ends[0]?.index ?? 0)) diagnostics.push(`prd.html must keep one ordered ${name} visual region`)
  }
  for (const match of html.matchAll(/<!--\s*prd-visual:([A-Za-z0-9_-]+):(?:start|end)\s*-->/giu)) if (!declaredVisuals.has(match[1])) diagnostics.push(`prd.html contains unsupported visual region ${JSON.stringify(match[1])}`)

  const visual = visualPlan(sourceFiles)
  diagnostics.push(...visual.diagnostics)
  for (const name of declaredVisuals) {
    const region = new RegExp(`<!--\\s*prd-visual:${name}:start\\s*-->(?<body>[\\s\\S]*?)<!--\\s*prd-visual:${name}:end\\s*-->`, 'iu').exec(html)?.groups?.body ?? ''
    const expected = visual.plan[name] ?? []
    const expectedRefs = expected.map(item => item.path)
    if (!DISTRIBUTED_VISUAL_REGIONS.has(name) && !expected.some(item => item.kind === 'html')) {
      const expectedMarkup = expected.map(renderVisual).join('\n')
      if (region.trim() !== expectedMarkup.trim()) diagnostics.push(`visual region ${JSON.stringify(name)} does not match its deterministic owner projection`)
    }
    if (DISTRIBUTED_VISUAL_REGIONS.has(name)) {
      for (const item of expected) {
        const starts = [...region.matchAll(new RegExp(`<!--\\s*prd-visual-item:${escapeRegex(item.path)}:start\\s*-->`, 'giu'))]
        const ends = [...region.matchAll(new RegExp(`<!--\\s*prd-visual-item:${escapeRegex(item.path)}:end\\s*-->`, 'giu'))]
        if (starts.length !== 1 || ends.length !== 1 || (starts[0]?.index ?? 0) >= (ends[0]?.index ?? 0)) diagnostics.push(`visual region ${JSON.stringify(name)} must keep one ordered inline visual reference for ${JSON.stringify(item.path)}`)
        const entityExpression = new RegExp(`<section\\b[^>]*\\bdata-prd-entity-ref\\s*=\\s*(["'])${escapeRegex(item.path)}\\1[^>]*>(?<body>[\\s\\S]*?)<\\/section\\s*>`, 'giu')
        const entityBlocks = [...region.matchAll(entityExpression)]
        if (entityBlocks.length !== 1) diagnostics.push(`visual region ${JSON.stringify(name)} must keep one entity section for ${JSON.stringify(item.path)}`)
        else {
          const entityBody = entityBlocks[0].groups?.body ?? ''
          const itemStart = new RegExp(`<!--\\s*prd-visual-item:${escapeRegex(item.path)}:start\\s*-->`, 'iu').exec(entityBody)
          const paragraph = /<p\b[^>]*>[\s\S]*?\S[\s\S]*?<\/p\s*>/iu.exec(entityBody)
          if (itemStart === null) diagnostics.push(`visual for ${JSON.stringify(item.path)} must remain inside its matching entity section`)
          if (paragraph === null) diagnostics.push(`entity ${JSON.stringify(item.path)} requires explanatory prose before its visual`)
          else if ((paragraph.index ?? 0) > (itemStart?.index ?? Number.POSITIVE_INFINITY)) diagnostics.push(`entity ${JSON.stringify(item.path)} must explain the design before showing its visual`)
        }
      }
    }
    const expectedDependencies = expected.flatMap(item => Array.isArray(item.dependencies) ? item.dependencies : [])
    const sectionPolicy = templateSections.find(section => section.visualRegions.includes(name))
    const sectionSources = new Set(splitIds(attribute(actualSections.get(sectionPolicy?.id ?? '')?.tag ?? '', 'data-prd-sources')))
    const actualRefs = [...region.matchAll(/\bdata-prd-source-ref\s*=\s*(["'])(?<ref>.*?)\1/giu)].map(match => decodeEntities(match.groups?.ref ?? ''))
    const actualDependencies = [...region.matchAll(/\bdata-prd-source-dependencies\s*=\s*(["'])(?<refs>.*?)\1/giu)].flatMap(match => splitIds(decodeEntities(match.groups?.refs ?? '')))
    for (const ref of expectedRefs) {
      const count = actualRefs.filter(actual => actual === ref).length
      if (count !== 1) diagnostics.push(`visual region ${JSON.stringify(name)} must contain exactly one projection of ${JSON.stringify(ref)}`)
      if (!sectionSources.has(sourceOwner(ref))) diagnostics.push(`visual region ${JSON.stringify(name)} source owner ${JSON.stringify(sourceOwner(ref))} is absent from chapter data-prd-sources`)
      const figureMatch = new RegExp(`(?<tag><figure\\b[^>]*\\bdata-prd-source-ref\\s*=\\s*(["'])${escapeRegex(ref)}\\2[^>]*>)(?<body>[\\s\\S]*?)<\\/figure\\s*>`, 'iu').exec(region)
      const figureTag = figureMatch?.groups?.tag ?? ''
      const figure = figureMatch?.groups?.body ?? ''
      const item = expected.find(candidate => candidate.path === ref)
      if (item?.kind === 'html') {
        const image = /<img\b[^>]*\bclass\s*=\s*(["'])prd-page-image\1[^>]*>/iu.exec(figure)?.[0]
        const source = image === undefined ? undefined : decodeEntities(attribute(image, 'src') ?? '')
        if (image === undefined || !source?.startsWith('data:image/png;base64,')) diagnostics.push(`HTML visual ${JSON.stringify(ref)} must be embedded as a rendered PNG preview`)
        else {
          if (attribute(image, 'width') !== String(PAGE_VIEWPORT.width * PAGE_VIEWPORT.deviceScaleFactor) || attribute(image, 'height') !== String(PAGE_VIEWPORT.height * PAGE_VIEWPORT.deviceScaleFactor)) diagnostics.push(`HTML visual ${JSON.stringify(ref)} must preserve the ${PAGE_VIEWPORT.width}x${PAGE_VIEWPORT.height} design viewport at ${PAGE_VIEWPORT.deviceScaleFactor}x density`)
          if (attribute(figureTag, 'data-prd-source-digest') !== digest(item.content)) diagnostics.push(`HTML visual ${JSON.stringify(ref)} is stale relative to its owner artifact`)
          if (attribute(figureTag, 'data-prd-projection-digest') !== digest(source)) diagnostics.push(`HTML visual ${JSON.stringify(ref)} projection integrity check failed`)
        }
      } else if (item?.kind === 'bpmn') {
        const svg = /<svg\b[^>]*\bdata-prd-bpmn-renderer\s*=\s*(["'])bpmn-js@18\.24\.0\1[^>]*>[\s\S]*?<\/svg\s*>/iu.exec(figure)?.[0]
        if (svg === undefined) diagnostics.push(`BPMN visual ${JSON.stringify(ref)} must be an embedded ${BPMN_RENDERER} SVG projection`)
        else {
          if (attribute(figureTag, 'data-prd-source-digest') !== digest(item.content)) diagnostics.push(`BPMN visual ${JSON.stringify(ref)} is stale relative to its owner artifact`)
          if (attribute(figureTag, 'data-prd-projection-digest') !== digest(svg)) diagnostics.push(`BPMN visual ${JSON.stringify(ref)} projection integrity check failed`)
        }
      } else if (item !== undefined) {
        const expectedSvg = item.kind === 'function-map' ? functionMapSvg(item.state) : pageMapSvg(item.state)
        if (!figure.includes(expectedSvg)) diagnostics.push(`visual projection ${JSON.stringify(ref)} does not match its deterministic owner projection`)
      }
    }
    for (const ref of actualRefs) if (!expectedRefs.includes(ref)) diagnostics.push(`visual region ${JSON.stringify(name)} contains unexpected source ${JSON.stringify(ref)}`)
    const dependencyRefs = new Set([...expectedDependencies, ...actualDependencies])
    for (const ref of dependencyRefs) {
      const expectedCount = expectedDependencies.filter(expected => expected === ref).length
      const actualCount = actualDependencies.filter(actual => actual === ref).length
      if (actualCount !== expectedCount) diagnostics.push(`visual region ${JSON.stringify(name)} must bind dependency ${JSON.stringify(ref)} exactly ${expectedCount} time(s)`)
    }
    if (expected.length > 0 && visibleText(region) === '' && !/<(?:svg|iframe)\b/iu.test(region)) diagnostics.push(`visual region ${JSON.stringify(name)} is empty despite available owner artifacts`)
    if (expected.length === 0 && region.replace(/<!--\s*prd-visual-item:[\s\S]*?-->/giu, '').trim() !== '') diagnostics.push(`visual region ${JSON.stringify(name)} must be empty because no owner artifact was provided`)
  }
  const expectedImageCount = Object.values(visual.plan).flat().filter(item => item.kind === 'html').length
  const previewImages = [...html.matchAll(/<img\b[^>]*\bclass\s*=\s*(["'])prd-page-image\1[^>]*>/giu)]
  if (previewImages.length !== expectedImageCount) diagnostics.push(`prd.html must contain exactly ${expectedImageCount} rendered owner-artifact preview image(s) inside visual regions`)
  const iframeTags = [...html.matchAll(/<iframe\b[^>]*>/giu)]
  if (iframeTags.length > 0) diagnostics.push('PRD must not rely on iframe previews; render owner HTML to a static image during assembly')
  return [...new Set(diagnostics)]
}

function stateDiagnostics(state) {
  const diagnostics = []
  if (state.schema_version !== 8) diagnostics.push('schema_version must equal 8')
  if (typeof state.title !== 'string' || state.title.trim() === '') diagnostics.push('title must not be empty')
  if (!['concise', 'detailed'].includes(state.detail_level)) diagnostics.push('detail_level must be concise or detailed')
  if (state.html_file !== htmlPath) diagnostics.push(`html_file must equal ${htmlPath}`)
  if (!Array.isArray(state.ai_provenance)) diagnostics.push('ai_provenance must be an array')
  return diagnostics
}

const state = record(input.state ?? record(input.candidate).state)
const artifacts = record(input.artifacts)
const sourceFiles = record(input.input_files)
const html = stripFence(inputHtml)
const template = String(input.template ?? '')

if (action === 'materialize-visuals') {
  const prepared = await materializeVisuals(html, sourceFiles)
  const diagnostics = [...sourceFileDiagnostics(sourceFiles), ...prepared.diagnostics]
  if (html === '') diagnostics.push('prd.html is missing or empty')
  if (diagnostics.length > 0) output({ valid: false, diagnostics: [...new Set(diagnostics)] }, false)
  else process.stdout.write(prepared.html)
} else if (action !== 'validate-html-file') {
  output({ valid: false, diagnostics: [`unknown PRD script action: ${action}`] }, false)
} else {
  const diagnostics = [...stateDiagnostics(state), ...sourceFileDiagnostics(sourceFiles)]
  if (html === '') diagnostics.push('prd.html is missing or empty')
  if (template.trim() === '') diagnostics.push('reference/prd-template.html is required')
  if (html !== '' && template.trim() !== '') {
    try { diagnostics.push(...htmlDiagnostics(state, html, template, sourceFiles)) } catch (error) { diagnostics.push(error instanceof Error ? error.message : String(error)) }
  }
  output({ valid: diagnostics.length === 0, diagnostics }, diagnostics.length === 0)
}
