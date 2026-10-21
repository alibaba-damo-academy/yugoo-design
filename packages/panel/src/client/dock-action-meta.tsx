/**
 * Two-line project header: completion, then name and a native folder action.
 * The directory is an action input, never a third line or hidden path tooltip.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { parseClarityView } from './clarity.ts'
import { ClarityDockReadout } from './clarity-dock.tsx'
import { useLang } from './ported/host.ts'

/** True when the action bar carries at least one metadata line. */
export function hasDockMeta(
  clarity: unknown,
  projectPath: string | null | undefined,
  projectName?: string | null,
): boolean {
  const view = parseClarityView(clarity)
  return view !== undefined
    || (typeof projectPath === 'string' && projectPath.trim() !== '')
    || (typeof projectName === 'string' && projectName.trim() !== '')
}

/**
 * The two-line metadata block rendered above the Design Bundle tabs.
 * @param props.clarity - the DesignJournal-backed clarity value.
 * @param props.projectName - selected project's human-readable name.
 * @param props.projectPath - selected project root, or null before binding.
 * @returns the left metadata column, or null when both values are absent.
 */
export function DesignDockMeta(props: {
  compact?: boolean
  clarity: unknown
  projectName: string | null | undefined
  projectPath: string | null | undefined
  canOpenProjectFolder?: () => Promise<boolean>
  openProjectFolder?: (path: string) => Promise<void>
}): ReactElement | null {
  const t = useLang()
  const name = typeof props.projectName === 'string' && props.projectName.trim() !== ''
    ? props.projectName.trim()
    : undefined
  const path = typeof props.projectPath === 'string' && props.projectPath.trim() !== ''
    ? props.projectPath
    : undefined
  const [folderAvailable, setFolderAvailable] = useState(false)
  const [operation, setOperation] = useState({ pending: false, failed: false })
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setFolderAvailable(false)
    setOperation({ pending: false, failed: false })
    if (path && props.openProjectFolder && props.canOpenProjectFolder) {
      void props.canOpenProjectFolder().then(
        available => { if (current === generation.current) setFolderAvailable(available) },
        () => { if (current === generation.current) setFolderAvailable(false) },
      )
    }
    return () => { generation.current++ }
  }, [path, props.openProjectFolder, props.canOpenProjectFolder])
  const openFolder = (): void => {
    if (!path || !props.openProjectFolder || operation.pending) return
    const current = generation.current
    setOperation({ pending: true, failed: false })
    void props.openProjectFolder(path).then(
      () => { if (current === generation.current) setOperation({ pending: false, failed: false }) },
      () => { if (current === generation.current) setOperation({ pending: false, failed: true }) },
    )
  }
  if (!hasDockMeta(props.clarity, props.projectPath, props.projectName)) return null
  return (
    <div className={`dsh-design-dock-meta${props.compact ? ' dsh-design-dock-meta-compact' : ''}`} data-testid='design-dock-meta'>
      <ClarityDockReadout value={props.clarity} compact={props.compact} singleLine={!props.compact} />
      {name || folderAvailable ? (
        <div className={props.compact ? 'dsh-design-compact-project' : 'dsh-design-project-identity'}>
          {name && <span data-testid='design-dock-meta-name' title={name}>{props.compact ? name : `${t.design_project_label}${name}`}</span>}
          {path && folderAvailable && <button type='button' className='dsh-design-project-folder'
            data-testid='design-project-open-folder' aria-label={t.design_project_open_folder}
            title={t.design_project_open_folder} disabled={operation.pending} aria-busy={operation.pending || undefined}
            onClick={openFolder}>
            <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
              <path d='M3 8V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v3M3 8h18l-3 12H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z' />
            </svg>
          </button>}
        </div>
      ) : null}
      {operation.failed && <span role='alert' className='dsh-design-project-folder-error'>{t.design_project_open_folder_failed}</span>}
    </div>
  )
}
