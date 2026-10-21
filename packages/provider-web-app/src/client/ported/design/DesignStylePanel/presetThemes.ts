import type { IDesignStyleConfig } from './designStyleTypes.ts';

/**
 * Aesthetic presets for the design style panel.
 *
 * Each preset is a complete *visual mood* — not just a color set.
 * Applying a preset swaps colors, typography, component defaults
 * (radius / shadow / button shape) and layout density together so the
 * preview pivots its whole feel, not just its accent hue.
 *
 * Naming convention: mood + material / light / era. Brand references
 * ("拼多多橙", "抖音黑") were retired — they tied the panel's tone to
 * specific commercial brands instead of evoking an aesthetic the user
 * would actually request by name.
 *
 * `desc` is a short project-type hint surfaced in the nav so the user
 * can match preset to use-case at a glance.
 */

export interface IPalettePreset {
  id: string;
  name: string;
  desc: string;
  colors: Record<string, string>;
  semantic_colors?: Record<string, string>;
  typography?: Record<string, string>;
  components?: Record<string, string>;
  /** Optional layout density override; layout `mode` stays as-is. */
  density?: string;
}

export const PALETTE_PRESETS: IPalettePreset[] = [
  {
    id: 'vermilion-festival',
    name: '节庆朱橙',
    desc: '拼团 / 食品电商 / 直播带货',
    colors: {
      primary: '#e85a2c',
      primaryLight: '#f4845a',
      primaryDark: '#b8421e',
      secondary: '#7a3aa8',
      accent: '#f5c542',
      background: '#fffaf3',
      surface: '#fff2e3',
      text: '#1f1410',
      textSecondary: '#7a5a4a',
      border: '#f5d4b8',
    },
    typography: {
      headingFont: 'PingFang SC, Inter, system-ui, sans-serif',
      bodyFont: 'PingFang SC, Inter, system-ui, sans-serif',
      monoFont: 'JetBrains Mono, ui-monospace, monospace',
      baseFontSize: '14px',
      headingWeight: '700',
      lineHeight: '1.5',
    },
    components: {
      borderRadius: '12px',
      shadowDepth: 'medium',
      buttonStyle: 'filled',
      inputStyle: 'bordered',
      cardStyle: 'elevated',
    },
    density: 'comfortable',
  },
  {
    id: 'honey-twilight',
    name: '暮光琥珀',
    desc: '旅行 / 内容订阅 / 创意作品',
    colors: {
      primary: '#d8466a',
      primaryLight: '#e87391',
      primaryDark: '#a82c4f',
      secondary: '#e88a3a',
      accent: '#9468d8',
      background: '#fdf8f0',
      surface: '#f8edd8',
      text: '#3a1f1f',
      textSecondary: '#7a4a3a',
      border: '#e8d4b0',
    },
    typography: {
      headingFont: '"Playfair Display", "Source Han Serif SC", Songti, serif',
      bodyFont: 'Inter, "PingFang SC", system-ui, sans-serif',
      monoFont: 'JetBrains Mono, ui-monospace, monospace',
      baseFontSize: '15px',
      headingWeight: '600',
      lineHeight: '1.6',
    },
    components: {
      borderRadius: '16px',
      shadowDepth: 'subtle',
      buttonStyle: 'filled',
      inputStyle: 'underlined',
      cardStyle: 'elevated',
    },
    density: 'spacious',
  },
  {
    id: 'studio-noir',
    name: '深夜舞台',
    desc: '短视频 / 音乐 / 游戏 / 创作者',
    colors: {
      primary: '#ff4470',
      primaryLight: '#ff6e90',
      primaryDark: '#cc2e54',
      secondary: '#3acccc',
      accent: '#ffd84a',
      background: '#0a0a10',
      surface: '#15151f',
      text: '#f5f5f8',
      textSecondary: '#9898a8',
      border: '#262633',
    },
    semantic_colors: {
      success: '#4ade80',
      warning: '#fbbf24',
      error: '#fb7185',
      info: '#60a5fa',
    },
    typography: {
      headingFont: 'Inter, "PingFang SC", system-ui, sans-serif',
      bodyFont: 'Inter, "PingFang SC", system-ui, sans-serif',
      monoFont: 'JetBrains Mono, ui-monospace, monospace',
      baseFontSize: '14px',
      headingWeight: '700',
      lineHeight: '1.5',
    },
    components: {
      borderRadius: '8px',
      shadowDepth: 'deep',
      buttonStyle: 'filled',
      inputStyle: 'filled',
      cardStyle: 'elevated',
    },
    density: 'comfortable',
  },
  {
    id: 'editorial-mono',
    name: '画刊单色',
    desc: '作品集 / 出版 / 写作平台',
    colors: {
      primary: '#1a1a1a',
      primaryLight: '#3a3a3a',
      primaryDark: '#000000',
      secondary: '#6a6a6a',
      accent: '#c8472b',
      background: '#fafaf7',
      surface: '#f3f1ec',
      text: '#0a0a0a',
      textSecondary: '#6a6a6a',
      border: '#e0ddd5',
    },
    typography: {
      headingFont:
        '"Source Serif Pro", "Source Han Serif SC", Songti, Georgia, serif',
      bodyFont: 'Inter, "PingFang SC", system-ui, sans-serif',
      monoFont: 'JetBrains Mono, ui-monospace, monospace',
      baseFontSize: '15px',
      headingWeight: '600',
      lineHeight: '1.7',
    },
    components: {
      borderRadius: '4px',
      shadowDepth: 'subtle',
      buttonStyle: 'outlined',
      inputStyle: 'underlined',
      cardStyle: 'flat',
    },
    density: 'spacious',
  },
  {
    id: 'morandi-still',
    name: '莫兰迪静物',
    desc: '家居 / 文创 / 生活方式',
    colors: {
      primary: '#8a9678',
      primaryLight: '#a8b298',
      primaryDark: '#646e58',
      secondary: '#b89878',
      accent: '#9a6f68',
      background: '#fbfaf5',
      surface: '#efece2',
      text: '#322d28',
      textSecondary: '#75695e',
      border: '#dad3c4',
    },
    typography: {
      headingFont:
        '"Cormorant Garamond", "Source Han Serif SC", Songti, Georgia, serif',
      bodyFont: 'Inter, "PingFang SC", system-ui, sans-serif',
      monoFont: 'JetBrains Mono, ui-monospace, monospace',
      baseFontSize: '15px',
      headingWeight: '500',
      lineHeight: '1.7',
    },
    components: {
      borderRadius: '12px',
      shadowDepth: 'subtle',
      buttonStyle: 'soft',
      inputStyle: 'bordered',
      cardStyle: 'flat',
    },
    density: 'spacious',
  },
  {
    id: 'frosted-prism',
    name: '棱镜雾光',
    desc: 'SaaS / 数据中台 / 工具产品',
    colors: {
      primary: '#6a4ad8',
      primaryLight: '#8c75e8',
      primaryDark: '#4a32a8',
      secondary: '#3aa8c4',
      accent: '#d878c8',
      background: '#0e0d1a',
      surface: '#19182a',
      text: '#f3f1fa',
      textSecondary: '#9e9bbb',
      border: '#2a2840',
    },
    semantic_colors: {
      success: '#34d399',
      warning: '#fbbf24',
      error: '#f87171',
      info: '#60a5fa',
    },
    typography: {
      headingFont: 'Inter, "PingFang SC", system-ui, sans-serif',
      bodyFont: 'Inter, "PingFang SC", system-ui, sans-serif',
      monoFont: 'JetBrains Mono, ui-monospace, monospace',
      baseFontSize: '14px',
      headingWeight: '600',
      lineHeight: '1.55',
    },
    components: {
      borderRadius: '10px',
      shadowDepth: 'medium',
      buttonStyle: 'filled',
      inputStyle: 'filled',
      cardStyle: 'elevated',
    },
    density: 'comfortable',
  },
];

/**
 * Apply a preset bundle to the existing config.
 *
 * Replaces colors, semantic_colors, typography, components and layout
 * density together so the visual mood swaps as a unit. Preserves
 * `notes`, `preview_page`, `dark_mode`, layout `mode` / `sidebar` /
 * `content_width` — those track user content and
 * structural choices, not the aesthetic mood.
 */
export const applyPaletteToConfig = (
  current: IDesignStyleConfig,
  preset: IPalettePreset
): IDesignStyleConfig => ({
  ...current,
  theme: preset.name,
  colors: { ...preset.colors },
  semantic_colors: preset.semantic_colors
    ? { ...preset.semantic_colors }
    : current.semantic_colors,
  typography: preset.typography
    ? { ...current.typography, ...preset.typography }
    : current.typography,
  components: preset.components
    ? { ...current.components, ...preset.components }
    : current.components,
  layout: preset.density
    ? { ...current.layout, density: preset.density }
    : current.layout,
});

export const AI_PRESET_ID = '__ai_recommended__';

// Fixed subtitle for the AI-recommended palette card. The LLM `notes` field is a
// 150+ char rationale meant for the design narration, not this single-line slot —
// stuffing it here just gets truncated. Show a clean fixed line instead.
export const AI_PRESET_DESC = '为您量身定做的配色方案';

export const buildAiPreset = (
  config: IDesignStyleConfig
): IPalettePreset | null => {
  const c = config.colors;
  if (!c || !c.primary) return null;

  return {
    id: AI_PRESET_ID,
    name: config.theme || 'AI 推荐',
    desc: AI_PRESET_DESC,
    colors: { ...c },
    semantic_colors: config.semantic_colors
      ? { ...config.semantic_colors }
      : undefined,
    typography: config.typography ? { ...config.typography } : undefined,
    components: config.components ? { ...config.components } : undefined,
    density: config.layout?.density,
  };
};
