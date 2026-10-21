import { useEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import { PanelsTopLeft, Pencil, X } from 'lucide-react'
import { Handle, Position } from '@xyflow/react'
import { RELATION_SIDES } from './relation-graph-layout.ts'
import { panelText, usePanelI18n } from './panel-i18n.tsx'

const DEFAULT_SIDEBAR_WIDTH = 220
const MIN_SIDEBAR_WIDTH = 160
const MAX_SIDEBAR_WIDTH = 460

/** The existing name binding remains the only editor; the pencil only focuses it. */
export function PanelEditableTitle({ locale, ...props }: InputHTMLAttributes<HTMLInputElement> & { locale?: string }): ReactElement {
  const input = useRef<HTMLInputElement>(null)
  const { locale: contextLocale } = usePanelI18n()
  const editLabel = panelText('editTitle', locale ?? contextLocale)
  const canEdit = !props.disabled && !props.readOnly && !!props.onChange
  return <span className='dsh-design-record-header-content'>
    <input {...props} ref={input} className={`dsh-design-record-header-input${props.className ? ` ${props.className}` : ''}`}
      data-panel-title={canEdit ? 'editable' : 'readonly'} />
    {canEdit ? <button type='button' className='dsh-panel-title-edit' aria-label={editLabel} title={editLabel}
      onClick={() => { input.current?.focus({ preventScroll: true }); input.current?.select() }}>
      <Pencil size={14} aria-hidden='true' />
    </button> : null}
  </span>
}

/** Four shared bidirectional ports. The owning canvas uses Loose mode while
 * retaining its own endpoint and write guards; no overlapping target handles.
 */
export function PanelCanvasHandles({ isConnectable = true }: { isConnectable?: boolean } = {}): ReactElement {
  return <>{RELATION_SIDES.map(side => <Handle key={side} id={side} type='source'
    position={side as Position} className='dsh-canvas-node-handle'
    isConnectable={isConnectable} isConnectableStart={isConnectable} isConnectableEnd={isConnectable} />)}</>
}

/** Counts describe the projected graph, not newly persisted business facts. */
export function PanelCanvasToolbar(props: { title: ReactNode; counts: ReactNode; children?: ReactNode }): ReactElement {
  return <header className='dsh-canvas-toolbar'>
    <div className='dsh-canvas-toolbar-heading'><span className='dsh-canvas-toolbar-title'>{props.title}</span>
      <span className='dsh-canvas-toolbar-counts'>{props.counts}</span></div>
    {props.children ? <div className='dsh-canvas-toolbar-actions'>{props.children}</div> : null}
  </header>
}

function savedSidebarWidth(id: string | undefined): number {
  if (!id || typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH
  const saved = window.localStorage.getItem(`dsh-panel-workspace:${id}:sidebar-width`)
  if (saved === null) return DEFAULT_SIDEBAR_WIDTH
  const value = Number(saved)
  return Number.isFinite(value) ? Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, value)) : DEFAULT_SIDEBAR_WIDTH
}

export interface PanelWorkspaceNavItem {
  id: string
  label: string
  /** Optional secondary context above the main label, e.g. a round number. */
  eyebrow?: string
  description?: string
  descriptionTitle?: string
  supporting?: string
  meta?: string
  /** Explicit text for the existing status; never inferred from an item ID. */
  statusLabel?: string
  /** Opt in to a marker only when a real status exists. */
  statusIndicator?: boolean
  current?: boolean
  status?: 'complete' | 'partial' | 'empty'
}

/** One disclosure glyph for tree navigation and nested record cards. */
export function PanelDisclosureIcon(props: { expanded: boolean }): ReactElement {
  return <svg className='dsh-panel-disclosure-icon' viewBox='0 0 16 16' aria-hidden='true'>
    <path d={props.expanded ? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'} />
  </svg>
}

/** Shared sidebar-edge entry to an in-workspace canvas, not another editor. */
export function PanelWorkspaceCanvasToggle(props: { label: string; onOpen: () => void; className?: string; expanded?: boolean }): ReactElement {
  return <button type='button' className={`dsh-panel-workspace-map-toggle${props.className ? ` ${props.className}` : ''}`}
    aria-label={props.label} title={props.label} aria-expanded={props.expanded} onClick={props.onOpen}>
    <PanelDisclosureIcon expanded={false} />
  </button>
}

/**
 * Provider-neutral two-pane shell for a panel-internal navigator and content.
 * It intentionally owns layout only: Bundles supply the information model and
 * the interpreter/native adapter supplies selection behavior.
 */
export function PanelWorkspace(props: {
  sidebar: ReactNode
  children?: ReactNode
  /** Workspace-wide guidance appears first, above toolbars and record content. */
  guidance?: ReactNode
  className?: string
  /** Stable identity used to restore the user's chosen navigation width. */
  autoSaveId?: string
}): ReactElement {
  const { t } = usePanelI18n()
  const root = useRef<HTMLElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => savedSidebarWidth(props.autoSaveId))
  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    if (!props.autoSaveId || typeof window === 'undefined') return
    window.localStorage.setItem(`dsh-panel-workspace:${props.autoSaveId}:sidebar-width`, String(Math.round(sidebarWidth)))
  }, [props.autoSaveId, sidebarWidth])

  useEffect(() => {
    if (!resizing) return
    const move = (event: globalThis.PointerEvent) => {
      const bounds = root.current?.getBoundingClientRect()
      if (!bounds) return
      const responsiveMax = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, bounds.width * 0.6))
      setSidebarWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(responsiveMax, event.clientX - bounds.left)))
    }
    const finish = () => setResizing(false)
    document.documentElement.dataset.dshPanelResizing = 'true'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
    return () => {
      delete document.documentElement.dataset.dshPanelResizing
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [resizing])

  const resizeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setSidebarWidth(width => Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width + (event.key === 'ArrowLeft' ? -12 : 12))))
  }

  return (
    <section
      ref={root}
      className={`dsh-panel-workspace${resizing ? ' is-resizing' : ''}${props.className ? ` ${props.className}` : ''}`}
      style={{ '--dsh-panel-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className='dsh-panel-workspace-sidebar'>{props.sidebar}</aside>
      <div
        className='dsh-panel-workspace-resize-handle'
        role='separator'
        aria-label={t('resizeSidebar')}
        aria-orientation='vertical'
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={Math.round(sidebarWidth)}
        tabIndex={0}
        onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
          event.preventDefault()
          setResizing(true)
        }}
        onKeyDown={resizeFromKeyboard}
      />
      <main className='dsh-panel-workspace-main'>
        {props.guidance ? <PanelWorkspaceGuidance key={props.autoSaveId} children={props.guidance} /> : null}
        {props.children}
      </main>
    </section>
  )
}

/** Shared sidebar heading and body, also used by choices that are not navigation. */
export function PanelWorkspaceSidebar(props: { title: string; icon?: ReactNode; children: ReactNode; navigation?: boolean }): ReactElement {
  const Container = props.navigation ? 'nav' : 'section'
  return <Container className='dsh-panel-workspace-tree' aria-label={props.title}>
    <header>{props.icon ?? <PanelsTopLeft size={16} aria-hidden='true' />}<h2>{props.title}</h2></header>
    <div className='dsh-panel-workspace-tree-body'>{props.children}</div>
  </Container>
}

/** Structure navigation: a flat list is simply a tree without groups. */
export function PanelWorkspaceTree(props: { title: string; icon?: ReactNode; children: ReactNode }): ReactElement {
  return <PanelWorkspaceSidebar {...props} navigation />
}

/** Apply a choice, rather than navigate to a record. Supplemental visuals are domain-owned. */
export function PanelWorkspaceChoice(props: {
  title: string; description?: string; children?: ReactNode; selected?: boolean; disabled?: boolean; onChoose: () => void
}): ReactElement {
  return <button type='button' className='dsh-panel-workspace-choice' aria-label={props.title}
    aria-pressed={props.selected} disabled={props.disabled} onClick={props.onChoose}>
    <strong>{props.title}</strong>{props.description ? <small>{props.description}</small> : null}{props.children}
  </button>
}

/** Expandable first-tier node; children are rendered with a visible branch spine. */
export function PanelWorkspaceTreeGroup(props: {
  label: string
  expanded: boolean
  children: ReactNode
  onToggle: () => void
}): ReactElement {
  return <section className='dsh-panel-workspace-tree-group'>
    <button
      type='button'
      className='dsh-panel-workspace-tree-group-toggle'
      aria-expanded={props.expanded}
      onClick={props.onToggle}
    >
      <PanelDisclosureIcon expanded={props.expanded} />
      <span>{props.label}</span>
    </button>
    {props.expanded ? <div className='dsh-panel-workspace-tree-children'>{props.children}</div> : null}
  </section>
}

/** Selectable structure item; the optional trailing slot is presentation only. */
export function PanelWorkspaceTreeItem(props: {
  children: ReactNode
  selected?: boolean
  onSelect: () => void
  ariaLabel?: string
  trailing?: ReactNode
}): ReactElement {
  return <div className='dsh-panel-workspace-tree-branch'>
    <button
      type='button'
      className='dsh-panel-workspace-tree-item'
      aria-label={props.ariaLabel}
      aria-current={props.selected ? 'page' : undefined}
      onClick={props.onSelect}
    ><span className='dsh-panel-workspace-tree-label'>{props.children}</span>
      {props.trailing ? <span className='dsh-panel-workspace-tree-trailing'>{props.trailing}</span> : null}
    </button>
  </div>
}

/**
 * A selectable record that can expose contextual child collections. The
 * disclosure is separate from selection so opening the outline never changes
 * the record currently being edited.
 */
export function PanelWorkspaceTreeRecord(props: {
  children?: ReactNode
  label: ReactNode
  reserveToggle?: boolean
  selected?: boolean
  expanded?: boolean
  onSelect: () => void
  onToggle?: () => void
  ariaLabel?: string
  trailing?: ReactNode
}): ReactElement {
  const { t } = usePanelI18n()
  const expandable = props.children !== undefined
  return <div className='dsh-panel-workspace-tree-branch dsh-panel-workspace-tree-record'>
    <div className={`dsh-panel-workspace-tree-record-row${props.reserveToggle ? ' has-toggle-column' : ''}`}>
      {expandable ? <button type='button' className='dsh-panel-workspace-tree-record-toggle'
        aria-label={t(props.expanded ? 'collapse' : 'expand', { item: props.ariaLabel ?? String(props.label) })}
        aria-expanded={props.expanded} onClick={props.onToggle}>
        <PanelDisclosureIcon expanded={props.expanded === true} />
      </button> : <span className='dsh-panel-workspace-tree-record-spacer' aria-hidden='true' />}
      <button type='button' className='dsh-panel-workspace-tree-item' aria-label={props.ariaLabel}
        aria-current={props.selected ? 'page' : undefined} onClick={props.onSelect}>
        <span className='dsh-panel-workspace-tree-label'>{props.label}</span>
        {props.trailing ? <span className='dsh-panel-workspace-tree-trailing'>{props.trailing}</span> : null}
      </button>
    </div>
    {expandable && props.expanded ? <div className='dsh-panel-workspace-tree-record-children'>{props.children}</div> : null}
  </div>
}

/** A compact third-tier collection nested beneath one parent record. */
export function PanelWorkspaceTreeSubgroup(props: {
  label: string
  count: number
  expanded: boolean
  children: ReactNode
  onToggle: () => void
}): ReactElement {
  return <section className='dsh-panel-workspace-tree-subgroup'>
    <button type='button' className='dsh-panel-workspace-tree-subgroup-toggle'
      aria-expanded={props.expanded} onClick={props.onToggle}>
      <PanelDisclosureIcon expanded={props.expanded} />
      <span>{props.label}</span><small>{props.count}</small>
    </button>
    {props.expanded ? <div className='dsh-panel-workspace-tree-subgroup-children'>{props.children}</div> : null}
  </section>
}

/** Add action shown as the final leaf of a tree group. */
export function PanelWorkspaceTreeAdd(props: {
  children: ReactNode
  onAdd: () => void
  ariaLabel?: string
  disabled?: boolean
}): ReactElement {
  return <div className='dsh-panel-workspace-tree-branch is-add'>
    <button type='button' className='dsh-panel-workspace-tree-add' aria-label={props.ariaLabel} disabled={props.disabled} onClick={props.onAdd}>
      <span aria-hidden='true'>＋</span>{props.children}
    </button>
  </div>
}

/**
 * Shared workspace-level guidance. It sits with the content it explains and
 * keeps navigation sidebars focused on navigation rather than long prose.
 */
export function PanelWorkspaceTip(props: {
  children: ReactNode
  className?: string
  onDismiss?: () => void
}): ReactElement {
  const { t } = usePanelI18n()
  return (
    <aside className={`dsh-panel-workspace-tip${props.className ? ` ${props.className}` : ''}`} role='note'>
      <span className='dsh-panel-workspace-tip-icon' aria-hidden='true'>
        <svg viewBox='0 0 20 20' focusable='false'>
          <circle cx='10' cy='10' r='7.25' />
          <path d='M10 8.7v4.1M10 6.2h.01' />
        </svg>
      </span>
      <div>{props.children}</div>
      {props.onDismiss ? <button type='button' className='dsh-panel-guidance-dismiss' aria-label={t('dismissGuidance')}
        title={t('dismissGuidance')} onClick={props.onDismiss}><X size={14} aria-hidden='true' /></button> : null}
    </aside>
  )
}

/** Dismissal belongs to this mounted workspace, never to Design Files or a profile. */
export function PanelWorkspaceGuidance(props: { children: ReactNode }): ReactElement | null {
  const [dismissed, setDismissed] = useState(false)
  return dismissed ? null : <div className='dsh-panel-workspace-guidance'>
    <PanelWorkspaceTip onDismiss={() => setDismissed(true)}>{props.children}</PanelWorkspaceTip>
  </div>
}

/** Card navigation: title plus secondary context, distinct from structure navigation. */
export function PanelWorkspaceNavigation(props: {
  title: string
  className?: string
  actions?: ReactNode
  description?: string
  icon?: ReactNode
  items: readonly PanelWorkspaceNavItem[]
  selectedId: string
  onSelect: (id: string) => void
}): ReactElement {
  const { t } = usePanelI18n()
  return (
    <nav className={`dsh-panel-workspace-navigation${props.className ? ` ${props.className}` : ''}`} aria-label={props.title}>
      <header>
        <h2>{props.icon ? <span className='dsh-panel-workspace-nav-icon' aria-hidden='true'>{props.icon}</span> : null}{props.title}</h2>
        {props.description ? <p>{props.description}</p> : null}
      </header>
      <div className='dsh-panel-workspace-nav-items'>
        {props.items.map(item => (
          <button
            type='button'
            key={item.id}
            aria-current={item.id === props.selectedId ? 'page' : undefined}
            data-status={item.status}
            onClick={() => { props.onSelect(item.id) }}
          >
            {item.eyebrow ? <span className='dsh-panel-workspace-nav-eyebrow'>{item.eyebrow}</span> : null}
            <span className='dsh-panel-workspace-nav-heading'>
              {item.statusIndicator && item.status ? <span className='dsh-panel-workspace-nav-status' aria-hidden='true' /> : null}
              <span className='dsh-panel-workspace-nav-label'>{item.label}</span>
              {item.current ? <span className='dsh-panel-workspace-current'>{t('current')}</span> : null}
            </span>
            {item.description ? <span className='dsh-panel-workspace-nav-description' title={item.descriptionTitle ?? item.description}>{item.description}</span> : null}
            {item.supporting || item.statusLabel || item.meta ? <span className='dsh-panel-workspace-nav-footer'>
              {item.supporting ? <span>{item.supporting}</span> : null}
              {item.statusLabel || item.meta ? <span className='dsh-panel-workspace-nav-meta'>{item.statusLabel ?? item.meta}</span> : null}
            </span> : null}
          </button>
        ))}
        {props.actions}
      </div>
    </nav>
  )
}

/** An in-workspace covering view, not a modal or a second editing authority.
 * Callers choose its extent by wrapping either the whole workspace or only its
 * content. The covered view stays mounted, retaining selection and local drafts.
 */
export function PanelWorkspaceCover(props: {
  active: boolean; children: ReactNode; cover: ReactNode; label: string
  onClose: () => void
  keepCoverMounted?: boolean
}): ReactElement {
  const base = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const surface = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const wasActive = useRef(false)
  const { t } = usePanelI18n()
  useEffect(() => {
    if (props.active) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      base.current?.setAttribute('inert', '')
      surface.current?.removeAttribute('inert')
      close.current?.focus({ preventScroll: true })
    } else {
      base.current?.removeAttribute('inert')
      surface.current?.setAttribute('inert', '')
      if (wasActive.current && previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true })
    }
    wasActive.current = props.active
  }, [props.active])
  return <div className="dsh-workspace-cover">
    <div ref={base} className="dsh-workspace-cover-base" aria-hidden={props.active || undefined}
      style={props.active ? { visibility: 'hidden', opacity: 0, pointerEvents: 'none' } : undefined}>{props.children}</div>
    {props.active || props.keepCoverMounted ? <section ref={surface} className="dsh-workspace-cover-surface" aria-label={props.label}
      aria-hidden={!props.active || undefined} style={!props.active ? { visibility: 'hidden', opacity: 0, pointerEvents: 'none' } : undefined}>
      {props.cover}
      <button ref={close} type="button" className="dsh-workspace-cover-return" aria-label={t('returnToDetails')}
        title={t('returnToDetails')} onClick={props.onClose}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4-4 4 4 4" /></svg>
      </button>
    </section> : null}
  </div>
}
