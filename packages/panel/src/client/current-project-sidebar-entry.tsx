/** Read-only project information, using the same metadata as the workspace header. */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DesignDockMeta } from './dock-action-meta.tsx'
import { useCurrentLanguage } from './ported/host.ts'

export function CurrentProjectSidebarEntry(props: {
  wide: boolean
  clarity: unknown
  projectName?: string | null
  projectPath?: string | null
  /** Additional read-only project facts; never a second project store. */
  children?: ReactNode
}) {
  const zh = useCurrentLanguage().startsWith('zh')
  const label = zh ? '当前项目' : 'Current project'
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const pinned = useRef(false)
  const suppressFocus = useRef(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>()
  const cancelClose = () => clearTimeout(timer.current)
  const show = () => { cancelClose(); setOpen(true) }
  // Clarity explanations use a portal. Keep their owning information panel open
  // while reading one, including when crossing the small gap between surfaces.
  const ownsTarget = (target: EventTarget | null) => {
    if (!(target instanceof Node)) return false
    if (trigger.current?.contains(target) || popup.current?.contains(target)) return true
    return [...(popup.current?.querySelectorAll('[aria-describedby]') ?? [])].some(node =>
      node.getAttribute('aria-describedby')?.split(/\s+/).some(tip => document.getElementById(tip)?.contains(target)))
  }
  const close = (restoreFocus = false) => {
    cancelClose(); pinned.current = false; setOpen(false)
    if (restoreFocus) { suppressFocus.current = true; trigger.current?.focus(); suppressFocus.current = false }
  }
  const deferClose = () => {
    cancelClose()
    timer.current = setTimeout(() => {
      if (pinned.current || ownsTarget(document.activeElement) || popup.current?.matches(':hover') || trigger.current?.matches(':hover')) return
      const tips = popup.current?.querySelectorAll('[aria-describedby]') ?? []
      if ([...tips].some(node => node.getAttribute('aria-describedby')?.split(/\s+/).some(tip => document.getElementById(tip)?.matches(':hover')))) {
        deferClose(); return
      }
      setOpen(false)
    }, 180)
  }
  useEffect(() => () => cancelClose(), [])
  useEffect(() => {
    if (!open) return
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(380, window.innerWidth - 24)
      const height = popup.current?.getBoundingClientRect().height ?? 220
      setPosition({ width, left: Math.max(12, rect.left - width - 8), top: Math.max(12, Math.min(rect.top, window.innerHeight - height - 12)) })
    }
    reposition()
    const resize = new ResizeObserver(reposition)
    if (popup.current) resize.observe(popup.current)
    const outside = (event: PointerEvent) => { if (!ownsTarget(event.target)) close() }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const ownsFocus = ownsTarget(document.activeElement)
      if (ownsFocus) event.preventDefault()
      close(ownsFocus)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', reposition)
    return () => {
      resize.disconnect(); document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key); window.removeEventListener('resize', reposition)
    }
  }, [open, props.wide])
  return <>
    <button ref={trigger} type='button' className='dsh-current-project-trigger' data-wide={props.wide}
      aria-label={label} aria-expanded={open} aria-controls={id} aria-haspopup='dialog'
      onMouseEnter={show} onMouseLeave={deferClose}
      onFocus={() => { if (!suppressFocus.current) show() }} onBlur={deferClose}
      onClick={() => { if (pinned.current) close(); else { pinned.current = true; show() } }}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault(); pinned.current = true; show()
          requestAnimationFrame(() => popup.current?.focus())
        }
      }}>
      <svg viewBox='0 0 20 20' aria-hidden='true'><rect x='3' y='2.5' width='14' height='15' rx='2' /><path d='M6 6h8M6 10h5M6 14h7' /></svg>
      {props.wide && <span>{label}</span>}
    </button>
    {open && createPortal(<div ref={popup} id={id} role='dialog' aria-label={label} tabIndex={-1}
      className='dsh-current-project-info' data-testid='current-project-info' style={position}
      onMouseEnter={cancelClose} onMouseLeave={deferClose} onFocus={cancelClose} onBlur={deferClose}>
      <header><strong>{label}</strong><button type='button' aria-label={zh ? '关闭当前项目信息' : 'Close current project information'} onClick={() => close(true)}>×</button></header>
      <DesignDockMeta clarity={props.clarity} projectName={props.projectName} projectPath={props.projectPath} />
      {props.children}
    </div>, document.body)}
  </>
}
