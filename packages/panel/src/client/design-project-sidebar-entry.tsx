/** Persistent sidebar entry for browsing and commanding Design Projects. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import type { DesignProjectCatalogRead } from './types.ts'
import { currentLanguage } from './ported/host.ts'

export interface DesignProjectSidebarEntryProps {
  readonly side?: 'left' | 'right'
  readonly wide: boolean
  readonly expanded: boolean
  readonly catalog: DesignProjectCatalogRead | null
  readonly loading: boolean
  readonly error?: string
  readonly onToggle: () => void
  readonly onRefresh: () => void
  readonly onCommand: (command: string) => void
}

/** Keep the UI ordering explicit even when a third-party Host returns unsorted records. */
export function sortDesignProjectsNewestFirst(
  projects: DesignProjectCatalogRead['projects'],
): DesignProjectCatalogRead['projects'] {
  return [...projects].sort((left, right) => (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || left.name.localeCompare(right.name)
    || left.projectId.localeCompare(right.projectId)
  ))
}

/** Recovery is a normal Host command; the Panel only supplies the source root. */
export function designProjectRecoveryCommand(root: string): string {
  return `/yugoo recover ${root}`
}

function compactDate(value: string, isZh: boolean): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(isZh ? 'zh-CN' : 'en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

/** Sidebar button plus a body-portaled project switcher. All mutations remain `/yugoo` commands. */
export function DesignProjectSidebarEntry({
  wide,
  side = 'left',
  expanded,
  catalog,
  loading,
  error,
  onToggle,
  onRefresh,
  onCommand,
}: DesignProjectSidebarEntryProps): ReactElement {
  const isZh = currentLanguage() === 'zh_CN'
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<CSSProperties>({ left: 56, bottom: 16 })
  const [newName, setNewName] = useState('')
  const [mindset, setMindset] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const projects = useMemo(
    () => sortDesignProjectsNewestFirst(catalog?.projects ?? []),
    [catalog?.projects],
  )
  const current = projects.find(project => project.projectId === catalog?.currentProjectId)

  const reposition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    setPosition({
      left: Math.max(8, Math.min(side === 'right' ? rect.left - 376 : rect.right + 8, window.innerWidth - 376)),
      bottom: Math.max(8, window.innerHeight - rect.bottom),
    })
  }, [side])

  useEffect(() => {
    if (!expanded) return
    reposition()
    const close = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      onToggle()
    }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') onToggle() }
    window.addEventListener('resize', reposition)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('resize', reposition)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', key)
    }
  }, [expanded, onToggle, reposition])

  useEffect(() => {
    if (!expanded) setConfirmDelete(null)
  }, [expanded])

  const label = isZh ? '设计项目' : 'Design projects'
  const popover = expanded && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={popoverRef}
          className='dsh-project-catalog'
          style={position}
          role='dialog'
          aria-label={label}
          data-testid='design-project-catalog'
        >
          <header className='dsh-project-catalog-header'>
            <div>
              <strong>{label}</strong>
              <span>{isZh ? '最近更新优先' : 'Recently updated first'}</span>
            </div>
            <button type='button' onClick={onRefresh} disabled={loading} aria-label={isZh ? '刷新项目列表' : 'Refresh projects'}>
              <svg viewBox='0 0 20 20' aria-hidden='true'><path d='M15.5 7A6 6 0 1 0 16 11.5M15.5 3.5V7h-3.5' /></svg>
            </button>
          </header>
          <form
            className='dsh-project-create'
            onSubmit={(event) => {
              event.preventDefault()
              const name = newName.trim()
              if (name === '') return
              onCommand(`/yugoo new ${name}`)
              setNewName('')
            }}
          >
            <input
              value={newName}
              onChange={event => { setNewName(event.target.value) }}
              placeholder={isZh ? '新项目名称' : 'New project name'}
              aria-label={isZh ? '新项目名称' : 'New project name'}
            />
            <button type='submit' disabled={newName.trim() === ''}>{isZh ? '新建' : 'Create'}</button>
          </form>
          <div className='dsh-project-list' role='list'>
            {loading && catalog === null
              ? <div className='dsh-project-catalog-empty'>{isZh ? '正在加载…' : 'Loading…'}</div>
              : projects.length === 0
                ? <div className='dsh-project-catalog-empty'>{isZh ? '暂无设计项目' : 'No design projects'}</div>
                : projects.map(project => {
                    const active = project.projectId === catalog?.currentProjectId
                    const deleting = confirmDelete === project.projectId
                    return (
                      <div className='dsh-project-row' data-current={active || undefined} role='listitem' key={project.projectId}>
                        <button
                          type='button'
                          className='dsh-project-open'
                          disabled={active}
                          onClick={() => { onCommand(`/yugoo open ${project.projectId}`) }}
                          title={project.root}
                        >
                          <span className='dsh-project-name'>{project.name}</span>
                          <span className='dsh-project-meta'>
                            {active ? (isZh ? '当前项目' : 'Current') : compactDate(project.updatedAt, isZh)}
                            {project.kit === undefined ? '' : ` · ${project.kit.name}`}
                          </span>
                        </button>
                        <button
                          type='button'
                          className='dsh-project-recover'
                          onClick={() => { onCommand(designProjectRecoveryCommand(project.root)) }}
                          title={isZh ? `迁移 ${project.name}` : `Migrate ${project.name}`}
                          aria-label={isZh ? `迁移 ${project.name}` : `Migrate ${project.name}`}
                        >
                          {isZh ? '迁移' : 'Migrate'}
                        </button>
                        <button
                          type='button'
                          className={`dsh-project-delete${deleting ? ' dsh-project-delete-confirm' : ''}`}
                          onClick={() => {
                            if (!deleting) {
                              setConfirmDelete(project.projectId)
                              return
                            }
                            onCommand(`/yugoo delete ${project.projectId}`)
                          }}
                          aria-label={deleting
                            ? (isZh ? `确认移除 ${project.name}` : `Confirm removing ${project.name}`)
                            : (isZh ? `移除 ${project.name}` : `Remove ${project.name}`)}
                        >
                          {deleting ? (isZh ? '确认' : 'Confirm') : (isZh ? '移除' : 'Remove')}
                        </button>
                      </div>
                    )
                  })}
          </div>
          <footer className='dsh-project-mindset'>
            <div>
              <strong>{isZh ? '设计套件' : 'Kit'}</strong>
              <span>{current?.kit?.name ?? (isZh ? '未选择' : 'Not selected')}</span>
            </div>
            <select
              value={mindset}
              onChange={event => { setMindset(event.target.value) }}
              disabled={catalog?.currentProjectId == null || (catalog?.mindsets.length ?? 0) === 0}
              aria-label={isZh ? '选择设计套件' : 'Select kit'}
            >
              <option value=''>{isZh ? '选择设计套件…' : 'Select kit…'}</option>
              {(catalog?.mindsets ?? []).map(option => (
                <option value={option.name} key={`${option.name}@${option.version}`}>{option.name}</option>
              ))}
            </select>
            <button
              type='button'
              disabled={mindset === '' || catalog?.currentProjectId == null}
              onClick={() => { onCommand(`/yugoo kit ${mindset}`) }}
            >
              {isZh ? '切换' : 'Switch'}
            </button>
          </footer>
          {error === undefined ? null : <div className='dsh-project-catalog-error' role='alert'>{error}</div>}
        </div>,
        document.body,
      )
    : null

  return (
    <div className={`dsh-project-sidebar-entry${wide ? '' : ' dsh-project-sidebar-entry-rail'}`}>
      <button
        ref={triggerRef}
        type='button'
        className='dsh-project-sidebar-trigger'
        aria-label={label}
        aria-expanded={expanded}
        aria-haspopup='dialog'
        onClick={onToggle}
      >
        <svg className='dsh-project-sidebar-icon' viewBox='0 0 20 20' aria-hidden='true'>
          <path d='M2.75 5.25h5l1.5 1.75h8v8.25h-14.5z' />
          <path d='M2.75 7V3.75h5L9 5.25h6' />
        </svg>
        {wide && <span className='dsh-project-sidebar-label'>{label}</span>}
      </button>
      {popover}
    </div>
  )
}
