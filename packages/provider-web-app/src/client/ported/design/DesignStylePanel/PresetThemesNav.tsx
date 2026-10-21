import React from 'react';
import { cn } from '../../ui/cn.ts';
import { PALETTE_PRESETS, type IPalettePreset } from './presetThemes.ts';
import { useLang } from '../../host.ts';
import { Sparkles } from 'lucide-react';

export interface IPresetThemesNavProps {
  activeThemeName: string | null | undefined;
  aiPreset?: IPalettePreset;
  aiPaletteActive?: boolean;
  onApply: (preset: IPalettePreset) => void;
  disabled?: boolean;
}

const SwatchBar: React.FC<{ id: string; colors: Record<string, string> }> = ({
  id,
  colors: c,
}) => {
  const swatches = [
    c.primary,
    c.primaryLight,
    c.primaryDark,
    c.secondary,
    c.accent,
    c.surface,
  ];
  return (
    <div className='flex h-3.5 w-full max-w-[150px] gap-0.5 overflow-hidden rounded-lg'>
      {swatches.map(
        (color, index) =>
          color && (
            <span
              key={`${id}-${color}-${index}`}
              className={index === 0 ? 'w-[60px] shrink-0' : 'w-4 shrink-0'}
              style={{ background: color }}
            />
          )
      )}
    </div>
  );
};

export const PresetThemesNav: React.FC<IPresetThemesNavProps> = ({
  activeThemeName,
  aiPreset,
  aiPaletteActive,
  onApply,
  disabled = false,
}) => {
  const isAiActive = Boolean(aiPreset && aiPaletteActive);
  const t = useLang();

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3'>
      {/* AI recommended palette */}
      {aiPreset && (
        <>
          <button
            type='button'
            data-testid='dsh-design-style-ai-preset'
            onClick={() => onApply(aiPreset)}
            disabled={disabled}
            className={cn(
              'h-[86px] w-full rounded-lg bg-white p-3 text-left',
              'border transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-brand-bg-default,#7C5AF6)] focus-visible:ring-offset-2',
              disabled && 'cursor-not-allowed opacity-70',
              isAiActive
                ? 'border-[var(--ds-brand-bg-default,#7C5AF6)]'
                : cn(
                    'border-transparent',
                    !disabled &&
                      'hover:border-[var(--ds-border-default,#E7E7E7)]'
                  )
            )}
          >
            <div className='mb-2'>
              <div className='flex items-center gap-1.5'>
                <Sparkles className='h-3.5 w-3.5 shrink-0 text-[var(--ds-brand-bg-default,#7C5AF6)]' />
                <span
                  className={cn(
                    'truncate text-sm font-medium leading-[22px]',
                    'text-[var(--ds-text-primary,#272727)]'
                  )}
                >
                  {t.design_ecommended_color}
                </span>
              </div>
              <div className='truncate text-xs leading-[18px] text-[var(--ds-text-tertiary,#6D6D6D)]'>
                {aiPreset.desc}
              </div>
            </div>
            <SwatchBar id={aiPreset.id} colors={aiPreset.colors} />
          </button>
        </>
      )}

      {/* Standard presets */}
      {PALETTE_PRESETS.map(preset => {
        const active = !isAiActive && preset.name === activeThemeName;
        return (
          <button
            key={preset.id}
            type='button'
            data-testid={`dsh-design-style-preset-${preset.id}`}
            onClick={() => onApply(preset)}
            disabled={disabled}
            className={cn(
              'h-[86px] w-full rounded-lg bg-white p-3 text-left',
              'border transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-brand-bg-default,#7C5AF6)] focus-visible:ring-offset-2',
              disabled && 'cursor-not-allowed opacity-70',
              active
                ? 'border-[var(--ds-brand-bg-default,#7C5AF6)]'
                : cn(
                    'border-transparent',
                    !disabled &&
                      'hover:border-[var(--ds-border-default,#E7E7E7)]'
                  )
            )}
          >
            <div className='mb-2'>
              <div
                className={cn(
                  'truncate text-sm font-medium leading-[22px]',
                  'text-[var(--ds-text-primary,#272727)]'
                )}
              >
                {preset.name}
              </div>
              <div className='truncate text-xs leading-[18px] text-[var(--ds-text-tertiary,#6D6D6D)]'>
                {preset.desc}
              </div>
            </div>
            <SwatchBar id={preset.id} colors={preset.colors} />
          </button>
        );
      })}
    </div>
  );
};
