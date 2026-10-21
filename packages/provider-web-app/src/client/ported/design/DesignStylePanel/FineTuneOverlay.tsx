import React, { useMemo, useState } from 'react';
import { cn } from '../../ui/cn.ts';
import { X, ChevronDown } from 'lucide-react';
import type { IDesignStyleConfig, ILayoutConfig } from './designStyleTypes.ts';
import { useLang } from '../../host.ts';
import { Button } from '../../ui/button.tsx';
import { IconFont } from '../../ui/icon-font.tsx';

export interface IFineTuneOverlayProps {
  config: IDesignStyleConfig;
  onChange: (next: IDesignStyleConfig) => void;
  onClose: () => void;
  onSaveAndRegenerate?: () => void;
  saveAndRegenerateDisabled?: boolean;
  openSections?: IFineTuneOpenSections;
  onOpenSectionsChange?: (next: IFineTuneOpenSections) => void;
  activeColorKey?: string | null;
  onActiveColorKeyChange?: (key: string | null) => void;
}

/**
 * Live-update behavior reference (audit on the AI's preview.html):
 *
 *   ✅ Live — backed by `--ds-*` CSS vars the AI HTML actually consumes:
 *     • All 10 colors + 4 semantic colors
 *     • Typography (heading/body/mono fonts, base-font-size,
 *       heading-weight, line-height)
 *     • Border radius
 *
 *   ⚠ Save+regen — config is persisted but won't render until the AI
 *     regenerates the HTML (the AI HTML hardcodes these instead of reading
 *     a CSS var, OR the change is structural):
 *     • Layout mode / sidebar position / sidebar style (structural)
 *     • Content width / density / shadow depth (vars exist but unused)
 *     • Button / input / card style (class-based, AI doesn't emit those classes)
 *
 * Fields in the second group get a `<RegenBadge />` so users know to
 * expect a Save before the preview catches up. Removing them isn't right
 * either — they still steer future regenerations through the saved state.
 */

const COLOR_FIELD_KEYS = [
  'primary',
  'primaryLight',
  'primaryDark',
  'secondary',
  'accent',
  'background',
  'surface',
  'text',
  'textSecondary',
  'border',
] as const;

export interface IFineTuneOpenSections {
  colors: boolean;
  typography: boolean;
  layout: boolean;
  components: boolean;
}

export const DEFAULT_FINE_TUNE_OPEN_SECTIONS: IFineTuneOpenSections = {
  colors: true,
  typography: false,
  layout: false,
  components: false,
};

const HEADING_FONTS = [
  'Inter',
  'Noto Sans SC',
  'PingFang SC',
  'Poppins',
  'Playfair Display',
  'Montserrat',
  'Roboto',
];
const BODY_FONTS = [
  'Inter',
  'Noto Sans SC',
  'PingFang SC',
  'Roboto',
  'Open Sans',
  'Lato',
  'Source Sans Pro',
];
const MONO_FONTS = [
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'IBM Plex Mono',
];

// Canonical font stacks keyed by the friendly name shown in the dropdown.
// The dropdown shows the bare name (e.g. "Playfair Display") but writes the
// FULL stack into config — so a Latin display face keeps its CJK fallback and
// generic family. Without this the picker stored a bare name, dropping the
// Chinese fallback and rendering 中文 as tofu / browser-default serif.
const FONT_STACKS: Record<string, string> = {
  Inter: 'Inter, "PingFang SC", system-ui, sans-serif',
  Poppins: 'Poppins, "PingFang SC", system-ui, sans-serif',
  Montserrat: 'Montserrat, "PingFang SC", system-ui, sans-serif',
  Roboto: 'Roboto, "PingFang SC", system-ui, sans-serif',
  'Open Sans': '"Open Sans", "PingFang SC", system-ui, sans-serif',
  Lato: 'Lato, "PingFang SC", system-ui, sans-serif',
  'Source Sans Pro': '"Source Sans Pro", "PingFang SC", system-ui, sans-serif',
  'Noto Sans SC': '"Noto Sans SC", "PingFang SC", system-ui, sans-serif',
  'PingFang SC': '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  'Playfair Display':
    '"Playfair Display", "Source Han Serif SC", Songti, serif',
  'JetBrains Mono': '"JetBrains Mono", ui-monospace, monospace',
  'Fira Code': '"Fira Code", ui-monospace, monospace',
  'Source Code Pro': '"Source Code Pro", ui-monospace, monospace',
  'IBM Plex Mono': '"IBM Plex Mono", ui-monospace, monospace',
};

// First family of a font stack, stripped of quotes/whitespace — used to map a
// stored stack back onto its dropdown label (presets store stacks in varied
// formats, so exact-string matching against the bare option list never hits).
const primaryFamily = (stack: string): string =>
  (stack.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');

const matchFontLabel = (
  value: string,
  options: string[]
): string | undefined => {
  const fam = primaryFamily(value).toLowerCase();
  return options.find(o => o.toLowerCase() === fam);
};

interface ISectionHeaderProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  liveBadge?: 'live' | 'regen';
  liveLabel: string;
}

const SectionHeader: React.FC<ISectionHeaderProps> = ({
  title,
  open,
  onToggle,
  liveBadge,
  liveLabel,
}) => (
  <button
    type='button'
    onClick={onToggle}
    className='w-full flex items-center justify-between py-2.5 px-3 text-sm font-medium text-[#10082B] hover:bg-gray-50 transition-colors'
  >
    <span className='flex items-center gap-2'>
      {title}
      {liveBadge === 'live' && (
        <span className='text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-normal'>
          {liveLabel}
        </span>
      )}
    </span>
    <ChevronDown
      className={cn(
        'w-4 h-4 text-gray-500 transition-transform',
        open ? 'rotate-180' : 'rotate-0'
      )}
    />
  </button>
);

/** Inline tag indicating the control's effect requires backend regeneration
 *  (Save → re-emit). Used on adjusters that the AI HTML doesn't read live
 *  via CSS vars. Keeps the control functional (still steers future renders)
 *  but sets expectations about the preview lag. */
const RegenBadge: React.FC<{ label: string }> = ({ label }) => (
  <span className='ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-normal align-middle'>
    {label}
  </span>
);

interface IOptionCardsProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  size?: 'normal' | 'small';
}

const OptionCards = <T extends string>({
  options,
  value,
  onChange,
  size = 'normal',
}: IOptionCardsProps<T>) => (
  <div className='grid grid-cols-2 gap-2'>
    {options.map(opt => (
      <button
        key={opt.value}
        type='button'
        onClick={() => onChange(opt.value)}
        className={cn(
          'rounded-md border text-sm transition-colors',
          size === 'small' ? 'px-2 py-1.5' : 'px-3 py-2',
          opt.value === value
            ? 'border-[#663AE8] bg-[#F3F0FF] text-[#663AE8] font-medium'
            : 'border-[#ECEBEE] bg-white text-[rgba(16,8,43,0.8)] hover:border-[#663AE8]'
        )}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

interface IColorDotsRowProps {
  colors: Record<string, string>;
  fields: Array<{ key: string; label: string }>;
  activeKey: string | null;
  onSelect: (key: string) => void;
}

/** Compact horizontal row of color swatches (circles, not rectangles).
 *  Click a dot to make it the "active" color — the editor below the row
 *  exposes the label, native picker, and hex input for the active one
 *  only. Tooltip on each dot shows label + hex without the editor open. */
const ColorDotsRow: React.FC<IColorDotsRowProps> = ({
  colors,
  fields,
  activeKey,
  onSelect,
}) => (
  <div className='flex flex-wrap gap-2'>
    {fields.map(f => {
      const value = colors[f.key] || '';
      const isActive = activeKey === f.key;
      return (
        <button
          key={f.key}
          type='button'
          onClick={() => onSelect(f.key)}
          title={`${f.label}${value ? ` · ${value}` : ''}`}
          className={cn(
            'relative w-7 h-7 rounded-full border-2 transition-all shrink-0',
            isActive
              ? 'border-[#663AE8] ring-2 ring-[#663AE8]/20 scale-110'
              : 'border-white shadow-sm hover:scale-110 hover:border-gray-200',
            !value && 'border-dashed border-gray-300 bg-gray-100'
          )}
          style={value ? { backgroundColor: value } : undefined}
          aria-label={f.label}
        />
      );
    })}
  </div>
);

interface IActiveColorEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  colorPickerLabel: string;
}

const ActiveColorEditor: React.FC<IActiveColorEditorProps> = ({
  label,
  value,
  onChange,
  colorPickerLabel,
}) => (
  <div className='flex items-center gap-2 p-2 bg-gray-50 rounded-md border border-[#ECEBEE]'>
    <span className='text-xs text-gray-600 w-16 shrink-0'>{label}</span>
    <input
      type='color'
      value={value || '#000000'}
      onChange={e => onChange(e.target.value)}
      className='w-6 h-6 rounded-full cursor-pointer border-0 p-0 bg-transparent'
      style={{ appearance: 'none' }}
      aria-label={`${label} ${colorPickerLabel}`}
    />
    <input
      type='text'
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder='#000000'
      className='flex-1 min-w-0 text-xs px-2 py-1 border border-[#ECEBEE] rounded font-mono bg-white'
    />
  </div>
);

export const FineTuneOverlay: React.FC<IFineTuneOverlayProps> = ({
  config,
  onChange,
  onClose,
  onSaveAndRegenerate,
  saveAndRegenerateDisabled = false,
  openSections,
  onOpenSectionsChange,
  activeColorKey,
  onActiveColorKeyChange,
}) => {
  const t = useLang();

  const colorFields = useMemo(
    () =>
      COLOR_FIELD_KEYS.map(key => ({
        key,
        label:
          {
            primary: t.design_style_color_primary,
            primaryLight: t.design_style_color_primary_light,
            primaryDark: t.design_style_color_primary_dark,
            secondary: t.design_style_color_secondary,
            accent: t.design_style_color_accent,
            background: t.design_style_color_background,
            surface: t.design_style_color_surface,
            text: t.design_style_color_text,
            textSecondary: t.design_style_color_text_secondary,
            border: t.design_style_color_border,
          }[key] ?? key,
      })),
    [t]
  );

  // Persist which sections are open across re-renders within a single mount.
  // Colors opens by default — it's the most common live tweak.
  const [internalOpenSections, setInternalOpenSections] = useState(
    DEFAULT_FINE_TUNE_OPEN_SECTIONS
  );
  const effectiveOpenSections = openSections ?? internalOpenSections;
  const setEffectiveOpenSections = (
    next:
      | IFineTuneOpenSections
      | ((prev: IFineTuneOpenSections) => IFineTuneOpenSections)
  ) => {
    const resolved =
      typeof next === 'function' ? next(effectiveOpenSections) : next;
    if (onOpenSectionsChange) {
      onOpenSectionsChange(resolved);
      return;
    }
    setInternalOpenSections(resolved);
  };

  // Active color in the dots row — selecting a dot reveals an inline
  // editor below the row for that color only.
  const [internalActiveColor, setInternalActiveColor] = useState<string | null>(
    'primary'
  );
  const effectiveActiveColor =
    activeColorKey !== undefined ? activeColorKey : internalActiveColor;
  const setEffectiveActiveColor = (key: string | null) => {
    if (onActiveColorKeyChange) {
      onActiveColorKeyChange(key);
      return;
    }
    setInternalActiveColor(key);
  };

  const toggle = (key: keyof IFineTuneOpenSections) =>
    setEffectiveOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const updateLayout = (patch: Partial<ILayoutConfig>) =>
    onChange({
      ...config,
      layout: { ...config.layout, ...patch },
    });

  const updateColor = (key: string, value: string) =>
    onChange({
      ...config,
      colors: { ...config.colors, [key]: value },
    });

  const updateTypography = (key: string, value: string) =>
    onChange({
      ...config,
      typography: { ...config.typography, [key]: value },
    });

  const updateComponents = (key: string, value: string) =>
    onChange({
      ...config,
      components: { ...config.components, [key]: value },
    });

  const layout = config.layout;
  const activeField = effectiveActiveColor
    ? colorFields.find(f => f.key === effectiveActiveColor)
    : null;

  return (
    <div className='absolute top-0 right-0 bottom-0 w-[320px] bg-white border-l border-[#ECEBEE] shadow-lg z-30 flex flex-col'>
      {/* Header */}
      <div className='flex items-center justify-between px-4 py-3 border-b border-[#ECEBEE]'>
        <h4 className='text-sm font-semibold text-[#10082B]'>
          {t.design_style_fine_tune_title}
        </h4>
        <button
          type='button'
          onClick={onClose}
          className='p-1 rounded hover:bg-gray-100 text-gray-500'
          aria-label={t.button_close}
        >
          <X className='w-4 h-4' />
        </button>
      </div>

      {/* Body */}
      <div className='flex-1 overflow-y-auto'>
        {/* === Colors (live) === */}
        <div className='border-b border-[#ECEBEE]'>
          <SectionHeader
            title={t.design_style_section_colors}
            open={effectiveOpenSections.colors}
            onToggle={() => toggle('colors')}
            liveBadge='live'
            liveLabel={t.design_style_badge_live}
          />
          {effectiveOpenSections.colors && (
            <div className='px-3 pb-3 space-y-3'>
              <ColorDotsRow
                colors={config.colors}
                fields={colorFields}
                activeKey={effectiveActiveColor}
                onSelect={setEffectiveActiveColor}
              />
              {activeField && (
                <ActiveColorEditor
                  label={activeField.label}
                  value={config.colors[activeField.key] ?? ''}
                  onChange={v => updateColor(activeField.key, v)}
                  colorPickerLabel={t.design_style_color_picker}
                />
              )}
            </div>
          )}
        </div>

        {/* === Typography (live, except font picks need regen if AI HTML <link>s the wrong family) === */}
        <div className='border-b border-[#ECEBEE]'>
          <SectionHeader
            title={t.design_style_section_typography}
            open={effectiveOpenSections.typography}
            onToggle={() => toggle('typography')}
            liveBadge='live'
            liveLabel={t.design_style_badge_live}
          />
          {effectiveOpenSections.typography && (
            <div className='px-3 pb-3 space-y-3'>
              <FontSelect
                label={t.design_style_heading_font}
                value={config.typography.headingFont ?? ''}
                onChange={v => updateTypography('headingFont', v)}
                options={HEADING_FONTS}
              />
              <FontSelect
                label={t.design_style_body_font}
                value={config.typography.bodyFont ?? ''}
                onChange={v => updateTypography('bodyFont', v)}
                options={BODY_FONTS}
              />
              <FontSelect
                label={t.design_style_mono_font}
                value={config.typography.monoFont ?? ''}
                onChange={v => updateTypography('monoFont', v)}
                options={MONO_FONTS}
              />
              <div>
                <label className='block text-xs text-gray-500 mb-1.5'>
                  {t.design_style_base_font_size}
                </label>
                <OptionCards
                  size='small'
                  value={config.typography.baseFontSize ?? '14px'}
                  onChange={v => updateTypography('baseFontSize', v)}
                  options={[
                    { value: '14px', label: '14px' },
                    { value: '15px', label: '15px' },
                    { value: '16px', label: '16px' },
                    { value: '18px', label: '18px' },
                  ]}
                />
              </div>
              <div>
                <label className='block text-xs text-gray-500 mb-1.5'>
                  {t.design_style_heading_weight}
                </label>
                <OptionCards
                  size='small'
                  value={config.typography.headingWeight ?? '600'}
                  onChange={v => updateTypography('headingWeight', v)}
                  options={[
                    { value: '500', label: '500' },
                    { value: '600', label: '600' },
                    { value: '700', label: '700' },
                    { value: '800', label: '800' },
                  ]}
                />
              </div>
              <div>
                <label className='block text-xs text-gray-500 mb-1.5'>
                  {t.design_style_line_height}
                </label>
                <OptionCards
                  size='small'
                  value={config.typography.lineHeight ?? '1.5'}
                  onChange={v => updateTypography('lineHeight', v)}
                  options={[
                    { value: '1.4', label: '1.4' },
                    { value: '1.5', label: '1.5' },
                    { value: '1.6', label: '1.6' },
                    { value: '1.8', label: '1.8' },
                  ]}
                />
              </div>
            </div>
          )}
        </div>

        {/* === Layout (structural — needs regen) === */}
        <div className='border-b border-[#ECEBEE]'>
          <SectionHeader
            title={t.design_style_section_layout}
            open={effectiveOpenSections.layout}
            onToggle={() => toggle('layout')}
            liveLabel={t.design_style_badge_live}
          />
          {effectiveOpenSections.layout && (
            <div className='px-3 pb-3 space-y-3'>
              <div>
                <label className='block text-xs text-gray-500 mb-1.5'>
                  {t.design_style_layout_mode}
                  <RegenBadge label={t.design_style_badge_needs_regenerate} />
                </label>
                <OptionCards
                  value={layout.mode}
                  onChange={v => updateLayout({ mode: v })}
                  options={[
                    { value: 'sidebar', label: t.design_style_layout_sidebar },
                    { value: 'topbar', label: t.design_style_layout_topbar },
                    {
                      value: 'bottom-nav',
                      label: t.design_style_layout_bottom_nav,
                    },
                    {
                      value: 'dashboard',
                      label: t.design_style_layout_dashboard,
                    },
                    { value: 'minimal', label: t.design_style_layout_minimal },
                  ]}
                />
              </div>

              {layout.mode === 'sidebar' && (
                <>
                  <div>
                    <label className='block text-xs text-gray-500 mb-1.5'>
                      {t.design_style_sidebar_position}
                      <RegenBadge
                        label={t.design_style_badge_needs_regenerate}
                      />
                    </label>
                    <OptionCards
                      size='small'
                      value={layout.sidebar?.position ?? 'left'}
                      onChange={v =>
                        updateLayout({
                          sidebar: {
                            position: v,
                            style: layout.sidebar?.style ?? 'fixed',
                          },
                        })
                      }
                      options={[
                        { value: 'left', label: t.design_style_option_left },
                        { value: 'right', label: t.design_style_option_right },
                      ]}
                    />
                  </div>
                  <div>
                    <label className='block text-xs text-gray-500 mb-1.5'>
                      {t.design_style_sidebar_style}
                      <RegenBadge
                        label={t.design_style_badge_needs_regenerate}
                      />
                    </label>
                    <OptionCards
                      size='small'
                      value={layout.sidebar?.style ?? 'fixed'}
                      onChange={v =>
                        updateLayout({
                          sidebar: {
                            position: layout.sidebar?.position ?? 'left',
                            style: v,
                          },
                        })
                      }
                      options={[
                        { value: 'fixed', label: t.design_style_option_fixed },
                        {
                          value: 'collapsible',
                          label: t.design_style_option_collapsible,
                        },
                      ]}
                    />
                  </div>
                </>
              )}

              <div>
                <label className='block text-xs text-gray-500 mb-1.5'>
                  {t.design_style_content_width}
                  <RegenBadge label={t.design_style_badge_needs_regenerate} />
                </label>
                <OptionCards
                  size='small'
                  value={layout.content_width}
                  onChange={v => updateLayout({ content_width: v })}
                  options={[
                    { value: 'narrow', label: t.design_style_option_narrow },
                    { value: 'medium', label: t.design_style_option_medium },
                    { value: 'wide', label: t.design_style_option_wide },
                    { value: 'full', label: t.design_style_option_full },
                  ]}
                />
              </div>

              <div>
                <label className='block text-xs text-gray-500 mb-1.5'>
                  {t.design_style_density}
                  <RegenBadge label={t.design_style_badge_needs_regenerate} />
                </label>
                <OptionCards
                  size='small'
                  value={layout.density}
                  onChange={v => updateLayout({ density: v })}
                  options={[
                    { value: 'compact', label: t.design_style_option_compact },
                    {
                      value: 'comfortable',
                      label: t.design_style_option_comfortable,
                    },
                    {
                      value: 'spacious',
                      label: t.design_style_option_spacious,
                    },
                  ]}
                />
              </div>
            </div>
          )}
        </div>

        {/* === Components (border-radius is live; rest needs regen) === */}
        <div>
          <SectionHeader
            title={t.design_style_section_components}
            open={effectiveOpenSections.components}
            onToggle={() => toggle('components')}
            liveLabel={t.design_style_badge_live}
          />
          {effectiveOpenSections.components && (
            <div className='px-3 pb-3 space-y-3'>
              <div>
                <label className='block text-xs text-gray-500 mb-1.5'>
                  {t.design_style_border_radius}
                  <span className='ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-normal align-middle'>
                    {t.design_style_badge_live}
                  </span>
                </label>
                <OptionCards
                  size='small'
                  value={config.components.borderRadius ?? '8px'}
                  onChange={v => updateComponents('borderRadius', v)}
                  options={[
                    { value: '0px', label: '0' },
                    { value: '4px', label: '4' },
                    { value: '8px', label: '8' },
                    { value: '12px', label: '12' },
                    { value: '16px', label: '16' },
                    { value: 'full', label: t.design_style_option_round_full },
                  ]}
                />
              </div>
              <div>
                <label className='block text-xs text-gray-500 mb-1.5'>
                  {t.design_style_shadow_depth}
                  <RegenBadge label={t.design_style_badge_needs_regenerate} />
                </label>
                <OptionCards
                  size='small'
                  value={config.components.shadowDepth ?? 'medium'}
                  onChange={v => updateComponents('shadowDepth', v)}
                  options={[
                    { value: 'none', label: t.design_style_option_none },
                    { value: 'subtle', label: t.design_style_option_subtle },
                    { value: 'medium', label: t.design_style_option_medium },
                    { value: 'deep', label: t.design_style_option_deep },
                  ]}
                />
              </div>
              <div>
                <label className='block text-xs text-gray-500 mb-1.5'>
                  {t.design_style_button_style}
                  <RegenBadge label={t.design_style_badge_needs_regenerate} />
                </label>
                <OptionCards
                  size='small'
                  value={config.components.buttonStyle ?? 'filled'}
                  onChange={v => updateComponents('buttonStyle', v)}
                  options={[
                    { value: 'filled', label: t.design_style_option_filled },
                    {
                      value: 'outlined',
                      label: t.design_style_option_outlined,
                    },
                    { value: 'ghost', label: t.design_style_option_ghost },
                    { value: 'soft', label: t.design_style_option_soft },
                  ]}
                />
              </div>
              <div>
                <label className='block text-xs text-gray-500 mb-1.5'>
                  {t.design_style_input_style}
                  <RegenBadge label={t.design_style_badge_needs_regenerate} />
                </label>
                <OptionCards
                  size='small'
                  value={config.components.inputStyle ?? 'bordered'}
                  onChange={v => updateComponents('inputStyle', v)}
                  options={[
                    {
                      value: 'bordered',
                      label: t.design_style_option_bordered,
                    },
                    {
                      value: 'underlined',
                      label: t.design_style_option_underlined,
                    },
                    { value: 'filled', label: t.design_style_option_filled },
                  ]}
                />
              </div>
              <div>
                <label className='block text-xs text-gray-500 mb-1.5'>
                  {t.design_style_card_style}
                  <RegenBadge label={t.design_style_badge_needs_regenerate} />
                </label>
                <OptionCards
                  size='small'
                  value={config.components.cardStyle ?? 'elevated'}
                  onChange={v => updateComponents('cardStyle', v)}
                  options={[
                    { value: 'flat', label: t.design_style_option_flat },
                    {
                      value: 'bordered',
                      label: t.design_style_option_bordered,
                    },
                    {
                      value: 'elevated',
                      label: t.design_style_option_elevated,
                    },
                  ]}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className='shrink-0 border-none bg-white p-3'>
        <Button
          variant='tertiary'
          onClick={onSaveAndRegenerate}
          disabled={!onSaveAndRegenerate || saveAndRegenerateDisabled}
          className={cn(
            'w-full rounded-md px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2',
            !onSaveAndRegenerate || saveAndRegenerateDisabled
              ? 'cursor-not-allowed bg-gray-100 text-gray-400'
              : ''
          )}
        >
          <IconFont type='icon-line-operation-refresh' />{' '}
          {t.design_style_save_config_and_regenerate}
        </Button>
      </div>
    </div>
  );
};

interface IFontSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}

const FontSelect: React.FC<IFontSelectProps> = ({
  label,
  value,
  onChange,
  options,
}) => {
  const selectedLabel = matchFontLabel(value, options);
  return (
    <div>
      <label className='block text-xs text-gray-500 mb-1.5'>{label}</label>
      <select
        // Show the friendly label even when config stores a full stack.
        value={selectedLabel ?? value}
        // Write the canonical full stack (with CJK + generic fallback) so
        // picking a font never drops the Chinese fallback.
        onChange={e => onChange(FONT_STACKS[e.target.value] ?? e.target.value)}
        className='w-full px-2 py-1.5 text-sm border border-[#ECEBEE] rounded bg-white'
      >
        {!selectedLabel && value && (
          <option value={value}>{primaryFamily(value)}</option>
        )}
        {options.map(opt => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
};
