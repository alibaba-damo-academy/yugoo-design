/**
 * Client CSS-variable projection for design_style panel previews. Ported from the
 * sdk-pilot `design_style/runtime_style.py`: the canonical config is projected
 * into `--ds-*` variables, rendered as the generated `tokens.css` stylesheet
 * and injected into preview HTML for presentation only. Bundle scripts own
 * canonical tokens.css generation and validation.
 */

const SHADOW_DEPTH_VALUES: Record<string, string> = {
  none: 'none',
  subtle: '0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.06)',
  medium: '0 4px 6px rgba(0, 0, 0, 0.06), 0 10px 15px rgba(0, 0, 0, 0.08)',
  deep: '0 10px 15px rgba(0, 0, 0, 0.1), 0 20px 25px rgba(0, 0, 0, 0.12)',
}

const DENSITY_GAP: Record<string, string> = { compact: '12px', comfortable: '20px', spacious: '32px' }
const DENSITY_PADDING: Record<string, string> = { compact: '12px', comfortable: '20px', spacious: '32px' }
const CONTENT_WIDTH_PX: Record<string, string> = { narrow: '768px', medium: '1024px', wide: '1280px', full: '100%' }

const DEFAULT_MOTION: Record<string, string> = {
  duration_fast: '150ms',
  duration_normal: '300ms',
  duration_slow: '500ms',
  ease_standard: 'cubic-bezier(0.16, 1, 0.3, 1)',
  ease_in: 'cubic-bezier(0.7, 0, 0.84, 0)',
  ease_out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  ease_spring: 'cubic-bezier(0.5, 1.5, 0.5, 1)',
}
const DEFAULT_SPACING: Record<string, unknown> = {
  base: '4px',
  scale: ['4px', '8px', '12px', '16px', '24px', '32px', '48px', '64px', '96px', '128px'],
}
const DEFAULT_ELEVATION: Record<string, number> = {
  dropdown: 10,
  sticky_nav: 20,
  drawer: 30,
  modal_backdrop: 40,
  modal: 50,
  toast: 60,
  tooltip: 70,
}
const DEFAULT_BREAKPOINTS: Record<string, string> = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  xxl: '1536px',
}

const BORDER_RADIUS_VALUES: Record<string, string> = {
  '0px': '0px',
  '4px': '4px',
  '8px': '8px',
  '12px': '12px',
  '16px': '16px',
  full: '9999px',
}

const GENERIC_FAMILY_RE = /\b(serif|sans-serif|monospace|system-ui|ui-monospace|ui-serif|ui-sans-serif|cursive|fantasy)\b/i
const CJK_SANS_FALLBACK = '"PingFang SC", system-ui, sans-serif'
const CJK_MONO_FALLBACK = 'ui-monospace, monospace'

function ensureFontFallback(stack: unknown, fallback: string): string {
  const value = String(stack ?? '').trim()
  if (value === '') return fallback
  return GENERIC_FAMILY_RE.test(value) ? value : `${value}, ${fallback}`
}

/** Drop characters that could escape the generated style tag. */
function sanitizeCssValue(value: unknown): string {
  return String(value).replaceAll('<', '').replaceAll('>', '').replaceAll('{', '').replaceAll('}', '')
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Convert a JSON token key such as `primaryLight` to kebab-case. */
function tokenName(value: unknown): string {
  const text = String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
  return text.replace(/^-+|-+$/g, '').toLowerCase()
}

/**
 * Project a design_style config into the FE-compatible `--ds-*` variable map.
 * @param config - the canonical design_style config (any shape tolerated).
 * @returns the ordered variable map; empty for a non-object config.
 */
export function styleConfigToCssVars(config: unknown): Record<string, string> {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return {}
  const cfg = config as Record<string, unknown>

  const colors = record(cfg.colors)
  const typography = record(cfg.typography)
  const components = record(cfg.components)
  const iconography = record(cfg.iconography)
  const semantic = record(cfg.semantic_colors)
  const layout = record(cfg.layout)
  const motion = { ...DEFAULT_MOTION, ...record(cfg.motion) }
  const spacing = { ...DEFAULT_SPACING, ...record(cfg.spacing) }
  const elevation = { ...DEFAULT_ELEVATION, ...record(cfg.elevation) }
  const breakpoints = { ...DEFAULT_BREAKPOINTS, ...record(cfg.breakpoints) }

  const radiusKey = String(components.borderRadius ?? '8px')
  const radius = BORDER_RADIUS_VALUES[radiusKey] ?? radiusKey
  const shadow = SHADOW_DEPTH_VALUES[String(components.shadowDepth ?? 'medium')] ?? 'none'
  const density = String(layout.density ?? 'comfortable')
  const contentWidth = CONTENT_WIDTH_PX[String(layout.content_width ?? 'wide')] ?? '1280px'

  const vars: Record<string, unknown> = {
    '--ds-primary': colors.primary ?? '#0C66E4',
    '--ds-primary-light': colors.primaryLight ?? colors.primary ?? '#E9F2FF',
    '--ds-primary-dark': colors.primaryDark ?? colors.primary ?? '#0055CC',
    '--ds-secondary': colors.secondary ?? '#44546F',
    '--ds-accent': colors.accent ?? '#0C66E4',
    '--ds-background': colors.background ?? '#F7F8FA',
    '--ds-surface': colors.surface ?? colors.background ?? '#FFFFFF',
    '--ds-text': colors.text ?? '#172B4D',
    '--ds-text-secondary': colors.textSecondary ?? '#5E6C84',
    '--ds-border': colors.border ?? '#DFE1E6',
    '--ds-success': semantic.success ?? '#216E4E',
    '--ds-warning': semantic.warning ?? '#A54800',
    '--ds-error': semantic.error ?? '#AE2E24',
    '--ds-info': semantic.info ?? '#0C66E4',
    '--ds-heading-font': ensureFontFallback(typography.headingFont ?? 'Inter, system-ui, -apple-system, sans-serif', CJK_SANS_FALLBACK),
    '--ds-body-font': ensureFontFallback(typography.bodyFont ?? 'Inter, system-ui, -apple-system, sans-serif', CJK_SANS_FALLBACK),
    '--ds-mono-font': ensureFontFallback(typography.monoFont ?? 'JetBrains Mono, monospace', CJK_MONO_FALLBACK),
    '--ds-base-font-size': typography.baseFontSize ?? '14px',
    '--ds-heading-weight': typography.headingWeight ?? '600',
    '--ds-line-height': typography.lineHeight ?? '1.5',
    '--ds-radius': radius,
    '--ds-shadow': shadow,
    '--ds-density-gap': DENSITY_GAP[density] ?? DENSITY_GAP.comfortable,
    '--ds-density-padding': DENSITY_PADDING[density] ?? DENSITY_PADDING.comfortable,
    '--ds-content-width': contentWidth,
    '--ds-font-size-xs': typography.fontSizeXs ?? '12px',
    '--ds-font-size-sm': typography.fontSizeSm ?? '13px',
    '--ds-font-size-md': typography.fontSizeMd ?? typography.baseFontSize ?? '14px',
    '--ds-font-size-lg': typography.fontSizeLg ?? '16px',
    '--ds-font-size-xl': typography.fontSizeXl ?? '20px',
    '--ds-font-size-2xl': typography.fontSize2xl ?? '28px',
    '--ds-line-height-tight': typography.lineHeightTight ?? '1.25',
    '--ds-line-height-normal': typography.lineHeight ?? '1.5',
    '--ds-line-height-relaxed': typography.lineHeightRelaxed ?? '1.7',
    '--ds-radius-sm': components.radiusSm ?? '4px',
    '--ds-radius-md': components.radiusMd ?? radius,
    '--ds-radius-lg': components.radiusLg ?? '12px',
    '--ds-radius-full': components.radiusFull ?? '9999px',
    '--ds-icon-size-sm': iconography.size_sm ?? '16px',
    '--ds-icon-size-md': iconography.size_md ?? '20px',
    '--ds-icon-size-lg': iconography.size_lg ?? '24px',
    '--ds-icon-stroke-width': iconography.stroke_width ?? '1.75',
  }
  // Preserve every schema-backed extension token instead of requiring code
  // changes whenever a new color role or scale entry is added to the JSON.
  for (const [name, value] of Object.entries(colors)) vars[`--ds-${tokenName(name)}`] = value
  for (const [name, value] of Object.entries(semantic)) vars[`--ds-${tokenName(name)}`] = value
  for (const [name, value] of Object.entries(motion)) vars[`--ds-${tokenName(name)}`] = value
  for (const [name, value] of Object.entries(elevation)) vars[`--ds-z-${tokenName(name)}`] = value
  for (const [name, value] of Object.entries(breakpoints)) vars[`--ds-breakpoint-${tokenName(name)}`] = value
  if (spacing.base !== undefined) vars['--ds-space-base'] = spacing.base
  const scale = spacing.scale
  if (Array.isArray(scale)) {
    scale.forEach((value, index) => { vars[`--ds-space-${index + 1}`] = value })
  }
  return Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, sanitizeCssValue(value)]))
}

/**
 * Token names emitted for every valid design_style configuration.
 * Atomic-candidate workers can safely use this set before the host has
 * projected the candidate-specific tokens.css file.
 */
export const DESIGN_STYLE_ALWAYS_EMITTED_TOKENS: readonly string[] = Object.freeze(
  Object.keys(styleConfigToCssVars({})),
)

/**
 * Render the portable stylesheet projected from canonical design state.
 * @param config - the canonical design_style config.
 * @param sourceLabel - the provenance label embedded in the banner comment.
 * @returns the complete tokens.css text.
 */
export function renderTokensCss(config: unknown, sourceLabel = 'design_style.json'): string {
  const vars = styleConfigToCssVars(config)
  const declarations = Object.entries(vars).map(([key, value]) => `  ${key}: ${value};`).join('\n')
  return `/* Generated from ${sourceLabel}. Do not edit this projection. */\n:root {\n${declarations}\n}\n`
}

/**
 * Inject config-derived CSS variables into preview HTML (runtime override).
 * @param html - the preview HTML template.
 * @param config - the current design_style config.
 * @returns the HTML with the `<style id="ds-runtime-vars">` tag refreshed.
 */
export function injectRuntimeCssVars(html: string, config: unknown): string {
  const vars = styleConfigToCssVars(config)
  if (html === '' || Object.keys(vars).length === 0) return html
  const inline = Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(';')
  const styleTag = `<style id="ds-runtime-vars">:root{${inline}}</style>`
  const cleaned = html.replace(/<style\s+id=["']ds-runtime-vars["'][^>]*>.*?<\/style>/gis, '')
  if (cleaned.includes('</head>')) return cleaned.replace('</head>', `${styleTag}</head>`)
  return `${styleTag}${cleaned}`
}

/**
 * Compact `--ds-*` summary line for the design_state projection.
 * @param config - the current design_style config.
 * @returns `--ds-primary=…; --ds-background=…` style summary.
 */
export function cssVarsSummary(config: unknown): string {
  const vars = styleConfigToCssVars(config)
  const keys = [
    '--ds-primary', '--ds-background', '--ds-surface', '--ds-text', '--ds-accent',
    '--ds-heading-font', '--ds-body-font', '--ds-radius', '--ds-density-gap',
  ]
  return keys.filter((key) => key in vars).map((key) => `${key}=${vars[key]}`).join('; ')
}
