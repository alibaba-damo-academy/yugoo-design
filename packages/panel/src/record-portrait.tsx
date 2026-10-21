import type { ReactElement } from 'react'

// Original concept prototype artwork. SPDX-License-Identifier: Apache-2.0
/** Original decorative SVG artwork from cx-2's user-approved constellation v2.
 * Stable record identity chooses a variant; labels, roles and user identity are
 * never inferred. No image URL, upload, network request or saved avatar field. */
export function recordPortraitVariant(identity: string): number {
  let hash = 2166136261
  for (const char of identity) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0
  return hash % 3
}

export function RecordPortrait({ identity }: { identity: string }): ReactElement {
  const variant = recordPortraitVariant(identity)
  return <span className={`ygd-record-portrait is-variant-${variant}`} data-portrait-variant={variant}>
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M9 62c1-18 13-21 23-21s22 3 23 21" fill={['#8e8bc5', '#68a79b', '#c78c60'][variant]} />
      <path d="M25 40h14v12H25" fill={variant === 1 ? '#b88165' : '#efc4a5'} />
      <ellipse cx="32" cy="27" rx="17" ry="20" fill={variant === 1 ? '#cd9778' : '#f4d3b6'} />
      {variant === 0 ? <>
        <path d="M15 28C9 7 28-2 44 10c8 5 5 17 4 21l-5-14c-6 8-19 4-23 0l-4 13" fill="#414364" />
        <g fill="none" stroke="#515270" strokeWidth="2"><rect x="18" y="25" width="12" height="8" rx="3" /><rect x="34" y="25" width="12" height="8" rx="3" /><path d="M30 28h4" /></g>
        <path d="M28 38q4 4 8 0" fill="none" stroke="#a96e63" strokeWidth="1.5" />
      </> : variant === 1 ? <>
        <path d="M14 29c-4-22 10-25 18-25 13 0 22 10 17 26l-5-12c-4 5-14 1-17-4l-9 16" fill="#344e47" />
        <path d="M22 28h4m12 0h4" stroke="#344e47" strokeWidth="2" strokeLinecap="round" />
        <path d="M27 37q5 6 10 0" fill="none" stroke="#784934" strokeWidth="1.5" />
      </> : <>
        <path d="M14 33V18C14 0 49 1 49 19v17l-7-16c-6 1-15-3-20-7l-3 22" fill="#845c49" />
        <path d="M22 28h4m12 0h4" stroke="#775341" strokeWidth="2" strokeLinecap="round" />
        <path d="M28 38q4 3 8 0" fill="none" stroke="#aa6c5a" strokeWidth="1.5" />
      </>}
    </svg>
  </span>
}
