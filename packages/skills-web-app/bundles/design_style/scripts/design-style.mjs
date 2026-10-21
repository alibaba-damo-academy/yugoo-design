import { readFileSync } from 'node:fs'

const rawInput = readFileSync(0, 'utf8')
const action = process.argv[2]
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const record = value => isRecord(value) ? value : {}
const sanitize = value => String(value).replaceAll('<', '').replaceAll('>', '').replaceAll('{', '').replaceAll('}', '')
const tokenName = value => String(value).replace(/([a-z0-9])([A-Z])/gu, '$1-$2').replace(/[^a-zA-Z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '').toLowerCase()
const styleBlock = /<style\b([^>]*)>([\s\S]*?)<\/style>/giu
const cssDeclaration = /(?:^|[;{])\s*([a-z-]+)\s*:\s*([^;}{]+)/giu
const rawLength = /(?:^|[\s,(])(?:\.\d+|\d*\.\d+|[1-9]\d*)(?:px|r?em|ch|ex|vw|vh|vmin|vmax|cm|mm|in|pt|pc)(?=$|[\s,/)])/iu
const colorProperties = new Set(['color', 'background', 'background-color', 'background-image', 'border-color', 'outline-color', 'box-shadow', 'fill', 'stroke'])
const spacingProperties = new Set(['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'gap', 'row-gap', 'column-gap'])
const font = (value, fallback) => {
  const text = String(value ?? '').trim()
  if (text === '') return fallback
  return /\b(?:serif|sans-serif|monospace|system-ui|ui-monospace|ui-serif|ui-sans-serif|cursive|fantasy)\b/iu.test(text) ? text : `${text}, ${fallback}`
}

function cssVars(config) {
  const cfg = record(config)
  const colors = record(cfg.colors)
  const semantic = record(cfg.semantic_colors)
  const typography = record(cfg.typography)
  const components = record(cfg.components)
  const iconography = record(cfg.iconography)
  const layout = record(cfg.layout)
  const motion = { duration_fast: '150ms', duration_normal: '300ms', duration_slow: '500ms', ease_standard: 'cubic-bezier(0.16, 1, 0.3, 1)', ease_in: 'cubic-bezier(0.7, 0, 0.84, 0)', ease_out: 'cubic-bezier(0.16, 1, 0.3, 1)', ease_spring: 'cubic-bezier(0.5, 1.5, 0.5, 1)', ...record(cfg.motion) }
  const spacing = { base: '4px', scale: ['4px', '8px', '12px', '16px', '24px', '32px', '48px', '64px', '96px', '128px'], ...record(cfg.spacing) }
  const elevation = { dropdown: 10, sticky_nav: 20, drawer: 30, modal_backdrop: 40, modal: 50, toast: 60, tooltip: 70, ...record(cfg.elevation) }
  const breakpoints = { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', xxl: '1536px', ...record(cfg.breakpoints) }
  const radius = ({ '0px': '0px', '4px': '4px', '8px': '8px', '12px': '12px', '16px': '16px', full: '9999px' })[String(components.borderRadius ?? '8px')] ?? String(components.borderRadius ?? '8px')
  const shadow = ({ none: 'none', subtle: '0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.06)', medium: '0 4px 6px rgba(0, 0, 0, 0.06), 0 10px 15px rgba(0, 0, 0, 0.08)', deep: '0 10px 15px rgba(0, 0, 0, 0.1), 0 20px 25px rgba(0, 0, 0, 0.12)' })[String(components.shadowDepth ?? 'medium')] ?? 'none'
  const density = String(layout.density ?? 'comfortable')
  const vars = {
    '--ds-primary': colors.primary ?? '#0C66E4', '--ds-primary-light': colors.primaryLight ?? colors.primary ?? '#E9F2FF', '--ds-primary-dark': colors.primaryDark ?? colors.primary ?? '#0055CC',
    '--ds-secondary': colors.secondary ?? '#44546F', '--ds-accent': colors.accent ?? '#0C66E4', '--ds-background': colors.background ?? '#F7F8FA', '--ds-surface': colors.surface ?? colors.background ?? '#FFFFFF', '--ds-text': colors.text ?? '#172B4D', '--ds-text-secondary': colors.textSecondary ?? '#5E6C84', '--ds-border': colors.border ?? '#DFE1E6',
    '--ds-success': semantic.success ?? '#216E4E', '--ds-warning': semantic.warning ?? '#A54800', '--ds-error': semantic.error ?? '#AE2E24', '--ds-info': semantic.info ?? '#0C66E4',
    '--ds-heading-font': font(typography.headingFont ?? 'Inter, system-ui, -apple-system, sans-serif', '"PingFang SC", system-ui, sans-serif'), '--ds-body-font': font(typography.bodyFont ?? 'Inter, system-ui, -apple-system, sans-serif', '"PingFang SC", system-ui, sans-serif'), '--ds-mono-font': font(typography.monoFont ?? 'JetBrains Mono, monospace', 'ui-monospace, monospace'), '--ds-base-font-size': typography.baseFontSize ?? '14px', '--ds-heading-weight': typography.headingWeight ?? '600', '--ds-line-height': typography.lineHeight ?? '1.5',
    '--ds-radius': radius, '--ds-shadow': shadow, '--ds-density-gap': ({ compact: '12px', comfortable: '20px', spacious: '32px' })[density] ?? '20px', '--ds-density-padding': ({ compact: '12px', comfortable: '20px', spacious: '32px' })[density] ?? '20px', '--ds-content-width': ({ narrow: '768px', medium: '1024px', wide: '1280px', full: '100%' })[String(layout.content_width ?? 'wide')] ?? '1280px',
    '--ds-font-size-xs': typography.fontSizeXs ?? '12px', '--ds-font-size-sm': typography.fontSizeSm ?? '13px', '--ds-font-size-md': typography.fontSizeMd ?? typography.baseFontSize ?? '14px', '--ds-font-size-lg': typography.fontSizeLg ?? '16px', '--ds-font-size-xl': typography.fontSizeXl ?? '20px', '--ds-font-size-2xl': typography.fontSize2xl ?? '28px',
    '--ds-line-height-tight': typography.lineHeightTight ?? '1.25', '--ds-line-height-normal': typography.lineHeight ?? '1.5', '--ds-line-height-relaxed': typography.lineHeightRelaxed ?? '1.7',
    '--ds-radius-sm': components.radiusSm ?? '4px', '--ds-radius-md': components.radiusMd ?? radius, '--ds-radius-lg': components.radiusLg ?? '12px', '--ds-radius-full': components.radiusFull ?? '9999px',
    '--ds-icon-size-sm': iconography.size_sm ?? '16px', '--ds-icon-size-md': iconography.size_md ?? '20px', '--ds-icon-size-lg': iconography.size_lg ?? '24px', '--ds-icon-stroke-width': iconography.stroke_width ?? '1.75',
  }
  for (const [name, value] of Object.entries(colors)) vars[`--ds-${tokenName(name)}`] = value
  for (const [name, value] of Object.entries(semantic)) vars[`--ds-${tokenName(name)}`] = value
  for (const [name, value] of Object.entries(motion)) vars[`--ds-${tokenName(name)}`] = value
  for (const [name, value] of Object.entries(elevation)) vars[`--ds-z-${tokenName(name)}`] = value
  for (const [name, value] of Object.entries(breakpoints)) vars[`--ds-breakpoint-${tokenName(name)}`] = value
  vars['--ds-space-base'] = spacing.base
  if (Array.isArray(spacing.scale)) spacing.scale.forEach((value, index) => { vars[`--ds-space-${index + 1}`] = value })
  return Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, sanitize(value)]))
}

function tokensCss(config) {
  const declarations = Object.entries(cssVars(config)).map(([key, value]) => `  ${key}: ${value};`).join('\n')
  return `/* Generated from design_style.json. Do not edit this projection. */\n:root {\n${declarations}\n}\n`
}

function previewTokenDiagnostics(path, html) {
  const groups = { color: new Set(), font: new Set(), radius: new Set(), shadow: new Set(), spacing: new Set(), size: new Set(), line: new Set() }
  for (const block of html.matchAll(styleBlock)) {
    if (/\bid=["']ds-runtime-vars["']/iu.test(block[1] ?? '')) continue
    for (const declaration of (block[2] ?? '').matchAll(cssDeclaration)) {
      const property = (declaration[1] ?? '').toLowerCase()
      const value = (declaration[2] ?? '').trim()
      const consumesToken = /var\(\s*--ds-/u.test(value)
      const example = `${property}: ${value}`
      if (colorProperties.has(property) && /#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/iu.test(value)) groups.color.add(example)
      if (property === 'font-family' && !consumesToken && !/^(?:inherit|initial|revert|unset)$/iu.test(value)) groups.font.add(example)
      if ((property === 'border-radius' || property.endsWith('-radius')) && !consumesToken && rawLength.test(value)) groups.radius.add(example)
      if ((property === 'box-shadow' || property === 'text-shadow') && !consumesToken && value.toLowerCase() !== 'none') groups.shadow.add(example)
      if (spacingProperties.has(property) && !consumesToken && rawLength.test(value)) groups.spacing.add(example)
      if (property === 'font-size' && !consumesToken && /[0-9]/u.test(value)) groups.size.add(example)
      if (property === 'line-height' && !consumesToken && /[0-9]/u.test(value)) groups.line.add(example)
    }
  }
  const diagnostics = []
  const detail = values => [...values].slice(0, 12).join('; ')
  if (groups.color.size > 0) diagnostics.push(`${path} bypasses tokens with raw colors: ${detail(groups.color)}`)
  if (groups.font.size > 0) diagnostics.push(`${path} bypasses tokens with literal font families: ${detail(groups.font)}`)
  if (groups.radius.size > 0) diagnostics.push(`${path} bypasses tokens with raw radii: ${detail(groups.radius)}`)
  if (groups.shadow.size > 0) diagnostics.push(`${path} bypasses tokens with raw shadows: ${detail(groups.shadow)}`)
  if (groups.spacing.size > 0) diagnostics.push(`${path} bypasses tokens with raw spacing: ${detail(groups.spacing)}`)
  if (groups.size.size > 0) diagnostics.push(`${path} bypasses tokens with raw font sizes: ${detail(groups.size)}`)
  if (groups.line.size > 0) diagnostics.push(`${path} bypasses tokens with raw line heights: ${detail(groups.line)}`)
  return diagnostics
}

function designMd(state) {
  const config = record(state.config)
  const preview = record(config.preview_page)
  const sections = ['brand', 'colors', 'semantic_colors', 'typography', 'hierarchy', 'layout', 'spacing', 'elevation', 'components', 'component_patterns', 'iconography', 'icons', 'motion']
  const lines = ['---', 'version: alpha', `name: ${JSON.stringify(String(record(config.brand).name ?? config.theme ?? 'Product Design'))}`, '---', '', '<!-- Generated from design_style.json. Update canonical state, not this projection. -->', '', '## Overview', '', String(config.theme ?? 'Visual direction not yet specified.')]
  for (const section of sections) {
    lines.push('', `## ${section.replaceAll('_', ' ')}`, '', '```json', JSON.stringify(record(config[section]), null, 2), '```')
  }
  lines.push('', '## Representative Screen', '', `- Title: ${String(preview.title ?? preview.name ?? 'Not specified')}`, `- Rationale: ${String(preview.rationale ?? 'Not specified')}`, `- Implementation reference: ${String(preview.html_file ?? 'Not specified')}`, '', "## Do's and Don'ts", '', '- Consume the sibling `tokens.css`.', '- Do not invent a competing palette or type scale.')
  return `${lines.join('\n').trimEnd()}\n`
}

function pages(config) {
  return [config.preview_page, ...(Array.isArray(config.preview_pages) ? config.preview_pages : [])].filter(isRecord)
}

function validSvg(value) {
  const svg = String(value ?? '').trim()
  return /^<svg\b[\s\S]*<\/svg>$/iu.test(svg)
    && (svg.match(/<svg\b/giu) ?? []).length === 1
    && (svg.match(/<\/svg>/giu) ?? []).length === 1
    && !/<(?:script|iframe|object|embed)\b/iu.test(svg)
    && !/\bon[a-z]+\s*=/iu.test(svg)
    && !/javascript\s*:/iu.test(svg)
    && !/(?:href|src)\s*=\s*["'](?:https?:|\/\/)/iu.test(svg)
}

function validate(state, artifacts) {
  const diagnostics = []
  const config = record(state.config)
  if (Object.keys(config).length === 0) return diagnostics
  const brand = record(config.brand)
  const markId = typeof brand.mark_id === 'string' ? brand.mark_id.trim() : ''
  const markSvg = typeof brand.mark_svg === 'string' ? brand.mark_svg.trim() : ''
  if ((markId === '') !== (markSvg === '')) diagnostics.push('config.brand.mark_id and mark_svg must be supplied together')
  if (markSvg !== '' && !validSvg(markSvg)) diagnostics.push('config.brand.mark_svg must be one safe complete SVG document')
  const icons = record(config.icons)
  if (Object.keys(icons).length > 0 && String(record(config.iconography).library ?? '').trim() === '') diagnostics.push('config.iconography.library is required when config.icons is non-empty')
  for (const [id, value] of Object.entries(icons)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id)) diagnostics.push(`config.icons key ${JSON.stringify(id)} must be a stable semantic id`)
    const icon = record(value)
    if (String(icon.label ?? '').trim() === '') diagnostics.push(`config.icons.${id}.label must be non-empty`)
    if (!validSvg(icon.svg)) diagnostics.push(`config.icons.${id}.svg must be one safe complete SVG document`)
  }
  if (artifacts['design_style/DESIGN.md'] !== designMd(state)) diagnostics.push('design_style/DESIGN.md is missing or does not match canonical state')
  const expectedCss = tokensCss(config)
  if (artifacts['design_style/tokens.css'] !== expectedCss) diagnostics.push('design_style/tokens.css is missing or does not match canonical state')
  const declared = new Set([...expectedCss.matchAll(/(--ds-[a-z0-9-]+)\s*:/gu)].map(match => match[1]))
  for (const page of pages(config)) {
    const path = page.html_file
    if (typeof path !== 'string' || !/^design_style\/[A-Za-z0-9][A-Za-z0-9._-]*\.html$/u.test(path)) { diagnostics.push('preview html_file must be design_style/<name>.html'); continue }
    const html = artifacts[path]
    if (typeof html !== 'string' || html.trim() === '') { diagnostics.push(`${path} is missing`); continue }
    const lower = html.toLowerCase()
    if (!lower.includes('<html') || !lower.includes('</html>') || !lower.includes('<body') || !lower.includes('</body>')) diagnostics.push(`${path} must be a complete HTML document`)
    if (!/<link\b[^>]*href=["']\.\/tokens\.css["'][^>]*>/iu.test(html)) diagnostics.push(`${path} must link ./tokens.css`)
    if (/(?:^|[;{])\s*--ds-[a-z0-9-]+\s*:/imu.test(html)) diagnostics.push(`${path} must not redeclare canonical --ds-* tokens`)
    const refs = [...html.matchAll(/var\(\s*(--ds-[a-z0-9-]+)/gu)].map(match => match[1])
    if (refs.length < 5) diagnostics.push(`${path} must reference at least 5 --ds-* variables`)
    const unknown = [...new Set(refs.filter(ref => !declared.has(ref)))]
    if (unknown.length > 0) diagnostics.push(`${path} references undefined tokens: ${unknown.join(', ')}`)
    diagnostics.push(...previewTokenDiagnostics(path, html))
    if (/(?:src|href)=["']https?:\/\//iu.test(html.replace(/<a\b[^>]*>/giu, ''))) diagnostics.push(`${path} contains a remote preview asset`)
    if (/\p{Extended_Pictographic}/u.test(html.replace(/<script[\s\S]*?<\/script>/giu, ''))) diagnostics.push(`${path} uses emoji pictographs as interface icons`)
  }
  return diagnostics
}

if (action === 'render-design-md' || action === 'render-tokens-css') {
  const state = record(JSON.parse(rawInput))
  const config = record(state.config)
  if (Object.keys(config).length === 0) {
    process.stderr.write('canonical visual-style config must not be empty\n')
    process.exitCode = 1
  } else {
    process.stdout.write(action === 'render-design-md' ? designMd(state) : tokensCss(config))
  }
} else if (action === 'validate-tokens-file') {
  const boundary = rawInput.indexOf('\n')
  if (boundary < 0) throw new Error('file input must include structured context')
  const context = record(JSON.parse(rawInput.slice(0, boundary)))
  const config = record(record(context.state).config)
  const diagnostics = []
  if (Object.keys(config).length === 0) diagnostics.push('canonical visual-style config must not be empty')
  if (rawInput.slice(boundary + 1) !== tokensCss(config)) diagnostics.push('design_style/tokens.css does not match canonical state; regenerate it with render-tokens-css from the current design_style.json, do not edit generated tokens independently')
  process.stdout.write(`${JSON.stringify({ valid: diagnostics.length === 0, diagnostics })}\n`)
  if (diagnostics.length > 0) process.exitCode = 1
} else if (action === 'validate-preview-file') {
  const boundary = rawInput.indexOf('\n')
  if (boundary < 0) throw new Error('file input must include structured context')
  const context = record(JSON.parse(rawInput.slice(0, boundary)))
  const state = record(context.state)
  const previewPath = String(context.preview_file ?? '')
  const artifacts = {
    'design_style/DESIGN.md': designMd(state),
    'design_style/tokens.css': tokensCss(record(state.config)),
    [previewPath]: rawInput.slice(boundary + 1),
  }
  const diagnostics = validate(state, artifacts)
  process.stdout.write(`${JSON.stringify({ valid: diagnostics.length === 0, diagnostics })}\n`)
  if (diagnostics.length > 0) process.exitCode = 1
} else {
  process.stdout.write(`${JSON.stringify({ valid: false, diagnostics: [`unknown design-style action: ${action}`] })}\n`)
  process.exitCode = 1
}
