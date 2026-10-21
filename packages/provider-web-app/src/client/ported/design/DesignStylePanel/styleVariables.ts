import type { CSSProperties } from 'react';
import type { IDesignStyleConfig } from './designStyleTypes.ts';

/**
 * Map a `IDesignStyleConfig` into the set of CSS custom properties that
 * the preview templates (DashboardMockPage etc.) consume.
 *
 * The preview reads variables, never the config object directly — this
 * keeps the templates declarative and lets future templates reuse the
 * same variable contract. All variables are scoped via `--ds-*` to avoid
 * colliding with the surrounding app's design tokens.
 *
 * Defaults are intentionally conservative: missing keys fall back to
 * neutral values so a partially-filled config still renders something
 * sensible (rather than transparent / 0px / undefined).
 */

const SHADOW_DEPTH_VALUES: Record<string, string> = {
  none: 'none',
  subtle: '0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.06)',
  medium: '0 4px 6px rgba(0, 0, 0, 0.06), 0 10px 15px rgba(0, 0, 0, 0.08)',
  deep: '0 10px 15px rgba(0, 0, 0, 0.1), 0 20px 25px rgba(0, 0, 0, 0.12)',
};

const DENSITY_GAP: Record<string, string> = {
  compact: '12px',
  comfortable: '20px',
  spacious: '32px',
};

const DENSITY_PADDING: Record<string, string> = {
  compact: '12px',
  comfortable: '20px',
  spacious: '32px',
};

const CONTENT_WIDTH_PX: Record<string, string> = {
  narrow: '768px',
  medium: '1024px',
  wide: '1280px',
  full: '100%',
};

const BORDER_RADIUS_VALUES: Record<string, string> = {
  '0px': '0px',
  '4px': '4px',
  '8px': '8px',
  '12px': '12px',
  '16px': '16px',
  full: '9999px',
};

// A font value reaching here may be a bare family name — e.g. a config saved
// by an older build of the font picker, or a bare name handed over by the AI.
// A bare Latin family has no CJK glyphs, so 中文 falls back to the browser
// default. Append a CJK + generic fallback when the stack carries no generic
// family yet. Idempotent: a full stack already ends in a generic and is left
// untouched.
const GENERIC_FAMILY_RE =
  /\b(serif|sans-serif|monospace|system-ui|ui-monospace|ui-serif|ui-sans-serif|cursive|fantasy)\b/i;

const ensureFontFallback = (stack: string, fallback: string): string =>
  GENERIC_FAMILY_RE.test(stack) ? stack : `${stack}, ${fallback}`;

const CJK_SANS_FALLBACK = '"PingFang SC", system-ui, sans-serif';
const CJK_MONO_FALLBACK = 'ui-monospace, monospace';

/**
 * Resolve a possibly-arbitrary border-radius value (presets use named
 * values like "full"; LLM may emit raw "10px"). Always returns a string
 * suitable for `border-radius`.
 */
const resolveBorderRadius = (value: string | undefined): string => {
  if (!value) return '8px';
  return BORDER_RADIUS_VALUES[value] ?? value;
};

export const styleConfigToCSSVars = (
  config: IDesignStyleConfig | null
): CSSProperties => {
  if (!config) return {};

  const c = config.colors ?? {};
  const t = config.typography ?? {};
  const k = config.components ?? {};
  const layout = config.layout;

  const radius = resolveBorderRadius(k.borderRadius);
  const shadow = SHADOW_DEPTH_VALUES[k.shadowDepth ?? 'medium'] ?? 'none';
  const density = layout?.density ?? 'comfortable';
  const contentWidth =
    CONTENT_WIDTH_PX[layout?.content_width ?? 'wide'] ?? '1280px';

  const vars: Record<string, string> = {
    // Colors — fall back to neutral defaults so missing keys don't render
    // transparent text on transparent backgrounds.
    '--ds-primary': c.primary ?? '#6366f1',
    '--ds-primary-light': c.primaryLight ?? c.primary ?? '#818cf8',
    '--ds-primary-dark': c.primaryDark ?? c.primary ?? '#4f46e5',
    '--ds-secondary': c.secondary ?? '#06b6d4',
    '--ds-accent': c.accent ?? '#f59e0b',
    '--ds-background': c.background ?? '#ffffff',
    '--ds-surface': c.surface ?? c.background ?? '#f8fafc',
    '--ds-text': c.text ?? '#0f172a',
    '--ds-text-secondary': c.textSecondary ?? '#64748b',
    '--ds-border': c.border ?? '#e2e8f0',

    // Semantic colors
    '--ds-success': config.semantic_colors?.success ?? '#22c55e',
    '--ds-warning': config.semantic_colors?.warning ?? '#f59e0b',
    '--ds-error': config.semantic_colors?.error ?? '#ef4444',
    '--ds-info': config.semantic_colors?.info ?? '#3b82f6',

    // Typography
    '--ds-heading-font': ensureFontFallback(
      t.headingFont ?? 'Inter, system-ui, -apple-system, sans-serif',
      CJK_SANS_FALLBACK
    ),
    '--ds-body-font': ensureFontFallback(
      t.bodyFont ?? 'Inter, system-ui, -apple-system, sans-serif',
      CJK_SANS_FALLBACK
    ),
    '--ds-mono-font': ensureFontFallback(
      t.monoFont ?? 'JetBrains Mono, monospace',
      CJK_MONO_FALLBACK
    ),
    '--ds-base-font-size': t.baseFontSize ?? '14px',
    '--ds-heading-weight': t.headingWeight ?? '600',
    '--ds-line-height': t.lineHeight ?? '1.5',

    // Components
    '--ds-radius': radius,
    '--ds-shadow': shadow,

    // Layout-derived
    '--ds-density-gap': DENSITY_GAP[density] ?? DENSITY_GAP.comfortable,
    '--ds-density-padding':
      DENSITY_PADDING[density] ?? DENSITY_PADDING.comfortable,
    '--ds-content-width': contentWidth,
  };

  return vars as CSSProperties;
};

export const buttonStyleClass = (style: string | undefined): string => {
  // Maps to inline style helpers used in DashboardMockPage. Returning a
  // string class lets us toggle button chrome without touching the host
  // page's Tailwind config.
  switch (style) {
    case 'outlined':
      return 'ds-btn-outlined';
    case 'ghost':
      return 'ds-btn-ghost';
    case 'soft':
      return 'ds-btn-soft';
    case 'filled':
    default:
      return 'ds-btn-filled';
  }
};

export const inputStyleClass = (style: string | undefined): string => {
  switch (style) {
    case 'underlined':
      return 'ds-input-underlined';
    case 'filled':
      return 'ds-input-filled';
    case 'bordered':
    default:
      return 'ds-input-bordered';
  }
};

export const cardStyleClass = (style: string | undefined): string => {
  switch (style) {
    case 'flat':
      return 'ds-card-flat';
    case 'bordered':
      return 'ds-card-bordered';
    case 'elevated':
    default:
      return 'ds-card-elevated';
  }
};
