import type { HTMLAttributes, ReactElement } from 'react'
import { resolveIconGlyph } from './icon-glyph-map.tsx'

/** Keep the ported span API and native size/color contracts with licensed SVG glyphs. */
export function IconFont({ type, className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { type: string }): ReactElement {
  const Glyph = resolveIconGlyph(type)
  return (
    <span className={`iconfont leading-[1] ${type.startsWith('icon-') ? type : `icon-${type}`} ${className}`} {...props}>
      <Glyph className='dsh-icon-glyph' width='1em' height='1em' aria-hidden='true' />
    </span>
  )
}
