import type { ReactElement } from 'react'
export function FileExplorer({ paths, selected, openFile, disabled = false }: { paths: readonly string[]; selected?: string; openFile: (path: string) => void; disabled?: boolean }): ReactElement {
  const branch = (prefix: string): ReactElement => {
    const children = new Map<string, boolean>()
    for (const path of paths) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length), name = rest.split('/')[0]
      if (name) children.set(name, rest.includes('/') || children.get(name) === true)
    }
    return <>{[...children].sort(([a, ad], [b, bd]) => Number(bd) - Number(ad) || a.localeCompare(b)).map(([name, folder]) => {
      const path = `${prefix}${name}`
      const icon = <svg viewBox="0 0 20 20" aria-hidden="true" className={`ygd-studio-file-icon ${folder ? 'folder' : /\.md$/i.test(name) ? 'markdown' : 'config'}`}>
        {folder ? <path d="M2 5h6l2 2h8v10H2z" /> : <><path d="M4 2h8l4 4v12H4zM12 2v5h4" /><path d="M7 11h6M7 14h6" /></>}
      </svg>
      return folder ? <details key={path} open={selected?.startsWith(`${path}/`) || undefined} className="ygd-studio-tree-folder">
        <summary><span className="ygd-studio-chevron">›</span>{icon}<span>{name}</span></summary>
        <div className="ygd-studio-tree-children">{branch(`${path}/`)}</div>
      </details> : <button key={path} className="ygd-studio-tree-node" disabled={disabled} type="button" title={path} aria-current={selected === path ? 'true' : undefined} onClick={() => openFile(path)}>
        <span className="ygd-studio-chevron" />{icon}<span className="ygd-studio-tree-label">{name}</span>
      </button>
    })}</>
  }
  return <nav className="ygd-studio-file-tree" aria-label="Source files">{branch('')}</nav>
}
